# `@migaia/middleware-pipeline` 使用指南

本指南逐个 API 列出完整签名、边界行为与错误码。包的定位与安装方式见 [README](./README.md)。

## 目录

- [执行器](#执行器)
- [适配器](#适配器)
- [生成器信号与类型](#生成器信号与类型)
- [稳定值与错误](#稳定值与错误)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="执行器"></a>

## 执行器

所有导出均来自根入口 `@migaia/middleware-pipeline`；`package.json` 的 `exports` 只声明了一个子路径 `.`。

### `runSyncMiddleware`

```ts
type ISyncMiddlewareStage<TValue> = (value: TValue, next: (value: TValue) => void) => void;

function runSyncMiddleware<TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IMiddlewarePipelineViolationHandler
): void;
```

同步、扁平地把 `value` 依次交给每个 stage。调用前会对 `stages` 做一次数组快照（`stages.slice()`），运行期间调用方再修改原数组不会影响本次已经开始的执行。

对每个 stage：同步调用 `stage(current, next)`；`next` 首次被调用时记录其参数为下一 stage 的输入；stage 函数返回（同步执行完毕）后即视为该 stage "已结束"。

- **不调用 `next()`**：该 stage 结束后 `called` 为 `false`，`runSyncMiddleware` 直接 `return`，**不调用 `done`**——链在此短路。
- **调用 `next()` 两次**：第二次触发 `onViolation('duplicate')`，只有第一次调用的值生效。
- **stage 返回后再调用已保存的 `next`**（例如塞进定时器里稍后调用）：触发 `onViolation('late')`，不影响已经继续的链。
- 全部 stage 都调用了 `next()`：用最后一个 stage 提交的值调用一次 `done`。

`onViolation` 是必填参数，没有默认值；如何记录、上报或转成宿主错误完全由调用方决定。

```ts
runSyncMiddleware(
  [(v: string, next) => next(v.trim()), (v: string, next) => next(v.toUpperCase())],
  ' hi ',
  (v) => console.log(v), // 'HI'
  () => undefined
);
```

### `runAsyncMiddleware`

```ts
type IAsyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => Promise<void>
) => void | Promise<void>;

type IMiddlewarePipelineOptions = {
  readonly onViolation: IMiddlewarePipelineViolationHandler;
  readonly assertActive?: () => void;
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown;
};

function runAsyncMiddleware<TValue>(
  stages: readonly IAsyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void | Promise<void>,
  options: IMiddlewarePipelineOptions
): Promise<void>;
```

洋葱模型执行器。同样先对 `stages` 做一次快照。内部用一个递归的 `step(current, parentControlPath?)` 帧串联每个 stage：

1. 进入这一帧前，若提供了 `options.assertActive`，先调用一次；它抛出的错误被标记为**这一帧对其父帧的 active control 错误**（见下文"active 错误 vs 普通错误"），并立即向上抛出，不再执行本帧的 stage。
2. 若已经处理完全部 stage（`index >= stages.length`），调用 `done(current)` 并返回——`done` 的返回值（可能是一个 `Promise`）被当作这一帧的返回值向上传播；若它 reject，该 rejection 按"这一帧的失败"处理，规则与普通 stage 失败一致（见下）。
3. 否则执行当前 stage：`await stage(current, next)`。`next(nextValue)` **同步启动**下一帧（`step(nextValue, ...)` 包在 `Promise.resolve().then(...)` 里），立即返回代表下游整体结果的 `Promise`；调用方是否 `await` 这个 `Promise` 完全由 stage 自己决定——这就是"洋葱模型"：`await next()` 之后的代码在下游全部完成后才执行；不 `await` 直接返回则下游与当前 stage 之后的收尾代码并发推进。
4. stage 函数返回（或其 Promise 结算）后，若期间已经调用过 `next()`，等待下游帧结算完毕，再统一判定结果。

`next()` 违规规则与 sync 相同：第二次调用触发 `onViolation('duplicate')`，stage 返回后再调用已保存的 `next` 触发 `onViolation('late')`；两种情况下调用返回的都是一个已 resolve 的空 `Promise`，不会抛出。

**普通失败判定**：一帧只看两个可观察结果——当前 stage 本身的执行结果，以及已经由 `next()` 启动的、被等待的下游帧的结果。

- 只有一个失败：原样抛出该 exact 值（不包装）。
- stage 与已启动的下游**同时**失败：
  - 提供了 `combineStageAndDownstreamError`：抛出 `combineStageAndDownstreamError(stageError, downstreamError)` 的返回值（即使返回 `undefined`/`null` 也原样抛出）。
  - 未提供：抛出 [`createMiddlewarePipelineExecutionError(stageError, downstreamError)`](#稳定值与错误) 产出的 `AggregateError`。
  - 判定只比较"是否都失败"，不比较错误的同一性——两者是同一个 object 或同一个 primitive 时仍按双失败处理；`next()` 返回的是原生 `Promise`，不追踪谁消费了它、消费方式（`await`/`return`/`.then`/`.catch`/`.finally`）或是否经过 borrowed 的原生 Promise 方法，因此这些都不影响双失败判定。
- stage 未调用 `next()`（短路）：这一帧的返回就是"没有下游"，行为与 sync 相同——链在此终止，不会再往上层传播 `done`，最终的 `runAsyncMiddleware()` Promise 以 resolve 结束（除非 stage 自身抛错）。

**active 错误 vs 普通错误**：`assertActive` 的失败被视为"runner 拥有的控制流"，不是某个 stage 的业务失败。它只会：

- 作为这一帧向其父帧报告的 **exact** 错误（记在父帧的 `parentControlPath` 上），父帧据此只重新抛出这个 exact 值，**不**把它当成第二个普通 failure slot去和 stage 的普通失败做组合；
- 若同一帧里 stage 本身也失败，且 stage 的失败值恰好就是这个 active 错误（同一个值），才会把它继续标记到更上一层的父帧——这保证"作为控制信息传递"和"作为这一帧最终抛出的错误"是同一件事时不会丢失标记；否则 stage 的独立失败仍按普通规则处理（不会被 active 错误吞掉）。
- `assertActive` 会在进入每个 stage 前调用一次；也会在该 stage 与其下游都结算完毕、且链尚未整体完成（还没到达调用 `done` 的那一帧）时再调用一次。

```ts
await runAsyncMiddleware(
  [
    async (v, next) => {
      await next(v + 1);
    }
  ],
  1,
  (v) => console.log(v),
  { onViolation: () => undefined }
);
```

### `runGeneratorMiddleware`

```ts
function runGeneratorMiddleware<TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  signals?: IGeneratorMiddlewareSignals
): void;
```

对每个 stage 调用 `stage(current)` 得到一个 generator 实例，然后**同步耗尽**它（反复调用 `.next()` 直到 `done: true`），期间：

- 每次 `yield` 到的值都会覆盖记录为 `last`（因此多次 `yield` 时，`last` 最终是**最后一次** `yield` 的值，不是第一次）；
- generator `return` 的值决定如何继续：
  - 等于 `signals.halt`，或**隐式** `undefined`（generator 函数体走到末尾、没有显式 `return` 语句）：整条链在此终止，`runGeneratorMiddleware` 直接返回，**不调用 `done`**。
  - 等于 `signals.continue`：采用 `last`（最后一次 `yield` 的值）作为下一 stage 的输入。
  - 等于 `signals.undefined`：显式把 `undefined` 作为下一 stage 的输入（与"隐式 `undefined`"的终止语义不同，二者用不同的判断分支区分）。
  - 其他任意值：直接作为下一 stage 的输入。
- 所有 stage 都未终止链时，用最终值调用一次 `done`。

`signals` 可选，默认 [`MiddlewarePipelineGeneratorSignals`](#生成器信号与类型)；提供自定义对象可以让兼容层（例如已经公开过自己 Symbol 的宿主）复用同一套执行逻辑而不强绑本包导出的 sentinel 身份。

```ts
import { GENERATOR_CONTINUE, GENERATOR_HALT } from '@migaia/middleware-pipeline';

runGeneratorMiddleware(
  [
    function* (v: number) {
      yield v + 1;
      yield v + 2;
      return GENERATOR_CONTINUE; // 采用 v + 2
    },
    function* (v: number) {
      return v > 10 ? GENERATOR_HALT : v * 2;
    }
  ],
  3,
  (v) => console.log(v) // 10
);
```

---

<a id="适配器"></a>

## 适配器

### `adaptSyncStageToAsync`

```ts
function adaptSyncStageToAsync<TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation?: IMiddlewarePipelineViolationHandler
): IAsyncMiddlewareStage<TValue>;
```

把一个同步 stage 包装成可以放进 `runAsyncMiddleware` stage 数组的 `IAsyncMiddlewareStage`。`onViolation` 可选，默认 `() => {}`（静默丢弃）——这个 `onViolation` 只处理**被适配的同步 stage 自身**触发的 late/duplicate，与外层 `runAsyncMiddleware` 的 `options.onViolation` 是两套独立的报告通道。

执行细节：同步调用 `stage(value, innerNext)`；`innerNext` 首次被调用时，用它的参数调用真正的 async runner `next`（记为 `downstream`，其返回值是一个 `Promise`）。`stage` 同步执行完毕后：

- 若捕获到 `stage` 本身抛出的同步错误，记为 `stageError`；
- 若 `downstream` 存在，`await` 它，捕获到的错误记为 `downstreamError`；
- 两者都有：**依次**（先 `stageError` 后 `downstreamError`）分别 `throw`——即优先重新抛出 `stageError`；只有 `stageError`：抛它；只有 `downstreamError`：抛它；都没有：正常返回（`undefined`）。

`stage` 若未调用 `innerNext`，`downstream` 始终是 `undefined`，适配后的 async stage 也就不会调用外层 `next`——等价于在 async chain 里短路这一帧。

```ts
const stage = adaptSyncStageToAsync((v: string, next) => next(v.trim()));
```

### `adaptSyncStageToGenerator`

```ts
function adaptSyncStageToGenerator<TValue>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IGeneratorMiddlewareStage<TValue>;
```

把一个同步 stage 包装成 `IGeneratorMiddlewareStage`。**`onViolation` 是必填参数，没有默认值**——这是与 `adaptSyncStageToAsync` 的显著不同之处。

执行细节：返回的 generator 函数体内同步调用 `stage(value, innerNext)`；`innerNext` 首次调用记录候选值，第二次调用触发 `onViolation('duplicate')`，`stage` 返回后再调用触发 `onViolation('late')`。`stage` 返回后：

- 若从未调用过 `innerNext`：`return GENERATOR_HALT`（不 `yield` 任何值）——等价于终止整条链。
- 若调用过：`yield` 该候选值一次，然后 `return GENERATOR_CONTINUE`。

```ts
const genStage = adaptSyncStageToGenerator(
  (v: string, next) => next(v.trim()),
  (violation) => console.warn(violation)
);
```

---

<a id="生成器信号与类型"></a>

## 生成器信号与类型

```ts
const GENERATOR_UNDEFINED: unique symbol;
const GENERATOR_HALT: unique symbol;
const GENERATOR_CONTINUE: unique symbol;

type IGeneratorMiddlewareSignals = {
  readonly undefined: symbol;
  readonly halt: symbol;
  readonly continue: symbol;
};
const MiddlewarePipelineGeneratorSignals: IGeneratorMiddlewareSignals;
```

`GENERATOR_UNDEFINED`：generator stage `return` 它表示"显式把 `undefined` 传给下一 stage"，与函数体末尾隐式 `undefined`（终止整条链）的语义不同。
`GENERATOR_HALT`：generator stage `return` 它表示终止整条链、不调用 `done`。
`GENERATOR_CONTINUE`：generator stage `return` 它表示采用本次迭代**最后一次** `yield` 的值继续。
`MiddlewarePipelineGeneratorSignals`：与上面三个常量一一对应的默认 sentinel 集合，是 `runGeneratorMiddleware` 第四个参数 `signals` 的默认值。

```ts
type ISyncMiddlewareStage<TValue> = (value: TValue, next: (value: TValue) => void) => void;

type IAsyncMiddlewareStage<TValue> = (
  value: TValue,
  next: (value: TValue) => Promise<void>
) => void | Promise<void>;

// TValue 的类型允许 undefined 时，生成器 return 类型里额外接受 GENERATOR_UNDEFINED 作为
// "显式传播 undefined" 的信号；TValue 不允许 undefined 时该分支类型上不存在。
type IGeneratorMiddlewareStage<TValue> = (
  value: TValue
) => Generator<
  TValue,
  | TValue
  | (undefined extends TValue ? typeof GENERATOR_UNDEFINED : never)
  | typeof GENERATOR_HALT
  | typeof GENERATOR_CONTINUE
  | undefined,
  void
>;
```

三个 stage 函数类型分别对应 sync/async/generator 三种执行代数，均为 `@migaia/middleware-pipeline` 主入口的类型导出，无运行时值。

```ts
type IMiddlewarePipelineOptions = {
  readonly onViolation: IMiddlewarePipelineViolationHandler;
  readonly assertActive?: () => void;
  readonly combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown;
};
```

`runAsyncMiddleware` 的选项对象类型；字段语义见[执行器 · `runAsyncMiddleware`](#执行器)。

---

<a id="稳定值与错误"></a>

## 稳定值与错误

```ts
const MiddlewarePipelineMode = { sync: 'sync', async: 'async', generator: 'generator' } as const;
type IMiddlewarePipelineMode = (typeof MiddlewarePipelineMode)[keyof typeof MiddlewarePipelineMode];
```

三种执行代数的稳定字符串值，供调用方标注/分支使用；本包内部的三个 runner 函数并不消费这个值（不会根据它切换行为）。

```ts
const MiddlewarePipelineViolation = { late: 'late', duplicate: 'duplicate' } as const;
type IMiddlewarePipelineViolation =
  (typeof MiddlewarePipelineViolation)[keyof typeof MiddlewarePipelineViolation];
type IMiddlewarePipelineViolationHandler = (kind: IMiddlewarePipelineViolation) => void;
```

`late`：stage 函数已经返回后，才调用了它之前保存下来的 `next` 回调。
`duplicate`：同一 stage 在函数体内调用 `next` 超过一次；只有第一次调用的值生效。
`IMiddlewarePipelineViolationHandler` 是所有 runner/adapter 上 `onViolation` 参数的类型；三种 runner 与两个 adapter 都用同一个签名报告。

```ts
const MIDDLEWARE_PIPELINE_SOURCE: '@migaia/middleware-pipeline';

const MiddlewarePipelineErrorCode = {
  executionFailed: 'EXECUTION_FAILED'
} as const;
type IMiddlewarePipelineErrorCode =
  (typeof MiddlewarePipelineErrorCode)[keyof typeof MiddlewarePipelineErrorCode];
```

`MIDDLEWARE_PIPELINE_SOURCE`：本包错误身份的稳定 `source` 字符串，用于 `@migaia/utils` 的 `attachErrorIdentity`/`isUtilsError` 一类工具做来源判定。

`MiddlewarePipelineErrorCode.executionFailed`（`'EXECUTION_FAILED'`）：唯一取值。触发条件：`runAsyncMiddleware` 中，当前 stage 与它已经启动、被等待的 downstream **同时**以普通失败（非 `assertActive` 产生的 active 错误）结束，且调用方未提供 `options.combineStageAndDownstreamError`。

```ts
function createMiddlewarePipelineExecutionError(
  stageError: unknown,
  downstreamError: unknown
): AggregateError & {
  readonly source: typeof MIDDLEWARE_PIPELINE_SOURCE;
  readonly code: IMiddlewarePipelineErrorCode;
};
```

这是默认双失败路径内部使用的错误工厂（未从主入口导出，此处列出用于理解错误形状）：产出一个 `AggregateError([stageError, downstreamError], 'middleware stage and downstream failed')`，并通过 `@migaia/utils` 的 `attachErrorIdentity` 附加只读的 `source: '@migaia/middleware-pipeline'` 与 `code: 'EXECUTION_FAILED'`。两个原始错误始终保留在 `error.errors` 里，可据此还原具体失败原因。

```ts
try {
  await runAsyncMiddleware(stages, value, done, { onViolation: () => undefined });
} catch (error) {
  if ((error as { code?: string }).code === MiddlewarePipelineErrorCode.executionFailed) {
    const [stageError, downstreamError] = (error as AggregateError).errors;
  }
}
```

---

<a id="组合工作流示例"></a>

## 组合工作流示例：混合 sync/async stage 的请求管道

```ts
import {
  adaptSyncStageToAsync,
  MiddlewarePipelineErrorCode,
  MiddlewarePipelineViolation,
  runAsyncMiddleware,
  type IAsyncMiddlewareStage
} from '@migaia/middleware-pipeline';

type IRequest = { readonly path: string; readonly trace: readonly string[] };

// 已有的同步校验逻辑，用适配器接入 async chain，不必重写成 async。
const validateStage = adaptSyncStageToAsync((request: IRequest, next) => {
  if (request.path.length === 0) return; // 短路：空路径直接终止
  next(request);
});

const authStage: IAsyncMiddlewareStage<IRequest> = async (request, next) => {
  await next({ ...request, trace: [...request.trace, 'auth'] });
};

const routeStage: IAsyncMiddlewareStage<IRequest> = async (request, next) => {
  if (request.path === '/health') return; // 短路：跳过路由
  await next({ ...request, trace: [...request.trace, 'route'] });
};

try {
  await runAsyncMiddleware(
    [validateStage, authStage, routeStage],
    { path: '/users', trace: [] },
    (request) => console.log('done', request.trace),
    {
      onViolation: (kind) => {
        if (kind === MiddlewarePipelineViolation.duplicate) console.warn('next called twice');
      }
    }
  );
} catch (error) {
  if ((error as { code?: string }).code === MiddlewarePipelineErrorCode.executionFailed) {
    console.error('stage and downstream both failed', (error as AggregateError).errors);
  } else {
    throw error;
  }
}
```

`adaptSyncStageToAsync` 让既有的同步校验函数无需改写即可参与 async 洋葱模型；`authStage`/`routeStage` 展示 `await next()` 的前后置写法；捕获块按 [`MiddlewarePipelineErrorCode`](#稳定值与错误) 判定双失败，未命中则重新抛出，不吞掉未知错误。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **`done` 没被调用**：sync/generator——某个 stage 没调用 `next()`（sync）或 generator 返回了 halt/隐式 `undefined`；async——同理，且额外检查是否某个中间 stage 的 `Promise` 被吞掉了未 `await`。
- **收到 `duplicate` 诊断**：某 stage 在一次执行中调用 `next` 超过一次；只保留一次调用，async 代码里确保只 `await`/`return` 一次 `next()`。
- **收到 `late` 诊断**：stage 把 `next` 保存下来，在函数返回之后才调用（例如塞进定时器/事件回调）；改用宿主自己的队列/lifecycle 重新发起一次执行，而不是复用已完成的这次调用的 `next`。
- **`runAsyncMiddleware` 抛出 `AggregateError`，`code` 是 `EXECUTION_FAILED`**：说明当前 stage 与它已启动的下游同时失败；`error.errors` 里依次是 `[stageError, downstreamError]`，需要保留领域错误类型时提供 `combineStageAndDownstreamError`。
- **需要一对多广播、而不是单值依次流转**：用 `@migaia/event-subscriber`，本包只做单值链式流转。
- **需要排队、并发限制、drain、取消后台任务、插件安装与生命周期**：这些不在本包范围内，应使用 `@migaia/lifecycle` 或 `@migaia/plugin-host`；本包每次调用只执行一次 chain，不保存跨调用状态，也不提供 `close()`/`dispose()`/`drain()`。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
