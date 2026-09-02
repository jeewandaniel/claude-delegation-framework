'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmp, writeTranscript, runHook, ctxOf } = require('./helpers');

function hardSession() {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 195000]);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 'g-' + path.basename(T);
  const meter = { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  runHook('ctx-meter.js', meter, env); // puts the session in hard state
  const guard = (tool_name, file_path) => runHook('ctx-guard.js',
    { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name, tool_input: { file_path } }, env);
  return { T, tp, env, sid, meter, guard, hp: path.join(T, 'memory', 'handoff.md') };
}

test('denies Edit outside the memory dir in hard state, with the handoff path in the reason', () => {
  const { T, guard, hp } = hardSession();
  const r = guard('Edit', path.join(T, 'src', 'app.js'));
  assert.equal(r.status, 0);
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /Context hard limit reached \(195k\)/);
  assert.ok(r.out.hookSpecificOutput.permissionDecisionReason.includes(hp));
});

test('allows writes to the handoff file and to MEMORY.md', () => {
  const { T, guard, hp } = hardSession();
  assert.equal(guard('Write', hp).out, null);
  assert.equal(guard('Write', path.join(T, 'memory', 'MEMORY.md')).out, null);
  assert.equal(guard('Write', path.join(T, 'memory', 'some-fact.md')).out, null);
});

test('allows everything once the handoff has been written', () => {
  const { T, env, meter, guard, hp } = hardSession();
  runHook('ctx-meter.js', { ...meter, tool_name: 'Write', tool_input: { file_path: hp } }, env);
  assert.equal(guard('Edit', path.join(T, 'src', 'app.js')).out, null);
});

test('allows in soft and ok states, and for subagents', () => {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 155000]);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 's-' + path.basename(T);
  runHook('ctx-meter.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} }, env);
  const r = runHook('ctx-guard.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'a.js') } }, env);
  assert.equal(r.out, null);
  const { guard } = hardSession();
  const sub = runHook('ctx-guard.js', { session_id: 'x', agent_id: 'sub', transcript_path: tp, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'a.js') } }, env);
  assert.equal(sub.out, null);
  assert.equal(typeof guard, 'function');
});

test('resolves a relative file_path against input.cwd, not the hook process cwd', () => {
  const { guard } = hardSession();
  assert.equal(guard('Write', 'memory/handoff.md').out, null);
  const r = guard('Edit', 'src/app.js');
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
});

test('ignores tools other than Edit|Write|MultiEdit|NotebookEdit', () => {
  const { T, tp, env, sid } = hardSession();
  const r = runHook('ctx-guard.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }, env);
  assert.equal(r.out, null);
});

test('fails open when state is missing', () => {
  const T = tmp();
  const r = runHook('ctx-guard.js', { session_id: 'nostate', transcript_path: path.join(T, 's.jsonl'), hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'a.js') } }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
  assert.equal(typeof ctxOf(null), 'string');
});
