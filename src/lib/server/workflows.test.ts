import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePr, sampleWorkflows } from './test-fixtures';
import { analysisGuide, singleWorkflowGuide, UNTRUSTED_NOTICE } from './analysis-guide';
import { coverage, coverageError, generateWorkflows, hideTestSteps, LIMITS, patchesOf, regenerateWorkflow, rangeError, testStepPath, visibleWorkflows, validUnassigned, validWorkflow, validWorkflows, workflowApiConfigured, WorkflowGenerationError, workflowToMermaid } from './workflows';

const paths = new Set(['src/api/route.ts', 'src/core/service.ts']);

test('assigns ids and defaults to a linear chain of edges', () => {
  const result = validWorkflows(sampleWorkflows, paths)!;
  assert.deepEqual(result.map((workflow) => [workflow.id, workflow.position]), [['w1', 1]]);
  assert.deepEqual(result[0].steps.map((step) => step.id), ['s1', 's2']);
  assert.deepEqual(result[0].edges, [{ from: 's1', to: 's2' }]);
});

test('accepts 1-based and s<n> edge references and rejects bad ones', () => {
  const withEdges = (edges: unknown) => validWorkflows([{ ...sampleWorkflows[0], edges }], paths);
  assert.deepEqual(withEdges([{ from: 1, to: 's2', label: 'calls' }])?.[0].edges, [{ from: 's1', to: 's2', label: 'calls' }]);
  assert.equal(withEdges([{ from: 1, to: 3 }]), undefined);
  assert.equal(withEdges([{ from: 0, to: 1 }]), undefined);
  assert.equal(withEdges([{ from: 1, to: 1 }]), undefined);
  assert.equal(withEdges([{ from: 1, to: 2, label: 'x'.repeat(61) }]), undefined);
});

test('rejects unknown paths, unknown kinds and exceeded limits', () => {
  const step = sampleWorkflows[0].steps[0];
  assert.equal(validWorkflows(sampleWorkflows, new Set(['other.ts'])), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], entrypoint: { kind: 'magic', label: 'x' } }], paths), undefined);
  assert.equal(validWorkflows([], paths), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], steps: Array(21).fill(step) }], paths), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], steps: [{ ...step, symbols: Array(9).fill('a') }] }], paths), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], title: 'x'.repeat(121) }], paths), undefined);
});

test('mermaid output escapes labels so they cannot break out of the quoted string', () => {
  const hostile = '"]\n  click s1 call alert()\n  s9["<img src=x onerror=1> & #';
  const [workflow] = validWorkflows([{ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], title: hostile }, sampleWorkflows[0].steps[1]],
    edges: [{ from: 1, to: 2, label: hostile }] }], paths)!;
  const text = workflowToMermaid(workflow);
  const lines = text.split('\n');
  assert.equal(lines[0], 'flowchart TB');
  assert.equal(workflowToMermaid(workflow, 'LR').split('\n')[0], 'flowchart LR');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^  s1\["1\. [^"]*"\]$/);
  assert.match(lines[2], /^  s2\["2\. Service"\]$/);
  assert.match(lines[3], /^  s1 -->\|"[^"|]*"\| s2$/);
  assert.ok(!/[<]/.test(text) && !/[^-]>/.test(text));
});

