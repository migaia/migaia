# Qdrant 原生协议端口

使用 `/http` 的 `fetchHttp(url, apiKey?)`，或 `/client` 的 `qdrantClientHttp(client)` 访问有限的 Qdrant 原生接口。SDK 客户端由调用方持有和关闭；适配器不会改变其配置。

```ts
import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'

const http = fetchHttp('http://127.0.0.1:6333')
const version = await http.getVersion()
console.log(version)
```

原生方法保留 SDK 的参数和结果形状，并在最后接受可选的操作上下文。写请求不自动跟随重定向，也不重放。协议错误携带 `storage.backend.qdrant` 的错误身份及原始错误链。
