import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { AnalysisSource, AnalysisStatus, EntrypointKind, PullRequestSummary, ReviewFile, Workflow, WorkflowStep } from '../types';
import { getPullRequestSummary } from './github';
import { latestAnalysisForPr } from './store';
import { workflowApiConfigured, workflowToMermaid } from './workflows';

export interface PrParams { owner: string; repo: string; number: number }
export interface WorkflowSummary { id: string; position: number; title: string; summary: string; entrypoint: { kind: EntrypointKind; label: string }; stepCount: number }
export interface CliCommands { claude: string; codex: string; register: { claude: string; codex: string } }

export interface PrPageData {
  params: PrParams;
  pr: PullRequestSummary;
  analysis: { id: string; status: AnalysisStatus; source: AnalysisSource | null; headSha: string; updatedAt: string } | null;
  workflows: WorkflowSummary[];
  stale: boolean;
  setup: { githubConfigured: boolean; apiConfigured: boolean };
  cliCommands: CliCommands;
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
  prev: number | null;
  next: number | null;
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

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export function cliCommands(params: PrParams): CliCommands {
  const launcher = shellQuote(path.resolve(process.cwd(), 'scripts', 'mcp-launch.mjs'));
  const url = `https://github.com/${params.owner}/${params.repo}/pull/${params.number}`;
  const prompt = shellQuote(`Use the Trace MCP server: follow the trace_workflows prompt for ${url}, then submit the workflows with trace_submit_workflows. Do not modify the repository or post to GitHub.`);
  return {
    claude: `claude ${prompt}`,
    codex: `codex ${prompt}`,
    register: { claude: `claude mcp add trace -- node ${launcher}`, codex: `codex mcp add trace -- node ${launcher}` }
  };
}

async function currentSummary(params: PrParams): Promise<PullRequestSummary | undefined> {
  try { return await getPullRequestSummary(params.owner, params.repo, params.number); }
  catch { return undefined; }
}

function summaryOf(pr: PullRequestSummary): PullRequestSummary {
  const { title, url, repository, number, author, base, head, headSha } = pr;
  return { title, url, repository, number, author, base, head, headSha };
}

export async function loadPrPage(owner: string, repo: string, number: string | number): Promise<PrPageData> {
  const params = parsePrParams(owner, repo, number);
  const analysis = latestAnalysisForPr(`${params.owner}/${params.repo}`, params.number);
  const live = configured(process.env.GITHUB_TOKEN) || !analysis ? await currentSummary(params) : undefined;
  const pr = live ?? (analysis ? summaryOf(analysis.pr) : undefined);
  if (!pr) error(404, 'Pull request not found, or GitHub could not be reached.');
  return {
    params, pr,
    analysis: analysis ? { id: analysis.id, status: analysis.status, source: analysis.source, headSha: analysis.headSha, updatedAt: analysis.updatedAt } : null,
    workflows: (analysis?.workflows ?? []).map((workflow) => ({ id: workflow.id, position: workflow.position, title: workflow.title,
      summary: workflow.summary, entrypoint: workflow.entrypoint, stepCount: workflow.steps.length })),
    stale: Boolean(live && analysis && live.headSha !== analysis.headSha),
    setup: { githubConfigured: configured(process.env.GITHUB_TOKEN), apiConfigured: workflowApiConfigured() },
    cliCommands: cliCommands(params)
  };
}

export function loadWorkflowStep(owner: string, repo: string, number: string | number, workflowId: string, step: string | number): WorkflowStepData {
  const params = parsePrParams(owner, repo, number);
  const analysis = latestAnalysisForPr(`${params.owner}/${params.repo}`, params.number);
  const workflow = analysis?.status === 'ready' ? analysis.workflows.find((candidate) => candidate.id === workflowId) : undefined;
  if (!analysis || !workflow) error(404, 'Workflow not found.');
  const stepNumber = typeof step === 'number' ? step : /^\d{1,4}$/.test(step) ? Number(step) : NaN;
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > workflow.steps.length) error(404, 'Step not found.');
  const current = workflow.steps[stepNumber - 1];
  return {
    params, pr: summaryOf(analysis.pr), workflow, stepNumber, stepCount: workflow.steps.length, step: current,
    mermaid: workflowToMermaid(workflow), file: analysis.pr.files.find((file) => file.path === current.path),
    prev: stepNumber > 1 ? stepNumber - 1 : null, next: stepNumber < workflow.steps.length ? stepNumber + 1 : null
  };
}
