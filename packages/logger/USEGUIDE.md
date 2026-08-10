# @migai/logger 使用指南

## 1. 导入与运行时

```ts
import { Logger, setLoggerRuntimeManager } from '@migai/logger';
import { batch, color, http, level, process, reasoning, uuid } from '@migai/logger/plugins';
```

Logger 可用于 Node、Bun、Deno、浏览器、Worker、小程序和 Electron。核心只经 runtime manager 使用 `process`、调度、stdout 与 HTTP transport；浏览器没有 `process` 时，`raw()` 回退到 `console.log`，`process()` 插件不注册监听器。

## 2. Logger 构造

```ts
const log = new Logger({
  context: ['app', 'api'],
  topic: 'gateway',
  options: { service: 'gateway' },
  on: { before: (entry) => {} },
  pipeline: { mode: 'sync' },
  plugins: [level(), color()]
});
```

| 构造选项 / 类型                                          | 必填性 | 默认值             | 作用                               |
| -------------------------------------------------------- | ------ | ------------------ | ---------------------------------- |
| `context?: string[]`                                     | 可选   | `[]`               | 每条 entry 默认 context 路径。     |
| `topic?: string`                                         | 可选   | `''`               | `extends()` 转发时的展示链路节点。 |
| `options?: Record<string, unknown>`                      | 可选   | `{}`               | 冻结后公开给插件的业务只读配置。   |
| `on?: Record<string, ILogHookFn>`                        | 可选   | `{}`               | 构造时注册 hook 的简写。           |
| `pipeline?: { mode?: 'sync' \| 'async' \| 'generator' }` | 可选   | `{ mode: 'sync' }` | 管线模式；`mode` 自身可选。        |
| `plugins?: readonly ILoggerPlugin[]`                     | 可选   | `[]`               | 按数组顺序安装的插件。             |

同步插件在构造函数返回前可使用；构造期 `install()` 返回 Promise/thenable 会立即抛出。异步插件请通过 `await log.use(plugin)` 动态安装并处理失败。

## 3. Logger API list

| API / 签名                                                  | 参数                                                                                                     | 必填性                                                       | 返回值                             | 作用                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| `log(tag, message, ...args)`                                | `tag: string`；`message: string`；`args: unknown[]`                                                      | `tag`、`message` 必填；`args` 可省略                         | `void`                             | console-style 入口；最后一个对象仍只是参数，不自动成为 meta。  |
| `dispatchRaw(input, options?)`                              | `input: { tag, message, args?, meta?, data?, context?, error?, time? }`；`options.asyncOutput?: boolean` | `input.tag`、`input.message` 必填；其余字段和 `options` 可选 | `void`                             | 显式创建结构化 entry；`asyncOutput` 经 `defer` 调度。          |
| `raw(text, options?)`                                       | `text: string`；`options.asyncOutput?: boolean`                                                          | `text` 必填；`options` 可选                                  | `void`                             | 原样写入 runtime stdout/console，不经过 pipeline 和 sink。     |
| `ctx`                                                       | 无                                                                                                       | 无参数                                                       | `ILoggerContext`                   | 冻结的 id、业务 options、path、topic、创建时间和环境。         |
| `pipelineMode`                                              | 无                                                                                                       | 无参数                                                       | `'sync' \| 'async' \| 'generator'` | 当前 logger 的固定 pipeline mode。                             |
| `flush()`                                                   | 无                                                                                                       | 无参数                                                       | `Promise<void>`                    | drain 当前 logger、batch 与 extends 图；并发调用共用 Promise。 |
| `shutdown(reason)`                                          | `reason: 'signal' \| 'uncaughtException' \| 'unhandledRejection' \| 'manual'`                            | `reason` 必填                                                | `Promise<void>`                    | 运行 shutdown handler、flush、dispose；首个 reason 生效。      |
| `dispose()`                                                 | 无                                                                                                       | 无参数                                                       | `Promise<void>`                    | `shutdown('manual')` 的别名。                                  |
| `extends(...others)`                                        | `others: ILoggerCore[]`                                                                                  | 至少 1 个目标，必填                                          | `this`                             | 转发到目标 logger 的完整 pipeline/sink；环会拒绝。             |
| `use(...plugins)`                                           | `plugins: ILoggerPlugin[]`                                                                               | 至少 1 个插件，必填                                          | `Promise<logger & Extensions>`     | 动态安装插件。                                                 |
| `unUse(name)`                                               | `name: string`                                                                                           | `name` 必填                                                  | `Promise<void>`                    | 卸载按 name 定位的插件。                                       |
| `config.update(name, recipe)`                               | `name: string`；`recipe(previous) => Partial<config>`                                                    | 两项都必填                                                   | `Promise<void>`                    | 更新插件配置；浅合并且 update 成功后提交。                     |
| `config.get(name?)`                                         | 可选插件名；省略时读取全部配置                                                                           | 无                                                           | `Readonly<config>                  | undefined`，或 `Readonly<Record<string, config>>`              | 返回深拷贝快照。省略 name 时返回无原型对象（`Object.create(null)`）；请用 `Object.keys` / `in` 访问，不要调用 `hasOwnProperty` 或依赖 `toString`。 |
| `getShared(key)`                                            | `key: string`                                                                                            | `key` 必填                                                   | `T \| undefined`                   | 获取已安装插件提供的 shared 能力。                             |
| `hook(name, fn)`                                            | `name: string`；`fn: (entry) => void \| Promise<void>`                                                   | 两项都必填                                                   | `() => void`                       | 注册 hook；返回 off 函数。                                     |
| `fireHook(name, entry)`                                     | `name: string`；`entry: ILogEntry`                                                                       | 两项都必填                                                   | `void`                             | 立即运行该名称的 hook。                                        |
| `onFailure(fn)`                                             | `fn: (failure: ILogFailure) => void`                                                                     | `fn` 必填                                                    | `() => void`                       | 观察失败；返回 off 函数。                                      |
| `defer(task)`                                               | `task: () => void \| Promise<void>`                                                                      | `task` 必填                                                  | `void`                             | 延后任务并纳入 flush。                                         |
| `onFlush(fn)`                                               | `fn: () => void \| Promise<void>`                                                                        | `fn` 必填                                                    | `() => void`                       | 注册每轮 flush 的 handler。                                    |
| `onShutdown(fn)`                                            | `fn: (reason) => void \| Promise<void>`                                                                  | `fn` 必填                                                    | `() => void`                       | 注册 shutdown handler。                                        |
| `useSink(fn)`                                               | `fn: (entry) => void \| Promise<void>`                                                                   | `fn` 必填                                                    | `() => void`                       | 注册输出 sink。                                                |
| `usePipeline` / `useAsyncPipeline` / `useGeneratorPipeline` | 与 `pipelineMode` 匹配的 stage                                                                           | `stage` 必填                                                 | `this`                             | 注册 transform stage。                                         |
| `onDispose(resource)`                                       | disposer function 或 disposable object                                                                   | `resource` 必填                                              | `void`                             | 仅插件 `install()` 期间登记资源；应用代码不应调用。            |

