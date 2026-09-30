#!/bin/sh
# Build with the local Go toolchain in system temp, then replace this shell with the peer.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temp_root=${TMPDIR:-/tmp}
build_dir=$(mktemp -d "$temp_root/migai-rpc-peer-go.XXXXXX")
cache_dir="$temp_root/migai-rpc-peer-go-cache"
mkdir -p "$cache_dir"
GOTOOLCHAIN=local GO111MODULE=off GOCACHE="$cache_dir" GOTMPDIR="$build_dir" go build -o "$build_dir/peer-go" "$script_dir"/*.go
exec "$build_dir/peer-go" "$@"
