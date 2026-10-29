<script lang="ts">
  import { ArrowRight, ChevronDown, GitBranch, LoaderCircle, RefreshCw } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button';
  import CommandBlock from '$lib/components/CommandBlock.svelte';
  import RecomputePanel from '$lib/components/RecomputePanel.svelte';
  import WorkflowRow from '$lib/components/WorkflowRow.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let tool = $state<'claude' | 'codex'>('claude');
  let openPanel = $state<string | null>(null);
  let generating = $state(false);
  let generateError = $state('');
  let reloading = $state(false);
  let base = $derived(`/pr/${data.params.owner}/${data.params.repo}/${data.params.number}`);
  let workflowCount = $derived(data.features.reduce((sum, group) => sum + group.workflows.length, 0));
  let hasWorkflows = $derived(workflowCount > 0);
  const reviewed = (workflow: { stepCount: number; viewed: number }) => workflow.stepCount > 0 && workflow.viewed >= workflow.stepCount;
  let reviewedCount = $derived(data.features.reduce((sum, group) => sum + group.workflows.filter(reviewed).length, 0));
  let accounted = $derived(data.coverage ? data.coverage.covered + data.coverage.unassigned : 0);
  let complete = $derived(data.coverage ? data.coverage.uncovered.length === 0 : false);
  let showUncovered = $state(false);

  async function generate() {
    generating = true;
    generateError = '';
    try {
      const response = await fetch(`/api${base}/workflows`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      await invalidateAll();
    } catch (cause) {
      generateError = cause instanceof Error ? cause.message : 'Unable to generate workflows.';
    } finally {
      generating = false;
    }
  }

  const toggle = (id: string) => (openPanel = openPanel === id ? null : id);

  $effect(() => {
    const match = /^#recompute-(all|w\d+)$/.exec(page.url.hash);
    if (!match) return;
    openPanel = match[1];
    tick().then(() => document.getElementById(`recompute-${match[1]}`)?.scrollIntoView({
      block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  });

  // Warms the module cache so the step page's dynamic import resolves at once.
  let warmed = false;
  function warmGraph() {
    if (warmed) return;
    warmed = true;
    import('mermaid').catch(() => { warmed = false; });
  }
  function warmOnRow(event: Event) {
    if (event.target instanceof Element && event.target.closest('a.row')) warmGraph();
  }
  onMount(() => {
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(warmGraph, { timeout: 4000 });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(warmGraph, 1500);
    return () => clearTimeout(timer);
  });

  async function reload() {
    reloading = true;
    try { await invalidateAll(); } finally { reloading = false; }
  }
</script>

<svelte:window onpointerover={warmOnRow} onfocusin={warmOnRow} />
<svelte:head><title>#{data.pr.number} {data.pr.title} · trace</title></svelte:head>

{#snippet agentCommands()}
  <div role="tablist" aria-label="Agent CLI" class="mb-3 flex gap-1.5">
    {#each [['claude', 'Claude Code'], ['codex', 'Codex']] as const as [id, name]}
      <button role="tab" aria-selected={tool === id} class="tool {tool === id ? 'on' : ''}" onclick={() => (tool = id)}>{name}</button>
    {/each}
  </div>
  <div class="flex flex-col gap-4">
    <CommandBlock command={data.cliCommands[tool]} label="{tool} command" />
    <div class="flex flex-col gap-2">
      <p class="m-0 text-sm text-muted-foreground">First time? Register the MCP server once:</p>
      <CommandBlock command={data.cliCommands.register[tool]} label="{tool} register command" />
      <p class="m-0 text-sm text-muted-foreground">Then install the {tool === 'claude' ? '/trace' : '$trace'} skill:</p>
      <CommandBlock command={data.cliCommands.installSkill[tool]} label="install skill command" />
      <p class="m-0 text-xs text-muted-foreground">Run it inside a clone of {data.pr.repository} to reuse it; otherwise the skill clones it.</p>
    </div>
  </div>
{/snippet}

<main class="mx-auto max-w-[1120px] px-4 py-5 sm:px-6">
  <div class="font-mono text-xs text-muted-foreground">{data.pr.repository} <span class="text-foreground">#{data.pr.number}</span> · {data.pr.author}</div>
  <h1 class="mt-1 text-[26px] leading-[1.15] font-semibold tracking-tight sm:text-[30px]">{data.pr.title}</h1>
  <div class="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
    <GitBranch size={14} class="text-muted-foreground" aria-hidden="true" />
    <span class="chip" title="head">{data.pr.head}</span><ArrowRight size={14} class="text-muted-foreground" aria-label="into" /><span class="chip" title="base">{data.pr.base}</span>
    <span class="chip" style="color:var(--muted-fg)" title="head commit">{data.pr.headSha.slice(0, 7)}</span>
  </div>

  {#if data.stale && data.analysis}
    <div class="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm" style="border-color: color-mix(in srgb, var(--warning) 45%, var(--line)); background: color-mix(in srgb, var(--warning) 9%, var(--canvas))" role="status">
      <span>Analyzed at <code class="text-xs">{data.analysis.headSha.slice(0, 7)}</code>. The pull request is now at <code class="text-xs">{data.pr.headSha.slice(0, 7)}</code>.</span>
      <Button onclick={() => (openPanel = 'all')}><RefreshCw />Recompute all</Button>
    </div>
  {/if}

  <section class="mt-5">
    {#if hasWorkflows}
      <div class="panel panel-cyan">
        <div class="panel-head">
          <span class="tab">Workflows</span><span class="dim">{workflowCount}</span><span class="dim" title="Workflows with every step viewed">{reviewedCount}/{workflowCount} reviewed</span>
          {#if data.coverage && data.coverage.total > 0}
            <span class="cov {complete ? 'ok' : 'gap'}" title={complete ? 'Every changed file is in a workflow or listed as unassigned' : 'Some changed files are in no workflow'}>{accounted}/{data.coverage.total} files</span>
            {#if data.coverage.ignoredTests > 0}<span class="dim">{data.coverage.ignoredTests} test {data.coverage.ignoredTests === 1 ? 'file' : 'files'} ignored</span>{/if}
          {/if}
          <button type="button" class="recompute-all {data.stale ? 'stale' : ''}" aria-expanded={openPanel === 'all'} aria-controls="recompute-all" onclick={() => toggle('all')}><RefreshCw size={12} aria-hidden="true" />Recompute all</button>
        </div>
        {#if openPanel === 'all'}
          <RecomputePanel title="all workflows" endpoint="/api{base}/workflows" apiConfigured={data.setup.apiConfigured} source={data.cliSource} bind:tool ondone={() => (openPanel = null)} />
        {/if}
        {#if data.coverage && data.coverage.uncovered.length > 0}
          <details class="cov-list gap" id="not-covered" open={showUncovered} ontoggle={(event) => (showUncovered = event.currentTarget.open)}>
            <summary>Not in any workflow <span class="dim">{data.coverage.uncovered.length}</span></summary>
            <p>These changed files are not part of any scenario, so the walkthrough does not explain them. Use "Recompute all" to analyze the pull request again.</p>
            <ul>{#each data.coverage.uncovered as file}<li>{file}</li>{/each}</ul>
            <button type="button" class="recompute-all inline" onclick={() => (openPanel = 'all')}><RefreshCw size={12} aria-hidden="true" />Recompute all</button>
          </details>
        {/if}
        {#if data.coverage && data.coverage.unassignedFiles.length > 0}
          <details class="cov-list">
            <summary>Unassigned <span class="dim">{data.coverage.unassignedFiles.length}</span></summary>
            <p>Files with no runtime behavior in any scenario.</p>
            <ul>{#each data.coverage.unassignedFiles as entry}<li>{entry.path}<span class="why">{entry.reason}</span></li>{/each}</ul>
          </details>
        {/if}
        {#each data.features as group (group.feature)}
          <details class="feature" open>
            <summary>
              <ChevronDown size={14} class="fchev" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block text-[15px] font-medium">{group.feature}</span>
                {#if group.actor}<span class="block font-mono text-[11px] text-muted-foreground" title="Actor">{group.actor}</span>{/if}
              </span>
              <span class="dim">{group.workflows.filter(reviewed).length}/{group.workflows.length} {group.workflows.length === 1 ? 'workflow' : 'workflows'} reviewed</span>
            </summary>
            {#each group.workflows as workflow, index (workflow.id)}
              <WorkflowRow {workflow} {index} href="{base}/{workflow.id}/1" open={openPanel === workflow.id} ontoggle={() => toggle(workflow.id)}>
                <RecomputePanel workflowId={workflow.id} title={workflow.title} endpoint="/api{base}/workflows/{workflow.id}" apiConfigured={data.setup.apiConfigured} source={data.cliSource} bind:tool ondone={() => (openPanel = null)} />
              </WorkflowRow>
            {/each}
          </details>
        {/each}
      </div>
    {:else}
      <h2 class="text-base font-semibold">No workflows yet</h2>
      <p class="mt-1 mb-4 max-w-[70ch] text-sm text-muted-foreground">
        {data.analysis ? 'A draft is prepared. Waiting for an agent to submit workflows.' : 'Run one of these in a terminal. The agent reads the PR through the Trace MCP server and saves the workflows here. Then reload.'}
      </p>
      {#if data.setup.apiConfigured}
        <div class="flex flex-col items-start gap-2">
          <Button onclick={generate} disabled={generating}>{#if generating}<LoaderCircle class="animate-spin" />{/if}Generate workflows</Button>
          {#if generating}<p class="m-0 text-sm text-muted-foreground">Generating, this can take a minute.</p>{/if}
          {#if generateError}<p class="m-0 text-sm text-destructive" role="alert">{generateError}</p>{/if}
        </div>
        <details class="mt-5"><summary class="cursor-pointer font-mono text-xs text-muted-foreground">Or use an agent CLI</summary><div class="mt-3">{@render agentCommands()}</div></details>
      {:else}
        <div>{@render agentCommands()}</div>
      {/if}
      <div class="mt-4"><Button variant="outline" onclick={reload} disabled={reloading}>{#if reloading}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}Reload</Button></div>
    {/if}
  </section>
</main>

<style>
  .feature { border-bottom: 1px solid color-mix(in srgb, var(--a-cyan) 18%, var(--line)); }
  .feature:last-child { border-bottom: 0; }
  .feature > summary { display: flex; align-items: center; gap: 10px; padding: 10px 16px; cursor: pointer; list-style: none; background: color-mix(in srgb, var(--a-cyan) 5%, transparent); }
  .feature > summary::-webkit-details-marker { display: none; }
  .feature > summary :global(.fchev) { flex: none; color: var(--muted-fg); transition: transform 0.15s; }
  .feature:not([open]) > summary :global(.fchev) { transform: rotate(-90deg); }
  .cov { font: 500 11px var(--fm); text-transform: none; letter-spacing: 0; padding: 1px 6px; border-radius: 3px; border: 1px solid; }
  .cov.ok { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 45%, var(--line)); }
  .cov.gap { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 50%, var(--line)); }
  .cov-list { border-bottom: 1px solid color-mix(in srgb, var(--a-cyan) 14%, var(--line)); padding: 8px 16px; font-size: 13px; }
  .cov-list summary { cursor: pointer; font: 500 12px var(--fm); color: var(--muted-fg); }
  .cov-list.gap summary { color: var(--warning); }
  .cov-list .dim { margin-left: 6px; }
  .cov-list p { margin: 8px 0 6px; max-width: 70ch; color: var(--muted-fg); }
  .cov-list ul { margin: 0 0 8px; padding: 0; list-style: none; font: 12px var(--fm); max-height: 260px; overflow: auto; }
  .cov-list li { padding: 1px 0; overflow-wrap: anywhere; }
  .cov-list .why { display: block; padding-left: 12px; color: var(--muted-fg); font-family: inherit; font-size: 11px; }
  .recompute-all.inline { margin-left: 0; }
  .recompute-all { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: var(--muted-fg); font: 500 11px var(--fm); text-transform: none; transition: all 0.15s; }
  .recompute-all:hover, .recompute-all[aria-expanded="true"] { color: var(--fg); border-color: color-mix(in srgb, var(--a-cyan) 55%, var(--line)); }
  .recompute-all.stale { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 55%, var(--line)); }
  .tool { height: 26px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: var(--muted-fg); font: 500 12px var(--fm); transition: all 0.15s; }
  .tool:hover { color: var(--fg); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); }
  .tool.on { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); background: color-mix(in srgb, var(--a-green) 10%, transparent); }
</style>
