import type { ICaseDoc, IText } from './contract.js'

/** Stores task descriptions beside bilingual runnable code and exact observable results. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Examples enter through the public factory and preserve each execution mode’s semantics. */
export const middlewarePipelineCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createPipeline: [
    {
      title: t('Pass a transformed value through reusable steps', '让多个步骤依次处理同一个值'),
      problem: t(
        'Validation and formatting steps get copied between entry points, then one entry produces a different result because it runs them in another order.\n\nHandwritten entry points each maintain their own sequence of function calls. Updating one copy leaves the others unchanged, so the same input no longer follows the same transformations.\n\nCreate a `sync` pipeline and pass the chosen steps to `run()` in order. Each step calls `next(value)` to record the value for the following step; downstream starts after the current step returns, and the final callback receives the result.',
        '校验、格式化步骤被复制到多个入口，某个入口却得到了不同结果，因为它改变了步骤顺序。\n\n手写时，各个入口分别维护一串函数调用。修改其中一个副本后，其余副本没有同步，同一份输入就不再经过相同的处理过程。\n\n创建 `sync` 流水线，把选定的步骤按顺序交给 `run()`。每个步骤调用 `next(value)` 记录要传给下一步的值；当前步骤返回后下游才开始，终点回调收到最终结果。'
      ),
      example: {
        en: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })\npipeline.run(\n  [\n    (value, next) => next(value + 1),\n    (value, next) => next(value * 2)\n  ],\n  2,\n  (value) => { console.log('result:', value) }\n)",
        zh: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })\npipeline.run(\n  [\n    (value, next) => next(value + 1),\n    (value, next) => next(value * 2)\n  ],\n  2,\n  (value) => { console.log('结果:', value) }\n)"
      },
      result: t(
        'Prints `result: 6`: the input 2 becomes 3, then 6.\n\nThe output shows that the steps transform the value in the supplied order before the final callback receives it. In `sync` mode, `run()` returns `void`; a step that does not call `next()` stops before later steps and the final callback.',
        '输出 `结果: 6`：输入 2 先变成 3，再变成 6。\n\n这说明步骤按传入顺序处理同一个值，终点回调收到处理后的结果。`sync` 模式的 `run()` 返回 `void`；步骤不调用 `next()` 时，后续步骤和终点回调都不会执行。'
      )
    },
    {
      title: t('Finish surrounding work after downstream completes', '下游完成后再执行外层收尾'),
      problem: t(
        'A request timer stops while validation or saving is still running, so the recorded duration misses part of the request.\n\nA handwritten callback chain starts downstream work without returning or awaiting its Promise. The outer function reaches its finalizer before the asynchronous work finishes.\n\nIn `async` mode, `next()` starts downstream and returns its Promise. Await it inside `try/finally` so outer cleanup follows downstream completion; this before-and-after nesting is the onion model.',
        '请求中的校验或保存还没完成，计时器就停止了，记录的耗时漏掉了一部分请求工作。\n\n手写回调链启动下游后，没有返回或等待它的 Promise。外层函数提前走到收尾代码，异步工作却仍在执行。\n\n`async` 模式的 `next()` 启动下游并返回它的 Promise；在 `try/finally` 中等待它，外层收尾就在下游结束后执行。这种前后包裹的执行方式称为洋葱模型。'
      ),
      example: {
        en: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async })\nconst trace: string[] = []\nawait pipeline.run(\n  [\n    async (value, next) => {\n      trace.push('start timing')\n      try { await next(value + 1) }\n      finally { trace.push('finish timing') }\n    },\n    async (value, next) => {\n      trace.push('validate')\n      await next(value * 2)\n    }\n  ],\n  2,\n  (value) => { trace.push(`result ${value}`) }\n)\nconsole.log(trace.join(' | '))",
        zh: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async })\nconst trace: string[] = []\nawait pipeline.run(\n  [\n    async (value, next) => {\n      trace.push('开始计时')\n      try { await next(value + 1) }\n      finally { trace.push('结束计时') }\n    },\n    async (value, next) => {\n      trace.push('校验')\n      await next(value * 2)\n    }\n  ],\n  2,\n  (value) => { trace.push(`结果 ${value}`) }\n)\nconsole.log(trace.join(' | '))"
      },
      result: t(
        'Prints `start timing | validate | result 6 | finish timing`.\n\nThe outer finalizer runs after the downstream final callback because the stage awaits `next()`. This establishes execution order; it does not undo side effects that already happened.',
        '输出 `开始计时 | 校验 | 结果 6 | 结束计时`。\n\n步骤等待了 `next()`，所以外层收尾发生在下游终点回调之后。这只保证执行顺序，不会撤销已经发生的副作用。'
      )
    },
    {
      title: t('Reuse a sync step without changing its ordering', '复用同步步骤时保留原来的顺序'),
      problem: t(
        'A synchronous normalization step is reused in an async request pipeline, but its code after `next()` unexpectedly runs after downstream work.\n\nRewriting the step as an async callback changes what `next()` does: async `next()` starts downstream immediately, while the original sync step only recorded the next value. The rewrite changes ordering as well as the function shape.\n\nUse `lift(stage, MiddlewarePipelineMode.sync)` on the target pipeline to reuse the sync step. Its `next()` still records a value, and downstream waits until that step returns.',
        '同步规范化步骤被接入异步请求流水线后，`next()` 后的代码却意外跑到了下游之后。\n\n直接把步骤改写成异步回调，会改变 `next()` 的含义：异步 `next()` 立即启动下游，原来的同步步骤却只记录下一个值。这种改写同时改变了函数形式和执行顺序。\n\n在目标流水线上调用 `lift(stage, MiddlewarePipelineMode.sync)`，复用原来的同步步骤。它的 `next()` 仍只记录值，当前步骤返回后下游才开始。'
      ),
      example: {
        en: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<string>({ mode: MiddlewarePipelineMode.async })\nconst trim = pipeline.lift((value, next) => {\n  console.log('sync before next')\n  next(value.trim())\n  console.log('sync after next')\n}, MiddlewarePipelineMode.sync)\nawait pipeline.run(\n  [trim, async (value, next) => {\n    console.log('async input:', value)\n    await next(value.toUpperCase())\n  }],\n  ' ready ',\n  (value) => { console.log('result:', value) }\n)",
        zh: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<string>({ mode: MiddlewarePipelineMode.async })\nconst trim = pipeline.lift((value, next) => {\n  console.log('同步步骤调用 next 前')\n  next(value.trim())\n  console.log('同步步骤调用 next 后')\n}, MiddlewarePipelineMode.sync)\nawait pipeline.run(\n  [trim, async (value, next) => {\n    console.log('异步步骤输入:', value)\n    await next(value.toUpperCase())\n  }],\n  ' ready ',\n  (value) => { console.log('结果:', value) }\n)"
      },
      result: t(
        'Prints `sync before next`, `sync after next`, `async input: ready`, then `result: READY`.\n\nCode after the sync step’s `next()` still precedes downstream, so lifting preserves its linear ordering. Only the documented lift directions are supported; async onion stages cannot be lifted into generator modes.',
        '依次输出 `同步步骤调用 next 前`、`同步步骤调用 next 后`、`异步步骤输入: ready`、`结果: READY`。\n\n同步步骤中 `next()` 后的代码仍先于下游执行，说明提升保留了原来的线性顺序。只支持文档列出的提升方向，异步洋葱步骤不能提升为生成器模式的步骤。'
      )
    },
    {
      title: t(
        'Use a request signal and stop before the next step',
        '采用单次请求的信号，取消后不再进入下游'
      ),
      problem: t(
        'One request needs its own cancellation boundary on a reusable pipeline: the application signal may already be aborted, or the request may be cancelled while its first step runs.\n\nChecking only an application-wide signal mixes the lifetimes of separate runs. It can reject an active request or miss that request’s later cancellation before downstream work starts.\n\nPass `control.signal` to `run()` to override the default for this run. Stages receive that same signal through `context.signal`, and the pipeline checks it before entering downstream work.',
        '可复用流水线中的某次请求需要自己的取消边界：应用信号可能已经取消，请求也可能在第一个步骤执行时才被取消。\n\n只检查应用级信号，会把不同运行的生命周期混在一起。仍然有效的请求可能被拒绝，请求后来发生的取消也可能没有在进入下游前被发现。\n\n把 `control.signal` 传给 `run()`，覆盖本次运行的默认信号。步骤在 `context.signal` 中收到同一个信号，流水线会在进入下游之前检查它。'
      ),
      example: {
        en: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst application = new AbortController()\napplication.abort(new Error('application stopped'))\nconst request = new AbortController()\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async, signal: application.signal })\nlet completed = false\ntry {\n  await pipeline.run([\n    async (value, next, context) => {\n      console.log('request signal:', context?.signal === request.signal)\n      request.abort(new Error('request cancelled'))\n      await next(value + 1)\n    }\n  ], 1, () => { completed = true }, { signal: request.signal })\n} catch (error) {\n  console.log('failure:', (error as Error).message)\n}\nconsole.log('final callback:', completed)",
        zh: "import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'\n\nconst application = new AbortController()\napplication.abort(new Error('应用已停止'))\nconst request = new AbortController()\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async, signal: application.signal })\nlet completed = false\ntry {\n  await pipeline.run([\n    async (value, next, context) => {\n      console.log('采用请求信号:', context?.signal === request.signal)\n      request.abort(new Error('请求已取消'))\n      await next(value + 1)\n    }\n  ], 1, () => { completed = true }, { signal: request.signal })\n} catch (error) {\n  console.log('失败:', (error as Error).message)\n}\nconsole.log('终点回调执行:', completed)"
      },
      result: t(
        'Prints `request signal: true`, `failure: request cancelled`, then `final callback: false`.\n\nThe request signal overrides an already-aborted default, and its later abort prevents the final callback. Cancellation is cooperative: running user code is not forcibly interrupted, and the caller owns both controllers.',
        '依次输出 `采用请求信号: true`、`失败: 请求已取消`、`终点回调执行: false`。\n\n请求信号覆盖了已经取消的默认信号，随后取消请求又阻止了终点回调。取消需要代码协作：已经运行的用户代码不会被强行打断，两个控制器都由调用方持有。'
      )
    }
  ],
  GENERATOR_HALT: [
    {
      title: t(
        'Stop a generator pipeline before a rejected value is saved',
        '生成器校验不通过时停止保存'
      ),
      problem: t(
        'A generator validator detects an invalid value, but the save stage still runs and attempts to store it.\n\nReturning the rejected value from a handwritten generator chain still looks like a successful transformation. Without a separate stop signal, the next stage cannot distinguish rejection from normal data.\n\nReturn `GENERATOR_HALT` to stop the whole generator pipeline explicitly. Later stages and the final callback are skipped; sync and async callback stages instead stop by not calling `next()`.',
        '生成器校验已经发现值不合法，保存步骤却仍然执行，尝试写入这份无效数据。\n\n手写生成器链时，直接返回被拒绝的值，仍然像一次成功的数据转换。没有单独的停止信号，下一步就无法把校验失败和正常数据区分开。\n\n返回 `GENERATOR_HALT`，可以明确停止整条生成器流水线，跳过后续步骤和终点回调；同步或异步回调步骤则通过不调用 `next()` 来停止。'
      ),
      example: {
        en: "import { createPipeline, MiddlewarePipelineMode, GENERATOR_HALT } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })\nlet written = false\nlet completed = false\npipeline.run([\n  function* (value) { return value < 0 ? GENERATOR_HALT : value },\n  function* (value) { written = true; return value }\n], -1, () => { completed = true })\nconsole.log('write ran:', written)\nconsole.log('final callback:', completed)",
        zh: "import { createPipeline, MiddlewarePipelineMode, GENERATOR_HALT } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })\nlet written = false\nlet completed = false\npipeline.run([\n  function* (value) { return value < 0 ? GENERATOR_HALT : value },\n  function* (value) { written = true; return value }\n], -1, () => { completed = true })\nconsole.log('写入步骤执行:', written)\nconsole.log('终点回调执行:', completed)"
      },
      result: t(
        'Prints `write ran: false` and `final callback: false`.\n\nReturning the halt symbol prevents both the save stage and final callback. This default constant is for generator modes; a custom `signals` set uses its own `halt` symbol.',
        '输出 `写入步骤执行: false` 和 `终点回调执行: false`。\n\n停止控制符同时阻止了保存步骤和终点回调。这个默认常量用于生成器模式；配置自定义 `signals` 时，应返回它自己的 `halt` 符号。'
      )
    }
  ],
  GENERATOR_UNDEFINED: [
    {
      title: t(
        'Deliver undefined instead of accidentally halting',
        '把 undefined 交给终点，而不是意外终止'
      ),
      problem: t(
        'Clearing a cached value needs to deliver a real `undefined` payload, but the final callback never receives it from a generator step.\n\nA generator’s plain `return undefined` means stop. Using that same return for an intentional empty payload loses the distinction between delivering data and halting.\n\nReturn `GENERATOR_UNDEFINED` to request delivery of `undefined` rather than stopping. Declare a pipeline payload type that includes `undefined` so downstream can accept that value.',
        '清空缓存时需要交付真正的 `undefined`，终点回调却始终收不到生成器步骤中的这个值。\n\n生成器直接 `return undefined` 表示停止。把同一种返回值也用于有意交付空值，就无法区分交付数据和终止运行。\n\n返回 `GENERATOR_UNDEFINED`，明确要求交付 `undefined` 而不是停止；同时把 `undefined` 加进流水线的载荷类型，让下游能够接收这个值。'
      ),
      example: {
        en: "import { createPipeline, MiddlewarePipelineMode, GENERATOR_UNDEFINED } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<string | undefined>({ mode: MiddlewarePipelineMode.generator })\nlet ordinaryCompleted = false\npipeline.run([function* () { return undefined }], 'cached', () => { ordinaryCompleted = true })\nconsole.log('ordinary return completes:', ordinaryCompleted)\npipeline.run([function* () { return GENERATOR_UNDEFINED }], 'cached', (value) => {\n  console.log('explicit empty value delivered:', value === undefined)\n})",
        zh: "import { createPipeline, MiddlewarePipelineMode, GENERATOR_UNDEFINED } from '@migaia/middleware-pipeline'\n\nconst pipeline = createPipeline<string | undefined>({ mode: MiddlewarePipelineMode.generator })\nlet ordinaryCompleted = false\npipeline.run([function* () { return undefined }], '缓存值', () => { ordinaryCompleted = true })\nconsole.log('普通返回会完成:', ordinaryCompleted)\npipeline.run([function* () { return GENERATOR_UNDEFINED }], '缓存值', (value) => {\n  console.log('显式空值仍交付:', value === undefined)\n})"
      },
      result: t(
        'Prints `ordinary return completes: false`, then `explicit empty value delivered: true`.\n\nThe explicit-undefined symbol delivers `undefined` rather than becoming the payload, while an ordinary undefined return stops. It is used only by generator and async-generator modes; a custom signal set supplies its own `undefined` symbol.',
        '输出 `普通返回会完成: false`，然后是 `显式空值仍交付: true`。\n\n显式空值控制符会交付 `undefined`，控制符本身不会作为数据传出，普通的空值返回则停止运行。它只用于生成器和异步生成器模式，自定义信号组使用自己的 `undefined` 符号。'
      )
    }
  ]
}
