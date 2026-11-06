// The completion certificate: the page added behind a signed document. It lists what was recorded and nothing else:
// the document, two fingerprints, and for every signer the name, the email address, when their link went out, when they
// opened it, when they signed, and the consent they ticked. It makes no statement about any law.
import type { ISODateTime, Lang } from '../types';
import type { DrawOp, EnvelopeX, FontId, PageSize, PageView, RGB } from './types';
import { type Measure, wrapper } from './text';

export interface CertRow { label: string; value: string; mono?: boolean; /** Where it is printed: the document facts, the fingerprints or the consent sentence. */ part?: 'doc' | 'hash' | 'consent' }
export interface CertSigner { heading: string; name: string; rows: CertRow[]; /** The signature as drawn (PNG data address), shown on the signer's card. */ ink?: string; signed: boolean }
export interface CertificateModel {
  title: string;
  /** "Completed" or the state of the request, and the line beside it. */
  status: string; statusLine: string;
  rows: CertRow[];
  signers: CertSigner[];
  /** Headings of the parts of the page. */
  parts: { doc: string; hash: string; signers: string; consent: string; signature: string; noInk: string; record: string };
  /** What this page is, in one sentence. */
  note: string;
  /** Present on a sample: says plainly that nothing was sent and nothing is legally signed. */
  sample?: string;
  footer: string;
  /** "Recorded with VYNTEX ERP": the product that kept the record. */
  product: string;
}
/** The brand drawn in the header: the product's mark and wordmark (JPEG or PNG bytes), on its own dark band. */
export interface CertificateBrand { mark?: Uint8Array; wordmark?: Uint8Array; /** Band color behind the images, so they sit on it seamlessly. */ band?: RGB; accent?: RGB; site?: string }
export interface CertificateInput {
  env: EnvelopeX;
  docTitle: string;
  docNumber?: string;
  company: string;
  /** Name of the person who sent the request. */
  sentBy?: string;
  /** Product the record was made with, e.g. "VYNTEX ERP". */
  product: string;
  hashes: { original: string; signed: string };
  lang: Lang;
  sample: boolean;
  /** Logo of the product in the header; without it, the product name is written there. */
  brand?: CertificateBrand;
}

const L = {
  en: {
    title: 'Certificate of Completion', kicker: 'Electronic signature record', status: 'Completed', statusLine: (n: number, at: string) => `${n === 1 ? 'The signer' : `All ${n} signers`} signed. Completed ${at}.`, open: 'In progress', openLine: (n: number, m: number) => `${n} of ${m} signers signed.`, pDoc: 'Document', pHash: 'Integrity', pSigners: 'Signers', pConsent: 'Consent to sign electronically', pSignature: 'Signature', noInk: 'No signature image recorded', record: (p: string) => `Recorded with ${p}`, doc: 'Document', number: 'Document number', id: 'Request ID', company: 'Sent by', order: 'Signing order', seq: 'One after another', par: 'Everyone at the same time',
    sent: 'Sent', completed: 'Completed', original: 'Original file, SHA-256', signed: 'Signed pages, SHA-256', signedNote: 'The fingerprint of the signed pages was taken with every box filled in, before this certificate page was added.',
    signer: 'Signer', name: 'Name', typed: 'Name typed when signing', email: 'Email', role: 'Signs as', linkSent: 'Link made available', viewed: 'Opened', signedAt: 'Signed', consent: 'Consent',
    consentYes: (at: string) => `Ticked the consent box on ${at}.`, consentText: 'Sentence shown', notRecorded: 'Not recorded',
    note: (p: string) => `This page lists what ${p} recorded for this signature request. It makes no statement about legal effect.`,
    sample: 'Sample record. No message was sent to anyone and nothing here is a legally binding signature.', watermark: 'Sample: not a legally binding signature',
    page: (n: number, t: number) => `Certificate page ${n} of ${t}`,
    roles: { client: 'Client', co_owner: 'Co-owner', spouse: 'Spouse', firm: 'Company representative' } as Record<string, string>,
  },
  es: {
    title: 'Certificado de finalización', kicker: 'Registro de firma electrónica', status: 'Completado', statusLine: (n: number, at: string) => `${n === 1 ? 'El firmante firmó' : `Los ${n} firmantes firmaron`}. Completado ${at}.`, open: 'En curso', openLine: (n: number, m: number) => `${n} de ${m} firmantes firmaron.`, pDoc: 'Documento', pHash: 'Integridad', pSigners: 'Firmantes', pConsent: 'Consentimiento para firmar electrónicamente', pSignature: 'Firma', noInk: 'Sin imagen de firma registrada', record: (p: string) => `Registrado con ${p}`, doc: 'Documento', number: 'Número de documento', id: 'ID de la solicitud', company: 'Enviado por', order: 'Orden de firma', seq: 'Uno después de otro', par: 'Todos al mismo tiempo',
    sent: 'Enviado', completed: 'Completado', original: 'Archivo original, SHA-256', signed: 'Páginas firmadas, SHA-256', signedNote: 'La huella de las páginas firmadas se tomó con todos los campos llenos, antes de agregar esta página de certificado.',
    signer: 'Firmante', name: 'Nombre', typed: 'Nombre escrito al firmar', email: 'Correo', role: 'Firma como', linkSent: 'Enlace disponible', viewed: 'Abierto', signedAt: 'Firmado', consent: 'Consentimiento',
    consentYes: (at: string) => `Marcó la casilla de consentimiento el ${at}.`, consentText: 'Frase mostrada', notRecorded: 'Sin registro',
    note: (p: string) => `Esta página enumera lo que ${p} registró para esta solicitud de firma. No afirma nada sobre su efecto legal.`,
    sample: 'Registro de muestra. No se envió ningún mensaje a nadie y nada aquí es una firma con validez legal.', watermark: 'Muestra: no es una firma con validez legal',
    page: (n: number, t: number) => `Página ${n} de ${t} del certificado`,
    roles: { client: 'Cliente', co_owner: 'Copropietario', spouse: 'Cónyuge', firm: 'Representante de la empresa' } as Record<string, string>,
  },
};
const words = (lang: Lang) => (lang === 'es' ? L.es : L.en);
/** Label of a signer's role in a language; a role the company typed itself is shown as typed. */
export const roleLabel = (role: string | undefined, lang: Lang): string => (role ? words(lang).roles[role] ?? role : '');
export const watermarkText = (lang: Lang): string => words(lang).watermark;
/** A moment written so it cannot be misread: 2026-03-04 15:07:22 UTC. */
export const utcStamp = (iso?: ISODateTime): string => { const d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : ''; };

