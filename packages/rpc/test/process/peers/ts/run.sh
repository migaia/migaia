#!/bin/sh
# Supervisor supplies installed runtime paths; wrappers never add or download packages.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "${RPC_PEERS_RUNTIME:-bun}" = node ]; then
  exec "${RPC_PEERS_NODE:-node}" "$here/node-runner.mjs" "$@"
fi
exec "${RPC_PEERS_BUN:-bun}" "$here/peer.mts" "$@"
