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
  assert.equal(cfg.softRemindEvery, 8);
  assert.equal(cfg.readWarnLines, 300);
  assert.equal(cfg.handoffStaleTokens, 20000);
});

test('handoffPath derives from transcript path', () => {
  const lib = loadLib(tmp());
  assert.equal(lib.handoffPath('/x/y/s.jsonl'), path.join('/x/y', 'memory', 'handoff.md'));
  assert.equal(lib.memoryDir('/x/y/s.jsonl'), path.join('/x/y', 'memory'));
});

test('safeSession rejects traversal and k formats thousands', () => {
  const lib = loadLib(tmp());
  assert.equal(lib.safeSession('abc-123'), 'abc-123');
  assert.equal(lib.safeSession('../x'), null);
  assert.equal(lib.safeSession('a/b'), null);
  assert.equal(lib.safeSession(''), null);
  assert.equal(lib.k(168154), '168k');
  assert.equal(lib.k(20000), '20k');
});

test('state round-trips through aux files in tmpdir', () => {
  const T = tmp();
  process.env.TMPDIR = T;
  const lib = loadLib(T);
  const st = lib.readState('s9');
  assert.equal(st.level, 'ok');
  st.level = 'soft';
  lib.writeState('s9', st);
  assert.equal(lib.readState('s9').level, 'soft');
  assert.ok(fs.existsSync(path.join(T, 'framework-ctx-s9.json')));
});
