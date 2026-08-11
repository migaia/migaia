# SDD：web-rpc endpoint middleware 重构

## 1. 目标与约束

`@migaia/web-rpc` 重构为 Browser、Node、Bun、Deno、Worker 和小程序等运行时可通过 adapter 使用的双向 endpoint 通信库。

- 对外只暴露 endpoint 与 middleware；不暴露任何生命周期实现类型。
- factory 管理 middleware 生命周期与配置；请求、peer、provider、Pending task 不进入 middleware pipeline。
- endpoint id 必须由调用方创建时提供；不自动生成身份。
- 不保留 `RpcClient`、`createRpcServer`、v1 wire protocol 或任何兼容层。
- core 不直接依赖 Node、Bun、Deno、DOM 专属库；环境能力由 adapter 或注入实现提供。
- middleware 安装串行；不引入并发 mutation queue、状态机或 tombstone 概念。

依赖方向：

```text
adapter → web-rpc endpoint → plugin-host
application → web-rpc endpoint
```

`plugin-host` 不依赖 `web-rpc`，也不承担每个请求的处理链路。

## 2. 目标目录与架构边界

```text
packages/web-rpc/
├── package.json
├── README.md
├── USEGUIDE.md
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.core.json
├── tsconfig.node-adapter.json
└── src/
    ├── index.ts                         # 唯一根公共 export
    ├── typing.ts                        # 全部公共 type 与 endpoint API
    ├── errors.ts                        # 全部公共错误类、code 与 type guard
    ├── transport.ts                     # 公共、runtime-neutral 的 adapter 边界
    ├── factory.ts                       # createEndpoint
    ├── endpoint.ts                      # 私有统一双向 endpoint runtime
    ├── wire.ts                          # 私有 contract、variation、envelope 验证
    ├── middleware/
    │   ├── index.ts                     # 公共 middleware builder export
    │   ├── uuid.ts                      # uuid() 与默认安全随机数策略
    │   ├── contract.ts                  # contract() 配置与出入站 contract 校验
    │   ├── protocol.ts                  # protocol() codec、scheme、可选 crypto
    │   ├── connect.ts                   # connect() peer 注册、verify、重连
    │   ├── chunk.ts                     # chunk() 切片、重组、ack、重连重发
    │   ├── ping.ts                      # ping() / pong 与可选心跳
    │   ├── abort.ts                     # abort() variation 与 provider signal
    │   ├── timeout.ts                   # timeout() Promise.race 与 serial retry
    │   └── hooks.ts                     # hooks() 纯观测与失败隔离
    ├── internal/
    │   ├── runtime.ts                   # 私有 middleware runtime capability 与固定链路编排
    │   ├── pending.ts                   # Pending task Map、清理与迟到 response 处理
    │   ├── peers.ts                     # connect 共享 peer 注册表与 target 快照
    │   └── provider.ts                  # provider/on 路由、IProviderResult、ctx 创建
    └── adapters/
        ├── memory.ts                    # runtime-neutral in-process test transport
        ├── window.ts                    # Window / iframe postMessage
        ├── message-port.ts              # MessagePort
        ├── web-worker.ts                # Dedicated Worker
        ├── shared-worker.ts             # Shared Worker
        ├── service-worker.ts            # Service Worker
        ├── broadcast-channel.ts         # BroadcastChannel
        ├── rtc-data-channel.ts          # RTCDataChannel
        └── web-transport.ts             # WebTransport
```

### 2.1 各层所有权

| 路径                   | 负责                                                          | 不负责                                                |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `typing.ts`            | 公开 factory、endpoint、provider、middleware 配置类型         | 私有 wire frame、PluginHost core、native adapter 细节 |
| `errors.ts`            | 全局错误构造、分类与 type guard                               | 报文解析、日志、副作用处理                            |
| `transport.ts`         | adapter 所需的最小 send/subscribe/close/peer 元数据契约       | contract、重试、provider 路由                         |
| `factory.ts`           | 参数验证、内建 middleware 安装、async factory 生命周期        | 请求处理与 peer 状态细节                              |
| `endpoint.ts`          | request/response/dispatch、provider/on、Pending task、dispose | adapter 平台 API、middleware 配置解析                 |
| `wire.ts`              | contract/variation/envelope 的纯数据构造和验证                | transport I/O、timer、Map 生命周期                    |
| `middleware/*`         | 各自单一能力及其 config                                       | 其他 middleware 的私有状态                            |
| `internal/runtime.ts`  | endpoint 与 middleware 的私有协作接口、固定收发顺序           | public API export                                     |
| `internal/pending.ts`  | taskId 到 Promise/timer/listener 的一致清理                   | retry 策略、provider 执行                             |
| `internal/peers.ts`    | peer 注册与 target 快照                                       | Window/Worker 原生对象创建                            |
| `internal/provider.ts` | method/event 映射、精简 ctx、执行结果                         | contract/protocol 校验                                |
| `adapters/*`           | 平台对象或测试 channel 转换为 `transport.ts` 契约             | endpoint、contract、middleware 逻辑                   |

### 2.2 强制依赖方向

```text
adapters/* ───────────────┐
                           ▼
transport.ts ──► endpoint.ts ◄── middleware/*
                           │          │
                           ▼          ▼
                     internal/*     wire.ts
                           │          │
                           └────┬─────┘
                                ▼
                            errors.ts

factory.ts ─► endpoint.ts + middleware/* + internal/runtime.ts
index.ts   ─► public modules only
```

约束：

- `wire.ts`、`internal/*`、`endpoint.ts` 不得 import `Window`、`Worker`、`MessagePort`、Node/Bun/Deno 模块或具体 adapter。
- `middleware/*` 不得彼此读取私有 Map；跨 middleware 协作只能通过 `internal/runtime.ts` 明确声明的能力。
- `adapters/*` 不得 import `endpoint.ts`、`factory.ts` 或任一 middleware；adapter 只能实现 `transport.ts`。
- `typing.ts` 只能引用 public 错误/transport 类型，不能泄漏 `internal/*`、`wire.ts` 或生命周期实现类型。
- `index.ts` 不导出 `internal/*`、`wire.ts`、`endpoint.ts` 或 PluginHost 实现。
- `factory.ts` 是 middleware 生命周期的唯一 owner；其余模块仅面对 `internal/runtime.ts`。

### 2.3 测试文件落位

测试与被测模块同目录，不建第二套测试架构：

```text
src/
├── endpoint.test.ts
├── factory.test.ts
├── wire.test.ts
├── middleware/
│   ├── contract.test.ts
│   ├── protocol.test.ts
│   ├── connect.test.ts
│   ├── chunk.test.ts
│   ├── ping.test.ts
│   ├── abort.test.ts
│   ├── timeout.test.ts
│   ├── hooks.test.ts
│   ├── uuid.test.ts
│   ├── feature.test.ts
│   └── middleware.test.ts
├── adapters/
│   ├── memory.test.ts
│   ├── window.test.ts
│   └── ...
└── architecture.test.ts
```

`architecture.test.ts` 除现有逆向依赖检查外，还必须检查本节列出的 import 禁令与 `index.ts` public export 边界。

## 3. 公共创建 API

```ts
const endpoint = await createEndpoint({
  id: 'dashboard',
  provider: {},
  middlewares: [connect(/* ... */)]
});

const endpoint = await createEndpoint({
  id: 'editor',
  provider: {
    'editor.save': async (ctx) => ctx.success(await save(ctx.data))
  },
  middlewares: [connect(/* ... */)]
});
```

每个 endpoint 同时扮演 client、server 与分布式 DNS 三种角色：调用其他 target 时是 client；注册 target、执行 provider 时是 server；广播查询、响应解析并维护 `targetId → receiverIds[]` 缓存时是 DNS/resolver。三者是同一 endpoint 在不同操作中的职责，不是固定部署角色。

```ts
type IWebRpcEndpoint<TTargetId extends string = string> = {
  provide(method: string, provider: IWebRpcProvider): IWebRpcEndpoint<TTargetId>;
  on(event: string, listener: IWebRpcEventListener): () => void;

  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>;
  sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<IWebRpcFanoutResult<string, T>>;

  dispatch(targetId: TTargetId, method: string, data: unknown): void;
  dispatchAll(method: string, data: unknown): void;

  /** 仅安装 ping() 后存在。 */
  ping?(targetId: TTargetId): Promise<boolean>;
  pingAll?(): Promise<IWebRpcFanoutResult<string, boolean>>;

  /** 仅安装 hooks() 后存在。 */
  readonly hooks?: {
    on(listener: IWebRpcHook): () => void;
  };

  /** connect 注册、解析、固定 receiver 与调试 metadata 管理面。 */
  readonly discovery: IWebRpcDiscoveryDebug<TTargetId>;

  dispose(): Promise<void>;
};

type IWebRpcServerMetadata<TTargetId extends string = string> = {
  readonly targetId: TTargetId;
  readonly receiverId: string;
  readonly uniqueTargetId?: string;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;
  readonly registeredAt: number;
  readonly lastSeenAt: number;
  readonly pinned: boolean;
  readonly status: 'active' | 'stale' | 'unregistered';
};

type IWebRpcDiscoveryDebug<TTargetId extends string = string> = {
  /** 返回按 targetId、receiverId 排序的只读调试快照。 */
  getServerList(targetId?: TTargetId): readonly IWebRpcServerMetadata<TTargetId>[];

  /** 强制一个逻辑 target 只投递给指定的已解析 receiver。 */
  pinReceiver(targetId: TTargetId, receiverId: string): void;

  /** 解除固定，恢复使用该 target 当前解析出的全部 receiver。 */
  unpinReceiver(targetId: TTargetId): void;
};
```

默认 automatic discovery 不公开 `resolve/register/unregister` 命令；`send/dispatch/ping` 首次访问未知 target 时由系统自动查询并缓存。`discovery` 只提供调试快照与 receiver pin，不让业务代码管理注册时序。

启用 `discoveryMode: 'manual'` 时，connect middleware 才安装独立的 `endpoint.connect` 控制面；其中 `connect.query/register/unregister` 管理惰性注册链路，`connect.ping` 执行一次 ping/pong。automatic 与 manual 是互斥策略，manual API 不出现在默认 endpoint 上。

```ts
type IWebRpcDiscoveryCandidate<TTargetId extends string = string> = {
  readonly targetId: TTargetId;
  readonly receiverId?: string;
  readonly data: unknown;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;
};

type IWebRpcInboundDiscoveryQuery<TTargetId extends string = string> = {
  readonly targetId: TTargetId;
  readonly data: unknown;
  readonly platform: IWebRpcPlatform;
  readonly origin?: string;

  /** 对该 verified query 进行一次幂等受理；不得脱离 handle 跨 session 调用。 */
  accept(data?: unknown): Promise<boolean>;

  /** 对该 verified query 进行一次幂等拒绝；不得创建 binding。 */
  reject(reason?: string): Promise<boolean>;
};

type IWebRpcManualConnect<TTargetId extends string = string> = {
  /** 广播一次查询并返回本次窗口内收集到的候选；不自动写 DNS。 */
  query(
    targetId: TTargetId,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }
  ): Promise<readonly IWebRpcDiscoveryCandidate<TTargetId>[]>;

  /** 观察发给当前 endpoint.id 的查询，由用户决定受理或拒绝。 */
  onQuery(
    listener: (query: IWebRpcInboundDiscoveryQuery<TTargetId>) => void | Promise<void>
  ): () => void;

  /** 把已验证候选提交到当前 endpoint 的 remote-only DNS。 */
  register(candidate: IWebRpcDiscoveryCandidate<TTargetId>): void;

  /** 删除本地 binding；只有具备 authenticated binding 时才通知对端。 */
  unregister(targetId: TTargetId, receiverId?: string): Promise<void>;

  /** 对 verified query 产生的 candidate 做一次 ping/pong，不写 DNS、不改变持久 pin。 */
  ping(
    candidate: IWebRpcDiscoveryCandidate<TTargetId>,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }
  ): Promise<boolean>;
};
```

manual 完整链路固定为 `query → onQuery(handle.accept/handle.reject) → ping(candidate)? → register(candidate) → unregister`。`query()` 只收集候选，只有显式 `register()` 才写 DNS。inbound query handle 与 outbound candidate 都是框架生成的 opaque capability，内部绑定 verified source、queryId 与 session；调用方复制普通对象、复用过期 handle 或跨 endpoint 传递 candidate 都必须失败。`accept/reject` 第一次 settlement 返回 `true`，重复或迟到调用返回 `false`，不得因远端可控 queryId 碰撞选择错误 owner。

`unregister()` 的最低保证是删除当前 endpoint 自己的 remote-only DNS binding。只有 transport 能证明原 verified binding 且协议携带对应 authenticated credential 时，才向该 server 逻辑单播解绑通知；匿名 BroadcastChannel 不具备该能力，绝不发送可修改远端 ownership 的注销命令。

`pinReceiver()` 的 pin 表示持久路由选择，不执行 ping/pong，也不创建 binding。只想在注册前做一次 ping/pong 检测时使用 `connect.ping(candidate)`；它只接受同 endpoint 的 verified manual candidate，不写 DNS、不改变持久 pin。因此不增加会把“固定路由”和“一次探测”混在一起的 `pinReceiverOnce()`。

`TTargetId` 由 factory 的 `targetIds` readonly 数组推断并保留字面量类型。`targetIds` 只提供初始 remote DNS/fan-out 查询集合，不注册 local alias，也不允许 endpoint 受理不同于自身 `id` 的 target。

### 3.1 Factory 参数、前置条件与返回值

```ts
type IWebRpcFactoryConfig<TTargetId extends string = string> = {
  /** 必填。该 endpoint 在本通信拓扑中的稳定逻辑身份。 */
  id: string;

  /** 可选。初始已知 remote target 集合；内部去重，且必须 omit 当前 id。 */
  targetIds?: readonly TTargetId[];

  /** 可选。初始化期 provider 路由表；等价于逐个调用 provide()。 */
  provider?: Record<string, IWebRpcProvider>;

  /** 必填。connect 必装；其他 middleware 按需求安装。 */
  middlewares: readonly IWebRpcMiddleware[];
};

declare function createEndpoint<TTargetId extends string>(
  config: IWebRpcFactoryConfig<TTargetId>
): Promise<IWebRpcEndpoint<TTargetId>>;
```

