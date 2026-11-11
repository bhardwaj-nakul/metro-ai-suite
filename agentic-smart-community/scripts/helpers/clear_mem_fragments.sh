#!/usr/bin/env bash
# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Reclaim fragmented memory / GPU-pinned system RAM
#
# drop_caches / swapoff only clear the page cache and swap.
# They cannot release GPU/IOMMU-pinned memory (it is neither cache nor swap).
# To release GPU-pinned system RAM, use one of these two approaches:
#   1) Stop all GPU-using containers and reload the xe / intel_vpu drivers
#   2) Reboot
#
# By default, this script performs gentle cleanup only (drop_caches + optional swap cycling).
# To reload GPU drivers, use --reload-gpu[ --hard]:
#
#   --reload-gpu        : Soft mode -- modprobe -r xe/intel_vpu; reports an error if
#                         gnome-shell holds the driver (does not terminate the desktop;
#                         suitable after manually switching the local session to a TTY).
#   --reload-gpu --hard : Hard mode -- run the reload in a separate system.slice scope,
#                         then isolate multi-user.target to stop the desktop, reload the
#                         drivers, and isolate graphical.target to restore the desktop.
#                         - Remote SSH sessions are unaffected; logs remain visible
#                         - Local gnome-terminal is terminated, but the script continues
#                           in the separate scope. Use journalctl -u gpu-reload.scope
#                           afterward to view the complete output.
#
# Usage:
#   ./clear_mem_fragments.sh                       # Gentle: drop_caches (+ optional swap cycling)
#   ./clear_mem_fragments.sh --reload-gpu          # + xe/intel_vpu reload (fails if held by the desktop)
#   ./clear_mem_fragments.sh --reload-gpu --hard   # + isolate multi-user, unload drivers, restore desktop
#
# sudo credentials:
#   The script first primes sudo, preferring $SUDO_PWD (usually exported in ~/.bashrc).
#   If unavailable, it prompts once and saves the password to ~/.bashrc for future use.

set -e

RELOAD_GPU=0
HARD_MODE=0
for arg in "$@"; do
  case "$arg" in
    --reload-gpu) RELOAD_GPU=1 ;;
    --hard) HARD_MODE=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ "$HARD_MODE" = "1" ] && [ "$RELOAD_GPU" != "1" ]; then
  echo "[error] --hard requires --reload-gpu" >&2
  exit 2
fi

# ------------------------------------------------------------
# Prime sudo credentials
# Prefer $SUDO_PWD (exported in ~/.bashrc); otherwise prompt once and save it to bashrc.
# Once primed, sudo caches credentials (15 minutes by default), avoiding further prompts.
# ------------------------------------------------------------
prime_sudo() {
  # Root does not need sudo.
  if [ "$(id -u)" = "0" ]; then
    return 0
  fi

  # Try reading from the environment.
  local pwd_from_env="${SUDO_PWD:-}"

  # If the current shell has not exported it but ~/.bashrc contains export SUDO_PWD=...
  # Non-interactive bash does not source .bashrc; read the literal value directly.
  if [ -z "$pwd_from_env" ] && [ -f "${HOME}/.bashrc" ]; then
    pwd_from_env=$(grep -E '^[[:space:]]*export[[:space:]]+SUDO_PWD=' "${HOME}/.bashrc" 2>/dev/null \
      | tail -n 1 \
      | sed -E 's/^[[:space:]]*export[[:space:]]+SUDO_PWD=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//' \
      || true)
  fi

  if [ -n "$pwd_from_env" ]; then
    if echo "$pwd_from_env" | sudo -S -v -p "" 2>/dev/null; then
      echo "[sudo] credential primed from \$SUDO_PWD"
      return 0
    else
      echo "[sudo] \$SUDO_PWD appears wrong; falling back to interactive prompt" >&2
    fi
  fi

  # Prompt once and save to ~/.bashrc for future use.
  echo "[sudo] \$SUDO_PWD not found; enter sudo password (will be saved to ~/.bashrc):"
  local pwd_in
  # -s silent, -r no escape interpretation
  read -rsp "sudo password: " pwd_in
  echo
  if [ -z "$pwd_in" ]; then
    echo "[sudo] empty password, aborting" >&2
    exit 1
  fi
  if ! echo "$pwd_in" | sudo -S -v -p "" 2>/dev/null; then
    echo "[sudo] password rejected by sudo, aborting" >&2
    exit 1
  fi
  echo "[sudo] credential verified"

  # Persist to ~/.bashrc, removing duplicate entries.
  local bashrc="${HOME}/.bashrc"
  if [ -w "$bashrc" ] || [ ! -e "$bashrc" ]; then
    # Remove existing SUDO_PWD lines to avoid accumulating entries.
    if [ -f "$bashrc" ]; then
      sed -i.bak '/^[[:space:]]*export[[:space:]]\+SUDO_PWD=/d' "$bashrc"
    fi
    # Wrap in single quotes; escape embedded single quotes as '\''.
    local escaped
    escaped=$(printf '%s' "$pwd_in" | sed "s/'/'\\\\''/g")
    {
      echo ""
      echo "# Added by clear_mem_fragments.sh on $(date -Iseconds)"
      echo "export SUDO_PWD='${escaped}'"
    } >> "$bashrc"
    echo "[sudo] saved to ${bashrc} (remove the line manually if you regret)"
  else
    echo "[sudo] ~/.bashrc not writable; credential not persisted" >&2
  fi
}

