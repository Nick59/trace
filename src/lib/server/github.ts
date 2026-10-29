import type { PullRequestSnapshot, PullRequestSummary, ReviewFile } from '../types';

const API = 'https://api.github.com';
const MAX_FILES = 300;
const MAX_SOURCE_FILES = 35;
const MAX_FILE_BYTES = 48_000;
const MAX_TOTAL_SOURCE_BYTES = 420_000;
const FETCH_TIMEOUT_MS = 15_000;

type GithubPull = {
  title: string; html_url: string; number: number; body: string | null;
  user: { login: string } | null;
  base: { ref: string; repo: { full_name: string } };
  head: { ref: string; sha: string };
};
type GithubFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };

async function github<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  } });
  if (!response.ok) {
    const message = response.status === 404 ? 'Pull request or repository was not found.'
      : response.status === 401 || response.status === 403 ? 'GitHub denied access or rate limited this request.'
      : `GitHub request failed (${response.status}).`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function prCoordinates(input: string): { owner: string; repo: string; number: number; canonicalUrl: string } {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter a valid GitHub pull request URL.'); }
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error('Only github.com pull request URLs are supported.');
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i);
  if (!match) throw new Error('Enter a GitHub URL in the form github.com/owner/repository/pull/number.');
  const [, owner, repo, num] = match;
  const number = Number(num);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('The pull request number is invalid.');
  return { owner, repo: repo.replace(/\.git$/i, ''), number, canonicalUrl: `https://github.com/${owner}/${repo}/pull/${number}` };
}

async function fetchFiles(owner: string, repo: string, number: number, token?: string): Promise<GithubFile[]> {
  const result: GithubFile[] = [];
  for (let page = 1; page <= 10 && result.length < MAX_FILES; page++) {
    const chunk = await github<GithubFile[]>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100&page=${page}`, token);
    result.push(...chunk.slice(0, MAX_FILES - result.length));
    if (chunk.length < 100) break;
  }
  return result;
}

async function fetchSource(owner: string, repo: string, sha: string, path: string, token?: string): Promise<string | undefined> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const rawUrl = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github.raw' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (response.status === 404) return undefined;
  if (!response.ok) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size <= MAX_FILE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FILE_BYTES) { await reader.cancel(); return undefined; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('\u0000')) return undefined;
  return text;
}

function isSourceCandidate(file: GithubFile): boolean {
  return file.status !== 'removed' && !file.filename.endsWith('/') &&
    !/(^|\/)(node_modules|vendor|dist|build|\.git)(\/|$)/i.test(file.filename) &&
    !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|lock)$/i.test(file.filename);
}

export async function loadPullRequest(input: string, token = process.env.GITHUB_TOKEN): Promise<PullRequestSnapshot> {
  const coords = prCoordinates(input);
  const [pull, rawFiles] = await Promise.all([
    github<GithubPull>(`${API}/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/pulls/${coords.number}`, token),
    fetchFiles(coords.owner, coords.repo, coords.number, token)
  ]);
  const warnings: string[] = [];
  const files: ReviewFile[] = rawFiles.map((file) => ({
    path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions,
    patch: file.patch ?? '[Diff unavailable: GitHub omitted this patch, often for binary or very large files.]'
  }));
  if (rawFiles.length >= MAX_FILES) warnings.push(`Showing the first ${MAX_FILES} changed files.`);
  let sourceBytes = 0;
  const candidates = rawFiles.filter(isSourceCandidate).slice(0, MAX_SOURCE_FILES);
  for (const candidate of candidates) {
    if (sourceBytes >= MAX_TOTAL_SOURCE_BYTES) break;
    const source = await fetchSource(coords.owner, coords.repo, pull.head.sha, candidate.filename, token);
    if (source === undefined) continue;
    const bytes = new TextEncoder().encode(source).byteLength;
    if (sourceBytes + bytes > MAX_TOTAL_SOURCE_BYTES) continue;
    sourceBytes += bytes;
    const target = files.find((file) => file.path === candidate.filename);
    if (target) target.source = source;
  }
  if (candidates.length < rawFiles.filter(isSourceCandidate).length || sourceBytes >= MAX_TOTAL_SOURCE_BYTES) {
    warnings.push('Source context was bounded; some changed files are represented by their diff only.');
  }
  return {
    title: pull.title, url: coords.canonicalUrl, repository: pull.base.repo.full_name, number: pull.number,
    author: pull.user?.login ?? 'unknown', base: pull.base.ref, head: pull.head.ref, headSha: pull.head.sha,
    description: pull.body ?? '', files, warnings
  };
}

export async function getPullRequestSummary(owner: string, repo: string, number: number, token = process.env.GITHUB_TOKEN): Promise<PullRequestSummary> {
  const pull = await github<GithubPull>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, token);
  return {
    title: pull.title, url: `https://github.com/${owner}/${repo}/pull/${number}`, repository: pull.base.repo.full_name, number: pull.number,
    author: pull.user?.login ?? 'unknown', base: pull.base.ref, head: pull.head.ref, headSha: pull.head.sha
  };
}
