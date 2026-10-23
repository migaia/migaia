import type { IRuntimeDynamicSurface } from '../../../../rpc-host/dist/remote/runtime-api/typing.js'
import { createThreadPeer } from '../../../../rpc-plugin-thread/test/protocol.ts'
import { RpcError, RpcCoreErrorCode } from '../../../../rpc-host/dist/core/errors.js'
import { RpcCoreErrorText } from '../../../../rpc-host/dist/core/error-text.js'
import type { IRpcContext } from '../../../../rpc-host/dist/core/typing.js'

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
