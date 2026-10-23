import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  createAdapterDeployment,
  defineTransportPlugin,
  type IAdapterDeploymentContext
} from '@migaia/rpc-host/plugin'
import { memoryServer } from '../../rpc-host/test/host/fixture.js'

/** Open actual canonical raw channels into independent genuine remote hosts on every acquisition. */
export function repeatableConnect(
  options: Readonly<{
    beforeOpen?(index: number): void | Promise<void>
    closeErrors?: readonly (unknown | undefined)[]
    provide?(index: number): Parameters<typeof createRpcHost>[0]['provide']
  }> = {}
) {
  /** Counters observe actual native-source operations, never mocked member facade results. */
  let opens = 0
  const remotes: IRpcHost<unknown>[] = []
  const closeOrder: number[] = []
  const open = async (context: IAdapterDeploymentContext) => {
    const index = opens++
    await options.beforeOpen?.(index)
    const server = memoryServer(`member-${index}`, `member-${crypto.randomUUID()}`)
    const remote = await createRpcHost({
      ...server.options,
      provide: options.provide?.(index) ?? {
        identity: () => index,
        echo: (value: unknown) => value
      }
    })
    remotes.push(remote)
    const channel = await server.open(context)
    /** The fixture observes the original close once and retains its exact completion Promise. */
    let closing: Promise<void> | undefined
    return {
      ...channel,
      close: () =>
        (closing ??= (async () => {
          closeOrder.push(index)
          await channel.close()
          await remote.close()
          if (options.closeErrors?.[index] !== undefined) throw options.closeErrors[index]
        })())
    }
  }
  return {
    transport: defineTransportPlugin({
      name: 'repeatable-connect',
      mode: 'connect',
      deployment: createAdapterDeployment({ open })
    }),
    remotes,
    closeOrder,
    opens: () => opens
  }
}
