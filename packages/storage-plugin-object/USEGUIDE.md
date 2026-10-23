# 对象存储后端

`@migaia/storage-plugin-object` 通过原生文件系统或 S3 兼容服务提供共享 `blob` 能力。根工厂不加载 SDK 或打开目录。安装真实 peer：`@migaia/storage-host`、`@aws-sdk/client-s3` 和 `@aws-sdk/s3-request-presigner`。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'

await using host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './objects' }) })] as const
})
const objects = host.backend('object').use(blob)
const info = await objects.put('photo', new Uint8Array([1, 2, 3]), {
  contentType: 'application/octet-stream',
  metadata: { owner: 'ada' }
})
const object = await objects.get('photo', { range: { start: 1, end: 2 } })
if (object) {
  try {
    console.log(object.info.size, await object.bytes())
  } finally {
    await object.dispose()
  }
}
await objects.put('photo', new Uint8Array([4]), { ifMatch: info.etag })
```

文件系统入口识别 Node、Bun、Deno，只加载对应原生适配。一个真实目录仅支持本进程内一个写实例；不要跨进程共享或混入其它文件。一次 pointer rename 同时发布不可变数据与元数据；覆盖或删除不改变已打开读句柄的快照。SHA-256 标识内容，相同内容的写入可能保留 etag。这里只保证原子可见性，不承诺 fsync 级掉电耐久。

`get` 返回一次内容快照，只能选择一次 `stream()` 或 `bytes()`。EOF 和 cancel 释放底层资源，未消费对象须 dispose。范围 end 为闭区间，`info.size` 始终是完整大小。缺失 get/head 返回 undefined；remove 返回删除前是否观察到对象。

## S3

```ts
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'
import { objectPresignFeature } from '@migaia/storage-plugin-object/features/presign'

const plugin = objectBackendPlugin(
  {
    driver: s3ObjectDriver({
      config: { region: 'us-east-1', endpoint: 'http://127.0.0.1:19000', forcePathStyle: true },
      bucket: 'objects',
      prefix: 'app/'
    })
  },
  { presign: objectPresignFeature() }
)
```

传入的 `client` 属于借用，始终不销毁；`config` 分支在安装时创建自有客户端。凭据沿 SDK 原有提供方。检测在保留前缀随机对象上验证单次条件写；权限或条件不支持只报告，不中断宿主创建。无条件操作仍按真实权限执行，条件 multipart 按实际 Complete 请求判定，不降级。

未知长度流及至少 16 MiB 的字节值使用 multipart；默认每段 8 MiB、并发四段，缓冲上限为五段加输入当前块。修改 command 局部禁用 SDK 重试及区域重定向，借用 client 配置不变。发出提交但确认未知时为 `OBJECT_COMMIT_UNKNOWN`，重放前先 head；已确认写后补读元数据失败为 `OBJECT_FAILED`，附 `committed: true`。

S3 metadata 名称为小写 HTTP token，值为无换行 ASCII 头字节。etag 不透明，updatedAt 来自原生 LastModified。上传签名返回调用方必须携带的所有内容、metadata 和条件头。期限为 1 至 604800 的整数秒，默认 900，不能超过凭据有效期；签名不执行上传或下载。

## 组织与分页

通过 `host.org(orgId).backend('object').use(blob)` 获取不可变组织视图，首次写不建立注册数据。物理键复用共享组织元组与保序编码，返回键仍是逻辑键。`list({ prefix, limit, after })` 默认每页 100，按 UTF-16 字典序排列。游标绑定同一后端安装、组织和前缀，不承诺跨页快照。`removeByPrefix('')` 只清本组织。缓存与归档经宿主消费 `blob`，不依赖驱动文件。
