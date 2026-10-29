<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, ExternalLink, RefreshCw } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fly } from 'svelte/transition';
  import { motionMs } from '$lib/kinds';
  import KindBadge from '$lib/components/KindBadge.svelte';
  import ReviewDiff from '$lib/components/ReviewDiff.svelte';
  import { graphNav, type GraphNav, type NavMemory } from '$lib/graph-nav';
  import { navHints } from '$lib/nav-state.svelte';
  import StepNav from '$lib/components/StepNav.svelte';
  import WorkflowGraph from '$lib/components/WorkflowGraph.svelte';
  import { ResizableHandle, ResizablePane, ResizablePaneGroup } from '$lib/components/ui/resizable';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let base = $derived(`${data.prPath}/${data.workflow.id}`);
  let steps = $derived(data.workflow.steps.map((step) => ({ id: step.id, title: step.title })));
  let current = $derived(data.files.find((file) => file.path === page.url.searchParams.get('file')) ?? data.files[0] ?? data.file);
  let currentPath = $derived(current?.path ?? data.step.path);
  let fileUrl = $derived(current?.status === 'removed' ? `${data.pr.url}/files` : `https://github.com/${data.pr.repository}/blob/${data.pr.headSha}/${currentPath.split('/').map(encodeURIComponent).join('/')}`);
  const fileHref = (index: number) => index === 0 ? page.url.pathname : `?file=${encodeURIComponent(data.files[index].path)}`;
  let graphOpen = $state(false);
  let zoom = $state<'fit' | '1:1'>('fit');
  const zoomKey = 'trace:graph-zoom';
  onMount(() => {
    try { if (localStorage.getItem(zoomKey) === '1:1') zoom = '1:1'; } catch { /* storage unavailable */ }
  });
  function setZoom(value: 'fit' | '1:1') {
    zoom = value;
    try { localStorage.setItem(zoomKey, value); } catch { /* storage unavailable */ }
  }
  let root = $state<HTMLElement>();
  let content = $state<HTMLElement>();
  let diffScroll = $state<HTMLElement>();

  const layoutKey = 'trace:layout:v1';
  const defaults = { h: 100 / 3, graphCollapsed: false, stepCollapsed: false };
  let layout = $state({ ...defaults });
  let ready = $state(false);
  let desktop = $state(false);
  let width = $state(1200);
  let graphPane = $state<{ resize(size: number): void }>();
  let saving = false;
  let minGraph = $derived(Math.min(45, Math.max(8, (240 / Math.max(width, 480)) * 100)));
  let minContent = $derived(Math.min(45, Math.max(8, (240 / Math.max(width, 480)) * 100)));
  let showPanes = $derived(ready && desktop);

  function persist() {
    if (!saving) return;
    try { localStorage.setItem(layoutKey, JSON.stringify(layout)); } catch { /* storage unavailable */ }
  }
  function restore() {
    try {
      const stored = JSON.parse(localStorage.getItem(layoutKey) ?? 'null');
      if (!stored || typeof stored !== 'object') return;
      const size = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && value >= min && value <= max ? value : fallback;
      layout = { h: size(stored.h, defaults.h, 8, 70),
        graphCollapsed: stored.graphCollapsed === true, stepCollapsed: stored.stepCollapsed === true };
    } catch { /* ignore unreadable layout */ }
  }
  function collapse(key: 'graphCollapsed' | 'stepCollapsed', value: boolean) {
    layout[key] = value;
    persist();
  }
  const horizontalChange = (sizes: number[]) => { if (saving && sizes.length === 2) { layout.h = sizes[0]; persist(); } };

  onMount(() => {
    restore();
    const query = matchMedia('(min-width: 1024px)');
    desktop = query.matches;
    const sync = () => (desktop = query.matches);
    query.addEventListener('change', sync);
    ready = true;
    // Layout events fired while the panes mount at their saved sizes must not overwrite what was just restored.
    const timer = setTimeout(() => (saving = true), 300);
    return () => { query.removeEventListener('change', sync); clearTimeout(timer); };
  });

  const handleProps = (label: string, value: number) =>
    ({ 'aria-label': label, 'aria-orientation': 'vertical', 'aria-valuenow': Math.round(value), 'aria-valuemin': 0, 'aria-valuemax': 100 }) as const;

  // Branch memory lives only in the browser tab: where the user came from and which branch they last took at a fork.
  const memories = new Map<string, Required<NavMemory>>();
  const memory = () => {
    if (!memories.has(data.workflow.id)) memories.set(data.workflow.id, { cameFrom: {}, choices: {} });
    return memories.get(data.workflow.id)!;
  };
  const none: GraphNav = { up: null, down: null, left: null, right: null };
  let nav = $state<GraphNav>(none);
  let graphVersion = $state(0);
  const renderedX = (id: string) => {
    for (const node of document.querySelectorAll('#step-graph g.node')) if (node.id.match(/-(s\d+)-\d+$/)?.[1] === id) return node.getBoundingClientRect().x;
  };
  $effect(() => {
    void graphVersion;
    nav = graphNav(data.workflow.steps, data.workflow.edges, data.step.id, memory(), renderedX);
  });
  $effect(() => { Object.assign(navHints, { up: nav.up !== null, down: nav.down !== null, left: nav.left !== null, right: nav.right !== null }); });
  $effect(() => () => Object.assign(navHints, { up: false, down: false, left: false, right: false }));
  let marked = $derived([nav.left, nav.right].filter((id): id is string => id !== null));

  function move(direction: keyof GraphNav) {
    const target = nav[direction];
    if (!target) return;
    const mem = memory();
    const here = data.step.id;
    if (direction === 'down') { mem.cameFrom[target] = here; mem.choices[here] = target; }
    else if (direction === 'up') mem.choices[target] = here;
    else if (nav.up) { mem.cameFrom[target] = nav.up; mem.choices[nav.up] = target; }
    goto(`${base}/${target.slice(1)}`, { reset: false });
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="separator"]')) return;
    const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[event.key as 'ArrowUp'];
    if (!direction) return;
    event.preventDefault();
    move(direction);
  }
  let kind = $derived(data.workflow.entrypoint.kind);
  let num = $derived(String(data.stepNumber).padStart(2, '0'));

  $effect(() => {
    void data.stepNumber;
    for (const node of [content, root, diffScroll]) if (node) node.scrollTop = 0;
  });
