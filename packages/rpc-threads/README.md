# `@migaia/rpc-threads`

**Worker 线程 RPC。** 用一套 `request` / `notify` / `stream` 调用 Worker 中的函数，Worker 也能反向调用主线程。支持 Node `worker_threads`、Bun、Deno、浏览器 Web Worker 和 Electron。本包负责创建 Worker、建立消息端口和监督重启；调用语义、超时、取消、错误还原等由 `@migaia/rpc-core` 统一提供，API 与 [`@migaia/rpc-process`](../rpc-process/README.md) 完全一致。

## 适用与不适用场景

**适用：**

- 把 CPU 密集计算（解析、压缩、图像处理）移出主线程，避免阻塞事件循环或 UI。
- 需要像调用本地函数一样调用 Worker，而不是手写 `postMessage` 和消息分发。
- 由 PluginHost 统一管理多个 Worker：查询、重启、替换。

**不适用：**

- 需要进程级隔离（崩溃互不影响、独立权限）：用 [`@migaia/rpc-process`](../rpc-process/README.md)。
- 浏览器内跨窗口、iframe、Service Worker、BroadcastChannel：用 [`@migaia/rpc-browser`](../rpc-browser/README.md)。
- 需要 `SharedArrayBuffer` / `Atomics` 共享内存：不在支持范围内，传入会被拒绝。

## 安装

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract
```

`@migaia/rpc-core` 与 `@migaia/rpc-contract` 是 peer 依赖，三者版本必须完全一致（当前 `0.0.7`）。运行时依赖 `@migaia/supervision`、`@migaia/lifecycle`、`@migaia/utils`，随包安装。只有使用 `./adapters/electron-main` 或 `./adapters/electron-renderer` 时才需要安装可选 peer `electron` ^44。

## 入口一览

| 入口                            | 内容                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `@migaia/rpc-threads`           | `createThreadPeer`、`createThreadPlugin`、错误码 `RpcThreadErrorCode`、高级通道与 launcher 构造函数 |
| `./adapters/node`               | `createNodeThreadLauncher`、`createNodeThreadChannelFactory`（Node `worker_threads`）   |
| `./adapters/bun`                | `createBunThreadLauncher`、`createBunThreadChannelFactory`                             |
| `./adapters/deno`               | `createDenoThreadLauncher`、`createDenoThreadChannelFactory`                           |
| `./adapters/browser`            | `createBrowserThreadLauncher`、`createBrowserThreadChannelFactory`（Web Worker）       |
| `./adapters/electron-main`      | `createElectronMainThreadLauncher`、`createElectronMainThreadChannelFactory`           |
| `./adapters/electron-renderer`  | `createElectronRendererThreadLauncher`、`createElectronRendererThreadChannelFactory`   |

## 快速开始

Worker 入口只声明自己提供的方法。由库的 launcher 创建时，它会自动连回父线程。

```ts
// worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    bytes: {
      inspect: (buffer: ArrayBuffer) => ({
        length: buffer.byteLength,
        first: new Uint8Array(buffer)[0]
      })
    }
  },
  report: (error) => console.error(error)
})
```

主线程用 `spawn` 来源创建 Worker 并调用：

```ts
// main.ts
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

type IWorkerApi = {
  math: { double: (value: number) => number }
  bytes: { inspect: (buffer: ArrayBuffer) => { length: number; first: number } }
}
const report = (error: unknown) => console.error(error)

const worker = await createThreadPeer<IWorkerApi>({
  spawn: {
    spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },
    budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    scheduler: systemScheduler,
    launcher: createNodeThreadLauncher(),
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
    report
  },
  report
})
try {
  console.log(await worker.request('math.double', 21)) // 42
  console.log(await worker.request('bytes.inspect', new Uint8Array([7, 8, 9]).buffer))
  // { length: 3, first: 7 }
} finally {
  await worker.close() // 关闭连接并终止 Worker
}
```

`spawn` 的六个字段各有分工：`spec`（入口与名字）、`budget`（最多同时存在几个 Worker）、`scheduler`（计时与调度）、`launcher`（创建 Worker）、`channelFactory`（在 Worker 端口上建立协议通道）、`report`（接收后台错误）。换平台时只需换 `launcher` 与 `channelFactory`。

## 两种所有权：Peer 与 Plugin

- **`createThreadPeer`**：独立连接，调用方负责 `close()`。
- **`createThreadPlugin`**：安装进 `@migaia/plugin-host`，由 Host 持有和释放。经 `host.thread.request(target, method, …)` 调用；`list` / `get` / `stop` / `kill` / `restart` / `replace` 也在这个出口上。

```ts
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn, // 与上例相同的 spawn 对象
  report
})
const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(worker)
  console.log(await host.thread!.request('worker', 'math.double', 21)) // 42
} finally {
  await host.dispose()
}
```

## 二进制数据

`ArrayBuffer` 与 `Uint8Array` 可以直接作为参数和返回值，默认按值复制，调用后原 buffer 仍可用。双方在 `createThreadPeer` 上配置 `authentication: { sign, verify }` 后，普通 launcher 与 channel factory 就能使用现有的签名原生二进制与 `transfer`；无需自定义 Endpoint。签名函数必须保护完整输入，校验函数必须拒绝伪造签名。Core 在实际端口上确认能力，并由认证中间件建立信任事实。

```ts
// 主线程与 Worker 分别配置相同的签名凭据；spawn 使用上面的普通配置。
const worker = await createThreadPeer<IWorkerApi>({
  spawn,
  authentication: { sign, verify },
  report
})
try {
  const buffer = new Uint8Array([7, 8, 9]).buffer
  console.log(await worker.request('bytes.inspect', buffer, { transfer: [buffer] }))
  // { length: 3, first: 7 }
  console.log(buffer.byteLength) // 0：已转移，原 buffer 失效
} finally {
  await worker.close()
}
```

未配置签名时，`transfer` 仍以 `CAPABILITY_UNSUPPORTED` 拒绝。完整的签名配置与 Worker 示例见 [USEGUIDE 第 5 节](./USEGUIDE.md#5-二进制数据与-transfer)。

## 错误

错误带 `(source, code)`。本包自己只有一个错误码：`@migaia/rpc/threads` / `THREAD_USAGE_SAMPLE_FAILED`（采样 Worker 资源用量失败）。调用层错误来自 `@migaia/rpc/core`，例如 `DEADLINE_EXCEEDED`、`CANCELLED`、`OVERLOADED`。Worker 中抛出的业务错误会还原原生类型、`message` 和 `stack`。超时或取消不代表 Worker 没有执行，重试前先对账，见 [USEGUIDE 第 7 节](./USEGUIDE.md#7-错误处理)。

## 相关包

| 包                                                  | 关系                                         |
| --------------------------------------------------- | -------------------------------------------- |
| [`@migaia/rpc-core`](../rpc-core/README.md)         | 调用语义与底层 Endpoint；peer 依赖           |
| [`@migaia/rpc-contract`](../rpc-contract/README.md) | 协议常量与数据格式；peer 依赖                |
| [`@migaia/rpc-process`](../rpc-process/README.md)   | 同一套 API 的跨进程版本                      |
| [`@migaia/supervision`](../supervision/README.md)   | launcher、预算、重启策略                     |

完整用法、平台差异、错误码与高级用法见 [USEGUIDE](./USEGUIDE.md)。
