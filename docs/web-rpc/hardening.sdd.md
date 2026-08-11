# SDD：web-rpc 安全与生命周期加固

## 1. 文档状态

- 状态：2I 全包扫描新增 4 个 P0、11 个 P1、4 个 P2；设计 block 为 0，禁止在 owner 级方案完成前再次声明 hardening 完成
- 审查轮次：全量重审（公共 API、wire、identity、discovery、task、middleware、adapter、资源与工程门禁）
- 范围：`packages/web-rpc`
- 前置文档：`docs/web-rpc/web-rpc.sdd.md`
- 目标：修复当前实现中的来源认证、分片资源耗尽、取消失效、响应冒充、异步错误边界和生命周期清理问题。

本文不重新定义 web-rpc 的业务 API。除明确列出的契约修正外，现有 endpoint、provider、middleware 和 adapter 分层继续有效。

### 1.1 Feature/Fix Agent 强制约束

本节是所有 feature、fix、review 和后续实现代理的上位约束，不得被单项问题的局部验收覆盖：

- 禁止通过创造、引入或转移新问题来关闭固有问题。包括但不限于：削弱认证或校验、扩大信任边界、吞掉错误、改变既有 settlement/timeout/abort 语义、引入无界状态或 timer、制造新的竞态与资源泄漏、破坏类型与运行时一致性、令其他 adapter 或 mode 回归。
- 禁止通过破坏当前框架架构来解决当前问题。必须保留既定 owner、分层边界、单一事实源、依赖方向、生命周期状态机和公开契约；不得新增平行状态机、旁路 capability/runtime/transport owner、反向依赖或重复实现同一协议语义。
- 已由本 SDD 和前置 SDD 确认的架构决策属于实现前提。代理不得在代码中静默重解释、降级或绕开这些决策。若问题无法在既定架构内正确关闭，必须先停止实现，明确冲突、影响范围和替代方案，并先更新 SDD 获得设计决策。
- “旧问题消失但出现新问题”不算部分完成，而算实现失败；patch 必须拒收或返工。临时兼容层、公开 API 变化、wire/security 语义变化、owner 迁移或依赖方向变化，必须由 SDD 预先授权并写明迁移和移除条件。
- 每个修复必须同时证明：原问题已关闭；相邻安全、生命周期、并发、兼容性和 adapter/mode 不变量未回归；历史已关闭条目未重新打开。仅新增 happy-path 测试或让目标测试变绿，不构成验收。
- feature/fix agent 交付时必须列出所保留的架构边界、执行的回归门禁和剩余风险。无法提供非回归证据时，状态只能是未完成，不能宣称已修复。

## 2A. 当前工作树审计（2026-08-11）

本文件后续章节保留各轮对抗审查的原始记录；其中“部分关闭”描述的是发现时的状态，不能单独作为当前工作树的结论。当前验证结果如下：

| 范围                                                      | 当前结论 | 证据                                                                                                                        |
| --------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 来源绑定、wire 快照、chunk 预算、replay、fan-out 安全字典 | 已实现   | `src/endpoint.ts`、`src/wire.ts`、`src/internal/{chunk,identity,replay,safe-value}.ts` 及对应测试                           |
| timeout/abort/retry、settlement、dispose 并发和资源回滚   | 已实现   | `src/internal/{async-control,retry,settlement,resource-scope}.ts`、endpoint/factory 测试                                    |
| middleware capability、协议/监听器配置校验                | 已实现   | middleware install 校验、factory snapshot 和 rollback 测试                                                                  |
| 分布式 target/receiver 解析与聚合                         | 已实现   | 默认 BroadcastChannel bootstrap、public selector装配、ping/discovery/candidate生命周期均已覆盖2C回归测试                    |
| `bind/call/apply` 审计                                    | 已通过   | web-rpc production/test 源码中无 `.bind/.call/.apply` 调用；transport 方法以捕获函数调用，跨 realm predicate 使用 safe-read |
| 完整工程门禁                                              | 包级通过 | 当前轮次 `fmt`、`lint` 与测试通过；Vitest 59 suites / 420 tests 全通过，coverage statements 87.75%、branches 85.10%、functions 87.76%、lines 89.87% |

当前工作树结论以 2I.23 为准；本节仅保留基线和历史演进，不覆盖 2I 的 owner 级审计结论。

本轮新增 explicit peer 的 custom direct connect verifier 回归；当前 web-rpc 测试总数为 401。2I owner 实现已在当前源码中包含 `RequestReplayLedger`、`ProviderAdmissionRegistry`、provider transfer bridge、custom byteLength canonical 下界校验、`DiscoveryRegistry.close()` 资源收口和 terminal transport admission close；2I 历史章节仍保留原始根因与迁移记录，不应被解释为这些实现尚未存在。

本轮进一步补齐 adapter topology：SharedWorker/ServiceWorker/Window 标记 multiplexed，BroadcastChannel 标记 broadcast，exclusive binding 不再覆盖 SharedWorker；direct connect 路径同步收口、非法 topology 在装配期拒绝，验证前冲突检查与 sender commit 都不再把 multiplexed transport 锁成单 sender，并新增 spoof 与 ServiceWorker cross-realm stable-id 回归，当前测试总数为 233。

未声明 topology 的 Worker-like custom transport 不再隐式获得 exclusive first-sender 信任；要求显式 peer/source 或 identifier 认证。显式 connect 的 exclusive Worker/MessagePort 在已配置 peer 上直接提交业务帧，Memory exclusive 仍保留 discovery 生命周期，并新增“专用通道无 discovery responder 仍可直连”的回归。caller/session 矩阵覆盖 caller abort、不同 deadline（短 caller 超时不取消 unlimited caller）、另一个 caller 继续完成；control replay 在 replay capacity 满载时不再先消耗 variation quota；automatic discovery 现在先做 replay admission preflight，再提交独立 discovery admission，提交失败会回滚，避免无效请求消耗额外 budget；manual/automatic discovery replay admission 现在在创建状态前完成，并新增未声明 Worker topology 回归。DiscoveryRegistry.close() 现由 owner 统一 reject automatic/manual waiter 并释放 task、response-count、timer 资源；即使单个 listener cleanup 失败也继续 settle 其余 waiter，endpoint 不再重复遍历清理；dispose 前先发出 local receiver unregistration；新增 waiter N-1/N/N+1 边界回归；MessagePort terminal 后拒绝 send/subscribe，BroadcastChannel transport-error listener 失败被 adapter 隔离；remote/local/admission snapshot 的 outer array 与 entry tuple 均冻结，并覆盖 duplicate registration 独立注销；remote snapshot 与 verified identity lease 通过 `setRemoteWithBinding()` 单一事务提交，容量或 lease 失败不会留下半状态；factory 成功、取消、超时和失败路径移除 construction signal listener，且新增安装失败 rollback 证据；当前 web-rpc 测试总数为 259，并新增同 senderId 不同 source 的 verified-token 抢答拒绝回归与 remote binding lease 生命周期回归。另新增 manual query 在 abort listener 注册期间同步触发时不发送 discovery 的回归。store consumer 已迁移到结构化 `IWebRpcAbortSignal`，不再依赖 DOM-only signal 类型。

内置 Memory、Window、BroadcastChannel、RTCDataChannel、WebTransport、Worker/ServiceWorker/SharedWorker adapter 的 topology 声明均有 adapter-level 回归覆盖。

## 2B. 第十四轮全包对抗基线（已被2C取代）

本节从当前源码重新建立结论，不把第一至十三轮的历史条目当作现状。审计覆盖全部 public exports、factory/middleware 装配、wire normalization、来源绑定、automatic/manual discovery、request/provider/ping/abort/retry/chunk 状态机、九个 adapter、dispose/rollback、资源预算与 package gates。

| 当前全包基线   |   数量 |
| -------------- | -----: |
| 真实设计 block |      0 |
| P0 实现缺陷    |      0 |
| P1 TODO        |      0 |
| P2 TODO        |      0 |
| **合计**       | **0** |

### 2B.1 已闭合边界

- request/response 使用 canonical wire snapshot，错误来源不能靠 getter TOCTOU 改写已验证字段。
- pending、provider、timeout、abort、retry 与 dispose 已使用 settlement/async-control；timer 清理与 `.unref()` 已集中管理。
- provider result brand、错误脱敏、active controller、request replay window 与 task-id reservation 已落地。
- chunk 具备 peer 隔离、并发数、chunk 数、单块/累计字节、总缓冲和 expiry 上限。
- capability conflict、immutable snapshot、factory rollback、transport ownership 与 cleanup aggregation 已有测试。
- hook/listener failure 隔离、null-prototype fan-out result、公共入口 active guard 和 `.bind/.call/.apply` 禁令当前通过。

上一版列出的 `uniqueTargetId` 透传、automatic send 等待 discovery、manual unregister 越权、wire platform 降级、manual accept 覆盖保留字段、freshness/replay/budget、WebTransport EOF、RTC terminal 均已关闭，不再计入当前问题。

### 2B.2 已关闭：BroadcastChannel 广播组按一个逻辑 target 结算 `sendAll()`

无 `uniqueTargetId` 时，同名 BroadcastChannel endpoint 被建模为一个广播组，且共享逻辑 key `targetId`。`send()` 与 `sendAll()` 都物理广播给组内全部 endpoint；广播组在 fan-out result 中只占一个 key，第一条合法 response 决定该 key 的 fulfilled/rejected，后续 response 不改变 settlement。当前实现与测试遵循该语义。

具备已验证 `uniqueTargetId` 时，每个 `${targetId}:${uniqueTargetId}` 才是独立 receiver，`sendAll()` 可逐 receiver 返回结果；不把匿名广播组伪装成逐 endpoint 聚合。

### 2B.3 已关闭：广播组禁止实例 pin，unregister 只删除本地组 binding

广播组没有可验证实例 receiverId，因此不能 pin 或注销组内单个 endpoint。当前实现对匿名组 pin 稳定返回 `TARGET_NOT_IDENTIFIABLE`；manual `unregister(targetId)` 只删除当前 endpoint 本地 binding。

实现应禁止对广播组调用 `pinReceiver()`，并返回稳定的 `TARGET_NOT_IDENTIFIABLE`；manual `unregister(targetId)` 只删除当前 endpoint 本地 DNS 中整个广播组 binding，不向远端表达单实例注销。带 receiverId 的 pin/unregister 只对经过 identifier 验证的 `${targetId}:${uniqueTargetId}` 开放。

### 2B.4 已关闭：单目标操作使用端到端 deadline

一次公开操作只在入口计算一次 absolute deadline；discovery、selector、request、ping、dispatch、retry decision 和 backoff 都消费剩余预算。

`timeoutMs: false` 保持无限等待语义。

### 2B.5 已关闭：automatic discovery 继承调用控制面

automatic discovery session 不再固定使用 1000ms：send、dispatch、ping 都传入当前剩余 deadline 和父 signal。single-flight waiter 独立计数，单个调用取消不会影响其他 waiter，最后一个 waiter 离开时清理 task、timer 和 response collection。

调用者 deadline 不会被简单写入全局 single-flight owner；每个 waiter 负责自己的 timeout/abort。

### 2B.6 已关闭：manual `connect.ping()` 可探测未注册 candidate

manual ping 定义为“不发现、不注册、不改 DNS”的一次 ping/pong。实现接受同 endpoint verified manual candidate，并允许其 receiver 尚未进入 DNS 时直接定向探测；裸 receiverId 仍不能绕过 provenance 校验。

`ping` 应接收由 verified manual query产生的 opaque candidate（或受保护 receiver proof），允许临时定向，不写 DNS。裸 receiverId 不能绕过 provenance 校验。

### 2B.7 已关闭：manual inbound query 使用 opaque handle

内部 owner key 使用 `(verifiedPeerKey, senderId, queryId)`，公开 API 已改为每个 verified query 独立生成 opaque handle；两个 peer 使用相同 wire queryId 时仍可分别 settlement，重复或过期 handle 返回 `false`。

handle 的 settlement 不依赖远端可控的裸 queryId。

### 2B.8 已关闭：fan-out 结果 key 使用 receiver 字符串域

实现以 receiverId/匿名 target 作为 key，公开类型统一为字符串 key 域 `IWebRpcFanoutResult<TResult>`；`sendAll()` 与 `pingAll()` 不再把 receiverId cast 为 `TTargetId`。

先按 2B.2 决定广播组结果模型，再统一 `sendAll/pingAll` 返回类型；禁止用 cast 隐藏 key domain 差异。

### 2B.9 已关闭：`uniqueTargetId` 使用异步初始化快照

目标契约支持字符串或 `(context) => string | Promise<string>`，其中 context 只包含 `endpointId` 与 adapter-owned `platform`。`createEndpoint()` 现在等待 factory、校验并冻结一次 identity 快照后才返回 endpoint；非法返回降级广播组，factory 异常使创建失败。

identity factory 由异步 `createEndpoint()` 拥有 barrier；不把 `serverList` 注入 factory，也不在 discovery/reconnect 时重新计算。

### 2B.10 已关闭：factory `targetIds` 在入口 omit 当前 endpoint

设计要求每个 endpoint 的 DNS、fan-out 与 configured remote target 集合都 omit 自己。factory 已去重并过滤当前 id，constructor 继续做防御性过滤；fan-out snapshot 不再包含自身。

learned peer、remote DNS 和 fan-out snapshot 继续维持同一 self-omit invariant。

### 2B.11 已关闭：匿名广播组多响应会产生歧义诊断

discovery session 现在记录本轮合法 response 数；匿名 BroadcastChannel 组在 `responseCount > 1` 时发出 `ambiguous: true` 的 hook 诊断。

该计数只是 transport 观测，不能冒充唯一 endpoint 基数，也不能用于 pin/unregister。

### 2B.12 已关闭：独立 `receiverSelector` routing capability

主 SDD 已把用户提出的 `(serverList, clientId) => string` 拆为独立 routing policy：输入 remote-only immutable server list 和 `{ endpointId, targetId, operation }`，输出本次单目标操作使用的 receiverId。当前 config、typing 与 endpoint routing path 均已提供该 capability。

实现顺序固定为 active pin → selector → unpinned default；pin 存在或丢失时都不调用 selector。`sendAll/dispatchAll/pingAll` 忽略 selector。异步 selector 纳入 operation deadline/abort/dispose，返回值重新对照 snapshot 验证，且不得修改 DNS、pin 或 identity。

### 2B.13 已关闭：manual `onQuery` 透传安全控制 payload

入站 manual handle 现在提供已验证 discovery query 的安全 data 快照，并剥离 `__unique_id__` 保留字段；应用 handler 不会获得来源或 identity proof 对象。

### 2B.14 已关闭：announcement/lease 控制面已移除

announcement listener、adapter 广播路径和 endpoint receiver-announcement handler 已移除；DNS 只由 authenticated query response 写入。

不再保留 register/unregister lease 旁路，也不扩展 announcement verifier。

### 2B.15 已关闭：条件类型与 facade 收口

`IWebRpcConnectControlForMode` 已按 `automatic/manual` 条件收窄 `connect` facade；factory 返回类型同时按 discovery mode 与 ping capability 做条件推导。automatic endpoint 不再在类型层暴露 manual-only 方法。

结论：当前剩余问题不再是 discovery 全面失控，真实设计 block 为 0。BroadcastChannel 广播组按单一逻辑 target 结算，禁止实例 pin，unregister 只删除本地组 binding；其余项目也都有明确落地路径，应作为 TODO直接实现，不能继续泛化成架构未决。

## 2C. 第十五轮全包对抗基线（2026-08-11）

本节以第十五轮审查时的当前源码为准，并取代 2B。上一轮列出的广播组 result/pin、端到端 send deadline、caller-owned discovery timeout、opaque manual handle/candidate ping、fan-out string key、异步 uniqueTargetId、targetIds self-omit、anonymous responseCount、query data 均已落地或已有对应实现；不再把这些项目重复计算为未实现。

| 当前结论 |  数量 |
| -------- | ----: |
| P0       |     0 |
| P1       |     0 |
| P2       |     0 |
| **合计** | **0** |

2C.1–2C.9 均已在当前工作树关闭；下列条目保留根因、修复边界和回归证据，标题中的历史严重度不代表仍有未关闭缺陷。

### 2C.1 P0：默认 BroadcastChannel 仍无法完成首次 discovery

SDD 已确定 `useBaseIdVerifyOnly !== false` 为默认，并要求无法获得物理 sender 指纹的 BroadcastChannel 降级为匿名广播组。当前 connect `baseVerified` 仍强制要求 `peerIdentity || originIdentity || identifierSource`；原生 BroadcastChannel 没有 transport peerId，`event.source` 为 null，origin通常为空，默认分支又禁止 identifierSource。因此默认 automatic query 在首次 binding 前全部被拒绝，匿名广播组契约实际上不可达。

base check 必须接收 adapter-owned platform/capability：只有明确的 BroadcastChannel 且 adapter确认无 sender 指纹时，允许通过结构化 target check进入 anonymous group；其他 transport仍要求真实 peer/origin/source binding。必须新增真实 BroadcastChannel 双 realm 测试，不能继续只用带静态 identity 的 memory pair证明 bootstrap。

### 2C.2 P1：public `connect()` 丢弃 `receiverSelector`

typing 已公开 `receiverSelector`，endpoint direct options也会执行它；但 middleware只 snapshot transport、identifier、base mode、uniqueTargetId和 discoveryMode，发布的 connect capability没有 selector。`createEndpoint({middlewares:[connect({...receiverSelector})]})` 因此静默退化为默认 routing，只有绕过 public factory直接构造 endpoint的测试能通过。

connect descriptor读取阶段必须安全 snapshot并校验 selector，把同一函数引用发布到 capability；回归测试必须走 `createEndpoint + connect()`，禁止只测内部 constructor。

### 2C.3 P1：ping timeout 后异步 selector仍可发送 variation

ping 的外层 timer从调用开始计时，但 discovery结束后调用 `#receiverForOperation(..., timeoutMs)` 时重新给 selector完整 timeout。外层 pending先 settle false后不会取消 selector；selector稍后 resolve，链路仍执行 `#sendVariation(ping)`。调用方已经看到失败，wire却出现迟到副作用。

ping必须像 send/dispatch一样计算单一 deadline并传 remaining budget；pending settlement需要提供内部 AbortSignal，timeout/abort/dispose后取消 discovery/selector链，并在每个 await 后检查 task仍active，禁止迟到 variation。

### 2C.4 P1：`timeoutMs:false` 的成功 discovery永久保留 session

discovery依赖 timeout timer在首个 response后的 collection window结束时删除 task/waiter/count。`timeoutMs:false` 不创建 timer；首个 response只 resolve waiter，success handler又故意不清理，`#discoveryTasks`、`#discoveryWaiters`、`#discoveryResponseCounts` 因而永久保留。后续相同 target虽可能命中 DNS，但 dispose前状态无法回收，且 taskId持续被接受为当前 discovery。

无限业务 deadline不能等于无限 response collection。拆分 caller deadline与固定有界 collection window；首响应释放 caller，collection window结束后无条件关闭 discovery session。`false` 只控制调用等待，不控制内部观测资源寿命。

### 2C.5 P1：discovery 初始 send 同步抛错会留下半注册 single-flight

`#discoverTargetIfNeeded()` 使用 `Promise.resolve(this.#send(query)).catch(...)`。`this.#send()` 在 Promise归一化前求值；若 transport同步抛错，cleanup catch根本没有安装，方法直接抛出，但 waiter/task/count/timer已写入 registry。后续调用会加入这个残留 session并等待 timeout。

必须使用惰性 `Promise.resolve().then(() => #send())` 或统一 invoke helper；同步/异步 send failure都进入同一个 session settlement和资源清理。

### 2C.6 P1：manual candidate capability从不撤销

verified candidate被加入 WeakSet/WeakMap后没有 delete/revoke路径。query window结束、candidate register/unregister、binding失活甚至长时间后，只要调用方仍持有对象，`connect.ping(candidate)` 和 `register(candidate)`仍通过 provenance check。这与 SDD“过期、复用、跨 lifecycle candidate稳定拒绝”冲突。

candidate需要 endpoint-owned capability record，至少绑定 session generation、expiry、settled/registered/revoked状态；register采用一次性消费，unregister/dispose/TTL撤销，ping只允许有效期内使用。

### 2C.7 P1：缺失 platform 被伪装成 `Memory`，会绕过 transport-specific规则

transport `platform` 仍是 optional；factory和 endpoint都用 `platform ?? 'Memory'`。但 platform现在决定 BroadcastChannel匿名组、receiver格式与 pin限制，不再只是 diagnostics。包装 BroadcastChannel的自定义 transport只要漏写 platform，就会被当成 Memory，绕过 BroadcastChannel规则；uniqueTargetId factory也收到伪造的 Memory。

connect transport必须提供合法 platform，缺失或未知值在安装期 `INVALID_CONFIG`；测试专用 memory transport显式声明 `platform:'Memory'`。禁止安全策略字段使用默认伪值。

### 2C.8 P2：inert announcement/lease控制面仍未删除（已关闭）

authenticated query response 是 DNS 唯一注册输入；announcement listener、adapter 广播路径、endpoint receiver-announcement handler 与 register lease 均已移除。遗留测试中的 legacy fixture 仅用于确认旧控制面不会重新接入运行时。

### 2C.9 P2：条件类型仍未表达 mode/capability（已关闭）

公开 connect control 已按 automatic/manual mode 收口；factory 返回类型按 middleware capability 推导 manual discovery controls 与 ping surface。类型回归覆盖自动模式拒绝 `query`、manual 模式提供 `query`、以及 ping middleware capability。

结论：设计决策已足够，真实架构 block仍为0。当前最高风险来自identity policy没有真正进入adapter capability，以及public middleware装配与internal direct-constructor行为分叉；应先修2C.1/2C.2，再统一ping/discovery/candidate生命周期。

## 2D. 第十六轮全包对抗基线（2026-08-11）

本节重新审计当前源码，并取代2C的“全部关闭”结论。2C识别的默认 BroadcastChannel bootstrap、public `receiverSelector`装配、ping迟到发送、无限 discovery session、同步 send cleanup、manual candidate TTL、显式 platform和条件类型均已有实现或测试；本轮不重复计数。

| 当前结论 |  数量 |
| -------- | ----: |
| P0       |     0 |
| P1       |     0 |
| P2       |     0 |
| **合计** | **0** |

2D.1–2D.8 均已在当前工作树关闭；下列条目保留根因、修复边界和回归证据，标题中的历史严重度不代表仍有未关闭缺陷。

### 2D.1 P1：`send()` 在 discovery/selector 后重新获得过期 request budget

入口虽计算了 absolute deadline，但 attempt 在 discovery 前缓存 `attemptTimeout`，完成 discovery和 selector后仍把该旧值传给 `#request()`。例如总预算100ms，discovery消耗90ms，request仍可再等待100ms；retry attempt同样可能越过公开 deadline。

request必须使用提交 wire前重新计算的 `remainingTimeout()`。若为0，不创建 task、不发送 request。整个 operation的 deadline只能计算一次，任何 phase不得缓存后交给更晚 phase复用。

### 2D.2 P1：`ping({ timeoutMs:false, signal })` abort 后永久 pending

ping仅在有限 timeout分支启动 `raceWithAsyncControl()`。`timeoutMs:false` 时，用户 signal只会 abort内部 `operationAbort`；异步链看到 aborted后停止发送，却没有调用 `pending.settle(false)`。公开 Promise和 `#pingPending`会一直保留，直到 endpoint dispose或 transport terminal failure。

外部 signal和 endpoint closing必须直接参与 settlement，不得依赖 timeout race顺便结算。无限 timeout只禁用 timer，不得禁用 abort/dispose终态。

### 2D.3 P1：不同 caller deadline共享 discovery时可形成无 owner session

single-flight waiter共用首个 caller的 timer。timer触发时若 `references > 1` 直接 return且不重建内部 collection timer。若第一个 caller有限超时、第二个 caller使用 `false`，首个 timer退出，有限 caller随后离开，剩余无限 caller既没有 timer也没有新的 owner；无 response时 waiter/task/count永久存在。

shared discovery必须拥有独立于caller的有界 session deadline。caller race只增减订阅引用，不得拥有或取消底层 query生命周期；最后一个caller离开可提前取消，但不同 timeout组合不能移除session终态。

### 2D.4 P1：manual discovery response可无界扩大 candidate数组

manual query waiter在整个 timeout窗口内对每条 accepted response直接 `push(candidate)`，没有 receiver去重、总数上限或 per-peer上限。已认证但异常的 endpoint可用同一task重复响应，持续创建冻结对象和 WeakMap capability record；较长 timeout会把协议级广播放大为客户端内存增长。

manual candidate collection必须按 `(verifiedPeerKey, targetId, receiverId)` 去重，并设置每次 query的总量/per-peer预算。超限响应只产生采样 diagnostic，不能继续分配 capability record。

### 2D.5 P1：fan-out结果仍以裸 `receiverId` 作 key，跨 target会覆盖

