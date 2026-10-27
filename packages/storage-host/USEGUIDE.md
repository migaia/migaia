# storage-host 使用指南

[English](./USEGUIDE.en.md) · [概览与安装](./README.md)

| 你的问题                 | 看这里                                    |
| ------------------------ | ----------------------------------------- |
| 先存数据，再追加其它后端 | [安装与追加后端](#安装与追加后端)         |
| 多项写入需要一起成功     | [事务与记录查询](#事务与记录查询)         |
| 用对象主键读写与查询     | [使用实体仓储](#使用实体仓储)             |
| 同一键要按组织隔离       | [隔离组织数据](#隔离组织数据)             |
| 把应用日志放进存储后端   | [打开日志存储](#打开日志存储)             |
| 安装、关闭或回调出错     | [检查错误与结束工作](#检查错误与结束工作) |

## 安装与追加后端

初始插件放在 `plugins` 数组中。后续 `use()` 返回带新增后端类型的宿主；两者共享同一个生命周期，关闭其中一个宿主引用一次即可。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

const original = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'session' })]
})
try {
  const host = await original.use(memoryBackendPlugin({ id: 'drafts' }))
  await host.detect()
  await host.backend('session').set('user', 'ada')
  await host.backend('drafts').set('title', 'First draft')
  console.log(await host.backend('session').get('user')) // ada
  console.log(await host.backend('drafts').get('title')) // First draft
} finally {
  await original.dispose()
}
```

同一批次里的插件不能借用彼此尚未发布的后端。缓存、归档等组合插件需要读取已有后端时，应先完成基础后端安装，再 `use()` 安装组合插件。ID 必须在整个宿主中唯一。

`autoDetect` 默认开启。需要先完成配置再检查环境时，可设置 `autoDetect: false`，随后显式 `detect()`。并发检查共享同一个 Promise；成功结果会缓存，失败后可再次调用。`installTimeoutMs` 是整批安装的毫秒上限，默认 `30000`，允许有限非负数。安装失败会回滚本批资源，不删除早先已成功安装的后端。

## 事务与记录查询

memory 的文本、字节和记录可以在同一个事务中写入。回调失败时草稿不提交。查询从 `records` 能力取得，下面在事务结束后读取已提交记录。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { records } from '@migaia/storage-contract'

type IOrder = { state: string; total: number }
const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const memory = host.backend('memory')
  await memory.transaction(async (tx) => {
    await tx.set('status', 'ready')
    await tx.setBytes('receipt', new Uint8Array([1, 2]))
    await tx.putRecord({ state: 'paid', total: 20 }, 'order-1')
  })
  console.log(await memory.get('status')) // ready
  const rows = await memory
    .use(records)
    .query<IOrder>()
    .where({ state: 'paid' })
    .select('total')
    .all()
  console.log(rows) // [{ total: 20 }]
} finally {
  await host.dispose()
}
```

memory 的记录过滤在客户端执行。换用数据库后端时，下推能力和事务范围由该后端决定。事务可能因冲突重放回调；不要在回调中发送邮件、扣款或执行其它无法随事务回滚的副作用。

同一逻辑键的文本、字节和记录有通道冲突规则。需要替换已有通道时，应明确选择相应写入策略，不把三种值当成互不相干的键空间。批量写入的重复键会在提交前拒绝；批量删除的重复键只计一次。

## 使用实体仓储

`/entity` 现在只包含定义、连接和基础读写。附加能力需从独立子路径显式装配；缺少装配时抛出 `source: @migaia/storage-host`、`code: ENTITY_FEATURE_REQUIRED`，消息写明所需导入。

```ts
import { defineEntity, type IEntityConnectStore } from '@migaia/storage-host/entity'
/** 已连接的应用存储，生命周期由调用方管理。 */
declare const store: IEntityConnectStore
const users = defineEntity<{ id: string; name: string }>({ name: 'users', key: 'id' }).connect(
  store
)
await users.put({ id: 'u1', name: 'Ada' })
console.log(await users.get('u1'))
```

只在 `features` 中选择用到的单元：`/entity/query` 的 `entityQueryFeature()` 开启 query/list/stream；`/entity/indexes` 的 `entityIndexesFeature()` 开启索引声明和规划；`/entity/unique` 的 `entityUniqueFeature()` 开启唯一提交检查；`/entity/migration` 的 `entityMigrationFeature()` 开启版本计划和持久迁移；`/entity/keyset` 的 `entityKeysetFeature()` 准入 page/after。索引查询与唯一约束的回退校验还需要 query。没有索引或唯一约束的迁移直接扫描原生记录或文本键，不需要 query 或 unique。单元不会自动开启其他单元。

unique 单元能单独捕获约束投影，不会因此开启索引规划；仅做唯一写入检查时不需 indexes 单元。

`defineEntity<T>()({...})` 声明对象的主键与索引，`connect(store)` 连接实际后端。下面先写入，再用同一声明查询。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/query'
import { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'

type IOrder = { id: string; state: string; total: number }
const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const orders = defineEntity<IOrder>()({
    name: 'orders',
    key: 'id',
    features: [entityQueryFeature(), entityIndexesFeature()],
    indexes: { byState: { path: 'state' } }
  }).connect(host.backend('memory'))
  await orders.put({ id: 'o1', state: 'paid', total: 20 })
  console.log(await orders.get('o1'))
  console.log(await orders.query().index('byState', 'paid').select('id', 'total').all())
  // [{ id: 'o1', total: 20 }]
} finally {
  await host.dispose()
}
```

实体不会关闭传入的后端。事务中使用 `orders.in(tx)`；`orders.batch(...)` 使用一个原生记录事务。schema 与 codec 用于运行时校验和转换，TypeScript 类型本身不校验外部输入。需要外部 schema 时，可从同一 `/entity` 入口使用 `fromStandardSchema`；转换失败保留原错误在 `cause` 中。

查询的 `index` 或 `range` 要最先选择，且只能选一次；普通 `where`、`select`、`skip`、`limit` 会产生新分支。自定义比较器应搭配有限 `limit`，或使用 `first()`。`stream()` 返回可释放迭代器；提前停止时使用 `await using` 或显式 `dispose()`。`watch()` 是可用后端的失效通知，并非结果行流，也不保证重放。事务查询没有 `watch()`。

### 持久化版本迁移

迁移没有索引或唯一约束的记录时，只需选择 migration 单元。读取旧记录会升级返回值；需要持久化新版本信封时，再调用 `migrate()`。内存记录的每个迁移批次沿用原生事务。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityMigrationFeature } from '@migaia/storage-host/entity/migration'

type IUser = { id: string; name: string }
const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const store = host.backend('memory')
  const original = defineEntity<IUser>({ name: 'migration-users', key: 'id' }).connect(store)
  await original.put({ id: 'ada', name: ' Ada ' })
  await original.put({ id: 'lin', name: ' Lin ' })
  const users = defineEntity<IUser>({
    name: 'migration-users',
    key: 'id',
    version: 2,
    features: [entityMigrationFeature()],
    migrations: {
      2: (previous) => {
        const user = previous as IUser
        return { ...user, name: user.name.trim() }
      }
    }
  }).connect(store)
  const result = await users.migrate({ batchSize: 1 })
  console.log(result.migrated, (await users.get('ada'))?.name) // 2 Ada
} finally {
  await host.dispose()
}
```

声明唯一约束时仍需选择 unique 单元；其回退校验还需要 query。迁移不会隐式补装任何一个单元。

## 隔离组织数据

组织 ID 是规范小写 UUID。保存组织视图后，同一视图的提取方法也继续使用该组织。

```ts doc-test=run
import { createStorageHost, createOrgId, memoryBackendPlugin } from '@migaia/storage-host'

const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const orgA = createOrgId()
  const orgB = createOrgId()
  const a = host.org(orgA).backend('memory')
  const b = host.org(orgB).backend('memory')
  await a.set('name', 'Ada')
  await b.set('name', 'Lin')
  console.log(await a.get('name'), await b.get('name')) // Ada Lin
  await host.dropOrg(orgA)
  console.log(await b.get('name')) // Lin
} finally {
  await host.dispose()
}
```

省略 `org` 选项时，根后端使用零 UUID。memory 的每个插件实例独立，namespace 相同也不会共享数据。组织视图只提供业务操作，没有安装与关闭方法。`dropOrg()` 尝试所有后端；一个失败不撤回其它成功删除，调用方应检查聚合错误。不要把多后端组织删除视为一个全局事务。

非默认组织只获得其后端实际提供的能力。根后端上的自定义 capability 不会自动复制；Feature 的 `api` 方法则经组织视图调用。原生 SQL/SPARQL 不支持组织视图，应使用对应组织化数据接口。

## 打开日志存储

先安装可选 peer `@migaia/logger`。`storageLogStore()` 是异步工厂，接受宿主或组织视图、后端 ID 和非空 `prefix`，不能传普通 KV 对象。下面追加一条记录，再读取序号与待处理状态。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageLogStore, storageJournalPlugin } from '@migaia/storage-host/journal'
import { LogRecordState } from '@migaia/logger/plugins/durable'

