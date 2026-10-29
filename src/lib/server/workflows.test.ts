import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePr, sampleWorkflows } from './test-fixtures';
import { analysisGuide } from './analysis-guide';
import { coverage, coverageError, generateWorkflows, LIMITS, validUnassigned, validWorkflow, validWorkflows, workflowApiConfigured, WorkflowGenerationError, workflowToMermaid } from './workflows';

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
  assert.equal(validWorkflows(Array(13).fill(sampleWorkflows[0]), paths), undefined);
  assert.equal(validWorkflows([{ ...sampleWorkflows[0], steps: Array(16).fill(step) }], paths), undefined);
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
    assert.match(seen, /business scenario/);
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

test('paths default to empty and must be unique changed files other than path', () => {
  assert.deepEqual(validWorkflows(sampleWorkflows, paths)![0].steps[0].paths, []);
  assert.deepEqual(withSteps([{ ...step, paths: ['src/core/service.ts'] }])![0].steps[0].paths, ['src/core/service.ts']);
  assert.equal(withSteps([{ ...step, paths: ['src/api/route.ts'] }]), undefined);
  assert.equal(withSteps([{ ...step, paths: ['nope.ts'] }]), undefined);
  assert.equal(withSteps([{ ...step, paths: ['src/core/service.ts', 'src/core/service.ts'] }]), undefined);
  assert.equal(withSteps([{ ...step, paths: 'src/core/service.ts' }]), undefined);
  const many = new Set(Array.from({ length: 10 }, (_, index) => `f${index}.ts`).concat('a.ts'));
  assert.equal(validWorkflow({ ...sampleWorkflows[0], steps: [{ ...step, path: 'a.ts', paths: Array.from({ length: 9 }, (_, index) => `f${index}.ts`) }] }, many, 1, true), undefined);
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
  assert.deepEqual(coverage({ pr, workflows, unassigned: [] }), { total: 2, covered: 1, unassigned: 0, uncovered: ['src/core/service.ts'] });
  assert.deepEqual(coverage({ pr, workflows, unassigned: [{ path: 'src/core/service.ts', reason: 'r' }] }), { total: 2, covered: 1, unassigned: 1, uncovered: [] });
  assert.match(coverageError(undefined, { pr, workflows, unassigned: [] })!, /leaves 1 changed file uncovered: src\/core\/service\.ts/);
  assert.equal(coverageError(undefined, { pr, workflows: validWorkflows(sampleWorkflows, paths)!, unassigned: [] }), undefined);
  const many = samplePr({ files: Array.from({ length: 53 }, (_, index) => ({ path: `f${index}.ts`, status: 'added', additions: 1, deletions: 0, patch: '' })) });
  const message = coverageError(undefined, { pr: many, workflows: [], unassigned: [] })!;
  assert.match(message, /f49\.ts, \+3 more/);
  assert.ok(!message.includes('f50.ts'));
});

test('the guide teaches business scenarios, coverage and carries a worked example', () => {
  const guide = analysisGuide(LIMITS);
  for (const phrase of [/business scenario/, /actor plus goal/, /uncovered/, /unassigned/, /never as a code location/, /Worked example/, /reserved → 409/]) assert.match(guide, phrase);
  assert.doesNotMatch(guide, /Each entrypoint is one workflow/);
});

test('docs carry the guide verbatim and the static copy is identical', async () => {
  const { readFile } = await import('node:fs/promises');
  const docs = await readFile('docs/cli-agent.md', 'utf8');
  assert.ok(docs.includes(analysisGuide(LIMITS)));
  assert.equal(await readFile('static/docs/cli-agent.md', 'utf8'), docs);
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
