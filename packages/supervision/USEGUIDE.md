# Supervision 使用指南

[English](./USEGUIDE.en.md)

包的定位、亮点和心智模型见 [README](./README.md)。本指南先按场景给出可以直接运行的示例，再说明协程、进程和线程三种执行方式的详细契约。

## 按场景查找

| 你遇到的问题 | 看这一节 |
| --- | --- |
| 子进程崩溃后要自动重启 | [监督一个真实的子进程](#监督一个真实的子进程) |
| 配置错误导致反复崩溃，想及时停下并看到原因 | [崩溃太多次就停下](#崩溃太多次就停下) |
| 后台任务卡住了，但没有退出 | [用心跳发现卡住的任务](#用心跳发现卡住的任务) |
| 一次起太多任务，机器扛不住 | [限制同时运行的数量](#限制同时运行的数量) |
| 发布新版本时不想中断服务 | [不中断地替换实例](#不中断地替换实例) |
| 关闭应用时被不肯退出的任务卡住 | [限时停止与名额归还](#限时停止与名额归还) |
| 父进程被结束后，子进程还在；下次启动又起一批 | [父进程退出与遗留进程](#父进程退出与遗留进程) |
| 每次都现起进程，等待太久 | [预热进程](#预热进程) |

## 监督一个真实的子进程

本包只定义“启动器”接口，不直接调用操作系统 API，这样同一套策略可以用在 Node、Bun、Deno 和 Electron 上。`@migaia/rpc-process` 提供了现成的启动器，Node 用 `createNodeProcessLauncher()`。

下面的子进程每次启动 200 毫秒后都以退出码 3 崩溃，模拟一个读错配置的索引服务。监督器每次崩溃后间隔一段时间重启，重启 2 次后仍然失败，就进入 `terminal` 并停止尝试。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'

const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const indexer = createProcessSupervisor({
  id: 'search-indexer',
  launcher: createNodeProcessLauncher(),
  budget,
  // Node 启动器不能保证结束整个进程树，这里显式接受这一点。
  isolation: 'best-effort',
  spec: {
    command: process.execPath,
    args: ['-e', 'setTimeout(() => process.exit(3), 200)'],
    env: { inherit: [], set: {} },
    stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
  },
  restart: { initialDelayMs: 100, maxRestarts: 2 },
  report: (error) => console.log('report:', (error as { code?: string }).code)
})
indexer.subscribe((event) => {
  if (event.type === 'exit') console.log('exit:', event.reason, event.status)
  if (event.type === 'restart') console.log('第', event.count, '次重启成功')
})

await indexer.start()
await new Promise((resolve) => setTimeout(resolve, 2000))
console.log('最终状态:', indexer.state)
await indexer.dispose()
budget.close()
```

输出：

```text
report: CAPABILITY_UNSUPPORTED
exit: crashed { code: 3, signal: null }
第 1 次重启成功
exit: crashed { code: 3, signal: null }
第 2 次重启成功
exit: crashed { code: 3, signal: null }
report: SUPERVISION_EXHAUSTED
最终状态: terminal
```

第一行 `CAPABILITY_UNSUPPORTED` 是降级提示：Node 启动器声明自己不能保证结束整个进程树，选择 `best-effort` 后监督器照常工作，但会把这一项报告一次，并记在 `inspect().degraded` 里。不写 `isolation: 'best-effort'` 时，创建监督器会直接抛出这个错误。

“重启成功”指新进程启动成功，不代表它之后不会再崩溃。这里没有提供 `ready`，所以进程一启动就算可用；真实服务应该提供 `ready`，例如等它在标准输出里打印“已就绪”，或者等一次连接成功。

## 崩溃太多次就停下

默认规则：第一次重启前等 250 毫秒，之后每次翻倍，最长 30 秒；60 秒内最多自动重启 5 次，之后再失败，监督器进入 `terminal`。进入 `terminal` 时，`report` 会收到 `SUPERVISION_EXHAUSTED`，你的原始错误在它的 `cause` 链上。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
let launches = 0
const thumbnailer = createCoroutineSupervisor({
  id: 'thumbnailer',
  budget,
  spec: {
    task: async () => {
      launches += 1
      throw new Error('配置文件缺失')
    }
  },
  restart: { initialDelayMs: 10, maxRestarts: 3 },
  report: (error) => {
    // 沿着 cause 链一直找到最初的错误。
    const chain: string[] = []
    for (let current: any = error; current; current = current.cause)
      chain.push(current.code ?? current.message)
    console.log(chain.join(' <- '))
  }
})

const outcome = await thumbnailer.start()
console.log('start():', outcome.state, '| 启动次数:', launches, '| 占用名额:', budget.inUse)
await thumbnailer.dispose()
budget.close()
```

输出：

```text
SUPERVISION_EXHAUSTED <- LAUNCH_FAILED <- EXIT_UNEXPECTED <- 配置文件缺失
start(): terminal | 启动次数: 4 | 占用名额: 0
```

启动 4 次 = 第一次启动 + 3 次重启。`start()` 不会因为单元失败而抛错，它返回 `terminal`；失败细节交给 `report`，也可以从 `inspect().lastExit` 和 `inspect().terminalError` 读取。

进入 `terminal` 后，监督器不会自己恢复，除非你调用 `restart()`，或者配置 `terminalPolicy: { mode: 'cooldown', afterMs }` 让它冷却一段时间后再试一次。`restart: { mode: 'never' }` 表示任何失败都直接进入 `terminal`。

## 用心跳发现卡住的任务

只监听“退出”发现不了卡住的任务。协程监督器可以要求任务定期调用 `heartbeat()`；超过 `heartbeat.timeoutMs` 没有心跳，就判定为不健康，结束这次运行并按重启规则重新开始。

下面的扫描任务每处理完一页报告一次心跳。第一次运行在第 3 页卡在一个不会返回的请求上。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let run = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const scanner = createCoroutineSupervisor({
  id: 'page-scanner',
  budget,
  spec: {
    task: async ({ heartbeat, signal }) => {
      run += 1
      for (let page = 1; page <= 3; page++) {
        if (run === 1 && page === 3)
          // 模拟卡住的请求。它能响应取消信号，所以监督器可以结束它。
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        if (signal.aborted) return
        await new Promise((resolve) => setTimeout(resolve, 20))
        heartbeat()
        console.log(`第 ${run} 次运行：完成第 ${page} 页`)
      }
    }
  },
  heartbeat: { timeoutMs: 100 },
  restart: { initialDelayMs: 50 },
  report: console.error
})
scanner.subscribe((event) => {
  if (event.type === 'exit') console.log('exit:', event.reason)
})

await scanner.start()
await new Promise((resolve) => setTimeout(resolve, 800))
await scanner.dispose()
budget.close()
```

输出：

```text
第 1 次运行：完成第 1 页
第 1 次运行：完成第 2 页
exit: unhealthy
第 2 次运行：完成第 1 页
第 2 次运行：完成第 2 页
第 2 次运行：完成第 3 页
exit: exited
```

注意：协程和你的其他代码共用同一个事件循环，监督器只能“请求”它停下。卡在同步死循环里、或者完全不理会取消信号的任务，监督器无法强行结束，它占用的名额也不会归还（见[限时停止与名额归还](#限时停止与名额归还)）。需要强制结束时，用子进程。

子进程和线程没有 `heartbeat` 选项，用通用的 `health: { check, intervalMs, timeoutMs, failureThreshold }`：默认每 5 秒检查一次，单次限时 2 秒，连续 3 次失败就判定为不健康。`heartbeat` 和 `health` 不能同时使用。

## 限制同时运行的数量

预算（budget）是一组监督器共享的名额。名额用完后，新的启动请求默认排队，最多等 30 秒；设置 `overflow: 'reject'` 时直接返回 `full`。预算还默认限制每秒最多启动 8 个，避免瞬间起一大批。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

// 三个导出任务共用一个预算，同一时刻最多运行两个。
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
let running = 0
const exportFile = (name: string) =>
  createCoroutineSupervisor({
    id: `export-${name}`,
    budget,
    spec: {
      task: async () => {
        running += 1
        console.log(`开始导出 ${name}，同时运行: ${running}`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        running -= 1
      }
    },
    restart: { mode: 'never' },
    report: console.error
  })

const jobs = ['a.csv', 'b.csv', 'c.csv'].map(exportFile)
await Promise.all(jobs.map((job) => job.start()))
await new Promise((resolve) => setTimeout(resolve, 300))
await Promise.all(jobs.map((job) => job.dispose()))
budget.close()
```

输出：

```text
开始导出 a.csv，同时运行: 1
开始导出 b.csv，同时运行: 2
开始导出 c.csv，同时运行: 2
```

`c.csv` 等到 `a.csv` 结束、名额空出来之后才开始。预算只能被同一类单元共用：协程、线程、进程各自使用自己的预算，`kind` 不一致时创建监督器会报 `INVALID_OPTION`。

## 不中断地替换实例

`replace()` 用新的实例替换正在服务的实例，可以同时换一份新的规格（例如新版本的命令参数）。默认策略 `stop-then-start` 先停旧再起新；`start-then-switch` 先起新，新实例准备好后才切换，旧实例在切换之后才收到停止信号。后者需要预算里能同时容纳两个单元。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
let version = 0
const consumer = createCoroutineSupervisor<{ version: number }>({
  id: 'queue-consumer',
  budget,
  spec: {
    task: async ({ expose, signal }) => {
      const mine = ++version
      expose({ version: mine })
      console.log(`v${mine} 开始消费`)
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      console.log(`v${mine} 停止消费`)
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: console.error
})
consumer.subscribe((event) => {
  if (event.type === 'switched') console.log(`切换: generation ${event.from} -> ${event.to}`)
})

await consumer.start()
const outcome = await consumer.replace({ strategy: 'start-then-switch' })
console.log('replace():', outcome.kind)
await consumer.dispose()
budget.close()
```

输出：

```text
v1 开始消费
v2 开始消费
切换: generation 1 -> 2
v1 停止消费
replace(): replaced
v2 停止消费
```

新实例启动失败时，`replace()` 返回 `{ kind: 'failed', error }`，旧实例继续服务。新规格在停止旧实例之前就会被校验；未知的策略名会直接抛出 `INVALID_OPTION`。

## 限时停止与名额归还

`stop()` 分三段，每段默认 5 秒：

1. **应用收尾**：如果提供了 `stop.beforeTerminate`，先让它完成手头的工作（`drainTimeoutMs`）。
2. **正常退出**：请求单元退出，等待它真正退出（`exitTimeoutMs`）。
3. **强制回收**：强制结束后再等一段时间（`reapTimeoutMs`）。仍然没有退出，就报告 `REAP_TIMEOUT` 并放弃等待。

`stop()` 一定会在这些时限内返回。但如果单元还没有真正退出，它占用的名额会一直保留，直到它真正退出为止。这样新任务就不会和一个没停干净的旧任务同时运行。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const job = createCoroutineSupervisor({
  id: 'export-job',
  budget,
  spec: {
    task: async () => {
      // 不理会取消信号，300 毫秒后才自己结束。
      await new Promise((resolve) => setTimeout(resolve, 300))
      console.log('任务真正结束')
    }
  },
  stop: { drainTimeoutMs: 0, exitTimeoutMs: 50, reapTimeoutMs: 50 },
  report: (error) => console.log('report:', (error as { code?: string }).code)
})

await job.start()
await job.stop()
console.log('stop() 已返回，占用名额:', budget.inUse)
const attempt = budget.tryAcquire()
console.log('这时再申请名额:', attempt.kind === 'rejected' ? attempt.reason : attempt.kind)
await new Promise((resolve) => setTimeout(resolve, 400))
console.log('任务结束后，占用名额:', budget.inUse)
await job.dispose()
budget.close()
```

输出：

```text
report: REAP_TIMEOUT
stop() 已返回，占用名额: 1
这时再申请名额: full
任务真正结束
任务结束后，占用名额: 0
```

`stop({ graceMs })` 只缩短这一次的“应用收尾”时间。`kill()` 跳过前两段，直接强制结束。`stop()` 之后可以再次 `start()`；`dispose()` 之后监督器永久关闭，再调用 `start()` 会被拒绝。

## 父进程退出与遗留进程

父进程被强制结束时，子进程收不到正常的停止请求。有两件事要做：

- **子进程这一侧**：用 `createParentLossGuard` 在父连接断开时开始收尾，并保证在 `graceMs`（默认 5 秒）内退出。收尾完成时退出码为 0；超时或收尾失败时为 1。
- **父进程这一侧**：用持久的进程记录（registry）登记每个启动的子进程。下次启动时，先调用 `reclaimOrphanProcesses` 清理上次遗留的进程。它只结束“指纹”仍然匹配的进程；如果原来的 pid 已经被别的程序复用，只删除记录，不会误杀。

```ts doc-test=run
import { createParentLossGuard, reclaimOrphanProcesses } from '@migaia/supervision/process'
import type { IProcessLauncher, IProcessRecord, IProcessRegistry } from '@migaia/supervision/process'

// 子进程这一侧：父进程断开后，在 1 秒内收尾并退出。
const guard = createParentLossGuard({
  graceMs: 1000,
  shutdown: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    console.log('进度已保存')
  },
  exit: (code) => console.log('退出码:', code),
  report: console.error
})
guard.trigger() // 真实程序里，在父连接关闭的事件里调用。
await new Promise((resolve) => setTimeout(resolve, 100))

// 父进程这一侧：这里用内存模拟持久存储，真实程序里应该写到文件或数据库。
const records = new Map<string, IProcessRecord>([
  ['a', { id: 'a', namespace: 'indexer', identity: { fingerprint: 'boot-1:4101', pid: 4101 }, launchedAt: 0 }],
  ['b', { id: 'b', namespace: 'indexer', identity: { fingerprint: 'boot-1:4102', pid: 4102 }, launchedAt: 0 }]
])
const registry: IProcessRegistry = {
  add: async (record) => void records.set(record.id, record),
  remove: async (id) => void records.delete(id),
  list: async (namespace) => [...records.values()].filter((record) => record.namespace === namespace)
}
// 回收需要启动器能够探测和结束记录里的进程；这里只模拟这两步。
const launcher: IProcessLauncher = {
  capabilities: {},
  launch: () => Promise.reject(new Error('这个启动器只用于回收')),
  probe: async (record) => (record.identity.pid === 4101 ? 'alive' : 'reused'),
  terminateRecord: async (record) => console.log('结束遗留进程', record.identity.pid)
}
const result = await reclaimOrphanProcesses({ registry, namespace: 'indexer', launcher, report: console.error })
console.log('已结束:', result.terminated, '| 已删除记录:', result.removed)
```

输出：

```text
进度已保存
退出码: 0
结束遗留进程 4101
已结束: [ 'a' ] | 已删除记录: [ 'a', 'b' ]
```

给 `createProcessSupervisor` 传入 `registry: { port, namespace }` 后，监督器会在启动时登记记录、在进程真正退出后删除记录。使用 registry 时，启动器必须实现 `probe` 和 `terminateRecord`。某条记录回收失败时，它会保留下来供下次再试，失败以 `ORPHAN_RECLAIM_FAILED` 报告。

## 预热进程

`createPrewarmPool` 提前启动若干空闲进程。监督器 `start()` 时直接取用一个，省掉创建进程的时间；取用后监督器仍然会执行 `ready` 检查。预热池必须和监督器使用同一个预算、启动器和规格对象，预热进程同样占用预算名额。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createPrewarmPool, createProcessSupervisor } from '@migaia/supervision/process'
import type { IProcessSpec } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'

const launcher = createNodeProcessLauncher()
const budget = createUnitBudget({ kind: 'process', maxUnits: 2 })
const spec: IProcessSpec = {
  command: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  env: { inherit: [], set: {} },
  stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
}
const options = { id: 'renderer', launcher, budget, spec, isolation: 'best-effort' as const, report: () => undefined }
const pool = createPrewarmPool({ ...options, size: 1 })
await new Promise((resolve) => setTimeout(resolve, 300))
console.log('空闲进程:', pool.idle)

const renderer = createProcessSupervisor({ ...options, prewarm: pool })
const outcome = await renderer.start()
console.log('start():', outcome.state, '| 剩余空闲进程:', pool.idle)
await renderer.dispose()
await pool.dispose()
budget.close()
```

输出：

```text
空闲进程: 1
start(): ready | 剩余空闲进程: 0
```

空闲进程默认 60 秒没有被取用就会被结束。`restart()` 和 `replace()` 会绕过可能已经过时的空闲进程，重新启动。

## 协作式任务（协程）的完整契约

```ts
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
type IEchoPort = { call(value: unknown): Promise<unknown> }
const supervisor = createCoroutineSupervisor<IEchoPort>({
  id: 'echo',
  budget,
  spec: {
    task: async ({ signal, expose, heartbeat }) => {
      const port = { call: async (value: unknown) => value }
      expose(port)
      heartbeat()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      // 返回之前，关闭这个任务自己打开的资源。
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: (error) => {
    console.error(error)
  }
})

const ready = await supervisor.start()
if (ready.state === 'ready') {
  const port = await ready.unit.exposed
  await port.call({ message: 'hello' })
}
await supervisor.dispose()
```

`expose(port)` 只能调用一次，第二次调用会在任务内部抛出带错误码的 `TypeError`。如果任务在 `expose` 之前就结束，`exposed` 会一直等待，`ready` 检查会等到启动时限。任务收到的 `signal` 在停止、替换和 `dispose()` 时触发；异步生成器还会收到一次 `return()` 请求。`exited` 总是以 `{ outcome: 'fulfilled' }` 或 `{ outcome: 'rejected', error }` 完成，不会以错误结束。自定义 AsyncIterable 的 `return()` 失败会立即报告，但 `exited` 要等进行中的 `next()` 结束才完成，名额也保留到那时。

协作式结束依赖任务自己结束。不理会取消的任务可能超过 5 秒的回收时限：监督器报告 `REAP_TIMEOUT`，把它记为 `abandoned`，并在它真正退出前一直保留预算名额。监督器不能打断同步循环，也不能把崩溃隔离在事件循环之外。因此 `fault-isolation` 能力是 `unsupported`；在默认的 `isolation: 'required'` 下请求这项能力会被拒绝。

`replace({ strategy: 'start-then-switch' })` 要求预算能同时容纳两个单元。新实例准备好、`switched` 事件发出之前，旧实例一直可用；之后旧任务才收到取消信号。`replace({ spec })` 在动当前单元之前先校验新规格。默认策略先停旧实例，再启动新实例。

任务调用 `heartbeat()`，或者从异步生成器中产出值时，可以使用 `heartbeat: { timeoutMs, intervalMs?, failureThreshold? }`。错过心跳会变成 `UNHEALTHY`，`cause` 链上有 `HEARTBEAT_MISSED`。`heartbeat` 和通用的 `health` 选项不能同时使用。

## 进程的完整契约

`@migaia/supervision/process` 是与平台无关的契约。你提供的启动器的 `launch(spec, context)` 必须不经过 shell 启动进程，只传递 `env.inherit` 里列出的环境变量和 `env.set`，从启动开始就通过 `context.output` 读取每个设为 `drain` 的输出流，并且只在进程和启动器自己持有的资源都关闭后，才让 `handle.exited` 完成。启动器必须生成一个在 pid 被复用时会变化的指纹，幂等地结束声明的进程树，并如实报告各项能力的强度。profile 本身从不调用平台的进程创建 API。

```ts
import { createUnitBudget } from '@migaia/supervision'
import {
  createProcessSupervisor,
  StdinMode,
  StdoutMode,
  StderrMode
} from '@migaia/supervision/process'
import type { IProcessLauncher } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
const budget = createUnitBudget({ kind: 'process', maxUnits: 2 })
const supervisor = createProcessSupervisor({
  id: 'service',
  launcher,
  budget,
  spec: {
    command: '/usr/bin/service',
    args: [],
    env: { inherit: [], set: {} },
    stdio: { stdin: StdinMode.ignore, stdout: StdoutMode.drain, stderr: StderrMode.drain }
  },
  report: (error) => {
    console.error(error)
  }
})

const outcome = await supervisor.start()
if (outcome.state === 'ready') {
  // 通过 outcome.unit 使用启动器提供的通信通道。
}
await supervisor.dispose()
```

默认隔离要求是 `required`：缺少 `termination` 或 `fault-isolation` 保证时，创建监督器会抛出 `CAPABILITY_UNSUPPORTED`。调用方可以显式选择 `best-effort` 并查看 `degraded`，但这不会让启动器真正获得那些保证。要监控内存或 CPU 上限，启动器需要实现 `sampleUsage`；默认每 1 秒采样一次。`sampleUsage` 连续 3 次失败会把进程判定为不健康；一次成功的采样超过上限，进程会被立即结束。监督器和预热池都要求 `usage.intervalMs` 是大于零的有限数，`failureThreshold` 是正整数。每个输出流保留最近 65,536 字节。父进程断开保护默认给收尾 5 秒；预热的空闲进程默认保留 60 秒。

启动密钥（bootstrap）只能通过标准输入的前缀或专用的文件描述符传递，绝不能放在参数、环境变量、错误、快照或日志里。无法证明某种传递方式安全时，启动器必须把 `bootstrap-stdin` 或 `bootstrap-fd` 声明为 `unsupported`。Electron 的 `utilityProcess` 目前两种方式都不支持。Windows 上只有在启动器证明进程是在 Job Object 中创建的（或者先挂起创建、加入 Job Object 后再恢复，并处理好失败清理）之后，才能把进程树结束声明为 `enforced`。本包的内存测试不能证明这些平台保证。

持久回收：注入 registry，并在创建监督器或预热池之前调用 `reclaimOrphanProcesses`。回收只结束指纹仍然匹配的记录；pid 已被复用的记录只删除、不结束。失败的记录会保留，供下次再试。预热池使用和监督器相同的预算、启动器和规格对象；它启动空闲进程，但监督器取用后仍会执行就绪检查。`restart()` 和 `replace()` 会绕过过时的空闲进程。预热池和监督器使用相同的 id、registry 和 namespace 时，取用会沿用预热进程已有的持久记录及其退出清理；不同的拥有者各自登记记录。在补发缓冲输出或实时转发时，输出回调抛出的异常会被报告，但不会中断输出。registry 的 `list` 失败会以 `ORPHAN_RECLAIM_FAILED` 收集并报告，`detail.step` 为 `list`，此时不会动任何记录。

## 线程的完整契约

`@migaia/supervision/threads` 提供与运行时无关的线程契约。你提供的启动器的 `launch(spec, context)` 创建一个线程，返回可以幂等结束的句柄。它的 `exited` 只能在线程代码停止执行后完成，而且不能以错误结束。如果一个 Web 风格的线程在 error 事件之后仍在运行，启动器必须结束它，并以 `{ code: null, error }` 完成 `exited`。仅仅发出结束请求，或者收到运行时的关闭标记，都不能作为线程已经退出的证据。如果 `context.signal` 已经被取消，启动器必须拒绝，而不是创建线程。

```ts
import { createUnitBudget } from '@migaia/supervision'
import { createThreadSupervisor, ThreadUnitKind } from '@migaia/supervision/threads'
import type { IThreadLauncher } from '@migaia/supervision/threads'

declare const launcher: IThreadLauncher
const budget = createUnitBudget({ kind: ThreadUnitKind.thread, maxUnits: 2 })
const supervisor = createThreadSupervisor({
  id: 'compute',
  launcher,
  budget,
  spec: { entry: './compute-thread.js', limits: { heapBytes: 32 * 1024 * 1024 } },
  report: (error) => {
    console.error(error)
  }
})

const outcome = await supervisor.start()
if (outcome.state === 'ready') {
  // 通过 outcome.unit 关联的通道使用这个线程。
}
await supervisor.dispose()
```

启动器必须如实声明 `termination: 'enforced' | 'monitored' | 'unsupported'` 和 `fault-isolation: 'unsupported'`。在 `required` 隔离要求下，`enforced` 或 `monitored` 的结束能力可以通过，`unsupported` 会被拒绝；`monitored` 不代表运行时会强制执行。启动器还要如实声明 `heap-limit: 'enforced' | 'unsupported'` 和 `exit-observation: 'enforced' | 'unsupported'`。只有 `heap-limit` 为 `enforced` 时才接受 `heapBytes`；`callWallTimeMs` 原样交给启动器，用于它面向调用方的操作。不能可靠观察退出的启动器必须配置 `health` 检查，这样无声退出或停滞的线程才能被发现并结束。监督器不采样堆内存，线程也没有单独的“正常退出”阶段：先执行可选的 `beforeTerminate`，然后调用一次 `terminate()`，再在回收时限内等待线程真正退出。没有确认退出时，预算名额保持占用。

需要隔离崩溃、限制 CPU、持久回收遗留单元或读取输出时，选择 `@migaia/supervision/process`。线程代码和宿主共用同一个进程，无法提供这些保证。各平台的适配器及其验证属于对应的适配包；本包的内存测试不代表 Bun、Deno、浏览器或 Electron 的线程结束行为已经被验证。

## 选项校验

- `health.intervalMs` 必须是大于零的有限数，周期检查不能以零间隔运行。
- `startupTimeoutMs` 可以为零，表示启动立即到期。
- `restart.mode` 只接受 `never`、`on-failure`、`always`；未知取值在创建时被拒绝。
- `terminalPolicy.mode` 只接受 `stay` 或 `cooldown`。
- `isolation` 只接受 `required` 或 `best-effort`。
- `stop` 的三段时限都可以为零，表示立即到期。
- 未知的替换策略会在排队或停止当前单元之前抛出 `INVALID_OPTION`。预热池和监督器用同样的方式接收注入的 scheduler。
