// Equipment & supplies: what the team works with. Parts and supplies in the warehouse and on each truck (with the
// minimum each should carry), and the tools and test instruments with who has them and when they are due for
// calibration or service. One click restocks every truck from the warehouse and puts what is short on one order.
import { useState } from 'react';
import type { PageProps } from '@/app/modules';
import { addDays } from '@/lib/dates';
import { money } from '@/lib/money';
import { Badge, Button, Card, Seg, Stat, Tabs, cx, toast } from '@/ui';
import { Head, daysTo, useTrade } from './common';
import type { StockItem, Tool } from './store';

type Tab = 'stock' | 'tools';

export default function SuppliesPage(_: PageProps) {
  const { s, set, tx, data, pack, date, taskAll, isDone, markDone, can } = useTrade();
  const [tab, setTab] = useState<Tab>('stock');
  const [where, setWhere] = useState<string>('all');
  const plumbing = pack.id === 'plumbing';
  const people = data.workers.filter((w) => w.active !== false && w.payType === 'hourly');
  const placeName = (id: string) => (id === 'shop' ? tx('Warehouse', 'Almacén') : tx(`${data.workers.find((w) => w.id === id)?.name.split(' ')[0] ?? ''}'s truck`, `Camión de ${data.workers.find((w) => w.id === id)?.name.split(' ')[0] ?? ''}`));
  const low = (x: StockItem) => x.qty < x.min;
  const lows = s.stock.filter(low);
  const value = s.stock.reduce((n, x) => n + x.qty * x.cost, 0);
  const dueOf = (t: Tool) => Math.min(daysTo(t.calibrationDue) ?? 9999, daysTo(t.serviceDue) ?? 9999);
  const toolsDue = s.tools.filter((t) => dueOf(t) <= 14 || t.status === 'service');
  const shopOf = (x: StockItem) => s.stock.find((y) => y.where === 'shop' && y.name === x.name);

  /** Fills every truck up to its minimum from the warehouse, then puts everything still short on one purchase order. */
  const restockAll = () => {
    let moved = 0;
    const next = s.stock.map((x) => ({ ...x }));
    for (const x of next.filter((y) => y.where !== 'shop' && y.qty < y.min)) {
      const shop = next.find((y) => y.where === 'shop' && y.name === x.name); if (!shop) continue;
      const take = Math.min(x.min - x.qty, Math.max(0, shop.qty)); if (take <= 0) continue;
      x.qty += take; shop.qty -= take; moved += take;
    }
    const order = next.filter((y) => y.where === 'shop' ? y.qty < y.min : y.qty < y.min && !next.some((z) => z.where === 'shop' && z.name === y.name));
    const lines = order.map((y) => ({ y, need: Math.max(y.min * (y.where === 'shop' ? 2 : 1) - y.qty, 1) }));
    const total = lines.reduce((n, l) => n + l.need * l.y.cost, 0);
    set((st) => ({ ...st, stock: next }));
    if (lines.length && !isDone('po:' + lines.map((l) => l.y.id).join(','))) {
      taskAll([lines], () => 'po:' + lines.map((l) => l.y.id).join(','), () => [tx(`Purchase order to ${lines[0].y.vendor}: ` + lines.map((l) => `${l.need} ${l.y.unit} ${l.y.name}`).join('; ') + ` (about ${money(total)})`, `Orden de compra a ${lines[0].y.vendor}: ` + lines.map((l) => `${l.need} ${l.y.unit} ${l.y.name}`).join('; ') + ` (unos ${money(total)})`), { type: 'parts', due: 1, pri: 'high' }], () => '');
    }
    if (lines.length) markDone(...lines.map((l) => 'po1:' + l.y.id));
    toast(tx(`${moved} items moved to the trucks. ${lines.length} to reorder${lines.length ? `, about ${money(total)}, on one purchase order in Tasks` : ''}.`, `${moved} artículos pasados a los camiones. ${lines.length} por pedir${lines.length ? `, unos ${money(total)}, en una orden de compra en Tareas` : ''}.`));
  };
  const calibrateAll = () => taskAll(toolsDue, (t) => 'cal:' + t.id, (t) => [tx(`${t.status === 'service' ? 'Service' : t.calibrationDue ? 'Calibrate' : 'Service'} the ${t.name.toLowerCase()} (${t.serial}), held by ${placeName(t.holder).toLowerCase()}`, `${t.status === 'service' ? 'Dar servicio a' : t.calibrationDue ? 'Calibrar' : 'Dar servicio a'} ${t.name.toLowerCase()} (${t.serial}), lo tiene ${placeName(t.holder).toLowerCase()}`), { type: 'parts', due: 2, pri: dueOf(t) < 0 ? 'high' : 'medium' }],
    (n) => (n === 1 ? tx('1 calibration or service booked', '1 calibración o servicio agendado') : tx(`${n} calibrations or services booked`, `${n} calibraciones o servicios agendados`)));
  const patchTool = (id: string, p: Partial<Tool>) => set((st) => ({ ...st, tools: st.tools.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const fromShop = (x: StockItem) => {
    const shop = shopOf(x); if (!shop || shop.qty <= 0) return;
    const take = Math.min(x.min - x.qty, shop.qty);
    set((st) => ({ ...st, stock: st.stock.map((y) => (y.id === x.id ? { ...y, qty: y.qty + take } : y.id === shop.id ? { ...y, qty: y.qty - take } : y)) }));
    toast(tx(`${take} moved from the warehouse to ${placeName(x.where).toLowerCase()}`, `${take} pasados del almacén al ${placeName(x.where).toLowerCase()}`));
  };
  const reorder = (x: StockItem) => taskAll([x], (y) => 'po1:' + y.id, (y) => [tx(`Order ${Math.max(y.min * 2 - y.qty, 1)} ${y.unit} ${y.name} from ${y.vendor} (about ${money(Math.max(y.min * 2 - y.qty, 1) * y.cost)})`, `Pedir ${Math.max(y.min * 2 - y.qty, 1)} ${y.unit} ${y.name} a ${y.vendor} (unos ${money(Math.max(y.min * 2 - y.qty, 1) * y.cost)})`), { type: 'parts', due: 1 }], () => tx('Order added to Tasks', 'Pedido agregado a Tareas'));
  const places = ['shop', ...people.map((w) => w.id).filter((id) => s.stock.some((x) => x.where === id))];
  const list = s.stock.filter((x) => where === 'all' || (where === 'low' ? low(x) : x.where === where));

  const tabs = <Tabs value={tab} onChange={setTab} tabs={[{ id: 'stock', label: tx('Parts & supplies', 'Piezas y materiales'), count: lows.length }, { id: 'tools', label: tx('Tools & instruments', 'Herramientas e instrumentos'), count: toolsDue.length }]} />;
  return (
    <div className="trade">
      {tab === 'stock'
        ? <Head title={tx('Equipment & supplies', 'Equipo y materiales')} sub={tx('Warehouse and truck stock. One click restocks every truck and orders what is short.', 'Inventario del almacén y de los camiones. Un clic surte cada camión y pide lo que falta.')} tabs={tabs}
            auto={restockAll} autoLabel={tx('Restock all trucks', 'Surtir todos los camiones')} autoCount={lows.filter((x) => !isDone('po1:' + x.id)).length} />
        : <Head title={tx('Equipment & supplies', 'Equipo y materiales')} sub={tx(`Who has each tool and when it is due for calibration or service.`, 'Quién tiene cada herramienta y cuándo toca calibrarla o darle servicio.')} tabs={tabs}
            auto={calibrateAll} autoLabel={tx('Book all calibrations', 'Agendar calibraciones')} autoCount={toolsDue.filter((t) => !isDone('cal:' + t.id)).length} />}
      <div className="kpis">
        <Stat label={tx('Stock value', 'Valor del inventario')} value={money(value)} hint={tx(`${s.stock.length} items in ${places.length} places`, `${s.stock.length} artículos en ${places.length} lugares`)} onClick={() => { setTab('stock'); setWhere('all'); }} />
        <Stat label={tx('Below minimum', 'Debajo del mínimo')} value={String(lows.length)} hint={lows.some((x) => isDone('po1:' + x.id)) ? tx(`${lows.filter((x) => isDone('po1:' + x.id)).length} already on order`, `${lows.filter((x) => isDone('po1:' + x.id)).length} ya pedidos`) : tx('Restock or reorder', 'Surtir o pedir')} attention={lows.some((x) => !isDone('po1:' + x.id))} onClick={() => { setTab('stock'); setWhere('low'); }} testId="sup-kpi-low" />
        <Stat label={tx('Trucks to restock', 'Camiones por surtir')} value={String(new Set(lows.filter((x) => x.where !== 'shop' && !isDone('po1:' + x.id)).map((x) => x.where)).size)} hint={tx('Before tomorrow\'s first call', 'Antes de la primera llamada de mañana')} attention={lows.some((x) => x.where !== 'shop' && !isDone('po1:' + x.id))} />
        <Stat label={tx('Tools due', 'Herramientas pendientes')} value={String(toolsDue.length)} hint={plumbing ? tx('The backflow gauge must be calibrated to file reports', 'El manómetro de reflujo debe estar calibrado para entregar reportes') : tx('Calibrated instruments, accurate readings', 'Instrumentos calibrados, lecturas exactas')} attention={toolsDue.length > 0} onClick={() => setTab('tools')} />
      </div>
      {tab === 'stock' ? <>
        <div className="filters row">
          <Seg value={where} onChange={setWhere} label={tx('Show', 'Mostrar')} options={[{ value: 'all', label: tx('All', 'Todo') }, { value: 'low', label: tx('Below minimum', 'Debajo del mínimo'), count: lows.length }, ...places.map((p) => ({ value: p, label: placeName(p) }))]} />
        </div>
        <Card flush>
          <div className="table-wrap"><table className="tbl stackable" data-testid="sup-stock">
            <thead><tr><th>{tx('Item', 'Artículo')}</th><th>{tx('Where', 'Dónde')}</th><th>{tx('On hand', 'Hay')}</th><th className="num">{tx('Value', 'Valor')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
            <tbody>{list.map((x) => { const pct = Math.min(100, Math.round((x.qty / Math.max(1, x.min)) * 100)); const shop = shopOf(x); return (
              <tr key={x.id} className={cx(low(x) && 'td-low')}>
                <td className="t1"><b>{x.name}</b><div className="xs dim">{x.vendor} · {money(x.cost)} / {x.unit}</div></td>
                <td data-label={tx('Where', 'Dónde')}>{placeName(x.where)}</td>
                <td data-label={tx('On hand', 'Hay')}><div className="row tight"><span className={cx('td-bar', low(x) && 'bad')}><i style={{ width: pct + '%' }} /></span><span className={cx(low(x) && 'neg')}>{x.qty} / {x.min} {x.unit}</span></div></td>
                <td className="num" data-label={tx('Value', 'Valor')}>{money(x.qty * x.cost)}</td>
                <td className="num">{!low(x) ? <span className="xs dim">{tx('OK', 'Bien')}</span>
                  : x.where !== 'shop' && shop && shop.qty > 0 ? <Button size="sm" variant="primary" disabled={!can('write')} onClick={() => fromShop(x)}>{tx('Restock from warehouse', 'Surtir del almacén')}</Button>
                  : isDone('po1:' + x.id) ? <Badge tone="info">{tx('Ordered', 'Pedido')}</Badge>
                  : <Button size="sm" disabled={!can('write')} onClick={() => reorder(x)}>{tx('Reorder', 'Pedir')}</Button>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        </Card>
      </> : (
        <Card flush>
          <div className="table-wrap"><table className="tbl stackable" data-testid="sup-tools">
            <thead><tr><th>{tx('Tool', 'Herramienta')}</th><th>{tx('Who has it', 'Quién la tiene')}</th><th>{tx('Calibration / service', 'Calibración / servicio')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
            <tbody>{s.tools.map((t) => { const n = dueOf(t); const when = t.calibrationDue ?? t.serviceDue; return (
              <tr key={t.id}>
                <td className="t1"><b>{t.name}</b><div className="xs dim mono">{t.serial}</div></td>
                <td data-label={tx('Who has it', 'Quién la tiene')}>
                  <select aria-label={tx('Who has it', 'Quién la tiene')} value={t.holder} disabled={!can('write')} onChange={(e) => { patchTool(t.id, { holder: e.target.value }); toast(tx(`${t.name} checked out to ${placeName(e.target.value).toLowerCase()}`, `${t.name} asignada a ${placeName(e.target.value).toLowerCase()}`)); }}>
                    <option value="shop">{tx('Warehouse', 'Almacén')}</option>{people.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select></td>
                <td data-label={tx('Calibration / service', 'Calibración / servicio')}>{t.status === 'service' ? <Badge tone="bad">{tx('Needs service', 'Necesita servicio')}</Badge> : when ? <span className={cx(n < 0 && 'neg', n >= 0 && n <= 14 && 'warn-t')}>{t.calibrationDue ? tx('Calibrate by ', 'Calibrar antes del ') : tx('Service by ', 'Servicio antes del ')}{date(when)}</span> : <span className="dim">{tx('Nothing due', 'Nada pendiente')}</span>}</td>
                <td className="num">{t.status === 'service' ? <Button size="sm" variant="primary" onClick={() => { patchTool(t.id, { status: 'ok', serviceDue: addDays(180) }); markDone('cal:' + t.id); toast(tx('Back in service', 'De vuelta en servicio')); }}>{tx('Back in service', 'De vuelta en servicio')}</Button>
                  : isDone('cal:' + t.id) ? <Badge tone="info">{tx('Booked', 'Agendada')}</Badge>
                  : n <= 14 ? <Button size="sm" onClick={() => taskAll([t], (x) => 'cal:' + x.id, (x) => [tx(`Calibrate the ${x.name.toLowerCase()} (${x.serial})`, `Calibrar ${x.name.toLowerCase()} (${x.serial})`), { type: 'parts', due: 2 }], () => tx('Calibration added to Tasks', 'Calibración agregada a Tareas'))}>{tx('Book calibration', 'Agendar calibración')}</Button>
                  : <span className="xs dim">{tx('All set', 'Al día')}</span>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
