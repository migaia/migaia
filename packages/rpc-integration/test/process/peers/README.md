# Process peer fixtures

Python, Rust, Go and `ts-reference` are independent handwritten peers for the
current `migaia.rpc/2` native profile. Every accepted connection carries a
schema3 directory with `self: {name, instanceId, generation}` and installed
`methods: [{name, supportedModes, modeSource}]`. The protocol entry points are
`@migaia/rpc-contract/protocol`, `@migaia/rpc-contract/interfaces` and
`@migaia/rpc-host/sdk`. The public TypeScript fixture uses `@migaia/rpc-host`
and `@migaia/rpc-plugin-process` directly. Fixtures are test peers, not language
SDKs; their directories install no dependencies.

## Public TypeScript peer

Build changed packages and their required dependency closure before running
compiled-package tests. Use an exclusive window for builds and test suites.
The supervisor supplies an installed Bun or Node runtime.

```bash
packages/rpc-integration/test/process/peers/ts/run.sh --stdio --bootstrap stdin
RPC_PEERS_RUNTIME=node packages/rpc-integration/test/process/peers/ts/run.sh --stdio --bootstrap stdin
packages/rpc-integration/test/process/peers/ts/run.sh --listen-unix /tmp/peer.sock --auth-fd 3 --host
```

`--bootstrap stdin` consumes the native bootstrap supplied by
`createNodeProcessLauncher`. Socket listeners read credentials through an
inherited descriptor. Credentials never enter argv, environment, status markers
or evidence. `--host` installs the fixture's Host providers. Node compiles the
entry into a worktree-specific temporary directory; Bun and Node run that same
entry with inherited descriptors. `ts/run.sh --executable` prints its compiled
entry path. `RPC_PEERS_BUN` and `RPC_PEERS_NODE` select installed executables.

The focused public fixture checks requests, notifications, streams, flat errors,
cancellation, ping and lifecycle cleanup over stdio and Unix sockets. Expected
business results live in `ts/public-behavior.json`.

## Independent native peers

```bash
python3 -B packages/rpc-integration/test/process/peers/python/peer.py --stdio --role responder
packages/rpc-integration/test/process/peers/rust/run.sh --stdio --role responder
packages/rpc-integration/test/process/peers/go/run.sh --stdio --role responder
packages/rpc-integration/test/process/peers/ts-reference/run.sh --stdio --role responder
```

The native wire uses a four-byte big-endian length followed by JSON. Both sides
send hello; the selected accept includes the schema3 directory. Known fields
are validated, unknown metadata is ignored for the active variant, and the
profile is never downgraded. Flat error graphs preserve source, code, native
name, message, stack, cause indexes and at most 17 route nodes. Final teardown
sends one `close` control after earlier replies; receiving `close` never echoes
it. `drain` stops new work while existing work can complete or cancel.

`--business` enables the installed business methods for Python, Rust and Go.
Their `--non-idempotent-request` option fixes the `p.f.request` declaration
before handshake. Python additionally supplies `peer.reverse`; the other peers
do not advertise it. The TS reference independently supplies echo, receipt,
trace, wait, error and finish methods. It borrows stdio directly and does not
implement the process plugin's native bootstrap. The current SDK can attach
its byte carrier directly to this reference peer.

Rust pending requests use `BTreeMap`: one logarithmic insertion or cancellation
and one linear lexical drain. Go keeps an AVL index alongside its request map:
one logarithmic insertion or cancellation, then one linear traversal.
`peer.finish` preserves lexical request-ID order without sorting a growing
collection.

`--bare-jsonrpc` selects a separate pure-JSON fixture baseline, without native
RPC handshake or dispatch. It parses and serializes each JSON payload and uses
Content-Length framing. This command is retained only for its existing baseline
checks; it is not another native protocol profile.

## Focused checks

Run suite commands inside the repository's existing exclusive window. No
benchmark or timing measurement is needed for these protocol checks.

```bash
packages/rpc-integration/test/process/peers/rust/selftest.sh
packages/rpc-integration/test/process/peers/go/selftest.sh
packages/rpc-integration/test/process/peers/ts-reference/selftest.sh
python3 -B packages/rpc-integration/test/process/peers/python/peer.py --selftest
python3 -B packages/rpc-integration/test/process/peers/baseline_check.py
python3 -B packages/rpc-integration/test/process/peers/interop.py
pnpm --filter @migaia/rpc-integration exec vitest run test/process/peers/runtime-interop.test.ts --coverage.enabled=false --maxWorkers=1
```

Selftests load current vectors from
`packages/rpc-integration/schema/vectors/`. The same peer parser admits both
vectors and live frames. `behavior_check.py` checks real process responses and
terminal controls. `ts-reference/notification-check.py` and `routing-check.py`
retain their original request/receipt assertions and include the final close.
`runtime-interop.test.ts` exercises genuine SDK requests and accepted directories.
Missing vectors or failed assertions remain failures in their own receipts.
