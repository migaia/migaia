# Store Platform Guide

> **状态：Internal Preview。** 适合受控内测；在浏览器、SSR streaming、长期
> family churn 与跨线程部署门槛过完之前，不要对外说「全面超越 Zustand/Jotai/MobX」。

## 怎么读这份材料

1. **在应用里读（推荐）**：打开 `/store-demo`
   - **顶部一级**：总览 · 场景 · API 手册 · 证据对照 · 能力清单
   - **场景/证据下的二级**：具体页面（小型/中型/大型…）
   - **API 手册里的二级/三级**：左边选入口，右边看本页章节与 API 锚点
2. **本文**：仓库内的文字契约与选档说明；细节 API 以应用内手册为准（有测试钉覆盖率）。
3. **设计长文**：
   [Pages](./Store-Platform-Design-and-Benchmark-Report.pages) /
   [DOCX](./Store-Platform-Design-and-Benchmark-Report.docx)

**一句话选型**：先问数据长什么样（表单 / 树表 / 长列表 / 按 id 多实例），再选 API。
本库是**一个内核 + 按规模分档的前端写法**，不是让你在同一功能里混用三套状态库。

## 0. 按规模选档（唯一入口叙事）

```
数据是「一张表单 / 配置 / 少量字段 + 动作」？
  └─ 是 → 【S 简单】createStore + useStore
            需要落盘 / 时间旅行？→ persist / devtools（仅对象门面）
            异步多步动作？→ flow，或在 await 后续体里显式 $batch

会按 index/key 高频改局部，且行组件要独立订阅？
  └─ 是 → 【M 中型】createStore 持根 UI/聚合 + collections 承载热路径
            行订阅用 useTracked(() => rows.at(i))
            结构集合必须 store.$own(collection)，随根一起释放

按业务 id 需要「多份 scope 各一份状态」，或 SSR 复用同一份定义？
  └─ 是 → 【L-key】atomDef / familyDef + Provider 内 AtomStore
            React：useAtomDefinition

单一长列表（对话 / feed），下标稳定、逐条编辑？
  └─ 是 → 【L-index】ObservableArray（等）+ useTracked
            可无 createStore；有页面级 UI 时再用 store 持根并 $own

只需要底层图节点，不要应用档 API？
  └─ → @/store/kernel（测试 / 库作者逃逸舱口，不算三档之一）
```

### 档位命名（统一前缀）

| 代号 | 读法 | 寻址方式 | 一句话 |
| --- | --- | --- | --- |
| **S** | 简单 | 字段名 | 一张对象表单 |
| **M** | 中型 | 根对象 + 结构单元格 | 树表，热路径在 collections |
| **L-index** | 大型·下标 | `0..n-1` 顺序下标 | 对话/feed 等稳定长列表 |
| **L-key** | 大型·主键 | 业务 id / 逻辑键 | 多 scope 各一份、SSR 复用定义 |

大型档只按**寻址维度**二分：`index` = 位置，`key` = 身份。不用 list/entity 这类易和「列表组件 / DDD 实体」撞车的词。

### 当代主路 vs 过渡写法

| 档 | 当代主路（新代码只走这里） | 过渡 / 兼容（勿在新模块扩散） |
| --- | --- | --- |
| S | `createStore` + `useStore` | 裸 `runtime.signal` + `useTracked`（benchmark 逃逸，不是 S 教程） |
| M | `createStore` + `collections` + `$own` + 行级 `useTracked` | 把大数组当普通 store 字段整表替换 |
| L-index | `ObservableArray` 等 + `useTracked` | 整表 immutable copy |
| L-key | `atomDef` / `familyDef` + `useAtomDefinition` | 实例 `atom()` / `atomFamily`（见下方「定义化 optics」） |

第一方回归：`testbench` 覆盖 S/M/L-index；`ai-conversation` 钉住 L-index 与 L-key 的「改一条只惊动一行」。

### 名词：实例 atom、定义 atom、optics

- **实例 atom**：`atom(0)` —— 杯子+水绑死，构造就有状态，难多 Provider / SSR。
- **定义 atom**：`atomDef(0)` —— 图纸；值在 `AtomStore` / Provider 里才出现。
- **optics**：从已有状态上切子视图。
  - **定义层（主路）**：`selectDef` / `focusDef` / `opticDef` / `splitDef`
  - **实例层（兼容）**：`selectAtom` / `focusAtom` / `opticAtom` / `splitAtom`

