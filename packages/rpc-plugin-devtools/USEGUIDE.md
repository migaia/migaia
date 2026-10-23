# RPC Devtools 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md) · [Host 指南](../rpc-host/USEGUIDE.md)

`devtoolsPlugin()` 是可安装的 feature。它的 collector 就是原有有界采集器；query/watch/stats/describe/close 五个便捷方法直接转交同一个 collector。它不创建业务连接，也不转发一份新的 probe 事件流。

## 观察真实双端调用

下面把同一 tools 对象安装到父子两个真实 host。watch 首次 next 先订阅未来事件，再发业务；最后先关闭 host，再显式关闭应用拥有的 collector。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })
const parent = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect }), tools],
          provide: { double: (value: number) => value * 2 }
        })
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        } finally {
          await child.close()
        }
      }
    }),
    tools
  ]
})
const watch = tools.watch({ stages: ['message'] })
try {
  const next = watch.next()
  console.log(await parent.request('double', 21))
  const batch = await next
  console.log(batch.value?.events.length)
  console.log(tools.stats().methods)
} finally {
  await watch.return(undefined)
  await parent.close()
  tools.close()
}
```

业务输出 42；观察计数取决于两端合格事件，不应把“一次业务”固定等同于“一条记录”。同一 tools 可装到多个 host；每个 host 内同一定义只能安装一次。关闭其中一个 host 只撤回它的观察，其他 host 和 collector 继续工作。

## 阶段、捕获与脱敏

默认 stages 是 message 与 peer。envelope、encoded、frame、protected、carrier 需显式启用；其可见性还取决于真实载体和所经过的阶段。仅订阅 stages 不会保存内容。capture 必须是 stages 的子集，默认不捕获；redact 在原 emitter 上同步投影内容。

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

export const tools = devtoolsPlugin({
  stages: ['message', 'peer', 'carrier'],
  capture: ['message'],
  redact: () => ({ redacted: true }),
  maxEvents: 2000,
  maxContentBytes: 1024 * 1024,
  onError: (error) => console.error(error)
})
```

该示例明确替换全部捕获内容。应用需要按自己的数据结构编写脱敏策略，不应假定自动递归删除凭据。redact 抛错会报告 REDACT_FAILED 并丢弃该内容，不改变已完成业务结果。

methods 是精确方法过滤；sample 是大于 0 且不超过 1 的确定性采样比率。暂停请使用 collector.pause，而不是 sample: 0。collector.resume 恢复保存的阶段选择，不复活已关闭 collector。

## 查询、watch 与容量

query 使用序列游标而非数组位置。把 nextSeq 作为下次 afterSeq，即使过滤掉一些行也不重复扫描。默认 limit=1000，允许范围 1 到 1000。

```ts doc-test=check
import type { IRpcDevtools } from '@migaia/rpc-plugin-devtools'

export function readPage(collector: IRpcDevtools, afterSeq: number) {
  const page = collector.query({ afterSeq, limit: 100, stages: ['message'] })
  return { events: page.events, cursor: page.nextSeq, loss: page.counters }
}
```

watch 在首次 next 时订阅未来事件，不代替 query 的历史读取。每批最多 256 项、最多排队 64 批；原始待过滤窗口也有界。batch.dropped 包含相应丢失，慢消费者不能声称零丢失。return 只关闭该 watch，并唤醒其等待；collector.close 则让等待的 next 以 CLOSED 拒绝。

主环 maxEvents 默认 10000；maxContentBytes 默认 8388608，仅限制主环内容预算；maxInterned 默认 65536。watch、record 和内容/detail/error 的引用另有归属，不应把主环上限当作进程内存硬上限。query.counters 可解释淘汰、内容丢弃、重入丢失与 intern 溢出。

stats 累计合格 message 事件，主环淘汰不减去累计值。延迟百分位来自有界直方图桶的插值，不是保留样本的精确分位数。clear 重置主环、统计和计数，保留序列进度、record 与 watch 寿命。

## 独立录制与 NDJSON

