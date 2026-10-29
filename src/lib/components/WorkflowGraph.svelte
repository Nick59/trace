<script lang="ts">
  import { onMount } from 'svelte';
  import { kindHex, motionMs } from '$lib/kinds';
  import type { EntrypointKind } from '$lib/types';

  type Step = { id: string; title: string };
  let { source, currentId, steps, base, kind = 'other', zoom = $bindable('fit'), onSelect, markIds = [], viewedIds = [], onrendered }: {
    markIds?: string[]; viewedIds?: string[]; onrendered?: () => void;
    zoom?: 'fit' | '1:1'; source: string; kind?: EntrypointKind; currentId: string; steps: Step[]; base: string; onSelect: (stepNumber: number) => void;
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
        flowchart: { useMaxWidth: false, htmlLabels: true, nodeSpacing: 12, rankSpacing: 32, padding: 6, curve: 'basis', wrappingWidth: 120 }
      });
      const { svg } = await mermaidModule.render(`trace-graph-${token}`, source);
      if (token !== renderCount) return;
      container.innerHTML = svg;
      bindNodes();
      status = 'ready';
      applyZoom();
      highlight(true);
      markSiblings();
      markViewed();
      onrendered?.();
    } catch {
      if (token === renderCount) status = 'failed';
    }
  }

  // Labels are 12px; below 9px on screen they stop being readable, so fit never scales past 0.75.
  const minScale = 9 / 12;
  function applyZoom() {
    const svg = container?.querySelector('svg');
    const box = svg?.viewBox.baseVal;
    if (!container || !svg || !box || !box.width) return;
    const style = getComputedStyle(container);
    const available = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const scale = zoom === '1:1' || available <= 0 ? 1 : Math.min(1, Math.max(available / box.width, minScale));
    svg.removeAttribute('height');
    svg.style.maxWidth = 'none';
    svg.style.width = scale < 1 && scale * box.width <= available + 0.5 ? '100%' : `${Math.round(box.width * scale)}px`;
    svg.style.height = 'auto';
  }

  function onWheel(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    zoom = event.deltaY < 0 ? '1:1' : 'fit';
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
      node.style.cursor = 'pointer';
      node.addEventListener('click', () => onSelect(index + 1));
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index + 1); }
      });
    }
  }

  // Scrolls only the graph container; scrollIntoView would also move the page.
  function reveal(node: SVGGElement, instant: boolean) {
    if (!container) return;
    const box = container.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const top = rect.top - box.top + container.scrollTop;
    const left = rect.left - box.left + container.scrollLeft;
    const margin = 24;
    const visible = rect.top >= box.top + margin && rect.bottom <= box.bottom - margin && rect.left >= box.left && rect.right <= box.right;
    if (visible) return;
    container.scrollTo({
      top: Math.max(0, top - (container.clientHeight - rect.height) / 2),
      left: Math.max(0, left - (container.clientWidth - rect.width) / 2),
      behavior: instant || motionMs(1) === 0 ? 'auto' : 'smooth'
    });
  }

  function highlight(instant = false) {
    const current = steps.findIndex((step) => step.id === currentId);
    for (const [node, index] of nodeElements()) {
      const active = index === current;
      node.classList.toggle('trace-current', active);
      node.classList.toggle('trace-visited', index < current);
      node.classList.toggle('trace-upcoming', index > current);
      if (active) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
      if (active) reveal(node, instant);
    }
    container?.querySelectorAll<SVGPathElement>('path.flowchart-link').forEach((edge) => {
      const to = steps.findIndex((step) => edge.classList.contains(`LE-${step.id}`));
      edge.classList.toggle('trace-edge-future', to > current);
    });
  }

  function markSiblings() {
    for (const [node, index] of nodeElements()) node.classList.toggle('trace-sibling', markIds.includes(steps[index].id));
  }

  const SVG = 'http://www.w3.org/2000/svg';
  // g.node is translated to the node centre, so the shape's bbox is centre-relative. While the container is display:none (first render, collapsed pane) getBBox returns zeros, so the badge stays hidden until a later pass can measure it.
  function placeBadge(node: SVGGElement, badge: SVGGElement) {
    const shape = node.querySelector<SVGGraphicsElement>('.label-container') ?? node.querySelector<SVGGraphicsElement>('rect, polygon, path');
    const box = shape?.getBBox();
    const measured = !!box && box.width > 0 && box.height > 0;
    if (measured) badge.setAttribute('transform', `translate(${box.x + box.width - 2}, ${box.y + 2})`);
    badge.setAttribute('visibility', measured ? 'visible' : 'hidden');
    return measured;
  }

  function addBadge(node: SVGGElement) {
    const badge = document.createElementNS(SVG, 'g');
    badge.setAttribute('class', 'trace-badge');
    badge.setAttribute('aria-hidden', 'true');
    const disc = document.createElementNS(SVG, 'circle');
    disc.setAttribute('r', '7');
    const tick = document.createElementNS(SVG, 'path');
    tick.setAttribute('d', 'M-3.5 0.2 L-1.2 2.6 L3.6 -2.4');
    badge.append(disc, tick);
    node.append(badge);
    return badge;
  }

  let badgeFrame = 0;
  function markViewed() {
    let unmeasured = false;
    for (const [node, index] of nodeElements()) {
      const viewed = viewedIds.includes(steps[index].id);
      node.classList.toggle('trace-viewed', viewed);
      node.setAttribute('aria-label', `Step ${index + 1}: ${steps[index].title}${viewed ? ' (viewed)' : ''}`);
      const badge = node.querySelector<SVGGElement>('.trace-badge');
      if (viewed) {
        if (!placeBadge(node, badge ?? addBadge(node))) unmeasured = true;
      } else badge?.remove();
    }
    cancelAnimationFrame(badgeFrame);
    // A hidden container is retried by the ResizeObserver when it is shown; polling frames would never succeed.
    if (unmeasured && (container?.clientHeight ?? 0) > 0) badgeFrame = requestAnimationFrame(() => { if (status === 'ready') markViewed(); });
  }

  onMount(() => {
    const onScheme = (event: MediaQueryListEvent) => (dark = event.matches);
    scheme?.addEventListener('change', onScheme);
    import('mermaid').then((module) => { mermaidModule = module.default; draw(); }).catch(() => (status = 'failed'));
    return () => { renderCount++; cancelAnimationFrame(badgeFrame); scheme?.removeEventListener('change', onScheme); };
  });

  $effect(() => { void source; void dark; draw(); });
  $effect(() => {
    if (!container || typeof ResizeObserver === 'undefined') return;
    let shown = container.clientHeight > 0;
    let width = container.clientWidth;
    const observer = new ResizeObserver(() => {
      if (status === 'ready' && container && container.clientWidth !== width) { width = container.clientWidth; applyZoom(); }
      const now = (container?.clientHeight ?? 0) > 0;
      if (now && !shown && status === 'ready') { highlight(true); markViewed(); }
      shown = now;
    });
    observer.observe(container);
    return () => observer.disconnect();
  });
  $effect(() => { void zoom; if (status === 'ready') { applyZoom(); highlight(true); } });
  $effect(() => { void currentId; if (status === 'ready') highlight(); });
  $effect(() => { void markIds; if (status === 'ready') markSiblings(); });
  $effect(() => { void viewedIds; if (status === 'ready') markViewed(); });
