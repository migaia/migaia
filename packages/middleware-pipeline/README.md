# `@migaia/middleware-pipeline`

运行时中立的 middleware chain 执行器：把一个值依次交给多个 stage，提供 sync、async、generator、async-generator 四种明确且互不混用的执行代数。

四种 runner 均支持可选 `IMiddlewarePipelineAbortSignal`。runner 只在 admission 与 stage 边界协作检查，不创建 controller、listener 或 `Promise.race`；已启动的异步工作必须 strict-drain。启用 signal 时 stage 与 `done` 收到同一个 frozen context，未启用时保持原实参数量。

**适用**：已经有一组按顺序运行的拦截器/转换器/middleware，需要明确的短路语义；async stage 需要 `await next()` 的洋葱模型；generator/async-generator stage 需要通过 `yield` 与显式 sentinel 控制最终值；只想执行一条链，不想引入 plugin host、event bus 或 lifecycle runtime。

**不适用**：不要把它当作一对多通知机制（用 event subscriber/event bus）；不要用它做固定的纯函数转换（直接组合函数或 `reduce()` 更简单）；它不提供排队、并发限制、drain、后台任务取消（应由 dispatcher + `@migaia/lifecycle` 管理）；它不管理插件安装、卸载、回滚与资源所有权（用 `@migaia/plugin-host`，本包只是 plugin-host 用来执行 pipeline 的算法层）。

## 安装

```bash
pnpm add @migaia/middleware-pipeline
```

包没有运行时依赖，产物为 ESM，声明 `sideEffects: false`。

## 目录

