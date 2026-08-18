# @migaia/event-subscriber 使用指南

`@migaia/event-subscriber` 提供本地、瞬时、runtime-neutral 的事件订阅与 fan-out。它的核心模型不是 EventEmitter class，也不是消息队列，而是：

```text
registration owner → immutable dispatch snapshot → explicit settlement
```

channel 拥有 registration；每次发布取得固定快照；调用方根据场景选择同步 fire-and-forget、并行等待、串行等待或唯一 task 结算。

## 1. 安装与入口

```bash
pnpm add @migaia/event-subscriber
```

所有公开 API 均从 root 导出：

```ts
import {
  EVENT_SUBSCRIBER_SOURCE,
  EventSubscriberErrorCode,
  EventSubscriberState,
  createEventChannel,
  createEventHub,
  publishParallel,
  publishParallelSettled,
  publishSerial,
  publishSerialSettled,
  publishTask,
  publishTaskSettled,
  subscribeOnce,
  subscribeSubscriber,
  subscribeUntil
} from '@migaia/event-subscriber';
```

包没有子路径入口，没有 workspace runtime dependency，不依赖 DOM、Node、Worker 或 lifecycle runtime。`IEventAbortSignal` 与标准 `AbortSignal`、`@migaia/lifecycle` 的结构化 signal 兼容。

## 2. 核心类型与心智模型

```ts
type IEventListener<T, R = void> = (event: IEventContext<T>) => R | PromiseLike<R>;

type IEventContext<T> = {
  readonly value: T;
  readonly aborted: boolean;
  readonly abortReason: unknown;
  readonly taskId: string | undefined;
  abort(reason?: unknown): void;
  setTaskId(taskId: string | undefined): void;
};

type IUnsubscribe = () => void;
```

一次 `subscribe()` 创建一份独立 registration。registration 保存 listener、active/aborted 状态、abort reason 和当前 taskId。一次 dispatch snapshot 固定 listener 与 taskId，但保留 registration abort 状态的 live view。

这意味着：

- `event.value` 永远是本次发布的 payload。
- `event.taskId` 是本次快照取得时的标签，不会因本次 listener 内调用 `setTaskId()` 而变化。
- `event.aborted` 与 `event.abortReason` 是 live 状态；同一快照中的后续观察可以看到 abort。
- `event.abort(reason)` 会标记当前 registration aborted 并将它退订。
- 普通 unsubscribe、once 和 clear 只令 registration inactive，不会伪造 aborted 状态。

## 3. 创建 Channel

```ts
const channel = createEventChannel<T, R>(options?);

type IEventChannelOptions<T> = {
  readonly report?: (failure: IEventReport<T>) => void | PromiseLike<void>;
  readonly terminalReport?: (error: unknown) => void | PromiseLike<void>;
};
```

`T` 是 payload 类型，`R` 是 listener 结果类型。仅使用同步 `publish()` 且不关心结果时通常只需写 `T`。

```ts
const notifications = createEventChannel<{ readonly text: string }>();

notifications.subscribe((event) => {
  console.log(event.value.text);
});

notifications.publish({ text: 'ready' });
```

`options` 必须是对象；`report` 和 `terminalReport` 若存在必须可调用。配置在 channel 创建时完成快照，后续修改原 options 不会改变 reporter。

### 3.1 Channel API

| API                                          | 返回值                        | 语义                                                       |
| -------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `subscribe(listener, options?)`              | `IUnsubscribe`                | 创建独立 registration；不会同步调用 listener               |
| `subscribeOnce(listener, options?)`          | `IUnsubscribe`                | 首次调用 listener 之前退订                                 |
| `subscribeUntil(signal, listener, options?)` | `IUnsubscribe`                | signal abort 时退订；已 aborted signal 不创建 registration |
| `publish(value)`                             | `void`                        | 当前调用栈按快照顺序调用；不等待 Promise                   |
| `filterTaskId(taskId)`                       | `IFilteredEventChannel<T, R>` | 创建只读 task 选择 view                                    |
| `clear()`                                    | `void`                        | 清空 registration，不执行用户 cleanup                      |
| `size`                                       | `number`                      | 当前 active registration 数量                              |

