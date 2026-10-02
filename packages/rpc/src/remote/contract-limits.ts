/**
 * Remote description admission bounds anchor existing wire/admission limits: 64
 * capabilities/connections, 128 per-peer admissions, 4096 replay entries, and the 256-character
 * trace limit. The schema mirrors the structural bounds.
 */
export const RemoteCatalogLimit = {
  /** Maximum declared plugins in one Host description. */
  pluginsPerCatalog: 64,
  /** Maximum features in one plugin contract. */
  featuresPerContract: 64,
  /** Maximum methods in one feature table. */
  methodsPerFeature: 128,
  /** Aggregate method budget across all contracts in a Host catalog. */
  methodsPerCatalog: 4096,
  /** Diagnostic paths cannot exceed the existing trace-character budget. */
  detailPathChars: 256
} as const
