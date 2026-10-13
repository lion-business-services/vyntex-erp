// The records the field editions' samples get for the screens added with the edition blueprint: the service catalog,
// signature requests, review requests, social posts and opportunities. They are built from the sample business itself
// (its own service types, its own jobs, clients and agreements), so every edition shows its own trade and nothing here
// names a real person, company or opinion. The whole workspace is labelled as sample records on screen.
// Only a sample that brings none of these collections of its own is filled (the professional-services sample has its own).
import type { CatalogService, DemoState, Lang, Opportunity, ReviewRequest, SocialPost } from '@/domain/types';
import type { EnvelopeX } from '@/domain/esign/types';
import type { IndustryPack } from './types';
import { addDays, at } from '@/lib/dates';

const stamp = (n: number, hour = 10, minute = 0): string => {
  const iso = at(n, hour, minute); const now = new Date(Date.now() - 5 * 60000).toISOString();
  return iso > now ? now : iso;
};
const round = (n: number, to = 25) => Math.max(to, Math.round(n / to) * to);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function addFieldExtras(d: DemoState, pack: IndustryPack, lang: Lang): void {
  if (pack.family === 'practice') return;
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const owner = d.users.find((u) => u.role === 'owner')?.id ?? d.users[0]?.id ?? 'u1';
  const office = d.users.find((u) => u.role === 'staff')?.id ?? owner;

  /* ---------- the service catalog: one service per service type, priced from the sample's own work ---------- */
  if (!d.catalog.length) {
    d.catalog = pack.serviceTypes.map((st, i): CatalogService => {
      const prices = d.jobs.filter((j) => j.type === st.id && j.price > 0).map((j) => j.price);
      const leads = d.leads.filter((l) => l.type === st.id && (l.value ?? 0) > 0).map((l) => l.value as number);
      const base = round(median(prices.length ? prices : leads) || 0);
      const name = lang === 'es' ? st.es : st.en;
      return {
        id: `fs${i + 1}`, name, i18n: { en: { name: st.en }, es: { name: st.es } }, category: tx('Services', 'Servicios'), active: true,
        docKinds: ['estimate', 'contract', 'invoice'],
        tiers: base > 0
          ? [{ id: `fs${i + 1}-t1`, name: tx('Standard', 'Estándar'), price: base, unit: 'flat' }, { id: `fs${i + 1}-t2`, name: tx('Premium', 'Premium'), price: round(base * 1.35), unit: 'flat' }]
          : [{ id: `fs${i + 1}-t1`, name: tx('Quoted', 'Cotizado'), price: 0, unit: 'flat', note: tx('Priced after the visit', 'Se cotiza después de la visita') }],
      };
    });
  }
  const serviceOf = (type: string) => d.catalog.find((s, i) => pack.serviceTypes[i]?.id === type);

  /* ---------- the sentence a signer ticks, as the sample company wrote it; it says it is sample wording ---------- */
  const consentLine = (l: 'en' | 'es') => (l === 'es' ? 'Texto de muestra: acepto firmar este documento de forma electrónica.' : 'Sample wording: I agree to sign this document electronically.');
  if (!d.templates.some((x) => (x as { use?: string }).use === 'consent')) {
    for (const l of ['en', 'es'] as const) {
      const id = 'ft-consent-' + l;
      d.templates.push({ id, kind: 'custom', lang: l, source: 'company', approved: true, approvedBy: owner, approvedAt: stamp(-40, 15), active: true,
        name: l === 'es' ? 'Consentimiento para firmar electrónicamente' : 'Consent to sign electronically',
        blocks: [{ id: id + '-b1', type: 'p', text: consentLine(l) }], ...({ use: 'consent' } as object) });
    }
  }

  /* ---------- signature requests on two of the sample's own agreements: one waiting, one completed ---------- */
  if (!d.envelopes.length) {
    const agreements = d.docs.filter((x) => x.kind === 'contract' && !x.envelopeId);
    const make = (docIdx: number, done: boolean): EnvelopeX | null => {
      const doc = agreements[docIdx]; if (!doc) return null;
      const client = d.clients.find((c) => c.id === doc.clientId); if (!client) return null;
      const id = `fv${docIdx + 1}`; const ago = done ? -12 : -3;
      doc.envelopeId = id; doc.status = done ? 'signed' : 'viewed';
      const ownerUser = d.users.find((u) => u.id === owner);
      return {
        id, docId: doc.id, title: `${doc.title} ${doc.number}`, status: done ? 'completed' : 'sent', ordered: true, fields: [], demo: true,
        created: stamp(ago, 10), createdBy: owner, sentAt: stamp(ago, 10, 15), expiresAt: at(ago + 30, 10), remindEvery: 3, lang, clientId: client.id, jobId: doc.jobId,
        ...(done ? { completedAt: stamp(ago + 2, 16, 40) } : { lastReminder: stamp(-1, 9) }),
        consentText: consentLine(lang === 'es' ? 'es' : 'en'),
        signers: done
          ? [
            { id: `${id}-s1`, name: client.name, email: client.email, role: 'client', order: 1, status: 'signed', viewedAt: stamp(ago + 1, 8, 5), signedAt: stamp(ago + 1, 8, 11), typedName: client.name, consent: true },
            { id: `${id}-s2`, name: ownerUser?.name ?? '', email: ownerUser?.email ?? '', role: 'company', order: 2, status: 'signed', viewedAt: stamp(ago + 2, 16, 32), signedAt: stamp(ago + 2, 16, 40), typedName: ownerUser?.name ?? '', consent: true },
          ]
          : [{ id: `${id}-s1`, name: client.name, email: client.email, role: 'client', order: 1, status: 'viewed', viewedAt: stamp(-2, 18) }],
        events: done
          ? [{ at: stamp(ago, 10), kind: 'created' }, { at: stamp(ago, 10, 15), kind: 'sent', signerId: `${id}-s1` }, { at: stamp(ago + 1, 8, 5), kind: 'viewed', signerId: `${id}-s1` }, { at: stamp(ago + 1, 8, 11), kind: 'signed', signerId: `${id}-s1` }, { at: stamp(ago + 2, 16, 40), kind: 'signed', signerId: `${id}-s2` }, { at: stamp(ago + 2, 16, 40), kind: 'completed' }]
          : [{ at: stamp(ago, 10), kind: 'created' }, { at: stamp(ago, 10, 15), kind: 'sent', signerId: `${id}-s1` }, { at: stamp(-2, 18), kind: 'viewed', signerId: `${id}-s1` }, { at: stamp(-1, 9), kind: 'reminded', signerId: `${id}-s1`, note: 'auto' }],
      } as EnvelopeX;
    };
    d.envelopes = [make(0, false), make(1, true)].filter((x): x is EnvelopeX => !!x);
  }

  /* ---------- review requests for completed work: answered with a star rating, or still waiting ---------- */
  if (!d.reviews.length) {
    const done = d.jobs.filter((j) => j.status === 'done').slice(0, 4);
    d.reviews = done.map((j, i): ReviewRequest => {
      const n = -(4 + i * 6);
      const answered = i !== 1;
      return { id: `fr${i + 1}`, clientId: j.clientId, jobId: j.id, at: stamp(n, 11), channel: 'email', status: answered ? 'rated' : 'opened', ...(answered ? { rating: i === 3 ? 4 : 5 } : {}), by: office,
        ...({ token: `sample-fr${i + 1}`, expires: addDays(n + 30), openedAt: stamp(n + 1, 19), ...(answered ? { answeredAt: stamp(n + 1, 19, 6) } : {}) } as object) };
    });
  }

  /* ---------- social posts written from the edition's own services ---------- */
  if (!d.posts.length) {
    const s1 = pack.serviceTypes[0]; const s2 = pack.serviceTypes[1] ?? s1;
    const label = (st: typeof s1) => (lang === 'es' ? st.es : st.en);
    const name = (st: typeof s1) => label(st).toLowerCase();
    const phone = d.company.phone ? ` ${d.company.phone}` : '';
    d.posts = [
      { id: 'fp1', status: 'draft', by: office, created: stamp(-1, 15, 20), channels: ['facebook', 'instagram'],
        text: tx(`Now booking for next month: ${label(s1)}. Call or message us for a free estimate.${phone}`, `Ya agendamos para el próximo mes: ${label(s1)}. Llámenos o escríbanos para un presupuesto gratis.${phone}`) },
      { id: 'fp2', status: 'scheduled', by: office, approvedBy: owner, created: stamp(-2, 11), scheduledFor: at(3, 10, 0), channels: ['facebook', 'gbp'],
        text: tx(`Questions about ${name(s2)}? Ask us what it takes and how long it lasts. We are happy to walk you through it.`, `¿Tiene preguntas sobre ${name(s2)}? Pregúntenos qué se necesita y cuánto dura. Con gusto le explicamos.`) },
      { id: 'fp3', status: 'demo', by: owner, approvedBy: owner, created: stamp(-6, 9), publishedAt: stamp(-5, 10), channels: ['facebook', 'gbp'],
        text: tx('Thank you to every customer who trusted us this season. We answer in English and Spanish.', 'Gracias a cada cliente que confió en nosotros esta temporada. Atendemos en inglés y en español.') },
    ] satisfies SocialPost[];
  }

  /* ---------- opportunities: a second service for customers whose work is done ---------- */
  if (!d.opportunities.length && d.catalog.length > 1) {
    const done = d.jobs.filter((j) => j.status === 'done');
    const list: Opportunity[] = [];
    for (const j of done) {
      if (list.length >= 3) break;
      const mine = serviceOf(j.type);
      const priced = d.catalog.filter((s) => s.id !== mine?.id && s.tiers[0]?.price > 0);
      const other = priced[(list.length * 3 + 1) % Math.max(1, priced.length)];
      if (!other || list.some((o) => o.clientId === j.clientId)) continue;
      list.push({ id: `fo${list.length + 1}`, clientId: j.clientId, serviceId: other.id, status: list.length === 2 ? 'contacted' : 'open', created: addDays(-(2 + list.length * 3)), by: owner, value: other.tiers[0].price,
        note: tx(`Finished ${j.name}; a good moment to offer ${other.name.toLowerCase()}.`, `Terminó ${j.name}; buen momento para ofrecer ${other.name.toLowerCase()}.`) });
    }
    d.opportunities = list;
  }
}
