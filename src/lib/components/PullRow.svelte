<script lang="ts">
  import { GitPullRequest, GitPullRequestDraft } from '@lucide/svelte';
  import Badge from './Badge.svelte';

  type Pull = { title: string; repository: string; number: number; author: string; updatedAt: string; draft: boolean };
  let { pull, index = 0, stagger = true, isNew = false }: { pull: Pull; index?: number; stagger?: boolean; isNew?: boolean } = $props();

  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];
  function relative(iso: string): string {
    const diff = new Date(iso).getTime() - Date.now();
    if (Number.isNaN(diff)) return '';
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    for (const [unit, size] of units) if (Math.abs(diff) >= size) return formatter.format(Math.round(diff / size), unit);
    return 'just now';
  }
  function hue(text: string): number {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
  }
  let owner = $derived(pull.repository.split('/')[0] ?? '?');
  let name = $derived(pull.repository.split('/')[1] ?? pull.repository);
</script>

<a href="/pr/{pull.repository}/{pull.number}" class="row {stagger ? 'rise' : ''}" class:fresh={isNew} style="--i:{Math.min(index, 12)}; --h:{hue(pull.repository)}">
  <span class="avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-2">
      <span class="min-w-0 truncate text-[14.5px] font-medium">{pull.title}</span>
      {#if pull.draft}<Badge>draft</Badge>{/if}
      {#if isNew}<span class="new-badge">new</span>{/if}
    </span>
    <span class="mt-0.5 flex flex-wrap items-center gap-x-3 font-mono text-xs text-muted-foreground">
      <span class="truncate"><span class="opacity-70">{owner}/</span>{name}</span>
      <span class="inline-flex items-center gap-1">{#if pull.draft}<GitPullRequestDraft size={12} />{:else}<GitPullRequest size={12} />{/if}#{pull.number}</span>
      <span>{pull.author}</span>
      <span>{relative(pull.updatedAt)}</span>
    </span>
  </span>
</a>

<style>
  .row {
    position: relative; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--neutral) 20%, var(--line)); transition: background-color 0.15s;
  }
  .row:last-child { border-bottom: 0; }
  .row::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--a-cyan); opacity: 0; transition: opacity 0.15s; }
  .row:hover, .row:focus-visible { background: color-mix(in srgb, var(--a-cyan) 7%, transparent); }
  .row:hover::before, .row:focus-visible::before { opacity: 1; }
  .row.fresh { background: color-mix(in srgb, var(--a-cyan) 10%, transparent); animation: tint 4.5s ease-out both; }
  .new-badge { flex: none; padding: 0 6px; border-radius: 4px; font: 600 10px var(--fm); text-transform: uppercase; color: var(--a-cyan); border: 1px solid color-mix(in srgb, var(--a-cyan) 50%, transparent); animation: fade 4.5s ease-in both; }
  @keyframes tint { 0%, 70% { background-color: color-mix(in srgb, var(--a-cyan) 10%, transparent); } 100% { background-color: transparent; } }
  @keyframes fade { 0%, 70% { opacity: 1; } 100% { opacity: 0; } }
  .avatar {
    display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 5px; font: 600 13px var(--fm);
    color: light-dark(hsl(var(--h) 55% 32%), hsl(var(--h) 70% 74%));
    background: light-dark(hsl(var(--h) 60% 92%), hsl(var(--h) 40% 18%));
    border: 1px solid light-dark(hsl(var(--h) 40% 78%), hsl(var(--h) 35% 30%));
  }
</style>
