# Process peer fixtures

Python, Rust and Go are independent native protocol fixtures. `ts-reference`
remains an independent oracle, unchanged by the public peer delivery; it does
not count toward CF1/S2 or A1. `ts` consumes only published `@migaia/rpc`
package exports and executes production process, core and remote modules.
These fixtures are not language SDKs and install no dependencies.

## Public TypeScript peer

Build the RPC dependency closure using the workspace package manager first.
The supervisor supplies already installed Bun or Node; no `package.json` is
added to the peer directory.

```sh
packages/rpc/test/process/peers/ts/run.sh --stdio --bootstrap stdin
RPC_PEERS_RUNTIME=node packages/rpc/test/process/peers/ts/run.sh --stdio --bootstrap stdin
packages/rpc/test/process/peers/ts/run.sh --listen-unix /tmp/peer.sock --auth-fd 3 --host
```

`--bootstrap stdin` consumes the production native bootstrap supplied by
`createNodeProcessLauncher`; it is not an interactive JSON command. Socket
listeners require an inherited readable secret descriptor. Credentials never
enter argv, environment, status markers or saved diagnostics. `--host` serves
real Host catalog/use/unUse/inspect methods; the default serves one installed
Plugin. Node 24 emits type-erased JavaScript into a stable worktree-specific
temporary directory before launching the peer. Both Node and Bun execute that
compiled `peer.mjs`, retaining inherited descriptors. `ts/run.sh --executable`
prints the compiled entry path without starting the peer.
`RPC_PEERS_BUN` and `RPC_PEERS_NODE` select installed executables.

The real native focused test covers stdio/socket × Plugin/Host, request,
independent one-way receipts, generator/asyncGenerator values, error causes,
provider cancellation reason, ping, Host removal and a second socket session.
Its JSON oracle is `ts/public-behavior.json`. Full stdout/stderr and received
socket frames are saved under `RPC_PEERS_EVIDENCE` (default `/tmp/m2-e-evidence`).
The executable peer implements no manual RPC envelopes, framing or codecs.
JSON-RPC bridge mode returns explicit `UNSUPPORTED`; bridge consumption and
threads integration await their production owners.

## Independent language fixtures

```sh
python3 packages/rpc/test/process/peers/python/peer.py --stdio --role responder
packages/rpc/test/process/peers/rust/run.sh --stdio --role responder
packages/rpc/test/process/peers/go/run.sh --stdio --role responder
packages/rpc/test/process/peers/ts-reference/run.sh --stdio --role responder
```

The original `--role initiator`, `--listen-unix PATH` and `--connect-unix PATH`
paths exchange length-prefixed native hello/echo/close frames. Rust and Go
compile offline into stable worktree-specific system temporary directories.
Rust uses `cargo build --release` with explicit `opt-level = 3`; Go uses the
default optimized `go build`. Python runs unchanged. `ts-reference` uses the
installed Node/TypeScript tools. Their current request shapes lack production
core discovery/receiver identities, Host dispatch, stream execution and bridge
support. The legacy interop matrix therefore does not establish production A1.

## Focused checks

```sh
python3 packages/rpc/test/process/peers/python/selftest.py packages/rpc/schema/vectors
packages/rpc/test/process/peers/rust/selftest.sh
packages/rpc/test/process/peers/go/selftest.sh
packages/rpc/test/process/peers/ts/selftest.sh
python3 packages/rpc/test/process/peers/interop.py
cd packages/rpc
pnpm exec vitest run test/process/peers/ts/native-public.test.ts --coverage.enabled=false
RPC_PEERS_RUNTIME=node pnpm exec vitest run test/process/peers/ts/native-public.test.ts --coverage.enabled=false
```

The available `remote-contract.json`, `remote-host-control.json` and
`stream-framing.json` cases now have individual semantic oracles. Non-JS Host
and contract checks execute selftest-only schema/semantic interpreters, not
live Host dispatch. Frame decoding invokes each language peer's real reader
and compares every byte or the first mapped normative failure. Python and Go
also invoke their real writer; Rust's binary encoding prefix check remains an
independent oracle because its runtime writer accepts JSON values only.
The TS vector checks use public canonical normalizers, error graph functions,
stream owners and frame codecs; control actions execute public endpoints.
Missing vector files fail explicitly. The original 12 ordered interop pairs
prove only their real native hello/echo/close exchange; `ts` is separately
verified through the real public production client above.

## A10 bare baseline

The 2026-10-02 baseline includes one JSON parse and one JSON serialization of
the business payload before each bare reply. Python, Rust and Go perform that
work in `--bare-jsonrpc`; Node/Bun perform it in the native bare benchmark
peer, including the Worker carrier. Bare peers still omit RPC envelopes,
discovery, handshake, routing and business dispatch. The paired valid JSON
payload and physical carrier stay identical. The focused
`conformance-peer-baseline.test.ts` uses whitespace-bearing JSON to prove
that a raw byte echo cannot satisfy this definition.