- [执行器](#执行器)：`runSyncMiddleware`、`runAsyncMiddleware`、`runGeneratorMiddleware`、`runAsyncGeneratorMiddleware`
- [适配器](#适配器)：`adaptSyncStageToAsync`、`adaptSyncStageToGenerator`、`adaptGeneratorStageToAsyncGenerator`、`adaptSyncStageToAsyncGenerator`
- [生成器信号](#生成器信号)：`GENERATOR_CONTINUE`、`GENERATOR_HALT`、`GENERATOR_UNDEFINED`、`MiddlewarePipelineGeneratorSignals`
- [取消信号](#取消信号)：`IMiddlewarePipelineAbortSignal`、`IMiddlewarePipelineContext`、`IMiddlewarePipelineControlOptions`
- [稳定值与错误](#稳定值与错误)：`MiddlewarePipelineMode`、`MiddlewarePipelineViolation`、`MIDDLEWARE_PIPELINE_SOURCE`、`MiddlewarePipelineErrorCode`
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="执行器"></a>

## 执行器

```ts
import {
  runSyncMiddleware,
  runAsyncMiddleware,
  runGeneratorMiddleware,
  runAsyncGeneratorMiddleware
} from '@migaia/middleware-pipeline';
```

**`runSyncMiddleware`｜5 秒上手** —— 同步依次传递，stage 不调用 `next()` 即短路：

```ts
runSyncMiddleware(
  [
    (value: string, next) => next(value.trim()),
    (value: string, next) => {
      if (value.length === 0) return; // 不调用 next：短路，done 不执行
      next(value.toUpperCase());
    }
  ],
  ' migaia ',
  (value) => console.log(value), // 'MIGAIA'
  (violation) => console.warn(violation) // 'late' | 'duplicate'
);
```

全部参数（均为位置参数，无选项对象）：

- `stages: readonly ISyncMiddlewareStage<TValue>[]`（必填）—— 调用前做一次快照，运行中调用方再修改原数组不影响本次执行
- `value: TValue`（必填）—— 传给第一个 stage 的初始值
- `done: (value: TValue, context?: IMiddlewarePipelineContext) => void`（必填）—— 仅当每个 stage 都调用了 `next()` 时，用最后一个 stage 提交的值调用一次；`control.signal` 提供时额外收到冻结的 `context`
- `onViolation: IMiddlewarePipelineViolationHandler`（必填，无默认值）—— stage 返回后才调用已保存的 `next` 触发 `'late'`；同一 stage 内调用 `next` 两次触发 `'duplicate'`；只接受第一次调用的值
- `control?: IMiddlewarePipelineControlOptions`（可选，`{ signal?: IMiddlewarePipelineAbortSignal }`）—— 提供 `signal` 时，每个 stage 前后与最终 `done` 前都会检查其 `aborted`，一旦为真立即抛出中止错误并停止继续执行 stage；不提供或提供 `undefined` 时行为与旧版完全一致（`stage`/`done` 只收到两个参数，不带 `context`）；显式传 `null` 视为非法选项，抛 `INVALID_OPTION`

**`runAsyncMiddleware`｜10 秒上手** —— 洋葱模型：`next()` 立即启动下游并返回其 Promise，`await next()` 之后的代码在下游完成后运行：

```ts
await runAsyncMiddleware(
  [
    async (value: number, next) => {
      await next(value + 1); // 下游先跑完，再继续本行之后的代码
    },
    async (value: number, next) => {
      await next(value * 2);
    }
  ],
  1,
  (value) => console.log(value), // 4
  { onViolation: () => undefined }
);
```

全部参数：

- `stages: readonly IAsyncMiddlewareStage<TValue>[]`（必填）—— 调用前快照
- `value: TValue`（必填）
- `done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>`（必填）—— 可返回 `Promise`；若它 reject，该错误按"下游失败"处理（顶层直接从 `runAsyncMiddleware()` 抛出，非顶层时计入触发它的那次 `next()` 的下游失败）；`options.signal` 提供时额外收到冻结的 `context`
- `options: IMiddlewarePipelineOptions`（必填对象，字段见下）：
  - `onViolation: IMiddlewarePipelineViolationHandler`（必填）—— 语义同 `runSyncMiddleware`
  - `assertActive?: () => void`（可选）—— 在每次进入 stage 前、以及该 stage 与它已启动的下游都结算完毕后（且链尚未整体完成时）各调用一次；抛出的错误被视为"runner 控制流"，只会向上传播这一个 exact 值，不会与普通 stage/downstream 失败合并，也不会经过 `combineStageAndDownstreamError`；与下面的 `signal` 是两套独立机制，可以同时使用
  - `combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown`（可选）—— 当前 stage 与它已启动的下游**同时**以普通失败结束时，用它的返回值作为要抛出的错误；不提供时抛出 `createMiddlewarePipelineExecutionError(stage, downstream)` 产出的 `AggregateError`（见[稳定值与错误](#稳定值与错误)）
  - `signal?: IMiddlewarePipelineAbortSignal`（可选）—— 语义同 `runSyncMiddleware` 的 `control.signal`：进入每个 stage 前、以及该 stage 与其下游都结算完毕后（链未整体完成时）都会检查；一旦已中止，抛出的错误同样作为 active 控制流处理，不与普通 stage/downstream 失败合并、不经过 `combineStageAndDownstreamError`

**`runGeneratorMiddleware`｜10 秒上手** —— generator stage 可以 `yield` 多次，用 `return` 值决定如何继续：

```ts
import { GENERATOR_CONTINUE, GENERATOR_HALT } from '@migaia/middleware-pipeline';

runGeneratorMiddleware(
  [
    function* (value: number) {
      yield value + 1;
      yield value + 2;
      return GENERATOR_CONTINUE; // 采用最后一次 yield，即 value + 2
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

全部参数：

- `stages: readonly IGeneratorMiddlewareStage<TValue>[]`（必填）—— 调用前快照
- `value: TValue`（必填）
- `done: (value: TValue, context?: IMiddlewarePipelineContext) => void`（必填）—— 仅当所有 stage 都未终止链时，用最终值调用一次
- `signals?: IGeneratorMiddlewareSignals`（可选，默认 `MiddlewarePipelineGeneratorSignals`）—— 兼容层可注入自己的 sentinel 集合；普通消费者直接使用默认值即可
- `control?: IMiddlewarePipelineControlOptions`（可选）—— 语义同 `runSyncMiddleware`；额外规则：若 abort 发生在某个 stage 的 `yield` 与 `yield` 之间（generator 尚未耗尽），runner 会先对该 generator 调用一次 `.return(undefined)` 触发其 `finally` 清理块，再耗尽清理阶段产生的任何后续 `yield`（这些 `yield` 不提交、不进入下一 stage），最后重新抛出中止错误；若清理过程本身也抛错，改为抛出 `AggregateError([abortFailure, cleanupFailure])`（`code: 'ABORT_CLEANUP_FAILED'`）

return 值语义：普通值 → 作为下一 stage 输入；`signals.continue` → 采用本次迭代最后一次 `yield` 的值；`signals.halt` 或隐式 `undefined`（未显式 `return`）→ 终止整条链、不调用 `done`；`signals.undefined` → 显式把 `undefined` 作为下一 stage 输入（与隐式 `undefined` 的终止行为不同）。

**`runAsyncGeneratorMiddleware`｜10 秒上手** —— 与 generator 使用相同 sentinel 语义，但会异步、串行地耗尽每个 stage；中间 yield 不会提前进入下一 stage：

```ts
await runAsyncGeneratorMiddleware(
  [
    async function* (value: number) {
      yield await Promise.resolve(value + 1);
      yield await Promise.resolve(value + 2);
      return GENERATOR_CONTINUE;
    },
    async function* (value: number) {
      return value * 2;
    }
  ],
  3,
  async (value) => console.log(value) // 10
);
```

参数与 `runGeneratorMiddleware` 对齐（含同样的 `control?`/清理协议）；区别是 stage 类型为 `IAsyncGeneratorMiddlewareStage<TValue>`、`done` 可以返回 Promise 且会被 `await`，runner 本身也返回 `Promise<void>`。方案是"完整耗尽当前 stage 后再继续"，不是每次 yield 都进入 downstream 的 streaming/fan-out。清理协议里对应调用的是 `await iterator.return(undefined)` 与 `await iterator.next()`，语义与同步版一致，只是全程 `await`。

Async Generator 按 JavaScript 协议会 assimilate yielded thenable；不要把 `PromiseLike` 当作需要保持 identity 的不透明 `TValue` payload。需要传递 Promise 对象本身时，先包装在普通对象字段中。

---

<a id="适配器"></a>

## 适配器

```ts
import {
  adaptGeneratorStageToAsyncGenerator,
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator
} from '@migaia/middleware-pipeline';
```

**`adaptSyncStageToAsync`｜5 秒上手** —— 把同步 stage 接入 async chain：

```ts
const asyncStage = adaptSyncStageToAsync((value: string, next) => next(value.trim()));
await runAsyncMiddleware([asyncStage], ' hi ', (v) => console.log(v), {
  onViolation: () => undefined
});
```

全部参数：

- `stage: ISyncMiddlewareStage<TValue>`（必填）—— 内部同步执行；其 `next` 依旧是"返回前调用一次"的语义
- `onViolation: IMiddlewarePipelineViolationHandler`（可选，默认 `() => {}`，即静默丢弃）—— 只捕获这个被适配的 stage 自身的 late/duplicate，不影响外层 async runner 的 `onViolation`

行为：等待 `stage` 内部调用 `next()` 所启动的那一条下游 Promise（即 async runner 真正的 `next`）；`stage` 若未调用 `next()`，这一帧就不会调用 async runner 的 `next`，效果等同短路。

**`adaptSyncStageToGenerator`｜5 秒上手** —— 把同步 `next(value)` 转成一次 `yield`：

```ts
const genStage = adaptSyncStageToGenerator(
  (value: string, next) => next(value.trim()),
  (violation) => console.warn(violation)
);
runGeneratorMiddleware([genStage], ' hi ', (v) => console.log(v));
```

全部参数：

- `stage: ISyncMiddlewareStage<TValue>`（必填）
- `onViolation: IMiddlewarePipelineViolationHandler`（必填，**无默认值**——与 `adaptSyncStageToAsync` 不同）

行为：`stage` 调用 `next(value)` 后，适配器 `yield value` 一次并 `return GENERATOR_CONTINUE`；`stage` 若未调用 `next()`，直接 `return GENERATOR_HALT`（不 `yield`），等价于终止整条链。

**Async Generator 适配器**：

- `adaptGeneratorStageToAsyncGenerator(stage)`：把同步 generator 提升为 async generator，保留每次 yield、terminal sentinel、调用次数和原始 throw identity。
- `adaptSyncStageToAsyncGenerator(stage, onViolation)`：组合既有 sync→generator 适配器，保留短路与 duplicate/late handler；`onViolation` 必填。
- 不提供 async middleware→async-generator；递归 `next()` 洋葱模型无法无损映射为 stage-local yield。

---

<a id="生成器信号"></a>

## 生成器信号

```ts
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineGeneratorSignals
} from '@migaia/middleware-pipeline';
```

**`GENERATOR_CONTINUE` / `GENERATOR_HALT` / `GENERATOR_UNDEFINED`｜3 秒上手** —— 三个稳定 `Symbol` 常量，无配置，直接从 generator stage `return`：

```ts
function* stage(value: number) {
  yield value;
  return GENERATOR_CONTINUE; // 或 GENERATOR_HALT / GENERATOR_UNDEFINED
}
```

**`MiddlewarePipelineGeneratorSignals`｜3 秒上手** —— 与上面三个常量配套的默认 sentinel 集合，是 `runGeneratorMiddleware` 的 `signals` 参数默认值，一般无需手动传递：

```ts
MiddlewarePipelineGeneratorSignals; // { undefined: GENERATOR_UNDEFINED, halt: GENERATOR_HALT, continue: GENERATOR_CONTINUE }
```

需要自定义 sentinel 时，构造一个满足 `IGeneratorMiddlewareSignals` 的对象传给 `runGeneratorMiddleware` 或 `runAsyncGeneratorMiddleware` 的第四个参数。

---

<a id="取消信号"></a>

## 取消信号

```ts
import type {
  IMiddlewarePipelineAbortSignal,
  IMiddlewarePipelineContext,
  IMiddlewarePipelineControlOptions
} from '@migaia/middleware-pipeline';
```

**`IMiddlewarePipelineAbortSignal`｜5 秒上手** —— 结构化的 abort signal 接口，不要求真实 DOM `AbortSignal`，任何满足这个形状的对象都可以传入：

```ts
type IMiddlewarePipelineAbortSignal = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
};
```

`aborted`/`reason` 只读，`addEventListener`/`removeEventListener` 目前所有 runner 都不会真的调用（runner 只在协作检查点**轮询** `aborted`，不注册监听器、不用 `Promise.race` 抢占）——之所以要求这两个方法存在，是为了保证传入的对象结构上真的兼容标准 `AbortSignal`，便于未来扩展或与其他包互操作，但当前版本不依赖它们被实际触发。

```ts
const controller = new AbortController();
runSyncMiddleware([stage], value, done, onViolation, { signal: controller.signal });
controller.abort('user cancelled');
```

**`IMiddlewarePipelineContext`｜3 秒上手** —— 提供了 `signal` 时，stage 与 `done` 额外收到的第三个只读参数：

```ts
type IMiddlewarePipelineContext = { readonly signal: IMiddlewarePipelineAbortSignal };
```

同一次调用内，所有 stage 与最终 `done` 共享**同一个** `Object.freeze` 冻结的 context 对象（同一个 `signal` 引用）；不提供 `signal` 时 stage/`done` 不会收到这第三个参数，函数 `arguments.length` 与旧版完全一致（纯加法式扩展，不破坏现有两参数写法）。

**`IMiddlewarePipelineControlOptions`｜3 秒上手** —— `runSyncMiddleware`/`runGeneratorMiddleware`/`runAsyncGeneratorMiddleware` 末位 `control` 参数的类型（`runAsyncMiddleware` 把同一个 `signal` 字段直接放进 `options`，不单独要 `control` 参数）：

```ts
type IMiddlewarePipelineControlOptions = { readonly signal?: IMiddlewarePipelineAbortSignal };
```

**协作检查点**：每个 runner 都在"进入某个 stage 之前"与"该 stage/迭代步骤结束之后（链未整体完成时）"各检查一次 `signal.aborted`；一旦为真，**立即**抛出中止错误，不再执行后续 stage，也不会调用 `done`。`signal.reason` 只在真正需要抛错的那一刻读取一次（不会在每次检查点都读取），且读到的第一个值会被"冻结"复用——即便 `reason` 是一个 getter，后续再抛错也不会重新读取。检查点本身**不创建**`AbortController`、不注册 `addEventListener`、不与 pending 的 Promise 做 `Promise.race`——已经启动的异步下游必须 strict-drain（等它自然 settle），中止只影响"是否继续进入下一个协作检查点之后的代码"，不会强行打断正在执行中的同步代码或已经在途的 Promise。

**中止错误的构造规则**：若 `signal.reason` 本身就是一个 `Error` 实例，直接原样抛出这个 reason（不包装、不附加本包的 `source`/`code`）；若 `reason` 是原始值或 `undefined`，包装成一个新 `Error`（`message: 'middleware pipeline aborted'`，`cause` 为原始 reason），并附加 `source: '@migaia/middleware-pipeline'`、`code: 'ABORTED'`。

**非法输入**：`control`（或 `runAsyncMiddleware` 的 `options`）本身传 `null`、数组，或 `signal` 字段存在但不满足 `aborted: boolean` + 两个监听方法的结构，都会抛出 `TypeError`（`code: 'INVALID_OPTION'`）；`control`/`signal` 字段为 `undefined`（不传）是合法的"不启用取消"写法，不会报错。传入时若 `signal.aborted` 已经是 `true`，在进入第一个 stage 之前就直接抛出中止错误。

---

<a id="稳定值与错误"></a>

## 稳定值与错误

```ts
import {
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode
} from '@migaia/middleware-pipeline';
```

**`MiddlewarePipelineMode`｜3 秒上手** —— 四种执行代数的稳定值，供调用方标注/分支用，本包内部不消费它：

```ts
MiddlewarePipelineMode;
// { sync: 'sync', async: 'async', generator: 'generator', asyncGenerator: 'async-generator' }
```

这是 additive runtime API，但 `IMiddlewarePipelineMode` 是封闭联合：使用 `assertNever(mode)` 做穷尽检查的 TypeScript consumer 升级后需要增加 `'async-generator'` case。四个 runner 都是静态 named export；不要创建运行时 runner registry，以免把未使用代数带进 bundle。

**`MiddlewarePipelineViolation`｜3 秒上手** —— `onViolation` 回调收到的稳定取值：

```ts
MiddlewarePipelineViolation; // { late: 'late', duplicate: 'duplicate' }
```

**`MIDDLEWARE_PIPELINE_SOURCE`｜3 秒上手** —— 本包错误身份用的稳定 `source` 字符串常量：

```ts
MIDDLEWARE_PIPELINE_SOURCE; // '@migaia/middleware-pipeline'
```

**`MiddlewarePipelineErrorCode`｜3 秒上手** —— 本包拥有的错误码表，共四项：

```ts
MiddlewarePipelineErrorCode;
// {
//   executionFailed: 'EXECUTION_FAILED',
//   invalidOption: 'INVALID_OPTION',
//   aborted: 'ABORTED',
//   abortCleanupFailed: 'ABORT_CLEANUP_FAILED'
// }
```

- `executionFailed`（`'EXECUTION_FAILED'`）：`runAsyncMiddleware` 里当前 stage 与它已经启动的 downstream 同时以普通失败结束、且调用方未提供 `combineStageAndDownstreamError` 时抛出的默认 `AggregateError` 所携带的 code；该错误的 `message` 固定为 `'middleware stage and downstream failed'`，`errors` 数组依次是 `[stageError, downstreamError]`。
- `invalidOption`（`'INVALID_OPTION'`）：`control`/`options` 本身或其 `signal` 字段结构不合法时抛出的 `TypeError` 携带的 code（见[取消信号](#取消信号)）。
- `aborted`（`'ABORTED'`）：`signal.reason` 不是 `Error` 实例时，本包包装出的默认中止错误携带的 code；若 `reason` 本身就是 `Error`，会原样抛出，不带这个 code。
- `abortCleanupFailed`（`'ABORT_CLEANUP_FAILED'`）：仅 `runGeneratorMiddleware`/`runAsyncGeneratorMiddleware` 会抛——某个 generator/async-generator stage 在 abort 触发的 `.return()` 清理阶段自身也抛错时，包装成的 `AggregateError` 携带的 code，`errors` 固定为 `[abortFailure, cleanupFailure]`。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. Sync 校验链：短路 + violation 上报

```ts
import { MiddlewarePipelineViolation, runSyncMiddleware } from '@migaia/middleware-pipeline';

const violations: string[] = [];

runSyncMiddleware(
  [
    (value: string, next) => next(value.trim()),
    (value: string, next) => {
      if (value.length === 0) return; // 空字符串直接短路
      next(value.toUpperCase());
      next('ignored'); // 触发 duplicate，只有第一次生效
    }
  ],
  '  hi  ',
  (value) => console.log('done:', value), // 'done: HI'
  (violation) => violations.push(violation) // ['duplicate']
);
```

### 2. Async 洋葱模型：认证 + 路由，短路跳过 `/health`

```ts
import { runAsyncMiddleware, type IAsyncMiddlewareStage } from '@migaia/middleware-pipeline';

type IRequest = { readonly path: string; readonly trace: readonly string[] };

const stages: readonly IAsyncMiddlewareStage<IRequest>[] = [
  async (request, next) => {
    await next({ ...request, trace: [...request.trace, 'auth'] });
  },
  async (request, next) => {
    if (request.path === '/health') return; // 短路，done 不执行
    await next({ ...request, trace: [...request.trace, 'route'] });
  }
];

await runAsyncMiddleware(
  stages,
  { path: '/users', trace: [] },
  (request) => console.log(request.trace), // ['auth', 'route']
  { onViolation: () => undefined }
);
```

### 3. Async 双失败：自定义组合器接管领域错误

```ts
import { runAsyncMiddleware } from '@migaia/middleware-pipeline';

class MyPipelineError extends Error {
  constructor(
    readonly stageError: unknown,
    readonly downstreamError: unknown
  ) {
    super('pipeline stage and downstream both failed');
  }
}

await runAsyncMiddleware(
  [
    async (value: number, next) => {
      try {
        await next(value);
      } finally {
        throw new Error('stage cleanup failed');
      }
    },
    async () => {
      throw new Error('downstream failed');
    }
  ],
  1,
  () => undefined,
  {
    onViolation: () => undefined,
    combineStageAndDownstreamError: (stageError, downstreamError) =>
      new MyPipelineError(stageError, downstreamError)
  }
).catch((error) => console.error(error instanceof MyPipelineError)); // true
```

### 4. Generator：多次 yield 采集 + 显式终止

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
      yield value + 2; // 最终采用这一次
      return GENERATOR_CONTINUE;
    },
    function* (value: number) {
      if (value > 10) return GENERATOR_HALT; // 终止整条链
      return value * 2;
    }
  ],
  3,
  (value) => console.log(value) // 10
);
```

### 5. 混用同步与异步 stage：用适配器统一到 async chain

```ts
import {
  adaptSyncStageToAsync,
  runAsyncMiddleware,
  type IAsyncMiddlewareStage
} from '@migaia/middleware-pipeline';

const trimStage = adaptSyncStageToAsync((value: string, next) => next(value.trim()));
const upperStage: IAsyncMiddlewareStage<string> = async (value, next) => {
  await next(value.toUpperCase());
};

await runAsyncMiddleware(
  [trimStage, upperStage],
  '  migaia  ',
  (value) => console.log(value), // 'MIGAIA'
  { onViolation: (kind) => console.warn('violation:', kind) }
);
```

### 6. Async-generator + AbortController：可取消的多步异步处理

```ts
import {
  GENERATOR_CONTINUE,
  runAsyncGeneratorMiddleware,
  type IAsyncGeneratorMiddlewareStage
} from '@migaia/middleware-pipeline';

const fetchStage: IAsyncGeneratorMiddlewareStage<string> = async function* (url, context) {
  yield url; // 中间 yield 仅用于观测/调试，不会提前送到下一 stage
  const response = await fetch(url, { signal: context?.signal as AbortSignal | undefined });
  return await response.text();
};

const controller = new AbortController();
setTimeout(() => controller.abort(new Error('超时')), 3000);

try {
  await runAsyncGeneratorMiddleware(
    [fetchStage],
    'https://example.com/data',
    (text) => console.log('done:', text),
    undefined,
    { signal: controller.signal }
  );
} catch (error) {
  // 3 秒内 controller.abort() 触发：runner 在下一个协作检查点抛出 '超时'（reason 已是 Error，原样抛出）
  // fetch 本身也收到同一个 signal，会独立中止网络请求
  console.error(error);
}
```

`context?.signal` 同时传给 `fetch`，做到"pipeline 层面的协作检查点"和"具体 I/O 操作自身的中止"两者共用同一个信号源，而不是维护两套取消逻辑。

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
