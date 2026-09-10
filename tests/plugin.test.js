'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmp, writeTranscript } = require('./helpers');

// https://code.claude.com/docs/en/hooks — the complete hook event list.
const EVENTS = new Set([
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse',
  'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure',
  'PostToolBatch', 'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle',
  'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged',
  'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch',
  'PostModelSwitch', 'Elicitation', 'ElicitationResult', 'SessionEnd',
]);
const SESSION_START_MATCHERS = new Set(['startup', 'resume', 'clear', 'compact', 'fork']);

const PLUGINS = ['delegation', 'context-hygiene'];

function readJson(...p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
}

test('marketplace.json parses and lists both plugins with the required fields', () => {
  const m = readJson('.claude-plugin', 'marketplace.json');
  assert.equal(m.name, 'claude-cost-framework');
  assert.equal(typeof m.owner.name, 'string');
  assert.ok(m.owner.name.length > 0);
  assert.equal(m.plugins.length, 2);
  for (const name of PLUGINS) {
    const entry = m.plugins.find((p) => p.name === name);
    assert.ok(entry, `no marketplace entry for ${name}`);
    assert.equal(entry.source, `./plugins/${name}`);
    assert.equal(entry.version, '1.0.0');
    assert.ok(entry.description && entry.description.length > 0);
    // The source path must actually exist and hold a manifest.
    assert.ok(fs.existsSync(path.join(ROOT, 'plugins', name, '.claude-plugin', 'plugin.json')));
  }
});

test('both plugin.json files parse and carry the required fields', () => {
  for (const name of PLUGINS) {
    const p = readJson('plugins', name, '.claude-plugin', 'plugin.json');
    assert.equal(p.name, name);
    assert.equal(p.version, '1.0.0');
    assert.ok(p.description && p.description.length > 0);
    assert.equal(typeof p.author.name, 'string');
    const opt = p.userConfig.name;
    assert.equal(opt.type, 'string');
    assert.ok(opt.title && opt.description);
    assert.equal(opt.sensitive, false);
    assert.ok(opt.default && opt.default.length > 0);
  }
});

test('both hooks.json files parse, use valid events, and point inside the plugin root', () => {
  for (const name of PLUGINS) {
    const h = readJson('plugins', name, 'hooks', 'hooks.json');
    const events = Object.keys(h.hooks);
    assert.ok(events.length > 0);
    for (const ev of events) {
      assert.ok(EVENTS.has(ev), `${name}: ${ev} is not a hook event name`);
      for (const group of h.hooks[ev]) {
        if (ev === 'SessionStart') {
          for (const m of group.matcher.split('|')) {
            assert.ok(SESSION_START_MATCHERS.has(m), `${name}: bad SessionStart matcher ${m}`);
          }
        }
        for (const hook of group.hooks) {
          assert.equal(hook.type, 'command');
          assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
          const rel = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/)[1];
          assert.ok(fs.existsSync(path.join(ROOT, 'plugins', name, rel)), `${name}: missing ${rel}`);
        }
      }
    }
  }
});

test('delegation registers the ledger on SubagentStart and SubagentStop', () => {
  const h = readJson('plugins', 'delegation', 'hooks', 'hooks.json');
  for (const ev of ['SubagentStart', 'SubagentStop']) {
    const cmds = h.hooks[ev].flatMap((g) => g.hooks.map((x) => x.command));
    assert.equal(cmds.length, 1);
    assert.match(cmds[0], /hooks\/ledger\.js/);
    assert.equal(h.hooks[ev][0].hooks[0].timeout, 5);
  }
});

test('context-hygiene registers the same four module hooks as settings.patch.json, and no handoff skill', () => {
  const h = readJson('plugins', 'context-hygiene', 'hooks', 'hooks.json');
  const patch = readJson('modules', 'context-hygiene', 'settings.patch.json');
  // Same events as the script-install patch.
  assert.deepEqual(Object.keys(h.hooks).sort(), Object.keys(patch.hooks).sort());
  const all = Object.values(h.hooks).flat().flatMap((g) => g.hooks.map((x) => x.command)).join(' ');
  for (const script of ['ctx-meter.js', 'ctx-guard.js', 'read-warn.js', 'handoff-load.js']) {
    assert.match(all, new RegExp(script.replace('.', '\\.')));
  }
  // The handoff skill ships in delegation only; a second copy would collide.
  assert.ok(!fs.existsSync(path.join(ROOT, 'plugins', 'context-hygiene', 'skills')));
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins', 'delegation', 'skills', 'handoff', 'SKILL.md')));
});

