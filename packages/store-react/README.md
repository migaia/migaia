# `@migaia/store-react`

把 `@migaia/store-light`（甜 API Store）、`@migaia/store-keyed`（Atom 定义系统）、`@migaia/resource`（可取消异步值）接到 React 组件树上的驱动程序：一组基于 `useSyncExternalStore` 的 hook，外加一个负责作用域/生命周期/就绪时机的 `StoreProvider`。这几个底层包本身完全不认识 React；本包只做"接线"，不重新定义状态模型。

## 适用与不适用场景

**适用**：已经在用 `@migaia/store-light` 的 Store、`@migaia/store-keyed` 的 Atom，或 `@migaia/resource` 的 `Resource`，要在 React 里渲染它们；需要按 Provider/请求作用域隔离状态（SSR 每请求一份、多棵独立子树互不干扰）；需要在渲染子树前挡住一个异步初始化（比如等 wasm 模块 ready）。

**不适用**：不要把它当 Redux/Zustand 那种"全局单一 store + reducer"框架——这里的 Store 是可任意拆分的对象字面量甜 API；也不要指望它能让"读到共享变量但从不检查 signal/依赖"的代码自动响应式化，本包只负责把 `@migaia/reactive` 的依赖图接到 React 的订阅模型上。

## 安装

```bash
pnpm add @migaia/store-react react react-dom
```

`react`/`react-dom` 是 peer dependency（`>=18`）。本包依赖 `@migaia/store-light`（`createStore` 产出的 Store 靠 `$runtime`/`$async`/`$snapshot()`/`$batch()` 这几个元字段与 `storeReady()` 对接，见源码 `reactive-store.ts`）、`@migaia/store-keyed`（Atom 定义/AtomStore 协议）、`@migaia/resource`（`Resource`）、`@migaia/reactive`（响应式图）、`@migaia/lifecycle`、`@migaia/utils`；这些包按需装即可，不是全部都要在业务代码里直接 import。产物是纯 ESM，`package.json` 当前只公开根入口，所有 API 都从 `@migaia/store-react` 导入（没有子路径）。

## 目录

