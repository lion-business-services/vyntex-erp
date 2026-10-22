// The menu of the sample shop: services with made-up sample prices (not anyone's real prices), how long each one takes,
// and what the shop sells ahead of the visit (memberships, packages, gift cards).
// Appointment types at1 to at7 are the edition's starter set (pack.appointmentTypes), in that order, with the sample
// shop's prices; at8 and at9 are the shop's own. Service ids are fixed because bookings, walk-ins and plans point at them.
import type { AppointmentType, CatalogService, Lang, PassPlan } from '@/domain/types';
import { barberPack } from '../pack';
import { txFor } from '../../practice/seed/util';

interface Svc { id: string; cat: string; en: string; es: string; aboutEn: string; aboutEs: string; price: number; at?: string; active?: boolean }
const SERVICES: Svc[] = [
  { id: 'sv-cut', cat: 'haircut', en: 'Classic haircut', es: 'Corte clásico', price: 35, at: 'at1', aboutEn: 'Scissor or clipper cut, wash and style.', aboutEs: 'Corte con tijera o máquina, lavado y peinado.' },
  { id: 'sv-fade', cat: 'haircut', en: 'Skin fade', es: 'Desvanecido a piel', price: 40, at: 'at2', aboutEn: 'Fade down to the skin, blended by hand, with a line-up.', aboutEs: 'Desvanecido hasta la piel, difuminado a mano, con perfilado.' },
  { id: 'sv-beard', cat: 'beard', en: 'Beard trim and line-up', es: 'Arreglo de barba y perfilado', price: 20, at: 'at3', aboutEn: 'Shape, trim and a razor line.', aboutEs: 'Forma, recorte y línea con navaja.' },
  { id: 'sv-combo', cat: 'haircut', en: 'Haircut and beard', es: 'Corte y barba', price: 55, at: 'at4', aboutEn: 'Any haircut with a full beard trim and hot towel.', aboutEs: 'Cualquier corte con arreglo completo de barba y toalla caliente.' },
  { id: 'sv-shave', cat: 'beard', en: 'Hot towel shave', es: 'Afeitado con toalla caliente', price: 40, at: 'at5', aboutEn: 'Straight razor shave with hot towels and a cold finish.', aboutEs: 'Afeitado con navaja, toallas calientes y cierre en frío.' },
  { id: 'sv-kids', cat: 'kids', en: 'Kids cut (12 and under)', es: 'Corte de niño (12 años o menos)', price: 25, at: 'at6', aboutEn: 'A patient cut for the little ones.', aboutEs: 'Un corte con paciencia para los pequeños.' },
  { id: 'sv-senior', cat: 'kids', en: 'Senior cut (65 and over)', es: 'Corte de adulto mayor (65 o más)', price: 25, at: 'at8', aboutEn: 'Classic cut at a senior price.', aboutEs: 'Corte clásico con precio para adultos mayores.' },
  { id: 'sv-gray', cat: 'grooming', en: 'Gray blending', es: 'Difuminado de canas', price: 30, at: 'at9', aboutEn: 'Softens the gray in hair or beard. Patch test first.', aboutEs: 'Suaviza las canas del cabello o la barba. Primero prueba de sensibilidad.' },
  { id: 'sv-design', cat: 'grooming', en: 'Hair design', es: 'Diseño en el cabello', price: 15, aboutEn: 'Lines or a pattern added to any cut.', aboutEs: 'Líneas o un diseño agregado a cualquier corte.' },
  { id: 'sv-brows', cat: 'grooming', en: 'Eyebrow cleanup', es: 'Arreglo de cejas', price: 10, aboutEn: 'Razor or trimmer cleanup.', aboutEs: 'Limpieza con navaja o máquina.' },
  { id: 'sv-pomade', cat: 'products', en: 'Matte pomade (shop brand)', es: 'Pomada mate (marca de la casa)', price: 18, aboutEn: 'Retail jar. Sample product.', aboutEs: 'Frasco para venta. Producto de muestra.' },
  { id: 'sv-group', cat: 'group', en: 'Group or event grooming (per person)', es: 'Arreglo para grupo o evento (por persona)', price: 45, at: 'at7', aboutEn: 'Weddings, proms, team photos. Quoted per group.', aboutEs: 'Bodas, graduaciones, fotos de equipo. Se cotiza por grupo.' },
  // retired: stays on the old visits and cannot be picked for new ones
  { id: 'sv-perm', cat: 'other', en: 'Texture perm', es: 'Permanente de textura', price: 70, active: false, aboutEn: 'No longer offered.', aboutEs: 'Ya no se ofrece.' },
];
/** Sample prices of the starter appointment types, in the order the edition lists them. */
const TYPE_FEES = [35, 40, 20, 55, 40, 25, 0];

