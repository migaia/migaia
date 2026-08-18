# `@migaia/utils` 公共运行时工具包与全仓迁移

- 状态：**pending**（设计合同已建立；代码、迁移与证据尚未开始）
- 工作类型：新包设计 + 一次性交付 + 跨包行为等价迁移
- Owner：`packages/utils`（runtime foundation）
- 影响包：`utils`（新增）、`lifecycle`、`serialize`、`storage-web`、`store-ssr`、`web-rpc`、`resource`、`logger`、`store-middleware`、`store-devtools`、`capability`、`reactive`、`middleware-pipeline`、`plugin-host`、`event-subscriber`、全部 `store-*` 错误辅助消费者、根发布/consumer fixtures
- 前置：`docs/contracts/error-codes.md`、`docs/contracts/runtime-neutrality.sdd.md`、`docs/lifecycle/lifecycle-extraction.sdd.md`、`docs/serialize/serialize-registry.sdd.md`
- 关联：`docs/lifecycle/migration.sdd.md`、`docs/middleware-pipeline/middleware-pipeline.sdd.md`、`docs/store-persist/storage-web-integration.sdd.md`
- 目标落点：`packages/utils/`、`docs/utils/public-utilities.sdd.md`

> “一次性交付”表示本 SDD 定义的六个公共域、现有等价实现迁移、重复路径删除、发布接入和消费者门禁必须在同一交付闭合；§6 的批次只表达依赖顺序，不是 v1/v2、可选版本或缩减范围。本文将“combiner”裁定为配置组合引擎，而非任意函数组合器。

## 0. 状态与闭合规则

条款状态只使用 `pending → red → implemented → verified`，以及真实外部阻断的 `blocked`、有独立 owner/文档的 `deferred`。本文无预设 deferred 项；不得以“后续版本”推迟任一列入范围的工具域。

总状态按以下顺序机械推导：

1. 任一非 deferred 条款为 `blocked`，总状态为 `blocked`。
2. 任一非 deferred 条款为 `pending` 或 `red`，总状态为 `pending` 或 `red`。
3. 所有条款均 implemented、但任一证据缺失，总状态为 `implemented-unverified`。
4. 所有非 deferred 的 R/D/MI 均 verified、正反向测试映射闭合、全部门禁有可复现证据，才可标记 `verified`。

当前矩阵：

| ID 集合                                                                                                                      | 状态    | Evidence   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| UT-R001～UT-R008、UT-R010～UT-R017、UT-R020～UT-R025、UT-R030～UT-R033、UT-R040～UT-R049、UT-R050～UT-R052、UT-R060～UT-R073 | pending | unverified |
| UT-D001～UT-D017                                                                                                             | pending | unverified |
| UT-MI001～UT-MI014                                                                                                           | pending | unverified |

闭合门禁：

- ID 永不复用或静默重编号；移动条款必须保留历史注记。
- 历史注记：UT-B02A、UT-R025、UT-T048、UT-T049是在既有编号冻结后追加，故保留非连续/字母后缀，不回填或重编号其他 ID。
- 每个 R/D/MI 至少映射一个语义测试；每个 UT-T 必须反向映射至少一个 R/D/MI。
- `verified` 证据必须记录命令、结果/计数、日期、commit SHA；dirty worktree 必须另记 baseline，不得冒充 clean completion。
- 既有测试仅作 baseline；每个迁移单元必须补显式 red case。
- 任一重复实现仍可从production import graph到达、任一子入口夹带D006矩阵外域、任一internal兼容包装无删除条件，均阻断交付；D007/D008明确保留的public零逻辑边界不属于临时包装。

## 1. 目标与范围

### 1.1 目标

- **UT-R001**：新增可独立安装的 `@migaia/utils`，作为整个 workspace 最底层公共运行时工具包；生产依赖为零，支持浏览器、Node、Worker 与 Bun 的共同 JavaScript 能力。
- **UT-R002**：同一次交付完整提供 `promise`、`error`、`bytes`、`object`、`config`、`function` 六个公共域；不存在 v1/v2 功能拆分。
- **UT-R003**：提供根入口与六个 subpath：`@migaia/utils`、`@migaia/utils/promise`、`/error`、`/bytes`、`/object`、`/config`、`/function`。每个 subpath 只能静态引入 D006 依赖矩阵允许的同包域；不得夹带矩阵外域或任一 workspace/宿主 adapter。
- **UT-R004**：所有 API 以明确保证命名，不提供含糊的万能 `clone`、无法说明取消效果的 `timeout`、无限重试或静默吞错 API。
- **UT-R005**：所有算法在输入规模上线性或常数复杂度运行；禁止隐式全仓扫描、无限队列、无上限递归、按字节反复拼接导致的二次复杂度。
- **UT-R006**：包加载与普通对象构造不创建 timer、listener、worker、网络请求或全局注册；只有显式调用异步工具才触发宿主能力。
- **UT-R007**：README/USEGUIDE必须覆盖每个public export，并给出单独安装、subpath import、scheduler/deferred/sleep、取消、两级超时+retry、limiter、错误/diagnostic、Base64/UTF-8、三种snapshot、once、config own/readonly/COW/path/full combiner示例；明确cooperative cancellation、custom report与默认hostRethrowReporter、zeroTimeoutBehavior、readonly非sandbox及strict Base64 behavior change。全部示例参与typecheck/runtime门禁。
- **UT-R008**：所有公开 named type 使用 `I` 前缀，relative specifier 使用 `.js`，不使用 enum/const enum、`bind`/`call`/`apply`。

### 1.2 非目标

- 不拥有 reactive graph、resource cache、store、persistence、RPC、middleware、plugin、DOM UI、Worker transport 或业务重试策略。
- 不实现 crypto、hash、UUID、随机数、日期格式化、HTTP client、schema validator、logger 或集合扩展大全。
- 不把 lifecycle scope/generation/lease/dispose transaction 搬进 utils；只下沉可独立定义的 scheduler、abort-aware Promise 和通用 limiter 原语。
- 不保证任意 Promise 可被强制取消；取消只通过 signal 通知合作式 operation。
- 不迁移名称相似但保证不同的 storage key clone、cross-realm error transport、resource Suspense thenable、RPC protocol assembler。
- 不把 plugin-host 的加载队列、generation、插件 manifest 校验、领域错误翻译或配置提交事务搬进 utils；config 域只拥有可独立安装的配置值图算法。

### 1.3 迁移范围要求

- **UT-R060**：lifecycle的scheduler、abort race与bounded wait mechanics委托utils，保持旧公开契约；其`ILifecycleScheduler/IScheduledTask`继续由lifecycle声明并只暴露既有成员，adapter把utils task收窄为`cancel()`，不得因utils可选`unref()`意外扩张lifecycle公共类型。
- **UT-R061**：web-rpc 的通用 timeout/retry/UTF-8 mechanics 委托 utils，RPC policy/protocol 留在原 owner；timeout/retry wrapper固定传`zeroTimeoutBehavior:'start'`与`unref:true`，保持既有0ms仍启动operation及Node timer liveness语义。
- **UT-R062**：resource 只迁通用 delay/scheduler，不迁 Suspense、generation 或资源 retry state machine。
- **UT-R063**：logger 复用通用时间/并发原语，同时保持 shutdown、flush、process exit 与 unref 语义。
- **UT-R064**：serialize、storage-web、web-rpc 的通用 Base64/UTF-8 算法归一，wire bytes 逐字兼容。
- **UT-R065**：各包机械 error identity 附加逻辑迁到 utils/error；包级 code/text/factory 与领域 policy 留在原 owner。
- **UT-R066**：storage-web 的 extension/migration abort race 迁移底层 mechanics，保留 IndexedDB lifecycle、reporter 与错误翻译；0ms保持pre-aborted/不启动后端operation，使用默认`skip`。
- **UT-R067**：store-ssr 只复用 race mechanics，保留 outcome union 与 waterfall policy；0ms使用`start`，让已settle work的Promise job仍可先于0-delay timer获胜。
- **UT-R068**：等价 clone/once/noop/deferred helper 迁移；领域状态机或不同保证的 helper 明确保留理由。
- **UT-R069**：全仓 package graph、metadata、lockfile、docs、consumer fixtures、发布与 repository gates 同次闭合。
- **UT-R070**：plugin-host 的 config owned copy、readonly facade、COW patch、path 算法迁到 utils/config；保持所有既有 rich-runtime 行为、插件事务、公开类型/exports、source/code/message，并删除原重复 graph engine。
- **UT-R071（intentional behavior change）**：storage-web旧实现把输入交给宿主`atob`，会因宿主而接受部分空白/缺padding等非canonical Base64；迁移后统一使用R030 strict decoder，非canonical持久化文本改为`INVALID_ENCODING`并由storage-web翻译为其既有codec错误族。影响仅限外部手工写入或损坏的非canonical fallback文本；由storage-web自身历史encoder产生的数据逐字canonical且继续可读。不提供permissive兼容模式，避免跨宿主漂移；必须更新storage-web UT、README/USEGUIDE、error registry说明和跨包fixture。
- **UT-R072（intentional architecture change）**：serialize/core现有`SER-R27-02`要求transitive runtime import graph不含任何workspace package；迁移后放宽为“只允许leaf `@migaia/utils/bytes`，仍禁止lifecycle及任一上层包”。serialize package保留其registry对lifecycle的既有依赖并新增utils，不宣称整包只依赖utils。影响是core bundle新增唯一leaf依赖；运行时exports/wire/error保持不变。B06必须先在`serialize-registry.sdd.md`保留历史注记并更新SER-R27-02/SER-T27-01，再改import。
- **UT-R073（intentional behavior change）**：web-rpc旧`internal/async-control.ts`会静默吞掉listener cleanup、`onTimeout`与`onDiagnostic`自身失败；迁移后custom `onDiagnostic`映射为utils report，省略或reporter自身失败走`hostRethrowReporter`，成为可观察host uncaught error且不改已settle RPC结果。影响只在这些secondary/diagnostic failure发生时；正常timeout/retry不变。必须更新web-rpc hardening UT、USEGUIDE diagnostics说明和cross-process fixture；本条不授权修改其他adapter catch语义。

## 2. 现状与问题

### 2.1 静态盘点基线

2026-08-18 dirty worktree 的只读盘点：24 个 workspace 包；`Promise.race` 分布于 5 包/7 个 production 文件，timer 分布于 10 包/15 个 production 文件；错误 `(source, code)` 附码在 22 个文件重复，约 19 包存在 85 个 tag 调用/工厂落点；Base64 有 `serialize` 与 `storage-web` 两套实现；UTF-8 计算在 `web-rpc`，Encoding 逻辑散布于 `serialize`/`store-*`；named `deferred` test helper 至少有 5 份。

这些数字是静态消费证据，不代表运行时 profiling。迁移开始时必须由 UT-B00 重新生成清单并冻结为 evidence。

### 2.2 主要问题

- timeout 代码容易遗留 loser timer/listener、漏观察迟到 rejection，或混淆总预算与单次预算。
- retry 常把 policy、backoff、operation lifecycle 和领域错误分类揉在一起，无法在外部项目复用。
- 错误附码机械逻辑高度重复，`configurable`、既有属性冲突和 frozen Error 行为已发生漂移。
- Base64 一套依赖 `btoa/atob`，一套纯算法，校验与大输入能力不一致。
- `safeRead` 式 API可能把 hostile getter 错误降为 `undefined`，与“不得静默吞错”冲突。
- clone 名称不能表达 strict independent、diagnostic best-effort、identity 三种不同保证。
- 局部 `once`/`noop`/deferred/gate 重复定义，重入和首次 throw 后行为未统一。
- `plugin-host/src/config.ts` 同时承担 owned copy、只读 facade、COW patch、路径解析和 rich runtime value 防护，通用算法与插件事务耦合；其他项目无法独立安装复用，继续复制会让 cycle、receiver、thenable、prototype-pollution 语义漂移。

## 3. 架构裁定与依赖方向

### 3.1 Owner 与依赖图

