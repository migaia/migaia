import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { createAdapterWebThreadChannelFactory as createWebThreadChannelFactory } from '../../../dist/threads/web-launcher.js'
import { isThreadChild } from '@migaia/rpc-plugin-thread'
import { RpcCapability } from '@migaia/rpc-contract'
import { systemScheduler } from '@migaia/utils/scheduler'

if (await isThreadChild()) {
  await createRpcHost({
    provide: { echo: (value: string) => value },
    plugins: [threadPlugin({ connectToParent: true })]
  })
} else {
  /** Narrow one optional capability while retaining real Runtime API and ping negotiation. */
  const policy = process.argv[2] === 'policy'
  /** Public caller policy removes streaming without supplying any Core preparation metadata. */
  const requested = Object.values(RpcCapability).filter(
    (capability) => capability !== RpcCapability.stream
  )
  /** The canonical Web channel factory receives the actual launcher-created handle. */
  const factory = createWebThreadChannelFactory({
    scheduler: systemScheduler,
    capabilities: requested
  })
  /** Record only the public result of real bilateral ACK negotiation. */
  let observed: readonly string[] | undefined
  /** Preserve every cleanup diagnostic so successful business output cannot hide a reap failure. */
  const diagnostics: unknown[] = []
  /** The ordinary public URL form supplies neither a fake health policy nor a private source. */
  const peer = await createRpcHost<{ echo(value: string): string }>({
    report: (error) => diagnostics.push(error),
    plugins: [
      threadPlugin({
        spawn: policy
          ? {
              entry: new URL(import.meta.url),
              channelFactory: {
                async open(handle, signal) {
                  const channel = await factory.open(
                    handle as Parameters<typeof factory.open>[0],
                    signal
                  )
                  observed = channel.agreement.capabilities
                  return channel
                }
              }
            }
          : new URL(import.meta.url)
      })
    ]
  })
  /** Keep the business result until the owned execution has actually closed. */
  let value: unknown
  try {
    value = await peer.request('echo', 'actual-bun-worker')
  } finally {
    await peer.close()
  }
  console.log(
    JSON.stringify({
      value,
      ...(policy
        ? {
            requestedStream: requested.includes(RpcCapability.stream as (typeof requested)[number]),
            observedStream: observed?.includes(RpcCapability.stream)
          }
        : {}),
      diagnostics: diagnostics.map((error: any) => ({
        source: error?.source,
        code: error?.code,
        name: error?.name,
        detail: error?.detail,
        message: String(error?.message ?? error)
      }))
    })
  )
}
