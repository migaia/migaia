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

带计数的 KV `removeByPrefix` 仅单层可用；多层在 I/O 前报 `UNSUPPORTED_CAPABILITY`，因为原生计数无法识别跨层重复逻辑副本。多层无计数删除使用 `invalidate({ prefix })` 或清空方法。`removeMany` 按已给出的不同逻辑键计数，多个副本只计一次。
