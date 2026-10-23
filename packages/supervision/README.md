# @migaia/supervision

[English](./README.en.md)

后台任务、子进程和工作线程迟早会出问题：启动就崩溃、跑着跑着卡死、停止时迟迟不退出。`@migaia/supervision` 替你看管它们：限制同时运行的数量，确认它真正准备好才交给你，失败后按递增的间隔重启，失败太多就停下并告诉你原因；停止时分段限时，旧实例真正退出后才释放它占用的名额。

## 你可能遇到过

- **崩溃风暴**：子进程因为配置错误一启动就退出，`on('exit')` 里的重启逻辑每秒执行上百次，CPU 和日志被打满。根因是重启没有间隔，也没有“失败多少次就放弃”的上限。
- **卡死却显示“运行中”**：进程还活着，但已经不处理任何请求。只监听退出事件发现不了，需要定期检查它是否还在干活。
- **发布时新旧版本同时干活，或者中间断档**：先停旧再起新，中间有一段没人处理请求；先起新再停旧，又可能两个版本同时消费同一条任务。
- **关闭卡住，或者留下孤儿进程**：子进程不理会退出信号，发布脚本一直等；父进程被强制结束后，子进程继续占着内存。

## 从这里开始

下面的格式化服务前两次启动都会失败。监督器在每次失败后等待一段时间再重启，直到服务真正可用，`start()` 才返回 `ready`。

```ts doc-test=run
import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

let launches = 0
const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const formatter = createCoroutineSupervisor<{ format(text: string): string }>({
  id: 'formatter',
  budget,
  spec: {
    task: async ({ expose, signal }) => {
      launches += 1
      if (launches <= 2) throw new Error(`第 ${launches} 次启动失败`)
      expose({ format: (text) => text.trim().replace(/\s+/g, ' ') })
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
budget.close()
```

输出：

```text
hello world | 启动次数: 3
```

下一步：

