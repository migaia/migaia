# 错误码契约（全仓，规范性）

> 本文是全仓错误码的**唯一权威注册表**。任何包新增、改名、删除错误码都必须先改本文。
> 约束性摘要见根目录 `AGENTS.md` 的 `Error Code Contract` 一节；本文是它的完整定义。

## 1. 原则

**每一个离开包边界的错误都必须携带唯一语义码，并且必须能追溯到最初的抛出点。**

这不是可选的诊断增强。四条硬要求：

1. **唯一语义** —— 全仓任意错误可由 `(source, code)` 二元组唯一定位到本文的一行。
2. **码即契约** —— 码是公开 API 的一部分。改码等同破坏性变更，走版本流程。
3. **原因可达** —— 包装错误不得让原始错误脱离 `cause` 链；原始 `stack` 必须始终可取。
4. **跨界不丢** —— 穿过 Worker / RPC / 序列化边界时，`(source, code)`、`message`、`stack`、整条 `cause` 链必须完整送达对端。

## 2. 结构契约

```ts
/** 全仓错误的最小结构。任何 throw 出包边界的值都必须满足它。 */
type IMigaiaError = Error & {
  /** 发出方包名，如 '@migaia/lifecycle'。 */
  readonly source: string;
  /** SCREAMING_SNAKE。同一 source 内唯一。 */
  readonly code: string;
  /** 触发阶段，用于区分同码不同上下文：'close' | 'graceful' | 'force' | 'custom' | 'rollback' | 'admission' | 'setup' | … */
  readonly phase?: string;
  /** 结构化诊断数据。禁止放入凭据、令牌、用户数据。 */
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
};
```

### 2.1 为什么是 `(source, code)` 二元组而不是全局前缀

`@migaia/plugin-host` 已有一组历史裸码（`PLUGIN_INSTALL_FAILED` 等）被既有 UT 直接断言。加全局前缀会破坏这些断言，与「既有 UT 原样通过」的迁移口径冲突。二元组让既有码原样保留，同时消除跨包重名歧义。

跨包重名是**允许**的，但必须语义可区分。例如 `@migaia/tray` 的 `TRAY_CROSS_RUNTIME`（能力图 registry 层）与 `@migaia/reactive` 的 `CROSS_RUNTIME`（响应式图节点层）是两层的不同检查，诊断信息必须能区分。

### 2.2 码不替换错误类型

码以**附加属性**形式挂载，不改变错误的运行时类型。理由：调用方常按类型判定。

| 场景 | 处理 |
| --- | --- |
| `DOMException('AbortError')` | 保持 `DOMException` 且 `name === 'AbortError'`，`source`/`code` 作为属性附加 |
| `RangeError` / `TypeError` | 保持原类型，附加属性 |
| `AggregateError` | 保持原类型，`errors[]` 是合法的 cause 可达路径 |

用 `Object.defineProperty(err, 'code', { value, enumerable: true })` 挂载，不重建对象、不丢 `stack`。

## 3. 可追溯性要求

### 3.1 stack 必须存在且不被覆盖

- 每个抛出物必须有非空 `stack`。构造后不得重新赋值 `stack`。
- 包装时**不得**用新错误的 stack 顶替原始 stack —— 原始 stack 通过 `cause` 链保留。

### 3.2 cause 链可达性

包装后的错误必须能在**有限步内**沿 `cause` 取到 `=== originalError` 的那一个。遍历规则：

```
reach(e):
  yield e
  if e.cause          → reach(e.cause)
  if e instanceof AggregateError → for each x of e.errors: reach(x)
```

`AggregateError.errors[]` 与 `cause` 同等算作可达路径。因此下列两种形态**都合法**，无需统一：

| 形态 | 例 |
| --- | --- |
| 原样重抛（链长 0） | `store-wasm/array.ts` 的 `throw error` |
| 顶层码改写、原错误在 `cause.errors[0]` | 形态上仍合法；`plugin-host` 的 `PLUGIN_INSTALL_ROLLBACK_FAILED` 已按 `migration.sdd.md` §5.2（M-T44）改为「原始错误保持 primary、回滚失败仅作诊断」，不再属于本例 |

