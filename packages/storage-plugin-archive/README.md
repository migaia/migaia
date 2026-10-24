# @migaia/storage-plugin-archive

把不常访问的旧记录从日常读写的热存储移到 blob 对象存储，减少热表需要保留的历史数据，同时保留按原键读取和显式恢复的入口。将插件接到已安装的热后端和对象后端后，由应用主动运行归档规则；归档按段提交，不把整个任务当成跨存储事务。

## 你可能遇到过

- 热表越来越大，定期删除旧记录却让历史查询失去数据。
- 上传归档后记录已被业务修改，按旧快照删除会丢掉新值。
- 一次归档中途失败，不知道前面哪些记录已经提交。
- 恢复完成后冷对象仍占空间，没有引用关系可判断何时能清理。

## 为什么选它

- 冷对象上传后重读热值，只移动仍未改变且匹配规则的记录，见[按保留时间归档](./USEGUIDE.md#按保留时间归档)。
- 读取优先使用热值，显式恢复不会覆盖并发热写，见[读取恢复与清理](./USEGUIDE.md#读取恢复与清理)。
- 进度只统计确定提交的记录和段，中途失败仍可观察，见[观察提交进度](./USEGUIDE.md#观察提交进度)。
- 显式 sweep 只删除本插件的无引用冷对象，见[读取恢复与清理](./USEGUIDE.md#读取恢复与清理)。

## 从这里开始

下面用真实内存 records 与 blob 能力演示完整流程；生产数据需要改用持久热冷后端。

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
console.log((await host.extensions.archiveRun()).archived)
console.log((await hot.getRecord('event:a')) === undefined)
console.log((await host.extensions.archiveGet('event:a')) !== undefined)
```

预期输出：

```text
1
true
true
```

需要按业务时间筛选看[按保留时间归档](./USEGUIDE.md#按保留时间归档)，需要回迁数据看[读取恢复与清理](./USEGUIDE.md#读取恢复与清理)。

## 手写时的隐患

先上传、再删除看起来简单，但两个存储之间没有一个原子操作。这里只展示，不执行。

```ts doc-test=check
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'

await using host = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const hot = host.backend('hot')
const value = await hot.getRecord('event:a')
await host
  .backend('cold')
  .use(blob)
  .put('archive:a', new TextEncoder().encode(JSON.stringify(value)))
// 隐患：上传期间热值可能已被新写入替换。
await hot.deleteRecord('event:a')
// 隐患：中途失败时没有清单支持历史读取或孤儿清理。
```

archive 在上传后用热层事务重新比较记录、提交归档引用，再删除符合条件的原值。它也不把整个归档任务伪装成跨存储事务。

## 三分钟心智模型

| 名称              | 含义                                       |
| ----------------- | ------------------------------------------ |
| hot               | 支持 records、迭代、事务和控制锁的热后端。 |
| cold              | 支持 blob 的冷后端。                       |
| rule              | 字符串键前缀、业务筛选与保留时长。         |
| segment           | 多条记录组成的不可变 gzip NDJSON 对象。    |
| Run / Get / Sweep | 显式移动、按键读取/恢复、清理无引用对象。  |

先发布 hot/cold，再 `host.use(archivePlugin(...))`，再检测。所有操作使用当前 host 组织；插件 id 只决定函数前缀，不新增 backend 槽。

## 典型场景

| 场景                 | 怎么组合                  | 详细说明                                           |
| -------------------- | ------------------------- | -------------------------------------------------- |
| 归档一天前的事件     | rule + archiveRun         | [按保留时间归档](./USEGUIDE.md#按保留时间归档)     |
| 查历史并按需恢复     | archiveGet + archiveSweep | [读取恢复与清理](./USEGUIDE.md#读取恢复与清理)     |
| 同一规则服务多个组织 | host.org + historyRun/Get | [组织与自定义前缀](./USEGUIDE.md#组织与自定义前缀) |
| 监控部分完成的任务   | hooks + 返回进度          | [观察提交进度](./USEGUIDE.md#观察提交进度)         |

## 安装

当前包为 `private: true`，用于本仓库 workspace，不能假定 registry 已发布。在同一 workspace 的应用目录安装：

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-archive
```

需要 Node.js 24 或更新版本及 gzip CompressionStream/DecompressionStream。示例内存后端没有额外 peer。选用 PostgreSQL、SQLite 或对象存储时，另外安装相应 workspace 插件和其真实驱动依赖。

## 常用 API

| API                                         | 用途                           |
| ------------------------------------------- | ------------------------------ |
| `archivePlugin({id, hot, cold, rules})`     | 安装普通扩展。                 |
| `host.extensions.archiveRun(options?)`      | 移动匹配记录并返回进度。       |
| `host.extensions.archiveGet(key, options?)` | 读热值或归档值，可显式恢复。   |
| `host.extensions.archiveSweep(ctx?)`        | 删除无引用归档对象。           |
| `host.org(id).extensions`                   | 对指定组织调用同样的平铺函数。 |

## 契约细节

id 为 archive 时仅公开 archiveRun、archiveGet、archiveSweep；id 为 history 时是 historyRun、historyGet、historySweep。没有嵌套 archive 对象，也没有扩展自己的 dispose。

Memory、SQLite、PostgreSQL 可作热层；IndexedDB 热层不支持在事务期间执行冷层 I/O，安装时在冷 I/O 前拒绝。冷层需提供 blob。插件不创建驱动、不替换热层事务，也不独立关闭借用的后端。

归档按段提交，后续段失败不会回滚先前段；未被引用的冷对象由显式 Sweep 清理。Get 默认不恢复，Sweep 不执行归档或按时间删除记录。错误 source 为 storage.backend.archive；完整规则、取消与错误进度边界见[使用指南](./USEGUIDE.md)。
