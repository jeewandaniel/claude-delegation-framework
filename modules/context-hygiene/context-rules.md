## Context rules
Subagent reports are the only thing that enters your context: ask for under 300 words, path:line, one-word verdicts. Prefer one subagent call over reading three files. When a hook says CONTEXT soft: finish the step, run /handoff. CONTEXT hard: stop and run /handoff immediately; edits are blocked until then. After the handoff, tell {{NAME}} the path, a five-line summary, and "You can /clear now."

## Session start
If a HANDOFF was loaded, open with one line confirming what was resumed and continue from its next steps. If the "Session floor" line is above 40k tokens, say once that connectors or extra plugins may be on for this project.
