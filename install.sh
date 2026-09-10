#!/usr/bin/env bash
# Install the delegation framework into a Claude Code config directory (default ~/.claude).
# Idempotent: safe to re-run after every change to this repo.
#
#   ./install.sh              ask the six setup questions on a terminal, then install
#   ./install.sh --yes        take every default, ask nothing
#   ./install.sh --uninstall  remove everything this installer added
#
# Every question has a flag and an env var; a question is asked only when stdin is a terminal and
# neither was given. The full list, with defaults, is the "Install" section of README.md.
# A re-run reads $DEST/framework/install.json and uses the recorded answers as its defaults.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE="$REPO/modules/context-hygiene"
MODULE_HOOKS="ctx-meter.js ctx-guard.js read-warn.js handoff-load.js"

usage() {
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

  --name <name>                        what Claude should call you   (FRAMEWORK_NAME)
  --with-/--without-context-hygiene    context watch on/off          (FRAMEWORK_CONTEXT_HYGIENE=1/0)
  --model sonnet|opus|keep             main-chat model               (FRAMEWORK_MODEL)
  --disable-connectors|--keep-connectors                             (FRAMEWORK_DISABLE_CONNECTORS=1/0)
  --ledger|--no-ledger                 local log of helper calls     (FRAMEWORK_LEDGER=1/0)
  --scope all|project                  ~/.claude or ./.claude        (FRAMEWORK_SCOPE)
EOF
}

# ---------------------------------------------------------------- flags
F_NAME=""; F_CTX=""; F_MODEL=""; F_CONN=""; F_LEDGER=""; F_SCOPE=""
YES=0; UNINSTALL=0
need_value() { if [ "$2" -lt 2 ]; then echo "$1 needs a value" >&2; exit 2; fi; }
while [ $# -gt 0 ]; do
  case "$1" in
    --name) need_value --name $#; F_NAME="$2"; shift 2 ;;
    --name=*) F_NAME="${1#*=}"; shift ;;
    --model) need_value --model $#; F_MODEL="$2"; shift 2 ;;
    --model=*) F_MODEL="${1#*=}"; shift ;;
    --scope) need_value --scope $#; F_SCOPE="$2"; shift 2 ;;
    --scope=*) F_SCOPE="${1#*=}"; shift ;;
    --with-context-hygiene) F_CTX=on; shift ;;
    --without-context-hygiene) F_CTX=off; shift ;;
    --disable-connectors) F_CONN=on; shift ;;
    --keep-connectors) F_CONN=off; shift ;;
    --ledger) F_LEDGER=on; shift ;;
    --no-ledger) F_LEDGER=off; shift ;;
    --yes|-y) YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
case "${F_MODEL:-sonnet}" in sonnet|opus|keep) ;; *) echo "--model must be sonnet, opus or keep" >&2; exit 2 ;; esac
case "${F_SCOPE:-all}" in all|project) ;; *) echo "--scope must be all or project" >&2; exit 2 ;; esac

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "node not found on PATH; install Node 20+ first" >&2
  exit 1
fi

# ---------------------------------------------------------------- answers from a previous run
PRIOR=""
PRIOR_MARKER=""
# an explicit FRAMEWORK_HOME is the only place we look; otherwise the usual project-then-user order
if [ -n "${FRAMEWORK_HOME:-}" ]; then candidates=("$FRAMEWORK_HOME"); else candidates=("$PWD/.claude" "$HOME/.claude"); fi
for candidate in "${candidates[@]}"; do
  [ -n "$candidate" ] || continue
  if [ -z "$PRIOR" ] && [ -f "$candidate/framework/install.json" ]; then PRIOR="$candidate/framework/install.json"; fi
  # an install from before install.json existed records its mode in this marker only
  if [ -z "$PRIOR_MARKER" ] && [ -f "$candidate/framework/context-hygiene.on" ]; then PRIOR_MARKER="$candidate/framework/context-hygiene.on"; fi
done
prior() {  # prior <key>: the recorded answer, or nothing
  if [ -z "$PRIOR" ]; then return 0; fi
  "$NODE" "$REPO/bin/install-json.js" get "$PRIOR" "$1" 2>/dev/null || true
}

