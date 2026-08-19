# `@migaia/wasm`

用 Rust 编译成 WASM 的字节暂存区 + JSON ⇄ MessagePack 转码器。不是通用 WASM SDK，只做两件事：给 JS 一块 8 字节对齐、可稳定寻址的线性内存缓冲区，以及一台在这块内存里把 JSON 和 MessagePack 相互转码的机器。公开表面只有 10 个导出（`init`/`initSync` 两种加载方式 + 8 个业务函数），不提供对象、类、异步任务等高层封装。

## 适用与不适用场景

**适用**：需要一块和 JS 类型化数组天然兼容的 wasm 内存（所有分配保证 8 字节对齐，`Float64Array`/`BigInt64Array` 视图可以直接建在返回的指针上）；需要在不经过 JS 对象图的前提下转换 JSON/MessagePack（字节进、字节出，产出比 JSON 更紧凑的归档字节）；需要长期持有、跨多次读写、地址稳定的内存块；正在实现 `@migaia/store-wasm` 的可选字段类型（这个包就是它的底层依赖）。

**不适用**：只是想在 JS 里解析/序列化一次性小对象——原生 `JSON.parse`/`JSON.stringify` 更快也更简单，引入 wasm 边界和显式内存管理换不来任何收益；也不要把它当作通用的 wasm-bindgen 胶水层或提供 GC/生命周期托管的运行时——这里没有自动回收，分配了就必须显式 `dealloc_bytes`。

## 安装

```bash
pnpm add @migaia/wasm
```

