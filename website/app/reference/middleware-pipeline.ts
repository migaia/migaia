/**
 * Reference documentation of `@migaia/middleware-pipeline`. Rules: `app/reference/contract.ts`.
 * Verified against `packages/middleware-pipeline/src` (create-pipeline.ts, runtime.ts,
 * state-constants.ts, error-code.ts) and README on 2026-10-18.
 */
import type { ILibraryReference, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Scenarios of a pipeline instance. */
const pipelineScenarios = [
  t(
    'A logger runs filter, enrich and format stages before writing one entry.',
    'logger 在写出一条日志前依次执行过滤、补充字段、格式化等步骤。'
  ),
  t(
    'A request client wraps each request in async onion middleware for auth, retry and timing.',
    '请求客户端用异步洋葱中间件包裹每个请求，处理鉴权、重试和计时。'
  ),
  t(
    'A plugin host collects stages from installed plugins and runs them through one pipeline.',
    '插件宿主收集各插件登记的步骤，用同一个 pipeline 执行（`@migaia/plugin-host` 即如此）。'
  )
]

/** End-to-end example of a pipeline instance. */
const pipelineExample = {
  en: `import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

type IRequest = { readonly url: string; headers: Record<string, string> }
const pipeline = createPipeline<IRequest>({ mode: MiddlewarePipelineMode.async })

// A sync stage reused in the async pipeline.
const auth = pipeline.lift((request, next) => {
  request.headers.authorization = 'Bearer token'
  next(request)
}, MiddlewarePipelineMode.sync)

// Onion stage: code after await next() runs after downstream finished.
const timing = async (request: IRequest, next: (value: IRequest) => Promise<void>) => {
  const started = performance.now()
  await next(request)
  console.log(request.url, performance.now() - started, 'ms')
}

await pipeline.run([auth, timing], { url: '/api/users', headers: {} }, async (request) => {
  await fetch(request.url, { headers: request.headers })
})`,
  zh: `import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

type IRequest = { readonly url: string; headers: Record<string, string> }
const pipeline = createPipeline<IRequest>({ mode: MiddlewarePipelineMode.async })

// 把同步步骤提升后放进异步 pipeline 复用
const auth = pipeline.lift((request, next) => {
  request.headers.authorization = 'Bearer token'
  next(request)
}, MiddlewarePipelineMode.sync)

// 洋葱步骤：await next() 之后的代码在下游全部完成后执行
const timing = async (request: IRequest, next: (value: IRequest) => Promise<void>) => {
  const started = performance.now()
  await next(request)
  console.log(request.url, performance.now() - started, 'ms')
}

await pipeline.run([auth, timing], { url: '/api/users', headers: {} }, async (request) => {
  await fetch(request.url, { headers: request.headers })
})`
}

/** Reference of `@migaia/middleware-pipeline`. */
export const middlewarePipelineReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'The only entry point. `createPipeline({ mode })` returns a stateless runner for one of four execution modes; stages are plain functions passed to `run()`. Also exports the generator control signals, mode and violation constants, and error codes.',
        '唯一入口。`createPipeline({ mode })` 返回某一种执行模式（共四种）的无状态执行器；步骤就是普通函数，每次在 `run()` 时传入。这里还导出生成器控制信号、模式与违规常量以及错误码。'
      ),
      example: `import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
pipeline.run([(value, next) => next(value + 1)], 1, (result) => console.log(result)) // 2`
    }
  },
  symbols: {
    createPipeline: {
      role: 'factory',
      purpose: t(
        'Creates a reusable, stateless middleware runner for one execution mode. The runner owns no stage list: each `run()` receives the stages, the input value and a final callback, so one pipeline can serve many hosts and concurrent runs. A sync/async stage continues by calling `next(value)`. Generator stages must return a payload, the configured continue signal (using the last yield), or the explicit undefined signal; yielding alone followed by an implicit undefined return halts without calling done.',
        '创建某一种执行模式下可复用、无状态的中间件执行器。执行器不保存步骤列表：每次 `run()` 都传入步骤、输入值和终点回调，因此同一个 pipeline 可以服务多个宿主和并发运行。同步或异步步骤调用 `next(value)` 继续；生成器必须返回载荷、采用最后一次产出值的继续信号，或显式空值信号；仅产出后隐式返回 `undefined` 会终止且不调用终点回调。'
      ),
      returns: t(
        'An `IMiddlewarePipeline` for the chosen mode and TSignals control domain, separate from TValue. Options are read once and frozen; invalid values or throwing option getters produce TypeError/INVALID_OPTION with the original getter failure on cause.',
        '返回所选模式及 `TSignals` 控制域的 `IMiddlewarePipeline`，控制信号不扩张 `TValue` 载荷。选项只读取一次并冻结；非法值或读取失败抛 `TypeError/INVALID_OPTION`，读取原错保留在原因上。'
      ),
      options: 'ICreatePipelineOptions',
      example: {
        en: `import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
pipeline.run(
  [(value, next) => next(value + 1), (value, next) => next(value * 2)],
  2,
  (result) => console.log(result) // 6
)`,
        zh: `import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
pipeline.run(
  [(value, next) => next(value + 1), (value, next) => next(value * 2)],
  2,
  (result) => console.log(result) // 输出 6
)`
      },
      scenarios: pipelineScenarios,
      avoid: [
        t(
          'Every handler gets the same value and nobody transforms it: use `@migaia/event-subscriber`.',
          '每个处理者都收到同一个值、互不传递结果：改用 `@migaia/event-subscriber`。'
        )
      ]
    },
    GENERATOR_CONTINUE: {
      role: 'constant',
      purpose: t(
        'Return it from a generator stage to continue with the last value that stage yielded.',
        '在生成器步骤中 `return` 它，表示用该步骤最后一次 yield 的值继续执行下游。'
      ),
      example: `function* (value) {
  yield value + 1
  return GENERATOR_CONTINUE
}`
    },
    GENERATOR_HALT: {
      role: 'constant',
      purpose: t(
        'Return it from a generator stage to stop the whole pipeline; later stages and the final callback do not run.',
        '在生成器步骤中 `return` 它，表示终止整条 pipeline：后续步骤与终点回调都不再执行。'
      ),
      example: `function* (value) {
  if (!value.valid) return GENERATOR_HALT
  yield value
  return GENERATOR_CONTINUE
}`
    },
    GENERATOR_UNDEFINED: {
      role: 'constant',
      purpose: t(
        'Return it from a generator stage when `undefined` itself is the intended final value (a plain `return undefined` cannot be told apart from returning nothing).',
        '当 `undefined` 本身就是想要的结果时，在生成器步骤中 `return` 它（直接 `return undefined` 无法与“没有返回值”区分）。'
      ),
      example: `function* () {
  return GENERATOR_UNDEFINED // 下游收到 undefined
}`
    },
    MIDDLEWARE_PIPELINE_SOURCE: {
      role: 'error',
      purpose: t(
        'The `source` value on every error created by this package (`@migaia/middleware-pipeline`). Compare it before branching on `error.code`.',
        '本包创建的每个错误上都带有的 `source` 值（`@migaia/middleware-pipeline`）。先比较它确认来源，再按 `error.code` 分支。'
      ),
      example: `if ((error as { source?: string }).source === MIDDLEWARE_PIPELINE_SOURCE) console.error(error)`
    },
    MiddlewarePipelineErrorCode: {
      role: 'error',
      purpose: t(
        'Every error code of this package. Errors keep their native type (`TypeError`, `AggregateError`, `AbortError`) and carry `source` and `code`.',
        '本包的全部错误码。错误保留原生类型（`TypeError`、`AggregateError`、`AbortError`），并带有 `source` 与 `code` 字段。'
      ),
      example: `try {
  await pipeline.run(stages, input, done)
} catch (error) {
  if ((error as { code?: string }).code === MiddlewarePipelineErrorCode.executionFailed) console.error((error as AggregateError).errors)
}`
    },
    MiddlewarePipelineGeneratorSignals: {
      role: 'constant',
      purpose: t(
        'The default set of the three generator control signals (`undefined`, `halt`, `continue`) used when the `signals` option is not given.',
        '未设置 `signals` 选项时使用的默认生成器控制信号组（`undefined`、`halt`、`continue`），三者分别就是导出的三个常量。'
      ),
      example: `console.log(MiddlewarePipelineGeneratorSignals.halt === GENERATOR_HALT) // true`
    },
    MiddlewarePipelineMode: {
      role: 'constant',
      purpose: t(
        'The four execution modes accepted by `createPipeline({ mode })`. The mode fixes the stage shape, whether `run()` returns a Promise, and when downstream starts.',
        '`createPipeline({ mode })` 接受的四种执行模式。模式决定步骤的函数形状、`run()` 是否返回 Promise，以及下游何时开始执行。'
      ),
      example: `createPipeline<string>({ mode: MiddlewarePipelineMode.asyncGenerator })`
    },
    MiddlewarePipelineViolation: {
      role: 'constant',
      purpose: t(
        'Kinds of `next()` misuse passed to `onViolation`: calling it twice in one stage, or after the stage already finished.',
        '传给 `onViolation` 的 `next()` 误用类型：同一步骤中调用两次，或在步骤结束后才调用。'
      ),
      example: `createPipeline<number>({
  mode: MiddlewarePipelineMode.async,
  onViolation: (kind) => console.warn('next() 误用', kind)
})`
    }
  },
  types: {
    IMiddlewarePipeline: {
      summary: t(
        'The stateless runner returned by `createPipeline()`. It keeps only the mode and options; stages and values are supplied per run, so runs are isolated from each other.',
        '`createPipeline()` 返回的无状态执行器。它只保存模式与选项；步骤和值在每次运行时传入，因此各次运行互不影响。'
      ),
      scenarios: pipelineScenarios,
      example: pipelineExample,
      members: {
        mode: {
          summary: t(
            'The execution mode chosen at creation (`sync`, `async`, `generator`, `async-generator`); it never changes.',
            '创建时选定的执行模式（`sync`、`async`、`generator`、`async-generator`），之后不会改变。'
          )
        },
        lift: {
          summary: t(
            'Converts a stage written for another mode into this pipeline mode, in lossless directions only: sync into any mode, generator into async-generator. A lifted sync stage keeps its behaviour: code after `next()` still runs before downstream.',
            '把为其它模式编写的步骤转换为当前 pipeline 的模式，只允许无损方向：同步步骤可提升到任意模式，生成器步骤可提升到异步生成器模式。提升后的同步步骤行为不变：`next()` 之后的代码仍先于下游执行。'
          ),
          params: {
            stage: t('The stage to convert.', '要转换的步骤函数。'),
            from: t(
              'Mode the stage was written for (`MiddlewarePipelineMode.*`).',
              '该步骤原本所属的模式（`MiddlewarePipelineMode.*`）。'
            )
          },
          returns: t(
            'A stage of this pipeline mode; same-mode lift preserves the stage. Sync-to-generator adapters use the configured runner halt/continue symbols, so no control symbol reaches done as payload and halt never calls done. Unsupported directions throw INVALID_OPTION.',
            '返回当前模式步骤，同模式转换保留原步骤。同步转生成器适配使用本执行器配置的停止及继续信号，不把控制符作为载荷交给终点回调，停止时不调用终点回调；不支持方向抛 `INVALID_OPTION`。'
          ),
          whenToUse: t(
            'Reuse simple sync stages (trim, validate, tag) in async or generator pipelines.',
            '在异步或生成器 pipeline 中复用简单的同步步骤（去空白、校验、打标签）。'
          ),
          example: `const trim = pipeline.lift((value, next) => next(value.trim()), MiddlewarePipelineMode.sync)`
        },
        run: {
          summary: t(
            'Runs `stages` in order on `value`. Each stage continues by calling `next(value)`; a stage that does not continue stops the run. After the last stage, `done(value)` receives the final value. In `sync` mode `next()` only hands the value over and downstream starts after the stage returns; in `async` mode `next()` starts downstream immediately and returns its Promise (onion model).',
            '按顺序对 `value` 执行 `stages`。步骤调用 `next(value)` 继续，不调用则结束本次运行；最后一个步骤之后，`done(value)` 收到最终值。`sync` 模式下 `next()` 只提交值，步骤返回后下游才开始；`async` 模式下 `next()` 立即启动下游并返回其 Promise（洋葱模型）。'
          ),
          params: {
            stages: t(
              'Stages of this mode (lift others first); read only for this run.',
              '当前模式的步骤（其它模式先用 `lift` 转换），只在本次运行中读取。'
            ),
            value: t('Input value of the first stage.', '第一个步骤的输入值。'),
            done: t(
              'Final callback; not called when a stage stops or a generator returns `GENERATOR_HALT`.',
              '终点回调；步骤中途停止或生成器返回 `GENERATOR_HALT` 时不会调用。'
            ),
            control: t(
              '`signal` for this run; it overrides the creation-time signal and is visible to stages as `context.signal`.',
              '本次运行的 `signal`，优先于创建时的 `signal`，步骤通过 `context.signal` 读取。'
            )
          },
          returns: t(
            '`void` in sync/generator and Promise<void> in async/async-generator. Error cancellation reasons retain native identity when writable; unclassified reasons receive ABORTED, foreign identities stay unchanged, and primitive or undefined reasons use ordinary Error with cause. Every async outer stage checks activity after returning, even after done; rejection does not undo done.',
            '`sync/generator` 返回 `void`，`async/async-generator` 返回 `Promise<void>`。取消原因为可写原生错误时保留身份，未分类原因附 `ABORTED`，外包身份不改写，原始值或 `undefined` 使用带原因的普通 `Error`。异步外层步骤返回后即使终点已执行仍复核存活；拒绝不撤销终点副作用。'
          ),
          example: `const controller = new AbortController()
await pipeline.run(stages, input, async (result) => save(result), { signal: controller.signal })`
        }
      }
    },
    ICreatePipelineOptions: {
      summary: t(
        'Options of createPipeline(); mode is required. Every public option and control getter is read once for its snapshot; getter failure becomes TypeError/INVALID_OPTION with cause. The validated mode is the value published by the runner.',
        '`createPipeline()` 的选项，`mode` 必填；公开选项与运行控制字段单次读取为快照，读取失败抛保留原始原因的 `TypeError/INVALID_OPTION`；发布模式与已验证值相同。'
      ),
      members: {
        mode: {
          summary: t(
            'Execution mode of every run. Stages must be written for this mode or converted with `lift()`.',
            '每次运行使用的执行模式。步骤必须按该模式编写，或用 `lift()` 转换。'
          ),
          values: { enum: 'MiddlewarePipelineMode' }
        },
        onViolation: {
          summary: t(
            'Receives `duplicate` or `late` when a stage misuses `next()`. The misuse never starts a second downstream run.',
            '步骤误用 `next()` 时收到 `duplicate` 或 `late`。误用不会启动第二次下游执行。'
          ),
          default: t('Not set: misuse is ignored silently.', '不设置：误用被静默忽略。'),
          values: { enum: 'MiddlewarePipelineViolation' }
        },
        assertActive: {
          summary: t(
            'Called on entry and after each stage; throwing stops the run before the next stage starts. Hosts use it to stop runs once they are closing.',
            '在进入运行时以及每个步骤之后调用；它抛错时，下一个步骤不会开始。宿主用它在关闭后阻止继续运行。'
          ),
          default: t('Not set: no lifecycle check.', '不设置：不做生命周期检查。')
        },
        signal: {
          summary: t(
            'Default cancellation signal for every run; checked on entry, before and after each stage and before `done`. A run-level `signal` overrides it.',
            '每次运行默认使用的取消信号；在进入时、每个步骤前后以及 `done` 之前检查。运行时传入的 `signal` 优先。'
          ),
          default: t(
            'Not set: runs cannot be cancelled unless `run()` passes a signal.',
            '不设置：除非 `run()` 传入信号，否则运行不能被取消。'
          )
        },
        signals: {
          summary: t(
            'Replacement generator control signals `{ undefined, halt, continue }` for hosts with their own sentinels; three distinct symbols, read once at creation.',
            '为拥有自己哨兵值的宿主替换生成器控制信号 `{ undefined, halt, continue }`；必须是三个互不相同的 symbol，只在创建时读取一次。'
          ),
          default: t(
            '`MiddlewarePipelineGeneratorSignals` (the exported `GENERATOR_*` symbols).',
            '`MiddlewarePipelineGeneratorSignals`，即导出的三个 `GENERATOR_*` symbol。'
          ),
          example: `import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
const signals = { undefined: Symbol('undefined'), halt: Symbol('halt'), continue: Symbol('continue') }
const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator, signals })
const increment = pipeline.lift((value, next) => { next(value + 1) }, MiddlewarePipelineMode.sync)
const halt = pipeline.lift(() => {}, MiddlewarePipelineMode.sync)
pipeline.run([increment], 1, (value) => { console.log(value) })
pipeline.run([halt], 1, () => { console.log('not reached') })`
        },
        combineStageAndDownstreamError: {
          summary: t(
            'Only in async onion mode, combines independent stage and downstream failures. The same object propagated through await next is thrown once without calling the combiner; equal primitive values can still be independent failures. A successful custom result must retain both errors through cause/errors. If the combiner throws, its failure stays primary with both originals reachable.',
            '仅在 `async` 洋葱模式组合步骤与下游的独立失败。同一对象经 `await next` 传播只抛一次且不调用组合器，相等原始值仍可能是独立失败。成功返回的自定义结果须经原因或错误列表保留两原错；组合器抛错时以其失败为主且两原错可追溯。'
          ),
          default: t(
            'Not set: an `AggregateError` with code `EXECUTION_FAILED` holds both errors.',
            '不设置：抛出带 `EXECUTION_FAILED` 码的 `AggregateError`，两个错误都在 `errors` 中。'
          )
        }
      }
    },
    IMiddlewarePipelineContext: {
      summary: t(
        'Optional run context: third argument of sync/async stages, second argument of generator/async-generator stages and done. It is supplied only when an effective signal exists.',
        '本次运行可选上下文：同步和异步步骤的第三参数，生成器与异步生成器步骤及终点回调的第二参数；仅存在有效信号时传入。'
      ),
      members: {
        signal: {
          summary: t(
            'The signal this run actually uses (run-level first, then creation-time); pass it to your own I/O to stop early.',
            '本次运行实际使用的信号（优先运行时传入的，其次创建时的）；把它传给自己的 I/O 以便提前停止。'
          )
        }
      }
    },
    IMiddlewarePipelineControlOptions: {
      summary: t(
        'Fourth argument of `run()`: per-run controls.',
        '`run()` 的第四个参数：单次运行的控制选项。'
      ),
      members: {
        signal: {
          summary: t(
            'Cancellation signal for this run only; overrides the creation-time signal.',
            '只作用于本次运行的取消信号，优先于创建时的 `signal`。'
          ),
          default: t(
            'Not set: the creation-time `signal` is used, if any.',
            '不设置：使用创建时的 `signal`（如果有）。'
          )
        }
      }
    },
    IGeneratorMiddlewareSignals: {
      summary: t(
        'A set of three generator control symbols.',
        '三个生成器控制 symbol 组成的集合，供替换默认哨兵值使用。'
      ),
      members: {
        undefined: {
          summary: t(
            'Symbol meaning "the final value is `undefined`".',
            '生成器返回它表示“最终值就是 `undefined`”的 symbol。'
          )
        },
        halt: {
          summary: t(
            'Symbol meaning "stop the whole pipeline".',
            '生成器返回它表示“终止整条 pipeline”的 symbol。'
          )
        },
        continue: {
          summary: t(
            'Symbol meaning "continue with the last yielded value".',
            '表示“用最后一次 yield 的值继续”的 symbol。'
          )
        }
      }
    },
    ISyncMiddlewareStage: {
      summary: t(
        'A sync stage `(value, next, context?) => void`. `next(value)` hands the value over; downstream starts after the stage returns.',
        '同步步骤 `(value, next, context?) => void`。`next(value)` 只提交值，步骤返回后下游才开始。'
      ),
      members: {}
    },
    IAsyncMiddlewareStage: {
      summary: t(
        'An async stage `(value, next, context?)`. `next(value)` starts downstream and returns its Promise, so code after `await next()` runs afterwards.',
        '异步步骤 `(value, next, context?)`。`next(value)` 立即启动下游并返回其 Promise，所以 `await next()` 之后的代码在下游完成后执行。'
      ),
      members: {}
    },
    IGeneratorMiddlewareStage: {
      summary: t(
        'Generator stage function* (value, context?). TSignals selects the control symbols without widening TValue; yield stores a candidate, while return chooses payload, continue, halt or explicit undefined. Default GENERATOR_UNDEFINED requires TValue to include undefined.',
        '生成器步骤 `function* (value, context?)`；`TSignals` 选择控制符且不扩张 `TValue`，产出保存候选值，返回决定载荷、继续、停止或显式空值。默认 `GENERATOR_UNDEFINED` 要求载荷包含 `undefined`。'
      ),
      members: {}
    },
    IAsyncGeneratorMiddlewareStage: {
      summary: t(
        'Async generator stage (value, context?) with the same TValue/TSignals separation and return-signal protocol as the synchronous generator; it belongs to async-generator mode.',
        '异步生成器步骤 `(value, context?)`，控制域与载荷分离并遵循同步生成器的返回信号协议，仅用于 `async-generator` 模式。'
      ),
      members: {}
    },
    IMiddlewarePipelineStage: {
      summary: t(
        'The stage type selected from all four mode mappings; TSignals keeps generator controls separate from TValue and defaults to the exported unique-symbol signal set.',
        '从四种模式映射选出步骤类型；`TSignals` 将生成器控制域与 `TValue` 载荷分离，默认使用导出的精确唯一符号信号组。'
      ),
      members: {
        sync: {
          summary: t(
            'Stage type of `sync` mode: `ISyncMiddlewareStage`.',
            '`sync` 模式下步骤函数的类型，即 `ISyncMiddlewareStage`。'
          )
        },
        async: {
          summary: t(
            'Stage type of `async` mode: `IAsyncMiddlewareStage`.',
            '`async` 模式下步骤函数的类型，即 `IAsyncMiddlewareStage`。'
          )
        },
        generator: {
          summary: t(
            'Stage type of `generator` mode: `IGeneratorMiddlewareStage`.',
            '`generator` 模式下步骤函数的类型，即 `IGeneratorMiddlewareStage`。'
          )
        },
        'async-generator': {
          summary: t(
            'The async-generator mapping selects IAsyncGeneratorMiddlewareStage<TValue, TSignals>, preserving the custom control domain.',
            '异步生成器映射选择 `IAsyncGeneratorMiddlewareStage<TValue, TSignals>`，保留自定义控制域。'
          )
        }
      }
    },
    IMiddlewarePipelineLiftSource: {
      summary: t(
        'Modes that `lift()` accepts as the source for each target mode.',
        '每种目标模式下 `lift()` 允许的来源模式。'
      ),
      members: {
        sync: {
          summary: t(
            'Target `sync`: only `sync` stages can be used.',
            '目标模式为 `sync` 时：只能使用 `sync` 步骤，无需提升。'
          )
        },
        async: {
          summary: t(
            'Target `async`: `sync` or `async` stages.',
            '目标模式为 `async` 时：可以使用 `sync` 或 `async` 步骤。'
          ),
          values: {
            sync: t('Lifted; keeps sync ordering.', '会被提升，仍保持同步步骤的执行顺序。'),
            async: t('Used as is.', '原样使用，无需转换。')
          }
        },
        generator: {
          summary: t(
            'Target `generator`: `sync` or `generator` stages.',
            '目标模式为 `generator` 时：可以使用 `sync` 或 `generator` 步骤。'
          ),
          values: {
            sync: t('Lifted into a generator stage.', '会被提升为生成器步骤。'),
            generator: t('Used as is.', '原样使用，无需转换。')
          }
        },
        'async-generator': {
          summary: t(
            'Target async-generator supports sync, generator and async-generator stages; async onion stages cannot be lifted into it.',
            '异步生成器目标支持同步、生成器及异步生成器步骤，不能提升异步洋葱步骤。'
          )
        }
      }
    },
    IMiddlewarePipelineDone: {
      summary: t(
        'Final callback of `run()`; may return a Promise in async modes.',
        '`run()` 的终点回调；异步模式下可以返回 Promise。'
      ),
      members: {}
    },
    IMiddlewarePipelineRunResult: {
      summary: t(
        'Return type of `run()`: `void` in sync modes, `Promise<void>` in async modes.',
        '`run()` 的返回类型：同步模式为 `void`，异步模式为 `Promise<void>`。'
      ),
      members: {}
    },
    IMiddlewarePipelineMode: {
      summary: t(
        'Union of `MiddlewarePipelineMode` values.',
        '`MiddlewarePipelineMode` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IMiddlewarePipelineViolation: {
      summary: t(
        'Union of `MiddlewarePipelineViolation` values.',
        '`MiddlewarePipelineViolation` 全部取值组成的联合类型。'
      ),
      members: {}
    },
    IMiddlewarePipelineViolationHandler: {
      summary: t(
        'Type of the `onViolation` callback.',
        '`onViolation` 回调的类型，参数是违规种类。'
      ),
      members: {}
    },
    IMiddlewarePipelineErrorCode: {
      summary: t(
        'Union of `MiddlewarePipelineErrorCode` values.',
        '`MiddlewarePipelineErrorCode` 全部错误码组成的联合类型。'
      ),
      members: {}
    }
  },
  enums: {
    MiddlewarePipelineErrorCode: {
      summary: t(
        'Codes on errors created by this package.',
        '本包创建的错误上的 `error.code` 取值。'
      ),
      values: {
        executionFailed: t(
          'EXECUTION_FAILED classifies unowned stage, done, host-active and violation callback failures. Writable native errors retain identity; foreign identities stay unchanged, immutable/primitive values remain on cause. Independent async onion failures form AggregateError without a combiner. A late next callback failure after run completion escapes on the caller stack; report there.',
          '`EXECUTION_FAILED` 分类未归属的步骤、终点、宿主存活及违规回调失败。可写原生错误保持身份，外包身份不变，不可修改错误或原始值保留在原因上；未设组合器的独立异步洋葱失败形成聚合错误。运行结束后迟到 `next` 的回调失败从调用方栈抛出，应由该调用方报告。'
        ),
        invalidOption: t(
          '`INVALID_OPTION`: an invalid mode, callback, signal, control object, signal set or `lift` direction. Fix the input; retrying will fail again.',
          '`INVALID_OPTION`：模式、回调、信号、控制对象、信号组或 `lift` 方向不合法。请修正输入，原样重试仍会失败。'
        ),
        aborted: t(
          'ABORTED classifies an unowned cancellation reason. Native Error reasons can retain their exact object and type; primitive/undefined reasons use ordinary Error with cause. Existing foreign source/code remain unchanged; AbortError is not guaranteed.',
          '`ABORTED` 分类未归属的取消原因；原生错误尽量保留对象与类型，原始值或空原因使用带原因的普通 `Error`，已有外包来源及错误码不改写，不保证为 `AbortError`。'
        ),
        abortCleanupFailed: t(
          '`ABORT_CLEANUP_FAILED`: cancelling the run and its cleanup both failed; inspect `errors` in order.',
          '`ABORT_CLEANUP_FAILED`：取消本身与取消后的清理同时失败；按顺序查看 `errors`。'
        )
      }
    },
    MiddlewarePipelineMode: {
      summary: t(
        'Execution modes of `createPipeline()`.',
        '`createPipeline()` 可选的执行模式，决定步骤形状与返回值。'
      ),
      values: {
        sync: t(
          '`sync`: stages are `(value, next) => void`; downstream starts after a stage returns; `run()` returns `void`.',
          '`sync`：步骤为 `(value, next) => void`；步骤返回后下游才开始；`run()` 返回 `void`。'
        ),
        async: t(
          '`async`: stages may be async; `next()` starts downstream at once and returns its Promise (onion); `run()` returns a Promise.',
          '`async`：步骤可以是异步函数；`next()` 立即启动下游并返回其 Promise（洋葱模型）；`run()` 返回 Promise。'
        ),
        generator: t(
          '`generator`: stages are generator functions; downstream starts after a stage finishes; `run()` returns `void`.',
          '`generator`：步骤为生成器函数；步骤结束后下游才开始；`run()` 返回 `void`。'
        ),
        asyncGenerator: t(
          '`async-generator`: stages are async generator functions; `run()` returns a Promise.',
          '`async-generator`：步骤为异步生成器函数；`run()` 返回 Promise。'
        )
      }
    },
    MiddlewarePipelineViolation: {
      summary: t(
        'Kinds of `next()` misuse reported to `onViolation`.',
        '报告给 `onViolation` 的 `next()` 误用种类，用于诊断有缺陷的步骤。'
      ),
      values: {
        late: t(
          '`late`: `next()` was called after the stage had already returned.',
          '`late`：步骤已经返回之后才调用 `next()`。'
        ),
        duplicate: t(
          '`duplicate`: `next()` was called more than once in one stage.',
          '`duplicate`：同一个步骤中多次调用了 `next()`。'
        )
      }
    }
  },
  enhancers: {}
}
