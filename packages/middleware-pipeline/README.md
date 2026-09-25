# @migaia/middleware-pipeline

运行时中立的中间件流水线。一个入口 `createPipeline()` 通过 `mode` 选择同步、异步、生成器或异步生成器执行代数；pipeline 本身无可变运行状态，可以安全复用。

## 安装

```bash
pnpm add @migaia/middleware-pipeline
```

## 快速开始

```ts
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })

pipeline.run(
  [
    (value, next) => next(value + 1),
    (value, next) => next(value * 2)
  ],
  2,
  (result) => console.log(result) // 6
)
```

同步 stage 不调用 `next()` 时短路。异步模式保留洋葱模型：`next()` 立即启动下游并返回同一个下游 Promise。

## 选择模式

```ts
const sync = createPipeline<string>({ mode: MiddlewarePipelineMode.sync })
const async = createPipeline<string>({ mode: MiddlewarePipelineMode.async })
const generator = createPipeline<string>({ mode: MiddlewarePipelineMode.generator })
const asyncGenerator = createPipeline<string>({
  mode: MiddlewarePipelineMode.asyncGenerator
})
```

| `mode` | stage | `run()` 返回值 |
| --- | --- | --- |
| `sync` | `(value, next, context?) => void` | `void` |
| `async` | `(value, next, context?) => void \| Promise<void>` | `Promise<void>` |
| `generator` | generator function | `void` |
| `async-generator` | async generator function | `Promise<void>` |

`mode` 是只读属性，调用方可用它记录或检查当前代数。每次 `run()` 相互隔离。

## 提升 stage

`lift(stage, from)` 只允许无损方向：

| 目标模式 | 允许的来源 |
| --- | --- |
| `sync` | `sync` |
| `async` | `sync`、`async` |
| `generator` | `sync`、`generator` |
| `async-generator` | `sync`、`generator`、`async-generator` |

```ts
const pipeline = createPipeline<string>({ mode: MiddlewarePipelineMode.async })
const trim = pipeline.lift((value, next) => next(value.trim()), MiddlewarePipelineMode.sync)

await pipeline.run([trim], '  ready  ', async (result) => {
  console.log(result) // ready
})
```

不支持的方向在运行时抛出带 `source` 与 `code` 的原生 `TypeError`，同时也会被类型系统拒绝。

## Generator 信号

```ts
import {
  createPipeline,
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  MiddlewarePipelineMode
} from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })

pipeline.run(
  [
    function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    },
    function* () {
      return GENERATOR_HALT
    }
  ],
  1,
  () => {
    throw new Error('halt 后不会到达 done')
  }
)
```

`GENERATOR_CONTINUE` 采用最后一次 `yield` 的值继续；`GENERATOR_HALT` 终止整条流水线；`GENERATOR_UNDEFINED` 用于把 `undefined` 作为显式终值。也可以在构造时通过 `signals` 注入兼容的三个 sentinel。

## 生命周期、取消与违约

```ts
const controller = new AbortController()
const pipeline = createPipeline<string>({
  mode: MiddlewarePipelineMode.async,
  signal: controller.signal,
  assertActive: () => host.assertActive(),
  onViolation: (kind) => diagnostics.report(kind),
  combineStageAndDownstreamError: (stage, downstream) =>
    new AggregateError([stage, downstream], 'middleware stage and downstream failed')
})

await pipeline.run(stages, input, consume, { signal: request.signal })
```

- `run()` 的 `control.signal` 优先于构造时的 `signal`。
- 已取消的 signal 会保留原始 reason 与原生 AbortError 语义。
- 四种 mode 都在进入 `run()`、每个 stage 开始前、每个 stage 返回后以及 `done` 前检查 signal；generator 类还会在每次迭代后检查。
- 已开始的 stage 不会被强制打断；它可以从 `context.signal` 读取本次运行实际采用的 signal 并协作退出。
- 用户代码已经抛出普通失败时，该失败保持为主错误，之后观察到的取消不会替换它；async stage 与下游分别失败时仍按组合器或 `EXECUTION_FAILED` 处理。
- `assertActive` 在入口和每个 stage 之后执行，生命周期由 host 拥有。
- 同一 stage 重复或返回后调用 `next()` 会报告 `duplicate` 或 `late`；默认处理器为空操作。
- 同步与 generator 模式在调用栈内抛错；异步与 async-generator 模式返回 rejected Promise。

## 公开入口

根入口公开 `createPipeline`、`MiddlewarePipelineMode`、generator 信号、stage/control/context 类型，以及 `MiddlewarePipelineErrorCode` 与 `MIDDLEWARE_PIPELINE_SOURCE`。模式的具体执行器和适配器属于包内实现，不是根入口 API。

完整契约和更多示例见 [USEGUIDE.md](./USEGUIDE.md)。
