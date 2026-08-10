# SDD：web-rpc endpoint middleware 重构

## 1. 目标与约束

`@migai/web-rpc` 重构为 Browser、Node、Bun、Deno、Worker 和小程序等运行时可通过 adapter 使用的双向 endpoint 通信库。

- 对外只暴露 endpoint 与 middleware；不暴露 `PluginHost` 或 plugin 类型。
- 内部使用 `PluginHost` 管理 middleware 生命周期与配置；请求、peer、provider、Pending task 不进入 PluginHost pipeline。
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

| 路径 | 负责 | 不负责 |
| --- | --- | --- |
| `typing.ts` | 公开 factory、endpoint、provider、middleware 配置类型 | 私有 wire frame、PluginHost core、native adapter 细节 |
| `errors.ts` | 全局错误构造、分类与 type guard | 报文解析、日志、副作用处理 |
| `transport.ts` | adapter 所需的最小 send/subscribe/close/peer 元数据契约 | contract、重试、provider 路由 |
| `factory.ts` | 参数验证、内建 middleware 安装、async factory 生命周期 | 请求处理与 peer 状态细节 |
| `endpoint.ts` | request/response/dispatch、provider/on、Pending task、dispose | adapter 平台 API、middleware 配置解析 |
| `wire.ts` | contract/variation/envelope 的纯数据构造和验证 | transport I/O、timer、Map 生命周期 |
| `middleware/*` | 各自单一能力及其 config | 其他 middleware 的私有状态 |
| `internal/runtime.ts` | endpoint 与 middleware 的私有协作接口、固定收发顺序 | public API export |
| `internal/pending.ts` | taskId 到 Promise/timer/listener 的一致清理 | retry 策略、provider 执行 |
| `internal/peers.ts` | peer 注册与 target 快照 | Window/Worker 原生对象创建 |
| `internal/provider.ts` | method/event 映射、精简 ctx、执行结果 | contract/protocol 校验 |
| `adapters/*` | 平台对象转换为 `transport.ts` 契约 | endpoint、contract、middleware 逻辑 |

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

