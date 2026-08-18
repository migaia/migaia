# `@migaia/reactive` Round24/25/26/28 terminal disposal and trace-commit SDD

- 状态：**verified**（2026-08-18；dirty worktree）；Round30 重入销毁修复与最终 package/direct-consumer gates 已闭合
- 范围：`packages/reactive/**`、`docs/reactive/**`；Round24 修复 Effect rerun 终态重入，Round25 修复 observer-run trace 终态闭合，Round26 修复诊断时钟/trace sink 失败下的 observer-run terminal 闭合，Round28 修复 observable/dependency trace clock failure 导致的 partial graph commit
- Owner：`@migaia/reactive` runtime / synchronous dependency-graph owner
- 影响包：`@migaia/reactive`；直接消费者只作只读验证，尤其 `@migaia/resource`，不修改其文件
- 前置：[`docs/lifecycle/migration.sdd.md`](../lifecycle/migration.sdd.md)、[`docs/lifecycle/lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)、[`docs/contracts/runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md)、[`docs/contracts/error-codes.md`](../contracts/error-codes.md)
- 关联：`M-D02`、`M-R03`、`M-R09`、`M-R10`、`M-T36`、`M-T41`
- 性质：Round24/25/26/28 implementation + behavior contract + evidence update；不改变 Store、logger、foundation audit 或其他包

## 0. 状态与闭合规则

### 0.1 状态规则

本文件使用 `pending → red → implemented → verified`；`implemented-unverified` 表示实现存在但仍待本轮证据审查。只有所有非 deferred 条款、测试和门禁均有可复现证据，才可改为 `verified`。本批次没有 `blocked` 或 `deferred` 条款。

### 0.2 稳定 ID 与 dirty baseline

本批次新增稳定 ID 前缀 `RT24-D*`/`RT25-D*`/`RT26-D*`/`RT28-D*`（design）、`RT24-R*`/`RT25-R*`/`RT26-R*`/`RT28-R*`（requirement）、`RT24-T*`/`RT25-T*`/`RT26-T*`/`RT28-T*`（test）、`RT24-E*`/`RT25-E*`/`RT26-E*`/`RT28-E*`（evidence）。既有 `M-*` ID 只作关联，不重编号、不复用。

历史批次开始时工作区为 dirty：`git status --short` 共 286 条记录，且 `packages/reactive` 已有 Round23 等未提交改动。Round28 验证期间观察到 dirty 状态共 341 条记录（含本批次新增测试）；所有验证必须以 dirty baseline 为上下文，不能把其他包改动归入本批次成果。

## 1. 目标与范围

### 1.1 目标

修复以下 HIGH 缺陷：Effect 重跑先执行旧 cleanup；旧 cleanup 同步调用同一 Effect 的 disposer 后，外层 `run()` 仍进入 `runTracked()`，并提交新依赖边。随后 `dispose()` 早退，导致已终止 Effect 留在 source `subs` 中，形成永久 dead subscription。

Round25 同时修复 MED 缺陷：`Effect.run()` 已发出 `observerRun/start` 后，cleanup 同步 self-dispose 走 terminal early return，未发出且只应发出一次的成功 `observerRun/end`，造成 trace span unmatched。

Round26 修复 MED 缺陷：`Effect`/`Computed` 已发出 `observerRun/start` 后，终态 `timestamp()` 或 `now()` 抛错会中断 terminal event 构造/发出，造成 unmatched span；诊断 sink 抛错还可能掩盖成功或 body error。

Round28 修复 HIGH 缺陷：`Signal.value = next` 已提交值/version 后，observable-change trace 的 `timestamp()` 抛错会在 subscriber snapshot/`markDirty()` 之前逃逸，导致业务状态已变而下游图未传播。相同的 commit-before-diagnostic gap 也存在于 Runtime source publish 与 DependencyTracker 的 connect/disconnect trace；任何 trace clock、sink 或 reporter failure 都必须停留在诊断边界，不能阻止 graph commit、dirty propagation、queue balance 或 primary setter/body error。

### 1.2 范围与非目标

- 范围：`Effect.run()` 的 cleanup/追踪终态守卫、`DependencyTracker.runTracked()` 的提交准入、`createObserverBinding().retrack()` 的终态返回值、observer-run start/end/error 平衡审计、`runtime/diagnostics.ts` 的 failure-contained observer span，以及 `packages/reactive/test/` 中的 Round24/25/26 TDD cases。
- 非目标：重写 Scheduler、版本时钟、Computed 求值、lifecycle 原语、Store binding、错误码表、错误主体文案或跨包 API。
- Round26 的历史非目标是改变 observable/dependency/action trace 时钟路径；Round28 明确纳入这些路径的 failure containment，但仍不把诊断失败升级为业务/调度错误。
- 不新增错误码：终态是合法生命周期状态，不是 thrown error；现有 native error aggregation、`source`/`code`/`cause`/`AggregateError.errors` 语义保持不变。

## 2. 现状与问题

### 2.1 Owner 与现有路径

