// A barbershop client's first day in a live workspace, end to end in a real browser, against the local stand-ins
// (tests/e2e/stack.mjs: a local PostgreSQL with every migration, the Supabase test double and scripts/serve.mjs):
//   the owner of a new barbershop accepts the invitation and adds the authenticator; the shop floor starts empty;
//   the owner adds a chair for themself; a barber is invited; the front desk puts a walk-in in line; the line survives
//   a reload because it is in the database; a barber cannot change their chair's pay even with a crafted request.
//
//   node --test --test-concurrency=1 tests/e2e/barber.e2e.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startStack } from './stack.mjs';
import { launch, person, typeCode, shot } from './helpers.mjs';

const PW = 'Copper-lantern-river-61';
let st; let browser; let owner; let shop;
const open = [];
const one = (dep, text, data) => dep.sql(`select '@@R@@' || coalesce(to_jsonb((${text}))::text, 'null');`, data);

before(async () => {
  st = await startStack();
  browser = await launch();
  // the production setting of VYNTEX ERP (supabase/setup/go-live.sql): owners and managers of every company use an authenticator
  await st.vyntex.sql(`update app.server_settings set value = '{"mfaRoles": ["owner", "manager"]}'::jsonb where key = 'security.required'; select '@@R@@' || '1';`);
});
after(async () => {
  for (const p of open) await p.close().catch(() => undefined);
  await browser?.close();
  await st?.stop();
});

test('a new barbershop: the owner accepts, adds the authenticator and lands on an empty shop floor', async () => {
  shop = await st.vyntex.company({ industry: 'barber', name: 'Sample Fade Lounge', slug: 'sample-fade-lounge' });
  owner = await person(browser, st.vyntex.origin); open.push(owner);
  await owner.go(shop.inviteLink.replace(st.vyntex.origin, ''));
  await owner.page.waitForSelector('[data-testid=auth-invite-form]');
  await owner.page.fill('[data-testid=auth-invite-name]', 'Sam Sample');
  await owner.page.fill('[data-testid=auth-invite-password]', PW); await owner.page.fill('[data-testid=auth-invite-again]', PW);
  await owner.page.click('[data-testid=auth-submit]');
  await owner.page.waitForSelector('[data-testid=auth-enroll]');
  const secret = await owner.page.getAttribute('[data-testid=auth-secret]', 'data-secret');
  await typeCode(owner, st.vyntex.totp(secret));
  await owner.page.waitForSelector('[data-testid=auth-codes]');
  await owner.page.check('[data-testid=auth-codes-kept]');
  await owner.page.click('[data-testid=auth-codes-continue]');
  await owner.workspace();
  assert.match(await owner.page.innerText('.side-brand'), /VYNTEX BARBER/);
  await owner.go('/' + shop.slug + '/floor');
  await owner.page.waitForSelector('text=No chairs set up yet');
  assert.deepEqual(owner.errors, []);
});

test('the owner adds a chair; the front desk puts a walk-in in line; both are in the database and survive a reload', async () => {
  const p = owner.page;
  await p.click('[data-testid=floor-empty-add]');
  await p.waitForSelector('[data-testid=floor-chairs-table]');
  await p.click('[data-testid=floor-chair-new]');
  const me = await one(st.vyntex, `(select id from public.tenant_members where tenant_id = (select v from _in where k = 't')::uuid and role = 'owner')`, { t: shop.tenantId });
  await p.selectOption('#cf-b', String(me));
  await owner.synced(() => p.click('[data-testid=floor-chair-save]'));
  const chairs = await one(st.vyntex, `(select jsonb_agg(jsonb_build_object('label', label, 'member', member_id, 'split', split)) from public.chairs where tenant_id = (select v from _in where k = 't')::uuid)`, { t: shop.tenantId });
  assert.equal(chairs.length, 1); assert.equal(chairs[0].member, me);
  // open the chair so it takes walk-ins
  await owner.go('/' + shop.slug + '/floor'); await p.waitForSelector('[data-testid=floor-chairs]');
  await p.click('[data-testid=floor-chair-menu]');
  await owner.synced(() => p.click('.menu [role=menuitem] >> nth=0'));
  await p.click('[data-testid=floor-add]');
  await p.fill('[data-testid=floor-add-name]', 'Walk Sample');
  await p.fill('[data-testid=floor-add-phone]', '609-555-0177');
  await p.check('[data-testid=floor-add-text]');
  await owner.synced(() => p.click('[data-testid=floor-add-save]'));
  await shot(owner, 'barber-live-floor');
  const rows = await one(st.vyntex, `(select jsonb_agg(jsonb_build_object('name', w.name, 'status', w.status, 'ticket', w.ticket, 'by', w.by_member_id, 'client', c.name, 'sms', c.sms_opt_in)) from public.walkins w left join public.clients c on c.id = w.client_id where w.tenant_id = (select v from _in where k = 't')::uuid)`, { t: shop.tenantId });
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], by: !!rows[0].by }, { name: 'Walk Sample', status: 'waiting', ticket: 1, by: true, client: 'Walk Sample', sms: true });
  await p.reload(); await owner.workspace();
  await p.waitForSelector('[data-testid=floor-line] [data-status=waiting]');
  assert.match(await p.innerText('[data-testid=floor-line]'), /Walk Sample/);
  const refused = owner.applies.flatMap((a) => a.refused ?? a.rejected ?? []);
  assert.deepEqual(refused, [], 'nothing the page sent was refused');
  assert.deepEqual(owner.errors, []);
});

test('the database refuses a crafted change of a chair\'s pay from someone who does not change configuration', async () => {
  const chair = await one(st.vyntex, `(select id from public.chairs where tenant_id = (select v from _in where k = 't')::uuid limit 1)`, { t: shop.tenantId });
  // a staff member of the shop, straight against the database as that person would be through the gateway
  const r = await st.vyntex.sql(String.raw`
    do $$ declare uid uuid; begin
      insert into auth.users (email) values ('barber-e2e@example.com') returning id into uid;
      insert into public.tenant_members (tenant_id, user_id, role, name, email) values ((select v from _in where k = 't')::uuid, uid, 'staff', 'Barber Sample', 'barber-e2e@example.com');
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid, 'aal', 'aal2')::text, true);
      set local role authenticated;
      begin
        update public.chairs set split = 100 where id = (select v from _in where k = 'c')::uuid;
        raise exception 'NOT REFUSED';
      exception when insufficient_privilege then null;
      end;
    end $$;
    select '@@R@@' || '"refused"';`, { t: shop.tenantId, c: chair });
  assert.equal(r, 'refused');
});