test('the copies under plugins/ are in sync with their canonical sources', () => {
  const sync = spawnSync('bash', [path.join(ROOT, 'bin', 'sync-plugins.sh')], { encoding: 'utf8' });
  assert.equal(sync.status, 0, sync.stderr);
  const st = spawnSync('git', ['status', '--porcelain', '--', 'plugins/'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(st.status, 0, st.stderr);
  assert.equal(st.stdout.trim(), '', `bin/sync-plugins.sh changed files:\n${st.stdout}`);
});

test('the handoff skill copy has no {{NAME}} left, the block copy keeps it', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'plugins', 'delegation', 'skills', 'handoff', 'SKILL.md'), 'utf8');
  assert.ok(!skill.includes('{{NAME}}'));
  assert.match(skill, /the user/);
  const block = fs.readFileSync(path.join(ROOT, 'plugins', 'delegation', 'framework-block.md'), 'utf8');
  assert.match(block, /\{\{NAME\}\}/);
});

function runSessionStart(plugin, env = {}) {
  const script = path.join(ROOT, 'plugins', plugin, 'hooks', 'session-start.js');
  const base = { ...process.env };
  delete base.CLAUDE_PLUGIN_OPTION_NAME;
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ session_id: 'S1', hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8',
    // Run from somewhere that is not the plugin dir: paths must resolve from __dirname.
    cwd: require('os').tmpdir(),
    env: { ...base, ...env },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* no output is valid */ }
  return { status: r.status, stdout: r.stdout, out };
}

test('delegation session-start emits the block with the configured name', () => {
  const r = runSessionStart('delegation', { CLAUDE_PLUGIN_OPTION_NAME: 'Sam' });
  assert.equal(r.status, 0);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'SessionStart');
  const ctx = r.out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Sam/);
  assert.ok(!ctx.includes('{{NAME}}'));
  assert.match(ctx, /## Ladder/);
});

test('delegation session-start falls back to "the user" when the option is unset or blank', () => {
  for (const env of [{}, { CLAUDE_PLUGIN_OPTION_NAME: '   ' }]) {
    const r = runSessionStart('delegation', env);
    assert.equal(r.status, 0);
    const ctx = r.out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /the user/);
    assert.ok(!ctx.includes('{{NAME}}'));
  }
});

test('context-hygiene session-start emits the context rules with the name substituted', () => {
  const r = runSessionStart('context-hygiene', { CLAUDE_PLUGIN_OPTION_NAME: 'Sam' });
  assert.equal(r.status, 0);
  const ctx = r.out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /## Context rules/);
  assert.match(ctx, /Sam/);
  assert.ok(!ctx.includes('{{NAME}}'));
});

test('a session-start hook whose source file is missing exits 0 and says nothing', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'hooks'));
  fs.copyFileSync(
    path.join(ROOT, 'plugins', 'delegation', 'hooks', 'session-start.js'),
    path.join(T, 'hooks', 'session-start.js'),
  );
  const r = spawnSync(process.execPath, [path.join(T, 'hooks', 'session-start.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('the plugin copy of ledger.js writes a record into ~/.claude/framework/ledger under a scratch home', () => {
  const T = tmp();
  const env = { ...process.env, FRAMEWORK_HOME: T, TMPDIR: T };
  const script = path.join(ROOT, 'plugins', 'delegation', 'hooks', 'ledger.js');
  const agentTp = writeTranscript(T, [3000, 8000]);
  const run = (input) => spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    // The plugin cache dir is not the project cwd; the ledger must still land in FRAMEWORK_HOME.
    cwd: require('os').tmpdir(),
    env,
  });
  run({ session_id: 'P1', hook_event_name: 'SubagentStart', agent_id: 'p1', agent_type: 'scout', cwd: T });
  run({ session_id: 'P1', hook_event_name: 'SubagentStop', agent_id: 'p1', agent_type: 'scout', cwd: T, agent_transcript_path: agentTp });

  const dir = path.join(T, 'framework', 'ledger');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  const rows = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, 'SubagentStart');
  assert.equal(rows[0].agent_type, 'scout');
  assert.equal(rows[1].context_tokens, 8000);
});

test('the context-hygiene hooks work on built-in defaults with no framework.json merged', () => {
  const T = tmp();
  const libPath = path.join(ROOT, 'plugins', 'context-hygiene', 'hooks', 'lib', 'framework-lib.js');
  // Subprocess with FRAMEWORK_HOME on a scratch dir: nothing has been merged anywhere,
  // so every value must come from the lib's own DEFAULTS.
  const r = spawnSync(process.execPath, [
    '-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(libPath)}).loadConfig(process.argv[1])))`,
    T,
  ], { encoding: 'utf8', env: { ...process.env, FRAMEWORK_HOME: T, TMPDIR: T } });
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(r.stdout);
  const defaults = readJson('modules', 'context-hygiene', 'framework.defaults.json');
  for (const [k, v] of Object.entries(defaults)) {
    assert.equal(cfg[k], v, `${k} does not fall back to the shipped default`);
  }
  assert.equal(cfg.ledger, true);
});