| 字段/API           | 必填                     | 返回                       | 规则                                                                        |
| ------------------ | ------------------------ | -------------------------- | --------------------------------------------------------------------------- |
| `id`               | 是                       | -                          | 非空字符串，稳定且由应用负责唯一性                                          |
| `targetIds`        | 否                       | -                          | readonly remote target hints；规范化、去重并 omit `id`，不创建 target alias |
| `provider`         | 否                       | -                          | own enumerable 的 method/provider 映射；与重复 `provide()` 同样拒绝         |
| `middlewares`      | 是（其中必须含 connect） | -                          | 仅暴露 middleware 描述符，不暴露 PluginHost plugin                          |
| `createEndpoint()` | 是                       | `Promise<IWebRpcEndpoint>` | 安装完成后才 resolve；endpoint 同时支持入站与出站请求                       |
| `dispose()`        | 是                       | `Promise<void>`            | 停止新工作、清理 peer/pending/timer/订阅并 dispose middleware               |

factory 不接受 `clientId`、`serverId` 或自动随机身份。旧 client/server 的概念只保留在应用部署角色中，协议身份统一称为 endpoint id、senderId、targetId。

### 3.2 send、sendAll、dispatch、dispatchAll

| API                                         | 参数                                                   | 返回值                                          | 语义                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `send<T>(targetId, method, data, options?)` | target id、非空 method、任意 data、可选 signal/timeout | `Promise<T>`                                    | 向一个目标发 request，等待 response                                                                            |
| `sendAll<T>(method, data, options?)`        | 非空 method、任意 data、可选 signal/timeout            | `Promise<IWebRpcFanoutResult<string, T>>`       | 向全部已知 remote target 的当前 receiver 快照广播；独立 receiver 按 receiverId、匿名广播组按 targetId 返回结果 |
| `dispatch(targetId, method, data)`          | target id、非空 event、任意 data                       | `void`                                          | 向一个目标发单向事件                                                                                           |
| `dispatchAll(method, data)`                 | 非空 event、任意 data                                  | `void`                                          | 对已知 target 快照逐个发单向事件                                                                               |
| `ping(targetId)`                            | target id                                              | `Promise<boolean>`                              | 仅 ping middleware；探测一个已知 peer                                                                          |
| `pingAll()`                                 | 无                                                     | `Promise<IWebRpcFanoutResult<string, boolean>>` | 仅 ping middleware；独立 receiver 按 receiverId、匿名广播组按 targetId 保留部分成功结果                        |
| `hooks.on(listener)`                        | listener                                               | disposer                                        | 仅 hooks middleware；注册语义化观察器                                                                          |

`send()` 以调用开始时指定 `targetId` 解析出的 receiver 快照为准；`sendAll()` 与 `pingAll()` 以调用开始时全部已知 remote target 的 receiver 快照为准，必须 omit 当前 endpoint，不存在 target-first 或优先本地 receiver 分支。重连、注册或移除不会改变该次投递集合。`send()` 由第一条合法 response 结算：成功 response resolve，失败 response reject，后续 response 只观测且不改变结果。`sendAll()` 对可独立定位的 receiver 以 receiverId 为 key；匿名广播组以 targetId 为单一逻辑 key并由第一条合法 response 结算。

### 3.3 endpoint 内部所有权

| 状态/能力                           | 所有者                                                    | 不属于                       |
| ----------------------------------- | --------------------------------------------------------- | ---------------------------- |
| middleware 安装、配置、资源 dispose | factory + `internal/runtime.ts` capability registry       | endpoint 请求链路            |
| `Map<taskId, Pending>`              | `internal/pending.ts` registry owned by endpoint runtime  | contract、timeout plugin     |
| peer 注册与 source/origin 绑定      | connect                                                   | protocol、adapter 外部调用方 |
| provider 与 event listener 映射     | `internal/provider.ts` registry owned by endpoint runtime | PluginHost extension         |
| encoded payload 的重组/ack 缓存     | chunk                                                     | endpoint Pending Map         |
| provider AbortController            | endpoint runtime / abort                                  | timeout timer                |

## 4. 消费端 API

### 4.1 Provider

```ts
type IWebRpcContext = {
  readonly data: unknown;
  readonly signal: AbortSignal;
  success(data?: unknown): IProviderResult;
  failed(message: string, code: string): IProviderResult;
  dispatchTo(input: { id?: string; method: string; data: unknown }): void;
};

type IWebRpcProvider = (ctx: IWebRpcContext) => IProviderResult | Promise<IProviderResult>;
```

- `provide()` 的 method 必须为非空精确字符串；同名注册报 `PROVIDER_DUPLICATED`，不覆盖。
- provider 必须返回 `ctx.success()` 或 `ctx.failed()`；非 dispatch 请求无返回值时回应 `PROVIDER_NOT_SETTLED`。
- provider 抛错或 reject 时回应 `INTERNAL`。
- `dispatchTo({ id, method, data })` 的 id 缺省时，向除当前 endpoint 与本次 sender 外的全部已知 endpoint 广播。

### 4.2 事件消费

```ts
type IWebRpcEventListener = (ctx: IWebRpcContext) => void | Promise<void>;

endpoint.on('notification.show', ({ data }) => showToast(data));
```

- `dispatch(targetId, event, data)` 是事件发射端；不新增 `emit()`。
- 仅处理 `dispatchOnly: true` 的 request；普通 `send()` 请求不会进入 `on()`。
- event 仅精确匹配；同名 listener 按注册顺序全部执行。
- 命中 event listener 时不再执行同名 provider；未命中时才回退 provider。
- dispatch 场景的 `success()` / `failed()` 为无效调用，不产生 response；保留它们与 `signal`、`dispatchTo()` 以保持消费 ctx 统一。

### 4.3 处理生命周期与上下文失效

```text
接收已验证 request
  → 创建 provider AbortController 与 IWebRpcContext
  → dispatchOnly 且命中 on：执行 listener
  → 否则解析 provider 并执行
  → 非 dispatch：将 IProviderResult 变成 response
  → 结束：删除活跃 task 与 controller
```

| 情况                               | 非 dispatch request                           | dispatchOnly request                 |
| ---------------------------------- | --------------------------------------------- | ------------------------------------ |
| `return ctx.success(data)`         | 回传 `ok: true` response                      | 无效调用，不回传                     |
| `return ctx.failed(message, code)` | 回传 `ok: false` response                     | 无效调用，不回传                     |
| handler resolve `undefined`        | `PROVIDER_NOT_SETTLED`                        | 合法结束                             |
| handler throw/reject               | `INTERNAL` response                           | hooks 记录，静默结束                 |
| abort signal 触发                  | 终止结果回传；迟到结果丢弃                    | 终止 listener/provider；迟到结果丢弃 |
| `ctx.*` 在任务结束后调用           | 不发送，触发 `PROVIDER_CONTEXT_EXPIRED` hooks | 不发送，触发同一 hooks               |

`IWebRpcContext` 不暴露 task id、sender id、target id、method 或时间；这些都属于内部路由信息。`dispatchTo()` 已封装“排除自己与当前 sender”的目标计算，消费代码不需要了解来源身份。

### 4.4 Provider 与 event 监听器的错误边界

- 同一 event 的 listener 按注册顺序启动；listener 的异步结束不阻塞 dispatch 主链路。
- listener/provider 的异常从不越过 adapter 的消息回调边界。
- 非 dispatch provider 的异常仅会转换成该 request 的 `INTERNAL` response；不会结束 endpoint。
- 事件 listener 没有 response 通道，异常仅产生 `provider.failed`/`failure` hooks。
- `on()` 返回的 disposer 幂等；只移除该次注册，不影响同名其他 listener。

## 5. Contract

正常业务报文只有 `request` 和 `response`。

```ts
type IWebRpcRequest = {
  readonly type: 'request';
  readonly version: string;
  readonly taskId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly method: string;
  readonly data: unknown;
  readonly dispatchOnly: boolean;
  readonly sentAt: number;
};

type IWebRpcResponse = {
  readonly type: 'response';
  readonly version: string;
  readonly taskId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly method: string;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly code?: string;
  readonly message?: string;
  readonly sentAt: number;
};
```

- response 回显 request 的 `taskId` 与 `method`，并反转 sender/target。
- 失败 response 必须含大写 `code` 和 `message`；`data` 的类型为 `unknown`。
- contract 不包含 `retryable`、认证声明、cancel 类型或握手类型。
- 版本缺省为 `'1.0'`；`contract(config)` 可配置接受版本与 identifier 上限。

### 5.1 Contract 配置与校验

```ts
type IContractConfig = {
  /** 当前发出报文的版本。default: '1.0' */
  version?: string;
  /** 可接收版本。default: [version] */
  acceptVersions?: readonly string[];
  /** senderId、targetId、taskId、method 的最大长度。default: 128 */
  maxIdentifierLength?: number;
};
```

| 校验点  | request                                | response                                          |
| ------- | -------------------------------------- | ------------------------------------------------- |
| `type`  | 必须为 `'request'`                     | 必须为 `'response'`                               |
| version | 在 `acceptVersions` 中                 | 在 `acceptVersions` 中                            |
| 标识    | task/sender/target/method 非空且不超限 | task/sender/target/method 非空且不超限            |
| 方向    | sender 与 target 不能相同              | 必须与原 request 方向相反                         |
| 关联    | 新 taskId                              | 必须命中当前 Pending Map，且 method 一致          |
| 成功    | `ok: true`，`data` 可为任意 unknown    | 同左                                              |
| 失败    | 不适用                                 | `ok: false`，必须有全大写 `code` 与非空 `message` |
| 时间    | `sentAt` 为安全 Unix 毫秒数            | 同左                                              |

未知字段允许存在并被忽略，以支持前向扩展；已知字段的类型不合法即视为非法报文。

### 5.2 Data Schema

`schema` 只负责校验 contract 内业务 `data`，不负责校验 contract envelope。Envelope 的 `type`、`version`、标识字段、方向和 request/response 关联，仍由 `contract` 自身校验。

schema 按 method 定义 request data 与 response data 的运行时校验规则：

```ts
type IDataSchema<T> = {
  parse(value: unknown): T;
};

type IMethodSchema = {
  params: IDataSchema<unknown>;
  result: IDataSchema<unknown>;
};

type IContractSchemaConfig = {
  methods: Readonly<Record<string, IMethodSchema>>;
};
```

- request 入站后、provider 执行前，以 method 查找 `params` schema 并校验 `data`。
- provider 成功返回后、response 发出前，以 method 查找 `result` schema 并校验 `data`。
- response 入站后、resolve 当前 pending task 前，再次以 method 查找 `result` schema 并校验 `data`。
- schema 缺失时，默认保持 `unknown` 语义，不因未配置业务 schema 拒绝合法 contract 报文。
- schema 校验失败不得进入 provider，也不得把未验证的 data 交给调用方；失败转换为统一的 validation error，并沿用 contract 的 response error 格式。
- schema 不参与 `cancel`、`ping`、`chunk` 等不承载业务 data 的 variation。

`schema` 是 `contract` 的可选配置，不是独立的 wire protocol 层：

```ts
contract({
  schemas: {
    'user.get': {
      params: userParamsSchema,
      result: userResultSchema
    }
  }
});
```

核心包只依赖最小的 `parse(value)` adapter，不直接依赖 Zod、TypeBox 或其他具体 schema 库。各 schema 库通过 adapter 接入；adapter 负责把库自身的校验错误转换为 web-rpc 的 validation error。schema 校验只保证运行时 data contract，不替代序列化、传输安全限制或权限认证。

### 5.3 Schema Validation Error

schema 校验失败使用独立的 `SCHEMA_INVALID` 错误，不复用 `CONTRACT_INVALID`、`PAYLOAD_INVALID` 或 `INTERNAL`。这样调用方可以区分“报文 envelope 非法”和“业务 data 不符合 method schema”。

```ts
type ISchemaValidationErrorData = {
  readonly kind: 'schema-validation';
  readonly method: string;
  readonly side: 'params' | 'result';
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
    readonly code?: string;
  }[];
};
```

- `code` 固定为 `SCHEMA_INVALID`。
- `method` 标识发生校验的 RPC method。
- `side` 区分 request params 与 response result。
- `issues` 使用 schema adapter 的稳定、中立格式；`path`、`message` 和可选 `code` 不绑定 Zod 或 TypeBox 的错误对象结构。
- 发送方发现本地 params 校验失败时，不发送 request，直接 reject 本地调用并触发 schema error hook。
- 接收方发现入站 params 校验失败时，不执行 provider，返回 `SCHEMA_INVALID` response。
- 任一侧发现 result 校验失败时，不把未验证 data 交给调用方；远端错误通过 `SCHEMA_INVALID` response 表达，本地 adapter 原始错误只进入 hooks/diagnostics。
- 原始 ZodError、TypeCheckError 等具体错误对象不得直接进入 wire payload，避免引入库耦合、不可序列化字段或敏感内部信息。

### 5.4 标准错误码

| code                           | 产生位置                                             |
| ------------------------------ | ---------------------------------------------------- |
| `PROTOCOL_INVALID`             | protocol 解码或 envelope 非法                        |
| `CONTRACT_VERSION_UNSUPPORTED` | version 不被接受                                     |
| `CONTRACT_INVALID`             | contract 字段、方向或关联不合法                      |
| `SCHEMA_INVALID`               | method 的 params/result 不满足 schema                |
| `AUTHENTICATION_FAILED`        | authentication 验签、解签、加密或解密 transform 失败 |
| `PAYLOAD_INVALID`              | codec 输入不满足其 payload 规则                      |
| `PAYLOAD_TOO_LARGE`            | chunk/codec 触发数据上限                             |
| `METHOD_NOT_FOUND`             | 无同名 provider 或 event listener                    |
| `TARGET_UNKNOWN`               | target 或 receiver 未解析、失活或不属于当前 binding  |
| `TARGET_NOT_IDENTIFIABLE`      | 操作要求独立 receiver，但目标是匿名广播组            |
| `UNAUTHENTICATED`              | connect 验证后能安全确认来源但身份不通过             |
| `FORBIDDEN`                    | provider 明确拒绝                                    |
| `CANCELLED`                    | 本地 abort 结束 send                                 |
| `DEADLINE_EXCEEDED`            | timeout 结束 send                                    |
| `OVERLOADED`                   | 实现配置的本地容量限制拒绝工作                       |
| `UNAVAILABLE`                  | transport/peer 当前不可用                            |
| `INTERNAL`                     | provider 未处理异常                                  |
| `PROVIDER_NOT_SETTLED`         | 非 dispatch provider 没有返回结果                    |

错误码是报文/错误对象的事实描述，不承诺可重试性。是否 retry 完全由 `timeout.retry` 的本地配置决定。

### 5.5 全局错误类型

所有 web-rpc 对外失败都使用同一个基础错误类型；不依赖 `DOMException`，避免不同 Browser、Node、Bun、Deno 的错误形态不一致。

