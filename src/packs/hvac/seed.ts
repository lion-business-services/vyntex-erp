import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for the HVAC edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VHV-');
  const { tx } = k;

  const supply = tx('HVAC supply house', 'Distribuidor de HVAC');
  const insurer = 'Sample Mutual Insurance';
  const lead608 = tx('Service technician, EPA 608 Universal', 'Técnico de servicio, EPA 608 Universal');

  /* ---------- technicians ---------- */
  k.worker({ id: 'w1', name: 'Marco Delgado', trade: tx('Lead install technician, EPA 608 Universal, NATE', 'Técnico líder de instalación, EPA 608 Universal, NATE'), phone: '609-555-0741', email: 'marco@example.com', payType: 'hourly', rate: 42, w9: 420 });
  k.worker({ id: 'w2', name: 'Jasmine Holt', trade: lead608, phone: '609-555-0742', email: 'jasmine@example.com', payType: 'hourly', rate: 36, w9: 300 });
  k.worker({ id: 'w3', name: 'Derek Shaw', trade: tx('Service technician, EPA 608 Type II', 'Técnico de servicio, EPA 608 Tipo II'), phone: '609-555-0743', email: 'derek@example.com', payType: 'hourly', rate: 32, w9: 210 });
  k.worker({ id: 'w4', name: 'Luis Ortega', trade: tx('Install helper', 'Ayudante de instalación'), phone: '609-555-0744', email: 'luis.o@example.com', payType: 'hourly', rate: 22, w9: 120 });
  k.worker({ id: 'w5', name: 'Sample Sheet Metal LLC', trade: tx('Ductwork fabrication, subcontractor', 'Fabricación de ductos, subcontratista'), phone: '609-555-0745', email: 'ducts@example.com', payType: 'project', w9: 380, coi: 140, insurer });
  k.worker({ id: 'w6', name: 'Sample Electric Co.', trade: tx('Licensed electrician, disconnects and circuits', 'Electricista con licencia, desconectores y circuitos'), phone: '609-555-0746', email: 'electric@example.com', payType: 'project', w9: 260, coi: -6, insurer });
  k.worker({ id: 'w7', name: 'Kevin Brandt', trade: tx('Commercial RTU technician, EPA 608 Universal', 'Técnico comercial de unidades de techo, EPA 608 Universal'), phone: '609-555-0747', email: 'kevin@example.com', payType: 'hourly', rate: 40, w9: 330 });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Patricia Nolan', phone: '609-555-0701', email: 'patricia@example.com', addresses: ['14 Sample Ln, Linwood, NJ'], since: -60,
    note: tx('Furnace is 19 years old. Chose the high efficiency heat pump option. Works from home, wants the install done in one day.', 'La caldera tiene 19 años. Escogió la opción de bomba de calor de alta eficiencia. Trabaja desde casa y quiere la instalación en un solo día.') });
  k.client({ id: 'c2', name: 'Omar Haddad', company: 'Sample Family Dentistry', phone: '609-555-0702', email: 'omar@example.com', addresses: ['220 Sample Ave, Northfield, NJ'], since: -300,
    note: tx('Two 5 ton rooftop units. Quarterly maintenance contract. Service only before 8 am or after 5 pm, patients in the chairs.', 'Dos unidades de techo de 5 toneladas. Contrato de mantenimiento trimestral. Servicio solo antes de las 8 am o después de las 5 pm, hay pacientes.') });
  k.client({ id: 'c3', name: 'Grace Kim', phone: '609-555-0703', email: 'grace@example.com', addresses: ['8 Sample Ct, Somers Point, NJ'], since: -20 });
  k.client({ id: 'c4', name: 'Walter Briggs', phone: '609-555-0704', email: 'walter@example.com', addresses: ['31 Sample St, Egg Harbor Twp, NJ'], since: -400,
    note: tx('Maintenance plan member since the install. Has a dog in the yard, call before going around back.', 'Miembro del plan de mantenimiento desde la instalación. Tiene un perro en el patio, llamar antes de entrar por atrás.') });
  k.client({ id: 'c5', name: 'Rosa Medina', phone: '609-555-0705', email: 'rosa@example.com', addresses: ['5 Sample Way, Pleasantville, NJ'], since: -9,
    note: tx('Prefers Spanish. Elderly mother lives with her, heating is a priority.', 'Prefiere español. Su mamá mayor vive con ella, la calefacción es prioridad.') });
  k.client({ id: 'c6', name: 'Thomas Reilly', company: 'Sample Property Group', phone: '609-555-0706', email: 'thomas@example.com', addresses: ['100 Sample Blvd, Absecon, NJ', '104 Sample Blvd, Absecon, NJ', '18 Sample Ter, Galloway, NJ'], since: -180,
    note: tx('Manages rentals. Needs a photo of the data plate and the filter on every visit for the files. Tenants schedule direct.', 'Administra rentas. Necesita foto de la placa y del filtro en cada visita para sus archivos. Los inquilinos agendan directo.') });
  k.client({ id: 'c7', name: 'Diane Foster', phone: '609-555-0707', email: 'diane@example.com', addresses: ['62 Sample Rd, Margate, NJ'], since: -35 });
  k.client({ id: 'c8', name: 'Hector Vargas', company: 'Sample Bakery', phone: '609-555-0708', email: 'hector@example.com', addresses: ['9 Sample Plaza, Hammonton, NJ'], since: -14,
    note: tx('Kitchen gets very hot, ovens run from 3 am. Wants a quote for a ductless system in the prep room.', 'La cocina se calienta mucho, los hornos prenden a las 3 am. Quiere cotización de un equipo sin ductos para el cuarto de preparación.') });
  k.client({ id: 'c9', name: 'Beverly Shaw', phone: '609-555-0709', email: 'beverly@example.com', addresses: ['27 Sample Dr, Mays Landing, NJ'], since: -5, emailOptOut: true,
    note: tx('Call, do not email. Allergies: interested in a whole home air purifier.', 'Llamar, no mandar correo. Tiene alergias: le interesa un purificador para toda la casa.') });
  k.client({ id: 'c10', name: 'Sample Charter Academy', phone: '609-555-0710', email: 'facilities.academy@example.com', addresses: ['75 Sample Pike, Galloway, NJ'], since: -90 });

  /* ---------- jobs ---------- */
  k.job({
    id: 'j1', name: tx('Heat pump replacement, Nolan', 'Reemplazo con bomba de calor, Nolan'), clientId: 'c1', type: 'install', status: 'progress', price: 14850, start: 0, end: 1, manager: 'u2',
    scope: tx('Remove the 19 year old gas furnace and AC. Install a 3 ton variable speed heat pump with electric backup, new air handler, line set, pad, disconnect and smart thermostat. Mechanical and electrical permits. 10 year parts warranty registered, 2 year labor.', 'Retirar la caldera de gas y el aire de 19 años. Instalar bomba de calor de velocidad variable de 3 toneladas con respaldo eléctrico, manejadora nueva, línea de refrigerante, base, desconector y termostato inteligente. Permisos mecánico y eléctrico. Garantía de piezas de 10 años registrada, 2 años de mano de obra.'),
    payTerms: tx('50% deposit at signing, balance on completion. Utility rebate applied by the client after the inspection.', '50% de depósito al firmar, el resto al terminar. El cliente tramita el reembolso de la compañía eléctrica después de la inspección.'),
    assign: [
      { workerId: 'w1', scope: tx('Lead installer', 'Instalador líder'), price: 672, payType: 'hourly', rate: 42, qty: 16, status: 'progress' },
      { workerId: 'w4', scope: tx('Install helper', 'Ayudante'), price: 352, payType: 'hourly', rate: 22, qty: 16, status: 'progress' },
      { workerId: 'w6', scope: tx('New 40 amp circuit and disconnect', 'Circuito nuevo de 40 amperes y desconector'), price: 850, payType: 'project', status: 'progress' },
    ],
    expenses: [
      { date: -6, vendor: supply, desc: tx('3 ton heat pump, air handler and electric heat kit', 'Bomba de calor de 3 toneladas, manejadora y kit de calor eléctrico'), amount: 6420 },
      { date: -6, vendor: supply, desc: tx('Line set, pad, thermostat, fittings', 'Línea de refrigerante, base, termostato, conexiones'), amount: 610 },
      { date: -5, vendor: tx('Township', 'Municipio'), desc: tx('Mechanical and electrical permits', 'Permisos mecánico y eléctrico'), amount: 285 },
    ],
    received: [{ date: -8, method: 'card', ref: tx('Deposit 50%', 'Depósito 50%'), amount: 7425 }],
    tasks: [
      { title: tx('Permit approved, post it on site', 'Permiso aprobado, ponerlo en el sitio'), who: 'u2', due: -2, status: 'done' },
      { title: tx('Equipment delivered to the shop, check the boxes for damage', 'Equipo entregado en el taller, revisar las cajas por daños'), who: 'w1', due: -1, status: 'done' },
      { title: tx('Install day: remove the old system and set the new one', 'Día de instalación: quitar el equipo viejo y poner el nuevo'), who: 'w1', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Commissioning readings and thermostat walkthrough with Patricia', 'Lecturas de puesta en marcha y explicarle el termostato a Patricia'), who: 'w1', due: 1 },
      { title: tx('Schedule the final inspection', 'Agendar la inspección final'), who: 'u3', due: 2 },
    ],
    log: [{ date: 0, workerId: 'w1', text: tx('Old furnace and condenser out by 10. Line set is in the old chase, new pad leveled. Electrician arriving at 1.', 'Caldera y condensador viejos fuera a las 10. La línea va por el ducto viejo, la base nueva ya está nivelada. El electricista llega a la 1.') }],
    notes: [[-12, 'visit', tx('Reviewed 3 options at the kitchen table. Picked the variable speed heat pump for the comfort and the rebate.', 'Revisamos 3 opciones en la mesa de la cocina. Escogió la bomba de calor de velocidad variable por el confort y el reembolso.')]],
  });

  k.job({
    id: 'j2', name: tx('Quarterly RTU maintenance, dental office', 'Mantenimiento trimestral de unidades de techo, consultorio dental'), clientId: 'c2', type: 'commercial', status: 'progress', price: 2600, start: -270, end: 95, repeat: 'quarterly',
    scope: tx('Two 5 ton rooftop units, 4 visits a year: filters, belts, coils, drain pans, refrigerant check, economizer and safety controls. Report with readings after each visit.', 'Dos unidades de techo de 5 toneladas, 4 visitas al año: filtros, bandas, serpentines, charolas de drenaje, revisión de refrigerante, economizador y controles de seguridad. Reporte con lecturas después de cada visita.'),
    payTerms: tx('4 quarterly payments of $650. Repairs quoted separately at the member rate.', '4 pagos trimestrales de $650. Reparaciones cotizadas aparte con tarifa de miembro.'),
    assign: [{ workerId: 'w7', scope: tx('Quarterly visits', 'Visitas trimestrales'), price: 640, payType: 'hourly', rate: 40, qty: 16, status: 'progress' }],
    expenses: [
      { date: -180, vendor: supply, desc: tx('Pleated filters and belts, 2 units', 'Filtros plisados y bandas, 2 unidades'), amount: 148 },
      { date: -90, vendor: supply, desc: tx('Pleated filters, coil cleaner', 'Filtros plisados, limpiador de serpentín'), amount: 96 },
    ],
    received: [
      { date: -270, method: 'transfer', ref: tx('Quarter 1', 'Trimestre 1'), amount: 650 },
      { date: -180, method: 'transfer', ref: tx('Quarter 2', 'Trimestre 2'), amount: 650 },
      { date: -90, method: 'transfer', ref: tx('Quarter 3', 'Trimestre 3'), amount: 650 },
    ],
    workerPays: [
      { date: -178, workerId: 'w7', method: 'check', ref: '4102', amount: 320, payType: 'hourly', from: -270, to: -179 },
      { date: -88, workerId: 'w7', method: 'check', ref: '4131', amount: 160, payType: 'hourly', from: -178, to: -89 },
    ],
    tasks: [
      { title: tx('Fall visit: heat section, gas pressure and flame sensors', 'Visita de otoño: sección de calor, presión de gas y sensores de flama'), who: 'w7', due: 4, pri: 'high' },
      { title: tx('Send Omar the quote for the worn blower motor on unit 2', 'Mandarle a Omar la cotización del motor del ventilador gastado de la unidad 2'), who: 'u2', due: 1, status: 'review' },
    ],
    log: [{ date: -90, workerId: 'w7', text: tx('Unit 2 blower motor is drawing high amps and the bearings are noisy. Recommend replacing before winter. Photos on the job.', 'El motor del ventilador de la unidad 2 jala amperaje alto y los baleros hacen ruido. Recomiendo cambiarlo antes del invierno. Fotos en el trabajo.') }],
  });

  k.job({
    id: 'j3', name: tx('No heat emergency, Medina', 'Emergencia sin calefacción, Medina'), clientId: 'c5', type: 'emergency', status: 'done', price: 485, start: -9, end: -9,
    scope: tx('Night call, no heat. Found a failed hot surface igniter and a dirty flame sensor. Replaced the igniter, cleaned the sensor, combustion test and CO reading in range.', 'Llamada de noche, sin calefacción. Se encontró el encendedor de superficie caliente dañado y el sensor de flama sucio. Se cambió el encendedor, se limpió el sensor, prueba de combustión y lectura de CO en rango.'),
    payTerms: tx('After hours diagnostic plus repair, paid on site.', 'Diagnóstico fuera de horario más la reparación, pagado en el sitio.'),
    assign: [{ workerId: 'w2', scope: tx('On-call technician', 'Técnico de guardia'), price: 108, payType: 'hourly', rate: 36, qty: 3, status: 'done' }],
    expenses: [{ date: -9, vendor: supply, desc: tx('Hot surface igniter', 'Encendedor de superficie caliente'), amount: 62 }],
    received: [{ date: -9, method: 'card', ref: tx('Paid on site', 'Pagado en el sitio'), amount: 485 }],
    workerPays: [{ date: -2, workerId: 'w2', method: 'transfer', amount: 108, payType: 'hourly', from: -9, to: -9 }],
    tasks: [
      { title: tx('Combustion and CO check, record the readings', 'Revisión de combustión y CO, anotar las lecturas'), who: 'w2', due: -9, status: 'done', pri: 'high' },
      { title: tx('Offer the maintenance plan to Rosa', 'Ofrecerle el plan de mantenimiento a Rosa'), who: 'u3', due: -6, status: 'done' },
    ],
    log: [{ date: -9, workerId: 'w2', text: tx('Arrived 9:40 pm. Igniter cracked. Heat back on at 10:25. CO at the flue in range, no CO in the living space. Furnace is 15 years old, told Rosa about replacement options.', 'Llegué a las 9:40 pm. Encendedor quebrado. Calefacción funcionando a las 10:25. CO en la chimenea en rango, nada de CO en la casa. La caldera tiene 15 años, le comenté a Rosa las opciones de reemplazo.') }],
  });

  k.job({
    id: 'j4', name: tx('Spring tune-up, Briggs (plan member)', 'Mantenimiento de primavera, Briggs (miembro del plan)'), clientId: 'c4', type: 'maintenance', status: 'done', price: 189, start: -21, end: -21,
    scope: tx('Maintenance plan visit: cooling tune-up, refrigerant pressures, capacitor test, drain line flush, filter replaced.', 'Visita del plan de mantenimiento: revisión de aire acondicionado, presiones de refrigerante, prueba del capacitor, limpieza de la línea de drenaje, cambio de filtro.'),
    payTerms: tx('Covered by the plan, $189 per year paid at renewal.', 'Cubierto por el plan, $189 al año pagado en la renovación.'),
    assign: [{ workerId: 'w3', scope: tx('Tune-up', 'Mantenimiento'), price: 48, payType: 'hourly', rate: 32, qty: 1.5, status: 'done' }],
    expenses: [{ date: -21, vendor: supply, desc: tx('Filter 16x25x1, drain tablets', 'Filtro 16x25x1, pastillas para drenaje'), amount: 18 }],
    received: [{ date: -60, method: 'card', ref: tx('Plan renewal', 'Renovación del plan'), amount: 189 }],
    workerPays: [{ date: -14, workerId: 'w3', method: 'transfer', amount: 48, payType: 'hourly', from: -21, to: -21 }],
    tasks: [{ title: tx('Run capacitor is weak (32 of 45 µF): quote the replacement', 'El capacitor está débil (32 de 45 µF): cotizar el cambio'), who: 'u2', due: -18, status: 'done' }],
    log: [{ date: -21, workerId: 'w3', text: tx('System cooling well, 19 degree split. Capacitor reading low, quoted it at the member price. Drain line was slow, flushed it.', 'El equipo enfría bien, 19 grados de diferencia. El capacitor salió bajo, se cotizó con precio de miembro. La línea de drenaje estaba lenta, se limpió.') }],
  });

  k.job({
    id: 'j5', name: tx('AC not cooling, Kim', 'El aire no enfría, Kim'), clientId: 'c3', type: 'ac_repair', status: 'done', price: 640, start: -18, end: -18,
    scope: tx('Diagnosed a failed dual run capacitor and a small leak at the service valve. Replaced the capacitor, repaired the valve core, recovered and recharged 2 lb of R-410A.', 'Se diagnosticó el capacitor doble dañado y una fuga chica en la válvula de servicio. Se cambió el capacitor, se reparó el núcleo de la válvula, se recuperaron y recargaron 2 lb de R-410A.'),
    payTerms: tx('Diagnostic credited to the repair. Paid on completion.', 'El diagnóstico se acredita a la reparación. Pagado al terminar.'),
    assign: [{ workerId: 'w3', scope: tx('Service call', 'Llamada de servicio'), price: 80, payType: 'hourly', rate: 32, qty: 2.5, status: 'done' }],
    expenses: [{ date: -18, vendor: supply, desc: tx('Dual run capacitor, valve cores, R-410A', 'Capacitor doble, núcleos de válvula, R-410A'), amount: 138 }],
    received: [{ date: -18, method: 'card', amount: 640 }],
    workerPays: [{ date: -14, workerId: 'w3', method: 'transfer', amount: 80, payType: 'hourly', from: -18, to: -18 }],
    tasks: [{ title: tx('Refrigerant log: 2 lb R-410A recovered and recharged', 'Registro de refrigerante: 2 lb de R-410A recuperadas y recargadas'), who: 'w3', due: -18, status: 'done', pri: 'high' }],
    log: [{ date: -18, workerId: 'w3', text: tx('Capacitor bulged, compressor not starting. Found the leak at the suction service valve with the electronic detector. Cooling 18 degree split after the repair.', 'Capacitor inflado, el compresor no arrancaba. Encontré la fuga en la válvula de servicio de succión con el detector electrónico. Después de la reparación enfría con 18 grados de diferencia.') }],
  });

  k.job({
    id: 'j6', name: tx('Ductless mini-split, bakery prep room', 'Mini-split sin ductos, cuarto de preparación de la panadería'), clientId: 'c8', type: 'heat_pump', status: 'estimate', price: 6980,
    scope: tx('Supply and install a 24,000 BTU ductless mini-split in the prep room, high wall head, condensate pump, line hide, dedicated circuit. Commercial permit.', 'Suministrar e instalar un mini-split sin ductos de 24,000 BTU en el cuarto de preparación, unidad de pared alta, bomba de condensado, cubierta para la línea, circuito dedicado. Permiso comercial.'),
    payTerms: tx('50% deposit, balance on completion.', '50% de depósito, el resto al terminar.'),
    tasks: [{ title: tx('Send Hector the quote with the 18,000 and 24,000 BTU options', 'Mandarle a Hector la cotización con las opciones de 18,000 y 24,000 BTU'), who: 'u2', due: 0, status: 'doing', pri: 'high' }],
    notes: [[-3, 'visit', tx('Measured the prep room. Ovens add a lot of heat, the load calculation says 24,000 BTU. He wants it before summer.', 'Se midió el cuarto de preparación. Los hornos dan mucho calor, el cálculo de carga pide 24,000 BTU. Lo quiere antes del verano.')]],
  });

  k.job({
    id: 'j7', name: tx('Duct sealing and new returns, Foster', 'Sellado de ductos y retornos nuevos, Foster'), clientId: 'c7', type: 'ductwork', status: 'contract', price: 3950, start: 6, end: 7,
    scope: tx('Upstairs bedrooms run 6 degrees hotter. Add two returns upstairs, seal the trunk and the boots with mastic, balance the dampers. Before and after airflow readings.', 'Los cuartos de arriba están 6 grados más calientes. Agregar dos retornos arriba, sellar el ducto principal y las salidas con mastique, balancear las compuertas. Lecturas de flujo de aire antes y después.'),
    payTerms: tx('$1,000 deposit, balance on completion.', '$1,000 de depósito, el resto al terminar.'),
    assign: [{ workerId: 'w5', scope: tx('Fabricate and install the returns', 'Fabricar e instalar los retornos'), price: 1400, payType: 'project', status: 'pending' }],
    received: [{ date: -2, method: 'check', ref: '1187', amount: 1000 }],
    tasks: [
      { title: tx('Sheet metal: confirm the return sizes and the install date', 'Lámina: confirmar las medidas de los retornos y la fecha'), who: 'u2', due: 2, status: 'waiting' },
      { title: tx('Before readings: static pressure and room temperatures', 'Lecturas de antes: presión estática y temperaturas por cuarto'), who: 'w2', due: 5 },
    ],
  });

  k.job({
    id: 'j8', name: tx('Rental units, fall heating checks', 'Unidades en renta, revisión de calefacción de otoño'), clientId: 'c6', type: 'maintenance', status: 'progress', price: 1350, start: -3, end: 10,
    scope: tx('Heating check on 3 rental units: burners, flame sensor, igniter, heat exchanger inspection, CO test, filters. Photo of every data plate and filter for the owner\'s files.', 'Revisión de calefacción en 3 unidades en renta: quemadores, sensor de flama, encendedor, inspección del intercambiador, prueba de CO, filtros. Foto de cada placa y filtro para los archivos del dueño.'),
    payTerms: tx('$450 per unit, invoiced when all 3 are done.', '$450 por unidad, se factura cuando estén las 3.'),
    assign: [{ workerId: 'w3', scope: tx('3 heating checks', '3 revisiones de calefacción'), price: 192, payType: 'hourly', rate: 32, qty: 6, status: 'progress' }],
    tasks: [
      { title: tx('Unit 100: done, photos uploaded', 'Unidad 100: lista, fotos subidas'), who: 'w3', due: -3, status: 'done' },
      { title: tx('Unit 104: tenant reschedule, call to confirm', 'Unidad 104: el inquilino cambió la cita, llamar para confirmar'), who: 'u3', due: 0, pri: 'high' },
      { title: tx('Unit 18 Galloway', 'Unidad 18 Galloway'), who: 'w3', due: 3 },
    ],
    log: [{ date: -3, workerId: 'w3', text: tx('Unit 100 good. Filter was very dirty, told Thomas the tenants should change it every 2 months.', 'Unidad 100 bien. El filtro estaba muy sucio, le dije a Thomas que los inquilinos lo cambien cada 2 meses.') }],
  });

  k.job({
    id: 'j9', name: tx('Whole home air purifier, Shaw', 'Purificador de aire para toda la casa, Shaw'), clientId: 'c9', type: 'iaq', status: 'estimate', price: 2450,
    scope: tx('Install a whole home media air cleaner (MERV 13) and a UV light at the air handler. Check the return for leaks.', 'Instalar un filtro de aire para toda la casa (MERV 13) y una luz UV en la manejadora. Revisar el retorno por fugas.'),
    payTerms: tx('Paid on completion.', 'Pagado al terminar.'),
    notes: [[-5, 'call', tx('Bad allergies in the spring. Does not want email, call her with the options.', 'Alergias fuertes en primavera. No quiere correo, hay que llamarla con las opciones.')]],
  });

  k.job({
    id: 'j10', name: tx('Boiler no heat, school gym', 'Caldera sin calefacción, gimnasio de la escuela'), clientId: 'c10', type: 'heat_repair', status: 'hold', price: 3200, start: -4,
    scope: tx('Gym boiler locks out on flame failure. Replace the flame rod and the ignition control module. Waiting on the module from the manufacturer.', 'La caldera del gimnasio se bloquea por falla de flama. Cambiar la varilla de flama y el módulo de control de encendido. Esperando el módulo del fabricante.'),
    payTerms: tx('Purchase order from the school, net 30.', 'Orden de compra de la escuela, a 30 días.'),
    assign: [{ workerId: 'w7', scope: tx('Diagnosis and repair', 'Diagnóstico y reparación'), price: 320, payType: 'hourly', rate: 40, qty: 8, status: 'pending' }],
    tasks: [{ title: tx('Module on backorder: call the supply house for the ship date', 'Módulo agotado: llamar al distribuidor por la fecha de envío'), who: 'u2', due: 1, status: 'waiting', pri: 'high' }],
    log: [{ date: -4, workerId: 'w7', text: tx('Flame signal drops after 20 seconds. Flame rod is cracked and the control module shows a fault code. Gym is on the portable heaters for now.', 'La señal de flama baja a los 20 segundos. La varilla está quebrada y el módulo marca código de falla. Por ahora el gimnasio está con calentadores portátiles.') }],
  });

  k.job({
    id: 'j11', name: tx('AC replacement, Reilly rental', 'Reemplazo de aire, renta de Reilly'), clientId: 'c6', type: 'install', status: 'done', price: 7200, start: -40, end: -39, address: '18 Sample Ter, Galloway, NJ',
    scope: tx('Replace the failed 2.5 ton condenser and evaporator coil. New line set, pad and disconnect. Permit and inspection.', 'Cambiar el condensador de 2.5 toneladas y el serpentín que fallaron. Línea nueva, base y desconector. Permiso e inspección.'),
    payTerms: tx('Paid in full on completion.', 'Pagado completo al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Lead installer', 'Instalador líder'), price: 504, payType: 'hourly', rate: 42, qty: 12, status: 'done' },
      { workerId: 'w4', scope: tx('Helper', 'Ayudante'), price: 264, payType: 'hourly', rate: 22, qty: 12, status: 'done' },
    ],
    expenses: [
      { date: -42, vendor: supply, desc: tx('2.5 ton condenser and coil', 'Condensador y serpentín de 2.5 toneladas'), amount: 3180 },
      { date: -41, vendor: tx('Township', 'Municipio'), desc: tx('Mechanical permit', 'Permiso mecánico'), amount: 140 },
    ],
    received: [{ date: -37, method: 'transfer', ref: tx('Paid in full', 'Pagado completo'), amount: 7200 }],
    workerPays: [
      { date: -35, workerId: 'w1', method: 'transfer', amount: 504, payType: 'hourly', from: -40, to: -39 },
      { date: -35, workerId: 'w4', method: 'transfer', amount: 264, payType: 'hourly', from: -40, to: -39 },
    ],
    tasks: [
      { title: tx('Final inspection passed', 'Inspección final aprobada'), who: 'u3', due: -33, status: 'done' },
      { title: tx('Register the 10 year parts warranty', 'Registrar la garantía de piezas de 10 años'), who: 'u3', due: -36, status: 'done' },
    ],
  });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Samuel Ortiz', phone: '609-555-0751', address: '40 Sample St, Ventnor, NJ', type: 'emergency', source: 'phone', status: 'new', pri: 'high', followUp: 0, created: 0,
    notes: [[0, 'call', tx('Called at 7:10 am: furnace blowing cold air, two kids at home. Needs someone this morning.', 'Llamó a las 7:10 am: la caldera echa aire frío, dos niños en casa. Necesita a alguien esta mañana.')]] });
  k.lead({ id: 'l2', name: 'Linda Carver', phone: '609-555-0752', email: 'linda@example.com', address: '12 Sample Ave, Linwood, NJ', type: 'install', source: 'google', status: 'sent', pri: 'high', value: 12400, appt: [-6, '10:00'], followUp: 1, created: -10,
    notes: [[-10, 'note', tx('Web form: 22 year old AC and furnace, high electric bills. Wants to compare a heat pump.', 'Formulario web: aire y caldera de 22 años, recibos de luz altos. Quiere comparar con bomba de calor.')], [-5, 'email', tx('Sent 3 options: standard, high efficiency and heat pump, with the rebates and the monthly payment.', 'Se mandaron 3 opciones: estándar, alta eficiencia y bomba de calor, con los reembolsos y el pago mensual.')]] });
  k.lead({ id: 'l3', name: 'Ernesto Ruiz', phone: '609-555-0753', email: 'ernesto@example.com', address: '7 Sample Way, Pleasantville, NJ', type: 'heat_repair', source: 'facebook', status: 'new', owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Message from the page: furnace makes a loud bang when it starts. Prefers Spanish.', 'Mensaje por la página: la caldera truena fuerte al prender. Prefiere español.')]] });
  k.lead({ id: 'l4', name: 'Sample Fitness Studio', phone: '609-555-0754', email: 'studio@example.com', address: '300 Sample Pike, Egg Harbor Twp, NJ', type: 'commercial', source: 'website', status: 'scheduled', pri: 'high', value: 18500, appt: [1, '07:30'], created: -4,
    notes: [[-4, 'note', tx('Two old rooftop units, one down. Classes start at 6 am. Wants a replacement price and a maintenance contract.', 'Dos unidades de techo viejas, una sin funcionar. Las clases empiezan a las 6 am. Quiere precio de reemplazo y contrato de mantenimiento.')]] });
  k.lead({ id: 'l5', name: 'Janet Price', phone: '609-555-0755', email: 'janet@example.com', address: '55 Sample Ln, Somers Point, NJ', type: 'heat_pump', source: 'referral', status: 'scheduled', owner: 'u2', value: 5900, appt: [0, '15:00'], created: -3,
    notes: [[-3, 'call', tx('Referred by Patricia Nolan. Sunroom addition with no heat or AC, asking about a mini-split.', 'La recomendó Patricia Nolan. Cuarto de sol nuevo sin calefacción ni aire, pregunta por un mini-split.')]] });
  k.lead({ id: 'l6', name: 'Frank DiMaio', phone: '609-555-0756', address: '3 Sample Ct, Margate, NJ', type: 'maintenance', source: 'phone', status: 'contacted', followUp: -1, created: -6,
    notes: [[-6, 'call', tx('Wants a fall tune-up and asked about the maintenance plan price.', 'Quiere mantenimiento de otoño y preguntó el precio del plan.')], [-3, 'call', tx('Left a voicemail with two open times.', 'Se le dejó mensaje de voz con dos horarios disponibles.')]] });
  k.lead({ id: 'l7', name: 'Alicia Grant', phone: '609-555-0757', email: 'alicia@example.com', address: '19 Sample Rd, Absecon, NJ', type: 'iaq', source: 'instagram', status: 'contacted', followUp: 2, created: -5,
    notes: [[-5, 'text', tx('New baby, wants cleaner air and asked about humidifiers for the winter.', 'Bebé recién nacido, quiere aire más limpio y preguntó por humidificadores para el invierno.')]] });
  k.lead({ id: 'l8', name: 'Robert Chen', phone: '609-555-0758', email: 'robert@example.com', address: '80 Sample Dr, Galloway, NJ', type: 'ductwork', source: 'website', status: 'sent', owner: 'u2', value: 4300, appt: [-9, '11:00'], followUp: 3, created: -14,
    notes: [[-14, 'note', tx('Finished basement, no heat down there. Wants supply and return runs added.', 'Sótano terminado, sin calefacción. Quiere salidas y retornos nuevos.')]] });
  k.lead({ id: 'l9', name: 'Sample Charter Academy', phone: '609-555-0710', email: 'facilities.academy@example.com', address: '75 Sample Pike, Galloway, NJ', type: 'heat_repair', source: 'referral', status: 'won', pri: 'high', value: 3200, created: -5, clientId: 'c10', jobId: 'j10',
    notes: [[-5, 'call', tx('Gym boiler down before a home game. Their usual contractor could not come for a week.', 'La caldera del gimnasio falló antes de un partido en casa. Su contratista de siempre no podía venir en una semana.')]] });
  k.lead({ id: 'l10', name: 'Patricia Nolan', phone: '609-555-0701', email: 'patricia@example.com', address: '14 Sample Ln, Linwood, NJ', type: 'install', source: 'google', status: 'won', owner: 'u2', value: 14850, created: -20, clientId: 'c1', jobId: 'j1',
    notes: [[-20, 'note', tx('Furnace keeps short cycling, tech said the heat exchanger is near the end.', 'La caldera prende y apaga seguido, el técnico dijo que el intercambiador ya está por terminar.')]] });
  k.lead({ id: 'l11', name: 'Rosa Medina', phone: '609-555-0705', email: 'rosa@example.com', address: '5 Sample Way, Pleasantville, NJ', type: 'emergency', source: 'phone', status: 'won', value: 485, created: -9, clientId: 'c5', jobId: 'j3',
    notes: [[-9, 'call', tx('Called at 9 pm, no heat, elderly mother at home. Dispatched the on-call tech.', 'Llamó a las 9 pm, sin calefacción, mamá mayor en casa. Se envió al técnico de guardia.')]] });
  k.lead({ id: 'l12', name: 'Gloria Watts', phone: '609-555-0759', address: '22 Sample Ter, Mays Landing, NJ', type: 'install', source: 'google', status: 'lost', value: 9800, created: -30,
    notes: [[-30, 'call', tx('Wanted the lowest price for a new AC only.', 'Quería el precio más bajo solo por un aire nuevo.')]],
    lostReason: tx('Went with a lower bid that did not include the permit or a load calculation.', 'Se fue con una cotización más baja que no incluía permiso ni cálculo de carga.') });
  k.lead({ id: 'l13', name: 'Mike Lawson', phone: '609-555-0760', email: 'mike@example.com', address: '9 Sample St, Hammonton, NJ', type: 'ac_repair', source: 'other', status: 'new', followUp: 0, created: -1,
    notes: [[-1, 'note', tx('Outdoor unit humming but the fan does not spin. Probably the capacitor or the fan motor.', 'La unidad de afuera zumba pero el ventilador no gira. Probablemente el capacitor o el motor del ventilador.')]] });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Fall tune-up campaign: call every plan member to book', 'Campaña de mantenimiento de otoño: llamar a cada miembro del plan para agendar'), who: 'u3', due: 1, status: 'doing', pri: 'high' });
  k.task({ title: tx('Restock the trucks: capacitors, contactors, igniters, flame sensors, filters', 'Reabastecer los camiones: capacitores, contactores, encendedores, sensores de flama, filtros'), who: 'u2', due: 2 });
  k.task({ title: tx('Get a current insurance certificate from Sample Electric Co.', 'Pedirle a Sample Electric Co. un certificado de seguro vigente'), who: 'u3', due: -2, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Monthly refrigerant inventory: cylinders in, recovered, sent for reclaim', 'Inventario mensual de refrigerante: cilindros que entran, recuperados, enviados a reciclaje'), who: 'u2', due: 4, pri: 'high' });
  k.task({ title: tx('On-call schedule for the next 4 weeks', 'Calendario de guardias de las próximas 4 semanas'), who: 'u1', due: 0, status: 'review' });
  k.task({ title: tx('Site visit for the fitness studio rooftop units', 'Visita al estudio de ejercicio por las unidades de techo'), who: 'u1', due: 1, leadId: 'l4' });
  k.task({ title: tx('Renew the contractor license and the general liability insurance', 'Renovar la licencia de contratista y el seguro de responsabilidad civil'), who: 'u1', due: 25, pri: 'high' });
  k.task({ title: tx('Team meeting: carbon monoxide safety and the new combustion analyzer', 'Junta del equipo: seguridad de monóxido de carbono y el analizador de combustión nuevo'), who: 'u1', due: 8, pri: 'low' });
  k.task({ title: tx('Calibrate the combustion analyzer', 'Calibrar el analizador de combustión'), who: 'w2', due: -1, status: 'done' });

  return k.finish();
}
