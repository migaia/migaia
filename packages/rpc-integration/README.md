# `@migaia/rpc-integration`

[English](./README.en.md)

RPC 各个包之间的集成测试工作区。它是私有包（`private: true`），不发布到 npm，也不导出任何运行时 API。

`@migaia/rpc-contract`、`@migaia/rpc-core`、`@migaia/rpc-process`、`@migaia/rpc-threads`、`@migaia/rpc-browser` 各自的包内测试只验证自己。这里验证它们组合起来以后的行为：真实子进程、真实 Worker、跨运行时互通、线上格式向量、层次依赖方向，以及打包后的公开入口。

## 为什么单独放一个包

- **测试真实的公开入口。** 这里的测试通过 `@migaia/rpc-*` 包名导入，跑的是各包构建出的 `dist`，不是源码。一个包内单测能通过、但导出路径或构建产物有问题的改动，会在这里失败。
- **测试依赖方向只在一个地方。** 跨包场景需要同时依赖多个 RPC 包。放在任何一个 RPC 包里，都会让它多出反向依赖。
- **重型场景集中管理。** 真实子进程、大帧、外部语言对端这类测试耗时长、占资源多，单独放在这里，可以按需串行，不拖慢各包自己的测试。

## 覆盖范围

| 目录 | 验证什么 |
| --- | --- |
| `test/runtime-api` | 各运行时（Node、Bun、Deno、浏览器）通过公开 API 建立连接、调用、关闭的完整流程 |
| `test/process` | 真实子进程：健康检查、反向注册、整进程替换、故障恢复 |
| `test/threads` | 真实 Worker 线程：认证、serve 的关闭归属、子端口的懒重放 |
| `test/bridge` | JSON-RPC 桥：物理帧边界、对象端口契约、真实进程健康 |
| `test/control`、`test/error-format`、`test/streaming`、`test/serialize` | 线上协议：控制消息、错误格式、流式传输、编解码互通，对照 `schema/vectors` 中的向量 |
| `test/layering`、`test/merge` | 架构约束：错误文字归属、命名边界、层间依赖方向、根入口 tree-shaking 成本 |
| `test/core`、`test/devtools`、`test/plugins`、`test/remote`、`test/replay-window` | Core 能力与周边包的组合行为 |
| `test/typing` | 公开类型（`*.test-d.ts`） |
| `test/e2e/fixtures` | 浏览器端夹具，由 `@migaia/rpc-browser` 的 e2e 测试加载 |

`schema/vectors` 保存与语言无关的线上格式向量（JSON），其它语言的实现也可以用它们自测。

## 运行

先构建被测的 RPC 包。测试启动时会检查依赖的 `dist` 是否与源码一致，不一致就直接失败，并提示要重新构建哪些包。

```bash
pnpm --filter "@migaia/rpc-integration..." --workspace-concurrency=2 run build
pnpm --filter @migaia/rpc-integration run test
```

不要在仓库根目录直接跑全量 build。完整的脚本说明、各类测试的用法见 [USEGUIDE](./USEGUIDE.md)。

## 相关包

| 包 | 关系 |
| --- | --- |
| [`@migaia/rpc-contract`](../rpc-contract/README.md) | 契约与 Schema |
| [`@migaia/rpc-core`](../rpc-core/README.md) | 运行时内核与传输工具 |
| [`@migaia/rpc-process`](../rpc-process/README.md) | 子进程传输 |
| [`@migaia/rpc-threads`](../rpc-threads/README.md) | Worker 线程传输 |
| [`@migaia/rpc-browser`](../rpc-browser/README.md) | 浏览器传输；它的 e2e 使用这里的夹具 |
| [`@migaia/rpc-devtools`](../rpc-devtools/README.md) | 调试与观测 |
