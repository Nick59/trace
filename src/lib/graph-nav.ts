export interface NavStep { id: string }
export interface NavEdge { from: string; to: string }
export interface GraphNav { up: string | null; down: string | null; left: string | null; right: string | null }
export interface NavMemory { cameFrom?: Record<string, string>; choices?: Record<string, string> }

const position = (id: string) => Number(id.slice(1));
const byPosition = (a: string, b: string) => position(a) - position(b);

/**
 * Keyboard targets over the workflow graph. Down follows an outgoing edge (the branch last chosen at a fork, else the lowest step);
 * up returns to the step the user came from when it is a real predecessor, else the lowest predecessor;
 * left and right move between the other successors of that parent, ordered by `x` (rendered position) when known.
 */
export function graphNav(steps: NavStep[], edges: NavEdge[], currentId: string, memory: NavMemory = {}, x?: (id: string) => number | undefined): GraphNav {
  const known = new Set(steps.map((step) => step.id));
  const successors = (id: string) => [...new Set(edges.filter((edge) => edge.from === id && known.has(edge.to)).map((edge) => edge.to))].sort(byPosition);
  const predecessors = (id: string) => [...new Set(edges.filter((edge) => edge.to === id && known.has(edge.from)).map((edge) => edge.from))].sort(byPosition);

  const next = successors(currentId);
  const chosen = memory.choices?.[currentId];
  const down = next.length === 0 ? null : chosen && next.includes(chosen) ? chosen : next[0];

  const parents = predecessors(currentId);
  const origin = memory.cameFrom?.[currentId];
  const up = parents.length === 0 ? null : origin && parents.includes(origin) ? origin : parents[0];

  const siblings = up ? successors(up) : [];
  if (siblings.length > 1 && x) {
    siblings.sort((a, b) => (x(a) ?? Infinity) - (x(b) ?? Infinity) || byPosition(a, b));
  }
  const index = siblings.indexOf(currentId);
  return { up, down, left: index > 0 ? siblings[index - 1] : null, right: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null };
}