const host = await createStorageHost({ plugins: [storageJournalPlugin(), memoryBackendPlugin()] })
try {
  const log = await storageLogStore(host, 'memory', { prefix: 'history' })
  try {
    await log.append([{ kind: 'order.created', payload: { id: 'o1' } }])
    await log.setState(1, LogRecordState.done)
    console.log(await log.lastSeq()) // 1
    console.log(await log.states(LogRecordState.pending)) // []
  } finally {
    await log.dispose()
  }
} finally {
  await host.dispose()
}
```

日志记录与业务键分开；业务枚举、clear 和容量限制不会操作日志。后端必须支持所需日志存储，打开时先恢复已确认状态。独占存储上的同一组织与前缀只允许一个打开句柄；支持共享事务的存储可允许多个句柄。序号不因截断而重用。写入是否提交无法确认时，日志停止接纳操作，应关闭后重新打开恢复。`dropOrg()` 后旧日志句柄报 `STORE_DISPOSED`。

打开日志不等于开启自动业务日志。自动记录需要 `createStorageHost({ plugins: [storageJournalPlugin(), backend], journal: ... })`；配置可以直接提供 `{ logger, namespace, ... }`，或用异步初始化函数为每个组织准备配置。初始化函数接收 `orgId` 和异步 `storageLogStore(id, { prefix })`。宿主借用 logger，不负责 shutdown。

根据需要选择 binlog、WAL、undo 与同事务日志对象。`atomicBinlog` / `atomicUndo` 按后端 ID 指定真实日志存储；需要它们与业务后端能在同一事务提交。其它组合是否可用由实际后端支持决定，不支持会在业务修改前拒绝。外置 binlog 追加失败会报告，已提交业务数据不回滚；结果未知不能通过盲目重放写入恢复。undo 先检查记录与修订，冲突为 `UNDO_CONFLICT`，缺失为 `UNDO_NOT_FOUND`。

开启 `telemetry: true` 还需要 logger 的 level 插件；日志可能包含操作 payload 和错误，应按应用要求配置 logger。只开 telemetry 也会安装异步阶段，此时使用异步数据方法；同步读写会报 `ASYNC_STAGE_IN_SYNC_ENTRY`。没有配置 journal 且没有导入 `/journal` 时，宿主运行时不加载 logger。更多 logger 配置见 [logger 指南](../logger/USEGUIDE.md)。

## 检查错误与结束工作

业务失败会通过调用的 Promise 返回；观察监听器和报告回调的失败不改变已完成的数据操作。配置 `report(error)` 接收这类诊断，检查 `source`、`code` 和原始 `cause`。

| 情况                                               | 处理方式                                   |
| -------------------------------------------------- | ------------------------------------------ |
| `BACKEND_NOT_INSTALLED`、`INVALID_CONFIG`、重复 ID | 修正安装顺序、ID 或配置                    |
| `UNSUPPORTED_CAPABILITY`                           | 检查检测状态及实际后端是否支持该组合       |
| `SERIALIZE_FAILED` / `DESERIALIZE_FAILED`          | 检查 schema、codec 与 cause 中的原输入错误 |
| `WRITE_CONFLICT` / 锁拒绝                          | 按后端并发策略处理，不重放外部副作用       |
| `ORG_DELETE_FAILED`                                | 查看聚合错误，确认各后端实际删除结果       |

显式 `host.dispose()` 等待已接纳工作，保留关闭错误，重复调用复用同一 Promise。`await using host = ...` 也可以释放；该入口把清理失败送到报告渠道，避免替换外层主错误。结束前先完成数据读取与迭代器消费，不在关闭后继续调用保存的句柄。

后端实现者的运行时导入变更见 [README 迁移表](./README.md#后端作者入口迁移) 与 [contract 入口表](../storage-contract/README.md#入口与依赖方向)。

## 显式装配可选能力

基础宿主不导入 journal runtime、通知控制器或变更迭代器。此前 journal 选项会自动加载日志实现，memory 默认提供变更通知和 watch；现在这些能力由业务显式选择，避免基础存读包含未使用代码。

使用 journal 选项或 `storageLogStore()` 前，在同一插件列表中把从 `@migaia/storage-host/journal` 导入的 `storageJournalPlugin()` 放到后端前。缺少插件时报 `JOURNAL_NOT_ASSEMBLED`。配置格式、日志内容和事务提交语义保持原契约。

memory 通知和变更流分别由两个 Feature 装配：

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'

const host = await createStorageHost({
  plugins: [
    memoryBackendPlugin(undefined, {
      notifications: memoryNotificationsFeature(),
      changeFeed: memoryChangeFeedFeature()
    })
  ]
})
await host.dispose()
```

