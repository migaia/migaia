import { SHARED_GLOBAL_KEY } from '../text.ts'

/** Global slot remote modules read the shared runtime from (their shims import nothing else). */
const SHARED_SYMBOL = Symbol.for(SHARED_GLOBAL_KEY)

/** Places the shared runtime namespaces on the shared global; later calls replace the object. */
export function placeSharedRuntime(shared: Readonly<Record<string, unknown>>): void {
  ;(globalThis as Record<symbol, unknown>)[SHARED_SYMBOL] = shared
}

/**
 * Imports verified module bytes through a Blob URL, revoked as soon as the import settles so URLs
 * never accumulate across versions. The shared runtime is placed on the shared global first. The
 * page CSP must allow `script-src blob:`.
 */
export async function importModuleBytes(
  bytes: Uint8Array,
  shared: Readonly<Record<string, unknown>>
): Promise<{ readonly default?: unknown }> {
  placeSharedRuntime(shared)
  /** Object URL of the module bytes. */
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'text/javascript' }))
  try {
    return (await import(/* @vite-ignore */ url)) as { readonly default?: unknown }
  } finally {
    URL.revokeObjectURL(url)
  }
}
