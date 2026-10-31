// Cinema-läge: prompt-kompilering. Kör: node --test scripts/test-cinema.mjs
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../cinema.js');

test('empty settings leave the prompt untouched', () => {
  assert.strictEqual(C.apply('a cat', {}, { kind: 'image' }), 'a cat');
  assert.ok(C.isEmpty({})); assert.strictEqual(C.compile({}, { kind: 'video' }), '');
});
test('camera movement only for video', () => {
  const c = { lens: '85', move: 'dolly-in' };
  assert.ok(!/dolly/i.test(C.compile(c, { kind: 'image' })));
  assert.match(C.compile(c, { kind: 'video' }), /dolly/i);
  assert.match(C.compile(c, { kind: 'image' }), /85/);
});
test('tag style for SDXL/Horde engines, sentences otherwise', () => {
  const c = { lens: '35', light: 'golden', grade: 'kodak' };
  const tags = C.compile(c, { kind: 'image', engine: 'horde-sdxl' });
  const prose = C.compile(c, { kind: 'video', engine: 'ltx' });
  assert.ok(tags.length > 0 && prose.length > 0); assert.notStrictEqual(tags, prose);
});
test('unknown ids dropped, custom text kept and clamped, no duplicates on re-apply', () => {
  const n = C.normalize({ lens: 'bogus', light: 'golden', custom: 'x'.repeat(500) });
  assert.strictEqual(n.lens, undefined); assert.ok(n.custom.length <= 300);
  const p1 = C.apply('city', { light: 'golden' }, { kind: 'image' });
  assert.strictEqual(C.apply(p1, { light: 'golden' }, { kind: 'image' }), p1);
});
test('every preset compiles and has Swedish labels for all keys', () => {
  for (const [name, c] of C.PRESETS) { assert.ok(name); assert.ok(C.compile(c, { kind: 'video' }).length > 10, name); }
  for (const k of C.KEYS) { assert.ok(C.LABELS[k]); for (const o of C.OPT[k].filter((x) => x[0])) assert.strictEqual(o.length, 3); }
});