```ts
export const WebRpcErrorCode = {
  middlewareDuplicated: 'MIDDLEWARE_DUPLICATED',
  middlewareMissing: 'MIDDLEWARE_MISSING',
  endpointDisposed: 'ENDPOINT_DISPOSED',
  providerDuplicated: 'PROVIDER_DUPLICATED',
  uuidUnavailable: 'UUID_UNAVAILABLE',
  uuidInvalid: 'UUID_INVALID',
  uuidConflict: 'UUID_CONFLICT',
  protocolInvalid: 'PROTOCOL_INVALID',
  protocolUnsupported: 'PROTOCOL_UNSUPPORTED',
  protocolDecryptFailed: 'PROTOCOL_DECRYPT_FAILED',
  contractInvalid: 'CONTRACT_INVALID',
  contractVersionUnsupported: 'CONTRACT_VERSION_UNSUPPORTED',
  schemaInvalid: 'SCHEMA_INVALID',
  authenticationFailed: 'AUTHENTICATION_FAILED',
  payloadInvalid: 'PAYLOAD_INVALID',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  methodNotFound: 'METHOD_NOT_FOUND',
  targetUnknown: 'TARGET_UNKNOWN',
  targetNotIdentifiable: 'TARGET_NOT_IDENTIFIABLE',
  unauthenticated: 'UNAUTHENTICATED',
  forbidden: 'FORBIDDEN',
  cancelled: 'CANCELLED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  unavailable: 'UNAVAILABLE',
  overloaded: 'OVERLOADED',
  internal: 'INTERNAL',
  providerNotSettled: 'PROVIDER_NOT_SETTLED',
  providerContextExpired: 'PROVIDER_CONTEXT_EXPIRED',
  chunkInvalid: 'CHUNK_INVALID',
  chunkTooLarge: 'CHUNK_TOO_LARGE',
  chunkCapacityExceeded: 'CHUNK_CAPACITY_EXCEEDED',
  chunkReceiveTimeout: 'CHUNK_RECEIVE_TIMEOUT',
  chunkAckTimeout: 'CHUNK_ACK_TIMEOUT'
} as const;

export type WebRpcErrorCode = (typeof WebRpcErrorCode)[keyof typeof WebRpcErrorCode];

export type IWebRpcErrorData = {
  readonly code: string;
  readonly message: string;
  readonly data?: unknown;
};

export type IWebRpcErrorOptions = IWebRpcErrorData & {
  readonly cause?: unknown;
};

export class WebRpcError extends Error {
  readonly code: string;
  readonly data: unknown | undefined;
  readonly cause: unknown | undefined;
}

/** 调用 factory、middleware、provider 注册时的非法配置或重复注册。 */
export class WebRpcConfigurationError extends WebRpcError {}
/** endpoint 已 dispose 或生命周期前置条件不满足。 */
export class WebRpcLifecycleError extends WebRpcError {}
/** codec encode/decode 失败，或 payload 不符合 codec 的输入要求。 */
export class WebRpcSerializationError extends WebRpcError {}
/** scheme 不支持或 protocol envelope 非法。 */
export class WebRpcProtocolError extends WebRpcError {}
/** 通过 protocol 后，contract 字段、版本或关联关系不合法。 */
export class WebRpcContractError extends WebRpcError {}
/** contract 内 method data 不符合 params/result schema。 */
export class WebRpcSchemaValidationError extends WebRpcError {
  readonly data: ISchemaValidationErrorData;
}
/** authentication 的逐 frame transform 或输出类型失败。 */
export class WebRpcAuthenticationError extends WebRpcError {}
/** adapter 无法投递、peer 不可用或 transport 已关闭。 */
export class WebRpcTransportError extends WebRpcError {}
/** 分片格式、缓存容量、重组或 ack 出错。 */
export class WebRpcChunkError extends WebRpcError {}
/** 已通过 contract 接收的远端失败 response。 */
export class WebRpcRemoteError extends WebRpcError {}
/** 调用方 AbortSignal 取消本地 send。 */
export class WebRpcAbortError extends WebRpcError {}
/** 本地 send deadline 到期。 */
export class WebRpcTimeoutError extends WebRpcError {}

export function isWebRpcError(error: unknown): error is WebRpcError;
export function getWebRpcErrorCode(error: unknown): string | undefined;
```

| 错误来源                               | 对外错误类型                   | `name`                        | `code`                                          |
| -------------------------------------- | ------------------------------ | ----------------------------- | ----------------------------------------------- |
| factory/API/config/provider 注册校验   | `WebRpcConfigurationError`     | `WebRpcConfigurationError`    | `MIDDLEWARE_*`、`PROVIDER_DUPLICATED`、`UUID_*` |
| dispose 后调用 API                     | `WebRpcLifecycleError`         | `WebRpcLifecycleError`        | `ENDPOINT_DISPOSED`                             |
| codec encode/decode 或 payload 失败    | `WebRpcSerializationError`     | `WebRpcSerializationError`    | `PAYLOAD_INVALID`、`PAYLOAD_TOO_LARGE`          |
| scheme/envelope/crypto 失败            | `WebRpcProtocolError`          | `WebRpcProtocolError`         | `PROTOCOL_*`                                    |
| version/contract/response 关联失败     | `WebRpcContractError`          | `WebRpcContractError`         | `CONTRACT_*`                                    |
| contract data schema 校验失败          | `WebRpcSchemaValidationError`  | `WebRpcSchemaValidationError` | `SCHEMA_INVALID`                                |
| authentication 逐 frame transform 失败 | `WebRpcAuthenticationError`    | `WebRpcAuthenticationError`   | `AUTHENTICATION_FAILED`                         |
| adapter/peer 投递失败                  | `WebRpcTransportError`         | `WebRpcTransportError`        | `UNAVAILABLE`                                   |
| chunk 格式、上限、超时、ack 失败       | `WebRpcChunkError`             | `WebRpcChunkError`            | `CHUNK_*`                                       |
| 远端 `ok: false` response              | `WebRpcRemoteError`            | `WebRpcRemoteError`           | response 的 code                                |
| 调用方 AbortSignal                     | `WebRpcAbortError`             | `AbortError`                  | `CANCELLED`                                     |
| 本地 deadline                          | `WebRpcTimeoutError`           | `TimeoutError`                | `DEADLINE_EXCEEDED`                             |
| provider 未处理异常                    | 调用方收到 `WebRpcRemoteError` | `WebRpcRemoteError`           | `INTERNAL`                                      |

`code` 允许远端 provider 使用满足全大写格式的自定义值；`WebRpcErrorCode` 只是库内稳定标准集合。`message` 用于人类诊断，`data` 为可选结构化错误数据。`cause` 仅存在于本地错误，不进入 contract，不参与 JSON 序列化。

retry 示例和实现一律通过 `getWebRpcErrorCode(error)` 判断错误类别，不能依赖浏览器/运行时差异化的 `instanceof DOMException`。

## 6. ID 与报文变种

```ts
taskId: `TASK:${senderId}:${generatedId}`;
messageId: `MESSAGE:${senderId}:${generatedId}`;
variationId: `VARIATION:${senderId}:${generatedId}`;
```

`uuid()` 负责生成 `generatedId`：优先 `crypto.randomUUID()`，其次 `crypto.getRandomValues()`；都不可用时创建失败 `UUID_UNAVAILABLE`。调用方可通过同步 `generate(context)` 注入实现；不允许 `Math.random()` 降级。

```ts
type IUuidContext = {
  readonly variation: 'task' | 'message' | 'variation';
  readonly senderId: string;
  readonly targetId?: string;
};

type IUuidConfig = {
  generate?: (context: IUuidContext) => string;
};
```

- generator 必须同步返回非空字符串；空值报 `UUID_INVALID`。
- 新 taskId 与当前 Pending Map 冲突时立即报 `UUID_CONFLICT`，绝不覆盖既有 Promise。
- 随机 ID 只用于关联，不承担身份认证、权限或签名职责。
- taskId 属于 contract；messageId 属于 chunk；variationId 属于 ping、abort、chunk-ack 等逻辑变种。

除正常 contract 外，内部使用 variation 报文：

```ts
type IPingVariation = {
  readonly variation: 'ping' | 'pong';
  readonly variationId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly sentAt: number;
};

type IAbortVariation = {
  readonly variation: 'abort';
  readonly variationId: string;
  readonly taskId: string;
  readonly senderId: string;
  readonly targetId: string;
  readonly sentAt: number;
};

type IChunkAckVariation = {
  readonly variation: 'chunk-ack';
  readonly variationId: string;
  readonly messageId: string;
  readonly senderId: string;
  readonly targetId: string;
};
```

不引入 `control` 类别、`controlId` 或 `type: 'control'`。

### 6.1 variation 路由边界

| variation       | 产生者        | 接收者 | 业务可见性                                         |
| --------------- | ------------- | ------ | -------------------------------------------------- |
| `ping` / `pong` | ping          | ping   | 不进入 contract/provider/hooks 的业务 request 事件 |
| `abort`         | abort/timeout | abort  | 不进入 provider；匹配活跃 task 后仅触发 signal     |
| `chunk`         | chunk         | chunk  | 物理帧，不进入 protocol decode 前的业务链路        |
| `chunk-ack`     | chunk         | chunk  | protocol 可序列化的逻辑确认，不进入 provider       |

所有 variation 的 senderId、targetId 都要经过 connect 基础绑定。ping/pong 故意绕开 serialization 与 encryption，原因是它们只用于探测已绑定的信道，不承载 data、token 或 contract 内容。

## 7. Middleware

### 7.1 必装默认项

| middleware                                             | 策略                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| `uuid()`                                               | 内建必装；可被 `uuid(config)` 覆盖默认生成器 |
| `contract()`                                           | 内建必装；默认版本 `'1.0'`                   |
| `protocol()`                                           | 内建必装；默认 JSON、无加密                  |
| `connect()`                                            | 必须由调用方显式提供                         |
| `chunk()`、`ping()`、`abort()`、`timeout()`、`hooks()` | 可选                                         |

用户 middleware 的数组顺序不改变底层传输顺序。重复 singleton middleware 创建失败 `MIDDLEWARE_DUPLICATED`。

### 7.2 Connect

connect 负责 adapter 建连、peer 注册、基础身份绑定与重连。

```ts
type IWebRpcConnectConfig = {
  /** 必填。当前 endpoint 使用的 browser transport adapter。 */
  transport: IWebRpcTransport;
  useBaseIdVerifyOnly?: boolean; // default true
  /** 当前 endpoint 的应用级唯一 target 后缀，或初始化期执行一次的生成器。 */
  uniqueTargetId?:
    | string
    | ((
        context: Readonly<{
          endpointId: string;
          platform: IWebRpcPlatform;
        }>
      ) => string | Promise<string>);
  discoveryMode?: 'automatic' | 'manual'; // default automatic
  identifier?: (context: IConnectVerifyContext) => boolean | Promise<boolean>;
  /** 单目标操作的动态路由策略；不参与 endpoint identity 生成。 */
  receiverSelector?: (
    serverList: readonly IWebRpcServerMetadata[],
    context: Readonly<{
      endpointId: string;
      targetId: string;
      operation: 'send' | 'dispatch' | 'ping';
    }>
  ) => string | undefined | Promise<string | undefined>;
  triggerTiming?: 'register' | 'message'; // default 'register'
  onVerified?: (context: IConnectVerifyContext) => void;
  onRejected?: (context: IConnectVerifyContext, reason: unknown) => void;
  reconnect?: IReconnectConfig;
};

type IConnectVerifyContext = {
  readonly senderId: string;
  readonly targetId: string;
  /** 本次惰性 connect 查询携带的未验证 payload。 */
  readonly data: unknown;
  readonly peer: {
    readonly id: string;
    readonly origin?: string;
  };
};
```

`data` 是 connect middleware 生成的控制面 payload，不是 provider request data。配置 `uniqueTargetId` 时，connect 将最终快照作为 `data.__unique_id__` 放入当前 endpoint 发出的 query/response/unregister 控制消息；对端自定义 identifier 从同一 canonical payload 读取并验证。

`uniqueTargetId` 只有在 `useBaseIdVerifyOnly: false` 且已配置 `identifier` 时才进入解析；缺少任一前提时 connect 不调用生成器，直接忽略该配置项，不报错、不传递 `data.__unique_id__`，并按 BroadcastChannel 广播组处理。

字符串值与生成器返回值都必须是满足 identifier 长度上限的非空字符串。非法返回值按无 `uniqueTargetId` 处理并降级为广播组；生成器抛错或 rejected promise 表示初始化失败，`createEndpoint()` 必须 reject，不能静默降级。生成器只在 endpoint 初始化期间调用一次，其 resolved value 被 snapshot 并在 endpoint 整个生命周期内保持稳定；query、response、ping、retry 和 reconnect 都不得重新执行。endpoint dispose 后重新创建实例时允许生成新值。

`createEndpoint()` 本身是异步 factory，因此可以等待异步生成器；在生成器 settle、结果校验和 middleware 安装完成前，不得向调用方暴露可发送或接收入站业务消息的 endpoint。直接同步构造运行时对象属于内部实现，不得绕过该初始化 barrier。

生成器上下文使用 `endpointId`，不使用 `clientId`：每个 endpoint 同时承担 client、server 与 DNS 职责，不存在固定 client 角色。上下文不提供 `serverList`，因为首次 discovery 建立 server list 时已经需要稳定的 `uniqueTargetId`，把二者绑定会形成 `uniqueTargetId → serverList → discovery → uniqueTargetId` 循环依赖。

根据远端 server list 选择 receiver 是 routing policy，不是 identity policy。`receiverSelector` 输入 immutable、remote-only server-list snapshot，以及 `endpointId`、`targetId` 和 operation；返回 active receiverId 时，本次单目标操作只投递给该 receiver，返回 `undefined` 时沿用未 pin 的默认投递语义。selector 返回未知、stale、其他 target 或匿名广播组伪 receiver 时抛 `TARGET_UNKNOWN`/`TARGET_NOT_IDENTIFIABLE`。

持久 `pinReceiver()` 优先于 selector：存在 active pin 时不调用 selector；pin 丢失时按 pinned-receiver-lost 契约失败，也不回退 selector。`sendAll/dispatchAll/pingAll` 是全量 fan-out，必须忽略 selector；selector 只影响 `send/dispatch/ping`。异步 selector 每次操作最多调用一次，调用发生在 discovery 完成后、receiver snapshot commit 前；timeout/abort/dispose 必须覆盖等待过程。selector 不得修改 DNS、pin 或 `uniqueTargetId`。

验证分支必须使用严格的显式关闭语义；`undefined` 与 `true` 都进入基础身份验证，且不得调用 `identifier`：

```ts
if (verify.useBaseIdVerifyOnly !== false) {
  return baseIdentityCheck(context);
}

if (!verify.identifier) {
  throw new WebRpcConfigurationError('identifier is required when useBaseIdVerifyOnly is false');
}

return baseIdentityCheck(context) && (await verify.identifier(context));
```

