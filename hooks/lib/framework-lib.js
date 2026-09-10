'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.FRAMEWORK_HOME || path.join(os.homedir(), '.claude');

const DEFAULTS = {
  ledger: true,
};

function readStdin(timeoutMs = 10000) {
  return new Promise((resolve) => {
    let data = '';
    const t = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(t); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(t); resolve(data); });
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function loadConfig(cwd) {
  const global = readJson(path.join(HOME, 'framework.json')) || {};
  const project = cwd ? (readJson(path.join(cwd, '.claude', 'framework.json')) || {}) : {};
  return { ...DEFAULTS, ...global, ...project };
}

function usageTotal(u) {
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

function eachAssistantUsage(transcriptPath, fn) {
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return false; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    const u = d.message && d.message.usage;
    if (!u || typeof u !== 'object') continue;
    fn(u);
  }
  return true;
}

// Transcripts grow without bound; reading the whole file on every tool call is wasteful.
// The latest usage line is almost always inside the last TAIL_BYTES.
const TAIL_BYTES = 262144;

function readTail(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buf, 0, len, start);
    // A partial tail may start mid-line; that line fails JSON.parse and is skipped.
    return { text: buf.toString('utf8'), partial: start > 0, start };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* best effort */ } }
  }
}

// baseOffset: absolute byte offset in the file where `text` begins (0 for a full read, or
// wherever the tail window starts). ignoreBefore: usage lines whose absolute start offset is
// before this are skipped entirely (post-compaction: pre-compaction lines must never count),
// even when the tail window happens to include some of them.
function scanUsage(text, baseOffset = 0, ignoreBefore = null) {
  let first = null;
  let last = null;
  let assistant = 0;
  let offset = baseOffset;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += Buffer.byteLength(line, 'utf8') + 1; // +1 for the '\n' the split ate
    if (ignoreBefore !== null && lineStart < ignoreBefore) continue;
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    assistant += 1;
    const u = d.message && d.message.usage;
    if (!u || typeof u !== 'object') continue;
    const total = usageTotal(u);
    if (!(total > 0)) continue;
    if (first === null) first = total;
    last = total;
  }
  return { first, last, assistant };
}

// reason 'not-yet': the transcript has no assistant lines at all (turn one, or none since
// opts.ignoreBefore) — not measurable yet. reason 'no-usage': assistant lines exist but none
// carry usage — unrecognised format.
// opts.needFloor false: only the latest usage is needed, so a bounded tail read suffices.
// opts.ignoreBefore: byte offset before which usage lines are ignored (see scanUsage above).
function measureContext(transcriptPath, opts = {}) {
  const needFloor = opts.needFloor !== false;
  const ignoreBefore = typeof opts.ignoreBefore === 'number' ? opts.ignoreBefore : null;
  if (!needFloor) {
    const tail = readTail(transcriptPath, TAIL_BYTES);
    if (tail === null) return { ok: false, reason: 'unreadable' };
    const t = scanUsage(tail.text, tail.start, ignoreBefore);
    if (t.last !== null) return { ok: true, ctx: t.last, floor: null };
    if (!tail.partial) return { ok: false, reason: t.assistant > 0 ? 'no-usage' : 'not-yet' };
    // tail held no usage line: fall through to the full read
  }
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return { ok: false, reason: 'unreadable' }; }
  const s = scanUsage(text, 0, ignoreBefore);
  if (s.last === null) return { ok: false, reason: s.assistant > 0 ? 'no-usage' : 'not-yet' };
  return { ok: true, ctx: s.last, floor: s.first };
}

function sumOutputTokens(transcriptPath) {
  let sum = 0;
  let seen = false;
  const readable = eachAssistantUsage(transcriptPath, (u) => {
    if (typeof u.output_tokens === 'number') { sum += u.output_tokens; seen = true; }
  });
  return readable && seen ? sum : null;
}

module.exports = {
  HOME, DEFAULTS, readStdin, readJson, loadConfig,
  measureContext, sumOutputTokens,
};
