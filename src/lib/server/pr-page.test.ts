import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { cliCommands, loadPrPage, loadWorkflowStep, parsePrParams } from './pr-page';
import { closeStore, createDraft, markViewed, submitWorkflows } from './store';
import { samplePr, sampleWorkflows } from './test-fixtures';

async function withEnv(run: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-page-'));
  const previous = { dir: process.env.TRACE_DATA_DIR, token: process.env.GITHUB_TOKEN };
  const oldFetch = globalThis.fetch;
  process.env.TRACE_DATA_DIR = directory;
  process.env.GITHUB_TOKEN = 'token';
  try { await run(); }
  finally {
    closeStore();
    globalThis.fetch = oldFetch;
    for (const [key, value] of [['TRACE_DATA_DIR', previous.dir], ['GITHUB_TOKEN', previous.token]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

const stubHead = (sha: string) => {
  globalThis.fetch = (async () => Response.json({ title: 'Track request flow', html_url: 'x', number: 7, body: null, user: { login: 'dev' },
    base: { ref: 'main', repo: { full_name: 'acme/widget' } }, head: { ref: 'feature', sha } })) as typeof fetch;
};

test('validates owner, repo and number', () => {
  assert.deepEqual(parsePrParams('acme', 'widget.js', '7'), { owner: 'acme', repo: 'widget.js', number: 7 });
  for (const [owner, repo, number] of [['-bad', 'r', '1'], ['a', '..', '1'], ['a', 'r', '0'], ['a', 'r', '1x'], ['a', 'r', '-2'], ['a/b', 'r', '1']]) {
    assert.throws(() => parsePrParams(owner, repo, number), (error: { status?: number }) => error.status === 400);
  }
});

test('CLI commands embed the PR URL and the absolute launcher path', () => {
  const commands = cliCommands({ owner: 'acme', repo: 'widget', number: 7 });
  const launcher = path.resolve(process.cwd(), 'scripts/mcp-launch.mjs');
  assert.equal(commands.register.claude, `claude mcp add trace -- node ${launcher}`);
  assert.equal(commands.register.codex, `codex mcp add trace -- node ${launcher}`);
  assert.match(commands.claude, /^claude '.*https:\/\/github\.com\/acme\/widget\/pull\/7.*'$/);
  assert.match(commands.codex, /^codex '.*trace_workflows.*'$/);
});

test('PR page reports workflows and flags an analysis made for an older commit', () => withEnv(async () => {
  stubHead('0123456789abcdef');
  const empty = await loadPrPage('acme', 'widget', '7');
  assert.equal(empty.analysis, null);
  assert.deepEqual(empty.features, []);
  assert.equal(empty.pr.title, 'Track request flow');
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  const fresh = await loadPrPage('acme', 'widget', '7');
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.features.map((group) => [group.feature, group.actor, group.workflows.map((workflow) => [workflow.id, workflow.stepCount, workflow.entrypoint.kind])]),
    [['An API client lists widgets', 'API client', [['w1', 2, 'http']]]]);
  assert.deepEqual(fresh.coverage, { total: 2, covered: 2, unassigned: 0, uncovered: [], ignoredTests: 0, unassignedFiles: [] });
  assert.equal(empty.coverage, null);
  stubHead('ffffffff');
  assert.equal((await loadPrPage('acme', 'widget', '7')).stale, true);
  assert.equal(JSON.stringify(fresh).includes('token'), false);
}));

test('workflow step data carries the mermaid text, the file and prev/next', () => withEnv(async () => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  const first = loadWorkflowStep('acme', 'widget', '7', 'w1', '1');
  assert.equal(first.file?.path, 'src/api/route.ts');
  assert.equal(first.prev, null);
  assert.equal(first.next, 2);
  assert.match(first.mermaid, /^flowchart TB/);
  const last = loadWorkflowStep('acme', 'widget', '7', 'w1', '2');
  assert.deepEqual([last.prev, last.next, last.stepCount], [1, null, 2]);
  for (const [workflow, step] of [['w9', '1'], ['w1', '3'], ['w1', '0'], ['w1', 'x']]) {
    assert.throws(() => loadWorkflowStep('acme', 'widget', '7', workflow, step), (error: { status?: number }) => error.status === 404);
  }
}));

test('workflow step data holds the single file of a step, and the primary file first for legacy steps with paths', () => withEnv(async () => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  assert.deepEqual(loadWorkflowStep('acme', 'widget', '7', 'w1', '1').files.map((file) => file.path), ['src/api/route.ts']);
  const db = new DatabaseSync(path.join(process.env.TRACE_DATA_DIR!, 'trace.db'));
  const steps = sampleWorkflows[0].steps.map((step, index) => ({ id: `s${index + 1}`, ...step, paths: index === 0 ? ['src/core/service.ts'] : [] }));
  db.prepare('UPDATE workflows SET steps_json = ? WHERE analysis_id = ?').run(JSON.stringify(steps), draft.id);
  db.close();
  const data = loadWorkflowStep('acme', 'widget', '7', 'w1', '1');
  assert.deepEqual(data.files.map((file) => file.path), ['src/api/route.ts', 'src/core/service.ts']);
  assert.equal(data.file?.path, 'src/api/route.ts');
}));

test('PR page shows the coverage of an old incomplete analysis', () => withEnv(async () => {
  stubHead('0123456789abcdef');
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, [{ ...sampleWorkflows[0], steps: [sampleWorkflows[0].steps[0]] }], 'agent',
    [{ path: 'src/core/service.ts', reason: 'Generated file.' }]);
  const data = await loadPrPage('acme', 'widget', '7');
  assert.deepEqual(data.coverage, { total: 2, covered: 1, unassigned: 1, uncovered: [], ignoredTests: 0, unassignedFiles: [{ path: 'src/core/service.ts', reason: 'Generated file.' }] });
}));

