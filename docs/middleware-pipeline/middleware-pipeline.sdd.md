# `@migaia/middleware-pipeline` SDD

- 状态：**verified**（2026-08-18；dirty worktree；Round30 exact-same control collapse 契约与最终 package/plugin-host consumer gates 已闭合）
- Owner：`@migaia/middleware-pipeline`
- 影响包：`@migaia/plugin-host`；后续可评估 `@migaia/store-middleware`
- 前置：[`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md)、[`lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)
- 正交契约：[`event-subscriber.sdd.md`](../event-subscriber/event-subscriber.sdd.md)；两包互不依赖
- 性质：runtime-neutral 算法包；不拥有插件、资源或 scope，仅拥有通用双失败 `EXECUTION_FAILED`

## 0. 状态与闭合规则

状态按 `pending → red → implemented → verified` 流转；`blocked` 仅表示外部阻塞，`deferred` 必须指定 owner、落点和启动条件。每个条款与 case 使用稳定 ID，双向映射闭合后才能交付。

## 1. 目标与范围

抽取 plugin-host 的 middleware chain 执行算法，保留三种已有代数：

- sync：stage 必须在返回前调用一次 `next`，扁平向前传递；不调用即短路。
- async：支持 `await next()` 的递归 middleware；stage 与 downstream 同时失败时可由 host 注入领域组合策略，否则使用包拥有的通用聚合错误。
- generator：支持多次 yield 和 `HALT`、`CONTINUE`、`UNDEFINED` sentinel。

不提供 event fan-out、waterfall API、plugin registration、resource ownership、lifecycle scope 或宿主错误码。

| ID | Requirement | 状态 |
| --- | --- | --- |
| MP-R01 | 三种执行器保持原 plugin-host 的调用顺序、短路、重入和 sentinel 语义。 | verified |
| MP-R02 | late/duplicate `next` 只通过注入的 violation handler 反馈，不依赖 plugin-host。 | verified |
| MP-R03 | async 的 active 检查与 stage+downstream 错误组合由调用方注入。 | verified |
| MP-R04 | 包无 workspace runtime 依赖、无 timer、无 global singleton、无宿主 API。 | verified |
| MP-R05 | plugin-host 继续拥有 stage registration、mode mismatch、diagnostic、生命周期和错误码。 | verified |
| MP-R06 | generator sentinel、stage type 和 runner 可被独立 import；未使用模式可被 tree-shake。 | verified |
| MP-R07 | package 提供 `release:patch`、`release:pack`、`release:publish`，Makefile 发布目标必须可展开到这些脚本。 | implemented |
| MP-R08 | 默认双失败 `AggregateError` 归 middleware-pipeline，携带 source `@migaia/middleware-pipeline` 与 `EXECUTION_FAILED`；stage 在 next 后抛错时仍等待 downstream；host 注入组合器时由 host 拥有领域错误。 | implemented-unverified |
| MP-R09 | pipeline 协议值只从 `MiddlewarePipelineViolation` 读取；plugin-host 兼容层的稳定错误文本只由 `error-text.ts` 维护，调用点不得内联。 | verified |
| MP-R10 | generator runner 默认使用本包 sentinel，但允许兼容 wrapper 注入既有 Symbol identity；plugin-host 不得因抽取改变公开 sentinel。 | verified |
| MP-R11 | sync→async adapter 只负责观察 downstream 并保留 standalone stage 错误；嵌入 runner 时双失败只能由 runner 组合，host combiner 必须收到原始 stage/downstream 各一次。 | implemented-unverified |
| MP-R12 | sync/async/generator runner 在入口只快照一次 caller stage list；执行期间 replacement/insertion/deletion（含 async downstream await 期间 mutation）均不得改变 active dispatch，并保持既有直接调用 receiver 与 stage call count；既有 violation/error/signal contract 继续由回归 cases 钉住。 | implemented-unverified |
| MP-R13 | package-boundary evidence 必须通过 `@migaia/middleware-pipeline` exports 验证 runtime/type exports，并以 production bundle 证明未使用 mode 可 tree-shake；不得只 import repository source。 | implemented-unverified |
| MP-R14 | 历史条款：用 next-result consumption provenance 做 propagation/dedupe。该语义已被 MP-R16 明确 supersede，不再是当前契约。 | superseded by MP-R16 |
| MP-R15 | 历史条款：以 Promise wrapper、SpeciesConstructor 和 borrowed-method tracking 观察消费。该语义已被 MP-R16 明确 supersede，不再是当前契约。 | superseded by MP-R16 |
| MP-R16 | async runner 只观察两个 deterministic channels：当前 stage execution result 与 `next()` 已启动的 pending downstream。独立且可区分的 stage/downstream errors 按固定 `[stageError, downstreamError]` 顺序组合；exact-same runner control instance 是一个 semantic failure，必须 collapse；只 reject 一个时抛出 exact value；不使用 wrapper、consumption/provenance、constructor、species 或 Promise lineage tracking；combiner 返回 `undefined`/`null` 必须原样抛出。 | implemented-unverified |
| MP-R17 | async runner 在 stage 与 downstream channels settle 后，必须先按 MP-R16 resolve/throw/combine 已捕获错误，再执行 post-stage `assertActive`；`assertActive` 只能在无 channel failure 且当前 dispatch 尚未 completed 时运行。 | implemented-unverified（AF-181 pending review） |
| MP-R18 | async runner 在 `next()` 启动 downstream 的同一同步路径立即安装 rejection observer，即使当前 stage 仍 pending 也必须认领 downstream rejection；observer 只记录 deterministic downstream channel，不改变返回 Promise identity、stage/downstream slot order、exact error、duplicate/late semantics、successful path，且不使用 Promise provenance/lineage heuristics。 | implemented-unverified |
| MP-R19 | runner-generated post-stage `assertActive` failure 归显式 control path；`await`/`return next()` 传播该 exact active error 时不得把同一 control failure 当作第二个 stage/downstream channel；独立 stage failure 仍保持 exact，普通同一 identity 双失败仍按 MP-R16 组合。 | implemented-unverified |
| MP-R20 | downstream frame entry 的 `assertActive` failure 与 post-stage failure 共用显式 frame-local control ownership；`await`/`return next()` 传播同一 exact active error 一次，不调用 host combiner、不生成 `PIPELINE_FAILED`；nested next 链仍向上传播该 control path，普通同一 identity 双失败、thenable/native-Promise、undefined/nullish 与 post-stage 语义不变。 | implemented-unverified |
| MP-R21 | frame 只有在最终 resolved/throw value 是其直接 downstream 的 exact control error 时，才向 parent 传播 control metadata；若 frame 最终选择独立 `stageError`，不得把 stale nested control metadata 传播给 parent；outer `void` 保持 exact stage error，outer `await`/`return` 的普通同一 identity dual failure 仍按 MP-R16 组合。 | implemented-unverified |
| MP-R22 | Round30 contract correction：runtime cannot distinguish direct `await next()` propagation from catch-and-rethrow of the exact same control `Error` without breaking exact identity visible to middleware. Therefore exact-same control instance is one semantic failure and collapses; independent distinguishable stage/downstream errors still combine in stage-first order. This round changes the contract/evidence mapping only and claims no code-level combine fix. | implemented-unverified |

