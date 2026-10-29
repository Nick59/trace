<script lang="ts">
  type Step = { id: string; title: string };
  let { steps, current, base }: { steps: Step[]; current: number; base: string } = $props();
</script>

<ol class="m-0 flex list-none gap-1 p-0" aria-label="Step progress">
  {#each steps as step, index (step.id)}
    <li class="flex-1">
      <a href="{base}/{index + 1}" data-sveltekit-reset={false} aria-label="Step {index + 1}: {step.title}" aria-current={index + 1 === current ? 'step' : undefined}
        class="seg block {index + 1 < current ? 'done' : index + 1 === current ? 'now' : ''}"></a>
    </li>
  {/each}
</ol>

<style>
  .seg { height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--neutral) 28%, transparent); transition: background-color 0.3s, box-shadow 0.3s; position: relative; }
  .seg::after { content: ""; position: absolute; inset: -8px 0; }
  .seg:hover { background: color-mix(in srgb, var(--k) 55%, transparent); }
  .done { background: color-mix(in srgb, var(--k) 55%, transparent); }
  .now { background: var(--k); box-shadow: 0 0 8px color-mix(in srgb, var(--k) 70%, transparent); }
</style>