factory.ts ─► endpoint.ts + middleware/* + PluginHost
index.ts   ─► public modules only
```

约束：

- `wire.ts`、`internal/*`、`endpoint.ts` 不得 import `Window`、`Worker`、`MessagePort`、Node/Bun/Deno 模块或具体 adapter。
- `middleware/*` 不得彼此读取私有 Map；跨 middleware 协作只能通过 `internal/runtime.ts` 明确声明的能力。
- `adapters/*` 不得 import `endpoint.ts`、`factory.ts` 或任一 middleware；adapter 只能实现 `transport.ts`。
- `typing.ts` 只能引用 public 错误/transport 类型，不能泄漏 `internal/*`、`wire.ts` 或 `PluginHost` 类型。
- `index.ts` 不导出 `internal/*`、`wire.ts`、`endpoint.ts` 或 PluginHost 实现。
- `factory.ts` 是 `@migai/plugin-host` 的唯一直接使用点；其余模块仅面对 `internal/runtime.ts`，防止 PluginHost 语义扩散。

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
│   └── hooks.test.ts
├── adapters/
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
})

const endpoint = await createEndpoint({
  id: 'editor',
  provider: {
    'editor.save': async (ctx) => ctx.success(await save(ctx.data))
  },
  middlewares: [connect(/* ... */)]
})
```

client 与 server 都是双向 endpoint；差异仅来自 connect adapter 的主动连接或被动接收配置。

```ts
type IWebRpcEndpoint<TTargetId extends string = string> = {
  provide(method: string, provider: IWebRpcProvider): IWebRpcEndpoint<TTargetId>
  on(event: string, listener: IWebRpcEventListener): () => void

  send<T>(
    targetId: TTargetId,
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<T>
  sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<Record<TTargetId, T>>

  dispatch(targetId: TTargetId, method: string, data: unknown): void
  dispatchAll(method: string, data: unknown): void

  /** 仅安装 ping() 后存在。 */
  ping?(targetId: TTargetId): Promise<boolean>
  pingAll?(): Promise<Record<TTargetId, boolean>>

  /** 仅安装 hooks() 后存在。 */
  readonly hooks?: {
    on(listener: IWebRpcHook): () => void
  }

  dispose(): Promise<void>
}
```

`TTargetId` 由 connect 配置的单个或数组 target id 推断，保留字面量类型。

### 3.1 Factory 参数、前置条件与返回值

```ts
type IWebRpcFactoryConfig<TTargetId extends string = string> = {
  /** 必填。该 endpoint 在本通信拓扑中的稳定逻辑身份。 */
  id: string

  /** 可选。初始化期 provider 路由表；等价于逐个调用 provide()。 */
  provider?: Record<string, IWebRpcProvider>

  /** 可选。connect 必填；其他 middleware 按需求安装。 */
  middlewares?: readonly IWebRpcMiddleware[]
}

declare function createEndpoint<TTargetId extends string>(
  config: IWebRpcFactoryConfig<TTargetId>
): Promise<IWebRpcEndpoint<TTargetId>>

```

| 字段/API | 必填 | 返回 | 规则 |
| --- | --- | --- | --- |
| `id` | 是 | - | 非空字符串，稳定且由应用负责唯一性 |
| `provider` | 否 | - | own enumerable 的 method/provider 映射；与重复 `provide()` 同样拒绝 |
| `middlewares` | 是（其中必须含 connect） | - | 仅暴露 middleware 描述符，不暴露 PluginHost plugin |
| `createEndpoint()` | 是 | `Promise<IWebRpcEndpoint>` | 安装完成后才 resolve；endpoint 同时支持入站与出站请求 |
| `dispose()` | 是 | `Promise<void>` | 停止新工作、清理 peer/pending/timer/订阅并 dispose middleware |

factory 不接受 `clientId`、`serverId` 或自动随机身份。旧 client/server 的概念只保留在应用部署角色中，协议身份统一称为 endpoint id、senderId、targetId。

### 3.2 send、sendAll、dispatch、dispatchAll

| API | 参数 | 返回值 | 语义 |
| --- | --- | --- | --- |
| `send<T>(targetId, method, data, options?)` | target id、非空 method、任意 data、可选 signal/timeout | `Promise<T>` | 向一个目标发 request，等待 response |
| `sendAll<T>(method, data, options?)` | 非空 method、任意 data、可选 signal/timeout | `Promise<Record<TTargetId, T>>` | 对已知 target 快照逐个发 request，等待所有 response |
| `dispatch(targetId, method, data)` | target id、非空 event、任意 data | `void` | 向一个目标发单向事件 |
| `dispatchAll(method, data)` | 非空 event、任意 data | `void` | 对已知 target 快照逐个发单向事件 |
| `ping(targetId)` | target id | `Promise<boolean>` | 仅 ping middleware；探测一个已知 peer |
| `pingAll()` | 无 | `Promise<Record<TTargetId, boolean>>` | 仅 ping middleware；探测当前 peer 快照 |
| `hooks.on(listener)` | listener | disposer | 仅 hooks middleware；注册语义化观察器 |

`sendAll` 以调用开始时的 peer 快照为准；重连、注册或移除不会改变该次 fan-out 的目标集。任一 target 失败时整次 `Promise` reject，但其余已启动 request 不会被取消。该语义不引入额外广播 task 或并发调度器。

### 3.3 endpoint 内部所有权

| 状态/能力 | 所有者 | 不属于 |
| --- | --- | --- |
| middleware 安装、配置、资源 dispose | 私有 `PluginHost` | endpoint 请求链路 |
| `Map<taskId, Pending>` | endpoint runtime | contract、timeout plugin |
| peer 注册与 source/origin 绑定 | connect | protocol、adapter 外部调用方 |
| provider 与 event listener 映射 | endpoint runtime | PluginHost extension |
| encoded payload 的重组/ack 缓存 | chunk | endpoint Pending Map |
| provider AbortController | endpoint runtime / abort | timeout timer |

## 4. 消费端 API

### 4.1 Provider

```ts
type IWebRpcContext = {
  readonly data: unknown
  readonly signal: AbortSignal
  success(data?: unknown): IProviderResult
  failed(message: string, code: string): IProviderResult
  dispatchTo(input: { id?: string; method: string; data: unknown }): void
}

type IWebRpcProvider = (
  ctx: IWebRpcContext
) => IProviderResult | Promise<IProviderResult>
```

- `provide()` 的 method 必须为非空精确字符串；同名注册报 `PROVIDER_DUPLICATED`，不覆盖。
- provider 必须返回 `ctx.success()` 或 `ctx.failed()`；非 dispatch 请求无返回值时回应 `PROVIDER_NOT_SETTLED`。
- provider 抛错或 reject 时回应 `INTERNAL`。
- `dispatchTo({ id, method, data })` 的 id 缺省时，向除当前 endpoint 与本次 sender 外的全部已知 endpoint 广播。

### 4.2 事件消费

```ts
type IWebRpcEventListener = (
  ctx: IWebRpcContext
) => void | Promise<void>

endpoint.on('notification.show', ({ data }) => showToast(data))
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

| 情况 | 非 dispatch request | dispatchOnly request |
| --- | --- | --- |
| `return ctx.success(data)` | 回传 `ok: true` response | 无效调用，不回传 |
| `return ctx.failed(message, code)` | 回传 `ok: false` response | 无效调用，不回传 |
| handler resolve `undefined` | `PROVIDER_NOT_SETTLED` | 合法结束 |
| handler throw/reject | `INTERNAL` response | hooks 记录，静默结束 |
| abort signal 触发 | 终止结果回传；迟到结果丢弃 | 终止 listener/provider；迟到结果丢弃 |
| `ctx.*` 在任务结束后调用 | 不发送，触发 `PROVIDER_CONTEXT_EXPIRED` hooks | 不发送，触发同一 hooks |

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
  readonly type: 'request'
  readonly version: string
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly method: string
  readonly data: unknown
  readonly dispatchOnly: boolean
  readonly sentAt: number
}

