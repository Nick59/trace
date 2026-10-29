<script lang="ts">
  import '../app.css';
  import { ArrowLeft, ExternalLink } from '@lucide/svelte';
  import { page } from '$app/state';

  type Crumb = { label: string; href?: string };
  let { children } = $props();
  let crumbs = $derived((page.data.crumbs ?? []) as Crumb[]);
  let githubUrl = $derived(page.data.githubUrl as string | undefined);
  let parent = $derived(crumbs.length - 2);
  let onStep = $derived(Boolean(page.route.id?.includes('[step]')));
  let pr = $derived(page.data.pr as { repository: string; number: number; head: string; base: string; headSha: string } | undefined);
  let stepNumber = $derived(page.data.stepNumber as number | undefined);
  let stepCount = $derived(page.data.stepCount as number | undefined);
</script>

<div class="flex min-h-dvh flex-col">
  <header class="z-30 border-b border-border backdrop-blur-md {onStep ? '' : 'sticky top-0'}" style="background: color-mix(in srgb, var(--topbar) 88%, transparent)">
    <div class="mx-auto flex h-11 max-w-[1120px] items-center gap-3 px-4 sm:px-6">
      <a href="/" class="flex shrink-0 items-center gap-2 font-mono text-[13px] font-semibold" aria-label="trace home">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="color-mix(in srgb, var(--a-cyan) 14%, var(--canvas))" stroke="color-mix(in srgb, var(--a-cyan) 45%, var(--line))" />
          <path d="M5 16h4.5l3-8H19" stroke="var(--a-cyan)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="5" cy="16" r="1.8" fill="var(--a-cyan)" /><circle cx="19" cy="8" r="1.8" fill="var(--kind-ui)" />
        </svg>
        trace
      </a>
      <nav class="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs text-muted-foreground" aria-label="Breadcrumb">
        {#each crumbs as crumb, index}
          <span class="min-w-0 items-center gap-1.5 {index === parent ? 'flex' : 'hidden sm:flex'}">
            <span aria-hidden="true" class={index === parent ? 'hidden sm:inline' : ''}>›</span>
            {#if index === parent}<ArrowLeft size={13} class="sm:hidden" aria-hidden="true" />{/if}
            {#if crumb.href && index < crumbs.length - 1}
              <a href={crumb.href} class="truncate rounded-sm px-1 hover:bg-muted hover:text-foreground">{crumb.label}</a>
            {:else}
              <span class="truncate px-1 {index === crumbs.length - 1 ? 'text-foreground' : ''}" aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
            {/if}
          </span>
        {/each}
      </nav>
      {#if githubUrl}
        <a href={githubUrl} target="_blank" rel="noreferrer" class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">GitHub<ExternalLink size={12} aria-hidden="true" /></a>
      {/if}
    </div>
  </header>

  <div class="flex-1">{@render children()}</div>

  <footer class="sticky bottom-0 z-30 border-t font-mono text-[11px]" style="background: color-mix(in srgb, var(--a-blue) 11%, var(--canvas)); border-color: color-mix(in srgb, var(--a-blue) 28%, var(--line)); color: color-mix(in srgb, var(--a-blue) 55%, var(--fg))">
    <div class="mx-auto flex h-6 max-w-[1120px] items-center gap-4 px-4 sm:px-6">
      <span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full" style="background: var(--kind-ui)"></span>local</span>
      {#if pr}
        <span class="min-w-0 truncate">{pr.repository}#{pr.number}</span>
        <span class="hidden min-w-0 truncate sm:inline">{pr.head} → {pr.base}</span>
        <span class="hidden sm:inline">{pr.headSha.slice(0, 7)}</span>
      {/if}
      <span class="flex-1"></span>
      {#if stepNumber && stepCount}<span>step {stepNumber}/{stepCount}</span><span class="hidden items-center gap-1 sm:inline-flex"><kbd class="kbd" style="height:15px;min-width:15px">←</kbd><kbd class="kbd" style="height:15px;min-width:15px">→</kbd></span>{/if}
    </div>
  </footer>
</div>
