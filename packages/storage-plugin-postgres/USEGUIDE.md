# PostgreSQL 使用指南

[English](./USEGUIDE.en.md)

先设置 `DATABASE_URL`。账号需要在所选 schema 创建存储表的权限。以下示例都是完整程序，会实际写库；涉及应用表或扩展时会先说明。总是先结束 host，再关闭自己创建的客户端。

## 按场景查找

| 你要做什么               | 看这一节                                  |
| ------------------------ | ----------------------------------------- |
| 值、记录和期限共同提交   | [事务与组织隔离](#事务与组织隔离)         |
| 使用数据库向量索引       | [向量检索](#向量检索)                     |
| 流式导入并在提交后通知   | [导入数据并发送通知](#导入数据并发送通知) |
| 从检查点继续处理失效信息 | [持续读取变更](#持续读取变更)             |

## 事务与组织隔离

这里写入一个固定组织。预期输出为 `ready`、`true`。

```ts doc-test=run
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { kv, records, ttl } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [postgresBackendPlugin({ driver: pgDriver(pool) })] as const
  })
  const store = host.org('10000000-0000-4000-8000-000000000001').backend('postgres')
  await store
    .tx()
    .lock(lockKey.text('example:status'))
    .run(async (tx) => {
      await tx.use(kv).setMany([
        { key: 'example:status', value: 'ready' },
        { key: ['example', 1], value: 'first', ttlMs: 60000 }
      ])
      await tx.putRecord({ name: 'Ada' }, 'example:user')
      await tx.use(ttl).expire(lockKey.text('example:status'), 60000)
    })
  console.log(await store.get('example:status'))
  console.log((await store.use(records).query().all()).length >= 1)
} finally {
  await pool.end()
}
```

组织 ID 是 UUID 字符串。同名逻辑键、期限、锁和修订分别隔离；默认组织与其它组织共用物理表。`host.dropOrg(id)` 删除该组织的托管行，不删除其它组织或应用表。显式组织视图不允许任意 SQL、COPY 或自有向量表检索。

`getMany` 保留顺序、重复位置，缺失位置为 `undefined`。等价重复写键在 I/O 前拒绝。空批不做原生操作，也不调用 pipeline/hooks。省略 `ttlMs` 时保留活值的期限，新值没有期限；零立即过期。期限和锁使用数据库时钟。`counter.increment` 只接受规范十进制文本与安全整数，在写入前拒绝溢出。

默认根视图可使用 `store.sql`、`tx.sql` 访问应用表。插值是绑定参数；标识符使用 `@migaia/storage-host/authoring/sql` 的 `sqlFragment.id`。同一事务可以混用应用 SQL 与标准存储方法。应用表的租户过滤由调用方提供。记录字段查询在客户端求值，原生规范键范围限制扫描。

事务请求 READ COMMITTED，检测会报告实际隔离级别。40001/40P01 经确认回滚后可能重试：观察到的修订没变时内部重放，变了才进入所选冲突策略。回调可能再次执行，外部副作用没有恰好一次保证。COMMIT 发出后连接中断不会盲目重放；提交标记可证明已提交，查不到或读失败都不能证明零写入。

## 向量检索

先配置 `vector` 扩展。这里还选择 `halfvec` 量化召回，必要时会准备表达式索引；数据库与扩展版本必须支持它。输出取决于实际 ANN 候选，不承诺命中数量。

```ts doc-test=run
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
import { pgQuantizedFeature } from '@migaia/storage-plugin-postgres/features/quantized'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool) },
        { vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode: 'halfvec' }) }
      )
    ] as const
  })
  const items = host
    .backend('postgres')
    .use(vector)
    .collection<{ category: string }>('example-documents', { dimensions: 3, metric: 'cosine' })
  await items.upsert([{ id: 'guide', vector: [1, 0, 0], payload: { category: 'guide' } }])
  const hits = await items
    .near([1, 0, 0])
    .where({ category: 'guide' })
    .topK(20)
    .rescore({ topN: 5 })
    .all()
  console.log(hits.some((hit) => hit.id === 'guide'))
} finally {
  await pool.end()
}
```

新建集合需要 `dimensions` 和 `metric`。metric 为 `cosine`、`dot`、`euclid`，分数分别为 `1-distance`、`-distance`、`-distance`。原向量存为 FLOAT32。`near(query, { exact: true })` 只对当前读取禁用 ANN；显式接 `rescore` 则选择量化召回。没有 `rescore` 时使用数据库现有计划和索引，单选 pgvector 不创建 ANN 索引。

量化模式在安装时选 `halfvec` 或 `binary_quantize`。`topK(k)` 限定候选数，`rescore({ topN })` 按原向量精确重排这些候选。topN 默认 k，必须是正安全整数且不超过 k。结果可以选字段、分组、通用 rerank，但不能删除、监听或再次 rescore，也不会隐式补读向量。

组织、期限及可下推 payload 条件进入原生召回过滤。ANN 过滤不保证最终足 k 条。JS 谓词仅过滤实际命中，不补搜；`requirePushdown()` 在 I/O 前拒绝需要客户端求值的条件。量化可能损失精度或发生原生转换错误。halfvec 索引最多4000维，binary 索引最多64000维，但原 vector 列最多16000维；这是上限，不是推荐配置。

同 schema/prefix/name 的集合配置跨组织、host 共享。dropOrg 保留配置和表结构。托管 `deleteWhere` 返回实际删除行数，包括物理尚在的过期匹配点。独立的 `api.pgvector.search` 接受结构化自有表目标和原生计划选项，不会把应用表变成托管集合。

## 导入数据并发送通知

示例创建应用表，导入两行 CSV，并把存储状态与通知放在同一次提交中。连接正常收到通知时预期输出 `done`；LISTEN 断线期间可能丢通知。

```ts doc-test=run
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgCopyFeature } from '@migaia/storage-plugin-postgres/features/copy'
import { pgListenFeature } from '@migaia/storage-plugin-postgres/features/listen'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool) },
        { copy: pgCopyFeature(), listen: pgListenFeature() }
      )
    ] as const
  })
  const store = host.backend('postgres')
  await store.sql`CREATE TABLE IF NOT EXISTS app_example_import(name TEXT)`.run()
  const message = Promise.withResolvers<string>()
  await using subscription = await store.api.notifications.listen('example_ready', message.resolve)
  await store.transaction(async (tx) => {
    await tx.api.copy.from(
      { table: ['app_example_import'], columns: ['name'] },
      async function* () {
        yield new TextEncoder().encode('Ada\nLin\n')
      }
    )
    await tx.set('example:import', 'done')
    await tx.api.notifications.notify('example_ready', 'done')
  })
  console.log(await message.promise)
} finally {
  await pool.end()
}
```

COPY 使用结构化表名、列名和返回异步字节流的 source factory。每次真实尝试重新调用 factory，不要传已消费的流。CSV 默认逗号、`header: false`；text 默认 TAB，支持省略 header 或显式 header:false；header:true 会拒绝。服务器文件和 PROGRAM 不支持。失败时先排空原生 COPY，再回滚。事务有 notify 和 COPY，没有 listen。

通知 channel 为非空 UTF-8 名，最多63字节；payload 少于8000字节，两者均拒绝 NUL。listen 返回订阅资源，需要释放。通知只是变化提示，不能证明断线消费者收到了所有提交。

## 持续读取变更

部署方先配置 `wal_level=logical`、REPLICATION 角色与持久 pgoutput slot。publication 必须覆盖当前 schema/prefix 的 `kv`、`bytes`、`records` 表，以及 feed 使用的已创建向量表，并启用 `insert,update,delete,truncate`。`truncate: 'block'` 也需要发布 truncate，才能发现并停止该提交。把已有名称放入 `PG_REPLICATION_SLOT`、`PG_PUBLICATION`。该功能仅支持 PostgreSQL preset 的 `/pg` 驱动，检测不创建这些部署资源。

推荐先用相同 schema/prefix 安装不带复制 Feature 的后端以准备 storage 表，再由部署方创建仅包含所需表的 publication。默认 `public` / `migaia` 布局示例：

```sql
CREATE PUBLICATION migaia_storage_publication
  FOR TABLE public.migaia_kv, public.migaia_bytes, public.migaia_records
  WITH (publish = 'insert, update, delete, truncate');
```

使用托管向量集合时，在下一次读取前用 `ALTER PUBLICATION ... ADD TABLE ...` 加入新建的向量物理表。也可把 storage 放在专属 schema，例如 `storage`，在该 schema 创建后用 `CREATE PUBLICATION migaia_storage_publication FOR TABLES IN SCHEMA storage WITH (publish = 'insert, update, delete, truncate');` 自动包含之后创建的表。专属 schema 只放需要发布的 storage 表；schema publication 也会发布该 schema 的其他合格表。

**准入与迁移：** 旧版本仅接受 `FOR ALL TABLES`；现在统一通过 `pg_publication_tables` 接受显式表、schema 与全部表三种 publication，只要覆盖 feed 的实际表和四种操作。原有启用全部操作的 `FOR ALL TABLES` 部署无需修改。缺表或关闭操作现在以 `UNSUPPORTED_CAPABILITY` 拒绝，并在错误文本中指出表或操作；修正部署后重新检测。旧版本可能接受但不完整发布操作的配置，现在必须补齐四种操作。

[PG16 逻辑解码文档](https://www.postgresql.org/docs/16/logicaldecoding-explanation.html)说明逻辑 slot 对应一个数据库的变更流；[publication 文档](https://www.postgresql.org/docs/16/logical-replication-publication.html)定义发布表与操作范围。逻辑解码仍读取整个数据库的 WAL，publication 只筛选 pgoutput 的输出表。缩小 publication 能减少无关变更的输出和网络量，不会把无关表的变更发给消费者，但不减少 WAL 解码本身的工作，也不能隔离同库 DDL 或保证消除解码错误。

使用已有 slot 时，PostgreSQL 可能需要先读取保留的旧 WAL，tailChanges 才能完成启动，示例随后的写入也会等待。启动耗时取决于积压，请先检查 confirmedFlushLagBytes 和 retainedWalBytes；不要为运行示例重置或共用生产 slot。

示例从当前进度开始，清理应用缓存并把已处理失效信息追加到文件。文件追加失败会使回调拒绝。没有 orgId 的 reset 必须处理为全组织失效。

```ts doc-test=run
import { appendFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgLogicalReplicationFeature } from '@migaia/storage-plugin-postgres/features/logical-replication'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    report: console.error,
    hooks: { onCapabilityProbe: (facts) => console.log(facts.retainedWalBytes) },
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool) },
        {
          replication: pgLogicalReplicationFeature({
            slot: process.env.PG_REPLICATION_SLOT!,
            publication: process.env.PG_PUBLICATION!
          })
        }
      )
    ] as const
  })
  const store = host.backend('postgres')
  const caches = new Map<string, Map<string, string>>()
  const received = Promise.withResolvers<void>()
  await using tail = await store.use(durableChangeFeed).tailChanges({
    from: 'now',
    onChange: async (change) => {
      if (change.kind === 'reset' && change.orgId === undefined) {
        for (const cache of caches.values()) cache.clear()
      } else if (change.orgId !== undefined) caches.get(change.orgId)?.clear()
      await appendFile('./example-invalidations.ndjson', JSON.stringify(change) + '\n')
      received.resolve()
    },
    onError: (error) => {
      received.reject(error)
    }
  })
  await store.set('example:feed', 'ready')
  await received.promise
} finally {
  await pool.end()
}
```

`truncate` 默认 `reset`。根流每个 TRUNCATE 提交只发一条无 orgId 的 `kind: 'reset'`，需要清除全部组织缓存；组织流得到该组织自己的 reset。其它无 orgId 的非 reset 事件不能自动当全局事件。选择 `truncate: 'block'` 时停止、报告且不确认该提交。

`onChange` 成功才允许确认；回调拒绝就停止，不确认该提交。轮询 `readChanges({ after, limit })` 返回 `{ changes, cursor }`。先完成派生写入，再保存 cursor，下次把已保存 cursor 传回 after，才确认完整进度。游标可能包含部分提交进度，不要解析、修改或自行加减位置。slot 丢失或历史不再可证明连续时抛 `CHANGE_CURSOR_EXPIRED`，一个 slot 只允许一个活跃消费者。

`onCapabilityProbe` 带出十进制字符串 `confirmedFlushLagBytes`（当前 WAL 位置减已确认位置）、`retainedWalBytes`（当前位置减 slot restart 位置）及 `maxSlotWalKeepSize`。无限保留值 `-1` 经 reporter 发出警告，不使检测失败，也不修改服务端设置。延迟和保留量都要关注，断开的 slot 可能持续占用磁盘。

释放 tail 或 host 只结束复制连接，不关闭 pool、不删除 slot/publication。没有持续流需求时不要保留 slot，可用 TTL 或定时同步。删 slot 是单独的管理操作；`api.logicalReplication.dropSlot()` 存在，但不是默认清理步骤。

## 行为边界

宿主默认自动检测。设置 autoDetect:false 后，使用所选功能前应先 await host.detect()；托管向量首次实际使用仍会检查扩展。

- 默认 `server: 'postgres'`、schema `public`、prefix `migaia`；driver 必填。`maxLockMs` 默认60000ms并限定租约，`concurrency` 选择冲突策略。cockroach、yugabyte 需要实际服务检测；协议连接成功不等于 PostgreSQL 专属功能可用。
- `/pg` 借用 Pool，`/postgres-js` 借用 postgres.Sql，`/bun` 借用 Bun 1.4.4+ 且 prepare:false 的 SQL。先结束 host，再关闭相应客户端。根入口不加载驱动；复制额外需要 Node 22+ 及声明的复制 peer。能力检查不表示每个服务和运行时组合都已实际验收。
- 文本、记录使用支持 Map/Set 的便携集合编码，字节复制。记录键用规范保序字节，其它通道用同一身份的 hex。文本/字节缺失为 null，记录/metadata 缺失为 undefined。私有表不能当应用 SQL 接口；JSONB payload 只是过滤投影。
- SQL 的 int8 返回 bigint，numeric/date/JSON/array 保留原生文本，bytea 返回独立 Uint8Array。不安装全局 parser。postgres.js 字符串参数使用 TEXT，需要其它类型时由应用 SQL 显式转换。
- 本包错误 source 为 storage.backend.postgres，码为 SQL_FAILED、DECODE_FAILED、TRANSACTION_FAILED、DUPLICATE_KEY。校验、取消、期限和并发错误保留各自 source；原错误可沿 cause 或 aggregate errors 找到。观察回调错误只报告；要改变操作，请用 pipeline。
- 宿主 journal 显式启用日志。text/bytes/record/托管 vector 的完整镜像及绝对期限在数据事务内捕获；外置 binlog 在提交后追加并等待完成，失败只报告，不能撤回数据。完整镜像模式在执行前拒绝原生 SQL、COPY、自有向量表终点。
- 原生日志在每个数据库事务内串行更新 head/record，不跨操作缓存索引。外置 WAL 先写 intent，再随数据写独立 marker，重开时区分已提交和未完成修改。undo 仅在宿主支持的日志组合中出现，先锁定全部目标并核对完整修订和镜像，再恢复；组织重建不让旧镜像重新有效，缺少 birth 的旧镜像以 UNDO_CONFLICT 拒绝，不能跨组织恢复。
- 日志按执行顺序保留重复写和中间值。undo 核对最终修订、恢复原绝对期限，不刷新已过期期限。telemetry 独立启用，每个根操作或完整事务跨重试只发一条完成事件，不接管 logger；先释放 host，再释放 logger 及其载体。
