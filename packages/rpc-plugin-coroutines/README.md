# `@migaia/rpc-plugin-coroutines`

让 RPC 在同一事件循环中的真实协作任务之间运行。

Contract 定义纯协议与接口；Host 拥有会话、目录、provider、调用结算与取消。本包是通过真实 MessageChannel 获取并监管任务的 transport plugin。auth、chunk、batch、probe 等 flow plugin 处理消息流；timeout、retry、pool 等完整 feature 安装在所属 plugin 上。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 开始使用

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

环境需要原生 MessageChannel。任务收到精确的连接句柄，子 Host 通过它连接；任务保持运行直到其 signal 取消。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'

async function untilStopped(signal: AbortSignal): Promise<void> {
  let complete!: () => void
  const stopped = new Promise<void>((resolve) => {
    complete = resolve
  })
  signal.addEventListener('abort', complete, { once: true })
  if (signal.aborted) complete()
  try {
    await stopped
  } finally {
    signal.removeEventListener('abort', complete)
  }
}

const task: ICoroutineUserTask = async ({ connect, signal, heartbeat }) => {
  const child = await createRpcHost({
    plugins: [coroutinePlugin({ connectToParent: connect })],
    provide: { double: (value: number) => value * 2 }
  })
  heartbeat()
  try {
    await untilStopped(signal)
  } finally {
    await child.close()
  }
}

type IWorkerApi = { double(value: number): number }
const plugins = [coroutinePlugin({ spawn: task })] as const
const parent = await createRpcHost<IWorkerApi, typeof plugins>({ plugins })
try {
  console.log(await parent.coroutine.request('double', 21))
} finally {
  await parent.close()
}
```

一个当前直连任务返回 `42`。任务一旦结算，本代真实端口也会结束；不要在构造子 Host 后立即返回。

## 来源、命名空间与控制

| API / 选项                       | 用途                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| `spawn: task`                    | 创建一个受监管的协作任务                                                |
| `connectToParent: connect`       | 使用该次任务收到的准确 opaque 句柄，不是布尔值                          |
| `name` / `namespace`             | 原生注册名与调用命名空间；默认 `coroutine`                              |
| `features`                       | 完整 timeout、retry 或 pool feature                                     |
| `supervisor`                     | 原生 restart/terminalPolicy/startupTimeoutMs/stop/budget/heartbeat 策略 |
| `context.signal` / `heartbeat()` | 整代任务停止信号与原监管活性上报                                        |
| `host.coroutine.members`         | 实际成员 list/get/stop/kill/restart/replace/on/watch                    |

调用使用 `host.coroutine.*`。一个 Host 可以按不同命名空间安装多个 transport；使用本包无需同时引入其他介质。协作任务不提供进程或 Worker 的隔离，不能抢占同一事件循环上的同步死循环。

spawn 与 connectToParent 恰选一个。句柄只属于当前实际任务，不可复制、伪造或跨代复用。provider 的 context.signal 约束单次业务，与任务 signal 的寿命不同。

## 策略与组合

调用选项使用完整 `timeout({ ms })`、`retry({ attempts })` 或 `false`。优先级是单次调用、transport feature、链路策略 plugin；没有选中的策略时不自动启用。业务超时不替代原生启动或停止预算。

同载体多任务使用 `coroutinePlugin({ spawn: task, features: [pool({ size: 3 })] })`，pool 来自独立 [rpc-plugin-pool](../rpc-plugin-pool/README.md)。flow plugin 放在 Host 的 `plugins` 中；Devtools 借统一 probe 观察消息，见 [Devtools](../rpc-plugin-devtools/README.md)。

自定义部署使用 `@migaia/rpc-host/sdk`，只读观察使用 `@migaia/rpc-host/plugins/probe`。来源错误保留 TypeError、`rpc.transport.coroutine`、COROUTINE_SOURCE_INVALID；业务、握手和监督错误保留各自 source/code/cause。具体流、取消与替换示例见[使用指南](./USEGUIDE.md)。
