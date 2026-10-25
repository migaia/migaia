/**
 * Classifies the current native process from its launcher discovery marker without opening IO.
 * Consumed nonsecret child classification is retained locally; bootstrap authentication remains
 * independent.
 */
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION } from './constants.js'

/** Discovery consumes the native environment marker; retain only its nonsecret child classification. */
let observedChild = false

/**
 * Read the existing launcher bootstrap marker without granting authentication or ownership. The
 * whole entry executes again for `spawn: true`; use this before parent-only top-level work.
 */
export function isProcessChild(): boolean {
  if (observedChild) return true
  /** Deno discovery must not prompt for access to an environment key. */
  const deno = Reflect.get(globalThis, 'Deno') as
    | {
        env: { get(key: string): string | undefined }
        permissions: { querySync(descriptor: { name: 'env'; variable: string }): { state: string } }
      }
    | undefined
  /** The marker is only discovery data; the original stdin bootstrap still authenticates the child. */
  const marker = deno
    ? deno.permissions.querySync({ name: 'env', variable: PROCESS_RUNTIME_API_ENV }).state ===
      'granted'
      ? deno.env.get(PROCESS_RUNTIME_API_ENV)
      : undefined
    : typeof process !== 'undefined'
      ? process.env[PROCESS_RUNTIME_API_ENV]
      : undefined
  observedChild = marker === PROCESS_RUNTIME_API_ENV_VERSION
  return observedChild
}
