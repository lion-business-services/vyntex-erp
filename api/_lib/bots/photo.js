// An AI employee's own photo (0094): the tool profile_photo_set. The picture comes as base64 (or a data: address), or as
// an https address the server fetches once. It is checked by its first bytes (PNG, JPEG or WebP only, 1 MB at most),
// stored as a private file in the company's folder <company>/profiles/<random>.<ext>, and only that path reaches the
// database. People change photos from the screens (Team > Profiles, AI employees, a group in Team chat).
import { randomUUID } from 'node:crypto';
import { storage } from '../supabase.js';
import { env } from '../env.js';

export const MAX_PHOTO = 1024 * 1024;
const BUCKET = 'workspace-files';

/** The kind of picture from its first bytes, or null. */
export function photoKind(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

async function bytesFrom(args) {
  if (typeof args.image === 'string' && args.image) {
    const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(args.image.trim());
    const b64 = (m ? m[1] : args.image).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/_-]+=*$/.test(b64) || b64.length > Math.ceil(MAX_PHOTO / 3) * 4 + 8) return { error: 'photo_too_large_or_invalid' };
    return { bytes: Buffer.from(b64, 'base64') };
  }
  if (typeof args.url === 'string' && /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{2,5})?(\/\S*)?$/.test(args.url) && args.url.length <= 1000) {
    let res;
    try { res = await fetch(args.url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { accept: 'image/png,image/jpeg,image/webp' } }); } catch { return { error: 'photo_unreachable' }; }
    if (!res.ok) return { error: 'photo_unreachable' };
    if (Number(res.headers.get('content-length') || 0) > MAX_PHOTO) return { error: 'photo_too_large' };
    const reader = res.body?.getReader(); const parts = []; let n = 0;
    if (!reader) return { error: 'photo_unreachable' };
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_PHOTO) { try { await reader.cancel(); } catch { /* stop */ } return { error: 'photo_too_large' }; } parts.push(value); }
    return { bytes: Buffer.concat(parts.map((p) => Buffer.from(p))) };
  }
  return { error: 'photo_required' };
}

/** Checks and stores the picture; answers { path } or { error }. */
export async function storeBotPhoto(tenant, args) {
  const got = await bytesFrom(args || {});
  if (got.error) return got;
  const b = got.bytes;
  if (!b.length || b.length > MAX_PHOTO) return { error: 'photo_too_large_or_invalid' };
  const kind = photoKind(b);
  if (!kind) return { error: 'photo_type' };
  const path = `${tenant}/profiles/${randomUUID()}.${kind.ext}`;
  const up = await storage.upload(env('SUPABASE_SERVICE_ROLE_KEY'), BUCKET, path, b, kind.mime);
  if (!up.ok) return { error: 'store_unavailable' };
  return { path };
}
