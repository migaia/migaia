# Middleware Pipeline 使用指南

本包只有一个构造入口：`createPipeline(options)`。构造选项固定执行代数，返回对象只含 `mode`、`lift()` 和 `run()`；具体运行状态只存在于单次 `run()` 调用中。

## 1. 创建 pipeline

```ts
import {
  createPipeline,
  MiddlewarePipelineMode,
  type ICreatePipelineOptions,
  type IMiddlewarePipeline
} from '@migaia/middleware-pipeline'

const options: ICreatePipelineOptions<typeof MiddlewarePipelineMode.async> = {
  mode: MiddlewarePipelineMode.async,
  onViolation: (kind) => console.warn(kind)
}

const pipeline: IMiddlewarePipeline<typeof MiddlewarePipelineMode.async, string> =
  createPipeline<string>(options)
```

构造选项：

- `mode`：必填，取 `sync`、`async`、`generator` 或 `async-generator`。
- `onViolation`：可选，接收 `late` 或 `duplicate`；省略时为空操作。
- `assertActive`：可选，由 host 提供的生命周期断言，在入口和每个 stage 后执行。
- `signal`：可选，所有调用的默认取消信号。
- `signals`：可选，generator 三个 sentinel 的兼容注入。
- `combineStageAndDownstreamError`：可选，仅异步洋葱帧同时失败时组合两个错误。

选项会被读取并冻结。无效模式、无效回调、无效 sentinel 集或不支持的提升方向都会产生原生 `TypeError`；错误附带：

```ts
error.source === '@migaia/middleware-pipeline'
error.code === MiddlewarePipelineErrorCode.invalidOption
```

## 2. `run()`

统一调用形状：

```ts
pipeline.run(stages, initialValue, done, control?)
```

`control` 目前只含可选 `signal`。调用级 signal 存在时覆盖构造级 signal。上下文仅在有效 signal 存在时传给 stage 和 `done`：

```ts
type IMiddlewarePipelineContext = { readonly signal: IMiddlewarePipelineAbortSignal }
```

### 2.1 Sync

```ts
const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })

pipeline.run(
  [
    (value, next) => next(value + 1),
    (value, next) => next(value * 3)
  ],
  2,
  (value) => console.log(value) // 9
)
```

每个 stage 至多调用一次 `next(value)`。不调用即短路，后续 stage 与 `done` 不执行。返回值是 `void`，错误同步抛出。

### 2.2 Async

```ts
const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async })
const trace: string[] = []

await pipeline.run(
  [
    async (value, next) => {
      trace.push('before')
      await next(value + 1)
      trace.push('after')
    }
  ],
  1,
  async (value) => trace.push(`done:${value}`)
)

// ['before', 'done:2', 'after']
```

`next()` 立即启动下游，并把同一个下游 Promise 返回给 stage。`run()` 总是返回 Promise；入口验证错误和执行错误都表现为 rejection。

若当前 stage 在等待下游时自身也失败，默认保持既有传播语义。需要 host 统一错误链时提供 `combineStageAndDownstreamError(stage, downstream)`；原错误应继续从 `cause` 或 `AggregateError.errors` 可达。

### 2.3 Generator

```ts
import { GENERATOR_CONTINUE, GENERATOR_HALT } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })

pipeline.run(
  [
    function* (value) {
      yield value + 1
      yield value + 2
      return GENERATOR_CONTINUE
    },
    function* (value) {
      if (value > 10) return GENERATOR_HALT
      return value * 2
    }
  ],
  1,
  (value) => console.log(value) // 6
)
```

一个 generator stage 可以多次 `yield`。其 `return` 决定后续：

- 普通值：以该值继续。
- `GENERATOR_CONTINUE`：采用最后一次 `yield` 的值继续。
- `GENERATOR_HALT` 或隐式 `undefined`：终止，不调用 `done`。
- `GENERATOR_UNDEFINED`：把 `undefined` 作为显式值继续，适用于值域包含 `undefined` 的流水线。

返回值是 `void`，错误同步抛出。

