// 反应式内核的公共类型——只放类型，不放实现。谁需要这些类型就从这里 import，不必经过任何具体类/类实例。

import type { IComputedConfig } from '../reactive/computed.class.js'
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.js'

/**
 * Runtime 是本库创建并登记内部面的封闭对象，不是可结构伪造的 SPI。
 *
 * 符号不从公共入口导出；真实权限仍由 internals WeakMap 校验，这个品牌只让类型契约 与运行时事实一致。扩展应组合
 * `createRuntime()`，而不是手写一个缺少内部面的对象。
 */
export const RUNTIME_BRAND: unique symbol = Symbol('store.runtime')

export type IReactiveNodeOptions = {
  debugName?: string
}

/**
 * Public writable node view. Graph bookkeeping stays behind Runtime internals; consumers only
 * receive value/lifecycle operations.
 */
export type ISignal<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly observed: boolean
  value: T
  peek(): T
}

/** Public read-only derived value view. */
export type IComputedValue<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly observed: boolean
  readonly value: T
  peek(): T
}

/** Public, immutable identity for a reactive graph node. */
export type IRuntimeNodeKind = 'observable' | 'observer' | 'computed'

/**
 * Diagnostic callbacks receive this descriptor, never the mutable graph node. `id` remains stable
 * for the node lifetime and correlates trace relationships within one loaded library copy.
 * Aggregators must namespace streams from independently bundled copies.
 */
export type IRuntimeNodeDescriptor = Readonly<{
  id: string
  kind: IRuntimeNodeKind
  debugName?: string
}>

export type IRuntimeTraceEvent =
  | {
      readonly type: typeof ReactiveTraceType.observableChange
      readonly timestamp: number
      readonly observable: IRuntimeNodeDescriptor
      readonly reason: typeof ReactiveTraceReason.set | typeof ReactiveTraceReason.notify
    }
  | {
      readonly type: typeof ReactiveTraceType.dependency
      readonly timestamp: number
      readonly phase: typeof ReactiveTracePhase.connect | typeof ReactiveTracePhase.disconnect
      readonly observable: IRuntimeNodeDescriptor
      readonly observer: IRuntimeNodeDescriptor
      readonly reason?:
        | typeof ReactiveTraceReason.retrack
        | typeof ReactiveTraceReason.invalidate
        | typeof ReactiveTraceReason.dispose
    }
  | {
      readonly type: typeof ReactiveTraceType.observerRun
      readonly timestamp: number
      readonly phase:
        | typeof ReactiveTracePhase.start
        | typeof ReactiveTracePhase.end
        | typeof ReactiveTracePhase.error
      readonly observer: IRuntimeNodeDescriptor
      readonly durationMs?: number
      readonly error?: unknown
    }
  | {
      readonly type: typeof ReactiveTraceType.action
      readonly timestamp: number
      readonly phase:
        | typeof ReactiveTracePhase.start
        | typeof ReactiveTracePhase.end
        | typeof ReactiveTracePhase.error
      readonly name: string
      readonly durationMs?: number
      readonly error?: unknown
    }

/**
 * 运行时消费接口——一套时钟 + 依赖追踪 + 调度器 + 节点工厂。同一 IRuntime 内的节点共享一张依赖图/一条版本时钟， 不同 IRuntime 完全隔离。只有本库 Runtime
 * 实现它；节点/wasm 字段/React 适配层只依赖这个消费面，不碰具体类。 （这里 import type 反引用 Signal/Computed
 * 仅为类型，全部被擦除，不产生任何运行时循环依赖。）
 */
export type IRuntime = {
  readonly [RUNTIME_BRAND]: true
  // clock / tracker / scheduler / notify 已移出公共面：它们能绕过所有权校验、
  // observed 生命周期、trace 与调度原子性。内部面见 runtime/internals.ts，
  // 边界用 WeakMap 而非 private —— 后者编译后照样可访问。
  /** Bump 版本 + 向下游标脏（wasm 字段等自定义 Source 复用同一条通知管线） */
  signal<T>(value: T, options?: IReactiveNodeOptions): ISignal<T>
  computed<T>(fn: () => T, config?: IComputedConfig<T>): IComputedValue<T>
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer
  batch<T>(fn: () => T): T
  untracked<T>(fn: () => T): T
  /** 同步冲刷当前队列。observer 内重入时外层 flush 仍拥有队列，返回 `deferred`； 最外层调用完成并排空队列时返回 `completed`。 */
  flush(): IFlushResult
  /** 受控地替换冲刷策略；只改变何时 flush，不交出 Scheduler 队列本身。 */
  setSchedulerStrategy(strategy: ISchedulerStrategy): void
  /** 只读版本观测；不交出可递增的 VersionClock。 */
  currentVersion(): number
  /** 执行并追踪一段真实 action。调用方只能提供 name 与函数，不能伪造 start/end/error 阶段或任意注入 trace event。 */
  runTracedAction<T>(name: string, fn: () => T): T
  reportError(error: unknown, context: IRuntimeErrorReportContext): void
  /** 诊断面只读：事件只能由受信内核产生，调用方不能伪造 action/依赖记录。 */
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer
}

