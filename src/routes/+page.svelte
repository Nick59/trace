<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import HistoryRow from '$lib/components/HistoryRow.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let refreshing = $state(false);
  let now = $state(Date.now());
  let historyRepo = $state('');
  let query = $state('');
  let historyRepos = $derived([...new Set(data.history.map((entry) => entry.repository))].sort());
  let history = $derived.by(() => {
    const text = query.trim().toLowerCase();
    return data.history.filter((entry) => (!historyRepo || entry.repository === historyRepo)
      && (!text || entry.title.toLowerCase().includes(text) || entry.repository.toLowerCase().includes(text)));
  });

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  async function recheck() {
    refreshing = true;
    try { await invalidateAll(); } finally { refreshing = false; }
  }

  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 30_000);
    return () => clearInterval(timer);
  });
</script>

<svelte:head><title>Pull requests · trace</title></svelte:head>

<main class="mx-auto max-w-[1120px] px-4 py-5 sm:px-6">
  <Onboarding commands={data.setup.commands} steps={data.setup.steps} onRefresh={recheck} {refreshing} />

  <section class="panel mt-6" aria-labelledby="analyzed-heading">
    <div class="panel-head" style="min-height:40px">
      <h1 id="analyzed-heading" class="tab" style="font:inherit"><span>Analyzed</span><span class="count">{data.history.length}</span></h1>
      <span class="dim grow">{history.length === data.history.length ? plural(data.history.length, 'PR') : `${history.length} of ${data.history.length} PRs`}</span>
      <input type="search" bind:value={query} placeholder="Filter title or repo" aria-label="Filter analyzed PRs" class="h-7 w-32 rounded-md border border-border bg-card px-2 font-mono text-xs normal-case tracking-normal text-foreground sm:w-48" />
      <select bind:value={historyRepo} aria-label="Repository" class="h-7 max-w-44 rounded-md border border-border bg-card px-2 font-mono text-xs normal-case tracking-normal text-foreground sm:max-w-56">
        <option value="">All repositories</option>
        {#each historyRepos as name}<option value={name}>{name}</option>{/each}
      </select>
    </div>

    {#if !data.history.length}
      <div class="py-12 text-center font-mono text-[13px] text-muted-foreground">
        <p class="text-foreground">No analyzed PRs yet</p>
        <p class="mt-1">Open a pull request and generate its workflows, or run the CLI command shown on its page. It will appear here.</p>
      </div>
    {:else if !history.length}
      <p class="py-12 text-center font-mono text-[13px] text-muted-foreground">No analyzed PR matches this filter.</p>
    {:else}
      {#each history as entry (entry.repository + '#' + entry.number)}<HistoryRow {entry} {now} />{/each}
    {/if}
  </section>

</main>

<style>
  .count { font-size: 10px; padding: 0 5px; border-radius: 8px; background: color-mix(in srgb, var(--neutral) 18%, transparent); color: var(--muted-fg); }
</style>
