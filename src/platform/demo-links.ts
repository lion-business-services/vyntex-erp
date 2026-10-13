// Simulated connections of the sample workspace. A visitor can "connect" Gmail, Google Calendar, Google Drive and the
// other apps in the demo to see what each connection does with the sample company's records. Nothing is connected for
// real: no provider is called, no token exists, and every screen that shows one of these labels it as a demo simulation.
// They live in this browser only (localStorage), separately from the sample records, and Reset clears them.
// A live workspace never reads this file: its connections come from the server (src/platform/live/ops.ts).
import { useSyncExternalStore } from 'react';
import type { CtxLinks } from '@/domain/context';

export interface DemoLinkLine { key: string; params?: Record<string, string | number>; at: string }
export interface DemoLink { at: string; lastSyncAt?: string; /** Newest first: what the simulated connection did, by a rule or by Sync now. */ log: DemoLinkLine[] }
type Links = Record<string, DemoLink>;

const KEY = 'vyntex.demoLinks';
const listeners = new Set<() => void>();
let links: Links = read();

function read(): Links {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? (v as Links) : {}; } catch { return {}; }
}
function save(next: Links) {
  links = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: the simulation still works for this visit */ }
  listeners.forEach((l) => l());
}
const now = () => new Date().toISOString();

export const demoLinks = (): Links => links;
export const isDemoLinked = (id: string): boolean => !!links[id];
export function demoConnect(ids: string[]): void {
  const next = { ...links }; const at = now();
  for (const id of ids) if (!next[id]) next[id] = { at, lastSyncAt: at, log: [] };
  save(next);
}
export function demoDisconnect(id: string): void { const next = { ...links }; delete next[id]; save(next); }
export function demoRecord(id: string, line: { key: string; params?: Record<string, string | number> }): void {
  const cur = links[id]; if (!cur) return;
  const at = now();
  save({ ...links, [id]: { ...cur, lastSyncAt: at, log: [{ ...line, at }, ...cur.log].slice(0, 12) } });
}
export function demoClearLinks(): void { save({}); }

export function useDemoLinks(): Links {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => links, () => links);
}

/** What rule steps see in the sample workspace. */
export const demoCtxLinks: CtxLinks = { on: isDemoLinked, record: demoRecord };
