# @migaia/wasm

**用 Rust 编译成 WASM 的字节暂存区 + JSON ⇄ MessagePack 转码器**——不是通用 WASM SDK，只做两件事：给 JS 一块 8 字节对齐、可稳定寻址的线性内存缓冲区，以及一台在这块内存里把 JSON 和 MessagePack 相互转码的机器。

## 1. 这是什么

可以把它想成一个"WASM 里的小仓库管理员"：JS 侧喊一声要多少字节（`alloc_bytes`），管理员在 wasm 线性内存里辟出一块保证 8 字节对齐的空地，发一张编号提货单（id）；JS 凭 id 问管理员要地址（`ptr_of`）和容量（`byte_len_of`），直接在这块地址上用 `Float64Array`/`Uint8Array`/`BigInt64Array` 读写；用完喊一声还库（`dealloc_bytes`）。

在这个仓库之上，多了一台转码机：把仓库里的一段 JSON 字节直接转成 MessagePack 字节（`json_to_msgpack`），或者反过来（`msgpack_to_json`）——全程只搬字节，从不把 JS 对象图搬进 wasm 再搬出来。这个约束不是随意选的：实测发现，把对象图整体搬过 wasm 边界（每个字段一次跨界）比字节搬运贵得多；而字节搬运本身的成本，和 JS 侧做 UTF-16→UTF-8 转换的成本相当，边界本身很便宜。所以这里不是要跟 `JSON.parse` 比快——没有什么能比 `JSON.parse` 更快解析 JSON——它存在的理由是 V8 原生没有的能力：产出比 JSON 更紧凑的存档格式，同时不触碰主线程的对象图。

真正在用它的是 `@migaia/store-wasm`：Store 的 WASM 后备字段用这里的 arena 分配对齐内存，供数值型字段做零拷贝的类型化数组读写。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 需要一块和 JS 类型化数组天然兼容的 wasm 内存 | 所有分配都保证 8 字节对齐，`Float64Array`/`BigInt64Array` 视图可以直接建在返回的指针上，不会因未对齐抛 `RangeError` |
| 需要在不经过 JS 对象图的前提下转换 JSON/MessagePack | 字节进、字节出，转码全程发生在 wasm 内部，产出比 JSON 更紧凑的归档字节 |
| 需要长期持有、跨多次读写的内存块 | 分配的缓冲区在其生命周期内地址不变（只有 `memory.buffer` 这个 `ArrayBuffer` 身份会在扩容时变化），适合做数值型字段的稳定后备存储 |
| 正在实现 `@migaia/store-wasm` 的可选字段类型 | 这个包就是它的底层依赖，直接用同一套 arena 原语 |

不适合的场景：如果只是想在 JS 里解析/序列化一次性小对象，原生 `JSON.parse`/`JSON.stringify` 更快也更简单——引入 wasm 边界和显式内存管理换不来任何收益。这也不是一个通用的 wasm-bindgen 胶水层，公开表面就是 8 个函数，不提供对象、类、异步任务这些高层封装。

## 3. 用了之后能得到什么

- **对齐保证**：每次分配都以 `Vec<u64>` 打底，返回的指针保证 `ptr % 8 == 0`，不用自己算 padding 就能建 `Float64Array`/`BigInt64Array` 视图。
- **稳定 id，不会悬空重叠**：分配器探测式选 id，跳过存活中的 id 和保留的 `0`，即使 id 空间绕回也不会让两个存活分配共享同一个 id（修复了朴素自增计数器绕回后覆写的问题）。
- **死 id 安全，不 trap**：对一个已释放或从未存在的 id 调用 `ptr_of`/`byte_len_of`/`dealloc_bytes`，得到的是 `0`/`0`/`false`，不会让整个 wasm 实例因为一次误用而崩溃退出。
- **可逆的无 schema 转码**：`json_to_msgpack`/`msgpack_to_json` 用 `with_struct_map` 保留字段名，不要求两端预先约定结构，往返转换内容无损。
- **错误可查而不是静默失败**：转码失败返回 `0`，具体原因通过 `last_error()` 拿到；成功会清空上一次的错误，不会让调用方误判成"上一次的错误还没处理"。
- **release 构建以速度为第一优先级**：`opt-level = 3`、`lto = true`、`codegen-units = 1`。曾经为了压缩体积改用 `opt-level = "z"`，实测转码慢了一倍多——这个模块存在的理由就是转码速度，为体积牺牲速度等于取消它自己，所以坚持体积换速度。

## 4. 五分钟上手

```ts
import init, { alloc_bytes, ptr_of, byte_len_of, dealloc_bytes } from '@migaia/wasm';

const { memory } = await init(); // 加载并实例化 wasm 模块，拿到线性内存

// 申请一段能放 5 个 f64 的空间（40 字节）
const id = alloc_bytes(5 * 8);
if (id === 0) throw new Error('allocation failed: id 空间已耗尽');

// 通过指针建一个类型化数组视图，直接写
const view = new Float64Array(memory.buffer, ptr_of(id), byte_len_of(id) / 8);
view.set([1.5, -2, 3.25, 4e10, Number.MIN_VALUE]);

// 读回来还是同一块内存
console.log(Array.from(view));

// 用完必须显式释放，wasm 侧不会帮你自动回收
dealloc_bytes(id);
```