`useBaseIdVerifyOnly` 本身就是首次联系的验证策略，不再增加同义的 `bootstrapPolicy`。基础身份验证由 connect/adapter 建立并检查逻辑 `senderId/targetId` 与真实 `peerId/origin/source` 的绑定；它不是无条件放行。

BroadcastChannel 是明确例外：只有 adapter 确认平台不提供可稳定区分 sender 实例的物理指纹时，base check 才退化为 envelope 结构、`targetId === endpoint.id` 与 transport 隔离边界检查，并把 target 作为匿名广播组；此模式不提供实例认证。框架不得伪造随机/counter identity，也不得把 senderId 当物理证明。需要实例级验证时，用户必须显式设置 `useBaseIdVerifyOnly: false`，提供 identifier，并验证 `data.__unique_id__` 及应用自己的认证材料。

```ts
type IReconnectConfig = {
  initialDelayMs?: number; // default 250
  maxDelayMs?: number; // default 10_000
  maxAttempts?: number; // omitted = unlimited
  delay?: (context: {
    attempt: number;
    reason: unknown;
    previousDelayMs?: number;
  }) => number | false | null | Promise<number | false | null>;
};
```

浏览器 transport identity 仅以 `platform` 区分，不引入 `kind` 或非 Web runtime 维度：

```ts
type IWebRpcPlatform =
  | 'Worker'
  | 'Iframe'
  | 'BroadcastChannel'
  | 'MessagePort'
  | 'Memory'
  | 'WebTransport'
  | 'RTCDataChannel';

type IWebRpcTransportIdentity = {
  readonly platform: IWebRpcPlatform;
};
```

- `peer.id` 缺省使用创建 endpoint 的 id；Window adapter 的 `receiver` 默认读取当前 window，`targetOrigin` 默认读取当前 `window.location.origin`。跨 origin iframe 必须显式提供 `targetOrigin`，不能依赖默认值。
- Window adapter 是固定 peer transport：outbound `target` 与 inbound `receiver` 分离，`event.source` 必须等于该 transport 的 target，origin 必须匹配配置。多个 Window peer 使用多个 transport 实例，不在单个 adapter 内维护可变 `senderId -> source` map。
- 基础校验始终覆盖 senderId、targetId、origin 与 source 注册关系。
- `useBaseIdVerifyOnly !== false`（默认）时仅执行基础身份验证；即使提供了 `identifier` 也必须忽略。
- 只有显式设置 `useBaseIdVerifyOnly: false` 时才启用自定义验证；此时 `identifier` 必填，并在基础身份验证成功后执行。identifier 的 timeout/retry 由用户自行实现。
- `triggerTiming: 'register'` 仅首次连接和重连时校验；`'message'` 仅用于确需逐报文动态校验的场景。
- `onVerified`、`onRejected` 仅观察 verify 结果；通用审计、日志、上传仍统一走 `hooks()`，不在 verify 内再造事件系统。
- 信道状态仅用 `IDLE | CONNECTING | CONNECTED | CLOSED`；host dispose 是独立终态。
- 无 reconnect 配置时不自动重连；用户可配置初始延迟、最大延迟、次数与自定义 delay 函数。

初始 remote target 只由 factory `targetIds` 提供；connect 不再接受 `serverIds` 或 `eager`。discovery 始终惰性发生，`targetIds` 不代表预连接、注册、alias 或浏览器 origin；origin 始终属于 adapter 的物理投递配置。

#### 7.2.1 注册、校验与投递

```text
Window/iframe 入站 message
  → adapter 取得 event.data / event.origin / event.source
  → connect 读取 senderId、targetId
  → 基础绑定：source + origin + senderId + targetId
  → 必要时 verify.identifier()
  → 写入/刷新 peer 注册表
  → 继续进入 endpoint 接收链路
```

| 场景                                  | connect 行为                                                       |
| ------------------------------------- | ------------------------------------------------------------------ |
| 首次合法注册                          | 记录 peer id、origin、WindowProxy/source 或 adapter peer handle    |
| 同一 senderId 但 source/origin 不匹配 | 拒绝，不覆盖已注册 peer                                            |
| 合法重连                              | 重新校验后替换旧 source/origin 绑定                                |
| `identifier()` 返回 false/抛错        | 不注册，不进入 contract/provider，触发 `peer.rejected`             |
| 普通 request 验证失败                 | 直接丢弃；能安全定位 sender 且非 dispatch 时可回 `UNAUTHENTICATED` |
| `event.source` 缺失                   | adapter 不允许建立 Window 定向注册                                 |

Window/iframe 通过固定 transport target 的 `WindowProxy.postMessage(message, origin)` 回包。安全模式不允许 `'*'`；若产品保留 wildcard，必须通过独立的显式 unsafe opt-in 开启，单独传入普通 `targetOrigin: '*'` 不足以表达安全确认。origin 是可比较的浏览器投递边界，但不是应用身份；应用身份由 senderId、固定 source proof 与 origin 共同构成。

#### 7.2.2 BroadcastChannel 解析、receiver 与重复注册诊断

BroadcastChannel 的 connect 是 endpoint 间对等运行的分布式名称解析：没有中心 client、server 或 DNS 节点。每个 endpoint 的 `id` 同时就是它唯一可受理的逻辑 target，不存在 endpoint id 与额外 target alias 两套命名。解析是惰性的：只有当前 endpoint 首次连接或投递到另一个 target 时才广播 connect 查询；仅 `id === query.targetId` 的 endpoint 可以受理。受理结果随后逻辑单播给查询方，不作为新的全网注册广播。原生 BroadcastChannel 不提供唯一发送者指纹，框架不得用 realm-local counter、随机进程序号或 senderId 猜测实例唯一性。

BroadcastChannel discovery 分为两种明确模式：

- 没有经过自定义 `identifier` 验证的 `__unique_id__` 时，该 target 只能解析为广播组；同 target 的所有 remote endpoint 共同受理，`send` 与 `sendAll` 使用相同的物理广播能力。框架不得为这些 endpoint 伪造可 pin 的实例 receiverId。
- 用户配置非空 `uniqueTargetId`、显式设置 `useBaseIdVerifyOnly: false`，并由自定义 `identifier` 验证对端控制消息中的 `data.__unique_id__` 时，DNS receiver key 为 `${targetId}:${__unique_id__}`，例如 `SERVER:tab-42`。该 key 表示应用声明并验证的逻辑唯一性，不是 BroadcastChannel 提供的物理指纹或不可伪造凭据。

匿名广播组只适用于同源 honest-peer 协作，不构成对恶意同源 realm 的认证边界。任何同源参与者都能观察并复制 senderId、taskId、receiverId 和 `uniqueTargetId`；因此 `uniqueTargetId` 与 identifier 的一次 discovery 判断不能单独防止后续 response/pong/unregister 伪造。若威胁模型包含恶意同源脚本，应用必须显式安装独立、可选的 `authentication` middleware，并在 wire routing、pending settlement 或 registry mutation 之前拒绝认证失败的 frame。protocol 只负责编码，不拥有密钥、签名或加密策略。未安装 authentication 时，测试和文档不得声称可拒绝观察者伪造。

#### 7.2.3 可选 authentication middleware

`authentication` 是 transport frame 与 protocol codec 之间的独立能力，不属于 contract schema，也不进入默认核心。开发者按威胁模型选择是否安装，并提供具体算法、密钥管理与 envelope 表示。库只编排下列 transform：

```ts
type IWebRpcAuthenticationConfig = {
  encrypt?: (value, context) => unknown | Promise<unknown>;
  decrypt?: (value, context) => unknown | Promise<unknown>;
  sign?: (value, context) => unknown | Promise<unknown>;
  verify?: (value, context) => unknown | Promise<unknown>;
  encodedType?: 'any' | 'string' | 'uint8array';
};
```

`encrypt/decrypt` 与 `sign/verify` 必须成对配置；至少配置一对。出站固定执行 `protocol.encode → encrypt → sign → transport.send`，入站固定执行 `verify → decrypt → protocol.decode`。固定“先验签再解密”用于在昂贵或有副作用的解密前拒绝篡改数据；若应用需要 AEAD，可只使用 encrypt/decrypt 对并让 callback 同时完成认证。

保护单位是每个最终 transport frame。启用 chunk 时，原业务 payload 先由 protocol 编码和分块，每个 chunk envelope 再独立 protocol 编码、加密并签名；组装后的业务 payload 不重复验签。variation、discovery、ping、abort、request 与 response 使用同一路径，不允许绕过。

`verify` 返回已解签 payload，签名不合法时抛错；`decrypt` 返回 protocol 可解码 payload。任一 callback 同步 throw 或异步 reject 都映射为独立 `WebRpcAuthenticationError` / `AUTHENTICATION_FAILED`。入站失败只发出 `authentication.rejected` hook，不执行 provider、不结算 pending、不写入 discovery/identity/replay registry，也不向远端回传失败细节。

启用 authentication 时禁止非空 transfer list：transferable 属于消息通道带外能力，当前插件无法证明其内容被签名或加密。需要传输二进制时必须把数据放入 frame payload。插件不提供默认算法、密钥交换、nonce/replay policy 或密钥轮换；这些属于应用或未来独立 crypto suite，文档不得把自定义 callback 自动描述为安全密码实现。

无论使用广播组还是 `__unique_id__`，每个 endpoint 的 DNS projection 都必须 omit 自己；local registration 只进入 server ownership registry。

```text
requester endpoint broadcast connect(targetId)
  → 所有 endpoint 收到
  → 仅 endpoint.id === targetId 的节点按 senderId/origin/data 决定是否受理
  → 每个受理者向 requester 逻辑单播 connect response
  → 无已验证 __unique_id__：requester 记录 targetId → broadcast group
  → 有已验证 __unique_id__：requester 记录 targetId → `${targetId}:${__unique_id__}`
  → 只有 requester 更新 remote-only DNS cache，其他观察者不旁路学习
```

一个 `targetId` 可解析为多个 receiver。BroadcastChannel 下 `send(targetId, ...)` 与 `sendAll` 使用相同广播投递能力：所有已解析 receiver 均可受理。`send()` 由第一条合法 response 结算；第一条是成功则 resolve data，第一条是失败则 reject，后续 response 不改变结果。具备已验证 `uniqueTargetId` 时，`sendAll()` 返回每个独立 receiver 的 fulfilled/rejected；无唯一身份的广播组只占一个 `targetId` key，并由第一条合法 response 结算该组结果，不返回匿名组内逐 endpoint 结果。多 receiver 或广播组都可能重复执行 provider，非幂等操作必须使用业务 idempotency key。

当一次解析得到 `receiverIds.length > 1`，或匿名广播组在同一 discovery window 观察到多条合法受理 response 时，connect 不阻断注册，但必须同时产生默认控制台告警和专用 hook。后者只能证明“观察到多条受理响应”，不能在 transport 无来源指纹时证明它们来自几个唯一 endpoint。告警按 `(targetId, receiverIds snapshot, responseCount)` 去重：同一解析观测只输出一次；集合或计数变化时重新输出。

默认告警文案必须包含发起查询的 endpoint、target 与全部 receiver，并提示可通过 `endpoint.discovery.pinReceiver(targetId, receiverId)` 显式固定已识别 receiver；广播组无法 pin 单个实例，应配置 `uniqueTargetId` 与自定义 identifier，或修正重复 endpoint id。推荐格式：

```text
[web-rpc] endpoint "<requesterId>" resolved target "<targetId>" to multiple receivers: <receiverIds>. send() will settle from the first valid response while every receiver may execute the provider. Call endpoint.discovery.pinReceiver(targetId, receiverId) for an identified receiver, or configure uniqueTargetId and a custom identifier before selecting one BroadcastChannel instance.
```

匿名广播组推荐格式：

```text
[web-rpc] endpoint "<requesterId>" observed <responseCount> accepted responses for anonymous BroadcastChannel target "<targetId>". The transport cannot prove how many unique servers responded. All may execute the provider; configure uniqueTargetId with a custom identifier before pinning or unregistering one instance.
```

专用 hook 为：

```ts
type IWebRpcMultipleReceiversHookEvent = {
  readonly name: 'connect.multiple-receivers';
  readonly at: number;
  readonly localId: string;
  readonly requesterId: string;
  readonly targetId: string;
  readonly receiverIds: readonly string[];
  /** 本轮 discovery window 观察到的合法受理响应数。 */
  readonly responseCount: number;
  /** true 表示 transport 无法把响应归属到唯一 endpoint。 */
  readonly ambiguous: boolean;
};
```

已验证 `uniqueTargetId` 时，`receiverIds` 是可操作的独立 receiver 集合。匿名广播组时，`receiverIds` 只包含逻辑 `targetId`，`responseCount` 仅用于诊断，不能据此 pin/unregister 某个实例。默认 warning 必须在 ambiguous 场景明确建议配置 `uniqueTargetId` 与自定义 identifier，不得把 response 数宣称为可信 server 基数。

hook 与 `console.warn` 都是纯观测面：失败不得阻断 connect、改变 receiver 集合或影响 `send/sendAll` settlement。后续 server 注销或重连改变解析集合时，connect 更新 registry；已创建 pending 继续使用其启动时的 receiver 快照。

`pinReceiver()` 只能选择 `getServerList(targetId)` 中状态为 active 且经过验证、可独立定位的 receiver；未知 receiver 立即抛 `TARGET_UNKNOWN`。匿名 BroadcastChannel 广播组没有实例 receiverId，对其调用 pin 必须抛 `TARGET_NOT_IDENTIFIABLE`，不得创建误导性的组级 pin。固定后，`send/sendAll/dispatch/ping` 对该 target 都只使用 pinned receiver。若 pinned receiver 注销、失活或被新注册替换，不得静默回退到其他 receiver；调用稳定失败并触发 `connect.pinned-receiver-lost` hook，直到用户重新固定或调用 `unpinReceiver()`。

manual `unregister(targetId)` 对匿名广播组只删除当前 endpoint 本地 DNS 中整个组 binding；它不注销、关闭或修改任何远端 endpoint。`unregister(targetId, receiverId)` 只接受经过 identifier 验证的独立 receiverId，匿名广播组不能表达单实例注销。

automatic discovery 的注册与注销都是 binding lifecycle，不是公开的 target registration API。endpoint dispose、binding 失效或 transport close 时，系统只向已建立关系的 requester 逻辑单播 unregister；不得向全网广播主动注册或注销。manual discovery mode 才允许开发者通过完整 capability 显式操作这些关系。

控制消息为：

```ts
type IWebRpcConnectUnregistered = {
  readonly name: 'connect-unregistered';
  readonly targetId: string;
  readonly receiverId: string;
};
```