`subscribe()` 返回的函数同步、幂等。相同 listener 重复订阅是两份 registration：

```ts
const stopA = channel.subscribe(listener);
const stopB = channel.subscribe(listener);

stopA();
stopA(); // no-op
console.log(channel.size); // 1
stopB();
```

## 4. 稳定快照与重入

publish 入口按注册顺序复制 dispatch snapshot。随后发生的增删不会改写本次目标集合。

```ts
const channel = createEventChannel<number>();
const seen: number[] = [];

let stopSecond = () => {};

channel.subscribe((event) => {
  seen.push(event.value);
  stopSecond();
  channel.subscribe((next) => seen.push(next.value + 10));
});

stopSecond = channel.subscribe((event) => {
  seen.push(event.value + 1);
});

channel.publish(1); // seen: [1, 2]
channel.publish(2); // seen: [1, 2, 2, 12]
```

第二个 listener 虽然在轮到它之前被退订，仍属于第一次快照；新 listener 则从第二次 publish 开始出现。同步嵌套 publish 会取得自己的新快照，不与外层共享遍历游标。

## 5. Event Context 控制

### 5.1 `abort(reason?)`

listener 可以撤销自己的 registration：

```ts
channel.subscribe((event) => {
  if (!isValid(event.value)) {
    event.abort({ reason: 'invalid payload' });
    return;
  }
  consume(event.value);
});
```

`abort()` 不会中断当前函数，也不会取消已经开始的 Promise。它只更新 registration control 并阻止该 registration 进入未来快照。

### 5.2 `setTaskId(taskId)`

```ts
channel.subscribe(
  (event) => {
    if (event.value.promote) event.setTaskId('priority');
  },
  { taskId: 'normal' }
);
```

允许值为非空 string 或 `undefined`。`undefined` 清除标签。修改只影响 happens-after 的新 dispatch snapshot；当前 `event.taskId` 保持旧值。registration 已 inactive 时调用是 no-op。

## 6. 订阅 Helper

Channel 提供 `subscribeOnce()` / `subscribeUntil()` 方法；root 同时导出函数式 helper，用于兼容只有 `subscribe()` 的结构化 channel。

### 6.1 `subscribeOnce`

```ts
const stop = subscribeOnce(channel, (event) => {
  channel.publish(event.value); // 同步重入不会再次调用当前 once listener
});
```

once 在 listener 调用前退订，因此 listener throw、返回 rejected Promise 或同步重入都不会导致第二次执行。

### 6.2 `subscribeUntil`

```ts
const controller = new AbortController();

const stop = subscribeUntil(channel, controller.signal, (event) => {
  consume(event.value);
});

controller.abort('owner closed');
stop(); // 仍然幂等
```

helper 使用以下顺序封闭 check/register race：

1. 读取并验证首次 `signal.aborted`。
2. 创建 registration。
3. 安装 `{ once: true }` 的 abort listener。
4. 再次检查 `signal.aborted`。
5. 若竞态期间已 abort，捕获一次 reason、移除 listener 并退订。

signal 已 abort 时返回 no-op unsubscribe。abort 只撤销 registration；它不承诺终止已经开始的 listener。若 hostile signal 的 getter、监听安装或移除失败，registration 会尽可能回滚，错误保留 `INVALID_SIGNAL`，cleanup failure 只作为附加错误可达。

### 6.3 `subscribeSubscriber`

对象 subscriber 不需要继承基类：

```ts
import type { IEventSubscriber } from '@migaia/event-subscriber';

class Counter implements IEventSubscriber<number> {
  total = 0;

  handle(event: { readonly value: number }): void {
    this.total += event.value;
  }
}

const counter = new Counter();
const stop = subscribeSubscriber(channel, counter);
```

helper 调用 `subscriber.handle` 时保留 subscriber receiver，因此方法内的 `this` 正常工作。

## 7. 同步 publish 的精确错误语义

`channel.publish(value)` 是 fire-and-forget API：

- 所有 snapshot listener 在当前调用栈按注册顺序被调用。
- 同步 throw 不会截断后续 listener。
- thenable 的 `then` getter throw 视为同步失败。
- 所有同步失败在遍历完成后形成一个 `PUBLISH_FAILED` AggregateError。
- Promise/thenable rejection 发生在 publish 返回后，进入 reporter chain。

