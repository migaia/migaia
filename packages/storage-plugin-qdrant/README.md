# @migaia/storage-plugin-qdrant

把应用向量及其属性保存到真实 Qdrant 服务，通过查询链完成近邻搜索、筛选和支持的重排，减少业务代码手写原生请求与组织条件的重复工作。将配置服务地址的插件安装到 host 后，再选择 vector 能力和集合；标准查询在排名前处理组织与期限条件，过期数据的物理清理由应用显式执行。

## 你可能遇到过

- 搜索返回其他租户的点，某次原生请求漏了组织条件。
- 近邻数量不足，筛选发生在引擎选完候选之后。
- 过期向量仍占磁盘，把查询不可见误当成物理删除。
- 增加重排向量后旧集合报错，原生集合没有对应的命名槽。

## 为什么选它

- 标准查询在原生排名前加入组织与期限条件，见[组织隔离](./USEGUIDE.md#组织隔离)。
- `explain()` 区分原生筛选与命中后筛选，`requirePushdown()` 可拒绝客户端步骤，见[搜索与筛选](./USEGUIDE.md#搜索与筛选)。
- 原生重排支持两行全整数 multivector，float JSON 编码消除 sparse tuple 歧义，见[多向量重排](./USEGUIDE.md#多向量重排)。
- 删除计数显式区分预统计和分页收集，见[期限与删除](./USEGUIDE.md#期限与删除)。

## 从这里开始

先运行 Qdrant 服务。默认连接 `http://127.0.0.1:6333`；服务地址不同时，设置环境变量 `QDRANT_URL`。下面写入一条向量并读取近邻 ID。

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
await documents.upsert([{ id: 'a', vector: [2, 0], payload: { category: 'guide' } }])
console.log((await documents.near([1, 0], { exact: true }).topK(1).all())[0]?.id)
```

预期输出：

```text
a
```

需要 payload 条件看[搜索与筛选](./USEGUIDE.md#搜索与筛选)，需要第二阶段检索看[多向量重排](./USEGUIDE.md#多向量重排)。

## 手写时的隐患

直接发送原生 HTTP 时，这些边界需要自行处理。这里只展示，不执行。

```ts doc-test=check
export async function writePoint(url: string) {
  const response = await fetch(url + '/collections/articles/points?wait=true', {
    method: 'PUT',
    body: JSON.stringify({ points: [{ id: 1, vector: [1, 0] }] })
  })
  // 隐患：没有组织映射，逻辑 ID 共享同一物理集合。
  // 隐患：未检查 HTTP 状态，拒绝响应也会被当成成功。
  return response.json()
}
```

后端处理托管点身份、组织条件与原生错误。应用仍需决定如何处理已发送但结果未知的修改。

## 三分钟心智模型

| 工具                        | 什么时候用                                    |
| --------------------------- | --------------------------------------------- |
| `qdrantBackendPlugin`       | 把一个真实连接加入 storage host。             |
| `collection(name, options)` | 描述逻辑集合，首次执行核对或创建真实 schema。 |
| `near(...).topK(k)`         | 让引擎选择 k 个候选。                         |
| `where` / `explain`         | 添加条件并检查客户端步骤。                    |
| `store.use(ttl)`            | 管理单个向量的可见期限。                      |
| Feature                     | 选择本后端独有的原生功能。                    |

逻辑集合是应用使用的名字；物理集合是带 `collectionPrefix` 的 Qdrant 集合。释放 host 等待请求结束，不删除持久数据。

## 典型场景

| 场景             | 怎么组合                           | 详细说明                               |
| ---------------- | ---------------------------------- | -------------------------------------- |
| 带分类的文档搜索 | `near` + `where` + `topK`          | [搜索与筛选](./USEGUIDE.md#搜索与筛选) |
| 限时推荐与删除   | `ttl` + `deleteWhere`              | [期限与删除](./USEGUIDE.md#期限与删除) |
| 额外向量重排     | `qdrantRescoreFeature` + `rescore` | [多向量重排](./USEGUIDE.md#多向量重排) |
| 多组织共用集合   | `host.org(id)`                     | [组织隔离](./USEGUIDE.md#组织隔离)     |

## 安装

当前包为 `private: true`，用于本仓库 workspace，尚不能假定已发布到 registry。在同一 workspace 的应用目录安装相邻包，再安装真实 SDK peer：

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-qdrant
pnpm add @qdrant/js-client-rest@^1.11.0
```

需要 Node.js 24 或更新版本，Qdrant 协议最低 1.11。默认 fetch 入口不在运行时加载 SDK；显式 `/client` 入口借用真实 `QdrantClient`。多向量示例使用 Qdrant 1.15.5 支持的能力。

## 常用 API

| API                                       | 用途                               |
| ----------------------------------------- | ---------------------------------- |
| `qdrantBackendPlugin(options, features?)` | 连接、命名空间和可选功能。         |
| `collection.upsert(points, options?)`     | 写入向量和 payload。               |
| `collection.near(query).topK(k)`          | 创建近邻查询。                     |
| `similarTo(id)` / `recommend(...)`        | 使用已存样本创建标准查询。         |
| `deleteWhere(where, options?)`            | 条件删除与数字计数。               |
| `store.use(ttl)`                          | `expire`、`persist`、`remaining`。 |

## 契约细节

只提供 `vector` 和向量目标的 `ttl`，没有 KV、records、RDF、事务、二级索引、change feed 或原生 live 查询。显式锁及不支持的并发策略在原生修改前拒绝。

`url` 必填；`id` 默认 `qdrant`，`collectionPrefix` 默认 `migaia_`。`apiKey`、自备 `http` 可选。自备 HTTP/SDK client 由调用方管理，host 不关闭它们。默认创建 host 时检测；关闭自动检测后，先 `await host.detect()`。

错误 source 为 `storage.backend.qdrant`。原生 4xx、网络/5xx、坏响应分别为 `QDRANT_REQUEST_FAILED`、`QDRANT_UNAVAILABLE`、`QDRANT_RESPONSE_INVALID`。原错误留在原因链。取消不能撤销已发送修改，不自动重放；释放等待真实结果。详见[使用指南](./USEGUIDE.md)。
