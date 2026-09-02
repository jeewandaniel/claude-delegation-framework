# Cost Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global Claude Code framework, installed from this repo into `~/.claude`, that meters session context and forces a handoff before clearing, routes work down a Haiku→Fable agent ladder with a Sonnet main loop, and turns account connectors off by default.

**Architecture:** Plain Node hook scripts sharing one small library (`hooks/lib/framework-lib.js`), driven by Claude Code hook events (`PostToolUse`, `UserPromptSubmit`, `PreToolUse`, `SessionStart`, `SubagentStart`, `SubagentStop`). Markdown agent definitions, one skill, one CLAUDE.md block. An idempotent bash installer merges settings and copies files. Tests run hooks as child processes against fixture transcripts in a temp `FRAMEWORK_HOME`.

**Tech Stack:** Node 20+ (no npm dependencies, `node --test`), bash 3.2-compatible shell scripts (macOS default), Claude Code hooks/settings/agents/skills.

**Spec:** `docs/superpowers/specs/2026-09-02-cost-framework-design.md`

## Global Constraints

- Node 20 or newer; no npm dependencies at all. Tests use the built-in `node:test` and `node:assert`.
- Every hook: 10 s stdin timeout guard, never throws, exits 0 on any internal error, prints nothing unless it has a message. Only `ctx-guard.js` may deny a tool call, and only in the hard state.
- Hooks read `FRAMEWORK_HOME` (default `~/.claude`) for config and ledger, and `os.tmpdir()` (honours `TMPDIR`) for per-session state. Tests set both to a temp dir.
- Handoff path is always derived from the hook input: `dirname(transcript_path)/memory/handoff.md`. Never guessed from `cwd`.
- Config defaults (verbatim from spec §4): `softThreshold 150000`, `hardThreshold 190000`, `softRemindEvery 8`, `hardRemindEvery 3`, `readWarnLines 300`, `readWarnEvery 5`, `ledger true`, plus `handoffStaleTokens 20000` (spec §5.1 stale handoff rule).
- Settings patch (verbatim from spec §4): `"model": "sonnet"`, `"autoCompactWindow": 220000`, `"disableClaudeAiConnectors": true`, hook entries appended without duplicating, existing GSD entries untouched.
- The CLAUDE.md block is installed between `<!-- framework:start -->` and `<!-- framework:end -->` and must stay under 400 words (it is in every prompt).
- Shell scripts must work on macOS bash 3.2: no `mapfile`, no `${arr[@]}` on possibly-empty arrays without the `${arr[@]+"${arr[@]}"}` guard, no `timeout` command.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (shown as a second `-m` in each commit step).
- Work in this repo: `/Users/Jeewan/Desktop/SANT Projects/Frameworks`. Do not install into the real `~/.claude` until Task 9.

---

### Task 1: Repo scaffold, shared library, test harness

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `hooks/lib/framework-lib.js`
- Create: `tests/helpers.js`
- Test: `tests/lib.test.js`

**Interfaces:**
- Produces (used by every later task), all exported from `hooks/lib/framework-lib.js`:
  - `HOME: string` (FRAMEWORK_HOME or `~/.claude`)
  - `DEFAULTS: object`
  - `readStdin(timeoutMs?: number): Promise<string>`
  - `readJson(file: string): object|null`
  - `loadConfig(cwd?: string): object` (DEFAULTS ← global framework.json ← `<cwd>/.claude/framework.json`)
  - `safeSession(id: any): string|null`
  - `auxPath(sessionId, name): string`, `readAux(sessionId, name): object`, `writeAux(sessionId, name, obj): void`
  - `readState(sessionId): object` (the `ctx` aux file with defaults), `writeState(sessionId, st): void`
  - `measureContext(transcriptPath): {ok:true, ctx:number, floor:number} | {ok:false, reason:string}`
  - `sumOutputTokens(transcriptPath): number|null`
  - `bridgeContext(sessionId): number|null`
  - `memoryDir(transcriptPath): string`, `handoffPath(transcriptPath): string`
  - `k(n: number): string` (e.g. `168154 → "168k"`)
  - `emit(eventName: string, additionalContext: string): void`
  - `isSubagent(input): boolean`, `samePath(a, b): boolean`
- `tests/helpers.js` produces: `ROOT`, `tmp()`, `writeTranscript(dir, totals, opts?)`, `runHook(name, input, env?)`, `ctxOf(out)`.

- [ ] **Step 1: Confirm Node and set git identity**

Run:
```bash
node --version && git config user.name "Jeewan" && git config user.email "jeewan@gmail.com"
```
Expected: `v20` or newer printed. If older, stop and report.

- [ ] **Step 2: Create package.json and .gitignore**

`package.json`:
```json
{
  "name": "claude-cost-framework",
  "private": true,
  "description": "Global Claude Code framework: context hygiene, model routing, MCP scoping",
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
*.bak-*
```

- [ ] **Step 3: Write the test helpers**

`tests/helpers.js`:
```js
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
```

- [ ] **Step 4: Write the failing library tests**

`tests/lib.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, writeTranscript } = require('./helpers');

function loadLib(home) {
  process.env.FRAMEWORK_HOME = home;
  delete require.cache[require.resolve('../hooks/lib/framework-lib')];
  return require('../hooks/lib/framework-lib');
}

test('measureContext returns last and first usage totals, ignoring sidechain lines', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, [1000, 5000, 9000], { sidechain: [2] });
  const m = lib.measureContext(tp);
  assert.deepEqual(m, { ok: true, ctx: 5000, floor: 1000 });
});

test('measureContext reports no-usage when nothing usable', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, [], { noUsage: true });
  assert.deepEqual(lib.measureContext(tp), { ok: false, reason: 'no-usage' });
  assert.deepEqual(lib.measureContext(path.join(T, 'missing.jsonl')), { ok: false, reason: 'unreadable' });
});

test('sumOutputTokens adds output tokens across assistant lines', () => {
  const T = tmp();
  const lib = loadLib(T);
  const tp = writeTranscript(T, [1000, 2000]);
  assert.equal(lib.sumOutputTokens(tp), 200);
});

test('loadConfig merges defaults, global and project files', () => {
  const T = tmp();
  const lib = loadLib(T);
  fs.writeFileSync(path.join(T, 'framework.json'), JSON.stringify({ softThreshold: 1 }));
  const proj = path.join(T, 'proj');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'framework.json'), JSON.stringify({ hardThreshold: 2 }));
  const cfg = lib.loadConfig(proj);
  assert.equal(cfg.softThreshold, 1);
  assert.equal(cfg.hardThreshold, 2);
  assert.equal(cfg.softRemindEvery, 8);
  assert.equal(cfg.readWarnLines, 300);
  assert.equal(cfg.handoffStaleTokens, 20000);
});

test('handoffPath derives from transcript path', () => {
  const lib = loadLib(tmp());
  assert.equal(lib.handoffPath('/x/y/s.jsonl'), path.join('/x/y', 'memory', 'handoff.md'));
  assert.equal(lib.memoryDir('/x/y/s.jsonl'), path.join('/x/y', 'memory'));
});

test('safeSession rejects traversal and k formats thousands', () => {
  const lib = loadLib(tmp());
  assert.equal(lib.safeSession('abc-123'), 'abc-123');
  assert.equal(lib.safeSession('../x'), null);
  assert.equal(lib.safeSession('a/b'), null);
  assert.equal(lib.safeSession(''), null);
  assert.equal(lib.k(168154), '168k');
  assert.equal(lib.k(20000), '20k');
});

test('state round-trips through aux files in tmpdir', () => {
  const T = tmp();
  process.env.TMPDIR = T;
  const lib = loadLib(T);
  const st = lib.readState('s9');
  assert.equal(st.level, 'ok');
  st.level = 'soft';
  lib.writeState('s9', st);
  assert.equal(lib.readState('s9').level, 'soft');
  assert.ok(fs.existsSync(path.join(T, 'framework-ctx-s9.json')));
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../hooks/lib/framework-lib'`.

- [ ] **Step 6: Write the library**

