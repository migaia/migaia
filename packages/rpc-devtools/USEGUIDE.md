# `@migaia/rpc-devtools` 使用手册

Collector、log probe 和 hub 已提供本地实现，codec 保持既有契约。Core 的直接观察路径已提供；Peer 转发、service 便携结果与 carrier 关联已接通；数值性能门禁及匿名前序 chunk 的限制见 closure handoff。

## 1. 高阶用法 · 离线录制编解码

`RpcDevtoolsRecordFormat` 是固定 header：`format` 为 `migaia-rpc-devtools`，`version` 为 `1`。`encodeRpcDevtoolsRecord(record)` 返回 NDJSON；`decodeRpcDevtoolsRecord(text)` 还原离线 record。Codec 不创建连接，也不写入存储。

```ts doc-test=check
import {
  RpcDevtoolsRecordFormat,
  encodeRpcDevtoolsRecord,
  decodeRpcDevtoolsRecord,
  type IRpcDevtoolsRecord
} from '@migaia/rpc-devtools/contract'

/** 业务内容只有显式捕获后才会出现在事件中。 */
const record: IRpcDevtoolsRecord = {
  header: RpcDevtoolsRecordFormat,
  events: [
    {
      seq: 1,
      at: 0,
      endpointId: 'client',
      stage: 'message',
      direction: 'outbound',
      kind: 'request',
      method: '读取',
      content: new Uint8Array([1, 2, 3])
    }
  ]
}
/** 同一 codec 可供 collector 导出和 hub 离线导入使用。 */
const decoded = decodeRpcDevtoolsRecord(encodeRpcDevtoolsRecord(record))
console.log(decoded.events[0]?.method)
```

Bytes 表示为 `{ "$bytes": base64 }`。录制错误使用 `serializeRpcError` / `deserializeRpcError`，保留原始 stack 和 cause 链；解码不重建 stack。`IRpcDevtoolsWireEvent.error` 是 service 传输的序列化错误；`IRpcDevtoolsRecordEvent.error` 的输入接受 `Error | IRpcWireError`，以便直接录制 service 事件。编码原生 Error 时序列化，已序列化错误按 RPC 契约规范化；解码后还原为原生 Error。

错误格式名、非 1 版本、缺少 header 字段或非法 JSON 会抛出 `RECORD_FORMAT_INVALID`，原始解析或验证失败保留在 `cause`。

## 2. Collector 接入

`createRpcDevtools(options)` 返回 collector 自己的 `IRpcProbe` 对象。`defineProbe(definition, host)` 将 Probe 附到同一对象上并冻结，保留对象身份。将其传给已有 Peer 的 `probe`，调用方负责 Peer 与 collector 的生命周期；collector 不创建 transport。

选项包括 `stages`（默认所有阶段）、`capture`（默认无内容）、`redact`、`methods`、`sample`、`maxEvents`（默认 10,000）、`maxContentBytes`（默认 8 MiB）、`maxInterned`（默认 65,536）、`exposeContent`（默认 false）与 `onError`。`methods` 过滤 message/envelope，`sample` 在构造时编译。无效配置抛出带 `INVALID_OPTION` 的 TypeError。

容量必须为正整数；内容预算允许 0。`maxEvents`（含录制容量）不超过 JavaScript Array 的长度上限 4,294,967,295；`maxInterned` 不超过 94,906,264，保证 endpoint/method 数值组合键仍是精确整数。这些是索引表示上限；实际可分配容量取决于宿主内存。

### 本地查询、统计、watch 与录制

下面通过手填 view 展示 collector，无需等待 Core 观察点。

