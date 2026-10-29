<script lang="ts">
  import { page } from '$app/state';
</script>

<main class="mx-auto mt-10 max-w-[880px] px-4 sm:px-6">
  <section class="panel" style="--p-accent: var(--destructive)">
    <div class="panel-head"><span class="tab">error {page.status}</span></div>
    <div class="p-4">
      <h1 class="text-lg font-semibold">{page.status === 404 ? 'Could not load this page' : 'Something went wrong'}</h1>
      <p class="mt-1 font-mono text-[13px] text-muted-foreground">{page.error?.message}</p>
      <a href="/" class="mt-4 inline-block font-mono text-[13px] text-primary underline underline-offset-2">Back to pull requests</a>
    </div>
  </section>
</main>
