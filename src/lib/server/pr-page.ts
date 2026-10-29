import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { AnalysisSource, AnalysisStatus, EntrypointKind, PullRequestSummary, ReviewFile, UnassignedFile, Workflow, WorkflowStep } from '../types';
import { getPullRequestSummary } from './github';
import { latestAnalysisForPr, viewsFor } from './store';
import { buildCliCommands, type CliCommands } from '../cli-commands';
import { isTestFile } from '../test-files';
import { progressOf, type WorkflowProgress } from '../viewed';
import { coverage, visibleWorkflows, workflowApiConfigured, workflowToMermaid, type Coverage } from './workflows';

export interface PrParams { owner: string; repo: string; number: number }
export interface WorkflowSummary { id: string; position: number; title: string; actor?: string; summary: string; entrypoint: { kind: EntrypointKind; label: string }; stepCount: number; viewed: number }

export interface FeatureGroup { feature: string; actor?: string; workflows: WorkflowSummary[] }

export interface PrCoverage extends Coverage { unassignedFiles: UnassignedFile[] }

export interface PrPageData {
  params: PrParams;
  pr: PullRequestSummary;
  analysis: { id: string; status: AnalysisStatus; source: AnalysisSource | null; headSha: string; updatedAt: string } | null;
  features: FeatureGroup[];
  coverage: PrCoverage | null;
  stale: boolean;
  setup: { githubConfigured: boolean; apiConfigured: boolean };
  cliCommands: Omit<CliCommands, 'recompute'>;
  cliSource: { url: string; launcher: string };
}

export interface WorkflowStepData {
  params: PrParams;
  pr: PullRequestSummary;
  workflow: Workflow;
  stepNumber: number;
  stepCount: number;
  step: WorkflowStep;
  mermaid: string;
  file: ReviewFile | undefined;
  files: ReviewFile[];
  prev: number | null;
  next: number | null;
  viewedPaths: string[];
  progress: WorkflowProgress[];
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function parsePrParams(owner: string, repo: string, number: string | number): PrParams {
  const value = typeof number === 'number' ? number : /^\d{1,9}$/.test(number) ? Number(number) : NaN;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..' || !Number.isSafeInteger(value) || value <= 0) {
    error(400, 'Invalid pull request address.');
  }
  return { owner, repo, number: value };
}

const configured = (value: string | undefined) => Boolean(value?.trim() && !value.includes('replace_me'));

const prUrl = (params: PrParams) => `https://github.com/${params.owner}/${params.repo}/pull/${params.number}`;
const launcherPath = () => path.resolve(process.cwd(), 'scripts', 'mcp-launch.mjs');

export function cliCommands(params: PrParams): CliCommands {
  return buildCliCommands(prUrl(params), launcherPath());
}

async function currentSummary(params: PrParams): Promise<PullRequestSummary | undefined> {
  try { return await getPullRequestSummary(params.owner, params.repo, params.number); }
  catch { return undefined; }
}

function summaryOf(pr: PullRequestSummary): PullRequestSummary {
  const { title, url, repository, number, author, base, head, headSha } = pr;
  return { title, url, repository, number, author, base, head, headSha };
}

// Analyses stored before features existed have no feature text; each such workflow forms a group titled after itself.
function groupByFeature(workflows: Workflow[], views: Map<string, Set<string>>): FeatureGroup[] {
  const groups = new Map<string, FeatureGroup>();
  for (const workflow of workflows) {
    const feature = workflow.feature ?? workflow.title;
    const summary: WorkflowSummary = { id: workflow.id, position: workflow.position, title: workflow.title, ...(workflow.actor ? { actor: workflow.actor } : {}),
      summary: workflow.summary, entrypoint: workflow.entrypoint, stepCount: workflow.steps.length,
      viewed: progressOf(workflow.steps.map((step) => step.path), views.get(workflow.id) ?? new Set()).viewed };
    const group = groups.get(feature);
    if (group) group.workflows.push(summary);
    else groups.set(feature, { feature, ...(workflow.actor ? { actor: workflow.actor } : {}), workflows: [summary] });
  }
  return [...groups.values()];
}

export async function loadPrPage(owner: string, repo: string, number: string | number): Promise<PrPageData> {
  const params = parsePrParams(owner, repo, number);
  const commands = cliCommands(params);
  const analysis = latestAnalysisForPr(`${params.owner}/${params.repo}`, params.number);
  const live = configured(process.env.GITHUB_TOKEN) || !analysis ? await currentSummary(params) : undefined;
  const pr = live ?? (analysis ? summaryOf(analysis.pr) : undefined);
  if (!pr) error(404, 'Pull request not found, or GitHub could not be reached.');
  return {
    params, pr,
    analysis: analysis ? { id: analysis.id, status: analysis.status, source: analysis.source, headSha: analysis.headSha, updatedAt: analysis.updatedAt } : null,
    features: groupByFeature(analysis ? visibleWorkflows(analysis.workflows) : [], analysis ? viewsFor(analysis.id) : new Map()),
    coverage: analysis?.status === 'ready' ? { ...coverage(analysis), unassignedFiles: analysis.unassigned.filter((entry) => !isTestFile(entry.path)) } : null,
    stale: Boolean(live && analysis && live.headSha !== analysis.headSha),
    setup: { githubConfigured: configured(process.env.GITHUB_TOKEN), apiConfigured: workflowApiConfigured() },
    cliCommands: { claude: commands.claude, codex: commands.codex, register: commands.register },
    cliSource: { url: prUrl(params), launcher: launcherPath() }
  };
}

export function loadWorkflowStep(owner: string, repo: string, number: string | number, workflowId: string, step: string | number): WorkflowStepData {
  const params = parsePrParams(owner, repo, number);
  const analysis = latestAnalysisForPr(`${params.owner}/${params.repo}`, params.number);
  const workflows = analysis?.status === 'ready' ? visibleWorkflows(analysis.workflows) : [];
  const workflow = workflows.find((candidate) => candidate.id === workflowId);
  if (!analysis || !workflow) error(404, 'Workflow not found.');
  const stepNumber = typeof step === 'number' ? step : /^\d{1,4}$/.test(step) ? Number(step) : NaN;
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > workflow.steps.length) error(404, 'Step not found.');
  const current = workflow.steps[stepNumber - 1];
  const views = viewsFor(analysis.id);
  const progress = groupByFeature(workflows, views).flatMap((group) => group.workflows.map((summary): WorkflowProgress => {
    const found = workflows.find((candidate) => candidate.id === summary.id)!;
    return { id: found.id, title: found.title, feature: group.feature, ...progressOf(found.steps.map((step) => step.path), views.get(found.id) ?? new Set()) };
  }));
  return {
    params, pr: summaryOf(analysis.pr), workflow, stepNumber, stepCount: workflow.steps.length, step: current,
    mermaid: workflowToMermaid(workflow), file: analysis.pr.files.find((file) => file.path === current.path),
    files: [current.path, ...current.paths].flatMap((filePath) => analysis.pr.files.find((file) => file.path === filePath) ?? []),
    prev: stepNumber > 1 ? stepNumber - 1 : null, next: stepNumber < workflow.steps.length ? stepNumber + 1 : null,
    viewedPaths: workflow.steps.map((step) => step.path).filter((stepPath) => views.get(workflowId)?.has(stepPath)), progress
  };
}
