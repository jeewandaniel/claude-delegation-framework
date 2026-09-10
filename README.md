# Claude Delegation Framework

Global Claude Code setup for model delegation. Three pieces:

1. **Routing.** Sonnet main loop, six agents: scout (Haiku), researcher (Sonnet), worker (Sonnet), builder (Opus), judge (Opus), decider (Fable). The ladder, the escalation triggers and the evidence rule live in the global CLAUDE.md block (`claude-md/framework-block.md`).
2. **Ledger.** `hooks/ledger.js` runs on SubagentStart and SubagentStop and appends one JSON record per event to `~/.claude/framework/ledger/<YYYY-MM-DD>.jsonl` (agent type, model, duration, and the subagent's own context and output tokens). `bin/ledger.sh` summarises a day. Nothing else hooks into a session.
3. **MCP scoping.** Account connectors off globally, back on per project with `templates/project/.claude/settings.json`.

`/handoff` (`skills/handoff/SKILL.md`) is a manual skill: it runs only when you ask for a handoff. By default no hook triggers it, and nothing meters or blocks on context size — long sessions are left to Claude Code's own compaction. The optional module below changes that.

Design (historical, describes the original context-hygiene version): `docs/superpowers/specs/2026-09-02-cost-framework-design.md`.

## Optional: context hygiene

Off by default. `modules/context-hygiene/` keeps the four hooks that watch a session's context
size: a meter that reports how full the context is and tells the session to run `/handoff` past a
soft and a hard threshold, a guard that refuses file edits in the hard state until the handoff is
written, a warning when the main loop reads a large file itself, and a loader that injects the
project's `handoff.md` at session start. Turning it on also swaps in the `## Context rules`
section and the handoff skill that go with those messages.

```bash
./install.sh --with-context-hygiene      # on  (same as FRAMEWORK_CONTEXT_HYGIENE=1 ./install.sh)
./install.sh --without-context-hygiene   # off, back to the default install
```

It interrupts work: past the thresholds the session is told to stop starting new work, and edits
are blocked until a handoff file exists. That makes it unsuitable for unattended or overnight
sessions. Details and settings: `modules/context-hygiene/README.md`.

## Install

```bash
./install.sh
```

It asks six questions, then copies `hooks/ledger.js` plus `hooks/lib/`, the six agents and the
handoff skill into `~/.claude`, merges settings (a backup is written first), and puts the block
between `<!-- framework:start -->` and `<!-- framework:end -->` in `~/.claude/CLAUDE.md`.

A question is asked only when you are at a terminal and you did not already answer it with a flag
or an env var. Otherwise the default applies silently, so pressing Enter six times and running
`./install.sh --yes` give the same install.

| # | Question | Default | Flag | Env var |
| --- | --- | --- | --- | --- |
| 1 | What should Claude call you? | your `git config user.name`, else "you" | `--name <name>` | `FRAMEWORK_NAME` |
| 2 | Warn you when a chat is getting full and save notes for a fresh one? | no | `--with-context-hygiene` / `--without-context-hygiene` | `FRAMEWORK_CONTEXT_HYGIENE=1/0` |
| 3 | Which model should the main chat run on? | `sonnet` | `--model sonnet\|opus\|keep` | `FRAMEWORK_MODEL` |
| 4 | Turn off claude.ai connectors (Gmail, Drive, ...) inside Claude Code? | no | `--disable-connectors` / `--keep-connectors` | `FRAMEWORK_DISABLE_CONNECTORS=1/0` |
| 5 | Keep a local log of helper calls? | yes | `--ledger` / `--no-ledger` | `FRAMEWORK_LEDGER=1/0` |
| 6 | Install for all projects, or this project only? | `all` | `--scope all\|project` | `FRAMEWORK_SCOPE` |

Question 1 replaces every `{{NAME}}` in the CLAUDE.md block and the handoff skill, so the
installed text addresses you by name. `--model keep` leaves whatever model your `settings.json`
already names. Question 4 only ever adds `disableClaudeAiConnectors`; answering no leaves your own
value alone. `--scope project` installs into `./.claude` and `./CLAUDE.md` of the current directory
instead of `~/.claude`.

Re-run after any change here, then restart Claude Code. A re-run reads
`~/.claude/framework/install.json` and uses your recorded answers as its defaults, so a plain
`./install.sh` keeps the setup you chose.

`FRAMEWORK_HOME=/some/dir ./install.sh` installs into a scratch directory instead, for testing.

## Uninstall

`./install.sh --uninstall` removes the files and the settings keys recorded in
`~/.claude/framework/install.json` and takes the block back out of `CLAUDE.md`, leaving every other
setting, file and `settings.json` backup exactly as it is.

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

1. `FRAMEWORK_HOME=/tmp/fw-home ./install.sh --yes` into an empty directory.
2. `/tmp/fw-home/hooks` contains only `ledger.js` and `lib/`.
3. `/tmp/fw-home/settings.json` has exactly two framework hooks, SubagentStart and SubagentStop, both `ledger.js`.
4. The CLAUDE.md block between the markers matches `claude-md/framework-block.md`.
5. In a real session, dispatch any subagent, then run `bin/ledger.sh` and expect one row for that agent type.
6. `FRAMEWORK_HOME=/tmp/fw-home ./install.sh --with-context-hygiene` adds `ctx-meter.js`, `ctx-guard.js`, `read-warn.js` and `handoff-load.js`; `--without-context-hygiene` takes `/tmp/fw-home` back to the state of step 2.
7. `FRAMEWORK_HOME=/tmp/fw-home ./install.sh --uninstall` leaves `/tmp/fw-home` with nothing but the `settings.json.bak-*` files.

## Known limits

- The transcript format is undocumented. If it changes, the ledger's `context_tokens` / `output_tokens` fields are simply absent from the records.
- Whether the desktop app honours the per-project `disableClaudeAiConnectors` override is confirmed by reading `bin/measure.sh` output, not assumed.