- **UT-D001**：`utils` 是 leaf foundation，生产依赖为零；允许方向为 `utils ← lifecycle/serialize/web-rpc/...`，禁止 `utils →` 任一 workspace、Node-only、DOM、Store、Worker 或 adapter 包。
- **UT-D002**：utils 接管“通用 scheduler contract + 默认跨运行时 scheduler + abort-aware Promise mechanics”；lifecycle 继续拥有 scope、generation、lease、dispose transaction、error policy，并通过兼容层保持现有公开契约。
- **UT-D003**：utils 接管纯 bytes/UTF-8/Base64；serialize 继续拥有 codec/parser/registry，web-rpc 继续拥有 framing/chunk protocol，storage-web 继续拥有 key wire domain。
- **UT-D004**：utils/error 只拥有机械错误身份与 cause traversal；每包仍拥有 `src/error-code.ts`、稳定文本、领域工厂、throw/collect/report 策略。
- **UT-D005**：utils/object 只拥有通用 shape/probe/clone policy；storage key 与 reactive ownership 不迁移。plugin config 的值图算法迁入 utils/config，插件事务和领域校验仍由 plugin-host 拥有。
- **UT-D006**：根入口聚合六域；内部文件只向同域或下表允许的同包域导入，禁止跨域循环。bundle 门禁按矩阵检查，不能把“存在跨域 import”误判为失败。

| Subpath     | 允许静态依赖                           | 禁止静态依赖                             |
| ----------- | -------------------------------------- | ---------------------------------------- |
| `/error`    | 同域 internal                          | promise、bytes、object、config、function |
| `/function` | 同域 internal、error                   | promise、bytes、object、config           |
| `/object`   | 同域 internal、error                   | promise、bytes、config、function         |
| `/bytes`    | 同域 internal、error                   | promise、object、config、function        |
| `/promise`  | 同域 internal、error、function         | bytes、object、config                    |
| `/config`   | 同域 internal、error、object、function | promise、bytes                           |
| root        | 六个 public entry                      | 任一 workspace/adapter                   |

```text
@migaia/utils/{error,function,bytes,object}
                 ↑
   @migaia/utils/{promise,config}
                 ↑
 @migaia/lifecycle / serialize / web-rpc / feature packages
```

### 3.2 复用与拒绝路径

- **UT-D007**：迁移后，`serialize/src/base64.ts`、`storage-web/src/utils/base64.ts`、`web-rpc`通用UTF-8算法、各包机械error tag不再保留独立算法。既有**公开**入口必须保留零逻辑re-export/领域错误翻译且不算重复实现；既有**内部**入口在仓内消费者归零后同批删除，不建立永久alias。
- **UT-D008**：`lifecycle`既有scheduler/abort public names作为稳定边界继续保留，内部实现委托utils并保持lifecycle source/code/message；本次不删除公开入口。未来若删除只能在独立breaking SDD/release中完成，不能以“仓内消费者已迁移”代表外部消费者消失。
- **UT-D009**：`resource` 的 Suspense/retry state machine、logger shutdown orchestration、SSR outcome union、serialize detached cleanup 不迁入 utils；只复用其底层 delay/race/scheduler 原语。
- **UT-D010**：不提供吞掉 getter 异常的 `safeRead(): T | undefined`；改为返回判别结果的 `probeProperty`，调用者必须显式处理 `missing/value/failed`。
- **UT-D011**：不提供会悄悄 alias 的单一 deep clone；公开 `immutableSnapshot`、`diagnosticSnapshot`、`identitySnapshot` 三个不同保证。
- **UT-D012**：本包是一个发布单元，不拆成多个 npm 包；内部按 subpath 隔离 tree-shaking、类型和测试。
- **UT-D013**：config 域细分为 admission/ownership、readonly facade、COW patch、path、policy、combiner 六层；plugin-host 只组合这些原语并拥有插件生命周期、提交串行化、rollback 与领域错误。
- **UT-D014**：`combineConfig` 是同步、确定性的配置值图组合器，不接受任意异步 reducer，不执行 schema validation，不隐式解释环境变量或插件 manifest。
- **UT-D015**：combiner 的 record/array/Map/Set/undefined/delete/conflict 行为必须由显式策略决定；除文档化默认策略外不得依据运行时猜测 merge 语义。
- **UT-D016**：owned copy、COW 与 combine 使用统一 graph engine，保持 cycle、shared reference、property order 和 root-reference rebase；禁止三套递归 clone/merge 各自演化。
- **UT-D017**：readonly 使用按 identity 缓存的惰性 facade，不使用 `Object.freeze` 或 eager deep clone；它只保证阻止“经配置值图公开操作面”发生的结构 mutation，并保持合法 reader、callable、constructable、iterator 与 thenable receiver 语义。它不是 capability sandbox，不承诺阻止 closure、private slot 或外部 I/O 的副作用。

## 4. 公开契约/核心设计

### 4.1 包布局与 exports

- **UT-R010**：实现以下固定入口；新增入口须另立条款，不能通过 wildcard exports 偷渡。

```text
packages/utils/
  src/index.ts
  src/promise.ts       src/promise/*
  src/error.ts         src/error/*
  src/bytes.ts         src/bytes/*
  src/object.ts        src/object/*
  src/config.ts        src/config/*
  src/function.ts      src/function/*
  src/error-code.ts    src/error-text.ts
  test/{promise,error,bytes,object,config,function,architecture,package-exports}.test.ts
  README.md USEGUIDE.md package.json tsconfig.json tsconfig.test.json vite.config.ts
```

`package.json` 必须含 `type: module`、`sideEffects: false`、`files`、根与六个显式 exports、`fmt/build/typecheck/typecheck:test/lint/test/release:*`。构建采用多入口，生成对应 `.js/.d.ts/.map`。

### 4.2 Promise 与时间原语

- **UT-R011 Scheduler**：公开结构化`IUtilsScheduler`、`IScheduledTask`、`systemScheduler`、`createManualScheduler()`。`now()`单调不减且有限；delay有限非负；cancel/unref幂等；callback至多一次；同步scheduler合法。manual scheduler初始now=0；`advance(ms)`先把now设为target，再按dueAt/registration FIFO同步flush，callback新增且dueAt≤target的task同轮执行；callback throw exact透出、now保持target、其余task保留；单次advance最多执行10_000个callback，第10_001个执行前抛`SCHEDULER_RUNAWAY`且该task保留。`pendingCount`即时反映未cancel/未执行task。`systemScheduler`仅在宿主timer handle暴露函数型`unref`时转发，不自动调用；是否请求unref属于调用方/adapter policy。
- **UT-R012 Deferred**：`deferred<T>()` 返回 `{ promise, resolve, reject }`。resolve/reject 只采用原生 Promise first-settlement；不暴露可伪造 settled flag；executor 同步完成且不会把 resolver 泄露给全局。
- **UT-R013 Sleep**：`sleep(delayMs, controls?)`；非法 delay/controls入口失败；任一 pre-abort不schedule；abort与timer first-observed-wins；settle后所有listener/timer恰好清理一次；返回Promise始终异步settle。`signal`与`signals`互斥，signals按数组顺序检查/注册，首个 observed abort reason获胜。
- **UT-R014 WithTimeout**：`withTimeout(operation, options)`只接收lazy factory。`timeoutMs`必须为有限非负数；任一pre-abort不调用factory。`timeoutMs=0`由`zeroTimeoutBehavior`决定：默认`skip`立即timeout且不调用factory；`start`先登记0-delay timer再调用factory，用于web-rpc/SSR兼容，之后按event-loop first-observed-wins；若注入scheduler在`schedule()`返回前同步触发timer，timer已赢且factory不再调用。operation/abort/timeout first-observed-wins；timeout abort内部signal并以`UtilsTimeoutError`拒绝；不声称强制取消operation。入口snapshot有效reporter=`options.report ?? hostRethrowReporter`：迟到rejection、公开结果settle后cleanup failure均恰好报告一次；若custom reporter抛错，交给`hostRethrowReporter`，绝不静默吞掉或改写已settle结果。`unref:true`只调用task可选`unref()`，缺失不失败。
- **UT-R015 Retry**：`retry(operation, options)`要求显式正安全整数`maxAttempts`；reporter按R014选择；串行attempt从1开始。`shouldRetry(error, context)`仅在operation/attempt-timeout失败且仍有attempt时调用，external abort、total timeout、policy/delay validation failure不调用。attempt timeout产生`UtilsTimeoutError(scope:'attempt')`并可由policy重试；total timeout产生`UtilsTimeoutError(scope:'total')`且永不重试。total deadline在入口以scheduler `now()+totalTimeoutMs`计算一次并先登记total task，每次attempt再登记attempt task，因此相同dueAt时total先赢；每次attempt/backoff前检查剩余预算。`remaining<=0`时默认`zeroTimeoutBehavior:'skip'`不启动，`start`则允许登记0-delay total timer后启动，供既有消费者兼容；同步scheduler若在返回前触发total timer，operation不启动。operation settle、任一external abort、attempt deadline、total deadline按first-observed-wins；同一scheduler tick按已登记callback FIFO，再处理callback排入的Promise job。最终耗尽抛exact最后operation/attempt-timeout error；policy error抛exact policy error；迟到rejection和settle后cleanup failure走有效reporter。delay函数每个获准retry调用一次，返回有限非负数；backoff/jitter不设隐式随机源，统一由delay函数实现。
- **UT-R016 Concurrency limiter**：`createConcurrencyLimiter({ concurrency, report? })`要求concurrency为正安全整数并返回FIFO limiter，reporter按R014选择。`run`在入口snapshot task/signal；pre-abort不入队并以exact `signal.reason`拒绝，reason为`undefined`时创建一次`UtilsAbortError`；queued abort同样只移除并拒绝自身；task一旦active，external abort不强制终止task，传入task的仍是入口snapshot signal。首次`close(reason?)`或`dispose(reason?)`原子固定close reason（显式值即使为`undefined`也按缺省处理，创建一次`UtilsError/LIMITER_CLOSED`）；之后两方法传入的不同reason均忽略。close幂等拒绝新任务并以exact固定reason拒绝queued，不中止active。dispose首次调用隐式close并创建唯一Promise，后续dispose复用exact Promise；它等待全部active settle后resolve，task failure只属于对应run Promise。`whenIdle()`在同一non-idle epoch复用Promise，已经idle时返回模块级resolved Promise；close/dispose清空queue后若无active须同步推进idle/dispose状态，但Promise callback仍按原生microtask运行。signal cleanup的post-settle failure走有效reporter。队列均摊O(1)，不得`Array.shift()`造成O(n²)。
- **UT-R017 Promise 边界**：所有 thenable只读取`.then`一次；hostile getter、同步callback/scheduler/listener、重入close/abort、cleanup failure、late settlement均有定义；不得产生unhandled rejection、悬挂timer/listener或双settle。options自身字段、scheduler的`now/schedule`、scheduled task的`cancel/unref`、signal的`addEventListener/removeEventListener`各在入口snapshot一次并保留receiver；为关闭check→subscribe race，`signal.aborted`严格读取两次（注册前/后），`reason`只在判定abort winner后读取一次。同步scheduler在`schedule()`返回前触发callback时仍exactly-once settle，并在handle返回后立即执行应有cancel。

固定公开签名；实现不得改名、增删必选字段或改变返回类型，行为扩展须新增条款：

