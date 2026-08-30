import {
  SerializeCodecError,
  encodeSerializeTextChunk,
  validateSerializeChunk,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeRegistry,
  type ISerializeScheduler,
  type ITextEncoder
} from './types.js'
import {
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText,
  SERIALIZE_SOURCE
} from './errors.js'
import { SerializeChunkKind, SerializePhase } from './format-constants.js'
import { createSerializeOperationSignal } from './signal.js'
import { snapshotSerializeSignal } from './signal-snapshot.js'
import { attachSecondaryErrors, safeErrorReason } from '@migaia/utils/error'

type ISerializeScheduledTask = { cancel(): void }

/** Fully admitted frame-budget options; no field reads remain when slicing begins. */
type IFrameBudgetSnapshot = {
  readonly targetMs: number
  readonly minItems: number
  readonly maxItems: number
  readonly initialItems: number
  readonly yieldTo?: () => Promise<void>
  readonly signal?: ISerializeAbortSignal
  readonly scheduler: ISerializeScheduler
}

/** Fully admitted encode-stream options captured before the first slice or registry call. */
type IEncodeStreamSnapshot = IFrameBudgetSnapshot & {
  readonly type?: string
  readonly context: string
  readonly maxInFlight: number
}

/** Fully admitted decode-stream options captured before the input iterator is touched. */
type IDecodeStreamSnapshot = {
  readonly type?: string
  readonly context: string
  readonly signal?: ISerializeAbortSignal
}

/** Invoke one captured method with its original protocol receiver. */
type ISerializeInvokable<TResult> = (...args: never[]) => TResult

/**
 * MRC-C-R02-only receiver boundary: invokes the once-captured encoder method with its original
 * receiver.
 */
const invokeCollectEncoderWithReceiver = <TResult>(
  method: ISerializeInvokable<TResult>,
  receiver: object,
  args: readonly unknown[]
): TResult => Reflect.apply(method, receiver, args)

/** Add a secondary cleanup failure without changing the earlier primary result. */
/** Finish public encode-stream cleanup while preserving any earlier primary throw identity. */
const finalizeEncodeStreamCleanup = (
  cleanupErrors: readonly unknown[],
  hasPrimary: boolean,
  primaryError: unknown
): void => {
  if (hasPrimary) {
    throw attachSecondaryErrors(primaryError, cleanupErrors)
  }
  if (cleanupErrors.length > 0) throw cleanupErrors[0]
}

/** Attaches one cleanup failure while preserving Serialize's primary error projection. */
const attachSerializeCleanupError = (primaryError: unknown, cleanupError: unknown): unknown =>
  attachSecondaryErrors(primaryError, [cleanupError])