export function menu(lang: Lang): { catalog: CatalogService[]; apptTypes: AppointmentType[]; passPlans: PassPlan[] } {
  const tx = txFor(lang);
  const catalog: CatalogService[] = SERVICES.map((s) => ({
    id: s.id, name: tx(s.en, s.es), i18n: { en: { name: s.en, description: s.aboutEn }, es: { name: s.es, description: s.aboutEs } }, category: s.cat, description: tx(s.aboutEn, s.aboutEs),
    active: s.active !== false, tiers: [{ id: `${s.id}-t1`, name: tx('Standard', 'Estándar'), price: s.price, unit: 'flat' }], appointmentTypeId: s.at,
  }));
  const svcOf = (at: string) => SERVICES.find((s) => s.at === at)?.id;
  const apptTypes: AppointmentType[] = [
    ...barberPack.appointmentTypes.map((a, i) => ({ ...a, name: { ...a.name }, id: 'at' + (i + 1), fee: TYPE_FEES[i] ?? 0, serviceId: svcOf('at' + (i + 1)) })),
    { id: 'at8', name: { en: 'Senior cut', es: 'Corte de adulto mayor' }, minutes: 30, fee: 25, prepay: false, mode: 'office', active: true, serviceId: 'sv-senior' },
    { id: 'at9', name: { en: 'Gray blending', es: 'Difuminado de canas' }, minutes: 30, fee: 30, prepay: false, mode: 'office', buffer: 10, active: true, serviceId: 'sv-gray' },
  ];
  const passPlans: PassPlan[] = [
    { id: 'pp-club', kind: 'membership', name: tx('Cut Club', 'Club del Corte'), i18n: { en: { name: 'Cut Club', perks: 'Two cuts a month, 10% off products' }, es: { name: 'Club del Corte', perks: 'Dos cortes al mes, 10% de descuento en productos' } },
      price: 60, visits: 2, interval: 'month', serviceIds: ['sv-cut', 'sv-fade'], discount: 10, perks: tx('Two cuts a month, 10% off products', 'Dos cortes al mes, 10% de descuento en productos'), active: true },
    { id: 'pp-beard', kind: 'membership', name: tx('Beard Club', 'Club de la Barba'), i18n: { en: { name: 'Beard Club', perks: 'Unlimited beard trims' }, es: { name: 'Club de la Barba', perks: 'Arreglos de barba ilimitados' } },
      price: 45, visits: 0, interval: 'month', serviceIds: ['sv-beard'], perks: tx('Unlimited beard trims', 'Arreglos de barba ilimitados'), active: true },
    { id: 'pp-five', kind: 'package', name: tx('5-cut pack', 'Paquete de 5 cortes'), i18n: { en: { name: '5-cut pack' }, es: { name: 'Paquete de 5 cortes' } },
      price: 160, visits: 5, serviceIds: ['sv-cut', 'sv-fade'], validDays: 180, active: true },
    { id: 'pp-kids', kind: 'package', name: tx('Kids 4-pack', 'Paquete de 4 cortes de niño'), i18n: { en: { name: 'Kids 4-pack' }, es: { name: 'Paquete de 4 cortes de niño' } },
      price: 85, visits: 4, serviceIds: ['sv-kids'], validDays: 120, active: true },
    { id: 'pp-gift', kind: 'gift_card', name: tx('Gift card', 'Tarjeta de regalo'), i18n: { en: { name: 'Gift card' }, es: { name: 'Tarjeta de regalo' } }, price: 50, serviceIds: [], validDays: 365, active: true },
  ];
  return { catalog, apptTypes, passPlans };
}
