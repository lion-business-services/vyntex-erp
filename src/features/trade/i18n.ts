import type { Dict } from '@/i18n';

// Menu names of the HVAC and plumbing trade sections (the pages themselves carry their own two-language wording).
export const dict: Dict = {
  en: {
    'nav.dispatch': 'Dispatch board', 'nav.agreements': 'Maintenance plans', 'nav.equipment': 'Equipment', 'nav.permits': 'Permits & inspections',
    'nav.refrigerant': 'Refrigerant log', 'nav.backflow': 'Backflow devices', 'nav.camera': 'Camera inspections',
  },
  es: {
    'nav.dispatch': 'Tablero de despacho', 'nav.agreements': 'Planes de mantenimiento', 'nav.equipment': 'Equipo', 'nav.permits': 'Permisos e inspecciones',
    'nav.refrigerant': 'Registro de refrigerante', 'nav.backflow': 'Dispositivos de reflujo', 'nav.camera': 'Inspecciones con cámara',
  },
};
