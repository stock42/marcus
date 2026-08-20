#!/bin/sh
# Licensed under the Apache License, Version 2.0.
set -eu

prefix="${HOME}/.marcus"
data_dir="${MARCUS_DATA_DIR:-${HOME}/.marcus}"
config_dir="${MARCUS_CONFIG_DIR:-${HOME}/.marcus}"
system_install=false
purge=false
confirmation=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    --system)
      prefix="/usr/local"
      data_dir="/var/lib/marcus"
      config_dir="/etc/marcus"
      system_install=true
      shift
      ;;
    --data-dir) data_dir="$2"; shift 2 ;;
    --config-dir) config_dir="$2"; shift 2 ;;
    --purge) purge=true; shift ;;
    --confirm) confirmation="$2"; shift 2 ;;
    *) printf 'Unknown uninstall option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ "$purge" = true ]; then
  if [ "$confirmation" != "PURGE MARCUS DATA" ]; then
    printf 'Data purge requires: --purge --confirm "PURGE MARCUS DATA"\n' >&2
    exit 2
  fi
  case "$data_dir" in
    ""|/|"${HOME}") printf 'Refusing unsafe data directory: %s\n' "$data_dir" >&2; exit 6 ;;
    "$prefix") [ "$prefix" = "${HOME}/.marcus" ] || { printf 'Refusing data directory equal to custom prefix: %s\n' "$data_dir" >&2; exit 6; } ;;
  esac
  case "$config_dir" in
    ""|/|"${HOME}") printf 'Refusing unsafe config directory: %s\n' "$config_dir" >&2; exit 6 ;;
    "$prefix") [ "$prefix" = "${HOME}/.marcus" ] || { printf 'Refusing config directory equal to custom prefix: %s\n' "$config_dir" >&2; exit 6; } ;;
  esac
fi

if [ "$system_install" = true ] && command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now marcus-api.service marcusd.service 2>/dev/null || true
  rm -f /etc/systemd/system/marcus-api.service /etc/systemd/system/marcusd.service
  systemctl daemon-reload
fi

rm -f "$prefix/bin/marcus" "$prefix/bin/marcusd" "$prefix/bin/marcus-api"
rm -f "$prefix/lib/marcus/marcus-runtime-host" "$prefix/lib/marcus/marcus-agent-process" "$prefix/lib/marcus/marcus-manifest-loader"
rmdir "$prefix/lib/marcus" 2>/dev/null || true

if [ "$purge" = true ]; then
  rm -rf "$data_dir" "$config_dir"
  printf 'Marcus binaries, configuration, and data were removed.\n'
else
  printf 'Marcus binaries and services were removed.\n'
  printf 'Configuration preserved at: %s\n' "$config_dir"
  printf 'Data preserved at: %s\n' "$data_dir"
fi
