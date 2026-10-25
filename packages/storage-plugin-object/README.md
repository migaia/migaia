# @migaia/storage-plugin-object

用同一套 `blob` API 将附件、导出文件等二进制内容保存到专用目录或 S3，并按需读取完整字节、流或指定范围。选择文件或 S3 驱动，再把 object 插件安装到 host，即可使用组织隔离与读取资源释放；条件写入须由所选驱动和服务实际支持，本包不提供普通键值存储或事务。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 你可能遇到过

- 数据文件写好了，元数据还没更新就被读走：两次文件写入分别可见。
- 两个请求都按旧版本覆盖文件：更新前的检查与写入之间没有保护。
- 只要文件的一小段，却读进了整个文件：接口没有范围读取。
- 提前结束下载后句柄还开着：流与资源释放没有配套使用。

## 为什么选它

- 本地驱动把内容与元数据一起发布；已打开的读取仍看到原内容。[本地文件](./USEGUIDE.md#本地文件与条件写入)
- `get()` 返回可释放对象，可选择 `bytes()` 或 `stream()`，也能指定闭区间范围。[流与范围](./USEGUIDE.md#流与范围读取)
- S3 驱动区分写入失败、提交未知和写后元数据失败，便于决定如何恢复。[S3](./USEGUIDE.md#使用-s3)
- 组织视图隔离逻辑键，分页游标绑定组织与前缀。[组织与分页](./USEGUIDE.md#组织与分页)

## 从这里开始

目录应专供这个插件使用。下面写入 `hello`，再从实际文件读取。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './example-objects' }) })]
})
try {
  const objects = host.backend('object').use(blob)
  await objects.put('greeting', new TextEncoder().encode('hello'))
  const object = await objects.get('greeting')
  if (object) {
    try {
      console.log(new TextDecoder().decode(await object.bytes()))
    } finally {
      // hello
      await object.dispose()
    }
  }
  await objects.remove('greeting')
} finally {
  await host.dispose()
}
```

预期输出：

```text
hello
```

## 手写时的隐患

直接写文件可以保存字节，但元数据与并发更新还需要额外设计：

```ts doc-test=check
import { writeFile, readFile } from 'node:fs/promises'

await writeFile('./example.bin', new Uint8Array([1, 2, 3])) // 写入途中可能被其它请求读取。
await writeFile('./example.meta', JSON.stringify({ size: 3 })) // 与内容不是同一次发布。
console.log(await readFile('./example.bin')) // 全量读入；没有范围或 etag 条件。
```

## 三分钟理解

`选择 fs/S3 driver → 安装 objectBackendPlugin → use(blob) → put/get → 释放读取对象与宿主`。

| 名称          | 含义                                              |
| ------------- | ------------------------------------------------- |
| key           | 应用逻辑键，不是目录中的文件路径                  |
| `IBlobInfo`   | 完整对象大小、etag、内容类型、metadata 与更新时间 |
| `IBlobObject` | 一次读取的内容与释放方法                          |
| etag          | 传回后端用于条件写的标识，不应自行解析            |
| driver        | 选择本地目录或 S3 客户端的配置                    |

## 常见场景

| 想做什么                       | 组合                   | 示例                                           |
| ------------------------------ | ---------------------- | ---------------------------------------------- |
| 保存本地附件，避免覆盖别人更新 | fs + `ifMatch`         | [本地与条件](./USEGUIDE.md#本地文件与条件写入) |
| 处理大文件或部分内容           | 流 + range             | [流与范围](./USEGUIDE.md#流与范围读取)         |
| 使用 S3 或兼容服务             | s3 driver              | [S3](./USEGUIDE.md#使用-s3)                    |
| 生成上传或下载链接             | presign Feature，仅 S3 | [签名链接](./USEGUIDE.md#生成签名链接)         |
| 多组织附件与翻页               | host org + blob list   | [组织与分页](./USEGUIDE.md#组织与分页)         |

## 安装

这些 storage 包当前是 `private: true` 的仓库 workspace 包，尚不作为已发布的 registry 包提供。在仓库内消费包添加：

```bash
pnpm add --workspace @migaia/storage-plugin-object @migaia/storage-host @migaia/storage-contract
pnpm add @aws-sdk/client-s3@^3.1140.0 @aws-sdk/s3-request-presigner@^3.1140.0
```

SDK 是包声明的真实 peer。本地 `/fs` 入口按 Node、Bun、Deno 选择原生文件适配；S3 使用独立 `/s3` 入口，签名使用 `/features/presign`。根插件工厂不会打开目录或创建客户端，资源在安装时打开。包声明 Node.js `>=24`。

## 常用 API

| API                                                    | 用途                           |
| ------------------------------------------------------ | ------------------------------ |
| `objectBackendPlugin({ id?, driver }, features?)`      | 安装后端，默认 ID 为 `object`  |
| `fsObjectDriver({ root })` / `s3ObjectDriver(options)` | 选择本地目录或 S3              |
| `store.use(blob).put/get/head`                         | 写内容、开读取对象、只读元数据 |
| `object.bytes()` / `stream()` / `dispose()`            | 消费一次内容并释放             |
| `remove` / `removeByPrefix` / `list`                   | 删除或分页枚举本组织对象       |
| `objectPresignFeature()`                               | 明确选择 S3 签名 API           |

## 使用边界

- 后端提供 blob，不提供普通 KV 或事务。逻辑键是字符串，空字符串也合法。metadata 值为字符串；S3 另要求名称为小写 HTTP token、值为无换行的 ASCII 头字节。
- 一个真实目录只支持本进程内一个写实例；跨进程共享不受支持。目录必须可信且专用，不要放其它应用文件。文件更新提供原子可见性，不保证 fsync 级掉电耐久。文件 etag 基于内容 SHA-256，同字节内容可能保留同一 etag，不能把它当每次更新递增的版本号。
- `get/head` 缺失返回 `undefined`；`remove` 返回删除前是否观察到对象。`get` 的 `stream/bytes` 共享一次消费机会；EOF 或 cancel 释放底层读取，未消费或提前结束应显式 dispose。
- range 的 `start`、`end` 是非负安全整数，end 为闭区间；省略 end 读到末尾。`info.size` 始终是完整大小。范围起点超过内容时返回空内容，不把对象当作缺失。
- `ifMatch` 与 `ifNoneMatch: true` 互斥，条件失败报 `WRITE_CONFLICT`。S3 条件能力由检测确认；不支持时条件写报 `UNSUPPORTED_CAPABILITY`，不会退回无条件写。
- 对象错误 source 为 `storage.backend.object`。`OBJECT_DATA_INVALID` 表示数据或响应不完整；`OBJECT_COMMIT_UNKNOWN` 表示提交确认未知；`OBJECT_FAILED` 可能带 `committed: true`，表示写入已确认而后续元数据读取失败。先检查状态再决定重试。
- `host.org(uuid).backend('object').use(blob)` 隔离组织；关闭宿主释放读资源和自建 S3 客户端。调用方传入的 `S3Client` 始终借用，需调用方自己关闭。
