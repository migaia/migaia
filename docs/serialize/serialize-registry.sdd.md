# Serialize Registry Rounds 20–29 Boundary Hardening

- 状态：**verified**（2026-08-18；dirty worktree；Round30 plugin-list admission 与最终 package/consumer gates 已闭合）
- 范围：`packages/serialize/**`，本轮聚焦 stream/registry codec boundaries、package-boundary consumer compile coverage、serialize gates 与本 SDD；不修改 Store、foundation 或 lifecycle。
- Owner：`@migaia/serialize` registry/signal boundary。
- 影响包：`@migaia/serialize`；依赖 `@migaia/lifecycle` 的既有 scope/abort primitives。
- 前置：[`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md) §R-1/§R-3、[`lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)、[`error-codes.md`](../contracts/error-codes.md)。
- 关联：[`runtime-neutral-foundation.sdd.md`](../plugin-host/runtime-neutral-foundation.sdd.md)（仅作跨包 cleanup 语义参考）。

## 0. 状态与闭合规则

条款状态沿 `pending → red → implemented → verified` 流转；真实外部设计阻塞才使用 `blocked`，独立 owner 与落点明确的未来工作才使用 `deferred`。本文件总状态不得宣称 `verified`，除非每条非 deferred 条款均有语义对应测试、package gates 全部通过，并记录命令、结果、日期及 dirty-worktree 基线或 commit。

本轮新增/补全稳定 ID：`SER-R18-01`～`SER-R18-04`、`SER-R19-01`～`SER-R19-03`、`SER-D19-01`～`SER-D19-02`、`SER-T19-01`～`SER-T19-02`、`SER-R23-01`～`SER-R23-04`、`SER-D23-01`～`SER-D23-03`、`SER-T23-01`～`SER-T23-05`、`SER-R24-01`～`SER-R24-04`、`SER-D24-01`～`SER-D24-04`、`SER-T24-01`～`SER-T24-04`、`SER-R25-01`～`SER-R25-02`、`SER-D25-01`～`SER-D25-02`、`SER-T25-01`～`SER-T25-06`、`SER-R26-01`～`SER-R26-02`、`SER-D26-01`～`SER-D26-02`、`SER-T26-01`～`SER-T26-04`、`SER-R27-01`～`SER-R27-02`、`SER-D27-01`～`SER-D27-02`、`SER-T27-01`～`SER-T27-02`、`SER-R29-01`～`SER-R29-03`、`SER-D29-01`～`SER-D29-03`、`SER-T29-01`～`SER-T29-07`。既有 Round17/18/19/20/21/22/23/24/25/26/27 ID 保持不变；ID 不得复用或静默重编号。

Round18 requirements, decisions and cases remain `implemented-unverified` until AF-136 has a Round19 no-finding result and final direct-consumer/repository gates are recorded. Passing package evidence does not by itself upgrade these clauses or this SDD to `verified`.

Round19 requirements, decisions and cases (`SER-R19-*`, `SER-D19-*`, `SER-T19-*`) remain `implemented-unverified` because final cross-package gates are pending; package-boundary consumer evidence is passed and recorded below.

Round20 requirement, decision and case (`SER-R20-01`, `SER-D20-01`, `SER-T20-01`) remain `implemented-unverified` pending final cross-package closure; requested serialize package/local gates, emitted declaration inspection, consumer gate and diff-check are passed and recorded below.

Round21 requirements, decision and cases (`SER-R21-01`～`SER-R21-03`, `SER-D21-01`～`SER-D21-02`, `SER-T21-01`～`SER-T21-03`) are `implemented-unverified` until the package gates, core subpath consumer gate, and diff-check below are rerun on this dirty-worktree baseline.

Round22 requirements, decisions and cases (`SER-R22-01`～`SER-R22-03`, `SER-D22-01`～`SER-D22-03`, `SER-T22-01`～`SER-T22-03`) are `implemented-unverified` until the focused stream cases, serialize gates, consumer gate, and scoped diff-check below are rerun on this dirty-worktree baseline.

Round23 requirements, decisions and cases (`SER-R23-01`～`SER-R23-04`, `SER-D23-01`～`SER-D23-03`, `SER-T23-01`～`SER-T23-05`) are `verified` (2026-08-18; focused race cases, serialize gates, consumer gate, and scoped diff-check passed on this dirty-worktree baseline). Earlier rounds and this SDD remain `implemented-unverified` pending existing AF-136 and final cross-package closure.

Round24 requirements, decisions and cases (`SER-R24-01`～`SER-R24-04`, `SER-D24-01`～`SER-D24-04`, `SER-T24-01`～`SER-T24-04`) remain `implemented-unverified` until focused defect tests, SDD ID-resolution check, serialize gates, consumer gate, and scoped diff-check are recorded on this dirty-worktree baseline.

Round25 requirements, decisions and cases (`SER-R25-01`～`SER-R25-02`, `SER-D25-01`～`SER-D25-02`, `SER-T25-01`～`SER-T25-06`) remain `implemented-unverified` until exact chunk-boundary tests, option-admission tests, serialize gates, eight consumer configurations, and scoped diff-check are recorded on this dirty-worktree baseline.

Round26 requirements, decisions and cases (`SER-R26-01`～`SER-R26-02`, `SER-D26-01`～`SER-D26-02`, `SER-T26-01`～`SER-T26-04`) are `verified` (2026-08-18; updated FIFO sync-throw case, full serialize gates, eight consumer configurations, and scoped diff-check passed on this dirty-worktree baseline).

Round27 requirements, decisions and cases (`SER-R27-01`～`SER-R27-02`, `SER-D27-01`～`SER-D27-02`, `SER-T27-01`～`SER-T27-02`) are `verified` (2026-08-18; FIFO sync-throw queueing, core import-graph/bundle exclusion, abort identity regression, full serialize gates, eight consumer configurations, and scoped diff-check passed on this dirty-worktree baseline).

Round29 requirements, decisions and cases (`SER-R29-*`, `SER-D29-*`, `SER-T29-*`) are `implemented-unverified` (2026-08-18; hostile-signal/encoder cases, full serialize gates, build, eight consumer configurations, core neutrality, and scoped diff-check passed on this dirty-worktree baseline; final Sol/repository gates remain pending).

## 1. 目标与范围

目标：修复 `composeSerializeSignal` 的 Round17 cleanup-order defect，并修复 Round19 public type export 缺口。caller registration 必须先安装，closing registration 后安装；rollback 与正常 dispose 必须严格按安装顺序逆序释放。

Round19：root 与 `./registry` 公开 registry options、scheduler、cleanup/timeout diagnostics 与 registry 使用的 encoder/decoder contracts；`./core` 公开 stream/chunk signatures 需要的 encoder/decoder/scheduler contracts；所有 declarations 经 package exports 可被 consumer 编译解析。

范围内行为：

- 每个已尝试的 `removeEventListener` 最多调用一次；重复 dispose 不重复释放。
- 单个 removal 失败不得跳过其他 registration；失败经既有 `report` 作为 secondary error 观测。
- registration 失败仍是 primary；包装错误保留 registration failure 的原对象于 `cause`，cleanup failures 不覆盖 primary，也不伪造 `errors` 字段。
- registry parser cleanup 继续委托既有 lifecycle scope；其多错 aggregate 的 `errors` 顺序与 scope 的 LIFO 输入保持一致。

非目标：改变 abort 仲裁、parser operation tracking、lifecycle 实现、Store/foundation 包、错误码集合或公共 exports。

Round18 增量目标：修复 deadline scheduler failure 先于 parser cleanup 抛出时的 cleanup skip。`now`、`schedule`、task admission、同步 deadline callback 与 `cancel` 均属于 registry deadline boundary；scope/parser cleanup 仍由既有 lifecycle scope 执行。

Round21 增量目标：修复 `@migaia/serialize/core` 的 stream scheduler error ownership。core 不得让 `@migaia/lifecycle` 的 source/text/code 穿过 public stream boundary；scheduler getter、clock、schedule、task admission failures 必须以 serialize-owned `INVALID_OPTION` 暴露，并保留原始 hostile failure 的 `cause`。

Round22 增量目标：修复默认 frame yield 丢失 scheduled task handle 的 ownership leak。默认 yield 必须保留 handle，在 callback、settlement、failure、signal cancellation/dispose 路径确定性 release；同步 callback 先于 `schedule()` 返回时也必须 cancel exactly once。

Round23 增量目标：修复 `scheduleOwnedYield()` 在 `addEventListener()` 内同步 abort、同步 callback 或部分注册抛错时的 admission race。注册尝试必须先记账；成功与抛错返回边界均重读 `aborted/reason`；abort 在 scheduling 前必须进入 `onAbort()`；部分注册必须强制移除已存 listener；registration primary 与 cleanup `errors` 保持可达，且不得留下 scheduled task、pending Promise 或 unhandled rejection。

Round24 增量目标：修复 `encodeStream` queued Promise 的 immediate rejection observation；修复 registry chunk-shape Proxy 的 length/index getter 越界；修复 `decodeStream`/`collectStream` hostile async/sync iterator protocol 的 codec-boundary ownership；补全 Round18/19 requirement declarations，并用静态检查证明每个 mapped requirement 唯一解析。

Round25 增量目标：让 `collectStream` 在消费每片时先验证精确 `[tag, payload]` tuple、已知 tag 与 payload 类型，并以 `INVALID_CHUNK` 保留当前 index/bytes 进度；让 `encodeStream`/`decodeStream` 在任何输入 iterator、slice scheduler、registry operation 或 parser side effect 前一次性捕获全部公开 option getter，并把 getter、shape、type failures 收敛到 serialize `INVALID_OPTION`。

