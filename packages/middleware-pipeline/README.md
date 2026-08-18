# `@migaia/middleware-pipeline`

运行时中立、无运行时依赖的 middleware chain 执行器。它把一个值依次交给多个 stage，并提供 sync、async、generator 三种明确且互不混用的执行模型。

这个包只拥有“如何执行一条 middleware 链”的算法，不拥有插件安装、stage 注册、生命周期、队列、事件广播或宿主诊断。`@migaia/plugin-host` 使用本包执行 pipeline，但插件和资源仍由 plugin-host 管理。

## 1. 什么时候使用

适合：

- 已经有一组按顺序运行的拦截器、转换器或 middleware。
- 需要明确的短路语义，而不是简单的 `Array.reduce()`。
- async stage 需要 `await next()`，在下游完成后继续执行后置逻辑。
- generator stage 需要通过 yield 和显式 sentinel 控制传播。
- 不希望为了执行一条链引入 plugin host、event bus 或 lifecycle runtime。

不适合：

- 一对多通知：使用 event subscriber/event bus。
- 固定的纯函数转换：直接组合函数或使用 `reduce()` 更简单。
- 需要排队、并发限制、drain、取消后台任务：应由 dispatcher + lifecycle 管理。
- 需要插件安装、卸载、回滚和资源所有权：使用 `@migaia/plugin-host`。

## 2. 三种模式怎么选

| 模式      | `next()` / 控制方式       | 下游何时执行                         | 适合场景                          |
| --------- | ------------------------- | ------------------------------------ | --------------------------------- |
| sync      | `next(value)`             | 当前 stage 返回后                    | 同步转换、校验、快速短路          |
| async     | `await next(value)`       | 调用 `next()` 后启动，可等待完整下游 | 洋葱模型、异步拦截器、前后置逻辑  |
| generator | `yield` + return sentinel | 当前 generator 完成后                | 多次产值、显式继续/终止/undefined |

三种模式是不同代数。不要把 sync stage 当成洋葱模型：sync 的 `next()` 只提交下一阶段输入，不会在调用点同步执行下游。

## 3. 安装

```bash
pnpm add @migaia/middleware-pipeline
```

包没有运行时依赖，产物为 ESM，目标基线为 ES2020。

## 4. 快速开始：Sync 同步传递与短路

```ts
import { MiddlewarePipelineViolation, runSyncMiddleware } from '@migaia/middleware-pipeline';

const stages = [
  (value: string, next: (value: string) => void) => next(value.trim()),
  (value: string, next: (value: string) => void) => {
    if (value.length === 0) return; // 不调用 next：短路，不调用 done
    next(value.toUpperCase());
  }
];

runSyncMiddleware(
  stages,
  ' migai ',
  (value) => console.log(value), // MIGAIA
  (violation) => {
    if (violation === MiddlewarePipelineViolation.duplicate) {
      console.warn('stage called next more than once');
    }
  }
);
```

规则：

- stage 不调用 `next()`：整条链短路，`done()` 不执行。
- stage 调用两次 `next()`：只接受第一次，并报告 `duplicate`。
- stage 返回后再调用保存的 `next()`：忽略该调用，并报告 `late`。
- violation 如何记录、上报或转成宿主错误，由调用方决定。

## 5. Async：洋葱模型与双失败

```ts
import { runAsyncMiddleware } from '@migaia/middleware-pipeline';

const trace: string[] = [];

await runAsyncMiddleware(
  [
    async (value, next) => {
      trace.push(`before:${value}`);
      await next(value + 1);
      trace.push(`after:${value}`);
    },
    async (value, next) => {
      trace.push(`inner:${value}`);
      await next(value * 2);
    }
  ],
  1,
  (value) => {
    trace.push(`done:${value}`);
  },
  { onViolation: () => undefined }
);

// ['before:1', 'inner:2', 'done:4', 'after:1']
```

`runAsyncMiddleware()` 的 options：

| 选项                             | 必填 | 作用                                                      |
| -------------------------------- | ---- | --------------------------------------------------------- |
| `onViolation`                    | 是   | 接收 `late` / `duplicate`                                 |
| `assertActive`                   | 否   | 进入 stage 及下游结束后检查宿主是否仍有效                 |
| `combineStageAndDownstreamError` | 否   | 当前 stage 与已启动的 downstream 同时失败时，接管错误构造 |

如果 stage 和 downstream 同时失败：

- 提供了 `combineStageAndDownstreamError`：抛出调用方返回的领域错误。
- 未提供：抛出原生 `AggregateError`，两个原错误保留在 `errors[]`，并附加：
  - `source: '@migaia/middleware-pipeline'`
  - `code: 'EXECUTION_FAILED'`
  - `message: 'middleware stage and downstream failed'`

判断只看两个可观察结果：当前 stage 的执行结果和已由 `next()` 启动的 pending downstream。两者都 reject 时始终按 `[stageError, downstreamError]` 传给组合器，即使两者是同一 object 或 primitive；只 reject 一个时抛出其 exact value。`next()` 返回原生 Promise，不追踪消费、Promise lineage、constructor 或 species，因此 `await`、`return`、`catch`、`finally` 和 borrowed native Promise methods 都不会改变双失败判定。组合器返回的 `undefined`/`null` 也原样抛出。

