# `@migaia/reactive` 使用指南

[English](./USEGUIDE.en.md)

包的定位、亮点和心智模型见 [README](./README.md)。本指南先按场景给出可以直接运行的示例（Node 24），再列出两个公开入口的 API、边界行为与错误码。节点统一经 Runtime 工厂创建；`Signal`、`Computed`、`Effect` 类是内部实现。

## 按场景查找

| 你遇到的问题 | 看这一节 |
| --- | --- |
| 派生值要在每个修改点手动更新 | [派生值自动更新](#派生值自动更新) |
| 切换房间、页面后旧订阅还在 | [切换订阅时先清理旧的](#切换订阅时先清理旧的) |
| 同时改两个值，页面闪过一半新一半旧的结果 | [多次写入只更新一次](#多次写入只更新一次) |
| 关着的面板也在重算 | [没人读取的派生值不计算](#没人读取的派生值不计算) |
| 两个副作用互相触发，标签页卡死 | [副作用互相触发时不会卡死](#副作用互相触发时不会卡死) |
| 服务端渲染时请求之间串数据 | [服务端每个请求一个 Runtime](#服务端每个请求一个-runtime) |

## 派生值自动更新

把购物车合计单独存在一个变量里，单价或数量一变，页面就该显示新的合计。

手写时每个修改单价或数量的地方都得记得重新计算合计，漏掉一处页面就显示旧值；依赖关系只存在于开发者的记忆里。

用 Runtime 时，`computed` 只需根据它读到的值把合计声明一次；读取它的 `effect` 会在任一依赖变化后重跑。不需要列出依赖：在函数里读了 `price.value`，就自动依赖它。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const price = runtime.signal(30)
const quantity = runtime.signal(2)
// 合计由单价和数量推导出来，不需要在每个修改的地方手动更新
const total = runtime.computed(() => price.value * quantity.value)

const render = runtime.effect(() => {
  console.log(`购物车合计：${total.value} 元`)
})

quantity.value = 3 // 改数量
runtime.flush() // 示例里手动冲刷；平时由微任务自动完成
price.value = 25 // 改单价
runtime.flush()

render.dispose()
total.dispose()
```

输出：

```text
购物车合计：60 元
购物车合计：90 元
购物车合计：75 元
```

先输出 `购物车合计：60 元`，改数量后输出 `90 元`，改单价后输出 `75 元`。

副作用在创建时运行一次，之后每次变化运行一次；`runtime.flush()` 只是让时机更明确，不写它时默认的微任务冲刷也得到同样的输出。

## 切换订阅时先清理旧的

聊天窗口每次切换房间都加入新房间，却从不离开旧房间，最后会收到所有去过的房间的消息。

手写订阅时，“离开”要写在切换房间的每个分支里，还要记得在关闭窗口时再写一次；漏掉任何一处，旧订阅就一直留着。

`effect` 可以返回一个清理函数，Runtime 会在副作用重跑之前、以及 `dispose()` 时调用它，所以“离开”总是先于下一次“进入”。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const room = runtime.signal('大厅')

const chat = runtime.effect(() => {
  const name = room.value
  console.log(`进入 ${name}`)
  // 返回的函数会在下次重跑之前、以及 dispose() 时执行
  return () => console.log(`离开 ${name}`)
})

room.value = '技术交流'
runtime.flush()
chat.dispose() // 用户关闭聊天窗口
```

输出：

```text
进入 大厅
离开 大厅
进入 技术交流
离开 技术交流
```

依次输出 `进入 大厅`、`离开 大厅`、`进入 技术交流`，`dispose()` 后输出 `离开 技术交流`。

每次清理拿到的都是它那一次运行的房间，因为闭包捕获的是那一次的 `name`。

## 多次写入只更新一次

同时改名和姓，页头先显示 “Grace Lovelace” 这种混合值，再显示正确的名字。

如果每次写入都立刻通知监听者，监听者会在两次写入之间运行，读到只改了一半的数据，页面也因此多渲染一次。

Runtime 写入时只把下游标记为过期，副作用在下一次冲刷（默认是微任务）时才运行，所以同一段同步代码里的写入会被一起看到。从多条路径读取同一组值的派生值（`initials` 和 `label` 都读了名字）也按最终输入重新计算。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const first = runtime.signal('Ada')
const last = runtime.signal('Lovelace')
const initials = runtime.computed(() => `${first.value[0]}.${last.value[0]}.`)
const label = runtime.computed(() => `${first.value} ${last.value}（${initials.value}）`)

let effectRuns = 0
const header = runtime.effect(() => {
  effectRuns += 1
  console.log('页头显示:', label.value)
})

// 同一段同步代码里改了两个值
first.value = 'Grace'
last.value = 'Hopper'
await Promise.resolve() // 等默认的微任务冲刷
console.log('副作用一共执行了', effectRuns, '次')
header.dispose()
```

输出：

```text
页头显示: Ada Lovelace（A.L.）
页头显示: Grace Hopper（G.H.）
副作用一共执行了 2 次
```

创建时输出 `页头显示: Ada Lovelace（A.L.）`，两次写入后只输出一次 `Grace Hopper（G.H.）`；`副作用一共执行了 2 次`。

没有任何一行出现名和姓混搭的值：同一轮里的写入合并成一次副作用运行。

## 没人读取的派生值不计算

一个昂贵的统计放在可以收起的面板里，面板关着时，数据每变一次它仍然重算一次。

手写的派生值通常在写入时立刻重算，不管有没有人在看，关着的面板也在消耗时间。

`computed` 是惰性的：没人读取就不运行。最后一个读取者（这里是副作用）被释放后，它会和输入断开，之后的写入不再引发重算；下次读取时先检查输入是否变化，变了才重算一次。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const orders = runtime.signal([120, 80, 45])
let computations = 0
const report = runtime.computed(() => {
  computations += 1 // 假设这是一段昂贵的统计
  return orders.value.reduce((sum, amount) => sum + amount, 0)
})

orders.value = [...orders.peek(), 60] // 还没人读取 report
console.log('没人读取时计算次数:', computations)

const panel = runtime.effect(() => console.log('报表面板:', report.value))
orders.value = [...orders.peek(), 10]
runtime.flush()
console.log('面板打开期间计算次数:', computations)

panel.dispose() // 面板关闭，最后一个读者离开
orders.value = [...orders.peek(), 99]
orders.value = [...orders.peek(), 1]
console.log('面板关闭后计算次数:', computations)
console.log('再次读取:', report.value, '计算次数:', computations)
```

输出：

```text
没人读取时计算次数: 0
报表面板: 305
报表面板: 315
面板打开期间计算次数: 2
面板关闭后计算次数: 2
再次读取: 415 计算次数: 3
```

`没人读取时计算次数: 0`；面板打开期间每次变化计算一次（共 2 次）；面板关闭后又写入两次，计数仍是 2；再次读取得到 415，计数变为 3。

计算只发生在有人读取的时候，关闭面板后的写入不会触发任何计算。

## 副作用互相触发时不会卡死

用两个副作用实现摄氏度和华氏度的双向同步，每个都写对方读取的值；两个值始终对不上时，标签页卡死。

手写的双向同步没有轮数限制，两个监听者会无限互相触发，卡在循环里的页面失去响应，也看不到是哪两段代码在打架。

每次冲刷最多运行 `maxFlushPasses` 轮（默认 100）。超过上限后，Runtime 停止本次冲刷，丢弃剩下排队的副作用，并报告 `FLUSH_LOOP`，附上它们的 `debugName`：自动冲刷交给 `onError`，手动调用 `flush()` 时直接抛出。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  maxFlushPasses: 20, // 默认 100
  onError: (error, context) => console.log(context.phase, (error as { code?: string }).code)
})
const celsius = runtime.signal(0, { debugName: 'celsius' })
const fahrenheit = runtime.signal(32, { debugName: 'fahrenheit' })

// 两个副作用互相写对方读取的值，换算里又多加了 1，两个值永远对不上，于是互相触发
runtime.effect(() => { fahrenheit.value = celsius.value * 1.8 + 33 }, { debugName: 'c-to-f' })
runtime.effect(() => { celsius.value = (fahrenheit.value - 32) / 1.8 }, { debugName: 'f-to-c' })

await new Promise((resolve) => setTimeout(resolve, 10))
console.log('页面仍可响应，celsius =', Math.round(celsius.peek()))
```

输出：

```text
async-flush FLUSH_LOOP
页面仍可响应，celsius = 12
```

先由 `onError` 输出 `async-flush FLUSH_LOOP`，再输出 `页面仍可响应，celsius = 12`。

循环在 20 轮（示例里设的 `maxFlushPasses`）后被截断，而不是一直运行下去；报告里带的 `debugName` 指出了互相触发的副作用。

## 服务端每个请求一个 Runtime

服务端给很多用户渲染页面，一个用户的数据出现在另一个用户的页面上。

`defaultRuntime` 是整个进程共用的一个 Runtime；把请求状态放在这张共享的依赖图里，一个请求写入的值会被另一个请求读到，而且很难发现。

为每个请求用 `createRuntime()` 创建自己的 Runtime。不同 Runtime 的节点不能互相依赖：跨 Runtime 读取会立刻抛出 `CROSS_RUNTIME`，而不是悄悄把数据混在一起。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

// 服务端渲染：每个请求一个 Runtime，用户之间的状态互不可见
function renderPage(user: string) {
  const runtime = createRuntime()
  const name = runtime.signal(user)
  const greeting = runtime.computed(() => `你好，${name.value}`)
  return { runtime, greeting }
}

const pageA = renderPage('Ada')
const pageB = renderPage('Grace')
console.log(pageA.greeting.value, '|', pageB.greeting.value)

// 把 A 的节点拿到 B 的 Runtime 里使用，会立刻报错，而不是悄悄串数据
const leaked = pageB.runtime.computed(() => pageA.greeting.value)
try {
  leaked.value
} catch (error) {
  console.log('跨 Runtime 读取:', (error as { code?: string }).code)
}
```

输出：

```text
你好，Ada | 你好，Grace
跨 Runtime 读取: CROSS_RUNTIME
```

输出 `你好，Ada | 你好，Grace`：每个请求有自己的状态。

把节点带到别的 Runtime 里读取时输出 `跨 Runtime 读取: CROSS_RUNTIME`：串用会在出错的那一行暴露出来。

---

## 目录

- [主入口 `@migaia/reactive`](#主入口)：Runtime 工厂、窄节点类型、诊断常量与错误码
- [`/extension` 入口](#extension-入口)：所有权、受控 source、observer binding、图类型与只读版本查询
- [错误码](#错误码)
- [Trace 事件与常量](#trace-事件与常量)
- [高阶组合示例](#高阶组合示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="主入口"></a>

## 主入口 `@migaia/reactive`

```ts
import {
  createRuntime,
  defaultRuntime,
  assertSingleRuntimeCopy,
  ReactiveErrorCode,
  REACTIVE_SOURCE,
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  ReactiveTraceReason,
  type IReactiveSignal,
  type IReactiveComputed,
  type IReactiveEffect,
  type IComputedConfig,
  type IReactiveNodeOptions,
  type IDisposable,
  type IDisposer,
  type IRuntime,
  type IRuntimeOptions,
  type ISchedulerStrategy,
  type IFlushResult,
  type IRuntimeTraceEvent,
  type IRuntimeErrorContext,
  type IReactiveErrorCode,
  type IReactiveError
} from '@migaia/reactive'
```

### `IReactiveSignal<T>`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IReactiveSignal<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly version: number
  readonly disposed: boolean
  readonly observed: boolean // !disposed && 有下游订阅
  value: T // 读建立依赖；写触发下游
  peek(): T // 读，不建立依赖
  dispose(): void
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): () => void
}
```

可写原子——响应式图里唯一的"真值来源"：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const runtime = createRuntime()
const count = runtime.signal(1)
count.value // 1，在 Computed/Effect 内读取会建立依赖
count.value = 2 // Object.is 判定；写入相同值不触发任何通知，也不推进版本
count.peek() // 2，不建立依赖
count.dispose()
count.value // 抛 NODE_DISPOSED
```

边界行为：

- 经 `runtime.signal(value, options?)` 创建；返回窄节点视图，不暴露图边或内部方法。
- `value = next`：`Object.is(next, 之前值)` 为真时短路，不推进版本、不触发下游；否则先向 `VersionClock` 领取新版本号再落值（领取失败——时钟耗尽——保持原子失败，绝不出现"值已变、版本未变"的陈旧状态）。
- `dispose()` 幂等；释放时先标记 `disposed` 再断开全部下游订阅边（通知顺序：标记优先，确保被迫重跑的 Effect 读到明确的 `NODE_DISPOSED` 而不是重新订阅一个已释放节点）。
- `addObservedHooks({ onObserved?, onUnobserved? })`：登记节点级生命周期钩子（多个调用方可各自登记互不覆盖），返回移除函数；多个钩子中若有失败，内部单个失败保留原实例，多个失败聚合为 `OBSERVER_FAILED` AggregateError；公开观察路径捕获并通过 `onError` 的 `lifecycle-hook` phase 报告，创建 Effect 不靠同步 throw 暴露 hook 失败。
- 跨 `Runtime` 读取/订阅一个 `Signal` 会抛 `CROSS_RUNTIME`。

### `IReactiveComputed<T>`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IComputedOptions<T> = {
  equals?: (a: T, b: T) => boolean
  keepAlive?: boolean
  debugName?: string
}
type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean)

type IReactiveComputed<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly version: number
  readonly disposed: boolean
  readonly observed: boolean
  readonly value: T // 读建立依赖 + 惰性重算
  peek(): T // 读、重算，但不建立依赖
  dispose(): void
}
```

惰性求值、带缓存的派生值——写只标脏（push），值只在被读时重算（pull）：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const doubled = runtime.computed(() => count.value * 2)
doubled.value // 首次读取才真正计算
doubled.value // 依赖未变则直接返回缓存，不重算

const clamped = runtime.computed(() => Math.max(0, count.value), { keepAlive: true }) // 无订阅者也保持热态
const custom = runtime.computed(
  () => ({ n: count.value }),
  (a, b) => a.n === b.n
) // 配置参数可直接传比较函数
```

边界行为：

- 经 `runtime.computed(fn, config?)` 创建；配置可以是对象，也可以直接传一个 `equals` 比较函数。
- `equals`：默认 `Object.is`；比较函数本身抛错会阻止 dirty 落定（下次读取仍会重算，不会陷入"陈旧但标记为干净"的状态）。
- `keepAlive`：默认 `false`——普通无人观察读取在 idle 时机挂起；最后观察者离开时同步挂起（断开依赖、保留版本/拓扑快照）。下次读取先重验证，未变化时复用缓存，否则重算；设为 `true` 时禁用自动挂起。
- 循环自依赖（求值过程中直接或间接又读了自己）抛 `CIRCULAR_DEPENDENCY`，不会栈溢出。
- 已释放节点的 `value`/`peek` 一律抛 `NODE_DISPOSED`。

### `IReactiveEffect`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IReactiveEffect = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly disposed: boolean
  dispose(): void
}
```

副作用——唯一真正"被执行"的观察者（`Computed` 只标脏不重跑，只有 `Effect` 会被调度器实际 `tick`）：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(doubled.value)
  return () => console.log('cleanup') // 可选：返回值作为下次重跑/dispose 前的清理回调
}) // 构造时立即同步跑一次
effect.dispose() // 释放：清理依赖边 + 跑最后一次 cleanup（untracked 执行，不建立依赖）
```

边界行为：

- **构造时立即同步执行一次**，不是等到依赖变化才第一次运行。
- `fn()` 可选返回一个清理函数（`IDisposer`），会在下次重跑前、以及 `dispose()` 时被调用（`runtime.untracked()` 包裹执行，不建立新依赖）；旧 cleanup 会先被摘掉（置空）再执行，避免新 `fn()` 抛错时下次重跑/dispose 重复执行旧 cleanup。
- 默认微任务策略下依赖变化不会立即重跑，而是被 `Scheduler.enqueue()` 标脏排队，由 `flush()`（自动或手动）驱动 `tick()`；`tick()` 内部会先确认依赖确实变化（`hasStaleDependencies`）才真正 `run()`。注入 `flush => flush()` 这类同步策略时，setter 可在完整 fan-out 后立即重跑 Effect。
- 依赖节点被 `dispose()`/`disconnectObservable` 断开时，会强制下次 `tick()` 无条件重跑（不看是否真的脏）。

### `createRuntime` / `defaultRuntime`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function createRuntime(options?: IRuntimeOptions): IRuntime
const defaultRuntime: IRuntime
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IRuntimeOptions = {
  adapter?: Partial<IReactiveRuntimeAdapter> // scheduleMicrotask/now/timestamp/reportError
  onError?: (error: unknown, context: IRuntimeErrorContext) => void
  onTrace?: (event: IRuntimeTraceEvent) => void
  maxFlushPasses?: number // 默认 100，须为正整数
  scheduleIdle?: (task: () => void) => void // 默认走 adapter.scheduleMicrotask
  schedulerStrategy?: ISchedulerStrategy // 创建期选择，默认微任务合并
}
```

新建一个隔离运行时：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const runtime = createRuntime({
  maxFlushPasses: 50,
  onError: (e, ctx) => console.error(ctx.phase, e)
})
```

边界行为：

- `maxFlushPasses` 非正整数（非安全整数或 `< 1`）抛贴 `INVALID_OPTION` 码的 `RangeError`。
- `adapter` 的每个方法（`scheduleMicrotask`/`now`/`timestamp`/`reportError`）独立解析：未提供或显式 `undefined` 回落到默认实现（`queueMicrotask`/`performance.now()`/`Date.now()`/no-op）；提供了但不是函数抛贴 `INVALID_OPTION` 码的 `TypeError`。
- `onError`/`onTrace`/`scheduleIdle`/`schedulerStrategy` 若提供但不是函数，构造时抛携带顶层 `INVALID_OPTION` 的原生 `TypeError`。策略校验发生在创建 Scheduler 之前。
- `defaultRuntime` 是进程级单例（模块加载时立即 `createRuntime()`），SSR 每请求隔离、单测互不污染、Worker 独立场景都应显式 `createRuntime()`，不要依赖它。
- 若检测到本库存在多份运行时副本（重复安装/CDN 副本共存/微前端各自打包），构造期会通过 `reportError` 上报一条 `COPY_CONFLICT` 诊断（不阻断构造）。

`IRuntime` 的公开方法（品牌字段省略）：

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IRuntime = {
  signal<T>(value: T, options?: IReactiveNodeOptions): IReactiveSignal<T>
  computed<T>(fn: () => T, config?: IComputedConfig<T>): IReactiveComputed<T>
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IReactiveEffect // 返回现有节点的生命周期句柄
  batch<T>(fn: () => T): T
  untracked<T>(fn: () => T): T
  flush(): 'completed' | 'deferred'
  runTracedAction<T>(name: string, fn: () => T): T
  reportError(
    error: unknown,
    context: { phase: IRuntimeErrorContext['phase']; observer?: object; observable?: object }
  ): void
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer
}
```

逐个方法：

- `batch(fn)`：显式合并多次写入为一次副作用刷新；进入时计深度，只有最外层退出才真正 `flush()`。若 `fn` 抛错且随后的收尾 `flush()` 也抛错，可写的普通 `Error` 保持原对象并在 `cause` 附上 flush 错误；非 `Error` 或不可写 `Error` 用携带 `ACTION_FLUSH_FAILED` 码的 `AggregateError` 保留原值。若业务错误的 `cause` getter 抛错，聚合错误的 `errors` 依次保留业务错误、flush 错误、getter 抛出值；`onError` 另收到 getter 抛出值及 `cause-read` phase。
- `untracked(fn)`：`fn` 执行期间关闭依赖收集，读取任何 `Signal`/`Computed` 都不会建立依赖边。
- `flush()`：同步冲刷当前队列。**重入语义**：observer `tick()` 内部再次调用 `flush()` 返回 `'deferred'`（外层 flush 仍在跑，本次调用不会真正冲刷）；最外层调用完成并排空队列后返回 `'completed'`。单次冲刷内的重算轮数超过 `maxFlushPasses` 抛 `FLUSH_LOOP`（见错误码表），并清空剩余队列，错误信息列出被丢弃的最多 8 个 `debugName`。
- `schedulerStrategy` 创建期选项只改变何时 `flush`，不交出 Scheduler 队列。策略须同步返回；返回 thenable 会触发 `INVALID_OPTION` 诊断并回退到已验证的安全策略。Runtime 存活期间不公开替换入口。
- `runTracedAction(name, fn)`：执行并追踪一段真实 action；`name` 必须是非空字符串，否则抛 `INVALID_OPTION`。未启用 trace（无监听器）时只执行 fn 与同一 callback 错误边界，不创建 trace 事件。
- `reportError(error, context)`：诊断通道；`context.observer`/`context.observable` 是原始节点对象，内部会先脱敏为 `IRuntimeNodeDescriptor` 再转发给 `onError`。reporter 自身 throw/rejection 交 utils 共享宿主异常队列，不反向破坏图操作。
- `subscribeTrace(listener)`：只读诊断事件流（值变化、依赖连接/断开、副作用执行、显式 action），返回取消订阅函数。

---

### `assertSingleRuntimeCopy()`

要求当前进程只有一份进入过正确性边界的模块副本，否则抛 `COPY_CONFLICT`。应用从根入口显式调用，库自身不主动调用它。重复安装、CDN 副本共存或微前端独立打包时，应去重依赖。

---

<a id="extension-入口"></a>

## `/extension` 入口

实现层通过本入口取得扩展能力。它允许图协议参与和所有权登记，能力多于公共 `IRuntime`；不会交出 tracker/scheduler/clock 对象或可变边集。

```ts
import {
  createObserverBinding,
  type IObserverBinding,
  type IObserverCommitResult,
  type IObserverRetrackResult,
  type ICapture
} from '@migaia/reactive/extension'
```

### `createObserverBinding`

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function createObserverBinding(runtime: IRuntime): IObserverBinding

type IObserverBinding = {
  capture<R>(read: () => R): ICapture<R>
  observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer
  commit(capture: ICapture<unknown>): IObserverCommitResult
  retrack(): IObserverRetrackResult
}

type IObserverCommitResult = 'committed' | 'stale' | 'no-observer'
type IObserverRetrackResult = 'changed' | 'unchanged' | 'no-observer'
```

为一个订阅者建立三段式绑定：**render 期只读地捕获依赖，commit 期才把依赖装到订阅者上**，中间的渲染可能被并发渲染丢弃，捕获阶段绝不建边。绑定自持一个内部 `Effect`：适配层能完成 capture/observe/commit/retrack，却拿不到 `deps`、版本或强制调度入口：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const binding = createObserverBinding(runtime)
const dispose = binding.observe(() => {
  // 真正的订阅者体；依赖变化后被正常调度重跑
})

// 渲染期（可能被丢弃）：
const capture = binding.capture(() => doubled.value) // 只记录读了谁、当时版本，不建边

// 提交期：
const result = binding.commit(capture) // 'committed' | 'stale' | 'no-observer'
if (result === 'stale') {
  // 捕获后依赖已变化：调用方应重新求值，不要复用同一个 capture token
}

binding.retrack() // 强制当前订阅者重跑一次，返回其依赖集合或记录版本是否发生变化
dispose()
```

四个成员逐一说明：

- `capture<R>(read: () => R): ICapture<R>` —— 渲染期捕获：只记录本次读到了哪些依赖节点及其当时版本，**不建立依赖边、不推进版本、不排 idle 工作**。读取 dirty Computed 复用其 speculative preview，所需已求值图保留在同一个 token 内，commit 先验证完整依赖树，再接纳图/缓存，不重跑 derivation 或 comparer；被丢弃的渲染不会留下订阅残留。`ICapture<R>` 是带品牌的不透明 token，`result: R` 是 `read()` 的返回值；依赖集合存在 tracker 私有 `WeakMap` 里，拿到 token 既读不出依赖也改不了版本。
- `observe(fn, options?): IDisposer` —— 安装绑定持有的内部 `Effect`（具体类保持私有，适配层拿不到它去改 `deps`/版本或调用 `run`/`markDirty`）。同一个 binding **重复调用**（当前订阅者仍处于已观察状态时再次调用）抛 `BINDING_DUPLICATE`。返回的 disposer 幂等。
- `commit(capture): IObserverCommitResult` —— 提交期安装依赖，把 `capture` 装到**创建绑定时指定的那个 observer** 上。`'committed'`：依赖边已安装；`'stale'`：捕获后依赖已变化，token 已消费，必须重新捕获——调用方只应在此时作废快照并重新取值，**不应该**在 commit 阶段去 pull 脏节点（那会把用户的求值错误抛在 commit 里，绕过 Error Boundary）；`'no-observer'`：提交目标尚不存在（还未 `observe()` 或已 dispose），token 未消费，可在 observer 就绪后重试。
- `retrack(): IObserverRetrackResult` —— 强制当前已提交的 observer 重跑一次，并报告其依赖集合或记录版本是否发生变化（`'changed'`/`'unchanged'`），无 observer 时返回 `'no-observer'`。

### 所有权登记与断言

```ts
import {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '@migaia/reactive/extension'
```

「某节点属于哪个 `Runtime`」的登记与断言，供在本包之上构建 Store/集合/资源类库的作者使用。

- `claimOwnership(value: object, runtime: IRuntime): void` —— 登记普通对象或函数对象的归属；首次登记安装已有不可枚举、不可写的跨副本品牌，WeakMap 仍为本地权威。同一引用重复登记到不同 `Runtime` 抛 `OWNERSHIP_CONFLICT`。
- `ownerOf(value: unknown): IRuntime | undefined` —— 查普通对象或函数对象的归属，普通未登记值返回 `undefined`；foreign copy 品牌触发 `COPY_CONFLICT`，不作为普通未登记值放行。
- `assertOwnedBy(value: unknown, runtime: IRuntime, what: string): void` —— 宽松断言：普通未登记值放行，foreign copy 品牌先拒绝（第三方可以把普通值注册进 Registry，不涉及图）；只有**登记过且归属不符**才抛 `CROSS_RUNTIME`。
- `assertReactiveOwnedBy(value: object, runtime: IRuntime, what: string): void` —— 内核图边界使用的严格断言：未登记直接抛 `NOT_RUNTIME_OWNED`；登记了但不属于当前 `runtime` 抛 `CROSS_RUNTIME`。

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const runtime = createRuntime()
const node = {}
claimOwnership(node, runtime)
assertOwnedBy(node, runtime, 'my-node') // 通过
assertOwnedBy(node, otherRuntime, 'my-node') // 抛 CROSS_RUNTIME
```

---

### `createFieldSource`

```ts
import { createFieldSource, type IRuntimeFieldSource } from '@migaia/reactive/extension'
```

```ts doc-test=skip reason="签名摘要，不是可运行模块"
function createFieldSource(
  runtime: IRuntime,
  debugName?: string
): {
  track(): void
  notify(): void
  commit<T>(write: () => T): T
  readonly observed: boolean
  readonly disposed: boolean
  dispose(): void
}
```

为扩展层创建一条受控 Source（如 Wasm 字段、SharedArrayBuffer 支持的值）。调用方只拿到 `track`/`notify`/`commit`/`dispose` 四个能力，拿不到底层节点、`subs`、版本或 `Tracker`，因而不能制造单边依赖、伪造版本、通知另一张 `Runtime` 图：

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const field = createFieldSource(runtime, 'wasm-counter')
function read(): number {
  field.track() // 建立依赖，不返回值——真实值由外部存储持有
  return wasmMemory.getValue()
}
function write(v: number): void {
  field.commit(() => wasmMemory.setValue(v)) // 领取版本、执行写入、再发布，三步原子
}
field.dispose()
```

边界行为：`track()`/`notify()`/`commit()` 在 `dispose()` 之后调用抛 `NODE_DISPOSED`；`commit(write)` 先领取版本号、执行 `write()`、再发布通知（与 `Signal.value = ` 的三段式一致）。

---

### 图视图与只读查询

```ts
import {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  currentRuntimeVersion,
  type IObservable,
  type IObserver,
  type IInternalRuntime
} from '@migaia/reactive/extension'
```

- `internalRuntimeOf(runtime: IRuntime): IInternalRuntime` —— 校验本库 Runtime 登记，未登记抛 `NOT_RUNTIME_OWNED`。`signal()` 返回 `IReactiveSignal<T> & IObservable`，`computed()` 返回 `IReactiveComputed<T> & IObservable & IObserver`。关系只读；observer 操作与所有权登记属于扩展能力，内部服务对象和可变边集不再公开。公开节点本身已经具有 `dispose()`。
- `isRuntimeTracking(runtime: IRuntime): boolean` —— 只读查询：该 `Runtime` 当前是否正在收集依赖帧。
- `isAnyRuntimeTracking(): boolean` —— 只读查询：进程内任意 `Runtime` 当前是否有依赖帧处于活跃状态。

- `currentRuntimeVersion(runtime: IRuntime): number` —— 读取原有版本时钟，不暴露时钟对象；未登记对象抛顶层 `NOT_RUNTIME_OWNED`。

---

### 自定义 source 与 observer

`createSourceBinding(node)` 为实现 `IObservable` 的新节点登记canonical版本与订阅者集合，返回只读 `version/subs` 和绑定原节点的 `source` 操作。构造时把只读元数据接入节点，再公开实例；保留SAB节点原身份。一般外部字段仍直接用 `createFieldSource(runtime)`。

`createTrackedObserver(observer)` 为实现 `IObserver` 的新节点创建只读 `deps/depVersions`，提供绑定自身的 `runTracked/clear/suspend/isSuspended/revalidate/hasStaleDependencies/deferIdle`。`clear` 只断图依赖，资源请求与取消仍由调用方管理；它不创建另一个Effect或tracker。框架render/commit适配继续用 `createObserverBinding(runtime)`。

这两个factory不能重绑已登记图节点（包括内置节点）：抛 `GRAPH_NODE_REGISTERED`，不会替换仍有活跃边的集合。`invalidateObservable(runtime, node)` 只摘节点下游、保留上游与缓存，供Atom routing切换；真正释放节点仍调用其dispose。

迁移：`@migaia/reactive/internals` 已删除。旧 `internalsOf/registerSubs/registerVersion/registerDeps` 等不能通过换名导入整个tracker；按上述角色迁移到 `/extension` 的绑定能力。`tracker/scheduler/clock` 和可写集合始终仅在kernel内部。

---

<a id="错误码"></a>

## 错误码

```ts
import { ReactiveErrorCode, type IReactiveErrorCode } from '@migaia/reactive'
```

稳定错误码表，**18 个码**，唯一声明处 `src/error-code.ts`，`source` 恒为 `'reactive'`。（迁移背景：原属于本包的 `SCOPE_CLOSED`/`SCOPE_REENTRANT_DISPOSE`/`SCOPE_SYNC_VIOLATION`/`GENERATION_DISPOSED`/`SCOPE_DISPOSAL_FAILED` 五个码已随生命周期原语迁出，归属 `@migaia/lifecycle`，不在本表。）

| `ReactiveErrorCode` 键 | 码值                    | 触发条件                                                                                                                                       |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `callbackFailed` | `CALLBACK_FAILED` | 未分类 action/batch/untracked/tracked derivation callback 失败；native 尽量原位附码，primitive（含 undefined）/不可变 native 原错保留 cause，已有 semantic identity 不变；非 Error 对象 throw 保留控制身份，供 Resource/Suspense owner 单次准入 |
| `nodeDisposed`         | `NODE_DISPOSED`         | 在已 dispose 的 `Signal`/`Computed`/自定义 Source 上调用读取或写入方法                                                                         |
| `circularDependency`   | `CIRCULAR_DEPENDENCY`   | 求值 `Computed` 时检测到它（直接或间接）读取了自己正在求值的结果                                                                               |
| `crossRuntime`         | `CROSS_RUNTIME`         | 一个属于某 `Runtime` 的节点或已登记函数对象在另一个 `Runtime` 的追踪/所有权边界上被读取、订阅或校验                                                            |
| `notRuntimeOwned`      | `NOT_RUNTIME_OWNED`     | 传入的对象不是由 `createRuntime()` 创建、或不携带内部所有权登记                                                                                |
| `ownershipConflict`    | `OWNERSHIP_CONFLICT`    | 同一个对象或函数引用被重复登记到不同的 `Runtime`                                                                                                     |
| `copyConflict`         | `COPY_CONFLICT`         | 检测到本库存在多份运行时副本、查询到另一副本已登记的对象或函数，或 `assertSingleRuntimeCopy()` 校验到副本数大于一                                                                |
| `brandCorrupted`       | `BRAND_CORRUPTED`       | 跨副本诊断品牌被发现处于非预期形状                                                                                                             |
| `versionExhausted`     | `VERSION_EXHAUSTED`     | 单调版本时钟达到配置上限（默认 `Number.MAX_SAFE_INTEGER`）后再次申请新版本号                                                                   |
| `flushLoop`            | `FLUSH_LOOP`            | 一次冲刷内的重算轮数超过 `maxFlushPasses`（默认 100）                                                                                          |
| `observerFailed`       | `OBSERVER_FAILED`       | 一次冲刷中多个 observer 的 `tick()` 失败、或多个 observable 生命周期钩子失败，作为 `AggregateError` 外壳                                       |
| `actionFlushFailed`    | `ACTION_FLUSH_FAILED`   | `runBatched()` 内业务动作与收尾 flush 同时失败；普通可写错误在 `cause` 附加聚合结果，不可读 `cause` 的三个原值直接置于 `AggregateError.errors` |
| `schedulerFailed`      | `SCHEDULER_FAILED`      | 预留：异步调度策略回调或 `reportError()` 捕获到未处理错误的诊断通道码（默认无内置抛出/上报点）                                                 |
| `captureInvalid`       | `CAPTURE_INVALID`       | `capture()` 产生的 token 在 `commitCapture()` 时已失效、已被消费、属于另一个 tracker，或对应 observer 已 dispose                               |
| `bindingDuplicate`     | `BINDING_DUPLICATE`     | 同一个 `IObserverBinding` 被重复调用 `observe()`（已处于 observed 状态）                                                                       |
| `graphNodeRegistered`  | `GRAPH_NODE_REGISTERED` | source/observer binding尝试替换已有graph node的集合，须创建新节点                                                                              |
| `internalsRegistered`  | `INTERNALS_REGISTERED`  | 同一个 `Runtime` 对象被重复注册内部面（`registerInternals()`）                                                                                 |
| `invalidOption`        | `INVALID_OPTION`        | 构造 `Runtime`/`Scheduler`/`VersionClock` 时传入的选项不满足取值要求                                                                           |

调用方应始终以 `error.code === ReactiveErrorCode.xxx` 判别，不要硬编码码值字符串。逐条设计动机见源码 `src/error-code.ts` 的 JSDoc。

---

<a id="trace-事件与常量"></a>

## Trace 事件与常量

```ts
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IRuntimeTraceEvent
} from '@migaia/reactive'
```

`subscribeTrace(listener)` 收到的事件是以下判别联合之一：

```ts doc-test=skip reason="签名摘要，不是可运行模块"
type IRuntimeTraceEvent =
  | {
      type: 'observable-change'
      timestamp: number
      observable: IRuntimeNodeDescriptor
      reason: 'set' | 'notify'
    }
  | {
      type: 'dependency'
      timestamp: number
      phase: 'connect' | 'disconnect'
      observable: IRuntimeNodeDescriptor
      observer: IRuntimeNodeDescriptor
      reason?: 'retrack' | 'invalidate' | 'dispose'
    }
  | {
      type: 'observer-run'
      timestamp: number
      phase: 'start' | 'end' | 'error'
      observer: IRuntimeNodeDescriptor
      durationMs?: number
      error?: unknown
    }
  | {
      type: 'action'
      timestamp: number
      phase: 'start' | 'end' | 'error'
      name: string
      durationMs?: number
      error?: unknown
    }
```

节点以脱敏后的 `IRuntimeNodeDescriptor`（`{ id, kind, debugName? }`）出现，不是原始节点对象。

| 常量                  | 取值                                                                                                               | 用途                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `ReactiveTraceType`   | `{ observableChange, dependency, observerRun, action }`                                                            | trace 事件的顶层判别                                                                                       |
| `ReactiveTracePhase`  | `{ start, end, error, connect, disconnect }`                                                                       | dependency/observerRun/action 事件的阶段                                                                   |
| `ReactiveErrorPhase`  | `{ asyncFlush, causeRead, dependencyDisconnect, lifecycleHook, ssrResource, subscriptionListener, traceListener }` | `reportError`/`onError` 收到的 `context.phase` 取值；`causeRead` 表示批处理收尾时读取业务错误 `cause` 失败 |
| `ReactiveTraceReason` | `{ set, notify, retrack, invalidate, dispose }`                                                                    | observableChange/dependency 事件的原因                                                                     |

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 隔离的 Runtime + 手动冲刷（SSR/单测场景）

```ts
import { createRuntime } from '@migaia/reactive'

function renderOnce() {
  const runtime = createRuntime() // 每次请求/每个用例独立一份，互不污染
  const count = runtime.signal(1)
  const doubled = runtime.computed(() => count.value * 2)
  const seen: number[] = []
  const dispose = runtime.effect(() => {
    seen.push(doubled.value)
  })
  count.value = 5
  runtime.flush() // 手动同步冲刷，SSR 场景不依赖微任务时机
  dispose.dispose()
  return seen // [2, 10]
}
```

### 2. 三段式绑定：实现一个最小的并发安全订阅适配层

```ts
import { createObserverBinding } from '@migaia/reactive/extension'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const count = runtime.signal(0)
const doubled = runtime.computed(() => count.value * 2)

function useReactiveValue<T>(read: () => T): T {
  const binding = createObserverBinding(runtime)
  const capture = binding.capture(read) // 渲染期：只读捕获，可能被丢弃
  // ……渲染真正提交时：
  binding.observe(() => {
    // 订阅变化后触发重渲染；真实 host 在卸载时调用返回的 disposer
  })
  const result = binding.commit(capture) // 先安装 observer，再提交 token
  if (result === 'stale') {
    // 依赖已变，重新求值（真实框架适配层这里会触发一次重渲染）
  }
  return capture.result
}
```

### 3. 批处理 + 错误优先级：一次动作里业务失败与收尾冲刷失败的顺序

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const runtime = createRuntime()
try {
  runtime.batch(() => {
    signalA.value = 1
    signalB.value = 2
    throw new Error('business failure')
  })
} catch (error) {
  // error 就是 'business failure' 本身；若收尾 flush 也失败，flush 错误挂在 error.cause 上
}
```

### 4. 自定义调度策略：切到 `requestAnimationFrame`

```ts doc-test=skip reason="片段，依赖示意中的外部函数或变量"
const runtime = createRuntime({
  schedulerStrategy: (flush) => {
    requestAnimationFrame(() => flush())
  }
})
```

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **读取节点抛 `NODE_DISPOSED`**：节点已 `dispose()`，绝不会静默返回旧值；停止持有该引用，改用重新创建的实例。
- **抛 `CROSS_RUNTIME`/`NOT_RUNTIME_OWNED`**：跨 `Runtime` 混用了节点，或传入的对象不是由 `createRuntime()` 创建；确认节点与消费它的 `Runtime` 是同一个。
- **`Computed` 抛 `CIRCULAR_DEPENDENCY`**：依赖图里存在自读环（`a` 直接或间接又读了 `a` 自己）；检查依赖图，拆掉循环引用。
- **`flush()` 抛 `FLUSH_LOOP`（自动冲刷时交给 `onError`，phase 为 `async-flush`）**：副作用之间互相触发停不下来，典型是两个 `Effect` 各自写对方读取的值，而两个值始终对不上；错误信息列出了被丢弃的待办 `debugName`，据此定位并拆环。单个 `Effect` 在运行中写自己读取的值不会让自己重跑。
- **`createObserverBinding().observe()` 抛 `BINDING_DUPLICATE`**：同一个 binding 在已处于 observed 状态时又被 `observe()` 了一次；再次调用前先确认当前是否已在观察中，或为新一轮渲染创建新的 binding。
- **`commit()` 返回 `'stale'`**：这不是错误，是正常的竞态处理信号；作废当前快照，重新 `capture()`/`commit()`，不要在 commit 阶段直接 pull 脏节点。
- **`COPY_CONFLICT`/`BRAND_CORRUPTED`**：进程内存在本库的多份模块副本；去重依赖（多数打包器问题），或在应用启动时调用 `assertSingleRuntimeCopy()` 主动 fail-fast。
- **`VERSION_EXHAUSTED`**：单调版本时钟耗尽（生产默认约 285 年才会发生）；释放当前 `Runtime` 持有的全部节点，创建一份新的 `Runtime`，不要试图复用同一张依赖图。
- **需要集合类型、异步资源状态机、UI 框架绑定**：`@migaia/reactive` 只提供引擎层三个节点原语和 `Runtime`，这些上层能力分别由 monorepo 里的 `store-*` 系列包、`@migaia/resource`、各框架适配层在其之上构建。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

跨副本诊断使用 `@migaia/reactive.runtime-copies` 和 `@migaia/reactive.ownership-copy` 全局 Symbol key。迁移时请统一升级同一进程中的 reactive 副本：旧 `@morning-watch/store` 命名空间与新版本互相不可见，混用时不会互相计数或识别归属品牌。

`@migaia/reactive/extension` 提供 `getDefaultRuntime()`，给需要在导入时保持不创建任何东西的适配层使用。它在第一次调用时创建共享的默认 Runtime，返回的对象与根入口的 `defaultRuntime` 完全相同；导入根入口的 `defaultRuntime` 仍在导入时创建。`ReactiveErrorPhase` 也可以从扩展入口导入，与根入口导出的是同一个对象。

```ts
import { getDefaultRuntime } from '@migaia/reactive/extension'
const runtime = getDefaultRuntime()
const node = runtime.signal(1)
runtime.batch(() => {
  node.value = 2
})
console.log(node.value)
node.dispose()
```

`@migaia/reactive/extension` 的 `deferRuntimeCleanup(runtime, task)` 通过该 Runtime 的 `scheduleIdle` 通道安排一次同步的适配层清理（默认使用微任务）。清理抛出的错误交给 Runtime 的 `reportError`。它不返回可修改的调度器或依赖图能力，也不负责异步资源。

```ts
import { createRuntime } from '@migaia/reactive'
import { deferRuntimeCleanup } from '@migaia/reactive/extension'
const idle: Array<() => void> = []
const runtime = createRuntime({
  scheduleIdle: (task) => {
    idle.push(task)
  }
})
let released = false
deferRuntimeCleanup(runtime, () => {
  released = true
})
console.log(released) // false
idle.shift()?.()
console.log(released) // true
```
