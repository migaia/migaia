/** Declares the seven native pipelines and derives stage types; no RPC runner lives here. */
import {
  pipelineSpec,
  type IPipelineOwner,
  type IPipelineStage,
  type IPipelineSpec,
  type IPluginHostCore,
  type IHostCoreConstructionRequest
} from '@migaia/plugin-host'
import type {
  IRpcHandshakePayload,
  IRpcEnvelopePayload,
  IRpcFramePayload,
  IRpcDispatchPayload
} from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'

/** These fixed keys connect native registration and the corresponding RPC execution owners. */
export const RpcFlowPoint = {
  handshakeOutbound: 'handshakeOutbound',
  handshakeInbound: 'handshakeInbound',
  envelopeOutbound: 'envelopeOutbound',
  envelopeInbound: 'envelopeInbound',
  frameOutbound: 'frameOutbound',
  frameInbound: 'frameInbound',
  dispatchInbound: 'dispatchInbound'
} as const

export type RpcFlowPoint = keyof typeof RpcFlowPoint

/** All seven lanes share async execution; only direction and physical fan-out differ. */
function flowPipeline<T>(reverse = false, multiple = false): IPipelineSpec<T, 'async'> {
  return pipelineSpec<T>()({
    mode: 'async',
    next: multiple ? 'multiple' : 'single',
    order: reverse ? 'reverse' : 'install'
  })
}

/** Constructing an ordinary native host uses the same genuine declarations as createRpcHost. */
export const RpcFlowPipelines: Readonly<{
  handshakeOutbound: IPipelineSpec<IRpcHandshakePayload, 'async'>
  handshakeInbound: IPipelineSpec<IRpcHandshakePayload, 'async'>
  envelopeOutbound: IPipelineSpec<IRpcEnvelopePayload, 'async'>
  envelopeInbound: IPipelineSpec<IRpcEnvelopePayload, 'async'>
  frameOutbound: IPipelineSpec<IRpcFramePayload, 'async'>
  frameInbound: IPipelineSpec<IRpcFramePayload, 'async'>
  dispatchInbound: IPipelineSpec<IRpcDispatchPayload, 'async'>
}> = Object.freeze({
  [RpcFlowPoint.handshakeOutbound]: flowPipeline<IRpcHandshakePayload>(),
  [RpcFlowPoint.handshakeInbound]: flowPipeline<IRpcHandshakePayload>(true),
  [RpcFlowPoint.envelopeOutbound]: flowPipeline<IRpcEnvelopePayload>(),
  [RpcFlowPoint.envelopeInbound]: flowPipeline<IRpcEnvelopePayload>(true),
  [RpcFlowPoint.frameOutbound]: flowPipeline<IRpcFramePayload>(false, true),
  [RpcFlowPoint.frameInbound]: flowPipeline<IRpcFramePayload>(true, true),
  [RpcFlowPoint.dispatchInbound]: flowPipeline<IRpcDispatchPayload>(true)
})

/** Public authoring types are projected from the native declaration, never a second hook protocol. */
export type IRpcFlowStage<K extends RpcFlowPoint> = IPipelineStage<(typeof RpcFlowPipelines)[K]>

/** Third-party stages choose the business plaintext or outer wire position in each pipeline. */
export const RpcFlowLayer = { plaintext: 'plaintext', wire: 'wire' } as const
export type RpcFlowLayer = keyof typeof RpcFlowLayer

/**
 * Layer metadata affects cold native registration only; execution still receives the original
 * stage.
 */
export type IRpcFlowStages = Readonly<{
  [K in RpcFlowPoint]?:
    | IRpcFlowStage<K>
    | Readonly<{ layer: RpcFlowLayer; stage: IRpcFlowStage<K> }>
}>

/** Registration authority is narrowed from the genuine install core to these fixed declarations. */
export type IRpcFlowCore = IPluginHostCore<
  never,
  Record<PropertyKey, unknown>,
  Record<string, unknown>,
  typeof RpcFlowPipelines
>

/** Execution authority is explicitly lent by a native host owner, never obtained from plugin core. */
export type IRpcPipelineOwner = Readonly<{
  pipeline<K extends RpcFlowPoint>(
    point: K,
    namespace: string
  ): IPipelineOwner<(typeof RpcFlowPipelines)[K]>
}>

/** Native domain construction explicitly lends this host's execution authority to RPC SDK plugins. */
export const rpcPipelineOwner = Symbol('rpc-pipeline-owner')

/** Advanced native host authors supply their genuine owner and the corresponding execution port. */
export type IRpcNativePipelineCore = Readonly<{
  [rpcPipelineOwner]: IRpcPipelineOwner & Readonly<{ host: object }>
}>

/** Native lookup borrows the original construction request and its exact registration. */
type IRpcNativePipeline = (name: string, request: IHostCoreConstructionRequest) => unknown

/** One flow configuration failure preserves native type, optional original cause and semantic code. */
export function invalidFlow(message: string, options?: ErrorOptions): never {
  throw tagRpcError(new TypeError(message, options), RpcCoreErrorCode.invalidConfig)
}

/** One real core borrows its transport's original native group throughout that registration. */
class RpcPipelineGroup {
  /** The Host owner lends execution without adding it to the plugin registration core. */
  readonly #native: IRpcNativePipeline
  /** Exact construction provenance isolates candidates from published predecessors. */
  readonly #request: IHostCoreConstructionRequest

  /** Capture genuine owner authority; declarations belong to the actual transport plugin. */
  constructor(native: IRpcNativePipeline, request: IHostCoreConstructionRequest) {
    this.#native = native
    this.#request = request
  }

  /** Namespace selection already chose this registration; native short lookup owns its lane. */
  readonly pipeline = <K extends RpcFlowPoint>(
    point: K,
    _namespace: string
  ): IPipelineOwner<(typeof RpcFlowPipelines)[K]> =>
    this.#native(point, this.#request) as IPipelineOwner<(typeof RpcFlowPipelines)[K]>
}

/** Lend this native Host's execution authority through its existing domain-core construction. */
class RpcNativePipelines {
  /** Host identity is read after the functional handle or class has actually been constructed. */
  readonly #getHost: () => object
  /** The same native lookup receives each core's authentic construction request. */
  readonly #native: IRpcNativePipeline

  /** Capture owner access without predeclaring namespaces or allocating another runner. */
  constructor(getHost: () => object, native: IRpcNativePipeline) {
    this.#getHost = getHost
    this.#native = native
  }

  /** Every registration receives its own port; shared flow setup never registers late stages. */
  readonly domainCore = (request: IHostCoreConstructionRequest): IRpcNativePipelineCore => ({
    [rpcPipelineOwner]: {
      host: this.#getHost(),
      pipeline: new RpcPipelineGroup(this.#native, request).pipeline
    }
  })
}

/**
 * Lend the genuine native owner's existing pipeline lookup to each domain core. Transport helpers
 * declare their own seven pipelines; no cold namespace inventory or host declaration map remains.
 */
export function rpcHostPipelines(
  getHost: () => object,
  pipeline: IRpcNativePipeline
): Readonly<{
  domainCore(request: IHostCoreConstructionRequest): IRpcNativePipelineCore
}> {
  return new RpcNativePipelines(getHost, pipeline)
}