```ts
export type IAbortListener = () => void;
export type IAbortSignal = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: 'abort',
    listener: IAbortListener,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: 'abort', listener: IAbortListener): void;
};
export type IUtilsDiagnosticContext = {
  readonly operation: 'withTimeout' | 'retry' | 'sleep' | 'limiter';
  readonly phase: 'late-rejection' | 'cleanup' | 'reporter';
  readonly attempt?: number;
};
export type IUtilsReporter = (error: unknown, context: IUtilsDiagnosticContext) => void;
export declare const hostRethrowReporter: IUtilsReporter;
export type IScheduledTask = { cancel(): void; unref?(): void };
export type IUtilsScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): IScheduledTask;
};
export type IManualScheduler = IUtilsScheduler & {
  advance(ms: number): void;
  readonly pendingCount: number;
};
export type IDeferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
};
export type IRetryContext = {
  readonly attempt: number;
  readonly signal: IAbortSignal;
  readonly remainingMs?: number;
};
export type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number };
export type IAsyncControls = {
  readonly signal?: IAbortSignal;
  readonly signals?: readonly IAbortSignal[];
  readonly scheduler?: IUtilsScheduler;
  readonly unref?: boolean;
};
export type ISleepOptions = IAsyncControls;
export type ITimeoutOptions = ISleepOptions & {
  readonly timeoutMs: number;
  readonly report?: IUtilsReporter;
  readonly zeroTimeoutBehavior?: 'skip' | 'start';
};
export type IRetryOptions = {
  readonly maxAttempts: number;
  readonly shouldRetry: (
    error: unknown,
    context: IRetryFailureContext
  ) => boolean | PromiseLike<boolean>;
  readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number);
  readonly signal?: IAbortSignal;
  readonly signals?: readonly IAbortSignal[];
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly scheduler?: IUtilsScheduler;
  readonly report?: IUtilsReporter;
  readonly unref?: boolean;
  readonly zeroTimeoutBehavior?: 'skip' | 'start';
};
export type ITimeoutOperation<T> = (context: {
  readonly signal: IAbortSignal;
}) => T | PromiseLike<T>;
export type ILimiterRunOptions = { readonly signal?: IAbortSignal };
export type IConcurrencyLimiter = {
  run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: ILimiterRunOptions
  ): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
  whenIdle(): Promise<void>;
  close(reason?: unknown): void;
  dispose(reason?: unknown): Promise<void>;
};
export declare const systemScheduler: IUtilsScheduler;
export declare function createManualScheduler(): IManualScheduler;
export declare function deferred<T>(): IDeferred<T>;
export declare function sleep(delayMs: number, options?: ISleepOptions): Promise<void>;
export declare function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: ITimeoutOptions
): Promise<T>;
export declare function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: IRetryOptions
): Promise<T>;
export declare function createConcurrencyLimiter(options: {
  readonly concurrency: number;
  readonly report?: IUtilsReporter;
}): IConcurrencyLimiter;
```

`hostRethrowReporter`不在模块加载时读取宿主能力；每次调用惰性读取一次`globalThis.queueMicrotask`并保留receiver，存在时排入`throw error`，不存在时从当前callback同步throw。它是无custom reporter时唯一默认出口，不使用console、不创建unhandled rejected Promise。

### 4.3 Error 原语

- **UT-R020**：`attachErrorIdentity(error,{source,code,phase?,detail?})` 原位附加 enumerable 属性，返回同一实例；不修改 name/message/stack/cause/errors/prototype；同值重复附加幂等；冲突或不可扩展对象抛有 cause 的 utils 错误。
- **UT-R021**：`toError(value,{message?}?)` 对 Error 返回 exact instance；非 Error 创建带 `cause: value` 的 tagged Error；message 转换失败使用稳定 fallback，转换最多一次。
- **UT-R022**：`walkErrorCauses(error,{maxDepth?})` 有界、identity 去重，按 root→cause→AggregateError.errors 顺序遍历；hostile getter 失败作为结果项而非静默丢弃；不修改输入。
- **UT-R023**：`combineErrors(errors,message)`：输入iterable只消费一次，每项先经`toError`；正常迭代时0项返回`undefined`，1项返回转换后的exact Error，2+创建AggregateError，顺序与Error identity原样保留且不flatten。迭代器抛错时总是抛`AggregateError([...已收集Error, toError(iteratorThrown)], message)`；若原throw不是Error，则通过最后一项cause保持原值identity可达。
- **UT-R024**：公开`UtilsErrorCode`、`UtilsError`、`UtilsAbortError`、`UtilsTimeoutError`和类型守卫；新增code必须先登记`docs/contracts/error-codes.md`。固定包含`INVALID_ARGUMENT`、`NON_ERROR_VALUE`、`ENV_UNSUPPORTED`、`ABORTED`、`DEADLINE_EXCEEDED`、`SCHEDULER_RUNAWAY`、`ERROR_IDENTITY_CONFLICT`、`CLONE_UNSUPPORTED`、`INVALID_ENCODING`、`LIMITER_CLOSED`、`REENTRANT_CALL`、`CONFIG_UNSUPPORTED`、`CONFIG_READONLY`、`CONFIG_CONFLICT`、`CONFIG_LIMIT_EXCEEDED`、`CONFIG_PATH_INVALID`。
- **UT-R025**：所有 utils-origin error 的 `source` 固定为 `@migaia/utils`；`error-text.ts` 只导出下表 exact text/factory，调用点不得另写稳定错误文本。`field/path/capability/reason` 先安全转换一次，转换失败使用 `<unprintable>`；任何 message 变更都按 public contract 更新 registry、UT、README/USEGUIDE。

| Code                      | 原生类型                              | Canonical message                                                |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `INVALID_ARGUMENT`        | TypeError 或 RangeError（由条款指定） | `[utils] invalid {field}: {expectation}`                         |
| `NON_ERROR_VALUE`         | UtilsError                            | `[utils] non-Error value was converted`                          |
| `ENV_UNSUPPORTED`         | UtilsError                            | `[utils] host capability is unavailable: {capability}`           |
| `ABORTED`                 | UtilsAbortError                       | `[utils] operation aborted`                                      |
| `DEADLINE_EXCEEDED`       | UtilsTimeoutError                     | `[utils] {scope} deadline exceeded after {timeoutMs}ms`          |
| `SCHEDULER_RUNAWAY`       | RangeError                            | `[utils] manual scheduler exceeded the 10000-task advance guard` |
| `ERROR_IDENTITY_CONFLICT` | TypeError                             | `[utils] error identity conflicts with existing {field}`         |
| `CLONE_UNSUPPORTED`       | UtilsError                            | `[utils] immutable snapshot is unsupported for this value`       |
| `INVALID_ENCODING`        | TypeError                             | `[utils] invalid {encoding} input at offset {offset}`            |
| `LIMITER_CLOSED`          | UtilsError                            | `[utils] concurrency limiter is closed`                          |
| `REENTRANT_CALL`          | UtilsError                            | `[utils] reentrant call is not allowed`                          |
| `CONFIG_UNSUPPORTED`      | TypeError                             | `[utils] unsupported config value at {path}: {reason}`           |
| `CONFIG_READONLY`         | TypeError                             | `[utils] readonly config mutation is not allowed at {path}`      |
| `CONFIG_CONFLICT`         | TypeError                             | `[utils] config conflict at {path}: {reason}`                    |
| `CONFIG_LIMIT_EXCEEDED`   | RangeError                            | `[utils] config {limit} limit exceeded at {path}`                |
| `CONFIG_PATH_INVALID`     | TypeError 或 RangeError               | `[utils] invalid config path at {path}: {reason}`                |

```ts
export const UtilsErrorCode: {
  readonly invalidArgument: 'INVALID_ARGUMENT';
  readonly nonErrorValue: 'NON_ERROR_VALUE';
  readonly envUnsupported: 'ENV_UNSUPPORTED';
  readonly aborted: 'ABORTED';
  readonly deadlineExceeded: 'DEADLINE_EXCEEDED';
  readonly schedulerRunaway: 'SCHEDULER_RUNAWAY';
  readonly errorIdentityConflict: 'ERROR_IDENTITY_CONFLICT';
  readonly cloneUnsupported: 'CLONE_UNSUPPORTED';
  readonly invalidEncoding: 'INVALID_ENCODING';
  readonly limiterClosed: 'LIMITER_CLOSED';
  readonly reentrantCall: 'REENTRANT_CALL';
  readonly configUnsupported: 'CONFIG_UNSUPPORTED';
  readonly configReadonly: 'CONFIG_READONLY';
  readonly configConflict: 'CONFIG_CONFLICT';
  readonly configLimitExceeded: 'CONFIG_LIMIT_EXCEEDED';
  readonly configPathInvalid: 'CONFIG_PATH_INVALID';
};
export type IUtilsErrorCode = (typeof UtilsErrorCode)[keyof typeof UtilsErrorCode];
export declare abstract class UtilsError extends Error {
  readonly source: '@migaia/utils';
  readonly code: IUtilsErrorCode;
  protected constructor(
    code: IUtilsErrorCode,
    message: string,
    options?: { readonly cause?: unknown }
  );
}
export declare class UtilsAbortError extends UtilsError {
  readonly name: 'AbortError';
  constructor(reason?: unknown);
}
export declare class UtilsTimeoutError extends UtilsError {
  readonly scope: 'operation' | 'attempt' | 'total';
  readonly timeoutMs: number;
  constructor(scope: 'operation' | 'attempt' | 'total', timeoutMs: number);
}
export type IErrorIdentity = {
  readonly source: string;
  readonly code: string;
  readonly phase?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
};
export type IErrorCauseEntry =
  | { readonly kind: 'error'; readonly error: Error; readonly depth: number }
  | {
      readonly kind: 'failed';
      readonly error: Error;
      readonly depth: number;
      readonly cause: unknown;
    };
export declare function attachErrorIdentity<T extends Error>(error: T, identity: IErrorIdentity): T;
export declare function toError(value: unknown, options?: { readonly message?: string }): Error;
export declare function walkErrorCauses(
  error: unknown,
  options?: { readonly maxDepth?: number }
): readonly IErrorCauseEntry[];
export declare function combineErrors(
  errors: Iterable<unknown>,
  message: string
): Error | undefined;
export declare function isUtilsError(
  value: unknown
): value is Error & { readonly source: '@migaia/utils'; readonly code: IUtilsErrorCode };
export declare function isUtilsAbortError(value: unknown): value is UtilsAbortError;
export declare function isUtilsTimeoutError(value: unknown): value is UtilsTimeoutError;
```

### 4.4 Bytes 与 UTF-8

- **UT-R030**：`bytesToBase64`、`base64ToBytes` 使用纯 JS、无 `btoa/atob`、Node Buffer 或 Encoding API；严格 RFC 4648 canonical alphabet/padding；拒绝空白、内部 padding、非零 trailing bits 和非法长度；大输入分块避免参数/栈上限。
- **UT-R031**：`streamBase64Chunks` 只在 3-byte 边界切片，中间块不得产生 padding；拼接结果逐字等于 `bytesToBase64`。
- **UT-R032**：`utf8ByteLength`、`encodeUtf8`、`decodeUtf8`、`splitUtf8` 为 host-independent 实现；孤立 surrogate 按 U+FFFD；decode 默认 replacement、`fatal: true` 抛 tagged `INVALID_ENCODING`；split 不切 code point、不超过 maxBytes，maxBytes 必须为安全整数且至少 4。
- **UT-R033**：bytes API 不共享可变 buffer；decode/encode 返回新 Uint8Array/string；offset view 只读取可见区间；算法 O(n)，不得按 byte 反复字符串拼接造成 O(n²)。

```ts
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function base64ToBytes(value: string): Uint8Array;
export declare function streamBase64Chunks(
  bytes: Uint8Array,
  options?: { readonly maxChunkBytes?: number }
): Iterable<string>;
export declare function utf8ByteLength(value: string): number;
export declare function encodeUtf8(value: string): Uint8Array;
export declare function decodeUtf8(
  bytes: Uint8Array,
  options?: { readonly fatal?: boolean }
): string;
export declare function splitUtf8(value: string, maxBytes: number): readonly string[];
```

`maxChunkBytes`缺省`32_763`（保持serialize既有边界），必须是至少3的安全整数且为3的倍数；空bytes迭代器不产出块。`splitUtf8(''...)`返回`['']`，其余结果不含空块。

### 4.5 Object 原语

- **UT-R040**：`isPlainObject` 仅接受 prototype 为 `Object.prototype` 或 null 的非数组对象；cross-realm plain object 通过原型链语义判定，hostile prototype 读取失败返回 false。
- **UT-R041**：`probeProperty(value,key)` 返回 `{kind:'missing'}`、`{kind:'value',value}` 或 `{kind:'failed',error}`；只读一次；保留 receiver；区分属性值 `undefined` 与不可读/不存在；不吞 getter/Proxy 错误。
- **UT-R042**：`immutableSnapshot` 必须得到独立 structured clone，否则抛 `ENV_UNSUPPORTED/CLONE_UNSUPPORTED` 并保留原错误；`identitySnapshot` 返回 exact 输入；`diagnosticSnapshot` 返回 `{ value, diagnostics }`，不以 throw 表达 subtree clone failure，递归隔离 array/plain object、保持 cycle/shared identity，对 host/class/function 叶保持引用并产生 diagnostic。
- **UT-R043**：diagnostic clone 读取 own enumerable key/descriptor 一次，安全处理 `__proto__`、symbol、accessor、cycle、sparse array 与 hostile proxy；accessor、读取失败或 unsupported leaf均把 exact 原 error/value记录到有 path 的 diagnostics，并将原叶按 identity 保留，不得丢弃诊断或伪造完整独立保证。

