# `@migaia/store-shared`

基于 `SharedArrayBuffer` + `Atomics` 的跨线程响应式整数状态：把一段共享内存包装成 `@migaia/reactive` 认识的 `IObservable`（seqlock 保证并发读写正确，脏页 bitmap 保证大数组稀疏同步不掉性能），让主线程与 Worker、或多个独立的 `Runtime`，可以直接共享同一份数据而不必靠 `postMessage` 做结构化克隆。

## 适用与不适用场景

**适用**：主线程与 Worker（或多个 `Runtime`）需要共享少量、定长、`int32` 范围内的数值状态，并希望这份状态像普通 `@migaia/reactive` 的 `Signal` 一样能被 `Effect`/`Computed` 自动追踪、写入自动通知。典型场景：渲染循环里的坐标/计数器/状态标志位、成百上千个下标各自独立变化的大数组（比如批量实体的位置）、需要 `Atomics.waitAsync` 推送而不是轮询的低延迟跨线程通知。

**不适用**：不要把它当作通用状态管理方案或对象/字符串的跨线程传输通道——它只支持固定布局的 `int32` 数值（单格或定长数组），不能存字符串、对象、嵌套结构；真要跨线程传对象图，用 `structuredClone`/`postMessage` 或专门的序列化协议。两端在同一个线程里、不需要 `SharedArrayBuffer` 时，用普通的 `@migaia/reactive` `Signal` 就够了。跨线程但只是偶尔通知一下、数据量小、延迟不敏感的场景，`postMessage` 往往比上共享内存更简单。

## 安装

```bash
pnpm add @migaia/store-shared
```

依赖 `@migaia/reactive`（随本包一并安装）；使用前需要先有一个 `Runtime`（`@migaia/reactive` 的 `createRuntime()`）。

## 目录

