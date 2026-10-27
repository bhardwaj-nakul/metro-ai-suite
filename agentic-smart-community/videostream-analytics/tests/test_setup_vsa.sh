#!/bin/bash

# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Tests for videostream-analytics/setup_vsa.sh: seed idempotency (the core
# contract), dual-mode sourcing, symlink lifecycle, and the rename guard.
# A stub IR pair stands in for the real model so no download/conversion runs.
#
# Run: bash videostream-analytics/tests/test_setup_vsa.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SETUP="${VSA_DIR}/setup_vsa.sh"
LINK="${VSA_DIR}/config/config.yaml"

WORK="$(mktemp -d)"
MODEL_DIR_T="${WORK}/models"
CACHE_T="${WORK}/cache"
mkdir -p "${MODEL_DIR_T}/yolo11s/FP16"
printf 'x' > "${MODEL_DIR_T}/yolo11s/FP16/yolo11s.xml"
printf 'x' > "${MODEL_DIR_T}/yolo11s/FP16/yolo11s.bin"

export PREFILTER_MODEL_DIR="$MODEL_DIR_T"
export VIDEOSTREAM_CACHE_HOST="$CACHE_T"

fail() { echo "[FAIL] $*" >&2; exit 1; }
ok()   { echo "[ ok ] $*"; }

# Preserve any pre-existing symlink the user's real setup created; restore on exit.
had_link=0 prev_target=""
if [[ -L "$LINK" ]]; then had_link=1; prev_target="$(readlink "$LINK")"; fi
[[ -f "$LINK" && ! -L "$LINK" ]] && fail "${LINK} is a pre-existing regular file; refusing to test against it"

cleanup() {
  rm -rf "$WORK"
  if [[ "$had_link" == 1 ]]; then
    ln -sfn "$prev_target" "$LINK"
  elif [[ -L "$LINK" && "$(readlink "$LINK")" == "${CACHE_T}/config.yaml" ]]; then
    rm -f "$LINK"
  fi
}
trap cleanup EXIT

# --- 1) sourcing defines functions, no side effects ---------------------------
before_link_state="-"
[[ -L "$LINK" ]] && before_link_state="$(readlink "$LINK")"
(
  source "$SETUP"
  declare -F vsa_prepare >/dev/null || exit 1
  declare -F vsa_seed_config >/dev/null || exit 1
  declare -F vsa_prepare_model >/dev/null || exit 1
  [[ ! -e "${CACHE_T}/config.yaml" ]] || exit 1
) || fail "sourcing produced side effects or is missing functions"
after_link_state="-"
[[ -L "$LINK" ]] && after_link_state="$(readlink "$LINK")"
[[ "$before_link_state" == "$after_link_state" ]] || fail "sourcing touched the symlink"
ok "source: functions defined, no files, symlink untouched"

# --- 2) first run seeds config + creates the symlink --------------------------
bash "$SETUP" >/dev/null || fail "setup_vsa.sh exited non-zero"
[[ -f "${CACHE_T}/config.yaml" ]] || fail "config was not seeded"
[[ -L "$LINK" ]] || fail "symlink not created at ${LINK}"
[[ "$(readlink "$LINK")" == "${CACHE_T}/config.yaml" ]] || fail "symlink target wrong: $(readlink "$LINK")"
grep -q "${MODEL_DIR_T}/yolo11s/FP16/yolo11s.xml" "${CACHE_T}/config.yaml" \
  || fail "seeded config lacks the absolute model path"
grep -q "^model_dir:" "${CACHE_T}/config.yaml" && fail "seeded config exposes the internal model_dir"
ok "first run: seeded config, absolute paths, symlink created"

# --- 3) unknown subcommand rejected -------------------------------------------
bash "$SETUP" bogus >/dev/null 2>&1
[[ $? -eq 2 ]] || fail "unknown subcommand should exit 2"
ok "unknown subcommand exits 2"

