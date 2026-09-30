#!/bin/sh
# Check all local vectors; missing upstream vector assets stay PENDING with exit code 1.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vectors_dir=${1:-"$script_dir/../../../../schema/vectors"}
exec "$script_dir/run.sh" --selftest --vectors "$vectors_dir"