JSON 转 MessagePack 只是多一步：把 JSON 的字节写进一块分配，喂给 `json_to_msgpack`，从返回的新 id 里把转好的字节读出来。完整示例、错误处理、`memory.buffer` 扩容陷阱见 [USEGUIDE.md](./USEGUIDE.md#4-json--messagepack-转码)。

## 5. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **Arena** | Rust 侧维护的 `id -> 缓冲区` 映射，是所有分配的唯一权威来源；JS 侧只持有 id，不持有缓冲区本身 |
| **id（句柄）** | `alloc_bytes` 返回的 `u32`，`0` 是保留的空句柄（`NULL_ID`），永远不会被分配出去 |
| **8 字节对齐** | 每次分配底层用 `Vec<u64>` 打底，保证返回的指针能被 `Float64Array`/`BigInt64Array` 合法引用 |
| **`memory.buffer` 身份** | 任何新的 `alloc_bytes` 都可能扩张 wasm 内存，导致之前建立的 `ArrayBuffer`/类型化数组视图被**分离**（detach），之后访问会抛错；指针本身在释放前保持稳定，变的只是 `ArrayBuffer` 身份 |
| **影子返回值** | `last_error()`/`last_len()` 不是参数也不是返回值，而是"上一次转码调用"的结果快照，必须在拿到 `0`/非 `0` 之后立刻读取 |

## 6. 能力一览表

| 函数 | 参数类型 | 同步/异步 | 一句话 |
| --- | --- | --- | --- |
| `alloc_bytes(byte_len)` | `byte_len: number` | 同步 | 申请一块至少 `byte_len` 字节、8 字节对齐、清零的缓冲区，返回 id |
| `ptr_of(id)` | `id: number` | 同步 | 把 id 换成 wasm 线性内存里的字节指针，死 id 返回 `0` |
| `byte_len_of(id)` | `id: number` | 同步 | 该 id 实际持有的容量（按 8 字节取整），死 id 返回 `0` |
| `dealloc_bytes(id)` | `id: number` | 同步 | 释放该 id 对应的分配，返回是否真的释放了 |
| `json_to_msgpack(id, len)` | `id: number`, `len: number` | 同步 | 把 `id` 指向的前 `len` 字节当 JSON 解析，转成 MessagePack 字节写入新分配，返回新 id 或 `0` |
| `msgpack_to_json(id, len)` | `id: number`, `len: number` | 同步 | 反方向：MessagePack 转 JSON |
| `last_error()` | 无 | 同步 | 上一次转码失败的原因；成功时为空字符串 |
| `last_len()` | 无 | 同步 | 上一次转码成功产出的**精确**字节数（`byte_len_of` 只给按 8 取整后的容量） |

## 7. 安装

```bash
pnpm add @migaia/wasm
```

包内已经内置了 `wasm-pack` 编译好的产物（`src/wasm_provider_bg.wasm` + `.js` + `.d.ts`），不需要消费方本地装 Rust 工具链；只有修改这个包自身的 Rust 源码时才需要，见 USEGUIDE 的[构建与测试](./USEGUIDE.md#7-构建与测试)。

## 8. 注意事项（最容易踩的坑）

1. **不会自动回收**。这里没有 GC——分配了就必须调 `dealloc_bytes`，否则一直占着 wasm 内存直到模块销毁。需要"忘了释放也兜底"的场景，参考 `@migaia/store-wasm` 用 `FinalizationRegistry` 做的二线保险（详见 USEGUIDE）。
2. **任何新分配都可能让旧视图失效**。`alloc_bytes` 可能触发 wasm 内存扩容，之前基于 `memory.buffer` 建的类型化数组会被分离；每次分配后都要重新从 `memory.buffer`（或 `ptr_of`）建视图，不要缓存 `ArrayBuffer` 本身跨调用使用。
3. **`byte_len_of` 给的是容量，不是内容长度**。分配按 8 字节取整，转码后要知道确切产出字节数必须用 `last_len()`，不能拿 `byte_len_of(新 id)` 当结果长度。
4. **转码失败不会释放输入分配**。`json_to_msgpack`/`msgpack_to_json` 只负责产出新分配，不管输入 id 的生死；输入和输出是两个独立分配，都要自己 `dealloc_bytes`。
5. **`last_error()`/`last_len()` 是全局快照，不是调用返回值**。必须在每次转码调用后立刻读取，中间不能穿插另一次转码调用，否则读到的是后一次的结果。

## 9. 深入参考

完整 API 参考（含每个参数的副作用）、arena 分配算法细节、JSON ⇄ MessagePack 转码的设计取舍、错误协议全表、`init`/`initSync` 两种加载方式的区别、`@migaia/store-wasm` 里的真实接入代码、以及构建与测试方式，见 **[USEGUIDE.md](./USEGUIDE.md)**。
