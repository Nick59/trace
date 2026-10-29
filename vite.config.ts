import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [tailwindcss(), sveltekit({ alias: { "$lib": "src/lib" }, adapter: adapter(), preprocess: vitePreprocess() })]
});
