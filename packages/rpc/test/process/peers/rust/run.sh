#!/bin/sh
# Build without downloading dependencies; keep all compiler output in system temp.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_key=$(printf "%s" "$here" | cksum | cut -d " " -f 1)
target_dir="${TMPDIR:-/tmp}/migaia-rpc-peer-rust-target-$source_key"
CARGO_TARGET_DIR="$target_dir" cargo build --offline --locked --manifest-path "$here/Cargo.toml" --quiet
exec "$target_dir/debug/rpc-native-peer" "$@"
