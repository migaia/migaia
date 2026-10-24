import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { IAdapterMessageResource } from './message/types.js'
import {
  readAdapterMessagePreparation,
  createAdapterMessageHandshakeBudget
} from './message/resource.js'
import { RpcCapability } from '@migaia/rpc-contract'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '../core/typing.js'
import { createRpcError, RpcCoreErrorCode } from '../core/errors.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../remote/types.js'
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
export type IAdapterListenerService = Readonly<{ peer: IRuntimePeer; close(): Promise<void> }>

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
class AdapterListenerSession {
  /** Original options resource retained by this single adapter owner. */
  #options: IRuntimePeerOptions

  /** Original preparation resource retained by this single adapter owner. */
  #preparation: IRuntimePreparationContext | undefined

  /** Original channel resource retained by this single adapter owner. */
  #channel: IRemoteChannel

  /** Original signal resource retained by this single adapter owner. */
  #signal: IAbortSignal

  /** Original limits resource retained by this single adapter owner. */
  #limits: IRpcProviderLimits

  /** Original retainService resource retained by this single adapter owner. */
  #retainService: (service: IAdapterListenerService) => void

  /** Original customIdempotency resource retained by this single adapter owner. */
  #customIdempotency: IRpcIdempotencyConfig | undefined

  /** Only this exact constructed scope may contribute admission and authenticated principal policy. */
  #actualScope: IRuntimeProviderScope

  /** Preparation owns one original endpoint Promise rather than accepting an endpoint from a caller. */
  #preparing: Promise<IRemoteServeEndpoint> | undefined

  /** Native service shape validation observes this original unwrapped endpoint. */
  #bare: IRemoteServeEndpoint | undefined

  /** Actual Core drain/governor operations produce this one final provider resource. */
  #endpoint: IRemoteServeEndpoint | undefined

  /** Concurrent service consumers join the same canonical Peer preparation. */
  #peering: Promise<IAdapterListenerService> | undefined

  /** A frozen operation view has no constructor or setter that accepts caller context/endpoint DTOs. */
  #session: IAdapterListenerSession

