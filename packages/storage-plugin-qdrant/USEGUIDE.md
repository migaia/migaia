# Qdrant 存储用法

## 查询与 payload

新建逻辑 collection 时声明真实维度与 `cosine`、`dot` 或 `euclid`。无 options 的描述在执行时读取既有原生 schema；不匹配时拒绝，不创建占位向量。`collectionPrefix` 缺省 `migaia_`，选择托管命名空间。

`near`、`similarTo`、标准 `recommend` 使用共享不可变链。`topK` 要求正安全整数；低层 `search(query,{k})` 也接受 0，且不发送搜索。`exact` 缺省 false，沿引擎原生索引；true 请求原生精确检索。标准 `groupBy` 只处理所选 top-k 命中；标准推荐读取请求的原样本，以共享正样本均值减负样本均值合成查询，不调用原生 `best_score`。

可忠实表达的标量相等、成员、存在性与数字范围在引擎排名前执行。字符串范围、子串/前缀条件及 JavaScript 函数只处理实际原生命中，不补搜，结果可少于 k。`explain()` 区分两者；需要客户端处理时，`requirePushdown()` 在原生读取前拒绝。仅组织与期限保留路径强制建立索引，任意动态标量路径可能未索引。真实成本取决于引擎计划、输入及输出字节。

portable payload 与任意 UTF-16 ID 由原 codec 往返。用户不能替换 payload 根 `$org`、`$expiresAt`。整批在 I/O 前快照与验证；重复 ID 保留最后一个已验证点。

## 期限与数字删除

```ts
import { ttl, lockKey, DeleteCountMode } from '@migaia/storage-contract'

await documents.upsert([{ id: 'temporary', vector: [1, 0], payload: { category: 'guide' } }], {
  ttlMs: 5000
})
const target = lockKey.vector('documents', 'temporary')
await host.backend('qdrant').use(ttl).expire(target, 10000)
console.log(await host.backend('qdrant').use(ttl).remaining(target))
await host.backend('qdrant').use(ttl).persist(target)
const deleted = await documents.deleteWhere(
  { category: 'guide' },
  { count: DeleteCountMode.scroll }
)
```

TTL 以一次客户端墙钟采样及原生 datetime payload 字段实现，客户端时钟偏差会影响期限。省略 `ttlMs` 时保留活点期限，新点或已过期点变为无限期；0 立即不可见。`remaining` 对缺失/无限期返回 undefined；`expire`、`persist` 对缺失/已过期返回 false。text、bytes、record TTL 目标不受支持。没有后台 timer 删除数据。

删除包含物理仍存在的过期点。缺省 `precount` 发送一次 exact count，再以同一 filter 做一次 wait:true 删除；并发写入会使预统计数不同于之后实际删除数。显式 `scroll` 在任何删除前收集原生各页实际读到的 ID，再按 ID 批删并返回成功提交的 ID 数。扫描期间新增点可能被读到，也可能保留；收集结束后未在集合中的新增 ID 不参与。已收集 ID 即使随后改为不匹配也会删除。

原生 precount 与管理 filter 删除对不能忠实表示的条件（如通用 `contains`、`startsWith`）在 I/O 前拒绝。对此可显式选 `scroll`，以共享 predicate 检查当前组织各页真实候选；成本包含扫描候选与所收集 ID。

## 原生 Feature

```ts
import { qdrantManagementFeature } from '@migaia/storage-plugin-qdrant/features/management'
import { qdrantHybridFeature } from '@migaia/storage-plugin-qdrant/features/hybrid'
import { qdrantRecommendFeature } from '@migaia/storage-plugin-qdrant/features/recommend'
import { qdrantGroupByFeature } from '@migaia/storage-plugin-qdrant/features/group-by'
```

将需要的 Feature 作为工厂第二参数，增加 `store.api.qdrantManagement`、`qdrantHybrid`、`qdrantRecommend`、`qdrantGroupBy`，没有 transaction API。原生方法使用调用方自管的物理 collection 名，保留真实 SDK 参数与结果类型。

Hybrid 接受恰两个 named dense/sparse prefetch 分支及 `{fusion:'rrf'}`。sparse 更新只接受已配置的 sparse 名，indices 是唯一非负整数，长度匹配且数值有限，不改 dense。原生推荐保留 lookup 与策略差异；原生分组保留多值成员语义，不提供 SDK 1.11 未转发的 `with_lookup`。

`qdrantManagement.deleteByFilter(logicalCollection,where,{wait?,ordering?},ctx)` 追加当前组织，不加存活过滤。`purgeExpired(logicalCollection,{wait?},ctx)` 仅一次采样墙钟，原生删除当前组织中早于此刻的期限点。两者零 count/scroll，返回 `{operationId,status}`，wait 缺省 true；operation ID 不代表删除数。其它管理方法保留原生 boolean 与可空 snapshot。

## 组织、释放与失败

`host.org(orgId).backend('qdrant')` 共享物理 collection，在原生排名前加租户条件；点身份包含 org。新组织不创建 collection 或索引。组织视图不能调用自管 collection 的原生 Feature 方法；`deleteByFilter`、`purgeExpired` 仍可按组织执行。`host.dropOrg` 发现当前配置命名空间内全部托管 collection，仅清理目标组织（含物理过期点），保留共享 collection 与其它命名空间。

缺省在 host 创建时检测；`autoDetect:false` 必须显式 `host.detect()`。未检测的业务终点拒绝且不发送隐式检测。服务端与 SDK 至少 1.11。

`dispose()` 封闭新调用，等待已接受的实际请求及 iterator。主释放与符号释放分别缓存 Promise，共用一次清理。后端从不关闭借用的 HTTP/SDK client。fetch 接收原操作取消信号；SDK 1.11 没有 per-call signal，必须等真实请求结算。写入不自动重试或跟随重定向，已发送失败的结果可能未知。

错误域 `storage.backend.qdrant`：原生 4xx 为 `QDRANT_REQUEST_FAILED`；网络/5xx 为 `QDRANT_UNAVAILABLE`；坏响应或意外响应为 `QDRANT_RESPONSE_INVALID`。保留原错误及适配端能取得的全部证据。HTTP 保留完整 status/body；SDK 1.11 的非等待 snapshot 遇到 202 时，自身 `QdrantClientUnexpectedResponseError` 会丢弃 status 并截断文案，适配器报告 response-invalid，但快照可能已接受。HTTP 端口对此返回原生 null。没有自动 fallback 或重放。hooks 只含净化路由、耗时与可取得的 status，不含认证头或正文。
