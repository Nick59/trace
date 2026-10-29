<script lang="ts">
  import { RefreshCw } from '@lucide/svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import HistoryRow from '$lib/components/HistoryRow.svelte';
  import PullRow from '$lib/components/PullRow.svelte';
  import { diffPulls, type Pull } from '$lib/pulls-diff';
  import { readPulls, writePulls, type PullsEntry } from '$lib/pulls-cache';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let pulls = $state.raw<Pull[]>([]);
  let repositories = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let truncated = $state(false);
  let repo = $state('');
  let syncing = $state(false);
  let loaded = $state(false);
  let stagger = $state(false);
  let error = $state('');
  let refreshing = $state(false);
  let fetchedAt = $state(0);
  let now = $state(Date.now());
  let fresh = $state<Set<string>>(new Set());
  let controller: AbortController | undefined;
  let historyRepo = $state('');
  let query = $state('');
  let tab = $derived(data.setup.githubConfigured && page.url.searchParams.get('tab') !== 'analyzed' ? 'open' : 'analyzed');
  let historyRepos = $derived([...new Set(data.history.map((entry) => entry.repository))].sort());
  let history = $derived.by(() => {
    const text = query.trim().toLowerCase();
    return data.history.filter((entry) => (!historyRepo || entry.repository === historyRepo)
      && (!text || entry.title.toLowerCase().includes(text) || entry.repository.toLowerCase().includes(text)));
  });

  function show(entry: PullsEntry) {
    pulls = entry.pulls;
    warnings = entry.warnings;
    truncated = entry.truncated;
    fetchedAt = entry.fetchedAt;
    if (!repo) repositories = entry.repositories;
    loaded = true;
  }

  function highlight(urls: Set<string>) {
    if (!urls.size) return;
    fresh = new Set([...fresh, ...urls]);
    setTimeout(() => { fresh = new Set([...fresh].filter((url) => !urls.has(url))); }, 4500);
  }

  function open() {
    controller?.abort();
    fresh = new Set();
    const cached = readPulls(repo);
    loaded = false;
    stagger = !cached;
    if (cached) show(cached);
    return sync();
  }

  async function sync() {
    controller?.abort();
    const current = (controller = new AbortController());
    const filter = repo;
    syncing = true;
    error = '';
    try {
      const response = await fetch(`/api/pulls${filter ? `?repo=${encodeURIComponent(filter)}` : ''}`, { signal: current.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      const entry: PullsEntry = {
        pulls: body.pulls, repositories: body.repositories, truncated: body.truncated, warnings: body.warnings, fetchedAt: Date.now()
      };
      if (current.signal.aborted) return;
      if (loaded) {
        const { merged, added } = diffPulls(pulls, entry.pulls);
        entry.pulls = merged;
        highlight(added);
      }
      writePulls(filter, entry);
      show(entry);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (current.signal.aborted) return;
      error = cause instanceof Error ? cause.message : 'Unknown error.';
    } finally {
      if (controller === current) syncing = false;
    }
  }

  function ago(time: number): string {
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
  }

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

  async function recheck() {
    refreshing = true;
    try { await invalidateAll(); } finally { refreshing = false; }
  }

  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 30_000);
    if (data.setup.githubConfigured) open();
    return () => { clearInterval(timer); controller?.abort(); };
  });
</script>

<svelte:head><title>Pull requests · trace</title></svelte:head>