  /** Frozen operation surface keeps the original transport/resource identity. */
  readonly value: IAdapterListenerSession
  /** Acquire resources and install native observers in the original construction order. */
  constructor(
    options: IRuntimePeerOptions,
    preparation: IRuntimePreparationContext | undefined,
    channel: IRemoteChannel,
    signal: IAbortSignal,
    scope: IRuntimeProviderScope,
    limits: IRpcProviderLimits,
    retainService: (service: IAdapterListenerService) => void,
    customIdempotency?: IRpcIdempotencyConfig
  ) {
    this.#options = options
    this.#preparation = preparation
    this.#channel = channel
    this.#signal = signal
    this.#limits = limits
    this.#retainService = retainService
    this.#customIdempotency = customIdempotency
    /** Validate genuine scope identity before retaining the admitted resource. */
    const actualScope = readRuntimeProviderScope(scope)

    if (!actualScope || runtimeConnectionPrincipal(this.#channel) === undefined) invalidResource()
    this.#actualScope = actualScope
    this.#session = AdapterListenerSession.#createView(this)

    this.value = this.#session
  }

  /** Create the original frozen view; ordinary methods keep their exact receiver guards. */
  static #createView(component: AdapterListenerSession): IAdapterListenerSession {
    return Object.freeze({
      prepare() {
        if (this !== component.#session) invalidResource()
        if (component.#preparing) return component.#preparing
        /**
         * Ordinary custom config stays unchanged; builtin policy derives only from actual
         * authentication.
         */
        const idempotency =
          component.#customIdempotency ??
          component.#actualScope.session(component.#channel, component.#limits).idempotency
        component.#preparing = prepareRuntimePeerEndpoint(
          component.#options,
          component.#channel,
          component.#signal,
          {
            idempotency,
            providerLimits: component.#limits
          },
          component.#channel.agreement.capabilities.includes(RpcCapability.generation)
            ? (component.#preparation?.providerAdmission ?? component.#actualScope.admission)
            : undefined,
          component.#preparation?.providerAdmissionRegistration
        )
        // The native consumer owns rejection; this observer only retains the exact successful resource.
        void component.#preparing.then(
          (prepared) => {
            component.#bare = prepared
          },
          () => undefined
        )
        return component.#preparing
      },
      attach(drain, governor) {
        if (this !== component.#session || !component.#bare) invalidResource()
        /** Exact factory identities exclude copied callbacks and another connection's governor. */
        const actualDrain = readAdapterBindingDrain(drain)
        /** The governor was constructed over this same physical connection. */
        const actualGovernor = readRuntimeProviderGovernor(governor)
        if (!actualDrain || !actualGovernor || actualGovernor.channel !== component.#channel)
          invalidResource()
        return (component.#endpoint ??= actualGovernor.governor.endpoint(
          actualDrain.wrap(component.#channel, component.#bare)
        ))
      },
      peer() {
        if (this !== component.#session || !component.#endpoint) invalidResource()
        if (component.#peering) return component.#peering
        /**
         * The original native session owns physical close; its callable Peer borrows the same
         * channel.
         */
        const { close: sessionOwnedClose, ...peerChannel } = component.#channel
        void sessionOwnedClose
        /** Feature snapshots are read at actual accept, through the genuine original Host operation. */
        const peerOptions: IRuntimePeerOptions = {
          ...component.#options,
          provide: component.#preparation?.readProvide?.() ?? component.#options.provide
        }
        component.#peering = withRuntimePreparationContext(
          peerOptions,
          {
            ...component.#preparation,
            connectionOrigin: () => ({
              kind: RuntimeSourceKind.listen,
              direction: RuntimeConnectionDirection.listen
            })
          },
          async () => {
            /** Core consumes only this operation's internally retained endpoint and Host state. */
            const peer = await createRuntimePeer(peerOptions, {
              channel: peerChannel,
              signal: component.#signal,
              endpoint: component.#endpoint,
              host: component.#preparation?.host
            })
            /**
             * Close is the original Peer operation, including its exact Promise and failure
             * identity.
             */
            const service = Object.freeze({ peer, close: peer.close })
            component.#retainService(service)
            return service
          }
        )
        return component.#peering
      }
    })
  }
}

/** Construct one genuine accepted-session owner with its original frozen operations. */
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
  return new AdapterListenerSession(
    options,
    preparation,
    channel,
    signal,
    scope,
    limits,
    retainService,
    customIdempotency
  ).value
}

/** Core-only construction retains genuine preparation without exporting a public context input. */
class AdapterListenerPreparation {
  /** Original options resource retained by this single adapter owner. */
  #options: IRuntimePeerOptions

  /** Original localOffer resource retained by this single adapter owner. */
  #localOffer: readonly string[]

  /** Original preparation resource retained by this single adapter owner. */
  #preparation: IRuntimePreparationContext | undefined

  /** Listener diagnostics keep the original options while selecting one default reporter. */
  #report

  /** Accepted sessions publish through the same event subscriber owner as other Runtime Peers. */
  #events

  /** Local registration summaries exist before any physical listener or accepted session. */
  #methods

  /** Use the original description grammar and local stream-proposal predicate unchanged. */
  #local

  /** Weak creation proof recognizes this assembly's services without tracking active membership. */
  #ownServices

  /** Every live membership read comes directly from the actual native owner's original collection. */
  #ownedService = (service: IAdapterListenerService): IAdapterListenerService => {
    if (!this.#ownServices.has(service)) invalidResource()
    return service
  }

  /** Public operations close over genuine state; no method can register an arbitrary peer/context. */
  #listener: IAdapterListenerPreparation

  /** Frozen operation surface keeps the original transport/resource identity. */
  readonly value: IAdapterListenerPreparation
  /** Acquire resources and install native observers in the original construction order. */
  constructor(
    options: IRuntimePeerOptions,
    localOffer: readonly string[],
    preparation: IRuntimePreparationContext | undefined
  ) {
    this.#options = options
    this.#localOffer = localOffer
    this.#preparation = preparation
    this.#report = this.#options.report ?? defaultRpcReporter
    this.#events = createRuntimeEventPublisher()
    this.#methods = compileRuntimeMethods(this.#options.provide, this.#options.contract)
    this.#local = normalizeRuntimeDescription({
      schemaVersion: RUNTIME_API_SCHEMA_VERSION,
      self: this.#options.self,
      methods: describeRuntimeMethods(
        this.#methods,
        this.#localOffer.includes(RpcCapability.stream)
      )
    })
    this.#ownServices = new WeakSet<object>()
    this.#listener = AdapterListenerPreparation.#createView(this)

    this.value = this.#listener
  }

  /** Create the original frozen view; ordinary methods keep their exact receiver guards. */
  static #createView(component: AdapterListenerPreparation): IAdapterListenerPreparation {
    return Object.freeze({
      messageSession: AdapterListenerPreparation.#messageSessionOperation(component),
      session(channel, signal, scope, limits, customIdempotency) {
        if (this !== component.#listener) invalidResource()
        return createListenerSession(
          component.#options,
          component.#preparation,
          channel,
          signal,
          scope,
          limits,
          (service) => {
            component.#ownServices.add(service)
          },
          customIdempotency
        )
      },
      open: AdapterListenerPreparation.#openOperation(component),
      publish(service) {
        if (this !== component.#listener) invalidResource()
        /** Exact service membership, not a copied Peer shape, determines this accepted readiness. */
        const peer = component.#ownedService(service).peer
        /** Host publication succeeds before standalone subscribers receive the same accepted fact. */
        const withdraw = component.#preparation?.publishPeer?.(peer) ?? (() => undefined)
        component.#events.publish(
          runtimeReadyEvent(component.#local.self.name, peer),
          component.#report
        )
        return withdraw
      }
    })
  }

  /** Preserve the original messageSession operation and its synchronous/async failure boundary. */
  static #messageSessionOperation(
    component: AdapterListenerPreparation
  ): IAdapterListenerPreparation['messageSession'] {
    return async function messageSession(this: IAdapterListenerPreparation, resource, opening) {
      if (this !== component.#listener || !readAdapterMessagePreparation(resource))
        invalidResource()
      /** Each accepted raw session starts one budget before its first identity operation. */
      const handshakeBudget = createAdapterMessageHandshakeBudget(
        opening.scheduler,
        component.#preparation?.connectTimeoutMs
      )
      try {
        /**
         * Existing initial input names the remote endpoint without changing the listener's local
         * identity.
         */
        const peerId =
          opening.peerId ??
          (await resource.exchangeIdentity(
            { self: component.#options.self!, capabilities: component.#localOffer },
            opening.signal,
            handshakeBudget
          ))
        /** Bilateral message control remains the same bounded owner used by every message adapter. */
        const channel = await resource.open({
          ...opening,
          peerId,
          offer: component.#localOffer,
          control: rpcMessageCapabilityControl,
          handshakeBudget
        })
        /** The listener's genuine preparation alone selects its provider snapshot and native origin. */
        const peerOptions: IRuntimePeerOptions = {
          ...component.#options,
          provide: component.#preparation?.readProvide?.() ?? component.#options.provide
        }
        const peer = await withRuntimePreparationContext(
          peerOptions,
          {
            ...component.#preparation,
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
              host: component.#preparation?.host,
              providerAdmission: component.#preparation?.providerAdmission,
              providerAdmissionRegistration: component.#preparation?.providerAdmissionRegistration
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
        component.#ownServices.add(service)
        return service
      } catch (primary) {
        try {
          await resource.close()
        } catch (cleanup) {
          try {
            component.#report(cleanup)
          } catch (failure) {
            hostRethrowReporter(failure, IpcReporterContext)
          }
        }
        throw primary
      }
    }
  }

  /** Preserve the original open operation and its synchronous/async failure boundary. */
  static #openOperation(
    component: AdapterListenerPreparation
  ): IAdapterListenerPreparation['open'] {
    return function open(this: IAdapterListenerPreparation, owner) {
      if (this !== component.#listener) invalidResource()
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
        return component.#ownedService(service).peer
      }
      /** Subscriber close does not replace the actual listener owner's cleanup Promise. */
      const close = (): Promise<void> => {
        component.#events.close()
        return owner.close()
      }
      /** Calls and streams retain the real accepted Peer Promise/iterator without async wrappers. */
      const peer: IRuntimePeer = Object.freeze({
        self: component.#options.self!,
        on: component.#events.on,
        request: (method, payload, callOptions) => current().request(method, payload, callOptions),
        notify: (method, payload, callOptions) => current().notify(method, payload, callOptions),
        stream: (method, payload, callOptions) => current().stream(method, payload, callOptions),
        group: (steps, callOptions) => current().group(steps, callOptions),
        outcome: (key) => current().outcome(key),
        describe: runtimeQuery(async () => {
          /** Original active services supply every connection, with no winner or duplicated index. */
          const details = await Promise.all(
            owner.services().map((service) => component.#ownedService(service).peer.describe())
          )
          return runtimeDetail(
            component.#local,
            details.length
              ? details.flatMap((detail) => detail.connections)
              : [
                  runtimeConnectionDetail(
                    {
                      localDescription: component.#local,
                      carrier: owner.carrier,
                      kind: RuntimeSourceKind.listen,
                      direction: RuntimeConnectionDirection.listen
                    },
                    owner.closed() ? RuntimeQueryStatus.closed : RuntimeQueryStatus.ready
                  )
                ],
            [],
            component.#methods.map((method) => method.name)
          )
        }),
        close,
        [Symbol.asyncDispose]: close
      })
      retainRuntimePeerSessions(peer, () =>
        owner.services().map((service) => component.#ownedService(service).peer)
      )
      return peer
    }
  }
}

/** Construct listener preparation over actual held Host state and native session ownership. */
export function createAdapterListenerPreparation(
  options: IRuntimePeerOptions,
  localOffer: readonly string[],
  preparation: IRuntimePreparationContext | undefined
): IAdapterListenerPreparation {
  return new AdapterListenerPreparation(options, localOffer, preparation).value
}
