# `@migaia/store-wasm`

给 `@migaia/store-light` 用的 WASM 线性内存字段：`number`/`boolean`/`string`/`array`/`record` 五种字段构造器，把状态直接存进一块 `WebAssembly.Memory`，而不是普通 JS 堆对象。字段实现的是 `store-light` 的 `IFieldBuilder` 协议，放进 `createStore({...})` 的字段声明里就能用，读写触发的响应式行为和普通字段完全一致，唯一不同的是数据存储位置。

## 适用与不适用场景

**适用**：大量同结构的数值状态（几万项的浮点数组）、要频繁整体序列化/跨线程搬运的定长记录、需要和未来的 WASM/Rust 计算共享内存布局的场景、需要对单个数值/布尔/字符串做独立细粒度响应式追踪的场景。

**不适用**：字段值是 class 实例、函数、循环引用结构；数据量很小、访问频率也不高的普通状态——这些场景下 `store-light` 的普通 Signal 字段更简单，`store-wasm` 引入的异步初始化时序和固定容量限制反而是负担。

## 安装

```bash
pnpm add @migaia/store-wasm
```

依赖 `@migaia/reactive`、`@migaia/store-light`、`@migaia/wasm`、`@migaia/utils`（均为 workspace 内部包）。只有一个入口，没有子路径导出；命名多是通用词（`number`、`array`、`record`……），建议用命名空间方式导入：

```ts
import * as wasm from '@migaia/store-wasm'
```

## 目录

