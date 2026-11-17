# @migaia/log-plugin-process

[English](./README.en.md)

让进程退出时不丢日志的插件，配合 `@migaia/log-host` 使用。收到 `SIGINT` / `SIGTERM` 时，先运行你登记的最后日志处理器，再把排队的日志送完，最后才退出进程；未捕获的异常和 Promise 拒绝会先记一条 `fatal` 日志再关闭。

## 你可能遇到过

- **容器被停止时，最后几条日志和退出原因都没留下**：收到 `SIGTERM` 后进程立即退出，缓冲里的日志一起消失。根因是退出前没人等日志送完。
- **崩溃前的最后一条错误没进日志系统**：未捕获异常让进程直接终止，错误只在终端闪过。根因是崩溃路径没有接到日志的关闭流程上。
- **多个模块各自监听信号，互相抢着退出**：每个库都 `process.on('SIGTERM')`，有的先 `exit`，其他的还没收尾。根因是信号处理没有统一的所有者。

## 从这里开始

下面用一个假的 process 对象演示收到 `SIGTERM` 后的顺序，不会真的退出。用 Node 24 直接运行。

```ts doc-test=run
import { EventEmitter } from 'node:events'
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'
import { processPlugin } from '@migaia/log-plugin-process'

// 假的 process：只有事件、环境变量和 exit；不传 process 时使用真实进程
const fakeProcess = Object.assign(new EventEmitter(), {
  env: {},
  exit(code?: number) {
    console.log(`process.exit(${code})`)
  }
})
// 一个慢输出：每次写出要 20 毫秒
const output = defineOutputPlugin({
  name: 'output',
  batchable: false,
  defaultFormat: 'plain',
  async deliver(records) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const record of records) console.log(`写出：${record.entry.message}`)
  }
})
const log = createLogHost({
  plugins: [levelPlugin(), output, processPlugin({ process: fakeProcess })]
})
log.onShutdown(() => {
  log.info('收到退出信号，正在关闭')
})
log.info('服务已启动')
fakeProcess.emit('SIGTERM')
```

输出：

```text
写出：服务已启动
写出：收到退出信号，正在关闭
process.exit(0)
```

收到信号后，`onShutdown` 里的最后一条日志也被写出，然后才调用 `exit(0)`。整个关闭过程默认最多等 3000 毫秒。

## 常用选项

| 选项                   | 默认值             | 说明                                                                   |
| ---------------------- | ------------------ | ---------------------------------------------------------------------- |
| `process`              | 识别到的服务端进程 | 需要 `env`、`on`、`removeListener`、`exit`；只借用，不替换             |
| `captureCrashes`       | `true`             | 未捕获异常和未处理拒绝先记 `fatal` 再关闭                              |
| `shutdownTimeoutMs`    | `3000`             | 关闭等待的上限                                                         |
| `interceptProcessExit` | `false`            | 为 `true` 时，代码里直接调用 `process.exit` 也会先等一次有时限的 flush |

`log.onShutdown(handler)` 登记最后日志处理器（log-host 提供）。

## 契约细节

- `SIGINT` / `SIGTERM` 触发关闭，完成后调用 `exit(0)`；`beforeExit` 只做有时限的 flush，不强制退出。没有可用的进程且没有注入时，插件不安装任何监听器。
- 同一个 process 对象上的多个 host 共享一组监听器，要求三个策略选项和调度器来源一致，否则安装时以 `PLUGIN_CONFIG_CONFLICT` 拒绝；不同 process 对象互不影响。最后一个使用者移除后撤销监听，之后可以重新安装。
- 部分监听注册失败时按相反顺序回滚已注册的部分；一个清理错误不会跳过其他资源，最初的错误保持在首位，原错误沿 `cause` 和 `AggregateError.errors` 可达。
- 错误域是 `logging.process`（`LOG_PROCESS_ERROR_SOURCE`），错误码见 `LogProcessErrorCode`。安装冲突和失败同步抛出；运行期失败进入 host 的失败通道。

完整选项及错误码见 [使用指南](./USEGUIDE.md)。
