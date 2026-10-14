import type { IWebStorageLike } from '../types/storage.js'

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
  let previousValue: string | null = null
  let available = false
  try {
    previousValue = storage.getItem(probeKey)
    if (previousValue !== null) {
      activeProbeKey = `${probeKey}:${Date.now().toString(36)}:${Math.random()
        .toString(36)
        .slice(2)}`
      previousValue = null
    }
    storage.setItem(activeProbeKey, '1')
    available = true
  } catch (cause) {
    onFailure?.(cause)
    available = false
  } finally {
    try {
      if (previousValue === null) storage.removeItem(activeProbeKey)
      else storage.setItem(activeProbeKey, previousValue)
    } catch (cause) {
      // Probe failures are reported by the boolean result; never leak a raw DOM exception.
      onFailure?.(cause)
      available = false
    }
  }
  return available
}
