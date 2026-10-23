/**
 * Private protocol baselines retain the original assembly while production exposes only cold
 * transports.
 */
import {
  RuntimePluginKey,
  type IRuntimePeerIdentity,
  createAdapterSourceConfigurationError,
  validateAdapterPeerTimeout,
  validateAdapterPeerMethods,
  IpcReporterContext,
  type IRuntimePeer,
  type IRuntimePeerOptions,
  RpcPlatform,
  validateAdapterPeerTimeout as readRuntimeDefaultTimeout,
  type IAdapterListenerService,
  type IRuntimeTypedPeer,
  type IRuntimeFlatten,
  type IRemoteChannel,
  type IRemoteEndpointFactory,
  type IRemotePluginHostPort,
  type IRemoteRetryPort,
  type IRemoteContract,
  type IRemoteServeEndpoint,
  type IRuntimePluginTyping,
  type IRuntimeExpose,
  type IRuntimeRegistry,
  normalizeRemoteContract,
  type IRuntimePluginOptions,
  type IRemoteHostCatalog,
  readAdapterAbortReason as resolveAbortReason,
  createAdapterBindingDrain as createRemoteBindingDrain,
  createAdapterId as defaultRpcId
} from '@migaia/rpc-host/plugin'
import {
  captureAdapterTask,
  assembleAdapterPlugin
} from '../../rpc-host/dist/runtime-adapter/definition.js'
import { type IAdapterTask } from '../../rpc-host/dist/runtime-adapter/definition-types.js'
import type { IRemotePluginDefinition } from '../../rpc-host/dist/remote/plugin.js'
import type { IRemoteServePluginHandle } from '../../rpc-host/dist/remote/serve-plugin.js'
import { getProcessByteAdapter } from '../dist/process/adapter.js'
import { type IProcessByteChannel } from '../dist/process/types.js'
import {
  type IRuntimeProcessPeerOptions,
  type IRuntimeProcessFullPeerOptions
} from '../dist/process/runtime-peer.js'
import {
  hostRethrowReporter,
  type INativeAbortSignal,
  type IAbortSignal
} from '@migaia/utils/promise'
import { invalidProcessRuntimeBootstrap } from '../dist/process/runtime-bootstrap.js'
import { ProcessChannelDiagnostics } from '../dist/process/diagnostics.js'
import { RpcProcessErrorText } from '../dist/process/error-text.js'
import { defaultRpcReporter } from '@migaia/rpc-host/plugin'
import {
  openAutomaticProcessIO,
  type IAutomaticProcessPlatform
} from '../dist/process/automatic-peer.js'
import { type IProcessHandle, type IProcessSpec } from '@migaia/supervision/process'
import {
  createSpawnProcessBinding,
  createConnectProcessBinding,
  type IProcessPluginBinding,
  reportSafely,
  invalidOption,
  validateSpawnProcessPluginDeployment,
  checkNativePing,
  createProcessConnectionSupervisor,
  registrationSupervisor,
  requirePingEndpoint,
  type IProcessConnectionUnit
} from '../dist/process/plugin/binding.js'
import {
  type ISpawnProcessPluginDeployment,
  type IConnectProcessPluginDeployment,
  type IProcessConnectionHandle,
  type IProcessServeEndpointFactory
} from '../dist/process/plugin/types.js'
import {
  createNativeProcessOffer,
  resolveNativeProcessRuntimeOffer
} from '../dist/process/offer.js'
import { type IRuntimeProcessListen } from '../dist/process/runtime-listener.js'
import { ProcessPluginWire, ProcessPluginChannelKind } from '../dist/process/plugin/constants.js'
import {
  type IProcessShortSourceOptions,
  normalizeProcessSources
} from '../dist/process/adapters/short-source.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { serveProcessSessions, type IProcessSessionsHandle } from '../dist/process/plugin/serve.js'
import { createProcessResilience, processSessionManager } from '../dist/process/resilience/index.js'
import {
  type IProcessResilience,
  type IProcessDependencyHostPort,
  type IProcessSessionIdentity,
  type IProcessRegistration,
  type IProcessRegistrationListenOptions,
  type IProcessSessionLease
} from '../dist/process/resilience/types.js'
import {
  NativeProcessRuntimeLoader,
  type IAdapterProcessRuntimeLoader
} from '../dist/process/runtime-loader.js'
import {
  type IReplaceOutcome,
  ReplaceStrategy,
  SUPERVISION_SOURCE,
  SupervisionErrorCode,
  SupervisionErrorText
} from '@migaia/supervision'
import { RpcCapability } from '@migaia/rpc-contract'
import { type IPluginBeforeReleaseContext, type IPluginRemoval } from '@migaia/plugin-host'
import { attachErrorIdentity } from '@migaia/utils/error'
import {
  createAdapterPlugin as assembleRemotePluginDefinition,
  holdAdapterRegistration
} from '../../rpc-host/dist/runtime-adapter/binding.js'
import { createRuntimePlugin } from '../../rpc-host/dist/remote/runtime-api/plugin.js'
import { type IRemoteServeHostOptions } from '../../rpc-host/dist/remote/serve-host.js'
import {
  ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE,
  ERROR_SOURCE,
  RpcProcessErrorCode
} from '../dist/process/error-code.js'
import {
  DEFAULT_HEALTH_FAILURE_THRESHOLD,
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS
} from '../dist/process/resilience/constants.js'
import { serveRemotePlugin } from '../../rpc-host/dist/remote/serve-plugin.js'
/** Capture original Host provenance before native discovery or any resolved-options copy. */
export function captureProcessTask(
  options: IRuntimeProcessPeerOptions,
  selectedSelf?: IRuntimePeerIdentity
): IAdapterTask<IProcessByteChannel> {
  return captureAdapterTask(
    getProcessByteAdapter(),
    options,
    RuntimePluginKey.process,
    selectedSelf
  )
}

