<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, ChevronDown, ChevronUp, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import CommandBlock from './CommandBlock.svelte';

  type Tool = 'claude' | 'codex';
  type ToolSteps = { mcp: boolean; skill: boolean };
  type PerTool = { claude: string; codex: string };

  let { commands, steps, onRefresh, refreshing }: {
    commands: { register: PerTool; installSkill: PerTool };
    steps: { claude: ToolSteps; codex: ToolSteps; appUrl: boolean; analyzed: boolean };
    onRefresh: () => void;
    refreshing: boolean;
  } = $props();

  const STORAGE_KEY = 'trace:setup:v1';
  const ready = (tool: ToolSteps) => tool.mcp && tool.skill;

  let picked = $state<Tool | null>(null);
  let stored = $state<'open' | 'closed' | null>(null);
  let tool = $derived<Tool>(picked ?? (!ready(steps.claude) && ready(steps.codex) ? 'codex' : 'claude'));
  let toolSteps = $derived(steps[tool]);
  let configured = $derived((ready(steps.claude) || ready(steps.codex)) && steps.appUrl);
  let open = $derived(stored ? stored === 'open' : !configured);

  onMount(() => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === 'open' || value === 'closed') stored = value;
    } catch { /* storage unavailable */ }
  });

  function toggle() {
    stored = open ? 'closed' : 'open';
    try { localStorage.setItem(STORAGE_KEY, stored); } catch { /* storage unavailable */ }
  }
</script>

