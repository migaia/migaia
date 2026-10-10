# @migaia/rpc-threads 使用指南

从包根使用 `createThreadPeer`、`createThreadPlugin`。按平台导入 `./adapters/node`、`bun`、`deno`、`browser`、`electron-main` 或 `electron-renderer`。

```ts
import { createThreadPeer } from '@migaia/rpc-threads'
import { createNodeThreadLauncher, createNodeThreadChannelFactory } from '@migaia/rpc-threads/adapters/node'
```

spawn 持有真实执行单元；connect/listen 借用连接，不取得终止其它执行单元的权限。只有实际 launcher 的 bootstrap 可以自动选择父端来源。Core 负责 ACK、replay、clone、codec 与 drain 状态；公开 handle 的操作只作用于它持有的资源。Electron 是对应平台的可选 peer；使用线程不需要安装进程包。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。