`@migaia/reactive` 拥有同步依赖图、版本边和 batch；`Effect` 拥有用户 cleanup 与 observer 生命周期；`DependencyTracker` 拥有边的事务性捕获/提交；`Scheduler` 拥有待执行队列。`resource` 只复用 reactive graph，不取得这些内部状态的所有权。

### 2.2 缺陷时序

```text
source write → scheduler enqueue(effect) → Effect.run()
  → detach old cleanup
  → cleanup() → effect.dispose()
  → old deps cleared, queue dequeued, disposed = true
  → BUG: runTracked(effect, body) still runs and commits source → effect
  → later dispose() early-returns; source.subs keeps dead effect
```

缺陷同时污染 binding `retrack()`：若 retrack 期间 cleanup 使 observer 进入 terminal，旧实现仍比较清空前后的依赖集合并返回 `changed`，调用方无法得到 `no-observer` 的终态信号。

## 3. 架构裁定与依赖方向

### 3.1 所有权

| ID | 裁定 |
| --- | --- |
| RT24-D01 | Effect 是 cleanup 与终态状态的 owner；cleanup 返回后必须重新检查 `disposed`，终态 Effect 不得再次执行 body。 |
| RT24-D02 | DependencyTracker 是依赖边提交 owner；`runTracked()` 只允许非 terminal observer 提交 capture，避免调用方复制边清理逻辑。 |
| RT24-D03 | Observer binding 只暴露 `committed / stale / no-observer` 三态；retrack 在 run 期间观察到 terminal 必须返回 `no-observer`。 |
| RT24-D04 | Scheduler 仍拥有 enqueue/dequeue 与 flush；dispose 继续负责 dequeue，guard 不新增第二条队列或取消路径。 |
| RT25-D01 | Effect 是 observer-run trace span owner；每个已发出的 `start` 必须由同一次 run 的恰好一个 `end` 或 `error` 终结。 |
| RT25-D02 | cleanup self-dispose、body terminal admission 与 binding retrack 的 early return 走统一 terminal closure；成功 terminal 不得伪装成 `error`。 |
| RT25-D03 | cleanup throw 保留原 error identity 与既有 report/flush 路径，只发一个 `error`，不得追加 `end`。 |
| RT26-D01 | `runtime/diagnostics.ts` 是 observer-run trace clock/read/emit containment owner；Effect 与 Computed 复用同一 controller，不各自复制 fallback 状态机。 |
| RT26-D02 | start clock failure 通过既有 `Runtime.reportError(..., { phase: trace-listener, observer })` 上报，并以数值 `0` 作为缺失 start sample；body、graph 与 scheduler 继续原路径。 |
| RT26-D03 | terminal clock failure 同样上报；`timestamp()` 回退到 start timestamp，`now()` 回退到 start monotonic sample，保证已发出的 start 恰有一个 terminal event。 |
| RT26-D04 | trace sink/terminal construction failure 只属于诊断失败：controller 吞并后报告、terminal closure 幂等；业务 body error 原样重抛，成功 body 不被诊断失败改为失败。 |
| RT28-D01 | `runtime/diagnostics.ts` 是所有 trace timestamp/read/emit 的 failure-containment owner；Signal、Runtime source publish、DependencyTracker、Effect、Computed、action 不各自复制 reporter/fallback 语义。 |
| RT28-D02 | 业务 commit/graph mutation 先完成其既有 owner 语义，诊断 event 通过 safe emit 尝试，随后继续 subscriber dirty propagation、dependency commit 或 queue 操作；诊断失败不回滚或替换业务结果。 |
| RT28-D03 | observable/dependency trace clock failure 使用数值 `0` fallback，并经 `trace-listener` report；reporter 自身抛错再次 containment，不能逃出 Signal setter、source notify、dispose 或 retrack。 |

### 3.2 依赖方向与复用

依赖方向保持：`lifecycle ← reactive` 的契约方向由跨包 SDD 维护，但 reactive 本包继续零 workspace runtime dependency；`Effect → DependencyTracker → graph primitives`，`ObserverBinding → Effect/DependencyTracker`。不引入 lifecycle、Store、DOM、Node 或 adapter 反向依赖。

复用既有 `Effect.dispose()`、`DependencyTracker.clearDependencies()`、`Scheduler.dequeue()` 和 binding 三态协议；拒绝增加 wrapper、第二个 terminal controller、binding-local edge cleanup 或 scheduler queue。

## 4. 公开契约/核心设计

### 4.1 Requirements