`sendAll()`和`pingAll()`把 delivery key直接设为 receiverId，并写入 null-prototype record。非BroadcastChannel receiverId来自对端 wire，协议没有保证它在所有 target间全局唯一；两个不同 target可合法或恶意返回同一个 receiverId，后写结果覆盖先写结果，返回基数小于实际 delivery数。

fan-out identity必须使用无碰撞复合键或结构化数组。若保留 record，key至少使用 canonical `(targetId, receiverId)`编码；匿名广播组仍以其唯一 logical target key结算。公开类型和文档必须明确key规则。

### 2D.6 P1：`dispatch()`绕过本地 params contract preflight

`send()`与`sendAll()`在任何 discovery/wire副作用前调用 `#validateData(method, 'params', data)`；`dispatch()`和`dispatchAll()`没有。无效dispatch仍会启动 discovery并发出报文，直到接收端静默拒绝，调用方只可能从异步 hook观察失败。这使同一个 method因调用形态不同而具备不同契约边界。

dispatch入口必须同步执行同一params validator；校验失败时不得创建 discovery、task或wire副作用。`dispatchAll()`只需在fan-out前验证一次，内部dispatch可避免重复验证。

### 2D.7 P2：`onQuery()`允许多次注册，实现却只调用第一个 listener

manual query listeners存放在 `Set`，每次 `onQuery()`都返回独立 disposer，公开API也没有“只能注册一个”的冲突契约；receive却通过 `values().next().value`只取首项。第二个及后续 listener注册成功但永久空转，首项注销后受理者又会静默变化。

需要明确唯一owner或广播观察者模型。建议受理能力只允许一个handler并在重复注册时同步报错；若允许多个listener，则必须定义 accept/reject竞争并用一次性 settlement保证只有一个获胜，其他listener只观察终态。

### 2D.8 P2：automatic refresh清空 metadata中的 pinned状态

同一receiver收到后续 discovery response时，remote entry被整体覆盖为 `pinned:false`，同时 `#pinnedReceivers`仍保留pin。路由仍按pin执行，但 `getServerList()`向用户报告未pin；`registeredAt`也被重置，使“首次注册时间”和“最近发现时间”混为一体。

refresh必须保留已有 `registeredAt`和 `pinned`，只更新 `lastSeenAt`、可信metadata及status。pin状态应只有一个canonical owner，避免Map与entry双写漂移。

结论：仍无落地决策block；8项均有确定修复路径。持续补丁的共同根因是operation scope没有成为一等抽象：deadline、discovery session、manual capability和fan-out delivery各自维护局部标识与生命周期。应优先抽取`OperationDeadline`、`DiscoverySession`和canonical `DeliveryKey`，否则继续在每个入口修timer/key会反复出现同类缺陷。

## 2E. 第十七轮全包对抗基线（2026-08-11）

本节在2D的operation-scope修复之后，重新攻击provider/replay、framing transfer ownership、capability snapshot、factory默认身份和adapter terminal lifecycle。2D的8项已关闭，本节只记录新增问题。

| 本轮新增 |  数量 |
| -------- | ----: |
| P0       |     0 |
| P1       |     0 |
| P2       |     0 |
| **合计** | **0** |

2E.1–2E.8 均已在当前工作树关闭；下列条目保留根因、修复边界和回归证据，标题中的历史严重度不代表仍有未关闭缺陷。

### 2E.1 P0：默认 connect无法认证无静态metadata的独占点对点transport

public factory强制安装connect；`useBaseIdVerifyOnly`默认开启。但base check只接受peerId、匹配origin或匿名BroadcastChannel。Memory pair、无options的DedicatedWorker、MessagePort、SharedWorker port和部分ServiceWorker通道虽然由连接拓扑提供独占peer边界，却通常没有peerId/origin，且source不参与默认binding，因此所有首次query/request都会被拒绝。

当前测试只证明这类factory能构造，功能测试则多绕过factory直接创建无connect endpoint，掩盖了默认公共路径不可用。

当时拟引入transport identity capability，但该方案已被后续2F.1判定为设计回归并回退；当前实现改为：

- Worker/MessagePort/Memory/WebTransport/RTCDataChannel按点对点连接绑定首个senderId；
- Iframe依赖origin/source/peerId等地址信息；
- BroadcastChannel无唯一指纹时按匿名组降级。

platform是公开且必需的规范分类；连接绑定token保持在endpoint内部，不作为第二个公开枚举字段。

### 2E.2 P1：invalid request与已完成request的replay都会放大response

ProviderExecutor在params validation失败时位于controller/replay/finally之前：每次重复无效request都会再次发送failure response，且不会写completed tombstone。即使是已正常完成的request，`isReplay`分支也主动发送一条duplicate failure。已认证攻击者因此可无限重放同一小报文，迫使endpoint持续执行validator、encode和transport send。

anti-replay命中后应静默丢弃并发采样hook，或使用有界response cache返回完全相同的幂等结果；不能每次生成新failure。params-invalid终态也必须进入同一replay state machine，并在response发送成功与失败下都有有界tombstone。

### 2E.3 P1：ping variation没有freshness、replay或admission预算

discovery和request已有timestamp/replay/budget，ping/pong/abort variation却没有sentAt。任何已认证peer都可无限重放同一个ping，目标每次都会立即发送pong；该路径不进入provider replay、automatic discovery admission或per-peer速率限制。

variation必须进入统一control-frame envelope：包含sentAt，按verified peer执行freshness与有界replay/admission。重复ping不得产生重复pong；高频拒绝hook必须采样，避免日志成为第二次放大。

### 2E.4 P1：WebTransport read reject报告错误但不进入terminal state

datagram EOF会设置`closed=true`，但`reader.read()` reject只通知transportErrors后离开read loop，`closed`仍为false。endpoint只结算当时pending；因adapter不再有活跃read owner且已有subscription不会重新触发`read()`，后续send仍成功写出，新的`timeoutMs:false`请求会永久等待无法到达的response。

reader acquisition/read failure与EOF必须共享同一terminal transition：原子设置closed、清listener、报告一次error，并使后续send/subscribe稳定失败。若某类WebTransport错误可恢复，则必须实现显式restart/backoff owner，不能停在“看似open但无人读取”的状态。

### 2E.5 P1：RTCDataChannel terminal listeners由borrowed adapter永久持有

adapter创建时立即向channel注册`closing/close/error`三个listener；transport标记为borrowed且没有close/dispose方法，endpoint dispose只移除message和内部error subscriber，永远不会从channel移除三个terminal listener。反复创建/销毁endpoint会让channel持续保留adapter闭包和listener sets。

terminal listener应与首个`onTransportError`或subscribe lease一起惰性安装，并在最后一个lease释放时成组移除；或adapter暴露独立幂等dispose且由endpoint无论ownership都释放adapter-local subscriptions。borrowed只表示不关闭底层channel，不表示可以泄漏监听器。

### 2E.6 P1：capability clone可被`__proto__`改变原型并绕过freeze

`cloneCapability()`为plain object创建普通`{}`，再用`clone[key] = child`复制own entries。null-prototype配置若含own `__proto__`，赋值会修改clone原型而不是创建own property。随后`isPlainObject()`因原型已变而返回false，`freezeCapability()`把整棵对象当opaque leaf跳过冻结。

plain-object clone必须使用`Object.create(null)`或`Object.defineProperty`复制全部own descriptors；symbol、non-enumerable和accessor策略也必须明确，禁止通过赋值触发legacy prototype setter。

### 2E.7 P1：chunked send重复消费同一transfer list并可能半发送

outbound pipeline切块后对每个part都调用transport send，并把同一`options.transfer`传给所有part。真实postMessage transferables在第一次发送后即detached；第二块通常抛DataCloneError。接收端已经拿到前缀chunk并保留assembly/timer，调用方得到transport failure，形成可重复的半发送与资源占用。

framing层必须拥有transfer语义。最小安全策略是在需要chunk时拒绝非空transfer list，且必须在发送第一块前拒绝；若要支持，wire需设计一次性side-channel或首帧ownership及接收端关联规则，不能简单复用数组。

### 2E.8 P2：transport类型仍把安全关键platform标成optional/diagnostic-only

factory与endpoint运行时已强制合法platform，connect又依据platform选择anonymous BroadcastChannel规则；但`IWebRpcTransport.platform`仍是optional，注释还称“only for diagnostics and receiver metadata”。类型允许的自定义transport会在运行时被拒绝，且文档隐藏了它对身份策略的影响。

platform应改为required，并把注释改为“adapter-owned platform identity”。进一步按2E.1引入独立identity capability后，platform只负责平台分类，安全策略读取capability而非字符串。

结论：本轮出现1个真实P0，但仍不是决策block。需要先补transport identity capability，才能保证默认公共API在所有内置adapter上有一致bootstrap语义。其余问题均有确定实现路径；2E.2/2E.3表明replay owner必须覆盖所有可触发出站副作用的入站frame，不能只保护provider成功路径。

## 2F. 第十八轮全包对抗基线（2026-08-11）

本节以2E修复后的当前源码为准。2E列出的replay、variation freshness、WebTransport terminal、RTC listener、capability `__proto__`、chunk transfer和platform required均已实现；本轮重点检查这些修复是否遵守既有设计决策，以及新抽象之间的组合边界。

| 本轮新增 |  数量 |
| -------- | ----: |
| P0       |     0 |
| P1       |     0 |
| P2       |     0 |
| **合计** | **0** |

2F.1–2F.9 均已关闭：公开transport只保留required `platform`，exclusive连接绑定首个senderId，discovery session按最长caller deadline管理，fan-out key使用tagged canonical key，ping能力、capability accessor、WebTransport迟到错误订阅和hook事件快照均已覆盖。

### 2F.1 P0：新增`transport.identity`违反“只用platform分类”的既定决策

此前已明确：web-rpc面向browser，identity类型只使用`platform`，不再增加kind/runtime或第二套分类字段。当前实现却新增`identity: 'exclusive' | 'addressed' | 'broadcast'`，所有内置adapter重复声明；factory运行时把它当required，公开`IWebRpcTransport`类型却仍标为optional。

后果同时包含设计漂移和破坏性API不一致：按公开类型实现、只提供platform的custom transport可通过TypeScript，却在`createEndpoint()`稳定报`INVALID_CONFIG`。platform与identity还可提交矛盾组合，例如`platform:'BroadcastChannel', identity:'exclusive'`，当前factory只分别验证枚举，不验证组合矩阵。

修复应遵守既定决策：删除public identity字段，由canonical platform映射内部策略：Worker/MessagePort/Memory/WebTransport/RTCDataChannel为点对点，Iframe为addressed，BroadcastChannel为broadcast。若某个platform内部确有不同安全拓扑，应由具体adapter提供不可伪造的内部binding token，而不是再公开一套用户可随意声明的枚举。

这不是待决block；用户决策已经存在，属于实现回归。

### 2F.2 P1：exclusive只验证target，不绑定物理连接与senderId

当前exclusive base check等价于`context.targetId === endpoint.id`。同一物理peer可依次声称任意senderId，每个声明都会在VerifiedPeerRegistry生成新binding；receive随后把这些senderId加入learned peers。恶意或异常peer可污染fan-out目标并绕过“一条独占连接对应一个endpoint身份”的语义。

点对点bootstrap必须建立反向唯一binding：同一adapter connection token首次绑定一个senderId后，其他senderId稳定拒绝，除非协议明确支持该连接上的multiplex并提供独立认证。不能把“来源只能来自这根线”误写成“这根线上的所有逻辑身份都可信”。

### 2F.3 P1：automatic discovery被内部固定1000ms截断

为修复shared waiter泄漏，底层session现在无条件使用1000ms timer。caller虽然仍有自己的timeout race，但`timeoutMs:false`或5000ms的send/ping在目标1500ms后响应时仍会被底层session提前reject。这与文档“automatic discovery不再固定1000ms”及`false`无限等待语义直接冲突。

应把“等待首个response”和“首响应后的广播收集窗口”拆开：首响应前session至少存活到仍在订阅的最长caller deadline；首响应后才启动固定有界collection timer。无限caller存在时不能靠硬编码1秒改变公开等待语义，可通过最后caller离开、dispose或显式系统级maxDiscoveryLifetime回收。

### 2F.4 P1：所谓collision-free fan-out key仍存在跨domain碰撞

匿名delivery key直接使用`targetId`；具名receiver key使用`JSON.stringify([targetId, receiverId])`。因此匿名targetId恰好为`["a","b"]`时，会与target `a`、receiver `b`的复合key完全相同，后写结果仍覆盖先写结果。

key必须给domain加不可混淆tag，例如统一编码`['target', targetId]`与`['receiver', targetId, receiverId]`；不能让一个分支使用裸用户字符串、另一个分支使用看起来结构化的用户可构造字符串。更稳妥的是返回结构化delivery数组而非Record。

### 2F.5 P1：未安装ping capability的endpoint仍会响应入站ping

公开`ping()`受`features.ping`保护，但receive对任何已验证`variation:'ping'`都无条件发送pong。也就是说类型和运行时声称没有ping capability的endpoint，wire层仍公开ping responder，可被用于存活探测和出站流量触发。

ping capability必须同时控制initiator和responder；未安装时入站ping应静默拒绝或发采样diagnostic，不能发送pong。若协议要求所有endpoint强制响应ping，则ping不应再被建模为optional middleware，类型与文档都应改为core能力。

### 2F.6 P1：capability snapshot保留accessor，freeze后仍可动态变值

`cloneCapability()`已安全处理`__proto__`，但它原样复制getter/setter descriptor；`freezeCapability()`只递归data descriptor。配置getter因此在factory freeze后仍会执行原闭包并返回变化值，甚至在endpoint构造对同一字段的多次读取间改变类型，重新引入TOCTOU。

plain capability snapshot应拒绝accessor，或在受控try/catch中只求值一次并转换为不可写data property。需要保留动态行为的能力必须显式使用函数值，不能通过property getter绕过snapshot ownership。

### 2F.7 P1：WebTransport可在error subscriber安装前丢失同步terminal failure

endpoint构造顺序是先`transport.subscribe()`，再注册`onTransportError()`。WebTransport subscribe立即启动async read；若`getReader()`同步抛错，`read()`会在返回Promise前进入catch并transition terminal，此时transportErrors集合仍为空。随后endpoint才注册error listener，adapter不会重放已发生的terminal error，factory最终返回一个transport已closed但endpoint仍active的实例。

terminal adapter必须保存terminal cause，并让迟到的首个`onTransportError`订阅立即收到一次，或endpoint统一先注册error channel再启动message subscription。构造完成前发生的terminal transition必须使factory失败并进入rollback，不能只留一个不可用实例。

### 2F.8 P2：USEGUIDE仍描述旧的peerId/origin要求

当前实现已把Worker等adapter视为exclusive，但USEGUIDE仍说DedicatedWorker必须配置matching peerId或origin，否则base verification失败。文档与运行时相反，会诱导用户添加并不存在必要性的静态identity配置。

文档应在移除identity枚举后按platform解释默认base check，并明确逻辑senderId仍如何绑定到物理connection token。

### 2F.9 P2：hook event是共享可变对象，listener可污染后续观察者

`#emit()`创建普通对象，HookRegistry按顺序把同一引用交给所有listener。尽管类型字段readonly，首个listener可在运行时改写name/code/receiverIds，后续同步或异步listener看到的就不再是框架原始事件；异步listener之间还存在时序依赖。

hook payload应至少浅冻结，数组字段也复制并冻结；若error/contract等字段保持opaque，应在文档说明只冻结事件envelope。纯观测hook不能允许一个观察者改变另一个观察者的事实视图。

结论：仍无需要用户继续拍板的设计block。最高优先级是撤销2E修复引入的第二套identity枚举，回到platform-only决策，并建立内部connection-token到senderId的唯一binding。连续几轮反复出现的问题不是缺少更多枚举，而是物理来源、逻辑身份和业务target三个域仍未由一个canonical binding owner统一管理。

## 2G. 第十九轮全包对抗基线（2026-08-11）

本节以2F修复后的当前源码为准。platform-only、tagged fan-out key、ping capability、accessor snapshot、hook freeze和WebTransport terminal replay均已落地；本轮继续攻击identity commit顺序、共享replay容量、control-frame乱序及deadline registry所有权。

| 本轮新增 |  数量 |
| -------- | ----: |
| P0       |     0 |
| P1       |     0 |
| P2       |     0 |
| **合计** | **0** |

2G.1–2G.8 均已关闭：exclusive binding 在认证成功后提交且具备竞争保护；业务 replay 与 control replay、variation admission 分离；乱序 abort 进入有界 pending 状态；discovery timer 由统一 registry 引用管理；verified token 刷新保持 task ownership；replay TTL 严格覆盖 wire freshness；fan-out 注释与 tagged key 语义一致。

### 2G.1 P0：exclusive sender在认证完成前写入，可被首帧永久抢占

`#verifySource()`在existing-binding检查和`connect.verify()`之前执行`#exclusiveSenderId ??= envelope.senderId`。任意到达独占transport的首帧——包括最终identifier返回false的帧、无pending的伪造response或错误senderId——都会先占用logical sender lock。真实peer之后即使认证材料正确，也只会收到`EXCLUSIVE_BINDING_CONFLICT`，endpoint生命周期内无法恢复。

binding commit必须发生在verify成功且generation仍active之后。认证前只能读取candidate，不得修改exclusive owner；失败、异常、dispose竞争都不能留下sender state。若两个首次验证并发，必须由单一compare-and-commit决定赢家，失败者不得覆盖或部分注册。

### 2G.2 P0：variation洪泛可挤掉request replay tombstone并重新执行provider

ReplayWindow把request、manual/automatic discovery、ping和abort的completed key全部放进同一个4096-entry Map。已认证peer发送4096个不同taskId的ping/abort即可按oldest-first驱逐业务request tombstone；随后重放仍在5分钟freshness窗口内的旧request，ProviderExecutor会再次执行真实业务副作用。

这是跨namespace容量攻击，不是单纯日志或性能问题。request replay安全域必须拥有独立quota/retention，不能被低价值control frame驱逐。variation还需要per-peer admission；满载时应优先拒绝新control frame，绝不能牺牲已完成业务task的防重放证明。

### 2G.3 P1：variation只有去重，没有unique-task admission

当前ping/abort replay key只能阻止相同taskId重复；攻击者持续换taskId仍会触发每次认证、ReplayWindow写入以及ping对应的pong发送。automatic discovery已有global/per-peer admission，variation没有，因此2E要求的“replay/admission”只实现了一半，并直接导致2G.2的驱逐攻击。

control-frame owner应提供独立global/per-peer token budget、freshness和replay；超限frame在任何出站pong和共享状态写入前拒绝。

### 2G.4 P1：乱序abort会被提前消费，后续真实provider无法再取消

abort收到后立即写variation replay tombstone，即使对应active controller尚不存在。WebTransport datagram等无序通道可能让abort先于request到达：第一次abort查不到controller却已标completed；request随后启动provider，重传或后到的同一abort被判replay而丢弃，取消永久失效。

需要短期pending-abort状态：abort先到时记录“该verified task到达即取消”，request admission创建controller后立即消费；或仅在确实命中controller时提交abort replay。无论方案如何，乱序、重复与expiry必须共享一个control-task状态机。

### 2G.5 P1：discovery timer替换和caller提前离开会泄漏registry entry

延长existing discovery deadline时实现创建新timer并写`existing.timer`，却没有把新timer写回`#discoveryTimers`；Map仍保存已经clear的旧timer。`#joinDiscoveryWaiter().finally()`在最后caller离开时也只clear waiter.timer，没有删除对应Map entry。大量不同未知target超时或abort后会持续累积已失效timer wrapper，直到endpoint dispose。

session必须只有一个timer owner和一个原子replace/clear方法，同时更新waiter、registry与deadline。任何success、failure、last-caller-leave、send failure和dispose路径都调用同一cleanup，禁止分散操作两个引用。

### 2G.6 P1：verified binding token轮换会拆开长任务的controller身份

VerifiedPeerRegistry在binding满5分钟后删除旧entry并为同一物理来源/sender签发新token；active controller和request replay key都包含该token。运行超过5分钟的provider仍持有旧token时，同源重放可获得新token，从而绕过`controllers.has()`并并发执行第二份相同task；新token下的abort也找不到旧controller。

verified source identity必须在物理binding未改变时保持稳定token，只刷新认证时间；expiry应要求重新验证但不能换掉task ownership key。若确需轮换，必须保留old→new alias直到所有active task完成。

### 2G.7 P1：freshness与replay TTL在等号边界出现重放窗口

request freshness接受`sentAt >= now - 300000`，ReplayWindow却在`now - createdAt >= 300000`时删除tombstone。快速完成的request在恰好5分钟边界上仍被wire视为fresh，但防重放记录已过期，可再次执行。binding age也使用相同`>=`边界，加剧token轮换问题。

replay retention必须严格长于最大wire freshness和允许clock skew，包含调度误差；或freshness改为严格大于并用同一个ClockPolicy计算。三个独立300000常量不能各自定义边界。

### 2G.8 P2：fan-out helper注释仍宣称匿名key是裸targetId

实现已改为`['target', targetId]`与`['receiver', targetId, receiverId]`的tagged JSON key，但helper注释仍写“keeping anonymous groups on targetId”。注释会诱导后续维护者恢复裸key，重新引入2F碰撞。

注释和主SDD应明确anonymous group只是语义上对应target，返回key仍使用tagged canonical encoding。

结论：没有新的落地决策block。两个P0都来自“认证/replay状态按收到frame立即写入”，而不是按验证成功或资源优先级commit。下一步应把identity commit、request tombstone和control-frame admission收进同一个分层security-state owner；继续给共享Map添加字符串前缀不能提供隔离。

## 2H. 第二十轮全包对抗与反复返修归因（2026-08-11）

本轮不沿用“上一轮已关闭”的假设，重新检查 public API 到 wire commit 的完整路径，并把测试断言反向映射到资源、终态和负向副作用。结论：没有新的产品决策 block，但 2G 的“全部关闭”判断过早；部分修复只覆盖直接症状，没有建立可复用的不变量 owner。

| 本轮新增 |  数量 |
| -------- | ----: |
| P0       |     0 |
| P1       |     0 |
| P2       |     0 |
| **合计** | **0** |

2H.1–2H.6 已关闭：pending abort 具备 TTL purge 与 hard cap；retry policy 受 operation deadline 约束；settlement 完成后禁止 pending/wire commit；send、dispatch、ping 使用 generation guard；revoked candidate 集合有容量上限；architecture gate 同时检查 `bind/call/apply`。

### 2H.1 P0：乱序 abort tombstone 只有写入和命中删除，没有 expiry purge

`#pendingAborts` 在未找到 active controller 时写入 `expiresAt`，但当前只有对应 request 到达时才读取并删除，dispose 时才整体清空。若已认证 peer 持续发送不同 taskId 的 abort，variation admission 只限制每个 60 秒窗口，跨窗口仍可持续增加 Map；过期 entry 不会自行删除，也不会在后续 admission 时 purge。2G.4 所称“短期有界 pending-abort 状态”实际只实现了时间戳，没有实现时间或容量边界。

这是可远程触发的生命周期内存耗尽。control-task owner 必须同时管理 TTL、global/per-peer capacity、admission、consume 和 dispose；任何 expired entry 在新 admission 前 purge，并用 hard cap 保证时钟停滞或攻击流量下仍有绝对上限。测试必须跨多个 admission window 证明 Map 基数受限，不能只证明一个 abort 能被后到 request 消费。

### 2H.2 P1：异步 retry policy 不受 operation deadline 控制

`executeWithRetry()` 已用 closing/user signals 包围 `decide()`，因此 abort/dispose 可中断；但 endpoint 的总 deadline 没有成为 signal，也没有作为 timeout 传入 policy race。`shouldRetry()` 或 `delay()` 返回永不 settle 的 Promise 时，只要用户不 abort、endpoint 不 dispose，带有限 `timeoutMs` 的 `send()` 仍可永久 pending。当前“每次 attempt 前计算 remaining”只在 policy 返回后生效，不能约束 policy 本身。

总 deadline 必须覆盖 discovery、selector、request、retry decision 和 backoff 全事务。应由 operation scope 产生统一 deadline signal/remaining budget；禁止每层自行检查一次时间后再无限 await。测试需证明 policy 永不 settle 时，公开 send 在 deadline 到达后以 `WebRpcTimeoutError` 结束，且迟到 resolve/reject 被观察、没有下一 attempt。

### 2H.3 P1：`#request()` 可在 settlement 已结束后重新登记 pending 并发送

`#request()` 先创建 settlement，再注册 abort listener和校验 timeout，最后无条件执行 `#pending.set()` 与 transport send。若 hostile/custom AbortSignal 在 listener registration 中把 `aborted` 改为 true，或可执行 timeout resolver 在二次读取时产生终态，`settleReject()` 会先完成 cleanup；随后函数仍把已终结 task 放回 registry并发送 request。现有“cancellation races listener registration”测试只断言调用方拿到 rejection，没有断言 wire 为空、pending 为空和 timer/listener 全部释放。