```ts
export type IPropertyProbe<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown };
export type ISnapshotDiagnostic = {
  readonly path: readonly PropertyKey[];
  readonly reason: 'accessor' | 'read-failed' | 'unsupported';
  readonly cause: unknown;
};
export type IDiagnosticSnapshot<T> = {
  readonly value: T;
  readonly diagnostics: readonly ISnapshotDiagnostic[];
};
export declare function isPlainObject(value: unknown): value is Record<PropertyKey, unknown>;
export declare function probeProperty<T = unknown>(
  value: unknown,
  key: PropertyKey
): IPropertyProbe<T>;
export declare function immutableSnapshot<T>(value: T): T;
export declare function identitySnapshot<T>(value: T): T;
export declare function diagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>;
```

### 4.6 Function 原语

- **UT-R050**：`once(fn)` 最多调用 fn 一次；首个 return 或 throw 都缓存，后续返回相同 value/Promise identity 或抛 exact 同一错误；运行中重入抛 `REENTRANT_CALL`，但不替换外层最终结果；动态 `this` 不转发，方法调用方必须显式传 arrow closure。
- **UT-R051**：`noop` 是模块级稳定 identity、无参数解释、返回 `undefined`、不分配对象、不产生副作用。
- **UT-R052**：`onceAsync(fn)` 复用第一次返回的 exact Promise；同步 throw 转为一个缓存的 rejected Promise；并发调用不重复执行；rejection 不自动重试。

```ts
export declare const noop: () => undefined;
export declare function once<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => TResult
): (...args: TArgs) => TResult;
export declare function onceAsync<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult>;
```

`once`/`onceAsync` 对首次调用的参数做普通调用时捕获，不缓存或比较后续参数；不透传动态 `this`。`onceAsync` 只接受返回原生 Promise 的函数，运行时返回非 Promise/thenable时以一个缓存 rejected Promise 报 `INVALID_ARGUMENT`，从而保证公开 Promise identity。

### 4.7 Config 值图原语

- **UT-R044 Ownership/admission**：`ownConfig(root, options)` 接受且只接受 plain/null-prototype record root，单次读取 data descriptor 后建立带运行时 WeakSet brand + WeakMap metadata 的 `IOwnedConfig<T>`；metadata固定 normalized profile/limits。输入后续 mutation不影响结果；重复 own 一个 options省略或与 metadata相同的 owned root返回 exact instance，显式不同 options抛 `CONFIG_CONFLICT`。默认 `data` profile接受 primitive、array、plain/null-prototype record、Date、RegExp、Map、Set；`richRuntime`额外接受 custom prototype、callable/constructable、sync/async iterator与Promise/thenable，并用于plugin-host等价迁移。两种 profile都拒绝 accessor、root symbol key、dangerous key和无法可靠复制的 non-configurable callable own property；nested symbol data property被保留。unsupported/hostile trap必须抛 `CONFIG_UNSUPPORTED` 并保留 cause，不存在 best-effort降级。
- **UT-R045 Readonly facade**：`readonlyConfig(owned)`只接受运行时已brand的`IOwnedConfig<T>`，否则抛`CONFIG_UNSUPPORTED`；返回递归`IReadonlyConfig<T>`。同一owned node跨root/get调用得到稳定facade identity，cycle/shared identity保持。property assignment/define/delete/setPrototype、Date setter、Map/Set mutator与已知iterator mutation均抛原生TypeError + `CONFIG_READONLY`；RegExp `exec/test`在临时clone上执行，原`lastIndex`不变。custom callable/method使用owned receiver执行，参数不替调用者clone，返回/resolve/yield的object/function先纳入owned clone再readonly-wrap；throw/reject保持exact error。它只阻止经facade的结构mutation，不限制函数闭包、private slot或外部I/O。
- **UT-R046 COW patch**：`patchConfig(base, patch, options?)`只做**root-level shallow overlay**，不递归merge。base必须owned，patch必须plain/null-prototype record且按base metadata admission；options省略时继承base metadata，显式profile不同则`CONFIG_CONFLICT`，limits只能进一步收紧。`CONFIG_DELETE`删除root key。默认`reuseUnchangedRoot:true`：空patch或所有patch value与base对应value `Object.is`相等且无delete时返回exact base；`false`时即使空patch也创建新root，用于保持plugin-host当前每次update产生新root/facade的可观察行为。需要新root时只复制root及为重定向root-reference必需的节点，未变化且不能到达旧root的subtree保持exact identity。cycle/shared edge与指向旧root的edge重定向到新root；patch值先隔离再发布；失败不发布半成品。
- **UT-R047 Path**：`parseConfigPath(path)` 固定兼容 plugin-host 现有 grammar：以 `.` 分段，每段只能是非空普通key或完整 `^\[(\d+)\]$`，bracket段规范化为数字字符串；不支持escape、`a[0]`或空段。`__proto__`/`prototype`/`constructor`、超长path/segment fail closed。返回frozen readonly segment array。`readConfigPath(config,pathOrSegments)`返回`IConfigReadResult`判别union，区分missing与value `undefined`；命中object/function返回相同graph的readonly facade，每个property descriptor/value至多读取一次。plugin-host兼容wrapper继续把missing投影为`undefined`并返回mutable segment copy，保持其旧public contract。
- **UT-R048 Full combiner**：`combineConfig(sources, options)`按输入顺序组合零个或多个owned root并返回owned root。有效profile：零source为options.profile或data；非空且options.profile省略时要求所有source metadata profile相同；显式profile也必须与每个source相同，混用抛`CONFIG_CONFLICT`。有效limits为options收紧值或所有source逐字段最小值。零source返回branded empty null-prototype root；单source在策略/limits/profile均未改变且无path rule/resolver时返回exact source。默认：record递归merge，array/Map/Set/Date/RegExp/callable/opaque replace，undefined assign，symbol data key保留，dangerous key拒绝；后源胜出。显式策略覆盖record `merge|replace`、array `replace|concat|mergeByIndex`、Map `replace|merge`、Set `replace|union`、undefined `ignore|assign`。Map merge按SameValueZero key冲突、Set union按SameValueZero去重；所有引入的object key/value保持源内alias。`CONFIG_DELETE`只在record key、array index和Map value position有删除语义，在root/source/Set中出现为`CONFIG_CONFLICT`。path rule以PropertyKey segment prefix匹配，最长prefix优先、同长度按登记顺序；rule覆盖全局策略。`onConflict`仅在选定策略无法自动决定leaf collision时调用一次，返回公开同步decision；thenable/非法decision抛`CONFIG_CONFLICT`。任一失败原子放弃candidate。
- **UT-R049 Config 防护与复杂度**：config graph engine 必须 identity 去重、显式 work queue、O(nodes+edges)，并支持有限正安全整数 `maxDepth/maxNodes/maxKeys`。禁止 prototype pollution、重复 getter/then 读取、递归栈溢出、跨调用缓存泄漏和对源 graph 的 mutation；错误必须保留 path、operation、原 cause 和 package error identity。

固定公开边界：

```ts
export const ConfigProfile = { data: 'data', richRuntime: 'richRuntime' } as const;
export const CONFIG_DELETE: unique symbol;
export type IConfigProfile = (typeof ConfigProfile)[keyof typeof ConfigProfile];
export type IConfigRecord = Record<PropertyKey, unknown>;
declare const ownedConfigBrand: unique symbol;
export type IOwnedConfig<T extends IConfigRecord> = T & { readonly [ownedConfigBrand]: true };
export type IAnyFunction =
  ((...args: never[]) => unknown) | (abstract new (...args: never[]) => unknown);
export type IReadonlyCallable<T> = T extends (...args: infer TArgs) => infer TResult
  ? (...args: TArgs) => IReadonlyConfig<TResult>
  : unknown;
export type IReadonlyConstructable<T> = T extends abstract new (
  ...args: infer TArgs
) => infer TResult
  ? abstract new (...args: TArgs) => IReadonlyConfig<TResult>
  : unknown;
export type IReadonlyDate = Omit<
  Date,
  | 'setDate'
  | 'setFullYear'
  | 'setHours'
  | 'setMilliseconds'
  | 'setMinutes'
  | 'setMonth'
  | 'setSeconds'
  | 'setTime'
  | 'setUTCDate'
  | 'setUTCFullYear'
  | 'setUTCHours'
  | 'setUTCMilliseconds'
  | 'setUTCMinutes'
  | 'setUTCMonth'
  | 'setUTCSeconds'
  | 'setYear'
>;
export type IReadonlyRegExp = Readonly<RegExp>;
export type IReadonlyConfig<T> = T extends IAnyFunction
  ? IReadonlyCallable<T> & IReadonlyConstructable<T>
  : T extends PromiseLike<infer TValue>
    ? PromiseLike<IReadonlyConfig<TValue>>
    : T extends Date
      ? IReadonlyDate
      : T extends RegExp
        ? IReadonlyRegExp
        : T extends Map<infer TKey, infer TValue>
          ? ReadonlyMap<IReadonlyConfig<TKey>, IReadonlyConfig<TValue>>
          : T extends Set<infer TValue>
            ? ReadonlySet<IReadonlyConfig<TValue>>
            : T extends readonly unknown[]
              ? { readonly [K in keyof T]: IReadonlyConfig<T[K]> }
              : T extends object
                ? { readonly [K in keyof T]: IReadonlyConfig<T[K]> }
                : T;
export type IConfigLimits = {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxKeys: number;
  readonly maxPathLength: number;
  readonly maxSegmentLength: number;
};
export type IOwnConfigOptions = {
  readonly profile?: IConfigProfile;
  readonly limits?: Partial<IConfigLimits>;
};
export type IConfigPatch<T extends IConfigRecord> = {
  readonly [K in keyof T]?: T[K] | typeof CONFIG_DELETE;
} & Readonly<Record<PropertyKey, unknown>>;
export type IConfigPatchOptions = IOwnConfigOptions & { readonly reuseUnchangedRoot?: boolean };
export type IConfigReadResult =
  { readonly kind: 'missing' } | { readonly kind: 'value'; readonly value: unknown };
export type IConfigMergeStrategies = {
  readonly record: 'merge' | 'replace';
  readonly array: 'replace' | 'concat' | 'mergeByIndex';
  readonly map: 'replace' | 'merge';
  readonly set: 'replace' | 'union';
  readonly undefined: 'ignore' | 'assign';
};
export type IConfigConflictDecision =
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'value'; readonly value: unknown };
export type IConfigConflictContext = {
  readonly path: readonly PropertyKey[];
  readonly left: unknown;
  readonly right: unknown;
};
export type IConfigPathRule = {
  readonly prefix: readonly PropertyKey[];
  readonly strategies: Partial<IConfigMergeStrategies>;
};
export type IConfigCombineOptions = IOwnConfigOptions & {
  readonly strategies?: Partial<IConfigMergeStrategies>;
  readonly pathRules?: readonly IConfigPathRule[];
  readonly onConflict?: (context: IConfigConflictContext) => IConfigConflictDecision;
};
export declare function ownConfig<T extends IConfigRecord>(
  value: T,
  options?: IOwnConfigOptions
): IOwnedConfig<T>;
export declare function readonlyConfig<T extends IConfigRecord>(
  owned: IOwnedConfig<T>
): IReadonlyConfig<T>;
export declare function patchConfig<T extends IConfigRecord>(
  base: IOwnedConfig<T>,
  patch: IConfigPatch<T>,
  options?: IConfigPatchOptions
): IOwnedConfig<T>;
export declare function parseConfigPath(
  path: string,
  limits?: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'>
): readonly string[];
export declare function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult;
export declare function combineConfig(
  sources: readonly IOwnedConfig<IConfigRecord>[],
  options?: IConfigCombineOptions
): IOwnedConfig<IConfigRecord>;
```

