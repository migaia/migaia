# @migaia/log-host

异步日志 host。日志调用同步返回，条目随后按顺序经过异步管线与输出策略。控制台、HTTP、文件、进程收尾、reasoning 和持久日志由独立插件提供。

## 快速开始

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { consolePlugin } from '@migaia/log-plugin-console'

/** host 拥有插件安装、日志交付与最终释放。 */
const log = createLogHost({ plugins: [levelPlugin(), consolePlugin()] })
log.info('request completed', { requestId: 'r1' })
await log.flush()
await log.shutdown('manual')
```

`info()` 返回时输出尚未开始。`flush()` 等待已接纳的条目、异步交付与插件缓冲区；默认等待预算为 3000 毫秒。`shutdown()` 先运行最后日志处理器，再停止准入、排空并释放插件。并发 shutdown 返回同一个 Promise。

## 组合策略

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { thresholdFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** host 级策略作为每个输出端的默认值；entry 策略只执行一次。 */
const log = createLogHost({
  features: [thresholdFeature({ level: 'info' }), uuidFeature({ display: false })],
  plugins: [levelPlugin(), consolePlugin()]
})
log.debug('filtered by this output')
log.info('accepted')
await log.shutdown('manual')
```

内置 feature：`thresholdFeature`、`filterFeature`、`uuidFeature`、`formatFeature`、`batchFeature`、`retryFeature`、`timeoutFeature`。支持汇总入口 `./features` 和各自的默认导出，例如 `./features/retry`。

输出级同 kind 策略覆盖 host 默认值。每个作用域只允许一个 format，无论 kind 是否相同；输出级 format 覆盖 host format。交付顺序固定为门槛、过滤、自定义 gate、格式、批量、重试、超时、输出，与内置 feature 的数组顺序无关。

输出可声明 `consumesText: false`，只接收原条目与取消信号，跳过 host 格式阶段；该输出不能配置 format 或 defaultFormat。条目处理、gate 与交付策略照常执行。

## 错误与生命周期

- 日志方法不抛出运行期交付错误；`flush()` 与 `shutdown()` 总是兑现。失败通过 `onFailure()` 观察；没有监听器时交给 `report`。
- 监听器失败以 `HOOK_FAILED` 交给 reporter，原错误保留在 `cause`。reporter 自身失败会被收住，不递归报告。
- 非法创建配置同步抛带 `source`、`code` 的错误。`use()`、`unUse()` 是配置操作，可以拒绝。
- durable 的 append、commit、read 与失效句柄仍按存储契约拒绝；日志的非 throw 保证不覆盖事务操作。
- 待处理条目默认上限 10000，超出时丢弃最旧的未处理条目并报告 `QUEUE_OVERFLOW`。

## 入口

| 入口                               | 用途                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `@migaia/log-host`                 | `createLogHost`、`levelPlugin`、`forwardPlugin`、状态、默认 reporter 与 host 类型 |
| `@migaia/log-host/plugin`          | `defineLogFeature`、`defineOutputPlugin`、`projectLogEntry` 与插件作者类型        |
| `@migaia/log-host/features`        | 七个内置 feature                                                                  |
| `@migaia/log-host/features/<name>` | 对应 feature 的默认导出                                                           |

host 不内置输出端，不依赖第三方运行时包。底层能力来自 `@migaia/plugin-host`、`@migaia/middleware-pipeline`、`@migaia/lifecycle`、`@migaia/event-subscriber` 与 `@migaia/utils`。

完整用法见 [USEGUIDE.md](./USEGUIDE.md)。