| ID | Requirement | 状态 |
| --- | --- | --- |
| RT24-R01 | Cleanup 可同步终止 Effect 时，cleanup 返回后的 `run()` 必须停止；effect body 不得再次执行。 | implemented |
| RT24-R02 | Effect 进入 terminal 后，当前 tracked transaction 不得提交依赖边；旧边、source `subs` 和 scheduler queue 必须保持清空。 | implemented |
| RT24-R03 | Cleanup 仍由原有 single-owner slot 管理：成功 rerun 前清旧 cleanup，terminal/dispose 后不重复执行；重复 disposer 调用保持幂等。 | implemented |
| RT24-R04 | Binding retrack 若在 cleanup 中终止 observer，必须返回 `no-observer`；普通依赖变化仍按原语义返回 `changed`/`unchanged`。 | implemented |
| RT24-R05 | 本修复不得改变 Scheduler 的 queue ownership、flush error aggregation、native error type、错误链 identity 或 binding capture/commit 语义。 | implemented-unverified |
| RT25-R01 | `observerRun/start` 后 cleanup 同步 self-dispose 的 `run()` 必须发出恰好一个成功 `observerRun/end`，不得发 `error`。 | implemented-unverified |
| RT25-R02 | cleanup throw 必须保留原 error trace/report identity，发出恰好一个 `error`，且不再发 `end`。 | implemented-unverified |
| RT25-R03 | Effect early returns、reentrant binding retrack 与 repeated dispose 不得造成 double terminal、重跑、依赖复活或 scheduler queue 残留。 | implemented-unverified |
| RT26-R01 | Effect 与 Computed 的 start `now()`/`timestamp()` 抛错时，诊断失败必须 report、start 必须仍可发出、body/derivation 必须继续执行并成功闭合。 | implemented-unverified |
| RT26-R02 | 已发出 start 后 terminal `now()`/`timestamp()` 抛错时，成功 body 必须仍发出恰好一个 `end`，失败 body 必须仍发出恰好一个 `error`。 | implemented-unverified |
| RT26-R03 | terminal diagnostic failure 不得替换 Effect/Computed body error identity，不得改变 Computed dirty/dependency graph 或 Effect scheduler/queue 结果。 | implemented-unverified |
| RT26-R04 | trace sink 抛错必须通过既有 report boundary 被报告；其它 sink 仍收到平衡 span，业务执行不被 sink failure 中断。 | implemented-unverified |
| RT26-R05 | repeated Effect disposal 与 Computed recompute/disposal 保持 terminal 幂等：不新增 terminal、不重复 cleanup、不复活依赖边。 | implemented-unverified |
| RT28-R01 | Signal setter 在 trace `timestamp()`、sink 或 reporter failure 下仍保留已提交 value/version，并对完整 subscriber snapshot 按既有顺序标脏；setter 不抛诊断错误。 | implemented-unverified |
| RT28-R02 | Computed/Effect 的 dependency connect/disconnect trace clock/sink failure 不得中断正式依赖边 commit、retrack、dispose 或后续一次更新；每个节点只更新一次，queue/trace 保持平衡。 | implemented-unverified |
| RT28-R03 | Runtime source publish 与 Signal 使用同一 safe observable trace policy；版本已提交后，notify/commitSource 必须继续 dirty propagation，诊断 failure 不能替换 source write 结果。 | implemented-unverified |
| RT28-R04 | Clock failure、sink failure、reporter failure 均只能经既有 `trace-listener` report boundary 处理；reporter 抛错不得泄漏为业务异常或破坏 primary error identity。 | implemented-unverified |

### 4.2 Terminal-aware run protocol

`Effect.run()` 顺序固定为：检查 terminal → 取出并清空旧 cleanup → untracked 执行旧 cleanup → 再检查 terminal → `runTracked()` → 若 tracking 期间进入 terminal，消费本轮返回的 cleanup 而不保存 → 否则保存新 cleanup。`runTracked()` 在 body 返回后、提交前再次检查 `observer.disposed`，因此 body 或 cleanup 触发的 terminal transition 都不能提交新边。

`retrack()` 先检查 observer，再运行一次；run 返回后再次检查 `disposed`，terminal 优先返回 `no-observer`，否则才比较 dependency versions。

Round25 trace protocol：`run()` 发出 `start` 后，所有 body/cleanup early return 均经过同一 `finally`。若 run 成功（包含 terminal early return）发出一个 `end`；若 cleanup/body 抛错，catch 发出一个 `error` 后 finally 禁止追加 `end`。`retrack()` 本身不另发 observer-run terminal event，复用其 Effect run 的唯一 span。

Round26 diagnostic protocol：controller 先读取并保存 start samples；每次 clock read 或 `emitTrace` 都在诊断边界内执行。start read 失败报告并回退 `0`；terminal timestamp 回退 start timestamp，terminal duration end sample 回退 start monotonic sample。controller 先锁定 terminal，再构造/发出一个 `end` 或 `error`；sink/构造失败报告但不重新抛出。该 controller 不接管依赖 capture、Computed dirty、Effect cleanup 或 Scheduler queue。

Round28 commit/diagnostic protocol：Signal 与 Runtime source 先领取并写入 value/version，DependencyTracker 先完成边集合变更；之后由 `emitTraceSafely()` 读取 timestamp（失败回退 `0`）、构造并发送 event（sink failure report/contain），最后无条件回到原有 dirty/queue/lifecycle continuation。`reportError` 也受同一 boundary 保护。Effect/Computed observer-run 继续复用 Round26 controller；其 start/end `now()`/`timestamp()` fallback 与 RT28 observable/dependency safe emit 不合并为第二套状态机。

## 5. 生命周期与错误语义

### 5.1 Reentrancy、cleanup 与队列