Round27 增量目标：让同步 `registry.encode` throw 与异步 rejection 共享同一个立即观测的 FIFO in-flight queue；在 `maxInFlight=2` 下先交付 index 0，再从下一次 drain 以 index 1 抛出 `ENCODE_FAILED`。同时移除 `serialize/core → stream → signal → lifecycle` runtime path，以 serialize-owned、runtime-neutral signal snapshot/controller 保留 abort race 与 reason identity，并以 source import graph + bundle test 锁定 core 不加载 workspace package。

## 2. 现状与问题

`composeSerializeSignal` 已按 caller → closing 安装两个 listener，并用 `attempted`/`removed` 保证幂等。但 cleanup 原先按 caller → closing 遍历，导致正常 settle 与第二项 registration 失败时的 rollback 都违反 strict LIFO；当 removal 抛错时，后续 removal 仍需继续，且报告顺序应反映真实逆序释放。

现有 lifecycle scope 已负责 parser/resource 的 LIFO、exactly-once 与多错收集，因此 serialize 不复制该机制；本轮只修复 signal composition 自有 registration stack。

Round18 缺陷：`dispose()` 在 `scheduler.now()`、`scheduler.schedule()`、task `cancel()` 抛错时直接退出，未进入 `scope.dispose()`；同步 callback 还会令 task 句柄尚未赋值。结果是 registry 已进入 disposed terminal，但 parser dispose 次数为 0，且 cleanup failure 可能覆盖或丢失 deadline primary。

Round24 缺陷：`encodeStream` 先把 rejected encode Promise 放进 `inFlight`，直到 ordered drain 才安装 rejection handler；当更早请求 pending 时，后续 rejection 会先触发 unhandled rejection。`collectChunks` 在 `isChunkShape`/`assertChunk` 前读取 hostile array Proxy 的 `length`/index，原始 getter error 越过 `SerializeCodecError` boundary。`decodeStream`/`collectStream` 的 `for await` protocol machinery 位于 boundary 外，`Symbol.asyncIterator`/`iterator`、`next`、`done`、`value` 与 thenable failures 可裸抛。

Round25 缺陷：`collectStream` 只读取 `chunk[0]` 并直接访问 `chunk[1].byteLength`，null、错误 tuple、未知 tag、错误 payload 与 value chunk 可能裸抛、错误归类或丢失流 index。`encodeStream` 把原始 options 再传给 `sliceByFrameBudget`，导致 getter 重读；`encodeStream`/`decodeStream` 的 option destructuring 不在 `INVALID_OPTION` boundary 内，getter/shape failures 可能发生在输入 iterator 或 registry side effect 之后。

## 3. 架构裁定与依赖方向

| ID | 裁定 |
| --- | --- |
| SER-D17-01 | `@migaia/serialize` 拥有 caller/closing signal bridge 的 registration ownership；`@migaia/lifecycle` 继续拥有通用 scope/transaction cleanup。 |
| SER-D17-02 | Registration admission 顺序固定为 caller → closing；cleanup 使用该快照的严格逆序，禁止按 source 名称或当前 signal 状态重排。 |
| SER-D17-03 | Removal failure 是 secondary diagnostic，由调用方提供的 `report` 观测；不得替换 registration/abort primary。 |
| SER-D17-04 | 不新增 compatibility wrapper、错误码或 foundation abstraction；使用既有 registration state 与 report channel。 |
| SER-D18-01 | `@migaia/serialize` owns deadline orchestration only; parser/resource release remains owned by existing `ILifecycleScope`. |
| SER-D18-02 | Deadline failures are captured in first-observed order; `scope.dispose()` is invoked once after timer mechanics settle, and never skipped by scheduler failures. |
| SER-D18-03 | Under cleanup `throw`, cleanup failures attach through `errors` without replacing deadline primary; under `report`, cleanup diagnostics use existing cleanup reporter and reporter throws are contained. |
| SER-D18-04 | The first valid `dispose()` publishes one stable Promise and terminal state before deadline work; later calls reuse it even after failure. |
| SER-D19-01 | `types.ts` remains sole declaration owner for public serialize contracts; entrypoints only re-export those names and do not create aliases or duplicate declarations. |
| SER-D19-02 | `core` owns codec/stream-facing types, `registry` owns registry lifecycle/diagnostic types, and root aggregates both without exposing registry implementation snapshots. |
| SER-D21-01 | `stream.ts` owns one local scheduler snapshot/validation boundary; it captures scheduler and task accessors once, preserves receivers, and does not import lifecycle. |
| SER-D21-02 | Core scheduler failures use serialize-owned native `TypeError`/`RangeError` plus `source/code`; hostile getter/method failures remain reachable as `cause`. |
| SER-D22-01 | `stream.ts` owns one default-yield task state machine; it retains the admitted handle and attempts `cancel()` at most once after callback, settlement, failure, or operation cancellation. |
| SER-D22-02 | Settlement is deferred across the `schedule()` return boundary, so synchronous callbacks still release the returned handle; task release failures become serialize-owned native `TypeError` + `INVALID_OPTION`. |
| SER-D22-03 | Abort/dispose cleanup cannot leave the yield Promise pending or replace an earlier primary; secondary cleanup failures remain contained and reachable when the primary is extensible, with no detached rejection. |
| SER-D23-01 | `scheduleOwnedYield()` reuses the attempted/removed ownership pattern already present in `composeSerializeSignal`; no second lifecycle/foundation state machine is introduced. |
| SER-D23-02 | A listener-registration failure is the primary after callback/recheck activity; abort remains primary only when registration succeeds, while remove/cancel failures attach as secondary `errors`. |
| SER-D23-03 | Every attempted registration is rechecked before scheduler admission; synchronous abort paths settle without scheduling and preserve exact serialize source/code/cause/error-chain identity. |
| SER-D24-01 | `encodeStream` installs a no-op rejection observer when each encode Promise is admitted, then drains that same original Promise in FIFO order; observation never replaces its identity or error code. |
| SER-D24-02 | `collectChunks` owns all chunk-shape/proxy property reads inside one encode codec boundary; hostile length/index access becomes `SerializeCodecError` + `ENCODE_FAILED` with the original failure as `cause`. |
| SER-D24-03 | `decodeStream` and `collectStream` keep native `for await` iterator precedence and close semantics, while wrapping protocol failures at their operation boundary with the current stream index and exact `cause`. |
| SER-D24-04 | `serialize-sdd.test.ts` parses canonical requirement declarations and section-7 mappings; every mapped requirement must resolve to exactly one declaration, preventing silent orphan/duplicate IDs. |
| SER-D25-01 | `types.ts` owns exact chunk tuple/tag/payload validation; registry encode collection and public `collectStream` reuse it so malformed chunks share `INVALID_CHUNK` semantics without a registry dependency from core. |
| SER-D25-02 | Stream option admission snapshots each public field once into immutable local values before external iterator/scheduler/registry/parser effects; nested abort signal ownership remains with the existing serialize signal snapshot. |
| SER-D26-01 | Chunk validation creates a fresh frozen tuple from the exact kind/data reads; payload identity is preserved, while later collection uses no hostile tuple property again. |
| SER-D26-02 | `encodeStream` normalizes synchronous registry invocation failures through the same indexed `ENCODE_FAILED` boundary as rejected results, while `Promise.resolve` preserves native Promise identity and thenable assimilation before immediate observation. |
| SER-D27-01 | Synchronous registry failures enter the same immediately-observed FIFO queue as asynchronous rejections; ordered drain, backpressure, and thenable assimilation remain owned by `encodeStream`. |
| SER-D27-02 | `serialize/core` owns its signal snapshot/composed controller semantics without importing lifecycle or any workspace package; lifecycle scope/scheduler/deadline state remains registry-owned. |
| SER-D29-01 | `signal.ts` owns raw signal admission and snapshot state. Pre-aborted values cache `aborted` and `reason`; later dynamic reads and registration rechecks go through the snapshot's serialize-owned boundary. `raceAbort` consumes only that boundary, while captured source listener functions preserve receiver and removal identity. |
| SER-D29-02 | `types.ts` owns one runtime-neutral `encodeSerializeTextChunk` boundary reused by registry and stream collection; thrown encoder failures are `ENCODE_FAILED`, non-`Uint8Array` returns are `INVALID_CHUNK`, and both retain index/progress/cause. |
| SER-D29-03 | Collection constructs merged output only after every text conversion succeeds; no partial bytes/text result is returned on an encoder failure, and valid `Uint8Array` output remains unchanged. |

允许依赖方向：`serialize/registry` → `lifecycle` abort/scope primitives，且 `serialize/registry` → `serialize/signal`；`serialize/signal` 本身不依赖 lifecycle、Store、foundation、DOM 或 Node。拒绝把 signal module 写成 lifecycle 的下游依赖或在 registry 中再实现一套 signal cleanup 状态机。

## 4. 公开契约/核心设计

### 4.1 Registration state

`registrations = [callerRegistration, closingRegistration]` 是 install-order snapshot。每项含 `attempted` 与 `removed`：`attempted` 在调用外部 add 前置为 true，以覆盖 stored-then-throw；cleanup 只处理 attempted 且未 removed 的项。

### 4.2 Cleanup algorithm

`cleanupListeners()` 在非重入 registration 阶段执行 `reverse(registrations)`。每项先标记 `removed`，再调用 captured `removeEventListener`；异常进入 `reportCleanupFailure`，随后继续下一项。`dispose()` 只把 cleanup 请求置 terminal 一次；registration depth 清零后补做 deferred cleanup。

### 4.3 Round17 requirements

