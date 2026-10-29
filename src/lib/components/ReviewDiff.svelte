<script lang="ts">
  import { tick } from 'svelte';
  import { hunkInRanges, parseHunks } from '$lib/diff-hunks';
  import type { ReviewFile, StepRange } from '$lib/types';

  interface OtherUse { workflowId: string; title: string; step: number; ranges: StepRange[] }
  let { file, ranges = [], otherUses = [], baseHref = '' }: { file?: ReviewFile; ranges?: StepRange[]; otherUses?: OtherUse[]; baseHref?: string } = $props();
  type DiffLine = { kind: 'context' | 'add' | 'remove' | 'meta'; oldNo: string; newNo: string; text: string; hunk: number };
  type Segment = { key: number; inRange: boolean; lines: DiffLine[]; uses: OtherUse[]; count: number };
  let lines = $derived(parsePatch(file?.patch ?? ''));
  let hunks = $derived(parseHunks(file?.patch ?? ''));
  let focused = $derived(ranges.length > 0 && hunks.some((hunk) => hunkInRanges(hunk, ranges)));
  let segments = $derived(focused ? segment() : []);
  let expanded = $state(new Set<number>());
  let region: HTMLElement | undefined = $state();
  let regionWidth = $state(0);

  function segment(): Segment[] {
    const inRange = hunks.map((hunk) => hunkInRanges(hunk, ranges));
    const result: Segment[] = [];
    for (const line of lines) {
      const flag = inRange[line.hunk] ?? false;
      let last = result[result.length - 1];
      if (!last || last.inRange !== flag || (flag && line.kind === 'meta')) {
        last = { key: line.hunk, inRange: flag, lines: [], uses: [], count: 0 };
        result.push(last);
      }
      if (line.kind === 'meta') last.count++;
      last.lines.push(line);
    }
    for (const part of result) {
      if (part.inRange) continue;
      const covered = new Set(part.lines.map((line) => line.hunk));
      part.uses = otherUses.filter((use) => hunks.some((hunk) => covered.has(hunk.index) && hunkInRanges(hunk, use.ranges)));
    }
    return result;
  }

  $effect(() => {
    void file?.path; void ranges;
    expanded = new Set();
    if (!focused) return;
    tick().then(() => {
      const target = region?.querySelector<HTMLElement>('[data-in-range]');
      if (region && target) region.scrollTop += target.getBoundingClientRect().top - region.getBoundingClientRect().top;
    });
  });

  function toggle(key: number) {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  function parsePatch(patch: string): DiffLine[] {
    if (!patch) return [];
    const output: DiffLine[] = [];
    let oldLine = 0, newLine = 0, index = -1;
    for (const text of patch.split('\n')) {
      const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { index++; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); output.push({ kind: 'meta', oldNo: '', newNo: '', text, hunk: index }); continue; }
      if (text.startsWith('diff --git') || text.startsWith('index ') || text.startsWith('--- ') || text.startsWith('+++ ') || text.startsWith('\\')) continue;
      if (text.startsWith('+')) output.push({ kind: 'add', oldNo: '', newNo: String(newLine++), text: text.slice(1), hunk: Math.max(index, 0) });
      else if (text.startsWith('-')) output.push({ kind: 'remove', oldNo: String(oldLine++), newNo: '', text: text.slice(1), hunk: Math.max(index, 0) });
      else if (text.startsWith(' ')) output.push({ kind: 'context', oldNo: String(oldLine++), newNo: String(newLine++), text: text.slice(1), hunk: Math.max(index, 0) });
    }
    return output;
  }

</script>

