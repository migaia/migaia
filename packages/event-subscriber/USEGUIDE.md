# `@migaia/event-subscriber` 使用指南

本指南逐个模块覆盖公开运行时 API、直接配置所需的关键类型、边界行为与错误码。只服务于泛型推导的 type-only 投影类型以发布的 `.d.ts` 和编辑器提示为准；包的定位、适用/不适用场景与安装方式见 [README](./README.md)。

## 目录

- [Channel 模块](#channel-模块)：`createEventChannel`、`IEventChannel`、`IEventContext`、API style
- [订阅 Helper 模块](#helper-模块)：`subscribeOnce`、`subscribeUntil`、`subscribeSubscriber`
- [异步调用模块](#async-模块)：`invokeParallel`/`invokeParallelSettled`、`invokeSerial`/`invokeSerialSettled`、`invokeTask`/`invokeTaskSettled`
- [Hub 模块](#hub-模块)：`createEventHub`
- [订阅句柄](#订阅句柄)：`IEventChannelSubscription`、`IEventHubSubscription`
- [错误码](#错误码)：`EventSubscriberErrorCode`（16 个码）逐条语义
- [诊断消息](#诊断消息)：内部稳定文本与公开使用边界
- [状态常量](#状态常量)：`EventSubscriberState`
- [高阶组合示例](#高阶组合示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="channel-模块"></a>

## Channel 模块

```ts
import {
  createEventChannel,
  type ICanonicalEventChannel,
  type IEventChannel,
  type IEventChannelLike,
  type IEventChannelOptions,
  type IEventContext,
  type IEventListener,
  type IFilteredEventChannel,
  type IUnsubscribe
} from '@migaia/event-subscriber'
```

只有 root 导出，没有子路径导出，零 workspace 运行时依赖。

### `createEventChannel`

```ts
function createEventChannel<T, R = void>(
  options?: IEventChannelOptions<T>
): ICanonicalEventChannel<T, R>

type IEventChannelOptions<T> = {
  readonly report?: (failure: IEventReport<T>) => void | PromiseLike<void>
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
  readonly dispatchPolicy?: EventDispatchPolicy
  readonly style?: IEventApiStyle
}

type IEventApiStyleNames<
  TSubscribe extends string = string,
  TPublish extends string = string,
  TUnsubscribe extends string = string
> = {
  readonly subscribe: TSubscribe
  readonly publish: TPublish
  readonly unsubscribe?: TUnsubscribe
}

type IEventApiStyle =
  'subscribe-publish' | 'on-emit' | 'on-trigger' | 'listen-fire' | IEventApiStyleNames

declare function defineEventApiStyle<const S extends IEventApiStyleNames>(style: S): S

type IEventReport<T> = { readonly event: IEventContext<T>; readonly error: unknown }
```

创建一个事件 channel（O(1) 链表存储登记）：

```ts
const channel = createEventChannel<{ readonly text: string }>()
const unsubscribe = channel.subscribe((event) => console.log(event.value.text))
channel.publish({ text: 'ready' })
unsubscribe()
```

类型参数：`T`（payload 类型）、`R`（listener 结果类型，默认 `void`）。`options.report`：处理 `publish()` 之后**迟到**的 Promise/thenable rejection（同步 listener 失败不走这里，会在 `publish()` 遍历完成后聚合抛出）；`options.terminalReport`：`report` 缺失、抛错，或其返回的 thenable reject 时的兜底诊断出口；`report`/`terminalReport` 提供但不是函数抛 `INVALID_REPORTER`；`options` 本身不是普通对象（`null`/数组/非对象）抛 `INVALID_OPTIONS`。若 `report`/`terminalReport`（包括其返回的 Promise）都失败或缺失，最终会尝试 `runtime.reportError`（如全局 `reportError` 钩子）→ `console.error` → 排入下一个宏任务重新抛出，逐级降级，绝不静默吞掉。

`dispatchPolicy` 默认是 `EventDispatchPolicy.recursive`，保持 canonical channel 的同步 nested publish trace。需要当前 snapshot 完成后再交付重入值的消费者必须显式传入 `EventDispatchPolicy.queued`；该 opt-in 不改变其他消费者的默认行为。

`publishBudget` 默认 `100_000`，必须是正安全整数。它限制一次顶层同步发布事务内实际调用的 listener 总数（包括 nested publish 展开的调用）；预算耗尽时停止继续展开，并以 `PUBLISH_FAILED` 抛出且在 `error.detail` 中记录已处理数量，避免递归或重入发布无限占用线程。

`ICanonicalEventChannel<T, R>` 上的成员：

```ts
type IEventChannel<T, R = void> = {
  subscribe(
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IEventChannelSubscription<T, R>
  subscribeOnce(
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe
  subscribeUntil(
    signal: IEventAbortSignal,
    listener: IEventListener<T, R>,
    options?: { readonly taskId?: string }
  ): IUnsubscribe
  publish(value: T): void
  filterTaskId(taskId: string): IFilteredEventChannel<T, R>
  clear(): void
  readonly size: number
}
```

- `subscribe(listener, options?)` —— 登记一个 listener，返回可直接调用的[订阅句柄](#订阅句柄)（同时是 `unsubscribe` 函数、`.unsubscribe` 自身别名、可链式 `.subscribe()` 追加更多订阅）。`listener` 非函数抛 `INVALID_LISTENER`；`options.taskId` 提供但非非空字符串抛 `INVALID_TASK_ID`；`options` 本身不是普通对象抛 `INVALID_OPTIONS`。相同 listener 重复订阅会产生两份独立 registration（各自可单独退订）。
- `subscribeOnce`/`subscribeUntil` —— 与下方 [Helper 模块](#helper-模块)的同名独立函数语义完全一致，channel 上直接暴露方便链式调用。
- `publish(value)` —— 按注册顺序（快照）同步调用全部 listener，**不等待**返回的 Promise；默认同步重入 publish 递归交付，只有 `dispatchPolicy: EventDispatchPolicy.queued` 才会排队到当前快照完成后再交付。listener **同步抛出**的错误会被收集并以携带 `PUBLISH_FAILED` 码的 `AggregateError` 抛出；listener 返回的 thenable **迟到 reject**（即在 `publish()` 同步返回之后才拒绝）会转发给 `options.report`（见上），不计入 `publish()` 本身抛出的错误。
- `filterTaskId(taskId)` —— 创建一个只读的 task 选择 view（`IFilteredEventChannel`），交给[异步发布](#async-模块) helper 使用；`taskId` 必须是非空字符串，否则抛 `INVALID_TASK_ID`。
- `clear()` —— 清空全部 registration，**不**执行 listener 自身的 cleanup（listener 本身没有 dispose 概念，只是不再被调用）。
- `size: number`（只读）—— 当前 active registration 数量。

### API style

style 是构造阶段的一次性命名投影。四个 preset 映射如下：

`EventApiStyle` 导出这四个稳定 preset 值；配置、持久化或跨模块比较时优先引用 `EventApiStyle.onTrigger` 等常量成员，不要散写字符串。直接在对象字面量中传字符串仍受同一校验。

| preset              | subscribe alias | publish alias | cancellation alias |
| ------------------- | --------------- | ------------- | ------------------ |
| `subscribe-publish` | `subscribe`     | `publish`     | `unsubscribe`      |
| `on-emit`           | `on`            | `emit`        | `off`              |
| `on-trigger`        | `on`            | `trigger`     | `off`              |
| `listen-fire`       | `listen`        | `fire`        | `unlisten`         |

自定义对象的方向固定为 `{ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' }`，其中 `unsubscribe` 可省略并回退为 canonical `unsubscribe`。Channel 泛型顺序是 `<T, R, S>`，Hub 是 `<C, S>`；显式提供 payload/event map 后，custom style 必须显式提供对应的 `S`，不会依赖 partial generic inference。预声明对象推荐 `defineEventApiStyle()`，也可以使用 TypeScript 的 `as const`；widened 为普通 `string` 的对象不会产生任意字符串 index signature，因此不能据此声称存在精确 alias。

```ts
const events = createEventChannel<number>({ style: 'on-trigger' })
events.on((event) => console.log(event.value))
events.trigger(1)

const style = defineEventApiStyle({
  subscribe: 'observe',
  publish: 'dispatch',
  unsubscribe: 'dispose'
})
const custom = createEventChannel<number, void, typeof style>({ style })
const customHandle = custom.observe((event) => console.log(event.value))
custom.dispatch(1)
customHandle.dispose()
```

例如，`createEventChannel<number>({ style: { subscribe: 'observe', publish: 'dispatch' } })` 会被 TypeScript 拒绝；请写成 `createEventChannel<number, void, typeof style>({ style })`，或直接在第三个泛型中给出 custom style。Hub 同理使用第二个泛型。

canonical `subscribe`、`publish`、helpers、subscription handle、`unsubscribe`、`clear` 和 `size` 永远保留。handle 的 subscribe alias 返回同一 handle，cancellation alias 与 handle 自身同一引用；所有 alias 都是不可枚举、不可写、不可配置 own data property。它不会改变 listener 顺序、重入、错误、taskId 或生命周期。非法 style（空名、重复名、跨语义/保留名、非字符串或未知 preset）在构造时抛 `INVALID_OPTIONS`，getter 抛出的原始对象保留在 `cause`。

### `IEventContext<T>`

```ts
type IEventContext<T> = {
  readonly value: T
  readonly aborted: boolean
  readonly abortReason: unknown
  readonly taskId: string | undefined
  abort(reason?: unknown): void
  setTaskId(taskId: string | undefined): void
}
```

每次调用 listener 时传入的活对象：`value` 是本次发布的 payload；`aborted`/`abortReason` 是该 registration 的活状态；`abort(reason?)` 撤销当前 registration 并令其退订（幂等，对已非活跃的 registration 调用是空操作）；`setTaskId(taskId)` 修改该 registration 的 task 标签，**只影响之后的快照**（当前正在进行的这次 `publish()` 已经取好的快照不受影响）。

---

<a id="helper-模块"></a>

## 订阅 Helper 模块

```ts
import {
  subscribeOnce,
  subscribeUntil,
  subscribeSubscriber,
  type IEventSubscriber
} from '@migaia/event-subscriber'
```

这三个 helper 只需要结构化 `IEventChannelLike<T, R>`（有 `subscribe(listener, options?)` 方法即可），因此也能用于兼容结构的第三方 channel，不要求是 `createEventChannel()` 产出的实例。

### `subscribeOnce`

```ts
function subscribeOnce<T, R>(
  channel: IEventChannelLike<T, R>,
  listener: IEventListener<T, R>,
  options?: { readonly taskId?: string }
): IUnsubscribe
```

只执行一次，调用 listener **之前**先退订：

```ts
subscribeOnce(channel, (event) => console.log('only once', event.value))
```

`channel`、`listener` 均必填；`options.taskId` 可选。因为退订发生在调用 listener 之前，listener 内的同步重入、`throw`、返回 rejected Promise 都不会导致第二次执行。若传入的 `channel` 不满足结构契约（无 `subscribe` 方法、或 `subscribe()` 同步交付了一个不返回函数的取消句柄）抛 `INVALID_CHANNEL`；返回值 `IUnsubscribe` 可重复调用，幂等。

### `subscribeUntil`

```ts
function subscribeUntil<T, R>(
  channel: IEventChannelLike<T, R>,
  signal: IEventAbortSignal,
  listener: IEventListener<T, R>,
  options?: { readonly taskId?: string }
): IUnsubscribe

type IEventAbortSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}
```

`signal` 中止时自动退订：

```ts
const controller = new AbortController()
subscribeUntil(channel, controller.signal, (event) => consume(event.value))
controller.abort('owner closed')
```

`channel`、`signal`、`listener` 均必填；`options.taskId` 可选。`signal` 结构上兼容标准 `AbortSignal`（原生 `AbortSignal` 可直接传入）。已 `aborted` 的 `signal` 直接返回 no-op unsubscribe，不创建任何 registration。`abort()` 只撤销 registration，**不会中断已经开始执行**的 listener。`signal` 不满足结构契约（缺 `addEventListener`/`removeEventListener`，或 `aborted` 不是布尔值）抛 `INVALID_SIGNAL`；`listener` 非函数抛 `INVALID_LISTENER`。返回的 `IUnsubscribe` 可重复调用，幂等。

### `subscribeSubscriber`

```ts
function subscribeSubscriber<T, R>(
  channel: IEventChannelLike<T, R>,
  subscriber: IEventSubscriber<T, R>
): IUnsubscribe

type IEventSubscriber<T, R = void> = { handle(event: IEventContext<T>): R | PromiseLike<R> }
```

用对象而非函数订阅，保留 `this`：

```ts
class Counter implements IEventSubscriber<number> {
  total = 0
  handle(event: { readonly value: number }) {
    this.total += event.value
  }
}
subscribeSubscriber(channel, new Counter())
```

`channel`、`subscriber` 均必填，`subscriber` 必须是携带可调用 `handle` 方法的对象。`subscriber` 非对象或缺少可调用 `handle` 抛 `INVALID_SUBSCRIBER`。返回 `IUnsubscribe`。

---

<a id="async-模块"></a>

## 异步发布模块

```ts
import {
  invokeParallel,
  invokeParallelSettled,
  invokeSerial,
  invokeSerialSettled,
  invokeTask,
  invokeTaskSettled,
  withSnapshotEntries,
  type IListenerResult
} from '@migaia/event-subscriber'
```

均只接受由 `createEventChannel()` 产出的 canonical channel 或其 `filterTaskId()` view（内部通过 `WeakMap` 校验运行时身份）——伪造对象或另一份物理包副本创建的 channel 会得到 `INVALID_CHANNEL`。

```ts
type IListenerResult<R> =
  | { readonly status: 'fulfilled'; readonly value: Awaited<R> }
  | { readonly status: 'rejected'; readonly reason: unknown }
```

### `withSnapshotEntries`

高级集成入口：读取一次不可变 listener 快照并把 `IEventInvocation[]` 交给 visitor。每个 invocation 的 `invoke()` 最多调用一次；visitor 同步返回或返回的 Promise settle 后，所有 invocation 都会关闭，再次调用抛 `INVOCATION_CLOSED`。visitor 抛出或 reject 时原错误原样传播，同时仍会关闭全部 invocation。普通并行、串行或按 task 调用应优先使用下方 `invoke*` helper。

### `invokeEachLive`

更底层的同步遍历入口：在本次访问期间新追加的订阅者也可被当前访问看到，每个注册最多访问一次；visitor 必须同步完成。即使 visitor 抛错，内部遍历状态也会释放，原错误保持身份向上抛出。该 API 只适合需要 append-live 语义的框架集成；普通发布必须优先使用快照型 `invoke*` helper，避免一次发布的目标集合随回调副作用变化。

### `invokeParallelSettled` / `invokeParallel`

```ts
function invokeParallelSettled<T, R>(
  channel: ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>,
  value: T
): Promise<readonly IListenerResult<R>[]>
function invokeParallel<T, R>(
  channel: ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>,
  value: T
): Promise<readonly Awaited<R>[]>
```

`invokeParallelSettled`：全部 listener **立即启动**，等待全部 settle，从不 reject：

```ts
const results = await invokeParallelSettled(channel, payload)
// [{ status: 'fulfilled', value }, { status: 'rejected', reason }, ...]
```

结果按注册顺序排列，不按完成时间排序。`invokeParallel` 语义相同，但任一失败时整体以携带 `PUBLISH_FAILED` 码的 `AggregateError` reject（仍会等待全部目标执行完，不会提前放弃未完成的 listener）。目标快照在任何异步等待开始**之前**同步取好，保证与其它 helper 一致的"选择先于执行"语义。

### `invokeSerialSettled` / `invokeSerial`

```ts
function invokeSerialSettled<T, R>(
  channel: ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>,
  value: T
): Promise<readonly IListenerResult<R>[]>
function invokeSerial<T, R>(
  channel: ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>,
  value: T
): Promise<readonly Awaited<R>[]>
```

`invokeSerialSettled`：前一个 listener settle 后才启动下一个：

```ts
const results = await invokeSerialSettled(channel, payload)
```

注意：**不是 waterfall**——每个 listener 收到的都是同一个 `payload`，前一个的返回值不会传给下一个；需要值变换见 `@migaia/middleware-pipeline`。`invokeSerial` 是它的 throwing 版本，语义与 `invokeParallel` 对 `invokeParallelSettled` 的关系相同。

### `invokeTaskSettled` / `invokeTask`

```ts
function invokeTaskSettled<T, R>(
  channel: ICanonicalEventChannel<T, R>,
  taskId: string,
  value: T
): Promise<IListenerResult<R>>
function invokeTask<T, R>(
  channel: ICanonicalEventChannel<T, R>,
  taskId: string,
  value: T
): Promise<Awaited<R>>
```

精确选择唯一一个 `taskId` 并等待其结算，不调用 `report`：

```ts
const result = await invokeTaskSettled(tasks, 'email', job)
```

入口快照匹配数为 0 时**同步**抛 `TASK_NOT_FOUND`；匹配数大于 1 时**同步**抛 `TASK_NOT_UNIQUE`（错误对象携带可枚举的 `taskId`/`matchCount` 字段）；选择动作发生在任何 listener 调用之前。`invokeTask` 是 throwing 版本：listener 失败时以携带 `PUBLISH_FAILED` 码的 `AggregateError`（内含单个原始失败）reject。

---

<a id="hub-模块"></a>

## Hub 模块

```ts
import {
  createEventHub,
  type IEventHub,
  type IEventHubOptions,
  type IEventMap,
  type IEventHubReport
} from '@migaia/event-subscriber'
```

### `createEventHub`

```ts
function createEventHub<C extends IEventMap>(options?: IEventHubOptions<C>): IEventHub<C>

type IEventMap = object // 事件名到 payload 类型的映射
type IEventHubOptions<C extends IEventMap> = {
  readonly report?: (failure: IEventHubReport<C>) => void | PromiseLike<void>
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>
}
type IEventHubReport<C extends IEventMap> = {
  [K in keyof C]: { readonly key: K; readonly event: IEventContext<C[K]>; readonly error: unknown }
}[keyof C]
```

多事件类型的按 key 懒创建路由（每个 key 首次被 `subscribe()`/`publish()` 时才内部创建一个 canonical channel）：

```ts
type IEvents = { ready: { readonly at: number }; warning: { readonly message: string } }
const hub = createEventHub<IEvents>()
const stop = hub.subscribe('warning', (event) => console.warn(event.value.message))
hub.publish('warning', { message: 'cache is stale' })
```

`options.report`：失败对象额外携带 `key`（标识来自哪个事件类型）；`options.terminalReport`：同 Channel 模块的兜底诊断出口。校验规则与 `createEventChannel` 一致（`INVALID_OPTIONS`/`INVALID_REPORTER`）。

`IEventHub<C>` 上的方法：

```ts
type IEventHub<C extends IEventMap> = {
  subscribe<K extends keyof C>(key: K, listener: IEventListener<C[K]>): IEventHubSubscription<C, K>
  publish<K extends keyof C>(key: K, value: C[K]): void
  clear(key?: keyof C): void
  size(key?: keyof C): number
}
```

`createEventHub<IEvents>({ style: 'on-emit' })` 同样提供 `hub.on` 与 `hub.emit`。它们分别与 `hub.subscribe`、`hub.publish` 同引用；key/payload 推导、lazy channel、registration accounting、stale unsubscribe 和 clear 语义仍由 canonical Hub owner 执行。自定义 Hub style 的泛型形状与 Channel 相同。

- `subscribe(key, listener)` —— `key` 必须是 `string`/`number`/`symbol`（否则抛 `INVALID_EVENT_KEY`），`listener` 必须是函数（否则抛 `INVALID_LISTENER`）。返回值同样是可链式扩展的[订阅句柄](#订阅句柄)。**Hub listener 返回类型固定为 `void`/`PromiseLike<void>`，不做 async 结果聚合**；需要结果时应为该事件单独用 `createEventChannel<T, R>()` 创建带 `R` 的 channel。
- `publish(key, value)` —— 该 `key` 尚未创建过 channel（从未被订阅过）时是 no-op，不会报错。
- `clear(key?)` —— 传 `key` 只清该 key 下的全部 registration（并移除该 key 对应的空 channel）；不传清空全部 key。
- `size(key?)` —— 传 `key` 返回该 key 当前的 registration 数（未创建过返回 `0`）；不传返回全部 key 的 registration 总数（内部 O(1) 维护的计数器，不遍历）。

---

<a id="订阅句柄"></a>

## 订阅句柄

```ts
import type { IEventChannelSubscription, IEventHubSubscription } from '@migaia/event-subscriber'
```

`channel.subscribe()`/`hub.subscribe()` 返回的都是一个**可直接调用**的函数，同时携带链式扩展能力：

```ts
const channelHandle = channel.subscribe(onReady)
channelHandle.subscribe(onWarning, { taskId: 'audit' })
channelHandle.unsubscribe() // same function identity; releases whole chain

const styledHandle = styledChannel.on(onReady).on(onWarning)
styledHandle.on === styledHandle.subscribe // true
styledHandle.off === styledHandle.unsubscribe // true
styledHandle.off() // releases the whole styled chain

const hubHandle = hub.subscribe('ready', onReady)
// 有限字面量 key map 在同一条链上禁止重复 key；要用同一个 key 订阅两次，另起一个新的 hub.subscribe()
hubHandle.subscribe('warning', onWarning)

const maybeKey: keyof IEvents = getRuntimeKey()
const dynamicHandle = hub.subscribe(maybeKey, onReady)
dynamicHandle.subscribe(maybeKey, onReady) // key 类型被拓宽为运行时值：允许同 key fan-out，编译期不做重复声明检查

const owned = channel.subscribe(onReady)
try {
  owned.subscribe(getPossiblyInvalidListener())
} catch {
  owned.unsubscribe() // 链式扩展不是事务性的：扩展失败，之前已经注册成功的那一条仍然有效、仍归 owned 所有
}
```

`IEventChannelSubscription<T, R>`/`IEventHubSubscription<C, UsedKeys>` 是公开的 channel/hub 句柄形态。有限字面量 map 的同一 chain 会在类型层排除已用 key；`Record<string, Payload>` 等宽 key 无法静态区分运行时字符串，因此同 key 继续合法并保持 fan-out。

For hub chains, finite literal maps reject a repeated key on this chain; a widened key: runtime fan-out remains valid. Chain extension is non-transactional; earlier registration stays owned by the handle if a later extension fails.

行为要点：

- 调用 handle 本身（或其 `.unsubscribe`）会按**逆序**释放整条链上通过 `.subscribe()` 追加的全部订阅，然后释放最初那一个；整个链条只会真正执行一次（幂等，二次调用是空操作）。
- 链已关闭（已调用过 `unsubscribe`）后再调用 `.subscribe()` 追加新订阅，抛 `SUBSCRIPTION_CLOSED`。
- `handle.unsubscribe` 是只读属性（`writable: false, configurable: false`），值就是 `handle` 自身，可读性别名而非另一个函数。
- styled handle 的 subscribe alias（如 `.on`/`.observe`）与 `.subscribe` 同引用；cancellation alias（如 `.off`/`.dispose`/`.unlisten`）与 handle 自身同引用，均为不可枚举、不可写、不可配置属性。

```ts
const handle = channel.subscribe(onReady).subscribe(onWarning, { taskId: 'audit' })
handle() // 或 handle.unsubscribe()：逆序退订 onWarning、再退订 onReady
handle.subscribe(onOther) // 抛 SUBSCRIPTION_CLOSED，链已关闭
```

---

<a id="错误码"></a>

## 错误码

```ts
import {
  EventSubscriberErrorCode,
  EVENT_SUBSCRIBER_SOURCE,
  type IEventSubscriberErrorCode
} from '@migaia/event-subscriber'
```

稳定错误码表，**16 个码**，唯一声明处 `src/error-code.ts`，`source` 恒为 `EVENT_SUBSCRIBER_SOURCE`（值 `'@migaia/event-subscriber'`）。所有包边界错误都携带 `source`/`code` 两个附加字段，不替换原生错误类型（输入校验错误是 `TypeError`，发布聚合错误是 `AggregateError`）；`AggregateError.errors[0]` 与 `cause` 恒为触发失败的原始错误。

| `EventSubscriberErrorCode` 键        | 码值                                    | 触发条件                                                                                                                                                 |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalidListener`                    | `INVALID_LISTENER`                      | 传入的 listener 不是函数                                                                                                                                 |
| `invalidReporter`                    | `INVALID_REPORTER`                      | `report`/`terminalReport` 提供了但不是函数                                                                                                               |
| `invalidChannel`                     | `INVALID_CHANNEL`                       | Helper 收到结构非法或非 canonical 的 channel（缺 `subscribe`，或异步发布 helper 收到非 `createEventChannel()` 产出的对象）                               |
| `invalidSignal`                      | `INVALID_SIGNAL`                        | `subscribeUntil` 的 `signal` 结构非法，或其 abort 回调/清理过程本身失败                                                                                  |
| `invalidSubscriber`                  | `INVALID_SUBSCRIBER`                    | `subscribeSubscriber` 收到的对象缺少可调用的 `handle()`                                                                                                  |
| `invalidEventKey`                    | `INVALID_EVENT_KEY`                     | Hub 的 `key` 不是 `string`/`number`/`symbol`                                                                                                             |
| `taskNotFound`                       | `TASK_NOT_FOUND`                        | `invokeTask`/`invokeTaskSettled` 按 `taskId` 精确选择时匹配到 0 个 registration                                                                          |
| `taskNotUnique`                      | `TASK_NOT_UNIQUE`                       | 同上，匹配到多于 1 个 registration（错误携带 `taskId`/`matchCount`）                                                                                     |
| `invalidTaskId`                      | `INVALID_TASK_ID`                       | 传入的 `taskId` 为空或不是字符串                                                                                                                         |
| `invalidOptions`                     | `INVALID_OPTIONS`                       | 公开 options 对象或字段结构非法                                                                                                                          |
| `publishFailed`                      | `PUBLISH_FAILED`                        | 完整目标快照处理完毕后，一个或多个 listener 失败（`publish()`/`invokeParallel`/`invokeSerial`/`invokeTask` 的抛出通道）                                  |
| `valueProjectionFailed`              | `VALUE_PROJECTION_FAILED`               | listener 的 value alias 路径缺失、被阻断或 getter 抛错                                                                                                  |
| `unhandledListenerFailure`           | `UNHANDLED_LISTENER_FAILURE`            | fire-and-forget 的迟到 listener 失败在 `report` 处理失败或缺失后，到达终端诊断通道                                                                       |
| `subscriptionClosed`                 | `SUBSCRIPTION_CLOSED`                   | 订阅句柄链已关闭后又调用其 `.subscribe()` 追加新订阅                                                                                                     |
| `subscriptionHandleProjectionFailed` | `SUBSCRIPTION_HANDLE_PROJECTION_FAILED` | handle alias descriptor projection fails after registration; the first registration is rolled back and the original projection failure remains reachable |
| `invocationClosed`                   | `INVOCATION_CLOSED`                     | 已完成或已调用过的捕获 invocation 被再次调用                                                                                                             |

调用方应始终以 `error.code === EventSubscriberErrorCode.xxx` 判别，不要硬编码码值字符串。

---

<a id="诊断消息"></a>

## 诊断消息

`EventSubscriberErrorText` 是包内维护错误文案的唯一来源，但**不是公开导出**，业务代码不能从 `@migaia/event-subscriber` 导入它。生产代码应按上方公开的 `error.source` 与 `error.code` 分支；测试若要锁定面向用户的文案，可以直接断言实际抛出错误的 `message`，不要依赖内部源码路径。

内部文本与 16 个错误码一一对应：`invalidListener`、`invalidReporter`、`invalidChannel`、`invalidSignal`、`invalidSubscriber`、`invalidEventKey`、`taskNotFound`、`taskNotUnique`、`invalidTaskId`、`invalidOptions`、`publishFailed`、`valueProjectionFailed`、`unhandledListenerFailure`、`subscriptionClosed`、`subscriptionHandleProjectionFailed`、`invocationClosed`。

---

<a id="状态常量"></a>

## 状态常量

```ts
import { EventSubscriberState } from '@migaia/event-subscriber'
```

协议常量，无调用参数：

```ts
EventSubscriberState.abort // 'abort' —— IEventAbortSignal 的事件类型
EventSubscriberState.fulfilled // 'fulfilled' —— IListenerResult 的状态判别值
EventSubscriberState.rejected // 'rejected'
```

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 按 `taskId` 定向到唯一订阅者并等待结果

```ts
import { createEventChannel, invokeTask } from '@migaia/event-subscriber'

const jobs = createEventChannel<string, string>()
jobs.subscribe((event) => `email:${event.value}`, { taskId: 'email' })
jobs.subscribe((event) => `audit:${event.value}`, { taskId: 'audit' })

const emailResult = await invokeTask(jobs, 'email', 'created')
```

### 2. 并行结算 + 集中上报未处理的迟到失败

```ts
import { createEventChannel, invokeParallelSettled } from '@migaia/event-subscriber'

const checks = createEventChannel<string, boolean>({
  terminalReport: (diagnostic) => emergencySink.capture(diagnostic)
})
checks.subscribe(async (event) => event.value.length > 0)
checks.subscribe(async (event) => event.value.startsWith('usr_'))

const results = await invokeParallelSettled(checks, 'usr_42')
```

### 3. `subscribeUntil` + `AbortController` 管理订阅生命周期

```ts
import { createEventChannel, subscribeUntil } from '@migaia/event-subscriber'

const controller = new AbortController()
const channel = createEventChannel<number>()
subscribeUntil(channel, controller.signal, (event) => consume(event.value))
// 组件卸载 / 请求结束时统一中止
controller.abort('scope closed')
```

### 4. 用 Hub 统一路由多种事件并集中上报

```ts
import { createEventHub } from '@migaia/event-subscriber'

type IAppEvents = { ready: { readonly at: number }; warning: { readonly message: string } }

const events = createEventHub<IAppEvents>({
  report: ({ key, event, error }) => monitoring.capture(error, { key, payload: event.value })
})

events.subscribe('warning', (event) => console.warn(event.value.message))
events.publish('warning', { message: 'cache is stale' })
```

### 5. 对象订阅者 + 串行结算，保证副作用按序执行

```ts
import { createEventChannel, subscribeSubscriber, invokeSerial } from '@migaia/event-subscriber'

const pipeline = createEventChannel<string, void>()
subscribeSubscriber(pipeline, {
  handle: async (event) => writeAuditLog(event.value)
})
subscribeSubscriber(pipeline, {
  handle: async (event) => notifyDownstream(event.value)
})

await invokeSerial(pipeline, 'order-created')
```

### 6. 静态 value path alias

`createEventChannel` 的第四泛型 `V`、`createEventHub` 的第三泛型 `V` 表示静态 `valueConfig`。调用方应使用 `as const` 或显式 `V` 保留 literal path 与 alias；alias 没有 `resource` 等保留名称，只需避开 context 成员和危险 prototype key。

```ts
type IEvent = { readonly data: { readonly id: number } }
const valueConfig = { readPath: 'data.id', alias: 'resource' } as const
const channel = createEventChannel<IEvent, void, undefined, typeof valueConfig>({ valueConfig })
channel.subscribe((event) => {
  event.value // 原始 published value
  event.resource // number | undefined
  event.abort() // 原有 context controls 保留
})
```

每次 publish/invoke 对 active path 只 probe 一次，所有目标 context 都取得同一 projected identity；alias 是 enumerable、non-writable、non-configurable own data property。空字符串或 trim 后为空的 `readPath` 静默禁用 projection，不读取 alias、不 parse、不 probe、不 report。missing、blocked 和 getter failure 会进入既有 report/terminal 链并携带 `VALUE_PROJECTION_FAILED`；listener 仍调用且 alias 为 `undefined`，但存在的 `undefined` leaf 是成功。函数 selector、transform、operator、fallback 与 lazy per-listener projection 不属于本版契约。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **`publish()`/`invokeParallel`/`invokeSerial`/`invokeTask` 抛 `PUBLISH_FAILED`**：一个或多个 listener 失败；展开 `error.errors` 逐条处理原始失败原因，`error.cause` 恒为其中第一个。
- **迟到的 Promise rejection 没有触发 `PUBLISH_FAILED`**：符合预期——`publish()` 只同步收集 listener 的同步抛出；listener 返回的 thenable 在 `publish()` 返回之后才 reject 属于"迟到失败"，走 `options.report`/`terminalReport` 通道，不会让 `publish()` 反过来变成异步的。
- **`invokeTask`/`invokeTaskSettled` 抛 `TASK_NOT_FOUND`/`TASK_NOT_UNIQUE`**：目标 `taskId` 在选择那一刻没有恰好一个匹配的 registration；检查该 `taskId` 是否已退订，或是否有多个 listener 意外使用了同一个 `taskId`。
- **`subscribeOnce`/`subscribeUntil`/`subscribeSubscriber` 抛 `INVALID_CHANNEL`**：传入的 channel 不满足结构契约，或异步发布 helper 收到了非 `createEventChannel()` 产出（或跨包物理副本）的对象；确认使用同一份包实例创建的 channel。
- **订阅句柄 `.subscribe()` 抛 `SUBSCRIPTION_CLOSED`**：该链已经调用过 `unsubscribe()`；关闭后的链不可再扩展，需要新建订阅。
- **需要保存当前值、replay、跨 Worker/网络传输**：`@migaia/event-subscriber` 刻意不提供，应分别参考 `@migaia/reactive`（响应式状态）、`@migaia/middleware-pipeline`（waterfall/`next()`/短路）、`@migaia/lifecycle`/`@migaia/resource`（资源生命周期宿主）、`@migaia/web-rpc`（跨进程传输）。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