admission 与 settlement 必须是单向状态机：`preflight → register → commit send → settled`，settled 后禁止任何 registry write 或外部副作用。最小修复是在每个可执行边界后检查 settlement/operation scope；正确架构是让 pending owner 原子执行 register-and-start，并返回唯一 cleanup token。

### 2H.4 P1：异步 send/dispatch 在 dispose 竞争中缺少最终 commit guard

公开入口只在调用开始执行 `#assertActive()`。随后 discovery、receiverSelector 和 Promise continuation 可跨越 dispose；`#receiverForTarget()`、`#request()` 与最终 `#send()` 前没有统一 generation/closing commit 检查。部分路径会因 discovery/getServerList 间接失败，但已知 receiver、selector 刚完成或 request 尚未登记等窗口仍依赖偶然调用链，而不是生命周期契约。结果可能是 dispose 已开始后才创建 pending、发送 request/dispatch，随后资源 owner 已被清空，形成迟到副作用或悬挂状态。

每个公开 operation 必须捕获 generation，并在每次 await 后及 transport commit 前调用同一 `assertOperationActive(generation)`；dispose 先关闭 admission，再等待或取消已登记 operation，最后释放 transport。不能依赖某个辅助函数碰巧调用 `#assertActive()`。

### 2H.5 P2：manual revoked receiver key 生命周期内单调增长

`#manualRevokedCandidates` 在每次 unregister 时写 key，只在 dispose 清空。它阻止旧 candidate 被重新注册有安全价值，但没有 TTL、容量或 generation owner；长期运行且持续发现/注销动态 receiver 的调试或管理端会永久积累字符串。该集合不是远程直接写入，因此低于 2H.1，但仍违反“长期状态必须有预算”的包级原则。

应把 candidate proof、registered/revoked 状态和 expiry 收进一个 manual-candidate registry；过期 proof 与对应 revoked key 同步淘汰。若注销必须永久有效，则需要稳定 server generation/credential，而不是 endpoint 内无界字符串黑名单。

### 2H.6 已关闭：架构门禁覆盖 bind/call/apply

`architecture.test.ts` 现使用 `/\.(?:bind|call|apply)\s*\(/g`，并扫描 production 与 test source，门禁与 `AGENTS.md` 的强制规则一致；当前源码未发现三类调用。

### 2H.7 为什么几轮修复仍频繁产生新问题

#### 直接原因：验收只证明正向结果，没有证明终态后的禁止行为

多处测试只检查 Promise resolve/reject、hook 出现或单个 Map 命中，没有同时检查“不发送、不重登记、不留 timer/listener、不增长资源、历史状态不被重开”。因此修复能让目标断言变绿，却把副作用留在同一 continuation 后半段。2H.3 是最直接证据：rejection 正确，但 registry 与 wire 仍可能错误。

#### 架构原因：`WebRpcEndpoint` 同时拥有过多互相耦合的状态机

endpoint 同时编排 identity、DNS/discovery、pending request、ping、provider controller、replay、variation、retry、timer 和 dispose。状态分散在多个 Map、WeakMap、Set、timer registry与 Promise continuation 中；同一 operation 没有唯一 phase、generation、deadline 和 resource scope。局部 patch 只能在最近分支补 cleanup，无法证明所有入口共享同一不变量。这是持续返修的主要技术根因。

需要收口为至少三个 canonical owner：

1. `OperationScope`：统一 generation、deadline、abort、settlement 和 transport commit guard。
2. `ControlTaskRegistry`：统一 variation replay、pending abort、TTL、global/per-peer budget 和 consume。
3. `DiscoveryRegistry`：统一 automatic/manual session、candidate proof、DNS、pin/revoke 与 timer/resource ownership。

endpoint 只编排 owner，不直接跨多个集合修改同一事务。该调整是架构 TODO，不是产品设计 block；不需要重新决定 public API 或 wire 语义。

#### 流程原因：finding、架构不变量和测试之间没有可追踪闭环

SDD 记录大量“已关闭”，但没有强制维护 `finding → owner → invariant → adversarial test → gate` 矩阵。修复后只按文件或单测判断关闭，下一轮才从邻接路径发现同类缺口。2G.4 已要求有界 pending-abort，实际测试没有验证跨窗口容量；说明关闭依据停留在代码形状，不是行为证明。

后续每个 finding 必须登记：唯一 owner、允许状态、终态禁止动作、绝对资源上限、竞争矩阵和对应测试名。缺任一项不得标记 closed。

#### 工程原因：门禁结果被分散执行，且 dirty worktree 中存在并行演进

当前包变更跨 endpoint、factory、adapter、utility、typing、docs 和大量测试；单轮常只运行与当前 patch 最近的测试。即使最终 suite 通过，type/build/architecture 门禁也可能未在同一源码快照执行，文档状态还可能引用前一快照。并行 agent 在共享 dirty worktree 修改相邻 owner 时，会进一步削弱“某次通过对应哪份实现”的可追溯性。

每次关闭 finding 必须记录同一 Git tree/hash 或至少同一 status snapshot 下的 `fmt → lint → typecheck → test → build`；共享工作树发生变化后，旧结果自动失效。评审 agent 不能根据历史通过记录宣布当前实现完成。

### 2H.8 归因结论：既需要补丁，也需要架构收口

- 2H.1–2H.6 已由明确补丁、owner 迁移和回归测试关闭。
- 2H.4、2H.5 已由 `OperationScope` 与 registry owner 收口，endpoint 仅编排公开 API 与 transport 副作用。
- 频繁返修的根因已通过 owner、终态禁止动作、资源上限和竞争测试矩阵固化，后续修改必须沿同一 owner 边界扩展。
- 2H.1–2H.8 的关闭依据为 owner 级测试与同一工作树上的 fmt、lint、typecheck、build、test 门禁。

#### 2H.9 迁移追踪矩阵（已完成）

| finding            | canonical owner                       | 当前不变量                                                                                                     | 对抗证据                                                           | 状态   |
| ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| 2H.1 / 2G.4        | `ControlTaskRegistry`                 | pending abort 有 TTL、hard cap、consume 后删除；variation replay/admission 同一 owner                          | `internal/control-task-registry.test.ts`、endpoint variation tests | 已完成 |
| 2H.2               | `OperationScope` + `executeWithRetry` | send/dispatch/ping 的 policy、backoff、discovery、selector 共享 operation deadline                             | `internal/retry.test.ts`、endpoint timeout tests                   | 已完成 |
| 2H.3 / 2H.4        | `OperationScope` + `PendingRegistry`  | settled/generation 之后禁止 registry 与 wire commit；pending commit 有 owner guard                             | `internal/pending.test.ts`、endpoint timeout-race tests            | 已完成 |
| discovery 全部状态 | `DiscoveryRegistry`                   | automatic/manual waiter settle、inbound query take/expiry、candidate/revoke、DNS/pin、timer 写入已有 owner API | `internal/discovery-registry.test.ts`、endpoint 回归套件           | 已完成 |
| 2H.7/2H.8          | owner matrix                          | 每项 finding 有 owner、终态禁止动作、资源上限、竞争测试和统一门禁                                              | 本表、41 suites / 201 tests 回归门禁                               | 已完成 |

## 2I. 第二十一轮 P0 触发全包扫描（2026-08-11）

本轮在 2H 修复并发落地后的最新工作树上重新扫描全部 production source、public types、wire normalization、identity/replay、operation/provider、discovery/control、middleware/factory、九类 adapter、文档与工程门禁。2H 的 pending-abort P0 已被 `ControlTaskRegistry` 的 TTL 和 hard cap关闭，但扫描发现新的 P0，因此按约定不再增量抽查，而是建立完整资源/身份/终态清单。

| 本轮新增 |   数量 |
| -------- | -----: |
| P0       |      4 |
| P1       |     11 |
| P2       |      4 |
| **合计** | **19** |

### 2I.1 P0：业务 replay window 满时淘汰仍新鲜 tombstone，可重复执行 provider

`ReplayWindow.rememberCompleted()` 在 4096 条上限时 oldest-first 删除记录，不区分记录是否仍处于 310 秒 replay TTL。已认证 peer 可在 freshness 窗口内提交足量不同 request，驱逐最早的 completed key，再重放仍满足 wire freshness 的原 request。`ProviderExecutor` 会把它视为新任务并再次执行付款、写入或通知等副作用。2G 只把 control replay 与 business replay 分离，没有解决 business 域内部的 fresh eviction。

修复 owner：新增非淘汰式 `RequestReplayLedger`。未过期 tombstone 绝不能因容量压力删除；global/per-peer quota 满时拒绝新的 request admission并返回稳定 `OVERLOADED`，直到 TTL purge 释放容量。为避免单 peer 饿死全局容量，先执行 per-peer quota，再使用有保留份额的 global quota；被拒 request 也写入短 TTL rejection ledger，防止重试放大。不得通过扩大 4096、缩短 TTL 或恢复 at-least-once 文档来规避。

必测：容量边界前后重放、跨 peer公平性、TTL 释放、拒绝不执行 provider、dispatchOnly 副作用、clock boundary、dispose 清理。

### 2I.2 P0：verified binding 容量淘汰会轮换 token，并绕过 replay/controller identity

`VerifiedPeerRegistry.register()` 在 global/per-origin 满载时直接删除 oldest binding。相同物理来源随后重新注册会获得新 `verified-peer-N` token；request replay key 与 active controller key都包含 token。攻击者可制造其他 sender binding挤掉自己的旧 token，再以同一 source/sender 重放 request；新 token 使 replay tombstone和 active controller均无法命中，造成并发或重复执行。该问题不是普通连接抖动，而是 identity capacity policy 改写安全主体。

修复 owner：`VerifiedIdentityLedger` 使用稳定 binding identity 和 lease。任何仍被 active task、pending response、replay tombstone或 discovery binding引用的 identity 不得淘汰或换 token；容量满时拒绝新 binding，而不是牺牲已有 identity。entry 维护 active/replay refcount或 generation lease，只有所有 lease释放且认证 age过期后才能淘汰。per-origin quota必须在认证提交前执行，失败不修改现有 binding。

必测：capacity flood 后旧 request仍命中 replay、长 provider不被新 token拆分、active abort命中原 controller、同源不同 Window/source不合并、expiry 与 freshness边界。

### 2I.3 P0：active provider task 没有 global/per-peer并发上限

入站 request 通过认证和 replay检查后，只检查同一 controller key是否已存在；不同 taskId均可创建 `AbortController` 并启动 provider。已认证 peer 可持续发送唯一 taskId，使 `#activeControllers`、provider Promise、业务资源和响应闭包无界增长。chunk、discovery、variation都有预算，真正执行业务副作用的 provider反而没有 admission budget。

修复 owner：新增 `ProviderAdmissionRegistry`，在任何 schema parse和 provider执行前原子申请 global/per-peer token；完成、abort、timeout、transport terminal和dispose均由同一 lease释放。满载返回稳定可分类的 `OVERLOADED` response，绝不调用 provider。配额应可配置但有安全默认值，并区分短请求与 dispatchOnly，禁止通过 dispatch绕过。

必测：永不 settle provider洪泛、per-peer隔离、global公平性、abort/dispose release、schema failure不占永久槽、response send failure仍release、dispatchOnly同样限流。

### 2I.4 P0：Window 与 ServiceWorker 的 transport topology 不能证明真实来源

Window adapter用同一个 `endpoint` 同时执行 `postMessage()` 和 `addEventListener()`，只把 `targetOrigin`作为 transport origin；默认 base verify接受任意匹配 origin，却不要求 `event.source`等于预期 target Window。同源 sibling可伪造 senderId、抢先响应或调用 provider。ServiceWorker adapter保留了 `event.source`，但 core把全部 `platform:'Worker'`视为 exclusive channel，首次声明 sender即可占用 binding；多 client共用 ServiceWorker消息面时，这既可被首帧抢占，也允许错误 client成为可信 sender。

修复 owner：platform继续是唯一公开 identity discriminator，不新增 `kind`。transport内部增加独立的 topology/source-proof capability：`exclusive | multiplexed | broadcast`，以及 adapter-owned `expectedSource`或`derivePeerId(event)`。Window API拆分 receive target与send target，并强制 source equality + origin；ServiceWorker从 `Client.id`/明确 extractor派生 peerId，无法派生时必须使用 `useBaseIdVerifyOnly:false` 的 identifier，不能套用 exclusive TOFU。SharedWorker/MessagePort等真正独占通道显式声明 exclusive；BroadcastChannel保留文档化 anonymous broadcast例外。

必测：同源 sibling spoof、错误 Window source、多个 ServiceWorker client、首帧抢占、source getter抛错、跨 realm source、正确 exclusive channel不回归。

### 2I.5 P1：outbound reserved ID 满载淘汰仍新鲜 ID，迟到 response可结算新任务

`ReplayWindow` 同时以 oldest-first维护 `reservedIds`。超过4096个 outbound ID后，仍在 replay窗口内的 ID可被自定义 generator再次分配；旧 response若 method/target相同，可结算新 pending。修复为独立 `OutboundIdLedger`：未过期 ID不可淘汰，满载时稳定拒绝新 operation；默认随机 generator与自定义 generator遵守同一规则。不能用“随机碰撞概率低”代替协议证明。

### 2I.6 P1：BroadcastChannel 自定义 identity只在 discovery payload可见，业务帧无法复用认证

`uniqueTargetId`放在 discovery `data.__unique_id__`；普通 request/response/variation不携带它。`#verifySource()` 即使 `requireExisting=true` 也只先检查 registry，随后仍再次调用 identifier，而 identifier看到的是业务 data。对无 source/origin 的 BroadcastChannel，严格只验证 `__unique_id__` 的 identifier会让 discovery成功后所有 RPC失败；若为可用性放宽 identifier，又削弱认证。

修复：identifier只负责 discovery/bootstrap认证；成功后提交 immutable binding lease。所有业务和control frame必须 `requireExisting` 并直接取得同一 binding token，不再用业务 data重复认证。binding过期时重新 discovery，不允许业务帧现场创建 binding。anonymous BroadcastChannel组继续显式无实例认证，不能与 unique模式混用。

### 2I.7 P1：control replay同样淘汰仍新鲜记录，duplicate还会先消耗 admission quota

`ControlTaskRegistry` 的 replay容量1024，小于每窗口 variation global admission 4096；`admitVariation()`又先于`admit()`执行。重复 ping/abort会消耗 quota，足量唯一 frame可淘汰仍新鲜 replay记录并再次触发 pong或abort路径。修复为单一原子 `admitControl(peer,key)`：先无副作用检查 duplicate，再检查公平quota，最后提交非淘汰 tombstone；容量满拒绝新 control，不驱逐 fresh记录。

### 2I.8 P1：retry policy deadline被错误映射为取消错误

`executeWithRetry()` 给 policy race传入 `createTimeoutError: options.createAbortError`。deadline到达会抛 `WebRpcAbortError/CANCELLED`，而不是 `WebRpcTimeoutError/DEADLINE_EXCEEDED`，破坏调用方分类与 retry/hook语义。修复：executor显式接收 `createTimeoutError`；deadline与user abort/closing signal三类终态分别映射，测试断言 error class、code和无下一 attempt。

### 2I.9 P1：provider success transfer list在 endpoint bridge中被静默丢弃

`ProviderExecutor` 调用 `options.send(response, response.transfer)`，endpoint构造时提供的 callback却只接收`response`，再尝试从不含 transfer字段的 response对象读取 transfer。真实 transfer list因此永远不到 transport。修复 bridge签名为 `(response, transfer) => #send(response, transfer)`，并验证 chunked response拒绝 transfer、普通 response只传递一次、send failure仍保持单次 settlement。

### 2I.10 P1：provider result的 message/code/transfer缺少运行时归一化

brand只能证明 result由当前 context创建，不能防止 JavaScript调用方传入非字符串 failed参数、hostile transfer数组或之后修改引用。非法 response会发到 wire后被对端丢弃，调用方直到 timeout。修复由 `ProviderResultOwner` 在创建时snapshot/freeze并验证 message/code/transfer；transfer只接受有限长度安全数组，commit前不再读取用户可变对象。

### 2I.11 P1：ResourceScope中永不 settle的 middleware disposer阻断关键 transport cleanup

资源逆序释放时 middleware disposer先于 subscription/transport；任一 disposer永久 pending，`dispose()`及后续 unsubscribe/close永久无法执行。修复为分阶段 disposal：先关闭 admission并settle tasks，再无条件释放 transport subscriptions/reader/owned transport，最后运行 middleware/application disposer。每阶段拥有独立budget、迟到 rejection观察和cleanup report；关键资源不能排在不可信 async disposer之后。不得用裸 `Promise.race` 留下未观察 rejection或存活 timer。

### 2I.12 P1：MessagePort close未发布 terminal `closed`状态

adapter在`close`事件只 emit error，transport没有 `closed` getter；endpoint因此只失败当前 pending，不进入 terminal dispose。后续 `timeoutMs:false` operation可能继续提交到已关闭 port。修复所有terminal adapter共享状态机：原子设置`closed=true`、只报告一次、拒绝send/subscribe、使endpoint关闭 admission，并幂等移除listeners。

### 2I.13 P1：`DiscoveryRegistry` 仍是公开 Map集合的弱门面，不是真正 owner

新类公开十余个 `Map/Set/WeakMap<unknown>`，endpoint继续通过alias直接读写并在dispose重复clear；registry方法与直接mutation并存。它没有把状态转换、类型、不变量或cleanup封装起来，后续仍可绕过 owner重现旧问题。修复必须把集合改为私有强类型字段，只公开事务方法；endpoint禁止获取可变集合。迁移按automatic session、manual session、DNS/pin三个子域逐个完成，每个子域迁移后用architecture test禁止endpoint直接持有对应Map。

### 2I.14 P1：DiscoveryRegistry.clear不独立释放 manual outbound waiter资源

`clear()`清空`manualQueryWaiters`却不遍历其 timer和AbortSignal listener；当前依赖endpoint在调用registry.clear前手工释放。这证明owner仍不自洽。修复后registry必须能独立`close(reason)`：settle/reject全部waiter、清timer/listener，再清集合；endpoint只调用一次close，禁止双清。

### 2I.15 P1：ping listener registration失败会泄漏 OperationScope closing listener

ping先创建`OperationScope`，随后对用户signal和closing signal直接`addEventListener`，没有registration rollback。hostile signal抛错时函数在进入settlement前退出，scope留在closing signal上。修复由OperationScope统一注册全部signals并返回原子cleanup token；第N个registration失败时回滚前N−1个，不允许ping再单独订阅closing。

### 2I.16 P1：组合 receiverId没有执行派生长度校验

factory分别允许最大长度的 targetId与uniqueTargetId，BroadcastChannel再生成`${targetId}:${uniqueTargetId}`；组合值可超过 contract identifier limit，远端随后拒绝 receiverId，配置表现为静默不可发现。按既定决策，无效unique配置不得抛`INVALID_CONFIG`：factory应在开放endpoint前校验派生值，超限时忽略 uniqueTargetId并进入匿名广播组，同时发配置诊断；不得截断或hash后假装仍是用户ID。

### 2I.17 P2：custom transport/middleware callback的 context-free契约未公开

为遵守项目禁止`bind/call/apply`，factory和pipeline会snapshot后裸调用 send/subscribe/install。依赖`this`的方法会失败，但public类型看不出。README/USEGUIDE必须规定这些回调是context-free function并推荐箭头函数；内置adapter保持闭包实现。不能通过恢复`.call`修复。

### 2I.18 P2：custom byteLength返回值未验证，可绕过消息预算

chunk capability允许自定义byteLength，但pipeline直接信任负数、NaN或故意低估值，`maxMessageBytes/chunkSize`预算可失效。每次结果必须是非负safe integer，并用同一snapshot结果完成比较；安全上限应优先使用框架UTF-8计量，自定义函数只能用于明确协议且不得低于canonical encoded byte length。

### 2I.19 P2：remote DNS与outbound discovery session缺少全局目标数预算

每target虽限制64 receiver，但target数量和并发未知target discovery由本地调用无限扩展；长期把外部输入直接作为target的应用可积累remote cache和waiter。DiscoveryRegistry应增加global target/session cap、LRU stale purge和per-caller operation deadline；active pin/configured target不可被普通LRU驱逐。

### 2I.20 P2：factory异步middleware与uniqueTargetId初始化没有construction cancellation

install或uniqueTargetId factory永久pending会让createEndpoint永久悬挂。它属于本地插件信任域，非远程P0，但需要可选construction signal/deadline，由factory resource scope负责；取消后等待已开始cleanup并观察迟到rejection。默认值与breaking API须在主SDD确认后落地。

### 2I.21 无新增问题的统一修复方案

#### Owner与依赖方向

```text
adapters -> transport metadata snapshot
              |
              v
VerifiedIdentityLedger -> RequestReplayLedger / ControlTaskRegistry
              |                         |
              v                         v
      ProviderAdmissionRegistry     OperationScope
              \                         /
               \                       /
                WebRpcEndpoint orchestrator
                         |
                  DiscoveryRegistry
```

- foundation owner只依赖errors、safe-value、async-control等runtime-neutral模块；不得反向依赖endpoint、middleware或adapter。
- adapter只提供platform、topology和source proof，不决定业务identity policy。
- endpoint只编排事务，不直接持有这些owner的Map/Set，不新增第二套deadline、replay、binding或cleanup状态。

#### 固定迁移顺序

1. 先建立non-evicting freshness ledger与provider admission，关闭2I.1–2I.3；旧ReplayWindow在业务路径完全断开后才能删除。
2. 再迁移identity lease与adapter topology，关闭2I.4和2I.6；迁移期间禁止同时接受旧token与新token两套认证路径。
3. 将outbound ID和control replay迁到各自ledger，关闭2I.5、2I.7；不得共享容量池。
4. 完成OperationScope、ProviderResult和phased disposal，关闭2I.8–2I.12、2I.15。
5. 最后把DiscoveryRegistry变为私有强类型owner，关闭2I.13、2I.14、2I.16、2I.19；禁止endpoint alias兼容层长期存在。
6. 文档、context-free contract和construction cancellation最后同步，但不能用于掩盖前述runtime缺陷。

#### 非回归硬门禁

- 安全记录在TTL内绝不因容量压力淘汰；capacity只能拒绝新admission，不能改变既有主体、task或tombstone身份。
- 每个reject/timeout/abort/dispose后同时断言：wire无迟到发送、provider无执行、registry基数不增、timer/listener为零、迟到Promise已观察。
- 每个owner提供debug-only snapshot或测试observer，只暴露计数和phase，不暴露可变集合；对抗测试不得靠访问endpoint私有字段猜状态。
- 测试矩阵覆盖global/per-peer capacity、N−1/N/N+1边界、TTL前/等于/后、同源多source、跨realm、hostile getter/signal、terminal transport和dispose竞争。
- 每个patch先运行owner单测，再运行endpoint/adapter集成，最后在同一worktree snapshot执行`fmt → lint → typecheck → typecheck:core → typecheck:node-adapter → test → build`。工作树变化使旧结果失效。
- 任一方案若通过缩短安全窗口、放宽认证、吞掉错误、改为无界缓存、恢复`bind/call/apply`、让失败操作产生wire副作用或破坏现有public分层，直接判定失败，不得合并。

### 2I.22 扫描结论

当前仍无产品设计block；19项均有明确owner和不改变既定API语义的落地路径。真正阻止继续声明完成的是实现架构：安全状态仍采用fresh eviction，identity/replay/provider admission未形成同一lease链，新增registry仍允许endpoint旁路直接写Map。必须先完成2I.21的迁移顺序，再由另一轮全包对抗验证；不能逐条打完补丁后直接把计数改为零。

### 2I.23 当前实现审计（2026-08-11）

本节覆盖 2I 扫描之后同一工作树上的实现，而不是重新定义 2I 的威胁模型。以下“已落地”只在 owner 单测、endpoint/adapter 集成测试和工程门禁均有证据时使用：

