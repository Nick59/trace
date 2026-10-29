<script lang="ts">
  import { onMount } from 'svelte';
  import { kindHex } from '$lib/kinds';
  import type { EntrypointKind } from '$lib/types';

  type Step = { id: string; title: string };
  let { source, currentId, steps, base, kind = 'other', onSelect }: {
    source: string; kind?: EntrypointKind; currentId: string; steps: Step[]; base: string; onSelect: (stepNumber: number) => void;
  } = $props();

  let container = $state<HTMLDivElement>();
  let status = $state<'loading' | 'ready' | 'failed'>('loading');
  let mermaidModule: typeof import('mermaid').default | undefined;
  let renderCount = 0;
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
  let dark = $state(scheme?.matches ?? false);

  // Hex equivalents of the app.css tokens; Mermaid cannot parse light-dark() or OKLCH.
  const palette = {
    light: { surface: '#ffffff', border: '#d0d7de', text: '#1f2328', line: '#59636e' },
    dark: { surface: '#0d1117', border: '#30363d', text: '#e6edf3', line: '#8b949e' }
  };
  const monoFont = '"JetBrains Mono", ui-monospace, monospace';

  async function draw() {
    if (!mermaidModule || !container) return;
    const token = ++renderCount;
    try {
      await document.fonts?.load(`12px ${monoFont}`).catch(() => undefined);
      if (token !== renderCount) return;
      const colors = palette[dark ? 'dark' : 'light'];
      mermaidModule.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          darkMode: dark,
          background: colors.surface,
          primaryColor: colors.surface,
          primaryBorderColor: kindHex[dark ? 'dark' : 'light'][kind] ?? colors.border,
          primaryTextColor: colors.text,
          lineColor: kindHex[dark ? 'dark' : 'light'][kind] ?? colors.line,
          textColor: colors.text,
          fontSize: '12px',
          fontFamily: monoFont
        },
        fontFamily: monoFont,
        flowchart: { useMaxWidth: false, htmlLabels: true, nodeSpacing: 36, rankSpacing: 48, padding: 10, curve: 'basis' }
      });
      const { svg } = await mermaidModule.render(`trace-graph-${token}`, source);
      if (token !== renderCount) return;
      container.innerHTML = svg;
      bindNodes();
      status = 'ready';
      highlight();
    } catch {
      if (token === renderCount) status = 'failed';
    }
  }

  function nodeElements(): [SVGGElement, number][] {
    const found: [SVGGElement, number][] = [];
    container?.querySelectorAll<SVGGElement>('g.node').forEach((node) => {
      const id = node.id.match(/-(s\d+)-\d+$/)?.[1];
      const index = steps.findIndex((step) => step.id === id);
      if (index >= 0) found.push([node, index]);
    });
    return found;
  }

  function bindNodes() {
    for (const [node, index] of nodeElements()) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'link');
      node.setAttribute('aria-label', `Step ${index + 1}: ${steps[index].title}`);
      node.style.cursor = 'pointer';
      node.addEventListener('click', () => onSelect(index + 1));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index + 1); }
      });
    }
  }

  function highlight() {
    const current = steps.findIndex((step) => step.id === currentId);
    for (const [node, index] of nodeElements()) {
      const active = index === current;
      node.classList.toggle('trace-current', active);
      node.classList.toggle('trace-visited', index < current);
      node.classList.toggle('trace-upcoming', index > current);
      if (active) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
      if (active) (node as unknown as Element).scrollIntoView({ inline: 'center', block: 'nearest' });
    }
    container?.querySelectorAll<SVGPathElement>('path.flowchart-link').forEach((edge) => {
      const to = steps.findIndex((step) => edge.classList.contains(`LE-${step.id}`));
      edge.classList.toggle('trace-edge-future', to > current);
    });
  }

  onMount(() => {
    const onScheme = (event: MediaQueryListEvent) => (dark = event.matches);
    scheme?.addEventListener('change', onScheme);
    import('mermaid').then((module) => { mermaidModule = module.default; draw(); }).catch(() => (status = 'failed'));
    return () => { renderCount++; scheme?.removeEventListener('change', onScheme); };
  });

  $effect(() => { void source; void dark; draw(); });
  $effect(() => { void currentId; if (status === 'ready') highlight(); });
</script>

{#if status === 'failed'}
  <ol class="m-0 flex list-decimal flex-col gap-0.5 pl-5 font-mono text-[13px]">
    {#each steps as step, index (step.id)}
      <li><a href="{base}/{index + 1}" class="underline-offset-2 hover:underline {step.id === currentId ? 'font-semibold' : ''}" aria-current={step.id === currentId ? 'step' : undefined}>{step.title}</a></li>
    {/each}
  </ol>
{:else}
  {#if status === 'loading'}<div class="flex h-20 items-center justify-center rounded font-mono text-xs text-muted-foreground">drawing graph…</div>{/if}
  <div bind:this={container} data-kind={kind} class="graph max-h-32 py-2 overflow-auto sm:max-h-36 lg:max-h-[180px] {status === 'loading' ? 'hidden' : ''}"></div>
{/if}

<style>
  .graph :global(svg) { margin-inline: auto; overflow: visible; }
  .graph :global(g.node rect),
  .graph :global(g.node polygon),
  .graph :global(g.node path) {
    fill: color-mix(in srgb, var(--canvas) 94%, var(--k)) !important;
    stroke: color-mix(in srgb, var(--k) 25%, var(--line)) !important;
    stroke-width: 1px !important;
    rx: 4px; ry: 4px;
    transition: stroke 0.2s, fill 0.2s;
  }
  .graph :global(g.node .nodeLabel),
  .graph :global(g.node .nodeLabel p) { color: var(--fg) !important; font-family: var(--fm) !important; font-size: 12px !important; }
  .graph :global(g.node) { transition: opacity 0.2s; }
  .graph :global(g.node:hover rect) { stroke: color-mix(in srgb, var(--k) 70%, var(--line)) !important; }
  .graph :global(g.node.trace-upcoming) { opacity: 0.5; }
  .graph :global(g.node.trace-upcoming:hover) { opacity: 0.85; }
  .graph :global(g.node.trace-visited rect) { stroke: color-mix(in srgb, var(--k) 55%, var(--line)) !important; }
  .graph :global(g.node.trace-visited .nodeLabel) { color: var(--muted-fg) !important; }
  .graph :global(g.node.trace-current rect),
  .graph :global(g.node.trace-current polygon),
  .graph :global(g.node.trace-current path) {
    stroke: var(--k) !important;
    stroke-width: 1.5px !important;
    fill: color-mix(in srgb, var(--canvas) 86%, var(--k)) !important;
  }
  .graph :global(g.node.trace-current) { filter: drop-shadow(0 0 5px var(--k)); animation: breathe 2.4s ease-in-out infinite; }
  .graph :global(g.node.trace-current .nodeLabel) { font-weight: 600; }
  .graph :global(path.flowchart-link) {
    stroke: var(--k) !important; stroke-width: 1.4px !important; stroke-dasharray: 5 4 !important; animation: flow 0.9s linear infinite;
  }
  .graph :global(path.flowchart-link.trace-edge-future) { opacity: 0.3; animation: none; }
  .graph :global(marker path) { fill: var(--k) !important; stroke: var(--k) !important; stroke-dasharray: none !important; }
  .graph :global(.edgeLabel),
  .graph :global(.edgeLabel p),
  .graph :global(.edgeLabel rect) { background: var(--canvas) !important; fill: var(--canvas) !important; color: var(--muted-fg) !important; font: 11px var(--fm) !important; }
  .graph :global(g.node:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
