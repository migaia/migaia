# object 使用指南

[English](./USEGUIDE.en.md) · [概览与安装](./README.md)

| 你的问题                   | 看这里                                    |
| -------------------------- | ----------------------------------------- |
| 保存本地内容并检查覆盖条件 | [本地文件与条件写入](#本地文件与条件写入) |
| 不把整个大文件读入内存     | [流与范围读取](#流与范围读取)             |
| 使用远程桶和 multipart     | [使用 S3](#使用-s3)                       |
| 让客户端直接上传或下载     | [生成签名链接](#生成签名链接)             |
| 隔离组织文件与翻页         | [组织与分页](#组织与分页)                 |
| 判断失败后能否重试         | [错误与结束工作](#错误与结束工作)         |

## 本地文件与条件写入

`root` 是非空目录路径，目录由插件专用。下面先写入并读取，再只在 etag 仍匹配时覆盖。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './guide-objects' }) })]
})
try {
  const objects = host.backend('object').use(blob)
  const info = await objects.put('photo', new Uint8Array([1, 2, 3]), {
    contentType: 'application/octet-stream',
    metadata: { author: 'ada' }
  })
  const object = await objects.get('photo')
  if (object) {
    try {
      console.log([...(await object.bytes())])
    } finally {
      // [1, 2, 3]
      await object.dispose()
    }
  }
  await objects.put('photo', new Uint8Array([4]), { ifMatch: info.etag })
  console.log((await objects.head('photo'))?.size) // 1
  await objects.remove('photo')
} finally {
  await host.dispose()
}
```

`ifNoneMatch: true` 只在不存在时创建；`ifMatch: etag` 只在当前标识相同才写，两者互斥。失败报 contract `WRITE_CONFLICT`，不覆盖现有内容。etag 应原样传回；文件 etag 由内容哈希生成，同字节内容的再次写入可能不改变它，因此不能检测仅 metadata 的每次变动。

本地驱动支持 Node、Bun、Deno，安装时选择对应文件适配。一个真实目录只允许本进程一个写实例，不能由多个进程共同写。插件可能清理自己的未完成文件，因此目录要可信且专用。内容与 metadata 通过一次指针替换同时可见，已打开读对象不受后续覆盖或删除影响；此保证不包含掉电耐久或跨进程锁。

## 流与范围读取

上传接受 `Uint8Array` 或未锁定的 `ReadableStream<Uint8Array>`。流块必须是字节数组。下面从流上传四个字节，再读取闭区间 `[1, 2]`。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './guide-streams' }) })]
})
try {
  const objects = host.backend('object').use(blob)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([10, 20, 30, 40]))
      controller.close()
    }
  })
  await objects.put('sample', body)
  const object = await objects.get('sample', { range: { start: 1, end: 2 } })
  if (object) {
    try {
      console.log(object.info.size) // 4
      console.log([...(await object.bytes())]) // [20, 30]
    } finally {
      await object.dispose()
    }
  }
  await objects.remove('sample')
} finally {
  await host.dispose()
}
```

`end` 省略时读到末尾，超出末尾会截短；`start` 超出大小或对象本身为空时返回空流。`info.size` 仍表示完整对象。需要持续消费时，使用 `object.stream().pipeTo(destination)`；不要再调用 `bytes()`。两种方式共享一次消费机会，第二次消费会拒绝。`bytes()` 会聚合所选内容，适合大小可控的读取。

EOF、流错误与 cancel 会释放底层读取。尚未消费、提前停止或异常退出时，仍用 `finally` 释放对象，或 `await using`。对象不能交给多个独立消费者。取消与超时通过 `options.ctx` 提供；上传的流也需要配合取消，不要无限阻塞生产者。

## 使用 S3

先创建桶并配置 SDK 能使用的凭据。下面假定 `application-objects` 桶位于 `us-east-1`，使用 SDK 默认凭据链，不把密钥写入代码。

```ts doc-test=check
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'

const host = await createStorageHost({
  plugins: [
    objectBackendPlugin({
      driver: s3ObjectDriver({
        config: { region: 'us-east-1' },
        bucket: 'application-objects',
        prefix: 'guide/'
      })
    })
  ]
})
try {
  const objects = host.backend('object').use(blob)
  await objects.put('report', new TextEncoder().encode('ready'), { contentType: 'text/plain' })
  const object = await objects.get('report')
  if (object) {
    try {
      console.log(new TextDecoder().decode(await object.bytes()))
    } finally {
      // ready
      await object.dispose()
    }
  }
  await objects.remove('report')
} finally {
  await host.dispose()
}
```

兼容服务可在 `config` 配置 `endpoint` 与 `forcePathStyle`。`client` 与 `config` 必须二选一：传入 `client` 是借用，宿主不 destroy；传入 `config` 则安装时创建客户端，关闭时销毁。`prefix` 默认 `''`；逻辑键还会按组织编码，所以不要假定它与桶中裸对象名相同。