| 项目                                   | 当前状态     | 证据边界                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2I.1 业务 request replay               | 已落地第一版 | `RequestReplayLedger` 非淘汰 fresh tombstone、global/per-peer cap、满载不淘汰 fresh rejection、短 TTL rejection，并 retain/release identity lease                                                                                                                                                                          |
| 2I.2 verified binding capacity         | 已落地第一版 | 满载拒绝新 binding、active provider refcount；仍需更完整的跨 adapter 引用矩阵                                                                                                                                                                                                                                              |
| 2I.3 provider admission                | 已落地       | global/per-peer admission、dispatchOnly 同路径、dispose release                                                                                                                                                                                                                                                            |
| 2I.4 Window/ServiceWorker source proof | 已落地第二版 | Window source+origin proof、ServiceWorker client/source proof、hostile source getter rejection、双 client identity isolation；跨 realm 矩阵仍需扩展                                                                                                                                                                        |
| 2I.5 outbound ID                       | 已落地第一版 | fresh reserved ID 不淘汰，满载拒绝                                                                                                                                                                                                                                                                                         |
| 2I.6 BroadcastChannel identity binding | 已落地第二版 | unique identity discovery 后业务 frame 复用既有 binding，既有 binding 不再重复执行 `identifier`，精确 token 双向回归通过；跨 realm 矩阵仍需扩展                                                                                                                                                                            |
| 2I.7 control replay                    | 已落地第一版 | 原子 duplicate/admission 顺序与 non-evicting ledger                                                                                                                                                                                                                                                                        |
| 2I.8–2I.12、2I.15                      | 已落地第二版 | retry deadline、transfer bridge、ProviderResult normalize、分阶段 disposal、MessagePort terminal 后同时拒绝 send/subscribe、signal rollback相关测试已通过；新增原生 `node:worker_threads` `MessageChannel` 双向 endpoint integration 与 dispose observer 证据                                                                                                                                                                  |
| 2I.13–2I.14                            | 已落地第四版 | DiscoveryRegistry 的主要集合已私有化；endpoint 只接收 outer array 与 entry tuple 均冻结的 remote/local/admission 快照，不再取得 live iterator；`close()` 由 owner 统一 reject automatic/manual waiter 并清理 task、response-count、timer/listener，revoked candidate 满载时拒绝新的 unregister admission，不淘汰旧安全记录 |
| 2I.16–2I.18                            | 已落地       | derived receiver 长度降级、context-free 文档、custom byteLength canonical 下限校验                                                                                                                                                                                                                                         |
| 2I.19                                  | 已落地第二版 | global remote/waiter cap、stale unprotected purge（pinned entry 不驱逐）、`timeoutMs:false` discovery session 固定 TTL、单 session waiter cap，并有 unbounded caller TTL 回归；仍需更完整 caller/session budget 矩阵                                                                                                       |
| 2I.20                                  | 已落地第三版 | `construction.signal`/`construction.timeoutMs` 覆盖 middleware 与 unique-target factory；factory 在成功、取消、超时和失败路径移除 caller-owned construction abort listener；取消后的 middleware/transport cleanup 有独立 1s budget，迟到错误通过 `cleanupPromise` 观察                                                     |

当前工作树门禁证据：`fmt`、`lint`、`typecheck`、`typecheck:core`、`typecheck:node-adapter`、`typecheck:test`、`build`、仓库 `typecheck:consumers` 通过；web-rpc 测试 419 个全绿。public abort signal 已改为结构化契约，Node/无 DOM consumer 不再依赖裸 `AbortSignal`。BroadcastChannel unique identity discovery→business binding、既有 binding 跳过重复 identifier、精确 token 双向回归、同 senderId 不同 source 的 response/pong 拒绝、remote binding lease 生命周期、Window/ServiceWorker 错误 source、origin、client-id、hostile source getter、双 client identity isolation 对抗测试已补齐，construction deadline、abort-aware middleware、非合作永久 pending middleware cleanup、DiscoveryRegistry N/N+1 cap、stale pinned protection、global distinct-session cap、单 session waiter cap、unbounded caller TTL 和共享 session的 caller timeout 隔离也有测试证据。新增 manual query abort-listener 同步竞态、有限 deadline 终止异步 retry policy 及 RTCDataChannel 已关闭状态 late error subscriber 回归。尚未关闭的要求是更完整的跨 adapter / 跨 realm identity 矩阵、caller/session discovery budget，以及完成后另一轮全包审查。因这些项仍未有充分证据，本节不把 hardening 标记为完成。

上述历史门禁段落的测试计数已过时；当前同一工作树 web-rpc 为 419 tests，coverage 为 statements 87.75%、branches 84.98%、functions 87.76%、lines 89.87%；新增证据包括 topology、cross-realm stable-id、caller abort isolation、manual query abort 注册竞态、有限 deadline retry policy、retry asynchronous decision single-path、policy-side abort race、OperationScope abort/generation stale rejection、selector-dispose 下 send/dispatch/ping commit guard、Node MessagePort late terminal replay、RTC terminal late subscriber、control replay admission 原子性、hostile getter/prototype key wire boundary、verified remote binding capacity、replay capacity/TTL 与 settlement exactly-once properties，以及原生 Node `worker_threads.MessageChannel` 双向 endpoint、远端 close terminal 集成。

最新 adapter topology 矩阵回归后的 259 tests 是历史快照；当前同一工作树基线以本节前述 419 tests 为准。

## 2. 历史初始结论（已被 2I 取代）

以下内容记录首次审查时的根因模型，仅用于解释后续修复历史，不描述当前工作树。当前结论以 2I 为准。

主要根因不是单个条件判断缺失，而是以下边界尚未建立：

1. transport 在进入协议层前丢失真实来源元数据。
2. chunk 在认证、结构验证和资源预算之前进入长期状态。
3. provider 的 AbortSignal 与 response settlement 没有统一状态机。
4. pending task 以可猜 taskId 为唯一入口，错误来源也能消费任务。
5. transport callback 与异步 receive 之间没有最终 rejection 边界。
6. middleware 声称由 PluginHost 管理，实际绕过 PluginHost 直接安装。

## 3. 威胁模型

### 3.1 可信边界

- 应用代码、已安装 middleware 和 endpoint 本地状态视为同一信任域。
- transport 传入的任何 payload 默认不可信。
- Window、BroadcastChannel、ServiceWorker、SharedWorker、RTC 和网络 transport 均可能存在多个参与者。
- wire 中的 `senderId`、`targetId`、`taskId`、chunk metadata 只属于声明值，不能作为真实来源证明。

### 3.2 攻击者能力

攻击者可能：

- 向共享 transport 注入任意结构化消息。
- 冒充任意 `senderId` 或复用已观察到的 taskId。
- 重放、乱序、重复或截断 chunk。
- 发送永不完成的分片集合以占用内存和 timer。
- 诱导 verifier、codec、provider、hook 或 adapter listener 抛错或 reject。
- 在请求取消、超时或 endpoint dispose 后让 provider 继续 resolve。

### 3.3 非目标

- 本文不提供端到端加密算法。
- 本文不替代应用级授权；它只保证来源绑定、资源边界和生命周期一致性。
- 本文不承诺中断任意同步 provider；取消保证的是 signal、settlement 和后续框架副作用失效。

## 4. 必须修复的问题

本节保留第一轮发现的原始描述，便于追踪根因；它不再代表全部问题仍处于未修状态。第二轮核验状态如下，最新未关闭项以 4A 节为准。

| 第一轮项                 | 二次核验 | 说明                                                                                |
| ------------------------ | -------- | ----------------------------------------------------------------------------------- |
| 4.1 来源 metadata        | 已完成   | inbound metadata、source/origin 绑定和所有 kind 的认证顺序已统一。                  |
| 4.2 chunk 预算           | 已完成   | framing metadata 先经 protocol，认证、结构验证和资源预算均在 assembler 前完成。     |
| 4.3 provider abort       | 已完成   | provider resolve/reject 与 `dispatchTo()` 已检查 aborted/expired。                  |
| 4.4 response mismatch    | 已完成   | 不匹配 response 只观测，不再消费 pending。                                          |
| 4.5 receive rejection    | 已完成   | transport callback 已安装最终 rejection handler。                                   |
| 4.6 dispose 清理顺序     | 已完成   | endpoint 自有状态先于 middleware disposer 清理。                                    |
| 4.7 PluginHost ownership | 已完成   | middleware 由 PluginHost 安装、回滚和 dispose；capability registry 只负责受控发布。 |
| 4.8 identifier/peer      | 已完成   | 出站 identifier 前置校验，显式 send 不再污染 peer registry。                        |
| 4.9 ping settlement      | 已完成   | send/transport failure 会 settle ping pending。                                     |
| 4.10 adapter lifecycle   | 已完成   | listener/read/close、encoded type 和 ownership 已统一。                             |
| 4.11 feature API         | 已完成   | 当前契约选择方法恒存在、缺 capability 时运行时报错。                                |
| 4.12 工程门禁            | 已完成   | package typecheck、core/node-adapter typecheck、build、lint 与对抗测试均通过。      |

### 4.1 P0：来源元数据在 adapter 层丢失

当前 transport subscriber 只接收 payload。Window adapter 丢弃 `MessageEvent.origin` 和 `source`，connect verifier 最终只能比较 wire 自称的 senderId 与 transport 上的静态 metadata。

后果：共享 Window/BroadcastChannel 等环境中的参与者可以冒充其他 endpoint；`identifier()` 无法恢复已经丢失的来源信息。

### 4.2 P0：未认证 chunk 可造成资源耗尽

chunk 在 protocol decode、connect verify 和 contract validation 之前进入 assembler。assembler 没有全局配额、sender 配额、累计字节预算或并发 message 上限，并且只以 messageId 为 key。

后果：攻击者可持续发送不同 messageId 的首块，累积 Map、字符串和 30 秒 timer；不同 sender 还可互相污染同名 messageId。

### 4.3 P0：abort 后 provider 仍可发送迟到 response

abort variation 只触发 AbortController。ProviderExecutor 在 provider resolve 后没有重新检查 task 状态，仍可能验证结果并发送 response；`dispatchTo()` 也没有过期守卫。

后果：调用方已收到取消，但远端仍执行框架副作用并发送迟到结果，违反既有 SDD 的“迟到结果丢弃”契约。

### 4.4 P0：不匹配 response 可以消费合法 pending

收到已存在 taskId 但 sender/method 不匹配的 response 时，当前实现删除并 reject pending。

后果：第三方只需观察或猜中 taskId，即可让合法请求提前失败。错误来源没有资格改变 pending 状态。

### 4.5 P0：异步 receive rejection 无最终处理器

transport callback 使用 fire-and-forget 方式启动异步 receive，但没有 rejection handler。异步 verifier、provider 错误响应发送、adapter listener 或恶意输入 getter 抛错时可能形成 unhandled rejection。

### 4.6 P1：dispose 先等待 middleware，后清 endpoint 状态

当前 dispose 在 reject pending、abort provider 和清 timer 之前逐个等待 middleware disposer。任意 disposer 卡住都会阻止 endpoint 自有资源清理。

### 4.7 P1：PluginHost 是未使用的生命周期门面

factory 创建 PluginHost，但 middleware 仍由 factory 直接执行 `install()` 并手工保存 disposer。PluginHost 没有拥有任何 middleware registration、config 或 resource。

后果：实现与架构文档矛盾，且 PluginHost 的串行 mutation、冲突检查、失败回滚和 dispose 聚合均未生效。

### 4.8 P1：出站 identifier 与 peer 状态缺少约束

- `maxIdentifierLength` 只验证入站消息。
- 本地 endpoint id、targetId、method 和生成后的 taskId 可以发出远端必定拒绝的报文。
- `send()`、`dispatch()` 和 `ping()` 在确认目标前直接把 target 加入 peer registry。

后果：拼错或用户控制的 target 永久污染 fan-out；调用方通常只能通过 timeout 发现本地即可判断的错误。

### 4.9 P1：ping 与 transport failure 没有一致 settlement

variation send 会吞掉 encode/transport 错误并只发 hook。timeout 为 false 时，失败的 ping 可永久 pending；transport failure 只处理普通 request pending。

### 4.10 P1：adapter 错误和关闭语义不一致

部分 adapter 隔离 listener 错误，部分让异常越过平台 callback。WebTransport 丢弃 read Promise rejection，close 只释放 writer lock；SharedWorker 使用名义 `instanceof MessageEvent`，与 structural adapter 契约矛盾。

### 4.11 P2：feature API 与运行时能力不一致

SDD 声明未安装 ping/hooks 时扩展不存在；当前类型始终暴露 ping，endpoint 始终暴露 hooks getter。类型、运行时和文档没有共同真相。

### 4.12 P2：工程门禁未闭合

- Vitest 当前通过 19 个 suite、36 个测试，覆盖上述攻击面与关键竞态。
- package build、core typecheck 和 node-adapter typecheck 通过。
- package 总 typecheck 因测试中的泛型 capability mock 和 protocol codec 签名失败。
- package README 与 USEGUIDE 已补齐，并覆盖来源认证、资源预算、settlement、dispose 和错误观测契约。

## 4A. 二次对抗新增问题

第一轮问题已有部分修复：transport 开始携带来源 metadata，chunk 增加预算并在缓存前执行 verify，response mismatch 不再消费 pending，receive rejection 已被观察，dispose 也把 endpoint 自有清理移到 middleware disposer 之前。以下问题在最新工作树中仍成立。

### 4A.1 P0：retry 默认重试取消和永久错误

没有 `shouldRetry` 时，retry 会重试所有 rejection，包括用户 abort、schema/contract error、endpoint disposed 和明确的 remote 业务失败。retry delay 是不可取消的裸 timer；AbortSignal 或 dispose 在 delay 期间不会结束等待。

后果：取消后的调用继续等待并重复进入 request；永久错误被重复发送；长 timer 延迟进程和 endpoint 收尾。

### 4A.2 P0：timeout 不取消远端 provider

deadline 到期只删除本地 pending 并 reject，不发送 abort variation。即使 abort middleware 已安装，远端 provider 仍继续执行并发送迟到 response。

timeout 与用户 abort 必须共用一个幂等 cancellation helper：先 settle 本地任务，再 best-effort 通知远端。未安装 abort 时，文档必须明确 timeout 只有本地语义。

### 4A.3 P0：protocol 完整性边界不覆盖 chunk metadata

完整 envelope 先经过 protocol encode，随后被拆成未经过 protocol 的原始 chunk object。`messageId/index/total/senderId/targetId` 因此不受 protocol 中可能实现的签名、MAC 或加密保护。

connect verify 只能认证来源，不能证明 frame metadata 未被可信 peer 内的错误或恶意代码篡改。最终 decode 失败也不能阻止 assembler 资源消耗。

### 4A.4 P1：capability 可被不同 middleware 静默覆盖

PluginHost 已开始拥有 middleware disposer，但 capability registry 仍是无条件 `Map.set()`。不同名称的 middleware 可以覆盖 `connectCapability`、`protocolCapability` 等保留 key，安全行为继续依赖安装顺序。

### 4A.5 P1：middleware 安装期 hooks 仍是 no-op

factory 传给 middleware context 的 `hooks` 恒为空函数。middleware 安装失败、降级和 capability 冲突无法进入 endpoint 的观察面；“hooks 纯观测”契约在 install lifecycle 中不成立。

### 4A.6 P1：HookRegistry 的失败隔离可二次失效

HookRegistry 只识别原生 Promise，thenable rejection 不被观察。`onHookError` 自身抛错时，同步路径会越过 `emit()`，异步 catch 链会再次 rejection。hook 仍可能影响 receive 和业务控制流。

### 4A.7 P1：并发 dispose 不共享 Promise

dispose 仍只使用 boolean。第一次调用开始异步清理后，第二次调用立即 resolve，而不是等待同一清理结果。transport close 抛错时，后续调用也无法观察相同失败。

### 4A.8 P1：provider result 可伪造，INTERNAL message 泄漏

ProviderExecutor 只检查返回对象是否含 `ok`。任意 `{ ok: true }` 或畸形 `{ ok: false }` 都可冒充 context result，无法证明它来自当前 `success()` / `failed()`。此外，provider 抛出的原始 Error message 会进入 INTERNAL response，可能泄漏路径、查询和内部实现。

### 4A.9 P1：wire safe-read 与 variation validation 不完整

`isWebRpcEnvelope()` 直接读取不可信对象属性，恶意 getter/proxy 可以抛错。number 字段只检查类型，NaN、Infinity 和小数仍可能进入逻辑。variation、chunk-ack 在 target 和统一 identifier validation 前有提前返回路径；chunk-ack 当前甚至在 connect verify 前被接受为 hook 事件。

### 4A.10 P1：codec、chunk 与 adapter 类型未在装配期验证

- RTC 入站是 string，default identity protocol 无法恢复 envelope。
- WebTransport 要求 Uint8Array，default identity protocol 可把 object 交给 writer。
- chunk 和 `maxMessageBytes` 只覆盖 encoded string，Uint8Array/object 可绕过大小预算。

这些组合能够成功创建 endpoint，却在首条消息时静默失败或绕过限制。

### 4A.11 P2：transport ownership 未定义

endpoint dispose 总会调用可选 `transport.close()`。当 transport 被应用或多个 endpoint 共享时，单个 endpoint 是否有权关闭底层资源没有契约。memory pair 的任一侧 close 会关闭双方，更容易放大该歧义。

### 4A.12 P2：当前测试门禁没有覆盖二次问题

最新工作树的 package typecheck 与 19 个 suite、36 个测试均通过；retry、timeout、hook、capability、codec 装配和并发 dispose 组合已纳入验证。

## 4B. 第三轮对抗新增问题

第三轮重点检查 utility 抽取后的真实调用路径。retry、settlement、listener safety、provider branding、capability freeze、共享 dispose Promise、factory rollback 和 async-control race 均已落地。

### 4B.1 部分关闭：endpoint 构造失败泄漏 middleware

factory 已在 post-install failure 时调用 `host.dispose()`，直接资源泄漏已修复；construction failure 现在保留稳定的 `WebRpcConstructionError`，并通过结构化 cleanup report 保留双失败信息。剩余顺序问题见 4C.1。

### 4B.2 部分关闭：timeout race utility 抽取

`raceWithAsyncControl()` 与基础测试已经加入，但 request timeout、ping timeout、远端 abort 通知和 timer cleanup 仍内联在 endpoint，utility 尚未成为唯一 owner。剩余问题见 4C.2、4C.3。

### 4B.3 部分关闭：settlement cleanup 抛错会留下永久 pending

`createSettlement()` 已隔离 cleanup error，主 Promise 可恰好一次完成；但异常被静默吞掉，没有 SDD 规定的 diagnostic。剩余问题见 4C.4。

### 4B.4 已关闭：send failure 重复调用 settlement

request send catch 中重复的第二次 `pending.settleReject(WebRpcTransportError)` 已删除。

### 4B.5 已关闭：encodedType wildcard 判断反转

factory 现在要求声明 concrete `encodedType` 的 transport 使用同样 concrete 类型的 protocol；`any` 不得绕过 typed transport 校验。factory 测试覆盖 mismatch 与 `any` 两种失败路径。

### 4B.6 部分关闭：remote transient error 可由 policy 开启 retry

`WebRpcRemoteError` 现可进入用户 `shouldRetry`；无显式 policy 时默认停止重试，显式 transient policy 才能继续尝试。4C.5 已关闭。

### 4B.7 已关闭：timer 统一 unref

`waitWithSignal()`、request timeout、ping timeout 和 chunk expiry 创建的 timer 均已通过 `unrefTimer()` 执行 `.unref?.()`，不再因这些 timer 单独拖住 Node/Bun 进程。timer factory 的单一所有权仍属于 4C.3 的架构收口项。

### 4B.8 已关闭：dispose failure hook 生命周期

HookRegistry 已延后到 middleware disposer 执行完成后清理，`middleware.dispose.failure` 在正常 endpoint dispose 路径中可被观察。

### 4B.9 部分关闭：utility 测试覆盖

utility 已覆盖 timeout/abort 竞争、预取消、signal/delay 注册回滚、cleanup diagnostic 隔离及 factory rollback；4C.7 已关闭。

## 4C. 第四轮对抗新增问题

第四轮以当前源码为准，重新验证第三轮条目及其组合路径。package typecheck 与 20 个 suite、39 个测试均通过，但下列生命周期和抽象边界仍未闭合。

### 4C.1 已关闭：factory rollback 与正常 dispose 的 capability 生命周期

factory 的失败路径先执行 `capabilities.clear()`，再 `await host.dispose()`；endpoint 的正常 dispose 也先清 `#runtime.capabilities`，再逆序执行 middleware disposer。middleware disposer 可以合法闭包捕获安装期 registry，并在释放订阅、端口或派生资源时读取 capability。当前顺序会让失败回滚和正常关闭都看到空 registry，甚至令 disposer 抛出新的清理错误。

capability 的冻结只应阻止安装完成后的写入，不应提前破坏 disposer 的只读依赖。统一顺序应为：停止 endpoint 自有活动 → 逆序执行 middleware disposer → 在 `finally` 清空 capability 和临时安装状态。若设计明确禁止 disposer 读取 capability，必须从 disposer context 和文档中建立这一边界，而不能依赖提前清 Map。

### 4C.2 部分关闭：`raceWithAsyncControl()` 预取消与 operation 启动顺序

实现只接受已创建的 `PromiseLike<T>`。调用方必须先启动 send/read 等 operation，才能把 Promise 交给 race；即使 signal 在调用前已经 aborted，operation 的外部副作用也已发生。这与 5.15.1 的“已 aborted signal 在启动 operation 前失败”契约冲突。

主 API 应以 `operation: () => PromiseLike<T>` 为规范形式：先验证 timeout、检查 signals 并安装 listener，再调用 operation factory。若保留 PromiseLike overload，必须明确它只提供 settlement 竞争，不提供 pre-abort side-effect suppression。

第五轮核验：lazy factory 已支持，但 eager PromiseLike 仍是同等签名且未文档化能力差异；异常调用边界另见 4D.3。

### 4C.3 部分关闭：timeout utility 接入 endpoint

`raceWithAsyncControl()` 和测试文件已经存在，但 request 与 ping 仍各自直接 `setTimeout()`、删除 registry、清 listener 和决定远端 abort。utility 也没有 `onTimeout`，无法拥有“timeout 获胜后恰好一次 best-effort abort”的 RPC 语义。当前抽取只增加了第三套 race primitive，没有消除 endpoint 内的重复状态机。

request、ping 及需要 deadline 的内部操作必须迁移到同一个 async-control/settlement 组合；迁移完成前，4B.2 不能视为关闭。chunk expiry 可复用统一 timer factory，但 chunk budget 与 assembler 所有权继续留在 `chunk.ts`。

第五轮核验：request/ping 已调用 utility，但 ping 尚未使用统一 settlement，transport failure 会遗留 race；见 4D.4、4D.7。

### 4C.4 已关闭：settlement cleanup diagnostic

`createSettlement()` 已保证 cleanup 抛错后主 Promise 仍完成，永久 pending 问题已修复；但 catch 块直接丢弃异常。registry 删除、timer 清理或 abort listener 移除失败将完全不可观察，无法判断资源是否泄漏，也不符合 5.15.3 的 `reportCleanupError` 契约。

primitive 应调用可选、不可抛的 diagnostic；diagnostic 自身异常也必须隔离。测试需分别证明主结果不被替换、cleanup diagnostic 恰好一次、diagnostic 抛错不越界。

### 4C.5 已关闭：retry remote error 分类

当前 endpoint 允许 `WebRpcRemoteError` 进入用户 policy，这是正确方向；但配置了 retry 且未提供 `shouldRetry` 时，所有 remote error 都会自动重试。永久业务失败因而仍被重复发送。契约要求普通 remote failure 默认不可重试，只有显式 policy 识别出的 transient code 才能开启 retry。

默认分类与用户 override 必须分层：框架永久错误永不重试；remote 默认停止，但允许显式 `shouldRetry` 返回 true；transport/timeout 的默认策略则由公开契约明确。测试应覆盖无 policy、transient policy 和永久 remote code 三组。

### 4C.6 已关闭：construction cleanup failure 错误契约

factory 在原始装配错误之外再遇到 disposer failure 时，直接抛原生 `AggregateError`。调用方原本可依赖的 `WebRpcError.code === INVALID_CONFIG` 因此消失，且顶层 message 不包含原始装配阶段。回滚失败必须可见，但不能让主要失败类型随机取决于 cleanup 是否也失败。

建议保持稳定的 web-rpc construction error 为顶层错误，把原始失败作为 primary cause，并以结构化 `cleanupErrors` 或 diagnostic 附加回滚错误；若决定公开 `AggregateError`，必须在类型、README、USEGUIDE 和测试中声明其顺序与解包方式。

当前 `WebRpcConstructionError` 公开携带结构化 `cleanupErrors`/`cleanupPromise`，factory 双失败测试验证 primary cause 与 cleanup error 同时保留。

### 4C.7 已关闭：utility 竞争与回滚测试证据

`async-control.test.ts` 目前仅验证 timeout 胜出和 delay 完成后 abort 不产生可见失败。它没有验证预取消不启动 operation、多 signal 竞争、operation reject 的迟到观察、listener 实际移除、timer clear/unref、`onTimeout` 失败隔离。factory 测试也只覆盖 encoded type mismatch，没有 post-install validation/constructor failure 的 disposer rollback 与双失败错误契约。

现有 20 suite、39 tests 是健康基线，但不能作为本 SDD 竞争与回滚条目的关闭证据。

当前 async-control 与 factory 测试已覆盖预取消、后续 signal 注册回滚、delay 注册回滚、cleanup diagnostic 隔离、construction rollback 与双失败错误契约。

## 4D. 第五轮对抗新增问题

