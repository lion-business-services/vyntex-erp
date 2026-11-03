// Camera inspections: each sewer or drain line inspected, drawn as a line with what was found at each foot, the advice,
// and one click to send the video link and to turn the finding into a quote in Leads.
import type { PageProps } from '@/app/modules';
import { A } from '@/app/router';
import { Badge, Button, Card, PageHeader, Stat } from '@/ui';
import { DemoNote, useTrade } from './common';
import type { Finding, Inspection } from './store';

const COLOR: Record<Finding['kind'], string> = { ok: 'ok', grease: 'warn', offset: 'warn', belly: 'warn', roots: 'bad', crack: 'bad' };

export default function CameraPage(_: PageProps) {
  const { s, set, tx, client, worker, job, date, task, lead } = useTrade();
  const kind: Record<Finding['kind'], string> = { ok: tx('Clear', 'Libre'), grease: tx('Grease', 'Grasa'), offset: tx('Offset joint', 'Unión desfasada'), belly: tx('Belly (sag)', 'Hundimiento'), roots: tx('Roots', 'Raíces'), crack: tx('Crack / break', 'Grieta / rotura') };
  const serious = s.inspections.filter((i) => i.findings.some((f) => f.kind === 'roots' || f.kind === 'crack'));
  const patch = (id: string, p: Partial<Inspection>) => set((st) => ({ ...st, inspections: st.inspections.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  return (
    <div className="trade">
      <PageHeader title={tx('Camera inspections', 'Inspecciones con cámara')} sub={tx('Every line on camera: what was found at each foot, the advice, and the video sent to the client. Findings turn into quotes.', 'Cada línea en cámara: lo que se encontró en cada pie, la recomendación y el video para el cliente. Los hallazgos se convierten en cotizaciones.')} />
      <DemoNote />
      <div className="kpis">
        <Stat label={tx('Inspections', 'Inspecciones')} value={String(s.inspections.length)} hint={tx(`${s.inspections.reduce((n, i) => n + i.length, 0)} feet of line on video`, `${s.inspections.reduce((n, i) => n + i.length, 0)} pies de línea en video`)} />
        <Stat label={tx('Lines that need repair', 'Líneas que necesitan reparación')} value={String(serious.length)} hint={tx('Roots or breaks found', 'Se encontraron raíces o roturas')} attention={serious.some((i) => !i.quoted)} />
        <Stat label={tx('Video not sent yet', 'Video sin enviar')} value={String(s.inspections.filter((i) => !i.shared).length)} hint={tx('Clients say yes when they see it', 'Los clientes aceptan cuando lo ven')} />
      </div>
      <div className="stack">
        {s.inspections.map((i) => (
          <Card key={i.id} title={<span>{i.line} <span className="xs dim">· {client(i.clientId)?.name} · {date(i.date)} · {worker(i.workerId)?.name}</span></span>}
            actions={<span className="row tight">{i.shared ? <Badge tone="ok">{tx('Video sent', 'Video enviado')}</Badge> : <Button size="sm" onClick={() => { patch(i.id, { shared: true }); task(tx(`Send the camera video link to ${client(i.clientId)?.name ?? ''}`, `Enviar el enlace del video de la cámara a ${client(i.clientId)?.name ?? ''}`), { clientId: i.clientId, jobId: i.jobId, type: 'call' }); }}>{tx('Send video to client', 'Enviar video al cliente')}</Button>}
              {i.quoted ? <Badge tone="info">{tx('Quoted', 'Cotizado')}</Badge> : i.findings.some((f) => f.kind === 'roots' || f.kind === 'crack') && <Button size="sm" variant="primary" onClick={() => { if (lead(i.clientId, 'sewer', 2800, tx(`From the camera inspection of ${date(i.date)}: ${i.findings.filter((f) => f.kind !== 'ok').map((f) => `${f.at} ft ${kind[f.kind].toLowerCase()}`).join(', ')}. ${i.advice}`, `De la inspección con cámara del ${date(i.date)}: ${i.findings.filter((f) => f.kind !== 'ok').map((f) => `${f.at} pies ${kind[f.kind].toLowerCase()}`).join(', ')}. ${i.advice}`))) patch(i.id, { quoted: true }); }}>{tx('Quote the repair', 'Cotizar la reparación')}</Button>}</span>}>
            <div className="td-line" role="img" aria-label={tx(`${i.length} foot line with ${i.findings.length} marks`, `Línea de ${i.length} pies con ${i.findings.length} marcas`)}>
              <div className="td-pipe" />
              {i.findings.map((f, k) => <span key={k} className={'td-mark ' + COLOR[f.kind]} style={{ left: `${(f.at / Math.max(1, i.length)) * 100}%` }} title={`${f.at} ft: ${kind[f.kind]}`}><b>{f.at}′</b></span>)}
            </div>
            <ul className="td-findings">{i.findings.map((f, k) => <li key={k}><Badge tone={COLOR[f.kind] as 'ok' | 'warn' | 'bad'}>{kind[f.kind]}</Badge> <b>{f.at} {tx('ft', 'pies')}</b> {f.text}</li>)}</ul>
            <p className="small"><b>{tx('Advice', 'Recomendación')}:</b> {i.advice}{i.jobId && job(i.jobId) && <> · <A to={'/jobs/' + i.jobId}>{job(i.jobId)?.name}</A></>}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
