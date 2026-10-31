// Draws the pages of an uploaded PDF on screen, so the person placing the signature boxes, and the person signing, see
// the document itself under the boxes. The browser's own PDF viewer cannot be framed on this site (its security policy
// allows no framed file), so the pages are drawn with pdf.js (Mozilla, Apache-2.0), served from this site:
// public/vendor/pdfjs. It is loaded only when an uploaded PDF is on screen.
//
// The bytes: a file this page already holds is registered with its address when the address is made (pdfObjectUrl),
// because the policy lets a page fetch from this site only, not from an address it made itself. A file the server
// serves (the signing page) is fetched from its address on this site.

const LIB = '/vendor/pdfjs/pdf.min.js';
const WORKER = '/vendor/pdfjs/pdf.worker.min.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfDoc = { numPages: number; getPage(n: number): Promise<any> };

const held = new Map<string, Uint8Array>();
/** An address for a PDF this page holds, that the page drawer can read back without fetching it. */
export function pdfObjectUrl(bytes: Uint8Array): string {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  held.set(url, bytes);
  return url;
}
/** Releases an address made with pdfObjectUrl. */
export function releasePdfUrl(url: string | null | undefined): void {
  if (!url) return;
  held.delete(url); docs.delete(url);
  URL.revokeObjectURL(url);
}

let lib: Promise<any> | null = null;
function pdfjs(): Promise<any> {
  if (!lib) {
    const at = LIB; // a plain string kept out of the bundle: the file is served as it is
    lib = import(/* webpackIgnore: true */ at).then((m) => { m.GlobalWorkerOptions.workerSrc = WORKER; return m; });
    lib.catch(() => { lib = null; });
  }
  return lib;
}

const docs = new Map<string, Promise<PdfDoc>>();
async function bytesFor(url: string): Promise<Uint8Array> {
  const mine = held.get(url);
  if (mine) return mine;
  if (url.startsWith('blob:')) throw new Error('not_held');
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('fetch_failed');
  return new Uint8Array(await r.arrayBuffer());
}
function open(url: string): Promise<PdfDoc> {
  let p = docs.get(url);
  if (!p) {
    p = (async () => {
      const [m, bytes] = await Promise.all([pdfjs(), bytesFor(url)]);
      // a copy: pdf.js takes the buffer it is given over to its worker
      return m.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, disableAutoFetch: true }).promise as Promise<PdfDoc>;
    })();
    p.catch(() => docs.delete(url));
    docs.set(url, p);
  }
  return p;
}

/** Whether this page can draw a PDF from the address: one it holds, or one on this site. */
export const canDraw = (url: string | null | undefined): boolean => !!url && (held.has(url) || !url.startsWith('blob:'));

/**
 * Draws page `index` (from 0) of the PDF at `url` on `canvas`, at the canvas's width on screen and the screen's sharpness.
 * Resolves false when it cannot (the caller shows an empty sheet instead).
 */
export async function drawPdfPage(url: string, index: number, canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const doc = await open(url);
    if (index >= doc.numPages) return false;
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const css = canvas.clientWidth || 600;
    const ratio = Math.min(3, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    const viewport = page.getViewport({ scale: (css * ratio) / base.width });
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return true;
  } catch { return false; }
}