<main class="mx-auto max-w-[1120px] px-4 py-5 sm:px-6">
  {#if !data.setup.githubConfigured}
    <Onboarding onRefresh={recheck} {refreshing} />
  {/if}

  <section class="panel" class:mt-6={!data.setup.githubConfigured} aria-labelledby="tab-{tab}">
    <div class="panel-head" style="min-height:40px">
      {#if data.setup.githubConfigured}
        <h1 class="sr-only">Pull requests</h1>
        <nav class="tabs" aria-label="Pull requests">
          <a id="tab-open" href="/" data-sveltekit-noscroll aria-current={tab === 'open' ? 'page' : undefined}>Open PRs</a>
          <a id="tab-analyzed" href="/?tab=analyzed" data-sveltekit-noscroll aria-current={tab === 'analyzed' ? 'page' : undefined}>Analyzed<span class="count">{data.history.length}</span></a>
        </nav>
      {:else}
        <h2 id="tab-analyzed" class="tab" style="font:inherit"><span>Analyzed</span></h2>
      {/if}
      {#if tab === 'open'}
        <span class="dim grow">{loaded ? `${pulls.length} open · ${repositories.length} ${repositories.length === 1 ? 'repo' : 'repos'}` : 'loading…'}</span>
        <select bind:value={repo} onchange={open} aria-label="Repository" class="h-7 max-w-44 rounded-md border border-border bg-card px-2 font-mono text-xs normal-case tracking-normal text-foreground sm:max-w-56">
          <option value="">All repositories</option>
          {#each repositories as name}<option value={name}>{name}</option>{/each}
        </select>
        <span class="hidden min-w-28 text-right font-mono text-xs text-muted-foreground sm:inline" aria-live="polite">
          {#if syncing}syncing…{:else if error && loaded}<button type="button" class="text-destructive underline-offset-2 hover:underline" onclick={sync}>sync failed · retry</button>{:else if loaded}synced {ago(fetchedAt)}{/if}
        </span>
        <Button variant="outline" size="icon-sm" onclick={sync} aria-label="Refresh" disabled={syncing}><RefreshCw class={syncing ? 'animate-spin' : ''} /></Button>
      {:else}
        <span class="dim grow">{history.length === data.history.length ? plural(data.history.length, 'PR') : `${history.length} of ${data.history.length} PRs`}</span>
        <input type="search" bind:value={query} placeholder="Filter title or repo" aria-label="Filter analyzed PRs" class="h-7 w-32 rounded-md border border-border bg-card px-2 font-mono text-xs normal-case tracking-normal text-foreground sm:w-48" />
        <select bind:value={historyRepo} aria-label="Repository" class="h-7 max-w-44 rounded-md border border-border bg-card px-2 font-mono text-xs normal-case tracking-normal text-foreground sm:max-w-56">
          <option value="">All repositories</option>
          {#each historyRepos as name}<option value={name}>{name}</option>{/each}
        </select>
      {/if}
    </div>

    {#if tab === 'open'}
      {#if error && !loaded}
        <div class="m-3 flex items-center justify-between gap-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          <span>Could not load pull requests: {error}</span><Button variant="outline" onclick={sync}>Try again</Button>
        </div>
      {/if}

      {#if !loaded && syncing}
        {#each Array(5) as _}<div class="flex min-h-14 items-center gap-3 border-b border-border px-3"><div class="size-[30px] animate-pulse rounded-[5px] bg-muted"></div><div class="flex flex-1 flex-col gap-2"><div class="h-3 w-2/3 animate-pulse rounded-sm bg-muted"></div><div class="h-3 w-1/3 animate-pulse rounded-sm bg-muted"></div></div></div>{/each}
      {:else if loaded && !pulls.length}
        <p class="py-12 text-center font-mono text-[13px] text-muted-foreground">No open pull requests in your recently pushed repositories.</p>
      {:else}
        {#each pulls as pull, index (pull.url)}<PullRow {pull} {index} {stagger} isNew={fresh.has(pull.url)} review={data.reviews[`${pull.repository.toLowerCase()}#${pull.number}`]} />{/each}
      {/if}
    {:else if !data.history.length}
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

  {#if tab === 'open' && (truncated || warnings.length)}
    <p class="mt-3 font-mono text-xs text-muted-foreground">{[truncated ? 'Showing the most recent repositories. Filter to see more.' : '', ...warnings].filter(Boolean).join(' ')}</p>
  {/if}
</main>

<style>
  .tabs { display: inline-flex; align-items: stretch; align-self: stretch; gap: 2px; }
  .tabs a {
    display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; color: var(--muted-fg); border-bottom: 2px solid transparent;
    text-decoration: none; transition: color 0.15s;
  }
  .tabs a:hover { color: var(--fg); }
  .tabs a[aria-current='page'] { color: var(--fg); border-bottom-color: var(--p-accent); }
  .count { font-size: 10px; padding: 0 5px; border-radius: 8px; background: color-mix(in srgb, var(--neutral) 18%, transparent); color: var(--muted-fg); }
</style>
