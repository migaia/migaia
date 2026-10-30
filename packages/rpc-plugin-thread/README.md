# `@migaia/rpc-plugin-thread`

在 Node、Bun 或 Deno 的真实 Worker 上运行 RPC。

`rpc-contract` 定义纯协议与接口；`rpc-host` 拥有会话、目录、provider、调用结算与取消；本包是负责原生 Worker 建立、监管和释放的 transport plugin。auth、chunk、batch、probe 等 flow plugin 处理消息流；timeout、retry、pool 等 feature 安装在所属 plugin 上。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 开始使用

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-thread
```

下面是独立 ESM TypeScript 入口。Node 24 可使用原生 TypeScript 支持；也可先编译成 ESM。子线程重载同一文件，guard 防止递归派生。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

type IWorkerApi = { double(value: number): number }

if (await isThreadChild()) {
  await createRpcHost({
    plugins: [threadPlugin({ connectToParent: true })],
    provide: { double: (value: number) => value * 2 }
  })
} else {
  const plugins = [threadPlugin({ spawn: true })] as const
  const host = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
  try {
    console.log(await host.thread.request('double', 21))
  } finally {
    await host.close()
  }
}
```

一个当前直连 Worker 返回 `42`。使用独立子入口时可写 `spawn: new URL('./worker.js', import.meta.url)`，子端仍以 `connectToParent: true` 接收真实父端 bootstrap。

## 来源与命名空间

| 选项                    | 用途                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `spawn`                 | `true`、路径/URL、带 `entry` 的短配置或完整 `IThreadSpawn` 原生配方 |
| `connectToParent: true` | 仅在真实线程子端连接父端，与 `spawn` 互斥                           |
| `name`                  | 原生安装/注册名称；默认 `thread`                                    |
| `namespace`             | 调用命名空间；默认 `thread`                                         |
| `features`              | `{ localName: nativeFeature }`，接收 timeout、retry 或 pool         |
| `expose`                | 普通 PluginHost 安装时选择公开的本地 Feature 方法                   |
| `report`                | 原生诊断报告回调                                                    |

调用使用 `host.thread.request/notify/stream/group/send/dispatch`；成员控制使用 `host.thread.members`。一个 Host 可安装命名空间不同的多个 transport，业务按命名空间隔离。选择符合应用介质的 transport 即可，无需为了使用本包安装其他介质。

浏览器页面与浏览器 Worker 使用 [rpc-plugin-browser](../rpc-plugin-browser/README.md)；操作系统进程隔离使用 [rpc-plugin-process](../rpc-plugin-process/README.md)。同载体多成员调度见 [pool](../rpc-plugin-pool/README.md)。

## 调用策略与生命周期

单次调用传 `signal`，以及 timeout `{ ms }`、retry `{ attempts }` 配置或 `false`。策略优先级是单次调用、transport feature、链路策略 plugin；未选择策略时不自动加超时或重试。取消是协作信号，不会抢占同步死循环。

Thread 的原生 `spec.limits.callWallTimeMs` 是独立硬上限；显式 `timeout: false` 只关闭可选业务 timeout，不能延长该上限。它由真实 launch spec 与同一 scheduler 创建的完整 timeout 实例执行。

`notify` 等物理写出，`request` 等业务结果。原生监管负责重启与替换；连接恢复不代表业务可安全重放。原生错误、调用错误和远端错误保留自己的 source/code/cause，跨线程传递的错误图保留 name/message/stack 与聚合成员。

根入口公开 `threadPlugin`、`isThreadChild`、选项与错误身份。自定义原始载体使用 `@migaia/rpc-host/sdk`；只读观察使用 `@migaia/rpc-host/plugins/probe`。关闭流、取消调用、关闭 namespace、关闭 Host 和终止 Worker 是不同操作。资源与恢复示例见[使用指南](./USEGUIDE.md)。
