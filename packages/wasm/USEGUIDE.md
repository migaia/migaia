# `@migaia/wasm` 使用手册

[English](./USEGUIDE.en.md)

包的定位和选用依据见 [README](./README.md)。安装包后，下面每个示例都能单独保存为 `.ts` 文件，用 Node 24 运行；示例显式读取包内 WASM 字节。

## 按场景查找

| 你遇到的问题                         | API               | 看这一节                                                                      |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------- |
| 两个功能同时启动时共享同一份内存     | `init`            | [两个功能同时启动时共享同一份内存](#两个功能同时启动时共享同一份内存)         |
| 不用猜内存对齐就能存数值读数         | `alloc_bytes`     | [不用猜内存对齐就能存数值读数](#不用猜内存对齐就能存数值读数)                 |
| 内存增长后继续读取同一块分配         | `ptr_of`          | [内存增长后继续读取同一块分配](#内存增长后继续读取同一块分配)                 |
| 释放 WASM 字节后保留 JavaScript 副本 | `dealloc_bytes`   | [释放 WASM 字节后保留 JavaScript 副本](#释放-wasm-字节后保留-javascript-副本) |
| 保留两次转码结果而不互相覆盖         | `json_to_msgpack` | [保留两次转码结果而不互相覆盖](#保留两次转码结果而不互相覆盖)                 |
| 拒绝尾随第二个文档，避免静默丢数据   | `json_to_msgpack` | [拒绝尾随第二个文档，避免静默丢数据](#拒绝尾随第二个文档避免静默丢数据)       |
| 只解码收到的 MessagePack 字节        | `msgpack_to_json` | [只解码收到的 MessagePack 字节](#只解码收到的-messagepack-字节)               |

## 两个功能同时启动时共享同一份内存

两个功能可能同时初始化模块。如果后完成的实例替换前一个实例，一个功能拿到的内存就会和具名函数使用的内存分离。初始化器只发布第一份完成初始化的导出，所有完成的调用都返回它；这不表示只编译一次，也不承诺返回同一个 Promise。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const bytes = await readFile(
  new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
)
const [first, second] = await Promise.all([
  init({ module_or_path: bytes }),
  init({ module_or_path: bytes })
])
const id = alloc_bytes(8)
if (id === 0) throw new Error('分配失败')
try {
  console.log('同一导出:', first === second)
  console.log('同一分配:', first.byte_len_of(id) === byte_len_of(id))
} finally {
  dealloc_bytes(id)
}
```

输出：

```text
同一导出: true
同一分配: true
```

输出 `同一导出: true` 和 `同一分配: true`。两个初始化结果和具名分配函数使用同一个已发布的字节暂存区。

## 不用猜内存对齐就能存数值读数

一个能创建字节数组的偏移，用来创建 `Float64Array` 时却可能抛出 `RangeError`。手写分配器需要同时处理地址对齐和容量取整。`alloc_bytes` 一次完成这两件事：申请 9 字节会得到 16 字节的清零空间，地址按八字节对齐。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(9)
if (id === 0) throw new Error('分配失败')
try {
  const values = new Float64Array(wasm.memory.buffer, ptr_of(id), 2)
  values.set([21.5, 23])
  console.log('容量:', byte_len_of(id))
  console.log('对齐余数:', ptr_of(id) % 8)
  console.log('读数:', values[0], values[1])
} finally {
  dealloc_bytes(id)
}
```

输出：

```text
容量: 16
对齐余数: 0
读数: 21.5 23
```

输出容量 16、对齐余数 0 和读数 21.5 23。取整后的分配可以容纳两个浮点数，指针符合原生数值视图的对齐要求。

## 内存增长后继续读取同一块分配

后续分配触发内存增长后，之前缓存的数值视图可能变成空视图。指针稳定不代表旧 ArrayBuffer 仍然有效。保留分配 `id`，每次读取前用 `ptr_of` 和当前 `memory.buffer` 重新创建视图。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(8)
if (id === 0) throw new Error('分配失败')
try {
  const offset = ptr_of(id)
  const previous = new Float64Array(wasm.memory.buffer, offset, 1)
  previous[0] = 42
  wasm.memory.grow(1)
  const current = new Float64Array(wasm.memory.buffer, ptr_of(id), 1)
  console.log('偏移未变:', ptr_of(id) === offset)
  console.log('旧视图字节数:', previous.byteLength)
  console.log('当前读数:', current[0])
} finally {
  dealloc_bytes(id)
}
```

输出：

```text
偏移未变: true
旧视图字节数: 0
当前读数: 42
```

输出 `偏移未变: true`、`旧视图字节数: 0` 和 `当前读数: 42`。活动分配的偏移保持不变，但内存增长使旧的非共享缓冲失效。

## 释放 WASM 字节后保留 JavaScript 副本

上传队列可能比产生字节的转码任务活得更久。如果队列还拿着已释放字节区的视图，后续分配就可能改写待上传数据。在 `dealloc_bytes` 前复制字节，队列就拥有独立副本；第二次释放返回 `false`，不会释放另一块活动分配。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const id = alloc_bytes(3)
if (id === 0) throw new Error('分配失败')
try {
  const view = new Uint8Array(wasm.memory.buffer, ptr_of(id), 3)
  view.set([1, 2, 3])
  const ownedCopy = view.slice()
  console.log('释放:', dealloc_bytes(id), dealloc_bytes(id))
  console.log('副本:', ownedCopy.join(','))
  console.log('已释放的查询:', ptr_of(id), byte_len_of(id))
} finally {
  dealloc_bytes(id)
}
```

输出：

```text
释放: true false
副本: 1,2,3
已释放的查询: 0 0
```

输出 `释放: true false`、`副本: 1,2,3` 和 `已释放的查询: 0 0`。JavaScript 副本仍可读取，已释放 id 的字节区查询返回零。

## 保留两次转码结果而不互相覆盖

批量导出可能还没读取第一次结果就开始第二次转码。用全局“上一次结果”时，很容易把第二次输出当成第一次输出。每次 `json_to_msgpack` 都返回自己的输出 id、精确长度和错误，保留两个结果对象就能分别读取两次操作。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, {
  alloc_bytes,
  ptr_of,
  dealloc_bytes,
  json_to_msgpack,
  type ConversionResult
} from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const inputs: number[] = []
const results: ConversionResult[] = []
try {
  for (const json of ['{"first":true}', '{"second":true}']) {
    const bytes = new TextEncoder().encode(json)
    const id = alloc_bytes(bytes.length)
    if (id === 0) throw new Error('分配失败')
    inputs.push(id)
    new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
    results.push(json_to_msgpack(id, bytes.length))
  }
  console.log(
    '都成功:',
    results.every((result) => result.id !== 0 && result.error === '')
  )
  console.log('输出各自独立:', results[0].id !== results[1].id)
  console.log('第一个结果仍有效:', results[0].len > 0)
} finally {
  for (const result of results) {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
  for (const id of inputs) dealloc_bytes(id)
}
```

输出：

```text
都成功: true
输出各自独立: true
第一个结果仍有效: true
```

三行结果都是 `true`。第二次调用没有覆盖第一个结果。`finally` 分别释放成功输出、两个输入分配和两个元数据对象。

## 拒绝尾随第二个文档，避免静默丢数据

导出拼接出错时，一个缓冲里可能出现两个 JSON 文档。只读取第一个会看起来成功，却丢掉后面的数据。`json_to_msgpack` 要求输入是一个完整文档；尾随非空白字节会得到失败结果，输入分配仍由调用者拥有。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes, json_to_msgpack } from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const bytes = new TextEncoder().encode('{}{}')
const id = alloc_bytes(bytes.length)
if (id === 0) throw new Error('分配失败')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
  const result = json_to_msgpack(id, bytes.length)
  try {
    console.log('输出分配:', result.id, '字节数:', result.len)
    console.log('拒绝第二个文档:', result.error.startsWith('json to msgpack failed:'))
    console.log('输入仍归调用方:', ptr_of(id) !== 0)
    if (result.id !== 0) dealloc_bytes(result.id)
  } finally {
    result.free()
  }
} finally {
  dealloc_bytes(id)
}
```

输出：

```text
输出分配: 0 字节数: 0
拒绝第二个文档: true
输入仍归调用方: true
```

输出分配和长度都是 0，后面两个判断都是 `true`。失败没有留下输出块；调用者仍须释放输入和失败结果的元数据。

## 只解码收到的 MessagePack 字节

收到的五字节消息可能占用八字节的暂存区。如果把容量当成文档长度，解码器会把填充字节也读进去，让有效消息变成尾随字节错误。把收到的精确字节数传给 `msgpack_to_json`，并且只读取结果的 `result.len` 字节。

```ts doc-test=run
import { readFile } from 'node:fs/promises'
import init, {
  alloc_bytes,
  byte_len_of,
  ptr_of,
  dealloc_bytes,
  msgpack_to_json
} from '@migaia/wasm'

const wasm = await init({
  module_or_path: await readFile(
    new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))
  )
})
const packed = new Uint8Array([0x81, 0xa2, 0x6f, 0x6b, 0xc3])
const id = alloc_bytes(packed.length)
if (id === 0) throw new Error('分配失败')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), packed.length).set(packed)
  const result = msgpack_to_json(id, packed.length)
  try {
    if (result.id === 0) throw new Error(result.error)
    const json = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()
    console.log('文档:', new TextDecoder().decode(json))
    console.log('输入字节:', packed.length, '容量:', byte_len_of(id))
  } finally {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
} finally {
  dealloc_bytes(id)
}
```

输出：

```text
文档: {"ok":true}
输入字节: 5 容量: 8
```

输出 `文档: {"ok":true}` 和 `输入字节: 5 容量: 8`。文档长度不同于取整容量，转码只消费传入的精确文档字节。

## 初始化与参数

默认初始化器导入为 `init`。`init({ module_or_path })` 接受请求字符串、`Request`、`URL`、`Response`、`BufferSource`、预编译 `WebAssembly.Module`，也接受这些输入的 Promise。省略参数时使用包内 `wasm_provider_bg.wasm` 网址。请求字符串、请求和网址走 `fetch`；字节和模块直接实例化。Node 示例通过包入口定位相邻资源并传入字节。加载失败时 Promise 拒绝。

`initSync({ module })` 接受字节或预编译 `WebAssembly.Module`，不发起网络获取，`module` 必填。已初始化时，两个入口都返回已发布导出。位置参数形式仍然接受，但会输出弃用警告；使用对象形式即可。

`InitOutput.memory` 是原生 `WebAssembly.Memory`。其余函数属于生成的原始 ABI：特别是转码函数返回数字元数据指针，释放函数返回数字布尔值。应用应使用具名导入的包装函数，得到 `ConversionResult` 和布尔值。不要把字节区 id 当成元数据指针。

| 参数                  | 说明                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `byte_len`            | 请求的字节数，使用非负的无符号三十二位整数；容量向上取整为八的倍数。零长度分配成功后也拥有必须释放的 id。                 |
| `id`                  | 同一已初始化模块中，来自 `alloc_bytes` 或成功 `ConversionResult.id` 的活动 id。零是保留哨兵，不是分配。不能传入字节指针。 |
| `len`                 | 实际写入输入的文档字节数，不超过 `byte_len_of(id)`。不能使用取整容量。                                                    |
| `init.module_or_path` | 可选的模块来源，取值见上文。省略参数时默认使用包内 WASM 网址；提供字节时无需网络获取。                                    |
| `initSync.module`     | 必填的字节或预编译模块。没有默认值，不接受需要网络获取的来源。                                                            |

## 暂存区与转码所有权

Rust 使用 `Vec<u64>` 管理同一个字节暂存区。分配 id 保持稳定，活动期间不会被复用。字节指针在对应 id 释放前保持有效。任何可能分配或增长内存的调用后，都应从当前 `memory.buffer` 重新创建视图。

`alloc_bytes` 在内存或 id 空间耗尽时返回 `0`。未知和已释放 id 的 `ptr_of`、`byte_len_of` 返回 `0`，`dealloc_bytes` 返回 `false`。活动的零长度分配容量同样为零，不能只凭容量判断是否仍然活动。

两个转码器都是同步的，只收发字节。成功返回 `{ id: nonzero, len: exactBytes, error: '' }`；失败返回 `{ id: 0, len: 0, error: reason }`。每次调用持有独立元数据。输入 id 和成功输出 id 都归调用者，用 `dealloc_bytes` 分别释放。每个返回的元数据对象，包括失败结果，还须另行调用 `free()` 或 `[Symbol.dispose]()`。释放元数据前读取所需字段；之后不要再读取或释放该元数据。释放元数据不会释放字节区，释放字节区也不会释放元数据。

转码拒绝未知 id、超过容量的长度、空文档、非法数据和尾随第二个文档。JSON 允许尾随空白，MessagePack 必须精确消费输入长度。失败没有留下输出块，调用者的输入分配和字节保持不变。JSON 读取器直接写入 MessagePack 输出，不先创建 `serde_json::Value` 树；对象的 map key 保持字符串。JSON 对象直接按 map 序列化，不依赖 struct-map 配置。

JSON 往返保真限于 JSON 数据模型及可表示数值。任意 MessagePack 的 bin/ext、非 JSON map key 和超范围整数不保证可逆，可能被改写或拒绝。

## 错误与恢复

失败转码把文本放在本次 `error` 属性中，不使用全局错误槽。id 非法或长度超容量返回 `unknown allocation id or length past capacity`；输出分配耗尽返回 `arena exhausted`。解析错误分别以 `json to msgpack failed:` 或 `msgpack to json failed:` 开头。读取输出前先检查 `id`，保留原始错误文本用于诊断，最后释放失败元数据和输入。

原生 `WebAssembly.CompileError`、`WebAssembly.LinkError`、`WebAssembly.RuntimeError` 原样透传，保持类型、身份和堆栈，不附包级 `source` 或 `code`。它们与正常转码的失败返回值不同。本包没有自有错误码。

## 接入 store-wasm

`@migaia/wasm` 负责 arena 和转码；`@migaia/store-wasm` 负责字段分配、数值视图与字段生命周期，不复制暂存区或转码状态机。字段 owner 通过 `ensureWasm()` 复用同一个初始化 Promise，显式 dispose 时释放自己的分配；构造失败时先回滚已创建资源，再保留原始错误。record 字段只接受 number，并使用当前 `memory.buffer` 上的 `DataView`。它的 `FinalizationRegistry` 只是兜底，不替代显式释放。

## 构建与验证

```bash
pnpm run build
pnpm run test
pnpm run test:rust
pnpm run typecheck
```

`build` 从 `rust/` 运行 wasm-pack，重新生成 `src/wasm_provider.js`、声明和 `.wasm`，再执行 `scripts/finalize-glue.ts` 固定第一份发布的导出。不要手工修改生成产物。验证还包括真实非零 WASM host、两次确定性构建的字节比较，以及 packed 安装、导入和实例化。`@migaia/store-wasm` 等消费者另行运行自己的格式、lint、类型与真实 WASM 运行时门禁。
