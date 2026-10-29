<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronRight, RefreshCw } from '@lucide/svelte';
  import KindBadge from './KindBadge.svelte';
  import { kindMeta } from '$lib/kinds';
  import type { WorkflowSummary } from '$lib/server/pr-page';

  let { workflow, href, index = 0, open = false, ontoggle, children }: {
    workflow: WorkflowSummary; href: string; index?: number; open?: boolean; ontoggle?: () => void; children?: Snippet;
  } = $props();
  let kind = $derived(kindMeta[workflow.entrypoint.kind] ? workflow.entrypoint.kind : 'other');
</script>

<div class="item rise" data-kind={kind} style="--i:{Math.min(index, 10)}">
<a {href} class="row" data-kind={kind}>
  <span class="min-w-0 flex-1">
    {#if workflow.actor}<span class="actor mb-1 block font-mono text-[11px] text-muted-foreground" title="Actor">{workflow.actor}</span>{/if}
    <span class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <KindBadge {kind} />
      <span class="min-w-0 text-[15px] font-medium">{workflow.title}</span>
    </span>
    {#if workflow.entrypoint.label !== workflow.title}<span class="mt-1 block font-mono text-xs [overflow-wrap:anywhere]" style="color: var(--k)">{workflow.entrypoint.label}</span>{/if}
    <span class="mt-1 line-clamp-2 block text-[13.5px] text-muted-foreground">{workflow.summary}</span>
  </span>
  <span class="flex shrink-0 flex-col items-end gap-2 self-start pt-0.5">
    <span class="font-mono text-xs text-muted-foreground">{workflow.stepCount} {workflow.stepCount === 1 ? 'step' : 'steps'}</span>
    <span class="flex items-center gap-[3px]" aria-hidden="true">{#each Array(Math.min(workflow.stepCount, 12)) as _}<i class="dot"></i>{/each}</span>
  </span>
  <ChevronRight size={16} class="chev shrink-0 self-center text-muted-foreground" aria-hidden="true" />
</a>
{#if ontoggle}
  <div class="actions"><button type="button" class="recompute" aria-expanded={open} aria-controls="recompute-{workflow.id}" onclick={ontoggle}><RefreshCw size={12} aria-hidden="true" />Recompute</button></div>
{/if}
{#if open}{@render children?.()}{/if}
</div>

<style>
  .row {
    position: relative; display: flex; gap: 14px; padding: 12px 14px 12px 16px;
    transition: background-color 0.15s;
  }
  .item { border-bottom: 1px solid color-mix(in srgb, var(--a-cyan) 14%, var(--line)); position: relative; }
  .item:last-child { border-bottom: 0; }
  .actions { padding: 0 16px 10px; }
  .recompute { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: var(--muted-fg); font: 500 11px var(--fm); transition: all 0.15s; }
  .recompute:hover, .recompute[aria-expanded="true"] { color: var(--fg); border-color: color-mix(in srgb, var(--k) 55%, var(--line)); }
  .row::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--k); opacity: 0.75; transition: opacity 0.15s; }
  .row:hover, .row:focus-visible { background: color-mix(in srgb, var(--k) 6%, transparent); }
  .row:hover::before { opacity: 1; }
  .row :global(.chev) { transition: transform 0.15s, color 0.15s; }
  .row:hover :global(.chev) { transform: translateX(2px); color: var(--k); }
  .dot { width: 6px; height: 3px; border-radius: 1px; background: var(--k); opacity: 0.55; }
</style>
