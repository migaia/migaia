import { defineHost } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import type { ICoroutineConnect } from '@migaia/rpc-core/remote'
import { createChildDispatcher } from './dispatch.js'
import { readHost } from '../define-host.js'
import {
  outletOf,
  runtimePlugin,
  type ITrayRuntimeHost,
  type ITrayRuntimeOptions
} from '../runtime.js'
import { TrayRuntime, TrayRuntimeMode } from '../constants.js'
import type { IAnyTrayHost } from '../typing.js'
/** One child Host serves init before any business plugin is installed and retains the exit outcome. */
export async function serveChild(
  definition: Parameters<typeof readHost>[0],
  options: ITrayRuntimeOptions,
  connect?: ICoroutineConnect
): Promise<{ host: ITrayRuntimeHost; exited: Promise<void> }> {
  /** Branding must come from the same shared host-definition module in this realm. */
  const admitted = readHost(definition)
  /** PluginHost cleanup diagnostics retain their native errors on the configured reporter. */
  const host = defineHost({
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
    await host.use(
      createChildDispatcher(admitted, host, () => outletOf(host, admitted), exit, options.report)
    )
    await host.use(runtimePlugin(admitted, TrayRuntimeMode.child, { ...options, connect }))
    return { host, exited: outcome.promise }
  } catch (primary) {
    await host.dispose()
    throw primary
  }
}
/** Node Worker/process entry; automatic source selection connects once and ends only after exit. */
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
    await child.host.dispose()
  }
  /** Thread and process entries are Node realms; the structural read keeps Tray free of Node types. */
  const realm = Reflect.get(globalThis, 'process') as { exit(code: number): never } | undefined
  realm?.exit(code)
}
