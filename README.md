# Claude Cost Framework

Global Claude Code setup that keeps quality while cutting usage-limit consumption. Three pieces:

1. **Context hygiene.** A hook meters live context from the session transcript. At 150k it asks for a handoff; at 190k it blocks file edits until `/handoff` has written the handoff file; after `/clear`, the next session loads that file automatically. On auto-compaction (SessionStart source `compact`), no handoff is loaded — a compaction summary already carries the live state — and the meter records the transcript's byte offset at that moment so pre-compaction usage lines are never measured as current context.
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

Measured on 2026-09-02 from this directory (headless `bin/measure.sh`, real `claude -p`, haiku):
- before install: 30888 tokens
- after install: 30202 tokens
- after install, `--no-mcp`: 27706 tokens

## Acceptance test (run once after install, in a scratch project)

1. Create `.claude/framework.json` with `{"softThreshold": 1000, "hardThreshold": 2000}`.
2. Start a session, run any tool. Expect the `Session floor` line, then the CONTEXT soft and hard messages.
3. Ask for an edit to a source file. Expect it to be denied with the handoff path in the reason.
4. Run `/handoff`. Expect the file written and the "You can /clear now" reply. Edits work again.
5. `/clear`. Expect the first reply to open with "Resumed from handoff ...".
6. Delete the scratch `.claude/framework.json`.

## Acceptance log

2026-09-02, after real `./install.sh` into `/Users/Jeewan/.claude` (backup: `/Users/Jeewan/.claude/settings.json.bak-20260902-182946-60099`).

Steps 2 to 5 need an interactive Claude Code session (live hook messages, `/handoff`, `/clear`, the resumed line) and cannot be driven from this non-interactive harness. In their place, a headless equivalent was run in a fresh scratch project at `/tmp/fw-scratch` (`git init`, `.claude/framework.json` set to `{"softThreshold": 1000, "hardThreshold": 2000}`):

```
cd /tmp/fw-scratch
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p "Run the Bash tool with the command 'echo hi'. Then reply with, verbatim, every line of hook or system context you received that starts with 'Session floor' or 'CONTEXT'. If you received none, say NONE." --model haiku --output-format json --max-turns 3
```

Result field, verbatim:

> Session floor: 29k tokens of context before the first message.
> CONTEXT 29k (hard limit 2k). STOP. Run /handoff now. File edits are blocked until the handoff file is written at /Users/Jeewan/.claude/projects/-private-tmp-fw-scratch/memory/handoff.md.

- **Step 1** (create scratch `.claude/framework.json`): PASS — file created as above.
- **Step 2** (Session floor line, then CONTEXT soft/hard): PARTIAL (hard path only; soft-then-hard progression not separately observable in one shot) — headless run above hit `hard` directly (29k ctx vs. hardThreshold 2000), matching the CONTEXT-hard message shape; state file confirms `"level":"hard"`.
- State file check: `ls "$TMPDIR"/framework-ctx-*.json` after the run listed `framework-ctx-e6894559-7fb2-417a-bc36-8c6eab80a24f.json` (matches the session ID above, timestamped after the install), content `{"ctx":29013,"floor":29013,"level":"hard","handoffWrittenAt":null,"handoffCtx":null,"handoffAnnounced":false,"callsSinceMsg":0,"floorReported":true,"unavailableReported":true}`.
- **Step 3** (edit denied with handoff path in reason): pending — needs an interactive session; Jeewan to run.
- **Step 4** (`/handoff` writes the file, "You can /clear now"): pending — needs an interactive session; Jeewan to run.
- **Step 5** (`/clear` then "Resumed from handoff ..."): pending — needs an interactive session; Jeewan to run.
- **Step 6** (delete scratch `.claude/framework.json`): not yet done — `/tmp/fw-scratch` was left in place so Jeewan can run steps 3 to 5 interactively; its `.claude/framework.json` must be deleted afterwards.

## Known limits

- Writes through Bash (`sed`, heredocs) are not blocked in the hard state; the hard message after every Bash call is the mitigation.
- The transcript format is undocumented. If it changes, the meter says "Context meter unavailable" once per session instead of going quiet.
- Whether the desktop app honours the per-project `disableClaudeAiConnectors` override is confirmed by reading the floor line, not assumed.
