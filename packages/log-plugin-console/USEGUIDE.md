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

输出端的 format 只替换 host-wide record 中同 key 的 feature；不同 key 的两个有效 format 在实际安装时以 `INVALID_OPTION` 拒绝。没有有效显式 format 时使用输出默认值。默认值先读取 `LOG_FORMAT=json|pretty`，再按 CI、TTY 选择 pretty，否则为 JSON。plain 需要显式 `formatFeature({ format: 'plain' })`。

pretty 保留占位符、原 args 顺序、对象和 Error 身份；为时间、tag、上下文等添加前缀。其它 formatter 的结果作为一个 text 参数交付。`warn` 走 warn，`error`/`fatal` 走 error，其余走 log；silent 条目不输出。

`prettyFeature({ color, timestamp })` 的 color 默认为 auto，可用 `ConsoleColorMode.auto`、`always`、`never`。always/never 优先；auto 依次考虑 NO_COLOR、非零 FORCE_COLOR、TTY、CI。timestamp 默认为 true。

日志方法同步返回，交付异步执行；读取测试控制台或准备退出前应等待 flush/shutdown。raw 同步使用 stdout.write，缺少 stdout 时用 console.log；原始能力错误进入 host 的 onFailure，处理器收到原错误。本包的 `LogConsoleErrorCode` 是空表，不另声明错误域。

meta 保留 host 入口的浅复制语义；同一对象同时作为 args 与 meta 传入时，原 args 对象与额外 meta 副本都会交给控制台。

`features` 使用 plugin-host 原生 record：`{ alias: feature }`。每个 feature 都是 `defineFeature` 返回的 opaque token；插件负责安装，并通过 host 与插件 handle 的 `console_alias_method` 扩展公开控制方法。运行时状态由每次安装独立拥有，例如 `threshold` alias 对应 `console_threshold_setLevel`。全局默认策略由 `@migaia/log-host/plugin` 的非输出插件 `defineLogPlugin({ name, features })` 声明，再传入 `createLogHost({ plugins: [...] })`；输出端只覆盖全局 record 中同 key 的 feature，不按工厂类别覆盖。不同 key 的 gate 会同时生效。host-wide carrier 之间同 key 冲突；每个输出在实际安装、按 key 合并后最多有一个 format、一个 batch、一个 retry 和一个 timeout，冲突以既有 `INVALID_OPTION` 拒绝。不再支持 `createLogHost({ features })` 或 feature 数组。
