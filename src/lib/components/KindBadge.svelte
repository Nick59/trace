<script lang="ts">
  import { kindMeta } from '$lib/kinds';
  import type { EntrypointKind } from '$lib/types';

  let { kind }: { kind: EntrypointKind } = $props();
  let meta = $derived(kindMeta[kind] ?? kindMeta.other);
  let Icon = $derived(meta.icon);
</script>

<span class="kind-badge" data-kind={kindMeta[kind] ? kind : 'other'}><Icon size={12} aria-hidden="true" />{meta.label}</span>
