# 使用手册

本文是 `@migaia/store-wasm` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个字段构造器的精确参数、每一种边界行为、每一条错误信息"。

## 目录

1. [初始化：`ensureWasm()`](#1-初始化ensurewasm)
2. [与 `createStore()` 集成](#2-与-createstore-集成)
3. [与 `StoreProvider` 集成](#3-与-storeprovider-集成)
4. [`number()`](#4-number)
5. [`boolean()`](#5-boolean)
6. [`string(maxBytes?)`](#6-stringmaxbytes)
7. [`array(item, length, granularity?)`](#7-arrayitem-length-granularity)
8. [`record(shape)`](#8-recordshape)
9. [生命周期与释放](#9-生命周期与释放)
10. [错误信息完整参考](#10-错误信息完整参考)
11. [错误模块公开导出：`StoreWasmErrorCode`/`create*`/常量](#11-错误模块公开导出)
12. [扩展：基于 arena 自定义 WASM 字段](#12-扩展基于-arena-自定义-wasm-字段)
13. [常见问题排查](#13-常见问题排查)
14. [构建、格式化与测试](#14-构建格式化与测试)

---

## 1. 初始化：`ensureWasm()`

```ts
import { ensureWasm } from '@migaia/store-wasm';

await ensureWasm(); // 之后所有字段构造器的 create() 才能同步工作
```

| 签名           | 参数 | 返回值                        | 同步/异步 | 作用                                                     |
| -------------- | ---- | ----------------------------- | --------- | -------------------------------------------------------- |
| `ensureWasm()` | 无   | `Promise<WebAssembly.Memory>` | 异步      | 加载并实例化底层 `@migaia/wasm` 模块，返回其线性内存对象 |

`ensureWasm()` 在模块作用域内缓存加载结果：

- 已经就绪时，立即返回 `Promise.resolve(memory)`。
- 正在加载中时，重复调用拿到**同一个** in-flight promise 引用——不会重复触发底层的 fetch/instantiate，也不会因为父组件无关重渲染或 React StrictMode 的双重调用而重复初始化。
- 加载失败时，内部缓存会被清空，下一次调用 `ensureWasm()` 会发起新的加载尝试（不会永久卡在失败状态）。

`ensureWasm()` 本身不做字段分配，只保证底层 `WebAssembly.Memory` 就绪。所有字段构造器（`number()`/`boolean()`/`string()`/`array()`/`record()`）的 `create()` 都是**同步**函数，内部通过 `allocateOwnedSync` 直接读取已缓存的内存——如果调用时 `ensureWasm()` 还没 settle，会同步抛错（见 [§10](#10-错误信息完整参考)），而不是挂起等待。

---

## 2. 与 `createStore()` 集成

字段构造器实现的是 `@migaia/store-light` 的 `SyncFieldBuilder` 协议（`mode: 'sync'`），可以直接放进 `createStore()` 的字段声明：

```ts
import { createStore } from '@migaia/store-light';
import { ensureWasm, number, boolean, string, array, record } from '@migaia/store-wasm';

await ensureWasm();

const store = createStore({
  hp: number(),
  alive: boolean(),
  name: string(64),
  hits: array(number(), 1000),
  pos: record({ x: number(), y: number() })
});

store.hp.value = 100;
store.alive.value = true;
store.name.value = 'boss';
store.hits.setAt(0, 1);
store.pos.x = 10;

store.$dispose(); // 递归释放上面五个字段各自持有的 WASM 分配
```

要点：

- **`createStore()` 只接受 `mode: 'sync'` 的字段构造器**，`store-wasm` 的全部构造器都满足这一点，可以直接用 `createStore()`，不需要 `createAsyncStore()`。真正的"异步"部分（WASM 加载）必须在调用 `createStore()` 之前用 `await ensureWasm()` 完成。
- **字段本身就是 `store.<key>` 的值**，不是被拆包的原始类型——`number()`/`boolean()`/`string()` 产出的字段要通过 `.value` 读写（`store.hp.value`），`record()` 产出的字段直接把每个 key 暴露成可读写属性（`store.pos.x`），`array()` 产出的字段要用 `at()`/`setAt()`/`setRange()`/`view()`。
- **Store 拥有字段的生命周期**：`createStore()` 内部会把每个 wasm 字段登记进 Store 自己的 disposal scope，`store.$dispose()` 时自动调用每个字段的 `dispose()`。业务代码不需要、也不应该在 Store 存活期间手动 `dispose()` 单个 wasm 字段。
- 如果不经过 `createStore()`，而是直接拿字段构造器手写 `builder.create(context)`（比如写测试、写自定义 runtime 集成），字段的生命周期完全由调用方负责，`context` 需要自己提供符合 `FieldContext`（`runtime`、`signal`、`createSource`）形状的对象，这是 `@migaia/store-light` 定义的协议，详见该包文档。

---

## 3. 与 `StoreProvider` 集成

`@migaia/store-wasm` 本身不依赖 `@migaia/store-react`，但设计上专门为配合 `StoreProvider` 的就绪屏障而准备：

```tsx
import { StoreProvider } from '@migaia/store-react';
import { ensureWasm } from '@migaia/store-wasm';

function App() {
  return (
    <StoreProvider config={{ features: { wasm: true }, ready: [ensureWasm] }}>
      <Game />
    </StoreProvider>
  );
}
```

`StoreProvider` 的 `config.features.wasm: true` 声明"这棵子树会用到 wasm 字段"；`config.ready` 是子树渲染前必须 settle 的屏障数组，把 `ensureWasm` 传进去之后，`Game` 组件挂载时 WASM 已经保证就绪，组件内部可以直接同步调用 `number()`、`array()` 等构造器，不需要再手动 `await`。如果 `features.wasm` 为 `true` 而 `ready` 留空，`StoreProvider` 会在开发期直接抛错提醒你漏配了就绪屏障——这是 `@migaia/store-react` 侧的行为，不是本包直接抛出的错误，完整语义见该包文档。

不使用 `StoreProvider` 的场景（Node 脚本、非 React 环境、测试），按 [§1](#1-初始化ensurewasm) 直接手动 `await ensureWasm()` 即可，效果等价。

---

## 4. `number()`

```ts
const field = number(); // FieldBuilder<IWasmNumberField>
```

无参数。产出字段类型：

```ts
type IWasmNumberField = {
  value: number;
  readonly observed: boolean;
  readonly disposed: boolean;
  dispose(): void;
};
```

| 成员                   | 参数类型       | 同步/异步 | 说明                                                                                         |
| ---------------------- | -------------- | --------- | -------------------------------------------------------------------------------------------- |
| `value`（读/写访问器） | 写入：`number` | 同步      | 读写单个 `number`；写入使用 `Object.is` 比较，值未变化时不触发响应式提交（不产生多余的通知） |
| `observed`（只读）     | 无             | 同步      | 当前是否有响应式订阅者在追踪这个字段                                                         |
| `disposed`（只读）     | 无             | 同步      | 是否已释放                                                                                   |
| `dispose()`            | 无             | 同步      | 释放底层分配；重复调用是 no-op                                                               |

底层布局：一个 8 字节 `f64` 分配，用 `DataView.getFloat64`/`setFloat64`（小端）读写。构造/析构失败会正确回滚已分配的内存，不泄漏。

---

## 5. `boolean()`

```ts
const field = boolean(); // FieldBuilder<IWasmBooleanField>
```

无参数，形状和行为与 `number()` 完全对称（`value: boolean`、`observed`、`disposed`、`dispose()`），唯一区别是底层布局：**1 字节**分配，`true`/`false` 分别映射成 `1`/`0` 存进单个字节，通过 `DataView.getUint8`/`setUint8` 读写。

---

## 6. `string(maxBytes?)`

```ts
const field = string(); // maxBytes 默认 256
const field2 = string(64); // 自定义最大字节数
```

| 参数       | 类型     | 必填性 | 默认值 | 约束                                                                      |
| ---------- | -------- | ------ | ------ | ------------------------------------------------------------------------- |
| `maxBytes` | `number` | 可选   | `256`  | 必须是 `[0, 0xffff_ffff - 4]` 内的安全整数，否则构造时直接抛 `RangeError` |

产出字段：`{ value: string; observed; disposed; dispose() }`，语义与 `number()`/`boolean()` 一致，区别在于容量与编码：

- 底层分配大小固定为 `4 + maxBytes` 字节：前 4 字节存 UTF-8 编码后的字节长度（`Uint32`，小端），后面 `maxBytes` 字节是**定长**字节缓冲区——容量在构造时就确定，不会因为写入更长的字符串而重新分配（重新分配意味着地址变化，和"一块字段对应一块固定内存"的设计前提冲突）。
- `value = '...'` 时用 `TextEncoder` 把字符串编码成 UTF-8 字节；**编码后字节数超过 `maxBytes` 会直接抛错，不会截断**——超长字符串必须由调用方自己处理（截断、报错、换用更大的 `maxBytes`）。
- 读取时按存储的长度前缀切片并用 `TextDecoder` 解码，不会读到缓冲区里超出实际长度的脏字节。
- 写入前会先解码当前值做 `===` 比较，值未变化时跳过提交（不产生多余通知），代价是每次写入都要先解码一次——存超大字符串、超高频写入的场景需要留意这个开销。

多字节字符（中文、emoji 等）按 UTF-8 字节数计算，不是字符数——`maxBytes` 需要按最坏情况的字节占用预留余量。

---

<a id="7-arrayitem-length-granularity"></a>

## 7. `array(item, length, granularity?)`

```ts
const field = array(number(), 1000); // granularity 默认 64
const field2 = array(number(), 1000, 1); // 每个 index 独立追踪
```

| 参数          | 类型                        | 必填性 | 默认值 | 约束                                                                                        |
| ------------- | --------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------- |
| `item`        | `ReturnType<typeof number>` | 必填   | 无     | **目前只支持 `number()`**；参数存在是为了给数组元素类型占位，未来扩展其他元素类型的接口形状 |
| `length`      | `number`                    | 必填   | 无     | `[0, floor(0xffff_ffff / 8)]`（即 536,870,911）内的安全整数，否则构造时抛 `RangeError`      |
| `granularity` | `number`                    | 可选   | `64`   | 必须是正安全整数，否则抛 `RangeError`                                                       |

产出字段：

```ts
type IWasmArrayField = {
  readonly length: number;
  at(index: number): number;
  setAt(index: number, value: number): void;
  setRange(lo: number, hi: number, values: ArrayLike<number>): void;
  view(): Float64Array;
  readonly disposed: boolean;
  dispose(): void;
};
```

| 成员                       | 参数类型                                                | 同步/异步 | 说明                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at(index)`                | `index: number`                                         | 同步      | 读取单个元素；越界抛 `RangeError`；读取会 track 该 index 所属的分桶                                                                                                  |
| `setAt(index, value)`      | `index: number`, `value: number`                        | 同步      | 写入单个元素；`Object.is` 比较无变化时跳过提交；越界抛 `RangeError`                                                                                                  |
| `setRange(lo, hi, values)` | `lo: number`, `hi: number`, `values: ArrayLike<number>` | 同步      | 批量写入 `[lo, hi)` 区间；`values.length` 必须等于 `hi - lo`；同一批次里落进同一个分桶的写入会合并到一次 `commit`，跨分桶的写入包在一次 `runtime.batch()` 里一起提交 |
| `view()`                   | 无                                                      | 同步      | 返回**当前内容的独立拷贝**（新分配的 `Float64Array`），不是线性内存的实时视图；直接修改这个返回值既不会触发响应式通知，也不会写回字段                                |

**分桶（granularity）**：数组底层是一整块连续的 `Float64Array`，但响应式追踪不是逐元素的——`granularity` 个连续 index 共享一个响应式 Source（"桶"），默认 64。粒度越粗，Source 数量越少（内存/管理开销小），但一次写入会让整个桶内所有订阅者都收到通知；`granularity: 1` 退化成逐元素独立追踪，精度最高但 Source 数量等于 `length`。分桶按需惰性创建——只有实际被 `at()`/`setAt()`/`setRange()` 触碰过的桶才会创建对应的 Source。

底层布局：`length * 8` 字节的连续分配，构造时会校验分配地址按 8 字节对齐（`Float64Array` 的构造要求），未对齐会抛 `Error`（正常分配器不会触发，这是防御性校验，不是常见路径）；`length === 0` 时直接返回长度为 0 的空视图，不依赖对齐假设。

---

## 8. `record(shape)`

```ts
const field = record({ x: number(), y: number(), z: number() });
```

| 参数    | 类型                                        | 必填性 | 约束                                                                                    |
| ------- | ------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `shape` | `Record<string, ReturnType<typeof number>>` | 必填   | 每个 key 对应的值必须是 `number()` 返回的构造器；key 不能是 `'dispose'` 或 `'disposed'` |

产出字段类型是 `shape` 的键到 `number` 的映射，外加 `IDisposable`：

```ts
type IWasmRecordField<Shape> = { [K in keyof Shape]: number } & {
  readonly disposed: boolean;
  dispose(): void;
};
```

- **每个 key 是独立的响应式 Source**（调试名 `WasmRecord.<key>`），读写某一个 key 只影响订阅了那个 key 的观察者，不会波及其他 key。
- 底层是一块 `keys.length * 8` 字节的连续分配，每个 key 占 8 字节（`f64`），偏移量按 `shape` 的 key 顺序（`Object.keys` 顺序）依次排列。
- key 直接以属性访问的方式读写（`field.x = 1`），**不像 `number()`/`boolean()`/`string()` 那样要经过 `.value`**——`record()` 内部把每个 key 定义成了带 getter/setter 的属性，getter/setter 本身就是读写入口。
- `dispose`/`disposed` 是不可枚举属性，`x`/`y`/`z` 这类业务 key 是可枚举的——对字段做 `for...in`、`Object.keys()`、`JSON.stringify()` 只会看到业务 key，不会意外带出 `dispose`/`disposed`。
- `shape` 里的 key 若是 `'dispose'` 或 `'disposed'`，构造时立即抛 `TypeError`（这两个名字被字段实例自身的方法/属性占用，不能被业务字段覆盖）。

`record()` 目前不支持嵌套 `record()`、`array()` 或其他复合类型作为字段值——`shape` 的值必须是 `number()` 构造器本身。

---

## 9. 生命周期与释放

所有字段共享同一套生命周期契约（`IDisposable`）：

1. **构造**：`ensureWasm()` 已就绪的前提下，调用 `field.create(context)`（通常由 `createStore()` 代为调用）同步完成分配 + 响应式 Source 创建。构造中途任何一步失败（比如 `context.signal` 已经 aborted、内存对齐校验失败），已经分配的内存和已创建的 Source 会被完整回滚，不会半途留下资源。
2. **使用**：读写会先检查 `disposed` 状态，已释放的字段继续读写会抛 `Error`（具体信息见 [§10](#10-错误信息完整参考)）。
3. **释放**：`dispose()` 释放底层内存分配、注销 `FinalizationRegistry` 登记、并 dispose 掉自己创建的响应式 Source（`array()`/`record()` 会 dispose 掉全部分桶/全部 key 的 Source）。`dispose()` 本身是幂等的——重复调用直接返回，不会重复释放或抛错。
4. **GC 兜底**：字段构造成功后会用 `FinalizationRegistry`（运行时不支持时静默跳过，不报错）登记自己，一旦字段对象本身被垃圾回收且从未显式 `dispose()`，注册的回调会异步释放底层分配。这只是防止"忘记 dispose 导致的永久泄漏"的最后一道保险——时机完全不可预测（取决于 GC 何时运行），**不能**作为常规的资源管理方式，显式 `dispose()`（或让 `store.$dispose()` 代为处理）才是设计上的主路径。

`createStore()` 场景下不需要关心上面第 3 步——Store 会把每个 wasm 字段登记进自己的 disposal scope，`store.$dispose()` 时按 scope 的规则统一释放。只有绕开 Store 直接调用 `builder.create(context)` 时，才需要自己在合适的时机调用 `field.dispose()`。

---

## 10. 错误信息完整参考

| 触发条件                                                                    | 错误类型     | 信息                                                                                        |
| --------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `allocate`/`allocateSync` 的 `byteLen` 不是 `[0, 0xffff_ffff]` 内的安全整数 | `RangeError` | `wasm.allocate: byteLen must fit an unsigned 32-bit integer`                                |
| 字段构造时 WASM 尚未就绪（未 `await ensureWasm()`）                         | `Error`      | `[store] WASM is not initialized; await ensureWasm() or use StoreProvider`                  |
| 字段构造时 `context.signal` 已经 aborted                                    | `Error`      | `[store] field init aborted`                                                                |
| `number()`/`boolean()`/`string()` 字段 dispose 后读 `.value`                | `Error`      | `[store] cannot read a disposed wasm field`                                                 |
| `number()`/`boolean()`/`string()` 字段 dispose 后写 `.value`                | `Error`      | `[store] cannot write a disposed wasm field`                                                |
| `array()` 字段 dispose 后调用任意方法                                       | `Error`      | `[store] cannot use a disposed wasm field`                                                  |
| `array()` 的 `length` 超出 `[0, floor(0xffff_ffff/8)]`                      | `RangeError` | `wasm.array: length exceeds the Wasm32 allocation limit`                                    |
| `array()` 的 `granularity` 不是正安全整数                                   | `RangeError` | `wasm.array: granularity must be a positive safe integer`                                   |
| `array()` 分配地址未按 8 字节对齐（防御性校验，正常不会触发）               | `Error`      | `wasm.array: allocation not 8-byte aligned (ptr=${ptr})`                                    |
| `array().at(i)` / `setAt(i, ...)` 的 `i` 越界或非安全整数                   | `RangeError` | `wasm.array: index out of bounds (${i})`                                                    |
| `array().setRange(lo, hi, ...)` 的区间不合法                                | `RangeError` | `wasm.array: invalid range [${lo}, ${hi})`                                                  |
| `array().setRange()` 的 `values` 不是 array-like                            | `TypeError`  | `wasm.array: values must be array-like`                                                     |
| `array().setRange()` 的 `values.length !== hi - lo`                         | `RangeError` | `wasm.array: values length must match the target range`（由 `StoreWasmErrorText` 统一维护） |
| `string()` 的 `maxBytes` 超出 `[0, 0xffff_ffff - 4]`                        | `RangeError` | `wasm.string: maxBytes exceeds the Wasm32 allocation limit`                                 |
| `string()` 字段写入的字符串编码后超过 `maxBytes`                            | `Error`      | `wasm.string: value exceeds maxBytes (${实际字节数} > ${maxBytes})`                         |
| `string()` 字段读取到存储长度大于 `maxBytes`（数据损坏，正常不会触发）      | `Error`      | `wasm.string: corrupted byte length`                                                        |
| `record()` 的 `shape` 里出现 key 为 `'dispose'` 或 `'disposed'`             | `TypeError`  | `[store] wasm.record field name is reserved: ${key}`                                        |

---

<a id="11-错误模块公开导出"></a>

## 11. 错误模块公开导出：`StoreWasmErrorCode`/`create*`/常量

除字段构造器与 `ensureWasm()` 外，根入口还公开导出以下错误相关符号，供调用方识别本包抛出的错误、或在扩展自定义字段时复用同一套错误构造逻辑：

```ts
import {
  StoreWasmErrorCode,
  type IStoreWasmErrorCode,
  STORE_WASM_SOURCE,
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  createStoreWasmAggregateError,
  WasmFieldMode,
  type IWasmFieldMode,
  WasmReservedKey,
  type IWasmReservedKey
} from '@migaia/store-wasm';
```

```ts
const StoreWasmErrorCode = {
  notInitialized: 'NOT_INITIALIZED',
  fieldDisposed: 'FIELD_DISPOSED',
  initAborted: 'INIT_ABORTED',
  reservedFieldName: 'RESERVED_FIELD_NAME',
  allocationFailed: 'ALLOCATION_FAILED',
  invalidOption: 'INVALID_OPTION',
  cleanupFailed: 'CLEANUP_FAILED'
} as const;
type IStoreWasmErrorCode = (typeof StoreWasmErrorCode)[keyof typeof StoreWasmErrorCode];
```

稳定错误码表，是公开 API 的一部分——改名视为破坏性变更。每条码值的触发条件：

| 码值                | 触发条件                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `notInitialized`    | 字段在 `ensureWasm()` settle 之前同步构造/分配                                     |
| `fieldDisposed`     | 读写/使用一个已 `dispose()` 的字段                                                 |
| `initAborted`       | 字段初始化时 `context.signal` 已经 aborted                                         |
| `reservedFieldName` | `record()` 的 `shape` 用了 `'dispose'`/`'disposed'` 作为 key                       |
| `allocationFailed`  | WASM 分配失败或对齐/长度校验失败                                                   |
| `invalidOption`     | 构造/写入参数非法（超容量、下标越界、granularity 非法等）                          |
| `cleanupFailed`     | 字段释放或构造回滚时有多个 owned resource 清理失败（携带 `AggregateError.errors`） |

```ts
const STORE_WASM_SOURCE: '@migaia/store-wasm';
```

本包每个抛出的错误上 `source` 字段的固定值，用于结合 `code` 做双重识别，避免和其他包同名的 `code` 混淆。

```ts
function createStoreWasmError(
  code: IStoreWasmErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error;
function createStoreWasmRangeError(code: IStoreWasmErrorCode, message: string): RangeError;
function createStoreWasmTypeError(
  code: IStoreWasmErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError;
function createStoreWasmAggregateError(
  code: IStoreWasmErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError;
```

四个错误构造函数，均通过 `attachErrorIdentity`（`@migaia/utils/error`）把 `source: STORE_WASM_SOURCE` 与传入的 `code` 挂到对应类型的原生错误对象上，不修改 `stack`。包内部构造字段错误时统一走这四个函数；扩展自定义字段类型（见 [§12](#12-扩展基于-arena-自定义-wasm-字段)）时可以复用它们保持错误身份风格一致。`createStoreWasmError`/`createStoreWasmTypeError` 的 `options.cause` 若提供会传给底层 `Error`/`TypeError` 构造函数的 `{ cause }`。

```ts
try {
  field.value = 123;
} catch (error) {
  const e = error as { source?: string; code?: string };
  if (e.source === STORE_WASM_SOURCE && e.code === StoreWasmErrorCode.fieldDisposed) {
    // 字段已释放
  }
}
```

```ts
const WasmFieldMode = { sync: 'sync' } as const;
type IWasmFieldMode = 'sync';
```

字段构造器 `mode` 字段的取值集合，目前只有 `'sync'`——本包全部字段构造器都同步产出字段，`create()` 中不发起任何异步操作（异步初始化已经被 `ensureWasm()` 提前完成）。`createStore()` 依据这个字段判断某个 `FieldBuilder` 能否被同步调用。

```ts
const WasmReservedKey = { dispose: 'dispose', disposed: 'disposed' } as const;
type IWasmReservedKey = 'dispose' | 'disposed';
```

`record()` 的 `shape` 禁止使用的 key 集合——这两个名字被字段实例自身的 `dispose()`/`disposed` 占用。`record()` 内部在构造时用这个常量做校验（见 [§8](#8-recordshape)）。

---

<a id="12-扩展基于-arena-自定义-wasm-字段"></a>

## 12. 扩展：基于 arena 自定义 WASM 字段

`number()`/`boolean()`/`string()`/`array()`/`record()` 内部都构建在同一套底层分配原语之上，这些原语位于 `src/arena.ts`。它们是包内实现细节：当前 `package.json` 只公开根入口，消费方不能从 `@migaia/store-wasm/arena`、`@migaia/store-wasm/field` 或其他子路径导入。

| 内部符号（非公开导出）       | 参数类型             | 同步/异步 | 作用                                                                                                                                      |
| ---------------------------- | -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `allocateOwnedSync(byteLen)` | `byteLen: number`    | 同步      | 同步分配一块内存并返回 `IWasmAllocation`（`memory`/`id`/`ptr`/`register`/`unregister`/`dispose`），供字段构造器在自己的 `create()` 里使用 |
| `allocate(byteLen)`          | `byteLen: number`    | 异步      | 异步分配：内部先 `await ensureWasm()` 再分配，适合在 WASM 尚未就绪时也能发起分配请求的场景                                                |
| `allocateSync(byteLen)`      | `byteLen: number`    | 同步      | 同步分配：要求 WASM 已就绪，否则抛 `[store] WASM is not initialized...`                                                                   |
| `deallocate(id)`             | `id: number`         | 同步      | 释放指定分配 id；对未知/已释放的 id 是 no-op，天然抗重复调用                                                                              |
| `registry`                   | 不适用（非函数导出） | 不适用    | 对 `FinalizationRegistry` 的薄封装（`register`/`unregister`），运行时不支持时静默降级为 no-op                                             |
| `IWasmAllocation`            | 不适用（类型定义）   | 不适用    | 一块分配的类型：`memory`、`id`、`ptr`，以及 `register`/`unregister`/`dispose`                                                             |

如果需要新的字段类型（例如另一种数值精度或编码），当前做法是向本包贡献实现并由根入口正式导出；不要依赖 `src/arena.ts`、`src/number.ts` 或 `src/string.ts` 的深层路径。它们没有版本化的外部兼容承诺。

---

<a id="13-常见问题排查"></a>

## 13. 常见问题排查

**Q：字段构造直接抛 `[store] WASM is not initialized; await ensureWasm() or use StoreProvider`。**
在调用 `number()`/`array()` 等构造器之前（更准确地说，在它们被 `createStore()` 调用 `create()` 之前）没有等到 `ensureWasm()` settle。要么手动 `await ensureWasm()` 后再 `createStore()`，要么用 `StoreProvider` 的 `config.ready: [ensureWasm]` 屏障子树渲染，见 [§3](#3-与-storeprovider-集成)。

**Q：`string()` 字段赋值报 `wasm.string: value exceeds maxBytes`。**
容量在构造时就固定了，超长字符串不会被截断，只会报错。要么在写入前自己截断/校验长度，要么把 `maxBytes` 调大——但要注意 `maxBytes` 决定了这个字段固定占用的内存大小，不要为了"保险"设一个远超实际需要的值。

**Q：`array()` 里改了一堆值，但只想让某几个观察者更新，或者想让每个 index 都精确追踪。**
调整 `granularity`：默认 64 表示 64 个连续 index 共享一次通知，传 `1` 可以让每个 index 独立追踪（Source 数量等于 `length`，内存/管理开销相应变大）。

**Q：`array().view()` 拿到的数组改了值，为什么字段没反应？**
`view()` 返回的是当前内容的**拷贝**，不是线性内存的实时引用，设计上就是为了防止调用方绕开响应式系统直接改内存、或者拿到一个能看见其他字段内存的越权视图。需要写入必须走 `setAt()`/`setRange()`。

**Q：`record()` 的字段能不能嵌套 `array()` 或另一个 `record()`？**
不能。`record()` 的 `shape` 类型约束就是 `Record<string, ReturnType<typeof number>>`——每个 key 必须是 `number()`，不支持嵌套复合类型。

**Q：忘记调用 `dispose()` 会不会内存泄漏？**
如果字段是通过 `createStore()` 创建的，`store.$dispose()` 会自动帮你释放，正常使用不会泄漏。如果是绕开 Store 手写 `builder.create(context)` 又忘记 `dispose()`，`FinalizationRegistry` 兜底会在字段对象被 GC 时异步释放——但这只是兜底，时机不确定，不要依赖它作为常规释放手段。

<a id="14-构建格式化与测试"></a>

## 14. 构建、格式化与测试

在仓库根目录运行：

```bash
pnpm --filter @migaia/store-wasm fmt
pnpm --filter @migaia/store-wasm lint
pnpm --filter @migaia/store-wasm typecheck
pnpm --filter @migaia/store-wasm typecheck:test
pnpm --filter @migaia/store-wasm test
pnpm --filter @migaia/store-wasm build
```

这些测试使用假的 WASM provider 验证字段布局、释放顺序、数组重入和公开导出；它们不替代 `@migaia/wasm` 的 Rust 测试。
