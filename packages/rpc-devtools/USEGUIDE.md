# `@migaia/rpc-devtools` 使用手册

当前只交付契约、codec 与占位工厂。下列 collector/hub 类型用于后续实现；不能据此认为对应行为已可运行。

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

## 3. Hub 契约

`createRpcDevtoolsHub(options)` 的选项为 `maxEvents`、`realignMs` 与 `onError`。Hub 类型接收由调用方提供、具有 `request` 与 `stream` 的 target client；它不创建 transport。

`IRpcDevtoolsHub` 声明 target 管理、离线 record 导入、timeline、interactions、stats、事件订阅与关闭。`RpcDevtoolsTargetStatus` 提供 `connecting`、`connected`、`disconnected`、`offline`、`removed`，这些是状态而非错误码。当前 `createRpcDevtoolsHub()` 抛出 `CLOSED`；hub 行为合入后才可使用。

## 4. 错误身份

错误 source 为 `RPC_DEVTOOLS_SOURCE`（`@migaia/rpc/devtools`）；按 `RpcDevtoolsErrorCode` 与 source 分支，保留 cause，不匹配 message。错误表已注册 `INVALID_OPTION`、`CLOSED`、`RECORD_ACTIVE`、`RECORD_NOT_ACTIVE`、`RECORD_FORMAT_INVALID`、`REDACT_FAILED`、`TARGET_DUPLICATE` 与 `TARGET_UNKNOWN`。Collector/hub 相关错误在本阶段仅有契约定义。
