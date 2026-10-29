import type { Pull } from './pulls-diff';

export interface PullsEntry {
  pulls: Pull[];
  repositories: string[];
  truncated: boolean;
  warnings: string[];
  fetchedAt: number;
}

const PREFIX = 'trace:pulls:v1:';
const memory = new Map<string, PullsEntry>();

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isPull = (value: any): value is Pull =>
  !!value && typeof value.title === 'string' && typeof value.url === 'string' && typeof value.repository === 'string'
  && typeof value.number === 'number' && typeof value.author === 'string' && typeof value.updatedAt === 'string' && typeof value.draft === 'boolean';

function valid(value: any): value is PullsEntry {
  return !!value && Array.isArray(value.pulls) && value.pulls.every(isPull) && isStrings(value.repositories)
    && typeof value.truncated === 'boolean' && isStrings(value.warnings) && typeof value.fetchedAt === 'number';
}

export function readPulls(filter: string): PullsEntry | undefined {
  const hit = memory.get(filter);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(PREFIX + filter);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!valid(parsed)) { localStorage.removeItem(PREFIX + filter); return undefined; }
    memory.set(filter, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

export function writePulls(filter: string, entry: PullsEntry): void {
  const snapshot: PullsEntry = {
    pulls: entry.pulls, repositories: entry.repositories, truncated: entry.truncated, warnings: entry.warnings, fetchedAt: entry.fetchedAt
  };
  memory.set(filter, snapshot);
  try { localStorage.setItem(PREFIX + filter, JSON.stringify(snapshot)); } catch { /* storage unavailable or full */ }
}
