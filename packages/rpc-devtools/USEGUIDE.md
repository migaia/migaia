# `@migaia/rpc-devtools` 使用手册

当前交付契约、codec 与 hub。Collector 仍为占位工厂，其类型用于后续实现。

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
  events: [{
    seq: 1,
    at: 0,
    endpointId: 'client',
    stage: 'message',
    direction: 'outbound',
    kind: 'request',
    method: '读取',
    content: new Uint8Array([1, 2, 3])
  }]
}
/** 同一 codec 可供 collector 导出和 hub 离线导入使用。 */
const decoded = decodeRpcDevtoolsRecord(encodeRpcDevtoolsRecord(record))
console.log(decoded.events[0]?.method)
```

Bytes 表示为 `{ "$bytes": base64 }`。录制错误使用 `serializeRpcError` / `deserializeRpcError`，保留原始 stack 和 cause 链；解码不重建 stack。`IRpcDevtoolsWireEvent.error` 是 service 传输的序列化错误；`IRpcDevtoolsRecordEvent.error` 的输入接受 `Error | IRpcWireError`，以便直接录制 service 事件。编码原生 Error 时序列化，已序列化错误按 RPC 契约规范化；解码后还原为原生 Error。

错误格式名、非 1 版本、缺少 header 字段或非法 JSON 会抛出 `RECORD_FORMAT_INVALID`，原始解析或验证失败保留在 `cause`。

## 2. Collector 契约

`createRpcDevtools(options)` 的返回类型继承 `IRpcProbe`。revision 2 的 `defineProbe(definition, host)` 可把 Probe 直接附到 collector 自己的对象上，冻结并返回同一引用，避免复制 handle 后丢失身份。选项包括 `stages`、`capture`、`redact`、`methods`、`sample`、`maxEvents`、`maxContentBytes`、`maxInterned`、`exposeContent` 与 `onError`。后续 collector 将提供 `query`、`watch`、`stats`、`describe`、录制、暂停/恢复、清理与 service。

按照 SC9，采集时保留 `detail`、error 与未实际转移的 content 引用，发送后对这些对象的修改可能反映在后续读取中。`snapshotProbeEvent` 只按显式请求复制顶层事件元数据（SC9c），内部引用仍可变；codec 在编码/解码边界转为独立 wire/text 表示（SC9b）。

`watch` 的批次类型是 `{ events, dropped }`。`record().stop()` 返回离线 record；service 的 `record.stop()` 返回编码文本。Service 默认不暴露 content，须由 `exposeContent` 明确启用。`IRpcDevtoolsCounters` 包含环形存储淘汰、内容丢弃、重入丢弃、采样丢弃、暂停/关闭忽略与字符串驻留溢出的计数。

`stats` 按 endpoint 和 method 提供调用、失败、拒绝、超时、取消计数，以及 24 个固定 log2 延迟桶：边界为 `0.0625 ms × 2^k`，`k = 0…23`。p50/p95/p99 在桶内插值，误差上界为所在桶宽度。当前类型声明不执行统计计算。

此阶段 `createRpcDevtools()` 抛出 `CLOSED`；collector 行为合入后才可使用。

## 3. Hub · 已有 client 与离线录制

`createRpcDevtoolsHub(options)` 的选项为 `maxEvents`、`realignMs` 与 `onError`。`maxEvents` 是每个 target 的保留上限，默认 50,000；超出后淘汰最旧事件，并从 interaction 索引移除。周期对齐使用 `realignMs`；旧设计文字中的 `realign` 不是另一个选项。

调用方提供实现 `IRpcDevtoolsTargetClient` 的已有 client。Hub 只调用该 client 的 `request('describe')`、`request('query', input)`、`request('stats')` 与 `stream('watch', input)`，不创建 transport、Peer 或重连机制。如果现有 Peer 使用嵌套 service 路径，由调用方在 client 边界映射为这些方法名。

```ts doc-test=check
import {
  createRpcDevtoolsHub,
  type IRpcDevtoolsTargetClient
} from '@migaia/rpc-devtools/hub'

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

错误 source 为 `RPC_DEVTOOLS_SOURCE`（`@migaia/rpc/devtools`）；按 `RpcDevtoolsErrorCode` 与 source 分支，保留 cause，不匹配 message。错误表已注册 `INVALID_OPTION`、`CLOSED`、`RECORD_ACTIVE`、`RECORD_NOT_ACTIVE`、`RECORD_FORMAT_INVALID`、`REDACT_FAILED`、`TARGET_DUPLICATE` 与 `TARGET_UNKNOWN`。Collector 相关错误在本阶段仅有契约定义；hub 的运行时 client 错误按原身份报告，不被 target 状态值替换。
