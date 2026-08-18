# foundation runtime 八包强对抗审计与整改 SDD

- 状态：**verified / complete**（2026-08-18；第三十轮全部 findings 已闭合，八包最终 gates、八环境 consumer typecheck 与 Logger E2E 均通过；dirty-worktree evidence）
- 审计基线：**2026-08-18 当前未提交工作区**；结论只对应当前磁盘内容，不对应某个已提交 SHA；本轮以当前 `git status --short`/`git diff --stat` 结果作为 dirty-worktree baseline
- Owner：foundation runtime maintainers
- 影响包：`@migaia/lifecycle`、`@migaia/reactive`、`@migaia/resource`、`@migaia/capability`、`@migaia/plugin-host`、`@migaia/serialize`、`@migaia/logger`、`@migaia/middleware-pipeline`
- 直接消费者：上述八包的直接调用方；Store 包正在独立重构，不进入本轮写集或门禁
- 前置文档：[`lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)、[`migration.sdd.md`](../lifecycle/migration.sdd.md)、[`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md)、[`error-codes.md`](../contracts/error-codes.md)、[`tray.sdd.md`](../tray/tray.sdd.md)
- 文档性质：**审计 + 整改设计**；本文件不授权直接实现 Tray，也不授权无关重构

## 0. 状态与闭合规则

### 0.1 状态机

每条整改使用：`pending → red → implemented → verified`，失败时可转 `blocked`，明确移出本轮才可转 `deferred`。`deferred` 必须写 owner 与目标 SDD。

本 SDD 只有在以下条件同时成立时才能改为 `approved/complete`：

1. 本文件中**每个声明 confirmed findings 的章节**（包括最新追加的轮次章节）均有对应整改条款；历史/superseded 条款只保留稳定 ID、历史关系与排除理由，不计入 active contract；
2. 每个非 deferred 条款至少映射一个 §7/§12/§16/§30/§31/§32 case；每个 case 至少反向映射一个条款；
3. case 断言文本实际证明条款，不允许仅出现编号；
4. 八包各自完成 `fmt → lint → typecheck → typecheck:test → test`；脚本不存在必须补齐或显式裁定；
5. 直接消费者门禁通过；
6. §8 记录命令、结果、日期、SHA 或 dirty-worktree 基线；
7. HIGH 全部 verified，才允许上层消费者据此升级 foundation runtime 前置状态。

### 0.2 严重度与证据等级

- HIGH：会泄漏资源、破坏状态机/错误身份/时间域，或直接违反已批准 SDD；Tray 实施 blocker。
- MEDIUM：边界输入或失败路径错误，尚不阻断正常 happy path，但必须在本轮修复。
- LOW：可维护性或 API 误用风险；不得冒充正确性缺陷。
- confirmed：当前源码与契约可直接推出，或有最小复现。
- suspected：证据不足；**不得进入整改批次**。本文件不收录 suspected 项。

### 0.3 当前总状态

当前为 `verified / complete`。AF-01～AF-244 的所有 active 条款及其 AF-T cases 由 §47.3～§47.4 的最终串行门禁统一升级为 `verified`；各历史章节内的 `red`/`implemented-unverified` 单元格保留为执行时 chronology，不再代表 current status。AF-60 的笼统闭合声明已被第十三轮源码复核推翻并拆分；历史 red/superseded AF-72 明确排除在 active contract 外，仅作为被 AF-82 取代的历史条款保留。AF-125、AF-137、AF-147 的不可靠 provenance-dedupe 设计由 AF-158 supersede，历史 ID 保留但不计入 active contract。Store 包、Store SDD 与 Store tests 始终排除。

## 1. 目标与范围

### 1.1 目标

1. 对八包当前实现做强对抗：正常路径、hostile input、重入、并发、取消、迟到 settle、部分提交、cleanup 失败、时间域与宿主能力缺失。
2. 找出包内 bug，以及 `lifecycle → reactive/resource/capability/plugin-host/serialize/middleware-pipeline → logger` 链路上的契约断点。
3. 把每个确认问题变成可先红的测试、最小整改边界和可审计证据。
4. 修正文档“complete/verified”与实现事实不一致的状态。

### 1.2 所有权与依赖方向

```text
tray / capability-graph
  ├─> capability ─> lifecycle
  ├─> plugin-host ─> lifecycle
  └─> resource ─────> lifecycle
         └──────────> reactive
```

- `lifecycle`：唯一 scheduler contract、generation、scope、quiescence、dispose transaction owner；零 workspace 依赖。
- `reactive`：同步依赖图与 batch owner；不得复制 lifecycle 的 timer/deadline/resource 状态机。
- `resource`：异步求值、retry、TTL、SWR owner；复用 lifecycle scheduler/generation 与 reactive graph。
- `capability`：feature gate 与 handle lifecycle owner；复用 lifecycle generation/quiescence。
- `plugin-host`：局部插件安装、事务、pipeline、mutation queue 装配 owner；复用 lifecycle queue/scope/scheduler。
- Tray 只消费已验证原语，不在上层补丁式修复底层缺陷。

允许依赖方向：`lifecycle ← capability/plugin-host`、`lifecycle + reactive ← resource`。reactive 当前继续保持 workspace 零依赖；它需要的调度/时钟由 runtime options 注入结构兼容契约。禁止 foundation 包反向依赖 Tray、Store、DOM、Node/Bun 或具体 adapter。

### 1.3 Non-goals

- 不实现 Tray graph、host discovery 或 service reconciliation。
- 不重做五包全部 API。
- 不把消息文案偏好、命名偏好、私有包发布策略当作 bug。
- 不把既有测试标题、注释陈旧但不影响行为的内容升级为正确性缺陷。
- 不处理 Rust、跨语言 ABI 或进程 RPC。

## 2. 现状与问题

### 2.1 审计结论总览

| ID | 严重度 | 包 | confirmed finding | 破坏的现有契约 |
| --- | --- | --- | --- | --- |
| AF-01 | HIGH | lifecycle | `ProvisionalScope.commitTo()` 部分失败后 fire-and-forget rollback，并静默吞 cleanup failure | lifecycle extraction §3、§4.9、L-T11/L-T39；error contract“不得静默吞错” |
| AF-02 | HIGH | lifecycle | `LifecycleUnit.start()` 对 thenable 的 `.then` 读取两次 | lifecycle extraction §3“then 只读一次” |
| AF-03 | MEDIUM | lifecycle | system/manual scheduler 不校验 delay/advance；manual clock 可倒退 | runtime-neutrality R-9/T-16 |
| AF-04 | HIGH | reactive | core 直接使用 `queueMicrotask`、`Date.now`、`performance`、`console.error` | runtime-neutrality §1、R-9；文档错误标记 complete |
| AF-05 | HIGH | reactive | `runBatched()` 直接赋值业务错误的 `cause`；冻结/只读 Error 会抛新 TypeError，覆盖双失败结果 | error-codes §2/§3.2 的原错可达与 attach-not-replace |
| AF-06 | HIGH | resource | retry/TTL 直接用 host timer 与 `Date.now`；timer 缺失时把非零 retry delay 静默降成微任务 | runtime-neutrality §1、R-9 |
| AF-07 | HIGH | resource | SWR refresh 被 `cancel()` 后，成功态永久残留 `refreshing: true`，但 `fetchStatus === 'idle'` | resource 状态一致性；tray §2.2 前置要求 |
| AF-08 | MEDIUM | resource | Suspense throw 的 `.then` getter 抛错被 `asThenable()` 吞掉，原 throw 值被当普通 failure | error-codes“不得静默吞错”；thenable 单次探测语义 |
| AF-09 | MEDIUM | capability | flags/definition 的 Proxy 元操作异常原样越过包边界，无 `(source, code)`；`setFlags` fail-closed 后仍裸抛 | error-codes §2；migration §5.2 |
| AF-10 | HIGH | plugin-host | queue watchdog 和 dispose timeout 写死 5000ms，options 无 scheduler/策略注入 | runtime-neutrality R-7、R-9、T-8；plugin-host error-code JSDoc 自身也声称由调用方配置 |
| AF-11 | MEDIUM | plugin-host | async pipeline 同时发生 stage/downstream failure 时抛包内新建的裸 `AggregateError`，无 `(source, code)` | error-codes §2/§3.2；plugin-host 错误码单点声明门禁 |
| AF-12 | MEDIUM | capability | 包有 `test/tsconfig.json` 与类型测试需求，但无 `typecheck:test` script，无法完成统一门禁 | AGENTS Completion Verification；migration 的逐包门禁 |

### 2.2 AF-01：ProvisionalScope 部分提交失败不是可等待事务

源码证据：`packages/lifecycle/src/provisional-scope.ts:85-122`。`commitTo()` 先把 state 改成 `committed`，逐项调用 `parent.own()`；失败后 `void releaseEntries(leftover).catch(() => {})`，随后立刻抛原错误。

后果：

1. `commitTo()` 返回/抛出时，未转移资源可能仍未释放；调用方无法等待一致状态。
2. cleanup failure 永久丢失；这不是“原错误保持 primary”，而是 secondary 完全不可观测。
3. 注释称“move atomically”，真实语义却是“前缀已转移、后缀异步补偿”。当前 `ILifecycleOwner.own()` 没有 reserve/batch admission，无法实现全量原子转移。

契约引用：[`lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md) §3 的“cleanup 错误不得覆盖原始构造错误”、§4.9 的 commit/rollback 排他与 parent closing 原子检查、L-T11/L-T39。整改必须先裁定“真正原子批量接收”或“显式部分转移 + 可等待补偿”，不能继续让 API 文案承诺原子、实现 fire-and-forget。

### 2.3 AF-02：LifecycleUnit 二次读取 then

源码证据：`packages/lifecycle/src/errors.ts:4-9` 的 `isThenable()` 第一次读取；`packages/lifecycle/src/lifecycle-unit.ts:89-96` 再把原对象交给 `Promise.resolve()`，后者再次读取 `.then`。

状态型/恶意 getter 可在两次读取间返回不同函数或第二次抛错，直接违反 [`lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md) §3“thenable 的 then 只读取一次”。现有 L-T5 只覆盖普通 Promise，没有 hostile getter，因此绿测是假完备。

### 2.4 AF-03：scheduler 契约只写不守

源码证据：`packages/lifecycle/src/scheduler.ts:53-62`、`:90-100`。`schedule()` 接受 `NaN`、`Infinity`、负数；`advance(-1)` 直接令 manual `now()` 倒退。

这违反 [`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md) R-9/T-16 的“delay 有限非负、now 单调不递减”。所有使用 deadline 的包会继承该时间域破坏。

### 2.5 AF-04：reactive 未完成 runtime-neutral

源码证据：

- `packages/reactive/src/runtime/scheduler.class.ts:18-33`：默认 `queueMicrotask` 与 `console.error`；
- `packages/reactive/src/runtime/runtime.class.ts:48-57`、`:84-89`、`:109`、`:156-179`、`:213-214`：`console.error`、`Date.now`、`queueMicrotask`、`performance`；
- `computed/effect/signal/dependency-tracker` 还有同类 `Date.now`。

[`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md) §1 明确把 reactive 列为“不直接调用宿主 API”的 core，R-9 又要求核心只依赖 scheduler contract。该文档目前写 `approved/complete`，与源码相冲突，必须回退为 `in-progress`，不能把 `types: []` 当 runtime-neutral 已完成。

### 2.6 AF-05：冻结 Error 会破坏双错误归属

源码证据：`packages/reactive/src/runtime/scheduler.class.ts:158-195`。业务动作抛 A、flush 再抛 B 时，代码执行 `fnError.cause = ...`。

若 A 被 `Object.freeze()`、`cause` 只读或对象不可扩展，赋值会抛 TypeError；A/B 均不再按约定返回，违反 [`error-codes.md`](../contracts/error-codes.md) 的原始错误身份可达与“attach, do not replace”。现有测试只覆盖可写 `Error` 和非 Error throw 值。

### 2.7 AF-06：resource 有独立时间域且静默降级

源码证据：`packages/resource/src/resource.class.ts:16-30`、`:375-377`、`:499-505`。retry 用自建 host timer，TTL 用 `Date.now()`；无 timer 时任意 delay 都降为下一微任务。

后果：

- retry deadline 与 lifecycle/manual scheduler 不在同一时间域，测试和 SSR 无法确定性推进；
- `retryDelay: 60_000` 在无 timer host 变成近似 0，策略语义被静默改变；
- 直接违反 [`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md) §1、R-9。

### 2.8 AF-07：SWR cancel 产生矛盾状态

源码证据：`packages/resource/src/resource.class.ts:390-404` 把已有 success 改为 `refreshing: true`；`:548-557` 取消时只处理 `pending`，不清 success 的 refreshing 标志。

可观测结果：`cancel()` 后 `fetchStatus === 'idle'`、`refreshing === true`、旧 request 已 supersede 且永不再提交。该状态不会自行恢复，直到显式 refetch/hydrate/dispose。

### 2.9 AF-08：resource 吞 then getter 异常

源码证据：`packages/resource/src/resource.class.ts:105-115` 捕获 getter 异常后返回 `undefined`；`:419-424` 因而把外层 throw 值当普通 fetch failure。getter error 没有 report、cause 或返回路径。

整改需要一次读取并返回判别结果：`not-thenable | thenable(capturedThen) | probe-failed(error)`。禁止把 getter failure 静默改写成另一个错误。

### 2.10 AF-09：capability hostile input 绕过错误码

源码证据：`packages/capability/src/index.ts:178-189` 直接对 flags 执行 `Object.getOwnPropertyDescriptors()`；`:503-513` fail-closed 后重抛原异常；register 读取 `definition.name/activate` 时也允许 Proxy getter 直接抛出。

功能上 fail-closed 成立，但边界错误不带 `source='@migaia/capability'` 与 `INVALID_OPTION`（当前码表还没有对应 flags/definition snapshot failure 的明确码）。这违反 [`error-codes.md`](../contracts/error-codes.md) §2“离开包边界的错误必须有 `(source, code)`”，也使跨 worker/RPC 诊断失去来源。

### 2.11 AF-10：plugin-host 仍硬编码调度策略

源码证据：`packages/plugin-host/src/host-runtime.ts:49-84` 写死 `QUEUE_WATCHDOG_MS = 5000`、`DISPOSE_STEP_TIMEOUT_MS = 5000`，字段初始化时直接 `createMutationQueue(...)`；`packages/plugin-host/src/typing.ts` 的 `IPluginHostOptions` 只有 pipeline/diagnostic。

冲突：

- [`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md) R-7 要求 watchdog 默认策略外置、scheduler 由 lifecycle 注入；T-8 要验证未配置/false/number/单条覆盖。
- `packages/plugin-host/src/error-code.ts` 对 `MUTATION_QUEUE_TIMEOUT` 的 JSDoc 已写“阈值由调用方配置”，实现没有配置入口。

默认 5000ms 会误杀 SSR 冷启动、Worker 启动或调试断点；也让无 timer host 在首次排队时直接失败。

### 2.12 AF-11：async pipeline 双失败缺 package error identity

源码证据：`packages/plugin-host/src/pipeline.ts:112-130`。stage failure 与 downstream failure 同时存在时，包内创建并抛出裸 `AggregateError`；它没有 `source='@migaia/plugin-host'` 与声明于 `src/error-code.ts` 的 code。单边失败原样抛调用方错误是合法的；双失败 aggregate 是 plugin-host 新建的边界错误，必须遵守 [`error-codes.md`](../contracts/error-codes.md) §2/§3.2。

### 2.13 AF-12：capability 验证链缺口

`packages/capability/package.json` 有 fmt/build/typecheck/lint/test，但没有 `typecheck:test`；包内已有 `test/tsconfig.json`。当前统一门禁无法证明测试代码本身类型正确。该项是交付缺陷，不是运行时 bug。

## 3. 架构裁定与依赖方向

### AD-01（pending）：scheduler 只有一个语义 owner

`ILifecycleScheduler` 保持在 lifecycle。resource 必须通过 options/runtime 明确接收同一 scheduler；plugin-host 必须把 scheduler 和 timeout policy 暴露到构造 options。reactive 若不愿依赖 lifecycle，则在 `IRuntimeOptions` 注入与 `ILifecycleScheduler` 结构兼容的最小 scheduler，不得再直接读取 host globals。

禁止新增第二份 `systemScheduler`、`scheduleHostTimer`、`Date.now` TTL clock 或裸 `queueMicrotask` fallback。

### AD-02（pending）：ProvisionalScope 不再伪称全量原子提交

两种合法方案只选一个：

1. 推荐：给 parent 增加内部 batch admission/reservation，先验证全量可接收，再一次提交；`commitTo()` 可保持同步。
2. 次选：把 API 明确定义为“前缀转移 + 后缀补偿”，改成 `commitTo(): Promise<void>`，失败时 await 后缀 rollback；原始 parent error 为 primary，cleanup errors 通过 `errors`/report 可达。

在没有 batch admission 时，不允许继续使用“atomically”措辞。

### AD-03（pending）：thenable 探测使用单一 canonical probe

lifecycle 提供一次读取的内部 probe/assimilation；LifecycleUnit 和 resource 复用同一语义。探测必须区分非 thenable、thenable、getter failure，并保证 captured `then` 只调用一次。

### AD-04（pending）：hostile input 在包入口归一化

capability snapshot flags/definition 时捕获 Proxy 元操作异常，保留原错误 `===` 可达，并附加本包 `(source, code)`。不能改写为 gated/failed 状态，也不能吞掉。

## 4. 公开契约/核心设计

### AR-01（pending）：scheduler 输入契约可执行

- `schedule(_, delayMs)`：非有限或负数立即抛 `RangeError + INVALID_OPTION`。
- manual `advance(ms)`：非有限或负数立即抛；`now()` 永不倒退。
- callback 至多一次；cancel 幂等。

### AR-02（pending）：resource options 增加 scheduler

`IResourceOptions.scheduler?: ILifecycleScheduler`。TTL、updatedAt、expiresAt、retry delay 全部使用同一实例。默认可用 lifecycle `systemScheduler`；缺 host capability fail-fast，不允许把 delay 改成微任务。

### AR-03（pending）：resource cancel 状态

对 SWR success 的显式 cancel：保留 stale data，清除 `refreshing`，`fetchStatus` 变 idle，passive read 不自动重启；显式 `refetch()` 才恢复。普通 pending cancel 仍进入 cancelled。

### AR-04（pending）：reactive Runtime 注入面

Runtime 必须统一获得：

- `scheduleMicrotask(task)`；
- `now()`（单调 duration）；
- `timestamp()`（若 trace 需要 epoch，可与 duration clock 分离并明确语义）；
- `onError`，默认 no-op 或明确 adapter，不直接 console。

trace timestamp 与 duration 不能混用 `Date.now`/`performance.now` 而无契约说明。

### AR-05（pending）：plugin-host policy options

`IPluginHostOptions` 至少增加：

- `scheduler?: ILifecycleScheduler`；
- `queueAdmissionTimeoutMs?: number | false`；未配置 = 只诊断不拒绝；
- `queueAdmissionDiagnosticMs?: number | false`；
- `disposeStepTimeoutMs?: number | false`；
- queue 单条 override 仅内部明确需要时使用。

`false` 必须真正关闭对应 timer。所有 number 有限非负。错误文本使用实际配置值，不再引用模块常量。

### AR-06（pending）：双错误安全附加

reactive 不能假设业务 Error 可写。若无法在原 Error 上安全定义 cause，则创建 `AggregateError([original, flushError])`，并标 `ACTION_FLUSH_FAILED`；`errors[0] === original`、`errors[1] === flushError`。能安全 attach 时保留原 Error identity。

### AR-07（pending）：capability 测试类型门禁

`package.json` 增加与现有 `test/tsconfig.json` 对应的 `typecheck:test` script；脚本必须覆盖全部 `test/**/*.ts`，并进入包级固定门禁，不能由生产 typecheck 或 Vitest transpile 代替。

## 5. 生命周期与错误语义

### AL-01（pending）：ProvisionalScope 失败代数

- parent refusal 是 primary；保持原类型与 identity/cause 可达。
- 未转移资源严格按逆注册序释放。
- cleanup failure 不覆盖 primary，但必须通过 `errors` 或 report 可达。
- API settle 前补偿必须完成；不能遗留后台释放。
- 已转移前缀只归 parent；未转移后缀只归 provisional；每项恰好一个 owner。

### AL-02（pending）：Resource request/suspension/visible-state 三轴一致

request generation、suspension generation、visible state 保持正交，但每次 cancel/settle 必须同时维护跨轴不变量：

```text
fetchStatus == idle  ⇒ visible refreshing != true
visible refreshing == true ⇒ 存在 current request generation
terminal             ⇒ 不存在 current request、retry timer、上游订阅
```

### AL-03（pending）：PluginHost pipeline 双失败错误

- 单独 stage/downstream failure 保持调用方原错误，不强行改码。
- 双失败使用 `AggregateError([stageError, downstreamError])`；顺序固定。
- aggregate 由 plugin-host 创建，必须带本包 `(source, code)`，且 code 先登记再实现。
- 两个原错误均以 `===` 保留于 `errors[]`，不得改写 stack。

### AL-04（pending）：Capability hostile-input error

新增或复用明确的 `INVALID_OPTION`。顶层保持 `TypeError`（若输入形状错误）或包装 Error；原 Proxy getter/ownKeys/getOwnPropertyDescriptors 异常经 cause 保持 `===` 可达。fail-closed 的 handle release 必须先完成，随后抛 tagged error。

## 6. 迁移与实施批次

### 批次 0：冻结基线与先红

- 前置：保留当前 dirty-worktree 快照；不得把现有绿测当整改证据。
- 新增 AF-T1～AF-T12，逐条确认先红。
- 退出：所有 confirmed finding 有真实失败断言；若不能复现，删除或降为 suspected，不实施。

### 批次 1：lifecycle canonical fixes

- 范围：AF-01/02/03；先完成 AD-02/03 裁定。
- 包门禁：lifecycle `fmt → lint → typecheck → typecheck:test → test`。
- 直接消费者：resource、capability、plugin-host typecheck/test。
- 退出：AF-T1～AF-T3 verified。

### 批次 2：reactive + resource

- 范围：AF-04～AF-08；先接 scheduler，再修状态和错误链。
- 禁止保留兼容性 host-timer fallback。
- 包门禁：reactive/resource 全门禁。
- 直接消费者：resource、所有直接依赖 reactive/resource 的 store 包；至少运行 Tray 前置清单中的直接消费者。
- 退出：AF-T4～AF-T8 verified，runtime-neutrality 对应 R/T 证据更新。

### 批次 3：capability + plugin-host

- 范围：AF-09～AF-12。
- capability 先补 `typecheck:test`；plugin-host options 再接 lifecycle scheduler/policy。
- 包门禁：capability/plugin-host 全门禁。
- 直接消费者：Tray/graph compile-time 与 integration case；尚未实现 Tray 时记录为 blocked，不伪造 verified。
- 退出：AF-T9～AF-T12 verified。

### 批次 4：文档状态与闭合

- 更新 runtime-neutrality 的总状态、R-7/R-9/T-8/T-16 evidence。
- 更新 lifecycle extraction 的 ProvisionalScope 精确语义与 L-T5/L-T11/L-T39。
- 更新 error registry（若新增 code）。
- 更新 tray §2.2 前置状态；只有五包及直接消费者证据齐全才改 verified。

