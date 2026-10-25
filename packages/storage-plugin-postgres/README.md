# @migaia/storage-plugin-postgres

[English](./README.en.md)

把 PostgreSQL 接到统一存储接口，避免文本、记录、过期时间和应用 SQL 分别提交时出现一半更新成功的情况。将已有客户端或连接池交给对应驱动，再把插件安装到 host，就能在同一数据库事务中组合这些操作；通知、逻辑复制和向量等能力按需选择，客户端仍由应用负责关闭。

## 你可能遇到过

- 订单记录保存了，状态却没保存：两次写入没有放进同一个事务。
- 缓存重建后又读到旧数据：把易丢的通知当成了可重放日志。
- 不同租户用了相同的键：原生表缺少一致的租户过滤。
- 服务已停，连接池仍在等待：订阅和存储操作还没结束就关闭了客户端。

## 为什么选它

- **存储方法与 SQL 一起提交。** 事务中的 KV、记录和 SQL 使用同一条数据库连接，见[事务与组织隔离](./USEGUIDE.md#事务与组织隔离)。
- **按需选择数据库功能。** COPY、通知、向量与可重放变更流分别导入，不选就不增加对应 API，见[导入数据并发送通知](./USEGUIDE.md#导入数据并发送通知)。
- **能分清通知丢失和历史丢失。** 普通通知不保证重放；逻辑复制提供检查点，并拒绝无法证明连续的历史，见[持续读取变更](./USEGUIDE.md#持续读取变更)。
- **批量接口保留输入含义。** 批量读取保留顺序和重复位置，批量写入拒绝等价重复键；使用绑定数组，避免按键发起查询。这里不作速度比较。

## 从这里开始

准备 PostgreSQL 数据库，把连接地址放入 `DATABASE_URL`。安装会创建存储所需的表；账号需要对应 schema 的权限。以下示例先实际保存，再读取。

```ts doc-test=run
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
  await store.set('example:status', 'ready')
  console.log(await store.get('example:status'))
} finally {
  await pool.end()
}
```

预期输出：

```text
ready
```

需要一次提交多项数据，看[事务与组织隔离](./USEGUIDE.md#事务与组织隔离)；需要处理断线后的变化，看[持续读取变更](./USEGUIDE.md#持续读取变更)。

## 手写时的隐患

下面函数假定应用表已存在，只展示常见写法，不执行。

```ts doc-test=check
import type { Pool } from 'pg'
export async function save(pool: Pool, key: string, value: string) {
  await pool.query('INSERT INTO app_settings(key,value) VALUES($1,$2)', [key, value])
  // 两次独立提交：第二次失败时，第一条数据已经留下。
  await pool.query('UPDATE app_stats SET writes=writes+1')
  // 直接重复整个函数可能再次插入；连接丢失也不证明上次没写入。
}
```

把需要共同成功的修改放进 `store.transaction`，回调失败就回滚。仍不要把发邮件等外部副作用放进可能重试的事务回调。

## 三分钟心智模型

| 要做什么                         | 使用什么                                          |
| -------------------------------- | ------------------------------------------------- |
| 创建连接与关闭连接               | 你选择的 PostgreSQL 客户端                        |
| 安装数据库、完成后释放存储与订阅 | `createStorageHost` 和 `host.dispose()`           |
| 读写文本、记录、TTL、计数与 SQL  | `host.backend('postgres')`，或 `store.use(token)` |
| 只访问一个组织的数据             | `host.org(orgId).backend('postgres')`             |
| 增加向量、COPY、通知或复制       | 插件第二参数中的 Feature                          |

“能力令牌”是 `kv`、`records`、`ttl` 等功能标识；`use` 返回对应方法。“Feature”是显式安装的附加功能。“游标”是服务返回的检查点字符串，按原样保存和传回。

## 典型场景

| 场景                     | 怎么组合                            | 详细说明                                               |
| ------------------------ | ----------------------------------- | ------------------------------------------------------ |
| 状态、记录和期限一起提交 | `transaction` + `kv` + `ttl`        | [事务与组织隔离](./USEGUIDE.md#事务与组织隔离)         |
| 查找相似文本向量         | `pgvectorFeature`，可加量化精排     | [向量检索](./USEGUIDE.md#向量检索)                     |
| 流式导入并在提交后通知   | `pgCopyFeature` + `pgListenFeature` | [导入数据并发送通知](./USEGUIDE.md#导入数据并发送通知) |
| 断线后从检查点继续       | `pgLogicalReplicationFeature`       | [持续读取变更](./USEGUIDE.md#持续读取变更)             |

## 安装

当前包标记为 `private: true`，供本仓库工作区使用，不表示已发布到公共 registry。在消费它的工作区包中连接依赖：

```bash
pnpm add @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-postgres --workspace
pnpm add pg pg-copy-streams pg-logical-replication postgres
```

驱动按入口选择：

| 入口           | 注入对象                              | 结束时调用                       |
| -------------- | ------------------------------------- | -------------------------------- |
| `/pg`          | `pg` 8 的 `Pool`                      | 先释放 host，再 `pool.end()`     |
| `/postgres-js` | `postgres` 3 的 `Sql`                 | 先释放 host，再 `client.end()`   |
| `/bun`         | Bun 1.4.4+ 的 `SQL`，`prepare: false` | 先释放 host，再 `client.close()` |

根入口不加载驱动。逻辑复制目前只支持 `/pg`，还需要 Node 22+ 与 `pg-logical-replication >=2.6.0 <3`。Bun 1.4.3 不具备此适配所需功能，会在 I/O 前拒绝。驱动包的实际 peer 版本范围见 `package.json`。

## 常用 API

| API                                                                                     | 用途                     |
| --------------------------------------------------------------------------------------- | ------------------------ |
| `postgresBackendPlugin(options, features?)`                                             | 安装一个 PostgreSQL 后端 |
| `store.use(kv / records / ttl / counter / sql)`                                         | 使用对应标准功能         |
| `store.transaction` / `store.tx().lock(...).run(...)`                                   | 原生事务与显式逻辑键锁   |
| `store.sql`                                                                             | 绑定参数的应用 SQL       |
| `host.org(id).backend('postgres')`                                                      | 固定组织的存储视图       |
| `pgvectorFeature` / `pgCopyFeature` / `pgListenFeature` / `pgLogicalReplicationFeature` | 选择原生附加功能         |

## 契约细节

默认 `server: 'postgres'`、`schema: 'public'`、`prefix: 'migaia'`。`cockroach`、`yugabyte` 需要实际服务检测；只有 PostgreSQL 提供普通变更通知，Cockroach 不支持此包的 pgvector Feature。兼容协议不代表所有部署组合都已验证。

组织共享物理表，同名键、期限、锁及标准向量点隔离。原生 SQL、自有向量表查询和 COPY 属于调用方表访问；显式组织视图拒绝这些入口。详细类型、并发、错误和日志限制见 [USEGUIDE](./USEGUIDE.md#行为边界)。

逻辑复制的 `truncate` 默认 `reset`。根流遇到 TRUNCATE 后，每个提交只发一条无 `orgId` 的 `reset`，消费者必须让所有组织缓存失效；`block` 会停止且不确认该提交。检测报告延迟与 WAL 保留量；无限 WAL 保留会警告。没有持续流需求时，不要保留复制 slot，可使用 TTL 或定时同步；关闭 host 不会删除 slot。

逻辑复制推荐仅发布当前 storage 的业务表（`kv`、`bytes`、`records` 及实际使用的向量表），并启用 insert/update/delete/truncate。显式表、专属 schema 和 `FOR ALL TABLES` publication 均可；原有全部表部署无需迁移。建表顺序、示例 SQL 和旧行为迁移见 [持续读取变更](./USEGUIDE.md#持续读取变更)。publication 缩小只减少输出和网络量，不减少整个数据库的 WAL 解码工作。