`hooks/lib/framework-lib.js`:
```js
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
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: all 7 tests in `tests/lib.test.js` PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore hooks/lib/framework-lib.js tests/helpers.js tests/lib.test.js
git commit -m "feat: scaffold repo, shared hook library, test harness" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Context meter hook

**Files:**
- Create: `hooks/ctx-meter.js`
- Test: `tests/ctx-meter.test.js`

**Interfaces:**
- Consumes: `framework-lib` (Task 1).
- Produces: the per-session state file `framework-ctx-<session>.json` with fields `ctx, floor, level ('ok'|'soft'|'hard'), handoffWrittenAt (ISO|null), handoffCtx, handoffAnnounced, callsSinceMsg, floorReported, unavailableReported`. Task 3's guard reads `level`, `handoffWrittenAt`, `ctx`.
- Message texts (asserted by tests, reused verbatim in the CLAUDE.md block of Task 7): `Session floor: <N>k tokens`, `CONTEXT <N>k (soft limit <S>k). Finish the current step, then run /handoff. Do not start new work.`, `CONTEXT <N>k (hard limit <H>k). STOP. Run /handoff now. File edits are blocked until the handoff file is written at <path>.`, `Handoff saved at <ISO> (<path>). Context <N>k. Tell the user they can /clear now; do not start new work.`, `Context meter unavailable in this session ...`.

- [ ] **Step 1: Write the failing tests**

`tests/ctx-meter.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmp, writeTranscript, runHook, ctxOf } = require('./helpers');

function setup(totals, opts) {
  const T = tmp();
  const tp = writeTranscript(T, totals, opts);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const base = { session_id: 'm-' + path.basename(T), transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  return { T, tp, env, base };
}

test('below soft: floor reported once, then silent', () => {
  const { env, base } = setup([20000, 30000]);
  const r1 = runHook('ctx-meter.js', base, env);
  assert.equal(r1.status, 0);
  assert.match(ctxOf(r1.out), /Session floor: 20k tokens/);
  const r2 = runHook('ctx-meter.js', base, env);
  assert.equal(r2.out, null);
});

test('soft threshold: message on crossing, then every softRemindEvery calls', () => {
  const { env, base } = setup([20000, 155000]);
  const r1 = runHook('ctx-meter.js', base, env);
  assert.match(ctxOf(r1.out), /CONTEXT 155k \(soft limit 150k\)\. Finish the current step, then run \/handoff/);
  for (let i = 0; i < 7; i++) assert.equal(runHook('ctx-meter.js', base, env).out, null, `call ${i + 2} should be silent`);
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /soft limit/);
});

test('hard threshold: STOP message names the handoff path, repeats every hardRemindEvery', () => {
  const { T, env, base } = setup([20000, 195000]);
  const hp = path.join(T, 'memory', 'handoff.md');
  const r1 = runHook('ctx-meter.js', base, env);
  const m = ctxOf(r1.out);
  assert.match(m, /CONTEXT 195k \(hard limit 190k\)\. STOP\. Run \/handoff now/);
  assert.ok(m.includes(hp), 'hard message must include handoff path');
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /STOP/);
});

test('writing the handoff file switches to "Handoff saved" and stale growth resets it', () => {
  const { T, tp, env, base } = setup([20000, 195000]);
  const hp = path.join(T, 'memory', 'handoff.md');
  runHook('ctx-meter.js', base, env);
  const wrote = { ...base, tool_name: 'Write', tool_input: { file_path: hp, content: '# Handoff' } };
  const r = runHook('ctx-meter.js', wrote, env);
  assert.match(ctxOf(r.out), /Handoff saved at \d{4}-\d{2}-\d{2}T.*Tell the user they can \/clear now/);
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
  // context grows by more than handoffStaleTokens: handoff is stale, hard message returns
  writeTranscript(T, [20000, 195000, 230000]);
  const r2 = runHook('ctx-meter.js', { ...base, transcript_path: tp }, env);
  assert.match(ctxOf(r2.out), /STOP\. Run \/handoff now/);
});

test('UserPromptSubmit event echoes its event name', () => {
  const { env, base } = setup([20000, 155000]);
  const r = runHook('ctx-meter.js', { ...base, hook_event_name: 'UserPromptSubmit', tool_name: undefined }, env);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});

test('subagent input produces no output', () => {
  const { env, base } = setup([20000, 195000]);
  const r = runHook('ctx-meter.js', { ...base, agent_id: 'sub-1' }, env);
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
});

test('transcript without usage: unavailable notice once', () => {
  const { env, base } = setup([], { noUsage: true });
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /Context meter unavailable/);
  assert.equal(runHook('ctx-meter.js', base, env).out, null);
});

