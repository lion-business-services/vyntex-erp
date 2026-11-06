// Unit tests for VYNTEX AI's attachments (src/features/assistant/media.ts, 0096): text files go with the question, cut
// to fit; and the Spanish text of the new controls exists for every English key.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';

const m = await load(`
  export * as media from '@/features/assistant/media';
  export { dict as ASSISTANT_I18N } from '@/features/assistant/i18n';
`);
const { media } = m;

test('a text file goes with the question, named, and cut to the limit', () => {
  const q = 'Summarize this';
  assert.equal(media.withFileText(q, []), q);
  assert.equal(media.withFileText(q, [{ kind: 'image', name: 'a.png', size: 1, dataUrl: 'data:image/png;base64,AA' }]), q, 'a picture is not text');
  const out = media.withFileText(q, [{ kind: 'text', name: 'leads.csv', size: 10, text: 'name,phone\nBrian,6095550100' }]);
  assert.match(out, /^Summarize this\n\n\[Attached file: leads\.csv\]\nname,phone\nBrian,6095550100$/);
  const big = 'x'.repeat(media.MAX_TEXT_CHARS);
  const two = media.withFileText(q, [{ kind: 'text', name: 'a.txt', size: 1, text: big }, { kind: 'text', name: 'b.txt', size: 1, text: 'more' }]);
  assert.ok(two.length < q.length + media.MAX_TEXT_CHARS + 200, 'all files together stay within the limit');
  assert.match(two, /\[Attached file: b\.txt\]\n\n\[…cut\]$/);
});

test('every new control has its English and Spanish text', () => {
  const dict = m.ASSISTANT_I18N;
  const keys = Object.keys(dict.en).filter((k) => /^asst\.(file|voice|chats)\./.test(k));
  assert.ok(keys.length >= 20, String(keys.length));
  for (const k of keys) { assert.ok(dict.es[k], 'es: ' + k); assert.notEqual(dict.es[k], dict.en[k], 'translated: ' + k); assert.ok(!/[—–]/.test(dict.en[k] + dict.es[k]), 'no dashes: ' + k); }
});
