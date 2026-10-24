# Qdrant 存储后端

为 `@migaia/storage-host` 提供原生 Qdrant 向量与向量期限。需要真实 Qdrant 服务及 `@qdrant/js-client-rest` 1.11 或更新版本。SDK 是必需 peer，只有显式 `/client` 适配入口在运行时访问它。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'

await using host = await createStorageHost({
  plugins: [qdrantBackendPlugin({ url: 'http://127.0.0.1:6333' })] as const
})
const documents = host
  .backend('qdrant')
  .use(vector)
  .collection<{ category: string }>('documents', { dimensions: 2, metric: 'cosine' })
await documents.upsert([{ id: 'a', vector: [100, 0], payload: { category: 'guide' } }])
console.log(await documents.near([1, 0], { exact: true }).topK(5).withVector().all())
```

collection 在执行前是纯描述。Cosine 使用原生搜索槽与原样本槽，使 `withVector`、`similarTo` 及标准均值推荐保留输入幅度，精度以原生 float32 为界。Dot、Euclid 使用一个原生槽；Euclid 距离取负成为分数。后端不在 JavaScript 中给候选评分。

| 入口                   | 用途                                                       |
| ---------------------- | ---------------------------------------------------------- |
| 根                     | `qdrantBackendPlugin`、`qdrantBackendKind`、错误身份与类型 |
| `/http`                | 基于运行时 fetch 的 `fetchHttp(url, apiKey?)`              |
| `/client`              | 借用真实 SDK 客户端的 `qdrantClientHttp(client)`           |
| `/features/hybrid`     | 两个原生 dense/sparse RRF 分支及仅 sparse 更新             |
| `/features/recommend`  | 原生 `best_score`、lookup 与样本语义                       |
| `/features/group-by`   | 原生多值分组，不提供 `with_lookup`                         |
| `/features/management` | 集合、别名、快照、按条件删除及显式清理过期点               |

仅提供 `vector` 与 vector 目标的 `ttl`。没有 KV、records、RDF、事务、二级索引、change feed 或原生 live 查询；需要轮询时使用既有 host reactive Feature。显式锁与并发策略组合在原生修改前拒绝。

删除计数、TTL、组织隔离、检测及失败边界见 [USEGUIDE.md](./USEGUIDE.md)。

删除与标准推荐通过共享向量输入拥有者捕获稠密字符串 ID 数组；原生请求仍按首次出现去重。删除计数选项复用同一准入，不改变 precount 或 scroll 行为。

SDK 请求发出后，取消不会撤销原生修改；即使调用方随后取消，请求仍可能成功返回。后端释放等待该真实结果，响应丢失时保留结果未知且不自动重放。hooks 的同步异常或异步拒绝仅上报，介入操作使用宿主原 pipeline。

## 原生命名向量重排

`@migaia/storage-plugin-qdrant/features/rescore` 的 `qdrantRescoreFeature` 在安装时按逻辑集合声明一个额外向量槽。`dimensions` 必填，`metric` 默认 `cosine`；`multivector: 'max_sim'` 选择多向量，否则使用 dense。只接受顶层 `collections` 映射中声明的集合。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { qdrantRescoreFeature } from '@migaia/storage-plugin-qdrant/features/rescore'
await using host = await createStorageHost({
  plugins: [
    qdrantBackendPlugin(
      { url: 'http://localhost:6333' },
      {
        rescore: qdrantRescoreFeature({
          collections: { articles: { dimensions: 2, metric: 'dot' } }
        })
      }
    )
  ]
})
const store = host.backend('qdrant')
const articles = store.use(vector).collection('articles', { dimensions: 2, metric: 'dot' })
await articles.upsert([
  { id: 'a', vector: [2, 0] },
  { id: 'b', vector: [1, 0] }
])
await store.api.qdrantRescore.updateVectors('articles', [
  { id: 'a', vector: [0, 1] },
  { id: 'b', vector: [3, 0] }
])
const hits = await articles
  .near([1, 0])
  .topK(10)
  .rescore({ query: [1, 0], topN: 2 })
  .all()
console.log(hits.map((hit) => ({ id: hit.id, score: hit.score })))
```

`updateVectors(collection,points,ctx?)` 只更新当前组织已存在点的额外槽，使用 `wait:true`，返回原生 `operation_id/status` 操作记录，不改变 search/source、payload 或 TTL。重复 ID、非稠密数组和非法向量在 I/O 前拒绝。多向量写入与 query 使用非空二维数组，内层维度一致。原生缺点错误及未知写结果沿原错误链，不自动重试。

`rescore` 只可接在 `topK(k)` 后；`topN` 默认 k，必须为不大于 k 的正安全整数。每次终点只发一次 Query API：prefetch 使用原 search 槽、k、可下推 where、组织、期限与原 minScore；outer 使用额外槽并取 topN。`score` 是 outer 引擎分数；prefetch 分数不由协议返回。函数 where 在 outer 命中后由原共享 reader 执行且不补搜，因此可能不足 topN。`withVector()` 仍返回原标准向量，之后可接通用 `rerank`，后者保留当前引擎 score 并新增 rerankScore。

Qdrant 1.15.5 必须在集合首次创建时声明额外槽，不能在线给旧集合补槽。已有缺槽或配置不符集合的新操作报 `UNSUPPORTED_CAPABILITY`，原标准读写保持可用；不会重建集合或迁移数据。标准 upsert 仍整点替换，可能清除额外槽，应用需在其后重写额外向量。移除 Feature 后标准读写仍保留此原替换语义。额外槽检索及分数由 Qdrant 完成，不在 JavaScript 评分。

Qdrant 1.15.5 对首行全为非负整数的两行多向量矩阵存在原生 JSON 歧义：它可能把矩阵解码为 sparse vector 并拒绝。适配器保留原 QDRANT_REQUEST_FAILED 证据，不变形向量或重试；本版本的三行矩阵与 dense 向量已实际验证。

原生 filter 无法精确表达的条件在 precount 或 management `deleteByFilter` 前以 source `@migaia/storage-contract`、code `UNSUPPORTED_CAPABILITY` 拒绝。显式 `count: 'scroll'` 通过扫描当前组织支持共享条件；`requirePushdown()` 对客户端条件仍报 `QUERY_NOT_PUSHABLE`。
