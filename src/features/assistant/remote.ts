// Connected mode.
//   live workspace   VYNTEX AI (0095): the signed-in office operations assistant_status / assistant_ask. On for the
//                    Master Builder plan (and VYNTEX USA's own workspace); the server asks Groq's free model and returns
//                    text plus up to 5 actions
//   sample / demo    the older server function api/assistant.js, when a model is set up for it (one action)
// The browser sends a compact summary of the business (only what the person's role may see, see context.ts). Nothing is
// carried out on the server: each action is checked here by the business rules, the safe ones run, the risky ones wait
// for the person's Confirm (index.tsx).
import { PREVIEW } from '@/app/router';
import { isLive } from '@/platform/session';
import { type Env, type Proposal } from './engine';
import { maskTaxIds } from './records';
import { buildContext, toProposal } from './context';
export { buildContext, toProposal } from './context';

const ENDPOINT = '/api/assistant';

/** Asks once, on page load, whether an AI model is connected for this person. Any failure means "no": the page stays on the built-in assistant. */
export async function checkConfigured(): Promise<boolean> {
  if (PREVIEW) return false; // an embedded preview has no server behind it
  if (isLive()) {
    try {
      const { rpc } = await import('@/platform/live/ops');
      const a = await rpc<{ configured: boolean; allowed: boolean }>('assistant_status', {});
      return a.ok && a.data.result?.configured === true && a.data.result?.allowed === true;
    } catch { return false; }
  }
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return false;
    const body = await res.json();
    return body?.configured === true;
  } catch { return false; }
}

export interface Turn { role: 'user' | 'assistant'; content: string }
/** One action the model asked for: ready to carry out, or why it cannot be. */
export type ModelAction = { proposal: Proposal; problem?: undefined } | { proposal?: undefined; problem: string };
export interface ModelReply { text: string; actions: ModelAction[]; /** The first action, kept for the older one-action flow. */ proposal?: Proposal; problem?: string }

const toActions = (raw: unknown, env: Env): ModelAction[] => (Array.isArray(raw) ? raw : []).slice(0, 5).flatMap((a): ModelAction[] => {
  if (!a || typeof a !== 'object' || typeof (a as { tool?: unknown }).tool !== 'string') return [];
  const input = (a as { input?: unknown }).input;
  if (!input || typeof input !== 'object') return [];
  const p = toProposal((a as { tool: string }).tool, input as Record<string, unknown>, env);
  return p && typeof p === 'object' ? [{ proposal: p }] : [{ problem: p ?? env.t('asst.model.badAction') }];
});

/** One round trip. Returns null when the model could not answer, so the caller can fall back to the built-in assistant. */
export async function askModel(turns: Turn[], env: Env): Promise<ModelReply | null> {
  try {
    // a tax ID someone typed into the conversation is masked before the conversation leaves the browser
    const messages = turns.slice(-12).map((m) => ({ role: m.role, content: maskTaxIds(m.content).slice(0, 1900) }));
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) return null;
    const lang = env.lang === 'es' ? 'es' : 'en';
    let text: string; let rawActions: unknown;
    if (isLive()) {
      const { rpc } = await import('@/platform/live/ops');
      const a = await rpc<{ text: string; actions: unknown }>('assistant_ask', { lang, messages, context: buildContext(env), company: env.data.company.name });
      if (!a.ok || typeof a.data.result?.text !== 'string') return null;
      text = a.data.result.text; rawActions = a.data.result.actions;
    } else {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ lang, messages, context: buildContext(env) }) });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || body.ok !== true || typeof body.text !== 'string') return null;
      text = body.text; rawActions = body.action ? [body.action] : [];
    }
    const actions = toActions(rawActions, env);
    if (!text.trim() && !actions.length) return null;
    const first = actions[0];
    return { text: maskTaxIds(text), actions, proposal: first?.proposal, problem: first?.problem };
  } catch { return null; }
}
