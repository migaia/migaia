import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { isDefinedPlugin, type IPluginConstraint } from '@migaia/plugin-host'
import { RpcProcessErrorCode } from '../error-code.js'

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
/** Allocate one target instance recovery lifetime before installing behavior callbacks. */
function processInstanceFallbackState(
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
) {
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
    : ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
        attachErrorIdentity(new Error(RpcProcessErrorText.instanceUnhealthy), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.instanceUnhealthy,
          ...(originalDetail ? { detail: originalDetail } : {})
        }))({
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
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
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
  ) {
    this.#state = processInstanceFallbackState(options)
    const unsubscribe =
      this.#state.options.onInstanceUnhealthy?.((event) => {
        if (this.#state.closed || event.targetName !== this.#state.options.targetName) return
        this.#state.version += 1
        this.#state.pending = this.#state.pending
          .catch(() => undefined)
          .then(() => this.#recover(event))
        void this.#state.pending.catch((error: unknown) => {
          if (error !== this.#state.unavailable) this.#state.options.report(error)
        })
      }) ?? (() => undefined)
    this.value = Object.freeze(
      Object.defineProperties(
        {
          version: 0,
          inspect: (): Readonly<{ recoverable: boolean; fused: boolean }> => {
            return Object.freeze({ recoverable: this.#state.recoverable, fused: this.#state.fused })
          },
          add: (session: IProcessFallbackSession): (() => void) => {
            if (this.#state.closed)
              throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
                source: RPC_PROCESS_ERROR_SOURCE,
                code: RpcProcessErrorCode.channelClosed
              })
            this.#state.sessions.add(session)
            return () => this.#state.sessions.delete(session)
          },
          ready: (): Promise<void> => {
            return this.#state.pending
          },
          close: (): Promise<void> => {
            if (this.#state.closed) return this.#state.pending.catch(() => undefined)
            this.#state.closed = true
            this.#state.controller.abort()
            unsubscribe()
            this.#state.sessions.clear()
            return this.#state.pending.catch(() => undefined)
          }
        },
        {
          version: {
            get: () => {
              return this.#state.version
            }
          }
        }
      )
    )
  }

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
      throw ((originalCause: unknown) =>
        attachErrorIdentity(
          new Error(
            RpcProcessErrorText.instanceUnhealthy,
            originalCause === undefined ? undefined : { cause: originalCause }
          ),
          { source: RPC_PROCESS_ERROR_SOURCE, code: RpcProcessErrorCode.instanceUnhealthy }
        ))(event.reason)
    const candidate = await this.#state.options.createSharedTarget({
      reason: event.reason,
      signal: this.#state.controller.signal
    })
    if (this.#state.closed) return
    if (!isDefinedPlugin(candidate))
      throw ((originalCause: unknown) =>
        attachErrorIdentity(
          new Error(
            RpcProcessErrorText.instanceUnhealthy,
            originalCause === undefined ? undefined : { cause: originalCause }
          ),
          { source: RPC_PROCESS_ERROR_SOURCE, code: RpcProcessErrorCode.instanceUnhealthy }
        ))(event.reason)
    await this.#state.options.host.replace(this.#state.options.targetName, candidate)
    this.#state.fused = false
  }
}

/** Construct the single owner for one target instance recovery lifetime. */
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
  return new ProcessInstanceFallback(options).value
}
