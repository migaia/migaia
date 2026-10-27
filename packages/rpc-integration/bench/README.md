# Native IPC checks and paired measurements

`ipc.mjs` retains paired bare/RPC latency, throughput, native CPU and RSS calculations.
Node and Bun use `stdio-framed` and `socket-framed`; Node Worker cells use native messages.
`support-units.json` contains only these current native cells.
RPC sides install `createRpcHost` with the public Process or Thread plugin. The plugins own native
bootstrap, `migaia.rpc/2` negotiation, Session admission, requests and resource cleanup. Bare sides
use the same runtime and physical carrier with one JSON parse and serialization per echo.

Run from `packages/rpc-integration`:

```bash
node bench/ipc.mjs --check --unit node:stdio-framed:64 --output /absolute/fresh-check-directory
node test/bench/dx-roadmap.mjs --check
node bench/ipc-side.mjs --check '{"unit":{"runtime":"node","carrier":"socket-framed","payloadBytes":64,"concurrency":1},"side":"rpc"}'
```

Checks perform three exact echoes on each selected side and sample real native endpoint PIDs.
They produce preparation receipts without warmup, a timing window or an acceptance ratio.
`conformance-bench.test.ts` exercises every Node/Bun framed payload size and the Node Worker cells.
`conformance-bench-native.test.ts` verifies concurrent exchanges through the same public namespace.
RPC socket fixtures use one fresh private temporary directory. A 0600 file supplies the token to the child; it never enters argv, environment or receipts. Parent cleanup joins child exit before removing only that directory, including its socket and ownership record.

The native process snapshot channel uses the existing signal/file path. RPC Worker snapshots use
a public diagnostic method outside the measured loop; bare Worker snapshots use a separate port.

Measurements require the repository exclusive window and explicit authorization. They retain
three alternating paired rounds and the existing independent PID accounting. Historic native
ratios in `frozen-baseline.json` are historical data, not current protocol evidence; current timing
needs a fresh baseline and noise calibration. No performance measurement was taken for this migration.

The retired browser Worker measurement cells, JSON-RPC Content-Length cells, their foreign bridge launch helpers, the old runtime
Peer topology drivers, and source-overlay cross-runtime tools have been removed. Their old
receipts are not current acceptance evidence. Order-statistic helpers remain because the native
pairing oracle uses them.
