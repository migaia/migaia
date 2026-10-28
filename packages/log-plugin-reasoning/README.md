# @migaia/log-plugin-reasoning

为 `@migaia/log-host` 增加 thinking/response 流式阶段。文本片段直接写入借用的 writer；结束阶段时另派发一条完整的结构化日志。

```ts
import { createLogHost } from '@migaia/log-host'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

/** 应用借用该数组观察每次流式写入的原始文本。 */
const fragments: string[] = []
/** 每次安装独立持有阶段与缓冲区。 */
const log = createLogHost({
  plugins: [
    reasoningPlugin({
      write: (text) => {
        fragments.push(text)
      }
    })
  ]
})
log.startThinking('Thinking')
log.thinking('inspect ')
log.thinking('the request')
log.endThinking()
log.startResponse()
log.response('Done.')
log.endResponse()
await log.shutdown('manual')
```

插件提供 `startThinking`、`thinking`、`endThinking`、`startResponse`、`response`、`endResponse` 六个方法。`write` 不增加 ANSI；未注入时借用已识别宿主的 stdout，无 stdout 时降级到 `console.log`。

完成条目的 tag 为 `thinking` 或 `response`，data 包含 `reasoningPhase` 与 `silent: true`。console 输出跳过 silent 条目，HTTP/file 仍可收到完整文本。插件不依赖 console 包，也不要求 host 提供 raw。

`asyncOutput` 默认 false；开启后流式写入与完成派发由 host 调度跟踪。writer 的同步异常进入 host 失败通道。卸载丢弃未完成缓冲，不自动生成完成条目。包与 host 的 peer 版本必须一致。

阶段规则与选项见 [USEGUIDE.md](./USEGUIDE.md)。
