# `@migaia/wasm` 使用手册

本文记录当前单一 WASM ABI。Rust arena 和转码函数由 `@migaia/wasm` 负责；`@migaia/store-wasm` 只负责字段分配、数值视图和生命周期，不复制 arena 或转码状态机。

## 1. 初始化

```ts
import init, { initSync } from '@migaia/wasm'

const wasm = await init()
// 或：const wasm = initSync(moduleOrBytes);
```

默认入口通过包内 `wasm_provider_bg.wasm` 初始化。Node 等不支持相对 fetch 的宿主应传入 `BufferSource` 或 `WebAssembly.Module`。同步入口不发起 fetch。

## 2. Arena 契约

| API                    | 返回值    | 语义                                      |
| ---------------------- | --------- | ----------------------------------------- |
| `alloc_bytes(byteLen)` | `number`  | 8 字节对齐、清零的稳定分配 id，失败为 `0` |
| `ptr_of(id)`           | `number`  | 当前线性内存中的字节偏移，未知 id 为 `0`  |
| `byte_len_of(id)`      | `number`  | 实际容量（按 8 字节取整），未知 id 为 `0` |
| `dealloc_bytes(id)`    | `boolean` | 是否确实释放了一个 live id                |

`0` 是保留哨兵。分配使用稳定 id 并避免覆盖仍存活的块；指针只保证到释放前稳定。WASM memory 增长会替换 `memory.buffer`，所以 typed array 不能跨越后续分配调用复用。

## 3. 单操作转码 ABI

```ts
type ConversionResult = {
  readonly id: number;
  readonly len: number;
  readonly error: string;
};

json_to_msgpack(id: number, len: number): ConversionResult;
msgpack_to_json(id: number, len: number): ConversionResult;
```

每个调用都构造独立 `ConversionResult`，把输出 id、精确输出长度和错误绑定到同一操作；不存在共享的结果寄存器，因此交错调用不会互相覆盖结果。成功为 `{ id: nonzero, len: exactBytes, error: '' }`，失败为 `{ id: 0, len: 0, error: reason }`。输出和输入都由调用者释放。

转码只读取指定分配的前 `len` 个字节，并拒绝未知 id、超过容量的长度、空文档、格式错误和尾随第二个文档。JSON 允许文档后的空白；MessagePack 必须精确消费输入。map key 以字符串保存，避免 schema 依赖。

```ts
const json = new TextEncoder().encode(JSON.stringify({ role: 'user', tokens: 12 }))
const inputId = wasm.alloc_bytes(json.length)
new Uint8Array(wasm.memory.buffer, wasm.ptr_of(inputId), json.length).set(json)

const encoded = wasm.json_to_msgpack(inputId, json.length)
if (encoded.id === 0) {
  wasm.dealloc_bytes(inputId)
  throw new Error(encoded.error)
}
const packed = new Uint8Array(wasm.memory.buffer, wasm.ptr_of(encoded.id), encoded.len).slice()
wasm.dealloc_bytes(inputId)
wasm.dealloc_bytes(encoded.id)
```

## 4. 错误与边界

错误内容保持现有调用方可诊断的前缀：未知分配或超容量为 `unknown allocation id or length past capacity`，arena 无法分配输出为 `arena exhausted`，JSON/MessagePack 解析错误分别带 `json to msgpack failed:` 或 `msgpack to json failed:`。这些文本存在于返回值内，不通过第二个查询 API 读取。

空输入、非法输入、多个连续文档和超出实际容量的长度都会返回 `id: 0`。失败不会创建可供调用者释放的输出块；输入块仍由调用者拥有。

## 5. `store-wasm` 接入规则

字段 owner 通过 `ensureWasm()` 复用同一个初始化 Promise，并在显式 dispose 时释放自己的分配；构造失败时先完成所有已创建资源的回滚，再保留原始错误。record 字段只接受 number，并使用当前 `memory.buffer` 上的 `DataView`。这些生命周期语义不依赖转码结果 ABI，也不引入第二种 shared-buffer layout。

## 6. 构建与验证

```bash
pnpm run build
pnpm run test
pnpm run typecheck
```

`build` 必须从 `rust/` 运行 wasm-pack，并完整生成 `src/wasm_provider.js`、`.d.ts` 和 `.wasm`；生成目录禁止手工修改。验证还应执行真实非零 WASM host runner、两次确定性构建的字节比较，以及 packed 安装、导入和实例化。`@migaia/store-wasm` 另外执行其 `fmt → lint → typecheck → typecheck:test → test` 门禁和真实 WASM consumer 检查。
