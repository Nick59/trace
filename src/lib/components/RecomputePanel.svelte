<script lang="ts">
  import { LoaderCircle, RefreshCw } from '@lucide/svelte';
  import { invalidateAll } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import CommandBlock from '$lib/components/CommandBlock.svelte';
  import { buildCliCommands, INSTRUCTION_MAX } from '$lib/cli-commands';

  let { workflowId, title, endpoint, apiConfigured, source, tool = $bindable('claude'), ondone }: {
    workflowId?: string; title: string; endpoint: string; apiConfigured: boolean;
    source: { url: string; launcher: string }; tool?: 'claude' | 'codex'; ondone: () => void;
  } = $props();

  let instruction = $state('');
  let busy = $state(false);
  let error = $state('');
  let commands = $derived(buildCliCommands(source.url, source.launcher));
  let command = $derived(workflowId ? commands.recompute(workflowId, instruction)[tool] : commands[tool]);

  async function run() {
    busy = true;
    error = '';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowId ? { instruction: instruction.trim() || undefined } : {}) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      await invalidateAll();
      ondone();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unable to recompute.';
    } finally {
      busy = false;
    }
  }

  async function reload() {
    busy = true;
    try { await invalidateAll(); } finally { busy = false; }
  }
</script>

<div id="recompute-{workflowId ?? 'all'}" class="panel-body" role="group" aria-label="Recompute {title}">
  {#if workflowId}
    <label class="mb-1 block font-mono text-xs text-muted-foreground" for="instruction-{workflowId}">Instruction (optional)</label>
    <textarea id="instruction-{workflowId}" bind:value={instruction} maxlength={INSTRUCTION_MAX} rows="2"
      placeholder="What to fix, e.g. include the DB write in UserRepository"
      class="mb-1 w-full resize-y rounded border bg-transparent px-2.5 py-2 text-sm"></textarea>
    <div class="mb-3 text-right font-mono text-[11px] text-muted-foreground">{instruction.length}/{INSTRUCTION_MAX}</div>
  {/if}

  {#if apiConfigured}
    <div class="flex flex-wrap items-center gap-3">
      <Button onclick={run} disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}{workflowId ? 'Recompute with model' : 'Generate workflows'}</Button>
      {#if busy}<span class="text-sm text-muted-foreground">Working, this can take a minute.</span>{/if}
    </div>
  {:else}
    <div role="tablist" aria-label="Agent CLI" class="mb-3 flex gap-1.5">
      {#each [['claude', 'Claude Code'], ['codex', 'Codex']] as const as [id, name]}
        <button role="tab" aria-selected={tool === id} class="tool {tool === id ? 'on' : ''}" onclick={() => (tool = id)}>{name}</button>
      {/each}
    </div>
    <div class="flex flex-col gap-4">
      <CommandBlock {command} label="{tool} command" />
      {#if !workflowId}
        <div class="flex flex-col gap-2">
          <p class="m-0 text-sm text-muted-foreground">First time? Register the MCP server once:</p>
          <CommandBlock command={commands.register[tool]} label="{tool} register command" />
        </div>
      {/if}
      <div><Button variant="outline" onclick={reload} disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<RefreshCw />{/if}Reload</Button></div>
    </div>
  {/if}
  {#if error}<p class="mt-2 mb-0 text-sm text-destructive" role="alert">{error}</p>{/if}
</div>

<style>
  .panel-body { padding: 12px 16px 14px; background: color-mix(in srgb, var(--a-cyan) 4%, transparent); border-top: 1px solid color-mix(in srgb, var(--a-cyan) 14%, var(--line)); scroll-margin-top: 72px; }
  textarea { border-color: var(--line); color: var(--fg); font: 13px var(--fm); }
  textarea:focus-visible { outline: 2px solid color-mix(in srgb, var(--a-green) 60%, transparent); outline-offset: 1px; }
  .tool { height: 26px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: var(--muted-fg); font: 500 12px var(--fm); transition: all 0.15s; }
  .tool:hover { color: var(--fg); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); }
  .tool.on { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); background: color-mix(in srgb, var(--a-green) 10%, transparent); }
</style>
