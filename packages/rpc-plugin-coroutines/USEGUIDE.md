# Coroutine 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md)

Contract 定义纯协议和接口，Host 拥有会话与调用生命周期，Coroutine transport 拥有真实任务/MessageChannel 与原监管接线。flow plugin 处理 auth、chunk、batch、probe；完整 feature 提供 timeout、retry、pool。一个 Host 可以用不同 namespace 安装多个 transport，本指南只使用 `coroutine`。

## 任务与连接句柄

父子完整示例见 README。应用可将任务声明为 `ICoroutineUserTask`，从当代上下文取得 signal、heartbeat 和 connect：signal 约束任务寿命；heartbeat 报告活性；connect 只交给该次子 Host 的 `connectToParent`。保持任务运行，退出时关闭其子 Host。

`connectToParent` 是 `ICoroutineConnect`，不是 `true`。它关联原任务的真实端口与来源事实，不是可序列化配置。spawn 与 connectToParent 互斥；只有 spawn 配置原生 supervisor。任务共享事件循环和内存，不提供 CPU、权限或进程隔离。

## 调用、策略、流和替换

下面保留实际 plugin tuple 的类型。传入的任务需提供 echo 和 values 方法，target 使用当前业务目录中的名称或实例 ID。使用 pooled helper 时另安装 `@migaia/rpc-plugin-pool`。

```ts doc-test=check
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'
import { pool } from '@migaia/rpc-plugin-pool'

type IWorkerApi = { echo(value: string): string; values(end: number): AsyncIterable<number> }

function taskPlugins(task: ICoroutineUserTask) {
  return [
    coroutinePlugin({
      spawn: task,
      features: [timeoutFeature({ ms: 1000 }), retryFeature({ attempts: 2 })],
      supervisor: { startupTimeoutMs: 1500 }
    })
  ] as const
}

type ITaskHost = IRpcHost<IWorkerApi, ReturnType<typeof taskPlugins>>

export function open(task: ICoroutineUserTask) {
  const plugins = taskPlugins(task)
  return createRpcHost<IWorkerApi, typeof plugins>({ plugins })
}

export function call(host: ITaskHost, target: string, signal: AbortSignal) {
  return host.coroutine.send(target, 'echo', 'hello', {
    signal,
    timeout: timeoutFeature({ ms: 500 }),
    retry: false
  })
}

export async function firstValue(host: ITaskHost, target: string) {
  const stream = host.coroutine.peers[target].values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}

export function replace(host: ITaskHost, target: string, task: ICoroutineUserTask) {
  return host.coroutine.members.replace(target, { task })
}

export function pooled(task: ICoroutineUserTask) {
  return coroutinePlugin({ spawn: task, features: [pool({ size: 3 })] })
}
```

`host.coroutine.request/notify/stream/group/send/dispatch` 使用统一 namespace 调用语义。notify 只等实际写出；request/send 等业务结果。`notify` 用 `{ targetId }` 指定目标。无目标调用按当前直连集合处理，多个普通直连保持独立结果。

策略顺序为单次 options、transport feature、链路策略 plugin。单次 timeout/retry 只能给完整实例或 false；示例选择 500 ms 超时并关闭本次 retry。没有策略不会隐式新增一个超时或重试循环。supervisor.startupTimeoutMs 属于原生任务启动，与业务 timeout 是不同预算。

流能力从 `host.coroutine.peers[target]` 取得并绑定当前代。消费完或提前退出时 return；这只结束该流，不停止整代任务。重启后重新读取当前目录，旧方法不会自动指向新任务。

调用 signal 与任务 signal 分别由调用 owner 和原监管 owner 处理。处理方应协作读取自己的 context.signal；远端收到序列化后的原因，跨边界按实际 source/code/cause 处理。同步死循环会同时阻塞业务期限和监管回调。

## 原生控制与 pool

`host.coroutine.members` 提供 list/get/stop/kill/restart/replace/on/watch。目标取实际注册名或当前实例 ID；replace 的 spec 为 `{ task: nextTask }`，由原替换事务处理新旧代。协作停止不是抢占执行，控制返回不应解释为能中断任意同步代码。

`pool(...)` 安装在 transport.features，每个成员是独立真实任务。对外只有逻辑目标 pool，每次操作只选择一个成员。成员管理使用同一 namespace.members；不要把隐藏成员 ID 当成直接业务目标。详见 [Pool 指南](../rpc-plugin-pool/USEGUIDE.md)。

## 观察、错误与关闭

Devtools 是 flow plugin，放在 Host plugins；其 collector 由应用持有。自定义部署使用 `@migaia/rpc-host/sdk`，probe 使用 `@migaia/rpc-host/plugins/probe`，不读取内部端口或构造第二套握手。

来源错误是带 rpc.transport.coroutine/COROUTINE_SOURCE_INVALID 的 TypeError；调用、握手、监督及清理失败保持原 owner 的错误图。取消业务、结束流、关闭 Host 与终止任务是不同责任。应用结束持有的流与业务后关闭 Host，并让任务响应其原生停止信号。
