# 使用手册

本文是 `@migaia/reactive` 的完整参考手册。先看 [README.md](./README.md#5-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个 API、每一个配置项、每一种边界行为"。

## 目录

1. [核心模型](#1-核心模型)
2. [Signal 完整参考](#2-signal-完整参考)
3. [Computed 完整参考](#3-computed-完整参考)
4. [Effect 完整参考](#4-effect-完整参考)
5. [Runtime 完整参考](#5-runtime-完整参考)
6. [Scope：集中释放资源](#6-scope集中释放资源)
7. [调度、批处理与 flush 精确语义](#7-调度批处理与-flush-精确语义)
8. [错误处理](#8-错误处理)
9. [诊断与 trace](#9-诊断与-trace)
10. [跨 Runtime 边界与所有权](#10-跨-runtime-边界与所有权)
11. [扩展 API：面向 Store/框架适配层作者](#11-扩展-api面向-store框架适配层作者)
12. [更贴近生产的完整示例](#12-更贴近生产的完整示例)
13. [常见问题排查](#13-常见问题排查)

---

## 1. 核心模型

README 的五分钟示例已经展示了 `Signal`/`Computed`/`Effect`/`Runtime` 怎么拼在一起跑起来，这里只讲背后的运行模型，不重复那个示例。

**push + pull 两段式**是理解这个内核的关键：

- **push（标脏）**：`Signal.value = x` 或上游依赖变化时，只是把下游 `Computed`/`Effect` 标记为"可能过期"（`markDirty()`），并不立即重算。
- **pull（惰性求值）**：`Computed.value`/`peek()` 被读取时才真正判断是否需要重算（依赖版本号是否变化）；没人读取的 `Computed` 永远不会白算。
- `Effect` 是图里**唯一真正会被调度器"跑"的对象**——`Computed` 只标脏、只在被读时重算，不会自己主动执行。

**惰性求值 + 自动挂起**：一个 `Computed` 在失去最后一个订阅者后（没有 `Effect` 或其它 `Computed` 依赖它），会在下一个空闲时机（默认 `queueMicrotask`）自动挂起——断开对上游的依赖、下次被读取时重新从头计算。这意味着"临时读一下某个 Computed 但不订阅"不会造成长期持有失效的缓存。需要"即使暂时没人订阅也保持热态、不重新计算"的场景，用 `{ keepAlive: true }`。

---

## 2. Signal 完整参考

```ts
class Signal<T> {
  constructor(v: T, runtime: IRuntime, options?: { debugName?: string });
  value: T; // get 建立依赖并追踪；set 写入并（异步地）通知下游
  peek(): T; // 读取但不建立依赖
  readonly version: number; // 单调递增，值真的变化时才推进
  readonly observed: boolean; // 是否至少有一个订阅者
  readonly disposed: boolean;
  readonly subs: ReadonlySet<IObserver>; // 只读订阅者集合，仅供诊断/自定义扩展查看
  readonly runtime: IRuntime;
  debugName?: string;
  dispose(): void;
  addObservedHooks(hooks: { onObserved?(): void; onUnobserved?(): void }): () => void;
}
```

| 成员 | 参数类型 | 同步/异步 | 行为 |
| --- | --- | --- | --- |
| `new Signal(v, runtime, options?)` | `v: T`；`runtime: IRuntime`；`options?: { debugName?: string }` | 同步 | 参数顺序是**值在前、`runtime` 在后**。`options.debugName` 用于诊断事件/错误信息里标识节点。 |
| `get value` | 无参数（读取属性） | 同步 | 在有活跃追踪帧（正处在某个 `Computed`/`Effect` 求值中）时建立依赖边；已释放时抛 `[store] cannot use a disposed signal`。 |
| `set value` | `value: T` | 同步 | 用 `Object.is` 做相等短路——写入相同值**不会**推进 `version`、不会通知任何订阅者。真正变化时：先领取新版本号，再写值，最后（异步地，见下）通知订阅者标脏。 |
| `peek()` | 无参数 | 同步 | 读取当前值，**不建立依赖**——适合在 `Effect`/`Computed` 内"只读一次、不订阅"的场景。已释放同样抛错。 |
| `dispose()` | 无参数 | 同步 | 幂等；标记 `disposed = true` 并断开全部下游订阅边。释放后的任何 `value`/`peek()` 读取都会抛错，不会返回旧值。 |
| `addObservedHooks({ onObserved, onUnobserved })` | `hooks: { onObserved?(): void; onUnobserved?(): void }` | 同步 | 注册"第一个订阅者出现/最后一个订阅者离开"的回调，返回取消订阅函数。多个 hook 可以叠加；某个 hook 抛错不会影响其它 hook 执行，全部执行完后如果有异常会重新抛出（多个异常合并成 `AggregateError`）。 |

`Signal` 没有自定义相等比较的配置项——固定用 `Object.is`。需要更复杂的相等语义（比如浅比较对象），应该在写入前自己判断要不要赋值，或者在其上包一层 `Computed`。

写入的通知不是同步发生在 `set value` 内部：新版本号和新值是同步落定的，但"通知下游 `markDirty()`"这一步被包在 `runDeferred` 里——目的是让"一次写入触发的所有下游标脏"作为一个整体先完成，再决定是否需要触发调度，避免同步 scheduler 策略下标脏过程中又有新的追踪把 `subs` 集合改动导致遍历出错。对调用方来说这只是实现细节，可观察的行为仍然是：写入后，`Effect` 会在下一次冲刷（微任务，或调用了 `flush()`）时看到变化。

---

## 3. Computed 完整参考

```ts
type IComputedOptions<T> = { equals?: (a: T, b: T) => boolean; keepAlive?: boolean; debugName?: string };
type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean);

class Computed<T> {
  constructor(fn: () => T, runtime: IRuntime, config?: IComputedConfig<T>);
  readonly value: T; // 建立依赖 + 惰性重算
  peek(): T; // 惰性重算，不建立依赖
  preview(): T; // 见下方"投机求值"
  readonly version: number;
  readonly observed: boolean;
  readonly disposed: boolean;
  isStale(): boolean; // 当前是否处于"标脏待重算"状态，纯同步查询，不触发求值
  dispose(): void;
}
```

| 成员 | 参数类型 | 同步/异步 | 行为 |
| --- | --- | --- | --- |
| `new Computed(fn, runtime, config?)` | `fn: () => T`；`runtime: IRuntime`；`config?: IComputedConfig<T>` | 同步 | `config` 可以直接传一个 `(a, b) => boolean` 函数（等价于只设置 `equals`），也可以传完整的选项对象。 |
| `config.equals` | `(a: T, b: T) => boolean`（构造参数字段，非独立可调用成员） | — | 自定义"重算结果是否算变化"的比较函数，默认 `Object.is`。结果没变则**不推进 `version`**，下游因此也不会认为它变了——即使 `fn` 本身被重新执行过。 |
| `config.keepAlive` | `boolean`（构造参数字段，非独立可调用成员） | — | 默认 `false`。为 `true` 时，即使暂时没有任何订阅者也不会被自动挂起（依赖边持续保持），适合"每次都要花很久重算、宁可持续占用一点内存也不要频繁失效重建"的场景。 |
| `get value` | 无参数（读取属性） | 同步 | 建立依赖边（供上层 `Computed`/`Effect` 追踪），并调用内部 `pull()` 完成惰性重算判定。 |
| `peek()` | 无参数 | 同步 | 同样会触发惰性重算（保证读到的是最新值），但不建立依赖边。 |
| `dispose()` | 无参数 | 同步 | 幂等；断开对全部上游的依赖 + 清空下游订阅。释放后的 `value`/`peek()`/`preview()` 一律抛 `[store] cannot read a disposed computed`。 |
| 循环依赖（错误行为，非独立成员） | — | — | 求值过程中又读到了自己（直接或经过其它 `Computed` 间接形成环）会抛 `[store] circular computed dependency detected`，不会栈溢出。 |

**投机求值 `preview()`**：为支持"可能被丢弃的渲染"（例如某些 UI 框架的并发渲染）设计——`preview()` 计算一次结果但**不提交缓存、不建立依赖边**。如果紧接着这次求值被真正提交（比如后续 `pull()` 命中同一版本号且依赖没变），内部会直接复用这次投机求值的结果，不会对同一版本重复调用 `fn` 两次。普通业务代码通常不需要直接调用它，它是给第 11 节的绑定原语用的。

**自动挂起细节**：`Computed` 失去最后一个订阅者后，不是立刻挂起，而是登记一个"空闲时检查"（默认 `queueMicrotask`，可通过 `IRuntimeOptions.scheduleIdle` 配置）；如果在这之前又重新被订阅，挂起会被取消。真正挂起时会清空依赖边并标记为脏，下次读取时从头重新计算。`keepAlive: true` 完全跳过这套机制。

---

## 4. Effect 完整参考

```ts
class Effect {
  constructor(fn: () => void | (() => void), runtime: IRuntime, options?: { debugName?: string });
  readonly disposed: boolean;
  readonly deps: ReadonlySet<IObservable>;
  run(): void; // 立即强制重跑一次（构造时已自动调用一次）
  dispose(): void;
}
```

| 成员 | 参数类型 | 同步/异步 | 行为 |
| --- | --- | --- | --- |
| `new Effect(fn, runtime, options?)` | `fn: () => void \| (() => void)`；`runtime: IRuntime`；`options?: { debugName?: string }` | 同步 | **构造时会同步执行一次 `fn`**，不是等第一次依赖变化才跑。 |
| `fn` 的返回值（构造参数 `fn` 的返回值说明，非独立可调用成员） | — | — | 可以返回一个清理函数（`() => void`）。清理函数会在**下一次重跑之前**（先清理、再执行新的 `fn`）以及 **`dispose()` 时**被调用，且调用时处于 `untracked` 状态（不会给清理逻辑本身建立依赖）。 |
| 重跑触发（内部调度行为，非独立可调用成员） | — | — | `fn` 内读取到的 `Signal`/`Computed` 变化后，`Effect` 被加入调度队列；下一次 `flush()`（自动或手动）时，只有在依赖**真的变了**（版本号不同）才会真正重跑，仅仅"被标脏"但值没变不会重跑。 |
| `run()` | 无参数 | 同步 | 手动强制立即重跑（不检查是否真的有依赖变化），常用于测试或需要"现在立刻同步跑一次"的场景。 |
| `dispose()` | 无参数 | 同步 | 幂等；断开全部依赖、执行最后一次清理回调、从调度队列移除。 |

**清理时序的坑**：重跑逻辑是"先摘掉旧清理回调引用，再执行清理，再跑新的 `fn`"——这个顺序是为了保证：如果新的 `fn` 抛错，不会因为清理回调引用还留着旧值，导致下次重跑/`dispose()` 时重复执行同一个清理逻辑（重复 `removeEventListener`、重复释放、引用计数变负）。

**依赖断开时的强制重跑**：如果 `Effect` 依赖的某个上游节点被 `dispose()`（不是普通的值变化，是节点本身被释放），`Effect` 会被强制标记为下次冲刷时必须重跑（`onDependencyDisconnected`），而不是走"版本号比较"的路径——因为已释放节点的版本号语义已经不再有意义。

---

## 5. Runtime 完整参考

```ts
function createRuntime(options?: IRuntimeOptions): Runtime;

type IRuntimeOptions = {
  onError?: (error: unknown, context: IRuntimeErrorContext) => void;
  onTrace?: (event: IRuntimeTraceEvent) => void;
  maxFlushPasses?: number; // 默认 100
  scheduleIdle?: (task: () => void) => void; // 默认 queueMicrotask
};
```

| Runtime 方法 | 签名 | 同步/异步 | 作用 |
| --- | --- | --- | --- |
| `signal(value, options?)` | `<T>(value: T, options?) => Signal<T>` | 同步 | 等价于 `new Signal(value, runtime, options)`。 |
| `computed(fn, config?)` | `<T>(fn: () => T, config?) => Computed<T>` | 同步 | 等价于 `new Computed(fn, runtime, config)`。 |
| `effect(fn, options?)` | `(fn, options?) => IDisposer` | 同步 | 等价于 `new Effect(fn, runtime, options)`，但**只返回一个 `() => void` 的 dispose 函数**，不返回 `Effect` 实例本身——拿不到 `run()`、`deps` 等成员。需要完整实例时用 `new Effect(...)`。 |
| `batch(fn)` | `<T>(fn: () => T) => T` | 同步 | 见 [§7](#7-调度批处理与-flush-精确语义)。 |
| `untracked(fn)` | `<T>(fn: () => T) => T` | 同步 | 在 `fn` 执行期间关闭依赖收集——`fn` 内读取任何 `Signal`/`Computed` 都不会给当前正在求值的 `Computed`/`Effect` 建立依赖边。 |
| `createScope()` | `() => Scope` | 同步 | 见 [§6](#6-scope集中释放资源)。 |
| `flush()` | `() => 'completed' \| 'deferred'` | 同步 | 同步冲刷当前待处理队列。在另一次 `flush()` 内部重入调用会返回 `'deferred'`（外层的 `while` 循环仍会处理新加入的项）；正常情况下排空队列后返回 `'completed'`。 |
| `setSchedulerStrategy(strategy)` | `(flush: () => void) => void` | 同步 | 替换"什么时候真正执行冲刷"的策略。默认是 `(flush) => queueMicrotask(flush)`；可以换成 `requestAnimationFrame`、`requestIdleCallback`、优先级队列或任意自定义调度。只影响**触发时机**，不改变冲刷本身的执行逻辑。 |
| `currentVersion()` | `() => number` | 同步 | 只读查看当前版本时钟位置，不消耗版本号。 |
| `runTracedAction(name, fn)` | `<T>(name: string, fn: () => T) => T` | 同步 | 在有 trace 监听时，包一层 `action` 类型的 start/end/error 事件；没有监听时直接执行 `fn`，零开销。`name` 必须是非空字符串，否则抛 `TypeError`。 |
| `reportError(error, context)` | `(error, { phase, observer?, observable? }) => void` | 同步 | 手动上报一个错误到 `onError` 通道，用途见 [§8](#8-错误处理)。 |
| `subscribeTrace(listener)` | `(listener) => IDisposer` | 同步 | 订阅 trace 事件流，见 [§9](#9-诊断与-trace)。 |

**`defaultRuntime`**：`export const defaultRuntime = createRuntime()`，模块加载时不会自动创建（它单独放在 `./runtime/default-runtime` 子模块，只有真正 `import { defaultRuntime }` 才会触发构造），但一旦被 import 就是**进程级共享单例**。适合"图省事、单进程单实例"的脚本/工具场景；SSR（每请求需要独立状态）、单元测试（互不污染）、多 Worker/多 React root 场景都应该显式调用 `createRuntime()`。

---

## 6. Scope：集中释放资源

```ts
const scope = runtime.createScope();
const a = scope.own(new Signal(1, runtime));
const b = scope.own(new Computed(() => a.value * 2, runtime));

scope.release(a); // 解除登记但不释放——比如 a 已经被单独 dispose 了
scope.dispose(); // 按登记的逆序（后进先出）依次调用剩余资源的 dispose()
```

| 成员 | 参数类型 | 同步/异步 | 行为 |
| --- | --- | --- | --- |
| `own(resource)` | `resource: IDisposable` | 同步 | 登记一个 `IDisposable`（`Signal`/`Computed`/`Effect`/其它 `Scope` 都满足）；`Scope` 已经 `disposed` 时调用会抛 `[store] cannot add resource to a disposed scope`。 |
| `release(resource)` | `resource: IDisposable` | 同步 | 从登记表移除但**不触发**该资源的 `dispose()`——用于"这个资源已经被单独释放，避免 `Scope` 之后重复释放"的场景，返回是否真的移除了。 |
| `dispose()` | 无参数 | 同步 | 同步、按登记顺序的**逆序**依次释放；某个资源的 `dispose()` 抛错不会中断其它资源的释放，全部完成后如果收集到异常会统一抛出（多个异常合并成 `AggregateError`）。幂等——重复调用是 no-op。 |
| `disposeAsync()` | 无参数 | 异步 | 异步版本：逐个等待（如果资源实现了 `disposeAsync`则优先调用它，否则退化为 `dispose()`）。并发调用 `dispose()`/`disposeAsync()` 会被拦截并报错（避免同一批资源被释放两次），必须等第一次调用完成。 |
| `disposed` | 无参数（只读属性） | 同步 | 只读；进入终态后为 `true`。 |

`Scope` 不会自动持有你创建的节点——`new Signal(...)` 不会自动挂进任何 `Scope`，必须显式 `scope.own(...)`。这是有意的：`Scope` 是"资源所有权工具"，不是节点注册表。

---

## 7. 调度、批处理与 flush 精确语义

**默认调度策略**是微任务合并：`Signal` 写入 → 下游标脏 → 如果不在批处理中，立即调用 `scheduler.requestFlush()` 申请一次 `queueMicrotask` 冲刷；同一个微任务里多次写入只会触发一次真正的冲刷。

**`batch(fn)`**：把 `fn` 内的多次写入合并到一次冲刷。嵌套 `batch()` 只有最外层退出时才真正冲刷。如果 `fn` 本身抛错，`batch()` 优先抛出 `fn` 的错误；如果冲刷阶段又额外抛错，第二个错误会被挂到第一个错误的 `error.cause` 上（非 `Error` 类型的抛出值则包成 `{ cause: { action, flush } }` 的新 `Error`），保证业务错误不会被冲刷阶段的错误覆盖掉。

```ts
runtime.batch(() => {
  a.value = 1;
  b.value = 2; // a、b 的下游只会在这里统一冲刷一次，而不是两次
});
```

**`flush()`**：手动立即同步冲刷当前队列，常用于测试（不想等微任务）或需要"确定副作用已经跑完"的场景。冲刷期间重入（比如某个 `Effect` 内又调用了 `runtime.flush()`）返回 `'deferred'`——外层调用仍会继续处理新加入队列的项，只是这次内层调用无法保证"返回时待办已跑完"。

**失控保护**：一次冲刷内部是"取出全部待处理项 → 逐个 `tick()` → 如果又有新的加入，再来一轮"的循环。超过 `maxFlushPasses`（默认 100）轮仍未收敛，判定为自触发环（典型例子：`Effect` 内同步写了它自己读取的 `Signal`），此时会清空队列、抛出错误，错误信息包含被丢弃的待办数量和（最多 8 个）它们的 `debugName`。这个上限可以通过 `createRuntime({ maxFlushPasses: n })` 调整——它是策略参数（"一次冲刷允许几轮传播"），不是物理常量；很长的派生链每轮只推进一级也会消耗轮次。

**`untracked(fn)`**：在 `fn` 执行期间暂停依赖收集。典型用途：`Effect` 内需要读取某个 `Signal` 但不想让它成为依赖（用 `.peek()` 更直接）、清理回调内部的读取（内核自动这么做）、诊断/trace 监听器内部的读取（同样自动处理，避免诊断代码反过来污染业务依赖图）。

---

## 8. 错误处理

`@migaia/reactive` 没有独立的错误码枚举，但有一套明确的**错误上下文分类**（`IRuntimeErrorPhase`），配合 `onError` 回调统一接收：

```ts
const runtime = createRuntime({
  onError: (error, context) => {
    console.error(`[reactive] ${context.phase} 失败`, context.observer, context.observable, error);
  }
});
```

| `phase` | 什么时候触发 |
| --- | --- |
| `async-flush` | 自动调度（微任务/自定义策略）触发的冲刷过程中，某个 `Effect` 抛错。**同步调用 `runtime.flush()` 或 `batch()` 触发的冲刷不会走这里**——那些错误会直接同步抛给调用方。 |
| `dependency-disconnect` | 某个 `Observer` 的 `onDependencyDisconnected` 回调本身抛错（内核逻辑，一般用户代码不会直接触发）。 |
| `lifecycle-hook` | `Signal.addObservedHooks` 注册的 `onObserved`/`onUnobserved` 回调抛错。 |
| `ssr-resource` | 预留给 SSR 场景下"某个异步资源预取失败，页面仍然照常渲染，缺失部分交给客户端补拉"的报告通道（本包自身不产生此 phase 的事件，供上层包复用）。 |
| `subscription-listener` | 面向自定义订阅/监听场景的错误上报通道（供扩展层复用）。 |
| `trace-listener` | `subscribeTrace`/`onTrace` 注册的监听器自身抛错，或返回的 Promise reject。 |

默认 `onError`（不传时）是 `console.error('[store] reactive ${phase} error', error)`——错误不会被吞掉、也不会中断 Runtime，但**只会打印，不会自动上报到你的监控系统**，生产环境建议显式传 `onError`。

**同步路径 vs 异步路径的关键区别**：直接调用 `runtime.flush()`、`runtime.batch(fn)` 触发的冲刷，如果其中的 `Effect` 抛错，错误会**同步向上抛给调用方**（可以用 `try/catch` 直接捕获）；而由 `Signal` 写入自动触发的微任务冲刷，错误只会通过 `onError` 回调报告，不会变成一个未处理的 Promise 拒绝或全局异常——这是两条独立的路径，写业务代码时需要清楚当前的错误是从哪条路径来的。

---

## 9. 诊断与 trace

```ts
const stop = runtime.subscribeTrace((event) => {
  if (event.type === 'observer-run' && event.phase === 'error') {
    console.error('effect 执行出错', event.observer.debugName, event.error);
  }
});
// ... 之后
stop();
```

`IRuntimeTraceEvent` 是判别联合类型：

| `type` | 关键字段 | 含义 |
| --- | --- | --- |
| `observable-change` | `observable`、`reason: 'set' \| 'notify'` | 一个 `Signal`/自定义 Source 的值发生变化 |
| `dependency` | `phase: 'connect' \| 'disconnect'`、`observable`、`observer`、`reason?` | 依赖边的建立/断开（`reason` 可以是 `retrack`/`invalidate`/`dispose`） |
| `observer-run` | `phase: 'start' \| 'end' \| 'error'`、`observer`、`durationMs?`、`error?` | 一次 `Computed` 重算或 `Effect` 执行的开始/结束/出错 |
| `action` | `phase`、`name`、`durationMs?`、`error?` | `runTracedAction(name, fn)` 包裹的一段业务动作 |

要点：

- **只要没有任何 trace 监听者（既没传 `onTrace`，也没调用 `subscribeTrace`），trace 相关的所有开销都是零**——内部用 `traceEnabled()` 短路跳过事件构造。
- 事件里的 `observable`/`observer` 字段是**只读的 `IRuntimeNodeDescriptor`**（`{ id, kind, debugName? }`），不是节点本身——拿不到 `value`、改不了依赖图，诊断代码无法反向污染业务状态。
- trace 监听器在 `untracked` 上下文里执行，读取任何响应式状态都不会给业务图建立依赖；监听器抛错或返回被拒绝的 Promise 会被送去 `onError`（`phase: 'trace-listener'`），不会中断当前的冲刷。
- `createRuntime({ onTrace })` 是"订阅一个监听器"的构造期简写，效果等价于构造后立即 `subscribeTrace(onTrace)`；可以同时使用多个监听器（`onTrace` 一个 + 之后再 `subscribeTrace` 若干个）。

---

## 10. 跨 Runtime 边界与所有权

每个节点在构造时会登记归属于创建它的那个 `Runtime`（内部一张 `WeakMap`，不依赖字段名猜测）。三类边界会被显式检查：

1. **依赖追踪跨界**：正在追踪某个 `Runtime` 的依赖时，读取了另一个 `Runtime` 的节点，抛 `[store] cross-runtime dependency is not allowed`。
2. **图操作跨界**：把一个节点交给不属于它的 `Runtime` 做依赖/订阅相关操作，抛 `[store] ... belongs to another Runtime` 一类错误。
3. **同一对象被登记到两个 `Runtime`**：视为编程错误（正常使用不会触发，只有手写扩展层伪造节点时才可能撞到），抛 `[store] this node is already owned by another Runtime`。

实践含义：**不要在多个 `Runtime` 之间传递 `Signal`/`Computed`/`Effect` 实例**。需要跨边界共享状态时，应该在边界处显式做"读取一个 Runtime 的值、写入另一个 Runtime 的 Signal"这样的同步逻辑，而不是直接复用节点对象。

版本时钟上限是 `Number.MAX_SAFE_INTEGER`，即使每秒产生一百万次真实变更也需要约 285 年才会耗尽；真的耗尽时会 fail-stop（后续写入直接抛错），恢复方式是整体丢弃这个 `Runtime`、新建一个，而不是复位同一张图。

---

## 11. 扩展 API：面向 Store/框架适配层作者

以下入口不从主入口 `@migaia/reactive` 导出，需要显式深度 import；它们是这个 monorepo 内 `store-*`/`resource` 等上层包用来在这套内核之上构建更高层能力的接口，日常写业务代码不需要它们。

### `@migaia/reactive/runtime` → `createObserverBinding(runtime)`

三段式绑定原语，用于实现"渲染期只读捕获依赖、提交期才真正建立订阅"的并发安全框架适配层（比如 React 的 `useSyncExternalStore` 风格集成）：

```ts
import { createObserverBinding } from '@migaia/reactive/runtime';

const binding = createObserverBinding(runtime);
const capture = binding.capture(() => someSignal.value); // 只读，不建边
const result = binding.commit(capture); // 'committed' | 'stale' | 'no-observer'
```

`capture()` 不修改依赖图，被丢弃的渲染因此不会留下泄漏的订阅；`commit()` 把捕获到的依赖装到内部持有的 `Effect` 上，返回三态结果——`stale` 表示提交时依赖已经变化，调用方必须重新捕获求值，而不是把陈旧结果当最新值提交。

### `@migaia/reactive/runtime/source` → `createFieldSource(runtime, debugName?)`

为扩展层创建一条受控的自定义响应式来源，只暴露 `track()`/`notify()`/`commit(write)`/`observed`/`disposed`/`dispose()`，拿不到节点、订阅集合或 tracker——用于给"不是 `Signal` 但需要参与依赖图"的状态（比如某个 wasm 内存字段）接入通知管线。

### `@migaia/reactive/runtime/node-factories` → `internalRuntimeOf(runtime)`

返回一个 `signal()`/`computed()` 返回**具体 `Signal`/`Computed` 类**（而不是公共窄接口 `ISignal`/`IComputedValue`）的 Runtime 视图，供需要调用 `.dispose()`、访问完整实例成员的上层实现使用。同模块的 `isRuntimeTracking(runtime)`/`isAnyRuntimeTracking()` 可用于判断当前是否处于依赖收集帧内。

### `@migaia/reactive/runtime/copy-check` → `assertSingleRuntimeCopy()`

检测同一进程里是否被打包进了多份 `@migaia/reactive`（常见于依赖没有正确去重、或微前端各自打包）。库内部的所有权表和依赖追踪上下文都是**模块级、每份副本各一份**——出现第二份副本时，跨副本的节点会互相认成"不是本库创建的 Runtime"，跨副本依赖读取也检测不到，会静默拿到陈旧数据。多副本共存时控制台会自动打印一次告警；需要"宁可启动失败也不要有这个风险"的应用可以显式调用 `assertSingleRuntimeCopy()`，检测到多副本时立即抛错。

> 除以上四个入口外，`@migaia/reactive/runtime/*` 下还能路径命中一些纯内部实现文件（依赖追踪器、调度器等具体类）。它们没有在这里列出，是因为它们是内核自身的实现细节，不构成稳定的公开契约，不建议依赖。

---

## 12. 更贴近生产的完整示例

```ts
import { Computed, Effect, Signal, createRuntime } from '@migaia/reactive';

const runtime = createRuntime({
  onError: (error, context) => reportToMonitoring(context.phase, error),
  maxFlushPasses: 200 // 有意设计了很深的派生链，调大失控保护的阈值
});

const scope = runtime.createScope();

const query = scope.own(new Signal('', runtime, { debugName: 'search.query' }));
const results = scope.own(
  new Computed(
    () => (query.value.length === 0 ? [] : search(query.value)),
    runtime,
    { debugName: 'search.results' }
  )
);

scope.own(
  new Effect(() => {
    renderResults(results.value);
    return () => clearResults(); // 下次重跑/dispose 前先清理
  }, runtime, { debugName: 'search.render' })
);

query.value = 'reactive';
runtime.batch(() => {
  query.value = 'react';
  query.value = 'reactive core'; // 两次写入只触发一次冲刷
});

// 页面卸载 / 请求结束
scope.dispose(); // 按逆序释放 effect → results → query
```

---

## 13. 常见问题排查

**Q：`Effect` 明明依赖变了，但没有重新执行。**
检查是否忘了调用 `runtime.flush()`（如果测试环境不会自动跑微任务），或者写入的值和旧值经 `Object.is` 判断相等（`Signal.value = 相同值`不会触发通知）。

**Q：`Computed` 每次读取都在重新计算，缓存好像没生效。**
如果它当前没有任何订阅者（没有 `Effect` 或别的 `Computed` 依赖它），它会在空闲时被自动挂起、下次读取从头计算——这是设计如此。需要持续保留缓存，传 `{ keepAlive: true }`。

**Q：读取一个用过的节点，抛 `cannot use a disposed signal` / `cannot read a disposed computed`。**
节点已经被 `dispose()` 过，这是有意的 fail-fast 设计（不会返回一个"看着能用但永不更新"的陈旧值）。检查是不是 `Scope.dispose()` 提前释放了还在被引用的节点，或者对象被重复 `dispose()` 后又被继续使用。

**Q：控制台报 `possible infinite effect loop`。**
说明某个 `Effect` 的写操作最终又落回了它自己读取的依赖，形成了同一次冲刷内的自触发环。检查该 `Effect` 是否在读取某个 `Signal` 的同时又无条件写入了它（或者经过 `Computed` 间接形成环）；错误信息里列出的 `debugName` 可以帮助定位是哪些待办被丢弃。

**Q：跨模块/跨包读取节点报 `cross-runtime dependency` 或 `belongs to another Runtime`。**
两个 `Signal`/`Computed`/`Effect` 不属于同一个 `Runtime` 实例。检查是不是有代码分别调用了两次 `createRuntime()`，或者混用了 `defaultRuntime` 和某个显式创建的 `Runtime`。

**Q：微任务里的 `Effect` 报错，但业务代码里 `try/catch` 不到。**
这是设计如此——自动调度（微任务/自定义策略）触发的冲刷里的错误走 `onError` 回调，不会同步抛给业务代码。需要同步捕获，改用显式 `runtime.flush()` 或 `runtime.batch(fn)`；需要异步场景下感知错误，务必传 `createRuntime({ onError })`。
