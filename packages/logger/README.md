# `@migaia/logger`

把日志条目交给可组合的处理管线与输出端，并在请求或进程收尾时等待已追踪的异步工作。

## 你可能遇到过

- 审计收集器要从终端文本里猜订单字段：消息排版和结构化交付混在了一起。
- 一个输出端改了展示字段，另一个也跟着变：所有输出端复用了同一个可变条目。
- 日志函数已经返回，进程退出时数据却还没写完：输出端的 Promise 没有交给统一的排空边界。
- 多个关闭入口各写一条最终日志：清理函数没有共享同一次关闭结果。

## 为什么选它

- **直接按命名字段消费日志。** 核心条目把 message、context 与 meta 分开交给输出端，见[收集请求字段，不依赖控制台格式](./USEGUIDE.md#收集请求字段不依赖控制台格式)。
- **隔开各输出端的表层修改。** 每个输出端取得独立的浅层容器，嵌套引用边界也能明确观察，见[避免一个输出端改写另一个输出端的条目字段](./USEGUIDE.md#避免一个输出端改写另一个输出端的条目字段)。
- **在继续执行前等待已接纳的异步输出。** 输出端返回的 Promise 会进入 flush 跟踪，见[继续执行前等待异步输出端完成](./USEGUIDE.md#继续执行前等待异步输出端完成)。
- **让多个收尾入口共享一次关闭。** shutdown 先发布稳定 Promise，再执行最终日志与清理，见[在共享关闭流程中写入最后一条日志](./USEGUIDE.md#在共享关闭流程中写入最后一条日志)。
- **把级别门槛与临时过滤分开控制。** level 提供 setLevel 和可撤销的 addFilter，不用在每个调用点重复比较，见[按级别设门槛，并临时排除保密条目](./USEGUIDE.md#按级别设门槛并临时排除保密条目)。

## 从这里开始

```ts doc-test=run
import { Logger } from '@migaia/logger'

const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  context: ['checkout']
})
log.useSink((entry) => {
  console.log(entry.context.join('.'), entry.message, entry.meta?.orderId)
})
log.dispatchRaw({ tag: 'audit', message: '订单已保存', meta: { orderId: 'A-17' } })
await log.shutdown('manual')
```

输出：

```text
checkout 订单已保存 A-17
```

下一步：输出还没完成看[异步排空](./USEGUIDE.md#继续执行前等待异步输出端完成)，需要级别方法看[门槛与过滤](./USEGUIDE.md#按级别设门槛并临时排除保密条目)。

## 手写时的隐患

下面用原生函数模拟同一条目交付场景，只展示、不执行；行内标出字段、共享对象与完成信号的隐患。

```ts doc-test=check
type IEntry = { message: string; args: unknown[] }
const sinks: ((entry: IEntry) => void | Promise<void>)[] = []
function log(message: string, ...args: unknown[]) {
  const entry = { message, args } // 隐患：订单对象仍只是参数，没有命名的 meta 字段。
  for (const sink of sinks) {
    const completion = sink(entry) // 隐患：所有输出端可修改同一个对象。
    void completion // 隐患：异步输出完成信号被丢弃。
  }
}
void log
```

## 三分钟心智模型

先构造日志器，再选择处理步骤和输出端；写日志后，按宿主边界等待 flush 或 shutdown。

| 术语             | 含义                               | 对应工具                              |
| ---------------- | ---------------------------------- | ------------------------------------- |
| 条目（entry）    | 一次日志调用携带的命名字段         | log / dispatchRaw                     |
| 管线（pipeline） | 交付前转换或拦截条目的步骤         | usePipeline；level 提供阈值步骤       |
| 输出端（sink）   | 真正消费条目的回调                 | useSink；color、http、file 是具体适配 |
| 排空（flush）    | 等已观察到的异步工作完成或达到预算 | flush，无参数，默认内部预算 3000 毫秒 |
| 关闭（shutdown） | 写最终日志、排空，再释放插件       | shutdown(reason) / dispose()          |

## 典型场景

| 场景                                     | 怎么组合                                        | 详细说明                                                           |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| 收集请求字段，不依赖控制台格式           | `new Logger → useSink → dispatchRaw → shutdown` | [完整示例](./USEGUIDE.md#收集请求字段不依赖控制台格式)             |
| 避免一个输出端改写另一个输出端的条目字段 | `useSink × 2 → dispatchRaw`                     | [完整示例](./USEGUIDE.md#避免一个输出端改写另一个输出端的条目字段) |
| 继续执行前等待异步输出端完成             | `useSink(async) → log → flush`                  | [完整示例](./USEGUIDE.md#继续执行前等待异步输出端完成)             |
| 在共享关闭流程中写入最后一条日志         | `onShutdown → shutdown / dispose`               | [完整示例](./USEGUIDE.md#在共享关闭流程中写入最后一条日志)         |
| 按级别设门槛，并临时排除保密条目         | `level → addFilter → setLevel`                  | [完整示例](./USEGUIDE.md#按级别设门槛并临时排除保密条目)           |
| 通过指定宿主控制台把错误输出为 JSON      | `color(json) → runtimeManager.console → flush`  | [完整示例](./USEGUIDE.md#通过指定宿主控制台把错误输出为-json)      |

## 安装

```bash
pnpm add @migaia/logger
```

## 常用 API

| API                   | 用途                             |
| --------------------- | -------------------------------- |
| `new Logger(options)` | 创建核心，明确执行预算与宿主能力 |
| `log / dispatchRaw`   | 写普通参数或命名结构化字段       |
| `useSink / onFailure` | 接入输出端并观察失败             |
| `level(config?)`      | 添加级别方法、门槛和过滤器       |
| `color(config?)`      | 添加 pretty/JSON 控制台输出      |
| `flush / shutdown`    | 等待已追踪输出或终结日志器       |

## 契约细节

### 职责、入口与发布条件

核心负责构造日志条目、执行处理管线、交给输出端以及等待收尾，不内置级别或控制台输出；这些能力由插件选择组合。本包依赖 event-subscriber、lifecycle、middleware-pipeline、plugin-host、utils 和 ansis；插件安装与资源归属复用 Plugin Host，Logger 不继承 PluginHost。

| 入口                          | 内容与宿主边界                                                              |
| ----------------------------- | --------------------------------------------------------------------------- |
| `@migaia/logger`              | Logger、运行时能力管理、状态/错误常量与应用/插件类型                        |
| `@migaia/logger/plugins`      | level、color、batch、http、process、reasoning、uuid 及公开配置/Feature 类型 |
| `@migaia/logger/plugins/file` | file 及配置类型，独立条件导出；不从 plugins 聚合入口导入                    |

file 在 node、bun、deno 条件使用可注入 fs 或延迟加载的 node:fs/promises；browser 和 default 条件不引入 Node 文件模块，必须注入 fs。ESM 发布声明 sideEffects: false，实际产物裁剪由构建器决定，不承诺某项能力完全不进入所有构建产物。包的 Node 引擎要求为 >=18；浏览器、Worker 或其它宿主是否支持所选插件，取决于提供的能力。

### Logger 构造与上下文

new Logger(options) 的 options 和 execution 必填：

| 字段                             | 默认与含义                                                           |
| -------------------------------- | -------------------------------------------------------------------- |
| execution.mutationTimeoutMs      | 必填，无默认；Plugin Host 变更操作预算，number 或 false              |
| execution.pipelineDrainTimeoutMs | 必填，无默认；Plugin Host 管线排空预算，number 或 false              |
| runtimeManager                   | 省略时捕获当前模块默认能力对象                                       |
| scheduler                        | systemScheduler，所有日志期限和批次任务使用它的时间域                |
| context                          | []，未显式传入 entry.context 时采用的路径                            |
| topic                            | ''，转发时用于展示的节点名，不是循环检测身份                         |
| options                          | {}，向插件公开的业务选项                                             |
| on                               | {}，构造期登记命名 hook                                              |
| pipeline.mode                    | 'sync'；还可选 'async'、'generator'、'async-generator'，构造后不可改 |
| plugins                          | []；构造期同步安装，跨插件 Feature 依赖决定安装顺序                  |

pipeline 对象只有 mode 字段。execution 两个预算均接受非负有限数或 false（包括 0 与小数），false 表示不设期限；它们不改变公开 flush() 的内部 3000 毫秒预算。同步构造不接纳返回 Promise/thenable 的 install；失败触发已接纳资源回滚，不能取得半安装 Logger。需要异步安装时，构造完成后 await log.use(plugin)。

ctx 包含稳定 id、options、path、topic、createdAt 和 env；env 包含 isTTY、isCI。ctx、path、顶层 options 与 env 冻结，嵌套 options 值及 createdAt Date 保留引用且可变，不能把它们当作深快照。

### 日志、输出与观察 API

| API                                            | 参数、默认值与结果                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| log(tag, message, ...args)                     | tag/message 必填，args 可为空；返回 void，最后的对象参数不会自动当作 meta                   |
| dispatchRaw(input, options?)                   | input.tag/message 必填，其余字段可选；options.asyncOutput 默认 false；返回 void             |
| raw(text, options?)                            | text 必填，asyncOutput 默认 false；绕开管线、hook 和 sink，直接写宿主输出                   |
| useSink(fn)                                    | 必填回调，返回仅撤销本次登记的 off                                                          |
| hook(name, fn) / fireHook(name, entry)         | 参数必填；hook 返回本次登记的 off，fireHook 返回 void                                       |
| onFailure(fn)                                  | 必填回调，返回 off；观察内部输出失败，不替换默认宿主诊断                                    |
| defer(task)                                    | 必填任务，安排执行并纳入 flush 跟踪；同步返回 void                                          |
| onFlush(fn) / onShutdown(fn)                   | 必填回调，返回 off                                                                          |
| flush()                                        | 无参数，返回 `Promise<void>`；并发调用共用当前轮 Promise                                    |
| shutdown(reason) / dispose()                   | reason 必填；dispose 等价 shutdown('manual')，返回稳定 `Promise<IPluginHostDisposalResult>` |
| extends(...others) / unextend(...others)       | 接入目标完整输出路径 / 移除边；前者返回 this，后者至少移除一条为 true                       |
| use(...plugins) / unUse(name)                  | use 返回输入顺序的 handle tuple；unUse 名称必填、返回 `Promise<void>`                       |
| config.get(path) / config.update(name, recipe) | 读取插件配置路径 / 浅合并 recipe 返回的 patch 并提交新快照                                  |

shutdown reason 四个取值是 'signal'、'uncaughtException'、'unhandledRejection'、'manual'。onShutdown 回调收到本轮 reason。构造静态插件的扩展出现在实例类型上；动态 use 后通过 handle.extensions 调用，原变量类型不扩张。缺失插件的 unUse 拒绝为 Plugin Host 的 PLUGIN_NOT_INSTALLED；必需 Feature 消费者可以阻止移除提供方。

输出路径中的 sink、hook、pipeline 失败通常通过 onFailure 观察，业务 log/dispatchRaw 不因这些失败直接抛出；这不保证所有输入读取、构造、配置、拓扑操作或 raw 都不会抛错。尤其同步 raw 的 write 失败可以直接抛出。onFailure 中的失败不递归回到自身，改由宿主 reporter 诊断；正常 failure 也继续交给 runtime console.error/write，订阅不是替换默认报告。

### Entry 与浅层隔离

ILogEntry 包含 id、tag、time、message、args、meta、context、error、data。id 由核心生成；time 是当前 realm 的 Date，缺省时创建；args 默认空数组，context 默认 logger.ctx.path（构造 context 默认 []），data 默认空对象，meta/error 可省略。tag 是普通标签，级别语义属于 level 插件。

传入 Error 参数会生成 name/message/stack 投影，error.raw 保留原 Error 引用。HTTP 和 color JSON 输出使用 utils 的有界错误链投影，保留 source/code/name/message/stack/cause/errors，不发送 raw；未带语义身份的业务错误使用 unknown/UNKNOWN 诊断占位，不冒充 Logger 抛错码。本地 console 或 custom sink 可继续检查原 Error。

默认阶段顺序为 before → `before:<tag>` → pipeline → 各 sink → after → `after:<tag>` → 转发。hook 的 entry 是活引用。每个 sink 收到独立顶层容器，args、meta、context、data 各复制一层，time 复制成 Date；嵌套业务值仍共享引用，不保证深层隔离。after hook 的修改不影响已交给 sink 的副本，但会影响随后转发的条目。

pipeline 替换值必须保留当前 realm Date 类型的 time；字符串时间或外 realm Date 会报告 PIPELINE_ENTRY_INVALID，source 为 pipeline，并继续交付原 entry。默认不会因此从 dispatch 抛出。同一个 hook 函数多次登记时，off 只移除本次登记。

### Pipeline 模式与配置

| mode              | 方法与顺序                                                                    |
| ----------------- | ----------------------------------------------------------------------------- |
| 'sync'            | usePipeline；next 先记录值，当前 stage 返回后才执行下游                       |
| 'async'           | useAsyncPipeline；await next(entry) 等待下游，可在之后执行收尾                |
| 'generator'       | useGeneratorPipeline；每个 stage 耗尽后取终值                                 |
| 'async-generator' | useAsyncGeneratorPipeline；依次 await 耗尽各 stage，中间 yield 不提前交给下游 |

同步 stage 可提升到全部 mode，generator stage 还可提升到 async-generator；其他异步/生成器 stage 要求相应模式，不兼容时类型为 never，运行时也拒绝 PIPELINE_MODE_MISMATCH。执行中禁止新增 stage。重复 next 产生 PIPELINE_NEXT_DUPLICATE，延迟 next 产生 PIPELINE_NEXT_LATE 诊断；不调用 next 即截断条目。模式语义与适配由 middleware-pipeline / Plugin Host 拥有，本包不另造执行器。

应用 config.get 支持 'plugin'、'plugin.key'、'plugin.[index].key'；对象和数组配置递归冻结。config.update(name, recipe) 的 patch 是浅合并，不直接修改旧快照。插件 install(core) 中的 core.config 只有无参 get()，只读取当前插件自身配置，不能通过该门面轮询、更新或读取其他插件。

每次安装重新调用插件工厂，不将同一个有状态插件实例跨 Logger 复用。插件安装期可用 core.onDispose(resource) 登记资源，应用变量没有这一安装能力；卸载会撤销该插件登记的 stage、sink、hook、flush/shutdown 回调与扩展。公开调用方使用 ILoggerCore/ILoggerPluginCore，ILoggerDomainCore 仅用于内部装配；类型推导辅助由发布声明和编辑器提示承载。

### Flush、关闭与送达边界

flush() 等待已观察到的 defer、sink/hook thenable、onFlush、batch 和 extends 下游。它使用 scheduler 的绝对 3000 毫秒预算逐轮排空，不会无限等待一个不合作的 Promise；到期通过 onFailure 报 LIFECYCLE_DEADLINE，尚未完成的工作可由以后 flush 继续观察。跨 realm Promise 或普通 thenable 也会被跟踪，不要求 instanceof Promise。

shutdown 开始时同步进入关闭状态并先发布稳定 Promise。onShutdown 仍可 log/dispatchRaw 写最后条目，但 raw 从关闭开始即不再输出；然后 flush，最后卸载插件并终结。handler 与 flush 共享 3000 毫秒排空预算，后续 Host disposal 使用 execution 的预算，不能把整个 shutdown 说成最多 3 秒。

并发、同步重入、已完成或失败后的 shutdown/dispose 都复用同一完成 Promise，不再重新执行 cleanup。终态 log/dispatchRaw/raw 静默忽略，onFailure 不会专门报告这些被忽略的调用。关闭失败也不能恢复，需新建 Logger。结果 cleanupErrors/cleanupComplete 描述物理清理，不是日志送达回执；下游拒绝或超时仍需宿主补偿。读取时钟失败进入稳定 Promise 的 INVALID_OPTION/cause，仍尝试 Host cleanup，清理次错不覆盖主因。

### level 与 color

level(config?) 默认 {}，提供 debug/info/warn/error/fatal、setLevel、addFilter、removeFilter。

| level 字段  | 默认 / 取值                                             |
| ----------- | ------------------------------------------------------- |
| level       | 'debug'；可取 'debug'、'info'、'warn'、'error'、'fatal' |
| filters     | []；所有过滤器均返回 true 才放行                        |
| asyncOutput | false；插件产生的日志是否经 defer                       |

未知 tag 不按五级阈值过滤，但仍运行 filters。改变级别用 setLevel，addFilter 返回幂等 off，removeFilter 按函数身份移除匹配项。内置 level 在安装时捕获 minLevel 与 filters；config.update 只提交配置快照并调用可选 plugin.update，不会自动更新没有 update hook 的 level 运行状态。

color(config?) 默认 {}，提供 console sink 和 Feature 能力 paint(tag, text)、dim(text)；color 插件的稳定名称是 ansis。

| color 字段   | 默认 / 取值                                               |
| ------------ | --------------------------------------------------------- |
| color        | 'auto'；还可取 'always'、'never'                          |
| format       | 'auto'；还可取 'pretty'、'json'                           |
| timestamp    | true；pretty 中显示 ISO 时间                              |
| colorMessage | 'none'；可取 'head'、'tail'、'head-tail'、'all'、'none'   |
| colorMap     | undefined；无覆盖时用内置 level 映射，按 tag 指定染色函数 |

data.silent === true 只让 color 跳过打印，其他 sink 仍接收。color: 'auto' 依次检查 NO_COLOR（有值则关闭）、FORCE_COLOR（有值且非 '0' 则开启）、TTY、CI，再默认关闭；format: 'auto' 先接受 LOG_FORMAT 的 json/pretty，再在 CI 或 TTY 下选 pretty，其余选 json。colorMessage: 'tail' 且没有 args 时会染 message。这些环境读取来自捕获的 Runtime，不改变核心 tag 语义。

### batch 与 HTTP

batch(config?) 默认 {}，不添加实例方法，通过 Feature 提供 createBatcher(config, onBatch)，处理项不必是日志 entry。

| batch 字段           | 默认 / 边界                                             |
| -------------------- | ------------------------------------------------------- |
| maxSize              | 20；收集到阈值触发批次                                  |
| maxWaitMs            | 2000；首项进入后的等待                                  |
| maxConcurrentBatches | 1；正安全整数                                           |
| maxPendingBatches    | 1024；排队加在途的总上限，正安全整数                    |
| flushTimeoutMs       | 3000；每次 batcher flush / dispose drain 的有限非负预算 |
| asyncOutput          | true；满批回调是否 defer，定时触发本已异步              |

batcher.push(item) 收集，flush() 发送剩余并等待在途 callback；自动登记到 Logger flush。满载报告 BATCH_OVERFLOW，并丢最老排队批次；容量全被在途占用时丢新批次，detail.dropped 是条目数。它有界而非绝不丢失。卸载先关闭接纳、尝试排空，未交付项会报告，不能把 cleanupComplete 当作送达。

http(config) 的 url 必填，用 POST { entries } 发送；其余字段如下：

| HTTP 字段        | 默认 / 边界                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| authToken        | undefined，提供时加 Bearer Authorization                                                                               |
| headers          | {}                                                                                                                     |
| retries          | 2；有限非负整数，表示额外尝试次数                                                                                      |
| requestTimeoutMs | 10000；单次请求尝试取消的预算                                                                                          |
| maxRetryAfterMs  | 30000；有效 Retry-After 超出时截到此上限                                                                               |
| batch            | undefined；可含 maxSize/maxWaitMs/maxConcurrentBatches/maxPendingBatches/asyncOutput，未覆盖字段取 batch provider 默认 |

网络失败、429 和 5xx 可重试，其他 4xx 直接失败。429 优先接受有效 Retry-After，缺失或无效则指数退避。预算到期时尝试 abort 当前请求；取消器可由 runtimeManager.createAbortController 提供，否则尝试原生 AbortController，无可用控制器时不安排该请求计时，不保证忽略 signal 的 fetch 会终止或结算。没有 fetch 时，发送经 failure 路径报告 TRANSPORT_UNAVAILABLE。序列化失败为 SERIALIZE_FAILED，失败响应或重试耗尽为 DELIVERY_FAILED。

batch 与 http 同批安装会按 Feature 依赖排序，[http(...), batch()] 同样生效；provider 也可预先安装，跨 use 调用晚装不会追溯重绑。没有 provider 但显式提供 http.batch 时使用本地有界队列，强制 maxSize: 1、asyncOutput: false，其他并发和容量配置仍适用；没有 provider 且未配 batch 时直接逐条发送。关闭先尝试排空最终日志，在 HTTP 插件释放时取消剩余传输。

### file、process、reasoning 与 uuid

file(config) 只从独立子入口导入。path 必填，batch 可选并复用 IBatchPluginConfig 全部字段；rotate 可含 maxEntries/maxBytes，均无默认阈值。每批编码为逐行 JSON，达到当前批次条目数或文本字节阈值时调用可选 fs.rotate(path)，不是按磁盘文件累计尺寸旋转。Node 默认 fs 只有 append，不提供 rotate；没有 batch provider 时也使用私有 batcher。浏览器/default 缺 fs.append 时安装失败，FILE_SINK_UNAVAILABLE 可在 Host 安装错误 cause 中找到。写入失败经 onFailure。

process(config?) 默认 {}；captureCrashes 默认 true，shutdownTimeoutMs 默认 3000，interceptProcessExit 默认 false。缺 Runtime process 时 no-op；存在时适配信号、崩溃与退出，interceptProcessExit 会改变原本同步退出的语义。多个参与者共用一组 listener，必须同 process 身份、配置和 scheduler 时间域，否则 PLUGIN_CONFIG_CONFLICT；最后一个卸载后撤销 listener 并重置共享状态。迟到诊断使用首位安装者捕获的 manager，不保证进程崩溃时所有日志送达。

reasoning(config?) 提供 startThinking/thinking/endThinking/startResponse/response/endResponse；labels.thinking 默认 'Thinking...'，labels.response 默认 undefined，asyncOutput 默认 false。token 经 raw 输出，阶段结束再产生 data.silent = true 的完整 entry，供 HTTP/审计收集。可选 color Feature 负责 paint/dim，无提供方则纯文本；同批依赖按拓扑接入。

uuid(config?) 提供每条 entry 的 data.uuid、data.uuidDisplay，display 默认 false。UUID 使用 Logger 捕获的 Runtime；display 控制 color pretty/JSON 的显示，不是日志身份 ctx.id 的替代品。

### 转发图与 Runtime 能力

extends(...others) 让条目完整经过目标的 pipeline 和 sink，目标自己的 level/filter 仍生效。每跳把 topic 加入展示链，把稳定 ctx.id 加入内部循环路径，二者分开；topic 可以为空或重名。注册静态拒绝 EXTENDS_SELF/EXTENDS_CYCLE，运行时跳过已走过的 id。sink 私有 data 快照可读展示 topicChain，循环检测 symbol 不外泄。

unextend 按目标 ctx.id 移除，不关闭目标；重复移除为 false。flush 沿图等待下游；转发不合并目标插件扩展的 TypeScript 类型。

| Runtime 能力                           | 必填 / 默认行为                                       |
| -------------------------------------- | ----------------------------------------------------- |
| randomUUID()、defer(task)、write(text) | 注入 manager 时必需                                   |
| process                                | 可选；默认宿主 process，缺失则不注册退出监听          |
| console                                | 可选 log/warn/error，缺失时可退回 write               |
| fetch                                  | 可选；默认宿主 fetch                                  |
| fs                                     | 默认无；含异步 append(path, text) 与可选 rotate(path) |
| createAbortController                  | 可选；缺省用原生控制器（若可用）                      |

new Logger 捕获 runtimeManager 对象本身，插件也使用同一个引用；之后切换模块默认不重定向旧实例，也不是对 manager 对象深拷贝。getLoggerRuntimeManager() 返回当前同一对象，勿就地修改。setLoggerRuntimeManager(manager) 仅为未来 Logger 选择默认并返回幂等 restore，支持嵌套层恢复；需要确定归属时直接通过构造选项注入。默认 UUID 优先 crypto.randomUUID，否则构造本地标识；defer 优先 setImmediate，再 setTimeout(0)，再 queueMicrotask；write 优先 process.stdout，否则 console.log。

LoggerLevel、LoggerColorMode、LoggerReasoningPhase、LoggerStatus 与 LOGGER_SOURCE 是稳定公开常量。颜色/级别类型从根入口导入 ILoggerColorMode/ILoggerLevel；plugins 不再导出旧 IColorMode/ILogLevel。

### 错误身份与排查

Logger 自有错误 source 为 @migaia/logger；来自 Plugin Host、middleware 或其它 owner 的完整身份保持原属。LoggerErrorCode 有 17 项：

| code                            | 场景                                                    |
| ------------------------------- | ------------------------------------------------------- |
| INVALID_OPTION                  | 配置不可读或结构非法；getter 原因保留在 cause           |
| PIPELINE_ENTRY_INVALID          | 替换 entry.time 不是当前 realm Date，报告并交付原 entry |
| RUNTIME_SHUTTING_DOWN           | 共享进程退出已开始时仍安装 process                      |
| PLUGIN_CONFIG_CONFLICT          | process 身份、配置或时间域不兼容                        |
| TRANSPORT_UNAVAILABLE           | 缺 HTTP fetch                                           |
| SERIALIZE_FAILED                | HTTP payload 序列化失败                                 |
| DELIVERY_FAILED                 | 非成功响应或可重试传输耗尽                              |
| INVALID_RETRY_COUNT             | retries 不是有限非负整数                                |
| LIFECYCLE_DEADLINE              | flush / shutdown drain 到期仍有工作                     |
| PROCESS_INSTALL_ROLLBACK_FAILED | 安装主错之外还有 listener 回滚错误                      |
| PLUGIN_UNINSTALL_CLEANUP_FAILED | 插件最终清理失败；可能含未交付 dropped 细节             |
| PLUGIN_SHUTDOWN_CLEANUP_FAILED  | deadline task 或退出清理失败                            |
| HOOK_FAILED                     | failure hook 自身失败，仅走宿主诊断                     |
| EXTENDS_SELF                    | 转发目标含自身                                          |
| EXTENDS_CYCLE                   | 新边成环                                                |
| BATCH_OVERFLOW                  | 有界队列满载并丢批，检查 detail.dropped                 |
| FILE_SINK_UNAVAILABLE           | 缺注入 fs 且无当前条件默认能力                          |

failure.source 另一个维度为 defer/hook/sink/pipeline/flush/forward/shutdown，表示失败发生在哪一阶段，不是 semantic source。runtime reporter 自身 throw/rejection 经既有宿主异常队列保持可观察，不递归 Logger reporter，也不替换业务结果。

没有输出先看是否安装 sink，再看 level/filter 与 data.silent；批次逐条发送先确认 batch provider 在同批或已提前安装；关闭后不能复用 Logger；动态插件方法在 handle.extensions。需要确定完成时等待 flush/shutdown，但不要把它当作远端持久化回执。生产组合可选择 level、uuid、batch、http、color、process，配置真实 endpoint，并在宿主关闭边界保留 failure 观察直到 shutdown 完成，而不是为了演示发出网络请求。

```bash
pnpm --filter @migaia/logger run fmt
pnpm --filter @migaia/logger run lint
pnpm --filter @migaia/logger run typecheck
pnpm --filter @migaia/logger run typecheck:test
pnpm --filter @migaia/logger run test
```

test 会先构建本包；typecheck:browser 与 test:e2e 是另外的现有入口。这里只列命令，不声称它们已经执行。

## Durable log storage

`memoryLogStore` from `@migaia/logger/plugins/durable` is an atomic, process-local log resource. `fileLogStore` from `@migaia/logger/plugins/durable/file` uses builtin SQLite: `node:sqlite` in Node and Deno, `bun:sqlite` in Bun. The file implementation supports local files on macOS, Linux, and Windows; network filesystems do not receive a locking or durability guarantee. A retained SQLite connection owns the exclusive writer lock until disposal. No storage package or third-party native driver is required.

```ts
import { memoryLogStore, LogRecordState } from '@migaia/logger/plugins/durable'

await using store = memoryLogStore()
const [seq] = await store.append([{ kind: 'order.created', payload: { id: 'o1' } }])
await store.setState(seq, LogRecordState.done)
console.log(await store.read(1, 100))
```

Records accept plain JSON data, capture inputs immediately, and return independent snapshots. A batch creates all records and their pending states atomically. Sequence numbers start at one and remain monotonic after prefix truncation. `onAppend` reports one frozen `{ lastSeq, count }` notice after each nonempty append commit. It never publishes state changes or truncation.

Explicit `dispose()` returns a cached Promise that rejects on cleanup failure. The async disposal symbol returns a separate cached Promise that reports failure and resolves. Both share one physical cleanup. The creator owns disposal; installed plugins only borrow the original resource.
