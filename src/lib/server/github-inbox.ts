const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REPOSITORIES = 20;
const MAX_PULLS_PER_REPOSITORY = 30;
const CONCURRENCY = 4;

export interface InboxPull {
  title: string;
  url: string;
  repository: string;
  number: number;
  author: string;
  updatedAt: string;
  draft: boolean;
}

export interface GithubInbox {
  pulls: InboxPull[];
  repositories: string[];
  truncated: boolean;
  warnings: string[];
}

export class GithubInboxError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

interface GithubRepo { full_name: string; }
interface GithubPull {
  title: string;
  html_url: string;
  number: number;
  user: { login: string } | null;
  updated_at: string;
  draft: boolean;
  base: { repo: { full_name: string } };
}

export function validateRepositoryFilter(input: string): { owner: string; repo: string; fullName: string } {
  const match = input.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/);
  if (!match || match[2] === '.' || match[2] === '..') throw new GithubInboxError('Use a repository name in owner/repository form.', 400);
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

async function requestJson<T>(url: string, token: string): Promise<{ data: T; hasNext: boolean }> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`
    } });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new GithubInboxError('GitHub request timed out. Try again shortly.', 504);
    throw new GithubInboxError('Unable to reach GitHub. Try again shortly.', 502);
  }
  if (response.status === 401) throw new GithubInboxError('GitHub rejected GITHUB_TOKEN. Check that the token is valid.', 401);
  if (!response.ok) throw new GithubInboxError(`GitHub returned HTTP ${response.status}.`, response.status === 403 ? 403 : 502);
  try {
    return { data: await response.json() as T, hasNext: /<[^>]+>\s*;\s*rel="next"/i.test(response.headers.get('link') ?? '') };
  }
  catch { throw new GithubInboxError('GitHub returned an unreadable response.', 502); }
}

async function mapConcurrent<T, R>(items: T[], limit: number, callback: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await callback(items[index]);
    }
  });
  await Promise.all(workers);
  return result;
}

function normalizePull(pull: GithubPull, repository: string): InboxPull {
  return { title: pull.title, url: pull.html_url, repository: pull.base?.repo?.full_name ?? repository,
    number: pull.number, author: pull.user?.login ?? 'unknown', updatedAt: pull.updated_at, draft: Boolean(pull.draft) };
}

async function getOpenPulls(repository: string, token: string): Promise<{ pulls: GithubPull[]; hasNext: boolean }> {
  const [owner, repo] = repository.split('/');
  const page = await requestJson<GithubPull[]>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&sort=updated&direction=desc&per_page=${MAX_PULLS_PER_REPOSITORY}&page=1`, token);
  if (!Array.isArray(page.data)) throw new GithubInboxError('GitHub returned an invalid pull request list.', 502);
  return { pulls: page.data, hasNext: page.hasNext };
}

export async function getGithubInbox(repoFilter?: string, token = process.env.GITHUB_TOKEN): Promise<GithubInbox> {
  if (!token?.trim()) throw new GithubInboxError('GITHUB_TOKEN is required to list GitHub pull requests.', 400);
  token = token.trim();
  let repositories: string[];
  let truncated = false;
  if (repoFilter !== undefined) {
    const { fullName } = validateRepositoryFilter(repoFilter);
    repositories = [fullName];
  } else {
    const listed = await requestJson<GithubRepo[]>(`${API}/user/repos?sort=pushed&direction=desc&per_page=${MAX_REPOSITORIES}&page=1`, token);
    if (!Array.isArray(listed.data)) throw new GithubInboxError('GitHub returned an invalid repository list.', 502);
    repositories = listed.data.slice(0, MAX_REPOSITORIES).map((repo) => repo.full_name).filter((name) => typeof name === 'string' && name.includes('/'));
    if (listed.hasNext) truncated = true;
  }

  const warnings: string[] = [];
  const results = await mapConcurrent(repositories, CONCURRENCY, async (repository) => {
    try {
      const result = await getOpenPulls(repository, token);
      if (result.hasNext) truncated = true;
      return result.pulls.slice(0, MAX_PULLS_PER_REPOSITORY).map((pull) => normalizePull(pull, repository));
    } catch (error) {
      if (error instanceof GithubInboxError && error.status === 401) throw error;
      warnings.push(`Could not load open pull requests for ${repository}${error instanceof GithubInboxError ? ` (GitHub HTTP ${error.status})` : ''}.`);
      return [];
    }
  });

  const pulls = results.flat().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (truncated && !repoFilter) warnings.push(`Showing at most ${MAX_REPOSITORIES} recently pushed repositories; additional repositories may be omitted.`);
  if (truncated) warnings.push(`Showing at most ${MAX_PULLS_PER_REPOSITORY} open pull requests per repository; additional pull requests may be omitted.`);
  return { pulls, repositories, truncated, warnings };
}
