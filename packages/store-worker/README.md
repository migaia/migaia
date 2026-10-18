# `@migaia/store-worker`

把 Store 的响应式计算和序列化编解码搬到 Worker 里跑：主线程用几乎和调本地异步函数一样的写法把耗时工作丢给 Worker，同时保留 `@migaia/resource` 的 `Resource` 的取消、去重、缓存能力。本包**不实现**任何消息协议——协议、超时、取消、来源校验全部来自 `@migaia/rpc-core`，这里只负责把这些通用能力接到 Store 生态的两个具体场景上：通用计算卸载(`WorkerAdapter`/`workerComputed`)与序列化编解码卸载(`workerPlugin`)。

## 适用与不适用场景

**适用**：`Resource` 的取数/计算逻辑很重会卡主线程，用 `workerComputed()` 把 fetcher 换成 Worker 调用；某种序列化格式的编解码需要放进 Worker 跑，用 `workerPlugin()` 接入 `@migaia/serialize` 的插件注册表；落盘/传输前需要对纯字节做编解码(字节进、字节出，走显式 transfer 归属策略)；需要一个不依赖具体协议细节的 Worker 请求/响应模型。

**不适用**：计算量小、同步就能算完的派生逻辑——引入 Worker 通信本身有固定的序列化和消息往返成本，小任务过 Worker 反而更慢；对象图(非纯字节)走 Worker 编解码同样不划算，实测比主线程直接做还慢一倍(见[性能特征](#性能特征))。

依赖 `@migaia/reactive`、`@migaia/resource`、`@migaia/serialize`、`@migaia/rpc-core`、`@migaia/rpc-contract`、`@migaia/utils`(均为 workspace 依赖，随包一起装好)。

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

- `clientId?: string` —— 本端在 RPC 拓扑里的 id，默认 `'main'`
- `timeoutMs?: number` —— 请求默认超时(毫秒)，省略时不设默认超时

实例方法：

- `request<Input, Output>(payload: Input, options?: { signal?: IAbortSignal; transfer?: readonly unknown[] }): Promise<Output>` —— 发起一次 RPC 调用；`signal` 用于取消，`transfer` 指定转移列表；非法 `options` 或 hostile getter 以带 `INVALID_OPTION` 的 rejected Promise 返回
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

- `compute: (payload: Input, context: { signal: INativeAbortSignal }) => Output | Promise<Output>`（必填）—— 真正干活的函数；`compute` 抛出的异常会被 RPC 端点框架捕获转成失败响应，不会逃逸成 Worker 的 unhandled error
- `postMessage: (message: unknown) => void`（必填）—— Worker 侧发消息回主线程的函数，通常传 `(message) => self.postMessage(message)`
- `options.timeoutMs?: number` —— 该端点发起 request 的默认超时；不会限制本端 provider compute 的执行期限；通常在主端 Adapter 配置请求超时

返回值 `IManagedRpcHandler` 是一个函数(需要手动接上 `self.onmessage`)，额外带 `dispose()`/`close()`/`pendingCount`/`disposed`，见 [USEGUIDE §4](./USEGUIDE.md#4-imanagedrpchandler-生命周期细节)。

---

<a id="worker-computed"></a>

## `workerComputed`：接入 `Resource`

```ts
import { WorkerAdapter, workerComputed } from '@migaia/store-worker';
```

**`workerComputed`｜10 秒上手** —— 把 `WorkerAdapter.request()` 接进 `@migaia/resource` 的 `Resource`：

```ts
import { defaultRuntime } from '@migaia/reactive';

const values = defaultRuntime.signal([1, 2, 3]);
const sum = workerComputed(adapter, () => values.value);

console.log(await sum.refetch()); // 6
sum.dispose();
```

签名：`<Input, Output>(adapter: WorkerAdapter, selectInput: () => Input, options?: IWorkerComputedOptions<Input, Output>) => Resource<Output>`。

- `adapter`（必填）—— 已构造好的 `WorkerAdapter`；`workerComputed` 不管理它的生命周期，`adapter.dispose()` 需要调用方自己在合适的时机调用
- `selectInput`（必填）—— 同步函数，返回值作为 RPC 的 `payload`；在 `Resource` 的 fetcher 里被同步调用一次，函数体读取的响应式值会被记为依赖

`IWorkerComputedOptions<Input, Output>` 全部字段(是 `IResourceOptions<Output>` 的超集)：

- `runtime?: IRuntime` —— 默认 `defaultRuntime`
- `transfer?: (input: Input) => readonly unknown[]` —— 给定 `input`，返回这次调用要转移的列表；只在确认 `input` 转移后不会再被主线程使用时才该提供
- `debugName?`、`ttl?`、`autoStart?`、`staleWhileRevalidate?`、`retry?`、`retryDelay?`、`keepAlive?`、`initialSnapshot?`、`scheduler?` —— 原样透传给 `Resource`，语义与 `@migaia/resource` 的 `IResourceOptions` 完全一致

返回标准 `Resource<Output>` 实例，`refetch()`/`.state`/`dispose()` 等用法与直接 `new Resource(...)` 得到的对象没有区别。非法 `adapter`/`selectInput`/`transfer` 会同步抛出带 `INVALID_OPTION` 的错误。

---

<a id="serialize-worker"></a>

## 序列化 Worker 集成（子路径 `/serialize/worker`）

```ts
import {
  workerParser,
  workerPlugin,
  createSerializeWorkerHandler
} from '@migaia/store-worker/serialize/worker';
// 序列化工厂仅从此具体子路径导入；根入口只负责通用计算与公共诊断类型。
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
- `ownership?: 'copy' | 'transfer'` —— 字节数据过边界时复制还是转移，默认 `'copy'`
- `clientId?: string` —— 本端在 RPC 拓扑里的 id，默认 `'main'`

**`workerParser`｜5 秒上手** —— `workerPlugin` 内部使用的主线程侧 `ISerializeParser` 实现，也可单独使用：

```ts
const parser = workerParser({ worker });
```

签名同 `workerPlugin` 的 `options`。`encode`/`decode` 都通过 RPC 转发给 Worker；Uint8Array 按 bytes 段分类，其他值按 value 段；当前 portable RPC 桥在发送前把 bytes 编成 base64url，transfer list 独立传递，detach 不代表载荷零拷贝。`dispose()` 异步释放端点，`terminateOnDispose: true` 时额外尝试 `worker.terminate?.()`，两步失败都发生时抛 `CLEANUP_FAILED` 的 `AggregateError`。

**`createSerializeWorkerHandler`｜10 秒上手** —— Worker 侧的对端，把一个普通 `ISerializeParser` 接成消息处理器：

```ts
const handler = createSerializeWorkerHandler(parser, (message, transfer) =>
  self.postMessage(message, { transfer })
);
```

签名：`(parser: ISerializeParser, post: (message: unknown, transfer?: readonly unknown[]) => void) => IManagedRpcHandler`。两个参数均必填，非对象/非函数同步抛 `INVALID_OPTION`。encode 多段按 open/chunk/end 与两 credit/ACK 逐块传送，见 USEGUIDE §6.5；终结错误由 canonical RPC error response 传整链，不发送普通应用 error 帧。

---

<a id="constants"></a>

## 常量

```ts
import { WorkerByteOwnership, WorkerDiagnosticType } from '@migaia/store-worker';
```

**`WorkerByteOwnership`｜3 秒上手** —— 序列化字节跨 Worker 边界时的所有权策略：

```ts
WorkerByteOwnership.copy; // 'copy'
WorkerByteOwnership.transfer; // 'transfer'
```

无调用参数，`as const` 常量对象；`IByteOwnership` 是其取值的联合类型，也是 `workerPlugin`/`workerParser` 的 `ownership` 选项类型。

**`WorkerDiagnosticType`｜3 秒上手** —— 序列化 Worker 集成的诊断来源标签，出现在 `SerializeCodecError` 的 `type` 字段默认值里：

```ts
WorkerDiagnosticType.worker; // 'worker'
```

无调用参数，常量对象；`IWorkerDiagnosticType` 是其取值的联合类型。

---

<a id="errors"></a>

## 错误码与错误工厂

```ts
import { StoreWorkerErrorCode, createStoreWorkerError, createStoreWorkerAggregateError } from '@migaia/store-worker';
```

**`StoreWorkerErrorCode`｜3 秒上手** —— 稳定错误码表：

```ts
if (error.code === StoreWorkerErrorCode.adapterDisposed) {
  /* ... */
}
```

全部取值：`invalidOption`(`INVALID_OPTION`)、`adapterDisposed`(`ADAPTER_DISPOSED`)、`requestAborted`(`REQUEST_ABORTED`)、`invalidRequestChunk`(`INVALID_REQUEST_CHUNK`)、`invalidResponseChunk`(`INVALID_RESPONSE_CHUNK`)、`cleanupFailed`(`CLEANUP_FAILED`)。

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

当前桥接会把 bytes 编成 base64url portable payload，随后独立传 native transfer list；原 buffer detach 与载荷零拷贝不是同一保证。本任务没有当前性能测量，旧的 1.4ms/46 倍等数据不再作为此实现结论。是否适合卸载取决于实际计算、编码与通信成本。

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
      if (signal.aborted) throw signal.reason;
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
import { defaultRuntime } from '@migaia/reactive';

const worker = new Worker(new URL('./aggregate.worker.ts', import.meta.url), { type: 'module' });
const adapter = new WorkerAdapter(worker, { timeoutMs: 10_000 });

const rows = defaultRuntime.signal<readonly Row[]>([]);
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
import { isRpcError, RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-core';

try {
  await adapter.request(payload, { signal: controller.signal, transfer: [buffer] });
} catch (error) {
  if (isRpcError(error) && error.source === RPC_CORE_ERROR_SOURCE && error.code === RpcCoreErrorCode.cancelled) {
    // 通用 Adapter 保留 RPC 取消身份；检查原 buffer 实际状态，再决定能否重试。
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


独立调用请用 `Promise.all`：已协商 `batch@1` 的内建载体在物理写空闲时立即单帧发送，写进行中就绪的调用由 RPC core 自动合并；请求与响应共用该机制。`request` 等对端处理完成，现有 worker contract endpoint 的 `notify` 只等发出。有依赖的串行 `await` 无法自动合并。`WorkerAdapter` 继续使用现有 `request` API。


Stream cancellation keeps its native DOMException/AbortError and original message/stack. Worker credit waits and explicit stream stop attach the existing @migaia/store-worker / REQUEST_ABORTED identity; cancellation remains separate from codec or cleanup failure.

入口迁移：workerParser/workerPlugin/createSerializeWorkerHandler 仅从 @migaia/store-worker/serialize/worker 导入；删除根 aliases。encodeWorkerValue/decodeWorkerValue 合为内部分类函数，transferablesOf 仅内部使用；显式 exports 不再公开 serialize/* 通配入口。移除无抛点的 CHUNK_MERGE_FAILED；其余六码保持。旧导入/成员引用需 breaking 迁移，无 shim。
