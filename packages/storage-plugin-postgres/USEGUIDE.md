# PostgreSQL 使用指南

先按 README 选择 `/pg`、`/postgres-js` 或 Bun 1.4.4+ 的 `/bun`，把调用方拥有的 driver 交给 postgresBackendPlugin。以下 `store` 均来自唯一宿主的 `host.backend('postgres')`；Feature 必须显式挂在同一插件上。

## 标准批量、期限与组织

```ts
import { kv, ttl, counter, records, lockKey } from '@migaia/storage-contract'

await store.use(kv).setMany([
  { key: ['items', 1], value: 'first', ttlMs: 10000 },
  { key: ['items', 2], value: 'second' }
])
const values = await store.use(kv).getMany([['items', 2], ['items', 1], ['items', 2], 'missing'])
// ['second', 'first', 'second', undefined]
const removed = await store.use(kv).removeByPrefix(['items'])
await store.set('count', '0')
const next = await store.use(counter).increment('count', 1)
await store.use(ttl).expire(lockKey.text('count'), 1000)
const remaining = await store.use(ttl).remaining(lockKey.text('count'))
await store.use(ttl).persist(lockKey.text('count'))
const rows = await store.use(records).query().all()
```

批量按输入序重建重复读取，重复写键在 I/O 前拒绝；所有数组各占一个参数，数据不插入 SQL。TTL=null 元素仅是内部数组载体，公开省略 ttlMs 表示覆盖活值保期限、新值无期限；0 为立即到期。每条时间更新使用数据库采样，不接收客户端绝对期限。

`host.org(validUuid).backend('postgres')` 固定组织，所有标准集合及同名键/期限/锁/通知隔离，组织首次使用不建表。标准 vector/durableChangeFeed 由所选 Feature 在原组织 provider 中发布；原生调用方表接口在组织视图拒绝。记录与原生应用表都可在默认 root 的同一个事务中修改，但 raw SQL 的租户过滤由调用方负责。

## 事务、查询与原生 SQL

```ts
import { ConcurrencyPolicy, lockKey, sql } from '@migaia/storage-contract'

await store
  .tx()
  .lock(lockKey.text('balance'))
  .concurrency(ConcurrencyPolicy.wait())
  .run(async (tx) => {
    const current = Number((await tx.get('balance')) ?? '0')
    await tx.set('balance', String(current + 1))
    await tx.use(sql).sql`SELECT 1`.get()
  })
const json = await store.sql`SELECT ${'{"ready":true}'}::jsonb AS payload`.get()
const search =
  await store.sql`SELECT to_tsvector('simple', ${'hello storage'}) @@ plainto_tsquery('simple', ${'storage'}) AS matches`.get()
```

原生应用表的 JSONB、全文索引、FOR UPDATE、pg_advisory_xact_lock 直接使用 SQL，无附加包装 Feature。标准记录保 portable TEXT，字段查询使用共同 query owner 的客户端语义与原 bytea 键范围。int8 返回 bigint、numeric/date/JSON/array 返回原文本、bytea 返回复制 Uint8Array；不改全局 parser。postgres.js 绑定字符串时显式选 TEXT 类型，避免客户端按目标 OID 再 JSON 序列化；应用 SQL 需要其它类型时写显式 cast。

## 向量

```ts
import { vector } from '@migaia/storage-contract'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
// postgresBackendPlugin({ driver }, { vector: pgvectorFeature() })
const embeddings = store.use(vector).collection('documents', { dimensions: 3, metric: 'cosine' })
await embeddings.upsert([{ id: 'a', vector: [1, 0, 0], payload: { category: 'guide' } }], {
  ttlMs: 10000
})
const hits = await embeddings
  .near([1, 0, 0], { exact: true })
  .where('category', 'eq', 'guide')
  .topK(5)
  .all()
const deleted = await embeddings.deleteWhere({ category: 'guide' }, { count: 'scroll' })
```

cosine、dot、euclid 使用原生 `<=>`、`<#>`、`<->`；score 分别为 1-distance、-distance、-distance。原生 vector(d) 使用 float32，容许相应数值精度与同分换序。先建一次逻辑集合，其它 org 可 `collection('documents')` 使用同一物理配置。`api.pgvector.search({table:['app_vectors'],idColumn:'id',vectorColumn:'embedding',payloadColumn:'payload'}, q, {metric:'cosine',limit:10,efSearch:64})` 只查询调用方已有表；本包不自动建立 ANN 索引。

## COPY 与通知

全局集合配置使用原配置表中的稳定私有 namespace 身份，与各 host 的缺省组织无关；相同 schema/prefix/name 在不同 host 复用同一原生表。dropOrg 只删除目标组织的点行，保留全局配置、其它组织与原生表结构。期限索引同样以 org_id 领先。

```ts
import { pgCopyFeature } from '@migaia/storage-plugin-postgres/features/copy'
import { pgListenFeature } from '@migaia/storage-plugin-postgres/features/listen'
// 显式选择 copy/listen 两个 Feature。
const subscription = await store.api.notifications.listen('app_ready', (payload) =>
  console.log(payload)
)
try {
  await store.transaction(async (tx) => {
    await tx.api.copy.from({ table: ['app_rows'], columns: ['id', 'name'] }, async function* () {
      yield new TextEncoder().encode('1,Ada\n2,Lin\n')
    })
    await tx.set('import', 'done')
    await tx.api.notifications.notify('app_ready', 'done')
  })
} finally {
  await subscription.dispose()
}
```

