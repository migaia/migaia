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
# Distinct worktrees cannot reuse another checkout's compiled fixture or evidence.
SOURCE_KEY=$(printf "%s" "$SCRIPT_DIR" | cksum | cut -d " " -f 1)
BUILD_DIR="${TMPDIR:-/tmp}/migai-rpc-peer-ts-reference-$(id -u)-$SOURCE_KEY"
mkdir -p "$BUILD_DIR"
if [ ! -f "$BUILD_DIR/selftest.mjs" ] || [ "$SCRIPT_DIR/peer.mts" -nt "$BUILD_DIR/selftest.mjs" ] || [ "$SCRIPT_DIR/selftest.mts" -nt "$BUILD_DIR/selftest.mjs" ]; then
  "$TSC" --target ES2022 --module NodeNext --moduleResolution NodeNext --types node \
    --typeRoots "$TYPES" --outDir "$BUILD_DIR" --rootDir "$SCRIPT_DIR" \
    "$SCRIPT_DIR/peer.mts" "$SCRIPT_DIR/selftest.mts"
fi
vector_status=0
node "$BUILD_DIR/selftest.mjs" --vectors "$REPO_ROOT/packages/rpc/schema/vectors" || vector_status=$?
behavior_status=0
python3 -B "$SCRIPT_DIR/../behavior_check.py" --language ts-reference || behavior_status=$?
notification_status=0
python3 -B "$SCRIPT_DIR/notification-check.py" || notification_status=$?
routing_status=0
python3 -B "$SCRIPT_DIR/routing-check.py" || routing_status=$?
if [ "$vector_status" -ne 0 ] || [ "$behavior_status" -ne 0 ] || [ "$notification_status" -ne 0 ] || [ "$routing_status" -ne 0 ]; then
  exit 1
fi
