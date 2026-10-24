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