/** Only package-local source assembly receives this held Core operation; users cannot submit it. */
export type IProcessAdapterTask = ReturnType<typeof captureProcessTask>

/** Process discovers native resources; Core derives bootstrap/generation only from its actual read. */
export async function createAutomaticProcessPeer(
  options: IRuntimePeerOptions,
  platform: IAutomaticProcessPlatform,
  prepared?: IProcessAdapterTask
): Promise<IRuntimePeer> {
  /** Cleanup uses the same observable default as the public Peer, without rebuilding provenance. */
  const report = options.report ?? defaultRpcReporter
  if (prepared) validateAdapterPeerTimeout(options)
  /** The same genuine preparation view preserves the original Host and transfer policy. */
  const task = prepared ?? captureProcessTask(options)
  /** Only this held task retains the original preparation across native I/O acquisition. */
  const preparation = task.preparation
  if (platform.marker === undefined) return preparation.peer(options)
  /** Native acquisition retains the original claim and validates source/method options first. */
  const opened = await openAutomaticProcessIO(platform, () => {
    if (
      options.spawn !== undefined ||
      options.connect !== undefined ||
      options.listen !== undefined
    )
      throw createAdapterSourceConfigurationError()
    validateAdapterPeerMethods(options.provide, options.contract)
  })
  try {
    if (!opened.bootstrap) invalidProcessRuntimeBootstrap()
    return task.bytePeer(options, opened.channel, {
      runtime: platform.runtime,
      platform: RpcPlatform.process,
      diagnostics: ProcessChannelDiagnostics,
      expectedStringText: RpcProcessErrorText.expectedString,
      bootstrapInvalidText: RpcProcessErrorText.runtimeBootstrapInvalid
    })
  } catch (primary) {
    try {
      await opened.channel.close()
    } catch (cleanup) {
      try {
        report(cleanup)
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
    throw primary
  }
}

/** Real execution and local socket sessions retain their existing independent supervision owners. */
export function createProcessSourcePeer<THandle extends IProcessHandle>(
  options: IRuntimeProcessFullPeerOptions<THandle>,
  runtime: string,
  task: IProcessAdapterTask
): Promise<IRuntimePeer> {
  readRuntimeDefaultTimeout(options)
  /** All source branches retain the SDK task's original Core context and preparation identity. */
  const preparation = task.preparation
  /** Multiple or unsupported source specifications fail before any original launcher or dial starts. */
  const sources = [options.spawn, options.connect, options.listen].filter(
    (source) => source !== undefined
  )
  if (sources.length !== 1 || sources[0] === null || typeof sources[0] !== 'object')
    throw createAdapterSourceConfigurationError()
  /** Core retains the original Host/default-self provenance and compiled local proposal. */
  const context = preparation.context
  /** The actual prepared local identity is independent of the caller's display/default marker. */
  const self = context.self
  /** The listener's held deployment stays separate from spawn/connect supervision. */
  const listen = typeof options.listen === 'object' ? options.listen : undefined
  /**
   * Source objects retain authentication, codecs, budgets and their caller-selected supervision
   * policy.
   */
  const spawn = typeof options.spawn === 'object' ? options.spawn : undefined
  /** Connect supervision owns a local session, never the external target process. */
  const connect = typeof options.connect === 'object' ? options.connect : undefined
  /**
   * Existing user proposals stay narrower; default native proposals include the real compiled
   * offer.
   */
  const offer =
    spawn?.offer ??
    connect?.offer ??
    listen?.offer ??
    createNativeProcessOffer({
      peer: { id: self.instanceId, runtime },
      auth: spawn?.token ?? connect?.token,
      capabilities: context.capabilities
    })
  preparation.validateOffer(offer)
  if (listen)
    return createProcessListenerPeer(
      {
        self,
        provide: options.provide,
        probe: options.probe,
        providerLimits: options.providerLimits,
        authentication: options.authentication,
        defaultTimeoutMs: options.defaultTimeoutMs,
        contract: options.contract,
        endpointFactory: options.endpointFactory,
        report: options.report
      },
      listen,
      task
    )
  /** Distinct unit/spec domains retain their native types while sharing one generation assembly. */
  const managed = <TUnit extends object, TSpec>(
    binding: IProcessPluginBinding<TUnit, TSpec>,
    execution: Parameters<IProcessAdapterTask['managed']>[2]
  ) =>
    task.managed(
      {
        self,
        provide: options.provide,
        probe: options.probe,
        providerLimits: options.providerLimits,
        authentication: options.authentication,
        defaultTimeoutMs: options.defaultTimeoutMs,
        contract: options.contract,
        keyFactory: options.keyFactory,
        retryPort: options.retryPort,
        endpointFactory: options.endpointFactory,
        callDeadlineCapMs: spawn?.supervision.spec.limits?.callWallTimeMs,
        report: options.report
      },
      binding,
      execution
    )
  /** The canonical binding's native health and drain are kept, rather than disabled for v2. */
  if (spawn) {
    /** Only an actual spawned binding supplies native execution operations. */
    const spawnedBinding = createSpawnProcessBinding(
      {
        ...spawn,
        offer,
        supervision: {
          ...spawn.supervision,
          /** JSON-RPC children consume the original token frame, without native runtime bootstrap. */
          launcher:
            spawn.wire === ProcessPluginWire.jsonrpc
              ? spawn.supervision.launcher
              : preparation.launcher(spawn.supervision.launcher, spawn.supervision.id)
        }
      },
      options.report
    )
    return managed(spawnedBinding, spawnedBinding.supervisor)
  }
  return managed(createConnectProcessBinding({ ...connect!, offer }, options.report), undefined)
}

/**
 * Preserve the original native listener/session Set and rollback while using opaque Core
 * operations.
 */
export async function createProcessListenerPeer(
  options: IRuntimePeerOptions,
  ingress: IRuntimeProcessListen,
  task?: IProcessAdapterTask
): Promise<IRuntimePeer> {
  /**
   * Native sessions always retain an actual reporter while the original options carry Host
   * identity.
   */
  const report = options.report ?? defaultRpcReporter
  /** Direct native listeners obtain the same opaque Core owner as the deployed source path. */
  const captured = task ?? captureProcessTask(options)
  /** Listener/session assembly remains with this captured SDK task's original private owner. */
  const prepared = captured.preparation
  /** Core's installed local roots fill omitted defaults; explicit caller proposals stay narrow. */
  const offer = resolveNativeProcessRuntimeOffer(ingress.offer, prepared.context.capabilities)
  /** The canonical local directory and native handshake share the same actual local proposal. */
  const listener = captured.listener(offer.capabilities)
  /** Only this construction closes a default governor it created. */
  const resilience =
    ingress.resilience ??
    createProcessResilience({
      scheduler: ingress.scheduler ?? systemScheduler,
      report
    })
  /** Original early Host ownership covers bind and in-progress candidates. */
  let closeSessions: (() => Promise<void>) | undefined
  /** Callable close preserves the original complete native-session cleanup Promise. */
  const close = (): Promise<void> => closeSessions!()
  /** This original native owner remains the only active-membership collection. */
  let sessions: IProcessSessionsHandle
  try {
    sessions = await serveProcessSessions(
      { ...ingress, offer },
      undefined,
      (session) => session.runtime!.peer(),
      resilience,
      report,
      undefined,
      ingress.scheduler ?? systemScheduler,
      {
        signal: prepared.lifecycleSignal,
        initialSignal: prepared.initialSignal,
        providerLimits: options.providerLimits,
        own: (dispose) => {
          closeSessions = dispose
          prepared.own({ close })
        },
        publish: (service) => listener.publish(service as IAdapterListenerService),
        ...(!ingress.resilience ? { release: () => resilience.close() } : {})
      },
      listener
    )
  } catch (primary) {
    try {
      if (closeSessions) await closeSessions()
      else if (!ingress.resilience) await resilience.close()
    } catch (cleanup) {
      reportSafely(report, cleanup)
    }
    throw primary
  }
  return listener.open({
    carrier: ProcessPluginChannelKind.byte,
    current: () => sessions.current() as IAdapterListenerService | null | undefined,
    services: () => sessions.services() as readonly IAdapterListenerService[],
    closed: sessions.closed,
    close
  })
}

/**
 * The moved runtime factory retains Core preparation while Process owns native discovery/source
 * policy.
 */
export function createAdapterProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader,
  forwarded?: IProcessShortSourceOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** Untyped native construction retains its original operation Promise. */
export function createAdapterProcessPeer(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader,
  forwarded?: IProcessShortSourceOptions
): Promise<object> {
  /** Local listener addressing is configuration; Core retains genuine default-self/Host provenance. */
  const listener = typeof options.listen === 'object' ? options.listen : undefined
  /** One opaque view carries the same transfer restriction through every source branch. */
  const task = captureProcessTask(
    options,
    listener
      ? { name: options.self?.name ?? RuntimePluginKey.process, instanceId: listener.offer.peer.id }
      : undefined
  )
  /** Complex native sources reuse this task's sole original preparation owner. */
  const preparation = task.preparation
  /** Native loading retains the original acquisition promise and discovery ordering. */
  const loaded = runtime.load()
  if (!loaded)
    return preparation.peer({
      ...options,
      report: options.report ?? defaultRpcReporter
    } as IRuntimePeerOptions)
  return loaded.then((module) => {
    validateAdapterPeerTimeout(options)
    /** Discovery still precedes launch/dial/listen effects. */
    const discovery = module.processRuntimeIO.discover()
    if (
      !discovery.marker &&
      ((options.spawn !== undefined && typeof options.spawn !== 'function') ||
        (options.connect !== undefined && typeof options.connect !== 'function') ||
        (options.listen !== undefined && typeof options.listen !== 'function'))
    )
      return normalizeProcessSources(options, discovery.runtime, preparation, forwarded).then(
        (resolved) => createProcessSourcePeer(resolved, discovery.runtime, task)
      )
    return createAutomaticProcessPeer(
      { ...options, report: options.report ?? defaultRpcReporter } as IRuntimePeerOptions,
      {
        marker: discovery.marker,
        runtime: discovery.runtime,
        open: () => module.processRuntimeIO.open()
      },
      task
    )
  })
}

/**
 * Open one owned child, borrowed connection, listener, or discovered child endpoint. Native modules
 * load only for the selected runtime. The returned Peer owns its connection resources; closing a
 * connect Peer does not terminate the external process. Invalid source combinations reject before
 * launch/dial/listen, and bootstrap/handshake failures retain their owning error identity.
 */
export function createProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** The loader only selects native modules; it cannot register trust for an arbitrary transport. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions): Promise<object> {
  return createAdapterProcessPeer(options, new NativeProcessRuntimeLoader())
}

/** The client facade adds only process deployment and optional whole-process replacement. */
export type IProcessPluginOptions<THandle extends IProcessHandle = IProcessHandle> = Readonly<{
  /** Local plugin name; it must match contract.plugin and registrationOwner.name. */
  name: string
  /** Remote API contract normalized before constructing the deployment binding. */
  contract: IRemoteContract
  /** The local Host that will own and, if necessary, liquidate this exact registration. */
  registrationOwner: Readonly<{ name: string; host: IProcessDependencyHostPort }>
  /** Caller-owned governance may replace the default process registration policy. */
  resilience?: IProcessResilience
  /** Borrowed remote Host; start-then-switch additionally requires its replace operation. */
  host: IRemotePluginHostPort & {
    replace?(name: string, candidate: IRemotePluginDefinition): Promise<unknown>
  }
  /** Build and adopt the endpoint for this generation after its channel is ready. */
  endpointFactory: IRemoteEndpointFactory
  /** Required diagnostics sink for secondary cleanup and supervision failures. */
  report(error: unknown): void
  /** Optional remote idempotency-key factory forwarded to Core. */
  keyFactory?: () => string
  /** Optional retry owner forwarded to Core; this facade adds no independent request retry loop. */
  retryPort?: IRemoteRetryPort
  /** Owned child deployment or borrowed external-process connection. */
  deployment: ISpawnProcessPluginDeployment<THandle> | IConnectProcessPluginDeployment
}>

/**
 * Stop-then-start returns the supervisor's replacement outcome; start-then-switch returns the new
 * definition installed through Host.replace. The old definition is retired after that switch.
 */
export type IProcessPluginReplaceResult =
  | Readonly<{ strategy: 'stop-then-start'; outcome: IReplaceOutcome }>
  | Readonly<{ strategy: 'start-then-switch'; plugin: IProcessPlugin }>

/** A remote definition carries whole-process replacement only for an installed spawn deployment. */
export type IProcessPlugin = IRemotePluginDefinition &
  Readonly<{
    /**
     * Default options are {} and strategy is 'stop-then-start'; an omitted spec reuses the current
     * deployment spec. 'start-then-switch' requires host.replace and a concurrent candidate budget.
     * Stale/uninstalled definitions and borrowed connect deployments cannot replace a process.
     */
    replace(
      options?: Readonly<{ spec?: IProcessSpec; strategy?: ReplaceStrategy }>
    ): Promise<IProcessPluginReplaceResult>
  }>

/** This physical owner alone retains the stable family token for its actual Host slot operation. */
const processRuntimeSlotFamily = Object.freeze({})

/** Capture the canonical namespace once; descriptive resource fields cannot retarget this operation. */
const processRuntimeSlotKey = RuntimePluginKey.process

/** Symmetric Plugin options reuse the process Peer source boundary and canonical Feature exposure. */
export type IRuntimeProcessPluginOptions = Omit<
  IRuntimePluginOptions<
    IRuntimeProcessPeerOptions['spawn'],
    IRuntimeProcessPeerOptions['connect'],
    IRuntimeProcessPeerOptions['listen']
  >,
  'report'
> &
  Pick<IRuntimeProcessPeerOptions, 'report' | 'token' | 'verify' | 'connectTimeoutMs'>

/** Keep failed endpoint admission inside the generation's rollback boundary. */
function processEndpointFactory<TUnit extends object, TSpec>(
  binding: IProcessPluginBinding<TUnit, TSpec>,
  factory: IRemoteEndpointFactory,
  report: (error: unknown) => void
): IRemoteEndpointFactory {
  return async (channel, signal) => {
    const endpoint = await factory(channel, signal)
    try {
      return binding.bindEndpoint(channel, endpoint)
    } catch (error) {
      try {
        await endpoint.endpoint.dispose()
      } catch (cleanupError) {
        reportSafely(report, cleanupError)
      }
      throw error
    }
  }
}

/** A retired definition has the same terminal identity as its disposed supervisor. */
function staleDefinition(): never {
  throw attachErrorIdentity(new Error(SupervisionErrorText.scopeTerminal), {
    source: SUPERVISION_SOURCE,
    code: SupervisionErrorCode.scopeTerminal
  })
}

/** The original advanced declaration is retained only for the serial consumer migration. */
export function createAdapterProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>,
  runtime: IAdapterProcessRuntimeLoader
): IProcessPlugin
/** Adds one symmetric connection to the canonical process slot. */
export function createAdapterProcessPlugin<
  TRemote = Record<never, never>,
  const TProvide extends import('@migaia/rpc-host/plugin').IRuntimePeerProvide = Record<
    never,
    never
  >,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IRuntimeProcessPluginOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>,
  runtime: IAdapterProcessRuntimeLoader
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'process'>
/** Native factories can retain the same advanced/symmetric union while supplying actual runtime I/O. */
export function createAdapterProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle> | IRuntimeProcessPluginOptions,
  runtime: IAdapterProcessRuntimeLoader
): IProcessPlugin | ReturnType<typeof createRuntimePlugin>
/** Route the four-factory migration through one symmetric builder without copying platform owners. */
export function createAdapterProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle> | IRuntimeProcessPluginOptions,
  runtime: IAdapterProcessRuntimeLoader
): IProcessPlugin | ReturnType<typeof createRuntimePlugin> {
  if (!('deployment' in options))
    return assembleAdapterPlugin(
      getProcessByteAdapter(),
      { ...options, report: options.report ?? defaultRpcReporter },
      {
        key: processRuntimeSlotKey,
        acquire: (integration, create) =>
          integration.acquireSharedSlot(processRuntimeSlotKey, processRuntimeSlotFamily, create)
      },
      (peerOptions) =>
        createAdapterProcessPeer(peerOptions, runtime, {
          token: options.token,
          verify: options.verify,
          connectTimeoutMs: options.connectTimeoutMs
        })
    )
  return assembleProcessPlugin(options)
}

