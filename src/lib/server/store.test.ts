import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { samplePr, sampleWorkflows } from './test-fixtures';
import { coverage } from './workflows';
import { closeStore, createDraft, getAnalysis, latestAnalysisForPr, listAnalyses, markViewed, replaceWorkflow, submitWorkflows, unmarkViewed, viewsFor } from './store';

async function withStore(run: (directory: string) => Promise<void> | void): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-store-'));
  const previous = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = directory;
  try { await run(directory); }
  finally {
    closeStore();
    if (previous === undefined) delete process.env.TRACE_DATA_DIR; else process.env.TRACE_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test('persists a draft in a restricted SQLite file and lists its summary', () => withStore(async (directory) => {
  const draft = createDraft(samplePr());
  assert.equal(draft.status, 'draft');
  assert.deepEqual(draft.workflows, []);
  assert.equal(getAnalysis(draft.id)?.pr.title, 'Track request flow');
  assert.deepEqual(listAnalyses(), [{ id: draft.id, title: 'Track request flow', repository: 'acme/widget', number: 7,
    headSha: '0123456789abcdef', status: 'draft', source: null, workflowCount: 0, updatedAt: draft.updatedAt }]);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(directory, 'trace.db'))).mode & 0o777, 0o600);
}));

test('requires the exact head SHA and changed-file paths before marking an analysis ready', () => withStore(() => {
  const draft = createDraft(samplePr());
  assert.throws(() => submitWorkflows(draft.id, 'wrong-sha', sampleWorkflows, 'agent'), /Head SHA/);
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [{ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], path: '../outside.ts' }] }], 'agent'), /invalid/);
  assert.equal(getAnalysis(draft.id)?.status, 'draft');
  const ready = submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.source, 'agent');
  const stored = getAnalysis(draft.id)!;
  assert.equal(stored.workflows[0].id, 'w1');
  assert.deepEqual(stored.workflows[0].edges, [{ from: 's1', to: 's2' }]);
  assert.equal(listAnalyses()[0].workflowCount, 1);
}));

test('resubmitting replaces the workflows of an analysis', () => withStore(() => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], sampleWorkflows[0]], 'agent');
  assert.equal(getAnalysis(draft.id)!.workflows.length, 2);
  submitWorkflows(draft.id, draft.headSha, [{ ...sampleWorkflows[0], title: 'Replaced' }], 'api');
  const stored = getAnalysis(draft.id)!;
  assert.deepEqual(stored.workflows.map((workflow) => workflow.title), ['Replaced']);
  assert.equal(stored.source, 'api');
}));

test('latestAnalysisForPr prefers the newest ready analysis over a newer draft', () => withStore(() => {
  const first = createDraft(samplePr());
  submitWorkflows(first.id, first.headSha, sampleWorkflows, 'agent');
  const newerDraft = createDraft(samplePr());
  assert.equal(latestAnalysisForPr('ACME/widget', 7)?.id, first.id);
  assert.equal(latestAnalysisForPr('acme/widget', 8), undefined);
  const second = createDraft(samplePr({ number: 9 }));
  assert.equal(latestAnalysisForPr('acme/widget', 9)?.id, second.id);
  assert.notEqual(newerDraft.id, first.id);
}));

test('rejects path-like ids and oversized snapshots', () => withStore(() => {
  assert.throws(() => getAnalysis('../escape'), /Invalid analysis id/);
  assert.throws(() => createDraft(samplePr({ description: 'x'.repeat(5 * 1024 * 1024) })), /maximum stored size/);
  assert.deepEqual(listAnalyses(), []);
}));

test('replaceWorkflow swaps one workflow in place and keeps its id and position', () => withStore(() => {
  const draft = createDraft(samplePr());
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, sampleWorkflows[0], 'agent'), /no workflows/);
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], { ...sampleWorkflows[0], title: 'Second' }], 'agent');
  const before = getAnalysis(draft.id)!;
  const replacement = { ...sampleWorkflows[0], title: 'Redone', steps: [sampleWorkflows[0].steps[1]] };
  const updated = replaceWorkflow(draft.id, 'w2', draft.headSha, replacement, 'api');
  assert.deepEqual(updated.workflows.map((workflow) => [workflow.id, workflow.position, workflow.title]), [['w1', 1, 'GET /widgets'], ['w2', 2, 'Redone']]);
  const stored = getAnalysis(draft.id)!;
  assert.deepEqual(stored.workflows.map((workflow) => workflow.title), ['GET /widgets', 'Redone']);
  assert.deepEqual(stored.workflows[1].steps.map((step) => [step.id, step.title]), [['s1', 'Service']]);
  assert.equal(stored.source, 'api');
  assert.ok(stored.updatedAt >= before.updatedAt);
  assert.equal(stored.updatedAt, updated.updatedAt);
}));

