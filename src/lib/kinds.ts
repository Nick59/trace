import { Globe, MousePointerClick, Shapes, Terminal, Timer, Zap } from '@lucide/svelte';
import type { EntrypointKind } from '$lib/types';

export const kindMeta = {
  http: { label: 'http', icon: Globe },
  cli: { label: 'cli', icon: Terminal },
  job: { label: 'job', icon: Timer },
  event: { label: 'event', icon: Zap },
  ui: { label: 'ui', icon: MousePointerClick },
  other: { label: 'other', icon: Shapes }
} as const satisfies Record<EntrypointKind, { label: string; icon: unknown }>;

// Hex mirrors of --kind-* in app.css; Mermaid cannot parse light-dark() or OKLCH.
export const kindHex = {
  dark: { http: '#22d3ee', cli: '#fbbf24', job: '#a78bfa', event: '#f472b6', ui: '#34d399', other: '#94a3b8' },
  light: { http: '#0e7490', cli: '#b45309', job: '#6d28d9', event: '#be185d', ui: '#047857', other: '#475569' }
} as const satisfies Record<'dark' | 'light', Record<EntrypointKind, string>>;

export function motionMs(ms: number): number {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
}
