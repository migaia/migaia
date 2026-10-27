# SQLite 使用指南

[English](./USEGUIDE.en.md)

Node 24+ 使用下列完整示例；Bun 把驱动入口换为 `/bun` 的 `bunSqliteDriver`。文件示例会写入当前目录，先确认目录可写。先创建 connection，再创建 host，离开作用域时会先释放 host。

## 按场景查找

| 问题                       | 场景                                                            |
| -------------------------- | --------------------------------------------------------------- |
| 值、记录与期限需要共同保存 | [一起保存值和期限](#一起保存值和期限)                           |
| 应用表和 KV 必须共同回滚   | [把应用 SQL 和存储修改一起提交](#把应用-sql-和存储修改一起提交) |
| 需要一个独立备份文件       | [备份数据库文件](#备份数据库文件)                               |
| 多连接写入或取消等待       | [并发与取消](#并发与取消)                                       |

## 一起保存值和期限

示例在文件中使用固定组织，预期输出 `ready`、`1`、`true`。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { kv, records, ttl, counter } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
await using connection = nodeSqliteDriver('./example-settings.sqlite')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const store = host.org('10000000-0000-4000-8000-000000000001').backend('sqlite')
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
    await tx.set('example:count', '0')
    await tx.use(counter).increment('example:count')
  })
console.log(await store.get('example:status'))
console.log(await store.get('example:count'))
console.log((await store.use(records).query().all()).length >= 1)
```

组织 ID 是 UUID。所有组织共用连接和物理表；逻辑键、期限、修订与锁按组织隔离。访问组织不会开新连接或创建新表。`host.dropOrg(id)` 只删除相应组织的托管数据，不删除应用表。显式组织视图不提供任意 SQL 或数据库维护。

`setMany` 的 ttlMs 为有限非负毫秒；零立即过期，省略时保留活值期限，新值没有期限。`getMany` 保留输入顺序、重复和缺失位置，缺失为 undefined；重复写键在 I/O 前拒绝。批次写入和删除同事务成功或回滚；删除返回实际数量，分块读取使用同一快照。每批一次 pipeline 和计数观察，空批不做原生操作。

TTL 使用本地 Date.now，值和期限共同写入。覆盖活值保留期限；删除、清空、跨通道替换清掉旧期限。读取、枚举、记录查询会惰性清理过期行，不启动 timer。事务观察过的活值在提交前过期时，会进入冲突处理，不能以旧观察继续提交。counter 从缺失的0开始，只接受规范十进制与安全整数，非法文本和溢出在写入前拒绝。

## 把应用 SQL 和存储修改一起提交

该内存库示例先创建自己的应用表。预期输出为 `Ada`、`1`。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sqlFragment } from '@migaia/storage-host/sdk'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const store = host.backend('sqlite')
await store.sql`CREATE TABLE app_users(id INTEGER PRIMARY KEY, name TEXT)`.run()
await store.transaction(async (tx) => {
  await tx.sql`INSERT INTO app_users VALUES(${1}, ${'Ada'})`.run()
  await tx.set('user-count', '1')
})
const row = await store.sql<{ name: string }>`
  SELECT name FROM ${sqlFragment.id('app_users')} WHERE id=${1}
`.get()
console.log(row?.name)
console.log(store.sync!.get('user-count'))
```

SQL 插值绑定为参数；标识符用 sqlFragment.id，组合片段使用同一 SQL 工具。只接受单条语句及可选末尾分号；事务控制和 journal_mode 修改会拒绝，请使用 transaction。带内部语句列表的完整 trigger body 不在此入口范围。行类型由调用方声明，不检查列名或转换 Date。

安全整数读为 number，其余整数保留 bigint。boolean 输入绑定成0/1，BLOB 返回独立 Uint8Array。run 的 changes、lastInsertRowid 是 number或bigint，SQLite 总有 lastInsertRowid。标准 sql 令牌与原生 store.sql 使用同一标签。Statement 缓存最多64项；Node 缓存淘汰不代表立即 finalize。

事务占用连接时，根读取、同步方法与根 SQL 报 TRANSACTION_FAILED；请在回调内使用 tx。回调结束后 tx 失效；未 await 或已 catch 的操作失败仍使事务回滚。取消后也要等已开始的原生工作结束，再回滚和释放锁，不能强行抢占同步语句或忽略取消的回调。

## 备份数据库文件

显式选择维护 Feature。示例写一项状态，并创建一个新的备份文件；预期输出 `ready`。每次使用不同文件名，避免覆盖。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { sqliteMaintenanceFeature } from '@migaia/storage-plugin-sqlite/features/maintenance'
await using connection = nodeSqliteDriver('./example-settings.sqlite')
await using host = await createStorageHost({
  plugins: [
    sqliteBackendPlugin({ driver: connection }, { maintenance: sqliteMaintenanceFeature() })
  ] as const
})
const store = host.backend('sqlite')
await store.set('example:backup', 'ready')
await store.api.maintenance.backup(`./example-backup-${crypto.randomUUID()}.sqlite`)
console.log(await store.get('example:backup'))
```

backup 使用 VACUUM INTO，要求目标不存在且路径可写，不预删、不覆盖。原生失败可能留下不完整文件；取消也不能证明文件未被写入。vacuum 整理当前库。维护只在根 store.api.maintenance 出现，不在 tx.api 或组织视图出现。应用自定义 Feature 可以选择事务 API；其 SQL 和 KV 同事务，失败不会被方法外层 catch 掩盖。

## 并发与取消

文件库默认 wal:true，安装会请求并确认实际模式；已有 journal_mode=OFF 的连接拒绝。内存库默认 false，显式 true 拒绝。wal:false 保留真实 BEGIN/COMMIT/ROLLBACK，但逻辑锁只协调当前进程，不承诺跨进程。

通过 tx().lock(lockKey.text(...)).run 使用逻辑键锁。锁策略从 `@migaia/storage-host/sdk` 选择。只有相同逻辑键才产生逻辑冲突；SQLite writer 串行等待不是业务键冲突。inspectLocks 返回实际持锁方和过期信息。maxLockMs 默认30000ms，无 heartbeat，取消是协作式。

## 数据与错误边界

文本、字节、记录分别保存，但同键跨通道写入默认 DUPLICATE_KEY。明确 conflictPolicy:'replace' 才原子替换；同通道更新直接覆盖。文本/字节缺失为 null，记录/metadata 缺失为 undefined。keys 只列文本字符串键，clearAll 保留 metadata，单通道清空不影响其它通道。文本可保留 NUL 和孤立 UTF-16 代理项；记录/metadata 使用支持 Map/Set 的集合编码，非便携值在改表前拒绝，字节读写复制。

driver 必填；table 默认 migaia；concurrency 选择冲突策略，maxLockMs 是锁期限。一个 store 独占使用 driver，但不负责关闭它。多连接可共用文件，不能同时把同一 driver 交给两个 store。Feature 借用的 exec/prepare 客户端不含关闭权。dispose 重复返回相同主 Promise，符号释放有独立的报告型 Promise，两者共享一次清理；失败后仍终止。

本包错误 source 为 @migaia/storage-plugin-sqlite，码为 SQLITE_FAILED、TRANSACTION_FAILED、DUPLICATE_KEY、DECODE_FAILED。校验、取消、超时和并发使用共享错误码。原生或编码错误保留在 cause；回滚也失败时，aggregate errors 首项保留主错误。解码失败不自动修补数据。向量和 RDF 不支持，对应锁在原生调用前报 UNSUPPORTED_CAPABILITY；不提供变更流或服务端记录字段索引。

## 可选日志

通过 `@migaia/storage-host/plugins/journal` 的 `storageJournalPlugin(options)` 显式启用。完整值、每次实际修改和绝对期限在 SQLite 事务中捕获，保留同键多写与中间值。undo 先锁定并检查全部目标的最终修订和镜像，再恢复；恢复原绝对期限，不刷新过期数据。组织重建或非 WAL 本地协调组重新打开后，旧镜像不能继续使用。metadata 不产生业务修改日志。

外置 binlog 在提交后写入，失败报告但不能撤回数据。支持的 WAL 组合使用与数据共同提交的 marker，恢复不重放已提交修改。raw SQL 无完整标准镜像目标，选择提交日志时在执行前拒绝。全局 journal 使用异步 pipeline，因此同步入口报 ASYNC_STAGE_IN_SYNC_ENTRY；普通无日志安装仍有同步 API。

`storageLogStore` 从 `@migaia/storage-host/plugins/journal` 单独导入，可在初始化器内打开同库日志。内存连接的同 namespace 日志独占使用，释放后可重开；文件日志每次在 BEGIN IMMEDIATE 中读取当前索引，允许多连接共用。业务 clear 不清私有日志。选中提交日志时，读取触发的惰性过期删除也进入日志；仅遥测或初始化器不启用该写入行为。遥测每个根操作或完整事务只发一条，logger 与日志载体仍由调用方在 host 之后释放。
