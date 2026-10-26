/**
 * Owns bounded source/message fragment assembly, terminal history, expiry and retained-byte
 * budgets. String and byte factories share one explicit framer owner and return
 * pending/complete/rejected outcomes; native IO and semantic codec admission remain with their
 * callers.
 */
import { isUint8Array } from '@migaia/utils/bytes'
import { observeThenableRejection } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { RpcContractErrorCode, type IRpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { createContractError, identifyContractCallbackFailure } from '@migaia/rpc-contract/errors'
import type {
  IRpcStringChunk,
  IRpcBinaryChunk,
  IRpcChunkResult,
  IRpcChunkContext,
  IRpcChunkOptions,
  IRpcChunkAssembler
} from './types.js'
import { RpcChunkLimit } from './constants.js'

type IEncoded = string | Uint8Array
type IFrame = IRpcStringChunk | IRpcBinaryChunk
type IBuffer<TEncoded extends IEncoded> = {
  readonly count: number
  readonly expectedLength: number
  readonly parts: TEncoded[]
  bytes: number
  next: number
  timer?: unknown
}

/** One existing source/message entry also serves as the bounded terminal-order key. */
type ITerminalState = {
  readonly source: string
  readonly messageId: string
  didExpire: boolean
}

type IFrameSnapshot = {
  readonly messageId: unknown
  readonly index: unknown
  readonly count: unknown
  readonly length: unknown
  readonly data: unknown
}

/** Validates bounded framer options before the framer becomes externally visible. */
function snapshotOptions(options: IRpcChunkOptions = {}) {
  /** Snapshot every option once before this plugin allocates assembly state. */
  const result = {
    chunkBytes: options.chunkBytes ?? RpcChunkLimit.chunkBytes,
    maxMessageBytes: options.maxMessageBytes ?? RpcChunkLimit.maxMessageBytes,
    maxChunks: options.maxChunks ?? RpcChunkLimit.maxChunks,
    maxBufferedBytes: options.maxBufferedBytes ?? RpcChunkLimit.maxBufferedBytes,
    maxConcurrentMessages: options.maxConcurrentMessages ?? RpcChunkLimit.maxConcurrentMessages,
    assemblyTimeoutMs: options.assemblyTimeoutMs ?? RpcChunkLimit.assemblyTimeoutMs,
    errorMetadata: options.errorMetadata,
    now: options.now,
    schedule: options.schedule,
    cancel: options.cancel
  }
  for (const value of [
    result.chunkBytes,
    result.maxMessageBytes,
    result.maxChunks,
    result.maxBufferedBytes,
    result.maxConcurrentMessages,
    result.assemblyTimeoutMs
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, options.errorMetadata)
  }
  if (
    result.chunkBytes > result.maxMessageBytes ||
    result.maxMessageBytes > result.maxBufferedBytes
  )
    throw createContractError(
      RpcContractErrorCode.frameLimitExceeded,
      undefined,
      options.errorMetadata
    )
  return result
}

/**
 * Create independent source/message reassembly state for strings. Small values pass through; larger
 * values split by UTF-16 code units, retaining strict fragment order and configured limits. Invalid
 * options throw before construction; accept returns pending/complete/rejected rather than throwing
 * for ordinary frame violations. Close releases assembly timers and rejects later input.
 */
export function createStringChunkAssembler<
  const TOptions extends IRpcChunkOptions = IRpcChunkOptions
>(options?: TOptions): IRpcChunkAssembler<string> {
  return createFragmentFramer<'string', string>(
    'string',
    options,
    (value) => value.length,
    (value, start, end) => value.slice(start, end)
  ) as IRpcChunkAssembler<string>
}

/**
 * Create independent source/message reassembly state for Uint8Array carriers. Large outbound values
 * use copied byte fragments; complete inbound fragments join into one owned buffer. Limits use
 * bytes, invalid options throw before construction, and ordinary invalid frames return a rejected
 * result. Close releases assembly timers and prevents subsequent framing/admission.
 */
export function createBinaryChunkAssembler<
  const TOptions extends IRpcChunkOptions = IRpcChunkOptions
>(options?: TOptions): IRpcChunkAssembler<Uint8Array> {
  return createFragmentFramer<'binary', Uint8Array>(
    'binary',
    options,
    (value) => value.byteLength,
    (value, start, end) => value.slice(start, end)
  ) as IRpcChunkAssembler<Uint8Array>
}

/** Builds one profile while keeping framing independent from semantic and codec layers. */
/** Allocate one source-scoped fragment reassembly lifetime before installing behavior callbacks. */
function fragmentFramerState<TKind extends 'string' | 'binary', TEncoded extends IEncoded>(
  kind: TKind,
  input: IRpcChunkOptions | undefined,
  lengthOf: (value: TEncoded) => number,
  slice: (value: TEncoded, start: number, end: number) => TEncoded
) {
  /** A frozen option snapshot fixes frame and retention budgets for this one framer. */
  const options = snapshotOptions(input)
  /** Source and message identifiers isolate incomplete fragment buffers from unrelated senders. */
  const buffers = new Map<string, Map<string, IBuffer<TEncoded>>>()
  /** Keep opaque source/message lookup separate from global eviction order. */
  const terminal = new Map<string, Map<string, ITerminalState>>()
  /** Map key order avoids scanning or moving the bounded recent-terminal entries. */
  const terminalOrder = new Map<ITerminalState, undefined>()
  /** Aggregate retained payload bytes enforce the framer-wide memory budget. */
  let bufferedBytes = 0
  /** The active-message count enforces the concurrent incomplete-message limit. */
  let activeBuffers = 0
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
  let closed = false

  return {
    options,
    buffers,
    terminal,
    terminalOrder,
    bufferedBytes,
    activeBuffers,
    closed,
    kind,
    input,
    lengthOf,
    slice
  }
}

/** Own one source-scoped fragment reassembly lifetime; callbacks access only this explicit instance. */
class FragmentFramer<TKind extends 'string' | 'binary', TEncoded extends IEncoded> {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof fragmentFramerState<TKind, TEncoded>>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcChunkAssembler<TEncoded>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
    kind: TKind,
    input: IRpcChunkOptions | undefined,
    lengthOf: (value: TEncoded) => number,
    slice: (value: TEncoded, start: number, end: number) => TEncoded
  ) {
    this.#state = fragmentFramerState(kind, input, lengthOf, slice)
    this.value = Object.freeze({
      frame: this.#frame,
      accept: this.#accept,
      close: this.#close,
      closeSource: this.#closeSource
    })
  }
  /** Actual plugin errors borrow only caller-owned local provenance maps. */
  #failure(code: IRpcContractErrorCode, cause?: unknown): Error {
    return createContractError(code, cause, this.#state.options.errorMetadata)
  }
  /** Retain only a bounded recent terminal history for late-frame rejection. */
  #markTerminal = (source: string, messageId: string, didExpire: boolean): void => {
    /** The original nested owner keeps source/message pairs collision-free. */
    let sourceTerminal = this.#state.terminal.get(source)
    if (!sourceTerminal) {
      sourceTerminal = new Map<string, ITerminalState>()
      this.#state.terminal.set(source, sourceTerminal)
    }
    /** Reuse the canonical entry so updating a terminal also refreshes its insertion order. */
    let state = sourceTerminal.get(messageId)
    if (state) {
      this.#state.terminalOrder.delete(state)
      state.didExpire = didExpire
    } else {
      state = { source, messageId, didExpire }
      sourceTerminal.set(messageId, state)
    }
    this.#state.terminalOrder.set(state, undefined)
    while (this.#state.terminalOrder.size > this.#state.options.maxConcurrentMessages * 2) {
      /** The first Map key is the same oldest source/message pair the prior array retained. */
      const oldest = this.#state.terminalOrder.keys().next().value
      if (!oldest) break
      this.#state.terminalOrder.delete(oldest)
      /** Remove only the corresponding nested source entry; other sources remain independent. */
      const oldestMap = this.#state.terminal.get(oldest.source)
      oldestMap?.delete(oldest.messageId)
      if (oldestMap?.size === 0) this.#state.terminal.delete(oldest.source)
    }
  }

  #sourceBuffers = (source: string): Map<string, IBuffer<TEncoded>> => {
    let result = this.#state.buffers.get(source)
    if (!result) {
      result = new Map<string, IBuffer<TEncoded>>()
      this.#state.buffers.set(source, result)
    }
    return result
  }

  #schedule = (callback: () => void, delay: number): unknown => {
    try {
      if (this.#state.options.schedule) return (0, this.#state.options.schedule)(callback, delay)
      /** Revoke assembly ownership and account once before a user cancel callback can reenter. */
      const timer = (
        globalThis as unknown as { setTimeout?: (task: () => void, timeout: number) => unknown }
      ).setTimeout
      if (!timer) return undefined
      return timer(callback, delay)
    } catch (error) {
      throw identifyContractCallbackFailure(error, this.#state.options.errorMetadata)
    }
  }

  #cancel = (handle: unknown): void => {
    if (this.#state.options.cancel) (0, this.#state.options.cancel)(handle)
    else {
      /** Revoke assembly ownership and account once before a user cancel callback can reenter. */
      const timer = (globalThis as unknown as { clearTimeout?: (value: unknown) => void })
        .clearTimeout
      timer?.(handle)
    }
  }

  #reportCleanupFailure = (error: unknown): void => {
    /** Reuse utils' terminal host observation when the optional host reporter cannot accept it. */
    const failure = identifyContractCallbackFailure(error, this.#state.options.errorMetadata)
    observeThenableRejection(undefined, { error: failure }, (primary) => {
      try {
        const reporter = (globalThis as unknown as { reportError?: (value: unknown) => void })
          .reportError
        if (typeof reporter !== 'function') throw primary
        reporter(primary)
      } catch (reporterFailure) {
        throw reporterFailure === primary
          ? primary
          : attachSecondaryErrors(primary, [reporterFailure])
      }
    })
  }

  #clearBuffer = (source: string, messageId: string): void => {
    const sourceMap = this.#state.buffers.get(source)
    const buffer = sourceMap?.get(messageId)
    if (!sourceMap || !buffer) return
    /** Revoke assembly ownership and account once before a user cancel callback can reenter. */
    const timer = buffer.timer
    buffer.timer = undefined
    this.#state.bufferedBytes -= buffer.bytes
    sourceMap.delete(messageId)
    if (sourceMap.size === 0) this.#state.buffers.delete(source)
    this.#state.activeBuffers -= 1
    if (timer !== undefined) {
      try {
        this.#cancel(timer)
      } catch (error) {
        this.#reportCleanupFailure(error)
      }
    }
  }

  #frame = (value: TEncoded, context: IRpcChunkContext): readonly (TEncoded | IFrame)[] => {
    /** Whole carriers have the same message ceiling as fragmented and outbound messages. */
    const size = (0, this.#state.lengthOf)(value)
    if (!Number.isSafeInteger(size) || size > this.#state.options.maxMessageBytes)
      throw this.#failure(RpcContractErrorCode.frameLimitExceeded)
    if (size <= this.#state.options.chunkBytes) return [value]
    const count = Math.ceil(size / this.#state.options.chunkBytes)
    if (count > this.#state.options.maxChunks)
      throw this.#failure(RpcContractErrorCode.frameLimitExceeded)
    const frames: IFrame[] = []
    for (let index = 0; index < count; index += 1) {
      const start = index * this.#state.options.chunkBytes
      const data = (0, this.#state.slice)(
        value,
        start,
        Math.min(size, start + this.#state.options.chunkBytes)
      )
      frames.push(
        Object.freeze({
          messageId: context.messageId,
          index,
          count,
          length: size,
          data
        }) as IFrame
      )
    }
    return frames
  }

  #accept = (value: unknown, context: IRpcChunkContext): IRpcChunkResult<TEncoded> => {
    if (this.#state.closed)
      return { status: 'rejected', error: this.#failure(RpcContractErrorCode.invalidFrame) }
    if (
      (this.#state.kind === 'string' && typeof value === 'string') ||
      (this.#state.kind === 'binary' &&
        typeof value === 'object' &&
        value !== null &&
        isUint8Array(value))
    ) {
      /** Whole carriers have the same message ceiling as fragmented and outbound messages. */
      const size = (0, this.#state.lengthOf)(value as TEncoded)
      if (!Number.isSafeInteger(size) || size > this.#state.options.maxMessageBytes)
        return {
          status: 'rejected',
          error: this.#failure(RpcContractErrorCode.frameLimitExceeded)
        }
      return { status: 'complete', value: value as TEncoded }
    }
    if (typeof value !== 'object' || value === null)
      return { status: 'rejected', error: this.#failure(RpcContractErrorCode.invalidFrame) }
    let snapshot: IFrameSnapshot | undefined
    try {
      snapshot = snapshotFrame(value as IFrame)
    } catch (cause) {
      const error = this.#failure(RpcContractErrorCode.invalidFrame, cause)
      return { status: 'rejected', error }
    }
    if (
      snapshot === undefined ||
      snapshot.messageId !== context.messageId ||
      typeof snapshot.index !== 'number' ||
      typeof snapshot.count !== 'number' ||
      !Number.isSafeInteger(snapshot.index) ||
      !Number.isSafeInteger(snapshot.count) ||
      snapshot.index < 0 ||
      snapshot.count <= 0 ||
      snapshot.index >= snapshot.count ||
      snapshot.count > this.#state.options.maxChunks ||
      typeof snapshot.length !== 'number' ||
      !Number.isSafeInteger(snapshot.length)
    )
      return { status: 'rejected', error: this.#failure(RpcContractErrorCode.invalidFrame) }
    if (
      (this.#state.kind === 'string' && typeof snapshot.data !== 'string') ||
      (this.#state.kind === 'binary' &&
        (typeof snapshot.data !== 'object' ||
          snapshot.data === null ||
          !isUint8Array(snapshot.data)))
    )
      return { status: 'rejected', error: this.#failure(RpcContractErrorCode.invalidFrame) }
    const index = snapshot.index as number
    const count = snapshot.count as number
    const length = snapshot.length as number
    const bytes = (0, this.#state.lengthOf)(snapshot.data as TEncoded)
    if (
      length <= 0 ||
      length > this.#state.options.maxMessageBytes ||
      bytes > this.#state.options.chunkBytes
    )
      return {
        status: 'rejected',
        error: this.#failure(RpcContractErrorCode.frameLimitExceeded)
      }
    const source = context.source
    const messageId = snapshot.messageId as string
    const terminalState = this.#state.terminal.get(source)?.get(messageId)?.didExpire
    if (terminalState !== undefined)
      return {
        status: 'rejected',
        error: this.#failure(
          terminalState
            ? RpcContractErrorCode.frameAssemblyExpired
            : RpcContractErrorCode.invalidFrame
        )
      }
    let buffer = this.#state.buffers.get(source)?.get(messageId)
    if (!buffer) {
      if (
        index !== 0 ||
        this.#state.activeBuffers >= this.#state.options.maxConcurrentMessages ||
        this.#state.bufferedBytes + bytes > this.#state.options.maxBufferedBytes
      )
        return {
          status: 'rejected',
          error: this.#failure(
            index === 0
              ? RpcContractErrorCode.frameLimitExceeded
              : RpcContractErrorCode.invalidFrame
          )
        }
      buffer = { count, expectedLength: length, parts: [], bytes: 0, next: 0 }
      /** One explicit timer entry avoids a second source/id registry or callback state closure. */
      const entry = { source, messageId }
      buffer.timer = this.#schedule(() => {
        if (!this.#state.buffers.get(entry.source)?.has(entry.messageId)) return
        this.#clearBuffer(entry.source, entry.messageId)
        this.#markTerminal(entry.source, entry.messageId, true)
      }, this.#state.options.assemblyTimeoutMs)
      this.#sourceBuffers(source).set(messageId, buffer)
      this.#state.activeBuffers += 1
    }
    if (buffer.count !== count || buffer.expectedLength !== length || index !== buffer.next)
      return { status: 'rejected', error: this.#failure(RpcContractErrorCode.invalidFrame) }
    buffer.parts.push(snapshot.data as TEncoded)
    buffer.next += 1
    buffer.bytes += bytes
    this.#state.bufferedBytes += bytes
    if (
      buffer.bytes > this.#state.options.maxMessageBytes ||
      this.#state.bufferedBytes > this.#state.options.maxBufferedBytes
    ) {
      this.#clearBuffer(source, messageId)
      this.#markTerminal(source, messageId, false)
      return {
        status: 'rejected',
        error: this.#failure(RpcContractErrorCode.frameLimitExceeded)
      }
    }
    if (buffer.next !== buffer.count) return { status: 'pending' }
    /** String length is checked after joining, preserving the original surrogate behavior. */
    let complete =
      this.#state.kind === 'string' ? ((buffer.parts as string[]).join('') as TEncoded) : undefined
    /** Re-read actual binary lengths before allocating; declared totals never pad or overrun. */
    let actualLength = complete === undefined ? 0 : (0, this.#state.lengthOf)(complete)
    if (this.#state.kind === 'binary') {
      for (const part of buffer.parts as Uint8Array[]) actualLength += part.byteLength
    }
    if (actualLength !== buffer.expectedLength) {
      this.#clearBuffer(source, messageId)
      this.#markTerminal(source, messageId, false)
      return { status: 'rejected', error: this.#failure(RpcContractErrorCode.invalidFrame) }
    }
    if (complete === undefined) {
      /** Allocate the final binary carrier once, only after the actual total is valid. */
      const output = new Uint8Array(actualLength)
      /** Each original fragment contributes exactly one ordered copy into the final carrier. */
      let offset = 0
      for (const part of buffer.parts as Uint8Array[]) {
        output.set(part, offset)
        offset += part.byteLength
      }
      complete = output as TEncoded
    }
    this.#clearBuffer(source, messageId)
    this.#markTerminal(source, messageId, false)
    return { status: 'complete', value: complete }
  }

  /** Remove one physical source using only its existing owned buffer and terminal indexes. */
  readonly #closeSource = (source: string): void => {
    for (const id of this.#state.buffers.get(source)?.keys() ?? []) this.#clearBuffer(source, id)
    for (const state of this.#state.terminal.get(source)?.values() ?? [])
      this.#state.terminalOrder.delete(state)
    this.#state.terminal.delete(source)
  }

  #close = (): void => {
    this.#state.closed = true
    for (const [source, sourceMap] of this.#state.buffers) {
      for (const messageId of sourceMap.keys()) this.#clearBuffer(source, messageId)
    }
    this.#state.terminal.clear()
    this.#state.terminalOrder.clear()
  }
}

/** Construct the single owner for one source-scoped fragment reassembly lifetime. */
function createFragmentFramer<TKind extends 'string' | 'binary', TEncoded extends IEncoded>(
  kind: TKind,
  input: IRpcChunkOptions | undefined,
  lengthOf: (value: TEncoded) => number,
  slice: (value: TEncoded, start: number, end: number) => TEncoded
): IRpcChunkAssembler<TEncoded> {
  return new FragmentFramer<TKind, TEncoded>(kind, input, lengthOf, slice).value
}

/** Snapshot every frame field once so validation cannot race hostile accessors. */
function snapshotFrame(value: IFrame): IFrameSnapshot | undefined {
  return {
    messageId: value.messageId,
    index: value.index,
    count: value.count,
    length: value.length,
    data: value.data
  }
}
