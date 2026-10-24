# @migaia/storage-plugin-archive

显式把符合规则的字符串键记录从事务热层移入不可变 gzip NDJSON blob 段。先安装真实热层和冷层，再安装普通扩展插件，并在业务调用前执行 `detect()`。Memory、SQLite、PostgreSQL 热层支持所需外部 I/O；IndexedDB 热层在冷层 I/O 前拒绝。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'history',
    hot: 'hot',
    cold: 'cold',
    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]
  })
)
await host.detect()
try {
  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')
  console.log(await host.extensions.history.run())
  console.log(await host.extensions.history.get('event:one', { restore: true }))
  console.log(await host.extensions.history.sweep())
} finally {
  await host.dispose()
}
```

`run({ rule?, limit?, signal?, timeoutMs? })` 按声明顺序处理规则，limit 只累计匹配候选。段默认上限为 1,048,576 个未压缩 UTF-8 字节，单条超大记录独立成段。冷上传完成后，原热层事务持有控制锁，核对对象、重读候选、更新清单和引用数，再删除仍符合规则且未改变的热值。后续段失败不回滚前段，遗留冷对象由显式 `sweep()` 清理。

`get(key, { restore? })` 先点读热层；冷读必须验证完整 gzip/NDJSON 至 EOF，再有限复核一次热值和清单。默认不恢复；显式恢复不覆盖并发热写。Map/Set 使用共享 collections codec，字节变为其带标签 portable 表示；Date 和函数不被支持。

`sweep()` 使用原 blob opaque 分页，在同一控制锁内点读段目录，只移除本插件前缀且 format/version 元数据匹配的无引用对象，不逐段扫描全部清单。所有方法使用当前宿主组织。关闭排空已接受工作，插件不独立关闭借用对象。

错误 source 为 `storage.backend.archive`，码为 `INVALID_OPTION`、`INVALID_ARGUMENT`、`ARCHIVE_OPERATION_FAILED`、`ARCHIVE_SEGMENT_INVALID`，原错误保留在原因链。宿主准入/关闭、contract 能力/冲突/已编码取消保留原对象。本包拥有的 run 失败提供仅含确定已提交数量的 `progress`；冻结的原冲突保持身份，数量由 `onArchiveRunError` 提供。

冻结的 contract 错误保持原对象及 source `@migaia/storage-contract`、code `WRITE_CONFLICT`；通过 `onArchiveRunError` 读取已提交进度。
