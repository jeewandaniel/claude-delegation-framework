'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, runHook, ctxOf } = require('./helpers');

function fileWithLines(T, name, n) {
  const p = path.join(T, name);
  fs.writeFileSync(p, Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n');
  return p;
}
function read(T, sid, fp, extra = {}) {
  return runHook('read-warn.js', { session_id: sid, transcript_path: path.join(T, 's.jsonl'), cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: fp }, ...extra }, { FRAMEWORK_HOME: T, TMPDIR: T });
}

test('warns on a file over readWarnLines, once, then after readWarnEvery more big reads', () => {
  const T = tmp();
  const big = fileWithLines(T, 'big.js', 400);
  const r1 = read(T, 'r1', big);
  assert.match(ctxOf(r1.out), /Main loop read 401 lines of .*big\.js\. Reads this size belong to scout/);
  for (let i = 0; i < 5; i++) assert.equal(read(T, 'r1', big).out, null, `big read ${i + 2} should be debounced`);
  assert.match(ctxOf(read(T, 'r1', big).out), /Main loop read/);
});

test('silent on small files, non-Read tools, subagents, and missing files', () => {
  const T = tmp();
  const small = fileWithLines(T, 'small.js', 100);
  const big = fileWithLines(T, 'big.js', 400);
  assert.equal(read(T, 'r2', small).out, null);
  assert.equal(read(T, 'r2', big, { tool_name: 'Grep' }).out, null);
  assert.equal(read(T, 'r2', big, { agent_id: 'sub' }).out, null);
  assert.equal(read(T, 'r2', path.join(T, 'nope.js')).out, null);
});

test('project override of readWarnLines applies', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, '.claude'));
  fs.writeFileSync(path.join(T, '.claude', 'framework.json'), JSON.stringify({ readWarnLines: 50 }));
  const f = fileWithLines(T, 'mid.js', 80);
  assert.match(ctxOf(read(T, 'r3', f).out), /read 81 lines/);
});