test('garbage stdin exits 0 silently', () => {
  const T = tmp();
  const r = runHook('ctx-meter.js', 'not json', { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('project framework.json overrides thresholds', () => {
  const { T, env, base } = setup([20000, 50000]);
  require('fs').mkdirSync(path.join(T, '.claude'));
  require('fs').writeFileSync(path.join(T, '.claude', 'framework.json'), JSON.stringify({ softThreshold: 40000, hardThreshold: 60000 }));
  assert.match(ctxOf(runHook('ctx-meter.js', base, env).out), /CONTEXT 50k \(soft limit 40k\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/ctx-meter.test.js`
Expected: FAIL, hook file missing (`status` not 0 or output empty).

- [ ] **Step 3: Write the meter**

`hooks/ctx-meter.js`:
```js
#!/usr/bin/env node
'use strict';
// Context meter: PostToolUse (all tools) + UserPromptSubmit.
// Measures live context from the transcript, injects soft/hard prompts, tracks handoff state.
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input)) return;
  const session = lib.safeSession(input.session_id);
  if (!session) return;

  const event = input.hook_event_name || 'PostToolUse';
  const cfg = lib.loadConfig(input.cwd);
  const st = lib.readState(session);
  const msgs = [];

  const m = input.transcript_path ? lib.measureContext(input.transcript_path) : { ok: false, reason: 'no-transcript' };
  let ctx = null;
  if (m.ok) {
    ctx = m.ctx;
    if (st.floor === null) st.floor = m.floor;
  } else {
    const b = lib.bridgeContext(session);
    if (b !== null) ctx = b;
  }

  if (ctx === null) {
    if (!st.unavailableReported) {
      st.unavailableReported = true;
      msgs.push('Context meter unavailable in this session (transcript usage not found). Treat context size as unknown and run /handoff early rather than late.');
    }
    lib.writeState(session, st);
    if (msgs.length) lib.emit(event, msgs.join('\n'));
    return;
  }

  st.ctx = ctx;
  if (!st.floorReported && st.floor !== null) {
    st.floorReported = true;
    msgs.push(`Session floor: ${lib.k(st.floor)} tokens of context before the first message.`);
  }

  const hp = input.transcript_path ? lib.handoffPath(input.transcript_path) : null;

  // Handoff written this call?
  if (event === 'PostToolUse' && hp && /^(Write|Edit|MultiEdit)$/.test(input.tool_name || '')
      && input.tool_input && lib.samePath(input.tool_input.file_path || '', hp)) {
    st.handoffWrittenAt = new Date().toISOString();
    st.handoffCtx = ctx;
    st.handoffAnnounced = false;
  }

  // Handoff gone stale: context grew a lot since it was written.
  if (st.handoffWrittenAt && st.handoffCtx !== null && ctx - st.handoffCtx > cfg.handoffStaleTokens) {
    st.handoffWrittenAt = null;
    st.handoffCtx = null;
    st.handoffAnnounced = false;
    st.callsSinceMsg = Number.MAX_SAFE_INTEGER;
  }

  const level = ctx >= cfg.hardThreshold ? 'hard' : ctx >= cfg.softThreshold ? 'soft' : 'ok';
  const levelChanged = level !== st.level;
  st.level = level;
  st.callsSinceMsg = Math.min(st.callsSinceMsg + 1, Number.MAX_SAFE_INTEGER);

  if (level !== 'ok') {
    if (st.handoffWrittenAt) {
      if (!st.handoffAnnounced || st.callsSinceMsg >= cfg.softRemindEvery) {
        st.handoffAnnounced = true;
        st.callsSinceMsg = 0;
        msgs.push(`Handoff saved at ${st.handoffWrittenAt} (${hp}). Context ${lib.k(ctx)}. Tell the user they can /clear now; do not start new work.`);
      }
    } else {
      const every = level === 'hard' ? cfg.hardRemindEvery : cfg.softRemindEvery;
      if (levelChanged || st.callsSinceMsg >= every) {
        st.callsSinceMsg = 0;
        msgs.push(level === 'hard'
          ? `CONTEXT ${lib.k(ctx)} (hard limit ${lib.k(cfg.hardThreshold)}). STOP. Run /handoff now. File edits are blocked until the handoff file is written at ${hp}.`
          : `CONTEXT ${lib.k(ctx)} (soft limit ${lib.k(cfg.softThreshold)}). Finish the current step, then run /handoff. Do not start new work.`);
      }
    }
  }

  lib.writeState(session, st);
  if (msgs.length) lib.emit(event, msgs.join('\n'));
})().catch(() => { /* never fail a tool call */ });
```

Run: `chmod +x hooks/ctx-meter.js`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ctx-meter.test.js`
Expected: 9 tests PASS. If "soft threshold" fails on call counts, check that `callsSinceMsg` resets to 0 only when a message is emitted.

- [ ] **Step 5: Commit**

```bash
git add hooks/ctx-meter.js tests/ctx-meter.test.js
git commit -m "feat: context meter hook with soft/hard thresholds and handoff tracking" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Edit guard hook (hard state)

**Files:**
- Create: `hooks/ctx-guard.js`
- Test: `tests/ctx-guard.test.js`

**Interfaces:**
- Consumes: state file fields `level`, `handoffWrittenAt`, `ctx` written by `ctx-meter.js` (Task 2); `lib.memoryDir`, `lib.handoffPath`.
- Produces: on deny, stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`; on allow, no output.

- [ ] **Step 1: Write the failing tests**

`tests/ctx-guard.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmp, writeTranscript, runHook, ctxOf } = require('./helpers');

function hardSession() {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 195000]);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 'g-' + path.basename(T);
  const meter = { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} };
  runHook('ctx-meter.js', meter, env); // puts the session in hard state
  const guard = (tool_name, file_path) => runHook('ctx-guard.js',
    { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name, tool_input: { file_path } }, env);
  return { T, tp, env, meter, guard, hp: path.join(T, 'memory', 'handoff.md') };
}

test('denies Edit outside the memory dir in hard state, with the handoff path in the reason', () => {
  const { T, guard, hp } = hardSession();
  const r = guard('Edit', path.join(T, 'src', 'app.js'));
  assert.equal(r.status, 0);
  assert.equal(r.out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /Context hard limit reached \(195k\)/);
  assert.ok(r.out.hookSpecificOutput.permissionDecisionReason.includes(hp));
});

test('allows writes to the handoff file and to MEMORY.md', () => {
  const { T, guard, hp } = hardSession();
  assert.equal(guard('Write', hp).out, null);
  assert.equal(guard('Write', path.join(T, 'memory', 'MEMORY.md')).out, null);
  assert.equal(guard('Write', path.join(T, 'memory', 'some-fact.md')).out, null);
});

test('allows everything once the handoff has been written', () => {
  const { T, env, meter, guard, hp } = hardSession();
  runHook('ctx-meter.js', { ...meter, tool_name: 'Write', tool_input: { file_path: hp } }, env);
  assert.equal(guard('Edit', path.join(T, 'src', 'app.js')).out, null);
});

test('allows in soft and ok states, and for subagents', () => {
  const T = tmp();
  const tp = writeTranscript(T, [20000, 155000]);
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const sid = 's-' + path.basename(T);
  runHook('ctx-meter.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} }, env);
  const r = runHook('ctx-guard.js', { session_id: sid, transcript_path: tp, cwd: T, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'a.js') } }, env);
  assert.equal(r.out, null);
  const { guard } = hardSession();
  const sub = runHook('ctx-guard.js', { session_id: 'x', agent_id: 'sub', transcript_path: tp, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'a.js') } }, env);
  assert.equal(sub.out, null);
  assert.equal(typeof guard, 'function');
});

test('fails open when state is missing', () => {
  const T = tmp();
  const r = runHook('ctx-guard.js', { session_id: 'nostate', transcript_path: path.join(T, 's.jsonl'), hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(T, 'a.js') } }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
  assert.equal(typeof ctxOf(null), 'string');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/ctx-guard.test.js`
Expected: FAIL (hook missing).

- [ ] **Step 3: Write the guard**

`hooks/ctx-guard.js`:
```js
#!/usr/bin/env node
'use strict';
// Edit guard: PreToolUse on Edit|Write|MultiEdit|NotebookEdit.
// In the hard state, before the handoff is written, only writes inside the memory dir are allowed.
const path = require('path');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input)) return;
  const session = lib.safeSession(input.session_id);
  if (!session || !input.transcript_path) return;

  const st = lib.readState(session);
  if (st.level !== 'hard' || st.handoffWrittenAt) return;

  const ti = input.tool_input || {};
  const target = ti.file_path || ti.notebook_path || '';
  const memDir = lib.memoryDir(input.transcript_path);
  if (target) {
    const rel = path.relative(memDir, path.resolve(target));
    const inMemory = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inMemory) return;
  }

  const hp = lib.handoffPath(input.transcript_path);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Context hard limit reached (${lib.k(st.ctx)}). Write the handoff first: ${hp}. Run /handoff; edits are allowed again once it is written.`,
    },
  }));
})().catch(() => { /* fail open */ });
```

Run: `chmod +x hooks/ctx-guard.js`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ctx-guard.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/ctx-guard.js tests/ctx-guard.test.js
git commit -m "feat: edit guard blocks non-handoff writes in hard context state" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Handoff skill and session-start loader

**Files:**
- Create: `skills/handoff/SKILL.md`
- Create: `hooks/handoff-load.js`
- Test: `tests/handoff-load.test.js`

**Interfaces:**
- Consumes: `lib.handoffPath`, `lib.emit`.
- Produces: SessionStart `additionalContext` beginning with `HANDOFF loaded from <path> (written <ISO>, <age>).` followed by the file content. The skill writes the file whose path the meter announces.

- [ ] **Step 1: Write the failing tests**

`tests/handoff-load.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, runHook, ctxOf } = require('./helpers');

function input(T) {
  return { session_id: 'h1', transcript_path: path.join(T, 's.jsonl'), cwd: T, hook_event_name: 'SessionStart', source: 'clear' };
}

test('no handoff file: silent', () => {
  const T = tmp();
  const r = runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.status, 0);
  assert.equal(r.out, null);
});

test('handoff file: injected with header, event name SessionStart', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  fs.writeFileSync(path.join(T, 'memory', 'handoff.md'), '# Handoff — proj — 2026-09-02T10:00:00Z\n## Goal\nShip it\n');
  const r = runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T });
  const m = ctxOf(r.out);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(m, /^HANDOFF loaded from .*handoff\.md \(written \d{4}-\d{2}-\d{2}T[^,]+, \d+h old\)\./);
  assert.match(m, /Open your first reply with one line confirming what was resumed/);
  assert.ok(m.includes('## Goal\nShip it'));
  assert.doesNotMatch(m, /older than 14 days/);
});

test('handoff older than 14 days is flagged', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  const hp = path.join(T, 'memory', 'handoff.md');
  fs.writeFileSync(hp, '# old');
  const old = new Date(Date.now() - 20 * 86400000);
  fs.utimesSync(hp, old, old);
  const m = ctxOf(runHook('handoff-load.js', input(T), { FRAMEWORK_HOME: T, TMPDIR: T }).out);
  assert.match(m, /20d old/);
  assert.match(m, /older than 14 days/);
});

test('subagent start is ignored', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, 'memory'));
  fs.writeFileSync(path.join(T, 'memory', 'handoff.md'), '# x');
  const r = runHook('handoff-load.js', { ...input(T), agent_id: 'sub' }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(r.out, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/handoff-load.test.js`
Expected: FAIL (hook missing).

- [ ] **Step 3: Write the loader**

`hooks/handoff-load.js`:
```js
#!/usr/bin/env node
'use strict';
// SessionStart (startup|resume|clear|compact): inject the project's handoff file if present.
const fs = require('fs');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input) || !input.transcript_path) return;

  const hp = lib.handoffPath(input.transcript_path);
  let content;
  let stat;
  try {
    content = fs.readFileSync(hp, 'utf8');
    stat = fs.statSync(hp);
  } catch { return; }

  const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
  const age = ageDays < 1 ? `${Math.round(ageDays * 24)}h old` : `${Math.round(ageDays)}d old`;
  const stale = ageDays > 14
    ? ' This handoff is older than 14 days; confirm with the user that it is still current before acting on it.'
    : '';
  const header = `HANDOFF loaded from ${hp} (written ${stat.mtime.toISOString()}, ${age}). `
    + 'Open your first reply with one line confirming what was resumed, then continue from "Next steps". Ask before deviating.'
    + stale;
  lib.emit('SessionStart', `${header}\n\n${content}`);
})().catch(() => { /* silent */ });
```

Run: `chmod +x hooks/handoff-load.js`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/handoff-load.test.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Write the skill**

`skills/handoff/SKILL.md`:
```markdown
---
name: handoff
description: Write the session handoff file so the session can be cleared without losing anything. Use when a hook message says CONTEXT soft or hard, when Jeewan asks to wrap up or pause, or before ending a long task. Writes handoff.md in the project's Claude memory directory, then tells Jeewan they can /clear.
---

