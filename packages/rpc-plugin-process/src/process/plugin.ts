/** Install one native Process recipe and its features; the Host owns Sessions and all RPC work. */
import { detectServerRuntime } from '@migaia/utils'
import {
  defineTransportPlugin,
  RpcNativeFeatureKind,
  RpcNativePoolMember,
  type IRpcTransportSetupContext,
  type IRpcTransportPlugin,
  type IRpcNativeMemberControls,
  type IRpcNativePoolEvents,
  type IRpcNativeTransportFeature,
  type IRpcTransportFeatureExtensions
} from '@migaia/rpc-host/sdk'
import { RpcError, RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcAuthenticationRetain } from '@migaia/rpc-contract/interfaces'
import { PROCESS_NAMESPACE } from './constants.ts'
import { isProcessChild } from './child.ts'
import { NativeProcessRuntimeLoader, type IAdapterProcessRuntimeModule } from './runtime-loader.ts'
import { openAutomaticProcessIO } from './automatic-peer.ts'
import { invalidProcessRuntimeBootstrap } from './runtime-bootstrap.ts'
import {
  normalizeProcessSources,
  type IProcessShortSpawn,
  type IProcessShortSourceOptions,
  type IProcessSourceOptions
} from './adapters/short-source.ts'
import {
  createSpawnProcessBinding,
  createConnectProcessBinding,
  reportSafely
} from './plugin/binding.ts'
import { serveProcessSessions } from './plugin/serve.ts'
import type { IProcessFeature, IProcessServeChildIngress } from './plugin/types.ts'

/** Source grammar is native short/full acquisition rather than a callback returning an endpoint. */
export type IProcessSpawnSource = NonNullable<IProcessSourceOptions['spawn']>
/** Connection recipes keep the original exact local address and dialer. */
export type IProcessConnectSource = NonNullable<IProcessSourceOptions['connect']>
/** Listener recipes retain the original actual bind/accept owner. */
export type IProcessListenSource = NonNullable<IProcessSourceOptions['listen']>
/** Cold configuration captures native defaults before installation in the one actual Host. */
export type IProcessPluginCommonOptions = Omit<IProcessShortSpawn, 'entry'> &
  IProcessShortSourceOptions &
  Readonly<{
    name?: string
    namespace?: string
    expose?: readonly string[]
    features?: readonly IProcessFeature[]
    report?(error: unknown): void
    parentLoss?: IProcessServeChildIngress['parentLoss']
  }>
/** Generic connection policy borrows the original connect decorator; only target selects a source. */
export type IProcessConnectDeadline = Readonly<{
  timeoutMs?: number
  /** Completed request retention overrides auth only on this native connection. */
  retain?: IRpcAuthenticationRetain
}>
/** Exactly one physical source is selected synchronously before native resources are acquired. */
export type IProcessPluginOptions = IProcessPluginCommonOptions &
  (
    | Readonly<{
        spawn: IProcessSpawnSource
        connect?: IProcessConnectDeadline
        listen?: never
        connectToParent?: never
      }>
    | Readonly<{
        connect: IProcessConnectDeadline & { target: IProcessConnectSource }
        spawn?: never
        listen?: never
        connectToParent?: never
      }>
    | Readonly<{
        listen: IProcessListenSource
        spawn?: never
        connect?: IProcessConnectDeadline
        connectToParent?: never
      }>
    | Readonly<{
        connectToParent: true
        spawn?: never
        connect?: IProcessConnectDeadline
        listen?: never
      }>
  )
/** Native controls are contributed through the same unique namespace extension channel. */
export type IProcessNamespaceExtensions = Readonly<{ members: IRpcNativeMemberControls<'process'> }>

/** Native discovery and its original bootstrap tail transfer once to the child Session admission. */
async function openParentProcessRaw(
  module: IAdapterProcessRuntimeModule,
  discovery: ReturnType<IAdapterProcessRuntimeModule['processRuntimeIO']['discover']>
) {
  /** The original native receiver remains responsible for opening actual runtime streams. */
  const opened = await openAutomaticProcessIO({
    ...discovery,
    open: () => module.processRuntimeIO.open()
  })
  if (!opened.bootstrap) {
    await opened.channel.close()
    invalidProcessRuntimeBootstrap()
  }
  return { raw: opened.channel, bootstrap: opened.bootstrap }
}

