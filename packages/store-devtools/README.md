# `@migaia/store-devtools`

给已有 Store 接上有界本地历史、状态回放和动作追踪，并直接查看真实响应式依赖。

## 你可能遇到过

- 回到旧状态就多出一条新历史，因为普通变更监听把回放写入也当成用户修改。
- 动作说明挤掉需要的状态，因为历史和追踪没有独立保留上限。
- 调试快照失败后业务写入也抛错，因为诊断回调没有与业务路径隔开。
- 调试面板关闭就把 Store 一起销毁，因为会话与应用资源的所有权混在一起。
- 共享依赖的第二条路径消失，因为全局已访问集合把菱形共享误当成环。

## 为什么选它

- **回放状态，不重复记录同步回放历史。** 不必在普通变更监听旁另补回放开关，例子跳回初始状态后历史条数不变，后续编辑仍记录，见[同名场景](./USEGUIDE.md#回放保留状态而不新增回放历史)。
- **历史和动作分别保留最近条目。** 不把动作说明与状态挤进同一容量，例子显示独立淘汰并在 clear 后保留递增 id，见[同名场景](./USEGUIDE.md#分别限制历史与手动动作队列)。
- **自动快照失败上报，当前业务写入仍完成。** 不让调试回调错误冒泡破坏这次写入，例子同时验证原错身份、手动抛错和恢复后的 id，见[同名场景](./USEGUIDE.md#报告快照失败而不打断业务写入)。
- **释放诊断会话，保留应用拥有的 Store。** 不把关闭面板等同于销毁状态，例子释放后历史停止增长而 Store 仍接受写入，见[同名场景](./USEGUIDE.md#释放诊断会话后继续使用-store)。
- **共享依赖保留两条真实路径。** 不使用全局访问集合误截菱形分支，例子用真实 Runtime 节点展开两条路径并检查深度零边界，见[同名场景](./USEGUIDE.md#展开共享依赖的两条路径)。

## 从这里开始

保存为 ESM 项目的 overview.ts，用 Node 24 直接运行；先安装诊断包和示例直接导入的 Store 包：

```bash
pnpm add @migaia/store-devtools @migaia/store-light
```

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const store = createStore({ count: 0 })
const tools = createStoreDevTools(store, { captureRuntimeTrace: false })
try {
  const initial = tools.history[0]!.id
  store.count = 1
  store.$runtime.flush()
  tools.jumpTo(initial)
  console.log(store.count, tools.history.length)
} finally {
  tools.dispose()
  await store.$dispose()
}
```

输出：

```text
0 2
```

需要限制队列时看[分别限制历史与手动动作队列](./USEGUIDE.md#分别限制历史与手动动作队列)，需要查重算来源时看[展开共享依赖的两条路径](./USEGUIDE.md#展开共享依赖的两条路径)。

createStore 以 count: 0 初始化，未指定 runtime 时借用默认 Runtime；显式 flush 让这次变更的通知完成后再回放。captureRuntimeTrace 设为 false，覆盖缺省启用；maxHistory / maxTrace 默认 100 / 1000，clone 默认 diagnostic，now 默认 Date.now，最后分别释放会话和 Store。

## 手写时的隐患

同一状态回放场景，下面只展示，不运行：

```ts doc-test=check
import { createStore } from '@migaia/store-light'

const store = createStore({ count: 0 })
const history = [store.$plain()]
const off = store.$subscribe(() => history.push(store.$plain())) // 历史无保留上限
store.count = 1
store.$runtime.flush()
store.$hydrate(history[0]!)
store.$runtime.flush() // 回放通知又追加历史，无法区分用户编辑
void off // 面板关闭后仍未解绑订阅
```

上一节通过 jumpTo 的同步回放屏蔽避免新增回放历史，并在 finally 中释放诊断订阅；Store 仍由创建者单独释放。这个手写片段只展示同一场景的隐患，不运行。

## 三分钟心智模型

| 排查的问题         | 使用工具          | 保留的边界                                         |
| ------------------ | ----------------- | -------------------------------------------------- |
| 字段何时变化       | history / record  | 只记录 $plain 支持的状态，容量受 maxHistory 限制。 |
| 回到某个保留状态   | jumpTo            | 水合已知字段，不撤销外部副作用。                   |
| 哪次动作失败       | actions / trace   | Runtime 级追踪，可能包含同 Runtime 的其他 Store。  |
| 重算依赖来自哪里   | getDependencyTree | 读取上游真实关系，不创建订阅。                     |
| 谁还在观察某个信号 | getObserverTree   | 读取当时的下游关系，变化后需再读取。               |
| 调试结束           | tools.dispose     | 只释放会话，不销毁借用 Store / Runtime。           |

**会话** 是持有诊断订阅和三个队列的对象；**历史 id** 是会话内递增的状态锚点，淘汰后不可再回放；**action** 是 Runtime 发出的具名执行记录；**依赖树** 是把当时图关系展开得到的数据，不是持续更新的观察者。

## 典型场景

| 场景                           | 怎么组合                                           | 详细说明                                                 |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------------------- |
| 回放保留状态而不新增回放历史   | createStoreDevTools → retain id → jumpTo → edit    | [完整代码](./USEGUIDE.md#回放保留状态而不新增回放历史)   |
| 分别限制历史与手动动作队列     | maxHistory / maxTrace → recordAction → clear       | [完整代码](./USEGUIDE.md#分别限制历史与手动动作队列)     |
| 报告快照失败而不打断业务写入   | Runtime.onError → clone → record                   | [完整代码](./USEGUIDE.md#报告快照失败而不打断业务写入)   |
| 释放诊断会话后继续使用 Store   | dispose → read history → use Store                 | [完整代码](./USEGUIDE.md#释放诊断会话后继续使用-store)   |
| 展开共享依赖的两条路径         | Runtime handles → getDependencyTree                | [完整代码](./USEGUIDE.md#展开共享依赖的两条路径)         |
| 在 effect 释放后查看当前订阅者 | getObserverTree → effect.dispose → getObserverTree | [完整代码](./USEGUIDE.md#在-effect-释放后查看当前订阅者) |

## 安装

```bash
pnpm add @migaia/store-devtools @migaia/store-light
```

图与独立 Runtime 场景直接导入 reactive，需另外直接安装；本包运行时依赖会正常随包解析，不能把传递依赖当成应用可导入的安装契约。

```bash
pnpm add @migaia/reactive
```

## 常用 API

| API                                  | 什么时候用                            |
| ------------------------------------ | ------------------------------------- |
| createStoreDevTools                  | 给一个已有 Store 创建诊断会话。       |
| tools.record / jumpTo                | 标记可回放锚点，恢复仍保留的状态。    |
| tools.actions / trace / recordAction | 查动作或原始事件，补充手动说明。      |
| tools.clear / dispose                | 换一段历史或结束会话。                |
| getDependencyTree                    | 从 effect / computed 查看上游依赖。   |
| getObserverTree                      | 从 signal / computed 查看下游订阅者。 |

## 契约细节

### 职责与完整公开面

本包是已有 Store 的本地诊断会话，不创建 Store，不改写或代理写入路径。它使用 Store 的 $subscribe、$runtime.subscribeTrace / reportError、$plain、$hydrate，记录内存历史和 action，另提供两个不依赖会话的响应式图遍历函数。适合排查字段变化、动作失败和节点依赖，不是持久化审计、网络回放或外部副作用的事务回滚。

唯一入口为 `@migaia/store-devtools`，导出 createStoreDevTools、getDependencyTree、getObserverTree、五种公开数据类型、错误码与三个错误工厂。reactive、store-light、store-middleware、utils 是运行时依赖；示例直接导入 reactive / store-light 时仍应直接安装它们。

本包不实现浏览器扩展协议。要连接 Redux DevTools，使用 [Store Middleware](../store-middleware/README.md) 的 createReduxDevToolsAdapter / connectDevTools。原 StoreDevtoolsCommand / IStoreDevtoolsCommand 已移出此入口；自建桥接改为从 store-middleware 导入 ReduxDevToolsCommand / IReduxDevToolsCommand。六个协议值保持 DISPATCH、COMMIT、JUMP_TO_STATE、JUMP_TO_ACTION、ROLLBACK、RESET；这是导入位置的迁移，不是新增协议层。

### 构造参数与订阅边界

`createStoreDevTools<S>(store, options?)` 同步返回 IStoreDevTools。store 必须是 createStore 返回的真实 `IReactiveStore<S>`；会话借用 Store 和 Runtime，不拥有或销毁它们。options 省略为空对象。

| 选项                | 默认值与行为                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| maxHistory          | 100；仅限制 history，必须是正安全整数。                                                   |
| maxTrace            | 1000；分别限制 actions 和 trace 的独立队列，没有 maxActions。                             |
| captureRuntimeTrace | 缺省启用；只有严格等于 false 才完全跳过 Runtime trace 订阅，actions 也不再自动填充。      |
| now                 | Date.now；为历史和 action 记录提供时间戳，显式提供时必须是函数。                          |
| clone               | ClonePolicy.diagnostic；接收 $plain() 或历史 state 并返回记录对象，显式提供时必须是函数。 |

null / 非对象 options 以 INVALID_OPTION 拒绝；反射或 option 属性读取失败也使用该码，并在 cause 保留捕获的原错。构造读取描述符后读取五个选项，getter 可能在这些属性读取中执行；它不是“完全不执行 getter”的接纳方式。maxHistory / maxTrace 经空值回退后校验，不把 0、负数、分数、无穷或 NaN 静默夹到合法值。now / clone 的非函数配置同样在订阅前拒绝。

通过配置校验后，先同步创建第一条 initial 历史，再订阅当前 Store 的粗粒度状态通知。开启 trace 时订阅的是这个 Store 所用的整个 Runtime，因此共享 Runtime 上其他 Store 或 runTracedAction 的动作也可能进入 actions / trace；它们不自动按本 Store 身份过滤。配置失败不建立订阅；订阅建立失败则尝试释放已取得订阅，主错与回滚错误的保留方式见错误章节。

### 历史、回放与清空

| 成员           | 输入、输出与效果                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| history        | 每次读取返回按时间顺序排列的新冻结数组，元素为 IStoreHistoryEntry。                                                |
| record(label?) | label 默认 state change；先准备时间戳和状态，再分配 id、追加记录，并返回该条目。                                   |
| jumpTo(id)     | 必填历史 id；找不到（含已裁剪）抛 UNKNOWN_HISTORY_ENTRY RangeError，找到则 clone(state) 后交给 Store 的 $hydrate。 |
| clear()        | 无参数；先准备新的 initial，再清三队列并发布这一条，id 继续递增，不归零。                                          |

IStoreHistoryEntry 含 id、timestamp、label、state；公开字段类型没有额外 readonly 修饰，但发布时 entry 与 state 顶层实际冻结。history 的数组快照不随之后入队而变化，嵌套 state 的隔离程度由 clone 决定，不保证任意对象图深冻结。超出 maxHistory 后淘汰最早条目，包括 initial；保留已裁剪 id 也不能继续 jumpTo。

默认 record 从 clone(store.$plain()) 取状态。$plain 只包含 Store 的 signal 支撑字段，不含 computed、方法或 WASM 字段。默认 diagnostic clone 通过公共 structured-clone-first owner 尽力复制；不可克隆或不安全子树可能保持引用，自定义类也不保证原型保持。它不自动脱敏；需要剔除 token 等字段时，应用应提供明确的 clone，或不让敏感值进入可记录状态。

record / clear 的准备失败不发布半条历史，也不消耗下一个 id；clear 准备失败保留全部旧队列。准备完成后还会检查会话是否已被回调释放，已释放则 SESSION_DISPOSED，不发布数据。

jumpTo 不是撤销业务的事务。$hydrate 只写已知 signal 字段，未知、派生、WASM 键按 Store 自身规则跳过；computed 随依赖重算，不直接恢复派生结果、外部资源或已发出的网络请求。回放深度计数只屏蔽同步回放期间新增 history，支持嵌套 jumpTo，不屏蔽 Runtime trace / action，也不承诺取消之后调度的通知。回放 clone 失败同样经既有 CALLBACK_FAILED 分类并保留原错或 cause；$hydrate 的失败继续沿 Store 上游路径传播，不把整次回放任意异常都改成本包码。

### Action 与 Runtime trace

| 数据                 | 字段与记录时机                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| IActionTrace         | timestamp、name，及可选 payload、durationMs、error。                                                        |
| actions              | Runtime action 的非 start 事件自动生成记录；maxTrace 限制条数。                                             |
| recordAction(action) | 必填去掉 timestamp 的 action 对象，通常至少 name；读取自身可枚举属性后由 now() 补时间戳，再检查终态并发布。 |
| trace                | 保存原始 IRuntimeTraceEvent，独立受 maxTrace 限制，不转换事件对象。                                         |

Store 定义中的方法由 Store 包装成具名 action，名称通常为 debugName.方法名。成功 end 和失败 error 都会记录，error 字段只在失败时提供。$batch / $set / $hydrate 不经 Store 方法的 runTracedAction 包装，不能因此期待自动出现 action；可自行 recordAction。captureRuntimeTrace 为 false 时 trace 保持空，actions 仍接受手动记录。它关闭一条诊断订阅，不关闭状态历史，也不改变 Store 写入策略。

| trace.type        | 主要字段与取值                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| observable-change | timestamp、observable、reason 为 set / notify。                                                                 |
| dependency        | timestamp、observable、observer，phase 为 connect / disconnect，可选 reason 为 retrack / invalidate / dispose。 |
| observer-run      | timestamp、observer，phase 为 start / end / error，可选 durationMs / error。                                    |
| action            | timestamp、name，phase 为 start / end / error，可选 durationMs / error。                                        |

节点描述符含 id、kind（observable / observer / computed）和可选 debugName；action 没有通用节点描述符。此联合由 reactive 维护，trace 的 timestamp 与 durationMs 使用 Runtime 的记录语义，不能假定都来自本会话 now。

actions / trace getter 每次也返回新冻结数组，但 action 条目和 trace 事件对象本身不被冻结，payload、error 等嵌套值保留引用。三条队列分别有界，不是总字节或整个应用内存上限；读取数组也会分配快照，不提供未经测量的速度结论。

### 回调失败与生命周期

记录准备中的 now、clone，回放 clone，以及 recordAction 属性读取失败由 CALLBACK_FAILED 分类。可注记、尚无身份的原生错误保留同一对象、类型和 stack；已有完整外包 source/code 则保留，冻结错误、非 Error 或身份冲突值以 cause 保留，反射身份读取失败也保留在聚合错误中。手动 record / recordAction / clear 及 jumpTo 的克隆准备抛错；自动 Store / Runtime 监听把失败交给 Runtime.reportError，phase 为 trace-listener，不反过来让已触发的正常业务写入因诊断失败而抛错。Runtime 自己负责收容 reporter 失败与宿主回退。

dispose() 无参数、同步且幂等：先把会话置为终态，再尝试 Store unsubscribe 和 trace unsubscribe 两个清理。一个清理失败直接重抛原错；多个失败生成 CLEANUP_FAILED AggregateError，errors 保留全部原错。即便第一次清理抛错，重复 dispose 也不重试或再次抛错。

终态后 record / recordAction / jumpTo / clear 均先抛 SESSION_DISPOSED；history / actions / trace 仍可读取，已有队列不清空，不再由会话监听增长。它不销毁借用的 Store / Runtime；调用方仍分别负责它们的释放。开发期按需创建会话，在组件卸载或调试结束时释放，避免持续保留诊断订阅与快照工作。

构造订阅失败时，按 trace unsubscribe、Store unsubscribe 尝试回滚；若回滚全成功原样抛出主错，有清理失败则 CLEANUP_FAILED AggregateError 的 errors 以主错开头，再列清理失败。订阅与单个清理异常保留实际提供者的公共身份，不强行改为本包码。

### 两个独立的响应式图工具

getDependencyTree(root, maxDepth?) 从 observer 沿 deps 查看依赖；接受真实 Runtime effect / computed 公开句柄，或 extension 的 IObserver。getObserverTree(root, maxDepth?) 从 observable 沿 subs 反向查看订阅者；接受 signal / computed 公开句柄，或 extension 的 IObservable。它们不需要 createStoreDevTools，不建立新的业务依赖，也不拥有节点。

maxDepth 缺省 20，必须是非负安全整数；0 连根的直接边也不展开。负数、分数、NaN、无穷均同步抛 INVALID_OPTION RangeError。深度按当前读取的图关系计算，不为了演示而伪造环或图节点。

| IDependencyTreeNode 字段 | 含义                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| kind                     | observable / observer，表示本次遍历方向中的节点角色。                 |
| label                    | debugName 优先，其次 constructor.name，最后 AnonymousReactiveNode。   |
| version                  | observable 节点的当前版本；dependency root 为 observer 时不带此字段。 |
| children                 | 本次展开的后继树节点数组。                                            |
| circular                 | 仅当前递归路径再次遇到同一节点时为 true，此处停止展开。               |

同一节点在两个不同分支出现的菱形共享不算循环，两边分别展开；真正路径回环才标 circular。达到深度上限直接停止，不标为 circular。Computed 兼具两个角色，因此从依赖方向是 observable 子节点，从反向订阅方向是 observer 子节点；不要把这些数据依赖与插件能力图混为一谈。

### 错误码、错误工厂与维护命令

STORE_DEVTOOLS_SOURCE 为 store.devtools；按 source / code 分支，别匹配 message。

| StoreDevtoolsErrorCode 属性 / 值            | 触发与处理                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| sessionDisposed / SESSION_DISPOSED          | 释放后继续变更诊断会话；新建会话，不重试旧实例。                                              |
| unknownHistoryEntry / UNKNOWN_HISTORY_ENTRY | jumpTo 的 id 不在当前 history；RangeError，选仍保留的 id。                                    |
| invalidOption / INVALID_OPTION              | options / getter / 容量 / 回调配置或树深度不合法；options 通常为 Error，树深度为 RangeError。 |
| callbackFailed / CALLBACK_FAILED            | 未分类的记录准备回调、回放 clone 或 action 属性读取失败；修正回调，检查原错或 cause。         |
| cleanupFailed / CLEANUP_FAILED              | 多个 dispose 清理失败，或构造主错并伴随回滚失败；检查 AggregateError.errors。                 |

三个错误工厂均公开，但普通使用通常不需要它们：createStoreDevtoolsError(code, message, options?) 返回带身份的原生 Error，options.cause 可省略；createStoreDevtoolsRangeError(code, message) 返回 RangeError；createStoreDevtoolsAggregateError(code, errors, message) 返回 AggregateError，errors 必填只读列表，保留全部原值，不去重。code 与 message 均必填，code 类型为 IStoreDevtoolsErrorCode；工厂不覆盖 stack。

包维护使用已有 fmt、lint、typecheck、typecheck:test、test、build 脚本；构建、测试及文档执行结果由实际门禁报告给出，不把本节的命令清单当作已经运行的证据。
