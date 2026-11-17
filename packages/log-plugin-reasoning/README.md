# @migaia/log-plugin-reasoning

[English](./README.en.md)

给 `@migaia/log-host` 增加“思考 / 回答”两个流式阶段，适合记录大模型这类逐字输出的内容。文本片段到达时立即原样写出，用户能实时看到；每个阶段结束时，再向其他输出派发一条包含完整文本的结构化日志，方便审计和检索。

## 你可能遇到过

- **流式输出要么实时、要么可检索，只能选一个**：逐片段写日志，日志系统里是几百条碎片；攒完再写，用户要等到最后才看到。根因是“给人看的流”和“给系统存的记录”混在一个输出里。
- **控制台上同一段话出现两遍**：流式片段已经打印过，完整记录又被控制台打印一次。根因是完整记录没有标记为“不要重复显示”。

## 从这里开始

```ts doc-test=run
import { createLogHost } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import { reasoningPlugin } from '@migaia/log-plugin-reasoning'

// 流式片段写到这里；不传 write 时写到 stdout
const streamed: string[] = []
// 另一个输出代表审计日志，只收到每个阶段的完整文本
const audit = defineOutputPlugin({
  name: 'audit',
  batchable: false,
  defaultFormat: 'plain',
  deliver(records) {
    for (const { entry } of records) console.log(`审计记录 ${entry.tag}：${entry.message}`)
  }
})
const log = createLogHost({
  plugins: [reasoningPlugin({ write: (text) => streamed.push(text) }), audit]
})
log.startThinking()
log.thinking('先查库存，')
log.thinking('再算运费')
log.endThinking()
log.startResponse()
log.response('可以当天发货。')
log.endResponse()
await log.shutdown('manual')
console.log('流式写出的片段：', JSON.stringify(streamed))
```

输出：

```text
审计记录 thinking：先查库存，再算运费
审计记录 response：可以当天发货。
流式写出的片段： ["Thinking...\n\n","先查库存，","再算运费","\n\n","可以当天发货。","\n"]
```

片段在调用 `thinking()` / `response()` 时立即写出，阶段的标题和换行也一起写出；审计输出只在每个阶段结束时收到一条完整记录。

## 常用 API

| API                                                          | 说明                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `reasoningPlugin({ write?, asyncOutput? })`                  | `write` 接收原始文本，不加颜色；不传时写到识别到的 stdout，没有 stdout 时用 `console.log` |
| `startThinking(label?)` / `thinking(text)` / `endThinking()` | 思考阶段                                                                                  |
| `startResponse(label?)` / `response(text)` / `endResponse()` | 回答阶段                                                                                  |

## 契约细节

- 阶段结束时派发的完整记录 tag 为 `thinking` 或 `response`，`data` 里带 `reasoningPhase` 和 `silent: true`。console 插件跳过 `silent` 条目，避免重复显示；HTTP、文件等输出照常收到完整文本。
- `asyncOutput` 默认 `false`；开启后流式写入和完整记录的派发都由 host 调度并跟踪，`flush()` 会等待它们。
- `write` 同步抛出的错误进入 host 的失败通道。卸载插件会丢弃未结束阶段的缓冲，不会自动补发完整记录。
- 本插件不依赖 console 插件，也不要求 host 提供 `raw`。

阶段规则与选项见 [使用指南](./USEGUIDE.md)。