type IWebRpcResponse = {
  readonly type: 'response'
  readonly version: string
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly method: string
  readonly ok: boolean
  readonly data?: unknown
  readonly code?: string
  readonly message?: string
  readonly sentAt: number
}
```

- response 回显 request 的 `taskId` 与 `method`，并反转 sender/target。
- 失败 response 必须含大写 `code` 和 `message`；`data` 的类型为 `unknown`。
- contract 不包含 `retryable`、认证声明、cancel 类型或握手类型。
- 版本缺省为 `'1.0'`；`contract(config)` 可配置接受版本与 identifier 上限。

### 5.1 Contract 配置与校验

```ts
type IContractConfig = {
  /** 当前发出报文的版本。default: '1.0' */
  version?: string
  /** 可接收版本。default: [version] */
  acceptVersions?: readonly string[]
  /** senderId、targetId、taskId、method 的最大长度。default: 128 */
  maxIdentifierLength?: number
}
```

| 校验点 | request | response |
| --- | --- | --- |
| `type` | 必须为 `'request'` | 必须为 `'response'` |
| version | 在 `acceptVersions` 中 | 在 `acceptVersions` 中 |
| 标识 | task/sender/target/method 非空且不超限 | task/sender/target/method 非空且不超限 |
| 方向 | sender 与 target 不能相同 | 必须与原 request 方向相反 |
| 关联 | 新 taskId | 必须命中当前 Pending Map，且 method 一致 |
| 成功 | `ok: true`，`data` 可为任意 unknown | 同左 |
| 失败 | 不适用 | `ok: false`，必须有全大写 `code` 与非空 `message` |
| 时间 | `sentAt` 为安全 Unix 毫秒数 | 同左 |

未知字段允许存在并被忽略，以支持前向扩展；已知字段的类型不合法即视为非法报文。

### 5.2 Data Schema

`schema` 只负责校验 contract 内业务 `data`，不负责校验 contract envelope。Envelope 的 `type`、`version`、标识字段、方向和 request/response 关联，仍由 `contract` 自身校验。

schema 按 method 定义 request data 与 response data 的运行时校验规则：

```ts
type IDataSchema<T> = {
  parse(value: unknown): T
}

type IMethodSchema = {
  params: IDataSchema<unknown>
  result: IDataSchema<unknown>
}

type IContractSchemaConfig = {
  methods: Readonly<Record<string, IMethodSchema>>
}
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
})
```

核心包只依赖最小的 `parse(value)` adapter，不直接依赖 Zod、TypeBox 或其他具体 schema 库。各 schema 库通过 adapter 接入；adapter 负责把库自身的校验错误转换为 web-rpc 的 validation error。schema 校验只保证运行时 data contract，不替代序列化、传输安全限制或权限认证。

### 5.3 Schema Validation Error

schema 校验失败使用独立的 `SCHEMA_INVALID` 错误，不复用 `CONTRACT_INVALID`、`PAYLOAD_INVALID` 或 `INTERNAL`。这样调用方可以区分“报文 envelope 非法”和“业务 data 不符合 method schema”。

```ts
type ISchemaValidationErrorData = {
  readonly kind: 'schema-validation'
  readonly method: string
  readonly side: 'params' | 'result'
  readonly issues: readonly {
    readonly path: readonly (string | number)[]
    readonly message: string
    readonly code?: string
  }[]
}
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

| code | 产生位置 |
| --- | --- |
| `PROTOCOL_INVALID` | protocol 解码或 envelope 非法 |
| `CONTRACT_VERSION_UNSUPPORTED` | version 不被接受 |
| `CONTRACT_INVALID` | contract 字段、方向或关联不合法 |
| `SCHEMA_INVALID` | method 的 params/result 不满足 schema |
| `PAYLOAD_INVALID` | codec 输入不满足其 payload 规则 |
| `PAYLOAD_TOO_LARGE` | chunk/codec 触发数据上限 |
| `METHOD_NOT_FOUND` | 无同名 provider 或 event listener |
| `UNAUTHENTICATED` | connect 验证后能安全确认来源但身份不通过 |
| `FORBIDDEN` | provider 明确拒绝 |
| `CANCELLED` | 本地 abort 结束 send |
| `DEADLINE_EXCEEDED` | timeout 结束 send |
| `OVERLOADED` | 实现配置的本地容量限制拒绝工作 |
| `UNAVAILABLE` | transport/peer 当前不可用 |
| `INTERNAL` | provider 未处理异常 |
| `PROVIDER_NOT_SETTLED` | 非 dispatch provider 没有返回结果 |

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
  payloadInvalid: 'PAYLOAD_INVALID',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  methodNotFound: 'METHOD_NOT_FOUND',
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
} as const

