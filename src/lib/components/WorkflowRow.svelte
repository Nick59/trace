<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import KindBadge from './KindBadge.svelte';
  import { kindMeta } from '$lib/kinds';
  import type { WorkflowSummary } from '$lib/server/pr-page';

  let { workflow, href, index = 0 }: { workflow: WorkflowSummary; href: string; index?: number } = $props();
  let kind = $derived(kindMeta[workflow.entrypoint.kind] ? workflow.entrypoint.kind : 'other');
</script>

<a {href} class="row rise" data-kind={kind} style="--i:{Math.min(index, 10)}">
  <span class="min-w-0 flex-1">
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

<style>
  .row {
    position: relative; display: flex; gap: 14px; padding: 12px 14px 12px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--a-cyan) 14%, var(--line)); transition: background-color 0.15s;
  }
  .row:last-child { border-bottom: 0; }
  .row::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--k); opacity: 0.75; transition: opacity 0.15s; }
  .row:hover, .row:focus-visible { background: color-mix(in srgb, var(--k) 6%, transparent); }
  .row:hover::before { opacity: 1; }
  .row :global(.chev) { transition: transform 0.15s, color 0.15s; }
  .row:hover :global(.chev) { transform: translateX(2px); color: var(--k); }
  .dot { width: 6px; height: 3px; border-radius: 1px; background: var(--k); opacity: 0.55; }
</style>
