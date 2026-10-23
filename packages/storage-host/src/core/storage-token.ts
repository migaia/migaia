/** Monotonic suffix prevents token collisions when host entropy sources repeat. */
let storageTokenSequence = 0

/**
 * Creates the package-private opaque token used for generated record keys, IndexedDB generations,
 * and backend origins. The entropy and suffix format are intentionally stable across backends;
 * callers must treat the result as an opaque same-realm uniqueness token.
 */
export const createStorageToken = (): string => {
  /** Borrow native UUID entropy where present and preserve the original opaque fallback format. */
  const tokenHost = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  const entropy =
    typeof tokenHost.crypto?.randomUUID === 'function'
      ? tokenHost.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  storageTokenSequence += 1
  return `${entropy}-${storageTokenSequence.toString(36)}`
}