实例 `atom()` 仍标 planned 弃用，是因为存量与文档迁移窗口，**不再是「没有定义化 optics」**。

### 横切能力 SLA（按档，不是「平台全能」）

| 能力 | S | M | L-index | L-key |
| --- | :-: | :-: | :-: | :-: |
| Runtime 隔离 / Provider | ✓ | ✓ | ✓ | ✓ |
| `useStore` selector | ✓ | ✓ 根 | △ | ✗ |
| `useTracked` 行订阅 | △ | ✓ | ✓ | △ |
| `useAtomDefinition` | ✗ | △ | △ | ✓ |
| persist / devtools / middleware | ✓ | △ 仅根标量 | ✗ | ✗ |
| SSR 定义复用 | △ | △ | △ | ✓ |
| Resource / async family | △ | ✓ | △ | ✓ |
| Worker / Wasm / SAB | ✗ 默认 | △ | △ | △ 尖端可选 |

图例：✓ 一等支持 · △ 能拼但不完整 · ✗ 非本档目标。

**硬边界：** `persist` / 时间旅行 / 动作中间件目前只一等服务对象门面
（`createStore`）。L 档请自管持久化，或把需要落盘的少量 UI 状态留在 S 根 store。

平台还提供 Runtime 隔离、React Provider、SSR、Resource/Suspense、Worker、
SharedArrayBuffer 等增强。它不会把任意业务对象深度 Proxy 化；深层、高 churn
数据应使用显式结构集合或 atom 定义。

WASM 字段不是普通小字段的默认替代品。它最适合连续的大数组、批量编解码、数值计算和
SIMD 场景；单个 `string`/`number`/`boolean` 会额外承担 WASM 初始化、边界桥接和原生
allocation 的生命周期成本。只有在数据量或计算量足以摊平这些固定成本时才应启用 WASM。

## 1. 基础对象 Store（S 档默认）

```ts
import { createStore } from '@/store/store'
import { createMutationPolicy } from '@/store/middleware'

const mutationPolicy = createMutationPolicy('actions-only')

const counter = createStore(
	{
		count: 0,
		get doubled() {
			return this.count * 2
		},
		increment() {
			this.count++
		}
	},
	{ mutationPolicy }
)

counter.increment()
console.log(counter.doubled)
```

顶层字段是响应式的，getter 变成惰性 Computed，方法在同步阶段自动 batch。
`actions-only` 下，组件或普通回调直接写字段会抛错；应通过 Store 方法、
`$set`、`$hydrate` 或 `$batch` 修改。

异步函数在第一个 `await` 后已离开原同步 batch。跨 `await` 的多步更新应使用
`flow`，或在每个 continuation 中显式调用 action/batch。

## 2. Runtime 所有权与隔离

```ts
import { createRuntime } from '@/store/kernel'
import { createStore } from '@/store/store'

const runtime = createRuntime({
	onError(error, context) {
		reportRuntimeError(error, context.phase)
	}
})

const store = createStore({ count: 0 }, { runtime })
```

每个 Signal、Computed、Effect、Resource、atom 和结构集合都属于一个 Runtime。
track、connect、capture 和 notify 边界会校验所有权；跨 Runtime 建边会立即失败。
一个 SSR 请求、React Provider、Worker 图或独立测试应使用独立 Runtime。

`IRuntime` 是由 `createRuntime()` 创建的封闭消费接口，不是第三方实现 SPI。自定义
调度、错误上报与回收时机通过 Runtime options/公开配置注入；手写结构相同的对象
缺少私有所有权表和追踪器登记，会在入口被拒绝。

默认微任务 flush 的异常进入 `onError`；显式 `runtime.flush()` 和同步 batch
仍同步抛错。同批多个 observer 失败时抛出 `AggregateError`，健康 observer
仍会执行。

## 3. React 选择与性能契约

```tsx
import { useStore } from '@/store/react'

function Count() {
	const count = useStore(counter, (state) => state.count)
	return <output>{count}</output>
}
```

Selector 必须纯且可重复执行：

