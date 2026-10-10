# @migaia/rpc-bridge-jsonrpc 使用指南

使用 `createJsonRpcRemoteChannel` 绑定 `@migaia/rpc-process` 提供的实际有序字节通道；普通 framing 工具来自 `@migaia/rpc-contract/framing/jsonrpc`。

```ts
import { createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
import { encodeJsonRpcFrame, createJsonRpcFrameDecoder } from '@migaia/rpc-contract/framing/jsonrpc'
```

此包仅用于外部语言 peer。握手、相关 ID、已协商 batch、invoke/cancel 与错误链沿原 JSON-RPC profile 执行；不为不支持的 stream 或 transfer 模式增加 fallback。非法 frame、UTF-8 或 JSON 仍终止连接，cancel 不新增 ACK。Core 的完整通道操作保留实际 transport、object port 与 batch 状态。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。
