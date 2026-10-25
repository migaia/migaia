/** Declares the seven native pipelines and derives stage types; no RPC runner lives here. */
import {
  pipelineSpec,
  type IPipelineOwner,
  type IPipelineStage,
  type IPipelineSpec,
  type IPluginHostCore
} from '@migaia/plugin-host'
import type {
  IRpcHandshakePayload,
  IRpcEnvelopePayload,
  IRpcFramePayload,
  IRpcDispatchPayload
} from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.js'

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

/** All namespace-qualified keys retain the same seven authentic native declaration types. */
type IRpcGroupedPipelines = Readonly<Record<string, (typeof RpcFlowPipelines)[RpcFlowPoint]>>

/** A length-safe tuple key cannot alias another namespace or point containing punctuation. */
export function rpcFlowPipelineKey(point: RpcFlowPoint, namespace: string): string {
  return JSON.stringify([namespace, point])
}

/** Registration authority is narrowed from the genuine install core to these fixed declarations. */
export type IRpcFlowCore = IPluginHostCore<
  never,
  Record<PropertyKey, unknown>,
  Record<string, unknown>,
  IRpcGroupedPipelines
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

/** Native lookup is borrowed unchanged; this adapter never owns execution or registration state. */
type IRpcNativePipeline = (name: string) => unknown

/** One cold namespace map lends the actual native handles without allocating keys on each message. */
class RpcPipelineGroups {
  /** Qualified names are immutable declaration facts, not execution snapshots. */
  readonly #keys = new Map<string, Readonly<Record<RpcFlowPoint, string>>>()
  /** Actual native access retains all of plugin-host's registration and lease enforcement. */
  readonly #native: IRpcNativePipeline
  /** Host identity is borrowed after its functional handle or class has been constructed. */
  readonly #getHost: () => object
  /** Declaration validation occurs once before the first actual native installation can open IO. */
  #validated = false
  /** The same cold group declaration serves ordinary and advanced native host construction. */
  readonly pipelines: IRpcGroupedPipelines

  /** Capture finite namespace declarations before any feature or transport begins installation. */
  constructor(getHost: () => object, native: IRpcNativePipeline, namespaces: readonly string[]) {
    this.#getHost = getHost
    this.#native = native
    /** One cold traversal builds both declarations and the hot lookup's original qualified keys. */
    const declarations: Record<string, (typeof RpcFlowPipelines)[RpcFlowPoint]> =
      Object.create(null)
    for (const namespace of new Set(namespaces)) {
      /** The seven fixed points below completely initialize this immutable namespace record. */
      const keys = {} as Record<RpcFlowPoint, string>
      for (const point of Object.values(RpcFlowPoint)) {
        /** Encoding is shared with native registration and cannot alias another group. */
        const key = rpcFlowPipelineKey(point, namespace)
        keys[point] = key
        declarations[key] = RpcFlowPipelines[point]
      }
      this.#keys.set(namespace, Object.freeze(keys))
    }
    this.pipelines = Object.freeze(declarations)
  }
  /** The point fixes payload typing while the cold namespace fixes its real native lane. */
  readonly pipeline = <K extends RpcFlowPoint>(
    point: K,
    namespace: string
  ): IPipelineOwner<(typeof RpcFlowPipelines)[K]> => {
    /** Unknown groups retain the native coded lookup failure; valid traffic uses its cached key. */
    const key = this.#keys.get(namespace)?.[point] ?? rpcFlowPipelineKey(point, namespace)
    return this.#native(key) as IPipelineOwner<(typeof RpcFlowPipelines)[K]>
  }
  /** Installation validates genuine declarations before lending this Host's execution authority. */
  readonly domainCore = (): IRpcNativePipelineCore => {
    try {
      if (!this.#validated) {
        for (const name of Object.keys(this.pipelines)) this.#native(name)
        this.#validated = true
      }
    } catch (cause) {
      throw tagRpcError(
        new TypeError(HostErrorText.nativePipelinesRequired, { cause }),
        RpcCoreErrorCode.invalidConfig
      )
    }
    return { [rpcPipelineOwner]: { host: this.#getHost(), pipeline: this.pipeline } }
  }
}

/**
 * Supplies native pipeline declarations and the matching domain core without constructing a Host.
 * Owner lookup stays lazy until installation, so functional handles and protected class accessors
 * can lend their real execution authority after construction. Registration still verifies Host
 * identity before resource acquisition.
 */
export function rpcHostPipelines(
  getHost: () => object,
  pipeline: IRpcNativePipeline,
  namespaces: readonly string[]
): Readonly<{
  pipelines: IRpcGroupedPipelines
  domainCore(): IRpcNativePipelineCore
}> {
  return new RpcPipelineGroups(getHost, pipeline, namespaces)
}
