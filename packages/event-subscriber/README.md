# @migaia/event-subscriber

轻量、runtime-neutral 的 transient event fan-out 原语。

它负责一件事：登记 listener，在发布入口取得稳定快照，并把同一个事件可靠地分发给目标 listener。包本身不持有队列、不保存当前值、不做 replay，也不接管资源生命周期。

## 安装

```bash
pnpm add @migaia/event-subscriber
```

包只有 root export，零 workspace runtime dependency，并声明 `sideEffects: false`。

## Public API map

| 分组 | 导出 |
| --- | --- |
| Channel | `createEventChannel`、`subscribeOnce`、`subscribeUntil`、`subscribeSubscriber` |
| Async publish | `publishParallel`、`publishParallelSettled`、`publishSerial`、`publishSerialSettled`、`publishTask`、`publishTaskSettled` |
| Hub / contracts | `createEventHub`、`EventSubscriberState`、`EventSubscriberErrorCode`、`EVENT_SUBSCRIBER_SOURCE`；类型见 [USEGUIDE](./USEGUIDE.md#17-public-api-索引) |

没有 subpath export；所有公开值和类型从 `@migaia/event-subscriber` 导入。

## 60 秒上手

```ts
import { createEventChannel } from '@migaia/event-subscriber';

type IUserJoined = {
  readonly userId: string;
  readonly name: string;
};

const joined = createEventChannel<IUserJoined>();

const unsubscribe = joined.subscribe((event) => {
  console.log(`${event.value.name} joined`);
});

joined.publish({ userId: 'u-1', name: 'Ada' });
unsubscribe();
```

listener 接收的是 `event` context，业务数据位于 `event.value`。`unsubscribe()` 同步且幂等；空 channel 发布是合法 no-op。

## 选哪个发布 API

| API                                      | 调用顺序                   | 等待 listener   | listener 失败                                                                  |
| ---------------------------------------- | -------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `channel.publish(value)`                 | 当前调用栈，注册顺序       | 不等待 Promise  | 同步失败在完整快照执行后以 `AggregateError` 抛出；迟到 rejection 交给 `report` |
| `publishParallel(channel, value)`        | 所有 listener 立即启动     | 等待全部        | 等待全部后以 `PUBLISH_FAILED` reject                                           |
| `publishParallelSettled(channel, value)` | 所有 listener 立即启动     | 等待全部        | 返回逐 listener settled result，不调用 reporter                                |
| `publishSerial(channel, value)`          | 前一个 settle 后启动下一个 | 等待全部        | 不 fail-fast；全部执行后 reject                                                |
| `publishSerialSettled(channel, value)`   | 前一个 settle 后启动下一个 | 等待全部        | 返回逐 listener settled result                                                 |
| `publishTask*`                           | 精确选择一个 `taskId`      | 等待该 listener | 0 个或多个匹配会在任何 listener 执行前同步抛错                                 |

需要 fire-and-forget 通知时用 `publish()`；需要等待结果时明确选择 parallel、serial 或 task 版本。

```ts
import { createEventChannel, publishParallelSettled } from '@migaia/event-subscriber';

const checks = createEventChannel<string, boolean>();

checks.subscribe(async (event) => event.value.length > 0);
checks.subscribe(async (event) => event.value.startsWith('usr_'));

const results = await publishParallelSettled(checks, 'usr_42');
// [
//   { status: 'fulfilled', value: true },
//   { status: 'fulfilled', value: true }
// ]
```

## 快照语义

每次 publish 只在入口读取一次 registration 快照：

- listener 按注册顺序执行。
- 发布过程中新增的 listener 从下一次 publish 开始生效。
- 本次快照里的 listener 即使在轮到它之前被退订，本次仍会执行。
- 同一个函数重复订阅会创建两份独立 registration。
- `clear()` 只清空 registration，不调用 listener，也不释放 listener 自己持有的资源。

这组规则让重入、退订和并发等待具有确定结果。

## once、signal 与对象 subscriber

```ts
import { createEventChannel, subscribeSubscriber } from '@migaia/event-subscriber';

const channel = createEventChannel<number>();

channel.subscribeOnce((event) => {
  console.log('only once', event.value);
});

const controller = new AbortController();
channel.subscribeUntil(controller.signal, (event) => {
  console.log('until aborted', event.value);
});

const subscriber = {
  total: 0,
  handle(event: { readonly value: number }) {
    this.total += event.value;
  }
};

subscribeSubscriber(channel, subscriber);
controller.abort('page closed');
```

`subscribeOnce()` 会在调用 listener 前退订，因此同步重入也只执行一次。`subscribeUntil()` 只把 signal abort 桥接为退订；它不会中断已经开始执行的 listener。

## taskId：定向到一组或唯一 listener

```ts
import { createEventChannel, publishParallel, publishTask } from '@migaia/event-subscriber';

const jobs = createEventChannel<string, string>();

jobs.subscribe((event) => `email:${event.value}`, { taskId: 'email' });
jobs.subscribe((event) => `audit:${event.value}`, { taskId: 'audit' });

const auditResults = await publishParallel(jobs.filterTaskId('audit'), 'created');
const emailResult = await publishTask(jobs, 'email', 'created');
```

`filterTaskId()` 返回只读选择 view，可交给 parallel/serial helper。`publishTask()` 和 `publishTaskSettled()` 要求恰好一个匹配；重复 taskId 会得到 `TASK_NOT_UNIQUE`，无匹配会得到 `TASK_NOT_FOUND`。

## 多事件类型：Event Hub

```ts
import { createEventHub } from '@migaia/event-subscriber';

type IAppEvents = {
  ready: { readonly at: number };
  warning: { readonly message: string };
};

const events = createEventHub<IAppEvents>();

const stop = events.subscribe('warning', (event) => {
  console.warn(event.value.message);
});

events.publish('warning', { message: 'cache is stale' });
console.log(events.size('warning')); // 1
stop();
```

Hub 按 key 懒创建 channel，`size()` 返回所有 key 的 registration 总数，`size(key)` 返回单个 key 的数量。

## 错误不会被静默吞掉

```ts
const channel = createEventChannel<number>({
  report: ({ event, error }) => {
    monitoring.capture(error, { value: event.value });
  },
  terminalReport: (diagnostic) => {
    emergencySink.capture(diagnostic);
  }
});
```

`publish()` 无法把异步 rejection 返回给已经离开的调用方，因此迟到 rejection 进入 `report`。`report` 缺失或失败时依次进入 `terminalReport` 和宿主 terminal sink。异步 settled/throwing helper 自己拥有结果，不会重复调用 reporter。

所有包拥有的边界错误都携带：

```ts
{
  source: '@migaia/event-subscriber',
  code: EventSubscriberErrorCode.publishFailed
}
```

输入错误保留原生 `TypeError`，发布聚合错误保留原始 listener error 于 `AggregateError.errors` 和 `cause`。

## 它不是什么

- 需要当前值、立即回放或派生图：使用 `@migaia/reactive`。
- 需要 waterfall、`next()`、短路或值变换：使用 `@migaia/middleware-pipeline`。
- 需要 queue、backpressure、drain、deadline 或 close：由 lifecycle-aware dispatcher 拥有，不应塞进 channel。
- 需要跨 Worker、iframe、BroadcastChannel 或网络传输：使用 `@migaia/web-rpc`，在消息抵达本地后再 publish。
- 需要集中释放：把 unsubscribe 交给 `@migaia/lifecycle` 的 scope。

完整 API、错误码、taskId、abort race 与生命周期说明见 [USEGUIDE.md](./USEGUIDE.md)。
