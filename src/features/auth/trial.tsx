// Self-service onboarding: email verification precedes account and tenant activation.
// No passwords or billing data are collected here. The request never contacts Supabase from the browser.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useApp } from '@/app/hooks';
import { Link } from '@/app/router';
import { PACK_LIST } from '@/packs';
import { get, post } from '@/platform/live/http';
import { AuthFrame } from './frame';
import './trial.css';

export default function TrialSignup() {
  const { lang } = useApp();
  const es=lang==='es', id=useId();
  const [ready,setReady]=useState<'loading'|'yes'|'no'>('loading');
  const [sent,setSent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [name,setName]=useState(''),[businessName,setBusinessName]=useState('');
  const [slug,setSlug]=useState(''),[manualSlug,setManualSlug]=useState(false);
  const [email,setEmail]=useState('');
  const [industry,setIndustry]=useState('build');
  const [agree,setAgree]=useState(false);
  const [website,setWebsite]=useState('');
  const copy=(en:string,spanish:string)=>es?spanish:en;
  useEffect(()=>{
    let active=true;
    void get<{available:boolean}>('/api/auth/trial/status',{session:false}).then(r=>{
      if(active)setReady(r.ok&&r.data.available?'yes':'no');
    });
    return()=>{active=false};
  },[]);
  const suggestion=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(busy||ready!=='yes')return;
    setBusy(true);setError('');
    const result=await post<{requested:boolean}>('/api/auth/trial/request',
      {ownerName:name,businessName,slug,email,industry,agree,website},{stepUp:false,session:false});
    if(result.ok){setSent(true);setBusy(false);return;}
    setBusy(false);
    const errors:Record<string,string>={
      slug_taken:copy('That workspace address is already taken. Try another.','Esta dirección ya está en uso. Pruebe otra.'),
      trial_not_ready:copy('Trial registration is temporarily unavailable. Please contact VYNTEX.','El registro temporalmente no está disponible. Contacte a VYNTEX.'),
      trial_email_unavailable:copy('We could not send a verification email. Please try later.','No pudimos enviar el correo de verificación. Inténtelo más tarde.'),
      terms_required:copy('Please accept the terms to continue.','Acepte los términos para continuar.'),
      locked:copy('Too many requests. Please try again later.','Demasiadas solicitudes. Vuelva a intentar más tarde.')
    };
    setError(errors[result.code]||copy('Unable to start the trial. Check the information and try again.','No se pudo iniciar la prueba. Verifique los datos e intente nuevamente.'));
  };
  return <AuthFrame title={copy('Start your 7-day free trial','Comience su prueba gratuita de 7 días')}
    sub={copy('Explore your own VYNTEX ERP workspace. No credit card required.','Explore su propio espacio VYNTEX ERP. Sin tarjeta de crédito.')}
    step={sent?'sent':ready==='yes'?'form':ready}>
    <div className="vx-trial">
      {ready==='loading'&&<p role="status" className="muted">{copy('Checking availability…','Verificando disponibilidad…')}</p>}
      {ready==='no'&&<div className="note warn" role="status" data-testid="trial-not-ready">
        <strong>{copy('Trials are being prepared','Preparando pruebas gratuitas')}</strong>
        <p>{copy('Self-service registration is not available yet. You can explore the full sample demo or request an assisted setup.','El registro automático aún no está disponible. Puede explorar la demostración o solicitar ayuda.')}</p>
        <div className="auth-links"><Link to="/demo">{copy('Explore demo','Ver demo')}</Link><Link to="/request-demo">{copy('Request setup','Solicitar configuración')}</Link></div>
      </div>}
      {sent&&<div className="note" role="status" data-testid="trial-requested">
        <strong>{copy('Check your email','Revise su correo')}</strong>
        <p>{copy('If this is a new eligible account, we have sent a one-time activation link. Complete the invitation to start your 7 days. Check spam if necessary.','Si su cuenta cumple los requisitos, enviamos un enlace único. Acéptelo para iniciar sus 7 días. Revise spam si es necesario.')}</p>
        <p className="small muted">{copy('No payment was collected.','No se realizó ningún cobro.')}</p>
      </div>}
      {ready==='yes'&&!sent&&<form onSubmit={submit} className="vx-trial-form" noValidate>
        <div className="vx-trial-facts"><span>✓ {copy('7 days','7 días')}</span><span>✓ {copy('Your own workspace','Su propia empresa')}</span><span>✓ {copy('No credit card','Sin tarjeta')}</span></div>
        <label htmlFor={id+'owner'}>{copy('Your name','Su nombre')}</label>
        <input id={id+'owner'} autoComplete="name" required maxLength={120} minLength={2} value={name} onChange={e=>setName(e.target.value)} placeholder={copy('Full name','Nombre completo')}/>
        <label htmlFor={id+'email'}>{copy('Work email','Correo del trabajo')}</label>
        <input id={id+'email'} type="email" autoComplete="email" required maxLength={320} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/>
        <label htmlFor={id+'company'}>{copy('Business name','Nombre de empresa')}</label>
        <input id={id+'company'} autoComplete="organization" required maxLength={200} minLength={2} value={businessName} onChange={e=>{setBusinessName(e.target.value);if(!manualSlug)setSlug(suggestion(e.target.value));}} placeholder={copy('Your business','Su empresa')}/>
        <label htmlFor={id+'industry'}>{copy('Industry edition','Edición para su industria')}</label>
        <select id={id+'industry'} value={industry} onChange={e=>setIndustry(e.target.value)}>
          {PACK_LIST.map(x=><option key={x.id} value={x.id}>{(es?x.label.es:x.label.en)||x.product}</option>)}
        </select>
        <label htmlFor={id+'slug'}>{copy('Your workspace address','Dirección de su empresa')}</label>
        <div className="vx-trial-address"><span>erp.vyntexusa.com/</span><input id={id+'slug'} aria-label={copy('Workspace path','Ruta de empresa')} required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={40} value={slug} onChange={e=>{setManualSlug(true);setSlug(suggestion(e.target.value))}}/></div>
        <label className="vx-trial-checkbox"><input type="checkbox" required checked={agree} onChange={e=>setAgree(e.target.checked)}/><span>{copy('I confirm that I am authorized to create this business workspace and agree to the applicable terms and privacy policy.','Confirmo mi autorización y acepto los términos y la política de privacidad.')}</span></label>
        <div className="vx-trial-hp" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label></div>
        {error&&<div role="alert" className="auth-err">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy||!agree} data-testid="trial-submit">{busy?copy('Sending secure link…','Enviando enlace…'):copy('Email my activation link','Enviarme enlace de activación')}</button>
        <p className="auth-fine">{copy('The trial begins after you confirm your email and set your password. Connected services require your authorization.','La prueba inicia cuando verifica su correo y crea su contraseña. Las integraciones requieren autorización.')}</p>
      </form>}
      <div className="auth-links"><Link to="/signin">{copy('Already have an account? Sign in','¿Ya tiene cuenta? Inicie sesión')}</Link><Link to="/demo">{copy('Preview the demo','Ver la demostración')}</Link></div>
    </div>
  </AuthFrame>;
}

