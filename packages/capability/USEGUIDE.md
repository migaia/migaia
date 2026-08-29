# `@migaia/capability` 使用指南

本指南覆盖面向应用与适配器的公开运行时 API、关键契约类型、边界行为与错误码。仅参与条件推导的 type-only 辅助类型以发布的 `.d.ts` 和编辑器提示为准，不在正文逐项抄录；包的定位与安装方式、最小上手示例见 [README](./README.md)。

## 目录

- [导入与运行环境](#导入与运行环境)
- [静态 Capability Graph](#静态-capability-graph)
- [状态机](#状态机)
- [宿主创建与开关快照](#宿主创建与开关快照)
- [完整 API 参考](#完整-api-参考)
- [Generation：竞态与作废的激活](#generation-races)
- [释放顺序与依赖](#释放顺序与依赖)
- [错误码与错误结构](#错误码与错误结构)
- [重入与并发保护](#重入与并发保护)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="导入与运行环境"></a>

## 导入与运行环境

```ts
import {
  createCapabilityHost,
  type ICapabilityHandle,
  type ICapabilityState,
  type ICapabilityEnableResult,
  type ICapabilityDefinition,
  type ICapabilityHostOptions,
  type ICapabilityHost,
  CapabilityState,
  CapabilityEnableStatus,
  CapabilityErrorCode,
  type ICapabilityErrorCode,
  CAPABILITY_SOURCE
} from '@migaia/capability';
```

`exports` 提供包根（`.`）、静态 Graph 子路径（`./graph`）与无状态拓扑子路径（`./graph/topology`）。Host 符号从包根导入，Graph 符号从 `@migaia/capability/graph` 导入；只需纯 required-edge 准入时从 `@migaia/capability/graph/topology` 导入。本包复用 `@migaia/lifecycle` 的竞态/所有权原语与 `@migaia/utils/error` 的 `attachErrorIdentity`；不依赖 Store、React 或任何运行时全局对象，可在任意支持 ESM 的 JS 环境中使用。

<a id="静态-capability-graph"></a>

## 静态 Capability Graph

```ts
import {
  createCapabilityGraph,
  CapabilityGraphErrorCode,
  type IGraphNodeId,
  type IGraphNodeDefinition,
  type IGraphStartContext,
  type IGraphNodeInstance
} from '@migaia/capability/graph';
```

`createCapabilityGraph(options?)` 在创建 lifecycle 根 scope 前读取 `options.onError`；getter failure 或非 callable 值抛 `GRAPH_INVALID_OPTION`。首次 `ready()` 只接受当前注册表，冻结后 `register()` 抛 `GRAPH_FROZEN`；terminal 后变更抛 `GRAPH_DISPOSED`。

```ts
type IGraphNodeDefinition<T> = {
  readonly id: IGraphNodeId;
  readonly kind: string;
  readonly dependencies: readonly { readonly provider: IGraphNodeId; readonly required: true }[];
  readonly start: (
    context: IGraphStartContext
  ) => IGraphNodeInstance<T> | PromiseLike<IGraphNodeInstance<T>>;
};
```

`ready()` 会先校验 unknown provider、duplicate edge、self-loop/cycle，再按注册 ordinal 做稳定拓扑启动。`context.get(provider)` 只能读取当前 node 已声明且已 ready 的 direct provider；它不创建 lease。`context.own()` 进入 node provisional scope，启动失败、abort、stale 或 dispose 时回滚。

使用 `@migaia/capability/graph/topology` 时，公开节点的 `ordinal` 必须唯一并连续覆盖 `[0, nodeCount)`；拓扑构建只接受该注册域，非法或重复 ordinal 会按 `onInvalid` 的 `invalid-node` 或 `duplicate-ordinal` 语义报告。

`IGraphNodeInstance` 必须提供 `{ value, release }`。Graph 只拥有一次 primary release；auxiliary release 由 lifecycle scope 管理，节点内 primary 先于 auxiliary，节点之间按逆拓扑释放。`ready()` 与 `dispose()` 在重复调用时保留 Promise identity；启动失败后 Graph 不隐式 retry，但仍可调用 `dispose()` 收尾。

`snapshotGraphReadiness(source)` 是 Host 与 Graph 之间的低层准入快照：严格按 `state`、`error` 顺序各读取一次，只接受 `ready | blocked | failed`，并返回冻结的 `{ state, error }`。原生 `Error` getter failure 保持实例身份；非 `Error` 抛出值会以 `INVALID_OPTION` 包装且保留在 `cause`。普通业务代码应读取 Graph 自身状态；只有桥接外部 readiness source 时才直接调用它。

Graph 状态为 `open → starting → ready | failed → quiescing → terminal`。`nodeState()` 与 `nodes` 在 terminal 后仍可读取；unknown node 抛 `GRAPH_UNKNOWN_NODE`。14 个 Graph error code 从 `CapabilityGraphErrorCode` 导出，错误保留 native Error/cause/stack，并由 `onError` 作为 diagnostics sink 接收 cleanup/late-result failure。

---

<a id="状态机"></a>

## 状态机

`ICapabilityState`（即 `CapabilityState` 常量表的取值联合）是以下五个字符串之一：

| 状态         | 含义                                       | 进入条件                                                                                    |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `off`        | 开关允许，但尚未启用                       | 注册时开关为 `true`；或开关从 `false` 变为 `true`；或成功 `disable()` 后（开关仍为 `true`） |
| `gated`      | 开关明确拒绝                               | 注册时开关不为 `true`；或 `setFlag`/`setFlags` 把某能力移出允许表                           |
| `activating` | `activate()` 正在执行，尚未 settle         | 调用 `enable()` 且当前不是 `on`                                                             |
| `on`         | 已启用，持有一个有效 handle                | `activate()` 成功返回合法 handle，且期间没有被回退作废                                      |
| `failed`     | 上一次激活失败，或激活期间自身资源清理失败 | `activate()` 抛错、返回值不是带 `dispose()` 的对象；或代数匹配下的 release 出错             |

把 `off` 和 `gated` 分开是有意为之：控制台与调用方不会把"从未尝试启用"误报成"被灰度策略拦截"——两者的排查方向完全不同；同时与 tray 的 graph availability `blocked` 状态在名字上区分开，两者是完全不同的恢复语义，不共用一个状态名。

`state(name)` 对未注册的名字抛出携带 `code: 'NOT_REGISTERED'` 的错误；不要用 try/catch 探测名字是否存在，先查 `names`。

```ts
const CapabilityState = {
  off: 'off',
  gated: 'gated',
  activating: 'activating',
  on: 'on',
  failed: 'failed'
} as const;
type ICapabilityStateValue = (typeof CapabilityState)[keyof typeof CapabilityState];
```

`state-constants.ts` 经主入口 `export *` 一并导出 `ICapabilityStateValue`（与 `ICapabilityState` 同一个联合类型，命名历史遗留、两者等价）。

```ts
const CapabilityEnableStatus = {
  enabled: 'enabled',
  gated: 'gated',
  cancelled: 'cancelled',
  failed: 'failed'
} as const;
type ICapabilityEnableStatusValue =
  (typeof CapabilityEnableStatus)[keyof typeof CapabilityEnableStatus];
```

同样经 `export *` 导出的 `ICapabilityEnableStatusValue` 是 `ICapabilityEnableResult['status']` 取值的联合类型，与 `CapabilityEnableStatus` 常量表的取值一一对应。

`CapabilityEnableStatus` 是 `enable()`/`enableResult()` 返回值 `status` 字段的取值表，对应完整联合类型：

```ts
type ICapabilityEnableResult =
  | { readonly status: 'enabled' }
  | { readonly status: 'gated' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly error: unknown };
```

- `enabled` —— 激活成功并被采纳，`state` 变为 `on`。
- `gated` —— 开关拒绝，`enable()` 直接短路，从未调用 `activate()`。
- `cancelled` —— 激活在完成前被开关关闭或 host 释放作废（见 [Generation](#generation-races)），刚创建出的 handle 已被就地释放。
- `failed` —— `activate()` 抛错，或返回值不是"带可调用 `dispose` 的对象"；`error` 字段携带原始失败原因，与 `error(name)` 查到的一致。

---

<a id="宿主创建与开关快照"></a>

## 宿主创建与开关快照

```ts
function createCapabilityHost<Context>(
  context: Context,
  options?: ICapabilityHostOptions
): ICapabilityHost<Context>;

type ICapabilityHostOptions = {
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly onError?: (name: string, error: unknown) => void;
};
```

`context` 是所有 `activate()` 共享的应用上下文对象，按引用传入且不会被冻结——只放调用能力确实需要的东西（Store、配置、telemetry），host 本身不会读取或修改它。

`createCapabilityHost` 在创建时对 `options` 做一次准入快照：`flags`、`onError` 及其 receiver 只从这一份快照取得，之后修改或替换传入的 `options` 对象不会改变 host 行为。`options` 必须是对象或函数（`null`/原始值会抛 `TypeError`，`code: 'INVALID_OPTION'`）；`options.onError` 若提供必须是函数（否则同样抛 `INVALID_OPTION` 的 `TypeError`）；读取 `options.onError`/`options.flags` 本身抛错（例如恶意 Proxy 的 getter）会包装成 `code: 'INVALID_OPTION'` 的错误并携带原始异常为 `cause`。

`options.flags` 只在**创建时**被复制一份快照，之后必须调用 `setFlag()`/`setFlags()` 才能改变开关。复制逻辑只接受**自有、可枚举、值严格等于 `true`** 的数据属性：

- 继承属性（原型链上的）一律不算允许，即使值是 `true`。
- getter 属性完全不会被求值——host 只读取属性描述符（`Object.getOwnPropertyDescriptors`），不触发用户代码，避免配置对象的 getter 在构造 host 或热回退期间执行任意代码。
- `__proto__`、`constructor` 这类危险键名只是内部 `Map` 里的普通字符串键，不会污染原型链。
- 若 `flags` 对象本身的 `ownKeys`/`getOwnPropertyDescriptor` 陷阱抛错（恶意 Proxy），`copyFlags` 会抛出 `code: 'INVALID_OPTION'` 的错误，原始异常挂在 `cause` 上。

`setFlags(flags)` 是**原子替换整份快照**：新快照里没列出的能力一律按拒绝处理，不会保留旧快照里残留的 `true`——这是为了让"远端配置删掉一个键"能够可靠地收回权限。如果传入的 `flags` 对象本身不可安全读取，host 会**先**整体回退到"全部拒绝"的空快照，**再**把原始错误重新抛给调用方，不会因为配置读取失败就继续沿用上一份允许表。

`setFlag(name, false)` 本身就是一次原子回退：它会同步作废该能力的在途激活并释放已有 handle，调用方不需要再额外调用一次 `disable()`。`setFlag(name, true)` 只是把开关打开，**不会自动启用**——启用仍然由调用方决定时机，调用 `enable(name)`。

---

<a id="完整-api-参考"></a>

## 完整 API 参考

### 类型

| 类型                                     | 定义                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ICapabilityHandle`                      | `{ dispose(): void \| PromiseLike<void> }`                                                        |
| `ICapabilityState`                       | `'off' \| 'gated' \| 'activating' \| 'on' \| 'failed'`                                            |
| `ICapabilityEnableResult`                | 见[状态机](#状态机)一节的完整联合类型                                                             |
| `ICapabilityDefinition<Context, Handle>` | `{ name: string; activate(context: Context): Handle \| Promise<Handle> }`                         |
| `ICapabilityHostOptions`                 | `{ flags?: Readonly<Record<string, boolean>>; onError?: (name: string, error: unknown) => void }` |
| `ICapabilityHost<Context>`               | 见下表全部成员                                                                                    |

`ICapabilityHandle` 是 `activate()` 返回值的唯一形状约束：必须有一个可调用的 `dispose`。`activate` 的返回值缺少可调用 `dispose`（比如返回 `null`、返回一个没有 `dispose` 方法的对象）会被当作激活失败，能力进入 `failed` 态——"半开"比明确失败更危险。

### `ICapabilityHost<Context>` 全部成员

```ts
type ICapabilityHost<Context> = {
  register<Handle extends ICapabilityHandle>(
    definition: ICapabilityDefinition<Context, Handle>
  ): void;
  readonly names: readonly string[];
  state(name: string): ICapabilityState;
  handle<Handle extends ICapabilityHandle>(name: string): Handle | undefined;
  error(name: string): unknown;
  setFlag(name: string, enabled: boolean): void;
  setFlags(flags: Readonly<Record<string, boolean>>): void;
  enable(name: string): Promise<ICapabilityEnableResult>;
  enableResult(name: string): Promise<ICapabilityEnableResult>;
  disable(name: string): Promise<boolean>;
  dispose(): Promise<void>;
  enableLegacyBoolean(name: string): Promise<boolean>;
  disableNow(name: string): boolean;
  readonly disposed: boolean;
};
```

#### `register(definition)`

登记一个能力定义。同名重复登记抛出携带 `code: 'ALREADY_REGISTERED'` 的错误；`name` 非字符串或空字符串抛出 `code: 'INVALID_NAME'` 的 `TypeError`；`activate` 非函数抛出 `code: 'INVALID_ACTIVATE'` 的 `TypeError`。登记时会对 `definition` 做一次快照——冻结 `{ name, activate }` 并保留方法风格调用时 `this.name` 的可用性，之后调用方再修改原始 `definition` 对象不会影响已登记的身份。`disposed` 为 `true` 时调用抛出 `HOST_DISPOSED`；处于重入事务窗口内调用抛出 `HOST_TRANSITIONING`。

#### `names`（只读属性）

当前已登记的全部能力名字数组，每次读取都是当前登记表的快照拷贝。无参数。

#### `state(name)`

查询状态。未注册的名字抛出 `code: 'NOT_REGISTERED'` 的错误。返回值见[状态机](#状态机)一节。`disposed` 后仍可用（只读诊断方法不受终态门禁限制）。

#### `handle<Handle>(name)`

已启用能力的 handle；未启用（`off`/`gated`/`activating`/`failed`）返回 `undefined`。未注册抛 `NOT_REGISTERED`。`disposed` 后仍可用。

#### `error(name)`

上一次激活或释放失败的原因；成功重启或重新配置（例如 `setFlag(name, false)` 之后再打开并成功激活）会清除。未注册抛 `NOT_REGISTERED`。`disposed` 后仍可用，用于观测最终落点。

#### `setFlag(name, enabled)`

更新单个开关。`enabled` 必须严格等于 `true` 才视为允许（不接受 truthy，只接受严格 `true`）；关闭会同步作废在途激活并释放现有 handle。`disposed` 抛 `HOST_DISPOSED`；重入窗口内调用抛 `HOST_TRANSITIONING`。

#### `setFlags(flags)`

原子替换整份开关快照，细节见[宿主创建与开关快照](#宿主创建与开关快照)。`disposed` 抛 `HOST_DISPOSED`；重入窗口内调用抛 `HOST_TRANSITIONING`；`flags` 本身读取失败会先 fail-closed 到空快照再重新抛出原始错误（包装为 `INVALID_OPTION`）。

#### `enable(name)` / `enableResult(name)`

幂等启用：并发调用共享同一次 `activate()`（内部靠同一个 `pending` Promise 实现）。开关为假时直接返回 `{ status: 'gated' }`，不会"偷偷打开"，也不会调用 `activate()`。`enableResult` 是 `enable` 的别名，语义完全一致（`enableResult(name) { return this.enable(name); }`）。未注册抛 `NOT_REGISTERED`（同步抛出会被转换成 rejected Promise）；`disposed` 时返回值为 rejected Promise，错误信息为 `'capability host is disposed'`；重入窗口内调用同样返回携带 `HOST_TRANSITIONING` 的 rejected Promise（`enable` 是 async 语义，不会同步抛错）。

#### `disable(name)`

关闭并等待 handle 的 `dispose()`（含异步）真正完成后再 resolve；返回是否确实关掉了一个此前处于启用/在途状态的能力。`disposed` 优先级高于 `NOT_REGISTERED`——host 已释放时优先抛 `HOST_DISPOSED`，其次才做 name 查找。内部用"循环直到稳定"等待与该能力相关的在途激活和在途释放都清零，见[释放顺序与依赖](#释放顺序与依赖)。

#### `dispose()`

唯一异步释放入口：首次调用按真实激活顺序反向（LIFO）关闭全部能力并等待全部释放工作结束；完成前的重复调用（包括 disposer 内部的重入调用）立即以 `HOST_TRANSITIONING` 拒绝，完成后才恢复为返回同一个 canonical Promise（幂等）。这是显式的 breaking behavior：旧行为会让进行中的重复调用共享首个 Promise；新行为要求外部并发调用方保留并等待首个 Promise，避免 disposer-origin 调用把自己卡在自等待循环里。

#### `enableLegacyBoolean(name)`

同步/布尔风格兼容适配器，语义与 `enable()` 完全共享同一份内部实现和同一个 `pending` Promise——并发对同一名字调用 `enable()` 和 `enableLegacyBoolean()`，实际只会跑一次 `activate()`。只返回布尔值，用于接入尚未迁移到结构化结果的旧调用点。

#### `disableNow(name)`

同步版本：立即触发关闭和释放，但**不等待**异步 `dispose()` 完成即返回。确定要等清理完成用 `disable()`。`disposed` 抛 `HOST_DISPOSED`；重入窗口内调用抛 `HOST_TRANSITIONING`；未注册抛 `NOT_REGISTERED`。

#### `disposed`（只读属性）

host 是否已经整体关闭；`true` 之后所有变更类方法（`register`/`setFlag`/`setFlags`/`enable`/`enableResult`/`disable`/`enableLegacyBoolean`/`disableNow`）都会抛错或拒绝，只读诊断方法（`names`/`state`/`handle`/`error`）仍然可用。

---

<a id="generation-races"></a>

## Generation：竞态与作废的激活

每个已登记的能力内部持有一个来自 `@migaia/lifecycle` 的 `generationController`，其 `generation` 计数器在每次 `setFlag(false)`、`setFlags()` 使某能力被拒绝、或 `dispose()` 整体关闭时递增（`supersede()`/`dispose()`）。

异步 `activate()` 完成时，`generationController.adopt(token, handle, releaseFn)` 会比较"发起时的 generation"和"当前 generation"：

- 一致 → 正常提交，`state` 变为 `on`，handle 生效，进入 `activationOrder`。
- 不一致（说明激活过程中开关被关掉了，或 host 已被 `dispose()`）→ **不采纳这个结果**，`adopt()` 立即调用释放回调把刚创建出的 handle 就地释放；对外表现为 `enable()`/`enableLegacyBoolean()` 返回 `false`/`{ status: 'cancelled' }`。

这就是"关闭一个能力"和裸的动态 `import()` 之间的本质区别：没有这层保护，一个正在加载的 chunk 完成后会直接把开关"偷偷"打开，用户看到的是"明明关了，过几百毫秒又自己回来了"。

**LIFO 释放顺序按的是真实激活完成顺序（`activationOrder` 数组的推入顺序），不是注册顺序，也不是调用 `enable()` 的顺序**——三者在并发激活下会分叉。比如先后调用 `enable('A')`、`enable('B')`，如果 B 的 `activate()` 先 resolve（比如没有 I/O），它会先进入 `activationOrder`，回退时反而先于 A 释放。这本身没问题：真正互相依赖的两个能力，调用方必须自己 `await enable('A')` 完成后再 `enable('B')`——这样 A 保证先进入顺序表，"后进先出"就自然等价于"先释放依赖 A 的 B，再释放 A"。

本包**不提供** `dependsOn` 声明，也不会把所有 `activate()` 调用强制串行化——一个被 `setFlag(false)` 废弃、永不 settle 的 `activate()` 会连带卡死排在它后面的每一个 `enable()`。需要严格顺序保证的调用方必须显式 `await`，host 不会替你保证。

---

<a id="释放顺序与依赖"></a>

## 释放顺序与依赖

- `dispose()` 按**真实激活完成顺序**反向（LIFO）释放，具体规则见上一节。
- `setFlags()` 替换快照导致的批量回退，同样按这个顺序释放（先按 `activationOrder` 逆序处理已激活条目，再处理其余尚在激活/失败/未启用的条目）；`disable(name)` 只影响单个条目，不触碰其余能力在顺序表里的位置。
- 单个能力释放失败（`dispose()` 抛错或拒绝）不会阻断其余能力继续关闭——LIFO 回退路径必须能走完，一个失败不能连累其它已启用能力泄漏；清理结束后 `disposed`/`state` 必须收敛，不残留 `activating`/`on` 假状态。释放失败原因会记到对应 entry 的 `error`（前提是代数仍然匹配，或匹配"下一代且当前处于非活跃、无替换"状态），并通过 `onError` 上报。
- `dispose()` 之后 `disposed` 变为 `true`，host 永久不可用：`register`/`setFlag`/`setFlags` 直接抛错，`enable` 类方法返回被拒绝的 Promise（错误信息 `'capability host is disposed'`）。不要把同一个 host 复用给下一次请求或下一个租户，需要新的一轮应该创建新的 host。
- `disable()`/`dispose()` 内部用"循环直到稳定"的方式等待清理完成：因为一次释放本身可能在等待期间又产生新的、此前快照里不存在的释放任务（比如一个仍在进行中的激活，在同步清理跑完之后才拿到 handle，随即需要被就地释放），单次 `await` 可能错过这类"迟到"的清理工作。`disable()` 只针对该能力对应的排空计数循环等待；`dispose()` 针对全局排空计数循环等待，两者共用同一个 `QuiescenceTracker`，激活与释放两类在途 Promise 合并计一个维度。

---

<a id="错误码与错误结构"></a>

## 错误码与错误结构

```ts
type ICapabilityError = Error & { readonly source: string; readonly code: string };
function createCapabilityError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown }
): ICapabilityError;
function tagCapabilityError<E extends Error>(error: E, code: string): E;
const CAPABILITY_SOURCE = '@migaia/capability';
```

本包统一使用结构化错误契约：错误以属性形式携带 `source`（恒为 `CAPABILITY_SOURCE`）与 `code`，从不替换错误本身——依赖 `instanceof TypeError`/`RangeError` 等类型判断的调用方不受影响。`createCapabilityError` 构造一个携带 `(source, code)` 的普通 `Error`；`tagCapabilityError` 给已构造好的错误（如 `TypeError`）就地补上 `(source, code)`，不改变其类型——这是 `INVALID_NAME`/`INVALID_ACTIVATE`/`INVALID_HANDLE` 必须保持抛出值仍是 `TypeError` 的原因。两者内部都基于 `@migaia/utils/error` 的 `attachErrorIdentity` 实现，同名身份字段已存在且值不同会抛 `TypeError`；值相同视为幂等。

```ts
const CapabilityErrorCode = {
  hostDisposed: 'HOST_DISPOSED',
  hostTransitioning: 'HOST_TRANSITIONING',
  notRegistered: 'NOT_REGISTERED',
  alreadyRegistered: 'ALREADY_REGISTERED',
  invalidName: 'INVALID_NAME',
  invalidActivate: 'INVALID_ACTIVATE',
  invalidHandle: 'INVALID_HANDLE',
  gated: 'GATED',
  invalidOption: 'INVALID_OPTION'
} as const;
type ICapabilityErrorCode = (typeof CapabilityErrorCode)[keyof typeof CapabilityErrorCode];
```

码值是公开 API 的一部分，改名等同破坏性变更。逐条含义与触发点：

| 码                                          | 触发点                                                                                                                                                                            | 抛出类型                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `hostDisposed`（`HOST_DISPOSED`）           | 在已 `dispose()` 的 host 上调用**变更方法**（`register`/`setFlag`/`setFlags`/`enable`/`disable` 等）                                                                              | `Error`                                    |
| `hostTransitioning`（`HOST_TRANSITIONING`） | 在某个 disposer/reporter 的重入窗口内（`transitionDepth > 0`）尝试变更方法，或在首次 `dispose()` 完成前再次调用 `dispose()`                                                       | `Error`                                    |
| `notRegistered`（`NOT_REGISTERED`）         | `state`/`handle`/`error`/`enable`/`disable` 等按名字查询/操作一个从未 `register()` 过的能力                                                                                       | `Error`                                    |
| `alreadyRegistered`（`ALREADY_REGISTERED`） | `register()` 传入的 `name` 已经登记过                                                                                                                                             | `Error`                                    |
| `invalidName`（`INVALID_NAME`）             | `register()` 传入的 `name` 不是非空字符串                                                                                                                                         | `TypeError`                                |
| `invalidActivate`（`INVALID_ACTIVATE`）     | `register()` 传入的 `activate` 不是函数                                                                                                                                           | `TypeError`                                |
| `invalidHandle`（`INVALID_HANDLE`）         | `activate()` 的返回值缺少可调用的 `dispose`                                                                                                                                       | `TypeError`                                |
| `gated`（`GATED`）                          | 当前没有抛出点——`enable()`/`enableResult()` 用 `{ status: 'gated' }` 结构化返回表达拒绝，从不抛错；保留给未来诊断/事件通道                                                        | —                                          |
| `invalidOption`（`INVALID_OPTION`）         | `flags`/`definition`/`options` 快照时宿主对象（如 hostile Proxy）的 `ownKeys`/`getOwnPropertyDescriptor`/getter 抛错，或 `options` 本身不是对象/函数，或 `onError` 提供但不是函数 | `TypeError` 或 `Error`（视具体校验点而定） |

`INVALID_OPTION` 场景下，fail-closed 之后才抛出，原始 Proxy 异常经 `cause` 保持 `===` 可达；调用方应修复传入的 `flags`/`definition` 对象，不要对同一份 hostile 输入重试。

`options.onError?.(name, error)` 会在以下场景被调用，且**永远不会**反过来影响能力的生命周期状态（即便 `onError` 自己抛错或返回被拒绝的 Promise，也会被 host 自己兜住，不会向上冒泡）：

- 激活失败（`activate()` 抛错或返回无效 handle）。
- 已有 handle 的 `dispose()` 抛错或返回的 Promise 被拒绝——包括"过期代数"的清理失败：一个已经被替换掉的旧 handle 在后台迟迟才完成清理并失败，这类失败仍会上报，但**不会**污染当前正在使用的新一代 handle 的状态。
- 一个手写的、非标准 `then` 实现（比如跨 iframe/VM 的 thenable，或者 `then` 是一个会抛错的 getter）在被当作 Promise 处理时出错，也会被安全地转换成一次 `onError` 调用，不会变成未处理的 rejection。

`error(name)` 返回的是**当前这一代**的失败原因；只要该能力后续成功重新激活，或被显式重新配置（比如 `setFlag(name, false)` 之后再打开），`error(name)` 就会被清空。

---

<a id="重入与并发保护"></a>

## 重入与并发保护

- **变更类方法之间互斥**：`register`/`setFlag`/`setFlags`/`disableNow`（以及 `disable`/`dispose` 触发的同步阶段）内部通过一个"事务深度"计数器（`transitionDepth`）互相保护——在这些方法内部（例如一个能力自己的 `dispose()` 回调）再去调用任何一个变更方法，会立即抛出携带 `code: 'HOST_TRANSITIONING'` 的错误。这防止了"回退过程中被自己的清理逻辑打乱开关快照"这类难以复现的 bug。
- `enable()`/`enableResult()`/`enableLegacyBoolean()` 在重入时不会同步抛错（它们是 async 语义），而是返回一个带 `HOST_TRANSITIONING` 的被拒绝 Promise。
- disposer 在同步释放阶段调用同一 host 的 `dispose()` 时，立即同步抛出带 `HOST_TRANSITIONING` 的错误；调用延迟到当前栈之后（首次 `dispose()` completion 尚未 settle）时，也立即返回带 `HOST_TRANSITIONING` 的 rejected Promise。这是显式的行为约定：旧实现让所有进行中的调用复用首个 Promise；当前实现禁止任何进行中的重复调用加入该 Promise，避免 disposer 自等待死锁。
- 外部并发调用方必须保留并等待首次 `dispose()` 返回的 Promise；首次 Promise 完成（`disposeCompleted === true`）后，重复 `dispose()` 才返回同一个已完成的 canonical Promise。不要用第二次调用来"加入"正在进行的释放。
- `dispose()`/`disable()` 内部用"循环直到稳定"的方式等待清理完成，具体机制见[释放顺序与依赖](#释放顺序与依赖)一节末段。

---

<a id="组合工作流示例"></a>

## 组合工作流示例：懒加载 + 错误上报 + 优雅收尾

```ts
import { createCapabilityHost, CapabilityEnableStatus } from '@migaia/capability';

const capabilities = createCapabilityHost(
  { store },
  {
    flags: { persistence: true },
    onError: (name, error) => reportError(name, error)
  }
);

capabilities.register({
  name: 'persistence',
  async activate({ store }) {
    const { persist, memoryStorage } = await import('@migaia/store-persist');
    const handle = persist(store, { key: 'settings', storage: memoryStorage() });
    return { dispose: () => handle.dispose() };
  }
});

const result = await capabilities.enable('persistence');
if (result.status === CapabilityEnableStatus.enabled) console.log('持久化已启用');

await capabilities.disable('persistence');
await capabilities.dispose(); // LIFO 释放全部已启用能力，之后 host 不可再用
```

`createCapabilityHost()` 建立开关表快照与状态机；`activate()` 内部的 `await import()` 保证关着的能力不进初始包；`onError` 只做诊断上报，从不反向影响生命周期；`dispose()` 是唯一的整体收尾入口，按真实激活顺序反向释放并等待全部清理完成。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

**`enable()` 返回 `{ status: 'gated' }`，但确实在 `flags` 里传了 `true`。**
检查是不是在 `createCapabilityHost()` 之后又修改了传入的原始 `flags` 对象——host 只在创建时复制一份快照，之后必须调用 `setFlag()`/`setFlags()` 才会生效。另外确认值是严格的布尔 `true`，字符串 `'true'` 或数字 `1` 都不算允许。

**关掉一个能力之后，过了一会儿它又自动变成 `on` 了。**
正常情况下不应该发生——这正是 [Generation 机制](#generation-races)要防止的竞态。如果观察到这个现象，检查是否绕过了 host 直接持有并调用了 `activate()` 的返回值，或者在能力的 `dispose()` 里手动调用了 `enable()`（这类重入会被[重入与并发保护](#重入与并发保护)描述的机制直接拒绝，确认没有捕获这个拒绝并静默重试）。

**`disableNow()` 之后资源好像还没释放干净。**
`disableNow()` 是同步兼容接口，只是**触发**了释放，不等待异步清理完成。如果 handle 的 `dispose()` 是异步的，需要用 `disable()`/`dispose()` 的 Promise 版本并 `await`。

**`setFlags({})` 之后所有能力都被关掉了，但只想改一个。**
`setFlags()` 是整份快照的原子替换，不是"打补丁"。只想改一个开关用 `setFlag(name, enabled)`；确实要批量替换，记得把所有仍需保留的能力都显式列进新快照。

**需要能力之间的依赖顺序，让 host 自动按顺序启停。**
本包不提供，见 [Generation 一节](#generation-races)末尾的说明。有依赖关系的能力，调用方自己 `await enable('A')` 完成后再 `enable('B')` 即可获得正确的启停顺序；`dispose()`/`setFlags()` 触发的批量回退会按真实激活完成顺序自动 LIFO。

**在 `dispose()` 完成前又调用了一次 `dispose()`，收到 `HOST_TRANSITIONING`。**
这是预期行为：首次调用发布的 completion Promise 尚未 settle 时，任何重复调用（包括 disposer 内部的延迟重入）都会立即被拒绝，避免自等待死锁。保留并 `await` 首次调用返回的 Promise，不要发起第二次调用。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
