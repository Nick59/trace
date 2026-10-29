import { analysisHistory } from '$lib/server/pr-page';

export function load() {
  const configured = (value: string | undefined) => Boolean(value?.trim() && !value.includes('replace_me'));
  const history = analysisHistory();
  const reviews: Record<string, { workflowsViewed: number; workflows: number }> = {};
  for (const entry of history) {
    if (entry.status === 'ready' && entry.review.workflows > 0) {
      reviews[`${entry.repository.toLowerCase()}#${entry.number}`] = { workflowsViewed: entry.review.workflowsViewed, workflows: entry.review.workflows };
    }
  }
  return { setup: { githubConfigured: configured(process.env.GITHUB_TOKEN) }, history, reviews };
}
