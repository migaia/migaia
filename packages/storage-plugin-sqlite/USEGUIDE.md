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

`storage.use(kv)` 原生支持 `getMany`、`setMany`、`removeMany` 与 `removeByPrefix`，
事务内用 `tx.use(kv)` 或对应短方法。批次键接受规范结构键；读取按输入顺序保留重复
位置，缺失返回 `undefined`。重复写键在 I/O 前拒绝；写入与删除在同一原生事务中
提交或回滚，删除返回实际数量。读取和删除的 IN 参数分块，读取分块共享一个原生
快照。每批只有一次 pipeline 与计数 hook；空批仍检查有效期，但不执行这些工作。
`setMany` 的 `ttlMs` 接受有限非负毫秒数，期限与值同事务写入。SQLite 不提供向量
集合或 RDF 图；对应锁在任何原生调用前报 `UNSUPPORTED_CAPABILITY`。

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

标准 `sql` 令牌通过 `storage.use(sql).sql` 复用同一个原生标签；
事务内 `tx.use(sql).sql` 沿原事务拥有者绑定当前短效视图。原生结果、
精确行类型和 SQLite 的必有 lastInsertRowid 保持不变，不增加预算或编译器。

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

`readTransactionOperationContext(tx)` 读取原事务拥有者保存的冻结 attempt context。
组合操作与最终检查复用同一份字段及原实时 signal；不会重读调用方 getter、重置期限
或另建取消控制器。合作取消的异步工作结算后，原生回滚与逻辑锁释放才完成。

选中的 Feature 复用同一事务和查询创建器。`tx.api` 在原事务短视图冻结前绑定；
其 SQL 与 KV 操作一起提交或回滚，被捕获或未 await 的失败也沿原事务拥有者处理。
Feature 的 `query` 和 `tx` 链方法保留在实际派生链上。Feature 借用的原生 client
是同一连接的冻结 `exec`/`prepare` 视图，不含 `dispose` 或符号释放方法；连接仍由
创建调用方释放。

所有托管表以 org_id 作为主键第一列。根原生 SQL 属于调用方 schema 访问；自建表的
组织过滤由调用方显式提供，不能直接修改内部表。

通过 `host.org(orgId).backend('sqlite')` 访问固定组织。缺省组织及其它组织都使用
同一套表；创建组织不执行 DDL，也不另开连接。各组织复用同一个原生准入队列，
数据、期限、锁与修订按 `org_id` 隔离；`host.dropOrg(orgId)` 只删除该组织的托管行。
原生 Feature 借用同一个冻结 client，工厂只安装一次。显式组织视图不提供任意 SQL
或数据库维护；事务内调用这些跨组织入口也会拒绝，并保留原事务错误链。

原生日志通过 `@migaia/storage-host/journal` 的 `storageLogStore(host, 'sqlite',
{ prefix })` 使用。调用方拥有的内存连接在原进程锁中独占该日志 namespace，私有行
与业务键隔离，业务 clear 不清日志；释放日志后可用同一 prefix 重开。文件连接没有
资源整个生存期的可靠独占保证，因此此缓存索引组合在读取日志前报
`UNSUPPORTED_CAPABILITY`。它不影响文件连接的普通原生事务。

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

标准 `ttl` 为 text/bytes/records 提供 expire、remaining、persist，使用本地 Date.now。
期限与值同一原生事务写入；覆盖活值保留期限，删除/clear/替换清除旧期限。
读取、枚举和查询沿原生写路径惰性回收到期行，不启动 timer。
标准 `counter.increment` 在同一原生文本事务内验证规范十进制与安全整数后更新，
缺失从 0 开始；非法文本、非法增量和溢出在写入前拒绝。两项能力均支持 tx.use。

事务首次读取的活值和期限保留原生快照；观察后到期由原提交检查交回既有并发策略，
不能把已过期的观察当作有效提交。迭代跳过首次返回前到期的项，关闭计数只统计实际
返回的项。

全局 `journal` 配置按真实原生修改顺序记录日志，保留同键多写。SQLite 在原事务内保留完整原始值与绝对期限；undo 复用原键锁事务，先核对全部完整修订与 after 镜像，再恢复任一值。外置 binlog 与 undo 可使用既有 WAL；恢复只核对与数据同提交的 marker，不重放已提交的业务修改。文件 WAL 修订行保留不可变 birth，组织删除后重建不会让旧 undo 再次有效。`wal: false` 的修订身份归原存活本地 group，重开 group 会拒绝旧镜像。metadata 写入推进原私有 guard，不作为业务日志。

内存连接可通过 initializer 的 `storageLogStore` 提供同库 binlog 与 undo；文件缓存日志索引仍拒绝，文件数据应配外置 Logger。raw SQL 没有完整共享镜像目标，启用提交日志时在原生执行前拒绝。全局 journal 配置沿宿主既有异步管线边界，所有同步入口报 `ASYNC_STAGE_IN_SYNC_ENTRY`；普通宿主仍保留同步 API。Logger 及日志载体继续归调用方释放。`UNDO_CONFLICT` 等宿主日志错误保留原 source 与 cause。

启用全局 journal 遥测时，每个异步根操作与完整事务各发一条 storage 事件，键来自原生读写实际观察；短效事务操作与私有日志、元数据工作不重复发业务事件。重试仍由原并发循环负责。