**顶层码允许被领域改写**，只要原始错误仍在链上且排在首位。

### 3.3 异步边界

- `await` / `.then` 链中的包装同样受 §3.2 约束。
- 任何 `catch` 后不再重抛的路径必须显式 `report`，不得静默吞掉 —— 静默吞掉等于切断可追溯性。
- 超时**降级**（`graceful` 超时进 `force`）不是错误，只发诊断事件，不进码表。

### 3.4 跨 realm 边界（Worker / RPC / 持久化）

`Error` 无法结构化克隆保留原型。穿越边界时必须序列化为：

```ts
type ISerializedError = {
  readonly source: string;
  readonly code: string;
  readonly name: string;      // 原始构造器名，用于对端复原 AbortError 等判定
  readonly message: string;
  readonly stack?: string;    // 对端必须原样保留，不得重写
  readonly phase?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly causes?: readonly ISerializedError[];  // 展平的 cause 链 + AggregateError.errors
};
```

对端复原时：`name` 用于恢复类型判定（如 `AbortError`），`stack` 原样附加并标注来源 realm。**禁止**在对端重新生成 stack。

### 3.5 每包必须维护 `src/error-code.ts`

**每个包必须有且仅有一个 `packages/<pkg>/src/error-code.ts`，作为该包错误码在代码中的唯一声明处。**

- 禁止在抛出点内联字面量码，禁止把码分散在多个模块。
- 尚无错误的包也要建文件，写空常量并注明原因（防止后来者随手内联）。
- 形状遵循 `AGENTS.md` 的 enum-like 约定：一个常量对象 + 一个**值**联合（错误码的 key 是 camelCase、value 是 SCREAMING_SNAKE，比较时用的是 value，因此取值联合而非键联合）。常量/类型对共用一个名字空间，常量名不加 `I` 前缀，类型名加。

```ts
// packages/lifecycle/src/error-code.ts

/** `@migaia/lifecycle` 的错误码。(source, code) 中的 source 恒为 '@migaia/lifecycle'。 */
export const LifecycleErrorCode = {
  /**
   * `close()` 之后调用 `own()` / `retain()` 时抛出。
   * 容器已停止接受新工作；调用方应新建 scope，而不是复用这个。
   * 落实 §4.1 的两阶段契约：close 是同步的、不可失败的、不调用用户代码的状态变更。
   */
  scopeClosed: 'SCOPE_CLOSED',

  /**
   * disposer 内部重入本 scope 的 `dispose()` 时抛出。
   * 错误归属到引发重入的那个 disposer，其余资源照常释放完毕。
   * 落实 §4.1 的重入守卫；调用方应把清理逻辑移出 disposer。
   */
  scopeReentrantDispose: 'SCOPE_REENTRANT_DISPOSE'
} as const

export type ILifecycleErrorCode = (typeof LifecycleErrorCode)[keyof typeof LifecycleErrorCode]
```

### 3.5.1 JSDoc 必须写什么

每条码的 JSDoc 至少覆盖三件事，缺一不可：

1. **触发场景** —— 什么状态或输入会走到这里（不是复述码名）。
2. **契约来源** —— 它在落实哪一条设计条款（引 SDD 章节号）。
3. **调用方动作** —— 拿到这个错误该做什么（重试？换路径？改配置？不可恢复？）。

反例：`/** 作用域已关闭。 */` —— 复述码名，零信息。

### 3.5.2 现状与迁移