## 2. 现状与问题

原实现位于 `packages/plugin-host/src/pipeline.ts`，同时混合算法、plugin-host 错误码和 mode 常量，导致算法无法被其他 middleware consumer 复用。`plugin-host` 的 `host-runtime.ts` 仍必须负责 `_pipelineDepth`、active guard、stage registration 和 error tagging，这些不随算法下沉。

第二/三轮 Luna 复核（AF-73～AF-87）未确认 middleware-pipeline 新 finding；Sol 复核新增 MP-R12 的 mutable-stage snapshot 与 MP-R13 的 package-boundary evidence，原有 source-import tree-shaking fixture 不再作为 MP-T07 的充分证据。该结论不扩展 Store 范围，也不改变既有 MP ID。

Round26 HIGH finding：downstream stage 成功但未调用 `next()` 后进入 closing，runner 的 post-stage `assertActive` 抛出 host active error；upstream `await`/`return next()` 同时把该 rejection 作为 stage result 观察，父 frame 又把同一值记录为 downstream failure，导致 MP-R16 错误组合器产生重复 active-error slots。Round27 HIGH finding：upstream `next()` 已排队但 downstream frame 尚未开始时进入 closing，downstream entry `assertActive` 在 frame metadata 写入前抛出同一问题，plugin-host combiner 将 exact active error 错误包装为重复 `PIPELINE_FAILED` slots。两条路径均属 runner control-path ownership 问题，不是 Promise provenance 问题。

Round29 HIGH finding：三层 nested `next()` 中，inner entry/post-stage active control 被 middle 捕获后，middle 最终抛出独立 `stageError`；middle frame 在选择该最终 stage error 前仍把 stale control metadata 写入 outer slot，使 outer `void next()` 错抛 active error。修复只改变 parent-slot commit 条件：control metadata 仅随最终 exact control error 向上传播；独立 stage error 不被吞掉，outer `await`/`return` 仍保留普通 dual-channel 组合。

## 3. 架构裁定与依赖方向

```text
middleware-pipeline  ←  plugin-host
                         store-middleware（未来仅在有直接需求时）
```

`middleware-pipeline` 不依赖 `event-subscriber`；event fan-out 与 middleware chain 是不同代数。若未来需要持久 queue、drain、close 或 in-flight ownership，应由另一个依赖 lifecycle 的 dispatcher 包拥有，不能塞回本包。