test('replaceWorkflow rejects a head SHA mismatch, an unknown id and an invalid workflow without changing anything', () => withStore(() => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  assert.throws(() => replaceWorkflow(draft.id, 'w1', 'other-sha', sampleWorkflows[0], 'agent'), /Head SHA/);
  assert.throws(() => replaceWorkflow(draft.id, 'w9', draft.headSha, sampleWorkflows[0], 'agent'), /Workflow not found/);
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, { ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], path: 'nope.ts' }] }, 'agent'), /invalid/);
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, 'text', 'agent'), /invalid/);
  const { actor: _actor, ...noActor } = sampleWorkflows[0];
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, noActor, 'agent'), /no feature or actor/);
  assert.throws(() => replaceWorkflow('00000000-0000-4000-8000-000000000000', 'w1', draft.headSha, sampleWorkflows[0], 'agent'), /Analysis not found/);
  const stored = getAnalysis(draft.id)!;
  assert.equal(stored.source, 'agent');
  assert.equal(stored.workflows[0].title, 'GET /widgets');
}));

const oneStep = (path: string, extra: object = {}) => ({ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], path, ...extra }] });

test('submit rejects an incomplete analysis and lists the uncovered paths', () => withStore(() => {
  const draft = createDraft(samplePr());
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts')], 'agent'), /uncovered: src\/core\/service\.ts/);
  assert.equal(getAnalysis(draft.id)!.status, 'draft');
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts')], 'agent', [{ path: 'nope.ts', reason: 'x' }]), /Unassigned files are invalid/);
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [{ ...oneStep('src/api/route.ts'), actor: undefined }], 'agent'), /no feature or actor/);
}));

test('submit keeps feature, actor and unassigned files, and rejects legacy paths or a missing feature', () => withStore(() => {
  const draft = createDraft(samplePr());
  const ready = submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts')], 'agent', [{ path: 'src/core/service.ts', reason: 'Generated file.' }]);
  assert.deepEqual(ready.unassigned, [{ path: 'src/core/service.ts', reason: 'Generated file.' }]);
  const stored = getAnalysis(draft.id)!;
  assert.deepEqual(stored.unassigned, ready.unassigned);
  assert.equal(stored.workflows[0].actor, 'API client');
  assert.equal(stored.workflows[0].feature, 'An API client lists widgets');
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts', { paths: ['src/core/service.ts'] })], 'agent'), /legacy paths/);
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [{ ...oneStep('src/api/route.ts'), feature: undefined }], 'agent', [{ path: 'src/core/service.ts', reason: 'r' }]), /no feature or actor/);
  assert.equal(submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts', { paths: [] })], 'agent', [{ path: 'src/core/service.ts', reason: 'r' }]).workflows[0].steps[0].paths.length, 0);
}));

test('replaceWorkflow rejects a replacement that uncovers files and tolerates gaps that already existed', () => withStore(() => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], { ...oneStep('src/api/route.ts'), title: 'Second' }], 'agent');
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, oneStep('src/api/route.ts'), 'agent'), /would leave 1 changed file uncovered: src\/core\/service\.ts/);
  assert.equal(getAnalysis(draft.id)!.workflows[0].steps.length, 2);
  assert.equal(replaceWorkflow(draft.id, 'w2', draft.headSha, { ...oneStep('src/core/service.ts'), title: 'Other' }, 'agent').workflows[1].title, 'Other');
}));

