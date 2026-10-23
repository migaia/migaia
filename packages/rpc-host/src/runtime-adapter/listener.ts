import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { IAdapterMessageResource } from './message/types.js'
import {
  readAdapterMessagePreparation,
  createAdapterMessageHandshakeBudget
} from './message/resource.js'
import { RpcCapability } from '@migaia/rpc-contract'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '../core/index.js'
import { createRpcError, RpcCoreErrorCode } from '../core/errors.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../remote/types.js'
import type { IRemoteServePluginHandle } from '../remote/serve-plugin.js'
import type { IRuntimePeer, IRuntimePeerOptions } from '../remote/runtime-api/peer.js'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  retainRuntimePeerSessions
} from '../remote/runtime-api/peer.js'
import type { IRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
import { withRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
import { compileRuntimeMethods } from '../remote/runtime-api/catalog.js'
import {
  describeRuntimeMethods,
  normalizeRuntimeDescription
} from '../remote/runtime-api/description.js'
import {
  runtimeQuery,
  runtimeDetail,
  runtimeConnectionDetail
} from '../remote/runtime-api/overview.js'
import {
  RuntimeSourceKind,
  RuntimeConnectionDirection,
  RuntimeQueryStatus,
  RUNTIME_API_SCHEMA_VERSION,
  RuntimeApiErrorText
} from '../remote/runtime-api/constants.js'
import { runtimeConnectionPrincipal } from './byte/connection-identity.js'
import type { IAdapterBindingDrain } from './binding.js'
import { readAdapterBindingDrain } from './binding.js'
import type { IRuntimeProviderScope } from './provider/scope.js'
import { readRuntimeProviderScope } from './provider/scope.js'
import type { IRuntimeProviderGovernor } from './provider/governor.js'
import { readRuntimeProviderGovernor } from './provider/governor.js'
import { createRuntimeEventPublisher, runtimeReadyEvent } from '../remote/runtime-api/events.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from './data.js'
import { defaultRpcReporter } from '../core/default-reporter.js'

/** The original session owner stores this actual callable Peer and closes its same resource. */
export type IAdapterListenerService = IRemoteServePluginHandle & Readonly<{ peer: IRuntimePeer }>

/** A held message session exposes retirement only from its exact constructed transport. */
export type IAdapterMessageListenerService = IAdapterListenerService &
  Readonly<{ closed(): boolean }>

/** Core retains the bare/final endpoint internally across native validation and session adoption. */
export type IAdapterListenerSession = Readonly<{
  /** Construct the session endpoint under its original connection/scope controls. */
  prepare(): Promise<IRemoteServeEndpoint>
  /** Attach original drain/governor operations to that prepared endpoint. */
  attach(drain: IAdapterBindingDrain, governor: IRuntimeProviderGovernor): IRemoteServeEndpoint
  /** Finish adoption and expose the actual callable Peer/service close handle. */
  peer(): Promise<IAdapterListenerService>
}>

/** The actual native owner remains the sole source of membership, ambiguity and close completion. */
export type IAdapterListenerOwner = Readonly<{
  readonly carrier: string
  current(): IAdapterListenerService | null | undefined
  services(): readonly IAdapterListenerService[]
  closed(): boolean
  close(): Promise<void>
}>

/** Listener operations accept held Core resources and ordinary policies, never preparation claims. */
export type IAdapterListenerPreparation = Readonly<{
  /** Raw message resources negotiate and construct their own Peer without accepting caller claims. */
  messageSession(
    resource: IAdapterMessageResource,
    options: Readonly<{ peerId?: string; scheduler: IScheduler; signal?: IAbortSignal }>
  ): Promise<IAdapterMessageListenerService>
  /** Prepare one accepted session using the caller's genuine shared scope and limits. */
  session(
    channel: IRemoteChannel,
    signal: IAbortSignal,
    scope: IRuntimeProviderScope,
    limits: IRpcProviderLimits,
    customIdempotency?: IRpcIdempotencyConfig
  ): IAdapterListenerSession
  /** Expose the listener owner's actual membership and terminal close operation. */
  open(owner: IAdapterListenerOwner): IRuntimePeer
  /** Publish one accepted service and return its exact membership remover. */
  publish(service: IAdapterListenerService): () => void
}>

/** Reject a copied operation/resource before it can supply another owner's internal facts. */
function invalidResource(): never {
  throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.peerInvalid)
}

/** Build the existing endpoint/Peer over one actual connection while retaining its own custody. */
function createListenerSession(
  options: IRuntimePeerOptions,
  preparation: IRuntimePreparationContext | undefined,
  channel: IRemoteChannel,
  signal: IAbortSignal,
  scope: IRuntimeProviderScope,
  limits: IRpcProviderLimits,
  retainService: (service: IAdapterListenerService) => void,
  customIdempotency?: IRpcIdempotencyConfig
): IAdapterListenerSession {
  /** Only this exact constructed scope may contribute admission and authenticated principal policy. */
  const actualScope = readRuntimeProviderScope(scope)
  if (!actualScope || runtimeConnectionPrincipal(channel) === undefined) invalidResource()
  /** Preparation owns one original endpoint Promise rather than accepting an endpoint from a caller. */
  let preparing: Promise<IRemoteServeEndpoint> | undefined
  /** Native service shape validation observes this original unwrapped endpoint. */
  let bare: IRemoteServeEndpoint | undefined
  /** Actual Core drain/governor operations produce this one final provider resource. */
  let endpoint: IRemoteServeEndpoint | undefined
  /** Concurrent service consumers join the same canonical Peer preparation. */
  let peering: Promise<IAdapterListenerService> | undefined

  /** A frozen operation view has no constructor or setter that accepts caller context/endpoint DTOs. */
  const session: IAdapterListenerSession = Object.freeze({
    prepare() {
      if (this !== session) invalidResource()
      if (preparing) return preparing
      /**
       * Ordinary custom config stays unchanged; builtin policy derives only from actual
       * authentication.
       */
      const idempotency = customIdempotency ?? actualScope.session(channel, limits).idempotency
      preparing = prepareRuntimePeerEndpoint(
        options,
        channel,
        signal,
        {
          idempotency,
          providerLimits: limits
        },
        channel.agreement.capabilities.includes(RpcCapability.generation)
          ? (preparation?.providerAdmission ?? actualScope.admission)
          : undefined,
        preparation?.providerAdmissionRegistration
      )
      // The native consumer owns rejection; this observer only retains the exact successful resource.
      void preparing.then(
        (prepared) => {
          bare = prepared
        },
        () => undefined
      )
      return preparing
    },
    attach(drain, governor) {
      if (this !== session || !bare) invalidResource()
      /** Exact factory identities exclude copied callbacks and another connection's governor. */
      const actualDrain = readAdapterBindingDrain(drain)
      /** The governor was constructed over this same physical connection. */
      const actualGovernor = readRuntimeProviderGovernor(governor)
      if (!actualDrain || !actualGovernor || actualGovernor.channel !== channel) invalidResource()
      return (endpoint ??= actualGovernor.governor.endpoint(actualDrain.wrap(channel, bare)))
    },
    peer() {
      if (this !== session || !endpoint) invalidResource()
      if (peering) return peering
      /**
       * The original native session owns physical close; its callable Peer borrows the same
       * channel.
       */
      const { close: sessionOwnedClose, ...peerChannel } = channel
      void sessionOwnedClose
      /** Feature snapshots are read at actual accept, through the genuine original Host operation. */
      const peerOptions: IRuntimePeerOptions = {
        ...options,
        provide: preparation?.readProvide?.() ?? options.provide
      }
      peering = withRuntimePreparationContext(
        peerOptions,
        {
          ...preparation,
          connectionOrigin: () => ({
            kind: RuntimeSourceKind.listen,
            direction: RuntimeConnectionDirection.listen
          })
        },
        async () => {
          /** Core consumes only this operation's internally retained endpoint and Host state. */
          const peer = await createRuntimePeer(peerOptions, {
            channel: peerChannel,
            signal,
            endpoint,
            host: preparation?.host
          })
          /** Close is the original Peer operation, including its exact Promise and failure identity. */
          const service = Object.freeze({ peer, close: peer.close })
          retainService(service)
          return service
        }
      )
      return peering
    }
  })
  return session
}

/** Core-only construction retains genuine preparation without exporting a public context input. */
export function createAdapterListenerPreparation(
  options: IRuntimePeerOptions,
  localOffer: readonly string[],
  preparation: IRuntimePreparationContext | undefined
): IAdapterListenerPreparation {
  /** Listener diagnostics keep the original options while selecting one default reporter. */
  const report = options.report ?? defaultRpcReporter
  /** Accepted sessions publish through the same event subscriber owner as other Runtime Peers. */
  const events = createRuntimeEventPublisher()
  /** Local registration summaries exist before any physical listener or accepted session. */
  const methods = compileRuntimeMethods(options.provide, options.contract)
  /** Use the original description grammar and local stream-proposal predicate unchanged. */
  const local = normalizeRuntimeDescription({
    schemaVersion: RUNTIME_API_SCHEMA_VERSION,
    self: options.self,
    methods: describeRuntimeMethods(methods, localOffer.includes(RpcCapability.stream))
  })
  /** Weak creation proof recognizes this assembly's services without tracking active membership. */
  const ownServices = new WeakSet<object>()
  /** Every live membership read comes directly from the actual native owner's original collection. */
  const ownedService = (service: IAdapterListenerService): IAdapterListenerService => {
    if (!ownServices.has(service)) invalidResource()
    return service
  }

  /** Public operations close over genuine state; no method can register an arbitrary peer/context. */
  const listener: IAdapterListenerPreparation = Object.freeze({
    async messageSession(resource, opening) {
      if (this !== listener || !readAdapterMessagePreparation(resource)) invalidResource()
      /** Each accepted raw session starts one budget before its first identity operation. */
      const handshakeBudget = createAdapterMessageHandshakeBudget(
        opening.scheduler,
        preparation?.connectTimeoutMs
      )
      try {
        /**
         * Existing initial input names the remote endpoint without changing the listener's local
         * identity.
         */
        const peerId =
          opening.peerId ??
          (await resource.exchangeIdentity(
            { self: options.self!, capabilities: localOffer },
            opening.signal,
            handshakeBudget
          ))
        /** Bilateral message control remains the same bounded owner used by every message adapter. */
        const channel = await resource.open({
          ...opening,
          peerId,
          offer: localOffer,
          control: rpcMessageCapabilityControl,
          handshakeBudget
        })
        /** The listener's genuine preparation alone selects its provider snapshot and native origin. */
        const peerOptions: IRuntimePeerOptions = {
          ...options,
          provide: preparation?.readProvide?.() ?? options.provide
        }
        const peer = await withRuntimePreparationContext(
          peerOptions,
          {
            ...preparation,
            connectionOrigin: () => ({
              carrier: channel.transport.platform,
              kind: RuntimeSourceKind.listen,
              direction: RuntimeConnectionDirection.listen
            })
          },
          () =>
            createRuntimePeer(peerOptions, {
              channel,
              signal: opening.signal,
              host: preparation?.host,
              providerAdmission: preparation?.providerAdmission,
              providerAdmissionRegistration: preparation?.providerAdmissionRegistration
            })
        )
        /**
         * Exact factory membership grants publication, while live membership stays with the
         * listener.
         */
        const service = Object.freeze({
          peer,
          close: peer.close,
          closed: () => channel.transport.closed === true
        })
        ownServices.add(service)
        return service
      } catch (primary) {
        try {
          await resource.close()
        } catch (cleanup) {
          try {
            report(cleanup)
          } catch (failure) {
            hostRethrowReporter(failure, IpcReporterContext)
          }
        }
        throw primary
      }
    },
    session(channel, signal, scope, limits, customIdempotency) {
      if (this !== listener) invalidResource()
      return createListenerSession(
        options,
        preparation,
        channel,
        signal,
        scope,
        limits,
        (service) => {
          ownServices.add(service)
        },
        customIdempotency
      )
    },
    open(owner) {
      if (this !== listener) invalidResource()
      /** Direct target selection preserves zero/one/many semantics from the actual original Set. */
      const current = (): IRuntimePeer => {
        /** Null identifies ambiguity; undefined identifies an absent live session, as before. */
        const service = owner.current()
        if (!service)
          throw createRpcError(
            service === null ? RpcCoreErrorCode.capabilityConflict : RpcCoreErrorCode.targetUnknown,
            service === null
              ? RuntimeApiErrorText.targetAmbiguous
              : RuntimeApiErrorText.targetUnknown
          )
        return ownedService(service).peer
      }
      /** Subscriber close does not replace the actual listener owner's cleanup Promise. */
      const close = (): Promise<void> => {
        events.close()
        return owner.close()
      }
      /** Calls and streams retain the real accepted Peer Promise/iterator without async wrappers. */
      const peer: IRuntimePeer = Object.freeze({
        self: options.self!,
        on: events.on,
        request: (method, payload, callOptions) => current().request(method, payload, callOptions),
        notify: (method, payload, callOptions) => current().notify(method, payload, callOptions),
        stream: (method, payload, callOptions) => current().stream(method, payload, callOptions),
        group: (steps, callOptions) => current().group(steps, callOptions),
        outcome: (key) => current().outcome(key),
        describe: runtimeQuery(async () => {
          /** Original active services supply every connection, with no winner or duplicated index. */
          const details = await Promise.all(
            owner.services().map((service) => ownedService(service).peer.describe())
          )
          return runtimeDetail(
            local,
            details.length
              ? details.flatMap((detail) => detail.connections)
              : [
                  runtimeConnectionDetail(
                    {
                      localDescription: local,
                      carrier: owner.carrier,
                      kind: RuntimeSourceKind.listen,
                      direction: RuntimeConnectionDirection.listen
                    },
                    owner.closed() ? RuntimeQueryStatus.closed : RuntimeQueryStatus.ready
                  )
                ],
            [],
            methods.map((method) => method.name)
          )
        }),
        close,
        [Symbol.asyncDispose]: close
      })
      retainRuntimePeerSessions(peer, () =>
        owner.services().map((service) => ownedService(service).peer)
      )
      return peer
    },
    publish(service) {
      if (this !== listener) invalidResource()
      /** Exact service membership, not a copied Peer shape, determines this accepted readiness. */
      const peer = ownedService(service).peer
      /** Host publication succeeds before standalone subscribers receive the same accepted fact. */
      const withdraw = preparation?.publishPeer?.(peer) ?? (() => undefined)
      events.publish(runtimeReadyEvent(local.self.name, peer), report)
      return withdraw
    }
  })
  return listener
}
