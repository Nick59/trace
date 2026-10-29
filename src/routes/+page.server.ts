export function load() {
  const configured = (value: string | undefined) => Boolean(value?.trim() && !value.includes('replace_me'));
  return { setup: { githubConfigured: configured(process.env.GITHUB_TOKEN) } };
}
