# Reasoning 流式阶段使用指南

## 创建与六个方法

安装 `@migaia/log-host` 与同版本的 `@migaia/log-plugin-reasoning`。`createLogHost({ plugins: [reasoningPlugin(options)] })` 推导六个阶段方法，不需要额外安装 level 或 console 插件。

| 方法                    | 行为                                     |
| ----------------------- | ---------------------------------------- |
| `startThinking(label?)` | 进入 thinking；若正在 response，先完成它 |
| `thinking(delta)`       | 原样追加片段；未处于 thinking 时自动开始 |
| `endThinking()`         | 输出两个换行并完成当前 thinking          |
| `startResponse(label?)` | 进入 response；若正在 thinking，先完成它 |
| `response(delta)`       | 原样追加片段；未处于 response 时自动开始 |
| `endResponse()`         | 输出一个换行并完成当前 response          |

显式再次开始同一阶段会重置该阶段的缓冲。空缓冲不生成完成条目。标签优先采用调用参数，其次 `labels.thinking` / `labels.response`；thinking 的默认标题是 `Thinking...`，response 默认无标题。标题输出后带两个换行，片段本身不增加换行或 ANSI。

## Writer 与调度

```ts
import { createLogHost } from '@migaia/log-host'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

/** 应用接收每次原样流式写入，保留片段边界。 */
const fragments: string[] = []
/** 明确开启 host 跟踪的异步流式调度。 */
const log = createLogHost({
  plugins: [
    reasoningPlugin({
      labels: { thinking: 'Plan', response: 'Answer' },
      asyncOutput: true,
      write: (text) => {
        fragments.push(text)
      }
    })
  ]
})
log.thinking('inspect')
log.response('ready')
log.endResponse()
await log.flush()
await log.shutdown('manual')
```

`write(text): void` 是借用的同步能力，卸载不关闭它。未提供时，已识别的服务端宿主借用 `process.stdout.write`；没有 stdout 时使用 `globalThis.console?.log(text)`。`asyncOutput` 默认 false：流式写入立即发生，完成条目仍进入 host 异步日志管线。设为 true 时，流式写入与完成派发都通过 host 跟踪调度，`flush()` 可等待这些已接纳工作。

## 完成条目与输出端

结束或切换阶段时，非空缓冲产生一条完整 message。thinking 的 tag/data.reasoningPhase 都为 `thinking`；response 的 tag 为 `response`，data.reasoningPhase 为 `responding`。两者均有 `data.silent: true`。console 插件跳过这些完成条目；HTTP/file 输出仍接收它们，便于保存完整文本。

`ReasoningPhase` 提供 `idle`、`thinking`、`responding` 三个稳定状态值。插件不依赖 console、不取得颜色能力，也不调用 host/core 的 raw。其它普通条目的格式仍由各输出端配置决定。

## 失败与释放

write 的同步异常以原错误进入 host 失败通道，不离开阶段方法。插件自身没有新增错误码，`LogReasoningErrorCode` 为空表。卸载后六个旧方法成为无操作，未完成缓冲被丢弃；不会自动派发未结束的段落。需要保留完整段落时先调用对应 end 方法，再等待 flush/shutdown。
