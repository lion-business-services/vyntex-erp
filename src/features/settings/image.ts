// A stored picture (the company logo, a person's photo) as something an <img> can show. A sample workspace keeps a small
// picture in the record itself; a live workspace keeps a path in private storage and reads it through a short-lived address.
import { useEffect, useState } from 'react';
import { gateway } from '@/platform/gateway';

export const isInline = (v: string | undefined): v is string => !!v && v.startsWith('data:');

/** The same, once, outside a component (a PDF being drawn): a picture of the record, or an empty string. */
export async function storedImageSrc(value: string | undefined): Promise<string> {
  if (!value) return '';
  if (isInline(value)) return value;
  try { return await linkFor(value); } catch { return ''; }
}
// The same picture shown in many places at once (a person's photo in every list) asks for its address once. The server's
// addresses last a minute (api/ws.js, LINK_SECONDS); one is reused for 45 seconds, then a new one is asked for.
const links = new Map<string, { at: number; url: Promise<string> }>();
function linkFor(path: string): Promise<string> {
  const now = Date.now(); const hit = links.get(path);
  if (hit && now - hit.at < 45_000) return hit.url;
  const url = gateway().files.url({ name: 'image', size: 0, mime: 'image/png', path }).then((r) => (r.ok ? r.data : ''), () => '');
  links.set(path, { at: now, url });
  void url.then((u) => { if (!u) links.delete(path); });
  return url;
}
/** The address to put in `src`, or an empty string while it is being fetched or when there is no picture. */
export function useStoredImage(value: string | undefined): string {
  const inline = isInline(value) ? value : '';
  const [src, setSrc] = useState(inline);
  useEffect(() => {
    if (inline || !value) { setSrc(inline); return; }
    let on = true;
    linkFor(value).then((u) => { if (on) setSrc(u); }, () => { if (on) setSrc(''); });
    return () => { on = false; };
  }, [value, inline]);
  return src;
}
/**
 * A data: address as a Blob, decoded here. Not with fetch(): the page's Content Security Policy (connect-src 'self')
 * refuses to fetch data: addresses, which made every logo and photo upload in a live workspace fail.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)?(;base64)?,(.*)$/is.exec(dataUrl);
  if (!m) return null;
  const type = (m[1] || 'application/octet-stream').toLowerCase();
  try {
    if (m[2]) {
      const bin = atob(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(m[3])], { type });
  } catch { return null; }
}
/** Stores a small picture: as it is in a sample workspace, as a private file in a live one. Returns what to keep in the record, or null when storing failed. */
export async function storeImage(dataUrl: string, live: boolean, folder: string): Promise<string | null> {
  if (!live) return dataUrl;
  try {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return null;
    const up = await gateway().files.upload(new File([blob], 'image.' + (blob.type.split('/')[1] || 'png'), { type: blob.type }), { folder });
    return up.ok && up.data.path ? up.data.path : null;
  } catch { return null; }
}