| 包 | 现状 | 动作 |
| --- | --- | --- |
| `plugin-host` | `src/error-code.ts` 已为单点码表，`typing.ts` 与公共入口 re-export；逐条 JSDoc、source/code 测试和 24 值表已落地 | 保持 **24 个码值不变**；继续以 `src/error-code.ts` 为权威声明处，`typing.ts` 仅为兼容 re-export |
| `storage-web` | `StorageErrorCode` 在 `src/types/errors.ts` | `error-code-rollout.sdd.md` §4.1 搬到 `src/error-code.ts`，19 个码值保留（后由 `storage-web-integration.sdd.md` 拆分：5 契约级码迁 `@migaia/storage-contract`，落为 15 码，见 §4） |
| `web-rpc` | 已有 `WebRpcErrorCode`（38 码）在 `src/errors.ts` + 12 个错误类 | `error-code-rollout.sdd.md` §4.1 搬到 `src/error-code.ts`，码值保留 |
| 其余 14 个包 | 见 `error-code-rollout.sdd.md` §2 分档 | `error-code-rollout.sdd.md` §4.2～§4.4；建文件先于第一次使用 |

## 4. 注册表

`(source, code)` 全仓唯一。下表按包索引；已定案的码表在对应 SDD 中维护，本文是索引与状态跟踪。

状态取值：**待定案** → **已定案**（码表在 SDD 中确定）→ **已实施**（`src/error-code.ts` 落地、抛出点全部引用常量、有 UT 钉住每个码的触发点）。

