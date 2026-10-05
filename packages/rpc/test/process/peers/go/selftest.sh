#!/bin/sh
# Check all local vectors; missing upstream vector assets stay PENDING with exit code 1.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vectors_dir=${1:-"$script_dir/../../../../schema/vectors"}
vector_status=0
"$script_dir/run.sh" --selftest --vectors "$vectors_dir" || vector_status=$?
behavior_status=0
python3 -B "$script_dir/../behavior_check.py" --language go || behavior_status=$?
baseline_status=0
python3 -B "$script_dir/../baseline_check.py" --language go || baseline_status=$?
if [ "$baseline_status" -ne 0 ] || [ "$vector_status" -ne 0 ] || [ "$behavior_status" -ne 0 ]; then
  exit 1
fi
