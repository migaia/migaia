# IPC conformance and DA1 measurements

`support-units.json` freezes 68 native sequential cells, two Chromium cells, and
six concurrency cells. Capability preparation and formal timing are separate.
`ipc.mjs` owns the bare window, nearest-rank summaries and paired judgments.
It accepts a ready echo port and a prestarted PID observer. CPU uses endpoint
PID user+system counter differences; RSS uses each PID's absolute sampled peak.
A shared Worker PID is charged once. Startup RSS is not subtracted.

Native bare peers parse and serialize the payload once, as required by the
2026-10-02 A10 baseline. Foreign peers do the same work in Content-Length mode.
Rust uses release `opt-level = 3`, Go its optimized build, and public TS peers
execute emitted JavaScript. Build time is outside formal timing.

```bash
# Frozen inventory without launching measurements.
pnpm --filter @migaia/rpc run bench:ipc --list

# Capability preparation: three echoes on each side, without budget acceptance.
pnpm --filter @migaia/rpc run bench:ipc --prepare --unit node:stdio-framed:64

# Three alternating pairs: 100 warmup and 1000 settled echoes on every side.
pnpm --filter @migaia/rpc run bench:ipc --scenario sequential --unit node:stdio-framed:64 --output /absolute/raw-directory
pnpm --filter @migaia/rpc run bench:ipc --scenario concurrency --unit node:stdio-framed:64:c16 --output /absolute/raw-directory
```

The macOS observer starts before warmup and uses Python's standard-library
ctypes with `proc_pid_rusage`/`RUSAGE_INFO_V0`. CPU is `ri_user_time + ri_system_time`;
RSS is `ri_resident_size`. Its own PID is excluded. Reads never launch `ps` or
another sampler process. The interval is 10 ms. No Python dependency is installed.

Raw receipts retain all latencies, p50/p95/p99, per-PID CPU and RSS, observer
method/interval, runtime, carrier, codec, payload and concurrency. Preparation,
observation and echo failures remain measurement errors; partial rounds and
full side classifications are retained. Budget failures retain all three rounds.
`--output` saves per-side receipts, stderr, peer snapshots and the complete
paired result. Without it, the command creates and reports a temporary raw
directory. `--help` is not supported. Heavy runs require the owner's exclusive
window; this benchmark does not grant a measurement lease.

DA1 uses medians of all three RPC/bare ratios. Small cells (64 B and 1 KiB)
require wall <=4, p99 <=5 and CPU <=5 for every independent PID role. Large
cells (64 KiB and 1 MiB) require p99 <=3, throughput >=0.5, CPU <=3 and absolute
RSS <=2 for every independent PID role. Aggregate CPU/RSS are descriptive and
cannot hide a failing endpoint. Concurrency 16/64 uses the exact six
`throughputFloor` values in the inventory. Historical `IpcBenchThreshold` and
`judgePairs` remain available for historical oracle checks; their aggregate
budgets are not DA1.

Chromium uses the canonical browser Worker adapter and static batch agreement.
Bare uses a separate pure postMessage echo graph. All 1000 round trips are timed
inside one page evaluation; Node driver CPU and control round trips are excluded.
A separate pre-window trace maps actual page/Worker PID and thread IDs. CPU
includes the browser host and each distinct renderer/Worker PID; GPU/utility
counters are retained separately. Both isolate heaps and actual executed bundle
SHA are captured outside timing. Debugger and tracing are disabled before
warmup. Browser clock resolution can produce zero latency samples: preserve
them unchanged in nearest-rank calculations. A nonpositive ratio denominator
remains an error. Host thread CPU is explicitly unavailable. Formal GC is not
collected and cannot explain formal p99 differences.

Native and Chromium sampling explicitly use replay capacity 1200 to fit ready,
warmup and samples. This does not change the product default of 1024 or prove
default-capacity sustained operation. Native receipts distinguish actual loaded
SHA from disk SHA; formal timing has no counter overlay. Diagnostics remain
separate. Foreign peers retain optimized executable and source identities;
their JavaScript heap/thread fields are explicitly unavailable.

The six sustained >=400-second cells reuse the replay implementation's original
full records and classifications. They are not another benchmark run. B0 is
historical wall-budget tracking only. Summed isolated gains cannot replace an
actual complete-stack reference pair.