| ID | Decision | 状态 |
| --- | --- | --- |
| MP-D01 | 包名使用 `middleware-pipeline`，不使用泛化的 `pipeline`，明确其 `next`/stage 语义。 | implemented |
| MP-D02 | host-specific `PluginHostError` 不下沉；调用方可通过 callback 接管 async 聚合错误，否则使用包拥有的通用 `EXECUTION_FAILED`。 | implemented |
| MP-D03 | 不把 waterfall/event bus/queue 作为兼容扩展；任何新增代数必须新条款和新 case。 | implemented |
| MP-D04 | root entry 导出算法和类型；不建立 mode runtime singleton。 | implemented |
| MP-D05 | plugin-host wrapper 保留原 `createPluginHostTypeError`、error source/code 和消息行为；抽取只替换算法 owner。 | verified |
| MP-D06 | 历史决策：通过每个 next result 的 constructor/species 路径追踪 consumption。该决策已被 MP-D07 supersede。 | superseded by MP-D07 |
| MP-D07 | `next()` 直接返回 native `Promise`；runner 独立等待 stage execution result 与 pending downstream，不推断消费或 Promise lineage。独立可区分双失败按 `[stageError, downstreamError]` 组合；exact-same control instance 按单一 semantic failure collapse，单失败保持 exact value。 | implemented-unverified |
| MP-D08 | post-stage active guard 是成功路径检查，不是错误通道优先级。stage/downstream failure 一旦被捕获即先按 exact/combined 语义离开当前 step；只有无失败且 `completed === false` 才允许调用 `assertActive`。 | implemented-unverified |
| MP-D09 | 每个 async frame 为其直接 downstream 持有显式 control metadata；post-stage active guard 写入该 metadata 并向上传播，不能通过 Promise lineage、消费方式或任意 equal-error dedupe 判断。普通 stage/downstream rejection 不带该 metadata，继续按 MP-R16 组合。 | implemented-unverified |
| MP-D10 | `IAsyncControlPath` 是 entry 与 post-stage active guard 的共同 frame-local ownership slot；entry guard 在 downstream frame 开始前也必须写入 parent slot。control slot 优先于普通 downstream channel，但不吞掉当前 frame 独立 stage error；host combiner 只接收真正独立的 stage/downstream failures。 | implemented-unverified |
| MP-D11 | control slot 是 frame terminal-outcome metadata，不是 downstream rejection 的永久标记；仅当当前 frame 最终抛出/传播 slot 中 exact active error 时才 commit 到 parent。独立 `stageError` 选中时清除该 frame 对 parent 的 control propagation，普通无 control-slot dual failure 不变。 | implemented-unverified |
| MP-D12 | Exact-same control collapse is an explicit contract correction, not Promise provenance inference: the runtime must preserve the exact control error identity visible to middleware, and no direct-await-versus-catch-rethrow distinction is required or claimed. | implemented-unverified |

## 4. 公开契约/核心设计

公开入口 `packages/middleware-pipeline/src/index.ts` 提供：

- `runSyncMiddleware`
- `runAsyncMiddleware`
- `runGeneratorMiddleware`
- `adaptSyncStageToAsync`
- `adaptSyncStageToGenerator`
- `MiddlewarePipelineMode`、`MiddlewarePipelineViolation`
- 三种 stage type 与三个 generator sentinel

`IMiddlewarePipelineOptions` 接受 `onViolation`、可选 `assertActive` 和可选 `combineStageAndDownstreamError`。它不接受 lifecycle、scheduler 或 plugin host 实例。

三个 runner 在入口对 caller stage list 做一次 identity snapshot；后续 dispatch 只读 snapshot，不改变 stage 的直接调用形式，因此不引入 array receiver 或额外 stage call。package-boundary fixture 从 `@migaia/middleware-pipeline` 自身 exports 解析 runtime 与 declaration surface；sync-only production bundle 只从该公共边界消费 sync runner。

async runner 的每个 frame 只向直接 parent 传递一个内部 control slot。下游 entry 或 post-stage `assertActive` 抛错时，slot 记录 exact value；父 frame 若仅观察到该 control path，则原样传播 active error，不调用双失败 combiner。父 frame 若同时持有不同的独立 stage error，则保留 stage exact error；没有 control slot 的普通 equal identity/primitive failures 仍进入 MP-R16 固定双槽位组合。

## 5. 生命周期与错误语义

执行器本身不持有跨调用资源；async runner 返回的 Promise 由调用方持有。plugin-host 负责 `_pipelineDepth`、closing/active 检查和 Promise finally 清理。

错误规则：

