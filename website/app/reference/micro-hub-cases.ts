import type { ICaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/**
 * Problems micro-hub solves, each told as the symptom, why the usual approach fails and how the API
 * fixes it, then a runnable example and its observed output. Every example was run with Node 24
 * against the built package and its printed output is described in `result`.
 */
export const microHubCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createMicroHub: [
    {
      title: t('Keep one hub across all remotes', '让所有子应用共用一个 hub'),
      problem: t(
        "The product remote adds an item to the cart, but the header in the shell still shows an empty cart, and nothing reports an error.\n\nThe usual cause is that each app ends up with its own copy of the shared store: a remote creates the store again when it starts, or Module Federation loads the remote's own copy of the package because its version range does not match the shell's. Each copy works on its own, so the split stays silent.\n\nOnly the shell calls `createMicroHub`; every other app calls `getMicroHub()`. A second `createMicroHub` on the same page throws `HUB_ALREADY_CREATED`, and a remote that loaded its own copy of the package finds no hub in it, so `getMicroHub()` throws `HUB_NOT_CREATED` instead of handing out a private copy.",
        '商品子应用往购物车里加了一件商品，主应用页头的购物车却还是空的，而且没有任何报错。\n\n常见原因是每个应用各自拿到了一份共享存储：子应用启动时又创建了一次存储，或者子应用的版本范围和主应用对不上，联邦模块于是加载了子应用自带的那份包。每一份都能单独工作，所以状态分裂了也没人发现。\n\n只有主应用调用 `createMicroHub`，其它应用都调用 `getMicroHub()`。同一页面上第二次调用 `createMicroHub` 会抛 `HUB_ALREADY_CREATED`；子应用如果加载了自带的那份包，那份包里没有 hub，`getMicroHub()` 会抛 `HUB_NOT_CREATED`，而不是交出一个只有自己能看到的 hub。'
      ),
      example: {
        en: `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

// Shell bootstrap: the only place that creates the hub
const hub = createMicroHub({ plugins: [state()] })

// A remote that tries to create a hub of its own
try {
  createMicroHub({ plugins: [state()] })
} catch (error) {
  console.log('second hub:', (error as { code?: string }).code)
}

// Every app connects to the hub the shell created
getMicroHub().connect('product')
getMicroHub().connect('cart')
console.log('same hub:', getMicroHub() === hub)
console.log('apps:', getMicroHub().apps)
await hub.dispose()`,
        zh: `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

// 主应用启动：唯一创建 hub 的地方
const hub = createMicroHub({ plugins: [state()] })

// 某个子应用也想创建自己的 hub
try {
  createMicroHub({ plugins: [state()] })
} catch (error) {
  console.log('第二个 hub：', (error as { code?: string }).code)
}

// 所有应用都连到主应用创建的 hub
getMicroHub().connect('product')
getMicroHub().connect('cart')
console.log('同一个 hub：', getMicroHub() === hub)
console.log('已连接：', getMicroHub().apps)
await hub.dispose()`
      },
      result: t(
        "The second call prints `second hub: HUB_ALREADY_CREATED`; then `same hub: true` and `apps: [ 'product', 'cart' ]` show both apps in the one hub the shell created.\n\nDeclare `@migaia/micro-hub` as a Module Federation `singleton` with the same version range in the shell and in every remote, so the page loads one copy of the package.",
        "第二次调用打印 `第二个 hub： HUB_ALREADY_CREATED`；接着 `同一个 hub： true` 和 `已连接： [ 'product', 'cart' ]` 说明两个应用都在主应用创建的那个 hub 里。\n\n在主应用和每个子应用的联邦模块配置中，都把 `@migaia/micro-hub` 声明为 `singleton`，并使用相同的版本范围，让整个页面只加载一份包。"
      )
    }
  ],
  getMicroHub: [
    {
      title: t('Unmount an app without leftover callbacks', '卸载应用不留下回调'),
      problem: t(
        'After the badge app is unmounted and mounted again, every cart change prints twice, and a toast still appears from the copy that was unmounted.\n\nEach mount registers subscriptions and listeners in several places. The unmount code has to remember every one of them; one forgotten call keeps the old callback alive, and remounting adds a second one.\n\nEach app connects once with `getMicroHub().connect(name)`, and everything it registers through that handle and its views belongs to the app. One `disconnect()` releases all of it synchronously, so no callback reaches the unmounted app, and the same name can connect again right away.',
        '角标应用卸载后再次挂载，购物车每变化一次就打印两遍，已经卸载的那份还会弹出提示。\n\n每次挂载都会在好几个地方登记订阅和监听。卸载代码必须记得逐个取消；漏掉一个，旧回调就一直活着，重新挂载后又多出一份。\n\n每个应用用 `getMicroHub().connect(name)` 连接一次，通过这个句柄和它返回的视图登记的一切都归属这个应用。调用一次 `disconnect()` 就会同步释放全部登记，保证不会有回调到达已卸载的应用，而且可以立即以同名重新连接。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, event, getMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'

const cart = defineContract('cart', {
  version: 1,
  state: { count: 0 },
  commands: { setCount: (_s, count: number) => ({ count }) },
  events: { checkedOut: event<{ orderId: string }>() }
})

const hub = createMicroHub({ plugins: [events(), state()] })
const owned = getMicroHub().connect('cart').own(cart)

// Mount code of the badge app; it registers a subscription and a listener
function mountBadge() {
  const app = getMicroHub().connect('badge')
  const view = app.use(cart)
  view.state.count.subscribe(() => console.log('badge count:', view.state.count.get()))
  view.events.checkedOut.on(({ orderId }) => console.log('badge toast:', orderId))
  return app
}

const badge = mountBadge()
owned.commands.setCount(1)
await badge.disconnect() // unmount: one call releases everything the badge registered
mountBadge() // remount under the same name
owned.commands.setCount(2)
owned.events.checkedOut.emit({ orderId: 'A-1' })
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, event, getMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'

const cart = defineContract('cart', {
  version: 1,
  state: { count: 0 },
  commands: { setCount: (_s, count: number) => ({ count }) },
  events: { checkedOut: event<{ orderId: string }>() }
})

const hub = createMicroHub({ plugins: [events(), state()] })
const owned = getMicroHub().connect('cart').own(cart)

// 角标应用的挂载代码：登记一个订阅和一个事件监听
function mountBadge() {
  const app = getMicroHub().connect('badge')
  const view = app.use(cart)
  view.state.count.subscribe(() => console.log('角标数量：', view.state.count.get()))
  view.events.checkedOut.on(({ orderId }) => console.log('角标提示：', orderId))
  return app
}

const badge = mountBadge()
owned.commands.setCount(1)
await badge.disconnect() // 卸载：一次调用释放角标登记的全部内容
mountBadge() // 以同名重新挂载
owned.commands.setCount(2)
owned.events.checkedOut.emit({ orderId: 'A-1' })
await hub.dispose()`
      },
      result: t(
        'Each line is printed once: `badge count: 1` from before the unmount, then `badge count: 2` and `badge toast: A-1` from the new mount.\n\nWhile an app with the same name is still connected, `connect` throws `APP_ALREADY_CONNECTED`, so mounting twice without unmounting fails at once instead of producing duplicate callbacks.',
        '每行只打印一次：卸载前的 `角标数量： 1`，以及重新挂载后的 `角标数量： 2` 和 `角标提示： A-1`。\n\n同名应用仍在连接时，`connect` 会抛 `APP_ALREADY_CONNECTED`，所以没卸载就再次挂载会立即报错，而不是产生重复的回调。'
      )
    }
  ],
  defineContract: [
    {
      title: t('Catch incompatible deployments', '发现不兼容的部署'),
      problem: t(
        'The cart team releases version 2, which replaces `items` with `lines`. The product remote was built last week against version 1 and keeps running.\n\nWithout a version check, the product remote reads a field that no longer exists and writes the old shape back. Both apps keep working with wrong data, and the first sign of it is a bug report.\n\nEvery contract carries a major `version`. The first app that uses a contract name fixes its version in the hub; a later `use()` or `own()` with another version throws `CONTRACT_VERSION_MISMATCH` before the app can read or write anything.',
        '购物车团队发布了版本 2，用 `lines` 取代了 `items`。商品子应用上周按版本 1 构建，现在仍在运行。\n\n没有版本检查时，商品子应用会读取一个已经不存在的字段，再把旧结构写回去。两个应用都还在运行，数据却是错的，直到有人报 bug 才发现。\n\n每个契约都带一个主版本号 `version`。第一个使用某个契约名的应用决定了它在 hub 中的版本；之后以其它版本调用 `use()` 或 `own()` 会抛 `CONTRACT_VERSION_MISMATCH`，应用在读写任何数据之前就被拦下。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

type ILine = { sku: string; qty: number }

// Shipped by the cart team: version 2 replaces items with lines
const cartV2 = defineContract('cart', { version: 2, state: { lines: [] as readonly ILine[] } })
// Still bundled into a product remote built last week
const cartV1 = defineContract('cart', { version: 1, state: { items: [] as readonly string[] } })

const hub = createMicroHub({ plugins: [state()] })
getMicroHub().connect('cart').own(cartV2)
try {
  getMicroHub().connect('product').use(cartV1)
} catch (error) {
  console.log((error as { code?: string }).code)
  console.log((error as Error).message)
}
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

type ILine = { sku: string; qty: number }

// 购物车团队已发布：版本 2 用 lines 取代 items
const cartV2 = defineContract('cart', { version: 2, state: { lines: [] as readonly ILine[] } })
// 上周构建的商品子应用里打包的仍是版本 1
const cartV1 = defineContract('cart', { version: 1, state: { items: [] as readonly string[] } })

const hub = createMicroHub({ plugins: [state()] })
getMicroHub().connect('cart').own(cartV2)
try {
  getMicroHub().connect('product').use(cartV1)
} catch (error) {
  console.log((error as { code?: string }).code)
  console.log((error as Error).message)
}
await hub.dispose()`
      },
      result: t(
        'The product remote prints `CONTRACT_VERSION_MISMATCH` and the message `[micro-hub] contract "cart" is registered with version 2, got 1`.\n\nCatch the error where the remote mounts and show a fallback. When the major version of a shared contract changes, deploy the owner and the apps that use it together.',
        '商品子应用打印 `CONTRACT_VERSION_MISMATCH` 和消息 `[micro-hub] contract "cart" is registered with version 2, got 1`。\n\n在子应用挂载处捕获这个错误并显示降级界面。共享契约的主版本变化时，把 owner 和使用它的应用一起部署。'
      )
    },
    {
      title: t('Decide which apps may write', '规定哪些应用可以写入'),
      problem: t(
        'The cart shows an item nobody remembers adding. Any app on the page could have changed the shared state, so finding the cause means searching every remote.\n\nA shared store that every app imports can be written by every app. Agreeing in a document that only some apps write does not stop a new remote from calling the setter.\n\nA contract has one owner at a time, and `writers` lists the other apps allowed to call its commands. A command from any other app throws `WRITE_DENIED` and writes nothing, so the apps that can change the cart are listed in the contract itself.',
        '购物车里出现了一件谁也不记得加过的商品。页面上任何应用都可能改过共享状态，要找原因只能把每个子应用都翻一遍。\n\n每个应用都能导入的共享存储，每个应用也都能写。在文档里约定只有某些应用写入，拦不住新来的子应用直接调用写入方法。\n\n一个契约同一时刻只有一个 owner，`writers` 列出另外哪些应用可以调用它的命令。其它应用调用命令会抛 `WRITE_DENIED`，而且不写入任何字段，所以能修改购物车的应用都写在契约里。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly string[] },
  commands: { add: (s, sku: string) => ({ items: [...s.items, sku] }) },
  writers: ['product'] // besides the owner, only the product app may write
})

const hub = createMicroHub({ plugins: [state()] })
getMicroHub().connect('cart').own(cart)
getMicroHub().connect('product').use(cart).commands.add('sku-1')

const header = getMicroHub().connect('header').use(cart)
try {
  header.commands.add('sku-2')
} catch (error) {
  console.log('header:', (error as { code?: string }).code)
}
console.log('items:', header.state.items.get())
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly string[] },
  commands: { add: (s, sku: string) => ({ items: [...s.items, sku] }) },
  writers: ['product'] // 除 owner 外，只有商品应用可以写入
})

