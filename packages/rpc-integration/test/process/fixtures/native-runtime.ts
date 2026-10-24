import { createComposedEndpoint } from '../../../../rpc-host/dist/core/composed.js'
import { createRuntimeFeatureRoots } from '../../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { createStreamFeature } from '../../../../rpc-host/dist/core/stream/index.js'
import { abort } from '../../../../rpc-host/dist/core/middleware/abort.js'
import { codec } from '../../../../rpc-host/dist/core/middleware/codec.js'
import { connect } from '../../../../rpc-host/dist/core/middleware/connect.js'
import { framer } from '../../../../rpc-host/dist/core/middleware/framer.js'
import { ping } from '../../../../rpc-host/dist/core/middleware/ping.js'
import { type IRpcEndpoint } from '../../../../rpc-host/dist/core/typing.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import type { IProcessServeEndpointFactory } from '../../../../rpc-plugin-process/dist/process/plugin/types.js'
import type { IProcessByteChannel } from '../../../../rpc-plugin-process/dist/process/types.js'

/** Ordered byte ports exercise the real native handshake and core endpoint without a second codec. */
export function nativeBytePair(): readonly [IProcessByteChannel, IProcessByteChannel] {
  return new NativeBytePair().ports
}

/** One physical byte pair owns its close state and both directions' actual subscriptions. */
class NativeBytePair {
  /** Data readers belong separately to the two physical ends. */
  readonly #readers = [
    new Set<(chunk: Uint8Array) => void>(),
    new Set<(chunk: Uint8Array) => void>()
  ]
  /** Parent-loss and channel ownership can observe the same end's physical close. */
  readonly #closers = [new Set<(reason?: unknown) => void>(), new Set<(reason?: unknown) => void>()]
  /** Either end may close the shared connection exactly once. */
  #closed = false
  /** These ports are actual byte resources rather than an RPC dispatcher or synthetic endpoint. */
  readonly ports = [this.#port(0), this.#port(1)] as const

  /** Short port callbacks delegate to this single physical owner and retain only end identity. */
  #port(index: 0 | 1): IProcessByteChannel {
    return {
      kind: 'byte',
      write: (chunk) => this.#write(index, chunk),
      onData: (listener) => {
        this.#readers[index]!.add(listener)
        return () => {
          this.#readers[index]!.delete(listener)
        }
      },
      onClose: (listener) => {
        this.#closers[index]!.add(listener)
        return () => {
          this.#closers[index]!.delete(listener)
        }
      },
      close: () => this.#close()
    }
  }

  /** Every physical write crosses the same original asynchronous boundary before peer delivery. */
  async #write(index: 0 | 1, chunk: Uint8Array): Promise<void> {
    await Promise.resolve()
    if (!this.#closed) for (const listener of this.#readers[1 - index]!) listener(chunk)
  }

  /** Reentrant removal affects subsequent end snapshots, preserving the original close order. */
  #close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const listeners of this.#closers) {
      /** Each end captures its subscribers immediately before that end's callbacks begin. */
      const callbacks = [...listeners]
      for (const listener of callbacks) listener()
    }
  }
}

/** Build the actual request/control/stream stack used by native process acceptance fixtures. */
export async function nativeEndpoint(
  channel: IRemoteChannel,
  id: string,
  session?: Parameters<IProcessServeEndpointFactory>[2]
): Promise<IRemoteServeEndpoint> {
  /** Production owns the one outbound/provider graph; this oracle retains genuine legacy wire. */
  const { roots, options } = createRuntimeFeatureRoots(
    {
      id,
      scheduler: channel.scheduler,
      transport: channel.transport,
      features: channel.features,
      ...(session ? { idempotency: session.idempotency, providerLimits: session.limits } : {}),
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        ping()
      ]
    },
    channel
  )
  /** Foreign legacy stream agreement intentionally has no runtimeApi capability predicate. */
  const endpoint = await createComposedEndpoint(options, {
    ...roots,
    'first-party-stream': createStreamFeature(
      roots['first-party-outbound'],
      roots['first-party-provider']
    )
  })
  return {
    endpoint: endpoint as unknown as IRpcEndpoint,
    stream: endpoint.stream,
    oneWay: endpoint
  }
}