- cleanup 内调用同一 Effect disposer 是合法终态重入：首次 `dispose()` 标记 terminal、清边、清 cleanup slot、dequeue；后续 disposer 调用 no-op。
- cleanup 抛错时仍沿既有 `runtime.untracked()` → Effect run error trace → Scheduler flush aggregation/report 路径传播；本批次不吞错、不替换 primary error。
- terminal guard 只阻断 rerun/commit，不回滚或重排 Scheduler 的外层 batch ownership；外层 flush 继续排空其余 item。
- `retrack()` 终止后不再访问已终止 observer 的依赖变化结果，调用方收到 `no-observer`，可结束 binding 生命周期。
- trace span 与 reactive lifecycle 分离：repeated `dispose()` 是幂等 no-op，不创建新 observer-run span，也不重复 terminal event。
- observer-run diagnostic failure 与 reactive lifecycle 分离：clock/sink failure 经 `trace-listener` report；fallback 只保证 trace 形状，不写入 graph，不 enqueue/dequeue，不覆盖 primary error。

### 5.2 Error policy

本批次没有新 boundary error，因此不改 `src/error-code.ts` 或注册表。现有 `throw`、`collect`、`report`、`firstError` 行为由 Scheduler/Runtime 原路径负责：单 observer error 原样保留，多 observer error 使用既有 `AggregateError`，reporter failure 继续 containment；任何 cleanup catch 仍必须 report 或 rethrow。

Round26 不新增 boundary error。Clock/sink failure 属于 `report`：通过既有 `Runtime.reportError` 发送，`onError` 抛错仍由 Runtime containment 吞并；不向 observer body `throw`，不进入 Scheduler aggregation。Body/cleanup failure 仍属 `throw`/既有 Scheduler `collect`/`firstError` 路径，terminal trace 的 `error` 字段保持原对象引用。Fallback 不冒充业务时间，也不改变公开 error code。

### 5.3 其他边界

close/dispose race、cancellation、deadline、late rejection、partial construction rollback 不属于 reactive synchronous Effect 的新状态机；本批次只验证其相关的 queue/dispose idempotency 不被破坏，并由 lifecycle/resource SDD 继续拥有异步语义。

## 6. 迁移与实施批次

执行顺序遵循 `inventory → red test → contract/error registration → implementation → delete duplicate/compatibility path → docs/exports/dependencies → package gates → direct-consumer gates → repository gates → evidence`：

| 批次 | 内容 | 退出条件 | 状态 |
| --- | --- | --- | --- |
| RT24-1 | 盘点 Effect、Tracker、Binding、Scheduler ownership；记录 dirty baseline | 缺陷时序与 owner 可追溯 | implemented-unverified |
| RT24-2 | 新增 `RT24-T01`/`RT24-T02` red cases；随后补充 `RT24-T03` terminal admission case | T01/T02 在旧实现上失败；T03 在实现前置后加入并纳入最终 suite | implemented-unverified |
| RT24-3 | 加 terminal guards；不引入兼容 wrapper 或新错误码 | Round24 cases 通过，边/队列/幂等断言成立 | implemented-unverified |
| RT24-4 | 更新本 SDD 的 IDs、映射和门禁证据 | 所有非 deferred clause 有命令/结果/日期/dirty context | implemented-unverified |
| RT25-1 | 审计 Effect、Computed、runTracedAction、Tracker、binding retrack 的 trace early-return/reentrant paths | 每个 start 有唯一 end/error 归属；既有 error path 不变 | implemented-unverified |
| RT25-2 | 新增 trace-enabled `RT25-T01`–`RT25-T04` red cases | cleanup self-dispose、binding terminal、cleanup throw、repeated dispose 均被钉住 | implemented-unverified |
| RT25-3 | 以统一 finally closure 补齐 Effect terminal success span；不新增错误码或兼容路径 | Round25 cases green；无 double terminal | implemented-unverified |
| RT25-4 | 执行 package/direct-consumer/repository gates 并回填证据 | 命令、结果、日期、dirty context 可复现 | implemented-unverified |
| RT26-1 | 盘点 Effect/Computed observer-run terminal clock、sink、body error 与 graph/scheduler 边界；保留 dirty baseline | start/terminal failure ownership 与 fallback/report 裁定可追溯 | implemented-unverified |
| RT26-2 | 新增 `RT26-T01`–`RT26-T06` red cases，覆盖 Effect/Computed、成功/失败 body、start/terminal clock、sink throw、重复生命周期 | 旧实现至少暴露 terminal clock abort 或 primary error/trace closure 缺陷 | implemented-unverified |
| RT26-3 | 在 `runtime/diagnostics.ts` 实现共享 failure-contained observer trace controller；Effect/Computed 只接入，不复制 state machine | clock/sink failure report；每个 emitted start 恰一个 terminal；业务错误/graph/scheduler 保持原语义 | implemented-unverified |
| RT26-4 | 更新本 SDD 的 RT26 IDs、映射、证据与门禁状态；不修改 error registry/其他包 | 所有非 deferred 条款有可复现命令、结果、日期、dirty context | implemented-unverified |
| RT28-1 | 盘点 Signal setter、Runtime source publish、DependencyTracker connect/disconnect 与 observer trace 的 commit-before-diagnostic gap；保留 dirty baseline | owner、传播顺序、fallback/report policy 与相似路径可追溯 | implemented-unverified |
| RT28-2 | 新增 `RT28-T01`–`RT28-T04` red cases，覆盖 Signal value/version、Computed/Effect dependency admission、source publish、timestamp/sink/reporter failure、queue/trace balance | 旧路径至少暴露 setter、dependency admission 与 source publish 的 diagnostic escape | implemented-unverified |
| RT28-3 | 由 `runtime/diagnostics.ts` 提供 safe clock/event emission；Signal、Runtime、DependencyTracker 复用；不新增错误码或兼容路径 | 诊断失败 report/fallback/contain；业务 commit、dirty propagation、dependency graph、queue 与 primary error 不变 | implemented-unverified |
| RT28-4 | 更新本 SDD 的 RT28 IDs、映射、证据；执行 package/direct-consumer/repository gates | 所有非 deferred 条款有命令、结果、日期、dirty context；scope 仍只含 reactive/docs | implemented-unverified |

