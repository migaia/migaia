import type { IStorageAdapter } from '@migai/store/persist'

/** Creates a browser LocalStorage adapter without introducing a fallback shared across SSR requests. */
export function localStorageAdapter(
  storage: Storage = globalThis.localStorage
): IStorageAdapter {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key)
  }
}
