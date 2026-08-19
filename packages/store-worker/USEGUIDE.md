# 使用手册

本文是 `@migaia/store-worker` 的完整参考手册，面向已经读过 [README.md](./README.md) 五分钟上手部分、需要深入了解具体配置项和边界行为的开发者。README 讲"是什么、能干什么、怎么快速上手"，本文讲"每一个配置项、每一种错误、每一个坑的具体细节"。

## 目录

1. [核心概念详解](#1-核心概念详解)
2. [`WorkerAdapter` 完整参考](#2-workeradapter-完整参考)
3. [`createWorkerHandler` 完整参考](#3-createworkerhandler-完整参考)
4. [`ManagedRpcHandler` 生命周期细节](#4-managedrpchandler-生命周期细节)
5. [`workerComputed` 完整参考](#5-workercomputed-完整参考)
6. [序列化 Worker 集成完整参考](#6-序列化-worker-集成完整参考)
7. [常量与错误码完整参考](#7-常量与错误码完整参考)
8. [字节转移语义（`IByteOwnership`）](#8-字节转移语义ibyteownership)
9. [错误处理](#9-错误处理)
10. [性能特征](#10-性能特征)
11. [完整场景示例](#11-完整场景示例)
12. [常见问题排查](#12-常见问题排查)
13. [构建、格式化与测试](#13-构建格式化与测试)

---

## 1. 核心概念详解

`@migaia/store-worker` 本身不实现任何通信协议——协议编解码、超时、取消、来源校验全部来自 `@migaia/web-rpc`，这个包只是把 web-rpc 的 `createEndpoint()`/`createWebWorkerTransport()` 按 Store 的两个具体场景（通用计算卸载、序列化编解码卸载）预先接好线。理解这个包，本质上是理解它怎么"抄近路"用 web-rpc：

### 1.1 主线程 ↔ Worker 是固定拓扑

包内所有端点都固定用 `createWebWorkerTransport`，`topology` 恒为 `exclusive`——一条通道从始至终只有唯一的一对发送方/接收方，因此不需要像 SharedWorker 场景那样额外做身份校验；`connect()` 中间件在这里只负责基础一致性检查和服务发现，不需要自定义 `identifier`。

### 1.2 两条独立的集成路径

| 路径             | 主线程侧                                | Worker 侧                      | 用于                                                                                              |
| ---------------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| 通用计算卸载     | `WorkerAdapter`                         | `createWorkerHandler`          | 任意 `Input → Output` 的一次性计算，配合 `workerComputed` 接入 `Resource`                         |
| 序列化编解码卸载 | `workerPlugin`（内部用 `workerParser`） | `createSerializeWorkerHandler` | 把一个 `ISerializeParser` 的 `encode`/`decode` 搬进 Worker，接入 `@migaia/serialize` 的插件注册表 |

两条路径共享同一个 RPC 方法名约定：`send(targetId, 'call', payload)`。这不是巧合——两条路径底层都是"主线程发一个 `call` 请求，Worker 侧的单个 `provide('call', ...)` 处理它",只是 payload 的形状不同（前者是任意 `Input`，后者是 `{ phase, chunk }`）。

### 1.3 `ManagedRpcHandler`：Worker 侧的统一外壳

`createWorkerHandler` 和 `createSerializeWorkerHandler` 都返回一个 `ManagedRpcHandler`：

```ts
export type ManagedRpcHandler = {
  (message: unknown): Promise<void>;
  dispose(): Promise<void>;
  close(): void;
  readonly pendingCount: number;
  readonly disposed: boolean;
};
```

它本身**就是**一个函数——`self.onmessage = (event) => handler(event.data)` 是标准接法。之所以设计成"需要手动喂消息"而不是内部自动 `addEventListener`，是因为 Worker 侧的传输对象是包里手工搭的最小实现（`{ platform: 'Worker', peerId: 'main', send, subscribe }`），并不经过 `createWebWorkerTransport`——这样 Worker 侧就不需要引入完整的 web-rpc 适配器逻辑，胶水代码维持在几行以内。

### 1.4 `IWorkerPort` / `IWorkerLike`

主线程侧需要传入的 `port`/`worker` 类型是 `IWebWorkerLikePort`（`WorkerAdapter` 用的 `IWorkerPort` 就是它的别名）：

```ts
type IWebWorkerLikePort = {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: MessageEvent<unknown> | Event) => void
  ): void;
};
```

真实的 `Worker`、`MessagePort`、`SharedWorker.port` 都天然满足这个形状，不需要额外包装。序列化集成用的 `IWorkerLike` 是它加一个可选 `terminate?()` 方法的超集（用来支持 `terminateOnDispose`）。

---

## 2. `WorkerAdapter` 完整参考

```ts
class WorkerAdapter {
  constructor(
    port: IWorkerPort,
    options?: { readonly clientId?: string; readonly timeoutMs?: number }
  );
  readonly disposed: boolean;
  request<Input, Output>(
    payload: Input,
    options?: { signal?: AbortSignal; transfer?: readonly Transferable[] }
  ): Promise<Output>;
  close(): void;
  dispose(): Promise<void>;
}
```

- **`port`**：满足 `IWorkerPort` 的对象，通常直接传 `new Worker(...)`。
- **`options.clientId`**：本端在 web-rpc 拓扑里的 `id`，默认 `'main'`。同一个 Worker 如果被多个 `WorkerAdapter` 实例共用（不推荐，见下方注意事项），需要传不同的 `clientId` 区分。
- **`options.timeoutMs`**：请求默认超时（毫秒）。省略时不设默认超时——单次 `request()` 一直等对方响应，可以在 `request()` 调用点传 `signal` 自行控制取消。
- **`request<Input, Output>(payload, options)`**：发起一次 `'call'` RPC 调用。入口会在返回 Promise 前一次性读取 `options.signal`/`options.transfer`，endpoint 尚未就绪期间不再读取调用者对象；getter 失败或非法 options 以带 `INVALID_OPTION` 的 rejected Promise 返回并保留 `cause`。`signal` 用于取消，`transfer` 指定零拷贝转移列表（比如 `Uint8Array.buffer`）。
- **构造是异步的，但构造函数本身同步返回**：`createEndpoint()` 内部是异步的（要跑完中间件安装），`WorkerAdapter` 把这个 Promise 存在私有字段里，`request()` 会先 `await` 它再发请求——调用方不需要显式等待"连接就绪"，直接 `new WorkerAdapter(worker).request(...)` 就能用。
- **`close()`**：同步标记不可用（`disposed = true`，幂等），此后 `request()` 立即拒绝，但**不**释放底层 endpoint。
- **`dispose()`**：唯一异步释放入口——先 `close()`，再等待底层 endpoint 初始化并执行 `endpoint.dispose()`。失败会 reject（**不吞错**），重复调用复用同一个 Promise。需要"立刻标记不可用、暂不关心清理完成"时用 `close()`；需要强一致的清理确认时 `await dispose()`。

一个 `WorkerAdapter` 对应一个 Worker 连接，`request()` 可以并发调用多次——底层的 `abort()`/`timeout()` 中间件按请求粒度独立管理，互不影响。

---

## 3. `createWorkerHandler` 完整参考

```ts
function createWorkerHandler<Input, Output>(
  compute: (payload: Input, context: { signal: IWebRpcAbortSignal }) => Output | Promise<Output>,
  postMessage: (message: unknown) => void,
  options?: { readonly timeoutMs?: number }
): ManagedRpcHandler;
```

- **`compute`**：真正干活的函数，接收主线程传来的 `payload` 和一个 `{ signal }` 上下文——`signal` 在调用方取消/超时时触发，`compute` 内部如果是可中断的长任务，应该监听它并尽早退出（框架不会强行中断正在跑的同步/异步代码，只是让最终结果被丢弃、返回给一个已经不再等待的调用方）。
- **`postMessage`**：Worker 侧真正发消息出去的函数，通常传 `(message) => self.postMessage(message)`。之所以是参数而不是包内部写死 `self.postMessage`，是为了同一份实现能在真正的 Worker、`SharedWorker` 的某个 `port`、甚至单元测试的内存桩上复用。
- **`options.timeoutMs`**：Worker 侧对每次请求处理设的超时（一般主线程侧的 `timeoutMs` 已经够用，Worker 侧这个是双保险）。
- **返回值**：一个 `ManagedRpcHandler`，需要手动接上 `self.onmessage = (event) => { void handler(event.data); }`（返回的 Promise 通常不需要显式处理——错误会被 web-rpc 转成 RPC 失败响应发回主线程，不会变成 unhandled rejection）。

内部实现上，`provide('call', ...)` 里对 `compute` 的调用结果统一走 `context.success(...)` 包装；`compute` 抛出的异常由 web-rpc 端点框架捕获并转成失败响应，不会让异常逃逸成 Worker 全局的 unhandled error。

---

## 4. `ManagedRpcHandler` 生命周期细节

```ts
const handler = createWorkerHandler(compute, postMessage);

handler.pendingCount; // 0 —— 当前正在处理中的消息数
handler.disposed; // false

await handler(incomingMessage); // 处理一条消息；disposed 时直接返回，静默丢弃

handler.close(); // 同步标记不可用；不执行底层清理
await handler.dispose(); // 先 close()，再等底层端点初始化并 dispose；失败会 reject
```

- **`handler(message)`**：`disposed === true` 时直接返回 `Promise<void>`（resolve），不会处理也不会报错——这是有意的静默丢弃：`close()`/`dispose()` 之后 Worker 可能还会因为消息队列里的残留消息被再调用一次，不应该因此抛错。
- **`pendingCount`**：每次调用 `handler(message)` admission 时 +1，等待 endpoint 并同步交付消息后 -1。它是 inbound dispatch 指标，**不代表 provider compute 已完成**，也不能作为 `Worker.terminate()` 的 quiescence 门禁；真正的 provider drain/cleanup 由 Web RPC endpoint 拥有，终止前必须等待 `handler.dispose()` 完成。
- **`close()` vs `dispose()`**：`close()` 同步标记 `disposed = true`，只负责"停止接受新消息"，不触发任何用户清理；`dispose()` 是唯一异步释放入口，内部先 `close()`，再等待底层 endpoint 初始化并执行 `endpoint.dispose()`，清理失败时会把错误 reject 出来（错误形态与 `@migaia/web-rpc` 的 `endpoint.dispose()` 一致，是 `WebRpcLifecycleError`，`cleanupErrors` 字段列出具体哪个资源没清理干净）。两者都是幂等的——`close()` 重复调用是无操作；`dispose()` 多次调用复用同一个 Promise，不会重复触发清理。

---

## 5. `workerComputed` 完整参考

```ts
type IWorkerComputedOptions<Input, Output> = IResourceOptions<Output> & {
  readonly runtime?: IRuntime;
  readonly transfer?: (input: Input) => readonly Transferable[];
};

function workerComputed<Input, Output>(
  adapter: WorkerAdapter,
  selectInput: () => Input,
  options?: IWorkerComputedOptions<Input, Output>
): Resource<Output>;
```

`workerComputed` 是 `WorkerAdapter.request()` 和 `@migaia/resource` 的 `Resource` 之间的一层薄粘合：

构造入口会先验证 `adapter`、`selectInput` 与可选 `transfer`，并只读取 runtime/Resource 已知 options 一次；不会通过 object-rest 枚举未知属性。非法 callback 或 hostile getter 在 Resource ownership/auto-start 前同步抛带 `INVALID_OPTION` 的 Store Worker 错误，getter 原异常保留在 `cause`。

```ts
new Resource<Output>(
  ({ signal }) => {
    const input = selectInput();
    return adapter.request<Input, Output>(input, { signal, transfer: transfer?.(input) });
  },
  runtime,
  resourceOptions
);
```

`compute` 与 `postMessage` 会在 transport/endpoint 创建前同步验证；非法 JavaScript 输入以 Store Worker `INVALID_OPTION` 拒绝，不会返回半构造 handler。

- **`adapter`**：一个已经构造好的 `WorkerAdapter`，`workerComputed` 不管理它的生命周期——`adapter.dispose()` 需要调用方自己在合适的时机调用（通常晚于 `Resource.dispose()`，因为 Resource 释放时可能还有一次正在飞行的请求依赖这个 adapter）。
- **`selectInput`**：同步函数，返回值作为 RPC 的 `payload`。它在 `Resource` 的 fetcher 里被同步调用一次——函数体里读取的响应式值（signal/computed）会被 `Resource` 记为依赖，依赖变化会让 `Resource` 重新发起请求。异步读取（比如 `await` 之后再读）不会被追踪到，这是 `@migaia/resource` 的通用限制，不是 `workerComputed` 特有的。
- **`options.runtime`**：传给 `Resource` 的响应式运行时，默认 `defaultRuntime`（来自 `@migaia/reactive`）。
- **`options.transfer`**：给定 `input`，返回这次调用要零拷贝转移的 `Transferable[]`。只在你确认 `input` 里的数据转移后不会再被主线程使用时才该提供——转移是破坏性的，见 [§8](#8-字节转移语义ibyteownership)。
- **其余字段**（`ttl`、`autoStart`、`staleWhileRevalidate`、`retry`、`retryDelay`、`keepAlive`、`initialSnapshot`、`debugName`）：原样透传给 `Resource`，语义与 `@migaia/resource` 的 `IResourceOptions` 完全一致，本文不重复展开，参见该包文档。

返回的 `Resource<Output>` 是标准 `Resource` 实例——`refetch()`、`.state`、`dispose()` 等一切用法与直接 `new Resource(...)` 得到的对象没有区别，唯一的差异只是 fetcher 内部换成了 Worker 调用。

---

## 6. 序列化 Worker 集成完整参考

子路径：`@migaia/store-worker/serialize/worker`。

### 6.1 `IWorkerPluginOptions`

```ts
type IWorkerPluginOptions = {
  readonly worker: IWorkerLike;
  readonly type?: string;
  readonly terminateOnDispose?: boolean;
  readonly ownership?: IByteOwnership;
  readonly clientId?: string;
};
```

| 字段                 | 默认值     | 说明                                                                                                                |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `worker`             | 必需       | 满足 `IWorkerLike`（`IWebWorkerLikePort` 加可选 `terminate()`）的对象                                               |
| `type`               | `'worker'` | 写进 `ISerializePlugin.type` 的注册表格式标签，需要和读取这份存档时用的标签一致                                     |
| `terminateOnDispose` | `false`    | `dispose()` 时是否顺带调用 `worker.terminate?.()`。外部传入的 Worker 默认被认为归调用方所有，不由这个包代管生命周期 |
| `ownership`          | `'copy'`   | 字节数据过边界时是复制还是零拷贝转移，见 [§8](#8-字节转移语义ibyteownership)                                        |
| `clientId`           | `'main'`   | 本端在 web-rpc 拓扑里的 `id`                                                                                        |

### 6.2 `workerParser(options): ISerializeParser`

主线程侧的 `ISerializeParser` 实现，`encode`/`decode` 都通过 `send('worker', 'call', { phase, chunk }, ...)` 把工作转发给 Worker：

- `encode(value, context)`：如果 `value` 本身就是 `Uint8Array`，按 `['bytes', value]` 段发送（唯一能进 `transfer` 列表、走零拷贝的形态）；否则按 `['value', value]` 段发送（会退化为结构化克隆，整份数据先在主线程复制一遍再发出去）。
- `decode(chunk, context)`：请求 Worker 解码，返回值取自结果段的负载（`result[1]`），调用方拿到的就是还原后的值本身，不是包一层的 `ISerializeChunk`。
- `dispose()`：异步 dispose 底层端点，并在 `terminateOnDispose: true` 时继续尝试 `worker.terminate?.()`；两步都会执行。单个 cleanup 失败会被原样 reject，端点与 terminate 都失败时返回 `CLEANUP_FAILED` `AggregateError`，不会吞掉 parser/endpoint/terminate 错误。

`context.signal` 会作为这次 RPC 调用的取消信号透传；调用被取消时，`request` 内部会把泛化的 `AbortError` 重新包装成 `SerializeError`（见 [§9](#9-错误处理)），带上 `type`/`phase`/`source`/`chunkIndex`/`bytesConsumed` 这些定位信息，而不是让调用方拿到一个语义模糊的通用 abort 错误。

### 6.3 `workerPlugin(options): ISerializePlugin`

```ts
const workerPlugin = (options: IWorkerPluginOptions): ISerializePlugin => ({
  type: options.type ?? 'worker',
  parser: workerParser(options)
});
```

纯粹是 `{ type, parser: workerParser(options) }` 的包装，产出可以直接塞进 `createSerializeRegistry([...])` 插件数组的标准形状。

### 6.4 `createSerializeWorkerHandler(parser, post): ManagedRpcHandler`

```ts
function createSerializeWorkerHandler(
  parser: ISerializeParser,
  post: (message: unknown, transfer?: readonly Transferable[]) => void
): ManagedRpcHandler;
```

Worker 侧的对端：把一个**普通的、跑在 Worker 里就地工作的** `ISerializeParser`（不需要知道自己在被 RPC 调用）接成 `'call'` 方法的处理器。

- **`parser`**：真正做 encode/decode 的实现，比如 `@migaia/serialize` 内置的 `jsonParser()`，或者你自己写的格式插件。注意：只有 parser 本身是"字节进、字节出"时，走 Worker 才划算，见 [§10](#10-性能特征)。
- **`post`**：Worker 侧发消息回主线程的函数，通常是 `(message, transfer) => self.postMessage(message, { transfer })`。

请求处理时的分段逻辑：

- **`encode` 阶段**：不管主线程送来的是 `value` 段还是 `bytes` 段，转发给 `parser.encode()` 的都是段里的**负载本身**（`chunk[1]`），不是整个 `ISerializeChunk`。`parser.encode()` 的返回值可能是单段、`Promise`，或者（同步/异步）可迭代对象——多段的情况会在 Worker 本地就地拼装（见下方 §6.5），不会把结果原样透传回一堆分散的段。
- **`decode` 阶段**：`parser.decode()` 解出来的值如果是 `Uint8Array`，按 `['bytes', value]` 回包（才能走 transfer）；否则按 `['value', value]` 回包（退化为结构化克隆）。
- **异常处理**：`parser.encode`/`decode` 抛出的异常，以及送进来的 `chunk` 不满足 `isChunkShape` 校验的情况，都会直接 `throw`——和 `createWorkerHandler` 一样，由 web-rpc 端点框架统一捕获转成 RPC 失败响应，不会变成 Worker 的 unhandled error。

### 6.5 多段结果的本地拼装

`parser.encode()` 允许返回可迭代对象（流式输出多个 `ISerializeChunk`）。Worker 侧不引入完整的 `@migaia/serialize` 注册表逻辑来做这件事（避免把不需要的代码打进 Worker 包体），而是就地实现了一个最小拼装：

- 全部段都是 `'text'` 时，直接字符串拼接。
- 否则统一转成 `Uint8Array`（`'bytes'` 段直接用，`'text'` 段用 `TextEncoder` 编码）；`'value'` 段不能参与混合拼装，会抛出 `SerializeError`。
- 只有一段时直接返回该段，不做任何拼装。

这个拼装逻辑只在 `encode` 输出多段时触发，`decode` 的输入固定是单段（`ISerializeChunk`），不涉及拼装。

---

## 7. 常量与错误码完整参考

### 7.1 `mergeWorkerChunks(chunks)`

```ts
import { mergeWorkerChunks } from '@migaia/store-worker/serialize/worker';

function mergeWorkerChunks(chunks: readonly ISerializeChunk[]): ISerializeChunk;
```

独立的公开导出（子路径 `@migaia/store-worker/serialize/worker`，也可从包根 `@migaia/store-worker` 导入），把多个 `ISerializeChunk` 拼成一个。`createSerializeWorkerHandler` 内部用它拼装 `parser.encode()` 返回的多段流式输出（见 [§6.5](#65-多段结果的本地拼装)），也可以在业务代码里单独调用。

单参数 `chunks: readonly ISerializeChunk[]`（必填），无选项。边界行为：

- **空数组**：抛出 `SerializeCodecError`（`code: 'CHUNK_MERGE_FAILED'`，来自 `@migaia/serialize`），`type` 字段默认 `WorkerDiagnosticType.worker`，`phase` 恒为 `'encode'`。
- **单元素数组**：直接返回该元素本身，不做任何拷贝或包装。
- **全部是 `'text'` 段**：按顺序 `join('')` 字符串拼接，返回 `['text', 拼接结果]`。
- **混有 `'bytes'` 段**：统一转成 `Uint8Array`（`'bytes'` 段直接用，`'text'` 段用 `TextEncoder` 编码），逐段 `set()` 进一个新分配的定长缓冲区，返回 `['bytes', 合并后的 Uint8Array]`。
- **混入 `'value'` 段**（已物化的对象图，语义上不能与 text/bytes 字节流混拼）：同样抛出 `SerializeCodecError`（`code: 'CHUNK_MERGE_FAILED'`），不会尝试做任何隐式转换（比如 `String(value)`）。

### 7.2 `WorkerOwnership` / `WorkerDiagnosticType`

```ts
import { WorkerOwnership, WorkerDiagnosticType } from '@migaia/store-worker';
```

**`WorkerOwnership`** —— 值过 Worker 边界的所有权策略标签：

```ts
const WorkerOwnership = { transfer: 'transfer', clone: 'clone' } as const;
type IWorkerOwnership = 'transfer' | 'clone';
```

无调用参数，`as const` 常量对象。**注意**：这是一个独立命名空间，与实际配置 `workerPlugin`/`workerParser`/`workerComputed` 的字节转移策略所用的字符串字面量 `'copy' | 'transfer'`（类型别名 `IByteOwnership`，见 [§8](#8-字节转移语义ibyteownership)）不是同一套值——`WorkerOwnership.clone` 不等于配置里的 `'copy'`，两者不能互换使用，只是恰好都表达"转移 vs 复制/克隆"这个概念。

**`WorkerDiagnosticType`** —— 序列化 Worker 集成的诊断来源标签：

```ts
const WorkerDiagnosticType = { worker: 'worker' } as const;
type IWorkerDiagnosticType = 'worker';
```

无调用参数，常量对象；`WorkerDiagnosticType.worker`（即字符串 `'worker'`）是 `workerParser`/`createSerializeWorkerHandler` 产出的 `SerializeError`/`SerializeCodecError` 的 `type` 字段默认值（未显式传 `type`/`options.type` 时使用），也是 `mergeWorkerChunks` 抛错时固定使用的 `type`。

### 7.3 `StoreWorkerErrorCode` 与错误工厂

```ts
import {
  StoreWorkerErrorCode,
  createStoreWorkerError,
  createStoreWorkerAggregateError
} from '@migaia/store-worker';
```

**`StoreWorkerErrorCode`** —— 本包稳定错误码表，配合 `attachErrorIdentity` 贴出来的 `error.code` 字段做 `switch`/比较：

```ts
if ((error as { code?: string }).code === StoreWorkerErrorCode.adapterDisposed) {
  /* ... */
}
```

全部取值：

| 常量                   | 值                       | 触发场景                                                                                              |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `invalidOption`        | `INVALID_OPTION`         | Worker parser/adapter 的 options 在 JavaScript 边界上不是对象，或某个字段类型不对                     |
| `adapterDisposed`      | `ADAPTER_DISPOSED`       | Worker 适配器已释放（`close()`/`dispose()` 之后）继续调用                                             |
| `requestAborted`       | `REQUEST_ABORTED`        | Worker 侧的序列化请求被协作式取消（`AbortSignal`）；`ownership: 'transfer'` 时输入已 detach，不可重试 |
| `invalidRequestChunk`  | `INVALID_REQUEST_CHUNK`  | 发给 Worker 的请求 chunk 形状非法（`isChunkShape` 校验未通过），协议错误                              |
| `invalidResponseChunk` | `INVALID_RESPONSE_CHUNK` | Worker 返回的 chunk 形状非法，Worker 侧实现错误                                                       |
| `chunkMergeFailed`     | `CHUNK_MERGE_FAILED`     | `mergeWorkerChunks` 合并失败（空列表，或把 `'value'` 段并入字节流），parser 实现错误                  |
| `cleanupFailed`        | `CLEANUP_FAILED`         | 释放期间 endpoint 与（可选的）`worker.terminate()` 清理均失败                                         |

**`createStoreWorkerError(code, message, options?)`**：

```ts
throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, '自定义消息');
throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, '自定义消息', {
  cause: originalError
});
```

签名：`(code: IStoreWorkerErrorCode, message: string, options?: { readonly cause?: unknown }) => Error`。构造一个标准 `Error`，`options.cause` 提供时透传给原生 `Error` 的 `cause`；内部经 `@migaia/utils/error` 的 `attachErrorIdentity` 贴上 `source: '@migaia/store-worker'` 与传入的 `code`，不改写 `stack`。

**`createStoreWorkerAggregateError(code, errors, message)`**：

```ts
throw createStoreWorkerAggregateError(
  StoreWorkerErrorCode.cleanupFailed,
  [endpointDisposeError, terminateError],
  '清理失败'
);
```

签名：`(code: IStoreWorkerErrorCode, errors: readonly unknown[], message: string) => AggregateError`。构造 `AggregateError(errors, message)`，`errors` 原样保留在结果的 `errors` 字段（顺序不变），同样贴上 `(source, code)` 身份。包内唯一的实际调用点是 `workerParser().dispose()`——endpoint 清理与 `terminateOnDispose: true` 时的 `worker.terminate()` 若同时失败，两个原始错误都会被保留在 `errors[]` 里，不会只保留其中一个。

`STORE_WORKER_SOURCE`（`'@migaia/store-worker'`）是贴在每个本包错误上的固定 `source` 值，一般不需要手动引用，除非要用它去过滤/识别本包抛出的错误（例如把它和 `@migaia/web-rpc` 的 `WebRpcError`——`source: '@migaia/web-rpc'`——区分开）。

---

## 8. 字节转移语义（`IByteOwnership`）

```ts
type IByteOwnership = 'copy' | 'transfer';
```

- **`'copy'`（默认）**：数据结构化克隆过边界，调用方交出去之后原始数据依然可用。安全，但大数据量时有复制开销。
- **`'transfer'`**：显式要求零拷贝——底层 `ArrayBuffer` 被 transfer 到对方后立即 detach，**连同所有指向同一块内存的其它视图一起失效**。只有在你确认这段字节被独占持有、交出去之后不会再被读取时才该选它。

**转移只在满足两个条件时才真正发生**：

1. `ownership: 'transfer'` 且这一段是 `['bytes', Uint8Array]` 形态（`'text'`/`'value'` 段永远不会被 transfer，天然只能走复制）。
2. 这个 `Uint8Array` 的视图**恰好覆盖整个底层 `ArrayBuffer`**（`byteOffset === 0` 且 `byteLength === buffer.byteLength`）。`subarray()` 切出来的局部视图与原 buffer 共享内存，转移它会连累整块 buffer 和其它视图一起 detach——这种情况框架会**静默回退成复制**，不报错也不警告,只是转移优化不生效。

对应的判定函数只在包内部使用（`exclusiveBuffer`/`transferablesOf`），不对外导出，调用方不需要也不能自己调它——只需要知道"想让 transfer 生效，传进去的必须是覆盖整个 buffer 的顶层视图"这条规则即可。

`Worker` 崩溃或请求被取消这两种情况下，选了 `'transfer'` 的输入原地丢失（既没有结果，也回不去原始数据）——这是 `'copy'` 是默认值的直接原因,只有明确知道自己在干什么、并且能承受这个后果时才该切换。

---

## 9. 错误处理

### 8.1 通用 RPC 错误

`WorkerAdapter.request()`、`workerComputed` 内部、`createSerializeWorkerHandler` 之外的路径，抛出的错误都是标准 `@migaia/web-rpc` 的 `WebRpcError`（`METHOD_NOT_FOUND`、`DEADLINE_EXCEEDED`、`TRANSPORT`、`CANCELLED` 等），完整错误码表见 [`@migaia/web-rpc` 的 USEGUIDE](../web-rpc/USEGUIDE.md#8-错误处理)。判断时按 `error.code` 分支，不要依赖 `error.message` 或具体子类。

### 8.2 `workerParser` 的 abort 特殊处理

`workerParser` 请求被 `AbortSignal` 取消时,底层 `endpoint.send()` 会 reject 一个 `name === 'AbortError'` 的错误——`workerParser` 会拦下这个泛化错误,重新包装成 `SerializeError`（来自 `@migaia/serialize`）：

```ts
class SerializeError extends Error {
  readonly type: string; // 插件的 type 标签
  readonly phase: 'encode' | 'decode';
  readonly source: string; // 出错时定位是哪个 store/key 的辅助字段
  readonly chunkIndex: number; // 恒为 0（这一层不涉及分片索引）
  readonly bytesConsumed: number; // 输入是 bytes 段时为其字节长度，否则 0
}
```

消息文案里会额外附加一句提示：如果 `ownership === 'transfer'`,会明确写出"transferred input is detached and cannot be retried"——提醒调用方这次重试是没有意义的,原始输入已经被 detach 掉了。除了 `AbortError` 之外的其它错误原样透传,不做包装。

### 8.3 Worker 侧异常不会静默丢失

不管是 `createWorkerHandler` 的 `compute`,还是 `createSerializeWorkerHandler` 包裹的 `parser`,内部抛出的任何异常都会被 web-rpc 端点框架捕获、转成一次 RPC 失败响应发回主线程,主线程对应的 `request()`/`send()` 调用会以该错误 reject——不存在"Worker 内部炸了但主线程的 Promise 永远不 settle"的情况(前提是没有关掉 `timeout()`/网络层面自身没有异常断连,那类情况由 web-rpc 的 `onTransportError` 机制兜底,同样会让挂起请求失败,不会无限等待)。

---

## 10. 性能特征

以下数字来自包内注释记录的实测结论(测试规模:100 万条记录、71.5MB),用于判断"什么时候该用 Worker 卸载序列化"：

| 方案                                                                             | 主线程阻塞时长 | 相对直接在主线程做 JSON                          |
| -------------------------------------------------------------------------------- | -------------- | ------------------------------------------------ |
| 字节进、字节出(`Uint8Array` → `Uint8Array`,走 transfer,结果不还原成主线程对象图) | 约 1.4ms       | 快约 46 倍(直接 JSON 约 65ms),墙钟总耗时基本持平 |
| 对象图 `postMessage` 进 Worker(需要在主线程拿到还原后的对象)                     | 约 126ms       | 比主线程直接做还慢一倍                           |

结论:**只有当 Worker 的输入输出都停留在字节层面、不需要在主线程还原成对象图时**,把编解码搬进 Worker 才是净收益。结构化克隆本身是在调用方线程**同步**完成的——把对象图丢给 Worker 只是把"JSON.stringify 的开销"换成了"结构化克隆的开销",并不会因为"跑进了另一个线程"就自动变快。这也是为什么 `workerParser`/`createSerializeWorkerHandler` 的分段逻辑处处优先选择 `'bytes'` 段而不是 `'value'` 段:承接落盘/传输这类"拿到字节就结束"的活是它的目标场景,不要用它去加速 hydrate(把字节还原成对象)这一步。

---

## 11. 完整场景示例

### 10.1 大对象派生计算,带取消与 TTL 缓存

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
  ttl: 30_000, // 30 秒内复用结果,不重新触发 Worker 计算
  staleWhileRevalidate: true,
  debugName: 'category-totals'
});

rows.value = fetchedRows;
console.log(await totals.refetch());

totals.dispose();
adapter.dispose();
worker.terminate();
```

### 10.2 序列化编解码卸载,接入现有注册表

```ts
// encode.worker.ts
import { createSerializeWorkerHandler } from '@migaia/store-worker/serialize/worker';
import { jsonParser } from '@migaia/serialize';

declare const self: DedicatedWorkerGlobalScope;

// 提示:jsonParser 产出的是 'text' 段(对象图),不是本文档建议的 bytes-in/bytes-out
// 形态——放进 Worker 主要是为了演示接线方式,是否值得为具体数据量这样做,
// 请对照 §10 的实测数字自行判断。
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

registry.dispose(); // 连带 dispose workerParser 的端点,并 terminate worker
```

---

## 12. 常见问题排查

**Q:`request()`/`refetch()` 一直不 resolve 也不 reject。**
确认 Worker 侧确实调用了 `self.onmessage = (event) => handler(event.data)`——`ManagedRpcHandler` 不会自己挂监听,忘记接线是最常见的原因。其次检查 `WorkerAdapter`/`workerParser` 的 `timeoutMs` 是否设置了合理值,默认不限时意味着 Worker 真的没有响应时会一直挂起。

**Q:传了 `ownership: 'transfer'`,但性能并没有明显提升,像是走了复制。**
检查传入的 `Uint8Array` 是不是通过 `subarray()`/切片得到的局部视图——只有恰好覆盖整个 `ArrayBuffer` 的顶层视图才会真正被 transfer,局部视图会静默回退成复制,见 [§8](#8-字节转移语义ibyteownership)。

**Q:取消请求后想重试,但 `SerializeError` 提示"transferred input is detached and cannot be retried"。**
这不是可重试的错误——`ownership: 'transfer'` 场景下,一旦请求被送出、随即又被取消,原始 `ArrayBuffer` 已经在传输过程中被 detach,数据回不来了。需要重试的调用点应该改用 `ownership: 'copy'`,或者在业务层保留一份数据副本用于重试。

**Q:Worker 里的 `parser.encode()` 返回了多段(可迭代对象),主线程收到的结果不对。**
多段拼装只发生在 Worker 内部(`createSerializeWorkerHandler` 就地拼装后才回包给主线程,见 [§6.5](#65-多段结果的本地拼装)),主线程收到的应该始终是拼装后的单个 `ISerializeChunk`。如果结果不对,先确认 `parser.encode()` 各段的形态是否一致(全 `'text'` 才会走字符串拼接,否则统一按字节拼接)。`'value'` 是已经物化的对象图，不能与 text/bytes 混合拼装；混合时会直接抛出 `SerializeError`，不会隐式转成 `"[object Object]"`。

**Q:`adapter.dispose()`/`registry.dispose()` 之后,Worker 进程/线程还活着。**
`WorkerAdapter.dispose()`/`workerParser` 的 `dispose()` 默认只 dispose RPC 端点,不会 terminate 底层 `Worker`——外部传入的 Worker 默认被认为归调用方所有。需要连带终止 Worker,`workerPlugin`/`workerParser` 传 `terminateOnDispose: true`;`WorkerAdapter` 场景下需要调用方自己在合适的时机调用 `worker.terminate()`。

---

如果本文没有回答你的问题,`@migaia/web-rpc` 的 [USEGUIDE.md](../web-rpc/USEGUIDE.md) 覆盖了协议层(超时、取消、错误码、生命周期)的完整细节;`@migaia/resource`、`@migaia/serialize` 各自的文档覆盖 `Resource`/序列化注册表本身的行为。

## 13. 构建、格式化与测试

在仓库根目录运行：

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

`test` 覆盖 adapter、handler、序列化与错误契约；`test:e2e` 用真实 Worker 通信验证浏览器路径，运行前需有 Playwright 浏览器。
