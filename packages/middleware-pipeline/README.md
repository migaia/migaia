# `@migaia/middleware-pipeline`

运行时中立、零运行时依赖的 middleware chain 执行器：把一个值依次交给多个 stage，提供 sync、async、generator 三种明确且互不混用的执行代数。

**适用**：已经有一组按顺序运行的拦截器/转换器/middleware，需要明确的短路语义（而不是 `Array.reduce()`）；async stage 需要 `await next()` 在下游完成后继续执行后置逻辑（洋葱模型）；generator stage 需要通过 `yield` 与显式 sentinel 控制值的传播；只想执行一条链，不想为此引入 plugin host、event bus 或 lifecycle runtime。

**不适用**：不要把它当作一对多通知机制（用 event subscriber/event bus）；不要用它做固定的纯函数转换（直接组合函数或 `reduce()` 更简单）；它不提供排队、并发限制、drain、后台任务取消（应由 dispatcher + `@migaia/lifecycle` 管理）；它不管理插件安装、卸载、回滚与资源所有权（用 `@migaia/plugin-host`，本包只是 plugin-host 用来执行 pipeline 的算法层）。

## 安装

```bash
pnpm add @migaia/middleware-pipeline
```

包没有运行时依赖，产物为 ESM，声明 `sideEffects: false`。

## 目录

- [执行器](#执行器)：`runSyncMiddleware`、`runAsyncMiddleware`、`runGeneratorMiddleware`
- [适配器](#适配器)：`adaptSyncStageToAsync`、`adaptSyncStageToGenerator`
- [生成器信号](#生成器信号)：`GENERATOR_CONTINUE`、`GENERATOR_HALT`、`GENERATOR_UNDEFINED`、`MiddlewarePipelineGeneratorSignals`
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
  runGeneratorMiddleware
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
  ' migai ',
  (value) => console.log(value), // 'MIGAIA'
  (violation) => console.warn(violation) // 'late' | 'duplicate'
);
```

全部参数（均为位置参数，无选项对象）：

- `stages: readonly ISyncMiddlewareStage<TValue>[]`（必填）—— 调用前做一次快照，运行中调用方再修改原数组不影响本次执行
- `value: TValue`（必填）—— 传给第一个 stage 的初始值
- `done: (value: TValue) => void`（必填）—— 仅当每个 stage 都调用了 `next()` 时，用最后一个 stage 提交的值调用一次
- `onViolation: IMiddlewarePipelineViolationHandler`（必填，无默认值）—— stage 返回后才调用已保存的 `next` 触发 `'late'`；同一 stage 内调用 `next` 两次触发 `'duplicate'`；只接受第一次调用的值

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
- `done: (value: TValue) => void | Promise<void>`（必填）—— 可返回 `Promise`；若它 reject，该错误按"下游失败"处理（顶层直接从 `runAsyncMiddleware()` 抛出，非顶层时计入触发它的那次 `next()` 的下游失败）
- `options: IMiddlewarePipelineOptions`（必填对象，字段见下）：
  - `onViolation: IMiddlewarePipelineViolationHandler`（必填）—— 语义同 `runSyncMiddleware`
  - `assertActive?: () => void`（可选）—— 在每次进入 stage 前、以及该 stage 与它已启动的下游都结算完毕后（且链尚未整体完成时）各调用一次；抛出的错误被视为"runner 控制流"，只会向上传播这一个 exact 值，不会与普通 stage/downstream 失败合并，也不会经过 `combineStageAndDownstreamError`
  - `combineStageAndDownstreamError?: (stage: unknown, downstream: unknown) => unknown`（可选）—— 当前 stage 与它已启动的下游**同时**以普通失败结束时，用它的返回值作为要抛出的错误；不提供时抛出 `createMiddlewarePipelineExecutionError(stage, downstream)` 产出的 `AggregateError`（见[稳定值与错误](#稳定值与错误)）

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
- `done: (value: TValue) => void`（必填）—— 仅当所有 stage 都未终止链时，用最终值调用一次
- `signals?: IGeneratorMiddlewareSignals`（可选，默认 `MiddlewarePipelineGeneratorSignals`）—— 兼容层可注入自己的 sentinel 集合；普通消费者直接使用默认值即可

return 值语义：普通值 → 作为下一 stage 输入；`signals.continue` → 采用本次迭代最后一次 `yield` 的值；`signals.halt` 或隐式 `undefined`（未显式 `return`）→ 终止整条链、不调用 `done`；`signals.undefined` → 显式把 `undefined` 作为下一 stage 输入（与隐式 `undefined` 的终止行为不同）。

---

<a id="适配器"></a>

## 适配器

```ts
import { adaptSyncStageToAsync, adaptSyncStageToGenerator } from '@migaia/middleware-pipeline';
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

需要自定义 sentinel（例如宿主希望暴露自己的 Symbol）时，构造一个满足 `IGeneratorMiddlewareSignals` 形状的对象传给 `runGeneratorMiddleware` 的第四个参数即可。

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

**`MiddlewarePipelineMode`｜3 秒上手** —— 三种执行代数的稳定值，供调用方标注/分支用，本包内部不消费它：

```ts
MiddlewarePipelineMode; // { sync: 'sync', async: 'async', generator: 'generator' }
```

**`MiddlewarePipelineViolation`｜3 秒上手** —— `onViolation` 回调收到的稳定取值：

```ts
MiddlewarePipelineViolation; // { late: 'late', duplicate: 'duplicate' }
```

**`MIDDLEWARE_PIPELINE_SOURCE`｜3 秒上手** —— 本包错误身份用的稳定 `source` 字符串常量：

```ts
MIDDLEWARE_PIPELINE_SOURCE; // '@migaia/middleware-pipeline'
```

**`MiddlewarePipelineErrorCode`｜3 秒上手** —— 本包拥有的错误码表，目前只有一项：

```ts
MiddlewarePipelineErrorCode; // { executionFailed: 'EXECUTION_FAILED' }
```

`executionFailed`（`'EXECUTION_FAILED'`）：`runAsyncMiddleware` 里当前 stage 与它已经启动的 downstream 同时以普通失败结束、且调用方未提供 `combineStageAndDownstreamError` 时抛出的默认 `AggregateError` 所携带的 code；该错误的 `message` 固定为 `'middleware stage and downstream failed'`，`errors` 数组依次是 `[stageError, downstreamError]`。

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
  '  migai  ',
  (value) => console.log(value), // 'MIGAI'
  { onViolation: (kind) => console.warn('violation:', kind) }
);
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
