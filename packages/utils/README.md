# `@migaia/utils`

面向库代码的、与运行时无关的基础工具集：截止时间控制（deadline）、协作式中止（abort）、错误身份标注、字节/文本编解码、不可变对象路径读写，以及带所有权语义的配置对象。零运行时依赖，`sideEffects: false`。

## 适用与不适用场景

**适用**：某个包需要一个体量小、宿主无关、并且明确暴露失败/调度/所有权语义的基础原语。典型场景：在截止时间内等待、协议边界上的规范 Base64、只读配置快照、不可变的嵌套字段写入、跨值/跨错误的因果链遍历。

**不适用**：不要把它当作应用框架、事件总线、生命周期宿主、存储层，或强制取消 Promise 的机制。`withTimeout`/`raceWithAbort`/`retry` 只能通过 `signal` 通知协作式代码；如果被中止的代码从不检查 `signal.aborted`，本包无法真正打断它。

## 安装

```bash
pnpm add @migaia/utils
```

## 目录

- [`/promise`：截止时间、中止、重试、并发限流](#promise-模块)
- [`/error`：错误身份与因果链](#error-模块)
- [`/bytes`：Base64 与 UTF-8](#bytes-模块)
- [`/object`：快照与不可变对象路径](#object-模块)
- [`/typing`：跨项目复用类型](#typing-模块)
- [`/config`：带所有权语义的配置对象](#config-模块)
- [`/function`：一次性调用](#function-模块)
- [Collector：惰性字段筛选流水线](#collector)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="promise-模块"></a>

## `/promise` 模块

```ts
import {
  sleep,
  createAbortTimeoutSignal,
  withTimeout,
  raceWithAbort,
  retry,
  createConcurrencyLimiter,
  deferred,
  toPromise,
  createManualScheduler,
  systemScheduler,
  hostRethrowReporter
} from '@migaia/utils/promise';
```

**`sleep`｜5 秒上手** —— 可中止的延时：

```ts
await sleep(1000); // 1 秒后 resolve
await sleep(1000, { signal: controller.signal }); // 中止时 reject UtilsAbortError
```

全部选项（第二参数 `IAsyncControls`）：

- `signal?: IAbortSignal` —— 与 `signals` 互斥，同时传抛 `TypeError`
- `signals?: readonly IAbortSignal[]` —— 任意一个中止即中止
- `scheduler?: IUtilsScheduler` —— 默认 `systemScheduler`
- `unref?: boolean` —— 定时器不阻塞进程退出（Node）

**`createAbortTimeoutSignal`｜5 秒上手** —— 只合并外部 abort 与 deadline signal，不接管任何 Promise 的结算策略：

```ts
const merged = createAbortTimeoutSignal({
  signal: controller.signal,
  timeoutMs: 500,
  timeoutReason: () => new Error('deadline')
});
try {
  await Promise.all([requestA(merged.signal), requestB(merged.signal)]);
} finally {
  merged.dispose();
}
```

返回 `{ signal, dispose }`；`dispose()` 幂等。无 `timeoutMs` 时原样返回外部 signal，不分配 controller。它与 `withTimeout` / `raceWithAbort` 的区别是：后两者拥有最终 Promise 的超时 reject、迟到 rejection 与 cleanup-error 政策，本 API 只拥有 signal composition，适合结算事实必须由底层事务决定的适配器。

**`withTimeout`｜10 秒上手** —— 给一段惰性操作套上截止时间，操作函数必须读 `signal` 才能提前退出：

```ts
await withTimeout(
  async ({ signal }) => {
    if (signal.aborted) throw signal.reason;
    return fetchData();
  },
  { timeoutMs: 500 }
);
```

全部选项：`IAsyncControls`（同上：`signal`/`signals`/`scheduler`/`unref`）叠加：

- `timeoutMs: number`（必填）—— 有限非负数
- `report?: IUtilsReporter` —— 结算后才到达的迟到结果如何上报，默认 `hostRethrowReporter`
- `zeroTimeoutBehavior?: 'skip' | 'start'` —— `timeoutMs: 0` 时默认 `'skip'`（立即以超时错误 reject）；`'start'` 改为立即执行、不设超时
- `cooperativeCancellation?: boolean` —— 默认 `true`；`false` 时不分配内部 `AbortController`，操作拿到的是恒不中止的惰性信号

**`raceWithAbort`｜5 秒上手** —— 只响应外部中止，不设截止时间：

```ts
await raceWithAbort(({ signal }) => fetch(url, { signal }), { signal: controller.signal });
```

全部选项：`signal?`/`signals?`（互斥，语义同上）叠加：

- `report?: IUtilsReporter` —— 默认 `hostRethrowReporter`
- `cleanupPolicy?: 'reject' | 'report'` —— 默认 `'reject'`；`'report'` 时监听器清理失败改为上报而不是让结果 reject

**`retry`｜10 秒上手** —— 带最大次数、可选退避、可选总/单次超时的串行重试：

```ts
await retry(async () => mayFail(), {
  maxAttempts: 3,
  shouldRetry: () => true,
  delay: (_, { attempt }) => attempt * 100
});
```

全部选项：

- `maxAttempts: number`（必填）—— 正安全整数
- `shouldRetry: (error, { attempt, maxAttempts, signal }) => boolean | Promise<boolean>`（必填）
- `delay?: number | ((error, context) => number)` —— 两次尝试间的退避毫秒数，默认 0
- `totalTimeoutMs?: number` —— 整个重试过程（含退避等待）的总截止时间
- `attemptTimeoutMs?: number` —— 每次尝试各自的超时
- `signal?` / `signals?` —— 互斥，随时中止整个重试
- `zeroTimeoutBehavior?: 'skip' | 'start'` —— 透传给内部 `withTimeout`
- `report?: IUtilsReporter`
- `unref?: boolean`
- `scheduler?: IUtilsScheduler`

**`createConcurrencyLimiter`｜10 秒上手** —— 限制同时执行的任务数：

```ts
const limiter = createConcurrencyLimiter({ concurrency: 2 });
await Promise.all(urls.map((u) => limiter.run(() => fetch(u))));
await limiter.dispose(); // 等待在途任务结束后关闭
```

构造选项：`concurrency: number`（必填，正安全整数）、`report?: IUtilsReporter`。
`run(task, options?)` 的 `options.signal?: IAbortSignal` —— 排队中的任务可被单独中止（已开始执行的任务需自行读取 `context.signal`）。
返回对象上的方法：`activeCount`/`pendingCount`（只读）、`whenIdle()`、`close(reason?)`、`dispose(reason?)`。

**`deferred`｜兼容性工具** —— 拿到可从外部结算的 Promise：

如果目标运行环境支持 `Promise.withResolvers()`，优先使用原生 API：语义相同、认知成本更低，也不需要额外引入 `deferred`。只有需要兼容尚未提供 `Promise.withResolvers()` 的运行时，或项目必须统一使用本包返回类型时，才选择 `deferred()`。

```ts
const { promise, resolve, reject } = Promise.withResolvers<number>();
resolve(42);
```

兼容旧运行时：

```ts
const { promise, resolve } = deferred<number>();
resolve(42);
```

无选项；返回 `{ promise, resolve, reject }`。

**`toPromise`｜3 秒上手** —— 立即执行同步计算，并把返回值或同步异常统一成 Promise settlement：

```ts
const value = await toPromise(() => cache.get('key'));
await toPromise(() => {
  throw new Error('failed'); // 不会从 toPromise 调用点同步抛出，而是返回 rejected Promise
});
```

`run` 同步且恰好执行一次；普通值和 thenable 交给原生 `Promise.resolve` 同化，原生 Promise 保持 identity。它不提供 timeout、retry 或 cancellation。

它与 `Promise.resolve().then(() => run())` 的差别在执行时机和 Promise identity：

- `toPromise(run)` 在当前调用栈立即执行 `run`，函数返回前副作用已经发生；如果 `run` 返回原生 Promise，会直接返回同一个 Promise。
- `Promise.resolve().then(run)` 等到下一次 microtask 才执行 `run`，可用于主动打断当前调用栈或避免同步重入；它始终创建一个新的链式 Promise。
- 两者都把 `run` 抛出的异常表现为 rejection。`toPromise` 在当前调用过程中捕获同步异常并返回已拒绝的 Promise；`.then(run)` 则在后续 microtask 执行 `run` 时产生 rejection。

需要“现在执行，但统一以 Promise 返回”时选 `toPromise`；需要“稍后执行，让出当前调用栈”时选 `Promise.resolve().then(run)`。

**`createManualScheduler`｜本仓测试专用** —— 单测里把时间变成确定性的：

该工具为本仓测试与适配器验证提供确定性时钟，不面向外部业务代码。外部项目应优先使用所属测试框架提供的 fake timers；不要在生产流程中依赖 `advance()` 或 `pendingCount`。

```ts
const scheduler = createManualScheduler();
const p = withTimeout(op, { timeoutMs: 100, scheduler });
scheduler.advance(100); // 手动触发超时，无需真实等待
```

无入参；返回对象额外暴露 `advance(ms)`、只读 `pendingCount`（标准 `IUtilsScheduler` 的 `now()`/`schedule()` 也都有）。

**`systemScheduler`｜3 秒上手** —— 基于原生定时器的默认调度器，一般不用手动传，除非要替换成 `createManualScheduler()`：

```ts
const now = systemScheduler.now();
```

`systemScheduler.now()` 当前直接读取 `Date.now()`，所以两者返回的都是 Unix 时间戳，数值与精度没有区别。区别在调用边界：`systemScheduler` 把 `now()` 与 `schedule()` 放在同一个 `IUtilsScheduler` 中，使用方可以在测试时把它们一起替换成虚拟时钟。

只需要读取真实墙上时间的普通业务代码，直接使用 `Date.now()` 即可。正在实现接受 `IUtilsScheduler` 的超时、重试或调度逻辑时，应始终配对使用 `scheduler.now()` 与 `scheduler.schedule()`；如果其中一处改用 `Date.now()`，就会绕过注入的调度器，导致测试同时混用真实时间和虚拟定时器，无法再确定性推进。

无配置，是一个现成的 `IUtilsScheduler` 常量。

**`hostRethrowReporter`｜3 秒上手** —— 默认诊断上报器，把迟到的错误重新抛给宿主而不是吞掉；一般无需调用，作为 `report` 选项的默认值：

```ts
withTimeout(op, { timeoutMs: 100, report: myLogger }); // 用自定义 reporter 替换默认行为
```

签名固定：`(error: unknown, context: { operation, phase, attempt? }) => void`，自定义 reporter 需匹配同一签名。

---

<a id="error-模块"></a>

## `/error` 模块

```ts
import {
  UtilsError,
  UtilsAbortError,
  UtilsTimeoutError,
  attachErrorIdentity,
  toError,
  walkErrorCauses,
  combineErrors,
  isUtilsError,
  isUtilsAbortError,
  isUtilsTimeoutError,
  UtilsErrorCode
} from '@migaia/utils/error';
```

**`attachErrorIdentity`｜5 秒上手** —— 给已有错误对象贴上稳定的 `source`/`code`：

```ts
attachErrorIdentity(new Error('boom'), { source: 'my-package', code: 'FETCH_FAILED' });
```

`identity` 全部字段：`source: string`（必填）、`code: string`（必填）、`phase?: string`、`detail?: Readonly<Record<string, unknown>>`。同名字段已存在且值不同会抛 `TypeError`。

**`toError`｜3 秒上手** —— 把任意 `throw` 值规整为 `Error`：

```ts
catch (value) { const error = toError(value); }
```

第二参数选项：`{ message?: string }` —— 指定后覆盖默认消息推导（原本：字符串抛出值直接作为消息，否则用固定兜底文案）。

**`walkErrorCauses`｜5 秒上手** —— 展开 `cause`/`AggregateError` 链：

```ts
walkErrorCauses(error); // [error, ...每一层 cause / AggregateError.errors]
```

第二参数选项：`{ maxDepth?: number }`（默认 32）—— 超过深度停止继续下探。

**`combineErrors`｜5 秒上手** —— 把多个错误合并成一个：

```ts
combineErrors([err1, err2], 'batch failed'); // 0 个→undefined，1 个→原样，多个→AggregateError
```

参数：`errors: Iterable<unknown>`（必填）、`message: string`（必填，仅在合并成 `AggregateError` 时用作其 `message`）。

**`isUtilsError` / `isUtilsAbortError` / `isUtilsTimeoutError`｜3 秒上手** —— 类型守卫，单参数 `value: unknown`，无其他选项：

```ts
if (isUtilsTimeoutError(error)) console.log(error.scope, error.timeoutMs);
```

**`UtilsErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较：

```ts
if (error.code === UtilsErrorCode.aborted) {
  /* ... */
}
```

全部取值及其含义：

- `invalidArgument`（`INVALID_ARGUMENT`）—— 参数类型、范围或组合不符合 API 契约；修正调用参数后重试。
- `nonErrorValue`（`NON_ERROR_VALUE`）—— `toError()` 收到了字符串等非 `Error` 异常值，并已将它转换为可追踪的 `Error`。
- `envUnsupported`（`ENV_UNSUPPORTED`）—— 当前宿主缺少所需原生能力，例如 `structuredClone`；改用支持该能力的运行环境或其他实现。
- `aborted`（`ABORTED`）—— 外部 `AbortSignal` 已请求取消协作式操作；停止后续工作并向上传递取消原因。
- `deadlineExceeded`（`DEADLINE_EXCEEDED`）—— 操作、单次尝试或整个重试流程超过约定时限；检查 `scope` 与 `timeoutMs` 决定重试或降级。
- `schedulerRunaway`（`SCHEDULER_RUNAWAY`）—— 手动调度器一次推进执行超过 10000 个任务，通常表示回调在同一时刻递归调度；修复循环，而不是提高阈值。
- `errorIdentityConflict`（`ERROR_IDENTITY_CONFLICT`）—— 错误已有的 `source` 或 `code` 与准备附加的身份冲突；保留原错误身份，不要重复改写。
- `cloneUnsupported`（`CLONE_UNSUPPORTED`）—— `structuredClone` 无法复制该值，例如包含不可克隆成员；先转换为可克隆数据再创建不可变快照。
- `invalidEncoding`（`INVALID_ENCODING`）—— Base64 等输入不符合本包要求的规范编码；根据错误偏移修正输入，不会宽松解码。
- `limiterClosed`（`LIMITER_CLOSED`）—— 并发限制器已经关闭，不能再接收或继续排队任务；创建新限制器或停止提交任务。
- `reentrantCall`（`REENTRANT_CALL`）—— 回调尚未结束时又进入禁止重入的函数或 collector；等待当前调用结束，避免从回调内部再次调用同一实例。
- `configUnsupported`（`CONFIG_UNSUPPORTED`）—— 配置包含不支持的形状、访问器、Symbol key 或函数位置；改成契约允许的普通数据。
- `configReadonly`（`CONFIG_READONLY`）—— 尝试修改只读配置视图；从可写所有者生成新配置，不要修改只读快照。
- `configConflict`（`CONFIG_CONFLICT`）—— 合并配置时所有权、profile 或属性描述符互不兼容；统一来源契约后再合并。
- `configLimitExceeded`（`CONFIG_LIMIT_EXCEEDED`）—— 配置图的键数、深度或其他安全上限被超过；缩小输入或显式调整允许的限制。
- `configPathInvalid`（`CONFIG_PATH_INVALID`）—— 配置路径为空、过长、含危险键或无效分段；使用经过解析且安全的配置路径。
- `objectPathInvalid`（`OBJECT_PATH_INVALID`）—— 对象路径字符串或分段元组无法安全定位属性；修正路径语法并移除危险分段。
- `formatInvalid`（`FORMAT_INVALID`）—— 模板语法、占位符边界或待格式化值不合法；修正模板或值后重新格式化。
- `formatValueMissing`（`FORMAT_VALUE_MISSING`）—— 严格格式化模式找不到指定占位符路径；补齐数据字段或改用允许缺失值的策略。
- `numberFormatInvalid`（`NUMBER_FORMAT_INVALID`）—— `Intl.NumberFormat` 拒绝 locale、格式选项、货币代码或数值；修正国际化配置或输入值。

**`UtilsAbortError` / `UtilsTimeoutError`｜3 秒上手** —— 一般由包内抛出，也可直接构造：

```ts
throw new UtilsAbortError('user cancelled'); // 构造参数：reason?: unknown（存入 cause）
throw new UtilsTimeoutError('operation', 500); // 构造参数：scope: 'operation' | 'attempt' | 'total', timeoutMs: number（两者均必填）
```

---

<a id="bytes-模块"></a>

## `/bytes` 模块

```ts
import {
  isArrayBuffer,
  isUint8Array,
  bytesToBase64,
  base64ToBytes,
  streamBase64Chunks,
  utf8ByteLength,
  encodeUtf8,
  decodeUtf8,
  splitUtf8
} from '@migaia/utils/bytes';
```

在使用本模块前，先区分底层存储与字节视图：

- `ArrayBuffer` 是一段固定长度的原始连续内存，只表示“这些字节存在哪里”。它本身不能按下标读写具体字节，通常来自 `fetch(...).arrayBuffer()`、文件读取、Web Crypto、WebAssembly 或 iframe/Worker 消息传输。
- `Uint8Array` 是覆盖在 `ArrayBuffer` 上的 8 位无符号整数视图，表示“怎样把这段内存按 0～255 的单字节读写”。编码、Base64、网络协议帧和二进制序列化通常使用它，因为这些操作需要逐字节访问。
- `new Uint8Array(buffer, byteOffset, length)` 默认不会复制数据；它可以只查看 buffer 的一个窗口，写入视图也会改变同一底层 `ArrayBuffer`。需要独立副本时使用 `slice()`，只需共享窗口时使用 `subarray()`。
- `ArrayBuffer` 通过 Worker 等边界转移后可能被 detached，原发送方不再拥有可读字节；`SharedArrayBuffer` 则用于多线程共享内存，生命周期和并发语义不同，因此本模块不会把它当作普通 `ArrayBuffer`。

**`isUint8Array` / `isArrayBuffer`｜3 秒上手** —— 基于 ECMAScript 内部槽做跨 realm 品牌检测，不信任可篡改的 `constructor.name`、原型或 `Symbol.toStringTag`：

```ts
isUint8Array(new Uint8Array()); // true
isArrayBuffer(new ArrayBuffer(1)); // true
isUint8Array(new Uint8ClampedArray(1)); // false
isArrayBuffer(new SharedArrayBuffer(1)); // false
```

两者接受合法的跨 iframe/Worker 值和子类，拒绝 Proxy 与外形伪造对象。detached `Uint8Array` / `ArrayBuffer` 仍保留自身品牌；调用方必须在读取字节前另行判断可用性。

**`bytesToBase64` / `base64ToBytes`｜3 秒上手**（单参数，无选项）：

```ts
bytesToBase64(new Uint8Array([1, 2, 3])); // 'AQID'
base64ToBytes('AQID'); // Uint8Array [1, 2, 3]（只接受规范 RFC 4648 形式，非规范输入抛 TypeError）
```

**`streamBase64Chunks`｜5 秒上手** —— 大字节数组切成多段、每段各自独立合法的 Base64：

```ts
for (const chunk of streamBase64Chunks(bigBytes, 4096)) send(chunk);
```

第二参数 `maxChunkBytes?: number`（默认 `32763`）—— 必须是 `>= 3` 的安全整数，实际切分宽度向下取整到 3 的倍数。

**`utf8ByteLength`｜3 秒上手** —— 不分配缓冲区地算 UTF-8 字节数（单参数，无选项）：

```ts
utf8ByteLength('你好'); // 6
```

**`encodeUtf8`｜3 秒上手**（单参数，无选项）：

```ts
const bytes = encodeUtf8('你好');
```

**`decodeUtf8`｜3 秒上手**：

```ts
decodeUtf8(bytes); // '你好'
decodeUtf8(badBytes, { fatal: true }); // 非法字节序列时抛错，而不是替换成 U+FFFD
```

第二参数选项：`{ fatal?: boolean }`（默认 `false`）。

**`splitUtf8`｜5 秒上手** —— 按字节上限切分字符串，绝不切断码点：

```ts
splitUtf8('你好世界', 6); // ['你好', '世界']
```

第二参数 `maxBytes: number`（必填）—— 必须是 `>= 4` 的安全整数（单码点最大 UTF-8 宽度为 4）。

---

<a id="object-模块"></a>

## `/object` 模块

```ts
import {
  isPlainObject,
  probeProperty,
  immutableSnapshot,
  diagnosticSnapshot,
  structuredDiagnosticSnapshot,
  identitySnapshot,
  get,
  set,
  parseObjectPath,
  probeObjectPath,
  createPathAccessor
} from '@migaia/utils/object';
```

**`isPlainObject`｜3 秒上手**（单参数，无选项）：

```ts
isPlainObject({}); // true
isPlainObject([]); // false
isPlainObject(new Date()); // false
```

**`probeProperty`｜5 秒上手** —— 读一次属性，getter 抛错时不吞掉：

```ts
const profileUnavailable = new Error('profile unavailable');
let profileReads = 0;
const user = {
  name: 'Ada',
  get profile(): never {
    profileReads += 1;
    throw profileUnavailable;
  }
};

function readLabel(value: object, key: PropertyKey): string {
  const result = probeProperty<string>(value, key);
  switch (result.kind) {
    case 'value':
      return result.value;
    case 'missing':
      return 'Anonymous';
    case 'failed':
      console.error('property read failed', result.error);
      return 'Unavailable';
  }
}

readLabel(user, 'name'); // 'Ada'：读取成功，消费 value
readLabel(user, 'email'); // 'Anonymous'：字段不存在，走业务默认值
readLabel(user, 'profile'); // 'Unavailable'：getter 异常被显式上报
profileReads; // 1：probeProperty 没有为了判断结果而重复触发 getter
```

这里的 `user` 就是第一个参数 `value`：可以是普通对象、class 实例或其他可读取属性的对象；第二参数是要读取的字符串、数字或 Symbol key。`probeProperty()` 把“字段不存在”和“读取字段失败”分开，调用方不会把 getter 异常误当成缺省值；它也只读取属性一次，避免先判断再读取导致 getter 重复执行。参数：`value: object`（必填）、`key: PropertyKey`（必填），无可选项。

在使用 `immutableSnapshot()` 前，先理解它所说的“快照”：

- 它直接调用当前宿主的原生 `globalThis.structuredClone()`，按结构化克隆算法一次复制整张对象图，不经过 JSON 字符串。因此循环引用和“多个字段指向同一对象”的共享关系可以保留，`Date`、`Map`、`Set`、`ArrayBuffer`、TypedArray 等常见结构也能保留对应数据类型。
- 它不会保留自定义 class 的原型方法、getter/setter 或属性描述符；函数、WeakMap 等不可结构化克隆的值会让整个操作失败。这里没有传 transfer list，输入中的 `ArrayBuffer` 会复制，不会因调用而 detached。
- “快照”表示返回值与源对象断开引用，源对象之后的修改不会回写到副本；它并不调用 `Object.freeze()`，所以返回对象本身仍可修改。需要只读约束时，应在类型或调用边界另行施加。
- 适合隔离配置、消息负载或测试夹具的某一时刻状态；需要保留 class 行为、函数或精确属性描述符时不要使用。

**`immutableSnapshot`｜3 秒上手** —— 基于宿主原生结构化克隆算法的深拷贝（单参数，无选项；不支持时抛 `ENV_UNSUPPORTED`/`CLONE_UNSUPPORTED`）：

```ts
const shared = { count: 1 };
const source = {
  primary: shared,
  alias: shared,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  labels: new Map([['lang', 'zh']])
};
const copy = immutableSnapshot(source);

source.primary.count = 2;
copy.primary.count; // 1：源对象修改不会回写快照
copy.primary === copy.alias; // true：共享引用关系被保留
copy.createdAt instanceof Date; // true：不是 JSON 字符串
Object.isFrozen(copy); // false：独立副本不等于冻结对象
```

三种复制入口的选择规则：

- 原生 `structuredClone(value)`：全有或全无。整张对象图都受支持才返回副本；任一成员不可克隆就抛宿主原生异常，不提供失败路径。
- `immutableSnapshot(value)`：同样全有或全无，内部直接调用原生 `structuredClone`；区别是把环境缺失和克隆失败转换为稳定的 `ENV_UNSUPPORTED` / `CLONE_UNSUPPORTED` 错误契约。
- `diagnosticSnapshot(value)`：不先克隆整张对象图，而是递归处理普通对象和数组；可克隆的内建子树独立复制，函数、class 实例等不支持的叶子保留原引用，并在 `diagnostics` 中记录具体 `path`。它优先保证“仍返回一个可检查结果”，不保证所有层都与源对象隔离。
- `structuredDiagnosticSnapshot(value)`：先尝试原生 `structuredClone`；成功时得到完整隔离副本且 `diagnostics` 为空，失败时再退回 `diagnosticSnapshot` 的逐节点策略，并额外记录根级克隆失败。适合既希望完整克隆、又不能因单个坏字段丢失整份遥测数据的边界。

**`diagnosticSnapshot`｜5 秒上手** —— 尽力而为深拷贝，同时报告哪里没拷成功（单参数，无选项）：

```ts
const callback = () => 1;
const source = {
  safe: { count: 1 },
  callback,
  get status() {
    return 'ready';
  }
};
const { value, diagnostics } = diagnosticSnapshot(source);

value.safe !== source.safe; // true：普通对象已复制
value.callback === callback; // true：不支持的函数保留原引用
value.status; // 'ready'：accessor 被读取并投影为普通值
diagnostics;
// [
//   { path: ['callback'], reason: 'unsupported', cause: callback },
//   { path: ['status'], reason: 'accessor', cause: 'ready' }
// ]
```

`reason` 取值为 `accessor`、`read-failed` 或 `unsupported`。只要 `diagnostics` 非空，就不能把返回值宣称为完全隔离快照；调用方应根据路径决定删除、替换还是接受相应引用。

**`identitySnapshot`｜何时才有用** —— 单独调用它没有运行时收益；它只适合作为可配置 snapshot policy 的“零拷贝”分支，明确表示调用方接受共享引用：

```ts
type ISnapshotPolicy<T> = (value: T) => T;

function capture<T>(value: T, snapshot: ISnapshotPolicy<T>): T {
  return snapshot(value);
}

const liveConfig = { retry: 2 };
const retained = capture(liveConfig, identitySnapshot);

liveConfig.retry = 3;
retained.retry; // 3：两者是同一对象，后续修改彼此可见
```

这个策略适合可信进程内、身份敏感或不可克隆对象，并且调用方明确接受共享所有权的场景。若需要隔离外部输入、保留历史状态或跨边界传输，应使用 `immutableSnapshot`；不要为了“看起来调用过 snapshot”而单独套一层 `identitySnapshot(value)`。

**`get` / `set`｜10 秒上手** —— 以 immutable update 方式进行路径读写：

```ts
const data = {
  user: { name: 'Ada' },
  settings: { theme: 'dark' }
};
get(data, 'user.name'); // 'Ada'：只读，不修改 data

const next = set(data, 'user.name', 'Grace');
next !== data; // true：值发生变化时，每次 set 都返回新根对象
next.user !== data.user; // true：路径上的对象被浅拷贝
next.settings === data.settings; // true：未修改分支继续共享引用
data.user.name; // 'Ada'：原对象保持不变
Object.isFrozen(next); // false：immutable update 不等于 freeze
```

这里的 “immutable” 描述的是**更新方式**，不是对象状态：`set()` 不会修改传入对象，而是返回可继续修改的新对象；它不会深拷贝整棵树，也不会调用 `Object.freeze()`。唯一例外是新旧值经 `Object.is()` 相等时没有实际变化，此时直接返回原根对象。

参数：`object: T`（必填）、`path: 字符串路径 | 元组路径`（必填，`get`/`set` 均支持两种形式）；`set` 额外要求 `nextValue`（必填，写入类型经字面量放宽）。均无可选项。

**`parseObjectPath` / `probeObjectPath`｜5 秒上手** —— 需要精确诊断时用探测版：

```ts
parseObjectPath('user.tags.[0]'); // ['user', 'tags', 0]
probeObjectPath(data, 'user.x.y'); // { kind: 'missing' | 'blocked' | 'failed' | 'value', ... }
```

均无可选项。限制：单段最长 512 字符、路径最多 256 段、字符串路径总长上限 4096 字符，`__proto__`/`prototype`/`constructor` 一律拒绝。

**`createPathAccessor`｜10 秒上手** —— 有状态访问器，写后自动前进到新根：

```ts
const accessor = createPathAccessor({ count: 0 });
accessor.set('count', 5);
accessor.value; // { count: 5 }
```

第二参数 `IPathAccessorOptions<T>` 全部字段：

- `ifMissing?: (probe) => void` —— 路径某段不存在时触发
- `ifBlocked?: (probe) => void` —— 路径中途遇到非对象值时触发
- `ifFailed?: (probe) => void` —— 某段读取本身抛错时触发
- `onGet?: (event) => void` —— 每次成功 `get()` 时触发，`event.replace(value)` 可改写返回值
- `onSet?: (event) => void` —— 每次成功 `set()` 时触发，`event.replace(value)` 可改写实际写入值

返回的访问器方法：`get(path)`、`set(path, value)`、`probeValue(path)`、`parsePath(path)`、只读 `value`。

---

<a id="typing-模块"></a>

## `/typing` 模块

```ts
import type {
  IDiscriminatedByField,
  IDiscriminatedByPath,
  IObjectPath,
  IObjectPathInput,
  IObjectPathSegment,
  IObjectPathTuple,
  IObjectPathTupleFor,
  IObjectPathValue,
  IObjectPathWriteValue,
  IProbePropertyResult,
  IAbortSignal,
  IDeferred
} from '@migaia/utils/typing';
```

`/typing` 是**纯 type-only** 子入口（不含任何运行时导出，`import type` 即可，打包后不会产生任何 JS 代码），且**只能通过这个子路径导入**——不经过根入口 `@migaia/utils` 重新导出。它做两件事：把散落在 `/object`（`IObjectPath`/`IObjectPathInput`/`IObjectPathSegment`/`IObjectPathTuple`/`IObjectPathTupleFor`/`IObjectPathValue`/`IObjectPathWriteValue`/`IProbePropertyResult`）与 `/promise`（`IAbortSignal`/`IDeferred`）里的类型汇总到一个跨项目复用的稳定入口；再提供两个 `/object` 里没有的全新类型工具，用来把带判别字段的联合类型（discriminated union）转成按判别值分组的映射类型。

**`IDiscriminatedByField`｜5 秒上手** —— 按顶层判别字段分组：

```ts
type IEvent =
  | { readonly type: 'created'; readonly payload: { readonly userId: string } }
  | { readonly type: 'deleted'; readonly payload: { readonly reason: string } };

type IByType = IDiscriminatedByField<'type', IEvent>;
// { created: Extract<IEvent, { type: 'created' }>; deleted: Extract<IEvent, { type: 'deleted' }> }
```

类型参数：`F extends PropertyKey`（必填，判别字段名）、`T extends Record<F, PropertyKey>`（必填，联合类型本身；`F` 对应的字段值必须是 `PropertyKey`，即 `string`/`number`/`symbol`，否则编译期报错）。

**`IDiscriminatedByPath`｜5 秒上手** —— 按深层路径分组，路径写法与 `/object` 模块的对象路径完全一致（字符串路径或元组路径）：

```ts
type IEvent =
  | { readonly meta: { readonly category: 'write' }; readonly payload: { readonly userId: string } }
  | { readonly meta: { readonly category: 'read' }; readonly payload: { readonly cache: boolean } };

type IByCategory = IDiscriminatedByPath<IEvent, 'meta.category'>;
// 等价于 IDiscriminatedByPath<IEvent, readonly ['meta', 'category']>
```

类型参数：`T`（必填，联合类型本身）、`P extends IObjectPathInput<T>`（必填，字符串或元组路径；路径必须在联合的**每个分支**上都存在且合法，否则该分支被排除；路径值解析不出 `PropertyKey` 时整体报编译错误）。

其余重导出的类型（`IObjectPath`、`IObjectPathInput`、`IObjectPathSegment`、`IObjectPathTuple`、`IObjectPathTupleFor`、`IObjectPathValue`、`IObjectPathWriteValue`、`IProbePropertyResult`、`IAbortSignal`、`IDeferred`）语义与 `/object`、`/promise` 模块中完全一致，仅为了方便跨包复用类型而在这里再导出一份，不是新的类型定义。

---

<a id="config-模块"></a>

## `/config` 模块

```ts
import {
  ConfigProfile,
  CONFIG_DELETE,
  ownConfig,
  readonlyConfig,
  patchConfig,
  parseConfigPath,
  readConfigPath,
  combineConfig
} from '@migaia/utils/config';
```

**`ownConfig`｜15 秒理解能力** —— 在接收外部配置的边界创建独立、可验证所有权的配置根：

```ts
const callerOptions = {
  endpoint: '/v1',
  retry: { attempts: 2 },
  tags: new Set(['stable'])
};
const config = ownConfig(callerOptions);

callerOptions.retry.attempts = 99;
callerOptions.tags.add('caller-mutated');
config.retry.attempts; // 2：接纳后不再受调用方修改影响
config.tags.has('caller-mutated'); // false：Set 也已复制

const publicView = readonlyConfig(config); // 可公开读取，任何层级的写入都会明确报错
const next = patchConfig(config, { retry: { attempts: 3 } }); // 从已拥有配置派生新根
readConfigPath(next, 'retry.attempts'); // { kind: 'value', value: 3 }
```

`ownConfig()` 不只是普通 deep clone。它会验证整张配置图并复制循环引用、共享节点、`Date`、`RegExp`、`Map`、`Set`，再用不可伪造的内部 `WeakMap` 元数据登记 profile 与 limits。后续 `readonlyConfig()`、`patchConfig()`、`readConfigPath()` 和 `combineConfig()` 只接收这种已登记的配置根，因此不会把未经校验的普通对象误当成受管理配置。返回对象没有被冻结；需要向外暴露只读能力时使用 `readonlyConfig()`，需要更新时使用 `patchConfig()` 派生下一份配置。

默认 `data` profile 面向可移植配置，遇到函数、危险键、Symbol key、非普通根对象或超限图会明确报错。只有配置确实需要携带回调或构造器时才选择 `richRuntime`；它是进程内运行时配置，不应当作可序列化数据。

第二参数选项：

- `profile?: 'data' | 'richRuntime'` —— 默认 `'data'`（拒绝函数）；`'richRuntime'` 允许函数/可构造类
- `limits?: Partial<IConfigLimits>` —— 收紧默认限制，字段：`maxDepth`(默认256)、`maxNodes`(默认100000)、`maxKeys`(默认1000000)、`maxPathLength`(默认4096)、`maxSegmentLength`(默认512)；只能收紧不能放宽

**`readonlyConfig`｜5 秒上手** —— 给已有配置套上只读保护（单参数，无选项；入参必须是 `ownConfig` 产物）：

```ts
const view = readonlyConfig(config);
view.endpoint; // 正常读取；没有复制第二份配置
view.retries = 5; // 抛 TypeError（CONFIG_READONLY）
```

大白话：`view` 仍然读取 `config` 里的数据，但不允许调用方从 `view` 修改任何层级。普通对象赋值/删除、数组修改以及 `Map.set()`、`Set.add()`、`Date.setFullYear()` 都会报错。重复对同一份 `config` 调用会返回同一个只读对象；要修改配置，应对原来的 owned config 调用 `patchConfig()` 生成下一份，而不是写 `view`。

**`patchConfig`｜10 秒上手** —— 根级写时复制覆盖，`CONFIG_DELETE` 删除某键：

```ts
const next = patchConfig(config, { retries: 3, debug: CONFIG_DELETE });
```

第三参数选项：

- `profile?` —— 必须与 `base` 一致，否则抛 `CONFIG_CONFLICT`
- `limits?: Partial<IConfigLimits>` —— 不能比 `base` 的限制更宽，否则抛 `CONFIG_CONFLICT`
- `reuseUnchangedRoot?: boolean` —— 默认 `true`；`patch` 为空对象时直接复用 `base`，不做拷贝

**`readConfigPath`｜5 秒上手** —— 读嵌套路径，区分"不存在"与"值是 undefined"：

```ts
readConfigPath(config, 'nested.value'); // { kind: 'missing' } | { kind: 'value', value }
```

参数：`config`（必填，须为 `ownConfig` 产物）、`path: string | readonly string[]`（必填），无可选项；返回的对象/函数类型值会自动包只读代理。

**`parseConfigPath`｜3 秒上手**：

```ts
parseConfigPath('a.b.c'); // ['a', 'b', 'c']
```

第二参数 `limits?: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'>` —— 默认取包级默认值。

**`combineConfig`｜10 秒上手** —— 按顺序合并多个来源，后者覆盖前者：

```ts
const defaults = ownConfig({
  retries: 1,
  tags: ['default'],
  transport: { timeoutMs: 1_000, keepAlive: true },
});
const override = ownConfig({
  retries: 3,
  tags: ['custom'],
  transport: { timeoutMs: 2_500 },
});

const merged = combineConfig([defaults, override], {
  strategies: { record: 'merge', array: 'concat' },
});

// merged 是新配置；defaults 和 override 都不会被修改。
merged;
// {
//   retries: 3,
//   tags: ['default', 'custom'],
//   transport: { timeoutMs: 2500, keepAlive: true },
// }

// 这里的 diff 只是把结果变化写明，不是 combineConfig 的额外返回值。
const diff = {
  retries: { before: defaults.retries, after: merged.retries },
  tags: { before: defaults.tags, after: merged.tags },
  timeoutMs: { before: defaults.transport.timeoutMs, after: merged.transport.timeoutMs },
};
```

第二参数选项：

- `profile?` / `limits?` —— 同 `ownConfig`
- `strategies?: Partial<IConfigMergeStrategies>` —— `record?: 'merge'|'replace'`(默认merge)、`array?: 'replace'|'concat'|'mergeByIndex'`(默认replace)、`map?: 'replace'|'merge'`(默认replace)、`set?: 'replace'|'union'`(默认replace)、`undefined?: 'ignore'|'assign'`(默认ignore)
- `pathRules?: readonly { prefix: readonly PropertyKey[]; strategies: Partial<IConfigMergeStrategies> }[]` —— 按路径前缀覆盖策略，最长前缀优先
- `onConflict?: (context: { path, left, right }) => { kind: 'left'|'right'|'delete'|'value'; value? }` —— 不可合并的双侧冲突值如何裁决，必须同步返回

**`ConfigProfile`｜3 秒上手** —— `data`（默认，纯数据）或 `richRuntime`（允许函数），常量对象，无调用参数：

```ts
ownConfig({ onReady: () => {} }, { profile: ConfigProfile.richRuntime });
```

---

<a id="function-模块"></a>

## `/function` 模块

```ts
import { noop, once, onceAsync } from '@migaia/utils/function';
```

**`noop`｜3 秒上手**（无参数，无选项）：

```ts
const handler = options.onChange ?? noop;
```

**`once`｜10 秒理解边界** —— 让同一个包装函数实例只执行一次，结果（含异常）被缓存：

```ts
// runtime.ts：整个模块只创建并导出这一份包装函数。
export const getRuntime = once(() => {
  const registry = buildCommandRegistry();
  return { registry, startedAt: Date.now() };
});

const first = getRuntime(); // 创建 registry
const second = getRuntime(); // 直接返回 first
first === second; // true
```

单参数 `functionValue`（必填），无其他选项；首次执行未完成时重入会抛 `REENTRANT_CALL`。

适合：模块内昂贵且确定的同步初始化，例如构建只读 registry、编译 schema 或探测一次运行时能力。第一次调用抛出的异常也会永久缓存，因此不适合需要重试、重置、热更新或按请求隔离的初始化。

它**不是全局单例管理器**。每调用一次 `once(fn)` 都会创建一份独立缓存；同一包被重复打包，或代码运行在 iframe、Worker、Node `vm` 等不同 realm 时，也会各自初始化。把唯一的包装函数放在模块顶层并导出，只能得到“每个模块实例一份”。若确实需要同一 realm / 进程共享，应由应用入口或依赖注入容器拥有实例；必须挂到全局时，可用 `globalThis[Symbol.for('your-app/runtime')]`，并自行处理版本冲突、测试清理和生命周期。

`Proxy` 可以把首次属性访问转成惰性初始化，或限制对象如何被访问，但它不会自动保证全局唯一；唯一性仍取决于 Proxy 背后那份实例存在哪里、是否只有一个 owner。不要为了“更像单例”而给 `once` 的结果额外套 Proxy。

**`onceAsync`｜10 秒理解场景** —— 同一个包装函数实例只启动一次异步任务，所有调用者共享同一个 Promise：

```ts
// app-config.ts：多个组件启动时都可能读取配置，但网络请求只能发起一次。
export const loadAppConfig = onceAsync(async () => {
  const response = await fetch('/config');
  if (!response.ok) throw new Error(`config request failed: ${response.status}`);
  return response.json() as Promise<{ apiBaseUrl: string }>;
});

const [routerConfig, telemetryConfig] = await Promise.all([
  loadAppConfig(),
  loadAppConfig()
]); // 两处拿到同一次请求的结果
```

适合进程或页面生命周期内只应成功或失败一次的异步初始化，例如加载不会刷新的启动配置、初始化一个共享 SDK 客户端、动态导入并编译同一份 WASM 模块。并发调用不会制造竞态：任务尚未完成时共享 pending Promise，完成后继续复用相同的 fulfilled 或 rejected Promise。

不适合带 key 的请求去重、定时刷新、失败重试、登出后重建、按租户或请求隔离等场景；这些需求需要带失效策略的缓存或由生命周期容器管理。首次失败会一直缓存，`onceAsync` 不会自动重试。所有调用者还共享同一底层任务，因此不要让某个调用者用自己的 `AbortSignal` 随意取消它，否则其他等待者也会受影响。

作用域与 `once` 相同：每次调用 `onceAsync(fn)` 都会创建独立缓存，模块重复实例化或跨 iframe、Worker、Node `vm` 时不会共享。单参数 `functionValue: () => Promise<T>`（必填），无其他选项；返回值可以是原生 `Promise` 或合法 PromiseLike，否则以 `INVALID_ARGUMENT` reject。

---

<a id="collector"></a>

## Collector：惰性字段筛选流水线

`collect` 只从包根入口导出。它借用一个 `readonly` 数组，链式动作立即改变查询语义，首次读取 `result` 时才按调用顺序扫描一次并缓存：

```ts
import { collect } from '@migaia/utils';

const collector = collect(users)
  .fieldBy('profile.name-zh', 'profile.name-en')
  .like(' world ')
  .where((user) => user.active)
  .take(20);

const result = collector.result;
```

`fieldBy` 本身会过滤掉所有候选字段都为 `undefined` 的 source，并启用 `like`、`equals`、`oneOf` 的 typestate；未调用它时，TypeScript 不暴露这些方法。`like` 只匹配字符串，trim 后为空时为 no-op。另有 `distinctBy`、`skip`、`take`，所有动作保留原 source 项的身份与顺序。

Collector 不复制或追踪外部修改：调用方必须在 collector 生命周期内遵守传入数组及对象的只读约定。相同查询 revision 重复读取 `result` 返回同一缓存引用；新增动作后会从原 source 重新求值，但不会修改旧结果快照。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 截止时间 + 重试 + 只读配置

以下示例用于本仓测试组合验证，不是外部生产代码的推荐写法；外部测试应优先复用测试框架的 fake timers。

```ts
import { createManualScheduler, retry, withTimeout } from '@migaia/utils/promise';
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config';

const scheduler = createManualScheduler();
const config = readonlyConfig(
  patchConfig(ownConfig({ endpoint: '/v1', retries: 2, debug: true }), { debug: CONFIG_DELETE })
);

const request = withTimeout(
  ({ signal }) =>
    retry(
      async () => {
        if (signal.aborted) throw signal.reason;
        return config.endpoint;
      },
      { maxAttempts: config.retries, scheduler }
    ),
  { timeoutMs: 100, scheduler }
);
scheduler.advance(100);
await request.catch(() => undefined);
```

### 2. 并发限流 + 重试 + 错误合并：批量拉取，容忍部分失败

```ts
import { createConcurrencyLimiter, retry } from '@migaia/utils/promise';
import { combineErrors, toError } from '@migaia/utils/error';

const limiter = createConcurrencyLimiter({ concurrency: 4 });
const outcomes = await Promise.allSettled(
  urls.map((url) =>
    limiter.run(() =>
      retry(() => fetch(url).then((r) => r.json()), { maxAttempts: 3, shouldRetry: () => true })
    )
  )
);
await limiter.dispose();

const failed = combineErrors(
  outcomes.filter((o) => o.status === 'rejected').map((o) => (o as PromiseRejectedResult).reason),
  'some URLs failed'
);
if (failed) throw failed;
```

### 3. 对象路径 + 配置：把校验后的嵌套结构整体写回配置根

```ts
import { get, set } from '@migaia/utils/object';
import { ownConfig, patchConfig } from '@migaia/utils/config';

const config = ownConfig({ server: { host: 'localhost', port: 8080 } });
// patchConfig 只在根一层生效，嵌套修改先在应用层用 set() 算好整棵子树
const nextServer = set(get(config, 'server')!, 'port', 9090);
const next = patchConfig(config, { server: nextServer });
```

### 4. 一次性初始化 + 错误身份：确保初始化异常带上可识别的 code

```ts
import { once } from '@migaia/utils/function';
import { attachErrorIdentity } from '@migaia/utils/error';

const initOnce = once(() => {
  try {
    return dangerousInit();
  } catch (error) {
    throw attachErrorIdentity(error as Error, { source: 'my-package', code: 'INIT_FAILED' });
  }
});
```

---

<a id="构建门禁"></a>

## 构建门禁

### 高频值、模板与数字工具

```ts
import { format, formatCurrency, isEmptyValue, isPrimitive } from '@migaia/utils';

isEmptyValue('  '); // true；0、false、0n 均为 false
isPrimitive(Symbol('id')); // true
format('库存 {stock}，金额 {money}', { stock: 0, money: '¥12.00' });
formatCurrency(1234.5, 'CNY', {
  locales: 'zh-CN',
  format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
});
```

`format` 默认使用 `{`/`}`，可通过 `placeholder.open/close` 改成 `${`/`}` 或 `[[`/`]]`。数字工具复用有界 `Intl.NumberFormat` 缓存；热循环优先调用 `createNumberFormatter()` 一次并复用返回函数。金额、库存和量化精度均由业务显式配置，utils 不内置领域默认值。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