| ID | Requirement |
| --- | --- |
| SER-R17-01 | Normal composition cleanup removes every attempted registration exactly once. |
| SER-R17-02 | Cleanup and rollback release registrations in strict reverse install order: closing before caller. |
| SER-R17-03 | Partial registration failure preserves registration failure as primary and keeps its original identity reachable through `cause`; cleanup failures do not replace it or invent `errors`. |
| SER-R17-04 | Multiple removal failures do not stop later removals; each failure is reported once in reverse cleanup order, with reporter failure contained. |
| SER-R17-05 | Registry parser cleanup preserves lifecycle LIFO and keeps every original disposer failure reachable through aggregate `errors` without a false `cause`. |
| SER-R17-06 | Reason extraction preserves exact ordinary Error messages and primitive coercion text where safe, while never throwing during wrapper construction. |
| SER-R17-07 | Hostile `Error.message` getters and object coercion failures cannot replace the operation/iterator primary; the wrapper retains `cause === primary` and uses deterministic fallback text. |

### 4.4 Round18 requirements

| ID | Requirement |
| --- | --- |
| SER-R18-01 | Every deadline ingress failure (`now`, `schedule`, invalid task, cancel accessor/call) remains observable while parser cleanup still runs exactly once. |
| SER-R18-02 | Deadline task ownership survives synchronous callback and cancellation races; an admitted task is cancelled exactly once before disposal completes. |
| SER-R18-03 | Cleanup `throw` preserves the first deadline primary and reaches parser cleanup failures through `errors`; cleanup `report` observes parser failures without replacing the primary or escaping reporter failure. |
| SER-R18-04 | The first valid `dispose()` publishes one stable terminal Promise; deadline/cleanup failures do not create detached rejection, and later operations observe disposed state. |

### 4.5 Round19 requirements

| ID | Requirement |
| --- | --- |
| SER-R19-01 | Root and declared serialize subpaths expose runtime APIs and required public types through package-boundary imports only. |
| SER-R19-02 | Public type ownership remains layered: `types.ts` declares contracts, `core` owns stream-facing contracts, `registry` owns registry diagnostics, and entrypoints only re-export. |
| SER-R19-03 | Emitted declarations expose required named types without unresolved internal-only snapshot types or duplicate public declarations. |

### 4.6 Safe reason extraction

`reasonOf()` is diagnostic-only. It reads an ordinary string `Error.message` once, safely stringifies non-string messages and primitive failures, and catches every accessor/coercion failure. Fallback is the package-owned `SerializeErrorText.reasonUnavailable`. The original thrown value is always passed unchanged as `cause`; reason formatting is never an error boundary that can supersede it.

### 4.7 Round18 deadline cleanup transaction

Deadline work uses one local task slot and one first-error slot. `now()` and `schedule()` failures are recorded; a successfully admitted task is cancelled once in a `finally` boundary, including when its callback runs synchronously. Task shape/accessor failures arise during `schedule()` admission and follow the same path. After deadline work, registry calls `scope.dispose()` exactly once, clears parser lookup, and marks cleanup complete regardless of deadline or parser failures.

When both phases fail, the first deadline failure remains the public primary. Under `throw`, parser cleanup error remains reachable in primary `errors` (or as the first element of a fallback `AggregateError` when the primary cannot be extended). Under `report`, parser cleanup is sent to the existing cleanup reporter; reporter failure is contained. No deadline promise rejects, so failed schedule admission cannot create an unhandled rejection.

### 4.8 Round22 default-yield ownership

`scheduleOwnedYield()` is a stream-local lifecycle/resource boundary; it does not move scheduler ownership into Store, foundation, or lifecycle. It captures the scheduler facade already admitted by `stream.ts`, retains the returned task, and records callback/primary/schedule-return state. The Promise settles only after the scheduler return boundary is complete. A synchronous callback therefore records success first, then the returned task is cancelled once before the Promise resolves.

Signal cancellation installs one captured abort listener for the pending default yield. Abort records the first primary and waits for the schedule return boundary when necessary; cleanup cancels the task once, removes the listener once, and attaches later cleanup failures without replacing the primary. Schedule throw, invalid task, cancel getter failure, and cancel call failure all settle the Promise through serialize-owned `INVALID_OPTION`; no detached Promise is created for cleanup work.

### 4.9 Round23 registration-race ownership

`listenerAttempted` is set before calling captured `addEventListener`; cleanup therefore removes a listener that was stored before a host threw. After successful registration, `aborted` is rechecked and `onAbort()` is the only abort admission path before `scheduler.schedule()`. After throwing registration, the same structural recheck is attempted, but wrapped registration failure remains primary. Callback-before-return follows same rule: callback return yields `ABORTED`; callback throw yields registration `INVALID_OPTION` with throw as `cause`. Cleanup removes attempted listener once, retains primary, and appends cleanup failures to `errors`.

| ID | Requirement |
| --- | --- |
| SER-R23-01 | Mark abort-listener registration attempted before the external call; recheck `aborted/reason` after successful or throwing registration before scheduler admission. |
| SER-R23-02 | Stored-then-abort, abort-then-store, stored-then-throw, and callback-before-return/throw paths remove any possibly stored listener and admit no scheduled task. |
| SER-R23-03 | Successful callback abort remains the primary outcome; a registration throw remains the primary outcome after callback/recheck activity, with exact serialize `source/code/cause`. |
| SER-R23-04 | Remove/cancel failures remain contained but reachable as serialize secondary `errors`; every path settles without pending yield or unhandled rejection. |

### 4.10 Round24 requirements

| ID | Requirement |
| --- | --- |
| SER-R24-01 | Every encode Promise admitted to `encodeStream` has rejection observed immediately, while FIFO draining preserves output order and exact wrapped error identity/code. |
| SER-R24-02 | Hostile array Proxy `length` and index getters during registry chunk-shape detection/validation become `ENCODE_FAILED` `SerializeCodecError` values with serialize `source` and exact `cause`. |
| SER-R24-03 | Hostile async/sync iterator protocol reads and thenable assimilation in `decodeStream`/`collectStream` become operation-appropriate codec errors with native class, source/code, current index, exact cause, and existing iterator cleanup semantics. |
| SER-R24-04 | Every requirement ID referenced by section-7 closure mappings has exactly one canonical declaration, and the static check itself is package-scoped and reproducible. |

### 4.11 Round25 requirements

| ID | Requirement |
| --- | --- |
| SER-R25-01 | `collectStream` validates exact tuple length, known tag, and tag-specific payload before reading tag-specific fields; malformed chunks and forbidden `value` chunks preserve `INVALID_CHUNK`, current `chunkIndex`, and prior `bytesConsumed`. |
| SER-R25-02 | `encodeStream` and `decodeStream` snapshot every public option getter once and validate getter/shape/type failures inside serialize `INVALID_OPTION` before input iterator, scheduler, registry, or parser side effects. |

### 4.12 Round26 requirements

| ID | Requirement |
| --- | --- |
| SER-R26-01 | Chunk validation reads tuple length/kind/data once, returns an immutable safe snapshot retaining bytes/value identity, and preserves `INVALID_CHUNK` index/progress/cause on hostile getter failure without coercing tags. |
| SER-R26-02 | `encodeStream` catches synchronous `registry.encode` throws inside the indexed `ENCODE_FAILED` boundary, observes pending rejections immediately, and preserves FIFO, `maxInFlight`, and thenable behavior with no unhandled rejection. |

### 4.13 Round29 requirements

| ID | Requirement |
| --- | --- |
| SER-R29-01 | A signal snapshot captures pre-aborted state and reason by identity; `raceAbort` reads only the snapshot/composed signal, never the caller's raw `aborted` getter after admission. Hostile getter rereads become serialize-owned `INVALID_OPTION`, while registration recheck and listener receiver/identity semantics remain intact. |
| SER-R29-02 | Registry text/bytes collection maps injected encoder method getter/call failures to `ENCODE_FAILED`, and invalid encoder returns to `INVALID_CHUNK`, preserving serialize source, exact chunk index, prior byte progress, and original cause without publishing partial output. |
| SER-R29-03 | `collectStream` mixed text/bytes collection uses the same canonical text-encoding boundary; valid encoder receiver/output behavior is unchanged, and getter/call/invalid-return failures preserve operation-appropriate code, index, progress, and cause. |

## 5. 生命周期与错误语义

状态：composition open → abort/rollback requested → terminal cleanup。`dispose()` exactly-once；registration callback 重入期间只延迟 cleanup，不重复安装或释放。

- 正常 settle/abort：closing listener 先移除，caller listener 后移除。
- partial registration failure：若 closing add 已被尝试但抛错，先尝试 closing remove，再释放 caller remove；包装后的 `INVALID_OPTION` primary 的 `cause` 必须是原 registration failure。
- multiple removal failures：每项 removal 均尝试；按 closing → caller 顺序逐项 report；report 自身抛错被 containment，不替换 primary。
- registry parser cleanup：单错继续保持原错误 identity；多错由既有 lifecycle aggregate 暴露全部原错误于 `AggregateError.errors`，不得丢失或重排。
- reason extraction：encode/decode/parser iterable failures preserve exact safe text; hostile message getter or coercion failure falls back deterministically and keeps the original primary as `cause`.

