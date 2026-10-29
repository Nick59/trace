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

test('recompute commands carry the workflow id and the instruction as one safe argument', () => {
  const url = 'https://github.com/acme/widget/pull/7';
  const commands = buildCliCommands(url, '/opt/trace/scripts/mcp-launch.mjs', '/opt/trace/skills/trace', '/opt/trace/skills/codex/trace');
  const hostile = `include the DB write in 'UserRepository'; $(id) \`id\`\nnext "line" $HOME`;
  const { claude, codex } = commands.recompute('w2', hostile);
  const claudeArgs = echoArgs(claude.replace(/^claude /, ''));
  assert.deepEqual(claudeArgs, [`/trace ${url} w2 ${hostile.replace(/\s+/g, ' ')}`]);
  const codexArgs = echoArgs(codex.replace(/^codex /, ''));
  assert.deepEqual(codexArgs, [`$trace ${url} w2 ${hostile.replace(/\s+/g, ' ')}`]);
});

test('full commands invoke the skills', () => {
  const url = 'https://github.com/acme/widget/pull/7';
  const commands = buildCliCommands(url, '/x', '/s', '/c');
  assert.deepEqual(echoArgs(commands.claude.replace(/^claude /, '')), [`/trace ${url}`]);
  assert.deepEqual(echoArgs(commands.codex.replace(/^codex /, '')), [`$trace ${url}`]);
  assert.equal(commands.recompute('w1').claude, `claude '/trace ${url} w1'`);
  assert.equal(commands.recompute('w1').codex, `codex '$trace ${url} w1'`);
});

test('recompute command trims, drops NUL bytes, truncates and omits an empty instruction', () => {
  const commands = buildCliCommands('https://github.com/acme/widget/pull/7', '/x', '/s', '/c');
  assert.equal(commands.recompute('w1', '   ').claude.includes('instruction'), false);
  assert.equal(commands.recompute('w1', '   ').codex.includes('instruction'), false);
  assert.equal(commands.recompute('w1').claude, commands.recompute('w1', '').claude);
  const long = commands.recompute('w1', `a\0${'Z'.repeat(INSTRUCTION_MAX + 50)}`).codex;
  assert.equal(long.includes('\0'), false);
  assert.equal((long.match(/Z/g) ?? []).length, INSTRUCTION_MAX - 1);
});

test('register commands quote a launcher path with spaces', () => {
  const commands = buildCliCommands('https://github.com/a/b/pull/1', '/my dir/mcp-launch.mjs', '/my dir/skills/trace', '/my dir/skills/codex/trace');
  assert.equal(commands.register.claude, "claude mcp add --scope user trace -- node '/my dir/mcp-launch.mjs'");
});

test('installSkill symlinks the skill directory per tool, quoting the path but not ~', () => {
  const commands = buildCliCommands('https://github.com/a/b/pull/1', '/x', '/my dir/skills/trace', '/my dir/skills/codex/trace');
  assert.equal(commands.installSkill.claude, "mkdir -p ~/.claude/skills && ln -sfn '/my dir/skills/trace' ~/.claude/skills/trace");
  assert.equal(commands.installSkill.codex, "mkdir -p ~/.codex/skills && ln -sfn '/my dir/skills/codex/trace' ~/.codex/skills/trace");
  const plain = buildCliCommands('https://github.com/a/b/pull/1', '/x', '/opt/skills/trace', '/opt/skills/codex/trace');
  assert.equal(plain.installSkill.codex, 'mkdir -p ~/.codex/skills && ln -sfn /opt/skills/codex/trace ~/.codex/skills/trace');
});
