# SQLite 使用指南

通过 `@migaia/storage-host` 安装原生 SQLite 后端。Node 与 Deno 使用
`node:sqlite`；Bun 使用 `bun:sqlite`。包根不会加载驱动，也不依赖 npm 原生 addon。

## 安装

```ts
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver('./settings.sqlite')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const storage = host.backend('sqlite')
await storage.set('theme', 'dark')
console.log(await storage.get('theme'))
```

先创建 connection，再创建 host，释放时先结束 host。store 只独占借用 driver，
不关闭连接。每个 driver 同时交给一个 store；多个连接可以使用同一文件。
`table` 缺省 `migaia`，不同前缀隔离物理表。

Bun 从 `/bun` 导入 `bunSqliteDriver`。Deno 也使用 `/node`，需要数据库及日志文件
的读写权限。Node 要求运行时内置 SQLite（Node 24 或更新版本）。子路径是明确的
运行时要求，不自动探测或回退到其它驱动。

## 数据与 SQL

store 提供文本、字节、记录、有序记录迭代、同步文本方法、metadata、完整原生事务
及绑定的 SQL 标签。`kv`、`records` 使用 `@migaia/storage-contract` 的原令牌；
记录查询复用其真实 `where`/`select`/`all` 执行器，并如实标明客户端求值。

文本和字节缺失返回 `null`，记录和 metadata 缺失返回 `undefined`。`keys()` 只列
文本通道的字符串 key。删除指定通道不影响其它通道；`clearAll()` 保留 metadata。
跨通道同 key 写入报 `DUPLICATE_KEY`；显式选择 `{ conflictPolicy: 'replace' }`
才在同一原子段替换。同通道更新直接覆盖。

文本通过现有 JSON codec 保留 NUL 与孤立 UTF-16 代理项。记录及 metadata 使用
collections codec，保留 Map/Set。不可 portable 的值在改表前拒绝。输入和输出
字节均复制；键使用唯一规范保序编码。

```ts
import { sqlFragment } from '@migaia/storage-contract'

await storage.sql`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT)`.run()
await storage.transaction(async (tx) => {
  await tx.sql`INSERT INTO users VALUES(${1}, ${'Ada'})`.run()
  await tx.set('user-count', '1')
})
const rows = await storage.sql<{ id: number; name: string }>`
  SELECT id, name FROM ${sqlFragment.id('users')} WHERE id = ${1}
`.all()
```

插值均作为绑定参数，标识符通过 `sqlFragment.id` 引用，共同片段支持组合与 join。
SQL 只接受单条语句及可选末尾分号；事务控制、journal_mode 修改在驱动前拒绝。
提交与回滚通过 `transaction`；含内部语句列表的完整 trigger body 不在此入口范围。
行类型是调用方声明，不验证列名、不转换 Date。

安全整数归一为 number，其余整数保持精确 bigint。boolean 输入绑定为 0/1；BLOB
返回独立 Uint8Array。run 的 changes 与 lastInsertRowid 均为 number | bigint。
每实例 statement LRU 最多 64 项；Node 淘汰引用不代表立即 finalize 原生 statement。

## 并发与连接归属

文件库缺省 wal:true，安装会请求并确认实际 WAL。wal:false 复用宿主进程内逻辑锁
与修订事实，同时保留原生 BEGIN/COMMIT/ROLLBACK；不创建锁表/修订表，不承诺
跨进程逻辑锁。内存库缺省 false，显式 true 报错；已有 journal_mode=OFF 的连接拒绝。

通过 `storage.tx().lock(lockKey.text('key')).run(...)` 与 contract 的策略配置并发。
只有同一逻辑键才冲突；SQLite writer 串行属于物理等待，fail 策略也不会把它当冲突。
inspectLocks 返回真实持锁方与过期信息。WAL 租约 maxLockMs 缺省 30,000 ms，
没有 heartbeat。取消是协作式；接受的原生工作真实结束或回滚后才释放资源，不能
抢占忽略取消的回调。

本连接被事务占用时，根读取、同步方法与根 SQL 报 TRANSACTION_FAILED，应使用 tx。
回调结算后旧 tx 失效；已准入操作与最终检查使用原拥有者的新短视图。被 catch 或
未 await 的数据失败仍使事务回滚。tx.sql 与 KV 始终处于同一个原生事务；不会从
用户 SQL 文本猜测逻辑键。

所有托管表以 org_id 作为主键第一列。根原生 SQL 属于调用方 schema 访问；自建表的
组织过滤由调用方显式提供，不能直接修改内部表。

## 维护与错误

从 `/features/maintenance` 导入 sqliteMaintenanceFeature，并放入插件第二参数。
它经原 SQL 标签增加 `storage.api.maintenance.backup(path)` 与 vacuum；tx 没有维护
入口。backup 使用 VACUUM INTO，不预删、不覆盖目标；原生失败可能留下不完整目标。
同步维护开始后，取消不能声称文件未被写入。

本包错误 source 为 @migaia/storage-plugin-sqlite，码为 SQLITE_FAILED、
TRANSACTION_FAILED、DUPLICATE_KEY 或 DECODE_FAILED。原生/codec 错误保留在 cause；
回滚也失败时 AggregateError.errors 第一项保留原主错。校验、取消与并发沿 contract
原码。解码失败不自动改写损坏数据。

显式 dispose 重复返回同一 Promise；符号释放使用不同的缓存 Promise，报告失败后
成功，共享一次真实清理。始终先释放 host/store，再释放调用方拥有的 connection。
清理失败后 store 仍然终止。
