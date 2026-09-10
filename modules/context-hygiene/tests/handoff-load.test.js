'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, writeTranscript, runHook, ctxOf } = require('./helpers');

function input(T) {
  return { session_id: 'h1', transcript_path: path.join(T, 's.jsonl'), cwd: T, hook_event_name: 'SessionStart', source: 'clear' };
}

test('no handoff file: silent', () => {
  const T = tmp();
  const r = runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
});

test('handoff file: injected with header, event name SessionStart', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  fs.writeFileSync(path.join(T, 'memory', 'handoff.md'), '# Handoff — proj — 2026-09-02T10:00:00Z\n## Goal\nShip it\n');
  const r = runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T });
  const m = ctxOf(r.out);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(m, /^HANDOFF loaded from .*handoff\.md \(written \d{4}-\d{2}-\d{2}T[^,]+, \d+h old\)\./);
  assert.match(m, /Open your first reply with one line confirming what was resumed/);
  assert.ok(m.includes('## Goal\nShip it'));
  assert.doesNotMatch(m, /older than 14 days/);
});

test('handoff older than 14 days is flagged', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  const hp = path.join(T, 'memory', 'handoff.md');
  fs.writeFileSync(hp, '# old');
  const old = new Date(Date.now() - 20 * 86400000);
  fs.utimesSync(hp, old, old);
  const m = ctxOf(runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T }).out);
  assert.match(m, /20d old/);
  assert.match(m, /older than 14 days/);
});

test('subagent start is ignored', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  fs.writeFileSync(path.join(T, 'memory', 'handoff.md'), '# x');
  const r = runHook('handoff-load.js', { ...input(T), agent_id: 'sub' }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.out, null);
});

test('handoff mtime in the future is clamped to 0h old', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  const hp = path.join(T, 'memory', 'handoff.md');
  fs.writeFileSync(hp, '# future');
  const future = new Date(Date.now() + 5 * 3600000);
  fs.utimesSync(hp, future, future);
  const m = ctxOf(runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T }).out);
  assert.match(m, /, 0h old\)/);
  assert.doesNotMatch(m, /-5h/);
});

test('SessionStart resets the ctx state so a reused session_id no longer blocks edits', () => {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 195000]);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 'reuse-' + path.basename(T);
  const meter = { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  runHook('ctx-meter.js', meter, env);
  const guard = () => runHook('ctx-guard.js',
    { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'src', 'a.js') } }, env);
  assert.equal(guard().out.hookSpecificOutput.permissionDecision, 'deny');

  const r = runHook('handoff-load.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'SessionStart', source: 'clear' }, env);
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(T, `framework-ctx-${sid}.json`)), 'ctx state file must be removed');
  assert.equal(guard().out, null);
});

test('compact source: no output at all, even with a handoff file present', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  fs.writeFileSync(path.join(T, 'memory', 'handoff.md'), '# stale handoff for a different job');
  const r = runHook('handoff-load.js', { ...input(T), source: 'compact' }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.out, null, 'a compaction summary already carries live state; a stale handoff must not be injected');
});

test('compact source: records the transcript byte offset and suppresses the floor line', () => {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 570000]); // pre-compact transcript, as it exists at the moment of compaction
  const sizeAtCompact = fs.statSync(tp).size;
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 'compact-' + path.basename(T);
  const r = runHook('handoff-load.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'SessionStart', source: 'compact' }, env);
  assert.equal(r.out, null);
  const st = JSON.parse(fs.readFileSync(path.join(T, `framework-ctx-${sid}.json`), 'utf8'));
  assert.equal(st.level, 'ok');
  assert.equal(st.ignoreBefore, sizeAtCompact);
  assert.equal(st.floorReported, true, 'no "Session floor" line should re-print for a session that did not just start');
});

test('compact source with no transcript_path: resets state but stores no offset', () => {
  const T = tmp();
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 'compact-no-transcript-' + path.basename(T);
  const r = runHook('handoff-load.js', { session_id: sid, cwd: T, hook_event_name: 'SessionStart', source: 'compact' }, env);
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
  assert.ok(!fs.existsSync(path.join(T, `framework-ctx-${sid}.json`)), 'nothing to store without a transcript');
});

test('compact source: stale pre-compact usage never surfaces, and post-compact usage measures correctly', () => {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 570000]); // the bug: a session that ran hot before compaction
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 'flow-' + path.basename(T);
  const meter = { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  const guard = () => runHook('ctx-guard.js',
    { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'src', 'a.js') } }, env);

  // Pre-compact: the meter (correctly, at the time) reads the stale 570k figure and goes hard.
  runHook('ctx-meter.js', meter, env);
  assert.equal(guard().out.hookSpecificOutput.permissionDecision, 'deny');

  // The harness auto-compacts and fires SessionStart with source "compact" on the same transcript.
  runHook('handoff-load.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'SessionStart', source: 'compact' }, env);
  assert.equal(guard().out, null, 'the hard state must not survive the compaction');

  // No new usage line has been written yet: the meter must stay silent, never report 570k again.
  assert.equal(runHook('ctx-meter.js', meter, env).out, null);
  assert.equal(guard().out, null);

  // A real post-compact turn happens.
  fs.appendFileSync(tp, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', usage: { input_tokens: 10, cache_read_input_tokens: 14990, cache_creation_input_tokens: 0, output_tokens: 50 } },
  }) + '\n');
  assert.equal(runHook('ctx-meter.js', meter, env).out, null, 'well below soft threshold, and no re-printed floor line');
  const st = JSON.parse(fs.readFileSync(path.join(T, `framework-ctx-${sid}.json`), 'utf8'));
  assert.equal(st.ctx, 15000, 'ctx must reflect only the post-compact usage line');
  assert.equal(st.level, 'ok');
  assert.equal(guard().out, null);
});