```ts
const first = new Error('first');
const second = new Error('second');

channel.subscribe(() => {
  throw first;
});
channel.subscribe(() => {
  throw second;
});

try {
  channel.publish(value);
} catch (error) {
  const aggregate = error as AggregateError & { readonly code?: string };
  console.log(aggregate.code); // PUBLISH_FAILED
  console.log(aggregate.errors[0] === first); // true
  console.log(aggregate.errors[1] === second); // true
}
```

即使只有一个失败也保持 AggregateError 外形，避免调用方根据失败数量处理两套类型。

## 8. 异步发布矩阵

```ts
type IListenerResult<R> =
  | { readonly status: 'fulfilled'; readonly value: Awaited<R> }
  | { readonly status: 'rejected'; readonly reason: unknown };
```

### 8.1 Parallel

```ts
const values = await publishParallel(channel, payload);
const results = await publishParallelSettled(channel, payload);
```

parallel 在当前同步阶段启动完整快照中的全部 listener，然后等待全部 settle。结果始终按注册顺序排列，不按完成时间排序。

`publishParallel()` 任一 listener 失败时仍等待全部目标，然后以 `PUBLISH_FAILED` AggregateError reject；成功时返回 `Awaited<R>[]`。`publishParallelSettled()` 始终 resolve settled result 数组，listener failure 位于 `reason`。

### 8.2 Serial

```ts
const values = await publishSerial(channel, payload);
const results = await publishSerialSettled(channel, payload);
```

serial 只有在前一个 listener settle 后才调用下一个。单个失败不会截断后续 listener；throwing 版本在全部目标完成后统一 reject。

serial 不是 waterfall：每个 listener 收到同一个 payload，前一个 listener 的返回值不会成为下一个 listener 的输入。需要值变换、`next()` 或短路时使用 `@migaia/middleware-pipeline`。

### 8.3 Throwing 与 Settled

| 版本                                              | 成功结果             | listener 失败                 | reporter |
| ------------------------------------------------- | -------------------- | ----------------------------- | -------- |
| `publishParallel` / `publishSerial`               | fulfilled value 数组 | 完整执行后 `PUBLISH_FAILED`   | 不调用   |
| `publishParallelSettled` / `publishSerialSettled` | settled result 数组  | 放入 `{ status: 'rejected' }` | 不调用   |

空 channel 对四个 API 都是合法 no-op：throwing/settled 数组版本 resolve `[]`。

## 9. taskId 与定向结算

registration 可在订阅时携带 taskId：

```ts
const tasks = createEventChannel<IJob, IResult>();

tasks.subscribe(runEmailJob, { taskId: 'email' });
tasks.subscribe(runAuditJob, { taskId: 'audit' });
```

### 9.1 过滤 view

```ts
const audits = tasks.filterTaskId('audit');
const results = await publishParallelSettled(audits, job);
```

view 不复制 listener，也不拥有 registration 或生命周期。它不暴露 subscribe、clear、publish、size；只能交给 parallel/serial async helper。它允许 0、1 或多个匹配。

### 9.2 唯一 task

```ts
const result = await publishTask(tasks, 'email', job);
const settled = await publishTaskSettled(tasks, 'email', job);
```

两个 API 都要求入口快照恰好匹配一份 registration：

- 0 个匹配：同步抛 `TASK_NOT_FOUND`。
- 多个匹配：同步抛 `TASK_NOT_UNIQUE`。
- 恰好一个：调用该 listener。

选择错误包含可枚举的 `taskId` 与 `matchCount`，且发生在任何 listener 调用或 registration 修改之前。`publishTaskSettled()` 的 listener failure 返回 rejected result；`publishTask()` 则以 `PUBLISH_FAILED` reject。

注意：即使 API 返回 Promise，task 选择错误仍在函数调用阶段同步抛出：

```ts
try {
  const operation = publishTask(tasks, 'missing', job);
  await operation;
} catch (error) {
  // 同时能捕获同步 selection error 与异步 listener failure
}
```

## 10. Event Hub

Hub 为多个 event key 提供类型安全路由：

