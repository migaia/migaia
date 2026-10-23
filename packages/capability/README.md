# `@migaia/capability`

[English](./README.en.md)

让功能开关管住功能本身：开关关掉时，功能已经启动的连接、计时器和订阅随之释放；功能之间有依赖时，按依赖启动、回滚和关闭。

## 你可能遇到过

- **配置中心已经关掉了功能，它建立的连接和计时器还在跑。** 开关只在启动前判断了一次，之后没人负责关掉它创建的资源。[运行示例](./USEGUIDE.md#关掉开关时已经运行的功能随之停止)
- **推送了一份新配置，要自己和旧配置逐项比对。** 漏掉一项，就有一个本该关闭的功能留在后台。[运行示例](./USEGUIDE.md#用一份新配置替换全部开关未列出的功能自动释放)
- **页面两个位置同时打开同一项功能，建立了两条连接。** 第一次启动还没完成，第二个调用方看不到它，又启动了一次。[运行示例](./USEGUIDE.md#两个调用方等待时只激活一次)
- **管理员已经关掉功能，慢一步完成的加载又把它打开了。** 异步启动的结果回来时，没人检查开关是否已经变了。[运行示例](./USEGUIDE.md#撤回许可后释放晚到的句柄)
- **功能之间有依赖，启动和关闭的顺序却靠手写。** 页面比它依赖的服务先启动；或者某一步启动失败，前面已经启动的服务留在后台。[运行示例](./USEGUIDE.md#消费方启动失败时回滚已启动的提供方)

## 为什么选它

常见做法是从配置中心或功能开关服务拿到一组布尔值，在代码里写 `if (flags.chat) startChat()`。开关服务只告诉你值是多少，不管值变了以后，功能已经启动的连接、计时器和订阅怎么办。本包把每个功能变成一个由宿主持有的生命周期：开关决定能不能运行，宿主负责启动、停止和清理。

- **关掉开关，功能真的停下。** 常见做法里，开关变成 false 只影响以后的判断，已经运行的功能照常工作。这里 `setFlag(name, false)` 会立即撤下功能并调用它的 `dispose`，连接断开，计时器停止。[运行示例](./USEGUIDE.md#关掉开关时已经运行的功能随之停止)
- **整份配置一次替换，没列出的功能自动释放。** 不用自己比对新旧配置。`setFlags` 原子替换全部开关，没有出现在新配置里的功能视为关闭，并按启动完成的相反顺序释放。[运行示例](./USEGUIDE.md#用一份新配置替换全部开关未列出的功能自动释放)
- **同时打开只启动一次。** 只检查“是否已经有实例”会漏掉启动还没完成的那段时间。这里并发的 `enable` 共享同一次启动和同一个 Promise。[运行示例](./USEGUIDE.md#两个调用方等待时只激活一次)
- **关掉之后，晚到的启动不会把功能复活。** 异步启动完成时如果开关已经关闭，宿主丢弃这个结果，并释放它刚创建的资源。[运行示例](./USEGUIDE.md#撤回许可后释放晚到的句柄)
- **依赖决定启动、回滚和关闭的顺序。** 用依赖图登记功能之间的依赖后，提供服务的一方先启动、后关闭；某一步启动失败时，已经启动的部分按相反顺序回滚。[启动顺序](./USEGUIDE.md#先启动提供方先释放消费方)、[失败回滚](./USEGUIDE.md#消费方启动失败时回滚已启动的提供方)

什么时候不需要它：开关只决定界面上显示哪个按钮，功能本身不持有连接、计时器或订阅这类需要清理的资源时，普通布尔值就够了。

## 从这里开始

先尝试启用被拒绝的功能，再授予许可并显式启动：

```ts doc-test=run
import { createCapabilityHost } from '@migaia/capability'

const host = createCapabilityHost({ tenant: 'demo' })
host.register({
  name: 'export',
  activate: ({ tenant }) => {
    console.log('启用:', tenant)
    return {
      dispose: () => {
        console.log('释放: export')
      }
    }
  }
})
console.log('首次尝试:', (await host.enable('export')).status)
host.setFlag('export', true)
console.log('授权后:', host.state('export'))
console.log('启用结果:', (await host.enable('export')).status)
await host.dispose()
```

输出：

```text
首次尝试: gated
授权后: off
启用: demo
启用结果: enabled
释放: export
```

遇到撤权后旧结果晚到，看[晚到句柄清理](./USEGUIDE.md#撤回许可后释放晚到的句柄)；遇到服务必须按依赖顺序启动，看[静态 Graph](./USEGUIDE.md#先启动提供方先释放消费方)。

## 手写时的隐患

用普通布尔值手写同一个功能闸门，很容易把检查和资源所有权分开。以下只展示隐患，不运行：

```ts doc-test=check
let allowed = false
const activate = () => {
  console.log('启用: demo')
  return {
    dispose: () => {
      console.log('释放: export')
    }
  }
}
const handle = activate() // 隐患：检查许可前就已经启动。
if (!allowed) console.log('当前禁止') // 隐患：只显示拒绝，没有释放已经创建的句柄。
allowed = true
console.log(allowed, handle)
```

上面的 Host 先判断许可，再调用 activate，并持有返回句柄负责释放。只改开关不会替用户执行启动；不需要为每个调用点重写登记、在途激活和收尾状态。

## 三分钟心智模型

| 你要解决的问题                        | 对应工具                         |
| ------------------------------------- | -------------------------------- |
| 独立可选功能按许可启停                | 根入口 Capability Host           |
| 固定服务依赖与整体启动回滚            | graph 静态 Graph                 |
| 配置校验、预览顺序、增量边维护        | graph/topology                   |
| 根据依赖和当前状态计算下一步动作      | graph/dependency                 |
| 运行时替换定义、管理精确 binding 世代 | graph/dynamic，与组合 owner 配合 |

“句柄”是启用后交回的业务对象，dispose 负责收尾；“世代”区分仍有效和已经作废的异步工作；“提供方”是服务来源，“消费方”使用它；“required”是缺失就不能启动的硬依赖；“DAG”是没有循环的有向依赖图；“拓扑顺序”保证提供方在消费方前面。能力图管理服务资源，不计算响应式数据。

## 典型场景

| 场景                                           | 怎么组合                  | 详细说明                                                               |
| ---------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| 把开关许可与实际启用分开                       | `createCapabilityHost`    | [完整示例](./USEGUIDE.md#把开关许可与实际启用分开)                     |
| 两个调用方等待时只激活一次                     | `createCapabilityHost`    | [完整示例](./USEGUIDE.md#两个调用方等待时只激活一次)                   |
| 撤回许可后释放晚到的句柄                       | `createCapabilityHost`    | [完整示例](./USEGUIDE.md#撤回许可后释放晚到的句柄)                     |
| 关掉开关时，已经运行的功能随之停止             | `createCapabilityHost`    | [完整示例](./USEGUIDE.md#关掉开关时已经运行的功能随之停止)             |
| 用一份新配置替换全部开关，未列出的功能自动释放 | `createCapabilityHost`    | [完整示例](./USEGUIDE.md#用一份新配置替换全部开关未列出的功能自动释放) |
| 先启动提供方，先释放消费方                     | `createCapabilityGraph`   | [完整示例](./USEGUIDE.md#先启动提供方先释放消费方)                     |
| 消费方启动失败时回滚已启动的提供方             | `createCapabilityGraph`   | [完整示例](./USEGUIDE.md#消费方启动失败时回滚已启动的提供方)           |
| 申请资源前先查看依赖启动顺序                   | `buildCapabilityTopology` | [完整示例](./USEGUIDE.md#申请资源前先查看依赖启动顺序)                 |

## 安装

```bash
pnpm add @migaia/capability
```

运行时依赖 @migaia/lifecycle 和 @migaia/utils；没有 Store、DOM 或 Node 专属后端依赖。

## 常用 API

| API                                             | 什么时候用                           |
| ----------------------------------------------- | ------------------------------------ |
| createCapabilityHost                            | 为独立功能创建许可与生命周期容器     |
| host.register                                   | 登记共享 context 的激活与清理定义    |
| host.enable / host.handle                       | 等待结构化结果，再取得业务句柄       |
| host.setFlag / host.setFlags                    | 更新单项或整份许可快照               |
| host.disable / host.dispose                     | 等待单项或全部资源释放               |
| createCapabilityGraph / graph.ready / graph.get | 按明确服务依赖启动，并读取直接提供方 |

## 契约细节

### 入口、依赖与职责

根入口 @migaia/capability 提供 Capability Host、状态常量、错误身份和 readiness 快照。四个独立子入口分别是 @migaia/capability/graph（静态生命周期图）、@migaia/capability/graph/topology（纯拓扑与增量索引）、@migaia/capability/graph/dependency（纯依赖计划）和 @migaia/capability/graph/dynamic（运行时变更与 binding 所有权）。从实际入口导入，不把内部文件当公开路径。

本包依赖 @migaia/lifecycle 的世代、所有权、排空和队列原语，以及 @migaia/utils 的错误与 thenable 工具；不反向依赖 Store、UI、DOM、Node 或平台适配层。默认静态 Graph 需要宿主提供原生 AbortController/AbortSignal，只有 ESM 支持并不足够。

本文的 Host 始终指 createCapabilityHost 创建的进程内功能容器。它保存定义、共享 context、开关与启停状态，不读取 provider → consumer 依赖边。PluginHost 负责插件安装、管线与回滚；Storage Host 组合存储后端；Worker、线程或进程的运行域管理负责隔离与物理终止，均不等于这里的 Host。

能力图描述资源和服务的启动依赖，不是响应式数据的计算依赖图。静态 Graph 只接受硬依赖；optional provider 缺席仍运行、变化通知和跨运行域适配并非该入口的功能。动态拓扑使用独立 dynamic 入口。当前包不发布跨运行域 adapter，Promise 超时不能终止同一运行域里的同步死循环。

### Host 创建与输入快照

createCapabilityHost(context, options?) 返回 `ICapabilityHost<Context>`；Context 由实参推导。context 是交给全部 activate 的同一个引用，不会被冻结、读取或修改。调用方只放能力确实需要的应用数据。

options 默认空对象，必须是对象或函数，null/原始值触发带 INVALID_OPTION 的 TypeError。options.flags 与 options.onError 在创建时取得快照，后续改写原对象不改变行为。flags 省略时全部拒绝；onError 省略时没有用户诊断回调，提供时必须可调用。读取 options 字段失败以 INVALID_OPTION 保留原 cause；onError 的方法接收者保留为原 options 对象。

flags 只接受自有、可枚举、值严格为 true 的数据属性。继承属性不算允许，getter 不会被求值；`__proto__` 与 constructor 只是内部 Map 的普通键。原 flags 后续变化无效，必须调用 setFlag 或 setFlags。读取属性描述符失败会保留精确原因。

### Host 类型与完整操作

ICapabilityHandle 的唯一约束是 dispose(): void 或 `PromiseLike<void>`；业务方法由具体能力扩展，Host 不包装业务对象。`ICapabilityDefinition<Context, Handle>` 要求 name 和 activate(context)，Handle 默认 ICapabilityHandle。name 必须是 trim 后非空字符串；重复名字、无效名字和不可调用 activate 分别为 ALREADY_REGISTERED、INVALID_NAME、INVALID_ACTIVATE。

register 在登记时读取并冻结 name/activate 快照。后续改原定义不会改已登记身份；方法形式的 activate 可读取冻结接收者上的 this.name。成功激活时，Host 还会捕获 handle.dispose，之后修改该属性不能替换释放责任。缺少可调用 dispose 或读取它失败是 INVALID_HANDLE 的 TypeError，能力进入 failed。

| 成员                   | 行为与边界                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| register(definition)   | 同步登记，不激活；Host 终态或重入窗口内拒绝。                                                         |
| names                  | 每次返回当前登记名字的数组副本。                                                                      |
| state(name)            | 返回该能力的状态；未登记抛 NOT_REGISTERED。                                                           |
| `handle<Handle>`(name) | 返回 activate 创建的同一个业务句柄；未启用返回 undefined，未登记抛 NOT_REGISTERED。                   |
| error(name)            | 返回当前代最近一次激活或释放失败；重启成功或重新配置后清空。                                          |
| setFlag(name, enabled) | 只有严格 true 放行；false 同步作废在途激活、撤下已有句柄并开始释放；true 不自动激活。                 |
| setFlags(flags)        | 原子替换整份允许表，遗漏名字即拒绝；读取失败先全部拒绝，再抛 INVALID_OPTION。                         |
| enable(name)           | 返回结构化结果；并发调用共享同一次激活及其 pending Promise，已 on 不再激活，拒绝状态不调用 activate。 |
| disable(name)          | 等待该能力全部在途激活和释放排空；此前为 on 返回 true，activating 时会取消并等清理但返回 false。      |
| dispose()              | 终态关闭，按实际激活完成顺序反向释放并等待全部在途工作。                                              |
| disposed               | 首次整体关闭时即为 true；只读诊断继续可用，变更不能恢复该 Host。                                      |

除上表各参数外没有隐藏选项。state/handle/error 的 name 必须已登记；setFlag 可先为之后登记的名字配置开关。enable/disable 对非法操作返回 rejected Promise；disable 先判断 HOST_DISPOSED，再判断名字。register/setFlag/setFlags 的准入错误同步抛出。

CapabilityState 与 ICapabilityState 的五个值为 off（允许但未启用）、gated（开关拒绝）、activating（正在激活）、on（持有有效句柄）、failed（激活失败）。释放失败记录 error 并上报，保持 off/gated，不把它们改成 failed。gated 与图的 blocked 不是同一状态。

CapabilityEnableStatus 的值为 enabled、gated、cancelled、failed。ICapabilityEnableResult 只有 failed 分支额外带 error；ICapabilityEnableStatusValue 是这些 status 的联合类型。enabled 表示结果已被采纳；初始拒绝或晚到结果完成时开关仍拒绝返回 gated；disable、dispose 或其它代际作废返回 cancelled；当前代激活抛错或句柄无效返回 failed，error 与 error(name) 一致。

### Host 竞态、释放与重入

每次作废会推进 lifecycle 世代。activate 晚到时只在发起世代仍有效的情况下采纳；否则立即释放新得到的句柄，不能把已关闭的能力重新打开。旧代清理失败仍会报告，但不会污染已经健康的新句柄；当前代或尚无替代实例的适用清理失败留在 error(name)。

批量 setFlags 回退与 dispose 都按真实激活完成顺序反向释放，不按登记顺序或 enable 调用顺序。单项清理失败不阻断其他项；Host 保存并报告失败，正常清理策略不另造聚合拒绝。disable 只排空指定能力，dispose 排空全部能力；等待期间新增的晚到清理也包含在内。永不完成的 activate/释放会让相应排空等待持续进行。

首次 dispose 返回唯一 completion Promise。它完成前，后续 dispose 以 HOST_TRANSITIONING 拒绝；同步 disposer 重入会同步抛出，栈后重入返回 rejected Promise。首次完成后才返回同一个 canonical Promise。保留并等待首次结果，不用再次 dispose 加入正在进行的关闭。

disposer/reporter 的同步转换窗口不允许同一 Host 的变更重入。register/setFlag/setFlags 同步抛 HOST_TRANSITIONING；enable/disable 返回拒绝的 Promise。onError(name, error) 观察激活、释放和异常 thenable 失败；它自己的 throw/rejection 交给 utils 的共享宿主异常队列，不改变开关状态或覆盖业务错误。

Host 没有 dependsOn，也不强制串行所有 activate。若 A 必须先于 B 启用，应先 await enable(A)，或使用静态 Graph。把动态 import() 的调用放进 activate，加载才跟随许可后的激活；是否拆包由构建器决定，静态 import 的体积不会因开关消失。多租户应各建一个 Host 和开关快照。旧 enableResult、enableLegacyBoolean、disableNow 已移除；需要布尔值时比较 enable 结果的 status，物理清理则等待 disable。

### 静态 Graph：登记、启动与读取

createCapabilityGraph(options?) 的 options 默认空对象，仅有可选 onError，缺省无用户诊断回调。它在创建 lifecycle 根 scope 前读取并验证回调，getter 或不可调用值为 GRAPH_INVALID_OPTION。

IGraphNodeId 是带品牌的字符串类型。`IGraphNodeDefinition<T>` 的必填字段为 id、kind、dependencies、start；id/kind 为非空字符串，dependencies 为数组，边必须含 provider 和 required: true。start(context) 返回或异步返回 { value, release }，release 必须可调用，value 可以合法地为 undefined。静态注册读取并保存字段与冻结边快照；重复节点/边分别拒绝。所有定义在首次 ready 前登记，ready 后 GRAPH_FROZEN；关闭接纳时 GRAPH_ADMISSION_CLOSED，终态 GRAPH_DISPOSED。

ready 先检查缺失 provider、自环与依赖环，再按 level、ordinal 分层调用 start。同层按登记序号发起，并行等待整层全部 settle，整层成功才进下一层。失败以该层规范顺序首个失败为 primary，其余失败保留于 errors 链，再回滚本层成功节点和此前已启动节点。启动失败不隐式重试，但仍可 dispose 收尾。

IGraphStartContext 提供 nodeId、原生 signal、get(provider)、own(resource, descriptor)。get 只允许已声明且 ready 的直接 provider，不取得 lease；启动上下文结束、作废或关闭后不能继续调用。own 将辅助资源交给 provisional scope，失败、取消、作废或关闭时回滚；descriptor 必须立即有可调用 force，错误为 GRAPH_INVALID_OPTION，原 lifecycle TypeError 经 cause 可达。不能把同一个 primary value 再作为辅助资源重复拥有。

primary value/release 只由 Graph 拥有一次，节点内先释放 primary 再释放 auxiliary，节点间逆拓扑释放。primary release(context) 收到结构化 signal、nodeId 和 report；清理失败走 Graph 的错误与诊断策略。

| 静态 Graph 成员              | 行为                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| register(node)               | 只在 open 时登记定义。                                                                              |
| ready()                      | 启动一次；重复调用保留同一 Promise，启动失败不自动 retry。                                          |
| nodes                        | 冻结的登记 id 数组，终态仍可查询。                                                                  |
| nodeState(id)                | 冻结的时间点诊断，含 id、kind、state、value、error；未知 id 为 GRAPH_UNKNOWN_NODE。                 |
| `readValue<T>`(id)           | 直接读取同一原 payload，不创建诊断投影；仅整图 ready 时可见，其他时点为 undefined，未知 id 仍抛错。 |
| `get<T>`(consumer, provider) | 校验 consumer 已声明该直接依赖且 provider ready；不等于任意节点查询。                               |
| state / error                | 整图状态与保留的 primary 错误。                                                                     |
| dispose()                    | 先关闭接纳、取消启动，再逆拓扑释放；重复调用返回同一 Promise。                                      |

整图状态为 open、starting、ready、failed、quiescing、terminal。节点状态为 registered、starting、ready、suspended、failed、blocked、rolled-back、released；静态入口不提供动态 suspend 方法。readValue 的 undefined 也可能是真实数据，需结合 graph.state 判断可用性；payload 保持原对象身份和可变性，旧诊断不随之变成新的状态快照。自写 ICapabilityGraph 实现必须包含 readValue。

同步生命周期回调重入同一 Graph 操作触发 GRAPH_REENTRANT_OPERATION。onError 观察 cleanup 和 late-result failure，不替换 primary；回调自身失败也交给共享宿主异常队列。Graph dispose 的失败可返回 GRAPH_DISPOSE_FAILED，和 Host 报告后继续完成的策略不同。

### 纯拓扑与增量索引

静态建图只读取一次节点和边，以迭代 DFS 和 ordinal/level 桶在线性 O(v + e + p) 成本内构造，p 为捕获输入大小。多闭环按根 ordinal 与声明依赖顺序报告遇到的首个闭环。动态增删保留原算法。

buildCapabilityTopology(nodes, onUnknownProvider, onCycle, onInvalid) 只计算，不调用 start 或 release。四个参数均必填。节点为 { id, dependencies, ordinal }；ordinal 必须是唯一安全整数，连续覆盖 [0, nodeCount)，不静默重排或重写坏输入。边的 provider 非空、required 为 boolean；缺席 required provider 交 onUnknownProvider(nodeId, provider)，存在的 optional 边也参与层级和环检测。

结果 ICapabilityTopology 深冻结，包含 ordered，以及只读 providers、consumers、indegree、level、ordinal 映射。顺序为 (level, ordinal)：先依赖层级，同层再登记顺序。providers 为提供者到消费者，consumers 为消费者到依赖；indegree 是接纳时的依赖数。ReadonlyMap/ReadonlySet facade 不提供 mutation；forEach(callback, thisArg?) 保留标准接收者语义。

onCycle(path) 与 onInvalid(reason, nodeId?, failure?) 由调用方决定抛出错误外壳。getter 失败的 failure 含精确 cause，即使 cause 为 undefined 也保留；纯拓扑 owner 将其留在 adapter 抛出错误的 cause/errors 链，不换掉可附加的原生错误身份。TopologyInvalidReason 的值为 invalid-node、duplicate-node、duplicate-edge、duplicate-ordinal、unknown-node、transaction-open、transaction-closed。

createTopologyIndex(adapter) 要求 onCycle 与 onInvalid，不创建服务。增量输入只有 id/dependencies，索引自己持有单调 registrationOrdinal；删除不重编号，setDependencies 不更换登记序号。snapshot().ordinal 则把当前节点压缩为连续序号，供静态投影使用。required 与当前存在的 optional 边参与层级与环检测，缺席 optional provider 被记录但不阻塞节点。

| 索引操作                                            | 含义                                                           |
| --------------------------------------------------- | -------------------------------------------------------------- |
| size / has(id)                                      | 当前节点数与是否存在。                                         |
| registrationOrdinal(id)                             | 读取原单调登记序号，未知节点由 onInvalid 处理。                |
| add(node) / remove(id) / setDependencies(id, edges) | 原子更新节点或边，保留缺席 provider 的悬空事实。               |
| dependencies(id) / dependents(id)                   | 冻结的直接边，或按 required/optional 分类的直接消费者。        |
| missing(id)                                         | 当前缺席 provider 的边。                                       |
| closure(roots)                                      | 包含 roots 的 required 消费者传递闭包，按规范顺序返回。        |
| order(ids?)                                         | 全部或给定子集的规范顺序；省略即全部，子集去重，未知 id 拒绝。 |
| snapshot()                                          | 深冻结的静态拓扑投影。                                         |
| begin()                                             | 隔离事务，提供同一套 reader/writer 和 commit/rollback。        |

事务提交前基础读保持原快照，基础写和嵌套 begin 被拒绝。commit 发布工作副本，rollback 丢弃它并保留全部可观察事实；完成后的事务连读取都拒绝。静态拓扑与增量索引复用同一私有结构/边准入，不公开可信构建助手。

### 纯依赖计划

dependency 入口不启动、释放或修改索引。IDependencyStateReader 返回 activated、enabled、suspended、stale 四个独立 boolean：是否已激活、是否允许、是否挂起、保留绑定是否过期；没有一个合并的状态字符串。计划深冻结，含 steps（id/action）、order、edges（provider/consumer/optional/status?）和 blockedBy。

DependencyPolicy 为 reject、cascade、suspend；DependencyMutationKind 为 remove、disable。DependencyAction 为 release、disable、suspend、resume、rebind、restart、activate、invalidate。DependencyEdgeStatus.optionalAbsent 的值是 optional-absent，说明缺席的可选 provider。

| 规划器                                        | 输入和结果                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| planDependencyMutation(index, state, request) | request 必含 roots、kind、policy；reject 报告阻塞者，cascade 生成消费者优先计划，suspend 只暂停已激活且未挂起的消费者。remove 的根动作为 release，disable 为 disable。 |
| planRestart(index, state, roots)              | 消费者优先重启闭包，跳过未激活节点；已挂起节点改为 invalidate。                                                                                                        |
| planReplacement(index, state, request)        | request 含 target、canRebind；先安排直接 rebind，挂起消费者 invalidate，其余生成 restart 闭包。                                                                        |
| planResume(index, state, request)             | request 含 provider、generationChanged、canRebind；只遍历挂起前沿，过期者 restart，仍缺 required provider 者继续阻塞。                                                 |
| planActivation(index, state, roots)           | 仅规划尚未激活的 required 上游 provider，不把 roots 本身放进 activate steps。                                                                                          |
| resolveInstallSet(index, members, isLazy)     | 选择批次内非 lazy 成员及其 required provider，返回规范顺序的只读 Set。                                                                                                 |
| planTeardown(index)                           | 规划全部节点的逆规范释放顺序。                                                                                                                                         |
| collectPlanEdges(index, affected)             | 投影受影响集合的 required 内部边与相关 optional 边。                                                                                                                   |

invalidate 表示现有挂起实例的绑定已过期，调用方保持挂起并置 stale；之后由 planResume 选择 restart。canRebind 是调用方的能力判断，不是规划器执行 rebind。执行、错误上报、世代、lease 和物理清理仍归组合 owner。非法 mutation kind/policy 触发 GRAPH_INVALID_OPTION。

### 动态 Graph 与精确代际所有权

createDynamicCapabilityGraph(options) 必须提供 startBatch(entries) 与 releaseBatch(entries, fence)，缺少任何一个都为 GRAPH_INVALID_OPTION。没有默认节点级执行宿主；组合 owner 决定怎样启动 definition.start、建立值与释放 instance。start entries 含 id、binding、冻结定义；release entries 含 id、binding、instance，均对应精确旧实例，按提供方优先的规范顺序交付；owner 等待 fence 后自行倒序执行物理释放。

可选 report 默认无用户回调；mutationAdmissionMs 默认 undefined，队列预算实际关闭，提供时必须为非负有限数；releaseBinding 默认不调用。普通 mutation 共用 FIFO，拒绝的前序任务不阻塞后来者。排队超过 admission 预算、尚未执行的任务以 GRAPH_MUTATION_ADMISSION_TIMEOUT 拒绝并保留 lifecycle 原错。最终 dispose 在同一 FIFO 等待已准入任务，但关闭自身 admission timeout，不强制中断前序工作。

register(node, binding?) 和 replace(node, binding?, options?) 在离开队列、开始执行时才读取 id/kind/start/dependencies，一次接纳为不可变定义与边快照。改原对象不改变身份、诊断或边；更改定义必须 replace。捕获的 start 保留原 definition 接收者与返回值，getter 失败为 GRAPH_INVALID_NODE，原错误或 cause 保留。binding 省略为 undefined；没有绑定时不能 acquireBinding。

| 动态操作                          | 行为与默认值                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| register(node, binding?)          | 允许 required/optional 边，登记后尝试启动受影响前沿；缺席 optional 不阻塞。                                                        |
| remove(id, options?)              | policy 默认 cascade；移除目标定义，释放受影响实例，仍保留的消费者因 removed 阻塞；reject 有 required 消费者时原子拒绝。            |
| suspend(id, options?)             | 同样只接受 reject/cascade，默认 cascade；保留实例，不执行 release，依赖消费者被阻塞。                                              |
| resume(id)                        | 目标必须 suspended，否则 GRAPH_NODE_NOT_SUSPENDED；恢复满足全部 required provider 的前沿，已有实例不重新 start。                   |
| replace(node, binding?, options?) | restartDependents 默认启用；false 时用 onReplaced 通知直接 required 消费者，缺少回调或回调失败则重启相应闭包；失败先 report。      |
| dependentsOf(id)                  | 返回 required/optional 两组直接消费者，未知 id 抛 GRAPH_UNKNOWN_NODE。                                                             |
| ready()                           | 尝试启动当前 registered/blocked/failed 前沿，再将整图标记 ready，不冻结拓扑；仍可能保留 blocked 节点，不保证重复调用同一 Promise。 |
| nodeState(id)                     | 返回新的、未冻结的 id/kind/state/value/error/reason/binding/generation/ordinal/rank/level 诊断记录。                               |
| getBinding(id)                    | 非 owning 读取，不检查节点可用性；未知 id 或缺席绑定返回 undefined，不能据此持有异步使用权。                                       |
| acquireBinding(id)                | 仅 ready 且存在 binding 时返回冻结 { value, release }；release 幂等。                                                              |
| nodes / state / generation        | 当前登记 id、整图状态与变更世代。                                                                                                  |
| dispose()                         | 关闭接纳，按规范释放路径收尾并清空定义，重复调用同 Promise。                                                                       |

动态 remove/suspend 不接受纯规划器的 suspend 策略。默认 cascade 不删除所有消费者定义，而是按影响关闭/阻塞它们。optional 边不触发 required 级联，dependentsOf 仍会报告这些直接关系。顺序始终按 level/ordinal，不采用不同层级之间仅按最小 ordinal 的旧顺序。

每个变更结果只有 affected、topologyChanged、generation，没有公开测试计数或计时字段。同边 replace 保留 ordinal/rank/level 的语义；改变边后重新计算诊断。GraphBlockedReason 的 missing、suspended、removed、failed 从 graph 入口导入；GraphBindingReleaseReason 的 remove、replace、dispose 从 dynamic 入口导入；readiness 的 ready/blocked/failed 使用根入口 GraphReadinessState。

异步工作要在 acquireBinding 后用 finally 调用 lease.release。remove/replace/dispose 先 seal 旧 generation，把同一个不会 reject 的 fence 交给 releaseBatch；所有精确旧 lease 归零后 fence 才 resolve。组合 owner 不得在 fence 前启动物理 disposer。新 generation 使用不同 lease key，晚到旧 release 不会替新绑定解锁；releaseBinding 在所属实例清理后按 remove/replace/dispose 原因交回 binding custody。

startBatch 单节点失败能归给该节点 failed；多节点批次无法归因时全部 blocked，reason 为 failed。nodeState.error 保留原始错误，GRAPH_START_FAILED 的 detail.nodes 列出整批节点。startBatch 部分启动成功后抛错时，Graph 不知道已创建的部分实例，组合 owner 必须回滚；静态 Graph 的整层回滚保证不能套用到这里。report 是最终观察口，自己的 throw/rejection 不改变 mutation 结果，交共享宿主异常队列。

### Readiness 快照

snapshotGraphReadiness(source) 是桥接外部 readiness source 的低层工具。严格先读 state，再读 error，各一次；只接受 GraphReadinessState.ready/blocked/failed，返回冻结 { state, error }。普通代码读取 Graph 本身状态即可，不应把这三个可用性值当 Host 的五个生命周期状态。

原生且可附码的 getter Error 保持实例、类型和 stack，并附 INVALID_OPTION；primitive、不可变错误或冲突身份走 coded fallback，原值仍在 cause（包含抛出 undefined）。state 非法时立即拒绝，不继续读取 error。

### 错误身份与处理

Host 自有错误的 source 为 CAPABILITY_SOURCE，即 capability；Graph 自有错误为 CAPABILITY_GRAPH_SOURCE，即 capability.graph。用 (source, code) 区分归属。身份字段通过属性附加，不改写 stack；可附加的原生错误保留类型与实例，需包装时经 cause/errors 保留原对象。私有错误工厂不是公开入口。

| Host code          | 触发点                                                            |
| ------------------ | ----------------------------------------------------------------- |
| HOST_DISPOSED      | 终态 Host 上调用变更方法。                                        |
| HOST_TRANSITIONING | 同步生命周期重入，或首次 dispose 完成前再次调用。                 |
| NOT_REGISTERED     | 查询或操作未登记能力。                                            |
| ALREADY_REGISTERED | 重复登记名字。                                                    |
| INVALID_NAME       | 名字不是 trim 后非空字符串，TypeError。                           |
| INVALID_ACTIVATE   | activate 不可调用，TypeError。                                    |
| INVALID_HANDLE     | 激活结果缺少可调用 dispose，TypeError。                           |
| GATED              | 保留诊断码，当前 enable 返回 gated 而不抛此码。                   |
| INVALID_OPTION     | options/flags/definition/readiness 准入或读取失败，保留原 cause。 |

CapabilityErrorCode 与 ICapabilityErrorCode 是以上常量表与值联合。code 是公开 API，不另造别名。

| CapabilityGraphErrorCode 成员 | 码值与场景                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| graphDisposed                 | GRAPH_DISPOSED：终态变更或不允许的读取。                                                 |
| graphFrozen                   | GRAPH_FROZEN：静态 ready 后登记。                                                        |
| invalidNode                   | GRAPH_INVALID_NODE：定义、边或启动结果形状非法。                                         |
| duplicateNode                 | GRAPH_DUPLICATE_NODE：id 重复。                                                          |
| unknownProvider               | GRAPH_UNKNOWN_PROVIDER：静态 required provider 缺席。                                    |
| duplicateEdge                 | GRAPH_DUPLICATE_EDGE：重复边。                                                           |
| dependencyCycle               | GRAPH_DEPENDENCY_CYCLE：拓扑存在环。                                                     |
| providerUnavailable           | GRAPH_PROVIDER_UNAVAILABLE：直接读取未声明/未 ready provider，或不能取得 binding lease。 |
| startFailed                   | GRAPH_START_FAILED：启动失败，回滚或记录失败批次。                                       |
| disposeFailed                 | GRAPH_DISPOSE_FAILED：Graph 资源清理失败。                                               |
| admissionClosed               | GRAPH_ADMISSION_CLOSED：关闭中或已结束的启动 context 继续接纳工作。                      |
| unknownNode                   | GRAPH_UNKNOWN_NODE：未知节点查询。                                                       |
| reentrantOperation            | GRAPH_REENTRANT_OPERATION：同步生命周期回调重入。                                        |
| invalidOption                 | GRAPH_INVALID_OPTION：选项或 own descriptor 不合法。                                     |
| nodeHasDependents             | GRAPH_NODE_HAS_DEPENDENTS：reject 策略遇到 required 消费者。                             |
| mutationAdmissionTimeout      | GRAPH_MUTATION_ADMISSION_TIMEOUT：尚未执行的普通变更排队超时。                           |
| nodeNotSuspended              | GRAPH_NODE_NOT_SUSPENDED：resume 目标没有挂起。                                          |

### 组合与排查

持久化或其他可选功能的组合顺序为：创建包含所需应用对象的 context；登记在 activate 内 await import 的功能；等待 enable 结果，只有 enabled 时读取业务 handle；离开页面等待 disable；应用退出等待首次 dispose。错误上报只观察，不能反向改变生命周期。多租户分别创建容器，不共享开关状态。

enable 返回 gated 时先检查是否修改了原 flags、值是否严格为 true、是否忘了 setFlag；setFlags({}) 会撤回全部权限，只改单项用 setFlag。关掉后又自行出现时检查是否绕过 Host 直接执行 activate 或在清理回调里重入。需要服务依赖启动顺序时使用 Graph，而不是让 Host 猜测。

本包提供 fmt、lint、typecheck、typecheck:test、test；构建使用 build。bench:resume 是仓库已有的规划测量入口，但本文不据此声明未核实的性能结论。