默认 limits 固定为 `maxDepth=256`、`maxNodes=100_000`、`maxKeys=1_000_000`、`maxPathLength=4_096`、`maxSegmentLength=512`；override 必须为正安全整数且不能超过默认值，避免调用方意外解除资源上限。`maxDepth` 以 root=0 计，`maxNodes` 按首次 identity 访问计，`maxKeys` 按所有容器被检查的 own key/entry/value 总数计；恰好达到上限合法，下一项抛 `CONFIG_LIMIT_EXCEEDED`。

## 5. 生命周期与错误语义

### 5.1 状态、取消与 deadline

Promise control 统一状态为 `idle → running → settled`；limiter 为 `open → closing → terminal`。状态只前进。abort/timeout/operation settle 使用 first-observed-wins；检查 signal 后注册 listener，再复查 signal，关闭 check→subscribe race。

- `timeoutMs=0` 是立即到期，不执行 lazy operation。
- timeout只abort utils自有native `AbortController`，不abort caller signal；宿主缺少AbortController时在启动operation前抛`ENV_UNSUPPORTED`。
- 单signal与signals互斥；signals数组在入口浅拷贝并按index注册。首个observed external abort原因通过`UtilsAbortError.cause`保持`=== reason`；无reason不伪造cause，其余signal只清理不改winner。
- signal `aborted`/listener accessor或调用在winner产生前失败时，以exact hostile error拒绝并回滚已注册listener；winner确定后读取`reason`失败时，以该getter error为cause创建`UtilsAbortError`，不改为“无reason”。remove/cancel失败按§5.1 cleanup规则处理。
- total timeout 与 attempt timeout 分离；total deadline 在 retry entry 计算一次，后续 attempt 使用剩余预算。
- late operation 继续被观察但不改变已 settle 的公开 Promise。
- timer cancel/listener removal的cleanup failure不能替换primary：公开结果settle前发生时，若尚无primary则该cleanup error成为rejection；已有primary则以`AggregateError([primary, cleanup...])`拒绝且primary排第一。公开结果settle后发生时，必须交给入口已snapshot的有效reporter；未传custom report时使用hostRethrowReporter，不存在静默分支。

### 5.2 Error policy

| 场景                        | throw                                                                        | collect                   | report                         | firstError          |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------- | ------------------------------ | ------------------- |
| 参数/环境非法               | 同步 throw tagged native TypeError/RangeError                                | 不适用                    | 不适用                         | 该错误              |
| operation/retry policy 失败 | Promise reject exact 原错误                                                  | retry 仅记录当前 attempt  | late/secondary 走有效 reporter | first-observed      |
| 多 cleanup 失败             | primary 保持第一项，AggregateError 按发生顺序                                | 全部保留                  | reporter 每项最多一次          | 不被 secondary 替换 |
| limiter 多 task 失败        | 各 run Promise 独立 reject                                                   | dispose 只等待 settlement | 不代替调用方 Promise           | 每 task 自有        |
| reporter 自身失败           | settle 前作为 secondary aggregate；settle 后由 host microtask uncaught throw | 不吞掉                    | reporter 每个调用至多一次      | 原 primary          |

### 5.3 Promise identity、重入与 isolation

- `deferred.promise`、`onceAsync` 首次 Promise、limiter `dispose()` Promise 必须保持 identity。
- `withTimeout`/`retry` 因控制组合返回新 Promise，不承诺 operation Promise identity。
- 每个 invocation 的 controller/timer/listener/attempt state 独立；无 module-level 可变请求态。
- concurrency limiter 之间队列隔离；close 一个 limiter 不影响其他 limiter或全局 scheduler。
- partial construction 失败必须撤销已登记 listener/timer/queue record；rollback 错误不替换 original。

### 5.4 Config ownership、事务与错误语义

配置状态为 `external → owned → readonly-view`；更新事务为 `idle → building → committed|failed`。只有 complete candidate 可成为返回值，失败事务不得改变 base、sources、patch 或已存在 facade。

- owned graph 是 mutation boundary；readonly facade 不是 ownership boundary，也不通过冻结调用者输入制造假隔离。
- `patchConfig`/`combineConfig` 同步执行；conflict resolver 返回 thenable 视为 `CONFIG_CONFLICT`，避免异步回调造成中间 graph 外泄或提交时序不确定。
- runtime ownership brand 与 readonly facade cache 以一次 owned graph/组合结果为隔离域；不同根不得通过 module-global cache 意外共享 capability。brand 只由 `ownConfig`、`patchConfig`、`combineConfig` 产生，structured clone/序列化后必须重新 own。
- Promise/thenable 在 `richRuntime` profile 中只暴露缓存的 readonly continuation facade；不得修改原 thenable，也不承诺 facade 与原 Promise identity 相等。
- mutation attempt 抛保留原生 TypeError 的 tagged `CONFIG_READONLY`；非法 path、unsupported value、策略冲突、limit 超限分别使用 R024 的稳定 code/text。`readConfigPath` 的 missing 是状态返回，不抛 error code。
- resolver/getter/trap/iterator 失败保留 exact 原错误为 cause；若候选 rollback 同时失败，原错误为 primary，rollback errors 依次进入 `AggregateError.errors`，不得替换 primary。

## 6. 迁移与实施批次

每个批次严格执行：`inventory → red test → contract/error registration → implementation → delete duplicate/compatibility path → docs/exports/dependencies → package gates → direct-consumer gates → repository gates → evidence`。批次均属于同一次交付。

### 6.1 可执行 gate catalog

命令从 workspace root 运行，均设置 `CI=true`；以下是当前 package.json 已存在脚本，缺失脚本不得替代或记为通过。

- `G-UTILS`：`pnpm --filter @migaia/utils fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build` → `release:pack` → `make utils-check`。`release:patch`和真实publish是交付动作，不作为验证gate执行。
- `G-STANDARD(<pkg>)`：`pnpm --filter <pkg> fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build`。适用于 lifecycle、serialize、middleware-pipeline、event-subscriber、capability、reactive、resource、plugin-host 及全部 `store-*`；`plugin-host` 追加 `release:pack`。
- `G-WEB-RPC`：fmt → lint → typecheck → typecheck:core → typecheck:node-adapter → typecheck:test → typecheck:e2e → test → build → test:e2e → release:pack。
- `G-LOGGER`：fmt → lint → typecheck → typecheck:test → typecheck:browser → test → build → test:e2e → release:pack。
- `G-STORAGE-WEB`：fmt → lint → typecheck → typecheck:test → typecheck:e2e → test → build → test:e2e → release:pack。
- `G-STORE-E2E(<pkg>)`：在 `G-STANDARD` 后追加该包存在的 `typecheck:e2e → test:e2e`；适用于 store-indexed/keyed/light/react/worker，store-worker 按其脚本顺序在 test 后执行 `typecheck:e2e → test:e2e`。
- `G-ROOT`：`pnpm fmt` → `pnpm lint` → `pnpm typecheck` → `pnpm typecheck:consumers` → `pnpm test` → `pnpm build`。根不存在 `typecheck:test`，证据中必须记为 absent，不能写 passed。
- `G-ISOLATED`：`pnpm --filter @migaia/utils release:pack` 后，在 `mktemp -d` 创建 Node ESM、browser bundler 和 types-only 三个 fixture，从 tarball 安装；执行 fixture typecheck/runtime/bundle-size/import scan，禁止 workspace link。

批次引用 catalog 名称即引用上述完整有序命令，但仍必须逐批写明 package/direct/repository gate；任何命令失败立即保持当前条款为 red/implemented-unverified，不继续删除 compatibility path。

### UT-B00：冻结清单与行为 baseline

- 前置：无。
- 范围：24 包、root fixtures/Makefile、相关 SDD。
- 操作：记录 dirty status/diff；生成 timeout/retry/error tag/Base64/UTF-8/clone/config ownership/readonly/COW/path/combine/once/deferred 定义与消费者清单；记录现有 package gates 和行为消息/错误 identity。
- Red：UT-T001、UT-T002 的 architecture fixture 先失败，证明包/exports 尚不存在。
- Package/direct/repository gates：只读运行全部受影响包现有 test 与 `G-ROOT`，失败按 existing defect/environment failure 登记，不在本批修复；保存命令、计数、日期、SHA/dirty diff stat。
- Exit：清单按“迁移/保留领域实现/删除”逐项定责；任何未知 owner 阻断 UT-B01。

### UT-B01：契约、错误注册、包骨架与发布入口

- 前置：UT-B00 inventory/evidence verified。
- 文件：`packages/utils/package.json`、tsconfig/vite、根加六个 subpath entry、`error-code.ts`、`error-text.ts`、README/USEGUIDE；根 `package.json`、Makefile、consumer fixtures、lockfile；更新 runtime-neutrality/lifecycle/serialize/error registry SDD。
- Red：UT-T001～UT-T006。
- 实现边界：只建类型、错误、exports/build/release 骨架，不先放 placeholder implementation。
- Package gates：utils `fmt → lint → typecheck → typecheck:test → test → build → release:pack`。
- Direct/repository gates：`G-ISOLATED`、`G-ROOT`；此时消费者只验证入口可解析，不添加 production dependency。
- Exit：tarball只含声明文件、产物、README/USEGUIDE；Node/browser isolated fixtures可解析所有入口；Makefile/`RELEASE_PACKAGES`新增`utils-check/utils-patch/utils-publish`，gate只执行`utils-check`和`pnpm --filter @migaia/utils publish --dry-run --access restricted --ignore-scripts --no-git-checks`，不得执行会改version/commit/push/tag的patch或真实publish。

### UT-B02：error、function、object 全量实现

- 前置：UT-B01 verified。
- 文件：`src/error/*`、`src/function/*`、`src/object/*` 及 tests。
- Red：UT-T010～UT-T022。
- 实现：先 error identity/cause，再 once/noop，再 probe/clone；所有 stable text 入 `error-text.ts`。
- Package/direct/repository gates：`G-UTILS` → `G-ISOLATED`（error/function/object subpath）→ `G-ROOT`。
- Exit：hostile Proxy/getter、frozen error、cycle、reentrancy、Promise identity 全部通过；无 timer/DOM/Node import。

### UT-B02A：config 六层与完整 combiner

- 前置：UT-B02 verified；编号为后加稳定 ID，不重编号既有 B03～B09。
- 文件：`src/config/{policy,graph,ownership,readonly,patch,path,combiner}.ts`、`src/config.ts` 及 config tests。
- Red：UT-T062～UT-T069。
- 实现顺序：policy/limits → 统一 graph engine → own → readonly → COW patch → path → combiner；不得先复制 plugin-host 整文件再长期保留双 owner。
- Package/direct/repository gates：`G-UTILS` → `G-ISOLATED`（config/data+richRuntime）→ plugin-host baseline test（尚未改 dependency）→ `G-ROOT`。
- Exit：data/richRuntime profiles、receiver hardening、cycle/shared/root rebase、结构共享、策略矩阵、删除哨兵、冲突 rollback、复杂度与污染防护全部通过；config subpath 不静态引入 promise。

### UT-B03：bytes/UTF-8 全量实现

- 前置：UT-B02A verified。
- 文件：`src/bytes/*` 及 property/vector tests。
- Red：UT-T030～UT-T036。
- 实现：Base64 canonical codec、stream chunks、UTF-8 encode/decode/length/split；使用 fast-check 与标准向量，不使用宿主 codec 作为 production fallback。
- Package/direct/repository gates：`G-UTILS` → `G-ISOLATED`（bytes subpath）→ serialize/storage-web/web-rpc 当前 wire baseline → `G-ROOT`。
- Exit：大输入、offset view、invalid trailing bits、surrogate/malformed sequence、复杂度门禁通过。

### UT-B04：scheduler、deferred、sleep、withTimeout