export type WebRpcErrorCode =
  (typeof WebRpcErrorCode)[keyof typeof WebRpcErrorCode]

export type IWebRpcErrorData = {
  readonly code: string
  readonly message: string
  readonly data?: unknown
}

export type IWebRpcErrorOptions = IWebRpcErrorData & {
  readonly cause?: unknown
}

export class WebRpcError extends Error {
  readonly code: string
  readonly data: unknown | undefined
  readonly cause: unknown | undefined
}

/** 调用 factory、middleware、provider 注册时的非法配置或重复注册。 */
export class WebRpcConfigurationError extends WebRpcError {}
/** endpoint 已 dispose 或生命周期前置条件不满足。 */
export class WebRpcLifecycleError extends WebRpcError {}
/** codec encode/decode 失败，或 payload 不符合 codec 的输入要求。 */
export class WebRpcSerializationError extends WebRpcError {}
/** scheme 不支持、加解密失败或 protocol envelope 非法。 */
export class WebRpcProtocolError extends WebRpcError {}
/** 通过 protocol 后，contract 字段、版本或关联关系不合法。 */
export class WebRpcContractError extends WebRpcError {}
/** contract 内 method data 不符合 params/result schema。 */
export class WebRpcSchemaValidationError extends WebRpcError {
  readonly data: ISchemaValidationErrorData
}
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

export function isWebRpcError(error: unknown): error is WebRpcError
export function getWebRpcErrorCode(error: unknown): string | undefined
```

| 错误来源 | 对外错误类型 | `name` | `code` |
| --- | --- | --- | --- |
| factory/API/config/provider 注册校验 | `WebRpcConfigurationError` | `WebRpcConfigurationError` | `MIDDLEWARE_*`、`PROVIDER_DUPLICATED`、`UUID_*` |
| dispose 后调用 API | `WebRpcLifecycleError` | `WebRpcLifecycleError` | `ENDPOINT_DISPOSED` |
| codec encode/decode 或 payload 失败 | `WebRpcSerializationError` | `WebRpcSerializationError` | `PAYLOAD_INVALID`、`PAYLOAD_TOO_LARGE` |
| scheme/envelope/crypto 失败 | `WebRpcProtocolError` | `WebRpcProtocolError` | `PROTOCOL_*` |
| version/contract/response 关联失败 | `WebRpcContractError` | `WebRpcContractError` | `CONTRACT_*` |
| contract data schema 校验失败 | `WebRpcSchemaValidationError` | `WebRpcSchemaValidationError` | `SCHEMA_INVALID` |
| adapter/peer 投递失败 | `WebRpcTransportError` | `WebRpcTransportError` | `UNAVAILABLE` |
| chunk 格式、上限、超时、ack 失败 | `WebRpcChunkError` | `WebRpcChunkError` | `CHUNK_*` |
| 远端 `ok: false` response | `WebRpcRemoteError` | `WebRpcRemoteError` | response 的 code |
| 调用方 AbortSignal | `WebRpcAbortError` | `AbortError` | `CANCELLED` |
| 本地 deadline | `WebRpcTimeoutError` | `TimeoutError` | `DEADLINE_EXCEEDED` |
| provider 未处理异常 | 调用方收到 `WebRpcRemoteError` | `WebRpcRemoteError` | `INTERNAL` |

`code` 允许远端 provider 使用满足全大写格式的自定义值；`WebRpcErrorCode` 只是库内稳定标准集合。`message` 用于人类诊断，`data` 为可选结构化错误数据。`cause` 仅存在于本地错误，不进入 contract，不参与 JSON 序列化。

retry 示例和实现一律通过 `getWebRpcErrorCode(error)` 判断错误类别，不能依赖浏览器/运行时差异化的 `instanceof DOMException`。

## 6. ID 与报文变种

```ts
taskId: `TASK:${senderId}:${generatedId}`
messageId: `MESSAGE:${senderId}:${generatedId}`
variationId: `VARIATION:${senderId}:${generatedId}`
```

`uuid()` 负责生成 `generatedId`：优先 `crypto.randomUUID()`，其次 `crypto.getRandomValues()`；都不可用时创建失败 `UUID_UNAVAILABLE`。调用方可通过同步 `generate(context)` 注入实现；不允许 `Math.random()` 降级。

```ts
type IUuidContext = {
  readonly variation: 'task' | 'message' | 'variation'
  readonly senderId: string
  readonly targetId?: string
}

type IUuidConfig = {
  generate?: (context: IUuidContext) => string
}
```

- generator 必须同步返回非空字符串；空值报 `UUID_INVALID`。
- 新 taskId 与当前 Pending Map 冲突时立即报 `UUID_CONFLICT`，绝不覆盖既有 Promise。
- 随机 ID 只用于关联，不承担身份认证、权限或签名职责。
- taskId 属于 contract；messageId 属于 chunk；variationId 属于 ping、abort、chunk-ack 等逻辑变种。

除正常 contract 外，内部使用 variation 报文：

```ts
type IPingVariation = {
  readonly variation: 'ping' | 'pong'
  readonly variationId: string
  readonly senderId: string
  readonly targetId: string
  readonly sentAt: number
}

