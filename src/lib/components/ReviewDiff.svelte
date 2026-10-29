<script lang="ts">
  import type { ReviewFile } from '$lib/types';

  let { file }: { file?: ReviewFile } = $props();
  type DiffLine = { kind: 'context' | 'add' | 'remove' | 'meta'; oldNo: string; newNo: string; text: string };
  let lines = $derived(parsePatch(file?.patch ?? ''));

  function parsePatch(patch: string): DiffLine[] {
    if (!patch) return [];
    const output: DiffLine[] = [];
    let oldLine = 0, newLine = 0;
    for (const text of patch.split('\n')) {
      const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); output.push({ kind: 'meta', oldNo: '', newNo: '', text }); continue; }
      if (text.startsWith('diff --git') || text.startsWith('index ') || text.startsWith('--- ') || text.startsWith('+++ ') || text.startsWith('\\')) continue;
      if (text.startsWith('+')) output.push({ kind: 'add', oldNo: '', newNo: String(newLine++), text: text.slice(1) });
      else if (text.startsWith('-')) output.push({ kind: 'remove', oldNo: String(oldLine++), newNo: '', text: text.slice(1) });
      else if (text.startsWith(' ')) output.push({ kind: 'context', oldNo: String(oldLine++), newNo: String(newLine++), text: text.slice(1) });
    }
    return output;
  }

</script>

{#if lines.length}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex: a scrollable region must be focusable for keyboard scrolling -->
  <div class="diff overflow-x-auto bg-canvas font-mono text-[12.5px] leading-[1.65] [tab-size:2]" style="background: var(--canvas)" role="region" aria-label="Unified diff for {file?.path}" tabindex="0">
    <div class="w-max min-w-full">
      {#each lines as line}
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
      {/each}
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
</style>
