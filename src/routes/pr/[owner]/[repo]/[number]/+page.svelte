<script lang="ts">
  import { ArrowRight, GitBranch, LoaderCircle, RefreshCw } from '@lucide/svelte';
  import { invalidateAll } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import CommandBlock from '$lib/components/CommandBlock.svelte';
  import WorkflowRow from '$lib/components/WorkflowRow.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let tool = $state<'claude' | 'codex'>('claude');
  let generating = $state(false);
  let generateError = $state('');
  let reloading = $state(false);
  let base = $derived(`/pr/${data.params.owner}/${data.params.repo}/${data.params.number}`);
  let hasWorkflows = $derived(data.workflows.length > 0);

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

  async function reload() {
    reloading = true;
    try { await invalidateAll(); } finally { reloading = false; }
  }
</script>

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
      <span>Analyzed at <code class="text-xs">{data.analysis.headSha.slice(0, 7)}</code>. The pull request is now at <code class="text-xs">{data.pr.headSha.slice(0, 7)}</code>.{data.setup.apiConfigured ? '' : ' Re-run the command below.'}</span>
      {#if data.setup.apiConfigured}<Button variant="outline" onclick={generate} disabled={generating}>{#if generating}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}Regenerate</Button>{/if}
    </div>
  {/if}

  <section class="mt-5">
    {#if hasWorkflows}
      <div class="panel panel-cyan">
        <div class="panel-head"><span class="tab">Workflows</span><span class="dim">{data.workflows.length}</span></div>
        {#each data.workflows as workflow, index (workflow.id)}<WorkflowRow {workflow} {index} href="{base}/{workflow.id}/1" />{/each}
      </div>
      {#if generateError}<p class="mt-2 text-sm text-destructive" role="alert">{generateError}</p>{/if}
      {#if !data.setup.apiConfigured && data.stale}
        <div class="mt-5">{@render agentCommands()}</div>
      {/if}
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
  .tool { height: 26px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: var(--muted-fg); font: 500 12px var(--fm); transition: all 0.15s; }
  .tool:hover { color: var(--fg); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); }
  .tool.on { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); background: color-mix(in srgb, var(--a-green) 10%, transparent); }
</style>
