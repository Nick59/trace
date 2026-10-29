import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
process.chdir(repositoryRoot);

try { process.loadEnvFile(path.join(repositoryRoot, '.env')); }
catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
}

try {
  const { register } = await import('tsx/esm/api');
  register();
  const { runMcpServer } = await import('./mcp.ts');
  await runMcpServer();
} catch (error) {
  console.error('Unable to start Trace PR Reviewer MCP server:', error);
  process.exitCode = 1;
}
