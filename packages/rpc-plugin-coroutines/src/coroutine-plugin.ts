import { RpcTransportMode } from '@migaia/rpc-host/plugin'
import {
  createAdapterDeployment,
  createAdapterConfigurationError,
  defineTransportPlugin,
  RuntimePluginKey,
  RuntimeApiErrorText,
  type IAdapterDeploymentContext,
  type IAdapterManagedDeployment,
  type IRpcConnectOptions,
  type IRpcTransportPlugin,
  type IRemoteBinding,
  type IRuntimePeerOptions
} from '@migaia/rpc-host/plugin'
import {
  createCoroutineBinding,
  openCoroutineConnection,
  type ICoroutineSupervisorPolicy
} from './coroutine-binding.js'
import {
  createCoroutineSourceError,
  portOf,
  reporterOf,
  wrapCoroutineTask,
  type ICoroutineConnect,
  type ICoroutineReplaceSpec,
  type ICoroutineUserTask
} from './coroutine-task.js'

/** The original coroutine outlet family is shared by every installation and source mode. */
const coroutineRuntimeSlotFamily = Object.freeze({})

/** Existing local provider and diagnostic options remain cold, without a callable source factory. */
type ICoroutineCommonOptions = Omit<
  IRuntimePeerOptions,
  'spawn' | 'connect' | 'listen' | 'endpointFactory'
> &
  Readonly<{
    /** Native local registration name is independent of either endpoint's handshake identity. */
    name?: string
    /** Ordinary Host provider selection is compiled by the canonical native installation. */
    expose?: readonly string[]
    /** The SDK shares this budget between the original identity and ACK preparation phases. */
    connect?: IRpcConnectOptions
  }>

/** Select one cooperative task or the exact opaque connection supplied to its current generation. */
export type ICoroutinePluginOptions = ICoroutineCommonOptions &
  (
    | Readonly<{
        spawn: ICoroutineUserTask
        supervisor?: ICoroutineSupervisorPolicy
        connectToParent?: never
      }>
    | Readonly<{
        connectToParent: ICoroutineConnect
        spawn?: never
        supervisor?: never
      }>
  )

/** Each opening creates the original actual supervisor/binding, while the Host owns its endpoint. */
function managedCoroutine(
  context: IAdapterDeploymentContext,
  task: ICoroutineUserTask,
  options: ICoroutineCommonOptions,
  policy: ICoroutineSupervisorPolicy | undefined
): IAdapterManagedDeployment {
  /** Preserve an explicit original sink; otherwise borrow the canonical Host's effective reporter. */
  const report = options.report ?? context.report
  /** The existing binding retains native generation, lease, cooperative stop and drain ownership. */
  const binding = createCoroutineBinding(
    { context, connectTimeoutMs: context.connectTimeoutMs },
    task,
    report,
    policy
  )
  return {
    binding: binding as unknown as IRemoteBinding<unknown, unknown>,
    execution: binding.supervisor as unknown as IAdapterManagedDeployment['execution'],
    bindEndpoint: binding.bindEndpoint,
    beforeRelease: () => binding.drainCurrent(),
    /** The generic outlet delegates only task preparation; its replacement transaction is unchanged. */
    prepareReplacement: (spec) => {
      /** Undefined retains the original supervisor's reuse-current-spec behavior. */
      const replacement = spec as ICoroutineReplaceSpec | undefined
      if (spec !== undefined && typeof replacement?.task !== 'function')
        throw createAdapterConfigurationError(RuntimeApiErrorText.coroutineReplaceInvalid)
      return spec === undefined
        ? undefined
        : { task: wrapCoroutineTask(replacement!.task, reporterOf(binding.supervisor)) }
    }
  }
}

/** Capture a genuine cooperative source without acquiring ports, launching work or creating a Peer. */
export function coroutinePlugin(options: ICoroutinePluginOptions): IRpcTransportPlugin {
  /** Only source admission changes to this package's TypeError domain. */
  const task = options?.spawn
  /** The opaque object is read once and validated against this same package's original token map. */
  const parent = options?.connectToParent
  if (
    (task !== undefined) === (parent !== undefined) ||
    (task !== undefined && typeof task !== 'function') ||
    (parent !== undefined && options.supervisor !== undefined)
  )
    throw createCoroutineSourceError()
  if (parent !== undefined) portOf(parent)
  /** The original source policy is fixed for this cold installation, independently of Host state. */
  const policy = options.supervisor
  /** Keep all existing explicit local configuration for ordinary Host provider/probe installation. */
  const {
    spawn: _task,
    connectToParent: _parent,
    supervisor: _policy,
    connect: _connect,
    ...local
  } = options
  /** No connection or supervisor state is stored on the reusable plugin definition. */
  const deployment = createAdapterDeployment({
    runtimeKey: RuntimePluginKey.coroutine,
    runtimeFamily: coroutineRuntimeSlotFamily,
    runtimeOptions: local,
    open: async (context) => {
      if (parent === undefined) throw createCoroutineSourceError()
      return openCoroutineConnection(
        portOf(parent),
        { context, connectTimeoutMs: context.connectTimeoutMs },
        context.signal,
        context.report
      )
    },
    ...(task
      ? {
          managed: async (context: IAdapterDeploymentContext) =>
            managedCoroutine(context, task, local, policy)
        }
      : {})
  })
  return defineTransportPlugin({
    name: options.name ?? RuntimePluginKey.coroutine,
    expose: options.expose,
    connect: options.connect,
    mode: task ? RpcTransportMode.spawn : RpcTransportMode['connect-to-parent'],
    deployment
  })
}
