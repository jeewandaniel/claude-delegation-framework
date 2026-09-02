'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fw-'));
}

// totals: array of context sizes, one assistant message each.
// opts.sidechain: indexes to mark isSidechain (subagent lines in main transcript).
// opts.noUsage: write one assistant line without a usage object.
function writeTranscript(dir, totals, opts = {}) {
  const lines = [];
  if (opts.noUsage) {
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant' } }));
  } else {
    totals.forEach((t, i) => {
      lines.push(JSON.stringify({
        type: 'assistant',
        isSidechain: Boolean(opts.sidechain && opts.sidechain.includes(i)),
        message: {
          role: 'assistant',
          usage: { input_tokens: 10, cache_read_input_tokens: t - 10, cache_creation_input_tokens: 0, output_tokens: 100 },
        },
      }));
    });
  }
  lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }));
  const p = path.join(dir, 'session.jsonl');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function runHook(name, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* no output is valid */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out };
}

function ctxOf(out) {
  return (out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext) || '';
}

module.exports = { ROOT, tmp, writeTranscript, runHook, ctxOf };
