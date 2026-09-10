'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MODULE_ROOT, ROOT } = require('./helpers');

function read(...p) {
  return fs.readFileSync(path.join(MODULE_ROOT, ...p), 'utf8');
}
function json(...p) {
  return JSON.parse(read(...p));
}

test('the module ships exactly four hooks, and none of them ship by default', () => {
  assert.deepEqual(
    fs.readdirSync(path.join(MODULE_ROOT, 'hooks')).filter((f) => f.endsWith('.js')).sort(),
    ['ctx-guard.js', 'ctx-meter.js', 'handoff-load.js', 'read-warn.js']
  );
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'hooks')).sort(), ['ledger.js', 'lib'], 'default install stays delegation-only');
});

test('hooks require the lib by its installed path, since install copies them into $DEST/hooks', () => {
  for (const f of fs.readdirSync(path.join(MODULE_ROOT, 'hooks'))) {
    if (!f.endsWith('.js')) continue;
    assert.ok(read('hooks', f).includes("require('./lib/framework-lib')"), f);
  }
});

test('settings patch carries only the four module hook entries and the placeholders', () => {
  const patch = json('settings.patch.json');
  assert.deepEqual(Object.keys(patch), ['hooks'], 'no scalar keys: autoCompactWindow is applied by the installer');
  assert.deepEqual(Object.keys(patch.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'UserPromptSubmit']);
  const commands = Object.values(patch.hooks).flatMap((entries) => entries.flatMap((e) => e.hooks.map((h) => h.command)));
  assert.equal(commands.length, 5, 'ctx-meter runs on two events');
  for (const c of commands) {
    assert.ok(c.includes('{{NODE}}') && c.includes('{{HOOKS_DIR}}'), c);
  }
  assert.equal(patch.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(patch.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit|NotebookEdit');
  assert.deepEqual(patch.hooks.PostToolUse.map((e) => e.matcher), ['.*', 'Read']);
});

test('module defaults hold the threshold keys and nothing the base owns', () => {
  const d = json('framework.defaults.json');
  assert.deepEqual(Object.keys(d).sort(), ['handoffStaleTokens', 'hardRemindEvery', 'hardThreshold', 'readWarnEvery', 'readWarnLines', 'softRemindEvery', 'softThreshold']);
  assert.equal(d.softThreshold, 150000);
  assert.equal(d.hardThreshold, 190000);
  assert.equal(d.ledger, undefined, 'ledger belongs to the base defaults');
});

test('context-rules.md replaces the block section of the same name', () => {
  const section = read('context-rules.md');
  assert.ok(section.trim().startsWith('## Context rules'));
  assert.ok(section.includes('## Session start'), 'the injected handoff needs a session-start rule');
  assert.match(section, /CONTEXT soft/);
  assert.match(section, /CONTEXT hard/);
  const block = fs.readFileSync(path.join(ROOT, 'claude-md', 'framework-block.md'), 'utf8');
  assert.ok(block.includes('## Context rules'), 'the block still has the section this replaces');
  assert.ok(!block.includes('## Session start'), 'the default block has no session-start section');
});

test('module handoff skill reacts to hook messages and ends with /clear', () => {
  const skill = read('handoff-SKILL.md');
  assert.match(skill, /^---\nname: handoff\n/);
  assert.ok(skill.includes('when a hook message says CONTEXT soft or hard'));
  assert.ok(skill.includes('You can /clear now.'));
  assert.ok(skill.includes('Handoff saved: <path>'));
  for (const s of ['## Goal', '## State', '## Decisions', '## Files touched', '## Next steps', '## Open questions', '## Verify', '## Do not']) {
    assert.ok(skill.includes(s), s);
  }
});

test('module README states the default and the interruption cost', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('Off by default'));
  assert.match(readme, /--with-context-hygiene/);
  assert.match(readme, /--without-context-hygiene/);
  assert.match(readme, /unattended or overnight/);
});
