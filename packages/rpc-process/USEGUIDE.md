# `@migaia/rpc-process` 使用指南

按下面的调用或所有权任务查找。示例使用真实 Node 子进程与本机 socket，Host/监督器也来自公开工厂，不伪造原生资源或宿主。

## 按场景查找

| 场景                                 | API                       | 详细说明                                          |
| ------------------------------------ | ------------------------- | ------------------------------------------------- |
| 在真实子进程中执行函数并关闭其所有者 | `createProcessPeer`       | [完整示例](#在真实子进程中执行函数并关闭其所有者) |
| 在同一条子进程连接上使用反向调用与流 | `createProcessPeer`       | [完整示例](#在同一条子进程连接上使用反向调用与流) |
| 关闭一个客户端后仍可连接本机命名服务 | `createProcessPeer`       | [完整示例](#关闭一个客户端后仍可连接本机命名服务) |
| 把子进程服务及其释放交给 Host        | `createProcessPlugin`     | [完整示例](#把子进程服务及其释放交给-host)        |
| 让重连复用同一去重范围并隔离不同身份 | `createProcessResilience` | [完整示例](#让重连复用同一去重范围并隔离不同身份) |
| 真实子进程进入终态后拒绝新任务       | `createProcessResilience` | [完整示例](#真实子进程进入终态后拒绝新任务)       |

## 运行准备

```bash
pnpm add @migaia/rpc-process @migaia/rpc-core @migaia/rpc-contract
pnpm add @migaia/plugin-host @migaia/supervision @migaia/utils
```

每个完整示例保存为独立真实 Node 24 TypeScript 入口文件；自派生会重跑该文件，必须保留 isProcessChild 分支。命名端点场景使用 Node/POSIX 同用户权限，显式地址和 Windows 需 token。Host/治理示例直接导入第二行安装的包；本文执行结果不代表 Bun、Deno、Electron、Windows Job、外部语言对端或沙箱工具已验证。

## 在真实子进程中执行函数并关闭其所有者

主进程需要把计算移到另一个操作系统进程里，但只看到函数返回值，还无法判断代码究竟在哪里执行。

手写启动还要处理分帧、认证与清理；同一个入口重新执行时，若不先区分角色，子进程又会继续启动子进程。

先用 `isProcessChild()` 分支，子端提供方法，父端用 `spawn: true` 启动，并在 `finally` 中关闭返回的 Peer。

```ts doc-test=run
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number; pid(): number }
if (isProcessChild()) {
  await createProcessPeer({
    provide: { double: (value: number) => value * 2, pid: () => process.pid }
  })
} else {
  const child = await createProcessPeer<IServiceApi>({ spawn: true })
  try {
    console.log(await child.request('double', 21))
    console.log((await child.request('pid')) !== process.pid)
  } finally {
    await child.close()
  }
}
```

输出：

```text
42
true
```

输出依次为 `42`、`true`：计算结果为 42，返回的原生进程 id 也确实不同于父进程。

父端拥有此子进程并显式关闭；Node 自派生入口必须是真实文件，不能是 eval 或测试运行器，也不保证终止所有后代进程。

### 示例参数

spawn:true 重跑当前真实文件，isProcessChild 先分支，child 省略来源时只使用 launcher 已注入的 bootstrap。provide.double 接收 number 并返回两倍，pid 返回真实 process.pid；TRemote 只给静态业务类型。默认 defaultTimeoutMs=30000 ms，request 的 payload 是 21；finally 由拥有者 close。Node termination 仍是 best-effort，不以 PID 不同推导权限沙箱或整树终止。

## 在同一条子进程连接上使用反向调用与流

子进程处理任务时，既要调用父端持有的服务，也要把一串结果逐项交回调用方。

分别搭建单向管道，就要重复处理路由和结果对应关系；把整串结果塞进一次响应，又迫使提供方先收集全部数据。

父端通过 `provide` 提供方法，子端拿自己的 Peer 反向请求；序列方法返回异步生成器，父端通过 `stream()` 消费。

```ts doc-test=run
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IParentApi = { prefix(value: string): string }
type IChildApi = {
  label(value: string): Promise<string>
  count(limit: number): AsyncGenerator<number>
}
if (isProcessChild()) {
  const parent = createProcessPeer<IParentApi>({
    provide: {
      label: async (value: string): Promise<string> => (await parent).request('prefix', value),
      count: async function* (limit: number) {
        for (let value = 1; value <= limit; value++) yield value
      }
    }
  })
  await parent
} else {
  const child = await createProcessPeer<IChildApi>({
    spawn: true,
    provide: { prefix: (value: string) => '主端:' + value }
  })
  try {
    console.log(await child.request('label', '任务'))
    const values: number[] = []
    for await (const value of child.stream('count', 3)) values.push(value)
    console.log(values.join(','))
  } finally {
    await child.close()
  }
}
```

输出：

```text
主端:任务
1,2,3
```

输出为 `主端:任务`、`1,2,3`，证明子端等待了反向请求结果，父端也读取了流的三个值。

双向调用复用同一条已认证连接；流在开始迭代时才发送请求，`notify` 完成则只表示发送完成。

### 示例参数

两边都 provide：父端 prefix 处理字符串，子端 label 等待父 Peer 再反向 request，count 返回 1..limit 的异步生成器。spawn:true 与默认期限同上一例；stream('count',3) 首次迭代才开始，values 数组只收业务结果。子端闭包保留真实工厂 Promise，不伪造已就绪 Peer；应用仍只由父端拥有所启动子进程。

## 关闭一个客户端后仍可连接本机命名服务

一条 CLI 连接结束后，本机服务还需要继续接受后续调用方。

如果把持有连接误当成拥有服务进程或监听器，客户端清理时就可能释放其他调用方仍在使用的服务。

用唯一名称创建监听，再分别建立客户端；每个客户端先关闭自己的借用连接，最后才由服务端关闭监听。

```ts doc-test=run
import { randomUUID } from 'node:crypto'
import { createProcessPeer } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number }
const name = 'reader-' + randomUUID()
const server = await createProcessPeer({
  listen: name,
  provide: { double: (value: number) => value * 2 }
})
try {
  const first = await createProcessPeer<IServiceApi>({ connect: name })
  try {
    console.log(await first.request('double', 20))
  } finally {
    await first.close()
  }
  const second = await createProcessPeer<IServiceApi>({ connect: name })
  try {
    console.log(await second.request('double', 21))
  } finally {
    await second.close()
  }
} finally {
  await server.close()
}
```

输出：

```text
40
42
```

输出为 `40`、`42`；第一个客户端关闭后，第二个客户端仍能连接并成功调用。

此例使用 Node/POSIX 的同用户端点权限，不能区分同一用户下的不同应用；Windows 以及显式地址需要提供 token。

### 示例参数

name 用 randomUUID 避免与其它运行争用。同一普通名称由同 OS 用户派生端点，Node/POSIX 默认 0700 目录/0600 socket；这不鉴别同用户应用。listen.provide 暴露 double，两个 connect 先后各自关闭，server 最后关闭。connectTimeoutMs 默认 5000，仅 named local 对 ENOENT/ECONNREFUSED 重试；显式地址和 Windows 需 token。

## 把子进程服务及其释放交给 Host

应用安装多个服务时，需要一个所有者在退出时统一关闭它们的进程连接。

把每个子进程分散保存在局部变量里，容易漏掉清理项，也容易把服务查找与原生进程所有权混在一起。

创建带名称的进程插件，用 `host.use()` 安装，经 `host.process` 调用，并在 `finally` 中释放 Host。

```ts doc-test=run
import { defineHost } from '@migaia/plugin-host'
import { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number }
if (isProcessChild()) {
  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({
    name: 'service',
    spawn: true
  })
  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  try {
    await host.use(service)
    console.log(await host.process!.request('service', 'double', 21))
    console.log((await host.process!.list()).connections.map((entry) => entry.kind).join(','))
  } finally {
    const result = await host.dispose()
    console.log(result.cleanupComplete)
  }
}
```

输出：

```text
42
spawn
true
```

输出为 `42`、`spawn`、`true`：调用成功，出口识别出启动型连接，Host 清理也已完成。

Host 拥有已安装的子进程；两个执行预算都显式设为 `false`，表示不设上限，并非默认值，也不会回滚应用任意外部副作用。

### 示例参数

service.name='service' 是 Host 内连接名，spawn:true 复用真实自派生，未给 expose 时默认无 Host 方法反向公开。defineHost 的 host.execution.mutationTimeoutMs 和 pipelineDrainTimeoutMs 都显式 false（无上限），不是省略默认。host.use 安装，host.process.request 第一个参数选 service，list 的 kind=spawn，dispose 返回结构化 cleanupComplete；不宣称任意外部副作用回滚。

## 让重连复用同一去重范围并隔离不同身份

连接重建后，连接标签会变化，但同一个已认证身份的重试仍应指向同一份已保留结果范围。

只按连接划分会丢掉连续性；直接共用一个没有身份区分的范围，又可能把不同身份的结果混在一起。

用完整身份调用 `sessionOptions`，比较返回的存储与范围；这里仅演示配置派生，身份字段本身不构成认证。

```ts doc-test=run
import { createProcessResilience } from '@migaia/rpc-process'
import { systemScheduler } from '@migaia/utils/scheduler'

const resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })
try {
  const first = resilience.sessionOptions({
    connectionId: 'connection-1',
    sessionId: 'session-1',
    principalId: 'account-A'
  })
  const reconnect = resilience.sessionOptions({
    connectionId: 'connection-2',
    sessionId: 'session-2',
    principalId: 'account-A'
  })
  const other = resilience.sessionOptions({
    connectionId: 'connection-3',
    sessionId: 'session-3',
    principalId: 'account-B'
  })
  const admission = { token: 'operation', senderId: 'caller' }
  console.log(first.idempotency.store === reconnect.idempotency.store)
  console.log(first.idempotency.scope!(admission) === reconnect.idempotency.scope!(admission))
  console.log(first.idempotency.scope!(admission) !== other.idempotency.scope!(admission))
  console.log(first.limits.maxGlobal, first.limits.maxPerPeer)
} finally {
  await resilience.close()
}
```

输出：

```text
true
true
true
32 32
```

输出为 `true`、`true`、`true`、`32 32`：同一治理对象共用存储，相同身份保持范围，不同身份使用不同范围。

此会话默认的全局和单对端并发上限都是 `32`；应用必须在认证成功后取得 `principalId`，再把这些配置用于实际连接。

### 示例参数

createProcessResilience 必填 systemScheduler/report。三个 session identity 完整给 connectionId/sessionId/principalId；前两者只变标签，相同 account-A 仍同范围，account-B 分开。admission 的 token:'operation'/senderId:'caller' 仅是本例去重请求上下文，不是认证凭据。默认 maxConcurrentCallsPerConnection=32，所以返回 limits.maxGlobal/maxPerPeer 都是 32；必须在真实认证后使用 principalId。

## 真实子进程进入终态后拒绝新任务

受监督子进程退出，当前策略不会重启，但应用仍可能继续发送新任务。

缓存的就绪标记可能比真实进程活得更久；用诊断对象替代监督器，又会丢掉实际的生命周期边界。

把真实 Node 进程监督器登记到治理对象，等待它的终态通知，并在发送任务前执行返回的守卫。

```ts doc-test=run
import { createProcessResilience } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'

const reports: unknown[] = []
const report = (error: unknown) => {
  reports.push(error)
}
const supervisor = createProcessSupervisor({
  id: 'worker',
  launcher: createNodeProcessLauncher(),
  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
  scheduler: systemScheduler,
  report,
  isolation: 'best-effort',
  restart: { mode: 'never' },
  spec: {
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
    env: { inherit: ['PATH'], set: {} },
    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }
  }
})
const resilience = createProcessResilience({ scheduler: systemScheduler, report })
let finish: () => void = () => undefined
const terminal = new Promise<void>((resolve) => {
  finish = resolve
})
const off = resilience.onTerminal(() => {
  finish()
})
const registration = resilience.attachRegistration(
  'worker',
  {
    ownership: 'spawn-owned',
    health: 'none',
    supervisor: {
      restart: () => supervisor.restart(),
      inspect: () => supervisor.inspect(),
      dispose: () => supervisor.dispose(),
      onTerminal: (listener) =>
        supervisor.subscribe((event) => {
          if (event.type === 'terminal') listener(event)
        })
    }
  },
  { kind: 'standalone-host', release: () => supervisor.dispose() }
)
try {
  const guard = resilience.callGuard('worker')
  guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })
  await supervisor.start()
  await terminal
  console.log(resilience.inspect('worker')?.state, registration.inspect()?.health)
  try {
    guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })
  } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code !== 'PROCESS_TERMINAL_CALL') throw error
    console.log(failure.code)
  }
  off()
  const closing = resilience.close()
  console.log(closing === resilience.close())
  await closing
  console.log(resilience.inspect('worker') === undefined)
  console.log(supervisor.inspect().state)
} finally {
  off()
  await resilience.close()
  await supervisor.dispose()
}
```

输出：

```text
terminal none
PROCESS_TERMINAL_CALL
true
true
terminal
```

输出依次为 `terminal none`、`PROCESS_TERMINAL_CALL`、`true`、`true`、`terminal`：守卫拒绝新任务，关闭复用同一 Promise，解除治理后监督器状态仍被保留。

子进程确实以退出码 `1` 结束，重启模式为 `never`；监听回调将该终态报告标记为已处理，调用方仍负责释放原始监督器。

### 示例参数

真实 createProcessSupervisor 使用 Node launcher、maxUnits:1 budget、systemScheduler/report 和 best-effort；restart.mode='never'，spec.command 为当前 Node，args 的 -e 仅用于该直接 supervisor 的退出命令，不是 Peer 自派生入口。env 只继承 PATH，set={}，stdio 为 ignore/ignore/drain。binding 只转发真实 supervisor 方法，ownership='spawn-owned'、health='none'；standalone-host.release 指向实际 dispose。onTerminal 解除函数 off 可重复；回调正常完成表示 handled，guard.beforeDispatch 的 method/mode/generation 来自当前真实状态，治理 close 后原 supervisor 仍由 finally dispose。

## 契约细节

### 归属、安装与平台入口

本包拥有进程启动、stdio/socket 字节资源、bootstrap、来源认证和监督绑定；Core 拥有 Runtime Peer 调用、目录、超时、取消、幂等与错误还原。supervision 拥有执行单元、预算与重启，PluginHost 拥有插件安装、依赖与替换。Peer 与 Plugin 不应各建一套对同一子进程的关闭 owner。

直接安装 rpc-process、rpc-core、rpc-contract；后两者是 peer 依赖，不是“三者版本必须相等”的运行时检查。运行时依赖 plugin-host、supervision、utils。发布保留 dist/schema 和九个入口。包声明 Node>=18，本文实际执行的 TypeScript 示例使用 Node 24；没有把 Node 结果当作 Bun/Deno/Electron/Windows 验证。

| 入口                                         | 主要用途与限制                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根入口                                       | createProcessPeer、createProcessPlugin、createProcessTransport、createNativeProcessOffer、createProcessResilience、错误码/常量、字节/消息与扩展类型 |
| adapters/node-child-process                  | createNodeProcessLauncher、openProcessStdioChannel、child/process stdio 构造                                                                        |
| adapters/node-socket                         | dialProcessByteChannel、listenProcessByteChannel、createAdapterSocketByteIO                                                                         |
| adapters/bun-spawn / adapters/bun-socket     | Bun 启动、stdio 与本机 socket                                                                                                                       |
| adapters/deno-command / adapters/deno-socket | Deno.Command、stdio 与本机 socket，需宿主权限                                                                                                       |
| adapters/electron-utility-process            | createElectronUtilityProcessLauncher，实际 whole-message 通道；可选 peer electron ^44.0.0                                                           |
| adapters/windows-job                         | 可选 peer koffi ^3.1.6；当前占位，全部能力 unsupported，launch 拒绝 PROCESS_CHANNEL_CONNECT_FAILED                                                  |

只导入实际宿主入口；平台依赖在所选路径使用。进程间通信适合本机隔离任务和守护服务，不提供跨机器 socket。Worker 由 rpc-threads、浏览器窗口由 rpc-browser 负责。非 TypeScript 服务可使用 JSON-RPC 字节模式，不能把它当成原生 stream 或 transfer 支持。

### Peer 来源、短启动与 bootstrap

createProcessPeer 的 spawn/connect/listen 必须恰选一种；由本包 launcher 启动的子进程才可省略来源，通过已有发现标记与 stdin bootstrap 连回父进程。直接 node service.js 不满足此前提，应显式 listen。provide 默认无业务方法，只接受自身可枚举数据属性与嵌套方法组；点分路径如 math.double，getter、循环、重复路径和非法名字在连接前拒绝。普通函数用于 request/notify，iterable/async iterable 用 stream；payload/结果仍受 Core 可移植值契约约束。

| 来源    | 实际所有权                         | close 行为                         |
| ------- | ---------------------------------- | ---------------------------------- |
| spawn   | 经 supervision 拥有子进程及连接    | 清连接并停止所拥有子进程           |
| connect | 只拥有自己的本地连接，对端进程外借 | 清本端连接，不结束服务进程         |
| listen  | 拥有 listener 与已接纳会话         | 停接纳并关闭会话，不拥有客户端进程 |

双方可 provide 并反向调用。子进程 Peer 会保持事件循环直到父连接关闭；正常 parent-loss 路径处理子进程退出，但强杀父进程时无法承诺父端清理已执行，更不能保证孙进程都终止。

短 spawn 接受 true、入口字符串/URL 或普通对象。true 重跑当前主入口全部顶层代码，必须先 isProcessChild 分支，避免无限自派生；该函数只读既有 bootstrap 标记，发现阶段消费标记后仍为 true，不代替认证。REPL/eval/test runner、Electron 和无可用主入口的单文件程序不支持自派生，应给精确入口或显式 command/args。

| 短 spawn 字段         | 默认与作用                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| entry / base          | 相对字符串按主入口目录解析，base 可显式给基准；URL 精确指向文件，不猜调用栈                                          |
| command / args        | command 省略用当前运行时；显式 command 的 args 默认 []；spawn:true 继承程序 argv.slice(2)，其它入口的应用参数默认 [] |
| cwd                   | undefined，交由实际 launcher 处理                                                                                    |
| env.inherit / env.set | ['PATH'] / {}，不默认继承全部环境                                                                                    |
| stdio                 | {stdin:'channel',stdout:'channel',stderr:'drain'}                                                                    |
| wire                  | native；jsonrpc 需本地 contract 或自定义 establish                                                                   |
| token                 | 随机 32 字节 base64url，经 stdin bootstrap 传递，不应打印                                                            |
| supervision           | 默认每源一个 maxUnits:1 process budget、best-effort 与对应平台 launcher；可显式覆盖                                  |
| limits / permissions  | undefined，仍受实际 launcher 声明能力限制；不是自动 OS 沙箱                                                          |
| offer / establish     | 可显式收窄提议或组合真实通道；缺省复用标准 native/jsonrpc 建立路径                                                   |
| wrap                  | undefined；只包装每次实际启动的 command/args/cwd/env                                                                 |
| onNotice              | undefined；接管预期终止能力提示，不能吞掉其它启动错误                                                                |

Node/Bun 保留 runtime flags 与 --import loader，移除 eval/print/test 控制参数。Node 原生类型剥离不把 .js import 改成 .ts；这类源码使用构建后的 JS 或实际 loader，Bun 可解析其支持的 TS 导入。Deno 默认 run 仅给 PATH 与 bootstrap 标记所需 env 权限，额外权限用显式 command/args。不要把自己测试运行器的主入口当作可派生业务入口。

PROCESS_RUNTIME_API_ENV 的公开值为 MIGAIA_RPC_RUNTIME_API_BOOTSTRAP，版本标记为 '1'；它是发现信息，不是 secret。实际 bootstrap 先读 4 字节大端长度和对应内容，独立元数据封套不改变 RPC 握手语法；运行时 bootstrap 等待默认 10000 ms，之后才进入原握手截止。

Node launcher 不开 shell，只传显式环境，先开始 stderr drain 再写 bootstrap，stdout channel 不再被普通输出消费者抢读。Node 声明 fault isolation 与 stdin bootstrap enforced，但 termination、内存/CPU/permissions/fd bootstrap 不作 enforced 保证；POSIX 可尝试进程组终止，Windows 尽力停止直接子进程，均不能承诺整树必定终止。required isolation 不能当作 Node best-effort 的别名。

短来源 spawn.supervision.startupTimeoutMs 默认 10000；restart 内平铺 mode:'on-failure'、maxRestarts:5、windowMs:60000、initialDelayMs:250、factor:2、maxDelayMs:30000；stop.drainTimeoutMs/stop.reapTimeoutMs 默认均 5000。restart.mode 仅 never/on-failure/always，分别不重启、失败重启、退出后始终重启。Process managed binding 另复用 Core 5000 ms 调用 drain，并受 stop 剩余预算收窄，不保证无限等待全部不合作调用。

短来源省略 report 时，同一原生进程最多合并报告一次预期 termination unsupported 提示；显式 report 每次启动都收到，直接传默认函数与包装它没有差异。onNotice 可替代该项 reporter 调用。其它错误照常报告，完整来源保持其显式 reporter 语义。

### 外部沙箱与完整来源

wrap(command) 每次首次启动、restart、replace 都执行，接收并仅能返回 command、args、cwd、env；自定义 launcher 同样经过它。macOS 可由应用选择 sandbox-exec/profile，Linux 可选择 bwrap/只读挂载与隔离网络；本包不安装工具、不维护沙箱策略，也不把这些平台示意当作已执行验证。

包装器必须透传 stdin/stdout：stdin 先承载 token/bootstrap，再承载 RPC，stdout 只能是协议帧，日志写 stderr。保留 env.inherit/env.set；launcher 在 wrap 后加入 MIGAIA_RPC_RUNTIME_API_BOOTSTRAP，容器包装还需转入此变量与原环境。原退出码必须保留，不能把非零改成成功。wrap 返回的 stdio/bootstrap/limits/permissions 额外字段不授予更改这些资源的权限。

非函数 wrap 在准备阶段拒绝；回调抛错或非法返回使启动失败，PROCESS_PLUGIN_INVALID_OPTION TypeError 位于 supervision LAUNCH_FAILED 的 cause 链，回调原值保留 cause。Host 安装最外层仍可为 PLUGIN_INSTALL_FAILED，不按 message 判断。

完整 spawn 对象显式组合 kind:'spawn'、channelKind:'byte'|'message'、supervision、rawChannel(handle,signal)、establish(raw,prepared)、token 与可选 offer。完整 byte spawn 必须显式 wire:'native'|'jsonrpc'，message spawn 必须省略 wire；只有短形式补 native 默认。supervision.spec 包含 command/args/env/stdio/bootstrap/limits，bootstrap.stdin payload 与认证 token 一致。budget 限并存执行单元数量，不等于 OS 内存限制；isolation 可为 best-effort/required。spec.limits.callWallTimeMs 会压低每次调用可用截止。

rawChannel 必须返回本次真实 handle 的资源；establish 使用 prepared.offer/scheduler/signal/session/token/stderr 完成实际握手，不接收“已认证”声明替代操作。高级回调来源 async(context)=>sourceResult 不经过本包 supervision，不能据此获得 stop/restart/replace 权限。

### 调用、超时与结果未知

TRemote 只提供业务方法类型；不传泛型时没有可调用方法，动态字符串调用用 IRuntimeDynamicSurface，运行时仍按已接纳目录拒绝未知方法。

| Peer 方法                         | 行为                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- |
| request(method,payload?,options?) | 等待标量结果，保留原操作错误                                               |
| notify(method,payload?,options?)  | 只等本地发送，不证明远端执行成功                                           |
| stream(method,payload?,options?)  | 首次 next 才启动，提前 break/return 通知远端结束生产                       |
| group(steps,options?)             | 顺序执行请求，某步失败后剩余 not-executed，不回滚已完成步骤                |
| outcome(idempotencyKey)           | 查询 pending/done/unknown，done 携带原结果；unknown 不证明从未执行         |
| describe(options?)                | 本地查询身份、接纳连接与目录，不额外发网络请求                             |
| on / Symbol.asyncDispose          | 使用 Core 事件/清理接口；连接工厂已表示首次就绪，listen 工厂仅安装接纳入口 |
| close()                           | 停新工作并按 owner 的 drain 策略结束现有工作，复用同一清理 Promise         |

工厂 defaultTimeoutMs 默认 30000 ms，正有限 number；只有 request/stream 继承该默认。单次 timeoutMs 可为非负 number 或 false，0 立即到期，false 关闭默认超时；进程预算的 callWallTimeMs 仍可进一步限制。signal 是协作取消，本地结束等待不证明业务没执行。idempotencyKey 只有对端声明并保留对应结果时才复用；orderKey 对同键安排对端串行；cancel:'before-start' 在未开始时撤销，已开始则等待真实结果。

进程路径拒绝 transfer 属性，即使 []，ArrayBuffer/Uint8Array 普通传输会复制。超时、取消、断线和 outcome unknown 都不证明“对端没有执行”；非幂等写入先 outcome 或业务对账再决定重试。明确在 provider 前拒绝的 OVERLOADED/PROCESS_CONNECTION_LIMIT 与成功 before-start 撤销应和已发出但结果未知的调用区分。

### 名称、本机 socket 与认证

短 connect/listen 字符串可为普通服务名或明确地址。普通名不带斜线/协议，由 OS 用户与名称派生相同端点；POSIX 使用 0700 私有用户目录与 0600 socket，拒绝不合所有者/权限的目录、符号链接及其它服务路径。Node-compatible API 不提供 peer credentials，权限只限制 OS 用户，同用户任意进程仍可接入；要区分应用，双方显式 token。

TCP 回环、显式 Unix 路径和未提供 ACL 保证的 Windows named pipe 必须 token；同用户公开 hello 标记不是 secret。只接受 tcp://127.0.0.1:port、tcp://[::1]:port、Unix 绝对路径或 Windows 命名管道，不接受跨机器地址。listen port=0 由 OS 分配，实际地址从 listener.address 读取。

connectTimeoutMs 默认 5000 ms，有限非负 number；只有普通 named local 来源才以最多 25 ms 间隔重试 ENOENT/ECONNREFUSED，显式地址拨号失败不走该重试。signal 取消待重试，保留原取消原因。第二个同名 listener 仍 PROCESS_CHANNEL_LISTEN_FAILED；只有既有 owner record 证明属于同服务的崩溃遗留路径才回收。

完整 connect 为 kind:'connect'、address/token、dial(address,signal)、establish，wire 默认 native，可配本地会话 supervision 的 restart/startupTimeoutMs/health/stop/terminalPolicy/scheduler；它只重建本端连接，不取得对端进程所有权。完整 listen 为 kind:'listener'、listen/address/offer/verify/createConnectionContext，可选 scheduler；verify 返回 principal，不能信客户端自报身份。每次接入有独立 peerId、session 和通道。凭据错误时 client 可外层 REMOTE_START_FAILED，server report 原 PROCESS_CHANNEL_AUTH_REJECTED，不用同凭据盲重试。

Socket listener 拥有监听与未交接资源，不自动拥有已经交出的会话。其 close 复用同一 Promise。Unix owner record 不等于原生路径删除的绝对保证：Node/libuv 在地址被外部 rename/替换后仍可能在原 listener.close 删除同址后继 inode，当前路径会报告一次 PROCESS_CHANNEL_LISTEN_FAILED/cause；重复关闭不重复报告。不要在活动 listener 的路径上另建 owner。现有 Darwin 路径预算为 104 字节，不额外缩短为隐藏 staging 地址。

### PluginHost 出口、替换与描述符

createProcessPlugin 的运行时形式使用 Peer 相同来源/provide，增加 name 与 expose，返回待 Host.use 安装的插件。Host 持有连接，调用方不应再用另一套 owner 终止同一子进程。expose 默认空，只有明确的 Feature 方法路径可反向调用，列出 math.add 不会公开同级 math.sub。

host.process 的 request/notify/stream/group/outcome 第一个参数为连接名，或同名多实例时的 {name,instanceId}。list/get 查询连接、身份、代次、健康与退出，缺事实用 unavailable，不伪造 0；on 返回幂等解除函数，watch 是有界异步迭代；broadcast 分别汇总结果，不保证全部成功。stop/kill/restart/replace 仅 spawn-owned，借用 connect/listen 以 CAPABILITY_CONFLICT 拒绝。

replace 使用既有 supervision/Host 策略，不搬迁已经执行的调用。IProcessPlugin.replace 的 options 默认 {}，strategy 默认 stop-then-start；支持 spec 与 stop-then-start/start-then-switch 策略，结果分别含 supervisor outcome 或后继 plugin；不同策略的准备、切换和回收仍由原 owner 管理。Host execution 两个预算须按 PluginHost 契约显式给出，不能把无限 false 当成默认值。

根入口还提供 parseProcessPluginDescriptor 与 ProcessPluginWire。描述符是持久化配置数据，不含运行时通道、bootstrap 凭据或已认证状态；执行性端口必须由真实工厂提供。低层 IProcessPluginOptions 的 deployment/host/endpointFactory/registrationOwner 与便捷运行时来源形式应分别按其类型使用。

### 连接治理与终态清算

createProcessResilience 必填 scheduler/report，不创建第二个进程监督器。默认 idempotencyStore 使用该 owner 的独立命名空间，同 principal 的不同 connection/session 共享去重 scope，不同 owner 隔离。identity 必须给非空 principalId，connectionId/sessionId 用于各连接标签，processId 可选。

| Resilience 选项                                  | 默认原值                |
| ------------------------------------------------ | ----------------------- |
| maxConnections / maxConcurrentCallsPerConnection | 64 / 32                 |
| maxCallsPerMinute / maxPayloadBytes              | 600 / 16*1024*1024      |
| maxConsecutiveTimeouts / idleTimeoutMs           | 3 / 60000               |
| drainMs                                          | 5000                    |
| reportAtMs                                       | [0,60000,300000,900000] |
| unhandledLimit / liquidation.cascade             | 3 / false               |

容量、超时与 drain 选项是正安全整数，不用 0 表示关闭；reportAtMs 从 terminal 进入时计时，首个 0 分钟报告由原 supervision 保留。超过默认未处理次数才启动清算，不把第一条诊断等同终态移除。

sessionOptions(identity) 返回接入 Endpoint 所需 idempotency 与 limits；listenRegistrations 接收 wire:'native'、真实 listen/address/offer、verifyToken、createConnectionContext、onCandidate 及可选 serviceId/scheduler/handshakeTimeoutMs/signal。onCandidate 只能 adopt/reject；listener 拥有未接纳候选，已经 adopt 的 lease 交给接纳者关闭，lease.channel/identity 与其 close 属于同一会话。认证后 principal 来自 verifier，不能跳过握手自行声明。

attachRegistration(name,binding,owner) 绑定真实 supervisor；binding.ownership 是 spawn-owned/connection-borrowed，health 是 ping/custom/none。owner 是 proxy-plugin 的 name/Host.unUse，或 standalone-host 的 release。callGuard 在 provider 前拒绝 terminal/liquidated，不需要另写调用旁路；inspect 返回状态、health、unhandled、liquidated 和原 reason，未知为 undefined。onTerminal 任一 handler fulfilled 即视为 handled、重置未处理计数并停止后续诊断；全部 rejected 才保持未处理，拒绝原因仍报告。

共享目标的显式实例健康失败会先关闭所有共享 sessions，再创建/替换后继；失败仍保持隔离并报告原错误。per-connection 只关受影响 session，不替换共享进程。连接速率/payload 超限在 provider 前 PROCESS_CONNECTION_LIMIT；连续超时与空闲只关闭该连接，不证明整个共享实例坏了。

清算只使用 Host 已提交 affected plan，不拿 dry-run 当提交。post-removal cleanup 失败仍视为已提交，reason 保留 terminal 与 cleanup；pre-commit reject 或 standalone release 失败不记 liquidated tombstone、不自动重试该 Host mutation。默认 suspend 为实际受影响依赖启动诊断，cascade 清实际依赖且不再为已释放依赖启动诊断。仅保留最新 100 个已提交 tombstone，旧 registration.close 不能移除同名新代。

registration.close 只停该诊断/退订，不 dispose 外部 supervisor；resilience.close 释放自己开的 listener 与登记，稳定 Promise/allSettled，清理失败 PROCESS_CHANNEL_CLOSED AggregateError。不要泛称关闭后所有只读方法都抛错；sessionOptions/inspect 等按其原接口保留行为。显式关闭实际 supervisor/Host 仍是其原 owner 的责任。

### 通道、握手、诊断与平台能力

IProcessByteChannel 是 kind:'byte' 的有序 write/onData/onClose/close，write 返回真实背压 Promise；IProcessMessageChannel 是 kind:'message' 的 send/onMessage/onClose/close。createProcessTransport 的 byte 参数必须选 initiator+offer 或 responder+offer+auth；responder auth 为 required/verify 或明确 none。common 参数包含 peerId/report/ipc、可选 signal/scheduler/handshakeTimeoutMs；ipc 至少 connectionId/sessionId/log，可选 processId、stderr、maxPendingData/maxPendingControl。

createNativeProcessOffer 必填 peer，可选 auth/stream/capabilities；直接基底为 ping/close/batch，stream:true 才直接加入 stream。capabilities 省略时，Runtime 绑定按 Core 已安装能力完成默认提议；显式列表（包括 []）不被自动拓宽，stream:false 仍禁止自动补 stream。offer 与版本/codec/peer 数据冻结，json codec 和当前 RpcProtocol 版本由 Contract 常量拥有。

消息通道 staticAgreement.local/peer 都必须 codec:'identity' 且 capabilities 相同、有序一致；这是输入声明检查，不授予已协商信任。既有基础能力 abort/ping/close/deadline/idempotency/trace/stream/batch 可直接使用，Runtime/二进制等扩展仍需 Core ACK，缺 ACK 或超时只保留实际基础能力，agreement.capabilities 反映接纳结果。

默认入站调用限额 maxPerPeer=64/maxGlobal=256，可用 providerLimits 覆盖并从 onRejected 读取原因；超过为 Core OVERLOADED，provider 未执行。不要与 resilience 每连接 32 并发默认混为一处限额。首帧握手受 PROCESS_HANDSHAKE_MAX_FRAME_BYTES=65536 字节限制，native 业务帧上限 16 MiB，握手与 message 扩展 ACK 默认 10000 ms。Core 待发送 data/control 默认 256/8。手动 receiveAdapterBootstrap/openProcessStdioChannel 未给 bootstrapTimeout 时不设 timer；automatic child 会显式给 10000 ms。大数据用 stream 或业务分片。

stderr 从启动就持续读取，1000 ms 内每 session 最多 32 条 ipc.stderr；额外片段合并 droppedChunks 摘要，文本脱敏，不把日志写 stdout。Native 默认 ping 每 5000 ms、单次 2000 ms、连续 3 次失败升级不健康，显式 custom health 优先；JSON-RPC 缺省不开 native ping。健康失败 PROCESS_HEALTH_PING_FAILED 交原监督策略，而非文档另起重启器。

Node/Bun/Deno stdio/socket 复用 Core 字节 framing。当前 transport.observe 已提供，旧“尚未实现”描述不再适用。字节观察同步 emit 一次，size 为完整 frame.byteLength，借用 detail 含 frameBytes/drainMs；inbound drainMs=0，outbound 初值 -1，物理 onWrite 完成后只更新同一 detail，不另发第二条异步 carrier event。capture 开启才给原 frame 引用，保留 metadata 应复制数值。Whole-message 内容是原 value 引用、detail=undefined，已知原生字节可给 size，opaque 未知为 -1，不为测大小序列化对象；observer 失败经 Core TRANSPORT 报告。逻辑 send 耗时不等于 drainMs，不把 Node 结果外推成 Electron 验证或速度结论。

Web Streams byte close 在回调前发布同一 Promise，失败仍尝试其余观察者、reader.cancel、writer.abort 与物理关闭；失败为 PROCESS_CHANNEL_CLOSED AggregateError，首错在 cause、全体在 errors。writer 获取失败释放已获 reader 锁，原 TypeError 附 PROCESS_CHANNEL_CONNECT_FAILED。自己取得的 Node/Deno/Web 字节构造仍需真实资源，不能用“已认证”对象替代。

适配器扩展可用 createAdapterSocketByteIO、createAdapterChildStdio、createAdapterProcessStdio、createAdapterWebByteIO，以及 createAdapterProcessLaunch/Peer/Plugin。新适配器优先复用 Core defineByteAdapter/defineMessageAdapter；复杂会话组合用原 advanced SDK，不复制 framing、握手、correlation 或生命周期。

### JSON-RPC 外部语言契约

普通外部子进程用 spawn:{command,args,wire:'jsonrpc',contract}，仍由原 spawn supervision 拥有；自有有序字节连接用 createProcessJsonRpcChannel。旧桥接工厂名统一为此入口，选项类型 IProcessJsonRpcChannelOptions，桥接错误常量从 rpc-contract/framing/jsonrpc 导入。Process 仅保留原 byte 的关闭/stderr/诊断，协议协商、correlation 与 cleanup 由 Core 拥有。

高级参数 byte/peerId/target/offer/token/scheduler/wallClock/ipc/report 明确提供，signal/handshakeTimeoutMs 可选，JSON-RPC 握手默认 10000 ms，不使用 native 长度前缀或默认 ping。target 为 {kind:'plugin',contract} 或 {kind:'host',catalog}；本地 contract 只预检不支持 stream，真正可调用目录来自对端 migaia.describe，不是调用方授予的目录。offer 中 codecs/auth 由桥接填写；可选能力仅 deadline@1、trace@1、idempotency@1，加自动必需的 jsonrpc-bridge@1/runtime-api@1/batch@1/abort@1/wire-error@1，不能随意扩 profile。

| 协议操作        | 线上的要求                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bootstrap       | 子进程先读取 4 字节大端长度与 UTF-8 token，再读消息；socket token 由应用事先共享                                                                                             |
| framing         | Content-Length 按 UTF-8 字节数，CRLF CRLF 后为 JSON；header≤1024 bytes，单帧≤16 MiB                                                                                          |
| migaia.hello    | JSON-RPC 2.0 带 id，params.hello 为 handshake hello 的 JSON 字符串，包含 protocol migaia.rpc、versions、json codec、capabilities、peer 与 auth                               |
| hello result    | reply 为 accept/reject 的 JSON 字符串，methods 必须列出 migaia.hello/migaia.describe/migaia.invoke/migaia.cancel 四个扩展；接受选择双方共同版本（当前 1.1）、json 与共同能力 |
| migaia.describe | params.args=[]，返回 schemaVersion:2、self{name,instanceId}、methods；instanceId 必须等握手 peer.id                                                                          |
| methods 项      | name、supportedModes 仅 request/notify、modeSource:'declared'，可选 idempotent；stream 拒绝                                                                                  |
| migaia.invoke   | params.method 与 args 位置参数数组，缺 payload 为 []；带 id 等结果，不带 id 为 notify、不回复                                                                                |
| invoke meta     | 可选 timeoutMs/idempotencyKey/trace，仅发送实际设置字段，对端可按自身语义处理                                                                                                |
| migaia.cancel   | 无 id 的通知，params.id 与可选 reason，通知放弃不等确认、不回滚副作用；迟到结果丢弃                                                                                          |
| batch           | 握手后可发数组，按数组顺序处理并仅为带 id 的项返回数组，单项失败不取消其它项，全 notify 不回复                                                                               |

握手前必须拒绝 hello 以外消息；hello 认证失败为 reject+wire error。stdout 只写协议、stderr 写日志。对端实现可用任意语言；原最小 Python 模式只是 read-exact bootstrap、读 Content-Length 循环、hello 验证、describe 目录、invoke 分发和 cancel 通知，不提供自动幂等/取消业务实现。反向 migaia.invoke 在协议上可用，但需在应用自己的语言实现中验证。

payload 必须数组，非数组 JSONRPC_PROFILE_INVALID；超过安全整数范围 ±(2^53-1) 用字符串。JSON 编码不支持原生 stream/transfer。帧、UTF-8、JSON 非法或半帧关闭使连接 JSONRPC_FRAME_INVALID 终止；未知/迟到 id 报告并丢弃，不干扰别的调用。

业务 error 使用 JSON-RPC error.code/message/data.migaiaWireError，wire 至少 source/code/name/message/stack，可选 cause/errors，不能在接收侧重造 stack。JSON-RPC 整数 code 可用 -32700 解析、-32600 请求、-32601 方法、-32602 参数、-32603 内部、-32000 业务；诊断语义仍用 wire source/code。Contract 的 toJsonRpcError/fromJsonRpcError 与 encodeJsonRpcFrame/createJsonRpcFrameDecoder 复用同一表示，不另建协议。

| JSON-RPC code（source=rpc.contract.jsonrpc） | 场景                                      |
| -------------------------------------------------- | ----------------------------------------- |
| JSONRPC_FRAME_INVALID                              | 非法头部、编码、JSON 或半帧关闭，连接终止 |
| JSONRPC_EXTENSION_MISSING                          | hello 缺必需能力或四个扩展方法            |
| JSONRPC_PROFILE_INVALID                            | 本端 profile、payload 或能力不支持        |
| JSONRPC_UNSUPPORTED_MODE                           | 本地声明/远端目录带 stream                |
| JSONRPC_HANDSHAKE_TIMEOUT                          | 握手截止，检查 bootstrap/stdin/回复端     |

远端业务 wire source/code 只诊断，不取得本地取消、重试、认证权限；没有语义身份的业务原生 Error 可以还原为相应 native 类型与 unknown/UNKNOWN，不应由接收端伪造本包码。重试非幂等方法仍须对账，或由业务真正实现 meta.idempotencyKey 去重。

### 错误与排查

本包 source 为 RPC_PROCESS_ERROR_SOURCE（rpc.transport.process）。同步 spawn、Unix listener 准备/bind 在原错误上附语义码，保留原生类型、stack 和其它 OS 字段，原 errno code 归入语义 code；包装失败仍经 cause 可达。不要按错误 message 做控制。

| Process code                                                   | 场景                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| PROCESS_HANDSHAKE_TIMEOUT / PROCESS_CHANNEL_AUTH_REJECTED      | 握手未完成 / 凭据拒绝，修正来源和认证                       |
| PROCESS_CHANNEL_CLOSED                                         | 已关闭或资源/close 观察者清理失败，查 cause/errors          |
| PROCESS_CHANNEL_CONNECT_FAILED / PROCESS_CHANNEL_LISTEN_FAILED | 拨号/启动或监听准备/bind失败                                |
| PROCESS_PLUGIN_INVALID_OPTION / PROCESS_HOST_INVALID_OPTION    | 来源、插件或 Host 配置不合法                                |
| PROCESS_HOST_CLOSED                                            | facade 已开始释放，需新 owner                               |
| PROCESS_RESILIENCE_INVALID_OPTION / PROCESS_CONNECTION_LIMIT   | 治理配置非法 / 接入、速率、payload 提供前拒绝               |
| PROCESS_INSTANCE_UNHEALTHY / PROCESS_HEALTH_PING_FAILED        | 共享实例显式健康隔离 / native ping 失败                     |
| PROCESS_TERMINAL_CALL / PROCESS_LIQUIDATED                     | 终态拒新调用 / 已清算不能重启                               |
| PROCESS_USAGE_SAMPLE_FAILED                                    | 原生 CPU/内存采样失败，显示 unavailable，不改变进程生命周期 |

Core 调用错误包括 DEADLINE_EXCEEDED/TimeoutError、CANCELLED/AbortError、OVERLOADED、PROVIDER_NOT_FOUND、TRANSPORT，Remote/PluginHost/Supervision 包装保持各自 source。业务原生 RangeError 等经 wire 还原原类型/message/stack/cause，不假装成 Process 主机错误。

自动来源失败先确认确由库 launcher 启动；握手超时确认先消费 bootstrap、stdin 正在读取、stdout 仅协议；socket 检查回环/权限/token。notify 只证明发送；大文件用业务分片/stream 或传约定路径由对端读取。Node 孙进程与强制终止限制、其它宿主权限/能力应按实际平台验证。

现有包脚本如下，列出不代表文档编辑独立运行；本包原 test 保留 coverage 配置，未把基准或多宿主支持文字冒充本轮执行证据。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
```
