'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

function frontmatter(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${file} has frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

test('only the ledger hook ships', () => {
  // run-node.sh is not a script-install hook: it is the canonical source that
  // bin/sync-plugins.sh copies into both plugins' hooks/ dirs, so the plugins
  // never invoke a bare `node` that a GUI app's minimal PATH might lack.
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'hooks')).sort(), ['ledger.js', 'lib', 'run-node.sh']);
  const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/settings.patch.json'), 'utf8'));
  assert.deepEqual(Object.keys(patch.hooks).sort(), ['SubagentStart', 'SubagentStop']);
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/framework.defaults.json'), 'utf8'));
  assert.deepEqual(defaults, { ledger: true });
});

test('six agents with the right models and names', () => {
  const expected = { scout: 'haiku', researcher: 'sonnet', worker: 'sonnet', builder: 'opus', judge: 'opus', decider: 'fable' };
  for (const [name, model] of Object.entries(expected)) {
    const fm = frontmatter(`agents/${name}.md`);
    assert.equal(fm.name, name);
    assert.equal(fm.model, model);
    assert.ok(fm.description && fm.description.length > 40, `${name} has a description`);
  }
  assert.equal(frontmatter('agents/decider.md').tools, 'Read, Grep, Glob');
  assert.equal(frontmatter('agents/scout.md').tools, 'Read, Grep, Glob, Bash');
  assert.equal(frontmatter('agents/judge.md').tools, 'Read, Grep, Glob, Bash');
  assert.equal(frontmatter('agents/researcher.md').tools, 'Read, Grep, Glob, WebSearch, WebFetch, ToolSearch');
  assert.equal(frontmatter('agents/worker.md').tools, undefined);
  assert.equal(frontmatter('agents/builder.md').tools, undefined);
});

test('CLAUDE.md block is under 400 words and names every agent and trigger', () => {
  const text = fs.readFileSync(path.join(ROOT, 'claude-md', 'framework-block.md'), 'utf8');
  const words = text.trim().split(/\s+/).length;
  assert.ok(words < 400, `block is ${words} words`);
  for (const a of ['scout', 'researcher', 'worker', 'builder', 'judge', 'decider']) assert.ok(text.includes(a), a);
  for (const t of ['pricing', 'auth', 'deletion', 'schema', 'client-facing', 'irreversible', 'disagreement']) assert.ok(text.includes(t), t);
  assert.ok(text.includes('/handoff'));
  assert.ok(text.includes('code-complete, unverified'));
  assert.ok(!text.includes('<!-- framework:start -->'), 'markers are added by the installer, not the block');
  assert.ok(!/CONTEXT (soft|hard)/.test(text), 'no context policing left in the block');
  assert.ok(!text.includes('## Session start'), 'no session-start section');
});

test('project templates are valid', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/project/.claude/settings.json'), 'utf8'));
  assert.equal(s.disableClaudeAiConnectors, false);
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/project/.claude/framework.json'), 'utf8'));
  assert.equal(f.ledger, true);
  assert.ok(fs.readFileSync(path.join(ROOT, 'templates/project/CLAUDE.md'), 'utf8').includes('Global rules come from'));
});

test('handoff skill has frontmatter and the reply shape', () => {
  const fm = frontmatter('skills/handoff/SKILL.md');
  assert.equal(fm.name, 'handoff');
  assert.ok(fm.description.includes('Use only on a request from {{NAME}} for a handoff or to wrap up.'), 'manual only');
  const text = fs.readFileSync(path.join(ROOT, 'skills/handoff/SKILL.md'), 'utf8');
  assert.ok(text.includes('Handoff saved: <path>'));
  assert.ok(!/\/clear/.test(text), 'no /clear instruction');
  assert.ok(!/CONTEXT (soft|hard)/.test(text), 'no hook-driven triggers');
  for (const s of ['## Goal', '## State', '## Decisions', '## Files touched', '## Next steps', '## Open questions', '## Verify', '## Do not']) assert.ok(text.includes(s), s);
});

test('installed text carries the {{NAME}} placeholder and no hard-coded name', () => {
  const files = ['claude-md/framework-block.md', 'skills/handoff/SKILL.md',
    'modules/context-hygiene/context-rules.md', 'modules/context-hygiene/handoff-SKILL.md'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(text.includes('{{NAME}}'), `${f} uses the placeholder`);
    assert.ok(!text.includes('Jeewan'), `${f} names nobody`);
    // "you" is the default substitution, so no verb may take a third-person -s after the name.
    for (const m of text.match(/\{\{NAME\}\} \w+/g) || []) {
      assert.ok(!/\{\{NAME\}\} \w+s$/.test(m) || /\{\{NAME\}\} (as|is)$/.test(m), `${f}: grammar breaks on "you" in "${m}"`);
    }
  }
});

test('the base settings patch carries hooks only; scalars follow the answers', () => {
  const patch = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings/settings.patch.json'), 'utf8'));
  assert.deepEqual(Object.keys(patch), ['hooks'], 'model, autoCompactWindow and connectors are applied per answer');
});
