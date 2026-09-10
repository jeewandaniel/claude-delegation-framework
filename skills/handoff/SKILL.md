---
name: handoff
description: Write the session handoff file so a later session can pick the work up. Use only on a request from {{NAME}} for a handoff or to wrap up. Writes handoff.md in the project's Claude memory directory and reports the path.
---

# /handoff

Goal: the next session, starting on an empty context, continues without asking {{NAME}} to repeat anything.

## Steps

1. Locate the memory directory. The system prompt names it ("persistent file-based memory at ..."). If {{NAME}} named a path, use exactly that path. Create the directory if it is missing.
2. If `handoff.md` already exists there, rename it to `handoff-prev.md`, replacing any older `handoff-prev.md`.
3. List every file you touched this session (edits, writes, commits) by scanning what you actually did, not from memory. Include paths outside the project if you touched them.
4. Run the verification commands you are about to list (tests, build, curl) when they are cheap, and record their real output. If you did not run one, write "not run".
5. Write `handoff.md` with exactly these sections, in this order. "none" is a valid value. Keep the file under 150 lines.

```
# Handoff — <project directory name> — <ISO timestamp>
## Goal
<what we are trying to achieve, one paragraph>
## State
<where things stand right now, concrete>
## Decisions
<each decision with its evidence: path:line, URL, or command output>
## Files touched
<one line per path: what changed>
## Next steps
<exactly the next three actions, in order>
## Open questions
<what needs {{NAME}}>
## Verify
<commands and their last known result>
## Do not
<anything the next session must not do>
```

6. If durable facts emerged this session (a preference, a project constraint, a reference URL), save each as its own memory file with a `MEMORY.md` index line, following the memory instructions in the system prompt. The handoff is for continuity; memory is for facts that outlive this task.
7. Reply to {{NAME}} in exactly this shape and nothing more:

```
Handoff saved: <path>
- Goal: <one line>
- State: <one line>
- Next: <one line>
- Open: <one line or "none">
- Verify: <one command or "none">
```

## Rules

- Write `handoff.md` with the Write tool, not through Bash (`sed`, heredocs).
- Start no new work once the handoff begins.
- Do not summarise from memory when the transcript has the facts.
- Every decision line carries evidence or says "no evidence, judgment call".
- If writing the file fails, report the exact error to {{NAME}} and stop; do not claim it was saved.
