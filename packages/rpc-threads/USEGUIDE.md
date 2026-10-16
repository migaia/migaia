# `@migaia/rpc-threads` 使用手册

本手册覆盖本包的全部公开能力。安装与最短示例见 [README](./README.md)。调用 API（`request` / `notify` / `stream` / `group` / `outcome` / `describe` / `close`）与调用选项和 [`@migaia/rpc-process` USEGUIDE 第 4 节](../rpc-process/USEGUIDE.md#4-调用-api)完全相同，本手册只说明 Worker 场景特有的部分。

## 目录

1. [导入](#1-导入)
2. [Worker 端：自动连回父线程](#2-worker-端自动连回父线程)
3. [spawn 短形式](#3-spawn-短形式)
4. [交给 PluginHost 管理：createThreadPlugin](#4-交给-pluginhost-管理createthreadplugin)
5. [二进制数据与 transfer](#5-二进制数据与-transfer)
6. [容量与超时](#6-容量与超时)
7. [错误处理](#7-错误处理)
8. [高阶用法：完整 source 与自定义 Worker 构造](#8-高阶用法完整-source-与自定义-worker-构造)
9. [常见问题](#9-常见问题)

---

## 1. 导入

```ts doc-test=check
import {
  createThreadPeer,
  createThreadPlugin,
  isThreadChild,
  RpcThreadErrorCode,
  RPC_THREAD_ERROR_SOURCE
} from '@migaia/rpc-threads'
```

普通 TS Worker 只需根入口；短 `spawn` 会延迟加载当前运行时的 adapter。自定义完整 source 时，只导入当前平台的 `./adapters/*` 子路径（第 8 节）。

## 2. Worker 端：自动连回父线程

把下面两个文件编译为同目录的 `worker.js` 与 `main.js`，然后运行 `main.js`。默认 `report` 为 `console.error`。

```ts doc-test=run file=worker.ts
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
  }
})
```

```ts doc-test=run file=main.ts
import { createThreadPeer } from '@migaia/rpc-threads'

type IWorkerApi = {
  math: { double(value: number): number }
  feed: { count(limit: number): AsyncIterableIterator<number> }
}

/** URL 明确定位相邻 Worker，关闭时由 Peer 释放该 Worker。 */
const worker = await createThreadPeer<IWorkerApi>({
  spawn: new URL('./worker.js', import.meta.url)
})
try {
  console.log(await worker.request('math.double', 21)) // 42
  for await (const value of worker.stream('feed.count', 3)) console.log(value) // 1、2、3
} finally {
  await worker.close()
}
```

- 在 Worker 内省略来源时，库会识别当前运行环境（Node `worker_threads`、Web 的 `DedicatedWorkerGlobalScope`、Deno Worker、Bun Worker），并通过 launcher 写入的 bootstrap 连回父线程。不是由库 launcher 创建的 Worker 会在配置阶段被拒绝。
- `provide` 的规则与进程版相同：只读取对象自身的可枚举数据属性，嵌套对象生成点分路径；返回 iterable 或 async iterable 的方法通过 `stream` 调用。
- Worker 端得到的也是 Peer，可以 `request` 父线程 `provide` 的方法。

## 3. spawn 短形式

`createThreadPeer` 与 `createThreadPlugin` 接受同样的短形式，不需要新的 factory：

| `spawn` | 说明 |
| ------- | ---- |
| `true` | 把当前主入口作为 Worker，必须用下面的 child guard。 |
| `new URL('./worker.js', import.meta.url)` | 精确使用 URL；不经过相对字符串解析。 |
| `'./worker.ts'` | Node / Bun / Deno 路径；相对**主入口文件所在目录**解析。 |
| `{ entry: './worker.js', base: import.meta.url, name: 'math' }` | 显式选择当前模块为相对解析基准，并覆盖 Worker 名字。 |

短对象的 `entry` 接受 `true`、`URL`、字符串，其余字段均可省略：

| 字段 | 默认与用途 |
| ---- | ---------- |
| `base` | 显式模块 URL 或 URL 字符串，用于相对 entry 解析；省略时用主入口目录。不能通过堆栈猜调用模块。 |
| `name`、`data`、`limits` | 传给既有 Worker spec 的名字、初始化数据和资源限制。 |
| `scheduler` | `systemScheduler`。 |
| `budget` | `createUnitBudget({ kind: 'thread', maxUnits: 1 })`。 |
| `launcher`、`channelFactory` | 当前运行时对应的既有 adapter；延迟加载。自定义 channel factory 必须使用相同 scheduler。 |
| `report` | `console.error`；可换成应用的错误收集函数。 |
| `health` | 可选，复用完整 source 的健康检查策略。 |
| `supervisor` | 既有监督策略，可设置 `ready`、`startupTimeoutMs`、`restart`、`terminalPolicy`、`stop`、`isolation` 等。 |
| `keyFactory`、`retryPort` | 可选，复用完整 source 的幂等键生成与重试配置；顶层同名选项优先。 |

这些默认值只展开为原来的完整 source。预算、握手、监督、代次和信任事实继续由原来的 owner 管理；短形式不接受“已经协商”或“已经信任”的声明。完整 source 仍可传入（第 8 节）。

### self spawn：同文件的两条分支

保存为 `self.ts`，编译为 `self.js` 后运行。整个模块会在 Worker 中再次执行；所有只属于主线程的副作用都应放在 `else` 分支：

```ts doc-test=run file=self.ts
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IMathApi = { double(value: number): number }

if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  /** self spawn 复用当前主入口，由既有 bootstrap 区分父子。 */
  const worker = await createThreadPeer<IMathApi>({ spawn: true })
  try {
    console.log(await worker.request('double', 21)) // 42
  } finally {
    await worker.close()
  }
}
```

`isThreadChild()` 读取既有库 bootstrap 标记，不是授权外部 Worker 的输入。REPL、`--eval`、打包成单个二进制、Electron、以测试运行器为主入口等无法提供可用入口的场景，`spawn: true` 以 `INVALID_CONFIG` 拒绝，不猜入口。

### 入口与运行环境的边界

- **相对路径**：库无法读取调用模块的 `import.meta.url`。裸字符串以主入口目录为基准；嵌套模块应传 `URL` 或显式 `base: import.meta.url`。URL 始终精确使用。
- **TS 入口**：`.ts` 可直接传入。Node 24 的类型剥离不会改写 `./x.js` 到 `./x.ts`。Bun 支持这种映射；本仓库使用 `.js` specifier，所以 Node / Deno 应运行编译输出，或配置能处理映射的 loader。解析失败保留原始 module-resolution `cause`。
- **浏览器**：只用明确的 URL；`true` 和裸字符串只用于 Node / Bun / Deno。动态 `Worker` 构造不能让 Vite / webpack 发现 Worker 源码。`spawn: new URL('./worker.js', import.meta.url)` 应指向已经构建的模块；需由 bundler 编译 `.ts` Worker 时，预构建 URL，或在自定义 Worker 构造中保留字面量 `new Worker(new URL('./worker.ts', import.meta.url))`（第 8 节）。
- **Electron**：显式选用第 8 节的 Electron adapter；不使用 self spawn 猜测应用入口。
- **Web Worker 终止**：浏览器、Bun、Deno 的 launcher 继续把 `termination` 与 `exit-observation` 声明为 `unsupported`。`terminate()` 后无法确认代码已经停止，监督层保守地视为可能仍在运行；Node 与 Electron 主进程可观察退出。

### 借用已有 MessagePort

已有 `MessagePort` 可以作为 `connect` 来源。双方把 Core 提供的 `context.capabilities` 交给 channel；Core 在实际端口上交换 ACK，只有双方都提供的能力才会启用。双方应同时开始连接：

```ts doc-test=run
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

`createThreadPlugin(options, runtime?)` 接受与 `createThreadPeer` 相同的短 `spawn`、完整 source、`provide`，另加 `name`（Host 内的连接名）与可选的 `expose`。下面两个文件编译后，由 Host 持有 Worker，并经 `host.thread` 出口调用：

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
/** 该插件将 Worker 交给 Host 管理。 */
const worker = createThreadPlugin<IWorkerApi, Record<never, never>, 'worker'>({
  name: 'worker',
  spawn: new URL('./worker.js', import.meta.url)
})
/** Host 销毁时释放线程插件及其 Worker。 */
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

```ts doc-test=run group=thread-signed-transfer file=signing.ts
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

```ts doc-test=run group=thread-signed-transfer file=worker.ts
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

```ts doc-test=run group=thread-signed-transfer file=guide-main.ts entry=guide-main.ts
// main.ts：先保存本节的 signing.ts 和 worker.ts，并编译为同目录的 .js。
import { fileURLToPath } from 'node:url'
import { createThreadPeer } from '@migaia/rpc-threads'
import { createNodeThreadLauncher, createNodeThreadChannelFactory } from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { randomBytes } from 'node:crypto'

/** 本地示例生成演示密钥；部署时应由双方配置提供 RPC_SIGNING_KEY。 */
process.env.RPC_SIGNING_KEY ??= randomBytes(32).toString('hex')
/** 设置环境后才加载签名模块，实际 Worker 继承同一环境。 */
const { authentication } = await import('./signing.js')

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

## 8. 高阶用法：完整 source 与自定义 Worker 构造

### 保留完整 source

自定义预算、监督或平台组合时，原来的完整 `IRuntimeThreadSpawn` 对象继续有效。下面对象直接作为 `createThreadPeer` 或 `createThreadPlugin` 的 `spawn`；`worker.js` 使用第 2 节的 Worker：

```ts doc-test=check file=source.ts
import { fileURLToPath } from 'node:url'
import { createNodeThreadLauncher, createNodeThreadChannelFactory } from '@migaia/rpc-threads/adapters/node'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

/** 后台错误由应用统一记录。 */
const report = (error: unknown) => console.error(error)
/** 完整 Node source 显式组合预算、监督依赖与通道。 */
export const spawn = {
  spec: { entry: fileURLToPath(new URL('./worker.js', import.meta.url)), name: 'math-worker' },
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  scheduler: systemScheduler,
  launcher: createNodeThreadLauncher(),
  channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
  report
}
```

| 字段 | 说明 |
| ---- | ---- |
| `spec.entry` | Node 文件路径或 URL 字符串；Web / Deno / Bun 模块 URL 字符串。 |
| `spec.name`、`spec.data`、`spec.limits` | Worker 名字、初始化数据与资源限制。 |
| `budget` | 同时存在的 Worker 上限。 |
| `scheduler` | 计时与调度；channel factory 必须使用同一个 scheduler。 |
| `launcher`、`channelFactory` | 平台 Worker 创建与协议通道。 |
| `report` | 必填，接收后台错误。 |
| `health` | 可选，健康检查策略。 |
| `supervisor` | 可选，`id`、`ready`、`startupTimeoutMs`、`restart`、`terminalPolicy`、`stop`、`isolation` 等监督策略。 |

各平台的显式组合：

| 平台 | launcher | channelFactory |
| ---- | -------- | -------------- |
| Node | `createNodeThreadLauncher()` | `createNodeThreadChannelFactory({ scheduler })` |
| Bun | `createBunThreadLauncher({ report })` | `createBunThreadChannelFactory({ scheduler })` |
| Deno | `createDenoThreadLauncher({ report })` | `createDenoThreadChannelFactory({ scheduler })` |
| 浏览器 | `createBrowserThreadLauncher({ report })` | `createBrowserThreadChannelFactory({ scheduler })` |
| Electron 主进程 | `createElectronMainThreadLauncher()` | `createElectronMainThreadChannelFactory({ scheduler })` |
| Electron 渲染进程 | `createElectronRendererThreadLauncher({ report })` | `createElectronRendererThreadChannelFactory({ scheduler })` |

Deno Worker 需要相应权限；Bun、Deno、浏览器与 Electron 渲染进程沿用 Web Worker 的终止边界（第 3 节）。

### 自定义 Worker 构造与通道

以下导出面向需要自行控制 Worker 构造的运行时适配器作者。普通应用使用第 3 节的短形式即可。浏览器 bundler 只识别源码中的字面量 Worker 构造；库的 URL 短形式不保证自动生成 Worker chunk。

| 导出                                                      | 用途                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `createWebThreadLauncher({ Worker, report })`             | 用你提供的 Worker 构造函数创建 Web Worker（例如 polyfill 或受限环境中的构造器）            |
| `createWebThreadChannelFactory({ scheduler })`            | 与上面的 launcher 配套                                                                      |
| `createAdapterNodeThreadLauncher(runtime, options)`       | 用自定义的 Node 运行时资源（`IThreadRuntimeResource`）创建 Worker                          |
| `createAdapterNodeThreadPeer(options, parentPort, data)`  | Worker 一侧：用你持有的 `parentPort` 与 `workerData` 建立 Peer                              |
| `createNodeThreadChannel`、`createWebThreadChannel`       | 在借用端口上构造通道；固定基础能力同步返回，扩展 `capabilities` 等待 Core 双边 ACK          |
| `receiveThreadData`、`readThreadBootstrap`                | 读取并校验 launcher 写入的 bootstrap 数据                                                   |

launcher 返回的 handle 提供 `identity`、`port`、`exited`、`terminate`、`sampleUsage` 与 `open(signal, { scheduler })`。`open` 在该 Worker 的端口上完成能力确认并返回协议通道：

```ts doc-test=check
import { createNodeThreadLauncher } from '@migaia/rpc-threads/adapters/node'
import type { IThreadSpec } from '@migaia/supervision/threads'
import type { INativeAbortSignal } from '@migaia/utils'
import type { IScheduler } from '@migaia/utils/scheduler'

/** 调用方提供真实入口与生命周期；返回后负责关闭 channel、terminate 并等待 exited。 */
export async function openWorkerChannel(
  threadSpec: IThreadSpec,
  signal: INativeAbortSignal, // launch() 需要宿主原生 AbortSignal
  scheduler: IScheduler
) {
  const launcher = createNodeThreadLauncher()
  const handle = await launcher.launch(threadSpec, { signal })
  try {
    const channel = await handle.open(signal, { scheduler })
    return { handle, channel }
  } catch (primary) {
    handle.terminate()
    await handle.exited
    throw primary
  }
}
```

新消息适配器使用 `@migaia/rpc-core/adapter` 的 `defineMessageAdapter`，完整示例见 [Core 的“编写一个适配器”](../rpc-core/USEGUIDE.md)。本包也通过该 SDK 从实际端口组装 Peer 与 Plugin。上面的原生构造保留 Worker、启动 bootstrap 和原能力 ACK 的所有权；复杂原生组合使用 `@migaia/rpc-core/adapter/internal-advanced`，不接受“已协商 / 已信任”的声明。

## 9. 常见问题

**Worker 文件单独运行时报配置错误？**
自动来源只在库 launcher 创建的 Worker 中成立。

**传了 `ArrayBuffer`，为什么原 buffer 还在？**
默认按值复制。零拷贝转移需要 `transfer` 及相应配置（第 5 节）。

**能在两个已有的 `MessagePort` 之间直接建立 Peer 吗？**
可以。双方的 `connect` 使用 `createNodeThreadChannel` 或 `createWebThreadChannel`，并传入 `context.capabilities`（第 3 节末尾）。双方同时启动，能力确认由 Core 在实际端口上完成。

**Worker 崩溃后会自动重启吗？**
取决于 `supervisor.restart` 策略。使用 `createThreadPlugin` 时，可经 `host.thread.restart(name)` 手动重启，或用 `list` / `get` 查询当前代次与退出信息。
