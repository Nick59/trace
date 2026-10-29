import assert from 'node:assert/strict';
import test from 'node:test';
import { appUrl } from './app-url';

function withAppUrl(value: string | undefined, run: () => void) {
  const previous = process.env.TRACE_APP_URL;
  if (value === undefined) delete process.env.TRACE_APP_URL; else process.env.TRACE_APP_URL = value;
  try { run(); }
  finally { if (previous === undefined) delete process.env.TRACE_APP_URL; else process.env.TRACE_APP_URL = previous; }
}

test('appUrl builds PR and workflow links and strips trailing slashes', () => {
  withAppUrl('http://localhost:5173//', () => {
    assert.equal(appUrl('acme/widget', 7), 'http://localhost:5173/pr/acme/widget/7');
    assert.equal(appUrl('acme/widget', 7, 'w2'), 'http://localhost:5173/pr/acme/widget/7/w2');
  });
});

test('appUrl is undefined when unset, empty, or not an http(s) URL', () => {
  for (const value of [undefined, '', '  ', 'not a url', 'ftp://host', 'javascript:alert(1)']) {
    withAppUrl(value, () => assert.equal(appUrl('acme/widget', 7), undefined, String(value)));
  }
});
