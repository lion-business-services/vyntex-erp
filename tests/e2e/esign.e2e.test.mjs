// Sending a document for signature from a live company workspace, end to end in a real browser, against the local
// stand-ins (tests/e2e/stack.mjs: a local PostgreSQL with every migration, the Supabase test double, scripts/serve.mjs
// with the production headers, system email written to a file):
//   the owner uploads a PDF in Documents, its pages are drawn on screen, a signature request is prepared with a
//   signature, a date and a checkbox, and sent; the email reaches the signer; the signer opens the link, sees the pages,
//   agrees, signs and finishes; the request is completed and the signed copy (with its certificate) is stored.
//
//   node --test --test-concurrency=1 tests/e2e/esign.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { startStack } from './stack.mjs';
import { launch, person, typeCode, shot } from './helpers.mjs';

const PW = 'Lantern-orchard-river-58';
let st; let browser; let owner; let co; let pdfPath; let clientEmail;
const open = [];
const one = (dep, text, data) => dep.sql(`select '@@R@@' || coalesce(to_jsonb((${text}))::text, 'null');`, data);

/** A two-page sample PDF, made here: nothing in it is a real offer. */
async function samplePdf() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const [n, line] of [[1, 'Sample proposal, page one'], [2, 'Sample proposal, page two: sign here']]) {
    const p = d.addPage([612, 792]);
    p.drawText(line, { x: 60, y: 700, size: 22, font: f });
    p.drawText(`Page ${n}`, { x: 60, y: 60, size: 10, font: f });
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vx-esign-')), 'Sample-Proposal.pdf');
  fs.writeFileSync(file, await d.save());
  return file;
}

