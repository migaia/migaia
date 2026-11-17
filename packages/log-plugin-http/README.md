# @migaia/log-plugin-http

[English](./README.en.md)

把日志用 HTTP POST 发到日志服务的输出插件，配合 `@migaia/log-host` 使用。本包每次交付只发一个请求；攒批、失败重试和超时由 host 的 Feature 提供，和其他输出共用同一套规则。

## 你可能遇到过

- **每条日志一个请求，日志服务被打满**：高峰时请求数和日志条数一样多。根因是没有攒批。
- **日志服务短暂 503，这段时间的日志全丢了**：发送失败后没有重试，或者重试时无视服务返回的 `Retry-After`，把服务压得更死。根因是重试规则不区分错误类型，也不听服务端的节奏。

## 从这里开始

下面注入一个假的 `fetcher` 代替真实网络：第一次返回 503，之后返回 200。用 Node 24 直接运行。

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature, retryFeature } from '@migaia/log-host/features'
import { httpPlugin } from '@migaia/log-plugin-http'

let calls = 0
const log = createLogHost({
  plugins: [
    levelPlugin(),
    httpPlugin({
      url: 'https://logs.example.invalid/ingest',
      // 测试用的假网络：第一次 503，之后 200；不写 fetcher 时使用全局 fetch
      async fetcher(_url, init) {
        calls += 1
        const { entries } = JSON.parse(init.body)
        console.log(`第 ${calls} 次请求，带 ${entries.length} 条日志`)
        const status = calls === 1 ? 503 : 200
        return { ok: status === 200, status, headers: new Headers() }
      },
      features: {
        batch: batchFeature({ maxSize: 2 }), // 每 2 条攒成一个请求
        retry: retryFeature({ attempts: 3, backoff: 0 }) // 含第一次在内最多 3 次
      }
    })
  ]
})
log.info('order created')
log.info('payment captured')
await log.shutdown('manual')
```

输出：

```text
第 1 次请求，带 2 条日志
第 2 次请求，带 2 条日志
```

两条日志被攒成一个请求。第一次收到 503 后按 `retryFeature` 重试，第二次成功。`shutdown()` 等这一批送达后才完成。

## 常用选项

| 选项              | 说明                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | 原样传给 fetcher                                                                                                                                    |
| `fetcher`         | 默认 `globalThis.fetch`；接收 `(url, { method, headers, body, signal })`，返回带 `ok`、`status`、`headers.get` 的结果。超时和关闭通过 `signal` 传递 |
| `headers`         | 创建时复制；默认 `Content-Type: application/json`                                                                                                   |
| `authToken`       | 非空时设置 `Authorization: Bearer <token>`                                                                                                          |
| `maxRetryAfterMs` | 服务端 `Retry-After` 的上限，默认 30000                                                                                                             |
| `features`        | 本输出的策略，通常是 `batchFeature`、`retryFeature`、`timeoutFeature`                                                                               |

## 契约细节

- 请求体始终是 `{ "entries": [...] }`。每条 entry 的 `error` 用 host 的共享投影写出整条错误链（`source`、`code`、`name`、`message`、`stack`、`cause`、`errors`）。
- HTTP 不消费格式化文本，host 的格式阶段对它跳过；在本插件的 `features` 里写 format 会在安装时被拒绝。
- 网络错误、429 和 5xx 可以重试，其他状态不重试；`attempts` 包含第一次请求。合法的 `Retry-After`（秒数或 HTTP 日期）覆盖普通退避间隔，并受 `maxRetryAfterMs` 限制。
- 没有 `retryFeature` 就不重试，没有 `batchFeature` 就不攒批，没有 `timeoutFeature` 就不另设超时。
- 没有任何可用 fetcher、`maxRetryAfterMs` 非法时，创建时同步抛出。运行期的发送和序列化错误进入 host 的失败通道，不让日志方法抛出、也不让 `flush()` 拒绝。错误域是 `logging.http`（`LOG_HTTP_ERROR_SOURCE`），错误码见 `LogHttpErrorCode`。
- `features` 写成 `{ 名称: feature }` 记录；控制方法以 `http_<名称>_<方法>` 挂在 host 上。host 级默认策略和覆盖规则见 [log-host 的组合策略](../log-host/README.md#组合策略)。

完整配置与错误边界见 [使用指南](./USEGUIDE.md)。