第五轮重新攻击 timeout utility 接入后的异常边界、ping race、构造事务和认证后复合身份。package typecheck 与 20 个 suite、39 个测试仍通过，但没有覆盖以下路径。

### 4D.1 已关闭：分隔符拼接的 provider task key 可跨 peer 碰撞

ProviderExecutor 和 abort variation 都用 `` `${senderId}:${taskId}` `` 定位 active controller，但 identifier 只限制非空与长度，不禁止 `:`。因此 `(senderId='a', taskId='b:c')` 与 `(senderId='a:b', taskId='c')` 产生同一个 key。两个来源都通过各自 connect verifier 后，后者仍可发送 abort 命中前者的 provider task，或让正常 request 被误判为 duplicate。

这不是 taskId 猜测问题，而是认证后的身份编码失去单射性。active controller 必须使用嵌套 Map、结构化 tuple owner，或不可歧义的长度前缀编码；禁止继续用可控字符串和分隔符拼 key。测试必须用两个已认证 peer 复现 collision，并证明 abort、duplicate detection 和 finally delete 都只作用于精确 tuple。

### 4D.2 已关闭：chunk assembly 与 verified peer key 存在同类碰撞

endpoint 先把 `peerId/origin/senderId` 用 `|` 拼成 peerKey，ChunkAssembler 再用 `:` 拼接 messageId。上述字段和 messageId 都可含分隔符；Window 的 `source` 对象也没有进入 assembler identity。不同 `(verified source, senderId, messageId)` 可以落入同一 assembly，导致一方删除、污染或完成另一方的分片状态，并串扰 per-peer quota。

assembler 应接收不可伪造的 peer token，内部使用 `Map<PeerToken, Map<MessageId, Assembly>>`；Window adapter/connect 层应把通过验证的 `source` 绑定纳入 token，而不是把对象丢失后再拼字符串。预算计数与 assembly storage 必须共享同一 token。

### 4D.3 部分关闭：`raceWithAsyncControl()` 的同步 callback throw 会留下永久 pending

timeout callback 直接求值 `options.onTimeout?.()` 后才交给 `Promise.resolve()`。若 `onTimeout` 同步抛错，代码不会执行 `finish()`：race Promise 永不 settle，AbortSignal listener 不移除，并产生 timer callback uncaught exception。`createTimeoutError()`、`createAbortError()` 或 `finish()` 内的 listener cleanup 抛错也有相同风险。`waitWithSignal()` 的 error factory 路径同样没有 terminal catch。

所有用户或策略 callback 都必须通过统一 `invokeSafely()` 边界执行；主 race 的 settle/cleanup 放在 `finally` 语义下。`onTimeout` 与 diagnostic 失败不能替换 timeout 主结果，error factory 失败则必须 reject 为该异常，不能越过 Promise 边界。

第六轮核验：同步 `onTimeout` 与 error factory 已被隔离；signal listener 注册/移除异常仍会泄漏或阻止主 settlement，见 4E.7。

### 4D.4 已关闭：ping transport failure 没有释放 timeout control

ping 的 pong、send failure 和 dispose 路径会调用 `pending.release()`，但 `#failTransport()` 只 resolve false 并删除 Map entry，没有 release。已启动的 `raceWithAsyncControl()` 因而保留 control Promise、timer、endpoint 和闭包直到原 timeout；长 timeout 或大量并发 ping 会形成可控内存滞留。`.unref()` 只解决进程存活，不解决资源释放。

ping 也应使用 settlement primitive，把 Map 删除、control release 和用户 resolve 统一成 exactly-once cleanup。transport failure、pong、send failure、timeout 与 dispose 必须调用同一 gate。

### 4D.5 部分关闭：endpoint constructor 的订阅注册不是事务

constructor 先成功执行 `transport.subscribe()`，再注册 `onTransportError` 与 `onListenerError`。后两个注册器任一同步抛错时，构造失败且 endpoint 引用不会返回；factory 只能 dispose middleware host，无法调用已经保存于半构造对象中的 unsubscribe，先前 transport subscription 永久泄漏。

构造期所有外部 registration 必须由局部 rollback stack 拥有：每成功一步立即登记 disposer，后续任一步失败则逆序清理后再抛。更稳妥的边界是让 constructor 保持无外部副作用，由 factory/静态 async creator 在对象完整后执行 transaction attach。

第六轮核验：registration rollback 已实现；rollback disposer error 被吞掉，正常 dispose 也未复用该事务，见 4E.3、4E.4。

### 4D.6 已关闭：per-call timeout override 绕过配置校验

timeout middleware 只验证全局 `config.timeoutMs`。`send(..., { timeoutMs })` 由 `resolveTimeout()` 原样返回，NaN、Infinity 和负值可进入 endpoint；NaN/Infinity 在不同 runtime 会被截断、警告或立即触发，负值则被当作同步 timeout，而不是无效输入。

public send 入口必须对 override 执行与 middleware 相同的 `false | finite non-negative number` 校验，async-control 也应自校验以保护包内调用方。

### 4D.7 已关闭：timeout 迁移残留形成双重、失真的 cleanup 模型

ping/request 已改用 control Promise，但 pending 类型仍保存废弃的 `timer`，多个路径继续 `clearTimeout(pending.timer)`；dispose 中还连续调用两次 `pending.release?.()`。这些语句当前多为无害 no-op，却让测试和维护者误以为 timer 由 pending 持有，掩盖 4D.4 的真实泄漏。

完成迁移时应删除 timer 字段和所有 stale clear，ping 统一 settlement 后只保留一个 idempotent release owner。架构测试应禁止 endpoint 直接出现 `setTimeout/clearTimeout` 和手工重复 release。

## 4E. 第六轮对抗新增问题

第六轮继续验证第五轮修复的真实所有权边界。delimiter collision、ping settlement、per-call timeout 校验和基础 constructor rollback 已落地；package typecheck 与 20 个 suite、44 个测试通过，但以下身份、关闭事务和 adapter 生命周期仍未闭合。

### 4E.1 部分关闭：provider task 与 pending response 仍未绑定 verified source

`tupleKey(senderId, taskId)` 已消除分隔符碰撞，但 active controller 仍只包含 wire 声明值。`#verifySource()` 只返回 boolean，验证成功后没有产生可传递的 peer token；ProviderExecutor、abort variation 和 outbound pending 因而无法保存或比较真实 `peerId/origin/source` 绑定。

若 verifier 合法允许两个来源复用同一 senderId，来源 B 仍可用相同 taskId abort 来源 A 的 provider；response 路径也只比较 `response.senderId === pending.targetId`，没有证明 response 来自发起请求时预期的来源绑定。第五轮只修了字符串编码，没有完成 5.16 的结构化身份模型。

connect verification 必须返回 opaque `VerifiedPeerToken`（或 verified identity object），并贯穿 provider task、abort lookup、pending response 与 chunk budget。boolean verifier 只能作为 accept/reject 输入，不能充当后续状态所有权证明。

第七轮核验：inbound provider/abort 已加入 source-derived key；outbound pending 的 key 仍靠静态 metadata 猜测，见 4F.2。

### 4E.2 部分关闭：top-level transport 与 connect transport 可形成 split-brain

factory 允许 `config.transport` 覆盖 middleware 提供的 transport；connect middleware 却通过 `{ ...config }` 把创建 middleware 时的旧 transport 保存在 capability 中，同时其 `verify` closure 使用 install context 中的 factory transport。endpoint 构造后，`#connect.transport.peerId/origin` fallback 来自旧 transport，而 verify 内部的静态 peerId 检查来自新 transport。

结果是 identifier callback 与框架检查观察到两套 metadata，认证可能误拒绝或基于错误 origin/peerId 放行。factory 必须只有一个 canonical transport owner：connect capability 在 install 时写入 context transport；若 top-level 与 middleware transport 同时出现且引用不同，应在装配期拒绝，而不是静默混用。

第七轮核验：显式 top-level transport 冲突已拒绝；未提供 top-level 时检查被跳过，见 4F.3。

### 4E.3 已关闭：正常 dispose 的 unregister failure 会中止全部后续清理

constructor 已为 registration failure 增加 rollback stack，但 `#disposeInternal()` 仍顺序直接调用 `#unsubscribe()`、`#unsubscribeTransportError()` 和 `#unsubscribeListenerError()`。任意 unregister 同步抛错都会让 dispose 立即 reject，普通 pending、ping、provider controller、chunk timer、middleware disposer、capability 和 owned transport 均不再清理。

关闭流程必须把每个 release 当作 best-effort step，记录错误后继续完成全部终态转换，最后统一返回稳定 aggregate/diagnostic。endpoint 自有 pending/controller/chunk 的强制结算应早于可能抛错的外部 unregister。

### 4E.4 已关闭：constructor rollback 吞掉 registration cleanup error

constructor catch 会逆序调用已登记 disposer，但每个错误都直接丢弃，随后只抛原 registration failure。若 rollback unsubscribe 也失败，调用方看到普通构造错误，却无法知道 subscription 仍可能存活；factory 的 `cleanupErrors` 也捕获不到 constructor 内已经吞掉的错误。

constructor transaction 应收集 rollback errors，并交给统一 construction error owner。正常 dispose 与 constructor rollback 必须共享同一个 `releaseAll()` primitive，避免两套不同的错误策略。

### 4E.5 已关闭：WebTransport unsubscribe 的 persistent reader 契约

datagram adapter 的 read loop 在 `await reader.read()` 期间不响应最后一个 listener 被移除。unsubscribe 只删除 Set entry；如果远端不再发送数据，reader Promise、stream lock、adapter closure 和 reader 会一直保留到显式 close。之后 resubscribe 还依赖旧 read loop 的未来唤醒。

adapter 必须明确选择一种模型：持久 reader 由 transport 生命周期拥有，且不把 unsubscribe 宣称为释放读取资源；或最后一个 unsubscribe 可取消当前 read 并允许安全重建 reader。无论哪种，都需覆盖 unsubscribe-with-no-future-data、resubscribe 和 close 竞争测试。

第七轮核验：unsubscribe 已 cancel reader，但 cancel 终止底层 stream并引入 resubscribe race，见 4F.4。

### 4E.6 已关闭：typed transport 仍允许未声明或 `any` codec

factory 仅拒绝缺 protocol、identity protocol 或明确声明为另一具体类型的 protocol。自定义 capability 的 `encodedType` 缺失会通过；`encodedType: 'any'` 也会通过 string/Uint8Array transport。codec 实际返回错误类型时 endpoint 仍能创建，只在首条 send/read 时失败或被 adapter 隐式转换。

对于声明 concrete `transport.encodedType` 的 adapter，protocol 必须声明完全相同的 concrete encodedType；`any` 只能用于 transport 自身也为 `any/undefined` 的场景。若保留 wildcard 语义，则必须增加装配期 probe，但 probe 无法可靠证明所有输入的输出类型，因此不应替代显式契约。

### 4E.7 已关闭：async-control listener lifecycle 与 timeout 输入

同步 `onTimeout` 与 error factory 已被隔离，但 timer 在 signal 检查和 listener 注册前创建；`signal.aborted` getter、`addEventListener` 或 `removeEventListener` 抛错时，先前 timer/listener 可能泄漏，`finish()` 还可能在标记 settled 后、调用 resolve/reject 前中断。utility 自身也没有验证 `timeoutMs` 的 finite/non-negative 契约。

应先验证 timeout，再以 rollback stack 安装 listeners，最后创建 timer/启动 operation；finish 使用不可抛 cleanup，收集 listener cleanup diagnostic 后仍必须调用主 resolve/reject。增加 hostile structural signal、NaN/Infinity/negative timeout 和 listener removal throw 测试。

第七轮核验：timeout 与 listener removal 已加固；部分 listener registration failure 仍未完整 rollback，见 4F.5。

## 4F. 第七轮对抗新增问题

第七轮验证 verified-key 接入、canonical transport 检查、WebTransport cancel 和 async-control rollback。package typecheck 与 20 个 suite、44 个测试通过，但以下身份完整性与生命周期回归仍未覆盖。

### 4F.1 已关闭：pong 只按 taskId 结算，任意 verified peer 可伪造 ping 成功

`pingPending` 不保存 targetId 或 expected peer identity；收到任意通过 connect verifier 的 pong 后，endpoint 只执行 `pingPending.get(taskId)?.settle(true)`。在 BroadcastChannel、Window hub 等共享 transport 中，其他合法参与者可以观察 ping taskId，并用自己的 senderId 抢先回 pong，使 `ping(target)` 对错误 peer 返回 true。

ping settlement 必须验证 taskId、targetId、pong senderId 和 verified peer token。pending ping 应与普通 request 使用同一 identity-aware settlement 结构；错误来源的 pong 只发 `response.unmatched`/`variation.unmatched` diagnostic，不消费合法 ping。

### 4F.2 已关闭：outbound pending 的 verified key 策略

request 只在 connect transport 带静态 `peerId/origin` 时预填 `pending.verifiedPeerKey`；常见 Window/BroadcastChannel 没有静态 metadata，因此完全不检查 response source，4E.1 的安全缺口仍存在。

反向场景也会破坏可用性：pending key 从静态 transport metadata 合成，response key 从 inbound metadata 合成。`#peerKey()` 不使用 verifier 所用的 static fallback，并额外加入 Window `source` token；同一合法 peer 因而可能产生不同 key，response 永远被当作 unmatched 直到 timeout。带静态 peerId、但 inbound envelope 不重复 peerId 的 transport 也会稳定触发该问题。

outbound 不能凭不完整的 transport 静态字段猜 verified identity。首次联系由 connect 的既定策略处理：`useBaseIdVerifyOnly !== false` 时只执行完整 `baseIdentityCheck(context)`；显式为 `false` 时执行基础验证并要求 `identifier` 成功。该 option 已是唯一 bootstrap 策略，不新增 TOFU/handshake 等同义公共开关。两条路径都必须生成相同 canonical binding，不能以缺字段的 `undefined` 静默降级，也不能混合两套 key 构造。

### 4F.3 已关闭：canonical transport 检查仅在 top-level transport 存在时生效

factory 的冲突判断被 `if (config.transport && ...)` 包围。未提供 top-level transport 时，factory 选择第一个带 transport 的 middleware，但不会拒绝后续 middleware 的不同 transport。自定义 transport middleware 排在 connect 前时，connect capability 仍保存另一 transport，split-brain 完整复现。

canonical 检查必须无条件遍历所有声明 transport 的 middleware，并要求每个引用都等于最终 canonical transport；connect capability 还应显式写入 install context transport，而不是依赖前置检查保护 `{ ...config }`。

### 4F.4 部分关闭：WebTransport unsubscribe 的 cancel 修复破坏 resubscribe

最后一个 listener unsubscribe 现在调用 `activeReader.cancel()`。Web Streams 的 reader cancel 会取消底层 readable stream，不只是中断一次 pending read；后续 resubscribe 无法恢复 datagram 消费。另有竞态：cancel 后、旧 read loop `finally` 前立即 resubscribe，`reading === true` 使新 `read()` 直接返回；旧 loop 随后退出，却没有重新检查现有 listeners，留下无 reader 的订阅。

WebTransport 应采用 transport-owned 持久 reader，或使用不会永久 cancel stream 的可重启读取抽象。若平台无法中断单次 read 而保留 stream，则 unsubscribe 只移除业务 listener，reader 资源明确归 transport/close 所有；文档和测试不得同时承诺 unsubscribe 释放 reader 与 resubscribe 可用。

### 4F.5 已关闭：async-control 注册失败 rollback

`waitWithSignal()` 在创建 timer 后注册 signals。第 N 个 `addEventListener` 抛错时虽移除已登记 listener，却没有 `clearTimeout(timer)`；长 delay 继续保留 closure。`raceWithAsyncControl()` 则没有 registration try/catch，第 N 个 signal 抛错时 Promise 会 reject，但前 N−1 个 listener不会移除。

两者应共用 `registerAbortSignals()` transaction，返回幂等 release；任何部分注册失败都完整 rollback。timer 必须在 signal transaction 成功后创建，或由统一 cleanup 在失败路径立即清除。

### 4F.6 已关闭：dispose release errors 只有 hook，调用 Promise 仍成功

unregister 与 owned transport close error 已被收集，后续清理也会继续，这是正确修复；但最终只发 `transport.failure` hook，`dispose()` 仍 resolve。无 hook 或只观察 Promise 的调用方会认为资源已完全释放。该行为与 5.17“稳定 lifecycle error 附带 cleanupErrors”的目标不一致。

必须选定并文档化一种契约：dispose reject 稳定 lifecycle error，同时保证状态已终结；或 resolve 一个结构化 cleanup report。仅 hook 观测不足以表达调用者负责的关闭失败。

## 4G. 第八轮对抗新增问题

第八轮不再只检查条件分支，而是验证前七轮补丁是否建立了可证明的不变量。package typecheck 与 20 个 suite、44 个测试通过，但以下问题说明 identity、capability 和 resource ownership 仍缺少架构 owner。

### 4G.1 已关闭：per-request verified identity policy

request pending 创建时没有 expected peer token；第一个 senderId 匹配且通过 boolean verifier 的 response 会执行 `pending.verifiedPeerKey ??= verifiedPeerKey`，随后立即 settle 并删除 pending。该 token 从未用于决定首个 response 是否有权结算，后续也没有第二次使用机会。ping 采用相同的“首个匹配来源写入 token 后立即完成”模式。

因此当前实现只是记录 winner identity，不是验证 expected identity。若 verifier 允许同一 senderId 的多个来源，最快 response 仍获胜；若 verifier 已保证全局唯一绑定，则 pending token 又是冗余的。修复需要 targetId → VerifiedPeerToken 的先验 binding registry，而不是在 response 到达后 TOFU。

当前目标架构采用 connect-owned identity 策略。默认 `useBaseIdVerifyOnly !== false`，首次 response/pong 必须通过框架完整基础身份绑定；该分支忽略 `identifier`。只有用户显式设置 `false` 时，才在基础验证后调用必填的 `identifier`。成功后 endpoint 生成 opaque binding token，后续 response/pong 必须匹配该 token。无 connect 的 direct endpoint 仅用于本地可信 transport。

因此首次联系不再另选预配置 binding、handshake、TOFU 或额外 bootstrap policy；`useBaseIdVerifyOnly` 已经完整表达选择。关键不变量是 `baseIdentityCheck` 必须真实校验 senderId、targetId、peerId、origin 与 source 注册关系，而不是返回常量 true。

### 4G.2 已关闭：capability immutable snapshot

`WebRpcCapabilityRegistry.freeze()` 只禁止后续 `set()`，`get()` 仍返回原始可变对象。后续 middleware 可取得早期 capability 后原地替换 `verify/encode/decode/resolveTimeout`；middleware 自身也可保留引用。timeout 的嵌套 retry config、contract 的 acceptVersions 等还可能与调用方原始 config 共享引用。

结果是 factory 对 encodedType、capability conflict 和 contract 的检查只对某一瞬间成立。endpoint 创建后对象可被修改，使实际 codec/verifier 与已验证 descriptor 不一致，而 registry 仍声称 frozen。

middleware 应发布纯声明 descriptor；factory 完成 normalize、validate、clone/freeze 后生成 endpoint 私有 immutable snapshot。运行时函数可作为值保留，但 descriptor 容器、数组和嵌套 policy 必须复制冻结；middleware core 不应在 install 后继续持有 runtime capability registry。

### 4G.3 已关闭：WebTransport read loop 生命周期

adapter 采用 transport-owned persistent reader：unsubscribe 只移除业务 listener，不取消底层 stream；close 才负责 reader/writer。read loop、reader 创建和 release 均在 adapter 内部统一拥有。

read loop 具备最终 rejection 边界，`getReader()`、`releaseLock()` 和 listener 错误均隔离；业务 subscribe 只管理 fan-out listeners。

### 4G.4 已关闭：dispose 对 middleware 与 transport cleanup failure 使用两套契约

unregister/transport close error 会进入 `releaseErrors` 并让 `dispose()` reject `WebRpcLifecycleError`；middleware disposer error 只发 `middleware.dispose.failure` hook，不进入同一 aggregate，dispose 仍可能成功。调用方无法从 Promise 判断“全部外部资源释放成功”，错误语义取决于资源恰好由哪一层注册。

ResourceScope 应统一拥有 transport registrations、middleware disposers、reader/writer 和 timer release。所有 cleanup error 均在继续清理后进入同一有序 report；hook 只是观察面，不能改变 Promise 契约。

## 4H. 十三轮统计与根因判定

### 4H.1 Review 记录统计

以下统计按每轮首次登记的 review item 计数；同一根因在后续轮次以新失败形态复现时会再次计入，因此它表示“暴露次数”，不等同于独立 bug 数。第三轮原标题未标严重度，按实际影响重新归类。

| 轮次     |  记录数 |     P0 |     P1 |     P2 |
| -------- | ------: | -----: | -----: | -----: |
| 第一轮   |      12 |      5 |      5 |      2 |
| 第二轮   |      12 |      3 |      7 |      2 |
| 第三轮   |       9 |      0 |      7 |      2 |
| 第四轮   |       7 |      0 |      6 |      1 |
| 第五轮   |       7 |      1 |      4 |      2 |
| 第六轮   |       7 |      1 |      5 |      1 |
| 第七轮   |       6 |      2 |      3 |      1 |
| 第八轮   |       4 |      1 |      3 |      0 |
| 第九轮   |       6 |      1 |      4 |      1 |
| 第十轮   |       7 |      1 |      5 |      1 |
| 第十一轮 |       9 |      3 |      5 |      1 |
| 第十二轮 |       8 |      2 |      5 |      1 |
| 第十三轮 |       7 |      2 |      5 |      0 |
| **合计** | **101** | **22** | **64** | **15** |

严重度不随轮次明显收敛：第五至第十三轮仍持续出现 P0/P1，且大多发生在前一轮刚修改的同一边界。这排除了“只剩零散尾项”的判断。第十三轮进一步证明新增 DNS/receiver 模型尚未成为统一路由 owner：文档、公开 API、wire filtering、pending settlement 与 discovery cache 各自实现了不同语义。

### 4H.2 实际缺陷还是架构问题

两者都存在，但主因已经明确偏向架构。

约四分之一记录属于真实、可局部修复的实现缺陷，例如重复 settlement、timer 未 unref、错误注释、输入漏校验、stale cleanup 和缺少 rejection handler。这些适合小补丁与回归测试。

约四分之三记录是少数架构缺口的重复表现：

1. **没有一等 verified identity**：senderId、source metadata、peer registry、provider controller、pending、ping 和 chunk 各自拼 key或临时 TOFU，导致 spoof、collision、误拒绝轮流出现。
2. **没有统一 task settlement model**：request、ping、provider、timeout、abort、retry 和 dispose 各自持有一部分状态，修一条竞争路径会在另一条 cleanup 路径复发。
3. **没有统一 ResourceScope**：PluginHost、endpoint、adapter、timer utility 分别保存 disposer/reader/listener，错误聚合、回滚顺序和 ownership 无共同契约。
4. **middleware 输出不是 immutable assembly descriptor**：capability registry 同时承担 install 期通信与 runtime 配置，浅 freeze 无法保证 factory 校验后的不变量。
5. **transport contract 不够强**：canonical transport、encoded payload type、source identity、reader ownership 和 close/unsubscribe 语义靠可选字段与约定组合，factory 无法静态证明合法装配。

结论：前几轮发现均是真实问题，不是 review 过度挑剔；但继续按症状打补丁已经呈现明显的 whack-a-mole。当前应停止宣称“本轮验证通过”，先完成架构收口，再恢复逐项 hardening。

### 4H.3 建议的架构重构顺序

1. 定义 `VerifiedPeerIdentity` 与 target binding registry；connect 返回 verified identity，所有 inbound/outbound task 只消费该 token。
2. 定义统一 `TaskSettlement`，覆盖 request、ping 和 provider，并把 timeout/abort/transport/dispose 作为同一状态机事件。
3. 定义 `ResourceScope.releaseAll()`，统一 registration、middleware disposer、timer、reader/writer 的逆序释放与 cleanup report。
4. 将 middleware 输出改为 immutable descriptors；factory normalize → validate → snapshot → construct，runtime 不再持有可变 install registry。
5. 将 transport 改为可判别 capability：payload type、identity source、ownership、reader lifecycle 都是显式必选契约；删除 `any` 与猜测式 fallback。
6. 最后重写对抗测试为模型测试：identity binding、状态机事件排列、release failure 矩阵和 assembly property tests，而不是继续为单个 if 分支补 happy-path case。

## 4I. 第九轮架构迁移新增问题

第九轮确认架构重构已经真实启动：新增 `VerifiedPeerRegistry`、`ResourceScope` 和 owned capability snapshot，测试增长至 23 个 suite、47 个 case。这是正确方向，但抽象与 RPC 协议语义尚未闭环，出现以下迁移级问题。

### 4I.1 部分关闭，原 P0：require-existing identity 使首次主动 RPC 与 ping 无法完成

