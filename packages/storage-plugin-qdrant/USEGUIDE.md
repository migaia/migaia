# Qdrant 使用指南

先运行真实 Qdrant 服务。示例默认连接 `http://127.0.0.1:6333`；服务地址不同时，设置环境变量 `QDRANT_URL`。每例使用新的集合名并写数据，释放 host 不删除集合。

## 按场景查找

| 需求                      | 场景                      |
| ------------------------- | ------------------------- |
| 按 payload 搜索并取回向量 | [搜索与筛选](#搜索与筛选) |
| 设置期限或条件删除        | [期限与删除](#期限与删除) |
| 额外 multivector 排名     | [多向量重排](#多向量重排) |
| 共用集合隔离组织          | [组织隔离](#组织隔离)     |

## 搜索与筛选

分类条件应尽量在引擎排名前执行；客户端条件只能筛掉已返回的命中。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' })]
})
const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([
  { id: 'a', vector: [2, 0], payload: { category: 'guide' } },
  { id: 'b', vector: [1, 0], payload: { category: 'news' } }
])
const query = documents.near([1, 0], { exact: true }).where({ category: 'guide' }).topK(2)
const hits = await query.withVector().all()
console.log(hits.map((hit) => hit.id).join(','))
console.log(hits[0]?.vector?.join(','))
```

预期输出：

```text
a
2,0
```

`dimensions` 是维度，`metric` 可为 cosine、dot、euclid。省略整个 options 时读取已有 schema，不匹配时拒绝。构造 collection 不发 I/O。`exact` 默认 false，true 请求原生精确检索；`topK(k)` 要求正安全整数。低层 `search(query, {k: 0})` 返回空且不发送搜索。

`near` 使用查询向量；`similarTo(id)` 读取原样本；标准 `recommend` 用正样本均值减负样本均值构成查询。Cosine 使用搜索槽和原样本槽，`withVector()` 保留输入幅度，受原生 float32 精度限制。Euclid 距离取负成为 score。标准 `groupBy` 只处理已选出的 top-k 命中。

可精确表达的标量相等、成员、存在性和数字范围在引擎执行。字符串范围、子串/前缀条件和函数 where 在命中后执行，不补搜，可能少于 k。`explain()` 展示两者；`requirePushdown()` 遇到客户端步骤报 `QUERY_NOT_PUSHABLE`，不会先发搜索。payload 不能覆盖根路径 `$org`、`$expiresAt`。portable payload 与任意 UTF-16 字符串 ID 通过统一 codec 往返。upsert 在请求前验证整批，重复 ID 保留最后一个已验证点；删除和标准推荐的重复 ID 按首次出现去重。

## 期限与删除

下面把临时点改成永久点，再扫描删除，不依赖计时器恰好到期。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl, DeleteCountMode } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' })]
})
const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([{ id: 'a', vector: [1, 0], payload: { category: 'guide' } }], {
  ttlMs: 60_000
})
const ttlApi = host.backend('qdrant').use(ttl)
const target = lockKey.vector(name, 'a')
console.log(await ttlApi.persist(target))
console.log(await ttlApi.remaining(target))
console.log(await documents.deleteWhere({ category: 'guide' }, { count: DeleteCountMode.scroll }))
```

预期输出：

```text
true
undefined
1
```

`ttlMs` 为非负毫秒数，0 立即不可见。省略时保留活点期限；新点或已过期点没有期限。`expire`、`persist` 对缺失或已过期点返回 false；`remaining` 对缺失或无限期点返回 undefined。只支持 `lockKey.vector(collection, id)`。客户端墙钟决定期限，时钟偏差会影响结果；没有后台物理删除任务。

删除包含仍物理存在的过期点。默认 precount 先 exact count，再以同一 filter 做 wait:true 删除；并发修改可能让计数不同于最终删除量。scroll 在删除前逐页收集匹配 ID，再按 ID 批删，返回成功提交的 ID 数。扫描不是快照：新点可能被读到或留下，收集后变得不匹配的 ID 仍会删除。

precount 与管理 `deleteByFilter` 无法精确表达条件时，报 source `storage.contract`、code `UNSUPPORTED_CAPABILITY`。通用条件可显式选 `count: 'scroll'`，扫描当前组织候选并执行共享 predicate。

## 多向量重排

先用标准向量召回，再用额外 multivector 槽选择最终结果。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { qdrantRescoreFeature } from '@migaia/storage-plugin-qdrant/features/rescore'

const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
await using host = await createStorageHost({
  plugins: [
    qdrantBackendPlugin(
      { url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' },
      {
        rescore: qdrantRescoreFeature({
          collections: { [name]: { dimensions: 2, metric: 'dot', multivector: 'max_sim' } }
        })
      }
    )
  ]
})
const store = host.backend('qdrant')
const documents = store.use(vector).collection(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([
  { id: 'a', vector: [2, 0] },
  { id: 'b', vector: [1, 0] }
])
await store.api.qdrantRescore.updateVectors(name, [
  {
    id: 'a',
    vector: [
      [0, 1],
      [0, 1]
    ]
  },
  {
    id: 'b',
    vector: [
      [3, 0],
      [3, 0]
    ]
  }
])
const hits = await documents
  .near([1, 0])
  .topK(2)
  .rescore({
    query: [
      [1, 0],
      [1, 0]
    ],
    topN: 1
  })
  .all()
console.log(hits.map((hit) => hit.id).join(','))
```

预期输出：

```text
b
```

安装时 `collections` 按逻辑名称声明额外槽。`dimensions` 必填；`metric` 默认 cosine；`multivector: 'max_sim'` 选择非空二维向量，省略则为 dense。只接受声明过的集合。两行全整数矩阵可用于更新和查询；fetch 与 SDK 适配器把 multivector 数字编码为 `1.0` 等 float JSON 字面量，不改变数值、payload 或 sparse indices。

`updateVectors` 只更新当前组织已存在点的额外槽，wait:true，返回原生操作结果，不改标准向量、payload 或期限。重复 ID、空/不规则矩阵、非法数字在请求前拒绝。`rescore` 接在 `topK(k)` 后，`topN` 默认 k，必须是 1 到 k 的安全整数。一次终点使用一个 Query API 请求：prefetch 使用原搜索槽、组织、期限、可下推条件与 minScore 召回 k，outer 返回 topN。score 是最终引擎分数；函数 where 在 outer 命中后执行且不补搜。`withVector()` 仍返回标准向量；通用 `rerank` 另加 rerankScore。

Qdrant 1.15.5 必须在集合首次创建时声明额外槽。旧集合缺槽或配置不符时，新功能报 `UNSUPPORTED_CAPABILITY`；不会重建集合或迁移数据，标准读写仍可用。标准 upsert 整点替换，可能清除额外槽，应在其后重写额外向量。

## 组织隔离

相同逻辑 ID 可以在两个组织分别存储。组织条件在排名前执行。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333' })]
})
const name = 'guide_' + crypto.randomUUID().replaceAll('-', '')
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>(name, { dimensions: 2, metric: 'dot' })
const tenant = host
  .org('11111111-1111-4111-8111-111111111111')
  .backend('qdrant')
  .use(vector)
  .collection(name, { dimensions: 2, metric: 'dot' })
await documents.upsert([{ id: 'a', vector: [1, 0] }])
await tenant.upsert([{ id: 'a', vector: [2, 0] }])
console.log((await documents.near([1, 0]).topK(1).all())[0]?.score)
console.log((await tenant.near([1, 0]).topK(1).all())[0]?.score)
```

预期输出：

```text
1
2
```

组织视图共享物理集合，不为每个组织创建集合或索引。`dropOrg(id)` 在当前 collectionPrefix 中发现托管集合，仅清理该组织，包含过期点，保留共享集合及其他组织。

## 选择原生功能

工厂第二参数选择 Feature，增加 store.api 下的方法，没有事务投影。

| 子入口与工厂                                          | API 与边界                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/features/hybrid` · `qdrantHybridFeature()`          | qdrantHybrid.query 恰好两个 named dense/sparse prefetch 分支，fusion 为 rrf；updateSparseVectors 只更新已配置 sparse 槽，indices 为唯一非负整数且与有限 values 等长。 |
| `/features/recommend` · `qdrantRecommendFeature()`    | qdrantRecommend.recommend 保留 best_score、lookup 与原生样本策略。                                                                                                    |
| `/features/group-by` · `qdrantGroupByFeature()`       | qdrantGroupBy.search 保留原生多值分组，不提供 SDK 1.11 未转发的 with_lookup。                                                                                         |
| `/features/management` · `qdrantManagementFeature()`  | 集合、别名、快照与显式删除。                                                                                                                                          |
| `/features/rescore` · `qdrantRescoreFeature(options)` | 额外槽更新与查询链重排。                                                                                                                                              |

自管原生方法使用物理 collection 名，仅默认组织可用。管理 `deleteByFilter(logicalCollection, where, options?, ctx?)` 与 `purgeExpired(logicalCollection, options?, ctx?)` 也可按组织执行。前者不加存活条件；后者一次采样墙钟清理过期点。两者无 count/scroll，返回 `{operationId, status}`；wait 默认 true，filter 删除的 ordering 可为 weak、medium、strong。operationId 不是删除数；其他方法保留原生 boolean/可空 snapshot。

## 连接与失败处理

根默认使用 fetch。`/http` 的 `fetchHttp(url, apiKey?)` 可创建端口；`/client` 的 `qdrantClientHttp(client)` 借用真实 SDK client，不改其配置，也不关闭它。SDK 1.11 没有 per-call signal，已发请求必须等待真实结算；fetch 接收操作取消信号。关闭拒绝新调用，等待实际请求与 iterator。检测检查标准 vector、TTL 和组织清理所需方法；可选原生 Feature 方法在调用时检查，缺少时在修改前报 UNSUPPORTED_CAPABILITY。

修改不自动重试，不跟随重定向。4xx 用 QDRANT_REQUEST_FAILED，网络/5xx 用 QDRANT_UNAVAILABLE，坏响应用 QDRANT_RESPONSE_INVALID，source 为 storage.backend.qdrant。HTTP 保留可取得的 status/body；SDK 1.11 非等待 snapshot 遇到 202 可能丢失 status 并截断消息，此时 response-invalid 不代表操作未接受；fetch 返回原生 null。先核实原生状态，再决定是否重试。

hooks 仅观察，抛错或拒绝交给 report，不取消业务；修改行为使用 host pipeline。遥测不含认证头或正文。只有组织和期限保留路径强制建索引，动态 payload 路径可能没有索引；成本取决于引擎计划、候选数和传输字节。
