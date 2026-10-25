# `@migaia/rpc-plugin-devtools`

把真实 RPC 观察保存为有界事件、累计统计、watch 和独立录制。

Contract 定义纯协议与接口，Host 拥有会话、provider 和调用结算，transport 获取真实载体。Devtools 是借统一 probe 的 flow plugin，只读消费观察，不创建业务连接。timeout、retry 等 feature 则安装在所属 plugin 上，拥有调用策略。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## Collector 入门

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-devtools
```

工厂创建一个由应用持有的 collector。下面只演示真实录制控制，不伪造业务事件。

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 1000 })
try {
  const recording = tools.collector.record({ maxEvents: 2000 })
  tools.collector.pause()
  console.log(tools.describe().paused)
  tools.collector.resume()
  console.log(tools.describe().paused)
  const text = tools.collector.exportRecord(recording.stop())
  console.log(tools.collector.importRecord(text).header.version)
} finally {
  tools.close()
}
```

输出 `true`、`false`、`1`。采集真实业务时将同一个 tools 与所选 transport 放在 `createRpcHost({ plugins: [tools, transport] })`；完整 Coroutine 示例见使用指南。无需另装一个 probe 转发器。

## 安装与归属

同一 tools 可安装到多个真实 Host，每个安装有自己的观察寿命，事件进入同一个 collector。每个 Host 内只安装一次同一定义。一个 Host 允许不同 namespace 的 transport；业务仍在 `host.<ns>.*`，Devtools 不增加根调用方法。

Host.close 撤回其观察；应用在所有使用结束后调用 tools.close 或 collector.close。关闭 collector 不关闭业务 Host。query/watch/stats/describe/close 便捷方法直接借用同一个 collector；pause/resume、record、clear、export/import 和 service 使用 tools.collector。

## 选择观察与保留

| API / 选项           | 用途                                                   |
| -------------------- | ------------------------------------------------------ |
| `stages`             | 默认 message、peer、forward；其他物理/信封阶段显式启用 |
| `capture` / `redact` | 显式内容捕获与同步内容投影                             |
| `methods` / `sample` | 精确方法过滤、确定性采样，0 < sample ≤ 1               |
| `maxEvents`          | 主环容量，默认 10000                                   |
| `maxContentBytes`    | 主环内容预算，默认 8 MiB                               |
| `query` / `watch`    | 序列游标历史读取 / 首次 next 后观察未来事件            |
| `stats`              | 累计合格 message 统计，不随主环淘汰减少                |
| `record`             | 独立有界窗口，stop 后可导出                            |

仅选择 stages 不会自动捕获内容；capture 必须是 stages 子集。原始 carrier 阶段只来自实际载体的真实观察能力，不能用语义帧推造原始数据。慢 watch 和环淘汰的丢失数应一并读取；主环上限不是进程内存上限。

公开入口只有根包的 devtoolsPlugin、collector/选项类型和错误身份。记录 format 为 migaia-rpc-devtools、version 为 1；使用 collector.exportRecord/importRecord，不持久化或向采集器重新注入导入内容。自定义观察使用 `@migaia/rpc-host/plugins/probe`，原始载体部署使用 `@migaia/rpc-host/sdk`。

collector.service 可由应用在既有 Host 上显式 provide；应用负责授权，capture 与 exposeContent 是独立选择。本包错误 source 为 rpc.devtools，保留原生类型与 cause。更多容量、录制和清理规则见[使用指南](./USEGUIDE.md)。

默认包含转发事件。查询或记录有序事件后，可关联 `messageId`、`route` 与调用方可选 `trace`，查看各 host 的 `hop`、`maxHops` 和拒绝原因。既有环在保留事件时复制借用路由；实时 probe 回调仍只借用该数组。
