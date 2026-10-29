import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { INSTRUCTION_MAX } from '$lib/cli-commands';
import { parsePrParams } from '$lib/server/pr-page';
import { latestAnalysisForPr, replaceWorkflow } from '$lib/server/store';
import { regenerateWorkflow, workflowApiConfigured } from '$lib/server/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const pr = parsePrParams(params.owner, params.repo, params.number);
  if (!workflowApiConfigured()) return json({ error: 'The workflow model API is not configured.' }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { instruction?: unknown };
  const instruction = body?.instruction;
  if (instruction !== undefined && (typeof instruction !== 'string' || instruction.length > INSTRUCTION_MAX)) {
    return json({ error: `The instruction must be text of at most ${INSTRUCTION_MAX} characters.` }, { status: 400 });
  }
  const analysis = latestAnalysisForPr(`${pr.owner}/${pr.repo}`, pr.number);
  if (!analysis || analysis.status !== 'ready') return json({ error: 'There is no ready analysis for this pull request.' }, { status: 409 });
  const current = analysis.workflows.find((workflow) => workflow.id === params.workflowId);
  if (!current) return json({ error: 'Workflow not found.' }, { status: 404 });
  try {
    const workflow = await regenerateWorkflow(analysis.pr, current, instruction?.trim() || undefined);
    replaceWorkflow(analysis.id, current.id, analysis.headSha, workflow, 'api');
    return json({ analysisId: analysis.id, workflowId: current.id, stepCount: workflow.steps.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to recompute the workflow.' }, { status: 502 });
  }
};
