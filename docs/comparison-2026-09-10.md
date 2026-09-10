# How this compares to popular Claude Code frameworks (2026-09-10)

Star counts from the GitHub API on 2026-09-10. Claims come from each repo's README; "not documented" means the README does not describe it, not that the feature is absent.

| Repo | Stars | What it does | Install | Routes to cheaper models | Context handling |
|---|---|---|---|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | ~284k | Skills-based method: brainstorm, plan, TDD, review | Plugin marketplace | Not documented | Not documented |
| [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | ~94k | Captures sessions, compresses, injects into later ones | npx / plugin / curl | Not documented | Yes: SQLite + vector store |
| [ruvnet/claude-flow](https://github.com/ruvnet/claude-flow) | ~72k | Multi-agent swarm orchestration | npx wizard / curl / plugin | Not documented | Not documented |
| [glittercowboy/get-shit-done](https://github.com/glittercowboy/get-shit-done) | ~65k | Spec-driven meta-prompting | n/a, archived 2026-06-26 | Not documented | Not documented |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | ~54k | Curated list, not a framework | n/a | n/a | n/a |
| [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | ~53k | Agile planning-to-implementation flow | npx skills / plugin | Not documented | Not documented |
| [wshobson/agents](https://github.com/wshobson/agents) | ~40k | 94 plugins, 202 agents, 183 skills | Plugin marketplace | Yes: Opus for architecture and security, Sonnet for docs and tests, Haiku for operational tasks | Plugin isolation keeps unused plugins out of context |
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | ~31k | CLI library of agents, commands, hooks, settings | npx | Not documented | Not documented |
| [SuperClaude-Org/SuperClaude_Framework](https://github.com/SuperClaude-Org/SuperClaude_Framework) | ~24k | Slash commands, personas, behavioural modes | pipx / install.sh | Not documented | "Token-efficiency mode", mechanism not described |
| [ryoppippi/ccusage](https://github.com/ryoppippi/ccusage) | ~18k | Reads local logs, reports token and cost usage | npx | Reporting only | n/a |

## What this framework does that they do not
- A fixed Haiku to Sonnet to Opus ladder with written escalation triggers. Only wshobson/agents documents tiered routing at all.
- An evidence rule: no claim reaches the user without path:line, a URL or command output, and bug or fix claims go through a verifier agent first. None of the READMEs above describe a gate like this.
- A ledger hook that records every subagent call locally.

## What they do that this does not
- Automatic cross-session memory (claude-mem; Claude Code's own auto memory at https://code.claude.com/docs/en/memory). The manual `/handoff` skill is the simplest possible version of this.
- One-command plugin installs. This repo is a shell script.
- Hundreds of prebuilt agents and skills. This repo has six agents on purpose.

## First-party facts
- Claude Code has no setting for the user's name. Preferences live in `~/.claude/CLAUDE.md`; auto memory lives under `~/.claude/projects/<project>/memory/` (https://code.claude.com/docs/en/memory). The installer therefore defaults the name from `git config user.name`.
