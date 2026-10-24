import { isUint8Array } from '@migaia/utils/bytes'
import { observeThenableRejection } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { createDescriptor } from '../protocol.js'
import {
  registerNativeRpcFrameIngress,
  registerRpcSingleFrameFacts,
  type IRpcNativeFrameOutputDomain
} from './reassembler.js'
import { RpcContractErrorCode } from '../error-code.js'
import { createContractError, identifyContractCallbackFailure } from '../contract-error.js'
import type {
  IRpcBinaryFrame,
  IRpcFrameAcceptResult,
  IRpcFrameContext,
  IRpcFramer,
  IRpcFramerOptions,
  IRpcStringFrame
} from '../types.js'

type IEncoded = string | Uint8Array
type IFrame = IRpcStringFrame | IRpcBinaryFrame
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
  readonly kind: unknown
  readonly messageId: unknown
  readonly index: unknown
  readonly count: unknown
  readonly length: unknown
  readonly data: unknown
}

/**
 * Internal ingress accepts hostile unknown frames while remaining assignable to the public framer
 * contract.
 */
type IValidatedFramer<TEncoded, TFrame> = Omit<
  IRpcFramer<TEncoded, TFrame, 'message', 1>,
  'accept'
> & {
  readonly accept: (value: unknown, context: IRpcFrameContext) => IRpcFrameAcceptResult<TEncoded>
}

const DEFAULT_CHUNK_BYTES = 16 * 1024
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_CHUNKS = 4096
const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_CONCURRENT = 256

/** Validates bounded framer options before the framer becomes externally visible. */
function snapshotOptions(
  options: IRpcFramerOptions = {}
): Required<
  Pick<
    IRpcFramerOptions,
    | 'chunkBytes'
    | 'maxMessageBytes'
    | 'maxChunks'
    | 'maxBufferedBytes'
    | 'maxConcurrentMessages'
    | 'assemblyTimeoutMs'
  >
> &
  Pick<IRpcFramerOptions, 'now' | 'schedule' | 'cancel'> {
  const result = {
    chunkBytes: options.chunkBytes ?? DEFAULT_CHUNK_BYTES,
    maxMessageBytes: options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
    maxChunks: options.maxChunks ?? DEFAULT_MAX_CHUNKS,
    maxBufferedBytes: options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
    maxConcurrentMessages: options.maxConcurrentMessages ?? DEFAULT_MAX_CONCURRENT,
    assemblyTimeoutMs: options.assemblyTimeoutMs ?? 30_000,
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
      throw createContractError(RpcContractErrorCode.invalidFrame)
  }
  if (
    result.chunkBytes > result.maxMessageBytes ||
    result.maxMessageBytes > result.maxBufferedBytes
  )
    throw createContractError(RpcContractErrorCode.frameLimitExceeded)
  return result
}

/**
 * Create independent source/message reassembly state for strings. Small values pass through; larger
 * values split by UTF-16 code units, retaining strict fragment order and configured limits. Invalid
 * options throw before construction; accept returns pending/complete/rejected rather than throwing
 * for ordinary frame violations. Close releases assembly timers and rejects later input.
 */
export function createStringFramer<const TOptions extends IRpcFramerOptions = IRpcFramerOptions>(
  options?: TOptions
): IValidatedFramer<string, string | IRpcStringFrame> {
  return createFragmentFramer<'string', string>(
    'string',
    options,
    (value) => value.length,
    (value, start, end) => value.slice(start, end)
  ) as IValidatedFramer<string, string | IRpcStringFrame>
}

/**
 * Create independent source/message reassembly state for Uint8Array carriers. Large outbound values
 * use copied byte fragments; complete inbound fragments join into one owned buffer. Limits use
 * bytes, invalid options throw before construction, and ordinary invalid frames return a rejected
 * result. Close releases assembly timers and prevents subsequent framing/admission.
 */
export function createBinaryFramer<const TOptions extends IRpcFramerOptions = IRpcFramerOptions>(
  options?: TOptions
): IValidatedFramer<Uint8Array, Uint8Array | IRpcBinaryFrame> {
  return createFragmentFramer<'binary', Uint8Array>(
    'binary',
    options,
    (value) => value.byteLength,
    (value, start, end) => value.slice(start, end)
  ) as IValidatedFramer<Uint8Array, Uint8Array | IRpcBinaryFrame>
}

