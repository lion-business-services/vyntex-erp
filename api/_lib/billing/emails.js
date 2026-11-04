// The billing emails, in English and Spanish in one message (the server does not know which language the owner reads).
// Plain text, no amounts invented: every figure comes from Stripe's event or the pricing file. No link points anywhere
// but this site (the owner pays from the Billing page of their workspace, where the server makes a fresh Stripe link).
const usd = (cents) => (typeof cents === 'number' && Number.isFinite(cents) ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null);
const day = (v) => {
  const d = typeof v === 'number' ? new Date(v * 1000) : v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : null;
};
const dayEs = (v) => {
  const d = typeof v === 'number' ? new Date(v * 1000) : v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('es-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : null;
};
const CONTACT_EN = 'Questions? Call or WhatsApp 609-780-3218, or write to info@vyntexusa.com.';
const CONTACT_ES = '¿Preguntas? Llame o escriba por WhatsApp al 609-780-3218, o escriba a info@vyntexusa.com.';

/** kind: subscribed | renewed | payment_failed | paused | ended | cancel_scheduled | refunded | disputed | trial_3d | trial_1d | trial_ended
 *  | trial_started | trial_skipped | trial_card_reused | charge_3d | charge_1d (the card-on-file trial, 0082) */
export function billingEmail(kind, f) {
  const c = f.company || {};
  const name = c.name || 'your company';
  const link = f.origin && c.slug ? `${f.origin}/${c.slug}/settings/billing` : null;
  if (f.audience !== 'owner') {
    // to VYNTEX: one line of facts, for the team's inbox
    const facts = [`Company: ${c.name || '?'} (${c.slug || '?'})`, `Plan now: ${c.plan || '?'} / status ${c.status || '?'}`];
    const amount = usd(f.amount ?? f.total);
    if (amount) facts.push(`Amount: ${amount}`);
    if (f.plan) facts.push(`Plan bought: ${f.plan} (${f.billing || '?'})`);
    if (f.grace) facts.push(`Grace period until: ${day(f.grace)}`);
    if (f.until) facts.push(`Ends: ${day(f.until)}`);
    if (f.at) facts.push(`Date: ${day(f.at)}`);
    const subjects = {
      subscribed: `New subscription: ${name}`, renewed: `Payment received: ${name}`, payment_failed: `Payment failed: ${name}`,
      paused: `Workspace paused for non-payment: ${name}`, ended: `Subscription ended: ${name}`, cancel_scheduled: `Cancellation scheduled: ${name}`,
      refunded: `Refund issued: ${name}`, disputed: `Payment disputed: ${name}`, trial_ended: `Trial ended without a plan: ${name}`,
      trial_started: `Trial started with a card on file: ${name}`, trial_skipped: `Card already had a trial, plan started today: ${name}`,
      trial_card_reused: `Trial refused, card already used for a trial: ${name}`,
    };
    if (!subjects[kind]) return null;
    return { subject: `[VYNTEX ERP billing] ${subjects[kind]}`, text: [...facts, '', 'Operator console: ' + (f.origin ? f.origin + '/admin' : '/admin'), ''].join('\n') };
  }
  const go = link ? [`Open your billing page: ${link}`, `Abra su página de facturación: ${link}`] : ['', ''];
  const T = {
    subscribed: {
      subject: `Welcome to VYNTEX ERP, ${name} / Bienvenido a VYNTEX ERP`,
      en: [`Thank you. The subscription for ${name} is active${f.total ? ` and your first payment of ${usd(f.total)} was received` : ''}.`, 'Stripe sends the receipt separately. You can see invoices and update your payment method from the billing page of your workspace.'],
      es: [`Gracias. La suscripción de ${name} está activa${f.total ? ` y recibimos su primer pago de ${usd(f.total)}` : ''}.`, 'Stripe envía el recibo por separado. Puede ver sus facturas y cambiar su forma de pago desde la página de facturación de su espacio.'],
    },
    payment_failed: {
      subject: `Action needed: payment for ${name} did not go through / Acción necesaria: el pago no se procesó`,
      en: [`We could not collect the payment${f.amount ? ` of ${usd(f.amount)}` : ''} for ${name}.`, `Please update your card or bank account${f.grace ? ` before ${day(f.grace)}` : ' within 7 days'} to keep your workspace open. Stripe will try again automatically.`],
      es: [`No pudimos cobrar el pago${f.amount ? ` de ${usd(f.amount)}` : ''} de ${name}.`, `Por favor actualice su tarjeta o cuenta bancaria${f.grace ? ` antes del ${dayEs(f.grace)}` : ' en los próximos 7 días'} para mantener su espacio abierto. Stripe volverá a intentarlo automáticamente.`],
    },
    paused: {
      subject: `${name} is paused / ${name} está en pausa`,
      en: [`The workspace of ${name} is paused because the payment could not be collected. Every record is kept.`, 'Sign in and pay from the billing page to open it again right away.'],
      es: [`El espacio de ${name} está en pausa porque no se pudo cobrar el pago. Todos sus registros se conservan.`, 'Inicie sesión y pague desde la página de facturación para abrirlo de nuevo al instante.'],
    },
    ended: {
      subject: `Your VYNTEX ERP subscription ended / Su suscripción terminó`,
      en: [`The subscription of ${name} has ended and the workspace is paused. Every record is kept.`, 'You can subscribe again at any time from the billing page.'],
      es: [`La suscripción de ${name} terminó y el espacio está en pausa. Todos sus registros se conservan.`, 'Puede suscribirse de nuevo cuando quiera desde la página de facturación.'],
    },
    trial_started: f.quoted ? {
      subject: `Your 7-day free trial has started / Su prueba gratuita de 7 días comenzó`,
      en: [`Your card is on file and the 7-day free trial of ${name} is open. Nothing was charged.`, `The trial ends${day(f.at) ? ' on ' + day(f.at) : ' in 7 days'}. VYNTEX will send your quote before then; nothing is charged without your approval.`],
      es: [`Su tarjeta quedó registrada y la prueba gratuita de 7 días de ${name} está abierta. No se cobró nada.`, `La prueba termina${dayEs(f.at) ? ' el ' + dayEs(f.at) : ' en 7 días'}. VYNTEX le enviará su cotización antes; no se cobra nada sin su aprobación.`],
    } : {
      subject: `Your 7-day free trial has started / Su prueba gratuita de 7 días comenzó`,
      en: [`Your 7-day free trial of ${f.planName || 'VYNTEX ERP'} for ${name} is open. Today's charge: $0.00.`, `Your trial ends${day(f.at) ? ' on ' + day(f.at) : ' in 7 days'}. Then your plan starts automatically${usd(f.amount) ? ` at ${usd(f.amount)} ${f.billing === 'yearly' ? 'a year' : 'a month'}` : ''}, charged to the card you added, unless you cancel before that date.`, 'You can cancel or change your plan at any time from the billing page. We will remind you 3 days and 1 day before the first charge.'],
      es: [`Su prueba gratuita de 7 días de ${f.planName || 'VYNTEX ERP'} para ${name} está abierta. Cargo de hoy: $0.00.`, `Su prueba termina${dayEs(f.at) ? ' el ' + dayEs(f.at) : ' en 7 días'}. Después su plan comienza automáticamente${usd(f.amount) ? ` a ${usd(f.amount)} ${f.billing === 'yearly' ? 'al año' : 'al mes'}` : ''}, con cargo a la tarjeta que agregó, a menos que cancele antes de esa fecha.`, 'Puede cancelar o cambiar su plan cuando quiera desde la página de facturación. Le recordaremos 3 días y 1 día antes del primer cargo.'],
    },
    trial_skipped: {
      subject: `Your VYNTEX ERP plan has started / Su plan de VYNTEX ERP comenzó`,
      en: [`This card was already used for a free trial of VYNTEX ERP, and each card gets one trial. Your plan for ${name} started today${usd(f.amount) ? ` at ${usd(f.amount)} ${f.billing === 'yearly' ? 'a year' : 'a month'}` : ''}.`, 'If you think this is a mistake, contact us and we will review it right away. You can cancel at any time from the billing page.'],
      es: [`Esta tarjeta ya se usó para una prueba gratuita de VYNTEX ERP y cada tarjeta tiene una sola prueba. Su plan para ${name} comenzó hoy${usd(f.amount) ? ` a ${usd(f.amount)} ${f.billing === 'yearly' ? 'al año' : 'al mes'}` : ''}.`, 'Si cree que es un error, contáctenos y lo revisamos de inmediato. Puede cancelar cuando quiera desde la página de facturación.'],
    },
    trial_card_reused: {
      subject: `About your VYNTEX ERP trial / Sobre su prueba de VYNTEX ERP`,
      en: [`This card was already used for a free trial of VYNTEX ERP, so the trial for ${name} could not start. Nothing was charged.`, 'Contact us and we will set up your workspace with you.'],
      es: [`Esta tarjeta ya se usó para una prueba gratuita de VYNTEX ERP, por lo que la prueba de ${name} no pudo comenzar. No se cobró nada.`, 'Contáctenos y configuramos su espacio con usted.'],
    },
    charge_3d: {
      subject: `Your free trial ends ${day(f.at) ? 'on ' + day(f.at) : 'soon'} / Su prueba gratuita termina pronto`,
      en: [`Your free trial of ${f.planName || 'VYNTEX ERP'} for ${name} ends${day(f.at) ? ' on ' + day(f.at) : ' in a few days'}.`, `On that date your plan starts and your card is charged${usd(f.amount) ? ` ${usd(f.amount)} ${f.billing === 'yearly' ? 'for the year' : 'for the month'}` : ''}. Nothing else to do to keep working.`, 'To cancel or change your plan before then, open the billing page.'],
      es: [`Su prueba gratuita de ${f.planName || 'VYNTEX ERP'} para ${name} termina${dayEs(f.at) ? ' el ' + dayEs(f.at) : ' en unos días'}.`, `Ese día comienza su plan y se hace el cargo a su tarjeta${usd(f.amount) ? ` de ${usd(f.amount)} ${f.billing === 'yearly' ? 'por el año' : 'por el mes'}` : ''}. No necesita hacer nada más para seguir trabajando.`, 'Para cancelar o cambiar su plan antes, abra la página de facturación.'],
    },
    charge_1d: {
      subject: `Your plan starts tomorrow / Su plan comienza mañana`,
      en: [`Your free trial for ${name} ends within 24 hours. Your card will then be charged${usd(f.amount) ? ` ${usd(f.amount)}` : ''} for ${f.planName || 'your plan'}.`, 'To cancel or change your plan, open the billing page today.'],
      es: [`Su prueba gratuita de ${name} termina en menos de 24 horas. Después se hará el cargo a su tarjeta${usd(f.amount) ? ` de ${usd(f.amount)}` : ''} por ${f.planName || 'su plan'}.`, 'Para cancelar o cambiar su plan, abra hoy la página de facturación.'],
    },
    trial_3d: {
      subject: `Your free trial ends ${day(f.at) ? 'on ' + day(f.at) : 'soon'} / Su prueba gratuita termina pronto`,
      en: [`Your 7-day trial of VYNTEX ERP for ${name} ends${day(f.at) ? ' on ' + day(f.at) : ' in a few days'}.`, 'Choose a plan now and keep everything you set up: no step is lost.'],
      es: [`Su prueba de 7 días de VYNTEX ERP para ${name} termina${dayEs(f.at) ? ' el ' + dayEs(f.at) : ' en unos días'}.`, 'Elija un plan ahora y conserve todo lo que configuró: no se pierde nada.'],
    },
    trial_1d: {
      subject: `Last day of your free trial / Último día de su prueba gratuita`,
      en: [`Your trial for ${name} ends within 24 hours.`, 'Choose a plan today so your team can keep working without a pause.'],
      es: [`Su prueba de ${name} termina en menos de 24 horas.`, 'Elija un plan hoy para que su equipo siga trabajando sin pausa.'],
    },
    trial_ended: {
      subject: `Your free trial ended / Su prueba gratuita terminó`,
      en: [`The trial of ${name} has ended and the workspace is paused. Every record you entered is kept.`, 'Choose a plan from the billing page and it opens again right away.'],
      es: [`La prueba de ${name} terminó y el espacio está en pausa. Todo lo que registró se conserva.`, 'Elija un plan desde la página de facturación y se abre de nuevo al instante.'],
    },
  }[kind];
  if (!T) return null;
  return {
    subject: T.subject,
    text: ['Hello,', '', ...T.en, '', go[0], '', CONTACT_EN, '', '---', '', 'Hola:', '', ...T.es, '', go[1], '', CONTACT_ES, ''].join('\n'),
  };
}
