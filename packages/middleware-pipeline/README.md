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

同步 stage 不调用 `next()` 时短路。同步模式是线性 reduce：`next()` 只提交值，stage 返回后才执行下游。异步模式保留洋葱模型：`next()` 立即启动下游并返回同一个下游 Promise。

## 选择模式

```ts
const sync = createPipeline<string>({ mode: MiddlewarePipelineMode.sync })
const async = createPipeline<string>({ mode: MiddlewarePipelineMode.async })
const generator = createPipeline<string>({ mode: MiddlewarePipelineMode.generator })
const asyncGenerator = createPipeline<string>({
  mode: MiddlewarePipelineMode.asyncGenerator
})
```

| `mode` | stage | `run()` 返回值 | 下游何时开始 |
| --- | --- | --- | --- |
| `sync` | `(value, next, context?) => void` | `void` | stage 返回后；`next()` 只提交值 |
| `async` | `(value, next, context?) => void \| Promise<void>` | `Promise<void>` | 调用 `next()` 时（洋葱模型） |
| `generator` | generator function | `void` | stage 结束后 |
| `async-generator` | async generator function | `Promise<void>` | stage 结束后 |

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

提升不改变 sync stage 的线性 reduce 语义：在任何目标模式中，sync stage 里写在 `next()` 之后的代码总是先于下游执行；stage 抛错时下游不启动。

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

`GENERATOR_CONTINUE` 采用最后一次 `yield` 的值继续；`GENERATOR_HALT` 终止整条流水线；`GENERATOR_UNDEFINED` 用于把 `undefined` 作为显式终值。也可以在构造时通过 `signals` 注入兼容的三个 sentinel：必须为互不相同的 symbol，构造时只读取一次并快照，后续修改调用方对象不影响管道。

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
- Error reason 尽量保留原生类型/对象；未分类 Error 附 ABORTED，已有外部 source/code 不改写；primitive/undefined reason 用普通 Error/ABORTED 的 cause 保留，未必是原生 AbortError。
- 四种 mode 都在进入 `run()`、每个 stage 开始前、每个 stage 返回后以及 `done` 前检查 signal；generator 类还会在每次迭代后检查。
- 已开始的 stage 不会被强制打断；它可以从 `context.signal` 读取本次运行实际采用的 signal 并协作退出。
- 用户代码已经抛出普通失败时，该失败保持为主错误，之后观察到的取消不会替换它；async stage 与下游分别失败时仍按组合器或 `EXECUTION_FAILED` 处理。
- `assertActive` 在入口和每个 stage 之后执行，生命周期由 host 拥有。
- 同一 stage 重复或返回后调用 `next()` 会报告 `duplicate` 或 `late`；默认处理器为空操作。
- 同步与 generator 模式在调用栈内抛错；异步与 async-generator 模式返回 rejected Promise。

## 公开入口

根入口公开 `createPipeline`、`MiddlewarePipelineMode`、generator 信号、stage/control/context 类型，以及 `MiddlewarePipelineErrorCode` 与 `MIDDLEWARE_PIPELINE_SOURCE`。模式的具体执行器和适配器属于包内实现，不是根入口 API。

完整契约和更多示例见 [USEGUIDE.md](./USEGUIDE.md)。

自定义 generator 控制集也用于 sync lift 的 halt/continue，控制 symbol 不作为 payload 送到 done。公开 IGeneratorMiddlewareStage/IAsyncGeneratorMiddlewareStage 与 IMiddlewarePipeline/IMiddlewarePipelineStage 的 TSignals 参数将控制域与 TValue 分开；提供自定义 signals 的工厂重载接受该控制集，number payload 仍为 number。默认控制集保留精确 unique symbol 类型，GENERATOR_UNDEFINED 仍要求 TValue 包含 undefined。

async 洋葱返回时每个外层 stage 都复核取消/host active，包括 done 已执行的情况；这不会撤销已发生的 done。await next 传播的同一个对象失败只保留一次（相等的 primitive 值仍可能代表独立失败，保持组合），不制造两个相同 entries 的 AggregateError。独立 stage/downstream 失败才组合；combiner 自身抛错时，其原错误尽量作为 primary，两已发生错误在 errors/cause 链可达。成功返回的自定义组合结果仍需由调用方履行 cause 可达合同。

IMiddlewarePipelineSyncMode 仅是 Done/RunResult 的包内条件类型中间项，已从根入口撤回。消费者使用公开 IMiddlewarePipelineDone/IMiddlewarePipelineRunResult，无兼容 alias。
