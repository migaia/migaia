# @migaia/storage-plugin-redis

[English](./README.en.md)

把 Redis 或 Valkey 接到统一存储接口，集中处理组织键、过期时间、记录查询和显式键锁，减少业务代码逐次拼接物理键和补写期限的负担。选择已连接客户端对应的驱动并安装插件后，可按需增加 Streams、限流或向量检索；可用能力取决于服务模块与驱动，Redis 的事务部分失败限制仍然适用。

## 你可能遇到过

- 多租户缓存互相覆盖：直接使用原生键时漏了组织前缀。
- 更新活值后过期时间消失：写值与设置 TTL 分成了不同操作。
- MULTI 返回了错误，却已有数据写入：EXEC 逐项错误不等于回滚。
- 服务重连后漏了变化：把 Pub/Sub 当成了历史队列。

## 为什么选它

- **统一处理逻辑键和组织。** 标准方法为文本、字节、记录生成不同物理键，同名组织数据隔离，见[带期限的组织数据](./USEGUIDE.md#带期限的组织数据)。
- **把标准修改放进一次 EXEC。** 值、索引、修订和通知一起提交，并在发送前检查可识别的输入错误；仍如实保留 Redis 部分失败限制，见[事务与并发限制](./USEGUIDE.md#事务与并发限制)。
- **通知与可重放历史各有入口。** Pub/Sub 适合在线提示，Stream 变更历史适合从游标继续，见[从变更历史继续](./USEGUIDE.md#从变更历史继续)。
- **选择服务真正提供的模块。** 向量 Feature 检测 Search 模块和驱动二进制端口，缺少就拒绝，不以本地计算冒充原生检索。这里不作性能比较。

## 从这里开始

先运行 Redis 7.2+ 或 Valkey 7.2.5+，设置 `REDIS_URL`。这段代码实际保存并读取一个值。

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [redisBackendPlugin({ driver: nodeRedisDriver(pool) })] as const
  })
  const store = host.backend('redis')
  await store.set('example:status', 'ready')
  console.log(await store.get('example:status'))
} finally {
  await pool.close()
}
```

预期输出：

```text
ready
```

需要 TTL 和事务，看[带期限的组织数据](./USEGUIDE.md#带期限的组织数据)；需要向量，看[使用-search-向量检索](./USEGUIDE.md#使用-search-向量检索)。

## 手写时的隐患

下面不执行，只展示原生写法的两个问题。

```ts doc-test=check
import type { RedisClientType } from 'redis'
export async function save(client: RedisClientType) {
  await client.multi().set('session', 'active').incr('session').exec()
  // session 不是整数，INCR 失败，但前面的 SET 可能已经提交。
  // 物理键没有组织信息，另一个租户也会写到同一个 session。
}
```

标准接口集中处理键、数据检查、WATCH 和期限。它不能把 Redis EXEC 变成出错后全部回滚的数据库事务；未知提交结果也不会自动重放。

## 三分钟心智模型

| 要做什么                     | 使用什么                                  |
| ---------------------------- | ----------------------------------------- |
| 创建和关闭 SDK 客户端或 pool | 应用程序                                  |
| 标准存储、记录、TTL、计数    | host 安装后的 backend 与能力令牌          |
| 串行修改指定逻辑键           | tx().lock(...).run(...)                   |
| 在线通知或消费应用队列       | PubSub、Streams Feature                   |
| 读取标准提交历史             | change-stream Feature + durableChangeFeed |
| 原生向量近邻搜索             | search Feature + vector                   |

能力令牌选一组标准方法；Feature 增加可选 API。WATCH 用来发现读取后的修改；EXEC 执行一组命令，但其中一条失败不会撤回其它已执行命令。

## 典型场景

| 场景                       | 怎么组合                     | 详细说明                                                   |
| -------------------------- | ---------------------------- | ---------------------------------------------------------- |
| 会话缓存与计数             | org + ttl + counter + 显式锁 | [带期限的组织数据](./USEGUIDE.md#带期限的组织数据)         |
| 队列、榜单、限流、在线提示 | 原生 Feature                 | [选择原生功能](./USEGUIDE.md#选择原生功能)                 |
| 缓存消费者从断线处继续     | durableChangeFeed            | [从变更历史继续](./USEGUIDE.md#从变更历史继续)             |
| 服务端向量搜索             | Search 模块 + 二进制驱动     | [使用 Search 向量检索](./USEGUIDE.md#使用-search-向量检索) |

## 安装

本包当前 `private: true`，用于本仓库工作区，不代表已公开发布。消费包中连接工作区包，再安装使用的 SDK：

```bash
pnpm add @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-redis --workspace
pnpm add redis ioredis
```

| 入口          | 注入对象                   | 调用方清理                 |
| ------------- | -------------------------- | -------------------------- |
| `/node-redis` | 已连接的 node-redis 6 pool | host 结束后 pool.close()   |
| `/ioredis`    | 已连接的 ioredis 6 client  | host 结束后 client.quit()  |
| `/bun`        | 已连接的 Bun RedisClient   | host 结束后 client.close() |

根入口不加载 SDK。ioredis/node-redis 提供二进制命令与 EXEC；Bun 适配器不提供二进制端口，基础 KV 可用，Search 向量不能选择。每个订阅需要独立连接，pool 需预留业务和订阅容量。精确 peer 范围见 package.json。

## 常用 API

| API                                                  | 用途                                 |
| ---------------------------------------------------- | ------------------------------------ |
| `redisBackendPlugin({ driver, prefix? }, features?)` | 安装 Redis 存储                      |
| `store.use(kv / records / ttl / counter)`            | 标准数据、期限和计数                 |
| `store.transaction` / `store.tx()`                   | WATCH/EXEC 事务和逻辑键锁            |
| `host.org(id).backend('redis')`                      | 固定组织的数据                       |
| Streams / PubSub / sorted-sets / rate-limit Feature  | 增加 store.api 方法                  |
| change-stream / search Feature                       | 增加 durableChangeFeed / vector 能力 |

## 契约细节

默认 prefix=migaia，maxLockMs=30000。普通覆盖保留 TTL，锁和期限使用 Redis 时间。基础记录查询在客户端求值，没有标准 secondaryIndexes、SQL 或 RDF。root/组织视图复用命名空间规则，dropOrg 也清除该组织已支持的 Feature 持久数据。

普通变更提示是尽力而为，不覆盖外部原生命令、断线重放或即时过期事件。Search 需要真实模块；普通 Valkey 连接成功不代表它提供向量检索。EXEC 逐项失败和提交后断连可能留下部分或未知结果，后续新写会封闭，不会悄悄重放。完整限制见 [USEGUIDE](./USEGUIDE.md#事务与并发限制)。