## 7. 测试与验收矩阵

### 7.1 Round24 cases

| ID | 层级 | 语义断言 | 覆盖 |
| --- | --- | --- | --- |
| RT24-T01 | reactive unit | rerun cleanup self-disposes；body 不再执行；cleanup 恰好一次；source `subs` 为 0；flush 返回 completed 且无待办；重复 stop 幂等 | RT24-R01/R02/R03/R05 |
| RT24-T02 | reactive binding unit | cleanup-triggered `binding.retrack()` 使 observer terminal；返回 `no-observer`；body 不重跑；source `subs` 为 0；再次 retrack/stop 不重复 cleanup | RT24-R01/R02/R03/R04/R05 |
| RT24-T03 | reactive unit | body 在 tracking 中 self-dispose；tracker 不提交捕获边；返回 cleanup 仍恰好消费一次，source `subs` 为 0，重复 stop 幂等 | RT24-R01/R02/R03/R05 |

### 7.2 Round25 trace cases

| ID | 层级 | 语义断言 | 覆盖 |
| --- | --- | --- | --- |
| RT25-T01 | reactive trace unit | cleanup self-dispose 的 rerun phases 为 `start,end`；无 `error`；body 不重跑；source `subs` 为 0；flush completed；repeated stop 不重复 cleanup | RT25-R01/RT25-R03 |
| RT25-T02 | reactive binding trace unit | terminal `binding.retrack()` phases 为 `start,end`；返回 `no-observer`；无 `error`；body/cleanup/依赖边不复活；repeated retrack/stop 幂等 | RT25-R01/RT25-R03 |
| RT25-T03 | reactive trace/error unit | cleanup throw phases 为 `start,end,start,error`；error 与 report 保持同一 identity；不追加 end | RT25-R02 |
| RT25-T04 | reactive trace/lifecycle unit | repeated dispose 不新增 observer-run event；初始 span 仍恰为 `start,end`；cleanup 只执行一次 | RT25-R03 |

### 7.3 Round26 diagnostic-failure cases

| ID | 层级 | 语义断言 | 覆盖 |
| --- | --- | --- | --- |
| RT26-T01 | reactive trace unit | Effect start `now()` 与 `timestamp()` 各自抛错时，两个诊断错误均经 report，仍收到 `start,end`，body 执行一次，source edge 保留且 flush 无待办 | RT26-R01/RT26-R03 |
| RT26-T02 | reactive trace unit | Computed start clocks 抛错时，仍收到 `start,end`，derivation 成功一次，source→Computed dependency edge 正常建立，重复 dispose 不破坏清理 | RT26-R01/RT26-R05 |
| RT26-T03 | reactive trace unit | Effect terminal `timestamp()` 与 `now()` 抛错时，成功 body 仍只有一个 `end`，两个 diagnostic errors 被 report，source edge 与 scheduler state 不变 | RT26-R02/RT26-R03 |
| RT26-T04 | reactive trace/error unit | Computed body error 在 terminal clocks 抛错时仍按引用出现在唯一 `error` event 并原样抛出；第二次 recompute 仍可失败，未提交 source edge，dispose 幂等 | RT26-R02/RT26-R03/RT26-R05 |
| RT26-T05 | reactive trace/error unit | Effect body error 在 terminal clocks 抛错时仍按引用出现在唯一 `error` event 并原样抛出；body 读取的 source edge 不被部分提交 | RT26-R02/RT26-R03 |
| RT26-T06 | reactive trace/lifecycle unit | 一个 throwing sink 不阻断第二个 sink；Effect repeated dispose 只执行一次 cleanup，Computed repeated recompute 形成平衡 spans，sink failures 经 report | RT26-R04/RT26-R05 |

### 7.4 Round28 graph-commit diagnostic-failure cases

