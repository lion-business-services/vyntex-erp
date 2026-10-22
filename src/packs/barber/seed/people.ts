// The team of the sample shop. Fictional people: example.com addresses and 555 numbers.
// Ids are fixed because the chairs, the bookings and the pay point at them:
//   u1 owner who also cuts, u2 shop manager and senior barber, u3 and u5 barbers on commission, u4 a barber who rents
//   his chair, u6 the front desk, u7 a barber who was invited and has not accepted yet.
import type { Chair, CompanyConfig, Lang, Office, TeamUser } from '@/domain/types';
import { stamp, txFor } from '../../practice/seed/util';

export const SHOP_ADDRESS = '45 Sample Boulevard, Somers Point, NJ 08244';

export function people(lang: Lang): { users: TeamUser[]; offices: Office[]; config: CompanyConfig; chairs: Chair[] } {
  const tx = txFor(lang);
  const offices: Office[] = [{ id: 'o1', name: tx('The shop', 'La barbería'), address: SHOP_ADDRESS, phone: '609-555-0700', timezone: 'America/New_York', main: true }];
  const users: TeamUser[] = [
    { id: 'u1', name: 'Marco Delgado', role: 'owner', email: 'marco@example.com', phone: '609-555-0701', title: tx('Owner and master barber', 'Dueño y maestro barbero'), languages: ['en', 'es'], officeIds: ['o1'], active: true,
      bio: tx('Opened the shop and still works chair 1 four days a week. Classic cuts and hot towel shaves.', 'Abrió la barbería y sigue en la silla 1 cuatro días a la semana. Cortes clásicos y afeitado con toalla caliente.'), mfa: true, lastSeen: stamp(0, 8, 40) },
    { id: 'u2', name: 'Keisha Grant', role: 'manager', email: 'keisha@example.com', phone: '609-555-0702', title: tx('Shop manager and senior barber', 'Encargada y barbera sénior'), languages: ['en'], officeIds: ['o1'], active: true, inLeadPool: true,
      bio: tx('Runs the floor and the schedule. Known for skin fades and designs.', 'Lleva el piso y la agenda. Conocida por sus desvanecidos a piel y diseños.'), mfa: true, lastSeen: stamp(0, 9, 5) },
    { id: 'u3', name: 'Luis Ortega', role: 'staff', email: 'luis@example.com', phone: '609-555-0703', title: tx('Barber', 'Barbero'), languages: ['en', 'es'], officeIds: ['o1'], active: true, inLeadPool: true,
      bio: tx('Fades, tapers and beard sculpting. Takes most of the walk-ins on weekends.', 'Desvanecidos, degradados y diseño de barba. Atiende la mayoría de los clientes sin cita los fines de semana.'), mfa: true, lastSeen: stamp(0, 9, 20) },
    { id: 'u4', name: 'Andre Whitfield', role: 'staff', email: 'andre@example.com', phone: '609-555-0704', title: tx('Barber (rents his chair)', 'Barbero (renta su silla)'), languages: ['en'], officeIds: ['o1'], active: true,
      bio: tx('Works by appointment only with his own clients. Pays a weekly chair rent.', 'Trabaja solo con cita y con sus propios clientes. Paga una renta semanal por la silla.'), mfa: true, lastSeen: stamp(-1, 17, 45) },
    { id: 'u5', name: 'Tony Nguyen', role: 'staff', email: 'tony@example.com', phone: '609-555-0705', title: tx('Junior barber', 'Barbero junior'), languages: ['en', 'zh'], officeIds: ['o1'], active: true,
      bio: tx('Two years behind the chair. Kids cuts, classic cuts and line-ups.', 'Dos años en la silla. Cortes de niño, cortes clásicos y perfilados.'), mfa: false, lastSeen: stamp(0, 9, 0) },
    { id: 'u6', name: 'Daniela Ruiz', role: 'staff', email: 'daniela@example.com', phone: '609-555-0706', title: tx('Front desk', 'Recepción'), languages: ['en', 'es'], officeIds: ['o1'], active: true,
      bio: tx('Greets everyone, runs the walk-in line and the phone, and closes the drawer at night.', 'Recibe a todos, maneja la fila y el teléfono, y cierra la caja en la noche.'), mfa: true, lastSeen: stamp(0, 8, 55) },
    { id: 'u7', name: 'Sam Patel', role: 'staff', email: 'sam@example.com', title: tx('Barber', 'Barbero'), languages: ['en'], officeIds: ['o1'], active: false, invitedAt: stamp(-1, 12, 10) },
  ];
  const config: CompanyConfig = {
    routing: { mode: 'round_robin', pool: ['u2', 'u3'], cursor: 0, exclude: [], skipAway: true, fallbackId: 'u1' },
    security: { idleMinutes: 30, mfaRoles: ['owner', 'manager'] },
    // open every day so the sample floor is alive whenever it is opened
    hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '19:00' },
  };
  // the split is the barber's share of what a shop client paid for the service; the owner keeps all of his own chair
  const chairs: Chair[] = [
    { id: 'ch1', label: tx('Chair 1', 'Silla 1'), staffId: 'u1', status: 'busy', walkIns: true, pay: 'commission', split: 100, ownSplit: 100, officeId: 'o1' },
    { id: 'ch2', label: tx('Chair 2', 'Silla 2'), staffId: 'u2', status: 'busy', walkIns: true, pay: 'commission', split: 60, ownSplit: 100, officeId: 'o1' },
    { id: 'ch3', label: tx('Chair 3', 'Silla 3'), staffId: 'u3', status: 'open', walkIns: true, pay: 'commission', split: 55, ownSplit: 90, officeId: 'o1' },
    { id: 'ch4', label: tx('Chair 4', 'Silla 4'), staffId: 'u4', status: 'busy', walkIns: false, pay: 'rent', split: 100, ownSplit: 100, rent: 75, officeId: 'o1' },
    { id: 'ch5', label: tx('Chair 5', 'Silla 5'), staffId: 'u5', status: 'open', walkIns: true, pay: 'commission', split: 45, ownSplit: 80, skipServiceIds: ['sv-shave'], officeId: 'o1' },
    { id: 'ch6', label: tx('Chair 6', 'Silla 6'), status: 'off', walkIns: true, pay: 'commission', split: 50, ownSplit: 90, officeId: 'o1' },
  ];
  return { users, offices, config, chairs };
}
