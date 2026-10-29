import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGithubInbox, GithubInboxError } from '$lib/server/github-inbox';

export const GET: RequestHandler = async ({ url }) => {
  const repo = url.searchParams.get('repo') ?? undefined;
  try {
    return json(await getGithubInbox(repo), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof GithubInboxError) {
      return json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    }
    return json({ error: 'Unable to load GitHub pull requests.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};