response/pong 在 connect 存在时调用 `#verifySource(..., requireExisting=true)`；registry 未命中会在 verifier 执行前直接拒绝。binding 只由更早的已认证 inbound request/variation 建立，因此一个刚创建的客户端首次主动 `send()` 或 `ping()` 时，不可能已有服务端 binding，合法 response/pong 必然被拒绝。

这会形成启动死锁：双方都需要先收到对方的非响应消息才能接受响应。静态 transport binding 也未在 endpoint 创建时预注册。direct endpoint 测试因没有 connect 而绕过该路径，所以现有测试全绿不能证明 factory 公共路径可用。

必须实现既定 connect bootstrap：首次 response/pong 没有历史 token 时，当场执行 `baseIdentityCheck`；`useBaseIdVerifyOnly !== false` 时以该结果建立 canonical binding并忽略 `identifier`，显式为 `false` 时还要求必填 `identifier` 成功。无需新增 handshake、TOFU、`bootstrapPolicy` 或修改 verifier 返回类型；也不能用“拒绝首次响应”制造启动死锁。

### 4I.2 部分关闭：verified identity 丢弃部分真实来源且 registry 无容量边界

当 inbound metadata 含 `peerId` 或 `origin` 时，`#verifySource()` 故意不把 object `source` token 纳入 binding。Window 场景通常有 origin 和 source，因此多个同源 Window 只按 `(senderId, origin)` 合并，无法表达 verifier 已验证的具体 source。

`VerifiedPeerRegistry` 现在保留 `source` object token，有默认 1024 条 binding 上限、per-origin 128 条上限、oldest-first eviction 和 5 分钟 TTL；过期后重新认证。仍缺可配置的重新认证协议与更细粒度的 origin budget 策略。

identity 应包含 verifier 选择的规范化 binding components，而不是 endpoint 自行按“有一个 metadata 就忽略另一个”降级。registry 必须有容量预算、生命周期与重新认证策略。

### 4I.3 已关闭：通用 capability deep clone 会破坏 schema 与 opaque runtime object

`cloneCapability()` 把所有 object 重建为普通 `{}` 或 `[]`，只复制 enumerable string keys。合法 schema class 的 prototype `parse()`、symbol/non-enumerable state、Map/Set、typed array 和其他 opaque runtime object 会丢失。`IWebRpcSchema` 允许 class instance，因此 freeze 后 contract snapshot 可能没有 `parse()`，所有请求转为 schema failure。

capability snapshot 现在只复制 plain config containers 与数组；schema、codec function、transport handle、Map/Set、typed array 等 opaque leaf 按引用保留，避免丢失 prototype 或平台语义。回归测试覆盖 schema instance 的 `parse()` 保留。

### 4I.4 P1：constructor failure 未交给 ResourceScope rollback

endpoint 在 registration try 之前已把 owned transport close 注册进 `#resources`，但 constructor catch 仍使用旧的手工 `registrations.reverse()`，没有调用 `ResourceScope.releaseAll()`。构造失败后对象不可达，transport-close resource 永远不会执行；cleanup 失败的 registration 也无法由 scope 再次统一报告。

当前 constructor 是同步 API，无法正确 await async `ResourceScope.releaseAll()`。因此应让 constructor 保持无外部副作用，把 transport attach 移到 factory/静态 async creator：局部 scope 完成全部 registration 后 commit 给 endpoint，失败则 await `releaseAll()`。当前“scope + registrations 数组”双 owner 正是旧补丁链残留。

### 4I.5 部分关闭，P1：WebTransport reader 仍未纳入 ResourceScope

endpoint ResourceScope 只能拥有 transport 的公开 close，adapter 内部 read Promise 仍由 `void read()` 丢弃。`getReader()` 在 try 外、`releaseLock()` 在 finally 中且未隔离，任一异常会产生 unhandled rejection。最后一个 unsubscribe 发生在 pending read 时仍需等待未来 datagram 或 close，reader ownership 继续处于混合状态。

adapter 自身需要内部 ResourceScope 或一个明确的 read-loop owner Promise；public close await 该 Promise 并聚合 reader/writer cleanup error。endpoint scope 不能替 adapter 猜内部资源。

### 4I.6 已关闭：ResourceScope error 已统一，但 dispose diagnostic 被重复投影

`releaseAll()` 已统一 middleware、subscription 和 transport close error，这是有效修复。endpoint 随后先按 resource name 发一次 `middleware.dispose.failure/transport.failure`，又遍历同一 raw error 全部再发一次 `transport.failure`。middleware failure 因而被重复记录且被错误归类为 transport failure；最终 `cleanupErrors` 还丢失 resource name。

dispose 现在保留 `IResourceReleaseError[]` 作为结构化 cleanup report，每个 entry 只投影一次 hook；公开 error 的 `cleanupErrors` 保留 `{ resource, error }` 来源信息。

### 4I.7 架构收口判断

本轮与前八轮不同：问题不是“完全没有架构”，而是新架构只迁移了一半。

- `VerifiedPeerRegistry` 已解决 injective key，却尚未完整接入 `useBaseIdVerifyOnly` bootstrap、canonical identity schema 和容量模型。
- `ResourceScope` 已解决正常 dispose 聚合，却没有成为 constructor/adapter 的唯一 owner。
- capability snapshot 已解决发布者原地 mutation，却缺少每类 descriptor 的语义化 clone。
- 统一 `TaskSettlement` 尚未建立，request、ping、provider 仍各自编排状态。

因此不建议回退这些抽象，也不建议继续在 endpoint 中增加 bypass。下一阶段应为每个抽象补齐协议级 contract 和迁移边界，再删除旧并行 owner。

## 4J. 第十轮架构迁移新增问题

第十轮以当前 factory 公共路径、能力快照的可执行语义、构造失败回滚和 adapter ownership 为主线。上一轮两个具体异常点已有局部修复：response/pong 不再强制 `requireExisting`，WebTransport 的 `getReader()`、`read()` 和 `releaseLock()` 已进入同一异常边界。但修复仍停留在局部控制流，未完成抽象契约。

### 4J.1 P0：移除 require-existing 后未落实 base identity 策略，伪造 response 可首次结算

当前 `#receive()` 对所有 envelope 都以 `requireExisting=false` 调用 `#verifySource()`。因此首次 response/pong 不再死锁，但它们与 request 一样可以当场创建 verified binding。问题不在“首次可绑定”本身，而在 `connect()` 尚未实现 `useBaseIdVerifyOnly` 契约：transport 没有静态 `peerId` 且应用未提供 `identifier` 时直接返回 `true`，没有执行完整 `baseIdentityCheck`。BroadcastChannel、Window、ServiceWorker、RTC 和 memory adapter 正是常见的无静态 peerId transport。

结果是攻击者只需知道或猜中 pending taskId，并让 wire `senderId` 等于 targetId，就可使一条伪造 response 通过默认 verifier、现场建立 binding 并结算任务。此前 response mismatch 防护只比较声明字段，无法替代真实来源绑定。旧死锁被解除，但信任模型退化为“每条消息均可首次认证”，重新打开第一轮的响应冒充面。

修复采用主 SDD 已确定的唯一分支：`useBaseIdVerifyOnly !== false` 时执行完整 `baseIdentityCheck` 并忽略 `identifier`；显式为 `false` 时先通过基础验证，再要求必填 `identifier` 成功。两条路径成功后均建立同一 canonical binding。无需新增 `VerifiedPeerIdentity` 返回值、预配置 target API、handshake 或额外 bootstrap policy，也不能把基础验证实现成默认 allow。

### 4J.2 P1：frozen capability 的函数闭包仍读取原始可变 config

registry 现在会 clone/freeze capability 容器，但函数值按引用保留。多个内置 middleware 的函数仍闭包捕获调用方原始 config：timeout 的 `resolveTimeout()` 读取 `config.timeoutMs`，connect 的 `verify()` 读取 `config.identifier`，contract 的 `validateData()` 把原始 `config` 传给 schema 校验。

调用方在 `createEndpoint()` 成功后修改原 config，runtime 行为仍会变化；factory 所验证、冻结的 descriptor 与实际执行策略再次分离。现有测试只覆盖 plain nested object，不覆盖函数闭包中的外部引用，因此无法证明 owned snapshot。

每个 middleware 必须先 normalize 输入，再让能力函数只捕获该 owned snapshot 或已提取的 immutable leaf。验收测试需在 freeze 后修改 timeout、identifier、schema map 的原始输入，并证明 endpoint 行为不变。

### 4J.3 P1：通用 clone 破坏 opaque object，且 capability alias 被分别克隆

`cloneCapability()` 仍把任意非数组 object 重建为普通 `{}`，只复制 enumerable string key。class schema 的 prototype `parse()`、symbol/non-enumerable state、Map/Set、typed array 和 platform handle 仍会丢失。该问题不仅是兼容性：schema 校验可能在工厂成功后静默变成“无 parse 的对象”。

此外同一 capability 同时发布到短 key 与 `*Capability` key，但 `freeze()` 对每个 map entry 使用新的 `WeakMap`，两个 alias 被克隆成两个不同对象。任何依赖 identity 或共享 opaque leaf 的内部一致性都不再成立。

删除通用 deep clone。由 descriptor owner 定义字段级 snapshot schema；registry 只冻结已规范化结果。若保留 alias，两个 key 必须指向同一 owned snapshot，或直接删除重复 key。

### 4J.4 P1：ResourceScope 与旧 registrations 双 owner，构造失败会泄漏 owned transport

endpoint constructor 在 registration try 之前把 owned transport close 加入 `#resources`，随后又用局部 `registrations` 数组管理 subscription rollback。若 `subscribe()`、`onTransportError()` 或 `onListenerError()` 中途抛错，catch 只逆序调用 `registrations`，不会也无法 await `#resources.releaseAll()`。构造失败后 endpoint 不可达，已登记的 transport close 永久丢失。

这还产生双 owner：正常 dispose 由 scope 释放，构造失败由旧数组释放；两条路径聚合错误的结构也不同。constructor 必须保持无外部副作用。factory 或 async static creator 用局部 ResourceScope 完成 attach，成功后 commit 给 endpoint，失败时 await 同一个 `releaseAll()`。

### 4J.5 P1：verified identity 仍丢弃 source，两个 registry 仍无预算

`#verifySource()` 只要 inbound 有 `peerId` 或 `origin`，就不生成 object `sourceToken`。Window 的正常事件同时带 origin 与 source，多个同源 Window 因而仍会合并到同一个 `(senderId, origin)` binding；verifier 即使检查了具体 `event.source`，registry token 也没有保存这项事实。

`VerifiedPeerRegistry` 和 `PeerRegistry` 都只在 endpoint dispose 时整体清空，没有容量、TTL、per-origin 配额或 eviction。持续产生可通过 verifier 的 sender/source 会形成永久增长。identity 应由 verifier 返回完整 canonical components，registry 应有显式预算和过期策略；peer discovery 与安全 binding 不应复用无界集合语义。

### 4J.6 P1：WebTransport 已封住 rejection，但 read loop 仍没有可等待 owner

当前 `read()` 的同步和异步异常均会投影到 `transportErrors`，上一轮的 unhandled rejection 缺口已关闭。但 `void read()` 仍丢弃 owner Promise；最后一个 unsubscribe 发生在 pending `reader.read()` 时不会主动 cancel，public `close()` 只 await `activeReader.cancel()` 和 writer close，不显式 await read loop 完成及 finally 的 lock release。

因此“close resolve 后 reader 已完全退出、lock 已释放”仍不是可证明契约，unsubscribe 与 close 也继续拥有不同终止语义。adapter 应持有唯一 `readPromise`/内部 ResourceScope；close 触发 stop、await readPromise、释放 reader/writer，并用结构化 cleanup report 返回全部失败。

### 4J.7 P2：cleanup error 类型已公开，但构造与 dispose 仍有两种包装协议

`WebRpcError.cleanupErrors` 已加入公开 class，修复了上一轮类型缺口。但 factory cleanup failure 使用 `WebRpcConstructionError`，endpoint constructor 和 dispose 则创建普通 `WebRpcError`/`WebRpcLifecycleError` 后用 `Object.defineProperty()` 动态附加数组。前者保留 construction 语义，后两者依赖运行时补属性；dispose 还把结构化 `{ resource, error }` 降级成 raw error 并重复发 diagnostic。

定义统一 `WebRpcCleanupError` 或让各阶段 error constructor 原生接收 `IResourceReleaseError[]`。错误对象、公开类型和 hook 投影必须共享同一结构；每个 cleanup failure 只记录一次。

### 4J.8 第十轮收口判断

本轮没有发现需要推翻 `VerifiedPeerRegistry`、`ResourceScope`、async-control 或 retry utility 的证据；问题仍是 owner 与契约迁移不完整。最高风险集中在两个架构不变量尚未成立：verified identity 不是 verifier 的产物，owned snapshot 也不拥有函数闭包读取的数据。

停止继续添加 `requireExisting` 布尔分支或通用 clone 特例。下一实现批次应以两项模型测试先行：任意 response 事件排列不得绕过预绑定 identity；factory 返回后修改所有调用方 config 不得改变 endpoint 行为。随后完成 async attach/rollback 与 adapter read owner，才可恢复“架构收口完成”的判断。

## 4K. 第十一轮组合边界新增问题

第十一轮转向单项测试较难覆盖的组合路径：同步 transport failure 与异步 settlement、dispose 与 verifier、wire getter 与 identity、provider response 与发送失败、chunk framing 与 Unicode。现有 23 个 suite、47 个 case 仍全部通过，但以下路径没有测试覆盖。

### 4K.1 P0：同步 transport.send 抛错绕过 settlement，request/ping 永久残留

`#request()` 先把 task 写入 pending，再执行 `Promise.resolve(this.#send(request)).catch(...)`。JavaScript 会在进入 `Promise.resolve()` 前求值 `this.#send()`；若 transport 的 `send()` 同步抛错，异常直接逃出 Promise executor，由外层 Promise 自动 reject，后面的 `.catch()` 不会安装，`pending.settleReject()` 也不会执行。

结果是调用方已经收到 rejection，但 pending entry、AbortSignal listener 和 timeout control 仍存活。配置 `timeout: false` 时泄漏持续到 endpoint dispose；启用 retry 时每次同步失败都会新增一个泄漏 task。`ping()` 走相同模式，`dispatch()` 则会把本应 fire-and-forget 的同步异常直接抛给调用者。

所有调用外部函数的 Promise 归一化必须使用惰性边界：`Promise.resolve().then(() => send())`，或在 `try/catch` 中把同步异常交给同一个 settlement。request、ping、dispatch、provider response 和 variation 必须共享该 helper，不能各自写 `Promise.resolve(call())`。

### 4K.2 P0：dispose 不能阻止 in-flight verifier 返回后复活状态

`#receive()` 在 `await #verifySource()` 前后没有 closing generation 或 active 检查。若 connect verifier 尚未完成时调用 `dispose()`，dispose 会清空 chunks、verified peers、peer registry、provider 和 hooks；随后 verifier resolve，旧 receive continuation 仍可重新 bind identity、添加 peer、进入 provider routing，或对 chunk 调用 `accept()` 创建新的 30 秒 timer。

这些状态在 dispose 已完成后创建，不再有后续 owner 清理；provider 路径还可能尝试通过已关闭 transport 发送 response。`#disposed` 只保护公开入口，不能使已启动的 inbound work quiescent。

endpoint 需要 receive generation/closing signal。每个跨 await continuation 在产生状态前验证 generation；dispose 先关闭 admission，再 abort/await 全部 in-flight receive owner，最后清理 registry 与 transport。仅在 continuation 中补一次 `if (disposed)` 不足以覆盖 verifier、decode、provider 和 send 的多段 await。

### 4K.3 P0：wire validator 只做 type predicate，不生成稳定快照，存在 accessor TOCTOU

`isWebRpcEnvelope()` 在 try 中读取字段并返回原始对象。endpoint 随后在认证、contract 检查、target routing 和 settlement 阶段反复读取同一对象。恶意 Proxy/getter 可在不同读取次数返回不同 `senderId`、`targetId`、`taskId`、`method` 或 chunk metadata。

因此 verifier 可能认证 sender A，后续 settlement 却消费动态变成 sender B 的 response；当 pending 尚无 verified key 时，B 的 task 可被使用 A identity 得到的 token 结算。chunk 也可能以一组 metadata 认证、用另一组 metadata 建立 assembly。全局 try 只能防异常逃逸，不能防值随时间变化。

wire 边界必须一次安全读取所有允许字段，验证后创建无 getter 的 frozen canonical envelope；后续层只消费该快照。type predicate 不适合承担 untrusted-object normalization。

### 4K.4 P1：provider response 发送失败会尝试发送第二条 failure response

`ProviderExecutor.execute()` 把 provider 执行、result validation 和 response send 放在同一个 try。正常 response 的 `send()` reject 会进入 catch；catch 将 transport/serialization failure 当成 provider failure，再调用 `failureResponse()` 发送第二条 response。

若第一次 send 已部分交付后才 reject，对端可能收到成功与失败两个 response；若 transport 已终止，第二次 send 通常再次 reject，使 `emitFailure()` 被跳过并把错误交给更外层的 receive rejection handler。业务执行错误与传输提交错误没有阶段边界。

先生成唯一 response，再通过单独 transport commit 阶段发送。provider/validation failure 可以决定 response 内容；response commit failure 只能记录并终止，绝不能生成第二条业务 response。

### 4K.5 P1：UTF-8 splitter 对大于 chunkSize 的单 code point 生成违规 frame

`splitUtf8()` 只在当前 part 非空时切分。若单个 Unicode code point 的 UTF-8 长度大于 `maxBytes`，例如 `chunkSize=1` 的 emoji，函数仍把 4 字节字符放入一个 part。middleware 允许任意正整数 chunkSize，sender 不再校验 split 输出，receiver 则按 chunkSize 拒绝该 frame。

transport send 会成功，原 request 却永远得不到 response，只能等待 timeout；timeout false 时永久 pending。修复需在装配期要求 `chunkSize >= 4`，或让 splitter 对不可容纳 code point 明确抛 config/serialization error。pipeline 还必须验证 custom split 的 non-empty、join equality、part count 和每-part byte budget。

### 4K.6 P1：chunk-ack 在 decode 前发送，且没有对应 outbound 状态机

receiver 在 assembler 完成后立即发送 `chunk-ack`，之后才 decode assembled payload。若完整 payload 无法 decode，sender仍会收到 ACK，语义上声称消息已接受。与此同时 outbound pipeline 没有保存 messageId→send state，收到 ACK 只发 hook，不参与 delivery、retry 或 cleanup。

当前 ACK 是既不提供可靠性又可能报告假成功的半协议。明确选择一种契约：若不支持可靠 chunk delivery，删除 ACK；若支持，ACK 必须在 decode、wire normalization 和 admission 成功后发送，并由有界 outbound state machine 消费，具备 timeout、retry、identity binding 和 dispose cleanup。

### 4K.7 P1：terminal transport failure 只结算 outbound，不终止 inbound work

`#failTransport()` 只 reject request pending、settle ping 并发 hook。active provider controllers、partial chunks、in-flight verifier 和 verified identity 保持存活。对于 MessagePort close、Worker error 等终止事件，provider 可继续耗费资源并在完成后尝试发送；chunk timer继续等待不可能到达的后续 frame。

transport error contract 必须区分 transient diagnostic 与 terminal close。terminal 事件进入与 dispose 相同的 admission-close/abort/clear transaction，但是否关闭 borrowed transport由 ownership决定；transient 事件不能无差别失败全部 pending。

### 4K.8 P1：schema error 归一化再次读取不可信 error，可被 Proxy 覆盖

`validateContractData()` 捕获 schema error 后直接执行 `'issues' in cause`、读取 `cause.issues`、遍历 issue getter，并在 fallback 中调用 `String(cause)`。恶意 schema 或 Proxy error 可让这些操作再次抛错，替换原始 `WebRpcSchemaValidationError`；本地 send 暴露 raw exception，provider 路径则可能降级成 INTERNAL。

error normalization 也属于不可信边界。使用 safe reader 和不可抛 stringify，逐项复制 issue 到 plain snapshot；任何二次读取失败都回退为固定、脱敏的 schema issue，不能改变错误 code。

### 4K.9 P2：部分 adapter 的 hostile event 防线仍可二次抛错

SharedWorker adapter 在 try 外读取 `event.data`，getter 抛错会越过平台 callback。WebWorker 虽捕获 data getter，但 catch 中的 `String(error)` 仍可对 hostile Proxy error 抛错；error handler 也可能取得非 string `message` 后在模板插值时抛错。

所有 adapter 复用同一个 listener-safety/safe-string helper。平台事件字段一次安全读取并复制，diagnostic 构造不得再次执行用户对象 getter、`toString` 或隐式模板转换。

### 4K.10 第十一轮收口判断

本轮新增问题再次指向缺少 transaction owner，而非九个独立条件错误：wire 没有 parse-and-snapshot transaction，receive 没有 generation owner，outbound send 没有统一 sync/async commit boundary，provider 没有 response commit phase，chunk ACK 没有 delivery state machine。

优先级应调整为：先修同步 send settlement、receive quiescence 和 canonical wire snapshot 三个 P0；再拆 provider commit、决定 ACK 去留、统一 terminal transport failure。继续在各调用点追加 catch 会保留同类窗口。

## 4L. 第十二轮协议重放与公共边界新增问题

第十二轮检查任务身份的时间维度、聚合 API 的字典边界、retry policy cancellation 和 middleware 配置入口。当前实现已能阻止同一 active provider key 的并发覆盖，但没有处理任务完成后的 replay。

### 4L.1 P0：已完成 request 可被重放并再次执行 provider 副作用

inbound request 只在 `activeControllers` 中检查 `(verifiedPeerKey, senderId, taskId)` 是否当前执行。provider 完成后 finally 立即删除 key，系统不保留 completed tombstone、sequence 或 replay window。`sentAt` 只验证为 safe integer，不检查负值、未来值或允许时钟窗口。

攻击者重放一条曾通过认证的完整 request，provider 会被再次执行；`dispatchOnly` 重放同样会重复事件副作用。付款、写入、通知等非幂等 provider 因此没有协议级 at-most-once 保障。identity binding 只能证明来源，不能证明新鲜度。

wire contract 必须明确 delivery 语义。若承诺 at-most-once，按 verified identity 保存有界 task tombstone/response cache，至少覆盖最大网络重放窗口；若只提供 at-least-once，README 和 provider API 必须强制要求业务 idempotency key，且不能把 duplicate active check描述成 replay protection。`sentAt` 需要最大过去/未来偏移，但时间检查不能替代 nonce/tombstone。

### 4L.2 P0：UUID 只检查 active ID，复用后旧 response/abort 可命中新任务

`allocateRpcId()` 的 `isUsed` 只查询当前 request/ping map。任务 settle 后 ID 立即可复用。自定义 generator 是公开能力，测试甚至示例固定返回 `id`；对相同 target/method 发起第二次请求时，延迟或重放的第一条 response 与新 pending 的 taskId、senderId、targetId、method 全部相同，可直接结算第二个请求。旧 abort variation 也可取消复用 ID 的新 provider task。

仅增加随机 UUID 不构成协议证明。endpoint 需要 generation/nonce 与有界 recently-used ID tombstone，并把 attempt identity 纳入 response/abort binding。generator 冲突应在有风险窗口内重试或稳定失败，不能只看 active map。

### 4L.3 P1：fan-out 结果使用普通对象，攻击者 targetId 可触发原型语义

`sendAll()` 和 `pingAll()` 用 `{}` 创建 fulfilled/rejected，再执行 `result[target] = value`。peer ID 来自认证入站 senderId，允许 `__proto__`、`constructor`、`toString` 等合法非空字符串。`__proto__` 赋对象会改变返回字典原型，赋 primitive 则不会创建可枚举 own property；调用方看到的 key 集合和对象行为与类型声明不一致。

聚合结果必须使用 `Object.create(null)`、`Map`，或显式安全字典 builder；若公开 null-prototype record，README/USEGUIDE 必须说明其可观察语义。所有 attacker-controlled key 的输出面统一复用该 builder。

### 4L.4 P1：fan-out 方法没有统一 active guard，行为取决于 peer 数量

`sendAll()`、`dispatchAll()` 和 `pingAll()` 自身不调用 `#assertActive()`。dispose 后 peer 集合为空时，三个方法分别成功返回空结果或静默 no-op；有 peer 时，内部 `send/dispatch/ping` 才失败。`sendAll/pingAll` 还会把 lifecycle error 收进 rejected map，而不是使聚合调用本身 reject。

同一 disposed endpoint 的契约因此依赖历史 peer 数量。所有公开入口先统一 active check，再 snapshot peers；endpoint lifecycle failure 属于整个 operation failure，不应伪装成逐 target 业务结果。

### 4L.5 P1：retry policy callback 不响应 abort/dispose，可永久悬挂 send

