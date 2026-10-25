import { createRpcHost } from '@migaia/rpc-host'
import {
  createAdapterDeployment,
  createAdapterSourceConfigurationError,
  createEventTargetMessageResource,
  defineTransportPlugin,
  holdAdapterMessageBootstrapSource,
  RpcTransportMode
} from '@migaia/rpc-host/plugin'
import type { IThreadWebPort } from '../../../../rpc-plugin-thread/dist/threads/types.js'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import type { IRpcContext } from '../../../../rpc-host/dist/core/typing.js'

/** These counts belong to actual Worker business, independent of browser caller in-flight state. */
let executions = 0

/** The actual Worker explicitly enters the preserved bootstrap owner before its first await. */
let initialized: ReturnType<typeof createRpcHost>
initialized = createRpcHost({
  plugins: [
    defineTransportPlugin({
      name: 'parent',
      mode: RpcTransportMode['connect-to-parent'],
      deployment: createAdapterDeployment({
        open: async () => {
          throw createAdapterSourceConfigurationError()
        },
        bootstrap: (context) =>
          holdAdapterMessageBootstrapSource(
            createEventTargetMessageResource(globalThis as unknown as IThreadWebPort),
            { connectTimeoutMs: context.connectTimeoutMs, report: context.report }
          )
      })
    })
  ],
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