```ts doc-test=run
import { createRpcDevtools } from '@migaia/rpc-devtools'
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  type IRpcProbeEventView
} from '@migaia/rpc-core/probe'

/** 每个宿主一个 collector，主查询环保留最近事件。 */
const devtools = createRpcDevtools({ stages: ['message'], maxEvents: 4 })
/** 仅本例手填元数据；真实 emitter 在同步调用间复用同一 view。 */
const view: IRpcProbeEventView = {
  seq: 0,
  carrierSeq: -1,
  at: 0,
  endpointId: 'client',
  stage: RpcProbeStage.message,
  direction: RpcProbeDirection.outbound,
  kind: RpcProbeKind.request,
  outcome: RpcProbeOutcome.settled,
  messageId: 'call-1',
  method: 'math.double',
  senderId: 'client',
  targetId: 'server',
  receiverId: undefined,
  peerId: undefined,
  trace: 'trace-1',
  sizeBytes: -1,
  chunkIndex: -1,
  chunkCount: -1,
  members: -1,
  durationMs: 2,
  rejection: undefined,
  lifecycle: undefined,
  error: undefined,
  carrier: undefined,
  detail: undefined,
  content: undefined
}
/** 录制使用独立容量，停止时才物化离线事件。 */
const recording = devtools.record({ maxEvents: 8 })
devtools.emit(view)
view.method = 'math.changed' // 已写入的顶层元数据不再读取 view。
console.log(devtools.query({ methods: ['math.double'] }).events[0]?.method)
console.log(devtools.stats().methods[0]?.calls) // 1
/** next() 开始订阅，后续写入唤醒当前消费者。 */
const watcher = devtools.watch({ stages: ['message'] })
const next = watcher.next()
devtools.emit(view)
console.log((await next).value?.events.length) // 1
await watcher.return(undefined)
devtools.pause()
devtools.emit(view) // 计入 ignoredWhilePaused。
devtools.resume()
console.log(devtools.query().counters.ignoredWhilePaused) // 1
/** Codec 边界把录制转成独立 NDJSON 表示。 */
const text = devtools.exportRecord(recording.stop())
console.log(devtools.importRecord(text).events.length) // 2
devtools.clear()
console.log(devtools.stats().methods.length) // 0
devtools.close()
```

`query({ afterSeq, limit, stages, outcomes, methods, trace, endpointIds })` 在保留环上单次扫描；`limit` 最大为 1,000，`nextSeq` 是下页 cursor。驻留表满后，新名称使用溢出 id 0 并增加 `internOverflow`；已有名称仍可还原。Watch 每批最多 256 个事件，每个消费者最多排队 64 批；过慢时丢弃最旧批次，下一批的 `dropped` 报告损失。`close()` 使等待中的 watch 以 `CLOSED` 结束，重复 close 安全。

`pause()` 保存暂停前最新订阅并清空 emitter mask，重复暂停不覆盖保存值；`resume()` 恢复该列表。构造后 `setStages()` 增加的阶段保留。Query 与 watch 的 `outcomes` 使用同一公开 outcome 名称域，空列表匹配零行。

按照 SC9，采集时保留 `detail`、error 与未实际转移的 content 引用，发送后对这些对象的修改可能反映在后续读取中。`snapshotProbeEvent` 只按显式请求复制顶层事件元数据（SC9c），内部引用仍可变；codec 在编码/解码边界转为独立 wire/text 表示（SC9b）。

内容预算只计入已知大小：字符串按 UTF-8 长度、ArrayBuffer/View 按 byteLength、opaque object 按事件提供的 sizeBytes。Opaque object 的 sizeBytes 为 -1 时计为 0；collector 不编码或遍历其对象图。因此 maxContentBytes 不保证约束任意 opaque object 的真实堆大小。需要可核算预算时，提供已有编码层的大小，或捕获 bytes/string。

`watch` 的批次类型是 `{ events, dropped }`。`record().stop()` 返回离线 record；service 的 `record.stop()` 返回编码文本。Service 默认不暴露 content，须由 `exposeContent` 明确启用。`IRpcDevtoolsCounters` 包含环形存储淘汰、内容丢弃、重入丢弃、采样丢弃、暂停/关闭忽略与字符串驻留溢出的计数。

`stats()` 按 endpoint 和 method 提供调用、失败、拒绝、超时、取消计数，以及 24 个固定 log2 延迟桶：公开边界为 `0.0625 ms × 2^k`，`k = 0…23`。末桶从 `latencyOverflowFromMs = 262144` ms 向上开放，`latencyMaxMs` 给出实际最大样本。p50/p95/p99 在桶内插值并钳制到观察到的最大值；末桶没有固定宽度误差承诺。Hub 汇总所有带最大值的行时保留同一上界；旧 target 未提供最大值时不伪造它。仅携带非负 durationMs 的 settled/failed/rejected message 事件更新统计；环淘汰不影响累计值，`clear()` 同时重置环与统计。

### 已有 Peer 上的远程 service

