import assert from 'node:assert/strict';
import test from 'node:test';
import { hunkInRanges, parseHunks } from './diff-hunks';

const patch = ['@@ -1,3 +1,4 @@ function a()', ' x', '+y', '@@ -10 +11 @@', '-a', '+b', '@@ -20,2 +21,0 @@ tail', '-c', '-d'].join('\n');

test('parseHunks reads counts, missing counts and the header text', () => {
  const hunks = parseHunks(patch);
  assert.deepEqual(hunks.map((hunk) => [hunk.index, hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]), [[0, 1, 3, 1, 4], [1, 10, 1, 11, 1], [2, 20, 2, 21, 0]]);
  assert.equal(hunks[0].header, '@@ -1,3 +1,4 @@ function a()');
  assert.deepEqual(parseHunks(''), []);
  assert.deepEqual(parseHunks('+just a line'), []);
});

test('hunkInRanges overlaps the new-side span, edges included', () => {
  const [add, modify, deletion] = parseHunks(patch);
  assert.equal(hunkInRanges(add, [{ from: 4, to: 9 }]), true);
  assert.equal(hunkInRanges(add, [{ from: 5, to: 9 }]), false);
  assert.equal(hunkInRanges(modify, [{ from: 1, to: 11 }]), true);
  assert.equal(hunkInRanges(modify, [{ from: 12, to: 20 }]), false);
  assert.equal(hunkInRanges(modify, [{ from: 1, to: 3 }, { from: 11, to: 11 }]), true);
  assert.equal(hunkInRanges(deletion, [{ from: 21, to: 30 }]), true);
  assert.equal(hunkInRanges(deletion, [{ from: 22, to: 30 }]), false);
  assert.equal(hunkInRanges(deletion, []), false);
});
