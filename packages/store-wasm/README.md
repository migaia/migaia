# @migaia/store-wasm

**给 `store-light` 用的 WASM 线性内存字段**——`number`、`boolean`、`string`、`array`、`record` 五种字段构造器，把状态直接存进一块 WebAssembly 线性内存，而不是普通 JS 堆对象；私有的 `@migaia/wasm` 加载/内存细节被完全隐藏在这个包后面，业务代码永远不需要直接碰它。

## 1. 这是什么

`store-light` 的 `createStore({...})` 里，普通字段值默认存成一个响应式 Signal，本质还是 JS 堆上的对象。大多数场景这样就够了，但如果你的状态是**大量同结构的数值**（比如一个几万项的浮点数组、一份要频繁整体序列化/跨线程搬运的定长记录），JS 对象/数组的内存开销和 GC 压力会成为实际瓶颈。

`@migaia/store-wasm` 提供的字段构造器，长得跟 `store-light` 里普通字段一样——放进 `createStore({...})` 的字段声明里，照样能读写、照样能被组件订阅重渲染——但底层数据实际存在一块通过 `@migaia/wasm` 分配的 `WebAssembly.Memory` 里，而不是 JS 对象里。字段的响应式追踪（`track()`/`commit()`）走的是和普通字段完全同一套依赖图，唯一不同的是数据存储位置。

WASM 内存需要异步初始化，字段构造本身却是同步的——这个包把"先异步就绪、再同步分配"这条时序规则封装成了 `ensureWasm()` 一个函数，并规定：**在调用 `ensureWasm()` 之前，任何一个字段构造器的 `create()` 都无法工作**，会抛出明确的错误而不是静默用错误的内存。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 大量同类型数值状态 | `array(number(), length)` 把一整块定长浮点数组放进线性内存，避免几万个 JS number 装箱 |
| 定长结构化记录 | `record({ x: number(), y: number(), ... })` 把几个固定字段打包进一块连续内存，逐字段独立响应式 |
| 需要和 WASM/Rust 侧共享内存布局 | 数据本身就活在 `WebAssembly.Memory` 里，天然适合后续接入更多 WASM 计算 |
| 对单个数值/布尔/字符串做细粒度响应式追踪 | `number()`/`boolean()`/`string()` 每个都是独立 Source，互不牵连 |

不适合的场景：字段值是 class 实例、函数、循环引用结构，或者数据量很小、访问频率也不高——这些场景下普通 Signal 字段更简单，`store-wasm` 引入的初始化时序和固定容量限制反而是负担。

## 3. 用了之后能得到什么

- **和普通字段一样的使用体验**：字段构造器实现的是 `store-light` 的 `FieldBuilder` 协议，放进 `createStore()` 的字段声明里就能用，读写触发的响应式行为和普通字段完全一致。
- **确定性的内存生命周期**：每个字段持有一块显式分配，`dispose()` 立即释放；`createStore()` 创建的 store 调用 `$dispose()` 时会自动帮你 dispose 掉里面的 wasm 字段，不需要逐个手动清理。
- **GC 兜底**：忘记 `dispose()` 也不会永久泄漏——`FinalizationRegistry`（若运行时支持）会在字段对象被回收时自动释放底层分配；但这只是兜底，时机不可预测，显式 `dispose()` 才是主路径。
- **构造失败不泄漏**：字段构造过程中任何一步出错（比如 store 已经在 dispose 中止），已经分配的内存和已创建的响应式 Source 都会被清理干净。
- **可控的内存占用**：`string()` 的容量、`array()` 的长度都在构造时就确定并校验，不会有运行时的隐式扩容。

## 4. 五分钟上手

```ts
import { createStore } from '@migaia/store-light';
import { ensureWasm, number, boolean, record } from '@migaia/store-wasm';

// WASM 是异步加载的，必须先等它就绪，字段构造器本身才能同步工作
await ensureWasm();

const store = createStore({
  score: number(),
  active: boolean(),
  position: record({ x: number(), y: number() })
});

store.score.value = 100;
store.active.value = true;
store.position.x = 1.5;

console.log(store.score.value, store.active.value, store.position.x);

store.$dispose(); // 连带释放 score/active/position 占用的 WASM 内存
```

