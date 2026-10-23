import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IRuntimePeerSourceContext,
  IRuntimePeerSourceResult,
  IRuntimePeerOptions
} from '../remote/runtime-api/peer.js'
import type { IRpcFactoryConfig, IRpcProviderLimits } from '../core/typing.js'
import type { IProviderAdmissionScope } from '../core/features/provider.js'
import type { IRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
import type { IRemoteBinding, IRemoteChannel, IRemoteServeEndpoint } from '../remote/types.js'
import type { ISupervisor } from '@migaia/supervision'
import type { IProviderSessionPolicy } from '../core/internal/provider.js'
import type { IRpcFeaturePlugin, IRpcHostMember } from '../plugin/types.js'
import type { IAdapterByteBootstrapSource } from './byte/bootstrap-source.js'
import type { IAdapterMessageBootstrapSource } from './message/bootstrap-source.js'
import type { IAdapterPeerPreparation } from './peer.js'
import type { RuntimePluginKey } from '../remote/runtime-api/constants.js'

/** The private nominal key prevents structural options from pretending to be a captured source. */
declare const adapterDeploymentIdentity: unique symbol

/** A cold deployment grants only the package-owned raw source operations associated with its token. */
export type IAdapterDeployment = Readonly<{ [adapterDeploymentIdentity]: true }>

/** Host assembly supplies its genuine local offer and the existing preparation cancellation budget. */
export type IAdapterDeploymentContext = IRuntimePeerSourceContext &
  Readonly<{
    signal?: IAbortSignal
    connectTimeoutMs?: number
    report(error: unknown): void
    /** Register actual cold-source cleanup in this Host endpoint's existing resource scope. */
    ownClose?(close: () => void | Promise<void>): void
    /** Preserve whether the caller explicitly configured a sink before native default coalescing. */
    configuredReport?: (error: unknown) => void
    /** Exact SDK feature objects retain each transport owner's private configuration identity. */
    features?: readonly IRpcFeaturePlugin[]
    /** Original launcher preparation retains the actual host identity and reserved generation. */
    launcher?: IAdapterPeerPreparation['launcher']
  }>

/** Original provider policies join the host's one endpoint rather than constructing a second one. */
export type IAdapterDeploymentEndpointPreparation = Readonly<{
  policy: Pick<IRpcFactoryConfig, 'providerLimits' | 'idempotency' | 'provider'>
  /** Shared endpoint execution reads the same original native policy for this accepted session. */
  execution?: IProviderSessionPolicy
  providerAdmission?: IProviderAdmissionScope
  providerAdmissionRegistration?: IRuntimePreparationContext['providerAdmissionRegistration']
  wrapEndpoint?(
    endpoint: IRemoteServeEndpoint,
    onExecution?: (execution: IProviderSessionPolicy) => void
  ): IRemoteServeEndpoint
}>

/** Native listener ownership remains at the source and is released by the host install receipt. */
export type IAdapterDeploymentListener = Readonly<{ close(): void | Promise<void> }>

/** Original native bindings retain supervision, health and drain while host owns endpoint assembly. */
export type IAdapterManagedDeployment = Readonly<{
  binding: IRemoteBinding<unknown, unknown>
  /** The original source may select its established logical idempotency-key factory. */
  keyFactory?: IRuntimePeerOptions['keyFactory']
  /** The original source lends its exact retry owner, without another retry policy. */
  retryPort?: IRuntimePeerOptions['retryPort']
  /** Only the actual spawned owner carries execution authority; borrowed sockets omit it. */
  execution?: ISupervisor<unknown, unknown>
  /** The actual transport prepares an opaque replacement before the original supervisor queue. */
  prepareReplacement?(spec: unknown): unknown
  /** Apply the original binding's health/drain view to this same borrowed endpoint. */
  bindEndpoint?(
    channel: IRemoteChannel,
    endpoint: IRemoteServeEndpoint,
    onExecution?: (execution: IProviderSessionPolicy) => void
  ): IRemoteServeEndpoint
  beforeRelease?(): Promise<void>
  callDeadlineCapMs?: number
}>

/** A listener borrows the genuine session, whose endpoint disposal retires only that channel. */
export type IAdapterDeploymentAcceptedSession = Readonly<{
  peer: IRpcHostMember
  endpoint: IRemoteServeEndpoint
}>
/** Original native listener policy is supplied at the same accepted-channel preparation point. */
export type IAdapterDeploymentAccept = (
  channel: IRuntimePeerSourceResult,
  preparation?: IAdapterDeploymentEndpointPreparation
) => Promise<IAdapterDeploymentAcceptedSession>

/** Only package-owned writers register raw opening and optional native listener operations. */
export type IAdapterDeploymentRecipe = Readonly<{
  /** Ordinary Host installation retains the original process/thread outlet key. */
  runtimeKey?: keyof typeof RuntimePluginKey
  /** The original definition owns its canonical shared-slot family identity. */
  runtimeFamily?: object
  /** Ordinary Hosts inherit the same explicit local peer configuration without source factories. */
  runtimeOptions?: Pick<
    IRuntimePeerOptions,
    | 'self'
    | 'provide'
    | 'probe'
    | 'providerLimits'
    | 'authentication'
    | 'defaultTimeoutMs'
    | 'contract'
    | 'keyFactory'
    | 'retryPort'
    | 'report'
  >
  /** Actual first-frame identity is adopted before constructing the host's only endpoint. */
  bootstrap?(
    context: IAdapterDeploymentContext
  ): Promise<IAdapterByteBootstrapSource | IAdapterMessageBootstrapSource>
  /** Capture the actual native binding only during installation, without opening a complete Peer. */
  managed?(context: IAdapterDeploymentContext): Promise<IAdapterManagedDeployment>
  open(context: IAdapterDeploymentContext): Promise<IRuntimePeerSourceResult>
  listen?(
    context: IAdapterDeploymentContext,
    accept: IAdapterDeploymentAccept
  ): Promise<IAdapterDeploymentListener>
  prepareEndpoint?(
    channel: IRuntimePeerSourceResult,
    providerLimits?: IRpcProviderLimits
  ): IAdapterDeploymentEndpointPreparation
}>

/** The registry stores cold recipes only; each actual opening retains its canonical source owner. */
const deployments = new WeakMap<object, IAdapterDeploymentRecipe>()

/** Register a package-private raw recipe and return its exact immutable opaque token. */
export function createAdapterDeployment(recipe: IAdapterDeploymentRecipe): IAdapterDeployment {
  /** Empty frozen tokens expose no operation table that callers can copy or mutate. */
  const token = Object.freeze({}) as IAdapterDeployment
  deployments.set(token, Object.freeze({ ...recipe }))
  return token
}

/** Host assembly reads only genuine tokens; copied, forged and primitive values return undefined. */
export function readAdapterDeployment(value: unknown): IAdapterDeploymentRecipe | undefined {
  return deployments.get(value as object)
}
