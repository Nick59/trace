import { createHash } from 'node:crypto';
import type { CommentSide, NewReviewComment, PullRequestSnapshot, PullRequestSummary, ReviewComment, ReviewFile } from '../types';

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

type GithubComment = {
  id: number; body: string; html_url: string; created_at: string; path: string; commit_id: string; original_commit_id: string;
  line: number | null; original_line: number | null; start_line: number | null; original_start_line: number | null;
  side: CommentSide | null; subject_type?: 'line' | 'file'; in_reply_to_id?: number; user: { login: string } | null;
};

export class GithubError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function github<T>(url: string, token?: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, { method: init.method, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  if (!response.ok) {
    const detail = response.status === 422 ? await response.json().then((value: { message?: unknown; errors?: unknown }) =>
      [value.message, JSON.stringify(value.errors ?? '')].filter((part) => typeof part === 'string' && part && part !== '""').join(' ').slice(0, 300)).catch(() => '') : '';
    const message = response.status === 404 ? 'Pull request or repository was not found.'
      : response.status === 401 || response.status === 403 ? 'GitHub denied access or rate limited this request.'
      : response.status === 422 ? `GitHub rejected the request${detail ? `: ${detail}` : '.'}`
      : `GitHub request failed (${response.status}).`;
    throw new GithubError(message, response.status);
  }
  return response.json() as Promise<T>;
}

/** GitHub anchors each file of the "Files changed" tab with `#diff-` plus the SHA-256 of its path. */
export function prFileUrl(prUrl: string, filePath: string): string {
  return `${prUrl}/files#diff-${createHash('sha256').update(filePath).digest('hex')}`;
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

function toComment(raw: GithubComment, headSha: string): ReviewComment {
  const current = raw.commit_id === headSha;
  const original = !current && raw.original_commit_id === headSha;
  const line = current ? raw.line : original ? raw.original_line : null;
  const startLine = current ? raw.start_line : original ? raw.original_start_line : null;
  return {
    id: raw.id, author: raw.user?.login ?? 'unknown', body: raw.body, url: raw.html_url, createdAt: raw.created_at, path: raw.path,
    side: raw.side ?? 'RIGHT', line: raw.subject_type === 'file' ? null : line, startLine: raw.subject_type === 'file' ? null : startLine,
    file: raw.subject_type === 'file', replyTo: raw.in_reply_to_id ?? null
  };
}

/** `line` is null when the comment targets the file or does not map onto `headSha`, the commit the stored diff shows. */
export async function listReviewComments(owner: string, repo: string, number: number, filePath: string, headSha: string, token = process.env.GITHUB_TOKEN): Promise<ReviewComment[]> {
  const result: ReviewComment[] = [];
  for (let page = 1; page <= 10; page++) {
    const chunk = await github<GithubComment[]>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/comments?per_page=100&page=${page}`, token);
    for (const raw of chunk) if (raw.path === filePath) result.push(toComment(raw, headSha));
    if (chunk.length < 100) break;
  }
  return result;
}

export async function createReviewComment(owner: string, repo: string, number: number, headSha: string, comment: NewReviewComment, token = process.env.GITHUB_TOKEN): Promise<ReviewComment> {
  const target = comment.line === undefined
    ? { subject_type: 'file' }
    : { line: comment.line, side: comment.side, ...(comment.startLine === undefined ? {} : { start_line: comment.startLine, start_side: comment.side }) };
  const raw = await github<GithubComment>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/comments`, token, {
    method: 'POST', body: { body: comment.body, commit_id: headSha, path: comment.path, ...target }
  });
  return toComment(raw, headSha);
}
