#!/bin/sh
# Build once before readiness; both runtimes execute the same emitted JavaScript artifacts.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compiled=$("${RPC_PEERS_NODE:-node}" "$here/node-runner.mjs" --executable)
RPC_PEERS_VECTOR_ROOT="$here/../../../../schema/vectors"
export RPC_PEERS_VECTOR_ROOT
if [ "${1:-}" = "--executable" ]; then
  printf '%s\n' "$compiled"
  exit 0
fi
if [ "${RPC_PEERS_RUNTIME:-bun}" = node ]; then
  exec "${RPC_PEERS_NODE:-node}" "$compiled" "$@"
fi
exec "${RPC_PEERS_BUN:-bun}" "$compiled" "$@"
