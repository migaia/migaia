import type { IAbortSignal } from '@migaia/lifecycle'
import {
  createCoroutineSupervisor,
  type ICoroutineHandle,
  type ICoroutineSpec
} from '@migaia/supervision/coroutine'
import type { IUnitBudget } from '@migaia/supervision'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { systemScheduler } from '@migaia/utils/scheduler'
import { messageFramerV1 } from '../contract/framing/index.js'
import { createMemoryTransportPair, type IMemoryTransport } from '../core/adapters/memory.js'
import { createComposedEndpoint } from '../core/composed.js'
import { createCanonicalChunkFeature } from '../core/features/canonical-chunk.js'
import { createOutboundFeature } from '../core/features/outbound.js'
import { createProviderFeature } from '../core/features/provider.js'
import { createStreamFeature } from '../core/features/stream.js'
import { createRpcIdempotencyStore } from '../core/idempotency-store.js'
import { defaultRpcId } from '../core/internal/id.js'
import { connect } from '../core/middleware/connect.js'
import type { IRpcEndpoint } from '../core/typing.js'
import type { IRemoteContract, IRemoteHostCatalog } from './contract.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import { createRemoteHost, type IRemoteHostHandle } from './host.js'
import { createRemotePlugin, type IRemotePluginDefinition } from './plugin.js'
import {
  serveRemoteHost,
  type IRemoteHostPluginResolver,
  type IRemoteServeHostOptions
} from './serve-host.js'
import { serveRemotePlugin } from './serve-plugin.js'
import type {
  IRemoteBinding,
  IRemoteChannel,
  IRemoteEndpointFactory,
  IRemotePluginHostPort,
  IRemoteRetryPort,
  IRemoteServeEndpoint
} from './types.js'

/** A cooperative task publishes one in-memory RPC channel per generation. */
export type IRemoteCoroutineTaskContext = Readonly<{
  signal: IAbortSignal
  heartbeat(): void
  serve(
    host: IRemoteServeHostOptions['host'],
    resolvePlugin?: IRemoteHostPluginResolver
  ): Promise<void>
}>

/** Coroutine options retain the same remote policy inputs as a platform binding. */
export type IRemoteCoroutineCommon = Readonly<{
  task(context: IRemoteCoroutineTaskContext): PromiseLike<unknown> | void
  budget: IUnitBudget<'coroutine'>
  report(error: unknown): void
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
  callDeadlineCapMs?: number
}>

/** Plugin mode needs a local Host enablement port for generation changes. */
export type IRemoteCoroutinePluginOptions = IRemoteCoroutineCommon &
  Readonly<{ name: string; contract: IRemoteContract; host: IRemotePluginHostPort }>

/** Host mode supplies only a catalog; the task supplies its server Host on serve. */
export type IRemoteCoroutineHostOptions = IRemoteCoroutineCommon &
  Readonly<{ catalog: IRemoteHostCatalog }>

/** Builds the same first-party endpoint graph for both sides of one memory pair. */
async function composed(
  id: string,
  transport: IMemoryTransport,
  idempotency?: Readonly<{
    store: ReturnType<typeof createRpcIdempotencyStore>
    scope: () => string
  }>
): Promise<IRemoteServeEndpoint> {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const provider = createProviderFeature(outbound)
  const stream = createStreamFeature(outbound, provider)
  const endpoint = await createComposedEndpoint(
    {
      id,
      transport,
      codec: identityCodecV1,
      framer: messageFramerV1,
      middlewares: [connect({ transport })],
      ...(idempotency ? { idempotency } : {})
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': provider,
      'first-party-stream': stream
    }
  )
  return { endpoint: endpoint as unknown as IRpcEndpoint, stream: endpoint.stream }
}