/** Keep an already-owned serialize INVALID_OPTION intact while wrapping a hostile failure. */
const isSerializeInvalidOption = (error: unknown): boolean => {
  try {
    return (
      error instanceof Error &&
      (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE &&
      (error as { readonly code?: unknown }).code === SerializeErrorCode.invalidOption
    )
  } catch {
    return false
  }
}

/** Extract hostile protocol-failure text without allowing diagnostics to replace the primary. */
const streamFailureReason = (error: unknown): string =>
  safeErrorReason(error, SerializeErrorText.reasonUnavailable)

/** Keep pre-existing serialize-owned invalid-chunk errors unchanged during stream cleanup. */
const isSerializeInvalidChunk = (error: unknown): boolean => {
  try {
    return (
      error instanceof Error &&
      (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE &&
      (error as { readonly code?: unknown }).code === SerializeErrorCode.invalidChunk
    )
  } catch {
    return false
  }
}

/** Wrap one encode admission failure with the slice index that owns the invocation. */
const encodeStreamFailure = (
  error: unknown,
  sliceIndex: number,
  type: string | undefined,
  context: string,
  registry: ISerializeRegistry
): SerializeCodecError =>
  new SerializeCodecError(
    `encode stream failed at slice ${sliceIndex}: ${streamFailureReason(error)}`,
    {
      type: type ?? registry.primaryType,
      phase: SerializePhase.encode,
      context,
      chunkIndex: sliceIndex,
      bytesConsumed: 0,
      code: SerializeErrorCode.encodeFailed,
      cause: error
    }
  )

/** Convert any stream-option getter, shape, or value failure to serialize INVALID_OPTION. */
const streamOptionFailure = (error: unknown): never => {
  if (isSerializeInvalidOption(error)) throw error
  throw createSerializeTypeError(
    SerializeErrorCode.invalidOption,
    SerializeErrorText.operationOptionInvalid,
    { cause: error }
  )
}

/** Translate a task-release failure without replacing its native TypeError semantics. */
const translateTaskCancelFailure = (error: unknown): unknown =>
  isSerializeInvalidOption(error)
    ? error
    : createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerTaskCancelFailed,
        { cause: error }
      )

/** Read an operation signal's current state while keeping failures at serialize's boundary. */
const readSerializeSignalAborted = (signal: ISerializeAbortSignal): boolean => {
  try {
    if (typeof signal.aborted !== 'boolean') throw new TypeError(SerializeErrorText.signalInvalid)
    return signal.aborted
  } catch (error) {
    if (isSerializeInvalidOption(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}

/** Read an operation abort reason only when cancellation wins the owned-yield race. */
const readSerializeSignalReason = (signal: ISerializeAbortSignal): unknown => {
  try {
    return signal.reason
  } catch (error) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalReasonReadFailed,
      { cause: error }
    )
  }
}

/**
 * Schedule one default frame yield and own its returned task until callback, cancellation, or
 * failure. The state remains pending until `schedule()` returns so synchronous callbacks still
 * release the handle; every cleanup failure is either the first failure or a contained secondary.
 */
const scheduleOwnedYield = (
  scheduler: ISerializeScheduler,
  signal: ISerializeAbortSignal | undefined
): Promise<void> => {
  let resolveYield!: () => void
  let rejectYield!: (error: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    resolveYield = resolve
    rejectYield = reject
  })
  /** Task returned by scheduler, retained until exactly-once cleanup. */
  let task: ISerializeScheduledTask | undefined
  /** Whether scheduler callback has fired, including synchronous reentrancy. */
  let callbackFired = false
  /** Whether schedule invocation has returned or failed. */
  let scheduleSettled = false
  /** Whether a primary outcome has been recorded. */
  let hasPrimary = false
  /** First failure, which cleanup failures must not replace. */
  let primaryError: unknown
  /** Whether task cancellation has been attempted already. */
  let cancelAttempted = false
  /** Whether returned promise has been settled. */
  let settled = false
  /** Whether abort listener registration was attempted. */
  let listenerAttempted = false
  /** Whether abort listener removal was attempted. */
  let listenerRemoved = false
  /** Captured signal listener methods preserve receiver and avoid repeated hostile reads. */
  let addAbortListener: ISerializeInvokable<void> | undefined
  let removeAbortListener: ISerializeInvokable<void> | undefined
  const signalReceiver = signal as object | undefined
  /** Callback removes the owned listener and cancels the owned task before final settlement. */
  const cleanup = (): void => {
    if (task !== undefined && !cancelAttempted) {
      cancelAttempted = true
      try {
        task.cancel()
      } catch (error) {
        const cleanupError = translateTaskCancelFailure(error)
        if (!hasPrimary) {
          primaryError = cleanupError
          hasPrimary = true
        } else {
          primaryError = attachSerializeCleanupError(primaryError, cleanupError)
        }
      }
    }
    if (
      signalReceiver !== undefined &&
      addAbortListener !== undefined &&
      removeAbortListener !== undefined &&
      listenerAttempted &&
      !listenerRemoved
    ) {
      listenerRemoved = true
      try {
        Reflect.apply(removeAbortListener, signalReceiver, ['abort', onAbort])
      } catch (error) {
        const cleanupError = isSerializeInvalidOption(error)
          ? error
          : createSerializeTypeError(
              SerializeErrorCode.invalidOption,
              SerializeErrorText.signalAccessorFailed,
              { cause: error }
            )
        if (!hasPrimary) {
          primaryError = cleanupError
          hasPrimary = true
        } else {
          primaryError = attachSerializeCleanupError(primaryError, cleanupError)
        }
      }
    }
  }
  /** Settle only after the scheduler return boundary exposes the task handle. */
  const finish = (): void => {
    if (settled || !scheduleSettled || (!callbackFired && !hasPrimary)) return
    cleanup()
    settled = true
    if (hasPrimary) rejectYield(primaryError)
    else resolveYield()
  }
  /** Abort callback makes cancellation the primary outcome and releases any admitted task. */
  function onAbort(): void {
    if (settled || hasPrimary) return
    try {
      primaryError = createSerializeError(SerializeErrorCode.aborted, 'serialize aborted', {
        cause: signal === undefined ? undefined : readSerializeSignalReason(signal)
      })
    } catch (error) {
      primaryError = error
    }
    hasPrimary = true
    finish()
  }
  /**
   * Recheck structural signal state after listener admission, including hosts that do not replay
   * abort.
   */
  const recheckAbortAfterRegistration = (): void => {
    if (signal === undefined || hasPrimary) return
    if (readSerializeSignalAborted(signal)) onAbort()
  }

  try {
    if (signal !== undefined) {
      if (readSerializeSignalAborted(signal)) {
        onAbort()
        scheduleSettled = true
        finish()
        return promise
      }
      const add = signal.addEventListener
      const remove = signal.removeEventListener
      if (typeof add !== 'function' || typeof remove !== 'function') {
        throw new TypeError(SerializeErrorText.signalInvalid)
      }
      addAbortListener = add as ISerializeInvokable<void>
      removeAbortListener = remove as ISerializeInvokable<void>
      listenerAttempted = true
      try {
        Reflect.apply(addAbortListener, signal, ['abort', onAbort, { once: true }])
      } catch (error) {
        const registrationError = isSerializeInvalidOption(error)
          ? error
          : createSerializeTypeError(
              SerializeErrorCode.invalidOption,
              SerializeErrorText.signalRegistrationFailed,
              { cause: error }
            )
        let recheckFailed = false
        let recheckError: unknown
        try {
          recheckAbortAfterRegistration()
        } catch (error) {
          recheckFailed = true
          recheckError = error
        }
        primaryError = registrationError
        hasPrimary = true
        if (recheckFailed) primaryError = attachSerializeCleanupError(primaryError, recheckError)
        scheduleSettled = true
        finish()
        return promise
      }
      recheckAbortAfterRegistration()
      if (hasPrimary) {
        scheduleSettled = true
        finish()
        return promise
      }
    }
    task = scheduler.schedule(() => {
      callbackFired = true
      finish()
    }, 0)
    scheduleSettled = true
  } catch (error) {
    if (!hasPrimary) {
      primaryError = isSerializeInvalidOption(error)
        ? error
        : createSerializeTypeError(
            SerializeErrorCode.invalidOption,
            SerializeErrorText.schedulerInvalid,
            { cause: error }
          )
      hasPrimary = true
    } else {
      primaryError = attachSerializeCleanupError(primaryError, error)
    }
    scheduleSettled = true
  }
  finish()
  return promise
}

/** Validate a scheduler clock value at the serialize core boundary. */
const validateSchedulerNow = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerNowType
    )
  }
  if (!Number.isFinite(value)) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerNowRange
    )
  }
  return value
}