一次只能有一个活动 recording。record 使用自己的容量，stop 消费该句柄并返回记录。export/import 是纯 codec，不持久化，也不把导入数据注入当前 collector。

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 100 })
try {
  const recording = tools.collector.record({ maxEvents: 200 })
  tools.collector.clear()
  const record = recording.stop()
  const text = tools.collector.exportRecord(record)
  const decoded = tools.collector.importRecord(text)
  console.log(decoded.header.version)
} finally {
  tools.close()
}
```

record v1 的头保持 `{ format: 'migaia-rpc-devtools', version: 1 }`，包改名不改变格式。`/contract` 提供 encodeRpcDevtoolsRecord、decodeRpcDevtoolsRecord 和相关类型。字节采用保留的 `$bytes` 语法及规范 base64；原生错误恢复名称、stack 与原因链，不重新生成远端 stack。格式不承诺任意 JS 类实例图往返。

## 既有 host 上的远程 service

collector.service 是嵌套 provide，可由应用发布到自己的既有 host。授权和业务连接由应用负责；不要为观察再建立第二个调用端点。

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'
import type { IDevtoolsPlugin } from '@migaia/rpc-plugin-devtools'

export function exposeDiagnostics(host: IRpcHost, tools: IDevtoolsPlugin) {
  host.provide({ diagnostics: tools.collector.service })
}
```

capture 与 exposeContent: true 是独立选择；默认远程服务隐藏捕获内容。服务读取会排除其实际服务 host 的观察记录，避免查询观察自身业务。服务保留 query/watch/stats/describe、record.start/stop、clear、pause/resume；跨 RPC 输出沿原 portable/wire 转换。

## Hub 与结构化日志

`/hub` 的 createRpcDevtoolsHub 接收已有 client 的 request/stream 或离线记录，不替应用创建连接。注册名是 Hub 的本地标签，不是 endpoint 身份。

```ts doc-test=check
import { createRpcDevtoolsHub } from '@migaia/rpc-plugin-devtools/hub'

export async function inspectRecord(text: string) {
  const hub = createRpcDevtoolsHub({ maxEvents: 5000 })
  try {
    hub.importRecord('offline', text)
    return hub.timeline({ targets: ['offline'], limit: 100 })
  } finally {
    await hub.close()
  }
}
```

在线对齐取五次采样中最小 RTT 估计偏移与不确定性，不保证网络对称。Hub 先订阅再补历史，按原序列去重；interaction 只关联已观察到的 trace 或 sender/message 身份，oneSided 不补造缺失一端。关闭 Hub 只 return 自己的 watch、取消自己的定时器，不关闭借入 client。

`/log` 的 createRpcLogProbe 接收实现 debug/info/warn/error 的结构化 logger。需要安装时，把返回 probe 放进作者 SDK 的 feature 定义：

```ts doc-test=check
import { defineFeaturePlugin } from '@migaia/rpc-host/plugin'
import { createRpcLogProbe, type IRpcLogSink } from '@migaia/rpc-plugin-devtools/log'

const logger: IRpcLogSink = {
  debug: (message, fields) => console.debug(message, fields),
  info: (message, fields) => console.info(message, fields),
  warn: (message, fields) => console.warn(message, fields),
  error: (message, fields) => console.error(message, fields)
}
export const logging = defineFeaturePlugin({
  name: 'app-logging',
  probe: createRpcLogProbe(logger, { slowMs: 100 })
})
```

将 logging 与实际传输安装到 host。log probe 只选择 message/peer，不拥有文件、缓冲、批处理或 flush；logger 应避免阻塞，并自行负责 shutdown。logger/格式化失败走 onError，不改变业务结算。

## 最终清理与错误

先 return 自己的 watch，停止 recording，关闭业务 host，再关闭仍由应用拥有的 collector/Hub/logger。collector.close 幂等且不关闭业务 host；host.close 同样不关闭 collector。

本包 source 为 rpc.devtools。INVALID_OPTION、CLOSED、RECORD_ACTIVE、RECORD_NOT_ACTIVE、RECORD_FORMAT_INVALID、REDACT_FAILED、TARGET_DUPLICATE、TARGET_UNKNOWN、TARGET_RELEASE_FAILED、SERVICE_RESULT_INVALID 保留原生错误类型与原 cause。诊断与清理错误需要处理或报告，不能用采集失败替换原业务错误。
