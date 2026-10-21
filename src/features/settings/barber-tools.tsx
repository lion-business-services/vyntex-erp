// Barbershop-specific Settings landing. Only daily destinations appear in the sidebar.
// Advanced operational modules are preserved behind role-checked links, rather than disabled.
import { LuBookOpen, LuCrown, LuWallet, LuChartColumn, LuPlug, LuMail, LuStar, LuShare2, LuShieldCheck, LuScrollText, LuBanknote, LuCalendarDays, LuListChecks, LuUserPlus, LuBriefcase, LuFileText, LuLightbulb, LuSparkles } from 'react-icons/lu';
import type { ComponentType } from 'react';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { moduleOn } from '@/domain/config';
import type { ModuleId } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import './barber-tools.css';

type Icon = ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>;
interface Tool { module: ModuleId; path: string; en: string; es: string; help: string; helpEs: string; icon: Icon; needs?: Permission }
const TOOLS: Tool[] = [
  { module:'catalog', path:'/catalog', en:'Services & prices', es:'Servicios y precios', help:'Service menu, duration and pricing', helpEs:'Menú, duración y precios', icon:LuBookOpen, needs:'catalog' },
  { module:'memberships', path:'/memberships', en:'Memberships & gift cards', es:'Membresías y tarjetas regalo', help:'Packages, loyalty, visits and renewals', helpEs:'Paquetes, fidelidad y renovaciones', icon:LuCrown, needs:'clients' },
  { module:'payments', path:'/payments', en:'Payments & receipts', es:'Pagos y recibos', help:'Charges, balances, tips and history', helpEs:'Cobros, saldos, propinas e historial', icon:LuWallet, needs:'money' },
  { module:'reports', path:'/reports', en:'Performance & reports', es:'Resultados e informes', help:'Revenue, service trends and shop performance', helpEs:'Ingresos, tendencias y resultados', icon:LuChartColumn, needs:'reports' },
  { module:'integrations', path:'/integrations', en:'Connected apps', es:'Aplicaciones conectadas', help:'Calendar, messaging, payments and accounting', helpEs:'Calendario, mensajes, pagos y contabilidad', icon:LuPlug, needs:'integrations' },
  { module:'messages', path:'/messages', en:'Client messages', es:'Mensajes a clientes', help:'Prepared confirmations and follow-up drafts', helpEs:'Confirmaciones y borradores de seguimiento', icon:LuMail, needs:'comms' },
  { module:'reviews', path:'/reviews', en:'Reviews & reputation', es:'Reseñas y reputación', help:'Feedback and approved review requests', helpEs:'Opiniones y solicitudes aprobadas', icon:LuStar, needs:'reviews' },
  { module:'social', path:'/social', en:'Marketing & social', es:'Marketing y redes', help:'Planned posts and return-visit campaigns', helpEs:'Publicaciones y campañas de regreso', icon:LuShare2, needs:'social' },
  { module:'cash', path:'/cash', en:'Cash drawer', es:'Caja', help:'Till movements and end-of-day close', helpEs:'Movimientos de caja y cierre diario', icon:LuBanknote, needs:'cash' },
  { module:'security', path:'/security', en:'Staff access', es:'Acceso del equipo', help:'Roles, approvals and protection', helpEs:'Roles, aprobaciones y seguridad', icon:LuShieldCheck, needs:'users' },
  { module:'audit', path:'/audit', en:'Activity & audit log', es:'Actividad y auditoría', help:'Review who changed what', helpEs:'Revisar quién cambió cada cosa', icon:LuScrollText, needs:'audit' },
  { module:'calendar', path:'/calendar', en:'Full calendar', es:'Calendario completo', help:'Cross-team events and schedule', helpEs:'Eventos y horario del equipo', icon:LuCalendarDays, needs:'calendar' },
  { module:'tasks', path:'/tasks', en:'Internal tasks', es:'Tareas internas', help:'Restocking, follow-ups and desk checklists', helpEs:'Inventario, seguimiento y listas', icon:LuListChecks, needs:'tasks' },
  { module:'leads', path:'/leads', en:'Group inquiries', es:'Consultas de grupos', help:'Special events and group bookings', helpEs:'Eventos y reservas de grupos', icon:LuUserPlus, needs:'leads' },
  { module:'jobs', path:'/jobs', en:'Group bookings', es:'Reservas de grupos', help:'Large events and group appointments', helpEs:'Eventos grandes y reservas', icon:LuBriefcase, needs:'jobs' },
  { module:'documents', path:'/documents', en:'Documents', es:'Documentos', help:'Quotes, agreements and forms', helpEs:'Cotizaciones, acuerdos y formularios', icon:LuFileText, needs:'documents' },
  { module:'opportunities', path:'/opportunities', en:'Growth opportunities', es:'Oportunidades', help:'Suggested retail and upsell opportunities', helpEs:'Venta cruzada y oportunidades', icon:LuLightbulb, needs:'opportunities' },
  { module:'assistant', path:'/assistant', en:'AI assistant', es:'Asistente de IA', help:'Shop-specific guidance where enabled', helpEs:'Asistencia específica cuando está activa', icon:LuSparkles, needs:'assistant' },
];
export default function BarberTools() {
  const { data, pack, can, lang } = useApp();
  const es = lang === 'es';
  const visible = TOOLS.filter(x => moduleOn(data, pack, x.module) && (!x.needs || can(x.needs)));
  const primary = visible.filter((x) => TOOLS.indexOf(x) < 9);
  const advanced = visible.filter((x) => TOOLS.indexOf(x) >= 9);
  const cards = (arr: Tool[]) => <div className="barber-tool-grid">{arr.map((x) => {
    const Icon = x.icon;
    return <A key={x.module} to={x.path} className="barber-tool-card">
      <span className="barber-tool-icon"><Icon aria-hidden="true" /></span>
      <span><strong>{es ? x.es : x.en}</strong><small>{es ? x.helpEs : x.help}</small></span>
      <span aria-hidden="true">→</span>
    </A>;
  })}</div>;
  return <section className="barber-tools">
    <div className="barber-tools-intro">
      <h2>{es ? 'Herramientas del negocio' : 'Everything else, neatly organized'}</h2>
      <p>{es ? 'El trabajo diario queda en el menú principal. Configure aquí servicios, membresías, finanzas e integraciones.' : 'Daily shop work stays in the main menu. Services, memberships, payments and connected apps live here when you need them.'}</p>
    </div>
    {cards(primary)}
    {advanced.length > 0 && <details className="barber-tools-more"><summary>{es ? 'Administración avanzada' : 'Advanced owner and manager tools'} <span>{advanced.length}</span></summary>{cards(advanced)}</details>}
    <p className="barber-tools-foot">{es ? 'El acceso siempre depende de su función y permisos.' : 'Every destination still respects the shop’s role and access permissions.'}</p>
  </section>;
}

