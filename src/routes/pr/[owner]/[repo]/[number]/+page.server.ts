import type { PageServerLoad } from './$types';
import { loadPrPage } from '$lib/server/pr-page';

export const load: PageServerLoad = async ({ params }) => {
  const data = await loadPrPage(params.owner, params.repo, params.number);
  return {
    ...data,
    githubUrl: data.pr.url,
    crumbs: [{ label: data.pr.repository, href: '/' }, { label: `#${data.pr.number} ${data.pr.title}` }]
  };
};