`devtools.service` 实现 `IRpcDevtoolsServiceApi`。下面使用公开 memory Peer fixture 展示挂载方式；生产环境传给已有 Peer 的同一 `provide` 边界。

```ts doc-test=run
import { createRpcDevtools } from '@migaia/rpc-devtools'
import type { IRpcDevtoolsServiceApi } from '@migaia/rpc-devtools/contract'
import { createPeerPair } from '@migaia/rpc-core/testing'

/** Service 专用 Peer 不安装 collector 作为 probe，避免观察自己的查询流量。 */
const devtools = createRpcDevtools({ maxEvents: 32 })
/** 这里的类型断言公开冻结的 service 契约，供 typed Peer 推断方法。 */
const pair = await createPeerPair({
  a: { provide: {} },
  b: { provide: { devtools: devtools.service as IRpcDevtoolsServiceApi } }
})
try {
  console.log((await pair.a.request('devtools.describe')).limits.maxEvents) // 32
  console.log((await pair.a.request('devtools.query', { stages: ['message'] })).events.length)
  await pair.a.request('devtools.record.start', { maxEvents: 8 })
  console.log(devtools.importRecord(await pair.a.request('devtools.record.stop')).header.version)
  await pair.a.request('devtools.pause')
  await pair.a.request('devtools.resume')
} finally {
  await Promise.all([pair.a.close(), pair.b.close()])
  devtools.close()
}
```

远端 `devtools.watch` 用 Peer 的 `stream('devtools.watch', filters)` 消费；远程取消通过原 stream signal 唤醒并释放 collector 等待。Service 从 provider 的 `localEndpointId` 识别 serving endpoint，排除其后续摄取以及 query/stats 中已有的该 endpoint 行。使用独立 service Peer，使业务 endpoint 保持可观察；合法业务 method 可以使用 `devtools.*` 名称，collector 不按方法前缀删除事件。

Service 在真实边界转换结果为 portable wire：原生 Error 通过 serializeRpcError 保留 source/code/name/message/stack/cause 链；bytes 使用既有 portable 表示，functions、undefined 与类 prototype 不跨线。无法编码时抛出带原 cause 的 TypeError / SERVICE_RESULT_INVALID。

Service 默认不输出 content；设 `exposeContent: true` 前应先配置 capture/redact，并确认远端有权读取。主环与录制独立；同一时刻只允许一个 recording，重复启动抛 `RECORD_ACTIVE`，重复 stop 抛 `RECORD_NOT_ACTIVE`。关闭时丢弃正在录制的数据；关闭后的查询、统计与控制调用抛 `CLOSED`。

## 3. Hub · 已有 client 与离线录制

`createRpcDevtoolsHub(options)` 的选项为 `maxEvents`、`realignMs` 与 `onError`。`maxEvents` 是每个 target 的保留上限，默认 50,000；超出后淘汰最旧事件，并从 interaction 索引移除。周期对齐使用 `realignMs`；旧设计文字中的 `realign` 不是另一个选项。

调用方提供实现 `IRpcDevtoolsTargetClient` 的已有 client。Hub 只调用该 client 的 `request('describe')`、`request('query', input)`、`request('stats')` 与 `stream('watch', input)`，不创建 transport、Peer 或重连机制。如果现有 Peer 使用嵌套 service 路径，由调用方在 client 边界映射为这些方法名。

```ts doc-test=check
import { createRpcDevtoolsHub, type IRpcDevtoolsTargetClient } from '@migaia/rpc-devtools/hub'

/** 聚合调用方已经建立的两个 devtools service client。 */
export async function inspectHosts(
  parentClient: IRpcDevtoolsTargetClient,
  workerClient: IRpcDevtoolsTargetClient
) {
  /** onError 接收原始运行时失败；hub 不创建这些连接。 */
  const hub = createRpcDevtoolsHub({
    maxEvents: 50_000,
    realignMs: 30_000,
    onError: (error) => console.error(error)
  })
  /** 订阅函数返回解除监听的函数。 */
  const unsubscribe = hub.on('status', (name, status) => console.log(name, status))
  try {
    await hub.addTarget('parent', parentClient)
    await hub.addTarget('worker', workerClient)
    console.log(hub.timeline({ trace: 'T1', limit: 100 }))
    console.log(hub.interactions('T1'))
    console.log(await hub.stats())
    await hub.removeTarget('worker')
  } finally {
    unsubscribe()
    await hub.close()
  }
}
```

