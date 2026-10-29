import { writeFileSync } from 'node:fs';
import { analysisGuide, singleWorkflowGuide } from '../src/lib/server/analysis-guide';
import { LIMITS } from '../src/lib/server/workflows';

for (const dir of ['trace', 'codex/trace']) {
  writeFileSync(new URL(`../skills/${dir}/analysis-guide.md`, import.meta.url), `${analysisGuide(LIMITS)}\n`);
  writeFileSync(new URL(`../skills/${dir}/recompute-guide.md`, import.meta.url), `${singleWorkflowGuide(LIMITS)}\n`);
}
