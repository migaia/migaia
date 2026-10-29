# 文件输出使用指南

## 安装与默认输出

安装 `@migaia/log-host` 与相同版本的 `@migaia/log-plugin-file`，把 `filePlugin({ path })` 放入 `createLogHost` 的 plugins。使用级别方法时再安装 `levelPlugin()`。默认 JSON 格式采用 host 的统一错误投影，保留公开错误链，不写入原始 Error 的私有字段。

每次交付把各条已格式化文本用换行连接，末尾再追加一个换行，并调用一次 `writer.append(path, text)`。默认 JSON 因而形成 NDJSON；显式自定义格式会改变行内容，插件不再执行第二次序列化。`flush()` 排空已接纳工作，应用退出时应等待 `shutdown()`。

## 注入 writer

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { batchFeature } from '@migaia/log-host/features'
import { filePlugin } from '@migaia/log-plugin-file'

/** 示例 writer 由应用拥有，插件卸载不会关闭它。 */
class MemoryWriter {
  /** 保留每次 append 的完整批次，便于应用转交实际存储。 */
  readonly writes: { path: string; text: string }[] = []
  /** append 的兑现表示本批内容已由 writer 接纳。 */
  async append(path: string, text: string): Promise<void> {
    this.writes.push({ path, text })
  }
}

/** 显式 writer 使同一配置可用于浏览器与服务端。 */
const writer = new MemoryWriter()
/** 输出级批量策略由 host 维护缓冲与排空。 */
const log = createLogHost({
  plugins: [
    levelPlugin(),
    filePlugin({
      path: 'application.ndjson',
      writer,
      features: { batch: batchFeature({ maxSize: 2 }) }
    })
  ]
})
log.info('first')
log.info('second')
await log.flush()
await log.shutdown('manual')
```

writer 结构为 `append(path, text): Promise<void>` 与可选的 `rotate(path): Promise<void>`。应用负责 writer 的资源和目标目录，插件只借用方法。

## 选项与轮转

| 选项                | 行为                                              |
| ------------------- | ------------------------------------------------- |
| `path`              | 必填非空字符串，原样传给 writer                   |
| `writer`            | 显式能力优先于原生默认值                          |
| `features`          | 输出级 host 策略，可设置格式、批量、重试与超时    |
| `rotate.maxEntries` | 正整数；本次交付条目数达到阈值后轮转              |
| `rotate.maxBytes`   | 正整数；本次交付文本的 UTF-8 字节数达到阈值后轮转 |

两个轮转阈值任意一个达到即触发；先 await append 成功，再 await rotate。计数不跨批次累加。原生默认 writer 没有 rotate；配置阈值但缺少 `writer.rotate` 会在创建时失败。

Node/Bun 默认动态使用 `node:fs/promises.appendFile`；Deno 默认使用原生 `Deno.writeTextFile` 并设置 append。browser/default 条件入口不引入这些原生模块，必须注入 writer。

## 错误与关闭

错误 source 为 `LOG_FILE_ERROR_SOURCE`（`logging.file`）。`INVALID_OPTION` 表示 path/轮转配置不合法；`FILE_SINK_UNAVAILABLE` 表示当前入口没有 writer；两者在创建时同步抛出。`DELIVERY_FAILED` 表示 append 或 rotate 失败，`cause` 保留原异常，失败经 host 的 `onFailure` 观察，日志方法不因此抛出。卸载不会关闭应用的 writer。

`features` 使用 plugin-host 原生 record：`{ alias: feature }`。每个 feature 都是 `defineFeature` 返回的 opaque token；插件负责安装，并通过 host 与插件 handle 的 `file_alias_method` 扩展公开控制方法。运行时状态由每次安装独立拥有，例如 `threshold` alias 对应 `file_threshold_setLevel`。全局默认策略由 `@migaia/log-host/plugin` 的非输出插件 `defineLogPlugin({ name, features })` 声明，再传入 `createLogHost({ plugins: [...] })`；输出端只覆盖全局 record 中同 key 的 feature，不按工厂类别覆盖。不同 key 的 gate 会同时生效。host-wide carrier 之间同 key 冲突；每个输出在实际安装、按 key 合并后最多有一个 format、一个 batch、一个 retry 和一个 timeout，冲突以既有 `INVALID_OPTION` 拒绝。不再支持 `createLogHost({ features })` 或 feature 数组。
