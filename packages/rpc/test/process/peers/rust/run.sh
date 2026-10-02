#!/bin/sh
# Build the optimized measurement peer offline in a stable, worktree-specific directory.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_key=$(printf "%s" "$here" | cksum | cut -d " " -f 1)
target_dir="${TMPDIR:-/tmp}/migaia-rpc-peer-rust-target-$source_key"
CARGO_TARGET_DIR="$target_dir" cargo build --release --offline --locked --manifest-path "$here/Cargo.toml" --quiet
if [ "${1:-}" = "--executable" ]; then
  printf '%s\n' "$target_dir/release/rpc-native-peer"
  exit 0
fi
exec "$target_dir/release/rpc-native-peer" "$@"
