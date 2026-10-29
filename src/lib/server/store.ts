import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Analysis, AnalysisSource, AnalysisStatus, PullRequestSnapshot, UnassignedFile, Workflow } from '../types';
import { coverageError, patchesOf, rangeError, testStepMessage, testStepPath, validUnassigned, validWorkflow, validWorkflows } from './workflows';

export interface AnalysisSummary { id: string; title: string; repository: string; number: number; headSha: string; status: AnalysisStatus; source: AnalysisSource | null; workflowCount: number; updatedAt: string }

const MAX_RECORD_BYTES = 5 * 1024 * 1024;
const SCHEMA_VERSION = 4;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const databases = new Map<string, DatabaseSync>();

function databasePath(): string {
  return path.join(path.resolve(process.env.TRACE_DATA_DIR || path.join(process.cwd(), '.trace')), 'trace.db');
}

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Older databases lack the columns added for business workflows (v2: actor, unassigned) and features (v3); v4 adds the step_views table, created with the other tables. The web app and the MCP server can both
// start at once, so the check and the version bump run inside one write transaction.
function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    addColumn(db, 'analyses', 'unassigned_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, 'workflows', 'actor', 'TEXT');
    addColumn(db, 'workflows', 'feature', 'TEXT');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function open(): DatabaseSync {
  const file = databasePath();
  const cached = databases.get(file);
  if (cached) return cached;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  // The web app and the MCP server both open this file, so wait for a competing writer instead of failing.
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > SCHEMA_VERSION) { db.close(); throw new Error('The Trace database was created by a newer version.'); }
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY, repository TEXT NOT NULL, number INTEGER NOT NULL, head_sha TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'ready')), source TEXT CHECK (source IN ('agent', 'api')),
      pr_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, unassigned_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS analyses_pr ON analyses (repository COLLATE NOCASE, number, updated_at);
    CREATE TABLE IF NOT EXISTS workflows (
      analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL,
      title TEXT NOT NULL, feature TEXT, actor TEXT, entrypoint_kind TEXT NOT NULL, entrypoint_label TEXT NOT NULL, summary TEXT NOT NULL,
      steps_json TEXT NOT NULL, edges_json TEXT NOT NULL, PRIMARY KEY (analysis_id, id)
    );
    CREATE TABLE IF NOT EXISTS step_views (
      analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE, workflow_id TEXT NOT NULL, step_path TEXT NOT NULL, viewed_at TEXT NOT NULL,
      PRIMARY KEY (analysis_id, workflow_id, step_path)
    );
  `);
  if (version < SCHEMA_VERSION) migrate(db);
  chmodSync(file, 0o600);
  databases.set(file, db);
  return db;
}

export function closeStore(): void {
  for (const db of databases.values()) db.close();
  databases.clear();
}

function assertId(id: string): void {
  if (!uuidPattern.test(id)) throw new Error('Invalid analysis id.');
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isSnapshot(value: unknown): value is PullRequestSnapshot {
  if (!isObject(value)) return false;
  for (const key of ['title', 'url', 'repository', 'author', 'base', 'head', 'headSha', 'description']) if (typeof value[key] !== 'string') return false;
  return typeof value.number === 'number' && Number.isSafeInteger(value.number) &&
    Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === 'string') &&
    Array.isArray(value.files) && value.files.every((file) => isObject(file) && typeof file.path === 'string' && file.path.length > 0 &&
      file.path.length <= 1024 && typeof file.status === 'string' && typeof file.additions === 'number' && typeof file.deletions === 'number' &&
      typeof file.patch === 'string' && (file.source === undefined || typeof file.source === 'string'));
}

type Row = Record<string, string | number | null>;

function readWorkflows(db: DatabaseSync, analysisId: string, snapshot: PullRequestSnapshot): Workflow[] {
  const rows = db.prepare('SELECT * FROM workflows WHERE analysis_id = ? ORDER BY position').all(analysisId) as Row[];
  if (rows.length === 0) return [];
  const raw = rows.map((row) => ({ title: row.title, feature: row.feature ?? undefined, actor: row.actor ?? undefined, summary: row.summary, entrypoint: { kind: row.entrypoint_kind, label: row.entrypoint_label },
    steps: JSON.parse(String(row.steps_json)), edges: JSON.parse(String(row.edges_json)) }));
  const workflows = validWorkflows(raw, new Set(snapshot.files.map((file) => file.path)));
  if (!workflows) throw new Error('Stored workflows are invalid.');
  return workflows;
}

function toAnalysis(db: DatabaseSync, row: Row): Analysis {
  const pr = JSON.parse(String(row.pr_json)) as unknown;
  if (!isSnapshot(pr)) throw new Error('Stored analysis has an invalid format.');
  const workflows = readWorkflows(db, String(row.id), pr);
  const unassigned = validUnassigned(JSON.parse(String(row.unassigned_json ?? '[]')), new Set(pr.files.map((file) => file.path)));
  if (!unassigned) throw new Error('Stored unassigned files are invalid.');
  const status = row.status as AnalysisStatus;
  if ((status === 'ready') !== (workflows.length > 0)) throw new Error('Stored analysis has an invalid state.');
  return { id: String(row.id), repository: String(row.repository), number: Number(row.number), headSha: String(row.head_sha), status,
    source: (row.source as AnalysisSource | null) ?? null, pr, workflows, unassigned, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function createDraft(pr: PullRequestSnapshot): Analysis {
  if (!isSnapshot(pr)) throw new Error('Pull request snapshot has an invalid format.');
  const serialized = JSON.stringify(pr);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw new Error('Analysis exceeds the maximum stored size.');
  const now = new Date().toISOString();
  const id = randomUUID();
  open().prepare('INSERT INTO analyses (id, repository, number, head_sha, status, source, pr_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)')
    .run(id, pr.repository, pr.number, pr.headSha, 'draft', serialized, now, now);
  return { id, repository: pr.repository, number: pr.number, headSha: pr.headSha, status: 'draft', source: null, pr, workflows: [], unassigned: [], createdAt: now, updatedAt: now };
}

export function getAnalysis(id: string): Analysis | undefined {
  assertId(id);
  const db = open();
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Row | undefined;
  return row ? toAnalysis(db, row) : undefined;
}

export function latestAnalysisForPr(repository: string, number: number): Analysis | undefined {
  const db = open();
  const row = db.prepare(`SELECT * FROM analyses WHERE repository = ? COLLATE NOCASE AND number = ?
    ORDER BY (status = 'ready') DESC, updated_at DESC, rowid DESC LIMIT 1`).get(repository, number) as Row | undefined;
  return row ? toAnalysis(db, row) : undefined;
}

export function submitWorkflows(id: string, headSha: string, workflows: unknown, source: AnalysisSource, unassignedInput?: unknown): Analysis {
  const existing = getAnalysis(id);
  if (!existing) throw new Error('Analysis not found.');
  if (headSha !== existing.headSha) throw new Error('Head SHA does not match this draft analysis.');
  const changed = new Set(existing.pr.files.map((file) => file.path));
  const testPath = testStepPath(workflows);
  if (testPath) throw new Error(testStepMessage(testPath));
  const patches = patchesOf(existing.pr);
  const rangeProblem = rangeError(workflows, patches);
  if (rangeProblem) throw new Error(rangeProblem);
  const valid = validWorkflows(workflows, changed, true, patches);
  if (!valid) throw new Error('Workflows are invalid, have no feature or actor, use legacy paths, or refer to unknown paths.');
  const unassigned = validUnassigned(unassignedInput, changed);
  if (!unassigned) throw new Error('Unassigned files are invalid: each needs a changed file path once and a reason.');
  const gap = coverageError(undefined, { pr: existing.pr, workflows: valid, unassigned });
  if (gap) throw new Error(gap);
  const unassignedJson = JSON.stringify(unassigned);
  const rows = valid.map((workflow) => ({ workflow, steps: JSON.stringify(workflow.steps), edges: JSON.stringify(workflow.edges) }));
  const size = Buffer.byteLength(JSON.stringify(existing.pr), 'utf8') + rows.reduce((sum, row) => sum + row.steps.length + row.edges.length, unassignedJson.length);
  if (size > MAX_RECORD_BYTES) throw new Error('Analysis exceeds the maximum stored size.');
  const now = new Date().toISOString();
  const db = open();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM workflows WHERE analysis_id = ?').run(id);
    db.prepare('DELETE FROM step_views WHERE analysis_id = ?').run(id);
    const insert = db.prepare('INSERT INTO workflows (analysis_id, id, position, title, feature, actor, entrypoint_kind, entrypoint_label, summary, steps_json, edges_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const { workflow, steps, edges } of rows) {
      insert.run(id, workflow.id, workflow.position, workflow.title, workflow.feature ?? null, workflow.actor ?? null, workflow.entrypoint.kind, workflow.entrypoint.label, workflow.summary, steps, edges);
    }
    db.prepare("UPDATE analyses SET status = 'ready', source = ?, updated_at = ?, unassigned_json = ? WHERE id = ?").run(source, now, unassignedJson, id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ...existing, status: 'ready', source, workflows: valid, unassigned, updatedAt: now };
}

export function replaceWorkflow(analysisId: string, workflowId: string, headSha: string, workflow: unknown, source: AnalysisSource): Analysis {
  const existing = getAnalysis(analysisId);
  if (!existing) throw new Error('Analysis not found.');
  if (existing.status !== 'ready') throw new Error('Analysis has no workflows to replace.');
  const current = existing.workflows.find((candidate) => candidate.id === workflowId);
  if (!current) throw new Error('Workflow not found.');
  if (headSha !== existing.headSha) throw new Error('Head SHA does not match this analysis.');
  const testPath = testStepPath(workflow);
  if (testPath) throw new Error(testStepMessage(testPath));
  const patches = patchesOf(existing.pr);
  const rangeProblem = rangeError(workflow, patches);
  if (rangeProblem) throw new Error(rangeProblem);
  const valid = validWorkflow(workflow, new Set(existing.pr.files.map((file) => file.path)), current.position, true, patches);
  if (!valid) throw new Error('Workflow is invalid, has no feature or actor, uses legacy paths, or refers to unknown paths.');
  const workflows = existing.workflows.map((candidate) => candidate.id === workflowId ? valid : candidate);
  const gap = coverageError(existing, { pr: existing.pr, workflows, unassigned: existing.unassigned });
  if (gap) throw new Error(gap);
  const steps = JSON.stringify(valid.steps);
  const edges = JSON.stringify(valid.edges);
  const others = existing.workflows.filter((candidate) => candidate.id !== workflowId).reduce((sum, candidate) => sum + JSON.stringify(candidate.steps).length + JSON.stringify(candidate.edges).length, 0);
  if (Buffer.byteLength(JSON.stringify(existing.pr), 'utf8') + others + steps.length + edges.length > MAX_RECORD_BYTES) throw new Error('Analysis exceeds the maximum stored size.');
  const now = new Date().toISOString();
  const db = open();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE workflows SET title = ?, feature = ?, actor = ?, entrypoint_kind = ?, entrypoint_label = ?, summary = ?, steps_json = ?, edges_json = ? WHERE analysis_id = ? AND id = ?')
      .run(valid.title, valid.feature ?? null, valid.actor ?? null, valid.entrypoint.kind, valid.entrypoint.label, valid.summary, steps, edges, analysisId, workflowId);
    db.prepare('DELETE FROM step_views WHERE analysis_id = ? AND workflow_id = ?').run(analysisId, workflowId);
    db.prepare('UPDATE analyses SET source = ?, updated_at = ? WHERE id = ?').run(source, now, analysisId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ...existing, source, workflows, updatedAt: now };
}

export function markViewed(analysisId: string, workflowId: string, stepPath: string): void {
  assertId(analysisId);
  open().prepare('INSERT INTO step_views (analysis_id, workflow_id, step_path, viewed_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(analysisId, workflowId, stepPath, new Date().toISOString());
}

export function unmarkViewed(analysisId: string, workflowId: string, stepPath: string): void {
  assertId(analysisId);
  open().prepare('DELETE FROM step_views WHERE analysis_id = ? AND workflow_id = ? AND step_path = ?').run(analysisId, workflowId, stepPath);
}

export function viewsFor(analysisId: string): Map<string, Set<string>> {
  assertId(analysisId);
  const rows = open().prepare('SELECT workflow_id, step_path FROM step_views WHERE analysis_id = ?').all(analysisId) as Array<{ workflow_id: string; step_path: string }>;
  const views = new Map<string, Set<string>>();
  for (const row of rows) {
    const paths = views.get(row.workflow_id);
    if (paths) paths.add(row.step_path); else views.set(row.workflow_id, new Set([row.step_path]));
  }
  return views;
}

export function listAnalyses(): AnalysisSummary[] {
  const rows = open().prepare(`SELECT a.id, a.repository, a.number, a.head_sha, a.status, a.source, a.updated_at, a.pr_json,
    (SELECT COUNT(*) FROM workflows w WHERE w.analysis_id = a.id) AS workflow_count FROM analyses a ORDER BY a.updated_at DESC, a.rowid DESC`).all() as Row[];
  const summaries: AnalysisSummary[] = [];
  for (const row of rows) {
    try {
      const title = (JSON.parse(String(row.pr_json)) as { title?: unknown }).title;
      summaries.push({ id: String(row.id), title: typeof title === 'string' ? title : '', repository: String(row.repository), number: Number(row.number),
        headSha: String(row.head_sha), status: row.status as AnalysisStatus, source: (row.source as AnalysisSource | null) ?? null,
        workflowCount: Number(row.workflow_count), updatedAt: String(row.updated_at) });
    } catch { /* A corrupt row must not hide the others. */ }
  }
  return summaries;
}
