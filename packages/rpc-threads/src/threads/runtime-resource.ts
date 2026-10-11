import type { IThreadRuntimeResource } from '@migaia/rpc-core/adapter/threads'

/** Native acquisition stays optional and preserves the launcher's original dynamic import. */
export const threadRuntimeResource: IThreadRuntimeResource = {
  load: () => import('node:worker_threads'),
  get pid() {
    return process.pid
  }
}
