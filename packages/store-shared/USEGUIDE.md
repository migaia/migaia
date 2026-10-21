# `@migaia/store-shared` 使用指南

[English](./USEGUIDE.en.md) · [定位与快速开始](./README.md)

按需要确认的行为选择完整场景；下面的代码与网站 API 示例保持一致。

| 场景                                                          | 入口               | 你会确认什么                    |
| ------------------------------------------------------------- | ------------------ | ------------------------------- |
| [附着读者而不覆盖共享值](#附着读者而不覆盖共享值)             | `sharedInt32`      | 附着保留数据，peek 与 sync 分工 |
| [跳过同值写入并拒绝非法整数](#跳过同值写入并拒绝非法整数)     | `sharedInt32`      | 同值静默，非法值拒绝            |
| [只通知读取对应下标的观察者](#只通知读取对应下标的观察者)     | `sharedInt32Array` | 通知按下标隔离                  |
| [让每个读者独立同步](#让每个读者独立同步)                     | `sharedInt32Array` | 读者不互相消费变化              |
| [更新回调失败后仍可使用共享格](#更新回调失败后仍可使用共享格) | `SharedInt32Array` | 失败保留原错且仍能更新          |
| [复制数值而不暴露共享存储](#复制数值而不暴露共享存储)         | `SharedInt32Array` | 副本与共享内存独立              |

运行任一场景前直接安装两个入口包；示例都在同一进程创建 Runtime，不需要 Worker、定时器或渲染框架。

```bash
pnpm add @migaia/store-shared @migaia/reactive
```

## 附着读者而不覆盖共享值

另一个线程更新整数后，本地运行时仍须把变化发布给自己的依赖图；直接读到共享字节，不等于已经确认通知。

复制数值会产生第二个计数器，克隆 JavaScript 包装也不能重建订阅；把 `peek()` 当成同步还会让本地版本游标保持不变。

直接安装 `@migaia/store-shared` 和 `@migaia/reactive`；`sharedInt32` 通过 `buffer` 附着并忽略所传初值，各读者用 `sync()` 推进自己的游标。

参数：`runtime` 必填，各自调用 `createRuntime()`；`initialValue` 默认 `0`，本例写者为 `7`，读者的 `999` 因传入 `buffer` 而被忽略。`buffer` 可选，省略则分配新信号布局；本例传写者的同一共享内存。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32 } from '@migaia/store-shared'

const writer = sharedInt32(createRuntime(), 7)
const reader = sharedInt32(createRuntime(), 999, writer.buffer)
console.log(reader.peek())
writer.value = 9
console.log(reader.peek(), reader.isStale())
console.log(reader.sync(), reader.sync())
writer.dispose()
console.log(reader.peek())
reader.dispose()
```

输出：

```text
7
9 true
true false
9
```

逐行输出 `7`、`9 true`、`true false`、`9`；附着保留原值，`peek()` 读到新值时游标仍过期，仅首次 `sync()` 确认变化。

每个包装独立拥有本地图与生命周期，销毁写者不影响附着读者；`peek()` 不追踪、不发布，未启用 `watch()` 时由读者安排同步，本例在同一进程创建两个运行时。

## 跳过同值写入并拒绝非法整数

计数器观察者应在整数变化时重新执行，而重复赋相同值不应产生额外更新；非法输入也不应悄悄变成另一个共享值。

无条件通知会为未变状态重复工作，位运算强制转换则会截断小数、回绕大整数，掩盖调用者提供了不支持的值。

`sharedInt32` 校验 `int32` 写入并跳过同值；本例用响应包 `createRuntime` 的 `schedulerStrategy` 同步执行效果以固定输出，共享包不拥有或修改运行时调度。

参数：`runtime` 必填；`createRuntime({ schedulerStrategy: (run) => run() })` 的字段属于 reactive，使本例效果同步执行，不是信号选项。`initialValue` 默认 `0`，本例为 `5`；未传 `buffer`，新建内存。`value` 写入只接受 int32。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32 } from '@migaia/store-shared'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const counter = sharedInt32(runtime, 5)
let runs = 0
const observer = runtime.effect(() => {
  runs++
  void counter.value
})
counter.value = 5
console.log(runs, counter.peek())
try {
  counter.value = 1.5
} catch (error) {
  console.log(error instanceof RangeError, (error as { code: string }).code)
}
console.log(counter.peek())
counter.value = 6
console.log(runs, counter.peek())
observer.dispose()
counter.dispose()
```

输出：

```text
1 5
true INVALID_OPTION
5
2 6
```

逐行输出 `1 5`、`true INVALID_OPTION`、`5`、`2 6`；同值赋值及被拒绝的小数写入都未改变存储值或效果执行次数。

合法写入为 `[-2147483648, 2147483647]` 内的整数，变化提交会本地发布，同值写入不推进共享版本，收到通知后的效果执行时机由传入的运行时控制。

## 只通知读取对应下标的观察者

共享数组存放多个独立坐标，更新其中一项应刷新对应观察者，同时保留其他下标读者的状态。

只观察整数组版本会让任意坐标变化都使全部订阅者失效，另建依赖表又会重复运行时已有的归属与清理职责。

`sharedInt32Array` 在效果内按 `get(index)` 追踪下标；本例直接安装响应包，用其运行时 `schedulerStrategy` 同步展示，该选项不是共享数组构造字段。

参数：`runtime` 和 `length` 必填，本例长度 `2`；`options` 默认 `{}`，`initialValues` 可选、无默认，本例初始化为 `[10, 20]`。`get/set/update` 的 `index` 必填；`update` 的纯 updater 必填。`schedulerStrategy` 是 reactive 的运行时调度选项。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const coordinates = sharedInt32Array(runtime, 2, { initialValues: [10, 20] })
let firstRuns = 0
let secondRuns = 0
const first = runtime.effect(() => {
  firstRuns++
  void coordinates.get(0)
})
const second = runtime.effect(() => {
  secondRuns++
  void coordinates.get(1)
})
coordinates.set(1, 22)
console.log(firstRuns, secondRuns)
coordinates.set(1, 22)
console.log(firstRuns, secondRuns)
coordinates.update(0, (current) => current + 1)
console.log(firstRuns, secondRuns)
first.dispose()
second.dispose()
coordinates.dispose()
```

输出：

```text
1 2
1 2
2 2
```

逐行输出 `1 2`、`1 2`、`2 2`；下标 `1` 只唤醒自己的读者，再写 `22` 不唤醒任何读者，更新下标 `0` 只唤醒第一个读者。

追踪只为被读下标物化图源，追踪外的 `get()` 直接读共享内存；销毁效果释放订阅，销毁数组释放其余本地图源。

## 让每个读者独立同步

两个消费者读取同一共享数组，即使第一个消费者已经完成同步，第二个也仍须检测到写者的更新。

由首个读者清除的共享脏标志会消费其他人的通知，仅读取当前字节也无法记录各消费者已经确认哪些格版本。

`sharedInt32Array` 为各附着包装保留自己的代次与格游标，共享 `buffer` 并保持相同固定长度，各读者分别调用 `sync()`，响应包须直接安装。

参数：`runtime` 和固定 `length` 必填，三实例均为 `3`；`options.buffer` 可选，本例两个读者传入同一写者 buffer。`sync(index?)` 的下标可选，省略表示完整同步；`snapshot()` 无参数。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'

const writer = sharedInt32Array(createRuntime(), 3)
const first = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })
const second = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })
writer.set(0, 7)
writer.set(2, 9)
console.log(first.sync(), second.sync())
console.log(first.sync(), second.sync())
console.log(JSON.stringify(Array.from(second.snapshot())))
first.dispose()
second.dispose()
writer.dispose()
```

输出：

```text
2 2
0 0
[7,0,9]
```

逐行输出 `2 2`、`0 0`、`[7,0,9]`；每个读者独立计入两个变化格，没有新写入时再次完整同步均返回零。

完整 `sync()` 也计入没有观察者的变化下标，代次未变时直接返回，否则扫描 `length` 个格并批处理本地通知；`sync(index)` 只比较指定格，返回 `0` 或 `1`。

## 更新回调失败后仍可使用共享格

更新回调计算新整数时可能拒绝应用数据，调用者既需要原始失败，也需要随后继续更新同一个共享格。

在持有序列锁时执行应用回调，会让抛错留下奇数锁版本；每次失败都重新包装错误还会丢失原生错误身份。

`SharedInt32Array.update` 在锁外计算再尝试期望值提交，本例提交前抛出预建的本地 `TypeError`，随后用纯函数递增，并直接安装响应包以取得 `createRuntime`。

参数：类构造的 `runtime` 和 `length` 必填，`options` 默认 `{}`；本例 `initialValues: [7]` 只在新内存生效。`update(index, updater)` 两参数均必填，回调输入为当前值，返回 int32；竞争时回调可重试，失败时保留原错。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { SharedInt32Array } from '@migaia/store-shared'

const values = new SharedInt32Array(createRuntime(), 1, { initialValues: [7] })
const original = new TypeError('invalid increment')
try {
  values.update(0, () => {
    throw original
  })
} catch (error) {
  console.log(error === original, error instanceof TypeError, (error as { code: string }).code)
}
console.log(values.get(0))
console.log(values.update(0, (current) => current + 1))
values.dispose()
```

输出：

```text
true true UPDATE_FAILED
7
8
```

逐行输出 `true true UPDATE_FAILED`、`7`、`8`；抛出对象就是原始 `TypeError`，失败回调没有提交，随后同格更新仍能完成。

未编码且可扩展的原生错误原位附码，冻结或非错误值保留在 `cause`，完整外包身份保留原归属；争用可能重调更新回调，成功回调须纯净且可重复。

## 复制数值而不暴露共享存储

导出流程需要一份可编辑且不影响实时共享状态的本地数组，随后共享写入也不应改变此前副本。

在共享底层上另建类型数组视图仍会引用同一字节，把多格读取当事务还会暗示独立写者并不提供的跨格一致性。

`SharedInt32Array.snapshot` 分配独立的非共享 `Int32Array` 并逐格一致读入，先用直接安装的响应包运行时构造数组，再保留或修改返回副本。

参数：类构造的 `runtime` 和 `length` 必填，本例为 `2`；`options.initialValues` 可选，本例为 `[4, 5]`。`snapshot()` 不接收参数；`set(index, value)` 两项均必填，校验下标和 int32 值。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { SharedInt32Array } from '@migaia/store-shared'

const values = new SharedInt32Array(createRuntime(), 2, { initialValues: [4, 5] })
const copy = values.snapshot()
console.log(JSON.stringify(Array.from(copy)))
copy[0] = 99
values.set(1, 8)
console.log(JSON.stringify(Array.from(copy)), JSON.stringify(Array.from(values.snapshot())))
console.log(copy.buffer instanceof SharedArrayBuffer)
values.dispose()
```

输出：

```text
[4,5]
[99,5] [4,8]
false
```

逐行输出 `[4,5]`、`[99,5] [4,8]`、`false`；修改副本未改变共享下标 `0`，写入共享下标 `1` 也未改变此前副本。

返回结果是调用者拥有的普通内存，各格分别一致读取，但不同格的读取之间可能发生并发写入，`snapshot()` 不承诺整数组原子事务。

## 契约细节

### 归属、入口与运行环境

本包只有根入口，导出两类、两工厂和错误身份工具，不提供 Store、Worker、消息协议或对象序列化实现。它依赖 `@migaia/reactive`、`@migaia/lifecycle`、`@migaia/utils`；运行时无 DOM、Node 或 Worker 绑定。调用方先创建 `IRuntime`，再创建共享包装实例。

`sharedInt32` 等价于调用 `new SharedInt32Signal`，`sharedInt32Array` 等价于调用 `new SharedInt32Array`。类也公开，供类型标注或 `instanceof` 使用。`SharedWaitMode` / `ISharedWaitMode` 已移除，没有兼容别名；旧导入需要迁移，`watch()` 不再接受模式选择参数。

共享的是 `SharedArrayBuffer`，每个 Runtime 各自创建包装对象。同一 JS 对象只能归属一个 Runtime；归属由 reactive 的所有权系统维护，不能把一个对象登记到另一个 Runtime。跨线程传 `.buffer`，不传包装对象；接收方使用相同长度和 buffer 附着。附着不会重新初始化数据，释放一个包装对象也不释放其他包装对象。

浏览器使用共享内存通常需要跨源隔离和相应的 COOP/COEP 响应头；宿主必须提供 `SharedArrayBuffer`、`Atomics` 和所需的整数类型数组。`watch()` 还要求原生 `Atomics.waitAsync`。只需同线程状态时可用普通响应式信号；偶尔传少量跨线程消息时，`postMessage` 仍是更简单的接入方式。字符串、对象、嵌套结构、浮点数和超出 int32 的整数不在本包存储范围内。

### 创建与布局

| 参数                                         | 必填 / 默认        | 契约                                                   |
| -------------------------------------------- | ------------------ | ------------------------------------------------------ |
| 两工厂的 `runtime: IRuntime`                 | 必填，无默认       | 追踪与错误报告的归属 Runtime                           |
| `sharedInt32` 的 `initialValue: number`      | 可选，`0`          | 仅新建 buffer 时校验并写入；传入已有 buffer 时忽略     |
| `sharedInt32` 的 `buffer: SharedArrayBuffer` | 可选，新建 32 字节 | 附着已有信号布局；不覆盖数据                           |
| `sharedInt32Array` 的 `length: number`       | 必填，无默认       | 非负整数；长度在构造后不变                             |
| 数组 `options`                               | 可选，`{}`         | 必须为非 null 对象；读取字段失败时保留原错误为 `cause` |
| `options.buffer: SharedArrayBuffer`          | 可选，按长度分配   | 附着已有数组布局；忽略 `initialValues` 的内容          |
| `options.initialValues: Iterable<number>`    | 可选，无默认       | 仅新建 buffer 使用；按顺序填充所需前缀，其余格保持零   |

`initialValues` 只消费最多 `length` 个值，到达长度后沿原生 IteratorClose 结束原迭代器；长度为零不拉取任何值。遍历或值校验失败以 `INVALID_OPTION` 的 `RangeError` 暴露，保留原因为 `cause`。传入 buffer 时内容不参与初始化，但构造器仍会读取两个 options 字段。

当前 ABI 的 header revision 为 **1**：包含 magic、revision、kind、ready 等字段。附着时校验这些字段，数组还校验长度；旧布局、错误类型或未完成初始化的布局不会自动兼容。信号总计 32 字节，值为 int32，seq 为对齐的 int64。数组头部和 64 位 generation 占 32 字节，后接 `length` 个 int32 值，按 8 字节对齐后接 `length` 个 int64 seq；布局大小为 `align8(32 + length * 4) + length * 8`。

非共享 buffer、非法长度、容量换算溢出或不匹配的 header 抛 `RangeError`（`INVALID_OPTION`）；buffer 小于所需大小抛 `RangeError`（`BUFFER_TOO_SMALL`）。数组容量校验包含安全整数与 Int32Array slot 空间上限。构造器不扫描全部数组 seqlock；每格的响应式基线在首次被追踪读取时建立。

### 共享信号的全部成员

`SharedInt32Signal` 实现 `IObservable` 和 `IDisposable`。

| 成员                                       | 签名 / 含义                                                   |
| ------------------------------------------ | ------------------------------------------------------------- |
| `runtime`、`buffer`                        | 只读的归属 Runtime 与共享内存                                 |
| `subs`                                     | `ReadonlySet<IObserver>`，由 reactive 维护的观察者视图        |
| `version`                                  | 响应式图内的 `number` 版本，不是共享 seq                      |
| `disposed`                                 | 是否已释放                                                    |
| `value`                                    | getter/setter；读时一致读、发布远端变化并追踪；写时校验 int32 |
| `peek(): number`                           | 一致读，不追踪、不推进已观察游标、不通知                      |
| `sync(): boolean`                          | 版本变化才推进游标、通知本 Runtime，并返回 `true`             |
| `watch(scheduler?: IScheduler): IDisposer` | 启动自动同步，返回停止函数                                    |
| `isStale(): boolean`                       | 比较共享版本与本地游标，不推进游标                            |
| `onObserved()`、`onUnobserved()`           | 满足图协议的空钩子                                            |
| `dispose(): void`                          | 幂等地停 watch 并断开图源                                     |

`value` 的 getter 在发布变化后可能同步触发其他写者，因此返回前会在必要时重读。setter 成功提交后先唤醒远端，再通知本地图源；相同值不推进版本、不通知。`peek()` 可看到远端新值，而 `isStale()` 仍为 `true`；读取共享字节和向响应式图发布是两个动作。

释放后访问 `value`、`peek()`、`sync()`、`watch()` 抛 `SIGNAL_DISPOSED`。`isStale()` 不做 active 校验，元数据仍可访问，但一致读本身仍可能触及争用上限，不能据此保证 `isStale()` 永不抛错。

### 共享数组的全部成员

`SharedInt32Array` 本身实现 `IDisposable`，不是整体 `IObservable`，没有整体 `isStale()`。每个被观察的下标使用私有图源。

| 成员                                       | 签名 / 含义                                              |
| ------------------------------------------ | -------------------------------------------------------- |
| `runtime`、`buffer`、`length`、`disposed`  | 只读归属、内存、长度与释放状态                           |
| `get(index: number): number`               | 追踪上下文中同步该格并登记依赖；其他上下文直接一致读     |
| `set(index: number, value: number): void`  | 校验后提交；相同值静默跳过                               |
| `update(index, updater): number`           | `updater: (current: number) => number`，返回提交后的新值 |
| `sync(index?: number): number`             | 指定格返回 `0` / `1`；无参数返回本轮变化的下标数         |
| `watch(scheduler?: IScheduler): IDisposer` | 监听数组头部 generation，唤醒后完整同步                  |
| `snapshot(): Int32Array`                   | 每格一致读到新分配的普通、非共享数组                     |
| `dispose(): void`                          | 幂等地停止 watch，断开全部已物化 cell                    |
| `assertActive(): void`                     | 已释放则抛 `ARRAY_DISPOSED`                              |

`get`、`set`、`update`、`sync(index)` 先校验 active，再要求下标为 `[0, length)` 内整数，否则抛 `RangeError`（`INDEX_OUT_OF_RANGE`）。未在 Effect/Computed 等追踪上下文中调用的 `get()` 不物化 cell，不推进数组观察游标；追踪读取才按需建立并复用 cell。最后一个观察者退订会立即回收 cell；尚未提交订阅的投机读取由所属 Runtime 的 idle 清理阶段回收，默认使用微任务。

`update()` 在锁外调用 updater，校验返回 int32，再按读到的当前值进行 CAS；竞争失败会重新读取并重新调用，最多尝试 65536 次。updater 应为可安全重试的纯函数，不应夹带不可逆副作用。它抛错不会把锁留在奇数状态；错误身份规则见下表。

`snapshot()` 的副本可独立修改；它只承诺**每格**的一致读，不承诺所有格来自同一原子事务。释放后高层 `get/set/update/sync/watch/snapshot/assertActive` 抛 `ARRAY_DISPOSED`。

### 同步、watch 与独立读者

高层本地写入通过 canonical `createSourceBinding` 的 `source.notify()` 发布已物化的图源，并更新共享版本、唤醒远端。另一 Runtime 的 Effect 不会仅因共享内存变化就自行重跑：接收方须 `sync()` 或 `watch()` 发布变化。信号 `value` 和数组追踪读取可顺带拉取所读位置；`peek()` 和非追踪的 `get()` 只读字节。

每个数组实例拥有独立的 generation 和逐格版本游标。`sync()` 未见 generation 变化直接返回 `0`；变化后完整扫描 `length` 个 seqlock，在一次 `runtime.batch()` 内发布本地变化，统计所有变化下标，包括没有观察者的格。扫描为 O(length)，`sync(index)` 只检查一格；没有被一个读者清除、供其他读者共享的 dirty bitmap。本地发布不会提前把整代标为已扫描，避免掩盖其他下标的远端写入。

`watch(scheduler?)` 固定使用原生 `Atomics.waitAsync`，不提供轮询模式；缺少它时同步抛 `ENV_UNSUPPORTED`，由调用方从自己的消息循环或定时器 pump `sync()`。同步 `Atomics.wait` 会阻塞，不能代替主线程的异步 watch。

首个活动 watch 捕获 scheduler，省略时使用 `systemScheduler`；活动期间重复调用返回同一停止函数并保留首次 scheduler。停止幂等，停止后可以启动新的 watch。scheduler 负责唤醒之间的零延迟让出和取消，不替代原生等待；传入自定义调度器时可从 `@migaia/utils/scheduler` 导入 `IScheduler` 或 `systemScheduler`，直接导入该包时须直接安装 `@migaia/utils`。

watch 开始时就可能同步发布已有变化。每轮先捕获等待版本，再 `sync()` 对账窗口内写入；期间再次写入会使等待返回 `not-equal`，不会被当作新基线吞掉。停止或 dispose 会取消已排任务并 notify 挂起的等待，使其尽快 settle，停止后的回调不会重启循环。watch 失败只经所属 Runtime 的 `reportError` 报告，宿主诊断由该 Runtime 的 adapter 负责。

### 底层组合接口

以下接口为已有底层组合保留，不是业务代码的首选入口：

| 方法                                                                    | 规则                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `readCell(index): { readonly value: number; readonly version: bigint }` | 原始 seqlock 一致读，不追踪                                                                       |
| `writeCell(index, value, expected?): bigint \| undefined`               | `expected?: number` 是期望当前值；省略为无条件写，提交返回新版本，同值或 CAS 不符返回 `undefined` |
| `notifyWaiters(): void`                                                 | 推进头部 generation 并唤醒数组 watcher                                                            |
| `recordObservedVersion(index, version: bigint): void`                   | 只复制数组级观察游标，不发布已有 cell                                                             |

这些低层方法不提供 active、下标或 int32 校验，调用方自行保证前提。成功 `writeCell()` 后应先 `notifyWaiters()`，再 `sync(index)`，复用正常发布路径；不要先调用 `recordObservedVersion()` 跳过游标差异，否则已有本地 cell 可能漏掉通知。

### seqlock 与争用边界

每格对齐的 int64 seq 同时表示版本和锁：偶数为稳定值，奇数表示写者持锁。读取按“读偶数 before → 读 value → 读 after”的顺序，只有 before 与 after 相等才接受这组值与版本。写入先用 CAS 把偶数变成奇数；校验 expected、跳过同值或写值后，把锁释放为相应偶数。成功改变值时版本推进两步；持锁期间不执行用户回调。

每轮最多自旋 65536 次；用完后可阻塞的线程通过 `Atomics.wait` 至多等待 1 ms，不允许阻塞的线程继续下一轮。约 1 秒持续无法一致读或取得写锁会抛 `CONTENTION_LIMIT`；`update()` 的 CAS 重试也有 65536 次上限。该错误可来自持续活跃竞争、延迟的写者或遗留的奇数锁，**错误本身不证明写者已经崩溃**。先检查写入方和争用；若确认写者终止并遗弃了锁，本包不会自动修复，应协调各端放弃旧 buffer 后重建。

高层初始化和写入只接受 `[-2147483648, 2147483647]` 范围内整数，不使用 `value | 0` 静默截断。例如浮点数或 `2 ** 31` 会被拒绝，已提交的共享值不会因此被替换。

### 错误身份与处置

`STORE_SHARED_SOURCE` 是字符串常量 `'@migaia/store-shared'`。`StoreSharedErrorCode` 是下表常量对象，`IStoreSharedErrorCode` 为其值的联合类型。

| 属性 / code                              | 场景与处置                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `signalDisposed` / `SIGNAL_DISPOSED`     | 信号高层读写已释放；重新附着一个新实例                                             |
| `arrayDisposed` / `ARRAY_DISPOSED`       | 数组高层读写已释放；创建新包装对象                                                 |
| `bufferTooSmall` / `BUFFER_TOO_SMALL`    | 构造期 buffer 太小；改用正确容量                                                   |
| `indexOutOfRange` / `INDEX_OUT_OF_RANGE` | 下标越界或非整数；修正下标                                                         |
| `contentionLimit` / `CONTENTION_LIMIT`   | 一致读、占锁或 CAS 持续争用到限；检查竞争，确认遗弃锁后才重建                      |
| `envUnsupported` / `ENV_UNSUPPORTED`     | watch 缺少原生 waitAsync；调用方改用手动 sync                                      |
| `updateFailed` / `UPDATE_FAILED`         | updater 抛出未编码错误；修正回调，锁外失败不妨碍后续写入                           |
| `invalidOption` / `INVALID_OPTION`       | 非法 options/buffer/长度/布局、初值物化失败、int32 越界或 updater 非函数；修正输入 |

本包校验通常保留 `RangeError`，释放、争用和缺少 waitAsync 使用 `Error`。未编码、可附码的 native updater Error 原位得到 `UPDATE_FAILED`，不替换原对象或 stack；冻结错误和非 Error 抛出值保留在包装错误的 `cause` 上。已有完整 foreign `source/code` 的错误保留其原 owner 和身份，因此不能假设每个 updater 失败都带本包 source。

`createStoreSharedError(code, message, options?)` 与 `createStoreSharedRangeError(code, message, options?)` 分别构造带身份的 Error、RangeError，供上层组合复用。两者 `code: IStoreSharedErrorCode` 和 `message: string` 必填，无默认；`options?: { readonly cause?: unknown }` 可选，无默认。仅当 cause 不为 undefined 时传入原 cause，再通过 `attachErrorIdentity` 附加 source/code，不重写 stack。

### Worker 接入、退出与排查

主线程创建 Runtime 与包装对象，通过自己的消息协议把 buffer 和数组长度交给 Worker；Worker 创建独立 Runtime 并附着。需要响应式绘制的一方对相应位置建立 Effect，并选择 watch 或在已有循环里 sync。SAB 共享内存本身不会被结构化克隆为另一份数据；包装对象、渲染函数和 Runtime 不应作为共享实例传递。

关闭时由宿主停止 Effect、watch 和自己的 timer，dispose 本地包装对象，再终止实际 Worker；Worker 内自建的资源也由该宿主负责。定时 sync 属于调用方的调度决策，不是本包的隐式降级。

已读到新字节但界面没重跑时，检查是否只用了 peek 或非追踪 get，以及接收方是否发布了 sync。waitAsync 不可用时分支处理 `ENV_UNSUPPORTED`。值域错误检查整数与范围；完整 sync 的工作量过大时，可在已知下标的路径使用 sync(index)。包装对象释放后需要新实例，不应复用已释放实例。

### 包内维护命令

`fmt`、`lint`、`typecheck`、`typecheck:test`、`test` 是已有脚本。已有测试覆盖 seqlock、跨 Runtime 同步、watch 生命周期、独立游标与错误身份；命令结果应以实际执行为准。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
