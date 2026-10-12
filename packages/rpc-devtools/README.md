# `@migaia/rpc-devtools`

RPC 元数据采集、统计、录制与远程查询工具。Collector 可直接作为 Probe 接入已有宿主；也可用手填 view 驱动本地采集。Core 观察点与 hub 由对应实现提供。

| 入口                            | 当前能力                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `@migaia/rpc-devtools`          | `createRpcDevtools`：有界采集、查询、统计、录制、暂停与 service                      |
| `@migaia/rpc-devtools/contract` | service/wire/record 类型、`RpcDevtoolsRecordFormat`、录制 codec、错误码与错误 source |
| `@migaia/rpc-devtools/hub`      | `createRpcDevtoolsHub` 的类型占位、`RpcDevtoolsTargetStatus` 与 hub 类型             |
| `@migaia/rpc-devtools/log`      | `createRpcLogProbe`：提取当前事件字段并交给调用方的 logger                           |

`createRpcDevtools()` 返回 collector 自己的 Probe 对象，不创建 Peer、transport 或持久化资源。包为 workspace-private，peer 依赖 `@migaia/rpc-core` 与 `@migaia/rpc-contract`，版本保持一致。Hub 入口仍是同步抛出 `CLOSED` 的占位工厂。

## Collector

```ts doc-test=run
import { createRpcDevtools } from '@migaia/rpc-devtools'

/** 默认只采集元数据；调用方拥有 collector 生命周期。 */
const devtools = createRpcDevtools({ stages: ['message'], maxEvents: 1_000 })
/** 独立录制环不受主查询环的淘汰影响。 */
const recording = devtools.record({ maxEvents: 100 })
devtools.pause()
console.log(devtools.describe().paused) // true
devtools.resume()
console.log(devtools.query().events.length, devtools.stats().methods.length) // 0 0
console.log(devtools.importRecord(devtools.exportRecord(recording.stop())).header.version) // 1
devtools.close()
```

默认保留最近 10,000 个事件，内容预算 8 MiB，字符串驻留上限 65,536。`stats()` 按 endpoint/method 聚合；查询环淘汰不清除统计，`clear()` 同时清空事件与统计。`watch()` 每批最多 256 个事件，每个消费者最多排队 64 批；过慢时丢弃最旧批次，并在下一批报告 `dropped`。

把 `devtools.service` 挂到已有 Peer 的 `provide: { devtools: devtools.service }`；远端使用 `devtools.describe/query/watch/stats/record.start/record.stop/clear/pause/resume`。为 service 使用独立 Peer。Service 默认隐藏 content；只有 `exposeContent: true` 才允许内容跨 service 边界。

自动排除自身 service 流量尚未完成（R4/D5）：公开 provider context 没有 serving endpoint identity。不要把同一个 collector 也作为 probe 安装到 serving Peer；独立 service Peer 是调用方当前必须遵守的限制，不能代替自动过滤验收。

`resume()` 当前恢复构造时的 stages。如果后来通过 `setStages()` 修改订阅，pause/resume 不保留这次修改；恢复暂停前最新订阅（D4）仍缺少可读取当前有效订阅的公开契约。恢复后由调用方重新应用需要的 stages。

顶层元数据在 `emit(view)` 返回前写入列，不保留复用 view。`detail`、error 与未转移的 captured content 保留引用；发送后修改这些对象可能影响后续读取。用 `capture` 显式选阶段，再用 `redact` 清理敏感内容。

内容预算计入字符串的 UTF-8 长度、ArrayBuffer/View 的 byteLength，或 opaque object 的 `view.sizeBytes`。Opaque object 在 sizeBytes 为 -1 时计为 0；collector 不在采集时编码对象来估算大小，因此该预算不保证限制任意对象图的真实堆占用。

## 日志接入

`createRpcLogProbe(logger, options)` 接受具有 `debug/info/warn/error(message, fields)` 的结构化 logger，不依赖 `@migaia/logger`。默认记录 failed 为 error、rejected/timeout/abort 为 warn、peer 生命周期为 info；设置 `slowMs` 后，达到阈值的 settled 调用也记 warn。默认不记录正常 settled 调用或内容。

不要把复用的 `view` 直接传给异步 logger：后续事件会覆写它。Log probe 同步提取字段，并只为满足日志条件的事件创建独立字段对象；error 与显式 content 仍按引用保留。Logger 调用必须不阻塞，只负责入队；同步文件 logger 会把 I/O 放到 RPC 路径。缓冲、批量、写文件、锁、轮转与 flush 由 logger 拥有。推荐 `@migaia/logger` 的 `level`、`batch` 加 `file`，完整可执行示例见 [USEGUIDE](./USEGUIDE.md)。

## 离线录制格式

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

统计使用 24 个固定 log2 延迟桶，公开边界为 `0.0625 ms × 2^k`，`k = 0…23`。分位数在桶内插值；末桶接收超出最后边界的延迟，其插值上限扩展到已观察到的最大延迟。末桶的误差不能按固定边界宽度承诺。

完整契约与后续入口说明见 [USEGUIDE](./USEGUIDE.md)。
