// Partner Portal emails, in English or Spanish (the partner's language; the client's language for a proposal).
// Plain text. No amounts of partner pay, ever: an email can be forwarded. Links point only to this site.
const CONTACT = {
  en: 'Questions? Call or WhatsApp 609-780-3218, or write to info@vyntexusa.com.',
  es: '¿Preguntas? Llame o escriba por WhatsApp al 609-780-3218, o escriba a info@vyntexusa.com.',
};
const L = (lang) => (lang === 'es' ? 'es' : 'en');
const day = (v, lang) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '';
};

export function partnerInviteEmail({ lang, partner, link, hours }) {
  if (L(lang) === 'es') {
    return {
      subject: 'Su acceso al Portal de Socios de VYNTEX',
      text: ['Hola:', '', `VYNTEX le dio acceso al Portal de Socios de VYNTEX como parte de ${partner}.`, '',
        'Abra este enlace para crear su contraseña. Después agregará una aplicación de autenticación, que es obligatoria para entrar:', link, '',
        `El enlace funciona una sola vez y vence en ${hours} horas. Si no esperaba este mensaje, puede ignorarlo.`, '', CONTACT.es, ''].join('\n'),
    };
  }
  return {
    subject: 'Your access to the VYNTEX Partner Portal',
    text: ['Hello,', '', `VYNTEX gave you access to the VYNTEX Partner Portal as part of ${partner}.`, '',
      'Open this link to set your password. You will then add an authenticator app, which is required to sign in:', link, '',
      `The link works once and expires in ${hours} hours. If you did not expect this email, you can ignore it.`, '', CONTACT.en, ''].join('\n'),
  };
}

export function proposalEmail({ lang, client, link, expiresAt, ref }) {
  if (L(lang) === 'es') {
    return {
      subject: `Su propuesta de VYNTEX (${ref})`,
      text: ['Hola:', '', `Preparamos una propuesta para ${client}. Puede revisarla, imprimirla y aceptarla aquí:`, link, '',
        `El enlace es privado y vence el ${day(expiresAt, 'es')}.`, '', CONTACT.es, ''].join('\n'),
    };
  }
  return {
    subject: `Your VYNTEX proposal (${ref})`,
    text: ['Hello,', '', `We prepared a proposal for ${client}. You can review it, print it and accept it here:`, link, '',
      `The link is private and expires on ${day(expiresAt, 'en')}.`, '', CONTACT.en, ''].join('\n'),
  };
}

/** One outbox notification as an email. `n`: { kind, audience, payload, lang }. Returns null for a kind that sends nothing. */
export function notificationEmail(n, origin) {
  const p = n.payload || {};
  const ref = String(p.ref || '').slice(0, 40);
  const client = String(p.client || '').slice(0, 200);
  const portal = `${origin}/partners`;
  if (n.audience === 'staff') {
    const lines = {
      'offer.pending_approval': `Offer ${ref} for ${client} is waiting for your approval.`,
      'order.submitted': `New partner order ${ref} for ${client}.${p.conflict ? ' Attribution conflict: another partner submitted this client first.' : ''}`,
      'order.partner_message': `The partner wrote on order ${ref} (${client}).`,
      'order.withdrawn': `The partner withdrew order ${ref} (${client}).`,
      'offer.accepted': `The client accepted offer ${ref} (${client}).`,
      'offer.declined': `The client declined offer ${ref} (${client}).`,
      'commission.inquiry': 'A partner asked a question about a commission line.',
      'orders.overdue': `${Number(p.count) || 0} partner order(s) need a follow-up today.`,
      'partners.weekly': p.summary || 'Weekly partner summary.',
    };
    const line = lines[n.kind];
    if (!line) return null;
    return { subject: `[VYNTEX Partners] ${line.split('\n')[0].slice(0, 120)}`, text: [line, '', `Open the Partner Portal: ${portal}`, ''].join('\n') };
  }
  const es = L(n.lang) === 'es';
  const T = es ? {
    'offer.approved': `VYNTEX aprobó la oferta ${ref} para ${client}. Ya puede compartirla con su cliente.`,
    'offer.changes_requested': `VYNTEX pidió cambios en la oferta ${ref} para ${client}.${p.note ? ' Nota: ' + String(p.note).slice(0, 500) : ''}`,
    'offer.viewed': `Su cliente ${client} abrió la propuesta ${ref}.`,
    'offer.accepted': `Su cliente ${client} aceptó la propuesta ${ref}. Ya puede convertirla en pedido.`,
    'offer.declined': `Su cliente ${client} rechazó la propuesta ${ref}.`,
    'order.received': `Recibimos el pedido ${ref} para ${client}. Le avisaremos de cada cambio.`,
    'order.status': `El pedido ${ref} (${client}) cambió de estado.${p.note ? ' Nota: ' + String(p.note).slice(0, 500) : ''}`,
    'order.update': `VYNTEX dejó una actualización en el pedido ${ref} (${client}).`,
    'commission.recorded': `Se registraron comisiones del pedido ${ref} (${client}).`,
    'payout.sent': `VYNTEX envió el pago ${ref}.`,
    'payout.settled': `El pago ${ref} quedó conciliado.`,
  } : {
    'offer.approved': `VYNTEX approved offer ${ref} for ${client}. You can share it with your client now.`,
    'offer.changes_requested': `VYNTEX asked for changes to offer ${ref} for ${client}.${p.note ? ' Note: ' + String(p.note).slice(0, 500) : ''}`,
    'offer.viewed': `Your client ${client} opened proposal ${ref}.`,
    'offer.accepted': `Your client ${client} accepted proposal ${ref}. You can turn it into an order now.`,
    'offer.declined': `Your client ${client} declined proposal ${ref}.`,
    'order.received': `We received order ${ref} for ${client}. You will be told about every change.`,
    'order.status': `Order ${ref} (${client}) changed status.${p.note ? ' Note: ' + String(p.note).slice(0, 500) : ''}`,
    'order.update': `VYNTEX left an update on order ${ref} (${client}).`,
    'commission.recorded': `Commission records were added for order ${ref} (${client}).`,
    'payout.sent': `VYNTEX sent payout ${ref}.`,
    'payout.settled': `Payout ${ref} is settled.`,
  };
  const line = T[n.kind] || (n.kind.startsWith('commission.') ? (es ? 'VYNTEX actualizó una de sus comisiones.' : 'VYNTEX updated one of your commission lines.') : null);
  if (!line) return null;
  return {
    subject: es ? `Portal de Socios de VYNTEX: ${line.slice(0, 100)}` : `VYNTEX Partner Portal: ${line.slice(0, 100)}`,
    text: [es ? 'Hola:' : 'Hello,', '', line, '', es ? `Abra el Portal de Socios: ${portal}` : `Open the Partner Portal: ${portal}`, '', es ? CONTACT.es : CONTACT.en, ''].join('\n'),
  };
}
