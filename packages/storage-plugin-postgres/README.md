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