/** A prepared candidate transfers borrowed governance only at its canonical installation boundary. */
function assembleProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>,
  retirePreviousRegistration?: () => Promise<void> | undefined
): IProcessPlugin {
  const contract = normalizeRemoteContract(options.contract)
  if (options.name !== contract.plugin) invalidOption('name')
  if (
    options.registrationOwner?.name !== options.name ||
    typeof options.registrationOwner.host?.unUse !== 'function'
  )
    invalidOption('registrationOwner')
  /** One governor lives across supervisor generations, rather than per endpoint. */
  const binding: IProcessPluginBinding<
    IProcessHandle | IProcessConnectionHandle,
    IProcessSpec | string
  > = (
    options.deployment.kind === 'spawn'
      ? createSpawnProcessBinding(options.deployment, options.report)
      : createConnectProcessBinding(options.deployment, options.report)
  ) as IProcessPluginBinding<IProcessHandle | IProcessConnectionHandle, IProcessSpec | string>
  /** Borrowed governance is never closed by this definition. */
  const resilience =
    options.resilience ??
    createProcessResilience({
      scheduler: binding.scheduler,
      report: options.report
    })
  /** Liquidation releases the Plugin through its real local Host, retaining the tombstone. */
  let liquidating = false
  /** Candidate preparation has no installed registration; installation owns terminal diagnostics. */
  let registration: IProcessRegistration | undefined
  const attachRegistration = (): void => {
    registration = resilience.attachRegistration(
      options.name,
      {
        ownership: options.deployment.kind === 'spawn' ? 'spawn-owned' : 'connection-borrowed',
        health: binding.health,
        supervisor: binding.registrationSupervisor
      },
      {
        kind: 'proxy-plugin',
        name: options.name,
        host: {
          unUse: (async (
            name: string,
            removal: { policy: 'suspend' | 'cascade'; dryRun?: boolean }
          ) => {
            if (removal.dryRun)
              return options.registrationOwner.host.unUse(name, { ...removal, dryRun: true })
            liquidating = true
            try {
              return await options.registrationOwner.host.unUse(name, { ...removal, dryRun: false })
            } finally {
              liquidating = false
            }
          }) as typeof options.registrationOwner.host.unUse
        }
      }
    )
  }
  /** Normal release awaits diagnostics cleanup; committed liquidation retains its tombstone. */
  const releaseRegistration = async (): Promise<void> => {
    if (liquidating) return
    await registration?.close()
    if (!options.resilience) await resilience.close()
  }
  if (options.deployment.kind === 'spawn') {
    const deployment = options.deployment

    /** Only Host installation makes this exact definition eligible for replacement. */
    let installed = false
    /** Admission stays synchronous; the selected owner performs the actual replacement. */
    const replace: IProcessPlugin['replace'] = (
      replacement = {}
    ): Promise<IProcessPluginReplaceResult> => {
      if (!installed) staleDefinition()
      const strategy = replacement.strategy ?? ReplaceStrategy.stopThenStart
      if (
        strategy !== ReplaceStrategy.stopThenStart &&
        strategy !== ReplaceStrategy.startThenSwitch
      )
        invalidOption('strategy')
      if (replacement.spec)
        validateSpawnProcessPluginDeployment(
          { ...deployment, supervision: { ...deployment.supervision, spec: replacement.spec } },
          'spec'
        )
      if (strategy === ReplaceStrategy.stopThenStart)
        return binding.supervisor
          .replace({ strategy, spec: replacement.spec })
          .then((outcome) => ({ strategy, outcome }))
      if (typeof options.host.replace !== 'function') invalidOption('host.replace')
      /**
       * Candidate construction reuses supervision spec validation before touching the caller's
       * pool.
       */
      const candidate = assembleProcessPlugin(
        {
          ...options,
          deployment: {
            ...deployment,
            supervision: {
              ...deployment.supervision,
              spec: replacement.spec ?? deployment.supervision.spec,
              prewarm: undefined
            }
          }
        },
        options.resilience ? () => registration?.close() : undefined
      )
      deployment.supervision.prewarm?.invalidate()
      return options.host
        .replace(options.name, candidate)
        .then(() => ({ strategy, plugin: candidate }))
    }
    return assembleRemotePluginDefinition(
      {
        name: options.name,
        contract,
        host: options.host,
        binding,
        endpointFactory: processEndpointFactory(binding, options.endpointFactory, options.report),
        report: options.report,
        callDeadlineCapMs: deployment.supervision.spec.limits?.callWallTimeMs,
        keyFactory: options.keyFactory,
        retryPort: options.retryPort,
        callGuard: resilience.callGuard(options.name)
      },
      {
        replace,
        beforeRelease: (context: IPluginBeforeReleaseContext) =>
          binding.drainCurrent({ hostRemainingMs: context.remainingMs() })
      },
      {
        installed: () => {
          /** Default installation remains synchronous; only a shared-name transfer joins cleanup. */
          const retiring = retirePreviousRegistration?.()
          if (retiring)
            return retiring.then(() => {
              attachRegistration()
              installed = true
            })
          attachRegistration()
          installed = true
        },
        close: () => {
          installed = false
          return releaseRegistration()
        }
      }
    )
  }

  /** A borrowed external process has no whole-process replacement command. */
  const replace: IProcessPlugin['replace'] = (): Promise<IProcessPluginReplaceResult> =>
    invalidOption('deployment.kind')
  return assembleRemotePluginDefinition(
    {
      name: options.name,
      contract,
      host: options.host,
      binding,
      endpointFactory: processEndpointFactory(binding, options.endpointFactory, options.report),
      report: options.report,
      keyFactory: options.keyFactory,
      retryPort: options.retryPort,
      callGuard: resilience.callGuard(options.name)
    },
    {
      replace,
      beforeRelease: (context: IPluginBeforeReleaseContext) =>
        binding.drainCurrent({ hostRemainingMs: context.remainingMs() })
    },
    { installed: attachRegistration, close: releaseRegistration }
  )
}

