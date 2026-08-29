/**
 * Runtime-neutral scheduler contract + lifecycle 默认实现（`docs/contracts/runtime-neutrality.sdd.md`
 * R-9）。
 *
 * 两层设计： - 核心契约层
 * `ILifecycleScheduler`：核心算法包（serialize/core、reactive、capability、resource）只依赖这个接口，不直接使用宿主 API。 -
 * 默认实现层 `systemScheduler`：lifecycle 直接实现，统一 `performance.now()` + `setTimeout`/`clearTimeout`。
 *
 * `lib: ["ES2024"]` 不声明 `performance`/`setTimeout`/`clearTimeout`，故用内部结构化 host-global 类型经
 * `globalThis` 访问，不 import DOM/Node，也不把这些宿主类型暴露到公共接口。
 */
import {
  createLifecycleError,
  createLifecycleRangeError,
  createLifecycleTypeError
} from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'

/** Canonical runtime check for scheduler-produced and scheduler-consumed numeric values. */
export function validateSchedulerTime(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerNumberType,
      {
        detail: { field: label }
      }
    )
  }
  if (!Number.isFinite(value)) {
    throw createLifecycleRangeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerNumberRange,
      {
        detail: { field: label }
      }
    )
  }
  return value
}

/** Canonical runtime check for finite, non-negative scheduler delays. */
export function validateSchedulerDelay(value: unknown, label = 'delayMs'): number {
  const number = validateSchedulerTime(value, label)
  if (number < 0) {
    throw createLifecycleRangeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerDelayRange,
      {
        detail: { field: label }
      }
    )
  }
  return number
}

/** Rejects a scheduler time target when finite operands overflow during addition. */
export function addSchedulerTime(base: number, delta: number, label: string): number {
  /** Candidate absolute scheduler time produced by adding the validated increment. */
  const target = base + delta
  if (!Number.isFinite(target)) {
    throw createLifecycleRangeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTimeOverflow,
      {
        detail: { field: label, base, delta }
      }
    )
  }
  return target
}

/** Manual scheduler 单次 advance 的最大 flush 任务数（runaway guard）。 */
const MAX_ADVANCE_FLUSH = 10_000

/** 一个已排程任务的可取消句柄。`cancel()` 幂等；cancel 后回调不再执行。 */
export type IScheduledTask = { cancel(): void }

/** Runtime-neutral 调度器契约：单调时钟 + 有界延迟排程。 */
export type ILifecycleScheduler = {
  /** 单调不递减毫秒（连续两次可相等）；只比较差值，不解释为 Unix epoch。 */
  now(): number
  /** 排程一个回调；`delayMs` 有限、非负；回调至多执行一次。 */
  schedule(callback: () => void, delayMs: number): IScheduledTask
}

/** Captured scheduler contract with stable methods and receiver. */
export type ISchedulerSnapshot = ILifecycleScheduler

/** Read one scheduled task's cancel accessor once while preserving its original receiver. */
function snapshotScheduledTask(value: unknown): IScheduledTask {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskInvalid
    )
  }
  let cancel: unknown
  try {
    cancel = (value as { cancel?: unknown }).cancel
  } catch (error) {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskCancelGetterFailed,
      { cause: error }
    )
  }
  if (typeof cancel !== 'function') {
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerTaskInvalid
    )
  }
  const receiver = value
  return {
    cancel: () => Reflect.apply(cancel as () => void, receiver, [])
  }
}

/** Read scheduler accessors once while preserving their original receiver. */
export function snapshotScheduler(value: unknown): ISchedulerSnapshot | undefined {
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
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerAccessorFailed,
      { cause: error }
    )
  }
  if (typeof now !== 'function' || typeof schedule !== 'function') return undefined
  return {
    now: () => validateSchedulerTime(Reflect.apply(now, receiver, []), 'now()'),
    schedule: (callback, delayMs) => {
      const validDelay = validateSchedulerDelay(delayMs)
      return snapshotScheduledTask(Reflect.apply(schedule, receiver, [callback, validDelay]))
    }
  }
}

/**
 * Reads one public scheduler option and snapshots its scheduler methods before a lifecycle object
 * is created. A getter failure is an invalid-option boundary failure; the native `TypeError`
 * preserves the exact thrown value through `cause` and prevents scheduler work from starting.
 */
export function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback: ISchedulerSnapshot
): ISchedulerSnapshot

/** Reads one optional public scheduler option without inventing a default scheduler. */
export function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined
): ISchedulerSnapshot | undefined

export function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback?: ISchedulerSnapshot
): ISchedulerSnapshot | undefined {
  /** The single scheduler option value admitted from the caller-owned options object. */
  let schedulerOption: unknown
  try {
    schedulerOption = options?.scheduler
  } catch (error) {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerAccessorFailed,
      { cause: error, detail: { field: 'scheduler' } }
    )
  }
  if (schedulerOption === undefined) return fallback
  return resolveScheduler(schedulerOption)
}

/** Resolve an injected scheduler at its factory boundary, retaining lifecycle error identity. */
export function resolveScheduler(value: unknown): ISchedulerSnapshot {
  const snapshot = snapshotScheduler(value)
  if (snapshot === undefined) {
    throw createLifecycleError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.schedulerInvalid
    )
  }
  return snapshot
}

/** Lifecycle 内部使用的宿主全局最小形状；不导出到公共接口。 */
type ILifecycleHostGlobals = {
  readonly performance?: { readonly now: () => number }
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout?: (handle: unknown) => void
}

