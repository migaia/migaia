/**
 * Reference documentation of `@migaia/middleware-pipeline`. Rules: `app/reference/contract.ts`.
 * Verified against `packages/middleware-pipeline/src` (create-pipeline.ts, runtime.ts,
 * state-constants.ts, error-code.ts) and README on 2026-10-17.
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
        'Creates a reusable, stateless middleware runner for one execution mode. The runner owns no stage list: each `run()` receives the stages, the input value and a final callback, so one pipeline can serve many hosts and concurrent runs. A stage continues by calling `next(value)` (or yielding, for generator modes); not continuing stops the run.',
        '创建某一种执行模式下可复用、无状态的中间件执行器。执行器不保存步骤列表：每次 `run()` 都传入步骤、输入值和终点回调，因此同一个 pipeline 可以服务多个宿主和并发运行。步骤调用 `next(value)`（生成器模式下通过 yield）继续，不继续则结束本次运行。'
      ),
      returns: t(
        'An `IMiddlewarePipeline` for the chosen mode. Invalid options throw a `TypeError` with code `INVALID_OPTION`.',
        '所选模式的 `IMiddlewarePipeline`。选项不合法时抛带 `INVALID_OPTION` 码的 `TypeError`。'
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
            'A stage of this pipeline mode. Unsupported directions are rejected by the type system and throw `INVALID_OPTION` at run time.',
            '当前模式的步骤。不支持的方向会被类型系统拒绝，运行时抛 `INVALID_OPTION`。'
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
            '`void` in `sync` and `generator` modes (errors are thrown); a `Promise<void>` in `async` modes (errors reject). Cancellation surfaces as a native `AbortError` that keeps the original reason.',
            '`sync` 和 `generator` 模式返回 `void`（错误直接抛出）；`async` 系列模式返回 `Promise<void>`（错误以 reject 返回）。取消表现为保留原始原因的原生 `AbortError`。'
          ),
          example: `const controller = new AbortController()
await pipeline.run(stages, input, async (result) => save(result), { signal: controller.signal })`
        }
      }
    },
    ICreatePipelineOptions: {
      summary: t(
        'Options of `createPipeline()`; `mode` is required, the rest are optional.',
        '`createPipeline()` 的选项；`mode` 必填，其它字段可选，全部在创建时确定。'
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
          )
        },
        combineStageAndDownstreamError: {
          summary: t(
            'In async modes, builds the error to throw when a stage and its downstream both failed. Both original errors stay reachable through what you return.',
            '异步模式下，当步骤本身与它的下游同时失败时，用它构造最终抛出的错误；两个原始错误都应能从返回值中找到。'
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
        'Third argument of every stage: the context of the current run.',
        '每个步骤收到的第三个参数：本次运行的上下文。'
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
        'A generator stage `function* (value, context?)`: `yield` produces the next value; `return` a value, or one of the `GENERATOR_*` signals, to decide what happens next.',
        '生成器步骤 `function* (value, context?)`：`yield` 产出下一个值；`return` 一个值或某个 `GENERATOR_*` 信号，决定接下来怎么做。'
      ),
      members: {}
    },
    IAsyncGeneratorMiddlewareStage: {
      summary: t(
        'Async version of a generator stage (`async function*`).',
        '生成器步骤的异步版本（`async function*`），仅用于 `async-generator` 模式。'
      ),
      members: {}
    },
    IMiddlewarePipelineStage: {
      summary: t(
        'The stage type for one mode, selected by the mode name.',
        '按模式名选出对应模式的步骤类型。'
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
    IMiddlewarePipelineSyncMode: {
      summary: t(
        'The modes that finish before `run()` returns: `sync` and `generator`.',
        '在 `run()` 返回前就执行完的模式：`sync` 与 `generator`。'
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
          '`EXECUTION_FAILED`: in an async mode both a stage and its downstream failed and no combiner was given; both errors are in `AggregateError.errors`.',
          '`EXECUTION_FAILED`：异步模式下某个步骤与其下游同时失败且未设置合并函数；两个错误都在 `AggregateError.errors` 中。'
        ),
        invalidOption: t(
          '`INVALID_OPTION`: an invalid mode, callback, signal, control object, signal set or `lift` direction. Fix the input; retrying will fail again.',
          '`INVALID_OPTION`：模式、回调、信号、控制对象、信号组或 `lift` 方向不合法。请修正输入，原样重试仍会失败。'
        ),
        aborted: t(
          '`ABORTED`: the run was cancelled with a primitive or missing reason; the original reason is on `cause`.',
          '`ABORTED`：运行被取消且取消原因不是对象（或未提供）；原始原因在 `cause` 上。'
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
