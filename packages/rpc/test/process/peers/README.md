# Native process peers

These peers are test fixtures, not SDKs. Python, Rust, and Go are native
counterparts. `ts-reference` is an independent TypeScript reference oracle
for cross-checking vectors and interop. It does not count toward conformance
R1/A1 or satisfy CF1/S2. M2 will add a separate `peers/ts` that consumes
the package's public exports. Every peer here uses its language's standard
library for framing and JSON; none installs dependencies or writes build
products into the repository.

## Start a peer

From the repository root:

```sh
python3 packages/rpc/test/process/peers/python/peer.py --stdio --role responder
packages/rpc/test/process/peers/rust/run.sh --stdio --role responder
packages/rpc/test/process/peers/go/run.sh --stdio --role responder
packages/rpc/test/process/peers/ts-reference/run.sh --stdio --role responder
```

Use `--role initiator` with the same commands for pairwise tests. The peer
writes protocol bytes only to stdout and reads them only from stdin. Both are
binary byte streams. Each message is an unsigned 4-byte big-endian payload
length followed by UTF-8 JSON. Length 0 and lengths greater than 16 MiB are
rejected before payload allocation. `READY pid=<pid>` and a successful
initiator's `RESULT ok` go to stderr; no input, token, or frame is logged.
One command is one PID and has no peer-owned child process after startup.

For a rendezvous connection, start a responder with `--listen-unix PATH`
instead of `--stdio`; choose a fresh socket path in the system temporary
directory. Python, Rust, and Go initiators also accept `--connect-unix PATH`.
The future I14 channel test can spawn one responder, wait for the stderr
`READY pid=` marker, then attach its binary stdio pipes or connect to its
Unix socket. I20 conformance should use that same marker and PID to attribute
CPU and RSS. The executable protocol uses fd 0 for input, fd 1 for output,
and fd 2 for fixed status/error markers. An inherited secret fd, if required
by a future channel test, must be passed separately; never place the token in
argv or environment. These fixtures do not replace I14 authentication.

Rust compiles offline to `${TMPDIR:-/tmp}/migaia-rpc-peer-rust-target`. Go's
wrapper compiles to a system temporary directory. TypeScript's `run.sh` uses
Node 24's built-in type stripping and emits no JavaScript file. Its selftest
compiles to a fresh temporary directory using the already installed `tsc`
and Node type definitions. Set `RPC_PEERS_TSC` and `RPC_PEERS_TYPES` if those
are installed outside this worktree. No wrapper installs a package.

## Checks

```sh
python3 packages/rpc/test/process/peers/python/selftest.py packages/rpc/schema/vectors
packages/rpc/test/process/peers/rust/selftest.sh
packages/rpc/test/process/peers/go/selftest.sh
packages/rpc/test/process/peers/ts-reference/selftest.sh
python3 packages/rpc/test/process/peers/interop.py
```

Each language's selftest prints case counts. A missing upstream vector is
reported as pending/failure and yields a nonzero exit status. At the branch
base, `remote-host-control.json` and `stream-framing.json` are absent. The
frozen 1.0 files remain untouched; `stream.json` carries the 1.1
reclassification. `interop.py` starts every ordered pair over bridged stdio
and requires a real handshake, request/echo, and close with both peers exiting
successfully. Channel and conformance can invoke these commands directly;
no package script is required.
