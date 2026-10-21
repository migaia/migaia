import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

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

/** Complete cooperative task shared by the common policy examples. */
const cooperativeOptions = (
  settings: string,
  before = '',
  after = ''
): string => `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'
import { systemScheduler } from '@migaia/utils/scheduler'

${before}
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
const supervisor = createCoroutineSupervisor<{ ping(): string }>({
  id: 'formatter', budget,
  spec: { task: ({ signal, expose }) => new Promise<void>((resolve) => {
    expose({ ping: () => 'pong' })
    signal.addEventListener('abort', () => resolve(), { once: true })
  }) },
  ${settings}
})
${
  after ||
  `console.log((await supervisor.start()).state)
await supervisor.dispose()
console.log(budget.inUse)`
}
budget.close()`

/** Shared fields use the same policy in the core and all profile constructors. */
export const supervisionOptionExamples = {
  ready: cooperativeOptions(`report: console.error,
  ready: async (handle, signal) => {
    if (signal.aborted) throw signal.reason
    const service = await handle.exposed
    if (service.ping() !== 'pong') throw new Error('handshake failed')
  },
  startupTimeoutMs: 1000,
  scheduler: systemScheduler`),
  stop: cooperativeOptions(
    `report: (error) => { errors.push(error) },
  stop: {
    beforeTerminate: async (handle, signal, remainingMs) => {
      if (signal.aborted) throw signal.reason
      console.log((await handle.exposed).ping(), remainingMs() > 0)
      throw drainFailure
    },
    drainTimeoutMs: 100, exitTimeoutMs: 100, reapTimeoutMs: 100
  }`,
    `const errors: unknown[] = []
const drainFailure = new Error('flush failed')`,
    `await supervisor.start()
await supervisor.stop()
console.log(errors.includes(drainFailure), budget.inUse)
await supervisor.dispose()`
  ),
  restart: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let launches = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
const supervisor = createCoroutineSupervisor<{ version: number }>({
  id: 'retry-formatter', budget, report: console.error,
  spec: { task: async ({ expose, signal }) => {
    if (++launches === 1) throw new Error('dependency warming up')
    expose({ version: launches })
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
  } },
  ready: (handle) => handle.exposed.then(() => undefined),
  restart: { mode: 'on-failure', initialDelayMs: 5, factor: 2, maxDelayMs: 20, maxRestarts: 2, windowMs: 1000 }
})
console.log((await supervisor.start()).state, launches)
await supervisor.dispose()
budget.close()`,
  terminal: `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

for (const mode of ['stay', 'cooldown'] as const) {
  let launches = 0
  const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
  const supervisor = createCoroutineSupervisor<{ ok: boolean }>({
    id: mode, budget, report: () => {},
    spec: { task: async ({ expose, signal }) => {
      if (++launches === 1) throw new Error('dependency unavailable')
      expose({ ok: true })
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    } },
    ready: (handle) => handle.exposed.then(() => undefined),
    restart: { maxRestarts: 0 },
    terminalPolicy: mode === 'stay' ? { mode: 'stay' } : { mode: 'cooldown', afterMs: 10 }
  })
  console.log(mode, (await supervisor.start()).state)
  if (mode === 'cooldown') {
    for (let attempt = 0; supervisor.state !== 'ready' && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5))
    console.log(supervisor.state, launches)
  }
  await supervisor.dispose()
  budget.close()
}`,
  health: cooperativeOptions(
    `report: () => {}, restart: { mode: 'never' },
  health: {
    check: async (handle, signal) => {
      if (signal.aborted) throw signal.reason
      await handle.exposed
      checks += 1
      throw new Error('service stopped responding')
    },
    intervalMs: 5, timeoutMs: 20, failureThreshold: 2
  }`,
    'let checks = 0',
    `const failed = new Promise<string>((resolve) => supervisor.subscribe((event) => {
  if (event.type === 'exit') resolve(event.reason)
}))
await supervisor.start()
console.log(await failed, checks)
await supervisor.dispose()
console.log(budget.inUse)`
  ),
  isolation: cooperativeOptions(
    `report: () => {}, requires: ['fault-isolation'], isolation: 'best-effort'`,
    '',
    `await supervisor.start()
