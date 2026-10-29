import { json } from '@sveltejs/kit';
import type { RequestEvent, RequestHandler } from './$types';
import { parsePrParams } from '$lib/server/pr-page';
import { latestAnalysisForPr, markViewed, unmarkViewed, viewsFor } from '$lib/server/store';
import { visibleWorkflows } from '$lib/server/workflows';

async function change(event: RequestEvent, apply: typeof markViewed): Promise<Response> {
  const pr = parsePrParams(event.params.owner, event.params.repo, event.params.number);
  const body = await event.request.json().catch(() => undefined) as { path?: unknown } | undefined;
  if (typeof body?.path !== 'string' || body.path.length === 0 || body.path.length > 1024) return json({ error: 'The body must be {"path": string}.' }, { status: 400 });
  const analysis = latestAnalysisForPr(`${pr.owner}/${pr.repo}`, pr.number);
  if (!analysis || analysis.status !== 'ready') return json({ error: 'There is no ready analysis for this pull request.' }, { status: 409 });
  const workflow = visibleWorkflows(analysis.workflows).find((candidate) => candidate.id === event.params.workflowId);
  if (!workflow) return json({ error: 'Workflow not found.' }, { status: 404 });
  const paths = workflow.steps.map((step) => step.path);
  if (!paths.includes(body.path)) return json({ error: 'The path is not a step of this workflow.' }, { status: 404 });
  apply(analysis.id, workflow.id, body.path);
  const viewed = viewsFor(analysis.id).get(workflow.id) ?? new Set<string>();
  return json({ viewed: paths.filter((path) => viewed.has(path)).length, total: paths.length });
}

export const PUT: RequestHandler = (event) => change(event, markViewed);
export const DELETE: RequestHandler = (event) => change(event, unmarkViewed);
