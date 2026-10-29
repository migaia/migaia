# log-host 使用指南

## 建立 host

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin } from '@migaia/log-plugin-console'

/** 每个 host 独立拥有上下文、插件与交付队列。 */
const log = createLogHost({
  context: ['orders'],
  topic: 'api',
  maxPending: 10000,
  plugins: [levelPlugin(), consolePlugin()]
})
log.info('created', { orderId: 'o1' })
log.log('audit', 'arbitrary tags remain valid')
await log.flush()
await log.shutdown('manual')
```

选项包括 `plugins`、`context`、`topic`、`maxPending`、`scheduler`、`randomUUID`、`report` 与 plugin-host 的 `execution`。调度器默认使用 utils `systemScheduler`；UUID 默认使用 `globalThis.crypto.randomUUID()`，也可按 host 注入。

注入的调度器必须在 `schedule()` 返回 receipt 后才运行 callback；返回之前同步调用 callback 不在支持范围内。

host 门面被冻结。`ctx` 的顶层容器、上下文路径与环境标记也被冻结；嵌套用户值与 Date 保留身份，不做深克隆。`dispatchRaw()` 同步复制输入条目的顶层数组与对象，忽略输入 id，生成自己的条目 id。输出端各自收到浅快照；原生 Error 与嵌套业务对象保持身份。

## 级别、过滤与条目

`levelPlugin()` 添加 `debug`、`info`、`warn`、`error`、`fatal` 与 `atLevel`。字符串首参作为 message，其余参数保留原生类型；非字符串首参进入 args。插件本身不做过滤。

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/plugin'
import { thresholdFeature, filterFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** 冷定义可以复用；每个插件安装独立拥有 live 门槛状态。 */
const threshold = thresholdFeature({ level: 'warn' })
/** filter 定义不包含控制；安装后的插件扩展提供 add。 */
const filters = filterFeature()
/** entry feature 只在 host 级执行一次。 */
const log = createLogHost({
  plugins: [
    defineLogPlugin({
      name: 'policy',
      features: { threshold, filter: filters, uuid: uuidFeature({ display: false }) }
    }),
    levelPlugin(),
    consolePlugin()
  ]
})
/** 这一过滤器与其它注册保持独立。 */
const off = log.policy_filter_add((entry) => entry.message !== 'hidden')
log.atLevel('error', { tag: 'storage', message: 'write failed' })
log.policy_threshold_setLevel('debug')
off()
await log.shutdown('manual')
```

门槛只解释标准级别；普通未知 tag 跳过级别比较，仍经过过滤。`atLevel()` 保留业务 tag，并携带其标准级别供门槛解释。UUID 总是写入 `data.uuid`，`display` 只控制 `data.uuidDisplay`，不关闭生成。

## 输出策略与作用域

entry 在 host 入口执行一次；每个输出端随后按 gate、format、batch、retry、timeout、实际输出的阶段顺序交付。同一 gate 阶段保留有效 record 的声明顺序，不用工厂类别决定名称或覆盖。

`defineLogPlugin({ name, features })` 通过原生 `definePlugin` 安装 host-wide 策略。`createLogHost` 没有 `features` 选项；所有策略随调用者声明的插件进入。`defineOutputPlugin` 的策略只作用于自己的输出。两者一律使用 `{ alias: feature }` record，保留属性声明顺序。

record key 是唯一名称：输出级 `features.<key>` 仅覆盖 host-wide 同 key 的 feature。不同 key 即使使用同一工厂也都保留，例如 `{ a: thresholdFeature(), b: thresholdFeature() }` 会应用两个 gate。未覆盖的 host gate 先运行，输出级 gate 随后按声明顺序运行。entry feature 只允许装在 host-wide carrier。

一个 record 内 key 天然唯一；多个 host-wide carrier 声明同 key 时使用既有名称冲突错误路径。所有输出各自在实际安装时按 key 合并 host/local，随后检查单一执行槽：最多一个有效 format，以及各一个 batch、retry、timeout。不同 key 不会互相覆盖，违反单一槽约束以既有 `INVALID_OPTION` 拒绝，动态 `use()` 也执行这项安装校验。没有有效显式 format 时采用输出插件的 `defaultFormat`。