# /handoff

Goal: the next session, starting on an empty context, continues without asking Jeewan to repeat anything.

## Steps

1. Locate the memory directory. The system prompt names it ("persistent file-based memory at ..."). If a hook message gave a handoff path, use exactly that path. Create the directory if it is missing.
2. If `handoff.md` already exists there, rename it to `handoff-prev.md`, replacing any older `handoff-prev.md`.
3. List every file you touched this session (edits, writes, commits) by scanning what you actually did, not from memory. Include paths outside the project if you touched them.
4. Run the verification commands you are about to list (tests, build, curl) when they are cheap, and record their real output. If you did not run one, write "not run".
5. Write `handoff.md` with exactly these sections, in this order. "none" is a valid value. Keep the file under 150 lines.

```
# Handoff — <project directory name> — <ISO timestamp>
## Goal
<what we are trying to achieve, one paragraph>
## State
<where things stand right now, concrete>
## Decisions
<each decision with its evidence: path:line, URL, or command output>
## Files touched
<one line per path: what changed>
## Next steps
<exactly the next three actions, in order>
## Open questions
<what needs Jeewan>
## Verify
<commands and their last known result>
## Do not
<anything the next session must not do>
```

6. If durable facts emerged this session (a preference, a project constraint, a reference URL), save each as its own memory file with a `MEMORY.md` index line, following the memory instructions in the system prompt. The handoff is for continuity; memory is for facts that outlive this task.
7. Reply to Jeewan in exactly this shape and nothing more:

```
Handoff saved: <path>
- Goal: <one line>
- State: <one line>
- Next: <one line>
- Open: <one line or "none">
- Verify: <one command or "none">
You can /clear now. The next session will load this automatically.
```

## Rules

- Start no new work once the handoff begins.
- Do not summarise from memory when the transcript has the facts.
- Every decision line carries evidence or says "no evidence, judgment call".
- If writing the file fails, report the exact error to Jeewan and stop; do not claim it was saved.
```

- [ ] **Step 6: Commit**

```bash
git add hooks/handoff-load.js tests/handoff-load.test.js skills/handoff/SKILL.md
git commit -m "feat: handoff skill and session-start loader" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Big-read warning hook

**Files:**
- Create: `hooks/read-warn.js`
- Test: `tests/read-warn.test.js`

**Interfaces:**
- Consumes: `lib.loadConfig` (`readWarnLines`, `readWarnEvery`), `lib.readAux/writeAux` with aux name `read` (separate file from the meter's `ctx` state to avoid write races on the same PostToolUse).
- Produces: PostToolUse `additionalContext`: `Main loop read <n> lines of <path>. Reads this size belong to scout; delegate the next one and ask for a compact report.`

- [ ] **Step 1: Write the failing tests**

`tests/read-warn.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp, runHook, ctxOf } = require('./helpers');

function fileWithLines(T, name, n) {
  const p = path.join(T, name);
  fs.writeFileSync(p, Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n');
  return p;
}
function read(T, sid, fp, extra = {}) {
  return runHook('read-warn.js', { session_id: sid, transcript_path: path.join(T, 's.jsonl'), cwd: T, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: fp }, ...extra }, { FRAMEWORK_HOME: T, TMPDIR: T });
}

test('warns on a file over readWarnLines, once, then after readWarnEvery more big reads', () => {
  const T = tmp();
  const big = fileWithLines(T, 'big.js', 400);
  const r1 = read(T, 'r1', big);
  assert.match(ctxOf(r1.out), /Main loop read 401 lines of .*big\.js\. Reads this size belong to scout/);
  for (let i = 0; i < 5; i++) assert.equal(read(T, 'r1', big).out, null, `big read ${i + 2} should be debounced`);
  assert.match(ctxOf(read(T, 'r1', big).out), /Main loop read/);
});

test('silent on small files, non-Read tools, subagents, and missing files', () => {
  const T = tmp();
  const small = fileWithLines(T, 'small.js', 100);
  const big = fileWithLines(T, 'big.js', 400);
  assert.equal(read(T, 'r2', small).out, null);
  assert.equal(read(T, 'r2', big, { tool_name: 'Grep' }).out, null);
  assert.equal(read(T, 'r2', big, { agent_id: 'sub' }).out, null);
  assert.equal(read(T, 'r2', path.join(T, 'nope.js')).out, null);
});

test('project override of readWarnLines applies', () => {
  const T = tmp();
  fs.mkdirSync(path.join(T, '.claude'));
  fs.writeFileSync(path.join(T, '.claude', 'framework.json'), JSON.stringify({ readWarnLines: 50 }));
  const f = fileWithLines(T, 'mid.js', 80);
  assert.match(ctxOf(read(T, 'r3', f).out), /read 81 lines/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/read-warn.test.js`
Expected: FAIL (hook missing).

- [ ] **Step 3: Write the hook**

`hooks/read-warn.js`:
```js
#!/usr/bin/env node
'use strict';
// PostToolUse on Read (main loop only): warn when the main loop reads a large file itself.
const fs = require('fs');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input) || input.tool_name !== 'Read') return;
  const session = lib.safeSession(input.session_id);
  if (!session) return;
  const fp = input.tool_input && input.tool_input.file_path;
  if (!fp) return;

  let lines;
  try {
    const text = fs.readFileSync(fp, 'utf8');
    lines = text.length ? text.split('\n').length : 0;
  } catch { return; }

  const cfg = lib.loadConfig(input.cwd);
  if (lines <= cfg.readWarnLines) return;

  const aux = lib.readAux(session, 'read');
  aux.bigReads = (aux.bigReads || 0) + 1;
  const fire = aux.bigReads === 1 || aux.bigReads > cfg.readWarnEvery + 1;
  if (fire) aux.bigReads = 1;
  lib.writeAux(session, 'read', aux);
  if (!fire) return;

  lib.emit('PostToolUse', `Main loop read ${lines} lines of ${fp}. Reads this size belong to scout; delegate the next one and ask for a compact report.`);
})().catch(() => { /* silent */ });
```

Run: `chmod +x hooks/read-warn.js`

Note on the count: a 400-line file written with a trailing newline splits into 401 parts; the test expects 401. That matches how the model sees the file (trailing empty line), and precision here does not matter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/read-warn.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/read-warn.js tests/read-warn.test.js
git commit -m "feat: warn main loop on large self-reads" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Usage ledger hook and summary script

**Files:**
- Create: `hooks/ledger.js`
- Create: `bin/ledger.sh`
- Test: `tests/ledger.test.js`

**Interfaces:**
- Consumes: `lib.HOME`, `lib.loadConfig().ledger`, `lib.measureContext`, `lib.sumOutputTokens`.
- Produces: append-only `<HOME>/framework/ledger/<YYYY-MM-DD>.jsonl`, one record per event: `{ts, event, session_id, agent_id, agent_type, model, cwd, context_tokens?, output_tokens?}`. `bin/ledger.sh [YYYY-MM-DD]` prints a tab table `agent runs avg_s output_tok context_tok`.

- [ ] **Step 1: Write the failing tests**

`tests/ledger.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmp, writeTranscript, runHook } = require('./helpers');

function ledgerFile(T) {
  const dir = path.join(T, 'framework', 'ledger');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return files.length ? path.join(dir, files[0]) : null;
}

test('SubagentStart and SubagentStop append records; stop measures the agent transcript', () => {
  const T = tmp();
  const env = { FRAMEWORK_HOME: T, TMPDIR: T };
  const agentTp = writeTranscript(T, [3000, 8000]);
  runHook('ledger.js', { session_id: 'L1', hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'scout', cwd: T }, env);
  runHook('ledger.js', { session_id: 'L1', hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'scout', cwd: T, agent_transcript_path: agentTp }, env);
  const rows = fs.readFileSync(ledgerFile(T), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, 'SubagentStart');
  assert.equal(rows[0].agent_type, 'scout');
  assert.equal(rows[1].event, 'SubagentStop');
  assert.equal(rows[1].context_tokens, 8000);
  assert.equal(rows[1].output_tokens, 200);
  assert.match(path.basename(ledgerFile(T)), /^\d{4}-\d{2}-\d{2}\.jsonl$/);
});

test('ledger disabled by config writes nothing', () => {
  const T = tmp();
  fs.writeFileSync(path.join(T, 'framework.json'), JSON.stringify({ ledger: false }));
  runHook('ledger.js', { session_id: 'L2', hook_event_name: 'SubagentStart', agent_id: 'a', agent_type: 'worker', cwd: T }, { FRAMEWORK_HOME: T, TMPDIR: T });
  assert.equal(ledgerFile(T), null);
});

test('ledger.sh summarises a day', () => {
  const T = tmp();
  const env = { ...process.env, FRAMEWORK_HOME: T, TMPDIR: T };
  const agentTp = writeTranscript(T, [3000, 8000]);
  runHook('ledger.js', { session_id: 'L3', hook_event_name: 'SubagentStart', agent_id: 'b1', agent_type: 'judge', cwd: T }, env);
  runHook('ledger.js', { session_id: 'L3', hook_event_name: 'SubagentStop', agent_id: 'b1', agent_type: 'judge', cwd: T, agent_transcript_path: agentTp }, env);
  const day = path.basename(ledgerFile(T), '.jsonl');
  const r = spawnSync('bash', [path.join(ROOT, 'bin', 'ledger.sh'), day], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /agent\truns\tavg_s\toutput_tok\tcontext_tok/);
  assert.match(r.stdout, /judge\t1\t\d+\t200\t8000/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/ledger.test.js`
Expected: FAIL (hook missing).

- [ ] **Step 3: Write the hook**

`hooks/ledger.js`:
```js
#!/usr/bin/env node
'use strict';
// SubagentStart / SubagentStop: append one record per event to the daily ledger.
const fs = require('fs');
const path = require('path');
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const cfg = lib.loadConfig(input.cwd);
  if (!cfg.ledger) return;

  const now = new Date();
  const rec = {
    ts: now.toISOString(),
    event: input.hook_event_name || null,
    session_id: input.session_id || null,
    agent_id: input.agent_id || null,
    agent_type: input.agent_type || null,
    model: input.model || null,
    cwd: input.cwd || null,
  };
  // Only the subagent's own transcript is meaningful for token counts.
  const tp = input.agent_transcript_path || null;
  if (rec.event === 'SubagentStop' && tp) {
    const m = lib.measureContext(tp);
    if (m.ok) rec.context_tokens = m.ctx;
    const out = lib.sumOutputTokens(tp);
    if (out !== null) rec.output_tokens = out;
  }

  const dir = path.join(lib.HOME, 'framework', 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${now.toISOString().slice(0, 10)}.jsonl`), JSON.stringify(rec) + '\n');
})().catch(() => { /* silent */ });
```

Run: `chmod +x hooks/ledger.js`

- [ ] **Step 4: Write the summary script**

`bin/ledger.sh`:
```bash
#!/usr/bin/env bash
# Summarise one day of the subagent usage ledger. Usage: ledger.sh [YYYY-MM-DD]
set -euo pipefail
DIR="${FRAMEWORK_HOME:-$HOME/.claude}/framework/ledger"
DAY="${1:-$(date +%Y-%m-%d)}"
FILE="$DIR/$DAY.jsonl"
if [ ! -f "$FILE" ]; then
  echo "no ledger for $DAY at $FILE"
  exit 0