/** Capture one scheduler task and translate hostile task access into serialize ownership. */
const snapshotScheduledTask = (value: unknown): ISerializeScheduledTask => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerTaskInvalid
    )
  }
  let cancel: unknown
  try {
    cancel = (value as { cancel?: unknown }).cancel
  } catch (error) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerTaskCancelGetterFailed,
      { cause: error }
    )
  }
  if (typeof cancel !== 'function') {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerTaskInvalid
    )
  }
  const receiver = value
  return { cancel: () => Reflect.apply(cancel as () => void, receiver, []) }
}

/** Capture scheduler methods once and translate every scheduler failure into serialize errors. */
const snapshotSerializeScheduler = (value: unknown): ISerializeScheduler | undefined => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined
  }
  const receiver = value
  let now: unknown
  let schedule: unknown
  try {
    now = (value as { now?: unknown }).now
    schedule = (value as { schedule?: unknown }).schedule
  } catch (error) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.schedulerAccessorFailed,
      { cause: error }
    )
  }
  if (typeof now !== 'function' || typeof schedule !== 'function') return undefined
  const isOwnedInvalidOption = (error: unknown): boolean =>
    error instanceof Error &&
    (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE &&
    (error as { readonly code?: unknown }).code === SerializeErrorCode.invalidOption
  return {
    now: () => {
      try {
        return validateSchedulerNow(Reflect.apply(now as () => unknown, receiver, []))
      } catch (error) {
        if (isOwnedInvalidOption(error)) throw error
        throw createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.schedulerNowType,
          { cause: error }
        )
      }
    },
    schedule: (callback, delayMs) => {
      try {
        return snapshotScheduledTask(
          Reflect.apply(schedule as (callback: () => void, delayMs: number) => unknown, receiver, [
            callback,
            delayMs
          ])
        )
      } catch (error) {
        if (isOwnedInvalidOption(error)) throw error
        throw createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.schedulerInvalid,
          { cause: error }
        )
      }
    }
  }
}

/**
 * 帧预算切片。
 *
 * 实测（100 万条 → worker）：整包一次性编码会连续占住主线程 237ms，约合掉 14 帧； 切成 5 万条一片、片间让出后，最长单次阻塞降到 14.2ms —— 压在 60fps 的
 * 16.7ms 预算之内，一帧不掉，墙钟还快了 37%。但切过头同样有害：1 万条一片时最长阻塞 只有 3.1ms，可 100 次让出的固定开销把墙钟顶回了整包水平。
 *
 * 所以片大小不能按字节数写死，得按**实测耗时**反推。这里的做法是让生成器在 yield 之后挂起，消费者取下一片时才恢复——挂起与恢复之间的时差正好等于消费者
 * 处理这一片的真实耗时，据此调整下一片。
 */