test('migrates a version 1 database and reads its old rows without actor, paths or unassigned', () => withStore((directory) => {
  const old = new DatabaseSync(path.join(directory, 'trace.db'));
  old.exec(`
    CREATE TABLE analyses (id TEXT PRIMARY KEY, repository TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'ready')), source TEXT CHECK (source IN ('agent', 'api')),
      pr_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE workflows (analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL,
      title TEXT NOT NULL, entrypoint_kind TEXT NOT NULL, entrypoint_label TEXT NOT NULL, summary TEXT NOT NULL,
      steps_json TEXT NOT NULL, edges_json TEXT NOT NULL, PRIMARY KEY (analysis_id, id));
    PRAGMA user_version = 1;`);
  const id = '11111111-1111-4111-8111-111111111111';
  old.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'acme/widget', 7, '0123456789abcdef', 'ready', 'agent', JSON.stringify(samplePr()), 'then', 'then');
  old.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'w1', 1, 'Route', 'http', 'GET /x', 'Old summary', JSON.stringify([
    { id: 's1', title: 'Only step', summary: 's', path: 'src/api/route.ts', symbols: [], checks: [] }]), '[]');
  old.close();

  const analysis = latestAnalysisForPr('acme/widget', 7)!;
  assert.equal(analysis.workflows[0].actor, undefined);
  assert.equal(analysis.workflows[0].feature, undefined);
  assert.deepEqual(analysis.workflows[0].steps[0].paths, []);
  assert.deepEqual(analysis.unassigned, []);
  assert.equal(coverage(analysis).covered, 1);
  assert.deepEqual(coverage(analysis).uncovered, ['src/core/service.ts']);

  const check = new DatabaseSync(path.join(directory, 'trace.db'));
  assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
  assert.ok((check.prepare('PRAGMA table_info(workflows)').all() as Array<{ name: string }>).some((column) => column.name === 'feature'));
  check.close();

  // An old, incomplete analysis stays editable: replacing keeps the file it already covered.
  assert.equal(replaceWorkflow(id, 'w1', '0123456789abcdef', oneStep('src/api/route.ts'), 'agent').workflows[0].actor, 'API client');
  const fresh = createDraft(samplePr({ number: 8 }));
  submitWorkflows(fresh.id, fresh.headSha, sampleWorkflows, 'agent', []);
  assert.equal(getAnalysis(fresh.id)!.status, 'ready');
}));

test('migrates a version 2 database to 4 and keeps its rows, with legacy step paths', () => withStore((directory) => {
  const old = new DatabaseSync(path.join(directory, 'trace.db'));
  old.exec(`
    CREATE TABLE analyses (id TEXT PRIMARY KEY, repository TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'ready')), source TEXT CHECK (source IN ('agent', 'api')),
      pr_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, unassigned_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE workflows (analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL,
      title TEXT NOT NULL, actor TEXT, entrypoint_kind TEXT NOT NULL, entrypoint_label TEXT NOT NULL, summary TEXT NOT NULL,
      steps_json TEXT NOT NULL, edges_json TEXT NOT NULL, PRIMARY KEY (analysis_id, id));
    PRAGMA user_version = 2;`);
  const id = '22222222-2222-4222-8222-222222222222';
  old.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'acme/widget', 7, '0123456789abcdef', 'ready', 'agent', JSON.stringify(samplePr()), 'then', 'then', '[]');
  old.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'w1', 1, 'A client lists widgets', 'API client', 'http', 'GET /x', 'Old summary', JSON.stringify([
    { id: 's1', title: 'Step', summary: 's', path: 'src/api/route.ts', paths: ['src/core/service.ts'], symbols: [], checks: ['c'] }]), '[]');
  old.close();

  const analysis = getAnalysis(id)!;
  assert.equal(analysis.workflows[0].feature, undefined);
  assert.equal(analysis.workflows[0].actor, 'API client');
  assert.deepEqual(analysis.workflows[0].steps[0].paths, ['src/core/service.ts']);
  assert.equal(coverage(analysis).uncovered.length, 0);
  const check = new DatabaseSync(path.join(directory, 'trace.db'));
  assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
  check.close();
  assert.equal(replaceWorkflow(id, 'w1', '0123456789abcdef', sampleWorkflows[0], 'agent').workflows[0].feature, 'An API client lists widgets');
  assert.equal(getAnalysis(id)!.workflows[0].feature, 'An API client lists widgets');
}));

