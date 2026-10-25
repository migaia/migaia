/** Project the existing collector service onto portable RPC results without owning collector state. */
import { normalizePortable } from '@migaia/rpc-contract'
import { serializeRpcError } from '@migaia/rpc-contract/errors'
import type { IRpcContext } from '@migaia/rpc-host'
import { RpcDevtoolsErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcDevtoolsErrorText } from '../error-text.js'
import { identifyDevtoolsError } from '../errors.js'
import type { IRpcDevtools } from '../collector-types.js'
import type { IRpcDevtoolsQuery } from '../contract/service.js'
import type { IRpcDevtoolsRecord } from '../contract/record.js'
import type { IRpcProvide } from '@migaia/rpc-host'

/** Boundary callbacks reuse the collector's one lifecycle owner and independent record ring. */
export type ICollectorServiceOwner = Pick<
  IRpcDevtools,
  'describe' | 'stats' | 'record' | 'clear' | 'pause' | 'resume' | 'exportRecord'
> & {
  query(input?: IRpcDevtoolsQuery, content?: boolean): ReturnType<IRpcDevtools['query']>
  watch(
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>,
    content?: boolean,
    signal?: IRpcContext['signal']
  ): ReturnType<IRpcDevtools['watch']>
  stopRecord(content: boolean): IRpcDevtoolsRecord
  /** The collector owns exclusion of actual service endpoint identities. */
  excludeEndpoint(endpointId: string): void
}

/** A projection failure must cross the service boundary, rather than being silently swallowed. */
function rejectErrorProjection(failure: Readonly<{ error: unknown }>): never {
  throw failure.error
}

/** JSON invokes this with the original holder, retaining native byte and Error identity. */
function serviceJsonValue(this: object, key: string, field: unknown): unknown {
  /** Descriptor access precedes any optional toJSON result exactly as in the original service. */
  const original: unknown = Object.getOwnPropertyDescriptor(this, key)?.value ?? field
  if (original instanceof Error)
    return serializeRpcError(original, { report: rejectErrorProjection })
  if (original instanceof Uint8Array) return normalizePortable(original)
  if (original instanceof ArrayBuffer) return normalizePortable(new Uint8Array(original))
  if (typeof field === 'bigint') return field.toString()
  return field
}

/** Service results become plain portable wire data only at the remote boundary. */
function portableResult<T>(value: T): T {
  try {
    /** JSON's representation removes undefined/functions and class prototypes without hot-path work. */
    const text = JSON.stringify(value, serviceJsonValue)
    return JSON.parse(text) as T
  } catch (cause) {
    throw identifyDevtoolsError(
      new TypeError(RpcDevtoolsErrorText.serviceResultInvalid, { cause }),
      RpcDevtoolsErrorCode.serviceResultInvalid
    )
  }
}

/** One service borrows its collector and policy without a closure-backed provider component. */
class CollectorService {
  /** The caller retains this collector's ring, watch and close ownership. */
  readonly #owner: ICollectorServiceOwner
  /** Content exposure is fixed for this actual public service boundary. */
  readonly #exposeContent: boolean
  /** Provider registration retains stable methods on this one service owner. */
  readonly value: IRpcProvide

  /** Publish provider methods without reading or mutating collector data. */
  constructor(owner: ICollectorServiceOwner, exposeContent: boolean) {
    this.#owner = owner
    this.#exposeContent = exposeContent
    this.value = {
      describe: this.#describe,
      query: this.#query,
      /** Generator methods require the actual service receiver rather than the provider group. */
      watch: (input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>, context?: IRpcContext) =>
        this.#watch(input, context),
      stats: this.#stats,
      record: { start: this.#recordStart, stop: this.#recordStop },
      clear: this.#clear,
      pause: this.#pause,
      resume: this.#resume
    }
  }
  /** Direct local calls have no serving identity; genuine RPC calls exclude their actual endpoint. */
  #identify(context: IRpcContext | undefined): void {
    if (context !== undefined) this.#owner.excludeEndpoint(context.localEndpointId)
  }
  /** Describe the same collector after identifying the genuine serving endpoint. */
  readonly #describe = (_input: unknown, context?: IRpcContext): unknown => {
    this.#identify(context)
    return portableResult(this.#owner.describe())
  }
  /** Query the existing ring under this boundary's fixed content policy. */
  readonly #query = (input?: IRpcDevtoolsQuery, context?: IRpcContext): unknown => {
    this.#identify(context)
    return portableResult(this.#owner.query(input, this.#exposeContent))
  }
  /** Stream existing watch batches; the original caller signal owns cancellation. */
  async *#watch(
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>,
    context?: IRpcContext
  ): AsyncGenerator<unknown> {
    this.#identify(context)
    for await (const batch of this.#owner.watch(input, this.#exposeContent, context?.signal))
      yield portableResult(batch)
  }
  /** Snapshot the collector's original counters at the remote service boundary. */
  readonly #stats = (_input: unknown, context?: IRpcContext): unknown => {
    this.#identify(context)
    return portableResult(this.#owner.stats())
  }
  /** Begin recording in the collector's existing record owner. */
  readonly #recordStart = (
    input?: Readonly<{ maxEvents?: number }>,
    context?: IRpcContext
  ): void => {
    this.#identify(context)
    this.#owner.record(input)
  }
  /** Stop and export through the same collector, preserving its synchronous result. */
  readonly #recordStop = (_input: unknown, context?: IRpcContext): unknown => {
    this.#identify(context)
    return this.#owner.exportRecord(this.#owner.stopRecord(this.#exposeContent))
  }
  /** Clear the original ring without replacing its owner. */
  readonly #clear = (_input: unknown, context?: IRpcContext): void => {
    this.#identify(context)
    this.#owner.clear()
  }
  /** Pause the same collector's admission. */
  readonly #pause = (_input: unknown, context?: IRpcContext): void => {
    this.#identify(context)
    this.#owner.pause()
  }
  /** Resume the same collector's admission. */
  readonly #resume = (_input: unknown, context?: IRpcContext): void => {
    this.#identify(context)
    this.#owner.resume()
  }
}

/** A real service boundary enforces portable data, content exposure and actual self identity. */
export function createCollectorService(
  owner: ICollectorServiceOwner,
  exposeContent: boolean
): IRpcProvide {
  return new CollectorService(owner, exposeContent).value
}
