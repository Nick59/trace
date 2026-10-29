import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { samplePr, sampleWorkflows } from './test-fixtures';
import { coverage } from './workflows';
import { closeStore, createDraft, getAnalysis, latestAnalysisForPr, listAnalyses, replaceWorkflow, submitWorkflows } from './store';

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
  assert.throws(() => replaceWorkflow(draft.id, 'w1', draft.headSha, noActor, 'agent'), /no actor/);
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
  assert.throws(() => submitWorkflows(draft.id, draft.headSha, [{ ...oneStep('src/api/route.ts'), actor: undefined }], 'agent'), /no actor/);
}));

test('submit keeps paths, actor and unassigned files and returns them on read', () => withStore(() => {
  const draft = createDraft(samplePr());
  const ready = submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts')], 'agent', [{ path: 'src/core/service.ts', reason: 'Generated file.' }]);
  assert.deepEqual(ready.unassigned, [{ path: 'src/core/service.ts', reason: 'Generated file.' }]);
  const stored = getAnalysis(draft.id)!;
  assert.deepEqual(stored.unassigned, ready.unassigned);
  assert.equal(stored.workflows[0].actor, 'API client');
  const withPaths = submitWorkflows(draft.id, draft.headSha, [oneStep('src/api/route.ts', { paths: ['src/core/service.ts'] })], 'agent');
  assert.deepEqual(withPaths.unassigned, []);
  assert.deepEqual(getAnalysis(draft.id)!.workflows[0].steps[0].paths, ['src/core/service.ts']);
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
  assert.deepEqual(analysis.workflows[0].steps[0].paths, []);
  assert.deepEqual(analysis.unassigned, []);
  assert.equal(coverage(analysis).covered, 1);
  assert.deepEqual(coverage(analysis).uncovered, ['src/core/service.ts']);

  const check = new DatabaseSync(path.join(directory, 'trace.db'));
  assert.equal((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
  check.close();

  // An old, incomplete analysis stays editable: replacing keeps the file it already covered.
  assert.equal(replaceWorkflow(id, 'w1', '0123456789abcdef', oneStep('src/api/route.ts'), 'agent').workflows[0].actor, 'API client');
  const fresh = createDraft(samplePr({ number: 8 }));
  submitWorkflows(fresh.id, fresh.headSha, sampleWorkflows, 'agent', []);
  assert.equal(getAnalysis(fresh.id)!.status, 'ready');
}));
