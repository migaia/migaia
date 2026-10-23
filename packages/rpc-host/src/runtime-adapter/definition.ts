import { identifyRpcBoundaryFailure } from '../core/errors.js'
import { RpcCoreErrorText } from '../core/error-text.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { RpcCodecId, RpcProtocol } from '@migaia/rpc-contract'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  type IRuntimePeerOptions,
  type IRuntimePeer,
  type IRuntimePeerSourceContext,
  type IRuntimePeerSourceResult
} from '../remote/runtime-api/peer.js'
import { createRuntimePlugin, type IRuntimePluginOptions } from '../remote/runtime-api/plugin.js'
import type {
  IRuntimeFlatten,
  IRuntimeTypedPeer,
  IRuntimePluginTyping
} from '../remote/runtime-api/typing.js'
import type { IRuntimePeerProvide } from '../remote/runtime-api/catalog.js'
import { RuntimePluginKey } from '../remote/runtime-api/constants.js'
import {
  readRuntimePreparationContext,
  withRuntimePreparationContext
} from '../remote/runtime-api/launch-context.js'
import { assertRuntimeTransferDisabled } from '../core/internal/runtime-call-options.js'
import { prepareAdapterPeer } from './peer.js'
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
  IAdapterDefinitionPluginOptions,
  IAdapterTask,
  IAdapterTaskOptions,
  IMessageAdapterPort,
  IMessageAdapterLaunch
} from './definition-types.js'
import type { IRuntimeByteDiagnostics } from './byte/types.js'
import type { IRpcIdempotencyStore } from '../core/idempotency-store.js'
import type { IAdapterInitialMessageResource } from './message/types.js'
import type { IRemoteChannel } from '../remote/types.js'
import { hostRethrowReporter, type IAbortSignal } from '@migaia/utils/promise'
import { IpcReporterContext } from './data.js'
import { defaultRpcReporter } from '../core/default-reporter.js'
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

