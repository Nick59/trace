import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { codexMcpRegistered, codexSkillInstalled, mcpRegistered, skillInstalled } from './skill';

function withClaudeDir(run: (dir: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'trace-skill-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try { run(dir); }
  finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('skillInstalled is false when the skill is missing', () => {
  withClaudeDir(() => assert.equal(skillInstalled(), false));
});

test('skillInstalled is true for a real SKILL.md', () => {
  withClaudeDir((dir) => {
    mkdirSync(path.join(dir, 'skills', 'trace'), { recursive: true });
    writeFileSync(path.join(dir, 'skills', 'trace', 'SKILL.md'), '# trace');
    assert.equal(skillInstalled(), true);
  });
});

test('skillInstalled is true for a symlinked skill directory', () => {
  withClaudeDir((dir) => {
    const source = path.join(dir, 'source');
    mkdirSync(source);
    writeFileSync(path.join(source, 'SKILL.md'), '# trace');
    mkdirSync(path.join(dir, 'skills'));
    symlinkSync(source, path.join(dir, 'skills', 'trace'));
    assert.equal(skillInstalled(), true);
  });
});

test('skillInstalled is false for a dangling symlink', () => {
  withClaudeDir((dir) => {
    mkdirSync(path.join(dir, 'skills'));
    symlinkSync(path.join(dir, 'missing'), path.join(dir, 'skills', 'trace'));
    assert.equal(skillInstalled(), false);
  });
});

test('mcpRegistered is false without a config file', () => {
  withClaudeDir(() => assert.equal(mcpRegistered(), false));
});

test('mcpRegistered is false for invalid JSON', () => {
  withClaudeDir((dir) => {
    writeFileSync(path.join(dir, '.claude.json'), '{nope');
    assert.equal(mcpRegistered(), false);
  });
});

test('mcpRegistered is true for a user-scope trace server', () => {
  withClaudeDir((dir) => {
    writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { trace: { command: 'node' } } }));
    assert.equal(mcpRegistered(), true);
  });
});

test('mcpRegistered is false for a local-scope trace server only', () => {
  withClaudeDir((dir) => {
    writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects: { '/repo': { mcpServers: { trace: {} } } } }));
    assert.equal(mcpRegistered(), false);
  });
});

function withCodexHome(run: (dir: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'trace-codex-'));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dir;
  try { run(dir); }
  finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('codexSkillInstalled follows CODEX_HOME and needs a SKILL.md file', () => {
  withCodexHome((dir) => {
    assert.equal(codexSkillInstalled(), false);
    mkdirSync(path.join(dir, 'skills', 'trace'), { recursive: true });
    assert.equal(codexSkillInstalled(), false);
    writeFileSync(path.join(dir, 'skills', 'trace', 'SKILL.md'), '---\nname: "trace"\n---\n');
    assert.equal(codexSkillInstalled(), true);
  });
});

test('codexSkillInstalled accepts a symlinked skill directory', () => {
  withCodexHome((dir) => {
    const target = mkdtempSync(path.join(os.tmpdir(), 'trace-codex-target-'));
    try {
      writeFileSync(path.join(target, 'SKILL.md'), 'x');
      mkdirSync(path.join(dir, 'skills'), { recursive: true });
      symlinkSync(target, path.join(dir, 'skills', 'trace'));
      assert.equal(codexSkillInstalled(), true);
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test('codexMcpRegistered reads the mcp_servers.trace table from config.toml', () => {
  withCodexHome((dir) => {
    assert.equal(codexMcpRegistered(), false);
    writeFileSync(path.join(dir, 'config.toml'), '[mcp_servers.other]\ncommand = "x"\n[mcp_servers.trace_two]\n');
    assert.equal(codexMcpRegistered(), false);
    writeFileSync(path.join(dir, 'config.toml'), 'model = "x"\n  [mcp_servers.trace]  \ncommand = "node"\n');
    assert.equal(codexMcpRegistered(), true);
    writeFileSync(path.join(dir, 'config.toml'), '[mcp_servers."trace"]\ncommand = "node"\n');
    assert.equal(codexMcpRegistered(), true);
    writeFileSync(path.join(dir, 'config.toml'), '# [mcp_servers.trace]\n');
    assert.equal(codexMcpRegistered(), false);
  });
});
