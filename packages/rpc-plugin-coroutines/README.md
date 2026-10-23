# `@migaia/rpc-plugin-coroutines`

让 `createRpcHost` 在同一事件循环运行受监督的协作任务，通过真实 MessageChannel 交换业务调用。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- 业务使用同一套双向请求、通知、流、期限和错误语义。
- 每代任务获得独立连接句柄；原监督器负责预算、代次、停止、重启和替换。
- 任务直接使用原 `signal` 与 `heartbeat()`，不另建任务调度或重试循环。
- 不启动操作系统进程或 Worker；需要故障隔离时改用[进程](../rpc-plugin-process/README.md)或[线程](../rpc-plugin-thread/README.md)传输。

## 从这里开始

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

宿主需提供原生 MessageChannel。下面在 Node、Bun、Deno 或支持该能力的浏览器中运行同一任务模式：

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const parent = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
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

输出 `42`。保持任务运行直到 signal 取消；任务函数一旦结算，其本代原生端口会关闭。

## 来源与生命周期

| 配置 / 能力                                             | 含义                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `coroutinePlugin({ spawn: task })`                      | 创建本 host 拥有的真实协作任务                                                 |
| `coroutinePlugin({ connectToParent: context.connect })` | 子端使用当前任务获得的精确 opaque 句柄                                         |
| `context.signal`                                        | 原监督停止信号；任务必须协作退出                                               |
| `context.heartbeat()`                                   | 向原监督器报告活性，只有配置了相应策略时参与检查                               |
| `supervisor`                                            | 可选原 restart、terminalPolicy、startupTimeoutMs、stop、budget、heartbeat 策略 |
| `connect: { timeoutMs }`                                | 本代 identity 与能力握手共用预算                                               |

spawn 与 connectToParent 互斥。这里的 `connectToParent` **不是 true**；不得保存到下一代、复制对象或自行伪造。子端不重新解释父端身份，双方沿原消息握手确认各自目录。

任务与调用取消不同：`context.signal` 约束任务寿命，provider 的调用 context.signal 只约束相应调用。协作任务不能强制抢占同步死循环，也不提供独立 CPU、内存或权限隔离。close 沿原 drain/监督清理；忽略 signal 的任务仍受原停止与晚到结算规则约束。

## 与 host 和 pool 组合

父子两端均可在 `createRpcHost` 上设置 `provide`、`self` 与公用 feature；单连接 request 返回标量，广播遵循 [host](../rpc-host/README.md) 规则。安装 [poolPlugin](../rpc-plugin-pool/README.md) 后，每个私有成员是独立真实任务，对外仅有逻辑目标 pool。

普通 `PluginHost` 可直接安装传输定义。原 coroutine outlet 保留 stop/restart/replace 等控制；替换使用 `{ task: nextTask }`，由原替换事务管理，而非业务代码自行关闭旧代再派发新代。

## 类型与错误

公开类型为 `ICoroutinePluginOptions`、`ICoroutineConnect`、`ICoroutineUserTask`、`ICoroutineTaskContext`、`ICoroutineReplaceSpec`、`ICoroutineSupervisorPolicy`，以及错误码类型。类型不暴露句柄内的物理端口。

来源准入失败保留 TypeError，source=`rpc.transport.coroutine`、code=`COROUTINE_SOURCE_INVALID`。调用或监督失败保留其原 owner 身份及 cause，不统一改写为来源错误。以 source/code 判断，聚合清理失败仍可沿 errors/cause 找到原始对象。统一调用语义见 [host 文档](../rpc-host/README.md)。
