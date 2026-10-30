import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { commentableLines } from '$lib/diff-hunks';
import { createReviewComment, GithubError, listReviewComments } from '$lib/server/github';
import { parsePrParams } from '$lib/server/pr-page';
import { latestAnalysisForPr } from '$lib/server/store';
import type { NewReviewComment } from '$lib/types';

const MAX_BODY = 65_536;

function readyAnalysis(owner: string, repo: string, number: string) {
  const pr = parsePrParams(owner, repo, number);
  const analysis = latestAnalysisForPr(`${pr.owner}/${pr.repo}`, pr.number);
  return { pr, analysis: analysis?.status === 'ready' ? analysis : undefined };
}

const TOKEN_HINT = ' Check that GITHUB_TOKEN can access this repository, with Pull requests read and write permission.';

function failure(error: unknown): Response {
  const status = error instanceof GithubError ? error.status : 0;
  const message = error instanceof Error ? error.message : 'GitHub request failed.';
  return json({ error: [401, 403, 404].includes(status) ? message + TOKEN_HINT : message }, { status: status === 422 ? 422 : 502 });
}

const lineNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export const GET: RequestHandler = async ({ params, url }) => {
  const { pr, analysis } = readyAnalysis(params.owner, params.repo, params.number);
  if (!analysis) return json({ error: 'There is no ready analysis for this pull request.' }, { status: 409 });
  const filePath = url.searchParams.get('path') ?? '';
  if (!analysis.pr.files.some((file) => file.path === filePath)) return json({ error: 'The path is not a changed file of this pull request.' }, { status: 404 });
  try { return json({ comments: await listReviewComments(pr.owner, pr.repo, pr.number, filePath, analysis.headSha) }); }
  catch (error) { return failure(error); }
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!process.env.GITHUB_TOKEN?.trim()) return json({ error: 'Set GITHUB_TOKEN to post comments to GitHub.' }, { status: 400 });
  // A cross-site form can post text/plain without a CORS preflight; requiring JSON forces one.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'The body must be JSON.' }, { status: 415 });
  const { pr, analysis } = readyAnalysis(params.owner, params.repo, params.number);
  if (!analysis) return json({ error: 'There is no ready analysis for this pull request.' }, { status: 409 });
  const body = await request.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > MAX_BODY) return json({ error: `The comment must be 1 to ${MAX_BODY} characters.` }, { status: 400 });
  const file = analysis.pr.files.find((candidate) => candidate.path === body?.path);
  if (!file) return json({ error: 'The path is not a changed file of this pull request.' }, { status: 404 });
  const comment: NewReviewComment = { path: file.path, body: text };
  if (body?.line !== undefined) {
    const side = body.side;
    if (side !== 'LEFT' && side !== 'RIGHT') return json({ error: 'side must be "LEFT" or "RIGHT".' }, { status: 400 });
    if (!lineNumber(body.line) || (body.startLine !== undefined && (!lineNumber(body.startLine) || (body.startLine as number) >= (body.line as number)))) {
      return json({ error: 'line must be a positive integer and startLine a smaller one.' }, { status: 400 });
    }
    const lines = commentableLines(file.patch)[side];
    if (!lines.has(body.line as number) || (body.startLine !== undefined && !lines.has(body.startLine as number))) {
      return json({ error: 'The line is not part of the diff.' }, { status: 400 });
    }
    Object.assign(comment, { side, line: body.line, ...(body.startLine === undefined ? {} : { startLine: body.startLine }) });
  }
  try { return json({ comment: await createReviewComment(pr.owner, pr.repo, pr.number, analysis.headSha, comment) }, { status: 201 }); }
  catch (error) { return failure(error); }
};