- deadline failure：`scheduler.now`/`schedule`/invalid task/cancel getter/cancel call 均先记为 primary，再执行 parser cleanup；sync callback 仍取消已返回 task；cleanup failure 不替换先观察到的 scheduler failure。
- terminal/identity：valid `dispose()` publishes one Promise before deadline work; repeated calls reuse that Promise and disposed registry rejects new operations even when deadline or cleanup fails。
- default stream yield：one admitted task remains owned until callback/settlement/failure/cancellation cleanup; callback-before-return still cancels the returned handle exactly once。
- stream cancellation/dispose：abort settles the pending yield and releases its task; cleanup failure is secondary when a primary already exists, and neither path leaves an unhandled rejection or pending Promise。
- registration race：stored-then-abort、abort-then-store、stored-then-throw、callback-then-return 与 callback-then-throw 均不得进入 scheduler；registration primary 的 `cause` 与 cleanup error 的 source/code/cause/errors 必须保持精确。
- signal snapshot：pre-aborted `aborted`/`reason` are immutable admission facts; a hostile raw getter that would fail on reread cannot replace the cached reason or escape as a raw error. Non-pre-aborted rechecks still observe registration races through the snapshot boundary and map accessor failures to `INVALID_OPTION`.
- text encoding failure：registry and mixed `collectStream` conversion first encode all text parts into temporary parts, then allocate/merge output. Encoder getter/call failures reject as `ENCODE_FAILED`; non-`Uint8Array` returns reject as `INVALID_CHUNK`; both retain current index, prior `bytesConsumed`, and cause, with no partial output.

## 6. 迁移与实施批次

### Batch R17

顺序：`inventory → red test → contract/error registration（本轮无新 error code） → implementation → 删除错误的正序 cleanup path → docs/tests → package gates → evidence`。

- 文件范围：`packages/serialize/src/signal.ts`、`packages/serialize/test/signal.test.ts`、`packages/serialize/test/registry.test.ts`、本 SDD。
- Exit condition：七个 `SER-T17-*` cases 通过；既有 signal abort/receiver/idempotency cases 不回归；package gates 全部通过。
- Direct-consumer/repository gates：本用户请求只要求 serialize gates；未执行的更大范围 gates 必须在 evidence 中明确标为未执行。

### Batch R18

顺序：`inventory → red test → contract/error registration（本轮无新 error code） → implementation → delete deadline early-return path → docs/tests → package gates → direct-consumer/repository gates not requested → evidence`。

- 文件范围：`packages/serialize/src/registry.ts`、`packages/serialize/test/registry.test.ts`、本 SDD。
- Red cases: `SER-T18-01`～`SER-T18-08`。
- Exit condition: all deadline ingress failures run parser cleanup exactly once; first scheduler failure and cleanup `errors`/report semantics are asserted; synchronous callback and Promise identity regressions pass; required serialize gates pass.
- Direct-consumer/repository gates remain outside this user scope and must be reported as not run.

### Batch R19

顺序：`inventory → red consumer compile case → implementation → emitted d.ts inspection → docs/exports → package gates → package-boundary consumer gate → diff-check → evidence`。

- 文件范围：`packages/serialize/src/{core,index,registry}.ts`、`packages/serialize/test/package-exports.test.ts`、本 SDD。
- Exit condition：root 与每个 declared subpath 的 runtime imports resolve；consumer compile case imports every required named type from intended entrypoint；emitted declarations contain no unresolved internal-only type dependency or duplicate public declaration；all requested gates pass。

### Batch R20

顺序：`inventory → red consumer compile case → root/subpath compile-use imports → docs/evidence → package gates → package-boundary consumer gate → diff-check`。

- `SER-R20-01`：package-boundary test must compile-use AF-152 registry options, scheduler, cleanup/timeout diagnostics and encoder/decoder types from both the root package and their intended declared subpaths; no source-relative import is allowed。
- `SER-D20-01`：`package-exports.test.ts` owns compile-use coverage only; production exports remain unchanged because current root declarations already re-export the required names。
- 文件范围：`packages/serialize/test/package-exports.test.ts`、本 SDD。
- Exit condition：root and subpath aliases are typechecked in one consumer case, requested serialize gates and consumer gate pass, and SDD evidence records final test count。

### Batch R21

顺序：`inventory → red core boundary tests → local scheduler snapshot/validation → core subpath consumer assertion → package gates → consumer gate → diff-check → evidence`。

- `SER-R21-01`：stream/core scheduler getter、`now()`、NaN/Infinity、`schedule()`、task `cancel` accessor failures expose serialize-owned `INVALID_OPTION` with stable diagnostic and native error type。
- `SER-R21-02`：hostile scheduler failures preserve exact original object as `cause`; no lifecycle `source`/`code`/diagnostic leaks through core。
- `SER-R21-03`：`@migaia/serialize/core` remains dependency-neutral at runtime and its declared error/stream exports compile through the package subpath。
- 文件范围：`packages/serialize/src/{stream,errors}.ts`、`packages/serialize/test/{stream,package-exports}.test.ts`、本 SDD。
- Exit condition：SER-T21-01～SER-T21-03 pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, package consumer gate, and scoped diff-check pass。

### Batch R22

顺序：`inventory → red stream ownership cases → reuse existing serialize INVALID_OPTION contract → default-yield ownership implementation → focused stream tests → package gates → consumer gate → diff-check → evidence`。

- `SER-R22-01`：default yield retains each admitted task and cancels it exactly once after asynchronous callback, synchronous callback-before-return, normal settlement, or failure/cancellation cleanup。
- `SER-R22-02`：schedule throw, invalid task, cancel getter failure, and cancel call failure settle through serialize-owned `INVALID_OPTION`; original hostile failure remains exact `cause`, with native TypeError preserved。
- `SER-R22-03`：signal cancellation/dispose releases pending default-yield state; cleanup failure cannot replace earlier primary, cannot leave Promise pending, and cannot create unhandled rejection。
- 文件范围：`packages/serialize/src/{stream,errors}.ts`、`packages/serialize/test/stream.test.ts`、本 SDD；不修改 Store、foundation 或 lifecycle。
- Exit condition：T22-01～T22-03 pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, requested consumer gate, and scoped diff-check pass。

### Batch R23

顺序：`inventory → red registration-race cases → reuse compose signal attempted/removed pattern → implementation → focused stream tests → package gates → direct-consumer gate → diff-check → evidence`。

- `SER-R23-01`：`addEventListener()` admission is marked attempted before invocation; successful and throwing registration paths recheck structural abort state/reason before scheduling。
- `SER-R23-02`：stored-then-abort、abort-then-store、stored-then-throw、callback-then-return/throw all force removal of any possibly stored listener and never call `scheduler.schedule()`。
- `SER-R23-03`：callback abort wins after successful registration; registration throw wins after callback/recheck activity, with original registration failure reachable through `cause`。
- `SER-R23-04`：remove/cancel cleanup failures remain serialize-owned secondary `errors`; no pending yield Promise, scheduled-task leak, or unhandled rejection is left。
- 文件范围：`packages/serialize/src/stream.ts`、`packages/serialize/test/stream.test.ts`、本 SDD；不修改 Store、foundation 或 lifecycle。
- Exit condition：`SER-T23-01`～`SER-T23-05` pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, requested consumer gate, and scoped diff-check pass。

### Batch R24

顺序：`inventory → red defect cases → reuse existing ENCODE_FAILED/DECODE_FAILED contracts → immediate Promise observation and codec-boundary implementation → SDD declaration/static-check update → focused tests → package gates → direct-consumer gate → diff-check → evidence`。

- `SER-R24-01`：queued encode Promise rejection is observed at admission; FIFO drain still awaits original Promise and preserves exact wrapped cause/code。
- `SER-R24-02`：hostile array Proxy length/index reads cannot escape registry encode boundary; both getter failures become `SerializeCodecError` + `ENCODE_FAILED` with exact cause。
- `SER-R24-03`：decode/collect async and sync iterator protocol/thenable failures become operation-appropriate codec errors; native `for await` precedence and cleanup semantics remain intact。
- `SER-R24-04`：`serialize-sdd.test.ts` proves every section-7 mapped requirement has exactly one canonical declaration, including newly explicit Round18/19 declarations。
- 文件范围：`packages/serialize/src/{registry,stream}.ts`、`packages/serialize/test/{registry,stream,serialize-sdd}.test.ts`、本 SDD；不修改 Store、foundation、其他 package/docs 或 error registry。
- Exit condition：`SER-T24-01`～`SER-T24-04` pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, `typecheck:consumers`, and scoped `git diff --check` pass。

### Batch R25

顺序：`inventory → red chunk/option-admission cases → reuse shared chunk validator and existing INVALID_OPTION contract → implementation → focused tests/SDD stable IDs → package gates → eight consumer configurations → diff-check → evidence`。

- `SER-R25-01`：`collectStream` validates exact tuple length, tag, and payload before any tag-specific property access; malformed input and forbidden `value` chunks reject as serialize `SerializeCodecError` + `INVALID_CHUNK` at the current index with prior `bytesConsumed`。
- `SER-R25-02`：`encodeStream` and `decodeStream` read every public option getter once, validate getter/shape/type failures inside serialize native `INVALID_OPTION`, and complete admission before touching input iterators, frame schedulers, registry methods, or parser work。
- 文件范围：`packages/serialize/src/{types,registry,stream}.ts`、`packages/serialize/test/round25.test.ts`、本 SDD；不修改 Store、foundation、lifecycle、consumer fixtures 或 error registry。
- Exit condition：`SER-T25-01`～`SER-T25-06` pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, all eight `typecheck:consumers` configurations, and scoped `git diff --check` pass。

### Batch R26

顺序：`inventory → red hostile-tuple/sync-throw cases → reuse INVALID_CHUNK/ENCODE_FAILED contracts → immutable tuple snapshot and indexed invocation boundary → focused tests/SDD stable IDs → package gates → eight consumer configurations → diff-check → evidence`。