- listener/stage 的原始 throw/reject 保持可达；
- stage 与 downstream 同时失败时优先调用 `combineStageAndDownstreamError`，未提供时抛带 `EXECUTION_FAILED` 的默认 `AggregateError`；
- `next()` 返回原生 `Promise`。runner 分别观察当前 stage execution result 与 pending downstream：独立可区分的双 reject 调用组合器或默认 `AggregateError`，参数严格为 `[stageError, downstreamError]`；exact-same runner control instance 是一个 semantic failure 并 collapse。runtime 不区分 direct `await next()` 与 catch-and-rethrow 的 control provenance，不改变 middleware 可见的 exact Error identity；单 reject 抛 exact value。组合器返回 `undefined`/`null` 不走 fallback。
- downstream Promise 在 `next()` 启动时立即安装 rejection observer；当前 stage 可继续 pending，而 rejection 已归入 downstream channel，不等待 stage settle 才首次观察。该 observer 不包装或推断 Promise provenance/lineage；最终 dispatch 仍 await 原 native Promise 并按 MP-R16 保持 exact value、identity 和固定 slot 顺序。
- channel settlement precedence：stage/downstream failure 捕获后，必须先完成 MP-R16 的 exact throw 或组合；失败不能被 post-stage `assertActive` 替换。无 channel failure 时，只有当前 dispatch 尚未完成才执行 post-stage `assertActive`；`done` 已完成的 dispatch 不再被 closing 状态追溯性否决。
- entry 与 post-stage active guard 都是显式 runner control path，不是可任意 dedupe 的 error value：直接 downstream frame 的 control slot 认领该 guard；`await`/`return next()` 的上游观察只传播 exact active error。独立 stage error 不被吞掉；普通同一 identity 双失败没有 control slot，仍必须组合。plugin-host 的 `PIPELINE_FAILED` combiner 只处理后者。
- violation 由 handler 决定是诊断、抛错或其他策略；
- 本包不静默吞错误；仅注册通用 `EXECUTION_FAILED`，不声明任何 host error code。

## 6. 迁移与实施批次

| ID | Mission | 状态 |
| --- | --- | --- |
| MP-M01 | 新包骨架、exports、类型和 runner | implemented |
| MP-M02 | plugin-host 改为 wrapper，保持旧的内部导入路径和公开 API | implemented |
| MP-M03 | 原 plugin-host pipeline tests 继续作为 direct-consumer baseline，并补新包 unit tests | verified |
| MP-M04 | 删除 plugin-host 中重复算法，仅保留兼容 wrapper | implemented |
| MP-M05 | package、plugin-host、repository gates 与证据回填 | implemented-unverified |
| MP-M06 | 发布脚本、默认双失败 error-code、wrapper 错误构造器和 direct tests 补齐 | implemented |
| MP-M07 | Round23：固定 channel failure 与 post-stage active guard 的先后顺序，补 middleware unit 与 plugin-host direct-consumer cases，并回填跨包证据。 | verified |
| MP-M08 | Round26：为 post-stage active guard 建立显式 frame-local control ownership，补 `await`/`return` duplicate-slot 与 independent-stage regressions；保留普通 equal-error、nullish、thenable/native-Promise semantics。 | implemented-unverified |
| MP-M09 | Round27：将 frame-local active control ownership 扩展到 downstream entry guard，补 `await`/`return` entry regressions 与 host-shaped `PIPELINE_FAILED` non-wrapping assertion；保留 nested next、thenable/native-Promise、undefined/nullish、普通同一 identity 双失败及 post-stage 行为。 | implemented-unverified |
| MP-M10 | Round29：修复 nested entry/post-stage active metadata 在 middle 选择独立 `stageError` 后 stale 向 parent 传播；补 outer `void` exact stage error 与 outer `await`/`return` true dual-failure compositional regressions。 | implemented-unverified |

## 7. 测试与验收矩阵