# --- 4) every run regenerates the config; a differing copy is backed up ------
live="${CACHE_T}/config.yaml"
echo "# user-customization-marker" >> "$live"
customized_md5="$(md5sum "$live" | awk '{print $1}')"
out="$(bash "$SETUP" 2>&1)" || fail "re-run exited non-zero"
grep -q "Backed up" <<<"$out" || fail "re-run over a customized config did not report a backup"
grep -q "Updated configuration" <<<"$out" || fail "re-run did not report the update"
grep -q "user-customization-marker" "$live" && fail "customization survived in the live config (should be regenerated)"
mapfile -t baks < <(compgen -G "${live}.*.bak" || true)
[[ ${#baks[@]} -eq 1 ]] || fail "expected exactly one backup, found ${#baks[@]}"
[[ "$(md5sum "${baks[0]}" | awk '{print $1}')" == "$customized_md5" ]] \
  || fail "backup does not hold the customized content"
[[ "${baks[0]}" =~ config\.yaml\.[0-9]{8}-[0-9]{6}\.bak$ ]] || fail "backup name not YYYYMMDD-HHMMSS.bak: ${baks[0]}"
grep -q "${MODEL_DIR_T}/yolo11s/FP16/yolo11s.xml" "$live" || fail "regenerated config lacks the absolute model path"
[[ -L "$LINK" ]] || fail "symlink lost on re-run"
ok "re-run: customized config backed up as .bak, live config regenerated"

# --- 4b) an unchanged config is a no-op: no rewrite, no new backup ------------
before_md5="$(md5sum "$live" | awk '{print $1}')"
before_mtime="$(stat -c %Y "$live")"
before_inode="$(stat -c %i "$live")"
sleep 1.1
out="$(bash "$SETUP" 2>&1)" || fail "no-op re-run exited non-zero"
grep -q "Configuration unchanged" <<<"$out" || fail "identical re-run did not report unchanged"
[[ "$(md5sum "$live" | awk '{print $1}')" == "$before_md5" ]] || fail "content changed on identical re-run"
[[ "$(stat -c %Y "$live")" == "$before_mtime" ]] || fail "mtime changed on identical re-run"
[[ "$(stat -c %i "$live")" == "$before_inode" ]] || fail "file was replaced on identical re-run (inode changed)"
mapfile -t baks < <(compgen -G "${live}.*.bak" || true)
[[ ${#baks[@]} -eq 1 ]] || fail "identical re-run created a backup (${#baks[@]} total)"
[[ -z "$(compgen -G "${CACHE_T}/.config.yaml.*" || true)" ]] || fail "temp file left behind"
ok "identical re-run: untouched (md5, mtime, inode), no extra backup, no temp leftovers"

# --- 4c) a non-regular target is refused, never replaced ----------------------
mv "$live" "${live}.aside"
ln -s "${live}.aside" "$live"
bash "$SETUP" >/dev/null 2>&1 && fail "should refuse a symlink at the config path"
[[ -L "$live" ]] || fail "the symlink at the config path was replaced"
rm -f "$live"; mv "${live}.aside" "$live"
ok "symlink at the config path refused"

# --- 5) a regular file at the link path is not clobbered ----------------------
rm -f "$LINK"
printf 'do not touch\n' > "$LINK"
out="$(bash "$SETUP" 2>&1)"
grep -qi "leaving it alone" <<<"$out" || fail "no warning for a regular file at the link path"
[[ "$(cat "$LINK")" == "do not touch" ]] || fail "regular file at link path was clobbered"
rm -f "$LINK"
ok "regular file at link path preserved with warning"

# --- 6) rename guard: no stale references to the old tracked path -------------
stale="$(grep -rn "config/config\.yaml" \
  --include="*.py" --include="*.sh" --include="*.yaml" --include="Dockerfile" \
  "$VSA_DIR" "${VSA_DIR}/../setup_docker.sh" "${VSA_DIR}/../docker" 2>/dev/null \
  | grep -v "config.yaml.example" \
  | grep -v "/app/config/config.yaml" \
  | grep -v "setup_vsa.sh" \
  | grep -v "test_setup_vsa.sh" || true)"
[[ -z "$stale" ]] || fail "stale references to config/config.yaml:\n${stale}"
ok "rename guard: no stale config/config.yaml references"

echo
ok "all setup_vsa.sh tests passed"
