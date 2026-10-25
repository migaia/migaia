/**
 * Reads and consumes Deno child-discovery markers only with existing environment permission. It
 * opens the original stdio/bootstrap resource and supplies the native final-exit operation.
 */
import type { IAdapterProcessRuntimeIO } from '../runtime-loader.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './deno-command.js'
import { isProcessChild } from '../child.js'

/** Only this native process retains consumed discovery; grandchildren inherit no automatic marker. */
let automaticMarker: string | undefined

/** Deno owns its real permission-gated environment and its original Web Streams. */
class NativeDenoProcessRuntimeIO implements IAdapterProcessRuntimeIO {
  /** Read only an allowed native environment key and retain the original consume order. */
  discover() {
    /** Resolve the same actual native namespace at the original post-timeout discovery point. */
    const runtime = Reflect.get(globalThis, 'Deno') as {
      env: { get(key: string): string | undefined; delete(key: string): void }
      permissions: {
        querySync(descriptor: { name: 'env'; variable: string }): { state: string }
      }
    }
    /** Discovery never reads a denied key or prompts for a new permission. */
    const permitted =
      runtime.permissions.querySync({ name: 'env', variable: PROCESS_RUNTIME_API_ENV }).state ===
      'granted'
    /** The process's own consumed marker stays authoritative over later environment reads. */
    const marker =
      automaticMarker ?? (permitted ? runtime.env.get(PROCESS_RUNTIME_API_ENV) : undefined)
    isProcessChild()
    if (marker !== undefined && permitted) {
      automaticMarker = marker
      runtime.env.delete(PROCESS_RUNTIME_API_ENV)
    }
    return { marker, runtime: 'deno' }
  }

  /** Preserve the native child guard's real runtime exit without a Node shim. */
  readonly exit = (code: 0 | 1): void => {
    /** Runtime acquisition remains native and is performed only after Deno was selected. */
    const runtime = Reflect.get(globalThis, 'Deno') as { exit(code: number): never }
    runtime.exit(code)
  }

  /** Open this actual process's stdin/stdout without constructing a Node stream shim. */
  open() {
    return openProcessStdioChannel({
      bootstrap: 'stdin',
      bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
    })
  }
}

/** The native module hands Core the stdio resource it actually holds. */
export const processRuntimeIO = new NativeDenoProcessRuntimeIO()
