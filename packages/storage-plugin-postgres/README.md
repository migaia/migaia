# @migaia/storage-plugin-postgres

通过唯一 storage-host 安装 PostgreSQL 后端。标准 kv、bytes、records、ttl、counter、sql、事务、键锁与 PostgreSQL 变更提示使用同一原生连接及原契约拥有者。调用方拥有 driver/client/pool；先释放 host，再关闭客户端。

```ts
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [postgresBackendPlugin({ driver: pgDriver(pool) })] as const
  })
  const store = host.backend('postgres')
  await store.transaction(async (tx) => {
    await tx.set('status', 'ready')
    await tx.putRecord({ name: 'Ada' }, 'user:1')
    await tx.sql`SELECT 1`.get()
  })
} finally {
  await pool.end()
}
```

## 适配与能力

| 入口           | 注入对象                               | 原生协议                                   |
| -------------- | -------------------------------------- | ------------------------------------------ |
| `/pg`          | `pg.Pool`                              | pg-copy-streams、专用 LISTEN、可选逻辑复制 |
| `/postgres-js` | `postgres.Sql`                         | reserve、原生 COPY、共享专用监听           |
| `/bun`         | Bun 1.4.4+ `SQL`，配置 `prepare:false` | reserve、原生 WritableStream COPY、监听    |

包根不加载任何客户端。适配入口分别引用真实 peer；逻辑复制还要求 Node 22+ 与 pg-logical-replication >=2.6.0 <3。Bun 1.4.3 在 I/O 前拒绝，因为缺少所需 COPY 与字段元数据。

```ts
import postgres from 'postgres'
import { postgresJsDriver } from '@migaia/storage-plugin-postgres/postgres-js'
const client = postgres(process.env.DATABASE_URL!)
const driver = postgresJsDriver(client)
// 释放 host 后由调用方 await client.end()
```

```ts
import { SQL } from 'bun'
import { bunSqlDriver } from '@migaia/storage-plugin-postgres/bun'
const client = new SQL(process.env.DATABASE_URL!, { prepare: false })
const driver = bunSqlDriver(client)
// 释放 host 后由调用方 await client.close()
```

`server` 缺省 `postgres`，另外支持按实际版本探测的 `cockroach`、`yugabyte`。只有 PostgreSQL 声明 changeFeed；Cockroach 不支持 pgvector Feature。兼容协议不等于经过真实服务验收：本次环境只有 PostgreSQL，另两项仍未验证。当前本机 Bun 为 1.4.3，因此 1.4.4+ 原生路径仍未验证。

## 可选 Feature

- `/features/quantized`：同批选择 `pgvectorFeature()` 与 `pgQuantizedFeature({mode:'halfvec'|'binary_quantize'})`，只增强有界向量链的 `rescore({topN?})`，量化表达式 HNSW 召回后按原向量精排，不发布第二个 vector provider。
- `/features/pgvector`：`pgvectorFeature()` 发布标准 vector，另有 `api.pgvector.search(target, query, options)` 查询调用方自有表。未选不发布 vector；扩展经 registerDetect 检查。`autoDetect:false` 时仍在首次真实向量终点写前核对扩展。
- `/features/listen`：`pgListenFeature()` 发布根 `api.notifications.listen/notify`；事务只有 notify。提示只在真实提交后出现，不保证断线重放。
- `/features/copy`：`pgCopyFeature()` 发布根/事务 `api.copy.from`。只支持结构化目标与客户端 STDIN；每次实际尝试调用新的 sourceFactory，保留背压与原生排空。
- `/features/logical-replication`：`pgLogicalReplicationFeature({slot,publication})` 发布 durableChangeFeed。部署方预建持久 pgoutput slot、FOR ALL TABLES publication 与 REPLICATION 权限；只支持 postgres preset 与 `/pg`。dispose 不删除 slot。

向量为真实 `vector(d)`，默认使用数据库计划及已有 ANN 索引；`exact:true` 仅在当前读事务禁用 ANN。可忠实下推的 where、org、期限先过滤再 topK。函数条件只处理命中，不补搜；requirePushdown 在 I/O 前拒绝客户端条件。deleteWhere 三种 count 模式均使用 DELETE RETURNING 的实际数，包括物理仍存在的过期匹配点。

## 存储与错误

配置缺省 schema=`public`、prefix=`migaia`。kv/bytes/records/meta/revisions/locks/journal/commit_markers/vector_config 以及托管向量表均以 `(org_id,key)` 为主键，索引以 org_id 领先。记录使用 bytea 规范键，其它表为原规范字节的 hex TEXT；文本与记录使用原 portable/collections TEXT codec。payload 的 JSONB 仅为可下推投影。

锁和 TTL 使用数据库 clock_timestamp()。活值覆盖保留 TTL，过期删除保留修订墓碑。数组绑定实现批量接口；空批不建立事务或触发 pipeline/hooks。组织共表，同名键隔离；组织视图拒绝 raw SQL/COPY 自有表终点。

事务请求 READ COMMITTED，SHOW 报告实际级别。可信 40001/40P01 真正回滚后检查原修订：未变内部物理重放、不重入外层 pipeline、不调用策略、保留原锁行；变化才交原 WRITE_CONFLICT 策略。回调可能重放，外部副作用没有 exactly-once 保证。COMMIT 发送后的传输失败不自动重放，也不声称零写。