test('model output drops a range outside every hunk and keeps the step', async () => {
  const env = ['WALKTHROUGH_API_KEY', 'WALKTHROUGH_API_URL', 'WALKTHROUGH_MODEL'] as const;
  const previous = env.map((key) => process.env[key]);
  const oldFetch = globalThis.fetch;
  try {
    process.env.WALKTHROUGH_API_KEY = 'k'; process.env.WALKTHROUGH_API_URL = 'https://models.test/v1/chat/completions'; process.env.WALKTHROUGH_MODEL = 'm';
    const pr = samplePr();
    pr.files[0].patch = hunkPatch;
    const ranges = [{ from: 900, to: 910 }, { from: 3, to: 3 }];
    const workflow = { ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], ranges }, sampleWorkflows[0].steps[1]] };
    let reply: unknown = { workflows: [workflow], unassigned: [] };
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200 })) as typeof fetch;
    const result = await generateWorkflows(pr);
    assert.deepEqual(result.workflows[0].steps[0].ranges, [{ from: 3, to: 3 }]);
    reply = { workflow };
    const single = await regenerateWorkflow(pr, result.workflows[0]);
    assert.deepEqual(single.steps[0].ranges, [{ from: 3, to: 3 }]);
  } finally {
    globalThis.fetch = oldFetch;
    env.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('generateWorkflows posts to the configured endpoint and validates the output', async () => {
  const env = ['WALKTHROUGH_API_KEY', 'WALKTHROUGH_API_URL', 'WALKTHROUGH_MODEL'] as const;
  const previous = env.map((key) => process.env[key]);
  const oldFetch = globalThis.fetch;
  try {
    for (const key of env) delete process.env[key];
    assert.equal(workflowApiConfigured(), false);
    await assert.rejects(generateWorkflows(samplePr()), WorkflowGenerationError);
    process.env.WALKTHROUGH_API_KEY = 'k'; process.env.WALKTHROUGH_API_URL = 'https://models.test/v1/chat/completions'; process.env.WALKTHROUGH_MODEL = 'm';
    assert.equal(workflowApiConfigured(), true);
    let reply: unknown = { workflows: sampleWorkflows, unassigned: [] };
    let status = 200;
    let seen = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = String(input) + String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status });
    }) as typeof fetch;
    const result = await generateWorkflows(samplePr());
    assert.equal(result.workflows[0].steps.length, 2);
    assert.match(seen, /models\.test/);
    assert.match(seen, /untrusted data/);
    assert.match(seen, /one file per step/);
    assert.match(seen, /changedFiles/);
    reply = { workflows: [{ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], path: 'nope.ts' }] }] };
    await assert.rejects(generateWorkflows(samplePr()), /invalid workflows/);
    reply = { workflows: [{ ...sampleWorkflows[0], steps: [sampleWorkflows[0].steps[0]] }] };
    await assert.rejects(generateWorkflows(samplePr()), /incomplete analysis.*src\/core\/service\.ts/);
    reply = { workflows: [{ ...sampleWorkflows[0], steps: [sampleWorkflows[0].steps[0]] }], unassigned: [{ path: 'src/core/service.ts', reason: 'No runtime behavior.' }] };
    assert.equal((await generateWorkflows(samplePr())).unassigned.length, 1);
    status = 500;
    await assert.rejects(generateWorkflows(samplePr()), /request failed/);
  } finally {
    globalThis.fetch = oldFetch;
    env.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

const step = sampleWorkflows[0].steps[0];
const withSteps = (steps: unknown[], extra: object = {}) => validWorkflows([{ ...sampleWorkflows[0], ...extra, steps }], paths, true);

test('actor is required for submissions, optional when reading, and limited in length', () => {
  const { actor: _actor, ...noActor } = sampleWorkflows[0];
  assert.equal(validWorkflows([noActor], paths, true), undefined);
  assert.equal(validWorkflows([noActor], paths)?.[0].actor, undefined);
  assert.equal(validWorkflows([{ ...noActor, actor: 'x'.repeat(61) }], paths), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], actor: '  ' }], paths, true), undefined);
  assert.equal(validWorkflows(sampleWorkflows, paths, true)?.[0].actor, 'API client');
});

test('feature is required for submissions, optional when reading, and limited in length', () => {
  const { feature: _feature, ...noFeature } = sampleWorkflows[0];
  assert.equal(validWorkflows([noFeature], paths, true), undefined);
  assert.equal(validWorkflows([noFeature], paths)?.[0].feature, undefined);
  assert.equal(validWorkflows([{ ...noFeature, feature: 'x'.repeat(121) }], paths), undefined);
  assert.equal(validWorkflows([{ ...noFeature, feature: ' ' }], paths, true), undefined);
  assert.equal(validWorkflows(sampleWorkflows, paths, true)?.[0].feature, 'An API client lists widgets');
});

test('there is no cap on the number of workflows, and a step may hold up to 20 per workflow', () => {
  assert.equal(validWorkflows(Array(40).fill(sampleWorkflows[0]), paths, true)?.length, 40);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], steps: Array(20).fill(step) }], paths, true)?.[0].steps.length, 20);
});

test('legacy paths are read, but rejected on submit unless empty; they must be unique changed files other than path', () => {
  const read = (extra: unknown, strict = false) => validWorkflows([{ ...sampleWorkflows[0], steps: [{ ...step, paths: extra }] }], paths, strict);
  assert.deepEqual(validWorkflows(sampleWorkflows, paths)![0].steps[0].paths, []);
  assert.deepEqual(read(['src/core/service.ts'])![0].steps[0].paths, ['src/core/service.ts']);
  assert.equal(read(['src/core/service.ts'], true), undefined);
  assert.deepEqual(read([], true)![0].steps[0].paths, []);
  assert.equal(read(['src/api/route.ts']), undefined);
  assert.equal(read(['nope.ts']), undefined);
  assert.equal(read(['src/core/service.ts', 'src/core/service.ts']), undefined);
  assert.equal(read('src/core/service.ts'), undefined);
});

