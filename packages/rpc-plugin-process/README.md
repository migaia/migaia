# @migaia/rpc-plugin-process

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

在子进程里运行需要隔离的任务，并像调用本地函数一样调用它；也可以连接本机已有的服务进程或监听本机连接。这是 [`@migaia/rpc-host`](../rpc-host/README.md) 的传输插件：host 负责调用、超时、取消和错误还原，本包负责启动子进程、监管它、在崩溃后按策略重启，并在关闭时回收。

## 你可能遇到过

- **一个任务的内存泄漏或崩溃拖垮了主进程**：第三方解析库在主进程里出问题，整个服务一起重启。根因是不可信或不稳定的代码没有进程级隔离。
- **子进程崩溃后反复重启，或者成了孤儿进程**：没有退避的重启把机器打满，父进程退出后子进程还在跑。根因是没有统一的监管和回收。

## 从这里开始

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-process
```

下面是可保存为独立 ESM 入口的自派生示例。Node 24 可直接执行 TypeScript；其他运行环境按自身工具链编译。父端调用位于 `host.process`，子端必须先识别角色，避免再次派生自己。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin, isProcessChild } from '@migaia/rpc-plugin-process'

if (await isProcessChild()) {
  await createRpcHost({
    plugins: [processPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const host = await createRpcHost({
    plugins: [processPlugin({ spawn: true, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.process.request('double', 21))
  } finally {
    await host.close()
  }
}
```

子端提供 `double`；兼容对端完成握手后，父端调用取得 `42`。stdio 模式的 stdout 属于协议，子端应用日志写 stderr。此处展示调用形态，不是外部服务的认证配置。

## 来源与归属

`processPlugin(options)` 必须恰好选择一个来源。默认 namespace 是 `process`，可通过 `namespace` 改名。

| 来源       | 配置                                             | 归属                              |
| ---------- | ------------------------------------------------ | --------------------------------- |
| 子进程     | `spawn: true`、入口路径/URL 或完整原生 recipe    | 拥有所启动的子进程                |
| 已有服务   | `connect: { target: nameOrAddress, timeoutMs? }` | 只拥有本端连接，不终止外部服务    |
| 监听器     | `listen: nameOrListener`                         | 拥有监听器和接纳的本端会话        |
| 子端接父端 | `connectToParent: true`                          | 使用真实原生 bootstrap 和父端 I/O |

握手协商与名字准入是两个独立阶段，默认各为 10,000 ms。timeout-only 的 `connect: { timeoutMs }` 也可设置其他来源的名字准入期限；等待中的对端按 `pending` 通知里的剩余时间等待，重复通知不会刷新期限。最坏等待接近两阶段之和。短配置支持 `entry`、`command/args`、`cwd`、显式环境、`wrap`、原生限制与 `supervision`。限制的实际效果取决于运行环境，配置不会创造原生隔离能力。

推荐每个 Host 只安装一种传输；同一传输可有多个会话。若确需混装不同传输，使用互不冲突的 namespace 并明确路由和权限，不把它们当成同质成员池。

## 当前 API

根入口运行时导出 `processPlugin`、`isProcessChild`、`RpcProcessErrorCode` 与 `RPC_PROCESS_ERROR_SOURCE`；同时导出选项和原生来源类型。`name` 是本地注册名，`namespace` 决定调用入口，`expose` 是普通 PluginHost 的显式本地 Feature 白名单。

调用使用 `host.process.request/notify/stream/group` 和定向的 `host.process.send`。根对象保留 `self`、`provide`、`close`，不提供这些调用方法。原生成员查询、控制与事件位于 `host.process.members`，例如 `list/get/stop/kill/restart/replace/on/watch`；借用连接不因此取得终止外部进程的权限。

`/features` 导出原生 feature token 工厂 `sendQueueFeature`、`flowControlFeature`、`ipcLogFeature`；以调用者命名的 record 传入 `processPlugin({ features })`。`sendQueueFeature({ flow })` 可借用同一个 flow 实例，不能另配一套容量。业务 timeout/retry 也通过传输的 `features` 选择。host 级 Feature 工厂在 `@migaia/rpc-host/features/*`，经 `defineFlowPlugin({ name, features })` 在传输之前安装；观察插件在 `@migaia/rpc-host/plugins/*`。

## 协议与扩展职责

使用唯一的 `migaia.rpc/2` 协议。`@migaia/rpc-contract/protocol` 提供纯协议数据与准入；`/interfaces` 提供能力类型，`/errors` 与 `/error-code` 提供错误契约。Contract 不执行 I/O、业务 schema 或监督。业务校验由 `/features/schema` 负责；自定义载体作者使用 `@migaia/rpc-host/sdk`，复用 canonical carrier，而不是返回另一个 Host 或端点。

## 当前边界

原生 token/bootstrap 存在不等于已完成自动 verifier、principal 或跨重连认证 scope；这些边界尚有未闭合项。不要据此推断身份可信或业务可安全重放。Host 关闭与已接纳业务 drain 的顺序、重启 downtime 的无目标错误、同名准入错误呈现仍有保留的行为差异。IPC 容量拒绝保留 `OVERLOADED`；实际物理 I/O 失败仍按 `TRANSPORT` 保留原 cause，准入失败不表示已经写出。

启动通道在实际关闭阶段可直接报告 `PROCESS_CHANNEL_CLOSED`；真实 `EPIPE` 等原生错误仍在错误图可达，不要求重复嵌套两个同码包装。业务 `timeout: false` 关闭选中的业务期限，不自动添加 Process 调用硬上限。

按 `source/code/cause` 处理错误并保留原生原因。详细配置见[使用指南](./USEGUIDE.md)。
