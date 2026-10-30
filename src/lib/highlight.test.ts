import assert from 'node:assert/strict';
import test from 'node:test';
import { highlightLines, languageFor, splitHighlighted } from './highlight';

test('languageFor maps extensions and ignores unknown files', () => {
  assert.equal(languageFor('src/a.ts'), 'typescript');
  assert.equal(languageFor('app/Controller.JS'), 'javascript');
  assert.equal(languageFor('src/routes/+page.svelte'), 'xml');
  assert.equal(languageFor('LICENSE'), undefined);
  assert.equal(languageFor('data.bin'), undefined);
});

test('splitHighlighted closes and reopens spans across lines', () => {
  assert.deepEqual(splitHighlighted('a<span class="c">/* x\ny */</span>b'), ['a<span class="c">/* x</span>', '<span class="c">y */</span>b']);
});

test('highlightLines keeps one escaped line per input line', () => {
  const html = highlightLines(['function go() {', '  return "<b>"; /* a', ' b */', '}'], 'javascript');
  assert.equal(html.length, 4);
  assert.match(html[0], /<span class="hljs-keyword">function<\/span>/);
  assert.match(html[1], /&lt;b&gt;/);
  assert.match(html[2], /^<span class="hljs-comment"> b \*\/<\/span>$/);
  assert.deepEqual(highlightLines(['<script>'], undefined), ['&lt;script&gt;']);
});
