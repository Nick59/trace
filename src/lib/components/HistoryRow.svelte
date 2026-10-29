<script lang="ts">
  import { Check } from '@lucide/svelte';
  import type { HistoryEntry } from '$lib/server/pr-page';
  import Badge from './Badge.svelte';

  let { entry, now }: { entry: HistoryEntry; now: number } = $props();

  function relative(iso: string): string {
    const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    if (Number.isNaN(seconds) || seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
  }
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  let accounted = $derived(entry.coverage ? entry.coverage.covered + entry.coverage.unassigned : 0);
  let covered = $derived(entry.coverage ? entry.coverage.uncovered.length === 0 : false);
  let reviewed = $derived(entry.review.workflows > 0 && entry.review.workflowsViewed === entry.review.workflows);
  let percent = $derived(entry.review.steps ? Math.round((entry.review.stepsViewed / entry.review.steps) * 100) : 0);
</script>

<a href="/pr/{entry.repository}/{entry.number}" class="row">
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-2">
      <span class="min-w-0 truncate text-[14.5px] font-medium">{entry.title}</span>
      {#if entry.status === 'draft'}<Badge>draft</Badge>{/if}
    </span>
    <span class="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-xs text-muted-foreground">
      <span class="truncate">{entry.repository}#{entry.number}</span>
      <span>{relative(entry.updatedAt)}</span>
      {#if entry.status === 'ready'}<span>{plural(entry.features, 'feature')} · {plural(entry.workflows, 'workflow')}</span>{/if}
      {#if entry.analyses > 1}<span>{entry.analyses} analyses</span>{/if}
    </span>
  </span>
  {#if entry.status === 'ready'}
    <span class="meta">
      {#if entry.coverage && entry.coverage.total > 0}
        <span class="cov {covered ? 'ok' : 'gap'}" title={covered ? 'Every changed file is in a workflow or listed as unassigned' : 'Some changed files are in no workflow'}>{accounted}/{entry.coverage.total} files</span>
      {/if}
      {#if reviewed}
        <span class="done"><Check size={13} aria-hidden="true" />reviewed</span>
      {:else if entry.review.workflows > 0}
        <span class="progress"><span>{entry.review.workflowsViewed}/{entry.review.workflows} workflows reviewed</span>
          <span class="bar" role="progressbar" aria-label="Steps viewed" aria-valuemin="0" aria-valuemax={entry.review.steps} aria-valuenow={entry.review.stepsViewed}><span style="width:{percent}%"></span></span>
        </span>
      {/if}
    </span>
  {/if}
</a>

<style>
  .row {
    position: relative; display: flex; align-items: center; gap: 16px; min-height: 56px; padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--neutral) 20%, var(--line)); transition: background-color 0.15s;
  }
  .row:last-child { border-bottom: 0; }
  .row::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--a-cyan); opacity: 0; transition: opacity 0.15s; }
  .row:hover, .row:focus-visible { background: color-mix(in srgb, var(--a-cyan) 7%, transparent); }
  .row:hover::before, .row:focus-visible::before { opacity: 1; }
  .meta { display: flex; flex: none; align-items: center; gap: 14px; font: 500 11px var(--fm); }
  .cov { padding: 1px 6px; border-radius: 3px; border: 1px solid; }
  .cov.ok { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 45%, var(--line)); }
  .cov.gap { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 50%, var(--line)); }
  .done { display: inline-flex; align-items: center; gap: 3px; min-width: 150px; justify-content: flex-end; color: var(--a-green); }
  .progress { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 150px; color: var(--muted-fg); }
  .bar { display: block; width: 100%; height: 3px; border-radius: 2px; background: color-mix(in srgb, var(--neutral) 22%, transparent); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--a-cyan); }
  @media (max-width: 720px) { .row { flex-wrap: wrap; gap: 6px; } .meta { width: 100%; justify-content: space-between; } .progress, .done { min-width: 0; } }
</style>
