// VYNTEX AI's attachments and voice (0096).
//   files    a picture (PNG, JPEG, WebP, GIF) is made smaller in the browser and sent for the model to see; a PDF is
//            sent as it is (Gemini reads it); a text file (TXT, CSV, TSV, MD, JSON) is read here and only its text is
//            sent. Nothing is kept: a saved conversation keeps the file names only
//   voice    the microphone is recorded in the browser and written down by the server (Groq's Whisper); where that is
//            not available, the browser's own dictation is used
import { maskTaxIds } from './records';

export type Attachment =
  | { kind: 'image'; name: string; size: number; dataUrl: string }
  | { kind: 'pdf'; name: string; size: number; dataUrl: string }
  | { kind: 'text'; name: string; size: number; text: string };

export const MAX_FILES = 3;
export const MAX_TEXT_CHARS = 8000;
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,text/tab-separated-values,text/markdown,application/json,.txt,.csv,.tsv,.md,.json';
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;

export type FileProblem = 'type' | 'too_big' | 'read';

const readAs = (file: Blob, how: 'dataUrl' | 'text'): Promise<string> => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result || ''));
  r.onerror = () => no(new Error('read'));
  if (how === 'dataUrl') r.readAsDataURL(file); else r.readAsText(file);
});

/** A picture made at most 1600 pixels on its longer side, as JPEG (or PNG when it has transparency and is small). */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('read')); i.src = url; });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)); const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); if (!g) throw new Error('read');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

/** Reads one chosen file for VYNTEX AI, or says why it cannot be used. */
export async function readAttachment(file: File): Promise<Attachment | FileProblem> {
  const name = file.name.slice(0, 120) || 'file';
  const type = (file.type || '').toLowerCase(); const ext = (name.split('.').pop() || '').toLowerCase();
  try {
    if (/^image\/(png|jpeg|webp|gif)$/.test(type)) {
      if (file.size > 15 * 1024 * 1024) return 'too_big';
      return { kind: 'image', name, size: file.size, dataUrl: await shrink(file) };
    }
    if (type === 'application/pdf' || ext === 'pdf') {
      if (file.size > MAX_PDF_BYTES) return 'too_big';
      const d = await readAs(file, 'dataUrl');
      return { kind: 'pdf', name, size: file.size, dataUrl: d.replace(/^data:[^;]*;/, 'data:application/pdf;') };
    }
    if (/^text\//.test(type) || type === 'application/json' || ['txt', 'csv', 'tsv', 'md', 'json'].includes(ext)) {
      if (file.size > 2 * 1024 * 1024) return 'too_big';
      const text = maskTaxIds(await readAs(file, 'text'));
      return { kind: 'text', name, size: file.size, text: text.slice(0, MAX_TEXT_CHARS) };
    }
    return 'type';
  } catch { return 'read'; }
}

/** The question as sent: the person's words, then the text of each text file, cut to fit. */
export function withFileText(question: string, files: Attachment[]): string {
  const texts = files.filter((f): f is Extract<Attachment, { kind: 'text' }> => f.kind === 'text');
  if (!texts.length) return question;
  let room = MAX_TEXT_CHARS;
  const parts = texts.map((f) => { const t = f.text.slice(0, Math.max(0, room)); room -= t.length; return `\n\n[Attached file: ${f.name}]\n${t}${t.length < f.text.length ? '\n[…cut]' : ''}`; });
  return question + parts.join('');
}

/* ---------- voice ---------- */

export interface Recorder { stop: () => Promise<string | null>; cancel: () => void }

/** Whether this browser can record the microphone. */
export const canRecord = (): boolean => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/** Starts recording. stop() answers the recording as a data: address (or null when nothing was recorded). At most 3 minutes. */
export async function startRecording(onAutoStop: () => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((ok) => { rec.onstop = () => ok(); });
  rec.start(500);
  const end = () => stream.getTracks().forEach((t) => t.stop());
  const timer = window.setTimeout(onAutoStop, 180_000);
  return {
    async stop() {
      window.clearTimeout(timer);
      if (rec.state !== 'inactive') rec.stop();
      await done; end();
      if (!chunks.length) return null;
      const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
      if (blob.size < 1500) return null;
      return readAs(blob, 'dataUrl');
    },
    cancel() { window.clearTimeout(timer); try { if (rec.state !== 'inactive') rec.stop(); } catch { /* stopped */ } end(); },
  };
}

type SpeechCtor = new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
/** The browser's own dictation, when the server cannot write the voice down: a short phrase in the page's language. */
export function browserDictation(lang: 'en' | 'es'): Promise<string | null> {
  const W = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  const C = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!C) return Promise.resolve(null);
  return new Promise((ok) => {
    const r = new C(); r.lang = lang === 'es' ? 'es-US' : 'en-US'; r.interimResults = false; r.continuous = false;
    let text = '';
    r.onresult = (e) => { text = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim(); };
    r.onerror = () => ok(text || null); r.onend = () => ok(text || null);
    try { r.start(); } catch { ok(null); }
  });
}