| Feature                               | 作用                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `thresholdFeature({ level })`         | 标准级别门槛，安装后暴露 `${pluginName}_${alias}_setLevel()`                       |
| `filterFeature({ filters })`          | 按顺序运行 predicates；安装后暴露 `${pluginName}_${alias}_add()`，返回独立撤销函数 |
| `uuidFeature({ display })`            | 用当前 host 的生成器丰富条目                                                       |
| `formatFeature({ format })`           | `json` 或不着色的 `plain` 文本                                                     |
| `batchFeature(options)`               | 为可批量输出端提供有界缓冲与排空                                                   |
| `retryFeature({ attempts, backoff })` | 基于 utils retry；attempts 是含首次调用的总次数                                    |
| `timeoutFeature({ ms })`              | 基于 utils withTimeout 限制一次交付                                                |

batch 默认 `maxSize: 20`、`maxWaitMs: 2000`、`maxConcurrentBatches: 1`、`maxPendingBatches: 1024`、`drainTimeoutMs: 3000`。容量同时计入排队和执行中的批次；满时丢弃最旧的排队批次，若所有槽位都在执行中则丢弃传入批次，并报告带 `detail.dropped` 的 `BATCH_OVERFLOW`。移除输出插件时先排空最后缓冲，再撤销交付所用的注册 signal。

retry 的 `attempts` 必须显式给出正安全整数；`backoff` 可为毫秒数或接收失败尝试序号的函数。输出端的 `retryable` 决定是否继续；`retryDelay` 的值经 `beforeRetry` 接入，并优先于普通 backoff。超时通过失败通道报告 `DELIVERY_FAILED`，原始 utils 超时错误保留在 `cause`。

交付失败且 timeout 清理也失败时，`retryable` 与 `retryDelay` 收到原始交付错误。清理错误在原聚合中依次跟在主错误后，该聚合保留在 `logging / DELIVERY_FAILED` 包装的 `cause`。交付成功后的清理失败只报告一次，经相同 host 错误边界离开，不重发已成功的操作。

## 编写输出插件

```ts
import { createLogHost } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/plugin'
import { batchFeature, formatFeature } from '@migaia/log-host/features'

/** 输出端拥有最终数据去向；策略与资源仍由 host 管理。 */
const lines: string[] = []
/** 输出级策略覆盖 host 默认值，不复制批量或格式实现。 */
const output = defineOutputPlugin({
  name: 'memory-output',
  batchable: true,
  defaultFormat: 'json',
  features: { batch: batchFeature({ maxSize: 2 }), format: formatFeature({ format: 'plain' }) },
  deliver(records) {
    for (const record of records) lines.push(record.text)
  }
})
/** 不安装 levelPlugin 时仍可使用通用 log(tag, message)。 */
const log = createLogHost({ plugins: [output] })
log.log('info', 'one')
log.log('info', 'two')
await log.flush()
await log.shutdown('manual')
```

`deliver` 接收 `readonly ILogOutputRecord[]` 和只读 `{ signal, format }`。record 同时包含原生 `entry` 与已选格式的 `text`。`context.format` 是实际安装后的 formatter implementation，不是冷 feature token；通过其格式函数或可选 pretty 渲染能力观察行为，不比较 token 身份。

不消费文本的输出声明 `consumesText: false` 并省略 `defaultFormat`。其回调收到只含 `entry` 的 record 与只含 `signal` 的 context；host 跳过该输出的格式阶段，输出级配置任何 format 都在创建时抛 `INVALID_OPTION`。entry、gate、批量、重试与超时照常执行。省略 consumesText 则保留原文本回调类型与必填 defaultFormat。

`defineLogPlugin` 与 `defineOutputPlugin` 都在真实 native `features` record 中声明 feature；可选 `install(core)` 通过 `core.features[alias]` 读取原生安装输出并返回扩展。host 与动态 use 句柄保留扩展的精确类型。filter/threshold 的控制自动以 `${pluginName}_${alias}_${method}` 命名暴露，完整扩展重名由 plugin-host 拒绝。复用同一 token 不会共享不同插件或 host 的可变状态；一个 carrier 的控制会影响所有继承其默认策略的输出。插件 core 提供安装期资源登记、scoped config、lifecycle、scheduler、sink、failure、defer、flush 与 shutdown 能力；资源通过真实 plugin-host 生命周期回滚与释放。

第三方使用 `defineLogFeature()`，完整实现 entry、gate 或 format 中一种，例如 `defineLogFeature({ phase: 'gate', accept: () => true })`；delivery 只由内置 batch/retry/timeout 工厂提供。所有工厂返回真实 `defineFeature` 原生 opaque token，不带 phase、stage、setLevel 或 add 字段。定义不接受名称字段，名称仅来自 record key。phase 与作用域规则留在 log metadata；三个内置交付工厂的单一槽身份也只保存在私有 metadata；状态和控制由原生 install 输出拥有。普通字面量、浅复制和类型断言都不能制造 plugin-host 身份。