/** One binding owns the supervisor and uses its exact scheduler in every static channel. */
export function coroutinePorts(
  options: IRemoteCoroutineCommon,
  mode: Readonly<{ contract: IRemoteContract } | { catalog: IRemoteHostCatalog }>
): Readonly<{
  binding: IRemoteBinding<ICoroutineHandle<IMemoryTransport>, ICoroutineSpec<IMemoryTransport>>
  endpointFactory: IRemoteEndpointFactory
}> {
  /** One registration scope and store survive all coroutine generations. */
  const id = defaultRpcId()
  const idempotency = { store: createRpcIdempotencyStore(), scope: () => id }
  const supervisor = createCoroutineSupervisor<IMemoryTransport>({
    id,
    budget: options.budget,
    scheduler: systemScheduler,
    report: options.report,
    ready: (unit) => unit.exposed.then(() => undefined),
    spec: {
      task: async (context) => {
        /** The exposed transport is never replaced within one generation. */
        let exposed: IMemoryTransport | undefined
        /** Closing a task releases only its own service endpoint. */
        let closeService: (() => Promise<void>) | undefined
        const serve = async (
          host: IRemoteServeHostOptions['host'],
          resolvePlugin?: IRemoteHostPluginResolver
        ): Promise<void> => {
          if (exposed) {
            context.expose(exposed)
            return
          }
          if ('catalog' in mode && !resolvePlugin)
            throw createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid)
          const [clientTransport, serverTransport] = createMemoryTransportPair()
          try {
            const server = await composed('server', serverTransport, idempotency)
            const service =
              'catalog' in mode
                ? await serveRemoteHost({
                    host,
                    catalog: mode.catalog,
                    resolvePlugin: resolvePlugin!,
                    endpoint: server,
                    report: options.report
                  })
                : await serveRemotePlugin({
                    host,
                    contract: mode.contract,
                    endpoint: server,
                    report: options.report
                  })
            closeService = service.close
            context.expose(clientTransport)
            exposed = clientTransport
          } catch (error) {
            clientTransport.close()
            throw error
          }
        }
        try {
          await options.task({ signal: context.signal, heartbeat: context.heartbeat, serve })
        } finally {
          try {
            await closeService?.()
          } finally {
            exposed?.close()
          }
        }
      }
    }
  })
  const binding: IRemoteBinding<
    ICoroutineHandle<IMemoryTransport>,
    ICoroutineSpec<IMemoryTransport>
  > = {
    ownership: 'owned',
    supervisor,
    scheduler: systemScheduler,
    openChannel: async (unit): Promise<IRemoteChannel> => {
      const transport = await unit.exposed
      return {
        transport,
        peerId: 'server',
        scheduler: systemScheduler,
        agreement: { source: 'static', codec: identityCodecV1.id, capabilities: ['stream@1'] },
        pipeline: { codec: identityCodecV1, framer: messageFramerV1 },
        features: [],
        close: async () => {
          transport.close()
        }
      }
    }
  }
  return {
    binding,
    endpointFactory: (channel) => composed('client', channel.transport as IMemoryTransport)
  }
}

/** Runs a Plugin contract inside one cooperative in-memory unit. */
export function createCoroutinePlugin(
  options: IRemoteCoroutinePluginOptions
): IRemotePluginDefinition {
  const ports = coroutinePorts(options, { contract: options.contract })
  return createRemotePlugin({
    ...ports,
    name: options.name,
    contract: options.contract,
    host: options.host,
    report: options.report,
    keyFactory: options.keyFactory,
    retryPort: options.retryPort,
    callDeadlineCapMs: options.callDeadlineCapMs
  })
}

/** Runs a Host catalog inside one cooperative in-memory unit. */
export function createCoroutineHost(options: IRemoteCoroutineHostOptions): IRemoteHostHandle {
  const ports = coroutinePorts(options, { catalog: options.catalog })
  return createRemoteHost({
    ...ports,
    catalog: options.catalog,
    report: options.report,
    keyFactory: options.keyFactory,
    retryPort: options.retryPort,
    callDeadlineCapMs: options.callDeadlineCapMs
  })
}