未选择变更流时，memory 的 `capabilities.changeFeed` 为 `false`；调用 watch 报 `CHANGE_ITERATOR_NOT_ASSEMBLED`。只选通知可调用 `subscribeChanges()`；变更流依赖通知，缺少通知时报 `CHANGE_CONTROLLER_NOT_ASSEMBLED`。基础读写与物理资源关闭仍由轻量生命周期 owner 负责。

后端作者从 `/authoring/change-controller` 导入通知工厂，并显式传给 `core.createChangeController(options, createBackendChangeController)`。基础物理资源可使用同入口的 `createBackendLifecycleController`。变更迭代器改从 `/authoring/change-iterator` 导入，不再从 `/authoring/backend` 转出。

### 严格索引查询迁移

旧版 `.index(...).requirePushdown()` 在没有客户端步骤时允许全表扫描。现在显式索引来源若为 `fullScan`，或原生索引准备遇到竞争而只能扫描，终端读取会拒绝 `@migaia/storage-contract / QUERY_NOT_PUSHABLE`。需要原生索引时同时装配 `entityIndexesFeature()` 和后端索引 Feature；允许权威扫描时移除 `requirePushdown()`。普通查询继续保留扫描回退。IndexedDB 的借用视图与原生 store 共用能力身份；未迁移的旧格式记录使 readiness 保持 running；查询继续全表扫描并发出回退诊断，直到迁移状态完成且与当前定义一致。

没有迁移元数据时，只有从 canonical 起点开始、完整结束两个扫描阶段，且未遇到任何旧格式记录、未跳过任何无效 entity 记录的回填，才可变为 complete。当前格式数据因此无需 `entityMigrationFeature()` 也可使用原生 cursor。旧格式记录（含已有 canonical 副本的 shadow）或被跳过的无效记录使 readiness 保持 running；普通查询全表扫描并发出回退诊断，显式索引 strict 查询拒绝 `QUERY_NOT_PUSHABLE`。从持久 checkpoint 续跑不能证明前面的扫描干净。已有迁移元数据仍只接受 complete 状态和匹配的 schema fingerprint。
