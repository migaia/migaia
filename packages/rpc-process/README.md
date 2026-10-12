# `@migaia/rpc-process`

**跨进程 RPC。** 用一套 `request` / `notify` / `stream` 调用另一个操作系统进程里的函数。它可以是你启动的子进程，也可以是已经在运行、通过本机 socket 连接的服务。本包负责启动子进程、打开 stdio 或 socket 字节通道、认证握手和监督重启；调用语义、超时、取消、错误还原等由 `@migaia/rpc-core` 统一提供。

## 适用与不适用场景

**适用：**

- 主进程把 CPU 密集、易崩溃或需要隔离权限的工作放进子进程，并像调用本地函数一样调用它。
- 多个本机进程之间（例如 CLI 与常驻守护进程）通过 TCP 回环或 Unix socket 互相调用。
- 需要由 PluginHost 统一管理一组子进程：查询状态、监听事件、重启或替换。
- Node、Bun、Deno 或 Electron utility process 之间互通。

**不适用：**

- 同一进程内的 Worker 线程：用 [`@migaia/rpc-threads`](../rpc-threads/README.md)，可以零拷贝转移 `ArrayBuffer`。
- 浏览器内的窗口、iframe、Service Worker：用 [`@migaia/rpc-browser`](../rpc-browser/README.md)。
- Python、Go、Rust 等非 TypeScript 对端：用 [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md)，它基于本包的字节通道。
- 跨机器网络通信：socket 适配器只接受本机地址（`127.0.0.1`、`[::1]`、Unix socket 路径或 Windows 命名管道）。
- 需要严格保证"整棵进程树都被终止"：Node launcher 目前只能尽力终止（见下文）。

## 安装

```bash
pnpm add @migaia/rpc-process @migaia/rpc-core @migaia/rpc-contract
```

`@migaia/rpc-core` 与 `@migaia/rpc-contract` 是 peer 依赖，三者版本必须完全一致（当前 `0.0.7`）。运行时依赖 `@migaia/supervision`（进程监督与预算）、`@migaia/lifecycle`、`@migaia/plugin-host`、`@migaia/utils`，会随包安装。

两个可选 peer，只在用到对应子路径时才需要：

| 子路径                                  | 需要安装             |
| --------------------------------------- | -------------------- |
| `./adapters/electron-utility-process`   | `electron` ^44       |
| `./adapters/windows-job`                | `koffi` ^3.1         |

## 入口一览

| 入口                                       | 内容                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `@migaia/rpc-process`                      | `createProcessPeer`、`createProcessPlugin`、`createProcessTransport`、`createNativeProcessOffer`、`createProcessResilience`、错误码与常量 |
| `./adapters/node-child-process`            | `createNodeProcessLauncher`（Node 启动子进程）、`openProcessStdioChannel`（子进程读取自己的 stdio） |
| `./adapters/node-socket`                   | `dialProcessByteChannel`、`listenProcessByteChannel`（TCP 回环 / Unix socket / 命名管道）   |
| `./adapters/bun-spawn`、`./adapters/bun-socket` | Bun 下的同名能力（`createBunProcessLauncher` 等）                                     |
| `./adapters/deno-command`、`./adapters/deno-socket` | Deno 下的启动器与 socket                                                           |
| `./adapters/electron-utility-process`      | `createElectronUtilityProcessLauncher`（Electron utility process，消息通道）                |
| `./adapters/windows-job`                   | `createWindowsJobProcessLauncher`：**占位实现**，当前 `launch` 一律拒绝                      |

## 快速开始：启动子进程并调用它

子进程只需声明自己提供的方法。它由库的 launcher 启动时，会通过 bootstrap 自动连回父进程，不需要任何地址配置。

```ts doc-test=run group=process-readme-short file=service.ts
// service.ts（子进程入口）
import { createProcessPeer } from '@migaia/rpc-process'

await createProcessPeer({
  provide: {
    math: {
      double: (value: number) => value * 2,
      sum: (values: number[]) => values.reduce((total, value) => total + value, 0)
    }
  }
})
```

父进程只需给出入口。URL 精确指向文件；相对字符串按主入口目录解析。`.ts` 可直接运行，但 Node 的原生类型剥离不会把 `.js` imports 改写为 `.ts`：有这种 import 的项目应传构建后的 `.js`，或保留父进程的 `--import` loader。Bun 能解析该 TS 导入写法；Deno 也需要构建输出或 loader。

