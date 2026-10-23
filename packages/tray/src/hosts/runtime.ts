import {
  type IRuntimeEvent,
  type IRuntimeConnectionDetail,
  type IRuntimeCallOptions
} from '@migaia/rpc-host/plugin'
import {
  coroutinePlugin,
  type ICoroutineConnect,
  type ICoroutineUserTask
} from '@migaia/rpc-plugin-coroutines'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import type { IPluginConstraint, IHostHandle } from '@migaia/plugin-host'
import type { IRpcProbe } from '@migaia/rpc-host/probe'
import { TrayInternal, TrayRuntime, TrayRuntimeMode } from './constants.js'
import type { IAnyTrayHost } from './typing.js'

/** The consumed outlet preserves RPC authority; Tray adds no native connection state. */
export type ITrayRuntimeOutlet = Readonly<{
  request(
    target: string,
    path: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): Promise<unknown>
  notify(
    target: string,
    path: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): Promise<void>
  stream(
    target: string,
    path: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): AsyncIterableIterator<unknown>
  get(target: string): Promise<IRuntimeConnectionDetail>
  list(): Promise<unknown>
  stop(target: string, options?: { graceMs?: number }): Promise<void>
  restart(target: string): Promise<{ state: string; generation?: number }>
  replace(
    target: string
  ): Promise<{ kind: string; generation?: number; error?: unknown; reason?: unknown }>
  on(event: IRuntimeEvent['type'], listener: (event: IRuntimeEvent) => unknown): () => void
}>
/** One plain child or parent Host, whose family slots remain owned by RPC. */
export type ITrayRuntimeHost = IHostHandle<
  Record<string, never>,
  never,
  readonly IPluginConstraint<any>[]
> &
  Partial<Record<TrayRuntime, ITrayRuntimeOutlet>>
/** Reporter and probe are passed to the original runtime plugin on both sides. */
export type ITrayRuntimeOptions = Readonly<{
  report(error: unknown): void
  probe?: IRpcProbe | readonly IRpcProbe[]
}>
/** Runtime and mode select exactly one canonical RPC factory. */
export function runtimePlugin(
  definition: IAnyTrayHost,
  mode: TrayRuntimeMode,
  options: ITrayRuntimeOptions &
    Readonly<{ id?: string; connect?: ICoroutineConnect; task?: ICoroutineUserTask }>
): IPluginConstraint<any> {
  /** Child source omission selects the factory's automatic connection, never another spawn. */
  const common = {
    name: mode === TrayRuntimeMode.parent ? options.id! : TrayInternal.connection,
    expose: [mode === TrayRuntimeMode.parent ? TrayInternal.relayPlugin : TrayInternal.childPlugin],
    report: options.report,
    ...(options.probe === undefined ? {} : { probe: options.probe })
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
/** Read the current family object on each operation; RPC can recreate it after the last removal. */
export function outletOf(host: ITrayRuntimeHost, definition: IAnyTrayHost): ITrayRuntimeOutlet {
  return host[definition.runtime]!
}
