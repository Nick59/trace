<script lang="ts">
  import { CircleCheck, ExternalLink } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { motionMs } from '$lib/kinds';
  import KindBadge from '$lib/components/KindBadge.svelte';
  import StepRail from '$lib/components/StepRail.svelte';
  import ReviewDiff from '$lib/components/ReviewDiff.svelte';
  import StepNav from '$lib/components/StepNav.svelte';
  import WorkflowGraph from '$lib/components/WorkflowGraph.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let base = $derived(`${data.prPath}/${data.workflow.id}`);
  let steps = $derived(data.workflow.steps.map((step) => ({ id: step.id, title: step.title })));
  let fileUrl = $derived(data.file?.status === 'removed' ? `${data.pr.url}/files` : `https://github.com/${data.pr.repository}/blob/${data.pr.headSha}/${data.step.path.split('/').map(encodeURIComponent).join('/')}`);
  let heading = $state<HTMLElement>();
  let kind = $derived(data.workflow.entrypoint.kind);
  let num = $derived(String(data.stepNumber).padStart(2, '0'));

  $effect(() => {
    void data.stepNumber;
    heading?.scrollIntoView({ block: 'nearest' });
  });
</script>

<svelte:head><title>{data.step.title} · {data.workflow.title} · trace</title></svelte:head>

<div class="step-bar sticky top-0 z-20 border-b backdrop-blur-md" data-kind={kind} style="background: color-mix(in srgb, var(--a-cyan) 7%, color-mix(in srgb, var(--canvas) 90%, transparent)); border-color: color-mix(in srgb, var(--a-cyan) 28%, var(--line))">
  <div class="panel-head panel-cyan" style="--p-accent: var(--a-cyan); background: color-mix(in srgb, var(--a-cyan) 9%, transparent)">
    <div class="mx-auto flex w-full max-w-[1120px] items-center gap-2.5 px-4 sm:px-6">
      <span class="tab">Workflow</span>
      <h1 class="grow truncate text-[12px] font-medium normal-case tracking-normal text-foreground">{data.workflow.title}</h1>
      <KindBadge {kind} />
      <span class="shrink-0">Step {data.stepNumber}/{data.stepCount}</span>
    </div>
  </div>
  <div class="mx-auto max-w-[1120px] px-4 pt-1 sm:px-6">
    <div class="pb-2">
      <WorkflowGraph source={data.mermaid} {kind} currentId={data.step.id} {steps} {base} onSelect={(n) => goto(`${base}/${n}`, { reset: false })} />
    </div>
    <div class="pb-2.5"><StepRail {steps} current={data.stepNumber} {base} /></div>
    <div class="pb-2"><StepNav {base} stepNumber={data.stepNumber} stepCount={data.stepCount} prev={data.prev} next={data.next} backHref={data.prPath} /></div>
  </div>
</div>

<main class="mx-auto flex max-w-[1120px] flex-col gap-4 px-4 py-4 sm:px-6">
  {#key data.stepNumber}
    <div class="flex flex-col gap-4" in:fly={{ y: 8, duration: motionMs(240) }}>
      <section class="panel panel-violet" data-kind={kind} aria-labelledby="step-title">
        <div class="panel-head"><span class="tab">Step {data.stepNumber}/{data.stepCount}</span><span class="dim grow truncate">{data.step.path}</span></div>
        <div class="flex gap-4 border-l-[3px] p-4 sm:gap-5 sm:p-5" style="border-left-color: var(--k)">
          <div class="hidden font-mono text-[44px] leading-none font-semibold tracking-tighter sm:block" style="color: color-mix(in srgb, var(--a-violet) 80%, transparent)" aria-hidden="true">{num}</div>
          <div class="min-w-0 flex-1">
            <h2 id="step-title" bind:this={heading} class="scroll-mt-72 text-xl leading-snug font-semibold tracking-tight">{data.step.title}</h2>
            <p class="mt-1.5 max-w-[72ch] text-[15px] leading-relaxed">{data.step.summary}</p>
            <div class="mt-4 grid gap-5 {data.step.symbols.length && data.step.checks.length ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}">
              {#if data.step.symbols.length}
                <div>
                  <h3 class="mb-2 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Symbols</h3>
                  <div class="flex flex-wrap gap-1.5">{#each data.step.symbols as symbol}<code class="chip">{symbol}</code>{/each}</div>
                </div>
              {/if}
              {#if data.step.checks.length}
                <div>
                  <h3 class="mb-2 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Check</h3>
                  <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">{#each data.step.checks as check}<li class="flex gap-2"><CircleCheck size={16} class="mt-0.5 shrink-0" style="color: var(--a-violet)" aria-hidden="true" /><span>{check}</span></li>{/each}</ul>
                </div>
              {/if}
            </div>
          </div>
        </div>
      </section>

      <section class="panel" aria-label="Diff">
        <div class="panel-head" style="--p-accent: var(--neutral)">
          <span class="tab">Diff</span>
          <span class="grow truncate text-foreground normal-case tracking-normal [overflow-wrap:anywhere]">{data.step.path}</span>
          {#if data.file}
            <span class="dim hidden sm:inline">{data.file.status}</span>
            <span style="color: var(--addition-fg)">+{data.file.additions}</span><span style="color: var(--deletion-fg)">−{data.file.deletions}</span>
          {/if}
          <a href={fileUrl} target="_blank" rel="noreferrer" class="inline-flex shrink-0 items-center gap-1 normal-case tracking-normal text-primary hover:underline" aria-label="View on GitHub">GitHub<ExternalLink size={12} aria-hidden="true" /></a>
        </div>
        <ReviewDiff file={data.file} />
      </section>
    </div>
  {/key}
</main>

<style>
  @media (max-height: 520px) { .step-bar { position: static; } }
</style>
