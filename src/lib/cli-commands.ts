export const INSTRUCTION_MAX = 500;

export interface CliCommands {
  claude: string;
  codex: string;
  installSkill: { claude: string; codex: string };
  register: { claude: string; codex: string };
  recompute(workflowId: string, instruction?: string): { claude: string; codex: string };
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

// A shell argument cannot hold a NUL byte, so it is dropped rather than quoted.
export function cleanInstruction(instruction: string | undefined): string {
  return (instruction ?? '').replaceAll('\0', '').trim().slice(0, INSTRUCTION_MAX);
}

export function buildCliCommands(url: string, launcher: string, skillDir: string, codexSkillDir: string): CliCommands {
  const quotedLauncher = shellQuote(launcher);
  return {
    claude: `claude ${shellQuote(`/trace ${url}`)}`,
    codex: `codex ${shellQuote(`$trace ${url}`)}`,
    installSkill: {
      claude: `mkdir -p ~/.claude/skills && ln -sfn ${shellQuote(skillDir)} ~/.claude/skills/trace`,
      codex: `mkdir -p ~/.codex/skills && ln -sfn ${shellQuote(codexSkillDir)} ~/.codex/skills/trace`
    },
    register: { claude: `claude mcp add --scope user trace -- node ${quotedLauncher}`, codex: `codex mcp add trace -- node ${quotedLauncher}` },
    recompute(workflowId, instruction) {
      const text = cleanInstruction(instruction);
      const prompt = `${url} ${workflowId}${text ? ` ${text.replace(/\s+/g, ' ')}` : ''}`;
      return { claude: `claude ${shellQuote(`/trace ${prompt}`)}`, codex: `codex ${shellQuote(`$trace ${prompt}`)}` };
    }
  };
}