prime_sudo

# Keep sudo credentials valid in a background loop until the main script exits.
keep_sudo_alive() {
  while true; do
    sudo -n -v 2>/dev/null || exit
    sleep 30
  done
}
keep_sudo_alive &
KEEP_SUDO_PID=$!
trap 'kill $KEEP_SUDO_PID 2>/dev/null || true' EXIT

print_mem_breakdown() {
  awk '/MemTotal/{t=$2}/MemFree/{f=$2}/Buffers/{b=$2}/^Cached/{c=$2}/AnonPages/{a=$2}/^Slab/{s=$2}/KernelStack/{k=$2}/PageTables/{p=$2}/SecPageTables/{sp=$2}END{used=t-f-b-c; printf "used=%dMB  anon=%dMB  slab=%dMB  pgtbl=%dMB  iommu=%dMB\nUnaccounted (possibly GPU/IOMMU-pinned)=%dMB\n", used/1024,a/1024,s/1024,p/1024,sp/1024,(used-a-s-k-p-sp)/1024}' /proc/meminfo
}

print_mem_top5() {
  echo "---- $1 ----"
  free -h
  echo "Top 5 RSS consumers:"
  ps -eo pid,user,rss,pmem,comm --sort=-rss --no-headers | head -5 \
    | awk '{printf "  %7s %-12s %8.1f MB %5s%%  %s\n", $1, $2, $3/1024, $4, $5}'
  echo "Kernel breakdown:"
  print_mem_breakdown
  echo
}

# ------------------------------------------------------------
# GPU driver reload -- two modes
# ------------------------------------------------------------

reload_gpu_drivers_soft() {
  echo "[GPU] stopping all docker containers (they may pin GPU buffers)"
  if command -v docker >/dev/null 2>&1; then
    sudo docker ps -q | xargs -r sudo docker stop
  fi

  echo "[GPU] checking /dev/dri holders"
  if command -v lsof >/dev/null 2>&1; then
    sudo lsof /dev/dri/renderD128 /dev/dri/card0 2>/dev/null || true
  fi

  echo "[GPU] reloading intel_vpu + xe (console/wayland may flicker, SSH unaffected)"
  if ! sudo modprobe -r intel_vpu; then
    echo "[GPU] modprobe -r intel_vpu failed; skipping VPU reload"
  fi
  if ! sudo modprobe -r xe; then
    echo "[GPU] modprobe -r xe failed: driver is still in use"
    echo "[GPU] likely gnome-shell/compositor holds /dev/dri/*; try --reload-gpu --hard"
    sudo modprobe intel_vpu 2>/dev/null || true
    return 1
  fi
  sudo modprobe xe
  sudo modprobe intel_vpu
  echo "[GPU] driver reload complete"
}

