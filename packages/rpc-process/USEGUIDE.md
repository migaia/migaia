# `@migaia/rpc-process` 使用手册

本手册覆盖本包的全部公开能力。安装、定位和最短示例见 [README](./README.md)。调用语义（超时、取消、分组、幂等、错误还原）由 `@migaia/rpc-core` 统一实现，本手册只讲在进程场景下怎么用；更底层的 Endpoint 组装见 [rpc-core USEGUIDE](../rpc-core/USEGUIDE.md)。

## 目录

1. [导入与平台适配器](#1-导入与平台适配器)
2. [子进程端：自动连回父进程](#2-子进程端自动连回父进程)
3. [spawn 来源：启动并拥有子进程](#3-spawn-来源启动并拥有子进程)
   - [Running the child in an external sandbox](#running-the-child-in-an-external-sandbox)
4. [调用 API](#4-调用-api)
5. [连接已运行的服务：connect 与 listen](#5-连接已运行的服务connect-与-listen)
6. [交给 PluginHost 管理：createProcessPlugin](#6-交给-pluginhost-管理createprocessplugin)
7. [容量、背压与诊断](#7-容量背压与诊断)
8. [错误处理](#8-错误处理)
9. [各平台说明](#9-各平台说明)
10. [高阶用法：自己提供字节通道](#10-高阶用法自己提供字节通道)
11. [常见问题](#11-常见问题)

---

## 1. 导入与平台适配器

工厂、类型与错误码都从包根导入；平台相关的能力从 `./adapters/*` 导入。只导入你实际运行的平台，其它平台的依赖（例如 `electron`）不会被加载。

```ts doc-test=check
import {
  createProcessPeer,
  createProcessPlugin,
  createProcessTransport,
  createNativeProcessOffer,
  RpcProcessErrorCode,
  RPC_PROCESS_ERROR_SOURCE
} from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '@migaia/rpc-process/adapters/node-socket'
```

| 子路径                                  | 主要导出                                                                  | 用途                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `./adapters/node-child-process`         | `createNodeProcessLauncher`、`openProcessStdioChannel`                    | 父进程启动 Node 子进程；子进程手动打开自己的 stdio 通道 |
| `./adapters/node-socket`                | `dialProcessByteChannel`、`listenProcessByteChannel`                      | 本机 TCP 回环、Unix socket、Windows 命名管道            |
| `./adapters/bun-spawn`                  | `createBunProcessLauncher`、`openProcessStdioChannel`                     | Bun 下启动子进程                                        |
| `./adapters/bun-socket`                 | `dialProcessByteChannel`、`listenProcessByteChannel`                      | Bun 下的本机 socket                                     |
| `./adapters/deno-command`               | `createDenoProcessLauncher`、`openProcessStdioChannel`                    | Deno 下用 `Deno.Command` 启动子进程                     |
| `./adapters/deno-socket`                | `dialProcessByteChannel`、`listenProcessByteChannel`                      | Deno 下的本机 socket                                    |
| `./adapters/electron-utility-process`   | `createElectronUtilityProcessLauncher`                                    | Electron 主进程启动 utility process（消息通道）         |
| `./adapters/windows-job`                | `createWindowsJobProcessLauncher`                                         | 占位，当前 `launch` 一律拒绝（见第 9 节）               |

## 2. 子进程端：自动连回父进程

子进程入口只需要调用 `createProcessPeer`，并在 `provide` 中声明可被调用的方法：

```ts doc-test=run group=process-use-auto file=service.ts
import { createProcessPeer } from '@migaia/rpc-process'

await createProcessPeer({
  provide: {
    math: { double: (value: number) => value * 2 },
    feed: {
      // async generator 方法可以被对端用 stream() 逐项读取
      count: async function* (limit: number) {
        for (let index = 1; index <= limit; index++) yield index
      }
    }
  },
  report: (error) => console.error(error)
})
```

父进程同组示例：

```ts doc-test=run group=process-use-auto file=main.ts
import { createProcessPeer } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number }; feed: { count(limit: number): AsyncIterableIterator<number> } }
const service = await createProcessPeer<IServiceApi>({ spawn: new URL('./service.ts', import.meta.url) })
try {
  console.log(await service.request('math.double', 21)) // 42
  for await (const value of service.stream('feed.count', 3)) console.log(value) // 1 2 3
} finally { await service.close() }
```

- **自动来源的前提**：省略 `spawn` / `connect` / `listen` 只在"本进程由库的 launcher 启动"时成立。launcher 会通过环境变量（`PROCESS_RUNTIME_API_ENV`）和 bootstrap 把父端信息交给子进程。直接用 `node service.js` 运行这个文件会在配置阶段拒绝。想让一个独立运行的服务被连接，用第 5 节的 `listen`。
- **`provide` 的规则**：只读取对象自身的可枚举数据属性。嵌套对象生成点分路径（`math.double`），getter、循环引用、重复路径或非法名字会在建立连接前被拒绝。普通函数通过 `request` / `notify` 调用，返回值必须可移植（可被 JSON 表示的数据，或协商后的 `ArrayBuffer` / `Uint8Array`）；返回 iterable 或 async iterable 的方法通过 `stream` 调用。
- **反向调用**：子进程得到的也是一个 Peer。父端同样可以 `provide` 方法，子进程用 `request` 调用父端。
- **生命周期**：子进程的 Peer 会保持事件循环存活，直到父端关闭连接。

## 3. spawn 来源：启动并拥有子进程

普通 TS 子进程用 `spawn: './service.ts'` 或 `spawn: new URL('./service.js', import.meta.url)`；`spawn: true` 重跑主入口。

```ts doc-test=run group=process-use-self file=main.ts
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IEchoApi = { echo(value: string): string }
if (isProcessChild()) await createProcessPeer({ provide: { echo: (value: string) => value } })
else {
  const child = await createProcessPeer<IEchoApi>({ spawn: true })
  try { console.log(await child.request('echo', 'hello')) } finally { await child.close() }
}
```

`isProcessChild()` 只表示本入口由既有 launcher bootstrap 启动，不授予信任。它在发现过程消费 env 标记后仍返回 `true`。子进程执行整个模块，包括顶层初始化；应把父进程启动逻辑放进 `else`。

相对字符串按主入口目录解析；显式 URL 不受当前工作目录影响。短对象可用 `{ entry: './service.ts', base: import.meta.url }` 指定基准。Node/Bun 保留 runtime flags 与 loader，移除 eval/print/test 控制参数，所以父入口的 loader 会继续生效；Node 原生类型剥离不解析 `.js` 指向 `.ts` 的 imports，Node/Deno 此类项目要构建输出或 loader，Bun 可直接解析。失败保留原监督错误及其 cause 与 stderr 诊断，不把错误改成成功。

自派生不支持 REPL、eval、Electron、测试运行器及无可用主模块的单文件可执行程序；传精确 URL 或 `{ command, args }`。Deno 默认用 `run` 与 bootstrap 的 env 权限；额外权限通过显式 command/args 提供。

短对象的 `args`、`cwd`、`env`、`stdio`、`limits`、`permissions`、`supervision` 可以覆盖默认值；`wrap` 可包装计算出的启动命令。默认每源创建一个 process budget、随机 stdin token、byte channel 与 best-effort supervisor。省略 `report` 使用 `console.error`；默认终止能力提示每进程只报一次，`onNotice` 接收原提示对象。完整来源不改变现有行为。

### Running the child in an external sandbox

短对象的 `wrap(command)` 接收 rpc 按当前 Node、Bun 或 Deno 运行时计算出的 `IProcessLaunchCommand`，返回新的 `command`、`args`、`cwd` 与 `env`。首次启动、每次 restart 和 replace 都调用一次；自定义 `supervision.launcher` 也经过这个回调。rpc 不导入沙箱工具，也不提供沙箱配置文件，安装与策略由应用负责。

macOS 上可用 `sandbox-exec` 加载应用自己维护的 profile。下面保留原运行时命令、参数、工作目录与环境设置；应用的 profile 必须允许子入口及其依赖所需的读取：

```ts
import { createProcessPeer } from '@migaia/rpc-process'

/** The application owns this profile and its permitted filesystem operations. */
const profile = '/absolute/path/to/application.sb'
/** The peer owns the sandboxed child and closes it with the original launcher. */
const child = await createProcessPeer<{ echo(value: string): string }>({
  spawn: {
    entry: new URL('./service.ts', import.meta.url),
    /** Keep runtime detection and wrap only the resulting command. */
    wrap: (command) => ({
      ...command,
      command: '/usr/bin/sandbox-exec',
      args: ['-f', profile, command.command, ...command.args]
    })
  }
})
try { console.log(await child.request('echo', 'hello')) } finally { await child.close() }
```

Linux 上可用 `bwrap`。这个例子把现有文件系统挂为只读，提供 `/proc` 与 `/dev`，并隔离网络；需要写入的应用应按自己的策略增加可写挂载：

```ts
import { createProcessPeer } from '@migaia/rpc-process'

/** The peer owns the child launched through the application's bubblewrap policy. */
const child = await createProcessPeer<{ echo(value: string): string }>({
  spawn: {
    entry: new URL('./service.ts', import.meta.url),
    /** Preserve the original runtime arguments, cwd and environment. */
    wrap: (command) => ({
      ...command,
      command: '/usr/bin/bwrap',
      args: [
        '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev',
        '--unshare-net', '--die-with-parent', '--', command.command, ...command.args
      ]
    })
  }
})
try { console.log(await child.request('echo', 'hello')) } finally { await child.close() }
```

`./service.ts` 使用第 2 节的自动来源模式，并在 `provide` 中声明 `echo`。以上都是平台示例，运行前由应用安装相应工具并准备自己的策略。

包装器必须遵守两个规则：

- **stdin/stdout 直接连到子进程。** stdin 承载 token bootstrap，随后 stdin/stdout 承载 RPC 字节通道；不要分离、消费这些流或把包装器日志写到 stdout。
- **完整转发子进程环境与退出码。** 保留 `env.inherit` 和 `env.set`；原生 launcher 在 `wrap` 返回后才加入 `PROCESS_RUNTIME_API_ENV`（`MIGAIA_RPC_RUNTIME_API_BOOTSTRAP`）。容器包装器要用例如 `-e MIGAIA_RPC_RUNTIME_API_BOOTSTRAP` 把该变量转入容器，同时转发其余环境变量。包装器应返回子进程的原退出码，不能把非零退出改成成功；这让监督层正确区分正常退出与崩溃。

`wrap` 不接收 `stdio`、`bootstrap`、`limits` 或 `permissions`，返回对象中的这些额外字段会被忽略。完整 `kind: 'spawn'` 来源继续由调用方直接持有 `supervision.launcher` 与 `spec`。

非函数 `wrap` 在准备来源时拒绝。回调抛错或返回非法字段会使本次启动失败，带 `PROCESS_PLUGIN_INVALID_OPTION` 的原生 `TypeError` 位于 supervision 的 `LAUNCH_FAILED` cause 链上；回调抛出的原值保留在该 `TypeError.cause`。经 `host.use` 安装时，最外层仍是 `PLUGIN_INSTALL_FAILED`。

`spawn` 对象把四件事组合在一起：**怎么启动**（`supervision`）、**拿哪条通道**（`rawChannel`）、**怎么握手**（`establish`）、**用什么凭据**（`token`）。README 的“高阶用法”直接展示完整来源对象，下表解释每个字段。

| 字段                       | 说明                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `kind: 'spawn'`            | 固定值，表示对象形式的 spawn 来源。                                                                                         |
| `channelKind`              | `'byte'`（stdio / socket 字节流）或 `'message'`（Electron utility process 等消息通道）。                                     |
| `wire`                     | `'native'`（默认，本库协议）或 `'jsonrpc'`（对端是 JSON-RPC 实现，见 rpc-bridge-jsonrpc）。                                  |
| `token`                    | 会话凭据。经 bootstrap 交给子进程，握手时双方用它认证。每次部署随机生成，不要打印或写入日志。                               |
| `supervision.id`           | 该执行单元在监督与查询中的标识。                                                                                            |
| `supervision.launcher`     | 平台 launcher。`rawChannel` 读取本次启动实际返回的 handle。                                                            |
| `supervision.budget`       | `createUnitBudget({ kind: 'process', maxUnits })`：限制同时存在的子进程数量。这是应用层计数，不是操作系统资源限制。         |
| `supervision.isolation`    | `'best-effort'` 或 `'required'`。`required` 要求 launcher 声明必需能力受到保证；Node 的整树终止能力不满足，只能用 `best-effort`。 |
| `supervision.spec`         | 启动规格：`command`、`args`、`env`（`inherit` 继承的变量名、`set` 设置的变量）、`stdio`、`bootstrap`，以及可选的 `limits`。 |
| `supervision.spec.stdio`   | stdio 走通道时用 `{ stdin: 'channel', stdout: 'channel', stderr: 'drain' }`；stderr 会被持续读取并做限流诊断（第 7 节）。   |
| `supervision.spec.bootstrap` | `{ via: 'stdin', payload }`：启动后先把 payload（通常是 token）写给子进程，再开始协议握手。                               |
| `supervision.spec.limits.callWallTimeMs` | 可选，单次调用的墙钟上限。它会压低任何调用自己设置的超时。                                                 |
| `rawChannel(handle)`       | 返回 launcher 为这次启动建立的原始通道。                                                                                    |
| `establish(raw, prepared)` | 在原始通道上完成握手，返回协议通道。用 `createProcessTransport`，并传入 `prepared` 里的 `offer`、`scheduler` 与会话信息。    |

还有两个可选字段：`offer` 用来手动收窄本端能力提议，一般不需要；`supervision.restart`、`health` 等监督策略见 [`@migaia/supervision`](../supervision/README.md)。

**高级回调形式**：`spawn` 也可以是 `async (context) => sourceResult`，由你自己启动执行单元并返回已完成协商的通道。这种形式不经过 supervision，Peer 不会获得 stop / restart / replace 能力，一般只在自定义运行时中使用。

## 4. 调用 API

`createProcessPeer<TRemote>()` 返回的 Peer 提供以下方法。传入远端方法类型 `TRemote` 后，方法路径、参数和返回值都有类型检查。

| 方法                                 | 返回                                    | 说明                                                                                     |
| ------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `request(method, payload?, options?)` | `Promise<结果>`                         | 调用并等待结果。                                                                         |
| `notify(method, payload?, options?)` | `Promise<void>`                         | 只发送，不等业务结果。Promise 完成仅表示已发出，**不代表对端执行成功**。                 |
| `stream(method, payload?, options?)` | `AsyncIterableIterator`                 | 惰性：第一次 `next()` 前不发送。提前 `break` / `return()` 会通知对端结束生产。            |
| `group(steps, options?)`             | `Promise<步骤结果数组>`                 | 一组 request 按顺序执行；某步失败后，其余步骤为 `not-executed`。**不回滚**已执行步骤。   |
| `outcome(idempotencyKey)`            | `Promise<{ state, … }>`                 | 查询带 `idempotencyKey` 的调用状态：`pending`、`done`（含结果）或 `unknown`。             |
| `describe(options?)`                 | `Promise<对象>`                         | 本端身份、已接受的连接与方法目录。本地查询，不发网络请求。                               |
| `close()`                            | `Promise<void>`                         | 停止接受新调用，已接受的调用继续完成，然后关闭连接；spawn 来源还会停止子进程。重复调用返回同一个 Promise。 |

示例：

```ts doc-test=check
import type { IRuntimeTypedPeer } from '@migaia/rpc-process'

type IActionApi = {
  math: { double(value: number): number }; log: { note(value: string): void }
  feed: { count(limit: number): AsyncIterableIterator<number> }; fail: { boom(): void }
}
/** The application already owns this peer; the idempotency examples need a matching server declaration. */
declare const service: IRuntimeTypedPeer<IActionApi>

await service.notify('log.note', 'hello')

for await (const item of service.stream('feed.count', 3)) console.log(item) // 1 2 3

const steps = await service.group([
  { method: 'math.double', payload: 1 },
  { method: 'fail.boom' },
  { method: 'math.double', payload: 3 }
])
// [{ state: 'success', result: 2 }, { state: 'failure', error: {…} }, { state: 'not-executed' }]

await service.request('math.double', 5, { idempotencyKey: 'order-42' })
await service.outcome('order-42') // { state: 'done', outcome: { completion: { ok: true, result: 10 } }, … }
```

### 调用选项

| 选项              | 类型                   | 说明                                                                                                   |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `timeoutMs`       | `number \| false`      | 截止时间。默认 30000 ms（可用工厂的 `defaultTimeoutMs` 修改）；`false` 关闭默认超时；`0` 表示立即到期。 |
| `signal`          | `AbortSignal`          | 取消。取消是协作式的：本地放弃等待，不保证对端没有开始执行。                                          |
| `idempotencyKey`  | `string`               | 幂等键。同键重复调用复用已保留的结果；可用 `outcome(key)` 查询。                                       |
| `orderKey`        | `string`               | 同一 `orderKey` 的调用在对端按发送顺序串行执行。                                                       |
| `cancel`          | `'before-start'`       | 取消时，若对端尚未开始执行则撤销；若已开始，仍等待并返回真实结果。                                     |

进程间调用不支持 `transfer`（零拷贝转移只在 Worker 中可用）；传入 `transfer` 属性（哪怕是空数组）会被拒绝。`ArrayBuffer` / `Uint8Array` 作为普通数据传输时会被复制。

### 类型

```ts doc-test=run group=process-use-typed file=main.ts
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = {
  math: { double(value: number): number }
  feed: { count(limit: number): AsyncIterableIterator<number> }
}
if (isProcessChild()) {
  await createProcessPeer({ provide: {
    math: { double: (value: number) => value * 2 },
    feed: { count: async function* (limit: number) { for (let value = 1; value <= limit; value++) yield value } }
  } })
} else {
  const service = await createProcessPeer<IServiceApi>({ spawn: true })
  try {
    const result: number = await service.request('math.double', 21)
    console.log(result) // 42
    for await (const value of service.stream('feed.count', 3)) console.log(value) // 1 2 3
  } finally { await service.close() }
}
```

不传泛型时没有可调用的方法类型。需要按字符串动态调用时，用 `IRuntimeDynamicSurface`：它只放宽编译期检查，运行时仍按对端实际目录拒绝未知方法。

## 5. 连接已运行的服务：connect 与 listen

普通名称自动映射同一用户的本机端点，适合独立启动的程序。连接端先启动时，默认等最多 5000 ms；`connectTimeoutMs` 修改这个等待上限。

```ts doc-test=run group=process-use-named file=main.ts
import { createProcessPeer } from '@migaia/rpc-process'

type IMathApi = { math: { double(value: number): number } }
const server = await createProcessPeer({ listen: 'math-service', provide: { math: { double: (value: number) => value * 2 } } })
const client = await createProcessPeer<IMathApi>({ connect: 'math-service' })
try { console.log(await client.request('math.double', 21)) } finally { await client.close(); await server.close() }
```

POSIX named endpoint 使用 0700 用户目录与 0600 socket，并复用已有 Unix owner record；第二个同名 listener 拒绝，只有相同服务的崩溃遗留 inode 可以回收。Node-compatible socket API 未提供 peer-credential 读取接口，因此访问控制来自 OS 文件权限。这个边界允许**该用户的任何进程**接入；显式 `token` 可以进一步限制同用户应用。TCP、显式 socket 路径及本 adapter 未提供 ACL 的 Windows named pipe 必须给 token。内部 same-user hello 标记是公开协议值，不是 secret，也不代替 OS 权限。

```ts doc-test=run group=process-use-tcp file=main.ts
import { createProcessPeer } from '@migaia/rpc-process'

const token = 'local-example-secret'
const server = await createProcessPeer({ listen: 'tcp://127.0.0.1:4000', token, provide: { echo: (value: string) => value } })
const client = await createProcessPeer<{ echo(value: string): string }>({ connect: 'tcp://127.0.0.1:4000', token })
try { console.log(await client.request('echo', 'hello')) } finally { await client.close(); await server.close() }
```

完整监听与连接来源如下。

当服务进程不是由你启动的（例如常驻守护进程），服务端用 `listen` 接受连接，客户端用 `connect` 连接。两端都通过握手认证：服务端的 `verify` 校验客户端提供的 `token`。

**地址格式**：`tcp://127.0.0.1:<port>` 或 `tcp://[::1]:<port>`（只允许回环地址），Unix socket 绝对路径（以 `/` 开头），Windows 命名管道（`\\.\pipe\name`）。端口写 `0` 时由系统分配，实际地址由 `listen` 返回。

### 高阶：完整 socket 来源

这一组在同一程序中创建服务端与客户端，实际地址从原 listener 返回，关闭时分别释放连接和 listener。独立部署时，应用将该地址与凭据交给客户端。

```ts doc-test=run group=process-use-full-socket file=main.ts
import { createNativeProcessOffer, createProcessPeer, createProcessTransport, type IProcessServeListenerIngress } from '@migaia/rpc-process'
import { dialProcessByteChannel, listenProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'

type IServerApi = { math: { double(value: number): number } }
const report = (error: unknown) => console.error(error)
/** This example credential is local fixture data; production callers use their credential owner. */
const token = 'full-socket-example'
/** The actual listener publishes its selected ephemeral port before client construction. */
let address = ''
/** Independent accepted connections receive distinct diagnostic labels. */
let sequence = 0
const ingress: IProcessServeListenerIngress = {
  kind: 'listener', address: 'tcp://127.0.0.1:0',
  listen: async (options) => {
    const listener = await listenProcessByteChannel(options)
    address = listener.address
    return listener
  },
  verify: (auth) => {
    if (auth !== token) throw new Error('unknown client')
    return 'math-client'
  },
  offer: createNativeProcessOffer({ peer: { id: 'math-server', runtime: 'node' }, stream: true }),
  createConnectionContext: () => {
    sequence += 1
    return { peerId: `client-${sequence}`, ipc: { connectionId: `conn-${sequence}`, sessionId: `session-${sequence}`, log: () => undefined } }
  }
}
const server = await createProcessPeer({ listen: ingress, provide: { math: { double: (value: number) => value * 2 } }, report })
try {
  const client = await createProcessPeer<IServerApi>({
    report,
    connect: {
      kind: 'connect', address, token,
      dial: (value, signal) => dialProcessByteChannel({ address: value, signal: signal as AbortSignal }),
      establish: (raw, prepared) => createProcessTransport(raw as import('@migaia/rpc-process').IProcessByteChannel, {
        role: 'initiator', offer: prepared.offer!, peerId: 'math-server', scheduler: prepared.scheduler,
        signal: prepared.signal, ipc: { ...prepared.session, log: () => undefined }, report
      })
    }
  })
  try { console.log(await client.request('math.double', 21)) } finally { await client.close() }
} finally { await server.close() }
```

省略 `createNativeProcessOffer` 的 `capabilities` 时，监听端根据 Core 已安装的能力生成 runtime 提议。显式传入 `capabilities`（包括空数组）仍表示调用方选择的窄提议，库不会拓宽它。

**凭据错误时**：客户端的 `createProcessPeer` 以 `@migaia/rpc/remote` / `REMOTE_START_FAILED` 拒绝，服务端的 `report` 收到 `@migaia/rpc/process` / `PROCESS_CHANNEL_AUTH_REJECTED`。不要用同一个错误凭据重试。

**要点：**

- 每个接入的客户端都是独立会话，有各自的 `peerId` 和身份。服务端可以对某个会话反向调用；会话 principal 来自 `verify` 的返回值，而不是客户端自报的字段。
- `connect` 可选 `supervision`（`restart`、`startupTimeoutMs`、`health` 等）：只用于重建本端连接，不会拥有或重启对端进程。
- Unix socket 监听时会写一个属主记录文件，用来识别并回收崩溃遗留的同名 socket；属于其它服务的路径会被拒绝。

## 6. 交给 PluginHost 管理：createProcessPlugin

`createProcessPlugin` 接受与 Peer 相同的来源和 `provide`，另加 `name`（Host 内的连接名）与可选的 `expose`。它返回一个插件，由 `host.use` 安装，然后经 `host.process` 出口调用：

```ts doc-test=run group=process-use-plugin file=main.ts
import { defineHost } from '@migaia/plugin-host'
import { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number } }
if (isProcessChild()) {
  await createProcessPeer({ provide: { math: { double: (value: number) => value * 2 } } })
} else {
  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({ name: 'service', spawn: true })
  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(service)
    console.log(await host.process!.request('service', 'math.double', 21)) // 42
    console.log((await host.process!.list()).connections.map((connection) => connection.kind)) // ['spawn']
  } finally { await host.dispose() }
}
```

`host.process` 出口的方法：

| 方法                                                | 说明                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `request` / `notify` / `stream` / `group` / `outcome` | 与 Peer 相同，第一个参数是目标：连接名，或 `{ name, instanceId }`（同名多实例时必须精确指定） |
| `list(options?)` / `get(target, options?)`          | 查询连接、身份、代次、健康与退出信息；拿不到的事实返回 `unavailable`，不会伪造为 0      |
| `on(event, listener)` / `watch(options?)`           | 订阅生命周期事件；`on` 返回可重复调用的取消函数，`watch` 是有界异步迭代器                 |
| `broadcast(...)`                                    | 对多个目标调用并汇总各自结果；不保证全部成功                                             |
| `stop` / `kill` / `restart` / `replace`             | 只对 spawn 来源有效；对 connect / listen 来源调用会以 `CAPABILITY_CONFLICT` 拒绝          |

**`expose`**：默认为空，即不把本端 Host 的任何方法公开给子进程。要让子进程调用本端某个 Feature 的方法，显式列出路径，例如 `expose: ['parent.echo']`；只列出的方法可见，`expose: ['math.add']` 不会顺带公开 `math.sub`。

**`replace`**：用新的 spec 启动后继进程并切换流量。正在执行的调用仍在原进程中完成，不会被转移到新进程。

## 7. 容量、背压与诊断

- **并发上限**：每个对端最多 64 个、全局最多 256 个同时执行的入站调用。超出时调用方收到 `@migaia/rpc/core` / `OVERLOADED`，对端函数不会被调用。可在工厂选项 `providerLimits` 中调整 `maxPerPeer`、`maxGlobal`，并用 `onRejected` 观察被拒绝的调用及其原因。
- **单帧上限**：握手帧不超过 `PROCESS_HANDSHAKE_MAX_FRAME_BYTES`；业务消息受协议帧上限约束，超限时以 `FRAME_LIMIT_EXCEEDED` 拒绝。大数据请分批发送，或用 `stream` 逐项传输。
- **stderr 限流**：子进程 stderr 被持续读取，避免管道写满阻塞子进程。每个会话每 1000 ms 最多产生 32 条 `ipc.stderr` 诊断记录；超出部分合并为一条带 `droppedChunks` 计数的摘要，文本经过脱敏。
- **健康检查**：native 协议的连接默认启用 ping 健康检查；连续失败时报告 `PROCESS_HEALTH_PING_FAILED`，由监督策略决定是否重启。`wire: 'jsonrpc'` 时默认不启用 ping。
- **连接治理**：`createProcessResilience` 用于自定义连接数、调用速率、payload 上限，以及实例不健康时的挂起与清算策略。超限时以 `PROCESS_CONNECTION_LIMIT` 拒绝，同样发生在对端函数执行之前。

## 8. 错误处理

### 错误的形状

所有错误都是原生 `Error`（或其子类），并附带 `source` 与 `code` 属性。原始原因保留在 `cause` 链上。请按 `(source, code)` 分支，不要匹配 `message` 文本。

```ts doc-test=check
import type { IRuntimeTypedPeer } from '@migaia/rpc-process'

/** Error handling continues an established application-owned connection. */
declare const service: IRuntimeTypedPeer<{ math: { double(value: number): number } }>

import { RPC_PROCESS_ERROR_SOURCE, RpcProcessErrorCode } from '@migaia/rpc-process'

try {
  await service.request('math.double', 21, { timeoutMs: 1000 })
} catch (error) {
  const { source, code } = error as { source?: string; code?: string }
  if (source === '@migaia/rpc/core' && code === 'DEADLINE_EXCEEDED') {
    // 超时：对端可能仍在执行，先对账再决定是否重试
  } else if (source === RPC_PROCESS_ERROR_SOURCE && code === RpcProcessErrorCode.channelClosed) {
    // 通道已关闭：需要新建连接
  } else throw error
}
```

**对端业务错误**会被还原为原生类型：子进程抛出 `RangeError('bad input')`，父端收到的也是 `RangeError`，`message` 与 `stack` 保留；它没有 RPC 的 source / code（显示为 `unknown` / `UNKNOWN`）。

### 本包错误码

source 均为 `@migaia/rpc/process`。

| code                                 | 何时发生                                         | 建议处理                                                           |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| `PROCESS_HANDSHAKE_TIMEOUT`          | 握手未在 `handshakeTimeoutMs` 内完成             | 关闭这次尝试，在总时间预算内重新建立连接                           |
| `PROCESS_CHANNEL_AUTH_REJECTED`      | 凭据未通过对端认证                               | 修正 token 或认证配置；不要用同一凭据重试                          |
| `PROCESS_CHANNEL_CLOSED`             | 在已关闭的通道上继续调用                         | 新建连接；在途调用结果未知，先对账                                 |
| `PROCESS_CHANNEL_CONNECT_FAILED`     | 拨号或启动失败（地址不可达、权限、可执行文件不存在） | 查看 `cause`，修正后按退避重连                                  |
| `PROCESS_CHANNEL_LISTEN_FAILED`      | 本地监听无法绑定（端口占用、路径属于其它服务）   | 换地址或清理占用                                                   |
| `PROCESS_PLUGIN_INVALID_OPTION`      | 插件或来源选项不合法                             | 修正对应字段；原样重试无效                                         |
| `PROCESS_HOST_INVALID_OPTION`        | Host 相关选项不合法                              | 修正对应字段                                                       |
| `PROCESS_HOST_CLOSED`                | 出口已开始释放，仍向其提交工作                   | 使用新的 Host 或 Peer                                              |
| `PROCESS_RESILIENCE_INVALID_OPTION`  | 连接治理的限额、所有权或健康配置不合法           | 修正配置                                                           |
| `PROCESS_CONNECTION_LIMIT`           | 连接数、调用速率或 payload 超限（对端未执行）    | 降低并发或数据量，在预算内重试                                     |
| `PROCESS_INSTANCE_UNHEALTHY`         | 共享目标因健康事件被挂起，后继尚未就绪           | 等待后继就绪，或处理健康事件                                       |
| `PROCESS_HEALTH_PING_FAILED`         | 健康 ping 失败                                   | 交给监督策略处理，不要另起一套重启逻辑                             |
| `PROCESS_TERMINAL_CALL`              | 注册已进入终态，拒绝新调用                       | 等待新注册就绪                                                     |
| `PROCESS_LIQUIDATED`                 | 注册已被清算，不能再重启                         | 创建新的注册                                                       |
| `PROCESS_USAGE_SAMPLE_FAILED`        | 采样子进程 CPU / 内存失败                        | 显示为不可用；不影响进程生命周期                                   |

### 常见的调用层错误

source 均为 `@migaia/rpc/core`。

| code                  | 含义                                     | 建议处理                                                            |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| `DEADLINE_EXCEEDED`   | 超时（`TimeoutError`）                   | 对端可能已执行；带 `idempotencyKey` 时用 `outcome` 查询，否则业务对账 |
| `CANCELLED`           | 被 `signal` 取消（`AbortError`）         | 同上：本地取消不代表对端未执行                                      |
| `OVERLOADED`          | 对端并发额度已满，函数未被调用           | 降低并发，带抖动退避后重试                                          |
| `PROVIDER_NOT_FOUND`  | 对端没有这个方法                         | 检查方法路径与对端版本                                              |
| `TRANSPORT`           | 物理连接失败                             | 调用可能已送达；先对账再决定是否重发                                |

完整的调用层错误码表见 [rpc-core USEGUIDE](../rpc-core/USEGUIDE.md#10-错误码与处理)。

### 重试原则

超时、取消、断线和"结果未知"都**不能证明对端没有执行**。非幂等操作在重试前必须先确认结果：给调用加 `idempotencyKey`，失败后用 `outcome(key)` 查询；拿不到确定结果时，按业务规则对账。只有在对端确定没有执行时（例如 `OVERLOADED`、`PROCESS_CONNECTION_LIMIT`，或 `cancel: 'before-start'` 成功撤销），才可以直接重试。

## 9. 各平台说明

| 平台                     | 启动子进程                                 | 本机 socket                 | 备注                                                                                           |
| ------------------------ | ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------- |
| Node                     | `createNodeProcessLauncher`                | `node-socket`               | 整树终止为 `unsupported`，只能用 `isolation: 'best-effort'`；子进程会被终止，孙进程不保证        |
| Bun                      | `createBunProcessLauncher`                 | `bun-socket`                | 与 Node 相同的通道语义                                                                         |
| Deno                     | `createDenoProcessLauncher`                | `deno-socket`               | 子进程需要相应的 `--allow-*` 权限                                                              |
| Electron utility process | `createElectronUtilityProcessLauncher`     | —                           | 使用消息通道（`channelKind: 'message'`），需要安装 `electron`                                  |
| Windows Job              | `createWindowsJobProcessLauncher`          | —                           | **占位实现**：未经真实 Job 对象验证，`launch` 一律以 `PROCESS_CHANNEL_CONNECT_FAILED` 拒绝     |

**消息通道的能力协商**：消息通道上的固定基础能力（abort、ping、close、deadline、幂等、trace、stream、batch）无需额外握手。扩展能力（runtime 调用、二进制等）需要对端发回能力确认（ACK）：没有 ACK 或超时时只启用基础能力，实际启用的能力反映在 `agreement.capabilities` 中。

## 10. 高阶用法：自己提供字节通道

如果你有一条现成的有序字节连接（例如自定义的 IPC 或 socket），可以直接用 `createProcessTransport` 完成握手，得到协议通道，再交给 `@migaia/rpc-core` 的 Endpoint 或 Remote 组装：

```ts doc-test=check
import type { Socket } from 'node:net'
import { createProcessTransport } from '@migaia/rpc-process'
import { createAdapterSocketByteIO } from '@migaia/rpc-process/adapters/node-socket'
import { RpcCodecId, RpcPeerRuntime, RpcProtocol } from '@migaia/rpc-contract'
import { systemScheduler } from '@migaia/utils/scheduler'

/** The application supplies an already connected Duplex socket; this fragment does not dial another one. */
declare const socket: Socket
const raw = createAdapterSocketByteIO(socket)
const channel = await createProcessTransport(raw, {
  peerId: 'service', role: 'initiator',
  offer: {
    peer: { id: 'client', runtime: RpcPeerRuntime.node },
    versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
    codecs: [RpcCodecId.json], capabilities: []
  },
  scheduler: systemScheduler,
  ipc: { connectionId: 'custom-ipc', sessionId: 'session', log: () => undefined },
  report: console.error
})
try { console.log(channel.peerId) } finally { await channel.close() }
```

适配器作者可用的其它构造函数：

| 函数                                                  | 入口                            | 用途                                                   |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| `createAdapterSocketByteIO(socket)`                   | `./adapters/node-socket`        | 把 Node `Duplex` 包装成字节通道                        |
| `createAdapterChildStdio(child)`                      | `./adapters/node-child-process` | 把子进程的 stdio 管道包装成字节通道                    |
| `createAdapterProcessStdio(io)`                       | `./adapters/node-child-process` | 子进程一侧：包装自己的 stdin / stdout                  |
| `createAdapterWebByteIO(...)`                         | 包根                            | 把 Web Streams 包装成字节通道                          |
| `createAdapterProcessLaunch`、`createAdapterProcessPeer`、`createAdapterProcessPlugin` | 包根 | 为自定义运行时组装 launch、Peer 与 Plugin |

新适配器使用 `@migaia/rpc-core/adapter` 的 `defineByteAdapter` 或 `defineMessageAdapter`，让 Core 从真实 I/O 组装 Peer 与 Plugin；完整示例见 [Core 的“编写一个适配器”](../rpc-core/USEGUIDE.md)。上表的原生资源构造继续适用于自定义运行时，复杂 launch、session 与诊断组合使用 `@migaia/rpc-core/adapter/internal-advanced`。这些操作只读取实际持有的资源，不接受“已认证 / 已协商”的声明。

## 11. 常见问题

**直接运行子进程文件时报配置错误？**
自动来源只在库 launcher 启动的进程中成立。独立运行的服务请用 `listen`（第 5 节）。

**父进程退出后子进程还在？**
`close()` 或 `host.dispose()` 会停止 spawn 来源的子进程。父进程被强杀时来不及清理；子进程会检测到父连接丢失并退出。孙进程在 Node 上不保证被终止。

**能跨机器调用吗？**
不能。socket 适配器只接受回环地址、Unix socket 和命名管道。

**`notify` 成功了，为什么对端没有执行？**
`notify` 只保证消息已发出。需要确认业务结果时用 `request`。

**怎样传大文件？**
单条消息受帧上限约束。用 `stream` 分块传输，或者把文件路径传过去，由对端自己读取。


Explicit reporting policy: omitting `report` keeps the short-source default termination notice once per native process. Supplying any `report` function receives every notice, including `defaultRpcReporter` itself; wrapping the same function does not change this policy. `onNotice` receives each expected termination notice instead of the reporter when supplied. Other failures are always reported. No policy depends on function identity.
