'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmp, writeTranscript, runHook } = require('./helpers');

function ledgerFile(T) {
  const dir = path.join(T, 'framework', 'ledger');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return files.length ? path.join(dir, files[0]) : null;
}

test('SubagentStart and SubagentStop append records; stop measures the agent transcript', () => {
  const T = tmp();
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const agentTp = writeTranscript(T, [3000, 8000]);
  runHook('ledger.js', { session_id: 'L1', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'scout', cwd: T }, env);
  runHook('ledger.js', { session_id: 'L1', hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'scout', cwd: T, agent_transcript_path: agentTp }, env);
  const rows = fs.readFileSync(ledgerFile(T), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, 'SubagentStart');
  assert.equal(rows[0].agent_type, 'scout');
  assert.equal(rows[1].event, 'SubagentStop');
  assert.equal(rows[1].context_tokens, 8000);
  assert.equal(rows[1].output_tokens, 200);
  assert.match(path.basename(ledgerFile(T)), /^\d{4}-\d{2}-\d{2}\.jsonl$/);
});

test('ledger disabled by config writes nothing', () => {
  const T = tmp();
  fs.writeFileSync(path.join(T, 'framework.json'), JSON.stringify({ ledger: false }));
  runHook('ledger.js', { session_id: 'L2', hook_event_name: 'SubagentStart', agent_id: 'a', agent_type: 'worker', cwd: T }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(ledgerFile(T), null);
});

test('ledger.sh summarises a day', () => {
  const T = tmp();
  const env = { ...process.env, FRAMEWORK_HOME: T, TMPDIR: T };
  const agentTp = writeTranscript(T, [3000, 8000]);
  runHook('ledger.js', { session_id: 'L3', hook_event_name: 'SubagentStart', agent_id: 'b1', agent_type: 'judge', cwd: T }, env);
  runHook('ledger.js', { session_id: 'L3', hook_event_name: 'SubagentStop', agent_id: 'b1', agent_type: 'judge', cwd: T, agent_transcript_path: agentTp }, env);
  const day = path.basename(ledgerFile(T), '.jsonl');
  const r = spawnSync('bash', [path.join(ROOT, 'bin', 'ledger.sh'), day], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent\truns\tavg_s\toutput_tok\tcontext_tok/);
  assert.match(r.stdout, /judge\t1\t\d+\t200\t8000/);
});
