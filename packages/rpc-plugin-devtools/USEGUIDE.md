# Devtools 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md)

Contract 提供纯事件/接口契约；Host 拥有业务会话和调用；transport 提供真实载体。Devtools 是 flow plugin，通过统一 probe 的 observe 入口借用真实事件；timeout/retry feature 则拥有调用策略。应用持有 collector，不创建第二个观察连接。一个 Host 可有不同 namespace 的 transport；示例仅使用 coroutine。

## 观察真实调用

此示例另需安装 `@migaia/rpc-plugin-coroutines`。将同一 tools 安装到父子两个真实 Host，watch 首次 next 先订阅未来事件，再发业务。安装 flow plugin 时使用 Host.plugins，而非 transport.features。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

async function untilStopped(signal: AbortSignal): Promise<void> {
  let complete!: () => void
  const stopped = new Promise<void>((resolve) => {
    complete = resolve
  })
  signal.addEventListener('abort', complete, { once: true })
  if (signal.aborted) complete()
  try {
    await stopped
  } finally {
    signal.removeEventListener('abort', complete)
  }
}

const tools = devtoolsPlugin({ maxEvents: 1000, methods: ['double'] })
const task: ICoroutineUserTask = async ({ connect, signal }) => {
  const child = await createRpcHost({
    plugins: [tools, coroutinePlugin({ connectToParent: connect })],
    provide: { double: (value: number) => value * 2 }
  })
  try {
    await untilStopped(signal)
  } finally {
    await child.close()
  }
}

type IWorkerApi = { double(value: number): number }
const plugins = [tools, coroutinePlugin({ spawn: task })] as const
const parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
const watch = tools.watch({ stages: ['message'] })
try {
  const next = watch.next()
  console.log(await parent.coroutine.request('double', 21))
  console.log((await next).value?.events.length)
  console.log(tools.stats().methods)
} finally {
  await watch.return(undefined)
  await parent.close()
  tools.close()
}
```

业务返回 42；事件数取决于两端实际合格观察，不能把一次业务固定等同于一条事件。默认 message/peer/forward 足够观察这次调用；其他阶段要显式启用，且真实载体必须提供相应事实。

## 捕获、脱敏、查询与服务

```ts doc-test=check
import { devtoolsPlugin, type IRpcDevtools } from '@migaia/rpc-plugin-devtools'
import type { IRpcHost } from '@migaia/rpc-host'

export const tools = devtoolsPlugin({
  stages: ['message', 'peer', 'carrier'],
  capture: ['message'],
  redact: () => ({ redacted: true }),
  maxEvents: 2000,
  maxContentBytes: 1024 * 1024,
  onError: (error) => console.error(error)
})

export function readPage(collector: IRpcDevtools, afterSeq: number) {
  const page = collector.query({ afterSeq, limit: 100, stages: ['message'] })
  return { events: page.events, cursor: page.nextSeq, loss: page.counters }
}

export function exposeDiagnostics(host: IRpcHost) {
  host.provide({ diagnostics: tools.collector.service })
}
```

上例明确替换捕获内容。redact 同步运行，异常报告 REDACT_FAILED 并丢弃该内容，不改业务结果。方法过滤为精确匹配；sample 大于 0 且不超过 1，暂停使用 collector.pause。resume 恢复原阶段选择，不复活已关闭采集器。

query.afterSeq 是排他序列游标，使用 page.nextSeq 继续；它包含已扫描但被过滤的行。limit 默认 1000，范围 1–1000。watch 在首次 next 订阅未来事件，不能代替历史 query；每批最多 256 条、最多 64 批待取，batch.dropped 报告丢失。return 只结束自己的 watch，collector.close 让等待的 next 以 CLOSED 拒绝。

主环 maxEvents 默认 10000、maxContentBytes 默认 8388608、maxInterned 默认 65536。watch、record 和 content/detail/error 引用另有归属，不能将主环容量解释为任意对象图的深复制或全局内存预算。query.counters 报告淘汰、内容丢弃、重入丢失、采样与 intern 溢出。

collector.service 是嵌套 provide。授权由应用负责；默认远程读取不公开捕获内容，只有 exposeContent:true 才允许。服务读取排除其实际服务 Host 的观察，避免查询递归；不为观察另外创建业务 Host。

## 录制与 NDJSON

```ts doc-test=check
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

const tools = devtoolsPlugin({ maxEvents: 100 })
try {
  const recording = tools.collector.record({ maxEvents: 200 })
  tools.collector.clear()
  const record = recording.stop()
  const text = tools.collector.exportRecord(record)
  console.log(tools.collector.importRecord(text).header.version)
} finally {
  tools.close()
}
```

同一时刻只有一个活动录制，stop 消费该句柄。clear 重置主环、统计和计数，保留序列进度及 record/watch 寿命。stats 累计合格 message 事件，主环淘汰不倒减；延迟分位值来自有界直方图插值。

记录头保持 `{ format: 'migaia-rpc-devtools', version: 1 }`。export/import 为纯 NDJSON codec，不持久化、不向当前 collector 注入事件。字节与错误图按记录契约转换，不承诺任意 JS 类实例图无损往返。

## 清理与边界

先结束自己的 watch 和 recording，再关闭业务 Host，最后关闭应用拥有的 collector。Host 安装只拥有其 emitter 清理，collector.close 不负责关闭业务。同步 emit 的可复用 view 若需保留，消费者必须按公开 probe 契约及时读取或复制字段。

自定义 probe 从 `@migaia/rpc-host/plugins/probe` 导入；SDK 从 `@migaia/rpc-host/sdk` 导入。物理 carrier/protected 阶段依赖实际路径，不用语义消息伪造。诊断失败不得替换原业务结果；错误 source 为 rpc.devtools，包含 INVALID_OPTION、CLOSED、RECORD_ACTIVE/RECORD_NOT_ACTIVE、RECORD_FORMAT_INVALID、REDACT_FAILED、SERVICE_RESULT_INVALID，保留原类型与 cause。

默认包含转发事件。查询或记录有序事件后，可关联 `messageId`、`route` 与调用方可选 `trace`，查看各 host 的 `hop`、`maxHops` 和拒绝原因。既有环在保留事件时复制借用路由；实时 probe 回调仍只借用该数组。

stats 的原始 endpoint/method 统计最多保留 4096 对，独立于事件环和名称表。新组合按首次写入顺序淘汰最早的组合；更新旧组合不刷新顺序。`stats().evictedPairs` 是本次 clear 周期内淘汰的组合数，`clear()` 将它重置为 0。
