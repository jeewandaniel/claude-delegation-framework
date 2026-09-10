#!/usr/bin/env node
'use strict';
// Usage: install-claude-md.js <CLAUDE.md> <block.md> [section.md]
// Replaces the block between the framework markers, or appends it.
// section.md (optional, used by an enabled module): its first '## ' heading names a section of
// block.md, and that whole section is replaced by section.md's contents before writing.
// Every {{NAME}} placeholder becomes $FRAMEWORK_NAME (default "you").
const fs = require('fs');

const argv = process.argv.slice(2);
const START = '<!-- framework:start -->';
const END = '<!-- framework:end -->';

// --remove <CLAUDE.md> [--delete-if-empty]: take the block back out again, for --uninstall.
if (argv[0] === '--remove') {
  const target = argv[1];
  if (!target) {
    console.error('usage: install-claude-md.js --remove <CLAUDE.md> [--delete-if-empty]');
    process.exit(2);
  }
  if (fs.existsSync(target)) {
    const text = fs.readFileSync(target, 'utf8');
    const s = text.indexOf(START);
    const e = text.indexOf(END);
    const rest = s !== -1 && e !== -1 && e > s ? text.slice(0, s) + text.slice(e + END.length) : text;
    const body = rest.trim();
    if (!body && argv.includes('--delete-if-empty')) fs.unlinkSync(target);
    else fs.writeFileSync(target, body ? `${body}\n` : '');
  }
  process.exit(0);
}

const [target, blockFile, sectionFile] = argv;
if (!target || !blockFile) {
  console.error('usage: install-claude-md.js <CLAUDE.md> <block.md> [section.md]');
  process.exit(2);
}

// A section runs from its '## ' heading up to the next '## ' heading, or the end of the block.
function replaceSection(text, section) {
  const lines = section.trim().split('\n');
  const heading = lines[0];
  if (!heading.startsWith('## ')) {
    console.error(`${sectionFile}: must start with a '## ' heading`);
    process.exit(2);
  }
  const blockLines = text.split('\n');
  const start = blockLines.findIndex((l) => l.trim() === heading.trim());
  if (start === -1) {
    console.error(`${blockFile}: has no '${heading.trim()}' section to replace`);
    process.exit(2);
  }
  let end = blockLines.length;
  for (let i = start + 1; i < blockLines.length; i++) {
    if (blockLines[i].startsWith('## ')) { end = i; break; }
  }
  const tail = blockLines.slice(end);
  return [...blockLines.slice(0, start), ...lines, ...(tail.length ? ['', ...tail] : [])].join('\n').trim();
}

let body = fs.readFileSync(blockFile, 'utf8').trim();
if (sectionFile) body = replaceSection(body, fs.readFileSync(sectionFile, 'utf8'));
body = body.split('{{NAME}}').join(process.env.FRAMEWORK_NAME || 'you');
const block = `${START}\n${body}\n${END}`;

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
