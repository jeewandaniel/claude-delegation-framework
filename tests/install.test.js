'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmp } = require('./helpers');

function install(T, args = [], env = {}) {
  return spawnSync('bash', [path.join(ROOT, 'install.sh'), ...args], { encoding: 'utf8', env: { ...process.env, FRAMEWORK_HOME: T, ...env } });
}
function commandsFor(settings, event) {
  return (settings.hooks[event] || []).flatMap((e) => e.hooks.map((h) => h.command));
}
function settingsOf(T) {
  return JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
}
// The two scratch dirs differ only by their own path inside every hook command.
function hooksNormalised(T) {
  return JSON.stringify(settingsOf(T).hooks).split(T).join('<DEST>');
}
const MODULE_HOOKS = ['ctx-guard.js', 'ctx-meter.js', 'handoff-load.js', 'read-warn.js'];

test('installs files, merges settings, preserves existing hooks and CLAUDE.md, and is idempotent', () => {
  const T = tmp();
  const gsd = { matcher: 'Bash|Edit', hooks: [{ type: 'command', command: 'node /gsd/context-monitor.js', timeout: 10 }] };
  fs.writeFileSync(path.join(T, 'settings.json'), JSON.stringify({ model: 'opus[1m]', theme: 'dark', hooks: { PostToolUse: [gsd] } }, null, 2));
  fs.writeFileSync(path.join(T, 'CLAUDE.md'), '# My global rules\n\n@RTK.md\n');

  const r1 = install(T);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  for (const f of ['hooks/ledger.js', 'hooks/lib/framework-lib.js',
    'agents/scout.md', 'agents/researcher.md', 'agents/worker.md', 'agents/builder.md', 'agents/judge.md', 'agents/decider.md',
    'skills/handoff/SKILL.md', 'framework.json']) {
    assert.ok(fs.existsSync(path.join(T, f)), f);
  }
  assert.deepEqual(fs.readdirSync(path.join(T, 'hooks')).sort(), ['ledger.js', 'lib'], 'only the ledger hook is installed');
  const s1 = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.equal(s1.model, 'sonnet');
  assert.equal(s1.autoCompactWindow, 220000);
  assert.equal(s1.disableClaudeAiConnectors, true);
  assert.equal(s1.theme, 'dark', 'unrelated keys preserved');
  assert.ok(commandsFor(s1, 'PostToolUse').includes('node /gsd/context-monitor.js'), 'existing hook preserved');
  assert.equal(commandsFor(s1, 'SubagentStart').filter((c) => c.includes('ledger.js')).length, 1);
  assert.equal(commandsFor(s1, 'SubagentStop').filter((c) => c.includes('ledger.js')).length, 1);
  assert.deepEqual(Object.keys(s1.hooks).sort(), ['PostToolUse', 'SubagentStart', 'SubagentStop'], 'only the ledger hooks are added');
  assert.deepEqual(commandsFor(s1, 'PostToolUse'), ['node /gsd/context-monitor.js'], 'no framework hook added to PostToolUse');
  const start = commandsFor(s1, 'SubagentStart')[0];
  assert.ok(start.startsWith(`"${process.execPath}"`) || start.includes('node'), 'absolute node path used');
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

test('installer refuses non-object hooks in settings.json', () => {
  const T = tmp();
  const original = JSON.stringify({ hooks: [] });
  fs.writeFileSync(path.join(T, 'settings.json'), original);
  const r = install(T);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /'hooks' is not an object/);
  assert.equal(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'), original, 'settings.json left unchanged');
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

test('default install carries none of the context-hygiene module', () => {
  const T = tmp();
  const r = install(T);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Context hygiene module: off/);
  assert.deepEqual(fs.readdirSync(path.join(T, 'hooks')).sort(), ['ledger.js', 'lib']);
  const s = settingsOf(T);
  assert.deepEqual(Object.keys(s.hooks).sort(), ['SubagentStart', 'SubagentStop']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(T, 'framework.json'), 'utf8')), { ledger: true });
  assert.ok(!fs.existsSync(path.join(T, 'framework', 'context-hygiene.on')), 'no module marker');
  const md = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes('Never stop work, ask Jeewan to clear'), 'default context rules');
  assert.ok(!md.includes('## Session start'));
  assert.ok(!/CONTEXT (soft|hard)/.test(md));
  const skill = fs.readFileSync(path.join(T, 'skills', 'handoff', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('Use only when Jeewan asks'), 'manual-only handoff skill');
  assert.ok(!skill.includes('/clear'));
});

test('--with-context-hygiene installs the module hooks, settings, defaults, CLAUDE.md section and skill', () => {
  const T = tmp();
  const r = install(T, ['--with-context-hygiene']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Context hygiene module: ON/);
  assert.deepEqual(fs.readdirSync(path.join(T, 'hooks')).sort(), [...MODULE_HOOKS, 'ledger.js', 'lib'].sort());
  assert.ok(fs.existsSync(path.join(T, 'framework', 'context-hygiene.on')), 'module marker written');

  const s = settingsOf(T);
  assert.deepEqual(Object.keys(s.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
  assert.equal(commandsFor(s, 'SessionStart').filter((c) => c.includes('handoff-load.js')).length, 1);
  assert.equal(commandsFor(s, 'UserPromptSubmit').filter((c) => c.includes('ctx-meter.js')).length, 1);
  assert.deepEqual(commandsFor(s, 'PostToolUse').map((c) => path.basename(c.split('"').filter(Boolean).pop() || '')), ['ctx-meter.js', 'read-warn.js']);
  assert.equal(commandsFor(s, 'PreToolUse').filter((c) => c.includes('ctx-guard.js')).length, 1);
  assert.equal(s.model, 'sonnet', 'base scalars still applied');

  const cfg = JSON.parse(fs.readFileSync(path.join(T, 'framework.json'), 'utf8'));
  assert.equal(cfg.ledger, true);
  assert.equal(cfg.softThreshold, 150000);
  assert.equal(cfg.hardThreshold, 190000);

  const md = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes('When a hook says CONTEXT soft'), 'module context rules');
  assert.ok(md.includes('## Session start'));
  assert.ok(!md.includes('Never stop work, ask Jeewan to clear'), 'default context rules replaced');
  assert.ok(md.includes('## Must escalate to decider'), 'the rest of the block is untouched');
  assert.equal((md.match(/<!-- framework:start -->/g) || []).length, 1);
  assert.equal((md.match(/<!-- framework:end -->/g) || []).length, 1);
  assert.ok(md.trimEnd().endsWith('<!-- framework:end -->'), 'end marker still closes the block');

  const skill = fs.readFileSync(path.join(T, 'skills', 'handoff', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes('when a hook message says CONTEXT soft or hard'));
  assert.ok(skill.includes('You can /clear now.'));

  const again = install(T, ['--with-context-hygiene']);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(settingsOf(T), s, 'second module install changes nothing');
  assert.equal(fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8'), md);
});

test('FRAMEWORK_CONTEXT_HYGIENE=1 turns the module on, and a plain re-run keeps the installed mode', () => {
  const T = tmp();
  const r = install(T, [], { FRAMEWORK_CONTEXT_HYGIENE: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Context hygiene module: ON/);
  assert.ok(fs.existsSync(path.join(T, 'hooks', 'ctx-meter.js')));
  const plain = install(T);
  assert.match(plain.stdout, /Context hygiene module: ON/, 'a plain re-run must not silently disable it');
  assert.ok(fs.existsSync(path.join(T, 'hooks', 'ctx-meter.js')));
});

test('--without-context-hygiene returns an installed module to the default state', () => {
  const D = tmp();   // reference: default install
  const M = tmp();   // module install, then removal
  assert.equal(install(D).status, 0);
  assert.equal(install(M, ['--with-context-hygiene']).status, 0);
  assert.notEqual(hooksNormalised(M), hooksNormalised(D), 'sanity: the two differ while the module is on');

  const off = install(M, ['--without-context-hygiene']);
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /Context hygiene module: off/);
  assert.deepEqual(fs.readdirSync(path.join(M, 'hooks')).sort(), ['ledger.js', 'lib'], 'module hook files deleted');
  assert.ok(!fs.existsSync(path.join(M, 'framework', 'context-hygiene.on')), 'marker removed');
  assert.equal(hooksNormalised(M), hooksNormalised(D), 'settings hooks match a default install');
  assert.equal(
    fs.readFileSync(path.join(M, 'CLAUDE.md'), 'utf8'),
    fs.readFileSync(path.join(D, 'CLAUDE.md'), 'utf8'),
    'CLAUDE.md matches a default install'
  );
  assert.equal(
    fs.readFileSync(path.join(M, 'skills', 'handoff', 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(D, 'skills', 'handoff', 'SKILL.md'), 'utf8'),
    'default handoff skill restored'
  );

  const twice = install(M, ['--without-context-hygiene']);
  assert.equal(twice.status, 0, twice.stderr);
  assert.equal(hooksNormalised(M), hooksNormalised(D), 'removal is idempotent');
});

test('installer rejects an unknown flag without touching anything', () => {
  const T = tmp();
  const r = install(T, ['--nope']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown option/);
  assert.ok(!fs.existsSync(path.join(T, 'settings.json')));
});