console.log(supervisor.inspect().degraded.includes('fault-isolation'))
await supervisor.dispose()`
  ),
  heartbeat: cooperativeOptions(
    `report: () => {}, restart: { mode: 'never' },
  heartbeat: { timeoutMs: 10, intervalMs: 5, failureThreshold: 2 }`,
    '',
    `const failed = new Promise<string>((resolve) => supervisor.subscribe((event) => {
  if (event.type === 'exit') resolve(event.reason)
}))
await supervisor.start()
console.log(await failed)
await supervisor.dispose()
console.log(budget.inUse)`
  ),
  budgetQueue: `import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

const parent = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
const budget = createUnitBudget({
  kind: 'coroutine', maxUnits: 1, parent, overflow: 'queue',
  queueTimeoutMs: 10, launchRate: false, scheduler: systemScheduler
})
const first = await budget.acquire()
const waiting = await budget.acquire()
console.log(waiting.kind === 'rejected' && waiting.reason, budget.inUse, parent.inUse)
if (first.kind === 'granted') first.lease.release()
console.log(budget.inUse, parent.inUse)
budget.close()
parent.close()`,
  budgetRate: `import { createUnitBudget } from '@migaia/supervision'

for (const launchRate of [false, { max: 1, windowMs: 1000 }] as const) {
  const budget = createUnitBudget({ kind: 'process', maxUnits: 1, overflow: 'reject', launchRate })
  const first = budget.tryAcquire()
  const full = budget.tryAcquire()
  if (first.kind === 'granted') first.lease.release()
  const next = budget.tryAcquire()
  console.log(full.kind === 'rejected' && full.reason,
    next.kind === 'granted' ? 'granted' : next.reason)
  if (next.kind === 'granted') next.lease.release()
  budget.close()
}`,
  custom: `import { createSupervisor, createUnitBudget, type IUnitHandle, type IUnitProfile, type IUnitLauncher } from '@migaia/supervision'

type Handle = IUnitHandle<{ ok: boolean }> & { stop(): void }
const launcher: IUnitLauncher<{ label: string }, Handle> = {
  capabilities: { termination: 'cooperative' },
  async launch(spec) {
    let stop!: () => void
    const exited = new Promise<{ ok: boolean }>((resolve) => { stop = () => resolve({ ok: true }) })
    return { identity: { fingerprint: spec.label }, exited, stop }
  }
}
const profile: IUnitProfile<{ label: string }, Handle, { ok: boolean }> = {
  kind: 'in-process', gracefulTermination: false,
  requirements: () => ['termination'],
  validateSpec(spec) { if (!spec.label) throw new TypeError('label required') },
  terminate: (handle) => handle.stop(),
  classifyExit: (status) => ({ reason: status.ok ? 'exited' : 'crashed' })
}
const budget = createUnitBudget({ kind: 'in-process', maxUnits: 1 })
let attached = 0
const supervisor = createSupervisor({
  id: 'custom-service', launcher, profile, spec: { label: 'formatter-v1' }, budget,
  report: () => {}, isolation: 'best-effort',
  hooks: {
    afterLaunch: async () => { attached += 1 },
    inspectUnit: (handle) => ({ fingerprint: handle.identity.fingerprint })
  }
})
console.log((await supervisor.start()).state, attached)
await supervisor.dispose()
console.log(budget.inUse)
budget.close()`,
  processOutput: `import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor, type IProcessLauncher, type IProcessSpec } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
const spec: IProcessSpec = {
  command: process.execPath, args: ['-e', 'process.stdout.write("abcdef"); setInterval(() => {}, 1000)'],
  env: { inherit: [], set: {} }, stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
}
let observe!: () => void
const outputSeen = new Promise<void>((resolve) => { observe = resolve })
const chunks: Uint8Array[] = []
const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const supervisor = createProcessSupervisor({
  id: 'renderer', launcher, spec, budget, report: console.error,
  output: { tailBytes: 3, onChunk: (stream, bytes) => {
    if (stream === 'stdout') { chunks.push(bytes); observe() }
  } }
})
await supervisor.start()
await outputSeen
console.log(new TextDecoder().decode(supervisor.inspect().unit?.stdoutTail as Uint8Array), chunks.length > 0)
await supervisor.dispose()
console.log(budget.inUse)
budget.close()`,
  processUsage: `import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor, type IProcessLauncher, type IProcessSpec } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
