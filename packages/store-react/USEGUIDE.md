# `@migaia/store-react` 使用指南

下面六个示例用真实 React 19 与 ReactDOM 服务端入口运行。它们证明 SSR 读取、隔离和错误边界，不把显式再次渲染当作客户端订阅更新；客户端契约在后半部分单列。

## 按场景查找

| 场景                                       | API                 | 详细说明                                                |
| ------------------------------------------ | ------------------- | ------------------------------------------------------- |
| 无需 Provider 生成 Store 投影的服务端 HTML | `useStore`          | [完整示例](#无需-provider-生成-store-投影的服务端-html) |
| 在首次服务端渲染中显示就绪占位             | `StoreProvider`     | [完整示例](#在首次服务端渲染中显示就绪占位)             |
| 从独立请求注册表读取同一个 token           | `useProvidedStore`  | [完整示例](#从独立请求注册表读取同一个-token)           |
| 区分缺少 Provider 与 token 未登记          | `useProvidedStore`  | [完整示例](#区分缺少-provider-与-token-未登记)          |
| 让同一个 atom 定义的状态归各注册表所有     | `useAtomDefinition` | [完整示例](#让同一个-atom-定义的状态归各注册表所有)     |
| 读取已加载 Resource 而不另发请求           | `useResourceValue`  | [完整示例](#读取已加载-resource-而不另发请求)           |

## 运行准备

```bash
pnpm add @migaia/store-react @migaia/store-light @migaia/store-keyed @migaia/reactive @migaia/resource react react-dom
```

react/react-dom 需要满足 `>=19`，其余列出的包由示例直接导入。代码使用 createElement 而非 JSX，可作为独立 TypeScript 文件运行。renderToString 不运行客户端 effect；外部 Registry、Store 与 Resource 都由示例 owner 显式释放，不依赖服务端卸载回调。

## 无需 Provider 生成 Store 投影的服务端 HTML

服务端响应需要根据两个 Store 字段计算总价，后续响应还须读到更新后的值，而不必把 Store 放进 React 上下文。

把字段再复制到视图状态，会增加一份需要同步的值；第二次服务端渲染也不能证明已挂载客户端的订阅行为。

直接安装 React 19、`react-dom` 与 `@migaia/store-light`；`useStore` 执行选择器，`renderToString` 生成 HTML，修改单价后显式再次渲染，读取新值。

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

逐行输出 `<output>6</output>`、`<output>8</output>`；每次显式服务端渲染都根据当前 Store 值计算投影。

这证明 SSR 读取，不证明挂载后的订阅更新；`useStore` 不要求 Provider，相等比较默认 `Object.is`，运行时取自 Store，两次渲染完成后由调用者释放 Store。

### 示例参数

createStore 的 shape 含 price=3、quantity=2；useStore 的 store 与 selector 必填，selector 计算乘积，isEqual 省略为 Object.is，Runtime 来自 Store。createElement(Total) 在两次 renderToString 中分别求值；修改字段不是客户端挂载通知的证明。最后 $dispose 由调用者执行。

## 在首次服务端渲染中显示就绪占位

初始化输入已经完成，但新 Provider 仍须观察就绪屏障后才能渲染子树；首次服务端响应需要明确的占位内容。

输入 Promise 已兑现，不等于归一化后的屏障已完成；`renderToString` 不会执行客户端效果，也不等待它们更新子树。

通过 `StoreProvider.config` 传入稳定的 `ready` 列表和 `fallback`；先等待输入，再使用显式调用者拥有的注册表渲染，最后自行释放注册表。

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { StoreProvider, createStoreRegistry } from '@migaia/store-react'

const registry = createStoreRegistry()
const ready = [Promise.resolve()]
await ready[0]
let reads = 0
function Content() {
  reads += 1
  return createElement('p', null, '内容')
}
try {
  const html = renderToString(
    createElement(StoreProvider, {
      registry,
      config: { ready, fallback: createElement('p', null, '等待初始化') },
      children: createElement(Content)
    })
  )
  console.log(html)
  console.log(reads)
} finally {
  await registry.disposeAsync()
}
```

输出：

```text
<p>等待初始化</p>
0
```

逐行输出 `<p>等待初始化</p>`、`0`；即使输入已经兑现，首次渲染仍显示占位，`Content` 没有被求值。

本次 SSR 不证明客户端后续就绪更新；默认未启用 WASM 时，省略 `ready` 无屏障，`fallback` 默认 `null`，外部注册表默认不随卸载释放，SSR 也不会执行卸载清理。

### 示例参数

registry 显式创建并由调用者拥有，disposeOnUnmount 默认 false，children 是必填的 Content 元素。config.ready 是稳定的 Promise 数组，省略且默认 wasm=false 时无屏障；config.fallback 本例为 p 元素，默认 null。等待输入不等于新归一化屏障已经完成。

## 从独立请求注册表读取同一个 token

两个服务端请求渲染同一组件并使用同一 token，却拥有不同计数值；两个响应不能读到同一份模块级 Store。

全局 token 到 Store 的表会让最后一次登记影响所有请求；仅创建不同组件实例，也不能分开底层状态所有者。

每个请求创建一份注册表及同运行时 Store，用 `owned: true` 登记同一个 token，再分别传给 `StoreProvider`；`useProvidedStore` 从当前 Provider 选取 Store。

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createStore, type IReactiveStore } from '@migaia/store-light'
import {
  StoreProvider,
  createStoreRegistry,
  createStoreToken,
  useProvidedStore
} from '@migaia/store-react'

type ICounter = { count: number }
const token = createStoreToken<IReactiveStore<ICounter>>('counter')
const first = createStoreRegistry()
const second = createStoreRegistry()
first.register(token, createStore({ count: 1 }, { runtime: first.runtime }), { owned: true })
second.register(token, createStore({ count: 9 }, { runtime: second.runtime }), { owned: true })
function Counter() {
  return createElement('output', null, String(useProvidedStore(token, (state) => state.count)))
}
try {
  console.log(
    renderToString(
      createElement(StoreProvider, { registry: first, children: createElement(Counter) })
    )
  )
  console.log(
    renderToString(
      createElement(StoreProvider, { registry: second, children: createElement(Counter) })
    )
  )
} finally {
  await first.disposeAsync()
  await second.disposeAsync()
}
```

输出：

```text
<output>1</output>
<output>9</output>
```

逐行输出 `<output>1</output>`、`<output>9</output>`；同一个 token 在两棵服务端树中分别解析到不同 Store。

这证明显式 SSR 作用域隔离，不是自动管理请求；登记的 `owned` 默认 `false`，设为 `true` 后由 `registry.disposeAsync` 等待 Store 清理，已声明运行时的响应式值必须与注册表匹配。

### 示例参数

token 的 debugName 必填且非空，类型是 IReactiveStore<ICounter>。每份 Store 的 options.runtime 使用对应 Registry.runtime；register 的 options.owned 本例 true、默认 false。StoreProvider.registry 显式传入，children 必填；useProvidedStore 的 selector 返回 count，isEqual 默认 Object.is。

## 区分缺少 Provider 与 token 未登记

服务端组件找不到 Store 时，调用者需要区分是整层 Provider 缺失，还是当前请求忘记登记 token。

静默回退到全局 Store 会掩盖配置错误，还可能暴露其他请求的数据；只返回 `undefined`，又会把错误推迟到后续字段读取。

`useProvidedStore` 先要求存在 Provider，再要求 token 已登记到该注册表；通过真实 React 分别渲染两种错误树，读取不同公开错误码。

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { IReactiveStore } from '@migaia/store-light'
import {
  StoreProvider,
  createStoreRegistry,
  createStoreToken,
  useProvidedStore
} from '@migaia/store-react'

type ICounter = { count: number }
const token = createStoreToken<IReactiveStore<ICounter>>('counter')
const registry = createStoreRegistry()
function Counter() {
  return createElement('output', null, String(useProvidedStore(token, (state) => state.count)))
}
try {
  try {
    renderToString(createElement(Counter))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error
    console.log(error.code)
  }
  try {
    renderToString(createElement(StoreProvider, { registry, children: createElement(Counter) }))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error
    console.log(error.code)
  }
} finally {
  await registry.disposeAsync()
}
```

输出：

```text
PROVIDER_REQUIRED
STORE_MISSING
```

逐行输出 `PROVIDER_REQUIRED`、`STORE_MISSING`；第一棵树没有 Provider，第二棵树拥有合法空注册表，却没有所需登记。

两者都在服务端渲染期间失败；token 按身份区分，不按诊断名称字符串匹配，登记与读取须使用同一 token，本例不演示客户端错误边界。

### 示例参数

createStoreToken 的同一个 token 用于两次读取，诊断名不替代身份。第一次组件没有 Provider，第二次 Provider 传入合法空 Registry；其 children 明确给出，未指定 config 无就绪屏障。错误在 renderToString 的调用边界捕获，finally 释放外部 Registry。

## 让同一个 atom 定义的状态归各注册表所有

两个独立面板共用一个响应式运行时与同一 atom 定义，但当前值仍应归各自 Provider 注册表所有。

仅按运行时缓存 atom 状态，会把独立面板合并到同一状态所有者；复用定义应该共享描述，而不是共享所有 Provider 的值。

直接安装 `@migaia/reactive` 与 `@migaia/store-keyed`；在同一运行时创建两份注册表，分别通过 `registry.atomStore` 设置定义，再在对应 Provider 下渲染 `useAtomDefinition`。

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createRuntime } from '@migaia/reactive'
import { atomDef } from '@migaia/store-keyed/atom/definition'
import { StoreProvider, createStoreRegistry, useAtomDefinition } from '@migaia/store-react'

const runtime = createRuntime()
const definition = atomDef(0)
const first = createStoreRegistry(runtime)
const second = createStoreRegistry(runtime)
first.atomStore.set(definition, 5)
second.atomStore.set(definition, 8)
function Counter() {
  return createElement('output', null, String(useAtomDefinition(definition)))
}
try {
  console.log(first.runtime === second.runtime)
  console.log(
    renderToString(
      createElement(StoreProvider, { registry: first, children: createElement(Counter) })
    )
  )
  console.log(
    renderToString(
      createElement(StoreProvider, { registry: second, children: createElement(Counter) })
    )
  )
} finally {
  await first.disposeAsync()
  await second.disposeAsync()
}
```

输出：

```text
true
<output>5</output>
<output>8</output>
```

逐行输出 `true`、`<output>5</output>`、`<output>8</output>`；两份注册表共用运行时，同一个 atom 定义仍分别读到各自作用域中的值。

这证明 SSR 从各自 `atomStore` 读取，不证明挂载后的重渲染；`useAtomDefinition` 要求 Provider，`atomDef` 从传入的 `0` 开始，显式释放注册表不影响借用的运行时。

### 示例参数

createRuntime() 无自定义选项，两份 createStoreRegistry(runtime) 都借用同一实例。atomDef(0) 的初值为 0，分别用 atomStore.set(definition,5/8) 设置本地值；useAtomDefinition 只有必填 definition 参数并要求 Provider。各 Provider 的 registry/children 明确给出，最后分别 disposeAsync。

## 读取已加载 Resource 而不另发请求

服务端加载流程已经拥有用户资料，多次显式 HTML 渲染需要复用结果，而不是为每棵树再创建 Resource 和请求。

每次渲染都构造 Resource 会重复建立所有者，还可能启动更多请求；等待中的 Resource 也不能在 `renderToString` 中当作普通值读取。

直接安装 `@migaia/reactive` 与 `@migaia/resource`；在 React 外创建一个 Resource，等待其 `promise`，再用 `useResourceValue` 进行两次服务端渲染，最后释放它。

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'
import { useResourceValue } from '@migaia/store-react'

let requests = 0
const resource = new Resource(async () => {
  requests += 1
  return { name: '艾达' }
}, createRuntime())
await resource.promise
function Profile() {
  return createElement('p', null, useResourceValue(resource).name)
}
try {
  console.log(renderToString(createElement(Profile)))
  console.log(renderToString(createElement(Profile)))
  console.log(requests)
} finally {
  resource.dispose()
}
```

输出：

```text
<p>艾达</p>
<p>艾达</p>
1
```

先输出两次 `<p>艾达</p>`，再输出 `1`；两次服务端渲染读取同一已加载 Resource，加载函数只执行一次。

这证明缓存 SSR 读取，不证明客户端订阅；Resource 的 `autoStart` 默认 `true`、`ttl` 默认 `Infinity`，空闲或等待时 hook 抛 Promise，错误或取消时抛存储的错误，等待中的 SSR 需要匹配的 Suspense 方案。

### 示例参数

Resource 的 fetcher 返回资料并统计调用次数，第二参数为显式 createRuntime()，options 省略时 autoStart=true、ttl=Infinity。await resource.promise 后才读取，useResourceValue 只有必填 Resource 参数，不接管释放。两次 renderToString 共用此实例，最后 resource.dispose。

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
