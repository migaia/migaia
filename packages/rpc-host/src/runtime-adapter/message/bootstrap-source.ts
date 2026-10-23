import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import { hostRethrowReporter } from '@migaia/utils/promise'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { RuntimeApiErrorText } from '../../remote/runtime-api/constants.js'
import { defaultRpcReporter } from '../../core/default-reporter.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRuntimePeerSourceContext } from '../../remote/runtime-api/peer.js'
import { readAdapterMessagePreparation, createAdapterMessageHandshakeBudget } from './resource.js'
import type { IAdapterMessagePreparation } from './resource.js'
import type {
  IAdapterInitialMessageResource,
  IAdapterMessageResource,
  IAdapterMessageHandshakeBudget
} from './types.js'

/** Exact held message input grants bootstrap authority; copied token fields cannot grant it. */
declare const adapterMessageBootstrapIdentity: unique symbol
export type IAdapterMessageBootstrapSource = Readonly<{ [adapterMessageBootstrapIdentity]: true }>
/** Native initial capture and ACK share the original resource and its one preparation deadline. */
type IMessageBootstrapSource = Readonly<{
  resource: IAdapterMessageResource
  preparation: IAdapterMessagePreparation
  handshakeBudget: IAdapterMessageHandshakeBudget | undefined
}>
/** Caller options select only the native read and deadline, never the admitted identity. */
type IMessageBootstrapOptions = Readonly<{
  initial?: IAdapterInitialMessageResource
  connectTimeoutMs?: number
  report?: (error: unknown) => void
}>
/** Opaque source handles retain only their actual original resource receipt. */
const sources = new WeakMap<object, IMessageBootstrapSource>()

/** Both automatic assemblies acquire the same canonical private first-message preparation. */
export async function prepareAdapterMessageBootstrap(
  resource: IAdapterMessageResource,
  options: IMessageBootstrapOptions = {}
): Promise<IMessageBootstrapSource> {
  /** Only the actual registered resource supplies its admitted initial message and generation. */
  const preparation = readAdapterMessagePreparation(resource)
  if (!preparation)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  /** Capture the same remaining deadline before receiving initial data or negotiating its ACK. */
  const handshakeBudget = createAdapterMessageHandshakeBudget(
    systemScheduler,
    options.connectTimeoutMs
  )
  if (!preparation.initial) await resource.receiveInitial(options.initial, true, handshakeBudget)
  return { resource, preparation, handshakeBudget }
}

/** Hold raw native child input before the Host constructs its only endpoint. */
export async function holdAdapterMessageBootstrapSource(
  resource: IAdapterMessageResource,
  options: IMessageBootstrapOptions = {}
): Promise<IAdapterMessageBootstrapSource> {
  try {
    /** Initial capture remains on the original resource, including child-guard buffered input. */
    const source = await prepareAdapterMessageBootstrap(resource, options)
    /** No identity or generation can be copied out of this public nominal handle. */
    const token = Object.freeze({}) as IAdapterMessageBootstrapSource
    sources.set(token, source)
    return token
  } catch (primary) {
    try {
      readAdapterMessagePreparation(resource)?.close()
    } catch (cleanup) {
      try {
        ;(options.report ?? defaultRpcReporter)(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw primary
  }
}

/** Internal dispatch reads exact membership without accepting a caller's claimed message kind. */
export function readAdapterMessageBootstrapSource(
  token: object
): IMessageBootstrapSource | undefined {
  return sources.get(token)
}

/** The old private Peer and the genuine Host negotiate through the same actual resource opener. */
export function openPreparedAdapterMessageBootstrap(
  source: IMessageBootstrapSource,
  context: IRuntimePeerSourceContext & Readonly<{ signal?: IAbortSignal }>
) {
  /** The sole closed parser has already admitted this actual native self/parent relationship. */
  const initial = source.preparation.initial!
  if (
    context.self.name !== initial.self.name ||
    context.self.instanceId !== initial.self.instanceId
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.identityInvalid)
  /** Canonical clone control supplies the local proposal without copying a peer's capability claim. */
  const offer = rpcMessageCapabilityControl.localOffer(context.capabilities) as Extract<
    ReturnType<typeof rpcMessageCapabilityControl.localOffer>,
    { valid: true }
  >
  return source.resource.open({
    peerId: initial.parent.instanceId,
    scheduler: systemScheduler,
    offer: offer.value,
    control: rpcMessageCapabilityControl,
    handshakeBudget: source.handshakeBudget,
    ...(context.signal ? { signal: context.signal } : {})
  })
}

/** Only a genuinely held token may open the original message channel after Host identity adoption. */
export function openAdapterMessageBootstrapSource(
  token: IAdapterMessageBootstrapSource,
  context: IRuntimePeerSourceContext & Readonly<{ signal?: IAbortSignal }>
) {
  /** Exact membership keeps this dispatch separate from byte first-frame grammar. */
  const source = readAdapterMessageBootstrapSource(token)
  if (!source)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  return openPreparedAdapterMessageBootstrap(source, context)
}
