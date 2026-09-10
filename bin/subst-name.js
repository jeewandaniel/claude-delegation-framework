#!/usr/bin/env node
'use strict';
// Usage: subst-name.js <src> <dest>
// Copies src to dest, replacing every {{NAME}} placeholder with $FRAMEWORK_NAME (default "you").
const fs = require('fs');

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: subst-name.js <src> <dest>');
  process.exit(2);
}
const name = process.env.FRAMEWORK_NAME || 'you';
fs.writeFileSync(dest, fs.readFileSync(src, 'utf8').split('{{NAME}}').join(name));
