# Console 使用指南

安装 `@migaia/log-plugin-console` 与相同版本的 `@migaia/log-host`。输出插件只依赖 host、utils 与 ansis，不要求安装其它输出插件。

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { formatFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '@migaia/log-plugin-console'

const log = createLogHost({
  plugins: [
    levelPlugin(),
    consolePlugin({
      console: globalThis.console,
      features: { pretty: prettyFeature({ color: 'never', timestamp: false }) }
    })
  ]
})
log.info('user=%s', 'alice', { tenant: 'acme' })
log.raw('progress\r')
await log.flush()
await log.shutdown('manual')

const json = createLogHost({
  plugins: [consolePlugin({ features: { format: formatFeature({ format: 'json' }) } })]
})
json.log('info', 'structured')
await json.shutdown('manual')
```

`consolePlugin` 接受 `console`、`stdout`、`features`。console 是拥有 `log`、`warn`、`error` 方法的借用对象；调用保留该对象的 receiver。stdout 拥有 `write(text)`，可提供 `isTTY`。默认分别取全局 console 与识别到的宿主 process.stdout；卸载不关闭这些能力。

输出自己配置的 format 替换 host 级的 format，名称不同也一样；一个插件的 `features` 里最多一个 format。没有显式 format 时使用输出默认值：先读取 `LOG_FORMAT=json|pretty`；没有设置时，在 CI 中或 stdout 是终端则用 pretty，否则为 JSON。plain 需要显式 `formatFeature({ format: 'plain' })`。

pretty 保留占位符、原 args 顺序、对象和 Error 身份；为时间、tag、上下文等添加前缀。其它 formatter 的结果作为一个 text 参数交付。`warn` 走 warn，`error`/`fatal` 走 error，其余走 log；silent 条目不输出。

`prettyFeature({ color, timestamp })` 的 color 默认为 auto，可用 `ConsoleColorMode.auto`、`always`、`never`。always/never 优先；auto 依次考虑 NO_COLOR、非零 FORCE_COLOR、TTY、CI。timestamp 默认为 true。

日志方法同步返回，交付异步执行；读取测试控制台或准备退出前应等待 flush/shutdown。raw 同步使用 stdout.write，缺少 stdout 时用 console.log；原始能力错误进入 host 的 onFailure，处理器收到原错误。读取选项失败时同步抛出 `logging.console / INVALID_OPTION`，原因在 `cause`。

meta 保留 host 入口的浅复制语义；同一对象同时作为 args 与 meta 传入时，原 args 对象与额外 meta 副本都会交给控制台。

`features` 写成 `{ 名称: feature }` 记录；Feature 的控制方法以 `console_<名称>_<方法>` 挂在 host 上，例如名称为 `threshold` 时是 `console_threshold_setLevel`。host 级默认策略和覆盖规则见 [log-host 的组合策略](../log-host/README.md#组合策略)。
