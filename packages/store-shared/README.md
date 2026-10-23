# `@migaia/store-shared`

[English](./README.en.md)

用 SharedArrayBuffer 与 Atomics 共享定长 int32 状态，并在各 Runtime 内按实际读取位置追踪与发布变化。

## 你可能遇到过

- 另一个 Runtime 已经写入，界面仍没重跑，根因是共享字节变化没有发布到接收方的依赖图。
- 一个坐标变化让所有观察者重跑，根因是只维护整数组通知，没有按读取下标追踪。
- 首个消费者同步后其他消费者漏报，根因是把共享脏标志当成每个读者的观察游标。
- 并发递增丢值或回调失败后写不动，根因是把读改写拆开，或在持锁时执行用户回调。
- 导出副本被后续写入改变，根因是新建的类型数组视图仍指向同一共享内存。

## 为什么选它

- **共享值和通知游标分开处理。** 复制计数器会产生两份状态，把 peek 当同步又会漏发布；信号附着现有 buffer，peek 不推进游标，sync 明确确认变化。[运行证明](./USEGUIDE.md#附着读者而不覆盖共享值)。
- **数组依赖落在实际读取的下标。** 只订阅整数组版本会让无关坐标一起重跑；追踪 get(index) 才物化对应 cell，同值提交静默跳过。[运行证明](./USEGUIDE.md#只通知读取对应下标的观察者)。
- **首个读者不会消费其他读者的变化。** 共享脏标志被清除后其他人可能漏报；每个包装保留 generation 和逐格游标，分别完成 sync。[运行证明](./USEGUIDE.md#让每个读者独立同步)。
- **失败回调不会留下用户代码持有的锁。** 在锁内计算会让抛错破坏后续写入；update 在锁外计算再 CAS，并保留原错误身份或 cause。[运行证明](./USEGUIDE.md#更新回调失败后仍可使用共享格)。
- **导出副本不再别名实时存储。** 另建同 buffer 视图仍共享字节；snapshot 分配普通 Int32Array，逐格一致读，修改副本与共享值互不影响。[运行证明](./USEGUIDE.md#复制数值而不暴露共享存储)。

## 从这里开始

在两个独立 Runtime 中附着同一整数，分别观察字节与同步游标：

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

接着看[按下标追踪](./USEGUIDE.md#只通知读取对应下标的观察者)和[多个读者独立同步](./USEGUIDE.md#让每个读者独立同步)；需要自动推送时，先确认宿主支持 waitAsync，再阅读契约中的 watch。

## 手写时的隐患

原生共享内存可以表达这些操作，但还需要明确原子更新、快照和发布边界。以下只展示隐患，进行类型检查，不运行：

```ts doc-test=check
const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
const value = new Int32Array(buffer)
const before = Atomics.load(value, 0)
Atomics.store(value, 0, before + 1) // 隐患：分开的读、写不是原子递增，并发写者会丢失更新。
const copy = new Int32Array(buffer) // 隐患：新视图仍别名同一内存，不是独立快照。
const latest = Atomics.load(value, 0) // 隐患：读到新字节不会自动发布给接收方的响应式图。
void copy
void latest
```

array.update 在锁外计算后 CAS，snapshot 分配独立内存，sync 把远端变化接入本地图。只有零散跨线程消息时，无须因此引入共享状态。

## 三分钟心智模型

| 你要处理的问题           | 对应工具                            |
| ------------------------ | ----------------------------------- |
| 共享一个 int32           | sharedInt32 / SharedInt32Signal     |
| 共享定长整数坐标或标志位 | sharedInt32Array / SharedInt32Array |
| 把远端变化发布给本地图   | sync；支持时可用 watch              |
| 只看当前字节，不确认通知 | signal.peek；追踪外的 array.get     |
| 带竞争重试的读改写       | array.update，回调保持纯净          |
| 取一份可独立编辑的数组   | array.snapshot                      |

“buffer”是多方共享的原始内存；“包装”是在一个 Runtime 内的 JS 对象；“seq”是每格的版本与锁；“generation”提示数组可能有变化；“游标”记录本读者已确认的版本；“cell”是被追踪下标的本地图源。共享内存不等于共享 Runtime 或共享订阅。

## 典型场景

| 场景                         | 怎么组合           | 详细说明                                               |
| ---------------------------- | ------------------ | ------------------------------------------------------ |
| 附着读者而不覆盖共享值       | `sharedInt32`      | [完整示例](./USEGUIDE.md#附着读者而不覆盖共享值)       |
| 跳过同值写入并拒绝非法整数   | `sharedInt32`      | [完整示例](./USEGUIDE.md#跳过同值写入并拒绝非法整数)   |
| 只通知读取对应下标的观察者   | `sharedInt32Array` | [完整示例](./USEGUIDE.md#只通知读取对应下标的观察者)   |
| 让每个读者独立同步           | `sharedInt32Array` | [完整示例](./USEGUIDE.md#让每个读者独立同步)           |
| 更新回调失败后仍可使用共享格 | `SharedInt32Array` | [完整示例](./USEGUIDE.md#更新回调失败后仍可使用共享格) |
| 复制数值而不暴露共享存储     | `SharedInt32Array` | [完整示例](./USEGUIDE.md#复制数值而不暴露共享存储)     |

## 安装

```bash
pnpm add @migaia/store-shared @migaia/reactive
```

本页和使用指南直接导入 createRuntime，因此消费项目需直接安装 @migaia/reactive。包自身还依赖 @migaia/lifecycle、@migaia/utils；示例无需 Worker 或 DOM，使用同进程独立 Runtime 展示共享语义。跨线程接入见契约。

## 常用 API

| API                                  | 什么时候用                  |
| ------------------------------------ | --------------------------- |
| sharedInt32 / SharedInt32Signal      | 创建或附着单个共享整数      |
| sharedInt32Array / SharedInt32Array  | 创建或附着定长共享整数数组  |
| signal.value / array.get / array.set | 在本 Runtime 追踪读、发布写 |
| array.update / array.snapshot        | 可重试读改写，或取独立副本  |
| sync / watch                         | 手动或自动发布远端变化      |
| dispose                              | 停止等待并断开本地图源      |

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

`STORE_SHARED_SOURCE` 是字符串常量 `'store.shared'`。`StoreSharedErrorCode` 是下表常量对象，`IStoreSharedErrorCode` 为其值的联合类型。

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