只有该 binding 的 requester 消费 unregister 并从 DNS 移除 receiver，旁观 endpoint 不更新状态；进行中的 pending 保留启动时快照并按正常 timeout/settlement 结束。BroadcastChannel 的 `__unique_id__` 只提供逻辑定位，不提供认证；若应用要求安全注销，identifier 必须另外验证可用于后续控制消息的凭据。

当前 endpoint 自己持有的 local receiver 只存在于 server ownership registry，用于入站 admission、注销与 dispose，不写入该 endpoint 自己维护的 DNS 结果。DNS cache、`getServerList()`、`pinReceiver()`、多 receiver 诊断和所有出站 fan-out 均只包含其他 endpoint 宣告的 remote receiver；当前 endpoint 不解析、固定或投递给自己。

`getServerList()` 是公开调试 API，不返回 provider、credential、source object、验证 token 或完整业务 metadata，也不返回当前 endpoint 自己持有的 local receiver。每次调用返回新的只读数组和只读 plain record 快照；调用方修改返回值不得影响 connect registry。无参数返回全部 remote target，有参数只返回指定 target；顺序固定为 `targetId`、`receiverId` 升序，便于 console、测试和调试工具稳定比较。

专用 connect hook 还包括：

```ts
type IWebRpcConnectManagementHookEvent =
  | IWebRpcMultipleReceiversHookEvent
  | {
      readonly name: 'connect.server-registered';
      readonly at: number;
      readonly localId: string;
      readonly server: IWebRpcServerMetadata;
    }
  | {
      readonly name: 'connect.server-unregistered';
      readonly at: number;
      readonly localId: string;
      readonly targetId: string;
      readonly receiverId: string;
    }
  | {
      readonly name: 'connect.receiver-pinned';
      readonly at: number;
      readonly localId: string;
      readonly targetId: string;
      readonly receiverId: string;
    }
  | {
      readonly name: 'connect.receiver-unpinned';
      readonly at: number;
      readonly localId: string;
      readonly targetId: string;
    }
  | {
      readonly name: 'connect.pinned-receiver-lost';
      readonly at: number;
      readonly localId: string;
      readonly targetId: string;
      readonly receiverId: string;
    };
```

#### 7.2.3 Adapter 范围

| adapter          | 作用                          | 关键约束                                                                     |
| ---------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| Window / iframe  | 跨 window、tab opener、iframe | 记录 source 与 origin，定向 postMessage                                      |
| MessagePort      | port 对端通信                 | 端口生命周期由 adapter 观测                                                  |
| Dedicated Worker | window/worker 双向通信        | Worker port 为物理 peer                                                      |
| Shared Worker    | 多 client 共用 worker         | senderId 隔离与注册必需                                                      |
| Service Worker   | page/worker 消息              | client/port 生命周期由 adapter 管理                                          |
| BroadcastChannel | 同源广播                      | senderId/targetId 过滤，不把广播当身份                                       |
| Memory           | 测试与同 realm 内存通信       | 行为与 browser transport 使用同一 endpoint/identity 契约，不作为生产安全边界 |
| RTCDataChannel   | P2P data channel              | adapter 负责 channel ready/close                                             |
| WebTransport     | stream/datagram 传输          | adapter 负责连接语义与背压                                                   |

不实现 WebSocket、SSE、localStorage、sendBeacon、history adapter；这些场景已有专用通信库或不满足双向 RPC 语义。

支持 Window/iframe postMessage、MessagePort、Dedicated/Shared/Service Worker、BroadcastChannel、Memory、RTCDataChannel、WebTransport adapter。

### 7.3 Protocol

```ts
type IProtocolPayload = string | Uint8Array;

type IProtocolCodec = {
  encode(message: IWebRpcProtocolMessage): IProtocolPayload;
  decode(payload: IProtocolPayload): IWebRpcProtocolMessage;
};

type IProtocolCrypto = {
  encrypt(payload: IProtocolPayload): IProtocolPayload | Promise<IProtocolPayload>;
  decrypt(payload: IProtocolPayload): IProtocolPayload | Promise<IProtocolPayload>;
};

type IProtocolConfig = {
  scheme?: string; // default 'web-rpc'
  codec?: IProtocolCodec;
  crypto?: IProtocolCrypto;
};
```

protocol 负责 codec、可选加密和 scheme；core 不直接使用 Web Crypto 或 Node crypto。默认 codec 为 JSON，因此默认只支持 JSON 可表达数据。

`scheme` 是逻辑协议标识，而非把业务数据拼为 `custom-web://...` 字符串。需要 URI 文本的专有 transport 由其 adapter 或自定义 codec 决定格式。

```ts
type IProtocolEnvelope = {
  readonly scheme: string;
  readonly payload: IProtocolPayload;
};
```

发送顺序：`codec.encode → encrypt（若允许）→ envelope`；接收顺序：`scheme 校验 → decrypt（若加密）→ codec.decode`。codec 可以实现 MessagePack 等格式；crypto 只接收已编码 payload，不理解 contract 业务字段。

| 报文                   | 序列化 | 加密 | chunk      |
| ---------------------- | ------ | ---- | ---------- |
| contract / `chunk-ack` | 是     | 可选 | 需要时     |
| `abort`                | 是     | 否   | 通常不需要 |
| `ping` / `pong`        | 否     | 否   | 否         |

`scheme` 不匹配、解密或解码失败均丢弃并触发 hooks；不进入 provider。

`encrypt()` 或 `codec.encode()` 发送失败时，`send()` reject、`dispatch()` 仅产生 hooks；`decrypt()` 或 `decode()` 失败不会向未知来源反射错误报文。

### 7.4 Chunk

```ts
type IChunkFrame = {
  readonly variation: 'chunk';
  readonly messageId: string;
  readonly chunkId: string;
  readonly scheme: string;
  readonly index: number;
  readonly total: number;
  readonly payload: Uint8Array;
};
```

```ts
type IChunkConfig = {
  maxChunkBytes?: number; // default 64 * 1024
  maxMessageBytes?: number; // default 4 * 1024 * 1024
  maxPendingMessages?: number; // default 32
  receiveTimeoutMs?: number; // default 30_000
  resumeOnReconnect?: boolean; // default true
};
```

- `chunkId = ${messageId}:${index}`；messageId 不等于 taskId。
- 默认单片上限 64 KiB，单消息上限 4 MiB，同时重组上限 32 条，接收超时 30 秒；均可配置。
- 使用入站重组 Map 与出站待确认 Map；收到完整消息后发送逻辑 `chunk-ack` variation。
- 重连后可重发未 ack 的完整帧集合；接收端按 chunkId 去重。
- 页面刷新/进程重启不做持久化恢复。
- 非法序号、容量或大小超限、超时和 ack 超时只触发 hooks；`send()` 对对应 task reject，`dispatch()` 不回传失败。

#### 7.4.1 分片算法与重连

1. protocol 输出的 envelope 小于 `maxChunkBytes` 时直传，不额外包 chunk frame。
2. 大于上限时，按 UTF-8 bytes 切分；每帧重复 `scheme`、`messageId`、`index`、`total`。
3. 接收端按 `Map<messageId, receivedChunks>` 收集；任何重复 `chunkId` 直接忽略。
4. 全部 index 到齐后合并 bytes，发送逻辑 `chunk-ack` variation，将完整 payload 交回 protocol。
5. 发送端在 `Map<messageId, frames>` 保留未 ack 帧；重连后重发全部未确认帧，接收端去重后补齐。
6. 收到 ack 或超时后立即释放对应 Map 项。

chunk-ack 表示“完整 encoded message 已接收”，不表示 provider 已执行，也不等同于 RPC response。

### 7.5 Ping

```ts
type IPingConfig = {
  intervalMs?: number | false // default false
  timeoutMs?: number // default 5000
}

endpoint.ping(targetId: string): Promise<boolean>
endpoint.pingAll(): Promise<IWebRpcFanoutResult<string, boolean>>
```

- `ping`/`pong` 直接经 connect 基础绑定后发送，不经过 protocol、加密或 chunk。
- 同一 targetId 的并发 ping 复用一个 Promise。
- timeout 或发送失败返回 `false`，并通知 connect 将 peer 标记为失活；是否重连由 connect 决定。

### 7.6 Abort 与 Timeout/Retry

```ts
type ISendOptions = {
  signal?: AbortSignal;
  timeoutMs?: number | false;
};
```

```ts
type ITimeoutConfig = {
  /** default false；false 表示默认永不超时。 */
  defaultTimeoutMs?: number | false;
  retry?: IRetryConfig;
};

type IRetryContext = {
  readonly attempt: number;
  readonly error: unknown;
  readonly targetId: string;
  readonly method: string;
  readonly data: unknown;
};
```

- `abort()` 使 `send(..., { signal })` 可用；发送后取消会本地 reject `AbortError/CANCELLED` 并发出序列化但不加密的 abort variation。
- 接收端按 `senderId + taskId` 找到活跃 provider 并触发其 AbortController；找不到则丢弃并 hooks。
- `timeout()` 以 `Promise.race(response, abort, deadline)` 实现整个 send deadline；deadline 包含懒建连、序列化、发送、远端执行与响应。
- deadline 到期若安装 abort 则通知远端中止；否则仅本地结束。迟到 response 丢弃并 hooks。

```ts
type IRetryConfig = {
  maxAttempts?: number; // extra attempts, default 0
  shouldRetry?: (context: IRetryContext) => boolean | Promise<boolean>;
  delay?: (context: IRetryContext) => number | false | null | Promise<number | false | null>;
};
```

- 未提供 `shouldRetry` 时，在次数未耗尽且 delay 未停止时无条件重试。
- 每次 retry 使用新的 taskId，且严格串行；旧 response 因无 Pending task 而丢弃。
- 业务可根据错误 code 决定是否重试；retry 不进入 contract。
- 重试可能导致不理会 abort 的远端 provider 重复执行，调用方必须自行决定幂等性。

#### 7.6.1 Promise.race 与清理语义

```text
单个 attempt：
  response Promise
  │
  ├─ Promise.race ─→ 成功 response
  ├─ AbortSignal ──→ AbortError / CANCELLED
  └─ timeout timer ─→ TimeoutError / DEADLINE_EXCEEDED

任一分支结束：删除 Pending task、clearTimeout、移除 abort listener。
```

- `timeoutMs <= 0` 不发送 request，立即 `DEADLINE_EXCEEDED`。
- 未安装 `abort()` 时传 `signal` 是配置错误，不允许静默忽略。
- 未安装 `timeout()` 时传 `timeoutMs` 是配置错误，不允许静默忽略。
- retry 在前一 attempt 已完成清理后再开始；没有并行 retry。
- retry 发生前，若安装 abort，则先尽力发送旧 task 的 abort variation；abort 投递失败不覆盖原失败原因。
- 后到 response 找不到 Pending task 时丢弃，并触发 hooks；不重新创建任何 task 记录。
- endpoint dispose 会 reject 全部本地 Pending send，abort 全部活跃 provider，清理 retry delay/timer。

### 7.7 Hooks

```ts
type IHooksConfig = {
  listeners?: IWebRpcHook | readonly IWebRpcHook[]
  onHookError?: (error: unknown, event: IWebRpcHookEvent) => void
}

endpoint.hooks.on(listener: IWebRpcHook): () => void
```

hooks 是纯观测能力：不修改报文、不阻断主链路、不 await listener。监听器失败经 `onHookError` 隔离，且不会递归产生 hook 事件。

事件覆盖 peer 注册/拒绝/失活、request/response/dispatch 收发、provider 开始/成功/失败/中止、variation 收发以及统一 `failure`。事件携带 readonly contract 引用，不做深拷贝或 deep freeze。

```ts
type IWebRpcHookEvent =
  | {
      name: 'peer.registered' | 'peer.rejected' | 'peer.lost';
      at: number;
      localId: string;
      peer: unknown;
      reason?: unknown;
    }
  | IWebRpcConnectManagementHookEvent
  | {
      name: 'request.sent' | 'request.received' | 'response.sent' | 'response.received';
      at: number;
      localId: string;
      contract: IWebRpcContract;
    }
  | {
      name: 'dispatch.sent' | 'dispatch.received';
      at: number;
      localId: string;
      contract: IWebRpcRequest;
    }
  | {
      name: 'provider.started' | 'provider.succeeded' | 'provider.failed' | 'provider.aborted';
      at: number;
      localId: string;
      error?: unknown;
    }
  | {
      name: 'variation.sent' | 'variation.received';
      at: number;
      localId: string;
      variation: unknown;
    }
  | {
      name: 'failure';
      at: number;
      localId: string;
      code: string;
      error: unknown;
      context?: unknown;
    };
```

hooks 的同步 callback 按事件产生顺序调用；Promise 结果仅观察 rejection，不被 await。事件数据以 readonly 类型传递但不 deep clone，监听器不得修改 data/contract 引用；这是性能与审计能力之间明确选择的边界。

## 8. 接收与发送链路

```text
send:
endpoint → contract → protocol → encrypt (optional) → chunk (optional) → transport

abort:
endpoint → protocol serialize → transport

ping/pong:
endpoint → connect binding → transport

receive normal:
transport → connect binding → chunk reassemble → protocol decrypt/decode → contract → on/provider
```

physical `chunk` frame 位于 protocol 之后；它不会进入 contract 或 provider。

## 9. 明确不采用的设计

以下不是“尚未实现”，而是已决定不纳入本设计；实现不得以便利为由重新引入。

| 被拒绝概念                                   | 不采用原因                                                            | 替代归属                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `auth()` middleware                          | C 端通信不需要独立认证层，且会加重 client 成本                        | `connect.verify` 与基础 id/source/origin 绑定                                         |
| 独立 handshake middleware                    | 注册本身已建立 peer 绑定，额外握手没有独立语义                        | connect 注册；ping 只做存活探测                                                       |
| `clientId` / `serverId` 命名                 | 双向通信下角色不是协议身份                                            | `senderId` / `targetId`                                                               |
| `type: 'control'`、`controlId`               | 已有正常 contract 与 variation 两层，第三类无必要                     | `variation` + `variationId`                                                           |
| `redirect()`                                 | 透明代理收益不足、路由与 response 关联复杂                            | 不提供                                                                                |
| 将 request pipeline 交给 capability registry | 会把每次 task 状态与 middleware 生命周期耦合                          | capability registry 只保存 middleware 安装后的运行能力；请求状态仍归 endpoint runtime |
| `MutationTask`、请求状态机                   | middleware 安装串行，endpoint 用 Map 即可                             | PluginHost lifecycle + endpoint Map                                                   |
| 请求 pipeline 交给 PluginHost                | 会混淆 middleware 生命周期与每次 task                                 | endpoint runtime 的固定链路                                                           |
| 自动 `ready()`                               | factory resolve 即表示 middleware 已安装；懒连接由首次 send/ping 触发 | async factory                                                                         |
| `host.use(a).use(b)` 式链式安装              | use 为异步且注册仅在 factory 初始化期发生                             | `middlewares: [...]`                                                                  |
| plugin 内 `core.use()` 套娃                  | 插件拓扑必须由 factory 一次确定                                       | 不向 middleware core 暴露 topology mutation                                           |
| WebSocket / SSE adapter                      | 已有更合适专用库                                                      | 外部 transport/专用库                                                                 |
| retry 标记进入 contract                      | retry 是本地幂等性与策略问题                                          | `timeout.retry`                                                                       |
| `Math.random()` UUID 降级                    | 不能真实保证唯一性                                                    | crypto 能力或注入 generator                                                           |
| raw transport `on(listener)` 广播            | 会暴露加密载荷、chunk 细节与未封装 channel                            | `on(event, ctx)` 只消费匹配 dispatch 事件；`hooks()` 观测语义事件                     |

