#!/usr/bin/env node
'use strict';
// Context meter: PostToolUse (all tools) + UserPromptSubmit.
// Measures live context from the transcript, injects soft/hard prompts, tracks handoff state.
const lib = require('./lib/framework-lib');

const stdinTimeout = setTimeout(() => process.exit(0), 10000);

(async () => {
  const raw = await lib.readStdin();
  clearTimeout(stdinTimeout);
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (lib.isSubagent(input)) return;
  const session = lib.safeSession(input.session_id);
  if (!session) return;

  const event = input.hook_event_name || 'PostToolUse';
  const cfg = lib.loadConfig(input.cwd);
  const st = lib.readState(session);
  const msgs = [];

  const m = input.transcript_path ? lib.measureContext(input.transcript_path) : { ok: false, reason: 'no-transcript' };
  let ctx = null;
  if (m.ok) {
    ctx = m.ctx;
    if (st.floor === null) st.floor = m.floor;
  } else {
    const b = lib.bridgeContext(session);
    if (b !== null) ctx = b;
  }

  if (ctx === null) {
    if (!st.unavailableReported) {
      st.unavailableReported = true;
      msgs.push('Context meter unavailable in this session (transcript usage not found). Treat context size as unknown and run /handoff early rather than late.');
    }
    lib.writeState(session, st);
    if (msgs.length) lib.emit(event, msgs.join('\n'));
    return;
  }

  st.ctx = ctx;
  if (!st.floorReported && st.floor !== null) {
    st.floorReported = true;
    msgs.push(`Session floor: ${lib.k(st.floor)} tokens of context before the first message.`);
  }

  const hp = input.transcript_path ? lib.handoffPath(input.transcript_path) : null;

  // Handoff written this call?
  if (event === 'PostToolUse' && hp && /^(Write|Edit|MultiEdit)$/.test(input.tool_name || '')
      && input.tool_input && lib.samePath(input.tool_input.file_path || '', hp)) {
    st.handoffWrittenAt = new Date().toISOString();
    st.handoffCtx = ctx;
    st.handoffAnnounced = false;
  }

  // Handoff gone stale: context grew a lot since it was written.
  if (st.handoffWrittenAt && st.handoffCtx !== null && ctx - st.handoffCtx > cfg.handoffStaleTokens) {
    st.handoffWrittenAt = null;
    st.handoffCtx = null;
    st.handoffAnnounced = false;
    st.callsSinceMsg = Number.MAX_SAFE_INTEGER;
  }

  const level = ctx >= cfg.hardThreshold ? 'hard' : ctx >= cfg.softThreshold ? 'soft' : 'ok';
  const levelChanged = level !== st.level;
  st.level = level;
  st.callsSinceMsg = Math.min(st.callsSinceMsg + 1, Number.MAX_SAFE_INTEGER);

  if (level !== 'ok') {
    if (st.handoffWrittenAt) {
      if (!st.handoffAnnounced || st.callsSinceMsg >= cfg.softRemindEvery) {
        st.handoffAnnounced = true;
        st.callsSinceMsg = 0;
        msgs.push(`Handoff saved at ${st.handoffWrittenAt} (${hp}). Context ${lib.k(ctx)}. Tell the user they can /clear now; do not start new work.`);
      }
    } else {
      const every = level === 'hard' ? cfg.hardRemindEvery : cfg.softRemindEvery;
      if (levelChanged || st.callsSinceMsg >= every) {
        st.callsSinceMsg = 0;
        msgs.push(level === 'hard'
          ? `CONTEXT ${lib.k(ctx)} (hard limit ${lib.k(cfg.hardThreshold)}). STOP. Run /handoff now. File edits are blocked until the handoff file is written at ${hp}.`
          : `CONTEXT ${lib.k(ctx)} (soft limit ${lib.k(cfg.softThreshold)}). Finish the current step, then run /handoff. Do not start new work.`);
      }
    }
  }

  lib.writeState(session, st);
  if (msgs.length) lib.emit(event, msgs.join('\n'));
})().catch(() => { /* never fail a tool call */ });
