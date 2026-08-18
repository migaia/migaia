# SDD：`@migaia/capability` Round24 handle 准入与 Round26 dispose deadlock 边界

## 0. 状态与闭合规则

- 状态：`verified`（2026-08-18；dirty worktree；Round26 breaking behavior 与最终 package/direct-consumer gates 已闭合）
- 范围：activation result 的 `handle.dispose` admission、错误分类、disable/dispose 收敛，以及 Round26 的 dispose completion admission。
- Owner：`packages/capability`。
- 受影响包：`@migaia/capability` 及其直接消费者；Store 和其他包不在本批次范围。
- 前置：[`docs/lifecycle/lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)、[`docs/lifecycle/migration.sdd.md`](../lifecycle/migration.sdd.md)、[`docs/contracts/error-codes.md`](../contracts/error-codes.md)。
- 关联：[`docs/resource/admission-boundary.sdd.md`](../resource/admission-boundary.sdd.md)。

闭合规则：`pending → red → implemented → verified`。每条 R/D/T 必须双向映射；dirty worktree 证据不得伪装为 clean completion。

## 1. 目标与范围

### 1.1 目标

activation 返回 handle 后，单次读取 `dispose`；getter failure 归类为 canonical `INVALID_HANDLE`，保留 getter error 为 `cause`，不采纳 handle；随后 disable/dispose 必须完成状态收敛。

### 1.2 非目标

不改变 capability gated/off/on/failed 状态定义、generation cancellation、pending drain、LIFO release、report semantics 或 public exports；不新增错误码。Round26 明确改变进行中重复 `dispose()` 的 Promise identity 语义。

## 2. 现状与问题

此前 `handle?.dispose` getter 直接位于 async activation try 中。getter throw 进入 generic catch，导致 `error(name)`/onError 收到 raw host error，未携带 `INVALID_HANDLE`；handle 未被明确拒绝，且 admission 与 cleanup 语义混淆。

## 3. 架构裁定与依赖方向

| ID | 裁定 |
| --- | --- |
| C-D01 | `@migaia/capability` 拥有 feature gate 与 handle lifecycle；lifecycle 只拥有 generation/quiescence 原语。 |
| C-D02 | handle adoption 前只读一次 `dispose`，通过 canonical `INVALID_HANDLE` TypeError boundary；失败 handle 不进入 entry 或 activationOrder。 |
| C-D03 | disable/dispose 复用既有 deactivate/release/drain path；不另建 rollback state machine 或 duplicate disposer path。 |
| C-D04 | capability owns dispose transition admission: first completion Promise is published before cleanup; lifecycle remains responsible only for tracking/drain primitives. |

允许方向：`lifecycle ← capability`；capability 不依赖 resource、Store、UI、DOM、Node 或 persistence。

## 4. 公开契约/核心设计

| ID | Requirement |
| --- | --- |
| C-R01 | A throwing `handle.dispose` getter is a single-read invalid-handle admission failure; original error stays reachable as `cause`, and failed activation cannot adopt or leak the handle. |
| C-R02 | **Round26 breaking change:** the first `dispose()` publishes one completion Promise and waits for all legitimate activation/release cleanup. Every later call while that Promise is pending fails fast with canonical `HOST_TRANSITIONING` (synchronous throw during a transition, otherwise an immediately-owned rejected Promise); after settlement, repeated calls return the completed canonical Promise. |
| C-R03 | External concurrent callers must retain and await the first `dispose()` Promise; they must not call `dispose()` again to join an in-progress transition. Delayed disposer-origin calls follow the same rejection rule so disposer promises reject/report instead of self-awaiting. |

`activate()` 成功返回值先做 handle shape admission。`dispose` getter 正常返回 callable 时保存其 disposer；getter throw 时创建 native `TypeError`，附 `source='@migaia/capability'`、`code=INVALID_HANDLE`、`cause=original getter error`，并进入既有 failed/report path。无论 getter failure 还是 missing/non-callable dispose，entry 不拥有 handle，disable/dispose 最终为 off、无 handle；Round26 的 dispose transition admission 另按 C-R02/C-R03 执行。

## 5. 生命周期与错误语义

handle admission 发生在 generation token 仍可 current 的 activation path；失败不调用 disposer、不 adoption、不加入 activationOrder。同步/异步 activation race 与 host dispose 继续由 generation controller、pending tracker 和 dispose completion Promise 处理。cleanup failure 仍 report，不覆盖 admission primary；reporter 自身 failure 不泄漏。重复 disable/dispose 幂等；late activation result 仍走既有 release path。

### 5.1 Round26 breaking behavior change

旧行为：首次 `dispose()` 发布 completion Promise 后，任何进行中的重复调用都返回同一 Promise。这个 identity 保证与 delayed disposer-origin 调用冲突：disposer 若在稍后继续 `await host.dispose()`，会把 drain 等待自身返回的 Promise，形成 capability host 永不收敛的 deadlock。

新行为：首次 `dispose()` 仍在同步 cleanup 前发布 Promise，并继续等待所有合法的 activation/release cleanup；同步 transition 内的重复调用继续同步抛 `HOST_TRANSITIONING`，任何延迟到当前栈之后、但 completion 仍 pending 的重复调用改为立即 rejected Promise，错误携带 canonical `(source, code)`。cleanup disposer 返回/await 该 rejected Promise 时，既有 release path report 一次并继续 drain。只有 completion settled 后，重复调用才返回首次已完成的 canonical Promise。

影响与理由：外部并发调用方必须保存首次返回值并 `await` 它；不再能用第二次 `dispose()` 获取 in-progress Promise。这是为保住“首个 dispose 等待所有合法 cleanup”与“disposer 不等待 host.dispose()”两项硬约束而接受的显式 breaking change。兼容处置：没有新增 error code；现有 `HOST_TRANSITIONING` 语义覆盖重复 lifecycle transition，调用方应迁移为 retain/await first Promise。无 timeout、延迟 heuristics 或新 lifecycle state。

## 6. 迁移与实施批次

1. inventory：盘点 activation handle shape read、adoption、release、dispose convergence。
2. red test：`packages/capability/test/capability.test.ts` 增加 throwing getter、single-read、no-adoption、disable/dispose convergence case。
3. contract：复用已注册 `INVALID_HANDLE`，不修改 `docs/contracts/error-codes.md`。
4. implementation：建立 tagged TypeError boundary，再进入现有 failed/report path。
5. docs/exports/dependencies：保持 public error-code export 与 lifecycle dependency direction；更新本 SDD、README、USEGUIDE 和 dispose public type comment。
6. gates/evidence：capability package gates、直接消费者 gates、`git diff --check`。

## 7. 测试与验收矩阵

| ID | 层级 | 明确断言 | 覆盖 |
| --- | --- | --- | --- |
| C-T01 | package | throwing `dispose` getter 只读取一次；enable 返回 failed，error/onError 带 `INVALID_HANDLE` 与原始 cause；handle 未采用；disable/dispose 后 state=off 且无 handle。 | C-R01、C-D02、C-D03 |
| C-T02 | package | Round26 delayed disposer `await host.dispose()` receives rejected `HOST_TRANSITIONING`; first dispose still waits legitimate async cleanup, reports the cleanup rejection once, and settles with every entry off and without a handle. | C-R02、C-R03、C-D03、C-D04 |
| C-T03 | package/direct-concurrency | An external in-progress second `dispose()` returns a distinct rejected Promise with `HOST_TRANSITIONING`; after first completion, repeated dispose returns the first canonical completed Promise. | C-R02、C-R03、C-D04 |

## 8. 证据与闭合映射

| 条款 | Cases | Owner | 状态 |
| --- | --- | --- | --- |
| C-R01 | C-T01 | capability | implemented-unverified |
| C-D01 | C-T01 | capability | implemented-unverified |
| C-D02 | C-T01 | capability | implemented-unverified |
| C-D03 | C-T01 | capability | implemented-unverified |
| C-D04 | C-T02、C-T03 | capability | implemented-unverified |
| C-R02 | C-T02、C-T03 | capability | implemented-unverified |
| C-R03 | C-T02、C-T03 | capability | implemented-unverified |

证据：2026-08-18、dirty worktree；Round24/Round26 历史 package/consumer evidence 保留为 baseline。Round26 实现文件为 `packages/capability/src/index.ts`、`src/error-text.ts`；测试文件为 `packages/capability/test/capability.test.ts`、`packages/capability/test/dispose.test.ts`；无新增 semantic code。当时 package/consumer gates 均通过但状态保持 `implemented-unverified`；该历史状态已由下方 Round30 current evidence supersede。

Round30 current evidence（2026-08-18，dirty worktree）：result status: `verified`; blocker: none; dependency: `capability -> lifecycle` for generation/quiescence primitives, with capability owning feature-gate and handle lifecycle; capability 61 tests passed. This is the sole current Capability evidence set; older counts remain historical/superseded.

## 9. 风险、deferred 与交付门禁

主要风险是未来新增 handle capability 时绕过单一 adoption boundary；任何新 handle 字段必须在 adoption 前 snapshot 并加入 C-T01 语义。验证门禁：`fmt → lint → typecheck → typecheck:test → test → build`，然后 capability direct consumers、dependency/export/error scans 和 `git diff --check`。未通过项保持 `implemented-unverified`；不使用无 owner 的 deferred。
