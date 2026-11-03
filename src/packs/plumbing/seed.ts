import type { Lang, SeedData } from '@/domain/types';
import { seedKit } from '../seedkit';

/** Sample business for the plumbing edition. Fictional data only. */
export function seed(lang: Lang): SeedData {
  const k = seedKit(lang, 'VPL-');
  const { tx } = k;

  const supply = tx('Plumbing supply house', 'Distribuidor de plomería');
  const township = tx('Township', 'Municipio');
  const insurer = 'Sample Mutual Insurance';

  /* ---------- plumbers ---------- */
  k.worker({ id: 'w1', name: 'Anthony Russo', trade: tx('Master plumber, gas certified', 'Plomero maestro, certificado en gas'), phone: '609-555-0841', email: 'anthony@example.com', payType: 'hourly', rate: 45, w9: 450 });
  k.worker({ id: 'w2', name: 'Carlos Medina', trade: tx('Journeyman plumber, service and drains', 'Plomero oficial, servicio y drenajes'), phone: '609-555-0842', email: 'carlos@example.com', payType: 'hourly', rate: 36, w9: 320 });
  k.worker({ id: 'w3', name: 'Tasha Greene', trade: tx('Journeyman plumber, backflow tester certified', 'Plomera oficial, certificada en pruebas de reflujo'), phone: '609-555-0843', email: 'tasha@example.com', payType: 'hourly', rate: 36, w9: 260 });
  k.worker({ id: 'w4', name: 'Eddie Park', trade: tx('Apprentice plumber', 'Aprendiz de plomero'), phone: '609-555-0844', email: 'eddie@example.com', payType: 'hourly', rate: 21, w9: 140 });
  k.worker({ id: 'w5', name: 'Sample Excavation LLC', trade: tx('Excavation and trenchless lining, subcontractor', 'Excavación y encamisado sin zanja, subcontratista'), phone: '609-555-0845', email: 'dig@example.com', payType: 'project', w9: 400, coi: 120, insurer });
  k.worker({ id: 'w6', name: 'Sample Drywall & Tile', trade: tx('Wall and tile patching, subcontractor', 'Resane de paredes y azulejo, subcontratista'), phone: '609-555-0846', email: 'patch@example.com', payType: 'project', w9: 230, coi: -4, insurer });
  k.worker({ id: 'w7', name: 'Ray Whitman', trade: tx('Drain technician, jetter and camera', 'Técnico de drenajes, hidrolimpiadora y cámara'), phone: '609-555-0847', email: 'ray@example.com', payType: 'hourly', rate: 30, w9: 190 });

  /* ---------- clients ---------- */
  k.client({ id: 'c1', name: 'Michelle Barnes', phone: '609-555-0801', email: 'michelle@example.com', addresses: ['21 Sample Ln, Linwood, NJ'], since: -25,
    note: tx('1960s house with galvanized pipes, low pressure upstairs. Chose the full PEX repipe. Two kids, needs water back on every night.', 'Casa de los 60 con tubería galvanizada, poca presión arriba. Escogió el cambio completo a PEX. Dos niños, necesita agua cada noche.') });
  k.client({ id: 'c2', name: 'Sample Diner', phone: '609-555-0802', email: 'diner@example.com', addresses: ['400 Sample Pike, Egg Harbor Twp, NJ'], since: -400,
    note: tx('Grease trap pumped every 90 days. Kitchen line jetted twice a year. Only before 6 am or after 10 pm.', 'La trampa de grasa se limpia cada 90 días. La línea de la cocina se hidrolimpia dos veces al año. Solo antes de las 6 am o después de las 10 pm.') });
  k.client({ id: 'c3', name: 'Kenneth Lowe', phone: '609-555-0803', email: 'kenneth@example.com', addresses: ['6 Sample Ct, Somers Point, NJ'], since: -12 });
  k.client({ id: 'c4', name: 'Sample Medical Plaza', phone: '609-555-0804', email: 'facilities.plaza@example.com', addresses: ['150 Sample Blvd, Northfield, NJ'], since: -365,
    note: tx('6 backflow devices. Yearly test reports go to the water utility before the deadline.', '6 dispositivos de reflujo. Los reportes anuales van a la compañía de agua antes de la fecha límite.') });
  k.client({ id: 'c5', name: 'Yolanda Pérez', phone: '609-555-0805', email: 'yolanda@example.com', addresses: ['3 Sample Way, Pleasantville, NJ'], since: -6,
    note: tx('Prefers Spanish. Ceiling stain under the upstairs bathroom.', 'Prefiere español. Mancha en el techo debajo del baño de arriba.') });
  k.client({ id: 'c6', name: 'Gordon Hayes', phone: '609-555-0806', email: 'gordon@example.com', addresses: ['88 Sample Rd, Margate, NJ'], since: -45,
    note: tx('Third clog in the main line this year. Big maple tree in the front yard.', 'Tercer tapón en la línea principal este año. Hay un maple grande en el jardín del frente.') });
  k.client({ id: 'c7', name: 'Sample Realty Rentals', phone: '609-555-0807', email: 'rentals@example.com', addresses: ['12 Sample Ave, Ventnor, NJ', '14 Sample Ave, Ventnor, NJ'], since: -200,
    note: tx('Property manager approves anything over $500 by email first. Tenants let us in.', 'El administrador aprueba por correo todo lo que pase de $500. Los inquilinos nos abren.') });
  k.client({ id: 'c8', name: 'Daniel Ross', phone: '609-555-0808', email: 'daniel@example.com', addresses: ['17 Sample Dr, Galloway, NJ'], since: -30 });
  k.client({ id: 'c9', name: 'Irene Novak', phone: '609-555-0809', email: 'irene@example.com', addresses: ['40 Sample St, Absecon, NJ'], since: -8, emailOptOut: true,
    note: tx('Call, do not email. Kitchen remodel with her contractor, we do the plumbing.', 'Llamar, no mandar correo. Remodelación de cocina con su contratista, nosotros hacemos la plomería.') });
  k.client({ id: 'c10', name: 'Paul Sanders', phone: '609-555-0810', email: 'paul@example.com', addresses: ['9 Sample Ter, Mays Landing, NJ'], since: -15 });

  /* ---------- jobs ---------- */
  k.job({
    id: 'j1', name: tx('Whole house PEX repipe, Barnes', 'Cambio completo de tubería a PEX, Barnes'), clientId: 'c1', type: 'repipe', status: 'progress', price: 11800, start: -1, end: 2, manager: 'u2',
    scope: tx('Replace all galvanized supply lines with PEX: 2 bathrooms, kitchen, laundry, 2 hose bibs and the water heater connections. New main shutoff and pressure reducing valve. Water back on every night. Wall openings patched, paint by others. Plumbing permit and inspection.', 'Cambiar toda la tubería galvanizada de agua por PEX: 2 baños, cocina, lavandería, 2 llaves de jardín y las conexiones del calentador. Llave de paso principal y válvula reductora de presión nuevas. Agua de regreso cada noche. Se resanan las aberturas en paredes, la pintura la hace otro. Permiso e inspección de plomería.'),
    payTerms: tx('$3,000 deposit, $4,400 at the rough inspection, balance on completion.', '$3,000 de depósito, $4,400 en la inspección preliminar, el resto al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Lead plumber', 'Plomero líder'), price: 1080, payType: 'hourly', rate: 45, qty: 24, status: 'progress' },
      { workerId: 'w4', scope: tx('Apprentice', 'Aprendiz'), price: 504, payType: 'hourly', rate: 21, qty: 24, status: 'progress' },
      { workerId: 'w6', scope: tx('Patch 9 wall openings', 'Resanar 9 aberturas en paredes'), price: 1150, payType: 'project', status: 'pending' },
    ],
    expenses: [
      { date: -4, vendor: supply, desc: tx('PEX, manifold, fittings, stub outs, PRV, shutoff', 'PEX, manifold, conexiones, salidas, válvula reductora, llave de paso'), amount: 1860 },
      { date: -3, vendor: township, desc: tx('Plumbing permit', 'Permiso de plomería'), amount: 210 },
    ],
    received: [{ date: -6, method: 'check', ref: tx('Deposit', 'Depósito'), amount: 3000 }],
    tasks: [
      { title: tx('Permit approved', 'Permiso aprobado'), who: 'u3', due: -3, status: 'done' },
      { title: tx('Day 1: main, PRV, kitchen and laundry', 'Día 1: principal, válvula reductora, cocina y lavandería'), who: 'w1', due: -1, status: 'done' },
      { title: tx('Day 2: both bathrooms, water on by 6 pm', 'Día 2: los dos baños, agua de regreso a las 6 pm'), who: 'w1', due: 0, status: 'doing', pri: 'high' },
      { title: tx('Rough inspection, then invoice $4,400', 'Inspección preliminar, luego facturar $4,400'), who: 'u3', due: 1, pri: 'high' },
      { title: tx('Book the wall patching', 'Agendar el resane de paredes'), who: 'u2', due: 2 },
    ],
    log: [{ date: -1, workerId: 'w1', text: tx('Main and PRV in, pressure set at 60 psi. Kitchen and laundry on PEX. Water back on at 5:40 pm, no leaks on the test.', 'Principal y válvula reductora instaladas, presión en 60 psi. Cocina y lavandería con PEX. Agua de regreso a las 5:40 pm, sin fugas en la prueba.') }],
    notes: [[-10, 'visit', tx('Showed her the rusted galvanized nipple we cut out. She picked PEX over copper for the price and the speed.', 'Le enseñamos el niple galvanizado oxidado que cortamos. Escogió PEX en lugar de cobre por el precio y la rapidez.')]],
  });

  k.job({
    id: 'j2', name: tx('Kitchen line jetting and grease trap, diner', 'Hidrolimpieza de la línea de cocina y trampa de grasa, restaurante'), clientId: 'c2', type: 'drain', status: 'progress', price: 2400, start: -280, end: 85, repeat: 'quarterly',
    scope: tx('Yearly service plan: grease trap pumped every 90 days, kitchen line hydro jetted twice a year with a camera check after. Manifest kept for the health department.', 'Plan anual: la trampa de grasa se limpia cada 90 días, la línea de la cocina se hidrolimpia dos veces al año con revisión de cámara después. Se guarda el manifiesto para el departamento de salud.'),
    payTerms: tx('4 quarterly payments of $600.', '4 pagos trimestrales de $600.'),
    assign: [{ workerId: 'w7', scope: tx('Jetting and camera', 'Hidrolimpieza y cámara'), price: 480, payType: 'hourly', rate: 30, qty: 16, status: 'progress' }],
    expenses: [{ date: -190, vendor: tx('Grease hauler', 'Recolector de grasa'), desc: tx('Trap pumping and disposal', 'Limpieza y disposición de la trampa'), amount: 220 }, { date: -100, vendor: tx('Grease hauler', 'Recolector de grasa'), desc: tx('Trap pumping and disposal', 'Limpieza y disposición de la trampa'), amount: 220 }],
    received: [
      { date: -280, method: 'transfer', ref: tx('Quarter 1', 'Trimestre 1'), amount: 600 },
      { date: -190, method: 'transfer', ref: tx('Quarter 2', 'Trimestre 2'), amount: 600 },
      { date: -100, method: 'transfer', ref: tx('Quarter 3', 'Trimestre 3'), amount: 600 },
    ],
    workerPays: [{ date: -95, workerId: 'w7', method: 'check', ref: '5120', amount: 240, payType: 'hourly', from: -280, to: -96 }],
    tasks: [
      { title: tx('Grease trap pumping, before 6 am', 'Limpieza de la trampa de grasa, antes de las 6 am'), who: 'w7', due: 5, pri: 'high' },
      { title: tx('Send the pumping manifest to the owner', 'Mandarle al dueño el manifiesto de la limpieza'), who: 'u3', due: 6 },
    ],
    log: [{ date: -100, workerId: 'w7', text: tx('Jetted 60 feet of kitchen line. Camera shows heavy grease at the first bend, recommend the next jetting in 4 months, not 6.', 'Hidrolimpié 60 pies de la línea de cocina. La cámara muestra mucha grasa en el primer codo, recomiendo la próxima en 4 meses, no en 6.') }],
  });

  k.job({
    id: 'j3', name: tx('Burst pipe emergency, Lowe', 'Emergencia por tubo roto, Lowe'), clientId: 'c3', type: 'emergency', status: 'done', price: 780, start: -12, end: -12,
    scope: tx('Night call, water coming through the basement ceiling. Shut off the main, replaced 4 feet of split copper with PEX and a new shutoff, pressure tested.', 'Llamada de noche, agua saliendo por el techo del sótano. Se cerró la principal, se cambiaron 4 pies de cobre partido por PEX y una llave nueva, prueba de presión.'),
    payTerms: tx('After hours emergency rate plus materials, paid on site.', 'Tarifa de emergencia fuera de horario más materiales, pagado en el sitio.'),
    assign: [{ workerId: 'w2', scope: tx('On-call plumber', 'Plomero de guardia'), price: 108, payType: 'hourly', rate: 36, qty: 3, status: 'done' }],
    expenses: [{ date: -12, vendor: supply, desc: tx('PEX, crimp rings, quarter turn valve', 'PEX, anillos, llave de cuarto de vuelta'), amount: 46 }],
    received: [{ date: -12, method: 'card', ref: tx('Paid on site', 'Pagado en el sitio'), amount: 780 }],
    workerPays: [{ date: -5, workerId: 'w2', method: 'transfer', amount: 108, payType: 'hourly', from: -12, to: -12 }],
    tasks: [{ title: tx('Photos for his insurance claim, send them tonight', 'Fotos para el reclamo del seguro, mandarlas esta noche'), who: 'w2', due: -12, status: 'done', pri: 'high' }],
    log: [{ date: -12, workerId: 'w2', text: tx('Arrived 11:15 pm. Copper split along the outside wall, it froze. Water off in 2 minutes, repaired and back on by 12:40. Told Kenneth to insulate that wall. Water heater is 14 years old with rust at the base.', 'Llegué a las 11:15 pm. El cobre se partió en la pared de afuera, se congeló. Agua cerrada en 2 minutos, reparado y de regreso a las 12:40. Le dije a Kenneth que aísle esa pared. El calentador tiene 14 años y óxido en la base.') }],
  });

  k.job({
    id: 'j4', name: tx('Yearly backflow testing, medical plaza', 'Pruebas anuales de reflujo, plaza médica'), clientId: 'c4', type: 'backflow', status: 'done', price: 690, start: -20, end: -20,
    scope: tx('Test 6 backflow prevention devices (4 RPZ, 2 double check). Report filed with the water utility.', 'Probar 6 dispositivos de prevención de reflujo (4 RPZ, 2 doble retención). Reporte entregado a la compañía de agua.'),
    payTerms: tx('$115 per device, net 15.', '$115 por dispositivo, a 15 días.'),
    assign: [{ workerId: 'w3', scope: tx('Certified tester', 'Probadora certificada'), price: 144, payType: 'hourly', rate: 36, qty: 4, status: 'done' }],
    received: [{ date: -8, method: 'check', ref: '20417', amount: 690 }],
    workerPays: [{ date: -14, workerId: 'w3', method: 'transfer', amount: 144, payType: 'hourly', from: -20, to: -20 }],
    tasks: [
      { title: tx('File the 6 reports with the water utility', 'Entregar los 6 reportes a la compañía de agua'), who: 'u3', due: -18, status: 'done', pri: 'high' },
      { title: tx('RPZ at the boiler room failed: quote the rebuild kit', 'La RPZ del cuarto de calderas falló: cotizar el kit de reparación'), who: 'u2', due: -15, status: 'done' },
    ],
    log: [{ date: -20, workerId: 'w3', text: tx('5 of 6 passed. Boiler room RPZ relief valve opened at 1.4 psi, below the minimum. Quoted the rebuild.', '5 de 6 pasaron. La válvula de alivio de la RPZ del cuarto de calderas abrió a 1.4 psi, debajo del mínimo. Se cotizó la reparación.') }],
  });

  k.job({
    id: 'j5', name: tx('Leak under the upstairs bath, Pérez', 'Fuga debajo del baño de arriba, Pérez'), clientId: 'c5', type: 'leak', status: 'done', price: 520, start: -6, end: -6,
    scope: tx('Found a leaking wax ring and a loose supply line at the upstairs toilet. Reset the toilet with a new wax ring and bolts, new braided supply, moisture reading on the ceiling.', 'Se encontró el anillo de cera con fuga y la manguera de agua floja en el inodoro de arriba. Se volvió a asentar el inodoro con anillo y tornillos nuevos, manguera trenzada nueva, lectura de humedad en el techo.'),
    payTerms: tx('Diagnostic credited to the repair. Paid on completion.', 'El diagnóstico se acredita a la reparación. Pagado al terminar.'),
    assign: [{ workerId: 'w2', scope: tx('Service call', 'Llamada de servicio'), price: 72, payType: 'hourly', rate: 36, qty: 2, status: 'done' }],
    expenses: [{ date: -6, vendor: supply, desc: tx('Wax ring, closet bolts, braided supply', 'Anillo de cera, tornillos, manguera trenzada'), amount: 24 }],
    received: [{ date: -6, method: 'zelle', amount: 520 }],
    log: [{ date: -6, workerId: 'w2', text: tx('Ceiling reads dry at the edges, wet in the middle. Told Yolanda to let it dry a week before painting.', 'El techo marca seco en las orillas y mojado en el centro. Le dije a Yolanda que lo deje secar una semana antes de pintar.') }],
  });

  k.job({
    id: 'j6', name: tx('Sewer line lining, Hayes', 'Encamisado de la línea de alcantarillado, Hayes'), clientId: 'c6', type: 'sewer', status: 'contract', price: 9400, start: 8, end: 9,
    scope: tx('Camera shows root intrusion and a cracked joint 38 feet out under the maple. Hydro jet the line, install a 45 foot trenchless liner from the cleanout, new two way cleanout at the house. Camera video before and after. Permit and 811 markout.', 'La cámara muestra raíces y una unión partida a 38 pies, debajo del maple. Hidrolimpiar la línea, instalar un encamisado sin zanja de 45 pies desde el registro, registro nuevo de dos vías en la casa. Video de la cámara antes y después. Permiso y marcado del 811.'),
    payTerms: tx('$4,700 deposit, balance on completion.', '$4,700 de depósito, el resto al terminar.'),
    assign: [
      { workerId: 'w5', scope: tx('Trenchless liner', 'Encamisado sin zanja'), price: 3900, payType: 'project', status: 'pending' },
      { workerId: 'w7', scope: tx('Jetting and camera', 'Hidrolimpieza y cámara'), price: 180, payType: 'hourly', rate: 30, qty: 6, status: 'pending' },
    ],
    received: [{ date: -3, method: 'card', ref: tx('Deposit', 'Depósito'), amount: 4700 }],
    tasks: [
      { title: tx('Call 811 for the markout', 'Llamar al 811 para el marcado'), who: 'u3', due: 1, pri: 'high' },
      { title: tx('Permit submitted, waiting on the township', 'Permiso entregado, esperando al municipio'), who: 'u3', due: 3, status: 'waiting' },
    ],
    notes: [[-5, 'visit', tx('Watched the camera video with Gordon. He chose lining over digging up the driveway.', 'Vimos el video de la cámara con Gordon. Escogió el encamisado en lugar de levantar la entrada.')]],
  });

  k.job({
    id: 'j7', name: tx('Tankless water heater, Ross', 'Calentador sin tanque, Ross'), clientId: 'c8', type: 'water_heater', status: 'estimate', price: 4850,
    scope: tx('Remove the 50 gallon tank. Install a 199,000 BTU condensing tankless unit with a new 3/4 inch gas line, PVC venting, isolation valves and a condensate neutralizer. Gas and plumbing permits.', 'Retirar el tanque de 50 galones. Instalar un calentador sin tanque de condensación de 199,000 BTU con línea de gas nueva de 3/4 de pulgada, ventilación de PVC, válvulas de aislamiento y neutralizador de condensado. Permisos de gas y de plomería.'),
    payTerms: tx('50% deposit, balance on completion.', '50% de depósito, el resto al terminar.'),
    tasks: [{ title: tx('Send Daniel the tank vs tankless comparison', 'Mandarle a Daniel la comparación de tanque y sin tanque'), who: 'u2', due: 0, status: 'doing', pri: 'high' }],
    notes: [[-2, 'visit', tx('Family of 5, runs out of hot water every morning. Gas meter is big enough for the tankless.', 'Familia de 5, se les acaba el agua caliente cada mañana. El medidor de gas alcanza para el sin tanque.')]],
  });

  k.job({
    id: 'j8', name: tx('Kitchen remodel rough-in, Novak', 'Instalación para remodelación de cocina, Novak'), clientId: 'c9', type: 'remodel', status: 'hold', price: 3600, start: -2,
    scope: tx('Move the sink to the island: new drain with an island vent, supply lines, dishwasher and fridge water line. Rough inspection, then the finish after the countertops.', 'Mover el fregadero a la isla: drenaje nuevo con ventilación de isla, líneas de agua, lavaplatos y línea de agua del refrigerador. Inspección preliminar, luego el acabado después de las cubiertas.'),
    payTerms: tx('$1,200 at rough, balance at finish.', '$1,200 en la preliminar, el resto en el acabado.'),
    assign: [{ workerId: 'w1', scope: tx('Rough-in and finish', 'Preliminar y acabado'), price: 540, payType: 'hourly', rate: 45, qty: 12, status: 'progress' }],
    tasks: [{ title: tx('Waiting on the countertops to set the finish date', 'Esperando las cubiertas para poner la fecha del acabado'), who: 'u2', due: 10, status: 'waiting' }],
    log: [{ date: -2, workerId: 'w1', text: tx('Rough-in done, inspection passed. Capped and pressure tested. Finish after the countertops are in.', 'Preliminar terminada, inspección aprobada. Tapado y con prueba de presión. El acabado después de que pongan las cubiertas.') }],
  });

  k.job({
    id: 'j9', name: tx('Rental units, toilets and faucets', 'Unidades en renta, inodoros y llaves'), clientId: 'c7', type: 'fixtures', status: 'progress', price: 1480, start: -1, end: 3, address: '14 Sample Ave, Ventnor, NJ',
    scope: tx('Replace 2 running toilets with 1.28 gpf models and 2 kitchen faucets. Check every shutoff in both units.', 'Cambiar 2 inodoros que gotean por modelos de 1.28 gpf y 2 llaves de cocina. Revisar cada llave de paso de las dos unidades.'),
    payTerms: tx('Approved by email. Invoiced on completion, net 15.', 'Aprobado por correo. Se factura al terminar, a 15 días.'),
    assign: [{ workerId: 'w2', scope: tx('Fixtures', 'Accesorios'), price: 216, payType: 'hourly', rate: 36, qty: 6, status: 'progress' }],
    expenses: [{ date: -2, vendor: supply, desc: tx('2 toilets, 2 kitchen faucets, supplies', '2 inodoros, 2 llaves de cocina, mangueras'), amount: 640 }],
    tasks: [
      { title: tx('Unit 12 done', 'Unidad 12 lista'), who: 'w2', due: -1, status: 'done' },
      { title: tx('Unit 14: tenant home after 3 pm', 'Unidad 14: el inquilino llega después de las 3 pm'), who: 'w2', due: 1 },
    ],
  });

  k.job({
    id: 'j10', name: tx('Water heater replacement, Sanders', 'Reemplazo de calentador, Sanders'), clientId: 'c10', type: 'water_heater', status: 'done', price: 2350, start: -15, end: -15,
    scope: tx('Replace the leaking 40 gallon gas water heater. New expansion tank, gas shutoff and sediment trap, venting checked. Permit and inspection.', 'Cambiar el calentador de gas de 40 galones con fuga. Tanque de expansión nuevo, llave de gas y trampa de sedimento, revisión de la ventilación. Permiso e inspección.'),
    payTerms: tx('Paid in full on completion.', 'Pagado completo al terminar.'),
    assign: [
      { workerId: 'w1', scope: tx('Install', 'Instalación'), price: 225, payType: 'hourly', rate: 45, qty: 5, status: 'done' },
      { workerId: 'w4', scope: tx('Helper', 'Ayudante'), price: 105, payType: 'hourly', rate: 21, qty: 5, status: 'done' },
    ],
    expenses: [
      { date: -15, vendor: supply, desc: tx('40 gallon gas water heater, expansion tank, fittings', 'Calentador de gas de 40 galones, tanque de expansión, conexiones'), amount: 1020 },
      { date: -15, vendor: township, desc: tx('Plumbing permit', 'Permiso de plomería'), amount: 95 },
    ],
    received: [{ date: -15, method: 'card', ref: tx('Paid in full', 'Pagado completo'), amount: 2350 }],
    workerPays: [
      { date: -8, workerId: 'w1', method: 'transfer', amount: 225, payType: 'hourly', from: -15, to: -15 },
      { date: -8, workerId: 'w4', method: 'transfer', amount: 105, payType: 'hourly', from: -15, to: -15 },
    ],
    tasks: [
      { title: tx('Final inspection passed', 'Inspección final aprobada'), who: 'u3', due: -10, status: 'done' },
      { title: tx('Register the 6 year tank warranty', 'Registrar la garantía de 6 años del tanque'), who: 'u3', due: -12, status: 'review' },
    ],
  });

  /* ---------- leads ---------- */
  k.lead({ id: 'l1', name: 'Natalie Brooks', phone: '609-555-0851', address: '30 Sample St, Ventnor, NJ', type: 'emergency', source: 'phone', status: 'new', pri: 'high', followUp: 0, created: 0,
    notes: [[0, 'call', tx('Called at 6:50 am: water spraying under the kitchen sink, she found the shutoff under the sink and closed it. Needs a plumber this morning.', 'Llamó a las 6:50 am: sale agua a chorro debajo del fregadero, encontró la llave debajo y la cerró. Necesita plomero esta mañana.')]] });
  k.lead({ id: 'l2', name: 'Victor Hale', phone: '609-555-0852', email: 'victor@example.com', address: '19 Sample Ave, Linwood, NJ', type: 'repipe', source: 'google', status: 'sent', pri: 'high', value: 13200, appt: [-7, '10:00'], followUp: 1, created: -12,
    notes: [[-12, 'note', tx('Web form: pinhole leaks in the copper, second one this year.', 'Formulario web: fugas pequeñas en el cobre, la segunda este año.')], [-6, 'email', tx('Sent the PEX and copper repipe options with the payment plan.', 'Se mandaron las opciones de cambio a PEX y a cobre con el plan de pagos.')]] });
  k.lead({ id: 'l3', name: 'Rafael Soto', phone: '609-555-0853', email: 'rafael@example.com', address: '11 Sample Way, Pleasantville, NJ', type: 'drain', source: 'facebook', status: 'new', owner: 'u3', created: 0,
    notes: [[0, 'text', tx('Message from the page: bathtub and toilet backing up together. Prefers Spanish.', 'Mensaje por la página: la tina y el inodoro se regresan al mismo tiempo. Prefiere español.')]] });
  k.lead({ id: 'l4', name: 'Sample Daycare Center', phone: '609-555-0854', email: 'daycare@example.com', address: '60 Sample Pike, Egg Harbor Twp, NJ', type: 'backflow', source: 'website', status: 'scheduled', value: 460, appt: [2, '07:00'], created: -4,
    notes: [[-4, 'note', tx('Water utility letter: 4 devices due for the yearly test this month.', 'Carta de la compañía de agua: 4 dispositivos deben hacerse la prueba anual este mes.')]] });
  k.lead({ id: 'l5', name: 'Helen Marsh', phone: '609-555-0855', email: 'helen@example.com', address: '7 Sample Ln, Somers Point, NJ', type: 'water_heater', source: 'referral', status: 'scheduled', owner: 'u2', value: 4200, appt: [0, '14:00'], created: -2,
    notes: [[-2, 'call', tx('Referred by Paul Sanders. No hot water, tank is 12 years old. Asking about tankless.', 'La recomendó Paul Sanders. Sin agua caliente, el tanque tiene 12 años. Pregunta por el sin tanque.')]] });
  k.lead({ id: 'l6', name: 'Bruno Costa', phone: '609-555-0856', address: '5 Sample Ct, Margate, NJ', type: 'sewer', source: 'phone', status: 'scheduled', value: 650, appt: [1, '09:00'], created: -3,
    notes: [[-3, 'call', tx('Basement floor drain backs up when the washer runs. Wants a camera inspection.', 'El drenaje del sótano se regresa cuando corre la lavadora. Quiere inspección con cámara.')]] });
  k.lead({ id: 'l7', name: 'Carmen Ruiz', phone: '609-555-0857', email: 'carmen@example.com', address: '23 Sample Rd, Absecon, NJ', type: 'fixtures', source: 'instagram', status: 'contacted', followUp: 2, created: -5,
    notes: [[-5, 'text', tx('Bathroom refresh: new vanity faucet, shower valve and a comfort height toilet.', 'Renovación del baño: llave del lavabo, válvula de regadera y un inodoro de altura cómoda.')]] });
  k.lead({ id: 'l8', name: 'Jerry Fox', phone: '609-555-0858', email: 'jerry@example.com', address: '70 Sample Dr, Galloway, NJ', type: 'gas', source: 'website', status: 'contacted', owner: 'u2', value: 1450, followUp: -1, created: -6,
    notes: [[-6, 'note', tx('New outdoor kitchen, needs a gas line to the grill and the fire pit.', 'Cocina exterior nueva, necesita línea de gas para el asador y el fogón.')], [-3, 'call', tx('No gas smell. Waiting on the patio contractor\'s schedule.', 'No huele a gas. Esperando la agenda del contratista del patio.')]] });
  k.lead({ id: 'l9', name: 'Gordon Hayes', phone: '609-555-0806', email: 'gordon@example.com', address: '88 Sample Rd, Margate, NJ', type: 'sewer', source: 'referral', status: 'won', pri: 'high', value: 9400, created: -15, clientId: 'c6', jobId: 'j6',
    notes: [[-15, 'call', tx('Third main line backup this year. Another company keeps snaking it.', 'Tercer tapón de la línea principal este año. Otra compañía solo la destapa con cable.')]] });
  k.lead({ id: 'l10', name: 'Michelle Barnes', phone: '609-555-0801', email: 'michelle@example.com', address: '21 Sample Ln, Linwood, NJ', type: 'repipe', source: 'google', status: 'won', owner: 'u2', value: 11800, created: -25, clientId: 'c1', jobId: 'j1',
    notes: [[-25, 'note', tx('Low water pressure upstairs, brown water in the morning.', 'Poca presión arriba, agua café en la mañana.')]] });
  k.lead({ id: 'l11', name: 'Kenneth Lowe', phone: '609-555-0803', email: 'kenneth@example.com', address: '6 Sample Ct, Somers Point, NJ', type: 'emergency', source: 'phone', status: 'won', value: 780, created: -12, clientId: 'c3', jobId: 'j3',
    notes: [[-12, 'call', tx('Called at 11 pm, water through the basement ceiling. Talked him through closing the main.', 'Llamó a las 11 pm, agua por el techo del sótano. Le explicamos por teléfono cómo cerrar la principal.')]] });
  k.lead({ id: 'l12', name: 'Doris King', phone: '609-555-0859', address: '15 Sample Ter, Mays Landing, NJ', type: 'water_heater', source: 'google', status: 'lost', value: 2100, created: -28,
    notes: [[-28, 'call', tx('Wanted a same day water heater swap on a Sunday.', 'Quería el cambio de calentador el mismo día, en domingo.')]],
    lostReason: tx('We could not do it until Monday, she went with a company that had one on the truck.', 'No podíamos hasta el lunes, se fue con una compañía que traía uno en el camión.') });
  k.lead({ id: 'l13', name: 'Leo Grant', phone: '609-555-0860', email: 'leo@example.com', address: '2 Sample St, Hammonton, NJ', type: 'leak', source: 'other', status: 'new', followUp: 0, created: -1,
    notes: [[-1, 'note', tx('Water bill doubled, meter spins with everything off. Possible slab or yard line leak.', 'El recibo del agua subió al doble, el medidor gira con todo cerrado. Posible fuga bajo el piso o en la línea del jardín.')]] });

  /* ---------- office tasks ---------- */
  k.task({ title: tx('Backflow season: call every client with devices due this month', 'Temporada de reflujo: llamar a cada cliente con dispositivos que vencen este mes'), who: 'u3', due: 1, status: 'doing', pri: 'high' });
  k.task({ title: tx('Restock the trucks: PEX, crimp rings, wax rings, cartridges, flappers', 'Reabastecer los camiones: PEX, anillos, anillos de cera, cartuchos, sapitos'), who: 'u2', due: 2 });
  k.task({ title: tx('Get a current insurance certificate from Sample Drywall & Tile', 'Pedirle a Sample Drywall & Tile un certificado de seguro vigente'), who: 'u3', due: -2, status: 'waiting', pri: 'high' });
  k.task({ title: tx('Service the jetter and test the sewer camera', 'Dar servicio a la hidrolimpiadora y probar la cámara'), who: 'w7', due: 3 });
  k.task({ title: tx('On-call schedule for the next 4 weeks', 'Calendario de guardias de las próximas 4 semanas'), who: 'u1', due: 0, status: 'review' });
  k.task({ title: tx('Camera inspection visit for Bruno Costa', 'Visita de inspección con cámara para Bruno Costa'), who: 'u1', due: 1, leadId: 'l6' });
  k.task({ title: tx('Renew the master plumber license and the general liability insurance', 'Renovar la licencia de plomero maestro y el seguro de responsabilidad civil'), who: 'u1', due: 25, pri: 'high' });
  k.task({ title: tx('Recertify the backflow test gauge', 'Recertificar el manómetro de pruebas de reflujo'), who: 'w3', due: -1, status: 'done' });
  k.task({ title: tx('Team meeting: gas safety and confined spaces', 'Junta del equipo: seguridad con gas y espacios confinados'), who: 'u1', due: 8, pri: 'low' });

  return k.finish();
}