| ID | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- |
| MP-T01 | unit | sync 顺序、值传递和未调用 next 的短路与旧行为一致 | MP-R01、MP-D01 |
| MP-T02 | unit | async `await next` 的 downstream 顺序和 stage/downstream 双错误组合保持 | MP-R01、MP-R03 |
| MP-T03 | unit | generator 多 yield、HALT、CONTINUE 和 undefined sentinel 保持 | MP-R01 |
| MP-T04 | unit | late/duplicate violation 只进入注入 handler | MP-R02 |
| MP-T05 | unit | 无 plugin-host import、timer、DOM/Node runtime API 或 global singleton | MP-R04、MP-D04 |
| MP-T06 | integration | plugin-host 旧 pipeline tests 全部通过，错误码、diagnostic、active guard 和 registration 行为不变 | MP-R03、MP-R05、MP-M02 |
| MP-T07 | type/package | isolated sync-only fixture 通过 `@migaia/middleware-pipeline` exports 消费 sync runner/type；同一公共边界的 production bundle 不含未引用 async/generator implementation | MP-R06、MP-R13、MP-D04 |
| MP-T08 | repository | store-middleware 仍通过 plugin-host，未产生反向依赖或第二套 runner | MP-R05、MP-M04 |
| MP-T09 | unit | sync runner duplicate/late、空 async stage、combine callback、generator adapter duplicate/late 均有明确断言 | MP-R01、MP-R02、MP-R03 |
| MP-T10 | package | `release:patch`、`release:pack`、`release:publish` 存在；Makefile check/publish dry-run 指向正确 package scripts | MP-R07 |
| MP-T11 | architecture | 默认双失败保持 `AggregateError`、两个原错误 identity、稳定 message 与 `(source, EXECUTION_FAILED)`；注入组合器后不创建 pipeline 错误 | MP-R08、MP-D02 |
| MP-T12 | integration | plugin-host wrapper 的非法 stage 输入仍使用原 `createPluginHostTypeError`，source/code/message 与基线一致 | MP-D05、MP-M02 |
| MP-T13 | architecture | runner 不重复书写 `late`/`duplicate`；plugin-host pipeline 不存在内联错误消息，集中化前后消息逐字保持 | MP-R09、MP-D05 |
| MP-T14 | integration | 注入 host-owned sentinel 后 CONTINUE/UNDEFINED/HALT 仍按控制信号处理；plugin-host generator 既有 tests 原样通过 | MP-R10、MP-R01、MP-D05 |
| MP-T15 | unit | standalone sync→async adapter 在 stage 与 downstream 同时失败时等待 downstream 后抛原始 stage；downstream rejection 已被观察 | MP-R11 |
| MP-T16 | integration | adapter 经 async runner 双失败时，combiner 参数严格为原始 `[stageError, downstreamError]`，两个 identity 各出现一次，不嵌套 Aggregate | MP-R11、MP-R03、MP-R08 |
| MP-T17 | unit | 对可变 caller stage array 分别验证 sync/async/generator：entry 后 replacement、insertion、deletion（async 在 downstream await 期间）均不改变原 stage 顺序；原 stage receiver 与 call count 保持，未执行 mutated stages | MP-R01、MP-R12 |
| MP-T18 | package-boundary | isolated fixture 通过 `@migaia/middleware-pipeline` exports 编译三种 stage type，并运行 sync/async/generator runners、adapters、sentinels 和 error exports | MP-R06、MP-R13、MP-D04 |
| MP-T19 | unit | 历史 consumption/dedupe cases：`await`/`return`/`catch`/`finally` 只交付 downstream 一次。保留 ID 作为历史证据，行为已被 MP-T23 supersede。 | superseded by MP-T23 |
| MP-T20 | unit | 历史 shared object/primitive consumption cases。保留 ID 作为历史证据，行为已被 MP-T23 supersede。 | superseded by MP-T23 |
| MP-T21 | unit | 历史 Promise-compatible lineage/species cases。保留 ID 作为历史证据，行为已被 MP-T24 supersede。 | superseded by MP-T24 |
| MP-T22 | unit | 历史 borrowed-method 与 constructor/species false-positive cases。保留 ID 作为历史证据，行为已被 MP-T24 supersede。 | superseded by MP-T24 |
| MP-T23 | unit | `await`/`return` next 后 stage 与 downstream 使用同一 Error 仍得到两个槽位；downstream 被处理后独立 stage error 仍组合；shared identity 与 equal primitive rejection 仍按固定 `[stage, downstream]` 传递。 | MP-R03、MP-R08、MP-R16 |
| MP-T24 | unit | `next()` 返回 native Promise；borrowed `then`/`catch`/`finally` 与 mutated `constructor` 不影响双失败组合，也不依赖 wrapper/species/consumption tracking。 | MP-R16、MP-D07 |
| MP-T25 | unit | 仅一个 channel reject 时抛 exact value；combiner 返回 `undefined`/`null` 时原样抛出；duplicate/late next、downstream 单次执行与 stage snapshot 继续成立。 | MP-R02、MP-R08、MP-R12、MP-R16 |
| MP-T26 | unit | stage failure、downstream failure、dual failure 在 active guard 进入 closing 状态后，分别保持 stage/downstream exact identity 或以固定 `[stageError, downstreamError]` 顺序组合；`assertActive` 不得替换已捕获 channel error。 | MP-R16、MP-R17、MP-D08 |
| MP-T27 | unit | 无 channel failure 时，未完成 dispatch 仍抛出 exact active error；`done` 已标记 dispatch completed 后即使 active 变为 closing 也保持成功。 | MP-R17、MP-D08 |
| MP-T28 | integration | plugin-host direct consumer 保持 stage/downstream exact identity；closing active error 不覆盖任一单失败。 | MP-R03、MP-R05、MP-R17 |
| MP-T29 | integration | plugin-host dual failure 保持 source `@migaia/plugin-host`、code `PIPELINE_FAILED`、`AggregateError.errors === [stageError, downstreamError]`，且不替换为 `HOST_DISPOSING`。 | MP-R08、MP-R17、MP-D02、MP-D08 |
| MP-T30 | integration | plugin-host 成功但未完成 dispatch 时抛 exact `HOST_DISPOSING`；`done` 完成 dispatch 后 closing 不再触发 active assert。 | MP-R03、MP-R05、MP-R17 |
| MP-T31 | unit | stage 调用 `next()` 后停在 upstream gate 时，downstream rejection 先被观察且 gate 窗口内 `unhandledRejection` 数为零；释放 gate 后最终仍抛 downstream exact error，且不改变 MP-R16 channel 语义。 | MP-R16、MP-R18 |
| MP-T32 | unit | downstream stage 不调用 `next()` 且使 host 进入 closing 时，`await next()` 与 `return next()` 均只抛 exact runner-generated active error；combiner 不收到重复 active-error slots。 | MP-R17、MP-R19、MP-D08、MP-D09 |
| MP-T33 | unit | downstream post-stage active control 与独立 upstream stage error 同时出现时，独立 stage error 保持 exact 且不被 control path 组合或吞掉；普通同一 identity 双失败、undefined/nullish combiner result、borrowed thenable/native-Promise cases 仍保持既有 MP-T23～MP-T25 语义。 | MP-R16、MP-R19、MP-D07、MP-D09 |
| MP-T34 | unit/consumer-shaped | downstream `next()` 已排队、host 在 downstream frame entry 前 closing 时，`await next()` 与 `return next()` 均只抛 exact active error；注入返回 `source: '@migaia/plugin-host', code: 'PIPELINE_FAILED'` 的 host-shaped combiner 不被调用，active error 不被包装。 | MP-R20、MP-D10、MP-M09 |
| MP-T35 | unit | 两层 nested `next()` 在最内层 entry guard 失败时，active error 沿每个 frame-local control slot exact 传播且 combiner 调用次数为零；现有 MP-T23～MP-T25 与 MP-T32 继续钉住普通同一 identity、thenable/native-Promise、undefined/nullish 和 post-stage 语义。 | MP-R20、MP-D09、MP-D10、MP-M09 |
| MP-T36 | unit | 三层 nested entry active control 中，middle 捕获 exact active error 后抛独立 `stageError`：outer `void next()` 最终抛 exact `stageError` 且不调用 combiner；outer `await`/`return next()` 将 `[stageError, stageError]` 作为普通 dual failure 交给 combiner，不被 stale active metadata 替换。 | MP-R21、MP-D11、MP-M10 |
| MP-T37 | unit | 三层 nested post-stage active control 中，middle 捕获 exact active error 后抛独立 `stageError`；outer `void` 保持 exact stage error，outer `await`/`return` 保持 true dual-channel combination，且 control metadata 不被错误向上传播。 | MP-R21、MP-D11、MP-M10 |
| MP-T38 | unit/regression | New Round30 regression in `packages/middleware-pipeline/test/pipeline.test.ts`: exact-same runner control instance observed through direct `await next()` or catch-and-rethrow collapses as one semantic failure without changing the exact Error identity visible to middleware; independent distinguishable stage/downstream errors still invoke combiner once with `[stageError, downstreamError]`. No code-level combine fix is claimed by this documentation correction. | MP-R22、MP-D12 |

