# @migaia/log-plugin-http

将日志交付到 HTTP POST 端点的可注入输出，与相同版本的 `@migaia/log-host` 配合使用。批量、重试和超时由 host feature 提供，本包只执行一次请求。

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature, retryFeature, timeoutFeature } from '@migaia/log-host/features'
import { httpPlugin } from '@migaia/log-plugin-http'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    httpPlugin({
      url: 'https://example.test/logs',
      features: [
        batchFeature({ maxSize: 20 }),
        retryFeature({ attempts: 3, backoff: 200 }),
        timeoutFeature({ ms: 10000 })
      ]
    })
  ]
})
log.info('request completed', { requestId: 'one' })
await log.flush()
await log.shutdown('manual')
```

请求体始终是 `{ "entries": [...] }`，每条 entry 的 error 字段由 host 的共享错误链投影处理。HTTP 不消费格式化文本，host 级格式对它跳过；请勿在 HTTP 的 features 中添加 format，创建时会以 host 的 INVALID_OPTION 拒绝。默认 fetcher 是 `globalThis.fetch`；没有任何 fetcher 时工厂同步拒绝创建。

网络失败、429 和 5xx 可由 `retryFeature` 重试。严格解析的 `Retry-After` 覆盖下一次普通 backoff，并由 `maxRetryAfterMs` 限制。`attempts` 包含首次请求。

运行期交付错误进入 host 失败通道；不会让日志方法抛错或让 `flush` 拒绝。完整配置与错误边界见 [使用指南](./USEGUIDE.md)。
