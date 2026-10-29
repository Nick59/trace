import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildCliCommands, INSTRUCTION_MAX, shellQuote } from './cli-commands';

const echoArgs = (command: string) => {
  const result = spawnSync('bash', ['-c', `printf '%s\\0' ${command}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').slice(0, -1);
};

test('shellQuote round-trips hostile input through a real shell', () => {
  const inputs = ["it's", "a'b'c", "line1\nline2", '$(touch /tmp/pwned)', '`id`', '"; rm -rf ~ #', '$HOME ${PATH}', '\\n\\', '', '  spaced  ', '*', '!history', 'ünï€'];
  for (const input of inputs) assert.deepEqual(echoArgs(shellQuote(input)), [input], JSON.stringify(input));
  assert.equal(shellQuote('/safe/path-1.mjs'), '/safe/path-1.mjs');
});

test('recompute command carries the workflow id and the instruction as one safe argument', () => {
  const commands = buildCliCommands('https://github.com/acme/widget/pull/7', '/opt/trace/scripts/mcp-launch.mjs');
  const hostile = `include the DB write in 'UserRepository'; $(id) \`id\`\nnext "line"`;
  const { claude, codex } = commands.recompute('w2', hostile);
  for (const [tool, command] of [['claude', claude], ['codex', codex]]) {
    const args = echoArgs(command.replace(new RegExp(`^${tool} `), ''));
    assert.equal(args.length, 1);
    assert.match(args[0], /trace_recompute_workflow prompt for https:\/\/github\.com\/acme\/widget\/pull\/7 and workflow w2/);
    assert.ok(args[0].includes(`"""${hostile}"""`));
    assert.match(args[0], /Do not modify the repository or post to GitHub/);
  }
});

test('recompute command trims, drops NUL bytes, truncates and omits an empty instruction', () => {
  const commands = buildCliCommands('https://github.com/acme/widget/pull/7', '/x');
  assert.equal(commands.recompute('w1', '   ').claude.includes('instruction'), false);
  assert.equal(commands.recompute('w1').claude, commands.recompute('w1', '').claude);
  const long = commands.recompute('w1', `a\0${'Z'.repeat(INSTRUCTION_MAX + 50)}`).claude;
  assert.equal(long.includes('\0'), false);
  assert.equal((long.match(/Z/g) ?? []).length, INSTRUCTION_MAX - 1);
});

test('register commands quote a launcher path with spaces', () => {
  const commands = buildCliCommands('https://github.com/a/b/pull/1', '/my dir/mcp-launch.mjs');
  assert.equal(commands.register.claude, "claude mcp add trace -- node '/my dir/mcp-launch.mjs'");
});
