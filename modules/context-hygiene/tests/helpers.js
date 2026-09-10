'use strict';
// Module test helpers. The module's hooks require('./lib/framework-lib'), the path that is
// correct once install.sh has copied them into $DEST/hooks next to $DEST/hooks/lib. The repo
// keeps them in modules/context-hygiene/hooks, so stage that installed layout and run from it:
// the require path is then exercised exactly as installed.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const base = require('../../../tests/helpers');

const MODULE_ROOT = path.resolve(__dirname, '..');

function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-ctx-hooks-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const f of fs.readdirSync(path.join(MODULE_ROOT, 'hooks'))) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(MODULE_ROOT, 'hooks', f), path.join(dir, f));
  }
  for (const f of fs.readdirSync(path.join(base.ROOT, 'hooks', 'lib'))) {
    fs.copyFileSync(path.join(base.ROOT, 'hooks', 'lib', f), path.join(dir, 'lib', f));
  }
  return dir;
}

const HOOKS_DIR = stage();

function runHook(name, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOKS_DIR, name)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* no output is valid */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out };
}

module.exports = {
  MODULE_ROOT,
  HOOKS_DIR,
  ROOT: base.ROOT,
  tmp: base.tmp,
  writeTranscript: base.writeTranscript,
  ctxOf: base.ctxOf,
  runHook,
};
