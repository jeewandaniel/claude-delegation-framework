#!/usr/bin/env node
'use strict';
// Usage: install-json.js get <file> <key>
//        install-json.js write <file> key=value ... [--keys k1 k2 ...] [--files f1 f2 ...]
//
// $DEST/framework/install.json records the answers this installer was given, the settings.json
// keys it added and the files it wrote, so a re-run can reuse the answers as defaults and
// --uninstall can remove exactly what belongs to the installer and nothing else.
// On write, `settingsKeys` and `files` are unioned with whatever the previous run recorded.
const fs = require('fs');
const path = require('path');

const [mode, file, ...rest] = process.argv.slice(2);
if (!mode || !file) {
  console.error('usage: install-json.js get|write <file> ...');
  process.exit(2);
}
const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

if (mode === 'get') {
  const value = current[rest[0]];
  if (value === undefined || value === null) process.exit(0);
  process.stdout.write(Array.isArray(value) ? value.join('\n') : String(value));
  process.exit(0);
}
if (mode !== 'write') {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}

const out = { version: 1, installedAt: new Date().toISOString() };
let bucket = null;
const keys = [];
const files = [];
for (const arg of rest) {
  if (arg === '--keys') { bucket = keys; continue; }
  if (arg === '--files') { bucket = files; continue; }
  if (bucket) { bucket.push(arg); continue; }
  const i = arg.indexOf('=');
  if (i < 1) {
    console.error(`expected key=value, got: ${arg}`);
    process.exit(2);
  }
  out[arg.slice(0, i)] = arg.slice(i + 1);
}
// A `created*` flag stays true once set: the run that created the file may not be this one.
for (const key of Object.keys(out)) {
  if (key.startsWith('created') && current[key] === 'true') out[key] = 'true';
}
const union = (a, b) => [...new Set([...(a || []), ...b])].sort();
out.settingsKeys = union(current.settingsKeys, keys);
out.files = union(current.files, files);

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
