# @migaia/store-worker

**把 Store 的响应式计算和序列化编解码搬到 Worker 里跑**——主线程通过和调本地异步函数几乎一样的写法，把耗时工作丢给 Worker，同时保留 `Resource` 的取消、去重、缓存这些响应式能力。

## 1. 这是什么

`@migaia/store` 里经常会遇到两类"贵"操作：一类是耗时的派生计算（比如对一大批数据做聚合、排序、过滤），另一类是大对象的序列化/反序列化（落盘、持久化、跨端传输前的编解码）。这两类操作如果直接放在主线程做，数据量一大就会卡住页面——但把它们搬进 Worker 又要处理一堆脏活：怎么把"调用 Worker 里的一个函数"包装成看起来像本地 `await`？Worker 崩了/消息读不出来怎么让所有等待中的请求都失败而不是永远挂起？大 `Uint8Array` 要不要零拷贝转移，转移了会不会把调用方手上的另一个视图也带崩？Worker 那一端只有寥寥几行胶水代码，要不要为此把整个 `@migaia/serialize` 注册表也打进 Worker 包体？

`@migaia/store-worker` 就是把这层"Store 特有的 Worker 集成"抽出来的包。它**不实现**任何消息协议本身——协议、超时、取消、来源校验全部来自 `@migaia/web-rpc`，这个包只负责把 web-rpc 的通用能力，接到 Store 生态两个具体场景上：

- **通用计算卸载**：`WorkerAdapter` + `workerComputed()`，把一次 `Resource` 请求变成一次 Worker RPC 调用。
- **序列化编解码卸载**：`workerPlugin()`，把 `@migaia/serialize` 的 encode/decode 接入 Worker，按 `ISerializePlugin` 形状注册进现有的序列化注册表。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| Resource 的取数/计算逻辑很重，会卡主线程 | 用 `workerComputed()` 把 `Resource` 的 fetcher 换成 Worker 调用，取消/去重/缓存照常工作 |
| 需要把某种序列化格式的编解码放进 Worker 跑 | 用 `workerPlugin()` 接入 `@migaia/serialize` 的插件注册表，业务代码零感知 |
| 落盘/传输前需要对纯字节做编解码 | bytes 进、bytes 出，走零拷贝 transfer，是唯一真正划算的形态（见下方"注意事项"里的实测数字） |
| 需要一个不依赖具体协议细节的 Worker 请求/响应模型 | `createWorkerHandler()` 在 Worker 侧几行代码接好协议，主线程侧 `WorkerAdapter.request()` 像调本地异步函数一样调用 |

不适合的场景：计算量小、同步就能算完的派生逻辑——引入 Worker 通信本身有序列化和消息往返的固定成本，小任务过 Worker 反而更慢；对象图（非纯字节）走 Worker 编解码同样不划算，实测比主线程直接做还慢，见 USEGUIDE。

## 3. 用了之后能得到什么

- **像调本地函数一样调用 Worker**：`WorkerAdapter.request<Input, Output>(payload)` 返回 `Promise<Output>`，超时/取消/来源校验这些细节都交给底层的 `@migaia/web-rpc`。
- **和 `Resource` 无缝集成**：`workerComputed()` 返回的就是一个标准 `Resource<Output>`，`ttl`、`retry`、`staleWhileRevalidate`、`keepAlive` 这些 `@migaia/resource` 的能力照常可用，只是 fetcher 换成了 Worker 调用。
- **序列化编解码可插拔进 Worker**：`workerPlugin()` 产出的是标准 `ISerializePlugin`，和 `@migaia/serialize` 其他插件（如内置 JSON 插件）用同一套注册表机制，业务代码不需要知道某个格式是在主线程还是 Worker 里编解码的。
- **托管的 Worker 端生命周期**：`createWorkerHandler()`/`createSerializeWorkerHandler()` 返回的 `ManagedRpcHandler` 统一提供 `close()`/`dispose()`/`pendingCount`/`disposed`，不用在 Worker 那端自己管理端点生命周期。
- **字节转移的所有权语义显式化**：`ownership: 'transfer'` 是显式选择，默认 `'copy'`——避免"调用方以为数据还能用，实际底层 buffer 已经被 detach"这类隐蔽 bug。

## 4. 五分钟上手

### 4.1 通用计算卸载（`WorkerAdapter` + `workerComputed`）

```ts
// worker.ts —— 跑在 Worker 里
import { createWorkerHandler } from '@migaia/store-worker';

declare const self: DedicatedWorkerGlobalScope;

const handler = createWorkerHandler<number[], number>(
  (values) => values.reduce((sum, value) => sum + value, 0),
  (message) => self.postMessage(message)
);
self.onmessage = (event) => {
  void handler(event.data);
};
```

