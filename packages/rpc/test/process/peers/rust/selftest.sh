#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository=$(CDPATH= cd -- "$here/../../../../../.." && pwd)
exec "$here/run.sh" --selftest --vectors "$repository/packages/rpc/schema/vectors"
