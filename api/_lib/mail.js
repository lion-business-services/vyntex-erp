// System email: invitations, password resets, security notices. Sent through the Resend adapter with the
// deployment's own key and sender. When email is not configured nothing is sent and the caller is told so
// ({ delivered: false, reason: 'not_configured' }): the screens say the truth instead of pretending.
// Wording is plain, in English and Spanish. No link in these emails points anywhere but this site.
import { has, deployId } from './env.js';
import resend from './integrations/providers/resend.js';
import { ProviderError } from './integrations/oauth.js';
import { env } from './env.js';
import { log } from './respond.js';

export const productName = () => (deployId() === 'lbs' ? 'LBS Command' : 'VYNTEX ERP');
export const emailConfigured = () => has('RESEND_API_KEY') && has('SYSTEM_EMAIL_FROM');

/** Sends one system email. `idem` makes a retry of the same send harmless. Never throws. */
export async function sendSystemEmail({ to, subject, text, idem = null, tenant = null, fetchFn }) {
  if (!emailConfigured()) return { delivered: false, reason: 'not_configured' };
  const ctx = { provider: 'resend', tenantId: tenant, env, fetch: fetchFn || ((...a) => globalThis.fetch(...a)), now: () => Date.now() };
  try {
    const out = await resend.actions.sendEmail(ctx, { to, subject, text, idempotencyKey: idem });
    return { delivered: true, id: out.id };
  } catch (e) {
    const reason = e instanceof ProviderError ? e.code : 'send_failed';
    log('mail', 'send_failed', { reason });
    return { delivered: false, reason };
  }
}

const es = (lang) => lang === 'es';

export function inviteEmail({ lang, company, inviter, link, hours }) {
  const product = productName();
  if (es(lang)) {
    return {
      subject: `Invitación a ${company} en ${product}`,
      text: [
        'Hola:', '',
        `${inviter || 'Un miembro del equipo'} le invitó a unirse a ${company} en ${product}.`, '',
        'Abra este enlace para crear su contraseña e iniciar sesión:', link, '',
        `El enlace funciona una sola vez y vence en ${hours} horas.`,
        'Si no esperaba esta invitación, puede ignorar este mensaje.', '',
      ].join('\n'),
    };
  }
  return {
    subject: `Invitation to ${company} on ${product}`,
    text: [
      'Hello,', '',
      `${inviter || 'A member of the team'} invited you to join ${company} on ${product}.`, '',
      'Open this link to set your password and sign in:', link, '',
      `The link works once and expires in ${hours} hours.`,
      'If you did not expect this invitation, you can ignore this email.', '',
    ].join('\n'),
  };
}

/** The first owner of a new client company, invited by VYNTEX from the operator console. */
export function ownerWelcomeEmail({ lang, company, link, hours, address }) {
  const product = productName();
  if (es(lang)) {
    return {
      subject: `Su ${product} para ${company} está listo`,
      text: [
        'Hola:', '',
        `VYNTEX USA preparó el espacio de ${company} en ${product}.`, '',
        'Abra este enlace para crear su contraseña y activar su cuenta:', link, '',
        `El enlace funciona una sola vez y vence en ${hours} horas. Después de activarla, su dirección para entrar es:`, address, '',
        'Por su seguridad, al entrar se le pedirá agregar una aplicación de autenticación (Google Authenticator, Microsoft Authenticator o similar).',
        'Si tiene alguna pregunta, llámenos o escríbanos por WhatsApp al 609-780-3218, o escriba a info@vyntexusa.com.', '',
      ].join('\n'),
    };
  }
  return {
    subject: `Your ${product} for ${company} is ready`,
    text: [
      'Hello,', '',
      `VYNTEX USA has set up the ${company} workspace on ${product}.`, '',
      'Open this link to create your password and activate your account:', link, '',
      `The link works once and expires in ${hours} hours. Once your account is active, your sign-in address is:`, address, '',
      'For your security, you will be asked to add an authenticator app (Google Authenticator, Microsoft Authenticator or similar) when you sign in.',
      'Questions? Call or WhatsApp us at 609-780-3218, or write to info@vyntexusa.com.', '',
    ].join('\n'),
  };
}

export function resetEmail({ lang, link }) {
  const product = productName();
  if (es(lang)) {
    return {
      subject: `Restablecer su contraseña de ${product}`,
      text: [
        `Se solicitó restablecer la contraseña de esta dirección en ${product}.`, '',
        'Abra este enlace para elegir una contraseña nueva:', link, '',
        'El enlace funciona una sola vez y vence pronto.',
        'Si usted no lo solicitó, puede ignorar este mensaje y su contraseña no cambia.', '',
      ].join('\n'),
    };
  }
  return {
    subject: `Reset your ${product} password`,
    text: [
      `Someone asked to reset the password for this address on ${product}.`, '',
      'Open this link to choose a new password:', link, '',
      'The link works once and expires soon.',
      'If you did not ask for this, you can ignore this email and your password stays the same.', '',
    ].join('\n'),
  };
}

const ALERT_LABELS = {
  'signin.failed': ['failed sign-in attempts', 'intentos fallidos de inicio de sesión'],
  'signin.locked': ['sign-in lockouts', 'bloqueos de inicio de sesión'],
  'member.role_changed': ['role changes', 'cambios de rol'],
  'mfa.recovery_used': ['recovery codes used', 'códigos de recuperación usados'],
  'webhook.rejected': ['rejected incoming notices from a connected service', 'avisos entrantes rechazados de un servicio conectado'],
  'integration.error': ['connection errors', 'errores de conexión'],
};
const alertLabel = (kind) => ALERT_LABELS[kind] || (kind.startsWith('export.') ? ['data exports', 'exportaciones de datos'] : kind.startsWith('vault.') ? ['views of protected data', 'consultas de datos protegidos'] : ['security events', 'eventos de seguridad']);

/** One notice, in both languages: the owner's language is not known to the job that sends it. */
export function alertEmail({ kind, count, minutes }) {
  const product = productName();
  const [en, sp] = alertLabel(kind);
  return {
    subject: `Security notice from ${product}`,
    text: [
      `This is an automatic notice from ${product}.`,
      `In the last ${minutes} minutes: ${count} ${en}.`,
      'Open Security in your workspace to review them.', '',
      `Este es un aviso automático de ${product}.`,
      `En los últimos ${minutes} minutos: ${count} ${sp}.`,
      'Abra Seguridad en su espacio de trabajo para revisarlos.', '',
    ].join('\n'),
  };
}