- [共享信号：`SharedInt32Signal` / `sharedInt32`](#共享信号)
- [共享数组：`SharedInt32Array` / `sharedInt32Array`](#共享数组)
- [等待模式常量：`SharedWaitMode`](#等待模式常量)
- [错误身份：`StoreSharedErrorCode` / `STORE_SHARED_SOURCE` / `createStoreSharedError` / `createStoreSharedRangeError`](#错误身份)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、seqlock/脏页 bitmap 的内部机制、错误一览表，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="共享信号"></a>

## 共享信号：`SharedInt32Signal` / `sharedInt32`

```ts
import { sharedInt32, SharedInt32Signal } from '@migaia/store-shared';
import { createRuntime, Effect } from '@migaia/reactive';
```

**`sharedInt32`｜5 秒上手** —— 新建一个单值共享 int32，像普通 `Signal` 一样在 `Effect` 里被自动追踪：

```ts
const runtime = createRuntime();
const counter = sharedInt32(runtime, 0);

const stop = new Effect(() => console.log('counter =', counter.value), runtime);
counter.value = 1; // 本地写入，Effect 自动重跑

stop.dispose();
counter.dispose();
```

全部参数（等价于 `new SharedInt32Signal(runtime, initialValue?, buffer?)`）：

- `runtime: IRuntime`（必填）—— 该信号归属的 `Runtime`；构造时登记归属，同一实例不能改属另一个 `Runtime`
- `initialValue?: number`（默认 `0`）—— 新建 buffer 时写入的初始值，必须是合法 `int32`；**传了 `buffer` 时此参数被忽略**（数据已经在那块内存里，不会被覆盖）
- `buffer?: SharedArrayBuffer`（默认新建一块 8 字节的 buffer）—— 传入已有 buffer 表示"附着"到另一个实例正在使用的内存，此后两边读写同一份数据；不是 `SharedArrayBuffer` 抛 `TypeError`（`invalidOption`）；小于所需的 8 字节抛 `RangeError`（`bufferTooSmall`）

`SharedInt32Signal` 实例上的全部成员：

| 成员        | 签名                         | 说明                                                                                                                               |
| ----------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`   | 只读字段 `IRuntime`          | 构造时传入的 `Runtime`                                                                                                             |
| `buffer`    | 只读字段 `SharedArrayBuffer` | 底层共享内存，传给另一个线程/`Runtime` 即可共享                                                                                    |
| `disposed`  | getter `boolean`             | 是否已 `dispose()`                                                                                                                 |
| `version`   | getter `number`              | 该节点在所属 `Runtime` 响应式图里的版本号（不是共享内存里的 seq）                                                                  |
| `value`     | getter/setter `number`       | 读：一致读 + 拉取远端更新 + 依赖追踪；写：写入合法 `int32`，值未变则静默跳过、不通知                                               |
| `peek()`    | `() => number`               | 读当前本地已知值，**不**触发依赖追踪、**不**主动拉取远端更新                                                                       |
| `sync()`    | `() => boolean`              | 主动检查远端版本号是否变化，变了则更新本地记录并通知观察者，返回是否发生变化                                                       |
| `watch()`   | `() => IDisposer`            | 起一条基于 `Atomics.waitAsync` 的自动唤醒回路；重复调用返回同一个停止函数；环境不支持 `waitAsync` 时抛 `Error`（`envUnsupported`） |
| `dispose()` | `() => void`                 | 停止 `watch()`、从响应式图断开；幂等；之后调用其他成员会抛 `Error`（`signalDisposed`）                                             |

---

<a id="共享数组"></a>

## 共享数组：`SharedInt32Array` / `sharedInt32Array`

```ts
import { sharedInt32Array, SharedInt32Array } from '@migaia/store-shared';
import { createRuntime, Effect } from '@migaia/reactive';
```

**`sharedInt32Array`｜10 秒上手** —— 定长共享 int32 数组，每个下标独立追踪、独立通知：

```ts
const runtime = createRuntime();
const positions = sharedInt32Array(runtime, 1000, { initialValues: [0, 0] });

const render = new Effect(() => {
  drawEntity(positions.get(0), positions.get(1)); // 只追踪被读取的下标
}, runtime);

positions.set(0, 10); // 只惊动依赖下标 0 的观察者
positions.update(1, (y) => y + 1); // 读-改-写，内部 CAS 重试

render.dispose();
positions.dispose();
```

全部参数（等价于 `new SharedInt32Array(runtime, length, options?)`）：

- `runtime: IRuntime`（必填）—— 归属的 `Runtime`
- `length: number`（必填）—— 数组长度，必须是非负整数，否则抛 `RangeError`（`invalidOption`）；换算出的所需 slot 数超过 `Int32Array` 下标空间上限会抛 `RangeError`（`invalidOption`）
- `options?.buffer?: SharedArrayBuffer`（默认新建一块按 `length` 计算大小的 buffer）—— 附着到已有 buffer；不是 `SharedArrayBuffer` 抛 `TypeError`（`invalidOption`）；小于所需大小抛 `RangeError`（`bufferTooSmall`）；传了此项时 `initialValues` 被忽略
- `options?.initialValues?: Iterable<number>`（默认无）—— 仅在新建 buffer 时生效，按顺序写入前 N 个下标（超过 `length` 的部分被丢弃），每个值都要求是合法 `int32`
- `options` 本身必须是对象（`undefined` 会取默认值 `{}`；显式传 `null` 或非对象会抛 `TypeError`，`invalidOption`）

`SharedInt32Array` 实例上的全部成员：

| 成员                                    | 签名                                                              | 说明                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `runtime`                               | 只读字段 `IRuntime`                                               | 归属的 `Runtime`                                                                                                   |
| `buffer`                                | 只读字段 `SharedArrayBuffer`                                      | 底层共享内存                                                                                                       |
| `length`                                | 只读字段 `number`                                                 | 数组长度，构造后不可变                                                                                             |
| `disposed`                              | getter `boolean`                                                  | 是否已 `dispose()`                                                                                                 |
| `get(index)`                            | `(index: number) => number`                                       | 读取下标；在依赖追踪上下文（`Effect`/`Computed` 内）中会为该下标物化响应式 cell 并登记依赖，上下文外走轻量直读路径 |
| `set(index, value)`                     | `(index: number, value: number) => void`                          | 写入合法 `int32`；值未变则跳过写入与通知                                                                           |
| `update(index, updater)`                | `(index: number, updater: (current: number) => number) => number` | 读-改-写：`updater` 在锁外执行、CAS 提交，冲突自动重试；返回写入后的新值                                           |
| `sync(index?)`                          | `(index?: number) => number`                                      | 不传 `index`：批量扫描脏页，返回本轮实际变化的下标个数；传 `index`：只检查该下标，返回 `0`/`1`                     |
| `watch()`                               | `() => IDisposer`                                                 | 起一条覆盖整个数组的 `Atomics.waitAsync` 唤醒回路；重复调用返回同一个停止函数                                      |
| `snapshot()`                            | `() => Int32Array`                                                | 一次性读出全部下标当前值，返回一个新分配的、非共享的 `Int32Array` 拷贝                                             |
| `prune()`                               | `() => number`                                                    | 释放当前没有任何观察者的已物化响应式 cell，返回释放个数                                                            |
| `dispose()`                             | `() => void`                                                      | 停止 `watch()`、断开全部已物化 cell；幂等；之后调用其他成员会抛 `Error`（`arrayDisposed`）                         |
| `assertActive()`                        | `() => void`                                                      | 已释放则抛 `Error`（`arrayDisposed`）；一般不需要业务代码直接调用                                                  |
| `readCell(index)`                       | `(index: number) => { value: number; version: number }`           | 一致读某一格的原始 value/version，绕过响应式追踪与下标校验；供组合式底层用法使用                                   |
| `writeCell(index, value, expected?)`    | `(index, value, expected?) => number \| undefined`                | 底层写入原语（`set`/`update` 基于它实现），返回新版本或 `undefined`（未写入）                                      |
| `notifyWaiters()`                       | `() => void`                                                      | 推进头部 epoch 并唤醒挂起的 `watch()` 回路                                                                         |
| `recordObservedVersion(index, version)` | `(index: number, version: number) => void`                        | 更新数组级"已观察版本"记账，供自定义组合场景对齐本地 cell 与数组级 `sync()` 的状态                                 |

`get`/`set`/`update`/`sync(index)` 对越界或非整数下标一律抛 `RangeError`（`indexOutOfRange`）。

---

<a id="等待模式常量"></a>

## 等待模式常量：`SharedWaitMode`

```ts
import { SharedWaitMode, type ISharedWaitMode } from '@migaia/store-shared';
```

**`SharedWaitMode`｜3 秒上手** —— 稳定的等待模式标识常量，供类型标注/比较使用（单参数，无调用形式，是一个常量对象）：

```ts
function describeWaitMode(mode: ISharedWaitMode): string {
  return mode === SharedWaitMode.async ? '基于 Atomics.waitAsync 的异步唤醒' : mode;
}
```

全部取值：`async`(`'async'`) —— 目前是唯一取值，对应 `watch()` 内部使用的 `Atomics.waitAsync` 唤醒策略；不作为任何导出函数的入参/返回值传递，仅供调用方在自己的类型标注、日志或诊断代码里稳定地引用这一模式名。`ISharedWaitMode` 是其取值的联合类型（目前等价于字面量类型 `'async'`）。

---

<a id="错误身份"></a>

## 错误身份：`StoreSharedErrorCode` / `STORE_SHARED_SOURCE` / `createStoreSharedError` / `createStoreSharedRangeError`

```ts
import {
  StoreSharedErrorCode,
  type IStoreSharedErrorCode,
  STORE_SHARED_SOURCE,
  createStoreSharedError,
  createStoreSharedRangeError
} from '@migaia/store-shared';
```

**`StoreSharedErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较（无调用形式，是一个常量对象）：

```ts
try {
  counter.value = 1;
} catch (error) {
  if ((error as { code?: string }).code === StoreSharedErrorCode.signalDisposed) {
    // 信号已释放，需要重新 attach 到同一个 buffer 创建新实例
  }
}
```

全部取值（本包内部抛出的每一个错误都会带上其中之一作为 `code` 字段）：

- `arrayDisposed`(`'ARRAY_DISPOSED'`) —— `SharedInt32Array` 已 `dispose()` 后继续读写；调用方应新建数组，不要复用已释放实例
- `signalDisposed`(`'SIGNAL_DISPOSED'`) —— `SharedInt32Signal` 已 `dispose()` 后继续读写；同上，新建 signal
- `bufferTooSmall`(`'BUFFER_TOO_SMALL'`) —— 传入的 `SharedArrayBuffer` 太小，放不下要求的 cell 布局；调用方应分配更大的 buffer，这是构造期参数错误，不要重试同一 buffer
- `indexOutOfRange`(`'INDEX_OUT_OF_RANGE'`) —— `SharedInt32Array` 下标越界；调用方检查下标是否在 `[0, length)`，这是永久性参数错误
- `contentionLimit`(`'CONTENTION_LIMIT'`) —— Seqlock 在自旋上限内未 settle（cell 未稳定/锁未获取/`update` 持续失败）；通常是某个写者持锁期间崩溃留下的死锁，无法自愈，调用方应重建 buffer
- `envUnsupported`(`'ENV_UNSUPPORTED'`) —— `Atomics.waitAsync` 在当前环境不可用；调用方改用 `sync()` 自行拉取，或换支持 `waitAsync` 的运行时，库不做静默降级
- `invalidOption`(`'INVALID_OPTION'`) —— 构造/写入口参非法（长度非负整数、int32 范围等）；调用方修正入参，这是永久性参数错误

`IStoreSharedErrorCode` 是其取值的联合类型。

**`STORE_SHARED_SOURCE`｜3 秒上手** —— 本包所有错误统一携带的 `source` 值（字符串常量，无调用形式）：

```ts
STORE_SHARED_SOURCE; // '@migaia/store-shared'
```

**`createStoreSharedError`｜5 秒上手** —— 构造一个带 `(source, code)` 身份标记的 `Error`（用于组合本包之上的自定义封装时，抛出与本包同一套身份契约的错误）：

```ts
throw createStoreSharedError(
  StoreSharedErrorCode.invalidOption,
  'entity slot must be preallocated'
);
```

全部参数：`code: IStoreSharedErrorCode`（必填）、`message: string`（必填）、`options?: { readonly cause?: unknown }`（可选，透传给 `Error` 构造函数的 `cause`）。

**`createStoreSharedRangeError`｜5 秒上手** —— 与上面相同，但构造 `RangeError`（本包自身校验入参失败时用的就是它）：

```ts
throw createStoreSharedRangeError(StoreSharedErrorCode.invalidOption, 'length must be >= 0');
```

参数与 `createStoreSharedError` 完全一致，唯一区别是返回的运行时类型是 `RangeError`。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 主线程 + Worker：共享数组、自动推送、优雅关闭

```ts
// main.ts
import { createRuntime, Effect } from '@migaia/reactive';
import { sharedInt32Array } from '@migaia/store-shared';

const runtime = createRuntime();
const positions = sharedInt32Array(runtime, 1000); // 500 个实体的 x/y

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ buffer: positions.buffer });

const stopWatch = positions.watch(); // worker 的写入自动推送进来
const render = new Effect(() => drawEntity(0, positions.get(0), positions.get(1)), runtime);

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
  setInterval(() => positions.update(0, (x) => x + 1), 16);
};
```

### 2. 不支持 `Atomics.waitAsync` 的环境：手动轮询 + 错误码分支

```ts
import { StoreSharedErrorCode, sharedInt32Array } from '@migaia/store-shared';

const positions = sharedInt32Array(runtime, 1000, { buffer: sharedBuffer });

let stopWatch: (() => void) | undefined;
try {
  stopWatch = positions.watch();
} catch (error) {
  if ((error as { code?: string }).code === StoreSharedErrorCode.envUnsupported) {
    const timer = setInterval(() => {
      const changed = positions.sync();
      if (changed > 0) console.log(`${changed} 个下标发生了远端变化`);
    }, 100);
    stopWatch = () => clearInterval(timer);
  } else {
    throw error;
  }
}
```

### 3. 单信号跨线程握手：`postMessage` 只传 buffer，不传对象

```ts
import { createRuntime } from '@migaia/reactive';
import { sharedInt32 } from '@migaia/store-shared';

const mainRuntime = createRuntime();
const shared = sharedInt32(mainRuntime, 0);
worker.postMessage({ buffer: shared.buffer }); // SharedArrayBuffer 可以直接传递，不会被拷贝

// worker 内
const workerRuntime = createRuntime();
const mirror = sharedInt32(workerRuntime, 0, receivedBuffer); // initialValue 被忽略，附着已有数据
mirror.watch();
```

### 4. 高频轮换下标读取：`prune()` 主动回收响应式 cell

```ts
import { Effect } from '@migaia/reactive';

const probe = new Effect(() => {
  for (let index = 0; index < positions.length; index += 37) {
    positions.get(index); // 遍历式探测，每次命中不同下标
  }
}, runtime);

setInterval(() => {
  const removed = positions.prune(); // 清理已无订阅者的 cell，避免累积
  if (removed > 0) console.log(`released ${removed} idle cells`);
}, 5000);
```

### 5. 用 `createStoreSharedRangeError` 包装上层校验，保持同一套错误身份

```ts
import {
  StoreSharedErrorCode,
  createStoreSharedRangeError,
  sharedInt32Array
} from '@migaia/store-shared';

function createEntityGrid(runtime: IRuntime, entityCount: number) {
  if (entityCount <= 0) {
    throw createStoreSharedRangeError(
      StoreSharedErrorCode.invalidOption,
      'entityCount must be a positive integer'
    );
  }
  return sharedInt32Array(runtime, entityCount * 2); // 每个实体占 [x, y] 两格
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
