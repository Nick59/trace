import assert from 'node:assert/strict';
import test from 'node:test';
import { diffPulls, type Pull } from './pulls-diff';

const pull = (n: number, over: Partial<Pull> = {}): Pull => ({
  title: `PR ${n}`, url: `https://github.com/o/r/pull/${n}`, repository: 'o/r', number: n, author: 'ann', updatedAt: '2026-01-01T00:00:00Z', draft: false, ...over
});

test('reports added and removed pulls by url', () => {
  const result = diffPulls([pull(1), pull(2)], [pull(2), pull(3)]);
  assert.deepEqual([...result.added], [pull(3).url]);
  assert.deepEqual(result.removed, [pull(1).url]);
  assert.equal(result.changed.size, 0);
});

test('flags title, draft, updatedAt and author changes', () => {
  const prev = [pull(1), pull(2), pull(3), pull(4), pull(5)];
  const next = [pull(1, { title: 'x' }), pull(2, { draft: true }), pull(3, { updatedAt: 'later' }), pull(4, { author: 'bob' }), pull(5)];
  const result = diffPulls(prev, next);
  assert.deepEqual([...result.changed], [1, 2, 3, 4].map((n) => pull(n).url));
  assert.equal(result.added.size, 0);
});

test('keeps previous object reference for unchanged pulls', () => {
  const prev = [pull(1), pull(2)];
  const result = diffPulls(prev, [pull(1), pull(2, { title: 'new' })]);
  assert.equal(result.merged[0], prev[0]);
  assert.notEqual(result.merged[1], prev[1]);
  assert.equal(result.merged[1].title, 'new');
});

test('merged follows the server order', () => {
  const result = diffPulls([pull(1), pull(2), pull(3)], [pull(3), pull(4), pull(1)]);
  assert.deepEqual(result.merged.map((p) => p.number), [3, 4, 1]);
});