- 前置：UT-B03 verified。
- 文件：`src/promise/scheduler.ts`、`deferred.ts`、`sleep.ts`、`timeout.ts`。
- Red：UT-T040～UT-T050。
- 实现：先 manual scheduler 使其余测试零真实时间；再 race-safe listener/timer cleanup。
- Package/direct/repository gates：`G-UTILS` → `G-ISOLATED`（promise subpath）→ lifecycle/logger/web-rpc 当前 scheduler/timeout baseline → `G-ROOT`。
- Exit：pre-abort、timeout=0、同步 scheduler、cleanup throw、late rejection、unhandled rejection probe 全通过。

### UT-B05：retry 与 concurrency limiter

- 前置：UT-B04 verified。
- 文件：`src/promise/retry.ts`、`concurrency-limiter.ts`。
- Red：UT-T051～UT-T061。
- 实现：retry 只组合 UT-B04 原语；limiter 使用 O(1) linked queue/ring queue，不复制 lifecycle mutation queue。
- Package/direct/repository gates：`G-UTILS` → `G-ISOLATED`（retry/limiter）→ web-rpc/resource/logger 当前 retry baseline → `G-ROOT`。
- Exit：total/attempt deadline、policy/delay error、无隐式随机源、close/dispose race、FIFO、queued abort、active failure/idle identity 通过。

### UT-B06：基础 owner 迁移

- 前置：UT-B05 verified；lifecycle/serialize/middleware-pipeline/event-subscriber baseline green 或已分类 existing defect。
- `lifecycle`：scheduler/abort/bounded wait 委托 utils；保持旧 exports、source/code/message、manual scheduler 行为；更新 package dependency、SDD、tests。禁止形成 utils↔lifecycle cycle。
- `serialize`：Base64/UTF-8纯算法改从utils/bytes re-export/消费；`serialize/core`不再保留第二套实现；按R072先更新其linked SDD。serialize package保留registry→lifecycle依赖并新增utils，core transitive graph只允许utils/bytes且零上层依赖。
- `middleware-pipeline`、`event-subscriber`：机械 error identity 改用 utils/error；不得引入 promise/lifecycle。
- Red：UT-T070～UT-T075。
- Package gates：`G-UTILS` → `G-STANDARD(@migaia/lifecycle)` → `G-STANDARD(@migaia/serialize)` → `G-STANDARD(@migaia/middleware-pipeline)` → `G-STANDARD(@migaia/event-subscriber)`。
- Direct/repository gates：serialize registry/storage codec/SSR fixtures → `G-ISOLATED` → `G-ROOT`。
- Exit：原 public exports 与 direct consumer 行为等价，旧 production 算法删除。

### UT-B07：异步消费者迁移

- 前置：UT-B06 verified；各目标包 baseline 与 timeout/retry/wire/error message fixture已冻结。
- `web-rpc`：`internal/async-control.ts`、`retry.ts`、UTF-8 helper 迁到 utils；保留 RPC policy/error wrapper，不保留第二套 timer/race/retry engine。
- `resource`：只迁 cancellable delay/scheduler mechanics；保留 Suspense、generation 与 retry state machine。
- `logger`：process/http/drain/batch 使用 utils/lifecycle canonical primitives；保持 process exit、flush single-flight、deadline 和 unref 行为。
- `storage-web`：两处 extension/migration abort race 复用 utils Promise primitive；保持 storage error translation、reporter 与 IndexedDB lifecycle。
- `store-ssr`：race outcome 组合 utils primitive，保留 value/disposed/timeout union。
- Red：UT-T076～UT-T083、UT-T097。
- Package gates：`G-WEB-RPC` → `G-STANDARD(@migaia/resource)` → `G-LOGGER` → `G-STORAGE-WEB` → `G-STANDARD(@migaia/store-ssr)`。
- Direct/repository gates：storage-web→store-persist、web-rpc transports、logger process/browser、SSR direct fixtures → `G-ISOLATED` → `G-ROOT`。
- Exit：各包 package gate + Node/browser/Worker/E2E direct gates 通过，且 source search 无等价第二实现。

### UT-B08：错误、clone、bytes 与局部 helper 全仓迁移

- 前置：UT-B07 verified；每个目标 helper 有 inventory disposition 和 red migration case。
- errors：`capability`、`reactive`、`resource`、`serialize`、`plugin-host`、`logger`、`web-rpc`、`middleware-pipeline`、`event-subscriber`、`store-devtools/indexed/keyed/light/middleware/persist/react/shared/ssr/wasm/worker` 的机械 tag 改用 utils/error；包级 factory/code/text 保留。
- clone：`store-middleware`/`store-devtools` 消费 utils/object 三策略并保留包级错误翻译；`store-keyed` strict initial clone 只在行为逐项相等后迁移；storage key clone 不迁。
- bytes：删除 `storage-web/src/utils/base64.ts`；key/codec 改用 utils/bytes；`web-rpc/internal/chunk.ts` 只保留 protocol assembler。
- function/test helper：等价 once/noop/deferred 改用 utils；不迁有领域 state 的 once guard。
- config：将`plugin-host/src/config.ts`的owned copy、readonly facade、COW patch、path engine改为utils/config消费；plugin-host保留admission profile选择、mutation queue、transaction rollback、manifest/领域错误，并固定`richRuntime`、`reuseUnchangedRoot:false`、legacy path/missing投影。迁移前冻结callable/constructable、Map/Set subclass、Date/RegExp、iterator/async iterator、Promise/thenable、空update root identity、cycle/root rebase与prototype-pollution baseline；任何未被R071授权的差异都必须先新增“旧/新/影响/兼容/专测”条款，禁止借迁移静默改变。
- Red：UT-T084～UT-T096；其中 UT-T092～095 必须在修改 plugin-host dependency/implementation前先红，UT-T096必须先用当前atob行为证明旧/新差异。
- Package gates：`G-UTILS` → `G-STANDARD` 覆盖 capability/reactive/plugin-host/middleware-pipeline/event-subscriber 及全部受影响 store 包 → `G-STORE-E2E` 覆盖存在 E2E 脚本的 store 包 → `G-WEB-RPC` → `G-LOGGER` → `G-STORAGE-WEB`。
- Direct/repository gates：plugin-host config baseline/transaction suite、storage wire、store clone/error consumers → `G-ISOLATED` → `G-ROOT`。
- Exit：每个删除项有consumer test；plugin-host config direct gates UT-T092～UT-T095闭合；无internal compatibility wrapper遗留，public零逻辑边界符合D007/D008；package.json/lockfile/exports/docs同步。

### UT-B09：发布、消费者与 repository closure

- 前置：UT-B00～UT-B08 全部 verified，无 compatibility path 等待删除。
- 顺序：`G-UTILS` → pack/content audit → `G-ISOLATED` → 所有 `G-STANDARD/G-WEB-RPC/G-LOGGER/G-STORAGE-WEB/G-STORE-E2E` → `G-ROOT` → hostile review → evidence。
- 发布前验证从临时 tarball 安装，而不是 workspace symlink；验证 ESM exports、declaration、tree-shaking、无隐式 Node/DOM types。
- Exit：UT-R/D/MI 与 UT-T 正反向闭合；无 high finding；所有中低风险分类并有 owner。

## 7. 测试与验收矩阵

### 7.1 TDD 文件归属与 red 规则

- `packages/utils/test/architecture.test.ts`：UT-T001、UT-T003、UT-T022、UT-T050、UT-T061；只做 import graph/AST/bundle allowlist，不以字符串包含冒充行为证明。
- `packages/utils/test/package-exports.test.ts` 与 `fixtures/consumers/*`：UT-T002、UT-T004～UT-T006、UT-T095。
- `packages/utils/test/error.test.ts`：UT-T010～UT-T014；`function.test.ts`：UT-T015～UT-T017；`object.test.ts`：UT-T018～UT-T021。
- `packages/utils/test/bytes.test.ts`：UT-T030～UT-T036；property case 固定 seed 并在失败证据记录 seed/path。
- `packages/utils/test/promise.test.ts`：UT-T040～UT-T054；`concurrency-limiter.test.ts`：UT-T055～UT-T061。竞速默认使用 manual scheduler；UT-T045/046/048另启Node process fixture观察handle、unhandledRejection、uncaughtException，UT-T097放web-rpc process fixture复用同一host-observation harness。
- `packages/utils/test/config.test.ts`：UT-T062～UT-T069；property generator必须生成 cycle、alias、root-reference、Map object key、Set object value、symbol、sparse array和深/宽边界。
- 迁移 case UT-T070～UT-T094、UT-T096、UT-T097 存放在 owning consumer 的 `test/`，以迁移前冻结 fixture + 迁移后 assertion构成；不得全部放入 utils test后仅断言 helper被调用。跨包 source scan放 root `fixtures/consumers/architecture/`。
- UT-T090 是 gate evidence，不伪装成 unit test；UT-T091 使用 §9.3 hostile checklist逐项记录 pass/finding/owner。两者仍是可复现验收 case。

Red case必须在 production实现/依赖改动前失败，失败原因必须命中目标行为而非“模块不存在/类型未导出”之外的偶然错误；同一 case green后才允许删除对应 duplicate。测试时禁止真实 sleep，除 UT-T045/046/048 的隔离 process fixture且每例 wall-clock上限2秒。

### 7.2 Case 矩阵

