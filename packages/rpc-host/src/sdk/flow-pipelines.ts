/** Declares the seven native pipelines and derives stage types; no RPC runner lives here. */
import {
  pipelineSpec,
  type IPipelineSpec,
  type IPipelineOwner,
  type IPipelineStage,
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
  [RpcFlowPoint.handshakeOutbound]: pipelineSpec<IRpcHandshakePayload>()({ mode: 'async' }),
  [RpcFlowPoint.handshakeInbound]: pipelineSpec<IRpcHandshakePayload>()({
    mode: 'async',
    order: 'reverse'
  }),
  [RpcFlowPoint.envelopeOutbound]: pipelineSpec<IRpcEnvelopePayload>()({ mode: 'async' }),
  [RpcFlowPoint.envelopeInbound]: pipelineSpec<IRpcEnvelopePayload>()({
    mode: 'async',
    order: 'reverse'
  }),
  [RpcFlowPoint.frameOutbound]: pipelineSpec<IRpcFramePayload>()({
    mode: 'async',
    next: 'multiple'
  }),
  [RpcFlowPoint.frameInbound]: pipelineSpec<IRpcFramePayload>()({
    mode: 'async',
    next: 'multiple',
    order: 'reverse'
  }),
  [RpcFlowPoint.dispatchInbound]: pipelineSpec<IRpcDispatchPayload>()({
    mode: 'async',
    order: 'reverse'
  })
})

/** Public authoring types are projected from the native declaration, never a second hook protocol. */
export type IRpcFlowStage<K extends RpcFlowPoint> = IPipelineStage<(typeof RpcFlowPipelines)[K]>

/** Each stage remains paired with its one declared payload and mode. */
export type IRpcFlowStages = Readonly<{ [K in RpcFlowPoint]?: IRpcFlowStage<K> }>

/** Registration authority is narrowed from the genuine install core to these fixed declarations. */
export type IRpcFlowCore = IPluginHostCore<
  never,
  Record<PropertyKey, unknown>,
  Record<string, unknown>,
  typeof RpcFlowPipelines
>

/** Execution authority is explicitly lent by a native host owner, never obtained from plugin core. */
export type IRpcPipelineOwner = Readonly<{
  pipeline<K extends RpcFlowPoint>(name: K): IPipelineOwner<(typeof RpcFlowPipelines)[K]>
}>

/** Native domain construction explicitly lends this host's execution authority to RPC SDK plugins. */
export const rpcPipelineOwner = Symbol('rpc-pipeline-owner')

/** Advanced native host authors supply their genuine owner and the corresponding execution port. */
export type IRpcNativePipelineCore = Readonly<{
  [rpcPipelineOwner]: IRpcPipelineOwner & Readonly<{ host: object }>
}>

/**
 * Supplies native pipeline declarations and the matching domain core without constructing a Host.
 * Owner lookup stays lazy until installation, so functional handles and protected class accessors
 * can lend their real execution authority after construction. Registration still verifies Host
 * identity before resource acquisition.
 */
export function rpcHostPipelines(
  getHost: () => object,
  pipeline: IRpcPipelineOwner['pipeline']
): Readonly<{
  pipelines: typeof RpcFlowPipelines
  domainCore(): IRpcNativePipelineCore
}> {
  return Object.freeze({
    pipelines: RpcFlowPipelines,
    /** Each native registration receives only its actual owner's explicitly lent execution port. */
    domainCore: (): IRpcNativePipelineCore => {
      try {
        // RpcFlowPoint declares exactly seven fixed names; lookup takes no execution snapshot/lease.
        for (const name of Object.values(RpcFlowPoint)) pipeline(name)
      } catch (cause) {
        throw tagRpcError(
          new TypeError(HostErrorText.nativePipelinesRequired, { cause }),
          RpcCoreErrorCode.invalidConfig
        )
      }
      return { [rpcPipelineOwner]: { host: getHost(), pipeline } }
    }
  })
}