fi
node -e '
const fs = require("fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const starts = new Map();
const agg = {};
for (const r of rows) {
  if (r.event === "SubagentStart" && r.agent_id) starts.set(r.agent_id, r);
  if (r.event === "SubagentStop") {
    const t = r.agent_type || "unknown";
    const a = agg[t] = agg[t] || { runs: 0, secs: 0, out: 0, ctx: 0 };
    a.runs++;
    const s = r.agent_id && starts.get(r.agent_id);
    if (s) a.secs += (Date.parse(r.ts) - Date.parse(s.ts)) / 1000;
    a.out += r.output_tokens || 0;
    a.ctx += r.context_tokens || 0;
  }
}
console.log(["agent", "runs", "avg_s", "output_tok", "context_tok"].join("\t"));
for (const [t, a] of Object.entries(agg)) console.log([t, a.runs, (a.secs / a.runs).toFixed(0), a.out, a.ctx].join("\t"));
' "$FILE"
```

Run: `chmod +x bin/ledger.sh`

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/ledger.test.js`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add hooks/ledger.js bin/ledger.sh tests/ledger.test.js
git commit -m "feat: subagent usage ledger and daily summary" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Agents, CLAUDE.md block, project templates

**Files:**
- Create: `agents/scout.md`, `agents/worker.md`, `agents/judge.md` (copied from the existing `~/.claude/agents/`, content reproduced below so the repo owns them)
- Create: `agents/researcher.md`, `agents/builder.md`, `agents/decider.md`
- Create: `claude-md/framework-block.md`
- Create: `templates/project/CLAUDE.md`, `templates/project/.claude/settings.json`, `templates/project/.claude/framework.json`
- Test: `tests/content.test.js`

**Interfaces:**
- Produces: agent names `scout, researcher, worker, builder, judge, decider` used by the CLAUDE.md block and by the installer (Task 8). Models exactly `haiku, sonnet, sonnet, opus, opus, fable`.

- [ ] **Step 1: Write the failing content tests**

`tests/content.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

function frontmatter(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${file} has frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

test('six agents with the right models and names', () => {
  const expected = { scout: 'haiku', researcher: 'sonnet', worker: 'sonnet', builder: 'opus', judge: 'opus', decider: 'fable' };
  for (const [name, model] of Object.entries(expected)) {
    const fm = frontmatter(`agents/${name}.md`);
    assert.equal(fm.name, name);
    assert.equal(fm.model, model);
    assert.ok(fm.description && fm.description.length > 40, `${name} has a description`);
  }
  assert.equal(frontmatter('agents/decider.md').tools, 'Read, Grep, Glob');
  assert.equal(frontmatter('agents/scout.md').tools, 'Read, Grep, Glob, Bash');
});

test('CLAUDE.md block is under 400 words and names every agent and trigger', () => {
  const text = fs.readFileSync(path.join(ROOT, 'claude-md', 'framework-block.md'), 'utf8');
  const words = text.trim().split(/\s+/).length;
  assert.ok(words < 400, `block is ${words} words`);
  for (const a of ['scout', 'researcher', 'worker', 'builder', 'judge', 'decider']) assert.ok(text.includes(a), a);
  for (const t of ['pricing', 'auth', 'deletion', 'schema', 'client-facing', 'irreversible', 'disagreement']) assert.ok(text.includes(t), t);
  assert.ok(text.includes('/handoff'));
  assert.ok(text.includes('code-complete, unverified'));
  assert.ok(!text.includes('<!-- framework:start -->'), 'markers are added by the installer, not the block');
});

test('project templates are valid', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/project/.claude/settings.json'), 'utf8'));
  assert.equal(s.disableClaudeAiConnectors, false);
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/project/.claude/framework.json'), 'utf8'));
  assert.equal(typeof f.softThreshold, 'number');
  assert.ok(fs.readFileSync(path.join(ROOT, 'templates/project/CLAUDE.md'), 'utf8').includes('Global rules come from'));
});

test('handoff skill has frontmatter and the reply shape', () => {
  const fm = frontmatter('skills/handoff/SKILL.md');
  assert.equal(fm.name, 'handoff');
  const text = fs.readFileSync(path.join(ROOT, 'skills/handoff/SKILL.md'), 'utf8');
  assert.ok(text.includes('You can /clear now. The next session will load this automatically.'));
  for (const s of ['## Goal', '## State', '## Decisions', '## Files touched', '## Next steps', '## Open questions', '## Verify', '## Do not']) assert.ok(text.includes(s), s);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content.test.js`
Expected: FAIL (files missing) except the handoff skill test, which passes from Task 4.

- [ ] **Step 3: Write the three existing agents into the repo**

`agents/scout.md`:
```markdown
---
name: scout
description: Cheap mechanical gatherer — locate files, inventory code, grep sweeps, list/collect facts. Read-only. Use for any "find where X is / list all Y / what files mention Z" task. NEVER use for judgment, verification, or anything correctness-critical (Haiku confabulates under ambiguity — return raw findings, no conclusions).
model: haiku
tools: Read, Grep, Glob, Bash
---

You are a read-only scout. Your ONLY job is to locate and collect: file paths, line numbers, symbol locations, match lists, counts, inventories.

Rules:
- NEVER edit, create, or delete anything. Read-only, always.
- Return COMPACT structured output: paths with line numbers, short verbatim excerpts (a few lines max), counts. No prose analysis, no recommendations, no conclusions.
- If you are not certain something exists, say "not found" — do NOT guess or fill in plausible-looking names, ids, or paths. A wrong path is worse than "not found."
- Keep your final answer small: the caller pays to read it. Bullet lists over paragraphs. Omit everything you were not asked for. Under 300 words unless asked for an inventory.
```

`agents/worker.md`:
```markdown
---
name: worker
description: Default workhorse for real tasks — implement a change, write/fix tests, read and summarize code or diffs, draft docs. Use for any bounded task with clear inputs and a verifiable output. Not for final verification of correctness-critical claims (use judge), not for hard multi-file work (use builder), and not for trivial lookups (use scout).
model: sonnet
---

You are the implementation workhorse. You get a bounded task; you do it end-to-end and report compactly.

Rules:
- Surgical changes only: match the surrounding style, edit the minimum, no drive-by refactors, no speculative abstractions.
- If the task is code: run the relevant tests/typecheck before reporting. Report the ACTUAL command output result (pass/fail counts), not "should work."
- HONESTY BAR (non-negotiable, project-wide): "unit tests pass" is NOT "done" or "working". Anything you produce that has not been exercised against the live running system is at most "code-complete, unit-green, UNVERIFIED". Use exactly that language. Never claim "fixed"/"works" for something you could not run for real.
- If you get stuck, the task is ambiguous, or it grows past three files: STOP and report what you tried and what decision is needed — do not improvise scope. The caller will escalate to builder.
- Return a compact summary: what changed (files:lines), test results, what remains unverified. The caller pays to read your output — no walls of text, no restating the task. Under 300 words.
```

`agents/judge.md`:
```markdown
---
name: judge
description: Adversarial verifier for correctness-critical claims — "is this bug real?", "does this fix actually hold?", "is this finding refutable?". Read-only; verdicts with evidence. Use AFTER scouts/workers/builders produce findings or fixes, before anything is treated as true. Expensive — send it claims worth judging, not bulk work.
model: opus
tools: Read, Grep, Glob, Bash
---

You are an adversarial judge. You receive a specific claim (a bug finding, a fix, an assertion about behavior) and your job is to try to REFUTE it against the actual code.

Rules:
- Default skeptical: attempt to break the claim. Trace the real code paths (read the files, follow the call chain) — never accept the claim's own description of the code as true.
- Verdict must be one of: CONFIRMED (with the exact file:line evidence), REFUTED (with the evidence that kills it), or UNPROVEN (state exactly what's missing to decide). If uncertain, UNPROVEN — never round up to CONFIRMED.
- Distinguish layers explicitly: "logically correct in code" ≠ "works on a real host". If a claim can only be settled by a live/browser run you cannot perform, say so — verdict UNPROVEN, with the exact live test that would settle it.
- Read-only: never edit files. You judge; others fix.
- Return compactly: verdict, 2-5 lines of evidence, one line on what would change your mind.
```

- [ ] **Step 4: Write the three new agents**

`agents/researcher.md`:
```markdown
---
name: researcher
description: Cited research — official docs via Context7, web search and fetch, reading code. Use for "how does X work / what does the doc say / what are the options" questions. Returns findings with a URL or path:line on every claim; never returns uncited claims. Not for implementation (worker/builder) and not for trivial lookups (scout).
model: sonnet
tools: Read, Grep, Glob, WebSearch, WebFetch, ToolSearch
---

You are a researcher. You answer questions with cited evidence only.

Rules:
- Every finding carries its source: a URL (prefer official docs; use Context7 through ToolSearch when it is available) or `path:line` in the repo. A claim without a source is a defect: drop it, or mark it "unverified" explicitly.
- Prefer primary sources over blog posts. Note the doc's date or version when it matters.
- Do not decide or recommend beyond the question asked. Report what the sources say, including where they disagree.
- If you cannot find it, say "not found" and list where you looked. Never fill gaps with plausible guesses.
- Return compactly: numbered findings, one to three lines each, source on each line. Under 300 words unless asked for a document. No preamble.
```

`agents/builder.md`:
```markdown
---
name: builder
description: Hard implementation — changes across more than three files, tricky bugs, concurrency, migrations, anything worker returned as ambiguous or failed once. Runs tests and reports honestly. Use worker for bounded routine changes; use builder when judgment across files is needed.
model: opus
---

You are the senior implementer. You get a hard, bounded task and finish it end-to-end.

Rules:
- Read what you need to understand the change; do not read the whole repo. Follow existing patterns and style.
- Surgical: minimum diff, no drive-by refactors, no speculative abstractions.
- Run the relevant tests, typecheck and build before reporting. Report actual command output (pass/fail counts).
- HONESTY BAR: "unit tests pass" is not "done". Anything not exercised against the live running system is "code-complete, unit-green, UNVERIFIED". Use those words. Never claim "fixed" or "works" for something you could not run.
- If the task is ambiguous, or you hit a decision touching architecture, money, auth, data deletion, or client-facing wording: STOP and report the decision needed with the evidence you have. Do not improvise.
- Return compactly: what changed (path:line), test results, what remains unverified, decisions needed. Under 300 words.
```

`agents/decider.md`:
```markdown
---
name: decider
description: Decisions only, on the most capable model. Use for the listed escalation triggers (money or pricing, auth or security, data deletion, architecture or schema, client-facing wording, irreversible actions, disagreement between agents). Input must be a briefing with question, options, evidence and constraints. Returns a decision with reasoning, or UNDECIDED with the missing evidence. Read-only; expensive; never for bulk work.
model: fable
tools: Read, Grep, Glob
---

You are the decider. You receive a briefing and return a decision. You are stern about evidence.

Rules:
- Read the cited lines and files in the briefing yourself. Never accept the briefing's description of the code as true.
- If the evidence is insufficient to decide safely, return UNDECIDED and list exactly what would settle it (file to read, command to run, doc to check). Do not decide on plausibility.
- Weigh what happens if the decision is wrong. The irreversible option needs stronger evidence than the reversible one.
- Push back on scope creep and on any option that skips verification.

Output, under 250 words, in exactly this order:

DECISION: <one of the options, or UNDECIDED>
WHY: <two to five lines, each tied to a piece of evidence>
RISK: <the single most important risk of this decision>
REVERSE IF: <what new evidence would change the decision>
MISSING: <only when UNDECIDED: the exact evidence needed>
```

- [ ] **Step 5: Write the CLAUDE.md block**

`claude-md/framework-block.md`:
```markdown
# Cost framework (global)

You are the main loop on a cheap model. Your job: understand Jeewan, route work, write tight briefings, integrate compact reports, and decide only what the ladder cannot. You do not implement beyond one-line edits, and you do not read large files yourself.

## Ladder (Agent tool, subagent_type)
- scout (Haiku): lookups, greps, inventories. Facts only.
- researcher (Sonnet): docs via Context7, web, reading. Every finding cited.
- worker (Sonnet): bounded implementation, tests run.
- builder (Opus): more than three files, concurrency, migrations, anything worker called ambiguous or failed once.
- judge (Opus): adversarial verification before any claim reaches Jeewan as true.
- decider (Fable): decisions only, from a briefing with question, options, evidence, constraints.

## Must escalate to decider
Money, pricing or billing logic; auth, security or data deletion; architecture or schema changes; client-facing wording; anything irreversible (deploy, push to a default branch, DNS, sending email or messages, publishing); any disagreement between two agents; any request to bypass the evidence rule.

## Evidence rule
No briefing to decider without evidence: path:line, a researcher URL, or command output. Missing it? Dispatch scout or researcher first. Nobody says "should work", "fixed" or "done" for anything not run; say "code-complete, unverified". Any bug claim, any "fixed", any performance or security assertion goes through judge before Jeewan hears it.

## Context rules
Subagent reports are the only thing that enters your context: ask for under 300 words, path:line, one-word verdicts. Prefer one subagent call over reading three files. When a hook says CONTEXT soft: finish the step, run /handoff. CONTEXT hard: stop and run /handoff immediately; edits are blocked until then. After the handoff, tell Jeewan the path, a five-line summary, and "You can /clear now."

## Session start
If a HANDOFF was loaded, open with one line confirming what was resumed and continue from its next steps. If the "Session floor" line is above 40k tokens, say once that connectors or extra plugins may be on for this project.
```

- [ ] **Step 6: Write the project templates**

`templates/project/CLAUDE.md`:
```markdown
# <Project name>

<!-- Thin per-project file. Global rules come from ~/.claude/CLAUDE.md (cost framework). Put only project-specific facts here. -->

## What this is
<one paragraph>

## Commands
- dev: 
- test: 
- deploy: 

## Gotchas
- 
```

`templates/project/.claude/settings.json`:
```json
{
  "disableClaudeAiConnectors": false
}
```

`templates/project/.claude/framework.json`:
```json
{
  "softThreshold": 150000,
  "hardThreshold": 190000
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/content.test.js`
Expected: 4 tests PASS. If the word-count test fails, trim the block; do not raise the limit.

- [ ] **Step 8: Commit**

```bash
git add agents claude-md templates tests/content.test.js
git commit -m "feat: agent ladder, global CLAUDE.md block, project templates" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Settings patch, defaults, and idempotent installer

**Files:**
- Create: `settings/framework.defaults.json`
- Create: `settings/settings.patch.json`
- Create: `bin/merge-settings.js`
- Create: `bin/install-claude-md.js`
- Create: `install.sh`
- Test: `tests/install.test.js`

**Interfaces:**
- Consumes: every file from Tasks 1 to 7.
- Produces: `install.sh` (env `FRAMEWORK_HOME` overrides the destination, default `~/.claude`); `bin/merge-settings.js <settings.json> <patch.json> <hooksDir> <nodeBin>`; `bin/install-claude-md.js <CLAUDE.md> <block.md>`. Placeholders in the patch: `{{HOOKS_DIR}}`, `{{NODE}}`.

- [ ] **Step 1: Write the failing installer test**

`tests/install.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmp } = require('./helpers');

