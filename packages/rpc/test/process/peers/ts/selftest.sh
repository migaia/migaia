#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
TSC=${RPC_PEERS_TSC:-$REPO_ROOT/node_modules/.bin/tsc}
TYPES=${RPC_PEERS_TYPES:-$REPO_ROOT/node_modules/@types}
if [ ! -x "$TSC" ] || [ ! -d "$TYPES" ]; then
  echo 'TS_TOOLCHAIN_MISSING set RPC_PEERS_TSC and RPC_PEERS_TYPES' >&2
  exit 2
fi
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/rpc-peers-ts.XXXXXX")
"$TSC" --target ES2022 --module NodeNext --moduleResolution NodeNext --types node \
  --typeRoots "$TYPES" --outDir "$BUILD_DIR" --rootDir "$SCRIPT_DIR" \
  "$SCRIPT_DIR/peer.mts" "$SCRIPT_DIR/selftest.mts"
exec node "$BUILD_DIR/selftest.mjs" --vectors "$REPO_ROOT/packages/rpc/schema/vectors"