const hub = createMicroHub({ plugins: [state()] })
getMicroHub().connect('cart').own(cart)
getMicroHub().connect('product').use(cart).commands.add('sku-1')

const header = getMicroHub().connect('header').use(cart)
try {
  header.commands.add('sku-2')
} catch (error) {
  console.log('页头：', (error as { code?: string }).code)
}
console.log('商品：', header.state.items.get())
await hub.dispose()`
      },
      result: t(
        "The header's `add` prints `header: WRITE_DENIED`, and `items: [ 'sku-1' ]` shows that only the product app's write went through.\n\nAn app that needs the owner to act but must not write directly can send a contract request instead; the owner's handler decides what to change.",
        "页头的 `add` 打印 `页头： WRITE_DENIED`，`商品： [ 'sku-1' ]` 说明只有商品应用的写入生效了。\n\n某个应用需要 owner 做事、但不应直接写入时，改为发送契约请求，由 owner 的处理函数决定改什么。"
      )
    }
  ],
  keyed: [
    {
      title: t('Re-render only the row that changed', '只重新渲染变化的那一行'),
      problem: t(
        'Changing the price of one product makes the whole product list re-render, and every row runs its render code again.\n\nWhen the table is one value, any change to it notifies everyone who reads it. Each row then has to compare its old and new data itself to skip the work.\n\nA `keyed()` field stores entities by id, and each id is subscribed on its own. A command writes only the ids in its patch, so only those rows are notified; `ids` notifies only when ids are added or removed.',
        '改一件商品的价格，整个商品列表都重新渲染，每一行都把渲染代码再跑一遍。\n\n整张表是一个值时，它的任何变化都会通知所有读取它的地方。每一行只能自己比较新旧数据，才能跳过不必要的工作。\n\n`keyed()` 字段按 id 存放实体，每个 id 单独订阅。命令只写入补丁里出现的 id，所以只通知这些行；`ids` 只在增删 id 时通知。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, getMicroHub, keyed } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

type IProduct = { name: string; price: number }

const catalog = defineContract('catalog', {
  version: 1,
  state: { products: keyed<IProduct>() },
  commands: {
    load: (_s, products: Record<string, IProduct>) => ({ products }),
    reprice: (s, id: string, price: number) => ({
      products: { [id]: { ...s.products.get(id)!, price } }
    })
  }
})

const hub = createMicroHub({ plugins: [state()] })
const owned = getMicroHub().connect('catalog').own(catalog)
owned.commands.load({ pen: { name: 'Pen', price: 3 }, ink: { name: 'Ink', price: 5 } })

// The list app renders one row per product
const list = getMicroHub().connect('list').use(catalog)
list.state.products.ids.subscribe(() => console.log('list re-renders'))
for (const id of list.state.products.ids.get()) {
  const row = list.state.products.at(id)
  row.subscribe(() => console.log(\`row \${id} re-renders:\`, row.get()))
}

owned.commands.reprice('ink', 6)
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, getMicroHub, keyed } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

type IProduct = { name: string; price: number }

const catalog = defineContract('catalog', {
  version: 1,
  state: { products: keyed<IProduct>() },
  commands: {
    load: (_s, products: Record<string, IProduct>) => ({ products }),
    reprice: (s, id: string, price: number) => ({
      products: { [id]: { ...s.products.get(id)!, price } }
    })
  }
})

const hub = createMicroHub({ plugins: [state()] })
const owned = getMicroHub().connect('catalog').own(catalog)
owned.commands.load({ pen: { name: '钢笔', price: 3 }, ink: { name: '墨水', price: 5 } })

// 列表应用为每件商品渲染一行
const list = getMicroHub().connect('list').use(catalog)
list.state.products.ids.subscribe(() => console.log('列表重新渲染'))
for (const id of list.state.products.ids.get()) {
  const row = list.state.products.at(id)
  row.subscribe(() => console.log(\`\${id} 行重新渲染：\`, row.get()))
}

owned.commands.reprice('ink', 6)
await hub.dispose()`
      },
      result: t(
        "Only `row ink re-renders: { name: 'Ink', price: 6 }` is printed. The `pen` row and the list are not notified, because no id was added or removed.\n\nIn a command, writing `undefined` for an id deletes it; that notifies the row and also `ids`.",
        "只打印了 `ink 行重新渲染： { name: '墨水', price: 6 }`。`pen` 那一行和列表都没有收到通知，因为没有增删 id。\n\n在命令里把某个 id 写成 `undefined` 表示删除它，这会通知该行，也会通知 `ids`。"
      )
    }
  ],
  request: [
    {
      title: t('Call an app that has not loaded yet', '调用还没加载完成的应用'),
      problem: t(
        'The product remote asks the cart to check out as soon as it mounts, but the cart remote is still loading. The call goes nowhere, or the product app grows its own retry timer.\n\nWith a plain event, a message sent before the receiver subscribes is lost, and there is no reply to wait for. A retry loop guesses at timing and keeps running after the user leaves the page.\n\nA contract request has exactly one handler, registered by the owner with `handle()`. A call made while no handler exists fails at once with `OWNER_ABSENT`; with `waitForOwner`, it waits up to that many milliseconds and continues as soon as the handler is registered.',
        '商品子应用一挂载就请求购物车结账，购物车子应用却还在加载。这次调用石沉大海，或者商品应用只好自己加一个重试定时器。\n\n用普通事件时，接收方订阅之前发出的消息就丢了，也没有回复可以等。重试循环只能猜时机，用户离开页面后它还在跑。\n\n契约请求只有一个处理函数，由 owner 用 `handle()` 登记。没有处理函数时调用会立即以 `OWNER_ABSENT` 失败；传入 `waitForOwner` 后，调用最多等待这么多毫秒，处理函数一登记就继续。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, getMicroHub, request } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'

const cart = defineContract('cart', {
  version: 1,
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() }
})

const hub = createMicroHub({ plugins: [events()] })
const product = getMicroHub().connect('product').use(cart)

// The cart remote has not loaded yet
try {
  await product.requests.checkout({})
} catch (error) {
  console.log('without waiting:', (error as { code?: string }).code)
}

const pending = product.requests.checkout({ coupon: 'SPRING' }, { waitForOwner: 3000 })
// The cart remote finishes loading 50 ms later and registers its handler
setTimeout(() => {
  const owned = getMicroHub().connect('cart').own(cart)
  owned.handle('checkout', async ({ coupon }) => ({ orderId: \`A-1 with \${coupon}\` }))
}, 50)
console.log('with waitForOwner:', await pending)
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, getMicroHub, request } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'

const cart = defineContract('cart', {
  version: 1,
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() }
})

const hub = createMicroHub({ plugins: [events()] })
const product = getMicroHub().connect('product').use(cart)

// 购物车子应用还没加载
try {
  await product.requests.checkout({})
} catch (error) {
  console.log('不等待：', (error as { code?: string }).code)
}

const pending = product.requests.checkout({ coupon: 'SPRING' }, { waitForOwner: 3000 })
// 50ms 后购物车子应用加载完成，登记处理函数
setTimeout(() => {
  const owned = getMicroHub().connect('cart').own(cart)
  owned.handle('checkout', async ({ coupon }) => ({ orderId: \`A-1，优惠码 \${coupon}\` }))
}, 50)
console.log('等待 owner：', await pending)
await hub.dispose()`
      },
      result: t(
        "The first call prints `without waiting: OWNER_ABSENT`. The second waits about 50 ms and prints `with waitForOwner: { orderId: 'A-1 with SPRING' }`.\n\nWhen the wait runs out, the call rejects with `OWNER_TIMEOUT`; when the owner leaves while handling it, the call rejects with `OWNER_GONE`. The handler may already have done part of its work by then, so check the order before retrying.",
        "第一次调用打印 `不等待： OWNER_ABSENT`。第二次等了大约 50ms，打印 `等待 owner： { orderId: 'A-1，优惠码 SPRING' }`。\n\n等待超时时调用以 `OWNER_TIMEOUT` 拒绝；处理期间 owner 离开时以 `OWNER_GONE` 拒绝。这时处理函数可能已经做了一部分工作，重试前先核对订单状态。"
      )
    }
  ],
  events: [
    {
      title: t(
        'Stop two apps from triggering each other forever',
        '防止两个应用互相触发、停不下来'
      ),
      problem: t(
        'The cart emits `changed` when prices are updated, and pricing emits `updated` when the cart changes. Each reaction makes sense on its own; together they freeze the tab.\n\nEach team sees only its own listener, so the loop appears only once both remotes are on the same page. A plain event bus keeps calling listeners for as long as events keep coming.\n\nThe `events()` plugin delivers an event emitted inside a listener after the current delivery finishes, and counts the listener calls caused by each top-level emit. When `publishBudget` is reached, delivery stops and the failure goes to the hub `report`; the emitter does not throw.',
        '价格更新时购物车发出 `changed`，购物车变化时定价应用发出 `updated`。单看每个反应都合理，合在一起标签页就卡死了。\n\n每个团队只看得到自己的监听函数，两个子应用同时出现在一个页面上，循环才会出现。普通事件总线只要事件不断，就会一直调用监听函数。\n\n`events()` 插件把在监听函数里发出的事件排到当前分发结束之后，并统计每次顶层 `emit` 引发的监听调用次数。达到 `publishBudget` 时停止分发，并把失败交给 hub 的 `report`；发出方不会收到异常。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, event, getMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'

const cart = defineContract('cart', { version: 1, events: { changed: event<number>() } })
const pricing = defineContract('pricing', { version: 1, events: { updated: event<number>() } })

const hub = createMicroHub({
  plugins: [events({ publishBudget: 100 })],
  report: (error) => {
    const failure = error as { source?: string; code?: string }
    console.log('reported:', failure.source, failure.code)
  }
})
const cartApp = getMicroHub().connect('cart')
const pricingApp = getMicroHub().connect('pricing')
const ownedCart = cartApp.own(cart)
const ownedPricing = pricingApp.own(pricing)

// Each app reacts to the other's event by emitting its own: a loop nobody planned
let deliveries = 0
cartApp.use(pricing).events.updated.on((n) => {
  deliveries++
  ownedCart.events.changed.emit(n + 1)
})
pricingApp.use(cart).events.changed.on((n) => {
  deliveries++
  ownedPricing.events.updated.emit(n + 1)
})

ownedCart.events.changed.emit(0)
console.log('emit returned after', deliveries, 'deliveries')
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, event, getMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'

const cart = defineContract('cart', { version: 1, events: { changed: event<number>() } })
const pricing = defineContract('pricing', { version: 1, events: { updated: event<number>() } })

const hub = createMicroHub({
  plugins: [events({ publishBudget: 100 })],
  report: (error) => {
    const failure = error as { source?: string; code?: string }
    console.log('已上报：', failure.source, failure.code)
  }
})
const cartApp = getMicroHub().connect('cart')
const pricingApp = getMicroHub().connect('pricing')
const ownedCart = cartApp.own(cart)
const ownedPricing = pricingApp.own(pricing)

// 两个应用各自用发出自己的事件来响应对方：谁也没打算写出的循环
let deliveries = 0
cartApp.use(pricing).events.updated.on((n) => {
  deliveries++
  ownedCart.events.changed.emit(n + 1)
})
pricingApp.use(cart).events.changed.on((n) => {
  deliveries++
  ownedPricing.events.updated.emit(n + 1)
})

ownedCart.events.changed.emit(0)
console.log('emit 返回，共分发', deliveries, '次')
await hub.dispose()`
      },
      result: t(
        '`report` prints `reported: @migaia/event-subscriber PUBLISH_FAILED`, then `emit returned after 200 deliveries`. The top-level `changed` emit stopped at its budget of 100 listener calls, and each of those calls triggered one `updated` delivery.\n\nThe default budget is 10000 calls, enough for ordinary fan-out. When `report` receives `PUBLISH_FAILED`, look for two listeners that emit in reaction to each other.',
        '`report` 打印 `已上报： @migaia/event-subscriber PUBLISH_FAILED`，接着打印 `emit 返回，共分发 200 次`。顶层的 `changed` 在达到 100 次监听调用的上限时停止，其中每次调用又引发了一次 `updated` 分发。\n\n默认上限是 10000 次，足够普通的分发。`report` 收到 `PUBLISH_FAILED` 时，去找两个互相响应、互相发出事件的监听函数。'
      )
    }
  ],
  state: [
    {
      title: t(
        'Notify once per command, and only for fields that were read',
        '一个命令只通知一次，而且只通知读过的字段'
      ),
      problem: t(
        'Adding an item changes both the item list and the total. The header badge briefly shows the new count with the old total, and changing an unrelated field such as the coupon makes it render again.\n\nWhen two fields are written one after the other, a subscriber can run between the two writes and see half of the change. A subscriber to the whole state is also notified for fields it never shows.\n\nA command returns one patch, and the `state()` plugin commits all of its fields together and notifies afterwards. `select()` depends only on the fields the selector reads, so its subscribers hear about those fields and nothing else.',
        '加入一件商品会同时改变商品列表和总价。页头角标会短暂显示新的数量和旧的总价；修改优惠码这种无关字段，它也会再渲染一次。\n\n两个字段先后写入时，订阅者可能在两次写入之间运行，看到只改了一半的状态。订阅整个状态的地方，还会因为它根本不显示的字段收到通知。\n\n命令返回一个补丁，`state()` 插件一次提交补丁里的所有字段，之后才通知。`select()` 只依赖选择函数读到的字段，所以它的订阅者只会因为这些字段收到通知。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly string[], total: 0, coupon: '' },
  commands: {
    add: (s, sku: string, price: number) => ({ items: [...s.items, sku], total: s.total + price }),
    setCoupon: (_s, coupon: string) => ({ coupon })
  }
})

const hub = createMicroHub({ plugins: [state()] })
const owned = getMicroHub().connect('cart').own(cart)

// The header badge reads two fields through one selector
const header = getMicroHub().connect('header').use(cart)
const badge = header.select((s) => \`\${s.items.length} items, \${s.total}\`)
badge.subscribe(() => console.log('badge:', badge.get()))

owned.commands.add('sku-1', 42) // writes items and total in one commit
owned.commands.add('sku-2', 8)
owned.commands.setCoupon('SPRING') // the badge does not read coupon
console.log('revision:', header.revision.get())
await hub.dispose()`,
        zh: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { state } from '@migaia/micro-hub/state'

const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly string[], total: 0, coupon: '' },
  commands: {
    add: (s, sku: string, price: number) => ({ items: [...s.items, sku], total: s.total + price }),
    setCoupon: (_s, coupon: string) => ({ coupon })
  }
})

const hub = createMicroHub({ plugins: [state()] })
const owned = getMicroHub().connect('cart').own(cart)

// 页头角标通过一个选择函数读取两个字段
const header = getMicroHub().connect('header').use(cart)
const badge = header.select((s) => \`\${s.items.length} 件，共 \${s.total}\`)
badge.subscribe(() => console.log('角标：', badge.get()))

owned.commands.add('sku-1', 42) // 一次提交同时写入 items 和 total
owned.commands.add('sku-2', 8)
owned.commands.setCoupon('SPRING') // 角标没有读取 coupon
console.log('提交次数：', header.revision.get())
await hub.dispose()`
      },
      result: t(
        'The badge prints `badge: 1 items, 42` and `badge: 2 items, 50`, once per `add`, each time with a matching count and total. `setCoupon` still commits, as `revision: 3` shows, but the badge is not notified.\n\nCommands must be synchronous: a command that returns a Promise throws `COMMAND_ASYNC` and writes nothing. Finish the asynchronous work first, then call the command with its result.',
        '角标打印 `角标： 1 件，共 42` 和 `角标： 2 件，共 50`，每次 `add` 一行，数量和总价总是一致。`setCoupon` 也提交了，`提交次数： 3` 可以说明，但角标没有收到通知。\n\n命令必须是同步的：返回 Promise 的命令会抛 `COMMAND_ASYNC`，并且不写入任何字段。先完成异步工作，再用结果调用命令。'
      )
    }
  ],
  persist: [
    {
      title: t('Start clean after a major version change', '主版本升级后从初始值开始'),
      problem: t(
        "After a release changes the shape of the saved cart, returning users load the old saved data into the new code, and the cart page breaks on a field that no longer exists.\n\nCode that writes state to storage by hand also has to decide when the saved data is too old to use. Without a version stored next to the data, the new code cannot tell old data from new.\n\nThe `persist()` plugin saves the listed fields together with the contract `version`. A reload with the same version reads them back; after a major version change the old data is discarded and the fields start from the contract's initial values.",
        '某次发布改变了购物车的保存结构，老用户回来时，旧数据被读进新代码，购物车页面因为一个已经不存在的字段而出错。\n\n手写代码把状态存进存储时，还得自己判断保存的数据是不是已经过时。数据旁边没有保存版本，新代码就分不清新旧数据。\n\n`persist()` 插件把列出的字段和契约的 `version` 一起保存。同一版本重新加载时读回这些字段；主版本变化后丢弃旧数据，字段从契约的初始值开始。'
      ),
      example: {
        en: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { persist } from '@migaia/micro-hub/persist'
import { state } from '@migaia/micro-hub/state'
import { memoryStorageHost } from '@migaia/storage-web/memory'

// In the browser this would be localStorageHost({ namespace: 'shop' })
const store = memoryStorageHost()

// One page load: create the hub, own the cart, wait for the saved fields, then run \`work\`
async function pageLoad(version: number, work: (add: (sku: string) => void) => void) {
  const cart = defineContract('cart', {
    version,
    state: { items: [] as readonly string[] },
    commands: { add: (s, sku: string) => ({ items: [...s.items, sku] }) }
  })
  const hub = createMicroHub({ plugins: [state(), persist({ store })] })
  const owned = getMicroHub().connect('cart').own(cart, { persist: ['items'] })
  await owned.persistence?.ready
  console.log(\`version \${version} starts with\`, owned.state.items.get())
  work((sku) => owned.commands.add(sku))
  await hub.dispose() // waits for the write of the item just added
}

await pageLoad(1, (add) => add('sku-1'))
await pageLoad(1, (add) => add('sku-2')) // reload
await pageLoad(2, () => {}) // release with a new major version`,
        zh: `import { createMicroHub, defineContract, getMicroHub } from '@migaia/micro-hub'
import { persist } from '@migaia/micro-hub/persist'
import { state } from '@migaia/micro-hub/state'
import { memoryStorageHost } from '@migaia/storage-web/memory'

// 在浏览器中这里换成 localStorageHost({ namespace: 'shop' })
const store = memoryStorageHost()

// 一次页面加载：创建 hub，认领购物车，等保存的字段读回，再执行 work
async function pageLoad(version: number, work: (add: (sku: string) => void) => void) {
  const cart = defineContract('cart', {
    version,
    state: { items: [] as readonly string[] },
    commands: { add: (s, sku: string) => ({ items: [...s.items, sku] }) }
  })
  const hub = createMicroHub({ plugins: [state(), persist({ store })] })
  const owned = getMicroHub().connect('cart').own(cart, { persist: ['items'] })
  await owned.persistence?.ready
  console.log(\`版本 \${version} 启动时：\`, owned.state.items.get())
  work((sku) => owned.commands.add(sku))
  await hub.dispose() // 等刚加入的商品写入存储
}

await pageLoad(1, (add) => add('sku-1'))
await pageLoad(1, (add) => add('sku-2')) // 刷新页面
await pageLoad(2, () => {}) // 发布新的主版本`
      },
      result: t(
        "The first load prints `version 1 starts with []` and adds `sku-1`. The reload prints `version 1 starts with [ 'sku-1' ]`. The load with version 2 prints `version 2 starts with []`, the contract's initial value. `hub.dispose()` waits for the write of the item added just before it, so nothing is lost when the page closes right after a change.\n\n`persistence.ready` resolves after the first read-back; wait for it before showing saved fields. A write made while the saved data is being read back is kept and not overwritten by it.",
        "第一次加载打印 `版本 1 启动时： []`，并加入 `sku-1`。刷新后打印 `版本 1 启动时： [ 'sku-1' ]`。版本 2 加载时打印 `版本 2 启动时： []`，也就是契约的初始值。`hub.dispose()` 会等刚加入的商品写入存储，所以变化之后立即关闭页面也不会丢数据。\n\n`persistence.ready` 在首次读回后兑现；显示保存的字段前先等待它。读回期间发生的写入会保留，不会被保存的数据覆盖。"
      )
    }
  ]
}