test('unassigned entries must be unique changed files with a short reason', () => {
  assert.deepEqual(validUnassigned(undefined, paths), []);
  assert.deepEqual(validUnassigned([{ path: 'src/api/route.ts', reason: 'Lockfile' }], paths), [{ path: 'src/api/route.ts', reason: 'Lockfile' }]);
  for (const bad of [[{ path: 'nope.ts', reason: 'x' }], [{ path: 'src/api/route.ts', reason: '' }], [{ path: 'src/api/route.ts', reason: 'x'.repeat(161) }],
    [{ path: 'src/api/route.ts', reason: 'a' }, { path: 'src/api/route.ts', reason: 'b' }], 'text', [{ path: 'src/api/route.ts' }]]) {
    assert.equal(validUnassigned(bad, paths), undefined);
  }
  assert.equal(validUnassigned(Array(LIMITS.unassigned + 1).fill({ path: 'src/api/route.ts', reason: 'x' }), paths), undefined);
});

test('coverage counts used, unassigned and uncovered files and lists them in the error', () => {
  const pr = samplePr();
  const workflows = validWorkflows([{ ...sampleWorkflows[0], steps: [step] }], paths)!;
  assert.deepEqual(coverage({ pr, workflows, unassigned: [] }), { total: 2, covered: 1, unassigned: 0, uncovered: ['src/core/service.ts'], ignoredTests: 0 });
  assert.deepEqual(coverage({ pr, workflows, unassigned: [{ path: 'src/core/service.ts', reason: 'r' }] }), { total: 2, covered: 1, unassigned: 1, uncovered: [], ignoredTests: 0 });
  assert.match(coverageError(undefined, { pr, workflows, unassigned: [] })!, /leaves 1 changed file uncovered: src\/core\/service\.ts/);
  assert.equal(coverageError(undefined, { pr, workflows: validWorkflows(sampleWorkflows, paths)!, unassigned: [] }), undefined);
  const many = samplePr({ files: Array.from({ length: 53 }, (_, index) => ({ path: `f${index}.ts`, status: 'added', additions: 1, deletions: 0, patch: '' })) });
  const message = coverageError(undefined, { pr: many, workflows: [], unassigned: [] })!;
  assert.match(message, /f49\.ts, \+3 more/);
  assert.ok(!message.includes('f50.ts'));
});

test('the guide teaches features, one file per step and carries a worked example without paths', () => {
  const guide = analysisGuide(LIMITS);
  for (const phrase of [/one file per step/, /A \*\*feature\*\*/, /actor plus a goal/, /uncovered/, /unassigned/, /There is no limit on the number of workflows/, /Worked example/, /reserved → 409/, /never steps and never need coverage/]) assert.match(guide, phrase);
  assert.doesNotMatch(guide, /Verified by/);
  assert.doesNotMatch(guide, /"path": "tests\//);
  assert.doesNotMatch(guide, /business scenario/);
  const example = JSON.parse(guide.slice(guide.lastIndexOf('```json') + 7, guide.lastIndexOf('```')));
  assert.equal(example.workflows.length, 2);
  assert.equal(new Set(example.workflows.map((workflow: { feature: string }) => workflow.feature)).size, 1);
  for (const workflow of example.workflows) for (const step of workflow.steps) assert.equal('paths' in step, false);
  for (const workflow of example.workflows) for (const step of workflow.steps) assert.ok(step.ranges.length >= 1 && step.ranges.length <= LIMITS.ranges);
  assert.deepEqual(validWorkflows(example.workflows, new Set(example.workflows.flatMap((workflow: { steps: Array<{ path: string }> }) => workflow.steps.map((step) => step.path))), true)?.length, 2);
});

test('docs carry the guide verbatim and the static copy is identical', async () => {
  const { readFile } = await import('node:fs/promises');
  const docs = await readFile('docs/cli-agent.md', 'utf8');
  assert.ok(docs.includes(analysisGuide(LIMITS)));
  assert.equal(await readFile('static/docs/cli-agent.md', 'utf8'), docs);
});

test('skill guide files are generated from the guide and each skill carries the untrusted notice', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const dir of ['skills/trace', 'skills/codex/trace']) {
    assert.equal(await readFile(`${dir}/analysis-guide.md`, 'utf8'), `${analysisGuide(LIMITS)}\n`, dir);
    assert.equal(await readFile(`${dir}/recompute-guide.md`, 'utf8'), `${singleWorkflowGuide(LIMITS)}\n`, dir);
    assert.ok((await readFile(`${dir}/SKILL.md`, 'utf8')).includes(UNTRUSTED_NOTICE), dir);
  }
});

