# `@migaia/middleware-pipeline`

[English](./README.en.md)

`@migaia/middleware-pipeline` 把校验、转换和前后收尾拆成可复用步骤，用明确的继续、短路与取消规则按顺序执行。

## 你可能遇到过

- **异步任务没结束，计时和收尾已经完成**：手写回调链没有把下游 Promise 交回外层等待。
- **复用同步步骤后，next 后面的代码顺序变了**：为了接入异步流程，改写时混淆了“提交值”和“立即执行下游”。
- **请求已取消，下一步仍开始执行**：复用的流水线只检查应用默认信号，没有采用本次请求的信号。
- **校验拒绝了值，保存步骤仍然运行**：生成器返回了业务值，没有明确选择整链短路。
- **清空缓存时，终点回调却没有执行**：生成器把普通 undefined 返回当成了结束，而不是要交付的空值。

## 为什么选它

- **外层可以等待并包裹整个下游。** 手写回调容易在异步结束前收尾；async 模式的 next 返回下游原 Promise，[计时示例](./USEGUIDE.md#下游完成后再执行外层收尾)把收尾留到终点之后。
- **同步步骤提升后仍保持同步顺序。** 直接改成异步回调可能改变 next 后面的代码时序；lift 保留“先返回、再下游”的规则，[复用示例](./USEGUIDE.md#复用同步步骤时保留原来的顺序)展示了这个顺序。
- **每次运行可以选择自己的取消边界。** 只看应用默认信号会遗漏请求取消；run 的 `control.signal` 覆盖默认值并传给步骤，[取消示例](./USEGUIDE.md#采用单次请求的信号取消后不再进入下游)阻止了终点回调。
- **生成器可以明确停止整条链。** 把校验失败的值继续返回会让保存照常执行；`GENERATOR_HALT` 是独立控制符，[短路示例](./USEGUIDE.md#生成器校验不通过时停止保存)没有执行保存或终点。
- **空值与结束有不同含义。** 普通 return undefined 会停止生成器链；`GENERATOR_UNDEFINED` 明确交付 undefined，[空值示例](./USEGUIDE.md#把-undefined-交给终点而不是意外终止)的终点仍收到空值。

## 从这里开始

用 Node 24 直接运行。输入 2 先加 1，再乘 2；终点回调收到 6。next 是当前步骤把新值交给后续步骤的函数。

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

遇到异步前后收尾看[包裹下游](./USEGUIDE.md#下游完成后再执行外层收尾)，需要复用同步步骤看[lift](./USEGUIDE.md#复用同步步骤时保留原来的顺序)。

## 手写时的隐患

下面仅展示，不运行。它手写同一组数值转换，但没有区分同步继续时序，也没有限制 next 只能调用一次。

```ts doc-test=check
type IManualStage = (value: number, next: (value: number) => void) => void
const stages: IManualStage[] = [
  (value, next) => {
    next(value + 1) // 隐患 1：立即递归，下游在这个同步步骤返回前就执行了。
    console.log('当前步骤尾部')
    next(value + 100) // 隐患 2：重复调用会让下游和终点再次执行。
  },
  (value, next) => next(value * 2)
]
const run = (index: number, value: number): void => {
  const stage = stages[index]
  if (stage) stage(value, (nextValue) => run(index + 1, nextValue))
  else console.log('结果:', value)
}
run(0, 2)
```

上一节的 sync 模式只提交第一次 next 的值，当前步骤正常返回后才执行下游。重复或迟到的 next 会交给 `onViolation`，默认不重新执行下游；需要记录这些错误调用时显式提供回调。

## 三分钟心智模型

| 你要回答的问题                       | 选择                                    |
| ------------------------------------ | --------------------------------------- |
| 按顺序转换值，不等待异步？           | sync；next 只提交值。                   |
| 要等待下游，再做外层收尾？           | async；await next 后继续收尾。          |
| 一个步骤需要多次 yield，再决定终值？ | generator；异步迭代用 async-generator。 |
| 要复用另一种模式的现有步骤？         | lift，先核对允许方向。                  |
| 请求取消后不再进入下一步？           | run 的 `control.signal`，步骤协作退出。 |

| 术语     | 白话含义                                       |
| -------- | ---------------------------------------------- |
| pipeline | 执行规则固定、可以重复使用的步骤执行器。       |
| stage    | 处理当前值的一步；决定继续、停止或失败。       |
| next     | 提交下一步的输入；异步模式还返回下游 Promise。 |
| done     | 所有步骤都继续后，接收最终值的终点回调。       |
| 洋葱模型 | 外层先进入，等待下游完成后再收尾。             |
| sentinel | 表示继续、停止或显式空值的专用 symbol。        |

## 典型场景

| 场景                                   | 怎么组合                          | 详细说明                                                       |
| -------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| 让多个步骤依次处理同一个值             | `sync + run`                      | [完整示例](./USEGUIDE.md#让多个步骤依次处理同一个值)           |
| 下游完成后再执行外层收尾               | `async + await next`              | [完整示例](./USEGUIDE.md#下游完成后再执行外层收尾)             |
| 复用同步步骤时保留原来的顺序           | `lift(sync) + async run`          | [完整示例](./USEGUIDE.md#复用同步步骤时保留原来的顺序)         |
| 采用单次请求的信号，取消后不再进入下游 | `run + control.signal`            | [完整示例](./USEGUIDE.md#采用单次请求的信号取消后不再进入下游) |
| 生成器校验不通过时停止保存             | `generator + GENERATOR_HALT`      | [完整示例](./USEGUIDE.md#生成器校验不通过时停止保存)           |
| 把 undefined 交给终点，而不是意外终止  | `generator + GENERATOR_UNDEFINED` | [完整示例](./USEGUIDE.md#把-undefined-交给终点而不是意外终止)  |

## 安装

```bash
pnpm add @migaia/middleware-pipeline
```

只有根入口；运行时仅依赖 `@migaia/utils`，无需 DOM 或 Node，包标记为 `sideEffects: false`。

## 常用 API

| API                                           | 作用                                               |
| --------------------------------------------- | -------------------------------------------------- |
| `createPipeline(options)`                     | 固定模式、取消默认值与错误处理，返回可复用执行器。 |
| `pipeline.run(stages, value, done, control?)` | 为一次输入执行固定快照的步骤列表。                 |
| `pipeline.lift(stage, from)`                  | 在允许方向复用已有步骤，不改原模式语义。           |

## 契约细节

pipeline 只含只读 mode、lift 和 run，自身没有可变运行状态。每次 run 的值、索引和取消上下文隔离；stage 列表在入口复制，之后修改调用方数组不会改写当前轮。构造选项和自定义信号字段只读取一次并冻结，getter 失败以 `INVALID_OPTION` 保留原始原因。

四种模式是 sync、async、generator、async-generator。同步 next 只提交值，stage 返回后下游才开始；不调用就短路。异步 next 立即启动下游并返回同一个下游 Promise，即使 stage 没有 await，runner 也等待已经启动的下游。同步和 generator 同步抛错，async 和 async-generator 的 run 返回 Promise。

lift 只允许同模式、sync 到 async/generator/async-generator，以及 generator 到 async-generator；不支持 async 到 async-generator。同模式保持函数身份。被提升的 sync 步骤仍先执行完 next 后的同步代码再进入下游，抛错时不启动下游。

生成器普通 return 值继续，`GENERATOR_CONTINUE` 使用最后一个 yield（没有 yield 时使用输入），`GENERATOR_HALT` 和隐式 undefined 终止，`GENERATOR_UNDEFINED` 显式以 undefined 继续且要求 `TValue` 包含 undefined。自定义三个 symbol 必须互不相同，在创建时快照，也用于 sync lift；控制符不作为业务值传到 done。公开类型的 `TSignals` 与 `TValue` 分离，默认控制集保留精确 unique symbol 类型。

run 的 `control.signal` 覆盖构造 signal；未提供时回退。只有有效信号存在时才向 stage/done 追加 context。四种模式在入口、每步开始前/返回后、done 前检查取消；生成器每次迭代后也检查。已开始的用户代码不会被强制打断。`assertActive` 复用宿主规则，入口和每步后检查；异步外层返回时即使 done 已执行也复核，但不会撤销已发生的 done。控制器和宿主仍由调用方持有。

同一步重复或结束后调用 next 分别报告 duplicate、late，默认回调为空操作。原生 Error 尽量保留类型、身份与 stack；未分类执行失败附 `EXECUTION_FAILED`，已有完整外部 source/code 不覆盖。取消 reason 使用 `ABORTED`；其他值通过 cause 保留，不保证是原生 AbortError。普通业务失败不会被之后的取消替换。

独立 stage/downstream 失败默认聚合，或交给 `combineStageAndDownstreamError`；await next 传播的同一个对象只保留一次，相等 primitive 仍可能独立。组合器自身失败时保留它和两个原错；组合器成功返回的自定义结果需要调用方履行原错可达契约。生成器取消时驱动 finally 清理；清理再次失败使用 `ABORT_CLEANUP_FAILED`，取消主错在前。

根入口公开工厂、模式、生成器信号与阶段/控制/上下文类型，以及错误码和 source；具体执行器和适配器不公开。`IAbortSignal` 从 `@migaia/utils/promise` 导入；`IMiddlewarePipelineSyncMode` 只是包内中间类型，已从根入口撤回，没有兼容别名，使用 `IMiddlewarePipelineDone`/`IMiddlewarePipelineRunResult`。完整字段、模式表、提升矩阵和四个错误码见[使用指南](./USEGUIDE.md#创建选项及全部默认值)。
