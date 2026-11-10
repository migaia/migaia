import type { IWebStorageLike } from '../types/storage.ts'

/**
 * Probes whether a storage object is usable by writing and deleting a value. Safari private mode
 * can expose `localStorage` or `sessionStorage` while `setItem` throws. Older versions use
 * `SecurityError`; newer versions can use `QuotaExceededError` with zero quota. A real write
 * followed by deletion checks this behavior.
 */
export const probeWebStorage = (
  storage: IWebStorageLike | undefined,
  probeKey = '__storage_web_probe__',
  onFailure?: (cause: unknown) => void
): boolean => {
  if (!storage) return false
  let activeProbeKey = probeKey
  /** True only after this probe wrote `activeProbeKey`; nothing else is ever removed. */
  let owned = false
  let available = false
  try {
    // An occupied key belongs to the caller. Try a few random suffixed keys and use one that is
    // absent; the attempt count is a fixed constant, not input-dependent.
    for (let attempt = 0; attempt < 4 && storage.getItem(activeProbeKey) !== null; attempt += 1)
      activeProbeKey = `${probeKey}:${Date.now().toString(36)}:${Math.random()
        .toString(36)
        .slice(2)}`
    if (storage.getItem(activeProbeKey) === null) {
      storage.setItem(activeProbeKey, '1')
      owned = true
      available = true
    }
  } catch (cause) {
    onFailure?.(cause)
    available = false
  } finally {
    try {
      if (owned) storage.removeItem(activeProbeKey)
    } catch (cause) {
      // Probe failures are reported by the boolean result; never leak a raw DOM exception.
      onFailure?.(cause)
      available = false
    }
  }
  return available
}
