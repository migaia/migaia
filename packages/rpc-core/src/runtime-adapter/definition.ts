import { systemScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { RpcCodecId, RpcProtocol } from '@migaia/rpc-contract'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  type IRuntimePeerOptions,
  type IRuntimePeer
} from '../remote/runtime-api/peer.js'
import { createRuntimePlugin, type IRuntimePluginOptions } from '../remote/runtime-api/plugin.js'
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
  ownAdapterMessageClose
} from './message/resource.js'
import type { IAdapterMessageResource, IAdapterLaunchHandle } from './message/types.js'
import { createRuntimeByteConnection } from './byte/handshake.js'
import { RpcPlatform } from '../core/transport-constants.js'
import { ERROR_SOURCE, RpcCoreErrorCode } from '../core/error-code.js'
import { createRuntimeProviderGovernor } from './provider/governor.js'
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
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from './data.js'
import { defaultRpcReporter } from '../core/default-reporter.js'

/**
 * Definition identity retains physical operations without accepting an external Peer/channel
 * recipe.
 */
type IRecipe =
  | Readonly<{ kind: 'message'; options: IMessageAdapterOptions<unknown> }>
  | Readonly<{ kind: 'byte'; options: IByteAdapterOptions<unknown> }>

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

/** Construct a regular Peer from raw I/O while the original Core factory retains validation order. */
async function constructDefinitionPeer<TInput>(
  definition: IAdapterDefinition<TInput>,
  options: IAdapterDefinitionPeerOptions<TInput>,
  original: IRuntimePeerOptions = options as IRuntimePeerOptions
): Promise<IRuntimePeer> {
  /**
   * Capture before constructing replacement source callbacks, especially during actual Host
   * install.
   */
  const recipe = readRecipe(definition)
  const key = recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process
  const task = captureAdapterTask(definition, original, key)
  const provenance = readRuntimePreparationContext(original)
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
    signal: task.preparation.initialSignal ?? options.signal,
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
       * A selected scope still builds the original canonical endpoint, so its real roots are
       * offered.
       */
      const sourceContext = scope && !original.endpointFactory ? task.preparation.context : context
      const input = (original.spawn ?? original.connect ?? original.listen) as TInput
      const scheduler = options.scheduler ?? systemScheduler
      if (recipe.kind === 'message') {
        /**
         * Optional launch returns physical lifetime operations; supervision remains with that
         * owner.
         */
        let launched: IMessageAdapterLaunch | undefined
        if (original.spawn !== undefined) {
          if (!recipe.options.launch) throw createAdapterSourceConfigurationError()
          launched = await recipe.options.launch(input, sourceContext)
        }
        const resource = holdMessagePort(
          launched?.port ?? (await recipe.options.open(input)),
          launched
        )
        if (launched) ownAdapterMessageClose(resource)
        try {
          /**
           * Unknown message addresses come only from this resource's existing initial control
           * input.
           */
          const peerId =
            options.peerId ??
            (await resource.exchangeIdentity(
              sourceContext,
              provenance?.initialSignal ?? options.signal
            ))
          const channel = await resource.open({
            peerId,
            scheduler,
            offer: sourceContext.capabilities,
            control: rpcMessageCapabilityControl,
            signal: provenance?.initialSignal ?? options.signal
          })
          if (options.governor) {
            governor = createRuntimeProviderGovernor(
              channel,
              options.governor,
              () => resource.close(),
              report
            )
            limits = governor.limits(limits ?? {}, original.providerLimits)
            ownAdapterMessageClose(channel, { close: () => governor!.close() })
          }
          sourceChannel = channel
          return channel
        } catch (error) {
          return closeAfterFailure(resource, error, report)
        }
      }
      /** Native byte hello/auth admission is the existing canonical owner, never another handshake. */
      if (options.peerId === undefined) throw createAdapterSourceConfigurationError()
      const opening =
        original.listen !== undefined
          ? recipe.options.listen
          : original.connect !== undefined
            ? (recipe.options.dial ?? recipe.options.open)
            : recipe.options.open
      if (!opening) throw createAdapterSourceConfigurationError()
      const byte = await opening(input)
      const ipc = options.ipc ?? {
        connectionId: createAdapterId(),
        sessionId: createAdapterId(),
        log: () => undefined
      }
      const offer = options.offer ?? {
        versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
        codecs: [RpcCodecId.json],
        capabilities: sourceContext.capabilities,
        peer: { id: sourceContext.self.instanceId, runtime: key }
      }
      const common = {
        ...(recipe.options.presentation ?? {
          platform: RpcPlatform.process,
          expectedStringText: AdapterDefinitionText.expectedString
        }),
        peerId: options.peerId,
        scheduler,
        report,
        ipc,
        signal: provenance?.initialSignal
      }
      const connection = await createRuntimeByteConnection(
        byte,
        original.listen !== undefined
          ? { ...common, role: 'responder', offer, auth: options.auth ?? { mode: 'none' } }
          : { ...common, role: 'initiator', offer },
        recipe.options.diagnostics ?? byteDiagnostics
      )
      try {
        if (options.governor) {
          governor = createRuntimeProviderGovernor(
            connection,
            options.governor,
            connection.close,
            report
          )
          limits = governor.limits(limits ?? {}, original.providerLimits)
          connection.ownClose({ close: () => governor!.close() })
        }
        sourceChannel = connection
        return connection
      } catch (error) {
        return closeAfterFailure(connection, error, report)
      }
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
  )
}

/** Build the two public tasks; the actual Host creates and owns every Plugin slot registration. */
function defineAdapter<TInput>(recipe: IRecipe): IAdapterDefinition<TInput> {
  /** A stable physical family token belongs to this definition alone, never a caller object. */
  const family = Object.freeze({})
  const key = recipe.kind === 'message' ? RuntimePluginKey.thread : RuntimePluginKey.process
  let definition: IAdapterDefinition<TInput>
  definition = Object.freeze({
    peer: ((options: IAdapterDefinitionPeerOptions<TInput>) =>
      constructDefinitionPeer(definition, options)) as IAdapterDefinition<TInput>['peer'],
    plugin: ((options: IAdapterDefinitionPluginOptions<TInput>) =>
      assembleAdapterPlugin(
        definition,
        options,
        {
          key,
          acquire: (integration, create) => integration.acquireSharedSlot(key, family, create)
        },
        (peerOptions) =>
          constructDefinitionPeer(
            definition,
            { ...options, ...peerOptions } as IAdapterDefinitionPeerOptions<TInput>,
            peerOptions
          )
      )) as IAdapterDefinition<TInput>['plugin'],
    scope: (store?: IRpcIdempotencyStore) => createRuntimeProviderScope(store)
  }) as IAdapterDefinition<TInput>
  recipes.set(definition, recipe)
  return definition
}

/**
 * Define a messaging adapter from actual raw port operations. Peer/Plugin construction uses the
 * existing bounded ACK, provider/outbound owners and genuine Host installation; launch remains an
 * operation of the physical runtime instead of a second supervision implementation.
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
