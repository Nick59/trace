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
<div class="line">
  <a {href} class="row" data-kind={kind}>
    <KindBadge {kind} />
    <span class="min-w-0 flex-1">
      <span class="block text-[14px] font-medium">{workflow.title}</span>
      {#if workflow.entrypoint.label !== workflow.title}<span class="block font-mono text-[11.5px] [overflow-wrap:anywhere]" style="color: var(--k)">{workflow.entrypoint.label}</span>{/if}
    </span>
    <span class="shrink-0 font-mono text-xs text-muted-foreground">{workflow.stepCount} {workflow.stepCount === 1 ? 'step' : 'steps'}</span>
    <ChevronRight size={16} class="chev shrink-0 text-muted-foreground" aria-hidden="true" />
  </a>
  {#if ontoggle}
    <button type="button" class="recompute" aria-expanded={open} aria-controls="recompute-{workflow.id}" onclick={ontoggle}><RefreshCw size={12} aria-hidden="true" />Recompute</button>
  {/if}
</div>
{#if open}{@render children?.()}{/if}
</div>

<style>
  .item { border-bottom: 1px solid color-mix(in srgb, var(--a-cyan) 10%, var(--line)); position: relative; }
  .item:last-child { border-bottom: 0; }
  .line { display: flex; align-items: center; gap: 8px; padding-right: 12px; }
  .row { position: relative; display: flex; flex: 1; min-width: 0; align-items: center; gap: 12px; padding: 8px 8px 8px 28px; transition: background-color 0.15s; }
  .recompute { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: var(--muted-fg); font: 500 11px var(--fm); transition: all 0.15s; }
  .recompute:hover, .recompute[aria-expanded="true"] { color: var(--fg); border-color: color-mix(in srgb, var(--k) 55%, var(--line)); }
  .row::before { content: ""; position: absolute; left: 14px; top: 0; bottom: 0; width: 2px; background: var(--k); opacity: 0.6; transition: opacity 0.15s; }
  .row:hover, .row:focus-visible { background: color-mix(in srgb, var(--k) 6%, transparent); }
  .row:hover::before { opacity: 1; }
  .row :global(.chev) { transition: transform 0.15s, color 0.15s; }
  .row:hover :global(.chev) { transform: translateX(2px); color: var(--k); }
</style>
