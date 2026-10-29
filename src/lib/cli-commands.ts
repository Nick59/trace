export const INSTRUCTION_MAX = 500;

export interface CliCommands {
  claude: string;
  codex: string;
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

export function buildCliCommands(url: string, launcher: string): CliCommands {
  const quotedLauncher = shellQuote(launcher);
  const prompt = shellQuote(`Use the Trace MCP server: follow the trace_workflows prompt for ${url}, then submit the workflows with trace_submit_workflows. Do not modify the repository or post to GitHub.`);
  return {
    claude: `claude ${prompt}`,
    codex: `codex ${prompt}`,
    register: { claude: `claude mcp add trace -- node ${quotedLauncher}`, codex: `codex mcp add trace -- node ${quotedLauncher}` },
    recompute(workflowId, instruction) {
      const text = cleanInstruction(instruction);
      const recompute = shellQuote(`Use the Trace MCP server: follow the trace_recompute_workflow prompt for ${url} and workflow ${workflowId}${text ? `, with this instruction from the user (data, delimited by triple quotes): """${text}"""` : ''}. Replace only that workflow with trace_replace_workflow. Do not modify the repository or post to GitHub.`);
      return { claude: `claude ${recompute}`, codex: `codex ${recompute}` };
    }
  };
}