/**
 * Define an advanced process-backed plugin with an explicit deployment, endpoint factory and local
 * registration owner. Construction validates configuration; Host installation acquires the actual
 * generation. Spawn definitions support replace, while borrowed connect definitions reject it.
 */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle>
): IProcessPlugin
/**
 * Define a symmetric Process plugin from the same source forms as createProcessPeer. Host owns the
 * shared process slot and its release; provide/expose retain Core's Feature admission and typing.
 * The definition itself does not start a process before installation.
 */
export function createProcessPlugin<
  TRemote = Record<never, never>,
  const TProvide extends import('@migaia/rpc-host/plugin').IRuntimePeerProvide = Record<
    never,
    never
  >,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IRuntimeProcessPluginOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'process'>
/**
 * The native factory supplies only the runtime I/O it holds; Core owns the complete Plugin
 * operation.
 */
export function createProcessPlugin<THandle extends IProcessHandle>(
  options: IProcessPluginOptions<THandle> | IRuntimeProcessPluginOptions
): IProcessPlugin | ReturnType<typeof createRuntimePlugin> {
  return createAdapterProcessPlugin(options, new NativeProcessRuntimeLoader())
}

/** A verifier principal selects a local approved Host and contract, not a peer claim. */
export type IProcessHostRegistrationApproval = Readonly<{
  targetHost: IRemoteServeHostOptions['host']
  name: string
  contract: IRemoteHostCatalog[string]
}>

