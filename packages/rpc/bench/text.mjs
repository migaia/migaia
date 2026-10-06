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
