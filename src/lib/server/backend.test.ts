import assert from 'node:assert/strict';
import test from 'node:test';
import { prCoordinates } from './github';

test('accepts a GitHub pull request URL and canonicalizes its URL', () => {
  assert.deepEqual(prCoordinates('https://github.com/acme/widget/pull/42/files'), {
    owner: 'acme', repo: 'widget', number: 42, canonicalUrl: 'https://github.com/acme/widget/pull/42'
  });
});

test('rejects non GitHub hosts and non pull request paths', () => {
  assert.throws(() => prCoordinates('https://github.com.evil.test/acme/widget/pull/42'), /Only github.com/);
  assert.throws(() => prCoordinates('https://github.com/acme/widget/issues/42'), /form github.com/);
});