function install(T) {
  return spawnSync('bash', [path.join(ROOT, 'install.sh')], { encoding: 'utf8', env: { ...process.env, FRAMEWORK_HOME: T } });
}
function commandsFor(settings, event) {
  return (settings.hooks[event] || []).flatMap((e) => e.hooks.map((h) => h.command));
}

test('installs files, merges settings, preserves existing hooks and CLAUDE.md, and is idempotent', () => {
  const T = tmp();
  const gsd = { matcher: 'Bash|Edit', hooks: [{ type: 'command', command: 'node /gsd/context-monitor.js', timeout: 10 }] };
  fs.writeFileSync(path.join(T, 'settings.json'), JSON.stringify({ model: 'opus[1m]', theme: 'dark', hooks: { PostToolUse: [gsd] } }, null, 2));
  fs.writeFileSync(path.join(T, 'CLAUDE.md'), '# My global rules\n\n@RTK.md\n');

  const r1 = install(T);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  for (const f of ['hooks/ctx-meter.js', 'hooks/ctx-guard.js', 'hooks/handoff-load.js', 'hooks/read-warn.js', 'hooks/ledger.js', 'hooks/lib/framework-lib.js',
    'agents/scout.md', 'agents/researcher.md', 'agents/worker.md', 'agents/builder.md', 'agents/judge.md', 'agents/decider.md',
    'skills/handoff/SKILL.md', 'framework.json']) {
    assert.ok(fs.existsSync(path.join(T, f)), f);
  }
  const s1 = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.equal(s1.model, 'sonnet');
  assert.equal(s1.autoCompactWindow, 220000);
  assert.equal(s1.disableClaudeAiConnectors, true);
  assert.equal(s1.theme, 'dark', 'unrelated keys preserved');
  assert.ok(commandsFor(s1, 'PostToolUse').includes('node /gsd/context-monitor.js'), 'existing hook preserved');
  assert.equal(commandsFor(s1, 'PostToolUse').filter((c) => c.includes('ctx-meter.js')).length, 1);
  assert.equal(commandsFor(s1, 'PostToolUse').filter((c) => c.includes('read-warn.js')).length, 1);
  assert.equal(commandsFor(s1, 'UserPromptSubmit').filter((c) => c.includes('ctx-meter.js')).length, 1);
  assert.equal(commandsFor(s1, 'PreToolUse').filter((c) => c.includes('ctx-guard.js')).length, 1);
  assert.equal(commandsFor(s1, 'SessionStart').filter((c) => c.includes('handoff-load.js')).length, 1);
  assert.equal(commandsFor(s1, 'SubagentStart').filter((c) => c.includes('ledger.js')).length, 1);
  assert.equal(commandsFor(s1, 'SubagentStop').filter((c) => c.includes('ledger.js')).length, 1);
  const sessionStart = s1.hooks.SessionStart.find((e) => e.hooks[0].command.includes('handoff-load.js'));
  assert.equal(sessionStart.matcher, 'startup|resume|clear|compact');
  const guard = s1.hooks.PreToolUse.find((e) => e.hooks[0].command.includes('ctx-guard.js'));
  assert.equal(guard.matcher, 'Edit|Write|MultiEdit|NotebookEdit');
  assert.ok(commandsFor(s1, 'PostToolUse').find((c) => c.includes('ctx-meter.js')).startsWith(`"${process.execPath}"`) || commandsFor(s1, 'PostToolUse').find((c) => c.includes('ctx-meter.js')).includes('node'), 'absolute node path used');
  assert.ok(fs.readdirSync(T).some((f) => f.startsWith('settings.json.bak-')), 'backup written');

  const md1 = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.ok(md1.startsWith('# My global rules'), 'existing content kept');
  assert.ok(md1.includes('@RTK.md'));
  assert.equal((md1.match(/<!-- framework:start -->/g) || []).length, 1);
  assert.ok(md1.includes('## Must escalate to decider'));

  const r2 = install(T);
  assert.equal(r2.status, 0, r2.stderr);
  const s2 = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.deepEqual(s2, s1, 'second install changes nothing');
  const md2 = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.equal((md2.match(/<!-- framework:start -->/g) || []).length, 1);
  assert.equal(md2, md1);
});