## 7. 测试与验收矩阵

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T1 | verified | lifecycle unit | parent 在第 2 项拒绝，后缀 async cleanup 未 settle 前 commit 不得 settle；cleanup error 可达且 primary 仍是 parent error；每项仅一个 owner | AF-01、AD-02、AL-01 |
| AF-T2 | verified | lifecycle unit | hostile then getter 统计读取次数；只读一次；getter/调用失败进入 unit failed 并保留原错误 | AF-02、AD-03 |
| AF-T3 | verified | lifecycle unit | system/manual schedule 拒绝 NaN/Infinity/负数；manual advance 拒绝倒退；callback/cancel 语义不变 | AF-03、AR-01 |
| AF-T4 | verified | reactive architecture + unit | 禁止生产 core 直接引用 `Date.now`/`performance`/`queueMicrotask`/`console`；manual injected clock/scheduler 可确定性驱动 trace/effect | AF-04、AD-01、AR-04 |
| AF-T5 | verified | reactive unit | frozen Error A + flush error B：不抛赋值 TypeError；A/B identity 均可达；错误码为 ACTION_FLUSH_FAILED | AF-05、AR-06 |
| AF-T6 | verified | resource unit | manual scheduler 同时驱动 TTL/retry；60s delay 在 timer 缺失时不得立即执行；非法 scheduler/delay fail-fast | AF-06、AR-02 |
| AF-T7 | verified | resource unit | success→SWR refresh→cancel：data 保留、refreshing false、fetchStatus idle、旧 Promise reject、迟到结果不提交、passive read 不重启 | AF-07、AR-03、AL-02 |
| AF-T8 | verified | resource unit | thrown object 的 then getter 抛 E：getter 只读一次，E 不被吞且原外层 throw 值/错误归属按裁定可达，无 unhandled rejection | AF-08、AD-03 |
| AF-T9 | verified | capability unit | flags/definition Proxy 在 ownKeys/getOwnPropertyDescriptor/getter 抛 E：host fail-closed，抛 tagged error，cause `=== E`；已启用 handle 仍按序释放 | AF-09、AD-04、AL-04 |
| AF-T10 | verified | plugin-host unit | 未配只诊断不拒绝；false 不建 timer；number 按值拒绝；scheduler 可注入；dispose timeout 独立配置；错误显示真实阈值 | AF-10、AR-05 |
| AF-T11 | verified | plugin-host unit | async pipeline stage/downstream 同时抛 A/B：结果为 tagged AggregateError，errors[0] `=== A`、errors[1] `=== B`，source/code/stack 完整；单边失败仍原样抛 | AF-11、AL-03 |
| AF-T12 | verified | capability gate | `typecheck:test` script 存在并通过；测试源码不靠生产 tsconfig 偶然兜底 | AF-12 |

额外回归：五包现有全部测试必须原样通过；整改不得只改断言适配错误实现。每个 runtime-neutral 条款还需 architecture scan + manual scheduler behavior test，单靠文本扫描不足。

## 8. 证据与闭合映射

### 8.1 条款 → case

finding 到整改条款先闭合：

| Finding | 整改条款 |
| --- | --- |
| AF-01 | AD-02、AL-01 |
| AF-02 | AD-03 |
| AF-03 | AR-01 |
| AF-04 | AD-01、AR-04 |
| AF-05 | AR-06 |
| AF-06 | AD-01、AR-02 |
| AF-07 | AR-03、AL-02 |
| AF-08 | AD-03 |
| AF-09 | AD-04、AL-04 |
| AF-10 | AD-01、AR-05 |
| AF-11 | AL-03 |
| AF-12 | AR-07 |

整改条款到 case 再闭合：

| 条款 | Cases |
| --- | --- |
| AD-01 | AF-T4、AF-T6、AF-T10 |
| AD-02 | AF-T1 |
| AD-03 | AF-T2、AF-T8 |
| AD-04 | AF-T9 |
| AR-01 | AF-T3 |
| AR-02 | AF-T6 |
| AR-03 | AF-T7 |
| AR-04 | AF-T4 |
| AR-05 | AF-T10 |
| AR-06 | AF-T5 |
| AR-07 | AF-T12 |
| AL-01 | AF-T1 |
| AL-02 | AF-T7 |
| AL-03 | AF-T11 |
| AL-04 | AF-T9 |

反向守卫：§7 每个 AF-T 必须至少出现在本表一次；§3～§5 每个非 deferred ID 必须至少映射一个 AF-T。孤立 case 或无 case 条款均不得交付。

### 8.2 当前 baseline evidence

执行日期：2026-08-16。工作区有大量既有未提交改动，且 `packages/lifecycle` 等为 untracked/modified；所以证据标记为 `dirty-worktree baseline`，不是发布证据。

| 包 | 命令 | 结果 | 结论限制 |
| --- | --- | --- | --- |
| lifecycle | `pnpm --filter @migaia/lifecycle test` | 18 files / 222 tests passed | 未覆盖 AF-T1～3 |
| reactive | `pnpm --filter @migaia/reactive test` | 4 files / 46 tests passed | 未覆盖 AF-T4～5 |
| resource | `pnpm --filter @migaia/resource test` | 3 files / 18 tests passed | 未覆盖 AF-T6～8 |
| capability | `pnpm --filter @migaia/capability test` | 2 files / 42 tests passed | 未覆盖 AF-T9/12；无 `typecheck:test` script |
| plugin-host | `pnpm --filter @migaia/plugin-host test` | 9 files / 103 tests passed | 未覆盖 AF-T10～11 |

### 8.3 源码与契约锚点

审计引用以本文件 §2 的路径/行号为准。实现过程中若行号漂移，更新为 symbol + 新行号；不得删掉契约文档引用。至少复核：

- lifecycle extraction：§3、§4.9、L-T5/L-T11/L-T39；
- runtime-neutrality：§1、R-7、R-9、T-8、T-16；
- lifecycle migration：§5.2、§5.5、M-T15、M-T44；
- error-codes：§2、§3.2；
- tray：§2.2 前置包与前置通过标准。

## 9. 风险、deferred 与交付门禁

### 9.1 主要风险

1. **Top 1：修实现但不回退文档 complete 状态。** 后续 Tray 会把未闭合原语当已验证地基。修复：批次 0 先把受影响条款退回 pending/red。
2. scheduler 注入可能扩大 public options；必须同步 exports、声明文件、README、直接消费者与 package tests。
3. ProvisionalScope 若选择真正 batch admission，会改变 `ILifecycleOwner` 内部协议；必须先做 compile-time consumer inventory，禁止半迁移。
4. error wrapping 容易丢 native type/identity；每个 AF-T 必须断言 `instanceof`、`source/code`、`cause/errors`、stack。
5. dirty worktree 可能把别的 agent 改动误认成本轮修复；每批记录 diff 范围，禁止覆盖无关改动。

### 9.2 Deferred

当前无 deferred。若某项移出，必须填写独立 owner、目标 SDD、触发条件和不会阻断 Tray 的证明；HIGH 默认不可 deferred。

### 9.3 交付门禁

每包顺序固定：

```text
fmt → lint → typecheck → typecheck:test → test
```

- capability 必须先补 `typecheck:test`，不能写“脚本缺失但通过”。
- 修改 lifecycle 后必须跑 resource/capability/plugin-host 直接消费者测试。
- 修改 reactive 后必须跑 resource 与直接 store consumers。
- 修改错误码时先更新 `docs/contracts/error-codes.md`，再更新 `src/error-code.ts`、public export 与触发 UT。
- architecture scan 必须覆盖生产源码，排除 test/ambient 注释造成的假阳性。
- 最终运行仓库级 fmt/lint/test；若全仓存在无关失败，必须给出失败命令、归属与本轮 diff 无关的证据，不能笼统写“环境问题”。
- 只有 AF-T1～AF-T35 全部 verified、五包与直接消费者门禁完成，才允许解除 Tray 的 foundation blocker。

## 10. 2026-08-16 实施复核

### 10.1 原 finding 状态

`implemented` 仅表示目标代码与对应 UT 已出现，不等同于完整门禁通过；`partial` 表示主路径已改，但条款仍有确定缺口。

| Finding | 状态 | 当前结论 |
| --- | --- | --- |
| AF-01 | partial | `commitTo()` 已改为可等待补偿并保留 cleanup error；但 lifecycle extraction §4.9 仍声明同步 `void` 和原子提交，源码类注释也仍写 atomically；rollback 并发幂等未闭合，见 AF-15 |
| AF-02 | partial | `LifecycleUnit` 已使用单次 `probeThenable`；`SyncLifecycleScope` 仍走会在保护区外读取 getter 的 `isThenable`，见 AF-13 |
| AF-03 | implemented | system/manual scheduler 已拒绝负数和非有限值；manual flush 的递归到期语义仍缺失，见 AF-21 |
| AF-04 | partial | reactive 已增加 runtime adapter，生产 core 的直接宿主调用已移出主算法；adapter 校验和 copy-warning reporter containment 未闭合，见 AF-18 |
| AF-05 | implemented | frozen/non-extensible primary error 已走 tagged AggregateError，两个原错误保持可达 |
| AF-06 | partial | TTL/retry 已统一使用 lifecycle scheduler；非法 scheduler 仍未入口校验，AF-T6 文本要求尚未兑现，见 AF-19 |
| AF-07 | implemented | SWR cancel 已清除 `refreshing` 并保持 stale success |
| AF-08 | implemented | resource 已区分 non-thenable、captured thenable 与 probe failure |
| AF-09 | implemented | capability 已对 hostile flags/definition snapshot 附加 `INVALID_OPTION` 并保留 cause |
| AF-10 | partial | options 和 queue scheduler 已接入；dispose scope 未接同一 scheduler，错误阈值与 diagnostic code 仍不准确，见 AF-16/AF-17 |
| AF-11 | implemented | pipeline 双失败 aggregate 已附加 plugin-host source/code，原错误顺序保持 |
| AF-12 | implemented | capability 已增加并通过 `typecheck:test` |

### 10.2 当前门禁证据

本表记录同一 dirty worktree 上的实际结果；Vitest 通过不替代测试源码类型检查。

| 包 | fmt | lint | typecheck | typecheck:test | test | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| lifecycle | passed | passed | passed | **failed**：`test/adversarial.test.ts:25` callback 返回 `number`，不满足 `void` | 19 files / 228 passed | blocker |
| reactive | 本轮未重跑 | passed | passed | passed | 5 files / 49 passed | 仍需补跑 fmt；新增 AF-18 |
| resource | 本轮未重跑 | passed | passed | passed | 4 files / 21 passed | 仍需补跑 fmt；新增 AF-19 |
| capability | 本轮未重跑 | passed | passed | passed | 2 files / 42 passed | 仍需补跑 fmt；新增 AF-20 需先裁定 |
| plugin-host | 本轮未重跑 | passed | passed | **failed**：`adversarial.test.ts:18,44` implicit any；`error-code-docs.test.ts:28,29` 对 `TypeError` 读取未声明属性 | 10 files / 108 passed | blocker |

因此当前不能解除 [`tray.sdd.md`](../tray/tray.sdd.md) 的 foundation blocker，也不能把本 SDD 标为 complete。

## 11. 第二轮 confirmed findings

### 11.1 总览

| ID | 严重度 | 包 | confirmed finding | 契约影响 |
| --- | --- | --- | --- | --- |
| AF-13 | HIGH | lifecycle | `SyncLifecycleScope` 在 try/catch 外读取 hostile `.then` getter；异常会中断整条释放循环 | lifecycle extraction §3 的 then-once/错误隔离；同步 scope 的“单项失败不阻断后续释放” |
| AF-14 | HIGH | lifecycle | generation timeout 只 abort signal，不作废 token；超时结果仍可 `adopt()`；parent 已 abort 时仍创建不会被取消的 timer | lifecycle extraction L-T6、L-T31；generation deadline 语义 |
| AF-15 | MEDIUM | lifecycle | 并发第二次 `rollback()` 立即 resolve，不等待首个 rollback；parent abort listener 在 commit/rollback 后不移除 | rollback 异步幂等、监听器所有权 |
| AF-16 | HIGH | plugin-host/lifecycle | plugin-host 注入 scheduler 只驱动 mutation queue；dispose group 创建的 `LifecycleScope` 没有 scheduler 入口，dispose timeout 仍走全局 `systemScheduler` | AF-10/AR-05 的单一时间域；可确定性 teardown |
| AF-17 | MEDIUM | plugin-host | queue timeout 文案使用实际等待时长而非配置阈值；diagnostic-only 事件复用 `MUTATION_QUEUE_TIMEOUT` 错误码；scheduler 对象未入口校验 | 错误码与事件分界、R-9 注入边界 |
| AF-18 | HIGH | reactive | pending-copy warning 直接调用用户 `onError`；同步抛出可让 Runtime 构造失败，异步拒绝可形成 unhandled rejection；adapter 函数亦未入口校验 | diagnostics 不得改变控制流；runtime-neutral adapter 边界 |
| AF-19 | MEDIUM | resource | `scheduler` 直接保存且未验证 `now/schedule`；AF-T6 声称覆盖非法 scheduler，现有测试未断言 | AR-02、R-9 的 fail-fast |
| AF-20 | MEDIUM | capability | `HOST_DISPOSED` JSDoc 声明终态后任何查询均抛，但 `names/state/handle/error` 仍可查询；`disable(unknown)` 先抛 NOT_REGISTERED | 公开错误码契约与终态 API 不一致 |
| AF-21 | MEDIUM | lifecycle | manual scheduler 的 `advance()` 只取一次 due 快照；到期 callback 新排的同刻任务不会在本次 advance flush | scheduler 文档“同步执行所有到期回调”；测试时间推进确定性 |

### 11.2 AF-13：同步释放的 hostile then getter 逃逸

`packages/lifecycle/src/sync-lifecycle-scope.ts` 的 `runSyncCallback()` 只捕获 callback 调用；随后 `isThenable(result)` 在保护区外读取 `.then`。若 getter 抛错，错误不会进入 descriptor 的 error policy，而是直接跳出当前释放事务，后续 owned resource 不再释放。整改必须统一改用 `probeThenable`：probe failure 作为该 callback 的失败；捕获到 thenable 则生成 `SCOPE_SYNC_VIOLATION`；两者都继续执行后续资源。

### 11.3 AF-14：abort 不等于 generation 失效

`packages/lifecycle/src/generation-controller.ts` 的 timeout callback 仅执行 `controller.abort()`；`isCurrent()` 与 `adopt()` 只比较 `currentToken`。因此超时后 token 仍 current，迟到值可被采用。parent signal 在 `begin()` 前已 abort 时，controller 先 abort，随后仍 schedule timeout，再给已 abort signal 注册一次性监听器；该监听器不会补发，timer 留到 deadline 才清理。

裁定：任何 timeout 或 parent abort 都必须原子作废当前 token；作废动作同时取消 timer、移除 parent listener。普通调用方主动 abort 若未来开放，也必须遵守同一规则。

### 11.4 AF-15：ProvisionalScope settle 不是共享事务

`rollback()` 在异步释放前先把 state 改为 `rolledback`；并发调用看到该状态后立即返回一个已完成 Promise，而不是复用/等待首个 rollback。它满足“不会重复释放”，但不满足“调用返回时 rollback 已排空”。此外 parent listener 仅使用 `{ once: true }`，若 parent 长期不 abort，已 commit/rollback 的 provisional scope 仍被 parent signal 持有。

整改：保存并复用唯一 `rollbackPromise`；commit/rollback settle 时显式移除 listener。`commitTo()` 进入补偿分支时也必须复用同一 settle 事实，禁止第三条独立释放路径。

### 11.5 AF-16/17：plugin-host 时间策略只迁移了一半

`packages/plugin-host/src/host-runtime.ts` 构造器把 scheduler 传给 `MutationQueue`，但 `#disposeGroup()` 调用 `createLifecycleScope({ errorPolicy: 'collect' })`；而 `ILifecycleScopeOptions` 没有 scheduler 字段，最终 graceful timeout 仍由 `DisposeTransaction` 默认 `systemScheduler` 驱动。一个 host 因而存在两个时间域。

修复边界：

1. lifecycle 给 async scope options 增加 `scheduler?: ILifecycleScheduler` 并原样传入 DisposeTransaction；
2. plugin-host 的每个 dispose scope 传 `this.#scheduler`；
3. plugin-host 构造时验证 scheduler 的 `now`/`schedule` 均为函数，非法值抛 tagged `INVALID_OPTION`；
4. queue timeout 错误文案报告 configured threshold，`waitedMs` 只放 detail；
5. diagnostic-only 通知不使用会被调用方解释为 rejection 的 `MUTATION_QUEUE_TIMEOUT`，改用明确的 diagnostic event kind，或不携带 error code。

### 11.6 AF-18/19：注入面存在但不是可靠边界

`packages/reactive/src/runtime/runtime.class.ts` 对 pending-copy warning 直接调用 `#onError`，绕过同类错误使用的 `reportError()` 兜底；用户 reporter 抛错会破坏构造，返回 rejected thenable 会失去观测。reactive 的 adapter 合并也未验证四个函数。resource 同样不验证 scheduler 结构，错误会在第一次 TTL/retry 操作时以宿主 TypeError 延迟暴露。

整改：构造入口逐项校验 callable，并抛本包 tagged `INVALID_OPTION`；copy warning 必须走 `reportError()`。这不是要求 reactive 依赖 lifecycle：reactive 保持结构兼容的最小 adapter，Tray 在装配层传同一 scheduler 即可。

### 11.7 AF-20：Capability 终态查询需要显式裁定

当前实现允许 disposed 后读取 `names/state/handle/error`，而 `CapabilityErrorCode.hostDisposed` 的公开 JSDoc 明确写“任意变更/查询方法”。两种设计都可成立，但不能同时存在。推荐允许只读终态诊断：收窄 JSDoc，明确四个查询可用且返回冻结终态快照；所有 mutation 仍先检查 disposed，`disable()` 必须在 name lookup 前检查。若不接受终态诊断，则给四个查询统一加 `assertUsable()`。

### 11.8 AF-21：manual scheduler 的 flush 定义未实现

`advance()` 先复制一次 due task，再执行 callback；callback 内 schedule 的 `delayMs=0` 任务虽已满足 `at <= now`，仍需第二次 `advance(0)`。文档却承诺一次 advance 同步执行“所有到期回调”。整改采用循环取出下一个 due task，直到当前时间点无 due task；保留到期时间升序、同刻登记顺序，并增加 runaway guard/测试，避免无限自排程让测试挂死。

## 12. 新增 TDD 验收矩阵

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T13 | verified | lifecycle unit | syncSafe callback 返回 hostile thenable，getter 抛 E：E 按 error policy 归属当前项，后续资源仍逆序释放，无裸异常逃逸 | AF-13 |
| AF-T14 | verified | lifecycle unit | manual scheduler 触发 generation timeout：signal aborted、token 非 current、迟到 adopt 返回 false 并恰好释放一次 | AF-14 |
| AF-T15 | verified | lifecycle unit | parent 在 begin 前已 abort：不得残留 timeout task；parent 后 abort：token 同步失效且 timer/listener 清理 | AF-14 |
| AF-T16 | verified | lifecycle unit | 两次并发 rollback 返回同一 Promise 或至少同 settle；第二次不得提前完成；资源只释放一次 | AF-15 |
| AF-T17 | verified | lifecycle unit | provisional commit/rollback 后 parent abort listener 被移除；迟到 parent abort 不再触发 provisional controller | AF-15 |
| AF-T18 | verified | plugin-host integration | 仅推进注入 manual scheduler 即可触发 dispose graceful→force；真实 host timer 不参与 | AF-16 |
| AF-T19 | verified | plugin-host unit | 非法 scheduler 在构造入口抛 tagged INVALID_OPTION；queue timeout message 使用配置阈值，detail 保留实际 waitedMs；diagnostic-only 不携带 timeout error code | AF-17 |
| AF-T20 | verified | reactive unit | copy warning 下 reporter 同步抛/异步拒绝均不破坏 Runtime 构造且无 unhandled rejection；四个 adapter 字段逐项非法时 fail-fast | AF-18 |
| AF-T21 | verified | resource unit | scheduler 缺失/非函数的 `now` 或 `schedule` 在构造入口抛 tagged INVALID_OPTION，而非延迟宿主 TypeError | AF-19 |
| AF-T22 | verified | capability contract | 按 AF-20 裁定验证 disposed 后四个查询；所有 mutation 的 HOST_DISPOSED 优先级高于 NOT_REGISTERED | AF-20 |
| AF-T23 | verified | lifecycle unit | 到期 callback 排入同刻任务，一次 advance 全部按稳定顺序执行；cancel 生效；runaway guard 行为有明确错误契约 | AF-21 |

## 13. 新增闭合映射与交付顺序

| Finding | 条款/修复面 | Cases |
| --- | --- | --- |
| AF-13 | canonical thenable probe 覆盖 sync/async 两条 scope | AF-T13 |
| AF-14 | abort 即 token invalidation；timer/listener 单一所有权 | AF-T14、AF-T15 |
| AF-15 | provisional settle promise + listener cleanup | AF-T16、AF-T17 |
| AF-16 | LifecycleScope scheduler 透传 + plugin-host dispose 装配 | AF-T18 |
| AF-17 | plugin-host 注入校验、阈值与诊断语义分离 | AF-T19 |
| AF-18 | reactive adapter 入口校验 + reporter containment | AF-T20 |
| AF-19 | resource scheduler 入口校验 | AF-T21 |
| AF-20 | capability terminal query 裁定 | AF-T22 |
| AF-21 | manual scheduler recursive due flush | AF-T23 |

实施顺序固定：先修 lifecycle 的 AF-13～AF-16 所需底座并同步 lifecycle extraction，再修 reactive/resource 注入边界，再修 plugin-host 装配，最后裁定 capability 终态查询。每批先让对应 AF-T 失败，再实现，再执行 owning package 的 `fmt → lint → typecheck → typecheck:test → test`；改 lifecycle 后必须重跑 resource、capability、plugin-host。AF-T1～AF-T23 与本节映射必须机械双向闭合，任何孤立 case 或无 case finding 均不得交付。

## 14. 第三轮实施复核（当前权威状态）

### 14.1 AF-01～AF-23 状态

`implemented` 表示源码与语义对应的 UT 已存在且本轮门禁通过；由于本轮未执行 fmt、direct-consumer 与 repository gates，任何项都还不能标 `verified`。

| 范围 | 状态 | 复核结论 |
| --- | --- | --- |
| AF-01～AF-03 | implemented | 可等待补偿、单次 then probe、scheduler 数值校验均已落地；lifecycle extraction 的 `commitTo(): Promise<void>` 已同步 |
| AF-04 | partial | adapter 已替代 core 宿主调用，但显式 `undefined` 与 hostile getter 仍可绕过入口，见 AF-25/AF-28 |
| AF-05 | implemented | frozen primary 的双错误归属已闭合 |
| AF-06 | partial | resource 已接 scheduler 且验证普通坏形状；hostile getter 仍裸抛，见 AF-28 |
| AF-07～AF-09 | implemented | SWR cancel、Suspense hostile then、capability hostile snapshot 已有对应断言 |
| AF-10 | partial | queue/dispose 已共享注入 scheduler，阈值和诊断语义已修；scheduler hostile getter 仍裸抛，见 AF-28 |
| AF-11～AF-14 | implemented | pipeline aggregate、测试类型门禁、sync hostile then、generation invalidation 已落地 |
| AF-15 | partial | rollback 不再提前 settle 且 listener 已移除，但 Promise identity 未实现，见 AF-27 |
| AF-16～AF-17 | implemented | LifecycleScope scheduler 透传、plugin-host 阈值/detail/diagnostic 分界已落地；注入 hostile input 归 AF-28 |
| AF-18 | partial | copy-warning reporter 已 containment，普通非函数 adapter 已 fail-fast；显式 undefined/hostile getter 仍缺，见 AF-25/AF-28 |
| AF-19～AF-21 | implemented | resource 普通坏形状、capability 终态只读裁定、manual recursive due flush 已落地 |
| AF-22～AF-23 | implemented | 对应的是 AF-T 编号而非 finding；本行仅声明编号域无新增 finding，禁止误作需求状态 |