INTERACTIVE=0
if [ -t 0 ] && [ "$YES" -eq 0 ] && [ "$UNINSTALL" -eq 0 ]; then INTERACTIVE=1; fi

ask() {  # ask <prompt>: what was typed, or nothing when this run asks nothing
  local reply=""
  if [ "$INTERACTIVE" -eq 1 ]; then
    printf '%s ' "$1" >&2
    IFS= read -r reply || reply=""
  fi
  printf '%s' "$reply"
}
yesno() {  # yesno <prompt> <default on|off>
  local reply
  reply="$(ask "$1")"
  case "$reply" in
    [yY]|[yY][eE][sS]) echo on ;;
    [nN]|[nN][oO]) echo off ;;
    *) echo "$2" ;;
  esac
}
from_env_flag() {  # 1/0 -> on/off
  case "$1" in 1|on|true|yes) echo on ;; 0|off|false|no) echo off ;; *) echo "" ;; esac
}

# ---------------------------------------------------------------- the six questions
# 1. Name
NAME="$F_NAME"
[ -n "$NAME" ] || NAME="${FRAMEWORK_NAME:-}"
[ -n "$NAME" ] || NAME="$(prior name)"
if [ -z "$NAME" ]; then
  # `|| true` keeps `set -o pipefail` from handing git's exit status to `set -e`: with no readable
  # user.name the pipeline fails even though awk succeeds, which would abort the run before the
  # fallback below. Absent git, absent config and an empty name all land on "you".
  DEFAULT_NAME="$(git config user.name 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$DEFAULT_NAME" ] || DEFAULT_NAME="you"
  NAME="$(ask "What should Claude call you? [$DEFAULT_NAME]")"
  [ -n "$NAME" ] || NAME="$DEFAULT_NAME"
fi

# 2. Context watch
CTX_MODE="$F_CTX"
[ -n "$CTX_MODE" ] || CTX_MODE="$(from_env_flag "${FRAMEWORK_CONTEXT_HYGIENE:-}")"
[ -n "$CTX_MODE" ] || CTX_MODE="$(prior contextHygiene)"
if [ -z "$CTX_MODE" ] && [ -n "$PRIOR_MARKER" ]; then CTX_MODE=on; fi
[ -n "$CTX_MODE" ] || CTX_MODE="$(yesno 'Warn you when a chat is getting full and save notes for a fresh one? This interrupts work and is not for unattended or overnight runs. [y/N]' off)"

# 3. Main model
MODEL="$F_MODEL"
[ -n "$MODEL" ] || MODEL="${FRAMEWORK_MODEL:-}"
[ -n "$MODEL" ] || MODEL="$(prior model)"
if [ -z "$MODEL" ]; then
  case "$(ask 'Which model should the main chat run on? [sonnet]/opus/keep')" in
    opus) MODEL=opus ;;
    keep) MODEL=keep ;;
    *) MODEL=sonnet ;;
  esac
fi
case "$MODEL" in sonnet|opus|keep) ;; *) echo "model must be sonnet, opus or keep" >&2; exit 2 ;; esac

# 4. Connectors
CONN="$F_CONN"
[ -n "$CONN" ] || CONN="$(from_env_flag "${FRAMEWORK_DISABLE_CONNECTORS:-}")"
[ -n "$CONN" ] || CONN="$(prior connectors)"
[ -n "$CONN" ] || CONN="$(yesno 'Turn off claude.ai connectors (Gmail, Drive, etc.) inside Claude Code to save context? [y/N]' off)"

# 5. Ledger
LEDGER="$F_LEDGER"
[ -n "$LEDGER" ] || LEDGER="$(from_env_flag "${FRAMEWORK_LEDGER:-}")"
[ -n "$LEDGER" ] || LEDGER="$(prior ledger)"
[ -n "$LEDGER" ] || LEDGER="$(yesno 'Keep a local log of helper calls? [Y/n]' on)"

# 6. Scope
SCOPE="$F_SCOPE"
[ -n "$SCOPE" ] || SCOPE="${FRAMEWORK_SCOPE:-}"
[ -n "$SCOPE" ] || SCOPE="$(prior scope)"
if [ -z "$SCOPE" ]; then
  case "$(ask 'Install for all projects, or this project only? [all]/project')" in
    project|p) SCOPE=project ;;
    *) SCOPE=all ;;
  esac
