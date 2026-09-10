# context-hygiene

The optional context-hygiene module as a Claude Code plugin. Install it only if you want a
session to be interrupted when its context fills up.

## What it installs

Four hooks, all reading the session transcript:

| Hook | Event | Does |
| --- | --- | --- |
| `ctx-meter.js` | `UserPromptSubmit`, `PostToolUse` | reports how full the context is; asks for `/handoff` past the soft and hard thresholds |
| `ctx-guard.js` | `PreToolUse` (Edit/Write/MultiEdit/NotebookEdit) | refuses edits in the hard state until a handoff file exists |
| `read-warn.js` | `PostToolUse` (Read) | warns when the main loop reads a large file itself |
| `handoff-load.js` | `SessionStart` | injects the project's `handoff.md` |

Plus a `SessionStart` hook that hands `context-rules.md` to the session, so the model knows
what those messages mean.

## Thresholds

Built-in defaults apply with no configuration: soft 150k, hard 190k, read warning at 300
lines. To change them, write the keys you want into `~/.claude/framework.json` (all projects)
or `<project>/.claude/framework.json` (one project); see
`modules/context-hygiene/framework.defaults.json` in the framework repo for the full list.

## It does not ship a handoff skill

The `/handoff` skill lives in the **delegation** plugin. Shipping a second copy here would
collide with it, so this plugin has no `skills/` directory. Install `delegation` if you want
`/handoff` — the hooks here ask for it by name.

## It interrupts work

Past the thresholds the session is told to stop starting new work, and edits are blocked
until a handoff file exists. That makes it unsuitable for unattended or overnight sessions.

## Source

`hooks/ctx-*.js`, `hooks/read-warn.js`, `hooks/handoff-load.js`, `hooks/lib/` and
`context-rules.md` are generated copies of `modules/context-hygiene/`. Edit the canonical
files and run `bin/sync-plugins.sh`.
