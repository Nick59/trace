export function appUrl(repository: string, number: number, workflowId?: string): string | undefined {
  const raw = process.env.TRACE_APP_URL?.trim();
  if (!raw) return undefined;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return undefined; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  const base = raw.replace(/\/+$/, '');
  return `${base}/pr/${repository}/${number}${workflowId ? `/${workflowId}` : ''}`;
}