fi
case "$SCOPE" in all|project) ;; *) echo "scope must be all or project" >&2; exit 2 ;; esac

if [ "$SCOPE" = project ]; then
  DEST="${FRAMEWORK_HOME:-$PWD/.claude}"
  CLAUDE_MD="$PWD/CLAUDE.md"
else
  DEST="${FRAMEWORK_HOME:-$HOME/.claude}"
  CLAUDE_MD="$DEST/CLAUDE.md"
fi
SETTINGS="$DEST/settings.json"
INSTALL_JSON="$DEST/framework/install.json"
BACKUP_DIR="$DEST/framework/backups"
MARKER="$DEST/framework/context-hygiene.on"

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" -eq 1 ]; then
  if [ ! -f "$INSTALL_JSON" ]; then
    echo "no install recorded at $INSTALL_JSON; nothing to uninstall" >&2
    exit 1
  fi
  read_record() { "$NODE" "$REPO/bin/install-json.js" get "$INSTALL_JSON" "$1"; }
  U_CLAUDE_MD="$(read_record claudeMd)"
  U_KEYS="$(read_record settingsKeys)"
  U_FILES="$(read_record files)"
  U_MADE_SETTINGS="$(read_record createdSettings)"
  U_MADE_CLAUDE_MD="$(read_record createdClaudeMd)"

  if [ -f "$SETTINGS" ] && "$NODE" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$SETTINGS" 2>/dev/null; then
    "$NODE" "$REPO/bin/merge-settings.js" --remove "$SETTINGS" "$REPO/settings/settings.patch.json" "$DEST/hooks" "$NODE" >/dev/null
    "$NODE" "$REPO/bin/merge-settings.js" --remove "$SETTINGS" "$MODULE/settings.patch.json" "$DEST/hooks" "$NODE" >/dev/null
    if [ -n "$U_KEYS" ]; then
      # keys are bare identifiers, so splitting on whitespace is safe here
      # shellcheck disable=SC2086
      "$NODE" "$REPO/bin/set-key.js" --delete "$SETTINGS" $U_KEYS
    fi
    U_PREV="$(read_record previous)"
    if [ -n "$U_PREV" ]; then
      while IFS= read -r k; do
        [ -n "$k" ] || continue
        v="$(read_record "previous.$k")"
        if [ -n "$v" ]; then "$NODE" "$REPO/bin/set-key.js" "$SETTINGS" "$k" "$v" >/dev/null; fi
      done <<UNINSTALL_PREV
$U_PREV
UNINSTALL_PREV
    fi
    if [ "$U_MADE_SETTINGS" = true ]; then rm -f "$SETTINGS"; fi
  fi

  if [ -n "$U_CLAUDE_MD" ]; then
    if [ "$U_MADE_CLAUDE_MD" = true ]; then
      "$NODE" "$REPO/bin/install-claude-md.js" --remove "$U_CLAUDE_MD" --delete-if-empty
    else
      "$NODE" "$REPO/bin/install-claude-md.js" --remove "$U_CLAUDE_MD"
    fi
  fi

  if [ -n "$U_FILES" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] && rm -f "$f"
    done <<UNINSTALL_FILES
$U_FILES
UNINSTALL_FILES
  fi
  rm -f "$MARKER" "$INSTALL_JSON"
  for d in "$DEST/hooks/lib" "$DEST/hooks" "$DEST/agents" "$DEST/skills/handoff" "$DEST/skills" \
           "$DEST/framework/ledger" "$DEST/framework" "$DEST"; do
    rmdir "$d" 2>/dev/null || true
  done
  echo "Uninstalled the delegation framework from $DEST"
  if [ -d "$BACKUP_DIR" ]; then echo "Backups kept in: $BACKUP_DIR"; fi
  exit 0
fi

export FRAMEWORK_NAME="$NAME"

# ---------------------------------------------------------------- install
HAD_SETTINGS=true; [ -f "$SETTINGS" ] || HAD_SETTINGS=false
HAD_CLAUDE_MD=true; [ -f "$CLAUDE_MD" ] || HAD_CLAUDE_MD=false
HAD_FRAMEWORK_JSON=true; [ -f "$DEST/framework.json" ] || HAD_FRAMEWORK_JSON=false

