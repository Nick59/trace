export interface Hunk { index: number; oldStart: number; oldLines: number; newStart: number; newLines: number; header: string }
export interface LineRange { from: number; to: number }

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const line of patch.split('\n')) {
    const match = HEADER.exec(line);
    if (!match) continue;
    hunks.push({ index: hunks.length, oldStart: Number(match[1]), oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]), newLines: match[4] === undefined ? 1 : Number(match[4]), header: line });
  }
  return hunks;
}

/** A pure deletion (no new lines) counts as the single line where it happened. */
export function hunkInRanges(hunk: Pick<Hunk, 'newStart' | 'newLines'>, ranges: LineRange[]): boolean {
  const end = hunk.newStart + Math.max(hunk.newLines, 1) - 1;
  return ranges.some((range) => range.from <= end && range.to >= hunk.newStart);
}
