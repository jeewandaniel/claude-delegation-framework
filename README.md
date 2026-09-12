# Claude Delegation Framework

Claude Code setup that makes the model you are talking to hand work to cheaper helpers, and keeps
the expensive ones for building, checking and deciding.

## Why this exists

A Claude Code session runs every turn on one model. Start it on the most capable one and that
model also does the lookups, the file reads and the routine edits, none of which needed it. On a
plan with usage limits, that is where the allowance goes. This framework gives the session a
ladder of helper agents and rules for which rung gets what, so the model you are talking to does
the thinking and the helpers do the legwork.

## What it does

1. **Routing.** Six helper agents, each pinned to a model: scout (Haiku) for lookups, researcher and worker (Sonnet) for reading and bounded changes, builder and judge (Opus) for hard work and verification, decider (Fable) for decisions. The ladder, the escalation triggers and the evidence rule live in a block added to your global CLAUDE.md (`claude-md/framework-block.md`).
2. **Evidence rule.** Nothing is reported as fixed or done unless it was actually run. Bug claims and fixes go through the judge before they reach you.
3. **Ledger.** `hooks/ledger.js` runs on SubagentStart and SubagentStop and appends one JSON record per helper call to `~/.claude/framework/ledger/<YYYY-MM-DD>.jsonl` (agent type, model, duration, and the helper's own context and output tokens). `bin/ledger.sh` summarises a day, so you can see where the work went. Nothing else hooks into a session.
4. **Connector scoping.** Account connectors off globally, back on per project with `templates/project/.claude/settings.json`.

## What it does not do

It never changes the model of the chat you are in. That is set by you, with the model picker or
`/model`, and it stays put for the whole session. On Fable, the framework makes Fable delegate
lookups and small builds downward. On Sonnet, it makes Sonnet delegate downward to Haiku and
upward to Opus and Fable helpers for hard builds, checks and decisions. The helpers move up and
down the ladder; the main chat does not.

It also makes no promises about cost or quality. The ledger exists so you can measure your own
usage before and after.

`/handoff` (`skills/handoff/SKILL.md`) is a manual skill: it runs only when you ask for a handoff. By default no hook triggers it, and nothing meters or blocks on context size — long sessions are left to Claude Code's own compaction. The optional module below changes that.

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

Two paths. The plugin is the quick one; the script is the complete one.

**Pick one path.** Installing the plugin *and* running `install.sh` on the same machine registers
the agent ledger twice (duplicate records) and reads the framework rules to Claude twice. Use the
plugin, or the script — not both. To switch, `./install.sh --uninstall` first, or
`/plugin uninstall delegation@claude-delegation-framework`.

### Path A — Plugin (two commands)

```
/plugin marketplace add jeewandaniel/claude-delegation-framework
/plugin install delegation@claude-delegation-framework
/plugin install context-hygiene@claude-delegation-framework    # optional, see above
```

The GitHub repo `jeewandaniel/claude-delegation-framework` is private today, so this path only works for
people who have been given access to it; Path B below works from any local clone regardless.

`delegation` asks for one thing on install: the name Claude should call you. It brings the six
agents, the `/handoff` skill and the ledger.

Three things the plugin cannot do, because Claude Code does not let a plugin do them:

1. **It cannot write the rules into `~/.claude/CLAUDE.md`.** A `CLAUDE.md` inside a plugin is
   ignored. Instead a `SessionStart` hook reads the block to Claude as session context on
   `startup`, `resume`, `clear` and `compact`. That is one injection per session rather than a
   file the model re-reads, so it is a weaker attachment than the CLAUDE.md block.
2. **It cannot set your model or connector settings.** Plugin settings accept only `agent` and
   `subagentStatusLine`; `model`, `autoCompactWindow` and `disableClaudeAiConnectors` are
   dropped. Set the model yourself with `/model`, and add `disableClaudeAiConnectors` to your
   own `settings.json` if you want it.
3. **It cannot run the full onboarding.** The only install-time prompt a plugin gets is the
   typed `userConfig` above, so questions 2-6 in the table below have no plugin equivalent —
   context hygiene becomes "install the second plugin or don't", the ledger is always on, and
   scope is handled natively (`--scope user`, or `enabledPlugins` in a project's
   `.claude/settings.json`).

Marketplace and plugin manifests live in `.claude-plugin/` and `plugins/`. They are generated
from the same sources as the script install; `bin/sync-plugins.sh` regenerates them.

### Path B — Script (full install)

```bash
./install.sh
```

It asks six questions, then copies `hooks/ledger.js` plus `hooks/lib/`, the six agents and the
handoff skill into `~/.claude`, merges settings (a timestamped backup of `settings.json` goes to
`~/.claude/framework/backups/` first, and only the five newest are kept), and puts the block
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
setting and file exactly as it is. A settings key the installer *overwrote* is put back to the value
it had before the first install; one the installer *added* is deleted. `~/.claude/framework/backups/`
is printed and left in place, so the `settings.json` backups outlive the uninstall.

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
7. `FRAMEWORK_HOME=/tmp/fw-home ./install.sh --uninstall` leaves `/tmp/fw-home` with nothing but `framework/backups/`, whose path it prints.

## Known limits

- The transcript format is undocumented. If it changes, the ledger's `context_tokens` / `output_tokens` fields are simply absent from the records.
- Whether the desktop app honours the per-project `disableClaudeAiConnectors` override is confirmed by reading `bin/measure.sh` output, not assumed.

## License

MIT. See [LICENSE](LICENSE).
