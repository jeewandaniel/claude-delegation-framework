#!/usr/bin/env node
'use strict';
// Usage: install-claude-md.js <CLAUDE.md> <block.md>
// Replaces the block between the framework markers, or appends it.
const fs = require('fs');

const [target, blockFile] = process.argv.slice(2);
if (!target || !blockFile) {
  console.error('usage: install-claude-md.js <CLAUDE.md> <block.md>');
  process.exit(2);
}

const START = '<!-- framework:start -->';
const END = '<!-- framework:end -->';
const block = `${START}\n${fs.readFileSync(blockFile, 'utf8').trim()}\n${END}`;

let text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const s = text.indexOf(START);
const e = text.indexOf(END);
if (s !== -1 && e !== -1 && e > s) {
  text = text.slice(0, s) + block + text.slice(e + END.length);
} else {
  const head = text.trimEnd();
  text = head ? `${head}\n\n${block}\n` : `${block}\n`;
}
fs.writeFileSync(target, text);
console.log(`CLAUDE.md block installed: ${target}`);