最后一行用于消除旧文档“AF-01～AF-23 都是 finding”的歧义：finding 当前只到 AF-21；AF-T22/AF-T23 是测试编号。

### 14.2 本轮门禁证据

执行日期：2026-08-16；dirty-worktree baseline。命令对五包依次执行 `lint → typecheck → typecheck:test → test`，全部 exit 0：

| 包 | lint | typecheck | typecheck:test | test |
| --- | --- | --- | --- | --- |
| lifecycle | passed | passed | passed | 19 files / 234 tests passed |
| reactive | passed | passed | passed | 5 files / 50 tests passed |
| resource | passed | passed | passed | 4 files / 22 tests passed |
| capability | passed | passed | passed | 3 files / 43 tests passed |
| plugin-host | passed | passed | passed | 10 files / 110 tests passed |

本轮未运行 formatter，避免 review 任务改写用户的大量未提交源码；也未运行直接消费者和仓库级门禁。因此这是 implementation evidence，不是 release/verified evidence。

## 15. 第三轮 confirmed findings

| ID | 严重度 | 包 | confirmed finding | 证据/契约影响 |
| --- | --- | --- | --- | --- |
| AF-24 | HIGH | plugin-host | async pipeline 用 `undefined` 作为“无错误”哨兵；stage `throw undefined` 或 downstream `reject(undefined)` 被当作成功 | `pipeline.ts` 的 `stageError !== undefined` / `downstreamError !== undefined`；错误和控制流被静默吞掉 |
| AF-25 | MEDIUM | reactive | adapter 字段显式传 `undefined` 时校验放行，object spread 又覆盖默认实现；首次使用时报无 source/code 的 TypeError | `runtime.class.ts` 只在 `value !== undefined` 时校验；最小复现得到 `diagnostics.now is not a function` |
| AF-26 | MEDIUM | lifecycle | unsafe `isThenable()` 仍从公共入口导出，和 canonical `probeThenable()` 形成第二套语义；hostile getter 可直接逃逸 | AD-03“单一 canonical probe”；全仓当前无消费者，删除面可控 |
| AF-27 | MEDIUM | lifecycle | `rollback()` 声称复用唯一 settle Promise，但函数声明为 `async`，两次调用返回不同 wrapper Promise | 最小复现 `rollback1 === rollback2` 为 false；lifecycle extraction §4.9 明确要求复用唯一 settle Promise |
| AF-28 | MEDIUM | reactive/resource/plugin-host | adapter/scheduler 普通坏形状已校验，但读取 hostile Proxy getter 时原异常裸越过包边界，无 `(source, code)` | 三个最小复现均为 `error === getterError` 且 `source/code` 缺失；违反 error-codes 边界契约 |

### 15.1 AF-24：错误存在性不能用错误值判断

JavaScript 允许 `throw undefined` 和 `Promise.reject(undefined)`。`runAsyncPipeline()` catch 后把值写入 `stageError`/`downstreamError`，再以 `!== undefined` 判断是否发生过错误，因此这两类 rejection 会被抹掉。本轮通过公开 PluginHost async pipeline 最小复现得到 Promise resolved。修复必须像 reactive `runBatched()` 一样使用独立 `hasStageError`、`hasDownstreamError` 布尔位；双失败 aggregate 仍保持 stage 在前、downstream 在后。

### 15.2 AF-25/AF-28：注入面校验不是完整快照

reactive 当前允许 `{ adapter: { now: undefined } }`：循环认为 undefined 等于“没提供”，但随后 spread 会把默认 `now` 覆盖成 undefined。开启 trace 后第一次 action 抛裸 TypeError。resource/plugin-host 对普通 `{}` 已 fail-fast，但读取 `candidate.now`/`candidate.schedule` 时 hostile getter 可直接抛出调用方异常；reactive 读取 adapter 字段也同样如此。

修复要求：

1. 对 adapter/scheduler 先在一个 try/catch 中读取自有字段快照；getter failure 包装为本包 `INVALID_OPTION`，原错误放 cause；
2. reactive 只把值为函数的字段写入 resolved adapter，不能用 spread 让显式 undefined 覆盖默认值；
3. 若公开类型决定显式 undefined 非法，则入口直接抛 tagged TypeError；若决定等价于 omitted，则保持默认实现，两者必须选一并测试；
4. snapshot 后只使用局部捕获的函数，避免校验后再次触发 getter（TOCTOU）。

### 15.3 AF-26：删除危险的重复 API

`probeThenable()` 已覆盖 not-thenable/thenable/getter-failed 三态，内部实现也已迁完；`isThenable()` 仍会直接读取 getter 并可能抛错，且被 public index 导出。它没有剩余仓库消费者。应删除 public export 与实现，避免未来调用方重新引入 AF-02/AF-13；若发布兼容性要求暂时保留，必须 deprecated 并改成不能伪装成纯 predicate 的结果类型，但这会重复 probe，故不推荐。

### 15.4 AF-27：settle 等价不等于 Promise identity

当前 `rollback` 是 `async (): Promise<void> => { if (rollbackPromise) return rollbackPromise; ... }`。async 函数总会返回一个采用内部 Promise 的新 Promise，所以两次调用虽同时 settle，却不满足文档“复用唯一 settle Promise”。改为普通函数并同步创建、保存、返回 `rollbackPromise`；首次调用的同步前置错误仍按公开契约决定是同步 throw 还是 rejected Promise，不能因去掉 async 偷换错误时序。

## 16. 新增 TDD 验收矩阵

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T24 | verified | plugin-host unit | async stage `throw undefined` 必须 reject；downstream `reject(undefined)` 必须 reject；两者同时失败仍生成 tagged AggregateError，`errors` 保持两个 undefined 槽位及固定顺序 | AF-24 |
| AF-T25 | verified | reactive unit | adapter 四字段分别显式 undefined：按裁定使用默认值或构造期 tagged INVALID_OPTION；不得延迟产生裸 TypeError | AF-25 |
| AF-T26 | verified | lifecycle architecture | public export 和生产源码不再存在 `isThenable`；所有 thenable 分支只使用 `probeThenable`，hostile getter 进入显式 failed 分支 | AF-26 |
| AF-T27 | verified | lifecycle unit | rollback 首次调用发布 Promise 后，并发第二次调用严格 `===` 同一个 Promise；资源释放一次；resolve/reject 时序一致 | AF-27 |
| AF-T28 | verified | three-package hostile-input unit | reactive adapter、resource scheduler、plugin-host scheduler 的 `now`/`schedule` getter 分别抛 E：结果带各包 source + INVALID_OPTION，cause `=== E`，getter 每字段最多读取一次 | AF-28 |

## 17. 第三轮闭合与剩余交付门禁

| Finding | Cases | Owner |
| --- | --- | --- |
| AF-24 | AF-T24 | plugin-host |
| AF-25 | AF-T25 | reactive |
| AF-26 | AF-T26 | lifecycle |
| AF-27 | AF-T27 | lifecycle |
| AF-28 | AF-T28 | reactive/resource/plugin-host 各自入口，禁止抽一个反向依赖的共享 validator |

修复顺序：AF-27/AF-26（底座契约）→ AF-25/AF-28（注入边界）→ AF-24（pipeline 错误代数）。退出条件：AF-T1～AF-T28 全部在矩阵中有真实断言；五包执行 `fmt → lint → typecheck → typecheck:test → test`；lifecycle 改动后重跑 resource/capability/plugin-host；reactive 改动后重跑 resource 与直接 store consumers；最后补仓库级门禁和 dirty-worktree 可复现证据。

源码文档同步项：`packages/lifecycle/src/provisional-scope.ts` 类注释仍写 “move atomically”，必须改为“prefix transfer + awaited compensation”；这是 AF-01 文档闭合的一部分，不另造 finding，但未修前 AF-01 不得 verified。

## 18. 第四轮实施复核

### 18.1 AF-24～AF-28 状态

| Finding | 状态 | 证据 |
| --- | --- | --- |
| AF-24 | implemented | async pipeline 已改用独立错误存在位；`throw undefined`、`reject(undefined)` 及双 undefined aggregate 已有 UT |
| AF-25 | implemented | adapter 显式 undefined 保留默认实现；普通非法值和 getter failure 均在构造期 tagged |
| AF-26 | implemented | `isThenable` 已从实现和 public export 删除，canonical probe 仍为唯一入口 |
| AF-27 | implemented | rollback 改为普通函数，重复调用严格返回同一 Promise |
| AF-28 | implemented | reactive/resource/plugin-host 的 hostile scheduler/adapter getter 均保留 cause 并附 `INVALID_OPTION` |

### 18.2 当前门禁证据

执行日期：2026-08-16；dirty-worktree baseline。五包本轮再次执行 `lint → typecheck → typecheck:test → test`，全部 exit 0：

| 包 | lint | typecheck | typecheck:test | test |
| --- | --- | --- | --- | --- |
| lifecycle | passed | passed | passed | 19 files / 236 tests passed |
| reactive | passed | passed | passed | 5 files / 54 tests passed |
| resource | passed | passed | passed | 4 files / 23 tests passed |
| capability | passed | passed | passed | 3 files / 43 tests passed |
| plugin-host | passed | passed | passed | 10 files / 113 tests passed |

累计 469 条测试通过。本轮仍未执行 fmt、直接消费者和仓库级门禁；因此测试绿只表示五包 implementation gate 通过，不表示 Tray 前置条件完成。

## 19. 第四轮 confirmed finding 与验收

| ID | 严重度 | 包 | confirmed finding | 契约影响 |
| --- | --- | --- | --- | --- |
| AF-29 | MEDIUM | plugin-host | `adaptSyncStageToAsync()` 没有 duplicate/late `next()` 守卫；重复 next 会启动多个 downstream，第一次被覆盖的 Promise rejection 无人观测 | `pipeline.ts` 的 async/sync bridge；既有“late/duplicate next 按稳定错误语义处理”契约；error-codes 的“不得产生 unhandled rejection” |

### 19.1 AF-29：sync→async bridge 丢失 violation 与 rejection

`packages/plugin-host/src/core.ts` 在 async pipeline 模式下把同步 stage 包装为 `adaptSyncStageToAsync(stage)`。当前 adapter 只保存最后一次 `downstream`：

1. 同一个 sync stage 两次调用 `next()` 时，两次 downstream 都已启动，但第一次 Promise 被覆盖，adapter 只 await 第二个；
2. 第一次 downstream 若 rejection，调用方没有任何 handler，形成 unhandled rejection；
3. 迟到 next 同样会启动新的 downstream，既没有调用 `onPipelineViolation('late')`，也没有阻止副作用。

修复要求：adapter 必须接收并使用 `onPipelineViolation`，像 `adaptSyncStageToGenerator` 一样维护 `called`/`returned` 状态；重复或迟到调用只能报告 violation 并返回已处理的 resolved Promise，不能启动第二条 downstream。第一次合法 next 的 Promise 才能交给外层 await。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T29 | verified | plugin-host bridge unit/integration | async mode 注册 sync stage：第二次同步 next 和返回后的迟到 next 都触发对应 violation；第一次 downstream reject 仍被观测；无 unhandled rejection；downstream 只启动一次 | AF-29 |

| Finding | Case | Owner |
| --- | --- | --- |
| AF-29 | AF-T29 | plugin-host/pipeline bridge |

第四轮退出条件：AF-T29 先红后修；plugin-host 重新执行 `fmt → lint → typecheck → typecheck:test → test`；再执行 plugin-host 直接消费者和仓库级门禁。AF-T1～AF-T29 必须全部 verified 后，才能解除 Tray foundation blocker。

## 20. 第五轮实施复核

### 20.1 AF-29 状态

AF-29 已实现：`adaptSyncStageToAsync()` 现在接收 violation handler，使用 `called`/`returned` 守卫，只等待第一次合法 downstream；对应 AF-T29 覆盖 duplicate、late 和第一次 downstream rejection，源码与测试语义一致。

但该修复改变了一个已导出的函数签名：原来 `adaptSyncStageToAsync(stage)` 可调用，现在第二个参数 `onViolation` 变成必填。当前仓库内调用点已迁移，仓库外调用方会在升级时出现 TypeScript 编译破坏，且没有兼容性条款或迁移说明。

### 20.2 当前门禁

本轮继续以当前 dirty worktree 为基线；五包已有的 lint、typecheck、typecheck:test、test 结果仍为全通过，最近一次计数为 lifecycle 236、reactive 54、resource 23、capability 43、plugin-host 113。AF-29 的 focused tests 位于 `packages/plugin-host/test/pipeline/async.test.ts`。

fmt、直接消费者和仓库级门禁仍未执行，因此 AF-01～AF-29 仍是 `implemented-unverified`，不是 `verified`。

## 21. 第五轮 confirmed finding 与验收

| ID | 严重度 | 包 | confirmed finding | 契约影响 |
| --- | --- | --- | --- | --- |
| AF-30 | MEDIUM | plugin-host | 修 AF-29 时把已导出的 `adaptSyncStageToAsync` 的第二参数改为必填，形成未记录的 public API breaking change；外部旧调用会在类型检查阶段失败，且没有默认行为/迁移说明 | create-sdd 的 public exports/迁移规则；error-free 的行为修复不应无声明地扩大 API 破坏面 |

### 21.1 AF-30：公开 adapter 签名破坏

`packages/plugin-host/src/index.ts` 继续导出 `adaptSyncStageToAsync`，而 `packages/plugin-host/src/pipeline.ts` 当前签名要求 `onViolation`。这不是内部 helper：它是 public export，且 `package.json`/README/USEGUIDE 中没有“第二参数从可选变为必填”的迁移说明。

两种合法修复只能选一条：

1. 将 `onViolation` 改为可选，缺省使用 no-op，保持旧调用可编译；或者
2. 保持必填，但在 plugin-host 的迁移 SDD、README/USEGUIDE、变更记录和类型契约测试中明确 breaking change，并给出旧调用到新调用的迁移方式。

推荐第一种：内部 Host 仍显式注入 `#onPipelineViolation`，外部直接使用 adapter 时缺省只维持旧行为，不会失去内部诊断。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T30 | verified | plugin-host public API/type | 旧形态 `adaptSyncStageToAsync(stage)` 可编译并运行；内部 Host 传 violation handler 时 duplicate/late 仍被报告；兼容性默认参数已落地并有专测 | AF-30 |

| Finding | Case | Owner |
| --- | --- | --- |
| AF-30 | AF-T30 | plugin-host public API |

第五轮退出条件：先完成 AF-T30 的兼容性裁定，再执行 plugin-host `fmt → lint → typecheck → typecheck:test → test`、直接消费者类型检查和仓库级门禁。AF-T30 的实现与专测已 verified；整体仍受第六轮 AF-31 及未完成的完整门禁约束。

## 22. 第六轮实施复核

### 22.1 AF-30 状态

AF-30 已实现并通过当前专测：`adaptSyncStageToAsync(stage)` 的第二参数现在可省略，默认使用 no-op；plugin-host 内部仍显式传入 violation handler。旧调用形态因此保持可编译，AF-29 的 duplicate/late violation 语义也没有被削弱。当前 plugin-host test 已为 10 files / 117 tests passed。

### 22.2 第六轮门禁证据

2026-08-16 在同一 dirty-worktree baseline 上执行五包 test（其中 lifecycle/plugin-host 包含 build），结果全部通过：lifecycle 19 files / 236 tests，reactive 5 / 54，resource 4 / 23，capability 3 / 43，plugin-host 10 / 117。该结果不替代完整的 `fmt → lint → typecheck → typecheck:test → test`，也不替代直接消费者和仓库级门禁。

## 23. 第六轮 confirmed finding 与验收

| ID | 严重度 | 包 | confirmed finding | 契约影响 |
| --- | --- | --- | --- | --- |
| AF-31 | MEDIUM | resource、plugin-host | scheduler 在入口校验时读取一次，但随后以 `options.scheduler` 再次读取并保存；可变 getter/Proxy 可让“已校验对象”与“实际使用对象”不同，第二次读取抛出的调用方异常还会绕过本包 `INVALID_OPTION` 包装 | runtime-neutrality R-9 / hostile getter 防护；校验与使用必须基于同一快照，不能存在 TOCTOU |

### 23.1 AF-31：scheduler 校验与保存不是同一快照

`packages/resource/src/resource.class.ts` 和 `packages/plugin-host/src/host-runtime.ts` 都先读取 `options.scheduler.now`、`options.scheduler.schedule` 做函数校验，随后又执行 `this.#scheduler = options.scheduler ?? systemScheduler`。当 `scheduler` 是 getter 或 Proxy 时，第二次读取可以返回另一个对象或直接抛错：前一次检查通过并不能证明后一次保存的对象可用。后续 TTL、retry、queue 或 dispose 调度可能因此落到未校验的对象上，或把宿主异常以裸错误暴露。

修复要求：在一次受保护读取中把 `options.scheduler` 快照到局部变量；对该局部变量读取并校验 `now`/`schedule`；最终字段、下游队列和所有后续逻辑只使用这个已校验快照。缺省值也必须先确定为一个局部 scheduler，再统一传递。新增 hostile getter case 必须断言：第二次读取不会发生；第二次返回非法对象或抛错不会进入已构造实例；若入口异常，保留原错误在 `cause` 且带本包 `INVALID_OPTION`。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T31 | verified | resource/plugin-host constructor boundary | scheduler property 第一次返回合法实现、第二次返回非法实现或抛错；构造只读取一次并使用同一快照，不接受未校验 scheduler；宿主 getter 异常带本包 `INVALID_OPTION` 且原错误可从 `cause` 到达 | AF-31 |

| Finding | Case | Owner |
| --- | --- | --- |
| AF-31 | AF-T31 | resource + plugin-host runtime options |

第六轮退出条件已满足：AF-T31 在 resource 与 plugin-host 两处均已修复并通过对应测试；整体仍受第七轮 AF-32～AF-34 及未完成的直接消费者/仓库级门禁约束。

## 24. 第七、八轮实施复核

### 24.1 AF-31 状态

AF-31 已实现并通过专测：resource 与 plugin-host 都把 `options.scheduler` 快照到局部变量，校验、保存和下游使用均基于同一对象。resource 当前为 4 files / 24 tests，plugin-host 当前为 10 files / 118 tests。

### 24.2 当前包级门禁

2026-08-17 在同一 dirty-worktree baseline 上对五包逐包执行完整顺序 `fmt → lint → typecheck → typecheck:test → test`，全部成功：

| 包 | 结果 |
| --- | --- |
| lifecycle | fmt、lint、typecheck、typecheck:test 通过；19 files / 246 tests 通过 |
| reactive | fmt、lint、typecheck、typecheck:test 通过；5 files / 54 tests 通过 |
| resource | fmt、lint、typecheck、typecheck:test 通过；4 files / 24 tests 通过 |
| capability | fmt、lint、typecheck、typecheck:test 通过；3 files / 43 tests 通过 |
| plugin-host | fmt、lint、typecheck、typecheck:test 通过；build + 10 files / 118 tests 通过 |

这只闭合包级门禁，不替代直接消费者、仓库级门禁和 Tray 前置验证。

AF-32 已修复：MutationQueue 在 scheduler admission 失败时移除记录并拒绝当前 Promise；非法 schedule handle 也在边界被拒绝。

AF-33 已修复：诊断 callback 的同步异常和异步 rejection 均被隔离，不穿透 scheduler、不产生 unhandled rejection。

AF-34 已闭合：五包生产源码的禁用 `.call(` / `.apply(` / `.bind(` 已清零，`Reflect.apply` 仅保留在明确的 receiver 边界；对应 architecture gate 已通过。

## 25. 第七轮 confirmed finding 与验收

| ID | 严重度 | 包 | confirmed finding | 契约影响 |
| --- | --- | --- | --- | --- |
| AF-32 | HIGH | lifecycle | `createMutationQueue().enqueue()` 先把记录放入队列，再调用注入 scheduler 的 `now()`/`schedule()`；这些调用任一同步抛错时，Promise executor 会拒绝外部 Promise，但记录仍留在 queue，之后可能继续执行或阻塞 FIFO，形成幽灵任务和错误的 `size` | lifecycle MutationQueue 的串行、settle、排程失败可观察性；失败入队不得留下不可见任务 |
| AF-33 | MEDIUM | lifecycle | admission diagnostic timer 直接调用 `onAdmissionDiagnostic`，没有隔离同步抛错或异步 rejection；诊断回调可从 scheduler callback 穿透，造成 uncaught exception/unhandled rejection，并改变队列的诊断路径 | runtime-neutrality 诊断通道必须不改变业务控制流；错误码契约禁止静默或异步泄漏 |
| AF-34 | LOW / design decision | lifecycle、reactive、resource、capability、plugin-host | 生产代码仍使用 `Object.prototype.hasOwnProperty.call`、`Reflect.apply` 或 `callbackfn.call`，与仓库 AGENTS.md 的“禁止 bind/apply/call”硬规则冲突；其中 thenable/方法调用还依赖 receiver，不能无脑机械替换 | 工程规则与 thenable receiver 语义冲突；必须增加明确例外/统一受控 helper，或调整实现策略后再允许 Tray 基础包交付 |

### 25.1 AF-32：MutationQueue 排程失败后的幽灵记录

`packages/lifecycle/src/mutation-queue.ts` 的 `enqueue()` 顺序是 `queue.push(record)`，再执行 `armAdmission(record, ...)`。`armAdmission()` 会调用注入 scheduler 的 `now()` 和 `schedule()`。如果任一调用同步抛错，Promise 构造器会把异常转成 rejected Promise，但没有从 queue 删除 `record`，也没有恢复 `running`/`size` 状态。

验收必须覆盖三种情况：`now()` 抛错、`schedule()` 抛错、`schedule()` 返回缺少 `cancel()` 的非法句柄。外部 Promise 应只失败一次，队列 size 应恢复，后续合法 enqueue 不应执行该失败记录，也不应被它阻塞；错误必须保留原始异常。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T32 | verified | lifecycle MutationQueue unit | 注入 scheduler 在 admission 排程阶段失败；失败入队不残留记录、不执行任务、不污染 FIFO/size，原错误可观测；非法 cancel handle 也必须在入队边界被拒绝或转换为生命周期错误 | AF-32 |

### 25.2 AF-33：诊断回调未隔离

`armAdmission()` 的诊断 timer callback 直接执行 `options.onAdmissionDiagnostic?.(...)`。该 callback 不是业务任务，但当前没有 `try/catch`，也没有像 plugin-host `#reportQueueWait()` 那样通过安全报告边界处理返回值。同步抛错会从 manual scheduler 的 `advance()` 或宿主 timer callback 穿透；返回 rejected thenable 则可能产生未处理 rejection。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T33 | verified | lifecycle MutationQueue unit | admission diagnostic 同步抛错或返回 rejected thenable；队列任务仍按原语义继续，诊断错误被观测但不穿透 scheduler、不产生 unhandled rejection，timer 仍正确 disarm | AF-33 |

### 25.3 AF-34：禁止 call/apply 规则的闭合裁定

这是当前可直接由源码和 AGENTS.md 推出的规则冲突，不是把所有 `call/apply` 都判为运行时 bug。命中位置至少包括：`packages/plugin-host/src/config.ts` 的 `hasOwnProperty.call`，`packages/reactive/src/runtime/node-internals.ts` 的 callback `.call`，以及 lifecycle/reactive/resource/capability/plugin-host 多处 `Reflect.apply`。

必须二选一：

