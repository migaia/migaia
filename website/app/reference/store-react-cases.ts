import type { ICaseDoc, IText } from './contract.js'

/** Pairs localized explanations with complete React server-rendering examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Real React 19 SSR paths, without mounted subscription or effect-cleanup claims. */
export const storeReactCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  useStore: [
    {
      title: t(
        'Render a Store projection without a Provider',
        '无需 Provider 生成 Store 投影的服务端 HTML'
      ),
      problem: t(
        'A server response needs a total derived from two Store fields. A later response must read updated values without moving the Store into React context.\n\nCopying fields into view state creates another value to synchronize. A second server render also does not prove a mounted client subscription.\n\nInstall React 19, react-dom, and store-light directly. useStore evaluates the selector; renderToString generates HTML, and a second explicit render reads the changed price.',
        '服务端响应需要根据两个 Store 字段计算总价，后续响应还须读到更新后的值，而不必把 Store 放进 React 上下文。\n\n把字段再复制到视图状态，会增加一份需要同步的值；第二次服务端渲染也不能证明已挂载客户端的订阅行为。\n\n直接安装 React 19、`react-dom` 与 `@migaia/store-light`；`useStore` 执行选择器，`renderToString` 生成 HTML，修改单价后显式再次渲染，读取新值。'
      ),
      example: t(
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createStore } from '@migaia/store-light'\nimport { useStore } from '@migaia/store-react'\n\nconst store = createStore({ price: 3, quantity: 2 })\nfunction Total() {\n  const total = useStore(store, (state) => state.price * state.quantity)\n  return createElement('output', null, String(total))\n}\nconsole.log(renderToString(createElement(Total)))\nstore.price = 4\nconsole.log(renderToString(createElement(Total)))\nawait store.$dispose()",
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createStore } from '@migaia/store-light'\nimport { useStore } from '@migaia/store-react'\n\nconst store = createStore({ price: 3, quantity: 2 })\nfunction Total() {\n  const total = useStore(store, (state) => state.price * state.quantity)\n  return createElement('output', null, String(total))\n}\nconsole.log(renderToString(createElement(Total)))\nstore.price = 4\nconsole.log(renderToString(createElement(Total)))\nawait store.$dispose()"
      ),
      result: t(
        'Prints `<output>6</output>` and `<output>8</output>`. Each explicit server render evaluates the projection from current Store values.\n\nThis proves SSR reads, not mounted subscription updates. Provider is optional for useStore; equality defaults to Object.is and Runtime comes from the Store. The caller disposes the Store after both renders.',
        '逐行输出 `<output>6</output>`、`<output>8</output>`；每次显式服务端渲染都根据当前 Store 值计算投影。\n\n这证明 SSR 读取，不证明挂载后的订阅更新；`useStore` 不要求 Provider，相等比较默认 `Object.is`，运行时取自 Store，两次渲染完成后由调用者释放 Store。'
      )
    }
  ],
  StoreProvider: [
    {
      title: t(
        'Show readiness fallback on the first server render',
        '在首次服务端渲染中显示就绪占位'
      ),
      problem: t(
        'Initialization has fulfilled, but a new Provider still needs to observe its readiness barrier before rendering children. The first server response needs an explicit fallback.\n\nA fulfilled input Promise is not a settled normalized barrier. renderToString neither runs client effects nor waits for them to update the tree.\n\nPass a stable ready list and fallback in StoreProvider.config. Await the input, render with an explicit caller-owned registry, then dispose that registry yourself.',
        '初始化输入已经完成，但新 Provider 仍须观察就绪屏障后才能渲染子树；首次服务端响应需要明确的占位内容。\n\n输入 Promise 已兑现，不等于归一化后的屏障已完成；`renderToString` 不会执行客户端效果，也不等待它们更新子树。\n\n通过 `StoreProvider.config` 传入稳定的 `ready` 列表和 `fallback`；先等待输入，再使用显式调用者拥有的注册表渲染，最后自行释放注册表。'
      ),
      example: t(
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { StoreProvider, createStoreRegistry } from '@migaia/store-react'\n\nconst registry = createStoreRegistry()\nconst ready = [Promise.resolve()]\nawait ready[0]\nlet reads = 0\nfunction Content() {\n  reads += 1\n  return createElement('p', null, 'Content')\n}\ntry {\n  const html = renderToString(createElement(StoreProvider, {\n    registry,\n    config: { ready, fallback: createElement('p', null, 'Waiting for initialization') },\n    children: createElement(Content)\n  }))\n  console.log(html)\n  console.log(reads)\n} finally {\n  await registry.disposeAsync()\n}",
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { StoreProvider, createStoreRegistry } from '@migaia/store-react'\n\nconst registry = createStoreRegistry()\nconst ready = [Promise.resolve()]\nawait ready[0]\nlet reads = 0\nfunction Content() {\n  reads += 1\n  return createElement('p', null, '内容')\n}\ntry {\n  const html = renderToString(createElement(StoreProvider, {\n    registry,\n    config: { ready, fallback: createElement('p', null, '等待初始化') },\n    children: createElement(Content)\n  }))\n  console.log(html)\n  console.log(reads)\n} finally {\n  await registry.disposeAsync()\n}"
      ),
      result: t(
        'Prints `<p>Waiting for initialization</p>` and `0`. The first render shows fallback even with fulfilled input, and Content is not evaluated.\n\nThis SSR run does not prove a later client readiness update. With default WASM-off features, omitted ready means no barrier; fallback defaults to null. An external registry defaults to no disposal on unmount, and SSR runs no unmount cleanup.',
        '逐行输出 `<p>等待初始化</p>`、`0`；即使输入已经兑现，首次渲染仍显示占位，`Content` 没有被求值。\n\n本次 SSR 不证明客户端后续就绪更新；默认未启用 WASM 时，省略 `ready` 无屏障，`fallback` 默认 `null`，外部注册表默认不随卸载释放，SSR 也不会执行卸载清理。'
      )
    }
  ],
  useProvidedStore: [
    {
      title: t(
        'Render the same token from separate request registries',
        '从独立请求注册表读取同一个 token'
      ),
      problem: t(
        'Two server requests render one component and token but hold different counter values. Their responses must not read a shared module-level Store.\n\nA global token-to-Store table exposes the latest registration to both requests. Separate component instances alone do not create separate state owners.\n\nCreate a registry and matching-Runtime Store per request. Register one shared token with owned: true and pass each registry to StoreProvider; useProvidedStore selects the current Provider’s Store.',
        '两个服务端请求渲染同一组件并使用同一 token，却拥有不同计数值；两个响应不能读到同一份模块级 Store。\n\n全局 token 到 Store 的表会让最后一次登记影响所有请求；仅创建不同组件实例，也不能分开底层状态所有者。\n\n每个请求创建一份注册表及同运行时 Store，用 `owned: true` 登记同一个 token，再分别传给 `StoreProvider`；`useProvidedStore` 从当前 Provider 选取 Store。'
      ),
      example: t(
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createStore, type IReactiveStore } from '@migaia/store-light'\nimport { StoreProvider, createStoreRegistry, createStoreToken, useProvidedStore } from '@migaia/store-react'\n\ntype ICounter = { count: number }\nconst token = createStoreToken<IReactiveStore<ICounter>>('counter')\nconst first = createStoreRegistry()\nconst second = createStoreRegistry()\nfirst.register(token, createStore({ count: 1 }, { runtime: first.runtime }), { owned: true })\nsecond.register(token, createStore({ count: 9 }, { runtime: second.runtime }), { owned: true })\nfunction Counter() {\n  return createElement('output', null, String(useProvidedStore(token, (state) => state.count)))\n}\ntry {\n  console.log(renderToString(createElement(StoreProvider, { registry: first, children: createElement(Counter) })))\n  console.log(renderToString(createElement(StoreProvider, { registry: second, children: createElement(Counter) })))\n} finally {\n  await first.disposeAsync()\n  await second.disposeAsync()\n}",
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createStore, type IReactiveStore } from '@migaia/store-light'\nimport { StoreProvider, createStoreRegistry, createStoreToken, useProvidedStore } from '@migaia/store-react'\n\ntype ICounter = { count: number }\nconst token = createStoreToken<IReactiveStore<ICounter>>('counter')\nconst first = createStoreRegistry()\nconst second = createStoreRegistry()\nfirst.register(token, createStore({ count: 1 }, { runtime: first.runtime }), { owned: true })\nsecond.register(token, createStore({ count: 9 }, { runtime: second.runtime }), { owned: true })\nfunction Counter() {\n  return createElement('output', null, String(useProvidedStore(token, (state) => state.count)))\n}\ntry {\n  console.log(renderToString(createElement(StoreProvider, { registry: first, children: createElement(Counter) })))\n  console.log(renderToString(createElement(StoreProvider, { registry: second, children: createElement(Counter) })))\n} finally {\n  await first.disposeAsync()\n  await second.disposeAsync()\n}"
      ),
      result: t(
        'Prints `<output>1</output>` and `<output>9</output>`. One token resolves to different registered Stores in the two server trees.\n\nThis proves explicit SSR scope isolation, not automatic request management. Registration owned defaults to false; true lets registry.disposeAsync await Store cleanup. Registered reactive values must match the registry Runtime.',
        '逐行输出 `<output>1</output>`、`<output>9</output>`；同一个 token 在两棵服务端树中分别解析到不同 Store。\n\n这证明显式 SSR 作用域隔离，不是自动管理请求；登记的 `owned` 默认 `false`，设为 `true` 后由 `registry.disposeAsync` 等待 Store 清理，已声明运行时的响应式值必须与注册表匹配。'
      )
    },
    {
      title: t(
        'Distinguish a missing Provider from an unregistered token',
        '区分缺少 Provider 与 token 未登记'
      ),
      problem: t(
        'A server component cannot find its Store. The caller needs to distinguish a missing Provider boundary from an omitted registration in that request.\n\nA silent global fallback hides configuration errors and may expose another request’s data. Returning undefined instead delays failure until a later field read.\n\nuseProvidedStore first requires a Provider, then requires the token in that registry. Render both invalid trees with real React and inspect their distinct public error codes.',
        '服务端组件找不到 Store 时，调用者需要区分是整层 Provider 缺失，还是当前请求忘记登记 token。\n\n静默回退到全局 Store 会掩盖配置错误，还可能暴露其他请求的数据；只返回 `undefined`，又会把错误推迟到后续字段读取。\n\n`useProvidedStore` 先要求存在 Provider，再要求 token 已登记到该注册表；通过真实 React 分别渲染两种错误树，读取不同公开错误码。'
      ),
      example: t(
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport type { IReactiveStore } from '@migaia/store-light'\nimport { StoreProvider, createStoreRegistry, createStoreToken, useProvidedStore } from '@migaia/store-react'\n\ntype ICounter = { count: number }\nconst token = createStoreToken<IReactiveStore<ICounter>>('counter')\nconst registry = createStoreRegistry()\nfunction Counter() {\n  return createElement('output', null, String(useProvidedStore(token, (state) => state.count)))\n}\ntry {\n  try {\n    renderToString(createElement(Counter))\n  } catch (error) {\n    if (!(error instanceof Error) || !('code' in error)) throw error\n    console.log(error.code)\n  }\n  try {\n    renderToString(createElement(StoreProvider, { registry, children: createElement(Counter) }))\n  } catch (error) {\n    if (!(error instanceof Error) || !('code' in error)) throw error\n    console.log(error.code)\n  }\n} finally {\n  await registry.disposeAsync()\n}",
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport type { IReactiveStore } from '@migaia/store-light'\nimport { StoreProvider, createStoreRegistry, createStoreToken, useProvidedStore } from '@migaia/store-react'\n\ntype ICounter = { count: number }\nconst token = createStoreToken<IReactiveStore<ICounter>>('counter')\nconst registry = createStoreRegistry()\nfunction Counter() {\n  return createElement('output', null, String(useProvidedStore(token, (state) => state.count)))\n}\ntry {\n  try {\n    renderToString(createElement(Counter))\n  } catch (error) {\n    if (!(error instanceof Error) || !('code' in error)) throw error\n    console.log(error.code)\n  }\n  try {\n    renderToString(createElement(StoreProvider, { registry, children: createElement(Counter) }))\n  } catch (error) {\n    if (!(error instanceof Error) || !('code' in error)) throw error\n    console.log(error.code)\n  }\n} finally {\n  await registry.disposeAsync()\n}"
      ),
      result: t(
        'Prints `PROVIDER_REQUIRED` and `STORE_MISSING`. The first tree has no Provider; the second has a valid empty registry without the requested registration.\n\nBoth fail during server rendering. Tokens are identity keys, not their debug-name strings; registration and reading must use the same token. This example does not demonstrate a client Error Boundary.',
        '逐行输出 `PROVIDER_REQUIRED`、`STORE_MISSING`；第一棵树没有 Provider，第二棵树拥有合法空注册表，却没有所需登记。\n\n两者都在服务端渲染期间失败；token 按身份区分，不按诊断名称字符串匹配，登记与读取须使用同一 token，本例不演示客户端错误边界。'
      )
    }
  ],
  useAtomDefinition: [
    {
      title: t(
        'Keep one atom definition local to each registry',
        '让同一个 atom 定义的状态归各注册表所有'
      ),
      problem: t(
        'Two panels share one reactive Runtime and atom definition. Each Provider registry still needs its own current value.\n\nCaching atom state only by Runtime merges independent panels into one state owner. Reusing a definition should share its description, not every Provider’s value.\n\nInstall reactive and store-keyed directly. Create two registries on one Runtime, set the definition in each registry.atomStore, and render useAtomDefinition under the matching Provider.',
        '两个独立面板共用一个响应式运行时与同一 atom 定义，但当前值仍应归各自 Provider 注册表所有。\n\n仅按运行时缓存 atom 状态，会把独立面板合并到同一状态所有者；复用定义应该共享描述，而不是共享所有 Provider 的值。\n\n直接安装 `@migaia/reactive` 与 `@migaia/store-keyed`；在同一运行时创建两份注册表，分别通过 `registry.atomStore` 设置定义，再在对应 Provider 下渲染 `useAtomDefinition`。'
      ),
      example: t(
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createRuntime } from '@migaia/reactive'\nimport { atomDef } from '@migaia/store-keyed/atom/definition'\nimport { StoreProvider, createStoreRegistry, useAtomDefinition } from '@migaia/store-react'\n\nconst runtime = createRuntime()\nconst definition = atomDef(0)\nconst first = createStoreRegistry(runtime)\nconst second = createStoreRegistry(runtime)\nfirst.atomStore.set(definition, 5)\nsecond.atomStore.set(definition, 8)\nfunction Counter() {\n  return createElement('output', null, String(useAtomDefinition(definition)))\n}\ntry {\n  console.log(first.runtime === second.runtime)\n  console.log(renderToString(createElement(StoreProvider, { registry: first, children: createElement(Counter) })))\n  console.log(renderToString(createElement(StoreProvider, { registry: second, children: createElement(Counter) })))\n} finally {\n  await first.disposeAsync()\n  await second.disposeAsync()\n}",
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createRuntime } from '@migaia/reactive'\nimport { atomDef } from '@migaia/store-keyed/atom/definition'\nimport { StoreProvider, createStoreRegistry, useAtomDefinition } from '@migaia/store-react'\n\nconst runtime = createRuntime()\nconst definition = atomDef(0)\nconst first = createStoreRegistry(runtime)\nconst second = createStoreRegistry(runtime)\nfirst.atomStore.set(definition, 5)\nsecond.atomStore.set(definition, 8)\nfunction Counter() {\n  return createElement('output', null, String(useAtomDefinition(definition)))\n}\ntry {\n  console.log(first.runtime === second.runtime)\n  console.log(renderToString(createElement(StoreProvider, { registry: first, children: createElement(Counter) })))\n  console.log(renderToString(createElement(StoreProvider, { registry: second, children: createElement(Counter) })))\n} finally {\n  await first.disposeAsync()\n  await second.disposeAsync()\n}"
      ),
      result: t(
        'Prints `true`, `<output>5</output>`, and `<output>8</output>`. One Runtime is shared, while the same atom definition reads different scoped values.\n\nThis proves SSR reads from each registry’s atomStore, not mounted rerenders. useAtomDefinition requires a Provider; atomDef starts at the supplied 0. Explicitly disposing each registry leaves the borrowed Runtime alone.',
        '逐行输出 `true`、`<output>5</output>`、`<output>8</output>`；两份注册表共用运行时，同一个 atom 定义仍分别读到各自作用域中的值。\n\n这证明 SSR 从各自 `atomStore` 读取，不证明挂载后的重渲染；`useAtomDefinition` 要求 Provider，`atomDef` 从传入的 `0` 开始，显式释放注册表不影响借用的运行时。'
      )
    }
  ],
  useResourceValue: [
    {
      title: t(
        'Render a preloaded Resource without creating another request',
        '读取已加载 Resource 而不另发请求'
      ),
      problem: t(
        'A server loader already owns a fetched profile. Several explicit HTML renders need that result without creating another Resource and request for each tree.\n\nCreating another Resource on each render duplicates ownership and may send another request. Reading while pending also needs an SSR Suspense strategy.\n\nInstall reactive and resource directly. Create one Resource outside React, await its promise, read it with useResourceValue in two server renders, then dispose it.',
        '服务端加载流程已经拥有用户资料，多次显式 HTML 渲染需要复用结果，而不是为每棵树再创建 Resource 和请求。\n\n每次渲染都构造 Resource 会重复建立所有者，还可能启动更多请求；等待中的 Resource 也不能在 `renderToString` 中当作普通值读取。\n\n直接安装 `@migaia/reactive` 与 `@migaia/resource`；在 React 外创建一个 Resource，等待其 `promise`，再用 `useResourceValue` 进行两次服务端渲染，最后释放它。'
      ),
      example: t(
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createRuntime } from '@migaia/reactive'\nimport { Resource } from '@migaia/resource'\nimport { useResourceValue } from '@migaia/store-react'\n\nlet requests = 0\nconst resource = new Resource(async () => {\n  requests += 1\n  return { name: 'Ada' }\n}, createRuntime())\nawait resource.promise\nfunction Profile() {\n  return createElement('p', null, useResourceValue(resource).name)\n}\ntry {\n  console.log(renderToString(createElement(Profile)))\n  console.log(renderToString(createElement(Profile)))\n  console.log(requests)\n} finally {\n  resource.dispose()\n}",
        "import { createElement } from 'react'\nimport { renderToString } from 'react-dom/server'\nimport { createRuntime } from '@migaia/reactive'\nimport { Resource } from '@migaia/resource'\nimport { useResourceValue } from '@migaia/store-react'\n\nlet requests = 0\nconst resource = new Resource(async () => {\n  requests += 1\n  return { name: '艾达' }\n}, createRuntime())\nawait resource.promise\nfunction Profile() {\n  return createElement('p', null, useResourceValue(resource).name)\n}\ntry {\n  console.log(renderToString(createElement(Profile)))\n  console.log(renderToString(createElement(Profile)))\n  console.log(requests)\n} finally {\n  resource.dispose()\n}"
      ),
      result: t(
        'Prints `<p>Ada</p>` twice, then `1`. Both server renders read the preloaded Resource, and the fetcher runs once.\n\nThis proves cached SSR reads, not client subscriptions. Resource defaults autoStart to true and ttl to Infinity. useResourceValue throws its Promise for idle/pending or its stored error for error/cancelled; pending SSR needs a suitable Suspense strategy.',
        '先输出两次 `<p>艾达</p>`，再输出 `1`；两次服务端渲染读取同一已加载 Resource，加载函数只执行一次。\n\n这证明缓存 SSR 读取，不证明客户端订阅；Resource 的 `autoStart` 默认 `true`、`ttl` 默认 `Infinity`，空闲或等待时 hook 抛 Promise，错误或取消时抛存储的错误，等待中的 SSR 需要匹配的 Suspense 方案。'
      )
    }
  ]
}