test('installer refuses invalid settings.json', () => {
  const T = tmp();
  fs.writeFileSync(path.join(T, 'settings.json'), '{ not json');
  const r = install(T);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /not valid JSON/);
});

test('installer creates settings.json and CLAUDE.md when absent', () => {
  const T = tmp();
  const r = install(T);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(fs.readFileSync(path.join(T, 'settings.json'), 'utf8'));
  assert.equal(s.model, 'sonnet');
  const md = fs.readFileSync(path.join(T, 'CLAUDE.md'), 'utf8');
  assert.ok(md.startsWith('<!-- framework:start -->'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/install.test.js`
Expected: FAIL (install.sh missing).

- [ ] **Step 3: Write the defaults and the settings patch**

`settings/framework.defaults.json`:
```json
{
  "softThreshold": 150000,
  "hardThreshold": 190000,
  "softRemindEvery": 8,
  "hardRemindEvery": 3,
  "handoffStaleTokens": 20000,
  "readWarnLines": 300,
  "readWarnEvery": 5,
  "ledger": true
}
```

`settings/settings.patch.json`:
```json
{
  "model": "sonnet",
  "autoCompactWindow": 220000,
  "disableClaudeAiConnectors": true,
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/handoff-load.js\"", "timeout": 5 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/ctx-meter.js\"", "timeout": 5 }] }
    ],
    "PostToolUse": [
      { "matcher": ".*", "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/ctx-meter.js\"", "timeout": 5 }] },
      { "matcher": "Read", "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/read-warn.js\"", "timeout": 5 }] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/ctx-guard.js\"", "timeout": 5 }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/ledger.js\"", "timeout": 5 }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "\"{{NODE}}\" \"{{HOOKS_DIR}}/ledger.js\"", "timeout": 5 }] }
    ]
  }
}
```

- [ ] **Step 4: Write the two Node helpers**

`bin/merge-settings.js`:
```js
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
```

`bin/install-claude-md.js`:
```js
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
```

- [ ] **Step 5: Write the installer**

`install.sh`:
```bash
#!/usr/bin/env bash
# Install the cost framework into a Claude Code config directory (default ~/.claude).
# Idempotent: safe to re-run after every change to this repo.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${FRAMEWORK_HOME:-$HOME/.claude}"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node not found on PATH; install Node 20+ first" >&2
  exit 1
fi

mkdir -p "$DEST/hooks/lib" "$DEST/agents" "$DEST/skills/handoff" "$DEST/framework/ledger"