export type IFrameBudgetOptions = {
  /** 每片目标耗时。默认 8ms：60fps 一帧 16.7ms，留一半余量给渲染与其他任务， 免得刚好卡在预算边缘时被别的工作顶出去。 */
  readonly targetMs?: number
  /** 片大小下界，防止把开销摊成纯消息成本。 */
  readonly minItems?: number
  /** 片大小上界，防止首片就把主线程占死。 */
  readonly maxItems?: number
  /** 首片大小。太大则第一片必然超预算，所以刻意保守。 */
  readonly initialItems?: number
  /**
   * 让出方式。缺省用 `scheduler.schedule(resolve, 0)`；可换成 `scheduler.yield()`（更精确）或
   * requestIdleCallback（更保守）。
   */
  readonly yieldTo?: () => Promise<void>
  readonly signal?: ISerializeAbortSignal
  /**
   * Runtime-neutral scheduler（**必填**，R-4：core 无默认 timer、不直接使用宿主
   * `setTimeout`/`performance`/`Date.now`）。
   */
  readonly scheduler: ISerializeScheduler
}

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value

/** 有限正数；NaN 与 Infinity 都要挡住。 */
function assertPositiveMs(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `frame budget ${name} must be a finite positive number, got ${value}`
    )
  }
}

/** 条目数必须是有限正整数——小数会让片边界漂移，NaN 会让循环停不下来。 */
function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `frame budget ${name} must be a positive integer, got ${value}`
    )
  }
}

/** Capture and validate frame-budget fields exactly once before any iterator side effect. */
const snapshotFrameBudgetOptions = (options: unknown): IFrameBudgetSnapshot => {
  try {
    if (options === null || typeof options !== 'object') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    const candidate = options as Record<string, unknown>
    const targetMsValue = candidate.targetMs
    const minItemsValue = candidate.minItems
    const maxItemsValue = candidate.maxItems
    const initialItemsValue = candidate.initialItems
    const yieldToValue = candidate.yieldTo
    const signalValue = candidate.signal
    const schedulerValue = candidate.scheduler
    const targetMs = targetMsValue === undefined ? 8 : targetMsValue
    const minItems = minItemsValue === undefined ? 64 : minItemsValue
    const maxItems = maxItemsValue === undefined ? 250_000 : maxItemsValue
    const initialItems = initialItemsValue === undefined ? 2_048 : initialItemsValue
    const yieldTo = yieldToValue === undefined ? undefined : (yieldToValue as () => Promise<void>)
    if (typeof targetMs !== 'number') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof minItems !== 'number') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof maxItems !== 'number') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof initialItems !== 'number')
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (yieldTo !== undefined && typeof yieldTo !== 'function') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    const scheduler = snapshotSerializeScheduler(schedulerValue)
    if (scheduler === undefined) {
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerInvalid
      )
    }
    const signal = signalValue === undefined ? undefined : snapshotSerializeSignal(signalValue)
    assertPositiveMs(targetMs, 'targetMs')
    assertCount(minItems, 'minItems')
    assertCount(maxItems, 'maxItems')
    assertCount(initialItems, 'initialItems')
    if (maxItems < minItems) {
      throw createSerializeRangeError(
        SerializeErrorCode.invalidOption,
        'frame budget maxItems must be at least minItems'
      )
    }
    return { targetMs, minItems, maxItems, initialItems, yieldTo, signal, scheduler }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Capture encode-stream fields once, including all inherited frame-budget options. */