- 要监督真实子进程，看 [USEGUIDE：监督一个真实的子进程](./USEGUIDE.md#监督一个真实的子进程)。
- 想知道失败太多时会发生什么，看 [USEGUIDE：崩溃太多次就停下](./USEGUIDE.md#崩溃太多次就停下)。
- 要在发布时无缝替换，看 [USEGUIDE：不中断地替换实例](./USEGUIDE.md#不中断地替换实例)。

## 手写时的隐患

很多项目用几行代码自己“守护”子进程：

```ts doc-test=check
import { spawn, type ChildProcess } from 'node:child_process'

let child: ChildProcess = start()

function start(): ChildProcess {
  const proc = spawn('node', ['indexer.js'])
  // 隐患 1：启动就崩溃时，这里会立即再启动，没有间隔也没有上限。
  proc.on('exit', () => {
    child = start()
  })
  return proc
}

export async function shutdown(): Promise<void> {
  child.kill('SIGTERM')
  // 隐患 2：进程不理会 SIGTERM 时，这里永远等不到 exit，关闭流程卡住。
  await new Promise((resolve) => child.once('exit', resolve))
  // 隐患 3：上面的 exit 监听器仍然有效，关闭途中又启动了一个新进程。
}
```

用监督器时，重启间隔、重启上限、停止限时和“停止后不再重启”都由同一个对象负责，不需要在每个项目里重新写一遍。

## 它有什么不一样

- **即使服务一启动就崩溃，也不会无限重启。** 默认第一次等 250 毫秒，之后每次翻倍，最长 30 秒；60 秒内最多自动重启 5 次，之后再失败就进入 `terminal` 状态，并通过 `report` 交出一个 `SUPERVISION_EXHAUSTED` 错误。你的原始错误一直保留在它的 `cause` 链上。
- **即使任务不理会停止信号，`stop()` 也会按时返回。** 停止分三段：等应用收尾、等正常退出、强制结束后等回收，每段默认 5 秒。但这个任务占用的名额要等它真正退出才归还，所以新任务不会和没停干净的旧任务挤在一起。
- **替换时可以先起新、再停旧。** `replace({ strategy: 'start-then-switch' })` 等新实例准备好后才切换，旧实例在切换之后才收到停止信号。
- **旧实例不会冒充新实例。** 每次成功启动都有新的 `generation` 编号，迟到的旧结果不会覆盖当前状态。
- **协程、线程、子进程用同一套规则。** 平台差异只放在“启动器”里，重启、健康检查和停止策略写一次就能用于三种执行方式。
- **保证不了的事情会直接告诉你。** 启动器必须如实声明自己能做到什么（例如能否结束整个进程树）。默认要求所有保证都成立，否则创建时就报错；你可以显式选择 `best-effort` 接受降级，降级项会出现在 `inspect().degraded` 里。

## 三分钟心智模型

一个被监督的执行单元（unit，一次启动出来的协程、线程或子进程）会经历这些阶段：

1. **申请名额**：向预算（budget）申请一个位置。满了就排队，或者直接被拒绝。
2. **启动**：启动器（launcher）按规格（spec）创建这个单元。
3. **确认就绪**：如果提供了 `ready`，等它通过；超过启动时限（默认 10 秒）算启动失败。
4. **运行**：`start()` 返回 `ready`。如果配置了健康检查，监督器会定期检查它。
5. **出问题**：崩溃、健康检查连续失败或超出资源限制，都会结束这个单元，然后按重启策略退避重启，或者进入 `terminal`。
6. **停止**：`stop()`、`replace()` 或 `dispose()` 按三段限时结束它。
7. **归还名额**：只有单元真正退出后，名额才回到预算里。

| 名词 | 含义 |
| --- | --- |
| unit | 一次启动出来的执行单元：一个协程、一个线程或一个子进程。 |
| launcher（启动器） | 真正创建单元的那段代码。Node、Bun、Deno、Electron 创建进程的方式不同，所以由应用或适配包提供；本包只管启动之后的一切。 |
| budget（预算） | 一组单元共享的名额：最多同时运行几个、每秒最多启动几个、排队最多等多久。 |
| spec（规格） | 启动一个单元需要的参数，例如协程的任务函数、进程的命令和参数。 |
| generation | 每次启动尝试的编号。成功启动后，它标识当前在服务的那个单元。 |
| `ready` | 你提供的就绪检查，用来回答“这个单元现在能用了吗”。 |
| `report` | 接收不会抛给调用方的错误：进入终态、清理失败、迟到的失败和能力降级。 |

## 典型场景

| 场景 | 怎么组合 | 详细说明 |
| --- | --- | --- |
| 本地索引、转码等子进程崩溃后自动恢复 | `createProcessSupervisor` + `@migaia/rpc-process` 提供的 Node 启动器 | [监督一个真实的子进程](./USEGUIDE.md#监督一个真实的子进程) |
| 配置错误导致崩溃循环时及时停下 | `restart.maxRestarts` + `report` | [崩溃太多次就停下](./USEGUIDE.md#崩溃太多次就停下) |
| 后台扫描任务卡住时自动重启 | 协程的 `heartbeat` | [用心跳发现卡住的任务](./USEGUIDE.md#用心跳发现卡住的任务) |
| 批量导出时限制同时运行的数量 | `createUnitBudget({ maxUnits })` | [限制同时运行的数量](./USEGUIDE.md#限制同时运行的数量) |
| 发布新版本时不中断服务 | `replace({ strategy: 'start-then-switch' })` | [不中断地替换实例](./USEGUIDE.md#不中断地替换实例) |
| 关闭应用时不被卡住 | `stop` 的三段时限 | [限时停止与名额归还](./USEGUIDE.md#限时停止与名额归还) |
| 父进程退出后，子进程自己收尾；下次启动清理遗留进程 | `createParentLossGuard`、`reclaimOrphanProcesses` | [父进程退出与遗留进程](./USEGUIDE.md#父进程退出与遗留进程) |
| 减少冷启动等待 | `createPrewarmPool` | [预热进程](./USEGUIDE.md#预热进程) |

## 安装

```bash
pnpm add @migaia/supervision
```

## 常用 API

| API | 作用 |
| --- | --- |
| `createUnitBudget()` | 创建一组单元共享的名额。 |
| `createCoroutineSupervisor()` | 监督在当前事件循环里运行、能响应取消的任务。 |
| `createProcessSupervisor()` | 监督由启动器创建的子进程。 |
| `createThreadSupervisor()` | 监督由启动器创建的工作线程。 |
| `start()` / `stop()` / `replace()` / `dispose()` | 启动、停止、替换和永久关闭。 |
| `subscribe()` / `inspect()` | 观察状态变化，读取当前状态和最近一次退出原因。 |

完整用法见 [USEGUIDE.md](./USEGUIDE.md)。

## 契约细节

根入口负责预算、启动尝试、运行中单元的生命周期、限时停止、重启策略、健康检查、能力准入和状态观察。`./coroutine` 增加协作式任务；`./process` 和 `./threads` 使用同一套根契约。

创建预算 `createUnitBudget({ kind, maxUnits })`，再把预算、匹配的 profile、启动器、规格和 `report` 回调交给 `createSupervisor`。调用 `start()`，只有结果是 `ready` 时才使用单元；用完调用 `dispose()`。

启动器必须在单元停止、并且自己持有的资源都关闭之后，才让 `handle.exited` 完成；`exited` 永远不会以错误结束。profile 负责校验规格、声明需要的能力、幂等地结束单元，并给已完成的退出状态分类。`report` 接收终态、清理失败、迟到的失败和能力降级诊断。健康检查在响应取消时如果以自己的错误失败，即使监控已经关闭，这个错误也会被报告；如果它只是以取消原因结束，就不会再报告一次。`inspect()` 和 `subscribe()` 只观察状态，不会启动单元。

预算返回 `{ kind: 'granted', lease }` 或 `{ kind: 'rejected', reason }`。每个获得的名额只释放一次，`release()` 可以重复调用。关闭预算会拒绝排队中和之后的申请，已经发出的名额继续有效，直到对应单元真正退出。嵌套预算的单元类型必须相同，释放时先还父预算、再还子预算。

默认值：启动时限 10 秒；启动超时与其他启动失败使用同一套重启和终态策略；`acquireUnit` 抛出的错误以 `LAUNCH_FAILED` 报告，原始错误在 `cause` 上。停止的三段（应用收尾、正常退出、强制回收）各 5 秒。重启默认 `on-failure`，初始间隔 250 毫秒，倍数 2，最长 30 秒，60 秒内最多 5 次。默认终态策略是停在 `terminal`，直到显式调用 `restart()`；配置 `cooldown` 后会安排一次不阻止进程退出的重试。健康检查默认每 5 秒一次，单次限时 2 秒，连续 3 次失败判定为不健康。预算默认排队，排队最多等 30 秒，每秒最多发出 8 个名额。需要确定的时间行为时，传入自己的 scheduler。

核心只依赖 `@migaia/lifecycle` 和 `@migaia/utils`。profile 可以用 `hooks.acquireUnit` 接收预先启动好的单元，用 `hooks.afterLaunch` 挂接附属资源，用 `hooks.onReady` 挂接监控或让单元失败，用 `hooks.inspectUnit` 提供只读快照。登记在 `unit.scope` 里的附属资源在 `exited` 之后释放；登记在 `unit.monitors` 里的监控在结束单元之前释放。

监督器产生的错误带有 `source: 'supervision'` 和一个 `SupervisionErrorCode`；被包装的原始错误保留在 `cause` 上，清理失败可以通过 `errors` 找到。交给 `report` 的被动观察失败和迟到的检查失败保持原对象。状态和预算结果是返回值，不会作为错误抛出。

启动器明确声明 `exit-observation: 'unsupported'` 时，强制终止后立即报告 `EXIT_UNOBSERVABLE` 并将该代记为 abandoned，不等待 `reapTimeoutMs`。诊断详情包含 kind、generation 和 capability。名额仍保留到真实退出，不能把无法观察当作已经退出；可观察退出但超时的路径仍报告 `REAP_TIMEOUT`，启动阶段的回收超时也保持原行为。

`./process` 提供不经过 shell 的进程规格、能力检查、资源用量监控、有上限的输出尾部、持久的进程记录与回收、父进程断开保护，以及可选的有上限预热池。它只定义启动器接口，自己不创建操作系统进程。

`./threads` 用同样的预算、重启、健康检查、替换和限时释放策略监督由启动器创建的线程。启动器把 `heap-limit` 和 `exit-observation` 声明为 `enforced` 或 `unsupported`；不能可靠观察退出的启动器必须配置健康检查。线程既不能隔离崩溃，也不能限制 CPU；需要这两项保证时选择进程。

选项校验：`health.intervalMs` 必须是大于零的有限数；`startupTimeoutMs` 可以为零，表示立即到期；`restart.mode`、`terminalPolicy.mode`、`isolation` 只接受列出的取值；`stop` 三段时限都可以为零。未知的替换策略会在排队或停止当前单元之前抛出带 `INVALID_OPTION` 的错误。预热池和监督器用同样的方式接收注入的 scheduler。
