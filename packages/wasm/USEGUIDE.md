# 使用手册

本文是 `@migaia/wasm` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个函数的精确语义、每一种失败情形、以及 Rust 源码里的实现取舍"。

## 目录

1. [导入与初始化](#1-导入与初始化)
2. [Arena 分配模型详解](#2-arena-分配模型详解)
3. [API 完整参考](#3-api-完整参考)
4. [JSON ⇄ MessagePack 转码](#4-json--messagepack-转码)
5. [错误处理协议](#5-错误处理协议)
6. [内存扩容与视图失效](#6-内存扩容与视图失效)
7. [构建与测试](#7-构建与测试)
8. [在 @migaia/store-wasm 中的真实接入](#8-在-migaiastore-wasm-中的真实接入)
9. [常见问题排查](#9-常见问题排查)

---

## 1. 导入与初始化

```ts
import init, { initSync, alloc_bytes, ptr_of, byte_len_of, dealloc_bytes,
  json_to_msgpack, msgpack_to_json, last_error, last_len } from '@migaia/wasm';
```

包的公开入口是 `src/wasm_provider.js`（类型来自同目录的 `src/wasm_provider.d.ts`），由 Rust 侧的 `wasm-pack build --target web` 编译产出，本身是标准 ES module，直接从 `@migaia/wasm` 导入即可，不需要额外的 wasm 加载插件。

### `init(module_or_path?)`（默认导出）

异步加载并实例化 wasm 模块，返回一个包含全部导出函数和 `memory: WebAssembly.Memory` 的对象：

```ts
const wasm = await init();
wasm.memory;      // WebAssembly.Memory，线性内存
wasm.alloc_bytes(8); // 也可以直接从这个对象上调用，效果和具名导入一致
```

不传参数时，`init()` 会以 `new URL('wasm_provider_bg.wasm', import.meta.url)` 定位并 `fetch` 同目录下的 `.wasm` 二进制——这依赖宿主的 `fetch` 支持相对 `import.meta.url` 解析文件，浏览器、Vite/webpack 等打包器、支持 `fetch(file://...)` 的运行时都可以。宿主不支持这种自动定位时（比如某些 Node 运行环境），可以显式传入 `RequestInfo | URL | Response | BufferSource | WebAssembly.Module` 之一，跳过自动 fetch：

```ts
import { readFile } from 'node:fs/promises';
import wasmProviderUrl from '@migaia/wasm/src/wasm_provider_bg.wasm'; // 或自行拼路径
const bytes = await readFile(new URL(wasmProviderUrl, import.meta.url));
const { memory, alloc_bytes } = await init(bytes);
```

模块内部只会真正实例化一次：`init()`/`initSync()` 判断到已经初始化过（内部的 `wasm` 变量非 `undefined`）就直接返回既有实例，重复调用是安全的，但不会重新加载。

### `initSync(module)`

同步版本，接受已经拿到手的 `WebAssembly.Module` 或 `BufferSource`（不发起任何 fetch），适合 wasm 字节已经被打包器内联、或者需要在同步代码路径里完成初始化的场景。返回值和 `init()` resolve 出的对象结构一致。

---

## 2. Arena 分配模型详解

Rust 侧维护一个线程局部的：

```rust
struct Arena {
    map: HashMap<u32, Vec<u64>>,
    cursor: u32,
}
```

`0`（`NULL_ID`）是保留的空句柄，永远不会被分配出去，JS 侧可以安全地把它当"无分配"的哨兵值使用。

**分配用 `Vec<u64>` 而不是 `Vec<u8>` 打底**：`Vec<T>` 按 `align_of::<T>()` 对齐分配，`Vec<u64>` 保证返回的基址是 8 字节对齐——这是满足 JS 侧 `new Float64Array(memory.buffer, ptr, len)` / `BigInt64Array` 要求的必要条件，这两个构造函数在 `ptr % 8 !== 0` 时会抛 `RangeError`。`Vec<u8>` 只保证 1 字节对齐，无法满足这个要求。

**id 分配算法不是朴素自增**：一个原始的 `fetch_add` 计数器绕回 `u32::MAX` 后会覆盖仍然存活的旧 id，让两个存活分配共享同一块内存（别名 bug）。这里的做法是从 `cursor` 开始向前探测，跳过 `0` 和当前存活的 id，找到第一个空闲 id 才分配；只有在 id 空间被 2^32-1 个存活分配耗尽时才返回 `0`（实践中会先 OOM）。

`alloc_bytes(byte_len)` 会把请求的字节数按 8 向上取整成整字（`(byte_len as usize).div_ceil(8)` 个 `u64`），分配到的缓冲区整体清零。分配到的地址在这个 id 存活期间**不会移动**——`ptr_of(id)` 每次调用拿到的都是同一个地址，直到 `dealloc_bytes(id)` 释放它为止。

对死 id（已释放或从未存在）调用 `ptr_of`/`byte_len_of`/`dealloc_bytes`，分别得到 `0`/`0`/`false`，而不是让 wasm trap——一个失效的句柄在 JS 侧是可恢复的错误状态，不会拖垮整个 wasm 实例。

---

## 3. API 完整参考

| 函数 | 参数 | 返回值 | 同步/异步 | 副作用 |
| --- | --- | --- | --- | --- |
| `alloc_bytes(byte_len: number)` | `byte_len`：需要的最小字节数 | `number`——新分配的 id，或 `0`（id 空间耗尽） | 同步 | 在 arena 里新增一条 8 字节对齐、清零的分配 |
| `ptr_of(id: number)` | `id`：分配 id | `number`——wasm 线性内存里的字节偏移，死 id 为 `0` | 同步 | 无（只读） |
| `byte_len_of(id: number)` | `id`：分配 id | `number`——按 8 取整后的容量字节数，死 id 为 `0` | 同步 | 无（只读） |
| `dealloc_bytes(id: number)` | `id`：分配 id | `boolean`——该 id 之前是否存在（真正释放了返回 `true`） | 同步 | 从 arena 移除该分配；对死 id 调用是安全的 no-op |
| `json_to_msgpack(id: number, len: number)` | `id`：输入分配 id；`len`：要读取的字节数（≤ 该 id 的容量） | `number`——新分配的 id（转码结果），或 `0`（失败） | 同步 | 成功时新增一条分配存放输出，并更新 `last_len`/清空 `last_error`；失败时更新 `last_error`、`last_len` 归零。**不释放输入 id** |
| `msgpack_to_json(id: number, len: number)` | 同上，方向相反 | 同上 | 同步 | 同上 |
| `last_error()` | 无 | `string`——上一次转码失败的原因，成功后为空串 | 同步 | 无（只读快照） |
| `last_len()` | 无 | `number`——上一次转码成功产出的精确字节数 | 同步 | 无（只读快照） |
| `init(module_or_path?)`（默认导出） | 见[§1](#1-导入与初始化) | `Promise<InitOutput>`，含 `memory` 及全部函数 | 异步 | 首次调用时实例化 wasm 模块 |
| `initSync(module)` | 见[§1](#1-导入与初始化) | `InitOutput` | 同步 | 同上，同步版本 |

`InitOutput` 除了 `memory: WebAssembly.Memory` 和上述业务函数外，还带有 `__wbindgen_externrefs`、`__wbindgen_free`、`__wbindgen_start` 等 wasm-bindgen 内部胶水导出——这些不是本包的公开契约，不应在业务代码里直接调用。

---

## 4. JSON ⇄ MessagePack 转码

### 设计取舍：为什么是字节进、字节出

`json_to_msgpack`/`msgpack_to_json` 都不接受 JS 对象，只接受"某个 arena 分配里的一段字节"，产出也是"另一个 arena 分配里的一段字节"。这不是偷懒，是刻意的边界设计：让 JS 对象图整体跨越 wasm 边界，每一个字段都是一次单独的跨界调用，实测比纯字节搬运贵得多；而字节搬运本身的代价和 JS 侧本来就要做的 UTF-16→UTF-8 转换差不多，边界本身很便宜。所以这两个函数的职责边界很窄：接收字节、在 wasm 内部完成全部转换工作、交回字节，是否需要把结果解析回对象完全由调用方决定。

### 转码路径本身：为什么不经过 `serde_json::Value`

内部实现是从 `serde_json::Deserializer` 直接 `serde_transcode::transcode` 到 `rmp_serde::Serializer`，中间不产生 `serde_json::Value` 这棵中间树。原因是实测差异明显：一百万条四字段记录，如果先反序列化成 `Value` 树再序列化出去，大约要多出四百万次 `String` 分配，而这棵树在下一条语句就被整体丢弃——纯粹的浪费。

`json_to_msgpack` 用 `with_struct_map()` 序列化，map 的 key 始终保留为字符串（不会被压缩成按位置索引的紧凑结构编码）。这让转换是**无 schema、可逆**的——调用方不需要在两端提前约定字段顺序或结构定义，这对一个通用存储组件是必要的，因为它不能假设消费方永远知道 schema。

### 容量预留

- `json_to_msgpack`：输出通常比 JSON 更小，按输入长度预留容量，一般不需要再扩容。
- `msgpack_to_json`：JSON 通常比 MessagePack 更冗长，按输入长度的两倍预留，减少扩容次数。

这两个预留只影响内部缓冲区的初始容量，不影响最终产出——`last_len()` 始终反映精确的产出字节数。

### 完整示例

```ts
import init, {
  alloc_bytes, ptr_of, dealloc_bytes,
  json_to_msgpack, last_error, last_len
} from '@migaia/wasm';

const { memory } = await init();

function putBytes(bytes: Uint8Array): number {
  const id = alloc_bytes(bytes.length);
  if (id === 0) throw new Error('allocation failed: arena 已耗尽');
  // 每次都从 memory.buffer 现取，不缓存 ArrayBuffer 引用，见 §6
  new Uint8Array(memory.buffer, ptr_of(id), bytes.length).set(bytes);
  return id;
}

function takeBytes(id: number, len: number): Uint8Array {
  return new Uint8Array(memory.buffer, ptr_of(id), len).slice();
}

const json = new TextEncoder().encode(JSON.stringify({ role: 'user', tokens: 12 }));
const inputId = putBytes(json);

const outputId = json_to_msgpack(inputId, json.length);
if (outputId === 0) {
  dealloc_bytes(inputId);
  throw new Error(`convert failed: ${last_error()}`);
}

const packed = takeBytes(outputId, last_len()); // 精确长度，不是 byte_len_of 的取整容量

// 转码不会替你释放任何一方，输入输出都要自己收尾
dealloc_bytes(inputId);
dealloc_bytes(outputId);

console.log('packed bytes:', packed.length, '< json bytes:', json.length);
```

---

## 5. 错误处理协议

转码函数从不抛异常，失败一律返回 `0`，具体原因通过 `last_error()` 取。以下是源码里全部会产生的错误路径：

| 触发条件 | `last_error()` 内容 | 返回值 |
| --- | --- | --- |
| `id` 未知或已释放，或 `len` 超过该 id 实际容量 | `"unknown allocation id or length past capacity"` | `0` |
| 输出分配时 arena 已耗尽（`alloc_bytes` 内部再次返回 `0`） | `"arena exhausted"` | `0` |
| 输入不是合法 JSON，`json_to_msgpack` 转码失败 | `"json to msgpack failed: {底层 serde 错误}"` | `0` |
| 输入不是合法 MessagePack，`msgpack_to_json` 转码失败 | `"msgpack to json failed: {底层 serde 错误}"` | `0` |
| 转码成功 | 空字符串 `""` | 非 `0` 的新 id |

**空输入被当成畸形数据，不是"空文档"**——一段长度为 0 的字节流既不是合法 JSON 也不是合法 MessagePack，会走到上面对应的转码失败分支。

**成功会清空上一次的错误**：`last_error()`/`last_len()` 是全局的"上一次转码结果"快照，不是每次调用单独返回的值。一次成功的转码会把 `last_error()` 重置为空串——不会出现"这次成功了，但 `last_error()` 还残留着上一次失败的信息"的情况；但反过来，如果两次转码调用之间穿插了别的逻辑，必须在**每次转码调用后立刻读取**这两个函数，不能攒着以后再读，否则读到的是最近一次转码的结果而不是你以为的那次。

---

## 6. 内存扩容与视图失效

这是这个包最容易踩、后果也最隐蔽的坑。

`WebAssembly.Memory` 在需要更多空间时会**增长**（grow），而不是原地扩容——每次增长都会让之前所有基于旧 `memory.buffer` 建立的 `ArrayBuffer`/类型化数组视图**分离**（detached），之后任何读写都会抛错。`alloc_bytes` 内部可能触发这种增长（取决于当前剩余容量），所以：

- **任何一次新的 `alloc_bytes` 调用，都可能让此前建立的所有类型化数组视图失效**，即便这次分配和你正在用的那块内存毫无关系。
- 但**指针本身是稳定的**：只要没有 `dealloc_bytes` 掉这个 id，`ptr_of(id)` 每次返回的地址不变；变的只是 `memory.buffer` 这个 `ArrayBuffer` 对象的身份。

安全的用法是：不要跨越任何一次 `alloc_bytes` 调用缓存类型化数组视图或裸的 `ArrayBuffer` 引用；每次要读写之前，重新用当前的 `memory.buffer` 建一个新视图（`new Float64Array(memory.buffer, ptr_of(id), len)`）。上面 [§4](#4-json--messagepack-转码) 的示例里 `putBytes`/`takeBytes` 都是每次现取 `memory.buffer`，就是为了避免这个问题。

---

## 7. 构建与测试

这个包发布的是**已经编译好的产物**（`src/wasm_provider_bg.wasm` + `wasm_provider.js` + `wasm_provider.d.ts`），消费方不需要本地装 Rust。只有修改 `rust/src/lib.rs` 里的实现时才需要重新构建：

```bash
pnpm run build     # cd rust && wasm-pack build --target web --release --out-dir ../src
pnpm run test      # cd rust && cargo test（等价于 pnpm run test:rust）
pnpm run typecheck # tsc --noEmit -p tsconfig.json，只检查 src/**/*.d.ts 能否被正确解析
```

需要本地安装 `wasm-pack` 和支持 Cargo edition 2024 的 Rust 工具链（`rust/Cargo.toml` 里声明的 edition）。Rust 测试用 `wasm_bindgen_test` 宏编写（`rust/tests/roundtrip.rs`），非 wasm32 目标下这个宏退化为普通 `#[test]`，所以 `cargo test` 直接在原生目标上跑即可，不需要浏览器或 Node 环境；如果要在真实 wasm 宿主里跑，可以用 `wasm-pack test --node`（或 `--headless --firefox`/`--chrome`）。

`typecheck` 只检查生成的 `.d.ts` 类型声明文件本身是否合法（`tsconfig.json` 的 `include` 只覆盖 `src/**/*.d.ts`），不检查 `wasm_provider.js` 这份胶水代码——它是 `wasm-pack` 生成的纯 JS，不接受类型检查，`tsconfig.json` 也显式关闭了 `allowJs`/`checkJs`。

release 构建的性能取舍写在 `rust/Cargo.toml` 里：`opt-level = 3`、`lto = true`、`codegen-units = 1`、`panic = "abort"`。曾经尝试过 `opt-level = "z"` 压缩体积，实测转码速度慢了一倍多——这个模块存在的唯一理由就是转码要比 JS 原生方案快，为了体积牺牲速度等于取消它自己存在的意义，所以坚持这组以速度优先的编译参数。

---

## 8. 在 @migaia/store-wasm 中的真实接入

`@migaia/store-wasm` 是这个包目前唯一的消费方，用法在 `packages/store-wasm/src/arena.ts`：模块作用域缓存一个初始化 promise，保证重复调用（React StrictMode 双渲染、多个无关组件都要用到 wasm）不会触发重复的 `fetch`/实例化，也不会让每次渲染都重新挂起：

```ts
import initWasm, { alloc_bytes, dealloc_bytes, ptr_of } from '@migaia/wasm';

let wasmReady: Promise<WebAssembly.Memory> | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

export function ensureWasm(): Promise<WebAssembly.Memory> {
  if (wasmMemory) return Promise.resolve(wasmMemory);
  if (wasmReady) return wasmReady;
  const pending = initWasm().then((o) => (wasmMemory = o.memory));
  wasmReady = pending;
  pending.catch(() => {
    if (wasmReady === pending) wasmReady = undefined; // 失败后允许下次重试
  });
  return pending;
}
```

释放侧用 `FinalizationRegistry` 做二线兜底，显式 `dispose()` 才是主路径（确定性、可预期时机）：

```ts
const finalizer =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<number>((id) => dealloc_bytes(id))
    : undefined;

// 字段对象创建时:
finalizer?.register(fieldObject, allocationId, fieldObject); // unregisterToken = 自身，便于显式 dispose 时 unregister
// 显式 dispose 时:
finalizer?.unregister(fieldObject);
dealloc_bytes(allocationId);
```

`FinalizationRegistry` 的回调时机不保证、不即时，**不能**当作确定性的资源释放机制来依赖——它只是"调用方忘记显式 `dispose()` 时的最后一道防线"，不改变"用完必须显式释放"这条主规则。

---

## 9. 常见问题排查

**Q：`Float64Array`/`BigInt64Array` 视图抛 `RangeError: start offset ... is not a multiple of ...`。**
说明拿到的指针没有按预期对齐。正常情况下 `ptr_of` 返回的地址总是 8 字节对齐的（见[§2](#2-arena-分配模型详解)），如果出现这个错误，先检查是不是缓存了一个跨越了某次 `alloc_bytes` 调用之前的旧 `ArrayBuffer`/视图——分离后的视图会先抛 `TypeError`，而不是对齐错误；如果确实是对齐错误，说明传入的 `ptr` 根本不是这个包的 `ptr_of` 产出，检查调用链。

**Q：读写类型化数组时抛 `TypeError: Cannot perform ... on a detached ArrayBuffer`。**
典型的"跨 `alloc_bytes` 调用缓存了旧视图"问题，见[§6](#6-内存扩容与视图失效)。修复方式是在每次读写前重新用当前 `memory.buffer` 建视图，不要把视图或 `ArrayBuffer` 存到会跨多次分配存活的变量里。

**Q：转码函数一直返回 `0`，但 `last_error()` 是空字符串。**
检查读取 `last_error()`/`last_len()` 的时机——如果在失败的转码调用和读取之间又调用了一次别的转码（哪怕是失败的），全局快照会被最新一次调用覆盖。必须在每次 `json_to_msgpack`/`msgpack_to_json` 返回后立刻读取。

**Q：转码成功后，原来那个装 JSON 字节的分配还能用吗？**
能，`json_to_msgpack`/`msgpack_to_json` 只读输入、不修改也不释放它，输入 id 依然存活，需要你自己决定何时 `dealloc_bytes`；不要以为转码会顺手帮你清理输入。

**Q：可以不释放，等进程/页面退出自然回收吗？**
不建议依赖这个假设。wasm 线性内存的生命周期跟随模块实例，长时间运行的页面/进程里不释放的分配会一直占用内存直到整个实例销毁；`@migaia/store-wasm` 用 `FinalizationRegistry` 做了兜底，但那只是补救最后一道防线，显式 `dealloc_bytes` 仍然是唯一确定性的释放路径。
