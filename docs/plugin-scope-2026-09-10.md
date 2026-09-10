# Packaging the framework as a Claude Code plugin (scope, 2026-09-10)

Sources: https://code.claude.com/docs/en/plugins, /plugins-reference, /plugin-marketplaces, /hooks; ground truth from obra/superpowers and wshobson/agents.

## What a plugin can carry (fits as-is)

| Repo piece today | Plugin home | Notes |
|---|---|---|
| 6 agents (scout, researcher, worker, builder, judge, decider) | `agents/*.md` | `model:` frontmatter is honoured, so the ladder keeps its per-rung models. |
| handoff skill | `skills/handoff/SKILL.md` | Unchanged. |
| ledger hook (SubagentStart / SubagentStop) | `hooks/hooks.json` + `hooks/ledger.js` | Command uses `${CLAUDE_PLUGIN_ROOT}/hooks/ledger.js`. Ledger file stays in `~/.claude/framework/ledger/`. |
| context-hygiene module | second plugin `context-hygiene` in the same marketplace | Opt-in by installing it. Its four hooks register the same way. |
| framework block in CLAUDE.md | SessionStart hook that prints the block | See "the one real gap" below. |

## What a plugin cannot do

- Write into the user's `~/.claude/CLAUDE.md`. A `CLAUDE.md` inside the plugin is ignored.
- Set `model`, `autoCompactWindow` or `disableClaudeAiConnectors`. Plugin settings only support `agent` and `subagentStatusLine`; other keys are silently dropped.
- Run an arbitrary interactive installer. The only install-time prompt is `userConfig` in plugin.json (typed values, available to hooks as `CLAUDE_PLUGIN_OPTION_<KEY>`).

## The one real gap: standing instructions

Today the ladder rules sit in CLAUDE.md, which Claude Code reloads into every session and re-reads after compaction. A plugin's closest equivalent is a SessionStart hook whose stdout becomes context. That is exactly what superpowers does. Difference: it is injected once at session start (and again on `compact`/`clear` if the matcher includes them), so it is slightly weaker than a CLAUDE.md block but in practice the same mechanism the most popular plugin relies on.

## How the six onboarding questions map

| Question | Plugin answer |
|---|---|
| Name | `userConfig.name` (string). SessionStart hook substitutes it into the block. |
| Context watch on/off | Install the `context-hygiene` plugin or don't. |
| Model sonnet/opus/keep | Not settable. README tells the user to run `/model` themselves. |
| Disable connectors | Not settable. README explains the setting; user toggles it. |
| Ledger on/off | `userConfig.ledger` (boolean); hook exits early when false. Or drop the question and always log. |
| Scope all/project | Native: `--scope user` (default) or project via `.claude/settings.json` `enabledPlugins`. |

## Marketplace and visibility

- Minimal `.claude-plugin/marketplace.json`: `name`, `owner.name`, `plugins[]` each with `name` + `source`.
- Repo does NOT need to be public. `/plugin marketplace add jeewandaniel/claude-cost-framework` works from a private repo over SSH or with `gh auth` credentials. Going public is a separate choice.
- Updates: bump `version` in plugin.json; users get it on their next update check.

## Recommended shape

1. Keep the repo. Add `.claude-plugin/marketplace.json` at the root listing two plugins: `delegation` and `context-hygiene`.
2. `plugins/delegation/`: agents/, skills/handoff/, hooks/hooks.json (SessionStart prints block with name; SubagentStart/Stop ledger), plugin.json with `userConfig` for name (and optionally ledger).
3. `plugins/context-hygiene/`: the existing module, hooks registered via hooks.json.
4. Keep `install.sh` as the "deep install" path for people who want the block hard-wired into CLAUDE.md and the model/connector settings applied. README shows both paths: plugin first, script for the full version.

Estimated size: a builder task (new marketplace/plugin files, a SessionStart hook script, README section, a scratch install test with `/plugin marketplace add ./`). No changes to the agents, skill or ledger code.