本包错误 source 为 `storage.backend.postgres`：SQL_FAILED、DECODE_FAILED、TRANSACTION_FAILED、DUPLICATE_KEY；共享准入、并发、取消、期限错误沿原契约常量。原错误保留在 cause 链。hooks 只观察，抛错或异步拒绝只报告；干预使用 host pipeline。

更多批量、原生 SQL、向量、COPY、复制场景见 [USEGUIDE](./USEGUIDE.md)。

全局 `journal: { logger, namespace, binlogValues: true }` 可借用原 logger 的外置 binlog：本包在原事务内捕获 text/bytes/record/托管 vector 的实际改动和完整期限，真实 COMMIT 后才 append，并等待原 append 结算。外置 append 失败经宿主报告与 `onBinlogAppendError` 观察，不能撤回已经提交的数据；不承诺外置日志与数据原子提交。选用完整镜像时，原生 SQL/COPY/调用者向量表在业务查询或拉取 source 前拒绝。

PostgreSQL 的 storageLogStore 使用 indexExclusive:false，每操作在原生事务内读取当前日志，不保留跨操作索引。现有 journal 表主键通过 INSERT ON CONFLICT DO NOTHING 初始化缺失 head 行，随后 SELECT FOR UPDATE 在同一事务内串行读写；不增加表、资源期锁或续租器。nativeAtomic 与原 scope/terminal 保持，40001/40P01 仍走原物理重试。借用同一 logger 的外置 WAL 时，原共享 owner 先 await intent，再在同一 PG 事务写入独立命名的 commit marker；真实提交后 append/complete，失败保留 intent 与 marker，重开沿原 owner 恢复。此 marker 与 lost-COMMIT 短期证据复用同一私有表但身份不同，正常事务清理不会误删恢复证据。同一 logger 同时选择外置 WAL 与 undoLog 时，宿主才投影 `store.undo(txId, ctx?)`：原 builder 先锁定全部目标，复核完整修订与镜像，再在一个真实 PG 事务恢复 text/bytes/record/vector/metadata 与绝对期限；新提交仍进入原日志。metadata 的日志身份沿原 flat-key codec 往返，版本与私有键锁复用原 revisions/lock owner，ABA 即使值已恢复相同也拒绝。原修订行保存 native `birth` UUID 与递增 `version`；dropOrg 仍删除全部目标组织行，重建的新 birth 阻止旧 undo 复用同版本。已有私有修订表增列时保原值与版本，缺少 birth 的旧外置镜像以 `UNDO_CONFLICT` 安全拒绝。不同组织的日志不能互相恢复。选择 `level()` 的同一 logger 并设置 `telemetry: true` 时，原宿主观察器记录普通 payload、完整原错误、固定组织与规范键；原完整重试循环只发一条，scope 与私有 metadata 不重复记录。关闭该选项不读取 level 方法，日志失败只报告。

每次原生提交先写同事务 marker。COMMIT 应答丢失后仅在原 marker 可见时认定已提交；缺失或读取失败不证明零写，本包封闭原物理 controller，保留原错误链且不盲重放。正常结算后删除该 marker；清理失败只报告并保留证据。

选中日志时按执行顺序保留每次实际原生变更，包含同目标多写与中间值。原 SQL 的 RETURNING 行直接提供每次完整 raw 新值与绝对期限，不以后读的最终值替代。undo 仍由 host 原实现合并首次 before、最终 after 并复核完整最终修订；未选日志的操作保原 SQL 与原生路径。

## 量化召回与原生精排

```ts
import { pgQuantizedFeature } from '@migaia/storage-plugin-postgres/features/quantized'
// postgresBackendPlugin({ driver }, {
//   vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode: 'halfvec' })
// })
const selected = await embeddings
  .near([1, 0, 0])
  .where({ category: 'guide' })
  .topK(20)
  .rescore({ topN: 5 })
  .rerank(({ hits }) => hits.map((hit) => hit.score))
  .all()
```

安装时选择 halfvec 或 binary_quantize。topN 缺省为 k，必须是正安全整数且不超过 k，非法值在 I/O 前拒绝。只读结果保留 withVector、选择、分组与通用 rerank，引擎 score 不变；不能删除、监听或再次接原生 rescore，不会隐式补读向量。

原 schema owner 按 metric 建 halfvec opclass 或 bit_hamming_ops 表达式 HNSW；原事务锁住既有集合配置行，两个 host 可安全准备同一个索引。布局检查与索引准备是独立原生语句，业务查询则只用一条 MATERIALIZED SQL 召回 k 个候选，再按原向量精确排序取 topN。临时 metric 会准备相应索引；样本来源仍先沿原拥有者读取样本，再执行召回与精排语句。显式 rescore 即选择量化召回，即使 near 指定 exact；未接 rescore 的 near({exact:true}) 保持原行为。

org、期限与可推 payload 条件均留在 recall WHERE。HNSW 不保证物理先过滤，也不保证过滤后足 k；JS 谓词只处理 outer 命中且不补搜，后接 rerank 收到这些实际命中。显式量化 ANN 是普通 org 领先索引规则的例外。原向量仍为 float32，halfvec 索引最多 4000 维，binary 索引最多 64000 维但原 vector 列最多 16000 维；量化可能损失精度，超出 halfvec 范围的原生 cast 以 SQL_FAILED 保留原 cause，不假称无损。未新增依赖或后台任务。