| ID      | 层级                      | 明确断言                                                                                                                                            | 映射                               |
| ------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| UT-T001 | architecture              | utils 零 production dependency，源码不 import workspace/Node/DOM/Store/Worker                                                                       | R001、R006、D001                   |
| UT-T002 | package                   | 根与六 subpath 在 isolated fixture typecheck/runtime 均可解析                                                                                       | R002、R003、R010、D012             |
| UT-T003 | bundle                    | 每个 subpath bundle 仅包含 D006 allowlist 域且无 workspace/adapter，root 可 tree-shake                                                              | R003、D006                         |
| UT-T004 | package                   | package metadata、sideEffects、files、ESM、`.js` specifier、named type 规则正确                                                                     | R008、R010                         |
| UT-T005 | docs                      | README/USEGUIDE每个public export至少一个编译示例，关键Promise/config/strict-Base64示例运行且警示语存在                                              | R007                               |
| UT-T006 | release                   | pack内容、Makefile utils target/allowlist正确；check与publish --dry-run通过，patch/真实publish仅静态审计未执行                                      | R001、R010、MI010                  |
| UT-T010 | unit                      | attach identity 同实例、幂等、原生类型/stack/cause/errors 不变；冲突/frozen 保留 cause                                                              | R020、R024、D004                   |
| UT-T011 | unit                      | toError 对 Error exact passthrough，非 Error cause identity 可达，hostile String 只调用一次                                                         | R021、R024                         |
| UT-T012 | unit/property             | cause walker 有界、去重、顺序稳定，hostile getter 作为失败项                                                                                        | R022                               |
| UT-T013 | unit                      | combine 0/1/N、顺序、identity、iterable throw 行为正确                                                                                              | R023                               |
| UT-T014 | unit                      | Utils error classes/code/type guard、native subclass、source、exact canonical text/factory与注册表一致                                              | R024、R025                         |
| UT-T015 | unit                      | once 缓存 return/throw exact identity，运行中重入不重复调用                                                                                         | R050                               |
| UT-T016 | unit                      | onceAsync 并发复用 exact Promise，sync throw 只转一次 rejection                                                                                     | R052                               |
| UT-T017 | unit                      | noop identity 稳定、无分配可观察副作用                                                                                                              | R051                               |
| UT-T018 | unit                      | plain object/null prototype/cross realm/array/class/hostile prototype 分类                                                                          | R040                               |
| UT-T019 | unit                      | probeProperty 区分 missing/undefined/failed，getter 单读且 receiver 正确                                                                            | R041、D010                         |
| UT-T020 | unit                      | 三种 snapshot policy 的 independent/identity/{value,diagnostics} 保证不混淆                                                                         | R042、D011                         |
| UT-T021 | property/adversarial      | cycle/shared/sparse/symbol/**proto**/accessor/proxy 的 path diagnostic 与 identity fallback 正确                                                    | R043                               |
| UT-T022 | architecture              | object/function/error 域无 promise timer 或跨域循环                                                                                                 | R006、D006                         |
| UT-T030 | vector                    | RFC Base64 标准向量、canonical padding 和 roundtrip                                                                                                 | R030                               |
| UT-T031 | adversarial               | whitespace、alphabet、padding、length、trailing bits 非法均拒绝                                                                                     | R030、R024                         |
| UT-T032 | property                  | empty无chunk、默认32763-byte边界、合法override、拼接等于单次编码且只有末块padding                                                                   | R031                               |
| UT-T033 | vector                    | UTF-8 ASCII/BMP/astral/surrogate encode/decode/length 与标准一致                                                                                    | R032                               |
| UT-T034 | adversarial               | malformed UTF-8 replacement/fatal、offset view 正确                                                                                                 | R032、R033                         |
| UT-T035 | property                  | split 不切 code point、不超预算、拼接还原；非法 maxBytes 拒绝                                                                                       | R032                               |
| UT-T036 | complexity                | 多 MB 输入线性完成，无参数/栈溢出和共享 buffer                                                                                                      | R005、R033                         |
| UT-T040 | unit                      | manual advance/FIFO/新增due task/callback throw/pendingCount/10000边界，system同步callback、cancel/unref、宿主无unref                               | R011、D002、MI003                  |
| UT-T041 | unit                      | deferred first-settlement 与 resolver 行为等同 native Promise                                                                                       | R012                               |
| UT-T042 | unit                      | sleep timer/abort race、pre-abort、cleanup exactly once                                                                                             | R013、R017                         |
| UT-T043 | unit                      | withTimeout lazy、0ms skip不启动/start先timer后factory、operation/多signal/timeout first wins、unref hint                                           | R014                               |
| UT-T044 | adversarial               | options/scheduler/task方法单读保receiver，signal aborted严格双读/reason winner后单读，hostile then与同步settle不泄漏                                | R017                               |
| UT-T045 | process                   | timer winner/loser 均无残留 handle/listener                                                                                                         | R013、R014、R017                   |
| UT-T046 | process                   | late rejection 被观察并由有效 reporter 每错误报告一次，无 unhandledRejection                                                                        | R014、R017                         |
| UT-T047 | unit                      | external abort reason 与 timeout error identity/cause 保留                                                                                          | R014、R024、MI004                  |
| UT-T048 | adversarial/process       | late/cleanup各report一次；省略report或custom reporter抛错均由hostRethrowReporter形成uncaught且不改公开结果                                          | R014、R017、MI005                  |
| UT-T049 | unit                      | settle 前 cleanup failure 单独 reject或以 primary-first AggregateError reject                                                                       | R017、MI006、MI007                 |
| UT-T050 | architecture              | promise mechanics 不含 scope/generation/resource/Store 逻辑                                                                                         | D002、D009                         |
| UT-T051 | unit                      | retry串行attempt、显式maxAttempts、默认/custom reporter、exact final/policy error、shouldRetry调用资格                                              | R015                               |
| UT-T052 | unit                      | number/function delay调用次数顺序、参数、非法返回；无隐式 jitter/random                                                                             | R015                               |
| UT-T053 | unit                      | external abort/total不重试；attempt timeout按policy；同dueAt total先赢；剩余预算≤0与同步scheduler的skip/start确定                                   | R015、MI003、MI004                 |
| UT-T054 | adversarial               | sync throw、then getter、policy getter、delay abort、late reject 无泄漏                                                                             | R015、R017                         |
| UT-T055 | unit                      | limiter FIFO、并发上限、lazy start、计数与 O(1) queue                                                                                               | R016、R005                         |
| UT-T056 | unit                      | pre/queued abort exact reason（undefined时单例AbortError）、只移除对应项；active继续且收到原signal                                                  | R016                               |
| UT-T057 | unit                      | close/dispose先调用者固定 exact reason、后续不同reason忽略、拒绝新/queued、active自然完成                                                           | R016                               |
| UT-T058 | unit                      | dispose Promise identity、已idle/有active/清空queue三路径、task failure只落对应run Promise                                                          | R016、MI006                        |
| UT-T059 | unit                      | whenIdle 当前 epoch identity、已idle模块级Promise、重入enqueue/close不双settle且microtask顺序确定                                                   | R016、R017                         |
| UT-T060 | property                  | 随机任务时序始终满足 active≤limit、每任务至多开始一次                                                                                               | R016                               |
| UT-T061 | architecture              | limiter 不复制 lifecycle mutation policy/scope/lease                                                                                                | D009                               |
| UT-T062 | unit/property             | ownConfig root/admission、runtime brand+metadata、同options重复identity/不同options冲突、源隔离、cycle/shared/order准确                             | R044、D013、D016                   |
| UT-T063 | adversarial               | readonly拒绝伪 brand/所有结构 mutation；facade identity、cycle、Date/RegExp/Map/Set/custom receiver正确                                             | R045、D017、MI011                  |
| UT-T064 | adversarial               | callable/constructable/iterator/Promise 的返回/resolve/yield被own+wrap，throw/reject exact；不宣称sandbox                                           | R045、D017、MI011                  |
| UT-T065 | unit/property             | COW空patch默认exact/compat新root、未变subtree共享、变化ancestor复制、cycle/root edge rebase、patch隔离                                              | R046、D016、MI012                  |
| UT-T066 | unit/adversarial          | legacy dot/完整 bracket grammar、frozen segments、missing/undefined、单读、a[0]/escape/空段/dangerous key/limit fail closed                         | R047、R049、MI014                  |
| UT-T067 | table/property            | combiner 零/单source identity、profile/limits兼容、容器/undefined/symbol/delete/SameValueZero/path最长前缀策略确定                                  | R048、D014、D015、MI013            |
| UT-T068 | adversarial               | conflict resolver 非法 decision/thenable/throw、getter/trap/iterator 失败均原子 rollback 且 cause 可达                                              | R048、R049、MI013                  |
| UT-T069 | complexity/security       | 默认/override limits 的等于上限与下一项、深链、宽图、prototype pollution、跨调用隔离满足线性与限额                                                  | R005、R049、D016                   |
| UT-T070 | migration                 | lifecycle scheduler/abort/boundedWait行为、code/message/type/identity与baseline相同，public task type不新增unref                                    | R060、D002、D008、MI001～MI005     |
| UT-T071 | migration                 | lifecycle 不再含第二套通用 scheduler/abort race 核心算法且无依赖环                                                                                  | R060、D001、D007                   |
| UT-T072 | migration                 | serialize Base64/UTF-8 exports/向量逐字兼容，core bundle只新增utils/bytes且无lifecycle/上层依赖，linked SER条款留历史                               | R064、R072、D003、D007、MI008      |
| UT-T073 | migration                 | middleware/event error tag 保持 source/code/native type/stack/cause                                                                                 | R065、D004、MI007                  |
| UT-T074 | direct consumer           | serialize registry、SSR、storage codec roundtrip 全通过                                                                                             | R064                               |
| UT-T075 | docs                      | runtime-neutrality/lifecycle/serialize/error registry owner 描述一致                                                                                | R069、D001～D005                   |
| UT-T076 | migration                 | web-rpc retry/timeout/UTF-8调用次序、0ms start、error、abort reason、unref与baseline相同                                                            | R061、MI001～MI005                 |
| UT-T077 | direct/E2E                | web-rpc core/node/browser/Worker transports 通过且无旧 async engine                                                                                 | R061                               |
| UT-T078 | migration                 | resource Suspense/generation 保留，只替换可取消 delay mechanics                                                                                     | R062、D009                         |
| UT-T079 | migration                 | logger shutdown/flush/http/batch deadline、single-flight、exit 顺序不变                                                                             | R063、MI001～MI006                 |
| UT-T080 | migration                 | storage extension/migration abort race保持0ms skip、reporter/error translation                                                                      | R066、MI004、MI007                 |
| UT-T081 | direct/E2E                | storage-web Chromium/WebKit 与 store-persist direct consumer 通过                                                                                   | R066                               |
| UT-T082 | migration                 | SSR outcome value/disposed/timeout、0ms已settle work优先与waterfall rounds不变                                                                      | R067、D009                         |
| UT-T083 | architecture              | source scan 无等价 Promise.race/timer/retry 第二实现；领域组合留有说明                                                                              | R061～R067、D007、D009             |
| UT-T084 | migration                 | 19+ 包机械 error tag 使用 utils，包级 error API/message/code 保持                                                                                   | R065、MI007                        |
| UT-T085 | migration                 | store-middleware/devtools clone 三策略与 hostile cases 等价                                                                                         | R068、D005、D011                   |
| UT-T086 | migration                 | storage-web 删除本地 Base64，key/codec wire bytes 逐字兼容                                                                                          | R064、D003、D007、MI008            |
| UT-T087 | migration                 | web-rpc chunk 只保留 protocol，UTF-8 helper 来自 utils                                                                                              | R064、D003                         |
| UT-T088 | migration                 | 等价 once/noop/deferred helper 删除；领域 guard 明确保留理由                                                                                        | R068、D007                         |
| UT-T089 | package graph             | 所有新增依赖只指向 utils，不形成 cycle/reverse dependency                                                                                           | R069、D001                         |
| UT-T090 | repository                | root fmt/lint/typecheck/typecheck:consumers/test/build 与 catalog package/release checks 全过                                                       | R069、MI010                        |
| UT-T091 | hostile review            | 边界、失败、race、幂等、误用、安全、metadata/docs 无 high finding                                                                                   | R069、MI001～MI014                 |
| UT-T092 | migration/direct          | plugin-host config既有/rich baseline等价，含空update新root、旧path mutable-copy/missing投影                                                         | R070、D005、D013、MI011～MI014     |
| UT-T093 | architecture              | plugin-host 不再含第二套 config graph/COW/readonly/path engine，仅保留领域编排或有删除条件的薄 facade                                               | R070、D007、D013                   |
| UT-T094 | failure/direct            | plugin-host config transaction 在 resolver/getter/limit/rollback 失败时保持 primary、队列可用、旧 config 不变                                       | R070、MI006、MI007、MI013          |
| UT-T095 | isolated consumer         | tarball 外部项目仅安装 utils 即可组合、patch、readonly rich config；`/config` bundle 不含 plugin-host/promise                                       | R001、R003、R044～R049、D001、D006 |
| UT-T096 | behavior-change/migration | storage-web自身历史canonical Base64 fixture继续逐字解码；旧atob可接受的空白/非canonical输入现稳定失败并翻译为storage codec error，docs/registry同步 | R030、R064、R071、MI007、MI008     |
| UT-T097 | behavior-change/process   | web-rpc正常timeout结果不变；cleanup/onTimeout/onDiagnostic secondary failure不再静默，custom reporter或hostRethrowReporter各观察一次且主结果不变    | R061、R073、MI005                  |

## 8. 证据与闭合映射

### 8.1 Requirement/Decision → Test

