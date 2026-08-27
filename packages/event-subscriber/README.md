# `@migaia/event-subscriber`

轻量、runtime-neutral 的 transient event fan-out 原语：登记 listener，在发布入口取得稳定快照，把同一个事件可靠地分发给目标 listener。零运行时依赖，`sideEffects: false`。

## 适用与不适用场景

**适用**：本地、瞬时的事件订阅/广播——不需要保存当前值、不需要 replay、不需要跨 Worker/网络传输。典型场景：模块间解耦通知、按 `taskId` 定向到某个订阅者并等待其结果、把多个异步 listener 的执行编排成并行/串行结算。

**不适用**：不要把它当作响应式状态（当前值、派生、依赖图见 `@migaia/reactive`）、中间件管道（waterfall/`next()`/短路见 `@migaia/middleware-pipeline`）、资源生命周期宿主（`dispose()`/队列/背压见 `@migaia/lifecycle`/`@migaia/resource`）或跨进程传输（Worker/iframe/网络见 `@migaia/web-rpc`）。

## 安装

```bash
pnpm add @migaia/event-subscriber
```

只有 root 导出，没有子路径导出，零 workspace 运行时依赖。

## 目录

- [Channel：创建与订阅](#channel-模块)
- [订阅 Helper：`subscribeOnce` / `subscribeUntil` / `subscribeSubscriber`](#helper-模块)
- [异步发布：`publishParallel` 等](#async-模块)
- [Event Hub：多事件类型路由](#hub-模块)
- [常量与错误](#错误模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为、快照语义与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="channel-模块"></a>

## Channel 模块

```ts
import {
  createEventChannel,
  type IEventChannel,
  type IEventContext
} from '@migaia/event-subscriber'
```

**`createEventChannel`｜5 秒上手** —— 创建一个事件 channel：

```ts
const channel = createEventChannel<{ readonly text: string }>()
const unsubscribe = channel.subscribe((event) => console.log(event.value.text))
channel.publish({ text: 'ready' })
unsubscribe()
```

类型参数：`T`（payload 类型）、`R`（listener 结果类型，默认 `void`）。第一参数 `options?: IEventChannelOptions<T>` 全部字段：

- `report?: (failure: IEventReport<T>) => void | PromiseLike<void>` —— 处理 `publish()` 之后迟到的 Promise/thenable rejection（同步 listener 失败不走这里，见下）
- `terminalReport?: (error: unknown) => void | PromiseLike<void>` —— `report` 缺失/失败时的兜底诊断出口
- `dispatchPolicy?: EventDispatchPolicy` —— `recursive`（默认）保持 canonical nested publish 的同步递归顺序；只有需要“当前快照全部完成后再交付重入值”的消费者才显式使用 `queued`

返回的 `channel` 上的方法与字段：

- `subscribe(listener, options?: { taskId?: string }): subscription` —— 返回可直接调用的 handle；handle 同时提供 `unsubscribe` 自身别名与链式 `subscribe`。解除会按逆序释放整条 chain；关闭后再扩展抛 `SUBSCRIPTION_CLOSED`。
- `subscribeOnce` / `subscribeUntil`（见下方 Helper 模块，channel 上也直接暴露同名方法）
- `publish(value: T): void` —— 按快照顺序同步调用全部 listener，不等待 Promise；默认同步重入 publish 递归交付，`dispatchPolicy: 'queued'` 才会排队到当前快照完成后再交付；同步失败以 `PUBLISH_FAILED` 的 `AggregateError` 抛出
- `filterTaskId(taskId: string): IFilteredEventChannel<T, R>` —— 创建只读 task 选择 view，交给异步发布 helper
- `clear(): void` —— 清空全部 registration，不执行 listener 自身的 cleanup
- `size: number`（只读）—— 当前 active registration 数量

`event.value` 是本次发布的 payload；`event.aborted`/`event.abortReason` 是活的状态；`event.abort(reason?)` 撤销当前 registration 并令其退订；`event.setTaskId(taskId)` 修改仅影响之后的快照。`unsubscribe()` 同步、幂等；相同 listener 重复订阅会产生两份独立 registration。

### 可选 API 命名风格

命名风格只是 canonical `subscribe`/`publish` 的方法名投影，不会创建新的 dispatcher、listener registry 或调度语义。canonical 方法始终保留，alias 与 canonical 方法是同一函数引用；默认不增加 own key，非默认 alias 为不可枚举、不可写、不可配置的数据属性。

```ts
const events = createEventChannel<number>({ style: 'on-emit' })
const stop = events.on((event) => console.log(event.value))
events.emit(1)
stop()
```

内置 preset：`subscribe-publish`（默认）、`on-emit`、`on-trigger`、`listen-fire`。自定义 style 使用语义到名称的对象映射；预声明变量可用 `defineEventApiStyle()` 保留字面量：

```ts
const style = defineEventApiStyle({ subscribe: 'observe', publish: 'dispatch' })
const events = createEventChannel<number, void, typeof style>({ style })
events.observe((event) => console.log(event.value))
events.dispatch(1)
```

Channel 的泛型顺序是 `<T, R, S>`，其中 `S` 是 custom style；因此显式指定 `T` 时，内联 custom style 必须显式提供第三个泛型。`createEventChannel<number>({ style: { subscribe: 'observe', publish: 'dispatch' } })` 不会声称推导出精确 alias。Hub 的顺序是 `<C, S>`。

style 不提供 `flush`、queue、drain 或 backpressure 语义。名称必须非空、互不相同，且不能覆盖另一语义、`subscribeOnce`、`subscribeUntil`、`filterTaskId`、`clear`、`size` 或原型危险成员；违规输入在构造期间以 `INVALID_OPTIONS` 拒绝。

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

这三个 helper 只需要结构化 `IEventChannelLike<T, R>`（有 `subscribe(listener, options?)` 方法即可），因此也能用于兼容结构的第三方 channel。

**`subscribeOnce`｜5 秒上手** —— 只执行一次，调用 listener **之前**先退订：

```ts
subscribeOnce(channel, (event) => console.log('only once', event.value))
```

参数：`channel: IEventChannelLike<T, R>`（必填）、`listener: IEventListener<T, R>`（必填）、`options?: { taskId?: string }`（可选）。返回 `IUnsubscribe`。因为退订在调用前完成，listener 内的同步重入、throw、rejected Promise 都不会导致第二次执行。

**`subscribeUntil`｜10 秒上手** —— signal 中止时自动退订：

```ts
const controller = new AbortController()
subscribeUntil(channel, controller.signal, (event) => consume(event.value))
controller.abort('owner closed')
```

参数：`channel`（必填）、`signal: IEventAbortSignal`（必填，结构上兼容标准 `AbortSignal`）、`listener`（必填）、`options?: { taskId?: string }`（可选）。返回 `IUnsubscribe`（可重复调用，幂等）。已 `aborted` 的 signal 直接返回 no-op unsubscribe，不创建 registration。`abort()` 只撤销 registration，不会中断已经开始执行的 listener。

**`subscribeSubscriber`｜5 秒上手** —— 用对象而非函数订阅，保留 `this`：

```ts
class Counter implements IEventSubscriber<number> {
  total = 0
  handle(event: { readonly value: number }) {
    this.total += event.value
  }
}
subscribeSubscriber(channel, new Counter())
```

参数：`channel: IEventChannelLike<T, R>`（必填）、`subscriber: { handle(event): R | PromiseLike<R> }`（必填，必须实现 `handle`）。返回 `IUnsubscribe`。`subscriber` 非对象或缺少可调用 `handle` 抛 `INVALID_SUBSCRIBER`。

---

<a id="async-模块"></a>

## 异步发布模块

```ts
import {
  publishParallel,
  publishParallelSettled,
  publishSerial,
  publishSerialSettled,
  publishTask,
  publishTaskSettled,
  type IListenerResult
} from '@migaia/event-subscriber'
```

均只接受由 `createEventChannel()` 产出的 canonical channel 或其 `filterTaskId()` view——伪造对象或另一份物理包副本创建的 channel 会得到 `INVALID_CHANNEL`。

**`publishParallelSettled`｜5 秒上手** —— 全部 listener 立即启动，等待全部 settle，从不 reject：

```ts
const results = await publishParallelSettled(channel, payload)
// [{ status: 'fulfilled', value }, { status: 'rejected', reason }, ...]
```

参数：`channel: ICanonicalEventChannel<T, R> | IFilteredEventChannel<T, R>`（必填）、`value: T`（必填），无选项。结果按注册顺序排列，不按完成时间排序。

**`publishParallel`｜3 秒上手** —— 同上，但任一失败时整体以 `PUBLISH_FAILED` 的 `AggregateError` reject（仍会等待全部目标执行完）：

```ts
const values = await publishParallel(channel, payload) // Awaited<R>[]
```

**`publishSerialSettled`｜5 秒上手** —— 前一个 listener settle 后才启动下一个，settled 结果数组：

```ts
const results = await publishSerialSettled(channel, payload)
```

参数同 `publishParallelSettled`。注意：不是 waterfall——每个 listener 收到同一个 `payload`，前一个的返回值不会传给下一个；需要值变换见 `@migaia/middleware-pipeline`。

**`publishSerial`｜3 秒上手** —— 串行 + throwing 版本：

```ts
const values = await publishSerial(channel, payload)
```

**`publishTaskSettled`｜10 秒上手** —— 精确选择唯一一个 `taskId` 并等待其结算，不调用 reporter：

```ts
const result = await publishTaskSettled(tasks, 'email', job)
```

参数：`channel: ICanonicalEventChannel<T, R>`（必填）、`taskId: string`（必填）、`value: T`（必填），无选项。入口快照匹配数为 0 时同步抛 `TASK_NOT_FOUND`；多个时同步抛 `TASK_NOT_UNIQUE`（错误对象携带可枚举的 `taskId`/`matchCount`），选择动作发生在任何 listener 调用之前。

**`publishTask`｜3 秒上手** —— 同上，但 listener 失败时以 `PUBLISH_FAILED` reject：

```ts
const value = await publishTask(tasks, 'email', job) // Awaited<R>
```

`IListenerResult<R>` 类型：`{ status: 'fulfilled', value: Awaited<R> } | { status: 'rejected', reason: unknown }`。

---

<a id="hub-模块"></a>

## Hub 模块

动态 key 允许运行时 fan-out；finite key 链禁止重复 key，Hub handle 可直接调用、可链式追加，并按逆序释放。

```ts
import { createEventHub, type IEventHub, type IEventHubOptions } from '@migaia/event-subscriber'
```

**`createEventHub`｜10 秒上手** —— 多事件类型的按 key 懒创建路由：

```ts
type IEvents = { ready: { readonly at: number }; warning: { readonly message: string } }
const hub = createEventHub<IEvents>()
const stop = hub.subscribe('warning', (event) => console.warn(event.value.message))
hub.publish('warning', { message: 'cache is stale' })
```

Hub 也接受相同的 style preset，例如 `createEventHub<IEvents>({ style: 'on-emit' })` 会增加 `on`/`emit` 两个 canonical identity alias；key 与 payload 的关联、lazy channel、size 和 clear 语义不变。Hub custom style 使用第二个泛型：`createEventHub<IEvents, typeof style>({ style })`。

类型参数 `C extends IEventMap`（事件名到 payload 类型的映射）。第一参数 `options?: IEventHubOptions<C>` 全部字段：

- `report?: (failure: IEventHubReport<C>) => void | PromiseLike<void>` —— 失败对象额外携带 `key`
- `terminalReport?: (error: unknown) => void | PromiseLike<void>`

返回的 `hub` 方法：

- `subscribe<K>(key: K, listener: IEventListener<C[K]>): IEventHubSubscription<C, K>`；返回值可直接调用，也可链式追加。
- `publish<K>(key: K, value: C[K]): void` —— 该 key 尚未创建 channel 时是 no-op
- `clear(key?: keyof C): void` —— 传 `key` 只清该 key（并移除空 channel），不传清空全部
- `size(key?: keyof C): number` —— 传 `key` 返回该 key 的 registration 数，不传返回全部 key 的总数（O(1)）

Hub listener 返回类型固定为 `void`/`PromiseLike<void>`，不做 async 结果聚合；需要结果时为该事件单独用 `createEventChannel<T, R>()` 创建带 `R` 的 channel。

---

<a id="错误模块"></a>

## 常量与错误

```ts
import {
  EventSubscriberState,
  EventSubscriberErrorCode,
  EVENT_SUBSCRIBER_SOURCE,
  type IEventSubscriberErrorCode
} from '@migaia/event-subscriber'
```

**`EventSubscriberState`｜3 秒上手** —— 协议常量，无调用参数：

```ts
EventSubscriberState.abort // 'abort'
EventSubscriberState.fulfilled // 'fulfilled'
EventSubscriberState.rejected // 'rejected'
```

**`EventSubscriberErrorCode`｜3 秒上手** —— 稳定错误码表：

```ts
if (error.code === EventSubscriberErrorCode.publishFailed) {
  /* ... */
}
```

全部取值：`invalidListener`(`INVALID_LISTENER`)、`invalidReporter`(`INVALID_REPORTER`)、`invalidChannel`(`INVALID_CHANNEL`)、`invalidSignal`(`INVALID_SIGNAL`)、`invalidSubscriber`(`INVALID_SUBSCRIBER`)、`invalidEventKey`(`INVALID_EVENT_KEY`)、`taskNotFound`(`TASK_NOT_FOUND`)、`taskNotUnique`(`TASK_NOT_UNIQUE`)、`invalidTaskId`(`INVALID_TASK_ID`)、`invalidOptions`(`INVALID_OPTIONS`)、`publishFailed`(`PUBLISH_FAILED`)、`unhandledListenerFailure`(`UNHANDLED_LISTENER_FAILURE`)。

**`EVENT_SUBSCRIBER_SOURCE`｜3 秒上手** —— 常量字符串 `'@migaia/event-subscriber'`，等同任意包边界错误的 `source` 字段。

所有包拥有的边界错误都携带 `source`/`code` 两个附加字段，不替换原生错误类型（输入校验错误是 `TypeError`，发布聚合错误是 `AggregateError`）；`AggregateError.errors[0]` 与 `cause` 恒为触发失败的原始错误。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 按 `taskId` 定向到唯一订阅者并等待结果

```ts
import { createEventChannel, publishTask } from '@migaia/event-subscriber'

const jobs = createEventChannel<string, string>()
jobs.subscribe((event) => `email:${event.value}`, { taskId: 'email' })
jobs.subscribe((event) => `audit:${event.value}`, { taskId: 'audit' })

const emailResult = await publishTask(jobs, 'email', 'created')
```

### 2. 并行结算 + 集中上报未处理的迟到失败

```ts
import { createEventChannel, publishParallelSettled } from '@migaia/event-subscriber'

const checks = createEventChannel<string, boolean>({
  terminalReport: (diagnostic) => emergencySink.capture(diagnostic)
})
checks.subscribe(async (event) => event.value.length > 0)
checks.subscribe(async (event) => event.value.startsWith('usr_'))

const results = await publishParallelSettled(checks, 'usr_42')
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
import { createEventChannel, subscribeSubscriber, publishSerial } from '@migaia/event-subscriber'

const pipeline = createEventChannel<string, void>()
subscribeSubscriber(pipeline, {
  handle: async (event) => writeAuditLog(event.value)
})
subscribeSubscriber(pipeline, {
  handle: async (event) => notifyDownstream(event.value)
})

await publishSerial(pipeline, 'order-created')
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

</content>
