# Cost Framework — Design Spec

Date: 2026-09-02
Status: draft for review
Owner: Jeewan (Sant Limited)

## 1. Problem

Jeewan is on Claude Max 20x and runs out of usage limits. Measured causes, in order of size:

1. Sessions are never compacted or cleared (fear of losing context). Default model is `opus[1m]`, so auto-compact does not fire until ~1M tokens. Every turn re-sends the whole context.
2. The desktop-app session floor is ~100k tokens before the first word is typed. Headless CLI measurement: ~30k with everything on, ~27k with local MCPs off, ~22k with user settings off. The ~70k gap is the claude.ai account connectors plus desktop-bundled plugins and tools.
3. The main loop runs on the most expensive model and does grunt work itself.
4. Ultracode was on ("token cost is not a constraint").

Goal: a global framework, installed once, that keeps quality while cutting limit consumption, and that makes clearing a session feel safe.

## 2. Non-goals

- Not a per-project prompt copied into each repo. Global install, thin per-project overrides.
- Not a replacement for GSD. Coexists with it.
- No changes to any client project in this work.
- Turning ultracode off is a UI toggle the framework cannot set; it is documented, not automated.

## 3. Repository layout (source of truth)

```
Frameworks/
  README.md                         how to install, update, measure
  install.sh                        idempotent installer into ~/.claude (backs up first)
  bin/measure.sh                    prints first-turn context size for the cwd (headless claude -p, haiku)
  bin/ledger.sh                     summarises the usage ledger
  claude-md/framework-block.md      the global CLAUDE.md section (installed between marker comments)
  hooks/ctx-meter.js                context meter (PostToolUse, UserPromptSubmit)
  hooks/ctx-guard.js                edit blocker after hard threshold (PreToolUse)
  hooks/handoff-load.js             injects handoff at session start (SessionStart)
  hooks/read-warn.js                warns main loop on big reads (PostToolUse: Read)
  hooks/ledger.js                   logs subagent runs (SubagentStart, SubagentStop)
  agents/{scout,worker,researcher,builder,judge,decider}.md
  skills/handoff/SKILL.md           the /handoff protocol
  settings/framework.defaults.json  thresholds and knobs
  settings/settings.patch.json      keys merged into ~/.claude/settings.json
  templates/project/                thin per-project files (CLAUDE.md, .claude/settings.json, .claude/framework.json)
  tests/                            node tests for hooks against fixture transcripts
  docs/superpowers/specs/           this spec
```

`install.sh` copies hooks, agents, skills into `~/.claude/`, merges `settings.patch.json` into `~/.claude/settings.json` (never overwrites unrelated keys, writes `settings.json.bak-<timestamp>` first), and replaces the block between `<!-- framework:start -->` and `<!-- framework:end -->` in `~/.claude/CLAUDE.md` (appends the block if markers are absent). Re-running is safe.

Hooks are Node scripts (Node is already required by the existing GSD hooks; path `/opt/homebrew/bin/node`). Every hook: 10 s stdin timeout guard, never throws, exits 0 on any internal error, and never blocks a tool call except `ctx-guard.js` in the hard state.

## 4. Configuration

`~/.claude/framework.json` (installed from `settings/framework.defaults.json`), overridable per project by `<project>/.claude/framework.json` (shallow merge, project wins):

```json
{
  "softThreshold": 150000,
  "hardThreshold": 190000,
  "softRemindEvery": 8,
  "hardRemindEvery": 3,
  "readWarnLines": 300,
  "readWarnEvery": 5,
  "ledger": true
}
```

`settings/settings.patch.json` merged into `~/.claude/settings.json`:

```json
{
  "model": "sonnet",
  "autoCompactWindow": 220000,
  "disableClaudeAiConnectors": true,
  "hooks": {
    "SessionStart":     [{ "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/handoff-load.js", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ctx-meter.js", "timeout": 5 }] }],
    "PostToolUse":      [{ "matcher": ".*",   "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ctx-meter.js", "timeout": 5 }] },
                         { "matcher": "Read", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/read-warn.js", "timeout": 5 }] }],
    "PreToolUse":       [{ "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ctx-guard.js", "timeout": 5 }] }],
    "SubagentStart":    [{ "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ledger.js", "timeout": 5 }] }],
    "SubagentStop":     [{ "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ledger.js", "timeout": 5 }] }]
  }
}
```

Hook entries are appended to any existing arrays for the same event; existing GSD entries are left in place. The installer uses the absolute Node path from `which node` at install time, not `~`.

## 5. Piece 1 — Context hygiene

### 5.1 Measuring context (`hooks/ctx-meter.js`)

Runs on `PostToolUse` (matcher `.*`) and `UserPromptSubmit`. Skips silently when the hook input carries `agent_id` (subagent).

