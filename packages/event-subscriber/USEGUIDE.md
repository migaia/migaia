# `@migaia/event-subscriber` 使用指南

[English](./USEGUIDE.en.md)

先按场景查找，再读完整契约。安装包后，每个运行示例都能单独保存为 `.ts` 文件，用 Node 24 直接运行；代码与对应网站场景一致。包的选用依据见 [README](./README.md)。

## 按场景查找

| 你遇到的问题                   | API                     | 看这一节                                    |
| ------------------------------ | ----------------------- | ------------------------------------------- |
| 让嵌套通知等当前这一轮交付完成 | `createEventChannel`    | [完整示例](#让嵌套通知等当前这一轮交付完成) |
| 修改订阅时不打乱当前交付       | `createEventChannel`    | [完整示例](#修改订阅时不打乱当前交付)       |
| 离开页面时一起退订多个事件     | `createEventHub`        | [完整示例](#离开页面时一起退订多个事件)     |
| 页面取消后不再接收更新         | `subscribeUntil`        | [完整示例](#页面取消后不再接收更新)         |
| 一个监听者失败时仍保留其他结果 | `invokeParallelSettled` | [完整示例](#一个监听者失败时仍保留其他结果) |
| 前一个处理者结束后再运行下一个 | `invokeSerial`          | [完整示例](#前一个处理者结束后再运行下一个) |
| 执行前拒绝重复登记的命令目标   | `invokeTask`            | [完整示例](#执行前拒绝重复登记的命令目标)   |

## 让嵌套通知等当前这一轮交付完成

处理更新的监听者又发布一次更新，其余监听者还没有收到第一条。手写递归回调会让页面先看到新事件，又被旧事件覆盖。排队交付（`queued`）策略先完成当前这一轮的登记快照，再交付嵌套的值；两轮都在同一次同步 `publish` 调用内完成。

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

依次输出 `记录: 1`、`展示: 1`、`记录: 2`、`展示: 2`。嵌套事件没有插入当前这一轮。默认策略是 `recursive`，排队交付需要显式选择 `queued`。

## 修改订阅时不打乱当前交付

交付事件时，一个监听者移除另一条订阅，又登记新的监听者。直接遍历可变回调数组容易漏掉原有接收者，或让新订阅意外收到当前事件。`publish` 先取得一份登记快照：增删作用于后续发布，当前快照仍按登记顺序执行。

```ts doc-test=run
import { createEventChannel } from '@migaia/event-subscriber'

const updates = createEventChannel<number>()
const calls: string[] = []
let stopSecond = () => {}
updates.subscribe(({ value }) => {
  calls.push(`首位 ${value}`)
  if (value === 1) {
    stopSecond()
    updates.subscribe(({ value }) => {
      calls.push(`新增 ${value}`)
    })
  }
})
stopSecond = updates.subscribe(({ value }) => {
  calls.push(`次位 ${value}`)
})
updates.publish(1)
updates.publish(2)
console.log(calls.join(' | '))
updates.clear()
```

输出：

```text
首位 1 | 次位 1 | 首位 2 | 新增 2
```

输出 `首位 1 | 次位 1 | 首位 2 | 新增 2`。退订没有让次位监听者漏掉第一轮；新登记从第二次发布才开始收到事件。

## 离开页面时一起退订多个事件

页面同时监听保存和关闭事件，清理时漏掉一个事件名，旧页面就会继续收到更新。带事件映射类型的 hub 为不同事件保留各自的参数类型；把页面的登记串在同一条订阅链上，一个句柄就能按相反顺序全部退订。

```ts doc-test=run
import { createEventHub } from '@migaia/event-subscriber'

type IAppEvents = { saved: { id: string }; closed: string }
const events = createEventHub<IAppEvents>()
const page = events
  .subscribe('saved', ({ value }) => {
    console.log('已保存:', value.id)
  })
  .subscribe('closed', ({ value }) => {
    console.log('已关闭:', value)
  })
events.publish('saved', { id: 'order-1' })
events.publish('closed', '详情页')
page()
events.publish('saved', { id: 'order-2' })
console.log('剩余订阅:', events.size())
```

输出：

```text
已保存: order-1
已关闭: 详情页
剩余订阅: 0
```

依次输出 `已保存: order-1`、`已关闭: 详情页`、`剩余订阅: 0`。页面清理后的发布没有输出；一个句柄移除了整条链上的登记。

## 页面取消后不再接收更新

组件用一个 `AbortController` 管理操作，离开页面时却漏掉了事件订阅。手写取消监听既要退订事件，也要清理取消监听本身。`subscribeUntil` 把登记绑定到信号，同时返回可重复调用的手动退订函数，供提前清理。

```ts doc-test=run
import { createEventChannel } from '@migaia/event-subscriber'
import { subscribeUntil } from '@migaia/event-subscriber/subscriber'

const updates = createEventChannel<string>()
const page = new AbortController()
const stop = subscribeUntil(updates, page.signal, ({ value }) => {
  console.log('展示:', value)
})
updates.publish('已保存')
page.abort()
updates.publish('不会显示')
stop()
console.log('剩余订阅:', updates.size)
```

输出：

```text
展示: 已保存
剩余订阅: 0
```

输出 `展示: 已保存`，然后是 `剩余订阅: 0`。取消移除了后续交付；之后再调用 `stop` 没有副作用。已经执行中的监听者不会被打断；传入已取消的信号时，默认不建立登记。

## 一个监听者失败时仍保留其他结果

导出操作同时向多个处理者索取结果。只处理一个整体拒绝时，成功返回的数据容易被一起丢掉。`invokeParallelSettled` 立即启动快照里的监听者，按登记顺序保留每个成功值或原始失败原因；传入非法 `channel` 的准入错误仍会同步抛出。

```ts doc-test=run
import {
  createEventChannel,
  invokeParallelSettled,
  EventSubscriberState
} from '@migaia/event-subscriber'

const checks = createEventChannel<number, number>()
checks.subscribe(async ({ value }) => {
  await Promise.resolve()
  return value * 2
})
checks.subscribe(() => {
  throw new Error('远端暂不可用')
})
const results = await invokeParallelSettled(checks, 3)
for (const result of results) {
  if (result.status === EventSubscriberState.fulfilled) console.log('成功:', result.value)
  else console.log('失败:', (result.reason as Error).message)
}
checks.clear()
```

输出：

```text
成功: 6
失败: 远端暂不可用
```

输出 `成功: 6`，然后是 `失败: 远端暂不可用`。第二个监听者先失败，但结果数组仍按登记顺序排列，成功值没有丢失。

## 前一个处理者结束后再运行下一个

前一个异步写入尚未完成，通知就开始发送了，因为 `publish` 不等待监听者返回的 `Promise`。`invokeSerial` 等一个快照监听者结束后才启动下一个；它们都收到同一个输入，不会接收前一个的返回值。示例用日志模拟写入和通知。

```ts doc-test=run
import { createEventChannel, invokeSerial } from '@migaia/event-subscriber'

const steps = createEventChannel<string, string>()
steps.subscribe(async ({ value }) => {
  console.log('写入:', value)
  await Promise.resolve()
  console.log('写入完成')
  return '已写入'
})
steps.subscribe(({ value }) => {
  console.log('通知:', value)
  return '已通知'
})
console.log('结果:', (await invokeSerial(steps, 'order-1')).join(','))
steps.clear()
```

输出：

```text
写入: order-1
写入完成
通知: order-1
结果: 已写入,已通知
```

依次输出 `写入: order-1`、`写入完成`、`通知: order-1`、`结果: 已写入,已通知`。这只控制顺序，不是事务：某个监听者失败不会跳过后续监听者，全部执行后才汇总失败。

## 执行前拒绝重复登记的命令目标

命令本来只应调用一个保存处理者，重复挂载却登记了两次，导致重复写入。`invokeTask` 在执行任何监听者之前按 `taskId` 选择唯一登记：名称不存在时同步抛 `TASK_NOT_FOUND`，重复匹配时同步抛 `TASK_NOT_UNIQUE`，此次不会调用任何处理者，其他任务名也不会被执行。

```ts doc-test=run
import { createEventChannel, invokeTask, type IEventContext } from '@migaia/event-subscriber'

const tasks = createEventChannel<number, number>()
let calls = 0
const save = ({ value }: IEventContext<number>) => {
  calls += 1
  return value + 1
}
tasks.subscribe(save, { taskId: 'save' })
tasks.subscribe(({ value }) => value * 10, { taskId: 'preview' })
console.log('保存结果:', await invokeTask(tasks, 'save', 2))
tasks.subscribe(save, { taskId: 'save' })
try {
  await invokeTask(tasks, 'save', 2)
} catch (error) {
  console.log('重复目标:', (error as Error & { code?: string }).code)
}
console.log('保存调用次数:', calls)
tasks.clear()
```

输出：

```text
保存结果: 3
重复目标: TASK_NOT_UNIQUE
保存调用次数: 1
```

依次输出 `保存结果: 3`、`重复目标: TASK_NOT_UNIQUE`、`保存调用次数: 1`。第二次选择不唯一时没有再次保存。被选中的监听者失败时，以 `PUBLISH_FAILED` 拒绝并保留原始错误。

## 公开入口与边界

根入口 `@migaia/event-subscriber` 提供 channel、Hub、调用工具、常量与公开类型。子入口 `@migaia/event-subscriber/subscriber` 提供 `subscribeOnce`、`subscribeUntil`、`subscribeSubscriber` 和对应订阅类型。运行时只依赖 `@migaia/utils`，不依赖 DOM 或 Node；包标记为 `sideEffects: false`。

channel（事件通道）只分发当前发布的事件，不保存当前值，也不重放历史。registration（订阅登记）是一次订阅及其取消句柄。snapshot（快照）是一次发布开始时固定的目标列表。需要当前值或派生依赖时使用 `@migaia/reactive`；需要前一步结果传给下一步的中间件时使用 `@migaia/middleware-pipeline`；资源释放、队列和背压由 `@migaia/lifecycle` 或 `@migaia/resource` 负责；跨 Worker、窗口或网络的消息由 `@migaia/rpc-core` 负责。

## 创建 channel 与完整参数

`createEventChannel<T, R, S, V>(options?)` 创建一个通道。`T` 是发布值类型，`R` 是监听器结果类型，默认 `void`；`S` 是命名风格，`V` 是静态值路径配置，两者默认 `undefined`。公开选项类型为 `IEventChannelOptions<T, S, V>`。只服务于类型推导的投影类型，以发布的声明和编辑器提示为准。

| 选项              | 默认值                                | 含义和所有取值                                                                                                                                                                        |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report`          | `undefined`                           | 接收 `{ event, error }`。主要处理同步 `publish()` 返回后的监听器拒绝，也接收值路径诊断；可以同步返回或返回 Promise。缺省时进入终端诊断。同步监听器抛错由 `publish()` 聚合，不交给它。 |
| `terminalReport`  | `undefined`                           | 接收诊断错误；`report` 缺失、抛错或异步拒绝时使用。可以同步返回或返回 Promise，失败会继续交给宿主诊断。                                                                               |
| `dispatchPolicy`  | `'recursive'`                         | `'recursive'` 立即递归交付监听器内部的新发布；`'queued'` 等当前快照全部调用后再交付重入值。对应常量为 `EventDispatchPolicy.recursive`、`queued`。                                     |
| `admissionPolicy` | `'multiple'`                          | `'multiple'` 每次订阅创建独立登记；`'unique'` 按同一监听器函数的身份只保留一份登记。对应 `EventAdmissionPolicy.multiple`、`unique`。                                                  |
| `removalPolicy`   | `'handle'`                            | `'handle'` 只解除当前句柄拥有的登记；`'listener-all'` 解除同一监听器函数在该通道上的全部登记。对应 `EventRemovalPolicy.handle`、`listenerAll`。                                       |
| `publishBudget`   | `100_000`                             | 一次顶层同步发布及其嵌套发布最多调用多少个监听器，必须是正安全整数。耗尽后停止展开，抛 `PUBLISH_FAILED`；`error.detail` 记录已处理数和剩余预算。                                      |
| `throwOnAborted`  | `false`                               | `false` 时，`subscribeUntil` 使用已取消信号不会登记，返回空操作取消函数；`true` 时同步抛 `ABORTED` 的 `TypeError`。                                                                   |
| `style`           | `undefined`，即 `'subscribe-publish'` | 仅给已有操作增加方法别名。四个预设与自定义字段见下文，不改变派发或取消语义。                                                                                                          |
| `valueConfig`     | `undefined`                           | 未配置时不增加值别名。配置固定的 `readPath`、`alias` 字段，规则见“静态值路径”。                                                                                                       |

`options` 必须是对象，不能为 `null` 或数组；非法选项为 `INVALID_OPTIONS`。`report` 或 `terminalReport` 提供后必须可调用，否则为 `INVALID_REPORTER`。读取选项的 getter 抛错时，原始失败保留在错误链上。

### 通道方法与事件上下文

| 成员                            | 调用后的结果                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `subscribe(listener, options?)` | 按登记顺序添加监听器，返回可调用、可链式扩展的句柄。默认 `listener(event)` 接收下面的上下文；显式 `delivery: EventDelivery.value` 时 `listener(value)` 接收原始 payload。两者返回 `R` 或 PromiseLike，监听器必须是函数。 |
| `subscribe.options.delivery`    | 默认 `EventDelivery.context`（`'context'`），保留 payload 与上下文控制；`EventDelivery.value`（`'value'`）直接传入原始 payload，不复制或包装。其他值抛 `INVALID_OPTIONS`。                                               |
| `subscribe.options.taskId`      | 默认 `undefined`，不设置任务标签。提供时必须是非空字符串；该值由订阅调用者命名，用于之后的任务选择。                                                                                                                     |
| `publish(value)`                | 同步按入口快照调用目标，不等待 Promise，也不返回监听器结果。快照内的监听器即使中途被退订或 `clear()`，仍收到本轮；新订阅留到之后的快照。                                                                                 |
| `filterTaskId(taskId)`          | `taskId` 为订阅时设置的非空标签。返回只读选择视图 `IFilteredEventChannel`，交给并行、串行或 visitor 工具；视图没有订阅或发布方法，之后每次调用都会重新选择当前匹配项。                                                   |
| `clear()`                       | 删除全部活动登记，不执行监听器内部的用户清理函数；默认 `removalPolicy: 'handle'` 下，旧取消句柄不会移除之后的新登记。                                                                                                    |
| `size`                          | 只读的当前活动登记数。空通道发布无操作，异步多目标调用得到空数组。                                                                                                                                                       |

`unique` 模式下，重复订阅同一个监听器会得到控制同一代登记的句柄；只有首次取消生效。重复订阅的 `taskId` 和 delivery 必须与已有值相同，否则修改状态前抛 `INVALID_OPTIONS`；省略 delivery 与显式 `EventDelivery.context` 相同，省略 `taskId` 只匹配同样未设置的标签。`clear()` 或退订后重新订阅会创建新一代；`unique` 的句柄绑定原登记代，所以旧句柄不会取消新登记。Hub 和包装监听器的独立 helper 不按原始监听器身份去重。缺省 `multiple` 与 `removalPolicy: 'handle'` 组合下，每次登记可以分别取消。

不要把这种隔离套用于 `admissionPolicy: 'multiple'` 与 `removalPolicy: 'listener-all'` 的组合：尚未调用的旧句柄会按监听器函数身份移除当前全部匹配登记。即使先 `clear()`、再用同一个函数创建新登记，该旧句柄仍会移除它们。需要旧句柄与新登记隔离时，保留默认的 `handle` 移除策略；`unique` 则另有上述登记代绑定保证。

公开订阅选项类型为 `IEventSubscribeOptions`。默认/显式 context 重载使用 `IEventListener<T, R, V>`；显式 value 重载将原始 `T` 交给监听器，并接收 `R` 或 `PromiseLike<R>` 结果，必须提供 `{ delivery: EventDelivery.value }`。两种模式可在同一通道共存，调用工具沿用各自登记的模式和结果语义。

```ts
import { createEventChannel, EventDelivery, invokeTask } from '@migaia/event-subscriber'

const tasks = createEventChannel<{ id: number }, number>()
const stop = tasks.subscribe((value) => value.id, {
  delivery: EventDelivery.value,
  taskId: 'read-id'
})
console.log(await invokeTask(tasks, 'read-id', { id: 7 })) // 7
stop()
```

value 模式不附加 `abort()`、`aborted`、`abortReason`、`setTaskId()`、`taskId` 或 `valueConfig` 别名；payload 本身不被修改。登记标签仍可由 `filterTaskId()`、`invokeTask()` 选择。需要监听器内的取消、改标签或投影别名时保留默认 context。

| `IEventContext<T>` 成员  | 含义                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `value`                  | 本次发布的原始值，保持对象身份。                                                   |
| `aborted`、`abortReason` | 所属登记的实时取消状态与原因；进行中的回调也能读到更新。                           |
| `taskId`                 | 发布入口快照中的任务标签，不随当前轮的改标签操作变化。                             |
| `abort(reason?)`         | 取消当前登记，原因默认 `undefined`。幂等；已经非活动时无操作，不中断已开始的回调。 |
| `setTaskId(taskId)`      | 接收非空字符串或 `undefined`；后者清除标签。只影响之后的快照，登记非活动时无操作。 |

### 命名风格与订阅链

`EventApiStyle` 导出四个预设：`subscribePublish`、`onEmit`、`onTrigger`、`listenFire`。需要跨模块比较或保存配置时使用这些常量。

| 预设值              | 订阅        | 发布      | 取消          |
| ------------------- | ----------- | --------- | ------------- |
| `subscribe-publish` | `subscribe` | `publish` | `unsubscribe` |
| `on-emit`           | `on`        | `emit`    | `off`         |
| `on-trigger`        | `on`        | `trigger` | `off`         |
| `listen-fire`       | `listen`    | `fire`    | `unlisten`    |

自定义 `style` 是从语义到名字的对象，例如 `{ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' }`。`style.subscribe` 和 `style.publish` 必填；`style.unsubscribe` 省略时为 `'unsubscribe'`。名字必须是非空字符串、彼此不同，不能占用另一语义的名字、`subscribeOnce`、`subscribeUntil`、`filterTaskId`、`clear`、`size` 或 `__proto__`、`prototype`、`constructor`。非法配置在构造时抛 `INVALID_OPTIONS`。

保留字面量配置可用 `as const satisfies IEventApiStyleNames`。显式给出 payload 类型后，自定义 channel style 也要在第三泛型 `S` 中提供；Hub 在第二泛型提供。宽化成普通 `string` 的对象不会产生任意方法名的索引签名。预设字面量有对应的推导重载。

canonical（固定的原名）方法始终存在；别名与原名指向同一函数，不创建另一个派发器。默认风格不增加别名属性；额外别名是不可枚举、不可写、不可配置的自有数据属性。style 不增加 `flush`、队列、排空、背压或跨进程能力。

`channel.subscribe()` 返回 `IEventChannelSubscription`，`hub.subscribe()` 返回 `IEventHubSubscription`。句柄本身可调用，`handle.unsubscribe === handle`；链式 `handle.subscribe(...)` 返回同一条链，风格的订阅别名与取消别名也保持函数身份。通道及句柄的 `subscribe`/订阅别名均接受 `taskId`、delivery 选项；Hub 及句柄的 `subscribe(key, listener, options?)`/订阅别名只接受 delivery，不接受 `taskId`。取消按追加顺序的逆序执行整条链，只真正执行一次。单个释放失败原样抛出；多个失败合为 `SUBSCRIPTION_DISPOSE_FAILED`，`AggregateError.errors` 保留执行顺序。关闭后追加订阅抛 `SUBSCRIPTION_CLOSED`。

链式扩展不是事务：后一次订阅失败时，前面成功的登记仍归原句柄所有，需要调用该句柄清理。第一条登记之后的句柄别名投影失败，则回滚该登记并以 `SUBSCRIPTION_HANDLE_PROJECTION_FAILED` 保留原始失败。有限字面量事件表在同一条 Hub 链上排除已经使用的 key；同 key 的另一条独立链仍可订阅。宽 key、索引签名或运行时联合 key 保留动态广播。

## 独立订阅 helper

这些函数从 `@migaia/event-subscriber/subscriber` 导入，只要求结构兼容的 `channel.subscribe(listener, options?)`，不要求包内工厂身份。`subscribe` 必须返回函数，不能在安装尚未结束时同步交付事件；非法结构为 `INVALID_CHANNEL`。helper 保留对象方法的接收者。`subscribeOnce`、`subscribeUntil` 和对象订阅者保持 context-only，不接受 value 交付选项。

| API                                                   | 参数与行为                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribeOnce(channel, listener, options?)`          | 必填通道与函数；`options.taskId` 默认 `undefined`。第一次交付前先退订，所以同步重入、同步抛错或异步拒绝不会执行第二次。                               |
| `subscribeUntil(channel, signal, listener, options?)` | 必填通道、信号与函数；`options.taskId` 默认 `undefined`。信号取消时自动退订，手动退订也移除信号监听。取消不会中断已经开始的业务回调。                 |
| `subscribeSubscriber(channel, subscriber)`            | `subscriber` 必须是带可调用 `handle(event)` 的对象。`handle` 接收事件上下文，返回结果或 PromiseLike，并保留 `this`。缺少方法为 `INVALID_SUBSCRIBER`。 |

返回值都是同步、幂等的 `IUnsubscribe`，不附加命名风格的 `off`、`dispose`、`unlisten` 或链式扩展。要使用带风格的订阅链，直接调用 channel 的订阅方法。

`subscribeUntil` 接受原生 `AbortSignal`，也接受具有布尔 `aborted`、可选 `reason`、可调用 `addEventListener` 与 `removeEventListener` 的兼容对象；事件类型固定为 `'abort'`。非法信号为 `INVALID_SIGNAL`。已取消信号默认不创建登记；只有 canonical channel 显式设置 `throwOnAborted: true` 时抛 `ABORTED`。

对象订阅者只需实现 `IEventSubscriber.handle(event)`。旧草案的抽象 `EventSubscriber`、静态 `EVENT_NAME`（也不是 `EVENTNAME`）与 `onCall()` 不属于当前公开契约：事件来源由传入的通道决定，多事件名称由 Hub 的订阅 key 决定，不重复保存在 class 中。

## 等待异步监听器

所有 `invoke*` 先同步固定目标快照，再开始等待。它们只接受同一份物理包实例创建的 canonical channel，或允许的 `filterTaskId()` 视图；伪造对象、Hub 或另一份包副本创建的通道为 `INVALID_CHANNEL`。参数 `value` 是本次交给每个监听器的值，无额外选项。

| API                                         | 调度与返回值                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `invokeParallelSettled(channel, value)`     | 立即启动全部目标，等待全部结束，按登记顺序返回 `IListenerResult<R>[]`，与完成先后无关。监听器抛错和拒绝成为结果项。 |
| `invokeParallel(channel, value)`            | 调度相同；全部成功返回结果值数组，任一监听器失败则等全部结束后以 `PUBLISH_FAILED` 的 `AggregateError` 拒绝。        |
| `invokeSerialSettled(channel, value)`       | 前一个目标结束后才启动下一个，失败后仍继续；返回按登记顺序的结算结果。                                              |
| `invokeSerial(channel, value)`              | 调度相同；失败后仍执行后面的目标，最后聚合抛出失败，全部成功返回结果值数组。                                        |
| `invokeTaskSettled(channel, taskId, value)` | 只接收 canonical channel；先精确选择一个任务，返回它的成功或失败结果。                                              |
| `invokeTask(channel, taskId, value)`        | 精确选择相同；成功返回值，监听器失败以含一个原始失败的 `PUBLISH_FAILED` 拒绝。                                      |

结算项为 `{ status: 'fulfilled', value: Awaited<R> }` 或 `{ status: 'rejected', reason: unknown }`。常量 `EventSubscriberState.fulfilled`、`rejected` 用于判断结果，`EventSubscriberState.abort` 是信号事件名。settled 只把监听器失败变成结果，不把非法通道或任务选择错误变成结果。

串行调用不是 waterfall：所有目标收到同一个原始值，前一个返回值不会传给下一个。异步工具通过返回值交付监听器失败，不再把同一个失败送给 `report`；值路径诊断仍遵循独立的诊断规则。

`taskId` 来自订阅时的 `options.taskId` 或之后的 `event.setTaskId()`，必须是非空字符串。入口匹配数为零时同步抛 `TASK_NOT_FOUND`；多于一个时同步抛 `TASK_NOT_UNIQUE`，都发生在任何目标被执行前。错误上有可枚举的 `taskId` 与 `matchCount`。任务不是全局注册表，标签只在传入通道内选择。

### 高级 visitor

`withSnapshotEntries(channel, value, visitor)` 把本轮不可变 `IEventInvocation[]` 交给 visitor，由集成方决定调用顺序。`entry.taskId` 是快照标签，`entry.invoke()` 返回监听器原始结果或 PromiseLike，每个 entry 只准调用一次。visitor 可以同步返回或返回 Promise；它结束或拒绝后，全部 entry 关闭，之后调用抛 `INVOCATION_CLOSED`。visitor 同步抛出或异步拒绝以 `VISITOR_FAILED` 标识；可附码的原生错误保留身份和 stack，其余原值通过 `cause` 保留，entry 仍会关闭。

`invokeEachLive(channel, value, visitor)` 每次把一个 invocation 交给同步 visitor。在访问期间新追加的订阅也可以被本轮看到，每个登记最多访问一次。visitor 必须同步完成，抛错时内部遍历状态仍会释放，失败以 `VISITOR_FAILED` 标识。它只用于确实需要遍历期间看到新订阅的框架集成；普通业务优先选快照型工具。

## 多事件 Hub

`createEventHub<C, S, V>(options?)` 用事件表 `C` 关联 key 和 payload。options 只接受 `report`、`terminalReport`、`style`、`valueConfig`，默认值与含义同 channel；`report` 的参数额外带本次发布的 `key`。Hub listener 返回 `void` 或 `PromiseLike<void>`，不聚合结果；需要结果的事件另建 `createEventChannel<T, R>()`。

| 成员                                 | 行为                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `subscribe(key, listener, options?)` | key 是事件表中的字符串、数字或 symbol，listener 必须是函数。第三参只接受 delivery：默认/显式 `EventDelivery.context` 接收上下文，`EventDelivery.value` 接收该 key 的原始 payload；不接受 `taskId`。首次订阅该 key 时才创建内部 channel；返回可调用的订阅链。 |
| `publish(key, value)`                | 只向该 key 分发对应类型的值；从未订阅或已经没有登记的 key 无操作，不会创建 channel。                                                                                                                                                                         |
| `clear(key?)`                        | 指定 key 清除该事件所有登记并移除空 channel；省略时清除全部事件。                                                                                                                                                                                            |
| `size(key?)`                         | 指定 key 返回该事件的活动登记数，不存在为零；省略返回总数。总数由计数器维护，不遍历所有 key。                                                                                                                                                                |

非法 key 为 `INVALID_EVENT_KEY`，非法 listener 为 `INVALID_LISTENER`。旧句柄不会取消 `clear()` 后新创建的同名事件登记。Hub 内部固定使用 `recursive`、`multiple`、`handle`、`100_000` 调用预算与非严格的已取消准入；不暴露内部 channel，也不接受单通道策略选项。需要自选这些策略时使用 channel。`EventRemovalPolicy.listenerAll` 适用于复用相同函数身份的整体注销，例如 logger hook 的注销路径。

## 静态值路径

`valueConfig` 在构造时固定路径，把原始 payload 中的一个值附加到 context 模式的上下文，同时保留原始 `event.value` 和所有控制方法。value 模式仍直接收到原始 payload，不附加别名。它不保存、转换或重放事件。

| 字段                   | 含义                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `valueConfig.readPath` | 静态路径，类型为 `IObjectPath<T>` 或空字符串。空字符串或仅空白禁用整个投影；不读取 alias，不解析、不探测、不报告。             |
| `valueConfig.alias`    | 活动路径需要非空、无首尾空白的名字；不能与上下文成员或 `__proto__`、`prototype`、`constructor` 冲突。`resource` 不是保留名称。 |

用 `as const` 或显式的 `V` 保留路径与 alias 字面量；channel 的 `V` 是第四泛型，Hub 的是第三泛型。每轮发布或调用只探测路径一次，全部目标得到同一个投影值身份。alias 为可枚举、不可写、不可配置的自有数据属性。

路径缺失、被阻断或 getter 抛错时，报告 `VALUE_PROJECTION_FAILED`；监听器仍调用，alias 为 `undefined`。实际存在且值为 `undefined` 的叶节点成功，不报告失败。原始 getter 错误保留在原因链中。没有目标时不探测路径。这里不支持函数 selector、transform、operator、fallback 或每个监听器再懒求值一次。

## 错误与诊断

`publish()` 收集全部同步监听器失败后抛带 `PUBLISH_FAILED` 的 `AggregateError`；监听器返回的 Promise 在它返回后拒绝，则交给 `report`。同步发布不会因为迟到失败变成可等待的调用。

`report` 不存在或失败时，先尝试 `terminalReport`，再依次尝试宿主 `reportError`、`console.error`、排入微任务抛出；宿主不能排入微任务时同步抛出。报告函数本身的失败也保留在诊断错误链上，不静默丢弃。

包级错误的 `source` 为 `EVENT_SUBSCRIBER_SOURCE`，值是 `'@migaia/event-subscriber'`。输入校验保留原生 `TypeError`，发布聚合保留 `AggregateError`。原始失败通过 `errors` 与 `cause` 可达；存在监听器失败时，`cause` 是第一个失败。只有预算耗尽时，`errors` 可以为空。业务代码比较 `EventSubscriberErrorCode` 的成员，不散写码值。`EventSubscriberErrorText` 是内部文案表，不是公开导出，业务代码不能导入；锁定文案时断言实际错误的 `message`。

| 错误码成员                           | 码值                                    | 触发条件                                                      |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------- |
| `invalidListener`                    | `INVALID_LISTENER`                      | 监听器不是函数。                                              |
| `invalidReporter`                    | `INVALID_REPORTER`                      | report 或 terminalReport 不可调用。                           |
| `invalidChannel`                     | `INVALID_CHANNEL`                       | helper 的结构源无效，或调用工具收到非同包 canonical 通道。    |
| `invalidSignal`                      | `INVALID_SIGNAL`                        | 信号结构无效，或信号回调、清理失败。                          |
| `aborted`                            | `ABORTED`                               | 严格准入的通道收到已取消信号。                                |
| `invalidSubscriber`                  | `INVALID_SUBSCRIBER`                    | 对象订阅者没有可调用的 handle。                               |
| `invalidEventKey`                    | `INVALID_EVENT_KEY`                     | Hub key 不是字符串、数字或 symbol。                           |
| `taskNotFound`                       | `TASK_NOT_FOUND`                        | 任务标签匹配零个登记。                                        |
| `taskNotUnique`                      | `TASK_NOT_UNIQUE`                       | 任务标签匹配多个登记，错误带匹配数量。                        |
| `invalidTaskId`                      | `INVALID_TASK_ID`                       | 任务标签不是非空字符串。                                      |
| `invalidOptions`                     | `INVALID_OPTIONS`                       | 选项、策略、命名风格或路径配置非法。                          |
| `publishFailed`                      | `PUBLISH_FAILED`                        | 监听器失败，或同步调用预算耗尽仍有目标未交付。                |
| `visitorFailed`                      | `VISITOR_FAILED`                        | snapshot 或 live visitor 抛错，或 snapshot visitor 异步拒绝。 |
| `valueProjectionFailed`              | `VALUE_PROJECTION_FAILED`               | 活动值路径缺失、被阻断或 getter 失败。                        |
| `unhandledListenerFailure`           | `UNHANDLED_LISTENER_FAILURE`            | 迟到监听器失败到达终端诊断。                                  |
| `subscriptionClosed`                 | `SUBSCRIPTION_CLOSED`                   | 已关闭的订阅链再次追加订阅。                                  |
| `subscriptionHandleProjectionFailed` | `SUBSCRIPTION_HANDLE_PROJECTION_FAILED` | 登记后句柄别名投影失败；该登记回滚，原始失败保留。            |
| `invocationClosed`                   | `INVOCATION_CLOSED`                     | 捕获的 invocation 已执行过或已经关闭。                        |
| `subscriptionDisposeFailed`          | `SUBSCRIPTION_DISPOSE_FAILED`           | 关闭链时多个释放失败；全部仍会尝试执行。                      |

## 排查与构建

`PUBLISH_FAILED` 时展开 `error.errors`，查看原始监听器失败；只有同步预算耗尽时可以没有监听器错误。任务选择失败时检查标签与登记寿命，不要把多目标当成“任选一个”。已关闭链需要新建订阅。Promise 失败只出现在 report 而不从 `publish()` 抛出时，先确认是否属于同步返回后的拒绝。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
