/** Stable assertion diagnostics consumed by the offline canonical FD fixture loader (K249). */
export const IpcBenchPreparationText = Object.freeze({
  /** Missing function boundaries prevent loading a partial or unrelated fixture. */
  fdDeclarationMissing: 'Canonical FD fixture declaration missing',
  /** Every runtime import referenced by the erased body must match its maintained preamble. */
  fdImportsDrifted: 'Canonical FD fixture imports drifted from benchmark preamble'
})