| ID | 层级 | 语义断言 | 覆盖 |
| --- | --- | --- | --- |
| RT28-T01 | reactive trace/graph unit | Signal setter 的 `timestamp()` 抛错后仍不抛异常；value/version 已提交；Computed/Effect 各更新一次；所有 observer-run spans 为等量 `start/end`；queue 完成；observable event 使用 `0` fallback 并报告 clock error | RT28-R01/RT28-R04 |
| RT28-T02 | reactive trace/graph unit | Computed 首次 dependency connect 与 Effect 首次 dependency connect 的 timestamp failure 均不阻断边 admission；每个节点只执行一次，后续 source update 正常传播 | RT28-R02/RT28-R04 |
| RT28-T03 | reactive trace/graph unit | Signal setter 同时面对 timestamp、trace sink、reporter 抛错时仍保持 value/version、setter 不抛、Effect 不被伪重跑；reporter failure 不越过 boundary | RT28-R01/RT28-R04 |
| RT28-T04 | reactive source/graph unit | Runtime field source publish 的 observable trace timestamp failure 不阻断 version publish 或 subscriber dirty；Effect 后续只更新一次且 queue 完成 | RT28-R02/RT28-R03/RT28-R04 |

### 7.5 Required gates

- package：`fmt → lint → typecheck → typecheck:test → test → build`（使用 `packages/reactive/package.json` 实际脚本）。
- direct consumer：`@migaia/resource` package tests/build/typecheck where scripts exist；不得修改 resource 或 Store。
- repository：non-Store direct-consumer checks requested by Round24/25 and `git diff --check`；Store/logger/foundation audit 不在本批次改动范围。

## 8. 证据与闭合映射

### 8.1 Requirement ↔ test mapping

| Clause | Cases | Evidence requirement |
| --- | --- | --- |
| RT24-R01 | RT24-T01, RT24-T02, RT24-T03 | Assertions explicitly check body count and terminal retrack result; RT24-T03 also covers terminal body admission. |
| RT24-R02 | RT24-T01, RT24-T02, RT24-T03 | Assertions explicitly check source `subs.size === 0`; RT24-T01 additionally checks flush has no work. |
| RT24-R03 | RT24-T01, RT24-T02, RT24-T03 | Assertions explicitly check cleanup count remains exactly once for cleanup-triggered disposal and twice only when the body returned a terminally consumed cleanup. |
| RT24-R04 | RT24-T02 | Assertion explicitly checks `retrack() === 'no-observer'` both terminalizing and after terminal. |
| RT24-R05 | RT24-T01, RT24-T02, RT24-T03 + existing reactive suite | Commands must record scheduler, aggregation, export, and regression results; no behavior-change clause is introduced. |
| RT25-R01 | RT25-T01, RT25-T02 | Assertions explicitly compare observer-run phases and prove terminal self-dispose/retrack uses one successful end with zero error events. |
| RT25-R02 | RT25-T03 | Assertions explicitly compare `start,end,start,error`, prove `event.error === cleanupError`, report identity, and absence of a second end. |
| RT25-R03 | RT25-T01, RT25-T02, RT25-T04 + RT24-T01/02/03 | Assertions explicitly prove no rerun, no dependency resurrection, empty queue, `no-observer`, and cleanup/disposer idempotency. |
| RT26-R01 | RT26-T01, RT26-T02 | Assertions explicitly prove both start clock failures are reported while Effect/Computed body execution and successful `start,end` closure continue. |
| RT26-R02 | RT26-T03, RT26-T04, RT26-T05 | Assertions explicitly compare one successful `end` or one body-identity-preserving `error` after terminal clock failures; no unmatched/double terminal is accepted. |
| RT26-R03 | RT26-T01, RT26-T03, RT26-T04, RT26-T05 | Assertions explicitly check source edge retention or non-commit, flush completion, repeated recompute, and exact body error identity. |
| RT26-R04 | RT26-T06 | Assertions explicitly check throwing sink failures are reported and a second sink still receives all six observer-run phases. |
| RT26-R05 | RT26-T02, RT26-T04, RT26-T06 | Assertions explicitly check repeated dispose/recompute does not add terminal events, duplicate cleanup, or resurrect dependencies. |
| RT26-D01 | RT26-T01–RT26-T06 | All six cases exercise the shared diagnostics controller through public Effect/Computed paths; no feature-local fallback helper is introduced. |
| RT26-D02 | RT26-T01, RT26-T02 | Start clock throws are observed in `onError`, fallback start timestamp is `0`, and successful body/graph behavior remains observable. |
| RT26-D03 | RT26-T03, RT26-T04 | Terminal clock throws are observed in `onError`, terminal phase remains present, and duration/timestamp fallback does not alter body result/error. |
| RT26-D04 | RT26-T04, RT26-T05, RT26-T06 | Body error identity remains exact; sink failures are reported and contained; repeated terminal calls do not produce a second event. |
| RT28-R01 | RT28-T01, RT28-T03 | Assertions explicitly prove Signal value/version commit, no setter throw, full subscriber propagation, and reporter/sink failure containment. |
| RT28-R02 | RT28-T02, RT28-T04 + RT26-T06 | Assertions explicitly prove dependency/source graph admission survives diagnostic failure, Computed/Effect update counts, sink isolation, and queue completion. |
| RT28-R03 | RT28-T04 | Assertion explicitly proves Runtime field source publish proceeds from committed version to dirty subscriber after observable trace timestamp failure. |
| RT28-R04 | RT28-T01, RT28-T02, RT28-T03, RT28-T04 + RT26-T01–RT26-T06 | Assertions and existing observer-run cases cover timestamp/now/sink/reporter failures, fallback/report policy, primary error preservation, and balanced trace behavior. |
| RT28-D01 | RT28-T01–RT28-T04 + RT26-T01–RT26-T06 | Public Signal, source, Computed, and Effect paths exercise one diagnostics owner; no local fallback controller is added. |
| RT28-D02 | RT28-T01, RT28-T02, RT28-T04 | Assertions prove business commit/edge mutation and subsequent dirty/queue continuation are independent of diagnostic failure. |
| RT28-D03 | RT28-T01–RT28-T04 | Assertions verify fallback/report behavior at observable/dependency trace boundaries and reporter containment. |