mkdir -p "$DEST/hooks/lib" "$DEST/agents" "$DEST/skills/handoff" "$DEST/framework"
if [ "$LEDGER" = on ]; then mkdir -p "$DEST/framework/ledger"; fi

# Files this run writes. settings.json and CLAUDE.md are not in here: they are the user's own
# files, edited in place, and --uninstall edits them back rather than deleting them.
FILES=()

cp "$REPO/hooks/ledger.js" "$DEST/hooks/"; FILES+=("$DEST/hooks/ledger.js")
for f in "$REPO"/hooks/lib/*.js; do cp "$f" "$DEST/hooks/lib/"; FILES+=("$DEST/hooks/lib/$(basename "$f")"); done
for f in "$REPO"/agents/*.md; do cp "$f" "$DEST/agents/"; FILES+=("$DEST/agents/$(basename "$f")"); done

if [ "$CTX_MODE" = on ]; then
  for f in "$MODULE"/hooks/*.js; do cp "$f" "$DEST/hooks/"; FILES+=("$DEST/hooks/$(basename "$f")"); done
  "$NODE" "$REPO/bin/subst-name.js" "$MODULE/handoff-SKILL.md" "$DEST/skills/handoff/SKILL.md"
else
  for h in $MODULE_HOOKS; do rm -f "$DEST/hooks/$h"; done
  "$NODE" "$REPO/bin/subst-name.js" "$REPO/skills/handoff/SKILL.md" "$DEST/skills/handoff/SKILL.md"
fi
FILES+=("$DEST/skills/handoff/SKILL.md")
chmod +x "$DEST"/hooks/*.js 2>/dev/null || true

if [ ! -f "$DEST/framework.json" ]; then
  cp "$REPO/settings/framework.defaults.json" "$DEST/framework.json"
fi
if [ "$HAD_FRAMEWORK_JSON" = false ]; then FILES+=("$DEST/framework.json"); fi
if [ "$LEDGER" = on ]; then
  "$NODE" "$REPO/bin/set-key.js" "$DEST/framework.json" ledger true >/dev/null
else
  "$NODE" "$REPO/bin/set-key.js" "$DEST/framework.json" ledger false >/dev/null
fi
if [ "$CTX_MODE" = on ]; then
  "$NODE" "$REPO/bin/merge-defaults.js" "$DEST/framework.json" "$MODULE/framework.defaults.json"
fi

if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
if ! "$NODE" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$SETTINGS" 2>/dev/null; then
  echo "$SETTINGS is not valid JSON; refusing to touch it" >&2
  exit 1
fi
# Backups live inside the framework directory, never beside settings.json, so --uninstall knows
# where they are and can leave them there. Names sort chronologically; only the 5 newest are kept.
mkdir -p "$BACKUP_DIR"
BAK="$BACKUP_DIR/settings.json.$(date +%Y%m%d-%H%M%S)"
bak_n=1
while [ -e "$BAK" ]; do
  BAK="$BACKUP_DIR/settings.json.$(date +%Y%m%d-%H%M%S)-$(printf '%02d' "$bak_n")"
  bak_n=$((bak_n + 1))
done
cp "$SETTINGS" "$BAK"
BAK_COUNT="$(ls -1 "$BACKUP_DIR" | wc -l | tr -d ' ')"
if [ "$BAK_COUNT" -gt 5 ]; then
  ls -1 "$BACKUP_DIR" | sort | sed -n "1,$((BAK_COUNT - 5))p" | while IFS= read -r old; do
    rm -f "$BACKUP_DIR/$old"
  done
fi

# Keys this run adds go in ADDED_KEYS, so --uninstall deletes them; the value a key the user
# already had is passed to install.json, which keeps the first one it is told and so survives
# re-runs. Between them, --uninstall can undo every settings.json key this installer writes.
ADDED_KEYS=()
PREV_KEYS=()
set_key() {  # set_key <key> <json value>
  local out
  out="$("$NODE" "$REPO/bin/set-key.js" "$SETTINGS" "$1" "$2")"
  case "$out" in
    added) ADDED_KEYS+=("$1") ;;
    'updated '*) PREV_KEYS+=("$1=${out#updated }") ;;
  esac
}
recorded() {  # recorded <key>: what a previous run into this DEST wrote, or nothing
  [ -f "$INSTALL_JSON" ] || return 0
  "$NODE" "$REPO/bin/install-json.js" get "$INSTALL_JSON" "$1" 2>/dev/null || true
}
unset_key() {  # unset_key <key>: undo a key this installer set, and only such a key
  local prev
  prev="$(recorded "previous.$1")"
  if [ -n "$prev" ]; then
    "$NODE" "$REPO/bin/set-key.js" "$SETTINGS" "$1" "$prev" >/dev/null
    return 0
  fi
  case " $(recorded settingsKeys | tr '\n' ' ') " in
    *" $1 "*) "$NODE" "$REPO/bin/set-key.js" --delete "$SETTINGS" "$1" ;;
  esac
}
if [ "$LEDGER" = on ]; then
  "$NODE" "$REPO/bin/merge-settings.js" "$SETTINGS" "$REPO/settings/settings.patch.json" "$DEST/hooks" "$NODE"
else
  "$NODE" "$REPO/bin/merge-settings.js" --remove "$SETTINGS" "$REPO/settings/settings.patch.json" "$DEST/hooks" "$NODE"
fi
if [ "$CTX_MODE" = on ]; then
  "$NODE" "$REPO/bin/merge-settings.js" "$SETTINGS" "$MODULE/settings.patch.json" "$DEST/hooks" "$NODE"
  set_key autoCompactWindow 220000
else
  "$NODE" "$REPO/bin/merge-settings.js" --remove "$SETTINGS" "$MODULE/settings.patch.json" "$DEST/hooks" "$NODE"
  unset_key autoCompactWindow
fi
if [ "$MODEL" != keep ]; then set_key model "\"$MODEL\""; fi
if [ "$CONN" = on ]; then set_key disableClaudeAiConnectors true; fi

if [ "$SCOPE" = project ] && [ ! -f "$CLAUDE_MD" ]; then
  cp "$REPO/templates/project/CLAUDE.md" "$CLAUDE_MD"
fi
if [ "$CTX_MODE" = on ]; then
  "$NODE" "$REPO/bin/install-claude-md.js" "$CLAUDE_MD" "$REPO/claude-md/framework-block.md" "$MODULE/context-rules.md"
  touch "$MARKER"
else
  "$NODE" "$REPO/bin/install-claude-md.js" "$CLAUDE_MD" "$REPO/claude-md/framework-block.md"
  rm -f "$MARKER"
fi

"$NODE" "$REPO/bin/install-json.js" write "$INSTALL_JSON" \
  "name=$NAME" "contextHygiene=$CTX_MODE" "model=$MODEL" "connectors=$CONN" "ledger=$LEDGER" \
  "scope=$SCOPE" "dest=$DEST" "claudeMd=$CLAUDE_MD" \
  "createdSettings=$([ "$HAD_SETTINGS" = false ] && echo true || echo false)" \
  "createdClaudeMd=$([ "$HAD_CLAUDE_MD" = false ] && echo true || echo false)" \
  "createdFrameworkJson=$([ "$HAD_FRAMEWORK_JSON" = false ] && echo true || echo false)" \
  --keys ${ADDED_KEYS[@]+"${ADDED_KEYS[@]}"} --files ${FILES[@]+"${FILES[@]}"} \
  --previous ${PREV_KEYS[@]+"${PREV_KEYS[@]}"}

echo "Installed delegation framework into $DEST"
echo "Name: $NAME. Model: $MODEL. Ledger: $LEDGER. Scope: $SCOPE. Connectors: $(if [ "$CONN" = on ]; then echo "off in Claude Code"; else echo untouched; fi)."
if [ "$CTX_MODE" = on ]; then
  echo "Context hygiene module: ON (hooks: $MODULE_HOOKS). Turn off with ./install.sh --without-context-hygiene"
else
  echo "Context hygiene module: off (delegation-only). Turn on with ./install.sh --with-context-hygiene"
fi
echo "Settings backup: $BAK"
echo "Answers recorded in $INSTALL_JSON; ./install.sh --uninstall removes what this added."
echo "Next: restart Claude Code, then run bin/ledger.sh to see subagent usage for today."
