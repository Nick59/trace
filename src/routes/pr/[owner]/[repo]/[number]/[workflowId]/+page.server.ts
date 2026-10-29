import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const [owner, repo, number, workflowId] = [params.owner, params.repo, params.number, params.workflowId].map(encodeURIComponent);
  redirect(307, `/pr/${owner}/${repo}/${number}/${workflowId}/1`);
};