- `SER-R26-01`：validator snapshots exact tuple length/kind/data reads into a frozen tuple; bytes/value payload identity survives, later collection performs no raw tuple reread, and hostile getter/tag cases preserve index/progress/cause without `toString()` coercion。
- `SER-R26-02`：synchronous `registry.encode` throws become indexed `ENCODE_FAILED` with the original throw as `cause`; pending earlier operations remain observed, FIFO/maxInFlight behavior stays unchanged, and thenables remain assimilated。
- 文件范围：`packages/serialize/src/{types,stream}.ts`、`packages/serialize/test/round26.test.ts`、本 SDD；不修改 Store、foundation、lifecycle、consumer fixtures 或 error registry。
- Exit condition：`SER-T26-01`～`SER-T26-04` pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, all eight `typecheck:consumers` configurations, and scoped `git diff --check` pass。

### Batch R27

顺序：`inventory → red FIFO sync-throw/core-graph cases → reuse ENCODE_FAILED and existing signal semantics → queue rejected sync failures and replace lifecycle signal controller in core path → import-graph/bundle test → focused tests/SDD stable IDs → package gates → build/bundle → eight consumer configurations → diff-check → evidence`。

- `SER-R27-01`：sync `registry.encode` throw is converted to an immediately observed rejected queue entry; with `maxInFlight=2`, index 0 drains/yields before index 1 rejects as `ENCODE_FAILED`, with no unhandled rejection and unchanged thenable/backpressure behavior.
- `SER-R27-02`：core's transitive runtime import graph and bundle contain no workspace package, including `@migaia/lifecycle`; serialize-owned signal snapshot/controller preserves first-observed abort reason identity and existing race cleanup semantics.
- 文件范围：`packages/serialize/src/{signal,stream}.ts`、`packages/serialize/test/{round26,round27}.test.ts`、本 SDD；runtime-neutrality mapping/evidence only if required；不修改 Store/other packages。
- Exit condition：updated `SER-T26-03` plus `SER-T27-01`～`SER-T27-02` pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, core bundle/import-graph test, all eight `typecheck:consumers` configurations, and scoped `git diff --check` pass。

### Batch R29

顺序：`inventory → red hostile-signal/encoder cases → reuse existing INVALID_OPTION/ENCODE_FAILED/INVALID_CHUNK contracts → snapshot boundary and shared text-encoder boundary → focused tests/SDD stable IDs → package gates → core neutrality/eight consumers → diff-check → evidence`。

- `SER-R29-01`：pre-aborted signal state/reason are cached once; `raceAbort` never rereads caller raw `aborted`; dynamic registration rechecks remain listener-identity/receiver safe and hostile getter failures remain serialize `INVALID_OPTION`.
- `SER-R29-02`：registry mixed collection wraps encoder getter/call/invalid-return failures with exact `ENCODE_FAILED`/`INVALID_CHUNK`, index, prior byte progress, source, and cause; no merged partial result escapes.
- `SER-R29-03`：`collectStream` reuses the same core-neutral encoder boundary and preserves valid receiver/output behavior.
- 文件范围：`packages/serialize/src/{signal,registry,stream,types,errors}.ts`、`packages/serialize/test/round29.test.ts`、本 SDD；不修改 Store、foundation、lifecycle、consumer fixtures 或 error registry。
- Exit condition：`SER-T29-01`～`SER-T29-07` pass; serialize `fmt → lint → typecheck → typecheck:test → test → build`, core neutrality, all eight `typecheck:consumers` configurations, and scoped `git diff --check` pass。

## 7. 测试与验收矩阵