1. 在 AGENTS.md 明确允许“为保留 thenable/method receiver 语义而使用的受控 helper”，并把 helper 的错误/调用约束写入 lifecycle 契约；或者
2. 设计不依赖 `call/apply/bind` 的等价调用边界，并为 receiver、hostile then getter、同步抛错和异步 rejection 补测试。

在裁定前，AF-34 不得标为 verified；但它不应被描述成已经发生的资源泄漏或状态机故障。

**裁定结果（option 2，不修改 AGENTS.md）**：维护方要求 AGENTS.md 保持原样，因此不采用 option 1 的 AGENTS.md 例外。改为等价调用边界：

- `Function.prototype.call/apply/bind`（`.call(` / `.apply(` / `.bind(`）在五包生产源码中**全部移除**：`Object.prototype.hasOwnProperty.call` → `Object.hasOwn`；`callbackfn.call` → 受控转发 helper；capability `activate` 的 `Reflect.apply(activation, receiver, …)` → 方法调用 `receiver.activate(…)`。
- 仍需 receiver 语义的调用集中到**单一反射边界**：`packages/lifecycle/src/errors.ts` 的 `assimilateCapturedThen`（thenable 单次 `.then` 读取 + `this === thenable`）与 `packages/reactive/src/runtime/receiver.ts` 的 `assimilateThenable` / `forwardCollectionCallback`（只读集合视图的 `thisArg` 转发）。`Reflect.apply` 是 `Reflect` 静态方法，与 AGENTS.md 禁止的 `Function.prototype.apply` 不同，仅允许出现在这两个模块。
- 例外与约束记录在本 SDD（而非 AGENTS.md）。receiver、hostile then getter、同步抛错、异步 rejection 由 AF-T34 行为测试覆盖；architecture gate 扫描五包源码，断言 `.call(` / `.apply(` / `.bind(` 为 0 且 `Reflect.apply(` 只命中上述两个边界模块。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T34 | verified | repository architecture/rule gate | 规则扫描命中只允许裁定范围内的受控调用；若保留 receiver 语义，必须有统一 helper、明确例外和对应测试；若移除，则五包生产源码无禁用调用 | AF-34 |

| Finding | Case | Owner |
| --- | --- | --- |
| AF-32 | AF-T32 | lifecycle MutationQueue |
| AF-33 | AF-T33 | lifecycle MutationQueue diagnostics |
| AF-34 | AF-T34 | foundation maintainers + AGENTS.md |

第七、八轮包级退出条件已满足：AF-T32～AF-T34 均已 verified，五包完整包级门禁通过。仍需完成直接消费者和仓库级门禁；在此之前不得解除 Tray foundation blocker。

## 26. 第九轮全链路复核

### 26.1 五包与直接消费者证据

执行日期：2026-08-17；dirty-worktree baseline。

- 五包完整 `fmt → lint → typecheck → typecheck:test → test` 全通过：lifecycle 246、reactive 54、resource 24、capability 43、plugin-host 118。
- 根级 `typecheck:consumers` 全通过：Node、Bun、Deno、Browser、Worker、Electron main/renderer、mini-program。
- 仓库 `lint`、`typecheck`、`build + unit test` 全通过；22 个 workspace package 的 build/test 完成。
- 直接消费者 E2E：logger 2/2、web-rpc 16/16、store-react 1/1 通过；store-worker 未进入测试执行，见 AF-35。

### 26.2 AF-35：store-worker E2E webServer 端口契约错误

| ID | 严重度 | 包 | confirmed finding | 契约影响 |
| --- | --- | --- | --- | --- |
| AF-35 | MEDIUM | store-worker（reactive/resource 直接消费者） | Playwright `webServer.port`/`baseURL` 固定为 4182，但启动命令和 Vite 配置都未指定 4182，实际监听默认 5173；Playwright 因此固定等待错误端口并在 60 秒后超时 | 直接消费者集成门禁不可执行；不能据此声明 reactive/resource 在真实 Worker 环境已验证 |

源码锚点：`packages/store-worker/e2e/playwright.config.ts` 声明端口 4182，`packages/store-worker/e2e/vite.config.ts` 没有 `server.port`，webServer command 也没有 `--port 4182`。独立启动同一 Vite 命令实际报告 `http://127.0.0.1:5173/`，与 Playwright 等待目标不一致。

修复要求：端口只能有一个 owner。推荐在 Playwright webServer command 显式传 `--port 4182 --strictPort`，或在 Vite config 设置同一端口；`baseURL` 与 readiness port 必须从同一配置来源派生，禁止三个独立字面量漂移。

| Case | 状态 | 层级 | 场景与明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T35 | red | store-worker direct-consumer E2E | `typecheck:e2e` 通过后，webServer 在声明端口启动，两个 Worker 场景均执行通过；端口被占用时 strictPort fail-fast，不允许悄悄换端口后等待超时 | AF-35 |

### 26.3 外部仓库 blockers（不归咎于五包）

| ID | 状态 | Owner | 证据 | 处理边界 |
| --- | --- | --- | --- | --- |
| EXT-01 | blocked | storage-web integration | `@migaia/storage-web typecheck:e2e` 有 9 处 TS2554：`fromIdbRequest` / `idbTransactionCommit` 已要求 runtime 参数，`e2e/main.ts` 仍按旧的一/二参数调用 | 迁入 `docs/store-persist/storage-web-integration.sdd.md` 或 storage-web 自有整改；不是 foundation runtime 回归 |
| EXT-02 | blocked | repository hygiene | `pnpm exec oxfmt --check .` 在 723 个文件中报告 91 个格式差异，主要为 README、USEGUIDE、package/tsconfig 元数据；本次 review 未授权批量改写这些无关文件 | 单独格式化批次处理；不阻断五包运行时正确性，但阻断“全仓格式门禁通过”的声明 |

### 26.4 当前结论

AF-01～AF-34 已 verified；第十轮新增 AF-36～AF-44 已 implemented 并有回归测试，待本轮证据记录后升级 verified。AF-35 仍是 direct-consumer 未闭合项。EXT-01/EXT-02 是仓库级外部 blocker，必须由对应 owner 处理或在 Tray 前置条件中显式隔离，不能把它们伪装成五包缺陷，也不能忽略后宣称全仓门禁通过。

第十轮退出条件：AF-36～AF-44 的八包 package gates 和直接消费者证据完成；AF-T35 通过；EXT-01/EXT-02 完成或由 Tray SDD 明确裁定为不阻断且给出 owner/目标文档。在此之前本 SDD 保持 implemented / in-progress。
### 26.5 2026-08-18 第十轮修复闭合项

本轮新增条款与验证映射如下。状态在最终 package gate 与 repository gate 完成前保持 implemented-unverified。

| ID | 条款 | 实现/测试证据 |
|---|---|---|
| AF-36 | Computed.preview() 不得把未跟踪结果直接提升为 committed value；条件依赖切换后必须重建依赖边 | packages/reactive/src/reactive/computed.class.ts；packages/reactive/test/signal.test.ts |
| AF-37 | sync middleware 在 next() 后抛错时必须等待 downstream，并保留双失败 | packages/middleware-pipeline/src/index.ts；packages/middleware-pipeline/test/pipeline.test.ts |
| AF-38 | PluginHost Readonly Map/Set 的 get、iterator、forEach 不得泄漏可变原始对象或容器 | packages/plugin-host/src/config.ts；packages/plugin-host/test/hardening-regressions.spec.ts |
| AF-39 | PluginHost/logger thenable 的 then getter 每次边界只读取一次，并以原 thenable 为 receiver 调用 | packages/plugin-host/src/host-runtime.ts、packages/logger/src/log.ts；hostile thenable tests |
| AF-40 | frame-budget scheduler 的 now() 必须返回有限数，否则立即报错且不得产生空分片死循环 | packages/serialize/src/stream.ts；packages/serialize/test/stream.test.ts |
| AF-41 | GenerationController 的 scheduler 建立失败必须回滚 generation、timer 与 parent listener | packages/lifecycle/src/generation-controller.ts；packages/lifecycle/test/generation-controller.test.ts |
| AF-42 | Resource hydrate 必须验证并使用同一份 snapshot 读取结果 | packages/resource/src/resource.class.ts；packages/resource/test/adversarial.test.ts |
| AF-43 | Capability adopt 后 disposer 所有权固定，外部修改 handle 不得替换释放函数 | packages/capability/src/index.ts；packages/capability/test/capability.test.ts |
| AF-44 | ProcessPlugin rollback 失败不得覆盖主安装异常，所有 rollback 异常必须保持可追踪 | packages/logger/src/plugins/process.ts；packages/logger/test/hardening-regressions.spec.ts |
| AF-45 | 本轮修复不得修改 Store 包；Store 重构由其独立 SDD 管理 | dirty-worktree baseline + scoped diff review |

本轮红测均已转绿；八包 package gate 的命令、结果、日期与 dirty-worktree 说明在交付证据中登记。若任一 gate 失败，本节及文档总状态不得升级为 verified。

## 27. 2026-08-18 第十一轮修复项

| ID | 条款 | 验收 |
|---|---|---|
| AF-46 | readonly config 的 descriptor、原型、扩展性与容器 callback 不得泄漏或改变 owned target；Map/Set proxy key 保持 lookup identity | plugin-host hardening regressions |
| AF-47 | capability handle.dispose getter 只读取一次，adopt 后释放函数不可被外部替换 | capability capability tests |
| AF-48 | Computed preview 使用 capture/commitCapture；有效 capture 不重复执行 derivation，失效 capture 必须重算并重建依赖 | reactive signal tests |
| AF-49 | scheduler 允许同步 callback；GenerationController 必须释放 callback 已同步执行后返回的 task | lifecycle generation-controller tests |
| AF-50 | middleware 默认双失败使用 canonical EXECUTION_FAILED AggregateError，保留两项原错误 identity | middleware pipeline tests |
| AF-51 | logger before hook 按注册顺序等待前一异步 hook，再执行下一 hook | logger hardening regressions |
| AF-52 | resource hydrate accessor 失败带 INVALID_SNAPSHOT 与 cause，且 data 只读一次 | resource adversarial tests |
| AF-53 | logger ProcessPlugin rollback aggregate 带 PROCESS_INSTALL_ROLLBACK_FAILED | logger hardening regressions |

本轮实现保持 implemented-unverified；完成八包 fmt、lint、typecheck、typecheck:test、test 及直接消费者门禁后，方可转 verified。
## 28. 2026-08-18 第十二轮修复项

本轮新增闭合项：

- AF-54：Capability 释放 disposer 必须保留 handle receiver，避免对象方法在释放时丢失 `this`。
- AF-55：PluginHost readonly config 的对象键代理必须跨多个读取视图共享身份映射。
- AF-56：Middleware stage 抛错后，迟到的 `next()` 必须被拒绝且不得产生未观测 rejection。
- AF-57：Lifecycle parentSignal 访问器只读取一次，并使用同一 signal 完成监听、移除和状态判断。
- AF-58：Reactive self-preview 必须在递归前以循环依赖错误终止。
- AF-59：Logger after/after:tag hooks 完成前不得向 extends 目标转发。
- AF-60：Lifecycle scheduler、PluginHost、Resource、Serialize 必须快照方法及 receiver，禁止 getter/方法 TOCTOU 漂移。

本轮验证边界：对应包 UT、架构门禁、类型检查与构建；Store 包不在范围内。未完成项不得标记为 verified。

### 28.1 当前闭合证据

AF-54～AF-60 的实现与回归验证已补齐。2026-08-18 dirty worktree：capability 47 tests、lifecycle 248 tests、plugin-host 126 tests、resource 28 tests、serialize 89 tests、logger 74 tests、reactive 57 tests、middleware-pipeline 18 tests 均通过；八包 `lint`、`typecheck`、`typecheck:test` 均通过；本轮 formatter 与 `git diff --check` 通过。构建由各包 `test` gate 覆盖。

## 29. 2026-08-18 第十三轮强对抗与整改

### 29.1 状态纠正与所有权

第十二轮 AF-60 把四类独立 admission/scheduler 契约合并为一个完成声明，导致局部测试通过被误当成八包全边界闭合。AF-60 保留为历史 ID，但状态纠正为 `red / superseded-by AF-62, AF-63, AF-64, AF-66, AF-68`，不得继续作为完成证据。

本轮依赖方向不变：`lifecycle` 拥有 scheduler/task/abort 原语；`middleware-pipeline` 拥有通用执行代数；`plugin-host`、`resource`、`serialize`、`capability` 依赖底座；`logger` 组合 plugin-host 与 middleware；`reactive` 保持独立 runtime graph。禁止为了共享 validator 建立反向依赖，禁止修改 Store 包。

### 29.2 confirmed findings 与整改契约

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-61 | implemented-unverified | lifecycle | HIGH | abort listener 必须基于快照全部执行；一个 listener 失败不得阻止后续 listener；全部错误保持 identity，并在 fan-out 后按明确 collect/throw/report 策略处理。 |
| AF-62 | implemented-unverified | lifecycle | HIGH | lifecycle 所有 scheduler 注入边界必须单次读取 `now`/`schedule` 与 receiver；`schedule` 返回 task 必须单次捕获并验证 `cancel`，禁止 TOCTOU。 |
| AF-63 | implemented-unverified | plugin-host | HIGH | resource disposer 在 admission 阶段单读并捕获函数与 resource receiver；注册后 mutation 不得替换释放行为。 |
| AF-64 | implemented-unverified | resource | HIGH | 非法 scheduled-task handle 或 `cancel` 失败不得阻止 generation 作废、pending 清零和公开状态收敛；原 cleanup 错误必须可追踪。 |
| AF-65 | implemented-unverified | serialize | HIGH | `dispose()` 必须在发布 single-flight Promise 前验证全部选项；前置验证失败不得毒化后续合法 dispose 或泄漏 parser。 |
| AF-66 | implemented-unverified | logger | HIGH | Logger 与其 PluginHost 基类必须共享同一 scheduler snapshot/time domain；不得一个使用注入时钟、另一个使用 systemScheduler。 |
| AF-67 | implemented-unverified | logger | HIGH | failure reporter、console/write 与 pending cleanup 构成终端 containment；reporter 失败不得产生 unhandled rejection 或阻塞 drain。 |
| AF-68 | implemented-unverified | serialize | HIGH | plugin type/parser 及 parser encode/decode/dispose 必须 admission 单读、保留 receiver；primary type 与 registry map 必须来自同一快照。 |
| AF-69 | implemented-unverified | serialize | MEDIUM | iterable/iterator 探测中的 Proxy `has`/getter/调用异常必须进入 codec error 边界，带 source/code/cause，不得裸泄漏。 |
| AF-70 | implemented-unverified | middleware-pipeline | HIGH | stage+downstream 双失败只能由一个 owner 组合；host combiner 接收原始 stage/downstream 各一次，禁止嵌套 Aggregate 和重复 downstream。 |
| AF-71 | implemented-unverified | reactive | MEDIUM | `scheduleIdle`、`onError`、`onTrace` 构造期单读并校验；`undefined` 等价 omitted；hostile getter 失败带 reactive INVALID_OPTION 与原 cause。 |
| AF-72 | red / superseded-by AF-82 | capability | MEDIUM | 历史要求把同步 self-dispose、外部并发和异步 self-await 统一要求为同一 Promise identity；该要求不可执行地覆盖了 JS 无 caller context 的异步 self-await 场景。保留历史 ID，不再作为当前契约。 |

### 29.3 生命周期与错误语义

1. 取消先提交不可逆内部状态，再调用可能失败的外部 cleanup；cleanup 失败不能复活 generation 或留下 `fetching`。
2. scheduler/task snapshot 是 admission 行为，不得在运行时再次读取注入对象的方法或 getter。
3. pre-admission validation 失败不进入 closing/disposed，不缓存失败 Promise；进入 closing 后才启用 single-flight。
4. 双失败顺序固定为 `[stageError, downstreamError]`；同一错误不得在 `AggregateError.errors` 中重复出现。
5. reporter 是错误链末端：同步抛和异步拒绝都必须被观测；若没有更低层 reporter，保持业务主错误并以包契约定义的诊断出口处理。

### 29.4 实施批次

1. `AF-61/62`：先修 lifecycle 原语与 red tests，再跑 resource/plugin-host/serialize/logger 直接消费者。
2. `AF-63/64/65/68/69/82`：修 admission、task、dispose ownership；不得复制 lifecycle scheduler state machine。
3. `AF-66/67/70`：统一 Logger 时间域和 middleware 错误 owner。
4. `AF-71`：补齐 reactive option snapshot。
5. 更新 package SDD、删除仅证明旧错误行为或与新契约重复的 UT；既有行为 baseline 不因“过时”名义被无证据删除。

### 29.5 TDD 验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T61 | implemented-unverified | lifecycle unit | 首 listener 抛 E，后续 listener 仍各执行一次；结果保留 E identity；重复 abort 不重放。 | AF-61 |
| AF-T62 | implemented-unverified | lifecycle unit/architecture | MutationQueue、GenerationController、boundedWait 与 dispose transaction 的 scheduler getter 各最多读取一次；task cancel getter 单读、receiver 保持；非法 handle tagged。 | AF-62 |
| AF-T63 | implemented-unverified | plugin-host unit | disposer getter 只读一次，注册后替换不生效，调用 receiver 等于原 resource；getter failure cause 可达。 | AF-63 |
| AF-T64 | implemented-unverified | resource unit | scheduler 返回非法 handle、cancel getter 抛或 cancel 抛时，请求 generation 已失效，`fetchStatus` 非 fetching，公开状态一致，错误 tagged/cause 可达。 | AF-64 |
| AF-T65 | implemented-unverified | serialize unit | `dispose({deadlineAt: NaN})` 失败后，合法 dispose 成功且 parser exactly-once；合法 dispose 并发调用 Promise identity 相同。 | AF-65 |
| AF-T66 | implemented-unverified | logger integration | manual scheduler 同时驱动 host mutation/dispose 与 logger flush/shutdown；scheduler getter 单读并保留 receiver。 | AF-66 |
| AF-T67 | implemented-unverified | logger unit | sink/hook/pipeline 失败且 failure hook、console、write 抛错时无 `unhandledRejection`，pending 最终排空，原业务错误仍可追踪。 | AF-67 |
| AF-T68 | implemented-unverified | serialize unit | stateful plugin/parser getter 每项只读一次；构造后 mutation 不改变 encode/decode/dispose；primaryType 与 types 同源。 | AF-68 |
| AF-T69 | implemented-unverified | serialize unit | `has` trap、iterator getter、iterator 调用分别抛 E，公开 rejection 带 serialize source/code，cause `=== E`。 | AF-69 |
| AF-T70 | implemented-unverified | middleware + plugin-host integration | adapter 经 runner 双失败时 combiner 收到原始 `[stage, downstream]`，每个 identity 仅出现一次；standalone adapter 语义有独立断言。 | AF-70 |
| AF-T71 | implemented-unverified | reactive unit | 三个 option 的非函数、hostile getter、显式 undefined 分别在构造期按契约处理；后续 mutation 不生效。 | AF-71 |
| AF-T72 | red / superseded-by AF-82 | capability unit | 历史 case 保留；其“reentrant dispose 严格 `===`”断言由 AF-T82 拆分为同步 self-dispose fail-fast、外部并发 Promise identity、以及明确禁止异步 self-await。 | AF-72 |

### 29.6 证据、风险与交付门禁

2026-08-18 Luna 首轮实现与主线程 package gates（历史 snapshot，已由 §30.1 的 final-main-rerun 前证据 supersede）：lifecycle 254、resource 30、plugin-host 127、serialize 94、capability 49、logger 76、middleware-pipeline 19、reactive 61 tests passed；八包 `fmt → lint → typecheck → typecheck:test → test` 通过，`git diff --check` 通过。plugin-host 的 PH-T16d 尚缺，因此 AF-63 保持 red；其余项在 Sol 对抗复核前保持 implemented-unverified，不得升级 verified。

主要风险：abort 错误策略可能改变同步 throw 时序；scheduler facade 若重复包装会改变 Promise/task identity；middleware adapter 的 standalone 兼容语义可能与 runner owner 冲突。实现必须用 dedicated UT 锁定这些行为，不能用宽泛 `toThrow()` 代替 identity/order/source/code 断言。

## 30. 2026-08-18 第二/三轮 Luna 复核

### 30.1 状态与证据边界

本节追加 AF-73～AF-87，不重编号、不覆盖历史。新增项均为 `implemented-unverified`：已有实现/回归证据和主线程 package gate，但尚未完成下一轮 Sol 对抗及最终 repository gate。AF-82 取代 AF-72；被取代的 AF-72 继续保留 `red / superseded` 历史状态。

2026-08-18 dirty-worktree 主线程/最终 Luna package evidence：lifecycle 265、resource 39、plugin-host 132、serialize 108、capability 58、logger 106、middleware-pipeline 19、reactive 63 tests passed；八包 `fmt → lint → typecheck → typecheck:test → test → build` 均通过，Logger `typecheck:browser` 与 Playwright E2E 2/2 通过。上述计数只作当前实现证据；在 Sol 复核前不得升级任一项为 `verified`，也不得把 dirty worktree 表述为 clean completion。Store 包、Store SDD、Store tests 不在本轮写集或证据范围。

### 30.2 新增 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-73 | implemented-unverified | lifecycle | HIGH | abort listener registration 去重；listener failure 与 generation cancellation cleanup failure 分别使用 `ABORT_LISTENER_FAILED`、`GENERATION_CANCELLATION_FAILED`，fan-out 后保留全部原始 identity。 |
| AF-74 | implemented-unverified | lifecycle | HIGH | Generation parent registration 必须处理 `addEventListener` 在返回前触发 callback、返回后才真正存储 listener 的实现；登记抛错、同步 abort 或 post-check 失败都强制移除已尝试 listener，不留下半注册 generation。 |
| AF-75 | implemented-unverified | resource | HIGH | retry schedule 与 abort registration 的 race 必须由同一 cancellation cleanup owner 收敛；schedule/abort 任一失败不能留下 retry timer、pending 或 fetching 状态。 |
| AF-76 | implemented-unverified | plugin-host | HIGH | plugin hook 与 Symbol disposer admission 单读 key/value，捕获原 receiver；admission 后 mutation 不改变执行函数，hostile getter 原错误可达。 |
| AF-77 | implemented-unverified | serialize | HIGH | registry options 在 ownership 前完成单次 snapshot；非法 options 不发布 parser/registry ownership，也不毒化后续合法操作。 |
| AF-78 | implemented-unverified | reactive | MEDIUM | `maxFlushPasses` 在 admission 单读、有限非负校验并冻结到本次 runtime；运行中 options mutation 不改变 flush 上限。 |
| AF-79 | implemented-unverified | logger | HIGH | logger scheduler admission 错误由 logger 拥有 `INVALID_OPTION`；原始 getter/method failure 保留 cause，不被 PluginHost/systemScheduler 改写。 |
| AF-80 | implemented-unverified | logger | HIGH | continuation tracking 对每个 upstream failure exactly-once；迟到 continuation、重复 drain、reporter failure 均不得吞掉、重复报告或替换 primary。 |
| AF-81 | implemented-unverified | capability | HIGH | cleanup 失败时继续释放其余 capability、观察全部错误并收敛 state；单个 disposer failure 不留下 activating/on 的假状态。 |
| AF-82 | implemented-unverified / supersedes AF-72 | capability | HIGH | AF-72 的统一 reentrant Promise 要求不可执行。同步 disposer self-dispose 必须 fail-fast `HOST_TRANSITIONING`；外部并发调用共享同一 Promise；异步 self-await 因 JS 无 caller context 而 prohibited/unsupported，不承诺检测。 |
| AF-83 | implemented-unverified | plugin-host | HIGH | Date/RegExp proxy/clone 保持 alias identity；Map/Set key lookup 使用原 key identity，不因 readonly facade 改写 key 或泄漏 owned target。 |
| AF-84 | implemented-unverified | serialize | HIGH | signal registration 原子化；partial registration、rollback 和 cleanup 均 exactly-once，失败不留下 active listener 或半发布 codec。 |
| AF-85 | implemented-unverified | resource | HIGH | public `withAbort` 在 abort 与 settle 并发时只完成一个公开结果；listener remove、underlying cancellation 和 late settle 由同一 owner 收敛且不重复清理。 |
| AF-86 | implemented-unverified | capability | MEDIUM | capability options admission 单次 snapshot，捕获 `onError` receiver 与 flags/options 结果；构造后 mutation 不改变 host 行为，snapshot failure fail-closed 且原错误可达。 |
| AF-87 | implemented-unverified | serialize | HIGH | 每次 serialize operation 必须对 options/signal 做 operation-local snapshot；type/signal/context 各单读一次，signal method 固定 receiver，accessor failure 进入 serialize `INVALID_OPTION` 且不泄漏 listener/parser task。 |

