#!/usr/bin/env node
'use strict';
// Usage: install-json.js get <file> <key>            (a dotted key walks in, e.g. previous.model)
//        install-json.js write <file> key=value ... [--keys k1 ...] [--files f1 ...] [--previous k=json ...]
//
// $DEST/framework/install.json records the answers this installer was given, the settings.json
// keys it added and the files it wrote, so a re-run can reuse the answers as defaults and
// --uninstall can remove exactly what belongs to the installer and nothing else.
// On write, `settingsKeys` and `files` are unioned with whatever the previous run recorded, and
// `previous` collects the value each settings.json key held before this installer first touched it.
// `get` prints an array one element per line and an object one key per line.
const fs = require('fs');
const path = require('path');

const [mode, file, ...rest] = process.argv.slice(2);
if (!mode || !file) {
  console.error('usage: install-json.js get|write <file> ...');
  process.exit(2);
}
const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

if (mode === 'get') {
  let value = current;
  for (const segment of String(rest[0]).split('.')) {
    value = value && typeof value === 'object' ? value[segment] : undefined;
  }
  if (value === undefined || value === null) process.exit(0);
  if (Array.isArray(value)) process.stdout.write(value.join('\n'));
  else if (typeof value === 'object') process.stdout.write(Object.keys(value).join('\n'));
  else process.stdout.write(String(value));
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
const previous = [];
for (const arg of rest) {
  if (arg === '--keys') { bucket = keys; continue; }
  if (arg === '--files') { bucket = files; continue; }
  if (arg === '--previous') { bucket = previous; continue; }
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

// The original value of every settings.json key the installer overwrites, as JSON text, so
// --uninstall can put it back. First run wins, like the `created*` flags: a later run must never
// record the framework's own value as the original. A key the installer *added* is never in here --
// it is in `settingsKeys` instead, and uninstall deletes it rather than restoring anything.
const recorded = {};
for (const arg of previous) {
  const i = arg.indexOf('=');
  if (i < 1) {
    console.error(`expected key=value, got: ${arg}`);
    process.exit(2);
  }
  recorded[arg.slice(0, i)] = arg.slice(i + 1);
}
out.previous = { ...recorded, ...(current.previous || {}) };
for (const key of out.settingsKeys) delete out.previous[key];

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