type IAbortVariation = {
  readonly variation: 'abort'
  readonly variationId: string
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly sentAt: number
}

type IChunkAckVariation = {
  readonly variation: 'chunk-ack'
  readonly variationId: string
  readonly messageId: string
  readonly senderId: string
  readonly targetId: string
}
```

不引入 `control` 类别、`controlId` 或 `type: 'control'`。

### 6.1 variation 路由边界

| variation | 产生者 | 接收者 | 业务可见性 |
| --- | --- | --- | --- |
| `ping` / `pong` | ping | ping | 不进入 contract/provider/hooks 的业务 request 事件 |
| `abort` | abort/timeout | abort | 不进入 provider；匹配活跃 task 后仅触发 signal |
| `chunk` | chunk | chunk | 物理帧，不进入 protocol decode 前的业务链路 |
| `chunk-ack` | chunk | chunk | protocol 可序列化的逻辑确认，不进入 provider |

所有 variation 的 senderId、targetId 都要经过 connect 基础绑定。ping/pong 故意绕开 serialization 与 encryption，原因是它们只用于探测已绑定的信道，不承载 data、token 或 contract 内容。

## 7. Middleware

### 7.1 必装默认项

| middleware | 策略 |
| --- | --- |
| `uuid()` | 内建必装；可被 `uuid(config)` 覆盖默认生成器 |
| `contract()` | 内建必装；默认版本 `'1.0'` |
| `protocol()` | 内建必装；默认 JSON、无加密 |
| `connect()` | 必须由调用方显式提供 |
| `chunk()`、`ping()`、`abort()`、`timeout()`、`hooks()` | 可选 |

用户 middleware 的数组顺序不改变底层传输顺序。重复 singleton middleware 创建失败 `MIDDLEWARE_DUPLICATED`。

### 7.2 Connect

connect 负责 adapter 建连、peer 注册、基础身份绑定与重连。

```ts
type IConnectVerifyConfig = {
  useBaseIdVerifyOnly?: boolean // default true
  identifier?: (context: IConnectVerifyContext) => boolean | Promise<boolean>
  triggerTiming?: 'register' | 'message' // default 'register'
  onVerified?: (context: IConnectVerifyContext) => void
  onRejected?: (context: IConnectVerifyContext, reason: unknown) => void
}

type IConnectVerifyContext = {
  readonly senderId: string
  readonly targetId: string
  readonly peer: {
    readonly id: string
    readonly origin?: string
  }
}
```

```ts
type IReconnectConfig = {
  initialDelayMs?: number // default 250
  maxDelayMs?: number // default 10_000
  maxAttempts?: number // omitted = unlimited
  delay?: (context: {
    attempt: number
    reason: unknown
    previousDelayMs?: number
  }) => number | false | null | Promise<number | false | null>
}