/** This native installation opens original IO; Host alone attaches and admits actual Sessions. */
class ProcessInstallation {
  /** The complete native recipe and feature instances are cold captured configuration. */
  readonly #options: IProcessPluginOptions
  /** Capture no socket, process, reader or supervisor until the actual install begins. */
  constructor(options: IProcessPluginOptions) {
    this.#options = Object.freeze({ ...options })
  }
  /** Attach a genuine automatic parent or a managed native source under one actual namespace. */
  readonly open = async (context: IRpcTransportSetupContext) => {
    /** The caller's configured native reporter remains the original diagnostic sink. */
    const nativeContext = this.#options.report
      ? { ...context, report: this.#options.report }
      : context
    /** Unsupported parent/listener sources expose no repeatable acquisition capability. */
    const feature = this.#options.features?.find(
      (value) => 'kind' in value && value.kind === RpcNativeFeatureKind.pool
    )
    if (feature && 'kind' in feature && feature.kind === RpcNativeFeatureKind.pool) {
      /** The complete feature returns its original controls and one resource disposer. */
      const installed = await feature.install({
        ...nativeContext,
        memberKind: 'process',
        ...(this.#options.spawn || (this.#options.connect && 'target' in this.#options.connect)
          ? { openMember: this.#openMember }
          : {})
      })
      return {
        namespaceExtensions: installed.value as IProcessNamespaceExtensions,
        dispose: installed.dispose
      }
    }
    /** Runtime selection remains the original lazy native Node/Bun/Deno module loader. */
    const loaded = new NativeProcessRuntimeLoader().load()
    if (!loaded)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
    /** This module owns actual stdio discovery and platform-specific final exit. */
    const module = await loaded
    /** Consumed native markers remain local to this process before opening any child IO. */
    const discovery = module.processRuntimeIO.discover()
    if (this.#options.connectToParent) {
      /** Parent guard is constructed by serve before this callback begins its bootstrap wait. */
      const ingress: IProcessServeChildIngress = {
        kind: 'child',
        channelKind: 'byte',
        parentLoss: this.#options.parentLoss ?? { exit: module.processRuntimeIO.exit },
        openRaw: () => openParentProcessRaw(module, discovery)
      }
      return this.#serve(ingress, nativeContext)
    }
    /**
     * Ordinary defaults expand only the selected source and preserve original launcher/spec
     * objects.
     */
    const sources = await this.#normalize(nativeContext, discovery.runtime)
    if (sources.listen) return this.#serve(sources.listen, nativeContext)
    /** Ordinary installation publishes the actual source's one passive members receiver. */
    const source = await this.#source(nativeContext, sources)
    return {
      namespaceExtensions: { members: source.members!.value },
      dispose: () => source.close()
    }
  }
  /** Repeating shorthand expansion retains each original default budget and private bootstrap. */
  #normalize(context: IRpcTransportSetupContext, runtime: string) {
    return normalizeProcessSources(
      {
        ...this.#options,
        report: this.#options.report ?? context.configuredReport,
        connect:
          this.#options.connect && 'target' in this.#options.connect
            ? this.#options.connect.target
            : undefined
      },
      runtime,
      this.#options
    )
  }
  /** Both acquisition paths use the same original native binding and shared SDK generation. */
  async #source(
    context: IRpcTransportSetupContext,
    sources: Awaited<ReturnType<typeof normalizeProcessSources>>,
    events?: IRpcNativePoolEvents
  ) {
    /** Name remains distinct from the original supervisor id and actual instance fingerprint. */
    const name = this.#options.name ?? PROCESS_NAMESPACE
    /** Both spawn and connect reuse the same SDK generation owner and actual native supervisor. */
    const source = sources.spawn
      ? createSpawnProcessBinding(
          sources.spawn,
          context,
          this.#options.name,
          this.#options.features,
          events
        )
      : sources.connect
        ? createConnectProcessBinding(
            {
              ...sources.connect,
              supervision:
                sources.connect.supervision ??
                (this.#options
                  .supervision as import('./plugin/types.ts').IConnectProcessPluginDeployment['supervision'])
            },
            context,
            name,
            this.#options.features,
            events
          )
        : undefined
    if (!source)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
    try {
      await source.generation.open()
    } catch (primary) {
      try {
        await source.close()
      } catch (cleanup) {
        reportSafely(context.report, cleanup)
      }
      throw primary
    }
    return source
  }
  /** Pool repeats only the real managed recipe; private Session attachment is supplied by SDK. */
  readonly #openMember = async (
    context: IRpcTransportSetupContext,
    events: IRpcNativePoolEvents
  ) => {
    const loaded = new NativeProcessRuntimeLoader().load()
    if (!loaded)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
    /** The genuine platform module supplies the original source normalization defaults. */
    const module = await loaded
    /** One native source owns the original supervisor, raw channel and cleanup. */
    const source = await this.#source(
      context,
      await this.#normalize(context, module.processRuntimeIO.discover().runtime),
      events
    )
    return new RpcNativePoolMember({
      record: source.record,
      native: source.generation,
      close: () => source.close()
    })
  }
  /** Listener and child acquisition borrow the same actual native serve/cascade/EOF owner. */
  async #serve(
    ingress: Parameters<typeof serveProcessSessions>[0],
    context: IRpcTransportSetupContext
  ) {
    /** Per-connection features execute only when this original ingress adopts its real raw channel. */
    const sessions = await serveProcessSessions(ingress, context, {
      features: this.#options.features
    })
    return { namespaceExtensions: { members: sessions.members }, dispose: sessions.close }
  }
}

