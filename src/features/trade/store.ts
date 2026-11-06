// The trade sections of the HVAC and plumbing editions (dispatch, equipment, plans, permits, refrigerant, backflow, camera).
// DEMO LEVEL: these screens exist only in the public demo (see TRADE_SECTIONS and modules.ts). Their records live in this
// browser tab, start from the sample business of the edition (sample.ts) and are never sent to a server. Anything they
// do to the real workspace data (a task, a lead) goes through the normal actions (act), like any other screen.
import { useSyncExternalStore } from 'react';
import type { IndustryId, Lang } from '@/domain/types';
import { sampleFor } from './sample';

export type SectionId = 'dispatch' | 'agreements' | 'equipment' | 'supplies' | 'permits';
/** The trade sections of each edition, in menu order. */
export const TRADE_SECTIONS: Partial<Record<IndustryId, SectionId[]>> = {
  hvac: ['dispatch', 'agreements', 'equipment', 'supplies', 'permits'],
  plumbing: ['dispatch', 'agreements', 'equipment', 'supplies', 'permits'],
};

export type EquipStatus = 'good' | 'watch' | 'replace';
export interface Equipment {
  id: string; clientId: string; kind: string; detail: string; location: string; model: string; serial: string;
  installed: string; partsWarranty?: string; laborWarranty?: string; lastService?: string; nextService?: string;
  refrigerant?: string; filter?: string; status: EquipStatus; note?: string; quoted?: boolean;
}
export type PermitStatus = 'applied' | 'approved' | 'rough' | 'final_booked' | 'passed' | 'failed';
export interface Permit { id: string; jobId: string; kind: string; town: string; number: string; applied: string; status: PermitStatus; inspection?: string; note?: string }
export interface RefrigerantEntry { id: string; date: string; jobId?: string; clientId: string; workerId: string; gas: string; added: number; recovered: number; cylinder: string; leak: 'none' | 'found_repaired' | 'found_open'; note?: string }
export type DeviceKind = 'RPZ' | 'DCVA' | 'PVB';
export interface Device { id: string; clientId: string; kind: DeviceKind; size: string; location: string; serial: string; lastTest?: string; result?: 'pass' | 'fail'; due: string; filed: boolean; readings?: string }
export interface Finding { at: number; kind: 'roots' | 'crack' | 'belly' | 'grease' | 'offset' | 'ok'; text: string }
export interface Inspection { id: string; clientId: string; jobId?: string; date: string; line: string; length: number; workerId: string; findings: Finding[]; advice: string; shared: boolean; quoted?: boolean }
export type DispatchState = 'waiting' | 'en_route' | 'on_site' | 'done';
export interface Dispatch { id: string; ref: { type: 'job' | 'lead'; id: string }; workerId?: string; window: string; state: DispatchState; urgent?: boolean; title: string; clientName: string; address: string }
export interface OnCall { workerId: string }
/** The company's own stock: parts and supplies in the warehouse (`where: 'shop'`) or on a technician's truck (a worker id). */
export interface StockItem { id: string; name: string; group: 'parts' | 'refrigerant' | 'consumables' | 'pipe' | 'fixtures'; where: string; qty: number; min: number; unit: string; cost: number; vendor: string }
/** Tools and test instruments the team uses, who has them and when they are due for calibration or service. */
export interface Tool { id: string; name: string; serial: string; holder: string; calibrationDue?: string; serviceDue?: string; status: 'ok' | 'service' | 'out' }

export interface TradeState {
  equipment: Equipment[]; permits: Permit[]; refrigerant: RefrigerantEntry[]; devices: Device[]; inspections: Inspection[];
  dispatch: Dispatch[]; onCall: OnCall;
  stock: StockItem[]; tools: Tool[];
  /** What was already booked, sent or quoted from these screens (`visit:j12`, `test:b5`...), so nothing is done twice. */
  done: Record<string, true>;
}

const states = new Map<string, TradeState>();
const subs = new Set<() => void>();
let version = 0;
const key = (pack: IndustryId, lang: Lang) => pack + ':' + lang;

/** The trade records of the edition on screen, made from its sample business the first time they are asked for. */
export function tradeState(pack: IndustryId, lang: Lang, seed: () => TradeState): TradeState {
  const k = key(pack, lang);
  let s = states.get(k);
  if (!s) { s = seed(); states.set(k, s); }
  return s;
}
export function updateTrade(pack: IndustryId, lang: Lang, change: (s: TradeState) => TradeState) {
  const k = key(pack, lang); const s = states.get(k); if (!s) return;
  states.set(k, change(s)); version++; subs.forEach((f) => f());
}
/** Starts the trade records again from the sample business (the demo's "Reset"). */
export function resetTrade() { states.clear(); version++; subs.forEach((f) => f()); }
export function useTradeVersion(): number {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version, () => version);
}
export { sampleFor };
