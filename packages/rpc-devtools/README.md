# `@migaia/rpc-devtools`

RPC 观察工具的契约、录制格式与跨宿主 hub。提供 service/record 类型、纯函数 NDJSON codec 和 hub target 聚合；Collector 与 Core 观察点由后续实现提供。

| 入口 | 当前能力 |
| --- | --- |
| `@migaia/rpc-devtools` | `createRpcDevtools` 的类型占位、错误码与错误 source |
| `@migaia/rpc-devtools/contract` | service/wire/record 类型、`RpcDevtoolsRecordFormat`、录制 codec、错误码与错误 source |
| `@migaia/rpc-devtools/hub` | `createRpcDevtoolsHub`、target 管理、时钟对齐、timeline、interactions、stats 与离线导入 |

`createRpcDevtools()` 当前同步抛出 `CLOSED`，collector 行为由后续实现提供。Hub 可接收已有的 target client 或导入离线录制。包为 workspace-private，peer 依赖 `@migaia/rpc-core` 与 `@migaia/rpc-contract`，版本保持一致。

```ts doc-test=check
import {
  RpcDevtoolsRecordFormat,
  encodeRpcDevtoolsRecord,
  decodeRpcDevtoolsRecord,
  type IRpcDevtoolsRecord
} from '@migaia/rpc-devtools/contract'

/** Header 的格式名与版本由 contract 常量统一维护。 */
const record: IRpcDevtoolsRecord = {
  header: RpcDevtoolsRecordFormat,
  events: []
}
/** Codec 不创建 transport、Peer 或持久化资源。 */
const text = encodeRpcDevtoolsRecord(record)
console.log(decodeRpcDevtoolsRecord(text).header.version) // 1
```

录制格式为 UTF-8 NDJSON：第一行为 `{ format: 'migaia-rpc-devtools', version: 1 }`，后续每行一个事件。Bytes 用 base64 标记保存；错误沿用 RPC 错误 codec 保留 source、code、name、message、stack 与 cause 链。Service wire event 使用已序列化错误；record 输入同时接受原生 Error 与已序列化 wire error，解码输出还原为原生 Error。

统计契约使用 24 个固定 log2 延迟桶，边界为 `0.0625 ms × 2^k`，`k = 0…23`。分位数在桶内插值，误差上界为该桶宽度。Collector 的统计采集由后续实现提供；hub 可合并已有 target 返回的统计。

## Hub · 实时聚合与离线查询

Hub 不创建 transport 或 Peer。调用方把已有的 `request`/`stream` client 交给 `await hub.addTarget(name, client)`；client 的方法名须与 `IRpcDevtoolsServiceApi` 一致。Hub 先以五次 `describe` 中 RTT 最小的样本对齐时钟，再用 `query` 追上现有事件，最后消费 `watch`。`realignMs` 可启用周期对齐。

```ts doc-test=check
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import {
  RpcDevtoolsRecordFormat,
  encodeRpcDevtoolsRecord
} from '@migaia/rpc-devtools/contract'

/** 离线录制复用 contract codec，不依赖实时 collector。 */
const text = encodeRpcDevtoolsRecord({
  header: RpcDevtoolsRecordFormat,
  events: [{
    seq: 1,
    at: 100,
    endpointId: 'parent',
    stage: 'message',
    direction: 'outbound',
    senderId: 'parent',
    messageId: 'm1',
    method: 'read',
    trace: 'T1'
  }]
})
/** 每个 target 最多保留 50,000 个事件；关闭由调用方负责。 */
const hub = createRpcDevtoolsHub({ maxEvents: 50_000 })
try {
  hub.importRecord('recording', text)
  console.log(hub.status('recording')) // offline
  console.log(hub.timeline({ trace: 'T1' })[0]?.alignedAt) // 100
  console.log(hub.interactions('T1')[0]?.oneSided) // true
} finally {
  await hub.close()
}
```

`timeline()` 以 k-way merge 合并 target 序列，按对齐时间排序，同时间按 target 名及 `seq` 决定顺序。`interactions(trace?)` 仅按显式 `trace` 与 `(senderId, messageId)` 关联；只有一侧的观察标记为 `oneSided`，不会补造缺失事件。`stats(name?)` 转发实时 target 的统计，省略名称时逐桶汇总各 target 的直方图。

返回数组中的事件是已存储引用。未转移的 content、`detail` 与 error 保留引用；发送后修改原对象可能改变后续读取。详见 [USEGUIDE](./USEGUIDE.md) 的生命周期、时钟误差与引用语义。
