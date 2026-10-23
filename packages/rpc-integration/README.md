# `@migaia/rpc-integration`

[English](./README.en.md)

八个 RPC owner 的私有集成测试工作区：`rpc-contract`、`rpc-host`、`rpc-plugin-process`、`rpc-plugin-thread`、`rpc-plugin-browser`、`rpc-plugin-coroutines`、`rpc-plugin-pool`、`rpc-plugin-devtools`。本包不发布，也不导出运行时 API。

业务构造使用一个 `createRpcHost`、一个传输 plugin 与可选 features。本工作区验证组合后的公开行为、真实进程与 Worker、外语协议互通、依赖方向及 packed 消费者。底层协议基线可读取精确的内核构建产物 owner；不复制实现，也不恢复已删除的公开工厂。

## 覆盖范围

| 目录                                                                              | 责任                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `test/host`                                                                       | 新 Host/plugin 公开示例、普通 Host 安装、直连定向、转发、pool 标量调用、collector 关联与最终导出 |
| `test/runtime-api`、`test/process`、`test/threads`                                | 原生会话、代次、取消、替换、所有权与跨运行时行为保留                                             |
| `test/bridge`                                                                     | JSON-RPC 分帧、对象端口与真实进程互通                                                            |
| `test/control`、`test/error-format`、`test/streaming`、`test/serialize`           | 语言无关的协议与 codec 向量，包括 `schema/vectors`                                               |
| `test/layering`、`test/merge`                                                     | 包归属、错误词表、依赖方向与公开边界收口                                                         |
| `test/core`、`test/devtools`、`test/plugins`、`test/remote`、`test/replay-window` | 原有内核与 feature 的组合行为                                                                    |
| `test/typing`                                                                     | 公开静态契约                                                                                     |
| `test/e2e/fixtures`                                                               | 同时供 `rpc-plugin-browser` e2e 使用的浏览器夹具                                                 |

包内验收仍属于各 owner。协程生命周期与普通 plugin 基线已移到 `rpc-plugin-coroutines/test/coroutine`，这里不保留副本；浏览器载体验收属于 `rpc-plugin-browser`。

## 运行

测试读取最新构建依赖，发现 stale `dist` 会立即拒绝。实际脚本为：

| 脚本                          | 用途                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `test`                        | 默认集成套件                                         |
| `test:conformance`            | 原生与外语互通套件                                   |
| `test:suite-parity`           | 既有跨套件对照用例                                   |
| `test:packed`                 | 有界构建八个 RPC owner，然后运行 packed export smoke |
| `test:coverage:family`        | 纳入迁出与新增 owner 的家族覆盖率                    |
| `typecheck`、`typecheck:test` | 本包测试 TypeScript project                          |

只构建选定依赖图，限制并发；重型命令进入共享窗口。在仓库根执行：

```bash
node "$(git rev-parse --path-format=absolute --git-common-dir)/../scripts/exclusive-window.mjs" run --window rpc-build --wait 2700 -- pnpm -r --filter "@migaia/rpc-integration..." --workspace-concurrency=2 run build
node "$(git rev-parse --path-format=absolute --git-common-dir)/../scripts/exclusive-window.mjs" run --window rpc-integration --wait 2700 -- pnpm --dir packages/rpc-integration run test
```

integration 没有自己的运行时 build 入口；递归 filter 构建匹配依赖中具有 build 脚本的包。不要执行无界全仓 build。bench 脚本与交付门禁分开，夹具准备和脚本细节见 [USEGUIDE](./USEGUIDE.md)。

## 相关 owner

| 包                                                            | 责任                                                |
| ------------------------------------------------------------- | --------------------------------------------------- |
| [`rpc-contract`](../rpc-contract/README.md)                   | 纯契约、schema、分帧与错误                          |
| [`rpc-host`](../rpc-host/README.md)                           | 唯一 `createRpcHost` 入口、作者 SDK 与公用 features |
| [`rpc-plugin-process`](../rpc-plugin-process/README.md)       | 子进程与 socket 传输                                |
| [`rpc-plugin-thread`](../rpc-plugin-thread/README.md)         | Node/Bun/Deno 原生线程传输                          |
| [`rpc-plugin-browser`](../rpc-plugin-browser/README.md)       | 浏览器载体 plugins                                  |
| [`rpc-plugin-coroutines`](../rpc-plugin-coroutines/README.md) | 受监督 task 与 opaque 父连接                        |
| [`rpc-plugin-pool`](../rpc-plugin-pool/README.md)             | 一个逻辑 pool 目标与原成员调度                      |
| [`rpc-plugin-devtools`](../rpc-plugin-devtools/README.md)     | feature 安装与 collector 记录                       |
