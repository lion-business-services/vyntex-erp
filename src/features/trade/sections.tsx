// The five trade sections are screens with tabs: client equipment (and, in plumbing, the camera inspections of the
// client's lines) and permits & compliance (the refrigerant log in HVAC, backflow tests in plumbing).
import { useState } from 'react';
import type { PageProps } from '@/app/modules';
import { useApp } from '@/app/hooks';
import { Tabs } from '@/ui';
import EquipmentPage from './equipment';
import CameraPage from './camera';
import PermitsPage from './permits';
import RefrigerantPage from './refrigerant';
import BackflowPage from './backflow';

export function ClientEquipment(props: PageProps) {
  const { pack, lang } = useApp();
  const [tab, setTab] = useState<'units' | 'camera'>('units');
  if (pack.id !== 'plumbing') return <EquipmentPage {...props} />;
  const es = lang === 'es';
  const tabs = <Tabs value={tab} onChange={setTab} tabs={[{ id: 'units', label: es ? 'Calentadores y equipo' : 'Water heaters & fixtures' }, { id: 'camera', label: es ? 'Inspecciones con cámara' : 'Camera inspections' }]} />;
  return tab === 'units' ? <EquipmentPage {...props} tabs={tabs} /> : <CameraPage {...props} tabs={tabs} section={es ? 'Equipo de clientes' : 'Client equipment'} />;
}

export function Compliance(props: PageProps) {
  const { pack, lang } = useApp();
  const [tab, setTab] = useState<'permits' | 'more'>('permits');
  const es = lang === 'es';
  const plumbing = pack.id === 'plumbing';
  const tabs = <Tabs value={tab} onChange={setTab} tabs={[{ id: 'permits', label: es ? 'Permisos e inspecciones' : 'Permits & inspections' }, { id: 'more', label: plumbing ? (es ? 'Pruebas de reflujo' : 'Backflow tests') : (es ? 'Registro de refrigerante' : 'Refrigerant log') }]} />;
  const section = es ? 'Permisos y cumplimiento' : 'Permits & compliance';
  if (tab === 'permits') return <PermitsPage {...props} tabs={tabs} section={section} />;
  return plumbing ? <BackflowPage {...props} tabs={tabs} section={section} /> : <RefrigerantPage {...props} tabs={tabs} section={section} />;
}
