/** Stable assertion diagnostics consumed by the offline canonical FD fixture loader (K249). */
export const IpcBenchPreparationText = Object.freeze({
  /** Missing function boundaries prevent loading a partial or unrelated fixture. */
  fdDeclarationMissing: 'Canonical FD fixture declaration missing',
  /** Every runtime import referenced by the erased body must match its maintained preamble. */
  fdImportsDrifted: 'Canonical FD fixture imports drifted from benchmark preamble'
})

/** Private cold messages transfer the separate observation port before runtime endpoint startup. */
export const IpcBenchControl = Object.freeze({
  /** The native launcher transfers this port before its channel factory consumes the actual ACK. */
  observation: 'ipc-bench-observation',
  /** This marker travels only on the observation port, never through an RPC transport. */
  ready: 'ipc-bench-observation-ready',
  /** Bun snapshot requests run only at cold boundaries outside the measured business window. */
  snapshot: 'bench.snapshot'
})

/** Peer heap evidence is opt-in and remains separate from ordinary timing diagnostics. */
export const IpcBenchObservation = Object.freeze({
  /** Only the ignored I22 soak driver enables explicit peer collection at snapshot boundaries. */
  forcePeerGcEnvironment: 'IPC_BENCH_FORCE_PEER_GC',
  /** Only a confirmed GROWING arm's profile rerun may write peer heap snapshots. */
  heapProfileEnvironment: 'IPC_BENCH_HEAP_PROFILE',
  /** A real completed isolate-local gc call is required before this status is emitted. */
  forcedPeerGc: 'FORCED_PEER_GC',
  /** Missing isolate-local gc prevents a post-GC verdict, even when heap bytes are readable. */
  peerGcUnavailable: 'UNAVAILABLE_PEER_GC',
  /** Ordinary timing runs preserve their existing explicitly uncollected status. */
  uncollected: 'NOT_COLLECTED_FORMAL_TIMING',
  /** The existing OOB observation path carries only these two optional profile boundaries. */
  heapBoundaries: Object.freeze(['start', 'end'])
})

/** P3 diagnostics travel only on the existing observation control and never qualify timing. */
export const IpcBenchDiagnostic = Object.freeze({
  /** The child receives only the selected diagnostic mode, without credential configuration. */
  environment: 'IPC_BENCH_DIAGNOSTIC',
  /** CPU samples and exact guards run separately because they change execution differently. */
  cpu: 'cpu',
  guard: 'guard',
  /** Allocation sampling uses the same warmed OOB boundaries without the exact heap tracker. */
  sampling: 'sampling',
  /** Native Node CPU profiling must start in each business isolate, never only in the driver. */
  cpuFlag: '--cpu-prof',
  /** Each diagnostic output directory receives Node's native PID/thread-specific filenames. */
  cpuDirectoryPrefix: '--cpu-prof-dir=',
  /** CPU-profile argument recognition preserves an explicitly selected native sampling interval. */
  cpuIntervalPrefix: '--cpu-prof-interval=',
  /** Boundaries enclose warmed business samples and the explicitly included control work. */
  start: 'start',
  stop: 'stop',
  /** These receipts cannot be used as the uninstrumented P3 latency qualification lane. */
  timingStatus: 'INSTRUMENTED_DIAGNOSTIC_NOT_QUALIFICATION',
  /** Missing or failed capture is never represented by a numeric zero. */
  started: 'STARTED',
  captured: 'CAPTURED',
  failed: 'FAILED',
  /** Ownership classifies recorded source URLs; empty engine frames remain unknown. */
  rpc: 'rpc',
  dependency: 'dependency',
  fixture: 'fixture',
  runtime: 'runtime',
  unknown: 'unknown',
  /** Native init events count all Promise creations in this isolate's enabled interval. */
  promiseStatus: 'EXACT_V8_PROMISE_INIT',
  promiseScope:
    'whole isolate hook interval including fixture and observation work; no per-request causal ownership claim',
  /** V8 disables inline allocation for this non-sampling tracker; external/native bytes are absent. */
  allocationStatus: 'EXACT_TRACKED_V8_HEAP_EVENTS',
  allocationScope:
    'V8 allocation tracker events with inline allocation disabled, including diagnostic/control work; excludes external/native allocation and uninstrumented execution',
  /** Source buckets use each allocation trace node's direct frame, retaining every ancestor. */
  ownershipScope:
    'direct recorded allocation frame; full trace tree retains ancestry for recomputation',
  /** Inspector protocol names have one fixture owner rather than scattered string contracts. */
  profilerEnable: 'Profiler.enable',
  profilerStart: 'Profiler.start',
  profilerStop: 'Profiler.stop',
  preciseStart: 'Profiler.startPreciseCoverage',
  preciseTake: 'Profiler.takePreciseCoverage',
  preciseStop: 'Profiler.stopPreciseCoverage',
  heapEnable: 'HeapProfiler.enable',
  heapStart: 'HeapProfiler.startTrackingHeapObjects',
  heapStop: 'HeapProfiler.stopTrackingHeapObjects',
  heapChunk: 'HeapProfiler.addHeapSnapshotChunk',
  /** V8's sampling API records allocation owners without disabling inline allocation. */
  heapSamplingStart: 'HeapProfiler.startSampling',
  /** Stop returns the sampled call tree and node-linked samples through the existing OOB receipt. */
  heapSamplingStop: 'HeapProfiler.stopSampling',
  /** A fixed byte interval keeps before/after allocation samples comparable across all six cells. */
  samplingInterval: 32768,
  /** Sampled counts and sizes are estimates, distinct from the existing exact-tracker status. */
  samplingStatus: 'SAMPLED_V8_ALLOCATIONS',
  /** Collected objects remain sampled; OOB controls are included and native allocations are absent. */
  samplingScope:
    'V8 allocation samples including collected objects and OOB control work; excludes external/native allocation; not exact event counts'
})

