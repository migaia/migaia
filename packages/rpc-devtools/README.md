# `@migaia/rpc-devtools`

RPC 观察工具的契约与录制格式。当前版本为 layer 1：提供 service/record 类型、纯函数 NDJSON codec 和包入口。Collector、hub 与 Core 观察点由后续实现提供。

| 入口 | 当前能力 |
| --- | --- |
| `@migaia/rpc-devtools` | `createRpcDevtools` 的类型占位、错误码与错误 source |
| `@migaia/rpc-devtools/contract` | service/wire/record 类型、`RpcDevtoolsRecordFormat`、录制 codec、错误码与错误 source |
| `@migaia/rpc-devtools/hub` | `createRpcDevtoolsHub` 的类型占位、`RpcDevtoolsTargetStatus` 与 hub 类型 |

`createRpcDevtools()` 与 `createRpcDevtoolsHub()` 当前都会同步抛出 `CLOSED`。这表示对应运行时尚未安装；此阶段不能采集事件、提供远程 service 或连接 hub target。包为 workspace-private，peer 依赖 `@migaia/rpc-core` 与 `@migaia/rpc-contract`，版本保持一致。

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

统计契约使用 24 个固定 log2 延迟桶，边界为 `0.0625 ms × 2^k`，`k = 0…23`。分位数在桶内插值，误差上界为该桶宽度。统计计算本身尚未实现。

完整契约与后续入口说明见 [USEGUIDE](./USEGUIDE.md)。
