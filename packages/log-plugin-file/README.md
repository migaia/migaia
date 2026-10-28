# @migaia/log-plugin-file

为 `@migaia/log-host` 提供文件输出。默认将条目写成 NDJSON；批量、格式、重试和超时由 host feature 负责。

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { filePlugin } from '@migaia/log-plugin-file'

/** host 排空已接纳的日志后释放文件输出插件。 */
const log = createLogHost({
  plugins: [
    levelPlugin(),
    filePlugin({ path: './application.ndjson', features: [batchFeature({ maxSize: 20 })] })
  ]
})
log.info('request completed', { requestId: 'r1' })
await log.shutdown('manual')
```

Node 与 Bun 默认通过各自的 `node:fs/promises` 追加文件；Deno 使用 `Deno.writeTextFile(..., { append: true })`。browser/default 入口必须显式注入 `writer`，不加载原生文件模块。目标目录由应用准备。

`filePlugin({ path, writer?, rotate?, features? })` 在创建时检查配置。默认 writer 不提供轮转；配置 `rotate.maxBytes` 或 `rotate.maxEntries` 时，注入的 writer 必须实现 `rotate(path)`。阈值按每次交付的批次计算。

交付失败进入 host 的 `onFailure` 通道，错误为 `logging.file / DELIVERY_FAILED`，原始 writer 错误保留在 `cause`。非法配置与缺少 writer 可在创建时同步抛出。包与 host 的 peer 版本必须一致。

完整选项与注入示例见 [USEGUIDE.md](./USEGUIDE.md)。
