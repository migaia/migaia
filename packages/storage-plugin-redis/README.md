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

| 数据                        | 原生结构     | 物理键                               |
| --------------------------- | ------------ | ------------------------------------ |
| 文本/字节/记录              | STRING       | P:t:orgKey / P:b:orgKey / P:r:orgKey |
| 文本/记录顺序               | ZSET         | P:t:index / P:r:index                |
| Vector points / 向量点      | HASH         | P:v:collectionHex:orgId:idHex        |
| Search schema / 检索 schema | native index | P:vi:collectionHex                   |
| 修订                        | HASH         | P:rev                                |
| 锁                          | STRING       | P:lock:orgId:identity                |
| 提交提示                    | Pub/Sub      | P:changes                            |

前缀删除通过 ZRANGEBYLEX 取匹配成员，跳过过期值并重新检查残留。`inspectLocks`/字节清空用 SCAN，成本包含全库扫描候选。变更提示是 best-effort，不承诺外部原生命令、断连重放或过期即时通知。`dispose()` 返回缓存主 Promise；符号释放返回另一个缓存 Promise，清理失败只报告。两者只清理自有订阅和租约，不关闭注入客户端。

## 原生 Feature

从独立子路径导入后作为 `redisBackendPlugin` 第二参数选择。API 只出现在 `store.api`，不进入 `tx.api`；固定 API 复用宿主已有的一次 pipeline。Streams/PubSub 二进制载荷用唯一 canonical base64 文本 wire。

