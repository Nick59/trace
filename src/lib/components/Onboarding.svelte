<script lang="ts">
  import { ExternalLink, LoaderCircle } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import CommandBlock from './CommandBlock.svelte';

  let { onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean } = $props();
</script>

<section class="panel panel-cyan mx-auto mt-6 max-w-[640px]">
  <div class="panel-head"><span class="tab">setup</span><span class="dim">github access</span></div>
  <div class="px-5 pt-5 pb-6">
    <svg viewBox="0 0 320 56" class="mb-4 h-14 w-full max-w-[320px]" fill="none" aria-hidden="true">
      <path id="trace-path" d="M8 40h60l22-28h70l22 28h54l22-28h42" stroke="var(--line)" stroke-width="2" stroke-linejoin="round" />
      <path d="M8 40h60l22-28h70l22 28h54l22-28h42" stroke="var(--a-cyan)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" pathLength="100" class="pulse" />
      {#each [[8, 40], [90, 12], [182, 40], [258, 12]] as [x, y]}<circle cx={x} cy={y} r="4" fill="var(--canvas)" stroke="var(--a-cyan)" stroke-width="2" />{/each}
      <circle cx="312" cy="12" r="4.5" fill="var(--kind-ui)" />
    </svg>
    <h1 class="text-[22px] leading-tight font-semibold tracking-tight">Connect GitHub</h1>
    <p class="mt-1 text-muted-foreground">Trace needs a personal access token to list your pull requests.</p>
    <ol class="mt-5 flex flex-col gap-4">
      <li class="step">
        <span class="n">1</span>
        <div>Create a token with read access to your repositories.
          <a class="mt-1 flex items-center gap-1 font-mono text-[13px] text-primary underline underline-offset-2" href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">github.com/settings/tokens<ExternalLink size={12} aria-hidden="true" /></a>
        </div>
      </li>
      <li class="step">
        <span class="n">2</span>
        <div class="flex min-w-0 flex-col gap-2">Add it to .env and restart the server.<CommandBlock command="GITHUB_TOKEN=ghp_..." label=".env" /></div>
      </li>
      <li class="step">
        <span class="n">3</span>
        <div><Button onclick={onRefresh} disabled={refreshing}>{#if refreshing}<LoaderCircle class="animate-spin" />{/if}Check again</Button></div>
      </li>
    </ol>
    <p class="mt-5 font-mono text-xs text-muted-foreground">Optional: set WALKTHROUGH_API_KEY, WALKTHROUGH_API_URL and WALKTHROUGH_MODEL to generate workflows without an agent CLI.</p>
  </div>
</section>

<style>
  .step { display: flex; gap: 12px; align-items: flex-start; }
  .step > :last-child { min-width: 0; flex: 1; }
  .n { display: grid; place-items: center; flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 4px; font: 600 12px var(--fm); color: var(--a-cyan); border: 1px solid color-mix(in srgb, var(--a-cyan) 40%, var(--line)); background: color-mix(in srgb, var(--a-cyan) 10%, transparent); }
  .pulse { stroke-dasharray: 14 86; animation: travel 2.6s linear infinite; filter: drop-shadow(0 0 4px var(--a-cyan)); }
  @keyframes travel { from { stroke-dashoffset: 14; } to { stroke-dashoffset: -86; } }
</style>