export function certificateModel(i: CertificateInput): CertificateModel {
  const t = words(i.lang); const e = i.env;
  const at = (iso?: ISODateTime) => utcStamp(iso) || t.notRecorded;
  const rows: CertRow[] = [
    { label: t.doc, value: i.docTitle, part: 'doc' },
    ...(i.docNumber ? [{ label: t.number, value: i.docNumber, part: 'doc' as const }] : []),
    { label: t.id, value: e.id, part: 'doc' },
    { label: t.company, value: [i.company, i.sentBy].filter(Boolean).join(' · '), part: 'doc' },
    { label: t.order, value: e.ordered && e.signers.length > 1 ? t.seq : t.par, part: 'doc' },
    { label: t.sent, value: at(e.sentAt), part: 'doc' },
    { label: t.completed, value: at(e.completedAt), part: 'doc' },
    { label: t.original, value: i.hashes.original, mono: true, part: 'hash' },
    { label: t.signed, value: i.hashes.signed, mono: true, part: 'hash' },
  ];
  const ordered = [...e.signers].sort((a, b) => a.order - b.order);
  const signers: CertSigner[] = ordered.map((s, n) => ({
    heading: `${t.signer} ${n + 1}`, name: s.name, ink: s.signature || undefined, signed: !!s.signedAt,
    rows: [
      { label: t.name, value: s.name },
      ...(s.typedName && s.typedName !== s.name ? [{ label: t.typed, value: s.typedName }] : []),
      { label: t.email, value: s.email },
      ...(s.role ? [{ label: t.role, value: roleLabel(s.role, i.lang) }] : []),
      { label: t.linkSent, value: at(s.sentAt) },
      { label: t.viewed, value: at(s.viewedAt) },
      { label: t.signedAt, value: at(s.signedAt) },
      { label: t.consent, value: s.consent ? t.consentYes(at(s.consentAt ?? s.signedAt)) : t.notRecorded },
    ] as CertRow[],
  }));
  if (e.consentText) rows.push({ label: t.consentText, value: e.consentText, part: 'consent' });
  const done = signers.filter((s) => s.signed).length;
  const complete = e.status === 'completed';
  return {
    title: t.title, rows, signers,
    status: complete ? t.status : t.open,
    statusLine: complete ? t.statusLine(signers.length, at(e.completedAt)) : t.openLine(done, signers.length),
    parts: { doc: t.pDoc, hash: t.pHash, signers: t.pSigners, consent: t.pConsent, signature: t.pSignature, noInk: t.noInk, record: t.record(i.product) },
    note: `${t.note(i.product)} ${t.signedNote}`, sample: i.sample ? t.sample : undefined, footer: `${i.company} · ${e.id}`, product: i.product,
  };
}

