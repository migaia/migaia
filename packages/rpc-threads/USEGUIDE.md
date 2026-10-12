# `@migaia/rpc-threads` 使用手册

本手册覆盖本包的全部公开能力。安装与最短示例见 [README](./README.md)。调用 API（`request` / `notify` / `stream` / `group` / `outcome` / `describe` / `close`）与调用选项和 [`@migaia/rpc-process` USEGUIDE 第 4 节](../rpc-process/USEGUIDE.md#4-调用-api)完全相同，本手册只说明 Worker 场景特有的部分。

## 目录

1. [导入](#1-导入)
2. [Worker 端：自动连回父线程](#2-worker-端自动连回父线程)
3. [spawn 来源与各平台 launcher](#3-spawn-来源与各平台-launcher)
4. [交给 PluginHost 管理：createThreadPlugin](#4-交给-pluginhost-管理createthreadplugin)
5. [二进制数据与 transfer](#5-二进制数据与-transfer)
6. [容量与超时](#6-容量与超时)
7. [错误处理](#7-错误处理)
8. [高阶用法：自定义 Worker 构造与通道](#8-高阶用法自定义-worker-构造与通道)
9. [常见问题](#9-常见问题)

---

## 1. 导入

```ts
import {
  createThreadPeer,
  createThreadPlugin,
  RpcThreadErrorCode,
  RPC_THREAD_ERROR_SOURCE
} from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-threads/adapters/node'
```

只导入当前运行平台的 `./adapters/*` 子路径。各平台的 launcher 与 channel factory 名字不同，但组合方式一样（第 3 节）。

## 2. Worker 端：自动连回父线程

```ts
// worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    feed: {
      count: async function* (limit: number) {
        for (let index = 1; index <= limit; index++) yield index
      }
    }
  },
  report: (error) => console.error(error)
})
```

- 在 Worker 内省略来源时，库会识别当前运行环境（Node `worker_threads`、Web 的 `DedicatedWorkerGlobalScope`、Deno Worker、Bun Worker），并通过 launcher 写入的 bootstrap 连回父线程。不是由库 launcher 创建的 Worker 会在配置阶段被拒绝。
- `provide` 的规则与进程版相同：只读取对象自身的可枚举数据属性，嵌套对象生成点分路径；返回 iterable 或 async iterable 的方法通过 `stream` 调用。
- Worker 端得到的也是 Peer，可以 `request` 父线程 `provide` 的方法。

## 3. spawn 来源与各平台 launcher

```ts
spawn: {
  spec: { entry, name: 'math-worker' },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher,          // 平台 launcher
  channelFactory,    // 与 launcher 配套的通道工厂
  report
}
```

| 字段             | 说明                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `spec.entry`     | Worker 入口。Node 用文件路径（`fileURLToPath(new URL('./worker.js', import.meta.url))`）；Web / Deno / Bun 用模块 URL。 |
| `spec.name`      | Worker 名字，用于调试与查询。                                                                          |
| `budget`         | `createUnitBudget({ kind: 'thread', maxUnits })`：同时存在的 Worker 上限。                              |
| `scheduler`      | 计时与调度，通常用 `systemScheduler`；`channelFactory` 必须使用同一个 scheduler。                       |
| `launcher`       | 创建 Worker。                                                                                          |
| `channelFactory` | 在 Worker 端口上建立协议通道。                                                                         |
| `report`         | 接收后台错误。                                                                                         |
| `health`         | 可选，健康检查策略。                                                                                   |
| `supervisor`     | 可选，`id`、`ready`、`startupTimeoutMs`、`restart`、`terminalPolicy`、`stop`、`isolation` 等监督策略。  |

各平台的组合：

| 平台                   | launcher                                                | channelFactory                                                    | 说明                                                 |
| ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Node                   | `createNodeThreadLauncher()`                            | `createNodeThreadChannelFactory({ scheduler })`                   | `worker_threads`，可观察退出、可终止                 |
| Bun                    | `createBunThreadLauncher({ report })`                   | `createBunThreadChannelFactory({ scheduler })`                    | Web Worker 语义                                      |
| Deno                   | `createDenoThreadLauncher({ report })`                  | `createDenoThreadChannelFactory({ scheduler })`                   | 模块 Worker；需要相应权限                            |
| 浏览器                 | `createBrowserThreadLauncher({ report })`               | `createBrowserThreadChannelFactory({ scheduler })`                | `new Worker(url, { type: 'module' })`                |
| Electron 主进程        | `createElectronMainThreadLauncher()`                    | `createElectronMainThreadChannelFactory({ scheduler })`           | 基于 Node `worker_threads`                           |
| Electron 渲染进程      | `createElectronRendererThreadLauncher({ report })`      | `createElectronRendererThreadChannelFactory({ scheduler })`       | 基于 Web Worker                                      |

**Web Worker 的终止边界**：浏览器、Bun、Deno 的 launcher 把 `termination` 与 `exit-observation` 声明为 `unsupported`。`terminate()` 之后无法确认 Worker 中的代码已经停止，监督层会保守地把该单元视为可能仍在运行。Node 与 Electron 主进程基于 `worker_threads`，可以观察退出。

已有 `MessagePort` 可以作为 `connect` 来源。双方把 Core 提供的 `context.capabilities` 交给 channel；Core 在实际端口上交换 ACK，只有双方都提供的能力才会启用。双方应同时开始连接：

```ts
import { MessageChannel } from 'node:worker_threads'
import { createNodeThreadChannel, createThreadPeer } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'

const { port1, port2 } = new MessageChannel()
const report = (error: unknown) => console.error(error)
const [left, right] = await Promise.all([
  createThreadPeer({
    self: { name: 'left', instanceId: 'left-1' },
    provide: { greet: (name: string) => `hello ${name}` },
    connect: async (context) => createNodeThreadChannel(port1, 'right-1', {
      scheduler: systemScheduler,
      capabilities: context.capabilities
    }),
    report
  }),
  createThreadPeer<{ greet(name: string): string }>({
    self: { name: 'right', instanceId: 'right-1' },
    connect: async (context) => createNodeThreadChannel(port2, 'left-1', {
      scheduler: systemScheduler,
      capabilities: context.capabilities
    }),
    report
  })
])
try {
  console.log(await right.request('greet', 'world')) // hello world
} finally {
  await Promise.all([left.close(), right.close()])
  port1.close()
  port2.close()
}
```

`self` 可以省略，Core 会生成本地标识；需要稳定地址时显式设置。`capabilities` 是本地提案，可显式缩小，不能声称已协商或已信任。Peer 关闭只注销借用端口的监听器；端口仍由调用方关闭。不传 `capabilities` 的底层 channel 保留同步、零握手的固定能力配置。

## 4. 交给 PluginHost 管理：createThreadPlugin

`createThreadPlugin(options, runtime?)` 接受与 `createThreadPeer` 相同的 `spawn`、`provide`，另加 `name`（Host 内的连接名）与可选的 `expose`。安装后经 `host.thread` 出口调用：

```ts
import { defineHost } from '@migaia/plugin-host'
import { createThreadPlugin } from '@migaia/rpc-threads'

const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn,
  report
})
const host = defineHost<Record<string, never>, never, readonly [typeof worker]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
try {
  await host.use(worker)
  console.log(await host.thread!.request('worker', 'math.double', 21)) // 42
  const detail = await host.thread!.get('worker')
  console.log(detail.kind) // 'spawn'
} finally {
  await host.dispose()
}
```

`host.thread` 出口的方法与 `host.process` 相同：`request` / `notify` / `stream` / `group` / `outcome`（第一个参数是目标连接名或 `{ name, instanceId }`）、`list` / `get`、`broadcast`，以及只对 spawn 来源有效的 `stop` / `kill` / `restart` / `replace`。线程的 `stop` 只接受 `{ graceMs }`，传入 `signal` 字段（包括 `undefined`）会被拒绝。

**重启后的调用时机**：`restart()` 返回 `ready` 或 `replace()` 返回 `replaced` 时，新代次已经进入出口目录，可以立即调用，无需额外等待 `ready` 事件或退避重试。

**`expose`**：默认不向 Worker 公开主线程 Host 的任何方法；显式列出的路径才可见，例如 `expose: ['settings.read']`。

## 5. 二进制数据与 transfer

| 用法                                  | 结果                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| 传入 `ArrayBuffer` / `Uint8Array`     | 按值复制；调用后原 buffer 仍可用。`Uint8Array` 的 offset / length 保持不变。              |
| `{ transfer: [buffer] }`              | 零拷贝转移。需要连接协商原生二进制与 transfer 能力，并配置签名认证；否则以 `CAPABILITY_UNSUPPORTED` 拒绝。 |
| `SharedArrayBuffer`、其它 TypedArray  | 不支持，调用前拒绝。                                                                      |

使用 transfer 时要注意：

- transfer 在消息真正提交到端口时才使 buffer 失效（`byteLength` 变为 0），之后即使调用失败也无法恢复原 buffer；共享同一 backing 的所有视图同时失效。
- 带 transfer 的调用不会被自动重试，库也不保留输入副本。需要重发时，先确认结果，再重新构造数据。
- 双方的 `createThreadPeer` 配置 `authentication: { sign, verify }` 即可使用普通 factory；无需自定义 `endpointFactory`。原生二进制 profile 要求签名而不加密，且 `encodedType` 为默认的 `any`。库在实际端口上协商能力，由现有认证中间件建立信任事实。未配置签名时仍拒绝 transfer。

下面的 Node 示例用双方已持有的同一 HMAC 密钥签名。`RPC_SIGNING_KEY` 是本地部署配置中的十六进制密钥，两端分别读取；不要经 RPC 发送密钥。先把签名函数放在共享模块：

```ts
// signing.ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IRpcAuthenticationConfig } from '@migaia/rpc-core'

/** 双方从各自的部署配置读取同一密钥，不把密钥放进消息。 */
const key = Buffer.from(process.env.RPC_SIGNING_KEY!, 'hex')
/** 完整语义输入包含 Core 对原生 backing 计算的完整性摘要。 */
const signature = (value: unknown) =>
  createHmac('sha256', key).update(JSON.stringify(value)).digest()

export const authentication: IRpcAuthenticationConfig = {
  sign: (value) => ({ value, signature: signature(value).toString('hex') }),
  verify: (input) => {
    const frame = input as { value: unknown; signature: string }
    const received = Buffer.from(frame.signature, 'hex')
    const expected = signature(frame.value)
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new TypeError('Invalid RPC signature')
    return frame.value
  }
}
```

Worker 与主线程分别安装这个普通配置：

```ts
// worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'
import { authentication } from './signing.js'

await createThreadPeer({
  authentication,
  provide: {
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

```ts
// main.ts：先保存本节的 signing.ts 和 worker.ts，并编译为同目录的 .js。
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc-threads'
import { createNodeThreadLauncher, createNodeThreadChannelFactory } from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { authentication } from './signing.js'

type IBytesApi = {
  bytes: { inspect(buffer: ArrayBuffer): { length: number; first: number } }
}
/** 后台诊断由应用接收，签名凭据不进入日志。 */
const report = (error: unknown) => console.error(error)
/** 标准 Node source 持有 Worker 和一个单位的预算。 */
const spawn = {
  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)) },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: createNodeThreadLauncher(),
  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
  report
}
/** 普通 factory 使用双方配置的签名资源，无需自定义 Endpoint。 */
const worker = await createThreadPeer<IBytesApi>({ spawn, authentication, report })
try {
  const buffer = new Uint8Array([7, 8, 9]).buffer
  console.log(await worker.request('bytes.inspect', buffer, { transfer: [buffer] }))
  // { length: 3, first: 7 }
  console.log(buffer.byteLength) // 0：已转移，原 buffer 失效
} finally {
  await worker.close()
}
```

## 6. 容量与超时

- 默认 request / stream 超时 30000 ms，可用 `defaultTimeoutMs` 修改，单次调用用 `timeoutMs` 覆盖（`false` 关闭）。
- 入站并发默认每个对端 64、全局 256，超出时调用方收到 `OVERLOADED`，Worker 中的函数不会被调用；可通过 `providerLimits` 调整。
- `spec.limits.callWallTimeMs`（如设置）是单次调用的墙钟上限，会压低任何更长的超时。

## 7. 错误处理

所有错误都是原生 `Error`（或其子类），附带 `source` 与 `code`，原始原因在 `cause` 链上。按 `(source, code)` 分支，不要匹配 `message` 文本。

| source                  | code                          | 含义与处理                                                                 |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `@migaia/rpc/threads`   | `THREAD_USAGE_SAMPLE_FAILED`  | 采样 Worker CPU / 内存失败。显示为不可用即可，不影响 Worker 生命周期。     |
| `@migaia/rpc/core`      | `DEADLINE_EXCEEDED`           | 超时（`TimeoutError`）。Worker 可能已执行，先对账再决定是否重试。          |
| `@migaia/rpc/core`      | `CANCELLED`                   | 被 `signal` 取消（`AbortError`）。同上。                                   |
| `@migaia/rpc/core`      | `OVERLOADED`                  | 并发额度已满，函数未被调用。降低并发后退避重试。                           |
| `@migaia/rpc/core`      | `CAPABILITY_UNSUPPORTED`      | 使用了未协商的能力（例如默认配置下的 `transfer`）。改用受支持的方式。     |
| `@migaia/rpc/core`      | `TARGET_UNKNOWN`              | 出口中找不到目标（名字错误，或重启后尚未重新就绪）。                      |
| `@migaia/rpc/remote`    | `REMOTE_CLOSED`               | 连接或代次已关闭。重新选择目标；已发出的调用先对账。                       |

Worker 中抛出的业务错误会还原原生类型（例如 `RangeError`）、`message` 与 `stack`。完整的调用层错误码表见 [rpc-core USEGUIDE](../rpc-core/USEGUIDE.md#10-错误码与处理)。

**重试原则**：超时、取消、断线都不能证明 Worker 没有执行。非幂等操作重试前，用 `idempotencyKey` + `outcome(key)` 查询，或按业务规则对账。

## 8. 高阶用法：自定义 Worker 构造与通道

以下导出面向需要自行控制 Worker 构造的运行时适配器作者。普通应用使用第 3 节的 launcher 即可。

| 导出                                                      | 用途                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `createWebThreadLauncher({ Worker, report })`             | 用你提供的 Worker 构造函数创建 Web Worker（例如 polyfill 或受限环境中的构造器）            |
| `createWebThreadChannelFactory({ scheduler })`            | 与上面的 launcher 配套                                                                      |
| `createAdapterNodeThreadLauncher(runtime, options)`       | 用自定义的 Node 运行时资源（`IThreadRuntimeResource`）创建 Worker                          |
| `createAdapterNodeThreadPeer(options, parentPort, data)`  | Worker 一侧：用你持有的 `parentPort` 与 `workerData` 建立 Peer                              |
| `createNodeThreadChannel`、`createWebThreadChannel`       | 在借用端口上构造通道；固定基础能力同步返回，扩展 `capabilities` 等待 Core 双边 ACK          |
| `receiveThreadData`、`readThreadBootstrap`                | 读取并校验 launcher 写入的 bootstrap 数据                                                   |

launcher 返回的 handle 提供 `identity`、`port`、`exited`、`terminate`、`sampleUsage` 与 `open(signal, { scheduler })`。`open` 在该 Worker 的端口上完成能力确认并返回协议通道：

```ts
import { createNodeThreadLauncher } from '@migaia/rpc-threads/adapters/node'

const launcher = createNodeThreadLauncher()
const handle = await launcher.launch(threadSpec, { signal })
const channel = await handle.open(signal, { scheduler })
```

握手、能力确认和信任判断都在 `@migaia/rpc-core/adapter` 内部完成；这些构造函数只接收你实际持有的 Worker 与端口，不接受"已协商 / 已信任"之类的外部声明。

## 9. 常见问题

**Worker 文件单独运行时报配置错误？**
自动来源只在库 launcher 创建的 Worker 中成立。

**传了 `ArrayBuffer`，为什么原 buffer 还在？**
默认按值复制。零拷贝转移需要 `transfer` 及相应配置（第 5 节）。

**能在两个已有的 `MessagePort` 之间直接建立 Peer 吗？**
可以。双方的 `connect` 使用 `createNodeThreadChannel` 或 `createWebThreadChannel`，并传入 `context.capabilities`（第 3 节末尾）。双方同时启动，能力确认由 Core 在实际端口上完成。

**Worker 崩溃后会自动重启吗？**
取决于 `supervisor.restart` 策略。使用 `createThreadPlugin` 时，可经 `host.thread.restart(name)` 手动重启，或用 `list` / `get` 查询当前代次与退出信息。
