# Process peer fixtures

Python, Rust, Go and `ts-reference` are independent native protocol fixtures.
Their U36 baseline requires protocol 1.1, `runtime-api@1` and `batch@1`.
`ts-reference` remains a handwritten oracle and is distinct from the public TS fixture. `ts` consumes only published `@migaia/rpc`
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

The initiator paths exchange a real v2 directory, send echo in a native batch,
then close. Rust and Go compile offline into worktree-specific temporary
directories. The TS reference selftest cache is also scoped to its worktree.
All four fixtures return the closed directory
`{schemaVersion:2,self:{name,instanceId},methods:[{name,supportedModes,modeSource}]}`
from `migaia.remote.runtime.describe`; methods declare only installed modes.
The v1 describe and RPC bridge paths are removed. Non-bare `--jsonrpc` is
unsupported; the existing bare physical carrier is separate from RPC.

A native batch is `{kind:'batch',envelopes:[...]}`. Members enter in array order;
a malformed member or provider failure does not discard valid siblings.
Ordinary single envelopes remain part of the new protocol for handshake,
control and single calls. There is no capability/version downgrade path.
Python, Rust and Go `--business` provide their installed business routes;
stream methods use `migaia.remote.runtime.stream.<logical-name>` only after
actual stream agreement. The TS reference implements discovery and addressed
responses so a standard production Runtime Peer request can settle.

Only Python registers `peer.reverse`, a request provider accepting
`{method,payload}`. It fetches the authenticated caller's v2 directory, admits
only its request providers, and correlates responses on the same reader while
regular requests continue. At most two long-lived provider operations are
admitted; abort and close retire pending work. The other fixtures reject this
method. None declares order/group/generation/binary capabilities.

## Focused checks

Run these within the program's exclusive measurement window (start/end load
at most 5, at most 45 minutes, release only the owned lock).

```sh
python3 -B packages/rpc/test/process/peers/python/runtime_baseline_test.py
python3 -B packages/rpc/test/process/peers/python/peer.py --selftest
python3 -B packages/rpc/test/process/peers/python/reverse-check.py
packages/rpc/test/process/peers/rust/selftest.sh
packages/rpc/test/process/peers/go/selftest.sh
packages/rpc/test/process/peers/ts-reference/selftest.sh
python3 -B packages/rpc/test/process/peers/baseline_check.py
python3 -B packages/rpc/test/process/peers/interop.py
pnpm -r --filter @migaia/rpc... build
pnpm --filter @migaia/rpc exec vitest run test/process/peers/runtime-interop.test.ts --coverage.enabled=false --maxWorkers=1
```

Language selftests exercise their own unit/vector rules and the real-process
control cases. They no longer consume frozen 1.0 or v1 remote-contract/Host
schema vectors. Current framing/control/error vectors remain in use pending
I28's final baseline vectors; missing required files fail explicitly. The
12 ordered pairs prove v2 negotiation and batch echo between independent
fixtures. The production TS test uses the canonical Runtime Peer request path
without receiver overrides, covering all four fixtures and an actual Python
reverse call into a TS provider. Its remote directory assertion reads the
accepted connection receipt; `Peer.describe()` describes the local peer.

## A10 bare baseline

The 2026-10-02 baseline includes one JSON parse and one JSON serialization of
the business payload before each bare reply. Python, Rust and Go perform that
work in `--bare-jsonrpc`; Node/Bun perform it in the native bare benchmark
peer, including the Worker carrier. Bare peers still omit RPC envelopes,
discovery, handshake, routing and business dispatch. The paired valid JSON
payload and physical carrier stay identical. The focused
`conformance-peer-baseline.test.ts` uses whitespace-bearing JSON to prove
that a raw byte echo cannot satisfy this definition.
