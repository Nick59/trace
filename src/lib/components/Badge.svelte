<script lang="ts">
  import type { Snippet } from 'svelte';
  let { mono = true, children }: { mono?: boolean; children: Snippet } = $props();
</script>

<span class="chip {mono ? '' : 'font-sans'}" style="padding:0 6px;font-size:11px;color:var(--muted-fg)">{@render children()}</span>
