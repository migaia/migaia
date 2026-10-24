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
        "A child process exits on start because of a config error, and the restart inside its `exit` handler runs hundreds of times per second.\n\nThe usual hand-written loop restarts a child inside `child.on('exit')`: a child that crashes on start is restarted with no delay or limit, and the listener even restarts it during shutdown.\n\nThe process supervisor gives a real child process spaced, bounded restarts and a clear end state. Here a real Node child always exits with code 3 after 200 ms. The Node launcher comes from `@migaia/rpc-plugin-process`; it cannot guarantee ending a whole process tree, so `isolation: 'best-effort'` accepts that gap explicitly.",
        "子进程因为配置错误一启动就退出，`exit` 事件里的重启每秒执行上百次。\n\n常见的手写写法在 `child.on('exit')` 里重新启动子进程：启动就崩溃时会立即重启、没有上限，连关闭途中也会被重新拉起。\n\n进程监督器为真实子进程提供有间隔、有上限的重启和明确的终态。下面的 Node 子进程每次启动 200 毫秒后都以退出码 3 崩溃。Node 启动器来自 `@migaia/rpc-plugin-process`；它不能保证结束整个进程树，所以用 `isolation: 'best-effort'` 显式接受这一点。"
      ),
      example: {
        en: `import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
import { createNodeProcessLauncher } from '@migaia/rpc-plugin-process/adapters/node-child-process'

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
import { createNodeProcessLauncher } from '@migaia/rpc-plugin-process/adapters/node-child-process'

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
import { createNodeProcessLauncher } from '@migaia/rpc-plugin-process/adapters/node-child-process'

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
import { createNodeProcessLauncher } from '@migaia/rpc-plugin-process/adapters/node-child-process'

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

/** Short application snippets; validation contexts stay outside the repository. */
export const supervisionOptionExamples = {
  basic: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const formatter = createCoroutineSupervisor({
  id: 'document-formatter',
  budget,
  spec: { task: runFormatter },
  report: reportToMonitoring
})
showFormatterState((await formatter.start()).state)
onEditorClosed(async () => {
  await formatter.dispose()
  budget.close()
})`,
  ready: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  ready: async (handle, signal) => {
    await checkFormatter(await handle.exposed, signal)
  },
  startupTimeoutMs: 2000,
  scheduler: applicationScheduler
})
showFormatterState((await supervisor.start()).state)`,
  stop: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  report: reportToMonitoring,
  stop: {
    beforeTerminate: (handle, signal, remainingMs) =>
      flushPendingWrites(handle, signal, remainingMs()),
    drainTimeoutMs: 2000,
    exitTimeoutMs: 1000,
    reapTimeoutMs: 1000
  }
})
await supervisor.start()
onEditorClosed(() => supervisor.stop())`,
  restart: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: {
    mode: 'on-failure',
    initialDelayMs: 250,
    factor: 2,
    maxDelayMs: 5000
  }
})
showFormatterState((await supervisor.start()).state)`,
  terminal: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { maxRestarts: 3, windowMs: 60000 },
  terminalPolicy: { mode: 'cooldown', afterMs: 30000 }
})
await supervisor.start()`,
  health: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  health: {
    check: (handle, signal) => checkFormatter(handle, signal),
    intervalMs: 5000,
    timeoutMs: 1000,
    failureThreshold: 2
  }
})
await supervisor.start()`,
  isolation: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  requires: ['fault-isolation'],
  isolation: 'best-effort'
})
showRuntimeGuarantees(supervisor.inspect().degraded)`,
  heartbeat: `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  heartbeat: {
    timeoutMs: 10000,
    intervalMs: 2000,
    failureThreshold: 2
  }
})
await supervisor.start()`,
  budgetQueue: `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  kind: 'process',
  maxUnits: 2,
  parent: applicationProcessBudget,
  overflow: 'queue',
  queueTimeoutMs: 5000,
  scheduler: applicationScheduler
})
startPreviewQueue(budget)`,
  budgetRate: `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  kind: 'process',
  maxUnits: 2,
  overflow: 'reject',
  launchRate: { max: 4, windowMs: 1000 }
})
startPreviewQueue(budget)`,
  custom: `import { createSupervisor } from '@migaia/supervision'

const formatter = createSupervisor({
  id: 'document-formatter',
  launcher: documentLauncher,
  profile: documentProfile,
  spec: documentSpec,
  budget: documentBudget,
  report: reportToMonitoring
})
showFormatterState((await formatter.start()).state)
onEditorClosed(() => formatter.dispose())`,
  customHooks: `import { createSupervisor } from '@migaia/supervision'

const supervisor = createSupervisor({
  ...documentOptions,
  hooks: {
    afterLaunch: (handle) => attachFormatterDiagnostics(handle),
    inspectUnit: (handle) => describeFormatter(handle)
  }
})
await supervisor.start()
renderFormatterDiagnostics(supervisor.inspect())`,
  processOutput: `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  output: {
    tailBytes: 4096,
    onChunk: (stream, bytes) => appendRendererOutput(stream, bytes)
  }
})
await supervisor.start()
onPreviewClosed(() => supervisor.dispose())`,
  processUsage: `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  usage: { intervalMs: 2000, failureThreshold: 3 }
})
await supervisor.start()`,
  registry: `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  registry: { port: processRegistry, namespace: 'preview-renderers' },
  wallClock: { timestamp: () => Date.now() }
})
await supervisor.start()`,
  prewarm: `import { createPrewarmPool, createProcessSupervisor } from '@migaia/supervision/process'

const pool = createPrewarmPool({ ...rendererOptions, size: 1, idleTimeoutMs: 30000 })
await waitForIdleRenderer(pool)
const renderer = createProcessSupervisor({ ...rendererOptions, prewarm: pool })
showPreviewState((await renderer.start()).state)
onPreviewClosed(async () => {
  await renderer.dispose()
  await pool.dispose()
})`,
  prewarmDisabled: `import { createPrewarmPool } from '@migaia/supervision/process'

const pool = createPrewarmPool({ ...rendererOptions, size: 0 })
registerPreviewPool(pool)`,
  prewarmPolicy: `import { createPrewarmPool } from '@migaia/supervision/process'

const pool = createPrewarmPool({
  ...rendererOptions,
  size: 1,
  startupTimeoutMs: 3000,
  idleTimeoutMs: 30000,
  exitTimeoutMs: 1000,
  reapTimeoutMs: 1000,
  scheduler: applicationScheduler
})
registerPreviewPool(pool)`,
  thread: `import { createUnitBudget } from '@migaia/supervision'
import { createThreadSupervisor } from '@migaia/supervision/threads'

const worker = createThreadSupervisor({
  ...imageWorkerOptions,
  budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
  requires: ['termination'],
  isolation: 'required'
})
showImageWorkerState((await worker.start()).state)
onImageEditorClosed(() => worker.dispose())`,
  threadHealth: `import { createThreadSupervisor } from '@migaia/supervision/threads'

const supervisor = createThreadSupervisor({
  ...imageWorkerOptions,
  ready: (handle, signal) => checkImageWorker(handle, signal),
  startupTimeoutMs: 2000
})
showImageWorkerState((await supervisor.start()).state)`,
  threadMonitor: `import { createThreadSupervisor } from '@migaia/supervision/threads'

const supervisor = createThreadSupervisor({
  ...imageWorkerOptions,
  health: {
    check: (handle, signal) => checkImageWorker(handle, signal),
    intervalMs: 5000,
    timeoutMs: 1000,
    failureThreshold: 2
  }
})
await supervisor.start()`,
  guard: `import { createParentLossGuard } from '@migaia/supervision/process'

const guard = createParentLossGuard({
  shutdown: (signal) => flushChildWrites(signal),
  exit: (code) => exitChild(code),
  report: reportToMonitoring,
  graceMs: 2000,
  scheduler: applicationScheduler
})
onParentDisconnected(() => guard.trigger())`,
  guardFailure: `import { createParentLossGuard } from '@migaia/supervision/process'

const guard = createParentLossGuard({
  shutdown: (signal) => closeChildResources(signal),
  exit: (code) => exitChild(code),
  report: reportToMonitoring
})
onParentDisconnected(() => guard.trigger())`,
  reclaim: `import { reclaimOrphanProcesses } from '@migaia/supervision/process'

const recovery = await reclaimOrphanProcesses({
  registry: processRegistry,
  namespace: 'preview-renderers',
  launcher: rendererLauncher,
  report: reportToMonitoring
})
showRecoverySummary(recovery)`,
  reclaimFailure: `import { reclaimOrphanProcesses } from '@migaia/supervision/process'

const recovery = await reclaimOrphanProcesses({
  registry: processRegistry,
  namespace: 'preview-renderers',
  launcher: rendererLauncher,
  report: (error) => showRecoveryWarning(error)
})
showRecoverySummary(recovery)`
}
/** Each option field can be copied without a complete supervisor demonstration. */
export const supervisionOptionFieldExamples: Readonly<Record<string, string>> = {
  'base.id': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  id: 'document-formatter'
})`,
  'base.report': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  report: reportToMonitoring
})`,
  'base.ready': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  ready: (handle, signal) => checkFormatter(handle, signal)
})`,
  'base.startupTimeoutMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  startupTimeoutMs: 2000
})`,
  'base.scheduler': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  scheduler: applicationScheduler
})`,
  'base.restart': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { mode: 'on-failure', initialDelayMs: 250 }
})`,
  'base.restart.mode': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { mode: 'on-failure' }
})`,
  'base.restart.initialDelayMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { initialDelayMs: 250 }
})`,
  'base.restart.factor': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { factor: 2 }
})`,
  'base.restart.maxDelayMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { maxDelayMs: 5000 }
})`,
  'base.restart.maxRestarts': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { maxRestarts: 3 }
})`,
  'base.restart.windowMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  restart: { windowMs: 60000 }
})`,
  'base.terminalPolicy': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  terminalPolicy: { mode: 'cooldown', afterMs: 30000 }
})`,
  'base.terminalPolicy.mode': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  terminalPolicy: { mode: 'stay' }
})`,
  'base.terminalPolicy.afterMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  terminalPolicy: { mode: 'cooldown', afterMs: 30000 }
})`,
  'base.stop': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  stop: { beforeTerminate: (handle, signal) => flushPendingWrites(handle, signal) }
})`,
  'base.stop.beforeTerminate': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  stop: { beforeTerminate: (handle, signal) => flushPendingWrites(handle, signal) }
})`,
  'base.stop.drainTimeoutMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  stop: { drainTimeoutMs: 2000 }
})`,
  'base.stop.exitTimeoutMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  stop: { exitTimeoutMs: 1000 }
})`,
  'base.stop.reapTimeoutMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  stop: { reapTimeoutMs: 1000 }
})`,
  'base.health': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  health: { check: (handle, signal) => checkFormatter(handle, signal) }
})`,
  'base.health.check': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  health: { check: (handle, signal) => checkFormatter(handle, signal) }
})`,
  'base.health.intervalMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  health: { check: (handle, signal) => checkFormatter(handle, signal), intervalMs: 5000 }
})`,
  'base.health.timeoutMs': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  health: { check: (handle, signal) => checkFormatter(handle, signal), timeoutMs: 1000 }
})`,
  'base.health.failureThreshold': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  health: { check: (handle, signal) => checkFormatter(handle, signal), failureThreshold: 2 }
})`,
  'base.isolation': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  isolation: 'best-effort'
})`,
  'base.requires': `import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const supervisor = createCoroutineSupervisor({
  ...formatterOptions,
  requires: ['fault-isolation'],
  isolation: 'best-effort'
})`,
  'launch.launcher': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  launcher: rendererLauncher
})`,
  'launch.spec': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  spec: rendererSpec
})`,
  'launch.budget': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  budget: rendererBudget
})`,
  'process.usage': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  usage: { intervalMs: 2000, failureThreshold: 3 }
})`,
  'process.usage.intervalMs': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  usage: { intervalMs: 2000 }
})`,
  'process.usage.failureThreshold': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  usage: { failureThreshold: 3 }
})`,
  'process.output': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  output: { tailBytes: 4096, onChunk: (stream, bytes) => appendRendererOutput(stream, bytes) }
})`,
  'process.output.tailBytes': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  output: { tailBytes: 4096 }
})`,
  'process.output.onChunk': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  output: { onChunk: (stream, bytes) => appendRendererOutput(stream, bytes) }
})`,
  'process.registry': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  registry: { port: processRegistry, namespace: 'preview-renderers' }
})`,
  'process.registry.port': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  registry: { port: processRegistry, namespace: 'preview-renderers' }
})`,
  'process.registry.namespace': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  registry: { port: processRegistry, namespace: 'preview-renderers' }
})`,
  'process.prewarm': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  prewarm: rendererPool
})`,
  'process.wallClock': `import { createProcessSupervisor } from '@migaia/supervision/process'