const INK: RGB = [0.086, 0.125, 0.18];
const HEAD: RGB = [0.043, 0.106, 0.2];
const MUTED: RGB = [0.36, 0.41, 0.49];
const LINE: RGB = [0.85, 0.87, 0.9];
const PANEL: RGB = [0.972, 0.977, 0.985];
const WHITE: RGB = [1, 1, 1];
/** Near black of the VYNTEX logo files, so the logo sits on the band without an edge. */
const BAND: RGB = [0.02, 0.027, 0.047];
const ACCENT: RGB = [0, 0.73, 0.9];
const OK: RGB = [0.07, 0.5, 0.33];
const OK_SOFT: RGB = [0.9, 0.97, 0.93];
const WAIT: RGB = [0.62, 0.42, 0.04];
const WAIT_SOFT: RGB = [0.99, 0.95, 0.86];

/** Image keys of a certificate: the brand and each signer's signature. */
export const CERT_IMG = { mark: 'cert:mark', wordmark: 'cert:wordmark', ink: (n: number) => `cert:ink:${n}` };
/** Natural sizes of the brand images, to keep their proportions. */
export interface CertImageSizes { mark?: { w: number; h: number }; wordmark?: { w: number; h: number }; ink?: ({ w: number; h: number } | undefined)[] }

/**
 * Lays the certificate out on pages of the given size. Returns the drawing of each page.
 * A dark band carries the product's logo (or its name) and the title; then the status, the document, the fingerprints,
 * one card per signer with the signature as drawn, the consent sentence, and what the page is.
 */
