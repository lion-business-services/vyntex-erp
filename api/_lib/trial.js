// Public seven-day trial onboarding. Accounts are only created upon single-use emailed invitation acceptance.
// Privileged database calls are server-only. Disabled by default; LBS and the original ERP DB are untouched.
import { appOrigin, deployId, env } from './env.js';
import { configured, serviceRpc } from './supabase.js';
import { assertCsrf } from './csrf.js';
import { readJson, ok, fail, upstreamError } from './respond.js';
import { limit, addressKey, accountKey } from './ratelimit.js';
import { randomToken, sha256Hex } from './crypto.js';
import { emailConfigured, sendSystemEmail } from './mail.js';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INDUSTRIES=new Set(['build','clean','landscape','wash','haul','snow','turnover','events','practice','barber']);
const enabled=()=>deployId()==='vyntex' && env('TRIAL_SIGNUP_ENABLED')==='true' && configured() && emailConfigured();
export function trialStatus(){return ok({available:enabled(),days:7,paymentRequired:false,method:'verified_email'});}
export async function trialRequest(request){
  if(!enabled())return fail(503,'trial_not_ready');
  assertCsrf(request,null);
  const body=await readJson(request,4096);
  if(body.website)return ok({requested:true});
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  const ownerName=typeof body.ownerName==='string'?body.ownerName.trim():'';
  const businessName=typeof body.businessName==='string'?body.businessName.trim():'';
  const slug=typeof body.slug==='string'?body.slug.trim().toLowerCase():'';
  const industry=typeof body.industry==='string'?body.industry:'';
  if(!EMAIL.test(email)||email.length>320||ownerName.length<2||ownerName.length>120||
     businessName.length<2||businessName.length>200||slug.length<3||slug.length>40||
     !SLUG.test(slug)||!INDUSTRIES.has(industry))return fail(400,'invalid_trial');
  if(body.agree!==true)return fail(400,'terms_required');
  await limit('trial.ip',addressKey(request),4,3600);
  await limit('trial.email',accountKey(email),2,86400);
  const token=randomToken();const tokenHash=sha256Hex(token);
  const r=await serviceRpc('trial_request_create',{
    p_slug:slug,p_name:businessName,p_industry:industry,p_email:email,
    p_owner_name:ownerName,p_email_hash:accountKey(email),p_token_hash:tokenHash
  });
  if(!r.ok)throw upstreamError(r);
  if(r.data==='accepted')return ok({requested:true});
  if(r.data==='slug_taken')return fail(409,'slug_taken');
  if(r.data!=='created')return fail(400,['bad_slug','bad_name','bad_email','bad_industry'].includes(r.data)?r.data:'invalid_trial');
  // Browser fragments never travel in HTTP request paths, proxies, access logs or Referer.
  const url=appOrigin(request)+'/invite#token='+encodeURIComponent(token);
  const mail={
    subject:'Activate your VYNTEX ERP 7-day trial',
    text:'Welcome to VYNTEX ERP, '+ownerName+'!\n\nYou requested a seven-day trial for '+businessName+
     '.\n\nOpen this secure, one-time link within 72 hours to verify your email, set your password and activate your workspace:\n'+url+
     '\n\nYour seven-day trial begins only after activation. Your workspace address will be '+appOrigin(request)+'/'+slug+
     '.\n\nIf you did not request this, ignore this message. No payment or subscription has been created.'
  };
  const sent=await sendSystemEmail({to:email,...mail,idem:'trial:'+tokenHash.slice(0,40)});
  if(!sent.delivered){
    await serviceRpc('trial_request_cancel',{p_token_hash:tokenHash});
    return fail(503,'trial_email_unavailable');
  }
  return ok({requested:true});
}

