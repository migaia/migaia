# `@migaia/wasm`

[English](./README.en.md)

`@migaia/wasm` 提供对齐的 WASM 字节暂存区，以及同步的 JSON 与 MessagePack 转码；你显式管理字节的所有权，不把 JavaScript 对象图逐字段传过 WASM 边界。MessagePack 是一种二进制数据格式。

## 你可能遇到过

- **创建数值视图时抛出 `RangeError`**：字节分配器给出的偏移没有满足 `Float64Array` 或 `BigInt64Array` 的对齐要求。
- **大分配后旧读数消失**：数值视图跨越内存增长被缓存，仍指向已经失效的旧缓冲。
- **第二次导出覆盖第一次结果**：输出元数据放在共享的“上一次结果”中，没有绑定到各自操作。
- **归档看起来成功，尾部数据却丢失**：只解析第一个文档，没有检查剩余的非空白输入。
- **清理后待上传数据变了**：队列保留了已释放 WASM 内存的视图，没有取得 JavaScript 自有副本。

## 为什么选它

- **数值视图不需要另写对齐器。** Rust 使用 `Vec<u64>`，分配地址按八字节对齐，容量向上取整；[数值读数示例](./USEGUIDE.md#不用猜内存对齐就能存数值读数)直接建立 `Float64Array`。
- **交错转码不会串用“上一次结果”。** 每次调用返回独立的输出 id、精确长度和错误；[交错转码示例](./USEGUIDE.md#保留两次转码结果而不互相覆盖)保留两个结果后再读取。
- **拼接损坏会明确失败。** 转码器检查单文档边界，不会把第二个文档悄悄丢掉；[尾随文档示例](./USEGUIDE.md#拒绝尾随第二个文档避免静默丢数据)得到零输出和当前操作的错误。
- **输入输出都按字节交付。** JSON 读取器直接写入 MessagePack 输出，不先构造 `serde_json::Value` 树；[交错转码示例](./USEGUIDE.md#保留两次转码结果而不互相覆盖)把 JSON 字节交给转码器，并保留每次操作自己的输出。这里描述机制，不承诺相对原生 JSON 操作的速度。

## 从这里开始

安装包后，将示例保存为 `.ts` 文件，用 Node 24 直接运行。示例显式读取包内 WASM 文件，不依赖对本地文件网址发起获取。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(9)
if (id === 0) throw new Error('分配失败')
console.log('容量:', byte_len_of(id))
console.log('释放:', dealloc_bytes(id), dealloc_bytes(id))
```

输出：

```text
容量: 16
释放: true false
```

遇到数值对齐看[数值读数](./USEGUIDE.md#不用猜内存对齐就能存数值读数)，需要转码和清理看[交错转码](./USEGUIDE.md#保留两次转码结果而不互相覆盖)。

## 手写时的隐患

下面仅展示，不运行。它用原生 WebAssembly 内存手写上一节的字节分配。

```ts doc-test=check
const memory = new WebAssembly.Memory({ initial: 1 })
let cursor = 0
const allocate = (byteLen: number) => {
  const offset = cursor
  cursor += byteLen // 隐患 1：没有对齐地址，也没有把容量向上取整。
  return offset // 隐患 2：没有独立 id 和存活记录，不能辨别重复释放。
}
allocate(1)
const offset = allocate(9)
const values = new Float64Array(memory.buffer, offset, 1)
memory.grow(1) // 隐患 3：缓存视图会失效，偏移值却看起来没有变化。
console.log(values[0])
```

上面的数值视图会因为偏移不对齐而抛出 `RangeError`；即使修好对齐，增长内存后也必须重建视图。上一节由 Rust 的 `Vec<u64>` 保证对齐，用稳定 id 记录存活分配；第一次释放为 true，再次释放为 false。

## 三分钟心智模型

| 你要回答的问题         | 工具                                                  |
| ---------------------- | ----------------------------------------------------- |
| 怎样拿到模块和内存？   | 异步 init 或同步 `initSync`                           |
| 怎样存数值或原始字节？ | `alloc_bytes` 分配，`ptr_of` 定位当前 `memory.buffer` |
| 怎样转换归档格式？     | `json_to_msgpack` 或 `msgpack_to_json`                |
| 用完由谁释放？         | 输入/输出 id 用 `dealloc_bytes`，结果元数据用 free    |

| 术语               | 白话含义                                        |
| ------------------ | ----------------------------------------------- |
| arena              | 模块保存字节的暂存区。                          |
| id                 | 一块分配的稳定编号，零表示没有分配。            |
| pointer            | 当前线性内存的字节偏移，不是分配编号。          |
| capacity           | 按八字节取整的容量，不等于文档长度。            |
| `ConversionResult` | 某次转码的 id、精确长度和错误；自身也需要释放。 |

## 典型场景

| 场景                                 | 怎么组合          | 详细说明                                                       |
| ------------------------------------ | ----------------- | -------------------------------------------------------------- |
| 两个功能同时启动时共享同一份内存     | `init`            | [完整示例](./USEGUIDE.md#两个功能同时启动时共享同一份内存)     |
| 不用猜内存对齐就能存数值读数         | `alloc_bytes`     | [完整示例](./USEGUIDE.md#不用猜内存对齐就能存数值读数)         |
| 内存增长后继续读取同一块分配         | `ptr_of`          | [完整示例](./USEGUIDE.md#内存增长后继续读取同一块分配)         |
| 释放 WASM 字节后保留 JavaScript 副本 | `dealloc_bytes`   | [完整示例](./USEGUIDE.md#释放-wasm-字节后保留-javascript-副本) |
| 保留两次转码结果而不互相覆盖         | `json_to_msgpack` | [完整示例](./USEGUIDE.md#保留两次转码结果而不互相覆盖)         |
| 拒绝尾随第二个文档，避免静默丢数据   | `json_to_msgpack` | [完整示例](./USEGUIDE.md#拒绝尾随第二个文档避免静默丢数据)     |
| 只解码收到的 MessagePack 字节        | `msgpack_to_json` | [完整示例](./USEGUIDE.md#只解码收到的-messagepack-字节)        |

## 安装

```bash
pnpm add @migaia/wasm
```

包内包含生成的 ES module 和 `.wasm` 资源。浏览器配置好资源加载后，可以用 `await init()` 加载包内资源；Node 等宿主应像上例一样传入字节或预编译的 `WebAssembly.Module`。

## 常用 API

| API                 | 作用                                     |
| ------------------- | ---------------------------------------- |
| `init()`            | 异步加载模块并取得共享内存。             |
| `initSync()`        | 用字节或预编译模块同步初始化。           |
| `alloc_bytes()`     | 取得对齐且清零的字节分配。               |
| `dealloc_bytes()`   | 释放输入或成功输出的 arena 分配。        |
| `json_to_msgpack()` | 把完整 JSON 文档转为 MessagePack。       |
| `msgpack_to_json()` | 把精确长度的 MessagePack 文档转回 JSON。 |

## 契约细节

arena（字节暂存区）是模块内部保存字节的地方。`alloc_bytes(byte_len)` 返回稳定的非零分配 id；内存或 id 空间耗尽时返回 `0`。`ptr_of(id)` 返回字节偏移，`byte_len_of(id)` 返回向上取整为八倍数的容量。未知或已释放 id 的两个查询都返回 `0`。`dealloc_bytes(id)` 返回是否确实移除了活动分配。每次成功分配都必须显式释放，包括零长度分配。

`json_to_msgpack(id, len)` 和 `msgpack_to_json(id, len)` 每次返回独立的 `ConversionResult`。成功时它持有新的输出 `id`、精确输出长度 `len` 和空串 `error`；失败时 `id`、`len` 为零，`error` 解释本次失败。转码不会释放输入。输入和成功输出 id 用 `dealloc_bytes` 释放；成功或失败的结果元数据都要另行调用 `result.free()`。`free()` 不释放输出字节区。

转码只接受一个完整文档。JSON 允许文档后的空白；MessagePack 必须精确消费传入长度。长度必须是有效载荷字节数，不能用取整后的容量。JSON 对象的 map key 保持字符串。JSON 对象直接按 map 序列化，不依赖 struct-map 配置。往返保真限于 JSON 数据模型及可表示数值；任意 MessagePack 的 bin/ext、非 JSON map key 和超出 JSON 数值范围的整数可能被改写或拒绝。

指针只保证释放前稳定，内存增长会替换 `memory.buffer`。每次读取前用当前缓冲重新创建视图。`.slice()` 得到 JavaScript 自有副本，可以在释放字节区后保留；零拷贝视图则要求把对应 id 的释放延后到最后一次读取之后。`@migaia/store-wasm` 额外提供字段所有权和 `FinalizationRegistry` 兜底，但不替代确定性释放，也不复制这里的暂存区。

模块只发布第一份完成初始化的导出。并发调用和具名函数使用同一份内存与暂存区；仍可能并发实例化，不承诺同一个 Promise 或只编译一次。原生 `WebAssembly.CompileError`、`LinkError` 和 `RuntimeError` 原样透传，不附加包级 `source` 或 `code`。转码失败通过返回值报告，与这些原生异常不同。

### 构建与验证

```bash
pnpm run build
pnpm run test
pnpm run test:rust
pnpm run typecheck
```

修改 Rust 后，`build` 从 `rust/` 运行 `wasm-pack build --target web --release --out-dir ../src`，再用 `scripts/finalize-glue.ts` 固定第一份发布的导出。不要手工编辑生成的 glue、声明或 WASM。发布验证还包括两次确定性构建、真实非零 WASM host 和 packed 安装、导入、实例化。`test` 运行真实 WASM Rust 测试和 JS 初始化回归；`test:rust` 运行 Rust 原生测试。
