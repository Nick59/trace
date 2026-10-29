import { analysisHistory, setupCommands } from '$lib/server/pr-page';
import { codexMcpRegistered, codexSkillInstalled, mcpRegistered, skillInstalled } from '$lib/server/skill';

export function load() {
  const history = analysisHistory();
  const setup = {
    commands: setupCommands(),
    steps: {
      claude: { mcp: mcpRegistered(), skill: skillInstalled() },
      codex: { mcp: codexMcpRegistered(), skill: codexSkillInstalled() },
      appUrl: Boolean(process.env.TRACE_APP_URL?.trim()),
      analyzed: history.length > 0
    }
  };
  return { setup, history };
}
