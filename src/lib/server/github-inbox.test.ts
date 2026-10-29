import assert from 'node:assert/strict';
import test from 'node:test';
import { getGithubInbox, GithubInboxError } from './github-inbox';

const jsonResponse = (data: unknown, status = 200, next = false) => Response.json(data, {
  status, headers: next ? { Link: '<https://api.github.com/next>; rel="next", <https://api.github.com/last>; rel="last"' } : undefined
});

test('requires a token and validates repository filters before making requests', async () => {
  let fetchCount = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => { fetchCount++; return jsonResponse([]); }) as typeof fetch;
  try {
    await assert.rejects(getGithubInbox(undefined, ''), (error: unknown) => error instanceof GithubInboxError && error.status === 400);
    await assert.rejects(getGithubInbox('owner/repo?state=all', 'secret'), (error: unknown) => error instanceof GithubInboxError && error.status === 400);
    await assert.rejects(getGithubInbox('https://github.com/owner/repo', 'secret'), (error: unknown) => error instanceof GithubInboxError && error.status === 400);
    assert.equal(fetchCount, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('lists recent repositories, sorts pull requests, marks link pagination, and reports partial repo failures', async () => {
  const oldFetch = globalThis.fetch;
  const authHeaders: string[] = [];
  const pulls = [
    { title: 'Older', html_url: 'https://github.com/acme/alpha/pull/1', number: 1, user: { login: 'sam' }, updated_at: '2026-10-01T00:00:00Z', draft: false, base: { repo: { full_name: 'acme/alpha' } } },
    { title: 'Newest', html_url: 'https://github.com/acme/alpha/pull/2', number: 2, user: null, updated_at: '2026-10-10T00:00:00Z', draft: true, base: { repo: { full_name: 'acme/alpha' } } }
  ];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    authHeaders.push(new Headers(init?.headers).get('Authorization') ?? '');
    if (url.includes('/user/repos?')) return jsonResponse([{ full_name: 'acme/alpha' }, { full_name: 'acme/beta' }], 200, true);
    if (url.includes('/repos/acme/alpha/pulls?')) return jsonResponse(pulls, 200, true);
    if (url.includes('/repos/acme/beta/pulls?')) return jsonResponse({ message: 'forbidden' }, 403);
    return jsonResponse({ message: 'not found' }, 404);
  }) as typeof fetch;
  try {
    const result = await getGithubInbox(undefined, 'secret-token');
    assert.deepEqual(result.repositories, ['acme/alpha', 'acme/beta']);
    assert.deepEqual(result.pulls.map((pull) => pull.title), ['Newest', 'Older']);
    assert.equal(result.pulls[0].author, 'unknown');
    assert.equal(result.pulls[0].draft, true);
    assert.equal(result.truncated, true);
    assert.ok(result.warnings.some((warning) => warning.includes('acme/beta')));
    assert.ok(result.warnings.some((warning) => warning.includes('additional repositories may be omitted')));
    assert.ok(result.warnings.some((warning) => warning.includes('additional pull requests may be omitted')));
    assert.ok(authHeaders.length > 0 && authHeaders.every((header) => header === 'Bearer secret-token'));
    assert.equal(JSON.stringify(result).includes('secret-token'), false);
  } finally { globalThis.fetch = oldFetch; }
});

test('repository filter fetches just that repository and propagates invalid token cleanly', async () => {
  const oldFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return jsonResponse([{ title: 'PR', html_url: 'https://github.com/acme/widget/pull/4', number: 4,
      user: { login: 'author' }, updated_at: '2026-10-15T00:00:00Z', draft: false,
      base: { repo: { full_name: 'acme/widget' } } }]);
  }) as typeof fetch;
  try {
    const result = await getGithubInbox('acme/widget', 'token');
    assert.deepEqual(result.repositories, ['acme/widget']);
    assert.equal(result.pulls[0].number, 4);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /state=open&sort=updated&direction=desc&per_page=30/);

    globalThis.fetch = (async () => jsonResponse({}, 401)) as typeof fetch;
    await assert.rejects(getGithubInbox(undefined, 'bad-token'), (error: unknown) =>
      error instanceof GithubInboxError && error.status === 401 && !error.message.includes('bad-token'));
  } finally { globalThis.fetch = oldFetch; }
});

test('limits simultaneous repository pull requests to four', async () => {
  const oldFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/user/repos?')) return jsonResponse(Array.from({ length: 8 }, (_, index) => ({ full_name: `acme/repo-${index}` })));
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return jsonResponse([]);
  }) as typeof fetch;
  try {
    await getGithubInbox(undefined, 'token');
    assert.equal(maxActive, 4);
  } finally { globalThis.fetch = oldFetch; }
});
