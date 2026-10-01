# IPC conformance measurement preparation

`ipc.mjs` owns the bare measurement window and nearest-rank summary. It accepts a
ready echo port and a prestarted PID observer. CPU uses endpoint PID user+system
counter differences. RSS uses each endpoint's absolute sampled window peak,
then sums those peaks. A shared thread PID counts once. No startup baseline is
subtracted. A missing sample fails the side, and no ratio assertion is emitted
before complete paired measurements.

`bare-node.mjs` starts an isolated Node parent with a separate raw stdio echo
peer using the same Node executable. The echo port accepts caller-provided
codec-produced bytes, so a paired driver can use exactly the same encoded
payload. The CLI currently prepares one JSON/stdio-framed unit at concurrency
one; it does not freeze or exclude other supported units.

```bash
# Preparation only: three real echoes and two native resource snapshots.
node bench/bare-node.mjs --check

# Bare side only; reserve for the root owner's exclusive performance run.
node bench/bare-node.mjs --bytes 1024
```

The CLI starts Python's standard-library ctypes observer before warmup. On
macOS it calls `proc_pid_rusage` with `RUSAGE_INFO_V0` directly for each endpoint
PID. CPU uses `ri_user_time + ri_system_time`; RSS uses `ri_resident_size`.
The observer's own PID is excluded. Reads never create `ps` or another sampler
process. The default interval is 10 ms. The SDK layout is verified against
`sys/resource.h` and `libproc.h`; no external Python dependency is installed.

Each actual side requires 1000 settled echoes after 100 warmup echoes. The
result retains raw latencies, per-PID CPU deltas and absolute RSS peaks, method,
interval, PID, runtime, carrier, codec, payload and concurrency. Launch,
observation and echo failures remain failures. This preparation does not supply
RPC measurements, alternating paired rounds, ratio medians, a frozen supported
matrix, or a completed `bench:ipc` gate. Those remain with the integration owner.
All four thresholds remain p99 <=3, throughput >=0.5, CPU <=3 and RSS <=2.
