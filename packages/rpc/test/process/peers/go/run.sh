#!/bin/sh
# Reuse a system-temp binary until one Go source changes, then replace this shell with the peer.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temp_root=${TMPDIR:-/tmp}
source_key=$(printf "%s" "$script_dir" | cksum | cut -d " " -f 1)
build_dir="$temp_root/migai-rpc-peer-go-$(id -u)-$source_key"
binary="$build_dir/peer-go"
mkdir -p "$build_dir/cache"
needs_build=0
if [ ! -x "$binary" ]; then
  needs_build=1
else
  for source in "$script_dir"/*.go; do
    if [ "$source" -nt "$binary" ]; then
      needs_build=1
      break
    fi
  done
fi
if [ "$needs_build" -eq 1 ]; then
  candidate="$build_dir/peer-go.$$"
  GOTOOLCHAIN=local GO111MODULE=off GOCACHE="$build_dir/cache" GOTMPDIR="$build_dir" go build -o "$candidate" "$script_dir"/*.go
  mv "$candidate" "$binary"
fi
if [ "${1:-}" = "--executable" ]; then
  printf '%s\n' "$binary"
  exit 0
fi
exec "$binary" "$@"
