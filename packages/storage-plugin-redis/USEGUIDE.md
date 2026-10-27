# Redis 使用指南

[English](./USEGUIDE.en.md)

下列完整程序需要 Redis 7.2+ 或 Valkey 7.2.5+，并设置 REDIS_URL。Search 示例额外设置 REDIS_SEARCH_URL，指向确实提供 Search 的服务。示例会实际写库，先结束 host，再关闭 pool。

## 按场景查找

| 任务                       | 场景                                          |
| -------------------------- | --------------------------------------------- |
| 会话、TTL、计数与组织隔离  | [带期限的组织数据](#带期限的组织数据)         |
| 应用队列、消息、榜单和限流 | [选择原生功能](#选择原生功能)                 |
| 断线后继续读标准提交       | [从变更历史继续](#从变更历史继续)             |
| 服务器向量近邻检索         | [使用 Search 向量检索](#使用-search-向量检索) |

## 带期限的组织数据

预期输出 `active`、`1`。锁显式保护同一逻辑键，组织使用 UUID。

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { kv, ttl, counter } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [redisBackendPlugin({ driver: nodeRedisDriver(pool) })] as const
  })
  const store = host.org('10000000-0000-4000-8000-000000000001').backend('redis')
  await store
    .tx()
    .lock(lockKey.text('example:session'))
    .run(async (tx) => {
      await tx.use(kv).setMany([{ key: 'example:session', value: 'active' }])
      await tx.use(ttl).expire(lockKey.text('example:session'), 60000)
      await tx.set('example:visits', '0')
      await tx.use(counter).increment('example:visits')
    })
  console.log(await store.get('example:session'))
  console.log(await store.get('example:visits'))
} finally {
  await pool.close()
}
```

普通覆盖保留活值 TTL，expire(0) 立即删除，期限与锁使用 Redis TIME/PTTL。小数毫秒向上取整；超出安全整数的绝对期限在 EXEC 前拒绝。getMany 保留输入顺序、重复与缺失位置；批量写拒绝规范等价重复键，空批零命令。标准 KV、记录、TTL、counter 都可在 tx 中使用；字节和文本、记录分别保存。

组织共用带 hash tag 的物理命名空间，相关键同槽；同名逻辑键、期限、修订和锁隔离。prefix 默认 migaia，maxLockMs 默认30000；concurrency 选择冲突策略。dropOrg 删除该组织标准数据及既有 Streams、sorted-set、限流和向量点，即使重启后没再选择对应 Feature；保留其它组织、调用方非托管键和共享检索 schema。clearAll 仍只清标准通道。

## 事务与并发限制

事务读取不会自动加逻辑锁；显式 lock 才创建 SET NX PX 锁。普通写沿所选并发策略处理。WATCH 在依赖读取前建立，数据、索引、修订和通知进入同一 EXEC。回调在 EXEC 前失败时不写入；EXEC 返回 null 才是已确认的 WATCH 放弃，可按冲突策略重试。

EXEC 逐项失败可能部分提交，发送后断连可能结果未知。这两者都不自动重放，并封闭这次安装的新写入；读取和释放仍可用。不能把 transactions:true 理解成原生错误后完整回滚。不要把外部副作用放进可能重试的回调。

## 选择原生功能

下面显式安装四个 Feature，实际写入 Stream、榜单与限流键，并发送一条消息。新命名空间首次运行通常输出 true、Ada、true、3；重复运行时已有队列内容或未到期配额可改变前几项结果。

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisStreamsFeature } from '@migaia/storage-plugin-redis/features/streams'
import { redisPubSubFeature } from '@migaia/storage-plugin-redis/features/pubsub'
import { redisSortedSetsFeature } from '@migaia/storage-plugin-redis/features/sorted-sets'
import { redisRateLimitFeature } from '@migaia/storage-plugin-redis/features/rate-limit'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [
      redisBackendPlugin(
        { driver: nodeRedisDriver(pool), prefix: 'example-features' },
        {
          streams: redisStreamsFeature(),
          pubsub: redisPubSubFeature(),
          scores: redisSortedSetsFeature(),
          rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 })
        }
      )
    ] as const
  })
  const store = host.backend('redis')
  const id = await store.api.streams.add('jobs', { body: new Uint8Array([1, 2]) })
  console.log((await store.api.streams.range('jobs')).some((entry) => entry.id === id))
  await store.api.sortedSets.add('scores', [{ member: 'Ada', score: 1 }])
  console.log((await store.api.sortedSets.top('scores'))[0]?.member)
  console.log((await store.api.rateLimit.consume('quota')).allowed)
  const message = Promise.withResolvers<Uint8Array>()
  await using subscription = await store.api.pubsub.subscribe('events', message.resolve)
  await store.api.pubsub.publish('events', new Uint8Array([3]))
  console.log((await message.promise)[0])
} finally {
  await pool.close()
}
```

| Feature     | 方法与默认值                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| streams     | add/range/createGroup/readGroup/ack/autoClaim；range默认-/+、count100，group默认0-0与createStream:true，读取count100，省略block不等待 |
| pubsub      | publish/subscribe/keyspace；二进制消息用规范base64文本传输，keyspace仅expired/del/set，回调收到实际物理键的UTF-8字节                  |
| sorted-sets | add/rank/top；有限score，top默认10条升序，同分按逻辑UTF-16键序，空add零命令                                                           |
| rate-limit  | limit/windowMs正安全整数，consume默认cost1；拒绝不增加计数，resetAfterMs来自PTTL                                                      |

这些原生 API 出现在 store.api，不在 tx.api。Streams 与 PubSub 各有自己的消息语义，不会自动成为标准提交日志。订阅需要专用真实连接；先释放订阅，再释放 host 和 SDK。Keyspace 过滤命名空间与组织，但不会替你开启服务器通知配置。

Streams group 阻塞读取使用专用连接，每次原生 BLOCK 最多1000ms；只有空结果才继续等待，原生错误直接拒绝。取消或关闭要等当前阻塞片结束。PubSub 回调拒绝只报告，不能撤回已提交的发布。

## 从变更历史继续

显式选择 change-stream，让标准写入与历史 XADD 进入同一 EXEC。示例从当前高水位开始，等待一次标准提交，打印服务给出的 cursor；其值由服务决定。

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [
      redisBackendPlugin(
        { driver: nodeRedisDriver(pool), prefix: 'example-history' },
        { history: redisChangeStreamFeature({ maxLen: 1000 }) }
      )
    ] as const
  })
  const store = host.backend('redis')
  const received = Promise.withResolvers<void>()
  await using tail = await store.use(durableChangeFeed).tailChanges({
    from: 'now',
    onChange: async (change) => {
      console.log(change.cursor)
      received.resolve()
    },
    onError: (error) => {
      received.reject(error)
    }
  })
  await store.set('example:checkpoint', 'ready')
  await received.promise
} finally {
  await pool.close()
}
```

maxLen 必须是正安全整数，使用原生近似 MAXLEN 裁剪。readChanges({after,limit}) 默认limit100，从排他游标读起。处理效果和检查点应在回调成功前完成；tail 只在 onChange 成功后推进，失败报告并关闭，不越过失败项。游标是原生 Stream ID，按原样保存，不转成不精确的 JS number。

非初始游标落后于保留首项时报 CHANGE_CURSOR_EXPIRED。0-0 也不是“忽略丢失历史”：只有 XINFO 证明从未移除记录时可继续，裁剪后同样拒绝。跨裁剪边界保守拒绝。这份历史只覆盖标准库提交，不承诺外部原生命令或纯自然过期事件；普通 best-effort 变更提示也不能代替它。

## 使用 Search 向量检索

需要真实 Search 模块和二进制 connection/EXEC 端口。部分 Redis 8部署包含 Search，缺模块的 Valkey 会拒绝该 Feature。Bun 内置驱动缺少二进制端口，不能使用此例；基础 KV 不受影响。预期输出 guide。

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'
const pool = createClientPool({ url: process.env.REDIS_SEARCH_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [
      redisBackendPlugin(
        { driver: nodeRedisDriver(pool), prefix: 'example-vectors' },
        { search: rediSearchVectorFeature() }
      )
    ] as const
  })
  const store = host.backend('redis')
  const items = store
    .use(vector)
    .collection<{ category: string }>('documents', { dimensions: 2, metric: 'cosine' })
  await items.upsert([{ id: 'guide', vector: [1, 0], payload: { category: 'guide' } }])
  const hits = await items.near([1, 0], { exact: true }).where({ category: 'guide' }).topK(1).all()
  console.log(hits[0]?.id)
  await store.use(ttl).expire({ channel: 'vector', collection: 'documents', id: 'guide' }, 60000)
} finally {
  await pool.close()
}
```