test('migrates a version 3 database to 4: adds step_views and keeps its rows', () => withStore((directory) => {
  const old = new DatabaseSync(path.join(directory, 'trace.db'));
  old.exec(`
    CREATE TABLE analyses (id TEXT PRIMARY KEY, repository TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'ready')), source TEXT CHECK (source IN ('agent', 'api')),
      pr_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, unassigned_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE workflows (analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL,
      title TEXT NOT NULL, feature TEXT, actor TEXT, entrypoint_kind TEXT NOT NULL, entrypoint_label TEXT NOT NULL, summary TEXT NOT NULL,
      steps_json TEXT NOT NULL, edges_json TEXT NOT NULL, PRIMARY KEY (analysis_id, id));
    PRAGMA user_version = 3;`);
  const id = '33333333-3333-4333-8333-333333333333';
  old.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'acme/widget', 7, '0123456789abcdef', 'ready', 'agent', JSON.stringify(samplePr()), 'then', 'then', '[]');
  old.prepare('INSERT INTO workflows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'w1', 1, 'Lists', 'Feature', 'API client', 'http', 'GET /x', 'Summary', JSON.stringify([
    { id: 's1', title: 'Step', summary: 's', path: 'src/api/route.ts', paths: [], symbols: [], checks: ['c'] }]), '[]');
  old.close();

  assert.equal(getAnalysis(id)!.workflows[0].feature, 'Feature');
  assert.equal(viewsFor(id).size, 0);
  markViewed(id, 'w1', 'src/api/route.ts');
  assert.deepEqual([...viewsFor(id).get('w1')!], ['src/api/route.ts']);
  const check = new DatabaseSync(path.join(directory, 'trace.db'));
  assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
  check.close();
}));

test('views are marked once, unmarked, listed per workflow and cleared by replace and by a new submission', () => withStore(() => {
  const draft = createDraft(samplePr());
  const second = { ...sampleWorkflows[0], title: 'Second' };
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], second], 'agent');
  assert.equal(viewsFor(draft.id).size, 0);
  markViewed(draft.id, 'w1', 'src/api/route.ts');
  markViewed(draft.id, 'w1', 'src/api/route.ts');
  markViewed(draft.id, 'w1', 'src/core/service.ts');
  markViewed(draft.id, 'w2', 'src/api/route.ts');
  assert.deepEqual([...viewsFor(draft.id).get('w1')!].sort(), ['src/api/route.ts', 'src/core/service.ts']);
  unmarkViewed(draft.id, 'w1', 'src/core/service.ts');
  unmarkViewed(draft.id, 'w1', 'src/core/service.ts');
  assert.deepEqual([...viewsFor(draft.id).get('w1')!], ['src/api/route.ts']);
  assert.throws(() => markViewed('nope', 'w1', 'x'), /Invalid analysis id/);

  replaceWorkflow(draft.id, 'w1', draft.headSha, { ...sampleWorkflows[0], title: 'Again' }, 'agent');
  assert.equal(viewsFor(draft.id).has('w1'), false);
  assert.deepEqual([...viewsFor(draft.id).get('w2')!], ['src/api/route.ts']);

  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  assert.equal(viewsFor(draft.id).size, 0);
}));

test('submit and replace reject a test file as a step with a clear message', () => withStore(() => {
  const pr = samplePr({ files: [...samplePr().files, { path: 'tests/route.test.ts', status: 'added', additions: 1, deletions: 0, patch: '' }] });
  const draft = createDraft(pr);
  const testStep = { title: 'Verified', summary: 'Covers it.', path: 'tests/route.test.ts', symbols: [], checks: ['Passes'] };
  const withTest = { ...sampleWorkflows[0], steps: [...sampleWorkflows[0].steps, testStep] };
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [withTest], 'agent'), /tests\/route\.test\.ts is a test file/);
  assert.equal(getAnalysis(draft.id)!.status, 'draft');
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, withTest, 'agent'), /is a test file/);
}));

test('a submission with ranges round-trips and a range outside every hunk is refused', () => withStore(() => {
  const pr = samplePr();
  pr.files[0].patch = '@@ -1,2 +1,3 @@\n a\n+b\n c';
  const draft = createDraft(pr);
  const ranged = (from: number, to: number) => [{ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], ranges: [{ from, to }] }, sampleWorkflows[0].steps[1]] }];
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, ranged(50, 60), 'agent'), /Step 1 \(src\/api\/route\.ts\) has range 50-60/);
  submitWorkflows(draft.id, draft.headSha, ranged(2, 2), 'agent');
  assert.deepEqual(getAnalysis(draft.id)!.workflows[0].steps.map((step) => step.ranges), [[{ from: 2, to: 2 }], []]);
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, ranged(50, 60)[0], 'agent'), /has range 50-60/);
  replaceWorkflow(draft.id, 'w1', draft.headSha, ranged(1, 3)[0], 'agent');
  assert.deepEqual(getAnalysis(draft.id)!.workflows[0].steps[0].ranges, [{ from: 1, to: 3 }]);
}));
