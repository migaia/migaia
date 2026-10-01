import { createComposedEndpoint } from '../../../src/core/composed.js'
import { createFirstPartyRoots } from '../../../src/core/internal/first-party-roots.js'
import { createStreamFeature } from '../../../src/core/features/stream.js'
import { abort } from '../../../src/core/middleware/abort.js'
import { codec } from '../../../src/core/middleware/codec.js'
import { connect } from '../../../src/core/middleware/connect.js'
import { framer } from '../../../src/core/middleware/framer.js'
import { ping } from '../../../src/core/middleware/ping.js'
import type { IRpcEndpoint } from '../../../src/core/typing.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../../src/remote/types.js'
import type { IProcessServeEndpointFactory } from '../../../src/process/plugin/types.js'
import type { IProcessByteChannel } from '../../../src/process/types.js'

/** Ordered byte ports exercise the real native handshake and core endpoint without a second codec. */
export function nativeBytePair(): readonly [IProcessByteChannel, IProcessByteChannel] {
  /** Data subscriptions belong separately to each physical port. */
  const readers = [new Set<(chunk: Uint8Array) => void>(), new Set<(chunk: Uint8Array) => void>()]
  /** Parent-loss and channel ownership may subscribe independently to a single close event. */
  const closers = [new Set<(reason?: unknown) => void>(), new Set<(reason?: unknown) => void>()]
  /** Closing one end terminates the shared physical connection exactly once. */
  let closed = false
  /** Every write crosses an asynchronous boundary before reaching the other reader. */
  const port = (index: 0 | 1): IProcessByteChannel => ({
    kind: 'byte',
    async write(chunk) {
      await Promise.resolve()
      if (!closed) for (const listener of readers[1 - index]!) listener(chunk)
    },
    onData(listener) {
      readers[index]!.add(listener)
      return () => {
        readers[index]!.delete(listener)
      }
    },
    onClose(listener) {
      closers[index]!.add(listener)
      return () => {
        closers[index]!.delete(listener)
      }
    },
    close() {
      if (closed) return
      closed = true
      for (const listeners of closers) {
        /**
         * Each physical close notifies the subscribers present before callbacks begin
         * unsubscribing.
         */
        const callbacks = [...listeners]
        for (const listener of callbacks) listener()
      }
    }
  })
  return [port(0), port(1)]
}

/** Build the actual request/control/stream stack used by native process acceptance fixtures. */
export async function nativeEndpoint(
  channel: IRemoteChannel,
  id: string,
  session?: Parameters<IProcessServeEndpointFactory>[2]
): Promise<IRemoteServeEndpoint> {
  /** Each connection owns one canonical Feature graph and its stream provider. */
  const roots = createFirstPartyRoots(
    new Set(['first-party-provider', 'first-party-control', 'first-party-one-way'] as const)
  )
  /** Session policy reaches the real core store and provider limits, rather than a test substitute. */
  const endpoint = await createComposedEndpoint(
    {
      id,
      scheduler: channel.scheduler,
      transport: channel.transport,
      ...(session ? { idempotency: session.idempotency, providerLimits: session.limits } : {}),
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    {
      'first-party-chunk': roots['first-party-chunk'],
      'first-party-outbound': roots['first-party-outbound'],
      'first-party-discovery': roots['first-party-discovery'],
      'first-party-control': roots['first-party-control'],
      'first-party-provider': roots['first-party-provider'],
      'first-party-one-way': roots['first-party-one-way'],
      'first-party-stream': createStreamFeature(
        roots['first-party-outbound'],
        roots['first-party-provider']
      ),
      'channel-ipc-log': channel.features[0]!,
      'channel-ipc-gate': channel.features[1]!
    }
  )
  return {
    endpoint: endpoint as unknown as IRpcEndpoint,
    stream: endpoint.stream,
    oneWay: endpoint
  }
}
