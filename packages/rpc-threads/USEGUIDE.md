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

`createThreadPlugin(options, runtime?)` 只接受对称 runtime options：以 `name` 标识 Host 出口中的连接，通过 `provide` / `expose` 公开方法，并选择 `spawn`、`connect` 或 `listen`。旧的 `{ spec, contract, host, ... }` Plugin options 分支与 `IThreadPluginOptions` 已删除；runtime form 的高级配置仍按 `IRuntimeThreadPluginOptions` 使用。Worker 启动配置放入 `spawn`；Host 的配置仍由 `defineHost` 持有。

RPC 包族精确锁步为 0.0.7，跨包 peer 使用精确版本。此工作不发布；仓内消费方直接导入各公开包。同一 realm 的第二份模块实例在取得资源前抛出 native Error，source 为 `@migaia/rpc/core`、code 为 `DUPLICATE_MODULE_INSTANCE`；修复依赖解析并重载 realm。不同 Worker realm 独立。既有六个语义 source、wire 与错误身份保持不变。

包内使用相对路径；跨包调用只使用公开 API。协议工具使用 `@migaia/rpc-contract`，Core/Remote/Testing 使用 `@migaia/rpc-core` 的普通入口。

从包根导入 `RPC_THREAD_ERROR_SOURCE` 和 `RpcThreadErrorCode`；source 固定为 `@migaia/rpc/threads`。资源采样失败按 `usageSampleFailed` 报告 unavailable 并保留原 cause，不将显示消息或复制的 source/code 当作 Worker 控制权。Core 的普通错误族守卫处理跨 realm 的 Core 错误，详见 Core USEGUIDE。

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

### createThreadPlugin 父端安装

需要由 PluginHost 持有连接时，沿用上述 `IChildApi`、`spawn` 与 `report`，将 Peer 构造及关闭段替换为以下安装代码。Worker 子端保持相同的 `provide` 方法。

```ts
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

/** 定义 Host 拥有的连接；真实 spawn source 持有 Worker。 */
const worker = createThreadPlugin<IChildApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn,
  report
})
/** Host 安装和释放同一个 thread 出口及其资源。 */
const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(worker)
  console.log(await host.thread!.request('worker', 'math.double', 21))
} finally {
  await host.dispose()
}
```

`createNodeThreadLauncher` 持有创建的 Worker；`createNodeThreadChannelFactory` 只在真实 runtime bootstrap 下执行扩展能力 ACK。直接调用 `createNodeThreadChannel` / `createWebThreadChannel` 同步返回固定能力 channel，不执行 bootstrap 或扩展 ACK；`capabilities` 只能收窄该固定能力集。扩展能力必须通过持有真实资源的 runtime source 和实际对端 ACK 协商。子端只能因真实 launcher bootstrap 自动发现父端；Worker 名称、PID、普通 MessagePort 或复制的 handle 不提供 stop/restart/replace 权限。预算只约束本应用的 Worker 数，没有实际采样时不能宣称资源用量已经验证。

正常返回与调用抛错都进入 `finally`，由 Peer 的原 close/drain owner 清理连接并结束它拥有的 Worker。connect/listen 或借用 port 的 Peer 只关闭自己的连接，不终止外部执行单元。需要 transfer 时，按真实协商能力与 backing 所有权处理；detach 后的失败不能恢复 buffer，也不能以自动重试重放它。
