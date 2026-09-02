'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmp } = require('./helpers');

function install(T) {
  return spawnSync('bash', [path.join(ROOT, 'install.sh')], { encoding: 'utf8', env: { ...process.env, FRAMEWORK_HOME: T } });
}
function commandsFor(settings, event) {
  return (settings.hooks[event] || []).flatMap((e) => e.hooks.map((h) => h.command));
}

test('installs files, merges settings, preserves existing hooks and CLAUDE.md, and is idempotent', () => {
  const T = tmp();
  const gsd = { matcher: 'Bash|Edit', hooks: [{ type: 'command', command: 'node /gsd/context-monitor.js', timeout: 10 }] };
  fs.writeFileSync(path.join(T, 'settings.json'), JSON.stringify({ model: 'opus[1m]', theme: 'dark', hooks: { PostToolUse: [gsd] } }, null, 2));
  fs.writeFileSync(path.join(T, 'CLAUDE.md'), '# My global rules\n\n@RTK.md\n');

  const r1 = install(T);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  for (const f of ['hooks/ctx-meter.js', 'hooks/ctx-guard.js', 'hooks/handoff-load.js', 'hooks/read-warn.js', 'hooks/ledger.js', 'hooks/lib/framework-lib.js',
    'agents/scout.md', 'agents/researcher.md', 'agents/worker.md', 'agents/builder.md', 'agents/judge.md', 'agents/decider.md',
    'skills/handoff/SKILL.md', 'framework.json']) {
    assert.ok(fs.existsSync(path.join(T, f)), f);
  }
  const s1 = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.equal(s1.model, 'sonnet');
  assert.equal(s1.autoCompactWindow, 220000);
  assert.equal(s1.disableClaudeAiConnectors, true);
  assert.equal(s1.theme, 'dark', 'unrelated keys preserved');
  assert.ok(commandsFor(s1, 'PostToolUse').includes('node /gsd/context-monitor.js'), 'existing hook preserved');
  assert.equal(commandsFor(s1, 'PostToolUse').filter((c) => c.includes('ctx-meter.js')).length, 1);
  assert.equal(commandsFor(s1, 'PostToolUse').filter((c) => c.includes('read-warn.js')).length, 1);
  assert.equal(commandsFor(s1, 'UserPromptSubmit').filter((c) => c.includes('ctx-meter.js')).length, 1);
  assert.equal(commandsFor(s1, 'PreToolUse').filter((c) => c.includes('ctx-guard.js')).length, 1);
  assert.equal(commandsFor(s1, 'SessionStart').filter((c) => c.includes('handoff-load.js')).length, 1);
  assert.equal(commandsFor(s1, 'SubagentStart').filter((c) => c.includes('ledger.js')).length, 1);
  assert.equal(commandsFor(s1, 'SubagentStop').filter((c) => c.includes('ledger.js')).length, 1);
  const sessionStart = s1.hooks.SessionStart.find((e) => e.hooks[0].command.includes('handoff-load.js'));
  assert.equal(sessionStart.matcher, 'startup|resume|clear|compact');
  const guard = s1.hooks.PreToolUse.find((e) => e.hooks[0].command.includes('ctx-guard.js'));
  assert.equal(guard.matcher, 'Edit|Write|MultiEdit|NotebookEdit');
  assert.ok(commandsFor(s1, 'PostToolUse').find((c) => c.includes('ctx-meter.js')).startsWith(`"${process.execPath}"`) || commandsFor(s1, 'PostToolUse').find((c) => c.includes('ctx-meter.js')).includes('node'), 'absolute node path used');
  assert.ok(fs.readdirSync(T).some((f) => f.startsWith('settings.json.bak-')), 'backup written');

  const md1 = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.ok(md1.startsWith('# My global rules'), 'existing content kept');
  assert.ok(md1.includes('@RTK.md'));
  assert.equal((md1.match(/<!-- framework:start -->/g) || []).length, 1);
  assert.ok(md1.includes('## Must escalate to decider'));

  const r2 = install(T);
  assert.equal(r2.status, 0, r2.stderr);
  const s2 = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.deepEqual(s2, s1, 'second install changes nothing');
  const md2 = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.equal((md2.match(/<!-- framework:start -->/g) || []).length, 1);
  assert.equal(md2, md1);
});

test('installer refuses invalid settings.json', () => {
  const T = tmp();
  fs.writeFileSync(path.join(T, 'settings.json'), '{ not json');
  const r = install(T);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /not valid JSON/);
});

test('installer creates settings.json and CLAUDE.md when absent', () => {
  const T = tmp();
  const r = install(T);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.equal(s.model, 'sonnet');
  const md = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.ok(md.startsWith('<!-- framework:start -->'));
});
