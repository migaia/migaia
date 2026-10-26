/**
 * Defines cold Thread spawn/parent recipes and installs their complete call or pool features.
 * Native sources acquire Workers; Host retains Session and provider ownership.
 */
import { detectServerRuntime, type IUrlLike } from '@migaia/utils'
import {
  defineTransportPlugin,
  RpcNativeFeatureKind,
  RpcNativePoolMember
} from '@migaia/rpc-host/sdk'
import type {
  IRpcNativeMemberControls,
  IRpcTransportPlugin,
  IRpcTransportSetupContext,
  IRpcNativeTransportFeature,
  IRpcFlowFeature,
  IRpcTransportFeatureExtensions,
  IRpcNativePoolEvents
} from '@migaia/rpc-host/sdk'
import type { IRpcAuthenticationRetain, IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import { RpcError, RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { isNativeThreadChild } from './child.js'
import { threadRuntimeResource } from './runtime-resource.js'
import { expandThreadSpawn, isShortThreadSpawn, type IThreadShortSpawn } from './short-spawn.js'
import { ThreadSource, type IThreadSpawn } from './source.js'
import { openThreadParent } from './parent.js'
import { THREAD_NAMESPACE } from './constants.js'

/** Transport installation is cold; self and lifecycle authority belong to the receiving Host. */
export type IThreadCommonOptions = Readonly<{
  name?: string
  namespace?: string
  expose?: readonly string[]
  features?: readonly (IRpcCallFeature | IRpcNativeTransportFeature | IRpcFlowFeature<object>)[]
  /** Local connection policy remains independent from native launch/bootstrap objects. */
  connect?: Readonly<{ retain?: IRpcAuthenticationRetain }>
  report?(error: unknown): void
}>
/** Sources are real native recipes or entry shorthand, never callbacks returning completed Peers. */
export type IThreadSpawnSource = IThreadSpawn | IThreadShortSpawn | true | IUrlLike
/** Native member controls are contributed through the one transport namespace extension. */
export type IThreadNamespaceExtensions = Readonly<{ members: IRpcNativeMemberControls<'thread'> }>
/** Exactly one actual source is selected before any Worker or Session can be acquired. */
export type IThreadPluginOptions = IThreadCommonOptions &
  (
    | Readonly<{ spawn: IThreadSpawnSource; connectToParent?: never }>
    | Readonly<{ connectToParent: true; spawn?: never }>
  )

/** One named installation owns its actual native source and original SDK generation registration. */
class ThreadInstallation {
  /** Cold options retain actual native launcher/budget objects without reconstructing their policy. */
  readonly #options: IThreadPluginOptions
  /** Capture only configuration; native acquisition begins in the receiving Host's install. */
  constructor(options: IThreadPluginOptions) {
    this.#options = options
  }
  /** Open parent or managed source directly through the unique SDK/Session boundary. */
  readonly open = async (context: IRpcTransportSetupContext) => {
    /** Native diagnostics retain explicit plugin then Host reporter priority without rebuilding it. */
    const report = this.#options.report ?? context.configuredReport ?? context.report
    /** Only the diagnostic sink differs; the original core and native lifecycle ports are borrowed. */
    const nativeContext = report === context.report ? context : { ...context, report }
    /** Complete native features acquire members only through this source's repeatable constructor. */
    const feature = this.#options.features?.find(
      (value) => 'kind' in value && value.kind === RpcNativeFeatureKind.pool
    )
    if (feature && 'kind' in feature && feature.kind === RpcNativeFeatureKind.pool) {
      /** The complete feature returns its original controls and one resource disposer. */
      const installed = await feature.install({
        ...nativeContext,
        memberKind: 'thread',
        ...(this.#options.connectToParent ? {} : { openMember: this.#openMember })
      })
      return {
        namespaceExtensions: installed.value as IThreadNamespaceExtensions,
        dispose: installed.dispose
      }
    }
    if (this.#options.connectToParent)
      return openThreadParent(nativeContext, this.#options.name ?? THREAD_NAMESPACE)
    /** The source's native supervisor is the only execution owner. */
    const connection = await this.#source(nativeContext)
    return {
      namespaceExtensions: { members: connection.members!.value },
      dispose: () => connection.close()
    }
  }
  /** Repeat original shorthand expansion so each original default one-unit budget stays independent. */
  async #source(context: IRpcTransportSetupContext, events?: IRpcNativePoolEvents) {
    /** Shorthand expansion keeps native runtime precedence, original budget and scheduler defaults. */
    const source = isShortThreadSpawn(this.#options.spawn)
      ? await expandThreadSpawn(this.#options, threadRuntimeResource, context.report)
      : (this.#options.spawn as IThreadSpawn)
    /** The source's native supervisor is the only execution owner. */
    const connection = new ThreadSource(source, context, this.#options.name, events)
    try {
      await connection.generation.open()
    } catch (primary) {
      try {
        await connection.close()
      } catch (cleanup) {
        context.report(cleanup)
      }
      throw primary
    }
    return connection
  }
  /** Private attachment borrows the one SDK generation without creating another member receiver. */
  readonly #openMember = async (
    context: IRpcTransportSetupContext,
    events: IRpcNativePoolEvents
  ) => {
    /** Source readiness and rollback stay in the original native acquisition owner. */
    const source = await this.#source(context, events)
    return new RpcNativePoolMember({
      record: source.record,
      native: source.generation,
      close: () => source.close()
    })
  }
}

/** Define a reusable native transport; one invalid source fails before Worker acquisition. */
export function threadPlugin<
  const N extends string = typeof THREAD_NAMESPACE,
  E extends object = Record<never, never>,
  const TFeatures extends readonly (
    | IRpcCallFeature
    | IRpcNativeTransportFeature
    | IRpcFlowFeature<object>
  )[] = readonly (IRpcCallFeature | IRpcNativeTransportFeature | IRpcFlowFeature<object>)[]
>(
  options: IThreadPluginOptions &
    Readonly<{
      namespace?: N
      features?: TFeatures &
        readonly (IRpcCallFeature | IRpcNativeTransportFeature<E> | IRpcFlowFeature<object>)[]
    }>
): IRpcTransportPlugin<
  N,
  IThreadNamespaceExtensions & E & IRpcTransportFeatureExtensions<TFeatures[number]>,
  true
> {
  /** Runtime and exactly-one-source admission retain the original public source diagnostic. */
  const configured = options as IThreadPluginOptions & { connectToParent?: unknown }
  /** Omitted configuration is rejected synchronously without touching any native resource. */
  const spawn = configured?.spawn
  /** Parent must be the literal true and must refer to a genuine native child runtime. */
  const parent = configured?.connectToParent
  if (
    detectServerRuntime() === undefined ||
    (parent !== undefined && parent !== true) ||
    (spawn === undefined) === (parent !== true) ||
    typeof spawn === 'function' ||
    (parent === true && !isNativeThreadChild())
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.sourceInvalid)
  /** Native plugin installation merges this member surface once under its declared namespace. */
  const installation = new ThreadInstallation(configured)
  /** The default literal and explicit caller namespace retain their public type identity. */
  const namespace = (configured.namespace ?? THREAD_NAMESPACE) as N
  return defineTransportPlugin({
    name: configured.name ?? THREAD_NAMESPACE,
    namespace,
    closingWrites: true,
    expose: configured.expose,
    features: configured.features,
    connect: { retain: configured.connect?.retain },
    open: installation.open
  }) as IRpcTransportPlugin<
    N,
    IThreadNamespaceExtensions & E & IRpcTransportFeatureExtensions<TFeatures[number]>,
    true
  >
}
