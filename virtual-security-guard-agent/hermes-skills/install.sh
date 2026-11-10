#!/usr/bin/env bash
# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Install Argus on the Hermes host: SOUL.md into $HERMES_HOME, the VSG skills
# into $HERMES_SKILLS_DIR, then restart the Hermes gateway so they load.
#
#   ./install.sh                 # install and restart the gateway
#   ./install.sh --no-restart    # install only
#   ./install.sh --exclusive     # first move every existing skill out of
#                                # $HERMES_HOME/skills, so only these remain
#
# Env: HERMES_HOME (default ~/.hermes),
#      HERMES_SKILLS_DIR (default $HERMES_HOME/skills/security).
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_SKILLS_DIR="${HERMES_SKILLS_DIR:-$HERMES_HOME/skills/security}"
SKILLS=(virtual-security-guard vsg-incident-report)

restart=1
exclusive=0
for arg in "$@"; do
  case "$arg" in
    --no-restart) restart=0 ;;
    --exclusive) exclusive=1 ;;
    *) echo "usage: $0 [--no-restart] [--exclusive]" >&2; exit 2 ;;
  esac
done

mkdir -p "$HERMES_HOME" "$HERMES_SKILLS_DIR"

# SOUL.md is the host-wide Hermes identity: keep the previous one.
soul="$HERMES_HOME/SOUL.md"
if [[ -f "$soul" ]] && ! cmp -s "$SRC_DIR/SOUL.md" "$soul"; then
  backup="$soul.bak.$(date +%Y%m%d%H%M%S)"
  cp "$soul" "$backup"
  echo "Backed up $soul to $backup"
fi
cp "$SRC_DIR/SOUL.md" "$soul"
echo "Installed SOUL.md to $soul"

# --exclusive: Hermes loads every SKILL.md under $HERMES_HOME/skills, including
# the bundled ones its installer seeds. Move them all aside (never delete)
# before installing, so Argus is the only skill set. Parents sort before their
# children; a symlinked skill is moved as the link itself.
if (( exclusive )); then
  root="$HERMES_HOME/skills"
  backup="$HERMES_HOME/skills.removed.$(date +%Y%m%d%H%M%S)"
  mapfile -d '' found < <(find -L "$root" -mindepth 1 -name '.*' -prune -o -name SKILL.md -print0 2>/dev/null | sort -z)
  moved=0
  for skill_md in "${found[@]}"; do
    unit="$(dirname "$skill_md")"
    p="$unit"
    while [[ "$p" != "$root" && "$p" != / ]]; do
      if [[ -L "$p" ]]; then unit="$p"; fi
      p="$(dirname "$p")"
    done
    [[ "$unit" != "$root" ]] || continue
    [[ -e "$unit" || -L "$unit" ]] || continue   # already moved with a parent
    rel="${unit#"$root"/}"
    mkdir -p "$backup/$(dirname "$rel")"
    mv "$unit" "$backup/$rel"
    moved=$((moved + 1))
  done
  if (( moved )); then
    echo "Moved $moved existing skill(s) from $root to $backup"
  fi
  mkdir -p "$HERMES_SKILLS_DIR"
fi

# Replace each skill directory so files removed upstream do not linger.
for skill in "${SKILLS[@]}"; do
  rm -rf "${HERMES_SKILLS_DIR:?}/$skill"
  cp -r "$SRC_DIR/$skill" "$HERMES_SKILLS_DIR/"
  echo "Installed skill $skill to $HERMES_SKILLS_DIR/$skill"
done

if (( restart )); then
  if ! command -v hermes >/dev/null; then
    echo "hermes CLI not found on PATH; restart the Hermes gateway yourself." >&2
    exit 1
  fi
  hermes gateway restart
  echo "Hermes gateway restarted. Start a new session in the VSG UI to use the new skills."
else
  echo "Skipped restart. Run 'hermes gateway restart' to load the changes."
fi
