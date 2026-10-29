<script lang="ts">
  import { Check, Copy } from '@lucide/svelte';

  let { command, label }: { command: string; label?: string } = $props();
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try { await navigator.clipboard.writeText(command); } catch { return; }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="panel panel-green">
  <div class="panel-head" style="min-height:32px">
    <span class="flex gap-1.5" aria-hidden="true"><i class="size-2.5 rounded-full" style="background:#ff5f57"></i><i class="size-2.5 rounded-full" style="background:#febc2e"></i><i class="size-2.5 rounded-full" style="background:#28c840"></i></span>
    <span class="grow truncate dim">{label ?? 'terminal'}</span>
    <button type="button" onclick={copy} aria-label={label ? `Copy ${label}` : 'Copy command'}
      class="inline-flex h-6 items-center gap-1.5 rounded border px-2 text-[11px] normal-case transition-all active:scale-95 {copied ? 'border-[var(--kind-ui)] text-[var(--kind-ui)]' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'}">
      {#if copied}<Check size={12} />{:else}<Copy size={12} />{/if}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  </div>
  <div class="flex gap-2 px-3 py-2.5 font-mono text-[12.5px] leading-5">
    <span class="select-none" style="color: var(--a-green)" aria-hidden="true">$</span>
    <pre class="m-0 min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]" aria-label={label}>{command}</pre>
  </div>
</div>