### 8.2 Evidence log

| ID | Command | Result | Date / worktree |
| --- | --- | --- | --- |
| RT24-E01 | `./node_modules/.bin/vitest run packages/reactive/test/reentrant-disposal.test.ts` before implementation | red: 2 tests failed (body reran; retrack returned `unchanged`) | 2026-08-18; dirty baseline |
| RT24-E02 | same command after implementation | green: 1 file, 3 tests passed | 2026-08-18; dirty baseline |
| RT24-E03 | reactive `fmt → lint → typecheck → typecheck:test → test → build` | green: formatter 33 files; lint pass; typecheck pass; test typecheck pass; 6 files/72 tests pass; build pass | 2026-08-18; dirty baseline |
| RT24-E04 | resource direct-consumer `typecheck`, `typecheck:test`, `test`, `build` | typecheck/build pass; test typecheck fails with 2 existing `options-admission.test.ts` type errors; full tests 48 passed/3 failed in that same dirty untracked suite; excluding it, 4 files/48 tests pass | 2026-08-18; existing out-of-scope dirty resource changes |
| RT24-E05 | `git diff --check` plus whitespace scan of new ignored SDD/test | green: no diff-check or trailing-whitespace diagnostics; repository already ignores `docs/`, so SDD is present but not shown by ordinary status | 2026-08-18; dirty baseline |
| RT25-E01 | `./node_modules/.bin/vitest run packages/reactive/test/round25.test.ts` before implementation | red: T01/T02 had unmatched `start`; T03 test harness initially required scheduler report semantics and was corrected before implementation verification | 2026-08-18; dirty baseline |
| RT25-E02 | `./node_modules/.bin/vitest run packages/reactive/test/round25.test.ts` after implementation | green: 1 file, 4 tests passed | 2026-08-18; dirty baseline |
| RT25-E03 | `oxfmt src test`; `oxlint src test`; `tsc -p tsconfig.json --noEmit`; `tsc -p tsconfig.test.json`; `vitest run test`; `tsc -p tsconfig.build.json` in `packages/reactive` | green: formatter 34 files; lint/typecheck/test-typecheck/build pass; 7 files/76 tests pass | 2026-08-18; dirty baseline |
| RT25-E04 | `oxlint src test`; `tsc -p tsconfig.json --noEmit`; `tsc -p tsconfig.test.json`; `vitest run test`; `tsc -p tsconfig.build.json` in `packages/resource` | green: lint/typecheck/test-typecheck/build pass; 5 files/57 tests pass; resource files untouched | 2026-08-18; dirty baseline |
| RT25-E05 | `git diff --check` plus trailing-whitespace scan for new Round25 test/SDD | green: no diagnostics; ordinary status still reflects pre-existing dirty edits outside this scope | 2026-08-18; dirty baseline |
| RT26-E01 | `./node_modules/.bin/oxfmt packages/reactive/src packages/reactive/test`; `./node_modules/.bin/vitest run packages/reactive/test/round26.test.ts packages/reactive/test/round25.test.ts packages/reactive/test/reentrant-disposal.test.ts` | green: formatter 35 files; 3 files/13 tests pass; direct local binaries used after pnpm script was blocked by registry metadata/no-TTY module cleanup | 2026-08-18; dirty baseline; implementation-unverified pending full gates |
| RT26-E02 | reactive direct gates: `oxfmt packages/reactive/src packages/reactive/test`; `oxlint src test`; `tsc -p tsconfig.json --noEmit`; `tsc -p tsconfig.test.json`; `vitest run test`; `tsc -p tsconfig.build.json` | green: format 35 files; lint pass; source/test typecheck pass; 8 files/82 tests pass; build pass | 2026-08-18; dirty baseline; local installed binaries |
| RT26-E03 | resource direct-consumer gates: `oxlint src test`; `tsc -p tsconfig.json --noEmit`; `tsc -p tsconfig.test.json`; `vitest run test`; `tsc -p tsconfig.build.json` | green: lint/source/test typecheck pass; 5 files/57 tests pass; build pass; resource files untouched; resource fmt intentionally not run because scope excludes `packages/resource/**` | 2026-08-18; dirty baseline; local installed binaries |
| RT26-E04 | `git diff --check`; `rg -n "[[:blank:]]+$" packages/reactive docs/reactive` | green: no diff-check or trailing-whitespace diagnostics; current scoped status contains pre-existing reactive dirty edits plus Round26 files; SDD is ignored by repository status but present at target path | 2026-08-18; dirty baseline |
| RT28-E01 | `CI=true pnpm --filter @migaia/reactive test -- round28.test.ts` before implementation | red: T01 Signal setter timestamp escaped, T02 Computed dependency admission timestamp escaped, T03 setter timestamp escaped; after test harness corrected to enable trace in T02, failure reproduced on 3/3 cases | 2026-08-18; dirty baseline |
| RT28-E02 | `CI=true pnpm --filter @migaia/reactive fmt` | green: oxfmt completed on 36 files; includes existing dirty reactive files and new RT28 test | 2026-08-18; dirty baseline |
| RT28-E03 | `CI=true pnpm --filter @migaia/reactive test -- round28.test.ts` after implementation | green: 9 test files, 86 tests passed; command uses package script and its current full-test behavior | 2026-08-18; dirty baseline |
| RT28-E04 | `CI=true pnpm --dir packages/reactive fmt`; `lint`; `typecheck`; `typecheck:test`; `test`; `build` | green: fmt 36 files; lint pass; source/test typecheck pass; 9 files/86 tests pass; build pass | 2026-08-18; dirty baseline; `--dir` used to avoid pnpm filter/tsc wrapper warning |
| RT28-E05 | `CI=true pnpm --dir packages/resource lint`; `typecheck`; `typecheck:test`; `test`; `build` | green: resource lint/source/test typecheck pass; 5 files/57 tests pass; build pass; resource fmt not run because scope excludes `packages/resource/**` | 2026-08-18; dirty baseline; resource read-only consumer gate |
| RT28-E06 | `git diff --check`; `rg -n "[[:blank:]]+$" packages/reactive docs/reactive` | green: no diff-check or trailing-whitespace diagnostics; scoped changes remain under `packages/reactive/**` plus ignored `docs/reactive/reactive.sdd.md`; whole worktree remains dirty by pre-existing cross-package edits | 2026-08-18; dirty baseline |

