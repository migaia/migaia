# `@migaia/store-worker`

把 Store 的响应式计算和序列化编解码搬到 Worker 里跑：主线程用几乎和调本地异步函数一样的写法把耗时工作丢给 Worker，同时保留 `@migaia/resource` 的 `Resource` 的取消、去重、缓存能力。本包**不实现**任何消息协议——协议、超时、取消、来源校验全部来自 `@migaia/web-rpc`，这里只负责把这些通用能力接到 Store 生态的两个具体场景上：通用计算卸载(`WorkerAdapter`/`workerComputed`)与序列化编解码卸载(`workerPlugin`)。

## 适用与不适用场景

**适用**：`Resource` 的取数/计算逻辑很重会卡主线程，用 `workerComputed()` 把 fetcher 换成 Worker 调用；某种序列化格式的编解码需要放进 Worker 跑，用 `workerPlugin()` 接入 `@migaia/serialize` 的插件注册表；落盘/传输前需要对纯字节做编解码(字节进、字节出，走零拷贝 transfer)；需要一个不依赖具体协议细节的 Worker 请求/响应模型。

**不适用**：计算量小、同步就能算完的派生逻辑——引入 Worker 通信本身有固定的序列化和消息往返成本，小任务过 Worker 反而更慢；对象图(非纯字节)走 Worker 编解码同样不划算，实测比主线程直接做还慢一倍(见[性能特征](#性能特征))。

依赖 `@migaia/reactive`、`@migaia/resource`、`@migaia/serialize`、`@migaia/web-rpc`、`@migaia/utils`(均为 workspace 依赖，随包一起装好)。

## 安装

```bash
pnpm add @migaia/store-worker
```

## 目录

- [`WorkerAdapter`：主线程侧 Worker 句柄](#worker-adapter)
- [`createWorkerHandler`：Worker 侧通用计算处理器](#worker-handler)
- [`workerComputed`：接入 `Resource`](#worker-computed)
- [序列化 Worker 集成（子路径 `/serialize/worker`）](#serialize-worker)
- [常量](#constants)
- [错误码与错误工厂](#errors)
- [性能特征](#性能特征)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="worker-adapter"></a>

## `WorkerAdapter`：主线程侧 Worker 句柄

```ts
import { WorkerAdapter } from '@migaia/store-worker';
```

**`WorkerAdapter`｜10 秒上手** —— 像调本地异步函数一样调用 Worker：

```ts
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const adapter = new WorkerAdapter(worker);

const result = await adapter.request<number[], number>([1, 2, 3]);
adapter.dispose();
```

构造签名：`(port: IWorkerPort, options?: { readonly clientId?: string; readonly timeoutMs?: number })`。

`port` 必填，满足 `IWorkerPort`(即 `IWebWorkerLikePort`：`postMessage`/`addEventListener`/`removeEventListener`)的对象，通常直接传 `new Worker(...)`。构造函数同步返回，内部连接是异步的，`request()` 会自动等待连接就绪，调用方不需要显式等待。

`options` 全部字段：

- `clientId?: string` —— 本端在 web-rpc 拓扑里的 id，默认 `'main'`
- `timeoutMs?: number` —— 请求默认超时(毫秒)，省略时不设默认超时

实例方法：

- `request<Input, Output>(payload: Input, options?: { signal?: IWebRpcAbortSignal; transfer?: readonly Transferable[] }): Promise<Output>` —— 发起一次 RPC 调用；`signal` 用于取消，`transfer` 指定零拷贝转移列表；非法 `options` 或 hostile getter 以带 `INVALID_OPTION` 的 rejected Promise 返回
- `disposed`(只读 getter)—— 是否已 `close()`/`dispose()`
- `close(): void` —— 同步标记不可用(幂等)，此后 `request()` 立即拒绝，但不释放底层 endpoint
- `dispose(): Promise<void>` —— 唯一异步释放入口：先 `close()`，再等待底层 endpoint 初始化并执行 `endpoint.dispose()`；失败会 reject，重复调用复用同一个 Promise

---

<a id="worker-handler"></a>

## `createWorkerHandler`：Worker 侧通用计算处理器

```ts
import { createWorkerHandler } from '@migaia/store-worker';
```

**`createWorkerHandler`｜10 秒上手** —— 在 Worker 里把一个普通函数包成消息处理器：

```ts
declare const self: DedicatedWorkerGlobalScope;

const handler = createWorkerHandler<number[], number>(
  (values) => values.reduce((sum, value) => sum + value, 0),
  (message) => self.postMessage(message)
);
self.onmessage = (event) => {
  void handler(event.data);
};
```

签名：`<Input, Output>(compute, postMessage, options?) => IManagedRpcHandler`。

- `compute: (payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>`（必填）—— 真正干活的函数；`compute` 抛出的异常会被 web-rpc 端点框架捕获转成失败响应，不会逃逸成 Worker 的 unhandled error
- `postMessage: (message: unknown) => void`（必填）—— Worker 侧发消息回主线程的函数，通常传 `(message) => self.postMessage(message)`
- `options.timeoutMs?: number` —— Worker 侧对每次请求处理设的超时，默认不设

返回值 `IManagedRpcHandler` 是一个函数(需要手动接上 `self.onmessage`)，额外带 `dispose()`/`close()`/`pendingCount`/`disposed`，见 [USEGUIDE §4](./USEGUIDE.md#4-managedrpchandler-生命周期细节)。

---

<a id="worker-computed"></a>

## `workerComputed`：接入 `Resource`

```ts
import { WorkerAdapter, workerComputed } from '@migaia/store-worker';
```

**`workerComputed`｜10 秒上手** —— 把 `WorkerAdapter.request()` 接进 `@migaia/resource` 的 `Resource`：

```ts
import { Signal, defaultRuntime } from '@migaia/reactive';

const values = new Signal([1, 2, 3], defaultRuntime);
const sum = workerComputed(adapter, () => values.value);

console.log(await sum.refetch()); // 6
sum.dispose();
```

签名：`<Input, Output>(adapter: WorkerAdapter, selectInput: () => Input, options?: IWorkerComputedOptions<Input, Output>) => Resource<Output>`。

- `adapter`（必填）—— 已构造好的 `WorkerAdapter`；`workerComputed` 不管理它的生命周期，`adapter.dispose()` 需要调用方自己在合适的时机调用
- `selectInput`（必填）—— 同步函数，返回值作为 RPC 的 `payload`；在 `Resource` 的 fetcher 里被同步调用一次，函数体读取的响应式值会被记为依赖

`IWorkerComputedOptions<Input, Output>` 全部字段(是 `IResourceOptions<Output>` 的超集)：

- `runtime?: IRuntime` —— 默认 `defaultRuntime`
- `transfer?: (input: Input) => readonly Transferable[]` —— 给定 `input`，返回这次调用要零拷贝转移的列表；只在确认 `input` 转移后不会再被主线程使用时才该提供
- `debugName?`、`ttl?`、`autoStart?`、`staleWhileRevalidate?`、`retry?`、`retryDelay?`、`keepAlive?`、`initialSnapshot?`、`scheduler?` —— 原样透传给 `Resource`，语义与 `@migaia/resource` 的 `IResourceOptions` 完全一致

返回标准 `Resource<Output>` 实例，`refetch()`/`.state`/`dispose()` 等用法与直接 `new Resource(...)` 得到的对象没有区别。非法 `adapter`/`selectInput`/`transfer` 会同步抛出带 `INVALID_OPTION` 的错误。

---

<a id="serialize-worker"></a>

## 序列化 Worker 集成（子路径 `/serialize/worker`）

```ts
import {
  workerParser,
  workerPlugin,
  createSerializeWorkerHandler,
  mergeWorkerChunks
} from '@migaia/store-worker/serialize/worker';
// 也可以从包根导入（index.ts 里 `export * from './serialize/worker.js'`）：
// import { workerPlugin } from '@migaia/store-worker';
```

**`workerPlugin`｜10 秒上手** —— 把 Worker 编解码接成 `@migaia/serialize` 的标准插件：

```ts
// serialize.worker.ts —— 跑在 Worker 里，装一个真正干活的 parser（字节进、字节出的形态才划算）
declare const self: DedicatedWorkerGlobalScope;

const gzipParser: ISerializeParser = {
  name: 'gzip',
  encode: (value) => ['bytes', gzipEncode(value as Uint8Array)],
  decode: (chunk) => (chunk[0] === 'bytes' ? gzipDecode(chunk[1]) : chunk[1])
};
const handler = createSerializeWorkerHandler(gzipParser, (message, transfer) =>
  self.postMessage(message, { transfer })
);
self.onmessage = (event) => {
  void handler(event.data);
};
```

```ts
// main.ts
import { createSerializeRegistry } from '@migaia/serialize';

const worker = new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' });
const registry = createSerializeRegistry([workerPlugin({ worker })]);
const chunk = await registry.encode(largeBytePayload);
```

签名：`workerPlugin(options: IWorkerPluginOptions) => ISerializePlugin`，纯粹是 `{ type: options.type ?? 'worker', parser: workerParser(options) }` 的包装。

`IWorkerPluginOptions` 全部字段：

- `worker: IWorkerLike`（必填）—— 满足 `IWebWorkerLikePort` 加可选 `terminate()` 的对象
- `type?: string` —— 写进 `ISerializePlugin.type` 的注册表格式标签，默认 `'worker'`
- `terminateOnDispose?: boolean` —— `dispose()` 时是否顺带 `worker.terminate?.()`，默认 `false`(外部传入的 Worker 默认归调用方所有)
- `ownership?: 'copy' | 'transfer'` —— 字节数据过边界时复制还是零拷贝转移，默认 `'copy'`
- `clientId?: string` —— 本端在 web-rpc 拓扑里的 id，默认 `'main'`

**`workerParser`｜5 秒上手** —— `workerPlugin` 内部使用的主线程侧 `ISerializeParser` 实现，也可单独使用：

```ts
const parser = workerParser({ worker });
```

签名同 `workerPlugin` 的 `options`。`encode`/`decode` 都通过 RPC 转发给 Worker；`value` 是 `Uint8Array` 时按 bytes 段发送(唯一能走零拷贝的形态)，否则按 value 段发送(退化为结构化克隆)。`dispose()` 异步释放端点，`terminateOnDispose: true` 时额外尝试 `worker.terminate?.()`，两步失败都发生时抛 `CLEANUP_FAILED` 的 `AggregateError`。

**`createSerializeWorkerHandler`｜10 秒上手** —— Worker 侧的对端，把一个普通 `ISerializeParser` 接成消息处理器：

```ts
const handler = createSerializeWorkerHandler(parser, (message, transfer) =>
  self.postMessage(message, { transfer })
);
```

签名：`(parser: ISerializeParser, post: (message: unknown, transfer?: readonly Transferable[]) => void) => IManagedRpcHandler`。两个参数均必填，非对象/非函数同步抛 `INVALID_OPTION`。`parser`/`post` 的解码/编码结果、多段流式输出的本地拼装规则见 [USEGUIDE §6.5](./USEGUIDE.md#65-多段结果的本地拼装)。

**`mergeWorkerChunks`｜5 秒上手** —— 把多个 `ISerializeChunk` 拼成一个，`createSerializeWorkerHandler` 内部用它拼装 `parser.encode()` 的多段流式输出：

```ts
const merged = mergeWorkerChunks([chunk1, chunk2]); // 全 text 则字符串拼接，否则统一转字节拼接
```

单参数 `chunks: readonly ISerializeChunk[]`（必填），无选项。空数组抛 `SerializeCodecError`(`CHUNK_MERGE_FAILED`)；混入 `value` 段(已物化的对象图，不能与 text/bytes 混拼)同样抛错；只有一段时直接返回该段。

---

<a id="constants"></a>

## 常量

```ts
import { WorkerOwnership, WorkerDiagnosticType } from '@migaia/store-worker';
```

**`WorkerOwnership`｜3 秒上手** —— 值过 Worker 边界的所有权策略标签：

```ts
WorkerOwnership.transfer; // 'transfer'
WorkerOwnership.clone; // 'clone'
```

无调用参数，`as const` 常量对象；`IWorkerOwnership` 是其取值的联合类型。注意实际配置 `workerPlugin`/`workerParser` 的字节转移策略用的是各自 `ownership` 选项的字符串字面量 `'copy' | 'transfer'`(类型别名 `IByteOwnership`)，与这个常量是两套独立命名，不要混用。

**`WorkerDiagnosticType`｜3 秒上手** —— 序列化 Worker 集成的诊断来源标签，出现在 `SerializeCodecError`/`SerializeError` 的 `type` 字段默认值里：

```ts
WorkerDiagnosticType.worker; // 'worker'
```

无调用参数，常量对象；`IWorkerDiagnosticType` 是其取值的联合类型。

---

<a id="errors"></a>

## 错误码与错误工厂

```ts
import {
  StoreWorkerErrorCode,
  createStoreWorkerError,
  createStoreWorkerAggregateError
} from '@migaia/store-worker';
```

**`StoreWorkerErrorCode`｜3 秒上手** —— 稳定错误码表：

```ts
if (error.code === StoreWorkerErrorCode.adapterDisposed) {
  /* ... */
}
```

全部取值：`invalidOption`(`INVALID_OPTION`)、`adapterDisposed`(`ADAPTER_DISPOSED`)、`requestAborted`(`REQUEST_ABORTED`)、`invalidRequestChunk`(`INVALID_REQUEST_CHUNK`)、`invalidResponseChunk`(`INVALID_RESPONSE_CHUNK`)、`chunkMergeFailed`(`CHUNK_MERGE_FAILED`)、`cleanupFailed`(`CLEANUP_FAILED`)。

**`createStoreWorkerError`｜5 秒上手**：

```ts
throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, '自定义消息');
```

签名：`(code: IStoreWorkerErrorCode, message: string, options?: { readonly cause?: unknown }) => Error`，内部经 `attachErrorIdentity` 贴上 `source: '@migaia/store-worker'` 与传入的 `code`。

**`createStoreWorkerAggregateError`｜5 秒上手**：

```ts
throw createStoreWorkerAggregateError(StoreWorkerErrorCode.cleanupFailed, [err1, err2], '清理失败');
```

签名：`(code: IStoreWorkerErrorCode, errors: readonly unknown[], message: string) => AggregateError`，`errors` 原样保留在结果的 `errors` 字段。

`STORE_WORKER_SOURCE`(`'@migaia/store-worker'`)是贴在每个本包错误上的固定 `source` 值，用于判定"是否是本包抛出的错误"。

---

<a id="性能特征"></a>

## 性能特征

以下数字来自包内注释记录的实测结论(测试规模:100 万条记录、71.5MB)：

| 方案                                                     | 主线程阻塞时长 | 相对直接在主线程做 JSON                           |
| -------------------------------------------------------- | -------------- | ------------------------------------------------- |
| 字节进、字节出(走 transfer，结果不还原成主线程对象图)    | 约 1.4ms       | 快约 46 倍(直接 JSON 约 65ms)，墙钟总耗时基本持平 |
| 对象图 `postMessage` 进 Worker(需要在主线程还原成对象图) | 约 126ms       | 比主线程直接做还慢一倍                            |

结论：只有当 Worker 的输入输出都停留在字节层面时，把编解码搬进 Worker 才是净收益；结构化克隆本身在调用方线程同步完成，把对象图丢给 Worker 只是把 `JSON.stringify` 的开销换成结构化克隆的开销。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 大对象派生计算，带取消与 TTL 缓存

```ts
// aggregate.worker.ts
import { createWorkerHandler } from '@migaia/store-worker';

declare const self: DedicatedWorkerGlobalScope;

type Row = { readonly category: string; readonly amount: number };

const handler = createWorkerHandler<readonly Row[], Record<string, number>>(
  (rows, { signal }) => {
    const totals: Record<string, number> = {};
    for (const row of rows) {
      signal.throwIfAborted?.();
      totals[row.category] = (totals[row.category] ?? 0) + row.amount;
    }
    return totals;
  },
  (message) => self.postMessage(message)
);
self.onmessage = (event) => {
  void handler(event.data);
};
```

```ts
// main.ts
import { WorkerAdapter, workerComputed } from '@migaia/store-worker';
import { Signal, defaultRuntime } from '@migaia/reactive';

const worker = new Worker(new URL('./aggregate.worker.ts', import.meta.url), { type: 'module' });
const adapter = new WorkerAdapter(worker, { timeoutMs: 10_000 });

const rows = new Signal<readonly Row[]>([], defaultRuntime);
const totals = workerComputed(adapter, () => rows.value, {
  ttl: 30_000,
  staleWhileRevalidate: true,
  debugName: 'category-totals'
});

rows.value = fetchedRows;
console.log(await totals.refetch());

totals.dispose();
adapter.dispose();
worker.terminate();
```

### 2. 序列化编解码卸载，接入现有注册表并连带终止 Worker

```ts
// encode.worker.ts
import { createSerializeWorkerHandler } from '@migaia/store-worker/serialize/worker';
import { jsonParser } from '@migaia/serialize';

declare const self: DedicatedWorkerGlobalScope;

const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>
  self.postMessage(message, { transfer })
);
self.onmessage = (event) => {
  void handler(event.data);
};
```

```ts
// main.ts
import { workerPlugin } from '@migaia/store-worker/serialize/worker';
import { createSerializeRegistry } from '@migaia/serialize';

const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
const registry = createSerializeRegistry([workerPlugin({ worker, terminateOnDispose: true })]);

const chunk = await registry.encode({ id: 1, name: 'demo' });
const value = await registry.decode(chunk);

registry.dispose(); // 连带 dispose workerParser 的端点，并 terminate worker
```

### 3. 用错误码分支处理 abort 场景，判断是否可以重试

```ts
import { StoreWorkerErrorCode } from '@migaia/store-worker';

try {
  await adapter.request(payload, { signal: controller.signal, transfer: [buffer] });
} catch (error) {
  if ((error as { code?: string }).code === StoreWorkerErrorCode.requestAborted) {
    // ownership: 'transfer' 场景下原始数据已 detach，不能直接重试同一份数据
  }
  throw error;
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm --filter @migaia/store-worker fmt
pnpm --filter @migaia/store-worker lint
pnpm --filter @migaia/store-worker typecheck
pnpm --filter @migaia/store-worker typecheck:test
pnpm --filter @migaia/store-worker test
pnpm --filter @migaia/store-worker typecheck:e2e
pnpm --filter @migaia/store-worker test:e2e
pnpm --filter @migaia/store-worker build
```

`test` 覆盖 adapter、handler、序列化与错误契约；`test:e2e` 用真实 Worker 通信验证浏览器路径，运行前需要有 Playwright 浏览器。
