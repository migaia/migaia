/** Native namespaces own calls and member controls; Tray owns only its instance admission. */
import type { IRpcNamespace, IRpcCallOptions } from '@migaia/rpc-host'
import type {
  IRpcNativeMemberControls,
  RpcNativeMemberKind,
  rpcHostPipelines
} from '@migaia/rpc-host/sdk'
import {
  defineRpcSourcePlugin,
  defineTransportPlugin,
  type IRpcTransportPlugin
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
export type ITrayRuntimeOutlet = IRpcNamespace
/** Exact native controls remain owned by one actual source and its supervisor. */
export type ITrayRuntimeMembers = IRpcNativeMemberControls<RpcNativeMemberKind>
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
/** The parent admits one fixed namespace without acquiring a process, Worker or task. */
export function parentRuntimeTransport(): IRpcTransportPlugin<
  typeof TrayInternal.connection,
  Record<never, never>,
  true
> {
  return defineTransportPlugin({
    name: TrayInternal.transportPlugin,
    namespace: TrayInternal.connection,
    closingWrites: true,
    expose: [TrayInternal.relayPlugin],
    open: () => ({ dispose: () => undefined })
  })
}
/** Translate Tray's unchanged delay option into the sole supported complete RPC feature form. */
export function rpcCallOptions(options?: ITrayCallOptions): IRpcCallOptions | undefined {
  if (options === undefined) return undefined
  return {
    signal: options.signal,
    ...(options.timeoutMs === undefined ? {} : { timeout: timeout({ ms: options.timeoutMs }) })
  }
}
/** Runtime selects the original native source; parent sources append to its fixed cold namespace. */
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
  /** Every branch retains the concrete factory's original source and native member implementation. */
  let plugin: IRpcTransportPlugin
  if (definition.runtime === TrayRuntime.coroutine)
    plugin = coroutinePlugin(
      mode === TrayRuntimeMode.parent
        ? { ...common, spawn: options.task!, supervisor: definition.supervisor }
        : { ...common, connectToParent: options.connect! }
    )
  else if (definition.runtime === TrayRuntime.thread)
    plugin = threadPlugin(
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
    )
  else
    plugin = processPlugin(
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
    )
  return (
    mode === TrayRuntimeMode.parent
      ? defineRpcSourcePlugin(plugin, TrayInternal.connection)
      : plugin
  ) as IPluginConstraint<any>
}
/** Read the current actual namespace so removing and re-admitting an id cannot revive old calls. */
export function outletOf(
  host: ITrayRuntimeHost,
  definition: IAnyTrayHost,
  id?: string
): ITrayRuntimeOutlet {
  return host[id === undefined ? definition.runtime : TrayInternal.connection]!
}
/** Native source extension identity stays separate from the fixed namespace's business calls. */
export function membersOf(host: ITrayRuntimeHost, id: string): ITrayRuntimeMembers {
  return (host[instanceNamespace(id)] as unknown as Readonly<{ members: ITrayRuntimeMembers }>)
    .members
}
