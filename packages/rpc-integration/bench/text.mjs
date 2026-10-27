/** Peer heap evidence is opt-in and remains separate from ordinary timing diagnostics. */
export const IpcBenchObservation = Object.freeze({
  /** Only the ignored soak driver enables explicit peer collection at snapshot boundaries. */
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

/** Diagnostics travel only on the existing observation control and never qualify timing. */
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
  /** These receipts cannot be used as the uninstrumented latency qualification lane. */
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

/**
 * Frozen reference ownership is retained in every baseline result so primitive history stays
 * distinct.
 */
export const IpcW3Reference = Object.freeze({
  /** Explicit final-source collection still reports the unchanged old primitive guard separately. */
  historical: 'historical-primitive',
  /**
   * The ordinary final baseline uses the repaired public Peer baseline and its own current-window
   * A/A.
   */
  public: 'public-peer'
})

/** Native benchmark methods are provided by the current public Host fixtures. */
export const RuntimeBench = Object.freeze({
  /** Every RPC side proves a complete scalar request and response on the current native protocol. */
  echo: 'bench.echo',
  /** Peer isolate evidence is sampled outside the measured business window. */
  snapshot: 'bench.snapshot'
})
