import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { samplePr, sampleWorkflows } from './test-fixtures';
import { closeStore, createDraft, getAnalysis, latestAnalysisForPr, listAnalyses, submitWorkflows } from './store';

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