test('new submissions need a one-sentence summary and 1-4 short checks, while stored steps may be longer', () => {
  const long = { ...step, summary: 'x'.repeat(201), checks: Array(8).fill('y'.repeat(240)) };
  assert.equal(withSteps([long]), undefined);
  assert.equal(withSteps([{ ...step, checks: [] }]), undefined);
  assert.equal(withSteps([{ ...step, checks: Array(5).fill('ok') }]), undefined);
  assert.equal(withSteps([{ ...step, checks: ['z'.repeat(141)] }]), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], steps: [long] }], paths)?.[0].steps[0].checks.length, 8);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], steps: [{ ...step, checks: [] }] }], paths)?.[0].steps[0].checks.length, 0);
});

test('strict validation rejects a test file as a step, while stored rows still read', () => {
  const testPaths = new Set([...paths, 'tests/route.test.ts']);
  const testStep = { title: 'Verified', summary: 'Covers it.', path: 'tests/route.test.ts', symbols: [], checks: ['Passes'] };
  const withTest = [{ ...sampleWorkflows[0], steps: [...sampleWorkflows[0].steps, testStep] }];
  assert.equal(validWorkflows(withTest, testPaths, true), undefined);
  assert.equal(validWorkflows(withTest, testPaths)?.[0].steps.length, 3);
  assert.equal(testStepPath(withTest), 'tests/route.test.ts');
  assert.equal(testStepPath(sampleWorkflows), undefined);
  assert.equal(testStepPath('nonsense'), undefined);
});

test('coverage ignores test files: not counted, not uncovered, reported as ignoredTests', () => {
  const pr = samplePr({ files: [...samplePr().files, { path: 'src/core/service.test.ts', status: 'added', additions: 1, deletions: 0, patch: '' }] });
  const workflows = validWorkflows(sampleWorkflows, paths)!;
  assert.deepEqual(coverage({ pr, workflows, unassigned: [] }), { total: 2, covered: 2, unassigned: 0, uncovered: [], ignoredTests: 1 });
  assert.equal(coverageError(undefined, { pr, workflows, unassigned: [] }), undefined);
  assert.deepEqual(coverage({ pr, workflows: [], unassigned: [] }).uncovered, ['src/api/route.ts', 'src/core/service.ts']);
});

const legacy = (ids: string[], edges: Array<[string, string, string?]>, testIds: string[]) => ({
  id: 'w2', position: 2, title: 'T', entrypoint: { kind: 'http' as const, label: 'x' }, summary: 's',
  steps: ids.map((id) => ({ id, title: id, summary: '', path: testIds.includes(id) ? `tests/${id}.test.ts` : `src/${id}.ts`, paths: [], symbols: [], checks: [] })),
  edges: edges.map(([from, to, label]) => label ? { from, to, label } : { from, to })
});

test('hideTestSteps drops test steps, joins edges around them and renumbers', () => {
  const workflow = legacy(['s1', 's2', 's3', 's4'], [['s1', 's2'], ['s2', 's3', 'then'], ['s3', 's4']], ['s2']);
  const result = hideTestSteps(workflow)!;
  assert.deepEqual(result.steps.map((step) => [step.id, step.path]), [['s1', 'src/s1.ts'], ['s2', 'src/s3.ts'], ['s3', 'src/s4.ts']]);
  assert.deepEqual(result.edges, [{ from: 's2', to: 's3' }, { from: 's1', to: 's2', label: 'then' }]);
  assert.deepEqual([result.id, result.position], ['w2', 2]);
  assert.equal(hideTestSteps(workflow)?.steps.length, 3);
  assert.equal(workflow.steps.length, 4);
});

test('hideTestSteps keeps the first label, handles chains and forks, and skips self loops', () => {
  const chain = hideTestSteps(legacy(['s1', 's2', 's3', 's4'], [['s1', 's2', 'first'], ['s2', 's3', 'second'], ['s3', 's4']], ['s2', 's3']))!;
  assert.deepEqual(chain.edges, [{ from: 's1', to: 's2', label: 'first' }]);
  const fork = hideTestSteps(legacy(['s1', 's2', 's3', 's4'], [['s1', 's2'], ['s2', 's3'], ['s2', 's4', 'alt']], ['s2']))!;
  assert.deepEqual(fork.edges, [{ from: 's1', to: 's2' }, { from: 's1', to: 's3', label: 'alt' }]);
  const loop = hideTestSteps(legacy(['s1', 's2'], [['s1', 's2'], ['s2', 's1']], ['s2']))!;
  assert.deepEqual(loop.edges, []);
});