- [StoreProvider](#storeprovider)
- [核心订阅 hook](#核心订阅-hook)：`useStore` / `useSignal` / `useTracked` / `useNodeValue`
- [异步值 hook](#异步值-hook)：`useResource` / `useResourceValue` / `useStoreResource` / `useAsyncAtomValue`
- [Atom hook](#atom-hook)：`useAtomValue` / `useSetAtom` / `useAtom` / `useAtomDefinition` / `useSetAtomDefinition`
- [依赖注入：StoreToken / StoreRegistry](#依赖注入storetoken--storeregistry)
- [Config / Feature flag](#config--feature-flag)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为、错误码与生命周期细节，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="storeprovider"></a>

## StoreProvider

```tsx
import { StoreProvider, useStore } from '@migaia/store-react';
import { createStore } from '@migaia/store-light';
```

**`StoreProvider`｜5 秒上手** —— 给子树建立 Registry/Runtime 作用域；只用 `useStore`/`useSignal` 读取模块级单例时理论上可以不套它，但项目里建议根部始终套一层：

```tsx
const counterStore = createStore({
  count: 0,
  increment() {
    this.count += 1;
  }
});

function Counter() {
  const count = useStore(counterStore, (state) => state.count);
  return <button onClick={() => counterStore.increment()}>count: {count}</button>;
}

function App() {
  return (
    <StoreProvider>
      <Counter />
    </StoreProvider>
  );
}
```

全部 props（`IStoreProviderProps`）：

- `children: ReactNode`（必填）
- `registry?: StoreRegistry` —— 不传则内部自建；传了默认不由 Provider 释放（见下）
- `runtime?: IRuntime` —— 不传则内部 `createRuntime()`；无论谁创建 Registry，`runtime` 本身的生命周期永远由调用方负责，Provider 从不释放它
- `disposeOnUnmount?: boolean` —— 都不传 `registry`/`runtime` 时默认 `true`（自建自释放）；只传 `registry` 时默认 `false`（外部对象默认外部拥有）
- `config?: IStoreProviderConfig` —— `{ features？, ready？, fallback？, defaults？ }`，见下方 [Config / Feature flag](#config--feature-flag)

同时传 `registry` 与 `runtime` 且 `registry.runtime !== runtime` 会立刻抛错；完整所有权规则、`config.ready` 的身份锁定语义、StrictMode 下的候选 Registry 回收机制，见 USEGUIDE §2、§6。

---

<a id="核心订阅-hook"></a>

## 核心订阅 hook

```tsx
import { useStore, useSignal, useTracked, useNodeValue } from '@migaia/store-react';
```

**`useStore(store, selector, isEqual?)`｜5 秒上手** —— 订阅 `@migaia/store-light` Store 的一个 selector，只在读到的字段变化时重渲染：

```tsx
const count = useStore(counterStore, (state) => state.count);
```

全部参数：`store: IReactiveStore<S>`（必填）、`selector: (state: IStoreShape<S>) => R`（必填，引用应稳定）、`isEqual?: (a: R, b: R) => boolean`（默认 `Object.is`）。不需要 `StoreProvider`；`store.$async === true` 时会先 `use(storeReady(store))`，组件在 Store 就绪前 Suspend。

**`useSignal(signal)`｜3 秒上手** —— 订阅单个 `ISignal`，返回 `[值, 设置函数]`：

```tsx
const [name, setName] = useSignal(nameSignal);
```

单参数 `signal: ISignal<T>`（必填），无其他选项；依赖集合恒为该 Signal 自己，走比 `useTracked` 更轻的直连路径。

**`useTracked(read, isEqual?, runtime?)`｜10 秒上手** —— 最底层的通用订阅 hook，`read()` 内访问到的任意响应式节点都会被自动追踪为依赖；`useStore`/`useResource` 都是它的薄封装：

```tsx
const total = useTracked(() => priceSignal.value + taxSignal.value);
```

全部参数：`read: () => T`（必填，引用应稳定）、`isEqual?: (a: T, b: T) => boolean`（默认 `Object.is`）、`runtime?: IRuntime`（默认 `defaultRuntime`）。

**`useNodeValue(node, runtime, enabled?)`｜5 秒上手** —— 最底层的稳定节点订阅，适用于依赖集合恒为"这一个节点自己"的场景：

```tsx
const value = useNodeValue(mySignal, runtime);
```

全部参数：`node: IStableNode<T>`（必填，形状 `{ value: T; peek(): T }`）、`runtime: IRuntime`（必填）、`enabled?: boolean`（默认 `true`，`false` 时订阅是空操作）；`node` 不属于传入的 `runtime` 会在 render 阶段同步抛错（可被 Error Boundary 捕获）。

---

<a id="异步值-hook"></a>

## 异步值 hook

```tsx
import {
  useResource,
  useResourceValue,
  useStoreResource,
  useAsyncAtomValue
} from '@migaia/store-react';
```

**`useResource(resource)` / `useResourceValue(resource)`｜10 秒上手** —— 订阅 `@migaia/resource` 的 `Resource<T>`；前者拿完整状态机，后者是 Suspense-safe 的取值版本：

```tsx
const state = useResource(profileResource); // { status: 'idle'|'pending'|'success'|'error'|'cancelled', ... }
const profile = useResourceValue(profileResource); // 成功返回 data；pending/idle 时 throw promise；error/cancelled 时 throw error
```

均为单参数 `resource: Resource<T>`（必填），无可选项；`resource.runtime` 决定追踪用的 Runtime。

**`useStoreResource(resource)`｜5 秒上手** —— 订阅 `@migaia/store-light` Store 内部声明的异步字段（`IStoreResource<T>`），带渲染期版本租约，StrictMode 下不会提前释放正在用的资源：

```tsx
const value = useStoreResource(store.someAsyncField);
```

单参数 `resource: IStoreResource<T>`（必填），无可选项。与 `Resource<T>` 是两套不同协议，不能互换，见 USEGUIDE §1.4。

**`useAsyncAtomValue(atom)`｜3 秒上手** —— 给形如 `{ resource: Resource<T> }` 的异步 atom 提供 Suspense-safe 取值：

```tsx
const value = useAsyncAtomValue(asyncAtom); // 内部即 useResourceValue(atom.resource)
```

单参数 `atom: { readonly resource: Resource<T> }`（必填），无可选项。

---

<a id="atom-hook"></a>

## Atom hook

```tsx
import {
  useAtomValue,
  useSetAtom,
  useAtom,
  useAtomDefinition,
  useSetAtomDefinition
} from '@migaia/store-react';
```

**`useAtomValue(atom)` / `useSetAtom(atom)` / `useAtom(atom)`｜10 秒上手** —— 协议 hook：只要求对象实现 `IReadableAtom`/`IWritableAtom`（`@migaia/store-keyed/reactive/atom`），Provider 可选：

```tsx
const value = useAtomValue(myAtom);
const write = useSetAtom(myWritableAtom);
const [value2, write2] = useAtom(myWritableAtom);
```

全部参数：`atom: IReadableAtom<T>` 或 `IWritableAtom<T, Args, Result>`（必填），无其他选项。有 `StoreProvider` 且 `atom.atomDefinition` 存在时读写路由到 `registry.atomStore`；否则直接订阅/写入 atom 节点本身。`useAtom` 就是 `[useAtomValue(atom), useSetAtom(atom)]`。

**`useAtomDefinition(definition)` / `useSetAtomDefinition(definition)`｜10 秒上手** —— **必须有 `StoreProvider`**，固定读写 `registry.atomStore`，配合 `atomDef`/`derivedDef`/`writableDef`/`familyDef`（`@migaia/store-keyed`）产出的定义使用：

```tsx
const value = useAtomDefinition(countDef);
const increment = useSetAtomDefinition(incrementDef);
```

全部参数：`definition: IAtomDefinition<T>` 或 `IWritableAtomDefinition<T, Args, Result>`（必填），无其他选项。无 Provider 时抛 `[store] hook requires a StoreProvider`。

---

<a id="依赖注入storetoken--storeregistry"></a>

## 依赖注入：StoreToken / StoreRegistry

```tsx
import {
  createStoreToken,
  StoreRegistry,
  createStoreRegistry,
  useStoreRegistry,
  useStoreRuntime,
  useStoreFromProvider,
  useProvidedStore
} from '@migaia/store-react';
```

**`createStoreToken(debugName)`｜3 秒上手** —— 定义一把带类型参数的 key（内部是 `Symbol`）：

```tsx
const sessionToken = createStoreToken<IReactiveStore<ISession>>('session');
```

单参数 `debugName: string`（必填，非空——空字符串抛 `[store] StoreToken requires a debug name`），同时作为报错信息里的可读定位名。

**`useStoreFromProvider(token)` / `useProvidedStore(token, selector, isEqual?)`｜10 秒上手** —— 按 token 从当前 Provider 的 Registry 取回注册实例；后者额外做一次 `useStore` 订阅：

```tsx
const sessionStore = useStoreFromProvider(sessionToken);
const userId = useProvidedStore(sessionToken, (s) => s.userId);
```

`useStoreFromProvider` 单参数 `token: StoreToken<T>`（必填），未注册抛 `[store] missing provider store: X`。`useProvidedStore` 额外参数 `selector: (state: IStoreShape<S>) => Result`（必填）、`isEqual?`（默认 `Object.is`）。均**必须有 Provider**。

**`useStoreRegistry()` / `useStoreRuntime()`｜3 秒上手** —— 取当前 Provider 的 Registry / 其所属 Runtime，均**必须有 Provider**（否则抛 `[store] hook requires a StoreProvider`），无参数：

```tsx
const registry = useStoreRegistry();
const runtime = useStoreRuntime(); // = useStoreRegistry().runtime
```

**`StoreRegistry` / `createStoreRegistry(runtime?)`｜10 秒上手** —— 手动构造作用域化容器，常见于 SSR 每请求一份、或测试：

```tsx
const registry = createStoreRegistry(); // runtime 不传则内部 createRuntime()
const unregister = registry.register(sessionToken, sessionStore, { owned: true });
registry.dispose(); // 同步、幂等；owned 实体按注册顺序的逆序释放
```

`createStoreRegistry` 单参数 `runtime?: IRuntime`（默认新建）。`StoreRegistry` 实例方法：`register(token, value, { owned? })`（同 token 重复注册抛错，`owned: true` 时 Registry 释放会调用其 `$dispose()`/`dispose()`）、`replace(token, value, options?)`（无重复检查，直接覆盖）、`get`/`require`/`has`（查询）、`remove(token, disposeOwned = true)`、`dispose()`（同步）、`disposeAsync()`（异步、单飞）、只读 `runtime`/`atomStore`/`lifecycle`/`disposed`、`whenTerminal()`。跨 Runtime 注册会抛 `[store] provider store "X" belongs to a different Runtime`。完整生命周期语义见 USEGUIDE §4、§6。

---

<a id="config--feature-flag"></a>

## Config / Feature flag

```tsx
import {
  useStoreConfig,
  useStoreFeature,
  useAssertStoreFeature,
  StoreProviderState
} from '@migaia/store-react';
```

**`useStoreConfig()`｜3 秒上手** —— 取归一化后的完整配置快照：

```tsx
const config = useStoreConfig(); // 无 Provider 时返回 null
```

无参数。

**`useStoreFeature(path)` / `useAssertStoreFeature(path, apiName?)`｜5 秒上手** —— 查询/断言某个 feature 是否开启，用于给实验性 API 设置入口守卫：

```tsx
if (useStoreFeature('experimental.charts')) {
  /* 渲染实验特性 */
}
useAssertStoreFeature('wasm', 'myWasmApi'); // 未开启（含无 Provider）直接抛错
```

`path: 'wasm' | \`experimental.${string}\`` 是两者共同的必填参数；`useAssertStoreFeature`额外的`apiName?: string`（默认 `'this API'`）出现在错误信息里。`useStoreFeature`无 Provider 时返回`false`，不抛；`useAssertStoreFeature`未开启（含无 Provider）一律抛`Error`。这两个都要通过 `StoreProvider`的`config.features.wasm`/`config.features.experimental`显式开启才算生效（只认字面`true`）。

**`StoreProviderState`｜3 秒上手** —— 就绪屏障三态的稳定取值集合，常量对象，无调用参数：

```tsx
StoreProviderState.pending; // 'pending' | 'ready' | 'error' 之一
```

业务代码一般不需要直接用它，除非要复刻类似的三态就绪追踪逻辑。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. StoreProvider + 就绪屏障 + StoreToken 注入 + Suspense 异步读取

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
import { Resource } from '@migaia/resource';

const sessionToken = createStoreToken('session');

function App() {
  const ready = useMemo(() => [() => Promise.resolve()], []); // 引用必须稳定
  const sessionStore = useMemo(() => createStore({ userId: '' }), []);

  return (
    <StoreProvider config={{ ready, fallback: <div>加载中…</div> }}>
      <SessionInjector store={sessionStore}>
        <Suspense fallback={<div>加载中…</div>}>
          <Dashboard />
        </Suspense>
      </SessionInjector>
    </StoreProvider>
  );
}

function SessionInjector({ store, children }) {
  const registry = useStoreRegistry();
  useEffect(() => registry.register(sessionToken, store, { owned: false }), [registry, store]);
  return children;
}

function Dashboard() {
  const userId = useProvidedStore(sessionToken, (s) => s.userId);
  const runtime = useStoreRuntime();
  const showCharts = useStoreFeature('experimental.charts');
  const profile = useResourceValue(new Resource(async () => ({ name: userId }), runtime));
  return (
    <p>
      {profile.name}
      {showCharts ? ' · 图表已开启' : ''}
    </p>
  );
}
```

### 2. useTracked 手写跨节点组合读取（不经过 Store）

```tsx
import { useTracked } from '@migaia/store-react';
import { Signal } from '@migaia/reactive';

const priceSignal = new Signal(10);
const qtySignal = new Signal(2);

function Total() {
  const total = useTracked(() => priceSignal.value * qtySignal.value);
  return <span>合计：{total}</span>;
}
```

### 3. AtomStore + useAtomDefinition 精细订阅

```tsx
import { StoreProvider, useAtomDefinition, useSetAtomDefinition } from '@migaia/store-react';
import { atomDef, writableDef } from '@migaia/store-keyed/atom/definition';

const countDef = atomDef(0);
const incrementDef = writableDef(
  (get) => get(countDef),
  (get, set) => set(countDef, get(countDef) + 1)
);

function Counter() {
  const count = useAtomDefinition(countDef);
  const increment = useSetAtomDefinition(incrementDef);
  return <button onClick={() => increment()}>count: {count}</button>;
}

function App() {
  return (
    <StoreProvider>
      <Counter />
    </StoreProvider>
  );
}
```

### 4. SSR 请求作用域：手动 Registry + StoreProvider 接管

```tsx
import { StoreProvider, createStoreRegistry } from '@migaia/store-react';
import { createRuntime } from '@migaia/reactive';

async function renderForRequest(children: React.ReactNode) {
  const registry = createStoreRegistry(createRuntime()); // 每个请求独立一份
  const html = renderToString(<StoreProvider registry={registry}>{children}</StoreProvider>); // disposeOnUnmount 默认 false：手动负责释放
  await registry.disposeAsync();
  return html;
}
```

---

<a id="构建门禁"></a>

## 构建门禁

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
