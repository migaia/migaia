/** Assemble one child Tray host and its RPC exit lifetime; transport protocols stay in plugins. */
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { deferred } from '@migaia/utils/promise'
import type { ICoroutineConnect } from '@migaia/rpc-plugin-coroutines'
import { createChildDispatcher } from './dispatch.js'
import { readHost } from '../define-host.js'
import {
  outletOf,
  runtimePlugin,
  type ITrayRuntimeHost,
  type ITrayRuntimeOptions
} from '../runtime.js'
import { TrayInternal, TrayRuntime, TrayRuntimeMode } from '../constants.js'
import type { IAnyTrayHost } from '../typing.js'

/** Finish business cleanup before retiring transport while native pipelines remain admitted. */
export async function disposeChildHost(
  host: ITrayRuntimeHost,
  shutdown: () => Promise<void>,
  report: (error: unknown) => void
): Promise<void> {
  /** Original errors are reported after both pre-disposal cleanup steps have been attempted. */
  const failures: unknown[] = []
  try {
    await shutdown()
  } catch (error) {
    failures.push(error)
  }
  try {
    /** This is the original runtime registration, distinct from its public namespace name. */
    const removed = await host.unUse(TrayInternal.connection)
    if (!removed.ok) failures.push(...removed.errors)
  } catch (error) {
    failures.push(error)
  }
  try {
    for (const error of failures) report(error)
  } finally {
    await host.dispose()
  }
}

/** One child Host serves init before any business plugin is installed and retains the exit outcome. */
export async function serveChild(
  definition: Parameters<typeof readHost>[0],
  options: ITrayRuntimeOptions,
  connect?: ICoroutineConnect
): Promise<{ host: ITrayRuntimeHost; exited: Promise<void>; shutdown: () => Promise<void> }> {
  /** Branding must come from the same shared host-definition module in this realm. */
  const admitted = readHost(definition)
  /** Native construction receives declarations and lazy execution authority through one SDK call. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    [admitted.runtime]
  )
  /** PluginHost cleanup diagnostics retain their native errors on the configured reporter. */
  const host = defineHost({
    ...rpc,
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      diagnostic: (_message, _code, error) => {
        if (error !== undefined) options.report(error)
      }
    }
  }) as ITrayRuntimeHost
  /** The first exit request alone determines clean or crash task settlement. */
  const outcome = deferred<void>()
  /** A plugin may exit during init before the realm runner starts observing it. */
  void outcome.promise.catch((error) => options.report(error))
  /** Exit idempotency belongs to this child generation, not the parent registry. */
  let ended = false
  /** Never throw into business code; the runner disposes and settles the native unit later. */
  const exit = (error?: unknown): void => {
    if (ended) return
    ended = true
    if (error === undefined) outcome.resolve()
    else outcome.reject(error)
  }
  try {
    /** The dispatcher retains its original shutdown Promise while its Feature serves RPC. */
    const dispatcher = createChildDispatcher(
      admitted,
      host,
      () => outletOf(host, admitted),
      exit,
      options.report
    )
    await host.use(
      ...(options.probe === undefined
        ? []
        : [probe(...(Array.isArray(options.probe) ? options.probe : [options.probe]))]),
      dispatcher.plugin
    )
    await host.use(runtimePlugin(admitted, TrayRuntimeMode.child, { ...options, connect }))
    return { host, exited: outcome.promise, shutdown: dispatcher.shutdown }
  } catch (primary) {
    await host.dispose()
    throw primary
  }
}
/**
 * Runs a trusted thread/process definition in its Node child entry using automatic RPC connection.
 * Coroutine definitions reject with TRAY_HOST_INVALID. options defaults to no probe and
 * console.error reporting. Waits for the first child exit request, disposes its Host, then exits
 * the Node realm with 0 for clean exit or 1 for a reported crash. Parent spawn/initialization
 * remains a separate owner.
 */
export async function serveTrayHost(
  definition: IAnyTrayHost,
  options?: Partial<ITrayRuntimeOptions>
): Promise<void> {
  /** The coroutine task owns its runner; only a Node realm calls this public entry. */
  const admitted = readHost(definition)
  if (admitted.runtime === TrayRuntime.coroutine) {
    const { createTrayError } = await import('../../errors.js')
    const { TrayErrorCode } = await import('../../error-code.js')
    throw createTrayError(TrayErrorCode.hostInvalid)
  }
  /** Default diagnostics use the same boundary reporter in either Node realm. */
  const report = options?.report ?? console.error
  const child = await serveChild(admitted, { report, probe: options?.probe })
  /** Realm exit happens after PluginHost cleanup, retaining the first exit decision. */
  let code = 0
  try {
    await child.exited
  } catch (error) {
    report(error)
    code = 1
  } finally {
    await disposeChildHost(child.host, child.shutdown, report)
  }
  /** Thread and process entries are Node realms; the structural read keeps Tray free of Node types. */
  const realm = Reflect.get(globalThis, 'process') as { exit(code: number): never } | undefined
  realm?.exit(code)
}
