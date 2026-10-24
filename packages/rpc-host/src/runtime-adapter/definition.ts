import { identifyRpcBoundaryFailure } from '../core/errors.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { RpcCodecId, RpcProtocol } from '@migaia/rpc-contract'
import {
  type IRuntimePeerOptions,
  type IRuntimePeerSourceContext,
  type IRuntimePeerSourceResult
} from '../remote/runtime-api/peer.js'
import { RuntimePluginKey } from '../remote/runtime-api/constants.js'
import { readRuntimePreparationContext } from '../remote/runtime-api/launch-context.js'
import {
  createAdapterSourceConfigurationError,
  createAdapterConfigurationTypeError,
  createAdapterId
} from './data.js'
import {
  createEventEmitterMessageResource,
  createEventTargetMessageResource,
  ownAdapterMessageClose,
  createAdapterMessageHandshakeBudget
} from './message/resource.js'
import type { IAdapterMessageResource, IAdapterLaunchHandle } from './message/types.js'
import { createRuntimeByteConnection } from './byte/handshake.js'
import { RpcPlatform } from '../core/transport-constants.js'
import { ERROR_SOURCE, RpcCoreErrorCode } from '../core/error-code.js'
import {
  createRuntimeProviderGovernor,
  type IRuntimeProviderGovernor
} from './provider/governor.js'
import { createRuntimeProviderScope, readRuntimeProviderScope } from './provider/scope.js'
import { RuntimeAdapterErrorText } from './byte/error-text.js'
import { AdapterDefinitionText } from './definition-text.js'
import type {
  IMessageAdapterOptions,
  IByteAdapterOptions,
  IAdapterDefinition,
  IAdapterDefinitionPeerOptions,
  IMessageAdapterPort,
  IMessageAdapterLaunch
} from './definition-types.js'
import type { IRuntimeByteDiagnostics } from './byte/types.js'
import type { IRpcIdempotencyStore } from '../core/idempotency-store.js'
import type { IRemoteChannel } from '../remote/types.js'
import { hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import { IpcReporterContext } from './data.js'
import {
  createAdapterDeployment,
  type IAdapterDeployment,
  type IAdapterDeploymentContext
} from './deployment.js'

/**
 * Definition identity retains physical operations without accepting an external Peer/channel
 * recipe.
 */
type IRecipe = (
  | Readonly<{ kind: 'message'; options: IMessageAdapterOptions<unknown> }>
  | Readonly<{ kind: 'byte'; options: IByteAdapterOptions<unknown> }>
) &
  Readonly<{ family?: object }>

/** Only the actual factory result selects its private raw-I/O recipe. */
const recipes = new WeakMap<object, IRecipe>()

/** Existing Core categories cover generic transport, deadline and verifier failures. */
const byteDiagnostics: IRuntimeByteDiagnostics = Object.freeze({
  closed: {
    source: ERROR_SOURCE,
    code: RpcCoreErrorCode.transport,
    message: AdapterDefinitionText.byteClosed
  },
  timeout: {
    source: ERROR_SOURCE,
    code: RpcCoreErrorCode.deadlineExceeded,
    message: AdapterDefinitionText.handshakeTimeout
  },
  authenticationRejected: {
    source: ERROR_SOURCE,
    code: RpcCoreErrorCode.authenticationFailed,
    message: AdapterDefinitionText.authenticationRejected
  },
  duplicateBinding: AdapterDefinitionText.duplicateBinding,
  optionsInvalid: AdapterDefinitionText.optionsInvalid,
  jsonCodecRequired: AdapterDefinitionText.jsonCodecRequired,
  negotiatedCodecUnsupported: AdapterDefinitionText.negotiatedCodecUnsupported,
  handshakeTimeoutInvalid: AdapterDefinitionText.handshakeTimeoutInvalid
})

/** Only raw messaging shape chooses an existing resource constructor; no runtime detection occurs. */
function holdMessagePort(
  port: IMessageAdapterPort,
  launch?: IAdapterLaunchHandle
): IAdapterMessageResource {
  return 'on' in port
    ? createEventEmitterMessageResource(port, launch)
    : createEventTargetMessageResource(port, launch)
}

/** Copied definition methods cannot select a private construction or supply Host provenance. */
function readRecipe(definition: object): IRecipe {
  /** Exact membership concerns the definition's own raw operations, never a caller trust claim. */
  const recipe = recipes.get(definition)
  if (!recipe) throw createAdapterSourceConfigurationError()
  return recipe
}

/** Secondary physical cleanup is reported without replacing the construction's exact primary error. */
async function closeAfterFailure(
  resource: Readonly<{ close(): void | Promise<void> }>,
  primary: unknown,
  report: (error: unknown) => void
): Promise<never> {
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

/** One cold deployment receipt owns its original physical cleanup Promise cache. */
class ColdSourceClose {
  /** The held physical resource retains its original receiver and native cleanup semantics. */
  #resource: Readonly<{ close(): void | Promise<void> }>
  /** Host rollback and endpoint disposal share this exact original cleanup result. */
  #closing: Promise<void> | undefined

  /** Retain the already-open physical resource without closing or copying its native state. */
  constructor(resource: Readonly<{ close(): void | Promise<void> }>) {
    this.#resource = resource
  }

  /** Cache synchronous throws as rejected Promises exactly at the original first close call. */
  close = (): Promise<void> => {
    if (this.#closing) return this.#closing
    try {
      this.#closing = Promise.resolve(this.#resource.close())
    } catch (error) {
      this.#closing = Promise.reject(error)
    }
    return this.#closing
  }
}

/**
 * Raw opening retains the original message/byte owner while callers attach existing endpoint
 * policy.
 */
type IDefinitionSourceControls = Readonly<{
  signal?: IAbortSignal
  messageSignal?: IAbortSignal
  connectTimeoutMs?: number
  report(error: unknown): void
  /** The actual Host delegates registration to its one existing endpoint resource scope. */
  ownClose?: IAdapterDeploymentContext['ownClose']
  onGovernor?(channel: IRemoteChannel, governor: IRuntimeProviderGovernor): void
}>

/** Open the one canonical physical channel without constructing an endpoint or callable Peer. */
async function openDefinitionSource<TInput>(
  recipe: IRecipe,
  options: IAdapterDefinitionPeerOptions<TInput>,
  original: IRuntimePeerOptions,
  sourceContext: IRuntimePeerSourceContext,
  controls: IDefinitionSourceControls
): Promise<IRuntimePeerSourceResult> {
  /** Physical family labels stay with the same raw recipe selected by the original definition. */
  const key = recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process
  /** The source input remains the value selected by the original mutually exclusive source grammar. */
  const input = (original.spawn ?? original.connect ?? original.listen) as TInput
  /** Physical timers borrow the caller's original scheduler. */
  const scheduler = options.scheduler ?? systemScheduler
  if (recipe.kind === 'message') {
    /** Optional launch returns physical lifetime operations; supervision remains with that owner. */
    let launched: IMessageAdapterLaunch | undefined
    if (original.spawn !== undefined) {
      if (!recipe.options.launch) throw createAdapterSourceConfigurationError()
      launched = await recipe.options.launch(input, sourceContext)
    }
    /** The held resource owns cold receive capture and any actual launched unit. */
    const resource = holdMessagePort(launched?.port ?? (await recipe.options.open(input)), launched)
    if (launched) ownAdapterMessageClose(resource)
    /** Local rollback and native Host disposal observe the exact same cold-source close result. */
    const rollback = controls.ownClose ? { close: new ColdSourceClose(resource).close } : resource
    try {
      controls.ownClose?.(rollback.close)
      /** One original preparation budget covers both identity capture and ACK negotiation. */
      const handshakeBudget = createAdapterMessageHandshakeBudget(
        scheduler,
        controls.connectTimeoutMs
      )
      /** Unknown message addresses come only from this resource's existing initial control input. */
      const peerId =
        options.peerId ??
        (await resource.exchangeIdentity(sourceContext, controls.messageSignal, handshakeBudget))
      /** Accepted capability facts come only from the original ACK owner on this held port. */
      const channel = await resource.open({
        peerId,
        scheduler,
        offer: sourceContext.capabilities,
        control: rpcMessageCapabilityControl,
        signal: controls.messageSignal,
        handshakeBudget
      })
      if (options.governor) {
        /** The existing governor retains connection-local quota and idle retirement ownership. */
        const governor = createRuntimeProviderGovernor(
          channel,
          options.governor,
          () => resource.close(),
          controls.report
        )
        controls.onGovernor?.(channel, governor)
        ownAdapterMessageClose(channel, { close: () => governor!.close() })
      }
      return channel
    } catch (error) {
      return closeAfterFailure(rollback, error, controls.report)
    }
  }
  /** Native byte hello/auth admission is the existing canonical owner, never another handshake. */
  if (options.peerId === undefined) throw createAdapterSourceConfigurationError()
  /** The raw byte operation follows the existing listener/dial/open precedence. */
  const opening =
    original.listen !== undefined
      ? recipe.options.listen
      : original.connect !== undefined
        ? (recipe.options.dial ?? recipe.options.open)
        : recipe.options.open
  if (!opening) throw createAdapterSourceConfigurationError()
  if (controls.signal?.aborted)
    throw identifyRpcBoundaryFailure(
      resolveAbortReason(controls.signal),
      RpcCoreErrorCode.cancelled,
      RpcCoreErrorText.webRPCRequestCancelled
    )
  /** Only the selected source acquires this actual physical byte stream. */
  const byte = await opening(input)
  /** Diagnostic correlation remains local and does not add authority to the accepted channel. */
  const ipc = options.ipc ?? {
    connectionId: createAdapterId(),
    sessionId: createAdapterId(),
    log: () => undefined
  }
  /** Caller proposals remain subject to the same canonical byte negotiation. */
  const offer = options.offer ?? {
    versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
    codecs: [RpcCodecId.json],
    capabilities: sourceContext.capabilities,
    peer: { id: sourceContext.self.instanceId, runtime: key }
  }
  /** The SDK budget reaches the existing byte handshake timer without a second deadline owner. */
  const common = {
    ...(recipe.options.presentation ?? {
      platform: RpcPlatform.process,
      expectedStringText: AdapterDefinitionText.expectedString
    }),
    peerId: options.peerId,
    scheduler,
    report: controls.report,
    ipc,
    signal: controls.signal,
    handshakeTimeoutMs: controls.connectTimeoutMs
  }
  /** The original byte owner authenticates the remote before exposing a source result. */
  const connection = await createRuntimeByteConnection(
    byte,
    original.listen !== undefined
      ? { ...common, role: 'responder', offer, auth: options.auth ?? { mode: 'none' } }
      : { ...common, role: 'initiator', offer },
    recipe.options.diagnostics ?? byteDiagnostics
  )
  /** Native byte cleanup uses the same cold receipt instead of another resource lifecycle. */
  const rollback = controls.ownClose ? { close: new ColdSourceClose(connection).close } : connection
  try {
    controls.ownClose?.(rollback.close)
    if (options.governor) {
      /** This exact constructed connection is the governor's sole physical resource. */
      const governor = createRuntimeProviderGovernor(
        connection,
        options.governor,
        connection.close,
        controls.report
      )
      controls.onGovernor?.(connection, governor)
      connection.ownClose({ close: () => governor!.close() })
    }
    return connection
  } catch (error) {
    return closeAfterFailure(rollback, error, controls.report)
  }
}

/** One cold source recipe owns physical governor receipts and borrowed provider policy. */
class DefinitionDeployment<TInput> {
  /** The exact raw definition selects its private physical operations. */
  #recipe: IRecipe
  /** The original captured options remain immutable across later installations. */
  #captured: IAdapterDefinitionPeerOptions<TInput>
  /** Every installation retains the one original physical family token. */
  #family: object
  /** The borrowed shared scope remains owned by its original caller. */
  #scope: ReturnType<typeof readRuntimeProviderScope>
  /** Actual native Host provenance remains associated with the original options identity. */
  #provenance: ReturnType<typeof readRuntimePreparationContext>
  /** Weak receipts associate existing governors with exact channels without owning their lifetime. */
  #governors = new WeakMap<IRemoteChannel, IRuntimeProviderGovernor>()

  /** Validate and capture physical configuration before any native resource is acquired. */
  constructor(
    definition: IAdapterDefinition<TInput>,
    options: IAdapterDefinitionPeerOptions<TInput>,
    family: object
  ) {
    this.#recipe = readRecipe(definition)
    this.#captured = Object.freeze({ ...options })
    this.#family = family
    /** Existing raw source exclusivity is checked before physical acquisition. */
    const sources = [this.#captured.spawn, this.#captured.connect, this.#captured.listen].filter(
      (source) => source !== undefined
    )
    if (sources.length > 1) throw createAdapterSourceConfigurationError()
    this.#scope = this.#captured.scope && readRuntimeProviderScope(this.#captured.scope)
    if (this.#captured.scope && !this.#scope)
      throw createAdapterConfigurationTypeError(RuntimeAdapterErrorText.connectionRequired)
    this.#provenance = readRuntimePreparationContext(options)
  }

  /** Mint the actual existing cold deployment; no endpoint or callable Peer is constructed here. */
  deployment(): IAdapterDeployment {
    return createAdapterDeployment({
      runtimeKey:
        this.#recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process,
      runtimeFamily: this.#family,
      runtimeOptions: {
        self: this.#captured.self,
        provide: this.#captured.provide,
        probe: this.#captured.probe,
        providerLimits: this.#captured.providerLimits,
        authentication: this.#captured.authentication,
        defaultTimeoutMs: this.#captured.defaultTimeoutMs,
        contract: this.#captured.contract,
        keyFactory: this.#captured.keyFactory,
        retryPort: this.#captured.retryPort,
        report: this.#captured.report
      },
      open: this.#open,
      prepareEndpoint: this.#prepareEndpoint
    })
  }

  /** Open only the selected raw source through the same canonical protocol and resource owners. */
  #open = (context: IAdapterDeploymentContext): Promise<IRuntimePeerSourceResult> =>
    openDefinitionSource(
      this.#recipe,
      this.#captured,
      this.#captured as IRuntimePeerOptions,
      context,
      {
        signal: context.signal ?? this.#captured.signal,
        messageSignal: context.signal ?? this.#captured.signal,
        connectTimeoutMs: context.connectTimeoutMs ?? this.#provenance?.connectTimeoutMs,
        report: context.report,
        ownClose: context.ownClose,
        onGovernor: (channel, governor) => {
          this.#governors.set(channel, governor)
        }
      }
    )

  /** Derive provider policy only from this exact channel's original governor and borrowed scope. */
  #prepareEndpoint: NonNullable<Parameters<typeof createAdapterDeployment>[0]['prepareEndpoint']> =
    (channel, providerLimits) => {
      /** The host's explicit provider selection wins over the cold source's inherited selection. */
      const configured = providerLimits ?? this.#captured.providerLimits
      /** Governor policy remains enforced by its original existing provider wrapper. */
      const governor = this.#governors.get(channel)
      /** Quota observers attach once at the same preparation point as the legacy Peer path. */
      const limits = governor
        ? governor.limits(configured ?? {}, this.#captured.providerLimits)
        : configured
      /**
       * The authenticated this.#scope derives its original store/key once for this physical
       * channel.
       */
      const idempotency = this.#scope?.session(channel, limits ?? {}).idempotency
      /**
       * Host reservation stages the same policy; candidate failure cannot tighten a live
       * this.#scope.
       */
      const registration = this.#provenance?.providerAdmissionRegistration
      registration?.stagePolicy(limits?.maxGlobal, limits?.maxPerPeer)
      /** Borrow only an explicitly held original quota resource; ordinary sessions allocate none. */
      const providerAdmission = this.#provenance?.providerAdmission ?? this.#scope?.admission
      return {
        policy: {
          ...(limits === undefined ? {} : { providerLimits: limits }),
          ...(idempotency === undefined ? {} : { idempotency })
        },
        execution: {
          providerAdmission,
          ...(registration ? { commitPolicy: () => registration.isCommitted() } : {}),
          limits,
          idempotency,
          ...(governor ? { provider: governor.provider, enterStream: governor.enterStream } : {})
        },
        providerAdmission,
        providerAdmissionRegistration: this.#provenance?.providerAdmissionRegistration,
        ...(governor ? { wrapEndpoint: (endpoint) => governor.endpoint(endpoint) } : {})
      }
    }
}

/** Capture one real raw source context without introducing another assembly or provider owner. */
function captureDefinitionDeployment<TInput>(
  definition: IAdapterDefinition<TInput>,
  options: IAdapterDefinitionPeerOptions<TInput>,
  family: object
): IAdapterDeployment {
  return new DefinitionDeployment(definition, options, family).deployment()
}

/** The definition holds only a cold source recipe and its existing shared admission scope. */
function defineAdapter<TInput>(recipe: IRecipe): IAdapterDefinition<TInput> {
  /** A stable physical family token belongs to this definition alone, never a caller object. */
  const family = Object.freeze({})
  /** Both operations resolve the same canonical raw recipe registered after construction. */
  const definition: IAdapterDefinition<TInput> = Object.freeze({
    deployment: (options: IAdapterDefinitionPeerOptions<TInput>) =>
      captureDefinitionDeployment(definition, options, family),
    scope: (store?: IRpcIdempotencyStore) => createRuntimeProviderScope(store)
  })
  recipes.set(definition, { ...recipe, family })
  return definition
}

/**
 * Define actual raw messaging operations. Host installation retains bounded ACK, directory and
 * resource ownership; launching remains an operation of the physical runtime.
 */
export function defineMessageAdapter<TInput>(
  options: IMessageAdapterOptions<TInput>
): IAdapterDefinition<TInput, 'thread'> {
  return defineAdapter<TInput>({
    kind: 'message',
    options: options as IMessageAdapterOptions<unknown>
  }) as IAdapterDefinition<TInput, 'thread'>
}

/**
 * Define an ordered-byte adapter. Opening, listening and dialing obtain only actual physical I/O;
 * the canonical byte owner performs handshake, framing, authentication, cleanup and provenance.
 */
export function defineByteAdapter<TInput>(
  options: IByteAdapterOptions<TInput>
): IAdapterDefinition<TInput, 'process'> {
  return defineAdapter<TInput>({
    kind: 'byte',
    options: options as IByteAdapterOptions<unknown>
  }) as IAdapterDefinition<TInput, 'process'>
}