reload_gpu_drivers_hard() {
  # --hard mode terminates the desktop. Execution order:
  #   1. Stop containers in the current shell, before the desktop is terminated.
  #   2. Write the reload commands to a temporary script.
  #   3. Use sudo systemd-run --scope to run it in a separate system.slice scope.
  #      This scope is outside session-N.scope and survives isolate multi-user.target.
  #   4. Inside the script:
  #        systemctl isolate multi-user.target   -- stop the desktop
  #        modprobe -r + modprobe
  #        systemctl isolate graphical.target    -- restore the desktop
  #
  # Remote SSH is unaffected; local gnome-terminal is terminated (the script continues).
  # Use journalctl -u gpu-reload.scope afterward to view the complete output.
  echo "[GPU/hard] stopping all docker containers"
  if command -v docker >/dev/null 2>&1; then
    sudo docker ps -q | xargs -r sudo docker stop
  fi

  local body=/tmp/smarthome-gpu-reload-body.sh
  cat > "$body" <<'BODY'
#!/bin/bash
# Runs in an isolated system.slice scope; survives graphical target teardown.
set +e
exec > >(logger -t gpu-reload) 2>&1
echo "[hard] begin — isolate multi-user.target"
systemctl isolate multi-user.target
sleep 2
echo "[hard] modprobe -r intel_vpu xe"
modprobe -r intel_vpu
modprobe -r xe
if [ $? -ne 0 ]; then
  echo "[hard] modprobe -r xe failed even after isolate multi-user; check lsof /dev/dri"
fi
echo "[hard] modprobe xe intel_vpu"
modprobe xe
modprobe intel_vpu
echo "[hard] isolate graphical.target (desktop coming back)"
systemctl isolate graphical.target
echo "[hard] done; desktop user must re-login"
BODY
  chmod +x "$body"

  echo "[GPU/hard] launching reload in isolated scope (gpu-reload.scope)"
  echo "[GPU/hard] WARNING: local gnome-terminal WILL be killed; SSH sessions survive."
  echo "[GPU/hard] Follow logs via:    journalctl -u gpu-reload.scope -f"
  echo "[GPU/hard] Or syslog tag:      journalctl -t gpu-reload -f"

  # --scope: run synchronously as a transient scope unit
  # --collect: auto-cleanup after exit
  # --unit: predictable unit name for journalctl
  # --property=KillMode=none: don't propagate signals (isolate-target would otherwise reach us)
  sudo systemd-run \
    --scope \
    --collect \
    --unit=gpu-reload \
    --property=KillMode=none \
    "$body" || {
      local rc=$?
      echo "[GPU/hard] systemd-run exited with $rc"
      return $rc
    }

  # Cleanup local body file (the scope already finished by the time --scope returns
  # and we're still alive, which means SSH session)
  rm -f "$body"
  echo "[GPU/hard] scope finished. Desktop should be back shortly."
}

# ------------------------------------------------------------
# Gentle cleanup: drop_caches + swap cycling
# ------------------------------------------------------------

print_mem_top5 "BEFORE cleanup"

echo "[1/3] sync + drop page/dentry/inode caches"
sync
echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null

echo "[2/3] check free vs swap-used before cycling swap"
free -h

used_swap_kb=$(awk '/^SwapTotal/{t=$2} /^SwapFree/{f=$2} END{print t-f}' /proc/meminfo)
if [ "${used_swap_kb:-0}" -gt 131072 ]; then
  echo "[3/3] swapoff/on to defrag swap (${used_swap_kb} kB in use)"
  sudo swapoff -a && sudo swapon -a
else
  echo "[3/3] swap use < 128 MB, skipping swapoff/on"
fi

if [ "$RELOAD_GPU" = "1" ]; then
  echo
  if [ "$HARD_MODE" = "1" ]; then
    reload_gpu_drivers_hard || true
  else
    reload_gpu_drivers_soft || true
  fi
fi

print_mem_top5 "AFTER cleanup"