| 上传选项                  | 默认与范围                                            |
| ------------------------- | ----------------------------------------------------- |
| `multipartThresholdBytes` | `16777216`（16 MiB），正安全整数                      |
| `partBytes`               | `8388608`（8 MiB），至少 `5242880`（5 MiB）的安全整数 |
| `partConcurrency`         | `4`，正安全整数                                       |

未知长度的流及达到阈值的字节数组使用 multipart。默认同时缓冲的上界为五段加输入当前块。上传失败会尝试清理未完成 multipart；清理失败经宿主 report 报告。修改请求局部禁用 SDK 重试与区域重定向，不改调用方 client 的全局配置，避免自动重放结果不明的提交。

默认环境检测先 `HeadBucket`，失败会阻止创建。随后会在保留前缀下写入并删除随机探测对象，验证条件写；缺少相关权限或条件不支持会报告，条件能力保持不可用，而不把无条件操作伪装成条件成功。实际无条件操作仍受服务权限限制。条件 multipart 还必须由服务支持最终 Complete 请求的条件；不支持时拒绝，不回退。

S3 metadata 名称须为小写 HTTP token，值须为无换行 ASCII；contentType 也需合法头值。etag 不透明；updatedAt 使用原生 LastModified。读取范围时，会核对服务的 Content-Range 和内容长度；损坏或不完整响应是错误，不能作为缺失处理。

## 生成签名链接

签名只支持 S3，必须明确选择 `objectPresignFeature()`。下面生成一个带内容类型约束的上传请求；签名本身不上传内容。

```ts doc-test=check
import { createStorageHost } from '@migaia/storage-host'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'
import { objectPresignFeature } from '@migaia/storage-plugin-object/features/presign'

const host = await createStorageHost({
  plugins: [
    objectBackendPlugin(
      {
        driver: s3ObjectDriver({ config: { region: 'us-east-1' }, bucket: 'application-objects' })
      },
      { presign: objectPresignFeature() }
    )
  ]
})
try {
  const signing = host.backend('object').api.presign
  const upload = await signing.upload('avatar', {
    expiresInSeconds: 300,
    contentType: 'image/png',
    metadata: { author: 'ada' }
  })
  console.log(upload.method, upload.headers) // PUT，以及必须携带的请求头
  const download = await signing.download('avatar', { expiresInSeconds: 300 })
  console.log(download.method) // GET
} finally {
  await host.dispose()
}
```

把返回的 `url`、`method` 与全部 `headers` 交给实际 HTTP 客户端。漏掉内容、metadata、条件或 range 头会改变已签名请求。`expiresInSeconds` 为 `1` 到 `604800` 的整数秒，默认 `900`；实际有效期不会超过凭据有效期。上传支持与 `put` 相同的条件，下载支持闭区间 range。不要把临时签名 URL 写进公开日志。

## 组织与分页

下面在新组织内存两项，再沿返回游标翻页；不要自己构造或跨组织复用游标。

```ts doc-test=run
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

const host = await createStorageHost({
  plugins: [
    objectBackendPlugin({
      driver: fsObjectDriver({ root: './guide-organizations' })
    })
  ]
})
try {
  const orgId = createOrgId()
  const objects = host.org(orgId).backend('object').use(blob)
  await objects.put('photos/a', new Uint8Array([1]))
  await objects.put('photos/b', new Uint8Array([2]))
  let after: string | undefined
  do {
    const page = await objects.list({ prefix: 'photos/', limit: 1, after })
    console.log(page.items.map((item) => item.key)) // 依次为 photos/a、photos/b
    after = page.next
  } while (after !== undefined)
  await host.dropOrg(orgId)
} finally {
  await host.dispose()
}
```

`list` 默认 prefix 为 `''`、limit 为 `100`；limit 必须为正安全整数。键按 UTF-16 字典序排列，游标绑定同一安装实例、组织与前缀。分页不承诺跨页快照，翻页期间的并发写入可能改变后续结果。`removeByPrefix('')` 只清当前组织，并返回实际观察到的删除数；它不是跨对象事务。

## 错误与结束工作

| 错误                              | 含义与处理                                                     |
| --------------------------------- | -------------------------------------------------------------- |
| contract `INVALID_ARGUMENT`       | 修正键、body、range、条件或头字段                              |
| contract `WRITE_CONFLICT`         | etag 条件失败；重新读取并决定如何合并                          |
| contract `UNSUPPORTED_CAPABILITY` | 驱动、条件写或 Feature 不支持当前组合                          |
| `OBJECT_DATA_INVALID`             | 文件数据或服务响应不完整，不要作为不存在处理                   |
| `OBJECT_COMMIT_UNKNOWN`           | 已发出提交但确认未知；先 head/读取确认，不盲目重放             |
| `OBJECT_FAILED`                   | 检查 cause；若 `committed: true`，写入已成功，仅后续元数据失败 |

对象错误 source 是 `storage.backend.object`，共享校验与条件错误来自 `@migaia/storage-contract`。保留 cause 供诊断。显式关闭失败会拒绝；资源语法会报告清理失败，避免覆盖主错误。先释放读取对象，再关闭宿主；调用方注入的 S3Client 仍需自己关闭。关闭不删除已保存内容。
