export interface WorkflowProgress { id: string; title: string; feature: string; total: number; viewed: number; firstUnviewed: number | null }

/** First unviewed step after `current` (1-based) in step order, wrapping to the start; null when every other step is viewed. */
export function nextUnviewedStep(paths: string[], viewed: Set<string>, current: number): number | null {
  for (let offset = 1; offset < paths.length; offset++) {
    const index = (current - 1 + offset) % paths.length;
    if (!viewed.has(paths[index])) return index + 1;
  }
  return null;
}

export function progressOf(paths: string[], viewed: Set<string>): { total: number; viewed: number; firstUnviewed: number | null } {
  const first = paths.findIndex((path) => !viewed.has(path));
  return { total: paths.length, viewed: paths.filter((path) => viewed.has(path)).length, firstUnviewed: first < 0 ? null : first + 1 };
}

/** The next workflow in PR order that is not fully viewed, wrapping around; the current one is never returned. */
export function nextWorkflow(order: WorkflowProgress[], currentId: string): WorkflowProgress | null {
  const start = order.findIndex((workflow) => workflow.id === currentId);
  for (let offset = 1; offset < order.length; offset++) {
    const candidate = order[(start + offset) % order.length];
    if (candidate.firstUnviewed !== null) return candidate;
  }
  return null;
}
