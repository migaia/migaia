# @migaia/logger

**插件化、运行时中立的日志库**——核心只有 200 多行，级别过滤、彩色控制台输出、批量上报、HTTP 发送、进程退出兜底、流式 AI 输出这些具体能力全部是可选插件。

## 1. 这是什么

大部分日志库要么"太薄"（只有 `console.log` 的包装，加个级别过滤就要自己写），要么"太厚"（内置一大堆你用不上的传输器、格式化器，想自定义还得绕过它的既有设计）。`@migaia/logger` 走的是第三条路：**核心只负责"一条日志从产生到落地"这条最短路径本身**——构造 entry、跑一遍处理管线（pipeline）、分发给若干个输出端（sink）、收尾时等待异步工作完成（flush/shutdown）——不内置"级别""颜色""批量"这些概念，这些全部通过插件注入。

这个设计带来一个直接的好处：**你不需要的能力，一行代码都不会进你的 bundle**。只要 `level()` 和 `color()`，产物就只有级别过滤和控制台着色两个插件的体积；生产环境加上 `http()` 和 `batch()`，日志会自动攒批发到你的日志平台；进程退出前需要保证日志不丢，加一个 `process()`。整个库基于 `@migaia/plugin-host` 构建，插件的安装、卸载、生命周期管理都复用同一套经过充分打磨的机制。

## 2. 适合什么场景

| 场景                       | 说明                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| 需要跨运行时统一日志方案   | Node、Bun、Deno、浏览器、Worker、小程序、Electron 主/渲染进程都能跑同一套 API                    |
| 需要按需组合日志能力       | 开发环境要彩色控制台，生产环境要批量 HTTP 上报，本地脚本什么插件都不装——同一个核心，不同插件组合 |
| 需要保证进程退出前日志不丢 | `process()` 插件在收到退出信号/未捕获异常时自动 flush 并优雅退出                                 |
| 需要把日志转发给多个下游   | `extends()` 把一个 logger 的输出完整转发到另一个 logger 的 pipeline/sink，环路会被拒绝           |
| 需要流式展示 AI 生成内容   | `reasoning()` 插件提供逐 token 的 thinking/response 输出原语                                     |
| 需要自己扩展日志能力       | 插件系统是公开的一等公民，不是"内部实现细节"，自定义插件和内置插件享受同等待遇                   |

不适合的场景：如果你只是想要一个"能设置级别的 `console.log`"，`level()` + 原生 `console` 可能就够了，不需要理解插件系统。

## 3. 用了之后能得到什么

- **console 风格调用体验**：`log.info('user %s logged in', userId)`，参数就是参数，不强制你写结构化对象。
- **需要结构化时也能结构化**：`log.dispatchRaw({ tag, message, meta, data, context })` 一次性给全字段，适合审计日志、结构化上报。
- **收尾保证**：`flush()` 会等待所有已知的异步输出（sink 返回的 Promise、批处理、转发下游）完成；`shutdown()` 在此基础上先跑你注册的收尾钩子，再彻底关闭。
- **失败不打断业务**：sink 抛错、pipeline 抛错、flush 抛错，都不会从你调用 `log.info()` 的那一行抛出来——通过 `onFailure()` 单独观察，业务代码永远不会因为日志系统出问题而崩溃。
- **多目标转发**：一次 `extends(otherLogger)` 就能让当前 logger 的每条日志完整走一遍目标 logger 自己的 pipeline 和 sink（包括目标自己的级别过滤），而不是简单的抄送。
- **HTTP 上报开箱即用**：内置重试、超时、429 退避、批量攒批，不用自己写这套基础设施。
- **运行时中立**：核心不 import `process`、不依赖 DOM，缺失能力时优雅降级（比如浏览器没有 `process`，`raw()` 自动退回 `console.log`）。

## 4. 五分钟上手

```ts
import { Logger } from '@migaia/logger'
import { color, level } from '@migaia/logger/plugins'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  context: ['api'],
  plugins: [level({ level: 'info' }), color({ format: 'pretty', color: 'auto' })]
})

log.info('server listening on %d', 3000)
log.error('request failed', new Error('timeout'))

await log.flush() // 确保上面这些日志真正落地了再退出/继续
```

生产环境加上批量 HTTP 上报和优雅退出：

```ts
import { Logger } from '@migaia/logger'
import { batch, http, level, process } from '@migaia/logger/plugins'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [
    level({ level: 'info' }),
    batch({ maxSize: 50, maxWaitMs: 1000 }),
    http({ url: 'https://logs.example/v1/entries', batch: { maxSize: 50 } }),
    process() // 进程退出/崩溃前自动 flush
  ]
})

log.onFailure(({ source, error }) => console.error(`[logger] ${source} failed`, error))
```

## 5. 核心概念一览

| 概念                     | 是什么                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Entry（日志条目）**    | 一次 `log()`/`dispatchRaw()` 调用产生的结构化对象：`id`、`tag`、`time`、`message`、`args`、`meta`、`context`、`error`、`data` |
| **Pipeline（处理管线）** | entry 在到达 sink 之前经过的一系列转换阶段，比如级别过滤就是一个 pipeline stage                                               |
| **Sink（输出端）**       | 真正把 entry "落地"的地方——控制台、HTTP、文件等，一个 logger 可以有多个 sink                                                  |
| **Hook（钩子）**         | `before`/`after`/`before:<tag>`/`after:<tag>` 等命名事件，用于在 entry 生命周期的特定节点插入逻辑                             |
| **Flush**                | 等待当前已知的全部异步输出工作完成                                                                                            |
| **Shutdown**             | 跑收尾钩子 → flush → 卸载全部插件的完整关闭流程                                                                               |
| **Extends（转发）**      | 把当前 logger 接入另一个 logger 完整的 pipeline/sink，环路会被静态和运行时双重检测拒绝                                        |