连接时依次取五个 `describe` 时钟样本，保留 RTT 最小的样本。`offset = remoteNow − (t0 + t1) / 2`，`uncertaintyMs = RTT / 2`，`alignedAt = event.at − offset`。该估算依赖往返延迟对称假设；读取 `uncertaintyMs`，不要把对齐时间当成无误差时钟。初始化先按 `afterSeq` 分页执行 `query`，追上后跟随 `watch`。

`on('event', listener)` 提供新摄入的 timeline 事件；`on('status', listener)` 发布 `connecting`、`connected`、`disconnected`、`offline` 与 `removed`。`status(name)` 返回指定 target 的状态，省略名称时返回状态 Map。这些是生命周期值，不是错误码。

`timeline({ targets, stages, trace, method, from, to, limit })` 可筛选 target、stage、显式 trace、method、对齐时间范围与结果数量。每个 target 保持 `seq` 顺序，跨 target 用 k-way merge 按 `alignedAt` 合并；同时间先按 target 名、再按 `seq` 排序。`interactions(trace?)` 查询增量索引，按 `(senderId, messageId)` 关联两侧和响应。相同非空 trace 可查询到多跳 interaction；只有一侧时 `oneSided` 为 `true`。Hub 不自动传播 trace，不推断缺失侧，也不重新发起业务调用。

`stats(name)` 转发指定实时 target 的统计；`stats()` 逐 endpoint/method 汇总计数，并逐桶相加固定延迟直方图后计算分位数。聚合不平均各 target 的 p50/p95/p99。Record v1 不保存聚合统计；离线 target 的 stats 返回 `{ since: 0, methods: [] }`，汇总时不补造离线计数。

`importRecord(name, text)` 使用 contract NDJSON codec 注册只读 `offline` target，不连接远程 service。离线事件的 `alignedAt` 等于原 `at`，`uncertaintyMs` 为 `undefined`；导入不恢复录制时的时钟偏移。可用 `timeline` 与 `interactions` 查询这些事件。

**引用语义（SC9）：** Hub 在摄入时创建一次 timeline 元数据包装，并保留内部事件引用。`timeline()` 与 `interactions()` 的结果数组复用这些已存储元素，不为每次查询复制事件。未实际转移的 content、`detail` 与 error 仍按引用保存，发送后修改原对象可能反映在后续读取中。周期重新对齐会更新已存储包装的 `alignedAt`；此前取得的引用也能看到新值。调用方不要修改这些只读结果。离线 codec 编解码是表示转换边界，返回独立的 wire/text 表示。

**失败与释放：** 重复 target 名抛出 `TARGET_DUPLICATE`。移除未知名称抛出 `TARGET_UNKNOWN`，重复移除已经移除的名称无害。初始化 `describe` 失败时，target 变为 `disconnected`，原错误交给 `onError`，`addTarget` 以同一错误拒绝。运行中的 `watch` 中断会报告失败并保留已收到事件；hub 不自动重试。Listener 失败报告给 `onError`，其他 listener 继续运行。

`close()` 停止所有 watch，重复关闭无害。释放失败汇总为 `AggregateError` 并报告，`errors[0]` 保留第一个原错误。关闭后的操作抛出 `CLOSED`，重复 `close()` 除外。Hub 只释放自己持有的 watch 与状态；调用方仍负责已有 client/Peer 的生命周期。

## 4. 错误身份

错误 source 为 `RPC_DEVTOOLS_SOURCE`（`@migaia/rpc/devtools`）；按 `RpcDevtoolsErrorCode` 与 source 分支，保留 cause，不匹配 message。错误表已注册 `INVALID_OPTION`、`CLOSED`、`RECORD_ACTIVE`、`RECORD_NOT_ACTIVE`、`RECORD_FORMAT_INVALID`、`REDACT_FAILED`、`TARGET_DUPLICATE`、`TARGET_UNKNOWN` 与 `SERVICE_RESULT_INVALID`。Collector 与 hub 的配置和生命周期错误已实现；hub client 的运行时错误按原身份报告，不被 target 状态值替换。

## 5. 日志接入