下游 stage 入口或成功但未调用 `next()` 后，`assertActive` 产生的 active error 属于 runner control path：`await next()` 或 `return next()` 只传播该 exact error，不把它作为第二个普通 failure slot；独立 stage failure 仍保持 exact，普通同一 identity 双失败仍组合。

plugin-host 会为普通 stage/downstream 双失败注入自己的组合器，因此该路径抛出 `@migaia/plugin-host + PIPELINE_FAILED`；runner-owned entry/post-stage active control 不调用该组合器，不会被包装为 `PIPELINE_FAILED`。

## 6. Generator：显式控制传播

```ts
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  runGeneratorMiddleware
} from '@migaia/middleware-pipeline';

runGeneratorMiddleware(
  [
    function* (value: number) {
      yield value + 1;
      yield value + 2;
      return GENERATOR_CONTINUE; // 使用最后一次 yield，即 value + 2
    },
    function* (value: number) {
      if (value > 10) return GENERATOR_HALT;
      return value * 2;
    }
  ],
  3,
  (value) => console.log(value) // 10
);
```

generator 的 return 规则：

| 返回值                | 行为                              |
| --------------------- | --------------------------------- |
| 普通值                | 作为下一 stage 输入               |
| `GENERATOR_CONTINUE`  | 使用最后一次 yield 的值继续       |
| `GENERATOR_HALT`      | 终止整条链，不调用 `done()`       |
| `GENERATOR_UNDEFINED` | 显式把 `undefined` 传给下一 stage |
| 隐式 `undefined`      | 视为终止，不调用 `done()`         |

`runGeneratorMiddleware()` 还允许兼容 wrapper 注入自己的 sentinel identity。这个入口主要用于 plugin-host 之类已经公开过 Symbol 的宿主；普通消费者应直接使用本包导出的三个 sentinel。

## 7. 从同步 stage 适配

包提供两个适配器：

```ts
import { adaptSyncStageToAsync, adaptSyncStageToGenerator } from '@migaia/middleware-pipeline';
```

- `adaptSyncStageToAsync(stage, onViolation)`：把同步 stage 接入 async chain，并等待它启动的第一条 downstream Promise。
- `adaptSyncStageToGenerator(stage, onViolation)`：把同步 `next(value)` 转成一次 yield；未调用 `next()` 时返回 `GENERATOR_HALT`。

适配不会把 sync stage 变成真正的 async/generator stage：原 stage 仍必须在返回前调用 `next()`，late/duplicate 仍会报告。

## 8. 公开 API

| API                           | 用途                                      |
| ----------------------------- | ----------------------------------------- |
| `runSyncMiddleware()`         | 执行同步、扁平的 middleware chain         |
| `runAsyncMiddleware()`        | 执行支持 `await next()` 的 async chain    |
| `runGeneratorMiddleware()`    | 执行 generator chain                      |
| `adaptSyncStageToAsync()`     | sync stage → async stage                  |
| `adaptSyncStageToGenerator()` | sync stage → generator stage              |
| `MiddlewarePipelineMode`      | `sync` / `async` / `generator` 稳定值     |
| `MiddlewarePipelineViolation` | `late` / `duplicate` 稳定值               |
| `GENERATOR_CONTINUE`          | 采用最后一次 yield 并继续                 |
| `GENERATOR_HALT`              | 终止整条链                                |
| `GENERATOR_UNDEFINED`         | 显式传播 undefined                        |
| `MiddlewarePipelineErrorCode` | 包拥有的错误码，目前为 `EXECUTION_FAILED` |

完整类型包括 `ISyncMiddlewareStage`、`IAsyncMiddlewareStage`、`IGeneratorMiddlewareStage`、`IMiddlewarePipelineOptions` 和 violation/signal 类型，均从主入口导出。

## 9. Tree-shaking 与运行时边界

所有公开 API 由 ESM 主入口导出，包声明 `sideEffects: false`。sync-only 的构建测试会验证最终 bundle 不包含 async 双失败文本或 generator sentinel；没有使用的执行模式可以被移除。

运行时代码不依赖：

- Node / Bun / Deno 专属 API
- DOM、Worker 或 UI framework
- timer、scheduler 或全局 singleton
- lifecycle、plugin-host 或 Store

## 10. 生命周期边界

本包一次调用只执行一次 chain，不保存跨调用状态，也不提供 `close()`、`dispose()`、`drain()` 或队列。

stage registration 的 disposer、host closing 检查和运行深度由 plugin-host 拥有。需要长期持有 in-flight 工作、超时预算、取消或排空的系统，应使用独立 dispatcher 并依赖 `@migaia/lifecycle`，不要把这些职责塞进 runner。

## 11. 深入参考

- 更精确的行为说明：[USEGUIDE.md](./USEGUIDE.md)
- 架构、迁移和验收矩阵：[middleware-pipeline.sdd.md](../../docs/middleware-pipeline/middleware-pipeline.sdd.md)
- plugin-host 集成：[plugin-host README](../plugin-host/README.md)
