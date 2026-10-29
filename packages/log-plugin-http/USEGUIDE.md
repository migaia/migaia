# HTTP 使用指南

安装本包与相同版本的 `@migaia/log-host`。每次 deliver 只做一次 POST；策略由 host feature 组合。

```ts
import { createLogHost } from '@migaia/log-host'
import { batchFeature, retryFeature, timeoutFeature } from '@migaia/log-host/features'
import { httpPlugin } from '@migaia/log-plugin-http'

const log = createLogHost({
  plugins: [
    httpPlugin({
      url: 'https://example.test/logs',
      fetcher: globalThis.fetch,
      headers: { 'X-Application': 'example' },
      authToken: 'example-token',
      maxRetryAfterMs: 30000,
      features: {
        batch: batchFeature({ maxSize: 20 }),
        retry: retryFeature({ attempts: 3, backoff: 200 }),
        timeout: timeoutFeature({ ms: 10000 })
      }
    })
  ]
})
log.onFailure(({ error }) => {
  globalThis.console.error(error)
})
log.log('info', 'request complete')
await log.flush()
await log.shutdown('manual')
```

公开配置类型为 `IHttpPluginConfig`。url 原样传给 fetcher；缺省 fetcher 使用全局 fetch。注入函数接受 `(url, { method, headers, body, signal })` 并返回具有 ok/status/headers.get 的 Promise 结果。宿主超时和关闭通过 signal 传递；自定义 fetcher 应配合取消。

默认 Content-Type 为 application/json；headers 可覆盖，非空 authToken 再覆盖 Authorization 为 Bearer token。headers 在创建时复制。maxRetryAfterMs 默认为 30000，必须为有限非负数。

请求体始终为 `{ "entries": [...] }`。HTTP 调用 host 的共享 entry 投影；error 使用完整序列化错误链，保留 source/code/name/message/stack/cause/errors，排除 raw 和额外私有 Error 字段。普通业务字段保持原结构。HTTP 不消费格式化文本，跳过整个 host format 阶段；host 级 plain/pretty/JSON 格式不改变 wire。HTTP 的 output features 不能包含任何 format feature，否则创建时由 host 以 logging/INVALID_OPTION 拒绝。gate 与 entry 阶段照常执行。

网络错误、429 与 5xx 可重试，其它状态不重试。`attempts` 包含第一次请求。严格的 Retry-After 支持非负十进制秒数及三种 HTTP 日期；合法延迟覆盖普通 backoff 并按 maxRetryAfterMs 限制。没有 retryFeature 时不会隐式重试，没有 batchFeature 时不隐式聚合，没有 timeoutFeature 时不另设请求定时器。

`LOG_HTTP_ERROR_SOURCE` 为 logging.http；`LogHttpErrorCode` 包含 TRANSPORT_UNAVAILABLE、SERIALIZE_FAILED、DELIVERY_FAILED、INVALID_OPTION。缺少所有 fetcher、非法 maxRetryAfterMs 在创建时同步失败。运行期发送/序列化错误交给 host 失败通道，原生错误类型与 cause 保持可追溯；业务日志调用和 flush 不把交付失败重新抛出。交付失败与清理失败同时出现时，原交付错误排在错误链首位并用于重试分类；503 附带清理失败仍按配置重试。200 已成功而清理失败只报告一次 host 的 logging/DELIVERY_FAILED，不重发请求；timeout 自身错误也由 host logging 域负责。scheduler 必须在返回 receipt 之后才调用 callback。部署前应为 onFailure 提供业务需要的报告处理。

`features` 使用 plugin-host 原生 record：`{ alias: feature }`。每个 feature 都是 `defineFeature` 返回的 opaque token；插件负责安装，并通过 host 与插件 handle 的 `http_alias_method` 扩展公开控制方法。运行时状态由每次安装独立拥有，例如 `threshold` alias 对应 `http_threshold_setLevel`。全局默认策略由 `@migaia/log-host/plugin` 的非输出插件 `defineLogPlugin({ name, features })` 声明，再传入 `createLogHost({ plugins: [...] })`；输出端只覆盖全局 record 中同 key 的 feature，不按工厂类别覆盖。不同 key 的 gate 会同时生效。host-wide carrier 之间同 key 冲突；每个输出在实际安装、按 key 合并后最多有一个 format、一个 batch、一个 retry 和一个 timeout，冲突以既有 `INVALID_OPTION` 拒绝。不再支持 `createLogHost({ features })` 或 feature 数组。