### 30.3 AF-T 验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T73 | implemented-unverified | lifecycle unit | 重复 abort listener registration 只执行一次；fan-out 后分别交付 `ABORT_LISTENER_FAILED`/`GENERATION_CANCELLATION_FAILED`，所有原始错误 identity 可达，remove/abort 幂等。 | AF-73 |
| AF-T74 | implemented-unverified | lifecycle unit | fake parent 在 `addEventListener` 内先调用 callback、再存储 listener；返回后强制二次 remove，late parent abort 不触发残留 listener；登记/post-check 失败时 primary/cause 不被 cleanup 替换。 | AF-74 |
| AF-T75 | implemented-unverified | resource race unit | retry schedule 与 abort registration 交错时只保留一个 cancellation owner；任何 schedule/abort/cancel failure 后 retry timer、pending、fetching 和 visible state 均收敛，原错误可达。 | AF-75 |
| AF-T76 | implemented-unverified | plugin-host unit | hook/Symbol disposer key/value 各最多读取一次；admission 后替换/删除不生效；调用 receiver 严格为原对象；hostile getter 带 plugin-host source/code/cause。 | AF-76 |
| AF-T77 | implemented-unverified | serialize unit | registry options getter 在 ownership 前只读一次；非法 options 不发布 parser/registry，后续合法注册成功且失败 primary/cause 保持。 | AF-77 |
| AF-T78 | implemented-unverified | reactive unit | `maxFlushPasses` 的 `NaN`/负数/Infinity 在 admission 被拒；合法值冻结到本次 flush，构造后 options mutation 不改变 pass limit。 | AF-78 |
| AF-T79 | implemented-unverified | logger unit | scheduler option/method getter failure 在 logger 边界产生 logger-owned `INVALID_OPTION`，cause `===` 原错误；不退回 systemScheduler、不冒用 PluginHost owner。 | AF-79 |
| AF-T80 | implemented-unverified | logger unit | 每个 upstream failure 只被 continuation tracker 观察/报告/清理一次；迟到 continuation 和重复 drain 不重复 sink/hook；reporter failure 不覆盖 primary、无 unhandled rejection。 | AF-80 |
| AF-T81 | implemented-unverified | capability unit | 一个 disposer reject 后其余 handle 仍按 LIFO 释放；所有 cleanup errors 可达，host/disposed/state 最终收敛且不残留 activating/on。 | AF-81 |
| AF-T82 | implemented-unverified | capability unit | disposer 内同步调用 `dispose()` 同步抛带 `HOST_TRANSITIONING`；外部并发调用严格 `===` 首个 Promise；异步 self-await 明确为 unsupported，不用 caller-context 假设测试“可检测”。 | AF-82 |
| AF-T83 | implemented-unverified | plugin-host unit | Date/RegExp proxy 与 clone 的重复读取保持同一 alias；原 Map/Set key lookup 命中原 key，proxy/clone key 不替代 lookup identity，也不暴露 owned target。 | AF-83 |
| AF-T84 | implemented-unverified | serialize unit | signal registration partial failure 逆序 rollback；listener/codec cleanup exactly-once；失败后 registry 无 active registration 或半发布 codec。 | AF-84 |
| AF-T85 | implemented-unverified | resource public API/race | `withAbort` 在 abort-before-settle、settle-before-abort、同时触发三路径均只 settle 一次；listener remove/cancel/late result 各一次，公开 Promise identity/result 稳定。 | AF-85 |
| AF-T86 | implemented-unverified | capability unit | options getter/`onError` method/flags 只在 admission snapshot 读取一次并保留 receiver；构造后 mutation 不生效；snapshot failure fail-closed 且 cause 原样可达。 | AF-86 |
| AF-T87 | implemented-unverified | serialize unit | 每个 operation 的 type/signal/context getter 只读一次并使用同一局部 snapshot；signal method receiver 固定，hostile accessor/mutation 不改变已 admission 行为，失败不调用 parser、不泄漏 listener。 | AF-87 |

### 30.4 双向闭合映射与交付门禁

| Finding/条款 | Case | Owner |
| --- | --- | --- |
| AF-73 | AF-T73 | lifecycle |
| AF-74 | AF-T74 | lifecycle |
| AF-75 | AF-T75 | resource |
| AF-76 | AF-T76 | plugin-host |
| AF-77 | AF-T77 | serialize |
| AF-78 | AF-T78 | reactive |
| AF-79 | AF-T79 | logger |
| AF-80 | AF-T80 | logger |
| AF-81 | AF-T81 | capability |
| AF-82（supersedes AF-72） | AF-T82；AF-T72 仅保留历史映射 | capability |
| AF-83 | AF-T83 | plugin-host |
| AF-84 | AF-T84 | serialize |
| AF-85 | AF-T85 | resource |
| AF-86 | AF-T86 | capability |
| AF-87 | AF-T87 | serialize |

AF-T73～AF-T87 每个 case 的断言都直接证明对应条款，不以 ID-only assertion 作为证据；每个新增条款均至少有一个 case。AF-T72 不再证明 AF-82，仅证明历史 AF-72 曾存在且已被 supersede。middleware-pipeline 在本轮无新增 finding/case，保留现有 MP-T01～MP-T16 与 19-test evidence。

八包主线程 package gates 与 Logger E2E 已完成；交付前仍须执行下一轮 Sol 复核，并在最后一次 Luna 修复（若有）后重跑受影响 package、direct-consumer、error-code、exports、dependency-direction 与 `git diff --check` gates。任何新项在这些证据完成前均保持 `implemented-unverified`。Store exclusion、dependency direction、failure/race semantics 和 dirty-worktree evidence 继续有效。

## 31. 2026-08-18 第十四轮 Sol findings 与 Luna 整改

### 31.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-88 | implemented-unverified | lifecycle | HIGH | ProvisionalScope 的 parent signal 登记必须处理 stored-then-throw 与 invoke-then-store；构造失败强制移除已尝试 listener，primary 与 cleanup error 均可达。 |
| AF-89 | implemented-unverified | lifecycle | HIGH | DisposeTransaction 的外部 signal 登记/移除失败不得跳过 item release、pending drain 或 collector finalize；cleanup error 不覆盖 primary。 |
| AF-90 | implemented-unverified | lifecycle | MEDIUM | MutationQueue timeout callback 同步执行时，schedule 返回的 task 必须立即 cancel exactly-once，队列仍可继续 admission。 |
| AF-91 | implemented-unverified | lifecycle | MEDIUM | 外部重复/并发 dispose 复用同一 Promise；disposer 同步 self-dispose 以 `SCOPE_REENTRANT_DISPOSE` fail-fast，异步 self-await 禁止。旧 SDD 的统一 identity 表述由本条纠正。 |
| AF-92 | implemented-unverified | plugin-host | MEDIUM | config COW 更新必须把指回旧 root 的 self/nested aliases 重绑定到新 root，保留新图内部 alias、旧快照不可变和失败回滚。 |
| AF-93 | implemented-unverified | serialize | MEDIUM | iterable protocol 通过直接单读 `Symbol.asyncIterator`/ `Symbol.iterator` 判定；不得依赖 Proxy `has` trap，async 优先且 receiver/cause 保持。 |
| AF-94 | implemented-unverified | logger | HIGH | shutdown handler 产生的工作必须在关闭 dispatch 前排空；进入 PluginHost disposer 前关闭普通 dispatch，disposer-era log/raw/defer 不得产生迟到 sink。 |
| AF-95 | implemented-unverified | middleware-pipeline | MEDIUM | sync/async/generator runner 在入口固定 stage snapshot；当前 dispatch 不观察 caller 对 stage 数组的插入、删除或替换。 |
| AF-96 | implemented-unverified | reactive | MEDIUM | `setSchedulerStrategy` 在 admission 拒绝非函数，抛 reactive `INVALID_OPTION` tagged TypeError，并保留旧 strategy 可用。 |
| AF-97 | implemented-unverified | logger | MEDIUM | Logger 12 个错误码必须各有真实触发 UT；每个码 JSDoc 包含触发条件、SDD 条款与调用方动作，registry 计数/状态一致。 |
| AF-98 | implemented-unverified | middleware-pipeline | MEDIUM | package export gate 必须经包名/exports 与声明文件验证真实消费者，并证明未用模式可 tree-shake；源码相对导入不能充当 export 证据。 |

### 31.2 TDD 验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T88 | implemented-unverified | lifecycle unit | parent add stored-then-throw、callback-before-store、reason/remove 双失败均无残留 listener；primary 与 cleanup identity 可达。 | AF-88 |
| AF-T89 | implemented-unverified | lifecycle unit | signal add/remove 抛错时全部 item 仍释放，pending drain 与 collector finalize 必达；primary 不被 cleanup 替换。 | AF-89 |
| AF-T90 | implemented-unverified | lifecycle unit | timeout callback 同步 reject 后返回 task 被 cancel 一次，cancel 失败 tagged/可追踪，下一 mutation 仍执行。 | AF-90 |
| AF-T91 | implemented-unverified | lifecycle unit | 外部并发 dispose 严格 `===`；disposer 同步 self-dispose 抛 `SCOPE_REENTRANT_DISPOSE` 且其余资源继续释放。 | AF-91 |
| AF-T92 | implemented-unverified | plugin-host unit | root self-cycle、nested aliases 经成功 update 指向新 root；旧 snapshot 不变；failed update 不提交。 | AF-92 |
| AF-T93 | implemented-unverified | serialize unit | `has:false` + 合法 async/sync iterator 成功；getter 各单读、async 优先、receiver 保持；getter error cause 精确可达。 | AF-93 |
| AF-T94 | implemented-unverified | logger unit/E2E | shutdown handler async sink 被排空；disposer 中 log/raw/defer 不产生新 pending；shutdown identity/deadline/错误归属不变。 | AF-94 |
| AF-T95 | implemented-unverified | middleware unit | 三种 runner 中 stage 对源数组插入/删除/替换均不改变当前执行 snapshot，包括 downstream await 窗口。 | AF-95 |
| AF-T96 | implemented-unverified | reactive unit | null/object/string strategy 立即 tagged TypeError；旧 strategy 后续仍驱动 signal update。 | AF-96 |
| AF-T97 | implemented-unverified | logger unit/contract | 12 个码逐个由真实路径触发并断言 native type/source/code/cause；JSDoc 静态门禁完整。 | AF-97 |
| AF-T98 | implemented-unverified | middleware package consumer | isolated fixture 通过 `@migaia/middleware-pipeline` exports 完成 runtime/type import，产物不包含未用 mode。 | AF-98 |

### 31.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 273、reactive 64、resource 39、capability 58、middleware-pipeline 22、plugin-host 135、serialize 109、logger 119 tests passed；Logger Playwright E2E 2/2 通过。相应 package `fmt → lint → typecheck → typecheck:test → test → build` 通过，`git diff --check` 通过。AF-88～AF-98 与 AF-T88～AF-T98 一一映射；package-local SDD 追加 L-R03～L-R06/L-T49～L-T52、PH-R19/PH-T19、LG-T15/LG-T16、MP-R12/MP-R13 与 MP-T17/MP-T18。

上述证据尚未经过第十五轮 Sol 对抗和主线程最终八包重跑，故全部保持 `implemented-unverified`。Store 包与 Store SDD 继续排除。

## 32. 2026-08-18 第十五轮 Sol findings 与 Luna 整改

### 32.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-99 | implemented-unverified | lifecycle | HIGH | DisposeTransaction 对每个 descriptor 独立 snapshot/admission；custom/graceful/force/order getter 或形状失败只归属该项，后续 item、pending drain、finalize 必须继续。 |
| AF-100 | implemented-unverified | logger | MEDIUM | HTTP transport rejection 重试耗尽后统一抛 logger `DELIVERY_FAILED`，原 transport error 经 cause 可达；已 tagged delivery error 不重复包装。 |
| AF-101 | implemented-unverified | reactive | MEDIUM | scheduler strategy 同步抛、返回 hostile thenable 或异步 reject 时不得 unhandled/wedge；清除 scheduled、报告 tagged `INVALID_OPTION` 并恢复安全策略。 |
| AF-102 | implemented-unverified | logger | MEDIUM | `RUNTIME_SHUTTING_DOWN` 的真实触发是 shutdown 期间拒绝新 process plugin/logger 安装；JSDoc、UT 与调用方动作必须一致。 |
| AF-103 | implemented-unverified | plugin-host | HIGH | Readonly Map/Set 子类的未知自定义方法不得绑定 raw owned target；内建安全 reader 可访问 owned target，mutator/自定义写入只能经 readonly proxy 并被拒绝。 |
| AF-104 | implemented-unverified | plugin-host | MEDIUM | update patch 自循环、nested back-reference 和共享 alias 必须重绑定到最终新 root，同时保留旧 root alias 映射与失败回滚。 |
| AF-105 | implemented-unverified | serialize | MEDIUM | iterable probe 接受 object 与 callable function output；sync/async protocol、优先级、receiver 与 getter cause 语义相同。 |
| AF-106 | implemented-unverified | SDD | MEDIUM | foundation active range 明确排除历史 superseded AF-72，禁止把 red history 计入 implemented range。 |
| AF-107 | implemented-unverified | lifecycle SDD | MEDIUM | `docs/lifecycle/migration.sdd.md` 使用强制 §0～§9 结构且不重编号既有 M-/T- ID，包含风险/deferred/交付门禁。 |
| AF-108 | implemented-unverified | plugin-host SDD | MEDIUM | PH-R19/PH-T19 必须进入 closure/delivery gate；Logger direct-consumer 当前证据为 119 tests + E2E 2/2，旧 89 明示历史。 |
| AF-109 | implemented-unverified | error registry | MEDIUM | plugin-host 24-code row 的 implemented 状态不得同时残留“待批次 3”；source/code 实现与测试证据必须一致。 |

### 32.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T99 | implemented-unverified | lifecycle unit | plan/order 与四 error policy 下，hostile descriptor getter/invalid callback/order 只记录该项，later item 仍释放；Provisional rollback 亦不短路。 | AF-99 |
| AF-T100 | implemented-unverified | logger unit/E2E | fetch reject 在 retries 0/>0 下调用次数正确，failure exactly-once，source/code/cause 为 logger DELIVERY_FAILED；已 tagged error identity 保持。 | AF-100 |
| AF-T101 | implemented-unverified | reactive unit | strategy sync throw、then getter throw、async reject 均无 unhandled，scheduled 可恢复，后续 write 使用安全策略并完成 flush。 | AF-101 |
| AF-T102 | implemented-unverified | logger contract | shutdown 进行中安装第二个 process plugin/logger 触发 `RUNTIME_SHUTTING_DOWN`；JSDoc 明确 SDD 条款和调用方等待/新建动作。 | AF-102 |
| AF-T103 | implemented-unverified | plugin-host unit | Map/Set subclass custom mutator 不能改变 snapshot；内建 reader 与显式 custom reader 行为受控，不泄漏 raw target。 | AF-103 |
| AF-T104 | implemented-unverified | plugin-host unit | patch.self、nested/shared patch alias 与 old-root alias 均指向同一 final root；hook 失败不提交。 | AF-104 |
| AF-T105 | implemented-unverified | serialize unit | callable sync/async iterable 成功编码，async 优先、factory receiver 精确、getter failure cause 可达。 | AF-105 |
| AF-T106 | implemented-unverified | SDD static | active range 为 AF-61～71、73～109，AF-72 仅在 historical superseded 映射出现。 | AF-106 |
| AF-T107 | implemented-unverified | SDD static | lifecycle migration 顶层 0～9 顺序唯一，既有稳定 ID 无重复/重编号，§9 含风险与 gate。 | AF-107 |
| AF-T108 | implemented-unverified | SDD static | PH-R19/PH-T19 双向映射与 gate 存在；当前 Logger 119/E2E2 证据和历史 89 标签不矛盾。 | AF-108 |
| AF-T109 | implemented-unverified | registry static | plugin-host row count=24、implemented evidence 完整且无 pending wording，code table 与测试数量一致。 | AF-109 |

### 32.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 291、plugin-host 139、serialize 111、logger 121、reactive 67 tests passed；对应 `fmt → lint → typecheck → typecheck:test → test → build` 通过，Logger `typecheck:browser` 与 Playwright E2E 2/2 通过，`git diff --check` 通过。lifecycle migration SDD 已迁为 §0～§9；plugin SDD/registry 证据已纠正。AF-99～AF-109 与 AF-T99～AF-T109 一一映射。

上述证据尚未经过第十六轮 Sol 对抗和主线程最终八包重跑，故全部保持 `implemented-unverified`。Store 包、Store SDD 与 Store tests 继续排除。

## 33. 2026-08-18 第十六轮 Sol findings 与 Luna 整改

### 33.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-110 | implemented-unverified | plugin-host | HIGH | Readonly Map/Set 只允许捕获的原生 reader identity 接收 owned target；同名 subclass override 必须以 readonly proxy 为 receiver，不能借 reader 名称白名单取得 raw target。 |
| AF-111 | implemented-unverified | plugin-host | HIGH | config clone、graph discovery 与 COW 必须通过捕获的 `Map.prototype.entries` / `Set.prototype.values` 遍历；subclass 或实例 `Symbol.iterator` 覆盖不得隐藏 cycle/alias edge。 |
| AF-112 | implemented-unverified | logger | HIGH | process-exit interception 在替换前捕获原函数 identity 与 receiver；flush 后不得再次读取已替换属性造成递归，卸载必须恢复 exact identity。 |
| AF-113 | implemented-unverified | reactive | MEDIUM | 每次 scheduler admission 使用 generation/token；异步非法策略恢复后，旧 callback 必须失效且 one-shot，不得重复 flush、重复错误或干扰新调度。 |
| AF-114 | implemented-unverified | lifecycle | HIGH | MutationQueue 正常 dequeue 的 watchdog `cancel()` 失败必须被 containment/report；已出队 mutation 及后续队列仍执行并 settle，cancel exactly-once。 |
| AF-115 | implemented-unverified | lifecycle | MEDIUM | DisposeTransaction 在 callback 前单读并验证 `gracefulTimeoutMs` 为有限非负数；非法项按 policy 记录并跳过，其后项、pending drain 与 finalize 继续。 |
| AF-116 | implemented-unverified | resource | HIGH | Resource dispose 即使 request abort-listener cleanup 抛错，也必须继续清 request 状态、依赖与 state signal 并进入 terminal；首错误保留，后续 cleanup 错误可达，重复 dispose 幂等。 |
| AF-117 | implemented-unverified | middleware-pipeline SDD | MEDIUM | MP-R12/MP-R13 在 direct-consumer/repository gate 与本轮复核未闭合前不得标记 verified，必须与 header、MP-M05、§9 状态一致。 |
| AF-118 | implemented-unverified | middleware-pipeline SDD | MEDIUM | §8 双向映射必须使用完整稳定 ID `MP-Txx`；省略前缀的 `Txx` 不构成已声明 case。 |
| AF-119 | implemented-unverified | lifecycle/plugin-host SDD | MEDIUM | 当前证据只能保留最新可复现计数；lifecycle 287 与 logger 119 等被后续计数取代的结果必须标注 historical，不能与较新计数同时称为 current。 |

### 33.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T110 | implemented-unverified | plugin-host unit | Map/Set subclass 覆盖 get/has/entries/keys/values/forEach/iterator 时，override receiver 是 readonly proxy；写入失败且 snapshot 不变，原生 reader 仍正常。 | AF-110 |
| AF-T111 | implemented-unverified | plugin-host unit | subclass/实例 iterator 隐藏 entries 时，初始 clone 与 COW 仍完整发现 Map/Set 中的 root cycle、alias 和 prototype，旧 snapshot 不变。 | AF-111 |
| AF-T112 | implemented-unverified | logger unit/E2E | fake process 的 intercepted exit 只调用捕获原函数一次，保留 code/receiver、flush single-flight；卸载和再次安装恢复 exact identity 且无递归。 | AF-112 |
| AF-T113 | implemented-unverified | reactive unit | controlled thenable 在 invalid recovery 后迟到/重复调用旧 callback 不重复 flush/error；新 write 仅由新 generation 调度且无 unhandled rejection。 | AF-113 |
| AF-T114 | implemented-unverified | lifecycle unit | A 释放 B 后，B dequeue cancel 抛错只产生 tagged diagnostic；B/C 仍按序执行并 settle，task cancel 总计一次。 | AF-114 |
| AF-T115 | implemented-unverified | lifecycle unit | `NaN`/Infinity/负数/非数 timeout 在 admission 产生 `INVALID_OPTION`，对应 callbacks 不运行；四 policy 下后续 item 与 drain/finalize 必达。 | AF-115 |
| AF-T116 | implemented-unverified | resource unit | active request abort listener 抛错时 dispose 仍清依赖/state/request 并 terminal；首错误 identity/source/code/cause 与附加 errors 可达，第二次 dispose 无副作用。 | AF-116 |
| AF-T117 | implemented-unverified | SDD static | MP-R12/MP-R13、header、MP-M05、§8/§9 在最终 gate 前统一为 implemented-unverified，禁止提前 verified。 | AF-117 |
| AF-T118 | implemented-unverified | SDD static | middleware §8 所有 case 引用匹配已声明 `MP-T01`～`MP-T18`，不存在裸 `Txx`。 | AF-118 |
| AF-T119 | implemented-unverified | SDD static | lifecycle/plugin-host 旧计数显式 historical；最新计数唯一标记 current，最终重跑后再替换。 | AF-119 |

### 33.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 294、reactive 68、resource 40、plugin-host 143、logger 122 tests passed；对应 package `fmt → lint → typecheck → typecheck:test → test → build` 由各 Luna worker 通过，Logger `typecheck:browser` 与 Playwright E2E 2/2 通过，`git diff --check` 通过。middleware/lifecycle/plugin-host SDD 的状态、稳定 ID 和历史计数漂移已纠正。AF-110～AF-119 与 AF-T110～AF-T119 一一映射。

这些是 worker 与局部主线程实现证据；仍须主线程重跑受影响门禁及第十七轮 Sol 对抗。全部条款在无 finding Sol 轮与最终八包/direct-consumer gates 完成前保持 `implemented-unverified`。Store 包、Store SDD 与 Store tests 继续排除。

## 34. 2026-08-18 第十七轮 Sol findings 与 Luna 整改