## 10. 迁移与验证

### 10.1 文件级迁移

| 现有路径                           | 落地动作       | 新职责                                                 |
| ---------------------------------- | -------------- | ------------------------------------------------------ |
| `src/client.ts`                    | 删除           | 不再存在单向 client runtime                            |
| `src/server.ts`                    | 删除           | 不再存在单向 server runtime                            |
| `src/protocol.ts`                  | 删除并重建     | contract、protocol envelope、variation 的独立模块      |
| `src/internal/request-registry.ts` | 重写或替换     | endpoint 的 `Map<taskId, Pending>` 小型工具            |
| `src/internal/id-allocator.ts`     | 删除           | uuid middleware 接管生成策略                           |
| `src/errors.ts`                    | 重写           | 新 code、AbortError、TimeoutError、remote failure 解析 |
| `src/transport.ts`                 | 保留并收敛     | adapter 与 endpoint 的唯一物理传输边界                 |
| 其他 `src/adapters/*`              | 逐个迁移       | connect 所需 peer/source/origin/close 能力             |
| `src/index.ts`                     | 最后一次性切换 | 仅导出新 API、middleware、adapter                      |
| `src/rpc.test.ts`                  | 删除并替换     | endpoint/middleware 行为测试                           |

旧实现不能以 deprecated export、alias、双协议 parser 或平行构造函数的形式遗留。切换 `index.ts` 前，新实现必须已通过测试内 transport double 的完整端到端验收；切换后删除旧文件与旧测试。

### 10.2 分阶段实施

1. **基础类型与边界**：新建 endpoint、contract、variation、错误、middleware descriptor 类型。
2. **最小可用核心**：私有安装 uuid、contract、protocol、connect；实现 provider、on、Pending Map、`send/dispatch`、dispose。
3. **端到端验收**：测试内构造最小 transport double，以两个显式 id 的 endpoint 验证双向 request、response、dispatch、event 和 `dispatchTo`；不创建 production memory adapter。
4. **可靠性 middleware**：实现 abort、timeout/serial retry、ping、hooks，并覆盖清理和迟到报文。
5. **大载荷 middleware**：实现 chunk、ack、资源上限、乱序/重复帧与重连重发。
6. **adapter 迁移**：Window/iframe 优先，其后 MessagePort、Worker、BroadcastChannel、RTCDataChannel、WebTransport。
7. **breaking cutover**：替换 exports、README、USEGUIDE、browser support list；删除 v1 全部实现与测试。

### 10.3 测试矩阵

| 层            | 必测场景                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| factory       | 必填 id/connect、重复 middleware、安装失败回滚、dispose 幂等                                              |
| endpoint      | 双向 send、sendAll target 快照、dispatch、dispatchAll、provider 重复、on 精确匹配与 disposer              |
| contract      | version、方向、response method/task 关联、大写错误码、未知字段、迟到 response                             |
| connect       | 基础 id 绑定、verify register/message、重连替换 peer、Window source/origin 不匹配、无 `*` 回包            |
| uuid          | 默认随机能力、注入 generator、空 ID、Pending 冲突、三种前缀                                               |
| protocol      | JSON、custom codec、scheme 不匹配、abort/ping/pong/chunk-ack 均经过 protocol；不承担加密或签名            |
| abort         | 已取消 signal、执行中取消、远端 signal、未知 task abort、provider 忽略 signal 的迟到结果                  |
| timeout/retry | Promise.race 清理、0 deadline、retry 无条件、按 error 条件、delay 停止、串行 taskId、更晚 response        |
| ping          | 手动、自动心跳、同 target 去重、pong timeout、peer 失活通知                                               |
| hooks         | 所有事件、async rejection 隔离、onHookError 不递归、无 hooks 时不分配监听器                               |
| chunk         | 小包直传、切片、乱序、重复、上限、超时、ack、重连重发、provider 不提前执行                                |
| adapters      | 测试内 transport double 端到端、Window iframe source/origin、MessagePort/Worker/BroadcastChannel 生命周期 |
| architecture  | web-rpc 只向内依赖 plugin-host；plugin-host 不反向依赖；core 无 adapter runtime import                    |

#### 10.3.1 当前工作树对抗审计基线（2026-08-11）

本节以当前 `packages/web-rpc` 源码和测试为准，不以历史 hardening 条目的“已关闭”描述替代实际验收。当前基线为 59 个 Vitest suite、420 个 test 全部通过；V8 coverage 为 statements 87.75%、branches 85.10%、functions 87.76%、lines 89.87%。全局、adapter、wire、internal 与 endpoint owner threshold 均通过，但 coverage 只证明代码路径被执行，不替代真实 realm、攻击模型和资源终态验收。

当前对抗结论：

| ID   | 严重度                  | 当前证据                                                                                                                                                                                                     | 必须关闭的验收缺口                                                                                                                                                                                                                   |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-1  | 已关闭                  | Window adapter 已拆分 outbound `target` 与 inbound `receiver`；真实 same-origin 与跨 origin iframe E2E 证明双向 RPC、source/origin proof、cross-origin forged request/sibling spoof rejection、listener 配对和 dispose observer 归零                                                                                   | 保持双 origin 与 listener ownership 回归，新增 Window 行为必须继续经过真实 fixture                                                                                                                                       |
| A-2  | P1 验证缺口             | ServiceWorker adapter 已拆分 target/receiver；真实双 controlled page ↔ ServiceWorkerGlobalScope E2E 已证明 Client.id 隔离、首次无 controller 时真实 `controllerchange` 发生、双向 RPC、显式 disconnect、page/server observer 归零，以及第二个 client 注入伪造 request 后第一个 client 仍可正常通信；本轮新增页面关闭后新页面重新控制、重连并完成 RPC 的唤醒回归；服务端 `providerCalls` 断言伪造帧没有执行 provider | 保留真实 page/ServiceWorkerGlobalScope 路径，继续补更强的错误 source 终态证据 |
| A-3  | P1 验证缺口             | browser MessagePort adapter 现在默认 `owned`，并提供显式 `{ ownership: 'borrowed' }`；真实 browser MessageChannel transfer E2E 已证明 owned/borrowed close 次数及两端 observer 归零；browser 与原生 `node:worker_threads` adapter 都有 `messageerror` 负例证明诊断错误不进入 `closed` 终态；Node 原生 `MessageChannel` 另已证明双向 endpoint、远端 close terminal、dispose 后两端 observer 归零 | 保持 owned/borrowed 契约；继续补齐 browser 侧可观测 terminal 语义，禁止把 `messageerror` 一律当作 closed                                                                                         |
| A-4  | P1 验证缺口             | Window、SharedWorker、ServiceWorker、DedicatedWorker 已有初版真实 realm smoke test；ServiceWorker 与 SharedWorker 现均有伪造 request 后合法 client 继续工作回归，ServiceWorker 另有 provider 无副作用计数负例；其他 adapter 的来源伪造、终态分类和 server-side 资源回收矩阵仍不完整；`structuredClone({id})` 单测仍不能单独作为跨 realm 证据 | 每个声明支持的 browser adapter 补齐来源伪造、终止和资源清理负例，并以 E2E fixture 的真实 realm 结果为准 |
| A-5  | P1 验证缺口             | Browser BroadcastChannel 现在覆盖多个 Page、identified receiver/pin、anonymous honest-peer group，以及 authenticated forged response；anonymous business response/pong spoof 仍不能被当作安全模式                                                        | 按 A-9/A-24 拆分三个安全模式，不能以非法 discovery unique id 的拒绝替代逐消息攻击测试                                                                                                                                                |
| A-6  | P2                      | RTCDataChannel 已有浏览器 loopback smoke test，现已回传两端 observer 并精确断言 `TRANSPORT` terminal；WebTransport 仍只有结构 fake，真实 HTTP/3 需要 server 与证书环境                                                                                              | RTC 保持 ready/terminal 与 observer 回归；WebTransport 保留完整 Vitest stream contract，并在具备仓库内可重复 server harness 后升级为默认 E2E gate                                                                                            |
| A-7  | 已关闭（初始门禁）      | coverage-v8 已设置全局 85/80/85/85、adapter 80/70/70/80，以及 wire/internal/endpoint owner branch threshold，当前工作树通过 | 保持不下降；owner-specific threshold 已由 A-23 收口 |
| A-8  | P1 验证缺口             | fast-check 已接入 500/2,000 runs；当前覆盖 arbitrary envelope、hostile getter/prototype key wire boundary、bounded discovery、verified remote binding capacity、retry asynchronous decision single-path、policy-side abort race、OperationScope abort/generation stale rejection、UTF-8 chunk permutation、ResourceScope ownership、replay capacity/TTL 不淘汰 fresh tombstone，以及 settlement exactly-once completion race property；endpoint 测试已覆盖 selector-dispose 下 send、dispatch、ping 三入口的 commit guard                                                                                                                                              | 按 10.3.2 继续补齐更完整的 hostile value model、fan-out/terminal transport 竞争矩阵和跨 owner 异步模型，并保留 seed/path                                                                                                                    |
| A-9  | P0 / 设计已定、验证缺口 | 已修复默认 BroadcastChannel 首次 discovery 被基础身份校验误拒的问题；anonymous honest-peer E2E 已证明无 uniqueTargetId 时可完成 group discovery。该模式仍没有不可伪造 source，同源第三方可观察 taskId、senderId 和 wire payload；认证模式的伪造 response 已单独覆盖                                              | 明确拆成 honest-peer anonymous mode 与 authenticated mode；匿名模式不得承诺来源真实性、pin 或防伪 settlement。需要对抗同源参与者时必须配置 authentication，`uniqueTargetId` 只能用于路由；仍需补齐 authenticated forged pong/settlement 与 observer 终态证据 |
| A-10 | P1                      | Window `postMessage` 不提供通用远端关闭通知；移除 iframe 或关闭 popup 后，既有 adapter 也没有 terminal observer；默认 operation timeout 现为 1000ms，且 `timeoutMs:false` 明确保留永久等待语义；USEGUIDE 已说明该边界 | Window operation 默认必须有有限 deadline，或由宿主显式注入 lifecycle signal/closed proof；E2E 不得要求平台无法保证的“移除后立即报错” |
| A-11 | P1                      | DedicatedWorker fixture 现在先显式 dispose worker endpoint、回传 observer 终态，再由宿主 terminate；page 端迟到请求以 `DEADLINE_EXCEEDED` 收敛。ServiceWorker 与 SharedWorker 现已增加 page close → 新 page 控制/重连/通信回归；两者本身仍没有统一的 page close terminal event | 每个 adapter 分别声明 `observable terminal`、`send-detected terminal` 或 `unobservable terminal`；后两类依赖 deadline/ping/宿主 lifecycle，不得套用一个立即关闭契约 |
| A-12 | 已关闭                  | RTCDataChannel adapter 现在只接受 `open` 与已 `closed` 状态；`connecting`/`closing` 在构造期稳定拒绝，已 `closed` 仍可重放 terminal error；真实 open loopback 与 unit terminal cases 已通过                  | 保持 open-only construction 契约；若未来支持 connecting，必须另行设计 construction cancellation/open barrier                                                                                                                         |
| A-13 | P1                      | 已建立不进入 public export 的 `src/internal/test-observer.ts`；Window、authenticated BroadcastChannel、DedicatedWorker、SharedWorker、ServiceWorker、browser MessagePort、RTCDataChannel 真实 fixture 已断言 dispose 后 pending、controller、chunk、resource、discovery 等计数归零 | 将 observer 接入剩余强制 E2E fixture，覆盖 timeout、abort、dispose、terminal 与重复创建销毁；每个 case 都断言可证明的 owner 计数归零                                                                                               |
| A-14 | 已关闭                  | Window target/receiver 已拆分；`targetOrigin: '*'` 现在只有显式 `allowUnsafeTargetOrigin: true` 才能启用，接收侧仍强制固定 `source` proof，不存在 sender→source 可变 map                        | 保持默认拒绝 wildcard，并在文档中明确该 opt-in 只放宽 outbound origin，不放宽 inbound source proof                                                                                                                |
| A-15 | P1 验证缺口             | 初版 `e2e/`、Playwright/Vite config 和 7 个 scenario 已落地；现已补 `realm-lifecycle.spec.ts`，真实 Page 循环创建/销毁 Window realm 3 次并断言 page error、console error 与 observer 资源归零；BroadcastChannel 已有独立 anonymous honest-peer case；仍缺动态端口/失败清理矩阵与 WebTransport optional project | 保持真实双 origin、重复 realm lifecycle 和 anonymous group 回归；WebTransport 在可重复 HTTP/3 harness 前不进入默认 gate                                                                                                                        |
| A-16 | P1                      | 多个 adapter 首次订阅需要连续注册多个底层 listener；RTCDataChannel 现在对 terminal listener 与 message listener 的组合注册做事务化回滚，并有 N−1/N 失败测试；browser MessagePort 的 close 路径现已验证 listener removal 抛错时仍继续关闭 owned port，并聚合 cleanup error；其他 adapter 的完整 N−1/N close 矩阵仍待补齐 | adapter 使用局部 ResourceScope 或等价事务注册；安装失败逆序回滚，释放失败继续其余 cleanup 并聚合错误；每个 N−1/N 失败点有单测                                                                                                        |
| A-17 | P2                      | Node MessagePort 现在保存并向 late `onTransportError` subscriber 重放 `close` terminal；RTC/WebTransport 已有 replay，但 browser MessagePort、Worker family 仍未统一；`messageerror` 又不一定代表 terminal                     | transport contract 明确区分 diagnostic error 与 terminal transition，并规定 late subscriber 是否重放；禁止 adapter 自行把所有 error 事件等价为 closed                                                                                |
| A-18 | 已关闭                  | Playwright 启动 4178/4179 两个真实 Vite origin；`window-iframe.spec.ts` 覆盖 same-origin/cross-origin 双向通信、错误 source/origin request、sibling spoof、listener 配对及 dispose 资源终态                                                         | 保持真实双 origin、错误来源和 listener ownership 回归                                                                                                                                     |
| A-19 | 已关闭                  | MessagePort fixture 以 instrumented wrapper 记录两端真实 `close()` 次数，E2E 断言 `[1, 1]`；不再使用常量成功值                                                                                               | 继续保留 close-count 断言，避免 fixture 脱离 adapter 生命周期                                                                                                                                                                        |
| A-20 | 已关闭                  | SharedWorker 与 ServiceWorker fixture 现在都提供显式 `disconnect` 控制消息；服务端先 `endpoint.dispose()`，再删除对应 port/Client registry，并回传 `disconnected` ack                                        | 保留真实 realm 的 disconnect ack 与另一 client 继续可用断言；平台仍不承诺 page 关闭本身能立即通知 worker process                                                                                                                     |
| A-21 | P1                      | DedicatedWorker 现在精确断言 `DEADLINE_EXCEEDED`，分别验证 worker/page endpoint dispose observer，并把 worker `error`/`messageerror` 传回 runner；SharedWorker 也把 server-side setup error、page error 和 console error 传回 runner 并断言为空；ServiceWorker 现在同样回传 server-side setup error，并监听两页的 page/console error，且保留 server/page observer；RTC 精确断言 `TRANSPORT` 并验证两端 observer，hook 次数和其他 Worker 级别 error 事件仍未形成完整矩阵             | 继续断言精确错误码、hook 次数和 terminal phase；每个 Worker/ServiceWorker/SharedWorker fixture把错误传回 runner，并同时监听 page/context/Worker error                                                                                |
| A-22 | P1                      | fast-check 当前已有 12 个 property，覆盖 arbitrary JSON/envelope、hostile getter/prototype key、chunk permutation、settlement race、verified binding/discovery capacity、replay TTL、retry decision/abort race、OperationScope generation 和 ResourceScope lifecycle；仍不是完整状态机矩阵             | 按 10.3.2 继续补齐 dispatch/ping/dispose event ordering、跨 owner resource lifecycle、identity expiry 和更多 hostile transfer/schema value；property 数量本身不能替代状态机不变量                                                                                                                                                 |
| A-23 | 已关闭                  | coverage config 已设置全局、adapter、`src/wire.ts`、`src/internal/**` 与 `src/endpoint.ts` 的 branch threshold；本轮实测 wire 164/170 (96.47%)、internal 568/664 (85.54%)、endpoint 950/1117 (85.05%) 均已达 85%，完整 `coverage-final.json` 供 owner 审计 | 保持 owner threshold 不下降；任一 threshold failure 都重新打开该条目 |
| A-24 | P1                      | BroadcastChannel authenticated E2E 现在同时覆盖观察后伪造 business response 与 forged pong；客户端仍只接受真实服务端结果/存活响应，server provider 调用计数证明攻击场景只执行 1 次合法 provider；client/server dispose 后 observer 也证明 pending/control/discovery/resource 归零        | 继续分开 honest anonymous、identified routing、authenticated protocol 三个 project/case；仍需将 observer 终态扩展到 attacker/server 以外的 adapter，匿名模式明确展示非安全边界                                                                          |

