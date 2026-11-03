// Equipment & warranties: every unit at every client with its model, serial, age, warranty dates and service dates.
// Old or failing units become replacement opportunities in Leads in one click; tune-ups and warranty work become tasks.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { LuPlus, LuSearch } from 'react-icons/lu';
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { Badge, Button, Card, FormModal, SearchBox, Seg, Stat, cx, toast } from '@/ui';
import { addDays } from '@/lib/dates';
import { money } from '@/lib/money';
import { Head, ageYears, daysTo, useTrade } from './common';
import type { Equipment } from './store';

type View = 'all' | 'replace' | 'warranty' | 'service';

export default function EquipmentPage({ tabs }: PageProps & { tabs?: ReactNode }) {
  const { s, set, tx, client, date, data, pack, lead, can, isDone, taskAll } = useTrade();
  const plumbing = pack.id === 'plumbing';
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const replaceType = plumbing ? 'water_heater' : 'install';
  const replacePrice = data.catalog.find((x) => x.category === replaceType)?.tiers[0]?.price ?? 0;
  const isOld = (e: Equipment) => e.status === 'replace' || ageYears(e.installed) >= (plumbing ? 10 : 12);
  const warrantySoon = (e: Equipment) => { const n = daysTo(e.partsWarranty); return n !== undefined && n >= 0 && n <= 365; };
  const serviceSoon = (e: Equipment) => { const n = daysTo(e.nextService); return n !== undefined && n <= 30; };
  const text = q.trim().toLowerCase();
  const list = s.equipment.filter((e) => (view === 'all' || (view === 'replace' ? isOld(e) && !e.quoted : view === 'warranty' ? warrantySoon(e) : serviceSoon(e)))
    && (!text || [client(e.clientId)?.name ?? '', e.kind, e.model, e.serial, e.location].some((v) => v.toLowerCase().includes(text))));
  const opps = s.equipment.filter((e) => isOld(e) && !e.quoted);
  const patch = (id: string, p: Partial<Equipment>) => set((st) => ({ ...st, equipment: st.equipment.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const quote = (e: Equipment, quiet = false) => {
    if (lead(e.clientId, replaceType, replacePrice, tx(`Replacement opportunity from Equipment: ${e.kind}, ${ageYears(e.installed)} years old (serial ${e.serial}). ${e.note ?? ''}`, `Oportunidad de reemplazo desde Equipo: ${e.kind}, ${ageYears(e.installed)} años (serie ${e.serial}). ${e.note ?? ''}`), quiet)) { patch(e.id, { quoted: true }); return true; }
    return false;
  };
  const quoteAll = () => { const n = opps.filter((e) => quote(e, true)).length; toast(tx(`${n} replacement quote${n === 1 ? '' : 's'} added to Leads${replacePrice ? `, about ${money(n * replacePrice)}+` : ''}`, `${n} ${n === 1 ? 'cotización de reemplazo agregada' : 'cotizaciones de reemplazo agregadas'} a Prospectos${replacePrice ? `, unos ${money(n * replacePrice)}+` : ''}`)); };
  const book = (e: Equipment) => taskAll([e], (x) => 'svc:' + x.id, (x) => [tx(`Book the service visit for the ${x.kind.toLowerCase()} at ${client(x.clientId)?.name ?? ''}`, `Agendar la visita de servicio del equipo ${x.kind.toLowerCase()} de ${client(x.clientId)?.name ?? ''}`), { clientId: x.clientId, type: 'call', due: 1 }], () => tx('Service visit added to Tasks', 'Visita de servicio agregada a Tareas'));
  const register = (e: Equipment) => { patch(e.id, { partsWarranty: addDays(plumbing ? 6 * 365 : 10 * 365), laborWarranty: addDays(plumbing ? 365 : 2 * 365), note: tx('Warranty registered.', 'Garantía registrada.') }); toast(tx('Warranty registered on the unit', 'Garantía registrada en el equipo')); };
  const age = (e: Equipment) => { const y = ageYears(e.installed); return y === 0 ? tx('New', 'Nuevo') : tx(`${y} yr`, `${y} años`); };
  const warranty = (iso?: string) => { const n = daysTo(iso); if (n === undefined) return <span className="dim">{tx('None on file', 'Sin registro')}</span>; return <span className={cx(n < 0 && 'neg', n >= 0 && n <= 365 && 'warn-t')}>{n < 0 ? tx('Ended', 'Vencida') : date(iso)}</span>; };
  const kinds: [string, string][] = plumbing
    ? [[tx('Gas water heater', 'Calentador de gas'), tx('Gas water heater', 'Calentador de gas')], [tx('Electric water heater', 'Calentador eléctrico'), tx('Electric water heater', 'Calentador eléctrico')], [tx('Tankless water heater', 'Calentador sin tanque'), tx('Tankless water heater', 'Calentador sin tanque')], [tx('Sump pump', 'Bomba de sumidero'), tx('Sump pump', 'Bomba de sumidero')], [tx('Water softener', 'Suavizador de agua'), tx('Water softener', 'Suavizador de agua')], [tx('Grease trap', 'Trampa de grasa'), tx('Grease trap', 'Trampa de grasa')]]
    : [[tx('Central AC', 'Aire acondicionado central'), tx('Central AC', 'Aire acondicionado central')], [tx('Gas furnace', 'Caldera de gas'), tx('Gas furnace', 'Caldera de gas')], [tx('Heat pump', 'Bomba de calor'), tx('Heat pump', 'Bomba de calor')], [tx('Ductless mini-split', 'Mini-split sin ductos'), tx('Ductless mini-split', 'Mini-split sin ductos')], [tx('Boiler', 'Boiler'), tx('Boiler', 'Boiler')], [tx('Rooftop unit', 'Unidad de techo'), tx('Rooftop unit', 'Unidad de techo')]];
  return (
    <div className="trade">
      <Head tabs={tabs} title={tx('Client equipment', 'Equipo de clientes')}
        sub={plumbing ? tx('Water heaters and fixtures at each client, their age and warranty. Old units become quotes.', 'Calentadores y accesorios de cada cliente, su edad y garantía. Los viejos se convierten en cotizaciones.') : tx('Every unit at each client, its age and warranty. Old units become replacement quotes.', 'Cada equipo de cada cliente, su edad y garantía. Los viejos se convierten en cotizaciones.')}
        auto={quoteAll} autoLabel={tx('Quote all replacements', 'Cotizar todos los reemplazos')} autoCount={opps.length}
        more={can('write') ? <Button icon={<LuPlus aria-hidden="true" />} onClick={() => setAdding(true)} data-testid="equip-add">{tx('Add equipment', 'Agregar equipo')}</Button> : undefined} />
      <div className="kpis">
        <Stat label={tx('Units tracked', 'Equipos registrados')} value={String(s.equipment.length)} hint={tx(`At ${new Set(s.equipment.map((e) => e.clientId)).size} clients`, `En ${new Set(s.equipment.map((e) => e.clientId)).size} clientes`)} onClick={() => setView('all')} />
        <Stat label={tx('Replacement opportunities', 'Oportunidades de reemplazo')} value={String(opps.length)} hint={replacePrice ? tx(`About ${money(opps.length * replacePrice)}+ at the starting price`, `Unos ${money(opps.length * replacePrice)}+ al precio inicial`) : undefined} attention={opps.length > 0} onClick={() => setView('replace')} testId="equip-kpi-replace" />
        <Stat label={tx('Warranties ending within a year', 'Garantías que vencen en un año')} value={String(s.equipment.filter(warrantySoon).length)} hint={tx('Offer a plan before it ends', 'Ofrecer un plan antes de que venza')} onClick={() => setView('warranty')} />
        <Stat label={tx('Service due in 30 days', 'Servicio en los próximos 30 días')} value={String(s.equipment.filter(serviceSoon).length)} hint={tx('Book it before the season', 'Agendarlo antes de la temporada')} onClick={() => setView('service')} />
      </div>
      <div className="filters row between">
        <Seg value={view} onChange={setView} label={tx('Show', 'Mostrar')} options={[
          { value: 'all', label: tx('All', 'Todos'), count: s.equipment.length }, { value: 'replace', label: tx('Replace', 'Reemplazar'), count: opps.length },
          { value: 'warranty', label: tx('Warranty ending', 'Garantía por vencer') }, { value: 'service', label: tx('Service due', 'Servicio pendiente') }]} />
        <SearchBox value={q} onChange={setQ} placeholder={tx('Search client, model, serial', 'Buscar cliente, modelo, serie')} />
      </div>
      <Card flush>
        {!list.length ? <p className="pad dim"><LuSearch aria-hidden="true" /> {tx('Nothing here.', 'Nada por aquí.')}</p> : (
          <div className="table-wrap"><table className="tbl stackable" data-testid="equip-table">
            <thead><tr><th>{tx('Client', 'Cliente')}</th><th>{tx('Unit', 'Equipo')}</th><th>{tx('Age', 'Edad')}</th><th>{tx('Parts warranty', 'Garantía de piezas')}</th><th>{tx('Next service', 'Próximo servicio')}</th><th>{tx('Condition', 'Estado')}</th><th aria-label={tx('Actions', 'Acciones')} /></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id} data-equipment={e.id}>
                <td className="t1"><A to={'/clients/' + e.clientId}>{client(e.clientId)?.name}</A><div className="xs dim">{e.location}</div></td>
                <td data-label={tx('Unit', 'Equipo')}><b>{e.kind}</b><div className="xs dim">{e.detail}{e.refrigerant ? ' · ' + e.refrigerant : ''}{e.filter ? ' · ' + tx('filter', 'filtro') + ' ' + e.filter : ''}</div><div className="xs dim mono">{e.model} · {e.serial}</div>{e.note && <div className="xs">{e.note}</div>}</td>
                <td data-label={tx('Age', 'Edad')}>{age(e)}</td>
                <td data-label={tx('Parts warranty', 'Garantía de piezas')}>{warranty(e.partsWarranty)}</td>
                <td data-label={tx('Next service', 'Próximo servicio')}>{e.nextService ? <span className={cx((daysTo(e.nextService) ?? 99) <= 30 && 'warn-t')}>{date(e.nextService)}</span> : <span className="dim">{tx('Not set', 'Sin fecha')}</span>}</td>
                <td data-label={tx('Condition', 'Estado')}><Badge tone={e.status === 'good' ? 'ok' : e.status === 'watch' ? 'warn' : 'bad'}>{e.status === 'good' ? tx('Good', 'Bien') : e.status === 'watch' ? tx('Watch', 'Vigilar') : tx('Replace', 'Reemplazar')}</Badge></td>
                <td className="num">{e.quoted ? <Badge tone="info">{tx('Quote in Leads', 'Cotización en Prospectos')}</Badge>
                  : isOld(e) ? <Button size="sm" variant="primary" onClick={() => quote(e)} data-testid="equip-quote">{tx('Quote replacement', 'Cotizar reemplazo')}</Button>
                  : !e.partsWarranty && ageYears(e.installed) < 1 ? <Button size="sm" onClick={() => register(e)}>{tx('Register warranty', 'Registrar garantía')}</Button>
                  : isDone('svc:' + e.id) ? <Badge tone="ok">{tx('Service booked', 'Servicio agendado')}</Badge>
                  : serviceSoon(e) ? <Button size="sm" onClick={() => book(e)}>{tx('Book service', 'Agendar servicio')}</Button>
                  : <span className="xs dim">{tx('All set', 'Al día')}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {adding && <FormModal title={tx('Add equipment', 'Agregar equipo')} saveLabel={tx('Save', 'Guardar')} cancelLabel={tx('Cancel', 'Cancelar')} requiredMsg={tx('Fill in the required fields.', 'Complete los campos obligatorios.')}
        initial={{ clientId: data.clients[0]?.id, kind: kinds[0][0], installed: addDays(0) }}
        fields={[
          { k: 'clientId', label: tx('Client', 'Cliente'), type: 'select', req: true, options: data.clients.map((c) => [c.id, c.name]) },
          { k: 'kind', label: tx('Type', 'Tipo'), type: 'select', req: true, options: kinds },
          { k: 'detail', label: tx('Size and details', 'Tamaño y detalles'), placeholder: plumbing ? tx('50 gallon, gas', '50 galones, gas') : tx('3 ton, 16 SEER2', '3 toneladas, 16 SEER2') },
          { k: 'location', label: tx('Location', 'Ubicación'), placeholder: tx('Basement', 'Sótano') },
          { k: 'model', label: tx('Model', 'Modelo') }, { k: 'serial', label: tx('Serial', 'Serie') },
          { k: 'installed', label: tx('Installed', 'Instalado'), type: 'date', req: true },
          { k: 'partsWarranty', label: tx('Parts warranty ends', 'Fin de la garantía de piezas'), type: 'date' },
          { k: 'nextService', label: tx('Next service', 'Próximo servicio'), type: 'date' },
        ]}
        onSave={(v) => { set((st) => ({ ...st, equipment: [{ id: 'e' + Date.now(), clientId: v.clientId, kind: v.kind, detail: v.detail, location: v.location, model: v.model || '', serial: v.serial || '', installed: v.installed, partsWarranty: v.partsWarranty || undefined, nextService: v.nextService || undefined, status: 'good' }, ...st.equipment] })); toast(tx('Equipment added', 'Equipo agregado')); }}
        onClose={() => setAdding(false)} />}
    </div>
  );
}