### 2.4 Async generator

```ts
const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.asyncGenerator })

await pipeline.run(
  [
    async function* (value) {
      yield value + 1
      await Promise.resolve()
      return GENERATOR_CONTINUE
    }
  ],
  1,
  async (value) => console.log(value) // 2
)
```

sentinel 语义与 generator 相同，但 stage 是 `AsyncGenerator`，`done` 可以异步，`run()` 返回 Promise。

## 3. `lift()` 复用低阶 stage

提升复用包内既有适配语义，不改变 stage 调用次数、错误或 Promise 身份。

| 目标 `mode` | `from` 可选值 |
| --- | --- |
| `sync` | `sync` |
| `async` | `sync`、`async` |
| `generator` | `sync`、`generator` |
| `async-generator` | `sync`、`generator`、`async-generator` |

```ts
const pipeline = createPipeline<string>({ mode: MiddlewarePipelineMode.asyncGenerator })

const trim = pipeline.lift(
  (value, next) => next(value.trim()),
  MiddlewarePipelineMode.sync
)

const decorate = pipeline.lift(
  function* (value) {
    yield `[${value}]`
    return GENERATOR_CONTINUE
  },
  MiddlewarePipelineMode.generator
)

await pipeline.run([trim, decorate], ' ready ', (value) => {
  console.log(value) // [ready]
})
```

同模式 `lift()` 是恒等转换；不支持的逆向或跨代数转换由类型系统和运行时共同拒绝。

## 4. 取消与 host 生命周期

```ts
const pipeline = createPipeline<string>({
  mode: MiddlewarePipelineMode.async,
  signal: application.signal,
  assertActive: () => host.assertActive()
})

await pipeline.run(stages, payload, consume, { signal: request.signal })
```

四种 mode 都在进入 `run()`、每个 stage 开始前、每个 stage 返回后以及调用 `done` 前检查取消；generator 与 async-generator 还会在每次迭代后检查。已开始的 stage 不会被强制打断，应从收到的 `context.signal` 协作退出；原生 stage 与经 `lift()` 提升的 stage 收到同一个本次运行 signal。

取消错误保留原生类型、reason、`source`、`code` 和错误链。用户代码已经抛出或拒绝普通失败时，该失败保持为主错误，后续取消检查不会替换它。async stage 与下游分别出现两个独立普通失败时，仍由 `combineStageAndDownstreamError` 组合，未提供组合器时产生 `EXECUTION_FAILED`。pipeline 不拥有 controller，也不关闭 host；创建与处置这些资源仍是调用方职责。

`assertActive` 抛出的错误原样传播。它用于复用 host 已有的 generation、lease 或 scope 规则，而不是在本包中重新实现生命周期。

## 5. 违约处理

```ts
const violations: string[] = []
const pipeline = createPipeline<number>({
  mode: MiddlewarePipelineMode.sync,
  onViolation: (kind) => violations.push(kind)
})
```

- `duplicate`：同一 stage 对同一个 `next()` 调用超过一次。
- `late`：stage 已返回后才调用其 `next()`。

违约回调负责报告，不改变流水线的既有主错误。若回调本身抛错，该错误按当前执行模式的同步或异步规则传播。

## 6. 公开类型与常量

根入口公开：

- `createPipeline` 与 `ICreatePipelineOptions`。
- `IMiddlewarePipeline`、`IMiddlewarePipelineStage`、`IMiddlewarePipelineDone`、`IMiddlewarePipelineRunResult`、`IMiddlewarePipelineLiftSource`。
- 四种 stage 类型，以及 context、control、abort-signal 类型。
- `MiddlewarePipelineMode`、`MiddlewarePipelineViolation`、`MiddlewarePipelineGeneratorSignals` 和三个 generator sentinel。
- `MiddlewarePipelineErrorCode`、`IMiddlewarePipelineErrorCode`、`MIDDLEWARE_PIPELINE_SOURCE`。

具体执行器与适配器仅供包内调度，根入口不导出。消费者应通过 `createPipeline()` 切换模式和提升 stage。