### 34.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-120 | implemented-unverified | plugin-host SDD | MEDIUM | PH requirements/decisions/cases 的双向映射必须使用完整且真实存在的 `PH-*` ID 与 a/b/c suffix；禁止 `R02`、`PH-T16` 等不存在缩写。 |
| AF-121 | implemented-unverified | logger SDD | MEDIUM | logger 119/121 等被 122 取代的计数必须标为 historical/intermediate；同一时点只能有一个 latest current evidence。 |
| AF-122 | implemented-unverified | lifecycle SDD | MEDIUM | D-12/D-13、L-R08/L-R09、L-T54/L-T55 在下一轮与最终门禁前保持 implemented-unverified，不得与 header/foundation 状态矛盾。 |
| AF-123 | implemented-unverified | lifecycle test | MEDIUM | invalid graceful timeout 的四 policy、plan/order case 必须显式证明 later item、pending drain 与 finalize/result；只断言 later item 不足以闭合 AF-T115。 |
| AF-124 | implemented-unverified | capability | HIGH | `activate()` 同步调用 host.dispose 时，activation pending 必须已发布；dispose 不能在迟到 handle 的异步 disposer 完成前 resolve，且不得发布 stale handle/on state。 |
| AF-125 | implemented-unverified | middleware-pipeline | MEDIUM | upstream `await/return next()` 传播同一个 identity-bearing downstream rejection 时只交付原错误一次；独立 post-next stage/downstream 双失败仍按固定顺序组合。 |
| AF-126 | implemented-unverified | logger | MEDIUM | HTTP request deadline 与 retry backoff 必须使用 Logger/PluginHost 共享 scheduler snapshot/time domain，不得绕过到 global timers；task cleanup 与 receiver 保持。 |
| AF-127 | implemented-unverified | serialize | MEDIUM | caller/closing signal 按安装逆序 LIFO rollback/dispose；多个 remove 失败仍全部尝试，primary/cause/errors 与 exactly-once 保持。 |
| AF-128 | implemented-unverified | logger | HIGH | process.exit setter commit-then-throw 时安装 rollback 必须恢复 exact original function/receiver；restore/listener cleanup 失败聚合且 primary 保持，后续 reinstall 可用。 |
| AF-129 | implemented-unverified | logger | MEDIUM | logger 所有稳定公开错误/诊断文本集中到 package-owned error-text；production throw sites 不得继续内联可漂移消息。 |
| AF-130 | implemented-unverified | reactive | MEDIUM | reactive 所有稳定公开错误/诊断文本集中到 package-owned error-text，保持现有 native type/source/code/cause 与逐字消息，并有静态 ownership gate。 |
| AF-131 | implemented-unverified | plugin-host | HIGH | callable function config 必须进入 owned clone/COW graph；own data、alias、function→root cycle 重绑定，外部 mutation 不影响 snapshot；不支持的 descriptor/class shape 在 admission 明确拒绝。 |
| AF-132 | implemented-unverified | serialize | MEDIUM | 构造错误原因文本不得让 hostile Error.message 或 String coercion 取代 parser/iterator primary；公开错误仍 tagged 且 cause `=== primary`。 |
| AF-133 | implemented-unverified | middleware-pipeline | MEDIUM | propagated-error 去重只适用于可证明的 identity-bearing object/function；两个独立但值相等的 primitive failures（含 undefined）必须保留为双失败，不能按 `===` 折叠。 |

### 34.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T120 | implemented-unverified | SDD static | plugin-host 映射只引用已声明完整 `PH-R/D/T` ID，所有 suffix 保留且反向语义闭合。 | AF-120 |
| AF-T121 | implemented-unverified | SDD static | logger 119/121 明示历史，122 是本轮唯一 latest current count。 | AF-121 |
| AF-T122 | implemented-unverified | SDD static | lifecycle 六个新增 ID 与 header/foundation gate 均为 implemented-unverified。 | AF-122 |
| AF-T123 | implemented-unverified | lifecycle unit | 4 invalid shapes × 4 policies × plan/order 均断言 callback suppression、later item、pending drain 顺序/失败与 final result/throw/collect/report/firstError。 | AF-123 |
| AF-T124 | implemented-unverified | capability unit | activate 同步 dispose 后 shared dispose Promise 在 cleanup gate 前不 settle；gate 后 exactly-once cleanup，enable cancelled、state off、无 handle。 | AF-124 |
| AF-T125 | implemented-unverified | middleware unit | object Error 经 await/return next 传播时原 identity 只出现一次且 combiner 不调用；独立 object 双失败仍组合。 | AF-125 |
| AF-T126 | implemented-unverified | logger unit | manual scheduler 驱动 request timeout/retry/backoff，global timer 不参与；cancel/receiver/call count 与 delivery errors 保持。 | AF-126 |
| AF-T127 | implemented-unverified | serialize unit | caller 后 closing 的 registration 以 closing→caller 移除；partial registration 与多 remove failure 全部收敛，identity 可达。 | AF-127 |
| AF-T128 | implemented-unverified | logger unit | exit setter commit 后抛错仍恢复 exact original；restore 与 listener rollback 双失败进入 aggregate，原 install error 首位，reinstall 成功。 | AF-128 |
| AF-T129 | implemented-unverified | logger static/unit | production coded errors 无内联稳定 message；error-text factory/constant 有 intent JSDoc，既有逐字消息 tests 不变。 | AF-129 |
| AF-T130 | implemented-unverified | reactive static/unit | AST ownership gate 禁止 production error constructor 内联稳定文本；现有错误码、native type、cause 与 message tests 全过。 | AF-130 |
| AF-T131 | implemented-unverified | plugin-host unit | callable own property外部 mutation 隔离；initial/update cycle 指向 owned/new root；readonly callable 保持 call/construct/receiver；unsupported shape fail-fast 且 rollback。 | AF-131 |
| AF-T132 | implemented-unverified | serialize unit | encode/decode/iterator 抛 hostile message/coercion primary 时，secondary 不逃逸，结果 source/code 正确且 cause 为 primary。 | AF-132 |
| AF-T133 | implemented-unverified | middleware + plugin-host integration | 两个独立 undefined failures 仍形成含两个 undefined slot 的 host aggregate；object propagated error 的去重契约不回退。 | AF-133 |

### 34.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 294、capability 59、middleware-pipeline 27、logger 126、serialize 115、reactive 69、plugin-host 147 tests passed；plugin-host callable targeted 4/4，Logger Playwright E2E 2/2 与 logger direct-consumer 126 tests 通过。对应 worker package `fmt → lint → typecheck → typecheck:test → test → build` 与 `git diff --check` 通过；middleware 修复后的 plugin-host 全量由主线程复现 147/147。package SDD 已追加/修正 L-T55、M-R11/M-T53、MP-R14/MP-T19/MP-T20、PH-R25/PH-T25、logger 与 serialize 条款。

AF-120～AF-133 与 AF-T120～AF-T133 一一映射。下一步必须由第十八轮 Sol 验证代码与文档；若仍有 finding，继续 Luna 修复循环。最终八包和直接消费者门禁未完成前全部保持 implemented-unverified。Store 包、Store SDD 与 Store tests 继续排除。

## 35. 2026-08-18 第十八轮 Sol findings 与 Luna 整改

### 35.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-134 | implemented-unverified | plugin-host | HIGH | non-constructable callable config 的 clone/readonly invocation 保留动态 receiver；method 读取 readonly receiver own config 不得被绑定为 undefined 或 raw source。 |
| AF-135 | implemented-unverified | plugin-host | HIGH | constructable readonly callable 的实例使用正常可写 instance prototype/derived construction；不得把 readonly config proxy 设为实例原型而拦截普通实例写入，同时 function own config 保持 readonly。 |
| AF-136 | implemented-unverified | serialize | HIGH | dispose deadline 的 scheduler `now/schedule/task.cancel` 任一失败都不得跳过 scope/parser cleanup；cleanup exactly-once，scheduler primary 与 parser cleanup errors 全部可达。 |
| AF-137 | implemented-unverified | middleware-pipeline | MEDIUM | propagated rejection 必须基于 next-result consumption/provenance 判断；两个独立 stage/downstream 即使抛同一 object identity 仍组合，不能仅以引用相等折叠。 |
| AF-138 | implemented-unverified | middleware-pipeline | MEDIUM | 提供 host combiner 时其返回的 `undefined`/`null` 是合法 host-owned throw value，必须原样抛出；只有未提供 combiner 才创建 pipeline fallback。 |
| AF-139 | implemented-unverified | logger | HIGH | ProcessPlugin shutdown timeout 与 BatchPlugin interval/debounce 统一使用 core shared lifecycle scheduler；无 global timer 分裂，sync callback/task cleanup/receiver 语义受控。 |
| AF-140 | implemented-unverified | logger SDD | MEDIUM | AF-126/128/129 与本轮 logger contract 必须拥有 package-local LG-R/LG-T 稳定 ID、双向映射和唯一最新计数；旧 122 等计数明确历史。 |
| AF-141 | implemented-unverified | plugin-host SDD | MEDIUM | §0 closure range 必须精确包含 PH-R25 与 PH-T25a～g，并与 header、requirement table、mapping、gate 一致。 |
| AF-142 | implemented-unverified | lifecycle | HIGH | LifecycleScope 不得在 DisposeTransaction admission 前 eager read/spread descriptor；hostile getter 由 per-item isolation 单读，失败不跳过 later LIFO release、drain、finalize。 |
| AF-143 | implemented-unverified | logger | HIGH | final ProcessPlugin uninstall 即使 exit restore/removeListener 抛错也尝试全部 cleanup，并 guaranteed reset static state；错误聚合后 later reinstall 正常。 |
| AF-144 | implemented-unverified | logger | MEDIUM | HTTP scheduler task cancel 抛错不得阻止 backoff/request Promise settle、listener removal 或 flush/shutdown；cleanup failure 被报告/保留且无 unhandled rejection。 |
| AF-145 | implemented-unverified | foundation SDD | MEDIUM | AF-T126 的 manual scheduler/cancel contract 是 logger unit evidence；E2E 仅证明 browser delivery/deadline，不得把未覆盖的 scheduler assertions 标成 E2E。 |

### 35.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T134 | implemented-unverified | plugin-host unit | arrow/method callable 经 readonly graph 调用时 receiver 为 caller/readonly owner，读取 own config 成功且不泄漏 raw target。 | AF-134 |
| AF-T135 | implemented-unverified | plugin-host unit | new/derived constructor、post-new own writes、instanceof/prototype 与 explicit object return 正常；function own/inherited config 仍 readonly。 | AF-135 |
| AF-T136 | implemented-unverified | serialize unit | now/schedule/invalid task/sync callback/cancel getter/call 与 parser dispose failure 组合下 cleanup exactly-once，terminal/Promise identity稳定，primary/cause/errors 或 report 完整。 | AF-136 |
| AF-T137 | implemented-unverified | middleware unit/integration | void next 后 stage 与 downstream 抛同一 shared Error 仍调用 combiner；await/return/catch/finally 消费 next 后传播只交付一次。 | AF-137 |
| AF-T138 | implemented-unverified | middleware unit | combiner 返回 undefined/null 时 rejection 值严格为该值；未提供 combiner 才产生 `EXECUTION_FAILED`。 | AF-138 |
| AF-T139 | implemented-unverified | logger unit | manual scheduler 单独推进 process deadline、batch interval/debounce；global timers 不调用，task receiver/cancel 与 sync callback 收敛。 | AF-139 |
| AF-T140 | implemented-unverified | logger SDD static | LG-R20～R22/LG-T19～T23 双向映射 AF-126/128/129 及本轮行为；129 为唯一最新 current count。 | AF-140 |
| AF-T141 | implemented-unverified | plugin-host SDD static | §0、§8、§9 精确包含 PH-R16～25 与 PH-T16a～25g，无遗漏/不存在 aggregate ID。 | AF-141 |
| AF-T142 | implemented-unverified | lifecycle unit | LifecycleScope 四 policy 下 hostile descriptor getter 单读；later resources 仍按 LIFO/order release、scope terminal、结果/finalize 正确。 | AF-142 |
| AF-T143 | implemented-unverified | logger unit | exit restore 与多个 removeListener 分别/同时失败仍全部尝试；aggregate 顺序保留，static state reset，下一 install/uninstall 成功。 | AF-143 |
| AF-T144 | implemented-unverified | logger unit | timeout/backoff task cancel throw 时 Promise 仍 settle、listener 清除、flush/shutdown 完成且 cleanup error exactly-once 可追踪。 | AF-144 |
| AF-T145 | implemented-unverified | foundation SDD static | AF-T126 层级标为 logger unit；E2E evidence 只声明实际 browser delivery/deadline 断言。 | AF-145 |

### 35.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 298、middleware-pipeline 36、plugin-host 150、serialize 124、logger 129 tests passed；plugin-host→logger direct consumer 126 tests 在 PH 修复点通过，随后 logger 本轮完整计数为 129；Logger `typecheck:browser` 与 Playwright E2E 2/2 通过。对应 package `fmt → lint → typecheck → typecheck:test → test → build` 与 `git diff --check` 均通过。package SDD 已追加 D-14/L-R10/L-T56、MP provenance/combiner cases、PH-T25e～g、serialize deadline clauses、LG-R20～R22/LG-T19～T23。

AF-134～AF-145 与 AF-T134～AF-T145 一一映射。AF-T126 的层级由 `logger unit/E2E` 纠正为 logger unit；Logger E2E 2/2 仅作为实际 browser delivery/deadline evidence。下一步必须由第十九轮 Sol 继续复核；最终八包/direct-consumer gates 前全部保持 implemented-unverified。Store 包、Store SDD 与 Store tests 继续排除。

## 36. 2026-08-18 第十九轮 Sol findings 与 Luna 整改

### 36.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-146 | implemented-unverified | plugin-host | HIGH | readonly callable 的 sync/async/thenable/iterator/generator 输出经过 lazy readonly output boundary；closure-captured external object 不得原样泄漏可写引用，receiver/laziness/alias/error identity 保持。 |
| AF-147 | implemented-unverified | middleware-pipeline | MEDIUM | next 返回的 Promise-compatible consumption tracking 覆盖 borrowed native Promise `then/catch/finally`；不得仅依赖 instance override 而把传播错误误报成双失败。 |
| AF-148 | implemented-unverified | serialize SDD | MEDIUM | serialize SDD 在 no-finding round 与最终门禁前保持 implemented-unverified，不得独立提前 verified。 |
| AF-149 | implemented-unverified | lifecycle SDD | MEDIUM | lifecycle 298 是唯一 latest current count；294 等旧计数明确 historical intermediate。 |
| AF-150 | implemented-unverified | plugin-host SDD | MEDIUM | plugin-host 143 等旧 evidence 标为 historical；当前 evidence 使用最新 full gate/count，并保持 PH-R26 pending Sol。 |
| AF-151 | implemented-unverified | middleware-pipeline SDD | MEDIUM | plugin-host 149/150 临时失败证据标为 historical/superseded；不得与后续 150/150、157/157 直接消费者结果并列 current。 |
| AF-152 | implemented-unverified | serialize | MEDIUM | root/`./core`/`./registry` 必须导出公开签名所需 registry options、scheduler、cleanup/timeout diagnostic、encoder/decoder types；emitted d.ts 与 package consumer 可命名。 |

### 36.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T146 | implemented-unverified | plugin-host unit/integration | sync/async/hostile thenable 与 sync/async generator yield/return 的 object output 只暴露 cached readonly view；mutation 失败，alias/receiver/laziness/rejection identity 不变。 | AF-146 |
| AF-T147 | implemented-unverified | middleware unit/integration | 通过 `Reflect.apply(Promise.prototype.then/catch/finally, nextResult, …)` 消费时传播错误仍原样一次；constructor/species 单纯读取不产生 false consumed，void next 仍可识别独立双失败。 | AF-147 |
| AF-T148 | implemented-unverified | serialize SDD static | header、requirements、cases 与 foundation gate 状态一致为 implemented-unverified。 | AF-148 |
| AF-T149 | implemented-unverified | lifecycle SDD static | 298 唯一 current；294/291/287 等均带历史限定。 | AF-149 |
| AF-T150 | implemented-unverified | plugin-host SDD static | 最新 157 及当前 gates 与 PH-R26/T26 映射存在；旧 143/150 计数带历史时点。 | AF-150 |
| AF-T151 | implemented-unverified | middleware SDD static | 149/150 failure 明示 superseded；middleware 43 与最新 plugin-host direct-consumer gate 分时点记录且不矛盾。 | AF-151 |
| AF-T152 | implemented-unverified | serialize package-boundary | 通过 package exports import 所有公开 registry types 并编译；emitted d.ts 不泄漏无法命名的内部 snapshot type。 | AF-152 |

### 36.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：middleware-pipeline 43、serialize 125、plugin-host 157、logger 129 tests passed；plugin-host pipeline 12/12、Logger browser E2E 2/2 通过。对应 package `fmt → lint → typecheck → typecheck:test → test → build`、serialize package-consumer gate 与 `git diff --check` 通过。package SDD 已追加 PH-R26/PH-T26a～g、middleware borrowed-Promise case、serialize export case，并校正 lifecycle/plugin-host/middleware/serialize evidence 状态。

AF-146～AF-152 与 AF-T146～AF-T152 一一映射。下一步必须由第二十轮 Sol 继续复核；只有一轮完整 Sol 无 confirmed HIGH/MED 且最终八包/direct-consumer gates 通过后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 37. 2026-08-18 第二十轮 Sol findings 与 Luna 整改

### 37.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-153 | implemented-unverified | serialize test | MEDIUM | AF-152 package consumer 必须从 root `@migaia/serialize` compile-use 全部 required public types；仅测试 `/registry` 不能证明 root re-export。 |
| AF-154 | implemented-unverified | logger | MEDIUM | BatchPlugin uninstall 必须取消全部 debounce/interval task、丢弃/按契约处理 buffer、阻止 late callback/core.defer，并隔离 reinstall；cancel failure 不阻断收敛。 |
| AF-155 | implemented-unverified | logger | MEDIUM | process final uninstall 与 shutdown cleanup 使用各自 canonical error code/text，不得冒用 install rollback；registry/JSDoc/触发 UT 一致。 |
| AF-156 | implemented-unverified | plugin-host | HIGH | callable output readonly facade 对 non-configurable/non-writable object-valued property 必须满足 ECMAScript Proxy invariants；frozen/sealed/non-extensible graph 可读且仍不可写。 |
| AF-157 | implemented-unverified | plugin-host | HIGH | Promise/thenable output 在整个 readonly graph 使用一个共享 boundary identity map；top-level promise 与 fulfilled object back-reference/alias 一致，nested await receiver 合法，rejection identity 保持。 |
| AF-158 | implemented-unverified / supersedes AF-125, AF-137, AF-147 | middleware-pipeline | MEDIUM | JavaScript 无法可靠推断任意 Promise 的 rejection provenance。删除 consumed/species 启发式；若 stage 与 downstream 两个观察通道都 reject，则始终按 `[stageError, downstreamError]` 组合，即使 identity/value 相等；单通道保持原值。 |
| AF-159 | implemented-unverified | middleware-pipeline SDD | MEDIUM | 154/155 与更早 consumer failure 明示 historical/superseded；当前 package/consumer evidence 与最终 closure pending 分离。 |
| AF-160 | implemented-unverified | serialize SDD | MEDIUM | package tests/build/d.ts/consumer/diff evidence 已通过，不得标成 pending；仅 final cross-package/no-finding closure pending，整体仍 implemented-unverified。 |
| AF-161 | implemented-unverified | lifecycle | MEDIUM | scheduler 接收/产生的 time/delay 必须有限，delay 非负；非法值在调用 injected scheduler 前 tagged INVALID_OPTION，过期 absolute deadline 规范化为 0/明确 early result。 |
| AF-162 | implemented-unverified | resource | MEDIUM | construction 的 initialSnapshot/autoStart/debugName options 单次 snapshot，在 runtime ownership/listener 前完成；hostile getter 不造成部分构造，captured snapshot 决定 hydrate/autostart。 |
| AF-163 | implemented-unverified | lifecycle | MEDIUM | boundedWait 先无条件观察 task；严格过期 deadline 返回 false 且不排程，exact-now 允许 delay 0；不得让 already/late rejection 变成 unhandled 或改变既有返回契约。 |

### 37.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T153 | implemented-unverified | serialize package-boundary | root、`./core`、`./registry` 各自从 package exports compile-use其承诺类型；删除任一 root re-export 会使 gate 失败。 | AF-153 |
| AF-T154 | implemented-unverified | logger unit | buffered batch uninstall 后所有 task cancel、late fire 无 callback/defer、reinstall 独立；cancel throw 仍终态并可追踪。 | AF-154 |
| AF-T155 | implemented-unverified | logger contract/unit | uninstall/shutdown cleanup 分别触发新 code，native primary/cause/errors 顺序与 registry count=14/JSDoc 对齐。 | AF-155 |
| AF-T156 | implemented-unverified | plugin-host unit | nonconfig/nonwritable object property、frozen/sealed/nonextensible/symbol/array graph 经 facade 读取不抛 invariant TypeError，mutation 被拒。 | AF-156 |
| AF-T157 | implemented-unverified | plugin-host unit | fulfilled object back-reference 指向同一 mapped Promise；nested await 成功，aliases/cycles 与 rejection identity/hostile then error 保持。 | AF-157 |
| AF-T158 | implemented-unverified | middleware + consumer | await/return next 的同一 Error 两通道按固定顺序组合；handled next 后独立 stage error不被吞；same object/undefined、borrowed methods、mutable constructor 均无需 provenance tracking；单失败原样。 | AF-158 |
| AF-T159 | implemented-unverified | middleware SDD static | 历史 failed counts 有 superseded 标签；当前 package/consumer count 唯一且 overall gate 未提前 verified。 | AF-159 |
| AF-T160 | implemented-unverified | serialize SDD static | 已通过 package evidence 与 pending final closure 分栏/措辞一致。 | AF-160 |
| AF-T161 | implemented-unverified | lifecycle unit | NaN/Infinity/negative delay 在 Generation/boundedWait/Queue/DisposeTransaction 前置拒绝；0 与 expired deadline 正常，scheduler 未接收非法值。 | AF-161 |
| AF-T162 | implemented-unverified | resource unit | options getter 各一次；第二值不影响行为；getter throw 前无 fetch/deps/timer；undefined 与 hydrate-no-autofetch 正确。 | AF-162 |
| AF-T163 | implemented-unverified | lifecycle + logger direct consumer | past deadline no schedule 且 false；exact-now delay0/cancel；already/late rejection 无 unhandled；logger LG-R5-3 全量通过。 | AF-163 |

### 37.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 308、resource 44、middleware-pipeline 34、plugin-host 164、serialize 125、logger 133 tests passed；logger error registry count=14，plugin-host/logger E2E 2/2 通过。对应 package gates、serialize 8 consumer configs 与 `git diff --check` 通过。MP-R14/15 与 MP-D06 被新 MP-R16/MP-D07/MP-T23～25 supersede；旧 AF-125/137/147 同步保留为历史设计，不再作为 active contract。

AF-153～AF-163 与 AF-T153～AF-T163 一一映射。下一步必须由第二十一轮 Sol 继续复核；只有完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 38. 2026-08-18 第二十一轮 Sol findings 与 Luna 整改

