# `@migaia/rpc-plugin-devtools`

把真实 host 调用观察为有界事件、累计统计、增量 watch、独立录制和离线时间线。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- 事件淘汰不减掉已累计的调用统计；clear 不结束独立录制。
- 一个 `devtoolsPlugin` 直接向 host 安装原 collector，不另建业务连接或转发 emitter。
- 可明确选择逻辑或物理阶段；内容捕获、脱敏与远程公开各自显式控制。
- 原 NDJSON codec 保留字节和错误链；Hub 借用已有 client 或离线记录，不负责创建连接。

## 从这里开始

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-devtools
```

创建 feature 后保留它的同一个 collector。下面只演示录制控制，不伪造业务事件：

```ts doc-test=run
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 1000 })
const collector = tools.collector
const recording = collector.record({ maxEvents: 2000 })
collector.pause()
console.log(collector.describe().paused)
collector.resume()
console.log(collector.describe().paused)
const text = collector.exportRecord(recording.stop())
console.log(collector.importRecord(text).header.version)
collector.close()
```

输出 `true`、`false`、`1`。采集真实流量时，将 `tools` 与传输一起加入 `createRpcHost({ plugins: [transport, tools] })`。transport 是所选 [process](../rpc-plugin-process/README.md)、[thread](../rpc-plugin-thread/README.md)、[browser](../rpc-plugin-browser/README.md) 或 [coroutine](../rpc-plugin-coroutines/README.md) plugin 的实际返回值。

## 安装与归属

同一 tools 对象可安装到两个 host，将两端原观察汇入同一个 collector。每个 host 内仍只能安装一次该 feature 定义。host.close 撤回该 host 的原观察，不关闭 collector；应用在所有观察结束后显式 `collector.close()`。collector.close 也不会关闭业务 host。

`tools.query/watch/stats/describe/close` 都直接委托同一个 collector。pause/resume、clear、record、export/import 和 service 使用 `tools.collector`，不创建第二份状态。

## 观察与保留

| API / 选项                        | 行为                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| `stages`                          | 默认 message、peer；envelope/encoded/frame/protected/carrier 需显式启用 |
| `capture` / `redact`              | 显式选择捕获阶段与同步内容投影；仅选 stages 不会自动保存内容            |
| `methods` / `sample`              | 过滤方法、确定性采样；sample 在 0 到 1 之间且不含 0                     |
| `maxEvents`                       | 默认 10000，限制主环事件数                                              |
| `maxContentBytes`                 | 默认 8 MiB，主环内容预算，不是整个进程内存上限                          |
| `query({ afterSeq, limit, ... })` | 按序列游标读取主环，默认 limit=1000                                     |
| `watch(filters?)`                 | 首次 next 开始观察，批次含 events 和 dropped；return 只结束该 watch     |
| `stats()`                         | 累计符合条件的方法计数与延迟桶，不随主环淘汰减少                        |
| `record({ maxEvents? })`          | 独立保留窗口，stop 返回可导出的记录                                     |
| `pause/resume/clear`              | 暂停/恢复阶段或重置主环与累计值，不关闭业务                             |

watch 和 recording 有各自有界保留，丢失数不能被当作零丢失保证。内容、detail 和 error 的嵌套对象仍可能保留引用；主环容量不是任意对象图的深复制或全局内存预算。慢观察者可能丢批次，collector.close 会唤醒等待的 watch 并以 CLOSED 拒绝。

## 保留的入口

| 入口        | 用途                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| 根入口      | `devtoolsPlugin`、collector/选项类型、错误身份                                      |
| `/contract` | wire/service/record 类型、NDJSON format 与 encode/decode                            |
| `/hub`      | `createRpcDevtoolsHub`，注册已有 client、时钟对齐、timeline/interactions 与离线导入 |
| `/log`      | `createRpcLogProbe`，向应用提供的结构化 logger 同步交付合格字段                     |

record v1 的 format 仍是 `migaia-rpc-devtools`；包改名不改变记录格式。Hub 不关闭借入 client，不补造缺失事件，也不重放业务。Log probe 不拥有文件、批处理或 flush；logger 自己负责实际 I/O 与最终 shutdown。

## 远程查询与错误

`collector.service` 可作为现有 host 的嵌套 provide 交给应用发布。授权由应用负责；`capture` 与 `exposeContent: true` 是两个独立选择。服务读取会排除其实际服务 host 的观察记录；应用决定发布到哪个既有 host。远程边界使用原 portable/wire 转换，不承诺任意 JS 图无损传输。

本包 source 为 `rpc.devtools`。INVALID_OPTION、CLOSED、RECORD_ACTIVE/RECORD_NOT_ACTIVE、RECORD_FORMAT_INVALID、REDACT_FAILED、TARGET_DUPLICATE/TARGET_UNKNOWN、TARGET_RELEASE_FAILED、SERVICE_RESULT_INVALID 保持原生类型和原 cause。诊断回调失败走报告，不改变已完成的业务结果。更多完整场景见[使用指南](./USEGUIDE.md)。
