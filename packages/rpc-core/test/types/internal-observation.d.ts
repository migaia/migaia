import '../../dist/core/internal/test-observer.js'

/** Restore existing private observer types stripped from shipped declarations; no runtime seam. */
declare module '../../dist/core/internal/test-observer.js' {
  /** Observe the original built owner's exact identity while retaining its disposer. */
  export function registerInboundIdentityReleaseObservation(identity: object): () => void
  /** Read that existing private observation, without substituting a second Source owner. */
  export function readInboundIdentityReleaseObservation(identity: unknown): number | undefined
}
