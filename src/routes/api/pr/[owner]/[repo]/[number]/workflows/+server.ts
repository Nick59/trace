import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadPullRequest } from '$lib/server/github';
import { parsePrParams } from '$lib/server/pr-page';
import { createDraft, submitWorkflows } from '$lib/server/store';
import { generateWorkflows, workflowApiConfigured, WorkflowGenerationError } from '$lib/server/workflows';

export const POST: RequestHandler = async ({ params }) => {
  const pr = parsePrParams(params.owner, params.repo, params.number);
  if (!workflowApiConfigured()) return json({ error: 'The workflow model API is not configured.' }, { status: 400 });
  try {
    const snapshot = await loadPullRequest(`https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`);
    const draft = createDraft(snapshot);
    const analysis = submitWorkflows(draft.id, draft.headSha, await generateWorkflows(snapshot), 'api');
    return json({ analysisId: analysis.id, workflowCount: analysis.workflows.length }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate workflows.';
    const status = error instanceof WorkflowGenerationError ? 502 : /not found/i.test(message) ? 404 : 502;
    return json({ error: message }, { status });
  }
};