Measurement: read `transcript_path`, find the last line with `type == "assistant"` and a `message.usage` object, compute `ctx = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Verified in this session: 100,013 on turn one, 168,154 later.

Fallbacks, in order: (a) transcript usage; (b) GSD statusline bridge file `os.tmpdir()/claude-ctx-<session_id>.json` converted from `remaining_percentage` when `context_window` size is known, otherwise unusable; (c) none available: inject once per session "Context meter unavailable in this session (transcript format not recognised). Treat context as unknown and prefer /handoff early." Silence is never mistaken for OK.

State file: `os.tmpdir()/framework-ctx-<session_id>.json`:

```json
{ "ctx": 168154, "floor": 100013, "level": "ok|soft|hard", "handoffWrittenAt": null, "callsSinceMsg": 0, "floorReported": true }
```

Messages injected as `additionalContext`:

- First measurement of the session: `Session floor: 100k tokens.` (once).
- `ctx >= softThreshold`: `CONTEXT 152k (soft limit 150k). Finish the current step, then run /handoff. Do not start new work.` Repeated every `softRemindEvery` tool calls.
- `ctx >= hardThreshold`: `CONTEXT 191k (hard limit 190k). STOP. Run /handoff now. File edits are blocked until the handoff file at <path> is written.` Repeated every `hardRemindEvery` tool calls until `handoffWrittenAt` is set.
- After handoff written (any level): `Handoff saved at <time>. Tell the user they can /clear now.` Once, then every `softRemindEvery` calls while still above soft.

Handoff path is derived from the hook input, never guessed: `dirname(transcript_path)/memory/handoff.md`. This is the same directory Claude Code uses for auto-memory for that project, and the model already knows it from its system prompt.

### 5.2 Blocking edits in the hard state (`hooks/ctx-guard.js`)

Runs on `PreToolUse` with matcher `Edit|Write|MultiEdit|NotebookEdit`. Skips for subagents. Reads the state file. If `level == "hard"` and `handoffWrittenAt` is null and the target `file_path` is not the handoff path (or `MEMORY.md` in the same directory), it denies with reason: `Context hard limit reached. Write the handoff first: <path>. Run /handoff.` Otherwise allows.

A `PostToolUse` entry on `Write|Edit` (inside `ctx-meter.js`, no separate hook) sets `handoffWrittenAt` when the written file is the handoff path.

Known limitation: writes via Bash (`sed`, heredocs) are not blocked. The hard-state message is injected after every Bash call too, which is the mitigation. Documented, not solved.

### 5.3 The handoff protocol (`skills/handoff/SKILL.md`, invoked as `/handoff`)

The skill writes `handoff.md` in the project's memory directory, rotating any existing one to `handoff-prev.md`. Required sections, all mandatory, "none" is a valid value:

```
# Handoff — <project> — <ISO timestamp>
## Goal            what we are trying to achieve, one paragraph
## State           where things stand right now
## Decisions       each with its evidence (file:line, URL, or command output)
## Files touched   paths, one line each on what changed
## Next steps      exactly the next three actions
## Open questions  what needs Jeewan
## Verify          commands to prove the current state (tests, build, curl)
## Do not          anything the next session must not do
```

Rules: the session must not summarise from memory alone; it lists files it touched from the transcript, and runs the `Verify` commands before writing them down when it can. New durable facts also go into the memory directory as normal memory files with a `MEMORY.md` index line. The skill ends with this exact user-facing shape:

```
Handoff saved: <path>
<five bullet summary: goal, state, next step, open question, verify command>
You can /clear now. The next session will load this automatically.
```

### 5.4 Loading the handoff (`hooks/handoff-load.js`)

Runs on `SessionStart` with matchers `startup`, `resume`, `clear`, `compact`. Derives the memory directory from `transcript_path`. If `handoff.md` exists, injects its full content prefixed with: `HANDOFF loaded (written <timestamp>, <age>). Open your first reply with one line confirming what was resumed, then continue from "Next steps". Ask before deviating.` If the handoff is older than 14 days, the prefix says so. If none exists, injects nothing.

### 5.5 Safety net

`autoCompactWindow: 220000` in settings. If every prompt is ignored, Claude Code compacts at 220k instead of near 1M. `PreCompact` cannot inject instructions, so nothing is attempted there.

### 5.6 GSD coexistence

GSD's `gsd-context-monitor.js` stays installed. It only fires in terminal sessions and at 35% remaining, so in practice the framework meter fires first. If both fire, the messages do not conflict. Projects may set `hooks.context_warnings: false` in `.planning/config.json` to silence GSD's.

## 6. Piece 2 — Routing

### 6.1 Main loop

Default model Sonnet (settings patch). The `CLAUDE.md` block states the main loop's job: understand the request, route work, write briefings, integrate compact reports, and talk to Jeewan. It does not implement beyond trivial one-line edits, and it does not read large files itself. Everything it consumes is a subagent report.

Subagent report contract (in every agent definition): compact, structured, no restating the task, files as `path:line`, verdicts as single words, and a hard cap of roughly 300 words unless the caller asked for a document.

### 6.2 Agents (`~/.claude/agents/`)

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| scout | haiku | Read, Grep, Glob, Bash | lookups, greps, inventories; facts only, "not found" over guesses (exists, unchanged) |
| researcher | sonnet | Read, Grep, Glob, WebSearch, WebFetch, ToolSearch | docs via Context7, web research, reading; every finding carries a URL or `path:line`; an uncited claim is a defect (new) |
| worker | sonnet | all | bounded implementation, runs tests, reports unverified as unverified (exists, unchanged) |
| builder | opus | all | hard implementation: multi-file changes, tricky bugs, anything worker reported ambiguous or failed (new) |
| judge | opus | Read, Grep, Glob, Bash | adversarial verification, CONFIRMED / REFUTED / UNPROVEN (exists, unchanged) |
| decider | fable | Read, Grep, Glob | decisions only. Input: question, options, evidence, constraints. Output: decision, reasoning, what would reverse it. Returns UNDECIDED with the missing evidence list when evidence is thin (new) |

`decider.md` prompt rules: never accept the briefing's claims about code without reading the cited lines; refuse to decide on vibes; output under 250 words; state the single most important risk.

### 6.3 Escalation triggers (listed in CLAUDE.md, not left to judgment)

Must go to `decider` (Fable): money, pricing or billing logic; auth, security or data deletion; architecture or schema changes; client-facing wording; anything irreversible (deploy, push to a default branch, DNS, sending email or messages, publishing); any disagreement between two agents; any request to bypass the evidence rule.

Must go to `builder` (Opus) rather than `worker`: changes spanning more than three files, concurrency, migrations, anything `worker` returned as ambiguous or failed once.

Must go to `judge` before being told to Jeewan as true: any bug claim, any "fixed", any performance or security assertion.

### 6.4 Evidence rule

No briefing reaches `decider` without evidence attached. Evidence is one of: `path:line`, a URL from `researcher`, or command output. If the main loop lacks it, it dispatches `scout` or `researcher` first. No agent, including the main loop, says "should work", "fixed" or "done" for anything not run; the accepted phrase is "code-complete, unverified" (already in `worker.md`, now global).

### 6.5 Read warning (`hooks/read-warn.js`)

`PostToolUse` with matcher `Read`, main loop only. If the file has more than `readWarnLines` lines, inject: `Main loop read <n> lines of <file>. Reads this size belong to scout; delegate the next one.` Debounced every `readWarnEvery` calls. Warn only (decision A).

### 6.6 Usage ledger (`hooks/ledger.js`)

`SubagentStart` and `SubagentStop`. Appends one JSON line per event to `~/.claude/framework/ledger/<YYYY-MM-DD>.jsonl` with session id, agent type, model when present in the hook input, timestamps, and, on stop, tokens computed from the subagent transcript when a path is provided. `bin/ledger.sh` prints a per-day table: agent, runs, total tokens, average duration. If the hook input lacks fields, the ledger records what exists; it never fails the hook.

## 7. Piece 3 — MCP and plugin scoping

- Global: `disableClaudeAiConnectors: true`. Local MCP servers untouched (measured at ~3k, schemas already deferred).
- Per project that needs connectors: `templates/project/.claude/settings.json` sets `disableClaudeAiConnectors: false`. Optionally `enabledPlugins` overrides for desktop-bundled plugins, same pattern.
- Verification on day one, in the desktop app: start a session in Frameworks with the global setting, read the floor line from the meter. Then in a project with the override, read it again. If the desktop app does not honour the project override, the fallback is a per-project `~/.claude.json` local-scope entry, and the spec is amended with the measured behaviour.
- `bin/measure.sh` runs `claude -p "Reply with the single word ok." --model haiku --output-format json --max-turns 1` in the cwd with `CLAUDECODE` unset, and prints the summed first-turn context. Optional flags mirror the three configs measured today.

## 8. Error handling

- Any hook failing to parse input or a transcript exits 0 with no output, except the meter's one-time "meter unavailable" notice.
- The guard fails open (allows) on any error other than a confirmed hard state.
- The installer refuses to run if `~/.claude/settings.json` is not valid JSON, and prints the backup path on every run.
- Handoff write failures (permissions, missing directory) are reported by the skill to the user verbatim; the directory is created if missing.

## 9. Testing

- `tests/` runs with `node --test`. Fixtures: transcript JSONL files at 20k, 155k, 195k; a subagent hook input; a missing-usage transcript. Assertions: meter levels and messages, floor reported once, guard deny/allow decisions including the handoff-path exception, handoff-load output with and without a file, read-warn threshold and debounce.
- Manual acceptance, run once after install: set `softThreshold: 1000` and `hardThreshold: 2000` in a scratch project's `.claude/framework.json`; confirm soft message, hard block on an Edit, `/handoff` writes the file, block lifts, `/clear`, next session opens with the resumed line. Then remove the override.
- Measurement acceptance: `bin/measure.sh` in Frameworks before and after install; desktop floor line before and after.

## 10. Rollout

1. Install into `~/.claude` from this repo.
2. Turn ultracode off in the session UI (manual).
3. Run the manual acceptance in a scratch project.
4. Add the project override to the two or three projects that need connectors.
5. Review the ledger after one week and retune thresholds.