## 8. 证据与闭合映射

| 条款 | Cases |
| --- | --- |
| MP-R01 | MP-T01、MP-T02、MP-T03 |
| MP-R02 | MP-T04 |
| MP-R03 | MP-T02、MP-T06 |
| MP-R04 | MP-T05 |
| MP-R05 | MP-T06、MP-T08 |
| MP-R06 | MP-T07 |
| MP-R07 | MP-T10 |
| MP-R08 | MP-T11 |
| MP-R09 | MP-T13 |
| MP-R10 | MP-T14 |
| MP-R11 | MP-T15、MP-T16 |
| MP-R12 | MP-T03、MP-T04、MP-T11、MP-T14、MP-T17 |
| MP-R13 | MP-T07、MP-T18 |
| MP-R14 | superseded by MP-R16; historical MP-T19、MP-T20、MP-T21 |
| MP-R15 | superseded by MP-R16; historical MP-T22 |
| MP-R16 | MP-T23、MP-T24、MP-T25 |
| MP-R17 | MP-T26、MP-T27、MP-T28、MP-T29、MP-T30 |
| MP-R18 | MP-T31 |
| MP-R19 | MP-T32、MP-T33 |
| MP-D01 | MP-T01、MP-T06 |
| MP-D02 | MP-T02、MP-T06 |
| MP-D03 | MP-T07、MP-T08 |
| MP-D04 | MP-T05、MP-T07、MP-T18 |
| MP-D05 | MP-T12、MP-T13、MP-T14 |
| MP-D06 | superseded by MP-D07; historical MP-T22 |
| MP-D07 | MP-T24、MP-T25 |
| MP-D08 | MP-T26、MP-T27、MP-T29、MP-T30 |
| MP-D09 | MP-T32、MP-T33 |
| MP-M08 | MP-T32、MP-T33 |
| MP-R20 | MP-T23、MP-T24、MP-T25、MP-T32、MP-T34、MP-T35 |
| MP-D10 | MP-T34、MP-T35 |
| MP-M09 | MP-T34、MP-T35 |
| MP-R21 | MP-T36、MP-T37 |
| MP-D11 | MP-T36、MP-T37 |
| MP-M10 | MP-T36、MP-T37 |
| MP-R22 | MP-T38 |
| MP-D12 | MP-T38 |

