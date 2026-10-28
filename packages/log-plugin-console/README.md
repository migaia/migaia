# @migaia/log-plugin-console

按需安装的控制台输出，与相同版本的 `@migaia/log-host` 配合使用。运行时第三方依赖只有 `ansis`；控制台对象和 stdout 均可注入。

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [levelPlugin(), consolePlugin()],
  features: [prettyFeature({ color: 'auto' })]
})
log.info('server ready', { port: 3000 })
await log.flush()
await log.shutdown('manual')
```

`info` 等日志方法同步返回，条目随后异步交付。`warn` 使用 `console.warn`，`error`/`fatal` 使用 `console.error`，其它 tag 使用 `console.log`。`data.silent` 条目不重复输出。

`prettyFeature` 保留原始 message 占位符、参数顺序、对象和原生 Error 身份。JSON/plain 使用 host 提供的 `record.text`。默认格式遵循 `LOG_FORMAT=json|pretty`、CI、TTY 的优先级；没有任何提示时使用 JSON。显式 host/output 格式优先于此默认值。

安装后 host 另有 `raw(text)` 扩展：优先写入借用的 stdout，缺少 stdout 时使用借用的 `console.log`。写入失败进入 host 失败通道。卸载不会关闭应用提供的 console/stdout。

公开值为 `consolePlugin`、`prettyFeature`、`ConsoleColorMode` 和空码表 `LogConsoleErrorCode`。本包不声明错误 source；能力抛出的原始错误由 host 收口。

完整选项与覆盖示例见 [使用指南](./USEGUIDE.md)。

meta 保留 host 入口的浅复制语义；同一对象同时作为 args 与 meta 传入时，原 args 对象与额外 meta 副本都会交给控制台。
