/**
 * Reference documentation of `@migaia/micro-hub`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/micro-hub/src` (hub.ts, contract.ts, types.ts, driver.ts, errors.ts,
 * error-code.ts, error-text.ts, text.ts and the events, state, persist, resource and web-component
 * entries), README and USEGUIDE on 2026-10-21.
 */
import type { ICode, IGrantDoc, ILibraryReference, IMemberDoc, IText } from './contract.js'
import { microHubCases } from './micro-hub-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Contract shared by most examples: a cart owned by one app and written by another. */
const cartContract = `import { defineContract, event, keyed, request } from '@migaia/micro-hub'

type ICartItem = { id: string; price: number }

export const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly ICartItem[], byId: keyed<ICartItem>() },
  computed: { total: (s) => s.items.reduce((sum, item) => sum + item.price, 0) },
  commands: {
    add: (s, item: ICartItem) => ({ items: [...s.items, item], byId: { [item.id]: item } })
  },
  writers: ['product'],
  events: { checkedOut: event<{ orderId: string }>() },
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() }
})`

/** Shell setup shared by hub examples. */
const shellSetup = `import { createMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'

createMicroHub({ plugins: [events(), state()] })`

/** Full flow: shell creates the hub, the owner claims the contract, a consumer uses it. */
const hubFlowExample: ICode = {
  en: `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'
import { cart } from 'cart/contract'

// Shell: create the single hub of the page
createMicroHub({ plugins: [events(), state()] })

// Cart app: owns the contract and answers checkout requests
const owner = getMicroHub().connect('cart')
const owned = owner.own(cart)
owned.handle('checkout', async () => ({ orderId: await submitOrder(owned.state.items.get()) }))

// Product app: writes through a command and reads the computed total
const product = getMicroHub().connect('product')
const view = product.use(cart)
view.commands.add({ id: 'sku-1', price: 42 })
const stop = view.computed.total.subscribe(() => render(view.computed.total.get()))

// Unmount the product app: every subscription it registered is released
stop()
await product.disconnect()`,
  zh: `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'
import { cart } from 'cart/contract'

// 主应用：创建整页唯一的 hub
createMicroHub({ plugins: [events(), state()] })

// 购物车应用：认领契约，并应答结账请求
const owner = getMicroHub().connect('cart')
const owned = owner.own(cart)
owned.handle('checkout', async () => ({ orderId: await submitOrder(owned.state.items.get()) }))

// 商品应用：通过命令写入，读取计算值
const product = getMicroHub().connect('product')
const view = product.use(cart)
view.commands.add({ id: 'sku-1', price: 42 })
const stop = view.computed.total.subscribe(() => render(view.computed.total.get()))

// 卸载商品应用：它登记的所有订阅都会被释放
stop()
await product.disconnect()`
}

/** Consumer view example: state, computed, commands, events, requests and select. */
const viewExample = `const view = getMicroHub().connect('product').use(cart)
view.commands.add({ id: 'sku-1', price: 42 })
const stopTotal = view.computed.total.subscribe(() => render(view.computed.total.get()))
const count = view.select((s) => s.items.length)
const stopCount = count.subscribe(() => renderBadge(count.get()))
view.events.checkedOut.on(({ orderId }) => toast(orderId))
const { orderId } = await view.requests.checkout({}, { waitForOwner: 3000 })
stopTotal()
stopCount()`

/** Owner example: own, emit, handle, release. */
const ownerExample = `const app = getMicroHub().connect('cart')
const owned = app.own(cart)
const unhandle = owned.handle('checkout', async ({ coupon }) => {
  const orderId = await submitOrder(owned.state.items.get(), coupon)
  owned.events.checkedOut.emit({ orderId })
  return { orderId }
})
unhandle()
owned.release()`

/** Readable example used by `IReadable` and framework bindings. */
const readableExample = `// React
const total = useSyncExternalStore(view.computed.total.subscribe, view.computed.total.get)

// Vue
const totalRef = shallowRef(view.computed.total.get())
onScopeDispose(view.computed.total.subscribe(() => (totalRef.value = view.computed.total.get())))`

/** Persist plugin example: shell installs it, the owner opts fields in. */
const persistExample = `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { persist } from '@migaia/micro-hub/persist'
import { state } from '@migaia/micro-hub/state'
import { localStorageHost } from '@migaia/storage-web/local-storage'

createMicroHub({
  plugins: [state(), persist({ store: localStorageHost({ namespace: 'shop' }), debounceMs: 200 })]
})
const owned = getMicroHub().connect('cart').own(cart, { persist: ['items'] })
await owned.persistence?.ready`

/** Resource plugin example: the owner provides a fetcher, any app reads it. */
const resourceExample = `import { createMicroHub, defineContract, getMicroHub, resource } from '@migaia/micro-hub'
import { resources } from '@migaia/micro-hub/resource'

const session = defineContract('session', { version: 1, resources: { profile: resource<IUser>() } })
createMicroHub({ plugins: [resources()] })

const owned = getMicroHub().connect('account').own(session)
owned.provide('profile', (signal) => fetch('/api/me', { signal }).then((r) => r.json()))

const view = getMicroHub().connect('header').use(session)
const user = await view.resources.profile.read()`

/** Web Components example: the shell provides, a custom element consumes. */
const webComponentExample = `import { consumeMicroApp, provideMicroApp } from '@migaia/micro-hub/web-component'

const stopProviding = provideMicroApp(document.querySelector('#checkout-slot')!, app)

class CheckoutElement extends HTMLElement {
  #cancel?: () => void
  connectedCallback() {
    this.#cancel = consumeMicroApp(this, (app) => this.render(app.use(cart)))
  }
  disconnectedCallback() {
    this.#cancel?.()
  }
}`

/** Error branching example shared by error symbols. */
const errorExample = `try {
  getMicroHub().connect('product').use(cart).commands.add(item)
} catch (error) {
  const failure = error as { source?: string; code?: string }
  if (failure.source === MICRO_HUB_SOURCE && failure.code === MicroHubErrorCode.writeDenied) {
    showReadOnlyNotice()
  }
}`

/** Summary of a `subscribe(listener)` member shared by readable surfaces. */
const subscribeMember: IMemberDoc = {
  summary: t(
    'Calls `listener` after every later commit that changes this value. The listener gets no argument; inside it `get()` already returns the new value. Registration is tied to the app: it is released when the app disconnects.',
    '之后每次提交改变这个值时调用 `listener`。回调不带参数，回调里调用 `get()` 已经拿到新值。登记归属于当前应用，应用断开时自动释放。'
  ),
  params: {
    listener: t(
      'Function called with no argument after each change; errors it throws go to the hub `report` and do not stop other listeners.',
      '每次变化后无参数调用的函数；它抛出的错误交给 hub 的 `report`，不会打断其它回调。'
    )
  },
  returns: t(
    'A function that unsubscribes; calling it again does nothing.',
    '取消订阅的函数；重复调用没有副作用。'
  ),
  example: `const stop = view.state.items.subscribe(() => render(view.state.items.get()))
stop()`
}

/** `get()` member shared by readable surfaces. */
const getMember: IMemberDoc = {
  summary: t(
    'Returns the current committed value. The same reference is returned until the next commit changes it, so `===` is a valid change check.',
    '返回当前已提交的值。下一次提交改变它之前一直返回同一个引用，因此可以用 `===` 判断是否变化。'
  ),
  returns: t(
    'The committed value. Throws `APP_DISCONNECTED` after the app has disconnected.',
    '已提交的值。应用断开后调用抛 `APP_DISCONNECTED`。'
  ),
  example: `const items = view.state.items.get()`
}

/** Docs of the view members shared by `IContractView` and `IOwnedContract`. */
const viewMembers: Readonly<Record<string, IMemberDoc>> = {
  contract: {
    summary: t(
      'The contract this view was created from, as passed to `use()` or `own()`.',
      '创建这个视图时传给 `use()` 或 `own()` 的契约对象。'
    )
  },
  state: {
    summary: t(
      'One `IReadable` per plain state field and one `IKeyedReadable` per `keyed()` field. Each field is subscribed independently, so writing one field does not notify subscribers of another.',
      '每个普通状态字段对应一个 `IReadable`，每个 `keyed()` 字段对应一个 `IKeyedReadable`。各字段单独订阅，写入一个字段不会通知其它字段的订阅者。'
    )
  },
  computed: {
    summary: t(
      'One `IReadable` per computed value of the contract. A computed value is recalculated only when a field it actually read changes.',
      '契约中每个计算值对应一个 `IReadable`。只有它实际读取过的字段变化时才重新计算。'
    )
  },
  commands: {
    summary: t(
      'One function per contract command, called without the leading state argument. Each call commits its patch synchronously and returns `{ revision }`. Throws `WRITE_DENIED` when the app is neither the owner nor listed in `writers`, `COMMAND_ASYNC` when the command returns a thenable, and `INVALID_OPTION` for a patch field the contract does not declare; in every failure nothing is written.',
      '契约中每个命令对应一个函数，调用时不传开头的状态参数。每次调用同步提交补丁并返回 `{ revision }`。应用既不是 owner 也不在 `writers` 中时抛 `WRITE_DENIED`；命令返回 thenable 时抛 `COMMAND_ASYNC`；补丁里有契约未声明的字段时抛 `INVALID_OPTION`。任何失败都不会写入字段。'
    )
  },
  events: {
    summary: t(
      'One `{ on(listener) }` per contract event. Listeners receive the payload; the returned function unsubscribes, and the subscription ends when the app disconnects.',
      '契约中每个事件对应一个 `{ on(listener) }`。监听函数收到事件载荷；返回的函数用于取消，应用断开时也会自动取消。'
    )
  },
  requests: {
    summary: t(
      "One `(input, options?) => Promise` per contract request, answered by the owner's handler. Rejects with `OWNER_ABSENT` when no handler is registered and `waitForOwner` is not set, `OWNER_TIMEOUT` when waiting times out, and `OWNER_GONE` when the owner leaves during the call.",
      '契约中每个请求对应一个 `(input, options?) => Promise`，由 owner 的处理函数应答。没有处理函数且未设置 `waitForOwner` 时以 `OWNER_ABSENT` 拒绝；等待超时以 `OWNER_TIMEOUT` 拒绝；调用期间 owner 离开以 `OWNER_GONE` 拒绝。'
    )
  },
  resources: {
    summary: t(
      'One `IMicroResourceView` per contract resource, filled by the `resources()` plugin.',
      '契约中每个共享异步值对应一个 `IMicroResourceView`，由 `resources()` 插件提供。'
    )
  },
  revision: {
    summary: t(
      'Readable count of committed commands of this contract; increases by one per commit.',
      '这个契约已提交命令的次数，每次提交加一，可读取也可订阅。'
    )
  },
  select: {
    summary: t(
      'Creates a readable derived from state. Subscribers are notified only when `equals` reports a changed result. While nobody subscribes, `get()` caches the result per revision and keeps the old reference when the new result is equal. The derived node is released when its last subscriber leaves.',
      '基于状态创建一个派生的可读值。只有 `equals` 判定结果变化时才通知订阅者。没有订阅者时，`get()` 按提交次数缓存结果，结果相等时保留旧引用。最后一个订阅者离开时释放内部节点。'
    ),
    params: {
      selector: t(
        'Pure function of the state values. Only the fields it reads become dependencies; reading a field and returning the whole state object still notifies when that field changes.',
        '状态值的纯函数。只有它读取过的字段才成为依赖；读取某个字段后返回整个状态对象，该字段变化时仍会通知。'
      ),
      equals: t(
        'Compares the previous and the next result; defaults to `Object.is`. Return `true` to suppress the notification.',
        '比较前后两次结果，默认 `Object.is`。返回 `true` 表示没有变化，不通知。'
      )
    },
    returns: t(
      'An `IReadable` of the selected value. Throws `PLUGIN_MISSING` when the `state()` plugin is not installed.',
      '所选值的 `IReadable`。未安装 `state()` 插件时抛 `PLUGIN_MISSING`。'
    ),
    example: `const count = view.select((s) => s.items.length)
const stop = count.subscribe(() => renderBadge(count.get()))`
  }
}