| Case | 层级 | 语义断言 | 覆盖条款 |
| --- | --- | --- | --- |
| SER-T17-01 | serialize unit | caller 先安装、closing 后安装；正常 dispose 以 closing → caller 逆序移除，且重复 dispose 不再调用 remove。 | SER-R17-01, SER-R17-02, SER-D17-02 |
| SER-T17-02 | serialize unit | closing registration 部分失败时，closing rollback 先于 caller rollback；抛出的 `INVALID_OPTION` 保持原 registration failure 为 `cause`，不附加伪造 `errors`。 | SER-R17-03, SER-D17-03 |
| SER-T17-03 | serialize unit | caller 与 closing removal 均失败时，两次 removal 都各执行一次，并按 closing → caller 顺序经既有 `report` channel 观测；不引入 compatibility wrapper、额外错误码或 foundation abstraction，report failure 不逃逸。 | SER-R17-02, SER-R17-04, SER-D17-04 |
| SER-T17-04 | registry unit | 两个 parser disposer 均失败时，两个 disposer 都被调用，aggregate 的 `errors` 保持每个原错误可达且 primary/aggregate 语义不被后续 cleanup 覆盖。 | SER-R17-05, SER-D17-01 |
| SER-T17-05 | registry unit | parser encode 抛出 hostile `Error.message` getter 时，结果仍是 `SerializeCodecError`，fallback 文本稳定，且 `cause === primary`。 | SER-R17-06, SER-R17-07 |
| SER-T17-06 | registry unit | parser encode 抛出 primitive 与无法 string-coerce 的 object 时，安全文本保留或 fallback，原值仍是 `cause`。 | SER-R17-06, SER-R17-07 |
| SER-T17-07 | registry unit | parser decode 与 iterator `next()` 的 hostile message/coercion failures 都被包成对应 boundary error，不能裸抛或替换 primary。 | SER-R17-06, SER-R17-07 |
| SER-T18-01 | registry unit | scheduler `now` getter throws during option admission; registry emits serialize `INVALID_OPTION` with the original getter failure reachable and no parser has been owned. | SER-R18-01, SER-D18-01 |
| SER-T18-02 | registry unit | captured scheduler `now()` throws during dispose; the same dispose Promise rejects with that exact error, parser disposer runs once, and later encode is rejected as disposed. | SER-R18-01, SER-R18-04 |
| SER-T18-03 | registry unit | scheduler `schedule()` throw, invalid task, and task `cancel` getter throw each preserve a failure result while parser disposer still runs exactly once. | SER-R18-01, SER-D18-02 |
| SER-T18-04 | registry unit | scheduler invokes deadline callback synchronously; returned task is still cancelled once and parser cleanup completes. | SER-R18-02 |
| SER-T18-05 | registry unit | admitted task `cancel()` throws after deadline race; cancel failure remains primary and parser cleanup still executes. | SER-R18-02, SER-D18-02 |
| SER-T18-06 | registry unit | throw policy with cancel failure plus parser dispose failure preserves cancel error identity and exposes parser failure in primary `errors`, without replacing the deadline primary. | SER-R18-03, SER-D18-03 |
| SER-T18-07 | registry unit | report policy with schedule failure plus parser dispose failure rejects with schedule primary, reports cleanup once through the existing cleanup reporter, and contains cleanup reporter throw. | SER-R18-03, SER-D18-03 |
| SER-T18-08 | registry unit | deadline failure/cleanup combinations do not leave detached rejection unhandled; terminal state and first dispose Promise remain stable. | SER-R18-04, SER-D18-04 |
| SER-T19-01 | package-boundary consumer compile | Consumer imports runtime APIs and required named types from `@migaia/serialize`, `/core`, `/plugins`, and `/registry` only through declared package exports; TypeScript resolves every signature without source-relative paths. | SER-R19-01, SER-R19-02, SER-D19-01, SER-D19-02 |
| SER-T19-02 | emitted declaration inspection | Built `dist/index.d.ts`, `core.d.ts`, and `registry.d.ts` expose required named types through public re-exports and retain no internal-only snapshot type in public signatures. | SER-R19-03, SER-D19-01, SER-D19-02 |
| SER-T20-01 | package-boundary consumer compile | The test compile-uses AF-152 registry options, scheduler, cleanup/timeout diagnostics and encoder/decoder types from `@migaia/serialize` and intended `/core` or `/registry` subpaths, proving root re-export removal breaks typechecking without any source-relative import. | SER-R20-01, SER-D20-01 |
| SER-T21-01 | core stream unit | Scheduler getter/`now()` throws preserve exact cause; NaN, positive Infinity, and negative Infinity produce serialize `RangeError` with exact `@migaia/serialize`/`INVALID_OPTION`. | SER-R21-01, SER-R21-02, SER-D21-01, SER-D21-02 |
| SER-T21-02 | core stream unit | `schedule()` throws and returned task `cancel` accessor throws produce serialize `TypeError` with exact source/code and original cause. | SER-R21-01, SER-R21-02, SER-D21-02 |
| SER-T21-03 | package-boundary consumer compile | Consumer imports stream APIs and serialize error ownership symbols from `@migaia/serialize/core`; no source-relative import or lifecycle error contract is required. | SER-R21-03, SER-D21-01 |
| SER-T22-01 | core stream unit | Default asynchronous callback retains the task until callback settlement and invokes `cancel()` once; callback-before-return follows the same exactly-once release rule. | SER-R22-01, SER-D22-01, SER-D22-02 |
| SER-T22-02 | core stream unit | Default-yield cancel throw becomes native serialize `TypeError` with `INVALID_OPTION`, exact `cause`, and settled iterator; existing schedule/invalid-task/cancel-getter cases remain the admission-failure baseline. | SER-R22-02, SER-D22-02 |
| SER-T22-03 | core stream unit | Abort/dispose while default yield is pending settles with serialize `ABORTED`, cancels once, preserves the abort primary when cancel cleanup throws, and leaves no detached rejection. | SER-R22-03, SER-D22-03 |
| SER-T23-01 | core stream unit | Stored-then-abort and abort-then-store signals are rechecked after registration, settle with exact serialize `ABORTED` source/code/cause, remove the attempted listener once, call no scheduler, and produce no unhandled rejection. | SER-R23-01, SER-R23-02, SER-R23-04, SER-D23-01, SER-D23-03 |
| SER-T23-02 | core stream unit | Stored-then-throw preserves native serialize `TypeError` + `INVALID_OPTION`, exact registration failure `cause`, force-removes the possibly stored listener, and never schedules. | SER-R23-01, SER-R23-02, SER-R23-03, SER-D23-02 |
| SER-T23-03 | core stream unit | `addEventListener()` callback-then-return yields exact abort primary; callback-then-throw yields exact registration primary with the registration failure as `cause`; both remove once and never schedule. | SER-R23-02, SER-R23-03, SER-D23-02, SER-D23-03 |
| SER-T23-04 | core stream unit | Partial-registration removal failure remains a serialize `INVALID_OPTION` secondary with exact `cause` in abort primary `errors`; Promise settles and no scheduler task is admitted. | SER-R23-04, SER-D23-02 |
| SER-T23-05 | core stream unit | Existing scheduled-yield cancel failure remains serialize-owned `INVALID_OPTION` secondary/primary with exact `cause`; together with T23-01～04 it proves no pending yield or unhandled rejection across registration and cleanup races. | SER-R23-04, SER-D23-02, SER-D23-03 |
| SER-T24-01 | core stream unit | With `maxInFlight=2`, a later immediately rejected encode Promise is observed before the earlier Promise settles; FIFO drain yields the earlier chunk first, then returns `ENCODE_FAILED` with the exact rejected Promise error as `cause`, and no unhandled rejection event occurs. | SER-R24-01, SER-D24-01 |
| SER-T24-02 | registry unit | Array Proxy `length` and index getter failures during chunk-shape detection become native `SerializeCodecError` values with exact serialize `source`/`ENCODE_FAILED`/`cause`, never raw getter errors. | SER-R24-02, SER-D24-02 |
| SER-T24-03 | core stream unit | Throwing async/sync iterator factory, `next`, result `done`/`value`, and hostile async thenable failures in `decodeStream`/`collectStream` preserve operation, native codec class, source/code, current index, exact cause, and observed language-level cleanup semantics. | SER-R24-03, SER-D24-03 |
| SER-T24-04 | serialize SDD static check | Section-7 mapped `SER-R18-*`/`SER-R19-*` and all other mapped requirement IDs each resolve to exactly one canonical declaration; duplicate or orphan declarations fail the test. | SER-R24-04, SER-D24-04 |
| SER-T25-01 | core stream unit | Null, wrong-length, unknown-tag, text-payload, and bytes-payload inputs after a valid prefix all reject as `INVALID_CHUNK` with `chunkIndex` at the malformed item and `bytesConsumed` equal to the validated prefix. | SER-R25-01, SER-D25-01 |
| SER-T25-02 | core stream unit | A `value` chunk is rejected at its own index as `INVALID_CHUNK`, preserving prior progress and never entering text/bytes merge logic. | SER-R25-01, SER-D25-01 |
| SER-T25-03 | core stream unit | Encode options with getters for every frame, signal, scheduler, type, context, and backpressure field are each read once; two slices encode successfully, proving admission completed before slice/registry work. | SER-R25-02, SER-D25-02 |
| SER-T25-04 | core stream unit | A throwing decode option getter rejects as serialize `INVALID_OPTION` before the source iterator's async-iterator getter is read; the original getter failure remains the `cause`. | SER-R25-02, SER-D25-02 |
| SER-T25-05 | core stream unit | A throwing encode option getter rejects as serialize `INVALID_OPTION` before any registry encode call, preserving the original `cause` and no-side-effect admission boundary. | SER-R25-02, SER-D25-02 |
| SER-T25-06 | core stream unit | Valid decode stream options still admit and decode every input chunk in order after the snapshot boundary. | SER-R25-02, SER-D25-02 |
| SER-T26-01 | core stream unit | A stateful tuple Proxy changes tag/payload after validation, but collection returns the validated kind/data; the tuple is frozen and the original `Uint8Array` identity is retained. | SER-R26-01, SER-D26-01 |
| SER-T26-02 | core stream unit | Wrong tuple length reads length once; hostile payload getter failure remains `INVALID_CHUNK` at the malformed index with prior `bytesConsumed` and exact `cause`; hostile tag `toString()` is never invoked. | SER-R26-01, SER-D26-01 |
| SER-T26-03 | core stream unit | With an earlier encode Promise pending, a later synchronous `registry.encode` throw becomes indexed `ENCODE_FAILED` with exact `cause`; the earlier rejection is observed in cleanup and emits no unhandled rejection. | SER-R26-02, SER-D26-02 |
| SER-T26-04 | core stream unit | A registry thenable is assimilated into one ordered output under `maxInFlight=1`; no `.catch` capability is required on the thenable and normal backpressure completion remains intact. | SER-R26-02, SER-D26-02 |
| SER-T27-01 | core import-graph/bundle unit | Static core closure has only relative imports and the built core bundle contains neither declared package dependency nor `@migaia/lifecycle`. | SER-R27-02, SER-D27-02 |
| SER-T27-02 | core signal unit | The serialize-owned composed signal preserves the first abort reason object by identity while existing stream/abort cleanup remains intact. | SER-R27-02, SER-D27-02 |
| SER-T29-01 | registry signal unit | A pre-aborted caller whose raw `aborted` getter throws on reread rejects as `ABORTED` with the original reason identity and only one raw state read; no raw getter error escapes. | SER-R29-01, SER-D29-01 |
| SER-T29-02 | core signal unit | Caller abort during listener registration is rechecked through the snapshot boundary, preserves reason identity, removes the attempted listener once, and retains listener receiver/identity semantics. | SER-R29-01, SER-D29-01 |
| SER-T29-03 | registry unit | An injected encoder method call failure in mixed registry collection preserves encoder receiver, `ENCODE_FAILED`, text chunk index, prior byte progress, and exact `cause`. | SER-R29-02, SER-D29-02 |
| SER-T29-04 | registry unit | An injected encoder non-byte return rejects as `INVALID_CHUNK` at the text chunk index with prior byte progress and the returned hostile object as `cause`; no partial merged output is returned. | SER-R29-02, SER-D29-02, SER-D29-03 |
| SER-T29-05 | registry admission unit | An injected encoder method getter failure is admitted as native serialize `INVALID_OPTION` with exact `cause` before parser work. | SER-R29-02, SER-D29-02 |
| SER-T29-06 | core stream unit | Mixed `collectStream` getter, call, and non-byte encoder failures map to operation-owned `ENCODE_FAILED`/`INVALID_CHUNK` with exact index, prior progress, and cause. | SER-R29-03, SER-D29-02 |
| SER-T29-07 | core stream unit | A valid mixed `collectStream` encoder keeps original receiver and byte output, proving the failure boundary does not change successful encoding. | SER-R29-03, SER-D29-03 |

需求闭合：`SER-R17-01` = `SER-T17-01`；`SER-R17-02` = `SER-T17-01`/`SER-T17-03`；`SER-R17-03` = `SER-T17-02`；`SER-R17-04` = `SER-T17-03`；`SER-R17-05` = `SER-T17-04`；`SER-R17-06` = `SER-T17-05`/`SER-T17-06`/`SER-T17-07`；`SER-R17-07` = `SER-T17-05`/`SER-T17-06`/`SER-T17-07`。每个 case 的断言必须证明语义，不得只检查 ID 或调用次数。

Round17 decisions 闭合：`SER-D17-01` = `SER-T17-01`/`SER-T17-02`；`SER-D17-02` = `SER-T17-01`/`SER-T17-03`；`SER-D17-03` = `SER-T17-03`；`SER-D17-04` = `SER-T17-03`。每个 decision 均有语义断言与反向 case 引用。

Round18 闭合：`SER-R18-01` = `SER-T18-01`/`SER-T18-02`/`SER-T18-03`；`SER-R18-02` = `SER-T18-04`/`SER-T18-05`；`SER-R18-03` = `SER-T18-06`/`SER-T18-07`；`SER-R18-04` = `SER-T18-02`/`SER-T18-08`。`SER-D18-01` = `SER-T18-01`；`SER-D18-02` = `SER-T18-03`/`SER-T18-05`；`SER-D18-03` = `SER-T18-06`/`SER-T18-07`；`SER-D18-04` = `SER-T18-08`。`SER-T18-08` 的 unhandled-rejection 断言由 awaited dispose/public operation promises 与 detached task rejection observer 共同构成，不仅检查调用次数。

Round19 闭合：`SER-R19-01` = `SER-T19-01`/`SER-T19-02`；`SER-R19-02` = `SER-T19-01`；`SER-R19-03` = `SER-T19-02`。`SER-D19-01` = `SER-T19-01`/`SER-T19-02`；`SER-D19-02` = `SER-T19-01`/`SER-T19-02`。`SER-T19-01` imports 必须来自 package names 与 declared subpaths；`SER-T19-02` 必须检查 build 后 declarations，不以 source typecheck 替代。

Round20 闭合：`SER-R20-01` = `SER-T20-01`；`SER-D20-01` = `SER-T20-01`。`SER-T20-01` explicitly uses root aliases for all AF-152 type families and retains intended `/core` and `/registry` aliases; the assertions exercise those types through value declarations so removing a root re-export fails `typecheck:test`。

Round21 requirement and decision closure：`SER-R21-01` = SER-T21-01/SER-T21-02；`SER-R21-02` = SER-T21-01/SER-T21-02；`SER-R21-03` = SER-T21-03。`SER-D21-01` = SER-T21-01/SER-T21-02；`SER-D21-02` = SER-T21-01/SER-T21-02/SER-T21-03。Each case asserts exact serialize source/code and, for hostile failures, exact cause identity; native error class is asserted separately from message text.

