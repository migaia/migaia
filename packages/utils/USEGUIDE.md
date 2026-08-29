# `@migaia/utils` 使用指南

本指南逐个模块覆盖公开运行时 API、直接配置所需的关键类型、语义与用法示例。仅用于泛型推导的 type-only helper 以发布的 `.d.ts` 和编辑器提示为准；包的定位与安装方式见 [README](./README.md)。

## 目录

- [`/promise` 模块](#promise-模块)
- [`/error` 模块](#error-模块)
- [`/bytes` 模块](#bytes-模块)
- [`/object` 模块（含对象路径）](#object-模块)
- [`/typing` 模块](#typing-模块)
- [`/config` 模块](#config-模块)
- [`/function` 模块](#function-模块)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="promise-模块"></a>

## `/promise` 模块

处理截止时间、协作式中止、重试与并发限流。所有中止都是**协作式**的：被中止的操作只有在读取传入的 `signal` 并主动提前返回/抛错时才会真正停止；忽略 `signal` 的 I/O 不会被强制打断。

### 调度器类型

```ts
type IScheduledTask = { cancel(): void; unref?(): void };
type IUtilsScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): IScheduledTask;
};
type IManualScheduler = IUtilsScheduler & {
  advance(ms: number): void;
  readonly pendingCount: number;
};
```

- `IUtilsScheduler`：可注入的时间源，`now()` 返回当前时刻，`schedule()` 安排一次性回调并返回可取消的句柄。
- `IManualScheduler`：额外提供 `advance(ms)`（手动推进虚拟时间，触发到期回调）与 `pendingCount`（未取消的待执行任务数），用于确定性单测。

```ts
export const systemScheduler: IUtilsScheduler;
```

基于原生 `setTimeout`/`clearTimeout` 的默认调度器，`schedule()` 返回的句柄在宿主支持时会转发 `unref()`（避免测试/进程因悬挂定时器无法退出）。

```ts
function createManualScheduler(): IManualScheduler;
```

创建一个 FIFO 虚拟时钟调度器：`schedule()` 按 `到期时间 → 注册顺序` 排队；调用 `advance(ms)` 会一次性执行所有到期回调（回调内部再 `schedule` 的新任务，只要到期时间 `<= 目标时刻` 也会在同一次 `advance` 内继续触发）。`advance` 单次循环超过 10000 次会抛 `RangeError`（防止回调间互相递归调度导致死循环）。`delayMs`/`ms` 必须是有限的非负数，否则抛 `RangeError`。

```ts
const scheduler = createManualScheduler();
const task = scheduler.schedule(() => console.log('fired'), 100);
scheduler.advance(50); // 未触发
scheduler.advance(50); // 触发，打印 'fired'
```

### `deferred`

```ts
type IDeferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};
function deferred<T>(): IDeferred<T>;
```

创建一个可从外部结算的原生 Promise。适合把回调式 API 转成 Promise，或在测试中手动控制某个异步操作何时完成/失败。

```ts
const { promise, resolve } = deferred<number>();
setTimeout(() => resolve(42), 0);
await promise; // 42
```

### `toPromise`

```ts
function toPromise<T>(run: () => T): Promise<Awaited<T>>;
```

同步且恰好调用 `run` 一次，并用原生 Promise 规则同化返回值。若 `run` 同步抛出，调用点不会同步抛错，而是返回以 exact reason reject 的 Promise。它只负责同步计算到 Promise 的规范化，不创建 timer、scheduler、retry 或 cancellation 状态。

```ts
const found = await toPromise(() => cache.get('key'));
const pending = toPromise(() => {
  throw new Error('read failed');
});
await pending; // 异步观察 rejection
```

### `sleep`

```ts
function sleep(delayMs: number, options?: IAsyncControls): Promise<void>;
```

在调度器延迟后 resolve；若传入的 `signal`/`signals` 在等待期间中止，则以 `UtilsAbortError` reject。`delayMs` 必须是有限非负数。会正确清理已注册的定时器与 abort 监听器，即使清理过程本身抛错也会通过 `hostRethrowReporter`（或调用方指定的 reporter）上报，而不是吞掉。

```ts
type IAsyncControls = {
  readonly signal?: IAbortSignal;
  readonly signals?: readonly IAbortSignal[];
  readonly scheduler?: IUtilsScheduler;
  readonly unref?: boolean;
};
```

`signal` 与 `signals` **互斥**——同时提供两者会 reject 一个 `TypeError`。`unref: true` 会尝试调用底层定时器句柄的 `unref()`（Node 环境下避免阻塞进程退出）。

```ts
const controller = new AbortController();
const p = sleep(1000, { signal: controller.signal as any });
controller.abort('cancelled');
await p; // 抛 UtilsAbortError，cause 为 'cancelled'
```

### `createAbortTimeoutSignal`

```ts
type IAbortTimeoutSignalOptions = {
  readonly signal?: IAbortSignal;
  readonly timeoutMs?: number;
  readonly scheduler?: IUtilsScheduler;
  readonly timeoutReason?: () => unknown;
  readonly report?: IUtilsReporter;
};
type IAbortTimeoutSignal = {
  readonly signal: IAbortSignal | undefined;
  readonly dispose: () => void;
};
function createAbortTimeoutSignal(options?: IAbortTimeoutSignalOptions): IAbortTimeoutSignal;
```

创建一个可交给多个底层请求共享的 operation signal，但不创建、race 或结算业务 Promise。外部 signal 先中止时保留原始 reason；deadline 先到时使用 `timeoutReason()` 的返回值。reason factory 抛出的原始错误会成为 signal reason，不会从 timer callback 逃逸。无 `timeoutMs` 时透传外部 signal identity；`dispose()` 幂等并负责取消 timer、移除 listener，cleanup 失败通过 `report` 的 `operation: 'abort-timeout-signal'` 上报。

```ts
const merged = createAbortTimeoutSignal({
  signal: controller.signal as any,
  timeoutMs: 500,
  timeoutReason: () => new Error('deadline')
});
try {
  await Promise.all([requestA(merged.signal), requestB(merged.signal)]);
} finally {
  merged.dispose();
}
```

`withTimeout` / `raceWithAbort` 的 callback 也能把同一 cooperative signal 交给多个请求，但它们同时拥有最终 Promise 的超时/中止 reject、late rejection 与 cleanup-error 政策。若事务 commit 才是唯一结算事实，应使用本 signal-only primitive，并由适配器自己决定 Promise 何时完成。

### `withTimeout`

```ts
type ITimeoutOperation<T> = (context: { readonly signal: IAbortSignal }) => T | PromiseLike<T>;

function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IAsyncControls & {
    readonly timeoutMs: number;
    readonly report?: IUtilsReporter;
    readonly zeroTimeoutBehavior?: 'skip' | 'start';
    readonly cooperativeCancellation?: boolean;
  }
): Promise<T>;
```

用截止时间包裹一个惰性操作。`operation` 收到的 `signal` 是**内部生成的合并信号**：外部 `signal(s)` 中止、或截止时间到达，都会让这个 `signal` 变为 `aborted`；操作函数必须自行检查它才能提前退出。

- `timeoutMs`：必须是有限非负数；`timeoutMs === 0` 时默认立即以 `UtilsTimeoutError('operation', 0)` reject（除非 `zeroTimeoutBehavior: 'start'`，此时改为立刻启动操作、不设超时）。
- `cooperativeCancellation`（默认 `true`）：为 `false` 时不分配内部 `AbortController`，操作函数只会拿到一个惰性的、恒不中止的信号——用于纯粹的"限时等待结果，但不需要通知操作提前退出"的场景。
- `report`：当操作在已经结算（超时/被外部中止）之后才 resolve/reject，这个迟到的结果不会再影响最终返回值，但会经由 `report`（默认 `hostRethrowReporter`）上报，避免静默丢弃未处理的错误。
- 清理阶段（取消定时器、移除监听器）失败时，会把清理错误与原始错误一起包装成 `AggregateError` 一并 reject。

```ts
await withTimeout(
  async ({ signal }) => {
    while (!signal.aborted) {
      // 做一些可中断的工作
    }
    throw signal.reason;
  },
  { timeoutMs: 500 }
); // 500ms 后以 UtilsTimeoutError('operation', 500) reject
```

### `raceWithAbort`

```ts
type IAbortOperation<T> = ITimeoutOperation<T>;

function raceWithAbort<T>(
  operation: IAbortOperation<T>,
  options?: Pick<IAsyncControls, 'signal' | 'signals'> & {
    readonly report?: IUtilsReporter;
    readonly cleanupPolicy?: 'reject' | 'report';
  }
): Promise<T>;
```

与 `withTimeout` 语义相同，但**不设置截止时间定时器**，只在外部 `signal(s)` 中止时让操作提前失败。`cleanupPolicy: 'report'`（默认 `'reject'`）让监听器清理失败时改为上报诊断而不是让最终 Promise reject。

```ts
const controller = new AbortController();
const result = raceWithAbort(({ signal }) => fetchSomething({ signal }), {
  signal: controller.signal as any
});
```

### `retry`

```ts
type IRetryContext = {
  readonly attempt: number;
  readonly signal: IAbortSignal;
  readonly remainingMs?: number;
};
type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number };

function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: {
    readonly maxAttempts: number;
    readonly shouldRetry: (
      error: unknown,
      context: IRetryFailureContext
    ) => boolean | PromiseLike<boolean>;
    readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number);
    readonly totalTimeoutMs?: number;
    readonly attemptTimeoutMs?: number;
    readonly signal?: IAbortSignal;
    readonly signals?: readonly IAbortSignal[];
    readonly zeroTimeoutBehavior?: 'skip' | 'start';
    readonly report?: IUtilsReporter;
    readonly unref?: boolean;
    readonly scheduler?: IUtilsScheduler;
  }
): Promise<T>;
```

串行重试，带三层限制：

- `maxAttempts`：必须是正安全整数，第 `maxAttempts` 次仍失败则直接抛出最后一次的错误。
- `attemptTimeoutMs`：每次尝试单独的超时（内部用 `withTimeout` 包裹）。
- `totalTimeoutMs`：整个重试过程（包含所有尝试与退避等待）的总截止时间；超出会抛 `UtilsTimeoutError('total', totalTimeoutMs)`。
- `shouldRetry(error, context)`：决定某次失败是否值得重试；返回 `false` 或 `maxAttempts` 已用尽都会终止重试并抛出该错误。
- `delay`：固定毫秒数或 `(error, context) => 毫秒数` 的退避函数，作用于两次尝试之间的等待（通过内部 `sleep`，同样遵守 `signal`/`signals`）。
- 外部信号在重试过程中的任意时刻中止，都会以 `UtilsAbortError` 结束整个重试，不再进入下一次尝试。

```ts
await retry(
  async ({ attempt }) => {
    if (attempt < 3) throw new Error('boom');
    return 'ok';
  },
  { maxAttempts: 5, shouldRetry: () => true, delay: (_, { attempt }) => attempt * 100 }
); // 'ok'，共尝试 3 次，两次退避分别约 100ms/200ms
```

### `hostRethrowReporter` 与 `IUtilsReporter`

```ts
type IUtilsReporter = (
  error: unknown,
  context: {
    readonly operation: 'withTimeout' | 'raceWithAbort' | 'retry' | 'sleep' | 'limiter';
    readonly phase: 'late-rejection' | 'cleanup' | 'reporter';
    readonly attempt?: number;
  }
) => void;
const hostRethrowReporter: IUtilsReporter;
```

`hostRethrowReporter` 是默认诊断上报器：把错误通过 `queueMicrotask` 重新抛出（在不支持 `queueMicrotask` 的环境下同步抛出），使其成为未捕获异常，交由宿主（进程/浏览器）的全局错误处理机制记录，而不是被静默吞掉。自定义 `report` 选项可以替换为日志上报、埋点等。

### `createConcurrencyLimiter`

```ts
type IConcurrencyLimiter = {
  run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  whenIdle(): Promise<void>;
  close(reason?: unknown): void;
  dispose(reason?: unknown): Promise<void>;
};
function createConcurrencyLimiter(options: {
  readonly concurrency: number;
  readonly report?: IUtilsReporter;
}): IConcurrencyLimiter;
```

本包中**唯一具有跨调用生命周期**的原语——一个带并发上限的 FIFO 任务队列：

- `run(task, { signal })`：把任务加入队列，达到 `concurrency` 上限前的任务立即执行，之后排队等待空位；传入的 `signal` 中止会让**排队中**的任务立即以其中止原因 reject（已开始执行的任务不受影响，需任务自身读取 `context.signal`）。
- `activeCount` / `pendingCount`：当前正在执行 / 排队等待（未取消）的任务数。
- `whenIdle()`：返回一个在"当前没有活跃任务且队列已清空"时 resolve 的 Promise；多次调用共享同一个等待，不会重复注册。
- `close(reason?)`：停止接纳新任务与排队任务——已排队但未执行的任务立即以 `reason`（默认一个 `LIMITER_CLOSED` 错误）reject；正在执行的任务不受影响。
- `dispose(reason?)`：调用 `close()` 并返回一个在所有活跃任务结束后才 resolve 的 Promise，用于优雅关闭。

`concurrency` 必须是正安全整数，否则构造时抛 `RangeError`。

```ts
const limiter = createConcurrencyLimiter({ concurrency: 2 });
const results = await Promise.all([1, 2, 3, 4].map((n) => limiter.run(() => fetchPage(n))));
await limiter.dispose(); // 等待剩余任务完成后关闭
```

---

<a id="error-模块"></a>

## `/error` 模块

统一的错误身份、包装与因果链遍历工具。

```ts
abstract class UtilsError extends Error {
  readonly source = '@migaia/utils';
  readonly code: IUtilsErrorCode;
}
class UtilsAbortError extends UtilsError {
  readonly name = 'AbortError';
  constructor(reason?: unknown);
}
class UtilsTimeoutError extends UtilsError {
  readonly name = 'TimeoutError';
  readonly scope: 'operation' | 'attempt' | 'total';
  readonly timeoutMs: number;
  constructor(scope: 'operation' | 'attempt' | 'total', timeoutMs: number);
}
```

`UtilsError` 是抽象基类，所有本包抛出的语义化错误都携带 `source: '@migaia/utils'` 与稳定的 `code`。`UtilsAbortError` 通过 `cause` 保留原始中止原因；`UtilsTimeoutError` 额外携带 `scope`（超时发生在单次操作 / 单次尝试 / 总截止时间的哪一层）与 `timeoutMs`。

```ts
function attachErrorIdentity<T extends Error>(
  error: T,
  identity: {
    readonly source: string;
    readonly code: string;
    readonly phase?: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  }
): T;
```

就地给一个已存在的错误对象追加不可写的身份字段（`source`/`code`/`phase`/`detail`），**不会**替换或包装该错误。如果同一字段已存在且值不同，会抛出 `TypeError`（避免悄悄覆盖其他代码写入的身份信息）；值相同则视为幂等，直接返回。

```ts
const error = new Error('boom');
attachErrorIdentity(error, { source: 'my-package', code: 'FETCH_FAILED' });
error.code; // 'FETCH_FAILED'
```

```ts
function toError(value: unknown, options?: { readonly message?: string }): Error;
```

把任意 `throw` 出来的值规整为 `Error` 实例：已经是 `Error` 的原样返回；否则包装成携带 `cause: value` 的内部错误类型，消息优先取 `options.message`，其次（当抛出值本身是字符串时）取该字符串，否则用固定的兜底文案。

```ts
function walkErrorCauses(
  error: unknown,
  options?: { readonly maxDepth?: number }
): readonly unknown[];
```

按 `cause` 链与 `AggregateError.errors` 展开遍历，返回访问到的全部节点（含起始 `error` 自身），用 `Set` 做同一值去重防止环路。`maxDepth`（默认 32）限制最大深度，超出后停止继续下探那一支。

```ts
try {
  throw new Error('outer', { cause: new Error('inner') });
} catch (error) {
  walkErrorCauses(error); // [outerError, innerError]
}
```

```ts
function combineErrors(errors: Iterable<unknown>, message: string): Error | undefined;
```

把 0 个、1 个或多个错误合并：0 个返回 `undefined`；1 个原样返回（经 `toError` 规整）；多个包装成 `AggregateError(errors, message)`。如果遍历 `errors` 这个 `Iterable` 本身抛错，会把已收集的错误连同该次遍历失败一起打包进 `AggregateError` 再抛出。

```ts
function isUtilsError(value: unknown): value is UtilsError;
function isUtilsAbortError(value: unknown): value is UtilsAbortError;
function isUtilsTimeoutError(value: unknown): value is UtilsTimeoutError;
```

标准的 `instanceof` 类型守卫，便于在 `catch` 块中按类型分支处理。

### `UtilsErrorCode`

```ts
const UtilsErrorCode = {
  invalidArgument: 'INVALID_ARGUMENT',
  nonErrorValue: 'NON_ERROR_VALUE',
  envUnsupported: 'ENV_UNSUPPORTED',
  aborted: 'ABORTED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  schedulerRunaway: 'SCHEDULER_RUNAWAY',
  errorIdentityConflict: 'ERROR_IDENTITY_CONFLICT',
  cloneUnsupported: 'CLONE_UNSUPPORTED',
  invalidEncoding: 'INVALID_ENCODING',
  limiterClosed: 'LIMITER_CLOSED',
  reentrantCall: 'REENTRANT_CALL',
  configUnsupported: 'CONFIG_UNSUPPORTED',
  configReadonly: 'CONFIG_READONLY',
  configConflict: 'CONFIG_CONFLICT',
  configLimitExceeded: 'CONFIG_LIMIT_EXCEEDED',
  configPathInvalid: 'CONFIG_PATH_INVALID',
  objectPathInvalid: 'OBJECT_PATH_INVALID'
} as const;
```

全包统一使用的稳定语义码，`IUtilsErrorCode` 是其取值的联合类型。除 `UtilsError` 子类外，`base64ToBytes`/`object-path`/`config` 等模块抛出的原生 `TypeError`/`RangeError` 也会通过 `Object.defineProperty` 挂上对应的 `code`（与 `source: '@migaia/utils'`），可用同一套判断逻辑识别。

---

<a id="bytes-模块"></a>

## `/bytes` 模块

不依赖 Node `Buffer` 或 DOM 的字节/文本编解码，纯 ECMAScript 实现。

```ts
function isUint8Array(value: unknown): value is Uint8Array;
function isArrayBuffer(value: unknown): value is ArrayBuffer;
```

两个 guard 通过引擎的 `%TypedArray%.prototype[Symbol.toStringTag]` 与 `ArrayBuffer.prototype.byteLength` 内部槽 getter 判定真实品牌，因此能识别跨 iframe/Worker realm 的合法实例与子类，同时拒绝 `constructor.name` / 原型 / `Symbol.toStringTag` 伪造、其他 TypedArray、`DataView`、`SharedArrayBuffer` 和 Proxy。检测不读取候选值的用户属性。

detached `Uint8Array` / `ArrayBuffer` 仍返回 `true`：detachment 不改变对象品牌，但会影响读取能力；需要消费字节的调用方仍须独立处理 detached 状态。

```ts
function bytesToBase64(value: Uint8Array): string;
```

按 RFC 4648 规范字母表编码为标准（非 URL-safe）、带 `=` 补齐的 Base64 字符串。

```ts
function base64ToBytes(value: string): Uint8Array;
```

**只接受规范形式**：标准字母表、必须 4 的倍数长度、正确的 `=` 补齐。非规范输入（URL-safe 变体、无补齐、多余空白等）一律拒绝，抛出携带 `code: 'INVALID_ENCODING'` 的 `TypeError`。解码后会反向编码校验往返一致性，进一步拒绝虽然长度/字符集正确但数值不对齐的输入。

```ts
bytesToBase64(new Uint8Array([1, 2, 3])); // 'AQID'
base64ToBytes('AQID'); // Uint8Array [1, 2, 3]
base64ToBytes('AQID-_'); // 抛 TypeError（URL-safe 字符不被接受）
```

```ts
function* streamBase64Chunks(value: Uint8Array, maxChunkBytes?: number): Iterable<string>;
```

把大字节数组切分成多个**各自独立合法**的 Base64 片段（每片段都在 3 字节边界上切分，因此每片段自身都能正确解码，不需要拼接后才合法）。`maxChunkBytes` 默认 `32763`，必须是 `>= 3` 的安全整数；实际切分宽度会向下取整到 3 的倍数。

```ts
function utf8ByteLength(value: string): number;
```

计算字符串编码为 UTF-8 后的字节数，不分配缓冲区（正确处理代理对/非法代理，用 U+FFFD 的宽度 3 计入非法代理）。

```ts
function encodeUtf8(value: string): Uint8Array;
function decodeUtf8(value: Uint8Array, options?: { readonly fatal?: boolean }): string;
```

`encodeUtf8` 编码为新分配的 UTF-8 字节数组。`decodeUtf8` 解码：`fatal: false`（默认）遇到非法字节序列时用 U+FFFD 替换并跳过 1 字节继续；`fatal: true` 时直接抛出携带偏移量的编码错误。

```ts
function splitUtf8(value: string, maxBytes: number): readonly string[];
```

把字符串按码点边界切分成若干子串，保证每个子串编码后的字节数不超过 `maxBytes`（绝不会在一个码点中间切断）。`maxBytes` 必须是 `>= 4` 的安全整数（4 是单个码点的最大 UTF-8 宽度）。空字符串返回 `['']`。

```ts
splitUtf8('你好世界', 6); // 每个汉字 3 字节 → ['你好', '世界']
```

---

<a id="object-模块"></a>

## `/object` 模块（含对象路径）

### 快照与探测

```ts
function isPlainObject(value: unknown): value is Record<PropertyKey, unknown>;
```

仅当 `value` 是普通 `{}` 字面量或 `Object.create(null)` 创建的对象时返回 `true`；数组、`class` 实例、内置对象（`Date`/`Map`/...）一律 `false`。读取原型链失败（代理陷阱抛错）时同样返回 `false`，不会向上抛错。

```ts
type IProbePropertyResult<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown };
function probeProperty<T>(value: object, key: PropertyKey): IProbePropertyResult<T>;
```

读取单个属性且只读取一次（避免 getter 被调用两次产生副作用）：属性不存在返回 `missing`；读取（包括触发 getter）抛错返回 `failed` 并携带原始错误；否则返回 `value`。

```ts
function immutableSnapshot<T>(value: T): T;
```

基于宿主原生 `structuredClone` 做深拷贝。宿主不提供 `structuredClone` 时抛出 `code: 'ENV_UNSUPPORTED'` 的 `TypeError`；值本身不可结构化克隆（例如包含函数）时抛出 `code: 'CLONE_UNSUPPORTED'` 的 `TypeError`。

```ts
type ISnapshotDiagnostic = {
  readonly path: readonly PropertyKey[];
  readonly reason: 'accessor' | 'read-failed' | 'unsupported';
  readonly cause: unknown;
};
type IDiagnosticSnapshot<T> = {
  readonly value: T;
  readonly diagnostics: readonly ISnapshotDiagnostic[];
};
function diagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>;
function structuredDiagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>;
```

比 `immutableSnapshot` 更宽容的尽力而为深拷贝：只递归普通对象与数组；遇到函数、class 实例等不支持的类型时**保留原值原样放入快照**（不报错），同时在 `diagnostics` 里记一条 `reason: 'unsupported'`；访问器属性会记 `reason: 'accessor'` 并克隆其读取到的值；读取失败记 `reason: 'read-failed'` 并回退保留原始属性描述符。用循环引用检测（`WeakMap`）保证成环的输入也能安全返回。适合"尽量拷贝，同时如实报告哪些部分没能安全拷贝"的诊断场景。

`structuredDiagnosticSnapshot` 优先尝试原生 `structuredClone`，成功时 diagnostics 为空；宿主不支持或克隆失败时自动退回上述尽力快照，并在根路径追加 `unsupported` 或携带原始 cause 的 `read-failed` 诊断。需要“能克隆就完整克隆、否则仍返回可观测降级结果”的遥测边界优先使用它。

```ts
function identitySnapshot<T>(value: T): T;
```

原样返回入参——用于在需要"显式选择不做拷贝、保留引用同一性"的调用点表达意图（比对 `immutableSnapshot`/`diagnosticSnapshot` 使代码可读，而不是漏写了拷贝调用）。

### 对象路径（`parseObjectPath` / `probeObjectPath` / `get` / `set` / `createPathAccessor`）

对象路径支持两种输入形式：

- **字符串路径**：`a.b.c`、数组用方括号下标 `list.[0].name`。
- **元组路径**：`readonly ['a', 'b', 'c']` 或 `readonly ['list', 0, 'name']`，可包含 `symbol` 键（字符串路径不能表达 symbol）。

两种形式共享同一套安全限制：单段最长 512 字符、路径最多 256 段、字符串路径总长不超过 4096 字符；`__proto__`/`prototype`/`constructor` 一律被拒绝（防止原型污染）。

```ts
function parseObjectPath(path: string | IObjectPathTuple): IObjectPathTuple;
```

把字符串路径解析成规范化的 `readonly` 段元组（数字下标解析成 `number`），或校验并冻结一个已给定的元组路径。任何越界/危险段都会抛出携带 `code: 'OBJECT_PATH_INVALID'` 的 `TypeError`。

```ts
type IPathValueProbe<T, P extends IObjectPathInput<T>> = {
  readonly kind: 'value';
  readonly originKey: P;
  readonly segments: IObjectPathTuple;
  readonly value: IObjectPathValue<T, P>;
};
type IPathMissingProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'missing';
  readonly originKey: P;
  readonly segments: IObjectPathTuple;
  readonly failedAt: number;
  readonly failedKey: IObjectPathSegment;
  readonly resolvedPath: IObjectPathTuple;
  readonly parent: unknown;
};
type IPathBlockedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'blocked';
  readonly originKey: P;
  readonly segments: IObjectPathTuple;
  readonly failedAt: number;
  readonly failedKey: IObjectPathSegment;
  readonly resolvedPath: IObjectPathTuple;
  readonly parent: unknown;
};
type IPathFailedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'failed';
  readonly originKey: P;
  readonly segments: IObjectPathTuple;
  readonly failedAt: number;
  readonly failedKey: IObjectPathSegment;
  readonly resolvedPath: IObjectPathTuple;
  readonly parent: unknown;
  readonly error: unknown;
};
type IPathProbe<T, P extends IObjectPathInput<T>> =
  | IPathValueProbe<T, P>
  | IPathMissingProbe<P>
  | IPathBlockedProbe<P>
  | IPathFailedProbe<P>;

function probeObjectPath<T, P extends IObjectPathInput<T>>(object: T, path: P): IPathProbe<T, P>;
function probeObjectPathSegments<T, P extends IObjectPathInput<T>>(
  object: T,
  segments: P
): IPathProbe<T, P>;
```

沿路径逐段探测，每段只读取一次。四种结果分别对应：**成功取到值**（`value`，携带 `value`）、**某一段属性不存在**（`missing`）、**某一段的父值不是对象/函数因而无法继续深入**（`blocked`，例如路径指向 `a.b.c` 但 `a.b` 是 `null` 或字符串）、**某一段读取本身抛出异常**（`failed`，例如触发了会抛错的 getter，携带 `error`）。

四种结果共有字段 `originKey`（原始传入的 `path`，未加工）与 `segments`（`parseObjectPath` 解析后的完整段元组）；`missing`/`blocked`/`failed` 额外共有 `failedAt`（第几段失败，0-based）、`failedKey`（失败的那一段键）、`resolvedPath`（成功解析到的前缀路径，即 `segments` 中 `failedAt` 之前的部分）、`parent`（失败发生时的父级值——`missing`/`failed` 时是该属性所属的对象，`blocked` 时是那个非对象的原始值本身）。`failed` 唯一多出 `error` 字段，携带原始抛出值。

`probeObjectPathSegments` 接受已经由调用方校验/缓存的段元组，跳过再次解析；结果语义与 `probeObjectPath` 完全相同。只有能保证 segments 已通过同一安全约束的高频内部路径才应使用它，外部字符串输入继续交给 `probeObjectPath`。

```ts
function get<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P
): IObjectPathValue<T, P> | undefined;
```

基于 `probeObjectPath` 的简化读取：`missing`/`blocked` 统一返回 `undefined`；`failed`（读取本身抛错）会**原样重新抛出**该错误，不会被静默吞掉——这一点区别于"路径不存在"，调用方需要分别处理。

```ts
const data = { user: { name: 'Ada' } };
get(data, 'user.name'); // 'Ada'
get(data, 'user.missing'); // undefined（missing）
get(data, 'user.name.x'); // undefined（blocked：'Ada' 是字符串，无法继续深入 .x）
```

```ts
function set<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P,
  nextValue: IObjectPathWriteValue<T, P>
): T;
```

不可变路径写入：返回一个新的根对象，只有路径上真正发生变化的节点被浅拷贝（结构共享，未涉及的兄弟节点保持同一引用）。路径中间缺失的容器会按下一段键的类型自动创建（数字键 → `[]`，其他 → `{}`）。若路径中途遇到非空的原始值（字符串、数字等，无法继续深入）会抛出 `code: 'OBJECT_PATH_INVALID'` 的 `TypeError`。若新值与旧值经 `Object.is` 相等，则直接复用原对象，不做任何拷贝。

```ts
const before = { user: { name: 'Ada', tags: ['a'] } };
const after = set(before, 'user.name', 'Grace');
after.user.name; // 'Grace'
after.user.tags === before.user.tags; // true（未涉及的分支保持引用不变）
before.user.name; // 'Ada'（原对象未被修改）
```

```ts
type IPathGetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P;
  readonly segments: IObjectPathTuple;
  readonly probe: IPathValueProbe<T, P>;
  readonly value: IObjectPathValue<T, P>;
  replace(value: IObjectPathValue<T, P>): void;
};
type IPathSetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P;
  readonly segments: IObjectPathTuple;
  readonly probe: IPathValueProbe<T, P>;
  readonly value: IObjectPathWriteValue<T, P>;
  replace(value: IObjectPathWriteValue<T, P>): void;
};
type IPathAccessorOptions<T> = {
  readonly ifMissing?: (probe: IPathMissingProbe) => void;
  readonly ifBlocked?: (probe: IPathBlockedProbe) => void;
  readonly ifFailed?: (probe: IPathFailedProbe) => void;
  readonly onGet?: (event: IPathGetEvent<T>) => void;
  readonly onSet?: (event: IPathSetEvent<T>) => void;
};
type IPathAccessor<T> = {
  readonly value: T;
  get<P extends IObjectPathInput<T>>(path: P): IObjectPathValue<T, P> | undefined;
  set<P extends IObjectPathInput<T>>(path: P, value: IObjectPathWriteValue<T, P>): T;
  probeValue<P extends IObjectPathInput<T>>(path: P): IPathProbe<T, P>;
  parsePath(path: string | IObjectPathTuple): IObjectPathTuple;
};
function createPathAccessor<T>(object: T, options?: IPathAccessorOptions<T>): IPathAccessor<T>;
```

封装一个**内部持有当前根对象**的有状态访问器：每次 `set()` 成功后，`accessor.value` 自动前进到写入后的新根（后续 `get`/`set` 都基于最新根）。`ifMissing`/`ifBlocked`/`ifFailed` 在对应探测结果出现时被调用，用作集中式诊断钩子。

`onGet`/`onSet` 在每次成功读/写时被调用，事件对象字段：`originKey`（原始传入路径）、`segments`（解析后的段元组）、`probe`（本次读/写命中的 `IPathValueProbe`，即成功探测结果）、`value`（本次实际读到/将要写入的值）、`replace(value)`（调用后就地改写本次读取/写入的实际返回值/写入值，例如做统一的默认值填充或写入前校验/转换）。`IPathGetEvent`/`IPathSetEvent` 唯一的区别是 `value`/`replace` 的类型：读事件用 `IObjectPathValue`（读到的原值类型），写事件用 `IObjectPathWriteValue`（字面量放宽后的可写类型）。

```ts
const accessor = createPathAccessor(
  { count: 0 },
  { onSet: (event) => console.log('write', event.originKey, event.value) }
);
accessor.set('count', 5); // 打印 write count 5
accessor.value; // { count: 5 }
```

对应的类型工具（用于给调用方提供编译期路径补全与值类型推断）：`IObjectPathSegment`、`IObjectPathTuple`、`IObjectPath<T>`（字符串路径，最深 8 层）、`IObjectPathTupleFor<T>`（元组路径）、`IObjectPathInput<T>`（两者联合）、`IObjectPathValue<T, P>`（路径指向的值类型）、`IObjectPathWriteValue<T, P>`（写入时接受的类型，字面量类型会被适度放宽为其基础类型，例如字面量联合放宽为 `string`/`number`/`boolean`/`bigint`）。

---

<a id="typing-模块"></a>

## `/typing` 模块

`@migaia/utils/typing`（`src/typing.ts`）是**纯 type-only** 的子入口：文件里全部是 `export type`，没有任何运行时值，构建产物 `dist/typing.js` 不含可执行代码。它**不经由根入口 `@migaia/utils` 重新导出**——只能写 `import type { ... } from '@migaia/utils/typing'`，这是刻意的：把类型出口和运行时出口分开，消费方按类型引用它时不会因为模块解析牵连进任何运行时代码。

它做两件事：

1. **重导出**已在别处定义的类型，给跨包类型复用一个稳定、单一的入口，避免消费方为了拿一个类型而要记住它散落在 `/object` 还是 `/promise`：
   - 来自 `/object`（即 `object-path.ts`）：`IObjectPath`、`IObjectPathInput`、`IObjectPathSegment`、`IObjectPathTuple`、`IObjectPathTupleFor`、`IObjectPathValue`、`IObjectPathWriteValue`
   - 来自 `/object`（即 `object.ts`）：`IProbePropertyResult`
   - 来自 `/promise`：`IAbortSignal`、`IDeferred`

   这些类型的语义、字段、约束与它们各自源模块中的定义完全一致（同一个类型的两个入口，不是两份独立定义），完整说明见 [`/object` 模块](#object-模块)与 [`/promise` 模块](#promise-模块)对应章节。

2. **新增**两个 `/object` 模块本身不提供的类型工具，用于把带判别字段的联合类型（discriminated union）转成"判别值 → 对应联合分支"的映射类型：

```ts
/** 按一个顶层、值为 PropertyKey 的判别字段对联合类型分组。 */
type IDiscriminatedByField<F extends PropertyKey, T extends Record<F, PropertyKey>> = {
  [K in T[F]]: Extract<T, Record<F, K>>;
};
```

- 类型参数 `F extends PropertyKey`：判别字段名（`string`/`number`/`symbol`）。
- 类型参数 `T extends Record<F, PropertyKey>`：目标联合类型本身；约束要求 `T` 每个成员上 `F` 对应的字段值都必须是 `PropertyKey`——如果某个分支的该字段是对象等非 `PropertyKey` 类型，`T` 就不满足 `Record<F, PropertyKey>` 约束，直接编译报错（不是运行时报错，是这个类型工具压根用不起来）。
- 结果：一个以 `T[F]` 的每个字面量值为 key、value 是 `Extract<T, Record<F, K>>`（该判别值对应的联合分支，若多个分支共享同一判别值则保留为它们的联合）的映射类型。

```ts
/** 按一个 string 或 tuple 对象路径对联合类型分组，路径解析规则与 /object 模块的 IObjectPath 完全一致。 */
type IDiscriminatedByPath<T, P extends IObjectPathInput<T>> = {
  [K in Extract<IObjectPathValue<T, P>, PropertyKey>]: IExtractDiscriminatedByPath<T, P, K>;
};
```

- 类型参数 `T`：目标联合类型本身。
- 类型参数 `P extends IObjectPathInput<T>`：字符串路径（如 `'meta.category'`）或元组路径（如 `readonly ['meta', 'category']`），和 `get`/`set`（`/object` 模块）接受的路径写法完全相同。
- 路径必须在联合的**每一个分支**上都能解析出值，且该值必须收窄到 `PropertyKey`；哪个分支上路径不存在/类型不对，该分支在实现细节上通过条件类型被排除出结果（不是抛运行时错误——这纯粹是类型层行为，错误的路径在 TypeScript 编译期就直接报错，不会产出一个"缺分支"的类型让你在运行时才发现）。
- 结果：以路径解析出的每个字面量判别值为 key，value 是对应的联合分支（同判别值的多个分支合并为联合）。

**用法示例**（摘自包自带测试 `test/typing.test.ts`，行为已用 `expectTypeOf` 验证）：

```ts
type IEvent =
  | {
      readonly type: 'created';
      readonly meta: { readonly category: 'write' };
      readonly payload: { readonly userId: string };
    }
  | {
      readonly type: 'deleted';
      readonly meta: { readonly category: 'write' };
      readonly payload: { readonly reason: string };
    }
  | {
      readonly type: 'read';
      readonly meta: { readonly category: 'read' };
      readonly payload: { readonly cache: boolean };
    };

type IByType = IDiscriminatedByField<'type', IEvent>;
// { created: Extract<IEvent, { type: 'created' }>; deleted: ...; read: ... }

type IByCategory = IDiscriminatedByPath<IEvent, 'meta.category'>;
// { write: 'created' | 'deleted' 两个分支的联合; read: 'read' 分支 }

type IByTupleCategory = IDiscriminatedByPath<IEvent, readonly ['meta', 'category']>;
// 与 IByCategory 完全等价——字符串路径和元组路径是同一套解析逻辑的两种写法
```

**编译期会拒绝的用法**（同样摘自测试文件）：

```ts
// @ts-expect-error 路径在联合的某些/全部分支上不存在，判别提取前就被拒绝
type IInvalid1 = IDiscriminatedByPath<IEvent, 'meta.unknown'>;

type INotPropertyKey = { readonly discriminator: { readonly nested: true } };
// @ts-expect-error 判别字段的值是对象，不满足 PropertyKey 约束，无法作为映射类型的 key
type IInvalid2 = IDiscriminatedByField<'discriminator', INotPropertyKey>;
```

---

<a id="config-模块"></a>

## `/config` 模块

带**所有权语义**的配置对象：只有经 `ownConfig` 接纳的对象才能被 `readonlyConfig`/`patchConfig`/`readConfigPath`/`combineConfig` 处理，用运行时 `WeakMap` 元数据（而非可伪造的字段）标记"这是一个受本包管理的配置根"。

```ts
const ConfigProfile = { data: 'data', richRuntime: 'richRuntime' } as const;
type IConfigProfile = 'data' | 'richRuntime';
```

`data`（默认）：只接受可移植的纯数据——普通对象、数组、`Date`/`RegExp`/`Map`/`Set` 等内置类型；**拒绝函数**。`richRuntime`：额外接受函数/可构造类（连同其自身属性与 `prototype` 一起深拷贝），用于确实需要在配置里携带回调或工厂的场景。

```ts
const CONFIG_DELETE: unique symbol;
```

在 `patchConfig`/`combineConfig` 的补丁对象中，把某个键的值设为这个符号，表示"删除该键"（而不是设为 `undefined`）。

```ts
function ownConfig<T extends IConfigRecord>(
  value: T,
  options?: { readonly profile?: IConfigProfile; readonly limits?: Partial<IConfigLimits> }
): IOwnedConfig<T>;
```

深拷贝 `value` 得到一个独立的、被本包元数据标记为"已拥有"的图。要求根必须是普通对象（不能是数组）且不含 `symbol` 键。深拷贝过程中：

- `Date`/`RegExp`/`Map`/`Set` 会被识别并对应构造新实例（而不是被当成普通对象递归展开字段）；
- 循环引用通过内部 `WeakMap` 保留同一图结构（不会无限递归，也不会拆散共享节点）；
- `__proto__`/`prototype`/`constructor` 键一律拒绝；
- 超过 `limits`（见下）中的深度/节点数/键数会抛出 `code: 'CONFIG_LIMIT_EXCEEDED'` 的 `RangeError`。

若 `value` **已经**是某次 `ownConfig` 的返回值（元数据匹配同一 `profile`/`limits`），直接原样返回（幂等）；若元数据不匹配（例如同一对象先后用不同 `profile` 调用），抛出 `code: 'CONFIG_CONFLICT'` 的 `TypeError`。

```ts
type IConfigLimits = {
  readonly maxDepth: number; // 默认 256
  readonly maxNodes: number; // 默认 100_000
  readonly maxKeys: number; // 默认 1_000_000
  readonly maxPathLength: number; // 默认 4096
  readonly maxSegmentLength: number; // 默认 512
};
```

`limits` 只能收紧（小于等于）默认值，不能放宽——`patchConfig`/`combineConfig` 里若传入的 `limits` 试图超过基准限制会抛 `code: 'CONFIG_CONFLICT'`。

```ts
function readonlyConfig<T extends IConfigRecord>(value: IOwnedConfig<T>): T;
```

返回一个**带缓存**的只读 `Proxy` 门面（同一输入对象重复调用返回同一个 Proxy）。任何写操作（`set`/`defineProperty`/`deleteProperty`/`setPrototypeOf`/`preventExtensions`，以及 `Map`/`Set`/`Date` 上的变更方法如 `.set()`/`.add()`/`.setFullYear()`）都会抛出 `code: 'CONFIG_READONLY'` 的 `TypeError`。嵌套的对象/`Map`/`Set`/函数字段访问时会被递归包装成同样的只读 Proxy。`value` 必须是 `ownConfig` 的产物，否则抛 `code: 'CONFIG_UNSUPPORTED'`。

```ts
function patchConfig<T extends IConfigRecord>(
  base: IOwnedConfig<T>,
  patch: IConfigPatch<T>,
  options?: {
    readonly profile?: IConfigProfile;
    readonly limits?: Partial<IConfigLimits>;
    readonly reuseUnchangedRoot?: boolean;
  }
): IOwnedConfig<T>;
```

对**根**做写时复制式覆盖：`patch` 中每个键要么设为新值（会被递归深拷贝并纳入所有权），要么设为 `CONFIG_DELETE` 表示删除。只有被改动路径上的节点被复制，未涉及的子树按引用共享。`patch` 为空对象且 `reuseUnchangedRoot`（默认 `true`）时直接返回 `base` 本身，不做任何拷贝。`patch` 必须是普通对象、键不能是 `symbol`、不能是访问器属性，否则抛 `code: 'CONFIG_UNSUPPORTED'`；键名撞上 `__proto__`/`prototype`/`constructor` 抛 `code: 'CONFIG_PATH_INVALID'`。**注意**：`patchConfig` 只在根一层应用补丁——要修改嵌套字段，先用 `get`/`set`（`/object` 模块）在应用层算出新的嵌套子树，再作为整体值放进 `patch`。

```ts
const base = ownConfig({ endpoint: '/v1', retries: 2, debug: true });
const next = patchConfig(base, { retries: 3, debug: CONFIG_DELETE });
next.retries; // 3
'debug' in next; // false
```

```ts
function parseConfigPath(
  path: string,
  limits?: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'>
): readonly string[];
```

在 `/object` 模块的 `parseObjectPath` 基础上叠加 config 专属限制（长度上限可自定义，默认取包级默认值）并强制所有段都是字符串（不支持数字下标简写形式在 config 路径里独立出现，统一按字符串段处理）。

```ts
type IConfigReadResult =
  { readonly kind: 'missing' } | { readonly kind: 'value'; readonly value: unknown };
function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult;
```

读取配置内某条路径，区分"键不存在"（`missing`）与"值就是 `undefined`"（`value: undefined`）。返回的对象/函数类型的值会自动包一层只读 Proxy（与 `readonlyConfig` 相同的包装逻辑），保证读到的嵌套值也不可被外部修改。`config` 必须是 `ownConfig` 的产物。

```ts
function combineConfig(
  sources: readonly IOwnedConfig<IConfigRecord>[],
  options?: {
    readonly profile?: IConfigProfile;
    readonly limits?: Partial<IConfigLimits>;
    readonly strategies?: Partial<IConfigMergeStrategies>;
    readonly pathRules?: readonly IConfigPathRule[];
    readonly onConflict?: (context: IConfigConflictContext) => IConfigConflictDecision;
  }
): IOwnedConfig<IConfigRecord>;
```

按 `sources` 数组的顺序（后者覆盖前者）合并多个已拥有的配置根，产出一个新的 `ownConfig` 结果。全部来源必须共享同一个 `profile`，否则抛 `code: 'CONFIG_CONFLICT'`。

```ts
type IConfigMergeStrategies = {
  readonly record: 'merge' | 'replace'; // 默认 'merge'：普通对象递归合并；'replace'：整体覆盖
  readonly array: 'replace' | 'concat' | 'mergeByIndex'; // 默认 'replace'
  readonly map: 'replace' | 'merge'; // 默认 'replace'
  readonly set: 'replace' | 'union'; // 默认 'replace'
  readonly undefined: 'ignore' | 'assign'; // 默认 'ignore'：右侧显式 undefined 不覆盖左侧
};

type IConfigPathRule = {
  readonly prefix: readonly PropertyKey[];
  readonly strategies: Partial<IConfigMergeStrategies>;
};

type IConfigConflictContext = {
  readonly path: readonly PropertyKey[];
  readonly left: unknown;
  readonly right: unknown;
};
type IConfigConflictDecision =
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'value'; readonly value: unknown };
```

`strategies` 是全局默认策略；`pathRules` 是一组 `{ prefix, strategies }`，按 `prefix`（从根开始的键路径）匹配当前正在合并的键路径，`prefix` 更长（更具体）的规则优先生效，命中的规则会与全局 `strategies` 合并（规则内声明的字段覆盖全局同名字段，规则未声明的字段沿用全局值）。

当某个键在双方都存在、且不属于以上任何自动合并分支（例如两侧都是不可合并的原始值）时，若提供了 `onConflict`，会调用它并传入 `IConfigConflictContext`（`path`：当前键的完整路径；`left`：左侧/已有值；`right`：右侧/新值），其返回值 `IConfigConflictDecision` 决定最终结果：`{ kind: 'left' }` 保留左值、`{ kind: 'right' }` 采用右值、`{ kind: 'delete' }` 删除该键、`{ kind: 'value', value }` 采用自定义值。`onConflict` 必须**同步**返回（返回 Promise 会抛 `code: 'CONFIG_CONFLICT'`；返回值不是上述四种 `kind` 之一同样抛 `CONFIG_CONFLICT`）。未提供 `onConflict` 时右侧直接覆盖左侧（标准合并语义）。`right === CONFIG_DELETE` 会删除目标键（可用于合并阶段裁剪掉某个来源写入的默认值）。

```ts
const defaults = ownConfig({ retries: 1, tags: ['default'] });
const override = ownConfig({ retries: 3, tags: ['custom'] });
const merged = combineConfig([defaults, override], { strategies: { array: 'concat' } });
merged.retries; // 3（右侧覆盖左侧）
merged.tags; // ['default', 'custom']（数组按 concat 合并）
```

---

<a id="function-模块"></a>

## `/function` 模块

```ts
const noop: () => undefined;
```

恒返回 `undefined` 的空函数，用作默认回调占位符。

```ts
function once<T extends (...args: never[]) => unknown>(functionValue: T): T;
```

记忆化一个**同步**函数：只在首次调用时真正执行，之后的调用直接返回首次的结果（或重新抛出首次的异常——包括异常也被缓存，不会在第二次调用时重新执行函数体）。若在首次调用**尚未完成**时发生重入（函数体内部再次调用了被包装后的自身），会抛出 `code: 'REENTRANT_CALL'` 的 `TypeError`，防止意外的递归自调用绕过缓存语义。

```ts
const initOnce = once(() => {
  console.log('init');
  return 1;
});
initOnce(); // 打印 'init'，返回 1
initOnce(); // 不再打印，直接返回 1
```

```ts
function onceAsync<T>(functionValue: () => Promise<T>): () => Promise<T>;
```

记忆化一次**异步**调用：首次调用时执行 `functionValue()` 并保留其返回的**同一个原生 Promise 引用**；后续调用直接返回这同一个 Promise（无论它当时是 pending / fulfilled / rejected）。若 `functionValue()` 返回值不是原生 `Promise` 实例，内部会以 `code: 'INVALID_ARGUMENT'` 的 `TypeError` reject。

```ts
const loadOnce = onceAsync(() => fetch('/config').then((r) => r.json()));
const [a, b] = await Promise.all([loadOnce(), loadOnce()]); // 只发起一次网络请求
```

---

<a id="组合工作流示例"></a>

## 组合工作流示例：截止时间 + 配置

```ts
import { createManualScheduler, retry, withTimeout } from '@migaia/utils/promise';
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config';

const scheduler = createManualScheduler();
const initial = ownConfig({ endpoint: '/v1', retries: 2, debug: true });
const next = patchConfig(initial, { debug: CONFIG_DELETE });
const publicConfig = readonlyConfig(next);

const request = withTimeout(
  ({ signal }) =>
    retry(
      async () => {
        if (signal.aborted) throw signal.reason;
        return publicConfig.endpoint;
      },
      { maxAttempts: publicConfig.retries, scheduler }
    ),
  { timeoutMs: 100, scheduler }
);

scheduler.advance(100);
await request.catch(() => undefined);
```

`createManualScheduler()` 让时间变为确定性，便于在单测中精确断言超时/重试行为。超时中止是协作式的：`retry`/业务代码必须读取传入的 `signal` 才能提前退出。`ownConfig` 拷贝并标记入参；`readonlyConfig` 是带缓存、拒绝写入的门面；`patchConfig` 返回一个新的所有权根，`CONFIG_DELETE` 只在根一层的补丁里生效。

---

## `/value`、`/string`、`/number` 高频工具

`isNullish` 只识别 `null | undefined`；`isBlankString` 只识别 trim 后为空的字符串。`isEmptyValue` 组合两者并额外把 `NaN` 判为空；`0`、`0n`、`false`、数组和对象保持有效。`isPrimitive` 覆盖 JavaScript 七类 primitive，不生成额外类型标签。

`format(source, values, options?)` 使用线性扫描替换 `{path}`，嵌套路径只读取 own property；缺失值默认保留占位符。`options.placeholder` 可配置 `{ open, close }`，`missing` 可选 `preserve | empty | throw`，`nullish` 可选 `empty | stringify`。双写边界字符用于输出字面量边界。

`formatNumber`、`formatCurrency`、`formatPercent`、`formatInteger`、`formatCompactNumber` 共享一个 64 项有界 `Intl.NumberFormat` 缓存。高频表格、行情或库存循环使用 `createNumberFormatter(options)`，避免每项重复解析配置。所有 locale、币种、精度和舍入规则由调用方显式拥有。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **超时没能真正打断 I/O**：符合预期——协作式取消要求操作函数自己读取并响应传入的 `signal`；把 `signal` 透传给底层 I/O（例如 `fetch(url, { signal })`）并让其遵守中止。
- **`base64ToBytes` 拒绝了输入**：把产出方规范化为标准补齐的 RFC 4648 文本；URL-safe（`-`/`_`）或无补齐的变体不被接受，需要先转换成标准形式。
- **写只读配置抛错**：这是刻意的行为——`readonlyConfig` 就是用来防止意外修改的；需要变更时对拥有所有权的原始值调用 `patchConfig`，而不是修改只读门面。
- **`once` 报重入错误**：说明首次调用尚未返回时，函数体内部又调用了同一个被包装的函数；把递归逻辑挪到包装函数之外，或改用普通函数自身递归。
- **需要"当前值订阅/重放"或资源释放生命周期**：`@migaia/utils` 不提供响应式状态或资源所有权模型，应使用专门的响应式/生命周期管理包，而不是在这里找替代品。
- **`ownConfig`/`patchConfig` 抛 `CONFIG_LIMIT_EXCEEDED`**：说明配置图的深度/节点数/键数超过了限制；确认是否存在非预期的深层嵌套或循环膨胀，必要时通过 `limits` 选项显式收紧或（在确认安全的前提下）放宽默认值。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