/** Synchronous native opening keeps its original assembly Promise; async physical opening is joined. */
function useOpened<T>(
  value: T | Promise<T>,
  prepare: (opened: T) => Promise<IRuntimePeer>
): Promise<IRuntimePeer> {
  return typeof (value as Promise<T>).then === 'function'
    ? Promise.resolve(value).then(prepare)
    : prepare(value as T)
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

/** Cold Host rollback and endpoint disposal join one close operation on the same held resource. */
function coldSourceClose(
  resource: Readonly<{ close(): void | Promise<void> }>
): () => Promise<void> {
  /** Only cold deployment receipts cache cleanup; private Peer resources retain their own API. */
  let closing: Promise<void> | undefined
  return () => {
    if (closing) return closing
    try {
      closing = Promise.resolve(resource.close())
    } catch (error) {
      closing = Promise.reject(error)
    }
    return closing
  }
}

/**
 * Capture original options once before native loading. Native source owners may keep their existing
 * real managed/listener recipes; automatic tasks open actual raw I/O and complete Core assembly.
 */
export function captureAdapterTask<TInput>(
  definition: IAdapterDefinition<TInput>,
  options: IAdapterTaskOptions,
  defaultName: string,
  selectedSelf?: import('../remote/runtime-api/peer.js').IRuntimePeerIdentity
): IAdapterTask<TInput> {
  /** A definition only selects its raw recipe; the original options select genuine Host provenance. */
  const recipe = readRecipe(definition)
  /** Byte recipes retain the same transfer prohibition across all native source shapes. */
  const prepared = prepareAdapterPeer(options, defaultName, selectedSelf)
  const preparation = recipe.kind === 'byte' ? prepared.withoutTransfer() : prepared
  return Object.freeze({
    preparation,
    managed: <TUnit, TSpec>(...args: Parameters<typeof preparation.managed<TUnit, TSpec>>) =>
      preparation.managed<TUnit, TSpec>(...args),
    listener: (offer: readonly string[]) => preparation.listener(offer),
    resourcePeer: (peerOptions: IRuntimePeerOptions, resource: IAdapterMessageResource) =>
      preparation.peer(peerOptions, resource),
    messagePeer(
      peerOptions: IRuntimePeerOptions,
      input: TInput,
      initial?: IAdapterInitialMessageResource
    ) {
      if (recipe.kind !== 'message') throw createAdapterSourceConfigurationError()
      /** A real raw opening feeds the same constructor used by native Thread channels. */
      return useOpened(recipe.options.open(input), (port) => {
        const resource = holdMessagePort(port)
        if (initial) resource.receiveInitial(initial)
        return preparation.peer(peerOptions, resource)
      })
    },
    bytePeer(
      peerOptions: IRuntimePeerOptions,
      input: TInput,
      local: import('./byte/peer.js').IAdapterBytePeerOptions
    ) {
      if (recipe.kind !== 'byte') throw createAdapterSourceConfigurationError()
      /** Core's existing private first-frame snapshot must belong to this exact returned byte I/O. */
      return useOpened(recipe.options.open(input), (byte) =>
        preparation.bytePeer(peerOptions, byte, local)
      )
    }
  })
}

/** Native Plugins keep their original slot family and public source grammar through one assembler. */
export function assembleAdapterPlugin<TInput, TSpawn, TConnect, TListen>(
  definition: IAdapterDefinition<TInput>,
  options: IRuntimePluginOptions<TSpawn, TConnect, TListen>,
  slot: Parameters<typeof createRuntimePlugin>[1],
  createPeer: NonNullable<Parameters<typeof createRuntimePlugin>[2]>
) {
  readRecipe(definition)
  return createRuntimePlugin(options, slot, createPeer)
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
    const rollback = controls.ownClose ? { close: coldSourceClose(resource) } : resource
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
  const rollback = controls.ownClose ? { close: coldSourceClose(connection) } : connection
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

/** Capture a cold source recipe; each installation still opens a separate canonical raw resource. */
function captureDefinitionDeployment<TInput>(
  definition: IAdapterDefinition<TInput>,
  options: IAdapterDefinitionPeerOptions<TInput>,
  family: object
): IAdapterDeployment {
  /** Only this exact raw definition can select the private physical operations. */
  const recipe = readRecipe(definition)
  /** Configuration is captured before the returned token may be installed into another Host. */
  const captured = Object.freeze({ ...options })
  /** Existing raw-source exclusivity is checked before physical acquisition. */
  const sources = [captured.spawn, captured.connect, captured.listen].filter(
    (source) => source !== undefined
  )
  if (sources.length > 1) throw createAdapterSourceConfigurationError()
  /** Shared scope identity remains canonical and borrowed; the deployment never closes it. */
  const scope = captured.scope && readRuntimeProviderScope(captured.scope)
  if (captured.scope && !scope)
    throw createAdapterConfigurationTypeError(RuntimeAdapterErrorText.connectionRequired)
  /** Actual native Host provenance is retained only when the original options already carry it. */
  const provenance = readRuntimePreparationContext(options)
  /** Weak receipts associate existing governors with actual returned channels without owning them. */
  const governors = new WeakMap<IRemoteChannel, IRuntimeProviderGovernor>()
  return createAdapterDeployment({
    runtimeKey: recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process,
    runtimeFamily: family,
    runtimeOptions: {
      self: captured.self,
      provide: captured.provide,
      probe: captured.probe,
      providerLimits: captured.providerLimits,
      authentication: captured.authentication,
      defaultTimeoutMs: captured.defaultTimeoutMs,
      contract: captured.contract,
      keyFactory: captured.keyFactory,
      retryPort: captured.retryPort,
      report: captured.report
    },
    open: (context) =>
      openDefinitionSource(recipe, captured, captured as IRuntimePeerOptions, context, {
        signal: context.signal ?? captured.signal,
        messageSignal: context.signal ?? captured.signal,
        connectTimeoutMs: context.connectTimeoutMs ?? provenance?.connectTimeoutMs,
        report: context.report,
        ownClose: context.ownClose,
        onGovernor: (channel, governor) => {
          governors.set(channel, governor)
        }
      }),
    prepareEndpoint: (channel, providerLimits) => {
      /** The host's explicit provider selection wins over the cold source's inherited selection. */
      const configured = providerLimits ?? captured.providerLimits
      /** Governor policy remains enforced by its original existing provider wrapper. */
      const governor = governors.get(channel)
      /** Quota observers attach once at the same preparation point as the legacy Peer path. */
      const limits = governor
        ? governor.limits(configured ?? {}, captured.providerLimits)
        : configured
      /** The authenticated scope derives its original store/key once for this physical channel. */
      const idempotency = scope?.session(channel, limits ?? {}).idempotency
      /** Host reservation stages the same policy; candidate failure cannot tighten a live scope. */
      const registration = provenance?.providerAdmissionRegistration
      registration?.stagePolicy(limits?.maxGlobal, limits?.maxPerPeer)
      /** Borrow only an explicitly held original quota resource; ordinary sessions allocate none. */
      const providerAdmission = provenance?.providerAdmission ?? scope?.admission
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
        providerAdmissionRegistration: provenance?.providerAdmissionRegistration,
        ...(governor ? { wrapEndpoint: (endpoint) => governor.endpoint(endpoint) } : {})
      }
    }
  })
}

/** Construct a regular Peer from raw I/O while the original Core factory retains validation order. */
export async function constructDefinitionPeer<
  TRemote = never,
  TInput = unknown,
  TKey extends 'process' | 'thread' = 'process' | 'thread'
>(
  definition: IAdapterDefinition<TInput, TKey>,
  options: IAdapterDefinitionPeerOptions<TInput>,
  original: IRuntimePeerOptions = options as IRuntimePeerOptions
): Promise<
  [TRemote] extends [never]
    ? IRuntimePeer
    : IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, TKey>
> {
  /**
   * Capture before constructing replacement source callbacks, especially during actual Host
   * install.
   */
  const recipe = readRecipe(definition)
  const key = recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process
  const task = captureAdapterTask(definition, original, key)
  const provenance = readRuntimePreparationContext(original)
  /** The existing preparation signal has the same precedence for every physical source kind. */
  const signal = task.preparation.initialSignal ?? options.signal
  const report = options.report ?? defaultRpcReporter
  /** Mutually exclusive raw source values map to the existing single-source Core grammar. */
  const sources = [original.spawn, original.connect, original.listen].filter(
    (source) => source !== undefined
  )
  if (sources.length > 1) throw createAdapterSourceConfigurationError()
  const scope = options.scope && readRuntimeProviderScope(options.scope)
  if (options.scope && !scope)
    throw createAdapterConfigurationTypeError(RuntimeAdapterErrorText.connectionRequired)
  /** The actual connection determines governor eligibility, quotas and all accepted capabilities. */
  let governor: ReturnType<typeof createRuntimeProviderGovernor> | undefined
  /** The original governor composes its rejection observer into the canonical provider limits. */
  let limits = original.providerLimits
  /** Scope keys derive from this exact constructed channel, not the endpoint's borrowed view. */
  let sourceChannel!: IRemoteChannel
  /** Endpoint wrapping reuses the original provider root; it never changes the local offer compiler. */
  const resources: NonNullable<Parameters<typeof createRuntimePeer>[1]> = {
    host: provenance?.host,
    providerAdmissionRegistration: provenance?.providerAdmissionRegistration,
    get providerAdmission() {
      return provenance?.providerAdmission ?? scope?.admission
    },
    signal,
    ...(options.governor ? { wrapEndpoint: (endpoint) => governor!.endpoint(endpoint) } : {})
  }
  /** Caller-owned source values and presentation do not enter the accepted private agreement. */
  const peerOptions: IRuntimePeerOptions = {
    ...original,
    self: task.preparation.context.self,
    spawn: undefined,
    listen: undefined,
    report,
    get providerLimits() {
      return limits
    },
    ...(scope
      ? {
          endpointFactory: (channel, signal) =>
            prepareRuntimePeerEndpoint(
              { ...original, self: task.preparation.context.self, report },
              channel,
              signal,
              {
                idempotency: scope.session(sourceChannel, limits ?? {}).idempotency,
                providerLimits: limits
              },
              provenance?.providerAdmission ?? scope.admission,
              provenance?.providerAdmissionRegistration
            )
        }
      : {}),
    connect: async (context) => {
      /**
       * Scoped providers retain the original compiled local offer rather than a borrowed endpoint
       * view.
       */
      const sourceContext = scope && !original.endpointFactory ? task.preparation.context : context
      /** The same helper serves legacy Peer construction and cold host deployments. */
      const channel = await openDefinitionSource(recipe, options, original, sourceContext, {
        signal,
        messageSignal: provenance?.initialSignal ?? options.signal,
        connectTimeoutMs: provenance?.connectTimeoutMs,
        report,
        onGovernor: (_channel, held) => {
          governor = held
          limits = held.limits(limits ?? {}, original.providerLimits)
        }
      })
      sourceChannel = channel
      return channel
    }
  }
  /** This only transfers the genuine captured context to the factory's own ordinary source copy. */
  return withRuntimePreparationContext(
    peerOptions,
    {
      ...provenance,
      ...(recipe.kind === 'byte' ? { restrictTransfer: assertRuntimeTransferDisabled } : {})
    },
    () => createRuntimePeer(peerOptions, resources)
  ) as Promise<
    [TRemote] extends [never]
      ? IRuntimePeer
      : IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, TKey>
  >
}

/** Private kernel baselines reuse the original complete assembler without publishing it. */
export function constructDefinitionPlugin<
  TRemote = Record<never, never>,
  const TProvide extends IRuntimePeerProvide = Record<never, never>,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  TInput = unknown,
  TKey extends 'process' | 'thread' = 'process' | 'thread'
>(
  definition: IAdapterDefinition<TInput, TKey>,
  options: Omit<IAdapterDefinitionPluginOptions<TInput>, 'provide' | 'name' | 'expose'> &
    Readonly<{ provide?: TProvide; name: TName; expose?: TExpose }>
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, TKey> {
  /** The actual raw definition retains its original private native slot family. */
  const recipe = readRecipe(definition)
  const key = recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process
  return assembleAdapterPlugin(
    definition,
    options,
    {
      key,
      acquire: (integration, create) => integration.acquireSharedSlot(key, recipe.family!, create)
    },
    (peerOptions) =>
      constructDefinitionPeer(
        definition,
        { ...options, ...peerOptions } as IAdapterDefinitionPeerOptions<TInput>,
        peerOptions
      )
  ) as ReturnType<typeof createRuntimePlugin> &
    IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, TKey>
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
