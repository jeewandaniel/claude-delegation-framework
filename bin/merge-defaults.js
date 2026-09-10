#!/usr/bin/env node
'use strict';
// Usage: merge-defaults.js <framework.json> <defaults.json>
// Adds only the keys the target does not already have, so hand-edited values survive a re-install.
const fs = require('fs');

const [target, defaultsFile] = process.argv.slice(2);
if (!target || !defaultsFile) {
  console.error('usage: merge-defaults.js <framework.json> <defaults.json>');
  process.exit(2);
}

const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const defaults = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
const added = [];
for (const [key, value] of Object.entries(defaults)) {
  if (!Object.prototype.hasOwnProperty.call(current, key)) {
    current[key] = value;
    added.push(key);
  }
}
fs.writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
console.log(`defaults merged into ${target}${added.length ? `: ${added.join(', ')}` : ' (nothing missing)'}`);