/** 经 `globalThis` 结构化断言访问宿主能力，不 import DOM/Node 类型。 */
const host = globalThis as unknown as ILifecycleHostGlobals

/**
 * Lifecycle 提供的默认调度器：统一 `performance.now()`（单调）做时钟、`setTimeout`/`clearTimeout` 做排程。
 *
 * 纯常量对象，无全局 setter、无可变 singleton；模块加载零副作用，只有 `schedule()` 才创建 timer。能力检测在首次调用 `now()`/`schedule()`
 * 时惰性 fail-fast：宿主能力缺失抛 `ENV_UNSUPPORTED`，不静默退化。
 */
export const systemScheduler: ILifecycleScheduler = {
  now() {
    const perf = host.performance
    if (perf === undefined || perf.now === undefined) {
      throw createLifecycleError(
        LifecycleErrorCode.envUnsupported,
        'performance.now is unavailable'
      )
    }
    return validateSchedulerTime(perf.now(), 'performance.now()')
  },
  schedule(callback, delayMs) {
    const validDelay = validateSchedulerDelay(delayMs)
    const set = host.setTimeout
    const clear = host.clearTimeout
    if (set === undefined || clear === undefined) {
      throw createLifecycleError(
        LifecycleErrorCode.envUnsupported,
        'setTimeout/clearTimeout is unavailable'
      )
    }
    let cancelled = false
    let remaining = validDelay
    let handle: unknown
    // Host timers commonly clamp values above the signed 32-bit range to ~1ms. Segment long
    // delays so lifecycle deadlines retain the same semantics in Node and browsers.
    const arm = (): void => {
      if (cancelled) return
      const segment = Math.min(remaining, 2_147_000_000)
      remaining -= segment
      handle = set(() => {
        if (remaining > 0) arm()
        else callback()
      }, segment)
    }
    arm()
    return {
      cancel() {
        if (cancelled) return
        cancelled = true
        clear(handle)
      }
    }
  }
}

/** 手动时钟调度器：测试唯一替代实现，`advance(ms)` 推进虚拟时间并同步 flush 到期回调。非生产 API。 */
export type IManualScheduler = ILifecycleScheduler & {
  advance(ms: number): void
}

/**
 * 创建手动时钟调度器（测试/benchmark 专用，不依赖真实时间）。
 *
 * `now()` 返回虚拟时钟；`schedule()` 只登记不触发；`advance(ms)` 把虚拟时间推进 `ms` 并同步执行所有到期回调（按到期时刻升序，同时刻按登记顺序）。
 */
export function createManualScheduler(): IManualScheduler {
  let nowMs = 0
  let nextId = 0
  type IManualTask = {
    readonly callback: () => void
    readonly at: number
    readonly id: number
    index: number
  }
  const tasks: IManualTask[] = []
  const swap = (left: number, right: number): void => {
    const task = tasks[left]!
    tasks[left] = tasks[right]!
    tasks[right] = task
    tasks[left]!.index = left
    tasks[right]!.index = right
  }
  const before = (left: IManualTask, right: IManualTask): boolean =>
    left.at < right.at || (left.at === right.at && left.id < right.id)
  const siftUp = (index: number): void => {
    let current = index
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (!before(tasks[current]!, tasks[parent]!)) break
      swap(current, parent)
      current = parent
    }
  }
  const siftDown = (index: number): void => {
    let current = index
    while (true) {
      const left = current * 2 + 1
      const right = left + 1
      let smallest = current
      if (left < tasks.length && before(tasks[left]!, tasks[smallest]!)) smallest = left
      if (right < tasks.length && before(tasks[right]!, tasks[smallest]!)) smallest = right
      if (smallest === current) return
      swap(current, smallest)
      current = smallest
    }
  }
  const remove = (task: IManualTask): void => {
    const index = task.index
    if (index < 0 || index >= tasks.length || tasks[index] !== task) return
    const last = tasks.pop()
    if (last !== undefined && last !== task) {
      tasks[index] = last
      last.index = index
      siftDown(index)
      siftUp(index)
    }
    task.index = -1
  }
  return {
    now: () => nowMs,
    schedule(callback, delayMs) {
      const validDelay = validateSchedulerDelay(delayMs)
      const dueAt = addSchedulerTime(nowMs, validDelay, 'schedule dueAt')
      const task: IManualTask = { callback, at: dueAt, id: nextId++, index: tasks.length }
      tasks.push(task)
      siftUp(task.index)
      return {
        cancel() {
          remove(task)
        }
      }
    },
    advance(ms) {
      const validAdvance = validateSchedulerDelay(ms, 'advance')
      const target = addSchedulerTime(nowMs, validAdvance, 'advance target')
      // 循环取下一个到期任务（按到期时刻升序、同刻按登记顺序），直到当前时间点无 due：到期 callback
      // 新排的 delayMs=0 任务也在本次 advance 内 flush（AF-21）。runaway guard 防止自排程挂死测试。
      let runs = 0
      while (true) {
        const task = tasks[0]
        if (task === undefined || task.at > target) break
        if (++runs > MAX_ADVANCE_FLUSH) {
          throw createLifecycleError(
            LifecycleErrorCode.invalidOption,
            `[lifecycle] manual scheduler advance exceeded the ${MAX_ADVANCE_FLUSH}-task flush guard`
          )
        }
        remove(task)
        nowMs = task.at
        task.callback()
      }
      nowMs = target
    }
  }
}