/** Builds one profile while keeping framing independent from semantic and codec layers. */
/** Allocate one source-scoped fragment reassembly lifetime before installing behavior callbacks. */
function fragmentFramerState<TKind extends 'string' | 'binary', TEncoded extends IEncoded>(
  kind: TKind,
  input: IRpcFramerOptions | undefined,
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
  readonly value: IValidatedFramer<TEncoded, TEncoded | IFrame>
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
    kind: TKind,
    input: IRpcFramerOptions | undefined,
    lengthOf: (value: TEncoded) => number,
    slice: (value: TEncoded, start: number, end: number) => TEncoded
  ) {
    this.#state = fragmentFramerState(kind, input, lengthOf, slice)
    /** Records the actual native output union without inferring it from descriptor metadata. */
    const nativeOutputDomain: IRpcNativeFrameOutputDomain = Object.freeze({
      kind: 'carrier-or-fragment',
      carrierEncodedType: this.#state.kind === 'string' ? 'string' : 'uint8array'
    })
    registerNativeRpcFrameIngress(
      this.#accept,
      this.#frame,
      (value, context) => {
        if (
          (this.#state.kind === 'string' && typeof value === 'string') ||
          (this.#state.kind === 'binary' &&
            typeof value === 'object' &&
            value !== null &&
            isUint8Array(value))
        )
          return Object.freeze({ frame: value, messageId: context.messageId })
        let snapshot: IFrameSnapshot | undefined
        try {
          snapshot =
            typeof value === 'object' && value !== null ? snapshotFrame(value as IFrame) : undefined
        } catch (cause) {
          const error = createContractError(RpcContractErrorCode.invalidFrame, cause)
          throw error
        }
        return Object.freeze({
          frame: snapshot ? Object.freeze(snapshot) : Object.freeze({}),
          messageId:
            typeof snapshot?.messageId === 'string' ? snapshot.messageId : context.messageId
        })
      },
      nativeOutputDomain
    )
    registerRpcSingleFrameFacts(this.#accept, this.#frame, {
      maxConcurrentMessages: this.#state.options.maxConcurrentMessages,
      maxMessageBytes: this.#state.options.maxMessageBytes
    })
    this.value = Object.freeze({
      ...createDescriptor('message', 1),
      inputEncodedType: this.#state.kind === 'string' ? 'string' : 'uint8array',
      outputEncodedType: this.#state.kind === 'string' ? 'string' : 'uint8array',
      frame: this.#frame,
      accept: this.#accept,
      close: this.#close
    }) as IValidatedFramer<TEncoded, TEncoded | IFrame>
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
      if (this.#state.options.schedule) return this.#state.options.schedule(callback, delay)
      /** Revoke assembly ownership and account once before a user cancel callback can reenter. */
      const timer = (
        globalThis as unknown as { setTimeout?: (task: () => void, timeout: number) => unknown }
      ).setTimeout
      if (!timer) return undefined
      return timer(callback, delay)
    } catch (error) {
      throw identifyContractCallbackFailure(error)
    }
  }

  #cancel = (handle: unknown): void => {
    if (this.#state.options.cancel) this.#state.options.cancel(handle)
    else {
      /** Revoke assembly ownership and account once before a user cancel callback can reenter. */
      const timer = (globalThis as unknown as { clearTimeout?: (value: unknown) => void })
        .clearTimeout
      timer?.(handle)
    }
  }

  #reportCleanupFailure = (error: unknown): void => {
    /** Reuse utils' terminal host observation when the optional host reporter cannot accept it. */
    const failure = identifyContractCallbackFailure(error)
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

  #frame = (value: TEncoded, context: IRpcFrameContext): readonly (TEncoded | IFrame)[] => {
    /** Whole carriers have the same message ceiling as fragmented and outbound messages. */
    const size = (0, this.#state.lengthOf)(value)
    if (!Number.isSafeInteger(size) || size > this.#state.options.maxMessageBytes)
      throw createContractError(RpcContractErrorCode.frameLimitExceeded)
    if (size <= this.#state.options.chunkBytes) return [value]
    const count = Math.ceil(size / this.#state.options.chunkBytes)
    if (count > this.#state.options.maxChunks)
      throw createContractError(RpcContractErrorCode.frameLimitExceeded)
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
          kind: 'rpc.frame.v1',
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

  #accept = (value: unknown, context: IRpcFrameContext): IRpcFrameAcceptResult<TEncoded> => {
    if (this.#state.closed)
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
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
          error: createContractError(RpcContractErrorCode.frameLimitExceeded)
        }
      return { status: 'complete', value: value as TEncoded }
    }
    if (typeof value !== 'object' || value === null)
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
    let snapshot: IFrameSnapshot | undefined
    try {
      snapshot = snapshotFrame(value as IFrame)
    } catch (cause) {
      const error = createContractError(RpcContractErrorCode.invalidFrame, cause)
      return { status: 'rejected', error }
    }
    if (
      snapshot === undefined ||
      snapshot.kind !== 'rpc.frame.v1' ||
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
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
    if (
      (this.#state.kind === 'string' && typeof snapshot.data !== 'string') ||
      (this.#state.kind === 'binary' &&
        (typeof snapshot.data !== 'object' ||
          snapshot.data === null ||
          !isUint8Array(snapshot.data)))
    )
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
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
        error: createContractError(RpcContractErrorCode.frameLimitExceeded)
      }
    const source = context.source
    const messageId = snapshot.messageId as string
    const terminalState = this.#state.terminal.get(source)?.get(messageId)?.didExpire
    if (terminalState !== undefined)
      return {
        status: 'rejected',
        error: createContractError(
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
          error: createContractError(
            index === 0
              ? RpcContractErrorCode.frameLimitExceeded
              : RpcContractErrorCode.invalidFrame
          )
        }
      buffer = { count, expectedLength: length, parts: [], bytes: 0, next: 0 }
      buffer.timer = this.#schedule(() => {
        if (!this.#state.buffers.get(source)?.has(messageId)) return
        this.#clearBuffer(source, messageId)
        this.#markTerminal(source, messageId, true)
      }, this.#state.options.assemblyTimeoutMs)
      this.#sourceBuffers(source).set(messageId, buffer)
      this.#state.activeBuffers += 1
    }
    if (buffer.count !== count || buffer.expectedLength !== length || index !== buffer.next)
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
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
        error: createContractError(RpcContractErrorCode.frameLimitExceeded)
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
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
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
  input: IRpcFramerOptions | undefined,
  lengthOf: (value: TEncoded) => number,
  slice: (value: TEncoded, start: number, end: number) => TEncoded
): IValidatedFramer<TEncoded, TEncoded | IFrame> {
  return new FragmentFramer<TKind, TEncoded>(kind, input, lengthOf, slice).value
}

/** Snapshot every frame field once so validation cannot race hostile accessors. */
function snapshotFrame(value: IFrame): IFrameSnapshot | undefined {
  return {
    kind: value.kind,
    messageId: value.messageId,
    index: value.index,
    count: value.count,
    length: value.length,
    data: value.data
  }
}

/** Canonical V1 whole-frame identity framer; it never fragments or allocates buffers. */
export const messageFramerV1 = Object.freeze({
  ...createDescriptor('message', 1),
  /** Accepts opaque whole carriers without inspecting their codec representation. */
  inputEncodedType: 'unknown' as const,
  /** Emits the same opaque carrier category; descriptor text grants no semantic admission. */
  outputEncodedType: 'unknown' as const,
  /** Returns the original value in a one-element list without copying its business data. */
  frame: <T>(value: T, _context: IRpcFrameContext): readonly T[] => [value],
  /** Always completes with the original whole value; callers still own semantic validation. */
  accept: <T>(value: T, _context?: IRpcFrameContext): IRpcFrameAcceptResult<T> => ({
    status: 'complete',
    value
  }),
  /** Stateless cleanup; later whole-frame operations remain available. */
  close: (_reason?: unknown): void => undefined
})

registerRpcSingleFrameFacts(messageFramerV1.accept, messageFramerV1.frame, {
  maxConcurrentMessages: DEFAULT_MAX_CONCURRENT,
  maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES
})
