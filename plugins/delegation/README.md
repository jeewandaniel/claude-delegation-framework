# delegation

The delegation ladder as a Claude Code plugin.

## What it installs

- **Six agents** — `scout`, `researcher`, `worker`, `builder`, `judge`, `decider`. Each keeps
  the model named in its own frontmatter.
- **`/handoff` skill** — writes the session handoff file. Manual: it runs only when asked.
- **Rules at session start** — a `SessionStart` hook (`hooks/session-start.js`) reads
  `framework-block.md` and hands it to the session as `additionalContext`, on `startup`,
  `resume`, `clear` and `compact`. `{{NAME}}` in that file is replaced with the `name` you
  set when installing the plugin (default: "the user").
- **Ledger** — `SubagentStart` and `SubagentStop` append one JSON record per event to
  `~/.claude/framework/ledger/<YYYY-MM-DD>.jsonl`. Always on in plugin form; there is no
  toggle in the plugin's config. `bin/ledger.sh` in the framework repo summarises a day.

## What it cannot do

A plugin has no way to write into `~/.claude/CLAUDE.md`, and plugin settings do not accept
`model`, `autoCompactWindow` or `disableClaudeAiConnectors`. The rules are read in at session
start instead of living in CLAUDE.md, and the model and connector settings are yours to set
(`/model`, and `disableClaudeAiConnectors` in `settings.json`). The repo's `install.sh` is the
path that does all three.

## Source

The agents, the skill, `framework-block.md`, `hooks/ledger.js` and `hooks/lib/` are generated
copies. Edit the canonical files in the repo root and run `bin/sync-plugins.sh`.
