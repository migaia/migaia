# `@migaia/rpc-threads`

**Worker 线程 RPC。** 用一套 `request` / `notify` / `stream` 调用 Worker 中的函数，Worker 也能反向调用主线程。支持 Node `worker_threads`、Bun、Deno、浏览器 Web Worker 和 Electron。本包负责创建 Worker、建立消息端口和监督重启；调用语义、超时、取消、错误还原等由 `@migaia/rpc-core` 统一提供，Peer 调用 API 与 [`@migaia/rpc-process`](../rpc-process/README.md)、[`@migaia/rpc-browser`](../rpc-browser/README.md) 一致。

## 适用与不适用场景

**适用：**

- 把 CPU 密集计算（解析、压缩、图像处理）移出主线程，避免阻塞事件循环或 UI。
- 需要像调用本地函数一样调用 Worker，而不是手写 `postMessage` 和消息分发。
- 由 PluginHost 统一管理多个 Worker：查询、重启、替换。

**不适用：**

- 需要进程级隔离（崩溃互不影响、独立权限）：用 [`@migaia/rpc-process`](../rpc-process/README.md)。
- 浏览器内跨窗口、iframe、SharedWorker、可靠有序的 RTCDataChannel：用 [`@migaia/rpc-browser`](../rpc-browser/README.md) 的 `createBrowserPeer`；Service Worker 与 BroadcastChannel 使用该包的 Endpoint transport。
- 需要 `SharedArrayBuffer` / `Atomics` 共享内存：不在支持范围内，传入会被拒绝。

## 安装

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract
```

`@migaia/rpc-core` 与 `@migaia/rpc-contract` 是 peer 依赖，三者版本必须完全一致（当前 `0.0.9`）。运行时依赖 `@migaia/supervision`、`@migaia/lifecycle`、`@migaia/utils`，随包安装。使用 `./adapters/electron-main` 时需安装可选 peer `electron` ^44。

## 入口一览

| 入口                           | 内容                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `@migaia/rpc-threads`          | `createThreadPeer`、`createThreadPlugin`、`isThreadChild`、错误码 `RpcThreadErrorCode`、高级通道与 launcher 构造函数 |
| `./adapters/node`              | `createNodeThreadLauncher`、`createNodeThreadChannelFactory`（Node `worker_threads`）                                |
| `./adapters/electron-main`     | `createElectronMainThreadLauncher`、`createElectronMainThreadChannelFactory`                                         |

Web、Bun、Deno 与 Electron renderer 共用 root 的 `createWebThreadLauncher`、`createWebThreadChannelFactory`。`INodeThreadHandle`、`IWebThreadHandle`、`IWebThreadLauncherOptions` 统一从 root 导入。

## 快速开始

保存下面两个文件，编译为同目录的 `worker.js` 和 `main.js`，再运行 `main.js`。Worker 入口只声明自己提供的方法；由库创建时，它会自动连回父线程。后台错误默认交给 `console.error`。

```ts doc-test=run file=worker.ts
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
  }
})
```

主线程只需要 Worker 入口。Node / Bun / Deno 的 launcher、一个 Worker 的预算、调度器和通道由当前运行时的适配器延迟加载：

```ts doc-test=run file=main.ts
// main.ts
import { createThreadPeer } from '@migaia/rpc-threads'