cp "$REPO"/hooks/*.js "$DEST/hooks/"
cp "$REPO"/hooks/lib/*.js "$DEST/hooks/lib/"
cp "$REPO"/agents/*.md "$DEST/agents/"
cp "$REPO"/skills/handoff/SKILL.md "$DEST/skills/handoff/SKILL.md"
chmod +x "$DEST"/hooks/*.js

if [ ! -f "$DEST/framework.json" ]; then
  cp "$REPO/settings/framework.defaults.json" "$DEST/framework.json"
fi

SETTINGS="$DEST/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
if ! "$NODE" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$SETTINGS" 2>/dev/null; then
  echo "$SETTINGS is not valid JSON; refusing to touch it" >&2
  exit 1
fi
BAK="$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"
cp "$SETTINGS" "$BAK"
"$NODE" "$REPO/bin/merge-settings.js" "$SETTINGS" "$REPO/settings/settings.patch.json" "$DEST/hooks" "$NODE"

CLAUDE_MD="$DEST/CLAUDE.md"
"$NODE" "$REPO/bin/install-claude-md.js" "$CLAUDE_MD" "$REPO/claude-md/framework-block.md"

echo "Installed cost framework into $DEST"
echo "Settings backup: $BAK"
echo "Next: turn ultracode off in the session UI, restart Claude Code, run bin/measure.sh in a project."
```

Run: `chmod +x install.sh bin/merge-settings.js bin/install-claude-md.js`

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/install.test.js`
Expected: 3 tests PASS. Then run the full suite: `npm test`, expected all green.

- [ ] **Step 7: Commit**

```bash
git add settings bin/merge-settings.js bin/install-claude-md.js install.sh tests/install.test.js
git commit -m "feat: settings patch and idempotent installer" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Measurement script, README, real install and acceptance

**Files:**
- Create: `bin/measure.sh`
- Create: `README.md`
- Modify: real `~/.claude/` via `install.sh` (this is the first task allowed to)

**Interfaces:**
- Consumes: everything.
- Produces: `bin/measure.sh [--no-mcp|--bare]` printing `first-turn context: <N> tokens (<cwd>)`.

- [ ] **Step 1: Write the measurement script**

`bin/measure.sh`:
```bash
#!/usr/bin/env bash
# Print the first-turn context size (tokens) of a headless Claude Code session started in the cwd.
# Usage: measure.sh [--no-mcp] [--bare]
#   --no-mcp  disable local MCP servers
#   --bare    also ignore user settings (plugins, hooks, skills)
set -euo pipefail

ARGS=()
for a in "$@"; do
  case "$a" in
    --no-mcp) ARGS+=(--strict-mcp-config --mcp-config '{"mcpServers":{}}') ;;
    --bare)   ARGS+=(--setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}') ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p "Reply with the single word ok." \
  --model haiku --output-format json --max-turns 1 ${ARGS[@]+"${ARGS[@]}"} 2>/dev/null \
| node -e '
let raw = "";
process.stdin.on("data", (c) => { raw += c; }).on("end", () => {
  let d;
  try { d = JSON.parse(raw); } catch { console.error("could not parse claude output"); process.exit(1); }
  const u = d.usage || {};
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  console.log(`first-turn context: ${ctx} tokens (${process.cwd()})`);
});'
```

Run: `chmod +x bin/measure.sh && bin/measure.sh`
Expected: `first-turn context: <about 30000> tokens (...Frameworks)`. Record the number for the README.

- [ ] **Step 2: Write the README**

`README.md`:
```markdown
# Claude Cost Framework

Global Claude Code setup that keeps quality while cutting usage-limit consumption. Three pieces:

1. **Context hygiene.** A hook meters live context from the session transcript. At 150k it asks for a handoff; at 190k it blocks file edits until `/handoff` has written the handoff file; after `/clear`, the next session loads that file automatically.
2. **Routing.** Sonnet main loop, six agents: scout (Haiku), researcher (Sonnet), worker (Sonnet), builder (Opus), judge (Opus), decider (Fable). Listed escalation triggers and an evidence rule live in the global CLAUDE.md block.
3. **MCP scoping.** Account connectors off globally, back on per project with `templates/project/.claude/settings.json`.

Design: `docs/superpowers/specs/2026-09-02-cost-framework-design.md`.

## Install / update

```bash
./install.sh
```

Copies hooks, agents and the handoff skill into `~/.claude`, merges settings (backup written first), and replaces the block between `<!-- framework:start -->` and `<!-- framework:end -->` in `~/.claude/CLAUDE.md`. Re-run after any change here. Restart Claude Code afterwards.

Manual step the installer cannot do: turn **ultracode off** in the session UI.

## Per project

Copy `templates/project/` into a project that needs account connectors (Gmail, Ahrefs, Canva, ...) or different thresholds. Edit `.claude/framework.json` to retune; edit `.claude/settings.json` to re-enable connectors.

## Measure

```bash
bin/measure.sh            # everything on, in this directory
bin/measure.sh --no-mcp   # local MCP servers off
bin/measure.sh --bare     # user settings off too
bin/ledger.sh             # today's subagent usage by agent
```

Baseline on 2026-09-02 from this directory: ~30k / ~27k / ~22k. The desktop app session floor was ~100k before install.

## Acceptance test (run once after install, in a scratch project)

1. Create `.claude/framework.json` with `{"softThreshold": 1000, "hardThreshold": 2000}`.
2. Start a session, run any tool. Expect the `Session floor` line, then the CONTEXT soft and hard messages.
3. Ask for an edit to a source file. Expect it to be denied with the handoff path in the reason.
4. Run `/handoff`. Expect the file written and the "You can /clear now" reply. Edits work again.
5. `/clear`. Expect the first reply to open with "Resumed from handoff ...".
6. Delete the scratch `.claude/framework.json`.

## Known limits

- Writes through Bash (`sed`, heredocs) are not blocked in the hard state; the hard message after every Bash call is the mitigation.
- The transcript format is undocumented. If it changes, the meter says "Context meter unavailable" once per session instead of going quiet.
- Whether the desktop app honours the per-project `disableClaudeAiConnectors` override is confirmed by reading the floor line, not assumed.
```

- [ ] **Step 3: Commit the script and README**

```bash
git add bin/measure.sh README.md
git commit -m "docs: README, measurement script" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Install for real**

Run: `./install.sh`
Expected: `Installed cost framework into /Users/Jeewan/.claude` and a backup path. Then verify:
```bash
node -e 'const s=require(process.env.HOME+"/.claude/settings.json"); console.log(s.model, s.autoCompactWindow, s.disableClaudeAiConnectors, Object.keys(s.hooks))'
grep -c "framework:start" ~/.claude/CLAUDE.md
ls ~/.claude/agents | grep -E "^(scout|researcher|worker|builder|judge|decider)\.md$" | wc -l
```
Expected: `sonnet 220000 true [ 'SessionStart', 'PostToolUse', 'PreToolUse', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop' ]`, then `1`, then `6`.

- [ ] **Step 5: Measure after install**

Run: `bin/measure.sh`
Expected: a number at or below the pre-install baseline. Record it in `README.md` under Measure ("after install: N").

- [ ] **Step 6: Run the acceptance test from the README**

Do steps 1 to 6 of the README acceptance test in a scratch directory (for example `/tmp/fw-scratch`, `git init` there). Record the outcome of each step in `README.md` under a new `## Acceptance log` heading with the date. If any step fails, stop and report; do not mark it passed.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: record post-install measurement and acceptance log" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- §3 layout: Tasks 1 to 9 create every listed file. `tests/` covers lib, meter, guard, loader, read-warn, ledger, content, installer.
- §4 config and settings patch: Task 8 (`framework.defaults.json`, `settings.patch.json`), values verbatim.
- §5.1 meter, fallbacks, state, messages: Task 2. Bridge fallback in lib (Task 1). Handoff path from `transcript_path`: lib.
- §5.2 guard, memory-dir exception, handoff-written detection: Tasks 2 and 3. Bash bypass documented in README (Task 9).
- §5.3 handoff skill, sections, reply shape: Task 4.
- §5.4 loader, matchers, 14-day flag: Task 4 hook, matcher in the patch (Task 8).
- §5.5 `autoCompactWindow: 220000`: Task 8.
- §5.6 GSD coexistence: installer appends, never replaces (Task 8 test asserts the GSD entry survives).
- §6.1 main loop rules and 300-word report cap: CLAUDE.md block and agent files (Task 7).
- §6.2 six agents, models, tools: Task 7, asserted by `content.test.js`.
- §6.3 triggers, §6.4 evidence rule: CLAUDE.md block (Task 7), asserted.
- §6.5 read warning, warn only: Task 5.
- §6.6 ledger and `bin/ledger.sh`: Task 6.
- §7 MCP scoping: `disableClaudeAiConnectors` in patch (Task 8), project template (Task 7), `bin/measure.sh` and desktop verification (Task 9).
- §8 error handling: every hook exits 0 silently on bad input (tests in Tasks 2, 3); installer refuses invalid JSON (Task 8 test); handoff write failure reporting is in the skill rules (Task 4).
- §9 testing: automated suites per task; manual acceptance in Task 9; measurement acceptance in Task 9.
- §10 rollout: Task 9 steps 4 to 6; ultracode and per-project overrides documented in README.

Placeholder scan: none. Type consistency: `readState/writeState` field names match between meter and guard; `readAux/writeAux` with name `read` used only by read-warn; `handoffPath/memoryDir` signatures identical across tasks; installer test expectations match `settings.patch.json` matchers exactly.