Round29 historical/targeted evidence（2026-08-18，dirty worktree）：新增 MP-T36/MP-T37 先以未修复 source 重现 nested entry/post-stage stale-control failures（outer `void` 收到 active error，outer `await`/`return` 跳过 true dual combination）；仅在 `packages/middleware-pipeline/src/index.ts` 将 parent control-slot propagation 收紧为 final exact active error 后，`CI=true rtk pnpm --filter @migaia/middleware-pipeline exec vitest run test/pipeline.test.ts` 通过，1 file / 44 tests；其余 gate 结果已由 Round30 current evidence supersede。dirty worktree scope 外变更保持不动。

历史证据（2026-08-17，dirty worktree）仅作为旧基线。2026-08-18 本次 dirty worktree 证据：middleware package `fmt → lint → typecheck → typecheck:test → test` 通过；`CI=true rtk pnpm --filter @migaia/middleware-pipeline test` 完成 production Vite/tsc build，3 files / 34 tests passed，覆盖 MP-T23～MP-T25。plugin-host pipeline direct-consumer `CI=true rtk pnpm --filter @migaia/plugin-host exec vitest run test/pipeline` 通过，3 files / 14 tests。plugin-host `fmt` 通过；full `lint` 被既有 `test/callable-return.test.ts:377` 的 `unicorn(no-thenable)` 阻断，`typecheck`、`typecheck:test` 与 `test` build/declaration 阶段被既有 `src/config.ts:643` 的 `protectThenable` 未定义阻断；pipeline direct-consumer 仍通过。logger direct-consumer `CI=true rtk pnpm --filter @migaia/logger test` 完成 build，但 6 files 为 129 passed / 4 failed；上述 `protectThenable`、logger 129/4-fail 均属历史/已被 supersede 的 dirty-worktree 证据，当前 source 无 `protectThenable` 引用。`rtk git diff --check` 通过；未执行 install 或 network mutation。

历史 cross-package evidence（2026-08-18，dirty worktree，pre-Round22 baseline）：plugin-host 当时 full suite 为 167 tests，logger 当时 direct-consumer 为 136 tests；两者仅作为历史 middleware 外部 gate context，不升级 middleware 状态。MP-R16 仍为 `implemented-unverified`，待 middleware、plugin-host 与 logger direct-consumer/repository closure；不得以历史 `protectThenable`、logger 129/4-fail 或未记录的更新计数宣称 verified。

Round23 historical/superseded evidence（2026-08-18，dirty worktree）：middleware-pipeline `oxfmt → oxlint → typecheck → typecheck:test → build → test` 通过；3 files / 39 tests passed。plugin-host `oxfmt → oxlint → typecheck → typecheck:test → build → test` 通过；11 files / 173 tests passed；pipeline direct-consumer 3 files / 19 tests passed。logger formatter/build 与 direct-consumer test 通过；6 files / 138 tests passed。`git diff --check` 通过。workspace `pnpm` wrapper 在本环境尝试 registry metadata/install 并因无网络与非交互 modules purge 中止，因此上述 gates 使用已安装的本地 formatter/compiler/bundler/test runner 等价执行；未执行 install 或 network mutation。

Round25 historical/superseded evidence（2026-08-18，dirty worktree）：MP-R18 implementation adds immediate rejection observation on the original native downstream Promise; MP-T31 observes zero `unhandledRejection` notifications while the upstream gate remains pending, then preserves the exact downstream rejection. Middleware package `fmt → lint → typecheck → typecheck:test → test` passed; 3 files / 40 tests. Package-boundary exports and sync-only tree-shaking tests passed. Plugin-host full consumer passed, 13 files / 182 tests; plugin-host pipeline direct consumer passed, 3 files / 19 tests; store-middleware consumer passed, 6 files / 61 tests. Logger direct consumer remains blocked by 5 out-of-scope `toHaveSize` matcher failures in `test/round25.spec.ts` after 141 passed. Repository `pnpm test` passed; consumer typecheck passed; repository lint remains blocked by out-of-scope logger `typescript(no-this-alias)` at `test/round25.spec.ts:50`; repository typecheck remains blocked by out-of-scope serialize `TS18046` at `src/types.ts:128-129`. `make -n middleware-pipeline-check` expands correctly, while actual `make middleware-pipeline-check` is blocked by existing Makefile invocation of nonexistent pnpm command `@middleware-pipeline`. Full and scoped `git diff --check` passed. MP-R16/MP-R18/MP-M05 and MP-R17/MP-D08 remain `implemented-unverified`; MP-T26～MP-T30 provide implemented behavior evidence but the AF-181 review remains pending Round26. No scope-out source edits were made.

