// The trade records of the HVAC and plumbing sample businesses. Fictional data only: sample clients (c1...), technicians
// (w1...) and jobs (j1...) of src/packs/<edition>/seed.ts; no real brand, model or permit number.
import type { DemoState, IndustryId, Lang } from '@/domain/types';
import { addDays } from '@/lib/dates';
import type { Device, Dispatch, Equipment, Inspection, Permit, RefrigerantEntry, TradeState } from './store';

const yearsAgo = (y: number, days = 0) => addDays(-Math.round(y * 365) - days);
const inYears = (y: number, days = 0) => addDays(Math.round(y * 365) + days);

/** Today's board, made from the edition's own open work: jobs under way or starting soon, and new emergency calls. */
function board(d: DemoState, tx: (en: string, es: string) => string, windows: string[]): Dispatch[] {
  const out: Dispatch[] = [];
  const name = (id?: string) => d.clients.find((c) => c.id === id)?.name ?? '';
  const addr = (id?: string) => d.clients.find((c) => c.id === id)?.addresses?.[0] ?? '';
  for (const l of d.leads.filter((x) => x.type === 'emergency' && !['won', 'lost'].includes(x.status)))
    out.push({ id: 'dl-' + l.id, ref: { type: 'lead', id: l.id }, window: tx('ASAP', 'Lo antes posible'), state: 'waiting', urgent: true, title: tx('Emergency call', 'Llamada de emergencia'), clientName: l.name, address: l.address });
  const techs = new Set(d.workers.filter((w) => w.active !== false && w.payType === 'hourly').map((w) => w.id));
  const once = (r?: string) => !r || r === 'once';
  const jobs = d.jobs.filter((j) => (j.status === 'progress' || j.status === 'contract' || j.status === 'hold') && once(j.repeat)).slice(0, 8);
  jobs.forEach((j, i) => {
    const w = j.assign.map((a) => a.workerId).find((id) => techs.has(id));
    out.push({ id: 'dj-' + j.id, ref: { type: 'job', id: j.id }, workerId: w, window: windows[i % windows.length], state: i === 0 ? 'on_site' : i === 1 ? 'en_route' : 'waiting', title: j.name, clientName: name(j.clientId), address: j.address || addr(j.clientId) });
  });
  // plan members' visits: the recurring work rides on the same board
  const free = [...techs];
  d.jobs.filter((j) => j.status === 'progress' && !once(j.repeat)).forEach((j, i) => {
    out.push({ id: 'dp-' + j.id, ref: { type: 'job', id: j.id }, workerId: free[(i + 2) % Math.max(1, free.length)], window: windows[(i + 3) % windows.length], state: 'waiting', title: tx('Plan visit: ', 'Visita del plan: ') + j.name, clientName: name(j.clientId), address: j.address || addr(j.clientId) });
  });
  for (const l of d.leads.filter((x) => x.status === 'scheduled').slice(0, 2))
    out.push({ id: 'dv-' + l.id, ref: { type: 'lead', id: l.id }, window: windows[(out.length + 1) % windows.length], state: 'waiting', title: tx('Estimate visit', 'Visita de presupuesto'), clientName: l.name, address: l.address });
  return out;
}

