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
      features: {
        batch: batchFeature({ maxSize: 20 }),
        retry: retryFeature({ attempts: 3, backoff: 200 }),
        timeout: timeoutFeature({ ms: 10000 })
      }
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

`features` 使用 plugin-host 原生 record：`{ alias: feature }`。每个 feature 都是 `defineFeature` 返回的 opaque token；插件负责安装，并通过 host 与插件 handle 的 `http_alias_method` 扩展公开控制方法。运行时状态由每次安装独立拥有，例如 `threshold` alias 对应 `http_threshold_setLevel`。全局默认策略由 `@migaia/log-host/plugin` 的非输出插件 `defineLogPlugin({ name, features })` 声明，再传入 `createLogHost({ plugins: [...] })`；输出端只覆盖全局 record 中同 key 的 feature，不按工厂类别覆盖。不同 key 的 gate 会同时生效。host-wide carrier 之间同 key 冲突；每个输出在实际安装、按 key 合并后最多有一个 format、一个 batch、一个 retry 和一个 timeout，冲突以既有 `INVALID_OPTION` 拒绝。不再支持 `createLogHost({ features })` 或 feature 数组。