新集合给 dimensions/metric，随后连接通过 FT.INFO 读取实际配置。默认近邻索引用HNSW，exact:true用FLAT；相同FLOAT32字节进入两组字段。cosine/dot分数为1-distance，euclid为-sqrt(distance)。FLOAT32溢出、转换后为零的cosine方向在修改前拒绝。

组织TAG、期限NUMERIC在KNN排名中过滤；可忠实表达的scalar条件下推，其它条件或函数仅过滤引擎命中，不补搜。requirePushdown在I/O前拒绝客户端条件，minScore是有界客户端阈值。payload保留完整便携编码，scalar索引字段按需通过FT.ALTER增加。相似/推荐查询读取指定样本后生成方向，不保证其它候选被补搜。

Search 的TAG token上限4096字节。超过上限的规范等值/成员条件不承诺下推；普通where仍可过滤topK命中，requirePushdown报QUERY_NOT_PUSHABLE；deleteWhere与原生search.filter在I/O前报UNSUPPORTED_CAPABILITY。完整payload、ID与物理键不截断。样本排除使用SHA-256短TAG，不承诺数学上零碰撞。

vector TTL使用同一WATCH/EXEC：TIME生成绝对期限，HASH字段与PEXPIREAT一起写，普通upsert保期限，persist同时清期限字段和原生expiry。根与真实事务TTL都接受vector target，但向量集合不因此获得通用事务能力。deleteWhere默认precount，两种count模式都分页找点后实际删除，只返回存在并提交删除的数量；原生已过期HASH不计数。