/** Define the cold process transport; ambiguous or unsupported sources reject before native launch. */
export function processPlugin<
  const N extends string = typeof PROCESS_NAMESPACE,
  E extends object = Record<never, never>,
  const TFeatures extends readonly IProcessFeature[] = readonly IProcessFeature[]
>(
  options: IProcessPluginOptions &
    Readonly<{
      namespace?: N
      features?: TFeatures &
        readonly (
          | Exclude<IProcessFeature, IRpcNativeTransportFeature>
          | IRpcNativeTransportFeature<E>
        )[]
    }>
): IRpcTransportPlugin<
  N,
  IProcessNamespaceExtensions & E & IRpcTransportFeatureExtensions<TFeatures[number]>,
  true
> {
  /** Runtime input may arrive from plain JavaScript; capture its four existing physical source arms. */
  const configured = options as IProcessPluginOptions & { connectToParent?: unknown }
  /** Native source selection is independent from routing metadata or an incoming peer claim. */
  const choices = [
    configured?.spawn,
    configured?.connect && 'target' in configured.connect ? configured.connect.target : undefined,
    configured?.listen,
    configured?.connectToParent === true ? true : undefined
  ]
  if (
    !detectServerRuntime() ||
    choices.filter((value) => value !== undefined).length !== 1 ||
    choices.some((value) => value === null || typeof value === 'function') ||
    (configured?.connectToParent !== undefined && configured.connectToParent !== true) ||
    (configured.connectToParent === true && !isProcessChild())
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  /** One native installation publishes its original member controls at this explicit namespace. */
  const installation = new ProcessInstallation(configured)
  return defineTransportPlugin({
    name: configured.name ?? PROCESS_NAMESPACE,
    namespace: (configured.namespace ?? PROCESS_NAMESPACE) as N,
    closingWrites: true,
    expose: configured.expose,
    features: configured.features,
    nameAdmissionTimeoutMs: configured.connect?.timeoutMs,
    connect: { retain: configured.connect?.retain },
    open: installation.open
  }) as IRpcTransportPlugin<
    N,
    IProcessNamespaceExtensions & E & IRpcTransportFeatureExtensions<TFeatures[number]>,
    true
  >
}
