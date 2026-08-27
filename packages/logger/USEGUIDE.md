# 使用手册

本文是 `@migaia/logger` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个配置项、每一个 API、每一种边界行为"。

## 目录

1. [导入与运行时](#1-导入与运行时)
2. [Logger 构造参考](#2-logger-构造参考)
3. [Logger API 完整参考](#3-logger-api-完整参考)
4. [Pipeline 模式与 stage](#4-pipeline-模式与-stage)
5. [配置边界](#5-配置边界)
6. [插件安装与实例所有权](#6-插件安装与实例所有权)
7. [Flush 与 shutdown 精确语义](#7-flush-与-shutdown-精确语义)
8. [Entry、hook 与 sink](#8-entry、hook-与-sink)
9. [内置插件详细参考](#9-内置插件详细参考)
10. [extends：多 logger 转发](#10-extends多-logger-转发)
11. [自定义 runtime manager](#11-自定义-runtime-manager)
12. [完整组合示例](#12-完整组合示例)
13. [构建、测试与常见问题排查](#13-构建测试与常见问题排查)

---

## 1. 导入与运行时

```ts
import { Logger, setLoggerRuntimeManager } from '@migaia/logger';
import { batch, color, http, level, process, reasoning, uuid } from '@migaia/logger/plugins';
```

Logger 核心只通过一个内部的 "runtime manager" 间接使用 `process`、任务调度、stdout 写入与 HTTP transport——不直接 import 任何宿主特定的全局对象。这意味着：浏览器环境下没有 `process` 时，`raw()` 自动退回 `console.log`，`process()` 插件安装后检测不到 `process` 就不注册任何监听器（不会报错，静默变成 no-op）。同一套代码可以在 Node、Bun、Deno、浏览器、Worker、小程序、Electron 主/渲染进程运行。

---

## 2. Logger 构造参考

```ts
const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  context: ['app', 'api'],
  topic: 'gateway',
  options: { service: 'gateway' },
  on: { before: (entry) => {} },
  pipeline: { mode: 'sync' },
  plugins: [level(), color()]
});
```

| 构造选项        | 类型                               | 必填性 | 默认值   | 作用                                                                      |
| --------------- | ---------------------------------- | ------ | -------- | ------------------------------------------------------------------------- |
| `context`       | `string[]`                         | 可选   | `[]`     | 每条 entry 默认的 context 路径（未显式传 `context` 时使用）。             |
| `execution`     | `{ mutationTimeoutMs: number \| false; pipelineDrainTimeoutMs: number \| false }` | 必填 | — | PluginHost 操作与 pipeline drain 的截止策略；`false` 表示不设截止时间。 |
| `topic`         | `string`                           | 可选   | `''`     | `extends()` 转发时用于展示的链路节点名。                                  |
| `options`       | `Record<string, unknown>`          | 可选   | `{}`     | 冻结后公开给插件读取的业务只读配置（通过 `ctx.options`）。                |
| `on`            | `Record<string, ILogHookFn>`       | 可选   | `{}`     | 构造时注册 hook 的简写，等价于对每一项调用一次 `log.hook(name, fn)`。     |
| `pipeline.mode` | `'sync' \| 'async' \| 'generator' \| 'async-generator'` | 可选   | `'sync'` | 处理管线的执行模型，构造后不可更改，详见 [§4](#4-pipeline-模式与-stage)。 |
| `plugins`       | `readonly ILoggerPlugin[]`         | 可选   | `[]`     | 按数组顺序同步安装的插件。                                                |

同步插件在构造函数返回前就已经完成安装可用；构造期任何一个插件的 `install()` 返回 Promise/thenable 会**立即抛错**，构造函数不会返回一个"缺了几个插件"的半成品 Logger。需要异步安装的插件，在 Logger 构造完成后用 `await log.use(plugin)` 单独处理，并对失败做好错误处理。

---

## 3. Logger API 完整参考

| API / 签名                                                  | 参数                                                                                                     | 必填性                                      | 返回值                             | 同步/异步 | 作用                                                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `log(tag, message, ...args)`                                | `tag: string`；`message: string`；`args: unknown[]`                                                      | `tag`、`message` 必填；`args` 可省略        | `void`                             | 同步      | console 风格入口；最后一个参数即使是对象，也不会自动被当成 `meta`。                                                             |
| `dispatchRaw(input, options?)`                              | `input: { tag, message, args?, meta?, data?, context?, error?, time? }`；`options.asyncOutput?: boolean` | `input.tag`、`input.message` 必填；其余可选 | `void`                             | 同步      | 显式构造结构化 entry；`asyncOutput: true` 时通过 `defer()` 调度输出，但本方法调用本身同步返回。                                 |
| `raw(text, options?)`                                       | `text: string`；`options.asyncOutput?: boolean`                                                          | `text` 必填                                 | `void`                             | 同步      | 原样写入 runtime 的 stdout/console，**不经过 pipeline 和 sink**。                                                               |
| `ctx`                                                       | 无                                                                                                       | 只读属性                                    | `ILoggerContext`                   | 同步      | 冻结的 `id`、业务 `options`、`path`、`topic`、创建时间、环境信息。                                                              |
| `pipelineMode`                                              | 无                                                                                                       | 只读属性                                    | `'sync' \| 'async' \| 'generator' \| 'async-generator'` | 同步      | 当前 logger 固定的 pipeline 模式。                                                                                |
| `flush()`                                                   | 无                                                                                                       | —                                           | `Promise<void>`                    | 异步      | drain 当前 logger、批处理与 extends 转发下游；并发调用共用同一个 Promise，见 [§7](#7-flush-与-shutdown-精确语义)。              |
| `shutdown(reason)`                                          | `reason: 'signal' \| 'uncaughtException' \| 'unhandledRejection' \| 'manual'`                            | `reason` 必填                               | `Promise<void>`                    | 异步      | 运行 shutdown handler → flush → 卸载插件；重入调用会 alias 到同一个 in-flight promise，见 [§7](#7-flush-与-shutdown-精确语义)。 |
| `dispose()`                                                 | 无                                                                                                       | —                                           | `Promise<void>`                    | 异步      | `shutdown('manual')` 的别名。                                                                                                   |
| `extends(...others)`                                        | `others: ILoggerCore[]`                                                                                  | 至少 1 个目标                               | `this`                             | 同步      | 把当前 logger 接入目标的完整 pipeline/sink，见 [§10](#10-extends多-logger-转发)。                                               |
| `use(...plugins)`                                           | `plugins: ILoggerPlugin[]`                                                                               | 至少 1 个                                   | `Promise<logger & Extensions>`     | 异步      | 运行期动态安装插件。                                                                                                            |
| `unUse(name)`                                               | `name: string`                                                                                           | 必填                                        | `Promise<void>`                    | 异步      | 卸载指定插件。                                                                                                                  |
| `config.get(path)`                                          | `plugin.key` 或 `plugin.[index].key`                                                                     | 必填                                        | `unknown \| undefined`             | 同步      | 读取指定插件的配置嵌套值；直接读插件根配置不合法，见 [§5](#5-配置边界)。                                                        |
| `config.update(name, recipe)`                               | `name: string`；`recipe(previous) => Partial<config>`                                                    | 两项都必填                                  | `Promise<void>`                    | 异步      | 浅合并 patch 并提交，见 [§5](#5-配置边界)。                                                                                     |
| `getShared(key)`                                            | `key: string`                                                                                            | 必填                                        | `T \| undefined`                   | 同步      | 读取已安装插件通过 `shared()` 提供的能力。                                                                                      |
| `hook(name, fn)`                                            | `name: string`；`fn: (entry) => void \| Promise<void>`                                                   | 两项都必填                                  | `() => void`                       | 同步      | 注册 hook；返回取消订阅函数。                                                                                                   |
| `fireHook(name, entry)`                                     | `name: string`；`entry: ILogEntry`                                                                       | 两项都必填                                  | `void`                             | 同步      | 立即触发该名称下的全部 hook。                                                                                                   |
| `onFailure(fn)`                                             | `fn: (failure: ILogFailure) => void`                                                                     | 必填                                        | `() => void`                       | 同步      | 观察 sink/pipeline/flush/hook 等各环节的失败，不打断业务日志调用。                                                              |
| `defer(task)`                                               | `task: () => void \| Promise<void>`                                                                      | 必填                                        | `void`                             | 同步      | 延后执行一个任务，并把它纳入 `flush()` 的等待范围；`defer()` 本身不等待 `task` 完成。                                           |
| `onFlush(fn)`                                               | `fn: () => void \| Promise<void>`                                                                        | 必填                                        | `() => void`                       | 同步      | 注册每轮 `flush()` 都会调用一次的处理函数。                                                                                     |
| `onShutdown(fn)`                                            | `fn: (reason) => void \| Promise<void>`                                                                  | 必填                                        | `() => void`                       | 同步      | 注册 shutdown 收尾钩子。                                                                                                        |
| `useSink(fn)`                                               | `fn: (entry) => void \| Promise<void>`                                                                   | 必填                                        | `() => void`                       | 同步      | 注册一个输出 sink。                                                                                                             |
| `usePipeline` / `useAsyncPipeline` / `useGeneratorPipeline` / `useAsyncGeneratorPipeline` | 与当前 `pipelineMode` 匹配的 stage                                                     | 必填                                        | `this`                             | 同步      | 注册 pipeline 处理阶段，见 [§4](#4-pipeline-模式与-stage)；注册调用本身同步返回。                                 |
| `onDispose(resource)`                                       | disposer 函数或 disposable 对象                                                                          | 必填                                        | `void`                             | 同步      | 仅插件 `install()` 期间可调用，登记资源清理；应用代码不应直接调用。                                                             |
| `PluginHost.setLocale(locale)`                              | 继承自 `@migaia/plugin-host`                                                                             | —                                           | —                                  | 同步      | 见 `@migaia/plugin-host` 文档。                                                                                                 |

`shutdown()` 完成后，`log`、`dispatchRaw`、`raw` 都不再产生任何输出（静默忽略，不抛错）。日志管线内部的失败**默认不会**从业务的 `log()` 调用里抛出来——始终应该用 `onFailure()` 接入监控或错误上报，否则失败会无声无息地消失。

---

## 4. Pipeline 模式与 stage

`pipeline.mode` 在构造时确定，之后不能切换：

| 模式               | 注册方法                    | stage 要求                                              |
| ------------------ | --------------------------- | -------------------------------------------------------- |
| `sync`             | `usePipeline`               | stage 必须同步完成，`(value, next) => void`             |
| `async`            | `useAsyncPipeline`          | stage 可以等待异步工作，`async (value, next) => void`   |
| `generator`        | `useGeneratorPipeline`      | 通过生成器组合处理流程                                  |
| `async-generator`  | `useAsyncGeneratorPipeline` | terminal 语义与 `generator` 一致，串行 `await` 耗尽每个 stage（中间 yield 不提前进入下一 stage） |

`useAsyncGeneratorPipeline` 由 `PluginHost` 基类直接提供（`LoggerCore` 未对它做任何包装），能力与 `@migaia/plugin-host` 的 `host.useAsyncGeneratorPipeline` 完全一致，用法见该包文档。

内置的同步插件（`level`、过滤器、`uuid` 等）会由 Logger 自动适配到当前 mode（含 `async-generator`），因此不管选哪种 mode，这些插件行为一致；但**直接注册自定义 stage 时，注册方法必须和当前 mode 匹配**，不匹配会立即抛错——不存在"用错方法但静默降级"这种情况。`ILoggerCore<TMode>` 在 `TMode` 收窄到某个具体 mode 字面量时，会把其余三个 `useXPipeline` 方法在类型层面收窄为 `never`，因此用错方法通常在编译期就会报错，而不必等到运行时才抛 `PIPELINE_MODE_MISMATCH`。

pipeline 执行期间禁止新增 stage，避免修改一条正在执行中的处理链。每个 stage 在一次调用里最多调用一次 `next()`：重复调用抛出 `PIPELINE_NEXT_DUPLICATE`；stage 已经返回后才延迟调用 `next()` 会产生 `PIPELINE_NEXT_LATE` diagnostic（不抛错，只上报）；完全不调用 `next()` 表示这个 stage 主动拦截了这条 entry，不会继续往下传递。四种 mode 使用完全相同的违规检测逻辑。

`sync` 模式是扁平转换管道：`next()` 只是记录下一个值，下游 stage 在当前 stage 返回**之后**才执行。`async` 模式是洋葱模型：`await next(value)` 会等待整条下游链跑完才继续，因此当前 stage 可以在 `next()` 之后写"后置逻辑"，并且这段逻辑能感知下游是否已经处理完毕。`async-generator` 既不是洋葱模型也不是流式管道，是"stage 顺序执行、每个 stage 各自异步跑完取一个终值"，介于 `async` 与 `generator` 之间。这个差异是切换 pipeline mode 时最容易踩的坑。

---

## 5. 配置边界

应用侧的 `log.config` 是一个统一的配置门面：`get('plugin.key')` 读取指定插件配置的嵌套值，`get('plugin.[index].key')` 读取数组项；`update(name, recipe)` 更新指定插件的配置。配置读取只做**一层浅拷贝**：顶层返回值和存储的配置对象隔离，但嵌套对象/数组仍是共享引用，由调用方自行负责不修改它们——这是有意的设计取舍（深拷贝在高频访问路径上代价不划算），不是遗漏。

插件在 `install(core)` 里拿到的 `core.config` 刻意更窄：它只有无参的 `get()`，**只能读取当前插件自己的配置快照**，不能通过这个门面读取或更新其他插件的配置。插件的异步生命周期也不应该通过反复轮询自己的 config 来等待某个外部条件——这不是配置系统设计的用途。

---

## 6. 插件安装与实例所有权

构造参数里的插件按数组顺序**同步安装**。任一插件安装失败，构造函数直接抛出，并触发已登记资源的回滚（这部分机制来自 `@migaia/plugin-host`，逐插件回滚见其文档）；返回 Promise 或 thenable 的 `install()` 同样会被视为失败。需要异步安装能力的插件，在 Logger 构造完成后使用 `await log.use(plugin)`，并妥善处理 rejected Promise。

**一个插件对象只归属一次安装**。不要把同一个 `http()`、`reasoning()`、`color()` 或其他有状态插件的实例装到多个 Logger 上——每次安装都应该重新调用一次对应的工厂函数。否则该插件内部创建的 controller、buffer、配置快照、disposer 等状态可能在多个 Logger 实例之间相互串联，产生难以定位的 bug。

---

## 7. Flush 与 shutdown 精确语义

### `flush()`

等待本 logger 已经观察到的 deferred task、异步 sink 结果、`onFlush` handler、批处理与 extends 下游全部完成。内部有一个约 3 秒的预算：每一轮 drain 都会和"剩余预算"做一次race——如果某个被追踪的 Promise 迟迟不 settle（比如一个卡死的 HTTP 请求），`flush()` 最多等到预算耗尽就会返回，**不会被单个永不 resolve 的 Promise 永久卡住**，剩余未完成的工作会在通过 `onFailure()` 上报一条"flush deadline reached"之后，留给后续的 `flush()` 调用继续等待。

`flush()` 会追踪任何"看起来像 Promise"的返回值（不要求严格是当前 realm 的 `Promise` 实例），一个手写的、跨 iframe/VM 的 thenable 对象同样会被正确等待。

### `shutdown(reason)`

`shutdown()` 先原子性地进入关闭流程（同步标记状态并发布一个内部 promise），再依次执行 shutdown handler——handler 内部仍然可以通过 `log()`/`dispatchRaw()` 写收尾日志，这些日志会被后续的 flush 阶段一并等到。`raw()` 从关闭流程开始那一刻起就不再直接写 stdout。收尾钩子跑完后进入 flush，再卸载全部插件，最终进入终态，新日志被静默忽略。

**并发/重入调用 `shutdown()` 会 alias 到同一个进行中的 Promise**——即便某个 shutdown handler 自己又调用了一次 `shutdown()`，也只会拿到当前这一轮已经在进行的同一个 Promise，不会触发第二轮独立的 handler 遍历。`shutdown()` 失败（比如某个插件的 `dispose()` 抛错）时，实例会被标记为终态并停止接收日志——这不是一个可以重试恢复的中间状态；再次调用 `shutdown()` 会得到一个已经 resolve 的 Promise（不会重新抛出之前的失败）。

---

## 8. Entry、hook 与 sink

```ts
log.log('info', 'user updated', userId); // userId 是 console 参数
log.dispatchRaw({
  tag: 'info',
  message: 'user updated',
  meta: { userId },
  data: { requestId },
  context: ['api', 'users']
});
```

`ILogEntry` 完整字段：`id`、`tag`、`time`、`message`、`args`、`meta`、`context`、`error`、`data`。传入的 `Error` 参数会生成一份可序列化的 `error` 投影（`name`/`message`/`stack`），同时保留 `error.raw` 指向原始 `Error` 对象的引用。

Hook 名称约定：`before`、`after`、`before:<tag>`、`after:<tag>`，也可以用任意自定义字符串。**`before`/`after` 系列 hook 拿到的是活引用的 entry**——pipeline 阶段本来就需要能修改 entry 内容，这是有意的行为，不是隔离没做好；**只有进入每个 sink 之前，核心才会复制一份顶层容器**（`args`、`meta`、`context`、`data`、`time` 各自浅拷贝一层），因此 sink 之间互不干扰，也不会看到 hook 后续可能产生的修改。反过来说：如果一个 `after` hook 修改了 `entry.data`，这个修改**不会**反映到已经拿到快照的 sink 上，但**会**反映到随后 `extends()` 转发出去的下游（因为转发发生在 `after` hook 之后）——利用这个时序差异做数据脱敏/补充时需要注意先后顺序。嵌套的业务对象（比如 `meta` 里挂的一个对象引用）在浅拷贝之后仍然是同一个引用，sink 不应该修改它们。

---

## 9. 内置插件详细参考

### 9.1 `level(config?)`

添加 `debug`、`info`、`warn`、`error`、`fatal`、`setLevel(level)`、`addFilter(filter)`、`removeFilter(filter)`。

| 配置字段      | 类型                                                | 必填性 | 默认值    | 说明                                         |
| ------------- | --------------------------------------------------- | ------ | --------- | -------------------------------------------- |
| `level`       | `'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal'` | 可选   | `'debug'` | 最低输出等级。                               |
| `filters`     | `ILogFilter[]`                                      | 可选   | `[]`      | 全部 `(entry) => boolean` 返回 true 才放行。 |
| `asyncOutput` | `boolean`                                           | 可选   | `false`   | 该插件产生的日志是否走 `defer` 异步输出。    |

### 9.2 `color(config?)`

控制台 sink，额外提供 shared 能力：`paint(tag, text)`、`dim(text)`。

| 配置字段       | 类型                                                 | 必填性 | 默认值          | 说明                                    |
| -------------- | ---------------------------------------------------- | ------ | --------------- | --------------------------------------- |
| `color`        | `'auto' \| 'always' \| 'never'`                      | 可选   | `'auto'`        | ANSI 颜色策略。                         |
| `format`       | `'auto' \| 'pretty' \| 'json'`                       | 可选   | `'auto'`        | 输出格式；`auto` 根据运行环境自动决定。 |
| `timestamp`    | `boolean`                                            | 可选   | `true`          | pretty 格式是否包含 ISO 时间戳。        |
| `colorMessage` | `'head' \| 'tail' \| 'head-tail' \| 'all' \| 'none'` | 可选   | `'none'`        | message/args 的染色范围。               |
| `colorMap`     | `Record<string, (text) => string>`                   | 可选   | 内置 level 映射 | 自定义 tag 对应的染色函数。             |

`color` 会识别 `entry.data.silent === true` 并跳过打印这条 entry（但其他 sink，比如 HTTP，仍会正常接收它）——常用于"这条日志需要上报但不需要刷屏"的场景。

### 9.3 `batch(config?)`

不添加任何 logger 方法，只提供 shared 能力 `createBatcher(config, onBatch)`，供其他插件（如 `http()`）复用。

| 配置字段      | 类型      | 必填性 | 默认值 | 说明                               |
| ------------- | --------- | ------ | ------ | ---------------------------------- |
| `maxSize`     | `number`  | 可选   | `20`   | 攒够这个数量就触发一次发送。       |
| `maxWaitMs`   | `number`  | 可选   | `2000` | 批次里第一项进入后的最长等待时间。 |
| `asyncOutput` | `boolean` | 可选   | `true` | 满批次的回调是否走 `defer` 调度。  |

Batcher 的 `push(item)` 收集条目，`flush()` 发送剩余条目并等待正在进行的回调完成；这个 batcher 会自动登记进宿主 Logger 的 `flush()` 追踪范围，不需要手动接入。

### 9.4 `http(config)`

把 entry 以 `POST { entries }` 的形式发送到指定 endpoint。

| 配置字段           | 类型                                     | 必填性 | 默认值  | 说明                                                          |
| ------------------ | ---------------------------------------- | ------ | ------- | ------------------------------------------------------------- |
| `url`              | `string`                                 | 必填   | 无      | HTTP endpoint。                                               |
| `authToken`        | `string`                                 | 可选   | 无      | 写入 `Authorization: Bearer ...`。                            |
| `headers`          | `Record<string, string>`                 | 可选   | `{}`    | 附加的请求头。                                                |
| `retries`          | `number`                                 | 可选   | `2`     | 网络错误、429、5xx 情况下的额外重试次数。                     |
| `requestTimeoutMs` | `number`                                 | 可选   | `10000` | 单次请求最长等待时间；超时会 abort 当前请求并按网络错误处理。 |
| `batch`            | `{ maxSize?, maxWaitMs?, asyncOutput? }` | 可选   | 无      | 覆盖传给 `batch()` shared factory 的配置。                    |

4xx 错误（429 除外）会直接失败、不重试；429 优先读取响应的 `Retry-After` 头部作为等待时间，没有该头部时退回指数退避。`shutdown()` 会主动 abort 尚未完成的 HTTP 请求，失败结果可以通过 `onFailure()` 观察到。**需要批量发送必须保证插件顺序是 `plugins: [batch(), http(...)]`**——顺序反了批处理不会生效。

### 9.5 `process(config?)`

Node/Bun 风格的进程适配器，运行时环境没有 `process` 全局对象时自动变成 no-op，不会报错。

| 配置字段               | 类型      | 必填性 | 默认值  | 说明                                                                                                       |
| ---------------------- | --------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `captureCrashes`       | `boolean` | 可选   | `true`  | 捕获 `uncaughtException`/`unhandledRejection` 并记录为 fatal 日志。                                        |
| `shutdownTimeoutMs`    | `number`  | 可选   | `3000`  | 收到信号/崩溃/正常 exit 时，最长允许的 drain 时间。                                                        |
| `interceptProcessExit` | `boolean` | 可选   | `false` | 在 `process.exit()` 真正执行前发起一次 flush；这会改变 `process.exit()` 原本同步立即退出的语义，谨慎开启。 |

同一个运行时的底层监听器只会注册一次（多个 logger 都装 `process()` 不会重复挂多份监听器）；最后一个安装该插件的 logger 被卸载后，监听器和内部 shutdown 状态都会正确清理，因此这个插件可以安全地反复装卸。

### 9.6 `reasoning(config?)`

添加 `startThinking`、`thinking`、`endThinking`、`startResponse`、`response`、`endResponse`。逐 token 内容通过 `raw()` 直接输出（不经过 pipeline）；每个阶段结束时会额外生成一条 `data.silent = true` 的完整 entry，方便 HTTP/审计类 sink 收集完整内容而不重复打印到控制台。

| 配置字段          | 类型      | 必填性 | 默认值          | 说明                                      |
| ----------------- | --------- | ------ | --------------- | ----------------------------------------- |
| `labels.thinking` | `string`  | 可选   | `'Thinking...'` | thinking 阶段的起始标签。                 |
| `labels.response` | `string`  | 可选   | 无              | response 阶段的起始标签。                 |
| `asyncOutput`     | `boolean` | 可选   | `false`         | 流式输出与收尾完整 entry 是否走异步调度。 |

安装在 `color()` 之后可以复用它的 `paint`/`dim` shared 能力做染色；没装 `color()` 时自动退化为纯文本输出。

### 9.7 `uuid(config?)`

为每一条经过 pipeline 的 entry 写入 `data.uuid` 和 `data.uuidDisplay`。

| 配置字段  | 类型      | 必填性 | 默认值  | 说明                                                  |
| --------- | --------- | ------ | ------- | ----------------------------------------------------- |
| `display` | `boolean` | 可选   | `false` | 是否让 `color()` 的 pretty/JSON 输出里展示这个 UUID。 |

---

## 10. extends：多 logger 转发

```ts
const audit = new Logger({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }, topic: 'audit' });
audit.useSink((entry) => sendToAuditSystem(entry));

const api = new Logger({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }, topic: 'api' });
api.extends(audit);

api.info('user created'); // 同时经过 api 自己的 pipeline/sink，也完整转发给 audit
```

`extends()` 转发的是**完整的处理路径**，不是简单抄送——目标 logger 自己的级别阈值、过滤器同样会对转发过来的日志生效。转发时会把当前 `topic` 追加进一份仅用于展示的 `topicChain`，同时把当前 logger 的 `id` 追加进一份仅用于循环检测的内部路径（两者故意分开维护：循环检测不能依赖可能为空、可能重名的 `topic` 字符串）。`extends()` 注册时会做一次静态循环检测（`a.extends(b); b.extends(a)` 这种直接循环会在调用 `extends()` 那一刻就抛错），转发时还有运行时兜底检测，防止通过外部自定义的 `ILoggerCore` 实现绕过静态检测形成循环转发。

**`extends()` 只组合运行时的日志输出路径，不会把目标 logger 通过插件获得的 TypeScript 扩展方法合并到当前变量的类型上**——如果 `audit` 装了 `level()` 有 `.info()` 方法，`api` 不会因为 `extends(audit)` 而在类型上获得任何新方法。extends 关系图不允许成环；`flush()` 会沿着这个图等待全部下游完成。

---

## 11. 自定义 runtime manager

测试环境、非标准宿主，或者需要替换底层能力实现时，可以整体替换 runtime manager：

```ts
const restore = setLoggerRuntimeManager({
  randomUUID: () => crypto.randomUUID(),
  defer: (task) => queueMicrotask(task),
  write: (text) => console.log(text),
  fetch: (url, init) => fetch(url, init)
});

try {
  // 在这段作用域内创建和使用的 Logger 都会用上面这份能力
} finally {
  restore(); // 恢复到替换之前的 runtime manager
}
```

`setLoggerRuntimeManager` 返回一个恢复函数，支持嵌套调用（后进先出恢复），适合在测试用例的 `beforeEach`/`afterEach` 里成对使用。

---

## 12. 完整组合示例

```ts
import { Logger } from '@migaia/logger';
import { batch, color, http, level, process, uuid } from '@migaia/logger/plugins';

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  context: ['worker'],
  plugins: [
    level({ level: 'info' }),
    uuid({ display: true }),
    batch({ maxSize: 50, maxWaitMs: 1000 }),
    http({ url: 'https://logs.example/v1/entries', batch: { maxSize: 50 } }),
    color({ format: 'pretty' }),
    process()
  ]
});

log.onFailure(({ source, error }) => reportLoggerFailure(source, error));
log.info('job started', { jobId: 'j_1' });
await log.flush();
```

---

## 13. 构建、测试与常见问题排查

在仓库根目录运行以下包级门禁；`test` 会先执行本包的 `build`。

```bash
pnpm --filter @migaia/logger fmt
pnpm --filter @migaia/logger lint
pnpm --filter @migaia/logger typecheck
pnpm --filter @migaia/logger typecheck:test
pnpm --filter @migaia/logger test
```

**Q：日志明明报错了，但业务代码里 catch 不到。**
这是设计如此——日志系统内部的失败不会从 `log()`/`dispatchRaw()` 抛出，避免日志问题拖垮业务逻辑。用 `log.onFailure(fn)` 接入监控，`fn` 会收到 `{ source, error }`，`source` 取值包括 `defer`/`hook`/`sink`/`pipeline`/`flush`/`forward`/`shutdown`。

**Q：`flush()` 迟迟不返回。**
检查是否有 sink/hook 返回了一个永远不会 settle 的 Promise——`flush()` 内部有约 3 秒预算会自动放弃并通过 `onFailure` 报告，但如果你观察到的等待时间远超 3 秒，说明可能是别的原因（比如递归触发了新的 `defer` 任务）。

**Q：`shutdown()` 之后还想恢复使用。**
不支持——`shutdown()`（无论成功还是失败）都会把 logger 带入终态，之后的日志调用会被静默忽略。需要"可恢复"的场景应该创建一个新的 `Logger` 实例，而不是复用已经 shutdown 的实例。

**Q：批量 HTTP 发送没生效，还是一条一条发。**
检查插件顺序是不是 `plugins: [batch(), http(...)]`——`http()` 必须排在 `batch()` 之后才能拿到批处理的 shared 能力。

**Q：同一个插件装在两个 Logger 上，行为很奇怪。**
不要复用插件实例，见 [§6](#6-插件安装与实例所有权)。每次安装都重新调用一次插件工厂函数（比如两次分别调用 `http({...})`，而不是把同一个 `http({...})` 的返回值装两次）。

**Q：TypeScript 提示某个插件方法不存在。**
只有插件真正被装上（无论是构造参数里还是 `await log.use(plugin)`），对应方法才会出现在类型上。异步安装的插件如果是根据运行时条件动态选择的，TypeScript 无法静态推导，需要手动标注类型。
