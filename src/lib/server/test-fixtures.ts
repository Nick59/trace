import type { PullRequestSnapshot } from '../types';

export function samplePr(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return { title: 'Track request flow', url: 'https://github.com/acme/widget/pull/7', repository: 'acme/widget', number: 7,
    author: 'dev', base: 'main', head: 'feature', headSha: '0123456789abcdef', description: 'Example', warnings: [], files: [
      { path: 'src/api/route.ts', status: 'modified', additions: 2, deletions: 1, patch: '+export function GET() {}', source: 'export function GET() {}' },
      { path: 'src/core/service.ts', status: 'modified', additions: 5, deletions: 2, patch: '+export function process() {}' }
    ], ...overrides };
}

export const sampleWorkflows = [{ title: 'GET /widgets', summary: 'Lists widgets.', entrypoint: { kind: 'http', label: 'GET /widgets' }, steps: [
  { title: 'Route', summary: 'Accepts the request.', path: 'src/api/route.ts', symbols: ['GET'], checks: ['Check the request shape.'] },
  { title: 'Service', summary: 'Does the work.', path: 'src/core/service.ts', symbols: [], checks: [] }
] }];
