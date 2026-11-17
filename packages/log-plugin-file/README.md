# @migaia/log-plugin-file

[English](./README.en.md)

把日志追加写入文件的输出插件，配合 `@migaia/log-host` 使用。默认每行一条 JSON（NDJSON），方便日志采集按行读取；批量、格式、重试和超时由 host 的 Feature 提供。Node、Bun、Deno 自带默认写入方式，浏览器或其他环境注入自己的 writer。

## 你可能遇到过

- **每条日志打开一次文件**：高频日志下磁盘写入次数和条数一样多。根因是没有按批写入。
- **退出时最后一批没写进文件**：缓冲里的日志随进程一起消失。根因是退出前没有等写入完成。

## 从这里开始

下面注入一个只打印的 writer，代替真实文件。用 Node 24 直接运行。

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { filePlugin } from '@migaia/log-plugin-file'

// 示例 writer 只打印；不传 writer 时，Node/Bun/Deno 直接追加到真实文件
const writer = {
  async append(path: string, text: string) {
    const lines = text
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line).message)
    console.log(`追加到 ${path}：${lines.join('、')}`)
  },
  async rotate(path: string) {
    console.log(`轮转 ${path}`)
  }
}
const log = createLogHost({
  plugins: [
    levelPlugin(),
    filePlugin({
      path: 'app.ndjson',
      writer,
      rotate: { maxEntries: 2 }, // 一批达到 2 条后轮转
      features: { batch: batchFeature({ maxSize: 2 }) } // 每 2 条写一次
    })
  ]
})
log.info('a')
log.info('b')
log.info('c')
await log.shutdown('manual')
```

输出：

```text
追加到 app.ndjson：a、b
轮转 app.ndjson
追加到 app.ndjson：c
```

前两条攒成一批，一次 `append` 写入，达到轮转阈值后调用 `rotate`。第三条在 `shutdown()` 时作为最后一批写入。

## 常用选项

| 选项                                    | 说明                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `path`                                  | 必填，原样传给 writer                                                               |
| `writer`                                | `append(path, text)`，可选 `rotate(path)`；显式传入的 writer 优先于默认写入方式     |
| `rotate.maxEntries` / `rotate.maxBytes` | 本次交付的条目数或 UTF-8 字节数达到阈值后轮转；配置了阈值就必须提供 `writer.rotate` |
| `features`                              | 本输出的策略，例如 `batchFeature`、`formatFeature`                                  |

## 契约细节

- 每次交付把这一批的文本用换行连接、末尾补一个换行，只调用一次 `writer.append`。先等 `append` 成功，再调用 `rotate`。轮转阈值按每次交付的批次计算，不跨批次累加。
- Node 与 Bun 默认用 `node:fs/promises` 追加，Deno 用 `Deno.writeTextFile(..., { append: true })`；浏览器和默认入口不加载这些模块，必须注入 `writer`。目标目录由应用准备，默认写入方式不支持轮转。
- 错误域是 `logging.file`（`LOG_FILE_ERROR_SOURCE`）。路径或轮转配置非法（`INVALID_OPTION`）、当前环境没有 writer（`FILE_SINK_UNAVAILABLE`）时创建时同步抛出。`append` 或 `rotate` 失败报告为 `DELIVERY_FAILED`，原错误在 `cause`，经 host 的失败通道观察，日志方法不会因此抛出。
- 卸载插件不关闭应用提供的 writer。
- `features` 写成 `{ 名称: feature }` 记录；控制方法以 `file_<名称>_<方法>` 挂在 host 上。host 级默认策略和覆盖规则见 [log-host 的组合策略](../log-host/README.md#组合策略)。

完整选项与注入示例见 [使用指南](./USEGUIDE.md)。