const spec: IProcessSpec = {
  command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
  env: { inherit: [], set: {} }, stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' },
  limits: { memoryBytes: 1 }
}
const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const supervisor = createProcessSupervisor({
  id: 'memory-monitor', launcher, spec, budget, report: () => {},
  restart: { mode: 'never' }, usage: { intervalMs: 10, failureThreshold: 2 }
})
const failed = new Promise<string>((resolve) => supervisor.subscribe((event) => {
  if (event.type === 'exit') resolve(event.reason)
}))
await supervisor.start()
console.log(await failed)
await supervisor.dispose()
console.log(budget.inUse)
budget.close()`,
  prewarm: `import { createUnitBudget } from '@migaia/supervision'
import { createPrewarmPool, createProcessSupervisor, type IProcessLauncher, type IProcessRecord, type IProcessRegistry, type IProcessSpec } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'

declare const launcher: IProcessLauncher
const spec: IProcessSpec = {
  command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
  env: { inherit: [], set: {} }, stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' },
  limits: { memoryBytes: 1024 * 1024 * 1024 }
}
const records = new Map<string, IProcessRecord>()
const port: IProcessRegistry = {
  async add(record) { records.set(record.id, record) },
  async remove(id) { records.delete(id) },
  async list(namespace) { return [...records.values()].filter((record) => record.namespace === namespace) }
}
const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const options = {
  id: 'renderer', launcher, spec, budget, report: console.error,
  isolation: 'required' as const, requires: ['termination'],
  registry: { port, namespace: 'preview' }, wallClock: { timestamp: () => 1234 },
  usage: { intervalMs: 10, failureThreshold: 2 }, startupTimeoutMs: 1000, scheduler: systemScheduler
}
const pool = createPrewarmPool({ ...options, size: 1, idleTimeoutMs: 1000, exitTimeoutMs: 100, reapTimeoutMs: 100 })
for (let attempt = 0; pool.idle === 0 && attempt < 100; attempt++)
  await new Promise((resolve) => setTimeout(resolve, 5))
console.log(pool.idle, records.size, [...records.values()][0]?.launchedAt)
const supervisor = createProcessSupervisor({ ...options, prewarm: pool })
console.log((await supervisor.start()).state, records.size, budget.inUse)
await supervisor.dispose()
await pool.dispose()
console.log(records.size, budget.inUse)
budget.close()`,
  prewarmDisabled: `import { createUnitBudget } from '@migaia/supervision'
import { createPrewarmPool, type IProcessLauncher, type IProcessSpec } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
const spec: IProcessSpec = {
  command: process.execPath, args: [], env: { inherit: [], set: {} },
  stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'drain' }
}
const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
const pool = createPrewarmPool({ id: 'disabled', launcher, spec, budget, size: 0, report: console.error })
console.log(pool.idle, budget.inUse)
await pool.dispose()
budget.close()`,
  thread: `import { createUnitBudget } from '@migaia/supervision'
import { createThreadSupervisor, type IThreadLauncher } from '@migaia/supervision/threads'

declare const launcher: IThreadLauncher
const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
const supervisor = createThreadSupervisor({
  id: 'image-worker', launcher, spec: { entry: './worker.ts', data: { quality: 80 } }, budget,
  report: console.error, requires: ['termination'], isolation: 'required'
})
console.log((await supervisor.start()).state, budget.inUse)
await supervisor.dispose()
console.log(budget.inUse)
budget.close()`,
  threadHealth: `import { createUnitBudget } from '@migaia/supervision'
import { createThreadSupervisor, type IThreadLauncher, type IThreadHandle } from '@migaia/supervision/threads'

type WorkerHandle = IThreadHandle & { ping(): Promise<string> }
declare const launcher: IThreadLauncher<WorkerHandle>
const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
let checks = 0
const supervisor = createThreadSupervisor({
  id: 'worker-handshake', launcher, spec: { entry: './worker.ts' }, budget, report: console.error,
  ready: async (handle) => { if (await handle.ping() !== 'pong') throw new Error('worker not ready') },
  startupTimeoutMs: 1000,
  health: { check: async (handle) => {
    if (await handle.ping() !== 'pong') throw new Error('worker unavailable')
    checks += 1
  }, intervalMs: 5, timeoutMs: 100, failureThreshold: 2 }
})
await supervisor.start()
for (let attempt = 0; checks === 0 && attempt < 100; attempt++)
  await new Promise((resolve) => setTimeout(resolve, 5))
console.log(supervisor.state, checks > 0)
await supervisor.dispose()
budget.close()`,
  guard: `import { createParentLossGuard } from '@migaia/supervision/process'
