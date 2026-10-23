# Redis 原生驱动

适配入口借用真实已连接 SDK client 或 pool。`ioredisDriver` 接受 ioredis 6，`nodeRedisDriver` 接受 node-redis 6 pool，`bunRedisDriver` 接受 Bun 内置 `RedisClient`。根入口不加载 SDK。

`withConnection` 在整个回调完成前持有原生 pool 租约或自有 duplicate。注入的 client 仍由调用方关闭。借用的 `getClient()` 类型不提供关闭与复制方法。订阅资源先封闭回调，再清理连接；释放 Promise 由共享资源实现缓存。

`exec` 在 WATCH 冲突时返回 `null`，否则逐条返回成功值或原生错误。某条命令失败时，其它命令可能已经提交。EXEC 后断连可能无法确定结果，适配器不自动重放。ioredis 与 node-redis 提供二进制命令；Bun 驱动在 MULTI 前拒绝二进制输入。

原生命令、连接与 EXEC 故障使用 `REDIS_FAILED`；用户回调的未知业务失败使用 `TRANSACTION_FAILED`。已有 contract、host 与本包错误保留原身份，原生 Error 类型、stack 和原始错误仍可追踪。

ioredis 和 node-redis 的 `binaryCommand` 及 `exec` 保留任意原生 BLOB 字节。ioredis 的成功回复也可能是 Buffer，请按固定命令验证 `unknown` 回复。node-redis 6.3 的 multi builder 没有把类型映射传给最终 EXEC，适配器在同一真实 pool 租约内使用原生 raw MULTI/EXEC，并复用 SDK chainId；原始逐项 Error 保留，SDK 未产生聚合错误时不伪造 MultiErrorReply。连接在 EXEC 前变化会报 `REDIS_FAILED`，只有原生 EXEC 返回 null 才表示 WATCH 放弃。

## 标准存储后端

`redisBackendPlugin({ driver, prefix?, concurrency?, owner?, maxLockMs? })` 安装 KV、字节、记录、TTL、counter、原事务构建器和提交后变更提示。`prefix` 缺省为 `migaia`；`maxLockMs` 缺省 30000。服务版本经宿主检测：Redis >=7.2，Valkey >=7.2.5。禁用自动检测时先 `await host.detect()`。每个订阅占用独立原生连接；node-redis pool 需留出业务与订阅容量。

```ts
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { counter, kv, records, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin({
      driver: nodeRedisDriver(pool),
      prefix: crypto.randomUUID()
    })
  ] as const
})
const store = host.backend('redis')
try {
  await store.use(kv).setMany([{ key: ['cache', 1], value: 'one' }])
  await store.use(counter).increment('visits')
  await store
    .tx()
    .lock({ channel: 'text', key: 'session' })
    .run(async (tx) => {
      await tx.set('session', 'active')
      await tx.use(ttl).expire({ channel: 'text', key: 'session' }, 60000)
    })
  await store.putRecord({ active: true }, ['user', 1])
  console.log(await store.use(records).query().count())
} finally {
  await store.clearAll()
  await host.dispose()
  await pool.close()
}
```

事务内读不加锁。显式 `.lock(...)` 才持有原生 SET NX PX 锁；普通写使用原并发策略。WATCH 在依赖读取前建立，数据、索引、修订与通知同一 EXEC。回调失败不发送 EXEC；null 表示真实 WATCH 放弃；逐项失败可能部分提交，未知 EXEC 不重放，并停止此安装的新写准入。后者仍允许读取和释放。

文本、字节与记录分通道保存。普通覆盖保 TTL；`expire(0)` 立即删除；期限与锁用 Redis TIME/PTTL。毫秒小数向上取整到原生毫秒；超出安全整数的绝对期限在 EXEC 前拒绝。批量写拒绝规范等价重复键，空批零命令，getMany 保输入位置与重复。

P 是原规范 prefix 编码生成的非空 `{hex}` hash tag，所有键同槽。键尾逻辑身份含组织段，缺省组织也隔离。

| 数据           | 原生结构 | 物理键                               |
| -------------- | -------- | ------------------------------------ |
| 文本/字节/记录 | STRING   | P:t:orgKey / P:b:orgKey / P:r:orgKey |
| 文本/记录顺序  | ZSET     | P:t:index / P:r:index                |
| 修订           | HASH     | P:rev                                |
| 锁             | STRING   | P:lock:orgId:identity                |
| 提交提示       | Pub/Sub  | P:changes                            |

前缀删除通过 ZRANGEBYLEX 取匹配成员，跳过过期值并重新检查残留。`inspectLocks`/字节清空用 SCAN，成本包含全库扫描候选。变更提示是 best-effort，不承诺外部原生命令、断连重放或过期即时通知。`dispose()` 返回缓存主 Promise；符号释放返回另一个缓存 Promise，清理失败只报告。两者只清理自有订阅和租约，不关闭注入客户端。