“跨 adapter / 跨 realm 矩阵”不表示对所有 adapter 做笛卡尔积。验收规则是：每个声明支持的 adapter 至少有一条真实平台路径；只有平台实际组合的边界才做跨 adapter 测试，例如 iframe + transferred MessagePort。两个物理协议无法直接互通的组合不得为了凑矩阵而测试。

#### 10.3.2 Vitest、fast-check 与 coverage-v8 验收矩阵

以下测试全部放在 `packages/web-rpc/test/`。Vitest 负责确定性 unit/integration 和 transport double；fast-check 负责输入空间、事件排列与状态机模型；coverage-v8 负责证明关键分支被执行。Node 提供的原生 BroadcastChannel、MessageChannel 或 worker_threads 可以作为 integration 证据，但不能冒充浏览器 realm E2E。

| Owner / 文件建议                                                                                          | Vitest 必测 case                                                                                                                                                                                           | fast-check property / model                                                                                                                           | 完成标准                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| factory/capability：`factory*.test.ts`、`middleware/middleware.test.ts`                                   | middleware 串行安装、重复 capability、非法 codec/listener/schema、任一步失败逆序回滚、construction abort/timeout、owned/borrowed transport                                                                 | 随机 middleware 安装/失败位置，断言成功前缀仅清理一次且严格逆序；任意 capability 发布顺序保持单 owner                                                 | 每个失败点都无 listener/timer/capability 泄漏，原错误和 cleanup failure 均可观察               |
| wire/contract/schema：`wire.test.ts`、`internal/contract.test.ts`、`middleware/contract.test.ts`          | 每种 envelope、未知字段、错误 kind/code、getter/Proxy、schema params/result/event、`WebRpcSchemaValidationError` issues 安全快照                                                                           | 任意 JSON-like 值、危险 key、Unicode、safe/unsafe integer 和字段排列；normalize 成功后重复读取结果不变，失败不产生语义状态                            | canonical snapshot 无 TOCTOU；schema 失败稳定映射独立错误类和错误码；不泄漏 hostile value      |
| identity/discovery：`internal/{identity,discovery-registry,replay}.test.ts`、`endpoint.binding.test.ts`   | 错误 source/origin/peer、同 sender 不同 source、首次 binding 抢答、register/query replay、N−1/N/N+1 capacity、TTL 边界、anonymous/identified receiver、pin/unpin/unregister                                | model command 覆盖 query/accept/reject/pin/unpin/stale/dispose；任意事件序列中未验证主体不能写 DNS/identity/replay owner，容量满只拒绝新 admission    | registry snapshot 与模型一致；认证前长期状态增量为零；settled/expired generation 永不复活      |
| endpoint/pending/provider：`endpoint*.test.ts`、`internal/{pending,provider-executor,settlement}.test.ts` | 双向 request、dispatch/event、重复 request、错误 sender response、迟到 response、provider resolve/reject/abort/dispose 竞争、context expiry、首响应 wins                                                   | model command 排列 request/response/timeout/abort/dispose/transport-failure；每个 task 最多一个 winner，每个 provider 最多执行一次                    | wire side effect、公开 Promise、pending/controller/debug count 三者终态一致且归零              |
| chunk/protocol：`middleware/{chunk,protocol}.test.ts`、`internal/chunk.test.ts`                           | 类型兼容、metadata 篡改、乱序/重复/缺块、UTF-8 边界、per-peer/global budget、timeout、ACK admission、custom split/join 非法输出                                                                            | 随机 payload、split、permutation、duplicate/drop 和 peer/message tuple；成功 join 等于原 payload，失败不保留 assembly/timer，预算永不超限             | N−1/N/N+1 与 hostile metadata 全覆盖；认证或 metadata admission 前不创建 assembler             |
| authentication：`middleware/authentication.test.ts`、`authentication.integration.test.ts`                 | callback 配对与 hostile descriptor、同步/异步失败、encrypt→sign / verify→decrypt 顺序、request/response/variation/discovery/ping/abort、每个 chunk 独立保护、输出类型、transfer 拒绝、认证失败零语义副作用 | 任意 JSON-like payload、签名篡改、frame drop/duplicate/reorder；round-trip 保持 contract data，任一受保护字节变化均不能进入 provider/pending/registry | 未安装时零行为变化；安装时所有最终 frame 同路径；失败稳定映射独立错误类/错误码且无远端细节泄漏 |
| timeout/retry/abort/ping：对应 middleware 与 internal tests                                               | 0/false/NaN/Infinity、同步 throw/异步 reject、policy/delay 永不 settle、attempt 独立 taskId、abort variation 一次、伪造 pong                                                                               | 生成 attempt outcome、deadline、abort/dispose 时刻和 retry decision 序列；公开操作有唯一终态，剩余预算单调不增                                        | 无迟到 send、无残留 timer/listener/pending；不可重试错误永远不能被 policy 覆盖                 |
| lifecycle/resource：`internal/{async-control,operation-scope,resource-scope,listener-safety}.test.ts`     | 第 N 个 listener 注册失败回滚、cleanup throw/reject、并发 dispose、terminal transport、thenable/hook failure、unref                                                                                        | 随机 acquire/release/fail/dispose 命令；资源计数永不为负，每个成功 acquire 最终恰好 release 一次                                                      | dispose 后所有 debug count 为零；重复 dispose 共享同一结果；无 unhandled rejection/exception   |
| adapter contract：`test/adapters/*.test.ts`                                                               | 每个 adapter 的 subscribe/unsubscribe、首/末 listener、send after terminal、error isolation、transfer forwarding、hostile event getter、close ownership、topology/source metadata                          | 对 listener add/remove/send/error/close 序列建模；close 后禁止新工作，listener 集合与底层订阅保持 0↔1                                                 | adapter 单测必须覆盖所有同步和异步 terminal 分支；真实平台行为仍由 10.3.3 证明                 |
| architecture/public types：`architecture.test.ts`、`type-contract.test.ts`                                | exports、依赖方向、core 无 DOM/Node ambient、endpoint mode/capability 类型、禁止旧 API 与 `bind/call/apply`                                                                                                | 不适用                                                                                                                                                | 所有 public adapter 都能由对应 runtime tsconfig 消费；无反向依赖和兼容 facade                  |

fast-check 的可复现门禁：本地默认至少 500 runs，CI 至少 2,000 runs；失败必须输出并保留 `seed`、`path` 和 counterexample。禁止在 CI 固定单一 seed；可额外维护一组历史回归 seed。涉及异步竞争的 property 必须使用虚拟时钟或显式调度器，禁止依赖真实毫秒 sleep 制造竞态。

coverage-v8 的初始硬阈值：全包 statements/lines/functions 不低于 85%，branches 不低于 80%；`src/internal`、`src/endpoint.ts`、`src/wire.ts` 的 branches 不低于 85%；Vitest 可执行的 `src/adapters` statements/lines 不低于 80%、branches 不低于 70%。阈值只允许随覆盖提高而上调。Playwright 覆盖的浏览器专属分支必须有独立 case 清单，不能因为 V8 unit coverage 未采集浏览器执行而删除 E2E。

#### 10.3.3 Playwright 跨 realm E2E 验收矩阵

所有浏览器 E2E 文件放在 `packages/web-rpc/e2e/`；通过根脚本 `pnpm @web-rpc test:e2e` 执行。fixture、worker script、service worker script 和测试页面也归该目录所有。默认项目至少运行 Chromium；若新增浏览器兼容承诺，再把对应 engine 加入 gate。

E2E 实现前置条件：

- harness 必须启动两个不同 origin（不能只用同 origin path 假装 cross-origin），并把端口动态分配结果传给 Playwright；固定端口冲突不得被解释为产品失败。
- 先建立 test-only owner observer，或由 instrumented transport + hook 明确覆盖可证明的资源计数；测试不得读取 ECMAScript `#` 私有字段，也不得为了测试把内部 registry 加入 public API。
- 每个 adapter 必须登记 terminal 可观测等级。只有平台提供可靠事件且 adapter 将其转换为 `closed` 时，才要求立即终止；其余场景用有限 deadline、ping 或宿主 lifecycle signal 验收。
- 匿名 BroadcastChannel fixture 明确属于 honest-peer mode。攻击者模型只在配置 `authentication` middleware 后要求伪造拒绝；没有 authentication 时，E2E 必须证明并记录其非安全边界，而不是伪造一个不可能通过的安全断言。

Adapter terminal 验收分类：

| Adapter               | 可证明的 terminal                                                               | 不得承诺的行为                                         |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Window/iframe         | 宿主提供 lifecycle signal，或一次 send 同步失败                                 | 仅凭 iframe remove、popup close 就必然收到远端关闭事件 |
| BroadcastChannel      | 本地 `close()` 后 send 失败；应用主动 dispose                                   | 发现另一个 realm 已关闭，或从 channel 推断唯一发送者   |
| browser MessagePort   | 本地 owned close；messageerror diagnostic                                       | 自动观测远端 `port.close()` 并立即进入 terminal        |
| Node MessagePort      | 原生 `close` 事件                                                               | 把普通 messageerror 一律视为 terminal                  |
| DedicatedWorker       | error/messageerror diagnostic；宿主在调用 terminate 时同步传入 lifecycle signal | Worker 对象自动发出统一 close 事件                     |
| SharedWorker          | 每个本地 port 的 dispose/messageerror                                           | 最后 client 离开后浏览器立即销毁 worker process        |
| ServiceWorker         | controllerchange、宿主 registration 生命周期、有限 deadline/ping                | 强制或精确观测浏览器休眠/回收 worker process           |
| RTCDataChannel        | `closing`、`close`、明确 terminal error                                         | 在 `connecting` 时把 channel 当作已 ready              |
| WebTransport datagram | readable EOF/read failure、owned close、write rejection                         | 不观察底层 session/stream failure却继续无限等待        |

