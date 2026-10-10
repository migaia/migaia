import { isUint8Array } from '@migaia/utils/bytes'
import { createDescriptor } from '../protocol.js'
import {
  registerNativeRpcFrameIngress,
  registerRpcSingleFrameFacts,
  type IRpcNativeFrameOutputDomain
} from './reassembler.js'
import { RpcContractErrorCode } from '../error-code.js'
import { createContractError } from '../contract-error.js'
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

/** Creates a codec-independent string framer with strict ordered bounded reassembly. */
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

/** Creates a codec-independent binary framer with strict ordered bounded reassembly. */
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
function createFragmentFramer<TKind extends 'string' | 'binary', TEncoded extends IEncoded>(
  kind: TKind,
  input: IRpcFramerOptions | undefined,
  lengthOf: (value: TEncoded) => number,
  slice: (value: TEncoded, start: number, end: number) => TEncoded
): IValidatedFramer<TEncoded, TEncoded | IFrame> {
  const options = snapshotOptions(input)
  const buffers = new Map<string, Map<string, IBuffer<TEncoded>>>()
  /** Keep opaque source/message lookup separate from global eviction order. */
  const terminal = new Map<string, Map<string, ITerminalState>>()
  /** Map key order avoids scanning or moving the bounded recent-terminal entries. */
  const terminalOrder = new Map<ITerminalState, undefined>()
  let bufferedBytes = 0
  let activeBuffers = 0
  let closed = false
  /** Retain only a bounded recent terminal history for late-frame rejection. */
  const markTerminal = (source: string, messageId: string, didExpire: boolean): void => {
    /** The original nested owner keeps source/message pairs collision-free. */
    let sourceTerminal = terminal.get(source)
    if (!sourceTerminal) {
      sourceTerminal = new Map<string, ITerminalState>()
      terminal.set(source, sourceTerminal)
    }
    /** Reuse the canonical entry so updating a terminal also refreshes its insertion order. */
    let state = sourceTerminal.get(messageId)
    if (state) {
      terminalOrder.delete(state)
      state.didExpire = didExpire
    } else {
      state = { source, messageId, didExpire }
      sourceTerminal.set(messageId, state)
    }
    terminalOrder.set(state, undefined)
    while (terminalOrder.size > options.maxConcurrentMessages * 2) {
      /** The first Map key is the same oldest source/message pair the prior array retained. */
      const oldest = terminalOrder.keys().next().value
      if (!oldest) break
      terminalOrder.delete(oldest)
      /** Remove only the corresponding nested source entry; other sources remain independent. */
      const oldestMap = terminal.get(oldest.source)
      oldestMap?.delete(oldest.messageId)
      if (oldestMap?.size === 0) terminal.delete(oldest.source)
    }
  }
  const sourceBuffers = (source: string): Map<string, IBuffer<TEncoded>> => {
    let result = buffers.get(source)
    if (!result) {
      result = new Map<string, IBuffer<TEncoded>>()
      buffers.set(source, result)
    }
    return result
  }
  const schedule = (callback: () => void, delay: number): unknown => {
    if (options.schedule) return options.schedule(callback, delay)
    const timer = (
      globalThis as unknown as { setTimeout?: (task: () => void, timeout: number) => unknown }
    ).setTimeout
    if (!timer) return undefined
    return timer(callback, delay)
  }
  const cancel = (handle: unknown): void => {
    if (options.cancel) options.cancel(handle)
    else {
      const timer = (globalThis as unknown as { clearTimeout?: (value: unknown) => void })
        .clearTimeout
      timer?.(handle)
    }
  }
  const reportCleanupFailure = (error: unknown): void => {
    const reporter = (globalThis as unknown as { reportError?: (value: unknown) => void })
      .reportError
    try {
      reporter?.(error)
    } catch {
      // Reporting is diagnostic only and must not replace the primary frame result.
    }
  }
  const clearBuffer = (source: string, messageId: string): void => {
    const sourceMap = buffers.get(source)
    const buffer = sourceMap?.get(messageId)
    if (!sourceMap || !buffer) return
    if (buffer.timer !== undefined) {
      try {
        cancel(buffer.timer)
      } catch (error) {
        reportCleanupFailure(error)
      }
    }
    bufferedBytes -= buffer.bytes
    sourceMap.delete(messageId)
    if (sourceMap.size === 0) buffers.delete(source)
    activeBuffers -= 1
  }
  const frame = (value: TEncoded, context: IRpcFrameContext): readonly (TEncoded | IFrame)[] => {
    const size = lengthOf(value)
    if (!Number.isSafeInteger(size) || size > options.maxMessageBytes)
      throw createContractError(RpcContractErrorCode.frameLimitExceeded)
    if (size <= options.chunkBytes) return [value]
    const count = Math.ceil(size / options.chunkBytes)
    if (count > options.maxChunks)
      throw createContractError(RpcContractErrorCode.frameLimitExceeded)
    const frames: IFrame[] = []
    for (let index = 0; index < count; index += 1) {
      const start = index * options.chunkBytes
      const data = slice(value, start, Math.min(size, start + options.chunkBytes))
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
  const accept = (value: unknown, context: IRpcFrameContext): IRpcFrameAcceptResult<TEncoded> => {
    if (closed)
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
    if (
      (kind === 'string' && typeof value === 'string') ||
      (kind === 'binary' && typeof value === 'object' && value !== null && isUint8Array(value))
    )
      return { status: 'complete', value: value as TEncoded }
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
      snapshot.count > options.maxChunks ||
      typeof snapshot.length !== 'number' ||
      !Number.isSafeInteger(snapshot.length)
    )
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
    if (
      (kind === 'string' && typeof snapshot.data !== 'string') ||
      (kind === 'binary' &&
        (typeof snapshot.data !== 'object' ||
          snapshot.data === null ||
          !isUint8Array(snapshot.data)))
    )
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
    const index = snapshot.index as number
    const count = snapshot.count as number
    const length = snapshot.length as number
    const bytes = lengthOf(snapshot.data as TEncoded)
    if (length <= 0 || length > options.maxMessageBytes || bytes > options.chunkBytes)
      return {
        status: 'rejected',
        error: createContractError(RpcContractErrorCode.frameLimitExceeded)
      }
    const source = context.source
    const messageId = snapshot.messageId as string
    const terminalState = terminal.get(source)?.get(messageId)?.didExpire
    if (terminalState !== undefined)
      return {
        status: 'rejected',
        error: createContractError(
          terminalState
            ? RpcContractErrorCode.frameAssemblyExpired
            : RpcContractErrorCode.invalidFrame
        )
      }
    let buffer = buffers.get(source)?.get(messageId)
    if (!buffer) {
      if (
        index !== 0 ||
        activeBuffers >= options.maxConcurrentMessages ||
        bufferedBytes + bytes > options.maxBufferedBytes
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
      buffer.timer = schedule(() => {
        if (!buffers.get(source)?.has(messageId)) return
        clearBuffer(source, messageId)
        markTerminal(source, messageId, true)
      }, options.assemblyTimeoutMs)
      sourceBuffers(source).set(messageId, buffer)
      activeBuffers += 1
    }
    if (buffer.count !== count || buffer.expectedLength !== length || index !== buffer.next)
      return { status: 'rejected', error: createContractError(RpcContractErrorCode.invalidFrame) }
    buffer.parts.push(snapshot.data as TEncoded)
    buffer.next += 1
    buffer.bytes += bytes
    bufferedBytes += bytes
    if (buffer.bytes > options.maxMessageBytes || bufferedBytes > options.maxBufferedBytes) {
      clearBuffer(source, messageId)
      markTerminal(source, messageId, false)
      return {
        status: 'rejected',
        error: createContractError(RpcContractErrorCode.frameLimitExceeded)
      }
    }
    if (buffer.next !== buffer.count) return { status: 'pending' }
    /** String length is checked after joining, preserving the original surrogate behavior. */
    let complete = kind === 'string' ? ((buffer.parts as string[]).join('') as TEncoded) : undefined
    /** Re-read actual binary lengths before allocating; declared totals never pad or overrun. */
    let actualLength = complete === undefined ? 0 : lengthOf(complete)
    if (kind === 'binary') {
      for (const part of buffer.parts as Uint8Array[]) actualLength += part.byteLength
    }
    if (actualLength !== buffer.expectedLength) {
      clearBuffer(source, messageId)
      markTerminal(source, messageId, false)
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
    clearBuffer(source, messageId)
    markTerminal(source, messageId, false)
    return { status: 'complete', value: complete }
  }
  const close = (): void => {
    closed = true
    for (const [source, sourceMap] of buffers) {
      for (const messageId of sourceMap.keys()) clearBuffer(source, messageId)
    }
    terminal.clear()
    terminalOrder.clear()
  }
  /** Records the actual native output union without inferring it from descriptor metadata. */
  const nativeOutputDomain: IRpcNativeFrameOutputDomain = Object.freeze({
    kind: 'carrier-or-fragment',
    carrierEncodedType: kind === 'string' ? 'string' : 'uint8array'
  })
  registerNativeRpcFrameIngress(
    accept,
    frame,
    (value, context) => {
      if (
        (kind === 'string' && typeof value === 'string') ||
        (kind === 'binary' && typeof value === 'object' && value !== null && isUint8Array(value))
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
        messageId: typeof snapshot?.messageId === 'string' ? snapshot.messageId : context.messageId
      })
    },
    nativeOutputDomain
  )
  registerRpcSingleFrameFacts(accept, frame, {
    maxConcurrentMessages: options.maxConcurrentMessages,
    maxMessageBytes: options.maxMessageBytes
  })
  return Object.freeze({
    ...createDescriptor('message', 1),
    inputEncodedType: kind === 'string' ? 'string' : 'uint8array',
    outputEncodedType: kind === 'string' ? 'string' : 'uint8array',
    frame,
    accept,
    close
  }) as IValidatedFramer<TEncoded, TEncoded | IFrame>
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
  inputEncodedType: 'unknown' as const,
  outputEncodedType: 'unknown' as const,
  frame: <T>(value: T, _context: IRpcFrameContext): readonly T[] => [value],
  accept: <T>(value: T, _context?: IRpcFrameContext): IRpcFrameAcceptResult<T> => ({
    status: 'complete',
    value
  }),
  close: (_reason?: unknown): void => undefined
})

registerRpcSingleFrameFacts(messageFramerV1.accept, messageFramerV1.frame, {
  maxConcurrentMessages: DEFAULT_MAX_CONCURRENT,
  maxMessageBytes: DEFAULT_MAX_MESSAGE_BYTES
})