| 用法          |     更新时典型执行次数 | 适用范围             |
| ------------- | ---------------------: | -------------------- |
| 内联 selector |              最多 2 次 | 最新 props、轻量选择 |
| 稳定 selector |              通常 1 次 | 中等复杂投影         |
| Computed      | 昂贵派生按依赖变化缓存 | 过滤、排序、聚合     |

内联 selector 的两次读取分别验证已提交依赖和当前 render 闭包。JavaScript
无法判断两个新闭包是否语义相同，因此默认实现不猜测等价性。

```tsx
const selectCount = (state: typeof counter) => state.count

function StableCount() {
	return <output>{useStore(counter, selectCount)}</output>
}
```

昂贵派生应放进 Store getter 或显式 Computed：

```ts
const catalog = createStore({
	items: [] as Item[],
	get visibleItems() {
		return this.items.filter(isVisible).sort(compareItems)
	}
})
```

默认 Computed 在最后一个下游离开时 suspend：断开上游并标脏，下次读取重新
求值。`keepAlive: true` 会保留上游边直到 dispose。

### Provider 与 React speculative render

`StoreProvider` 必须在子树 render 前提供 Registry Context，因此内部候选
Runtime/Registry 会在 render 阶段创建；这不是业务副作用，且每个候选都有
`prepareForRender()` 的 abandoned-render 延迟回收。只有 RegistryBoundary
提交后候选才成为正式所有者；被 React 放弃的候选会自动 dispose。需要在模块
顶层创建且拥有外部副作用的资源时，优先使用已经 memoized 的 Promise/Resource，
不要在组件 render 或 `useMemo` 中直接创建。

`useAtomDefinition` 的 snapshot 读取同样可能发生多次或被放弃。peek 使用
非追踪预览，并在没有观察者的微任务边界回收仅由预览创建的实例；定义的
`read` 函数必须保持纯，不应在其中启动 I/O、写状态或注册外部监听。

## 4. 显式结构集合（M / L-index）

平台不对任意对象递归 Proxy。需要深层或集合级粒度时，显式选用 collections。

**中型默认组合：** 页面级字段与动作留在 `createStore`，热路径结构进 collection，
并用 `$own` 挂到 store 生命周期上——根 `$dispose` 时结构节点一起拆掉。

```ts
import { createRuntime } from '@/store/kernel'
import { createStore } from '@/store/store'
import {
	observableArray,
	observableMap,
	observableObject,
	observableSet
} from '@/store/collections'

type Conversation = { id: string; content: string }

const runtime = createRuntime()
const catalog = createStore(
	{
		selectedId: '' as string,
		select(id: string) {
			this.selectedId = id
		}
	},
	{ runtime }
)

const profile = catalog.$own(
	observableObject({ name: 'Ada', theme: 'dark' }, {}, runtime)
)
const messages = catalog.$own(observableArray<Conversation>([], {}, runtime))
const byId = catalog.$own(observableMap<string, Conversation>([], {}, runtime))
const selected = catalog.$own(observableSet<string>([], {}, runtime))

profile.set('name', 'Grace')
messages.push({ id: 'c-42', content: 'hello' })
messages.set(0, { ...messages.at(0)!, content: 'edited' })
byId.set('c-42', messages.at(0)!)
selected.add('c-42')
```

`ObservableArray` 使用索引级 cell；替换第 42 项不会使只读取第 41 项的 observer
重跑。Map 区分 key/value、size 和 iteration 依赖。Object 区分字段与 keys。
删除的 Object/Map/Set membership cell 会在最后一个观察者离开时自动释放，也可
调用 `prune()` 显式回收。Array 索引必须是整数。这些 API 保持 mutation 可见、
类型明确，也避免全对象 Proxy 的身份和序列化问题。

行组件不要用 `useStore` 扫整表，用 `useTracked` 钉在下标上：

```tsx
import { createRuntime } from '@/store/kernel'
import { useTracked } from '@/store/react'
import type { ObservableArray } from '@/store/collections'

type Conversation = { id: string; content: string }
type AppRuntime = ReturnType<typeof createRuntime>

function Row(props: {
	index: number
	messages: ObservableArray<Conversation>
	runtime: AppRuntime
}) {
	const item = useTracked(
		() => props.messages.at(props.index)!,
		Object.is,
		props.runtime
	)
	return <li>{item.content}</li>
}
```

