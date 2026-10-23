# 协作任务 RPC 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md) · [统一调用规则](../rpc-host/USEGUIDE.md)

`coroutinePlugin` 把同一事件循环中的真实协作任务接入 `createRpcHost`。原生 MessageChannel 承载调用，原监督器管理代次、预算、停止和替换。它不提供进程或 Worker 隔离，也不能抢占同步死循环。

## 父任务与子 host

运行环境须有原生 MessageChannel。父端提供任务函数，子端使用该次任务上下文中的准确 connect 句柄。完整关闭顺序如下：

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const parent = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      connect: { timeoutMs: 1500 },
      spawn: async ({ connect, signal, heartbeat }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
        })
        heartbeat()
        try {
          if (!signal.aborted)
            await new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            })
        } finally {
          await child.close()
        }
      }
    })
  ]
})
try {
  console.log(await parent.request('double', 21))
} finally {
  await parent.close()
}
```

预期输出 `42`。任务不能在构造 child 后立即返回：任务结算会结束本代原生连接。父 host 的 close 进入原 drain/监督停止路径；任务看到 signal 后关闭自己的 child 并退出。

## 精确连接句柄

`spawn` 与 `connectToParent` 互斥。这里的 `connectToParent` 是 `ICoroutineConnect` opaque 句柄，**不是 true**。不要把 process/thread 的子端布尔写法套在此处，也不要复制、伪造或跨代复用句柄。该句柄关联原任务的真实端口与报告器；它不是可序列化配置。

任务拿到三个上下文字段：signal、heartbeat、connect。signal 约束整代任务寿命；heartbeat 向原监督策略报告活性；connect 只供本次子 host 连接。heartbeat 不等于业务完成，也不会替任务自动运行循环。

可以明确声明任务类型，保持业务与传输配置分开：

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'

export const task: ICoroutineUserTask = async ({ connect, signal }) => {
  const child = await createRpcHost({
    plugins: [coroutinePlugin({ connectToParent: connect })],
    provide: { echo: (value: string) => value }
  })
  try {
    if (!signal.aborted)
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
  } finally {
    await child.close()
  }
}
```

应用将 task 交给 `coroutinePlugin({ spawn: task })`，并最终关闭返回的父 host。

## 取消、流与错误

任务 signal 与 provider 调用的 context.signal 是两个层次。前者终止任务寿命；后者取消该业务调用。长时间异步业务应协作观察调用信号；同步 CPU 循环会阻塞同一事件循环，包括调用期限和监督器的回调。

流沿统一 host API 返回 AsyncIterable。消费者提前退出时显式 return，释放本次原 stream 资源；不会因此停止整代任务。下面消费当前直连 worker 的显式流方法：

```ts doc-test=check
import type { IRpcHost } from '@migaia/rpc-host'

export async function firstValue(
  host: IRpcHost<{ worker: { values(end: number): AsyncIterable<number> } }>
) {
  const stream = host.peers.worker.values(10)
  try {
    return await stream.next()
  } finally {
    await stream.return?.()
  }
}
```

单个直连对端的 request 返回标量；多对端规则见 host 指南。任务和父 host 都可 provide，双向业务共用同一真实会话。

来源错误保留原生 TypeError，source 为 rpc.transport.coroutine、code 为 COROUTINE_SOURCE_INVALID。业务、握手或监督失败保持各自 source/code/cause，不统一改成来源错误。跨消息边界保留原生错误名称、消息、stack 与完整原因链。

## 监督与替换

`supervisor` 只配置原策略的 restart、terminalPolicy、startupTimeoutMs、stop、budget、heartbeat 字段。`connect.timeoutMs` 则约束该代 identity/能力握手；它不是任务停止预算或业务调用 timeoutMs。

```ts doc-test=check
import { coroutinePlugin, type ICoroutineUserTask } from '@migaia/rpc-plugin-coroutines'
import { retryFeature, timeoutFeature } from '@migaia/rpc-host/features'

export function taskPlugins(task: ICoroutineUserTask) {
  return [
    coroutinePlugin({ spawn: task, supervisor: { startupTimeoutMs: 1500 } }),
    retryFeature(),
    timeoutFeature({ ms: 1000 })
  ]
}
```

retry 使用原调用策略，不意味着所有非幂等业务都能安全重放。原监督器选择新代；旧代持有的能力不会自动指向新代。任务忽略取消时，原停止、reap 与晚到结算规则仍有效，不能把返回的控制结果当作强制终止同线程代码。

同一传输定义也可安装普通 PluginHost。原 coroutine outlet 保留 stop/restart/replace；replace 的输入是 `{ task: nextTask }`，类型为 ICoroutineReplaceSpec。让原替换事务管理新旧代，不在业务层另写“关旧任务再启动”的流程。

## 与 pool 和 devtools 组合

安装 `poolPlugin({ size })` 后，每个隐藏成员是独立真实任务。对外只有逻辑目标 pool，每次操作只选一个成员，不向所有任务广播；详见 [pool 指南](../rpc-plugin-pool/USEGUIDE.md)。

安装 `devtoolsPlugin()` 可观察同一原消息/载体路径；host.close 撤回本 host 的观察，但应用仍拥有 collector 的最终 close。协程任务不会自动隔离共享内存，应用仍须控制闭包共享数据和并发副作用。

公开类型包括 ICoroutinePluginOptions、ICoroutineConnect、ICoroutineUserTask、ICoroutineTaskContext、ICoroutineReplaceSpec、ICoroutineSupervisorPolicy。应用通过这些类型描述任务与策略，无需读取端口、注册表或内部构造器。