目标表由应用预建；CSV 缺省 header=false、delimiter=','；text 缺省 TAB 且禁 header。只支持客户端 STDIN，不接受文件或 PROGRAM。sourceFactory 每次真实尝试重新创建，不能捕获已消费的单次流。失败会等真实 COPY 排空后回滚；tx 没有 listen。通知频道非空、UTF8 <=63 字节，载荷 <8000 字节，都拒绝 NUL。

## 持久逻辑复制

```ts
import { durableChangeFeed } from '@migaia/storage-contract'
import { pgLogicalReplicationFeature } from '@migaia/storage-plugin-postgres/features/logical-replication'
// postgresBackendPlugin({ driver: pgDriver(pool) }, { replication: pgLogicalReplicationFeature({ slot, publication }) })
const feed = store.use(durableChangeFeed)
const batch = await feed.readChanges({ after: savedCursor, limit: 100 })
// 处理并持久化 batch.changes 后，再持久化 batch.cursor；下一 after 才确认完整位置。
const tail = await feed.tailChanges({
  from: savedCursor ?? 'now',
  onChange: async (change) => {
    await processAndPersist(change)
  },
  onError: (cause) => console.error(cause)
})
// 使用结束后 await tail.dispose()。仅明确退役部署槽时调用 api.logicalReplication.dropSlot()。
```

部署方设置 wal_level=logical、REPLICATION 角色、持久 pgoutput slot 与 FOR ALL TABLES publication。包只探测，不执行部署 DDL。一个提交按 org 首次 WAL 顺序合并有界失效摘要，不保存业务行。cursor 不透明，包含 store/slot/组织路由、COMMIT 的 commitEndLsn 与已处理组织前缀。部分提交绝不确认该 end，恢复时从原 slot 未确认位置重解并跳过已处理前缀；末项才允许后续 after 或成功 tail 确认。peer 使用 auto:false、timeoutSeconds:0、flowControl:true，绝不确认 row LSN/commitLsn，也不加减1。只允许一个活跃 slot 消费者。

回调失败停止且不上报成功位置；dispose 只释放复制连接，不删 slot、不关 pool。首次空读返回绑定原 native confirmed 位置的完整 cursor；slot lost、已落后于 slot confirmed 的完整 cursor，或已确认到本提交 end 的部分 cursor，均报 CHANGE_CURSOR_EXPIRED，不跳过无法证明的缺口。启动中取消或 native ready 查询失败会拒绝并排空原复制资源。当前 root 的多组织 TRUNCATE 无法从 WAL 推导全部持久 org，安全停止该提交且不确认；组织视图可对自身宽失效。普通 INSERT/UPDATE/DELETE 路径不受影响；该 TRUNCATE 边界待用户复核。

全局 `journal: { logger, namespace, binlogValues: true }` 可借用原 logger 的外置 binlog：本包在原事务内捕获 text/bytes/record/托管 vector 的实际改动和完整期限，真实 COMMIT 后才 append，并等待原 append 结算。外置 append 失败经宿主报告与 `onBinlogAppendError` 观察，不能撤回已经提交的数据；不承诺外置日志与数据原子提交。选用完整镜像时，原生 SQL/COPY/调用者向量表在业务查询或拉取 source 前拒绝。

PostgreSQL 当前有限键租约不能证明日志句柄整个资源期的独占。`storageLogStore`、依赖它的 `atomicBinlog`/`atomicUndo` 组合以 `UNSUPPORTED_CAPABILITY` 在缓存索引与私有 I/O 前拒绝，等待可靠原 namespace reservation 接点；此项为待用户复核的最小隔离。私有 namespace 保留真实同连接 I/O、原 scope 身份和 terminal 回调，不持 BEGIN 到句柄释放，不另建续租器。借用同一 logger 的外置 WAL 时，原共享 owner 先 await intent，再在同一 PG 事务写入独立命名的 commit marker；真实提交后 append/complete，失败保留 intent 与 marker，重开沿原 owner 恢复。此 marker 与 lost-COMMIT 短期证据复用同一私有表但身份不同，正常事务清理不会误删恢复证据。同一 logger 同时选择外置 WAL 与 undoLog 时，宿主才投影 `store.undo(txId, ctx?)`：原 builder 先锁定全部目标，复核完整修订与镜像，再在一个真实 PG 事务恢复 text/bytes/record/vector/metadata 与绝对期限；新提交仍进入原日志。metadata 的日志身份沿原 flat-key codec 往返，版本与私有键锁复用原 revisions/lock owner，ABA 即使值已恢复相同也拒绝。原修订行保存 native `birth` UUID 与递增 `version`；dropOrg 仍删除全部目标组织行，重建的新 birth 阻止旧 undo 复用同版本。已有私有修订表增列时保原值与版本，缺少 birth 的旧外置镜像以 `UNDO_CONFLICT` 安全拒绝。不同组织的日志不能互相恢复。选择 `level()` 的同一 logger 并设置 `telemetry: true` 时，原宿主观察器记录普通 payload、完整原错误、固定组织与规范键；原完整重试循环只发一条，scope 与私有 metadata 不重复记录。关闭该选项不读取 level 方法，日志失败只报告。

每次原生提交先写同事务 marker。COMMIT 应答丢失后仅在原 marker 可见时认定已提交；缺失或读取失败不证明零写，本包封闭原物理 controller，保留原错误链且不盲重放。正常结算后删除该 marker；清理失败只报告并保留证据。

选中日志时按执行顺序保留每次实际原生变更，包含同目标多写与中间值。原 SQL 的 RETURNING 行直接提供每次完整 raw 新值与绝对期限，不以后读的最终值替代。undo 仍由 host 原实现合并首次 before、最终 after 并复核完整最终修订；未选日志的操作保原 SQL 与原生路径。