import { systemScheduler } from '@migaia/utils/scheduler'

let cleaned = 0
let finish!: (code: number) => void
const completed = new Promise<number>((resolve) => { finish = resolve })
const guard = createParentLossGuard({
  shutdown: async (signal) => { if (!signal.aborted) cleaned += 1 },
  exit: (code) => { finish(code) }, report: console.error,
  graceMs: 100, scheduler: systemScheduler
})
guard.trigger(new Error('parent disconnected'))
guard.trigger()
console.log(await completed, cleaned, guard.triggered)`,
  guardFailure: `import { createParentLossGuard } from '@migaia/supervision/process'

const failure = new Error('shutdown failed')
const errors: unknown[] = []
let finish!: (code: number) => void
const completed = new Promise<number>((resolve) => { finish = resolve })
const guard = createParentLossGuard({
  shutdown: async () => { throw failure },
  exit: (code) => { finish(code) }, report: (error) => { errors.push(error) }
})
guard.trigger()
console.log(await completed, errors[0] === failure)`,
  reclaim: `import { reclaimOrphanProcesses, type IProcessLauncher, type IProcessRegistry } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
declare const registry: IProcessRegistry
const result = await reclaimOrphanProcesses({ registry, namespace: 'previous-run', launcher, report: console.error })
console.log(result.terminated.length, result.removed.length, result.failures.length)`,
  reclaimFailure: `import { reclaimOrphanProcesses, type IProcessLauncher, type IProcessRegistry } from '@migaia/supervision/process'