| E2E 文件建议                | 真实 topology                                                  | 必测 case                                                                                                                                                                                              | 完成标准                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `window-iframe.spec.ts`     | parent Window ↔ same-origin/cross-origin iframe                | 双向 send/provider/event；显式 targetOrigin；错误 origin、错误 `event.source`、同源 sibling iframe spoof；iframe reload/remove 与 deadline/lifecycle signal 竞争                                       | 合法 source 唯一成功；spoof 不创建 peer/pending/provider/chunk；没有 lifecycle proof 时依有限 deadline 收敛，不虚构立即 terminal                |
| `message-port.spec.ts`      | parent ↔ iframe 及 page ↔ Worker，经 transfer 交付 MessagePort | port transfer、双向 RPC、structured-clone/transferable、port close/messageerror、旧 port 消息不能命中新 generation                                                                                     | browser MessagePort 使用公开 adapter，无 cast/mock；close 后双方 pending 收敛且 listener 为零                                                   |
| `dedicated-worker.spec.ts`  | Page ↔ DedicatedWorkerGlobalScope                              | 双向 endpoint、并发 request、transferable、worker throw/messageerror、显式 host lifecycle signal、terminate 与 timeout/dispose 竞争                                                                    | 可观察 error 走 transport failure；不可观察 terminate 由宿主 signal 或有限 deadline 收敛，无悬挂 Promise                                        |
| `shared-worker.spec.ts`     | 两个独立 Page ↔ 同一 SharedWorker                              | client identity 隔离、相同 taskId 不串线、一个 page 关闭不影响另一个、各 port 显式 dispose                                                                                                             | server 对每个 port 独立 binding；跨 client spoof/abort/response 均不能命中；不要求浏览器立即销毁 SharedWorker process                           |
| `service-worker.spec.ts`    | 两个 controlled Page ↔ ServiceWorkerGlobalScope                | install/activate/control 后双向 RPC、Client.id/source proof、两个 client 隔离、page close、controllerchange 和 worker 被重新唤醒后的重连                                                               | 使用真实 `navigator.serviceWorker`/global message target；不得用同时实现 send/listen 的假 client；不依赖强制 ServiceWorker 进程终止             |
| `broadcast-channel.spec.ts` | 两个或三个独立 Page/iframe 同源 realm                          | cold discovery；匿名广播组首合法 response wins；identified receivers 独立 server list/pin/unregister；匿名攻击能力边界；authenticated mode 下第三方伪造 response/unregister；realm 关闭后的 stale 收敛 | 匿名组不承诺来源真实性或实例 identity；`uniqueTargetId` 只改善路由；只有 authenticator 验证通过的模式要求攻击 realm 无 settlement/registry 权限 |
| `rtc-data-channel.spec.ts`  | 浏览器内两个 loopback RTCPeerConnection/DataChannel            | connecting 构造契约、open 后双向 RPC、string policy、closing/close/error、close 与 send/timeout/dispose 竞争                                                                                           | 不依赖外网；ready contract 确定且无竞态；可观察 terminal 后无 pending/read/listener 泄漏                                                        |
| `realm-lifecycle.spec.ts`   | Page + iframe + Worker 组合                                    | dispose/navigation/terminate 与 response、abort、timeout 同帧竞争；重复创建销毁；全局 `unhandledrejection`、`error`、console error 监控                                                                | 每轮终态唯一；重复循环后监听器/endpoint debug count不增长；测试期间零未声明 page/worker error                                                   |
| `web-transport.spec.ts`     | Chromium ↔ 仓库内本地 HTTP/3 harness                           | datagram 双向、EOF/read failure、reader lock、close/resubscribe、背压                                                                                                                                  | 只有具备可重复证书与 server fixture 后进入默认 gate；此前标记为显式 optional project，不得伪造通过                                              |

Playwright case 的统一判定：必须断言业务结果、wire/diagnostic 副作用和可证明的资源终态，不能只断言“收到一条消息”；每个 spoof/timeout/abort/dispose 负例都要证明 provider 未执行，并通过 test observer 或 instrumented transport 证明对应 owner 计数未增长。平台不暴露的远端进程终态不得假装可以直接断言。测试同时监听 `pageerror`、`unhandledrejection`、Worker error 和非预期 console error，任一出现即失败。

E2E 最小强制集合为 Window/iframe、browser MessagePort、DedicatedWorker、SharedWorker、ServiceWorker、BroadcastChannel 和 RTCDataChannel。WebTransport 在本地 HTTP/3 harness 落地前不计入默认 gate，但 adapter 的 stream ownership、EOF、reader lock 与 terminal 行为必须先由 Vitest 全覆盖。不存在“只跑 mock adapter unit test即可声明跨 realm 完成”的验收路径。

#### 10.3.4 第十九轮全 adapter 对抗结果（2026-08-11）

本轮没有发现 P0，因此不触发“推翻协议并重扫全部状态机”的升级条件；但发现一个使公开 adapter 实际不可用的 P1，以及两个测试基础设施缺口。审计覆盖 Window/iframe、browser MessagePort、DedicatedWorker、SharedWorker、ServiceWorker、BroadcastChannel、RTCDataChannel 七条声明路径，并再次扫描 `bind/call/apply` 禁令。当前 package 源码和测试中没有禁用调用。

| ID    | 严重度 | 结论                                                                                                                                                                                                                                                     | 修复与无回归约束                                                                                                                                                                                                                                                       |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R19-1 | P1     | `createSharedWorkerTransport()` 把单个 `SharedWorker.port` 标成 `multiplexed`。port 本身是一个 page 与 SharedWorker 中对应 connection 的点对点链路；错误拓扑使无 `event.source` 的正常业务 request 在 discovery 成功后仍被基础身份校验拒绝，最终 timeout | adapter 改为 `topology: 'exclusive'`，并由两个 Page 连接同一 SharedWorker 的 E2E 证明相同 sender/task 不串线、关闭一个 Page 不影响另一个。禁止通过放宽 `#verifySource()` 修复：真正 multiplexed transport 必须继续要求可证明来源，不能为 SharedWorker 引入全局认证绕过 |
| R19-2 | 已关闭 | 当前受限 Chromium 网络环境把 loopback socket 暴露为不可路由的 RFC 2544 benchmark candidate `198.18.0.1`，使 ICE 长期停在 `checking`                                                                                                                      | fixture 保持两个真实 `RTCPeerConnection`、有序 trickle ICE、DTLS 和真实 DataChannel；仅当 candidate 地址精确等于保留 benchmark 地址时把信令地址映射回 `127.0.0.1`。正常 candidate 不改写，产品 adapter 不含环境分支。完整 RTC RPC/close/terminal E2E 已通过            |
| R19-3 | P2     | scenario fixture 通过动态 import 安装 page-global API，`page.goto()` 可先于 import 完成，产生 `run*Scenario is not a function` 假失败                                                                                                                    | fixture 暴露 `e2eReady`，每个 spec 在调用 scenario 前等待。ready 只表示模块安装完成，不得吞掉 import rejection，也不得替代 endpoint readiness                                                                                                                          |
| R19-4 | P1     | browser MessagePort public adapter 与 Node structural adapter 位于同一模块，却直接引用 `Transferable`、`MessageEvent`、`Event`，使无 DOM ambient 的 `tsconfig.node-adapter.json` 编译失败                                                                | public structural shape 以 `TTransfer` / `TEvent` 泛型和 `safeRead()` 表达，禁止给 Node tsconfig 偷加 DOM lib；Node-only、browser、package build 三个类型边界必须同时通过                                                                                              |
| R19-5 | 已关闭 | `ProviderExecutor.execute()` 现在在 params validation failure、response-send failure、binding retain 失败和 provider 主路径统一释放 admission/binding；容量 1 回归证明非法请求不会耗尽 lease                                                          | 保持 `finally` 释放和 provider 不执行约束；继续保留容量边界回归                                                        |
| R19-6 | 已关闭 | E2E fixture/spec 已纳入 `tsconfig.e2e.json` 与 `typecheck:e2e`，browser global/API 漂移由类型门禁捕获                                                                                                                                             | 保持 E2E 类型门禁与 runtime E2E 双重验证                                                                                                                                                       |

本轮真实浏览器结果：Window/iframe、MessagePort、DedicatedWorker、SharedWorker、ServiceWorker、BroadcastChannel、RTCDataChannel 及 realm-lifecycle 共 13 个 case 全部通过，其中 Window 同时覆盖 4178/4179 两个真实 origin 及 cross-origin forged request；SharedWorker 无需 CDP，Playwright Page API 可以直接覆盖共享 worker 的功能链路。Vitest 为 59 个 suite、402 个 test 全通过；默认 `test` 已启用 coverage-v8，全包 statements 87.59%、branches 85.02%、functions 87.51%、lines 89.44%，adapter 聚合门禁为 statements/lines 80%、branches/functions 70%。ServiceWorker 伪造 request E2E 还断言 provider 调用次数未增加；`src/endpoint.ts` 独立 branch 当前实测为 81.7%，仍未达到 85%，不能用当前全包平均值声明完成。根目录 `pnpm @web-rpc test:e2e` 在允许本地监听的环境中通过 13/13；受限沙箱仅因本地监听权限失败，不属于断言失败。A-1、A-2、A-3 的 API 形状已分别通过 target/receiver 拆分、ServiceWorker target/receiver 拆分和 browser MessagePort public adapter 落地；这些历史条目保留作为审计来源，以本节状态为准。

A-8 已开始由 `test/property.test.ts` 关闭：本地 500 runs、CI 2,000 runs，覆盖 arbitrary JSON wire normalization、hostile getter/prototype key wire boundary、bounded DNS model、verified remote binding capacity、serial retry budget、retry asynchronous decision single-path、policy-side abort race、OperationScope abort/generation stale rejection、UTF-8 chunk permutation/reassembly、ResourceScope ownership/release 序列、replay capacity/TTL 边界下 fresh tombstone 不被淘汰，以及 settlement exactly-once completion race；`endpoint.test.ts` 另覆盖 selector 等待期间 dispose 后不提交 request/provider，并覆盖 dispatch、ping 不产生迟到 commit。A-7 的全包与 adapter hard threshold 已生效；`src/endpoint.ts` 独立 branch hard gate 仍未达到 85%，不能用当前全包平均值声明完成。

后续 feature/fix agent 必须保持以下修复边界：adapter 元数据只描述被包装的当前物理链路，不描述同类 runtime 的全局能力；测试环境能力失败不得通过弱化认证、跳过强制 case 或 fake platform 来“修复”；任何局部修复必须同时验证合法路径、伪造路径、terminal 收敛和资源所有权，不得创造新兼容层或破坏 endpoint/connect 的既有分层。

#### 10.3.5 第二十轮当前代码强对抗结论（2026-08-11）

本轮重新以当前源码、当前测试目录和实际门禁为准，不把 `hardening.sdd.md` 中任何历史“已关闭”或“待迁移”段落直接当作现状。实际结果：format、lint、package/core/Node adapter/test/E2E typecheck、build 全部通过；Vitest 为 59 个 suite、420 个 test 全通过，coverage 为 statements 87.75%、branches 85.10%、functions 87.76%、lines 89.87%，全局、adapter、wire、internal 与 endpoint owner threshold 均通过；Playwright 在允许本地监听后 13/13 通过。沙箱内首次 E2E 失败是 `listen EPERM 127.0.0.1:4178`，不属于产品断言失败。

当前没有协议设计 block，也没有可复现 P0 功能缺陷；但“测试全部通过”不能推出 owner 迁移和所有平台验收已完成：

| ID | 严重度 | 当前证据 | 结论与关闭条件 |
| --- | --- | --- | --- |
| C20-1 | P1 架构缺口 | `DiscoveryRegistry` 已集中 discovery 状态，但内部仍以大量 `Map<unknown, unknown>` 和泛型 cast 暴露弱类型读写；`PendingRegistry.tasks`、`ProviderRegistry.providers/events` 仍是公开可变 Map；`WebRpcRuntime.pingPending/activeControllers` 仍由 endpoint 直接读写和清理；endpoint 还直接拥有 `multipleReceiverSnapshots`、`manualQueryListeners`。现有 architecture test 只禁止 middleware lifecycle 外泄与 endpoint 直接使用 timer，不禁止这些 owner bypass | 架构级 owner 迁移尚未完成。关闭必须让集合私有、由 owner 提供强类型事务与终态方法，并新增 architecture test 禁止 endpoint/runtime consumer 获取可变 Map/Set。该项不阻断当前 RPC 功能使用，但阻断“架构 owner 迁移完成”声明以及继续增加同域状态 |
| C20-2 | P1 验证缺口 | `createWindowMessageTransport()` 新增 `receiver = current window`、`targetOrigin = window.location.origin` 默认值；当前 Window unit/E2E 全部显式传入两者，没有真实 same-origin case 验证省略参数，也没有非 Window realm 的稳定错误断言 | 补浏览器 E2E 证明省略值时读取当前 realm，补 unit/type case 证明非 Window realm 必须显式提供 receiver/targetOrigin；在此之前该 convenience API 不能视为完成验收 |
| C20-3 | P2 E2E 基础设施缺口 | 当前 Playwright 固定监听 4178/4179；端口受限或冲突时整个矩阵在断言前失败。SDD 已要求动态端口和失败清理，但实现尚未满足 | 改为动态分配两个 origin，并把解析结果传给 fixture；启动失败必须释放已启动 server。它不阻断产品运行，但会阻断把 E2E 当作稳定默认 CI gate |
| C20-4 | P2 专项验证缺口 | WebTransport adapter 有完整 fake-stream Vitest，但 `e2e/` 没有 WebTransport case，也没有本地 HTTP/3 server、证书、datagram 双向及真实 EOF/backpressure 证据 | HTTP/3 harness 只阻断 WebTransport 的真实平台支持/GA 声明；按既定范围保持 optional project，不阻断其他 adapter、核心 package 或默认 E2E gate |

三个争议项的 blocker 定义固定如下：

- **平台测试扩展**：13 个当前强制 browser case 已通过，因此不再是核心功能 block；C20-2/C20-3 仍是验证债。若发布标准要求“所有公开默认值均有真实 realm 证据”或“默认 CI 无端口偶发失败”，则它们是该发布标准的验收 block。
- **WebTransport HTTP/3 harness**：不是默认 block，只是 WebTransport 真实支持声明的专项 block。不得因为 fake stream unit test 通过而宣称真实 HTTP/3 已验收。
- **架构级 owner 迁移**：C20-1 证明它当前确实是架构完成度 block。现有 coverage owner threshold 只证明分支被执行，不能证明状态 owner 不可旁路；A-7/A-23 的 coverage 收口不得再被解释为 owner 迁移收口。

因此当前允许的准确声明是：核心 RPC、七类强制 browser topology 与现有门禁通过；WebTransport 真实 HTTP/3、Window 默认参数真实 realm 证据、动态端口 E2E，以及完整状态 owner 封装尚未完成。

### 10.4 构建与文档验收

- `web-rpc` typecheck、core typecheck、各 adapter typecheck、Vitest 与 build 全部通过。
- 新 public exports 必须无旧 `RpcClient`、`createRpcServer`、`RpcSchema`、`RpcWireMessage`。
- README 明确 Browser Support List，且不承诺不存在的 native runtime/polyfill。
- USEGUIDE 按 factory、endpoint、每个 middleware 列出参数类型、必填性、返回值、默认值、失败规则与完整示例。
- architecture test 必须证明依赖方向 `adapter → web-rpc endpoint → plugin-host`，且 core 可在无 DOM/Node ambient 类型配置下通过检查。

### 10.5 主要风险与规避

| 风险                                          | 影响                                 | 落地规避                                               |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| 把 middleware lifecycle 用作 request pipeline | 生命周期与 task 状态耦合，复杂度回升 | factory 生命周期与 endpoint 请求链路分离               |
| retry 重复执行业务操作                        | 非幂等 provider 产生副作用           | retry 显式配置、严格串行、记录风险，不放入 contract    |
| Window 仅凭 origin 回包                       | iframe/窗口身份混淆                  | 注册并校验 senderId + origin + event.source            |
| chunk ack 当成 provider 成功                  | 调用方错误 resolve                   | ack 仅释放 encoded frame 缓存；response 才 settle task |
| hook 阻塞/抛错                                | 通信性能与可靠性下降                 | 不 await、失败隔离、不递归事件                         |
| 旧 API 与新 API 共存                          | 类型/协议/文档双重维护               | 一次性 export cutover，删除旧实现                      |
