import hljs from 'highlight.js/lib/common';

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  svelte: 'xml', vue: 'xml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less', json: 'json', md: 'markdown',
  py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sql: 'sql', graphql: 'graphql', gql: 'graphql'
};

export function languageFor(path: string): string | undefined {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return undefined;
  const language = BY_EXTENSION[name.split('.').pop() ?? ''];
  return language && hljs.getLanguage(language) ? language : undefined;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Splits highlighted HTML into one string per source line, closing and reopening spans that cross a newline. */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  for (const match of html.matchAll(/(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g)) {
    if (match[1]) { open.push(match[1]); current += match[1]; }
    else if (match[2]) { open.pop(); current += match[2]; }
    else if (match[3]) { lines.push(current + '</span>'.repeat(open.length)); current = open.join(''); }
    else current += match[4];
  }
  lines.push(current);
  return lines;
}

/** Returns one escaped HTML string per input line; highlight.js escapes the code it wraps. */
export function highlightLines(lines: string[], language: string | undefined): string[] {
  if (!language || lines.length === 0) return lines.map(escapeHtml);
  try {
    const html = splitHighlighted(hljs.highlight(lines.join('\n'), { language, ignoreIllegals: true }).value);
    return html.length === lines.length ? html : lines.map(escapeHtml);
  } catch {
    return lines.map(escapeHtml);
  }
}