```ts doc-test=run group=process-readme-short file=main.ts
import { createProcessPeer } from '@migaia/rpc-process'

type IServiceApi = { math: { double(value: number): number; sum(values: number[]): number } }
const service = await createProcessPeer<IServiceApi>({ spawn: new URL('./service.ts', import.meta.url) })
try {
  console.log(await service.request('math.double', 21)) // 42
} finally {
  await service.close()
}
```

## 同一份入口派生子进程

`spawn: true` 重新执行当前主入口，包含全部顶层代码。先用 `isProcessChild()` 区分角色，避免子进程再次派生。这个函数只读已有 bootstrap 标记；真正认证仍由 stdin bootstrap 和原握手完成。Node/Bun 的 runtime flags（包括 `--import`）与程序参数会保留。

```ts doc-test=run group=process-readme-self file=main.ts
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IMathApi = { math: { double(value: number): number } }
if (isProcessChild()) {
  await createProcessPeer({ provide: { math: { double: (value: number) => value * 2 } } })
} else {
  const child = await createProcessPeer<IMathApi>({ spawn: true })
  try { console.log(await child.request('math.double', 21)) } finally { await child.close() }
}
```

REPL、`--eval`、单文件可执行程序、Electron 或测试运行器没有可用的自派生主入口时，会以注册的配置错误拒绝，不猜测调用位置。Deno 默认子入口只获得 bootstrap 所需的 env 权限；需要额外运行权限时使用显式 command/args。

## 独立进程按名称连接

名称不含 `/` 或协议。双方按 OS 用户与名称派生相同的本机端点，无需端口或通信文件。Unix 目录为 0700，socket 为 0600；当前 Node-compatible socket API 没有公开 peer-credential 读取接口，访问控制由这些 OS 权限完成。**同一用户的任何进程都能连接**；需要区分同用户程序时，双方显式设置 `token`。TCP、显式 socket 路径及没有 ACL 保证的 Windows named pipe 必须设置 token。

```ts doc-test=run group=process-readme-named file=main.ts
import { createProcessPeer } from '@migaia/rpc-process'

type IMathApi = { math: { double(value: number): number } }
const server = await createProcessPeer({ listen: 'math-service', provide: { math: { double: (value: number) => value * 2 } } })
const math = await createProcessPeer<IMathApi>({ connect: 'math-service' })
try { console.log(await math.request('math.double', 21)) } finally { await math.close(); await server.close() }
```

named `connect` 默认等待最多 5000 ms，可设 `connectTimeoutMs`。第二个同名 listener 仍以 `PROCESS_CHANNEL_LISTEN_FAILED` 拒绝；崩溃遗留 socket 只由现有 owner record 安全回收。

## 高阶用法：完整来源对象

原始 launcher、预算、bootstrap 与握手 source 仍可直接传入。下面在现有工厂中直接组合完整来源，每个来源只交给一个 Peer 或 Plugin 使用。

```ts doc-test=run group=process-readme-full file=main.ts
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createProcessPeer, createProcessTransport, type IProcessByteChannel } from '@migaia/rpc-process'
import { createNodeProcessLauncher, type INodeProcessHandle } from '@migaia/rpc-process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'

type IServiceApi = { math: { double(value: number): number; sum(values: number[]): number } }
/** The original native launcher retains all child lifetime operations. */
const launcher = createNodeProcessLauncher()
/** This fresh credential travels only through the existing stdin bootstrap and handshake. */
const token = randomBytes(32).toString('base64url')
/** Full sources explicitly retain their reporter instead of using the short-source default. */
const report = (error: unknown) => console.error(error)
const service = await createProcessPeer<IServiceApi>({
  report,
  spawn: {
    kind: 'spawn', channelKind: 'byte', wire: 'native', token,
    supervision: {
      id: 'math-service', isolation: 'best-effort', report, launcher,
      budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
      spec: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./service.ts', import.meta.url))],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      }
    },
    rawChannel: async (handle) => (handle as INodeProcessHandle).channel!,
    establish: (raw, prepared) => createProcessTransport(raw as IProcessByteChannel, {
      role: 'initiator', offer: prepared.offer!, peerId: prepared.session.processId!,
      scheduler: prepared.scheduler, signal: prepared.signal,
      ipc: { ...prepared.session, log: () => undefined }, report
    })
  }
})
try {
  console.log(await service.request('math.double', 21)) // 42
  console.log(await service.request('math.sum', [1, 2, 3])) // 6
} finally { await service.close() }
```

