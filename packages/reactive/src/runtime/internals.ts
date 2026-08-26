import type { DependencyTracker } from './dependency-tracker.class.js'
import type { Scheduler } from './scheduler.class.js'
import type { VersionClock } from './version-clock.class.js'
import type { IObservable, IRuntime, IRuntimeTraceEvent } from './types.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { noteRuntimeCopy } from './copy-check.js'
import { ReactiveErrorText } from '../error-text.js'

/**
 * 内核内部面。
 *
 * 公共 `IRuntime` 曾经直接挂着 tracker / scheduler / clock / notify，于是任何拿到 runtime
 * 的第三方增强都能绕过：所有权校验、observed/unobserved 生命周期、trace、 双向断边、调度原子性——这些恰恰是本库正确性的全部来源。
 *
 * 边界用 WeakMap 而不是 `private` 或 `unique symbol`：前者只是类型层约定，编译后 属性照样可枚举可访问；后者也只要拿到那个 symbol 就能读。WeakMap
 * 的键在模块外 拿不到，才是运行时真实的封装。
 *
 * 谁能 import 这个模块由 `architecture.test.ts` 约束：只有内核自身与被明确授权的 高级入口，普通增强层一律不行。
 */
export type IRuntimeInternals = {
  readonly clock: VersionClock
  readonly tracker: DependencyTracker
  readonly scheduler: Scheduler
  /** 单调 duration 时钟（adapter.now）。 */
  now(): number
  /** 事件时间戳（adapter.timestamp），用于 trace。 */
  timestamp(): number
  /** 诊断写通道留在内部面，外部只能订阅，不能伪造 action/依赖事件。 */
  traceEnabled(): boolean
  emitTrace(event: IRuntimeTraceEvent): void
  /** Bump 版本 + 向下游标脏（wasm 字段等自定义 Source 复用同一条通知管线）。 */
  notify(source: IObservable): void
  /** Reserve a version, perform a source write, then publish exactly once. */
  commitSource<T>(source: IObservable, write: () => T): T
  /**
   * 「稍后回收」的时机通道：无观察者的 Computed 靠它排挂起。
   *
   * 与 flush 时机刻意分开。挂起不是冲刷：同步 flush 策略是完全合法的测试配置， 若两者共用一条通道，一次读完就立刻断掉上游边，同 tick 内的第二次读会白算。 但它也不该是写死的
   * `queueMicrotask`——那样 `IRuntimeOptions` 就管不到它。
   */
  deferIdle(task: () => void): void
}

const INTERNALS = new WeakMap<object, IRuntimeInternals>()

/** Runtime 构造时自报内部面。重复登记视为编程错误，直接拒绝。 */
export function registerInternals(runtime: IRuntime, internals: IRuntimeInternals): void {
  if (INTERNALS.has(runtime)) {
    throw createReactiveError(
      ReactiveErrorCode.internalsRegistered,
      ReactiveErrorText.internalsAlreadyRegistered
    )
  }
  INTERNALS.set(runtime, internals)
}

/**
 * 取内部面。
 *
 * 拿不到就是硬错误而非返回 undefined：一个没登记内部面的对象冒充 Runtime 时， 后续每一步都会以难以追溯的方式出错，不如在入口就断掉。
 */
export function internalsOf(runtime: IRuntime): IRuntimeInternals {
  const internals = INTERNALS.get(runtime)
  if (internals) return internals
  // 双实例自检（copy-check.ts）：读取内部面也是正确性边界，登记本副本。
  noteRuntimeCopy()
  throw createReactiveError(
    ReactiveErrorCode.notRuntimeOwned,
    ReactiveErrorText.runtimeNotCreatedByFactory
  )
}

/** 是否是本库创建的 Runtime。所有权校验用，不泄漏内部面本身。 */
export const isRuntime = (candidate: unknown): candidate is IRuntime =>
  typeof candidate === 'object' && candidate !== null && INTERNALS.has(candidate)
