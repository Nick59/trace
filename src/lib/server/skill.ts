import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function skillInstalled(): boolean {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');
  try { return statSync(path.join(claudeDir, 'skills', 'trace', 'SKILL.md')).isFile(); }
  catch { return false; }
}

export function mcpRegistered(): boolean {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  const file = configDir ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  try {
    const config: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!config || typeof config !== 'object') return false;
    const servers = (config as { mcpServers?: unknown }).mcpServers;
    return Boolean(servers) && typeof servers === 'object' && !Array.isArray(servers) && Object.hasOwn(servers as object, 'trace');
  } catch { return false; }
}

const codexHome = () => process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');

export function codexSkillInstalled(): boolean {
  try { return statSync(path.join(codexHome(), 'skills', 'trace', 'SKILL.md')).isFile(); }
  catch { return false; }
}

export function codexMcpRegistered(): boolean {
  try {
    return readFileSync(path.join(codexHome(), 'config.toml'), 'utf8').split(/\r?\n/).some((line) => /^\s*\[mcp_servers\.(trace|"trace")\]\s*$/.test(line));
  } catch { return false; }
}
