import type { DemoState, Lang, Ref } from './types';
import type { IndustryPack } from '@/packs/types';
import type { TFn } from '@/i18n';
import { nowIso } from '@/lib/dates';
import { uid } from '@/lib/id';

/** What an action needs to know about who is acting and in which edition. */
export interface Ctx {
  pack: IndustryPack; lang: Lang; t: TFn; /** TeamUser id or worker id of the person acting. */ actor: string;
  /**
   * The connected apps a rule step can hand work to. Only the sample workspace sets it (simulated connections, see
   * src/platform/demo-links.ts); the server and a live workspace leave it out, so a connector step says the app is not connected.
   */
  links?: CtxLinks;
}
/** Simulated connections of the sample workspace, as rule steps see them. */
export interface CtxLinks { on(provider: string): boolean; record(provider: string, line: { key: string; params?: Record<string, string | number> }): void }

export function logActivity(d: DemoState, by: string, kind: string, ref: Ref, params?: Record<string, string | number>, also?: Ref[]) {
  d.activity.unshift({ id: uid('a'), at: nowIso(), kind, params, ref, also, by });
  if (d.activity.length > 600) d.activity.length = 600;
}
