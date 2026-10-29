import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../../scripts/mcp';
import { closeStore } from './store';

function firstText(content: unknown): string {
  assert.ok(Array.isArray(content));
  const block = content.find((item: unknown): item is { type: 'text'; text: string } =>
    typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string');
  assert.ok(block);
  return block.text;
}

test('MCP tools prepare, retrieve, validate, submit, and list a pinned workflow analysis', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trace-mcp-test-'));
  const oldStore = process.env.TRACE_DATA_DIR;
  const oldFetch = globalThis.fetch;
  process.env.TRACE_DATA_DIR = directory;
  const sourceContents = `export function GET() {}\n${'s'.repeat(11_000)}`;
  const largePatch = `+${'p'.repeat(10_000)}`;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/pulls/3')) return Response.json({
      title: 'Add request lookup', html_url: 'https://github.com/acme/widget/pull/3', number: 3, body: 'Adds a lookup.',
      user: { login: 'dev' }, base: { ref: 'main', repo: { full_name: 'acme/widget' } }, head: { ref: 'feature', sha: 'fedcba9876543210' }
    });
    if (url.includes('/pulls/3/files?')) return Response.json([{ filename: 'src/api/route.ts', status: 'modified', additions: 2, deletions: 0, patch: largePatch }]);
    if (url.includes('/contents/src/api/route.ts?')) return new Response(sourceContents);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  const workflow = { title: 'Lookup', summary: 'Handles a lookup request.', entrypoint: { kind: 'http', label: 'GET /lookup' },
    steps: [{ title: 'Entry', summary: 'Handles a request.', path: 'src/api/route.ts', symbols: ['GET'], checks: ['Inspect request.'] }] };
  const server = createMcpServer();
  const client = new Client({ name: 'trace-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'trace_get_review', 'trace_list_reviews', 'trace_prepare_review', 'trace_submit_workflows'
    ]);
    const prompt = await client.getPrompt({ name: 'trace_workflows', arguments: { url: 'https://github.com/acme/widget/pull/3' } });
    const promptText = firstText(prompt.messages.map((message) => message.content));
    assert.match(promptText, /untrusted data/);
    assert.match(promptText, /Do not post/);

    const prepared = await client.callTool({ name: 'trace_prepare_review', arguments: { url: 'https://github.com/acme/widget/pull/3' } });
    assert.equal(prepared.isError, undefined);
    const draft = JSON.parse(firstText(prepared.content));
    assert.equal(draft.headSha, 'fedcba9876543210');
    assert.equal(draft.files[0].patchTruncated, true);
    assert.equal(draft.files[0].sourceTruncated, true);
    assert.equal(draft.contextTruncated, true);

    const fullFileResult = await client.callTool({ name: 'trace_get_review', arguments: { analysisId: draft.analysisId, path: 'src/api/route.ts' } });
    const fullFileReview = JSON.parse(firstText(fullFileResult.content));
    assert.equal(fullFileReview.filesTruncated, false);
    assert.equal(fullFileReview.pr.files[0].patch, largePatch);
    assert.equal(fullFileReview.pr.files[0].source, sourceContents);

    const failedSubmit = await client.callTool({ name: 'trace_submit_workflows', arguments: {
      analysisId: draft.analysisId, headSha: 'stale', workflows: [workflow]
    } });
    assert.equal(failedSubmit.isError, true);
    const ready = await client.callTool({ name: 'trace_submit_workflows', arguments: {
      analysisId: draft.analysisId, headSha: draft.headSha, workflows: [workflow]
    } });
    assert.equal(JSON.parse(firstText(ready.content)).status, 'ready');
    const badEdge = await client.callTool({ name: 'trace_submit_workflows', arguments: { analysisId: draft.analysisId, headSha: draft.headSha,
      workflows: [{ ...workflow, edges: [{ from: 1, to: 2 }] }] } });
    assert.equal(badEdge.isError, true);
    const listed = await client.callTool({ name: 'trace_list_reviews', arguments: {} });
    assert.equal(JSON.parse(firstText(listed.content)).reviews[0].status, 'ready');
    const fetched = await client.callTool({ name: 'trace_get_review', arguments: { analysisId: draft.analysisId, path: 'src/api/route.ts' } });
    assert.equal(JSON.parse(firstText(fetched.content)).workflows[0].steps[0].path, 'src/api/route.ts');
  } finally {
    await client.close();
    await server.close();
    closeStore();
    globalThis.fetch = oldFetch;
    if (oldStore === undefined) delete process.env.TRACE_DATA_DIR; else process.env.TRACE_DATA_DIR = oldStore;
    await rm(directory, { recursive: true, force: true });
  }
});

test('stdio launcher completes a real handshake when started outside the repository cwd', async () => {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'trace-mcp-cwd-'));
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'trace-mcp-data-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  environment.TRACE_DATA_DIR = dataDirectory;
  const launcher = path.resolve(process.cwd(), 'scripts/mcp-launch.mjs');
  const client = new Client({ name: 'trace-stdio-test-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [launcher], cwd: workingDirectory, env: environment });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.ok(result.tools.some((tool) => tool.name === 'trace_prepare_review'));
    const listed = await client.callTool({ name: 'trace_list_reviews', arguments: {} });
    assert.deepEqual(JSON.parse(firstText(listed.content)).reviews, []);
  } finally {
    await client.close();
    await rm(workingDirectory, { recursive: true, force: true });
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