## 错误投影与失败通道

`projectLogEntry(entry)` 是共享结构化投影。它只把 error 替换为 utils `serializeErrorChain(entry.error.raw)`；保留 source、code、name、message、stack、cause 与 aggregate 分支，排除 raw 的自有私有字段。JSON 格式与 HTTP envelope 共用该投影，原始 entry.error.raw 不变。

```ts
import { createLogHost } from '@migaia/log-host'

/** 单独的 reporter 接收无人处理的失败和失败监听器自身的异常。 */
const log = createLogHost({ report: (error) => console.error(error) })
/** 撤销函数只移除这一监听器。 */
const off = log.onFailure(({ source, error }) => console.error(source, error))
log.log('audit', 'event')
await log.flush()
off()
await log.shutdown('manual')
```

日志方法与 flush/shutdown 的运行期错误不会进入业务控制流；创建配置错误与 use/unUse 的配置拒绝仍可离开调用边界。没有失败监听器时直接调用 reporter；监听器失败产生 `HOOK_FAILED`，原异常在 cause。reporter 自身抛错、then getter 失败或拒绝均被收住，终端失败不再递归上报。

`flush()` 的 3000 毫秒默认预算不证明所有日志已经送达。到期报告 `LIFECYCLE_DEADLINE` 并兑现；未完成工作的晚到拒绝仍被观察。shutdown 共享同一个 Promise，保留第一个 reason，先运行允许写最后日志的处理器，再关闭准入并释放插件。释放结果中的 `cleanupErrors` 必须由业务按需要检查。

## 转发与动态配置

`forwardPlugin({ targets })` 把当前 host 处理后的逻辑条目转交给目标 host，目标自己的管线与策略仍然执行。安装时拒绝自身与多跳环，分别使用 `FORWARD_SELF`、`FORWARD_CYCLE`。源 host 的 flush 包含目标的异步工作。

`use(...plugins)` 返回按输入顺序排列的真实 plugin-host 句柄元组；原变量的静态类型不会因动态安装而增加方法。`unUse(name)` 返回 peer 的 removal 结果，重复移除不存在插件会拒绝。撤销 forward 插件移除其边；源 shutdown 不关闭目标 host。

## 从 `@migaia/logger` 迁移

| 旧入口或能力                                    | 新入口或处理方式                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Logger(...)`、`level()`                    | `createLogHost(...)`、`levelPlugin()`；过滤拆成 `thresholdFeature()`、`filterFeature()`                                                                                                       |
| `uuid()`、`batch()`                             | `uuidFeature()`、`batchFeature()`；批量、重试和超时由 host 持有                                                                                                                               |
| `color()`、console 输出                         | `consolePlugin()` 与 `prettyFeature()`；原生参数保留，meta 仍浅复制，已在 args 中的原对象与 meta 副本分别输出                                                                                 |
| `http({ retries, ... })`                        | `httpPlugin()` 配合 `retryFeature({ attempts: retries + 1, backoff: 200 })`；attempts 包含首次 POST                                                                                           |
| HTTP 内置 batch/timeout/format                  | 显式 `batchFeature()`、`timeoutFeature({ ms: 10000 })`；HTTP 不消费文本格式，仍发送 `{ entries }` JSON                                                                                        |
| `file()` 与 runtime 文件写入                    | `filePlugin({ path, writer })`；writer 由业务持有，rotate 阈值仍按一次交付批次计算                                                                                                            |
| `process()`                                     | `processPlugin({ process })`；注入的 process 拥有真实事件监听与退出能力，host 负责 flush/shutdown                                                                                             |
| `reasoning()` 与 raw 输出                       | `reasoningPlugin({ write })`；六个 reasoning 方法与默认 `asyncOutput: false` 保留，raw 由 console 插件自己的扩展提供                                                                          |
| durable 工厂与文件 store                        | `@migaia/log-plugin-durable` 的 `binlogPlugin()`、`walPlugin()`、`undoLogPlugin()`；文件 store 从该包 `/file` 入口导入                                                                        |
| 统一 logging 错误域                             | host 用 `logging`；HTTP/file/process 分别用 `logging.http`、`logging.file`、`logging.process`，durable 用 `logging.durable`；console/reasoning 保留原能力错误，检查实际 source、code 与 cause |
| `extends()`、`unextend()`                       | 安装或移除 `forwardPlugin()`，不保留兼容别名                                                                                                                                                  |
| 全局 runtime manager                            | host 的 scheduler/randomUUID/report 与插件自己的能力选项                                                                                                                                      |
| host 同步/generator 模式、host asyncOutput 开关 | 日志交付统一异步，读取结果前 `await log.flush()`；这不移除 reasoning 的同名选项                                                                                                               |
| hook/fireHook、构造器 on、dispose 别名          | 删除 hook/on；用 `shutdown('manual')` 释放 host                                                                                                                                               |
| `shutting-down`                                 | `LogHostStatus.shuttingDown`，值为 `shuttingDown`                                                                                                                                             |

日志方法、flush 与 shutdown 的运行期失败走失败通道，不进入业务控制流；配置错误仍可拒绝。durable 的 append/read/事务操作保留拒绝语义，原错误通过 cause 或 aggregate 分支可达，不能把持久化失败当成成功。以下两个完整示例只注入内存能力，不发网络请求或写磁盘。

```ts doc-test=run
import assert from 'node:assert/strict'
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/plugin'
import {
  batchFeature,
  formatFeature,
  retryFeature,
  timeoutFeature
} from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'
import { httpPlugin } from '@migaia/log-plugin-http'
import { filePlugin } from '@migaia/log-plugin-file'

