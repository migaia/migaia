# `@migaia/wasm`

Rust 编译的 WASM 字节暂存区和 JSON ⇄ MessagePack 转码器。它提供 8 字节对齐、地址稳定的 arena 分配，以及只在字节边界工作的同步转码 API；不跨 WASM 边界传递 JavaScript 对象图。

## 安装

```bash
pnpm add @migaia/wasm
```

包内包含 wasm-pack 生成的 ES module 和 `.wasm` 资源。修改 Rust 实现后，用 `pnpm run build` 重新生成 `src/`；不要手工编辑生成文件。

## API

```ts
import init, {
  alloc_bytes,
  ptr_of,
  byte_len_of,
  dealloc_bytes,
  json_to_msgpack,
  msgpack_to_json
} from '@migaia/wasm'
```

`alloc_bytes(byteLen)` 返回新分配 id（或 `0`）；`ptr_of(id)` 返回字节指针；`byte_len_of(id)` 返回按 8 字节取整的容量；`dealloc_bytes(id)` 显式释放并返回是否确实存在。死 id 的读操作返回 `0`，释放操作返回 `false`。

转码函数都返回同一次操作绑定的 `ConversionResult`：

```ts
type ConversionResult = {
  readonly id: number // 成功时的新输出分配，失败时为 0
  readonly len: number // 精确输出长度，失败时为 0
  readonly error: string // 成功为空串，失败为原因
}
```

```ts
const wasm = await init()
const input = alloc_bytes(json.length)
new Uint8Array(wasm.memory.buffer, ptr_of(input), json.length).set(json)

const result = json_to_msgpack(input, json.length)
if (result.id === 0) throw new Error(result.error)
const packed = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()

dealloc_bytes(input)
dealloc_bytes(result.id)
```

`msgpack_to_json` 具有对称签名。输入必须是单个完整文档；尾随非空白字节会失败。成功和失败都只通过当前返回值报告，不存在全局“上一次结果”或兼容别名，因此两个调用的结果可以安全地交错保存。输入分配不会由转码自动释放。

`json_to_msgpack` 保持 map key 为字符串并直接从 reader 转到 writer，不先构造 `serde_json::Value`；`msgpack_to_json` 同样保持单文档边界。

## 内存与生命周期

arena 使用 `Vec<u64>`，保证指针适合 `Float64Array`/`BigInt64Array`。WASM memory 增长会使旧 `ArrayBuffer` 视图失效；每次分配或读取前都从当前 `memory.buffer` 创建视图。所有分配都必须显式释放；`@migaia/store-wasm` 另外提供 FinalizationRegistry 兜底，但不替代确定性 dispose。

## 高阶组合示例

### 交错转码并在一个所有权边界内释放全部分配

每次转码返回独立的 `ConversionResult`，因此可以先保留多个结果，再按业务顺序读取。输入 id 和成功结果 id 都归调用者所有；用 `try/finally` 把释放收拢到同一个边界，避免异常路径泄漏 arena 分配：

```ts
import init, { alloc_bytes, dealloc_bytes, json_to_msgpack, ptr_of } from '@migaia/wasm'

const wasm = await init()

function writeJson(value: unknown): { id: number; length: number } {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const id = alloc_bytes(bytes.length)
  if (id === 0) throw new Error('WASM arena allocation failed')
  new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
  return { id, length: bytes.length }
}

const firstInput = writeJson({ id: 1, status: 'ready' })
const secondInput = writeJson({ id: 2, status: 'queued' })
const outputIds: number[] = []

try {
  const first = json_to_msgpack(firstInput.id, firstInput.length)
  const second = json_to_msgpack(secondInput.id, secondInput.length)
  for (const result of [first, second]) {
    if (result.id === 0) throw new Error(result.error)
    outputIds.push(result.id)
    const ownedCopy = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()
    console.log(ownedCopy.byteLength)
  }
} finally {
  dealloc_bytes(firstInput.id)
  dealloc_bytes(secondInput.id)
  for (const id of outputIds) dealloc_bytes(id)
}
```

每次读取前都重新访问 `wasm.memory.buffer`，因为后续分配可能触发 memory growth 并使旧视图失效。`.slice()` 得到 JavaScript 自有副本后即可释放 WASM 输出；如果要保留零拷贝视图，就必须把对应 id 的释放延后到最后一次读取之后。

## 构建与测试

```bash
pnpm run build       # wasm-pack build --target web --release --out-dir ../src
pnpm run test        # cargo test（Rust 单元/host 测试）
pnpm run typecheck   # 生成声明和包配置检查
```

生成的 `src/` 由 wasm-pack 完整覆盖。发布或验证前应执行一次确定性重复构建，并通过真实 WASM host 和 packed consumer 导入/实例化测试。
