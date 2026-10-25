/** Native namespaces own calls and member controls; Tray owns only its instance admission. */
import type { IRpcNamespace, IRpcCallOptions } from '@migaia/rpc-host'
import type {
  IRpcNativeMemberControls,
  RpcNativeMemberKind,
  rpcHostPipelines
} from '@migaia/rpc-host/sdk'
import { timeout } from '@migaia/rpc-host/features'
import {
  coroutinePlugin,
  type ICoroutineConnect,
  type ICoroutineUserTask
} from '@migaia/rpc-plugin-coroutines'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import type { IPluginConstraint, IHostHandle } from '@migaia/plugin-host'
import type { IRpcProbe } from '@migaia/rpc-host/plugins/probe'
import { TrayInternal, TrayRuntime, TrayRuntimeMode } from './constants.js'
import type { IAnyTrayHost, ITrayCallOptions } from './typing.js'

/** This is the actual published RPC namespace, without a separate callable facade. */
export type ITrayRuntimeOutlet = IRpcNamespace &
  Readonly<{ members: IRpcNativeMemberControls<RpcNativeMemberKind> }>
/** Business and RPC definitions share the original receiving native plugin-host. */
export type ITrayRuntimeHost = IHostHandle<
  ReturnType<ReturnType<typeof rpcHostPipelines>['domainCore']>,
  never,
  readonly IPluginConstraint<any>[],
  Record<never, never>,
  ReturnType<typeof rpcHostPipelines>['pipelines']
> &
  Partial<Record<string, ITrayRuntimeOutlet>>
/** Parent and child install the same actual observer before native transport acquisition. */
export type ITrayRuntimeOptions = Readonly<{
  report(error: unknown): void
  probe?: IRpcProbe | readonly IRpcProbe[]
}>
/** Keep arbitrary Tray admission ids away from the native Host's reserved root properties. */
function instanceNamespace(id: string): string {
  return `${TrayInternal.namespacePrefix}${id}`
}
/** Translate Tray's unchanged delay option into the sole supported complete RPC feature form. */
export function rpcCallOptions(options?: ITrayCallOptions): IRpcCallOptions | undefined {
  if (options === undefined) return undefined
  return {
    signal: options.signal,
    ...(options.timeoutMs === undefined ? {} : { timeout: timeout({ ms: options.timeoutMs }) })
  }
}
/** Runtime and mode select one native source; per-admission parent namespaces cannot collide. */
export function runtimePlugin(
  definition: IAnyTrayHost,
  mode: TrayRuntimeMode,
  options: ITrayRuntimeOptions &
    Readonly<{ id?: string; connect?: ICoroutineConnect; task?: ICoroutineUserTask }>
): IPluginConstraint<any> {
  /** Native plugin name remains the supervision registration name, separate from namespace. */
  const common = {
    name: mode === TrayRuntimeMode.parent ? options.id! : TrayInternal.connection,
    namespace:
      mode === TrayRuntimeMode.parent ? instanceNamespace(options.id!) : definition.runtime,
    expose: [mode === TrayRuntimeMode.parent ? TrayInternal.relayPlugin : TrayInternal.childPlugin],
    report: options.report
  }
  if (definition.runtime === TrayRuntime.coroutine)
    return coroutinePlugin(
      mode === TrayRuntimeMode.parent
        ? { ...common, spawn: options.task!, supervisor: definition.supervisor }
        : { ...common, connectToParent: options.connect! }
    ) as IPluginConstraint<any>
  if (definition.runtime === TrayRuntime.thread)
    return threadPlugin(
      mode === TrayRuntimeMode.parent
        ? {
            ...common,
            spawn: {
              entry: definition.entry!,
              limits: definition.limits,
              supervisor: definition.supervisor
            }
          }
        : { ...common, connectToParent: true }
    ) as IPluginConstraint<any>
  return processPlugin(
    mode === TrayRuntimeMode.parent
      ? {
          ...common,
          spawn: {
            entry: definition.entry!,
            supervision: definition.supervisor,
            ...(definition.sandbox ? { wrap: definition.sandbox.wrap } : {})
          }
        }
      : { ...common, connectToParent: true }
  ) as IPluginConstraint<any>
}
/** Read the current actual namespace so removing and re-admitting an id cannot revive old calls. */
export function outletOf(
  host: ITrayRuntimeHost,
  definition: IAnyTrayHost,
  id?: string
): ITrayRuntimeOutlet {
  return host[id === undefined ? definition.runtime : instanceNamespace(id)]!
}
