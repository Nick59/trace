import type { PageServerLoad } from './$types';
import { prFileUrl } from '$lib/server/github';
import { loadWorkflowStep } from '$lib/server/pr-page';

export const load: PageServerLoad = ({ params }) => {
  const data = loadWorkflowStep(params.owner, params.repo, params.number, params.workflowId, params.step);
  const prPath = `/pr/${data.params.owner}/${data.params.repo}/${data.params.number}`;
  const paths = new Set([data.step.path, ...data.files.map((file) => file.path)]);
  return {
    ...data,
    prPath,
    githubUrl: data.pr.url,
    githubFileUrls: Object.fromEntries([...paths].map((filePath) => [filePath, prFileUrl(data.pr.url, filePath)])),
    canComment: Boolean(process.env.GITHUB_TOKEN?.trim()),
    crumbs: [
      { label: data.pr.repository, href: '/' },
      { label: `#${data.pr.number}`, href: prPath },
      { label: data.workflow.title }
    ]
  };
};
