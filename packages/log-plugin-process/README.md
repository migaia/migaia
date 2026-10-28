# @migaia/log-plugin-process

为日志 host 安装进程信号、崩溃捕获与优雅关闭集成。与相同版本的 `@migaia/log-host` 配合使用，进程能力可按插件注入。

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin } from '@migaia/log-plugin-console'
import { processPlugin } from '@migaia/log-plugin-process'

const log = createLogHost({
  plugins: [levelPlugin(), consolePlugin(), processPlugin()]
})
log.onShutdown(() => {
  log.info('shutdown started')
})
log.info('ready')
```

相同 process 对象上的多个 host 共享一组监听器；不同对象分别拥有自己的组。最后一个使用者卸载后移除该组监听器。借用的 process 不会被关闭。

默认捕获崩溃、关闭等待预算为 3000ms、默认不拦截 `process.exit`。`SIGINT`/`SIGTERM` 触发共享 shutdown，`beforeExit` 仅等待 flush。没有宿主 process 且未注入时不安装监听器。

同一个 process 组要求一致的配置与 scheduler 来源。失败的安装会回滚已经尝试的监听注册；清理失败保留原始错误与顺序。完整选项及错误码见 [使用指南](./USEGUIDE.md)。