`shutdown` 完成后，`log`、`dispatchRaw` 和 `raw` 都不再输出。日志管线内失败默认不会从业务 `log()` 调用抛出；用 `onFailure` 连接监控或错误报告。

## 4. Entry、hook 与 sink

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

`ILogEntry` 字段：`id`、`tag`、`time`、`message`、`args`、`meta`、`context`、`error`、`data`。`Error` 参数会生成可序列化的 `error` 投影，并保留 `error.raw` 原始引用。

hook 名称：`before`、`after`、`before:<tag>`、`after:<tag>`，以及任意自定义字符串。pipeline 中 entry 可通过构造新对象转换；进入每个 sink 前，核心会复制 `args`、`meta`、`context`、`data` 和 `time` 的顶层容器。嵌套业务对象保持引用，sink 不应修改它们。

## 5. 插件 guide

### `level(config?)`

添加 `debug`、`info`、`warn`、`error`、`fatal`、`setLevel(level)`、`addFilter(filter)`、`removeFilter(filter)`。

| 配置字段 / 类型                                             | 必填性 | 默认值    | 说明                                         |
| ----------------------------------------------------------- | ------ | --------- | -------------------------------------------- |
| `level?: 'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal'` | 可选   | `'debug'` | 最低输出等级。                               |
| `filters?: ILogFilter[]`                                    | 可选   | `[]`      | 所有 `(entry) => boolean` 返回 true 才放行。 |
| `asyncOutput?: boolean`                                     | 可选   | `false`   | 是否用 `defer` 输出该插件产生的日志。        |

### `color(config?)`

控制台 sink，提供 shared：`paint(tag, text)`、`dim(text)`。

| 配置字段 / 类型                                                     | 必填性 | 默认值          | 说明                           |
| ------------------------------------------------------------------- | ------ | --------------- | ------------------------------ |
| `color?: 'auto' \| 'always' \| 'never'`                             | 可选   | `'auto'`        | ANSI 颜色策略。                |
| `format?: 'auto' \| 'pretty' \| 'json'`                             | 可选   | `'auto'`        | 输出格式；auto 根据环境决定。  |
| `timestamp?: boolean`                                               | 可选   | `true`          | pretty 输出是否包含 ISO 时间。 |
| `colorMessage?: 'head' \| 'tail' \| 'head-tail' \| 'all' \| 'none'` | 可选   | `'none'`        | message/args 的染色范围。      |
| `colorMap?: Record<string, (text: string) => string>`               | 可选   | 内置 level 映射 | 自定义 tag 的染色函数。        |

`color` 会识别 `entry.data.silent`，不打印该 entry；HTTP 等其他 sink 仍会接收它。

### `batch(config?)`

不添加 logger 方法，提供 shared `createBatcher(config, onBatch)`。