Round22 requirement and decision closure：`SER-R22-01` = SER-T22-01；`SER-R22-02` = SER-T22-02 plus the existing admission assertions in SER-T21-02；`SER-R22-03` = SER-T22-03。`SER-D22-01` = SER-T22-01/SER-T22-03；`SER-D22-02` = SER-T22-01/SER-T22-02；`SER-D22-03` = SER-T22-03。Each new case asserts semantic ownership/settlement, not only a scheduler call count。

Round23 requirement and decision closure：`SER-R23-01` = SER-T23-01/SER-T23-02/SER-T23-03；`SER-R23-02` = SER-T23-01/SER-T23-02/SER-T23-03；`SER-R23-03` = SER-T23-02/SER-T23-03；`SER-R23-04` = SER-T23-01/SER-T23-04/SER-T23-05。`SER-D23-01` = SER-T23-01；`SER-D23-02` = SER-T23-02/SER-T23-03/SER-T23-04/SER-T23-05；`SER-D23-03` = SER-T23-01/SER-T23-03/SER-T23-05。Each case asserts semantic state, exact error identity, cleanup reachability, and no scheduling/pending/unhandled leak rather than only call counts。

Round24 requirement and decision closure：`SER-R24-01` = SER-T24-01；`SER-R24-02` = SER-T24-02；`SER-R24-03` = SER-T24-03；`SER-R24-04` = SER-T24-04。`SER-D24-01` = SER-T24-01；`SER-D24-02` = SER-T24-02；`SER-D24-03` = SER-T24-03；`SER-D24-04` = SER-T24-04。T24-03 intentionally records native `for await` cleanup semantics: sync protocol abrupt failures close through the sync adapter, while async `next()` rejection follows the host language protocol without an invented close call.

Round25 requirement and decision closure：`SER-R25-01` = SER-T25-01/SER-T25-02；`SER-R25-02` = SER-T25-03/SER-T25-04/SER-T25-05/SER-T25-06。`SER-D25-01` = SER-T25-01/SER-T25-02；`SER-D25-02` = SER-T25-03/SER-T25-04/SER-T25-05/SER-T25-06。Every case asserts semantic error code/index/progress or admission ordering, not only getter/call counts。

Round26 requirement and decision closure：`SER-R26-01` = `SER-T26-01`/`SER-T26-02`；`SER-R26-02` = `SER-T26-03`/`SER-T26-04`。`SER-D26-01` = `SER-T26-01`/`SER-T26-02`；`SER-D26-02` = `SER-T26-03`/`SER-T26-04`。Cases assert immutable snapshot semantics, payload identity, no coercion, exact failure traceability, indexed sync-throw ownership, pending rejection observation, thenable assimilation, and no unhandled rejection。

Round27 requirement and decision closure：`SER-R27-01` = updated `SER-T26-03`；`SER-R27-02` = `SER-T27-01`/`SER-T27-02`。`SER-D27-01` = updated `SER-T26-03`；`SER-D27-02` = `SER-T27-01`/`SER-T27-02`。Updated T26-03 asserts pending-success FIFO order, next-drain index/error ownership, immediate observation, thenable/backpressure preservation, and no unhandled rejection; T27-01 asserts transitive source/bundle package exclusion; T27-02 asserts first-observed abort reason identity.

SDD ID closure：`serialize-sdd.test.ts` extracts canonical requirement rows/bullets and section-7 left-hand mappings, rejects duplicate canonical declarations, and requires every mapped requirement (`SER-R18-*`, `SER-R19-*`, and all prior/current mapped IDs) to resolve exactly once. This static check is itself `SER-T24-04` evidence, not a replacement for semantic runtime cases.

Round29 requirement and decision closure：`SER-R29-01` = `SER-T29-01`/`SER-T29-02`；`SER-R29-02` = `SER-T29-03`/`SER-T29-04`/`SER-T29-05`；`SER-R29-03` = `SER-T29-06`/`SER-T29-07`。`SER-D29-01` = `SER-T29-01`/`SER-T29-02`；`SER-D29-02` = `SER-T29-03`/`SER-T29-04`/`SER-T29-05`/`SER-T29-06`；`SER-D29-03` = `SER-T29-04`/`SER-T29-07`。Cases assert source/code/native boundary, identity, index/progress/cause, receiver behavior, and no partial output rather than only getter/call counts。

## 8. 证据与闭合映射

当前 dirty-worktree 基线包含用户既有跨包改动；本轮只声明 serialize 路径与本文件的新增/修改。已执行：

- `CI=true pnpm --filter @migaia/serialize fmt`：passed，oxfmt 19 files，2026-08-18，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize lint`：passed，2026-08-18，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors，2026-08-18，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize typecheck:test`：passed，2026-08-18，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize test`：passed，7 files / 115 tests，2026-08-18，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize build`：passed，2026-08-18，dirty worktree。
- `git diff --check -- packages/serialize docs/serialize`：passed，2026-08-18，dirty worktree。

Round18 evidence, same dirty-worktree baseline:

- `CI=true pnpm --filter @migaia/serialize fmt`：passed，oxfmt 19 files，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize lint`：passed，2026-08-18。
- `CI=true rtk proxy pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors，2026-08-18。
- `CI=true rtk proxy pnpm --filter @migaia/serialize typecheck:test`：passed，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize test`：passed，7 files / 124 tests，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize build`：passed，2026-08-18。
- `git diff --check -- packages/serialize docs/serialize`：passed，2026-08-18。

Round19 evidence, same dirty-worktree baseline:

- `CI=true pnpm --filter @migaia/serialize fmt`：passed，oxfmt 20 files，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize lint`：passed，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize typecheck:test`：passed，package-boundary consumer compile case included，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize test`：passed，8 files / 125 tests，including `SER-T19-01`，2026-08-18。
- `CI=true pnpm --filter @migaia/serialize build`：passed，2026-08-18。
- Emitted declaration inspection (`dist/index.d.ts`, `dist/core.d.ts`, `dist/registry.d.ts`)：passed；required named types re-exported, `createSerializeRegistry` names `ISerializeRegistryOptions`, and no `IParserSnapshot`/`IRegistryOptionsSnapshot` leaked，2026-08-18。
- `git diff --check -- packages/serialize docs/serialize`：passed，2026-08-18。

Round20 evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true pnpm --filter @migaia/serialize fmt`：passed，oxfmt 20 files，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize lint`：passed，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize typecheck:test`：passed；root and intended subpath AF-152 compile-use imports included，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize test`：passed，8 files / 125 tests，dirty worktree。
- `CI=true pnpm --filter @migaia/serialize build`：passed，dirty worktree。
- Emitted declaration inspection (`dist/index.d.ts`, `dist/core.d.ts`, `dist/registry.d.ts`)：passed；required named types re-exported, `createSerializeRegistry` names `ISerializeRegistryOptions`，and no `IParserSnapshot`/`IRegistryOptionsSnapshot` leaked，dirty worktree。
- `CI=true pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations，dirty worktree。
- `git diff --check -- packages/serialize docs/serialize`：passed，dirty worktree。

Round21 evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 20 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors。
- `CI=true rtk pnpm --filter @migaia/serialize typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize test`：passed，8 files / 127 tests；SER-T21-01/SER-T21-02 included。
- `CI=true rtk pnpm --filter @migaia/serialize build`：passed。
- `CI=true rtk pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations；SER-T21-03 package subpath compile-use remains covered by `package-exports.test.ts`。
- Emitted core inspection：passed；`dist/core.js`/`dist/stream.js` contain no runtime lifecycle import, and core stream diagnostics use serialize-owned text/code.
- `git diff --check -- packages/serialize docs/serialize`：passed。

Round22 evidence, same dirty-worktree baseline (2026-08-18):

- Focused `CI=true rtk pnpm --filter @migaia/serialize test -- stream.test.ts`：passed，8 files / 131 tests；four Round22 cases included。
- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 20 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk proxy pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors。
- `CI=true rtk proxy pnpm --filter @migaia/serialize typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize test`：passed，8 files / 131 tests。
- `CI=true rtk pnpm --filter @migaia/serialize build`：passed。
- `CI=true rtk pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations。
- `rtk git diff --check -- packages/serialize docs/serialize`：passed。

- SDD re-read and trailing-whitespace scan：passed；`docs/serialize/serialize-registry.sdd.md` is currently ignored by repository `.gitignore`, so it does not appear in tracked `git diff` output despite the working-tree edit。

Round23 evidence, same dirty-worktree baseline (2026-08-18):

- Focused `CI=true rtk pnpm --filter @migaia/serialize test -- stream.test.ts`：passed，8 files / 137 tests；stored-then-abort、abort-then-store、stored-then-throw、callback-then-return/throw、listener removal failure 与 no-unhandled assertions included。
- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 20 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run typecheck`：passed，TypeScript no errors。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize run test`：passed，8 files / 137 tests。
- `CI=true rtk pnpm --filter @migaia/serialize run build`：passed。
- `CI=true rtk pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations。
- `rtk git diff --check -- packages/serialize docs/serialize`：passed。

Round24 evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 21 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk proxy pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors。
- `CI=true rtk proxy pnpm --filter @migaia/serialize typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize test`：passed，9 files / 142 tests；`SER-T24-01` queue/no-unhandled、`SER-T24-02` Proxy length/index、`SER-T24-03` async/sync protocol matrix、`SER-T24-04` SDD requirement-resolution check included。
- `CI=true rtk pnpm --filter @migaia/serialize build`：passed。
- `CI=true rtk pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations。
- `rtk git diff --check -- packages/serialize docs/serialize`：passed。
- SDD re-read and static ID check：passed；`docs/serialize/serialize-registry.sdd.md` remains ignored by repository `.gitignore`, so its working-tree update is not shown in tracked `git diff`。

