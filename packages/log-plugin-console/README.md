# @migaia/log-plugin-console

[English](./README.en.md)

`@migaia/log-host` 的控制台输出。在终端或 CI 里输出带颜色、保留原生对象和错误堆栈的可读格式；输出被重定向、交给日志采集时默认一行一条 JSON，不用为两种环境各写一套配置。

## 你可能遇到过

- **线上日志没法检索**：开发时好读的彩色文本进了日志系统，变成一堆转义字符和拆散的多行堆栈。根因是输出格式没有随运行环境切换。
- **对象被打成 `[object Object]`**：日志库先把参数拼成字符串再交给控制台，丢掉了控制台本来能展开的对象和错误堆栈。根因是格式化发生在控制台之前。

## 从这里开始

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    // 示例里固定不着色、不打时间，便于对照输出；默认按终端和环境自动决定
    consolePlugin({ features: { pretty: prettyFeature({ color: 'never', timestamp: false }) } })
  ]
})
log.info('user %s signed in', 'alice')
log.warn('disk usage at %d%%', 91)
await log.shutdown('manual')
```

输出：

```text
[INFO] user alice signed in
[WARN] disk usage at 91%
```

`%s`、`%d` 这些占位符由控制台自己处理，参数原样交给 `console.log` / `console.warn` / `console.error`，所以对象可以展开、错误带完整堆栈。`warn` 走 `console.warn`，`error` 和 `fatal` 走 `console.error`，其他级别走 `console.log`。

不写 `features` 时格式自动选择：先看环境变量 `LOG_FORMAT=json|pretty`；没有设置时，在 CI 中或输出是终端则用可读格式，否则输出 JSON。要固定输出 JSON，在 `features` 里写 `format: formatFeature({ format: 'json' })`（`@migaia/log-host/features`）。

## 常用选项

| 选项或 API                                        | 说明                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `consolePlugin({ console?, stdout?, features? })` | `console` 默认全局 console，`stdout` 默认识别到的 `process.stdout`；都只借用，卸载时不关闭             |
| `prettyFeature({ color?, timestamp? })`           | 可读格式。`color` 取 `auto`（默认）、`always`、`never`；`timestamp` 默认 `true`                        |
| `ConsoleColorMode`                                | `color` 的取值常量                                                                                     |
| `log.raw(text)`                                   | 安装后 host 多出的方法：把原始文本直接写到 stdout（例如进度条的 `\r`），没有 stdout 时用 `console.log` |

`color: 'auto'` 依次看 `NO_COLOR`、非零的 `FORCE_COLOR`、是否终端、是否 CI。

## 契约细节

- 日志方法同步返回，交付异步进行；读取测试用的控制台或准备退出前，等待 `flush()` 或 `shutdown()`。
- 作为参数传入的 Error 只交给控制台一次；`data.silent` 为真的条目（例如 reasoning 插件的完整阶段记录）不在控制台重复输出。
- `meta` 按 host 入口的浅复制规则交付：同一个对象同时作为参数和 `meta` 传入时，参数里的原对象和 `meta` 副本都会交给控制台。
- 写入失败（包括 `raw`）进入 host 的失败通道，处理器收到原始错误。读取选项失败时同步抛出 `logging.console / INVALID_OPTION`，原因在 `cause`。
- `features` 的写法、host 级默认策略和覆盖规则与所有输出插件相同，见 [log-host 的组合策略](../log-host/README.md#组合策略)。

公开导出：`consolePlugin`、`prettyFeature`、`ConsoleColorMode`、`LogConsoleErrorCode`。运行时第三方依赖只有 `ansis`。完整示例见 [使用指南](./USEGUIDE.md)。