Round26 historical/superseded middleware evidence（2026-08-18，dirty worktree）：`CI=true rtk pnpm --filter @migaia/middleware-pipeline fmt → lint → run typecheck → run typecheck:test → run test` passed; production Vite/tsc build completed and 3 files / 43 tests passed, including MP-T32～MP-T33. Plugin-host full consumer `CI=true rtk pnpm --filter @migaia/plugin-host run test` passed, 15 files / 188 tests; pipeline direct consumer passed, 3 files / 19 tests. Logger consumer build completed but its direct test had 152 passed / 1 pre-existing out-of-scope failure at `test/round25.spec.ts:285`; logger E2E passed 2 tests after allowing local web-server bind on `127.0.0.1:4173`. Full and scoped `rtk git diff --check` passed. Repository-wide gates remain unexecuted; MP-R19/MP-D09/MP-M08 remain `implemented-unverified`.

Round27 historical intermediate evidence（2026-08-18，dirty worktree；已被后续校正证据 supersede）：entry-guard regression was red before implementation (`2 failed / 2 cases`: await and return both received host-shaped `PIPELINE_FAILED`), then passed after extending frame-local control ownership (`2 passed`); nested entry propagation also passed (`1 passed`). Middleware package `fmt → lint → typecheck → typecheck:test` passed via `CI=true rtk pnpm --filter @migaia/middleware-pipeline run ...`; package build/test passed with 3 files / 46 tests. Plugin-host direct pipeline consumer passed with 3 files / 19 tests. Plugin-host full consumer then ran 16 files / 191 tests with 190 passed and 1 stale out-of-scope assertion failure at `test/plugin-host.test.ts:991`, which still expected `PIPELINE_FAILED` where Round27 requires exact `HOST_DISPOSING`; logger direct consumer then ran 10 files / 162 tests with 157 passed / 5 pre-existing out-of-scope Round27 cleanup/reporter failures. These plugin-host and logger failure counts are historical intermediate state, not current/latest evidence; no plugin-host or logger edit is in scope.

Round27 historical/superseded evidence（2026-08-18，dirty worktree；已被 Round30 current evidence supersede）：middleware package build/test remains 3 files / 46 tests passed; plugin-host direct pipeline consumer remains 3 files / 19 tests passed; plugin-host PH-T07a now asserts exact `HOST_DISPOSING`, and full consumer passes 16 files / 191 tests; logger direct consumer passes 10 files / 162 tests, with logger E2E passing 2 tests after allowing local `127.0.0.1:4173` binding. Scoped `rtk git diff --check -- packages/middleware-pipeline docs/middleware-pipeline` and full `rtk git diff --check` passed; repository-wide gates remain unexecuted. MP-R20/MP-D10/MP-M09 remain `implemented-unverified` pending repository closure.

Round29 historical/superseded evidence（2026-08-18，dirty worktree）：middleware-pipeline 46 tests (3 files) passed after `fmt → lint → typecheck → typecheck:test → test → build`; plugin-host 198 tests (17 files) passed; logger 163 tests (11 files) passed; logger Playwright E2E passed 2/2；repository lint, typecheck and consumer typecheck passed；repository full test reached middleware 46/46 and stopped on 4 pre-existing out-of-scope `packages/plugin-host/test/round29.test.ts` prototype-identity failures；`rtk git diff --check` passed. This historical result is superseded by Round30 metadata closure; it is not a middleware blocker.

Round30 current evidence（2026-08-18，dirty worktree）：result status: `verified`; blocker: none; dependency: `middleware-pipeline <- plugin-host`, with plugin-host consuming the runner and middleware-pipeline owning the algorithm; middleware-pipeline 47 tests passed and plugin-host direct-consumer outcome is 202 tests passed. MP-R22/MP-D12/MP-T38 are a contract/evidence correction only; no code-level combine fix is claimed. This is the sole current Middleware evidence set; earlier failure wording is historical/superseded.

## 9. 风险、deferred 与交付门禁

风险：generator sentinel 是 plugin-host 历史契约，不能被重命名；adapter 与 runner 的错误所有权必须保持单一，不能再次双重聚合；host 组合器必须保持 source/code/cause 语义；双失败只依赖 stage/downstream 两个可观察 channel，不承诺不可观察的 Promise lineage 推断。entry/post-stage `HOST_DISPOSING` 只允许作为 runner control path 传播，不得替换已捕获独立 channel failure；control metadata 若再次在非-terminal branch 写入 parent，会复现 Round29 HIGH。repository-wide closure 仍未执行；dirty worktree 可能包含 scope 外变更。

Deferred：`store-middleware` 只有在需要直接依赖执行器时才迁移；queue/drain/close 另建 dispatcher SDD，并依赖 lifecycle。

交付顺序：`fmt → lint → typecheck → typecheck:test → test`，然后 plugin-host full/pipeline、logger direct-consumer、store-middleware gate、repository gate。任一旧 test 失败、bundle 引入未用模式、或出现第二套双失败判定，均阻断交付。
