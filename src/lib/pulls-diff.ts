export type Pull = { title: string; url: string; repository: string; number: number; author: string; updatedAt: string; draft: boolean };

export interface PullsDiff {
  merged: Pull[];
  added: Set<string>;
  removed: string[];
  changed: Set<string>;
}

const differs = (a: Pull, b: Pull) => a.title !== b.title || a.draft !== b.draft || a.updatedAt !== b.updatedAt || a.author !== b.author;

export function diffPulls(prev: Pull[], next: Pull[]): PullsDiff {
  const previous = new Map(prev.map((pull) => [pull.url, pull]));
  const added = new Set<string>();
  const changed = new Set<string>();
  const merged = next.map((pull) => {
    const old = previous.get(pull.url);
    if (!old) { added.add(pull.url); return pull; }
    if (differs(old, pull)) { changed.add(pull.url); return pull; }
    return old;
  });
  const kept = new Set(next.map((pull) => pull.url));
  const removed = prev.filter((pull) => !kept.has(pull.url)).map((pull) => pull.url);
  return { merged, added, removed, changed };
}
