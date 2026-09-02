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