Round30 current evidence（2026-08-18，dirty worktree）：result status: `verified`; blocker: none; dependency: reactive has zero workspace runtime dependencies and receives scheduler/clock/diagnostic capabilities through runtime options; reactive 87 tests passed. This is the sole current Reactive evidence set; earlier counts remain historical/superseded.

## 9. 风险、deferred 与交付门禁

### 9.1 Hostile review

- 高：若 `runTracked()` 或 Effect post-run guard 被删除，cleanup self-dispose 会重新产生 dead subscription；RT24-T01/T02 直接钉住。
- 中：binding consumer 若把 `no-observer` 当作 `changed`，可能在 terminal observer 上继续通知；RT24-T02 钉住协议返回值。
- 中：dirty worktree 含大量跨包变更，门禁失败不能自动归因于本批次；最终证据必须保留 baseline 并分辨 environment/existing defect。
- 低：body-self-dispose 只覆盖同步 terminal admission，不扩展到异步 callback；异步生命周期仍由 lifecycle/resource SDD 负责。
- 中：若未来新增 observer-run early return 绕过 `Effect.run()` 的 finally，仍会重新产生 unmatched span；RT25-T01/T02/T04 与 start/end audit 作为回归门禁。
- 高：若 Effect/Computed 恢复直接读取 terminal clocks，诊断 failure 会再次覆盖成功/body error 或留下 unmatched span；RT26-T01–T04 覆盖 start/terminal、success/failure 与 primary identity。
- 中：若新增 trace sink 绕过 Runtime containment，sink throw 会反向破坏 graph/lifecycle；RT26-T05 验证 throwing sink 与第二 sink 的隔离。
- 高：若 Signal/Runtime/Tracker 新增 trace 点直接读取 `timestamp()` 或直接调用 sink，业务 commit 后可能再次出现 partial graph/dirty propagation；RT28-T01–T04 与 `emitTraceSafely()` owner audit 覆盖当前路径。
- 中：safe diagnostic reporter 若被新调用点绕过，reporter 自身 throw 仍可能替换 setter/body error；RT28-T03 以及 RT26 body-error cases 覆盖 boundary。
- 低（existing defect/out of scope）：跨包 consumer 的异步生命周期语义仍由 lifecycle/resource SDD 拥有；本轮不扩展到 Store 或其他包。

### 9.2 Delivery gates

Reactive implementation and active package clauses are `verified` by the Round30 current evidence and final ordered gates. Historical RT24-E02/03 remain baseline evidence; RT25/RT26 and RT28-E01–E03 remain reproducible implementation evidence, with their former `implemented-unverified` labels preserved only as chronology.

Delivery gates:

1. reactive formatter、lint、typecheck、test typecheck、unit test、build 全部通过；缺失脚本必须明确写 absent。
2. `@migaia/resource` 非 Store 直接消费者测试/构建门禁通过或明确分类为既有/环境失败。
3. `git diff --check` 通过；改动路径只在 `packages/reactive/**`、`docs/reactive/**`。
4. 最终 hostile review 无高风险未修复项；残余中低风险按 verified、implemented-unverified、deferred、blocked、existing defect 或 environment failure 分类。
