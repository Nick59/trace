import type { PageServerLoad } from './$types';
import { loadWorkflowStep } from '$lib/server/pr-page';

export const load: PageServerLoad = ({ params }) => {
  const data = loadWorkflowStep(params.owner, params.repo, params.number, params.workflowId, params.step);
  const prPath = `/pr/${data.params.owner}/${data.params.repo}/${data.params.number}`;
  return {
    ...data,
    prPath,
    githubUrl: data.pr.url,
    crumbs: [
      { label: data.pr.repository, href: '/' },
      { label: `#${data.pr.number}`, href: prPath },
      { label: data.workflow.title }
    ]
  };
};
