# Qdrant 原生端口使用

## 借用 SDK 客户端

```ts
import { QdrantClient } from '@qdrant/js-client-rest'
import { qdrantClientHttp } from '@migaia/storage-plugin-qdrant/client'

const client = new QdrantClient({ url: 'http://127.0.0.1:6333' })
const http = qdrantClientHttp(client)
console.log(await http.getVersion())
```

需要真实的 `@qdrant/js-client-rest` 1.11 或更新版本。只有 `/client` 入口接触 SDK；HTTP 入口使用运行时 `fetch`。

## 失败语义

HTTP 4xx 为 `QDRANT_REQUEST_FAILED`，网络与服务不可用为 `QDRANT_UNAVAILABLE`，损坏的响应为 `QDRANT_RESPONSE_INVALID`。适配器保留完整响应、原生状态及 cause；不会记录 API key。未确认的写入失败由调用方处理，不会自动重试。

HTTP 端口向原生 fetch 转发取消信号。借用 SDK 的超时与取消能力由 SDK 决定；它没有单次请求信号接点时，仍等待实际请求结束。

SDK 1.11 的非等待快照遇到 202 时，会在自身中间件中抛出 `QdrantClientUnexpectedResponseError`；适配器保留该 cause 并报告 `QDRANT_RESPONSE_INVALID`。操作可能已经接受，不可自动重放。该 SDK 异常本身只保留可能截断的响应文案，不提供 status 或完整响应属性；需要完整响应证据时使用 HTTP 端口。