const supervisor = createProcessSupervisor({
  ...rendererOptions,
  wallClock: { timestamp: () => Date.now() }
})`,
  'budget.kind': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  kind: 'process'
})`,
  'budget.maxUnits': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  maxUnits: 2
})`,
  'budget.overflow': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  overflow: 'queue'
})`,
  'budget.queueTimeoutMs': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  queueTimeoutMs: 5000
})`,
  'budget.launchRate': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  launchRate: { max: 4, windowMs: 1000 }
})`,
  'budget.launchRate.max': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  launchRate: { max: 4, windowMs: 1000 }
})`,
  'budget.launchRate.windowMs': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  launchRate: { max: 4, windowMs: 1000 }
})`,
  'budget.parent': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  parent: applicationProcessBudget
})`,
  'budget.scheduler': `import { createUnitBudget } from '@migaia/supervision'

const budget = createUnitBudget({
  ...previewBudgetOptions,
  scheduler: applicationScheduler
})`
}
/** Reader scenarios keep host ownership and policies in separate situations. */
export const supervisionOptionCases = {
  common: [
    {
      title: t('Own a formatter for one editor', '为一个编辑器持有格式化任务'),
      problem: t(
        'An editor needs one formatter with a recognizable diagnostic name. Give it its own budget and task, report contained failures, and release it when the editor closes.',
        '编辑器需要一个能在诊断中辨认的格式化任务。为它提供预算与任务，接收受控失败，并在编辑器关闭时释放。'
      ),
      example: supervisionOptionExamples.basic,
      result: t(
        'The editor shows formatter readiness and releases its task when it closes.',
        '编辑器显示格式化任务的就绪状态，关闭时释放任务。'
      ),
      covers: ['id', 'budget', 'spec', 'report']
    },
    {
      title: t('Wait for a usable formatter', '等格式化服务真正可用'),
      problem: t(
        'Starting a formatter task does not prove its service is usable. A ready callback waits for its published service and handshake; the startup deadline bounds the whole attempt.',
        '格式化任务启动不代表服务已经可用。ready 等待服务发布并完成握手；启动截止时间限制整轮尝试。'
      ),
      example: supervisionOptionExamples.ready,
      result: t(
        'The editor sees ready only after its service check completes; a slow attempt cannot wait forever.',
        '服务检查完成后编辑器才看到 ready；启动过慢不会无限等待。'
      ),
      covers: ['ready', 'startupTimeoutMs', 'scheduler']
    },
    {
      title: t('Flush writes before stopping', '停止前写完待处理内容'),
      problem: t(
        'Closing an editor should flush pending formatter writes before termination. Without beforeTerminate that drain is skipped; separate limits bound draining, graceful exit and forced recovery.',
        '关闭编辑器时，应先写完格式化任务的待处理内容。不设置 beforeTerminate 会跳过排空；各阶段时限分别限制排空、优雅退出和强制回收。'
      ),
      example: supervisionOptionExamples.stop,
      result: t(
        'The close path attempts to flush writes before stopping; a failed flush is reported while retirement continues.',
        '关闭流程先尝试写完待处理内容；写入失败会上报，退役仍会继续。'
      ),
      covers: [
        'report',
        'stop',
        'stop.beforeTerminate',
        'stop.drainTimeoutMs',
        'stop.exitTimeoutMs',
        'stop.reapTimeoutMs'
      ]
    }
  ],
  core: [
    {
      title: t('Use the application execution boundary', '使用应用已有的执行边界'),
      problem: t(
        'An application already has a launcher and execution profile for its document service. Pass those owners to createSupervisor instead of implementing a second launch lifecycle.',
        '应用已经有文档服务的启动器与执行策略。将这些现有所有者传给 createSupervisor，无需再实现一套启动生命周期。'
      ),
      example: supervisionOptionExamples.custom,
      result: t(
        'The editor starts and disposes its existing document service through one supervisor.',
        '编辑器通过同一个监督器启动和释放现有文档服务。'
      ),
      covers: ['id', 'launcher', 'profile', 'spec', 'budget', 'report']
    },
    {
      title: t('Attach formatter diagnostics', '附加格式化服务诊断'),
      problem: t(
        'A formatter needs application diagnostics attached only after launch. Hooks use the launched handle and contribute a description to inspect without owning another service.',
        '格式化服务需要在启动后附加应用诊断。钩子使用已启动句柄，并为 inspect 提供描述，不另行持有服务。'
      ),
      example: supervisionOptionExamples.customHooks,
      result: t(
        'The diagnostic panel receives the application description of the running formatter.',
        '诊断面板收到运行中格式化服务的应用描述。'
      ),
      covers: ['hooks']
    }
  ],
  budget: [
    {
      title: t('Share the application process limit', '共用应用进程总上限'),
      problem: t(
        'Preview jobs need a local limit as well as the application-wide process limit. A parent budget applies both; a queued preview waits at most five seconds for capacity.',
        '预览任务既需要本地上限，也需要遵守应用进程总上限。父预算让两者同时生效；排队预览最多等待五秒。'
      ),
      example: supervisionOptionExamples.budgetQueue,
      result: t(
        'Preview jobs cannot exceed either capacity limit, and waiting for a slot has a deadline.',
        '预览任务不能超过任一容量上限，等待名额也有明确截止时间。'
      ),
      covers: ['kind', 'maxUnits', 'parent', 'overflow', 'queueTimeoutMs', 'scheduler']
    },
    {
      title: t('Limit bursts of renderer starts', '限制渲染进程突发启动'),
      problem: t(
        'Short-lived renderers can restart rapidly even with a small concurrency limit. A launch-rate window limits new grants after old jobs have released their slots.',
        '即使并发上限较小，短命渲染进程仍可能快速重启。启动速率窗口会在旧任务归还名额后继续限制新授予。'
      ),
      example: supervisionOptionExamples.budgetRate,
      result: t(
        'At most four starts are granted per second, and full capacity is rejected immediately.',
        '每秒最多授予四次启动，容量已满时立即拒绝。'
      ),
      covers: [
        'kind',
        'maxUnits',
        'overflow',
        'launchRate',
        'launchRate.max',
        'launchRate.windowMs'
      ]
    }
  ],
  coroutine: [
    {
      title: t('Notice a stalled document task', '发现停滞的文档任务'),
      problem: t(
        'The document task reports progress through heartbeat, but can stall without returning. A watchdog observes heartbeat age; without it a pending task has no progress deadline.',
        '文档任务通过 heartbeat 报告进度，却可能一直待定而不返回。看门狗观察心跳年龄；没有它时，待定任务没有进度截止时间。'
      ),
      example: supervisionOptionExamples.heartbeat,
      result: t(
        'Two consecutive observations of a heartbeat older than ten seconds retire the stalled task.',
        '连续两次观察到心跳超过十秒未更新后，停滞任务会退役。'
      ),
      covers: [
        'heartbeat',
        'heartbeat.timeoutMs',
        'heartbeat.intervalMs',
        'heartbeat.failureThreshold'
      ]
    }
  ],
  process: [
    {
      title: t('Read renderer output without retaining it all', '查看渲染输出而不全量保留'),
      problem: t(
        'A preview service writes long logs. The default keeps 64 KiB per stream; a smaller tail bounds retained output while onChunk streams drained bytes to the support panel.',
        '预览服务会写很长的日志。默认每条流保留 64 KiB；较小尾部限制留存，onChunk 把已排空字节持续送给支持面板。'
      ),
      example: supervisionOptionExamples.processOutput,
      result: t(
        'The panel sees incoming output while each diagnostic tail retains at most 4096 bytes.',
        '面板持续看到输出，每条诊断尾部最多保留 4096 字节。'
      ),
      covers: ['output', 'output.tailBytes', 'output.onChunk']
    },
    {
      title: t('Choose the memory sampling cadence', '选择内存采样节奏'),
      problem: t(
        'rendererOptions already includes a monitored memory limit and a launcher that samples RSS. Sampling every two seconds reduces polling, while three rejected samples mark the process unhealthy; a successful over-limit sample still acts immediately.',
        'rendererOptions 已包含受监测的内存限制，启动器能采样常驻内存。两秒一次可减少轮询；连续三次采样拒绝使进程不健康，成功越限样本仍会立即生效。'
      ),
      example: supervisionOptionExamples.processUsage,
      result: t(
        'The renderer uses the selected sampling cadence without changing its configured memory limit.',
        '渲染进程按指定节奏采样，不改变已配置的内存限制。'
      ),
      covers: ['usage', 'usage.intervalMs', 'usage.failureThreshold']
    },
    {
      title: t('Keep renderer ownership across parent runs', '跨父进程运行保留渲染器所有权'),
      problem: t(
        'A restarted preview parent must recover only its own children. A durable application registry records identities under a preview namespace; wallClock supplies their launch timestamps.',
        '预览父进程重启后只能恢复自己的子进程。应用持久注册表在预览命名空间记录身份，wallClock 提供启动时间戳。'
      ),
      example: supervisionOptionExamples.registry,
      result: t(
        'Renderer ownership records carry the preview namespace and real launch time for later recovery.',
        '渲染器所有权记录包含预览命名空间及真实启动时间，供后续恢复使用。'
      ),
      covers: ['registry', 'registry.port', 'registry.namespace', 'wallClock']
    },
    {
      title: t('Adopt an already warm renderer', '接管已经预热的渲染器'),
      problem: t(
        'A preview request should reuse an idle renderer. Pool and supervisor share rendererOptions, including the same launcher, spec and budget; otherwise the warm process cannot be adopted.',
        '预览请求需要复用空闲渲染器。池与监督器共用 rendererOptions 中同一启动器、规格和预算，否则不能接管预热进程。'
      ),
      example: supervisionOptionExamples.prewarm,
      result: t(
        'Once the application has observed an idle renderer, start adopts it for the preview and both owners close afterward.',
        '应用观察到空闲渲染器后，start 将其接管用于预览，结束后关闭两方所有者。'
      ),
      covers: ['prewarm']
    }
  ],
  prewarm: [
    {
      title: t('Keep one renderer ready for a preview', '提前保留一个可用渲染器'),
      problem: t(
        'A preview server needs one idle renderer rather than a new process for every request. The shared rendererOptions keep warm capacity inside the same process budget as active work.',
        '预览服务需要一个空闲渲染器，避免每次请求现起进程。共享 rendererOptions 让空闲容量与活动任务使用同一进程预算。'
      ),
      example: supervisionOptionExamples.prewarm,
      result: t(
        'One warm renderer can be transferred into a preview; unused capacity expires after thirty seconds.',
        '一个预热渲染器可转交预览使用；未使用的空闲容量在三十秒后退役。'
      ),
      covers: ['size', 'idleTimeoutMs']
    },
    {
      title: t('Bound warm-renderer startup and retirement', '限制预热渲染器的启动与退役时间'),
      problem: t(
        'A preview pool should not wait indefinitely for a slow startup or shutdown. Its application scheduler applies separate startup, idle, graceful-exit and forced-recovery deadlines.',
        '预览池不能无限等待缓慢启动或关闭。应用调度器分别限制启动、空闲保留、优雅退出和强制回收时间。'
      ),
      example: supervisionOptionExamples.prewarmPolicy,
      result: t(
        'Warm processes have bounded startup and retention, with separate one-second retirement phase limits.',
        '预热进程的启动与保留都有时限，两个退役阶段分别限时一秒。'
      ),
      covers: [
        'size',
        'startupTimeoutMs',
        'idleTimeoutMs',
        'exitTimeoutMs',
        'reapTimeoutMs',
        'scheduler'
      ]
    },
    {
      title: t('Disable idle renderers in a small deployment', '小规模部署关闭空闲渲染器'),
      problem: t(
        'A low-traffic deployment uses the same pool wiring but cannot reserve an idle process. Setting the required size to zero keeps the pool without launching warm children.',
        '低流量部署使用相同的池接线，却不能预留空闲进程。将必填 size 设为零，可保留池对象而不启动预热子进程。'
      ),
      example: supervisionOptionExamples.prewarmDisabled,
      result: t(
        'The registered pool holds no idle renderer or process-budget lease.',
        '登记的池不会持有空闲渲染器，也不占用进程预算租约。'
      ),
      covers: ['size']
    }
  ],
  thread: [
    {
      title: t('Require native worker termination', '要求原生工作线程可终止'),
      problem: t(
        'An image editor must be able to retire its worker. Required isolation checks the application launcher guarantees before launch, rather than silently accepting cooperative-only termination.',
        '图像编辑器必须能够退役工作线程。严格隔离在启动前检查应用启动器的保证，不会静默接受仅协作终止。'
      ),
      example: supervisionOptionExamples.thread,
      result: t(
        'The image worker starts only with the requested guarantees and closes with its editor.',
        '图像工作线程只在具备所需保证时启动，并随编辑器关闭。'
      ),
      covers: ['budget', 'requires', 'isolation']
    },
    {
      title: t('Wait for the image worker handshake', '等待图像工作线程握手'),
      problem: t(
        'Worker creation does not prove its image service is ready. An application handshake must finish within two seconds before callers can use it.',
        '创建线程不代表图像服务已经就绪。应用握手须在两秒内完成，调用方随后才能使用。'
      ),
      example: supervisionOptionExamples.threadHealth,
      result: t(
        'The editor sees ready only after the worker handshake succeeds.',
        '工作线程握手成功后，编辑器才看到 ready。'
      ),
      covers: ['ready', 'startupTimeoutMs']
    },
    {
      title: t('Detect an unresponsive image worker', '发现失去响应的图像工作线程'),
      problem: t(
        'An image worker can stay alive while its service stops responding. Periodic application checks detect that condition; without health, no such monitor is installed.',
        '图像线程可能仍存活，服务却已失去响应。周期应用检查可发现这种情况；没有 health 就不会安装该监测。'
      ),
      example: supervisionOptionExamples.threadMonitor,
      result: t(
        'Two consecutive failed checks invalidate readiness and enter the existing restart policy.',
        '连续两次检查失败会使就绪状态失效，并进入既有重启策略。'
      ),
      covers: [
        'health',
        'health.check',
        'health.intervalMs',
        'health.timeoutMs',
        'health.failureThreshold'
      ]
    }
  ],
  guard: [
    {
      title: t('Flush child writes after parent disconnect', '父连接断开后写完子进程待处理内容'),
      problem: t(
        'The child owns the parent-disconnect event. Wire it to the guard so pending writes get a bounded shutdown attempt before the application exit callback runs.',
        '子进程应用持有父连接断开事件。将事件接入守卫，可在应用退出回调执行前，给待处理写入一次限时关闭机会。'
      ),
      example: supervisionOptionExamples.guard,
      result: t(
        'Parent disconnect starts one shutdown; completion requests a clean exit and deadline expiry requests a failure exit.',
        '父连接断开后只启动一次关闭；完成时请求正常退出，到期则请求失败退出。'
      ),
      covers: ['shutdown', 'exit', 'report', 'graceMs', 'scheduler']
    },
    {
      title: t('Report shutdown failures before exit', '退出前报告关闭失败'),
      problem: t(
        'Closing child resources can reject. The required reporter preserves that failure, while the application exit callback prevents the disconnected child from waiting forever.',
        '子进程资源关闭可能拒绝。必填报告器保留失败，应用退出回调让失去父连接的子进程不会无限等待。'
      ),
      example: supervisionOptionExamples.guardFailure,
      result: t(
        'A rejected shutdown reaches monitoring and requests exit code one.',
        '关闭拒绝会交给监控，并请求退出码一。'
      ),
      covers: ['shutdown', 'exit', 'report']
    }
  ],
  reclaim: [
    {
      title: t('Recover preview children from a previous run', '恢复上轮运行遗留的预览子进程'),
      problem: t(
        'A preview parent restarts with durable records of its children. The namespace limits recovery to previews, while the application launcher verifies process identity before termination.',
        '预览父进程重启后读取子进程的持久记录。命名空间把恢复限制在预览服务，应用启动器则在终止前核对进程身份。'
      ),
      example: supervisionOptionExamples.reclaim,
      result: t(
        'The application receives a recovery summary for its preview namespace; reused process IDs are not blindly terminated.',
        '应用收到预览命名空间的恢复摘要，不会盲目终止已复用的进程编号。'
      ),
      covers: ['registry', 'namespace', 'launcher', 'report']
    },
    {
      title: t('Show a registry outage during recovery', '恢复时展示注册表不可用'),
      problem: t(
        'An unavailable registry must not lead to blind cleanup. A failed list is collected and reported, so the application can warn the operator without probing or deleting unknown records.',
        '注册表不可用时不能盲目清理。列举失败会被收集并上报，应用可提示操作人员，不会探测或删除未知记录。'
      ),
      example: supervisionOptionExamples.reclaimFailure,
      result: t(
        'A list failure shows a recovery warning and leaves process ownership unchanged.',
        '列举失败时显示恢复警告，进程所有权不变。'
      ),
      covers: ['registry', 'namespace', 'launcher', 'report']
    }
  ]
}
supervisionOptionCases.core.unshift(...supervisionOptionCases.common)
supervisionOptionCases.coroutine.unshift(...supervisionOptionCases.common)
supervisionOptionCases.process.unshift(...supervisionOptionCases.common.slice(1))