test('a workflow made only of test steps is hidden and others are untouched', () => {
  const onlyTests = legacy(['s1', 's2'], [['s1', 's2']], ['s1', 's2']);
  const normal = { ...legacy(['s1', 's2'], [['s1', 's2']], []), id: 'w1', position: 1 };
  assert.equal(hideTestSteps(onlyTests), undefined);
  assert.deepEqual(visibleWorkflows([normal, onlyTests]).map((workflow) => workflow.id), ['w1']);
  assert.equal(hideTestSteps(normal), normal);
});

const hunkPatch = '@@ -1,2 +1,3 @@\n a\n+b\n c\n@@ -40,2 +41,2 @@\n-d\n+e\n f';
const withRanges = (ranges: unknown) => [{ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], ranges }, sampleWorkflows[0].steps[1]] }];
const hunkPatches = new Map([['src/api/route.ts', hunkPatch], ['src/core/service.ts', '']]);

test('strict mode rejects a range outside every hunk with a precise error and accepts an overlapping one', () => {
  const outside = withRanges([{ from: 10, to: 20 }]);
  assert.equal(validWorkflows(outside, paths, true, hunkPatches), undefined);
  assert.match(rangeError(outside, hunkPatches)!, /Step 1 \(src\/api\/route\.ts\) has range 10-20 that overlaps no changed block/);
  const inside = withRanges([{ from: 3, to: 3 }, { from: 42, to: 60 }]);
  assert.equal(rangeError(inside, hunkPatches), undefined);
  assert.deepEqual(validWorkflows(inside, paths, true, hunkPatches)![0].steps[0].ranges, [{ from: 3, to: 3 }, { from: 42, to: 60 }]);
  assert.deepEqual(validWorkflows(sampleWorkflows, paths, true, hunkPatches)![0].steps[0].ranges, []);
});

test('the hunk check is skipped when the patch is empty or missing', () => {
  const far = withRanges([{ from: 900, to: 910 }]);
  assert.equal(rangeError(far, new Map([['src/api/route.ts', '']])), undefined);
  assert.equal(rangeError(far, new Map()), undefined);
  assert.equal(validWorkflows(far, paths, true, new Map([['src/api/route.ts', '']]))![0].steps[0].ranges?.length, 1);
  assert.equal(validWorkflows(far, paths, true)![0].steps[0].ranges?.length, 1);
  assert.equal(patchesOf(samplePr()).get('src/api/route.ts'), samplePr().files[0].patch);
});

test('ranges are shape-checked: strict rejects, tolerant drops them and keeps the workflow', () => {
  const bad = [[{ from: 0, to: 2 }], [{ from: 5, to: 4 }], [{ from: 1.5, to: 2 }], [{ from: 1, to: 1_000_001 }], [{ from: 1 }], 'x',
    Array.from({ length: LIMITS.ranges + 1 }, (_, index) => ({ from: index + 1, to: index + 1 }))];
  for (const ranges of bad) {
    assert.equal(validWorkflows(withRanges(ranges), paths, true), undefined, JSON.stringify(ranges));
    assert.deepEqual(validWorkflows(withRanges(ranges), paths)![0].steps[0].ranges, [], JSON.stringify(ranges));
  }
  assert.deepEqual(validWorkflows(withRanges([{ from: 2, to: 9 }]), paths)![0].steps[0].ranges, [{ from: 2, to: 9 }]);
  assert.deepEqual(validWorkflows(sampleWorkflows, paths)![0].steps[0].ranges, []);
});

test('hiding test steps keeps the ranges of the remaining steps', () => {
  const [workflow] = validWorkflows(withRanges([{ from: 2, to: 9 }]), new Set([...paths, 'tests/a.test.ts']))!;
  const withTest = { ...workflow, steps: [{ ...workflow.steps[0], id: 's1' }, { ...workflow.steps[1], id: 's2', path: 'tests/a.test.ts' }, { ...workflow.steps[1], id: 's3', ranges: [{ from: 4, to: 5 }] }],
    edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }] };
  assert.deepEqual(hideTestSteps(withTest)!.steps.map((step) => step.ranges), [[{ from: 2, to: 9 }], [{ from: 4, to: 5 }]]);
});
