# `@migaia/wasm`

Rust 编译的 WASM 字节暂存区和 JSON ⇄ MessagePack 转码器。它提供 8 字节对齐、地址稳定的 arena 分配，以及只在字节边界工作的同步转码 API；不跨 WASM 边界传递 JavaScript 对象图。

## 安装

```bash
pnpm add @migaia/wasm
```

包内包含 wasm-pack 生成的 ES module 和 `.wasm` 资源。修改 Rust 实现后，用 `pnpm run build` 重新生成 `src/`；build 随后通过 scripts/finalize-glue.ts 给既有 finalizer 加入一次发布规则，不手工编辑生成文件。

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
import type { ConversionResult } from '@migaia/wasm'
declare const result: ConversionResult
result.id // 成功时的新输出分配，失败时为 0
result.len // 精确输出长度，失败时为 0
result.error // 成功为空串，失败为原因
result.free() // 独立释放 wasm-bindgen 结果元数据，不释放输出 arena
```

```ts
const wasm = await init()
const json = new TextEncoder().encode(JSON.stringify({ count: 2 }))
const input = alloc_bytes(json.length)
let outputId = 0
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(input), json.length).set(json)
  const result = json_to_msgpack(input, json.length)
  try {
    outputId = result.id
    if (outputId === 0) throw new Error(result.error)
    const packed = new Uint8Array(wasm.memory.buffer, ptr_of(outputId), result.len).slice()
    console.log(packed.byteLength)
  } finally {
    result.free()
  }
} finally {
  dealloc_bytes(input)
  if (outputId !== 0) dealloc_bytes(outputId)
}
```

`msgpack_to_json` 具有对称签名。输入必须是单个完整文档；尾随非空白字节会失败。成功和失败都只通过当前返回值报告，不存在全局“上一次结果”或兼容别名，因此两个调用的结果可以安全地交错保存。输入分配不会由转码自动释放。每次成功和失败的结果元数据均须 free()；元数据与 arena 分配是两个独立的所有权。

`json_to_msgpack` 保持 map key 为字符串并直接从 reader 转到 writer，不先构造 `serde_json::Value`；`msgpack_to_json` 同样保持单文档边界。

## 内存与生命周期

arena 使用 `Vec<u64>`，保证指针适合 `Float64Array`/`BigInt64Array`。WASM memory 增长会使旧 `ArrayBuffer` 视图失效；每次分配或读取前都从当前 `memory.buffer` 创建视图。所有分配都必须显式释放；`@migaia/store-wasm` 另外提供 FinalizationRegistry 兜底，但不替代确定性 dispose。

## 高阶组合示例

### 交错转码并在一个所有权边界内释放全部分配

每次转码返回独立的 `ConversionResult`，因此可以先保留多个结果，再按业务顺序读取。输入 id 和成功结果 id 都归调用者所有；用 `try/finally` 把释放收拢到同一个边界，避免异常路径泄漏 arena 分配：

```ts
import init, {
  alloc_bytes,
  dealloc_bytes,
  json_to_msgpack,
  ptr_of,
  type ConversionResult
} from '@migaia/wasm'

const wasm = await init()

type IJsonAllocation = { id: number; length: number }

function writeJson(value: unknown): IJsonAllocation {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const id = alloc_bytes(bytes.length)
  if (id === 0) throw new Error('WASM arena allocation failed')
  new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
  return { id, length: bytes.length }
}

const inputs: IJsonAllocation[] = []
const results: ConversionResult[] = []
try {
  inputs.push(writeJson({ id: 1, status: 'ready' }))
  inputs.push(writeJson({ id: 2, status: 'queued' }))
  for (const input of inputs) results.push(json_to_msgpack(input.id, input.length))
  for (const result of results) {
    if (result.id === 0) throw new Error(result.error)
    const ownedCopy = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()
    console.log(ownedCopy.byteLength)
  }
} finally {
  for (const input of inputs) dealloc_bytes(input.id)
  for (const result of results) {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
}
```

每次读取前都重新访问 `wasm.memory.buffer`，因为后续分配可能触发 memory growth 并使旧视图失效。`.slice()` 得到 JavaScript 自有副本后即可释放 WASM 输出；如果要保留零拷贝视图，就必须把对应 id 的释放延后到最后一次读取之后。

## 构建与测试

```bash
pnpm run build       # wasm-pack build --target web --release --out-dir ../src
pnpm run test        # wasm-pack test --node rust，再运行 JS glue 回归
pnpm run test:rust   # cargo test（Rust 原生单元测试）
pnpm run typecheck   # 生成声明和包配置检查
```

生成的 glue/声明/WASM 先由 wasm-pack 覆盖，再由 TypeScript build 后处理固定首个 exports 的发布，避免晚完成的 init 替换已交付 memory。发布或验证前应执行一次确定性重复构建，并通过真实 WASM host 和 packed consumer 导入/实例化测试。

转码的往返保真限于 JSON 数据模型及可表示数值；任意 MessagePack 的 bin/ext、非 JSON map key 和超出 JSON 数值范围的整数不保证可逆，可能被改写或拒绝。JSON 对象直接走 map 序列化，不依赖 struct-map 配置。