export function sampleFor(pack: IndustryId, lang: Lang, d: DemoState): TradeState {
  const tx = (en: string, es: string) => (lang === 'es' ? es : en);
  const windows = ['8:00 to 10:00', '10:00 to 12:00', '12:00 to 2:00', '2:00 to 4:00', '4:00 to 6:00'];
  if (pack === 'hvac') {
    const equipment: Equipment[] = [
      { id: 'e1', clientId: 'c1', kind: tx('Heat pump', 'Bomba de calor'), detail: tx('3 ton, variable speed, 18 SEER2', '3 toneladas, velocidad variable, 18 SEER2'), location: tx('Side yard', 'Patio lateral'), model: 'HP36-VS-SAMPLE', serial: 'S24E118803', installed: addDays(0), partsWarranty: inYears(10), laborWarranty: inYears(2), nextService: addDays(180), refrigerant: 'R-454B', filter: '20x25x4', status: 'good', note: tx('Installed today. Warranty registration pending.', 'Instalada hoy. Registro de garantía pendiente.') },
      { id: 'e2', clientId: 'c1', kind: tx('Air handler', 'Manejadora de aire'), detail: tx('Variable speed, 10 kW heat strip', 'Velocidad variable, resistencia de 10 kW'), location: tx('Basement', 'Sótano'), model: 'AH36-VS-SAMPLE', serial: 'S24E118804', installed: addDays(0), partsWarranty: inYears(10), laborWarranty: inYears(2), status: 'good' },
      { id: 'e3', clientId: 'c4', kind: tx('Central AC', 'Aire acondicionado central'), detail: tx('2.5 ton, 14 SEER', '2.5 toneladas, 14 SEER'), location: tx('Back yard', 'Patio trasero'), model: 'AC30-SAMPLE', serial: 'S16C447120', installed: yearsAgo(8), partsWarranty: inYears(0, 240), lastService: addDays(-21), nextService: addDays(160), refrigerant: 'R-410A', filter: '16x25x1', status: 'watch', note: tx('Run capacitor tested weak (32 of 45 µF).', 'El capacitor salió débil (32 de 45 µF).') },
      { id: 'e4', clientId: 'c4', kind: tx('Gas furnace', 'Caldera de gas'), detail: tx('80,000 BTU, 96% AFUE', '80,000 BTU, 96% AFUE'), location: tx('Basement', 'Sótano'), model: 'GF80-SAMPLE', serial: 'S16F447133', installed: yearsAgo(8), partsWarranty: inYears(0, 240), lastService: addDays(-200), nextService: addDays(12), filter: '16x25x1', status: 'good' },
      { id: 'e5', clientId: 'c5', kind: tx('Gas furnace', 'Caldera de gas'), detail: tx('100,000 BTU, 80% AFUE', '100,000 BTU, 80% AFUE'), location: tx('Utility closet', 'Cuarto de servicio'), model: 'GF100-SAMPLE', serial: 'S09F100245', installed: yearsAgo(15), lastService: addDays(-9), refrigerant: undefined, filter: '20x20x1', status: 'replace', note: tx('15 years old, igniter replaced on an emergency call. Good candidate for a heat pump.', 'Tiene 15 años, se cambió el encendedor en una emergencia. Buena candidata para bomba de calor.') },
      { id: 'e6', clientId: 'c2', kind: tx('Rooftop unit 1', 'Unidad de techo 1'), detail: tx('5 ton gas / electric RTU', 'RTU de 5 toneladas gas / eléctrica'), location: tx('Roof, north', 'Techo, norte'), model: 'RTU60-SAMPLE', serial: 'S14R220781', installed: yearsAgo(11), lastService: addDays(-90), nextService: addDays(4), refrigerant: 'R-410A', filter: '20x25x2 (x4)', status: 'watch' },
      { id: 'e7', clientId: 'c2', kind: tx('Rooftop unit 2', 'Unidad de techo 2'), detail: tx('5 ton gas / electric RTU', 'RTU de 5 toneladas gas / eléctrica'), location: tx('Roof, south', 'Techo, sur'), model: 'RTU60-SAMPLE', serial: 'S14R220782', installed: yearsAgo(11), lastService: addDays(-90), nextService: addDays(4), refrigerant: 'R-410A', filter: '20x25x2 (x4)', status: 'replace', note: tx('Blower motor drawing high amps, bearings noisy. Quote sent.', 'El motor del ventilador jala amperaje alto y los baleros hacen ruido. Cotización enviada.') },
      { id: 'e8', clientId: 'c6', kind: tx('Gas furnace', 'Caldera de gas'), detail: tx('Unit 100, 60,000 BTU', 'Unidad 100, 60,000 BTU'), location: tx('Closet, unit 100', 'Clóset, unidad 100'), model: 'GF60-SAMPLE', serial: 'S12F310077', installed: yearsAgo(13), lastService: addDays(-3), filter: '16x20x1', status: 'replace', note: tx('Filter very dirty at the last visit. 13 years old.', 'El filtro estaba muy sucio en la última visita. Tiene 13 años.') },
      { id: 'e9', clientId: 'c6', kind: tx('Central AC', 'Aire acondicionado central'), detail: tx('2.5 ton, unit 18', '2.5 toneladas, unidad 18'), location: tx('Rear pad, unit 18', 'Base trasera, unidad 18'), model: 'AC30-SAMPLE', serial: 'S23C551902', installed: addDays(-40), partsWarranty: inYears(10, -40), laborWarranty: inYears(2, -40), nextService: addDays(140), refrigerant: 'R-410A', status: 'good' },
      { id: 'e10', clientId: 'c3', kind: tx('Central AC', 'Aire acondicionado central'), detail: tx('3 ton, 14 SEER', '3 toneladas, 14 SEER'), location: tx('Side yard', 'Patio lateral'), model: 'AC36-SAMPLE', serial: 'S13C209915', installed: yearsAgo(12), lastService: addDays(-18), nextService: addDays(150), refrigerant: 'R-410A', filter: '16x25x1', status: 'watch', note: tx('Leak repaired at the service valve. Watch the charge at the next tune-up.', 'Se reparó una fuga en la válvula de servicio. Revisar la carga en el próximo mantenimiento.') },
      { id: 'e11', clientId: 'c10', kind: tx('Hot water boiler', 'Caldera de agua caliente'), detail: tx('Gym, 750,000 BTU', 'Gimnasio, 750,000 BTU'), location: tx('Boiler room', 'Cuarto de calderas'), model: 'HWB750-SAMPLE', serial: 'S07B004418', installed: yearsAgo(17), status: 'replace', note: tx('Flame failure lockouts. Ignition module on backorder.', 'Se bloquea por falla de flama. Módulo de encendido agotado.') },
    ];
    const permits: Permit[] = [
      { id: 'p1', jobId: 'j1', kind: tx('Mechanical', 'Mecánico'), town: tx('Linwood', 'Linwood'), number: 'SAMPLE-M-0412', applied: addDays(-5), status: 'approved', inspection: addDays(2) },
      { id: 'p2', jobId: 'j1', kind: tx('Electrical', 'Eléctrico'), town: tx('Linwood', 'Linwood'), number: 'SAMPLE-E-0413', applied: addDays(-5), status: 'approved', inspection: addDays(2) },
      { id: 'p3', jobId: 'j11', kind: tx('Mechanical', 'Mecánico'), town: tx('Galloway', 'Galloway'), number: 'SAMPLE-M-0377', applied: addDays(-41), status: 'passed', inspection: addDays(-33) },
      { id: 'p4', jobId: 'j7', kind: tx('Mechanical', 'Mecánico'), town: tx('Margate', 'Margate'), number: tx('Not filed yet', 'Sin tramitar'), applied: addDays(0), status: 'applied', note: tx('File before the start date.', 'Tramitar antes de la fecha de inicio.') },
      { id: 'p5', jobId: 'j6', kind: tx('Commercial mechanical', 'Mecánico comercial'), town: tx('Hammonton', 'Hammonton'), number: tx('Waiting on the signed quote', 'Esperando la cotización firmada'), applied: addDays(0), status: 'applied' },
    ];
    const refrigerant: RefrigerantEntry[] = [
      { id: 'r1', date: addDays(-18), jobId: 'j5', clientId: 'c3', workerId: 'w3', gas: 'R-410A', added: 2, recovered: 2, cylinder: 'CYL-0412', leak: 'found_repaired', note: tx('Leak at the suction service valve core, repaired.', 'Fuga en el núcleo de la válvula de servicio de succión, reparada.') },
      { id: 'r2', date: addDays(-39), jobId: 'j11', clientId: 'c6', workerId: 'w1', gas: 'R-410A', added: 1.5, recovered: 5.5, cylinder: 'REC-0107', leak: 'none', note: tx('Old system recovered before removal. New system charge trimmed.', 'Se recuperó el equipo viejo antes de retirarlo. Se ajustó la carga del nuevo.') },
      { id: 'r3', date: addDays(-21), jobId: 'j4', clientId: 'c4', workerId: 'w3', gas: 'R-410A', added: 0, recovered: 0, cylinder: '', leak: 'none', note: tx('Tune-up, pressures normal, no charge added.', 'Mantenimiento, presiones normales, no se agregó carga.') },
      { id: 'r4', date: addDays(-90), jobId: 'j2', clientId: 'c2', workerId: 'w7', gas: 'R-410A', added: 1, recovered: 0, cylinder: 'CYL-0388', leak: 'found_open', note: tx('Small leak suspected on unit 2 coil. Recheck at the fall visit.', 'Se sospecha una fuga chica en el serpentín de la unidad 2. Revisar en la visita de otoño.') },
      { id: 'r5', date: addDays(0), jobId: 'j1', clientId: 'c1', workerId: 'w1', gas: 'R-454B', added: 3.25, recovered: 0, cylinder: 'CYL-0420', leak: 'none', note: tx('New install, charge for the line set length.', 'Instalación nueva, carga según el largo de la línea.') },
    ];
    return { equipment, permits, refrigerant, devices: [], inspections: [], dispatch: board(d, tx, windows), onCall: { workerId: 'w2' } };
  }
  // plumbing
  const equipment: Equipment[] = [
    { id: 'e1', clientId: 'c10', kind: tx('Gas water heater', 'Calentador de gas'), detail: tx('40 gallon tank, atmospheric vent', 'Tanque de 40 galones, ventilación atmosférica'), location: tx('Basement', 'Sótano'), model: 'GWH40-SAMPLE', serial: 'S24W100871', installed: addDays(-15), partsWarranty: inYears(6, -15), laborWarranty: inYears(1, -15), nextService: addDays(350), status: 'good', note: tx('Expansion tank and sediment trap added.', 'Se agregó tanque de expansión y trampa de sedimento.') },
    { id: 'e2', clientId: 'c3', kind: tx('Gas water heater', 'Calentador de gas'), detail: tx('50 gallon tank', 'Tanque de 50 galones'), location: tx('Basement', 'Sótano'), model: 'GWH50-SAMPLE', serial: 'S10W338120', installed: yearsAgo(14), lastService: addDays(-12), status: 'replace', note: tx('14 years old, rust at the base. Offer a replacement.', 'Tiene 14 años, óxido en la base. Ofrecer reemplazo.') },
    { id: 'e3', clientId: 'c8', kind: tx('Gas water heater', 'Calentador de gas'), detail: tx('50 gallon tank', 'Tanque de 50 galones'), location: tx('Garage', 'Cochera'), model: 'GWH50-SAMPLE', serial: 'S13W440912', installed: yearsAgo(11), status: 'replace', note: tx('Family of 5 runs out of hot water. Tankless quote out.', 'Familia de 5, se les acaba el agua caliente. Cotización de sin tanque enviada.'), quoted: true },
    { id: 'e4', clientId: 'c1', kind: tx('Pressure reducing valve', 'Válvula reductora de presión'), detail: tx('3/4 inch, set at 60 psi', '3/4 de pulgada, ajustada a 60 psi'), location: tx('Main shutoff', 'Llave de paso principal'), model: 'PRV075-SAMPLE', serial: 'S24P002231', installed: addDays(-1), partsWarranty: inYears(5, -1), laborWarranty: inYears(1, -1), status: 'good' },
    { id: 'e5', clientId: 'c1', kind: tx('Gas water heater', 'Calentador de gas'), detail: tx('40 gallon tank', 'Tanque de 40 galones'), location: tx('Laundry room', 'Lavandería'), model: 'GWH40-SAMPLE', serial: 'S17W220645', installed: yearsAgo(7), lastService: addDays(-1), nextService: addDays(364), status: 'watch', note: tx('Connected to the new PEX. Flush it at the yearly visit.', 'Conectado al PEX nuevo. Limpiarlo en la visita anual.') },
    { id: 'e6', clientId: 'c2', kind: tx('Grease trap', 'Trampa de grasa'), detail: tx('1,000 gallon in-ground interceptor', 'Interceptor enterrado de 1,000 galones'), location: tx('Rear lot', 'Estacionamiento trasero'), model: 'GT1000-SAMPLE', serial: 'S15G000318', installed: yearsAgo(9), lastService: addDays(-100), nextService: addDays(5), status: 'watch', note: tx('Pumped every 90 days. Manifest kept for the health department.', 'Se limpia cada 90 días. Se guarda el manifiesto para el departamento de salud.') },
    { id: 'e7', clientId: 'c7', kind: tx('Electric water heater', 'Calentador eléctrico'), detail: tx('Unit 12, 40 gallon', 'Unidad 12, 40 galones'), location: tx('Closet, unit 12', 'Clóset, unidad 12'), model: 'EWH40-SAMPLE', serial: 'S12W118207', installed: yearsAgo(12), status: 'replace', note: tx('Third leak this year in the unit. Repipe quote with the owner.', 'Tercera fuga este año en la unidad. Cotización de cambio de tubería con el dueño.') },
    { id: 'e8', clientId: 'c6', kind: tx('Sewer cleanout', 'Registro de drenaje'), detail: tx('New two way cleanout (after the liner)', 'Registro nuevo de dos vías (después del encamisado)'), location: tx('Front yard', 'Jardín del frente'), model: tx('n/a', 'n/a'), serial: tx('n/a', 'n/a'), installed: addDays(8), status: 'good' },
  ];
  const devices: Device[] = [
    { id: 'b1', clientId: 'c4', kind: 'RPZ', size: '2"', location: tx('Domestic water, mechanical room', 'Agua doméstica, cuarto de máquinas'), serial: 'S-RP-20114', lastTest: addDays(-20), result: 'pass', due: addDays(345), filed: true, readings: tx('Check 1: 7.2 psid, relief opened at 3.1 psid', 'Retención 1: 7.2 psid, alivio abrió a 3.1 psid') },
    { id: 'b2', clientId: 'c4', kind: 'RPZ', size: '1"', location: tx('Boiler feed', 'Alimentación de la caldera'), serial: 'S-RP-20115', lastTest: addDays(-20), result: 'fail', due: addDays(10), filed: false, readings: tx('Relief opened at 1.4 psid, below the 2.0 minimum', 'El alivio abrió a 1.4 psid, debajo del mínimo de 2.0') },
    { id: 'b3', clientId: 'c4', kind: 'DCVA', size: '4"', location: tx('Fire line', 'Línea contra incendios'), serial: 'S-DC-40071', lastTest: addDays(-20), result: 'pass', due: addDays(345), filed: true },
    { id: 'b4', clientId: 'c4', kind: 'PVB', size: '1"', location: tx('Irrigation', 'Riego'), serial: 'S-PV-10230', lastTest: addDays(-20), result: 'pass', due: addDays(345), filed: true },
    { id: 'b5', clientId: 'c2', kind: 'RPZ', size: '3/4"', location: tx('Ice machine and soda line', 'Máquina de hielo y línea de refrescos'), serial: 'S-RP-07512', lastTest: addDays(-352), result: 'pass', due: addDays(13), filed: true },
    { id: 'b6', clientId: 'c2', kind: 'DCVA', size: '2"', location: tx('Kitchen supply', 'Agua de la cocina'), serial: 'S-DC-20988', lastTest: addDays(-371), result: 'pass', due: addDays(-6), filed: true },
    { id: 'b7', clientId: 'c7', kind: 'PVB', size: '1"', location: tx('Lawn irrigation, building 12', 'Riego, edificio 12'), serial: 'S-PV-10544', lastTest: addDays(-340), result: 'pass', due: addDays(25), filed: true },
  ];
  const inspections: Inspection[] = [
    { id: 'i1', clientId: 'c6', jobId: 'j6', date: addDays(-5), line: tx('Main sewer, house to street', 'Drenaje principal, de la casa a la calle'), length: 62, workerId: 'w7',
      findings: [{ at: 0, kind: 'ok', text: tx('Cleanout at the foundation', 'Registro en la cimentación') }, { at: 14, kind: 'grease', text: tx('Light buildup', 'Acumulación ligera') }, { at: 38, kind: 'roots', text: tx('Root intrusion at a joint, under the maple', 'Raíces en una unión, debajo del maple') }, { at: 41, kind: 'crack', text: tx('Cracked joint, water flowing out', 'Unión partida, sale agua') }, { at: 62, kind: 'ok', text: tx('Tie-in to the city main', 'Conexión al drenaje de la ciudad') }],
      advice: tx('Hydro jet, then a 45 foot trenchless liner from the cleanout. Signed.', 'Hidrolimpieza y luego encamisado sin zanja de 45 pies desde el registro. Firmado.'), shared: true, quoted: true },
    { id: 'i2', clientId: 'c2', jobId: 'j2', date: addDays(-100), line: tx('Kitchen line to the grease trap', 'Línea de la cocina a la trampa de grasa'), length: 60, workerId: 'w7',
      findings: [{ at: 8, kind: 'grease', text: tx('Heavy grease at the first bend', 'Mucha grasa en el primer codo') }, { at: 30, kind: 'ok', text: tx('Clean after jetting', 'Limpio después de la hidrolimpieza') }, { at: 60, kind: 'ok', text: tx('Trap inlet', 'Entrada de la trampa') }],
      advice: tx('Jet every 4 months instead of 6.', 'Hidrolimpiar cada 4 meses en lugar de 6.'), shared: true },
    { id: 'i3', clientId: 'c5', date: addDays(-6), line: tx('Upstairs bath drain', 'Drenaje del baño de arriba'), length: 18, workerId: 'w2',
      findings: [{ at: 4, kind: 'ok', text: tx('Toilet flange', 'Brida del inodoro') }, { at: 11, kind: 'offset', text: tx('Small offset at the stack, no leak', 'Pequeño desfase en la bajante, sin fuga') }],
      advice: tx('No repair needed. Recheck if the ceiling stain comes back.', 'No necesita reparación. Volver a revisar si regresa la mancha del techo.'), shared: false },
  ];
  const permits: Permit[] = [
    { id: 'p1', jobId: 'j1', kind: tx('Plumbing', 'Plomería'), town: 'Linwood', number: 'SAMPLE-P-0518', applied: addDays(-4), status: 'approved', inspection: addDays(1), note: tx('Rough inspection, then the $4,400 payment.', 'Inspección preliminar, luego el pago de $4,400.') },
    { id: 'p2', jobId: 'j6', kind: tx('Plumbing, sewer', 'Plomería, alcantarillado'), town: 'Margate', number: tx('Submitted', 'Entregado'), applied: addDays(-2), status: 'applied', note: tx('811 markout called. Waiting on the township.', 'Se llamó al 811. Esperando al municipio.') },
    { id: 'p3', jobId: 'j8', kind: tx('Plumbing', 'Plomería'), town: 'Absecon', number: 'SAMPLE-P-0502', applied: addDays(-9), status: 'rough', inspection: addDays(-2), note: tx('Rough passed. Final after the countertops.', 'Preliminar aprobada. Final después de las cubiertas.') },
    { id: 'p4', jobId: 'j10', kind: tx('Plumbing and gas', 'Plomería y gas'), town: 'Mays Landing', number: 'SAMPLE-PG-0477', applied: addDays(-16), status: 'passed', inspection: addDays(-10) },
    { id: 'p5', jobId: 'j7', kind: tx('Gas and plumbing', 'Gas y plomería'), town: 'Galloway', number: tx('Not filed yet', 'Sin tramitar'), applied: addDays(0), status: 'applied', note: tx('File when the tankless quote is signed.', 'Tramitar cuando se firme la cotización del sin tanque.') },
  ];
  return { equipment, permits, refrigerant: [], devices, inspections, dispatch: board(d, tx, windows), onCall: { workerId: 'w2' } };
}