| source | 码数 | 权威定义位置 | 状态 |
| --- | --- | --- | --- |
| `@migaia/lifecycle` | 21 | `docs/lifecycle/lifecycle-extraction.sdd.md` §4.10.2 | **已实施**（`packages/lifecycle/src/error-code.ts`；L-T41；补登记 `ENV_UNSUPPORTED`/`INVALID_OPTION`/`ABORT_LISTENER_FAILED`/`GENERATION_CANCELLATION_FAILED`，runtime-neutrality.sdd.md R-9/T-16） |
| `@migaia/reactive` | 16 | `docs/lifecycle/migration.sdd.md` §5.2 | **已实施**（`packages/reactive/src/error-code.ts`；M-T36 / M-T41） |
| `@migaia/resource` | 8 | `docs/lifecycle/migration.sdd.md` §5.2 | **已实施**（`packages/resource/src/error-code.ts`；M-T37 / M-T41；补登记 `SUSPENSE_PROBE_FAILED`/`CANCELLATION_CLEANUP_FAILED`） |
| `@migaia/capability` | 9 | `docs/lifecycle/migration.sdd.md` §5.2 | **已实施**（`packages/capability/src/error-code.ts`；M-T41；补登记 `INVALID_OPTION`） |
| `@migaia/plugin-host` | 24 | `docs/lifecycle/migration.sdd.md` §5.2 | **已实施**（`packages/plugin-host/src/error-code.ts` 声明 24 个值并由 `typing.ts`/公共入口 re-export；`test/error-code-docs.test.ts` 遍历全部导出码并断言 `(source, code)`，包测试覆盖实际错误路径；新增 `INVALID_OPTION`/`PIPELINE_FAILED`，落实 §7 裸抛扫描门禁） |
| `@migaia/middleware-pipeline` | 1 | `docs/middleware-pipeline/middleware-pipeline.sdd.md` MP-R08 | **已实施**（默认双失败 `AggregateError` 使用 `EXECUTION_FAILED`；host 可注入自己的组合策略） |
| `@migaia/event-subscriber` | 12 | `docs/event-subscriber/event-subscriber.sdd.md` §4.7 | **已验证**（ES-E-01～ES-E-12；`src/error-code.ts` 与抛出点已接线，包级 55 tests、直接消费者与仓库门禁通过） |
| `@migaia/capability/graph` | 9 | `docs/tray/tray.sdd.md` §6.4.1 | 已定案 |
| `@migaia/tray` | 5 | `docs/tray/tray.sdd.md` §6.4.2 | 已定案 |
| `@migaia/logger` | 14 | `error-code-rollout.sdd.md` §4.3 | **已实施**（`src/error-code.ts` + `packages/logger/test/error-code.test.ts` LG-T16/LG-T26 逐码覆盖真实触发的 native type/source/code/cause 或 `AggregateError.errors`；`HOOK_FAILED` 由真实 reporter diagnostic 覆盖；卸载与 shutdown cleanup 使用独立码） |
| `@migaia/serialize` | 8 | `error-code-rollout.sdd.md` §4.2 | **已实施**（`source` 改名 `context` 让位契约；`PARSER_DISPOSE_FAILED` 移除，委托 lifecycle `SCOPE_DISPOSAL_FAILED`；补登记 `ENV_UNSUPPORTED`，runtime-neutrality.sdd.md R-4） |
| `@migaia/storage-contract` | 5 | `docs/store-persist/storage-web-integration.sdd.md` §4.2 | 已实施（新建包；契约级码 `INVALID_ARGUMENT` / `INVALID_KEY` / `UNSUPPORTED_CAPABILITY` / `STORE_DISPOSED` / `ABORTED`，从 storage-web 迁入） |
| `@migaia/storage-web` | 15 | `docs/store-persist/storage-web-integration.sdd.md` §4.2 + `error-code-rollout.sdd.md` §4.1 | 已实施（原 19 码已实施；拆分后落为 15 码 = 14 保留 + 新增 `INVALID_CONFIG`，5 契约级码迁 `@migaia/storage-contract`） |
| `@migaia/web-rpc` | 38 | `error-code-rollout.sdd.md` §4.1 | **已实施**（`src/error-code.ts` 搬迁 + 12 错误类 `source`；E-T1/E-T2/E-T3/E-T4；补登记 `PLUGIN_INSTALL_FAILED`/`PROVIDER_NOT_FOUND`，`IWebRpcError.code` 收紧为 `IWebRpcErrorCode`，`WebRpcRemoteError` 保留 `code:string`） |
| `@migaia/wasm` | 0 | `error-code-rollout.sdd.md` §4.4 | **已实施**（空表 `src/error-code.ts`） |
| `@migaia/store-light` | 12 | `error-code-rollout.sdd.md` §4.3 | **已实施**（`src/error-code.ts` + 抛出点接线；含补登记 `STORE_NOT_READY`） |
| `@migaia/store-keyed` | 11 | `error-code-rollout.sdd.md` §4.3 | **已实施**（含补登记 `INVALID_OPTION`） |
| `@migaia/store-indexed` | 4 | `error-code-rollout.sdd.md` §4.3 | **已实施** |
| `@migaia/store-shared` | 7 | `error-code-rollout.sdd.md` §4.3 | **已实施** |
| `@migaia/store-middleware` | 6 | `error-code-rollout.sdd.md` §4.3 | **已实施**（含诊断码 `MIDDLEWARE_NOT_CHAINED`、清理聚合码 `CLEANUP_FAILED`） |
| `@migaia/store-persist` | 8 | `error-code-rollout.sdd.md` §4.3 | **已实施** |
| `@migaia/store-react` | 9 | `error-code-rollout.sdd.md` §4.3 | **已实施** |
| `@migaia/store-ssr` | 12 | `error-code-rollout.sdd.md` §4.3 | **已实施**（含 `RESOURCE_TIMEOUT`、`CROSS_RUNTIME`/`CODEC_CONTRACT`/`RESOURCE_ROUND_LIMIT`） |
| `@migaia/store-worker` | 6 | `error-code-rollout.sdd.md` §4.3 | **已实施**（复用 `SerializeError`，`source`/`code` 覆盖为 store-worker 自身；含 `CLEANUP_FAILED`） |
| `@migaia/store-wasm` | 7 | `error-code-rollout.sdd.md` §4.3 | **已实施**（补登记多资源释放聚合码 `CLEANUP_FAILED`） |
| `@migaia/store-devtools` | 4 | `error-code-rollout.sdd.md` §4.3 | **已实施** |