```ts
type IEvents = {
  ready: { readonly at: number };
  failed: { readonly cause: unknown };
};

const hub = createEventHub<IEvents>({
  report: ({ key, event, error }) => {
    monitoring.capture(error, { key, payload: event.value });
  }
});

const stopReady = hub.subscribe('ready', (event) => {
  console.log(event.value.at);
});

hub.publish('ready', { at: Date.now() });
```

Hub 按 key 懒创建内部 channel，并提供 O(1) 总数统计：

| API                        | 语义                           |
| -------------------------- | ------------------------------ |
| `subscribe(key, listener)` | 为 key 创建独立 registration   |
| `publish(key, value)`      | 同步发布；未创建 key 时 no-op  |
| `clear(key)`               | 清空指定 key，并移除空 channel |
| `clear()`                  | 清空全部 key                   |
| `size(key)`                | 指定 key 的 registration 数    |
| `size()`                   | 全部 key 的 registration 总数  |

Hub listener 返回类型固定为 void/PromiseLike<void>，不提供 async result aggregation。需要结果时为该事件单独创建带 `R` 的 channel。

## 11. Reporter 与 terminal fallback

只有普通 `publish()` 的迟到 Promise/thenable rejection 使用 reporter，因为调用方已经拿不到返回结果。处理顺序固定为：

```text
report → terminalReport → globalThis.reportError
       → globalThis.console.error → queueMicrotask throw
```

```ts
const channel = createEventChannel<IEvent>({
  report: async ({ event, error }) => {
    await monitoring.capture(error, { event: event.value });
  },
  terminalReport: (diagnostic) => {
    emergencySink.capture(diagnostic);
  }
});
```

`report` 接收原始 listener error 和对应 event。若它缺失、throw、then getter throw 或 reject，会创建 `UNHANDLED_LISTENER_FAILURE` AggregateError 并进入下一层。原 listener error 恒为 `errors[0]` 和 `cause`；每个 reporter/sink failure 按发生顺序追加，错误链不会丢失。

`*Settled` 和 async throwing API 不调用 reporter：返回的 Promise 已经是该次 listener failure 的唯一 ownership 出口。

## 12. 错误契约

所有包拥有的边界错误都携带：

```ts
type IEventSubscriberBoundaryError = Error & {
  readonly source: '@migaia/event-subscriber';
  readonly code: IEventSubscriberErrorCode;
};
```

错误码来自 `EventSubscriberErrorCode`：

| code                         | 类型/场景                                                                    | 调用方处理                                           |
| ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| `INVALID_LISTENER`           | 非函数 listener                                                              | 修正 listener                                        |
| `INVALID_REPORTER`           | `report` / `terminalReport` 非函数                                           | 修正 channel/hub options                             |
| `INVALID_CHANNEL`            | helper 收到非法 structural channel，或 async helper 收到非 canonical channel | 使用 `createEventChannel()` 或正确实现 `subscribe()` |
| `INVALID_SIGNAL`             | signal 形状、getter、监听安装/回滚失败                                       | 传入标准 AbortSignal 或兼容结构                      |
| `INVALID_SUBSCRIBER`         | subscriber 非对象或无 callable `handle`                                      | 实现 `IEventSubscriber`                              |
| `INVALID_EVENT_KEY`          | Hub key 不是 string/number/symbol                                            | 使用合法 property key                                |
| `INVALID_TASK_ID`            | taskId 不是非空 string，或不允许的位置传入 undefined                         | 修正 task 标签                                       |
| `INVALID_OPTIONS`            | options 不是对象或 getter 失败                                               | 修正 options                                         |
| `TASK_NOT_FOUND`             | 唯一 task 发布匹配数为 0                                                     | 检查标签与 registration 生命周期                     |
| `TASK_NOT_UNIQUE`            | 唯一 task 发布匹配数大于 1                                                   | 保证 taskId 唯一，或改用 filtered parallel/serial    |
| `PUBLISH_FAILED`             | 同步/异步 throwing publish 的一个或多个 listener 失败                        | 查看 `AggregateError.errors`                         |
| `UNHANDLED_LISTENER_FAILURE` | fire-and-forget rejection 未被用户 reporter 接管                             | 配置 report/terminalReport，查看 cause/errors        |

