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