type IConnectConfig<TTargetId extends string = string> = {
  /** 单一目标或多个逻辑目标；内部统一规范化为去重数组。 */
  serverIds?: TTargetId | readonly TTargetId[]
  /** 仅 client 侧主动建立连接时使用；default false。 */
  eager?: boolean
  verify?: IConnectVerifyConfig
  reconnect?: IReconnectConfig
  // adapter-specific open/listen configuration
}
```

- `peer.id` 缺省使用创建 endpoint 的 id；Window adapter 的 `peer.origin` 缺省为 `window.location.origin`。
- `event.source` 不是公共配置；Window adapter 在注册时内部记录 `senderId -> source + origin`，用于后续定向回包与绑定检查。
- 基础校验始终覆盖 senderId、targetId、origin 与 source 注册关系。
- `useBaseIdVerifyOnly: false` 时 `identifier` 必填；identifier 的 timeout/retry 由用户自行实现。
- `triggerTiming: 'register'` 仅首次连接和重连时校验；`'message'` 仅用于确需逐报文动态校验的场景。
- `onVerified`、`onRejected` 仅观察 verify 结果；通用审计、日志、上传仍统一走 `hooks()`，不在 verify 内再造事件系统。
- 信道状态仅用 `IDLE | CONNECTING | CONNECTED | CLOSED`；host dispose 是独立终态。
- 无 reconnect 配置时不自动重连；用户可配置初始延迟、最大延迟、次数与自定义 delay 函数。

`serverIds` 可以是字符串或 readonly 数组；内部使用 `Array.isArray()` 规范化、去重为 target 列表。它表示逻辑 endpoint id，不表示浏览器 origin；origin 始终属于 Window adapter 的物理投递配置。

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

| 场景 | connect 行为 |
| --- | --- |
| 首次合法注册 | 记录 peer id、origin、WindowProxy/source 或 adapter peer handle |
| 同一 senderId 但 source/origin 不匹配 | 拒绝，不覆盖已注册 peer |
| 合法重连 | 重新校验后替换旧 source/origin 绑定 |
| `identifier()` 返回 false/抛错 | 不注册，不进入 contract/provider，触发 `peer.rejected` |
| 普通 request 验证失败 | 直接丢弃；能安全定位 sender 且非 dispatch 时可回 `UNAUTHENTICATED` |
| `event.source` 缺失 | adapter 不允许建立 Window 定向注册 |

Window/iframe 通过已注册的 `WindowProxy.postMessage(message, origin)` 回包；不允许以 `'*'` 作为目标 origin。origin 是可比较的浏览器投递边界，但不是应用身份；应用身份由 senderId 与注册绑定共同构成。

#### 7.2.2 Adapter 范围

| adapter | 作用 | 关键约束 |
| --- | --- | --- |
| Window / iframe | 跨 window、tab opener、iframe | 记录 source 与 origin，定向 postMessage |
| MessagePort | port 对端通信 | 端口生命周期由 adapter 观测 |
| Dedicated Worker | window/worker 双向通信 | Worker port 为物理 peer |
| Shared Worker | 多 client 共用 worker | senderId 隔离与注册必需 |
| Service Worker | page/worker 消息 | client/port 生命周期由 adapter 管理 |
| BroadcastChannel | 同源广播 | senderId/targetId 过滤，不把广播当身份 |
| RTCDataChannel | P2P data channel | adapter 负责 channel ready/close |
| WebTransport | stream/datagram 传输 | adapter 负责连接语义与背压 |

不实现 memory、WebSocket、SSE、localStorage、sendBeacon、history adapter；memory 场景由测试内 transport double 覆盖，其余场景已有专用通信库或不满足双向 RPC 语义。

支持 Window/iframe postMessage、MessagePort、Dedicated/Shared/Service Worker、BroadcastChannel、RTCDataChannel、WebTransport adapter。

### 7.3 Protocol

```ts
type IProtocolPayload = string | Uint8Array

type IProtocolCodec = {
  encode(message: IWebRpcProtocolMessage): IProtocolPayload
  decode(payload: IProtocolPayload): IWebRpcProtocolMessage
}

type IProtocolCrypto = {
  encrypt(payload: IProtocolPayload): IProtocolPayload | Promise<IProtocolPayload>
  decrypt(payload: IProtocolPayload): IProtocolPayload | Promise<IProtocolPayload>
}

type IProtocolConfig = {
  scheme?: string // default 'web-rpc'
  codec?: IProtocolCodec
  crypto?: IProtocolCrypto
}
```

protocol 负责 codec、可选加密和 scheme；core 不直接使用 Web Crypto 或 Node crypto。默认 codec 为 JSON，因此默认只支持 JSON 可表达数据。

`scheme` 是逻辑协议标识，而非把业务数据拼为 `custom-web://...` 字符串。需要 URI 文本的专有 transport 由其 adapter 或自定义 codec 决定格式。

```ts
type IProtocolEnvelope = {
  readonly scheme: string
  readonly payload: IProtocolPayload
}
```

发送顺序：`codec.encode → encrypt（若允许）→ envelope`；接收顺序：`scheme 校验 → decrypt（若加密）→ codec.decode`。codec 可以实现 MessagePack 等格式；crypto 只接收已编码 payload，不理解 contract 业务字段。

| 报文 | 序列化 | 加密 | chunk |
| --- | --- | --- | --- |
| contract / `chunk-ack` | 是 | 可选 | 需要时 |
| `abort` | 是 | 否 | 通常不需要 |
| `ping` / `pong` | 否 | 否 | 否 |

`scheme` 不匹配、解密或解码失败均丢弃并触发 hooks；不进入 provider。

`encrypt()` 或 `codec.encode()` 发送失败时，`send()` reject、`dispatch()` 仅产生 hooks；`decrypt()` 或 `decode()` 失败不会向未知来源反射错误报文。

### 7.4 Chunk

```ts
type IChunkFrame = {
  readonly variation: 'chunk'
  readonly messageId: string
  readonly chunkId: string
  readonly scheme: string
  readonly index: number
  readonly total: number
  readonly payload: Uint8Array
}
```

```ts
type IChunkConfig = {
  maxChunkBytes?: number // default 64 * 1024
  maxMessageBytes?: number // default 4 * 1024 * 1024
  maxPendingMessages?: number // default 32
  receiveTimeoutMs?: number // default 30_000
  resumeOnReconnect?: boolean // default true
}
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
endpoint.pingAll(): Promise<Record<string, boolean>>
```

- `ping`/`pong` 直接经 connect 基础绑定后发送，不经过 protocol、加密或 chunk。
- 同一 targetId 的并发 ping 复用一个 Promise。
- timeout 或发送失败返回 `false`，并通知 connect 将 peer 标记为失活；是否重连由 connect 决定。

