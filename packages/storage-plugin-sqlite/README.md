# @migaia/storage-plugin-sqlite

[English](./README.en.md)

当本地设置、离线记录和缓存需要一起保存时，本包把文本、记录、过期时间与应用 SQL 统一放进运行时内置的 SQLite 事务，避免多个更新只成功一部分。选择 Node 或 Bun 对应的驱动和数据库文件，再把插件安装到 host；无需另装 npm 原生数据库扩展，连接由应用创建和关闭。

## 你可能遇到过

- 本地设置写了一半：几个更新各自提交，中途失败没有回滚。
- 两个进程同时改同一项：只有内存锁，另一个进程看不到。
- 到期缓存仍被当成有效数据：值和期限分开保存，读取时没有统一处理。
- 事务还在运行，根查询却抢了连接：同一连接混用了事务内外操作。

## 为什么选它

- **数据与期限一起写。** 批量值、记录和 TTL 在同一个原生事务内更新，见[一起保存值和期限](./USEGUIDE.md#一起保存值和期限)。
- **应用 SQL 与存储方法共用事务。** 使用同一 tx，SQL 与 KV 可以共同提交或回滚，见[把应用-sql-和存储修改一起提交](./USEGUIDE.md#把应用-sql-和存储修改一起提交)。
- **连接释放顺序明确。** 你创建连接，host 使用它；先释放 host，再释放连接。Node/Bun 使用各自内置模块，不增加 npm 原生 addon。
- **并发限制说清楚。** 文件 WAL 模式支持跨连接逻辑锁；非 WAL 模式只在当前进程协调，见[并发与取消](./USEGUIDE.md#并发与取消)。不以此声称更快。

## 从这里开始

下面在真正的 SQLite 内存数据库中写入并读取。持久保存时把 `:memory:` 换成文件路径。Node 需要24或更新版本。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const store = host.backend('sqlite')
await store.set('theme', 'dark')
console.log(await store.get('theme'))
```

预期输出：

```text
dark
```

多项数据共同保存，看[一起保存值和期限](./USEGUIDE.md#一起保存值和期限)；文件备份看[备份数据库文件](./USEGUIDE.md#备份数据库文件)。

## 手写时的隐患

下面假定应用表已存在，只展示，不执行。

```ts doc-test=check
import { DatabaseSync } from 'node:sqlite'
export function save(database: DatabaseSync, name: string) {
  database.prepare('INSERT INTO app_users(name) VALUES(?)').run(name)
  // 第二条语句失败时，第一条已经提交。
  database.prepare('UPDATE app_counts SET count=count+1').run()
  // 事务期间误用另一个根入口，可能打乱同一连接上的工作。
}
```

使用 `store.transaction`，并且在回调里只使用 tx。被捕获或未 await 的数据操作失败，仍会使该事务回滚。

## 三分钟心智模型

| 要做什么                      | 使用什么                                   |
| ----------------------------- | ------------------------------------------ |
| 打开与关闭 SQLite 文件        | `/node` 或 `/bun` 创建的 connection        |
| 使用文件中的标准存储          | host 安装后的 `backend('sqlite')`          |
| 选择 KV、记录、SQL、TTL、计数 | `store.use(token)`                         |
| 多项操作共同提交              | `transaction` 或 `tx().lock(...).run(...)` |
| 备份和整理文件                | 显式选择维护 Feature                       |

能力令牌标识一组方法；Feature 是额外安装的功能。WAL 是 SQLite 把变更先记入旁边日志文件的模式，允许本包通过共享文件协调逻辑锁。

## 典型场景

| 场景                 | 怎么组合           | 详细说明                                                          |
| -------------------- | ------------------ | ----------------------------------------------------------------- |
| 多租户本地缓存       | org + kv + ttl     | [一起保存值和期限](./USEGUIDE.md#一起保存值和期限)                |
| 业务表与设置共同更新 | tx.sql + tx.set    | [SQL 与存储共同提交](./USEGUIDE.md#把应用-sql-和存储修改一起提交) |
| 导出可重新打开的备份 | maintenance.backup | [备份数据库文件](./USEGUIDE.md#备份数据库文件)                    |

## 安装

当前包 `private: true`，用于本仓库工作区。它不是公共 registry 发布承诺。消费包中添加：

```bash
pnpm add @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-sqlite --workspace
```

Node 24+ 与 Deno 使用 `/node` 的 `nodeSqliteDriver(path)`；Bun 使用 `/bun` 的 `bunSqliteDriver(path)`。Deno 需要数据库及其日志文件的读写权限。子入口明确选择运行时，不自动回退。根入口不加载任何数据库驱动。

## 常用 API

| API                                             | 用途                       |
| ----------------------------------------------- | -------------------------- |
| `sqliteBackendPlugin({ driver, table?, wal? })` | 安装 SQLite 存储           |
| `store.use(kv / records / sql / ttl / counter)` | 标准数据、查询、期限与计数 |
| `store.transaction` / `store.tx()`              | 同一连接中的原生事务       |
| `store.sql` / `tx.sql`                          | 绑定参数 SQL               |
| `host.org(id).backend('sqlite')`                | 固定组织的数据视图         |
| `sqliteMaintenanceFeature()`                    | 增加 backup 与 vacuum      |

## 契约细节

每个 driver 同时只交给一个 store；多个连接可以使用同一个文件。文件库默认 WAL，内存库默认非 WAL；内存库要求 WAL 会拒绝。默认表前缀 `migaia`，默认锁期限30000ms，无 heartbeat。事务占用连接时根操作会失败，应改用 tx。

本包不提供向量、RDF 或实时变更流。记录字段查询在客户端求值；取消不能抢占已经开始的同步 SQLite 工作。错误、数据类型、维护与日志的详细限制见 [USEGUIDE](./USEGUIDE.md#数据与错误边界)。