`executeWithRetry()` 会在 attempt 前和 backoff 中检查 signals，但 `decide()` 本身直接 await。endpoint 的 `shouldRetry()` 与 `delay()` 可异步执行；若任一 Promise 永不 settle，用户 abort 或 endpoint dispose 都无法中断该 await，公开 `send()` 永久 pending。

policy callback 是 retry transaction 的一部分，必须与 closing/user signals race，并观察迟到 rejection。更简单的契约是 policy 必须同步；若保留 async policy，使用统一 async-control owner，不新增裸 race。

### 4L.6 P1：provider dispatchTo 将空 id 解释为广播

context 的 `dispatchTo({ id, method, data })` 使用 `if (id)` 判断定向发送。调用方显式传入 `id: ''` 时不会触发 identifier 校验，而是进入缺省分支，向除请求来源外的全部 peer 广播。一个本应失败的目标输入会扩大数据传播范围。

缺省与非法值必须区分：仅 `id === undefined` 表示广播；任何提供的 id 均先执行 identifier validator。安全 API 更适合拆成 `dispatchTo(id, ...)` 与 `dispatchAll(...)` 两个显式方法，避免 optional 字段控制 fan-out。

### 4L.7 P1：protocol middleware 接受不可执行 codec，装配期检查不完整

`protocol()` 不验证 `encode/decode` 是否函数，也不验证 `encodedType` 是否允许值。truthy string/object 会被发布为 capability，factory 的 compatibility check 只比较 descriptor 字段，endpoint 创建成功后首次发送/接收才以 TypeError 失败。错误被包装成 serialization/receive failure，掩盖真正的 INVALID_CONFIG。

middleware install 必须验证所有 executable leaf 与 discriminant；factory normalize 后再次验证 immutable descriptor。不能依赖 TypeScript 类型阻止 JavaScript、反序列化配置或 `as unknown as` 输入。

### 4L.8 P2：hooks middleware 对非法 listener/onHookError 静默降级

`hooks()` 原样发布 config。非函数 listener 会进入 HookRegistry，每次 emit 都产生被隔离的 TypeError；非函数 `onHookError` 也只在 diagnostic 边界再次失败并被吞掉。endpoint 可成功创建，但用户配置的可观测性完全失效且没有稳定安装错误。

安装期验证 listener 数组、每个函数和 `onHookError`；非法配置抛 `INVALID_CONFIG`。运行时隔离只处理合法 callback 自身失败，不能替代配置校验。

### 4L.9 第十二轮收口判断

此前架构清单缺少一等 anti-replay owner。`VerifiedPeerIdentity`、`TaskSettlement` 和 `ResourceScope` 即使全部落地，也只能解决“谁发送、谁结算、谁清理”，不能回答“这是否是旧任务的合法重放”。目标架构需新增 `ReplayWindow`/task generation，并明确 at-most-once 或 at-least-once 语义。

同时公共 API 必须统一入口 guard 和 attacker-key dictionary；这些不是文档润色，而是运行时安全边界。优先级：anti-replay model → ID tombstone/generation → fan-out safe dictionary与active guard → cancellable retry policy → middleware descriptor validation。

## 4M. 第十三轮分布式名称解析与 receiver 路由新增问题

第十三轮以“每个 endpoint 同时是 client、server 与分布式 DNS”为目标模型，对照检查 receiver 注册、名称解析、单发/聚合 settlement、缓存收敛和管理 API。当前实现新增了 announcement 与 registry，但解析结果尚未真正成为请求路由的唯一输入。

### 4M.1 P0：实现引入了不存在的 target alias 与主动注册模型

当前实现公开 `registerTarget(targetId)`，允许 endpoint 为任意额外 target 创建 receiver，并立即向所有观察者 announcement。目标模型中 endpoint 的 `id` 就是唯一可受理 id，不存在额外 alias；DNS 也不是 endpoint 启动或手工注册时主动扩散，而是 requester 首次连接目标时才发起的惰性查询。

删除任意 alias registration 路径。connect/query 必须是：requester 广播查询 `targetId` → 仅 `endpoint.id === targetId` 的节点受理 → 受理方逻辑单播 connect response → 只有 requester 更新 DNS。后续 request admission 继续严格要求 `targetId === endpoint.id`；这条检查本身是正确边界，不应改成 local alias lookup。

### 4M.2 P0：实现用 realm counter 伪造 BroadcastChannel 唯一性

receiverId 使用 `${targetId}-${endpointId}-${instanceCounter}-${moduleCounter}`。counter 只在当前 JavaScript realm 内递增，既不能证明两个 tab 是不同实例，也不能证明相同值代表同一实例。当前实现却把它作为可 pin、可注销和可匹配 response 的真实 receiver identity，产生了框架并不具备的唯一性承诺。

BroadcastChannel 必须按两种模式实现：没有配置 `uniqueTargetId` 时，把该 target 视为广播组，不生成实例 receiverId；只有同时满足非空 `uniqueTargetId`、`useBaseIdVerifyOnly: false` 与自定义 `identifier` 时，connect 才把本端值作为控制消息的 `data.__unique_id__` 传递，并在对端验证后生成 `${targetId}:${__unique_id__}` DNS key。该值属于应用定义的逻辑唯一性，不能宣传为信道认证。两种模式的 DNS 都 omit 当前 endpoint 自身。

### 4M.3 P1：活跃 receiver 没有续租，五分钟后必然永久 stale

远端 entry 只在 register announcement 或成功 response/pong 时刷新 `lastSeenAt`。健康但空闲的 receiver 在五分钟后被 `getServerList()` 标记 stale，并被 `sendAll/pingAll` 排除；`registerTarget()` 对已 active target 直接返回旧 receiverId，不会重新 announcement。系统没有 heartbeat、lease renewal 或 stale probe，因此正常服务会仅因空闲从 DNS 中永久消失。

discovery 必须选择明确模型：周期 lease announcement、查询时主动 resolve、或 stale entry 先 probe 再剔除。timer 应由统一 ResourceScope/async-control owner 管理，并设置 jitter、unref 与 dispose cleanup。仅依赖业务流量 touch 不能作为服务注册续租协议。

### 4M.4 P1：BroadcastChannel unregister 可被任意参与者伪造

announcement 只携带公开的 targetId、receiverId、platform 与时间。任意同源 BroadcastChannel 参与者观察 register 后，都能广播同 tuple 的 unregister；接收端会直接删除 entry，并在最后一个 receiver 消失时清 learned peer。当前没有 source binding、owner token、签名或 registration generation。

这与验证矩阵“伪造或远程注销其他 server 稳定拒绝”不可同时成立。由于 BroadcastChannel 本身不提供唯一来源指纹，必须显式选择：把 registry 定义为诚实参与者下的非安全 discovery，并删除不可实现的安全承诺；或引入应用提供的 announcement authenticator/不可伪造 owner credential。receiverId 公开且可观察，不能充当注销凭据。

### 4M.5 P1：local receiver 被错误混入当前 endpoint 的 DNS

`#getServerList()` 当前合并 `#localTargets` 与 `#remoteTargets`；`#fanoutTargets()`、`sendAll/pingAll`、多 receiver 诊断与 `#pinReceiver()` 又消费这个合并视图。结果是 endpoint 自己注册的 receiver 被当作自己的 DNS 解析结果：它会参与重复 receiver 告警，可能被 pin，并进入出站 fan-out。BroadcastChannel 不向发送者自身投递，因此 pin 到自己的 local receiver 还会形成无人能够受理的请求。

local registration 与 DNS cache 必须是两个明确 projection：`#localTargets` 只负责 server ownership、入站 admission、注销和 dispose；resolver、`getServerList()`、pin、diagnostic 与出站 fan-out 只读取 remote registry。当前 endpoint 永远从自己维护的 DNS 结果中 omit，不能 pin 或发送给自己的 receiver。

### 4M.6 P1：重复 receiver 的 hook 与控制台诊断丢失关键结构

既定 hook 要求 `requesterId` 与 `receiverIds[]`；当前通用 hook 只有一个 `receiverId` 字符串，并把多个 id 通过 tuple 编码塞入该字段。`console.warn` 也不包含 endpoint id、receiver 列表、pin/unregister 建议。用户无法结构化消费冲突集合，日志也没有足够信息执行修复。

定义可判别的 connect hook union，原样携带 frozen `receiverIds` snapshot。console 文案复用同一 snapshot builder，包含 requester、target、receiver 列表及两类管理建议；diagnostic failure 继续保持不可影响 registry。

### 4M.7 P1：项目禁用的 `.call()` 在新路由代码中重新出现

endpoint transport registration/close/announcement、outbound pipeline 与 safe-value 仍使用 `.call()`。这不仅违反根目录 `AGENTS.md` 的硬规则，也使第十二轮“审计已归零”的结论失真。

构造时用箭头函数捕获 transport，并通过正常成员调用保持 receiver，例如 `const send = (message, options) => transport.send(message, options)`。跨 realm Uint8Array 判断改用不依赖 `Object.prototype.toString.call()` 的安全 predicate，或建立经项目规则批准的专用实现；不得在文档中把违规调用标成“有意保留”。

### 4M.8 第十三轮收口判断

这七项不是七个孤立补丁。前两项共同证明 resolver 没有拥有完整的 `resolve → snapshot → route` transaction：注册表写入了 receiver，入站仍按 endpoint id 过滤，BroadcastChannel 又用 counter 伪造并不存在的实例唯一性。stale、pin 与 diagnostics 则分别维护了自己的 target/receiver 视图。

下一实现批次应先定义能区分 `broadcast-group | identified-receivers` 的 `ResolvedTargetSnapshot`，让 send、sendAll、dispatch、ping 和 inbound admission 全部消费同一 registry owner；再实现 parent/child settlement 和 lease convergence。BroadcastChannel 唯一性模式与 alias admission 属于本批次 P0，不应继续在当前 counter receiver 与广播单 pending 上追加条件分支。

## 5. 目标架构

### 5.1 入站 transport envelope

transport 必须保留 payload 与真实来源信息：

```ts
type IWebRpcInboundMessage<T = unknown> = {
  readonly data: T;
  readonly peerId?: string;
  readonly origin?: string;
  readonly source?: unknown;
};
```

`subscribe()` listener 接收该结构。adapter 负责从平台事件提取 metadata；没有可靠 metadata 的 adapter 明确返回 undefined，不能用 wire senderId 伪造真实 metadata。

依赖方向保持：

```text
platform event
  → adapter 提取真实 metadata
  → connect 验证 source ↔ senderId 绑定
  → wire/contract 验证
  → endpoint routing
```

Window adapter 必须：

- 默认要求显式 `targetOrigin`，除非调用方显式选择不安全的 `'*'`。
- 入站保留 `event.origin` 和 `event.source`。
- 支持应用提供允许的 origin/source 策略。

### 5.2 两阶段 chunk 处理

chunk frame 不得直接进入长期 assembler。流程改为：

```text
最小结构验证
  → target 检查
  → source/sender 认证
  → chunk metadata 与预算检查
  → assembler
  → protocol decode
  → 完整 envelope 验证
```

assembler key 使用 `(verifiedPeerKey, senderId, messageId)`，并维护：

- `maxConcurrentMessages`
- `maxConcurrentMessagesPerPeer`
- `maxChunksPerMessage`
- `maxChunkBytes`
- `maxMessageBytes`
- `maxBufferedBytes` 与 per-peer budget
- `assemblyTimeoutMs`

所有 `index`、`total`、长度值必须是非负 safe integer。每次写入前计算实际 UTF-8 字节数，完成后再次验证累计值。拒绝时立即清理该 assembly，并发出可观测 hook。

### 5.3 Inbound task settlement 状态机

ProviderExecutor 不再以一个 AbortController Map 代表全部状态。每个 inbound task 至少包含：

```text
active → aborted | responded | failed | disposed
```

规则：

- 只有 `active` 可以调用框架 send/dispatch。
- abort、dispose 和首次 response 通过同一个原子 settlement helper 改变状态。
- provider resolve/reject 后必须重新检查状态。
- aborted/disposed 的迟到结果、异常和 `dispatchTo()` 不产生 wire 副作用。
- context 过期调用产生 `PROVIDER_CONTEXT_EXPIRED` hook，不返回一个看似可继续发送的普通 result。
- duplicate `(verifiedSender, taskId)` request 必须拒绝或幂等复用，不得覆盖 controller。

### 5.4 Pending response 认证

pending task 保存预期的：

- taskId
- method
- target endpoint id
- verified peer identity/binding

response 只有全部匹配时才能 settle。未知或不匹配 response：

- 不删除 pending。
- 不清 timer 或 abort listener。
- 发出 `response.unmatched` hook。
- 可按 peer 速率限制记录，避免日志攻击。

taskId 继续要求高熵，但安全性不能只依赖 taskId 不可猜。

### 5.5 Receive 最终错误边界

transport callback 必须把所有异步错误收敛到 endpoint：

```ts
transport.subscribe((message) => {
  void receive(message).catch(reportReceiveFailure);
});
```

`reportReceiveFailure` 不得再次抛错；它只分类错误、发 hook，并按错误类型决定是否关闭 transport 或失败 pending。

### 5.6 Dispose 顺序

dispose 分为明确阶段：

1. 原子切换为 closing，拒绝新工作。
2. 取消 transport subscription，阻止新入站。
3. 同步 settle 所有 outbound pending 和 ping pending。
4. abort 并失效所有 inbound task/context。
5. 清理 chunk、peer、provider、hook 与 timer 状态。
6. 逆序 dispose middleware；每个 disposer 错误隔离，可选配置时间预算。
7. 关闭 transport。
8. 进入 closed；并发 dispose 共用同一个 Promise。

middleware disposer 不得阻止步骤 1–5。

### 5.7 Middleware 生命周期所有权

PluginHost 是 middleware 生命周期的唯一 owner。factory 将 middleware descriptor 转换为 plugin definition；install 期间由 PluginHost 登记 disposer，负责串行安装、失败回滚和逆序 dispose。capability registry 负责安装期能力发布、冲突检测和冻结，不承载请求 pipeline。

### 5.8 Retry 与 cancellation 分类

retry 以稳定错误分类决定默认行为：

| 错误分类                   | 默认重试             |
| -------------------------- | -------------------- |
| 暂时 transport failure     | 是，可由 policy 覆盖 |
| deadline exceeded          | 按 policy            |
| remote 明确 transient code | 按 policy            |
| abort、disposed            | 否                   |
| schema、contract、config   | 否                   |
| 普通 remote 业务失败       | 否                   |

retry delay 使用同时监听请求 AbortSignal 与 endpoint closing signal 的可取消 timer。每次 attempt 前重新执行 active 检查。`maxAttempts` 明确定义为总尝试数；若保留当前“额外重试数”语义则重命名为 `maxRetries`。

### 5.9 Protocol/framing 完整性

必须选择一种明确方案：

1. protocol 编码完整 chunk frame，让 metadata 进入签名/加密边界；或
2. chunk 层提供独立 frame authenticator，覆盖 sender、target、messageId、index、total 与 payload digest。

frame 认证必须发生在 assembler 创建状态之前。protocol capability 同时声明 encoded 类型（如 string、Uint8Array）；factory 据此校验 transport 与 chunk 能否消费该类型。

### 5.10 Owner-aware capability registry

保留 key 使用 write-once owner 语义：不同 middleware 重复发布立即抛 `CAPABILITY_CONFLICT`，不能静默覆盖。endpoint 构造前冻结 capability snapshot。优先复用 PluginHost shared/resource ownership，不新增平行生命周期系统。

### 5.11 Hook failure firewall

hook 统一通过 `Promise.resolve(result)` 观察 Promise 和 thenable。listener、`onHookError` 与最终 diagnostic sink 分三层隔离；任何一层错误都不得再次进入同一个 hook registry，避免递归失败。

安装期 hook 先进入 factory-owned buffer，endpoint 创建成功后按顺序回放；创建失败时交给 factory diagnostic handler，而不是 no-op。

### 5.12 Provider result branding 与错误脱敏

`success()` / `failed()` 返回带私有 symbol brand 和当前 task token 的内部 result。ProviderExecutor 只接受同一 context 创建且仍 active 的 result。普通结构对象视为 `PROVIDER_NOT_SETTLED`。

INTERNAL response 只暴露稳定 code 和通用 message；原始异常只进入本地 hook。应用显式 `failed()` 和 schema issue 是否对端可见，按公开契约单独规定。

### 5.13 Wire safe reader

wire validator 必须捕获 getter/proxy 异常，数值要求 safe integer，所有 envelope kind 使用统一 identifier、target 和来源校验顺序。任何 kind 都不得在 connect verification 前产生长期状态或语义 hook。

### 5.14 Dispose 与 transport ownership

endpoint 保存 `#disposePromise`，并发调用共享成功或失败结果。transport 声明 `owned | borrowed`：owned 由最终 lease owner 关闭，borrowed 只 unsubscribe。共享 transport 的引用计数由 transport factory 管理，endpoint 不猜测消费者数量。

### 5.15 Timeout race、retry 与内部 utility 抽取

`endpoint.ts` 只负责编排 RPC 语义，不继续内联 timer race、retry loop、AbortSignal listener 清理和错误分类。工具按行为所有权拆分，禁止建立无边界的 `utils.ts`。

目标目录：

```text
src/internal/
├── async-control.ts       # timeout race、可取消 delay、signal 监听与 timer 清理
├── retry.ts               # retry policy、attempt 编排、错误分类
├── settlement.ts          # pending 单次结算与统一资源清理
├── safe-value.ts          # 不可信对象的安全字段读取与基础断言
└── listener-safety.ts     # adapter/hook listener 的同步、异步错误隔离
```

这些模块保持 runtime-neutral，不依赖 endpoint、middleware、adapter、DOM 或 Node。`endpoint.ts`、`wire.ts` 和 adapter 只能向内依赖它们。

#### 5.15.1 `async-control.ts`

公开给包内的最小能力：

```ts
type IAsyncControlOptions = {
  readonly timeoutMs?: number | false;
  readonly signals?: readonly AbortSignal[];
  readonly onTimeout?: () => void | Promise<void>;
  readonly createTimeoutError: () => Error;
  readonly createAbortError: () => Error;
};

declare function raceWithAsyncControl<T>(
  operation: PromiseLike<T> | (() => PromiseLike<T>),
  options: IAsyncControlOptions
): Promise<T>;

declare function waitWithSignal(
  delayMs: number,
  signals: readonly AbortSignal[],
  createAbortError: () => Error
): Promise<void>;
```

`raceWithAsyncControl()` 不直接使用无法清理 loser 的裸 `Promise.race()`。它显式维护 settled 标记，并保证：

- operation、timeout、任一 abort signal 只有第一个可以决定结果。
- 任一分支 settle 后立即 `clearTimeout` 并移除所有 signal listener。
- timeout 胜出时只执行一次 `onTimeout`；该回调用于发送远端 abort variation。
- `onTimeout` 是 best-effort，失败不能替换主 `WebRpcTimeoutError`，但必须进入 diagnostic。
- Node/Bun timer 使用 `.unref?.()`，浏览器 timer 保持兼容。
- 已 aborted signal 在启动 operation 前失败，避免已取消任务产生发送副作用。
- operation 的迟到 resolve/reject 被观察但不能形成第二次 settlement 或 unhandled rejection。

所有内部 timer 由 `async-control.ts` 的统一 factory 创建，并执行 `.unref?.()`：

```ts
declare function createRuntimeTimer(
  task: () => void,
  delayMs: number
): {
  readonly clear: () => void;
};
```

`clear()` 幂等；request、ping、retry 和 chunk 不再直接调用 `setTimeout()`。

`waitWithSignal()` 供 retry backoff 使用。delay 为 0 时仍先检查 signal；非法的负数、NaN、Infinity 在调用入口拒绝，不创建 timer。

#### 5.15.2 `retry.ts`

retry utility 不认识 transport、wire 或 pending Map，只消费 attempt 函数与分类策略：

```ts
type IRetryDecision =
  { readonly retry: false } | { readonly retry: true; readonly delayMs: number };

type IRetryExecutorOptions<T> = {
  readonly maxAttempts: number;
  readonly signals: readonly AbortSignal[];
  readonly attempt: (attempt: number) => Promise<T>;
  readonly decide: (error: unknown, attempt: number) => Promise<IRetryDecision>;
  readonly createAbortError: () => Error;
};

declare function executeWithRetry<T>(options: IRetryExecutorOptions<T>): Promise<T>;
```

约束：

- `attempt` 从 1 开始，`maxAttempts` 表示总尝试次数。
- 每次 attempt 与 delay 前检查 signals。
- delay 统一委托 `waitWithSignal()`，禁止 retry 模块另建 timer。
- `decide()` 自身失败时停止 retry，并保留 policy error 的 cause 链。
- abort、disposed、schema、contract、config 和普通 remote failure 的默认分类为不可重试。
- utility 不复用同一个 taskId；每次 attempt 的 request/task 创建仍由 endpoint 拥有。
- 前一次 attempt 必须完全 settle 并清理 pending 后，下一次才能开始。

#### 5.15.3 `settlement.ts`

pending 的 timer、abort listener、registry entry 和 Promise resolve/reject 必须通过一个 idempotent settlement primitive 清理。endpoint 的 response、abort、timeout、send failure、transport failure 和 dispose 都调用同一 primitive，禁止各自复制清理顺序。

settlement utility 只操作调用方传入的 cleanup closure，不直接依赖 `PendingRegistry`，避免反向依赖：

```ts
declare function createSettlement<T>(options: {
  readonly cleanup: () => void;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}): {
  readonly isSettled: () => boolean;
  readonly resolve: (value: T) => boolean;
  readonly reject: (error: unknown) => boolean;
};
```

boolean 返回值表示本次是否赢得 settlement，便于 timeout/abort 决定是否发送远端 variation。

cleanup failure 不得替换主结果或阻止主 settlement。API 增加可选的不可抛 diagnostic：

```ts
readonly reportCleanupError?: (error: unknown) => void
```

#### 5.15.4 其他可复用工具

| 模块                 | 抽取内容                                                                   | 不应包含                         |
| -------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| `safe-value.ts`      | safe property read、plain record 判断、safe integer/string identifier 读取 | wire kind、RPC error code        |
| `listener-safety.ts` | Promise/thenable 观察、同步异常隔离、不可抛 diagnostic                     | endpoint hook 名称、平台事件类型 |
| `id.ts`              | UUID 分配、冲突检测、identifier 长度组合检查                               | pending lifecycle                |
| `chunk.ts`           | UTF-8 长度、split、assembler 与预算                                        | protocol codec、transport send   |
| `contract.ts`        | schema 调用与 issue 投影                                                   | retry、timeout、provider routing |

仅当至少两个合法调用方需要完全相同语义时才抽取工具。单点的两三行校验继续留在 owning module，避免“工具类”演化为无所有权的杂物层。

#### 5.15.5 依赖方向

```text
endpoint.ts ─┬─► retry.ts ─► async-control.ts
             ├─► settlement.ts
             ├─► id.ts
             └─► pipeline.ts

wire.ts ─────────► safe-value.ts
hooks/adapters ──► listener-safety.ts
```

`async-control.ts`、`retry.ts`、`settlement.ts` 之间不得形成环；utility 不 import `endpoint.ts`、`factory.ts`、middleware 或 adapters。

### 5.16 结构化身份与构造事务

认证后的身份不得退化为分隔符字符串。以下状态均以结构化 owner 管理：

- inbound provider task：`Map<VerifiedPeerToken, Map<TaskId, TaskState>>`
- chunk assembly：`Map<VerifiedPeerToken, Map<MessageId, Assembly>>`
- per-peer budget：与 assembly 使用同一个 `VerifiedPeerToken`

`VerifiedPeerToken` 由 connect 在来源验证成功后创建，绑定 adapter 提供的 `peerId/origin/source` 与声明 senderId。它是 endpoint 内部 opaque identity，不进入 wire，也不能由远端字符串自行构造。

endpoint 外部资源挂载使用事务：每次成功 subscribe/register 后立即把 disposer 压入局部 rollback stack；对象完全构造成功后才把 stack 转移给 endpoint。任何后续注册失败都逆序执行 rollback，且 cleanup error 通过稳定 construction error 契约观测。

所有 async-control callback、error factory、listener add/remove 与 diagnostic 都经过不可越界调用边界。主 Promise 必须在 callback 同步抛错时仍获得确定终态并清理 timer/listener。

### 5.17 Canonical transport 与统一 release transaction

factory 装配期间只允许一个 canonical transport。middleware context、connect capability、endpoint、protocol compatibility 和 ownership 都引用同一对象；多个入口提供不同对象时立即抛 `INVALID_CONFIG`。

constructor rollback、endpoint dispose 和 adapter detach 共享 release transaction 语义：

1. endpoint 自有 pending、ping、provider 和 chunk 先进入终态。
2. 外部 registrations 逆序释放，每一步失败只记录、不短路。
3. middleware disposer、capability clear 与 owned transport close 继续执行。
4. 最终以稳定 lifecycle error 附带有序 `cleanupErrors`，并同步发送不可抛 diagnostic。