**待定案的包**：新代码必须遵守 §2/§3 的结构与可追溯性契约，码先在本表登记再使用；不得等 `error-code-rollout.sdd.md` 落地才开始遵守。

## 5. 什么不是错误码

| 不是码 | 是什么 | 归属 |
| --- | --- | --- |
| `blocked` / `failed` / `ready` | `IAvailability` 状态 | `tray.sdd.md` §4.2 |
| `gated` | capability 闸门状态，`enable()` 返回值而非抛出物 | `migration.sdd.md` §5.2 |
| `graceful` 超时进 `force` | 正常降级路径 | 诊断事件 |
| 入队等待诊断（未配置拒绝阈值时） | 可观测性事件 | 诊断事件 |
| `open` / `closing` / `terminal` | 容器存活态 | `lifecycle-extraction.sdd.md` §4.2 |

状态不是失败。把状态抛成错误会让调用方无法区分「尚未就绪」与「出错了」。

## 6. 新增码的流程

1. 在本文 §4 对应包的权威定义位置加一行：码、触发条件、关联条款。
2. 在该包 `src/error-code.ts` 加常量项，附 §3.5.1 要求的三段式 JSDoc。
3. 确认 `(source, code)` 在该 source 内唯一。
4. 补一个先失败后通过的用例，断言该码在其条款场景下被精确抛出，且 `cause` 链满足 §3.2。
5. 若该码会穿越 realm 边界，补 §3.4 的序列化/复原往返用例。

**禁止**：先写 `throw new Error('...')` 再补码；先加码再补用例；在抛出点内联码字面量。

## 7. 门禁

| 门禁 | 检查 |
| --- | --- |
| 裸抛扫描 | `src/` 中不得出现未携带 `(source, code)` 的 `throw new Error(` / `throw new TypeError(` / `throw new RangeError(`。以 lint 规则落地 |
| `error-code.ts` 存在性 | 每个 `packages/*/src/` 下必须有 `error-code.ts`；无错误的包也必须有空常量 + 说明 |
| 码只在一处声明 | 码字面量只允许出现在 `error-code.ts`；抛出点必须引用常量，不得内联字符串 |
| JSDoc 完整性 | `error-code.ts` 每个常量项都有 JSDoc，且覆盖触发场景 / 契约来源 / 调用方动作三段（§3.5.1） |
| 唯一性 | 构建期校验 `(source, code)` 无重复；同 source 内重名直接失败 |
| 注册一致 | 代码中出现的每个码都能在本文 §4 索引到的权威表中找到；反之权威表中的每个码都有至少一个抛出点或明确标注为「仅诊断」 |
| cause 可达 | 包装路径的用例断言 `reach(wrapped)` 能取到 `=== originalError` |
| stack 非空 | 抛出物 `stack` 非空且未被重写 |
| 跨界往返 | 序列化 → 反序列化后 `(source, code, name, message, stack, causes)` 与源端一致 |

## 8. 迁移债

| 现状 | 处理 |
| --- | --- |
| `reactive` / `resource` / `capability` 的裸字符串 | 已在 `migration.sdd.md` §5.2～§5.3 归纳成码，随 lifecycle 迁移落地 |
| `storage-web` 的 `StorageErrorCode` | 已有独立体系，`error-code-rollout.sdd.md` 中并入 `(source, code)` 二元组，码名保留；后续按 `storage-web-integration.sdd.md` 拆分为 `@migaia/storage-contract` 5 码 + storage-web 15 码（见 §4） |
| `web-rpc` 的错误类（`WebRpcLifecycleError` 等） | 已有 38 码，搬迁到 `src/error-code.ts` 并收紧 `IWebRpcError.code` 类型 |
| 其余包的裸 `throw new Error('[store] …')` | `error-code-rollout.sdd.md` 统一处理。**在此之前，新增代码不得再产生新的裸抛** |

预先存在的违反属迁移债：在其所属 API 被有意变更时修复，不做无关的大规模改写。
