/**
 * Serializes explicit application-instance recovery against its actual PluginHost and retires
 * matching native sessions. Ingress retains physical reconnection and candidate publication.
 */
import { createProcessError } from '../error.js'
import { isDefinedPlugin, type IPluginConstraint } from '@migaia/plugin-host'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'

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

/** The existing recovery recipe is shared by construction, stored state and the public factory. */
type IProcessFallbackOptions = Readonly<{
  mode: 'shared' | 'per-connection'
  targetName: string
  host: unknown
  createSharedTarget?(
    input: Readonly<{ reason: unknown; signal: AbortSignal }>
  ): Promise<unknown> | unknown
  onInstanceUnhealthy?(listener: (event: IProcessInstanceFault) => void): () => void
  report(error: unknown): void
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
/** Allocate one target instance recovery lifetime before installing behavior callbacks. */
function processInstanceFallbackState(options: IProcessFallbackOptions) {
  /** Session removal prevents a late fault from closing an unrelated successor. */
  const sessions = new Set<IProcessFallbackSession>()
  /** A single queue orders successive explicit health events for this target. */
  let pending: Promise<void> = Promise.resolve()
  /** A candidate can detect a fault that arrived during its own asynchronous setup. */
  let version = 0
  /** All recovery factories receive the same owner cancellation signal. */
  const controller = new AbortController()
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
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

  return {
    sessions,
    pending,
    version,
    controller,
    closed,
    recoverable,
    fused,
    unavailable,
    options
  }
}

/** Own one target instance recovery lifetime; callbacks access only this explicit instance. */
class ProcessInstanceFallback {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processInstanceFallbackState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessInstanceFallback
  /** Only this original native subscription remover belongs to the fallback lifetime. */
  readonly #unsubscribe: () => void
  /** Publish genuine methods after acquiring the one original health-event subscription. */
  constructor(options: IProcessFallbackOptions) {
    this.#state = processInstanceFallbackState(options)
    this.#unsubscribe =
      this.#state.options.onInstanceUnhealthy?.(this.#unhealthy) ?? (() => undefined)
    this.value = Object.freeze(
      Object.defineProperties(
        {
          version: 0,
          inspect: this.#inspect,
          add: this.#add,
          ready: this.#ready,
          close: this.#close
        },
        { version: { get: this.#version } }
      )
    )
  }

  /** Queue only actual target faults and preserve the original serialized recovery chain. */
  readonly #unhealthy = (event: IProcessInstanceFault): void => {
    if (this.#state.closed || event.targetName !== this.#state.options.targetName) return
    this.#state.version += 1
    this.#state.pending = this.#state.pending
      .catch(() => undefined)
      .then(() => this.#recover(event))
    void this.#state.pending.catch((error: unknown) => {
      if (error !== this.#state.unavailable) this.#state.options.report(error)
    })
  }

  /** Diagnostics sample this same target recovery lifetime without selecting another owner. */
  readonly #inspect = (): Readonly<{ recoverable: boolean; fused: boolean }> =>
    Object.freeze({ recoverable: this.#state.recoverable, fused: this.#state.fused })

  /** A removed callback cannot close or restore an unrelated successor session. */
  readonly #add = (session: IProcessFallbackSession): (() => void) => {
    if (this.#state.closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
    this.#state.sessions.add(session)
    return () => this.#state.sessions.delete(session)
  }

  /** Borrow the original pending recovery Promise without wrapping its failure or identity. */
  readonly #ready = (): Promise<void> => this.#state.pending

  /** Preserve eager abort/unsubscribe order and the original per-call pending.catch settlement. */
  readonly #close = (): Promise<void> => {
    if (this.#state.closed) return this.#state.pending.catch(() => undefined)
    this.#state.closed = true
    this.#state.controller.abort()
    ;(0, this.#unsubscribe)()
    this.#state.sessions.clear()
    return this.#state.pending.catch(() => undefined)
  }

  /** The stable published accessor always reads the original recovery generation counter. */
  readonly #version = (): number => this.#state.version

  #recover = async (event: IProcessInstanceFault): Promise<void> => {
    if (this.#state.closed) return
    this.#state.fused = true
    const affected = [...this.#state.sessions].filter(
      (session) =>
        this.#state.options.mode === 'shared' || session.connectionId === event.connectionId
    )
    await Promise.all(affected.map((session) => session.close()))
    if (this.#state.closed) return
    if (this.#state.options.mode === 'per-connection') {
      this.#state.fused = false
      return
    }
    if (this.#state.unavailable) throw this.#state.unavailable
    if (!canReplace(this.#state.options.host) || !this.#state.options.createSharedTarget)
      throw createProcessError(RpcProcessErrorCode.instanceUnhealthy, event.reason)
    const candidate = await this.#state.options.createSharedTarget({
      reason: event.reason,
      signal: this.#state.controller.signal
    })
    if (this.#state.closed) return
    if (!isDefinedPlugin(candidate))
      throw createProcessError(RpcProcessErrorCode.instanceUnhealthy, event.reason)
    await this.#state.options.host.replace(this.#state.options.targetName, candidate)
    this.#state.fused = false
  }
}

/** Construct the single owner for one target instance recovery lifetime. */
export function createProcessInstanceFallback(
  options: IProcessFallbackOptions
): IProcessInstanceFallback {
  return new ProcessInstanceFallback(options).value
}
