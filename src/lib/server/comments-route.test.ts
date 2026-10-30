import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GET, POST } from '../../routes/api/pr/[owner]/[repo]/[number]/comments/+server';
import { commentableLines } from '../diff-hunks';
import { prFileUrl } from './github';
import { closeStore, createDraft, submitWorkflows } from './store';
import { samplePr, sampleWorkflows } from './test-fixtures';

const PATCH = '@@ -1,3 +1,3 @@\n context\n-old\n+new\n+more';

async function withEnv(run: (calls: { url: string; init?: RequestInit }[]) => Promise<void>, token: string | null = 'secret'): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-comments-'));
  const previous = { dir: process.env.TRACE_DATA_DIR, token: process.env.GITHUB_TOKEN, fetch: globalThis.fetch };
  process.env.TRACE_DATA_DIR = directory;
  if (token === null) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = token;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') {
      const sent = JSON.parse(String(init.body));
      return Response.json({ id: 9, body: sent.body, html_url: 'https://github.com/acme/widget/pull/7#discussion_r9', created_at: '2026-10-30T10:00:00Z',
        path: sent.path, commit_id: sent.commit_id, original_commit_id: sent.commit_id, line: sent.line ?? null, original_line: sent.line ?? null,
        start_line: sent.start_line ?? null, original_start_line: sent.start_line ?? null, side: sent.side ?? null, subject_type: sent.subject_type ?? 'line', user: { login: 'me' } }, { status: 201 });
    }
    return Response.json([
      { id: 1, body: 'Current', html_url: 'u1', created_at: 't', path: 'src/api/route.ts', commit_id: '0123456789abcdef', original_commit_id: '0123456789abcdef', line: 3, original_line: 3, start_line: null, original_start_line: null, side: 'RIGHT', user: { login: 'a' } },
      { id: 2, body: 'Older commit', html_url: 'u2', created_at: 't', path: 'src/api/route.ts', commit_id: 'newer', original_commit_id: 'older', line: 4, original_line: 4, start_line: null, original_start_line: null, side: 'RIGHT', user: null },
      { id: 3, body: 'Elsewhere', html_url: 'u3', created_at: 't', path: 'src/core/service.ts', commit_id: '0123456789abcdef', original_commit_id: '0123456789abcdef', line: 1, original_line: 1, start_line: null, original_start_line: null, side: 'RIGHT', user: null }
    ]);
  }) as typeof fetch;
  try { await run(calls); }
  finally {
    closeStore();
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['TRACE_DATA_DIR', previous.dir], ['GITHUB_TOKEN', previous.token]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function ready() {
  const pr = samplePr();
  const draft = createDraft(samplePr({ files: pr.files.map((file) => file.path === 'src/api/route.ts' ? { ...file, patch: PATCH } : file) }));
  submitWorkflows(draft.id, draft.headSha, sampleWorkflows, 'agent');
}

const params = { owner: 'acme', repo: 'widget', number: '7' };
const get = (filePath: string) => GET({ params, url: new URL(`http://localhost/x?path=${encodeURIComponent(filePath)}`) } as unknown as Parameters<typeof GET>[0]);
const post = (body: unknown, contentType = 'application/json') => POST({
  params, request: new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) })
} as unknown as Parameters<typeof POST>[0]);

test('commentableLines maps new-side and removed lines', () => {
  const lines = commentableLines(PATCH);
  assert.deepEqual([...lines.RIGHT], [1, 2, 3]);
  assert.deepEqual([...lines.LEFT], [2]);
});

test('prFileUrl points at the file in the pull request diff', () => {
  const hash = createHash('sha256').update('src/a.ts').digest('hex');
  assert.equal(prFileUrl('https://github.com/acme/widget/pull/7', 'src/a.ts'), `https://github.com/acme/widget/pull/7/files#diff-${hash}`);
});

test('lists the comments of one file, mapped onto the analyzed commit', () => withEnv(async () => {
  assert.equal((await get('src/api/route.ts')).status, 409);
  ready();
  const response = await get('src/api/route.ts');
  assert.equal(response.status, 200);
  const { comments } = await response.json();
  assert.deepEqual(comments.map((comment: { id: number; line: number | null; author: string }) => [comment.id, comment.line, comment.author]), [[1, 3, 'a'], [2, null, 'unknown']]);
  assert.equal((await get('src/unknown.ts')).status, 404);
}));

test('posts line, range and file comments at the analyzed head SHA', () => withEnv(async (calls) => {
  ready();
  const line = await post({ path: 'src/api/route.ts', body: ' Looks off ', side: 'RIGHT', line: 3, startLine: 2 });
  assert.equal(line.status, 201);
  assert.deepEqual(JSON.parse(String(calls.at(-1)!.init!.body)), { body: 'Looks off', commit_id: '0123456789abcdef', path: 'src/api/route.ts', line: 3, side: 'RIGHT', start_line: 2, start_side: 'RIGHT' });
  assert.equal(calls.at(-1)!.url, 'https://api.github.com/repos/acme/widget/pulls/7/comments');
  assert.equal((await line.json()).comment.startLine, 2);
  assert.equal((await post({ path: 'src/api/route.ts', body: 'Removed?', side: 'LEFT', line: 2 })).status, 201);
  const file = await post({ path: 'src/core/service.ts', body: 'Whole file' });
  assert.equal(file.status, 201);
  assert.equal(JSON.parse(String(calls.at(-1)!.init!.body)).subject_type, 'file');
  assert.equal((await file.json()).comment.file, true);
}));

test('refuses posts without a token, JSON, a valid body or a diff line', () => withEnv(async (calls) => {
  ready();
  assert.equal((await post({ path: 'src/api/route.ts', body: 'x' }, 'text/plain')).status, 415);
  assert.equal((await post({ path: 'src/api/route.ts', body: '  ' })).status, 400);
  assert.equal((await post({ path: 'src/other.ts', body: 'x' })).status, 404);
  assert.equal((await post({ path: 'src/api/route.ts', body: 'x', line: 3 })).status, 400);
  assert.equal((await post({ path: 'src/api/route.ts', body: 'x', side: 'RIGHT', line: 9 })).status, 400);
  assert.equal((await post({ path: 'src/api/route.ts', body: 'x', side: 'LEFT', line: 3 })).status, 400);
  assert.equal((await post({ path: 'src/api/route.ts', body: 'x', side: 'RIGHT', line: 2, startLine: 3 })).status, 400);
  assert.equal(calls.length, 0);
}).then(() => withEnv(async (calls) => {
  ready();
  assert.equal((await post({ path: 'src/api/route.ts', body: 'x' })).status, 400);
  assert.equal(calls.length, 0);
}, null)));
