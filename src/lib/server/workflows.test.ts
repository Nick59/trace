import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePr, sampleWorkflows } from './test-fixtures';
import { generateWorkflows, validWorkflows, workflowApiConfigured, WorkflowGenerationError, workflowToMermaid } from './workflows';

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
  assert.equal(validWorkflows(Array(11).fill(sampleWorkflows[0]), paths), undefined);
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
  assert.equal(lines[0], 'flowchart LR');
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
    let reply: unknown = { workflows: sampleWorkflows };
    let status = 200;
    let seen = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = String(input) + String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status });
    }) as typeof fetch;
    const result = await generateWorkflows(samplePr());
    assert.equal(result[0].steps.length, 2);
    assert.match(seen, /models\.test/);
    assert.match(seen, /untrusted data/);
    reply = { workflows: [{ ...sampleWorkflows[0], steps: [{ ...sampleWorkflows[0].steps[0], path: 'nope.ts' }] }] };
    await assert.rejects(generateWorkflows(samplePr()), /invalid workflows/);
    status = 500;
    await assert.rejects(generateWorkflows(samplePr()), /request failed/);
  } finally {
    globalThis.fetch = oldFetch;
    env.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
