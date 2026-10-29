import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { AnalysisSource, AnalysisStatus, EntrypointKind, PullRequestSummary, ReviewFile, StepRange, UnassignedFile, Workflow, WorkflowStep } from '../types';
import { getPullRequestSummary } from './github';
import { latestAnalysisForPr, listAnalyses, viewsFor } from './store';
import { buildCliCommands, type CliCommands } from '../cli-commands';
import { isTestFile } from '../test-files';
import { progressOf, type WorkflowProgress } from '../viewed';
import { coverage, visibleWorkflows, workflowApiConfigured, workflowToMermaid, type Coverage } from './workflows';

export interface PrParams { owner: string; repo: string; number: number }
export interface WorkflowSummary { id: string; position: number; title: string; actor?: string; summary: string; entrypoint: { kind: EntrypointKind; label: string }; stepCount: number; viewed: number }

export interface FeatureGroup { feature: string; actor?: string; workflows: WorkflowSummary[] }

export interface PrCoverage extends Coverage { unassignedFiles: UnassignedFile[] }

export interface HistoryEntry {
  title: string; repository: string; number: number; url: string; author: string; headSha: string;
  status: AnalysisStatus; source: AnalysisSource | null; updatedAt: string;
  features: number; workflows: number; coverage: Coverage | null; analyses: number;
  review: { workflowsViewed: number; workflows: number; stepsViewed: number; steps: number };
}

export interface PrPageData {
  params: PrParams;
  pr: PullRequestSummary;
  analysis: { id: string; status: AnalysisStatus; source: AnalysisSource | null; headSha: string; updatedAt: string } | null;
  features: FeatureGroup[];
  coverage: PrCoverage | null;
  stale: boolean;
  setup: { githubConfigured: boolean; apiConfigured: boolean };
  cliCommands: Omit<CliCommands, 'recompute'>;
  cliSource: { url: string; launcher: string; skillDir: string; codexSkillDir: string };
}

export interface OtherUse { workflowId: string; title: string; step: number; ranges: StepRange[] }

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
  otherUses: OtherUse[];
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
const skillPath = () => path.resolve(process.cwd(), 'skills', 'trace');
const codexSkillPath = () => path.resolve(process.cwd(), 'skills', 'codex', 'trace');

export function cliCommands(params: PrParams): CliCommands {
  return buildCliCommands(prUrl(params), launcherPath(), skillPath(), codexSkillPath());
}

export function setupCommands(): Pick<CliCommands, 'register' | 'installSkill'> {
  const commands = buildCliCommands('', launcherPath(), skillPath(), codexSkillPath());
  return { register: commands.register, installSkill: commands.installSkill };
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

const prKey = (repository: string, number: number) => `${repository.toLowerCase()}#${number}`;

/** One entry per pull request, taken from the same analysis the PR page shows, newest first. */
export function analysisHistory(): HistoryEntry[] {
  const counts = new Map<string, number>();
  const firsts = new Map<string, { repository: string; number: number }>();
  for (const summary of listAnalyses()) {
    const key = prKey(summary.repository, summary.number);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!firsts.has(key)) firsts.set(key, summary);
  }
  const entries: HistoryEntry[] = [];
  for (const [key, { repository, number }] of firsts) {
    try {
      const analysis = latestAnalysisForPr(repository, number);
      if (!analysis) continue;
      const groups = groupByFeature(visibleWorkflows(analysis.workflows), viewsFor(analysis.id));
      const workflows = groups.flatMap((group) => group.workflows);
      entries.push({ title: analysis.pr.title, repository: analysis.repository, number: analysis.number, url: analysis.pr.url, author: analysis.pr.author,
        headSha: analysis.headSha.slice(0, 7), status: analysis.status, source: analysis.source, updatedAt: analysis.updatedAt,
        features: groups.length, workflows: workflows.length, coverage: analysis.status === 'ready' ? coverage(analysis) : null, analyses: counts.get(key) ?? 1,
        review: { workflows: workflows.length, workflowsViewed: workflows.filter((workflow) => workflow.stepCount > 0 && workflow.viewed === workflow.stepCount).length,
          stepsViewed: workflows.reduce((sum, workflow) => sum + workflow.viewed, 0), steps: workflows.reduce((sum, workflow) => sum + workflow.stepCount, 0) } });
    } catch { /* A corrupt analysis must not hide the others. */ }
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    cliCommands: { claude: commands.claude, codex: commands.codex, register: commands.register, installSkill: commands.installSkill },
    cliSource: { url: prUrl(params), launcher: launcherPath(), skillDir: skillPath(), codexSkillDir: codexSkillPath() }
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
    viewedPaths: workflow.steps.map((step) => step.path).filter((stepPath) => views.get(workflowId)?.has(stepPath)), progress,
    otherUses: workflows.filter((other) => other.id !== workflowId).flatMap((other) => other.steps.flatMap((otherStep, index) =>
      otherStep.path === current.path ? [{ workflowId: other.id, title: other.title, step: index + 1, ranges: otherStep.ranges ?? [] }] : []))
  };
}