`createRpcLogProbe(logger, options?)` 在 `@migaia/rpc-devtools/log`。Logger 只需提供 `debug`、`info`、`warn`、`error(message: string, fields: object)`；无需使用 `@migaia/logger`。

默认订阅 message/peer：failed 为 error，rejected、timeout、abort 为 warn，peer 生命周期为 info。正常 settled 不记录；设置 `slowMs` 后，durationMs 达到阈值的 settled 记 warn。

`levels` 可按 failed/rejected/timeout/aborted/slow/lifecycle 覆盖级别，`off` 禁用对应日志；`methods`、`sample`、`stages` 在构造时编译。

不要在自定义 `emit` 中把 `view` 本身放进异步 logger。View 只在同步 emit 期间有效，异步输出时常已变成下一事件。Log probe 先按整数 outcome/kind 做决定，再同步提取 method、messageId、senderId、targetId、trace、durationMs、outcome、kind、rejection、lifecycle、peerId 与 error。字段对象不随 view 复用变化；error 保留原实例，content 默认不记录。`content: true` 为订阅阶段请求捕获；view 的 content 来自 emitter 已完成的捕获/脱敏路径，嵌套引用仍可能被调用方修改。`capture` 与 `redact` 原样传给 defineProbe；`content: true` 保留旧便利选项。异步 logger thenable 的拒绝观察使用一个 reaction Promise，这是授权的 logger 路径，默认 collector/业务路径不添加 Promise。

Logger 方法必须不阻塞，只把日志交给现有缓冲。同步文件写入会把 I/O 放到 RPC 调用路径。Log probe 每个合格事件只同步调用一次 logger；不另建缓冲、分块、锁、文件写入、轮转或 flush。Logger 抛错或返回 rejected thenable 时，错误进入 `onError`，不会改变业务结果；未配置 reporter 时使用 host reporter。`onError` 自身失败仍交给 host reporter。

推荐 `@migaia/logger` 的 `level` 提供四个级别方法，`batch` 提供批处理能力，`file` 输出逐行 JSON。`batch` 放在 `file` 之前，`asyncOutput: true` 延迟输出；关闭时由应用等待 logger.flush/shutdown。下面注入内存 file sink，让文档示例无需实际写文件；Node 生产配置可省略注入，file 默认异步使用 `node:fs/promises` append，父目录由应用创建。

```ts doc-test=run
import { Logger, setLoggerRuntimeManager } from '@migaia/logger'
import { batch, level } from '@migaia/logger/plugins'
import { file } from '@migaia/logger/plugins/file'
import { createRpcLogProbe } from '@migaia/rpc-devtools/log'

/** 示例用内存代替文件 I/O；生产 fs 能力仍由 Logger 拥有。 */
const lines: string[] = []
/** 注入拥有独立恢复句柄，关闭 Logger 后归还环境。 */
const restore = setLoggerRuntimeManager({
  randomUUID: () => 'doc-log',
  defer: (task) => queueMicrotask(task),
  write: () => undefined,
  fs: {
    async append(_path, text) {
      lines.push(text)
    }
  }
})
/** level 方法只入队，batch/file 接管输出与收尾。 */
const logger = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [
    level({ level: 'debug', asyncOutput: true }),
    batch({ maxSize: 20, maxWaitMs: 1_000, asyncOutput: true }),
    file({ path: 'logs/rpc.jsonl' })
  ]
})
try {
  /** 传给已有 Peer 的 probe；本例只展示 logger 配置。 */
  const probe = createRpcLogProbe(logger, { slowMs: 200 })
  console.log(probe.stageMask)
  logger.info('RPC logger ready', { slowMs: 200 })
  await logger.flush()
  console.log(lines.length > 0) // true
} finally {
  await logger.shutdown('manual')
  restore()
}
```

`carrierSeq` 在 wire 中引用同一 collector/target 的 carrier 行；hub 不混用不同 target 的序号。Outbound 直接按 senderId:messageId 入索引；inbound 匿名 protected/frame 保留数字链接，真实 decode envelope 提供身份后加入该 interaction。摄取关联行时若原 carrier 已在所有环中淘汰，链接省略；之后淘汰可留下已记录的序号，hub 不补造丢失的 carrier。Frame 内容与 nested transfer 都按引用保存；Byte detail 的 drainMs 在原生 drain 后可更新，显式顶层快照也不会深复制 detail。