/** Grants of the state plugin, shared by its enhancer doc. */
const stateGrants: readonly IGrantDoc[] = [
  {
    signature: 'view.state.<field>.get() / subscribe(listener)',
    summary: viewMembers.state.summary,
    params: { listener: subscribeMember.params!.listener },
    returns: t(
      '`get()` returns the committed value; `subscribe()` returns the unsubscribe function.',
      '`get()` 返回已提交的值；`subscribe()` 返回取消订阅的函数。'
    ),
    example: `const stop = view.state.items.subscribe(() => render(view.state.items.get()))`
  },
  {
    signature: 'view.commands.<name>(...args)',
    summary: viewMembers.commands.summary,
    params: {
      args: t(
        'The arguments the contract command declares after its state parameter.',
        '契约命令在状态参数之后声明的参数。'
      )
    },
    returns: t(
      '`{ revision }`: the contract revision after this commit.',
      '`{ revision }`：本次提交后的契约提交次数。'
    ),
    example: `const { revision } = view.commands.add({ id: 'sku-1', price: 42 })`
  },
  {
    signature: 'view.select(selector, equals?)',
    summary: viewMembers.select.summary,
    params: viewMembers.select.params,
    returns: viewMembers.select.returns,
    example: viewMembers.select.example
  }
]