命名多是通用词（`number`、`array`、`record`……），源码里建议用命名空间方式导入避免和其他导出撞名：

```ts
import * as wasm from '@migaia/store-wasm';

const field = wasm.number();
```

在 `@migaia/store-react` 里用 `StoreProvider` 时不需要手动 `await ensureWasm()`——把它交给 provider 的就绪屏障即可，见 [USEGUIDE](./USEGUIDE.md)。

## 5. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **字段构造器（FieldBuilder）** | `number()`/`boolean()`/`string()`/`array()`/`record()` 返回的对象，放进 `createStore()` 字段声明里，由 Store 调用其 `create()` 生成真正的字段 |
| **`ensureWasm()`** | 模块级缓存的 WASM 初始化函数；重复调用拿到同一个 promise，不会重复加载 |
| **分配（allocation）** | 一个字段对应线性内存里的一块定长区域，构造时分配、`dispose()` 时释放 |
| **就绪屏障** | 字段的 `create()` 是同步的，但要求调用时 `ensureWasm()` 已经 settle；否则同步抛错 |

## 6. 字段构造器一览

| 构造器 | 参数类型 | 同步/异步 | 产出字段 | 说明 |
| --- | --- | --- | --- | --- |
| `number()` | 无 | 同步 | `{ value: number }` | 单个 `f64`，8 字节 |
| `boolean()` | 无 | 同步 | `{ value: boolean }` | 单字节 |
| `string(maxBytes?)` | `maxBytes?: number` | 同步 | `{ value: string }` | 定长字节缓冲区，超出 `maxBytes` 写入会抛错，不会截断 |
| `array(number(), length, granularity?)` | `item: FieldBuilder<IWasmNumberField>`, `length: number`, `granularity?: number` | 同步 | `{ length, at, setAt, setRange, view }` | 定长 `Float64Array`，索引按 `granularity` 分桶做响应式追踪 |
| `record(shape)` | `shape: Record<string, FieldBuilder<IWasmNumberField>>` | 同步 | `shape` 里每个 key 对应一个 `number` | 固定命名字段打包进一块连续内存，逐字段独立响应式 |

字段类型/配置项/错误行为的完整表格见 [USEGUIDE.md](./USEGUIDE.md)。

## 7. 安装

```bash
pnpm add @migaia/store-wasm
```

依赖 `@migaia/reactive`、`@migaia/store-light`、`@migaia/wasm`（均为 workspace 内部包）。

## 8. 注意事项（最容易踩的坑）

1. **必须先 `await ensureWasm()` 再构造字段**。字段构造器的 `create()` 是同步的，如果 WASM 还没就绪会直接抛 `[store] WASM is not initialized; await ensureWasm() or use StoreProvider`。
2. **容量在构造时就固定**。`string(maxBytes)` 超容量赋值直接抛错（不截断）；`array(item, length)` 的 `length` 构造后不可变。
3. **`array()` 目前只支持 `number()` 作为 item**，其他字段类型不能作为数组元素。
4. **`record()` 的字段名不能是 `dispose` 或 `disposed`**——这两个名字被字段实例自身占用。
5. **`array().view()` 返回的是快照拷贝**，不是线性内存的实时视图；直接改这个 `Float64Array` 不会触发响应式通知，也不会写回字段。
6. **字段一旦 `dispose()` 就不能再用**，继续读写会抛错；但 `dispose()` 本身可以安全重复调用。
7. **通过 `createStore()` 使用时不需要手动 `dispose()` 单个字段**——`store.$dispose()` 会自动释放它拥有的全部 wasm 字段；只有绕开 Store、直接调用 `builder.create(context)` 时才需要自己管理生命周期。

## 9. 深入参考

每个字段构造器的完整参数表、字节布局、错误码/错误信息全表、`ensureWasm()`/`StoreProvider` 集成细节、自定义 WASM 字段的扩展点，见 **[USEGUIDE.md](./USEGUIDE.md)**。
