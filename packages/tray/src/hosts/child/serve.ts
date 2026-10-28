/** Assemble one child Tray host and its RPC exit lifetime; transport protocols stay in plugins. */
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { deferred } from '@migaia/utils/promise'
import type { ICoroutineConnect } from '@migaia/rpc-plugin-coroutines'
import { createChildDispatcher } from './dispatch.ts'
import { readHost } from '../define-host.ts'
import {
  outletOf,
  runtimePlugin,
  type ITrayRuntimeHost,
  type ITrayRuntimeOptions
} from '../runtime.ts'
import { TrayRuntime, TrayRuntimeMode } from '../constants.ts'
import type { IAnyTrayHost } from '../typing.ts'

/** The original Node child realm exit stays shared by parent loss and the chosen Tray outcome. */
function exitNodeRealm(code: number): void {
  /** Thread and process entries are Node realms; the structural read keeps Tray free of Node types. */
  const realm = Reflect.get(globalThis, 'process') as { exit(code: number): never } | undefined
  realm?.exit(code)
}

/** Own the first exit decision for one child generation, independently of native parent loss. */
class ChildExit {
  /** Utils retains the exact deferred outcome raced by the original task or realm runner. */
  readonly #outcome = deferred<void>()
  /** Live options preserve the original reporter lookup timing when an exit Promise rejects. */
  readonly #options: ITrayRuntimeOptions
  /** Only the first explicit child exit can decide clean settlement or a crash. */
  #ended = false

  /** Attach the original rejection observer before a business plugin can exit during init. */
  constructor(options: ITrayRuntimeOptions) {
    this.#options = options
    void this.#outcome.promise.catch((error) => this.#options.report(error))
  }

  /** Exit never throws into business code; the original runner cleans up before ending its unit. */
  readonly exit = (error?: unknown): void => {
    if (this.#ended) return
    this.#ended = true
    if (error === undefined) this.#outcome.resolve()
    else this.#outcome.reject(error)
  }

  /** Explicit first exit keeps its outcome while native cleanup closes parent stdio. */
  parentLossExit(code: number): void {
    if (!this.#ended) exitNodeRealm(code)
  }

  /** Parent task and realm runner observe the original exit Promise without another continuation. */
  get promise(): Promise<void> {
    return this.#outcome.promise
  }
}

/** Finish business cleanup before retiring transport while native pipelines remain admitted. */
export async function disposeChildHost(
  host: ITrayRuntimeHost,
  shutdown: () => Promise<void>,
  report: (error: unknown) => void,
  transportName: string
): Promise<void> {
  /** Original errors are reported after both pre-disposal cleanup steps have been attempted. */
  const failures: unknown[] = []
  try {
    await shutdown()
  } catch (error) {
    failures.push(error)
  }
  try {
    /** The exact installed native plugin supplies its removal key. */
    const removed = await host.unUse(transportName)
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
): Promise<{
  host: ITrayRuntimeHost
  exited: Promise<void>
  shutdown: () => Promise<void>
  transportName: string
}> {
  /** Branding must come from the same shared host-definition module in this realm. */
  const admitted = readHost(definition)
  /** Native construction receives declarations and lazy execution authority through one SDK call. */
  const rpc = rpcHostPipelines(
    () => host,
    (name, request) => host.pipeline(name, request)
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
  const outcome = new ChildExit(options)
  try {
    /** The dispatcher retains its original shutdown Promise while its Feature serves RPC. */
    const dispatcher = createChildDispatcher(
      admitted,
      host,
      () => outletOf(host, admitted),
      outcome.exit,
      options.report
    )
    await host.use(
      ...(options.probe === undefined
        ? []
        : [probe(...(Array.isArray(options.probe) ? options.probe : [options.probe]))]),
      dispatcher.plugin
    )
    /** Native teardown retains this exact registration name rather than guessing a runtime alias. */
    const transport = runtimePlugin(admitted, TrayRuntimeMode.child, {
      ...options,
      connect,
      parentLossExit: (code) => outcome.parentLossExit(code)
    })
    await host.use(transport)
    return {
      host,
      exited: outcome.promise,
      shutdown: dispatcher.shutdown,
      transportName: transport.name
    }
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
    const { createTrayError } = await import('../../errors.ts')
    const { TrayErrorCode } = await import('../../error-code.ts')
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
    await disposeChildHost(child.host, child.shutdown, report, child.transportName)
  }
  exitNodeRealm(code)
}
