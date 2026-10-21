import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems each supervision API solves, told as a situation, a runnable fix and the observed
 * output. Every example was run with Node 24 against the built packages and its printed output is
 * quoted in `result`.
 */
export const supervisionCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createCoroutineSupervisor: [
    {
      title: t('Retry a service until it is really usable', '服务启动失败时自动重试，直到真正可用'),
      problem: t(
        'A formatter service fails on its first two starts, for example because a dependency is still warming up; the caller gets either an error or a half-started service.\n\nHand-written code either gives up after one failure or retries in a tight loop, and often hands the service to callers before it is really usable.\n\nThe supervisor waits a little after each failure before restarting, and `start()` returns `ready` only once the service has published its interface.',
        '格式化服务前两次启动都失败了，比如依赖还没准备好；调用方要么拿到错误，要么拿到一个启动到一半的服务。\n\n手写代码要么失败一次就放弃，要么不停地立即重试；而且常常在服务真正可用之前就把它交给调用方。\n\n监督器在每次失败后等待一段时间再重启，服务发布接口之后，`start()` 才返回 `ready`。'
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let launches = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const formatter = createCoroutineSupervisor<{ format(text: string): string }>({
  id: 'formatter',
  budget,
  spec: {
    task: async ({ expose, signal }) => {
      launches += 1
      if (launches <= 2) throw new Error(\`start \${launches} failed\`)
      expose({ format: (text) => text.trim().replace(/\\s+/g, ' ') })
      // Keep serving until the supervisor asks this task to stop.
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  restart: { initialDelayMs: 100 },
  report: console.error
})

const outcome = await formatter.start()
if (outcome.state === 'ready') {
  const service = await outcome.unit.exposed
  console.log(service.format('  hello    world  '), '| launches:', launches)
}
await formatter.dispose()
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let launches = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const formatter = createCoroutineSupervisor<{ format(text: string): string }>({
  id: 'formatter',
  budget,
  spec: {
    task: async ({ expose, signal }) => {
      launches += 1
      if (launches <= 2) throw new Error(\`第 \${launches} 次启动失败\`)
      expose({ format: (text) => text.trim().replace(/\\s+/g, ' ') })
      // 一直提供服务，直到监督器发出停止信号。
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  restart: { initialDelayMs: 100 },
  report: console.error
})

const outcome = await formatter.start()
if (outcome.state === 'ready') {
  const service = await outcome.unit.exposed
  console.log(service.format('  hello    world  '), '| 启动次数:', launches)
}
await formatter.dispose()
budget.close()`
      },
      result: t(
        'Prints `hello world | launches: 3`.\n\nThe two failed starts were retried after a delay, and the caller never saw a half-started service.',
        '输出 `hello world | 启动次数: 3`。\n\n两次失败的启动都在等待后自动重试，调用方从没拿到启动到一半的服务。'
      )
    },
    {
      title: t(
        'Stop a crash loop and keep the original error',
        '崩溃太多次就停下，并保留最初的错误'
      ),
      problem: t(
        'A task crashes immediately because a config file is missing, and the log fills with hundreds of restarts per second.\n\nRestarting forever floods CPU and logs, and hand-written restarts often wrap away the original error until only "restart failed" is left.\n\nBy default the supervisor waits 250 ms, then doubles the wait up to 30 s, and allows at most 5 automatic restarts within 60 s; the next failure moves it to `terminal` and reports `SUPERVISION_EXHAUSTED`. The original error stays on the `cause` chain.',
        '任务因为配置文件缺失一启动就崩溃，日志里每秒刷出上百条重启记录。\n\n无限重启会打满 CPU 和日志；手写的重启又常常把原始错误包装丢掉，最后只看到“重启失败”。\n\n监督器默认先等 250 毫秒，之后每次翻倍、最长 30 秒，60 秒内最多自动重启 5 次；再失败就进入 `terminal`，并报告 `SUPERVISION_EXHAUSTED`。最初的错误一直保留在 `cause` 链上。'
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
let launches = 0
const thumbnailer = createCoroutineSupervisor({
  id: 'thumbnailer',
  budget,
  spec: {
    task: async () => {
      launches += 1
      throw new Error('config file missing')
    }
  },
  restart: { initialDelayMs: 10, maxRestarts: 3 },
  report: (error) => {
    // Follow the cause chain all the way to the first error.
    const chain: string[] = []
    for (let current: any = error; current; current = current.cause)
      chain.push(current.code ?? current.message)
    console.log(chain.join(' <- '))
  }
})

const outcome = await thumbnailer.start()
console.log('start():', outcome.state, '| launches:', launches, '| slots in use:', budget.inUse)
await thumbnailer.dispose()
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
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
budget.close()`
      },
      result: t(
        'Prints `SUPERVISION_EXHAUSTED <- LAUNCH_FAILED <- EXIT_UNEXPECTED <- config file missing`, then `start(): terminal | launches: 4 | slots in use: 0`.\n\nIt stopped after one start and three restarts, the slot was released, and the root cause is one `cause` walk away.',
        '输出 `SUPERVISION_EXHAUSTED <- LAUNCH_FAILED <- EXIT_UNEXPECTED <- 配置文件缺失`，然后是 `start(): terminal | 启动次数: 4 | 占用名额: 0`。\n\n一次启动加三次重启后停下，名额已归还，沿 `cause` 就能找到根因。'
      )
    },
    {
      title: t('Restart a task that is stuck but still "running"', '任务卡住但没退出时自动重启'),
      problem: t(
        'A scanner hangs on a request that never returns, while its status keeps saying "running".\n\nIt has not exited, so hand-written supervision that only listens for exit cannot catch it; detecting a hang means keeping a timeout timer by hand and resetting it at every step.\n\nWith `heartbeat`, the task calls `heartbeat()` after each unit of work; when no heartbeat arrives within `timeoutMs`, the run is ended as unhealthy and restarted.',
        '扫描任务卡在一个永远不返回的请求上，状态却一直显示“运行中”。\n\n它没有退出，只监听退出的手写监督发现不了；要发现卡死，得自己维护超时计时器，并在每一步重置它。\n\n配置 `heartbeat` 后，任务每完成一步就调用一次 `heartbeat()`；超过 `timeoutMs` 没有心跳，这次运行就被判定为不健康，结束后重新开始。'
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
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
          // A stuck request. It honours the stop signal, so the supervisor can end it.
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        if (signal.aborted) return
        await new Promise((resolve) => setTimeout(resolve, 20))
        heartbeat()
        console.log(\`run \${run}: page \${page} done\`)
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
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
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
        console.log(\`第 \${run} 次运行：完成第 \${page} 页\`)
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
budget.close()`
      },
      result: t(
        'The first run finishes pages 1 and 2, then `exit: unhealthy`; the second run finishes pages 1 to 3 and ends with `exit: exited`.\n\nThe hang was detected and restarted. A task that ignores the stop signal entirely cannot be forced to end; use a process for that.',
        '第一次运行完成第 1、2 页后出现 `exit: unhealthy`；第二次运行完成第 1 到 3 页，以 `exit: exited` 结束。\n\n卡死被发现并重启了。完全不理会停止信号的任务无法被强制结束，那种情况请改用子进程。'
      )
    },
    {
      title: t('Ship a new version without a gap or overlap', '发布新版本时不断档、不重叠'),
      problem: t(
        "Shipping a new consumer version either leaves a window with nobody consuming the queue, or lets two versions consume the same job.\n\nStop-then-start leaves a gap; start-then-stop by hand can let both versions consume at once, and the old one may already be stopped when the new one fails to start.\n\n`replace({ strategy: 'start-then-switch' })` starts the new unit, switches only when it is ready, and only then stops the old one. The budget needs room for two units.",
        "发布新版本的消费者时，要么有一段时间没人消费队列，要么两个版本同时消费同一条任务。\n\n先停旧再起新，中间留下空档；手写先起新再停旧，又可能两个版本同时消费，而且新版本启动失败时旧版本已经停了。\n\n`replace({ strategy: 'start-then-switch' })` 先启动新实例，准备好后才切换，然后才停止旧实例。预算需要能同时容纳两个单元。"
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
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
      console.log(\`v\${mine} consuming\`)
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      console.log(\`v\${mine} stopped\`)
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: console.error
})
consumer.subscribe((event) => {
  if (event.type === 'switched') console.log(\`switched: generation \${event.from} -> \${event.to}\`)
})

await consumer.start()
const outcome = await consumer.replace({ strategy: 'start-then-switch' })
console.log('replace():', outcome.kind)
await consumer.dispose()
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
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
      console.log(\`v\${mine} 开始消费\`)
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      console.log(\`v\${mine} 停止消费\`)
    }
  },
  ready: (unit) => unit.exposed.then(() => undefined),
  report: console.error
})
consumer.subscribe((event) => {
  if (event.type === 'switched') console.log(\`切换: generation \${event.from} -> \${event.to}\`)
})

await consumer.start()
const outcome = await consumer.replace({ strategy: 'start-then-switch' })
console.log('replace():', outcome.kind)
await consumer.dispose()
budget.close()`
      },
      result: t(
        'Prints `v1 consuming`, `v2 consuming`, `switched: generation 1 -> 2`, `v1 stopped`, `replace(): replaced`, then `v2 stopped` on dispose.\n\nv1 kept serving until v2 was ready. If v2 fails to start, `replace()` resolves `failed` and v1 keeps serving.',
        '依次输出 `v1 开始消费`、`v2 开始消费`、`切换: generation 1 -> 2`、`v1 停止消费`、`replace(): replaced`，释放时输出 `v2 停止消费`。\n\nv2 准备好之前 v1 一直在服务。v2 启动失败时，`replace()` 返回 `failed`，v1 继续服务。'
      )
    }
  ],
  createProcessSupervisor: [
    {
      title: t(
        "Supervise a real child process instead of `on('exit')`",
        "用监督器代替手写的 `on('exit')` 重启"
      ),
      problem: t(
        "A child process exits on start because of a config error, and the restart inside its `exit` handler runs hundreds of times per second.\n\nThe usual hand-written loop restarts a child inside `child.on('exit')`: a child that crashes on start is restarted with no delay or limit, and the listener even restarts it during shutdown.\n\nThe process supervisor gives a real child process spaced, bounded restarts and a clear end state. Here a real Node child always exits with code 3 after 200 ms. The Node launcher comes from `@migaia/rpc-process`; it cannot guarantee ending a whole process tree, so `isolation: 'best-effort'` accepts that gap explicitly.",
        "子进程因为配置错误一启动就退出，`exit` 事件里的重启每秒执行上百次。\n\n常见的手写写法在 `child.on('exit')` 里重新启动子进程：启动就崩溃时会立即重启、没有上限，连关闭途中也会被重新拉起。\n\n进程监督器为真实子进程提供有间隔、有上限的重启和明确的终态。下面的 Node 子进程每次启动 200 毫秒后都以退出码 3 崩溃。Node 启动器来自 `@migaia/rpc-process`；它不能保证结束整个进程树，所以用 `isolation: 'best-effort'` 显式接受这一点。"
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'

const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const indexer = createProcessSupervisor({
  id: 'search-indexer',
  launcher: createNodeProcessLauncher(),
  budget,
  // The Node launcher cannot guarantee ending a whole process tree; accept that explicitly.
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
  if (event.type === 'restart') console.log('restart', event.count, 'succeeded')
})

await indexer.start()
await new Promise((resolve) => setTimeout(resolve, 2000))
console.log('final state:', indexer.state)
await indexer.dispose()
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
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
budget.close()`
      },
      result: t(
        "Prints `report: CAPABILITY_UNSUPPORTED` once (the accepted gap, also in `inspect().degraded`), three `exit: crashed { code: 3, signal: null }` with two successful restarts between them, then `report: SUPERVISION_EXHAUSTED` and `final state: terminal`.\n\nRestarts are spaced and bounded, and the supervisor ends in a terminal state. Without `isolation: 'best-effort'`, creating the supervisor throws `CAPABILITY_UNSUPPORTED`.",
        "先输出一次 `report: CAPABILITY_UNSUPPORTED`（已接受的能力缺口，也记在 `inspect().degraded` 里），然后三次 `exit: crashed { code: 3, signal: null }`，中间两次重启成功，最后是 `report: SUPERVISION_EXHAUSTED` 和 `最终状态: terminal`。\n\n重启有间隔、有上限，最后停在终态。不写 `isolation: 'best-effort'` 时，创建监督器会直接抛出 `CAPABILITY_UNSUPPORTED`。"
      )
    }
  ],
  createUnitBudget: [
    {
      title: t('Cap how many jobs run at once', '限制同时运行的任务数量'),
      problem: t(
        'A bulk export starts one job per file and the machine runs out of memory.\n\nHand-written concurrency limits tend to live at each call site, each supervisor managing its own, and together they still exceed what the machine can take.\n\nSupervisors that share one budget take turns: when every slot is taken, a start queues (for up to 30 s by default) until a slot frees up.',
        '批量导出为每个文件起一个任务，机器内存被耗尽。\n\n手写的并发控制往往散在各个调用点，每个监督器各管各的，合起来仍会超过机器的承受能力。\n\n共用同一个预算的监督器会轮流运行：名额用完时，新的启动请求排队等待（默认最多 30 秒），直到有名额空出来。'
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

// Three export jobs share one budget; at most two run at the same time.
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
let running = 0
const exportFile = (name: string) =>
  createCoroutineSupervisor({
    id: \`export-\${name}\`,
    budget,
    spec: {
      task: async () => {
        running += 1
        console.log(\`exporting \${name}, running: \${running}\`)
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
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

// 三个导出任务共用一个预算，同一时刻最多运行两个。
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2 })
let running = 0
const exportFile = (name: string) =>
  createCoroutineSupervisor({
    id: \`export-\${name}\`,
    budget,
    spec: {
      task: async () => {
        running += 1
        console.log(\`开始导出 \${name}，同时运行: \${running}\`)
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
budget.close()`
      },
      result: t(
        'Prints running counts 1, 2, 2.\n\n`c.csv` starts only after `a.csv` finished and freed its slot, so no more than 2 jobs ever run at once.',
        '输出的同时运行数依次是 1、2、2。\n\n`c.csv` 等 `a.csv` 结束、名额空出来之后才开始，同时运行的任务从未超过 2 个。'
      )
    },
    {
      title: t('Free a slot only after a real exit', '任务真正退出后才归还名额'),
      problem: t(
        'A job ignores the stop signal, a new job has already started, and both write the same files at once.\n\nHand-written code often treats a job as finished as soon as `stop()` was called and lets new work in, while the old job is in fact still running.\n\n`stop()` still returns within its deadlines (drain, exit and reap, 5 s each by default), but the job keeps its slot until it really ends, so new work never runs next to a job that has not finished stopping.',
        '某个任务不理会停止信号，新任务却已经启动，两份工作同时写同一批文件。\n\n手写代码常在调用 `stop()` 之后就认为任务结束了，立刻放行新任务，而旧任务其实还在跑。\n\n`stop()` 仍会在时限内返回（收尾、退出、回收三段，默认各 5 秒），但这个任务会一直占着名额，直到它真正结束，新工作不会和没停干净的任务同时运行。'
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const job = createCoroutineSupervisor({
  id: 'export-job',
  budget,
  spec: {
    task: async () => {
      // Ignores the stop signal and ends on its own after 300 ms.
      await new Promise((resolve) => setTimeout(resolve, 300))
      console.log('task actually ended')
    }
  },
  stop: { drainTimeoutMs: 0, exitTimeoutMs: 50, reapTimeoutMs: 50 },
  report: (error) => console.log('report:', (error as { code?: string }).code)
})

await job.start()
await job.stop()
console.log('stop() returned, slots in use:', budget.inUse)
const attempt = budget.tryAcquire()
console.log('asking for a slot now:', attempt.kind === 'rejected' ? attempt.reason : attempt.kind)
await new Promise((resolve) => setTimeout(resolve, 400))
console.log('after the task ended, slots in use:', budget.inUse)
await job.dispose()
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
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
budget.close()`
      },
      result: t(
        'Prints `report: REAP_TIMEOUT`, then `slots in use: 1` and `full` right after `stop()` returned, `task actually ended`, and finally `slots in use: 0`.\n\nThe slot was released only after the job really ended.',
        '依次输出 `report: REAP_TIMEOUT`、`stop()` 返回后 `占用名额: 1` 和 `full`、`任务真正结束`，最后是 `占用名额: 0`。\n\n名额在任务真正结束后才归还。'
      )
    }
  ],
  createParentLossGuard: [
    {
      title: t('Let a child clean up when its parent dies', '父进程消失后，子进程自己收尾退出'),
      problem: t(
        'After the parent is killed, the child keeps holding memory, and the next start spawns another batch.\n\nA parent that is killed cannot send its children a normal stop request, and a child\'s hand-written "exit when the parent is gone" often skips cleanup or hangs in it forever.\n\nCall `trigger()` when the parent connection closes: the guard runs `shutdown` once and always calls `exit` within `graceMs`, with code 0 when cleanup completed and 1 on timeout or failure.',
        '父进程被强制结束后，子进程一直占着内存，下次启动又起一批。\n\n父进程被杀时来不及给子进程发正常的停止请求；子进程自己手写的“父进程没了就退出”又常常漏掉收尾，或者收尾卡住永远不退出。\n\n在父连接关闭时调用 `trigger()`：守卫只执行一次 `shutdown`，并保证在 `graceMs` 内调用 `exit`，收尾完成时退出码为 0，超时或失败时为 1。'
      ),
      example: {
        en: `import { createParentLossGuard } from '@migaia/supervision/process'

const guard = createParentLossGuard({
  graceMs: 1000,
  shutdown: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    console.log('progress saved')
  },
  exit: (code) => console.log('exit code:', code),
  report: console.error
})
guard.trigger() // In a real program, call this when the parent connection closes.
await new Promise((resolve) => setTimeout(resolve, 100))`,
        zh: `import { createParentLossGuard } from '@migaia/supervision/process'

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
await new Promise((resolve) => setTimeout(resolve, 100))`
      },
      result: t(
        'Prints `progress saved`, then `exit code: 0`.\n\nThe child cleaned up and exited on time; repeated triggers do nothing.',
        '输出 `进度已保存`，然后是 `退出码: 0`。\n\n收尾完成后按时退出；重复调用 `trigger()` 没有效果。'
      )
    }
  ],
  reclaimOrphanProcesses: [
    {
      title: t('Clean up processes the previous run left behind', '启动时清理上次遗留的子进程'),
      problem: t(
        'After a crash, the next start spawns a new batch of children while the old ones still run.\n\nCleaning up leftovers by pid is dangerous: the old pid may now belong to another program, and killing it from the record ends the wrong process.\n\nWith a durable registry, `reclaimOrphanProcesses` ends only processes whose fingerprint still matches; a pid now used by another program has its record removed and is never killed.',
        '程序崩溃后再次启动，又起了一批子进程，旧的那批还在运行。\n\n按 pid 清理遗留进程很危险：原来的 pid 可能已经被别的程序复用，按记录直接 kill 会误杀。\n\n配合持久的进程记录，`reclaimOrphanProcesses` 只结束指纹仍然匹配的进程；如果原来的 pid 已被别的程序复用，只删除记录，绝不误杀。'
      ),
      example: {
        en: `import { reclaimOrphanProcesses } from '@migaia/supervision/process'
import type { IProcessLauncher, IProcessRecord, IProcessRegistry } from '@migaia/supervision/process'

// An in-memory stand-in for durable storage; use a file or database in practice.
const records = new Map<string, IProcessRecord>([
  ['a', { id: 'a', namespace: 'indexer', identity: { fingerprint: 'boot-1:4101', pid: 4101 }, launchedAt: 0 }],
  ['b', { id: 'b', namespace: 'indexer', identity: { fingerprint: 'boot-1:4102', pid: 4102 }, launchedAt: 0 }]
])
const registry: IProcessRegistry = {
  add: async (record) => void records.set(record.id, record),
  remove: async (id) => void records.delete(id),
  list: async (namespace) => [...records.values()].filter((record) => record.namespace === namespace)
}
// Reclaiming needs a launcher that can probe and end recorded processes; only those steps are faked here.
const launcher: IProcessLauncher = {
  capabilities: {},
  launch: () => Promise.reject(new Error('this launcher only reclaims')),
  probe: async (record) => (record.identity.pid === 4101 ? 'alive' : 'reused'),
  terminateRecord: async (record) => console.log('ending leftover process', record.identity.pid)
}
const result = await reclaimOrphanProcesses({ registry, namespace: 'indexer', launcher, report: console.error })
console.log('terminated:', result.terminated, '| records removed:', result.removed)`,
        zh: `import { reclaimOrphanProcesses } from '@migaia/supervision/process'
import type { IProcessLauncher, IProcessRecord, IProcessRegistry } from '@migaia/supervision/process'

// 这里用内存模拟持久存储，真实程序里应该写到文件或数据库。
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
console.log('已结束:', result.terminated, '| 已删除记录:', result.removed)`
      },
      result: t(
        "Prints `ending leftover process 4101`, then `terminated: [ 'a' ] | records removed: [ 'a', 'b' ]`.\n\n4102 was reused by another program, so only its record was removed and the process was left alone.",
        "输出 `结束遗留进程 4101`，然后是 `已结束: [ 'a' ] | 已删除记录: [ 'a', 'b' ]`。\n\n4102 已被别的程序复用，所以只删除了记录，没有结束它。"
      )
    }
  ],
  createPrewarmPool: [
    {
      title: t('Skip the cold start', '省掉冷启动的等待'),
      problem: t(
        "Spawning a process on every request adds start-up time to the user's wait.\n\nHand-written warm pools usually keep their own count, separate from the supervisor's concurrency limit, so together they easily exceed it; a broken idle process also goes unnoticed.\n\nA prewarm pool keeps idle processes ready, and `start()` takes one instead of spawning. The pool must share the same budget, launcher and spec objects with the supervisor, and idle processes hold budget slots.",
        '每次请求都现起一个进程，用户要多等一段启动时间。\n\n手写的预热池通常单独计数，和监督器的并发上限各管各的，合起来很容易超出限制；空闲进程坏了也没人发现。\n\n预热池让空闲进程提前就绪，`start()` 直接取用一个，不再现起。预热池必须和监督器共用同一个预算、启动器和规格对象，空闲进程同样占用预算名额。'
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
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
console.log('idle processes:', pool.idle)

const renderer = createProcessSupervisor({ ...options, prewarm: pool })
const outcome = await renderer.start()
console.log('start():', outcome.state, '| idle left:', pool.idle)
await renderer.dispose()
await pool.dispose()
budget.close()`,
        zh: `import { createUnitBudget } from '@migaia/supervision'
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
budget.close()`
      },
      result: t(
        'Prints `idle processes: 1`, then `start(): ready | idle left: 0`.\n\nThe supervisor took the warm process instead of spawning one.',
        '输出 `空闲进程: 1`，然后是 `start(): ready | 剩余空闲进程: 0`。\n\n监督器直接取用了预热好的进程，没有现起新进程。'
      )
    }
  ]
}
