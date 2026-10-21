# `@migaia/event-subscriber`

[English](./README.en.md)

`@migaia/event-subscriber` 把本地事件分发给一组监听器，并为等待结果、取消订阅和精确选择一个处理者提供明确规则。

## 你可能遇到过

- **界面先显示新值，又跳回旧值**：第一个回调发布新事件时，递归派发抢在当前轮其余回调之前执行。
- **监听器漏收到一次，或新订阅提前收到旧事件**：发布过程直接遍历正在被增删的回调数组。
- **离开页面后旧组件继续收到更新**：请求用了取消信号，事件订阅却没有绑定到相同寿命。
- **一个处理者失败，其他成功数据也丢了**：把事件通知当成能等待全部结果的异步调用，却没有逐项结算。
- **一次保存写入两次**：重复挂载建立了两个同名处理者，调用前没有检查目标是否唯一。

## 为什么选它

- **嵌套更新按轮次交付。** 手写递归广播会让新值插入旧值这一轮；显式 queued 策略先完成当前快照（发布开始时固定的接收者列表），[示例](./USEGUIDE.md#让嵌套通知等当前这一轮交付完成)依次展示 1、2。
- **订阅增删不改变当前接收者。** 遍历活动数组容易漏调用或多调用；入口快照固定本轮目标，[示例](./USEGUIDE.md#修改订阅时不打乱当前交付)把新增订阅留到第二轮。
- **取消信号同时管住事件订阅。** 手写取消代码容易只停请求、漏掉监听器；`subscribeUntil` 既退订事件也移除信号监听，[示例](./USEGUIDE.md#页面取消后不再接收更新)取消后剩余登记为零。
- **失败不会抹掉并行成功值。** 只处理整体拒绝容易丢失已成功结果；`invokeParallelSettled` 按登记顺序返回各自的成功值或失败，[示例](./USEGUIDE.md#一个监听者失败时仍保留其他结果)保留成功值 6。
- **命令目标不唯一时先拒绝执行。** 直接广播或取首个匹配会重复写入或掩盖重复登记；`invokeTask` 在调用前要求恰好一个匹配，[示例](./USEGUIDE.md#执行前拒绝重复登记的命令目标)的第二次尝试没有再次保存。

## 从这里开始

用 Node 24 直接运行。第一个监听器处理值 1 时又发布值 2；排队交付让第二个监听器先看到 1，再看到 2。

```ts doc-test=run
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'

const updates = createEventChannel<number>({ dispatchPolicy: EventDispatchPolicy.queued })
updates.subscribe(({ value }) => {
  console.log('记录:', value)
  if (value === 1) updates.publish(2)
})
updates.subscribe(({ value }) => {
  console.log('展示:', value)
})
updates.publish(1)
updates.clear()
```

输出：

```text
记录: 1
展示: 1
记录: 2
展示: 2
```

遇到页面退订看[取消信号](./USEGUIDE.md#页面取消后不再接收更新)，需要等待处理结果看[并行结算](./USEGUIDE.md#一个监听者失败时仍保留其他结果)。

## 手写时的隐患

下面仅展示，不运行。它用原生数组管理与上一节相同的嵌套更新。

```ts doc-test=check
const listeners: Array<(value: number) => void> = []
const publish = (value: number) => {
  // 隐患 1：遍历活动数组，回调增删会改变本轮接收者。
  for (const listener of listeners) listener(value)
}
listeners.push((value) => {
  console.log('记录:', value)
  // 隐患 2：递归发布先展示 2，返回后才展示旧值 1。
  if (value === 1) publish(2)
})
listeners.push((value) => console.log('展示:', value))
publish(1)
```

上一节由 channel 先固定目标，再用显式 queued 策略完成当前轮；不用在每个监听器里手写重入协调。默认策略仍是 recursive，需要这种顺序时应明确选择 queued。

## 三分钟心智模型

| 你要回答的问题                 | 工具                             |
| ------------------------------ | -------------------------------- |
| 只通知，不等待结果？           | channel 的 `publish()`           |
| 多种事件有不同参数类型？       | `createEventHub()`               |
| 页面取消后一起退订？           | `subscribeUntil()`               |
| 全部并发执行，保留每个结果？   | `invokeParallelSettled()`        |
| 按顺序等待，或只调用一个目标？ | `invokeSerial()`、`invokeTask()` |

| 术语                | 白话含义                                         |
| ------------------- | ------------------------------------------------ |
| channel             | 一种事件的本地通知通道，不保存当前值。           |
| registration        | 一次订阅登记，由自己的句柄负责取消。             |
| snapshot            | 发布入口固定的接收者列表，当前轮不随增删变化。   |
| `taskId`            | 调用方给登记起的非空标签，用来选择处理者。       |
| subscription handle | 可直接调用的取消函数，也可以追加同一条链的订阅。 |

## 典型场景

| 场景                           | 怎么组合                | 详细说明                                                 |
| ------------------------------ | ----------------------- | -------------------------------------------------------- |
| 让嵌套通知等当前这一轮交付完成 | `createEventChannel`    | [完整示例](./USEGUIDE.md#让嵌套通知等当前这一轮交付完成) |
| 修改订阅时不打乱当前交付       | `createEventChannel`    | [完整示例](./USEGUIDE.md#修改订阅时不打乱当前交付)       |
| 离开页面时一起退订多个事件     | `createEventHub`        | [完整示例](./USEGUIDE.md#离开页面时一起退订多个事件)     |
| 页面取消后不再接收更新         | `subscribeUntil`        | [完整示例](./USEGUIDE.md#页面取消后不再接收更新)         |
| 一个监听者失败时仍保留其他结果 | `invokeParallelSettled` | [完整示例](./USEGUIDE.md#一个监听者失败时仍保留其他结果) |
| 前一个处理者结束后再运行下一个 | `invokeSerial`          | [完整示例](./USEGUIDE.md#前一个处理者结束后再运行下一个) |
| 执行前拒绝重复登记的命令目标   | `invokeTask`            | [完整示例](./USEGUIDE.md#执行前拒绝重复登记的命令目标)   |

## 安装

```bash
pnpm add @migaia/event-subscriber
```

根入口负责 channel、Hub 与调用工具；独立订阅 helper 从 `@migaia/event-subscriber/subscriber` 导入。运行时只依赖 `@migaia/utils`，没有 DOM 或 Node 依赖，`sideEffects: false`。

## 常用 API

| API                       | 作用                                       |
| ------------------------- | ------------------------------------------ |
| `createEventChannel()`    | 创建单事件通道，固定每轮接收者与重入策略。 |
| `createEventHub()`        | 按事件名和对应 payload 类型路由本地通知。  |
| `subscribeUntil()`        | 把订阅寿命绑定到取消信号。                 |
| `invokeParallelSettled()` | 并行等待每个监听器，保留成功与失败。       |
| `invokeSerial()`          | 等前一个结束后再调用下一个。               |
| `invokeTask()`            | 执行前确认 `taskId` 恰好匹配一个登记。     |

## 契约细节

`createEventChannel<T, R>()` 中，`T` 是发布载荷类型，`R` 是监听器结果类型。指定结果类型不会改变 channel 的订阅模型，也不会创建全局任务表。

基础订阅有两种签名：`subscribe(listener, options?: { taskId?: string; delivery?: 'context' }): subscription` 保留事件上下文，原始载荷放在 `event.value`；`subscribe(listener, options: { taskId?: string; delivery: 'value' }): subscription` 把原始 payload 直接交给监听器。

公开选项类型为 `IEventSubscribeOptions`，模式常量为 `EventDelivery.context`、`EventDelivery.value`。可选的 `taskId` 是调用方给本次登记起的标签；返回的 `subscription` 负责取消并可追加订阅。

只处理 payload 时可显式选择 value：

```ts
import { createEventChannel, EventDelivery } from '@migaia/event-subscriber'

const updates = createEventChannel<{ id: number }>()
const stop = updates.subscribe((value) => console.log(value.id), { delivery: EventDelivery.value })
updates.publish({ id: 1 })
stop()
```

value 模式保持 payload 身份，不提供 `abort()`、`setTaskId()` 或 `taskId` 上下文成员；登记时的 `taskId` 仍可用于任务过滤。需要上下文控制或 `valueConfig` 别名时保留默认 context。通道订阅链、命名别名及 Hub 的第三个订阅参数都接受相同的 delivery 选择；Hub 不接受任务标签。`subscribeOnce`、`subscribeUntil` 仍只接收上下文监听器。

动态事件名可在运行时广播；有限字面量事件表的同一条链禁止重复事件名。这是 TypeScript 的订阅链类型约束；另一条独立链仍可订阅同名事件。

默认采用同步 recursive 派发、multiple 登记、handle 级取消、每次顶层发布 `100_000` 次调用预算和非严格的已取消信号准入。监听器增删、clear 和任务改标签不改变当前快照；每次之后的调用重新选择目标。

同步 `publish()` 不等待 Promise。同步抛错收集为 `PUBLISH_FAILED`，迟到拒绝交给 report；异步调用工具等待结算，通过返回值或拒绝交付结果。settled 只收集监听器失败，通道与任务准入错误仍同步抛出。

`invokeParallelSettled(channel, payload)` 按登记顺序返回结算项：`{ status: 'fulfilled', value }` 的 `value` 是监听器兑现后的返回值；`{ status: 'rejected', reason }` 的 `reason` 是监听器原始的抛错或拒绝原因。这些字段描述监听器执行结果，不是消息发送回执。

订阅句柄可以串联，并按相反顺序、幂等地取消；关闭后不能追加。静态 `valueConfig` 只为 context 模式的上下文附加一个路径值，不转换事件或 value 监听器的 payload。

设置 `style: 'on-emit'` 后，`channel.on(listener)` 登记监听器并返回本次订阅的句柄，`channel.emit(value)` 按所选派发策略把 value 交给当前快照中的监听器。默认 handle 取消策略下，句柄的 `off()` 只移除它拥有的登记。`on`、`emit`、`off` 分别与 `subscribe`、`publish`、`unsubscribe` 指向同一函数；canonical（固定原名）方法仍保留。

从 `@migaia/event-subscriber/subscriber` 导入的 `subscribeOnce`、`subscribeUntil`、`subscribeSubscriber` 只通过 `channel.subscribe(listener, options?)` 工作，不读取 style 配置，因此可以接收仍保留该方法的 styled channel（增加命名别名的通道）。它们的返回值固定为普通 `IUnsubscribe`，即同步、幂等的取消函数，不带 `off`、`dispose`、`unlisten` 或订阅链方法。

对象订阅者只需实现 `IEventSubscriber<T, R>` 的 `handle(event)`，事件来源由 `subscribeSubscriber(channel, subscriber)` 中的 channel 决定；多事件名称由 Hub 的 `subscribe(key, listener)` 中的 key 决定。旧草案中的抽象类 `EventSubscriber`、静态 `EVENT_NAME` 与 `onCall()` 不属于当前公开契约，不把事件名重复存进 class。

Hub 的内部策略固定为上述默认值，不接受单通道策略配置。它不聚合监听器结果；需要返回值时使用带结果类型的 channel。

事件是瞬时通知，不提供当前值、重放、跨进程传输、资源宿主、排空或背压。完整参数、命名风格、静态值路径、19 个错误码和构建命令见[使用指南](./USEGUIDE.md#公开入口与边界)。