Round25 evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 22 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run typecheck`：passed，TypeScript no errors。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize test`：passed，10 files / 148 tests；`SER-T25-01` exact malformed chunk matrix、`SER-T25-02` value index、`SER-T25-03` encode getter snapshot、`SER-T25-04` source iterator admission、`SER-T25-05` encode no-side-effect boundary、`SER-T25-06` valid decode snapshot included。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run build`：passed。
- `CI=true rtk proxy pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations：node、bun、deno、browser、worker、electron-main、electron-renderer、mini-program。
- `rtk git diff --check -- packages/serialize docs/serialize`：passed。
- SDD stable-ID check (`serialize-sdd.test.ts`)：passed；Round25 requirement/decision/case canonical IDs are unique and all mapped Round25 requirements resolve exactly once；SDD remains ignored by repository `.gitignore`，so its working-tree update is not shown in tracked `git diff`。

Round26 evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 23 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize typecheck`：passed，TypeScript no errors。
- `CI=true rtk pnpm --filter @migaia/serialize typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize test`：passed，11 files / 152 tests；`SER-T26-01` immutable/stateful tuple snapshot and bytes identity、`SER-T26-02` tuple length/getter cause/no-coercion、`SER-T26-03` indexed sync throw with pending rejection/no unhandled、`SER-T26-04` thenable assimilation included。
- `CI=true rtk pnpm --filter @migaia/serialize build`：passed。
- `CI=true rtk pnpm typecheck:consumers`：passed，8 consumer TypeScript configurations：node、bun、deno、browser、worker、electron-main、electron-renderer、mini-program。
- `rtk git diff --check -- packages/serialize docs/serialize`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize exec vitest run test/serialize-sdd.test.ts`：passed；canonical requirement/decision/case IDs remain unique and Round26 mapped requirements resolve exactly once；SDD remains ignored by repository `.gitignore`。

Round27 evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true rtk proxy node_modules/.bin/oxfmt packages/serialize/src packages/serialize/test`：passed。
- `CI=true rtk proxy node_modules/.bin/oxlint packages/serialize/src packages/serialize/test`：passed。
- `CI=true rtk proxy node_modules/.bin/tsc -p packages/serialize/tsconfig.json --noEmit`：passed，TypeScript no errors。
- `CI=true rtk proxy node_modules/.bin/tsc -p packages/serialize/tsconfig.test.json`：passed。
- `CI=true rtk proxy node_modules/.bin/vitest run packages/serialize/test`：passed，12 files / 154 tests；T26-03 proves queued sync-throw FIFO semantics, T27-01 proves source graph + Vite bundle exclusion, T27-02 proves abort reason identity, and `serialize-sdd.test.ts` proves ID closure。
- Bundle path in `SER-T27-01`: passed; core bundle contains no declared package dependency or `@migaia/lifecycle`.
- `CI=true rtk proxy node_modules/.bin/tsc -p packages/serialize/tsconfig.build.json`: passed.
- Eight consumer configurations (`node`, `bun`, `deno`, `browser`, `worker`, `electron-main`, `electron-renderer`, `mini-program`): passed.
- `rtk git diff --check -- packages/serialize docs/serialize docs/contracts/runtime-neutrality.sdd.md`: passed.

Round29 historical/superseded evidence, same dirty-worktree baseline (2026-08-18):

- `CI=true rtk pnpm --filter @migaia/serialize fmt`：passed，oxfmt 25 files。
- `CI=true rtk pnpm --filter @migaia/serialize lint`：passed。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run typecheck`：passed，TypeScript no errors。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run typecheck:test`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize test`：passed，13 files / 161 tests；SER-T29-01～SER-T29-07 与 SDD closure check included。
- `CI=true rtk proxy pnpm --filter @migaia/serialize run build`：passed。
- `CI=true rtk pnpm --filter @migaia/serialize exec vitest run test/round27.test.ts`：passed，2 tests；core import graph/bundle neutrality and first-observed reason identity remain green。
- `CI=true rtk proxy pnpm typecheck:consumers`：passed，8 consumer configurations。
- Built `dist/core.js`/`dist/stream.js` scan：passed；no `@migaia/lifecycle` or workspace runtime import。
- `rtk git diff --check -- packages/serialize docs/serialize`：passed after final source/test/SDD edit。

## 9. 风险、deferred 与交付门禁

Round26 hostile review：validator returns a frozen tuple snapshot after one length/kind/data read, retains `Uint8Array` identity, prevents later tag/payload rereads, and avoids hostile tag coercion; getter failure keeps exact index/progress/cause. `encodeStream` wraps synchronous registry throws at the admitted slice index, observes pending earlier rejection during `finally`, retains FIFO/maxInFlight and thenable assimilation, and leaves no unhandled rejection. No Store/foundation/lifecycle, consumer fixture, or error-registry file changed。

Round27 hostile review：sync throws are queued as rejected Promises before the common observer, so a pending index-0 success cannot be bypassed by index 1; the next drain owns `chunkIndex=1` and preserves the original throw as `cause`. Core source closure and Vite bundle checks reject all package imports, including lifecycle; the local controller owns only one-shot signal notification, while lifecycle scope/scheduler/deadline state remains outside core. Existing signal race tests plus T27-02 preserve first-observed reason identity. No Store/other package files changed。

风险审查：

- 边界/重入：registration depth 与 attempted/removed guard 覆盖 stored-then-throw、abort-during-add、重复 dispose。
- 失败/一致性：每项 removal 失败后继续；primary/cause/errors 路径由 `SER-T17-02`～`SER-T17-07` 覆盖。
- 架构：未新增 lifecycle/foundation/Store 依赖或重复 owner。
- Round18 hostile review：now getter/call、schedule throw、invalid task、sync callback、cancel getter/call、parser cleanup throw、throw/report combinations、Promise identity、terminal rejection 与 detached rejection observation 均有覆盖；foundation §35 将 AF-136 保留为 `implemented-unverified`，因此本文件不宣称 no-finding 或最终 verified。
- Round19 hostile review：root 与所有 declared subpaths 使用 package-boundary imports；required public types resolve from emitted declarations；implementation-only registry snapshots remain unexported；未新增 Store/foundation/lifecycle dependency。
- Round20 hostile review：root AF-152 type re-exports are compile-used alongside `/core` and `/registry` types; test imports contain no source-relative specifiers; production exports and Store/foundation remain untouched。
- Round21 hostile review：boundary inputs cover scheduler getter/call throws, NaN, both Infinity signs, schedule throw, invalid task admission, and cancel accessor throw; exact serialize source/code/cause and native error classes are asserted. Core runtime contains no lifecycle import; registry lifecycle ownership remains unchanged. No Store/foundation files touched by this round.
- Round22 hostile review：default-yield handle retention covers asynchronous callback and callback-before-return; cancel throw is translated with original cause; abort primary survives cleanup failure; signal listener/task cleanup is idempotent and contained. Remaining verification is the final ordered gate run and consumer evidence.
- Round23 hostile review：stored-then-abort、abort-then-store、stored-then-throw、callback-then-return/throw、remove failure、cancel failure、exact source/code/cause/errors、no-schedule、settlement and no-unhandled paths are covered. `stream.ts` reuses the existing attempted-registration/cleanup ownership pattern; no Store/foundation/lifecycle files changed. Round23 is verified; prior AF-136/final cross-package closure remains outside this scoped fix.
- Round24 hostile review：queued rejection is observed before ordered drain; FIFO and original `cause` are asserted. Proxy `length`/index getters are inside registry encode boundary. Protocol matrix covers async/sync factory, `next`, `done`, `value`, and async thenable failures; native `for await` cleanup differences are asserted. No new error code, Store/foundation dependency, or error-registry change was required. Existing `Reflect.apply` occurrences in shared dirty serialize signal/registry code predate this round and were preserved rather than broad-rewritten.
- Round25 hostile review：malformed tuple/tag/payload/value inputs are validated before merge reads and retain `INVALID_CHUNK` index/progress. Encode/decode stream options are captured once before input iterator, scheduler, registry, or parser work; throwing getters remain `INVALID_OPTION` with original `cause`. No consumer fixture, Store/foundation/lifecycle, or error-registry file changed.

Round29 hostile review：pre-aborted snapshots cache raw `aborted`/`reason` once, so a getter that succeeds then throws cannot replace `ABORTED` or reason identity; dynamic registration recheck still observes abort-during-add and preserves captured listener receiver/identity. Shared text conversion validates thrown calls and non-byte returns before merge allocation, preserving `ENCODE_FAILED`/`INVALID_CHUNK`, chunk index, prior byte progress, cause, and no partial output. Registry method getter admission remains `INVALID_OPTION`; valid injected receiver/output and core neutrality remain green. No Store/other package files changed。

Round30 current evidence（2026-08-18，dirty worktree）：result status: `verified`; blocker: none; dependency: `serialize/registry -> lifecycle` for scope/abort primitives and `serialize/registry -> serialize/signal`, while `serialize/signal` remains runtime-neutral; serialize 169 tests passed and eight consumer configurations passed. This is the sole current Serialize evidence set; Round29 is historical/superseded.

无 deferred、无 blocked。Round29 implementation evidence alone did not upgrade this SDD；Round30 final package、八环境 consumer、core-neutrality 与 repository chronology gates 已完成升级到 `verified`。Package/local evidence 记录如上。
