import { assembleAdapterPlugin, captureAdapterTask } from '../../runtime-adapter/definition.js'
import { createRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { createRuntimePlugin, type IRuntimePluginOptions } from './plugin.js'
import type { IRuntimePeerProvide } from './peer.js'
import type { IRuntimeExpose, IRuntimePluginTyping, IRuntimeRegistry } from './typing.js'
import { RuntimeApiErrorText, RuntimePluginKey } from './constants.js'
import {
  createCoroutineBinding,
  getCoroutineMessageAdapter,
  type ICoroutineSupervisorPolicy
} from './coroutine-binding.js'
import type { ICoroutineConnect, ICoroutineUserTask } from './coroutine-task.js'
import { defaultRpcReporter } from '../../core/internal/diagnostic-reporter.js'

/** This physical owner retains the stable token for the real Host coroutine slot. */
const coroutineRuntimeSlotFamily = Object.freeze({})

/** Coroutine sources expose only parent task or opaque child connection, never isolation. */
type ICoroutineCommonOptions = Omit<
  IRuntimePluginOptions<never>,
  'spawn' | 'connect' | 'listen' | 'name' | 'provide' | 'expose'
>

/** Parent installation creates one managed cooperative unit using existing supervision. */
export type ICoroutineParentOptions = ICoroutineCommonOptions &
  Readonly<{ task: ICoroutineUserTask; supervisor?: ICoroutineSupervisorPolicy; connect?: never }>

/** Child installation connects its task generation and creates no additional unit. */
export type ICoroutineChildOptions = ICoroutineCommonOptions &
  Readonly<{ connect: ICoroutineConnect; task?: never; supervisor?: never }>

/** Install one parent or child connection into the canonical coroutine Host slot. */
export function createCoroutinePlugin<
  TRemote = Record<never, never>,
  const TProvide extends IRuntimePeerProvide = Record<never, never>,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: (ICoroutineParentOptions | ICoroutineChildOptions) &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>
): ReturnType<typeof createRuntimePlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'coroutine'> {
  if (
    (options.task !== undefined) === (options.connect !== undefined) ||
    (options.task !== undefined && typeof options.task !== 'function')
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.coroutineModeInvalid)
  /** Each install captures only its own physical source inputs; common assembly compiles provide. */
  const task = options.task
  /** The family retains its original policy without exposing a source grammar to Core. */
  const policy = options.supervisor
  /** An opaque child token is interpreted only by the recipe's raw open operation. */
  const connect = options.connect
  /** The canonical message recipe serves both family modes. */
  const adapter = getCoroutineMessageAdapter()
  return assembleAdapterPlugin(
    adapter,
    options as IRuntimePluginOptions<never, ICoroutineConnect>,
    {
      key: RuntimePluginKey.coroutine,
      acquire: (integration, create) =>
        integration.acquireSharedSlot(
          RuntimePluginKey.coroutine,
          coroutineRuntimeSlotFamily,
          create
        )
    },
    (peerOptions) => {
      if (!task)
        return getCoroutineMessageAdapter().peer({
          ...peerOptions,
          spawn: undefined,
          listen: undefined,
          connect
        })
      /** Capture the original Host provenance before managed options copy the prepared identity. */
      const captured = captureAdapterTask(adapter, peerOptions, RuntimePluginKey.coroutine)
      /** Managed describe and parent identity exchange must announce this exact same self. */
      const managedOptions = { ...peerOptions, self: captured.preparation.context.self }
      /** Original binding resources own task ports, supervision, drain and teardown. */
      const binding = createCoroutineBinding(
        captured.preparation,
        task,
        peerOptions.report ?? defaultRpcReporter,
        policy
      )
      return captured.managed(managedOptions, binding, binding.supervisor)
    }
  ) as ReturnType<typeof createRuntimePlugin> &
    IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'coroutine'>
}
