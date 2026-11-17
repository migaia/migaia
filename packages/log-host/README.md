# @migaia/log-host

[English](./README.en.md)

写日志本身很简单，难的是日志之外的事：日志后端慢了会不会拖慢请求，进程退出时还没发出去的日志去哪了，日志服务挂了会不会把业务一起带崩。`@migaia/log-host` 把这些交给一个 host：日志调用立即返回，条目在后台按顺序交给各个输出插件；关闭时先把排队的日志送完再释放资源；交付失败走单独的失败通道，不进入业务代码。控制台、HTTP、文件、进程收尾和持久日志都是独立的插件包，按需安装。

## 你可能遇到过

- **日志拖慢了请求**：每条日志都 `await` 一次网络请求，日志服务一慢，接口响应跟着变慢。根因是日志写在请求的关键路径上。
- **进程退出时最后几条日志丢了**：发布新版本、容器被回收时，正在发送和还在缓冲区里的日志直接消失，偏偏它们记录了退出原因。根因是没人在退出前等日志送完。
- **日志服务出错把业务带崩**：日志请求失败变成未处理的 Promise 拒绝，或者抛进了业务代码的 `try/catch`。根因是日志失败和业务失败走的是同一条路。
- **每个输出各写一套批量和重试**：控制台、HTTP、文件各自实现缓冲、重试和超时，规则不一致，修一个漏一个。根因是这些策略没有统一的所有者。

## 为什么选它

