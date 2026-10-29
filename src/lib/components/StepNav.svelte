<script lang="ts">
  import { ArrowLeft, ArrowRight } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { navHints } from '$lib/nav-state.svelte';

  let { base, stepNumber, stepCount, prev, next, backHref }: {
    base: string; stepNumber: number; stepCount: number; prev: number | null; next: number | null; backHref: string;
  } = $props();
</script>

<nav class="flex items-center justify-between gap-2" aria-label="Step navigation">
  <Button variant="outline" size="sm" href={prev ? `${base}/${prev}` : undefined} disabled={!prev} aria-label="Previous step" data-sveltekit-reset={false}>
    <ArrowLeft class="sm:hidden" /><span class="hidden sm:inline">Prev</span>
  </Button>
  <span class="flex flex-col items-center gap-1">
    <span class="font-mono text-xs text-muted-foreground">{stepNumber}/{stepCount}</span>
    <span class="hidden items-center gap-1 sm:inline-flex" role="group" aria-label="Keyboard: up and down follow the flow, left and right switch branch" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight">
      {#each [['↑', 'up', 'Previous step in the flow'], ['↓', 'down', 'Next step in the flow'], ['←', 'left', 'Previous branch'], ['→', 'right', 'Next branch']] as const as [key, dir, label]}
        <kbd class="kbd {navHints[dir] ? '' : 'off'}" title={navHints[dir] ? label : `${label}: none here`}>{key}</kbd>
      {/each}
    </span>
  </span>
  {#if next}
    <Button size="sm" href="{base}/{next}" aria-label="Next step" data-sveltekit-reset={false}>
      <span class="hidden sm:inline">Next</span><ArrowRight class="sm:hidden" />
    </Button>
  {:else}
    <Button variant="outline" size="sm" href={backHref}>Back to workflows</Button>
  {/if}
</nav>

<style>
  .kbd.off { opacity: 0.35; }
</style>
