import { createThreadPeer, createWebThreadChannelFactory, isThreadChild } from '@migaia/rpc-threads'
import { RpcCapability } from '@migaia/rpc-contract'
import { systemScheduler } from '@migaia/utils/scheduler'

if (await isThreadChild()) {
  await createThreadPeer({ provide: { echo: (value: string) => value } })
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
  /** The ordinary public URL form supplies neither a fake health policy nor a private source. */
  const peer = await createThreadPeer<{ echo(value: string): string }>({
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
  try {
    console.log(
      JSON.stringify({
        value: await peer.request('echo', 'actual-bun-worker'),
        ...(policy
          ? {
              requestedStream: requested.includes(
                RpcCapability.stream as (typeof requested)[number]
              ),
              observedStream: observed?.includes(RpcCapability.stream)
            }
          : {})
      })
    )
  } finally {
    await peer.close()
  }
}