## 5. Resource：异步派生、取消、缓存与 Suspense

```ts
const userId = runtime.signal('u-1')
const user = runtime.resource(
	async ({ signal }) => {
		const id = userId.value
		const response = await fetch(`/api/users/${id}`, { signal })
		return response.json() as Promise<User>
	},
	{
		ttl: 30_000,
		staleWhileRevalidate: true,
		retry: 2,
		retryDelay: (failure) => failure * 250
	}
)
```

Fetcher 同步阶段读取的 Signal/Computed 会成为依赖；依赖变化会取消旧 generation
并重取。`await` 后无法继续使用 JavaScript 同步追踪上下文，因此需要先把依赖
读入局部变量或 Computed。

```tsx
import { useResourceValue } from '@/store/react'

function UserCard() {
	const value = useResourceValue(user)
	return <article>{value.name}</article>
}
```

`read()`/`useResourceValue()` 在 pending 时抛共享 Promise，在失败时抛 error，
可直接接入 Suspense 和 Error Boundary。`promise`、`refetch()`、`invalidate()`
允许命令式等待；`cancel()` 取消当前 generation；`dispose()` 会 abort 并双向
断开上游和下游。

Adapter 的取消是协作式的：忽略 `AbortSignal` 的底层系统仍可能完成副作用，
但过期结果不会提交回 Resource。

成功缓存可通过 `dehydrate()`/`hydrate()` 进入 SSR。TTL、SWR 与 retry 是
Resource 本身的能力，不依赖 React。

### Resource 与 StoreResource 的边界

两者不是同一个抽象：`Resource` 是 Runtime 图里的异步派生节点，会追踪
fetcher 在第一个 `await` 前读取的 Signal/Computed，并把状态作为响应式值传播；
`createStoreResource` 是带版本 lease 的外部拥有资源，用于 Suspense 下创建和释放
Store、WASM、Worker 或连接等对象。后者不自动追踪任意同步读取，也不应把同一个可
释放对象同时交给多个 Resource；共享对象必须由调用方提供明确的 disposer/所有权策略。
React 组件使用 `useStoreResource`，普通异步派生使用 `useResourceValue`，不要通过
名字互换两种生命周期模型。

## 6. Atom、动态组合与 optics

```ts
import {
	atom,
	dynamicAtom,
	focusAtom,
	selectAtom,
	splitAtom,
	writableAtom
} from '@/store/atom'
import { asyncAtom } from '@/store/async'

const countAtom = atom(0, runtime)
const doubledAtom = atom((get) => get(countAtom) * 2, runtime)
const clampedAtom = writableAtom(
	(get) => get(countAtom),
	(_get, set, next: number) => set(countAtom, Math.max(0, next)),
	runtime
)

const activeAtom = dynamicAtom(
	() => (mode.value === 'compact' ? compactAtom : fullAtom),
	runtime
)
```

异步 atom 由 Resource 支撑，具有相同的依赖追踪、Promise、取消、缓存和 Suspense
语义：

```ts
const userAtom = asyncAtom(
	async (get, { signal }) =>
		fetch(`/api/users/${get(userIdAtom)}`, { signal }).then((r) =>
			r.json()
		),
	runtime,
	{ ttl: 60_000 }
)
```

`selectAtom` 做带 equality 的投影；`focusAtom`/`opticAtom` 提供不可变路径写入；
`splitAtom` 把列表拆成稳定 keyed item atom，并通过 `prune()` 释放已移除且无人
观察的 entry。

React 侧提供 `useAtomValue`、`useAtom`、`useSetAtom` 和
`useAsyncAtomValue`。

## 7. Computed/Resource/Atom Family

```ts
const visibleByCategory = computedFamily(
	(category: string) =>
		catalog.items.filter((item) => item.category === category),
	runtime,
	{ maxSize: 100, ttl: 5 * 60_000 }
)

const userById = resourceFamily(
	(id: string, { signal }) =>
		fetch(`/api/users/${id}`, { signal }).then((response) =>
			response.json()
		),
	runtime,
	{ maxSize: 500, ttl: 10 * 60_000, resource: { ttl: 60_000 } }
)
```