包内已经内置了 `wasm-pack` 编译好的产物（`src/wasm_provider_bg.wasm` + `.js` + `.d.ts`），不需要消费方本地装 Rust 工具链；只有修改这个包自身的 Rust 源码时才需要重新构建，见 [USEGUIDE.md 的构建与测试](./USEGUIDE.md#7-构建与测试)。

## 目录

- [`@migaia/wasm` 模块：Arena 分配 + JSON ⇄ MessagePack 转码](#wasm-模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为、错误协议全表、内存扩容陷阱、真实接入代码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="wasm-模块"></a>

## `@migaia/wasm` 模块

```ts
import init, {
  initSync,
  alloc_bytes,
  ptr_of,
  byte_len_of,
  dealloc_bytes,
  json_to_msgpack,
  msgpack_to_json,
  last_error,
  last_len
} from '@migaia/wasm';
```

**`init`（默认导出）｜10 秒上手** —— 异步加载并实例化 wasm 模块，拿到线性内存与全部导出函数：

```ts
const { memory, alloc_bytes: allocBytes } = await init();
```

全部选项：单参数 `module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module`（可选）—— 省略时以 `new URL('wasm_provider_bg.wasm', import.meta.url)` 自动 `fetch` 同目录下的 `.wasm` 二进制；宿主不支持这种自动定位时（例如某些 Node 运行环境），可显式传入字节/模块跳过自动 fetch。返回 `Promise<InitOutput>`（含 `memory: WebAssembly.Memory` 及全部业务函数）。模块内部只会真正实例化一次，重复调用直接返回既有实例。

**`initSync`｜5 秒上手** —— 同步版初始化，用于 wasm 字节已被打包器内联、或需要在同步代码路径里完成初始化的场景：

```ts
const wasm = initSync(wasmBytes);
```

全部选项：单参数 `module: BufferSource | WebAssembly.Module | { module: SyncInitInput }`（必填）—— 不发起任何 fetch。返回值结构与 `init()` resolve 出的对象一致。

**`alloc_bytes`｜3 秒上手** —— 申请一块 8 字节对齐、清零的缓冲区：

```ts
const id = alloc_bytes(40); // 至少 40 字节（可放 5 个 f64）
if (id === 0) throw new Error('allocation failed: id 空间已耗尽');
```

全部选项：单参数 `byte_len: number`（必填）——需要的最小字节数，内部按 8 向上取整。无其他选项。返回新分配的 id，或 `0`（`NULL_ID`，仅当 id 空间耗尽，实践中会先 OOM）。

**`ptr_of`｜3 秒上手** —— 把 id 换成 wasm 线性内存里的字节指针：

```ts
const view = new Float64Array(memory.buffer, ptr_of(id), byte_len_of(id) / 8);
```

全部选项：单参数 `id: number`（必填），无其他选项。死 id（已释放/从未存在）返回 `0`，不会 trap。指针在该 id 存活期间地址不变；但 `memory.buffer` 本身可能因后续 `alloc_bytes` 扩容而变身份，视图需重新建（见 [USEGUIDE §6](./USEGUIDE.md#6-内存扩容与视图失效)）。

**`byte_len_of`｜3 秒上手** —— 该 id 实际持有的容量（按 8 字节取整）：

```ts
byte_len_of(id); // 40（如果分配时请求的是 33~40 字节）
```

全部选项：单参数 `id: number`（必填），无其他选项。死 id 返回 `0`。注意这是**容量**不是内容长度，转码结果的精确长度要用 `last_len()`。

**`dealloc_bytes`｜3 秒上手** —— 释放分配，用完必须显式调用（没有 GC）：

```ts
dealloc_bytes(id); // true：确实存在且被释放；false：id 本就不存在
```

全部选项：单参数 `id: number`（必填），无其他选项。对死 id 调用是安全的 no-op。

**`json_to_msgpack`｜10 秒上手** —— 把某个分配里的 JSON 字节转成 MessagePack 字节：

```ts
const outId = json_to_msgpack(inputId, jsonByteLength);
if (outId === 0) throw new Error(`convert failed: ${last_error()}`);
const packed = new Uint8Array(memory.buffer, ptr_of(outId), last_len()).slice();
```

全部选项：`id: number`（必填，输入分配的 id）、`len: number`（必填，要读取的字节数，不能超过该 id 实际容量）。不接受额外配置项。成功返回新分配的 id（存放输出，需要单独 `dealloc_bytes`）；失败返回 `0`，原因见 `last_error()`。不释放、不修改输入 id。

**`msgpack_to_json`｜10 秒上手** —— 方向相反，MessagePack 转 JSON：

```ts
const outId = msgpack_to_json(inputId, msgpackByteLength);
```

全部选项：同 `json_to_msgpack`，`id: number`（必填）、`len: number`（必填），无其他配置项。语义完全对称。

**`last_error`｜3 秒上手** —— 上一次转码调用为什么返回 `0`：

```ts
last_error(); // 成功时为空字符串 ''
```

无参数，无选项。是"上一次转码调用"的全局快照而不是返回值，必须在拿到转码结果之后立刻读取，中间不能穿插另一次转码调用。

**`last_len`｜3 秒上手** —— 上一次转码成功产出的**精确**字节数：

```ts
last_len(); // 例如 27，即使 byte_len_of(newId) 因取整报告 32
```

无参数，无选项。只在紧接着一次返回非 `0` id 的转码调用之后才有意义。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 完整生命周期：分配 → 写入 → 读取 → 释放

```ts
import init, { alloc_bytes, ptr_of, byte_len_of, dealloc_bytes } from '@migaia/wasm';

const { memory } = await init();

const id = alloc_bytes(5 * 8); // 5 个 f64
if (id === 0) throw new Error('allocation failed: id 空间已耗尽');

const view = new Float64Array(memory.buffer, ptr_of(id), byte_len_of(id) / 8);
view.set([1.5, -2, 3.25, 4e10, Number.MIN_VALUE]);

console.log(Array.from(view)); // 原地读回

dealloc_bytes(id); // 没有 GC，用完必须显式释放
```

### 2. JSON → MessagePack：写入分配、转码、读出结果、清理两份分配

```ts
import init, {
  alloc_bytes,
  ptr_of,
  dealloc_bytes,
  json_to_msgpack,
  last_error,
  last_len
} from '@migaia/wasm';

const { memory } = await init();

function putBytes(bytes: Uint8Array): number {
  const id = alloc_bytes(bytes.length);
  if (id === 0) throw new Error('allocation failed: arena 已耗尽');
  // 每次都从 memory.buffer 现取，不缓存 ArrayBuffer 引用（见 USEGUIDE §6）
  new Uint8Array(memory.buffer, ptr_of(id), bytes.length).set(bytes);
  return id;
}

const json = new TextEncoder().encode(JSON.stringify({ role: 'user', tokens: 12 }));
const inputId = putBytes(json);

const outputId = json_to_msgpack(inputId, json.length);
if (outputId === 0) {
  dealloc_bytes(inputId);
  throw new Error(`convert failed: ${last_error()}`);
}

const packed = new Uint8Array(memory.buffer, ptr_of(outputId), last_len()).slice();

dealloc_bytes(inputId);
dealloc_bytes(outputId); // 转码不会替你释放任何一方
```

### 3. 往返校验：JSON → MessagePack → JSON，确认无损

```ts
import init, {
  alloc_bytes,
  ptr_of,
  dealloc_bytes,
  json_to_msgpack,
  msgpack_to_json,
  last_len
} from '@migaia/wasm';

const { memory } = await init();

function putBytes(bytes: Uint8Array): number {
  const id = alloc_bytes(bytes.length);
  new Uint8Array(memory.buffer, ptr_of(id), bytes.length).set(bytes);
  return id;
}
function takeBytes(id: number, len: number): Uint8Array {
  return new Uint8Array(memory.buffer, ptr_of(id), len).slice();
}

const original = { role: 'user', tags: ['a', 'b'], score: 0.5 };
const jsonBytes = new TextEncoder().encode(JSON.stringify(original));

const jsonId = putBytes(jsonBytes);
const packedId = json_to_msgpack(jsonId, jsonBytes.length);
const packed = takeBytes(packedId, last_len());

const roundTripId = msgpack_to_json(packedId, packed.length);
const roundTrip = JSON.parse(new TextDecoder().decode(takeBytes(roundTripId, last_len())));

console.log(roundTrip); // 与 original 字段对齐（map 的 key 始终保留为字符串）

[jsonId, packedId, roundTripId].forEach(dealloc_bytes);
```

### 4. 结合 `FinalizationRegistry` 做兜底释放（`@migaia/store-wasm` 的真实用法）

```ts
import initWasm, { alloc_bytes, dealloc_bytes, ptr_of } from '@migaia/wasm';

let wasmReady: Promise<WebAssembly.Memory> | undefined;
let wasmMemory: WebAssembly.Memory | undefined;

function ensureWasm(): Promise<WebAssembly.Memory> {
  if (wasmMemory) return Promise.resolve(wasmMemory);
  if (wasmReady) return wasmReady;
  const pending = initWasm().then((o) => (wasmMemory = o.memory));
  wasmReady = pending;
  pending.catch(() => {
    if (wasmReady === pending) wasmReady = undefined; // 失败后允许下次重试
  });
  return pending;
}

const finalizer =
  typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<number>((id) => dealloc_bytes(id))
    : undefined;

class NumericField {
  constructor(private id: number) {
    finalizer?.register(this, id, this); // unregisterToken = 自身
  }
  dispose() {
    finalizer?.unregister(this);
    dealloc_bytes(this.id);
  }
}
```

`FinalizationRegistry` 的回调时机不保证、不即时——它只是"调用方忘了显式释放"时的最后一道防线，不能替代主路径的显式 `dispose()`。

### 5. `initSync` 同步初始化 + 批量分配的耗尽处理

```ts
import { initSync } from '@migaia/wasm';

const wasmBytes = await fetchWasmBytesFromYourBundler(); // 由构建/部署流程提供
const { memory, alloc_bytes, ptr_of, dealloc_bytes } = initSync(wasmBytes);

const ids: number[] = [];
for (const record of largeBatch) {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const id = alloc_bytes(bytes.length);
  if (id === 0) {
    // arena 耗尽：先释放已分配的，避免继续尝试而卡死在同一个错误上
    ids.forEach(dealloc_bytes);
    throw new Error('allocation failed: arena 已耗尽');
  }
  // 每条记录都从当前 memory.buffer 现取视图，避免上一次 alloc_bytes 导致的扩容分离旧视图
  new Uint8Array(memory.buffer, ptr_of(id), bytes.length).set(bytes);
  ids.push(id);
}
ids.forEach(dealloc_bytes);
```

---

<a id="构建门禁"></a>

## 构建门禁

消费方安装本包不需要执行以下命令——包内已发布编译好的产物。只有修改 `rust/src/lib.rs` 里的实现时才需要：

```bash
pnpm run build && pnpm run test && pnpm run typecheck
```

- `build`：`cd rust && wasm-pack build --target web --release --out-dir ../src`，需要本地安装 `wasm-pack` 和支持 Cargo edition 2024 的 Rust 工具链。
- `test`：等价于 `test:rust`，即 `cd rust && cargo test`，非 wasm32 目标下直接跑原生测试。
- `typecheck`：`tsc --noEmit -p tsconfig.json`，只检查 `src/**/*.d.ts` 能否被正确解析，不检查 `wasm_provider.js` 这份 `wasm-pack` 生成的胶水代码。
