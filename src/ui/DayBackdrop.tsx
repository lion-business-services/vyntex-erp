// "Daylight Circuit": the living ground behind the public pages in the day theme (sales pages, sign-in, invitations,
// signing). A slow aurora of four light fields, circuit traces drawn the way the V mark draws them (straight runs and
// 45 degree bends) with cyan light travelling along them, and on desktops a soft light that follows the pointer.
// Pure decoration: aria-hidden, no pointer events, transforms and dash offsets only. ui/daylight.css draws it and hides it
// at night, in the LBS brand and in print; with reduced motion it is a still picture. The workspace never renders it.
import { useEffect, useRef, type CSSProperties } from 'react';
import { useStore } from '@/store/store';

/** A trace, and whether a light pulse runs along it (duration and delay in seconds). */
interface Trace { d: string; pulse?: [number, number] }

// Wide screens: drawn on a 1440 by 900 board that covers the window. The traces keep to the margins, the band under the
// header and the bottom, so they pass behind the content edges rather than through the reading column.
const WIDE: Trace[] = [
  { d: 'M-10 150H40L80 190V420L50 450H-10', pulse: [9, 0] },
  { d: 'M-10 616H30L76 662V910', pulse: [11, 4.5] },
  { d: 'M-10 530H20L48 558V590' },
  { d: 'M150 -10V26L184 60H330', pulse: [8, 2] },
  { d: 'M640 -10V16L668 44H900L928 16V-10', pulse: [12, 6] },
  { d: 'M1170 -10V22L1142 50H1030' },
  { d: 'M1450 110H1404L1366 148V380L1402 416H1450', pulse: [10, 1.5] },
  { d: 'M1450 572H1418L1374 616V780L1406 812H1450', pulse: [13, 7] },
  { d: 'M1450 476H1420L1394 502V528' },
  { d: 'M300 910V898L320 878H570L590 898V910', pulse: [10.5, 3] },
  { d: 'M960 910V900L984 876H1210L1236 902', pulse: [14, 9] },
];
const WIDE_NODES: [number, number][] = [[80, 190], [80, 420], [76, 662], [48, 590], [330, 60], [668, 44], [900, 44], [1030, 50], [1366, 148], [1366, 380], [1374, 616], [1394, 528], [320, 878], [570, 878], [1236, 902]];

// Phones: a narrow board with a few traces along the two edges and the foot.
const NARROW: Trace[] = [
  { d: 'M-10 150H2L14 162V330L2 342H-10', pulse: [9, 0] },
  { d: 'M400 236H388L376 248V430L388 442H400', pulse: [11, 3.5] },
  { d: 'M-10 640H4L16 652V860' },
  { d: 'M400 700H392L378 714V860', pulse: [12, 6] },
  { d: 'M120 860V836L140 816H250L270 836V860' },
];
const NARROW_NODES: [number, number][] = [[14, 162], [14, 330], [376, 248], [376, 430], [16, 652], [378, 714], [140, 816], [250, 816]];

function Board({ className, view, traces, nodes }: { className: string; view: string; traces: Trace[]; nodes: [number, number][] }) {
  return (
    <svg className={`dc-circuit ${className}`} viewBox={view} preserveAspectRatio="xMidYMid slice" focusable="false">
      <g className="dc-traces">{traces.map((t, i) => <path key={i} d={t.d} />)}</g>
      <g className="dc-pulses">
        {traces.map((t, i) => t.pulse && (
          <path key={i} d={t.d} pathLength={100} style={{ '--dc-d': `${t.pulse[0]}s`, '--dc-t': `${t.pulse[1]}s` } as CSSProperties} />
        ))}
      </g>
      <g className="dc-nodes">
        {nodes.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.6} style={{ '--dc-t': `${(i * 0.7) % 5}s` } as CSSProperties} />)}
      </g>
    </svg>
  );
}

/** The day ground of the public pages. Renders nothing at night. */
export function DayBackdrop() {
  const { prefs } = useStore();
  const day = prefs.theme === 'light';
  const glow = useRef<HTMLDivElement>(null);
  // the light that follows the pointer: precise pointers only, never with reduced motion, one update per frame
  useEffect(() => {
    const el = glow.current;
    if (!day || !el || typeof matchMedia !== 'function') return;
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0, x = 0, y = 0;
    const paint = () => { frame = 0; el.style.transform = `translate3d(${x}px,${y}px,0)`; el.dataset.on = ''; };
    const move = (e: PointerEvent) => { if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return; x = e.clientX; y = e.clientY; if (!frame) frame = requestAnimationFrame(paint); };
    const leave = () => { delete el.dataset.on; };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [day]);
  if (!day) return null;
  return (
    <div className="dc-sky" aria-hidden="true">
      <div className="dc-aurora"><i className="dc-a1" /><i className="dc-a2" /><i className="dc-a3" /><i className="dc-a4" /></div>
      <Board className="dc-wide" view="0 0 1440 900" traces={WIDE} nodes={WIDE_NODES} />
      <Board className="dc-narrow" view="0 0 390 844" traces={NARROW} nodes={NARROW_NODES} />
      <div className="dc-glow" ref={glow} />
    </div>
  );
}
