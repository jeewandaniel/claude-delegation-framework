# Claude Delegation Framework

Global Claude Code setup for model delegation. Three pieces:

1. **Routing.** Sonnet main loop, six agents: scout (Haiku), researcher (Sonnet), worker (Sonnet), builder (Opus), judge (Opus), decider (Fable). The ladder, the escalation triggers and the evidence rule live in the global CLAUDE.md block (`claude-md/framework-block.md`).
2. **Ledger.** `hooks/ledger.js` runs on SubagentStart and SubagentStop and appends one JSON record per event to `~/.claude/framework/ledger/<YYYY-MM-DD>.jsonl` (agent type, model, duration, and the subagent's own context and output tokens). `bin/ledger.sh` summarises a day. Nothing else hooks into a session.
3. **MCP scoping.** Account connectors off globally, back on per project with `templates/project/.claude/settings.json`.

`/handoff` (`skills/handoff/SKILL.md`) is a manual skill: it runs only when Jeewan asks for a handoff. No hook triggers it, and nothing meters or blocks on context size — long sessions are left to Claude Code's own compaction.

Design (historical, describes the original context-hygiene version): `docs/superpowers/specs/2026-09-02-cost-framework-design.md`.

## Install / update

```bash
./install.sh
```

Copies `hooks/ledger.js` plus `hooks/lib/`, the six agents and the handoff skill into `~/.claude`, merges settings (backup written first), and replaces the block between `<!-- framework:start -->` and `<!-- framework:end -->` in `~/.claude/CLAUDE.md`. Re-run after any change here. Restart Claude Code afterwards.

`FRAMEWORK_HOME=/some/dir ./install.sh` installs into a scratch directory instead, for testing.

## Per project

Copy `templates/project/` into a project that needs account connectors (Gmail, Ahrefs, Canva, ...). Edit `.claude/settings.json` to re-enable connectors.

## Measure

```bash
bin/ledger.sh             # today's subagent usage by agent
bin/ledger.sh 2026-09-03  # a specific day
bin/measure.sh            # first-turn context of a headless session here
bin/measure.sh --no-mcp   # local MCP servers off
bin/measure.sh --bare     # user settings off too
```

`bin/measure.sh` is independent of the framework: it starts a headless `claude -p` run and prints its first-turn context size.

## Acceptance test (after install)

1. `FRAMEWORK_HOME=/tmp/fw-home ./install.sh` into an empty directory.
2. `/tmp/fw-home/hooks` contains only `ledger.js` and `lib/`.
3. `/tmp/fw-home/settings.json` has exactly two framework hooks, SubagentStart and SubagentStop, both `ledger.js`.
4. The CLAUDE.md block between the markers matches `claude-md/framework-block.md`.
5. In a real session, dispatch any subagent, then run `bin/ledger.sh` and expect one row for that agent type.

## Known limits

- The transcript format is undocumented. If it changes, the ledger's `context_tokens` / `output_tokens` fields are simply absent from the records.
- Whether the desktop app honours the per-project `disableClaudeAiConnectors` override is confirmed by reading `bin/measure.sh` output, not assumed.
