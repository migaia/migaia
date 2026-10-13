import {
  createCoroutinePlugin,
  type ICoroutineConnect,
  type ICoroutineUserTask,
  type IRuntimeEvent,
  type IRuntimeConnectionDetail,
  type IRuntimeCallOptions
} from '@migaia/rpc-core/remote'
import { createProcessPlugin } from '@migaia/rpc-process'
import { createThreadPlugin } from '@migaia/rpc-threads'
import type { IPluginConstraint, IHostHandle } from '@migaia/plugin-host'
import type { IRpcProbe } from '@migaia/rpc-core/probe'
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
    return createCoroutinePlugin(
      mode === TrayRuntimeMode.parent
        ? { ...common, task: options.task!, supervisor: definition.supervisor }
        : { ...common, connect: options.connect! }
    ) as IPluginConstraint<any>
  if (definition.runtime === TrayRuntime.thread)
    return createThreadPlugin(
      mode === TrayRuntimeMode.parent
        ? {
            ...common,
            spawn: {
              entry: definition.entry!,
              limits: definition.limits,
              supervisor: definition.supervisor
            }
          }
        : common
    ) as IPluginConstraint<any>
  return createProcessPlugin(
    mode === TrayRuntimeMode.parent
      ? {
          ...common,
          spawn: {
            entry: definition.entry!,
            supervision: definition.supervisor,
            ...(definition.sandbox ? { wrap: definition.sandbox.wrap } : {})
          }
        }
      : common
  ) as IPluginConstraint<any>
}
/** Read the current family object on each operation; RPC can recreate it after the last removal. */
export function outletOf(host: ITrayRuntimeHost, definition: IAnyTrayHost): ITrayRuntimeOutlet {
  return host[definition.runtime]!
}
