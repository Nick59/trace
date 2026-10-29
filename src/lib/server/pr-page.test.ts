import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cliCommands, loadPrPage, loadWorkflowStep, parsePrParams } from './pr-page';
import { closeStore, createDraft, submitWorkflows } from './store';
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
  assert.deepEqual(empty.workflows, []);
  assert.equal(empty.pr.title, 'Track request flow');
  const draft = createDraft(samplePr());
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
  const fresh = await loadPrPage('acme', 'widget', '7');
  assert.equal(fresh.stale, false);
  assert.deepEqual(fresh.workflows.map((workflow) => [workflow.id, workflow.stepCount, workflow.entrypoint.kind, workflow.actor]), [['w1', 2, 'http', 'API client']]);
  assert.deepEqual(fresh.coverage, { total: 2, covered: 2, unassigned: 0, uncovered: [], unassignedFiles: [] });
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

test('workflow step data lists the primary file first, then the step paths', () => withEnv(async () => {
  const draft = createDraft(samplePr());
  const step = sampleWorkflows[0].steps[0];
  submitWorkflows(draft.id, draft.headSha, [{ ...sampleWorkflows[0], steps: [{ ...step, paths: ['src/core/service.ts'] }] }], 'agent');
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
  assert.deepEqual(data.coverage, { total: 2, covered: 1, unassigned: 1, uncovered: [], unassignedFiles: [{ path: 'src/core/service.ts', reason: 'Generated file.' }] });
}));
