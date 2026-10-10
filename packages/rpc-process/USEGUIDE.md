# @migaia/rpc-process 使用指南

从包根使用 `createProcessPeer`、`createProcessPlugin`。按平台导入 Node、Bun、Deno、Electron utility process 或 Windows job 的普通 adapter 子路径。

```ts
import { createProcessPeer } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
```

spawn 拥有执行单元；connect/listen 只持有自己的连接。Peer 的 request、notify、stream、group、outcome、取消、重试与 close 沿原实际资源生命周期执行。Core 持有 launch/bootstrap、provider 字节准入、listener 与 drain 机制；Native 包持有平台发现、stdio、socket 与 OS 资源。Electron、Koffi 仅是对应可选平台的 peer；使用进程不需要安装线程包。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。
