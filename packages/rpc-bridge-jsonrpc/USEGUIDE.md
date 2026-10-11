# @migaia/rpc-bridge-jsonrpc 使用指南

使用 `createJsonRpcRemoteChannel` 绑定 `@migaia/rpc-process` 提供的实际有序字节通道；普通 framing 工具来自 `@migaia/rpc-contract/framing/jsonrpc`。

```ts
import { createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
import { encodeJsonRpcFrame, createJsonRpcFrameDecoder } from '@migaia/rpc-contract/framing/jsonrpc'
```

此包仅用于外部语言 peer。握手、相关 ID、已协商 batch、invoke/cancel 与错误链沿原 JSON-RPC profile 执行；不为不支持的 stream 或 transfer 模式增加 fallback。非法 frame、UTF-8 或 JSON 仍终止连接，cancel 不新增 ACK。Core 的完整通道操作保留实际 transport、object port 与 batch 状态。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。

从包根导入 `JSONRPC_BRIDGE_ERROR_SOURCE` 和 `JsonRpcBridgeErrorCode`，用原 `@migaia/rpc/bridge/jsonrpc` source 与 code 识别 frame/profile/扩展/握手失败。`JsonRpcBridgeErrorText` 已从公开面删除，这是更名后包的破坏性导出变更。外部语言 peer 通过 `@migaia/rpc-contract/errors` 的 `toJsonRpcError`、`fromJsonRpcError` 和 `RpcJsonRpcWireError.dataKey` 保留完整 wire 错误树；JSON-RPC 整数 code 仍由 peer profile 决定。消息与 wire source/code 均不授予 Core 运行时权限。

## Advanced usage：把真实字节连接接入 Runtime Peer

外部语言服务先在自己的连接上实现 `migaia.hello`、`migaia.describe`、`migaia.invoke` 与 `migaia.cancel`，并在实际 v2 目录公开 `echo`。应用取得真实有序 `heldByteIO`，由自己的认证 issuer 提供 `issuedToken`；`remoteContract` 是该服务现有的本地声明，`localOffer` 是受支持 JSON-RPC profile 的真实本端提案。它们是协议输入，不能给其它 transport 授 owned 或 native 控制权限。

下面从已存在的完整 bridge channel 操作接入普通 Runtime Peer：

```ts
import { createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
import { createRuntimePeer } from '@migaia/rpc-core/remote'

/** 类型对应外部服务实际公开的 echo，不代替其握手目录或鉴权。 */
type IForeignApi = { echo: (payload: readonly string[]) => readonly string[] }

/** Peer 只拥有这条已取得字节连接；本端身份与实际 offer 相同。 */
const peer = await createRuntimePeer<IForeignApi>({
  self: { name: 'foreign-client', instanceId: localOffer.peer.id },
  connect: () =>
    createJsonRpcRemoteChannel({
      byte: heldByteIO,
      peerId,
      target: { kind: 'plugin', contract: remoteContract },
      offer: localOffer,
      token: issuedToken,
      scheduler,
      wallClock,
      ipc,
      report
    }),
  report
})
try {
  console.log(await peer.request('echo', ['hello']))
} finally {
  await peer.close()
}
```

`heldByteIO` 是 Process 包产生的实际 `IProcessByteChannel`，有序 write 的完成必须反映真实物理写入；不能把日志或复制 DTO 当通道。`peerId` 指向这条连接的实际对端，`scheduler`、`wallClock`、`ipc` 和 `report` 来自应用现有生命周期与报告策略。`localOffer` 只包含支持的 bridge capabilities，库在自己的握手边界加入 JSON codec 和必需扩展；不宣称原生进程控制、stream 或 transfer。

`connect` 创建并完成原认证 hello 后才向 Runtime Peer 交出该 channel。Core 继续拥有 framing、相关 ID、已协商 batch、错误链与 gated transport；业务只调用真实目录允许的 request/notify。非法 frame、UTF-8、JSON 或不支持的 mode 沿既有代码拒绝，`report` 保留原错误链，不能将失败消息解释成安全重执许可。

`peer.close()` 关闭本端通道并清理原监听/drain 资源；这个 connect source 不拥有外部进程的执行权限。若应用另外用 launcher 创建了服务，服务的 terminate/exited 仍交该 launcher owner 收尾，不因 bridge 成功或对端名称就转移控制权。