/** Reverse registration consumes an already authenticated native channel exactly once. */
export type IProcessHostRegistrations = Omit<
  IProcessRegistrationListenOptions,
  'wire' | 'onCandidate'
> &
  Readonly<{
    resolveRegistration(principalId: string): IProcessHostRegistrationApproval | undefined
  }>

/** Host admission names only a field, so rejected deployment secrets never enter diagnostics. */
export function invalidHostOption(field: string): never {
  throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
    attachErrorIdentity(new TypeError(RpcProcessErrorText.hostInvalidOption), {
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.hostInvalidOption,
      ...(originalDetail ? { detail: originalDetail } : {})
    }))({ field })
}

/** Collect independent release failures without hiding their original instances. */
export function hostCleanupFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

/** Adoption changes only channel ownership; local supervision never gains an external PID. */
export type IAdoptedProcessBinding = IProcessPluginBinding<IProcessConnectionUnit, string> &
  Readonly<{ adopt(): void }>

/**
 * Consume one already established channel with the process plugin's canonical close-only
 * supervision profile.
 */
export function createAdoptedProcessBinding(
  candidate: IProcessSessionLease & Readonly<{ signal: IAbortSignal }>,
  report: (error: unknown) => void
): IAdoptedProcessBinding {
  /** Until the callback returns adopt, I16 alone owns physical rollback and its connection lease. */
  let adopted = false
  /** A closed adopted channel can never be dialed, established or manually restarted again. */
  let closed = false
  /** Remote and supervisor disposal share one local session exit. */
  let closing: Promise<void> | undefined
  /** Resolve the one local unit exit from either physical loss or explicit retirement. */
  let settleExit!: (exit: Readonly<{ reason: unknown }>) => void
  /** Only the live endpoint may satisfy a native health probe. */
  let ready: Readonly<{ channel: IRemoteChannel; endpoint: IRemoteServeEndpoint }> | undefined
  /** The local unit budget is separate from I16's one physical connection admission lease. */
  const exited = new Promise<Readonly<{ reason: unknown }>>((resolve) => {
    settleExit = resolve
  })
  /** Candidate cancellation is propagated without creating a second handshake or cancel owner. */
  const lost = (): void => {
    closed = true
    settleExit({ reason: resolveAbortReason(candidate.signal) })
  }
  candidate.signal.addEventListener('abort', lost, { once: true })
  if (candidate.signal.aborted) lost()
  /** Pre-adoption close releases local preparation; after adoption it also returns the I16 lease. */
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      closed = true
      candidate.signal.removeEventListener('abort', lost)
      try {
        if (adopted) await candidate.close()
      } finally {
        settleExit({ reason: undefined })
      }
    })())
  /** The physical channel's disposer enforces the transfer boundary for remote rollback. */
  const channel: IRemoteChannel = { ...candidate.channel, close }
  /** Identity comes from the authenticated session, never from a newly invented routing peer. */
  const unit: IProcessConnectionUnit = {
    identity: { fingerprint: candidate.identity.sessionId },
    exited,
    close
  }
  /** Use the established channel clock for all supervision and drain work. */
  const scheduler = channel.scheduler
  /** Native negotiated ping selects the existing health check rather than a new protocol. */
  const health = channel.agreement.capabilities.includes(RpcCapability.ping) ? 'ping' : 'none'
  /** One generation drain accounts for endpoint work and logical request settlement. */
  const drain = createRemoteBindingDrain(scheduler, (error) => reportSafely(report, error))
  /** The canonical supervisor owns readiness, health and close-only unit retirement. */
  const supervisor = createProcessConnectionSupervisor(
    candidate.identity.connectionId,
    scheduler,
    report,
    {
      capabilities: {},
      async launch(_address, context) {
        if (closed || candidate.signal.aborted || context.signal.aborted)
          throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
            source: RPC_PROCESS_ERROR_SOURCE,
            code: RpcProcessErrorCode.channelClosed
          })
        return unit
      }
    },
    {
      restart: { mode: 'on-failure', maxRestarts: 0 },
      ...(health === 'ping'
        ? {
            health: {
              check: (_unit: IProcessConnectionUnit, signal: IAbortSignal) =>
                checkNativePing(ready, signal),
              intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
              timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
              failureThreshold: DEFAULT_HEALTH_FAILURE_THRESHOLD
            }
          }
        : {})
    }
  )
  return {
    ownership: 'owned',
    supervisor,
    scheduler,
    health,
    registrationSupervisor: registrationSupervisor(supervisor),
    trackRequest: drain.trackCurrent,
    drainCurrent: (options) =>
      supervisor.state === 'ready' ? drain.drainCurrent(options) : Promise.resolve(),
    bindEndpoint(next, endpoint) {
      if (health === 'ping') requirePingEndpoint(next, endpoint)
      const tracked = drain.wrap(next, endpoint)
      ready = { channel: next, endpoint: tracked }
      return tracked
    },
    async openChannel(_unit, signal) {
      if (candidate.signal.aborted) throw resolveAbortReason(candidate.signal)
      if (signal.aborted) throw resolveAbortReason(signal)
      if (closed)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      return channel
    },
    adopt() {
      if (closed || candidate.signal.aborted)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      adopted = true
    }
  }
}