```ts
// main.ts —— 主线程
import { WorkerAdapter, workerComputed } from '@migaia/store-worker';
import { Signal, defaultRuntime } from '@migaia/reactive';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const adapter = new WorkerAdapter(worker);

const values = new Signal([1, 2, 3], defaultRuntime);
const sum = workerComputed(adapter, () => values.value);

console.log(await sum.refetch()); // 6

sum.dispose();
adapter.dispose();
```

### 4.2 序列化编解码卸载（`workerPlugin`）

```ts
// serialize.worker.ts —— 跑在 Worker 里，装一个真正干活的 parser
// （字节进、字节出的形态才划算，见下方"注意事项"）
import { createSerializeWorkerHandler } from '@migaia/store-worker/serialize/worker';
import type { ISerializeParser } from '@migaia/serialize';

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
import { workerPlugin } from '@migaia/store-worker/serialize/worker';
import { createSerializeRegistry } from '@migaia/serialize';

const worker = new Worker(new URL('./serialize.worker.ts', import.meta.url), { type: 'module' });
const registry = createSerializeRegistry([workerPlugin({ worker })]);

const chunk = await registry.encode(largeBytePayload);
```

看懂这两个例子，你就理解了这个包的核心心智模型：**Worker 那端用 `createWorkerHandler`/`createSerializeWorkerHandler` 把一个普通函数/parser 包成 `ManagedRpcHandler`，手动接上 `self.onmessage`/`postMessage`；主线程那端用 `WorkerAdapter`/`workerPlugin` 把 Worker 包成"看起来是本地对象"的接口**——中间的协议细节全部交给 `@migaia/web-rpc`。

## 5. 核心概念一览

| 概念 | 是什么 | 类比 |
| --- | --- | --- |
| **`WorkerAdapter`** | 主线程侧持有的 Worker 句柄，`request()` 发起一次 RPC 调用 | 一个和 Worker 通信的客户端实例 |
| **`ManagedRpcHandler`** | Worker 侧的消息处理函数，兼具 `dispose`/`pendingCount` 等生命周期字段 | 一个自带生命周期管理的 `onmessage` 回调 |
| **`workerComputed`** | 把 `WorkerAdapter.request()` 接进 `@migaia/resource` 的 `Resource` | 一个 fetcher 在 Worker 里跑的 `Resource` |
| **`workerPlugin`** | 把 Worker 编解码接成 `@migaia/serialize` 的标准插件 | 一个"跑在 Worker 里"的 serialize 插件 |
| **`IByteOwnership`** | 字节数据过 Worker 边界时是复制还是零拷贝转移 | 函数参数是"传值"还是"传所有权" |

## 6. 模块一览

| 模块 | 导入路径 | 提供什么 |
| --- | --- | --- |
| 通用 Worker 适配 | `@migaia/store-worker` | `WorkerAdapter`、`createWorkerHandler`、`workerComputed`、`ManagedRpcHandler` |
| 序列化 Worker 集成 | `@migaia/store-worker/serialize/worker` | `workerPlugin`、`workerParser`、`createSerializeWorkerHandler` |

## 7. 安装

```bash
pnpm add @migaia/store-worker
```

依赖 `@migaia/reactive`、`@migaia/resource`、`@migaia/serialize`、`@migaia/web-rpc`（均为 workspace 依赖，随包一起装好）。

## 8. 注意事项（最容易踩的坑）

1. **Worker 侧的 `ManagedRpcHandler` 不会自动挂 `onmessage`**——`createWorkerHandler`/`createSerializeWorkerHandler` 返回的是一个需要你手动喂消息的函数，必须自己写 `self.onmessage = (e) => handler(e.data)`。
2. **序列化编解码只有"纯字节进、纯字节出"才划算**：实测下（100 万条记录、71.5MB），bytes 直通只让主线程阻塞 1.4ms（比主线程直接跑省约 46 倍）；一旦请求/结果里带的是对象图，走一趟 Worker（结构化克隆）反而比主线程直接算还慢一倍。不要用它给"解析出对象图"这种操作提速。
3. **`ownership: 'transfer'` 是破坏性的**：转移后底层 `ArrayBuffer` 会被 detach，指向它的其它视图全部失效；只有在数据独占、转移后调用方确认不再用时才该选它，默认 `'copy'` 更安全。
4. **只有覆盖整个 buffer 的字节视图才能真正被 transfer**——`subarray()` 出来的局部视图会被自动回退为复制，不会报错也不会警告。
5. **主线程与 Worker 端的失败一律走 Promise reject**，不会有消息静默丢失——超时、连接断开、协议错误都会让对应的挂起 `Promise` 明确失败。

## 9. 深入参考

`WorkerAdapter`/`ManagedRpcHandler` 完整字段与生命周期语义、`workerComputed`/`IWorkerComputedOptions` 完整配置、`workerPlugin`/`IWorkerPluginOptions` 全部选项、字节转移的判定细节、错误处理与常见问题排查，见 **[USEGUIDE.md](./USEGUIDE.md)**。
