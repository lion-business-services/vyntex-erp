# The barbershop edition, end to end in a real browser: the shop floor (a walk-in from the desk, calling, seating and
# checking out with a tip; an appointment checked out at the chair; the kiosk; the waiting-area display; insights,
# history, chairs and settings), memberships (selling a gift card and a membership, recording a late payment, a gift card
# used at the desk) and barber pay (paying last week). Every step is checked in the saved workspace, not only on screen,
# with no console errors, in English and in Spanish, on a desktop and a phone.
# Usage: python3 tests/qa_barber.py   (PORT env selects the preview server; results in tests/.qa-barber.json)
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = 'http://localhost:' + os.environ.get('PORT', '4173')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
SHOTS = os.environ.get('SHOTS')
KEY_RE = re.compile(r'(?<![\w@./-])(floor|mem|pay|auto|act|common|nav)\.[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]')
results = []

def record(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + str(detail)[:300]))

async def state(pg):
    return await pg.evaluate("() => JSON.parse(localStorage.getItem('vyntex.demo.barber'))")

async def run(lang, w, h, browser):
    tag = f'[{lang} {w}]'
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, locale='en-US')
    pg = await ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' and 'ERR_' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:300]))
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await pg.route('**/fonts.googleapis.com/**', lambda r: r.abort()); await pg.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    await pg.goto(f'{BASE}/demo?industry=barber&lang={lang}')
    await pg.wait_for_selector('#main')
    await pg.evaluate("() => { const p = JSON.parse(localStorage.getItem('vyntex.prefs') || '{}'); p.tourSeen = true; p.viewAs = 'owner'; localStorage.setItem('vyntex.prefs', JSON.stringify(p)); localStorage.removeItem('vyntex.demo.barber'); }")
    async def go(path):
        await pg.goto(BASE + path); await pg.wait_for_selector('#main h1', timeout=15000); await pg.wait_for_timeout(300)
    async def confirm():
        btn = pg.locator('.modal [data-autofocus], .modal .btn.primary, .modal .btn.danger').last
        await btn.click(); await pg.wait_for_timeout(200)
    async def shot(name):
        if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, f'{name}-{lang}-{w}.png'))
    async def clean(label):
        text = await pg.evaluate('() => document.body.innerText')
        m = KEY_RE.search(text)
        record(f'{tag} {label}: no raw wording keys', not m, m and text[max(0, m.start()-30):m.end()+20])
        sw = await pg.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
        record(f'{tag} {label}: no sideways scroll', sw <= 1, sw)

    # ---- the floor
    await go('/demo/floor')
    await shot('floor')
    await clean('shop floor')
    s = await state(pg)
    n_line = len([x for x in s['walkins'] if x['status'] in ('waiting', 'called')])
    record(f'{tag} sample floor has a line, chairs and people in chairs', n_line >= 4 and len(s['chairs']) >= 5 and any(x['status'] == 'in_service' for x in s['walkins']), n_line)
    # add a walk-in at the desk
    await pg.click('[data-testid=floor-add]')
    await pg.fill('[data-testid=floor-add-name]', 'Quinn Sample')
    await pg.fill('[data-testid=floor-add-phone]', '609-555-0799')
    await pg.check('[data-testid=floor-add-text]')
    quote = await pg.inner_text('[data-testid=floor-add-quote]')
    record(f'{tag} the desk sees a wait estimate before adding', bool(re.search(r'\d', quote)), quote)
    await pg.click('[data-testid=floor-add-save]'); await pg.wait_for_timeout(300)
    s = await state(pg)
    q = next((x for x in s['walkins'] if x['name'] == 'Quinn Sample'), None)
    client = q and next((c for c in s['clients'] if c['id'] == q.get('clientId')), None)
    record(f'{tag} walk-in added with a ticket and a client record with text consent', q and q['status'] == 'waiting' and q['ticket'] > 1 and client and client.get('smsOptIn'), q)
    record(f'{tag} the line rule prepared a text with the place in line', any(m.get('clientId') == (q or {}).get('clientId') and m['status'] == 'draft' and '#' in m['body'] for m in s['messages']), '')
    # call the next guest to chair 3 (Derek is called already: seat him and finish)
    chair3 = pg.locator('[data-chair=ch3]')
    if await chair3.locator('[data-testid=floor-start]').count():
        await chair3.locator('[data-testid=floor-start]').click(); await pg.wait_for_timeout(250)
    s = await state(pg)
    seated = next((x for x in s['walkins'] if x.get('chairId') == 'ch3' and x['status'] == 'in_service'), None)
    record(f'{tag} called guest seated in chair 3, chair busy', seated and next(c for c in s['chairs'] if c['id'] == 'ch3')['status'] == 'busy', seated)
    await chair3.locator('[data-testid=floor-finish]').click()
    await pg.wait_for_selector('[data-testid=floor-checkout-save]')
    if await pg.locator('[data-testid=floor-checkout-method]').input_value() == 'pass':
        await pg.select_option('[data-testid=floor-checkout-method]', 'cash')
    await pg.fill('[data-testid=floor-checkout-tip]', '7')
    method = await pg.locator('[data-testid=floor-checkout-method]').input_value()
    await pg.click('[data-testid=floor-checkout-save]'); await pg.wait_for_timeout(300)
    s = await state(pg)
    done = next((x for x in s['walkins'] if x['id'] == seated['id']), {}) if seated else {}
    record(f'{tag} checkout records amount, tip and method; the chair opens again', done.get('status') == 'done' and done.get('tip') == 7 and done.get('amount', 0) > 0 and next(c for c in s['chairs'] if c['id'] == 'ch3')['status'] == 'open', done)
    if method == 'cash':
        record(f'{tag} cash went into the drawer', any(e['memo'].startswith('#' + str(done.get('ticket'))) for e in s['cash']), '')
    record(f'{tag} the walk-in review rule prepared a review request', any(r.get('clientId') == done.get('clientId') for r in s['reviews']) or not done.get('clientId'), '')
    # an appointment in chair 2: check out at the chair (pays through the protected operation, then completes)
    chair2 = pg.locator('[data-chair=ch2]')
    if await chair2.locator('[data-testid=floor-finish-appt]').count():
        await chair2.locator('[data-testid=floor-finish-appt]').click(); await pg.wait_for_selector('[data-testid=floor-checkout-save]')
        if await pg.locator('[data-testid=floor-checkout-method]').input_value() == 'pass':
            await pg.select_option('[data-testid=floor-checkout-method]', 'card')
        await pg.fill('[data-testid=floor-checkout-tip]', '11')
        await pg.click('[data-testid=floor-checkout-save]'); await pg.wait_for_timeout(500)
        s = await state(pg)
        a = next((x for x in s['appointments'] if x['clientId'] == 'bc7' and x['date'] == s['seededOn']), {})
        record(f'{tag} appointment checked out at the chair: paid, tipped, completed', a.get('status') == 'completed' and a.get('tip') == 11 and a.get('paid'), {k: a.get(k) for k in ('status', 'tip', 'paid')})
    # the kiosk
    await pg.click('[data-testid=floor-kiosk]'); await pg.wait_for_selector('[data-testid=floor-kiosk-screen]')
    await pg.fill('[data-testid=kiosk-name]', 'Robin Sample'); await pg.click('[data-testid=kiosk-next]')
    await pg.click('[data-testid=kiosk-sv-sv-cut]'); await shot('kiosk-who')
    await pg.click('[data-testid=kiosk-first]'); await pg.wait_for_selector('[data-testid=kiosk-done]')
    await shot('kiosk-done')
    s = await state(pg)
    k = next((x for x in s['walkins'] if x['name'] == 'Robin Sample'), None)
    record(f'{tag} kiosk check-in joins the line from the kiosk', k and k['source'] == 'kiosk' and k['status'] == 'waiting', k)
    await pg.click('[data-testid=floor-kiosk-exit]'); await confirm()
    # the waiting-area display: first name and an initial only
    await pg.click('[data-testid=floor-screen]'); await pg.wait_for_selector('[data-testid=floor-screen-view]')
    tv = await pg.inner_text('[data-testid=floor-screen-view]')
    await shot('tv')
    record(f'{tag} display shows "Robin S." and never a phone number', 'Robin S.' in tv and 'Robin Sample' not in tv and not re.search(r'\d{3}-555-\d{4}', tv), tv[:200])
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
    # insights: prepare a rebooking text
    await pg.click('text=' + ('Insights' if lang == 'en' else 'Análisis')); await pg.wait_for_selector('[data-testid=floor-heat]')
    await shot('insights'); await clean('insights')
    before = len((await state(pg))['messages'])
    if await pg.locator('[data-testid=floor-rebook]').count():
        await pg.locator('[data-testid=floor-rebook]').first.click(); await pg.wait_for_timeout(300)
        record(f'{tag} rebooking text prepared as a draft', len((await state(pg))['messages']) == before + 1, '')
    # history and setup
    await pg.click('text=' + ('Walk-in history' if lang == 'en' else 'Historial sin cita')); await pg.wait_for_selector('[data-testid=floor-history]')
    await clean('history')
    await pg.click('text=' + ('Chairs and settings' if lang == 'en' else 'Sillas y ajustes')); await pg.wait_for_selector('[data-testid=floor-chairs-table]')
    await pg.fill('[data-testid=floor-set-buffer]', '10'); await pg.click('[data-testid=floor-set-save]'); await pg.wait_for_timeout(200)
    record(f'{tag} queue settings saved', (await state(pg))['settings'].get('shop', {}).get('buffer') == 10, '')
    await clean('chairs and settings')

    # ---- memberships
    await go('/demo/memberships'); await shot('memberships'); await clean('memberships')
    await pg.click('[data-testid=mem-sell]'); await pg.click('[data-testid=mem-sell-gift_card]')
    await pg.fill('[data-testid=mem-sell-holder]', 'Gift for a friend'); await pg.fill('[data-testid=mem-sell-amount]', '40')
    await pg.click('[data-testid=mem-sell-save]'); await pg.wait_for_timeout(300)
    s = await state(pg)
    g = next((p for p in s['passes'] if p.get('holder') == 'Gift for a friend'), None)
    record(f'{tag} gift card sold with a code and its balance', g and g['balance'] == 40 and re.match(r'^[A-Z0-9]{4}-[A-Z0-9]{4}$', g.get('code', '')), g)
    await pg.click('[data-testid=mem-sell]'); await pg.click('[data-testid=mem-sell-membership]')
    await pg.select_option('[data-testid=mem-sell-client]', 'bc4'); await pg.click('[data-testid=mem-sell-save]'); await pg.wait_for_timeout(300)
    s = await state(pg)
    m = next((p for p in s['passes'] if p.get('clientId') == 'bc4' and p['kind'] == 'membership'), None)
    record(f'{tag} membership sold with its first month and next payment date', m and m['status'] == 'active' and m.get('renews'), m)
    if await pg.locator('[data-testid=mem-renew]').count():
        await pg.locator('[data-testid=mem-renew]').first.click(); await pg.wait_for_timeout(300)
        s = await state(pg)
        record(f'{tag} late membership payment recorded: active again', not any(p['status'] == 'past_due' for p in s['passes']), '')
    for tab in (['Packages', 'Gift cards', 'Loyalty points', 'Plans'] if lang == 'en' else ['Paquetes', 'Tarjetas de regalo', 'Puntos de lealtad', 'Planes']):
        await pg.click(f'.tabs >> text={tab}'); await pg.wait_for_timeout(200); await clean('memberships ' + tab)
    # ---- barber pay
    await go('/demo/barber-pay'); await shot('pay'); await clean('barber pay')
    if await pg.locator('[data-testid=pay-pay]').count():
        await pg.locator('[data-testid=pay-pay]').first.click(); await pg.wait_for_selector('[data-testid=pay-statement]')
        await shot('statement')
        await pg.click('[data-testid=pay-confirm]'); await pg.wait_for_timeout(300)
        s = await state(pg)
        record(f'{tag} a barber paid for last week, figures frozen', len(s['payouts']) >= 3, len(s['payouts']))
    # ---- the home screen, the rule builder on a shop rule, the client page of a member
    for path in ['/demo', '/demo/automations/rule/b-walkin-joined', '/demo/automations/rule/b-rebook', '/demo/automations/rule/b-pass-low', '/demo/clients/bc1', '/demo/appointments']:
        await go(path); await clean(path)
    record(f'{tag} no console errors', not errs, errs[:3])
    await ctx.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        for lang, w, h in [('en', 1440, 900), ('es', 1440, 900), ('en', 390, 844), ('es', 390, 844)]:
            await run(lang, w, h, b)
        await b.close()
    bad = [r for r in results if not r['ok']]
    json.dump({'checks': len(results), 'failed': bad}, open(os.path.join(ROOT, '.qa-barber.json'), 'w'), indent=1)
    print(f'\n{len(results)} checks, {len(bad)} failed')
    sys.exit(1 if bad else 0)

asyncio.run(main())