### 38.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-164 | implemented-unverified | logger | MEDIUM | global ProcessPlugin 的所有 participating cores 必须属于同一 scheduler source domain；相同原始 scheduler 经多次 snapshot 可加入，不同 domain 在 core registration 前拒绝且无 listener/core 泄漏。 |
| AF-165 | implemented-unverified | foundation SDD | MEDIUM | completion rule 覆盖本文所有 confirmed-finding sections（含未来追加），不得硬编码遗漏 §33+。 |
| AF-166 | implemented-unverified | foundation SDD | MEDIUM | audit baseline 明确为 2026-08-18 当前 dirty worktree；旧 2026-08-16 仅历史，不与最新 evidence context 并列。 |
| AF-167 | implemented-unverified | serialize SDD | MEDIUM | closure mapping 使用完整 `SER-T17-01` 等 stable ID，禁止裸 `T17-01`/`T18-01`/`T19-01`/`T20-01`。 |
| AF-168 | implemented-unverified | plugin-host SDD | MEDIUM | logger 129/4-fail 等并行中间 evidence 标为 historical/superseded；最新 full pass count 唯一 current。 |
| AF-169 | implemented-unverified | runtime-neutrality SDD | MEDIUM | `docs/contracts/runtime-neutrality.sdd.md` 迁为 mandatory top-level §0～§9，保留既有稳定 IDs 与语义、ownership/deps/tests/evidence/gates。 |
| AF-170 | implemented-unverified | plugin-host | HIGH | iterator output facade 使用 invariant-safe target，locked/frozen own next/return/throw/protocol properties 可包装且 raw receiver/laziness/result/error identity 保持。 |
| AF-171 | implemented-unverified | plugin-host | HIGH | callable object output facade 使用 invariant-safe callable forwarding target；locked object/symbol properties 可读 readonly view，call/construct/prototype 与 descriptor/ownKeys invariants 正确。 |
| AF-172 | implemented-unverified | serialize | MEDIUM | `@migaia/serialize/core` scheduler failures 由 serialize-owned INVALID_OPTION/native error 暴露，lifecycle 原错误仅作 cause；core 不泄漏 lifecycle source/text。 |
| AF-173 | implemented-unverified | lifecycle | MEDIUM | manual scheduler 的 `now+delay`/`now+advance` arithmetic result 必须 finite；overflow 在 clock/task/callback mutation 前拒绝，zero/finite edge/order 保持。 |
| AF-174 | implemented-unverified | resource | MEDIUM | finite TTL expiry arithmetic 不得 overflow 为 Infinity 并 dehydrate 成 null；overflow 在 success/cache publication 前 tagged reject，exact finite boundary/SWR/hydrate 保持。 |

### 38.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T164 | implemented-unverified | logger unit | 两 core 同 source scheduler accepted；不同 manual domain 以 config conflict 拒绝且无泄漏；first core 正常、final uninstall 后新 domain 可成为 owner。 | AF-164 |
| AF-T165 | implemented-unverified | foundation SDD static | closure condition 量化“每个 confirmed finding section”，追加新 section 不需改硬编码列表。 | AF-165 |
| AF-T166 | implemented-unverified | foundation SDD static | header 最新 baseline 与 §38 evidence 同为 2026-08-18 dirty worktree。 | AF-166 |
| AF-T167 | implemented-unverified | serialize SDD static | 19 requirements/21 cases 双向映射只引用完整已声明 SER-* IDs。 | AF-167 |
| AF-T168 | implemented-unverified | plugin SDD static | 历史 failed/intermediate counts 有标签；最新 logger 136 与 plugin 167 evidence 唯一 current。 | AF-168 |
| AF-T169 | implemented-unverified | runtime-neutrality SDD static | 顶层 0～9 各一次按序，legacy IDs 不重编号，§8 evidence/§9 risks+gates 完整。 | AF-169 |
| AF-T170 | implemented-unverified | plugin-host unit | locked/frozen iterator methods/protocol 与 descriptor inspection 无 native invariant TypeError；迭代/return/throw receiver、lazy wrapping与错误保持。 | AF-170 |
| AF-T171 | implemented-unverified | plugin-host unit | frozen callable output、locked object/symbol property 可 readonly 读取；call/new/derived/prototype/ownKeys/descriptors 与 mutation protection正确。 | AF-171 |
| AF-T172 | implemented-unverified | serialize core/package consumer | now getter/call/NaN/Infinity、schedule/task/cancel failures 全部 serialize source/code/native type，cause 精确；core subpath compile/run。 | AF-172 |
| AF-T173 | implemented-unverified | lifecycle unit | MAX_VALUE schedule/advance overflow reject且 state/task queue不变；valid maximum/zero/order 正常；graceful deadline arithmetic同 guard。 | AF-173 |
| AF-T174 | implemented-unverified | resource unit | MAX_VALUE now+ttl overflow 无 partial success/cache，RangeError INVALID_OPTION；near finite boundary、SWR、dehydrate/hydrate/retry delay正确。 | AF-174 |

### 38.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 311、resource 48、serialize 127、plugin-host 167、logger 136 tests passed；serialize consumer typecheck 与 Logger E2E 2/2 通过。runtime-neutrality SDD 已迁 §0～§9，foundation/serialize/plugin evidence 与 stable mappings 已修正。对应 package gates 与 `git diff --check` 通过。

AF-164～AF-174 与 AF-T164～AF-T174 一一映射。下一步必须由第二十二轮 Sol 继续复核；只有完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 39. 2026-08-18 第二十二轮 Sol findings 与 Luna 整改

### 39.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-175 | implemented-unverified | plugin-host | HIGH | iterator facade 仅对 protocol/method keys 使用 raw-receiver method wrapper；普通 accessor 保留 getter receiver/value/error，object result readonly wrap，locked descriptor invariants 与 symbol/alias/cycle 保持。 |
| AF-176 | implemented-unverified | serialize | MEDIUM | stream default yield 持有 scheduled-task ownership；同步/异步 callback 后 cancel exactly-once，schedule/task/cancel failure serialize-owned 且不悬挂 operation/dispose。 |
| AF-177 | implemented-unverified | serialize SDD | MEDIUM | Round21 mappings/evidence 只使用完整 `SER-T21-*` stable IDs，无裸 T21 引用。 |
| AF-178 | implemented-unverified | plugin-host SDD | MEDIUM | §8/§9 current evidence 唯一；133/164、129/4 等中间结果 historical/superseded，当前以最新 full pass 为准。 |
| AF-179 | implemented-unverified | middleware-pipeline SDD | MEDIUM | missing protectThenable 与 logger129/4 failure 明示历史/superseded；当前 consumer evidence 与 overall pending gate 不矛盾。 |

### 39.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T175 | implemented-unverified | plugin-host unit | nonextensible iterator 的 nonconfig ordinary getter 返回 readonly object且 receiver正确；getter throw identity、symbol accessor、descriptor getter、protocol method均正确。 | AF-175 |
| AF-T176 | implemented-unverified | serialize core unit | default yield task 在 sync/async callback、abort/dispose、schedule/invalid task/cancel getter/call 路径 cancel exactly-once；结果 settle且 source/code/cause正确、无 unhandled。 | AF-176 |
| AF-T177 | implemented-unverified | serialize SDD static | SER-T21-01/02/03 全称映射存在，bare T21 扫描为零。 | AF-177 |
| AF-T178 | implemented-unverified | plugin SDD static | latest current plugin-host 168/logger136 evidence 唯一，旧 counts 均历史限定。 | AF-178 |
| AF-T179 | implemented-unverified | middleware SDD static | superseded blockers不再作为 current；当前 middleware34、plugin168/logger136 时点 evidence 清晰且整体未提前 verified。 | AF-179 |

### 39.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：plugin-host 168、serialize 131 tests passed；logger direct consumer 136 与 E2E 2/2、serialize 8 consumer configs 通过。Round22 其他 Sol scopes 对 middleware、logger/reactive、lifecycle/resource/capability 均报告 0 confirmed HIGH/MED，但 plugin/serialize/docs 有 findings，因此不构成完整 no-finding round。对应 package gates 与 `git diff --check` 通过。

AF-175～AF-179 与 AF-T175～AF-T179 一一映射。下一步必须由第二十三轮 Sol 继续复核；只有完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 40. 2026-08-18 第二十三轮 Sol findings 与 Luna 整改

### 40.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-180 | implemented-unverified | logger | MEDIUM | HTTP POST 获得成功响应后即提交传输结果；后续 timer/listener cleanup failure 必须单独报告且不得进入 transport retry，避免重复发送。失败响应的 retry 仍由 status policy 驱动；primary 与 cleanup error 的 identity/order 必须可追踪。 |
| AF-181 | implemented-unverified | middleware-pipeline | HIGH | stage/downstream 已捕获失败必须先按 MP-R16 决议；post-stage host active check 仅适用于尚未失败的成功调度，不得以 `HOST_DISPOSING` 替换 stage、downstream 或 combined error。 |
| AF-182 | implemented-unverified | serialize | MEDIUM | owned yield 在注册 abort listener 后必须复检 signal，覆盖注册期间同步 abort 且宿主不 replay event 的竞态；部分注册、callback-then-throw 与 cancel failure 均须收敛且保留 primary/errors。 |
| AF-183 | implemented-unverified | runtime-neutrality SDD | MEDIUM | 文档 header、状态矩阵、历史 evidence 与当前 gate 必须区分；canonical current status 只有一个，已实现但未完成最终跨包复核时保持 `implemented-unverified`。 |
| AF-184 | implemented-unverified | lifecycle SDD | MEDIUM | 被 closure/evidence 引用的 L-R11 必须有唯一正式声明及测试映射，禁止悬空 requirement ID。 |
| AF-185 | implemented-unverified | lifecycle | MEDIUM | `systemScheduler.now()` 必须验证宿主 `performance.now()` 返回 canonical finite number；NaN、Infinity、非 number 或 getter/call failure 在时间值流入 consumer 前以既有 INVALID_OPTION/native error 契约暴露。 |
| AF-186 | implemented-unverified | plugin-host | HIGH | readonly config 不得通过 `Object.getPrototypeOf(view)` 泄漏原始自定义 prototype；prototype graph 必须拥有化并 readonly 映射，保留 cycles、aliases、方法/instance 需要的语义而不开放 raw mutation path。 |
| AF-187 | implemented-unverified | plugin-host | MEDIUM | iterator classification 不得 eager 读取 `next`/`Symbol.iterator` getter 或吞掉 getter error；使用 descriptor-based classification，实际访问时保持 lazy getter receiver、error identity 与 protocol 行为。 |

### 40.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T180 | implemented-unverified | logger unit/browser | 成功 POST 后 cleanup throw 只报告一次且总 POST 次数为 1；失败 status retry 次数仍正确，DELIVERY_FAILED 中 primary/cleanup 顺序稳定，shutdown/cancel 可终止。 | AF-180 |
| AF-T181 | implemented-unverified | middleware + direct consumer | stage-only、downstream-only、双失败在 host 同步转 disposing 后仍返回原始/组合错误；仅成功未完成 dispatch 才触发 active guard。 | AF-181 |
| AF-T182 | implemented-unverified | serialize unit/consumer | listener 注册期间同步 abort、部分 listener 注册、callback 后抛错与 cancel failure 均 settle；无 listener/task 泄漏、无 unhandled rejection，serialize source/code/cause 正确。 | AF-182 |
| AF-T183 | implemented-unverified | runtime-neutrality SDD static | header 与 canonical matrix 唯一 current；旧状态有 historical 标签，最终跨包 closure 仍 pending。 | AF-183 |
| AF-T184 | implemented-unverified | lifecycle SDD static | L-R11 声明唯一且映射 L-T57，所有引用均可解析。 | AF-184 |
| AF-T185 | implemented-unverified | lifecycle + resource direct consumer | host now 返回 NaN/Infinity/non-number 或抛错均前置拒绝；有效 0/finite 值、原生 fallback 与 consumer 行为保持。 | AF-185 |
| AF-T186 | implemented-unverified | plugin-host unit | custom prototype、prototype cycles/aliases、class-like object 通过 getPrototypeOf 只得到 owned readonly facade；修改被拒且 raw graph 不变。 | AF-186 |
| AF-T187 | implemented-unverified | plugin-host unit | hostile next/iterator getter 在 classification 时不执行；真实访问才执行一次并保留 receiver/error identity，locked descriptor 与 iterator protocol 正常。 | AF-187 |

### 40.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 316、resource 48、middleware-pipeline 39、serialize 137、plugin-host 178、logger 138 tests passed；plugin-host pipeline direct consumer 19、logger direct consumer 138、serialize 8 consumer configs 与 Logger E2E 2/2 通过。runtime-neutrality/lifecycle SDD 已补 canonical 状态矩阵与 L-R11/L-T57 映射。对应 package gates 与 `git diff --check` 通过；并行编辑期间的临时失败不作为 current evidence。

AF-180～AF-187 与 AF-T180～AF-T187 一一映射。下一步必须由第二十四轮 Sol 继续复核；只有六个独立审查域共同组成一轮完整 no-finding round，并在其后完成最终八包串行 gates，才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 41. 2026-08-18 第二十四轮 Sol findings 与 Luna 整改

### 41.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-188 | implemented-unverified | serialize | MEDIUM | 并发 encode operation 入队时必须立即取得 rejection ownership；前序 pending 不得使后序已拒绝 Promise 产生 `unhandledRejection`，同时保持输出顺序与最终 error identity。 |
| AF-189 | implemented-unverified | serialize | MEDIUM | chunk-shape 判定读取 hostile Array/Proxy 的 `length`、index 等属性时处于 codec error boundary 内；失败统一为 serialize `ENCODE_FAILED` 且原错误经 cause 可达。 |
| AF-190 | implemented-unverified | serialize | MEDIUM | `decodeStream`/`collectStream` 对 sync/async iterator acquisition、next、IteratorResult.done/value 与 thenable assimilation 的失败使用 stream-owned error boundary，不得原样泄漏未编码错误。 |
| AF-191 | implemented-unverified | serialize SDD | MEDIUM | `SER-R18-01～04` 与 `SER-R19-01～03` 必须各有唯一 canonical requirement declaration；所有 SER-T18/T19 映射可解析且禁止仅靠范围文本冒充声明。 |
| AF-192 | implemented-unverified | plugin-host SDD | MEDIUM | evidence chronology 只允许一个 latest/current 集合；Round23 178/138 为当前值，Round22 168/136 及更早结果明确 historical/superseded。 |
| AF-193 | implemented-unverified | logger SDD | MEDIUM | logger 直接依赖与 manifest/source 一致为 lifecycle/plugin-host；middleware-pipeline 经 plugin-host 传递，不得虚构直接依赖。 |
| AF-194 | implemented-unverified | logger | HIGH | Logger 构造必须在插件安装等副作用前 snapshot/admit 全部 public options；hostile `on` getter/entries failure 以 logger INVALID_OPTION 暴露且不得泄漏 plugin/listener/core。 |
| AF-195 | implemented-unverified | logger | HIGH | HTTP request 注册 shutdown abort listener 后复检 signal；已 abort 时不得启动未取消 POST，fresh controller 必须终止且 delivery/timer/listener 收敛。 |
| AF-196 | implemented-unverified | reactive | HIGH | Effect cleanup 同步 self-dispose 后，外层 run 不得执行 effect body或重新提交 dependency edge；终态 observer/binding 不可被 retrack/reentrant flow 复活。 |
| AF-197 | implemented-unverified | lifecycle | MEDIUM | Generation `begin` 的 timeout admission/derived delay validation 必须在 abortCurrent、generation increment 与 scheduler mutation 前完成；失败调用不改变当前 generation。 |
| AF-198 | implemented-unverified | resource | MEDIUM | Resource 构造的全部 public options 单次 snapshot 并在 ownership/listener/fetch 前验证；hostile getter 以 Resource INVALID_OPTION + cause 暴露，无部分构造。 |
| AF-199 | implemented-unverified | capability | MEDIUM | activation handle 的 hostile `dispose` getter failure 归类为 Capability INVALID_HANDLE，保留 cause、只读一次、不 adopt handle，后续 disable/dispose 收敛。 |
| AF-200 | implemented-unverified | plugin-host | HIGH | readonly facade 的 `getOwnPropertyDescriptor` 不得返回 raw accessor；descriptor getter 结果进入同一 readonly identity graph，setter/define/delete 均拒绝，并满足 locked descriptor Proxy invariants。 |

### 41.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T188 | implemented-unverified | serialize unit | maxInFlight=2、first pending、second reject 时 rejection observer 立即建立；first settle 前无 unhandled，最终顺序/error identity 正确。 | AF-188 |
| AF-T189 | implemented-unverified | serialize unit | chunk Proxy 的 length/index getter throw 均为 SerializeCodecError/ENCODE_FAILED/source，cause 精确且无 raw escape。 | AF-189 |
| AF-T190 | implemented-unverified | serialize unit/consumer | throwing iterator getter/next/done/value/hostile then 均带 stream operation/index/source/code/cause，cleanup 无泄漏。 | AF-190 |
| AF-T191 | implemented-unverified | serialize SDD static | 每个 mapped SER-R ID 恰有一个 canonical declaration；SER-R18/R19 全部解析，重复/缺失使测试失败。 | AF-191 |
| AF-T192 | implemented-unverified | plugin-host SDD static | 178/138 唯一 current；168/136 及旧计数只出现 historical/superseded 语境。 | AF-192 |
| AF-T193 | implemented-unverified | logger SDD/metadata static | SDD direct deps 与 manifest/import graph 一致，middleware 标为 transitive。 | AF-193 |
| AF-T194 | implemented-unverified | logger unit | hostile on getter/entries 在任何 plugin install 前失败；INVALID_OPTION TypeError/cause 正确，process listener/core count 回基线且可 reinstall。 | AF-194 |
| AF-T195 | implemented-unverified | logger unit/browser | shutdown 已 abort 后 handler-era log 不启动 live fetch或传入已 abort signal；pending settle、timer/listener 清理，AF-180 不回归。 | AF-195 |
| AF-T196 | implemented-unverified | reactive + resource consumer | cleanup self-dispose/retrack 时 effect body不再执行、subs=0、queue empty；重复 dispose 幂等且 observer/binding 不复活。 | AF-196 |
| AF-T197 | implemented-unverified | lifecycle unit | 当前 generation 后 begin(invalid timeout) 抛 INVALID_OPTION，旧 signal 未 abort、token仍 current、generation值不变。 | AF-197 |
| AF-T198 | implemented-unverified | resource unit | 九项 options getter 各读取一次；getter throw 前无 ownership/fetch/listener，INVALID_OPTION/cause 正确，defaults/undefined 语义保持。 | AF-198 |
| AF-T199 | implemented-unverified | capability unit | dispose getter throw 仅一次，failed result 为 INVALID_HANDLE/cause，无 adopted handle；disable/dispose 与 replacement 收敛。 | AF-199 |
| AF-T200 | implemented-unverified | plugin-host unit/consumer | descriptor getter 的 aliases/cycles/symbol/custom prototype 返回 readonly identity；setter/define/delete拒绝，locked accessor与 getter error identity 正确。 | AF-200 |

### 41.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 318、resource 57、capability 60、reactive 72、serialize 142、plugin-host 182、logger 141、middleware-pipeline 39 tests passed；serialize 8 consumer configs、plugin-host/logger direct consumers、storage-contract 11、web-rpc 552 与 Logger E2E 2/2 通过。Round24 package SDD 已新增或补齐对应 stable requirements/cases；plugin/logger evidence 与 dependency wording 已校正。对应 scoped `fmt → lint → typecheck → typecheck:test → test → build` 与 `git diff --check` 通过。并行 TDD 期间 Resource 的临时红测不作为 current evidence，联合 Luna 完成后的 57-test green 为当前值。

AF-188～AF-200 与 AF-T188～AF-T200 一一映射。下一步必须由第二十五轮 Sol 继续复核；本轮六个审查域均出现 confirmed findings，不构成 no-finding round。只有后续完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 42. 2026-08-18 第二十五轮 Sol findings 与 Luna 整改

### 42.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-201 | implemented-unverified | plugin-host | HIGH | Date/RegExp/Map/Set subclass admission 必须拥有化 custom prototype graph；readonly facade 的 `getPrototypeOf` 只返回 cached owned readonly prototype，禁止泄漏 caller raw prototype。 |
| AF-202 | implemented-unverified | middleware-pipeline | HIGH | `next()` 启动 downstream 时必须在同一同步路径立即建立 rejection ownership；upstream stage 持续 pending 不得使 downstream rejection 产生 unhandled，同时 MP-R16 双通道槽位/顺序/identity 不变。 |
| AF-203 | implemented-unverified | serialize | MEDIUM | `collectStream` 对每个 chunk 验证 exact tuple length、tag 与 payload domain；未知 tag/非法 text/bytes 以 INVALID_CHUNK + current index 拒绝，禁止静默 relabel。 |
| AF-204 | implemented-unverified | serialize | MEDIUM | encode/decode stream 的全部 caller options getter 单读并在 registry/scheduler/iterator side effect 前进入 serialize INVALID_OPTION admission boundary；cause identity 保持。 |
| AF-205 | implemented-unverified | cross-SDD | MEDIUM | authoritative AF 条款仍为 implemented-unverified 时，映射的 package requirement/decision/test 不得提前标 verified；跨文档 chronology 由可执行静态 gate 约束。 |
| AF-206 | implemented-unverified | lifecycle | HIGH | scheduler 同步执行 timeout callback 且 callback cleanup 失败时，错误先暂存到 task handle acquisition 完成；取得 task 后 exactly-once cancel，禁止 armed task 泄漏，并保留 primary/cancel/cleanup 顺序。 |
| AF-207 | implemented-unverified | logger | HIGH | HTTP abort listener registration 按“可能已生效”保守拥有；stored-then-throw/callback-then-throw 均 remove exactly once、abort request、settle delivery，registration primary 与 cleanup errors 可追踪。 |
| AF-208 | implemented-unverified | reactive | MEDIUM | 每个公开 `observerRun/start` 必须恰有一个 `end` 或 `error`；cleanup self-dispose 是成功终态，依赖图不复活且 trace span 不悬空。 |

### 42.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T201 | implemented-unverified | plugin-host unit/consumer | Map/Set/Date/RegExp subclass view prototype 与 source prototype 非同一对象；prototype mutation拒绝、source不变、重复访问 identity稳定，aliases/cycles/intrinsic parent 正确。 | AF-201 |
| AF-T202 | implemented-unverified | middleware + plugin-host consumer | upstream gate pending、downstream reject 时 gate release 前零 unhandled；release 后 final exact downstream error，dual/same/undefined cases仍按 MP-R16。 | AF-202 |
| AF-T203 | implemented-unverified | serialize unit | unknown tag、wrong tuple length、wrong text/bytes payload 均 INVALID_CHUNK/source/current index；valid mixed chunks拼接不变。 | AF-203 |
| AF-T204 | implemented-unverified | serialize unit/consumer | context/type/signal/maxInFlight 等每个 getter throw 只读一次并返回 INVALID_OPTION/cause；无 registry/scheduler/iterator admission。 | AF-204 |
| AF-T205 | implemented-unverified | lifecycle static SDD | AF-181/197/198/199/200 与 14 个 package mappings 逐项解析；AF 未 verified 时 package status 出现 verified 即失败。 | AF-205 |
| AF-T206 | implemented-unverified | lifecycle + consumers | sync callback + parent remove throw 后 task cancel once/armed=false；cancel getter/call、schedule after-callback throw、cleanup retry 的 primary/errors identity/order正确。 | AF-206 |
| AF-T207 | implemented-unverified | logger unit/browser | stored-then-throw、callback-then-throw、remove throw、already-aborted、重复发送均零 live listeners/timers；flush/shutdown settle，成功 POST 不重试。 | AF-207 |
| AF-T208 | implemented-unverified | reactive + resource consumer | cleanup self-dispose/reentrant retrack/repeated dispose/cleanup throw 的每个 trace start 恰有 end或error；无双终态、subs/queue保持终态。 | AF-208 |

### 42.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 323、resource 57、capability 60、reactive 76、serialize 148、middleware-pipeline 40、plugin-host 185、logger 147 tests passed；serialize 8 consumer configs、middleware/plugin-host/logger direct consumers 与 Logger E2E 2/2 通过。跨 SDD chronology static regression 1/1 通过；L-R14/L-T60、Resource/Capability Round24、MP-D08、PH-R34 与 Reactive Round24/25 均保持 implemented-unverified。对应 scoped `fmt → lint → typecheck → typecheck:test → test → build` 与 `git diff --check` 通过。一次 workspace-filtered pnpm 在离线 registry/module purge 前失败，package-local gates 已成功；该环境事件不冒充代码通过或失败。