/** Frozen reference ownership is retained in every W3 result so primitive history stays distinct. */
export const IpcW3Reference = Object.freeze({
  /** Explicit final-source collection still reports the unchanged old primitive guard separately. */
  historical: 'historical-primitive',
  /** Ordinary final W3 uses the repaired public Peer baseline and its own current-window A/A. */
  public: 'public-peer'
})

/** Fixed supplemental graphs declare their actual carriers and methods without changing DA1 cells. */
export const RuntimeBench = Object.freeze({
  /** Worker itself issues and times reverse calls through the independently accepted parent route. */
  reverse: 'reverse',
  /** All supplemental and original native providers keep the same scalar echo method. */
  echo: 'bench.echo',
  /** Diagnostic probes distinguish reverse execution from the parent's trigger request. */
  reverseProbe: 'bench.reverseProbe',
  /** One trigger starts a full original 100/1000 measurement inside the real Worker isolate. */
  measure: 'bench.measure',
  /** Host-owned native Worker uses the same physical message carrier as the original Worker cell. */
  managed: 'managed',
  /** Relay is a process with an independently owned Worker leaf, preserving strict source selection. */
  oneHop: 'one-hop',
  /** Actual mixed topology has one byte hop and one native message hop. */
  mixedCarrier: 'stdio-framed+worker',
  /** The public compiled route addresses the relay's real leaf connection. */
  forwardedEcho: 'leaf.bench.echo',
  /** Private fixture readiness waits for the real relay Host transaction. */
  ready: 'bench.ready',
  /** Snapshots remain diagnostic operations outside the measured business window. */
  snapshot: 'bench.snapshot',
  /** Explicit leaf withdrawal uses the relay's actual Host before its process is terminated. */
  releaseLeaf: 'bench.releaseLeaf',
  /** Caller-created fixture token is bootstrap input and is always redacted from retained stderr. */
  token: 'runtime-bench-token'
})

/** Fixed directed-fixture labels are local protocol data, never resource authority. */
export const CrossRuntimeBench = Object.freeze({
  /** The original directed fixture bootstrap token remains outside public configuration. */
  token: 'xrt-local',
  /** Native TS readiness is consumed before warmup. */
  ready: 'XRT_READY\n',
  /** The controlled foreign loop exists only on its Content-Length fixture profile. */
  reverse: 'peer.reverse',
  /** Existing independent foreign business handlers keep their published fixture method. */
  request: 'p.f.request',
  /** Full raw timing/counter receipts retain the frozen directed inventory seed. */
  seed: 'xrt-20261009-v1'
})