| 入口                      | API                                                                                    | 默认与边界                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/features/streams`       | `redisStreamsFeature()`，`api.streams.add/range/createGroup/readGroup/ack/autoClaim`   | range -/+、count100；group 0-0、createStream=true；read count100、省略 block 不阻塞；仅同名 BUSYGROUP 幂等 |
| `/features/pubsub`        | `redisPubSubFeature()`，`api.pubsub.publish/subscribe/keyspace`                        | 只接 expired/del/set；keyspace 回传真实物理键的 UTF-8 字节；过滤 namespace 与子组织；不修改服务通知配置    |
| `/features/sorted-sets`   | `redisSortedSetsFeature()`，`api.sortedSets.add/rank/top`                              | 有限 score；top10、升序；同分按原 UTF16 键序；空 add 零命令                                                |
| `/features/rate-limit`    | `redisRateLimitFeature({limit,windowMs})`，`api.rateLimit.consume`                     | 正安全整数；cost1；原子拒绝不增加计数；resetAfterMs 为原生 PTTL                                            |
| `/features/change-stream` | `redisChangeStreamFeature({maxLen})`，`use(durableChangeFeed).readChanges/tailChanges` | maxLen 正安全整数；read limit100；原生 Stream ID；数据和 XADD 同 EXEC                                      |
| `/features/search`        | `rediSearchVectorFeature()`，`use(vector).collection(name,options)`                    | 真实模块/二进制端口；默认 HNSW、exact 用 FLAT；vector TTL 同原 draft                                       |

Streams group 阻塞读取使用专用真实连接。每条原生 BLOCK 最多1000ms；仅收到原生空结果才继续等待，原生错误立即拒绝、不重放。取消与关闭排空当前阻塞片后归还连接。订阅资源的取消预算持续到释放；回调拒绝只报告，不改变已提交写入。

可靠变更流只覆盖标准库提交。`readChanges({after,limit})` 从排他 cursor 读取；`tailChanges({from:'now',onChange,onError})` 先取实际高水位再读，callback 成功才推进，失败报告并关闭，不确认失败项。落后于已保留首项的非初始 cursor 报 `CHANGE_CURSOR_EXPIRED`。初始 `0-0` 仅在原生 XINFO 确认从未移除条目时可续读，裁剪后同样拒绝；读取跨裁剪边界保守拒绝。MAXLEN 使用原生近似裁剪；外部原生命令不伪装成标准变更。

```ts
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisStreamsFeature } from '@migaia/storage-plugin-redis/features/streams'
import { redisPubSubFeature } from '@migaia/storage-plugin-redis/features/pubsub'
import { redisSortedSetsFeature } from '@migaia/storage-plugin-redis/features/sorted-sets'
import { redisRateLimitFeature } from '@migaia/storage-plugin-redis/features/rate-limit'
import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin(
      {
        driver: nodeRedisDriver(pool),
        prefix: process.env.MIGAIA_EXAMPLE_REDIS_PREFIX ?? crypto.randomUUID()
      },
      {
        streams: redisStreamsFeature(),
        pubsub: redisPubSubFeature(),
        scores: redisSortedSetsFeature(),
        rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 }),
        history: redisChangeStreamFeature({ maxLen: 1000 })
      }
    )
  ] as const
})
const store = host.backend('redis')
try {
  const id = await store.api.streams.add('jobs', { body: new Uint8Array([1, 2]) })
  console.log((await store.api.streams.range('jobs'))[0]?.id === id)
  await store.api.sortedSets.add('scores', [{ member: 'one', score: 1 }])
  console.log((await store.api.sortedSets.top('scores'))[0]?.member)
  console.log((await store.api.rateLimit.consume('quota')).allowed)
  const subscription = await store.api.pubsub.subscribe('events', () => undefined)
  await store.api.pubsub.publish('events', new Uint8Array([3]))
  await subscription.dispose()
  await store.set('checkpoint', 'ready')
  console.log((await store.use(durableChangeFeed).readChanges()).changes.length)
} finally {
  await host.dispose()
  await pool.close()
}
```

## 原生向量检索

从 `/features/search` 选择 `rediSearchVectorFeature()` 安装 `vector`。检测要求真实 Search 模块与二进制 connection/EXEC 端口；Bun 内置驱动只拒绝所选向量 Feature，基础 KV 仍可用。Redis 8 可能已含 Search，缺模块的 Valkey 拒绝该 Feature。工厂与检测不创建 collection；新 collection 显式给 dimensions/metric，后续宿主通过 FT.INFO 取得真实 schema。

托管点使用原生 HASH，同一 EXEC 将相同 FLOAT32 字节写入 HNSW 与 FLAT 字段；`exact:true` 选择 FLAT。cosine/dot 分数均为 `1-distance`，euclid 为 `-sqrt(distance)`。FLOAT32 溢出或转换后成为零 cosine 方向时，在修改点前拒绝。payload 真值沿原便携 codec；新 scalar 路径在 upsert 前由 FT.ALTER 建 TAG/NUMERIC 字段，不新增 schema 注册表。索引及点名复用规范 namespace 和 collection/id 的原便携编码，保留任意 UTF16 字符串身份。

组织 TAG 与期限 NUMERIC 在 KNN 排名前过滤。scalar 等值、成员、存在性及数值范围使用忠实原生过滤；其它条件及函数只处理引擎命中、不补搜，`requirePushdown()` 在原生 I/O 前拒绝。`minScore` 为有界客户端阈值，explain 如实标识。similar/recommend 仅按 ID 读取样本，原推荐助手合成方向后仍走同一原生查询。

vector TTL 与其它通道共用原 WATCH draft/锁拥有者。Redis TIME 产生一份绝对 deadline，同 EXEC 写 HASH expiry 与 PEXPIREAT；普通 upsert 保留期限，persist 同批写 expiry=0 与 PERSIST。根及真实事务 TTL 均支持 vector target；vector collection 不获得通用事务能力。成功向量写发布原 all 失效，并进入已选可靠流的同一提交摘要。

Search 将 TAG token 截断到 4096 字节，因此超过此长度的规范 scalar 等值/成员条件不声明原生下推。`.near().where(...)` 仍只在原生 topK 命中后过滤、不补搜；`requirePushdown()` 报 `QUERY_NOT_PUSHABLE`，`deleteWhere` 和原生 `search.filter` 在 I/O 前报 `UNSUPPORTED_CAPABILITY`。该长值原生过滤组合等待用户复核。完整 payload、ID 与物理键不截断。样本排除使用完整原 ID codec 字节的 SHA-256 短 TAG；它只是索引投影，不是可逆 ID 编码，也不承诺数学上零碰撞。

`deleteWhere(where,{count?})` 默认 precount，两模式都沿 FT.SEARCH 分页收集后进入原 attempt，只计实际存在且提交删除的点，不额外 count、不加 expiry 过滤。原生已过期 HASH 不存在且不计数；不支持的条件在原生 I/O 前拒绝。`dropOrg` 只删除该组织的托管 HASH，保留共享 schema；重启后未选择 Search 或没有二进制端口时也清除历史点，只沿原身份元数据、WATCH/修订与同一 EXEC。检索成本为原生计划加返回命中字节；删除成本包含真实分页与选中点 draft。

```ts
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_STACK_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin(
      { driver: nodeRedisDriver(pool), prefix: crypto.randomUUID() },
      { search: rediSearchVectorFeature() }
    )
  ] as const
})
const store = host.backend('redis')
try {
  const items = store
    .use(vector)
    .collection<{ group: string }>('items', { dimensions: 2, metric: 'cosine' })
  await items.upsert([{ id: 'one', vector: [1, 0], payload: { group: 'docs' } }])
  console.log(
    (await items.near([1, 0], { exact: true }).where({ group: 'docs' }).topK(1).all())[0]?.id
  )
  await store.use(ttl).expire({ channel: 'vector', collection: 'items', id: 'one' }, 60000)
} finally {
  await store.clearAll()
  await host.dispose()
  await pool.close()
}
```

## 提交后外置日志

宿主 `journal` 可借用仅安装 `binlog` 的原 Logger，且不配置 WAL、undo 或 atomic log stores。每个组织经原 journalBinding 捕获有序 draft 修改；只有原生 EXEC 所有项成功才触发原 onCommit，操作等待原 settle 完成。回调在 EXEC 前失败不写业务或日志；部分执行或回复未知不追加成功日志、不重放，并封闭后续写入。外置 append 失败沿原宿主报告，已经提交的数据不改为失败回滚，仍存在既定提交后日志窗口。

该终端如实声明 `nativeAtomic:false`，不把 Redis 执行隔离冒充失败回滚。标准值、字节、记录和向量的 image 使用原便携 codec，保留实际 wire 与绝对期限；仅日志启用时额外读取原生 PEXPIRETIME。历史向量删除的完整 before image 需要原二进制端口；缺少时该新增日志组合在修改前 `UNSUPPORTED_CAPABILITY`，普通历史删除不受影响。

`storageLogStore` 的资源期缓存索引由 `indexExclusive:false` 单独隔离；同 EXEC 强原子 binlog、undo 与 WAL intent/marker 组合在准备阶段拒绝，等待用户复核。原本未交付的这些强保证不被伪装实现。后续可由原拥有者提供真实所需保证后撤销隔离；本包没有第二日志或事务平台。原生 Streams/PubSub/sorted-set/rate-limit API 保持原调用行为，不冒充标准业务通道的 journal 来源。

`host.dropOrg(orgId)` 也通过原 WATCH/draft/EXEC 删除该组织既定 Streams、有序集合及限流物理键；重启后未选择这些 Feature 仍生效。只匹配原 layout 的合法字符串名称，保留其它组织与调用方非托管键。PubSub 无持久业务值；共享可靠变更历史保留原 retention/cursor，不按组织改写。普通 `clearAll()` 保留原标准通道范围。删除成本包含原生 SCAN 实际候选。

普通宿主遥测通过 `journal: { logger, namespace, telemetry: true }` 显式启用，并使用原 Logger level 插件。根读写记录规范逻辑键与实际 pipeline 载荷。公开事务跨原有重试只记录一个完成终点；事务 scope 与私有 journal 操作不重复记录。logger 仍为借用，原有 pipeline/hook 次数保持。

提交 binlog 按原跨通道顺序保留已接纳的 draft 修改，包括重复写入与中间新值。原始值与绝对期限在每次 staging 时捕获，最终原生修订由同一 attempt 补齐。undo 合并仍归宿主；Redis 的 WAL/undo 准入仍明确不支持。
