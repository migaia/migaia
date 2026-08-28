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

**`deferred`｜3 秒上手** —— 拿到可从外部结算的 Promise：

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

**`createManualScheduler`｜5 秒上手** —— 单测里把时间变成确定性的：

```ts
const scheduler = createManualScheduler();
const p = withTimeout(op, { timeoutMs: 100, scheduler });
scheduler.advance(100); // 手动触发超时，无需真实等待
```

无入参；返回对象额外暴露 `advance(ms)`、只读 `pendingCount`（标准 `IUtilsScheduler` 的 `now()`/`schedule()` 也都有）。

**`systemScheduler`｜3 秒上手** —— 基于原生定时器的默认调度器，一般不用手动传，除非要替换成 `createManualScheduler()`：

```ts
systemScheduler.now(); // Date.now()
```

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

全部取值：`invalidArgument`(`INVALID_ARGUMENT`)、`nonErrorValue`(`NON_ERROR_VALUE`)、`envUnsupported`(`ENV_UNSUPPORTED`)、`aborted`(`ABORTED`)、`deadlineExceeded`(`DEADLINE_EXCEEDED`)、`schedulerRunaway`(`SCHEDULER_RUNAWAY`)、`errorIdentityConflict`(`ERROR_IDENTITY_CONFLICT`)、`cloneUnsupported`(`CLONE_UNSUPPORTED`)、`invalidEncoding`(`INVALID_ENCODING`)、`limiterClosed`(`LIMITER_CLOSED`)、`reentrantCall`(`REENTRANT_CALL`)、`configUnsupported`(`CONFIG_UNSUPPORTED`)、`configReadonly`(`CONFIG_READONLY`)、`configConflict`(`CONFIG_CONFLICT`)、`configLimitExceeded`(`CONFIG_LIMIT_EXCEEDED`)、`configPathInvalid`(`CONFIG_PATH_INVALID`)、`objectPathInvalid`(`OBJECT_PATH_INVALID`)、`formatInvalid`(`FORMAT_INVALID`)、`formatValueMissing`(`FORMAT_VALUE_MISSING`)、`numberFormatInvalid`(`NUMBER_FORMAT_INVALID`)。

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
const result = probeProperty(obj, 'name'); // { kind: 'missing' | 'value' | 'failed', ... }
```

参数：`value: object`（必填）、`key: PropertyKey`（必填），无可选项。

**`immutableSnapshot`｜3 秒上手** —— 基于 `structuredClone` 的深拷贝（单参数，无选项；不支持时抛 `ENV_UNSUPPORTED`/`CLONE_UNSUPPORTED`）：

```ts
const copy = immutableSnapshot({ a: 1, date: new Date() });
```

**`diagnosticSnapshot`｜5 秒上手** —— 尽力而为深拷贝，同时报告哪里没拷成功（单参数，无选项）：

```ts
const { value, diagnostics } = diagnosticSnapshot({ a: 1, fn: () => 1 });
// diagnostics: [{ path: ['fn'], reason: 'unsupported', cause: fn }]
// reason 取值：'accessor' | 'read-failed' | 'unsupported'
```

**`identitySnapshot`｜3 秒上手** —— 显式表达"不拷贝，保留引用"的意图（单参数，无选项）：

```ts
const same = identitySnapshot(value); // === value
```

**`get` / `set`｜10 秒上手** —— 不可变路径读写：

```ts
get(data, 'user.name'); // 读；缺失/中途遇到原始值都返回 undefined，getter 抛错则原样抛出
const next = set(data, 'user.name', 'Grace'); // 写；结构共享，data 本身不变
```

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

**`ownConfig`｜5 秒上手** —— 深拷贝并标记为"本包管理"：

```ts
const config = ownConfig({ endpoint: '/v1', retries: 2 });
```

第二参数选项：

- `profile?: 'data' | 'richRuntime'` —— 默认 `'data'`（拒绝函数）；`'richRuntime'` 允许函数/可构造类
- `limits?: Partial<IConfigLimits>` —— 收紧默认限制，字段：`maxDepth`(默认256)、`maxNodes`(默认100000)、`maxKeys`(默认1000000)、`maxPathLength`(默认4096)、`maxSegmentLength`(默认512)；只能收紧不能放宽

**`readonlyConfig`｜5 秒上手** —— 拒绝写入的门面（单参数，无选项；入参必须是 `ownConfig` 产物）：

```ts
const view = readonlyConfig(config);
view.retries = 5; // 抛 TypeError（CONFIG_READONLY）
```

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
const merged = combineConfig([defaults, override], { strategies: { array: 'concat' } });
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

**`once`｜5 秒上手** —— 同步函数只执行一次，结果（含异常）被缓存：

```ts
const initOnce = once(() => expensiveInit());
initOnce(); // 真正执行
initOnce(); // 直接返回上次结果
```

单参数 `functionValue`（必填），无其他选项；首次执行未完成时重入会抛 `REENTRANT_CALL`。

**`onceAsync`｜5 秒上手** —— 并发调用共享同一个 Promise，只发起一次：

```ts
const loadOnce = onceAsync(() => fetch('/config').then((r) => r.json()));
const [a, b] = await Promise.all([loadOnce(), loadOnce()]); // 只请求一次
```

单参数 `functionValue: () => Promise<T>`（必填），无其他选项；返回值必须是原生 `Promise`，否则以 `INVALID_ARGUMENT` reject。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 截止时间 + 重试 + 只读配置

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
