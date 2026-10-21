# `@migaia/middleware-pipeline` 使用指南

[English](./USEGUIDE.en.md)

本指南先按场景提供可直接运行的代码，再列出全部模式、参数和错误语义。安装包后，每个运行示例都能单独保存为 .ts 文件，用 Node 24 运行；代码与对应网站场景一致。选用依据见 [README](./README.md)。

## 按场景查找

| 你遇到的问题                           | 怎么组合                          | 看这一节                                          |
| -------------------------------------- | --------------------------------- | ------------------------------------------------- |
| 让多个步骤依次处理同一个值             | `sync + run`                      | [完整示例](#让多个步骤依次处理同一个值)           |
| 下游完成后再执行外层收尾               | `async + await next`              | [完整示例](#下游完成后再执行外层收尾)             |
| 复用同步步骤时保留原来的顺序           | `lift(sync) + async run`          | [完整示例](#复用同步步骤时保留原来的顺序)         |
| 采用单次请求的信号，取消后不再进入下游 | `run + control.signal`            | [完整示例](#采用单次请求的信号取消后不再进入下游) |
| 生成器校验不通过时停止保存             | `generator + GENERATOR_HALT`      | [完整示例](#生成器校验不通过时停止保存)           |
| 把 undefined 交给终点，而不是意外终止  | `generator + GENERATOR_UNDEFINED` | [完整示例](#把-undefined-交给终点而不是意外终止)  |

## 让多个步骤依次处理同一个值

校验、格式化步骤在多个入口被复制，某个副本又改变了执行顺序。把选定的步骤交给 `run()`，每次 `next(value)` 把处理后的值交给下一步，终点回调收到最终结果。`sync` 模式中，当前步骤返回后下游才开始。

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
pipeline.run([(value, next) => next(value + 1), (value, next) => next(value * 2)], 2, (value) => {
  console.log('结果:', value)
})
```

输出：

```text
结果: 6
```

输出 `结果: 6`：输入 2 先变成 3，再变成 6。`run()` 返回 `void`；步骤不调用 `next()` 时，后续步骤和终点回调都不会执行。

## 下游完成后再执行外层收尾

请求中的异步工作还没完成，计时器就停止了，因为手写回调链没有等待下游 Promise。`async` 模式的 `next()` 启动下游并返回它的 Promise；在 `try/finally` 中等待它，外层收尾就在下游结束后执行。这种前后包裹的执行方式称为洋葱模型。

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async })
const trace: string[] = []
await pipeline.run(
  [
    async (value, next) => {
      trace.push('开始计时')
      try {
        await next(value + 1)
      } finally {
        trace.push('结束计时')
      }
    },
    async (value, next) => {
      trace.push('校验')
      await next(value * 2)
    }
  ],
  2,
  (value) => {
    trace.push(`结果 ${value}`)
  }
)
console.log(trace.join(' | '))
```

输出：

```text
开始计时 | 校验 | 结果 6 | 结束计时
```

输出 `开始计时 | 校验 | 结果 6 | 结束计时`。外层收尾发生在终点回调之后。这只保证执行顺序，不会撤销已经发生的副作用。

## 复用同步步骤时保留原来的顺序

为了接入另一条流水线，同步规范化步骤被改写成异步回调，`next()` 后的代码却意外跑到了下游之后。`lift(stage, from)` 复用同步步骤并保留线性顺序：它的 `next()` 只记录要传递的值，当前步骤返回后下游才开始。

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<string>({ mode: MiddlewarePipelineMode.async })
const trim = pipeline.lift((value, next) => {
  console.log('同步步骤调用 next 前')
  next(value.trim())
  console.log('同步步骤调用 next 后')
}, MiddlewarePipelineMode.sync)
await pipeline.run(
  [
    trim,
    async (value, next) => {
      console.log('异步步骤输入:', value)
      await next(value.toUpperCase())
    }
  ],
  ' ready ',
  (value) => {
    console.log('结果:', value)
  }
)
```

输出：

```text
同步步骤调用 next 前
同步步骤调用 next 后
异步步骤输入: ready
结果: READY
```

依次输出 `同步步骤调用 next 前`、`同步步骤调用 next 后`、`异步步骤输入: ready`、`结果: READY`。同步步骤中 `next()` 后的代码仍先于下游执行。只支持文档列出的提升方向，异步洋葱步骤不能任意转成生成器步骤。

## 采用单次请求的信号，取消后不再进入下游

可复用流水线配置了应用信号，某次请求却需要自己的取消边界。只检查默认信号，会让已经取消的请求继续进入下一步。把 `control.signal` 传给 `run()` 来覆盖默认值；步骤在 `context.signal` 中看到同一个信号，进入下游之前会检查取消状态。

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const application = new AbortController()
application.abort(new Error('应用已停止'))
const request = new AbortController()
const pipeline = createPipeline<number>({
  mode: MiddlewarePipelineMode.async,
  signal: application.signal
})
let completed = false
try {
  await pipeline.run(
    [
      async (value, next, context) => {
        console.log('采用请求信号:', context?.signal === request.signal)
        request.abort(new Error('请求已取消'))
        await next(value + 1)
      }
    ],
    1,
    () => {
      completed = true
    },
    { signal: request.signal }
  )
} catch (error) {
  console.log('失败:', (error as Error).message)
}
console.log('终点回调执行:', completed)
```

输出：

```text
采用请求信号: true
失败: 请求已取消
终点回调执行: false
```

依次输出 `采用请求信号: true`、`失败: 请求已取消`、`终点回调执行: false`。请求信号覆盖了已经取消的默认信号，随后取消请求又阻止了终点回调。已经运行的用户代码不会被强行打断，两个控制器都由调用方持有。

## 生成器校验不通过时停止保存

生成器校验发现值不合法，却把这个值返回给下游，保存步骤仍然执行。返回 `GENERATOR_HALT` 可以明确停止整条生成器流水线，后续步骤和终点回调都不会执行。这个控制符属于生成器模式，不用于同步或异步的 `next()` 回调。

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode, GENERATOR_HALT } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })
let written = false
let completed = false
pipeline.run(
  [
    function* (value) {
      return value < 0 ? GENERATOR_HALT : value
    },
    function* (value) {
      written = true
      return value
    }
  ],
  -1,
  () => {
    completed = true
  }
)
console.log('写入步骤执行:', written)
console.log('终点回调执行:', completed)
```

输出：

```text
写入步骤执行: false
终点回调执行: false
```

输出 `写入步骤执行: false` 和 `终点回调执行: false`。停止控制符同时阻止了保存步骤和终点回调。配置自定义 `signals` 时，应返回它自己的 `halt` 符号，而不是这个默认常量。

## 把 undefined 交给终点，而不是意外终止

清空缓存需要把真正的 `undefined` 作为数据交出去，生成器直接 `return undefined` 却表示停止，终点回调不会执行。`GENERATOR_UNDEFINED` 把有意交付的空值和终止分开；流水线的载荷类型必须包含 `undefined`。

```ts doc-test=run
import {
  createPipeline,
  MiddlewarePipelineMode,
  GENERATOR_UNDEFINED
} from '@migaia/middleware-pipeline'

const pipeline = createPipeline<string | undefined>({ mode: MiddlewarePipelineMode.generator })
let ordinaryCompleted = false
pipeline.run(
  [
    function* () {
      return undefined
    }
  ],
  '缓存值',
  () => {
    ordinaryCompleted = true
  }
)
console.log('普通返回会完成:', ordinaryCompleted)
pipeline.run(
  [
    function* () {
      return GENERATOR_UNDEFINED
    }
  ],
  '缓存值',
  (value) => {
    console.log('显式空值仍交付:', value === undefined)
  }
)
```

输出：

```text
普通返回会完成: false
显式空值仍交付: true
```

输出 `普通返回会完成: false`，然后是 `显式空值仍交付: true`。默认的显式空值控制符让数据被交付，控制符本身不会作为数据传出。它只用于生成器和异步生成器模式，自定义信号组使用自己的 `undefined` 符号。

## 入口、所有权与运行模型

只有根入口 `@migaia/middleware-pipeline`，运行时依赖为 `@migaia/utils`，不依赖 DOM、Node 或外部生命周期宿主。根入口提供 `createPipeline()`、模式与生成器信号常量、公开 stage/control/context 类型，以及错误码；具体执行器和适配器属于包内实现，不能从根入口导入。

pipeline 是执行规则固定的对象，只含只读 `mode`、`lift()` 和 `run()`。每次运行的当前值、索引、取消上下文与 `next` 状态都属于该次 `run()`；同一个 pipeline 可以复用，各次运行相互隔离。每次运行都复制一份 stage 列表，之后替换、插入或删除原数组的项，不改变本轮执行的函数列表。

stage（处理步骤）接收当前值，决定继续、短路或失败；done 是整条链成功走完后的终点回调。包不保存业务状态，不拥有取消控制器，不创建或关闭宿主。生命周期断言复用宿主已有的代次、租约或作用域规则，不在包内重建这些机制。

## 创建选项及全部默认值

`createPipeline<TValue>(options)` 必须明确选择模式。返回类型为该模式的 `IMiddlewarePipeline<TMode, TValue, TSignals>`；模式决定 stage、done、run 返回值和允许的提升方向。选项类型是 `ICreatePipelineOptions<TMode>`。

| 字段                                                | 默认值                               | 含义与所有取值                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                                              | 必填，无默认                         | `'sync'`、`'async'`、`'generator'`、`'async-generator'`，分别对应 `MiddlewarePipelineMode.sync`、`async`、`generator`、`asyncGenerator`。创建后不能改变。                  |
| `onViolation(kind)`                                 | 空操作函数                           | 同步接收 `'duplicate'` 或 `'late'`；分别对应 `MiddlewarePipelineViolation.duplicate`、`late`。用于记录非法 next 调用，不重新执行下游。                                     |
| `assertActive()`                                    | `undefined`                          | 宿主提供的同步生命周期断言。入口和每个 stage 后执行；异步模式进入下游时也会检查。抛错会阻止继续执行，包不替宿主改变状态。                                                  |
| `signal`                                            | `undefined`                          | 默认取消信号，供未提供调用级信号的 run 使用。信号的结构和状态在 run 入口校验，不在创建时提前读取。                                                                         |
| `signals`                                           | `MiddlewarePipelineGeneratorSignals` | 生成器的三个控制 symbol；字段为 `undefined`、`halt`、`continue`，必须互不相同。默认集已冻结。                                                                              |
| `signals.undefined`                                 | `GENERATOR_UNDEFINED`                | 把 undefined 当作显式业务值继续，而不是结束。                                                                                                                              |
| `signals.halt`                                      | `GENERATOR_HALT`                     | 终止整条链，不调用后续 stage 或 done。                                                                                                                                     |
| `signals.continue`                                  | `GENERATOR_CONTINUE`                 | 采用最后一次 yield 值继续；没有 yield 时沿用输入值。                                                                                                                       |
| `combineStageAndDownstreamError(stage, downstream)` | `undefined`                          | 只用于异步洋葱执行中两个独立失败：第一个参数来自当前 stage，第二个来自它已启动的下游。返回值作为组合失败抛出；调用方要让两个原错通过 cause 或 AggregateError.errors 可达。 |

构造选项必须是对象，不能为 null 或数组。支持的字段及自定义信号的三个属性只读取一次，再冻结内部快照；修改调用方对象不会改变已创建的 pipeline。`mode` 属性发布的就是这一份已验证值。非法模式、回调、控制对象、信号结构、信号集或提升方向以原生 `TypeError` 和 `INVALID_OPTION` 报告。选项 getter 抛错时，原始失败保留在 `cause`。

## run、next 与四种模式

统一调用形状为 `pipeline.run(stages, value, done, control?)`。

| 参数或成员              | 含义                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `stages`                | 当前模式的只读 stage 数组；入口快照固定本轮函数身份，运行中增删留给后续调用。                                      |
| `value`                 | 调用方提供的初始业务值，之后每一步接收前一步提交的值。                                                             |
| `done(value, context?)` | 收到最终值；只有未短路且未失败时执行。空 stage 数组直接到达 done。同步模式只能同步完成，异步模式也可返回 Promise。 |
| `control`               | 默认 `undefined`。目前只包含可选 `signal`，对象不能为 null 或数组。                                                |
| `control.signal`        | 默认 `undefined`，回退到构造级 `signal`；提供有效信号时覆盖它，不合并两个信号。                                    |
| `context.signal`        | 本次实际选择的信号。没有信号时，不额外传入 context 参数。                                                          |
| `pipeline.mode`         | 只读的模式值，适合日志或选择对应 stage 类型。                                                                      |

| 模式              | stage 形状                                         | 下游开始时刻                                     | run 返回值                              |
| ----------------- | -------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| `sync`            | `(value, next, context?) => void`                  | stage 正常返回后；next 只提交值。                | `void`，同步抛错。                      |
| `async`           | `(value, next, context?) => void \| Promise<void>` | 首次 next 调用立即启动下游，形成洋葱式前后包裹。 | `Promise<void>`，入口或执行失败均拒绝。 |
| `generator`       | `(value, context?) => Generator`                   | 当前生成器完全结束并解释 return 后。             | `void`，同步抛错。                      |
| `async-generator` | `(value, context?) => AsyncGenerator`              | 当前异步生成器完全结束并解释 return 后。         | `Promise<void>`，done 也可以异步。      |

同步 stage 最多提交一次 `next(value)`。不调用就短路，后续 stage 和 done 都不执行。它是线性转换：next 之后的同步代码仍先于下游执行；stage 抛错时不会启动下游。

异步 stage 的 `next(value)` 立即启动下游，并返回该次下游的同一个 Promise。因此 `await next(value)` 后的代码用于包裹式收尾。即使 stage 没有 await 已启动的 next，runner 仍等待下游结算，避免 run 提前成功。正常结束但没有调用 next 时同样短路。

`duplicate` 表示在同一步结束前重复调用 next；`late` 表示该步已经返回或异步结算后才调用捕获的 next。违约不覆盖第一次提交的值，也不重启下游。默认忽略，可用 `onViolation` 记录。回调在 run 内抛错时按该模式的失败通道传播；run 结束后调用捕获的 next 引起回调抛错，会直接从那次 next 调用抛出。

## 生成器终值与信号

生成器可以 yield 多次，但中间值不会逐个流向下游；只有 stage 结束后的 return 决定继续的值。

| 生成器 return              | 行为                                                            |
| -------------------------- | --------------------------------------------------------------- |
| 普通业务值                 | 把该值交给下一步。                                              |
| `GENERATOR_CONTINUE`       | 采用最后一次 yield；没有 yield 则继续用当前输入。               |
| `GENERATOR_HALT`           | 整条链终止，不调用 done。                                       |
| 隐式返回或普通 `undefined` | 同样终止，不代表显式空值。                                      |
| `GENERATOR_UNDEFINED`      | 显式以 undefined 继续；业务值类型 `TValue` 必须包含 undefined。 |

自定义 `signals` 用自己的三个 symbol 替代默认身份，return 时要使用同一组信号。sync stage 提升到生成器时，也使用目标 pipeline 的 halt/continue，控制 symbol 不会作为普通 payload 传给 done。

`IGeneratorMiddlewareStage`、`IAsyncGeneratorMiddlewareStage`、`IMiddlewarePipeline` 和 `IMiddlewarePipelineStage` 的 `TSignals` 将控制域与 `TValue` 分开。自定义信号重载不会把 number payload 扩成 symbol。默认信号保留精确的 unique symbol 类型。

## lift：复用既有步骤

`pipeline.lift(stage, from)` 接收已有 stage 和它的来源模式 `from`，返回适合当前 pipeline 的 stage。只支持下表的无损方向；同模式返回原函数，保持 `===` 身份。

| 目标模式          | from 允许值                            |
| ----------------- | -------------------------------------- |
| `sync`            | `sync`                                 |
| `async`           | `sync`、`async`                        |
| `generator`       | `sync`、`generator`                    |
| `async-generator` | `sync`、`generator`、`async-generator` |

不支持 async 到 async-generator，也不支持逆向提升。类型系统会拒绝不支持的方向，运行时同样抛 `INVALID_OPTION` 的 TypeError。

提升复用包内同一套适配规则，保持调用次数、违约报告、错误和 next Promise 语义。特别是被提升的 sync stage 仍先执行完 next 后面的同步代码，再启动下游；stage 抛错时下游不启动。提升不是把原有 sync 逻辑改成异步洋葱逻辑。

## 取消与宿主生命周期

可以传原生 AbortSignal，或从 `@migaia/utils/promise` 导入的结构类型 `IAbortSignal`。本包不再从根入口导出 `IAbortSignal`。有效信号需要布尔 aborted 及兼容的 addEventListener/removeEventListener 方法，可携带 reason；pipeline 读取取消检查点，不拥有控制器。

四种模式都检查 run 入口、每个 stage 开始前、每个 stage 返回后和 done 前。生成器还会在每次迭代后检查。已经开始的步骤不会被强制打断，也不会因为 signal 取消就提前放弃它正在等待的 Promise；步骤应通过收到的 `context.signal` 协作退出。

生成器在 yield 边界观察到取消时，会调用 iterator.return() 并继续排空清理期间的 yield；清理值不会送到下游。异步生成器等待这次清理完成后才拒绝。取消和清理都失败时，抛 `ABORT_CLEANUP_FAILED` 的 AggregateError，errors 依次保留取消主错与清理失败。

异步洋葱的每个外层 stage 返回时都会复核取消和宿主 active，即使 done 已经执行。检查失败不能撤销已经发生的 done。用户代码已经抛出普通失败时，该失败保持为主错误，之后的取消不会替换它。`assertActive` 的宿主控制失败不会被误当作两个独立业务失败重复组合。

## 失败、原始错误与错误码

`MIDDLEWARE_PIPELINE_SOURCE` 的值是 `'@migaia/middleware-pipeline'`。`MiddlewarePipelineErrorCode` 是唯一的公开错误码表：

| 成员                 | 码值                   | 发生时看到什么                                                                                                      |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `executionFailed`    | `EXECUTION_FAILED`     | stage、done、宿主断言、违约回调或组合器的未分类失败；两个独立异步失败默认合为 AggregateError。                      |
| `invalidOption`      | `INVALID_OPTION`       | 非法选项、模式、回调、signal/control、信号集或 lift 方向；类型为 TypeError，存在原始读取或验证失败时由 cause 保留。 |
| `aborted`            | `ABORTED`              | 合作式取消；可附码且尚未分类的 Error reason 加此码，其余原因保留在 cause。                                          |
| `abortCleanupFailed` | `ABORT_CLEANUP_FAILED` | 取消主错与生成器清理同时失败，按主错在前的顺序聚合。                                                                |

stage、done、`assertActive` 的原生 Error 尽量保留对象、类型和 stack；没有完整语义 source/code 时附 `EXECUTION_FAILED`，已有完整外部身份则不改写。不可修改错误或非 Error 值保留在包装错误的 cause 中。取消的 Error reason 同样尽量保留；字符串、undefined 等其他 reason 放在普通 Error 的 cause 中，不保证是原生 AbortError。reason 的 getter 抛出时，抛出值按 reason 处理。

异步 stage 和已启动下游分别失败时，默认 `EXECUTION_FAILED` 的 AggregateError.errors 按 stage、downstream 顺序保留两者。若只是 await next 传播同一个对象失败，不再造两个相同错误项；相等的 primitive 仍可能是独立失败，不按值合并。

自定义组合器返回的结果用于失败传播；调用方必须自行保证两个原始错误仍可通过 cause 或 errors 找到。组合器自己抛错时，其原始失败尽量作为主错误，两个已经发生的失败仍会附到 errors/cause 链，不能把它们丢掉。

## 公开类型与构建

根入口公开 `ICreatePipelineOptions`、`IMiddlewarePipeline`、`IMiddlewarePipelineStage`、`IMiddlewarePipelineDone`、`IMiddlewarePipelineRunResult`、`IMiddlewarePipelineLiftSource`，以及四种 stage 类型、context/control 类型、违约与信号类型。消费者通过工厂、run 和 lift 使用执行器。

`IMiddlewarePipelineSyncMode` 只是包内用于 Done/RunResult 条件类型的中间项，已从根入口撤回，没有兼容别名。业务代码使用公开的 `IMiddlewarePipelineDone`、`IMiddlewarePipelineRunResult`。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
