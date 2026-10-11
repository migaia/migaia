# @migaia/rpc-browser 使用指南

按实际载体导入 `./adapters/window`、`shared-worker`、`service-worker`、`broadcast-channel`、`web-transport` 或 `rtc-data-channel`。模块没有根 barrel。

```ts
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'
```

各适配器使用实际持有的窗口、端口或连接资源。自定义 Endpoint 从 `@migaia/rpc-core` 构造。Dedicated Worker 适配器从 `@migaia/rpc-core/adapters/web-worker` 导入。释放规则与载体校验保持原操作语义。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。
