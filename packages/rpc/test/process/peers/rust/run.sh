#!/bin/sh
# Build without downloading dependencies; keep all compiler output in system temp.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target_dir="${TMPDIR:-/tmp}/migaia-rpc-peer-rust-target"
CARGO_TARGET_DIR="$target_dir" cargo build --offline --locked --manifest-path "$here/Cargo.toml" --quiet
exec "$target_dir/debug/rpc-native-peer" "$@"