| 配置字段 / 类型         | 必填性 | 默认值 | 说明                              |
| ----------------------- | ------ | ------ | --------------------------------- |
| `maxSize?: number`      | 可选   | `20`   | 达到该数量即发送一个 batch。      |
| `maxWaitMs?: number`    | 可选   | `2000` | 第一项进入后最长等待时间。        |
| `asyncOutput?: boolean` | 可选   | `true` | 满批次回调是否通过 `defer` 调度。 |

batcher 的 `push(item)` 收集项目，`flush()` 发送剩余项目并等待 in-flight 回调。它会自动登记到 Logger `flush()`。

### `http(config)`

把 entry 以 `POST { entries }` 发送到 endpoint。

| 配置字段 / 类型                                                           | 必填性 | 默认值  | 说明                                                                |
| ------------------------------------------------------------------------- | ------ | ------- | ------------------------------------------------------------------- |
| `url: string`                                                             | 必填   | 无      | HTTP endpoint。                                                     |
| `authToken?: string`                                                      | 可选   | 无      | 写入 `Authorization: Bearer ...`。                                  |
| `headers?: Record<string, string>`                                        | 可选   | `{}`    | 附加 request headers。                                              |
| `retries?: number`                                                        | 可选   | `2`     | 网络错误、429、5xx 的额外重试次数。                                 |
| `requestTimeoutMs?: number`                                               | 可选   | `10000` | 单次 HTTP 请求最长等待时间；超时会 abort 当前请求并按网络错误处理。 |
| `batch?: { maxSize?: number; maxWaitMs?: number; asyncOutput?: boolean }` | 可选   | 无      | 传给 batch shared factory 的覆盖配置。                              |

4xx（429 除外）直接失败；429 的 `Retry-After` 秒数优先于指数退避。shutdown 会 abort 未完成 HTTP 请求，失败可由 `onFailure` 观察。若要批量发送，顺序必须是 `plugins: [batch(), http(...)]`。

### `process(config?)`

Node/Bun 风格进程适配器；没有 runtime `process` 时无操作。

插件对象不可复用到多个 Logger。每次安装请分别调用 `http()`、`reasoning()`、`color()` 工厂，避免实例状态在 Logger 之间串联。

| 配置字段 / 类型                  | 必填性 | 默认值  | 说明                                                           |
| -------------------------------- | ------ | ------- | -------------------------------------------------------------- |
| `captureCrashes?: boolean`       | 可选   | `true`  | 捕获 `uncaughtException` / `unhandledRejection` 并记录 fatal。 |
| `shutdownTimeoutMs?: number`     | 可选   | `3000`  | signal/crash/exit 的最长 drain 时间（毫秒）。                  |
| `interceptProcessExit?: boolean` | 可选   | `false` | 在 `process.exit()` 前发起 flush；会改变 exit 的同步语义。     |

同一 runtime 的监听器只注册一次。最后一个安装该插件的 logger 卸载后，监听器和 shutdown 状态都会清理，因此可安全重装。

### `reasoning(config?)`

添加 `startThinking`、`thinking`、`endThinking`、`startResponse`、`response`、`endResponse`。逐 token 内容经 `raw()` 输出；结束时会生成一条 `data.silent = true` 的完整 entry，便于 HTTP/审计 sink 收集。

| 配置字段 / 类型                                     | 必填性 | 默认值          | 说明                                |
| --------------------------------------------------- | ------ | --------------- | ----------------------------------- |
| `labels?: { thinking?: string; response?: string }` | 可选   | 无              | 可选标签对象。                      |
| `labels.thinking?: string`                          | 可选   | `'Thinking...'` | thinking 开始标签。                 |
| `labels.response?: string`                          | 可选   | 无              | response 开始标签。                 |
| `asyncOutput?: boolean`                             | 可选   | `false`         | 流式输出与完整 entry 是否异步调度。 |

安装在 `color()` 之后可复用其 `paint` / `dim` shared；未安装 color 时自动退化为纯文本。

### `uuid(config?)`

为每条经过 pipeline 的 entry 写入 `data.uuid` 和 `data.uuidDisplay`。

| 配置字段 / 类型     | 必填性 | 默认值  | 说明                                     |
| ------------------- | ------ | ------- | ---------------------------------------- |
| `display?: boolean` | 可选   | `false` | 是否让 color pretty/JSON 输出展示 UUID。 |

## 6. 组合范式

```ts
const log = new Logger({
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

`extends()` 只组合运行时输出路径，不把目标 logger 的 TypeScript 扩展方法合并到当前变量。extends 图禁止成环；`flush()` 会沿图等待下游。

## 7. 自定义 runtime manager

测试、浏览器容器或自定义宿主可替换能力，再用返回的函数恢复。

```ts
const restore = setLoggerRuntimeManager({
  randomUUID: () => crypto.randomUUID(),
  defer: (task) => queueMicrotask(task),
  write: (text) => console.log(text),
  fetch: (url, init) => fetch(url, init)
});

try {
  // create and use Logger
} finally {
  restore();
}
```
