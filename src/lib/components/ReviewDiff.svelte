<script lang="ts">
  import { tick } from 'svelte';
  import { ExternalLink, MessageSquarePlus } from '@lucide/svelte';
  import { hunkInRanges, parseHunks } from '$lib/diff-hunks';
  import { highlightLines, languageFor } from '$lib/highlight';
  import type { CommentSide, ReviewComment, ReviewFile, StepRange } from '$lib/types';

  interface OtherUse { workflowId: string; title: string; step: number; ranges: StepRange[] }
  let { file, ranges = [], otherUses = [], baseHref = '', commentsApi = '', canComment = false }: {
    file?: ReviewFile; ranges?: StepRange[]; otherUses?: OtherUse[]; baseHref?: string; commentsApi?: string; canComment?: boolean;
  } = $props();
  type Target = { side: CommentSide; line: number; hunk: number };
  type Draft = { side: CommentSide; line: number; startLine?: number; hunk: number } | { file: true };
  type DiffLine = { kind: 'context' | 'add' | 'remove' | 'meta'; oldNo: string; newNo: string; text: string; hunk: number; html: string };
  type Segment = { key: number; inRange: boolean; lines: DiffLine[]; uses: OtherUse[]; count: number };
  let lines = $derived(highlight(parsePatch(file?.patch ?? ''), languageFor(file?.path ?? '')));
  let hunks = $derived(parseHunks(file?.patch ?? ''));
  let focused = $derived(ranges.length > 0 && hunks.some((hunk) => hunkInRanges(hunk, ranges)));
  let segments = $derived(focused ? segment() : []);
  let expanded = $state(new Set<number>());
  let region: HTMLElement | undefined = $state();
  let regionWidth = $state(0);
  let comments = $state<ReviewComment[]>([]);
  let commentsError = $state('');
  let draft = $state<Draft | null>(null);
  let draftText = $state('');
  let posting = $state(false);
  let postError = $state('');
  let threads = $derived(groupThreads(comments));
  let looseComments = $derived(comments.filter((comment) => comment.line === null));

  const keyOf = (side: CommentSide, line: number) => `${side}:${line}`;

  function groupThreads(list: ReviewComment[]): Map<string, ReviewComment[]> {
    const map = new Map<string, ReviewComment[]>();
    for (const comment of list) {
      if (comment.line === null) continue;
      const key = keyOf(comment.side, comment.line);
      map.set(key, [...(map.get(key) ?? []), comment]);
    }
    return map;
  }

  function targetOf(line: DiffLine): Target | null {
    if (line.kind === 'meta') return null;
    return line.kind === 'remove' ? { side: 'LEFT', line: Number(line.oldNo), hunk: line.hunk } : { side: 'RIGHT', line: Number(line.newNo), hunk: line.hunk };
  }

  function inDraft(target: Target | null): boolean {
    if (!target || !draft || 'file' in draft || draft.side !== target.side) return false;
    return target.line <= draft.line && target.line >= (draft.startLine ?? draft.line);
  }

  $effect(() => {
    const path = file?.path;
    draft = null; draftText = ''; postError = ''; comments = []; commentsError = '';
    if (!path || !commentsApi) return;
    let alive = true;
    fetch(`${commentsApi}?path=${encodeURIComponent(path)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!alive) return;
        if (response.ok) comments = body.comments ?? [];
        else commentsError = body.error ?? `Could not load GitHub comments (${response.status}).`;
      })
      .catch(() => { if (alive) commentsError = 'Could not load GitHub comments.'; });
    return () => { alive = false; };
  });

  function startComment(target: Target, event: MouseEvent) {
    postError = '';
    if (event.shiftKey && draft && !('file' in draft) && draft.side === target.side && draft.hunk === target.hunk && target.line !== draft.line) {
      const anchor = draft.startLine ?? draft.line;
      const [low, high] = [Math.min(anchor, target.line, draft.line), Math.max(anchor, target.line, draft.line)];
      draft = { side: target.side, line: high, startLine: low, hunk: target.hunk };
      return;
    }
    draft = { side: target.side, line: target.line, hunk: target.hunk };
  }

  function cancelDraft() { draft = null; draftText = ''; postError = ''; }

  async function submit() {
    if (!draft || !file || posting || !draftText.trim()) return;
    posting = true; postError = '';
    const payload = 'file' in draft ? { path: file.path, body: draftText }
      : { path: file.path, body: draftText, side: draft.side, line: draft.line, ...(draft.startLine === undefined ? {} : { startLine: draft.startLine }) };
    try {
      const response = await fetch(commentsApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { postError = body.error ?? `GitHub did not accept the comment (${response.status}).`; return; }
      comments = [...comments, body.comment];
      cancelDraft();
    } catch {
      postError = 'Could not reach the server.';
    } finally {
      posting = false;
    }
  }

  function composerKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelDraft(); }
  }

  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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

  // Each side of a hunk is highlighted as one block, so multi-line strings and comments keep their color.
  function highlight(parsed: DiffLine[], language: string | undefined): DiffLine[] {
    const sides = new Map<string, DiffLine[]>();
    for (const line of parsed) {
      if (line.kind === 'meta') continue;
      const keys = line.kind === 'add' ? ['new'] : line.kind === 'remove' ? ['old'] : ['new', 'old'];
      for (const key of keys) sides.set(`${line.hunk}:${key}`, [...(sides.get(`${line.hunk}:${key}`) ?? []), line]);
    }
    for (const [key, group] of sides) {
      if (key.endsWith(':old') && !group.some((line) => line.kind === 'remove')) continue;
      const html = highlightLines(group.map((line) => line.text), language);
      group.forEach((line, index) => { if (key.endsWith(':new') || line.kind === 'remove') line.html = html[index]; });
    }
    return parsed;
  }

  function parsePatch(patch: string): DiffLine[] {
    if (!patch) return [];
    const output: DiffLine[] = [];
    let oldLine = 0, newLine = 0, index = -1;
    for (const text of patch.split('\n')) {
      const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { index++; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); output.push({ kind: 'meta', oldNo: '', newNo: '', text, hunk: index, html: '' }); continue; }
      if (text.startsWith('diff --git') || text.startsWith('index ') || text.startsWith('--- ') || text.startsWith('+++ ') || text.startsWith('\\')) continue;
      if (text.startsWith('+')) output.push({ kind: 'add', oldNo: '', newNo: String(newLine++), text: text.slice(1), hunk: Math.max(index, 0), html: '' });
      else if (text.startsWith('-')) output.push({ kind: 'remove', oldNo: String(oldLine++), newNo: '', text: text.slice(1), hunk: Math.max(index, 0), html: '' });
      else if (text.startsWith(' ')) output.push({ kind: 'context', oldNo: String(oldLine++), newNo: String(newLine++), text: text.slice(1), hunk: Math.max(index, 0), html: '' });
    }
    return output;
  }

</script>

{#snippet commentList(list: ReviewComment[])}
  {#each list as comment (comment.id)}
    <article class="comment" class:reply={comment.replyTo !== null}>
      <header>
        <span class="font-semibold text-foreground">{comment.author}</span>
        <time datetime={comment.createdAt}>{when(comment.createdAt)}</time>
        {#if comment.startLine !== null && comment.line !== null}<span>lines {comment.startLine}–{comment.line}</span>{/if}
        <a href={comment.url} target="_blank" rel="noreferrer" class="ml-auto inline-flex items-center gap-1">GitHub<ExternalLink size={11} aria-hidden="true" /></a>
      </header>
      <p>{comment.body}</p>
    </article>
  {/each}
{/snippet}

{#snippet composer()}
  <form class="composer" onsubmit={(event) => { event.preventDefault(); submit(); }}>
    <label class="text-muted-foreground" for="trace-comment">
      {#if draft && 'file' in draft}Comment on this file
      {:else if draft && draft.startLine !== undefined}Comment on lines {draft.startLine}–{draft.line} ({draft.side === 'LEFT' ? 'old' : 'new'})
      {:else if draft}Comment on line {draft.line} ({draft.side === 'LEFT' ? 'old' : 'new'}) <span class="opacity-75">· shift-click another line to select a range</span>{/if}
    </label>
    <!-- svelte-ignore a11y_autofocus: the composer opens on an explicit click -->
    <textarea id="trace-comment" bind:value={draftText} onkeydown={composerKey} rows="3" maxlength="65536" placeholder="Leave a comment (Markdown)" autofocus disabled={posting}></textarea>
    {#if postError}<p class="error" role="alert">{postError}</p>{/if}
    <div class="flex items-center gap-2">
      <span class="mr-auto text-muted-foreground">Posts to the pull request on GitHub · Ctrl+Enter</span>
      <button type="button" class="btn" onclick={cancelDraft} disabled={posting}>Cancel</button>
      <button type="submit" class="btn primary" disabled={posting || !draftText.trim()}>{posting ? 'Posting…' : 'Comment'}</button>
    </div>
  </form>
{/snippet}

{#snippet row(line: DiffLine)}
  {@const target = targetOf(line)}
  <div class="row {line.kind}" class:selected={inDraft(target)}>
    {#if line.kind === 'meta'}
      <span class="hunk">{line.text}</span>
    {:else}
      <span class="gut">{line.oldNo}</span>
      <span class="gut">{line.newNo}</span>
      <span class="sign">
        {#if canComment && target}
          <button type="button" class="add-comment" aria-label="Comment on line {target.line}" title="Comment (shift-click to extend a range)" onclick={(event) => startComment(target, event)}>+</button>
        {/if}
        <span class="sign-mark">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</span>
      </span>
      <!-- html comes from highlightLines, which escapes the patch text -->
      <code class="code">{@html line.html}</code>
    {/if}
  </div>
  {#if target}
    {@const thread = threads.get(keyOf(target.side, target.line))}
    {@const drafting = draft && !('file' in draft) && draft.side === target.side && draft.line === target.line}
    {#if thread || drafting}
      <div class="thread" style="--fold-w: {regionWidth}px">
        {#if thread}{@render commentList(thread)}{/if}
        {#if drafting}{@render composer()}{/if}
      </div>
    {/if}
  {/if}
{/snippet}

{#if commentsApi}
  <div class="file-comments">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground">
        {#if commentsError}{commentsError}
        {:else}{comments.length} GitHub {comments.length === 1 ? 'comment' : 'comments'} on this file{#if !canComment} · set GITHUB_TOKEN to comment{/if}{/if}
      </span>
      {#if canComment}
        <button type="button" class="btn ml-auto inline-flex items-center gap-1" onclick={() => { postError = ''; draft = { file: true }; }}><MessageSquarePlus size={12} aria-hidden="true" />Comment on file</button>
      {/if}
    </div>
    {#if looseComments.length}
      <div class="mt-1">{@render commentList(looseComments)}</div>
    {/if}
    {#if draft && 'file' in draft}{@render composer()}{/if}
  </div>
{/if}

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
  .sign { position: relative; text-align: center; user-select: none; }
  .add-comment { position: absolute; inset: 1px 0; display: none; place-items: center; border-radius: 3px; font-weight: 700; line-height: 1; color: var(--primary-foreground); background: var(--primary); cursor: pointer; }
  .row:hover .add-comment, .add-comment:focus-visible { display: grid; }
  .row:hover .sign-mark { visibility: hidden; }
  .add-comment:focus-visible { outline: 2px solid var(--a-blue); outline-offset: 1px; }
  .selected { box-shadow: inset 0 0 0 9999px color-mix(in srgb, var(--a-blue) 14%, transparent); }
  .thread { position: sticky; left: 0; box-sizing: border-box; width: var(--fold-w); padding: 6px 12px 8px 50px; font-family: var(--font-sans); font-size: 12.5px; background: var(--color-card); border-block: 1px solid var(--color-border); }
  .file-comments { padding: 6px 12px; font-size: 12px; border-bottom: 1px solid var(--color-border); }
  .comment { padding: 6px 0; border-top: 1px solid color-mix(in srgb, var(--neutral) 15%, transparent); }
  .comment:first-child { border-top: 0; }
  .comment.reply { margin-left: 16px; }
  .comment header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; color: var(--muted-fg); font-size: 11.5px; }
  .comment header a { color: var(--a-blue); }
  .comment p { margin-top: 2px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg); }
  .composer { display: grid; gap: 6px; margin-top: 6px; font-size: 11.5px; }
  .composer textarea { width: 100%; resize: vertical; min-height: 4.5rem; padding: 6px 8px; font: inherit; font-size: 12.5px; color: var(--fg); background: var(--color-background); border: 1px solid var(--color-border); border-radius: 6px; }
  .composer textarea:focus-visible { outline: 2px solid var(--a-blue); outline-offset: 0; }
  .error { color: var(--deletion-fg); }
  .btn { padding: 2px 10px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px; color: var(--fg); background: var(--color-background); cursor: pointer; }
  .btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--primary) 50%, var(--color-border)); }
  .btn.primary { color: var(--primary-foreground); background: var(--primary); border-color: var(--primary); }
  .btn:disabled { opacity: 0.55; cursor: default; }
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
  .code :global(.hljs-keyword), .code :global(.hljs-built_in.hljs-keyword), .code :global(.hljs-meta .hljs-keyword) { color: var(--syn-keyword); }
  .code :global(.hljs-title), .code :global(.hljs-title.function_), .code :global(.hljs-title.class_) { color: var(--syn-title); }
  .code :global(.hljs-string), .code :global(.hljs-regexp), .code :global(.hljs-template-tag) { color: var(--syn-string); }
  .code :global(.hljs-number), .code :global(.hljs-literal), .code :global(.hljs-variable.constant_), .code :global(.hljs-attr), .code :global(.hljs-property) { color: var(--syn-constant); }
  .code :global(.hljs-type), .code :global(.hljs-built_in), .code :global(.hljs-params), .code :global(.hljs-variable.language_) { color: var(--syn-type); }
  .code :global(.hljs-comment), .code :global(.hljs-doctag), .code :global(.hljs-quote) { color: var(--syn-comment); font-style: italic; }
  .code :global(.hljs-tag), .code :global(.hljs-name), .code :global(.hljs-selector-tag), .code :global(.hljs-selector-class) { color: var(--syn-tag); }
  .code :global(.hljs-meta), .code :global(.hljs-subst) { color: var(--fg); }
</style>
