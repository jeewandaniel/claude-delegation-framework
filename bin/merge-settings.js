#!/usr/bin/env node
'use strict';
// Usage: merge-settings.js [--remove] <settings.json> <patch.json> <hooksDir> <nodeBin>
// Default: sets scalar keys from the patch; appends hook entries whose command is not already present.
// --remove: deletes the patch's hook entries (matched by command) and leaves scalar keys alone.
const fs = require('fs');

const argv = process.argv.slice(2);
const remove = argv[0] === '--remove';
const [settingsFile, patchFile, hooksDir, nodeBin] = remove ? argv.slice(1) : argv;
if (!settingsFile || !patchFile || !hooksDir || !nodeBin) {
  console.error('usage: merge-settings.js [--remove] <settings.json> <patch.json> <hooksDir> <nodeBin>');
  process.exit(2);
}

const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
if (settings.hooks !== undefined && (typeof settings.hooks !== 'object' || settings.hooks === null || Array.isArray(settings.hooks))) {
  console.error(`${settingsFile}: 'hooks' is not an object; refusing to merge`);
  process.exit(2);
}
const patchRaw = fs.readFileSync(patchFile, 'utf8')
  .replace(/\{\{HOOKS_DIR\}\}/g, hooksDir)
  .replace(/\{\{NODE\}\}/g, nodeBin);
const patch = JSON.parse(patchRaw);

if (remove) {
  const drop = new Set(Object.values(patch.hooks || {}).flatMap((entries) => entries.flatMap((e) => (e.hooks || []).map((h) => h.command))));
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    const kept = entries.filter((e) => !(e.hooks || []).some((h) => drop.has(h.command)));
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
} else {
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
}

fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
console.log(`settings ${remove ? 'pruned' : 'merged'}: ${settingsFile}`);