declare const launcher: IProcessLauncher
const cause = new Error('registry unavailable')
const errors: unknown[] = []
const registry: IProcessRegistry = {
  async add() {}, async remove() { throw new Error('must not remove') },
  async list() { throw cause }
}
const result = await reclaimOrphanProcesses({
  registry, namespace: 'previous-run', launcher, report: (error) => { errors.push(error) }
})
console.log(result.terminated.length, result.removed.length, result.failures.length, errors.length)`
}

/** Each case explains one observable configuration choice. */
const optionCase = (
  title: IText,
  problem: IText,
  example: string,
  result: IText,
  covers: readonly string[]
): IOptionCaseDoc => ({ title, problem, example, result, covers })
const commonOptionCases: readonly IOptionCaseDoc[] = [
  optionCase(
    t('Wait for a usable service', '等到服务真正可用'),
    t(
      'The task publishes a service port. Launch completion alone does not check that port. The ready callback waits for exposure and checks ping; startupTimeoutMs bounds the whole attempt. The same readiness policy applies to native handles supplied by an application launcher.',
      '任务会发布服务端口，但仅启动完成并不保证端口可用。ready 等待端口发布并检查 ping，startupTimeoutMs 限制整轮启动时间。应用启动器提供的原生句柄也使用相同的就绪策略。'
    ),
    supervisionOptionExamples.ready,
    t('Prints ready, then 0 after disposal.', '输出 ready，释放后输出 0。'),
    ['id', 'budget', 'spec', 'report', 'ready', 'startupTimeoutMs', 'scheduler']
  ),
  optionCase(
    t('Drain before retiring a unit', '先排空再退役单元'),
    t(
      'A service must flush pending work before cancellation. Without beforeTerminate the application drain step is skipped. Here the flush fails: report receives that error and termination still releases the lease. Each stop phase has its own limit.',
      '服务取消前需要写完待处理工作。不配置 beforeTerminate 就会跳过应用排空。本例写入失败，report 收到错误，终止仍继续并归还租约。停止过程的每个阶段都有独立时限。'
    ),
    supervisionOptionExamples.stop,
    t(
      'Prints pong true, then true 0: the drain error was reported and capacity was released.',
      '输出 pong true，然后 true 0：排空错误已上报，容量已释放。'
    ),
    [
      'report',
      'stop',
      'stop.beforeTerminate',
      'stop.drainTimeoutMs',
      'stop.exitTimeoutMs',
      'stop.reapTimeoutMs'
    ]
  )
]

/** Small independent sets keep platform-specific fields beside their actual host boundary. */
export const supervisionOptionCases = {
  common: commonOptionCases,
  budget: [
    optionCase(
      t('Share a parent capacity limit', '共用父级容量上限'),
      t(
        'A queue consumer needs both a local slot and a global slot. Without parent each child budget admits independently. The queued second request has a short deadline so overload returns data instead of waiting indefinitely.',
        '队列消费者既需要本地名额，也需要全局名额。不配置 parent 时，各子预算独立准入。第二个排队请求设置较短时限，让过载以返回值结束等待。'
      ),
      supervisionOptionExamples.budgetQueue,
      t(
        'Prints queue-timeout 1 1, then 0 0 after releasing the first lease.',
        '输出 queue-timeout 1 1，释放首个租约后输出 0 0。'
      ),
      ['kind', 'maxUnits', 'parent', 'overflow', 'queueTimeoutMs', 'launchRate', 'scheduler']
    ),
    optionCase(
      t('Separate concurrency from launch rate', '分别限制并发与启动速率'),
      t(
        'Fast jobs release their slots quickly but can still restart too often. A rate window counts successful grants even after release. Setting launchRate to false removes that rate window while overflow reject still refuses a full slot.',
        '短任务很快归还名额，却仍可能频繁启动。速率窗口会统计已归还租约的成功授予。launchRate 设为 false 会关闭速率窗口，overflow 为 reject 时容量满仍立即拒绝。'
      ),
      supervisionOptionExamples.budgetRate,
      t(
        'Prints full granted for false, then full rate-limited for the one-grant window.',
        'false 输出 full granted，单次授予窗口输出 full rate-limited。'
      ),
      ['kind', 'maxUnits', 'overflow', 'launchRate', 'launchRate.max', 'launchRate.windowMs']
    )
  ],
  core: [
    ...commonOptionCases,
    optionCase(
      t('Supply an application execution profile', '提供应用自己的执行策略'),
      t(
        'A custom in-process service already owns an exit Promise and a stop operation. Supply a profile to connect those operations to supervision. Hooks attach diagnostics after launch. Cooperative termination needs explicit best-effort admission.',
        '自定义进程内服务已经提供退出承诺与停止操作。profile 将这些操作接入监督器，hooks 在启动后附加诊断信息。协作终止需要显式接受尽力准入。'
      ),
      supervisionOptionExamples.custom,
      t(
        'Prints ready 1, then 0. The hook ran once and disposal released the slot.',
        '输出 ready 1，然后 0。钩子运行一次，释放归还名额。'
      ),
      ['launcher', 'profile', 'hooks', 'spec', 'budget', 'id', 'report', 'isolation']
    )
  ],
  coroutine: [
    ...commonOptionCases,
    optionCase(
      t('Detect missing progress', '发现任务不再推进'),
      t(
        'A task can stay pending without making progress. heartbeat observes the age of the last progress signal; without it no heartbeat watchdog runs. This task never refreshes its heartbeat and is stopped after two stale observations. Do not combine heartbeat with health.',
        '任务可能一直待定却不再推进。heartbeat 检查上次进度信号距今多久，不配置时没有心跳看门狗。本任务不更新心跳，连续两次观察到过期后停止。heartbeat 与 health 不能同时配置。'
      ),
      supervisionOptionExamples.heartbeat,
      t('Prints unhealthy, then 0 after disposal.', '输出 unhealthy，释放后输出 0。'),
      ['heartbeat', 'heartbeat.timeoutMs', 'heartbeat.intervalMs', 'heartbeat.failureThreshold']
    )
  ],
  process: [
    ...commonOptionCases,
    optionCase(
      t('Keep a small diagnostic output tail', '保留少量诊断输出'),
      t(
        'Supply an application launcher that drains real child stdout/stderr from startup. The child writes abcdef. Without output settings the tail limit is 65536 bytes and no observer runs; here each stream keeps only three bytes while onChunk observes the full drained chunk.',
        '应用启动器从启动时就排空真实子进程的标准输出与错误输出，子进程写出 abcdef。默认每条流保留 65536 字节且没有观察回调。本例每条流只留三个字节，onChunk 仍观察完整排空字节块。'
      ),
      supervisionOptionExamples.processOutput,
      t(
        'With that launcher, prints def true, then 0 after disposal.',
        '接入该启动器后输出 def true，释放后输出 0。'
      ),
      ['launcher', 'spec', 'budget', 'output', 'output.tailBytes', 'output.onChunk']
    ),
    optionCase(
      t('Enforce a monitored memory limit', '通过采样执行内存限制'),
      t(
        'The application launcher declares memory-limit as monitored and supplies real child RSS samples. A one-byte limit is deliberately below the child usage. A successful over-limit sample stops the process immediately; failureThreshold counts rejected samples instead. Omitting usage uses a 1000 ms interval and three rejected samples.',
        '应用启动器将 memory-limit 声明为 monitored，并提供真实子进程常驻内存样本。一字节限制刻意小于子进程用量。成功越限样本会立即停止进程，failureThreshold 统计的是采样拒绝。省略 usage 时每隔 1000 毫秒采样，连续三次拒绝才失效。'
      ),
      supervisionOptionExamples.processUsage,
      t(
        'Prints resource-violation, then 0 after disposal.',
        '输出 resource-violation，释放后输出 0。'
      ),
      ['usage', 'usage.intervalMs', 'usage.failureThreshold']
    ),
    optionCase(
      t('Adopt a warm process and its ownership record', '接管预热进程与所有权记录'),
      t(
        'A preview renderer should reuse a process before the request arrives. The pool and supervisor share the exact launcher, spec and budget objects. Matching id, registry port and namespace preserve one record during transfer. This small registry is in memory for demonstration; use durable application storage for recovery across parent runs. Without prewarm every launch is cold.',
        '预览渲染器需要在请求到来前准备进程。池与监督器共用同一启动器、规格和预算对象。id、注册端口和命名空间一致时，接管期间只保留一条记录。演示注册表保存在内存中，跨父进程恢复应换成应用持久存储。不配置 prewarm 时每次都冷启动。'
      ),
      supervisionOptionExamples.prewarm,
      t(
        'Prints 1 1 1234, ready 1 1, then 0 0. Adoption keeps the same occupied slot and record.',
        '输出 1 1 1234、ready 1 1，最后 0 0。接管保留同一占用名额和记录。'
      ),
      ['prewarm', 'registry', 'registry.port', 'registry.namespace', 'wallClock']
    )
  ],
  prewarm: [
    optionCase(
      t('Prepare one idle renderer', '准备一个空闲渲染进程'),
      t(
        'The launcher supplies termination, fault isolation and monitored memory samples. Shared budget capacity counts idle processes too. Startup, idle retention and teardown limits bound different phases; scheduler controls deadlines while wallClock timestamps records. A size of one reserves one warm process for later adoption.',
        '启动器提供终止、故障隔离与内存监测。空闲进程同样占用共享预算。启动、空闲保留和拆卸时限分别限制不同阶段，scheduler 控制截止时间，wallClock 给记录写入时间戳。size 为一时预留一个进程供后续接管。'
      ),
      supervisionOptionExamples.prewarm,
      t(
        'Prints 1 1 1234, ready 1 1, then 0 0 after both owners close.',
        '输出 1 1 1234、ready 1 1，两方关闭后输出 0 0。'
      ),
      [
        'id',
        'launcher',
        'spec',
        'budget',
        'size',
        'report',
        'isolation',
        'requires',
        'registry',
        'registry.port',
        'registry.namespace',
        'usage',
        'usage.intervalMs',
        'usage.failureThreshold',
        'startupTimeoutMs',
        'idleTimeoutMs',
        'exitTimeoutMs',
        'reapTimeoutMs',
        'scheduler',
        'wallClock'
      ]
    ),
    optionCase(
      t('Disable idle capacity for a small deployment', '小规模部署关闭空闲容量'),
      t(
        'Keeping a pool object can simplify application wiring, but a low-traffic deployment may need no idle child. Set size to zero to launch none. Omitting size is invalid; it is a required target, not an enable flag.',
        '应用可以保留池对象来简化接线，但低流量部署可能不需要空闲子进程。size 设为零不会启动进程。size 是必填目标数量，不能省略，也不是布尔开关。'
      ),
      supervisionOptionExamples.prewarmDisabled,
      t('Prints 0 0; no idle process holds a lease.', '输出 0 0，没有空闲进程占用租约。'),
      ['size']
    )
  ],
  thread: [
    optionCase(
      t('Own one native worker', '持有一个原生工作线程'),
      t(
        'Supply an application launcher that interprets worker.ts and observes actual worker exit. It declares termination and exit-observation as enforced. Required admission checks those guarantees before starting; the thread budget remains occupied until exit.',
        '应用启动器解释 worker.ts 并观察线程实际退出，将 termination 与 exit-observation 声明为 enforced。严格准入在启动前检查能力保证，线程实际退出前一直占用预算。'
      ),
      supervisionOptionExamples.thread,
      t('Prints ready 1, then 0 after native worker exit.', '输出 ready 1，原生线程退出后输出 0。'),
      ['id', 'launcher', 'spec', 'budget', 'report', 'requires', 'isolation']
    ),
    optionCase(
      t('Check the worker service, not just worker creation', '检查线程服务是否可用'),
      t(
        'The application handle adds a ping request over the real worker message channel. Without ready, launch completion admits the worker immediately. The handshake delays readiness until pong; periodic health checks keep checking afterward.',
        '应用句柄通过真实线程消息通道增加 ping 请求。不配置 ready 时，线程创建完成就会准入。握手等待 pong 后才就绪，周期健康检查随后继续检查。'
      ),
      supervisionOptionExamples.threadHealth,
      t(
        'Prints ready true after at least one health check succeeds.',
        '至少一次健康检查成功后输出 ready true。'
      ),
      [
        'ready',
        'startupTimeoutMs',
        'health',
        'health.check',
        'health.intervalMs',
        'health.timeoutMs',
        'health.failureThreshold'
      ]
    )
  ],
  guard: [
    optionCase(
      t('Clean up once after parent loss', '父进程丢失后只清理一次'),
      t(
        'Wire the application parent-disconnect event to trigger. The guard does not discover parent loss itself. shutdown completes within graceMs and exit receives zero. The example records that request; a child application can provide its native exit callback.',
        '将应用的父连接断开事件接到 trigger；守卫不会自行发现父进程丢失。shutdown 在 graceMs 内完成，exit 收到零。示例记录退出请求，子进程应用可提供自己的原生退出回调。'
      ),
      supervisionOptionExamples.guard,
      t(
        'Prints 0 1 true: exit code zero, one cleanup, and triggered state.',
        '输出 0 1 true：退出码零、一次清理、已经触发。'
      ),
      ['shutdown', 'exit', 'report', 'graceMs', 'scheduler']
    ),
    optionCase(
      t('Report failed shutdown before forced exit', '强制退出前报告关闭失败'),
      t(
        'A rejected shutdown must not leave the child waiting forever. The required report callback receives the original rejection and exit receives one. Without custom graceMs the deadline is 5000 ms; expiration also requests one and aborts the shutdown signal.',
        '关闭拒绝不能让子进程无限等待。必填 report 收到原始拒绝，exit 收到一。不自定义 graceMs 时截止为 5000 毫秒，到期也会请求一并中止关闭信号。'
      ),
      supervisionOptionExamples.guardFailure,
      t(
        'Prints 1 true: forced exit was requested and the original failure was reported.',
        '输出 1 true：已请求强制退出，并上报原始失败。'
      ),
      ['shutdown', 'exit', 'report']
    )
  ],
  reclaim: [
    optionCase(
      t('Recover only a previous owner namespace', '只恢复上个所有者的命名空间'),
      t(
        'Supply durable records from a previous parent and a fingerprint-aware application launcher. For one owned live child the launcher returns alive and terminates that exact child. Without matching fingerprints, a reused PID only loses its stale record. namespace limits the scan to the selected application.',
        '提供上次父进程的持久记录及能校验指纹的应用启动器。针对一个仍存活的所属子进程，启动器返回 alive 并终止该精确实例。指纹不匹配、编号已经复用时只删旧记录。namespace 把扫描限制在指定应用内。'
      ),
      supervisionOptionExamples.reclaim,
      t(
        'For one matching live record, prints 1 1 0: one terminated child, one removed record, no failures.',
        '只有一个匹配存活记录时输出 1 1 0：终止一个子进程、移除一条记录、没有失败。'
      ),
      ['registry', 'namespace', 'launcher', 'report']
    ),
    optionCase(
      t('Retain records when storage cannot be read', '存储无法读取时保留记录'),
      t(
        'A registry outage must not trigger blind termination. A failed list operation is collected and reported; no probe, termination or removal runs. The required report callback should record the error without throwing.',
        '注册表不可用时不能盲目终止。list 失败会被收集并上报，不会探测、终止或删除记录。必填 report 应记录错误且不抛出。'
      ),
      supervisionOptionExamples.reclaimFailure,
      t(
        'Prints 0 0 1 1: no ownership changes, one collected and reported failure.',
        '输出 0 0 1 1：没有改变所有权，收集并上报一个失败。'
      ),
      ['registry', 'namespace', 'launcher', 'report']
    )
  ]
}
