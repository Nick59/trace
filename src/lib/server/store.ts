import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Analysis, AnalysisSource, AnalysisStatus, PullRequestSnapshot, Workflow } from '../types';
import { validWorkflows } from './workflows';

export interface AnalysisSummary { id: string; title: string; repository: string; number: number; headSha: string; status: AnalysisStatus; source: AnalysisSource | null; workflowCount: number; updatedAt: string }

const MAX_RECORD_BYTES = 5 * 1024 * 1024;
const SCHEMA_VERSION = 1;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const databases = new Map<string, DatabaseSync>();

function databasePath(): string {
  return path.join(path.resolve(process.env.TRACE_DATA_DIR || path.join(process.cwd(), '.trace')), 'trace.db');
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
      pr_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analyses_pr ON analyses (repository COLLATE NOCASE, number, updated_at);
    CREATE TABLE IF NOT EXISTS workflows (
      analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL,
      title TEXT NOT NULL, entrypoint_kind TEXT NOT NULL, entrypoint_label TEXT NOT NULL, summary TEXT NOT NULL,
      steps_json TEXT NOT NULL, edges_json TEXT NOT NULL, PRIMARY KEY (analysis_id, id)
    );
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
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
  const raw = rows.map((row) => ({ title: row.title, summary: row.summary, entrypoint: { kind: row.entrypoint_kind, label: row.entrypoint_label },
    steps: JSON.parse(String(row.steps_json)), edges: JSON.parse(String(row.edges_json)) }));
  const workflows = validWorkflows(raw, new Set(snapshot.files.map((file) => file.path)));
  if (!workflows) throw new Error('Stored workflows are invalid.');
  return workflows;
}

function toAnalysis(db: DatabaseSync, row: Row): Analysis {
  const pr = JSON.parse(String(row.pr_json)) as unknown;
  if (!isSnapshot(pr)) throw new Error('Stored analysis has an invalid format.');
  const workflows = readWorkflows(db, String(row.id), pr);
  const status = row.status as AnalysisStatus;
  if ((status === 'ready') !== (workflows.length > 0)) throw new Error('Stored analysis has an invalid state.');
  return { id: String(row.id), repository: String(row.repository), number: Number(row.number), headSha: String(row.head_sha), status,
    source: (row.source as AnalysisSource | null) ?? null, pr, workflows, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function createDraft(pr: PullRequestSnapshot): Analysis {
  if (!isSnapshot(pr)) throw new Error('Pull request snapshot has an invalid format.');
  const serialized = JSON.stringify(pr);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) throw new Error('Analysis exceeds the maximum stored size.');
  const now = new Date().toISOString();
  const id = randomUUID();
  open().prepare('INSERT INTO analyses (id, repository, number, head_sha, status, source, pr_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)')
    .run(id, pr.repository, pr.number, pr.headSha, 'draft', serialized, now, now);
  return { id, repository: pr.repository, number: pr.number, headSha: pr.headSha, status: 'draft', source: null, pr, workflows: [], createdAt: now, updatedAt: now };
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

export function submitWorkflows(id: string, headSha: string, workflows: unknown, source: AnalysisSource): Analysis {
  const existing = getAnalysis(id);
  if (!existing) throw new Error('Analysis not found.');
  if (headSha !== existing.headSha) throw new Error('Head SHA does not match this draft analysis.');
  const valid = validWorkflows(workflows, new Set(existing.pr.files.map((file) => file.path)));
  if (!valid) throw new Error('Workflows are invalid or refer to unknown paths.');
  const rows = valid.map((workflow) => ({ workflow, steps: JSON.stringify(workflow.steps), edges: JSON.stringify(workflow.edges) }));
  const size = Buffer.byteLength(JSON.stringify(existing.pr), 'utf8') + rows.reduce((sum, row) => sum + row.steps.length + row.edges.length, 0);
  if (size > MAX_RECORD_BYTES) throw new Error('Analysis exceeds the maximum stored size.');
  const now = new Date().toISOString();
  const db = open();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM workflows WHERE analysis_id = ?').run(id);
    const insert = db.prepare('INSERT INTO workflows (analysis_id, id, position, title, entrypoint_kind, entrypoint_label, summary, steps_json, edges_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const { workflow, steps, edges } of rows) {
      insert.run(id, workflow.id, workflow.position, workflow.title, workflow.entrypoint.kind, workflow.entrypoint.label, workflow.summary, steps, edges);
    }
    db.prepare("UPDATE analyses SET status = 'ready', source = ?, updated_at = ? WHERE id = ?").run(source, now, id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ...existing, status: 'ready', source, workflows: valid, updatedAt: now };
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
