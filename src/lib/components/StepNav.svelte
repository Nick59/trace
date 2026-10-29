<script lang="ts">
  import { ArrowLeft, ArrowRight } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';

  let { base, stepNumber, stepCount, prev, next, backHref }: {
    base: string; stepNumber: number; stepCount: number; prev: number | null; next: number | null; backHref: string;
  } = $props();

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' && prev) { event.preventDefault(); goto(`${base}/${prev}`, { reset: false }); }
    if (event.key === 'ArrowRight' && next) { event.preventDefault(); goto(`${base}/${next}`, { reset: false }); }
  }
</script>

<svelte:window {onkeydown} />

<nav class="flex items-center justify-between gap-2" aria-label="Step navigation">
  <Button variant="outline" size="sm" href={prev ? `${base}/${prev}` : undefined} disabled={!prev} aria-keyshortcuts="ArrowLeft" aria-label="Previous step" data-sveltekit-reset={false}>
    <ArrowLeft class="sm:hidden" /><span class="hidden sm:inline">Prev</span><kbd class="kbd hidden sm:inline-flex">←</kbd>
  </Button>
  <span class="font-mono text-xs text-muted-foreground">{stepNumber}/{stepCount}</span>
  {#if next}
    <Button size="sm" href="{base}/{next}" aria-keyshortcuts="ArrowRight" aria-label="Next step" data-sveltekit-reset={false}>
      <span class="hidden sm:inline">Next</span><kbd class="kbd hidden sm:inline-flex" style="color:inherit;background:transparent;border-color:rgb(255 255 255/0.35)">→</kbd><ArrowRight class="sm:hidden" />
    </Button>
  {:else}
    <Button variant="outline" size="sm" href={backHref}>Back to workflows</Button>
  {/if}
</nav>