- [初始化与 `createStore()` 集成](#初始化模块)
- [字段构造器](#字段构造器模块)
- [错误模块](#错误模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、字节布局、错误码全表，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="初始化模块"></a>

## 初始化与 `createStore()` 集成

```ts
import { ensureWasm, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'
```

**`ensureWasm`｜5 秒上手** —— WASM 是异步加载的，字段构造器的 `create()` 却是同步的；必须先等它就绪：

```ts
await ensureWasm()
const store = createStore({ score: number() })
store.score.value = 100
```

无参数；返回 `Promise<WebAssembly.Memory>`。模块级缓存：已就绪时立即 resolve 同一个 memory；正在加载时重复调用拿到同一个 in-flight promise（不会因 React StrictMode 双渲染等重复触发底层加载）；加载失败会清空缓存，下次调用重新尝试。

在调用 `ensureWasm()` 之前构造任何字段，`create()` 会同步抛错（`[store] WASM is not initialized; await ensureWasm() or use StoreProvider`），不会静默用错误的内存。在 `@migaia/store-react` 里可以用 `StoreProvider` 的就绪屏障代替手动 `await`：`config={{ features: { wasm: true }, ready: [ensureWasm] }}`。

**与 `createStore()` 集成** —— 字段构造器实现 `mode: 'sync'` 的 `IFieldBuilder` 协议，直接放进字段声明即可，不需要 `createAsyncStore()`：

```ts
const store = createStore({
  hp: number(),
  alive: boolean(),
  name: string(64),
  hits: array(1000),
  pos: record({ x: number(), y: number() })
})
store.$dispose() // 递归释放全部五个字段各自持有的 WASM 分配
```

`store.$dispose()` 会自动 `dispose()` 它拥有的每个 wasm 字段，业务代码不需要逐个手动清理；只有绕开 `createStore()` 直接调用 `builder.create(context)` 时才需要自己管理生命周期。

---

<a id="字段构造器模块"></a>

## 字段构造器模块

```ts
import { number, boolean, string, array, record } from '@migaia/store-wasm'
```

构造器本身返回 `IFieldBuilder`（不是字段）；下面的示例都假设已 `await ensureWasm()`，并通过 `createStore()` 产出字段。

**`number`｜3 秒上手** —— 单个 `f64`，8 字节：

```ts
const store = createStore({ field: number() })
store.field.value = 1.5
```

无参数。产出字段：`value: number`（读写访问器，`Object.is` 无变化时跳过提交）、`observed: boolean`（只读，是否有订阅者）、`disposed: boolean`（只读）、`dispose(): void`（幂等）。

**`boolean`｜3 秒上手** —— 与 `number()` 完全对称，底层 1 字节：

```ts
const store = createStore({ field: boolean() })
store.field.value = true
```

无参数。产出字段形状同 `number()`（`value: boolean`/`observed`/`disposed`/`dispose()`）。

**`string`｜5 秒上手** —— 定长字节缓冲区，超容量直接报错、不截断：

```ts
const store = createStore({ field: string(64) }) // 最多 64 字节
store.field.value = 'hello'
```

参数：`maxBytes?: number` —— 默认 `256`，必须是 `[0, 0xffff_ffff - 4]` 内的安全整数，否则构造时抛 `RangeError`。产出字段形状同 `number()`（`value: string`），额外行为：写入用 `TextEncoder` 编码为 UTF-8，字节数超过 `maxBytes` 抛错（不截断）；多字节字符按字节数而非字符数计算容量。

**`array`｜10 秒上手** —— 定长 `Float64Array`，索引按 `granularity` 分桶追踪：

```ts
const store = createStore({ field: array(1000) }) // length=1000, granularity 默认 64
store.field.setAt(0, 1)
store.field.setRange(1, 3, [2, 3])
```

参数：

- `length: number`（必填）—— `[0, floor(0xffff_ffff / 8)]`（536,870,911）内的安全整数，否则抛 `RangeError`
- `granularity?: number` —— 默认 `64`，必须是正安全整数；`granularity: 1` 让每个 index 独立追踪

产出字段：`length: number`（只读）、`at(index): number`、`setAt(index, value): void`、`setRange(lo, hi, values: ArrayLike<number>): void`（批量写，同批同桶写入合并到一次 commit）、`view(): Float64Array`（返回当前内容的**独立拷贝**，改它不会写回字段）、`disposed`/`dispose()`。

内部内存视图按 `memory.buffer` 身份缓存，增长后刷新。`array().view()` 仍返回独立拷贝；字符串每次从当前 bytes 解码，避免隐藏共享内存的写入。

**`record`｜10 秒上手** —— 固定命名字段打包进一块连续内存，逐字段独立响应式：

```ts
const store = createStore({ field: record({ x: number(), y: number() }) })
store.field.x = 1 // 直接属性读写，不经过 .value
```

参数：`shape: Record<string, ReturnType<typeof number>>`（必填）—— 每个 key 必须是 `number()` 构造器；key 不能是 `'dispose'` 或 `'disposed'`（撞名抛 `TypeError`）。产出字段：`shape` 每个 key 映射为可读写 `number` 属性（getter/setter 即读写入口，不需要 `.value`），外加不可枚举的 `disposed`/`dispose()`。不支持嵌套 `record()`/`array()`。

---

<a id="错误模块"></a>

## 错误模块

```ts
import {
  StoreWasmErrorCode,
  STORE_WASM_SOURCE,
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  createStoreWasmAggregateError,
  WasmReservedKey
} from '@migaia/store-wasm'
```

**`StoreWasmErrorCode`｜3 秒上手** —— 稳定错误码表：

```ts
if (error.code === StoreWasmErrorCode.fieldDisposed) {
  /* ... */
}
```

全部取值：`notInitialized`(`NOT_INITIALIZED`)、`fieldDisposed`(`FIELD_DISPOSED`)、`initAborted`(`INIT_ABORTED`)、`reservedFieldName`(`RESERVED_FIELD_NAME`)、`allocationFailed`(`ALLOCATION_FAILED`)、`invalidOption`(`INVALID_OPTION`)、`cleanupFailed`(`CLEANUP_FAILED`)、`instancePoisoned`(`INSTANCE_POISONED`)。本包构造错误带自身 source/code；native 输入读取失败原位附 INVALID_OPTION，取消保留 native reason 或 cause；完整 foreign identity 保留原 owner。

**`createStoreWasmError` / `createStoreWasmRangeError` / `createStoreWasmTypeError` / `createStoreWasmAggregateError`｜5 秒上手** —— 一般由包内部使用，扩展自定义字段类型时可复用：

```ts
throw createStoreWasmError(StoreWasmErrorCode.invalidOption, 'my.field: bad value')
```

参数：`code: IStoreWasmErrorCode`（必填）、`message: string`（必填）；`createStoreWasmError`/`createStoreWasmTypeError` 额外接受第三参数 `{ cause?: unknown }`；`createStoreWasmAggregateError` 签名为 `(code, errors: readonly unknown[], message: string)`。均返回已挂好 `(source, code)` 身份标记的对应错误类型（`Error`/`RangeError`/`TypeError`/`AggregateError`）。

**`WasmReservedKey`｜3 秒上手** —— 常量对象，无调用参数：

```ts
WasmReservedKey.dispose // 'dispose'，record() 禁用的 key 之一
```

全部 builder 使用 canonical StoreFieldMode.sync（来自 store-light），保持同步。`WasmReservedKey` 取值：`dispose`、`disposed`。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 显式应用 owner + Provider 注入

```tsx
import { StoreProvider, createStoreRegistry, createStoreToken, useProvidedStore } from '@migaia/store-react'
import { ensureWasm, number, array } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

// 每个应用 owner 或 SSR 请求调用一次；在 React render 之外完成初始化和分配。
async function createGameApplication() {
  await ensureWasm()
  const registry = createStoreRegistry()
  const store = createStore({ hp: number(), hits: array(1000) }, { runtime: registry.runtime })
  const gameToken = createStoreToken<typeof store>('game')
  registry.register(gameToken, store, { owned: true })
  function Game() {
    const hp = useProvidedStore(gameToken, (state) => state.hp.value)
    return <span>HP: {hp}</span>
  }
  function App() {
    return <StoreProvider registry={registry}><Game /></StoreProvider>
  }
  // 外部 Registry 默认由调用方负责；React root 卸载后 await application.dispose()。
  return { App, dispose: () => registry.disposeAsync() }
}
```

### 2. 大规模浮点数组的分桶粒度取舍

```ts
import { array, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

await import('@migaia/store-wasm').then((m) => m.ensureWasm())

// 6 万个粒子，默认 granularity=64：约 940 个 Source，批量写入时通知合并
const particles = array(60_000)
const store = createStore({ particles })

const dx = new Float64Array(1000).fill(0.1)
store.particles.setRange(0, 1000, dx) // 落进同一批桶的写入合并到一次 commit
```

### 3. record 拆分定长结构体，逐字段独立订阅

```ts
import { record, number } from '@migaia/store-wasm'
import { createStore } from '@migaia/store-light'

const store = createStore({ pos: record({ x: number(), y: number(), z: number() }) })

// 只订阅 x 的观察者不会因为 y/z 的写入而重渲染——三个字段各自独立 Source
store.pos.x = 1
store.pos.y = 2
```

### 4. 识别本包错误并按错误码分支处理

```ts
import { StoreWasmErrorCode, STORE_WASM_SOURCE } from '@migaia/store-wasm'

try {
  field.value = 123
} catch (error) {
  const e = error as { source?: string; code?: string }
  if (e.source === STORE_WASM_SOURCE && e.code === StoreWasmErrorCode.fieldDisposed) {
    // 字段已释放：新建字段而不是复用已释放实例
  } else {
    throw error
  }
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm --filter @migaia/store-wasm fmt && pnpm --filter @migaia/store-wasm lint && pnpm --filter @migaia/store-wasm typecheck && pnpm --filter @migaia/store-wasm typecheck:test && pnpm --filter @migaia/store-wasm test && pnpm --filter @migaia/store-wasm build
```

API convergence：array 改为 array(length, granularity?)，删除从未使用的 item 占位参数，编码仍固定 f64；旧 array(number(), n, g) 必须改 array(n, g)，不保留兼容入口。收回 WasmFieldMode/IWasmFieldMode，内部复用 store-light 的 StoreFieldMode.sync；WasmReservedKey 继续由本包持有。外部旧调用需 breaking 迁移。

边界修复：setAt 在 Source.commit 回调内部刷新当前内存 view。setRange 先读取全部 ArrayLike 输入，getter 失败在未写入前以 INVALID_OPTION 保留 native 原错或 cause。五字段取消共用一个原因保留边界，原生 AbortError 不再换成无 cause 的普通 Error。
