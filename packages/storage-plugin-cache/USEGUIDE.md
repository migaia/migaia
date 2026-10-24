# 多级缓存

`cachePlugin` 组合已经发布的存储后端。先在较早宿主批次安装各层，再安装缓存，并显式调用 `host.detect()`。

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin, cacheKey } from '@migaia/storage-plugin-cache'

const original = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'memory' })] })
const host = await original.use(
  cachePlugin({
    tiers: [{ backend: 'memory', ttlMs: 30000 }],
    maxAgeMs: 30000,
    staleAfterMs: 10000,
    negativeTtlMs: 1000
  })
)
await host.detect()
try {
  const cache = host.backend('cache')
  const key = await cacheKey('response', { model: 'model-one', version: 1 })
  const value = await cache.getOrLoad(
    key,
    async (signal) => {
      if (signal.aborted) return undefined
      return { answer: 42 }
    },
    { meta: { model: 'model-one' } }
  )
  console.log(value, await cache.peek(key), cache.stats())
  await cache.invalidate(key)
} finally {
  await host.dispose()
}
```

层按从快到慢排列。through 写入从最慢层向上完成；back 写入按键合并，由宿主 scheduler 刷出，失败只报告并丢弃，不重试。最慢层必须为 through。`flush()` 立即处理待写项；释放时等待已准入工作、刷出一次、取消订阅，不关闭借用层。

缓存提供最终一致与失效通知，不提供跨 store 原子提交，也不声明事务。建议专用后端实例，避免宽业务通知清除无关缓存副本。变更流之上的层必须设置硬 TTL，限制漏通知的陈旧上界；可靠变更流沿后端原游标协议。

逻辑键只接受字符串。平铺 `get` 只读取平铺 `set` 写入的条目；codec 值与负条目经 `getOrLoad`、`getOrLoadEntry` 和 `peek` 访问。`cacheKey` 复用原 portable serializer 与 SHA-256，对象字段顺序不影响结果，非法值保留原 serializer 错误。

## 条目策略

单次 `ttlMs`、`maxAgeMs`、`staleAfterMs`、`negativeTtlMs` 只能缩短配置上界；延长时报 `CACHE_TIER_INVALID`。`jitterRatio` 在零至 0.5 之间，复用原数值 helper 只缩短期限；可注入 `clock`、`random`。旧值立即返回，共享一次后台刷新。仅配置负缓存期限时缓存 undefined；`cacheIf` 返回 false 则跳过全部层。

`mode: 'refresh'` 跳过读取，作废旧普通回源并合并已有刷新；`mode: 'bypass'` 只回源。单个调用方取消只让自身以 contract `ABORTED` 拒绝，共享任务只接收缓存关闭 signal。回源与编码失败以 `CACHE_LOAD_FAILED` 保留原 cause 与原生错误类型。

`getOrLoadMany` 去重输入键，每个经过的层调用一次原生 `getMany`，每个 through 回填层调用一次 `setMany`；缺失键进入与单键相同的单飞 Map，共享一次批量回源。`maxEntryBytes` 让超限条目跳过对应层。

`stampedeLock` 选取支持真实事务与键锁的层，由原事务锁内复查并把 TTL 写在同一 draft。物理重放可能再次回源，不承诺 exactly-once；锁与事务原错误保持。

`tagIndex` 选 records 与 TTL 后端。先写标签记录，再写缓存值；索引失败报告并跳过值写入。`invalidate({ tag })` 只迭代该标签范围。`offload` 选 blob 后端且要求层 TTL：达到 `minBytes` 的编码内容以 SHA-256 对象键存储，值层只存引用。失效只删除引用，显式 `sweepOffload()` 清理旧对象；共享对象后端按各引用层最长 TTL 保留。

观察事件为 `onCacheHit`、`onCacheMiss`、`onCacheLoad`、`onCacheInvalidate`、`onCacheTierError`、`onCacheWriteBackDropped`，只含数量与身份，不含键值。层失败降级为未命中或跳过写入，经宿主报告原诊断。组织视图把所有层路由到同一不可变宿主组织上下文。

带计数的 KV `removeByPrefix` 仅单层可用；多层在 I/O 前报 `UNSUPPORTED_CAPABILITY`，因为原生计数无法识别跨层重复逻辑副本。多层无计数删除使用 `invalidate({ prefix })` 或清空方法。`removeMany` 按已给出的不同逻辑键计数，多个副本只计一次。

各层条目同时以该层采样后的有效硬期限限制自身到期时间。原生 `expire` 失败会报告，不能留下可无限命中的副本。正数单次 TTL 在回源或写入前要求所有目标层具有 TTL 能力；共享 KV `setMany` 保留非负有限 TTL 域，零表示立即删除。

传播仅在显式检测阶段订阅。可靠源的游标写入紧邻上层的缺省组织，`$cache.cursor` 为内部元数据保留键。游标缺失或过期时先清除所管上层前缀，再从 now 继续。删除或游标持久化失败不保留积压队列：下一原生批次先清上层，再于成功后推进游标。仅游标过期会替换原生 tail 资源，不为断线启动重连定时器。

## 语义缓存

从 `@migaia/storage-plugin-cache/features/semantic` 导入 `semanticCacheFeature`，在 `cachePlugin` 第二参数中选择 `{ semantic: semanticCacheFeature(options) }`。向量后端必须在更早批次发布。配置 collection、维度、原生 metric、最低分与调用方嵌入函数。候选顺序沿原向量引擎，逐个执行 `accept`；复核失败只报告并跳过，不在 JavaScript 中计算向量分数。

`cache.api.semantic.set(prompt, value, { payload: { model: 'one' } })` 按 prompt 与模型元数据独立存储。`get` 可设置 `where`、`minScore`、一至十个 `candidates` 和异步 `accept`。`getOrLoad` 按组织、prompt 与规范 payload 合并回源，单调用取消不影响共享任务，并支持缩短 TTL 与 `cacheIf`。关闭时排空任务，不关闭借用的向量后端。`$cache.*` 为保留字段。

`invalidate(where, { count: 'scroll' })` 返回原 `deleteWhere` 数字，缺省保留 `precount`。删除包含物理仍存在的过期匹配点；Qdrant 两策略继承原并发边界，不强制切换、不重新计数、不承诺全局快照。原 context 与 count 由该原生删除拥有者单次校验；向量 TTL 由原 `upsert` 设置。