type IWorkerApi = {
  math: { double: (value: number) => number }
  bytes: { inspect: (buffer: ArrayBuffer) => { length: number; first: number } }
}
/** 当前文件的相邻模块是 Worker 入口。 */
const worker = await createThreadPeer<IWorkerApi>({
  spawn: new URL('./worker.js', import.meta.url)
})
try {
  console.log(await worker.request('math.double', 21)) // 42
  console.log(await worker.request('bytes.inspect', new Uint8Array([7, 8, 9]).buffer))
  // { length: 3, first: 7 }
} finally {
  await worker.close() // 关闭连接并终止 Worker
}
```

`spawn` 接受 `true`、`URL`、路径字符串，或以 `entry` 为必填字段的短对象；`base`、`name`、`data`、`limits` 与既有 source 的依赖和监督字段都可覆盖。相对字符串按**主入口文件所在目录**解析；显式 `base: import.meta.url` 可改为当前模块，`URL` 始终按原值使用。短形式只展开为既有 source，仍经过相同的监督、握手和关闭路径。缺少 enforced 退出观察且未提供 health 时，绑定使用实际 RPC ping 做健康检查；能力仍保持 unsupported，不把 ping 当作原生退出证据。字段详情见 [USEGUIDE 第 3 节](./USEGUIDE.md#3-spawn-短形式)，完整配置见[高阶用法](#高阶用法完整-source)。

## 同一个文件作为 Worker

`spawn: true` 会重新执行主入口的全部顶层代码。用 `await isThreadChild()` 分开两支，避免子线程再次创建 Worker：

```ts doc-test=run file=self.ts
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IMathApi = { double(value: number): number }

if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  /** 当前主入口的副本提供计算方法。 */
  const worker = await createThreadPeer<IMathApi>({ spawn: true })
  try {
    console.log(await worker.request('double', 21)) // 42
  } finally {
    await worker.close()
  }
}
```

`isThreadChild()` 读取既有 launcher bootstrap 标记；它不授权外部 Worker。REPL、`--eval`、打包成单个二进制、Electron、以测试运行器为主入口等没有可用入口的场景，self spawn 以 `INVALID_CONFIG` 拒绝，不猜入口。

`.ts` 入口可直接传入。Node 24 能剥离类型，但不会把 `./x.js` 改为 `./x.ts`；Bun 支持该映射，Node / Deno 应使用编译后的 `.js`，或能处理该映射的 loader。模块解析失败保留原始 `cause`。

浏览器请传明确的 Worker URL；`true` 和裸字符串只用于 Node / Bun / Deno。`spawn: new URL('./worker.js', import.meta.url)` 使用已经构建的模块。Vite / webpack 的 Worker 源码发现依赖字面量 `new Worker(new URL('./worker.ts', import.meta.url))`；库内部的动态构造不能代替这一规则。源码打包需预构建 Worker URL，或使用[自定义 Worker 构造](./USEGUIDE.md#8-高阶用法完整-source-与自定义-worker-构造)。

## 两种所有权：Peer 与 Plugin

- **`createThreadPeer`**：独立连接，调用方负责 `close()`。
- **`createThreadPlugin`**：安装进 `@migaia/plugin-host`，由 Host 持有和释放。经 `host.thread.request(target, method, …)` 调用；`list` / `get` / `stop` / `kill` / `restart` / `replace` 也在这个出口上。

```ts doc-test=run file=worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: { math: { double: (value: number) => value * 2 } }
})
```

```ts doc-test=run file=main.ts
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

type IWorkerApi = { math: { double(value: number): number } }
/** Host 接管 Worker 的连接与释放。 */
const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn: new URL('./worker.js', import.meta.url)
})
/** 安装线程插件后，thread 出口提供调用与监督操作。 */
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

## 高阶用法：完整 source

原来的完整 source 对象继续有效。需要自定义预算、监督或 runtime 时，显式组合平台 launcher 与 channel factory；两者共用同一个 scheduler。下面导出的对象可直接作为 `createThreadPeer` 或 `createThreadPlugin` 的 `spawn`，入口使用快速开始的 `worker.js`：

```ts doc-test=check file=source.ts
import { fileURLToPath } from 'node:url'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

/** 后台错误由应用统一记录。 */
const report = (error: unknown) => console.error(error)
/** Node source 显式持有一个 Worker 的预算与监督依赖。 */
export const spawn = {
  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: createNodeThreadLauncher(),
  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
  report
}
```

