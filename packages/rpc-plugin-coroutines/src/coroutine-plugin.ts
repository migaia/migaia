/**
 * Defines the cold coroutine transport and installs complete call or native pool features. Task
 * acquisition and borrowed-port ownership stay with CoroutineSource; Host owns Sessions and
 * providers.
 */
import {
  defineTransportPlugin,
  RpcNativeFeatureKind,
  RpcNativePoolMember,
  type IRpcNativePoolEvents,
  type IRpcNativeTransportFeature,
  type IRpcTransportSetupContext,
  type IRpcNativeMemberControls,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'
import type { IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import { CoroutineSource, type ICoroutineSupervisorPolicy } from './coroutine-source.js'
import {
  connectionOf,
  createCoroutineSourceError,
  type ICoroutineConnect,
  type ICoroutineUserTask
} from './coroutine-task.js'
import { CoroutineText } from './error-text.js'

/** Host owns self/provider/auth; native coroutine configuration contains only its actual source. */
export type ICoroutineCommonOptions = Readonly<{
  name?: string
  namespace?: string
  expose?: readonly string[]
  features?: readonly (IRpcCallFeature | IRpcNativeTransportFeature)[]
  report?(error: unknown): void
}>
/** Exactly one original native source is admitted before any task or port can be acquired. */
export type ICoroutinePluginOptions = ICoroutineCommonOptions &
  (
    | Readonly<{
        spawn: ICoroutineUserTask
        supervisor?: ICoroutineSupervisorPolicy
        connectToParent?: never
      }>
    | Readonly<{ connectToParent: ICoroutineConnect; spawn?: never; supervisor?: never }>
  )
/** Members borrow genuine supervision; the coroutine never gains another business-call facade. */
export type ICoroutineNamespaceExtensions = Readonly<{
  members: IRpcNativeMemberControls<'coroutine'>
}>

/** One native recipe supports direct attachment or repeated private acquisition by its feature. */
class CoroutineInstallation {
  /** Only source configuration is retained before actual installation begins. */
  readonly #options: ICoroutinePluginOptions
  /** The original admitted task or parent token cannot change through later getter reads. */
  readonly #source: Readonly<{ task?: ICoroutineUserTask; parent?: ICoroutineConnect }>
  /** Capture a native recipe without acquiring a task, supervisor, or Session. */
  constructor(
    options: ICoroutinePluginOptions,
    source: Readonly<{ task?: ICoroutineUserTask; parent?: ICoroutineConnect }>
  ) {
    this.#options = options
    this.#source = source
  }
  /** Complete native features own their scheduling; parent tokens expose no repeatable opener. */
  readonly open = async (context: IRpcTransportSetupContext) => {
    /** Native selection is cold; call timeout/retry definitions stay untouched. */
    const feature = this.#options.features?.find(
      (value) => value.kind === RpcNativeFeatureKind.pool
    )
    if (feature?.kind === RpcNativeFeatureKind.pool) {
      /** The complete feature returns its original controls and one resource disposer. */
      const installed = await feature.install({
        ...context,
        memberKind: 'coroutine',
        ...(this.#source.task ? { openMember: this.#openMember } : {})
      })
      return {
        namespaceExtensions: installed.value as ICoroutineNamespaceExtensions,
        dispose: installed.dispose
      }
    }
    return new CoroutineSource(this.#options, context, this.#source).open()
  }
  /** Every member uses the actual original task wrapper, supervisor and shared generation. */
  readonly #openMember = async (
    context: IRpcTransportSetupContext,
    events: IRpcNativePoolEvents
  ) => {
    /** The acquired task keeps its own original supervisor and native generation. */
    const source = new CoroutineSource(this.#options, context, this.#source, events)
    await source.ready()
    return new RpcNativePoolMember({
      record: source.record,
      native: source.generation!,
      close: source.close
    })
  }
}

/** Capture a cold actual source; the original factory name remains the single public entry. */
export function coroutinePlugin<
  const N extends string = typeof CoroutineText.namespace,
  E extends object = Record<never, never>
>(
  options: ICoroutinePluginOptions &
    Readonly<{
      namespace?: N
      features?: readonly (IRpcCallFeature | IRpcNativeTransportFeature<E>)[]
    }>
): IRpcTransportPlugin<N, ICoroutineNamespaceExtensions & E> {
  /** Source selection retains native TypeError/source/code and does no IO. */
  const task = options?.spawn,
    parent = options?.connectToParent
  if (
    (task !== undefined) === (parent !== undefined) ||
    (task !== undefined && typeof task !== 'function') ||
    (parent !== undefined && options.supervisor !== undefined)
  )
    throw createCoroutineSourceError()
  if (parent !== undefined) connectionOf(parent)
  /** The synchronously admitted native source cannot change through later getter reads. */
  const source = { task, parent }
  /** The same constructor owns ordinary and feature-selected native acquisition. */
  const installation = new CoroutineInstallation(options, source)
  return defineTransportPlugin({
    name: options.name ?? CoroutineText.namespace,
    namespace: (options.namespace ?? CoroutineText.namespace) as N,
    expose: options.expose,
    features: options.features,
    open: installation.open
  }) as IRpcTransportPlugin<N, ICoroutineNamespaceExtensions & E>
}