const snapshotEncodeStreamOptions = (options: unknown): IEncodeStreamSnapshot => {
  try {
    if (options === null || typeof options !== 'object') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    const candidate = options as Record<string, unknown>
    const typeValue = candidate.type
    const contextValue = candidate.context
    const maxInFlightValue = candidate.maxInFlight
    const frame = snapshotFrameBudgetOptions(options)
    const type = typeValue === undefined ? undefined : typeValue
    const context = contextValue === undefined ? 'stream' : contextValue
    const maxInFlight = maxInFlightValue === undefined ? 1 : maxInFlightValue
    if (type !== undefined && typeof type !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (typeof context !== 'string') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    if (typeof maxInFlight !== 'number') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1) {
      throw createSerializeRangeError(
        SerializeErrorCode.invalidOption,
        `maxInFlight must be a positive integer, got ${maxInFlight}`
      )
    }
    return { ...frame, type, context, maxInFlight }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Capture decode-stream fields once before the source iterator is requested. */
const snapshotDecodeStreamOptions = (options: unknown): IDecodeStreamSnapshot => {
  try {
    if (options === null || typeof options !== 'object') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    const candidate = options as Record<string, unknown>
    const typeValue = candidate.type
    const contextValue = candidate.context
    const signalValue = candidate.signal
    const type = typeValue === undefined ? undefined : typeValue
    const context = contextValue === undefined ? 'stream' : contextValue
    if (type !== undefined && typeof type !== 'string') {
      throw new TypeError(SerializeErrorText.operationOptionInvalid)
    }
    if (typeof context !== 'string') throw new TypeError(SerializeErrorText.operationOptionInvalid)
    const signal = signalValue === undefined ? undefined : snapshotSerializeSignal(signalValue)
    return { type, context, signal }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/**
 * 按帧预算把一个大数组切成若干片，片间让出主线程。
 *
 * 用法是 `for await (const slice of sliceByFrameBudget(rows))`，循环体里做实际 工作——那段耗时会被自动量到，用来定下一片的大小。
 */
export async function* sliceByFrameBudget<T>(
  items: readonly T[],
  options: IFrameBudgetOptions
): AsyncGenerator<readonly T[], void, undefined> {
  const { targetMs, minItems, maxItems, initialItems, yieldTo, signal, scheduler } =
    snapshotFrameBudgetOptions(options)
  const now = (): number => scheduler.now()
  const resolveYield = yieldTo ?? (() => scheduleOwnedYield(scheduler, signal))

  let size = clamp(initialItems, minItems, maxItems)
  let index = 0
  while (index < items.length) {
    if (signal !== undefined && readSerializeSignalAborted(signal))
      throw createSerializeError(SerializeErrorCode.aborted, 'serialize aborted', {
        cause: readSerializeSignalReason(signal)
      })
    const slice = items.slice(index, index + size)
    const startedAt = now()
    yield slice
    // 恢复点：消费者已经处理完这一片，时差即其真实耗时
    const elapsed = now() - startedAt
    index += slice.length

    // 阻尼调整：直接按比例缩放会在噪声下来回振荡，取当前值与目标值的中点。
    // elapsed 极小时用下限兜底，避免除出一个荒谬的放大倍数。
    const ratio = targetMs / Math.max(elapsed, 0.05)
    const target = clamp(Math.round(size * ratio), minItems, maxItems)
    size = clamp(Math.round((size + target) / 2), minItems, maxItems)

    if (index < items.length) await resolveYield()
  }
}

export type IEncodeStreamOptions = IFrameBudgetOptions & {
  readonly type?: string
  readonly context?: string
  /** 同时在途的请求数上限，即背压。默认 1：编好一片就等它落地再编下一片， 峰值内存只有一片。调高可以让编码与 worker 处理重叠，代价是峰值内存翻倍。 */
  readonly maxInFlight?: number
}

/** Captured policy for one collector operation; getters are read before iterator acquisition. */
export type ICollectStreamOptions = {
  readonly signal?: ISerializeAbortSignal
  readonly empty?: 'text' | 'reject'
  readonly context?: string
}

/**
 * 把一个大数组编码成分段流，**不做拼装**。
 *
 * 与 registry.encode 的区别就在这里：encode 会把所有分段合并成一整块返回， 适合「最终要一个完整 blob」的场景；而落 IndexedDB、写文件、发 fetch
 * body 这类消费者能逐片吃下，拼装反而白白制造一个全量大对象的峰值内存。
 */
export async function* encodeStream<T>(
  registry: ISerializeRegistry,
  items: readonly T[],
  options: IEncodeStreamOptions
): AsyncGenerator<ISerializeChunk, void, undefined> {
  const streamOptions = snapshotEncodeStreamOptions(options)
  const { type, context, maxInFlight } = streamOptions
  const callerSignal = streamOptions.signal
  /** Exact listener and operation cleanup failures retained until generator finalization. */
  const cleanupErrors: unknown[] = []
  /** Owner-local reporter keeps public cleanup failures observable without adding an API option. */
  const reportCleanupFailure = (error: unknown): void => {
    cleanupErrors.push(error)
  }
  const operation = createSerializeOperationSignal(callerSignal, reportCleanupFailure)
  const operationSignal = operation.signal
  const operationOptions = { ...streamOptions, signal: operationSignal }
  const inFlight: Array<Promise<ISerializeChunk> | undefined> = []
  let inFlightHead = 0
  let sliceIndex = 0
  let completed = false
  /** Whether the generator body recorded a primary throw before finalization. */
  let hasPrimary = false
  /** First generator-body failure; cleanup failures must remain secondary to it. */
  let primaryError: unknown

  const drainOne = async (): Promise<ISerializeChunk> => {
    const pending = inFlight[inFlightHead]!
    inFlight[inFlightHead] = undefined
    inFlightHead += 1
    try {
      return await pending
    } catch (error) {
      // 刻意不透传内层 SerializeCodecError：它的 chunkIndex 说的是「本次编码的第几段」，
      // 恒为 0，会把「流里的第几片」这个真正有用的位置盖掉。原错误挂在 cause 上。
      throw encodeStreamFailure(error, sliceIndex, type, context, registry)
    }
  }

  try {
    for await (const slice of sliceByFrameBudget(items, operationOptions)) {
      if (readSerializeSignalAborted(operationSignal)) {
        throw createSerializeError(SerializeErrorCode.aborted, 'serialize aborted', {
          cause: readSerializeSignalReason(operationSignal)
        })
      }
      let pending: Promise<ISerializeChunk>
      try {
        // Promise.resolve preserves native Promise identity and assimilates thenables while the
        // catch below is installed in the same admission turn.
        pending = Promise.resolve(
          registry.encode(slice, { type, signal: operationSignal, context })
        )
      } catch (error) {
        // A synchronous registry failure is still an ordered admission. Queue its rejection so
        // earlier work drains first and the same immediate observer prevents unhandled rejection.
        pending = Promise.reject(error)
      }
      // Observe every queued rejection at admission; draining later must still await the original
      // Promise so ordered output and exact error identity remain unchanged.
      pending.catch(() => undefined)
      inFlight.push(pending)
      // 背压：在途数达到上限就先把最早那笔排空，避免无限堆积
      while (inFlight.length - inFlightHead >= maxInFlight) {
        yield await drainOne()
        sliceIndex++
      }
    }
    while (inFlight.length - inFlightHead > 0) {
      yield await drainOne()
      sliceIndex++
    }
    completed = true
  } catch (error) {
    hasPrimary = true
    primaryError = error
  } finally {
    // Consumer early return/throw owns cancellation of queued work before observing settlement.
    if (!completed && !operationSignal.aborted)
      operation.abort(SerializeErrorText.streamConsumerClosed)
    // Admission-time rejection observers retain ownership of residual noncooperative work.
    // Do not await it here: a parser that ignores abort must not block generator finalization.
    for (const pending of inFlight.slice(inFlightHead)) pending?.catch(() => undefined)
    operation.dispose()
    inFlight.length = 0
    inFlightHead = 0
    finalizeEncodeStreamCleanup(cleanupErrors, hasPrimary, primaryError)
  }
}

/** 把分段流逐片解码，同样不做拼装。 */
export async function* decodeStream(
  registry: ISerializeRegistry,
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  options: {
    readonly type?: string
    readonly context?: string
    readonly signal?: ISerializeAbortSignal
  } = {}
): AsyncGenerator<unknown, void, undefined> {
  const { type, context, signal } = snapshotDecodeStreamOptions(options)
  let index = 0
  let ownedError: unknown
  try {
    for await (const chunk of chunks as AsyncIterable<ISerializeChunk>) {
      if (signal !== undefined && readSerializeSignalAborted(signal)) {
        ownedError = createSerializeError(SerializeErrorCode.aborted, 'serialize aborted', {
          cause: readSerializeSignalReason(signal)
        })
        throw ownedError
      }
      try {
        yield await registry.decode(chunk, { type, signal, context })
      } catch (error) {
        // 同上：保留流位置，内层错误挂 cause
        ownedError = new SerializeCodecError(
          `decode stream failed at chunk ${index}: ${streamFailureReason(error)}`,
          {
            type: type ?? registry.primaryType,
            phase: SerializePhase.decode,
            context,
            chunkIndex: index,
            bytesConsumed: 0,
            code: SerializeErrorCode.decodeFailed,
            cause: error
          }
        )
        throw ownedError
      }
      index++
    }
  } catch (error) {
    if (error === ownedError) throw error
    throw new SerializeCodecError(
      `decode stream failed at chunk ${index}: ${streamFailureReason(error)}`,
      {
        type: type ?? registry.primaryType,
        phase: SerializePhase.decode,
        context,
        chunkIndex: index,
        bytesConsumed: 0,
        code: SerializeErrorCode.decodeFailed,
        cause: error
      }
    )
  }
}

/** 把分段流合并成一整块。只在消费者确实需要完整 blob 时才用——它会把整份数据 同时驻留在内存里，正是流式想避免的那笔峰值。 */
export async function collectStream(
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  encoder?: ITextEncoder,
  options?: ICollectStreamOptions
): Promise<ISerializeChunk> {
  const collectOptions = snapshotCollectOptions(options)
  const capturedEncoder = snapshotCollectEncoder(encoder)
  const collected: ISerializeChunk[] = []
  let sawBytes = false
  let bytesConsumed = 0
  let index = 0
  const chunkProgress: number[] = []
  let iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined
  let primaryError: unknown
  let completed = false
  try {
    checkCollectAbort(collectOptions.signal)
    iterator = getCollectIterator(chunks)
    while (true) {
      checkCollectAbort(collectOptions.signal)
      const step = await iterator.next()
      if (step === null || (typeof step !== 'object' && typeof step !== 'function'))
        throw new SerializeCodecError(SerializeErrorText.collectOptionInvalid, {
          type: 'stream',
          phase: SerializePhase.encode,
          context: collectOptions.context,
          chunkIndex: index,
          bytesConsumed,
          code: SerializeErrorCode.encodeFailed,
          cause: step
        })
      let done: unknown
      try {
        done = step.done
      } catch (error) {
        throw new SerializeCodecError(
          `collect stream failed at chunk ${index}: ${streamFailureReason(error)}`,
          {
            type: 'stream',
            phase: SerializePhase.encode,
            context: collectOptions.context,
            chunkIndex: index,
            bytesConsumed,
            code: SerializeErrorCode.encodeFailed,
            cause: error
          }
        )
      }
      if (done) {
        completed = true
        break
      }
      let chunk: unknown
      try {
        chunk = step.value
      } catch (error) {
        throw new SerializeCodecError(
          `collect stream failed at chunk ${index}: ${streamFailureReason(error)}`,
          {
            type: 'stream',
            phase: SerializePhase.encode,
            context: collectOptions.context,
            chunkIndex: index,
            bytesConsumed,
            code: SerializeErrorCode.encodeFailed,
            cause: error
          }
        )
      }
      checkCollectAbort(collectOptions.signal)
      const validatedChunk = validateSerializeChunk(chunk, {
        type: 'stream',
        phase: SerializePhase.encode,
        context: collectOptions.context,
        chunkIndex: index,
        bytesConsumed
      })
      chunkProgress.push(bytesConsumed)
      if (validatedChunk[0] === SerializeChunkKind.value) {
        throw new SerializeCodecError(SerializeErrorText.collectValue, {
          type: 'stream',
          phase: SerializePhase.encode,
          context: collectOptions.context,
          chunkIndex: index,
          bytesConsumed,
          code: SerializeErrorCode.invalidChunk
        })
      }
      if (validatedChunk[0] === SerializeChunkKind.bytes) {
        sawBytes = true
        bytesConsumed += validatedChunk[1].byteLength
      }
      collected.push(validatedChunk)
      index++
    }
  } catch (error) {
    primaryError = error
  } finally {
    const cleanupError = await closeCollectIterator(iterator, completed)
    if (cleanupError !== undefined) {
      if (primaryError === undefined) primaryError = cleanupError
      else primaryError = attachSerializeCleanupError(primaryError, cleanupError)
    }
  }
  if (primaryError !== undefined) {
    if (isSerializeInvalidChunk(primaryError) || isSerializeInvalidOption(primaryError))
      throw primaryError
    if (primaryError instanceof SerializeCodecError) throw primaryError
    throw new SerializeCodecError(
      `collect stream failed at chunk ${index}: ${streamFailureReason(primaryError)}`,
      {
        type: 'stream',
        phase: SerializePhase.encode,
        context: collectOptions.context,
        chunkIndex: index,
        bytesConsumed,
        code: SerializeErrorCode.encodeFailed,
        cause: primaryError
      }
    )
  }
  if (collected.length === 0) {
    if (collectOptions.empty === 'reject')
      throw createSerializeError(SerializeErrorCode.encodeFailed, SerializeErrorText.collectEmpty, {
        context: collectOptions.context
      })
    return ['text', '']
  }
  if (collected.length === 1) return collected[0]
  if (!sawBytes) {
    // Joining once avoids repeatedly copying the accumulated string for a
    // long stream (which otherwise turns collection into quadratic work).
    return ['text', collected.map((chunk) => chunk[1] as string).join('')]
  }
  // core 无默认 Encoding adapter（R-4）：出现 bytes 需要合并时必须注入 encoder，不直接使用宿主 TextEncoder。
  const enc = capturedEncoder
  if (enc === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      SerializeErrorText.encoderInvalid,
      { context: collectOptions.context }
    )
  }
  const parts = collected.map((chunk, chunkIndex) =>
    chunk[0] === SerializeChunkKind.bytes
      ? chunk[1]
      : encodeSerializeTextChunk(enc, chunk[1] as string, {
          type: 'stream',
          phase: SerializePhase.encode,
          context: collectOptions.context,
          chunkIndex,
          bytesConsumed: chunkProgress[chunkIndex] ?? 0
        })
  )
  let total = 0
  for (const part of parts) total += part.byteLength
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return ['bytes', merged]
}

/** Captures collector options and rejects malformed values before touching the source iterator. */
function snapshotCollectOptions(options: unknown): {
  readonly signal?: ISerializeAbortSignal
  readonly empty: 'text' | 'reject'
  readonly context: string
} {
  try {
    if (options === undefined) return { empty: 'text', context: 'stream' }
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError(SerializeErrorText.collectOptionInvalid)
    const candidate = options as Record<string, unknown>
    const signal = candidate.signal
    const empty = candidate.empty
    const context = candidate.context
    if (empty !== undefined && empty !== 'text' && empty !== 'reject')
      throw new TypeError(SerializeErrorText.collectOptionInvalid)
    if (context !== undefined && typeof context !== 'string')
      throw new TypeError(SerializeErrorText.collectOptionInvalid)
    return {
      signal: signal === undefined ? undefined : snapshotSerializeSignal(signal),
      empty: empty ?? 'text',
      context: context ?? 'stream'
    }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Captures an encoder method once and preserves its receiver across mixed collection. */
function snapshotCollectEncoder(encoder: ITextEncoder | undefined): ITextEncoder | undefined {
  if (encoder === undefined) return undefined
  try {
    if (encoder === null || (typeof encoder !== 'object' && typeof encoder !== 'function'))
      throw new TypeError(SerializeErrorText.encoderInvalid)
    const target = encoder as { readonly encode?: unknown }
    let method: unknown
    method = target.encode
    if (typeof method !== 'function') throw new TypeError(SerializeErrorText.encoderInvalid)
    const receiver = encoder as object
    return {
      encode: (input: string): Uint8Array =>
        invokeCollectEncoderWithReceiver(method as ISerializeInvokable<Uint8Array>, receiver, [
          input
        ])
    }
  } catch (error) {
    return streamOptionFailure(error)
  }
}

/** Resolves exactly one async or sync iterator after option and cancellation admission. */
function getCollectIterator(
  source: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>
): AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> {
  try {
    const candidate = source as {
      readonly [Symbol.asyncIterator]?: () => AsyncIterator<ISerializeChunk>
      readonly [Symbol.iterator]?: () => Iterator<ISerializeChunk>
    }
    const asyncFactory = candidate[Symbol.asyncIterator]
    if (asyncFactory !== undefined) {
      if (typeof asyncFactory !== 'function')
        throw new TypeError(SerializeErrorText.collectOptionInvalid)
      const sourceIterator = invokeCollectEncoderWithReceiver(
        asyncFactory as ISerializeInvokable<AsyncIterator<ISerializeChunk>>,
        candidate as object,
        []
      )
      const next = sourceIterator.next
      const close = sourceIterator.return
      return {
        next: (): Promise<IteratorResult<ISerializeChunk>> =>
          invokeCollectEncoderWithReceiver(
            next as ISerializeInvokable<Promise<IteratorResult<ISerializeChunk>>>,
            sourceIterator as object,
            []
          ),
        return: close
          ? (): Promise<IteratorResult<ISerializeChunk>> =>
              invokeCollectEncoderWithReceiver(
                close as ISerializeInvokable<Promise<IteratorResult<ISerializeChunk>>>,
                sourceIterator as object,
                []
              )
          : undefined
      }
    }
    const syncFactory = candidate[Symbol.iterator]
    if (syncFactory !== undefined) {
      if (typeof syncFactory !== 'function')
        throw new TypeError(SerializeErrorText.collectOptionInvalid)
      const sourceIterator = invokeCollectEncoderWithReceiver(
        syncFactory as ISerializeInvokable<Iterator<ISerializeChunk>>,
        candidate as object,
        []
      )
      const next = sourceIterator.next
      const close = sourceIterator.return
      return {
        next: (): IteratorResult<ISerializeChunk> =>
          invokeCollectEncoderWithReceiver(
            next as ISerializeInvokable<IteratorResult<ISerializeChunk>>,
            sourceIterator as object,
            []
          ),
        return: close
          ? (): IteratorResult<ISerializeChunk> =>
              invokeCollectEncoderWithReceiver(
                close as ISerializeInvokable<IteratorResult<ISerializeChunk>>,
                sourceIterator as object,
                []
              )
          : undefined
      }
    }
    throw new TypeError(SerializeErrorText.collectOptionInvalid)
  } catch (error) {
    if (isSerializeInvalidOption(error)) throw error
    throw new SerializeCodecError(
      `collect stream failed at chunk 0: ${streamFailureReason(error)}`,
      {
        type: 'stream',
        phase: SerializePhase.encode,
        context: 'stream',
        chunkIndex: 0,
        bytesConsumed: 0,
        code: SerializeErrorCode.encodeFailed,
        cause: error
      }
    )
  }
}

/** Checks cooperative cancellation at each collector admission boundary. */
function checkCollectAbort(signal: ISerializeAbortSignal | undefined): void {
  if (signal !== undefined && readSerializeSignalAborted(signal))
    throw createSerializeError(SerializeErrorCode.aborted, 'serialize aborted', {
      cause: readSerializeSignalReason(signal)
    })
}

/** Calls iterator return at most once and reports cleanup failure without replacing primary. */
async function closeCollectIterator(
  iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined,
  completed: boolean
): Promise<unknown> {
  if (iterator === undefined || completed) return undefined
  try {
    const close = iterator.return
    if (typeof close !== 'function') return undefined
    await close()
    return undefined
  } catch (error) {
    return createSerializeError(
      SerializeErrorCode.encodeFailed,
      SerializeErrorText.collectCleanupFailed,
      {
        cause: error
      }
    )
  }
}
