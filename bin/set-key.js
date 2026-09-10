#!/usr/bin/env node
'use strict';
// Usage: set-key.js <json file> <key> <json value>
//        set-key.js --delete <json file> <key>...
// Sets one top-level key, printing "added" if the key was absent and `updated <json>` -- the value
// the key held -- if it was already there, so the installer can record which settings keys are its
// own and what it overwrote. --delete removes keys again.
const fs = require('fs');

const argv = process.argv.slice(2);
if (argv[0] === '--delete') {
  const [file, ...keys] = argv.slice(1);
  if (!file || !keys.length) {
    console.error('usage: set-key.js --delete <json file> <key>...');
    process.exit(2);
  }
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of keys) delete obj[k];
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  process.exit(0);
}

const [file, key, raw] = argv;
if (!file || !key || raw === undefined) {
  console.error('usage: set-key.js <json file> <key> <json value>');
  process.exit(2);
}
const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
const had = Object.prototype.hasOwnProperty.call(obj, key);
const before = obj[key];
obj[key] = JSON.parse(raw);
fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
process.stdout.write(had ? `updated ${JSON.stringify(before)}` : 'added');