AF-201～AF-208 与 AF-T201～AF-T208 一一映射。下一步必须由第二十六轮 Sol 继续复核；本轮六个审查域仍有 confirmed findings，不构成 no-finding round。只有后续完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 43. 2026-08-18 第二十六轮 Sol findings 与 Luna 整改

### 43.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-209 | implemented-unverified | logger | HIGH | HTTP request timeout 与 retry-backoff scheduler 同步 callback 后仍返回 armed task 时，handle acquisition 后必须 exactly-once cancel；callback 先发生不得使 handle 丢失。 |
| AF-210 | implemented-unverified | middleware-pipeline | HIGH | runner-generated post-stage active guard error 只有一个 control owner；上游 await/return next 不得把同一 active error重复放入 stage/downstream slots。真正独立的 same-identity dual failures 仍组合。 |
| AF-211 | implemented-unverified / breaking behavior | capability | HIGH | async disposer 返回/await 在途 `host.dispose()` 不得与 host drain 形成环。为保留 async cleanup completion，首次 dispose 返回 completion Promise；在途重复调用以 HOST_TRANSITIONING fail-fast；完成后重复调用复用 canonical completed Promise。 |
| AF-212 | implemented-unverified | plugin-host | HIGH | COW root-reacher graph 包含 owned non-intrinsic prototype edges；prototype→root/ancestor back-reference 在新 snapshot 重绑定，禁止混合 old/new snapshot。 |
| AF-213 | implemented-unverified | serialize | MEDIUM | chunk admission 验证后返回已读取 tag/payload 的安全冻结快照；不得返回 stateful Proxy 供 collectStream 二次读取，payload identity 与 getter failure metadata 保持。 |
| AF-214 | implemented-unverified | serialize | MEDIUM | encodeStream 对 registry.encode 同步 throw 与异步 reject 使用同一 indexed ENCODE_FAILED boundary，并在入队时立即取得 rejection ownership。 |
| AF-215 | implemented-unverified | logger | HIGH | Process listener registration 按可能已存储保守拥有；`on()` stored-then-throw 时 rollback remove exactly once，构造失败/reinstall/final uninstall 后零残留。 |
| AF-216 | implemented-unverified | logger | MEDIUM | Process/Batch scheduler 同步 callback 返回 armed handle 时与 HTTP 使用同一 callback-before-handle ownership，不得丢 task 或产生 late work。 |
| AF-217 | implemented-unverified | reactive | MEDIUM | Effect/Computed observer trace 的 terminal clock/timestamp/sink failure 被诊断边界包含；任何已发 start 恰有一个 end/error，诊断错误不替换 user primary。 |

### 43.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T209 | implemented-unverified | logger unit/browser | request timeout/retry backoff 同步 callback + armed task 均 cancel once、armed=false、无 late callback；cancel/schedule failure identity/order正确。 | AF-209 |
| AF-T210 | implemented-unverified | middleware + consumers | downstream short-circuit 后 closing 的 activeError 在 nested await/return next 路径保持 exact；ordinary same-error dual failure仍 `[e,e]`。 | AF-210 |
| AF-T211 | implemented-unverified | capability + consumers | delayed disposer self-call/await 收敛且报告 HOST_TRANSITIONING；外部在途 repeat fail-fast；first promise等待正常 async cleanup；完成后 repeat复用 canonical Promise。 | AF-211 |
| AF-T212 | implemented-unverified | plugin-host unit/consumer | ordinary及 branded prototype root/ancestor cycles 在 patch 后指向 new root；old snapshot隔离、failed patch不变、无 back-reference 时仍结构共享。 | AF-212 |
| AF-T213 | implemented-unverified | serialize unit | stateful tag/payload Proxy 验证后无法换值；返回 frozen tuple，Uint8Array identity保持，getter throw 带 INVALID_CHUNK/index/cause。 | AF-213 |
| AF-T214 | implemented-unverified | serialize unit/consumer | registry.encode sync throw 在前序 pending/maxInFlight 下无 raw escape/unhandled，最终 indexed ENCODE_FAILED、FIFO/backpressure保持。 | AF-214 |
| AF-T215 | implemented-unverified | logger unit | first process registration stored-then-throw 后 listener count 回基线；reinstall/uninstall 零残留，primary/rollback errors 可达。 | AF-215 |
| AF-T216 | implemented-unverified | logger unit | HTTP/Process/Batch 同步 callback returning armed task 全部 exact-once cancel；callback/schedule/cancel/getter组合无泄漏。 | AF-216 |
| AF-T217 | implemented-unverified | reactive + resource consumer | Effect/Computed 成功/失败的 terminal clock或sink throw 后 trace平衡；diagnostic report一次、primary/error graph/state不变。 | AF-217 |

### 43.3 intentional behavior change：Capability dispose in-flight repeat

- 旧行为：首次 `dispose()` 后、cleanup 尚在途时，任何重复调用均返回同一 completion Promise；disposer 若异步返回/await 该 Promise，会与 host drain 相互等待而永久挂起。
- 新行为：首次调用仍返回并等待完整 cleanup；cleanup 在途期间重复调用以 canonical `HOST_TRANSITIONING` 失败；cleanup 完成后重复调用复用已完成 canonical Promise。
- 影响：依赖“在途多调用者共享同一 Promise identity”的调用方必须保存并复用首次返回值；完成后的幂等性不变。disposer 不再能通过异步 self-dispose 挂死 host。
- 理由：标准 JavaScript 无 async caller-context，无法区分 delayed disposer-origin call 与外部 call；canonical in-flight identity、等待所有 async disposer、允许 disposer await host.dispose 三者不可同时满足。选择 fail-fast，避免静默提前完成或时间猜测。
- 兼容处理：公开 types/README/USEGUIDE、Capability SDD 与 lifecycle migration SDD 同步更新；删除/替换旧 in-flight identity assertions，保留 post-completion canonical identity cases。

### 43.4 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 323、resource 57、capability 61、reactive 82、serialize 152、middleware-pipeline 43、plugin-host 188、logger 157 tests passed；serialize 8 consumer configs、direct consumers 与 Logger E2E 2/2 通过。对应 package `fmt → lint → typecheck → typecheck:test → test → build`、browser typecheck、SDD closure/static chronology tests 与 `git diff --check` 通过。pnpm wrapper/端口 sandbox 的中间环境失败已由等价 installed-binary/package-local gates 或授权 E2E 重跑取代，不作为 current failure evidence。

AF-209～AF-217 与 AF-T209～AF-T217 一一映射。下一步必须由第二十七轮 Sol 继续复核；本轮六域仍有 confirmed findings，不构成 no-finding round。只有后续完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 44. 2026-08-18 第二十七轮 Sol findings 与 Luna 整改

### 44.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-218 | implemented-unverified | plugin-host | HIGH | callable clone 保留函数对象自身的 non-intrinsic `[[Prototype]]`，并纳入 owned graph/COW rebase；不得只处理 callable own `.prototype`。 |
| AF-219 | implemented-unverified | serialize | MEDIUM | registry.encode 同步 throw 与异步 reject 都作为 indexed observed Promise 进入 FIFO；后序 sync failure 不得跳过前序 pending/success output。 |
| AF-220 | implemented-unverified | serialize/runtime-neutrality | MEDIUM | `@migaia/serialize/core` 的实际 import graph/bundle 不加载 lifecycle 或任何 workspace package；signal/controller ownership 必须 serialize-local runtime-neutral。 |
| AF-221 | implemented-unverified | logger | HIGH | frozen/sealed/non-extensible cleanup error 无法原地 tag 时，使用可 tag wrapper 保留 native prototype/stack 与 original cause；tag failure 不得替换 primary或中断后续 cleanup。 |
| AF-222 | implemented-unverified | logger | HIGH | Process runtime diagnostic reporter 的 sync/async/hostile thenable failure被统一 containment；不得产生 unhandled rejection 或递归触发 process signal。 |
| AF-223 | implemented-unverified | middleware-pipeline | HIGH | downstream entry guard 与 post-stage guard 使用同一 frame-local control ownership；host 在 deferred entry 前 closing 时 exact active error 只传播一次，不进入双失败 combiner。 |

### 44.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T218 | implemented-unverified | plugin-host unit/consumer | callable custom [[Prototype]] root/ancestor cycle admission保留并在 patch 重绑定；rollback、readonly identity、call/construct与结构共享正确。 | AF-218 |
| AF-T219 | implemented-unverified | serialize unit | maxInFlight=2、index0 pending success、index1 sync throw：先 yield index0，再在下一 drain 抛 index1 ENCODE_FAILED；零 unhandled。 | AF-219 |
| AF-T220 | implemented-unverified | serialize package/bundle | core import graph与bundle扫描无 `@migaia/lifecycle`/workspace deps；abort identity/race仍通过。 | AF-220 |
| AF-T221 | implemented-unverified | logger unit | frozen/sealed Error、primitive/non-Error cleanup throw 均继续清理后续 listener；top-level logger code可用，original exact可达且顺序稳定。 | AF-221 |
| AF-T222 | implemented-unverified | logger unit/browser | write/console reporter rejected Promise、hostile then getter/invocation/rejection均零 unhandled、仅一次 diagnostic attempt，业务 primary不变。 | AF-222 |
| AF-T223 | implemented-unverified | middleware + plugin-host consumer | upstream await/return next 后 host 在 downstream entry 前 closing，exact HOST_DISPOSING 无 AggregateError/errors槽；真实 same-identity dual failure仍组合。 | AF-223 |

### 44.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 323、resource 57、capability 61、reactive 82、serialize 154、middleware-pipeline 46、plugin-host 191、logger 162 tests passed；serialize core bundle/import graph 零 workspace dependency，8 consumer configs 通过；plugin-host PH-T07a stale `PIPELINE_FAILED` assertion 已替换为 exact `HOST_DISPOSING` consumer contract；Logger E2E 2/2 通过。对应 package gates、browser/consumer typechecks、runtime-neutrality/SDD closure checks 与 `git diff --check` 通过。

AF-218～AF-223 与 AF-T218～AF-T223 一一映射。下一步必须由第二十八轮 Sol 继续复核；虽然第二十七轮 lifecycle/resource/capability 与 docs/contracts 两域报告零 finding，其余代码域仍有 confirmed findings，故不构成完整 no-finding round。只有后续完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 45. 2026-08-18 第二十八轮 Sol findings 与 Luna 整改

### 45.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-224 | implemented-unverified | plugin-host | HIGH | custom prototype 本身为 config-reachable callable 时，prototype clone cache 接受 object/function 两类已有 clone；禁止以 plain object 覆盖 function graph entry，结果与 property order 无关。 |
| AF-225 | implemented-unverified | reactive | HIGH | Signal/Computed/Effect 等 graph mutation 的 trace clock/sink/reporter failure 只影响诊断；value/version/dirty propagation/dependency commit/queue 必须完成且 primary语义不变。 |
| AF-226 | implemented-unverified | logger | MEDIUM | frozen-error fallback wrapper 保留自身构造 stack，不覆写为 original stack；original stack 仅通过 exact cause 链保留，符合 error contract。 |
| AF-227 | implemented-unverified | plugin-host/middleware SDD | MEDIUM | 已修正的 plugin-host stale assertion 与 logger 临时 failures 只能作为 historical/superseded；每份 SDD 恰有一个 current evidence set，与 umbrella/current package counts一致。 |

### 45.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T224 | implemented-unverified | plugin-host unit/consumer | `{parentFn, child}` 与反序都保持 parent callable、child prototype alias同一 owned facade；COW cycle/rollback/call/construct/intrinsic边界正确。 | AF-224 |
| AF-T225 | implemented-unverified | reactive + resource consumer | timestamp/now/sink/reporter 在 Signal/Computed/Effect/action 各阶段抛错时，value/version与依赖传播完成、trace/queue平衡、diagnostic报告不替换 primary。 | AF-225 |
| AF-T226 | implemented-unverified | logger unit/browser | wrapper stack非空且是 wrapper construction stack，未等于/覆盖 original stack；cause exact、source/code/native prototype与 aggregate order保持。 | AF-226 |
| AF-T227 | implemented-unverified | SDD static | middleware/plugin-host 旧 190/1、157/5 等失败段带 historical/superseded；current 唯一为 middleware46/plugin194/logger163 等最新证据。 | AF-227 |

### 45.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 323、resource 57、capability 61、reactive 86、serialize 154、middleware-pipeline 46、plugin-host 194、logger 163 tests passed；direct consumers、serialize core neutrality/bundle、Logger E2E 2/2、browser/consumer typechecks 与 `git diff --check` 通过。logger stale copied-stack assertion 已替换；middleware/plugin-host SDD 旧 failure evidence 均显式 historical/superseded，最新 current heading 唯一。

AF-224～AF-227 与 AF-T224～AF-T227 一一映射。下一步必须由第二十九轮 Sol 继续复核；第二十八轮 serialize、middleware、lifecycle/resource/capability 三域报告零 finding，但 plugin-host、logger/reactive、docs 域仍有 confirmed findings，因此不构成完整 no-finding round。只有后续完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 46. 2026-08-18 第二十九轮 Sol findings 与 Luna 整改

### 46.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-228 | implemented-unverified | middleware-pipeline | HIGH | child active-control metadata 仅在该 frame 最终传播 exact control error 时向 parent 上行；frame 转而抛 independent stageError 时清除/不传播 stale control metadata。 |
| AF-229 | implemented-unverified | SDD/static gate | MEDIUM | AF-T227 必须有真实可执行测试，且 current evidence counts 从 umbrella 最新证据解析/校验；新增 UT 后不得因硬编码旧 count 产生漂移。 |
| AF-230 | implemented-unverified | serialize | MEDIUM | signal snapshot 缓存 pre-aborted state/reason；raceAbort 不二次读取 caller raw aborted/reason，hostile getter failure统一 INVALID_OPTION/cause。 |
| AF-231 | implemented-unverified | serialize | MEDIUM | registry/stream 聚合路径的 injected encoder getter/call/return failure 使用 serialize source/code/index/progress/cause，禁止 raw escape 或 partial output ambiguity。 |
| AF-232 | implemented-unverified | plugin-host | HIGH | ordinary/array object clone 在遍历 custom prototype/properties 前先注册 shell；prototype→owning nested object 重入复用同一 clone，禁止 duplicate identity split。 |
| AF-233 | implemented-unverified | resource | MEDIUM | scheduler.now getter/call/invalid value 在成功 settlement 与 passive freshness read 均映射 Resource INVALID_OPTION/cause；cache/snapshot publication 原子、被动失败稳定 fail-closed。 |

### 46.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T228 | implemented-unverified | middleware + consumers | outer void/await/return next、middle independent stageError、inner entry/post-stage control error 时 final exact stageError；纯 control 与真实 dual cases不回归。 | AF-228 |
| AF-T229 | implemented-unverified | lifecycle static SDD | AF-T227 test存在并从 umbrella latest evidence 取得 middleware/plugin/logger counts，校验两 SDD current唯一；历史 counts可保留但必须 superseded。 | AF-229 |
| AF-T230 | implemented-unverified | serialize unit/consumer | aborted getter first read成功、second would throw时不再二读；reason identity/registration race正确，其他 getter failure带 INVALID_OPTION。 | AF-230 |
| AF-T231 | implemented-unverified | serialize unit/consumer | mixed text/bytes 的 encoder method getter/call/invalid return 在 registry/collectStream 均带正确 code/index/progress/cause，receiver正确且无部分输出。 | AF-231 |
| AF-T232 | implemented-unverified | plugin-host unit/consumer | proto.child===child 及深层 variants admission/COW/rollback 后 exact alias；readonly identity、property order、root/ancestor cycles与无关结构共享正确。 | AF-232 |
| AF-T233 | implemented-unverified | resource + reactive consumer | settlement/passive read now throw/NaN/Infinity 均 Resource INVALID_OPTION/cause；稳定 rejected Promise/state、retry/SWR/keepAlive/reporter/cache metadata一致。 | AF-233 |

### 46.3 实现证据与下一轮门禁

2026-08-18 dirty-worktree Luna evidence：lifecycle 324、resource 64、capability 61、reactive 86、serialize 161、middleware-pipeline 46、plugin-host 198、logger 163 tests passed；serialize 8 consumers/core neutrality、direct consumers、Logger E2E 2/2 与 package gates 通过。AF-T227 executable static gate 已存在；本节声明最新 current counts `middleware 46 / plugin-host 198 / logger 163`，旧 194/163 与更早 counts 仅为历史轮次。`git diff --check` 通过。

AF-228～AF-233 与 AF-T228～AF-T233 一一映射。下一步必须由第三十轮 Sol 继续复核；第二十九轮 logger/reactive 域报告零 finding，其余审查域仍有 confirmed findings，故不构成完整 no-finding round。只有后续完整 no-finding round 与最终八包串行 gates 后才可闭合。Store 包、Store SDD 与 Store tests 继续排除。

## 47. 2026-08-18 第三十轮最终深度审查与 Luna 整改

### 47.1 confirmed findings

| ID | 状态 | Owner | 严重度 | 契约 |
| --- | --- | --- | --- | --- |
| AF-234 | verified | lifecycle | MEDIUM | 所有公开 scheduler option 入口单读快照 hostile getter；读取失败映射 native `TypeError` + lifecycle `INVALID_OPTION`，exact cause/stack 可达且无 task/scheduler side effect。 |
| AF-235 | verified | resource/SDD | MEDIUM | Resource SDD 不得继续把已修复的 AF-T227 记录为 blocker；唯一 current evidence 必须与 umbrella 最终计数一致。 |
| AF-236 | verified | serialize | MEDIUM | plugin-list 的 length/entries/iterator `next/done/value` 均属于 admission boundary；任何 trap failure 映射 serialize `INVALID_OPTION`，parser ownership 为零。 |
| AF-237 | verified | serialize/SDD | MEDIUM | Serialize Round29 状态与依赖陈述一致；仅 registry 可依赖 lifecycle，core/stream/signal 保持 workspace-neutral。 |
| AF-238 | verified | middleware-pipeline | MEDIUM | Contract correction：在保持 middleware 可见 exact error identity 时，runtime 无法区分 direct await-next propagation 与 catch-and-rethrow 同一 control Error；同一实例折叠为一个语义失败，独立可区分双通道仍按序组合。 |
| AF-239 | verified | middleware-pipeline/SDD | MEDIUM | Middleware 唯一 current evidence 必须记录最终 package/plugin-host consumer pass，旧 failure wording 仅可 historical/superseded。 |
| AF-240 | verified | reactive | HIGH | dependency commit 期间 `onObserved` 重入 dispose 后必须停止并回滚新增 reverse edges；终态 observer 的 deps/version/subscribers 全清且不得复活。 |
| AF-241 | verified | repository metadata/logger SDD | HIGH | umbrella 与八包 normative SDD 不得被 `docs/*` 永久忽略；Logger 只保留一个 current evidence set，旧轮次全部 historical/superseded。 |
| AF-242 | verified | logger/resource/serialize SDD static | MEDIUM | static chronology gate 必须校验八包 result status、blocker absence、dependency、唯一 current evidence 与 umbrella 最终计数，且不依赖 Git index。 |
| AF-243 | verified | plugin-host | HIGH | custom-prototype accessor 闭包无法被安全拥有化时必须在安装前拒绝，禁止 caller-root 通过 accessor 重新进入并分裂 readonly/COW graph identity。 |
| AF-244 | verified | plugin-host metadata | MEDIUM | 发布包必须包含 README 相对链接指向的 `USEGUIDE.md`，package-content test 在不 publish 的情况下证明链接完整。 |

### 47.2 TDD/文档验收矩阵

| Case | 状态 | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- | --- |
| AF-T234 | verified | lifecycle unit | hostile scheduler getter 在 boundedWait 与所有公开 factory/controller 中只读一次；TypeError/source/code/cause/stack 与零 side effect。 | AF-234 |
| AF-T235 | verified | resource/lifecycle SDD static | Resource current evidence 无 stale AF-T227 blocker，计数/状态匹配 umbrella。 | AF-235 |
| AF-T236 | verified | serialize unit | plugin-list length/entries/iterator next/done/value traps 全部 INVALID_OPTION/cause，且零 parser ownership。 | AF-236 |
| AF-T237 | verified | serialize SDD static/package | 禁止 `signal -> lifecycle` 陈述；core neutrality、Round29 chronology 与最终 169 tests/8 consumers 一致。 | AF-237 |
| AF-T238 | verified | middleware regression/static | catch-and-rethrow exact same active error 保持 exact、combiner 零次；可区分双失败仍组合。 | AF-238 |
| AF-T239 | verified | middleware/plugin-host SDD static | Middleware 47 tests、plugin-host 202 tests、blocker none，旧失败段 historical/superseded。 | AF-239 |
| AF-T240 | verified | reactive unit | A→B commit 中 B onObserved dispose 后 A/B/selector subscribers 全零，重复 dispose 与后续写入 inert。 | AF-240 |
| AF-T241 | verified | repository/logger SDD static | `.gitignore` 精确放行九份 normative SDD；Logger 恰有一个 current evidence set。 | AF-241 |
| AF-T242 | verified | lifecycle static | 八包 current evidence 的 verified 状态、blocker、dependency 与最终计数全部匹配 umbrella，检查不读取 Git index。 | AF-242 |
| AF-T243 | verified | plugin-host unit | custom prototype accessor root-alias 在 admission 前以 canonical INVALID_OPTION 拒绝，无 partial install；COW/旧 snapshot 隔离保持。 | AF-243 |
| AF-T244 | verified | plugin-host package-content | package files 包含 USEGUIDE，README 每个相对链接均可解析且无需 publish。 | AF-244 |

### 47.3 实现证据与最终门禁

2026-08-18 dirty-worktree final current counts `lifecycle 329 / resource 64 / capability 61 / reactive 87 / serialize 169 / middleware 47 / plugin-host 202 / logger 163`. 八包均按依赖顺序串行通过 `fmt → lint → typecheck → typecheck:test → test → build`；Logger 另通过 `typecheck:browser` 与 Playwright E2E 2/2；仓库提供的八环境 consumer typecheck 通过；`git diff --check` 通过。八包 SDD 均只有一个 Round30 current evidence set，状态 `verified`、`blocker: none`、依赖方向与最终计数一致。Store packages、Store SDDs 与 Store tests 未进入写集或门禁。

AF-234～AF-244 与 AF-T234～AF-T244 一一映射，全部为 `verified`。第三十轮是用户指定的最终完整深度审查：六域共确认 4 HIGH、7 MEDIUM，现均由实现、契约修正、静态门禁或发布内容测试闭合；不再启动第三十一轮。

### 47.4 最终对抗自查与交付裁定

- 边界与极端输入：scheduler getter、plugin-list Proxy/iterator、prototype accessor、reentrant graph commit 均有 dedicated regression。
- 失败、一致性与幂等：native error type、source/code/cause/stack、dual-channel order、terminal edge rollback、重复 dispose 均由 package tests 覆盖。
- 误用与发布边界：exact-same control error 的不可区分性已显式写入 MP-R22/MP-D12；plugin-host README 相对链接由 package-content test 约束；normative SDD ignore policy 可执行验证。
- 残余风险：无 active HIGH/MEDIUM finding；dirty worktree 仅表示证据尚未绑定 commit SHA，不把状态冒充 clean checkout。Store 重构改动属于用户既有工作，本轮未修改、未审查、未纳入完成声明。
