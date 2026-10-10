# @migaia/rpc-bridge-jsonrpc

外部语言 JSON-RPC。使用 `createJsonRpcRemoteChannel` 绑定 `@migaia/rpc-process` 提供的实际有序字节通道；普通 framing 工具来自 `@migaia/rpc-contract/framing/jsonrpc`。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

完整使用边界见 [USEGUIDE](./USEGUIDE.md)。
