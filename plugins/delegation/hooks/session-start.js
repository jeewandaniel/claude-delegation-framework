#!/usr/bin/env node
'use strict';
// SessionStart: read the rules block that ships with this plugin and hand it to the
// session as context. A plugin cannot write into the user's CLAUDE.md, so this hook is
// how the standing instructions get in front of the model.
//
// Paths resolve from __dirname: the hook runs with the session's cwd, not the plugin's.
// Any failure exits 0 with no output — a missing block must never block a session.
const fs = require('fs');
const path = require('path');

try {
  const file = path.join(__dirname, '..', 'framework-block.md');
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