/** Injected capabilities keep this example offline and leave application resources borrowed. */
const observed = { console: [] as string[], http: [] as string[], file: [] as string[] }
/** All console levels use this one injected destination. */
const target = {
  log(text: unknown) {
    observed.console.push(JSON.parse(String(text)).message)
  },
  warn(text: unknown) {
    this.log(text)
  },
  error(text: unknown) {
    this.log(text)
  }
}
/** An ordinary carrier declares delivery policy; each transport owns its destination. */
const log = createLogHost({
  plugins: [
    defineLogPlugin({
      name: 'policy',
      features: {
        format: formatFeature({ format: 'json' }),
        batch: batchFeature({ maxSize: 2 }),
        retry: retryFeature({ attempts: 2, backoff: 0 }),
        timeout: timeoutFeature({ ms: 10000 })
      }
    }),
    levelPlugin(),
    consolePlugin({ console: target }),
    httpPlugin({
      url: 'https://example.invalid/logs',
      async fetcher(_url, init) {
        for (const entry of JSON.parse(init.body).entries) observed.http.push(entry.message)
        return { ok: true, status: 200, headers: new Headers() }
      }
    }),
    filePlugin({
      path: 'application.ndjson',
      writer: {
        async append(_path, text) {
          for (const line of text.trimEnd().split('\n'))
            observed.file.push(JSON.parse(line).message)
        }
      }
    })
  ]
})
try {
  log.info('created')
  log.warn('queued')
  await log.flush()
  assert.deepEqual(observed.console, ['created', 'queued'])
  assert.deepEqual(observed.http, observed.console)
  assert.deepEqual(observed.file, observed.console)
} finally {
  await log.shutdown('manual')
}
```

```ts doc-test=run
import assert from 'node:assert/strict'
import { createLogHost } from '@migaia/log-host'
import { binlogPlugin, walPlugin, undoLogPlugin, memoryLogStore } from '@migaia/log-plugin-durable'

/** The application owns these stores; installed plugins borrow their lifetime. */
const records = memoryLogStore()
/** WAL intent state is independent from ordered business records. */
const intents = memoryLogStore()
/** Undo images are JSON data owned by the business operation. */
const images = memoryLogStore()
/** Explicit execution budgets retain durable operation admission semantics. */
const log = createLogHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [
    binlogPlugin({ store: records }),
    walPlugin({ store: intents }),
    undoLogPlugin({ store: images })
  ]
})
try {
  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])
  await log.binlog.append('order.created', { id: 'o1' })
  const intent = await log.wal.begin('order.update', { id: 'o1' })
  await log.undo.record('tx-1', [{ target: { id: 'o1' }, before: null, after: { state: 'ready' } }])
  await log.wal.complete(intent)
  assert.equal((await log.binlog.read(1))[0]?.kind, 'order.created')
  assert.equal((await log.undo.get('tx-1'))?.length, 1)
  assert.deepEqual(await log.wal.pending(), [])
} finally {
  await log.shutdown('manual')
  await Promise.all([records.dispose(), intents.dispose(), images.dispose()])
}
```