## 6. 内置插件一览

| 插件/签名            | 参数类型                                  | 同步/异步 | 作用                                                        |
| -------------------- | ----------------------------------------- | --------- | ----------------------------------------------------------- |
| `level(config?)`     | `config?: ILevelPluginConfig`             | 同步      | 添加 `debug/info/warn/error/fatal` 方法与级别/过滤器控制    |
| `color(config?)`     | `config?: IColorPluginConfig`             | 同步      | 控制台输出，支持 pretty/JSON 格式和 ANSI 颜色               |
| `batch(config?)`     | `config?: IBatchPluginConfig`             | 同步      | 提供批处理调度能力（被 `http()` 复用，也可单独用）          |
| `http(config)`       | `config: IHttpPluginConfig`（`url` 必填） | 同步      | 把 entry 批量 POST 到 HTTP endpoint，内置重试/超时/429 退避 |
| `process(config?)`   | `config?: IProcessPluginConfig`           | 同步      | Node/Bun 风格的进程信号与优雅退出适配                       |
| `reasoning(config?)` | `config?: IReasoningPluginConfig`         | 同步      | 流式 thinking/response 输出，适合展示 AI 生成过程           |
| `uuid(config?)`      | `config?: IUuidPluginConfig`              | 同步      | 给每条 entry 附加唯一 id                                    |

## 7. 安装与公开入口

```bash
pnpm add @migaia/logger
```

| 入口                     | 内容                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| `@migaia/logger`         | `Logger`、运行时 manager、状态/错误码、日志与插件类型。                          |
| `@migaia/logger/plugins` | `level`、`color`、`batch`、`http`、`process`、`reasoning`、`uuid` 及其配置类型。 |

## 8. 生命周期、错误与边界

1. **构造函数只接受同步安装的插件**。`new Logger({ plugins: [...] })` 里的插件必须能同步完成安装，需要异步安装的插件用 `await log.use(plugin)`。
2. **插件实例不能跨 logger 复用**。每次安装都应该重新调用一次插件工厂函数（`level()`、`http()` 等），不要把同一个插件实例装到多个 `Logger`，否则内部状态可能串联。
3. **`shutdown()` 之后日志被静默忽略**，不会抛错也不会有任何提示——这是有意的（避免退出流程里到处加判断），需要感知的话订阅 `onFailure()` 或自行检查状态。
4. **日志系统内部的失败不会从业务调用抛出**。`log.info()` 永远不会因为 sink 挂了而抛异常——务必用 `onFailure()` 观察，否则问题会悄悄消失。
5. **`pipeline.mode` 构造后不可切换**，四种模式（sync/async/generator/async-generator）执行顺序有本质区别，混用会立即报错，详见 USEGUIDE。
6. **`http()` 批量发送要求插件顺序正确**：`plugins: [batch(), http(...)]`，顺序反了批处理不会生效。
7. **`extends()` 只转发运行时输出路径**，不会把目标 logger 的 TypeScript 扩展方法合并进当前变量的类型。
8. **批处理队列有界且不会静默丢日志**：`maxPendingBatches` 默认 `1024`，满载时抛出/上报 `BATCH_OVERFLOW`；生产环境应通过 `onFailure()` 监控并在下游恢复后再接纳新日志。

## 9. 高阶组合示例

### 失败隔离、批量上报与确定性关闭

生产日志链路既不能让上报失败打断业务，也不能在进程退出时丢掉已经接纳的批次。把失败观察器、批处理和 HTTP sink 安装在同一个 Logger 上，并在宿主关闭边界显式等待 `shutdown()`：

```ts
import { Logger } from '@migaia/logger'
import { batch, http, level } from '@migaia/logger/plugins'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 5_000 },
  plugins: [
    level({ level: 'info' }),
    batch({ maxSize: 50, maxWaitMs: 1_000 }),
    http({ url: 'https://logs.example/v1/entries' })
  ]
})

const stopFailureObservation = log.onFailure(({ source, error }) => {
  console.error(`[logger:${source}]`, error)
})

try {
  log.info('checkout completed: %s', 'order-42')
  await log.flush()
} finally {
  stopFailureObservation()
  await log.shutdown('manual')
}
```

`batch()` 必须位于 `http()` 前面，才能让 HTTP sink 使用批量调度。`onFailure()` 是日志基础设施失败的观察出口；业务日志调用不会替它抛错。并发或重入的 `shutdown()` 共享同一个进行中的关闭 Promise，因此宿主的多个收尾入口可以安全汇合，但终态 Logger 不能重新启用，需要创建新实例。

## 10. 深入参考

完整构造选项、全部 API 精确签名、pipeline 三种模式的执行顺序差异、每个内置插件的完整配置项、`flush`/`shutdown` 的精确语义与边界情况、自定义 runtime manager（替换底层能力用于测试/特殊宿主）、以及更多组合示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