### 7.6 Abort 与 Timeout/Retry

```ts
type ISendOptions = {
  signal?: AbortSignal
  timeoutMs?: number | false
}
```

```ts
type ITimeoutConfig = {
  /** default false；false 表示默认永不超时。 */
  defaultTimeoutMs?: number | false
  retry?: IRetryConfig
}

type IRetryContext = {
  readonly attempt: number
  readonly error: unknown
  readonly targetId: string
  readonly method: string
  readonly data: unknown
}
```

- `abort()` 使 `send(..., { signal })` 可用；发送后取消会本地 reject `AbortError/CANCELLED` 并发出序列化但不加密的 abort variation。
- 接收端按 `senderId + taskId` 找到活跃 provider 并触发其 AbortController；找不到则丢弃并 hooks。
- `timeout()` 以 `Promise.race(response, abort, deadline)` 实现整个 send deadline；deadline 包含懒建连、序列化、发送、远端执行与响应。
- deadline 到期若安装 abort 则通知远端中止；否则仅本地结束。迟到 response 丢弃并 hooks。

```ts
type IRetryConfig = {
  maxAttempts?: number // extra attempts, default 0
  shouldRetry?: (context: IRetryContext) => boolean | Promise<boolean>
  delay?: (context: IRetryContext) => number | false | null | Promise<number | false | null>
}
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
  | { name: 'peer.registered' | 'peer.rejected' | 'peer.lost'; at: number; localId: string; peer: unknown; reason?: unknown }
  | { name: 'request.sent' | 'request.received' | 'response.sent' | 'response.received'; at: number; localId: string; contract: IWebRpcContract }
  | { name: 'dispatch.sent' | 'dispatch.received'; at: number; localId: string; contract: IWebRpcRequest }
  | { name: 'provider.started' | 'provider.succeeded' | 'provider.failed' | 'provider.aborted'; at: number; localId: string; error?: unknown }
  | { name: 'variation.sent' | 'variation.received'; at: number; localId: string; variation: unknown }
  | { name: 'failure'; at: number; localId: string; code: string; error: unknown; context?: unknown }
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

| 被拒绝概念 | 不采用原因 | 替代归属 |
| --- | --- | --- |
| `auth()` middleware | C 端通信不需要独立认证层，且会加重 client 成本 | `connect.verify` 与基础 id/source/origin 绑定 |
| 独立 handshake middleware | 注册本身已建立 peer 绑定，额外握手没有独立语义 | connect 注册；ping 只做存活探测 |
| `clientId` / `serverId` 命名 | 双向通信下角色不是协议身份 | `senderId` / `targetId` |
| `type: 'control'`、`controlId` | 已有正常 contract 与 variation 两层，第三类无必要 | `variation` + `variationId` |
| `redirect()` | 透明代理收益不足、路由与 response 关联复杂 | 不提供 |
| capability 抽象 | chunk/adapter 各自有清晰职责，引入只会扩大概念面 | `connect`、`chunk` 直接负责 |
| `MutationTask`、请求状态机 | middleware 安装串行，endpoint 用 Map 即可 | PluginHost lifecycle + endpoint Map |
| 请求 pipeline 交给 PluginHost | 会混淆 middleware 生命周期与每次 task | endpoint runtime 的固定链路 |
| 自动 `ready()` | factory resolve 即表示 middleware 已安装；懒连接由首次 send/ping 触发 | async factory |
| `host.use(a).use(b)` 式链式安装 | use 为异步且注册仅在 factory 初始化期发生 | `middlewares: [...]` |
| plugin 内 `core.use()` 套娃 | 插件拓扑必须由 factory 一次确定 | 不向 middleware core 暴露 topology mutation |
| WebSocket / SSE adapter | 已有更合适专用库 | 外部 transport/专用库 |
| retry 标记进入 contract | retry 是本地幂等性与策略问题 | `timeout.retry` |
| `Math.random()` UUID 降级 | 不能真实保证唯一性 | crypto 能力或注入 generator |
| raw transport `on(listener)` 广播 | 会暴露加密载荷、chunk 细节与未封装 channel | `on(event, ctx)` 只消费匹配 dispatch 事件；`hooks()` 观测语义事件 |

## 10. 迁移与验证

### 10.1 文件级迁移

| 现有路径 | 落地动作 | 新职责 |
| --- | --- | --- |
| `src/client.ts` | 删除 | 不再存在单向 client runtime |
| `src/server.ts` | 删除 | 不再存在单向 server runtime |
| `src/protocol.ts` | 删除并重建 | contract、protocol envelope、variation 的独立模块 |
| `src/internal/request-registry.ts` | 重写或替换 | endpoint 的 `Map<taskId, Pending>` 小型工具 |
| `src/internal/id-allocator.ts` | 删除 | uuid middleware 接管生成策略 |
| `src/errors.ts` | 重写 | 新 code、AbortError、TimeoutError、remote failure 解析 |
| `src/transport.ts` | 保留并收敛 | adapter 与 endpoint 的唯一物理传输边界 |
| 其他 `src/adapters/*` | 逐个迁移 | connect 所需 peer/source/origin/close 能力 |
| `src/index.ts` | 最后一次性切换 | 仅导出新 API、middleware、adapter |
| `src/rpc.test.ts` | 删除并替换 | endpoint/middleware 行为测试 |

旧实现不能以 deprecated export、alias、双协议 parser 或平行构造函数的形式遗留。切换 `index.ts` 前，新实现必须已通过测试内 transport double 的完整端到端验收；切换后删除旧文件与旧测试。

### 10.2 分阶段实施

1. **基础类型与边界**：新建 endpoint、contract、variation、错误、middleware descriptor 类型；添加 `@migai/plugin-host` workspace 依赖。
2. **最小可用核心**：私有安装 uuid、contract、protocol、connect；实现 provider、on、Pending Map、`send/dispatch`、dispose。
3. **端到端验收**：测试内构造最小 transport double，以两个显式 id 的 endpoint 验证双向 request、response、dispatch、event 和 `dispatchTo`；不创建 production memory adapter。
4. **可靠性 middleware**：实现 abort、timeout/serial retry、ping、hooks，并覆盖清理和迟到报文。
5. **大载荷 middleware**：实现 chunk、ack、资源上限、乱序/重复帧与重连重发。
6. **adapter 迁移**：Window/iframe 优先，其后 MessagePort、Worker、BroadcastChannel、RTCDataChannel、WebTransport。
7. **breaking cutover**：替换 exports、README、USEGUIDE、browser support list；删除 v1 全部实现与测试。

### 10.3 测试矩阵

| 层 | 必测场景 |
| --- | --- |
| factory | 必填 id/connect、重复 middleware、安装失败回滚、dispose 幂等 |
| endpoint | 双向 send、sendAll target 快照、dispatch、dispatchAll、provider 重复、on 精确匹配与 disposer |
| contract | version、方向、response method/task 关联、大写错误码、未知字段、迟到 response |
| connect | 基础 id 绑定、verify register/message、重连替换 peer、Window source/origin 不匹配、无 `*` 回包 |
| uuid | 默认随机能力、注入 generator、空 ID、Pending 冲突、三种前缀 |
| protocol | JSON、custom codec、encrypt/decrypt、scheme 不匹配、abort 不加密、ping 不经 protocol |
| abort | 已取消 signal、执行中取消、远端 signal、未知 task abort、provider 忽略 signal 的迟到结果 |
| timeout/retry | Promise.race 清理、0 deadline、retry 无条件、按 error 条件、delay 停止、串行 taskId、更晚 response |
| ping | 手动、自动心跳、同 target 去重、pong timeout、peer 失活通知 |
| hooks | 所有事件、async rejection 隔离、onHookError 不递归、无 hooks 时不分配监听器 |
| chunk | 小包直传、切片、乱序、重复、上限、超时、ack、重连重发、provider 不提前执行 |
| adapters | 测试内 transport double 端到端、Window iframe source/origin、MessagePort/Worker/BroadcastChannel 生命周期 |
| architecture | web-rpc 只向内依赖 plugin-host；plugin-host 不反向依赖；core 无 adapter runtime import |

### 10.4 构建与文档验收

- `web-rpc` typecheck、core typecheck、各 adapter typecheck、Vitest 与 build 全部通过。
- 新 public exports 必须无旧 `RpcClient`、`createRpcServer`、`RpcSchema`、`RpcWireMessage`。
- README 明确 Browser Support List，且不承诺不存在的 native runtime/polyfill。
- USEGUIDE 按 factory、endpoint、每个 middleware 列出参数类型、必填性、返回值、默认值、失败规则与完整示例。
- architecture test 必须证明依赖方向 `adapter → web-rpc endpoint → plugin-host`，且 core 可在无 DOM/Node ambient 类型配置下通过检查。

### 10.5 主要风险与规避

| 风险 | 影响 | 落地规避 |
| --- | --- | --- |
| 把 PluginHost pipeline 用作 request pipeline | 生命周期与 task 状态耦合，复杂度回升 | 只把 PluginHost 用于 middleware 生命周期 |
| retry 重复执行业务操作 | 非幂等 provider 产生副作用 | retry 显式配置、严格串行、记录风险，不放入 contract |
| Window 仅凭 origin 回包 | iframe/窗口身份混淆 | 注册并校验 senderId + origin + event.source |
| chunk ack 当成 provider 成功 | 调用方错误 resolve | ack 仅释放 encoded frame 缓存；response 才 settle task |
| hook 阻塞/抛错 | 通信性能与可靠性下降 | 不 await、失败隔离、不递归事件 |
| 旧 API 与新 API 共存 | 类型/协议/文档双重维护 | 一次性 export cutover，删除旧实现 |
