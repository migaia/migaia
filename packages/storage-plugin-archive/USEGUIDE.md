# Archive 使用指南

## 按场景查找

| 需求                         | 场景                                  |
| ---------------------------- | ------------------------------------- |
| 按业务时间移动旧记录         | [按保留时间归档](#按保留时间归档)     |
| 查历史、恢复与回收冷空间     | [读取恢复与清理](#读取恢复与清理)     |
| 为不同组织使用自定义函数前缀 | [组织与自定义前缀](#组织与自定义前缀) |
| 监控确定提交的数量           | [观察提交进度](#观察提交进度)         |

## 按保留时间归档

下面把一天前的 event 归档，新记录仍留在热层。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'archive',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
await hot.putRecord({ createdAt: 0, value: 'old' }, 'event:old')
await hot.putRecord({ createdAt: Date.now(), value: 'new' }, 'event:new')
const result = await host.extensions.archiveRun({ rule: 'old', limit: 1 })
console.log(result.archived)
console.log((await hot.getRecord('event:old')) === undefined)
console.log((await hot.getRecord('event:new')) !== undefined)
```

预期输出：

```text
1
true
true
```

id 决定扩展函数前缀；hot/cold 指此前安装的 backend id。rules 非空，name 必须唯一；prefix 是字符串键前缀。olderThanMs 是非负安全整数，where(cutoffMs) 接收本次运行一次采样的当前时间减保留时长，返回记录筛选条件。日期判断由 where 显式表达，插件不会猜测记录哪个字段是时间。

segmentBytes 默认 1,048,576，按未压缩 UTF-8 行字节计算，必须为正安全整数。超大单条记录独立成段。rule 可选，只执行该命名规则；省略按声明顺序执行。limit 可选，必须为正安全整数，只累计所有已选规则的匹配候选，同一键不重复计数。

归档把记录写为不可变 gzip NDJSON 段，上传完成后进入热层事务，核对冷对象、重读热记录、更新归档引用，再删除未改变且仍匹配的热值。并发变化会计入 skipped，不删除新值。没有跨热冷两层的全局事务：前段成功、后段失败时，前段保持提交，遗留冷对象留给显式 Sweep。

归档不是后台任务，也不是自动到期删除。应用决定何时调用 Run；生产环境使用持久热冷后端，内存示例随进程结束丢失数据。

## 读取恢复与清理

有引用的冷段不能清理。恢复最后一条记录后，段才可被 Sweep 回收。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'archive',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
await hot.putRecord({ createdAt: 0, value: 42 }, 'event:a')
await host.extensions.archiveRun()
console.log((await host.extensions.archiveSweep()).removed)
await host.extensions.archiveGet('event:a', { restore: true })
console.log((await hot.getRecord('event:a')) !== undefined)
console.log((await host.extensions.archiveSweep()).removed)
console.log((await host.extensions.archiveSweep()).removed)
```

预期输出：

```text
0
true
1
0
```

Get 先读取热值；没有热值时查归档引用并读取对应段。它验证完整 gzip/NDJSON 到 EOF，再有限复核一次热值和引用，不能只拿到目标行就提前宣告成功。restore 默认 false；true 在热层事务中恢复且不覆盖并发热写。缺失返回 undefined。

Map/Set 使用 collections codec 往返；字节返回带标签 portable 表示，Date 和函数不支持。不要把归档当作任意 JavaScript 对象快照。

Sweep 通过 blob 原生 opaque 分页扫描本插件前缀，只有 format/version 元数据匹配且热层引用数为 0 的段才删除。它不逐段扫描所有记录清单，不删除仍被引用的段，也不替代 blob 后端自身的原生存储清理。scanned 是列出的候选数，removed 是实际成功删除数。重复 Sweep 可以返回 0。

## 组织与自定义前缀

id 为 history 时公开 historyRun、historyGet、historySweep；组织视图正常调用同样的平铺函数。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'history',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
const org = host.org('11111111-1111-4111-8111-111111111111')
await hot.putRecord({ createdAt: 0, value: 'root' }, 'event:a')
await org.backend('hot').putRecord({ createdAt: 0, value: 'tenant' }, 'event:a')
console.log((await org.extensions.historyRun()).archived)
console.log((await org.backend('hot').getRecord('event:a')) === undefined)
console.log((await hot.getRecord('event:a')) !== undefined)
console.log((await org.extensions.historyGet('event:a')) !== undefined)
```

预期输出：

```text
1
true
true
true
```

操作使用调用它的组织，hot/cold 都投影到同一组织。无需传一个不同 orgId 到 options；组织上下文不一致会拒绝。root 与其他组织相同的字符串键互不干扰。不存在 host.backend('history') 或 extensions.history.run()。

## 观察提交进度

afterArchiveRun 观察成功结果；业务仍应读取方法返回的进度。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { archivePlugin } from '@migaia/storage-plugin-archive'

await using base = await createStorageHost({
  plugins: [storageProbe(), memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await base.use(
  archivePlugin({
    id: 'archive',
    hot: 'hot',
    cold: 'cold',
    rules: [
      {
        name: 'old',
        prefix: 'event:',
        olderThanMs: 86_400_000,
        where: (cutoff) => ({ createdAt: { lt: cutoff } })
      }
    ]
  })
)
await host.detect()
const hot = host.backend('hot')
host.extensions.observe('afterArchiveRun', (event) => console.log(event.archived))
await hot.putRecord({ createdAt: 0, value: 42 }, 'event:a')
const result = await host.extensions.archiveRun()
console.log(result.segments)
```

预期输出：

```text
1
1
```

返回值 archived/skipped/segments 只计入确定提交的结果。后续段失败不会回滚这些数字。beforeArchiveRun 提供规则数和可选 limit；onArchiveRunError 提供已提交进度与可取得的 code；afterArchiveRestore 提供 restored；afterArchiveSweep 提供 scanned/removed。hooks 只观察，异常或拒绝交给 report，不修改归档结果。

## 参数与失败处理

Run 接收 rule、limit 及 signal/timeoutMs/pageSize 等操作上下文。Get 另有 restore；Sweep 只接收操作上下文。取消停止后续工作，已提交段仍存在；关闭 host 等待已经接受的实际工作，不把调用方先收到取消当成物理操作结束。

| source / code                                      | 含义与处理                                            |
| -------------------------------------------------- | ----------------------------------------------------- |
| storage.backend.archive / INVALID_OPTION           | 安装配置非法，先修复 id、后端引用或规则。             |
| storage.backend.archive / INVALID_ARGUMENT         | 运行参数、规则名、limit 或字符串键非法。              |
| storage.backend.archive / ARCHIVE_OPERATION_FAILED | 显式操作失败，查看 cause 与已提交进度。               |
| storage.backend.archive / ARCHIVE_SEGMENT_INVALID  | 冷段或私有元数据校验失败，保留原始解析原因。          |
| @migaia/storage-contract / UNSUPPORTED_CAPABILITY  | 热冷后端缺能力；不把 IndexedDB 事务当成可跨任意 I/O。 |

原生错误类型与原错误仍可从 cause/errors 链读取。已有 host/contract 的关闭、冲突和已编码取消保持原对象。本包产生的 Run 失败带 progress；不可扩展的原冲突不附加字段，通过 onArchiveRunError 读取已提交进度。不要把失败后的进度解释为整个任务回滚，也不要未核实就重放未知的原生提交。

热层需 records、迭代、事务和所需控制锁，Memory/SQLite/PostgreSQL 支持；IndexedDB 安装在冷 I/O 前拒绝。冷层需 blob，压缩环境须支持 gzip。插件不独立关闭驱动或热冷后端；只释放 host 即可走其正常关闭流程。连接池等调用方资源按其真实客户端 API 释放。