| 条款    | Cases                                                                           |
| ------- | ------------------------------------------------------------------------------- |
| UT-R001 | UT-T001、UT-T006、UT-T095                                                       |
| UT-R002 | UT-T002                                                                         |
| UT-R003 | UT-T002、UT-T003、UT-T095                                                       |
| UT-R004 | UT-T004、UT-T005、UT-T043、UT-T051、UT-T062                                     |
| UT-R005 | UT-T036、UT-T055、UT-T069                                                       |
| UT-R006 | UT-T001、UT-T022                                                                |
| UT-R007 | UT-T005                                                                         |
| UT-R008 | UT-T004                                                                         |
| UT-R010 | UT-T002、UT-T004、UT-T006                                                       |
| UT-R011 | UT-T040                                                                         |
| UT-R012 | UT-T041                                                                         |
| UT-R013 | UT-T042、UT-T045                                                                |
| UT-R014 | UT-T043、UT-T045、UT-T046、UT-T047、UT-T048                                     |
| UT-R015 | UT-T051、UT-T052、UT-T053、UT-T054                                              |
| UT-R016 | UT-T055、UT-T056、UT-T057、UT-T058、UT-T059、UT-T060                            |
| UT-R017 | UT-T042、UT-T043、UT-T044、UT-T045、UT-T046、UT-T048、UT-T049、UT-T054、UT-T059 |
| UT-R020 | UT-T010                                                                         |
| UT-R021 | UT-T011                                                                         |
| UT-R022 | UT-T012                                                                         |
| UT-R023 | UT-T013                                                                         |
| UT-R024 | UT-T010、UT-T011、UT-T014、UT-T031、UT-T047                                     |
| UT-R025 | UT-T014                                                                         |
| UT-R030 | UT-T030、UT-T031                                                                |
| UT-R031 | UT-T032                                                                         |
| UT-R032 | UT-T033、UT-T034、UT-T035                                                       |
| UT-R033 | UT-T034、UT-T036                                                                |
| UT-R040 | UT-T018                                                                         |
| UT-R041 | UT-T019                                                                         |
| UT-R042 | UT-T020                                                                         |
| UT-R043 | UT-T021                                                                         |
| UT-R044 | UT-T062、UT-T095                                                                |
| UT-R045 | UT-T063、UT-T064、UT-T095                                                       |
| UT-R046 | UT-T065、UT-T092、UT-T094                                                       |
| UT-R047 | UT-T066、UT-T092                                                                |
| UT-R048 | UT-T067、UT-T068、UT-T095                                                       |
| UT-R049 | UT-T066、UT-T068、UT-T069                                                       |
| UT-R050 | UT-T015                                                                         |
| UT-R051 | UT-T017                                                                         |
| UT-R052 | UT-T016                                                                         |
| UT-R060 | UT-T070、UT-T071                                                                |
| UT-R061 | UT-T076、UT-T077、UT-T083、UT-T097                                              |
| UT-R062 | UT-T078、UT-T083                                                                |
| UT-R063 | UT-T079、UT-T083                                                                |
| UT-R064 | UT-T072、UT-T074、UT-T086、UT-T087、UT-T096                                     |
| UT-R065 | UT-T073、UT-T084                                                                |
| UT-R066 | UT-T080、UT-T081、UT-T083                                                       |
| UT-R067 | UT-T082、UT-T083                                                                |
| UT-R068 | UT-T085、UT-T088                                                                |
| UT-R069 | UT-T075、UT-T089、UT-T090、UT-T091                                              |
| UT-R070 | UT-T092、UT-T093、UT-T094                                                       |
| UT-R071 | UT-T096                                                                         |
| UT-R072 | UT-T072、UT-T075                                                                |
| UT-R073 | UT-T097                                                                         |
| UT-D001 | UT-T001、UT-T071、UT-T089、UT-T095                                              |
| UT-D002 | UT-T040、UT-T050、UT-T070                                                       |
| UT-D003 | UT-T072、UT-T086、UT-T087                                                       |
| UT-D004 | UT-T010、UT-T073、UT-T084                                                       |
| UT-D005 | UT-T075、UT-T085、UT-T092                                                       |
| UT-D006 | UT-T003、UT-T022、UT-T095                                                       |
| UT-D007 | UT-T071、UT-T072、UT-T073、UT-T083、UT-T086、UT-T087、UT-T088、UT-T093          |
| UT-D008 | UT-T070、UT-T071                                                                |
| UT-D009 | UT-T050、UT-T061、UT-T078、UT-T082、UT-T083                                     |
| UT-D010 | UT-T019                                                                         |
| UT-D011 | UT-T020、UT-T085                                                                |
| UT-D012 | UT-T002、UT-T003                                                                |
| UT-D013 | UT-T062、UT-T092、UT-T093                                                       |
| UT-D014 | UT-T067、UT-T068                                                                |
| UT-D015 | UT-T067                                                                         |
| UT-D016 | UT-T062、UT-T065、UT-T069                                                       |
| UT-D017 | UT-T063、UT-T064                                                                |

### 8.2 迁移不变量

- **UT-MI001**：行为等价迁移保持 callback/attempt/disposer 调用次数与顺序。
- **UT-MI002**：single-flight/deferred/dispose/onceAsync 的既有 Promise identity 保持。
- **UT-MI003**：scheduler 时间域、timeout=0、同步 scheduler 与 unref 行为保持。
- **UT-MI004**：abort first-observed reason、pre-abort、listener 清理与 caller signal 所有权保持。
- **UT-MI005**：迟到结果/rejection观察与report次数保持；仅R073明确授权的web-rpc secondary failure从silent改为host-report，除此之外unhandled/uncaught行为保持。
- **UT-MI006**：close/dispose/active/queued 次序与幂等保持；rollback error 不替换 primary。
- **UT-MI007**：native error type、source/code/message/stack/cause/errors identity 保持。
- **UT-MI008**：Base64/UTF-8/storage/RPC wire 文本逐字兼容，除专门 behavior-change 条款外不接受“可解码但不同字节”。
- **UT-MI009**：旧public exports在本次及迁移后保持；允许零逻辑public re-export/领域翻译作为稳定边界。仅internal compatibility alias必须写明仓内consumer归零的删除条件并在本次删除。
- **UT-MI010**：package metadata、lockfile、README/USEGUIDE、Makefile、consumer fixtures 与 SDD 同批更新。
- **UT-MI011**：plugin-host config 的 readonly facade identity、receiver、callable/constructable、iterator、Promise/thenable 与 mutation rejection 语义保持。
- **UT-MI012**：config COW保持未变subtree sharing、变化ancestor copy、cycle/shared edge与root rebase；utils默认空patch复用base，plugin-host兼容调用固定`reuseUnchangedRoot:false`以保持既有空update产生新root/facade。
- **UT-MI013**：config combine/patch 的 source order、单读、冲突策略、原子发布和失败 rollback 保持；新增 combiner 默认不得改变 plugin-host 既有 patch 默认语义。
- **UT-MI014**：config path grammar、dangerous-key 拒绝、public type/export、native error type、source/code/message/cause 保持。

| 不变量   | Cases                                                |
| -------- | ---------------------------------------------------- |
| UT-MI001 | UT-T070、UT-T076、UT-T079                            |
| UT-MI002 | UT-T070、UT-T079                                     |
| UT-MI003 | UT-T040、UT-T053、UT-T070、UT-T076、UT-T079          |
| UT-MI004 | UT-T047、UT-T053、UT-T070、UT-T076、UT-T080          |
| UT-MI005 | UT-T046、UT-T048、UT-T070、UT-T076、UT-T097          |
| UT-MI006 | UT-T049、UT-T058、UT-T079、UT-T094                   |
| UT-MI007 | UT-T010、UT-T049、UT-T073、UT-T084、UT-T094、UT-T096 |
| UT-MI008 | UT-T072、UT-T074、UT-T086、UT-T087、UT-T096          |
| UT-MI009 | UT-T002、UT-T070、UT-T072                            |
| UT-MI010 | UT-T006、UT-T075、UT-T089、UT-T090                   |
| UT-MI011 | UT-T063、UT-T064、UT-T092                            |
| UT-MI012 | UT-T065、UT-T092                                     |
| UT-MI013 | UT-T067、UT-T068、UT-T094                            |
| UT-MI014 | UT-T066、UT-T092                                     |

### 8.3 Evidence 模板

| 日期   | SHA/worktree        | Clause/Cases | 命令                                         | 结果/计数 | 分类    |
| ------ | ------------------- | ------------ | -------------------------------------------- | --------- | ------- |
| 待实施 | dirty baseline 必填 | UT-B00       | `rtk git status --short`; inventory commands | 待填      | pending |

不得把本文档创建本身记为 implementation evidence。SDD 完成自检只证明设计可执行，所有代码条款仍为 pending。

## 9. 风险、deferred 与交付门禁

### 9.1 风险与处置

| 风险                                                                                             | 严重度 | 处置/阻断条件                                                                           |
| ------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| utils 变成 grab-bag，持续吞并领域逻辑                                                            | 高     | 只允许六个固定域；新增域必须 SDD + 两个独立消费者 + owner 审查                          |
| readonly Proxy 对内建对象、subclass 或 thenable 使用错误 receiver，导致读操作异常或泄漏 mutation | 高     | richRuntime receiver/callable/iterator/Promise 对抗矩阵 UT-T063/064 未闭合则阻断        |
| COW/combiner 在 cycle、root edge 或 alias graph 上错误共享/复制                                  | 高     | 统一 graph engine + identity property tests；UT-T065/067 未闭合则阻断                   |
| combiner 默认策略过于“智能”而静默改变数组/Map/Set 配置                                           | 高     | 默认除 record 外 replace；所有 merge 行为显式策略化，非法 resolver fail closed          |
| hostile config 造成 prototype pollution、递归栈溢出或资源耗尽                                    | 高     | dangerous key 永拒绝、显式 work queue 与 maxDepth/maxNodes/maxKeys；UT-T066/069         |
| 将 readonly facade 误认为任意函数/私有槽/外部 I/O 的 capability sandbox                          | 高     | unknown rich method 默认拒绝，policy 显式分类；README 声明只读边界，不宣传安全沙箱      |
| 下沉 scheduler 导致 lifecycle error/time-domain 漂移                                             | 高     | UT-T070/071 与 lifecycle direct gates 未闭合则禁止迁移/发布                             |
| universal timeout 假装取消不可取消 Promise                                                       | 高     | lazy factory + signal + 文档明确 cooperative cancellation；无此保证阻断                 |
| retry 重复有副作用 operation                                                                     | 高     | maxAttempts 必填；示例强调 idempotency；默认不重试 abort/total timeout                  |
| safeRead/diagnostic clone 静默丢 hostile error                                                   | 高     | probe 判别结果；snapshot 返回 path diagnostics + identity fallback；UT-T019/021         |
| bytes 迁移改变 persistence/RPC wire                                                              | 高     | 逐字 fixture + E2E；任一差异需独立 behavior-change 条款                                 |
| strict Base64拒绝历史宿主曾容忍的非canonical文本                                                 | 中     | 仅R071授权；canonical历史fixture + dedicated UT-T096 + storage错误翻译/docs             |
| web-rpc secondary diagnostic从silent变host可观察                                                 | 中     | 仅R073授权；process fixture UT-T097证明主结果不变且恰好报告一次                         |
| error helper 覆盖既有 code/stack/cause                                                           | 高     | 冲突 fail closed；原位 identity tests；全包 direct tests                                |
| 根入口拉入全部实现影响 bundle                                                                    | 中     | subpath 为推荐入口，root tree-shaking 产物测试                                          |
| 大规模 dirty worktree 使证据不可归因                                                             | 高     | UT-B00 baseline；每批 diff scope；无法归因则 environment/existing defect，不得 verified |
| 发布包声明/exports 与 workspace symlink 假通过                                                   | 高     | tarball isolated install + Node/browser fixture                                         |

### 9.2 Deferred

本文当前无 deferred。Crypto、UUID、HTTP、date、collection、schema 等不在范围，是明确 non-goal，不是延期条款。若实施中发现某个列入范围的条款必须延期，必须先建立独立 owner/SDD、更新状态矩阵并获得设计裁定；不得口头移到“下一版”。

### 9.3 最终交付门禁

1. utils：`fmt → lint → typecheck → typecheck:test → test → build → release:pack`。
2. isolated tarball：Node ESM、browser bundle、types-only、每个 subpath、root tree-shaking。
3. 基础消费者：lifecycle、serialize、middleware-pipeline、event-subscriber、plugin-host config direct suite。
4. 异步消费者：web-rpc core/node/e2e、logger browser/process、resource、storage-web Chromium/WebKit、store-ssr。
5. Store 消费者：store-middleware/devtools/persist/worker/react/wasm/indexed/keyed/light/shared。
6. Repository：`G-ROOT`，即 root `fmt → lint → typecheck → typecheck:consumers → test → build`；root `typecheck:test` 当前 absent，存在但未运行的 gate 一律算未闭合。
7. `git diff --check`、package graph cycle check、duplicate implementation scan、error registry consistency、README/USEGUIDE stale-link scan。
8. 最终 hostile review 必查：边界/极端输入、race、幂等、cleanup、late reject、误用与 side-effect retry、config receiver/COW/cycle/rollback/prototype pollution、error identity、wire compatibility、exports/lockfile/release metadata。

任何 high finding 必须本次修复；中低 finding 若超出范围，必须分类为 verified、implemented-unverified、deferred、blocked、existing defect 或 environment failure并标 owner。上述全部闭合前，本文不得标记 approved/complete/verified。