primitive key 使用 Map + LRU；object key 使用 WeakMap/WeakRef，family 不成为
参数对象的唯一 owner。观察中的 entry 不自动淘汰。所有 family 都提供
`remove(key)`、`prune()`、`clear()` 和 `dispose()`。

`atomFamily` 接受 atom factory，复用同一 TTL/LRU/显式释放策略。

## 8. Provider scope

```tsx
const counterToken = createStoreToken<typeof counter>('counter')
const registry = createStoreRegistry(runtime)
registry.register(counterToken, counter, { owned: true })

root.render(
	<StoreProvider registry={registry}>
		<App />
	</StoreProvider>
)

function Count() {
	const count = useProvidedStore(counterToken, (state) => state.count)
	return <output>{count}</output>
}
```

Registry 校验 Runtime 所有权和重复 token。内部 registry 默认随 Provider 最终
卸载释放；外部 registry 默认由调用方拥有。retain/release 逻辑兼容 React
StrictMode 的开发期重挂载。

## 9. SSR 请求隔离与 hydration

服务端每个请求创建一个 scope：

```ts
const scope = createSSRRequestScope()
const store = createStore(initialState, { runtime: scope.runtime })
const resource = scope.runtime.resource(loadData)

scope.register('app', store)
scope.registerResource('initial-data', resource)

const state = await scope.dehydrateAsync()
const script = createSSRStateScript(state)
// render HTML + script
scope.dispose()
```

客户端在创建节点前恢复：

```ts
const state = readSSRStateFromDocument()
const scope = createSSRRequestScope()
if (state) scope.hydrate(state)

const store = createStore(initialState, { runtime: scope.runtime })
scope.register('app', store)
```

未注册节点的 snapshot 会暂存，随后注册时应用。序列化只接受 JSON-safe plain
data，拒绝循环引用、非有限数字、prototype pollution key，并转义 script/HTML
敏感字符。安全校验有成本；横向基准显示这是当前 SSR 性能的主要差距。

## 10. Flow 与严格异步动作

```ts
const loadConversation = flow(runtime, function* (context, id: string) {
	store.loading = true
	try {
		const response: Response = yield fetch(`/api/chat/${id}`, {
			signal: context.signal
		})
		store.current = yield response.json()
	} finally {
		store.loading = false
	}
})

const task = loadConversation('c-1')
task.cancel('route changed')
```

每个 generator continuation 都在 Runtime batch 中执行。`FlowTask` 是 Promise，
同时具有 `cancel()` 和 `signal`；取消会运行 generator 的 `finally`。函数级
`cancelAll()` 用于组件或 route scope cleanup。

## 11. Middleware、依赖图与时间旅行

```ts
const binding = bindStoreMiddleware(store)
binding.hub.use(createLoggerMiddleware(console.info))
binding.hub.connectDevTools(createReduxDevToolsAdapter(connection))

const devtools = createStoreDevTools(store, {
	maxHistory: 200,
	captureRuntimeTrace: true
})

console.log(devtools.history)
console.log(devtools.actions)
console.log(devtools.trace)
devtools.jumpTo(devtools.history[0].id)
```

Middleware hub 使用 adapter-neutral 事件协议，支持 logger、Redux DevTools
连接、state jump/commit/reset。Runtime trace 包含 observable change、依赖边、
observer 执行/错误和 action。`getDependencyTree(observer)` 与
`getObserverTree(observable)` 返回有循环保护的可序列化树。

时间旅行依赖 `$plain()`/`$hydrate()`，不回放外部副作用。生产应用应为敏感或
不可克隆状态提供自定义 clone/redaction。

## 12. Worker 与 SharedArrayBuffer

```ts
const adapter = new WorkerAdapter(worker)
const ranked = workerComputed(
	adapter,
	() => ({ query: query.value, items: items.value }),
	{ runtime }
)
```

`workerComputed` 由 Resource 管理依赖和 Suspense；新输入会向 Worker 发送 cancel。
Worker 侧用 `createWorkerHandler` 建立 request/result/error/cancel 协议。

```ts
const shared = sharedInt32Array(runtime, 100_000)
shared.set(42, 7)
shared.update(42, (value) => value + 1)

// 远端写入直接推进来，不必自己 pump sync()
const stop = shared.watch()
```

