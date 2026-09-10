#!/usr/bin/env node
'use strict';
// SessionStart: hand the context rules that explain this plugin's messages
// (CONTEXT soft / CONTEXT hard / HANDOFF loaded) to the session as context.
//
// Paths resolve from __dirname: the hook runs with the session's cwd, not the plugin's.
// Any failure exits 0 with no output — a missing file must never block a session.
const fs = require('fs');
const path = require('path');

try {
  const file = path.join(__dirname, '..', 'context-rules.md');
  const raw = fs.readFileSync(file, 'utf8');
  const name = String(process.env.CLAUDE_PLUGIN_OPTION_NAME || '').trim() || 'the user';
  const text = raw.split('{{NAME}}').join(name);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
} catch {
  /* silent */
}
process.exit(0);