输入校验错误保持原生 `TypeError`；发布失败固定为 `AggregateError`。错误码是附加字段，不替换原生类型、message、stack 或原始 cause。

```ts
try {
  channel.subscribe(null as never);
} catch (error) {
  if (
    error instanceof TypeError &&
    (error as { readonly code?: string }).code === EventSubscriberErrorCode.invalidListener
  ) {
    // invalid listener
  }
}
```

## 13. 生命周期与资源所有权

本包没有 `dispose()`。它只返回同步、幂等的 unsubscribe；close、逆序释放、聚合 cleanup error 和 parent abort 归 `@migaia/lifecycle`。

```ts
const unsubscribe = channel.subscribe(listener);

scope.own(unsubscribe, {
  syncSafe: true,
  force: unsubscribe
});
```

`clear()` 不是 dispose：它只撤销 registration，不执行 listener 持有的资源 cleanup。若 listener 创建了 timer、socket 或其它资源，应由其 owner scope 直接拥有这些资源。

## 14. Canonical 与 Structural Channel

`subscribeOnce`、`subscribeUntil`、`subscribeSubscriber` 只需要结构化 `IEventChannelLike<T, R>`：

```ts
type IEventChannelLike<T, R = void> = {
  subscribe(listener: IEventListener<T, R>, options?: { readonly taskId?: string }): IUnsubscribe;
};
```

helper 会验证 `subscribe`，调用时保留 channel receiver，并验证返回值确实是 unsubscribe function。

异步 publish helper 不接受任意 structural channel。它们需要本物理包副本由 `createEventChannel()` 创建的 canonical channel 或 `filterTaskId()` view，因为只有 canonical capability 才能安全读取不可变 dispatch snapshot。伪造对象、另一份物理包副本创建的 channel 都会得到 `INVALID_CHANNEL`。

## 15. 性能与复杂度

内部 registration 使用双向链表：

- subscribe：O(1) 尾插。
- unsubscribe：O(1) 按节点摘除。
- `size`：O(1)。
- publish：O(n) 复制本次目标快照并调用 n 个 listener。
- Hub `size()` / `size(key)`：O(1)。

snapshot 数组分配是确定重入语义所需的 v1 正确性成本。包不创建 timer、queue、worker 或跨 runtime singleton。

## 16. 该用哪个包

| 需求                                          | Owner                                    |
| --------------------------------------------- | ---------------------------------------- |
| transient 本地 fan-out                        | `@migaia/event-subscriber`               |
| 当前值、replay、派生和响应式图                | `@migaia/reactive`                       |
| waterfall、`next()`、短路、generator pipeline | `@migaia/middleware-pipeline`            |
| resource close/dispose、lease、drain          | `@migaia/lifecycle` / `@migaia/resource` |
| capability ready/blocked/failed 与依赖图      | `@migaia/capability`                     |
| Worker、iframe、BroadcastChannel、网络 RPC    | `@migaia/web-rpc`                        |
| queue、backpressure、deadline、持久 delivery  | 独立 lifecycle-aware dispatcher          |

event-subscriber 的 parallel/serial 只改变 listener 调用与等待顺序，不传递前一个 listener 的输出；它永远不是 middleware pipeline。

## 17. Public API 索引

### Runtime values

- `createEventChannel`
- `createEventHub`
- `subscribeOnce`
- `subscribeUntil`
- `subscribeSubscriber`
- `publishParallel`
- `publishParallelSettled`
- `publishSerial`
- `publishSerialSettled`
- `publishTask`
- `publishTaskSettled`
- `EVENT_SUBSCRIBER_SOURCE`
- `EventSubscriberErrorCode`
- `EventSubscriberState`

### Types

- `ICanonicalEventChannel`
- `IEventAbortSignal`
- `IEventChannel`
- `IEventChannelLike`
- `IEventChannelOptions`
- `IEventContext`
- `IEventHub`
- `IEventHubOptions`
- `IEventHubReport`
- `IEventListener`
- `IEventMap`
- `IEventReport`
- `IEventSubscriber`
- `IEventSubscriberErrorCode`
- `IFilteredEventChannel`
- `IListenerResult`
- `IUnsubscribe`
