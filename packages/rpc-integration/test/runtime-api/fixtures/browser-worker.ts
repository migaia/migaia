import { createAutomaticWebThreadPeer } from '../../../../rpc-plugin-thread/test/protocol.ts'
import type { IThreadWebPort } from '../../../../rpc-plugin-thread/dist/threads/types.js'
import { RpcError, RpcCoreErrorCode } from '../../../../rpc-host/dist/core/errors.js'
import { RpcCoreErrorText } from '../../../../rpc-host/dist/core/error-text.js'
import type { IRpcContext } from '../../../../rpc-host/dist/core/typing.js'

/** These counts belong to actual Worker business, independent of browser caller in-flight state. */
let executions = 0

/** The actual Worker explicitly enters the preserved bootstrap owner before its first await. */
let initialized: ReturnType<typeof createAutomaticWebThreadPeer>
initialized = createAutomaticWebThreadPeer(
  {
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
  },
  globalThis as unknown as IThreadWebPort
)
await initialized