export type IRuntimeErrorPhase = (typeof ReactiveErrorPhase)[keyof typeof ReactiveErrorPhase]

export type IRuntimeErrorContext = {
  phase: IRuntimeErrorPhase
  observer?: IRuntimeNodeDescriptor
  observable?: IRuntimeNodeDescriptor
}

/**
 * Input accepted by `reportError`. Runtime implementations must snapshot object metadata before
 * invoking public callbacks; raw objects are never forwarded.
 */
export type IRuntimeErrorReportContext = {
  phase: IRuntimeErrorPhase
  observer?: object
  observable?: object
}

/**
 * 运行时宿主能力注入面（`docs/contracts/runtime-neutrality.sdd.md` R-9）。
 *
 * 与 lifecycle 的 `ILifecycleScheduler` 结构兼容但**不 import**：reactive 保持零 workspace 依赖。 `now()` 是单调
 * duration 时钟；`timestamp()` 是事件时间戳（允许 epoch）；二者不得混用。默认值见 `default-runtime-adapter.ts`。
 */
export type IReactiveRuntimeAdapter = {
  /** 调度一次微任务。 */
  scheduleMicrotask(task: () => void): void
  /** 单调时间，用于 duration。 */
  now(): number
  /** 事件时间戳，可与 duration 分离。 */
  timestamp(): number
  /** 默认错误出口。 */
  reportError(error: unknown, context: IRuntimeErrorContext): void
}

export type IRuntimeOptions = {
  /** 宿主能力注入面；缺省项回落到 `defaultRuntimeAdapter`。 */
  adapter?: Partial<IReactiveRuntimeAdapter>
  onError?: (error: unknown, context: IRuntimeErrorContext) => void
  onTrace?: (event: IRuntimeTraceEvent) => void
  /**
   * 一次冲刷里单个 observer 允许的最大执行次数，默认 100。单个 observer 超限视为自触发环：抛错并清空队列。
   *
   * 可配置，因为它是策略参数而非物理常数——很长的派生链每轮只推进一级也会吃轮次。
   */
  maxFlushPasses?: number
  /**
   * 无观察者 Computed 的挂起时机，默认走 adapter 的 `scheduleMicrotask`。
   *
   * 与调度策略分开：挂起是回收，不是冲刷。写死之后这条路径不受任何配置控制， rAF/idle 策略下时机对不上，测试也只能靠等微任务。
   */
  scheduleIdle?: (task: () => void) => void
}

/**
 * 内核内部图协议。它刻意不从 `@migaia/reactive` 公共入口导出。
 *
 * 第三方扩展应组合公开 Signal，而不是手工实现并修改 subs/version；平台内置的 Wasm/SAB 来源通过受约束的内部入口接图，并必须先登记 Runtime 所有权。
 */
export type IObservable = {
  readonly runtime: IRuntime
  debugName?: string
  /** Reverse edges are maintained by the Runtime tracker, not extension code. */
  readonly subs: ReadonlySet<IObserver>
  readonly version: number
  pull?(): void // 惰性节点（如 Computed）在被读取前先落定版本；纯数据节点（如 Signal）不需要
  // 纯同步状态检查：不得求值、修改依赖图或抛出用户计算错误。
  isStale?(): boolean
  onObserved?(): void // 第一个下游订阅建立
  onUnobserved?(): void // 最后一个下游订阅离开
}

/** 一个会去读取 IObservable、需要在其变化时收到通知的一端——Computed/Effect 都实现它。 */
export type IObserver = {
  readonly runtime: IRuntime
  readonly disposed: boolean
  debugName?: string
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>
  markDirty(): void
  onDependencyDisconnected(observable: IObservable): void
}

/** Effect/自定义响应式来源的收尾回调——对应它们建立时留下的、需要在重跑或销毁前撤销的副作用 （取消订阅、清定时器、释放资源……），命名对应 Effect 已有的 dispose() 语义。 */
export type IDisposer = () => void

/**
 * 有明确所有权/生命周期的资源：能被显式释放，且可查询是否已释放。 Computed/Effect/Scope（以及未来的 wasm 字段、worker 订阅）都实现它，交给 Scope 统一按
 * LIFO 释放。
 */
export type IDisposable = {
  dispose(): void
  readonly disposed: boolean
}

/** 冲刷触发策略——决定"待处理的响应式副作用什么时候真正执行"。默认是微任务合并， 可换成 rAF/idle/优先级队列等；Scheduler 类持有一个策略实例，而不是自己是策略。 */
export type ISchedulerStrategy = (flush: () => void) => void

/** 显式 flush 的完成状态；判别字符串避免 boolean truthiness 隐藏重入语义。 */
export type IFlushResult = 'completed' | 'deferred'

/**
 * 冲刷队列里一项的最小形状：只要求"一次冲刷时如何处理我"。Effect 是目前唯一的实现者， 但这里刻意不直接引用 Effect 类——如果引用了，Scheduler 所在文件就要 import
 * Effect， Effect 所在文件又要 import Scheduler，形成循环依赖。用结构类型断开这个环。
 */
export type IFlushable = {
  tick(): void
  /** 环保护触发时要如实报出被丢弃的待办，靠这个名字定位。 */
  readonly debugName?: string
}
