import type { IScheduler } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/lifecycle'
import type { IRpcHandshakeOffer } from '@migaia/rpc-contract'
import type { IRpcIdempotencyStore } from '../core/idempotency-store.js'
import type { IRuntimePeer, IRuntimePeerOptions } from '../remote/runtime-api/peer.js'
import type { IRuntimeTypedPeer, IRuntimePluginTyping } from '../remote/runtime-api/typing.js'
import type { IRuntimePeerProvide, IRuntimePeerSourceContext } from '../remote/runtime-api/peer.js'
import type { IRuntimePluginOptions, createRuntimePlugin } from '../remote/runtime-api/plugin.js'
import type { IAdapterPeerOptions, IAdapterPeerPreparation } from './peer.js'
import type { IAdapterBytePeerOptions } from './byte/peer.js'
import type {
  IRuntimeByteIO,
  IRuntimeByteDiagnostics,
  IRuntimeConnectionOptions,
  IRuntimeByteOptions
} from './byte/types.js'
import type {
  IAdapterEventEmitterMessagePort,
  IAdapterEventTargetMessagePort,
  IAdapterInitialMessageResource,
  IAdapterLaunchHandle,
  IAdapterMessageResource
} from './message/types.js'
import type { IRuntimeProviderPolicy } from './provider/governor.js'
import type { IRuntimeProviderScope } from './provider/scope.js'

/** Authors return actual messaging operations; no accepted channel or trust description is an input. */
export type IMessageAdapterPort = IAdapterEventEmitterMessagePort | IAdapterEventTargetMessagePort

/** Optional launching returns the same actual port and native lifetime operations held by Core. */
export type IMessageAdapterLaunch = IAdapterLaunchHandle & Readonly<{ port: IMessageAdapterPort }>

/** A physical runtime supplies only raw messaging and its optional original launch operation. */
export type IMessageAdapterOptions<TInput> = Readonly<{
  open(input: TInput): IMessageAdapterPort | Promise<IMessageAdapterPort>
  launch?(input: TInput, context: IRuntimePeerSourceContext): Promise<IMessageAdapterLaunch>
}>

/** Byte authors retain physical opening; the existing Core owner performs all native wire control. */
export type IByteAdapterOptions<TInput> = Readonly<{
  open(input: TInput): IRuntimeByteIO | Promise<IRuntimeByteIO>
  listen?(input: TInput): IRuntimeByteIO | Promise<IRuntimeByteIO>
  dial?(input: TInput): IRuntimeByteIO | Promise<IRuntimeByteIO>
  diagnostics?: IRuntimeByteDiagnostics
  presentation?: Pick<IRuntimeConnectionOptions, 'platform' | 'expectedStringText'>
}>

/** Deployment values select physical I/O; credentials and offers remain ordinary local proposals. */
export type IAdapterDefinitionPeerOptions<TInput> = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect' | 'listen'
> &
  Readonly<{
    spawn?: TInput
    connect?: TInput
    listen?: TInput
    /** Message adapters may omit this address and learn it from the existing raw initial exchange. */
    peerId?: string
    /** Caller cancellation retires this physical opening and its original directory handshake. */
    signal?: IAbortSignal
    scheduler?: IScheduler
    offer?: IRpcHandshakeOffer
    auth?: Extract<IRuntimeByteOptions, { role: 'responder' }>['auth']
    ipc?: IRuntimeConnectionOptions['ipc']
    /** The canonical per-connection governor owns quotas and idle retirement. */
    governor?: IRuntimeProviderPolicy
    /** A factory-created scope is borrowed; its caller closes it after all of its peers close. */
    scope?: IRuntimeProviderScope
  }>

/** Plugins use the same physical input grammar and the original Host method whitelist. */
export type IAdapterDefinitionPluginOptions<TInput> = IRuntimePluginOptions<
  TInput,
  TInput,
  TInput
> &
  Pick<
    IAdapterDefinitionPeerOptions<TInput>,
    'peerId' | 'scheduler' | 'offer' | 'auth' | 'ipc' | 'governor' | 'scope'
  >

/** Two task operations construct actual symmetric Peers and genuine Host Plugins. */
export type IAdapterDefinition<
  TInput,
  TKey extends 'process' | 'thread' = 'process' | 'thread'
> = Readonly<{
  peer<TRemote = never>(
    options: IAdapterDefinitionPeerOptions<TInput>
  ): Promise<[TRemote] extends [never] ? IRuntimePeer : IRuntimeTypedPeer<TRemote>>
  plugin<
    TRemote = Record<never, never>,
    const TProvide extends IRuntimePeerProvide = Record<never, never>,
    const TName extends string = string,
    const TExpose extends readonly string[] = readonly []
  >(
    options: Omit<IAdapterDefinitionPluginOptions<TInput>, 'provide' | 'name' | 'expose'> &
      Readonly<{ provide?: TProvide; name: TName; expose?: TExpose }>
  ): ReturnType<typeof createRuntimePlugin> &
    IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, TKey>
  /** Create the existing shared admission/store scope; callers retain its disposal ownership. */
  scope(store?: IRpcIdempotencyStore): IRuntimeProviderScope
}>

/** Native adapters retain complex real bindings while all final assembly uses one captured owner. */
export type IAdapterTask<TInput> = Readonly<{
  preparation: IAdapterPeerPreparation
  managed: IAdapterPeerPreparation['managed']
  listener: IAdapterPeerPreparation['listener']
  resourcePeer(
    options: IRuntimePeerOptions,
    resource: IAdapterMessageResource
  ): Promise<IRuntimePeer>
  messagePeer(
    options: IRuntimePeerOptions,
    input: TInput,
    initial?: IAdapterInitialMessageResource
  ): Promise<IRuntimePeer>
  bytePeer(
    options: IRuntimePeerOptions,
    input: TInput,
    local: IAdapterBytePeerOptions
  ): Promise<IRuntimePeer>
}>

/** Original options remain the exact Host provenance carrier before any native load or option copy. */
export type IAdapterTaskOptions = IAdapterPeerOptions
