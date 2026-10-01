import { isDefinedPlugin, type IPluginConstraint } from '@migaia/plugin-host'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'

/** An instance event is explicit evidence of a target fault, unlike a rejected business call. */
export type IProcessInstanceFault = Readonly<{
  targetName: string
  connectionId?: string
  reason: unknown
}>

/** Only live sessions participate in instance recovery; physical reconnection stays with ingress. */
export type IProcessFallbackSession = Readonly<{
  connectionId: string
  close(): Promise<void>
}>

/** The fallback owner serializes replacement and blocks candidate publication until ready. */
export type IProcessInstanceFallback = Readonly<{
  readonly version: number
  inspect(): Readonly<{ recoverable: boolean; fused: boolean }>
  add(session: IProcessFallbackSession): () => void
  ready(): Promise<void>
  close(): Promise<void>
}>

/** A real PluginHost may expose replace beyond the remote service's narrow Host port. */
function canReplace(value: unknown): value is Readonly<{
  replace(name: string, candidate: IPluginConstraint<any>): Promise<unknown>
}> {
  return (
    !!value &&
    typeof value === 'object' &&
    'replace' in value &&
    typeof value.replace === 'function'
  )
}

/** Recover only after affected sessions have stopped serving the unhealthy target. */
export function createProcessInstanceFallback(
  options: Readonly<{
    mode: 'shared' | 'per-connection'
    targetName: string
    host: unknown
    createSharedTarget?(
      input: Readonly<{ reason: unknown; signal: AbortSignal }>
    ): Promise<unknown> | unknown
    onInstanceUnhealthy?(listener: (event: IProcessInstanceFault) => void): () => void
    report(error: unknown): void
  }>
): IProcessInstanceFallback {
  /** Session removal prevents a late fault from closing an unrelated successor. */
  const sessions = new Set<IProcessFallbackSession>()
  /** A single queue orders successive explicit health events for this target. */
  let pending: Promise<void> = Promise.resolve()
  /** A candidate can detect a fault that arrived during its own asynchronous setup. */
  let version = 0
  /** All recovery factories receive the same owner cancellation signal. */
  const controller = new AbortController()
  let closed = false
  /** Shared recovery requires the caller's Host to expose its trusted replacement method. */
  const recoverable = options.mode === 'per-connection' || canReplace(options.host)
  /** A failed instance cannot publish new sessions until a trusted replacement succeeds. */
  let fused = false
  /** One construction report makes a narrow Host's missing capability observable immediately. */
  const unavailable = recoverable
    ? undefined
    : createProcessError(RpcProcessErrorCode.instanceUnhealthy, undefined, {
        field: 'host.replace'
      })
  if (unavailable) options.report(unavailable)

  const recover = async (event: IProcessInstanceFault): Promise<void> => {
    if (closed) return
    fused = true
    const affected = [...sessions].filter(
      (session) => options.mode === 'shared' || session.connectionId === event.connectionId
    )
    await Promise.all(affected.map((session) => session.close()))
    if (closed) return
    if (options.mode === 'per-connection') {
      fused = false
      return
    }
    if (unavailable) throw unavailable
    if (!canReplace(options.host) || !options.createSharedTarget)
      throw createProcessError(RpcProcessErrorCode.instanceUnhealthy, event.reason)
    const candidate = await options.createSharedTarget({
      reason: event.reason,
      signal: controller.signal
    })
    if (closed) return
    if (!isDefinedPlugin(candidate))
      throw createProcessError(RpcProcessErrorCode.instanceUnhealthy, event.reason)
    await options.host.replace(options.targetName, candidate)
    fused = false
  }

  const unsubscribe =
    options.onInstanceUnhealthy?.((event) => {
      if (closed || event.targetName !== options.targetName) return
      version += 1
      pending = pending.catch(() => undefined).then(() => recover(event))
      void pending.catch((error: unknown) => {
        if (error !== unavailable) options.report(error)
      })
    }) ?? (() => undefined)
  return Object.freeze({
    get version() {
      return version
    },
    inspect(): Readonly<{ recoverable: boolean; fused: boolean }> {
      return Object.freeze({ recoverable, fused })
    },
    add(session: IProcessFallbackSession): () => void {
      if (closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
      sessions.add(session)
      return () => sessions.delete(session)
    },
    ready(): Promise<void> {
      return pending
    },
    close(): Promise<void> {
      if (closed) return pending.catch(() => undefined)
      closed = true
      controller.abort()
      unsubscribe()
      sessions.clear()
      return pending.catch(() => undefined)
    }
  })
}