before(async () => {
  st = await startStack({ mail: true });
  browser = await launch();
  pdfPath = await samplePdf();
  // the production setting of VYNTEX ERP (supabase/setup/go-live.sql): owners and managers use an authenticator
  await st.vyntex.sql(`update app.server_settings set value = '{"mfaRoles": ["owner", "manager"]}'::jsonb where key = 'security.required'; select '@@R@@' || '1';`);
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

test('the owner signs in, the company has an approved consent sentence and a client with an email', async () => {
  co = await st.vyntex.company({ industry: 'practice', name: 'Sample Signing Company', slug: 'sample-signing-co' });
  owner = await person(browser, st.vyntex.origin); open.push(owner);
  await owner.go(co.inviteLink.replace(st.vyntex.origin, ''));
  await owner.page.waitForSelector('[data-testid=auth-invite-form]');
  await owner.page.fill('[data-testid=auth-invite-name]', 'Robin Sample');
  await owner.page.fill('[data-testid=auth-invite-password]', PW); await owner.page.fill('[data-testid=auth-invite-again]', PW);
  await owner.page.click('[data-testid=auth-submit]');
  await owner.page.waitForSelector('[data-testid=auth-enroll]');
  const secret = await owner.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  await typeCode(owner, st.vyntex.totp(secret));
  await owner.page.waitForSelector('[data-testid=auth-codes]');
  await owner.page.check('[data-testid=auth-codes-kept]');
  await owner.page.click('[data-testid=auth-codes-continue]');
  await owner.workspace();
  clientEmail = 'signer@example.com';
  await st.vyntex.sql(String.raw`
    with t as (insert into public.doc_templates (tenant_id, kind, name, lang, source, approved, extra) values ((select v from _in where k = 't')::uuid, 'custom', 'Consent', 'en', 'company', true, '{"use":"consent"}') returning id, tenant_id),
    b as (insert into public.doc_template_blocks (tenant_id, template_id, type, text, position) select tenant_id, id, 'p', 'I agree to sign this sample document electronically.', 0 from t returning 1),
    c as (insert into public.clients (tenant_id, name, company, kind, email, lifecycle, lang) values ((select v from _in where k = 't')::uuid, 'Sam Signer', 'Sample Client LLC', 'business', (select v from _in where k = 'e'), 'active', 'en') returning 1)
    select '@@R@@' || jsonb_build_object('b', (select count(*) from b), 'c', (select count(*) from c))::text;`, { t: co.tenantId, e: clientEmail });
  await owner.page.reload(); await owner.workspace();
  assert.deepEqual(owner.errors, []);
});

let envelopeId;
test('Documents: Upload file stores the PDF, and its pages are drawn on screen', async () => {
  await owner.go(`/${co.slug}/documents`);
  await owner.page.click('[data-testid=docs-upload]');
  assert.equal(await owner.page.inputValue('[data-testid=docs-nd-kind]'), 'upload');
  const opt = await owner.page.$$eval('[data-testid=docs-nd-client] option', (os) => os.map((o) => [o.value, o.textContent]));
  await owner.page.selectOption('[data-testid=docs-nd-client]', opt.find((o) => /Sam Signer/.test(o[1]))[0]);
  await owner.page.setInputFiles('[data-testid=docs-nd-file]', pdfPath);
  await owner.synced(() => owner.page.click('[data-testid=docs-nd-create]'));
  await owner.page.waitForSelector('[data-testid=docs-file-pages]');
  await owner.page.waitForFunction(() => [...document.querySelectorAll('.es-pdfpage')].filter((c) => c.dataset.state === 'ok').length === 2, null, { timeout: 20000 });
  await shot(owner, 'esign-live-document');
  assert.deepEqual(owner.errors, []);
});

test('a signature request is prepared on the drawn pages and sent: the signer gets the email', async () => {
  await owner.go(`/${co.slug}/esign`);
  await owner.page.click('[data-testid=esign-new]');
  await owner.page.click('[data-testid=esign-pick-go]');
  await owner.page.waitForSelector('[data-testid=esign-editor]');
  envelopeId = owner.page.url().split('/').pop();
  await owner.page.waitForFunction(() => [...document.querySelectorAll('.es-pdfpage')].filter((c) => c.dataset.state === 'ok').length === 2, null, { timeout: 20000 });
  // the client of the document is the first signer
  assert.equal(await owner.page.inputValue('[data-testid=esign-signer-email] >> nth=0'), clientEmail);
  await owner.page.fill('[data-testid=esign-message]', 'Here is the sample proposal. Thank you.');
  await owner.page.selectOption('[data-testid=esign-tool-page]', '1');
  for (const tool of ['signature', 'date', 'checkbox']) await owner.page.click(`[data-testid=esign-tool-${tool}]`);
  await owner.page.waitForSelector('[data-testid=esign-ready]');
  await shot(owner, 'esign-live-prepare');
  const before = st.vyntex.mails().length;
  await owner.page.click('[data-testid=esign-send]');
  await owner.page.waitForFunction(() => /sent/i.test(document.body.innerText) && !document.querySelector('[data-testid=esign-send]'), null, { timeout: 30000 }).catch(() => undefined);
  const row = await one(st.vyntex, `(select jsonb_build_object('status', e.status, 'fields', (select count(*) from public.envelope_fields f where f.envelope_id = e.id)) from public.envelopes e where e.id = (select v from _in where k = 'id')::uuid)`, { id: envelopeId });
  assert.equal(row.status, 'sent', 'the request is recorded as sent');
  assert.equal(row.fields, 3);
  const mail = st.vyntex.mails().slice(before).find((m) => JSON.stringify(m.to).includes(clientEmail));
  assert.ok(mail, 'the signer was emailed');
  assert.match(mail.text, /Here is the sample proposal/);
  assert.deepEqual(owner.errors, []);
});

test('the signer opens the link, sees the pages, agrees, fills the three boxes and finishes; the signed copy is stored', async () => {
  const mail = st.vyntex.mails().find((m) => JSON.stringify(m.to).includes(clientEmail));
  const link = /(https?:\/\/\S+\/sign\/\S+)/.exec(mail.text)?.[1];
  assert.ok(link, 'the email carries the signing link');
  const signer = await person(browser, st.vyntex.origin); open.push(signer);
  await signer.page.goto(link.replace(/^https?:\/\/[^/]+/, st.vyntex.origin));
  await signer.page.waitForSelector('[data-testid=esign-sign]');
  await signer.page.check('[data-testid=esign-sign-consent]');
  await signer.page.click('[data-testid=esign-sign-continue]');
  // the pages of the uploaded PDF are drawn under the boxes, here too
  await signer.page.waitForFunction(() => [...document.querySelectorAll('.es-pdfpage')].some((c) => c.dataset.state === 'ok'), null, { timeout: 20000 });
  await shot(signer, 'esign-live-signer');
  await signer.page.fill('[data-testid=esign-sign-name]', 'Sam Signer');
  await signer.page.click('[data-testid=esign-sign-signature]');
  await signer.page.click('[data-testid=esign-pad-typed]');
  await signer.page.click('[data-testid=esign-pad-done]');
  await signer.page.check('[data-testid=esign-sign-check]');
  await signer.page.click('[data-testid=esign-sign-review]');
  await signer.page.click('[data-testid=esign-sign-finish]');
  await signer.page.waitForFunction(() => /signed|thank/i.test(document.querySelector('[data-testid=esign-sign-state]')?.textContent || ''), null, { timeout: 30000 });
  let row;
  for (let i = 0; i < 40; i++) {
    row = await one(st.vyntex, `(select jsonb_build_object('status', e.status, 'signed', e.signed_file is not null) from public.envelopes e where e.id = (select v from _in where k = 'id')::uuid)`, { id: envelopeId });
    if (row.signed) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.deepEqual(row, { status: 'completed', signed: true });
  assert.deepEqual(signer.errors, []);
});
