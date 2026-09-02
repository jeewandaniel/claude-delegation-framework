'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.FRAMEWORK_HOME || path.join(os.homedir(), '.claude');

const DEFAULTS = {
  softThreshold: 150000,
  hardThreshold: 190000,
  softRemindEvery: 8,
  hardRemindEvery: 3,
  handoffStaleTokens: 20000,
  readWarnLines: 300,
  readWarnEvery: 5,
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

function safeSession(id) {
  return typeof id === 'string' && id.length > 0 && !/[/\\]|\.\./.test(id) ? id : null;
}

function auxPath(sessionId, name) {
  return path.join(os.tmpdir(), `framework-${name}-${sessionId}.json`);
}
function readAux(sessionId, name) {
  return readJson(auxPath(sessionId, name)) || {};
}
function writeAux(sessionId, name, obj) {
  try { fs.writeFileSync(auxPath(sessionId, name), JSON.stringify(obj)); } catch { /* best effort */ }
}

const STATE_DEFAULTS = {
  ctx: 0, floor: null, level: 'ok',
  handoffWrittenAt: null, handoffCtx: null, handoffAnnounced: false,
  callsSinceMsg: 0, floorReported: false, unavailableReported: false,
};
function readState(sessionId) {
  return { ...STATE_DEFAULTS, ...readAux(sessionId, 'ctx') };
}
function writeState(sessionId, st) {
  writeAux(sessionId, 'ctx', st);
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

function measureContext(transcriptPath) {
  let first = null;
  let last = null;
  const readable = eachAssistantUsage(transcriptPath, (u) => {
    const total = usageTotal(u);
    if (!(total > 0)) return;
    if (first === null) first = total;
    last = total;
  });
  if (!readable) return { ok: false, reason: 'unreadable' };
  if (last === null) return { ok: false, reason: 'no-usage' };
  return { ok: true, ctx: last, floor: first };
}

function sumOutputTokens(transcriptPath) {
  let sum = 0;
  let seen = false;
  const readable = eachAssistantUsage(transcriptPath, (u) => {
    if (typeof u.output_tokens === 'number') { sum += u.output_tokens; seen = true; }
  });
  return readable && seen ? sum : null;
}

// GSD statusline bridge fallback. Only usable if the bridge carries the window size.
function bridgeContext(sessionId) {
  const b = readJson(path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`));
  if (!b || typeof b.remaining_percentage !== 'number' || !(b.context_window_size > 0)) return null;
  return Math.round(b.context_window_size * (100 - b.remaining_percentage) / 100);
}

function memoryDir(transcriptPath) {
  return path.join(path.dirname(transcriptPath), 'memory');
}
function handoffPath(transcriptPath) {
  return path.join(memoryDir(transcriptPath), 'handoff.md');
}

function k(n) {
  return `${Math.round(n / 1000)}k`;
}

function emit(eventName, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }));
}

function isSubagent(input) {
  return Boolean(input && input.agent_id);
}

function samePath(a, b) {
  try { return path.resolve(String(a)) === path.resolve(String(b)); } catch { return false; }
}

module.exports = {
  HOME, DEFAULTS, readStdin, readJson, loadConfig, safeSession,
  auxPath, readAux, writeAux, readState, writeState,
  measureContext, sumOutputTokens, bridgeContext,
  memoryDir, handoffPath, k, emit, isSubagent, samePath,
};
