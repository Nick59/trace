import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { POST } from '../../routes/api/pr/[owner]/[repo]/[number]/workflows/[workflowId]/+server';
import { POST as GENERATE } from '../../routes/api/pr/[owner]/[repo]/[number]/workflows/+server';
import { closeStore, createDraft, getAnalysis, submitWorkflows } from './store';
import { samplePr, sampleWorkflows } from './test-fixtures';

const MODEL_KEYS = ['WALKTHROUGH_API_KEY', 'WALKTHROUGH_API_URL', 'WALKTHROUGH_MODEL', 'TRACE_DATA_DIR'] as const;

async function withEnv(configured: boolean, run: () => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-route-'));
  const previous = MODEL_KEYS.map((key) => process.env[key]);
  const oldFetch = globalThis.fetch;
  process.env.TRACE_DATA_DIR = directory;
  if (configured) Object.assign(process.env, { WALKTHROUGH_API_KEY: 'k', WALKTHROUGH_API_URL: 'https://model.test/v1/chat/completions', WALKTHROUGH_MODEL: 'm' });
  else for (const key of MODEL_KEYS.slice(0, 3)) delete process.env[key];
  try { await run(); }
  finally {
    closeStore();
    globalThis.fetch = oldFetch;
    MODEL_KEYS.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await rm(directory, { recursive: true, force: true });
  }
}

const call = (workflowId: string, body?: unknown) => POST({
  params: { owner: 'acme', repo: 'widget', number: '7', workflowId },
  request: new Request('http://localhost/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
} as unknown as Parameters<typeof POST>[0]);

const stubModel = (content: unknown, captured?: { body?: string }) => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (captured) captured.body = String(init?.body);
    return Response.json({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
  }) as typeof fetch;
};

const seed = () => {
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, [sampleWorkflows[0], { ...sampleWorkflows[0], title: 'Second' }], 'agent');
  return draft.id;
};

test('returns 400 when the model API is not configured', () => withEnv(false, async () => {
  seed();
  assert.equal((await call('w1')).status, 400);
}));

test('returns 409 without a ready analysis and 404 for an unknown workflow', () => withEnv(true, async () => {
  createDraft(samplePr());
  assert.equal((await call('w1')).status, 409);
  seed();
  assert.equal((await call('w9')).status, 404);
}));

test('rejects an oversized or non-string instruction', () => withEnv(true, async () => {
  seed();
  assert.equal((await call('w1', { instruction: 'x'.repeat(501) })).status, 400);
  assert.equal((await call('w1', { instruction: 5 })).status, 400);
}));

test('replaces one workflow using the stored snapshot and passes the instruction to the model', () => withEnv(true, async () => {
  const id = seed();
  const captured: { body?: string } = {};
  stubModel({ workflow: { ...sampleWorkflows[0], title: 'Redone' } }, captured);
  const response = await call('w2', { instruction: 'include the DB write' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { analysisId: id, workflowId: 'w2', stepCount: 2 });
  assert.match(captured.body ?? '', /include the DB write/);
  assert.match(captured.body ?? '', /untrusted data/);
  assert.deepEqual(getAnalysis(id)!.workflows.map((workflow) => [workflow.id, workflow.title]), [['w1', 'GET /widgets'], ['w2', 'Redone']]);
  assert.equal(getAnalysis(id)!.source, 'api');
}));

test('returns 502 and keeps the workflow when the model output is invalid or the request fails', () => withEnv(true, async () => {
  const id = seed();
  stubModel({ workflow: { ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], path: 'nope.ts' }] } });
  assert.equal((await call('w1')).status, 502);
  stubModel('not json');
  assert.equal((await call('w1')).status, 502);
  globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
  assert.equal((await call('w1')).status, 502);
  assert.equal(getAnalysis(id)!.workflows[0].title, 'GET /widgets');
  assert.equal(getAnalysis(id)!.source, 'agent');
}));

test('replacing a workflow so that files become uncovered returns 502 with the paths', () => withEnv(true, async () => {
  const id = seed();
  stubModel({ workflow: { ...sampleWorkflows[0], steps: [sampleWorkflows[0].steps[0]] } });
  const first = await call('w1');
  assert.equal(first.status, 200);
  const second = await call('w2');
  assert.equal(second.status, 502);
  assert.match(((await second.json()) as { error: string }).error, /would leave 1 changed file uncovered: src\/core\/service\.ts/);
  assert.equal(getAnalysis(id)!.workflows[1].steps.length, 2);
}));

test('generating workflows that leave files uncovered returns 502 and names the paths', () => withEnv(true, async () => {
  const model = { workflows: [{ ...sampleWorkflows[0], steps: [sampleWorkflows[0].steps[0]] }] };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://model.test')) return Response.json({ choices: [{ message: { content: JSON.stringify(model) } }] });
    if (url.endsWith('/pulls/7')) return Response.json({ title: 'T', html_url: 'https://github.com/acme/widget/pull/7', number: 7, body: '', user: { login: 'dev' },
      base: { ref: 'main', repo: { full_name: 'acme/widget' } }, head: { ref: 'f', sha: 'abc' } });
    if (url.includes('/pulls/7/files?')) return Response.json(samplePr().files.map((file) => ({ filename: file.path, status: 'modified', additions: 1, deletions: 0, patch: '+x' })));
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const response = await GENERATE({ params: { owner: 'acme', repo: 'widget', number: '7' } } as unknown as Parameters<typeof GENERATE>[0]);
  assert.equal(response.status, 502);
  const body = await response.json() as { error: string };
  assert.match(body.error, /incomplete analysis/);
  assert.match(body.error, /src\/core\/service\.ts/);
}));
