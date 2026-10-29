// Which keyboard directions currently lead somewhere; the step page writes it, StepNav and the layout footer read it. overlay/canGo describe the completion overlay for the footer legend.
export const navHints = $state({ up: false, down: false, left: false, right: false, overlay: false, canGo: false });

// Steps the user left without pressing Space, per analysis and workflow. Kept in sessionStorage so it survives a reload in this tab and is never sent to the server.
const skippedState = $state<{ key: string; ids: string[] }>({ key: '', ids: [] });
const skippedStorageKey = (key: string) => `trace:skipped:${key}`;

function readSkipped(key: string): string[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(skippedStorageKey(key)) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function loadSkipped(key: string) {
  skippedState.key = key;
  skippedState.ids = readSkipped(key);
}

export const skippedIdsFor = (key: string): string[] => (skippedState.key === key ? skippedState.ids : []);

export function setSkipped(key: string, id: string, skipped: boolean) {
  if (skippedState.key !== key) loadSkipped(key);
  const has = skippedState.ids.includes(id);
  if (has === skipped) return;
  skippedState.ids = skipped ? [...skippedState.ids, id] : skippedState.ids.filter((candidate) => candidate !== id);
  try { sessionStorage.setItem(skippedStorageKey(key), JSON.stringify(skippedState.ids)); } catch { /* storage unavailable */ }
}