```ts doc-test=run group=process-readme-full file=service.ts
import { createProcessPeer } from '@migaia/rpc-process'

await createProcessPeer({
  provide: { math: { double: (value: number) => value * 2, sum: (values: number[]) => values.reduce((total, value) => total + value, 0) } }
})
```

完整来源示例的 `report` 会收到 `@migaia/supervision` / `CAPABILITY_UNSUPPORTED`（`capability: 'termination'`）。这是预期提示：Node launcher 不能保证终止孙进程。短来源的默认 `console.error` 每进程只报告一次；短对象可用 `onNotice` 显式接收每次提示，其他错误始终正常报告。

## 三种来源

每个 Peer 必须且只能选择一种来源。唯一例外是由库 launcher 启动的子进程：它省略来源时会自动连回父进程。

| 来源      | 谁拥有对端                   | `close()` 的效果             | 能否 stop / restart / replace |
| --------- | ---------------------------- | ---------------------------- | ----------------------------- |
| `spawn`   | 本 Peer（经 supervision）    | 关闭连接并停止子进程         | 能（经 PluginHost 出口）      |
| `connect` | 外部，本端只持有自己的连接   | 只关闭本端连接               | 不能                          |
| `listen`  | 外部，每个接入会话各自独立   | 停止监听并关闭已接入的会话   | 不能                          |

连接一个已在运行的服务、或让本进程作为服务端接受连接，见 [USEGUIDE 的 socket 章节](./USEGUIDE.md#5-连接已运行的服务connect-与-listen)。

## 两种所有权：Peer 与 Plugin

- **`createProcessPeer`**：独立连接，调用方负责 `close()`。适合脚本、CLI，或只有一个子进程的场景。
- **`createProcessPlugin`**：安装进 `@migaia/plugin-host`，由 Host 统一持有和释放。调用经 `host.process.request(target, method, …)`；`list` / `get` / `on` / `watch` / `stop` / `restart` / `replace` 也都在这个出口上。适合需要管理多个子进程、观察状态或热替换的应用。

## 错误

Process carrier 观察尚未实现：`createProcessTransport(...).transport.observe` 当前不存在。计划中的字节事件包含 `detail.frameBytes`（含 4 字节长度前缀的完整物理帧字节数）与 `detail.drainMs`（物理写入发生回压后等待 drain 的毫秒数），内容捕获仅在 `probe.capturing` 为 true 时启用，并保留原字节引用。Node/Bun/Deno stdio 与 socket 的帧编码、解码和 transport 由 Core 的统一字节通道持有；当前接口未暴露帧观察与真实回压等待。Electron utility process 实际使用 whole-message 通道，仍需确定其 detail 语义。完成这些接口前，不应将逻辑 send 耗时当作 `drainMs`，也不能声称 Process carrier 已支持观察。

所有错误都带 `(source, code)`，按这两个字段判断，不要依赖 `message` 文本：

- 本包错误：`source === '@migaia/rpc/process'`，`code` 取自 `RpcProcessErrorCode`，例如 `PROCESS_CHANNEL_AUTH_REJECTED`、`PROCESS_HANDSHAKE_TIMEOUT`。
- 调用层错误来自 `@migaia/rpc/core`，例如超时 `DEADLINE_EXCEEDED`（`TimeoutError`）、取消 `CANCELLED`（`AbortError`）、过载 `OVERLOADED`。
- 对端业务函数抛出的错误会还原原生类型、`message` 和 `stack`，例如子进程抛 `RangeError('bad input')`，父端收到的也是 `RangeError`。

超时、断线或"结果未知"都**不代表**对端没有执行。重试非幂等操作前请先对账，详见 [USEGUIDE 第 8 节](./USEGUIDE.md#8-错误处理)。

## 相关包

| 包                                                      | 关系                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| [`@migaia/rpc-core`](../rpc-core/README.md)             | 调用语义、Endpoint、Remote、测试工具；本包的 peer 依赖 |
| [`@migaia/rpc-contract`](../rpc-contract/README.md)     | 协议常量（`RpcCapability` 等）与 framing；peer 依赖    |
| [`@migaia/rpc-threads`](../rpc-threads/README.md)       | 同一套 API 的 Worker 版本                              |
| [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md) | 在本包字节通道上与非 TS 语言互通               |
| [`@migaia/supervision`](../supervision/README.md)       | launcher、预算、重启策略                               |

完整用法、选项说明、错误码表与高级用法见 [USEGUIDE](./USEGUIDE.md)。
