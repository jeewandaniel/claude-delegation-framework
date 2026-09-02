#!/usr/bin/env node
'use strict';
// Usage: merge-settings.js <settings.json> <patch.json> <hooksDir> <nodeBin>
// Sets scalar keys from the patch; appends hook entries whose command is not already present.
const fs = require('fs');

const [settingsFile, patchFile, hooksDir, nodeBin] = process.argv.slice(2);
if (!settingsFile || !patchFile || !hooksDir || !nodeBin) {
  console.error('usage: merge-settings.js <settings.json> <patch.json> <hooksDir> <nodeBin>');
  process.exit(2);
}

const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const patchRaw = fs.readFileSync(patchFile, 'utf8')
  .replace(/\{\{HOOKS_DIR\}\}/g, hooksDir)
  .replace(/\{\{NODE\}\}/g, nodeBin);
const patch = JSON.parse(patchRaw);

for (const [key, value] of Object.entries(patch)) {
  if (key !== 'hooks') settings[key] = value;
}

settings.hooks = settings.hooks || {};
for (const [event, entries] of Object.entries(patch.hooks || {})) {
  const existing = settings.hooks[event] = settings.hooks[event] || [];
  const known = new Set(existing.flatMap((e) => (e.hooks || []).map((h) => h.command)));
  for (const entry of entries) {
    const cmd = entry.hooks[0].command;
    if (!known.has(cmd)) {
      existing.push(entry);
      known.add(cmd);
    }
  }
}

fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
console.log(`settings merged: ${settingsFile}`);