/** Adoption consumes only verified authority and an endpoint, independently of ordinary ingress. */
export type IProcessHostAdoptionOptions = Readonly<{
  endpointFactory: IProcessServeEndpointFactory
  report(error: unknown): void
  registrations: Pick<IProcessHostRegistrations, 'resolveRegistration'>
}>

/** One adopted plugin can be removed without closing any other target Host or connection. */
export type IAdoptedHostRegistration = Readonly<{ close(): Promise<void> }>

/** Prevalidate the trusted descriptor before installation and transfer one prepared remote owner. */
export async function adoptHostRegistration(
  candidate: IProcessSessionLease & Readonly<{ signal: IAbortSignal }>,
  options: IProcessHostAdoptionOptions,
  resilience: IProcessResilience,
  adopted: Set<IAdoptedHostRegistration>
): Promise<'adopt' | 'reject'> {
  /** Authority is selected only from the verifier's principal, never channel.peerId. */
  const approval = options.registrations.resolveRegistration(candidate.identity.principalId)
  if (!approval) return 'reject'
  /** Contract normalization preserves remote's original validation codes and causes. */
  const contract = normalizeRemoteContract(approval.contract)
  if (approval.name !== contract.plugin) invalidHostOption('registrations.resolveRegistration')
  if (candidate.signal.aborted) throw resolveAbortReason(candidate.signal)
  /** Names may repeat on separate target Hosts, but governance IDs may never collide. */
  const id = defaultRpcId()
  /** Adopt only the authenticated channel; never acquire an external process handle. */
  const binding = createAdoptedProcessBinding(candidate, options.report)
  /** Committed liquidation retains its tombstone rather than recursively closing its registration. */
  let liquidating = false
  /** Target installation commits ownership only after the already validated holder is accepted. */
  let installed = false
  /** Normal release shares diagnostics cleanup across unUse, EOF and explicit service close. */
  let cleanup: Promise<void> | undefined
  /** Repeated close operations share one cleanup outcome across cancellation races. */
  let closing: Promise<void> | undefined
  /** Adapt only this root name to its unique registration identity; dependency names stay actual. */
  const owner: IProcessDependencyHostPort = {
    unUse: (async (_name: string, removal: { policy: 'suspend' | 'cascade'; dryRun?: boolean }) => {
      if (removal.dryRun)
        return approval.targetHost.unUse(approval.name, { ...removal, dryRun: true })
      liquidating = true
      try {
        const result = await approval.targetHost.unUse(approval.name, { ...removal, dryRun: false })
        return {
          ...result,
          affected: {
            ...result.affected,
            steps: result.affected.steps.map((step) =>
              step.name === approval.name ? { ...step, name: id } : step
            )
          }
        }
      } finally {
        liquidating = false
      }
    }) as IProcessDependencyHostPort['unUse']
  }
  /** Attach the unique governance identity before remote preparation can publish. */
  const registration = resilience.attachRegistration(
    id,
    {
      ownership: 'connection-borrowed',
      health: binding.health,
      supervisor: binding.registrationSupervisor
    },
    { kind: 'proxy-plugin', name: id, host: owner }
  )
  /** One canonical registration performs both pre-install describe and installed proxy dispatch. */
  const remoteOptions = {
    name: approval.name,
    contract,
    host: approval.targetHost.plugin,
    binding,
    report: options.report,
    callGuard: resilience.callGuard(id),
    endpointFactory: async (
      channel: Parameters<typeof options.endpointFactory>[0],
      signal: INativeAbortSignal
    ) => {
      const endpoint = await options.endpointFactory(channel, signal, {
        identity: candidate.identity,
        ...(processSessionManager(resilience)?.connectionOptions(channel, candidate.identity) ??
          resilience.sessionOptions(candidate.identity))
      })
      try {
        return binding.bindEndpoint(channel, endpoint)
      } catch (error) {
        try {
          await endpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(options.report, cleanupError)
        }
        throw error
      }
    }
  }
  /** The same remote resource owner survives prevalidation and committed PluginHost setup. */
  const holder = holdAdapterRegistration(remoteOptions)
  /** The release callback is lifecycle bookkeeping; remote's disposer alone owns endpoint/channel. */
  const released = (): Promise<void> => {
    candidate.signal.removeEventListener('abort', onLost)
    adopted.delete(owned)
    if (liquidating) return Promise.resolve()
    return (cleanup ??= registration.close())
  }
  /** EOF removal uses suspend so genuine dependants can recover after a new approved registration. */
  const owned: IAdoptedHostRegistration = {
    close: () =>
      (closing ??= (async () => {
        candidate.signal.removeEventListener('abort', onLost)
        /** Both cleanup failures stay reachable without replacing the first one. */
        const errors: unknown[] = []
        try {
          if (installed) {
            const result: IPluginRemoval = await approval.targetHost.unUse(approval.name, {
              policy: 'suspend'
            })
            if (!result.ok) for (const error of result.errors) reportSafely(options.report, error)
          } else await holder.release()
        } catch (error) {
          errors.push(error)
        }
        try {
          await released()
        } catch (error) {
          errors.push(error)
        }
        if (errors.length) throw hostCleanupFailure(errors)
      })())
  }
  /** I16 closes the physical channel once; Host handles only its committed plugin removal. */
  const onLost = (): void => {
    if (installed) void owned.close().catch((error) => reportSafely(options.report, error))
  }
  candidate.signal.addEventListener('abort', onLost, { once: true })
  try {
    await holder.prepare(candidate.signal, true)
    if (candidate.signal.aborted) throw resolveAbortReason(candidate.signal)
    const definition = holder.plugin(undefined, released)
    await approval.targetHost.use(definition)
    installed = true
    if (candidate.signal.aborted) {
      await owned.close()
      return 'reject'
    }
    binding.adopt()
    adopted.add(owned)
    return 'adopt'
  } catch (error) {
    try {
      await owned.close()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    throw error
  }
}

/** The original native owner supplies the exact accepted session callback shape. */
type IProcessReadySession = Parameters<Parameters<typeof serveProcessSessions>[2]>[0]

/** Preserve the original process-domain aggregate for independent service cleanup failures. */
function cleanupFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

/** Only target selection and its existing remote/Host cleanup belong to this internal owner. */
export type IProcessSessionServiceOptions = Readonly<{
  host: import('../../rpc-host/dist/remote/serve-plugin.js').IRemoteServePluginOptions['host']
  contract: import('@migaia/rpc-host/plugin').IRemoteContract
  report(error: unknown): void
  instanceMode?: 'shared' | 'per-connection'
  createSessionHost?(
    session: IProcessSessionIdentity
  ):
    | Promise<
        import('../../rpc-host/dist/remote/serve-plugin.js').IRemoteServePluginOptions['host'] &
          Readonly<{ dispose(): Promise<unknown> }>
      >
    | (import('../../rpc-host/dist/remote/serve-plugin.js').IRemoteServePluginOptions['host'] &
        Readonly<{ dispose(): Promise<unknown> }>)
}>

/** Validate target authority cold, then adopt each endpoint through the original remote service. */
export function createProcessSessionService(
  options: IProcessSessionServiceOptions
): (session: IProcessReadySession) => Promise<IRemoteServePluginHandle> {
  /**
   * Only the target selection mode is retained here; native ingress remains with
   * serveProcessSessions.
   */
  const mode = options.instanceMode ?? 'shared'
  if (mode === 'per-connection') {
    if (typeof options.createSessionHost !== 'function') invalidOption('createSessionHost')
  } else if (mode !== 'shared') invalidOption('instanceMode')
  /** The existing normalizer validates the one contract before any native listener binds. */
  const contract = normalizeRemoteContract(options.contract)
  return async ({ endpoint, identity }) => {
    let targetHost: IProcessSessionServiceOptions['host'] | undefined
    let closeTarget: (() => Promise<unknown>) | undefined
    let transferred = false
    try {
      if (mode === 'per-connection') {
        const ownedTarget = await options.createSessionHost!(identity)
        targetHost = ownedTarget
        closeTarget = () => ownedTarget.dispose()
      } else targetHost = options.host
      transferred = true
      const service = await serveRemotePlugin({
        host: targetHost,
        contract,
        endpoint,
        report: options.report,
        invocationContext: (context) => Object.freeze({ session: identity, signal: context.signal })
      })
      return {
        close: async () => {
          const errors: unknown[] = []
          try {
            await service.close()
          } catch (error) {
            errors.push(error)
          }
          if (mode === 'per-connection') {
            try {
              await closeTarget?.()
            } catch (error) {
              errors.push(error)
            }
          }
          if (errors.length === 1) throw errors[0]
          if (errors.length > 1) throw cleanupFailure(errors)
        }
      }
    } catch (error) {
      if (!transferred) {
        try {
          await endpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(options.report, cleanupError)
        }
      }
      if (mode === 'per-connection' && targetHost) {
        try {
          await closeTarget?.()
        } catch (cleanupError) {
          reportSafely(options.report, cleanupError)
        }
      }
      throw error
    }
  }
}
