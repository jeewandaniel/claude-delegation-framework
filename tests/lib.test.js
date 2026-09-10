'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, writeTranscript } = require('./helpers');

function loadLib(home) {
  process.env.FRAMEWORK_HOME = home;
  delete require.cache[require.resolve('../hooks/lib/framework-lib')];
  return require('../hooks/lib/framework-lib');
}

test('measureContext returns last and first usage totals, ignoring sidechain lines', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, [1000, 5000, 9000], { sidechain: [2] });
  const m = lib.measureContext(tp);
  assert.deepEqual(m, { ok: true, ctx: 5000, floor: 1000 });
});

test('measureContext reports no-usage when nothing usable', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, [], { noUsage: true });
  assert.deepEqual(lib.measureContext(tp), { ok: false, reason: 'no-usage' });
  assert.deepEqual(lib.measureContext(path.join(T, 'missing.jsonl')), { ok: false, reason: 'unreadable' });
});

test('measureContext reports not-yet when the transcript has no assistant lines', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, []);
  assert.deepEqual(lib.measureContext(tp), { ok: false, reason: 'not-yet' });
});

// One filler line of ~64 KB; six of them clear the 256 KB tail window.
function filler(n) {
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(65000) } });
  return new Array(n).fill(line);
}
function usageLine(total) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', usage: { input_tokens: 10, cache_read_input_tokens: total - 10, cache_creation_input_tokens: 0, output_tokens: 5 } },
  });
}

test('measureContext tail-reads: usage line beyond 256 KB of earlier content is found without a full read', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = path.join(T, 'big.jsonl');
  fs.writeFileSync(tp, [usageLine(1000), ...filler(6), usageLine(7777)].join('\n') + '\n');
  assert.ok(fs.statSync(tp).size > 262144, 'fixture must exceed the tail window');
  assert.deepEqual(lib.measureContext(tp, { needFloor: false }), { ok: true, ctx: 7777, floor: null });
});

test('measureContext falls back to a full read when the only usage line is beyond the tail', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = path.join(T, 'headonly.jsonl');
  fs.writeFileSync(tp, [usageLine(4242), ...filler(6)].join('\n') + '\n');
  assert.ok(fs.statSync(tp).size > 262144, 'fixture must exceed the tail window');
  const m = lib.measureContext(tp, { needFloor: false });
  assert.equal(m.ok, true);
  assert.equal(m.ctx, 4242);
});

test('measureContext ignoreBefore: floor is the first usage line after the offset, not the pre-compact one', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = path.join(T, 'w.jsonl');
  const preLine = usageLine(570000); // stale, pre-compact
  const prefix = preLine + '\n';
  const ignoreBefore = Buffer.byteLength(prefix, 'utf8'); // compact happened right after this line
  fs.writeFileSync(tp, prefix + usageLine(15000) + '\n' + usageLine(18000) + '\n');
  const m = lib.measureContext(tp, { ignoreBefore });
  assert.deepEqual(m, { ok: true, ctx: 18000, floor: 15000 });
});

test('measureContext ignoreBefore: nothing after the offset yet reports not-yet, never the stale figure', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = path.join(T, 'v.jsonl');
  const preLine = usageLine(570000);
  fs.writeFileSync(tp, preLine + '\n');
  const ignoreBefore = Buffer.byteLength(preLine, 'utf8') + 1;
  // sanity: without the offset the stale line is found at all
  assert.deepEqual(lib.measureContext(tp), { ok: true, ctx: 570000, floor: 570000 });
  assert.deepEqual(lib.measureContext(tp, { ignoreBefore }), { ok: false, reason: 'not-yet' });
});

test('measureContext ignoreBefore composes with the tail-read fast path: a stale line inside the tail window is still ignored', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = path.join(T, 'z.jsonl');
  const preLine = usageLine(570000);
  const content = [...filler(6), preLine].join('\n') + '\n';
  fs.writeFileSync(tp, content);
  assert.ok(fs.statSync(tp).size > 262144, 'fixture must exceed the tail window');
  const ignoreBefore = Buffer.byteLength(content, 'utf8'); // compact happened right after this line
  // sanity: the stale line really is inside the tail window when unfiltered
  assert.deepEqual(lib.measureContext(tp, { needFloor: false }), { ok: true, ctx: 570000, floor: null });
  assert.deepEqual(lib.measureContext(tp, { needFloor: false, ignoreBefore }), { ok: false, reason: 'not-yet' });
});

test('sumOutputTokens adds output tokens across assistant lines', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, [1000, 2000]);
  assert.equal(lib.sumOutputTokens(tp), 200);
});

test('loadConfig merges defaults, global and project files', () => {
  const T = tmp();
  const lib = loadLib(T);
  fs.writeFileSync(path.join(T, 'framework.json'), JSON.stringify({ softThreshold: 1 }));
  const proj = path.join(T, 'proj');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'framework.json'), JSON.stringify({ hardThreshold: 2 }));
  const cfg = lib.loadConfig(proj);
  assert.equal(cfg.softThreshold, 1);
  assert.equal(cfg.hardThreshold, 2);
  assert.equal(cfg.ledger, true, 'defaults still merged in');
});
