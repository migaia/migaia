#!/bin/sh
# Public exports resolve from built package artifacts in this owning workspace.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository=$(git -C "$here" rev-parse --show-toplevel)
cd "$repository/packages/rpc"
exec pnpm exec vitest run test/process/peers/ts/*-vectors.test.ts --coverage.enabled=false