{#snippet row(line: DiffLine)}
  <div class="row {line.kind}">
    {#if line.kind === 'meta'}
      <span class="hunk">{line.text}</span>
    {:else}
      <span class="gut">{line.oldNo}</span>
      <span class="gut">{line.newNo}</span>
      <span class="sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</span>
      <code class="code">{line.text}</code>
    {/if}
  </div>
{/snippet}

{#if lines.length}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex: a scrollable region must be focusable for keyboard scrolling -->
  <div bind:this={region} bind:clientWidth={regionWidth} class="diff overflow-auto lg:max-h-[calc(100dvh-8.5rem)] bg-canvas font-mono text-[12.5px] leading-[1.65] [tab-size:2]" style="background: var(--canvas)" role="region" aria-label="Unified diff for {file?.path}" tabindex="0">
    <div class="w-max min-w-full">
      {#if !focused}
        {#each lines as line}{@render row(line)}{/each}
      {:else}
        {#each segments as part (part.key + ':' + part.inRange)}
          {#if part.inRange}
            <div class="focus" data-in-range>
              {#each part.lines as line}{@render row(line)}{/each}
            </div>
          {:else}
            <div class="fold" style="--fold-w: {regionWidth}px">
              <button type="button" class="fold-toggle" aria-expanded={expanded.has(part.key)} onclick={() => toggle(part.key)}>
                <span aria-hidden="true">{expanded.has(part.key) ? '▾' : '▸'}</span>
                {part.count} other {part.count === 1 ? 'change' : 'changes'} in this file
              </button>
              <span class="fold-uses">
                {#if part.uses.length}
                  · used by
                  {#each part.uses as use, index (use.workflowId + ':' + use.step)}{index ? ', ' : ' '}<a href="{baseHref}/{use.workflowId}/{use.step}" title={use.title}>{use.workflowId} · step {use.step}</a>{/each}
                {:else}
                  · not used by another workflow
                {/if}
              </span>
            </div>
            {#if expanded.has(part.key)}
              <div class="dim">
                {#each part.lines as line}{@render row(line)}{/each}
              </div>
            {/if}
          {/if}
        {/each}
      {/if}
    </div>
  </div>
{:else}
  <div class="px-3 py-6 text-center font-mono text-[13px] text-muted-foreground">GitHub returned no patch for this file (binary or too large).</div>
{/if}

<style>
  .row { display: grid; grid-template-columns: 44px 44px 18px 1fr; border-left: 3px solid transparent; }
  .gut { padding-right: 8px; text-align: right; font-size: 11.5px; color: var(--muted-fg); user-select: none; background: color-mix(in srgb, var(--neutral) 8%, transparent); }
  .sign { text-align: center; user-select: none; }
  .code { padding-right: 16px; white-space: pre; }
  .add { background: var(--addition-bg); border-left-color: var(--addition-bar); }
  .add .gut { background: var(--addition-gutter); color: var(--addition-fg); }
  .add .sign { color: var(--addition-fg); }
  .remove { background: var(--deletion-bg); border-left-color: var(--deletion-bar); }
  .remove .gut { background: var(--deletion-gutter); color: var(--deletion-fg); }
  .remove .sign { color: var(--deletion-fg); }
  .meta { grid-template-columns: 1fr; border-left-color: color-mix(in srgb, var(--a-blue) 70%, transparent); background: color-mix(in srgb, var(--a-blue) 9%, var(--canvas)); }
  .hunk { padding: 2px 12px; white-space: pre; font-size: 11.5px; color: color-mix(in srgb, var(--a-blue) 75%, var(--fg)); }
  .context:hover { background: color-mix(in srgb, var(--neutral) 7%, transparent); }
  .focus { position: relative; }
  .focus::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--a-cyan); z-index: 1; }
  .fold { position: sticky; left: 0; box-sizing: border-box; width: var(--fold-w); display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 4px; padding: 3px 12px; font-size: 11.5px; color: var(--muted-fg); background: color-mix(in srgb, var(--neutral) 8%, var(--canvas)); border-block: 1px solid color-mix(in srgb, var(--neutral) 18%, transparent); }
  .fold-toggle { font: inherit; color: var(--fg); cursor: pointer; border-radius: 3px; padding: 0 4px; }
  .fold-toggle:hover { background: color-mix(in srgb, var(--neutral) 14%, transparent); }
  .fold-toggle:focus-visible, .fold-uses a:focus-visible { outline: 2px solid var(--a-blue); outline-offset: 1px; }
  .fold-uses a { color: var(--a-blue); text-decoration: underline; }
  .dim { opacity: 0.55; }
</style>
