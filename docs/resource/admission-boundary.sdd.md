# SDD：`@migaia/resource` Round24 admission 与 Round29 scheduler.now error boundary

## 0. 状态与闭合规则

- 状态：`verified`（2026-08-18；dirty worktree；Round30 与最终 package/direct-consumer gates 已闭合）
- 范围：`packages/resource/**`、`docs/resource/**`；Store、Store consumers、其他 package source/test 均排除。
- Owner：`@migaia/resource`；public boundary 为 `Resource` 的 constructor options、`state`/`promise`/`read`/`peek`/`isStale`/`dehydrate` 及 request Promise settlement。
- 受影响 consumers：`@migaia/reactive` runtime state graph、`@migaia/lifecycle` scheduler/generation primitives，以及 non-Store direct consumers；不修改这些包。
- 前置：[`docs/lifecycle/lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)、[`docs/lifecycle/migration.sdd.md`](../lifecycle/migration.sdd.md)、[`docs/contracts/error-codes.md`](../contracts/error-codes.md)。
- 关联：[`docs/capability/admission-boundary.sdd.md`](../capability/admission-boundary.sdd.md)。

闭合规则：`pending → red → implemented → verified`。已有 `R-*` IDs 保持不变；Round29 使用 `R-D29-*`、`R-R29-*`、`R-T29-*`，不得复用或静默重编号。dirty worktree evidence 必须明确 baseline/context，不得伪装 clean completion。

## 1. 目标与范围

### 1.1 目标

1. 在 Resource constructor admission 中继续一次性 snapshot/validate public options，再建立 ownership、signal hooks、hydration 与 auto-start。
2. 将注入 scheduler 的 `now()` throw、lifecycle normalization 对 `NaN`/`Infinity` 的拒绝，统一收敛到 Resource-owned `INVALID_OPTION` scheduler wrapper；原始异常经 `cause` 保持 identity/native semantics。
3. 成功 settlement 在写入 `updatedAt`、`expiresAt`、cache 或 success state 前完成 clock/TTL arithmetic；clock failure 不发布 partial success。
4. passive freshness read 遇 clock failure 时 fail closed：发布一个稳定的 Resource error state、保留既有 cache metadata 的 atomicity、不启动隐式 retry；重复 read 使用同一 failure/promise，并通过 runtime reporter 观察同一 wrapper。

### 1.2 非目标

- 不新增、重命名或删除 error code；继续复用 `ResourceErrorCode.invalidOption`。
- 不改变 fetcher business error 的原样透传、retry 次数/顺序、SWR data policy、keepAlive dependency ownership、abort 或 generation semantics。
- 不把 lifecycle scheduler validation、reactive graph 或 lifecycle state machine 复制到 Resource；不改 Store/Store SDD/Store tests。

## 2. 现状与问题

Round24 已将 constructor options 统一 admission，但 Resource 内部调用已 snapshot 的 scheduler 时仍有两个 MED boundary：

- successful request settlement 的 `scheduler.now()` 位于 public request Promise 链中；throw 或 lifecycle 对非法数值的 rejection 会绕过 Resource wrapper，随后以 raw error 进入 `state.error`。
- `#isFresh()` 被 `state`、`promise`、`read`、`isStale` 和 hydrated auto-start 使用。passive freshness read 的 clock throw 会直接穿透 getter，既没有 Resource `(source, code)`，也没有稳定 public state/promise 语义。

此 round 的关键 invariant 是：clock sample 与 finite TTL expiry 必须先完成；只有完整 expiry pair 才能进入 cache/state publication。passive failure 只改变 availability state，不改写旧 `updatedAt`/`expiresAt`，也不把失败误判为 stale 后启动新 fetch。

## 3. 架构裁定与依赖方向

| ID | 裁定 |
| --- | --- |
| R-D01 | `@migaia/resource` 拥有 Resource option admission；lifecycle 只拥有 scheduler/generation 原语，reactive 只拥有 runtime/dependency graph。 |
| R-D02 | 先建立 immutable normalized option snapshot，再执行 runtime ownership、signal hooks、hydration 和 auto-start；不在 Resource 内复制 lifecycle state machine。 |
| R-D03 | 选项 getter/值失败复用 Resource `INVALID_OPTION`；initial snapshot schema 继续使用 `INVALID_SNAPSHOT`；原始 getter error 经 `cause` 保留。 |
| R-D29-01 | Resource owns the last scheduler-use error boundary. It may wrap lifecycle-owned scheduler errors at its public state/request boundary, but must preserve lifecycle/native error as `cause`; no reverse dependency or duplicate scheduler validation is introduced. |
| R-D29-02 | Settlement uses a local validated `{ updatedAt, expiresAt }` pair. Cache fields and success state change only after the pair is complete; failure clears the pending pair but leaves prior cache metadata untouched. |
| R-D29-03 | Passive freshness failure is a Resource availability failure: publish one `error` state, install one rejected current Promise, report the same wrapper once, pause passive re-entry, and never publish a new success value. |

允许方向：`lifecycle ← resource`、`reactive ← resource`。Resource 不反向依赖 Store、UI、DOM、Node 或 persistence adapter。Rejected duplicate paths：Resource 不新增 scheduler implementation、timer、clock validator、Store adapter 或第二套 error code。

## 4. 公开契约/核心设计

| ID | Requirement |
| --- | --- |
| R-R01 | Every public constructor option is read exactly once into one normalized snapshot before Resource ownership/runtime/listener/fetch side effects. |
| R-R02 | Hostile option getters and invalid option values fail with Resource `INVALID_OPTION`, preserving native type and original getter cause, before any partial Resource admission. |
| R-R03 | `undefined` defaults and initial snapshot schema/error semantics remain compatible with the existing Resource contract. |
| R-R29-01 | A scheduler `now()` throw or invalid normalized result during successful settlement rejects with Resource `source/code = @migaia/resource/INVALID_OPTION`; the wrapper message is the canonical scheduler-operation text and the original/native lifecycle error is reachable by exact `cause`. |
| R-R29-02 | Settlement publishes success/cache only after clock and finite TTL expiry succeed. On failure, request/state carry the same wrapped error, no partial success is published, and no new dehydrate snapshot is exposed. |
| R-R29-03 | Passive `state`/`promise`/`read`/`peek`/`isStale` freshness paths never expose the raw scheduler failure: `state` becomes one stable `error`, `read`/`peek` throw that wrapper, `promise` returns one stable rejected Promise, and later passive reads do not call `now()` again or schedule retry. |
| R-R29-04 | Passive failure leaves prior `updatedAt`/`expiresAt` metadata unchanged; fresh reads still preserve success/cache, while stale/SWR/retry paths do not publish a partial replacement. |
| R-R29-05 | A swallowed passive scheduler failure is reported through the existing reactive runtime boundary exactly once; reporter receives the same wrapper object stored in `state.error` and used by the rejected Promise. |

### 4.1 Admission snapshot

`debugName`、`ttl`、`autoStart`、`staleWhileRevalidate`、`retry`、`retryDelay`、`keepAlive`、`initialSnapshot`、`scheduler` 各读取一次。`undefined` 默认值保持：`ttl=Infinity`、`autoStart=true`、`staleWhileRevalidate=false`、`retry=0`、`retryDelay=0`、`keepAlive=false`；显式 scheduler 通过 lifecycle `snapshotScheduler()` 保存 receiver/method snapshot。

### 4.2 Scheduler boundary and atomic publication

Resource calls one private `readSchedulerNow()` boundary which uses the existing `createSchedulerFailure()` wrapper. Lifecycle remains responsible for method snapshot and numeric validation, so `NaN`/`Infinity` produce a lifecycle native `RangeError` as `cause`; a host throw remains the exact host object as `cause`.

Settlement stores only a local expiry pair first. `#updatedAt`, `#expiresAt`, `#currentPromise` success identity and success state are not advanced until that pair is valid. A passive failure retains old metadata, replaces public availability with `error`, creates/observes one rejected Promise, and reports the same Resource error. `peek()` does not initiate freshness work; after failure it exposes the same error through normal materialization semantics.

## 5. 生命周期与错误语义

- **Request/replacement:** generation token remains authoritative. A superseded settlement cannot write the pair or state. Retry timer admission continues to use scheduler `schedule()` and its existing `createSchedulerFailure()` path; retry policy errors remain original business/policy errors.
- **Fresh/stale/SWR:** fresh passive reads do not fetch or mutate cache. Stale reads may start one normal request. If the freshness clock itself fails, Resource enters stable `error`, pauses passive re-entry, keeps old metadata untouched, and does not treat the failure as an ordinary stale result. SWR refresh may show old data only while request is pending; a failed settlement does not publish a new success.
- **keepAlive:** keepAlive controls dependency suspension only. It does not bypass clock wrapping, alter error identity, or cause passive retry after a clock failure.
- **Dispose/late rejection:** dispose/generation terminal checks remain unchanged; late request results cannot replace the error or old metadata. Repeated dispose remains idempotent.
- **Error policy:** fetch/request primary failures use `throw` through the public Promise and `state.error`; passive clock failure is `collect`ed into public state and Promise, then `report`ed once because the local catch does not rethrow. There is no batch `firstError` path in Resource. Reporter throw/rejection is contained by reactive runtime and cannot replace the Resource primary.
- **Atomicity:** rollback of the pending expiry pair is local; no cleanup error can replace a scheduler primary. Original errors remain reachable through `cause`; wrapper stack is not substituted for the cause stack.

## 6. 迁移与实施批次

1. **Inventory:** inspect constructor admission, `#isFresh`, settlement, retry schedule, SWR, keepAlive, reporter and dehydrate paths.
2. **Red tests:** add `R-T29-01`～`R-T29-05` under `packages/resource/test/`; retain Round24/AF baselines.
3. **Contract/error registration:** no new code; reuse registered Resource `INVALID_OPTION` and canonical `ResourceErrorText.schedulerTaskOperationFailed`.
4. **Implementation:** route settlement and freshness clock reads through the Resource boundary; add fail-closed passive state/promise/report behavior; clear pending expiry pair before each request.
5. **Delete duplicate/compatibility path:** no duplicate scheduler or compatibility wrapper is permitted; the old raw `this.#scheduler.now()` call sites are removed.
6. **Docs/exports/dependencies:** update this SDD only; public exports, package metadata and dependency direction remain unchanged.
7. **Gates/evidence:** run Resource `fmt → lint → typecheck → typecheck:test → test → build`; reactive/lifecycle and non-Store direct-consumer gates; repository diff check. Store/other excluded.

## 7. 测试与验收矩阵

| ID | 层级 | 明确断言 | 覆盖 |
| --- | --- | --- | --- |
| R-T01 | package | 九个 public option getter 各执行一次；默认/显式 snapshot 被保存，autoStart=false 时 fetcher 未运行。 | R-R01、R-D02 |
| R-T02 | package | `ttl`、`retry`、`retryDelay`、`staleWhileRevalidate`、`keepAlive`、`scheduler` hostile getter 均在 constructor admission 失败，错误带 Resource `INVALID_OPTION` 和原始 `cause`，fetcher 未运行。 | R-R02、R-D03 |
| R-T03 | package | 非 boolean option value 在 ownership/fetch 前以 Resource `INVALID_OPTION` 拒绝。 | R-R02 |
| R-T29-01 | package settlement | scheduler.now throw during successful fetch rejects with canonical Resource `INVALID_OPTION`, exact host cause, identical state error, and no success/dehydrate publication. | R-R29-01、R-R29-02、R-D29-01、R-D29-02 |
| R-T29-02 | package settlement | scheduler.now `NaN`/`Infinity` validation remains native lifecycle `RangeError` as cause while outer Resource wrapper owns source/code; state/cache remain failure-atomic. | R-R29-01、R-R29-02 |
| R-T29-03 | package passive | repeated state/promise/read/peek/isStale reads produce no raw scheduler error, no second clock call, one stable wrapper/Promise, unchanged prior metadata, and reporter identity. | R-R29-03、R-R29-04、R-R29-05、R-D29-03 |
| R-T29-04 | package retry | first fetch failure schedules through injected scheduler, retry succeeds in fetcher, then settlement clock failure still uses Resource wrapper/cause and does not leak retry mechanics. | R-R29-01、R-R29-02、R-D29-01 |
| R-T29-05 | package SWR/keepAlive | SWR refresh exposes refreshing while pending; settlement clock failure publishes no replacement success/cache, preserves dependency ownership under keepAlive, and carries one Resource failure. | R-R29-02、R-R29-04、R-R29-05、R-D29-02、R-D29-03 |
| R-T29-06 | package passive | A fresh snapshot remains success/cache without fetch; one later stale read starts one replacement and publishes its complete success only after settlement. | R-R29-04、R-D29-02 |

Verification layers: Resource package tests are canonical behavior tests; lifecycle/reactive tests verify the reused scheduler/runtime primitives; non-Store direct-consumer typecheck/test/build gates verify package boundary compatibility. No Store test is part of this round.

## 8. 证据与闭合映射

| 条款 | Cases | Owner | 状态 |
| --- | --- | --- | --- |
| R-R01 | R-T01 | resource | implemented-unverified |
| R-R02 | R-T02、R-T03 | resource | implemented-unverified |
| R-R03 | R-T01 | resource | implemented-unverified |
| R-R29-01 | R-T29-01、R-T29-02、R-T29-04 | resource | implemented-unverified |
| R-R29-02 | R-T29-01、R-T29-02、R-T29-04、R-T29-05 | resource | implemented-unverified |
| R-R29-03 | R-T29-03 | resource | implemented-unverified |
| R-R29-04 | R-T29-03、R-T29-05、R-T29-06 | resource | implemented-unverified |
| R-R29-05 | R-T29-03、R-T29-05 | resource | implemented-unverified |
| R-D01 | R-T01～R-T03、R-T29-01～R-T29-05 | resource | implemented-unverified |
| R-D02 | R-T01、R-T02 | resource | implemented-unverified |
| R-D03 | R-T02、R-T03 | resource | implemented-unverified |
| R-D29-01 | R-T29-01、R-T29-02、R-T29-04 | resource | implemented-unverified |
| R-D29-02 | R-T29-01、R-T29-02、R-T29-05、R-T29-06 | resource | implemented-unverified |
| R-D29-03 | R-T29-03、R-T29-05 | resource | implemented-unverified |

Historical evidence, `2026-08-18`, dirty worktree baseline: Resource package result was 5 files / 64 tests; Reactive 86, Lifecycle 324, plugin-host 198, serialize 161, logger 163 and non-Store consumers passed at that checkpoint. Resource requirements remained `implemented-unverified` pending final Sol/repository gates; the following Round30 current evidence supersedes those counts and status.

Round30 current evidence（2026-08-18，dirty worktree）：result status: `verified`; blocker: none; dependency: `resource -> lifecycle/reactive` and Resource owns only option admission/freshness publication; resource 64 tests passed. This is the sole current Resource evidence set; older counts remain historical/superseded.

## 9. 风险、deferred 与交付门禁

- **MEDIUM — verified only after gates:** a future scheduler call site could bypass `#readSchedulerNow`; source scan must show no Resource-owned freshness/settlement direct `this.#scheduler.now()` call remains.
- **MEDIUM — verified only after gates:** passive state transition changes success availability to error when the time domain is unavailable; this is intentional fail-closed behavior and must remain explicit in tests/docs.
- **LOW — existing boundary:** reporter implementation belongs to reactive; Resource only calls `runtime.reportError` and relies on its containment contract. Reactive reporter-throw behavior is verified by its own existing gates, not modified here.
- No Resource-owned blocker remains. Final Sol review, lifecycle chronology, and repository gates passed; no deferred item. Store/other package changes remain out of scope.

Delivery gate order: `fmt → lint → typecheck → typecheck:test → test → build` for Resource, then reactive/lifecycle/non-Store consumers, then source/error/export scans and `rtk git diff --check`. Completion requires every non-deferred row above to be evidenced; dirty worktree status must remain explicit.
