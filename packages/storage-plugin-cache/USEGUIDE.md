# 多级缓存契约

`cacheKey(...parts)` 复用原 portable serializer 投影，保留参数顺序，对规范 JSON 字节取 SHA-256。对象字段顺序不同但内容相同时，得到相同小写十六进制键。不支持的值保留 serializer 原错误。

```ts
import { cacheKey, type ICacheOptions } from '@migaia/storage-plugin-cache'
const key = await cacheKey('response', { model: 'model-one', version: 1 })
const options: ICacheOptions = { tiers: [{ backend: 'memory', ttlMs: 30000 }] }
console.log(key, options.tiers.length)
```

层配置引用更早批次已发布的后端。缓存 kind 不授予原生层 client 或事务拥有权。`CacheWriteMode` 定义 through 与 back 写入。单次策略只能缩短配置期限；可选随机源供原 jitter helper 使用。错误领域为 `storage.backend.cache`，配置、回源与嵌入失败使用独立登记码，回调原错误通过 cause 可达且保留原生错误类型。
