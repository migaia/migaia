# `@migaia/middleware-pipeline` SDD

- 状态：**implemented**（package 与直接消费者已验证，repository gate 尚未完成）
- Owner：`@migaia/middleware-pipeline`
- 影响包：`@migaia/plugin-host`；后续可评估 `@migaia/store-middleware`
- 前置：[`runtime-neutrality.sdd.md`](../contracts/runtime-neutrality.sdd.md)、[`lifecycle-extraction.sdd.md`](../lifecycle/lifecycle-extraction.sdd.md)、[`event-subscriber.sdd.md`](../event-subscriber/event-subscriber.sdd.md)
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
| MP-R08 | 默认双失败 `AggregateError` 归 middleware-pipeline，携带 `EXECUTION_FAILED`；host 注入组合器时由 host 拥有领域错误，执行器不得声明 host error code。 | verified |
| MP-R09 | pipeline 协议值只从 `MiddlewarePipelineViolation` 读取；plugin-host 兼容层的稳定错误文本只由 `error-text.ts` 维护，调用点不得内联。 | verified |
| MP-R10 | generator runner 默认使用本包 sentinel，但允许兼容 wrapper 注入既有 Symbol identity；plugin-host 不得因抽取改变公开 sentinel。 | verified |

## 2. 现状与问题

原实现位于 `packages/plugin-host/src/pipeline.ts`，同时混合算法、plugin-host 错误码和 mode 常量，导致算法无法被其他 middleware consumer 复用。`plugin-host` 的 `host-runtime.ts` 仍必须负责 `_pipelineDepth`、active guard、stage registration 和 error tagging，这些不随算法下沉。

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

## 5. 生命周期与错误语义

执行器本身不持有跨调用资源；async runner 返回的 Promise 由调用方持有。plugin-host 负责 `_pipelineDepth`、closing/active 检查和 Promise finally 清理。

错误规则：

- listener/stage 的原始 throw/reject 保持可达；
- stage 与 downstream 同时失败时优先调用 `combineStageAndDownstreamError`，未提供时抛带 `EXECUTION_FAILED` 的默认 `AggregateError`；
- violation 由 handler 决定是诊断、抛错或其他策略；
- 本包不静默吞错误；仅注册通用 `EXECUTION_FAILED`，不声明任何 host error code。

## 6. 迁移与实施批次

| ID | Mission | 状态 |
| --- | --- | --- |
| MP-M01 | 新包骨架、exports、类型和 runner | implemented |
| MP-M02 | plugin-host 改为 wrapper，保持旧的内部导入路径和公开 API | implemented |
| MP-M03 | 原 plugin-host pipeline tests 继续作为 direct-consumer baseline，并补新包 unit tests | verified |
| MP-M04 | 删除 plugin-host 中重复算法，仅保留兼容 wrapper | implemented |
| MP-M05 | package、plugin-host、repository gates 与证据回填 | pending |
| MP-M06 | 发布脚本、默认双失败 error-code、wrapper 错误构造器和 direct tests 补齐 | implemented |

## 7. 测试与验收矩阵

| ID | 层级 | 明确断言 | 映射 |
| --- | --- | --- | --- |
| MP-T01 | unit | sync 顺序、值传递和未调用 next 的短路与旧行为一致 | MP-R01、MP-D01 |
| MP-T02 | unit | async `await next` 的 downstream 顺序和 stage/downstream 双错误组合保持 | MP-R01、MP-R03 |
| MP-T03 | unit | generator 多 yield、HALT、CONTINUE 和 undefined sentinel 保持 | MP-R01 |
| MP-T04 | unit | late/duplicate violation 只进入注入 handler | MP-R02 |
| MP-T05 | unit | 无 plugin-host import、timer、DOM/Node runtime API 或 global singleton | MP-R04、MP-D04 |
| MP-T06 | integration | plugin-host 旧 pipeline tests 全部通过，错误码、diagnostic、active guard 和 registration 行为不变 | MP-R03、MP-R05、MP-M02 |
| MP-T07 | type/package | 三种 stage type、sentinel 和 package export 可用，未引用模式不进入最小 bundle | MP-R06、MP-D04 |
| MP-T08 | repository | store-middleware 仍通过 plugin-host，未产生反向依赖或第二套 runner | MP-R05、MP-M04 |
| MP-T09 | unit | sync runner duplicate/late、空 async stage、combine callback、generator adapter duplicate/late 均有明确断言 | MP-R01、MP-R02、MP-R03 |
| MP-T10 | package | `release:patch`、`release:pack`、`release:publish` 存在；Makefile check/publish dry-run 指向正确 package scripts | MP-R07 |
| MP-T11 | architecture | 默认双失败保持 `AggregateError`、两个原错误 identity、稳定 message 与 `(source, EXECUTION_FAILED)`；注入组合器后不创建 pipeline 错误 | MP-R08、MP-D02 |
| MP-T12 | integration | plugin-host wrapper 的非法 stage 输入仍使用原 `createPluginHostTypeError`，source/code/message 与基线一致 | MP-D05、MP-M02 |
| MP-T13 | architecture | runner 不重复书写 `late`/`duplicate`；plugin-host pipeline 不存在内联错误消息，集中化前后消息逐字保持 | MP-R09、MP-D05 |
| MP-T14 | integration | 注入 host-owned sentinel 后 CONTINUE/UNDEFINED/HALT 仍按控制信号处理；plugin-host generator 既有 tests 原样通过 | MP-R10、MP-R01、MP-D05 |

## 8. 证据与闭合映射

| 条款 | Cases |
| --- | --- |
| MP-R01 | MP-T01、T02、T03 |
| MP-R02 | MP-T04 |
| MP-R03 | MP-T02、T06 |
| MP-R04 | MP-T05 |
| MP-R05 | MP-T06、T08 |
| MP-R06 | MP-T07 |
| MP-R07 | MP-T10 |
| MP-R08 | MP-T11 |
| MP-R09 | MP-T13 |
| MP-R10 | MP-T14 |
| MP-D01 | MP-T01、T06 |
| MP-D02 | MP-T02、T06 |
| MP-D03 | MP-T07、T08 |
| MP-D04 | MP-T05、T07 |
| MP-D05 | MP-T12、MP-T13、MP-T14 |

当前证据（2026-08-17，dirty worktree）：middleware-pipeline 的 `oxfmt → oxlint → typecheck → typecheck:test → build → test` 通过（2 files / 17 tests，含 sync-only bundle tree-shaking）；plugin-host direct-consumer 同序门禁通过（10 files / 118 tests）；store-middleware 下游门禁通过（6 files / 52 tests）；package JSON 解析、runtime-neutral API 扫描、内联协议/错误字符串扫描、`git diff --check` 与 `make -n middleware-pipeline-check` 通过。MP-M05 repository gate 与真实发布仍未完成，因此文档整体不能宣称 verified。

## 9. 风险、deferred 与交付门禁

风险：generator sentinel 是 plugin-host 历史契约，不能被重命名；async 错误组合必须由 host 保持 source/code/cause 语义；wrapper 不能重新实现 runner。

Deferred：`store-middleware` 只有在需要直接依赖执行器时才迁移；queue/drain/close 另建 dispatcher SDD，并依赖 lifecycle。

交付顺序：`fmt → lint → typecheck → typecheck:test → test`，然后 plugin-host direct-consumer tests、store-middleware gate、repository gate。任一旧 test 失败、bundle 引入未用模式、或 wrapper 出现第二套算法，均阻断交付。
