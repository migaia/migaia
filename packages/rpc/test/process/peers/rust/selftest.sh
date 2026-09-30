#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository=$(CDPATH= cd -- "$here/../../../../../.." && pwd)
vector_status=0
"$here/run.sh" --selftest --vectors "$repository/packages/rpc/schema/vectors" || vector_status=$?
behavior_status=0
python3 -B "$here/../behavior_check.py" --language rust || behavior_status=$?
if [ "$vector_status" -ne 0 ] || [ "$behavior_status" -ne 0 ]; then
  exit 1
fi
