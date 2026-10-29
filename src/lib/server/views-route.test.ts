import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DELETE, PUT } from '../../routes/api/pr/[owner]/[repo]/[number]/[workflowId]/views/+server';
import { closeStore, createDraft, submitWorkflows, viewsFor } from './store';
import { samplePr, sampleWorkflows } from './test-fixtures';

async function withStore(run: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-views-'));
  const previous = process.env.TRACE_DATA_DIR;
  process.env.TRACE_DATA_DIR = directory;
  try { await run(); }
  finally {
    closeStore();
    if (previous === undefined) delete process.env.TRACE_DATA_DIR; else process.env.TRACE_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

const call = (handler: typeof PUT, workflowId: string, body?: unknown, repo = 'widget') => handler({
  params: { owner: 'acme', repo, number: '7', workflowId },
  request: new Request('http://localhost/x', { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
} as unknown as Parameters<typeof PUT>[0]);

const status = async (response: Response | Promise<Response>) => (await response).status;

test('marks and unmarks a step and returns the workflow counts', () => withStore(async () => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  const first = await call(PUT, 'w1', { path: 'src/api/route.ts' });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { viewed: 1, total: 2 });
  assert.deepEqual(await (await call(PUT, 'w1', { path: 'src/api/route.ts' })).json(), { viewed: 1, total: 2 });
  assert.deepEqual(await (await call(PUT, 'w1', { path: 'src/core/service.ts' })).json(), { viewed: 2, total: 2 });
  assert.deepEqual(await (await call(DELETE, 'w1', { path: 'src/api/route.ts' })).json(), { viewed: 1, total: 2 });
  assert.deepEqual([...viewsFor(draft.id).get('w1')!], ['src/core/service.ts']);
}));

test('refuses bad bodies, unknown workflows, foreign paths and missing analyses', () => withStore(async () => {
  assert.equal(await status(call(PUT, 'w1', { path: 'x' })), 409);
  const draft = createDraft(samplePr({ files: [...samplePr().files, { path: 'src/other.ts', status: 'added', additions: 1, deletions: 0, patch: '' }] }));
  assert.equal(await status(call(PUT, 'w1', { path: 'src/api/route.ts' })), 409);
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent', [{ path: 'src/other.ts', reason: 'Generated.' }]);
  assert.equal(await status(call(PUT, 'w1')), 400);
  assert.equal(await status(call(PUT, 'w1', { path: 7 })), 400);
  assert.equal(await status(call(PUT, 'w1', { path: '' })), 400);
  assert.equal(await status(call(PUT, 'w9', { path: 'src/api/route.ts' })), 404);
  assert.equal(await status(call(PUT, 'w1', { path: 'src/other.ts' })), 404);
  assert.equal(await status(call(DELETE, 'w1', { path: '../etc/passwd' })), 404);
  await assert.rejects(async () => call(PUT, 'w1', { path: 'x' }, '..'), (error: { status?: number }) => error.status === 400);
  assert.equal(viewsFor(draft.id).size, 0);
}));
