# `@migaia/rpc-host`

用一个 `createRpcHost` 入口，把业务函数接到进程、线程、浏览器或协作任务。每个 host 安装一个传输 plugin，按需叠加 feature。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- **调用与资源归属放在一起。** host 负责调用、目录和在途任务；传输 plugin 保留真实进程、Worker、监听器或借用资源的释放责任。
- **双向请求与流共用连接。** 双方都可以 `provide`，用 `request` 等待结果、`notify` 等待物理发送、`stream` 逐项消费。
- **多对端行为明确。** 不指定目标就是广播；指定直连目标用 `send` 或 `dispatch`，每个目标的失败独立保留。
- **功能按需安装。** 期限、认证、重试、分片和类型生成使用公开 feature，不需要组装底层调用对象。

## 从这里开始

安装 host、协议包和本例的协程传输：

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-coroutines
```

下面在同一事件循环建立两个真实 host。任务接收的 `connect` 是本代专属句柄；父端关闭后，任务沿原取消信号退出。

```ts doc-test=run
import { createRpcHost } from '@migaia/rpc-host'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'

const host = await createRpcHost<{ double(value: number): number }>({
  plugins: [
    coroutinePlugin({
      spawn: async ({ connect, signal }) => {
        const child = await createRpcHost({
          plugins: [coroutinePlugin({ connectToParent: connect })],
          provide: { double: (value: number) => value * 2 }
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
    })
  ]
})
try {
  console.log(await host.request('double', 21))
} finally {
  await host.close()
}
```

输出 `42`。需要独立进程或线程时，换用下表中的传输；业务 `provide` 和调用接口不变。

## 三分钟心智模型

| 概念             | 作用                                                                |
| ---------------- | ------------------------------------------------------------------- |
| host             | 本端身份、业务目录、调用和统一关闭；一个 host 只构造一个调用端点    |
| transport plugin | 选择并准备真实来源，每个 host 恰好一个                              |
| feature          | 为现有调用链贡献配置或观察能力；同一 feature 定义每个 host 至多一次 |
| `provide`        | 本地普通函数或生成器；返回值成为结果，异常进入原错误链              |
| `peers`          | 当前直连对端的能力；保存的函数绑定原连接代次，旧代退出后拒绝        |

`self` 可指定 `{ name, instanceId }`；省略时生成独立身份。名称用于直连选择，`instanceId` 区分实际实例。同名新连接会探测旧会话：旧会话仍响应则拒绝，已失效才接纳新会话。

## 调用与目标

| API                                          | 完成含义                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `request(method, payload?, options?)`        | 向当前直连集合请求业务结果                                            |
| `notify(method, payload?, options?)`         | 等待物理发送完成，不等待业务确认；`options.targetId` 可选单个直连目标 |
| `stream(method, payload?, options?)`         | 取得一个迭代器，或按目标分开的迭代器集合                              |
| `group(steps, options?)`                     | 每个目标执行一组 `{ method, payload }`，没有跨目标事务                |
| `outcome(idempotencyKey)`                    | 查询各目标保留的逻辑结果                                              |
| `send(targetId, method, payload?, options?)` | 只调用一个当前直连目标，返回标量                                      |
| `dispatch(targetId, method, payload?)`       | 单目标发送后报告失败，同步返回 `void`                                 |
| `provide(definition)`                        | 增量登记本地方法；重复名拒绝，不覆盖原方法                            |
| `describe()` / `on(...)`                     | 读取目录、身份与状态，订阅原生命周期事件                              |
| `close()`                                    | 释放本 host；重复调用共享同一 Promise                                 |

普通 host 的无目标调用：0 个目标返回 `{ fulfilled: {}, rejected: {} }`；1 个目标返回该标量，失败直接拒绝；多个目标返回按目标身份索引的 `fulfilled` / `rejected`。流集合中的每个迭代器独立取消。安装 [pool](../rpc-plugin-pool/README.md) 后只公开一个逻辑目标 `pool`，每次只调度一个成员并返回标量。

`send('b', 'c.render', payload)` 先到直连 b；b 必须确认 c 是自己当前存活的直连，再读取 c 当前目录并转发。a 不能直接指定未与自己连接的 c。也可在 b 使用 `provide({ render: b.peers.c.render })` 显式发布持有的能力；该能力不会悄悄改指重连后的新代。

## 选择传输与功能

| 场景                                                          | 包 / 工厂                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 子进程、本机服务、JSON-RPC 字节服务                           | [rpc-plugin-process](../rpc-plugin-process/README.md) / `processPlugin`            |
| Node、Bun、Deno 原生线程                                      | [rpc-plugin-thread](../rpc-plugin-thread/README.md) / `threadPlugin`               |
| Window、浏览器 Worker、广播、ServiceWorker、RTC、WebTransport | [rpc-plugin-browser](../rpc-plugin-browser/README.md) / 对应载体工厂               |
| 同一事件循环的协作任务                                        | [rpc-plugin-coroutines](../rpc-plugin-coroutines/README.md) / `coroutinePlugin`    |
| 有限容量、排队与排空                                          | [rpc-plugin-pool](../rpc-plugin-pool/README.md) / `poolPlugin` feature             |
| 查询、观察与录制                                              | [rpc-plugin-devtools](../rpc-plugin-devtools/README.md) / `devtoolsPlugin` feature |

公用功能有两种等价的按需导入写法：

```ts
import {
  timeoutFeature,
  chunkFeature,
  authFeature,
  retryFeature,
  typegenFeature
} from '@migaia/rpc-host/features'
import timeout from '@migaia/rpc-host/features/timeout'

const deadline = timeoutFeature({ ms: 1500 })
const sameDefinition = timeout({ ms: 1500 })
```

两种写法选一种安装；不能把同一 feature 的两个配置同时装进一个 host。`typegenFeature({ out: { write(fileName, text) { console.log(fileName, text) } } })` 读取已接受目录及方法 schema，应用负责实际文件 I/O。认证配置沿 `authFeature(config)` 的真实签名；不要把一项能力标签当作授权。

## 期限、失败与关闭

传输的 `connect: { timeoutMs }` 约束握手准备；业务调用的 `timeoutMs`、host 的 `defaultTimeoutMs` 和 timeout feature 是另一层。单次调用优先于 host 设置，host 设置优先于 feature 默认。`signal` 支持协作取消；到期或断开不能证明业务未执行，非幂等操作应先对账再决定重试。

错误按功能域区分：调用与 host 准入为 `rpc.endpoint`，远端托管调用为 `rpc.remote`，实际载体使用自己的 `rpc.transport.*`。按 `source` 与 `code` 判断，保留 `cause` / `errors` 和原生错误类型，不依赖消息文本。缺失/重复传输、无 SDK 身份、重复 feature/assembler、响应中的同名对端均在对应准入边界拒绝。

传输和 feature 是真实 plugin-host 定义，也可交给普通 `PluginHost.use(...)`；它的原安装、替换和清理 owner 保持负责。自定义传输作者使用 `@migaia/rpc-host/plugin` 的冷部署及作用域工具；应用从 `createRpcHost` 开始，不需要底层工厂或私有文件。

更多调用、取消与迁移说明见[使用指南](./USEGUIDE.md)。