<section class="panel panel-cyan">
  <div class="panel-head">
    <span class="tab">setup</span>
    {#if configured}<span class="dim flex items-center gap-1"><Check size={14} style="color: var(--a-green)" aria-hidden="true" />all set</span>{/if}
    <button type="button" class="toggle ml-auto" onclick={toggle} aria-expanded={open} aria-controls="setup-body" aria-label={open ? 'Collapse setup' : 'Expand setup'}>
      {#if open}<ChevronUp size={16} aria-hidden="true" />{:else}<ChevronDown size={16} aria-hidden="true" />{/if}
    </button>
  </div>
  <div id="setup-body" hidden={!open} class="grid gap-x-10 gap-y-6 px-5 pt-5 pb-6 lg:grid-cols-12">
    <div class="min-w-0 lg:col-span-5">
    <svg viewBox="0 0 320 56" class="mb-4 h-14 w-full max-w-[320px]" fill="none" aria-hidden="true">
      <path id="trace-path" d="M8 40h60l22-28h70l22 28h54l22-28h42" stroke="var(--line)" stroke-width="2" stroke-linejoin="round" />
      <path d="M8 40h60l22-28h70l22 28h54l22-28h42" stroke="var(--a-cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" pathLength="100" class="pulse" />
      {#each [[8, 40], [90, 12], [182, 40], [258, 12]] as [x, y]}<circle cx={x} cy={y} r="4" fill="var(--canvas)" stroke="var(--a-cyan)" stroke-width="2" />{/each}
      <circle cx="312" cy="12" r="4.5" fill="var(--kind-ui)" />
    </svg>
    <h1 class="text-[22px] leading-tight font-semibold tracking-tight">Set up the {tool === 'claude' ? '/trace' : '$trace'} skill</h1>
    <p class="mt-1 text-muted-foreground">Trace reads pull requests through {tool === 'claude' ? 'Claude Code' : 'Codex'}. Run these once, then use {tool === 'claude' ? '/trace' : '$trace'} in any repository.</p>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <Button onclick={onRefresh} disabled={refreshing}>{#if refreshing}<LoaderCircle class="animate-spin" />{/if}Check again</Button>
    </div>
    <p class="mt-5 hidden lg:block font-mono text-xs text-muted-foreground">Optional: GITHUB_TOKEN gives access to private repositories and higher GitHub rate limits. WALKTHROUGH_API_KEY, WALKTHROUGH_API_URL and WALKTHROUGH_MODEL generate workflows without an agent CLI.</p>
    </div>
    <div class="min-w-0 lg:col-span-7">
    <div role="tablist" aria-label="Agent CLI" class="mb-4 flex gap-1.5">
      {#each [['claude', 'Claude Code'], ['codex', 'Codex']] as const as [id, name]}
        <button role="tab" aria-selected={tool === id} class="tool {tool === id ? 'on' : ''}" onclick={() => (picked = id)}>{name}</button>
      {/each}
    </div>
    <ol class="flex flex-col gap-4">
      <li class="step">
        <span class="n" class:done={toolSteps.mcp}>{#if toolSteps.mcp}<Check size={14} aria-hidden="true" />{:else}1{/if}</span>
        <div class="flex min-w-0 flex-col gap-2"><span>Register the Trace MCP server.<span class="sr-only">{toolSteps.mcp ? 'Completed' : 'Not completed'}</span></span><CommandBlock command={commands.register[tool]} label={tool} tone={toolSteps.mcp ? 'green' : 'warning'} /></div>
      </li>
      <li class="step">
        <span class="n" class:done={toolSteps.skill}>{#if toolSteps.skill}<Check size={14} aria-hidden="true" />{:else}2{/if}</span>
        <div class="flex min-w-0 flex-col gap-2"><span>Install the skill.<span class="sr-only">{toolSteps.skill ? 'Completed' : 'Not completed'}</span></span><CommandBlock command={commands.installSkill[tool]} label={tool} tone={toolSteps.skill ? 'green' : 'warning'} /></div>
      </li>
      <li class="step">
        <span class="n" class:done={steps.appUrl}>{#if steps.appUrl}<Check size={14} aria-hidden="true" />{:else}3{/if}</span>
        <div class="flex min-w-0 flex-col gap-2"><span>Optional: add the app address to .env so the skill prints a link.<span class="sr-only">{steps.appUrl ? 'Completed' : 'Not completed'}</span></span>
          {#if steps.appUrl}
            <span class="flex items-center gap-1 font-mono text-[13px] text-muted-foreground"><Check size={14} aria-hidden="true" />TRACE_APP_URL is set</span>
          {:else}
            <CommandBlock command="TRACE_APP_URL=http://localhost:5173" label=".env" tone="warning" />
          {/if}
        </div>
      </li>
      <li class="step">
        <span class="n" class:done={steps.analyzed}>{#if steps.analyzed}<Check size={14} aria-hidden="true" />{:else}4{/if}</span>
        <div class="flex min-w-0 flex-col gap-2"><span>On a branch with an open pull request, run it.<span class="sr-only">{steps.analyzed ? 'Completed' : 'Not completed'}</span></span>
          <CommandBlock command={tool === 'claude' ? 'claude /trace' : "codex '$trace'"} label={tool} tone={steps.analyzed ? 'green' : 'warning'} />
        </div>
      </li>
    </ol>
    <p class="mt-5 lg:hidden font-mono text-xs text-muted-foreground">Optional: GITHUB_TOKEN gives access to private repositories and higher GitHub rate limits. WALKTHROUGH_API_KEY, WALKTHROUGH_API_URL and WALKTHROUGH_MODEL generate workflows without an agent CLI.</p>
    </div>
  </div>
</section>

<style>
  .tool { height: 26px; padding: 0 10px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: var(--muted-fg); font: 500 12px var(--fm); transition: all 0.15s; }
  .tool:hover { color: var(--fg); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); }
  .tool.on { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); background: color-mix(in srgb, var(--a-green) 10%, transparent); }
  .step { display: flex; gap: 12px; align-items: flex-start; }
  .step > :last-child { min-width: 0; flex: 1; }
  .n { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 40%, var(--line)); background: color-mix(in srgb, var(--warning) 10%, transparent); }
  .n.done { color: var(--a-green); border-color: color-mix(in srgb, var(--a-green) 40%, var(--line)); background: color-mix(in srgb, var(--a-green) 10%, transparent); }
  .n { display: grid; place-items: center; flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 4px; font: 600 12px var(--fm); border: 1px solid; }
  .toggle { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 4px; border: 1px solid var(--line); background: transparent; color: var(--muted-fg); transition: all 0.15s; }
  .toggle:hover { color: var(--fg); border-color: color-mix(in srgb, var(--a-green) 50%, var(--line)); }
  #setup-body[hidden] { display: none; }
  .pulse { stroke-dasharray: 14 86; animation: travel 2.6s linear infinite; filter: drop-shadow(0 0 4px var(--a-cyan)); }
  @keyframes travel { from { stroke-dashoffset: 14; } to { stroke-dashoffset: -86; } }
</style>
