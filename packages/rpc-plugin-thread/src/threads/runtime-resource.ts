/**
 * Loads the actual Node worker_threads resource only after canonical runtime selection. Native pid
 * and parent facts remain borrowed runtime values rather than inferred RPC metadata.
 */
import { detectServerRuntime, ServerRuntime } from '@migaia/utils'
import type { IThreadRuntimeResource, IThreadNativeRuntimeModule } from './runtime-types.js'

/** Synchronous factory admission borrows real Node facts after canonical runtime selection only. */
const nodeRuntime =
  detectServerRuntime() === ServerRuntime.node ? await import('node:worker_threads') : undefined

/** Package-private native facts preserve the public asynchronous isThreadChild signature. */
export function readNodeThreadRuntime(): IThreadNativeRuntimeModule | undefined {
  return nodeRuntime
}

/** Native acquisition stays optional and preserves the launcher's original dynamic import. */
export const threadRuntimeResource: IThreadRuntimeResource = {
  load: () => (nodeRuntime ? Promise.resolve(nodeRuntime) : import('node:worker_threads')),
  get pid() {
    return process.pid
  }
}