</script>

<svelte:head><title>{data.step.title} · {data.workflow.title} · trace</title></svelte:head>
<svelte:window {onkeydown} bind:innerWidth={width} />

{#snippet graphAside(inPane: boolean)}
  <aside class="pane flex h-full flex-col {inPane ? '' : 'sticky top-0 z-10 border-b lg:static lg:min-h-0 lg:border-r lg:border-b-0'}" data-kind={kind} aria-label="Workflow graph">
    <div class="panel-head panel-cyan order-1 shrink-0" style="--p-accent: var(--a-cyan); min-height: 36px">
      {#if inPane}
        <button type="button" class="kbd" aria-label="Collapse workflow pane" title="Collapse workflow pane" aria-expanded="true" onclick={() => collapse('graphCollapsed', true)}><ChevronLeft size={14} aria-hidden="true" /></button>
      {/if}
      <span class="tab">Workflow</span>
      <div class="grow min-w-0">
        {#if data.workflow.feature}<div class="truncate font-mono text-[10px] leading-tight normal-case tracking-normal text-muted-foreground" title="Feature{data.workflow.actor ? ` · ${data.workflow.actor}` : ''}">{data.workflow.feature}</div>{:else if data.workflow.actor}<div class="truncate font-mono text-[10px] leading-tight normal-case tracking-normal text-muted-foreground" title="Actor">{data.workflow.actor}</div>{/if}
        <h1 class="truncate text-[12px] font-medium normal-case tracking-normal text-foreground" title={data.workflow.title}>{data.workflow.title}</h1>
      </div>
      <KindBadge {kind} />
      <span class="shrink-0">Step {data.stepNumber}/{data.stepCount}</span>
      <div class="flex shrink-0 gap-0.5" role="group" aria-label="Graph zoom">
        <button type="button" class="kbd" class:zoom-on={zoom === 'fit'} aria-pressed={zoom === 'fit'} aria-label="Fit graph to pane width" title="Fit graph to pane width" onclick={() => setZoom('fit')}>Fit</button>
        <button type="button" class="kbd" class:zoom-on={zoom === '1:1'} aria-pressed={zoom === '1:1'} aria-label="Show graph at actual size (1:1)" title="Show graph at actual size (1:1)" onclick={() => setZoom('1:1')}>1:1</button>
      </div>
      {#if !inPane}
        <button type="button" class="kbd lg:hidden" aria-expanded={graphOpen} aria-controls="step-graph" aria-label={graphOpen ? 'Collapse graph' : 'Expand graph'} onclick={() => (graphOpen = !graphOpen)}>
          <ChevronDown size={14} class={graphOpen ? 'rotate-180' : ''} aria-hidden="true" />
        </button>
      {/if}
    </div>
    <div id="step-graph" class="order-3 min-h-0 {inPane ? 'flex-1' : `h-[45dvh] lg:order-2 lg:h-auto lg:flex-1 ${graphOpen ? 'block' : 'hidden lg:block'}`}">
      <WorkflowGraph bind:zoom source={data.mermaid} {kind} currentId={data.step.id} {steps} {base} onSelect={(n) => goto(`${base}/${n}`, { reset: false })} markIds={marked} onrendered={() => graphVersion++} />
    </div>
    <div class="order-2 shrink-0 border-t px-3 py-2 lg:order-3" style="border-color: color-mix(in srgb, var(--a-cyan) 22%, var(--line))">
      <StepNav {base} stepNumber={data.stepNumber} stepCount={data.stepCount} prev={data.prev} next={data.next} backHref={data.prPath} />
    </div>
    <div class="order-4 shrink-0 px-3 pb-2 font-mono text-[11px] {inPane || graphOpen ? 'block' : 'hidden lg:block'}">
      <a href="{data.prPath}#recompute-{data.workflow.id}" class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"><RefreshCw size={11} aria-hidden="true" />Recompute workflow</a>
    </div>
  </aside>
{/snippet}

{#snippet stepPanel(collapsible: boolean)}
  {#key data.stepNumber}
    <section class="panel panel-violet" data-kind={kind} aria-labelledby="step-title" in:fly={{ y: 8, duration: motionMs(240) }}>
      <div class="panel-head">
        {#if collapsible}
          <button type="button" class="kbd" aria-label="Collapse step panel" title="Collapse step panel" aria-expanded="true" onclick={() => collapse('stepCollapsed', true)}><ChevronUp size={14} aria-hidden="true" /></button>
        {/if}
        <span class="tab">Step {data.stepNumber}/{data.stepCount}</span><span class="dim grow truncate">{data.step.path}</span>
      </div>
      <div class="border-l-[3px] px-4 py-3.5" style="border-left-color: var(--k)">
        <h2 id="step-title" class="flex items-baseline gap-2.5 text-xl leading-tight font-semibold tracking-tight">
          <span class="shrink-0 rounded border px-1.5 py-px font-mono text-[11px] leading-none font-semibold" style="color: var(--a-violet); border-color: color-mix(in srgb, var(--a-violet) 40%, var(--line))" aria-hidden="true">{num}</span>
          <span class="min-w-0">{data.step.title}</span>
        </h2>
        <p class="mt-2 line-clamp-2 max-w-[75ch] text-[15px] leading-snug text-foreground" title={data.step.summary}>{data.step.summary}</p>
        {#if data.step.checks.length}
          <ul class="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-sm leading-snug text-foreground">{#each data.step.checks as check}<li class="flex gap-2"><CircleCheck size={16} class="mt-px shrink-0" style="color: var(--addition-fg)" aria-hidden="true" /><span>{check}</span></li>{/each}</ul>
        {/if}
      </div>
    </section>
  {/key}
{/snippet}

{#snippet collapsedStep()}
  <div class="panel panel-violet shrink-0" data-kind={kind}>
    <div class="panel-head">
      <button type="button" class="kbd" aria-label="Expand step panel" title="Expand step panel" aria-expanded="false" onclick={() => collapse('stepCollapsed', false)}><ChevronDown size={14} aria-hidden="true" /></button>
      <span class="shrink-0 font-mono text-xs font-semibold normal-case tracking-normal" style="color: var(--a-violet)">{num}</span>
      <span class="grow truncate font-sans text-xl leading-tight font-semibold normal-case tracking-tight text-foreground" title={data.step.title}>{data.step.title}</span>
    </div>
  </div>
{/snippet}

{#snippet diffPanel()}
  {#key data.stepNumber}
    <section class="panel" aria-label="Diff" in:fly={{ y: 8, duration: motionMs(240) }}>
      <div class="panel-head" style="--p-accent: var(--neutral)">
        <span class="tab">Diff</span>
        <span class="grow truncate text-foreground normal-case tracking-normal [overflow-wrap:anywhere]">{currentPath}</span>
        {#if current}
          <span class="dim hidden sm:inline">{current.status}</span>
          <span style="color: var(--addition-fg)">+{current.additions}</span><span style="color: var(--deletion-fg)">−{current.deletions}</span>
        {/if}
        <a href={fileUrl} target="_blank" rel="noreferrer" class="inline-flex shrink-0 items-center gap-1 normal-case tracking-normal text-primary hover:underline" aria-label="View on GitHub">GitHub<ExternalLink size={12} aria-hidden="true" /></a>
      </div>
      {#if data.files.length > 1}
        <div class="file-tabs" role="tablist" aria-label="Files in this step">
          {#each data.files as file, index (file.path)}
            <a role="tab" aria-selected={file.path === currentPath} class="file-tab" class:on={file.path === currentPath} href={fileHref(index)} data-sveltekit-noscroll data-sveltekit-keepfocus title={file.path}>
              <span class="name">{file.path}</span>
              <span style="color: var(--addition-fg)">+{file.additions}</span><span style="color: var(--deletion-fg)">−{file.deletions}</span>
            </a>
          {/each}
        </div>
      {/if}
      <ReviewDiff file={current} />
    </section>
  {/key}
{/snippet}

{#if showPanes}
  <div class="step-root h-full overflow-hidden">
    {#if layout.graphCollapsed}
      <div class="flex h-full">
        <aside class="pane rail flex w-9 shrink-0 flex-col items-center gap-2 border-r py-2" data-kind={kind} aria-label="Workflow graph (collapsed)">
          <button type="button" class="kbd" aria-label="Expand workflow pane" title="Expand workflow pane" aria-expanded="false" onclick={() => collapse('graphCollapsed', false)}><ChevronRight size={14} aria-hidden="true" /></button>
          <span class="rail-label font-mono text-[11px] tracking-widest text-muted-foreground uppercase">Workflow</span>
          <span class="font-mono text-[11px] text-muted-foreground">{data.stepNumber}/{data.stepCount}</span>
        </aside>
        <div class="min-w-0 flex-1">{@render contentPanes()}</div>
      </div>
    {:else}
      <ResizablePaneGroup direction="horizontal" onLayoutChange={horizontalChange}>
        <ResizablePane bind:this={graphPane} defaultSize={layout.h} minSize={minGraph} order={1} id="graph-pane">{@render graphAside(true)}</ResizablePane>
        <ResizableHandle id="graph-handle" ondblclick={() => graphPane?.resize(defaults.h)} {...handleProps('Resize workflow pane', layout.h)} />
        <ResizablePane minSize={minContent} order={2} id="content-pane">{@render contentPanes()}</ResizablePane>
      </ResizablePaneGroup>
    {/if}
  </div>
{:else}
  <div class="step-root h-full overflow-y-auto lg:grid lg:grid-cols-[minmax(320px,1fr)_2fr] lg:overflow-hidden" bind:this={root}>
    {@render graphAside(false)}
    <main class="min-w-0 p-3 sm:p-4 lg:min-h-0 lg:overflow-auto" bind:this={content}>
      <div class="flex flex-col gap-4">{@render stepPanel(false)}{@render diffPanel()}</div>
    </main>
  </div>
{/if}

{#snippet contentPanes()}
  <div class="flex h-full flex-col gap-2 p-3">
    {#if layout.stepCollapsed}
      {@render collapsedStep()}
    {:else}
      <div class="max-h-[45%] shrink-0 overflow-auto">{@render stepPanel(true)}</div>
    {/if}
    <div class="diff-fill min-h-0 flex-1" bind:this={diffScroll}>{@render diffPanel()}</div>
  </div>
{/snippet}

<style>
  .rail { background: color-mix(in srgb, var(--a-cyan) 5%, var(--canvas)); border-color: color-mix(in srgb, var(--a-cyan) 28%, var(--line)); }
  .rail-label { writing-mode: vertical-rl; transform: rotate(180deg); }
  :global([data-slot='resizable-handle']) { position: relative; flex: none; background: var(--line); transition: background-color 0.15s; }
  :global([data-slot='resizable-handle'][data-direction='horizontal']) { width: 1px; }
  :global([data-slot='resizable-handle']::before) { content: ''; position: absolute; inset: 0; }
  :global([data-slot='resizable-handle'][data-direction='horizontal']::before) { left: -3px; right: -3px; }
  :global([data-slot='resizable-handle']::after) { content: ''; position: absolute; left: 50%; top: 50%; translate: -50% -50%; border-radius: 2px; background: var(--muted-fg); opacity: 0.55; transition: background-color 0.15s, opacity 0.15s; }
  :global([data-slot='resizable-handle'][data-direction='horizontal']::after) { width: 3px; height: 22px; }
  :global([data-slot='resizable-handle']:hover), :global([data-slot='resizable-handle']:focus-visible), :global([data-slot='resizable-handle'][data-active]) { background: var(--a-cyan); outline: none; }
  :global([data-slot='resizable-handle']:hover::after), :global([data-slot='resizable-handle']:focus-visible::after), :global([data-slot='resizable-handle'][data-active]::after) { background: var(--a-cyan); opacity: 1; }
  .diff-fill > :global(section) { display: flex; height: 100%; min-height: 0; flex-direction: column; }
  .diff-fill :global(.diff) { flex: 1 1 0; min-height: 0; max-height: none; }
  .file-tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--neutral) 6%, var(--canvas)); }
  .file-tab { display: inline-flex; flex: none; align-items: center; gap: 8px; max-width: 420px; padding: 6px 12px; border-right: 1px solid var(--line); border-bottom: 2px solid transparent; font: 500 11.5px var(--fm); color: var(--muted-fg); white-space: nowrap; }
  .file-tab .name { overflow: hidden; text-overflow: ellipsis; }
  .file-tab:hover { color: var(--fg); }
  .file-tab.on { color: var(--fg); border-bottom-color: var(--a-violet); background: var(--canvas); }
  .zoom-on { color: var(--fg); border-color: var(--a-cyan); }
  .pane { background: color-mix(in srgb, var(--a-cyan) 5%, var(--canvas)); border-color: color-mix(in srgb, var(--a-cyan) 28%, var(--line)); }
</style>