adapter 必须声明 reader/listener ownership。unsubscribe 是否释放底层 reader、是否允许 resubscribe、close 如何与 pending read 竞争，均属于 transport contract，不能依赖“未来可能再收到一条消息”完成清理。

### 5.18 Replay window 与任务 generation

verified identity 只作为 replay namespace，不替代 freshness。每个 identity 维护有界 replay state：active task、recently completed tombstone，以及可选的 cached response。taskId 在 active + replay window 内不得复用；abort、response 与 retry attempt 绑定具体 generation。

replay state 必须同时受容量、TTL 和 per-peer budget 约束，并由 ResourceScope 在 dispose/terminal transport close 时释放。超出预算采用稳定拒绝或明确 eviction policy；不得因攻击者持续发送唯一 taskId 形成新无界 Map。

协议公开选择一种语义：

- at-most-once：重复 request 不再次执行 provider，可重发缓存 response 或返回稳定 duplicate error。
- at-least-once：允许重放执行，但 provider context 明确暴露 idempotency key，文档要求业务去重。

两种语义不能由当前 active controller 是否存在偶然决定。`sentAt` 只提供时间窗口辅助，不能作为唯一 replay proof。

## 6. 公共契约调整

### 6.1 Peer 发现

peer registry 区分：

- configured：由 `targetIds` 明确配置。
- verified：从认证成功的入站消息建立。
- speculative：不进入 registry，仅用于单次显式 send。

`sendAll()`、`dispatchAll()` 和 `pingAll()` 只使用 configured + verified 快照。一次任意 target send 不得永久污染 fan-out。

### 6.2 Identifier 前置验证

创建和发送入口统一调用 contract identifier validator：

- endpoint id
- target id
- method/event
- generated task/message/variation id

非法值在本地立即失败，不发送报文、不登记 peer、不创建 pending。

### 6.3 Ping settlement

- variation send 失败必须让对应 ping resolve false 或 reject 为 transport error；具体语义在 API 中固定一种。
- transport failure 和 dispose 必须 settle 全部 ping pending。
- timeout false 只表示不使用时间 deadline，不表示忽略 transport failure。

### 6.3.1 Timeout settlement

- 安装 abort capability 时，deadline 到期发送且只发送一次 abort variation。
- timeout 与用户 AbortSignal 共用同一 cancellation helper。
- helper 原子移除 pending，再清 timer/listener，最后 best-effort 通知远端。
- 未安装 abort capability 时，公开文档明确远端 provider 可能继续运行。

### 6.4 Feature typing

采用简化模型：`ping()`、`hooks` 等方法始终存在于 endpoint 类型；未安装对应 capability 时在运行时抛出能力错误。类型、运行时和文档使用同一模型，不做 tuple-level capability typing。

## 7. Adapter 统一契约

每个 adapter 必须满足：

- listener 异常不越过平台 callback。
- 平台读取/解码错误进入 `onTransportError` 或 `onListenerError`。
- unsubscribe 幂等且释放真实 listener 引用。
- close 幂等，处理 reader、writer、port/channel 所有权边界。
- structural 类型不使用不必要的 realm-sensitive `instanceof`。
- transport 本身不拥有 endpoint、contract、retry 或 provider 逻辑。
- adapter 声明 encoded message 类型与底层资源所有权。
- factory 在 endpoint 订阅前验证 adapter、protocol、chunk 三者兼容。

WebTransport 额外要求：

- 保存 reader 并在 close 时 cancel/release。
- writer 根据所有权执行 close/abort/release，而非仅 release lock。
- read loop rejection 必须报告。
- listener 从 0 恢复到 1 时保证 read loop 可重新启动。

## 8. 实施顺序

### 阶段 A：安全入口

1. 扩展 transport inbound metadata。
2. 更新 Window/BroadcastChannel/Worker/ServiceWorker adapter。
3. connect 绑定真实来源。
4. chunk 移到认证后并加入预算。

完成条件：未认证消息不能创建 peer、pending、provider task 或 chunk assembly。

### 阶段 B：任务一致性

1. 引入 inbound settlement 状态。
2. 修复 abort、dispose、duplicate request 和 context expiry。
3. response mismatch 改为忽略并观测。
4. receive 增加最终 rejection 边界。
5. timeout、abort 与 retry 统一 error classification 和 cancellation。
6. provider result branding 与 INTERNAL 错误脱敏。
7. 抽取 `async-control.ts`、`retry.ts` 和 `settlement.ts`，再让 endpoint 切换到统一 primitive。
8. 删除 endpoint 中 request/ping 的裸 timer 与重复 settlement，并恢复 factory post-install rollback。

完成条件：每个 inbound/outbound task 至多 settlement 一次，迟到结果无框架副作用。

### 阶段 C：生命周期统一

1. 调整 dispose 阶段顺序。
2. 让 PluginHost 真正拥有 middleware，或彻底移除该集成。
3. 统一 ping、transport failure 和 adapter close。
4. dispose 改为共享 Promise，并定义 transport ownership。
5. capability publication 改为 owner-aware write-once。

完成条件：任意 middleware disposer 卡住时，endpoint 自有 pending、controller 和 timer 已完成清理。

### 阶段 D：契约与工程门禁

1. 前置 identifier 验证和 peer 状态拆分。
2. 统一 feature typing。
3. 修复 package typecheck。
4. 补 README、USEGUIDE 和安全说明。
5. 装配期验证 protocol/chunk/transport 数据类型兼容性。
6. 抽取 `safe-value.ts` 与 `listener-safety.ts`，删除 wire、hook 和 adapter 中重复实现。

## 9. 验证矩阵

### 9.1 来源与响应

- Window 错误 origin/source 的 request、response、variation、chunk 全部拒绝。
- 合法 taskId + 错误 sender response 不影响 pending；之后合法 response 仍可成功。
- 重放合法 response 不产生第二次 settlement。
- 已完成 request/dispatchOnly 在 replay window 内重放时不再次执行 provider/listener 副作用。
- taskId settle 后立即复用时，旧 response、pong 或 abort 不能命中新 generation。
- senderId 与真实 peer metadata 不绑定时不得创建 peer。
- 相同 senderId/taskId 从两个独立 verified source 到达时，provider abort 与 response settlement 不得跨 source 命中。
- 静态 peer metadata 与动态 inbound source metadata 指向同一 peer 时生成同一个 token；无法预绑定时不得静默跳过 source 检查。
- 两个 factory endpoint 建立后不预热任何 inbound binding，首次 client→server request 与 ping 仍可按 `useBaseIdVerifyOnly` 既定策略完成。
- `useBaseIdVerifyOnly` 为 `undefined/true` 时只调用一次 `baseIdentityCheck` 且不调用 `identifier`；显式为 `false` 时缺少 identifier 装配失败，存在时按“基础验证 → identifier”顺序执行。
- BroadcastChannel connect 将一个 targetId 解析为多个 receiverId 时注册仍成功，`console.warn` 与 `connect.multiple-receivers` hook 各触发一次；同一 receiver snapshot 不重复告警，集合变化后重新告警。
- 多 receiver 的 `send()` 只由第一条合法 response 结算：成功则 resolve、失败则 reject，迟到 response 均被观察但不改变结果；`sendAll()` 对已验证独立 receiver 保留逐 receiver 结果，对匿名 BroadcastChannel 广播组只保留一个 targetId 结果。
- `connect.multiple-receivers` hook 或 console diagnostic 自身失败时不改变 receiver registry、connect 结果或后续 settlement。
- 匿名 BroadcastChannel 在一个 discovery window 观察到多条合法受理 response 时也触发去重 warning/hook；事件标记 `ambiguous: true` 并携带 `responseCount`，但不得把该计数当作可 pin 的唯一 receiver 数量。
- `getServerList()` 无参/按 target 查询均返回稳定排序的只读 metadata 快照；修改数组或 record 不影响内部 registry，且结果不泄漏 credential、source object 或验证 token。
- `pinReceiver()` 对未知/非 active receiver 立即失败；匿名 BroadcastChannel 广播组稳定返回 `TARGET_NOT_IDENTIFIABLE`；成功固定后 send/sendAll/dispatch/ping 只投递给该独立 receiver。
- pinned receiver 注销或失活后不得自动切换到其他 receiver；调用失败并只触发一次 `connect.pinned-receiver-lost`，重新 pin 或 unpin 后恢复既定解析语义。
- automatic discovery 不公开 target register/unregister；有可靠 source binding 与 authenticated credential 的 transport 只接受原 binding 的单播 unregister，匿名 BroadcastChannel unregister 只删除 requester 本地 DNS binding，不修改远端 ownership。
- endpoint 只按自身 `id` 受理 query/request；不存在 target alias，未知 target 稳定拒绝。
- 两个隔离 browser realm 未提供 `__unique_id__` 时解析为同一广播组且 DNS omit 自身；提供不同且验证通过的 `__unique_id__` 时分别解析为 `${targetId}:${__unique_id__}`，可独立 pin/unregister。
- 多 receiver 中先返回失败、后返回成功时 `send()` 由首个失败 reject，迟到成功不改变结果；每个 provider 至多执行一次。
- `sendAll(...)` 冻结并投递调用开始时全部已知 remote target 的 receiver 快照，omit 当前 endpoint，且不存在 target-first/本地优先分支；调用开始后的注册变化不改变本轮投递集合。
- 空闲超过 stale 阈值的 receiver 通过惰性 query 或显式 `connect.ping(candidate)`/`endpoint.ping(targetId)` 重新确认；不得恢复无消费者的全网 register lease，真正消失的 receiver 在有界时间内收敛并释放 timer。
- local receiver 只出现在 server ownership registry；`getServerList()`、pin、多 receiver 诊断与 fan-out 均 omit 当前 endpoint，且 remote 同名 receiver 仍可正常解析和固定。
- factory `targetIds` 包含重复值或当前 `id` 时，normalize 后 configured peer 与所有 fan-out snapshot 去重并 omit 自身。
- 多 receiver hook 原样提供 requesterId 与冻结 receiverIds 数组；console warning 包含 pin/unregister 的可执行建议。
- server 注销只向持有 authenticated binding 的 requester 逻辑单播；旁观 endpoint 不更新。匿名 BroadcastChannel 仅由 requester 本地删除组 binding；进行中 pending 保留启动快照。
- register/unregister/pin/unpin 的专用 hook 自身抛错或 reject 时不改变管理操作结果。
- 在首次合法 response/pong 前注入同 taskId、同声明 senderId 的第三方消息，不能现场建立 binding 或结算 pending。
- verified identity 同时包含 verifier 选择的 origin/source/peerId；达到 identity budget 后稳定拒绝或淘汰。
- 恶意 getter/proxy 只产生 invalid diagnostic，不形成 unhandled rejection。
- getter/proxy 每次返回不同 identifier 时，认证、routing 与 settlement 仍只消费同一个 canonical snapshot。
- chunk-ack、variation 与普通 envelope 使用相同认证顺序。
- `uniqueTargetId` 字符串与同步/异步 factory 都执行统一长度校验；前置条件不满足时不调用 factory并降级广播组，非法返回值降级广播组，factory throw/reject 使 `createEndpoint()` reject。
- `uniqueTargetId` factory 只收到 immutable `{ endpointId, platform }`，初始化期只执行一次；query/response/retry/reconnect 不重复执行，且 endpoint 在 snapshot 完成前不开放入站或出站业务操作。
- `receiverSelector` 只收到 remote-only immutable server-list snapshot 与 `{ endpointId, targetId, operation }`；active pin 优先且跳过 selector，单目标操作最多调用一次，fan-out API 完全忽略 selector。
- async selector 等待受 operation deadline/abort/dispose 控制；返回未知、stale、其他 target 或匿名组伪 receiver 时拒绝，且 selector 不能修改 DNS、pin 或 `uniqueTargetId`。
- manual `onQuery` 只提供 opaque settlement handle；两个 verified peer 使用相同 wire queryId 时仍可分别 accept/reject，重复或迟到 settlement 返回 false。
- manual `connect.ping(candidate)` 可探测同 endpoint 的 verified、未注册 candidate，且不写 DNS；伪造、复制、跨 endpoint 或过期 candidate 稳定拒绝。

### 9.2 Chunk 对抗测试

- 大量不同 messageId 首块达到配额后稳定拒绝，内存集合有上限。
- 相同 messageId、不同 verified peer 互不污染。
- NaN、Infinity、小数、负数和超大 total/index 拒绝。
- 单 chunk、累计 payload、chunk 数量分别超过预算时清理 assembly。
- duplicate、乱序、缺块和 timeout 后迟到块不泄漏 timer。
- 含 `:|` 的 senderId、peer metadata 和 messageId 不能造成跨 peer assembly 或 quota 碰撞。

### 9.3 Abort 与 provider

- provider resolve 前 abort：调用方取消，远端不发 response。
- provider reject 前 abort：不再发 INTERNAL response。
- abort 后 `dispatchTo()` 无 wire 输出并产生 context-expired hook。
- duplicate sender/task 不覆盖原 controller。
- 两个已认证 peer 使用可拼接成相同字符串的 sender/task tuple 时，abort 与 cleanup 仍严格隔离。
- dispose 与 provider resolve 同时发生时只有一个终态。
- timeout + abort capability 只发送一次 abort variation。
- 共享 transport 上第三方 verified peer 观察到 ping taskId 后伪造 pong，不能结算目标 peer 的 ping。
- abort、schema、contract、disposed 和普通 remote failure 默认不重试。
- retry delay 中 abort/dispose 立即取消 timer，不启动下一 attempt。
- 伪造 `{ ok: true }` 和过期 context result 不能产生成功 response。
- INTERNAL response 不包含原始异常 message。
- timeout/abort/response 同时竞争时，settlement primitive 只有一个调用返回 true。
- retry attempt 使用独立 taskId，前一 attempt 的 timer/listener/pending 均已清理。
- retry policy 或 delay 抛错时停止，不遗留下一 attempt。
- retry `shouldRetry/delay` 永不 settle 时，用户 abort 和 endpoint dispose 仍立即终止公开 send，并观察迟到 rejection。
- remote transient code 可由显式 policy 允许 retry；abort、disposed、schema、contract 和 config error 永远不可覆盖。
- transport 同步抛错与异步 reject 走同一 settlement；timeout false 和多次 retry 后 pending 数量均为零。
- 成功 response commit reject 后不发送第二条 failure response，且 commit failure diagnostic 恰好一次。
- schema error 的 `issues`、issue fields、`toString` 使用 hostile Proxy 时仍稳定返回 `SCHEMA_INVALID`。

### 9.4 生命周期

- middleware disposer 永不 resolve 时，普通 pending、ping、controller 和 chunk timer 已清理。
- transport failure settle 普通 request 与 ping。
- terminal transport failure 同时 abort provider、清除 partial chunk，并阻止 verifier continuation 重新写状态。
- receive verifier reject 不产生 unhandled rejection。
- listener、hook、codec 和 transport error handler 自身抛错不会越界。
- 并发 dispose 返回同一个 Promise，并观察相同结果。
- `onHookError` 抛错及 thenable rejection 不产生递归或未处理 rejection。
- borrowed transport 只 unsubscribe；owned transport 按 lease 关闭。
- timeout 或 operation 提前完成后不存在残留 timer 和 AbortSignal listener。
- timeout/backoff timer 在支持 `.unref()` 的 runtime 不阻止进程退出。
- endpoint 构造在 middleware 安装后失败时，PluginHost disposer 全部逆序执行。
- settlement cleanup 抛错时主 Promise 仍完成，cleanup diagnostic 恰好一次。
- middleware disposer failure 在 hooks 最终清理前可观察。
- `onTimeout`、error factory、listener cleanup 同步抛错时 race 仍 settle，且无 uncaught exception。
- ping transport failure 立即释放 timeout control，不保留 deadline timer 和 endpoint 闭包。
- constructor 的第二、第三个 transport registration 抛错时，之前成功的 registration 全部回滚。
- constructor rollback disposer 抛错时，原错误与 cleanup error 均可观察且其余 disposer 继续执行。
- constructor 在首个/中间 registration 失败时由同一个 ResourceScope 释放 subscription 与 owned transport close。
- constructor registration 失败时 owned transport close 恰好一次，且 factory 必须 await async close 后再 reject。
- dispose 的任一 unregister 抛错时，pending/controller/chunk/middleware/transport 仍全部清理。
- unregister/close 失败后 dispose 的 Promise 明确返回失败报告或稳定 lifecycle rejection，而非仅靠 hook。
- per-call timeout override 对负数、NaN 和 Infinity 在发送前稳定拒绝。
- dispose 与异步 verifier 竞争时，dispose resolve 后 peer/identity/chunk/provider 状态保持空且无新 timer/send。
- dispatch 与 ping 遇到同步 transport throw 时不越过 fire-and-forget 边界且不残留 pending。
- dispose 后 `sendAll/dispatchAll/pingAll` 在零 peer 与多 peer 情况下返回同一个 lifecycle failure 契约。

### 9.5 Adapter

- 所有 adapter 共享 listener isolation contract tests。
- Window 覆盖 origin/source。
- SharedWorker 在 mock/cross-realm event 下按结构读取 data。
- WebTransport read failure、unsubscribe、resubscribe 和 close 无悬挂 reader。
- WebTransport 最后一个 unsubscribe 后即使永远没有新 datagram，也不保留未声明所有权的 reader lock。
- WebTransport unsubscribe 后立即 resubscribe 仍可接收后续 datagram，且不会永久 cancel 底层 stream。
- WebTransport `getReader/releaseLock/read` 抛错均由 read-loop owner Promise 观察，不形成 unhandled rejection。
- WebTransport `close()` resolve 时 read-loop owner 已 settle、reader lock 已释放；close 后 subscribe/send 稳定失败。
- RTC + identity protocol、WebTransport + object protocol 在 factory 阶段拒绝。
- string、Uint8Array 与 object payload 的大小限制分别验证。
- chunk metadata 篡改在创建 assembler 状态前拒绝。
- `chunkSize=1..3` 与 emoji 等四字节 code point 在发送前稳定失败，不产生接收端拒绝后的悬挂 request。
- custom split 返回空数组、超限 part、过多 part 或无法 join 回原文时，pipeline 在任何 transport send 前拒绝。
- chunk ACK 仅在 decode、canonical wire validation 和 admission 成功后产生；若 ACK 协议删除则 wire 不再接受该 kind。
- top-level transport 与 connect transport 不同时装配失败；相同时 identifier 只观察 canonical metadata。
- 没有 top-level transport 时，多个 middleware 声明不同 transport 也必须装配失败。
- concrete transport 拒绝缺失、`any` 或不匹配 encodedType 的 protocol capability。
- capability snapshot 保留 class-based schema prototype、symbol/non-enumerable state 与明确的 opaque leaf identity。
- SharedWorker/WebWorker 的 data/message getter、Proxy error 与 hostile `toString` 均不能越过平台 callback。
- fan-out peer 为 `__proto__`、`constructor` 或 `toString` 时，返回结果仍包含安全 own key 且原型不变。

### 9.5.1 Middleware 装配

- 不同 middleware 发布同一保留 capability 时抛 `CAPABILITY_CONFLICT`。
- endpoint 获得冻结 capability snapshot。
- freeze 后修改原始 timeout、identifier、contract schema map，不改变 endpoint 的 resolve/verify/validate 行为。
- 同一 capability 的别名读取返回同一个 owned snapshot，不产生两份身份分裂的 clone。
- middleware install hook 可观测，不再是 no-op。
- 安装失败后 capability、resource 和临时 hook 状态全部回滚。
- 每个 ResourceScope cleanup error 只发一个按 resource 分类的 hook，公开 report 保留 resource name。
- protocol 的非函数 codec/非法 encodedType 与 hooks 的非函数 listener/onHookError 在 factory 阶段拒绝。
- `dispatchTo({ id: '' })` 稳定拒绝且不产生任何广播；仅省略 id 才进入显式 fan-out。

### 9.5.2 Discovery 与 terminal adapter 对抗

- BroadcastChannel 配置有效 `uniqueTargetId + useBaseIdVerifyOnly:false + identifier` 时，query/response 均把对端 `__unique_id__` 交给 identifier，且无 source/origin 仍可进入应用验证。
- automatic cold `send/dispatch/ping` 都先完成同一个 single-flight discovery，再提交业务消息；失败、abort、timeout 和 dispose 不留下 query/session/pending。
- discovery query 的 data、platform、receiverId、queryId 和 timestamp 使用 canonical snapshot；wire platform claim不能覆盖 adapter platform。
- 在 active query 窗口注入 announcement register不能写 DNS；旁观 endpoint不能通过 lease/announcement学习 binding。
- verified client调用 manual unregister只能删除自己的 remote DNS/binding，不能改变 server local ownership；server撤销只影响绑定 requester。
- automatic/manual query 均覆盖 replay、global/per-peer配额、TTL、重复 response、同 taskId不同 peer和多 listener settlement。
- manual accept data不能覆盖 connect生成的 `__unique_id__`；无效 `uniqueTargetId` config被忽略并稳定进入广播组。
- `connect.ping` 未安装所需能力时在类型/装配期不可见，不依赖首次运行抛错。
- WebTransport EOF、RTC close/error和 send/read terminal failure均使 endpoint进入一致终态，timeout=false也不悬挂 pending。
- automatic endpoint没有 manual connect方法；manual candidate只能由同 session返回的 opaque token注册。

### 9.6 工程门禁

每次实现阶段均执行：

```text
fmt → lint → typecheck → typecheck:core → typecheck:node-adapter → test → build
```

新增对抗测试必须在修复前失败、修复后通过。仅现有 happy-path 测试通过不构成验收。

内部 utility 各自建立独立测试：

- `async-control.test.ts`：operation/timeout/多 signal 全排列竞争、listener 清理、迟到 rejection、unref。
- `async-control.test.ts`：第 N 个 signal 注册抛错时前 N−1 个 listener 与已创建 timer 全部回滚。
- `retry.test.ts`：错误分类、attempt 计数、可取消 backoff、policy failure、前次清理顺序。
- `settlement.test.ts`：resolve/reject/abort/timeout/dispose 并发下单次获胜与 cleanup 恰好一次。
- `safe-value.test.ts`：getter/proxy 抛错、NaN/Infinity、小数、超长 identifier。
- `listener-safety.test.ts`：同步异常、Promise、thenable、diagnostic 自身失败。
- `factory.rollback.test.ts`：安装成功后 capability/endpoint 构造失败仍执行 disposer。
- `endpoint.timeout-race.test.ts`：response、timeout、abort、send failure、dispose 竞争只结算一次。

## 10. 可观测性

新增或标准化 hook 名称：

- `receive.failure`
- `authentication.rejected`
- `response.unmatched`
- `chunk.rejected`
- `chunk.expired`
- `provider.context.expired`
- `transport.failure`
- `middleware.dispose.failure`

hook payload 不得回传完整未验证 payload、认证令牌或敏感业务数据。高频拒绝事件必须支持采样或聚合，避免日志本身成为 DoS 放大器。

## 11. 兼容性与迁移

- transport subscriber 参数变化属于 adapter API breaking change，应在同一 minor-before-public 阶段完成，不提供长期双协议兼容层。
- 内置 adapter 同步迁移；自定义 adapter 在 USEGUIDE 提供迁移示例。
- wire request/response 基本结构可保持不变；真实来源 metadata 不进入 wire payload。
- chunk key 和资源限制是接收端内部变化，不要求 wire 版本升级；若新增 frame 字段则更新 contract version。
- feature typing 如采用 tuple 推断，保留运行时能力检查作为 JavaScript/类型擦除后的防线。

## 12. 完成标准

只有满足以下条件才可标记 hardening 完成：

- 所有 P0/P1 问题关闭。
- 任何 feature/fix patch 均未通过引入、转移或隐藏新问题来关闭旧问题；历史已关闭条目未被重新打开。
- endpoint、runtime、transport、middleware、adapter 与内部状态机的 owner、依赖方向和单一事实源保持不变；任何架构或公开契约变化均已由 SDD 预先授权。
- 每个修复均有目标缺陷测试与相邻不变量回归测试；未出现新增 P0/P1，新增 P2 已明确登记且不由本次修复制造。
- 不可信消息在认证前不能创建长期状态。
- abort、timeout、transport failure、dispose 和 response 竞争均满足单次 settlement。
- middleware 生命周期只有一个 owner。
- 所有 adapter 满足统一错误与关闭契约。
- 全部工程门禁通过。
- README、USEGUIDE 和本 SDD 与实际行为一致。
- 二次对抗新增的 P0/P1 问题全部关闭。
- retry、timeout、abort、dispose 和 hook failure 组合测试通过。
- protocol/framing 完整性经过 metadata 篡改测试证明。
- endpoint 不再包含 retry loop、裸 backoff timer 或重复 pending cleanup 分支。
- timeout race 与 retry utility 的独立竞争测试全部通过。
- factory 的所有 post-install failure 路径均无 middleware 资源泄漏。
- endpoint、chunk 和 retry 不再直接创建 timer。
