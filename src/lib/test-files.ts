const TEST_DIRECTORIES = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e']);

export function isTestFile(path: string): boolean {
  const segments = path.split('/');
  const name = segments[segments.length - 1];
  if (segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment))) return true;
  return /\.(test|spec)\./.test(name) || /_test\.(go|py)$/.test(name) || /^test_.*\.py$/.test(name) ||
    /Test\.java$/.test(name) || /Tests\.cs$/.test(name) || /_spec\.rb$/.test(name);
}
