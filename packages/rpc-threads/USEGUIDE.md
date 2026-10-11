# @migaia/rpc-threads 使用指南

从包根使用 `createThreadPeer`、`createThreadPlugin`。按平台导入 `./adapters/node`、`bun`、`deno`、`browser`、`electron-main` 或 `electron-renderer`。

```ts
import { createThreadPeer } from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
```

spawn 持有真实执行单元；connect/listen 借用连接，不取得终止其它执行单元的权限。只有实际 launcher 的 bootstrap 可以自动选择父端来源。Core 负责 ACK、replay、clone、codec 与 drain 状态；公开 handle 的操作只作用于它持有的资源。Electron 是对应平台的可选 peer；使用线程不需要安装进程包。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。

## Advanced usage：拥有 Worker 并保证关闭

以下父端用 Node launcher 创建实际 Worker，复用同一个 scheduler 与单执行单元预算，调用子端后关闭 Peer。两个文件使用 ESM，先编译到同目录的 `.js`；每次启动使用新的 source，不复用已经关闭的 Worker。

### Worker 子端 worker.ts

```ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: { math: { double: (value: number) => value * 2 } },
  report: (error) => console.error(error)
})
```

### createThreadPeer 父端 main.ts

```ts
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

type IChildApi = { math: { double: (value: number) => number } }
/** 原错误进入本应用的报告策略，保留其身份与 cause。 */
const report = (error: unknown) => console.error(error)
/** 该 source 用实际 Node Worker launcher 与 channel factory 持有执行单元。 */
const spawn = {
  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: createNodeThreadLauncher(),
  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
  report
}
/** Peer 在真实 bootstrap、ACK 与协商完成后提供类型化调用。 */
const typedRemote = await createThreadPeer<IChildApi>({ spawn, report })
try {
  console.log(await typedRemote.request('math.double', 21))
} finally {
  await typedRemote.close()
}
```

`createNodeThreadLauncher` 持有创建的 Worker；`createNodeThreadChannelFactory` 沿实际 raw port 与原 private ACK 建立通道。子端只能因真实 launcher bootstrap 自动发现父端；Worker 名称、PID、普通 MessagePort 或复制的 handle 不提供 stop/restart/replace 权限。预算只约束本应用的 Worker 数，没有实际采样时不能宣称资源用量已经验证。

正常返回与调用抛错都进入 `finally`，由 Peer 的原 close/drain owner 清理连接并结束它拥有的 Worker。connect/listen 或借用 port 的 Peer 只关闭自己的连接，不终止外部执行单元。需要 transfer 时，按真实协商能力与 backing 所有权处理；detach 后的失败不能恢复 buffer，也不能以自动重试重放它。
