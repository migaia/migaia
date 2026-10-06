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

RPC business runs through the shipped `createProcessPeer` or `createThreadPeer`
and their `request` method, including foreign bridge cells. Native Node Workers
use the original owned launcher and binding; Bun uses its actual Web Worker
adapter and keeps actual-exit capabilities unsupported. Chromium uses the same
public Thread Peer on both sides. Preparation tests verify real accepted Peer
provenance after completing ordinary echoes; an endpoint-shaped fixture cannot
satisfy that check. Bare carriers and echo work remain independent of RPC.

```bash
# Frozen inventory without launching measurements.
pnpm --filter @migaia/rpc run bench:ipc --list

# Capability preparation: three echoes on each side, without budget acceptance.
pnpm --filter @migaia/rpc run bench:ipc --prepare --unit node:stdio-framed:64

# Three alternating pairs: 100 warmup and 1000 settled echoes on every side.
pnpm --filter @migaia/rpc run bench:ipc --scenario sequential --unit node:stdio-framed:64 --noise /absolute/window-noise.json --output /absolute/raw-directory
pnpm --filter @migaia/rpc run bench:ipc --scenario concurrency --unit node:stdio-framed:64:c16 --noise /absolute/window-noise.json --output /absolute/raw-directory
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
cannot hide a failing endpoint. U33 keeps the six concurrency 16/64
`throughputFloor` values as tracking targets only. Missing a target reports
`未达跟踪目标`; it does not replace a separate frozen regression verdict.
Historical `IpcBenchThreshold` and
`judgePairs` remain available for historical oracle checks; their aggregate
budgets are not DA1.

Formal runs also report `regression`: the median of three paired RPC/bare p50
ratios compared with `w3-baseline.json`. Its 68 historical values come from the
original W3 raw data; the eight later DA1 cells use supplementary measurements
of the same W3 production commit with the common measurement fixture. The
unchanged DA1 budgets and this relative guard must both pass. `--noise` supplies
the current exclusive window's W3/W3 A/A calibration: three baseline pairs for
each of four representatives, with both RPC and bare observations retained.
Its `p50RatioNoiseBand` is the largest observed absolute change of the normalized
ratio. A missing calibration is an error, never a no-regression verdict.

Chromium uses the canonical browser launcher, automatic child bootstrap and
the public Peer's bilateral capability and v2 directory agreement.
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

Node and bare Worker snapshots use the original separate observation port.
Bun RPC Worker isolate snapshots use the private fixture method `bench.snapshot`
at boundaries outside formal timing; that diagnostic route is included in its
real directory. These reads perform RPC allocation and are not described as
equivalent to the bare out-of-band snapshot cost. Formal echo samples contain
no snapshot calls, counters, debugger or profile overlay.

Deno supplementary cells are listed separately in `deno-units.json`; the original
76-cell inventory and `db5441cc` values stay unchanged. Both stdio sides use the
actual Deno Command/std-stream adapter. The Worker cell uses a native Deno Web
Worker and the public Thread Peer. Its cold entry installs loaded-byte hooks,
loads the SDK, and attaches the original automatic bootstrap capture before the
canonical launcher adopts the prestarted native object. Startup is outside
warmup and timing. Bare Worker keeps one JSON parse/stringify echo and a separate
snapshot port. RPC Worker snapshots use the same private boundary method as Bun.

Deno's compatibility `threadId` and ELU zeroes are explicitly unavailable;
receipts use `null` plus the actual parent/peer/Worker isolate role. Native
thread CPU, process memory, PID deduplication and loader-supplied source hashes
remain separately recorded. Unsupported Worker final-exit semantics are not
promoted to an actual-exit receipt. These new cells remain unfrozen until the
final-source A/A and SDK baseline receipts are installed.

The six sustained >=400-second cells run separately with the replay fixture's
full records and classifications. A native send/receive change requires fresh
records from that code version. B0 is historical wall-budget tracking only.
Summed isolated gains cannot replace an actual complete-stack reference pair.

Supplemental runtime paths use `runtime-units.json` and the original side,
100/1000 sampling loop and native PID observer:

```bash
node bench/runtime.mjs --prepare --output /absolute/fresh-preparation
node bench/runtime.mjs --freeze-sdk --output /absolute/fresh-runtime-candidates
```

The managed cell calls the actual committed `host.thread` outlet. One-hop cells
use a process relay with its real Host, an owned Worker leaf, and the compiled
`leaf.bench.echo` expose route at concurrency 1/16. Their physical carrier is
stdio plus Worker messaging; they are not labelled as a two-Worker path. Strict
automatic-parent versus explicit same-family source conflicts remain enforced.
The relay's real leaf registration is withdrawn before its process is stopped.

The reverse cell runs warmup and all 1000 timed requests inside the actual
Worker. The parent's single trigger and raw-result transfer are outside that
loop. Shared PID CPU is charged once; both isolate snapshots retain real
thread IDs and loaded bytes. No parent round-trip clock stands in for the
initiator's measurement.

These cells retain RPC-only observations with status `unfrozen` until C7 freezes
the final I28 source and installs their relative guards. No old bare denominator
or historical W3 value is invented for a new topology. Relay own-thread CPU
between boundary snapshots includes diagnostic RPC work; three empty snapshot
pairs are retained separately. It is not reported as exact business-only CPU.

Final SDK guards use a separate `w3-sdk-baseline.json`. Its six U33 concurrency
cells compare paired RPC/bare throughput; Deno compares paired p50/p95/p99 and
throughput. Runtime supplemental cells use RPC-only values, with no fabricated
bare denominator. Every frozen metric requires its own current-window A/A band
in the noise receipt's `sdkCells`. Higher latency and lower throughput are
regressions; any metric beyond its own noise keeps the verdict FAIL. Original
pre-program p50 and absolute DA1 verdicts remain separate and unchanged.

Candidate collection uses `--freeze-sdk` explicitly. It records
`unfrozen-candidate` for new paired cells and never claims a frozen relative
PASS. Numeric/source/raw-SHA freezing happens after final-source qualification.
Normal concurrency, Deno and runtime runs fail closed if the baseline or
current-window SDK noise is missing. The same noise file also retains the
original four representative W3 A/A controls.

```bash
node bench/ipc.mjs --scenario deno --prepare --output /absolute/fresh-deno-preparation
node bench/ipc.mjs --scenario concurrency --freeze-sdk --noise /absolute/current-noise.json --output /absolute/fresh-concurrency-candidates
node bench/ipc.mjs --scenario deno --freeze-sdk --noise /absolute/current-noise.json --output /absolute/fresh-deno-candidates
node bench/runtime.mjs --noise /absolute/current-noise.json --output /absolute/fresh-runtime-guard
```
