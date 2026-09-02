'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmp, writeTranscript, runHook, ctxOf } = require('./helpers');

function setup(totals, opts) {
  const T = tmp();
  const tp = writeTranscript(T, totals, opts);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const base = { session_id: 'm-' + path.basename(T), transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  return { T, tp, env, base };
}

test('below soft: floor reported once, then silent', () => {
  const { env, base } = setup([20000, 30000]);
  const r1 = runHook('ctx-meter.js', base, env);
  assert.equal(r1.status, 0);
  assert.match(ctxOf(r1.out), /Session floor: 20k tokens/);
  const r2 = runHook('ctx-meter.js', base, env);
  assert.equal(r2.out, null);
});

test('soft threshold: message on crossing, then every softRemindEvery calls', () => {
  const { env, base } = setup([20000, 155000]);
  const r1 = runHook('ctx-meter.js', base, env);
  assert.match(ctxOf(r1.out), /CONTEXT 155k \(soft limit 150k\)\. Finish the current step, then run \/handoff/);
  for (let i = 0; i < 7; i++) assert.equal(runHook('ctx-meter.js', base, env).out, null, `call ${i + 2} should be silent`);
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /soft limit/);
});

test('hard threshold: STOP message names the handoff path, repeats every hardRemindEvery', () => {
  const { T, env, base } = setup([20000, 195000]);
  const hp = path.join(T, 'memory', 'handoff.md');
  const r1 = runHook('ctx-meter.js', base, env);
  const m = ctxOf(r1.out);
  assert.match(m, /CONTEXT 195k \(hard limit 190k\)\. STOP\. Run \/handoff now/);
  assert.ok(m.includes(hp), 'hard message must include handoff path');
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /STOP/);
});

test('writing the handoff file switches to "Handoff saved" and stale growth resets it', () => {
  const { T, tp, env, base } = setup([20000, 195000]);
  const hp = path.join(T, 'memory', 'handoff.md');
  runHook('ctx-meter.js', base, env);
  const wrote = { ...base, tool_name: 'Write', tool_input: { file_path: hp, content: '# Handoff' } };
  const r = runHook('ctx-meter.js', wrote, env);
  assert.match(ctxOf(r.out), /Handoff saved at \d{4}-\d{2}-\d{2}T.*Tell the user they can \/clear now/);
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
  // context grows by more than handoffStaleTokens: handoff is stale, hard message returns
  writeTranscript(T, [20000, 195000, 230000]);
  const r2 = runHook('ctx-meter.js', { ...base, transcript_path: tp }, env);
  assert.match(ctxOf(r2.out), /STOP\. Run \/handoff now/);
});

test('UserPromptSubmit event echoes its event name', () => {
  const { env, base } = setup([20000, 155000]);
  const r = runHook('ctx-meter.js', { ...base, hook_event_name: 'UserPromptSubmit', tool_name: undefined }, env);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});

test('subagent input produces no output', () => {
  const { env, base } = setup([20000, 195000]);
  const r = runHook('ctx-meter.js', { ...base, agent_id: 'sub-1' }, env);
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
});

test('transcript without usage: unavailable notice once', () => {
  const { env, base } = setup([], { noUsage: true });
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /Context meter unavailable/);
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
});

test('missing transcript_path is unavailable even with a bridge file present (no "null" in message)', () => {
  const T = tmp();
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const session = 'm-' + path.basename(T);
  const base = { session_id: session, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  require('fs').writeFileSync(
    path.join(T, `claude-ctx-${session}.json`),
    JSON.stringify({ remaining_percentage: 5, context_window_size: 200000 })
  );
  const r1 = runHook('ctx-meter.js', base, env);
  const msg = ctxOf(r1.out);
  assert.match(msg, /Context meter unavailable/);
  assert.ok(!msg.includes('null'), 'message must not contain "null"');
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
});

test('garbage stdin exits 0 silently', () => {
  const T = tmp();
  const r = runHook('ctx-meter.js', 'not json', { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('project framework.json overrides thresholds', () => {
  const { T, env, base } = setup([20000, 50000]);
  require('fs').mkdirSync(path.join(T, '.claude'));
  require('fs').writeFileSync(path.join(T, '.claude', 'framework.json'), JSON.stringify({ softThreshold: 40000, hardThreshold: 60000 }));
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /CONTEXT 50k \(soft limit 40k\)/);
});
