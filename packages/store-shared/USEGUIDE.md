# `@migaia/store-shared` 使用指南

本指南逐个导出列出完整签名、边界行为与错误码。包的定位、安装与最小示例见 [README.md](./README.md)。

## 目录

1. [导入与前置条件](#1-导入与前置条件)
2. [`SharedInt32Signal` / `sharedInt32` 完整参考](#2-sharedint32signal--sharedint32-完整参考)
3. [`SharedInt32Array` / `sharedInt32Array` 完整参考](#3-sharedint32array--sharedint32array-完整参考)
4. [`SharedWaitMode` 完整参考](#4-sharedwaitmode-完整参考)
5. [错误身份：`StoreSharedErrorCode` / `STORE_SHARED_SOURCE` / `createStoreSharedError` / `createStoreSharedRangeError`](#5-错误身份)
6. [Seqlock：并发读写的正确性保证](#6-seqlock并发读写的正确性保证)
7. [跨线程同步：`sync()` 与 `watch()`](#7-跨线程同步sync-与-watch)
8. [脏页 bitmap：`SharedInt32Array` 的稀疏同步](#8-脏页-bitmapsharedint32array-的稀疏同步)
9. [响应式集成细节](#9-响应式集成细节)
10. [错误一览表](#10-错误一览表)
11. [生产环境完整示例](#11-生产环境完整示例)
12. [常见问题排查](#12-常见问题排查)
13. [构建、格式化与测试](#13-构建格式化与测试)

---

## 1. 导入与前置条件

```ts
import { createRuntime } from '@migaia/reactive';
import {
  sharedInt32,
  SharedInt32Signal,
  sharedInt32Array,
  SharedInt32Array,
  SharedWaitMode,
  type ISharedWaitMode,
  StoreSharedErrorCode,
  type IStoreSharedErrorCode,
  STORE_SHARED_SOURCE,
  createStoreSharedError,
  createStoreSharedRangeError
} from '@migaia/store-shared';
```

包只有一个导出入口（`.`），没有子路径划分。`sharedInt32`/`sharedInt32Array` 是推荐的创建方式；`SharedInt32Signal`/`SharedInt32Array` 类本身也导出，供需要 `instanceof` 判断或类型标注的场景使用。

使用前必须先有一个 `@migaia/reactive` 的 `Runtime`（`createRuntime()` 的返回值）——每个共享对象构造时都会向传入的 `Runtime` 登记归属（`claimOwnership`），且构造过程会读取该 `Runtime` 的内部版本时钟（`internalsOf(runtime).clock.next()`）。

**运行环境要求**：`SharedArrayBuffer` 在浏览器里通常需要页面处于[跨源隔离](https://developer.mozilla.org/en-US/docs/Web/API/crossOriginIsolated)状态（`COOP`/`COEP` 响应头）才可用；Node.js/Bun/Deno 默认可用。`.watch()` 额外要求 `Atomics.waitAsync` 存在，见 [§7](#7-跨线程同步sync-与-watch)。

---

## 2. `SharedInt32Signal` / `sharedInt32` 完整参考

### 2.1 构造

```ts
function sharedInt32(
  runtime: IRuntime,
  initialValue?: number,
  buffer?: SharedArrayBuffer
): SharedInt32Signal;

class SharedInt32Signal implements IObservable, IDisposable {
  constructor(runtime: IRuntime, initialValue?: number, buffer?: SharedArrayBuffer);
}
```

`sharedInt32(runtime, initialValue, buffer)` 就是 `new SharedInt32Signal(runtime, initialValue, buffer)` 的薄封装，两者行为完全一致。

| 参数           | 类型                | 必填性 | 默认值   | 说明                                                                                                        |
| -------------- | ------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------- |
| `runtime`      | `IRuntime`          | 必填   | 无       | 该信号归属的 `Runtime`，决定它在哪张响应式图里被追踪、通知                                                  |
| `initialValue` | `number`            | 可选   | `0`      | 新建 buffer 时写入的初始值，必须是合法 `int32`（见 [§6.3](#63-值域校验)）；**传了 `buffer` 时此参数被忽略** |
| `buffer`       | `SharedArrayBuffer` | 可选   | 新建一块 | 传入已有 buffer 表示"附着"到另一个实例已经在用的那块内存，两边此后读写同一份数据                            |

边界行为：

- `buffer` 不是 `undefined` 也不是 `SharedArrayBuffer` 实例 → 抛 `TypeError`（`code: 'INVALID_OPTION'`，消息 `[store] shared buffer must be a SharedArrayBuffer`）。
- 未传 `buffer` 时新建一个大小为 `2 * Int32Array.BYTES_PER_ELEMENT`（8 字节）的 `SharedArrayBuffer`，并把校验过的 `initialValue` 写入其中；传入的 `buffer` 小于这 8 字节 → 抛 `RangeError`（`code: 'BUFFER_TOO_SMALL'`，消息 `[store] shared signal buffer is too small`）。
- `initialValue` 不是整数或超出 `[-2147483648, 2147483647]` → 抛 `RangeError`（`code: 'INVALID_OPTION'`，消息 `[store] shared signal value must be an int32, received <value>`）。

### 2.2 实例成员

```ts
class SharedInt32Signal implements IObservable, IDisposable {
  readonly runtime: IRuntime;
  readonly buffer: SharedArrayBuffer;
  readonly subs: ReadonlySet<IObserver>;
  get version(): number;
  get disposed(): boolean;
  get value(): number;
  set value(next: number);
  peek(): number;
  sync(): boolean;
  watch(): IDisposer;
  onObserved(): void;
  onUnobserved(): void;
  isStale(): boolean;
  dispose(): void;
}
```

- **`runtime`** —— 构造时传入的 `Runtime`，只读字段。
- **`buffer`** —— 底层共享内存，只读字段；把它传给另一个线程/`Runtime`（例如 `postMessage`）即可共享同一份数据。
- **`subs`** —— 当前观察本节点的 `IObserver` 集合（只读视图），由 `@migaia/reactive` 的追踪系统维护，一般不需要直接读取。
- **`version`**（getter）—— 该节点在所属 `Runtime` 响应式图里的版本号（`readVersion(this, initialVersion)`）。**不是**共享内存里的 seq，是包了一层图内版本记账之后的值,用于响应式系统内部判断"是否需要重新计算",业务代码通常不需要直接读它。
- **`disposed`**（getter）—— 是否已 `dispose()`。
- **`value`**（getter）—— 执行顺序：`#assertActive()` → 一致读一次（不含在 getter 里独立暴露，但 `sync()` 内部会做）→ `sync()`（若共享内存版本号与本地记录不同,更新记录并通知本 `Runtime` 的观察者）→ 向当前 `Runtime` 的依赖追踪器登记依赖（`tracker.track(this)`）→ 返回最新一致读到的 `value`。**在 `Effect`/`Computed` 里读 `.value` 会自动追踪,并且会顺带把远端最新写入拉进来**,不需要额外调用 `.sync()`。已释放时抛 `Error`（`signalDisposed`）。
- **`value`**（setter）—— `#assertActive()` → `asInt32(next, 'shared signal value')` 校验（不合法抛 `RangeError`,`invalidOption`）→ 以无条件写方式 `writeLocked`；若返回 `undefined`（新值与当前值经 `Atomics` 比较相同,未变）则直接返回,不推进版本号、不通知、不唤醒;若返回新版本,则更新本地 `#observedSharedVersion`、调用 `internalsOf(runtime).notify(this)` 通知本地观察者、并 `Atomics.notify` 唤醒可能正在 `watch()` 挂起的其他线程。已释放时抛 `Error`（`signalDisposed`）。
- **`peek(): number`** —— `#assertActive()` → 直接一致读并返回 `value`,**不**调用 `sync()`（不主动拉取远端更新,只读本地视图截至上次已知状态）、**不**登记依赖追踪。适合诊断/日志等不希望产生响应式依赖或触发通知的读取场景。
- **`sync(): boolean`** —— `#assertActive()` → 一致读当前共享内存的 `version`;若与本地记录的 `#observedSharedVersion` 相同返回 `false`（无变化）;否则更新本地记录、调用 `internalsOf(runtime).notify(this)` 通知观察者,返回 `true`。这是"手动拉取远端写入"的入口,`watch()` 内部也是靠调它完成同步。
- **`watch(): IDisposer`** —— `#assertActive()` → 若已经在 watch,直接返回同一个停止函数(不会叠加第二条回路);否则在 seq slot 上起一条 `Atomics.waitAsync` 唤醒回路:每次被唤醒就调用 `sync()`（如果此时未 disposed）,唤醒回调抛错会经 `reportSharedWatchFailure` 上报（优先 `runtime.reportError`,失败再退回全局 `reportError`/`console.error`,不会让跨线程 Promise 边界吞掉诊断信息）。环境不支持 `Atomics.waitAsync` → 抛 `Error`（`envUnsupported`）。返回的停止函数调用时会 `Atomics.notify` 唤醒挂起中的 `waitAsync`,让它尽快 settle 并释放对共享内存视图的引用,而不是一直等到下一次真正的远端写入。`dispose()` 也会自动调用这个停止函数。
- **`onObserved()` / `onUnobserved()`** —— `IObservable` 接口要求的钩子,本类实现为空操作(信号本身没有"被观察/不再被观察"时需要额外处理的资源)。
- **`isStale(): boolean`** —— 直接比较一致读到的 `version` 与本地记录的 `#observedSharedVersion` 是否不同,**不**做 `#assertActive()` 校验（即使已经 `dispose()` 之后调用也不会抛错,因为它只读取底层视图,不依赖响应式追踪状态）。
- **`dispose(): void`** —— 幂等；置位 `#disposed`、停止 `watch()` 回路（若存在）、从所属 `Runtime` 的追踪器断开（`tracker.disconnectObservable(this, 'dispose')`）。释放之后再调用 `value`/`sync()`/`watch()`/`peek()` 会抛 `Error`（`signalDisposed`）；`isStale()`/`buffer`/`runtime` 字段仍可安全访问。

```ts
const runtime = createRuntime();
const counter = sharedInt32(runtime, 0);
counter.value; // 0
counter.value = 5;
counter.peek(); // 5，不触发追踪
counter.dispose();
counter.value; // 抛 Error（code: 'SIGNAL_DISPOSED'）
```

---

## 3. `SharedInt32Array` / `sharedInt32Array` 完整参考

### 3.1 构造

```ts
function sharedInt32Array(
  runtime: IRuntime,
  length: number,
  options?: {
    readonly buffer?: SharedArrayBuffer;
    readonly initialValues?: Iterable<number>;
  }
): SharedInt32Array;

class SharedInt32Array implements IDisposable {
  constructor(
    runtime: IRuntime,
    length: number,
    options?: { readonly buffer?: SharedArrayBuffer; readonly initialValues?: Iterable<number> }
  );
}
```

| 参数                    | 类型                | 必填性 | 默认值   | 说明                                                                   |
| ----------------------- | ------------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `runtime`               | `IRuntime`          | 必填   | 无       | 归属的 `Runtime`                                                       |
| `length`                | `number`            | 必填   | 无       | 数组长度,必须是非负整数                                                |
| `options.buffer`        | `SharedArrayBuffer` | 可选   | 新建一块 | 附着到已有 buffer;传了此项时 `initialValues` 被忽略                    |
| `options.initialValues` | `Iterable<number>`  | 可选   | 无       | 仅新建 buffer 时生效,按顺序写入前 N 个下标(超过 `length` 的部分被丢弃) |

构造期校验顺序与边界行为：

1. `options` 不是 `undefined`（会取默认值 `{}`）也不是对象（例如显式传 `null`）→ 抛 `RangeError`（`invalidOption`，消息 `[store] shared array options must be an object`）。
2. 读取 `options.buffer`/`options.initialValues` 时若访问器抛错（例如恶意/异常的 getter）→ 抛 `RangeError`（`invalidOption`，消息 `[store] shared array options could not be read safely`，`cause` 为原始错误）。
3. `buffer` 不是 `undefined` 也不是 `SharedArrayBuffer` 实例 → 抛 `TypeError`（`invalidOption`，消息 `[store] shared buffer must be a SharedArrayBuffer`）。
4. `length` 不是整数或小于 `0` → 抛 `RangeError`（`invalidOption`，消息 `[store] shared array length must be a non-negative integer`）。
5. 未传 `buffer` 且提供了 `initialValues`：遍历该 iterable，逐个用 `asInt32` 校验并收集，达到 `length` 个就停止；遍历或校验中途抛错 → 抛 `RangeError`（`invalidOption`，消息 `[store] shared array initialValues could not be materialized safely`，`cause` 为原始错误）。
6. 按 `length` 推算所需 slot 数：`headerSlots = 1(epoch) + ceil(ceil(length / 32) / 32)(脏页 bitmap words)`，`slots = headerSlots + length * 2`；若该结果不是安全整数或超过 `0xffffffff`（`Int32Array` 下标空间上限）→ 抛 `RangeError`（`invalidOption`，消息 `[store] shared array length exceeds the Int32Array capacity`）。
7. `buffer = options.buffer ?? new SharedArrayBuffer(slots * Int32Array.BYTES_PER_ELEMENT)`；若提供的 `buffer.byteLength` 小于所需字节数 → 抛 `RangeError`（`bufferTooSmall`，消息 `[store] shared array buffer is too small`）。
8. 若第 5 步收集到了 `initialValues`，逐个 `Atomics.store` 写入对应 value slot（**不经过 seqlock 写入路径**——全新 buffer 的 seq 天然是偶数 0，构造期直接写值即安全）。
9. 构造函数**不扫描**任何格子的 seqlock 来建立版本基线——每个下标的响应式基线在该下标**第一次被追踪读取**时才建立（见 `SharedInt32ArrayCell` 构造逻辑），数组级 `sync()` 依赖 epoch 判断要不要扫描（见 [§8](#8-脏页-bitmapsharedint32array-的稀疏同步)）。

### 3.2 实例成员

```ts
class SharedInt32Array implements IDisposable {
  readonly runtime: IRuntime;
  readonly buffer: SharedArrayBuffer;
  readonly length: number;
  get disposed(): boolean;
  get(index: number): number;
  set(index: number, value: number): void;
  update(index: number, update: (current: number) => number): number;
  sync(index?: number): number;
  watch(): IDisposer;
  snapshot(): Int32Array;
  prune(): number;
  dispose(): void;
  assertActive(): void;
  readCell(index: number): { readonly value: number; readonly version: number };
  writeCell(index: number, value: number, expected?: number): number | undefined;
  notifyWaiters(): void;
  recordObservedVersion(index: number, version: number): void;
}
```

- **`runtime` / `buffer` / `length`** —— 只读字段，含义同构造参数；`length` 构造后不可变。
- **`disposed`**（getter）—— 是否已 `dispose()`。
- **`get(index: number): number`** —— 先做下标校验（见下）。若当前不处于依赖追踪上下文（`internalsOf(runtime).tracker.isTracking()` 为假），走轻量直读路径：直接 `readCell(index).value`，不物化任何 `SharedInt32ArrayCell`、不产生依赖，即使数组有百万元素，一次性读取开销也是 `O(1)`。若处于追踪上下文（`Effect`/`Computed` 内部），惰性创建（或复用已存在的）该下标对应的响应式 cell 并调用其 `read()`——这会触发该 cell 自己的 `sync()`（只拉取这一格的远端变化）与依赖登记。
- **`set(index, value): void`** —— 下标与值校验后：若该下标已有物化的 cell，委托给 `cell.write(value)`（会带上依赖通知与远端唤醒）；否则直接调用底层 `writeCell(index, asInt32(value))`，写入成功（版本非 `undefined`）时更新数组级"已观察版本"记账并调用 `notifyWaiters()` 推进 epoch、唤醒可能的远端 `watch()`。值与当前值相同时静默跳过，不推进版本、不通知。
- **`update(index, updater): number`** —— `updater` 必须是函数，否则抛 `TypeError`（`invalidOption`，消息 `[store] shared array update callback must be a function`）。执行顺序（详见 [§6.2](#62-写占锁--写值--放锁)）：一致读当前值 → **锁外**调用 `updater(current)` → 校验结果为合法 `int32` → 若与当前值相同直接返回（不写入）→ 否则以 CAS（期望值 = 读到的 `current`）尝试写入，失败则从头重来，最多重试 `1 << 16`（65536）次；超限抛 `Error`（`contentionLimit`，消息 `[store] shared array update at <index> kept losing the race; another writer never settled`）。写入成功后同步更新本地记账、若下标已物化 cell 则调用其 `commitWrite`，否则直接 `notifyWaiters()`。**`updater` 必须是纯函数、可安全重复调用**——冲突时会被重跑，不要在里面产生不可逆副作用；`updater` 抛错会原样向上抛出，且不会留下任何脏锁状态（回调在锁外执行）。
- **`sync(index?): number`**
  - 传 `index`：先做下标校验；比较该下标的一致读版本号与本地记录，未变返回 `0`；变了则更新记录、若已物化 cell 则调用其 `sync()`（触发通知），返回 `1`。
  - 不传：整体扫描。先比较头部 epoch 与本地记录的 `#observedEpoch`，未变直接返回 `0`（连脏页 bitmap 都不碰）；变了则在 `runtime.batch()` 内逐 word `Atomics.exchange` 读出并清零脏页 bitmap，对每个置位的页逐格重新一致读、与本地记录比较，真正变化的下标才更新记录并调用其已物化 cell 的 `sync()`，最终返回本轮实际变化的下标个数（可能为 `0`，即 epoch 变了但没有格子真正稳定下来变化，理论上不会发生但代码按此语义实现）。整个批处理包在一次 `runtime.batch()` 内，多处变化只会让下游重跑一轮而不是逐个通知。
- **`watch(): IDisposer`** —— 语义与 `SharedInt32Signal.watch()` 一致，但监听的是头部 **epoch slot** 而不是逐格 seq（一格一个 waiter 在长数组上不可行）；唤醒后调用整体 `sync()`（不带 `index`）。已在 watch 时重复调用返回同一停止函数；环境不支持 `waitAsync` 抛 `Error`（`envUnsupported`）。
- **`snapshot(): Int32Array`** —— `assertActive()` 后遍历 `[0, length)`，对每个下标 `readCell(i).value`，写入一个新分配的 `Int32Array(length)` 并返回。返回值是**普通、非共享**的数组，修改它不会影响共享内存。
- **`prune(): number`** —— `assertActive()` 后遍历所有已物化的 cell，`subs.size === 0`（没有任何观察者）的从追踪器断开并从内部 `Map` 移除，返回移除个数。用于"高频轮换访问不同下标"场景下主动清理，弥补自动回收（见下）的粒度不够及时。
- **`dispose(): void`** —— 幂等；停止 `watch()`、把所有已物化 cell 从追踪器断开。释放之后调用 `get`/`set`/`update`/`sync`/`watch`/`snapshot`/`prune` 等会抛 `Error`（`arrayDisposed`）。
- **`assertActive(): void`** —— 已释放则抛 `Error`（`arrayDisposed`，消息 `[store] shared array is disposed`）；公开方法，正常业务代码不需要直接调用，供组合式底层用法（如包装类）复用同一校验。
- **`readCell(index): { value; version }`** —— 一致读某一格的原始 value/version（复用 seqlock 读协议），**不做下标范围校验、不检查是否已释放**，是最底层的读原语；`get()`/`sync()` 等内部都基于它实现，调用方若直接使用需自行保证 `index` 合法。
- **`writeCell(index, value, expected?): number | undefined`** —— 最底层的写原语（`set`/`update` 都基于它），语义见 [§6.2](#62-写占锁--写值--放锁)：`expected` 省略即无条件写；提供则是 CAS；成功返回新版本并标记对应脏页，未写入（值未变或 CAS 失败）返回 `undefined`。同样不做下标校验。
- **`notifyWaiters(): void`** —— 把头部 epoch 原子 `+1` 并 `Atomics.notify`，用于在绕开 `set`/`update` 自行调用 `writeCell` 之后手动唤醒 `watch()` 回路。
- **`recordObservedVersion(index, version): void`** —— 更新数组级"已观察版本"记账（`#observedVersions[index]`），供自行组合 `readCell`/`writeCell` 实现自定义写入路径时，保持与内建 `sync()`/`get()` 的记账一致，避免下一次 `sync()` 误判该下标"仍未变化"或重复上报。

`get`/`set`/`update`/`sync(index)` 的下标校验规则一致：先 `assertActive()`，再要求 `Number.isInteger(index) && index >= 0 && index < length`，否则抛 `RangeError`（`indexOutOfRange`，消息 `[store] shared array index out of range: <index>`）。

```ts
const runtime = createRuntime();
const grid = sharedInt32Array(runtime, 4, { initialValues: [0, 0, 0, 0] });
grid.set(0, 10);
grid.get(0); // 10
grid.update(1, (v) => v + 1); // 1
grid.snapshot(); // Int32Array [10, 1, 0, 0]
grid.dispose();
grid.get(0); // 抛 Error（code: 'ARRAY_DISPOSED'）
```

---

## 4. `SharedWaitMode` 完整参考

```ts
const SharedWaitMode: { readonly async: 'async' };
type ISharedWaitMode = 'async';
```

一个稳定的等待模式标识常量（当前只有 `async` 一个取值），来源注释为"Shared-state wait modes used when Atomics.waitAsync is available"。它**不是**任何导出函数/方法的参数或返回值——`watch()` 内部固定使用基于 `Atomics.waitAsync` 的唤醒策略，不需要也不接受调用方传入 `SharedWaitMode` 来选择模式。它的作用是给调用方在自己的类型标注、日志、诊断代码里提供一个稳定、不会打字错误的字符串引用，为将来可能新增的等待模式预留扩展空间。

```ts
import { SharedWaitMode, type ISharedWaitMode } from '@migaia/store-shared';

const currentMode: ISharedWaitMode = SharedWaitMode.async;
```

---

## 5. 错误身份

```ts
import {
  StoreSharedErrorCode,
  type IStoreSharedErrorCode,
  STORE_SHARED_SOURCE,
  createStoreSharedError,
  createStoreSharedRangeError
} from '@migaia/store-shared';
```

### 5.1 `StoreSharedErrorCode` / `IStoreSharedErrorCode`

```ts
const StoreSharedErrorCode: {
  readonly arrayDisposed: 'ARRAY_DISPOSED';
  readonly signalDisposed: 'SIGNAL_DISPOSED';
  readonly bufferTooSmall: 'BUFFER_TOO_SMALL';
  readonly indexOutOfRange: 'INDEX_OUT_OF_RANGE';
  readonly contentionLimit: 'CONTENTION_LIMIT';
  readonly envUnsupported: 'ENV_UNSUPPORTED';
  readonly invalidOption: 'INVALID_OPTION';
};
type IStoreSharedErrorCode = (typeof StoreSharedErrorCode)[keyof typeof StoreSharedErrorCode];
```

错误由 `(source, code)` 二元组唯一定位，`source` 恒为 `@migaia/store-shared`（即 `STORE_SHARED_SOURCE`）。码值是公开 API 的一部分，本包内部所有抛出点都引用这张表，不内联字面量；触发条件与调用方建议见 [README 的对应小节](./README.md#错误身份)与本文 [§10 错误一览表](#10-错误一览表)。

### 5.2 `STORE_SHARED_SOURCE`

```ts
const STORE_SHARED_SOURCE: '@migaia/store-shared';
```

字符串常量，本包所有错误统一携带的 `source` 字段值。通过 `@migaia/utils` 的 `attachErrorIdentity` 挂到每个抛出的 `Error`/`RangeError` 上。

### 5.3 `createStoreSharedError` / `createStoreSharedRangeError`

```ts
function createStoreSharedError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error;

function createStoreSharedRangeError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): RangeError;
```

两者都是本包内部构造错误时使用的工厂：先 `new Error(message, options?.cause !== undefined ? { cause } : undefined)`（或 `RangeError`），再用 `attachErrorIdentity(error, { source: STORE_SHARED_SOURCE, code })` 挂上身份字段。两者签名与行为完全一致，唯一区别是构造出的运行时错误类型（`Error` vs `RangeError`）。公开导出是为了让在 `@migaia/store-shared` 之上做薄封装的调用方（例如包装 `SharedInt32Array` 的上层库）可以抛出携带同一套 `(source, code)` 身份契约的错误，而不必自己重新实现 `attachErrorIdentity` 调用。

`options.cause` 省略时不会传 `cause` 给底层 `Error` 构造函数（区别于显式传 `undefined`，两者在 `Error` 构造语义上是等价的，这里只是实现细节）。

```ts
throw createStoreSharedRangeError(
  StoreSharedErrorCode.invalidOption,
  'entityCount must be a positive integer'
);
```

---

## 6. Seqlock：并发读写的正确性保证

每个共享整数格在内存里占用两个 `int32` slot：`[value, seq]`。`seq` 同时充当版本号与写锁：

- **偶数** = 空闲，值稳定，`value` 有效
- **奇数** = 有写者正在写，此刻 `value` 可能处于半写状态，不能读

### 6.1 读：一致性校验 + 有限自旋

```
读 before = seq
若 before 是奇数 → 重试
读 value
读 after = seq
若 before === after → 返回 { value, version: before }
否则 → 重试
```

只要 `before === after` 且为偶数，就能保证这次读到的 `value` 和 `version` 出自同一次已完成的写入。自旋次数上限是 **65536（`1 << 16`）次**；超限说明可能有写者在持锁期间异常终止（线程被杀、页面崩溃），此时无限自旋会把当前线程也拖死，所以到限直接抛 `Error`（`contentionLimit`，消息含 `did not settle before the contention limit`），把"共享内存可能已经写坏"暴露出来，而不是静默卡死。

<a id="62-写占锁--写值--放锁"></a>

### 6.2 写：占锁 → 写值 → 放锁

```
读 seq；若为奇数 → 重试获取
CAS(seq, seq, seq+1) 成功即获锁，失败重试
（获锁后）比较 expected（若提供）与当前 value；不符则释放锁、返回 undefined
若新值等于当前值 → 释放锁、返回 undefined（不推进版本号）
写入新 value
seq 推进为 seq+2（committed）
```

获锁同样有 65536 次自旋上限，超限抛 `Error`（`contentionLimit`，消息含 `lock was not acquired before the contention limit`）。写入过程中**不会调用任何用户代码**——`update()` 的用户回调在锁外执行，所以持锁期间不存在"回调抛错导致锁卡在奇数"的问题。

这一版设计修复的是更早期"`Atomics.exchange(value)` 然后 `Atomics.add(version)`"两步式实现的缺陷：两步之间没有互斥，并发写者会导致读者看到"新值配旧版本号"，从而误判自己没有变化、漏掉一次通知——这类问题在跨线程共享状态里几乎无法用常规手段排查，因为它不报错，只是"有一帧数据没更新"。

### 6.3 值域校验

所有写入路径（`SharedInt32Signal.value = x`、`SharedInt32Array.set()`/`update()`、构造期的 `initialValue`/`initialValues`）都会先校验值是合法 `int32`：整数，且落在 `[-2147483648, 2147483647]`。不合法直接抛 `RangeError`（`invalidOption`），消息形如 `[store] <what> must be an int32, received <value>`。这是刻意的设计选择——`value | 0` 之类的位运算会把 `2**31`、`3.9` 这样的值**静默**折成完全不同的数字，写入方永远不会知道，跨线程共享的另一端读到的是一个从未被写过的数，且两边都不会报错。

---

## 7. 跨线程同步：`sync()` 与 `watch()`

**本地写入永远即时通知本地 `Runtime`**——`.value = x`、`.set()`、`.update()` 内部在写入成功后会立刻调用 `internalsOf(runtime).notify(...)`，这一步和共享内存、跨线程无关。

**跨 `Runtime`（通常也是跨线程）的写入不会自动出现在另一端**，因为另一端的 `Runtime` 完全不知道这块内存被改过，必须主动检测：

- **手动拉取**：调用 `.sync()`（`SharedInt32Signal.sync()`、`SharedInt32Array.sync()` 或 `sync(index)`）。返回值表示是否发生了变化（数组版返回变化的下标数）。适合已经有自己的消息循环、可以定期 pump 的场景，或者不支持 `Atomics.waitAsync` 的环境。
- **自动推送**：调用 `.watch()`。内部对 seq（`SharedInt32Signal`）或 epoch（`SharedInt32Array`）发起 `Atomics.waitAsync` 循环——一旦对应 slot 被写者 `Atomics.notify()` 唤醒，就自动跑一次 `sync()`，然后立刻重新挂起等待下一次唤醒。返回一个停止函数；重复调用 `.watch()` 会返回同一个停止函数，不会叠加多条回路；`.dispose()` 会自动停止它。

`Atomics.wait`（同步版本）不能在主线程使用（会阻塞事件循环），所以 `watch()` 固定走 `waitAsync`。**环境不支持 `Atomics.waitAsync` 时 `watch()` 直接抛错**（`envUnsupported`，消息 `[store] Atomics.waitAsync is unavailable; pump sync() from your own message loop instead`），而不是静默退化成轮询——静默降级会让调用方误以为自己确实拿到了推送能力。

停止 `watch()`（无论是手动调用停止函数还是 `dispose()`）会顺带 `Atomics.notify()` 一次，让挂起中的 `waitAsync` Promise 尽快 settle、释放对共享内存视图的引用，而不是一直等到"下一次真正的远端写入"才释放。

---

## 8. 脏页 bitmap：`SharedInt32Array` 的稀疏同步

`SharedInt32Array` 的共享内存布局是：`[epoch, ...bitmap words, value0, seq0, value1, seq1, ...]`，每页 32 格（`DIRTY_PAGE_SIZE = 32`），每个 bitmap word 覆盖 32 页（`DIRTY_BITS_PER_WORD = 32`）。

- **epoch**：每次任意下标完成一次落盘写入，写者都会把 epoch 原子 `+1`。`sync()` 不传 `index` 时，第一步就是比较本地记录的 epoch 和共享内存里的当前 epoch——完全没变就直接返回 `0`，连 bitmap 都不用碰。这一步是为了让**一条** `watch()` 唤醒回路就能覆盖整个数组，不需要给上万个下标各起一个 waiter。
- **脏页 bitmap**：每次写入用 `Atomics.or` 点亮自己所在页的 bit（`Atomics.or` 是无损操作，多个写者并发点同一个 bit 不会互相覆盖或丢失标记）。`sync()` 发现 epoch 变化后，用 `Atomics.exchange` 逐 word 读出 bitmap 并清零（`exchange` 是单次原子读改写，不存在"清零期间丢失一次并发 `or`"的时间窗口：并发的 `or` 要么完整发生在 `exchange` 之前，已经反映在读出的旧值里；要么完整发生在之后，作用在刚清零的 0 上，正确地留给下一轮 `sync()` 发现）。
- **逐格确认**：命中的每一页仍然要逐格读 seqlock 版本号，和本地记录比较，真正变了才会通知该下标的观察者。也就是说 **bitmap/epoch 只是"可能变了"的提示，不是正确性来源**——即便某个 bit 因为极端时序被提前清零、写入方的 `or` 恰好卡在那之前完成，页内逐格版本比较仍会在下一轮 `sync()` 里补上这次变化，不会真正漏掉。

效果：百万格的数组里只改动几个分散的下标，`sync()` 的开销只和"变化的页数"相关，而不是和数组长度 `length` 相关。一次 `sync()` 扫描到的多个变化会被包在同一个 `runtime.batch()` 里，避免下游因为一次同步里的多处变化而被唤醒多轮。

---

## 9. 响应式集成细节

- **两者都是 `IObservable`**：内部通过 `@migaia/reactive` 的 `internalsOf`/`registerSubs`/`registerVersion`/`claimOwnership` 接入所属 `Runtime` 的依赖图，行为和普通的 `Signal`/`Computed` 节点一致——可以被 `Effect`/`Computed` 追踪，`isStale()` 可查询是否有未同步的远端变化。
- **单一归属**：构造时调用 `claimOwnership(this, runtime)` 登记归属；同一个 JS 对象不能被登记到第二个 `Runtime`（会抛 `@migaia/reactive` 所有权系统的错误）。**这意味着共享的是 `SharedArrayBuffer`，而不是 JS 对象本身**——另一个线程/`Runtime` 要读同一份数据，必须用同一个 `buffer` 单独 `new` 一份自己的实例。
- **`SharedInt32Array` 的按需物化**：`get(index)` 只有在检测到当前处于依赖追踪上下文（`internalsOf(runtime).tracker.isTracking()` 为真，即身处 `Effect`/`Computed` 内部）时才会为该下标创建一个内部的响应式 cell 并登记依赖；在追踪上下文之外调用 `get()`（比如普通同步代码里的一次性读取）走直读路径，不产生任何 cell 对象。
- **cell 的自动回收**：`Effect`/`Computed` 可能在提交观察之前就放弃一次"投机读"（比如 `Computed` 重新计算时依赖发生了变化）。为此新物化的 cell 会在下一个微任务里检查是否仍有订阅者，没有就自动断开并从内部 Map 里移除，不需要手动处理。
- **手动 `prune()`**：如果访问模式是"高频轮换读取不同下标"（比如遍历式的探测），自动回收的微任务粒度可能不够及时，可以定期调用 `array.prune()` 主动清理当前没有任何订阅者的 cell，返回本次清理掉的个数。

---

## 10. 错误一览表

| `code`               | 触发条件                                                                                                                                                                                              | 抛出方式                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `SIGNAL_DISPOSED`    | `SharedInt32Signal` 已 `dispose()` 后继续访问 `value`/`sync()`/`watch()`/`peek()`                                                                                                                     | `Error`                                  |
| `ARRAY_DISPOSED`     | `SharedInt32Array` 已 `dispose()` 后继续访问 `get`/`set`/`update`/`sync`/`watch`/`snapshot`/`prune`/`assertActive`                                                                                    | `Error`                                  |
| `BUFFER_TOO_SMALL`   | 传入的 `buffer` 小于 `SharedInt32Signal`（8 字节）或按 `SharedInt32Array` 的 `length` 推算出的所需大小                                                                                                | `RangeError`，构造时                     |
| `INDEX_OUT_OF_RANGE` | `SharedInt32Array` 的 `get`/`set`/`update`/`sync(index)` 下标越界或非整数                                                                                                                             | `RangeError`，调用时                     |
| `CONTENTION_LIMIT`   | 一致读自旋 65536 次未 settle，或获取写锁自旋 65536 次未成功，或 `update()` 的 CAS 重试自旋 65536 次仍未写入                                                                                           | `Error`                                  |
| `ENV_UNSUPPORTED`    | 当前运行环境不支持 `Atomics.waitAsync`，却调用了 `.watch()`                                                                                                                                           | `Error`，`watch()` 调用时                |
| `INVALID_OPTION`     | 构造/写入口参非法：`buffer` 类型不对、`options` 不是对象、`options` 读取失败、`length` 非法、`initialValues` 物化失败、`length` 换算出的 slot 数超限、写入值不是合法 int32、`update()` 的回调不是函数 | `TypeError` 或 `RangeError`，构造/调用时 |

所有错误都携带 `source: '@migaia/store-shared'` 与上表对应的 `code`（通过 `attachErrorIdentity` 挂载），可用 `error.code === StoreSharedErrorCode.xxx` 分支处理，见 README 的 [错误身份](./README.md#错误身份) 小节。`CONTENTION_LIMIT` 系列几乎总是意味着**另一个持锁的写者异常终止**（线程被强制终止、页面崩溃）而没有走到释放锁那一步——共享内存里的 seq 会永远停在奇数。这类错误没有应用层可以自动恢复的办法，通常需要重新创建一块 buffer 并放弃旧的那份共享状态。

---

## 11. 生产环境完整示例

主线程创建共享数组，交给 Worker 处理，双方都能响应式地观察对方的写入：

```ts
// main.ts
import { createRuntime, Effect } from '@migaia/reactive';
import { sharedInt32Array } from '@migaia/store-shared';

const runtime = createRuntime();
const positions = sharedInt32Array(runtime, 1000);

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ buffer: positions.buffer });

const stopWatch = positions.watch(); // worker 的写入自动推送进来

const render = new Effect(() => {
  drawEntity(0, positions.get(0), positions.get(1));
}, runtime);

window.addEventListener('beforeunload', () => {
  render.dispose();
  stopWatch();
  positions.dispose();
  worker.terminate();
});
```

```ts
// worker.ts
import { createRuntime } from '@migaia/reactive';
import { sharedInt32Array } from '@migaia/store-shared';

self.onmessage = (event: MessageEvent<{ buffer: SharedArrayBuffer }>) => {
  const runtime = createRuntime();
  const positions = sharedInt32Array(runtime, 1000, { buffer: event.data.buffer });

  setInterval(() => {
    positions.update(0, (x) => x + 1); // 每帧推进实体 0 的 x 坐标
  }, 16);
};
```

不支持 `Atomics.waitAsync` 的环境（改用手动 `sync()` 轮询）：

```ts
const positions = sharedInt32Array(runtime, 1000, { buffer: sharedBuffer });

setInterval(() => {
  const changed = positions.sync(); // 返回本轮实际变化的下标个数
  if (changed > 0) console.log(`${changed} 个下标发生了远端变化`);
}, 100);
```

---

## 12. 常见问题排查

**Q：另一个线程明明写了值，我这边读到的还是旧的。**
检查是否调用过 `.watch()` 或定期 `.sync()`——跨 `Runtime` 的写入不会自动出现，本地只有主动拉取或订阅了唤醒回路才能看到远端变化。`.peek()` 也不会主动拉取远端更新，只有 `.value`/`.get()`（在追踪上下文中）或显式 `.sync()` 会。

**Q：`watch()` 抛出 `Atomics.waitAsync is unavailable`。**
当前运行环境不支持该 API（常见于旧版本或某些沙箱环境），错误码是 `ENV_UNSUPPORTED`。改用定时调用 `.sync()`/`.sync(index)` 轮询，见 [§11](#11-生产环境完整示例) 最后一个例子。

**Q：写入抛 `must be an int32`。**
说明写入的值不是整数，或超出了 `[-2147483648, 2147483647]` 范围（错误码 `INVALID_OPTION`）——这个包只支持定长 int32 布局，不支持浮点数或更大的整数，需要更大范围可以考虑拆成多个格子自行编码。

**Q：读写偶尔抛 `did not settle before the contention limit` 或 `kept losing the race`。**
错误码都是 `CONTENTION_LIMIT`，通常意味着另一个写者持锁期间异常终止（线程被杀、崩溃），共享内存的锁位永远停在了"正在写"状态。这种情况无法在应用层自动恢复，需要放弃这块 `buffer`，重新创建一份共享状态。

**Q：`SharedInt32Array` 里成千上万个下标，`sync()` 会不会很慢？**
不会。`sync()` 先比较头部 epoch，完全没变直接返回；有变化时只扫描被脏页 bitmap 标记过的页，不是整个数组，见 [§8](#8-脏页-bitmapsharedint32array-的稀疏同步)。

**Q：能不能把 `SharedInt32Signal` 对象直接 `postMessage` 给 Worker？**
不能，且没有必要——`postMessage` 会尝试结构化克隆这个对象，其内部状态无法被克隆出等价实例。应该传 `.buffer`（真正的 `SharedArrayBuffer`，可以被 `postMessage` 直接传递而不拷贝），另一端用同一个 `buffer` 调用 `sharedInt32`/`sharedInt32Array` 各自创建一份实例。

**Q：能不能用这个包存对象、字符串这些复杂数据？**
不能。它只支持定长的 `int32` 布局，这是刻意的设计边界——`SharedArrayBuffer` 本身就是定长的原始内存，塞对象图需要自己实现序列化协议，超出了这个包的职责范围。

**Q：`SharedWaitMode` 该怎么用？**
它不是任何函数的参数，只是一个稳定的字符串常量/类型，供调用方在自己的日志、诊断代码里引用"当前使用的是基于 `Atomics.waitAsync` 的等待模式"这一事实，不需要也无法传给 `watch()` 来切换策略。

**Q：`readCell`/`writeCell`/`notifyWaiters`/`recordObservedVersion` 什么时候需要直接用？**
绝大多数场景用 `get`/`set`/`update`/`sync` 就够了。只有在自行组合底层原语（例如实现一个不经过响应式 cell 的批量写入路径、或包装一层自定义脏页策略）时才需要直接调用这些低级方法，且要自行保证下标合法、调用 `writeCell` 成功后同步调用 `recordObservedVersion`/`notifyWaiters` 以保持与内建 `get`/`sync()` 的记账一致。

---

## 13. 构建、格式化与测试

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

测试覆盖 seqlock 一致读、跨 Runtime 同步、`watch()` 生命周期、数组稀疏同步与错误码（`test/shared-state.test.ts`、`test/error-code.test.ts`）。