export function layoutCertificate(model: CertificateModel, m: Measure, size: PageSize, lang: Lang, look: { brand?: CertificateBrand; sizes?: CertImageSizes } = {}): PageView[] {
  const wrap = wrapper(m);
  const W = size.w, H = size.h, M = Math.min(46, W * 0.08), CW = W - M * 2;
  const band = look.brand?.band ?? BAND; const accent = look.brand?.accent ?? ACCENT;
  const pages: PageView[] = [];
  let ops: DrawOp[] = []; let y = 0;
  const text = (s: string, x: number, yy: number, f: FontId, sz: number, c: RGB) => { if (s) ops.push({ t: 'text', x, y: yy, s, f, size: sz, c }); };
  const right = (s: string, xr: number, yy: number, f: FontId, sz: number, c: RGB) => text(s, xr - m.width(s, f, sz), yy, f, sz, c);
  const rect = (x: number, yy: number, w: number, h: number, fill?: RGB, stroke?: RGB, sw = 0.8) => ops.push({ t: 'rect', x, y: yy, w, h, ...(fill ? { fill } : {}), ...(stroke ? { stroke, sw } : {}) });
  const rule = (yy: number, c: RGB, w = 0.7, x1 = M, x2 = W - M) => ops.push({ t: 'line', x1, y1: yy, x2, y2: yy, w, c });
  const spaced = (s: string) => s.toUpperCase().split('').join(' ').replace(/ {3}/g, '   ');
  const fit = (s: string, f: FontId, sz: number, max: number) => wrap(s, f, sz, max)[0] ?? '';

  const header = (first: boolean) => {
    const bh = first ? 92 : 46;
    rect(0, H - bh, W, bh, band);
    rect(0, H - bh - 2.2, W, 2.2, accent);
    const sz = look.sizes ?? {};
    const midY = H - bh / 2;
    let x = M;
    const markH = first ? 54 : 26;
    if (look.brand?.mark && sz.mark) { const w = (markH * sz.mark.w) / sz.mark.h; ops.push({ t: 'img', key: CERT_IMG.mark, x, y: midY - markH / 2, w, h: markH }); x += w + (first ? 10 : 6); }
    if (look.brand?.wordmark && sz.wordmark) {
      const wh = first ? 17 : 10; const ww = (wh * sz.wordmark.w) / sz.wordmark.h;
      ops.push({ t: 'img', key: CERT_IMG.wordmark, x, y: midY - wh / 2 + (first ? 7 : 0), w: ww, h: wh });
      if (first) text(spaced(model.product.replace(/^VYNTEX\s*/i, '') || model.product), x + 1, midY - 16, 'bold', 7, accent);
    } else if (!(look.brand?.mark && sz.mark)) {
      text(fit(model.product, 'bold', first ? 16 : 11, CW / 2), x, midY - (first ? 6 : 4), 'bold', first ? 16 : 11, WHITE);
    }
    const tsz = first ? 17 : 10.5;
    right(fit(model.title, 'bold', tsz, CW / 2), W - M, first ? midY + 2 : midY - 4, 'bold', tsz, WHITE);
    if (first) right(spaced(words(lang).kicker), W - M, midY - 14, 'regular', 7, accent);
    y = H - bh - 2.2 - (first ? 24 : 22);
  };
  const open = (first = false) => { ops = []; pages.push({ w: W, h: H, ops }); header(first); };
  const need = (h: number) => { if (y - h < 64) open(); };
  const section = (title: string) => {
    need(40);
    y -= 12; text(spaced(title), M, y, 'bold', 7.5, HEAD);
    rule(y + 2.5, LINE, 0.7, M + m.width(spaced(title), 'bold', 7.5) + 8);
    y -= 6;
  };
  const LH = 11; const GAP = 2.5;
  const rowH = (r: CertRow, width: number, labelW: number) => {
    const sz = r.mono ? Math.min(8.4, (width - labelW) / 37) : 8.8;
    return Math.max(wrap(r.value, 'regular', sz, width - labelW).length, wrap(r.label, 'bold', 7.8, labelW - 8).length) * LH + GAP;
  };
  /** Draws label and value rows from the current y at x; returns the height used. */
  const rowsAt = (list: CertRow[], x: number, width: number, labelW: number): number => {
    let used = 0;
    for (const r of list) {
      const sz = r.mono ? Math.min(8.4, (width - labelW) / 37) : 8.8;
      const lines = wrap(r.value, 'regular', sz, width - labelW);
      const label = wrap(r.label, 'bold', 7.8, labelW - 8);
      label.forEach((s, k) => text(s, x, y - used - LH * (k + 1) + 1, 'bold', 7.8, MUTED));
      lines.forEach((s, k) => text(s, x + labelW, y - used - LH * (k + 1) + 1, 'regular', sz, INK));
      used += rowH(r, width, labelW);
    }
    return used;
  };
  const measureRows = (list: CertRow[], width: number, labelW: number): number => list.reduce((a, r) => a + rowH(r, width, labelW), 0);
  const colW = (CW - 18) / 2;
  /** Rows in two columns, filled left then right, row by row. */
  const gridAt = (list: CertRow[], labelW: number): number => {
    let used = 0; const top = y;
    for (let k = 0; k < list.length; k += 2) {
      const pair = list.slice(k, k + 2);
      y = top - used; rowsAt([pair[0]], M, colW, labelW); if (pair[1]) rowsAt([pair[1]], M + colW + 18, colW, labelW);
      used += Math.max(...pair.map((r) => rowH(r, colW, labelW)));
    }
    y = top;
    return used;
  };
  const measureGrid = (list: CertRow[], labelW: number): number => { let h = 0; for (let k = 0; k < list.length; k += 2) h += Math.max(...list.slice(k, k + 2).map((r) => rowH(r, colW, labelW))); return h; };

  open(true);
  // status
  const done = model.status === words(lang).status;
  const pill = model.status.toUpperCase(); const pw = m.width(pill, 'bold', 8) + 18;
  rect(M, y - 14, pw, 18, done ? OK_SOFT : WAIT_SOFT, done ? OK : WAIT, 0.8);
  text(pill, M + 9, y - 8.5, 'bold', 8, done ? OK : WAIT);
  text(fit(model.statusLine, 'regular', 9.5, CW - pw - 12), M + pw + 10, y - 8.5, 'regular', 9.5, INK);
  y -= 26;
  if (model.sample) {
    const ls = wrap(model.sample, 'bold', 9, CW - 20);
    rect(M, y - ls.length * 12 - 10, CW, ls.length * 12 + 10, WAIT_SOFT, WAIT, 0.8);
    ls.forEach((s, k) => text(s, M + 10, y - 13 - 12 * k, 'bold', 9, WAIT));
    y -= ls.length * 12 + 16;
  }
  // the document
  section(model.parts.doc);
  const doc = model.rows.filter((r) => (r.part ?? (r.mono ? 'hash' : 'doc')) === 'doc');
  // the title of the document on its own line, the other facts in two columns
  const [docTitle, ...facts] = doc;
  if (docTitle) { need(measureRows([docTitle], CW, 92)); y -= rowsAt([docTitle], M, CW, 92); }
  need(measureGrid(facts, 92));
  y -= gridAt(facts, 92);
  // the fingerprints, in a quiet panel
  const hash = model.rows.filter((r) => (r.part ?? (r.mono ? 'hash' : 'doc')) === 'hash');
  if (hash.length) {
    y -= 6; section(model.parts.hash);
    const hh = measureRows(hash, CW - 20, 112) + 8;
    need(hh + 6);
    rect(M, y - hh, CW, hh, PANEL, LINE, 0.6);
    y -= 3; const used = rowsAt(hash, M + 10, CW - 20, 112); y -= used + 11;
  }
  // one card per signer: the record on the left, the signature as drawn on the right
  y -= 4; section(model.parts.signers);
  const sigW = Math.min(170, CW * 0.36); const leftW = CW - sigW - 30;
  model.signers.forEach((s, n) => {
    // the name is the card's heading, so the record starts after it
    const rows = s.rows.slice(1);
    const lw = Math.min(104, leftW * 0.36);
    const body = measureRows(rows, leftW, lw);
    const ch = Math.max(body + 30, 92);
    need(ch + 10);
    const top = y;
    rect(M, top - ch, CW, ch, WHITE, LINE, 0.8);
    rect(M, top - ch, 3, ch, s.signed ? accent : WAIT);
    text(fit(`${s.heading} · ${s.name}`, 'bold', 10.5, leftW), M + 14, top - 17, 'bold', 10.5, HEAD);
    y = top - 22;
    rowsAt(rows, M + 14, leftW, lw);
    // signature panel
    const px = M + CW - sigW - 12, py = top - ch + 12, ph = ch - 24;
    rect(px, py, sigW, ph, PANEL, LINE, 0.6);
    text(spaced(model.parts.signature), px + 8, py + ph - 12, 'bold', 6.5, MUTED);
    const dim = look.sizes?.ink?.[n];
    if (s.ink && dim) {
      const boxW = sigW - 16, boxH = ph - 34; const k = Math.min(boxW / dim.w, boxH / dim.h);
      ops.push({ t: 'img', key: CERT_IMG.ink(n), x: px + 8 + (boxW - dim.w * k) / 2, y: py + 16 + (boxH - dim.h * k) / 2, w: dim.w * k, h: dim.h * k });
    } else {
      const nm = fit(s.signed ? s.name : model.parts.noInk, s.signed ? 'italic' : 'regular', s.signed ? 14 : 8, sigW - 16);
      text(nm, px + 8, py + ph / 2 - 4, s.signed ? 'italic' : 'regular', s.signed ? 14 : 8, s.signed ? HEAD : MUTED);
    }
    rule(py + 13, LINE, 0.6, px + 8, px + sigW - 8);
    text(fit(s.name, 'regular', 7.5, sigW - 16), px + 8, py + 4, 'regular', 7.5, MUTED);
    y = top - ch - 10;
  });
  // the consent sentence the signers were shown
  const consent = model.rows.filter((r) => r.part === 'consent');
  if (consent.length) {
    y -= 2; section(model.parts.consent);
    const ls = wrap(consent[0].value, 'italic', 9, CW - 24);
    const h = ls.length * 12 + 12;
    need(h + 4);
    rect(M, y - h, CW, h, PANEL);
    rect(M, y - h, 3, h, accent);
    ls.forEach((s, k) => text(s, M + 14, y - 14 - 12 * k, 'italic', 9, INK));
    y -= h + 10;
  }
  // what this page is
  const note = wrap(model.note, 'regular', 7.5, CW);
  need(note.length * 10 + 16);
  y -= 4;
  for (const s of note) { y -= 10; text(s, M, y, 'regular', 7.5, MUTED); }
  const t = words(lang);
  pages.forEach((p, k) => {
    p.ops.push({ t: 'line', x1: M, y1: 44, x2: W - M, y2: 44, w: 0.6, c: LINE });
    const label = wrap(t.page(k + 1, pages.length), 'regular', 7.5, 150)[0] ?? '';
    const rec = [model.parts.record, look.brand?.site].filter(Boolean).join(' · ');
    p.ops.push({ t: 'text', x: M, y: 32, s: wrap(rec, 'bold', 7.5, CW - 160)[0] ?? '', f: 'bold', size: 7.5, c: HEAD });
    p.ops.push({ t: 'text', x: M, y: 22, s: wrap(model.footer, 'regular', 7, CW - 160)[0] ?? '', f: 'regular', size: 7, c: MUTED });
    p.ops.push({ t: 'text', x: W - M - m.width(label, 'regular', 7.5), y: 32, s: label, f: 'regular', size: 7.5, c: MUTED });
  });
  return pages;
}
