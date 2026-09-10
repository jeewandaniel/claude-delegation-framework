# Context hygiene (optional module)

Off by default. The default install is delegation-only: nothing measures or blocks on context
size, and long sessions are left to Claude Code's own compaction. Turn this module on if you
want the session to watch its own context size and stop you before it fills up.

## What it installs

Four hooks, copied into `~/.claude/hooks/` alongside `ledger.js`, plus their settings entries:

| Hook | Event | What it does |
| --- | --- | --- |
| `ctx-meter.js` | `UserPromptSubmit`, `PostToolUse` (all tools) | Measures live context from the transcript. Prints the session floor once, then a `CONTEXT <n>k` message at the soft threshold and a `STOP` message at the hard one. Tracks whether the handoff file has been written, and treats it as stale once context has grown past `handoffStaleTokens` since. |
| `ctx-guard.js` | `PreToolUse` on `Edit\|Write\|MultiEdit\|NotebookEdit` | In the hard state, before a handoff is written, denies edits outside the project's memory directory. Fails open on anything it cannot judge. |
| `read-warn.js` | `PostToolUse` on `Read` | Says so when the main loop reads more than `readWarnLines` lines itself, debounced to one message per `readWarnEvery` further big reads. |
| `handoff-load.js` | `SessionStart` (`startup\|resume\|clear\|compact`) | Injects `handoff.md` from the project's Claude memory directory when one exists, flagging it if older than 14 days. Resets the meter state so a reused `session_id` cannot deny the first edits. On `source: "compact"` it injects nothing and records the transcript byte offset, so pre-compaction usage lines are never measured as the current size. |

It also swaps two pieces of text:

- `~/.claude/CLAUDE.md`: the `## Context rules` section of the framework block is replaced by
  `context-rules.md` (which also adds a `## Session start` section for the injected handoff).
- `~/.claude/skills/handoff/SKILL.md`: replaced by `handoff-SKILL.md`, the variant that reacts to
  hook messages and ends with "You can /clear now."

## What it costs you

- **It interrupts.** Past the soft threshold the model is told to stop starting new work and run
  `/handoff`. Past the hard threshold, file edits are refused until a handoff file exists.
- **Not for unattended or overnight runs.** A long autonomous session will hit the thresholds,
  be told to stop, and wait rather than finish.
- Every tool call runs a hook that reads part of the transcript.

## Turn it on

```bash
./install.sh --with-context-hygiene     # or: FRAMEWORK_CONTEXT_HYGIENE=1 ./install.sh
```

Plain `./install.sh` re-runs keep whichever mode is already installed (a marker file,
`~/.claude/framework/context-hygiene.on`, records it).

## Turn it off

```bash
./install.sh --without-context-hygiene
```

Removes the four hook files and their settings entries, restores the manual-only handoff skill
and the default `## Context rules` section. The threshold keys are left in
`~/.claude/framework.json` (nothing reads them with the module off, and deleting them would throw
away values you may have tuned). Both directions are idempotent. Restart Claude Code after either.

## Settings

Thresholds live in `framework.defaults.json` and are merged into `~/.claude/framework.json` only
for keys that are missing, so your own values survive a re-install. Override per project in
`<project>/.claude/framework.json`:

```json
{ "softThreshold": 150000, "hardThreshold": 190000 }
```

| Key | Default | Meaning |
| --- | --- | --- |
| `softThreshold` | 150000 | Context size at which the meter says "finish the step, then run /handoff". |
| `hardThreshold` | 190000 | Context size at which edits are blocked until the handoff is written. |
| `softRemindEvery` | 8 | Tool calls between repeat soft messages. |
| `hardRemindEvery` | 3 | Tool calls between repeat hard messages. |
| `handoffStaleTokens` | 20000 | Context growth after which a written handoff no longer counts. |
| `readWarnLines` | 300 | Lines above which a main-loop `Read` is called out. |
| `readWarnEvery` | 5 | Big reads between repeat read warnings. |

## Tests

```bash
node --test modules/context-hygiene/tests/*.test.js
```

The tests stage the hooks next to `hooks/lib/` the way the installer lays them out in
`~/.claude/hooks/`, so the `require('./lib/framework-lib')` path is exercised as installed.