各平台组合与 Web Worker 终止能力边界见 [USEGUIDE 第 8 节](./USEGUIDE.md#8-高阶用法完整-source-与自定义-worker-构造)。

## 二进制数据

`ArrayBuffer` 与 `Uint8Array` 可以直接作为参数和返回值，默认按值复制，调用后原 buffer 仍可用。双方在 `createThreadPeer` 上配置 `authentication: { sign, verify }` 后，普通 launcher 与 channel factory 就能使用现有的签名原生二进制与 `transfer`；无需自定义 Endpoint。签名函数必须保护完整输入，校验函数必须拒绝伪造签名。Core 在实际端口上确认能力，并由认证中间件建立信任事实。

先保存 [USEGUIDE 第 5 节](./USEGUIDE.md#5-二进制数据与-transfer) 的 `signing.ts` 和 `worker.ts`；双方从各自环境读取同一 `RPC_SIGNING_KEY`，然后运行下面的主线程配置：

```ts doc-test=run group=thread-signed-transfer file=readme-main.ts entry=readme-main.ts
// main.ts：先保存本节的 signing.ts 和 worker.ts，并编译为同目录的 .js。
import { createThreadPeer } from '@migaia/rpc-threads'
import { randomBytes } from 'node:crypto'

/** 本地示例生成演示密钥；部署时应由双方配置提供 RPC_SIGNING_KEY。 */
process.env.RPC_SIGNING_KEY ??= randomBytes(32).toString('hex')
/** 设置环境后才加载签名模块，实际 Worker 继承同一环境。 */
const { authentication } = await import('./signing.js')

type IBytesApi = {
  bytes: { inspect(buffer: ArrayBuffer): { length: number; first: number } }
}
/** 短 source 保留同一签名与原生 transfer owner，无需重复 Worker wiring。 */
const worker = await createThreadPeer<IBytesApi>({
  spawn: new URL('./worker.js', import.meta.url),
  authentication
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

## 载体观察

Node、Bun、Deno、浏览器 Web Worker 与 Electron 通道共用 Core 的 MessagePort transport；通过最终通道的 `transport.observe(probe)` 安装物理观察，每次发送和接收各报告一次。`detail.transfers` 在发送时是原生 transfer 列表长度，接收时为 `-1`，因为 structured clone 无法区分原生 buffer 是复制还是转移。直接 `ArrayBuffer` 或其 view 的 `sizeBytes` 是字节长度；其他原生消息为 `-1`。内容只在 `probe.capturing` 开启时读取，未转移内容保留原引用；实际转移的 buffer 在发送前复制以保留观察字节。Core 对 own-data 原生容器的选择性捕获保留 Array、Record、Map、Set 中的循环、共享 backing 与未转移对象引用；只通过 accessor 返回转移 buffer 的捕获仍需契约裁定，因为额外调用 getter 会改变原有调用次数。Probe 异常沿既有 `onListenerError` 报告为 `@migaia/rpc/core` / `TRANSPORT`，原异常保留在 `cause`，消息继续发送和接收。重复安装替换上一代；旧 disposer 不会解除新一代。调用当前代 disposer 或逻辑 `channel.close()` 停止观察；既有原生终端处理也会退休观察。借用 Node 端口逻辑 close 只退休 observer，原有物理端口关闭状态、监听与错误 cause 顺序不变。

## 错误

错误带 `(source, code)`。本包自己只有一个错误码：`@migaia/rpc/threads` / `THREAD_USAGE_SAMPLE_FAILED`（采样 Worker 资源用量失败）。调用层错误来自 `@migaia/rpc/core`，例如 `DEADLINE_EXCEEDED`、`CANCELLED`、`OVERLOADED`。Worker 中抛出的业务错误会还原原生类型、`message` 和 `stack`。超时或取消不代表 Worker 没有执行，重试前先对账，见 [USEGUIDE 第 7 节](./USEGUIDE.md#7-错误处理)。

## 相关包

| 包                                                  | 关系                               |
| --------------------------------------------------- | ---------------------------------- |
| [`@migaia/rpc-core`](../rpc-core/README.md)         | 调用语义与底层 Endpoint；peer 依赖 |
| [`@migaia/rpc-contract`](../rpc-contract/README.md) | 协议常量与数据格式；peer 依赖      |
| [`@migaia/rpc-process`](../rpc-process/README.md)   | 同一套 API 的跨进程版本            |
| [`@migaia/supervision`](../supervision/README.md)   | launcher、预算、重启策略           |

完整用法、平台差异、错误码与高级用法见 [USEGUIDE](./USEGUIDE.md)。
