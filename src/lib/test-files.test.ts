import assert from 'node:assert/strict';
import test from 'node:test';
import { isTestFile } from './test-files';

test('recognizes test directories at any depth', () => {
  for (const path of ['test/a.ts', 'tests/renew.ts', 'src/__tests__/a.js', 'pkg/spec/helper.rb', 'a/specs/b.ts', 'e2e/login.ts', 'apps/web/e2e/fixtures/data.json']) assert.equal(isTestFile(path), true, path);
});

test('recognizes test file names', () => {
  for (const path of ['src/a.test.ts', 'src/a.spec.tsx', 'a.test.js.snap', 'pkg/user_test.go', 'pkg/test_user.py', 'pkg/user_test.py', 'src/UserTest.java', 'src/OrderTests.cs', 'spec_helper_spec.rb', 'app/user_spec.rb']) assert.equal(isTestFile(path), true, path);
});

test('leaves ordinary source alone', () => {
  for (const path of ['src/latest/index.ts', 'src/testing.ts', 'src/contest/a.ts', 'src/test.ts', 'src/specs.ts', 'pkg/attest.go', 'src/protests.ts', 'spec.md', 'src/e2e-config.ts', 'lib/testdata.py', 'src/MyTestHelper.java']) assert.equal(isTestFile(path), false, path);
});