- **日志调用不等待交付，关闭时也不丢。** `info()` 同步返回，条目进入有上限的队列（默认 10000 条）；`shutdown()` 先停止接收新日志，再排空每个输出的队列和批次，最后释放插件。[示例](./USEGUIDE.md#建立-host)
- **交付失败不进入业务控制流，也不会被悄悄吞掉。** 日志方法、`flush()` 和 `shutdown()` 都不会因为交付失败而抛出或拒绝；失败交给 `onFailure()` 监听器，没有监听器时交给 `report`。[示例](./USEGUIDE.md#错误投影与失败通道)
- **批量、重试、超时由 host 统一提供，输出可以单独覆盖。** 在一个策略插件里声明一次默认策略，所有输出继承；某个输出需要不同的批量大小时，只在它自己的 `features` 里写同名项。[示例](./USEGUIDE.md#输出策略与作用域)
- **错误对象的整条原因链都保留下来。** JSON 格式和 HTTP 输出共用同一个错误投影，`source`、`code`、`stack`、`cause` 和 `AggregateError` 的每个分支都会写进日志。[示例](./USEGUIDE.md#错误投影与失败通道)

只在本地调试时打印几行、不关心退出和失败的脚本，直接用 `console.log` 更简单。

## 从这里开始

下面用一个“慢的日志后端”演示：每批写入要 50 毫秒。用 Node 24 直接运行。

```ts doc-test=run
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineOutputPlugin } from '@migaia/log-host/sdk'

// 一个慢的日志后端：每批写入要 50 毫秒
const remote = defineOutputPlugin({
  name: 'remote',
  batchable: false,
  defaultFormat: 'plain',
  async deliver(records) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    for (const record of records) console.log(`后端收到：${record.entry.message}`)
  }
})

const log = createLogHost({ plugins: [levelPlugin(), remote] })
log.info('订单已创建')
log.warn('库存偏低')
console.log('日志调用已经返回，请求继续处理')

// 进程退出前调用：先把排队的日志送完，再释放插件
await log.shutdown('manual')
console.log('已关闭')
```

输出：

```text
日志调用已经返回，请求继续处理
后端收到：订单已创建
后端收到：库存偏低
已关闭
```

`info()` 和 `warn()` 返回时，后端还没收到任何东西，所以第一行先打印。`shutdown()` 等两条日志都送到后端才完成。`levelPlugin()` 给 host 加上 `debug`、`info`、`warn`、`error`、`fatal` 这些方法；`defineOutputPlugin` 声明一个输出，`deliver` 收到的是已经格式化好的记录。

真实项目里通常直接安装现成的输出插件，例如 [`@migaia/log-plugin-console`](../log-plugin-console/README.md) 的 `consolePlugin()`。下一步：要给所有输出加批量和重试，看[输出策略与作用域](./USEGUIDE.md#输出策略与作用域)；要在进程收到退出信号时自动收尾，看 [`@migaia/log-plugin-process`](../log-plugin-process/README.md)。

## 手写时的隐患

下面是常见的手写日志函数。它能跑，但有三个隐患（只用于说明，不必运行）：

```ts doc-test=check
async function sendLog(message: string) {
  await fetch('https://logs.example.invalid', { method: 'POST', body: JSON.stringify({ message }) })
}

// 隐患 1：在请求路径上 await，日志服务一慢，每个请求都跟着变慢
await sendLog('order created')

// 隐患 2：不 await 时，发送失败变成未处理的 Promise 拒绝；进程退出时正在发送的日志直接丢失
void sendLog('stock low')

// 隐患 3：再加一个文件输出，就要再写一遍批量、重试和超时，两边的规则很快变得不一致
```

用 log-host 时，日志调用只负责把条目放进队列：交付在后台进行，失败进入失败通道，`shutdown()` 负责在退出前送完，批量和重试由 host 统一提供。

## 三分钟心智模型

一条日志从调用到落地，依次经过下面几步：

1. **entry**：在 host 入口执行一次，例如给条目加 UUID。
2. **gate**：每个输出各自判断要不要这条日志，例如级别门槛和自定义过滤。
3. **format**：把条目变成文本（`json` 或 `plain`）。不消费文本的输出跳过这一步。
4. **batch / retry / timeout**：按输出缓冲成批、失败重试、限制单次交付时长。
5. **deliver**：输出插件把记录写到真正的去处。

| 概念                     | 一句话                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| host                     | `createLogHost` 返回的对象，拥有队列、插件和关闭过程                                               |
| 输出插件                 | 日志的去处，用 `defineOutputPlugin` 声明，或者安装现成的 `log-plugin-*` 包                         |
| 策略插件                 | 用 `defineLogPlugin({ name, features })` 声明 host 级默认策略，所有输出继承                        |
| Feature                  | 一项策略，例如 `thresholdFeature()`、`batchFeature()`；写在 `features` 记录里，键名就是它的名字    |
| 覆盖规则                 | 输出自己的 `features` 里同名的项覆盖 host 级同名项；format、batch、retry、timeout 每个输出只取一个 |
| `flush()` / `shutdown()` | 等已接收的日志送完（有时限）/ 送完后释放插件，重复调用共享同一个 Promise                           |
| 失败通道                 | `onFailure()` 监听交付失败；没有监听器时交给创建 host 时传入的 `report`                            |

## 典型场景

| 场景                                     | 怎么组合                                         | 详细说明                                              |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| 输出到控制台，开发时着色、线上输出 JSON  | `consolePlugin()` + `formatFeature`              | [log-plugin-console](../log-plugin-console/README.md) |
| 批量发送到日志服务，失败重试             | `httpPlugin()` + `batchFeature` + `retryFeature` | [log-plugin-http](../log-plugin-http/README.md)       |
| 追加写入文件并轮转                       | `filePlugin()`                                   | [log-plugin-file](../log-plugin-file/README.md)       |
| 收到退出信号时送完日志再退出             | `processPlugin()`                                | [log-plugin-process](../log-plugin-process/README.md) |
| 按级别过滤，运行时调整门槛               | `thresholdFeature` + `filterFeature`             | [级别、过滤与条目](./USEGUIDE.md#级别过滤与条目)      |
| 只给某一个输出换批量大小                 | 输出 `features` 里写同名项                       | [输出策略与作用域](./USEGUIDE.md#输出策略与作用域)    |
| 把日志转交给另一个 host                  | `forwardPlugin({ targets })`                     | [转发与动态配置](./USEGUIDE.md#转发与动态配置)        |
| 记录可重放的业务事件、预写日志和撤销日志 | `binlogPlugin` / `walPlugin` / `undoLogPlugin`   | [log-plugin-durable](../log-plugin-durable/README.md) |

## 安装

```bash
pnpm add @migaia/log-host
```

host 不内置任何输出，按需安装 `@migaia/log-plugin-*`。它不依赖第三方运行时包，底层能力来自 `@migaia/plugin-host`、`@migaia/middleware-pipeline`、`@migaia/lifecycle`、`@migaia/event-subscriber` 与 `@migaia/utils`。

## 常用 API

| API                                                               | 用途                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `createLogHost({ plugins, report?, maxPending? })`                | 创建 host                                                           |
| `levelPlugin()`                                                   | 添加 `debug` / `info` / `warn` / `error` / `fatal` / `atLevel` 方法 |
| `log.flush()` / `log.shutdown(reason)`                            | 等待送达 / 送完后关闭                                               |
| `log.onFailure(listener)`                                         | 监听交付失败，返回撤销函数                                          |
| `defineLogPlugin({ name, features })`                             | 声明 host 级默认策略（`@migaia/log-host/sdk`）                      |
| `defineOutputPlugin({ name, batchable, defaultFormat, deliver })` | 声明一个输出（`@migaia/log-host/sdk`）                              |

内置 Feature：`thresholdFeature`、`filterFeature`、`uuidFeature`、`formatFeature`、`batchFeature`、`retryFeature`、`timeoutFeature`，从 `@migaia/log-host/features` 一起导入，或从 `@migaia/log-host/features/<名称>` 单独导入。完整用法见 [USEGUIDE](./USEGUIDE.md)。

## 契约细节

### 组合策略

```ts
import { createLogHost, levelPlugin } from '@migaia/log-host'
import { defineLogPlugin } from '@migaia/log-host/sdk'
import { thresholdFeature, uuidFeature } from '@migaia/log-host/features'
import { consolePlugin } from '@migaia/log-plugin-console'

/** host 级策略作为每个输出的默认值；entry 策略只执行一次。 */
const log = createLogHost({
  plugins: [
    defineLogPlugin({
      name: 'policy',
      features: {
        threshold: thresholdFeature({ level: 'info' }),
        uuid: uuidFeature({ display: false })
      }
    }),
    levelPlugin(),
    consolePlugin()
  ]
})
log.debug('低于门槛，被过滤')
log.info('通过')
await log.shutdown('manual')
```

Feature 工厂返回 `@migaia/plugin-host` 的原生定义，不暴露内部字段或控制方法。`features` 一律写成 `{ 名称: feature }` 记录。每次插件安装各自创建状态；控制方法以 `${插件名}_${名称}_${方法}` 的形式挂在 host 上，例如 `log.policy_threshold_setLevel('warn')`。

输出插件的 `features` 只作用于它自己。输出里同名的项覆盖 host 级同名项；format、batch、retry、timeout 这四类每个输出只取一个，输出自己配了哪一类，就替换 host 级的同类项，名称不同也一样。名称不同的 gate 都会执行，即使来自同一个工厂。输出可以把某一类写成 `false`，表示不继承 host 级的这一类。

一个插件的记录里同类 format、batch、retry、timeout 最多一个，违反时以 `logging / INVALID_OPTION` 拒绝。两个 host 级策略插件各自提供同一类时，以 `plugin.host / FEATURE_ROLE_CONFLICT` 拒绝。这些检查在安装插件时进行（`createLogHost` 或 `use()`），被拒的插件整批回滚，host 仍可继续写日志。没有显式 format 时采用输出的 `defaultFormat`。

输出可以声明 `consumesText: false`，只接收原始条目和取消信号，跳过格式化；这样的输出不能配置 format，也不写 `defaultFormat`。

### 错误与生命周期

- 日志方法不抛出交付错误，`flush()` 与 `shutdown()` 总是兑现。失败通过 `onFailure()` 观察；没有监听器时交给 `report`。
- 监听器自身失败以 `HOOK_FAILED` 交给 `report`，原错误在 `cause`。`report` 自身失败会被收住，不递归报告。
- 非法的创建配置同步抛出带 `source`、`code` 的错误；`use()`、`unUse()` 是配置操作，可以拒绝。
- `flush()` 默认最多等 3000 毫秒，到期报告 `LIFECYCLE_DEADLINE` 后兑现，不代表所有日志都已送达。
- 待处理条目默认上限 10000 条，超出时丢弃最旧的未处理条目，并报告 `QUEUE_OVERFLOW`。
- durable 插件的 append、commit、read 仍按存储契约拒绝；“日志方法不抛出”的保证不覆盖这些事务操作。

### 入口

| 入口                               | 内容                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `@migaia/log-host`                 | `createLogHost`、`levelPlugin`、`forwardPlugin`、状态常量、默认 reporter 与 host 类型         |
| `@migaia/log-host/sdk`             | `defineLogFeature`、`defineLogPlugin`、`defineOutputPlugin`、`projectLogEntry` 与插件作者类型 |
| `@migaia/log-host/features`        | 七个内置 Feature                                                                              |
| `@migaia/log-host/features/<名称>` | 单个内置 Feature                                                                              |
