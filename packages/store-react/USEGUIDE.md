# @migaia/store-react 使用指南

本指南面向已经读过 [README.md](./README.md)、决定要用这个包的人，聚焦每个 API 的精确行为、边界条件与排错方式。想先了解"这是什么、要不要用"，请回 README。

## 目录

1. [核心概念详解](#1-核心概念详解)
2. [StoreProvider 完整参考](#2-storeprovider-完整参考)
3. [Hook 完整参考](#3-hook-完整参考)
4. [依赖注入：StoreToken / StoreRegistry](#4-依赖注入storetoken--storeregistry)
5. [错误处理完整参考](#5-错误处理完整参考)
6. [生命周期与资源释放细节](#6-生命周期与资源释放细节)
7. [注意事项详解](#7-注意事项详解)
8. [贴近生产的完整示例](#8-贴近生产的完整示例)
9. [常见问题排查](#9-常见问题排查)
10. [构建、格式化与测试](#10-构建格式化与测试)

## 1. 核心概念详解

### 1.1 Runtime 与节点所有权

`@migaia/reactive` 的 `Runtime` 是一张依赖图的容器：Signal、Computed、Effect、Store、Atom 实例都"属于"某一个 Runtime（`claimOwnership`/`ownerOf` 建立这条唯一所有权关系）。只有同一个 Runtime 上的节点才能互相订阅——跨 Runtime 订阅是编程错误，本包在能做到的地方会主动检测并抛错（见 [`useNodeValue`](#39-usenodevaluenode-runtime-enabled)、[`StoreRegistry.register`](#42-storeregistry-类)）。

大多数场景不需要手动创建 Runtime：不传 `runtime` 时，`StoreProvider` 会用 `createRuntime()` 新建一个；未套 `StoreProvider` 的 `useSignal`/`useTracked` 默认落到 `@migaia/reactive` 的 `defaultRuntime`。只有需要多份互相隔离的状态图（比如测试、SSR 多请求）时才需要显式传入。

### 1.2 Store（`@migaia/store-light`）

`createStore(shape)` 产出的对象是"甜 API"：普通字段是 Signal，`get` 访问器是惰性缓存的 Computed，方法是自动 batch 的 Action。除了业务字段，实例上还挂了几个以 `$` 开头的元字段，本包的 hook 会用到：

| 字段/方法              | 参数类型                                  | 同步/异步 | 用途                                                                          |
| ---------------------- | ----------------------------------------- | --------- | ----------------------------------------------------------------------------- |
| `store.$runtime`       | —（只读字段，无参数）                     | 同步      | 这个 Store 所属的 Runtime；`useStore` 用它作为 `useTracked` 的第三个参数      |
| `store.$async`         | —（只读字段，无参数）                     | 同步      | 是否含有异步初始化字段；为 `true` 时 `useStore` 会先 `use(storeReady(store))` |
| `store.$snapshot()`    | 无                                        | 同步      | 取当前状态的一份普通对象快照（非响应式）                                      |
| `store.$batch(recipe)` | `recipe: (draft: IStoreShape<S>) => void` | 同步      | 手动合并多次写操作为一次通知                                                  |

### 1.3 Atom 定义 vs AtomStore：定义是 token，不含状态

`@migaia/store-keyed` 的 `atomDef`/`atomDefFactory`/`derivedDef`/`writableDef`/`familyDef`/`derivedFamilyDef` 产出的都是**冻结的描述对象**（`IAtomDefinition<T>`／`IWritableAtomDefinition<T, Args, Result>`），不含任何运行时状态。真正的值要靠一个 `IAtomStore`（`createAtomStore(runtime)`）去实例化：

```ts
const store = createAtomStore(runtime);
store.get(countDef); // 首次访问才实例化
store.set(countDef, (n) => n + 1);
store.sub(countDef, () => {}); // 订阅
```

这个设计的意义是**作用域化**：同一份 `countDef` 在不同的 `AtomStore`（比如不同 `StoreProvider`、不同 SSR 请求）下各自独立实例化、互不污染。`useAtomDefinition`/`useSetAtomDefinition` 固定走 `StoreProvider` 自带的 `registry.atomStore`；`useAtomValue`/`useSetAtom`/`useAtom` 则是更通用的协议 hook，见 [3.6](#36-useatomvalueatom--usesetatomatom--useatomatom)。

<a id="14-两种异步值resource-与-istoreresource"></a>

### 1.4 两种"异步值"：`Resource` 与 `IStoreResource`

本包同时对接两种不同来源的异步容器，名字很像但不是一回事：

|                     | 来自                                          | 对应 hook                                                                    | 语义                                                                                                                    |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Resource<T>`       | `@migaia/resource`                            | `useResource`、`useResourceValue`、`useAsyncAtomValue`（读 `atom.resource`） | 独立的、可取消可重试的异步值容器，天然支持 Suspense                                                                     |
| `IStoreResource<T>` | `@migaia/store-light`（Store 内部的异步字段） | `useStoreResource`                                                           | Store 定义里声明出的异步字段，带渲染期版本租约（`captureSnapshot`/`commitCapture`），避免并发渲染读到"已经被释放"的版本 |

两者都能配合 `<Suspense>` 使用，但订阅协议、返回形状都不同，不能互换：`useStoreResource` 需要一个实现了 `read/preload/retry/captureSnapshot/commitCapture/...` 完整协议的 `IStoreResource`，`useResource`/`useResourceValue` 需要的是 `@migaia/resource` 的 `Resource` 实例。

### 1.5 StoreRegistry / StoreToken：作用域化依赖注入

`StoreRegistry` 是挂在某个 Runtime 上的 key → value 容器，`StoreProvider` 内部会创建（或接收）一个，通过 React Context 下发给子树。`createStoreToken<T>(debugName)` 定义一把类型化的 key；`registry.register(token, value, { owned })` 把一个实例注册进去；子树里用 `useStoreFromProvider(token)` 或 `useProvidedStore(token, selector)` 取回。`owned: true` 表示这份实例的生命周期交给 Registry——Registry 释放时会调用它的 `$dispose()`/`dispose()`。

这套机制的价值是**不用到处 import 单例**：不同的 `StoreProvider` 子树（比如 SSR 每请求一份、多个独立小组件树）可以往同一个 token 注册不同的实例。只用模块级单例 Store/Signal（如 README 五分钟上手示例里的 `counterStore`）完全不需要 `StoreToken`，直接 `useStore`/`useSignal` 即可。

### 1.6 就绪屏障（`config.ready`）

`StoreProvider` 的 `config.ready` 是一组 `IStoreReadyBarrier`（`Promise<unknown>` 或零参工厂 `() => Promise<unknown> | unknown`），子树渲染前必须全部 settle。内部用 `Promise.all` 归一化成一个 `ITrackedReady`：pending 时渲染 `config.fallback`（默认 `null`），全部成功后渲染 `children`，任意一个 reject 则在 `ReadyBoundary` 里 `throw`（交给上层 Error Boundary）。精确语义见 [2.3](#23-ready-屏障的精确语义)。

### 1.7 Feature flag

`config.features.wasm` 与 `config.features.experimental` 是应用级"这棵树允许用什么增强"的声明，与 Registry/Runtime 的所有权正交。`useStoreFeature(path)` 查询（无 Provider 时返回 `false`，不抛），`useAssertStoreFeature(path)` 断言（未开启或无 Provider 都抛错），用于给实验性/需要额外初始化的 API 设置入口守卫。`path` 的类型是 `'wasm' | \`experimental.${string}\``。

## 2. StoreProvider 完整参考

```ts
type IStoreProviderProps = {
  readonly children: ReactNode;
  readonly registry?: StoreRegistry;
  readonly runtime?: IRuntime;
  readonly disposeOnUnmount?: boolean;
  readonly config?: IStoreProviderConfig;
};
```

### 2.1 registry / runtime 的所有权规则

- 都不传：`StoreProvider` 内部 `createRuntime()` + `createStoreRegistry()`，**自己创建、自己在 unmount 时释放**（`disposeOnUnmount` 默认 `true`）。
- 只传 `runtime`：Provider 仍然自己创建 Registry，但挂在传入的 Runtime 上；`disposeOnUnmount` 依然默认 `true`——但它只释放 Provider 创建的 **Registry**（含其 `atomStore` 与注册的 owned 实例），传入的 `runtime` 本身永远不会被这里释放，生命周期由调用方负责。
- 只传 `registry`：Provider 使用调用方给的 Registry，`disposeOnUnmount` 默认改为 `false`（外部对象默认外部拥有）；显式传 `true` 才会在 unmount 时释放它。
- 同时传 `registry` 和 `runtime` 且 `registry.runtime !== runtime`：立刻抛 `Error('[store] StoreProvider registry/runtime ownership mismatch')`。要么只传 `registry`，要么保证两者引用同一个 Runtime。
- `runtime` 在多次渲染间发生变化（切换到另一个 Runtime 实例）：Provider 会为新 Runtime 创建一份新的候选 Registry，通过内部的"候选/已提交"机制在 effect 提交前后安全切换，不会污染旧 Registry 的状态。

### 2.2 config 的四个字段

```ts
type IStoreProviderConfig = {
  readonly features?: {
    readonly wasm?: boolean;
    readonly experimental?: Readonly<Record<string, boolean>>;
  };
  readonly ready?: readonly (Promise<unknown> | (() => Promise<unknown> | unknown))[];
  readonly fallback?: ReactNode;
  readonly defaults?: { readonly warnAsyncActions?: boolean };
};
```

- `features.wasm`：声明本树会用到 wasm 字段。为 `true` 且 `ready` 为空数组时，会自动追加一个立刻 reject 的屏障（见 [5](#5-错误处理完整参考)），避免"开了开关却没人 init"。
- `features.experimental`：白名单对象，只有值严格为 `true` 的 key 才算开启；未列出或非 `true` 一律视为关闭。
- `ready`：见 [2.3](#23-ready-屏障的精确语义)。
- `fallback`：`ready` 屏障 pending 期间渲染的占位内容，默认 `null`（不是 `undefined`——不传 `fallback` 且有 `ready` 时，pending 阶段渲染的是"什么都不渲染"而不是上一次的 children）。
- `defaults.warnAsyncActions`：**只是配置快照的一部分**，通过 `useStoreConfig()` 暴露给业务代码读取；`StoreProvider` 不会把它自动传给 `createStore`——各个 Store 仍要自己在 `createStore(shape, { warnAsyncActions: true })` 里显式声明。这个字段更适合用作"业务代码统一读一个地方决定要不要传"的约定，而不是自动生效的开关。

### 2.3 ready 屏障的精确语义

- **元素身份在挂载后被锁定**。`config.ready` 数组第一次渲染时的值会被存入 `ref`，后续渲染即使传入新数组，只要按元素浅比较（`===`，逐项）与旧数组相等就视为同一份；只要有一项引用变了，就会触发身份变化处理——但**新数组不会生效**，Provider 继续用挂载时那份旧屏障，同时在开发环境 `console.warn`、生产环境 `console.error` 一条 `[store] StoreProvider ready barriers changed identity; ...`。这意味着内联字面量 `config={{ ready: [fetchUser()] }}` 每次 render 都会打印警告且不会重新等待——**务必**用 `useMemo` 或模块级常量稳住 `ready` 数组与其元素的引用。
- **工厂函数只执行一次（按屏障列表身份缓存）**。`ready: [() => ensureWasm()]` 里的工厂在同一个 barrier 数组的生命周期内只会被调用一次，结果被 `WeakMap` 缓存复用；但缓存 key 是"归一化后的屏障数组"本身，不是全局按工厂函数缓存——不同的 Provider/SSR 请求作用域各自独立执行一次，互不共享。工厂执行不保证在"React 放弃的渲染"下恰好执行一次；非幂等的初始化逻辑应该自己用一个模块级 memoized Promise，而不是依赖这里的缓存语义。
- **reject 会变成一个真实抛出的 `Error`**。非 `Error` 类型的 reject 原因会被包装成 `new Error(\`[store] ready barrier rejected: ${String(reason)}\`)`；`ReadyBoundary`在 render 阶段`throw` 它，只能被外层 React Error Boundary 捕获，`StoreProvider` 自己不提供错误 UI。
- **已经 settle 的 Promise 不保证首帧同步生效**。`ITrackedReady.status()` 是同步查询，但 track 逻辑是在 Promise then 回调（微任务）里更新状态，所以哪怕传入的 Promise 已经 resolve，`ReadyBoundary` 首次渲染仍可能读到 `pending`，随后一个 effect 里同步刷新到 `ready`——多数场景感知不到，但如果你依赖"reload 后立刻同步渲染最终内容、不闪 fallback"，需要注意这个微任务延迟。

### 2.4 `StoreProviderState` / `IStoreProviderState`

```ts
const StoreProviderState = { pending: 'pending', ready: 'ready', error: 'error' } as const;
type IStoreProviderState = 'pending' | 'ready' | 'error';
```

根入口公开导出的常量对象，是 [2.3](#23-ready-屏障的精确语义) 里 `ready` 屏障三种状态的稳定取值集合。本包内部（`ReadyBoundary`）用它驱动 fallback/children/throw 三路分支；业务代码一般不需要直接使用它——除非在自己的代码里复刻类似"三态就绪追踪"的逻辑，想复用同一套状态命名。

### 2.5 `assertStoreFeature(config, path, apiName?)` / `normalizeStoreConfig(config?, barrierScope?)` / `readStoreFeature(config, path)`

```ts
function readStoreFeature(
  config: IStoreConfigValue,
  path: 'wasm' | `experimental.${string}`
): boolean;
function assertStoreFeature(
  config: IStoreConfigValue | null,
  path: 'wasm' | `experimental.${string}`,
  apiName?: string // 默认 'this API'，出现在错误信息里
): void;
function normalizeStoreConfig(
  config?: IStoreProviderConfig,
  barrierScope?: object // 默认 {}；用于隔离不同调用方各自的 ready-barrier 缓存
): IStoreConfigValue;
```

这三个是 `useStoreFeature`/`useAssertStoreFeature`/`StoreProvider` 内部依赖的**非 hook 版本**，公开导出是为了让"不在组件里、但需要读取/校验同一份配置语义"的代码复用同一套逻辑（例如自定义的 SSR 请求作用域装配代码，或者非 React 的适配层）：

- `readStoreFeature(config, path)`：纯查询，`path === 'wasm'` 直接读 `config.features.wasm`；`path` 形如 `` `experimental.${key}` `` 时读 `config.features.experimental[key] === true`；其他 `path` 一律返回 `false`。
- `assertStoreFeature(config, path, apiName?)`：`config` 为 `null` 时抛 `[store] ${apiName} requires a StoreProvider (feature "path")`；`config` 非空但 `readStoreFeature` 返回 `false` 时抛 ` [store] ${apiName} requires feature "path" to be explicitly enabled on StoreProvider config`。`useAssertStoreFeature` 就是"取 `useStoreConfig()` 后调用这个函数"的薄封装。
- `normalizeStoreConfig(config?, barrierScope?)`：`StoreProvider` 内部用来把 `IStoreProviderConfig` 归一化成 `IStoreConfigValue`（`features` 补全默认值、`ready` 屏障数组转换成惰性求值+缓存的 `ITrackedReady`）的同一段逻辑，独立导出后可以在 Provider 之外复现相同的归一化行为；`barrierScope` 决定就绪 Promise 与工厂结果缓存的隔离边界——不同调用传不同的 `barrierScope` 对象，各自独立求值，不会共享缓存。`config.ready` 里出现既不是函数也不是 thenable 的元素会抛 `[store] config.ready must be an array of Promises or zero-argument functions`。

## 3. Hook 完整参考

### 3.1 `useStore(store, selector, isEqual?)`

```ts
function useStore<S extends Record<string, unknown>, R>(
  store: IReactiveStore<S>,
  selector: (state: IStoreShape<S>) => R,
  isEqual?: (a: R, b: R) => boolean
): R;
```

- 不需要 `StoreProvider`；直接订阅传入的 `store` 实例，`store.$runtime` 决定用哪个 Runtime 追踪依赖。
- 若 `store.$async === true`（Store 定义里含异步初始化字段），会先 `use(storeReady(store))`——组件在 Store 就绪前直接 Suspend，交给外层 `<Suspense>` 处理；不含异步字段的 Store 不受影响。
- `selector` 通过 `useTracked` 走"渲染期捕获、commit 期提交"的两段式协议：并发渲染中途被 React 丢弃的那一次不会污染真正提交的订阅状态。`selector`/`isEqual` 的引用应该稳定（模块级函数或 `useCallback`），否则每次渲染都会重新捕获依赖。
- 默认 `isEqual` 是 `Object.is`；想要浅比较对象结果时自己传一个。

### 3.2 `useSignal(signal)`

```ts
function useSignal<T>(s: ISignal<T>): readonly [T, (next: T) => void];
```

订阅单个 `ISignal`，返回 `[当前值, 设置函数]`。因为依赖集合恒为"这一个 Signal 自己"，内部直接走 `useNodeValue` 快路径，不经过 `useTracked` 的捕获/提交记账——比 `useTracked(() => signal.value)` 更轻。`set` 函数引用在 `signal` 不变时保持稳定。

### 3.3 `useTracked(read, isEqual?, runtime?)`

```ts
function useTracked<T>(
  read: () => T,
  isEqual?: (a: T, b: T) => boolean, // 默认 Object.is
  runtime?: IRuntime // 默认 defaultRuntime
): T;
```

最底层的通用订阅 hook：`read()` 内部访问到的**任意**响应式节点都会被自动追踪为依赖，不限于单个 Signal。`useStore`/`useResource` 都是基于它实现的一层薄封装。

- `runtime` 变化时会整体重建内部追踪实例——旧实例留给旧 effect 用到 cleanup 为止，新实例从当前 `read`/`isEqual` 初始化，绝不会让新 Runtime 执行旧 Runtime 捕获到的 selector。
- 内部使用 `@migaia/reactive/runtime` 导出的公开 `createObserverBinding` 三段式绑定（capture/commit/retrack），不依赖任何内部私有 API——第三方要写等价的自定义适配层也能做到同样的并发安全。
- 自己直接用这个 hook 时，把 `read`/`isEqual` 的引用稳定下来（`useCallback`/模块级函数），身份变化会触发一次重新捕获依赖（仍然正确，但多一次工作）。

### 3.4 `useResource(resource)` / `useResourceValue(resource)`

```ts
function useResource<T>(resource: Resource<T>): IResourceState<T>;
function useResourceValue<T>(resource: Resource<T>): T;
```

`Resource<T>` 来自 `@migaia/resource`。`useResource` 订阅完整状态机：

```ts
type IResourceState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: T; refreshing?: boolean }
  | { status: 'error'; error: unknown }
  | { status: 'cancelled'; error: DOMException };
```

`useResourceValue` 是 Suspense-safe 的取值版本：`success` 时返回 `data`；`error`/`cancelled` 时把 `error` 从 render 里 `throw`（走 Error Boundary）；`pending`/`idle` 时 `throw resource.promise`（走 `<Suspense>`）。二者共用同一个基于 `useTracked` 的订阅，`resource.runtime` 决定追踪所用的 Runtime；这个订阅只观察状态机本身的变化，Promise/错误的抛出永远发生在 render 阶段，不会从调度器的 Effect 回调里抛出。

### 3.5 `useStoreResource(resource)`

```ts
function useStoreResource<T>(resource: IStoreResource<T>): T;
```

订阅 `@migaia/store-light` 的 `IStoreResource`（见 [1.4](#14-两种异步值resource-与-istoreresource)），带**渲染期版本租约**：`resource.captureSnapshot(existingLease)` 在 render 阶段拿到当前快照与一个待提交的 capture 令牌；一个 `useLayoutEffect` 把它 `commitCapture` 成正式租约，释放上一个租约；另一个 `useLayoutEffect` 负责在真正 unmount（而非 StrictMode 的探测性 mount→unmount→remount）时异步释放租约——用一个自增的 `epoch` + `queueMicrotask` 判断"这次 cleanup 是否被紧接着的重新 mount 追上"，避免 StrictMode 下把还在用的资源提前释放。业务代码不需要关心这些细节，只需知道：**每次拿到的返回值都对应一个当下受保护、不会被提前回收的版本**。

### 3.6 `useAtomValue(atom)` / `useSetAtom(atom)` / `useAtom(atom)`

```ts
function useAtomValue<T>(atom: IReadableAtom<T>): T;
function useSetAtom<T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>
): (...args: Args) => Result;
function useAtom<T, Args extends readonly unknown[], Result>(
  atom: IWritableAtom<T, Args, Result>
): readonly [T, (...args: Args) => Result];
```

这三个是**协议 hook**：只要求传入的对象实现 `IReadableAtom`/`IWritableAtom`（`@migaia/store-keyed/reactive/atom`）协议，不强制来自任何特定工厂函数。行为分两种情况：

- **有 `StoreProvider` 且 `atom.atomDefinition` 存在**：读写都路由到 `registry.atomStore`（`sub`/`peek`/`set`），即这个 atom 实例在当前 Provider 作用域下的那一份状态。
- **无 Provider，或 atom 不携带 `atomDefinition`**：直接对 atom 节点本身做 `useNodeValue` 订阅、`atom.write(...args)` 写入——退化为"就是订阅这一个对象"，不经过任何 Registry。

两条路径在同一次 hook 调用里通过 `enabled` 参数互斥启用，**hook 调用顺序始终稳定**，不会因为 Provider 有无而改变 hook 数量。`useAtom` 就是 `[useAtomValue(atom), useSetAtom(atom)]` 的组合，两个子调用各自独立判断是否走 Provider。

### 3.7 `useAsyncAtomValue(atom)`

```ts
function useAsyncAtomValue<T>(atom: { readonly resource: Resource<T> }): T;
```

给形如 `{ resource: Resource<T> }` 的异步 atom 提供 Suspense-safe 取值，内部就是 `useResourceValue(atom.resource)`，见 [3.4](#34-useresourceresource--useresourcevalueresource)。

### 3.8 `useAtomDefinition(definition)` / `useSetAtomDefinition(definition)`

```ts
function useAtomDefinition<T>(definition: IAtomDefinition<T>): T;
function useSetAtomDefinition<T, Args extends readonly unknown[], Result>(
  definition: IWritableAtomDefinition<T, Args, Result>
): (...args: Args) => Result;
```

**必须有 `StoreProvider`**（内部调用 `useStoreRegistry()`，无 Provider 直接抛错）。固定读写 `registry.atomStore`：

- `useAtomDefinition` 订阅走 `store.sub(definition, onChange)`，取值走 `store.preview(definition)`——`preview` 是"可被 React 重复调用的推测性读取"：不会为派生值建立正式依赖边，但在同一个 Runtime version 内引用保持稳定，避免因为重复调用 `getSnapshot` 触发多余渲染。
- `useSetAtomDefinition` 就是 `store.set(definition, ...args)` 的稳定包装。

与 `useAtomValue`/`useSetAtom` 的区别：后者是"给任意 atom 协议对象接线，Provider 可选"；这一对是"专门读写 Provider 自己的 `atomStore`，Provider 必需"。业务里更常见的是用 `atomDef`/`derivedDef`/`writableDef`/`familyDef` 定义出 token，然后配这一对 hook。

<a id="39-usenodevaluenode-runtime-enabled"></a>

### 3.9 `useNodeValue(node, runtime, enabled?)`

```ts
type IStableNode<T> = { readonly value: T; peek(): T };
function useNodeValue<T>(node: IStableNode<T>, runtime: IRuntime, enabled?: boolean): T;
```

最底层的稳定节点订阅：`useSignal`/`useAtomValue` 的直连路径都基于它。适用于依赖集合恒为"就是这一个节点自己"的场景（不适合动态依赖，那种场景用 `useTracked`）。

- **所有权在 render 阶段同步校验**：`assertReactiveOwnedBy(node, runtime, 'reactive node')` 若发现 `node` 不属于传入的 `runtime`，立刻在 render 里抛错，能被 Error Boundary 捕获；不会等到订阅 Effect 真正跑起来才在 commit 阶段爆出这个问题。
- 订阅内部创建一个 `Effect`，首次运行只登记依赖、不触发 `onChange`；取值用 `node.peek()`——非追踪、恒为当前值，因此 React 在 render 与 subscribe 之间、或某次 transition 被中止后重新调用它，拿到的都是最新值，不存在撕裂窗口，也没有额外的快照缓存。
- `enabled=false` 时订阅函数直接返回一个空操作的取消函数——用于 `useAtomValue` 内部按需关闭这条直连路径而不改变 hook 调用顺序。

### 3.10 `useStoreRegistry()` / `useStoreRuntime()`

```ts
function useStoreRegistry(): StoreRegistry; // 无 Provider 抛错
function useStoreRuntime(): IRuntime; // = useStoreRegistry().runtime
```

取当前 `StoreProvider` 提供的 Registry / 其所属 Runtime。都**必须有 Provider**，否则抛 `[store] hook requires a StoreProvider`。

### 3.11 `useStoreFromProvider(token)` / `useProvidedStore(token, selector, isEqual?)`

```ts
function useStoreFromProvider<T>(token: StoreToken<T>): T;
function useProvidedStore<S extends Record<string, unknown>, Result>(
  token: StoreToken<IReactiveStore<S>>,
  selector: (state: IStoreShape<S>) => Result,
  isEqual?: (left: Result, right: Result) => boolean
): Result;
```

`useStoreFromProvider` 就是 `useStoreRegistry().require(token)`——按 token 取回注册实例，未注册则抛 `[store] missing provider store: X`。`useProvidedStore` 是"取回 + `useStore` 订阅"的组合，专门给注册在 Registry 里的 `IReactiveStore` 用。两者都**必须有 Provider**。

### 3.12 `useStoreConfig()` / `useStoreFeature(path)` / `useAssertStoreFeature(path, apiName?)`

```ts
function useStoreConfig(): IStoreConfigValue | null;
function useStoreFeature(path: 'wasm' | `experimental.${string}`): boolean;
function useAssertStoreFeature(path: 'wasm' | `experimental.${string}`, apiName?: string): void;
```

- `useStoreConfig`：拿完整归一化配置快照；无 Provider 时返回 `null`（这一点与 `useStoreRegistry` 不同——配置是可选的，Registry 不是）。
- `useStoreFeature`：查询单个特性是否开启；无 Provider 一律返回 `false`，不抛，适合写"有就用、没有就降级"的可选增强代码。
- `useAssertStoreFeature`：断言版本，供实验性/前置依赖初始化的 API 在入口处调用。未开启（含"根本没有 Provider"这种情况）都会抛 `Error`，因为实验特性不允许"默默在树外半开着生效"。

## 4. 依赖注入：StoreToken / StoreRegistry

### 4.1 `createStoreToken<T>(debugName)`

```ts
function createStoreToken<T>(debugName: string): StoreToken<T>;
```

产出一个冻结的、带类型参数 `T` 的 key（内部是一个 `Symbol`）。`debugName` 为空字符串会抛 `[store] StoreToken requires a debug name`——它同时是调试信息，出现在所有相关报错消息里，务必取一个能定位到业务含义的名字。

### 4.2 `StoreRegistry` 类

```ts
class StoreRegistry {
  readonly runtime: IRuntime;
  readonly atomStore: IAtomStore;
  get lifecycle(): 'open' | 'closing' | 'terminal';
  get disposed(): boolean;
  whenTerminal(): Promise<void>;

  register<T>(token: StoreToken<T>, value: T, options?: { owned?: boolean }): () => void;
  replace<T>(token: StoreToken<T>, value: T, options?: { owned?: boolean }): void;
  get<T>(token: StoreToken<T>): T | undefined;
  require<T>(token: StoreToken<T>): T;
  has<T>(token: StoreToken<T>): boolean;
  remove<T>(token: StoreToken<T>, disposeOwned?: boolean): boolean;

  dispose(): void;
  disposeAsync(): Promise<void>;
}
function createStoreRegistry(runtime?: IRuntime): StoreRegistry;
```

一般不需要在 React 组件树里手动实例化——`StoreProvider` 会替你创建（或接收你传入的一份）。手动创建常见于 SSR 请求作用域（每个请求一份独立的 Registry，请求结束后 `disposeAsync()`）或测试代码，见 [`test/exports.test.ts`](./test/exports.test.ts)。

- `register(token, value, { owned })`：同一个 token **不能重复注册**，重复会抛 `[store] duplicate provider store token: X`；先前注册想替换请用 `replace`。返回一个注销函数（幂等，重复调用只有第一次生效）；`owned: true` 且实体带 `$dispose()`/`dispose()` 方法时，注销或整体 `dispose()` 会自动调用它。
- `replace(token, value, options)`：无重复检查，直接覆盖；若旧值 `owned` 且与新值不是同一个引用，会释放旧值。
- `require(token)`：未注册时抛 `[store] missing provider store: X`；`get`/`has` 是不抛的查询版本。
- `remove(token, disposeOwned = true)`：从 Registry 摘除并按需释放；返回是否真的移除了什么。
- 所有写操作（`register`/`replace`/`get`/`require`/`has`/`remove`）在 Registry 已 `disposed` 后调用都会抛 `[store] provider registry is disposed`。
- **跨 Runtime 校验**：`register`/`replace` 时会检查 `value` 自己声明的所属 Runtime（通过唯一所有权协议 `ownerOf`，不是靠约定字段名，伪造不了也不会漏判新节点类型）是否与 `registry.runtime` 一致，不一致直接抛 `[store] provider store "X" belongs to a different Runtime`——防止把属于别的 Runtime 的 Store/Atom 注册进一个不相关的 Registry。
- `dispose()` 是同步、幂等的：反向遍历已注册的 owned 实体逐个释放，再释放 `atomStore`；某个实体的 `dispose()` 若返回一个 thenable，`dispose()` 不会等它（本身是同步方法），但会跟踪这个 Promise 并在其 reject 时经 `runtime.reportError` 上报，不会变成未处理的 rejection。多个实体报错时抛 `AggregateError('[store] provider registry disposal failed')`。
- `disposeAsync()` 是异步、单飞（多次并发调用共享同一次执行）的对应版本：会真正 `await` 每个 thenable 释放结果；对一个已经同步 `dispose()` 过的 Registry 调用，不会当作"已经完成"直接 resolve，而是等待 `dispose()` 当时来不及等待、仍在跑的那些异步释放全部 settle。
- thenable 采用 lifecycle 的统一接纳语义：只读取一次 `then` getter，并以原 thenable 作为 receiver 调用捕获到的函数。getter 抛出的原始异常不会被替换；同步 `dispose()` 会原样抛出，之后的 `disposeAsync()` 会通过其稳定 Promise 原样重放。
- `whenTerminal()` / `lifecycle`：暴露统一的 `AsyncLifecycle` 形状（`open` → `closing` → `terminal`），`whenTerminal()` 在真正走到 `terminal`（含所有异步释放都 settle）才 resolve。

## 5. 错误处理完整参考

所有本包错误都带 `source: '@migaia/store-react'` 与稳定 `code`：

| `StoreReactErrorCode` | 码值 | 触发条件 / 处理 |
| --- | --- | --- |
| `registryDisposed` | `REGISTRY_DISPOSED` | Registry 终结后继续读写；创建新 Registry |
| `registryDisposalFailed` | `REGISTRY_DISPOSAL_FAILED` | owned 实体释放失败；展开 `AggregateError.errors` |
| `providerRequired` | `PROVIDER_REQUIRED` | Provider-only hook 缺少 `StoreProvider`；补 Provider |
| `featureDisabled` | `FEATURE_DISABLED` | 所需 feature 未显式开启；修正 `config.features` |
| `storeMissing` | `STORE_MISSING` | token 尚未注册；修正注册顺序或 token |
| `storeDuplicate` | `STORE_DUPLICATE` | 同 token 重复注册；改用 `replace()` 或拆分 Registry |
| `crossRuntime` | `CROSS_RUNTIME` | Store 与 Registry 不属于同一 Runtime；统一所有权 |
| `invalidConfig` | `INVALID_CONFIG` | token/Provider/features 配置非法；按 message 修正 |
| `readyRejected` | `READY_REJECTED` | readiness barrier reject；检查保留在 `cause` 的底层失败 |

| 消息                                                                                                                          | 触发条件                                                                                                                                                    | 处理方式                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `[store] StoreProvider registry/runtime ownership mismatch`                                                                   | 同时传 `registry` 与 `runtime` 且二者不属于同一 Runtime                                                                                                     | 只传其中一个，或保证 `registry.runtime === runtime`                                                  |
| `[store] StoreProvider ready barriers changed identity; ...`（console.warn/console.error，不抛）                              | `config.ready` 数组在挂载后按元素比较发生了变化                                                                                                             | 用 `useMemo`/模块级常量稳住 `ready` 数组与元素引用                                                   |
| `[store] features.wasm is true but config.ready is empty; pass ensureWasm from @migaia/store-wasm (e.g. ready: [ensureWasm])` | `features.wasm: true` 但没提供 `ready`                                                                                                                      | 传入 `ready: [ensureWasm]`（来自 `@migaia/store-wasm`）或其它就绪 Promise                            |
| `[store] ready barrier rejected: ...`                                                                                         | 某个 `ready` 屏障 reject 且原因不是 `Error` 实例                                                                                                            | 检查具体屏障的失败原因；这个 Error 会从 `ReadyBoundary` 的 render 抛出，需要外层 Error Boundary 捕获 |
| `[store] hook requires a StoreProvider`                                                                                       | `useStoreRegistry`/`useStoreRuntime`/`useStoreFromProvider`/`useProvidedStore`/`useAtomDefinition`/`useSetAtomDefinition` 在没有 `StoreProvider` 的树里调用 | 在组件树更靠上的位置套一层 `<StoreProvider>`                                                         |
| `[store] ${apiName} requires a StoreProvider (feature "X")`                                                                   | `useAssertStoreFeature`/`assertStoreFeature` 在没有 Provider 的树里调用                                                                                     | 套 `StoreProvider`                                                                                   |
| `[store] ${apiName} requires feature "X" to be explicitly enabled on StoreProvider config`                                    | 有 Provider，但对应 feature 未在 `config.features` 里显式置 `true`                                                                                          | 在 `StoreProvider` 的 `config.features` 里显式开启                                                   |
| `[store] provider registry is disposed`                                                                                       | Registry 已 `dispose()`/`disposeAsync()` 后，仍调用 `register`/`replace`/`get`/`require`/`has`/`remove`                                                     | 检查是否有代码在组件卸载后仍持有并调用 registry 引用                                                 |
| `[store] duplicate provider store token: X`                                                                                   | 同一个 `StoreToken` 被 `register` 两次                                                                                                                      | 改用 `replace`，或确认没有重复挂载注册逻辑                                                           |
| `[store] missing provider store: X`                                                                                           | `require(token)`/`useStoreFromProvider(token)` 在对应实例注册之前调用                                                                                       | 确认注册逻辑先于消费者渲染执行；或先用 `has`/`get` 判断                                              |
| `[store] provider store "X" belongs to a different Runtime`                                                                   | 注册进 Registry 的值所属 Runtime 与 `registry.runtime` 不同                                                                                                 | 用同一个 Runtime 创建要注册的实例，或换一个 Registry                                                 |
| `[store] StoreToken requires a debug name`                                                                                    | `createStoreToken('')`                                                                                                                                      | 传一个非空的调试名                                                                                   |
| `AggregateError('[store] provider registry disposal failed')`                                                                 | `dispose()`/`disposeAsync()` 时多个 owned 实体的释放各自抛错                                                                                                | 展开 `error.errors` 逐个排查；单个实体报错时会直接抛出那个原始 error，不包一层                       |

## 6. 生命周期与资源释放细节

### 6.1 谁拥有 Registry

- **Provider 自建**（未传 `registry` prop）：`disposeOnUnmount` 默认 `true`，unmount 时自动 `dispose()`。
- **外部传入**（`registry` prop）：`disposeOnUnmount` 默认 `false`，调用方负责在合适的时机自己 `dispose()`/`disposeAsync()`；显式传 `disposeOnUnmount={true}` 才会交给 Provider 释放。
- **`runtime` prop**：无论 Registry 是谁创建的，`runtime` 本身的生命周期**始终**由调用方负责，`StoreProvider` 从不释放它——它只释放自己拥有的 Registry（及其 `atomStore`、注册的 owned 实体）。

### 6.2 StrictMode 下不误伤

开发模式下 React StrictMode 会对每个组件的 effect 做"挂载 → 卸载 → 再挂载"的探测性重放。`RegistryBoundary` 的 `useEffect` 调用 `registry.retain(disposeOnRelease, deferTask)`：

- `retain()` 让内部 `retainCount` 自增，`release`（cleanup 函数）自减；只有 `retainCount` 归零且 `disposeOnRelease` 为真才会真正 `dispose()`，且这个 dispose 动作是**延后**执行的（`queueMicrotask`，或者当存在 ready 屏障时用 `setTimeout(0)`，即 `deferTask`）。
- StrictMode 的"卸载 → 立刻重新挂载"发生在这个延后窗口之内：重新挂载会先把 `retainCount` 加回去，延后的 dispose 检查时发现计数不为零就放弃——不会把 Provider 内部创建的 Registry 提前销毁。
- 这套延后机制只保护 Provider **内部创建**的 Registry；外部传入的 `registry`（`disposeOnUnmount` 显式为 `true`）走同一个 `retain`/`release` 路径，同样受益。

### 6.3 被丢弃的并发渲染不会泄漏

`OwnedRegistryBoundary` 不再调用 `registry.prepareForRender()` 通过 wall-clock 猜测 abandoned render。React 没有可靠的“该 render 永久放弃”回调，任何定时器都可能在合法的 Suspense/concurrent commit 之前 dispose Registry，导致后续 `retain()` 失败。Registry 由可观察的 commit/unmount owner 释放；未提交候选的确定性回收需由外层 owner 或未来 GC-backed 机制承接。

### 6.4 owned 实体的释放顺序

`StoreRegistry.dispose()`/`disposeAsync()` 按**注册顺序的逆序**释放 owned 实体（后注册的先释放）——如果 B 依赖 A（B 在 A 之后注册），这个顺序能让 B 在 A 之前被清理。非 owned 的实体（`register(token, value)` 不传 `owned: true`）永远不会被 Registry 触碰其生命周期，只是从内部 map 里摘除引用。

## 7. 注意事项详解

1. **`config.ready` 只在挂载时读取一次，之后的新引用会被忽略并打印警告**。原因见 [2.3](#23-ready-屏障的精确语义)：身份追踪只能在挂载时锁定一次基准，允许运行时静默切换等价于允许子树的初始化条件不可预测地重置——所以设计上选择了"忽略新值 + 显式警告"而不是"偷偷重新初始化"。修复方式是把数组包进 `useMemo(() => [ensureWasm], [])` 或提到模块作用域。
2. **`features.wasm: true` 但 `ready` 为空会立刻触发一个本地报错屏障**。这不是必须使用 `@migaia/store-wasm` 的强制耦合——你可以传任何等价的就绪 Promise——但这个检查本身是刻意的：wasm 初始化几乎总是异步的，"打开开关却没有对应的就绪等待"几乎总是遗漏了 `ready`，本包选择在开发期就报错而不是让子树在 wasm 未就绪时静默渲染出错误状态。
3. **Registry 释放不等于 Runtime 释放**（见 [2.1](#21-registry--runtime-的所有权规则)）。这个区分是为了支持"多个 Provider 共用同一个 Runtime"的场景（比如同一个应用里多棵独立子树共享底层响应式图，但各自有独立的作用域化 Registry）；如果 Provider 顺手把传入的 Runtime 也释放了，会让这种共享场景在任意一个 Provider 卸载时炸掉其它还在用这个 Runtime 的子树。
4. **`useAtomDefinition`/`useSetAtomDefinition`/`useStoreFromProvider`/`useProvidedStore`/`useStoreRegistry`/`useStoreRuntime` 必须有 `StoreProvider`**，没有直接抛错；而 `useAtomValue`/`useSetAtom`/`useAtom` 容忍缺失 Provider，退化为直接订阅 atom 自身（见 [3.6](#36-useatomvalueatom--usesetatomatom--useatomatom)）。区分原则是：前一组的语义本来就是"读写 Provider 的作用域化状态"，没有 Provider 这件事本身没有意义；后一组的语义是"给任意 atom 协议对象接线"，Provider 只是可选的增强。
5. **render 阶段不要写状态**。`useStore`/`useSignal`/`useTracked` 等的写操作（Action、`signal.value = x`、`store.field = x`）只应该出现在事件回调或 effect 里。这不是本包特有的规则，而是 React 对"渲染必须是纯函数"的一般要求叠加上响应式图的具体后果：在 render 期间写入会在同一次渲染的求值窗口内触发一次新的通知，容易和当前正在进行的捕获/提交流程产生竞态，表现为额外的重渲染甚至 `useSyncExternalStore` 的一致性警告。
6. **selector/equality/atom 引用要稳定，不要在 render 里 `new` 一个 Store/Signal/Resource**。每次渲染都创建新实例，等于每次渲染都在订阅一个全新的、状态清零的对象——不仅浪费（每次都要重新走一遍 `useTracked` 的依赖捕获），而且如果这个实例本身持有资源（比如 `Resource` 发起请求），会在每次渲染时重复触发副作用。正确的做法是让这些实例来自模块作用域单例、`useMemo`，或者通过 `StoreProvider`/`StoreRegistry` 注入。

## 8. 贴近生产的完整示例

下面这个例子把 `StoreProvider`、就绪屏障、feature flag、`StoreToken` 依赖注入、`useProvidedStore`、Suspense-safe 的异步读取（`useResourceValue`）组合在一起，模拟"应用启动前先恢复本地状态，某个子树按需开启 wasm 能力，业务 Store 通过 token 注入而不是全局单例"的场景。

```tsx
import { Suspense, useEffect, useMemo } from 'react';
import {
  StoreProvider,
  createStoreToken,
  useProvidedStore,
  useResourceValue,
  useStoreFeature,
  useStoreRegistry,
  useStoreRuntime
} from '@migaia/store-react';
import { createStore } from '@migaia/store-light';
import type { IReactiveStore } from '@migaia/store-light';
import { Resource } from '@migaia/resource';
import type { IRuntime } from '@migaia/reactive';

type ISession = { userId: string; setUserId(id: string): void };
const sessionToken = createStoreToken<IReactiveStore<ISession>>('session');

function restoreSession(): Promise<void> {
  // 例如从 localStorage/远端恢复登录态；调用方负责把它 memo 住。
  return Promise.resolve();
}

function App() {
  // ready 数组的引用必须稳定，否则每次渲染都会命中 §2.3 的身份检查警告。
  const ready = useMemo(() => [restoreSession], []);
  const sessionStore = useMemo(
    () =>
      createStore<ISession>({
        userId: '',
        setUserId(id) {
          this.userId = id;
        }
      }),
    []
  );

  return (
    <StoreProvider config={{ ready, fallback: <FullPageSpinner /> }}>
      <SessionInjector store={sessionStore}>
        <Suspense fallback={<FullPageSpinner />}>
          <Dashboard />
        </Suspense>
      </SessionInjector>
    </StoreProvider>
  );
}

// 用 register 而非全局单例：不同的 Provider 子树可以注入不同的 session 实例（比如测试）。
function SessionInjector({
  store,
  children
}: {
  store: IReactiveStore<ISession>;
  children: React.ReactNode;
}) {
  const registry = useStoreRegistry();
  useEffect(() => registry.register(sessionToken, store, { owned: false }), [registry, store]);
  return <>{children}</>;
}

function Dashboard() {
  const userId = useProvidedStore(sessionToken, (s) => s.userId);
  const experimentalCharts = useStoreFeature('experimental.charts');
  return (
    <div>
      <p>当前用户：{userId || '未登录'}</p>
      {experimentalCharts ? <ChartsPanel userId={userId} /> : null}
    </div>
  );
}

const profileResources = new Map<string, Resource<{ name: string }>>();
function profileResource(userId: string, runtime: IRuntime): Resource<{ name: string }> {
  let resource = profileResources.get(userId);
  if (!resource) {
    resource = new Resource(
      async ({ signal }) => {
        const res = await fetch(`/api/profile/${userId}`, { signal });
        return res.json() as Promise<{ name: string }>;
      },
      runtime,
      { debugName: `profile:${userId}` }
    );
    profileResources.set(userId, resource);
  }
  return resource;
}

function ChartsPanel({ userId }: { userId: string }) {
  const runtime = useStoreRuntime();
  // profileResource 按 userId 缓存同一个 Resource 实例，避免每次渲染都创建新对象（见 §7.6）。
  const profile = useResourceValue(profileResource(userId, runtime)); // 未就绪时 throw promise，交给外层 Suspense
  return <div>欢迎，{profile.name}</div>;
}

function FullPageSpinner() {
  return <div role="status">加载中…</div>;
}
```

要点对照：

- `ready`/`sessionStore` 都用 `useMemo` 稳住引用，避免命中 §2.3、§7.6 的坑。
- `SessionInjector` 用 `registry.register(token, store, { owned: false })` 注入——`owned: false` 是因为 `sessionStore` 的生命周期由 `App` 组件自己的 `useMemo` 管理，不希望 Provider 卸载时把它一并释放。
- `useProvidedStore` 一步做完"从 Registry 取回 + `useStore` 订阅"。
- `experimental.charts` 需要在更上层的 `StoreProvider` 里显式 `config={{ features: { experimental: { charts: true } } }}` 才会为 `true`；示例里省略了这层配置，实际接入时按需打开。
- `ChartsPanel` 里的 `useResourceValue` 展示的是 Suspense 集成，不是本包创建 `Resource` 的推荐写法——生产代码通常会把 `Resource` 的创建与缓存策略（`ttl`、`autoStart` 等）放进专门的数据层模块。

## 9. 常见问题排查

**Q: 组件树里到处出现 `[store] hook requires a StoreProvider`，但我明明套了 `<StoreProvider>`。**
A: 确认调用 hook 的组件确实在 `<StoreProvider>` 的 `children` 内部渲染，而不是通过 `createPortal` 挂到了 DOM 树的其它位置——React Context 跟的是组件树而不是 DOM 树，这种情况一般没问题；更常见的原因是把 `StoreProvider` 放在了某个条件渲染分支之外，实际渲染路径没有经过它。

**Q: `useStore`/`useAtomValue` 明明数据变了，组件却没有重渲染。**
A: 先确认 `selector`/`read` 里真的读取了发生变化的字段——`useTracked`/`useStore` 只追踪 selector 函数体内**实际访问到**的路径，没有读到的字段变化不会触发重渲染。其次检查是否在 render 之外（比如某个不受追踪的回调里）读取后缓存了值。

**Q: `StoreProvider` 套了 `config.ready`，但页面一直卡在 `fallback` 不消失。**
A: 打开浏览器控制台确认 ready 屏障对应的 Promise 是否真的 resolve；如果它一直 pending（比如接口挂起没返回），`ReadyBoundary` 会一直渲染 `fallback`。如果屏障 reject 了但页面既没有报错也没有渲染子树，检查是否缺少外层 Error Boundary——`ReadyBoundary` 在 reject 时会 `throw`，没有 Error Boundary 捕获时会导致 React 整棵树卸载并在控制台报未捕获错误。

**Q: `useAssertStoreFeature('experimental.xxx')` 一直抛错，我确实在 `StoreProvider` 上配置了这个 feature。**
A: 检查 `config.features.experimental` 里对应 key 的值是否严格是布尔 `true`——`freezeExperimental`/`readStoreFeature` 只认字面 `true`，`'true'`（字符串）、`1`、`undefined` 都会被当作关闭。另外确认调用 `useAssertStoreFeature` 的组件是在**目标** `StoreProvider` 的子树内，而不是外层某个没配置这个 feature 的 Provider 下。

**Q: SSR 场景下每个请求要一份独立状态，`StoreProvider` 够用吗？**
A: `StoreProvider` 是给单次渲染树用的；多请求隔离通常直接用 `createStoreRegistry(createRuntime())` 手动为每个请求建一份 Registry，渲染时通过 `registry` prop 传给 `StoreProvider`（此时 `disposeOnUnmount` 默认为 `false`，请求处理完毕后自己调用 `registry.disposeAsync()`）。具体的 SSR 集成方式请参考 `@migaia/store-ssr` 的文档。

## 10. 构建、格式化与测试

在仓库根目录运行：

```bash
pnpm --filter @migaia/store-react fmt
pnpm --filter @migaia/store-react lint
pnpm --filter @migaia/store-react typecheck
pnpm --filter @migaia/store-react typecheck:test
pnpm --filter @migaia/store-react test
pnpm --filter @migaia/store-react typecheck:e2e
pnpm --filter @migaia/store-react test:e2e
pnpm --filter @migaia/store-react build
```

`test` 覆盖 hook、Provider、Registry 与错误边界；`test:e2e` 用 Playwright 验证真实 React 挂载路径。运行后者前需有 Playwright 浏览器。