/** Reference of `@migaia/micro-hub`. */
export const microHubReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Root entry: create or find the single hub of the page (`createMicroHub`, `getMicroHub`), define contracts (`defineContract` with `event`, `request`, `keyed`, `resource`), and the public constants and error helpers. Start from `defineContract` in the owner team, `createMicroHub` in the shell, and `getMicroHub().connect(name)` in every app.',
        '根入口：创建或取得整页唯一的 hub（`createMicroHub`、`getMicroHub`），定义契约（`defineContract`，配合 `event`、`request`、`keyed`、`resource`），以及公开常量和错误工具。owner 团队从 `defineContract` 开始，主应用从 `createMicroHub` 开始，每个应用从 `getMicroHub().connect(name)` 开始。'
      ),
      example: hubFlowExample
    },
    events: {
      summary: t(
        'The `events()` plugin: contract `events` (owner emits, every app listens) and `requests` (owner answers with one handler, every app calls). Install it in the shell when a contract declares events or requests.',
        '`events()` 插件：契约中的 `events`（owner 发出，所有应用监听）和 `requests`（owner 用唯一的处理函数应答，所有应用调用）。契约声明了事件或请求时，在主应用中安装它。'
      ),
      example: `import { events } from '@migaia/micro-hub/events'

createMicroHub({ plugins: [events({ publishBudget: 1000 })] })`
    },
    state: {
      summary: t(
        'The `state()` plugin: contract `state`, `computed`, `commands`, `select` and `keyed()` fields, one atom per field and per keyed id. `stateDriverOf` is for plugin authors who build on state.',
        '`state()` 插件：契约中的 `state`、`computed`、`commands`、`select` 和 `keyed()` 字段，每个字段和每个实体 id 各一个原子。`stateDriverOf` 供基于状态编写插件的作者使用。'
      ),
      example: `import { state } from '@migaia/micro-hub/state'

createMicroHub({ plugins: [state()] })`
    },
    persist: {
      summary: t(
        'The `persist()` plugin: lets an owner write selected plain fields to a key-value store and restore them when it starts. Needs `state()` installed as well.',
        '`persist()` 插件：让 owner 把选定的普通字段写入键值存储，并在启动时读回。需要同时安装 `state()`。'
      ),
      example: persistExample
    },
    resource: {
      summary: t(
        'The `resources()` plugin: contract `resources` are asynchronous values the owner fetches once for every app. Needs the optional peer `@migaia/resource`.',
        '`resources()` 插件：契约中的 `resources` 是由 owner 获取一次、所有应用共享的异步值。需要可选的对等依赖 `@migaia/resource`。'
      ),
      example: resourceExample
    },
    'web-component': {
      summary: t(
        'Hands the app handle to child apps mounted as custom elements through the community Context Protocol, without a global variable. Use `provideMicroApp` in the shell and `consumeMicroApp` in the element; Lit consumers can use `MICRO_APP_CONTEXT` directly.',
        '通过社区的 Context Protocol，把应用句柄交给以自定义元素挂载的子应用，不需要全局变量。主应用用 `provideMicroApp`，元素里用 `consumeMicroApp`；Lit 的消费方可以直接用 `MICRO_APP_CONTEXT`。'
      ),
      example: webComponentExample
    }
  },
  symbols: {
    createMicroHub: {
      role: 'factory',
      purpose: t(
        "Creates the single hub of the page. Only the shell calls it; child apps call `getMicroHub()`. Every plugin's dependencies are checked first, and the plugins are installed only when all of them are met, so a missing dependency leaves no hub behind.",
        '创建整页唯一的 hub。只有主应用调用它；子应用调用 `getMicroHub()`。先检查每个插件的依赖，全部满足才安装，因此缺少依赖时不会留下半成品 hub。'
      ),
      returns: t(
        'The `IMicroHub`. Throws `HUB_ALREADY_CREATED` when a hub already exists in this realm, and `PLUGIN_MISSING` when a plugin needs another plugin that is not in `plugins`.',
        '创建好的 `IMicroHub`。当前环境已有 hub 时抛 `HUB_ALREADY_CREATED`；某个插件依赖的插件不在 `plugins` 中时抛 `PLUGIN_MISSING`。'
      ),
      options: 'ICreateMicroHubOptions',
      example: shellSetup,
      exampleIntro: t(
        'The shell creates the hub once, before any remote mounts.',
        '主应用在任何子应用挂载前创建一次 hub。'
      ),
      exampleResult: t(
        'Every app on the page can now call `getMicroHub().connect(name)` and get a handle of the same shape.',
        '页面上的每个应用都可以调用 `getMicroHub().connect(name)`，拿到形状相同的句柄。'
      ),
      cases: microHubCases.createMicroHub,
      scenarios: [
        t(
          'Several Module Federation remotes or Web Component child apps on one page share state, events and requests.',
          '同一页面上的多个联邦子应用或自定义元素子应用共享状态、事件和请求。'
        )
      ],
      avoid: [
        t(
          'iframes, Workers or other tabs are separate realms: use `@migaia/rpc-plugin-browser` with `createRpcHost`.',
          'iframe、Worker 或其它标签页属于不同的运行环境：请使用 `@migaia/rpc-plugin-browser` 搭配 `createRpcHost`。'
        ),
        t(
          'State used by only one app: use `@migaia/store-keyed` or `@migaia/store-light` directly.',
          '只有一个应用使用的状态：直接使用 `@migaia/store-keyed` 或 `@migaia/store-light`。'
        )
      ]
    },
    getMicroHub: {
      role: 'operation',
      purpose: t(
        'Returns the hub the shell created. Every app, including the shell, calls it to connect.',
        '返回主应用创建的 hub。所有应用（包括主应用自己）都通过它连接。'
      ),
      returns: t(
        'The current `IMicroHub`. Throws `HUB_NOT_CREATED` when the shell has not created it yet or it has been disposed.',
        '当前的 `IMicroHub`。主应用尚未创建或已经释放时抛 `HUB_NOT_CREATED`。'
      ),
      example: `const app = getMicroHub().connect('product')`,
      cases: microHubCases.getMicroHub
    },
    defineContract: {
      role: 'factory',
      purpose: t(
        'Defines a contract: the typed, versioned agreement between the app that owns some state, events, requests and resources and the apps that use them. It only validates and freezes, with no side effect; the hub registers the contract the first time an app calls `use()` or `own()` with it. Share the result between apps through a Module Federation expose.',
        '定义一个契约：拥有某些状态、事件、请求和共享异步值的应用，与使用它们的应用之间带类型、带版本的约定。它只做校验和冻结，没有副作用；某个应用第一次用它调用 `use()` 或 `own()` 时，hub 才登记这个契约。通过联邦模块的暴露入口在应用之间共享结果。'
      ),
      params: {
        name: t(
          'Contract name, chosen by the owner team; non-empty and without `.`. Apps that use the same name must agree on the major version.',
          '契约名，由 owner 团队决定；不能为空，也不能包含 `.`。使用同名契约的应用必须使用相同的主版本。'
        ),
        spec: t(
          'Sections of the contract: `version` (positive integer), `state`, `computed`, `commands`, `writers`, `events`, `requests` and `resources`. See `IContractSpec`.',
          '契约的各个部分：`version`（正整数）、`state`、`computed`、`commands`、`writers`、`events`、`requests` 和 `resources`，详见 `IContractSpec`。'
        )
      },
      returns: t(
        'A frozen `IContract`. Throws `INVALID_OPTION` (`TypeError`) for an invalid name, a version that is not a positive integer, or a section member of the wrong kind.',
        '冻结的 `IContract`。名字非法、版本不是正整数、或某部分成员类型不对时抛 `INVALID_OPTION`（`TypeError`）。'
      ),
      example: cartContract,
      cases: microHubCases.defineContract
    },
    event: {
      role: 'operation',
      purpose: t(
        'Declares a contract event whose payload type is `T`. The marker carries the type only; use it inside the `events` section of `defineContract`.',
        '声明一个载荷类型为 `T` 的契约事件。这个标记只携带类型信息，放在 `defineContract` 的 `events` 部分中使用。'
      ),
      returns: t(
        'A frozen `IEventMarker<T>` to place in the `events` section.',
        '冻结的 `IEventMarker<T>`，放进契约的 `events` 部分。'
      ),
      example: `defineContract('cart', { version: 1, events: { checkedOut: event<{ orderId: string }>() } })`
    },
    request: {
      role: 'operation',
      purpose: t(
        'Declares a contract request with input `TIn` and output `TOut`. The owner answers it with one handler registered by `owned.handle()`; any app calls it through `view.requests`.',
        '声明一个输入为 `TIn`、输出为 `TOut` 的契约请求。owner 用 `owned.handle()` 登记唯一的处理函数来应答，任何应用通过 `view.requests` 调用。'
      ),
      returns: t(
        'A frozen `IRequestMarker<TIn, TOut>` to place in the `requests` section.',
        '冻结的 `IRequestMarker<TIn, TOut>`，放进契约的 `requests` 部分。'
      ),
      example: `defineContract('cart', {
  version: 1,
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() }
})`,
      cases: microHubCases.request
    },
    keyed: {
      role: 'operation',
      purpose: t(
        "Declares a state field that is a table of entities keyed by string id. Each id is subscribed independently, so updating one entity notifies only that entity's subscribers. Commands write it with an id map in which `undefined` deletes the id.",
        '声明一个按字符串 id 存放实体的状态字段。每个 id 单独订阅，更新一个实体只通知这个实体的订阅者。命令用 id 映射写入它，值为 `undefined` 表示删除该 id。'
      ),
      returns: t(
        'A frozen `IKeyedMarker<T>` to place in the `state` section.',
        '冻结的 `IKeyedMarker<T>`，放进契约的 `state` 部分。'
      ),
      example: `const catalog = defineContract('catalog', {
  version: 1,
  state: { products: keyed<IProduct>() },
  commands: { rename: (s, id: string, name: string) => ({ products: { [id]: { ...s.products.get(id)!, name } } }) }
})`,
      cases: microHubCases.keyed
    },
    resource: {
      role: 'operation',
      purpose: t(
        'Declares a shared asynchronous value of type `T`. The owner supplies its fetcher with `owned.provide()`; every app reads it through `view.resources`. Needs the `resources()` plugin.',
        '声明一个类型为 `T` 的共享异步值。owner 用 `owned.provide()` 提供获取函数，所有应用通过 `view.resources` 读取。需要安装 `resources()` 插件。'
      ),
      returns: t(
        'A frozen `IResourceMarker<T>` to place in the `resources` section.',
        '冻结的 `IResourceMarker<T>`，放进契约的 `resources` 部分。'
      ),
      example: `defineContract('session', { version: 1, resources: { profile: resource<IUser>() } })`
    },
    MICRO_HUB_SOURCE: {
      role: 'error',
      purpose: t(
        'The `source` value on every error this package creates (`micro-frontend.hub`). Compare `error.source` with it to know the error came from this package, then branch on `error.code`.',
        '本包创建的每个错误都带有的 `source` 值（`micro-frontend.hub`）。比较 `error.source` 是否等于它，即可确认错误来自本包，再按 `error.code` 分支处理。'
      ),
      example: errorExample
    },
    MicroHubErrorCode: {
      role: 'error',
      purpose: t(
        'Every error code this package throws. Errors keep their native type (`Error` or `TypeError`) and carry `source` and `code`; branch on `code`, not on the message.',
        '本包会抛出的全部错误码。错误保留原生类型（`Error` 或 `TypeError`），并带有 `source` 与 `code`；请按 `code` 分支，不要依赖消息文字。'
      ),
      example: errorExample
    },
    MicroHubErrorText: {
      role: 'error',
      purpose: t(
        'The message, or message factory, behind every error code. Every message this package throws comes from here. Refer to it when a test or a log needs the exact wording; branch on `code` otherwise.',
        '每个错误码对应的消息文字或消息工厂。本包抛出的所有消息都来自这里。测试或日志需要核对原文时引用它，判断错误类型请用 `code`。'
      ),
      example: `expect(() => app.use(cart)).toThrow(MicroHubErrorText.appDisconnected('product'))`
    },
    createMicroHubError: {
      role: 'error',
      optionDocs: {
        cause: {
          summary: t(
            'The original error this one wraps; it stays reachable through `error.cause`, so the first failure is never lost.',
            '被包装的原始错误；可以通过 `error.cause` 找到它，最初的失败不会丢失。'
          ),
          default: t('Not set: the error has no `cause`.', '不设置：错误没有 `cause`。'),
          whenToUse: t(
            'Pass the caught failure when adding a hub error code to it, so callers can inspect the original error by identity.',
            '捕获失败后需要补充 hub 错误码时传入，使调用方仍能按对象身份找到原始错误。'
          ),
          example: `createMicroHubError(MicroHubErrorCode.ownerGone, message, { cause: failure })`
        }
      },
      purpose: t(
        "Creates an `Error` tagged with this package's `source` and a `MicroHubErrorCode`. Meant for capability plugins that report failures the same way the hub does.",
        '创建一个带本包 `source` 和 `MicroHubErrorCode` 的 `Error`。供能力插件以和 hub 相同的方式报告失败。'
      ),
      params: {
        code: t(
          'A value of `MicroHubErrorCode`; it becomes `error.code`.',
          '一个 `MicroHubErrorCode` 的取值，成为 `error.code`。'
        ),
        message: t(
          "The message, normally taken from `MicroHubErrorText` so the wording matches the hub's own errors.",
          '错误消息，通常取自 `MicroHubErrorText`，使措辞与 hub 自身的错误一致。'
        ),
        options: t(
          'Optional `{ cause }`; the original error stays reachable through `error.cause`.',
          '可选的 `{ cause }`；原始错误可通过 `error.cause` 找到。'
        )
      },
      returns: t(
        'A native `Error` with `source` and `code`; its stack is the call site.',
        '带 `source` 和 `code` 的原生 `Error`，堆栈指向调用处。'
      ),
      example: `throw createMicroHubError(MicroHubErrorCode.ownerAbsent, MicroHubErrorText.ownerAbsent('cart', 'checkout'))`
    },
    createMicroHubTypeError: {
      role: 'error',
      optionDocs: {
        cause: {
          summary: t(
            'The original error this one wraps; it stays reachable through `error.cause`, so the first failure is never lost.',
            '被包装的原始错误；可以通过 `error.cause` 找到它，最初的失败不会丢失。'
          ),
          default: t('Not set: the error has no `cause`.', '不设置：错误没有 `cause`。'),
          whenToUse: t(
            'Pass the caught validation failure when callers need both the native TypeError and its original cause.',
            '包装参数校验失败、且调用方需要保留原生 TypeError 和原始失败时传入。'
          ),
          example: `createMicroHubTypeError(MicroHubErrorCode.invalidOption, message, { cause: failure })`
        }
      },
      purpose: t(
        'Same as `createMicroHubError` but creates a `TypeError`, for invalid arguments; callers that branch on the native type keep working.',
        '与 `createMicroHubError` 相同，但创建 `TypeError`，用于参数非法的情况；按原生类型判断的调用方不受影响。'
      ),
      params: {
        code: t(
          'A value of `MicroHubErrorCode`, usually `INVALID_OPTION`.',
          '一个 `MicroHubErrorCode` 的取值，通常是 `INVALID_OPTION`。'
        ),
        message: t(
          'The message, normally taken from `MicroHubErrorText`.',
          '错误消息，通常取自 `MicroHubErrorText`。'
        ),
        options: t(
          'Optional `{ cause }`; the original error stays reachable through `error.cause`.',
          '可选的 `{ cause }`；原始错误可通过 `error.cause` 找到。'
        )
      },
      returns: t(
        'A native `TypeError` with `source` and `code`.',
        '带 `source` 和 `code` 的原生 `TypeError`。'
      ),
      example: `throw createMicroHubTypeError(MicroHubErrorCode.invalidOption, MicroHubErrorText.invalidName('app', name))`
    },
    MicroCapability: {
      role: 'constant',
      purpose: t(
        'Capability kind names. Each plugin declares one kind, contracts need kinds by section, and `PLUGIN_MISSING` messages name them.',
        '能力种类名。每个插件声明一种；契约按其中的部分需要相应的能力；`PLUGIN_MISSING` 的消息里出现的就是这些名字。'
      ),
      example: `if (!plugins.some((plugin) => plugin.kind === MicroCapability.state)) plugins.push(state())`
    },
    MicroResourceStatus: {
      role: 'constant',
      purpose: t(
        'Status values of a shared resource snapshot (`resources.<name>.state.get().status`). Compare against these constants instead of literal strings.',
        '共享异步值快照的状态取值（`resources.<name>.state.get().status`）。比较时使用这些常量，不要手写字符串。'
      ),
      example: `const { status, data } = view.resources.profile.state.get()
if (status === MicroResourceStatus.success) render(data)`
    },
    events: {
      role: 'enhancer',
      purpose: t(
        'Creates the events capability plugin. Install it in `createMicroHub({ plugins })` when a contract declares `events` or `requests`.',
        '创建事件能力插件。契约中声明了 `events` 或 `requests` 时，在主应用里把它放进 `createMicroHub({ plugins })`。'
      ),
      returns: t('An `IMicroPlugin` of kind `events`.', '种类为 `events` 的 `IMicroPlugin`。'),
      options: 'IEventsOptions',
      example: `createMicroHub({ plugins: [events({ publishBudget: 1000 })] })`,
      cases: microHubCases.events
    },
    state: {
      role: 'enhancer',
      purpose: t(
        'Creates the state capability plugin. Install it in `createMicroHub({ plugins })` when a contract declares `state`, `computed` or `commands`.',
        '创建状态能力插件。契约中声明了 `state`、`computed` 或 `commands` 时，在主应用里把它放进 `createMicroHub({ plugins })`。'
      ),
      returns: t('An `IMicroPlugin` of kind `state`.', '种类为 `state` 的 `IMicroPlugin`。'),
      example: `createMicroHub({ plugins: [state()] })`,
      cases: microHubCases.state
    },
    persist: {
      role: 'enhancer',
      purpose: t(
        'Creates the persistence capability plugin. Use it together with `state()`; owners then opt fields in with `own(contract, { persist })`.',
        '创建持久化能力插件。需与 `state()` 一起使用；之后 owner 通过 `own(contract, { persist })` 选择要持久化的字段。'
      ),
      returns: t(
        'An `IMicroPlugin` of kind `persist` that requires `state`.',
        '种类为 `persist`、依赖 `state` 的 `IMicroPlugin`。'
      ),
      options: 'IPersistOptions',
      example: persistExample,
      cases: microHubCases.persist
    },
    resources: {
      role: 'enhancer',
      purpose: t(
        'Creates the shared-resource capability plugin. Install it when a contract declares `resources`; it needs the optional peer `@migaia/resource`.',
        '创建共享异步值能力插件。契约声明了 `resources` 时安装；它需要可选的对等依赖 `@migaia/resource`。'
      ),
      returns: t('An `IMicroPlugin` of kind `resource`.', '种类为 `resource` 的 `IMicroPlugin`。'),
      example: resourceExample
    },
    stateDriverOf: {
      role: 'operation',
      purpose: t(
        'Returns the state driver of a hub runtime. For authors of capability plugins that build on state, the way `persist()` does; applications do not need it.',
        '返回某个 hub 运行时的状态驱动。供基于状态编写能力插件的作者使用，`persist()` 就是这样做的；应用代码不需要它。'
      ),
      params: {
        hub: t(
          'The hub runtime a plugin receives in its `bind` function.',
          '插件在其 `bind` 函数中收到的 hub 运行时。'
        )
      },
      returns: t(
        "The `IStateDriver`, or `undefined` cast to it when `state()` is not installed; declare `state` in your plugin's `requires` so the hub guarantees it.",
        '`IStateDriver`；未安装 `state()` 时实际为 `undefined`。在插件的 `requires` 中声明 `state`，由 hub 保证它存在。'
      ),
      example: `const driver = stateDriverOf(hub)
const def = driver.plainField(entry, 'items')`
    },
    MICRO_APP_CONTEXT: {
      role: 'constant',
      purpose: t(
        "Context key of the app handle in the Context Protocol. It is a string, so Lit's `@consume({ context: MICRO_APP_CONTEXT })` and other implementations match it with `===`.",
        'Context Protocol 中应用句柄的上下文键。它是字符串，因此 Lit 的 `@consume({ context: MICRO_APP_CONTEXT })` 和其它实现可以用 `===` 匹配它。'
      ),
      example: `class CartBadge extends LitElement {
  @consume({ context: MICRO_APP_CONTEXT, subscribe: true }) app?: IMicroApp
}`
    },
    provideMicroApp: {
      role: 'operation',
      purpose: t(
        'Makes `element` answer `context-request` events for the app handle from its descendants, including inside shadow DOM. It also answers requests that were waiting before it existed, and dispatches `context-provider` so an external Lit ContextRoot replays its early requests. Use it together with `consumeMicroApp` in the child element.',
        '让 `element` 应答后代（包括 shadow DOM 内）请求应用句柄的 `context-request` 事件。它也会应答在它出现之前就在等待的请求，并发出 `context-provider`，让外部的 Lit ContextRoot 重放早到的请求。配合子元素中的 `consumeMicroApp` 一起使用。'
      ),
      params: {
        element: t(
          'Ancestor element of the child apps, usually the slot the shell mounts them into.',
          '子应用的祖先元素，通常是主应用挂载子应用的插槽元素。'
        ),
        app: t(
          'The handle to hand out, returned by `getMicroHub().connect(name)`.',
          '要交出的句柄，由 `getMicroHub().connect(name)` 返回。'
        )
      },
      returns: t(
        'A function that stops providing; later requests are no longer answered by this element.',
        '停止提供的函数；之后的请求不再由这个元素应答。'
      ),
      example: webComponentExample
    },
    consumeMicroApp: {
      role: 'operation',
      purpose: t(
        'Asks the nearest provider above `element` for the app handle by dispatching a bubbling, composed `context-request`. When no provider answers yet, the request waits until `provideMicroApp` appears on an ancestor.',
        '通过派发会冒泡、可穿过 shadow DOM 的 `context-request`，向 `element` 上方最近的提供者请求应用句柄。还没有提供者应答时，请求会等待，直到祖先上出现 `provideMicroApp`。'
      ),
      params: {
        element: t(
          'The custom element of the child app, usually `this` in `connectedCallback`.',
          '子应用的自定义元素，通常是 `connectedCallback` 中的 `this`。'
        ),
        callback: t(
          'Called once with the app handle when a provider answers.',
          '提供者应答时，以应用句柄调用一次。'
        )
      },
      returns: t(
        'A function that cancels a request that is still waiting; call it in `disconnectedCallback`.',
        '取消仍在等待的请求的函数；在 `disconnectedCallback` 中调用。'
      ),
      example: webComponentExample
    }
  },
  types: {
    ICreateMicroHubOptions: {
      summary: t(
        'Options of `createMicroHub`: the capability plugins and where non-fatal errors go.',
        '`createMicroHub` 的选项：要安装的能力插件，以及不应打断操作的错误交给谁处理。'
      ),
      members: {
        plugins: {
          summary: t(
            'Capability plugins to install: any of `events()`, `state()`, `persist()`, `resources()`. Order does not matter; dependencies are checked before anything is installed.',
            '要安装的能力插件：`events()`、`state()`、`persist()`、`resources()` 中的任意几个。顺序无关；安装前先检查依赖。'
          ),
          example: `createMicroHub({ plugins: [events(), state()] })`
        },
        report: {
          summary: t(
            'Receives errors that must not interrupt the current operation: exceptions from listeners and subscription callbacks, and cleanup failures. If it throws, both errors go to the default reporter.',
            '接收不应打断当前操作的错误：监听函数和订阅回调抛出的异常，以及清理失败。它自身抛错时，两个错误都交给默认处理。'
          ),
          default: t(
            '`globalThis.reportError`, or `console.error` when that is missing.',
            '`globalThis.reportError`；没有时使用 `console.error`。'
          ),
          whenToUse: t(
            'Send listener failures of all apps to your error monitoring.',
            '把所有应用的监听失败统一发送到错误监控。'
          ),
          example: `createMicroHub({ plugins: [events()], report: (error) => monitor.capture(error) })`
        }
      }
    },
    IMicroHub: {
      summary: t(
        'The single hub of the page, created by `createMicroHub` and returned by `getMicroHub`. Apps connect through it; the shell disposes it.',
        '整页唯一的 hub，由 `createMicroHub` 创建、由 `getMicroHub` 返回。应用通过它连接，主应用负责释放它。'
      ),
      scenarios: [
        t(
          'Connect each micro-frontend under its own name and tear everything down when the shell unloads.',
          '每个微前端以自己的名字连接，主应用卸载时统一释放。'
        )
      ],
      example: hubFlowExample,
      members: {
        connect: {
          summary: t(
            'Connects an app and returns its handle. The shell and child apps get exactly the same shape.',
            '连接一个应用并返回它的句柄。主应用和子应用拿到的形状完全一样。'
          ),
          params: {
            name: t(
              'App name chosen by the app itself, non-empty and without `.`; it is what `writers` lists and what error messages name.',
              '应用自己选定的名字，不能为空，也不能包含 `.`；`writers` 列出的、错误消息中出现的都是这个名字。'
            )
          },
          returns: t(
            'An `IMicroApp`. Throws `APP_ALREADY_CONNECTED` while an app with the same name is connected, and `HUB_NOT_CREATED` after the hub is disposed.',
            '一个 `IMicroApp`。同名应用仍在连接时抛 `APP_ALREADY_CONNECTED`；hub 已释放后抛 `HUB_NOT_CREATED`。'
          ),
          example: `const app = getMicroHub().connect('product')`
        },
        apps: {
          summary: t(
            'Names of the connected apps, in connection order.',
            '已连接应用的名字，按连接顺序排列。'
          )
        },
        dispose: {
          summary: t(
            'Disconnects every app, then releases the plugins in reverse installation order. Afterwards `createMicroHub` can be called again.',
            '先断开所有应用，再按安装的相反顺序释放插件。之后可以再次调用 `createMicroHub`。'
          ),
          returns: t(
            'A Promise that resolves when everything, including pending persistence writes, has finished. Repeated calls return the same Promise; failures go to `report`.',
            '所有工作（包括待完成的持久化写入）结束后兑现的 Promise。重复调用返回同一个 Promise；失败交给 `report`。'
          ),
          example: `await getMicroHub().dispose()`
        }
      }
    },
    IMicroApp: {
      summary: t(
        'Handle of one connected app, returned by `hub.connect(name)`. Everything the app registers through it, and through the views it returns, is released by `disconnect()`.',
        '一个已连接应用的句柄，由 `hub.connect(name)` 返回。应用通过它以及它返回的视图登记的一切，都由 `disconnect()` 释放。'
      ),
      scenarios: [
        t(
          'Mount: connect, use or own contracts, subscribe. Unmount: one `disconnect()` call cleans up.',
          '挂载时连接、使用或认领契约、订阅；卸载时调用一次 `disconnect()` 即可清理干净。'
        )
      ],
      example: hubFlowExample,
      members: {
        name: {
          summary: t(
            'The name passed to `hub.connect()`; `writers` and error messages use it.',
            '传给 `hub.connect()` 的名字；`writers` 和错误消息中使用的就是它。'
          )
        },
        connected: {
          summary: t(
            'True until `disconnect()` is called; afterwards every member of this handle and its views throws `APP_DISCONNECTED`.',
            '调用 `disconnect()` 之前为 `true`；之后调用这个句柄和它的视图上的任何成员都抛 `APP_DISCONNECTED`。'
          )
        },
        use: {
          summary: t(
            'Returns the view of a contract, registering the contract on first use. Repeated calls with the same contract return the same frozen view.',
            '返回契约的视图，第一次使用时登记契约。同一个契约重复调用返回同一个冻结的视图。'
          ),
          params: {
            contract: t(
              "A contract from `defineContract`, usually imported from the owner team's Module Federation expose.",
              '由 `defineContract` 定义的契约，通常从 owner 团队的联邦模块暴露入口导入。'
            )
          },
          returns: t(
            'An `IContractView`. Throws `CONTRACT_VERSION_MISMATCH` when the name is registered with another version, and `PLUGIN_MISSING` when the contract needs an uninstalled plugin.',
            '一个 `IContractView`。同名契约已以其它版本登记时抛 `CONTRACT_VERSION_MISMATCH`；契约需要的插件未安装时抛 `PLUGIN_MISSING`。'
          ),
          example: `const view = app.use(cart)`
        },
        own: {
          summary: t(
            'Claims ownership of a contract and returns its view plus the owner-only members. Ownership ends on `release()` or when the app disconnects; the state is kept for the next owner.',
            '认领契约的所有权，返回视图以及 owner 专属成员。所有权在 `release()` 或应用断开时结束，状态保留给下一个 owner。'
          ),
          params: {
            contract: t(
              'The contract to own, from `defineContract`.',
              '要认领的契约，由 `defineContract` 定义。'
            ),
            options: t(
              '`IOwnOptions`: which plain fields to persist and under which key; needs the `persist()` plugin.',
              '`IOwnOptions`：要持久化哪些普通字段、使用哪个存储键；需要 `persist()` 插件。'
            )
          },
          returns: t(
            'An `IOwnedContract`. Throws `CONTRACT_OWNED` when another app owns the contract, and `PLUGIN_MISSING` when `persist` is requested without the `persist()` plugin.',
            '一个 `IOwnedContract`。契约已有其它 owner 时抛 `CONTRACT_OWNED`；请求持久化但未安装 `persist()` 插件时抛 `PLUGIN_MISSING`。'
          ),
          example: ownerExample
        },
        disconnect: {
          summary: t(
            'Releases every subscription, handler and ownership of this app synchronously, so no callback reaches an unmounted app, then unloads the app from the hub. Reconnecting with the same name right away is allowed.',
            '同步释放这个应用的所有订阅、处理函数和所有权，保证不会有回调到达已卸载的应用，然后从 hub 卸载应用。可以立即以同名重新连接。'
          ),
          returns: t(
            'A Promise that resolves when unloading has finished; repeated calls return the same Promise.',
            '卸载完成时兑现的 Promise；重复调用返回同一个 Promise。'
          ),
          example: `await app.disconnect()`
        }
      }
    },
    IContractView: {
      summary: t(
        'What any connected app gets from `app.use(contract)`: readables for state and computed values, command functions, event listeners, request callers, resources and `select`.',
        '任何已连接应用通过 `app.use(contract)` 得到的视图：状态与计算值的可读对象、命令函数、事件监听、请求调用、共享异步值和 `select`。'
      ),
      scenarios: [
        t(
          "A consumer app renders shared state, writes through commands it is allowed to call, and reacts to the owner's events.",
          '使用方应用渲染共享状态，调用被允许的命令写入，并响应 owner 发出的事件。'
        )
      ],
      example: viewExample,
      members: viewMembers
    },
    IOwnedContract: {
      summary: t(
        'What the owner gets from `app.own(contract)`: the view plus emitting events, answering requests, providing resources, persistence status and `release()`.',
        'owner 通过 `app.own(contract)` 得到的对象：视图的全部成员，加上发出事件、应答请求、提供共享异步值、持久化状态和 `release()`。'
      ),
      scenarios: [
        t(
          'The app that owns a business domain publishes its events and serves requests for it.',
          '拥有某个业务领域的应用发布该领域的事件，并处理针对它的请求。'
        )
      ],
      example: ownerExample,
      members: {
        ...viewMembers,
        events: {
          summary: t(
            'One `{ on(listener), emit(payload) }` per contract event. `emit` delivers synchronously in registration order; an emit made inside a listener is queued until the current delivery ends.',
            '契约中每个事件对应一个 `{ on(listener), emit(payload) }`。`emit` 按登记顺序同步分发；在监听函数里再次发出的事件会排队，等当前分发结束后执行。'
          )
        },
        handle: {
          summary: t(
            'Registers the single handler of a request. Callers waiting with `waitForOwner` are released as soon as it is registered.',
            '登记某个请求唯一的处理函数。用 `waitForOwner` 等待的调用方会在登记后立即继续。'
          ),
          params: {
            name: t(
              "Request name declared in the contract's `requests` section.",
              '契约 `requests` 部分中声明的请求名。'
            ),
            handler: t(
              "Receives the caller's input and returns the output or a Promise of it; a thrown error rejects the caller's call unchanged.",
              '接收调用方的输入，返回输出或输出的 Promise；抛出的错误原样拒绝调用方的调用。'
            )
          },
          returns: t(
            'A function that unregisters the handler. Throws `HANDLER_DUPLICATED` when the request already has a handler, and `EMIT_DENIED` after `release()`.',
            '注销处理函数的函数。该请求已有处理函数时抛 `HANDLER_DUPLICATED`；`release()` 之后调用抛 `EMIT_DENIED`。'
          ),
          example: `const unhandle = owned.handle('checkout', async ({ coupon }) => ({ orderId: await submit(coupon) }))`
        },
        provide: {
          summary: t(
            'Registers the fetcher of a shared resource; needs the `resources()` plugin.',
            '登记共享异步值的获取函数；需要 `resources()` 插件。'
          ),
          params: {
            name: t(
              "Resource name declared in the contract's `resources` section.",
              '契约 `resources` 部分中声明的共享异步值名。'
            ),
            fetcher: t(
              'Fetches the value; its `signal` aborts when the request is replaced or the owner releases it.',
              '获取值的函数；请求被替换或 owner 释放时，它收到的 `signal` 会中止。'
            )
          },
          returns: t(
            'A function that unregisters the fetcher. Throws `HANDLER_DUPLICATED` when one is already registered.',
            '注销获取函数的函数。已登记过时抛 `HANDLER_DUPLICATED`。'
          ),
          example: `owned.provide('profile', (signal) => fetch('/api/me', { signal }).then((r) => r.json()))`
        },
        persistence: {
          summary: t(
            'The store-persist `IPersistHandle` when `own(contract, { persist })` requested persistence; its `ready` resolves after the first successful read-back. Otherwise `undefined`.',
            '通过 `own(contract, { persist })` 请求了持久化时，是存储持久化包的 `IPersistHandle`，其 `ready` 在首次读回成功后兑现；否则为 `undefined`。'
          )
        },
        release: {
          summary: t(
            'Gives up ownership: owner-only members stop working, persistence stops, callers of in-flight requests get `OWNER_GONE`, and another app may own the contract. The state is kept.',
            '放弃所有权：owner 专属成员不再可用，持久化停止，进行中的请求以 `OWNER_GONE` 拒绝，其它应用之后可以认领。状态保留。'
          ),
          returns: t(
            'Nothing; ownership has ended when the call returns. Calling it again does nothing.',
            '无返回值；调用返回时所有权已经结束。重复调用没有副作用。'
          ),
          example: `owned.release()`
        }
      }
    },
    IOwnOptions: {
      summary: t(
        'Options of `app.own(contract, options)`; both concern persistence and need the `persist()` plugin.',
        '`app.own(contract, options)` 的选项；两项都与持久化有关，需要 `persist()` 插件。'
      ),
      members: {
        persist: {
          summary: t(
            'Plain state fields written to the persist store and read back when the owner starts. Keyed fields cannot be persisted.',
            '写入持久化存储、并在 owner 启动时读回的普通状态字段。`keyed()` 字段不能持久化。'
          ),
          default: t('Not set: nothing is persisted.', '不设置：不持久化任何字段。'),
          example: `app.own(cart, { persist: ['items'] })`
        },
        persistKey: {
          summary: t(
            "Storage key the fields are saved under, after the plugin's `keyPrefix`.",
            '字段保存时使用的存储键，位于插件 `keyPrefix` 之后。'
          ),
          default: t('The contract name.', '契约名。'),
          example: `app.own(cart, { persist: ['items'], persistKey: 'cart-v2' })`
        }
      }
    },
    IReadable: {
      summary: t(
        'Framework-neutral read contract of every value the hub exposes: `get()` plus `subscribe()`. It plugs directly into `useSyncExternalStore` and into small adapters for Vue, Svelte or Solid.',
        'hub 暴露的每个值都遵循的框架无关读取约定：`get()` 加 `subscribe()`。可直接用于 `useSyncExternalStore`，也能用几行代码接入 Vue、Svelte 或 Solid。'
      ),
      scenarios: [t('Bind shared state to any UI framework.', '把共享状态接入任意界面框架。')],
      example: readableExample,
      members: { get: getMember, subscribe: subscribeMember }
    },
    IKeyedReadable: {
      summary: t(
        'Readable view of a `keyed()` field: one readable per id, plus the list of present ids.',
        '`keyed()` 字段的可读视图：每个 id 一个可读对象，再加上现有 id 的列表。'
      ),
      scenarios: [
        t(
          'Render one row per entity and re-render only the row whose entity changed.',
          '每个实体渲染一行，只重新渲染实体发生变化的那一行。'
        )
      ],
      example: `const row = view.state.byId.at('sku-1')
const stop = row.subscribe(() => renderRow(row.get()))`,
      members: {
        at: {
          summary: t(
            'Returns the readable of one id. It notifies only when that id is written or deleted.',
            '返回某个 id 的可读对象。只有这个 id 被写入或删除时才通知。'
          ),
          params: {
            id: t(
              'Entity id, the key a command wrote in its id map.',
              '实体 id，即命令在 id 映射中写入的键。'
            )
          },
          returns: t(
            'An `IReadable` of the entity, `undefined` while the id is absent.',
            '该实体的 `IReadable`；id 不存在时值为 `undefined`。'
          ),
          example: `const item = view.state.byId.at('sku-1').get()`
        },
        ids: {
          summary: t(
            'Readable list of present ids in insertion order; it notifies only when ids are added or removed.',
            '现有 id 的可读列表，按插入顺序排列；只有增删 id 时才通知。'
          )
        }
      }
    },
    IKeyedSnapshot: {
      summary: t(
        'How a `keyed()` field looks inside commands, computed values and selectors: a read-only lookup.',
        '`keyed()` 字段在命令、计算值和选择函数中的样子：只读的查找对象。'
      ),
      members: {
        get: {
          summary: t('Returns the entity stored under an id.', '返回某个 id 下存放的实体。'),
          params: {
            id: t('Entity id to look up.', '要查找的实体 id。')
          },
          returns: t(
            'The entity, or `undefined` when absent.',
            '对应实体；不存在时为 `undefined`。'
          ),
          example: `commands: { rename: (s, id: string, name: string) => ({ byId: { [id]: { ...s.byId.get(id)!, name } } }) }`
        },
        ids: {
          summary: t('Present ids in insertion order.', '当前存在的全部 id，按插入顺序排列。')
        }
      }
    },
    ICommitResult: {
      summary: t('Result of a command call.', '一次命令调用的结果，说明提交后契约处于第几次提交。'),
      members: {
        revision: {
          summary: t(
            'Contract revision after this commit; equal to `view.revision.get()` right after the call.',
            '本次提交后的契约提交次数；调用刚返回时等于 `view.revision.get()`。'
          )
        }
      }
    },
    IRequestOptions: {
      summary: t(
        'Options of a request call through `view.requests.<name>(input, options)`.',
        '通过 `view.requests.<name>(input, options)` 调用请求时的选项。'
      ),
      members: {
        waitForOwner: {
          summary: t(
            "Milliseconds to wait for the owner's handler when it is not registered yet. On timeout the call rejects with `OWNER_TIMEOUT`.",
            '处理函数尚未登记时最多等待的毫秒数。超时后调用以 `OWNER_TIMEOUT` 拒绝。'
          ),
          default: t(
            'Not set: the call rejects with `OWNER_ABSENT` at once when no handler is registered.',
            '不设置：没有处理函数时立即以 `OWNER_ABSENT` 拒绝。'
          ),
          example: `await view.requests.checkout({}, { waitForOwner: 3000 })`
        }
      }
    },
    IMicroResourceView: {
      summary: t(
        'What every app gets for one shared resource through `view.resources.<name>`.',
        '每个应用通过 `view.resources.<name>` 得到的某个共享异步值的视图。'
      ),
      scenarios: [
        t(
          'Several apps need the current user, and only one request should go out.',
          '多个应用都需要当前用户信息，但只应发出一次请求。'
        )
      ],
      example: resourceExample,
      members: {
        state: {
          summary: t(
            'Readable snapshot `{ status, data, error }`. Subscribing starts observing the resource; status is `idle` before the owner provides a fetcher.',
            '可读的快照 `{ status, data, error }`。订阅会开始观察该异步值；owner 提供获取函数之前状态为 `idle`。'
          )
        },
        read: {
          summary: t(
            'Returns the value: resolves at once when it exists, returns the same Promise while a request is running, and starts a request otherwise. Concurrent reads share one request.',
            '返回值：已有值时立即兑现；请求进行中返回同一个 Promise；否则发起请求。并发读取共享一次请求。'
          ),
          returns: t(
            'A Promise of the value. Rejects with `OWNER_ABSENT` when the owner has not provided a fetcher.',
            '值的 Promise。owner 尚未提供获取函数时以 `OWNER_ABSENT` 拒绝。'
          ),
          example: `const user = await view.resources.profile.read()`
        },
        refetch: {
          summary: t('Discards the cached value and requests again.', '丢弃缓存的值并重新请求。'),
          returns: t(
            'Nothing; the new request has started. Its failure lands in the resource state and goes to the hub `report`.',
            '无返回值；新的请求已经开始。失败会写入快照状态，并交给 hub 的 `report`。'
          ),
          example: `view.resources.profile.refetch()`
        }
      }
    },
    IMicroResourceState: {
      summary: t(
        'Snapshot of a shared resource, read through `view.resources.<name>.state`.',
        '共享异步值的快照，通过 `view.resources.<name>.state` 读取。'
      ),
      members: {
        status: {
          summary: t(
            'Current status of the resource, one of `MicroResourceStatus`.',
            '这个共享异步值当前的状态，取值见 `MicroResourceStatus`。'
          ),
          values: { enum: 'MicroResourceStatus' }
        },
        data: {
          summary: t(
            'The value when status is `success`; otherwise `undefined`.',
            '状态为 `success` 时的值；其它状态为 `undefined`。'
          )
        },
        error: {
          summary: t(
            'The failure when status is `error` or `cancelled`; otherwise `undefined`.',
            '状态为 `error` 或 `cancelled` 时的失败原因；其它状态为 `undefined`。'
          )
        }
      }
    },
    IMicroResourceFetcher: {
      summary: t(
        'Function the owner passes to `owned.provide()`: receives an `AbortSignal` and returns a Promise of the value. The signal aborts when the request is replaced or the owner releases it.',
        'owner 传给 `owned.provide()` 的函数：接收一个 `AbortSignal`，返回值的 Promise。请求被替换或 owner 释放时，该信号中止。'
      ),
      members: {}
    },
    IContract: {
      summary: t(
        'A frozen contract returned by `defineContract`. Share it between apps through a Module Federation expose; pass it to `use()` and `own()`.',
        '`defineContract` 返回的冻结契约。通过联邦模块暴露入口在应用之间共享，传给 `use()` 和 `own()`。'
      ),
      scenarios: [
        t(
          'Define the contract once in the owner team and import it in every app that uses it.',
          '由 owner 团队定义一次契约，在每个使用它的应用中导入。'
        )
      ],
      example: cartContract,
      members: {
        name: {
          summary: t(
            'The contract name given to `defineContract`; error messages and storage keys use it.',
            '传给 `defineContract` 的契约名；错误消息和存储键都使用它。'
          )
        },
        version: {
          summary: t(
            'Major version; every app using this name must agree on it.',
            '主版本；使用同一契约名的应用必须使用相同的版本。'
          )
        },
        state: {
          summary: t(
            'Initial field values and `keyed()` markers; initial values are cloned and frozen.',
            '字段初始值和 `keyed()` 标记；初始值会被复制并冻结。'
          )
        },
        computed: {
          summary: t(
            'Computed value functions of the contract, frozen.',
            '契约中的计算值函数，已经冻结，不能再修改。'
          )
        },
        commands: {
          summary: t(
            'Command functions of the contract, frozen.',
            '契约中的命令函数，已经冻结，不能再修改。'
          )
        },
        writers: {
          summary: t(
            'Apps besides the owner allowed to run commands; empty when only the owner may write.',
            '除 owner 外允许执行命令的应用名；只有 owner 能写时为空。'
          )
        },
        events: {
          summary: t(
            'Event markers created with `event()`, keyed by event name.',
            '用 `event()` 创建的事件标记，按事件名索引。'
          )
        },
        requests: {
          summary: t(
            'Request markers created with `request()`, keyed by request name.',
            '用 `request()` 创建的请求标记，按请求名索引。'
          )
        },
        resources: {
          summary: t(
            'Resource markers created with `resource()`.',
            '用 `resource()` 创建的共享异步值标记。'
          )
        }
      }
    },
    IContractSpec: {
      summary: t(
        'The second argument of `defineContract`: every section of a contract.',
        '`defineContract` 的第二个参数：契约的全部组成部分。'
      ),
      members: {
        version: {
          summary: t(
            'Positive integer major version. The first registration of a name decides it; another version later throws `CONTRACT_VERSION_MISMATCH`.',
            '正整数主版本。同名契约以第一次登记的版本为准，之后用其它版本登记抛 `CONTRACT_VERSION_MISMATCH`。'
          )
        },
        state: {
          summary: t(
            'Initial field values, or `keyed<T>()`. Values are copied with `structuredClone` and frozen at the top level, so they must be structured-cloneable.',
            '字段初始值，或 `keyed<T>()`。初始值用 `structuredClone` 复制后冻结顶层，因此必须可以结构化克隆。'
          )
        },
        computed: {
          summary: t(
            '`(state) => value` functions; each depends only on the fields it reads.',
            '`(state) => value` 形式的函数；每个只依赖它读取的字段。'
          )
        },
        commands: {
          summary: t(
            '`(state, ...args) => patch` functions. They must be synchronous and return only the fields to change.',
            '`(state, ...args) => patch` 形式的函数。必须同步，返回值只包含要修改的字段。'
          )
        },
        writers: {
          summary: t(
            'App names besides the owner that may call commands.',
            '除 owner 外可以调用命令的应用名。'
          )
        },
        events: {
          summary: t(
            '`event<T>()` markers; only the owner emits.',
            '`event<T>()` 标记；只有 owner 能发出这些事件。'
          )
        },
        requests: {
          summary: t(
            '`request<In, Out>()` markers; the owner registers one handler each.',
            '`request<In, Out>()` 标记；owner 为每个请求登记一个处理函数。'
          )
        },
        resources: {
          summary: t(
            '`resource<T>()` markers; the owner provides one fetcher each.',
            '`resource<T>()` 标记；owner 为每个共享异步值提供一个获取函数。'
          )
        }
      }
    },
    IContractTypes: {
      summary: t(
        'Type-level record of every section of one contract, carried by `IContract` so views are typed. Not used at runtime.',
        '一个契约各部分的类型记录，由 `IContract` 携带，使视图有正确的类型。运行时不使用。'
      ),
      members: {
        state: { summary: t('Type of the state section.', '契约状态部分在类型层面的记录。') },
        computed: {
          summary: t('Type of the computed section.', '契约计算值部分在类型层面的记录。')
        },
        commands: { summary: t('Type of the commands section.', '契约命令部分在类型层面的记录。') },
        events: { summary: t('Type of the events section.', '契约事件部分在类型层面的记录。') },
        requests: { summary: t('Type of the requests section.', '契约请求部分在类型层面的记录。') },
        resources: {
          summary: t('Type of the resources section.', '契约共享异步值部分在类型层面的记录。')
        }
      }
    },
    IContractTypesOf: {
      summary: t(
        'Extracts the `IContractTypes` record from a contract type, for typing helpers around a contract.',
        '从契约类型中取出 `IContractTypes` 记录，用于为契约编写带类型的辅助函数。'
      ),
      members: {}
    },
    IStateValues: {
      summary: t(
        'How state looks inside commands, computed values and selectors: plain fields as their values, `keyed()` fields as `IKeyedSnapshot`.',
        '状态在命令、计算值和选择函数中的样子：普通字段就是它的值，`keyed()` 字段是 `IKeyedSnapshot`。'
      ),
      members: {}
    },
    IStatePatch: {
      summary: t(
        'What a command returns: only the fields it changes. A `keyed()` field takes an id map in which `undefined` deletes the id; omitted fields and ids keep their values.',
        '命令的返回值：只包含要修改的字段。`keyed()` 字段接收 id 映射，值为 `undefined` 表示删除该 id；未出现的字段和 id 保持原值。'
      ),
      members: {}
    },
    IStateView: {
      summary: t(
        'The `state` section of a view: `IReadable` for plain fields, `IKeyedReadable` for `keyed()` fields.',
        '视图中的 `state` 部分：普通字段是 `IReadable`，`keyed()` 字段是 `IKeyedReadable`。'
      ),
      members: {}
    },
    IComputedView: {
      summary: t(
        'The `computed` section of a view: one `IReadable` per computed value.',
        '视图中的 `computed` 部分：每个计算值一个 `IReadable`。'
      ),
      members: {}
    },
    IEventView: {
      summary: t(
        'The `events` section of a consumer view: one `{ on(listener) }` per event.',
        '使用方视图中的 `events` 部分：每个事件一个 `{ on(listener) }`。'
      ),
      members: {}
    },
    IOwnedEventView: {
      summary: t(
        'The `events` section of an owned contract: `on(listener)` plus `emit(payload)` per event.',
        'owner 拿到的 `events` 部分：每个事件有 `on(listener)` 和 `emit(payload)`。'
      ),
      members: {}
    },
    IEventMarker: {
      summary: t(
        'Marker returned by `event<T>()`; the payload type exists only at the type level.',
        '`event<T>()` 返回的标记；载荷类型只存在于类型层面。'
      ),
      scenarios: [
        t(
          'Declare which events a contract has and what payload each carries.',
          '声明契约有哪些事件，以及每个事件携带什么载荷。'
        )
      ],
      example: `defineContract('cart', { version: 1, events: { checkedOut: event<{ orderId: string }>() } })`,
      members: {
        marker: {
          summary: t(
            'Marker kind read by the hub; always `event`.',
            'hub 读取的标记种类，固定为 `event`。'
          )
        }
      }
    },
    IRequestMarker: {
      summary: t(
        'Marker returned by `request<In, Out>()`; input and output types exist only at the type level.',
        '`request<In, Out>()` 返回的标记；输入和输出类型只存在于类型层面。'
      ),
      scenarios: [
        t(
          'Declare a request the owner answers, with its input and output types.',
          '声明一个由 owner 应答的请求，以及它的输入和输出类型。'
        )
      ],
      example: `defineContract('cart', { version: 1, requests: { checkout: request<{ coupon?: string }, { orderId: string }>() } })`,
      members: {
        marker: {
          summary: t(
            'Marker kind read by the hub; always `request`.',
            'hub 读取的标记种类，固定为 `request`。'
          )
        }
      }
    },
    IKeyedMarker: {
      summary: t(
        'Marker returned by `keyed<T>()`; the entity type exists only at the type level.',
        '`keyed<T>()` 返回的标记；实体类型只存在于类型层面。'
      ),
      scenarios: [
        t(
          'Declare an entity table whose ids are subscribed one by one.',
          '声明一个按 id 逐个订阅的实体表。'
        )
      ],
      example: `defineContract('catalog', { version: 1, state: { products: keyed<IProduct>() } })`,
      members: {
        marker: {
          summary: t(
            'Marker kind read by the hub; always `keyed`.',
            'hub 读取的标记种类，固定为 `keyed`。'
          )
        }
      }
    },
    IResourceMarker: {
      summary: t(
        'Marker returned by `resource<T>()`; the value type exists only at the type level.',
        '`resource<T>()` 返回的标记；值的类型只存在于类型层面。'
      ),
      scenarios: [
        t(
          'Declare a value the owner loads once for every app.',
          '声明一个由 owner 为所有应用加载一次的值。'
        )
      ],
      example: `defineContract('session', { version: 1, resources: { profile: resource<IUser>() } })`,
      members: {
        marker: {
          summary: t(
            'Marker kind read by the hub; always `resource`.',
            'hub 读取的标记种类，固定为 `resource`。'
          )
        }
      }
    },
    IMicroHubErrorCode: {
      summary: t(
        'The union of every `MicroHubErrorCode` value.',
        '`MicroHubErrorCode` 全部错误码组成的联合类型。'
      ),
      members: {}
    },
    IMicroPlugin: {
      summary: t(
        'A capability plugin as `createMicroHub({ plugins })` takes it. Its kind and dependencies are readable before installation, so the hub rejects a missing dependency without side effects.',
        '`createMicroHub({ plugins })` 接收的能力插件。安装前就能读到它的种类和依赖，因此 hub 能在没有副作用的情况下拒绝缺失的依赖。'
      ),
      scenarios: [
        t(
          "Pass the plugins a page needs to `createMicroHub`, or check a plugin's kind and dependencies before installing it.",
          '把页面需要的插件传给 `createMicroHub`，或在安装前检查插件的种类和依赖。'
        )
      ],
      example: `const plugins = [events(), state(), persist({ store })]
console.log(plugins.map((plugin) => [plugin.kind, plugin.requires]))
createMicroHub({ plugins })`,
      members: {
        kind: {
          summary: t(
            'The capability this plugin provides, one of `MicroCapability`.',
            '这个插件提供的能力，取值见 `MicroCapability`。'
          )
        },
        requires: {
          summary: t(
            'Capabilities that must be installed with it; `persist()` requires `state`.',
            '必须一同安装的能力；例如 `persist()` 依赖 `state`。'
          )
        },
        bind: {
          summary: t(
            'Called by the hub during `createMicroHub` to build the plugin for that hub; applications do not call it.',
            '由 hub 在 `createMicroHub` 期间调用，为该 hub 构建插件；应用代码不调用它。'
          )
        }
      }
    },
    IEventsOptions: {
      summary: t(
        'Options of the `events()` plugin.',
        '`events()` 插件的选项，用来限制一次发出事件引发的监听调用次数。'
      ),
      members: {
        publishBudget: {
          summary: t(
            'Maximum listener calls one top-level `emit` may cause, nested emits included. When reached, delivery stops and the overflow goes to `report`; this stops two apps that emit in reaction to each other from looping forever.',
            '一次顶层 `emit` 最多引发的监听调用次数，包括其中再次发出的事件。达到上限时停止分发，并把超出情况交给 `report`；这样可以防止两个应用互相触发事件形成死循环。'
          ),
          default: t(
            '`10000`: enough for ordinary fan-out, low enough to stop a loop quickly.',
            '`10000`：足够普通的分发，又能很快截断循环。'
          ),
          example: `events({ publishBudget: 1000 })`
        }
      }
    },
    IPersistOptions: {
      summary: t(
        'Options of the `persist()` plugin: where and how often fields are written.',
        '`persist()` 插件的选项：字段写到哪里、多久写一次。'
      ),
      members: {
        store: {
          summary: t(
            'Key-value store the persisted fields are written to, for example `localStorageHost({ namespace })` or `indexedDbHost({ dbName })` from `@migaia/storage-web`. The hub borrows it and never disposes it.',
            '持久化字段写入的键值存储，例如 `@migaia/storage-web` 中的 `localStorageHost({ namespace })` 或 `indexedDbHost({ dbName })`。hub 只借用它，不会释放它。'
          ),
          example: `persist({ store: localStorageHost({ namespace: 'shop' }) })`
        },
        debounceMs: {
          summary: t(
            'Quiet period after a commit before the fields are written.',
            '提交后等待多少毫秒没有新提交，再写入字段。'
          ),
          default: t('`0`: write after each commit.', '`0`：每次提交后都写入。'),
          example: `persist({ store, debounceMs: 200 })`
        },
        keyPrefix: {
          summary: t(
            'Prefix prepended to every storage key, so several hubs can share one store.',
            '加在每个存储键前面的前缀，让多个 hub 可以共用一个存储。'
          ),
          default: t(
            '`micro-hub:`, so keys read like `micro-hub:cart`.',
            '`micro-hub:`，存储键形如 `micro-hub:cart`。'
          ),
          example: `persist({ store, keyPrefix: 'shop:' })`
        }
      }
    },
    IStateDriver: {
      summary: t(
        'State driver returned by `stateDriverOf`, for capability plugins that build on state. Applications use views instead.',
        '`stateDriverOf` 返回的状态驱动，供基于状态的能力插件使用。应用代码请使用视图。'
      ),
      scenarios: [
        t(
          'Write a capability plugin that reads or restores plain state fields, as `persist()` does.',
          '编写一个读取或写回普通状态字段的能力插件，就像 `persist()` 那样。'
        )
      ],
      example: `const driver = stateDriverOf(hub)
const def = driver.plainField(entry, 'items')
if (def) driver.write(entry, { items: restored })`,
      members: {
        kind: {
          summary: t(
            'Always `state`: this driver serves the state capability.',
            '固定为 `state`，表示这是状态能力的驱动。'
          )
        },
        runtime: {
          summary: t(
            "The reactive runtime of the hub's state; graph errors go to the hub `report`.",
            'hub 状态所用的响应式运行时；依赖图中的错误交给 hub 的 `report`。'
          )
        },
        store: {
          summary: t(
            "The atom store holding every contract's fields.",
            '存放所有契约字段的原子存储。'
          )
        },
        plainField: {
          summary: t(
            "Returns the atom of a plain field, registering the contract's state on first access.",
            '返回某个普通字段的原子，第一次访问时登记该契约的状态。'
          ),
          params: {
            entry: t(
              "The hub's record of the contract, received by the plugin's driver.",
              'hub 中该契约的记录，由插件的驱动收到。'
            ),
            field: t('Field name declared in the contract.', '契约中声明的字段名。')
          },
          returns: t(
            'The atom definition, or `undefined` for a keyed or unknown field.',
            '原子定义；`keyed()` 字段或未知字段返回 `undefined`。'
          ),
          example: `const def = stateDriverOf(hub).plainField(entry, 'items')`
        },
        write: {
          summary: t(
            'Commits a patch without the write-permission check, bumping the revision like a command. Used by persistence to restore read-back fields.',
            '不做写权限检查地提交一个补丁，并像命令一样增加提交次数。持久化用它写回读出的字段。'
          ),
          params: {
            entry: t("The hub's record of the contract.", 'hub 中该契约的记录。'),
            patch: t(
              'Fields to write, in the same shape a command returns.',
              '要写入的字段，形状与命令返回值相同。'
            )
          },
          returns: t('The new revision.', '新的提交次数。'),
          example: `stateDriverOf(hub).write(entry, { items: restored })`
        },
        view: {
          summary: t(
            'Builds the state members of a view; called by the hub.',
            '构建视图中与状态有关的成员；由 hub 调用。'
          ),
          params: {
            entry: t("The hub's record of the contract.", 'hub 中该契约的记录。'),
            app: t('Runtime of the app the view belongs to.', '视图所属应用的运行时。')
          },
          returns: t('The members to merge into the view.', '要合并进视图的成员。'),
          example: `const members = stateDriverOf(hub).view(entry, app)`
        },
        own: {
          summary: t(
            'Builds extra owner members; the state driver adds none.',
            '构建 owner 额外的成员；状态驱动不添加任何成员。'
          ),
          params: {
            entry: t("The hub's record of the contract.", 'hub 中该契约的记录。'),
            app: t('Runtime of the owner app.', 'owner 应用的运行时。'),
            options: t('The options passed to `own()`.', '传给 `own()` 的选项。')
          },
          returns: t(
            'The members to merge into the owned contract.',
            '要合并进 owner 对象的成员。'
          ),
          example: `const members = stateDriverOf(hub).own?.(entry, app, {})`
        },
        dispose: {
          summary: t(
            'Releases the state store when the hub is disposed; called by the hub.',
            'hub 释放时释放状态存储；由 hub 调用。'
          ),
          returns: t(
            'Nothing, or a Promise when cleanup is asynchronous.',
            '无返回值；清理是异步时返回 Promise。'
          ),
          example: `await stateDriverOf(hub).dispose?.()`
        }
      }
    }
  },
  enums: {
    MicroCapability: {
      summary: t(
        'Capability kinds: the `kind` of each plugin and the names in `PLUGIN_MISSING` messages.',
        '能力种类：每个插件的 `kind`，也是 `PLUGIN_MISSING` 消息中出现的名字。'
      ),
      values: {
        events: t(
          '`events`: contract events and requests, provided by `events()`.',
          '`events`：契约中的事件和请求，由 `events()` 提供。'
        ),
        state: t(
          '`state`: state, computed values, commands and `select`, provided by `state()`.',
          '`state`：状态、计算值、命令和 `select`，由 `state()` 提供。'
        ),
        persist: t(
          '`persist`: field persistence for owners, provided by `persist()`; needs `state`.',
          '`persist`：owner 的字段持久化，由 `persist()` 提供；依赖 `state`。'
        ),
        resource: t(
          '`resource`: shared asynchronous values, provided by `resources()`.',
          '`resource`：由所有应用共享的异步值，由 `resources()` 提供。'
        )
      }
    },
    MicroResourceStatus: {
      summary: t(
        'Status of a shared resource snapshot (`IMicroResourceState.status`).',
        '共享异步值快照的状态（`IMicroResourceState.status`）。'
      ),
      values: {
        idle: t(
          '`idle`: the owner has not provided a fetcher yet, or nothing has been requested.',
          '`idle`：owner 尚未提供获取函数，或尚未发起请求。'
        ),
        pending: t(
          '`pending`: a request is running; `data` keeps no value yet.',
          '`pending`：请求正在进行，`data` 中还没有值。'
        ),
        success: t(
          '`success`: the last request succeeded and `data` holds the value.',
          '`success`：最近一次请求成功，`data` 中是获取到的值。'
        ),
        error: t(
          '`error`: the last request failed; `error` holds why.',
          '`error`：最近一次请求失败，原因在 `error` 中。'
        ),
        cancelled: t(
          '`cancelled`: the request was replaced by a newer one or the owner released it.',
          '`cancelled`：请求被新的请求取代，或 owner 已释放。'
        )
      }
    },
    MicroHubErrorCode: {
      summary: t(
        'Codes on errors this package throws (`error.code`).',
        '本包抛出的每个错误上都带有的 `error.code` 取值。'
      ),
      values: {
        hubAlreadyCreated: t(
          '`HUB_ALREADY_CREATED`: `createMicroHub` was called while a hub exists. Child apps use `getMicroHub()`.',
          '`HUB_ALREADY_CREATED`：已有 hub 时再次调用 `createMicroHub`。子应用请使用 `getMicroHub()`。'
        ),
        hubNotCreated: t(
          '`HUB_NOT_CREATED`: no hub exists, or it has been disposed. Create it in the shell first.',
          '`HUB_NOT_CREATED`：hub 不存在或已释放。请先在主应用中创建。'
        ),
        appAlreadyConnected: t(
          '`APP_ALREADY_CONNECTED`: an app with the same name is still connected. Disconnect the old instance first.',
          '`APP_ALREADY_CONNECTED`：同名应用仍在连接。请先断开旧实例。'
        ),
        appDisconnected: t(
          '`APP_DISCONNECTED`: a handle or view was used after disconnecting. Connect again.',
          '`APP_DISCONNECTED`：断开后继续使用句柄或视图。请重新连接。'
        ),
        pluginMissing: t(
          '`PLUGIN_MISSING`: a contract or a plugin needs a capability that is not installed. Add the plugin to `plugins`.',
          '`PLUGIN_MISSING`：契约或插件需要的能力未安装。请把对应插件加入 `plugins`。'
        ),
        contractVersionMismatch: t(
          '`CONTRACT_VERSION_MISMATCH`: a contract name was used with another major version. Align the deployed versions.',
          '`CONTRACT_VERSION_MISMATCH`：同名契约使用了不同的主版本。请统一部署的版本。'
        ),
        contractOwned: t(
          '`CONTRACT_OWNED`: the contract already has an owner. Wait for it to disconnect or call `release()`.',
          '`CONTRACT_OWNED`：契约已有 owner。等待它断开或调用 `release()`。'
        ),
        writeDenied: t(
          '`WRITE_DENIED`: the caller is neither the owner nor in `writers`. Add it to `writers`, or use a request.',
          '`WRITE_DENIED`：调用方既不是 owner 也不在 `writers` 中。把它加入 `writers`，或改用请求。'
        ),
        emitDenied: t(
          '`EMIT_DENIED`: an owner-only member (emit, handle, provide) was called after `release()`. Claim ownership again.',
          '`EMIT_DENIED`：`release()` 之后调用了 owner 专属成员（`emit`、`handle`、`provide`）。请重新认领。'
        ),
        commandAsync: t(
          '`COMMAND_ASYNC`: a command returned a thenable; nothing was written. Finish asynchronous work before calling the command.',
          '`COMMAND_ASYNC`：命令返回了 thenable，没有写入任何字段。请先完成异步工作再调用命令。'
        ),
        handlerDuplicated: t(
          '`HANDLER_DUPLICATED`: `handle` or `provide` was registered twice for one name. Remove the duplicate.',
          '`HANDLER_DUPLICATED`：同一个名字重复调用 `handle` 或 `provide`。请去掉重复的登记。'
        ),
        ownerAbsent: t(
          '`OWNER_ABSENT`: no handler or fetcher is registered. Pass `waitForOwner`, or retry later.',
          '`OWNER_ABSENT`：没有登记处理函数或获取函数。传入 `waitForOwner`，或稍后重试。'
        ),
        ownerTimeout: t(
          '`OWNER_TIMEOUT`: waiting for a handler timed out. Report the failure, or retry later.',
          '`OWNER_TIMEOUT`：等待处理函数超时。报告失败，或稍后重试。'
        ),
        ownerGone: t(
          '`OWNER_GONE`: the owner left while a request was in progress; side effects may have happened. Reconcile before retrying.',
          '`OWNER_GONE`：请求进行中 owner 离开，副作用可能已经发生。重试前先核对状态。'
        ),
        invalidOption: t(
          '`INVALID_OPTION` (`TypeError`): a name, version, contract member or patch field is invalid. Fix the call.',
          '`INVALID_OPTION`（`TypeError`）：名字、版本、契约成员或补丁字段非法。请修正调用。'
        )
      }
    }
  },
  enhancers: {
    events: {
      kind: 'plugin',
      target: 'IMicroHub',
      summary: t(
        'Adds contract events and requests to every view. Without it, a contract that declares `events` or `requests` throws `PLUGIN_MISSING` at `use()` and `own()`.',
        '为每个视图加入契约中的事件和请求。未安装时，声明了 `events` 或 `requests` 的契约在 `use()` 和 `own()` 时抛 `PLUGIN_MISSING`。'
      ),
      install: `createMicroHub({ plugins: [events()] })`,
      grants: [
        {
          signature: 'view.events.<name>.on(listener)',
          summary: t(
            'Listens to an event of the contract until the returned function is called or the app disconnects.',
            '监听契约中的某个事件，直到调用返回的函数或应用断开。'
          ),
          params: {
            listener: t(
              'Receives the payload; errors it throws go to `report` and do not stop other listeners.',
              '接收事件载荷；它抛出的错误交给 `report`，不会打断其它监听函数。'
            )
          },
          returns: t('A function that stops listening.', '停止监听的函数。'),
          example: `const stop = view.events.checkedOut.on(({ orderId }) => toast(orderId))`
        },
        {
          signature: 'owned.events.<name>.emit(payload)',
          summary: t(
            'Delivers a payload to every listener synchronously, in registration order. Listener failures and budget overflow go to `report`, never to the emitter.',
            '按登记顺序同步把载荷分发给每个监听函数。监听失败和超出调用上限的情况交给 `report`，不会抛给发出方。'
          ),
          params: { payload: t('Payload of the declared event type.', '契约中声明的事件载荷。') },
          returns: t(
            'Nothing; every listener has run when the call returns, except emits queued from inside listeners. Throws `EMIT_DENIED` after `release()`.',
            '无返回值；调用返回时所有监听函数都已执行，监听函数内部再次发出的事件除外。`release()` 之后调用抛 `EMIT_DENIED`。'
          ),
          example: `owned.events.checkedOut.emit({ orderId })`
        },
        {
          signature: 'view.requests.<name>(input, options?)',
          summary: viewMembers.requests.summary,
          params: {
            input: t('Input of the declared request type.', '契约中声明的请求输入。'),
            options: t(
              '`IRequestOptions`, for example `waitForOwner`.',
              '请求选项 `IRequestOptions`，例如等待时长 `waitForOwner`。'
            )
          },
          returns: t(
            "A Promise of the handler's result; a handler error rejects it unchanged.",
            '处理函数结果的 Promise；处理函数抛出的错误原样拒绝。'
          ),
          example: `const { orderId } = await view.requests.checkout({}, { waitForOwner: 3000 })`
        },
        {
          signature: 'owned.handle(name, handler)',
          summary: t(
            'Registers the single handler of a request.',
            '登记某个请求唯一的处理函数，之后所有应用的调用都由它应答。'
          ),
          params: {
            name: t('Request name declared in the contract.', '契约中声明的请求名。'),
            handler: t(
              'Receives the input and returns the output or a Promise of it.',
              '接收输入，返回输出或输出的 Promise。'
            )
          },
          returns: t('A function that unregisters the handler.', '注销处理函数的函数。'),
          example: `const unhandle = owned.handle('checkout', async (input) => checkout(input))`
        }
      ],
      scenarios: [
        t(
          'Tell every app that an order was placed, and let any app ask the cart to check out.',
          '通知所有应用订单已提交，并让任何应用都能请求购物车结账。'
        )
      ],
      example: `createMicroHub({ plugins: [events()] })
const owned = getMicroHub().connect('cart').own(cart)
owned.handle('checkout', async () => ({ orderId: await submitOrder() }))
const view = getMicroHub().connect('product').use(cart)
view.events.checkedOut.on(({ orderId }) => toast(orderId))
await view.requests.checkout({})`
    },
    state: {
      kind: 'plugin',
      target: 'IMicroHub',
      summary: t(
        'Adds contract state, computed values, commands, `revision` and `select` to every view. Without it, a contract that declares `state`, `computed` or `commands` throws `PLUGIN_MISSING`, and `select` throws as well.',
        '为每个视图加入契约中的状态、计算值、命令、`revision` 和 `select`。未安装时，声明了 `state`、`computed` 或 `commands` 的契约抛 `PLUGIN_MISSING`，调用 `select` 也会抛错。'
      ),
      install: `createMicroHub({ plugins: [state()] })`,
      grants: stateGrants,
      scenarios: [
        t(
          'Share a cart between the product list and the header badge, with each one re-rendering only for the fields it reads.',
          '在商品列表和页头角标之间共享购物车，每一方只在自己读取的字段变化时重新渲染。'
        )
      ],
      example: `createMicroHub({ plugins: [state()] })
const view = getMicroHub().connect('product').use(cart)
view.commands.add({ id: 'sku-1', price: 42 })
const stop = view.computed.total.subscribe(() => render(view.computed.total.get()))
stop()`
    },
    persist: {
      kind: 'plugin',
      target: 'IMicroHub',
      summary: t(
        'Lets owners persist selected plain fields. Without it, `own(contract, { persist })` throws `PLUGIN_MISSING`. Use it together with `state()`; the hub refuses to install it alone.',
        '让 owner 持久化选定的普通字段。未安装时，`own(contract, { persist })` 抛 `PLUGIN_MISSING`。需与 `state()` 一起使用，单独安装会被 hub 拒绝。'
      ),
      install: `createMicroHub({ plugins: [state(), persist({ store: localStorageHost({ namespace: 'shop' }) })] })`,
      grants: [
        {
          signature: 'app.own(contract, { persist, persistKey })',
          summary: t(
            'Writes the listed plain fields to the store after commits and reads them back when the owner starts. Writes made while reading back are not overwritten; a major version change discards the old data.',
            '提交后把列出的普通字段写入存储，并在 owner 启动时读回。读回期间发生的写入不会被覆盖；主版本变化时丢弃旧数据。'
          ),
          params: {
            contract: t('The contract to own.', '要认领的契约。'),
            options: t(
              '`IOwnOptions` with `persist` and optional `persistKey`.',
              '包含 `persist` 和可选 `persistKey` 的 `IOwnOptions`。'
            )
          },
          returns: t(
            'The owned contract; `owned.persistence.ready` resolves after the first successful read-back.',
            'owner 对象；`owned.persistence.ready` 在首次读回成功后兑现。'
          ),
          example: `const owned = app.own(cart, { persist: ['items'] })
await owned.persistence?.ready`
        }
      ],
      scenarios: [
        t(
          'Keep the cart across page reloads without each app writing to storage itself.',
          '刷新页面后保留购物车内容，不需要每个应用自己写存储。'
        )
      ],
      example: persistExample
    },
    resources: {
      kind: 'plugin',
      target: 'IMicroHub',
      summary: t(
        'Adds shared asynchronous values: the owner provides a fetcher, every app reads the same value, and concurrent reads share one request. Without it, a contract that declares `resources` throws `PLUGIN_MISSING`.',
        '加入共享异步值：owner 提供获取函数，所有应用读到同一个值，并发读取共享一次请求。未安装时，声明了 `resources` 的契约抛 `PLUGIN_MISSING`。'
      ),
      install: `createMicroHub({ plugins: [resources()] })`,
      grants: [
        {
          signature: 'owned.provide(name, fetcher)',
          summary: t('Registers the fetcher of a resource.', '登记某个共享异步值的获取函数。'),
          params: {
            name: t('Resource name declared in the contract.', '契约中声明的共享异步值名。'),
            fetcher: t(
              'Receives an `AbortSignal` and returns a Promise of the value.',
              '接收一个 `AbortSignal`，返回值的 Promise。'
            )
          },
          returns: t('A function that unregisters the fetcher.', '注销获取函数的函数。'),
          example: `owned.provide('profile', (signal) => fetch('/api/me', { signal }).then((r) => r.json()))`
        },
        {
          signature: 'view.resources.<name>.read()',
          summary: t(
            'Reads the value, starting a request when needed; concurrent reads share one request.',
            '读取值，必要时发起请求；并发读取共享一次请求。'
          ),
          returns: t(
            'A Promise of the value; rejects with `OWNER_ABSENT` before the owner provides a fetcher.',
            '值的 Promise；owner 提供获取函数之前以 `OWNER_ABSENT` 拒绝。'
          ),
          example: `const user = await view.resources.profile.read()`
        }
      ],
      scenarios: [
        t(
          'Load the signed-in user once for the header, the sidebar and the checkout app.',
          '为页头、侧边栏和结账应用只加载一次当前登录用户。'
        )
      ],
      example: resourceExample
    }
  }
}