</script>

{#if status === 'failed'}
  <ol class="m-0 flex h-full list-decimal flex-col gap-1 overflow-auto p-3 pl-8 font-mono text-[13px]">
    {#each steps as step, index (step.id)}
      <li><a href="{base}/{index + 1}" class="underline-offset-2 hover:underline {step.id === currentId ? 'font-semibold' : ''}" aria-current={step.id === currentId ? 'step' : undefined}>{step.title}</a></li>
    {/each}
  </ol>
{:else}
  {#if status === 'loading'}<div class="flex h-20 items-center justify-center rounded font-mono text-xs text-muted-foreground">drawing graph…</div>{/if}
  <div bind:this={container} onwheel={onWheel} data-kind={kind} class="graph h-full min-h-0 overflow-auto p-3 {status === 'loading' ? 'hidden' : ''}"></div>
{/if}

<style>
  .graph :global(svg) { display: block; margin-inline: auto; overflow: visible; }
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
  .graph :global(g.node.trace-sibling rect),
  .graph :global(g.node.trace-sibling polygon) { stroke: var(--k) !important; stroke-width: 1.5px !important; stroke-dasharray: 4 3 !important; }
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
  .graph :global(g.node.trace-viewed rect),
  .graph :global(g.node.trace-viewed polygon),
  .graph :global(g.node.trace-viewed path) { stroke: color-mix(in srgb, var(--a-green) 65%, var(--line)) !important; fill: color-mix(in srgb, var(--canvas) 90%, var(--a-green)) !important; }
  .graph :global(g.node.trace-viewed.trace-current rect),
  .graph :global(g.node.trace-viewed.trace-current polygon) { stroke: var(--a-green) !important; }
  .graph :global(g.node.trace-viewed.trace-upcoming) { opacity: 0.8; }
  .graph :global(g.node .trace-badge circle) { fill: var(--a-green) !important; stroke: var(--canvas) !important; stroke-width: 1.5px !important; }
  .graph :global(g.node.trace-viewed .trace-badge path) { fill: none !important; stroke: var(--canvas) !important; stroke-width: 1.8px !important; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: none !important; }
  .graph :global(g.node:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
</style>
