# `@migaia/middleware-pipeline` 使用指南

本包执行一条已确定的 middleware 链。它不注册 stage、不拥有资源，也不创建后台队列；这些属于宿主。先看 [README](./README.md) 选择 sync、async 或 generator 模型。

## 目录

- [一次请求转换工作流](#request-workflow)
- [API 与配置参考](#api-reference)
- [执行、错误与生命周期边界](#execution-errors)
- [排查与构建门禁](#troubleshooting-build)

<a id="request-workflow"></a>

## 一次请求转换工作流

```ts
import {
  MiddlewarePipelineViolation,
  runAsyncMiddleware,
  type IAsyncMiddlewareStage
} from '@migaia/middleware-pipeline';

type IRequest = { readonly path: string; readonly trace: readonly string[] };

const stages: readonly IAsyncMiddlewareStage<IRequest>[] = [
  async (request, next) => {
    await next({ ...request, trace: [...request.trace, 'auth'] });
  },
  async (request, next) => {
    if (request.path === '/health') return;
    await next({ ...request, trace: [...request.trace, 'route'] });
  }
];

await runAsyncMiddleware(
  stages,
  { path: '/users', trace: [] },
  (request) => console.log(request.trace),
  {
    onViolation: (kind) => {
      if (kind === MiddlewarePipelineViolation.duplicate) console.warn('next called twice');
    }
  }
);
```

Async `next()` starts downstream immediately and returns its Promise. `await next()` produces onion-style post-processing. Stage array is snapshotted before execution, so later caller mutation cannot change an in-flight run.

<a id="api-reference"></a>

## API 与配置参考

All exports come from root `@migaia/middleware-pipeline`; manifest defines no subpaths.

| API | Contract |
| --- | --- |
| `runSyncMiddleware(stages, value, done, onViolation)` | Each stage must call `next` before return to continue. First call wins; absent call short-circuits and skips `done`. |
| `runAsyncMiddleware(stages, value, done, options)` | `options.onViolation` required; optional `assertActive` runs at stage boundaries; optional `combineStageAndDownstreamError` owns simultaneous stage/downstream error construction. |
| `runGeneratorMiddleware(stages, value, done, signals?)` | Each generator returns next value, `GENERATOR_CONTINUE`, `GENERATOR_HALT`, `GENERATOR_UNDEFINED`, or implicit `undefined`. Continue uses last yield. |
| `adaptSyncStageToAsync(stage, onViolation?)` | Bridges already synchronous stage; its `next` remains return-time-only. |
| `adaptSyncStageToGenerator(stage, onViolation)` | Bridges one synchronous `next` into one yield; missing `next` becomes halt. |
| `MiddlewarePipelineMode` / stage types | Stable mode values and `ISyncMiddlewareStage`, `IAsyncMiddlewareStage`, `IGeneratorMiddlewareStage`. |
| `MiddlewarePipelineViolation` | Stable `late` and `duplicate` signals. Runner reports; caller decides policy. |
| Generator signals | `GENERATOR_CONTINUE`, `GENERATOR_HALT`, `GENERATOR_UNDEFINED`, and `MiddlewarePipelineGeneratorSignals` / `IGeneratorMiddlewareSignals`. |
| Error contract | `MIDDLEWARE_PIPELINE_SOURCE`, `MiddlewarePipelineErrorCode`, `IMiddlewarePipelineErrorCode`; default dual failure is `EXECUTION_FAILED`. |

<a id="execution-errors"></a>

## 执行、错误与生命周期边界

Sync is not onion middleware: `next(value)` records next input, then next stage starts after current stage returns. Async is onion middleware: downstream begins at `next`, and caller may await it. Generator stages may yield many values, but `GENERATOR_CONTINUE` forwards only final yielded value. Ordinary `undefined` return halts; use `GENERATOR_UNDEFINED` to forward undefined deliberately.

Calling `next` twice emits `duplicate`; calling captured `next` after stage returns emits `late`. Neither changes first accepted input. For async execution, exactly one ordinary failure is rethrown as original value. If current stage and started downstream both fail, optional combiner receives `(stageError, downstreamError)`; otherwise native `AggregateError` has `source: '@migaia/middleware-pipeline'`, code `EXECUTION_FAILED`, and both errors in `errors`. `assertActive` failure is runner control flow, not a second ordinary failure.

Every call is isolated: no `dispose`, `close`, `drain`, cancellation, registration, or shared state exists here. Host owning stages or concurrent runs must provide lifecycle/admission semantics separately, commonly with `@migaia/lifecycle`.

<a id="troubleshooting-build"></a>

## 排查与构建门禁

- `done` not called: stage omitted `next`, or generator returned halt/implicit undefined.
- Duplicate diagnostic: stage called `next` more than once; retain one branch and await/return it in async code.
- Late diagnostic: stage saved `next` for callback after return; use host-owned queue/lifecycle instead of reopening completed run.
- Need fan-out rather than value flow: use `@migaia/event-subscriber`.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
