# `@migaia/store-react`

把已有响应式状态接到 React 读取钩子，并为独立组件树或服务端请求分别登记状态。

## 你可能遇到过

- 两个请求渲染同一组件，却读到对方的数据：状态仍来自模块级单例。
- 组件找不到状态时偷偷用了全局默认值：缺少 Provider 和忘记登记没有被分开处理。
- 两个面板共享运行时后连计数也合并了：把依赖图的归属当成状态实例的归属。
- 初始化输入已完成，首次服务端 HTML 却直接渲染子树：忽略了就绪状态仍需被观察。
- 同一资料被渲染两次就请求两次：每次渲染都创建新的异步资源。

## 为什么选它

- **让同一登记键在不同请求读到各自的 Store。** 每个 Provider 使用自己的登记表 Registry，读取按当前组件树解析，见[从独立请求注册表读取同一个 token](./USEGUIDE.md#从独立请求注册表读取同一个-token)。
- **直接区分缺少 Provider 与缺少登记。** useProvidedStore 分别给出 PROVIDER_REQUIRED 和 STORE_MISSING，见[区分缺少 Provider 与 token 未登记](./USEGUIDE.md#区分缺少-provider-与-token-未登记)。
- **共享 Atom 定义，不合并面板的当前值。** 每个 Registry 拥有自己的 AtomStore，即使它们借用同一 Runtime，见[让同一个 atom 定义的状态归各注册表所有](./USEGUIDE.md#让同一个-atom-定义的状态归各注册表所有)。
- **首次服务端渲染也遵守就绪占位。** 已完成的输入 Promise 仍须经过归一化屏障观察，本例子树没有提前读取，见[在首次服务端渲染中显示就绪占位](./USEGUIDE.md#在首次服务端渲染中显示就绪占位)。
- **把已加载资料交给多个服务端视图复用。** 同一个预加载 Resource 被两次读取，示例加载函数只运行一次，见[读取已加载 Resource 而不另发请求](./USEGUIDE.md#读取已加载-resource-而不另发请求)。

## 从这里开始

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createStore } from '@migaia/store-light'
import { useStore } from '@migaia/store-react'

const store = createStore({ price: 3, quantity: 2 })
function Total() {
  const total = useStore(store, (state) => state.price * state.quantity)
  return createElement('output', null, String(total))
}
console.log(renderToString(createElement(Total)))
store.price = 4
console.log(renderToString(createElement(Total)))
await store.$dispose()
```

输出：

```text
<output>6</output>
<output>8</output>
```

下一步：每个请求需要自己的状态看[请求登记表](./USEGUIDE.md#从独立请求注册表读取同一个-token)，已有异步资料看[预加载读取](./USEGUIDE.md#读取已加载-resource-而不另发请求)。

## 手写时的隐患

下面用原生对象与手工快照表示同一总价读取，只展示、不执行；两个写入路径都需要维护额外的视图副本。

```ts doc-test=check
const state = { price: 3, quantity: 2 }
let displayedTotal = state.price * state.quantity // 隐患：派生值复制成第二份状态，需要手工同步。
function setPrice(price: number) {
  state.price = price // 隐患：这条路径忘记更新视图副本，后续读取仍是旧总价。
}
function setQuantity(quantity: number) {
  state.quantity = quantity
  displayedTotal = state.price * state.quantity
}
setPrice(4)
setQuantity(3)
console.log(displayedTotal)
```

上例 selector 直接读取 Store 源字段，无需同步 displayedTotal 副本；SSR 更新后仍须显式再次渲染。

## 三分钟心智模型

直接读取已有 Store/Signal 时使用对应 hook；需要组件树选择不同实例时，用 token 登记到 Registry，再交给 Provider。异步资源由应用加载和拥有，React 钩子负责读取状态与订阅。

| 问题 / 术语                     | 对应工具                                             | 白话含义                                |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| 读取一个投影 / selector         | useStore                                             | 从已有 Store 计算组件需要的结果         |
| 单值接入 / Signal               | useSignal                                            | 一个响应式值及其设置函数                |
| 为子树选实例 / token、Registry  | createStoreToken、createStoreRegistry、StoreProvider | 类型化登记键、实例表与组件树边界        |
| 描述与值分开 / Atom definition  | useAtomDefinition                                    | 描述可以共享，值属于各自 AtomStore      |
| 等待异步值 / Resource、Suspense | useResource / useResourceValue                       | 读完整状态，或让 Promise/错误交给 React |
| 结束拥有关系 / owned            | registry.disposeAsync                                | 等待由登记表负责的实例清理              |

## 典型场景

| 场景                                       | 怎么组合                                                     | 详细说明                                                             |
| ------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| 无需 Provider 生成 Store 投影的服务端 HTML | `createStore → useStore → renderToString`                    | [完整示例](./USEGUIDE.md#无需-provider-生成-store-投影的服务端-html) |
| 在首次服务端渲染中显示就绪占位             | `ready + fallback → StoreProvider → renderToString`          | [完整示例](./USEGUIDE.md#在首次服务端渲染中显示就绪占位)             |
| 从独立请求注册表读取同一个 token           | `Registry × 2 → register(token) → useProvidedStore`          | [完整示例](./USEGUIDE.md#从独立请求注册表读取同一个-token)           |
| 区分缺少 Provider 与 token 未登记          | `Provider boundary → Registry.require(token)`                | [完整示例](./USEGUIDE.md#区分缺少-provider-与-token-未登记)          |
| 让同一个 atom 定义的状态归各注册表所有     | `Runtime → Registry × 2 → atomStore.set → useAtomDefinition` | [完整示例](./USEGUIDE.md#让同一个-atom-定义的状态归各注册表所有)     |
| 读取已加载 Resource 而不另发请求           | `Resource → await promise → useResourceValue → dispose`      | [完整示例](./USEGUIDE.md#读取已加载-resource-而不另发请求)           |

## 安装

```bash
pnpm add @migaia/store-react @migaia/store-light react react-dom
```

react/react-dom 的 peer 范围为 `>=19`。指南的 Atom/Resource 场景还直接导入：

```bash
pnpm add @migaia/reactive @migaia/store-keyed @migaia/resource
```

## 常用 API

| API                                        | 用途                              |
| ------------------------------------------ | --------------------------------- |
| `StoreProvider`                            | 为一棵组件树提供 Registry 与配置  |
| `useStore / useSignal`                     | 读取已有 Store 投影或单个 Signal  |
| `useProvidedStore / useStoreFromProvider`  | 按 token 取得当前子树的实例       |
| `useAtomDefinition / useSetAtomDefinition` | 读写当前 Registry 的 Atom 值      |
| `useResource / useResourceValue`           | 读取异步状态或 Suspense 值        |
| `useStoreResource`                         | 读取 Store 异步字段并管理版本租约 |

## 契约细节

### 归属、安装与运行环境

本包只把既有状态模型接入 React，不实现 Store、Atom、Resource 或全局状态框架。store-light 提供 Store 和异步字段，store-keyed 提供 Atom 定义与 AtomStore，resource 提供独立 Resource，reactive 提供依赖图；lifecycle 和 utils 承担清理与公共工具。它不会让未读取响应式节点的普通共享变量自动响应。

产物为 ESM，只有 `@migaia/store-react` 根入口，没有子路径。peer react/react-dom 均为 `>=19`，异步 Store 使用 React 19 的 use。直接导入 store-light、store-keyed、reactive、resource 的示例应显式安装对应包，不能依赖顶层可访问传递依赖。SSR 示例使用真实 ReactDOM server，只证明服务器读取/渲染，不证明客户端订阅或 effect 清理。

### Runtime、状态与作用域

Runtime 是一张响应式依赖图的容器。节点、Store、Atom 所属 Runtime 通过统一所有权协议确定，不能跨图建立订阅。Provider 的 Registry/AtomStore 属于一个 Runtime，但 Registry 不拥有 Runtime 本身。

Store 的普通字段、get 访问器和方法分别由 store-light 转为 Signal、Computed 与 Action。本包读取 $runtime，异步 Store 的 $async/storeReady，并使用资源协议；普通字段导出/hydration 仍由 $plain/$hydrate 等 Store API 负责；$snapshot() 提供 Store 快照，$batch(recipe) 把多次同步写入合并通知，recipe 的参数是 `IStoreShape<S>`。只用模块单例的 useStore/useSignal 不必有 Provider，但 Provider 不会把已共享的单例自动变成每请求独立实例。

Atom 定义是冻结描述对象，不含运行时状态；同一 atomDef/derivedDef/writableDef/familyDef 等定义在不同 AtomStore 中各自实例化。Registry 自己拥有一个 atomStore，同一 Runtime 也可容纳多个独立 Registry 的 Atom 状态。准备请求或应用时先创建 Registry，再用其 runtime 创建要注入的 Store/Resource，注册后才渲染，结束时由明确 owner 释放。

### StoreProvider 参数与所有权

`IStoreProviderProps` 的 children:ReactNode 必填；registry、runtime、disposeOnUnmount、config 均可省略。

| registry/runtime 输入 | 默认行为                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| 都省略                | Provider 新建 Runtime 与 Registry，disposeOnUnmount 默认 true                  |
| 只传 runtime          | 新建 Registry 并借用 runtime，disposeOnUnmount 默认 true                       |
| 只传 registry         | 使用外部 Registry，disposeOnUnmount 默认 false                                 |
| 两者都传              | 必须 registry.runtime===runtime，否则 INVALID_CONFIG；外部 Registry 默认不释放 |

Provider 从不销毁 Runtime，disposeOnUnmount 控制的是 Registry 及其 atomStore/owned 登记。外部 Registry 可显式 disposeOnUnmount:true 接管卸载释放。内部 runtime prop 改变时选择新候选 Registry，commit 后切换；旧已提交实例由其 effect cleanup 释放，不把新图的读取混进旧图。

客户端 RegistryBoundary 在 effect 中 retain，cleanup 调用 release；最后一个释放后 setTimeout(0) 再复查引用数与 generation，保护 StrictMode 的紧接重挂。外部接管的 Registry 也用这条路径。SSR 不运行这些 effect，因此不会靠 unmount 自动清理，必须在请求 owner 的 finally 中 disposeAsync。未提交的候选也没有可靠的“永久 abandoned render”回调，不用定时器猜测；需要确定性释放时由外部可观察 owner 接管。useMemo 只稳定身份，不负责资源释放。

### 配置、特性与就绪屏障

| config 字段                                             | 默认值与行为                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| features.wasm?:boolean                                  | false；只有字面 true 开启，开启却没有 ready 时生成拒绝的配置屏障 |
| features.experimental?:Readonly<Record<string,boolean>> | 空白名单；只有自有可枚举数据属性的值严格 true 才开启             |
| ready?:readonly IStoreReadyBarrier[]                    | 无屏障，归一化 ready 为 null；每项为 Promise 或零参工厂          |
| fallback?:ReactNode                                     | null；屏障 pending 时渲染占位，不保留旧 children                 |
| defaults.warnAsyncActions?:boolean                      | false；仅配置快照，不自动传给 createStore                        |

IStoreReadyBarrier 工厂为 `()=>Promise<unknown> 或 unknown`，归一化会同步调用它，结果用 Promise.resolve 接纳。所有屏障成功后渲染子树，任一失败在 render 抛给外层 Error Boundary；Provider 自己不提供错误 UI。Error 原因保持原实例（包括冻结 Error），非 Error 原因以 READY_REJECTED 包装并在 cause 保留，不进行字符串强制转换。features.wasm 的屏障可为任何等价初始化，不强制使用 store-wasm；ensureWasm 是可选组合。

同一 Provider/barrierScope、同一 ready 数组身份复用列表 Promise；新数组产生新就绪代，即使元素相同也重建 ReadyBoundary，旧代完成不能放行新代。工厂结果另按 scope+factory 身份缓存，在途/成功结果可跨列表复用，失败后删除工厂缓存，但同一旧数组仍复用已缓存的失败列表 Promise；单换数组不保证重新运行已成功的工厂。不同 Provider/请求 scope 隔离。abandoned render 之间不保证工厂恰好运行一次；非幂等初始化应由应用 owner 提供稳定 Promise。

已完成 Promise 的状态仍在 then 微任务更新，因此首次同步渲染可能 pending；客户端 effect 会重查，SSR renderToString 不运行 effect。保持 ready 数组、Store/Signal/Resource、selector/equality 身份稳定；配置是 readonly 输入，改变配置时提供新对象，不在 render 中写状态或创建持有资源的业务实例。

归一化配置的 features.wasm 为 boolean，features.experimental 为空原型浅冻结白名单，defaults 含 warnAsyncActions，ready 为 null 或带 promise/status()/error() 的跟踪对象；状态为 pending/ready/error；只有实验白名单被冻结，外层 features/defaults/ready 容器不保证冻结。StoreProviderState/IStoreProviderState 公开这三个值，状态不是错误码。实验键排序编码使输入键次序不影响配置；访问器不作为开启数据且不执行 getter，`__proto__` 是普通键。

| API                                         | 参数、默认与结果                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| useStoreConfig()                            | 返回当前 IStoreConfigValue，无 Provider 返回 null                                      |
| useStoreFeature(path)                       | path 为 `'wasm' 或 experimental.${string}`，无 Provider/未开启返回 false               |
| useAssertStoreFeature(path,apiName?)        | apiName 默认 `'this API'`；无 Provider 为 PROVIDER_REQUIRED，未开启为 FEATURE_DISABLED |
| readStoreFeature(config,path)               | 非 hook 查询，config 必填；未知路径或空实验键返回 false                                |
| assertStoreFeature(config,path,apiName?)    | 非 hook 断言，可传 null，默认名同上                                                    |
| normalizeStoreConfig(config?,barrierScope?) | config 默认 undefined，scope 默认每次新 `{}`；显式稳定 scope 决定 ready 缓存隔离       |

配置字段读取失败、非法 ready 项或无法安全读取实验特性为 INVALID_CONFIG，并按可用 cause 保留原错。defaults.warnAsyncActions 只是供应用读取，应在 createStore 的相应选项显式传入才改变 Store 行为。

### Store、Signal 与通用读取钩子

| API                                                | 参数、默认与行为                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `useStore<S,R>(store,selector,isEqual?):R`         | Store 与 selector 必填，isEqual 默认 Object.is，用 store.$runtime；不要求 Provider |
| `useSignal<T>(signal):readonly [T,(next:T)=>void]` | signal 必填，使用其 runtime；Signal 身份不变时 setter 稳定                         |
| `useTracked<T>(read,isEqual?,runtime?):T`          | read 必填，默认 Object.is/defaultRuntime，追踪实际读取节点                         |
| `useNodeValue<T>(node,runtime,enabled?):T`         | node/runtime 必填，enabled 默认 true；固定单节点的订阅                             |

useStore 在 store.$async 为 true 时先 use(storeReady(store))，就绪前进入外层 Suspense。selector 的参数为 `IStoreShape<S>`。useTracked 在 render 捕获读取，在 commit 发布 selector/snapshot 与依赖；被丢弃的 render 不改已提交订阅语义，Runtime 变化重建绑定，不让新图执行旧 reader。selector/equality 引用变化会重新捕获，但不需要靠每次退订重订实现。相等结果复用快照，避免重复 getSnapshot 得到新包装引用。

`IStableNode<T>` 的公开形状为 readonly value:T 与 peek():T，但节点还须满足 reactive 的实际所有权协议。useNodeValue 在 render 校验 node/runtime；enabled=false 仅关闭订阅，不跳过所有权校验和取值。订阅首轮只登记依赖不通知，快照直接 node.peek，不另缓存旧节点值。useSignal 走这条固定节点路径，不走动态依赖捕获；这只是机制差异，不作速度比较。

客户端通知通过 runtime.untracked 调用 React listener，listener 失败向 Runtime 以 subscription-listener 报告，不污染当前响应式依赖。useSyncExternalStore 负责与 React 的订阅模型接合；服务端 getServerSnapshot 读取不代表客户端订阅已经建立。

### 两种异步值

| 来源                                  | 钩子                           | 协议                                  |
| ------------------------------------- | ------------------------------ | ------------------------------------- |
| resource 的 `Resource<T>`             | useResource / useResourceValue | 独立异步状态机，使用 resource.runtime |
| 含 resource:`Resource<T>` 的异步 atom | useAsyncAtomValue              | 委托 useResourceValue(atom.resource)  |
| store-light 的 `IStoreResource<T>`    | useStoreResource               | Store 异步字段，带版本捕获与提交租约  |

这些钩子都是单个必填参数，无额外选项；Resource 与 IStoreResource 不能互换。useResource 返回 `IResourceState<T>`：idle、pending、success（data、可选 refreshing）、error（error）、cancelled（DOMException error）。useResourceValue 成功返回 data，error/cancelled 在 render 抛 error，idle/pending 在 render 抛 resource.promise 交 Suspense；不会从调度器 Effect 中抛出这些业务 Promise/错误。hook 不替应用 owner 销毁 Resource。

useStoreResource 订阅 resource.subscribe/getSnapshot，render 用 captureSnapshot(existingLease) 获取当前版本，layout commitCapture 后释放上一租约；unmount cleanup 的微任务+epoch 复查保护 StrictMode 重挂。这里只管理已捕获版本租约，不把完整资源生命周期移交给 React。底层 read/preload/retry/captureSnapshot/commitCapture 等协议须来自真实 IStoreResource。

### Atom 钩子

| API                                                                       | 行为                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| useAtomValue(atom:`IReadableAtom<T>`)                                     | 有 Provider 且 atom.atomDefinition 存在时读 registry.atomStore，否则直接节点读取 |
| useSetAtom(atom:`IWritableAtom<T,Args,Result>`)                           | 稳定 writer，按相同条件选择 atomStore.set 或 atom.write(...args)                 |
| useAtom(atom)                                                             | 返回 readonly [useAtomValue(atom),useSetAtom(atom)]                              |
| useAtomDefinition(definition:`IAtomDefinition<T>`)                        | 必须有 Provider；sub 订阅、preview 取快照                                        |
| useSetAtomDefinition(definition:`IWritableAtomDefinition<T,Args,Result>`) | 必须有 Provider；稳定包装 atomStore.set(definition,...args)                      |

Args 是 readonly unknown[]、Result 是写入结果；这几种钩子均只有一个必填参数，没有选项。通用协议来自 store-keyed/reactive/atom，不强制某个工厂；定义来自 atom/definition。Provider 路径和直连路径按 enabled 互斥订阅而保持 hook 调用顺序；即使直连 disabled，useNodeValue 仍先检查其实际所有权。定义读取用 preview，派生预览不发布正式依赖边，在同一 Runtime version 保持引用稳定；正式订阅由 sub 负责。定义是描述，AtomStore 才拥有每个作用域的值。

### Provider 查询钩子

下列钩子都要求上层 StoreProvider，无 Provider 时为 PROVIDER_REQUIRED。

| API                                               | 参数、返回与错误                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| useStoreRegistry()                                | 无参，返回当前 StoreRegistry                                                                                                                           |
| useStoreRuntime()                                 | 无参，返回当前 Registry.runtime                                                                                                                        |
| `useStoreFromProvider<T>(token:IStoreToken<T>):T` | token 必填，调用 registry.require(token)；缺失为 STORE_MISSING，只查找实例、不订阅其字段变化                                                           |
| useProvidedStore(token,selector,isEqual?)         | token 为 `IStoreToken<IReactiveStore<S>>`，selector 为 (state:`IStoreShape<S>`)=>R，二者必填；isEqual 默认 Object.is；查找后调用 useStore 建立投影订阅 |

### Token 与 StoreRegistry

`createStoreToken<T>(debugName:string):IStoreToken<T>` 返回冻结的 {key:symbol,debugName}，名称必须是非空字符串；同名 token 仍是不同 Symbol。new StoreRegistry(runtime?) 与 createStoreRegistry(runtime?) 都默认新建 Runtime，借用该 Runtime 并拥有自己的 atomStore。

| 成员                                       | 参数、默认与行为                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| register(token,value,options?)             | options 默认 {}，owned 默认 false；重复 token 为 STORE_DUPLICATE；返回仅作用于本代 entry 的幂等注销函数 |
| replace(token,value,options?)              | owned 默认 false，提交新 entry；旧值 owned 且引用不同时释放旧值，同引用不释放                           |
| get / require / has(token)                 | 缺失分别为 undefined / STORE_MISSING / false；关闭后均拒绝                                              |
| remove(token,disposeOwned?)                | disposeOwned 默认 true；返回是否移除，false 只摘除不释放                                                |
| retain(disposeOnRelease:boolean)           | 必填；返回幂等 release，最后释放且为 true 时任务延后复查再关闭                                          |
| dispose()                                  | 同步、幂等启动全部整体清理，可能抛同步清理错误                                                          |
| disposeAsync()                             | 稳定单 Promise，等待整体清理账本完成，失败拒绝且重播原链                                                |
| whenTerminal()                             | 仅等待到 terminal，不替代 disposeAsync 的错误结果                                                       |
| runtime / atomStore / lifecycle / disposed | 只读；lifecycle 为 open→closing→terminal，disposed 从非 open 起为 true                                  |

IStoreRegistrationOptions 只有 owned?:boolean；非对象、读取失败或非布尔值为 INVALID_CONFIG，owned 捕获一次。register/replace 通过统一 ownerOf 校验已声明所有权：跨 Runtime 为 CROSS_RUNTIME，未声明 owner 的普通值允许注册。get/require/has 是查询而非写入，但仍有 active 守卫。整体 dispose 一开始先关闭接纳、清登记，再调用 owned 回调，防止重入登记。

owned 释放优先 $dispose()，否则 dispose()，无对应函数则无操作；不拥有的值只摘除引用。整体清理按当前登记逆序启动 owned 释放，再释放 atomStore，不串行等待每项完成；thenable 由 lifecycle 读取一次 then 并用原 receiver 调用。同步 dispose 不等待 Promise，迟到失败由 Runtime lifecycle-hook 报告并被观察。disposeAsync 可在同步 dispose 之后等待同一批仍在途工作；提前发布的稳定完成 Promise 也支持清理回调重入共享。

单个同步失败可直接附 REGISTRY_DISPOSAL_FAILED 保留原 Error，多个失败用 AggregateError；冻结或非 Error 原因经 cause/errors，外包已有身份不改。整体完成 Promise 重播同步与异步错误，whenTerminal 只反映清理已落定，不表示没有错误。

remove、replace 和 register 返回的注销函数触发的是单项清理：异步失败会报告，但不纳入之后整体 disposeAsync 的等待账本。应用若要等待某个已移除对象的真实异步释放，应由该对象 owner 保留自己的完成协议，不能把 Registry 完成当成所有历史清理的屏障。

### 错误与迁移

| StoreReactErrorCode 属性 | code                     | 场景                                         |
| ------------------------ | ------------------------ | -------------------------------------------- |
| registryDisposed         | REGISTRY_DISPOSED        | Registry closing/terminal 后继续接纳或查询   |
| registryDisposalFailed   | REGISTRY_DISPOSAL_FAILED | owned 清理失败                               |
| providerRequired         | PROVIDER_REQUIRED        | Provider-only hook/feature 断言没有 Provider |
| featureDisabled          | FEATURE_DISABLED         | 特性未显式开启                               |
| storeMissing             | STORE_MISSING            | require token 尚未注册                       |
| storeDuplicate           | STORE_DUPLICATE          | 同 token 重复 register                       |
| crossRuntime             | CROSS_RUNTIME            | Registry 注入跨图值                          |
| invalidConfig            | INVALID_CONFIG           | token/Provider/owned/ready/feature 配置无效  |
| readyRejected            | READY_REJECTED           | 非 Error ready 拒绝原因的包装                |

STORE_REACT_SOURCE 为 `'store.react'`，本包创建的错误带 source/code；已有外包身份保持实际 owner，底层 reactive 所有权错误也由其 owner 提供。`createStoreReactError(code:IStoreReactErrorCode,message:string,options?)` 返回原生 Error，options 默认 undefined，cause 非 undefined 时转发；`createStoreReactAggregateError(code,errors:readonly unknown[],message)` 返回原生 AggregateError。必填参数如签名所示，两工厂只构造、不自动抛出，附不可写 source/code，保留 stack 与 errors/cause 链。

| 稳定诊断                                                                          | 对应处理                               |
| --------------------------------------------------------------------------------- | -------------------------------------- |
| `[store] StoreProvider registry/runtime ownership mismatch`                       | 只传 registry 或让 runtime 同引用      |
| `[store] hook requires a StoreProvider`                                           | 给 Provider-only hook 提供上层作用域   |
| `[store] provider registry is disposed`                                           | 新建 Registry，不复用已关闭实例        |
| `[store] duplicate provider store token: X` / `[store] missing provider store: X` | 修正注册顺序、token 身份或显式 replace |
| `[store] provider store "X" belongs to a different Runtime`                       | 对齐实际 owner                         |
| `[store] IStoreToken requires a debug name`                                       | 提供非空字符串                         |
| `[store] ready barrier rejected`                                                  | 检查 cause，用外层 Error Boundary      |
| `[store] provider registry disposal failed`                                       | 展开 AggregateError.errors 或单个原错  |

feature 断言信息含 apiName 与 path；wasm 开启却无 ready 的信息提示传入 ensureWasm 或等价初始化。不要把 fallback 当作错误 UI，也不要把状态三态当成错误码。React/react-dom 最低版本已迁移到 19；无操作 prepareForRender 与 retain 的无效第二参数已删除，保留一个 disposeOnRelease 参数。

### 排查与开发命令

缺 Provider 时检查组件真正的 React 父树，Context 不是按 DOM 位置传播；portal 保留其 React 父树上下文。未重渲染时确认 selector 实际读取目标节点、equality 未把变化判相等、读取没有提前在追踪外缓存。ready 卡住时检查 Promise 结算、稳定数组与 Error Boundary；SSR 应使用外部请求 Registry 并在 finally 等待 disposeAsync。

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run typecheck:e2e
pnpm run test:e2e
pnpm run build
```

浏览器集成需 Playwright 浏览器。列出命令不表示本次文档任务运行了它们。
