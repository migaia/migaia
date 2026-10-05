import type { IRuntimeDynamicSurface } from '../../../src/remote/runtime-api/typing.js'
import { createThreadPeer } from '../../../src/threads/index.js'
import { RpcError, RpcCoreErrorCode } from '../../../src/core/errors.js'
import { RpcCoreErrorText } from '../../../src/core/error-text.js'
import type { IRpcContext } from '../../../src/core/typing.js'

/** These counts belong to actual Worker business, independent of browser caller in-flight state. */
let executions = 0

/** The true DedicatedWorkerGlobalScope installs bootstrap capture before its first top-level await. */
let initialized: ReturnType<typeof createThreadPeer<IRuntimeDynamicSurface>>
initialized = createThreadPeer<IRuntimeDynamicSurface>({
  provide: {
    value: () => ++executions,
    fail: () => {
      throw new RpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    },
    values: async function* (_payload: unknown, context: IRpcContext) {
      executions++
      yield 1
      yield 2
      return context.signal.aborted ? -1 : 99
    },
    /** A separately observed parent provider proves genuine reverse dispatch. */
    probe: async (value: unknown) => {
      const peer = await initialized
      return { value, self: peer.self, parent: await peer.request('parentEcho') }
    }
  },
  report: () => undefined
})
await initialized