## 驱动、清理和错误

宿主默认自动检测。设置 autoDetect:false 时，使用所选后端能力前先 await host.detect()。版本满足不等于安装了 Search 模块。

nodeRedisDriver接受node-redis 6的pool；ioredisDriver接受ioredis 6 client；bunRedisDriver接受Bun RedisClient，分别从/node-redis、/ioredis、/bun导入。它们借用已连接客户端，不关闭原对象。ioredis内部连接禁用未确认命令重发；node-redis保留同一pool租约和EXEC逐项错误；Bun在MULTI前拒绝二进制输入。根入口不加载SDK，每个订阅消耗独立连接。

标准记录字段查询在客户端执行，不提供标准secondaryIndexes、SQL或RDF。文本/字节缺失为null，记录为undefined。物理索引可能残留已过期条目，读取会核对真实键；前缀删除使用有序索引，inspectLocks和部分清理需SCAN，成本包含实际扫描候选。

本包错误source为storage.backend.redis，REDIS_FAILED表示原生命令/连接/EXEC故障，TRANSACTION_FAILED表示未分类的业务回调/草稿失败，DECODE_FAILED表示协议或持久化数据不能解码。共享契约、host和本包已有错误保留身份，原始错误沿cause可达。dispose重复返回同一主Promise，符号释放用另一个报告型Promise，只清理自有订阅和租约。

## 可选日志边界

host journal可以选择提交后外置binlog和遥测。只有EXEC全部成功才追加成功提交日志；原生部分错误或未知结果不追加、不重放。binlog失败经report报告，不能撤回已提交数据，外置日志与业务数据并非强原子提交。标准值、字节、记录与向量的镜像保留实际wire和绝对期限；历史向量完整before镜像需要二进制端口，缺少时此日志组合在修改前拒绝。

此后端明确nativeAtomic:false。要求同EXEC强原子binlog、WAL intent/marker或undo的组合当前拒绝，不得当作已支持能力。storageLogStore单独从`@migaia/storage-host/plugins/journal`导入，每次在原生命名空间读当前索引；多个实例可共用namespace和连续序号，不跨操作缓存索引。原生Feature API不冒充标准业务通道的日志来源。遥测显式启用，根操作和完整事务跨重试各记一次；logger及载体仍由调用方在host之后释放。
