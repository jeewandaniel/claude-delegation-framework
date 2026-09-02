'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, runHook, ctxOf } = require('./helpers');

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