内存布局是 **seqlock**：每格 `[value, seq]`，`seq` 同时是版本号与写锁（奇数 = 有人
正在写，一次完成的写入把它推进 2）。因此：

- 写者之间互斥，读者拿到的 value 与 version 一定来自同一次完成的写入。旧布局是
  `exchange(value)` 后 `add(version)` 两步，中间读者会看到「新值配旧版本」，据版本
  判断自己不脏，于是**漏掉一次通知**；
- `update()` 的回调在锁外执行——持锁期间调用用户代码，它一抛错就留下一把奇数的
  死锁；
- 写者若在持锁期间崩溃（线程被终止），该格永久不可读：读者自旋到上限后抛错，而不是
  静默卡住。这条无法自愈，属于已知边界。

`watch()` 用 `Atomics.waitAsync` 起唤醒回路，远端写入变成推送而非拉取。数组等的是
头部一个 epoch slot（一格一个 waiter 在长数组上不可行），醒来后扫描并只通知真正变了
的格。环境没有 `waitAsync` 时 `watch()` 直接抛错，不静默降级成拉取——静默降级会让
调用方以为自己拿到了推送。

SharedArrayBuffer 部署需要浏览器 cross-origin isolation（COOP/COEP）；API
只处理 Int32 固定布局，复杂对象仍应通过 Worker 消息或应用自定义编码。

## 13. AI 长对话窗口建模

目标：10 万条 conversation 中编辑第 50,000 条时，不复制整份数组，也不让其他
消息组件重渲染。

```tsx
type Conversation = {
	id: string
	content: string
	tokens: number
}

const conversations = observableArray<Conversation>(initial, runtime)

function ConversationRow({ index }: { index: number }) {
	const item = useTracked(
		() => conversations.at(index)!,
		Object.is,
		runtime
	)
	return <Message content={item.content} />
}

function editConversation(index: number, content: string) {
	conversations.set(index, {
		...conversations.at(index)!,
		content
	})
}
```

本模型的关键不是“更快的全局通知”，而是不进行 O(N) 数组复制，并把依赖落在
单个索引。需要列表结构的虚拟滚动器读取 `length`/迭代依赖；每个 row 读取自己
的索引 cell。Token 统计、过滤和排序放入 Computed；跨线程 embedding/ranking
放入 `workerComputed`；紧凑整数状态可放入 `SharedInt32Array`。

普通 React Context 通常让所有 context consumer 随 value 身份改变重新 render。
Zustand selector 可以隔离 render，但用普通 immutable array 替换一个元素仍需
复制 O(N) 容器。Jotai 的 per-item atom 和 MobX observable array 都可达到相似
细粒度；本平台的 ObservableArray 则把这一模式作为显式结构 API，并与 Runtime、
Wasm/Worker、SSR 和 Store 生命周期统一。

## 14. 可复现横向基准

运行环境：本机 Node/jsdom、React development 路径，同一进程，2026-07-27。
数字只能作为当前实现的回归证据，不能外推到浏览器 production 或其他机器。

### 单条 conversation 编辑，中位毫秒

| 数据量 | Current | Zustand |   Jotai |    MobX |
| -----: | ------: | ------: | ------: | ------: |
|    10k | 0.00115 | 0.00585 | 0.00124 | 0.00171 |
|   100k | 0.00060 | 0.05729 | 0.00087 | 0.00091 |

Current、Jotai、MobX 使用细粒度节点；Zustand 用惯用 immutable array copy。
这不是所有 Zustand 架构的理论上限，而是该业务建模方式的实际成本。

### 其他场景，中位毫秒

| 场景                | Current | Zustand |   Jotai |    MobX |
| ------------------- | ------: | ------: | ------: | ------: |
| 10k 动态依赖 churn  | 0.00060 | 0.00008 | 0.00288 | 0.00068 |
| React mount/unmount | 0.07349 | 0.05180 | 0.06758 | 0.04638 |
| SSR dehydrate 10k   | 3.73295 | 0.47754 | 0.46680 | 0.46790 |

Current 在单项编辑与 Jotai/MobX 同一数量级，在动态依赖中接近 MobX；React
生命周期并非最快，安全 SSR 序列化明显更慢。这些差距是发布前继续优化的依据。

### 强制 GC heap delta（MiB）