test('PR page groups workflows by feature in order of first appearance, and a workflow without feature falls back to its title', () => withEnv(async () => {
  stubHead('0123456789abcdef');
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], { ...sampleWorkflows[0], feature: 'Other feature', title: 'B' }, { ...sampleWorkflows[0], title: 'C' }], 'agent');
  const data = await loadPrPage('acme', 'widget', '7');
  assert.deepEqual(data.features.map((group) => [group.feature, group.workflows.map((workflow) => workflow.id)]),
    [['An API client lists widgets', ['w1', 'w3']], ['Other feature', ['w2']]]);
}));

const testFile = { path: 'tests/route.test.ts', status: 'added', additions: 1, deletions: 0, patch: '' };

test('legacy test steps are hidden on the PR page and the step page, and test files are ignored in coverage', () => withEnv(async () => {
  stubHead('0123456789abcdef');
  const draft = createDraft(samplePr({ files: [...samplePr().files, testFile] }));
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  const db = new DatabaseSync(path.join(process.env.TRACE_DATA_DIR!, 'trace.db'));
  const steps = [...sampleWorkflows[0].steps, { title: 'Verified', summary: 'Tests.', path: testFile.path, symbols: [], checks: ['ok'] }].map((step, index) => ({ id: `s${index + 1}`, paths: [], ...step }));
  db.prepare('UPDATE workflows SET steps_json = ?, edges_json = ? WHERE analysis_id = ?').run(JSON.stringify(steps), JSON.stringify([{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }]), draft.id);
  db.prepare('UPDATE analyses SET unassigned_json = ? WHERE id = ?').run(JSON.stringify([{ path: testFile.path, reason: 'tests' }]), draft.id);
  db.prepare('INSERT INTO workflows SELECT analysis_id, ?, 2, title, feature, actor, entrypoint_kind, entrypoint_label, summary, ?, ? FROM workflows WHERE id = ?')
    .run('w2', JSON.stringify([steps[2]]), '[]', 'w1');
  db.close();
  const page = await loadPrPage('acme', 'widget', '7');
  assert.deepEqual(page.features.flatMap((group) => group.workflows.map((workflow) => [workflow.id, workflow.stepCount])), [['w1', 2]]);
  assert.deepEqual(page.coverage, { total: 2, covered: 2, unassigned: 0, uncovered: [], ignoredTests: 1, unassignedFiles: [] });
  const last = loadWorkflowStep('acme', 'widget', '7', 'w1', '2');
  assert.deepEqual([last.stepCount, last.next], [2, null]);
  assert.throws(() => loadWorkflowStep('acme', 'widget', '7', 'w1', '3'), (error: { status?: number }) => error.status === 404);
  assert.throws(() => loadWorkflowStep('acme', 'widget', '7', 'w2', '1'), (error: { status?: number }) => error.status === 404);
}));

test('viewed steps show up as counts on the PR page and as sets and PR-ordered progress on the step page', () => withEnv(async () => {
  stubHead('0123456789abcdef');
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], { ...sampleWorkflows[0], feature: 'Other', title: 'B' }, { ...sampleWorkflows[0], title: 'C' }], 'agent');
  markViewed(draft.id, 'w1', 'src/api/route.ts');
  markViewed(draft.id, 'w3', 'src/api/route.ts');
  markViewed(draft.id, 'w3', 'src/core/service.ts');
  const page = await loadPrPage('acme', 'widget', '7');
  assert.deepEqual(page.features.map((group) => group.workflows.map((workflow) => [workflow.id, workflow.viewed])), [[['w1', 1], ['w3', 2]], [['w2', 0]]]);
  const step = loadWorkflowStep('acme', 'widget', '7', 'w1', '1');
  assert.deepEqual(step.viewedPaths, ['src/api/route.ts']);
  assert.deepEqual(step.progress.map((entry) => [entry.id, entry.total, entry.viewed, entry.firstUnviewed]), [['w1', 2, 1, 2], ['w3', 2, 2, null], ['w2', 2, 0, 1]]);
}));
