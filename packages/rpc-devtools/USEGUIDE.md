# `@migaia/rpc-devtools` 使用指南

按下面的实际任务查找；collector/log 场景观察公开 memory 载体上的真实 Core Endpoint，离线场景传入完整 v1 记录，不伪造宿主或连接。

## 按场景查找

| 场景                                 | API                       | 详细说明                                          |
| ------------------------------------ | ------------------------- | ------------------------------------------------- |
| 保留最近调用事件并维持累计调用计数   | `createRpcDevtools`       | [完整示例](#保留最近调用事件并维持累计调用计数)   |
| 清空实时视图而不中断已有录制         | `createRpcDevtools`       | [完整示例](#清空实时视图而不中断已有录制)         |
| 往返保存捕获字节与原生错误链         | `encodeRpcDevtoolsRecord` | [完整示例](#往返保存捕获字节与原生错误链)         |
| 先排序非单调录制再限制时间线结果     | `createRpcDevtoolsHub`    | [完整示例](#先排序非单调录制再限制时间线结果)     |
| 标出交互缺失侧而不补造事件           | `createRpcDevtoolsHub`    | [完整示例](#标出交互缺失侧而不补造事件)           |
| 脱敏真实调用日志并隔离日志接收端失败 | `createRpcLogProbe`       | [完整示例](#脱敏真实调用日志并隔离日志接收端失败) |

## 运行准备

```bash
pnpm add @migaia/rpc-devtools @migaia/rpc-core @migaia/rpc-contract
```

每个代码块作为独立 Node 24 TypeScript 模块执行。所有导入都是公开入口；memory transport 是 Core 的真实载体，record 是完整离线输入。示例不连接外部网络，也不写文件；Endpoint、collector 与 Hub 分别由各自 owner 清理。

## 保留最近调用事件并维持累计调用计数

长期诊断需要保留最近事件，但旧事件离开列表时，累计调用数不能跟着减少。

如果所有统计都从同一个有界事件列表重新计算，列表一淘汰旧记录，累计值也就变小了。

通过 `probePlugin` 把 collector 接到真实 Endpoint；`maxEvents` 限制查询保留量，`stats` 独立累计已经结束的方法调用。

```ts doc-test=run
import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createRpcDevtools } from '@migaia/rpc-devtools'

const devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect()],
  provider: { double: (context) => context.success((context.data as number) * 2) }
})
const client = await createEndpoint({
  id: 'client',
  transport: left,
  middlewares: [connect(), probePlugin(devtools)]
})
try {
  for (const value of [1, 2, 3]) await client.send('server', 'double', value)
  const page = devtools.query({ methods: ['double'], limit: 2 })
  console.log(page.events.length)
  console.log(devtools.stats().methods.find((row) => row.method === 'double')?.calls)
  console.log(page.counters.evicted > 0)
} finally {
  await Promise.all([client.dispose(), server.dispose()])
  devtools.close()
  left.close()
}
```

输出：

```text
2
3
true
```

输出 `2`、`3`、`true`：只保留两个最近事件，累计值仍记录三次已完成调用，并且确实淘汰过旧事件。

本例把默认 `10000` 事件容量改为 `2`，只选 `message` 阶段。累计统计保留到 `clear` 才清空；这是保留语义，不是整个进程的内存上限。

### 示例参数

collector.stages 本例仅 message，默认是 message/peer；maxEvents 默认 10000，本例 2。query.methods=['double'] 按实际方法筛选，limit 默认 1000、本例 2。memory pair 是真实公开载体，两个 Endpoint 的 id 是 client/server，transport 分别使用 left/right；connect 使用该 Endpoint 的载体，probePlugin 安装 devtools。provider.double 从 context.data 取数并 success 返回两倍，send 明确目标、方法与 data；未装 timeout 时沿 Core 1000 ms 默认。Endpoint dispose 不关闭借用 memory pair，最后 left.close 关闭两侧。

## 清空实时视图而不中断已有录制

操作员要清掉嘈杂的实时视图，但已经开始的录制仍需保留清空之前的调查证据。

显示和录制若共用一份存储，一个看似无害的界面重置就会擦掉录制数据。

给 `record` 单独设置容量，采集真实请求后先清主环，再停止并导出已有录制。

```ts doc-test=run
import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createRpcDevtools } from '@migaia/rpc-devtools'

const devtools = createRpcDevtools({ stages: ['message'], maxEvents: 2 })
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect()],
  provider: { echo: (context) => context.success(context.data) }
})
const client = await createEndpoint({
  id: 'client',
  transport: left,
  middlewares: [connect(), probePlugin(devtools)]
})
try {
  const recording = devtools.record({ maxEvents: 64 })
  await client.send('server', 'echo', 42)
  devtools.clear()
  console.log(devtools.query().events.length, devtools.stats().methods.length)
  const record = recording.stop()
  const restored = devtools.importRecord(devtools.exportRecord(record))
  console.log(record.events.length > 0)
  console.log(restored.events.length === record.events.length)
} finally {
  await Promise.all([client.dispose(), server.dispose()])
  devtools.close()
  left.close()
}
```

输出：

```text
0 0
true
true
```

输出 `0 0`、`true`、`true`：主环与统计已清空，独立录制仍保留事件，导出文本再导入后事件数一致。

录制容量默认继承 collector 的 `maxEvents`，本例改为 `64`；`clear` 不结束录制，也不重置序号，`stop` 只能成功执行一次，`close` 会丢弃尚未停止的录制。

### 示例参数

Endpoint 与 probe 安装同上一场景；record.maxEvents 默认继承主环 2，本例显式 64。echo 返回原 data 42，clear 清主环/统计，不停止录制。recording.stop 成功一次后失去活动所有权；exportRecord/importRecord 仅进行 v1 编解码，不执行文件 I/O。finally 分别关闭 Endpoint、collector 与 memory pair。

## 往返保存捕获字节与原生错误链

离线诊断文件既要保存字节载荷，也要保留失败操作背后的原始原因。

直接使用普通 JSON 会把类型化字节变成对象字段，并丢掉 Error 的不可枚举属性，导入后的事故信息因此不完整。

把完整 v1 记录交给 `encodeRpcDevtoolsRecord`，再用配套解码器读取，编解码器负责保留字节标签与原生错误图。

```ts doc-test=run
import * as format from '@migaia/rpc-devtools/contract'

const causeText = '字段无效'
const failureText = '请求失败'
const cause = new TypeError(causeText)
const failure = new Error(failureText, { cause })
Object.defineProperties(cause, { source: { value: 'example' }, code: { value: 'FIELD' } })
Object.defineProperties(failure, { source: { value: 'example' }, code: { value: 'REQUEST' } })
const text = format.encodeRpcDevtoolsRecord({
  header: format.RpcDevtoolsRecordFormat,
  events: [
    {
      seq: 1,
      at: 10,
      endpointId: 'client',
      stage: 'message',
      direction: 'outbound',
      content: new Uint8Array([1, 2, 3]),
      error: failure
    }
  ]
})
const restored = format.decodeRpcDevtoolsRecord(text)
const error = restored.events[0]?.error
console.log(error instanceof Error, error instanceof Error && error.cause instanceof TypeError)
console.log(error instanceof Error && error.stack === failure.stack)
console.log([...(restored.events[0]?.content as Uint8Array)].join(','))
```

输出：

```text
true true
true
1,2,3
```

输出 `true true`、`true`、`1,2,3`：解码还原 Error 及其 TypeError 原因，保留记录中的堆栈，并还原字节值。

编解码器只转换离线表示，不执行文件读写；单键 `$bytes` 对象属于 v1 保留语法，不保证任意对象、原型和函数都能无损往返。

### 示例参数

record.header 使用固定 RpcDevtoolsRecordFormat，事件的 seq/at 是有限数值，endpointId/stage/direction 是必需字符串；content 是 [1,2,3] 字节，error 是带原 cause 的原生 Error。Object.defineProperties 只为本例原错附示意 source/code，不生成运行时控制权限。encode/decode 均只收一个输入参数，恢复的新 Error 保留记录 stack，而不是原对象身份。

## 先排序非单调录制再限制时间线结果

导入录制的时间戳并不按事件序号递增，操作员却要查看时间最早的两个事件。

如果先截取两行再排序，就可能显示较晚的事件，把仍在录制中的更早事件漏掉。

把合法录制导入为离线目标，`timeline` 会先排列保留的候选事件，再应用结果数量限制。

```ts doc-test=run
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import * as format from '@migaia/rpc-devtools/contract'

const text = format.encodeRpcDevtoolsRecord({
  header: format.RpcDevtoolsRecordFormat,
  events: [50, 10, 30].map((at, index) => ({
    seq: index + 1,
    at,
    endpointId: 'client',
    stage: 'message',
    direction: 'outbound'
  }))
})
const hub = createRpcDevtoolsHub()
try {
  hub.importRecord('saved', text)
  console.log(hub.status('saved'))
  const events = hub.timeline({ targets: ['saved'], limit: 2 })
  console.log(events.map((event) => event.alignedAt).join(','))
  console.log(events.every((event) => event.uncertaintyMs === undefined))
  console.log((await hub.stats('saved')).methods.length)
} finally {
  await hub.close()
}
```

输出：

```text
offline
10,30
true
0
```

输出 `offline`、`10,30`、`true`、`0`：取到最早的两个时间，未虚构时钟不确定度，也未替离线事件编造累计统计。

离线 `alignedAt` 就是记录中的 `at`；`maxEvents` 默认每个目标 `50000`，`importRecord` 不创建远程连接，也不启动时钟对齐或周期校时。

### 示例参数

encode 的 events 保持文件序号 1..3，at 刻意为 50/10/30，不要求时间单调。Hub options 省略时 maxEvents=50000/target、realignMs=undefined、onError=undefined（默认 console.error）。importRecord 的 saved 是唯一目标名；timeline.targets 筛此目标，limit=2 在全候选排序后生效，默认无 limit。离线 uncertaintyMs 为 undefined，stats 不从事件重算累计值。

## 标出交互缺失侧而不补造事件

两个诊断文件可能分别记录同一次调用的两侧，缺少其中一个文件时就只能看见单侧。

只按方法名拼接会混合无关调用，自动补齐另一侧又会创造从未观察过的证据。

Hub 按显式 `senderId` 与 `messageId` 关联，并支持 trace 筛选；移除目标会同步更新保留事件的交互索引。

```ts doc-test=run
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import * as format from '@migaia/rpc-devtools/contract'

const outbound = {
  seq: 1,
  at: 10,
  endpointId: 'client',
  stage: 'message',
  direction: 'outbound',
  kind: 'request',
  senderId: 'client',
  messageId: 'call-1',
  method: 'load',
  trace: 'trace-1'
}
const inbound = { ...outbound, at: 11, endpointId: 'server', direction: 'inbound' }
const encode = (event: typeof outbound) =>
  format.encodeRpcDevtoolsRecord({ header: format.RpcDevtoolsRecordFormat, events: [event] })
const hub = createRpcDevtoolsHub()
try {
  hub.importRecord('caller', encode(outbound))
  console.log(hub.interactions('trace-1')[0]?.oneSided)
  hub.importRecord('provider', encode(inbound))
  const interaction = hub.interactions('trace-1')[0]
  console.log(interaction?.oneSided, interaction?.targets.join(','))
  await hub.removeTarget('provider')
  await hub.removeTarget('provider')
  console.log(hub.status('provider'), hub.interactions('trace-1')[0]?.oneSided)
} finally {
  await hub.close()
}
```

输出：

```text
true
false caller,provider
removed true
```

输出 `true`、`false caller,provider`、`removed true`：单个文件只有一侧，匹配的第二个文件补全已观察到的两侧，移除后又恢复单侧标记。

只有保留的请求与响应角色能证明观察侧；Hub 不自动传播 trace，也不发起业务请求，成功移除的目标可以再次移除，不会重新创建。

### 示例参数

两个离线事件共有 senderId=client/messageId=call-1/trace=trace-1，endpointId 和 direction 分别证明调用方与提供方角色；method 名相同本身不足以关联。Hub 依次导入 caller/provider，interactions(trace) 精确筛选已保留记录；removeTarget(provider) 先清索引，再等待自有 watch（本例无远程 watch），重复移除已移除名称幂等。

## 脱敏真实调用日志并隔离日志接收端失败

诊断需要选定的 RPC 内容，但日志不能泄露原数据，也不能改变本来成功的业务结果。

直接保存可复用的探针视图，会让后续事件覆盖排队中的字段；未处理的日志异常还可能打断调用方。

通过真实 Core 观察路径安装 `createRpcLogProbe`，显式设置 `capture`、`redact`、`onError`，同步提取字段，并单独报告接收端失败。

```ts doc-test=run
import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { probePlugin } from '@migaia/rpc-core/probe'
import { createRpcLogProbe } from '@migaia/rpc-devtools/log'

const failureText = '日志接收端失败'
const failure = new Error(failureText)
const masked = { hidden: true }
const fieldsSeen: object[] = []
const reports: unknown[] = []
const logger = {
  debug() {},
  info() {},
  error() {},
  warn(_message: string, fields: object) {
    fieldsSeen.push(fields)
    throw failure
  }
}
const probe = createRpcLogProbe(logger, {
  stages: ['message'],
  capture: ['message'],
  slowMs: 0,
  redact: () => masked,
  onError: (error) => {
    reports.push(error)
  }
})
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect()],
  provider: { echo: (context) => context.success(context.data) }
})
const client = await createEndpoint({
  id: 'client',
  transport: left,
  middlewares: [connect(), probePlugin(probe)]
})
try {
  console.log(await client.send('server', 'echo', 42))
  console.log(
    fieldsSeen.length > 0,
    fieldsSeen.every((fields) => Reflect.get(fields, 'content') === masked)
  )
  console.log(new Set(fieldsSeen).size === fieldsSeen.length)
  console.log(
    reports.length === fieldsSeen.length,
    reports.every((error) => error === failure)
  )
} finally {
  await Promise.all([client.dispose(), server.dispose()])
  left.close()
}
```

输出：

```text
42
true true
true
true true
```

输出 `42`、`true true`、`true`、`true true`：请求成功，合格日志使用脱敏对象，每份字段对象独立，所有接收端失败都以原身份报告。

`slowMs` 默认 `undefined`，不记录普通成功调用；本例设为 `0` 以纳入它们。内容捕获默认关闭，脱敏以引用替换内容，缓冲与外部 I/O 由日志接收端负责。

### 示例参数

logger 是完整四方法本地接收对象；warn 保存每次独立 fields 并抛同一个 failure，onError 保存原异常。stages 只 message，capture 显式 message（默认无），slowMs=0 纳入成功调用（默认 undefined 不纳入）；redact 返回同一 masked 对象，保留引用而非深快照。levels 未覆盖，slow 默认 warn；真实 Endpoint 的 probePlugin 把该 probe 安装到 Core，不手填事件视图，echo 仍返回 42。

## 契约细节

### 归属与四个入口

| 入口                          | 用途                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| @migaia/rpc-devtools          | createRpcDevtools 与 collector 类型、错误身份                                               |
| @migaia/rpc-devtools/contract | service/wire/record 类型、RpcDevtoolsRecordFormat、encode/decodeRpcDevtoolsRecord、错误身份 |
| @migaia/rpc-devtools/hub      | createRpcDevtoolsHub、target、时钟对齐、timeline、interactions、stats、离线导入             |
| @migaia/rpc-devtools/log      | createRpcLogProbe 与结构化 logger 边界类型                                                  |

Collector 本身就是可装入 Core 的 Probe（同步观察接口），不创建 Peer、transport、持久化存储或文件。defineProbe 的 host 形式把已编译字段附到同一对象并冻结，保留身份；将 collector 传给已有 Endpoint/Peer 的 probe，仍分别管理业务连接和 collector。Core 的直接观察、Peer、managed source 与 pool member 转发复用同一 probe 契约。

Hub 只使用已有 service client 或离线 record，不创建连接、重连监督或业务重试。Log probe 只选择与提取日志字段，缓冲和输出由 logger 拥有。包目前为 workspace-private，peer 依赖 rpc-core/rpc-contract，安装时应直接声明二者；不存在运行时“版本必须相等”的校验。发布保留 dist 与四个入口。

### Collector 配置与采集边界

| 参数            | 默认原值与有效范围                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| stages          | ['message','peer']；其余 envelope/encoded/frame/protected/carrier 必须显式选择，也可运行时 setStages |
| capture         | undefined，不捕获内容；显式列出需要捕获的阶段，选择 stages 本身不会开启捕获                          |
| redact          | undefined；同步转换已选内容，失败报告 REDACT_FAILED/cause 并丢弃内容，元数据仍按当前生命周期处理     |
| methods         | undefined，无名称过滤；只过滤带 method 的 message/envelope，无 method 的 control variation 仍通过    |
| sample          | undefined，等同 1 全采样；有效值 0<sample≤1，不能用 0 暂停                                           |
| maxEvents       | 10000，正安全整数且≤4294967295；主查询环容量                                                         |
| maxContentBytes | 8*1024*1024，非负安全整数；仅主查询环内容预算                                                        |
| maxInterned     | 65536，正安全整数且≤94906264；读取时名称驻留上限                                                     |
| exposeContent   | false；是否允许内容跨 service 边界，与 capture 分开                                                  |
| onError         | undefined；失败交给 Core host reporter，显式回调用于报告原失败                                       |

无效配置使用本包 INVALID_OPTION/TypeError；实际可分配容量仍受宿主内存限制。默认只订阅 message/peer 的逻辑事件；没有默认录制物理帧，也没有隐含 sync/async 摄取模式。

emit(view) 在同步返回前把顶层元数据写入自有原始列，字符串保留引用，不保留 emitter 复用的 view。摄取不进行名称驻留、refcount、carrier 序号翻译或逐 watcher 入队；query、watch 交付、stats、record.stop、export 与 service 在读取边界派生驻留、关联和 wire 表示。不要把可复用 view 留给异步处理。

message/envelope 的可选 variation 保留原 route subtype，例如 ping、pong、close、abort 与已登记的用户名称；abort 的 kind 为 cancel，其余 variation 为 control。request/response 与其它阶段不带此字段，query/watch/wire/录制 codec 保留它。

detail、error 与未实际转移的 captured content 仍是原引用，修改可能影响后续读取；snapshotProbeEvent 也仅复制顶层元数据，不深拷贝这些对象。内容预算按字符串 UTF-8 长度、ArrayBuffer/View.byteLength，或 opaque object 的 view.sizeBytes 计费；未知 sizeBytes=-1 的 opaque object 计 0，不扫描/编码对象图。录制、watch 独立引用不计入主环预算，maxContentBytes 不是进程、全部窗口或任意对象图的总内存上限。

### 查询、统计、暂停与 watch

query(input?) 返回 {events,nextSeq,counters}，在保留环单次扫描；nextSeq 是后续 afterSeq 游标，不是数组下标。counters 包含 evicted、contentDropped、droppedReentrant、sampledOut、ignoredWhilePaused、ignoredAfterClose、internOverflow，分别记录事件淘汰、内容丢弃、重入丢弃、采样丢弃、暂停/关闭忽略和名称溢出。

| 查询字段              | 默认与说明                                                          |
| --------------------- | ------------------------------------------------------------------- |
| afterSeq              | 0，非负安全整数，只选更大的序号                                     |
| limit                 | 1000，安全整数 1..1000                                              |
| stages / outcomes     | undefined 为全选，空数组匹配零行；名称使用 Core 公开阶段/outcome 域 |
| methods / endpointIds | undefined 为不筛选，显式数组按对应字段匹配                          |
| trace                 | undefined 为不筛选，提供字符串时精确匹配                            |

构造 methods 是摄取过滤；query/watch 的 methods 只匹配实际带该 method 的行，所以 reader 方法过滤不会带上无 method 的 control。读取时名称表满后，新名称使用溢出 id 0 并增加 internOverflow；已有名称继续还原。maxInterned 不限制累计统计保留的原始 endpoint/method 组合，它们直到 clear 才释放，持续增加的唯一组合仍可增长。

只有同时具备非负 durationMs 和 method 的 settled/failed/rejected message 事件才同步更新统计，每个合格事件一次。统计按 endpoint/method 保存 calls、failed、rejected、timedOut、aborted，主环淘汰不清除累计值。failed 包含所有 outcome=failed 的事件，timedOut/aborted 另行增加，因此这些计数不是互斥类别，不能直接相加当总调用数。延迟使用 24 个 log2 桶，边界为 0.0625 ms×2^k（k=0..23）；分位数桶内插值，末桶从 latencyOverflowFromMs=262144 ms 向上开放，p50/p95/p99 钳制到实际 latencyMaxMs，末桶没有固定宽度误差保证。describe.now 与 Core 事件 at 默认使用单调毫秒；stats.since 使用墙上时钟，不能直接当同一时域排序。

pause 保存最新有效 stages 并清空 emitter mask，重复 pause 不覆盖保存值；resume 恢复选择，构造后 setStages 的变化会保留。暂停期间直接 emit 计 ignoredWhilePaused。clear 清主环、累计统计与损失计数，不结束独立录制或 watch；序号继续属于原 collector。

watch(input?) 不接受 afterSeq/limit，首次 next 才激活消费者。活跃 watcher 共用 16384 行原始待通知窗口；每个同步 burst 最多安排一次 microtask 通知，没有活跃 watcher 时不安排通知。原始窗口先保留事件，通知时才执行各 watcher 过滤；每批最多 256 行，每个消费者最多 64 批，过慢时丢最旧批。{events,dropped} 的 dropped 包含筛选前原始覆盖与消费者筛选后批次淘汰，不能还原为精确的过滤命中损失。

原始丢失计数在通知时分发给当时活跃的 watcher；在 burst 通知已安排、尚未交付时首次 next 的 watcher，可能看到订阅前的原始损失。这是当前源码边界，不承诺订阅后精确损失计数。iterator.return 会唤醒自己的挂起 next 并正常结束，不必关闭 collector；collector.close 使等待中的 watch 以 CLOSED 结束。

### 录制、service 与离线格式

record({maxEvents?}) 默认沿主环 maxEvents，使用独立环；主环 clear 或淘汰不停止录制，同一时刻只允许一个活动 recording。handle.stop 返回 IRpcDevtoolsRecord，重复 stop 或使用已失去所有权的旧 handle 为 RECORD_NOT_ACTIVE；重复 record 为 RECORD_ACTIVE。collector.close 丢弃未停止的录制，幂等关闭并释放自有状态，不关闭业务 Peer。关闭后 query/stats/describe 与控制操作拒绝 CLOSED，直接 emit 仅计 ignoredAfterClose；exportRecord/importRecord 是纯 codec 入口。

将 devtools.service 放到独立已有 Peer 的 provide:{devtools:devtools.service}，远端方法为 devtools.describe/query/watch/stats/record.start/record.stop/clear/pause/resume；watch 用 Peer.stream 消费。Service record.stop 返回编码文本，普通 handle.stop 返回 record 对象。默认不输出 content；只有 capture 与 exposeContent:true 都按需设置，内容才可能跨线，发布前仍应 redact 并检查访问权限。

Service 使用真实 context.localEndpointId 排除 serving endpoint 的后续采集以及已保留 query/stats 行，不按 devtools.* 方法前缀误删业务。独立 service Peer 避免排除业务 endpoint。远程 watch 取消使用原 stream signal 释放等待。Service 在边界转为 JSON/portable wire：保留序列化 Error 链与 byte 标签，移除 undefined/function 和类 prototype，BigInt 转字符串；不是任意 JS 图无损复制。转换失败抛 TypeError/SERVICE_RESULT_INVALID，原错保留 cause。

RpcDevtoolsRecordFormat 为 {format:'migaia-rpc-devtools',version:1}。encodeRpcDevtoolsRecord(record) 返回 UTF-8 兼容 NDJSON 文本，首行 header，随后每行一个事件并带末尾换行；decodeRpcDevtoolsRecord(text) 接受有或没有末尾换行，内部空行仍非法。事件至少有有限 number 的 seq/at、string 的 endpointId/stage/direction；文件顺序不被 codec 排序或对齐。无效 header/版本/事件/JSON/字节标签使用 RECORD_FORMAT_INVALID/cause，不创建持久化资源。

ArrayBuffer/Uint8Array 使用 {$bytes:base64}，在事件任意深度，单键同形对象都是 v1 保留语法，解码为 Uint8Array；非法或非规范 Base64 拒绝。要保留同形普通对象，先 JSON.stringify 为内容字符串，导入后自行 JSON.parse；没有自动转义，也不承诺 content:unknown 任意对象往返无损。

Record.error 输入允许 Error 或已序列化 IRpcWireError；编码复用 RPC 错误 codec，保留 source/code/name/message/stack/cause 与聚合成员，已序列化错误先规范化；解码还原原生 Error，不生成替代 stack。Service wire event.error 保持序列化表示，Hub 离线导入在自己的边界把恢复的 Error 转成同一 wire 形式。

### Hub：已有 client、时钟与查询

| Hub 选项  | 默认与说明                                                          |
| --------- | ------------------------------------------------------------------- |
| maxEvents | 50000，正安全整数且≤4294967295；每个 target 独立上限                |
| realignMs | undefined，只在接入时对齐；显式正有限 number 开启周期对齐，可为小数 |
| onError   | undefined，默认 console.error；reporter 自身失败仍报告聚合原错      |

addTarget(name,client) 要求非空唯一名称，client 是已有 request/stream 对象；Hub 调用 request('describe'/'query'/'stats') 与 stream('watch')，不创建连接。若 service 位于 devtools.* 嵌套路径，由调用方 client 边界映射方法名，不在 Hub 新造 Peer。

对齐依次取五次 describe，选 RTT 最小样本：offset=remoteNow-(t0+t1)/2，uncertaintyMs=RTT/2，alignedAt=event.at-offset。依赖往返对称假设，不是无误差时钟；自定义 target 样本必须与事件同一时域，不能把一个样本用于混合时钟。重新对齐仅在全部样本成功后更新已有 timeline 包装，之前取得的引用也会看到新 alignedAt。

初始化先启动唯一 watch 的首次读取，再 afterSeq 分页补历史，每页 1000，之后消费已开始的 watch 并按 seq 去重；只有 collector 原有有界队列。status/on('status') 使用 connecting/connected/disconnected/offline/removed 生命周期值，不是错误码；省略 status 名称返回新状态 Map。on('event') 返回新摄入的已存储包装；listener 失败报告后继续其他监听器。

timeline({targets,stages,trace,method,from,to,limit}) 默认无这些筛选；from/to 按对齐时间，limit 可为非负安全整数，0 返回空。有序 target 环先检查顺序再 k-way merge；合法非单调事件完整排序后应用 limit，最终按 alignedAt、target 名、seq 稳定决定次序，不改文件顺序或原 event 引用。

interactions(trace?) 按显式 trace 和 (senderId,messageId) 关联，不自动传播 trace。oneSided 由请求/响应的业务角色证据决定，不由 target 数决定：同一 target 的两个 endpoint 可证明两侧，重复导入调用方记录不会补出提供方。Hub 不推断缺失事件、不重放业务。stats(name) 转发实时 target 原结果；stats() 汇总计数和直方图桶后重新求分位数，不平均各 target 的 p50/p95/p99；已有最大值保留，旧 target 缺最大值时不伪造。

importRecord(name,text) 创建只读 offline target，alignedAt=原 at，uncertaintyMs=undefined，不恢复录制时偏移。Record v1 不含累计统计，离线 stats 是 {since:0,methods:[]}，汇总不补造离线计数。timeline/interactions 返回数组复用已存储包装与内部事件，detail/error/未转移 content 仍借用引用，不应修改只读结果；codec 才是独立文本表示的边界。

### 关联保留与生命周期失败

carrierSeq 只引用同一 collector/target 的 carrier 行。Collector 在读取时把 Core 本地序号翻译为 collector 序号，合并主环、录制、watch 仍保留的 origin；摄取时不创建另一套 generation 历史。首次解析前已从所有窗口淘汰的 origin 无法恢复；已知链接在 dependent 仍保留时有效。冷读取发现源序号重置后记录旧 origin cutoff，阻止旧行关联新 generation，历史已知链接仍保留。

Hub 在真实 decode 身份到达后，把同 target 的匿名 protected/frame/carrier 行增量加入 interaction，不改原 wire event，也不混用另一 target 相同 seq。窗口淘汰会同时删除 interaction/trace 索引。部分匿名前序 chunks 仍不能全部归入 interaction；仓库 carrier 在 send 内同步 emit，第三方异步 emit 没有 outbound context。Native Peer 不自动传播应用 trace，需从应用自己的 Endpoint.send 显式传递。Frame/nested transfer 保留引用，detail.drainMs 可在原生 drain 后更新，顶层快照也不深拷贝。

重复 target 名为 TARGET_DUPLICATE，未知名称为 TARGET_UNKNOWN；移除已移除名称幂等。removeTarget 先使目标失效并清索引，再等待其 iterator.return，清理失败报告并原错拒绝。重入 close 会等待已拥有的移除清理，不重复 return；晚到 describe/watch 数据不能复活已移除目标。

describe/query 初始化失败使 target disconnected，报告并以同一原错拒绝 addTarget，已取得 watch 会释放，副清理失败不覆盖主错。运行 watch 中断报告并保留已接收记录，不自动重试；同步 next 失败也不会随后发布 connected。Hub.close 立即封闭新操作，复用同一 Promise，释放所有 owned watch；按登记顺序将失败汇成 TARGET_RELEASE_FAILED AggregateError，cause/errors[0] 为首原错，报告后 resolve。它不关闭已有 client/Peer，关闭后除重复 close 外的公开操作为 CLOSED。

### Log probe

createRpcLogProbe(logger,options?) 要求完整 debug/info/warn/error(message,fields) 四个方法，不依赖 @migaia/logger。默认 stages=['message','peer']；这里只接受这两种阶段。methods/sample 由 Core 同一规则编译，capture/redact 走 emitter 原边界；content 默认 false，content:true 是订阅阶段捕获的便利选项，显式 capture 优先。slowMs 默认 undefined，正常 settled 不记录；显式有限非负值（可 0）使 durationMs≥阈值的 settled 进入 slow。

levels 可覆盖 failed/rejected/timeout/aborted/slow/lifecycle，取 debug/info/warn/error/off。默认 failed→error，rejected/timeout/aborted/slow→warn，lifecycle→info；timeout/aborted 从失败身份识别，不是新增 outcome 字面量。message(view) 默认使用本包分类消息，只在合格事件执行；onError 默认 host reporter。

Log probe 同步提取独立 fields：method/messageId/senderId/targetId/trace/durationMs/outcome/kind/rejection/lifecycle/peerId/error。不会把复用 view 交给异步 logger，error 和显式 content 仍按引用保留，不承诺深快照。每个合格事件同步调用一次 logger；logger 抛错或 thenable 拒绝报告到 onError，不改变业务结果，reporter 失败仍交 host reporter。异步 logger 路径会观察 thenable，普通 collector 业务路径不因此添加 Promise。

Logger 方法必须不阻塞，只入已有队列；本包不另建缓冲、批次、文件、锁、轮转或 flush。使用 @migaia/logger 时，可组合 level、batch、file 并明确 asyncOutput:true，应用负责 await flush/shutdown；Node file 默认异步 append，目录由应用创建，其他宿主需相应 file 能力。示例若直接使用这些入口，应额外直接安装该包；无需为了 log probe 强制依赖它。

### 错误身份与开发命令

错误 source 是 RPC_DEVTOOLS_SOURCE（rpc.devtools），code 从 RpcDevtoolsErrorCode 读取，按 source/code 分类，不匹配 message。

| code                              | 场景                                                      |
| --------------------------------- | --------------------------------------------------------- |
| INVALID_OPTION                    | 配置或查询参数超出支持域，修正输入                        |
| CLOSED                            | 已关闭的 collector/hub 操作，创建新的 owner               |
| RECORD_ACTIVE / RECORD_NOT_ACTIVE | 重复开始，或没有对应活动 recording 可停止                 |
| RECORD_FORMAT_INVALID             | NDJSON/header/事件/bytes/error 格式无效，查看 cause       |
| REDACT_FAILED                     | 脱敏回调失败，报告原因并丢弃内容                          |
| TARGET_DUPLICATE / TARGET_UNKNOWN | 重复登记名称，或操作从未登记的目标                        |
| TARGET_RELEASE_FAILED             | Hub 释放 watch 汇总失败，查看 cause/errors                |
| SERVICE_RESULT_INVALID            | service 结果无法转成可传输表示，查看 cause 或关闭内容暴露 |

本包在原生错误上附加身份，不替换 stack/cause。Client 运行失败保持原身份，target 状态不覆盖错误。以下是现有包脚本，列出不代表文档编辑独立运行，也不把基准当成已测性能结论：

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
```