| 模型                | Current | Zustand | Jotai |  MobX |
| ------------------- | ------: | ------: | ----: | ----: |
| 100k state entries  |    0.77 |   0.00* | 0.02* |  0.79 |
| 100k 独立响应式节点 |   21.38 |   50.37 | 64.28 | 33.62 |

`*` 单容器模型主要共享原数组，接近测量噪声。独立节点行才比较 100k 响应式
对象的近似堆成本；不同库节点能力仍不完全等价。

```bash
npm run bench:store
npm run bench:store:memory
```

## 15. 运行时能力闸门（同构建 A/B、按租户开关、回退）

窄入口给的是**打包粒度**的开关：不 import 就不付费。它给不了同一份构建里按租户
决定开关、也给不了不重新部署就回退。先说清一件事：本库每个增强都是**调用才启用**
（`persist(store, …)`、`bindStoreMiddleware(…)`、`workerComputed(…)`），所以「行为」
层面的开关本来就在调用点上。缺的是懒加载时机、启停生命周期与按租户隔离。

```ts
import { createCapabilityHost } from '@/store/capability'
import { createStore } from '@/store/store'

const store = createStore({ theme: 'light' })
const capabilities = createCapabilityHost(
	{ store },
	{ flags: await loadTenantFlags(), onError: reportToSentry }
)

capabilities.register({
	name: 'persist',
	// 关着的时候这个 chunk 不进初始包——省体积的是打包器，闸门保证的是时机与竞态
	activate: async ({ store }) => {
		const { persist } = await import('@/store/persist')
		return persist(store, { key: 'app:theme' })
	}
})

await capabilities.enable('persist') // 未显式列为 true 时返回 false
capabilities.setFlag('persist', false) // 原子作废在途激活并释放 handle
```

契约：

- flags 是显式 allowlist：未列出、继承属性、getter 与非 `true` 值一律拒绝；
- 建 host 时会复制 flags 快照；热更新使用 `setFlag`，整表替换使用 `setFlags`，
  直接修改原对象不会绕过状态机；
- `blocked` 表示被闸门拒绝，`off` 表示允许但尚未启用；
- `enable` 幂等，并发调用共享同一次激活；
- 激活失败留在 `failed` 而不是半开态，原因记在 `error(name)` 上，同时上报 `onError`；
- 激活期间被 `setFlag(false)`/`disable`/`dispose` 的结果一律作废，并就地释放刚建出的 handle——
  否则「已经回退的能力」会在几毫秒后自己回来；
- `handle.dispose()` 同步执行期间禁止重入 `register`、`enable`、`disable`、
  `setFlag(s)` 或再次 `dispose`；状态读取仍可用，重入写会以明确错误拒绝，
  不会改写外层回退的最终快照；
- 两个 host 互不可见，适合一进程多租户；
- `setFlags` 批量回退与 `dispose` 都按实际激活顺序的反序释放 handle。

闸门**不能**做的：让一个静态 `import` 进来的能力变免费。体积只在 `activate` 用动态
import 时才真的省下来。

## 16. 测试与发布边界

```bash
npm test
npx tsc -b
npm run lint
npm run build
```

测试包含 Concurrent React commit/abort、Runtime 切换、Resource 乱序/取消、
Suspense/Error Boundary、SSR 转义、family TTL/LRU、collections 粒度、
Worker/SAB、middleware/time travel，以及 fast-check 随机依赖图、dispose、
多 observer 异常和异步竞态。

当前仍应诚实保留这些边界：

- 结构数据需要显式集合或 atom，不支持任意深层对象透明 Proxy；
- Resource 只能自动追踪 fetcher 第一个 `await` 前的同步读取；
- 第三方 I/O 忽略 AbortSignal 时无法强制撤销底层副作用；
- SharedArrayBuffer 依赖 COOP/COEP，只提供 Int32 固定布局，且写者在持锁期间崩溃时该格不可自愈；
- SSR 的严格 JSON 校验比三库的简单 `JSON.stringify` 路径更慢；
- 横向 benchmark 尚不是多浏览器、多设备、production React 的公开排行榜；
- DevTools 是可用的 adapter/数据层，不是完整独立浏览器扩展 UI。

这些限制属于公开契约，而不是由调用方猜测的隐藏行为。
