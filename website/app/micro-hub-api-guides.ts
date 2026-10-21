/**
 * Task guides of the callable `@migaia/micro-hub` APIs, one bilingual entry per API. Verified
 * against `packages/micro-hub/src`, README and USEGUIDE on 2026-10-21. Reference pages render the
 * maintained text in `app/reference/micro-hub.ts`; these guides feed search and the guide checks.
 */
import type { IApiGuide, IGuideLocale } from './api-guides.js'

/** Bilingual input of one guide; each locale keeps its own prose. */
type IGuideInput = {
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart: string
  readonly scenariosEn: readonly string[]
  readonly scenariosZh: readonly string[]
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
}

/** Builds one bilingual guide; the code example is shared because it carries no prose comments. */
function guide(input: IGuideInput): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: input.purposeEn,
      quickStart: input.quickStart,
      scenarios: input.scenariosEn,
      avoidWhen: input.avoidEn,
      options: []
    },
    zh: {
      purpose: input.purposeZh,
      quickStart: input.quickStart,
      scenarios: input.scenariosZh,
      avoidWhen: input.avoidZh,
      options: []
    }
  }
}

/** Shell setup reused by the plugin guides. */
const shellSetup = `import { createMicroHub } from '@migaia/micro-hub'
import { events } from '@migaia/micro-hub/events'
import { state } from '@migaia/micro-hub/state'

createMicroHub({ plugins: [events(), state()] })`

/** Contract markers used together inside one contract definition. */
const contractExample = `import { defineContract, event, keyed, request, resource } from '@migaia/micro-hub'

type ICartItem = { id: string; price: number }

export const cart = defineContract('cart', {
  version: 1,
  state: { items: [] as readonly ICartItem[], byId: keyed<ICartItem>() },
  commands: { add: (s, item: ICartItem) => ({ items: [...s.items, item], byId: { [item.id]: item } }) },
  events: { checkedOut: event<{ orderId: string }>() },
  requests: { checkout: request<{ coupon?: string }, { orderId: string }>() },
  resources: { promotions: resource<readonly string[]>() }
})`

/** Web Components provide/consume pair. */
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

/** Task guides keyed by `micro-hub:<module>:<symbol>`. */
export const microHubApiGuides: Readonly<
  Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>
> = {
  'micro-hub:index:createMicroHub': guide({
    purposeEn:
      'Creates the single hub of the page in the shell. Plugin dependencies are checked before anything is installed, so a missing plugin leaves no half-built hub; child apps never call it and use getMicroHub() instead.',
    purposeZh:
      '在主应用中创建整页唯一的 hub。安装前先检查插件依赖，缺少插件时不会留下半成品；子应用不调用它，而是使用 getMicroHub()。',
    quickStart: shellSetup,
    scenariosEn: [
      'Several Module Federation remotes or Web Component child apps on one page share state, events and requests.',
      'The shell wants listener failures of every app to reach one error monitor through the report option.'
    ],
    scenariosZh: [
      '同一页面上的多个联邦子应用或自定义元素子应用需要共享状态、事件和请求。',
      '主应用希望通过 report 选项，把所有应用的监听失败汇总到同一个错误监控。'
    ],
    avoidEn: [
      'The apps live in iframes, Workers or other tabs; use @migaia/rpc-browser for separate realms.',
      'Only one app uses the state; use @migaia/store-keyed or @migaia/store-light directly.'
    ],
    avoidZh: [
      '应用位于 iframe、Worker 或其它标签页中：这些是不同的运行环境，请使用 @migaia/rpc-browser。',
      '状态只有一个应用使用：直接使用 @migaia/store-keyed 或 @migaia/store-light。'
    ]
  }),
  'micro-hub:index:getMicroHub': guide({
    purposeEn:
      'Returns the hub the shell created so any app, including the shell itself, can connect under its own name. Throws HUB_NOT_CREATED when the shell has not created the hub yet or has disposed it.',
    purposeZh:
      '返回主应用创建的 hub，任何应用（包括主应用自己）都通过它以自己的名字连接。主应用尚未创建或已经释放 hub 时抛 HUB_NOT_CREATED。',
    quickStart: `import { getMicroHub } from '@migaia/micro-hub'

const app = getMicroHub().connect('product')`,
    scenariosEn: [
      'A remote mounts and needs its app handle without importing anything from the shell.',
      'The shell itself connects as an app after creating the hub.'
    ],
    scenariosZh: [
      '子应用挂载时需要拿到自己的应用句柄，又不想从主应用导入任何东西。',
      '主应用创建 hub 之后，自己也作为一个应用连接。'
    ],
    avoidEn: [
      'Creating the hub: only the shell calls createMicroHub().',
      'A child element mounted as a Web Component can receive its handle through consumeMicroApp() instead of a global lookup.'
    ],
    avoidZh: [
      '创建 hub：只有主应用调用 createMicroHub()。',
      '以自定义元素挂载的子元素，可以通过 consumeMicroApp() 拿到句柄，而不是全局查找。'
    ]
  }),
  'micro-hub:index:defineContract': guide({
    purposeEn:
      'Defines the typed, versioned contract between the app that owns some state, events, requests and resources and the apps that use them. It only validates and freezes; the hub registers the contract on the first use() or own().',
    purposeZh:
      '定义拥有状态、事件、请求和共享异步值的应用，与使用它们的应用之间带类型、带版本的契约。它只做校验和冻结；第一次 use() 或 own() 时 hub 才登记该契约。',
    quickStart: contractExample,
    scenariosEn: [
      'The owner team publishes the contract through a Module Federation expose and every consumer imports the same definition.',
      'Two independently deployed apps must fail loudly when they disagree on the major version.'
    ],
    scenariosZh: [
      'owner 团队通过联邦模块的暴露入口发布契约，所有使用方导入同一份定义。',
      '两个独立部署的应用对主版本不一致时，必须明确报错而不是悄悄出错。'
    ],
    avoidEn: [
      'State private to one app does not need a contract; keep it in a local store.',
      'Cross-realm communication with iframes or Workers needs an RPC contract from @migaia/rpc-contract.'
    ],
    avoidZh: [
      '只属于一个应用的状态不需要契约，放在应用自己的本地状态库里即可。',
      '与 iframe 或 Worker 跨运行环境通信，需要 @migaia/rpc-contract 中的契约。'
    ]
  }),
  'micro-hub:index:event': guide({
    purposeEn:
      'Declares a contract event and its payload type inside the events section of defineContract. Only the owner emits it; every connected app can listen through view.events.<name>.on().',
    purposeZh:
      '在 defineContract 的 events 部分声明一个契约事件及其载荷类型。只有 owner 能发出它，所有已连接的应用都能通过 view.events.<name>.on() 监听。',
    quickStart: contractExample,
    scenariosEn: [
      'The cart app tells every other app that an order was placed.',
      'Several apps react to one domain change without knowing who else listens.'
    ],
    scenariosZh: [
      '购物车应用通知其它所有应用：订单已经提交。',
      '多个应用对同一个领域变化作出反应，彼此不需要知道还有谁在监听。'
    ],
    avoidEn: [
      'The caller needs an answer: declare a request() instead.',
      'Late subscribers need the current value: keep it in state, which has a current value, rather than in an event.'
    ],
    avoidZh: [
      '调用方需要得到应答：改为声明 request()。',
      '晚到的订阅方需要拿到当前值：把它放进有当前值的状态里，而不是用事件传递。'
    ]
  }),
  'micro-hub:index:request': guide({
    purposeEn:
      'Declares a contract request with its input and output types. The owner answers it with one handler registered by owned.handle(), and any app calls it through view.requests.<name>(input, options).',
    purposeZh:
      '声明一个契约请求及其输入和输出类型。owner 用 owned.handle() 登记唯一的处理函数来应答，任何应用通过 view.requests.<name>(input, options) 调用。',
    quickStart: contractExample,
    scenariosEn: [
      'A product app asks the cart app to check out and waits for the order id.',
      'A caller may start before the owner and should wait with waitForOwner instead of failing at once.'
    ],
    scenariosZh: [
      '商品应用请求购物车应用结账，并等待返回的订单号。',
      '调用方可能比 owner 先启动，希望用 waitForOwner 等待，而不是立即失败。'
    ],
    avoidEn: [
      'Every app should learn about something without answering: declare an event() instead.',
      'The caller may write the data itself: give it a command and list the app in writers.'
    ],
    avoidZh: [
      '只需要通知所有应用、不需要应答：改为声明 event()。',
      '调用方可以自己写入数据：为它提供命令，并把它列入 writers。'
    ]
  }),
  'micro-hub:index:keyed': guide({
    purposeEn:
      'Declares a state field that holds entities by string id. Each id is subscribed on its own, so updating one entity notifies only that entity; commands write an id map in which undefined deletes the id.',
    purposeZh:
      '声明一个按字符串 id 存放实体的状态字段。每个 id 单独订阅，更新一个实体只通知它自己；命令写入 id 映射，值为 undefined 表示删除该 id。',
    quickStart: contractExample,
    scenariosEn: [
      'A list renders thousands of rows and only the changed row should re-render.',
      'Entities are added, replaced and removed by id from several commands.'
    ],
    scenariosZh: [
      '列表渲染上千行，只希望发生变化的那一行重新渲染。',
      '多个命令按 id 增加、替换和删除实体。'
    ],
    avoidEn: [
      'The value is small and always read as a whole; a plain field is simpler.',
      'The field must be persisted; persistence supports plain fields only.'
    ],
    avoidZh: [
      '值很小，而且总是整体读取：普通字段更简单。',
      '字段需要持久化：持久化只支持普通字段。'
    ]
  }),
  'micro-hub:index:resource': guide({
    purposeEn:
      'Declares a shared asynchronous value inside the resources section. The owner supplies its fetcher with owned.provide(); every app reads the same value and concurrent reads share one request. Needs the resources() plugin.',
    purposeZh:
      '在 resources 部分声明一个共享异步值。owner 用 owned.provide() 提供获取函数；所有应用读到同一个值，并发读取共享一次请求。需要安装 resources() 插件。',
    quickStart: contractExample,
    scenariosEn: [
      'The header, sidebar and checkout app all need the signed-in user, and only one request should go out.',
      'Apps need loading and error status of shared data, not just the value.'
    ],
    scenariosZh: [
      '页头、侧边栏和结账应用都需要当前登录用户，但只应发出一次请求。',
      '应用除了值本身，还需要共享数据的加载状态和错误状态。'
    ],
    avoidEn: [
      'The value is computed synchronously from state; use a computed value instead.',
      'Only one app needs the data; load it inside that app.'
    ],
    avoidZh: [
      '值可以由状态同步计算出来：改用计算值。',
      '只有一个应用需要这份数据：在该应用内部加载即可。'
    ]
  }),
  'micro-hub:index:createMicroHubError': guide({
    purposeEn:
      'Creates an Error tagged with the package source and a MicroHubErrorCode, with an optional cause. It lets a capability plugin report failures exactly the way the hub does, so callers can branch on code.',
    purposeZh:
      '创建一个带本包 source 和 MicroHubErrorCode 的 Error，可附带 cause。能力插件可以用它以和 hub 完全相同的方式报告失败，调用方据此按 code 分支。',
    quickStart: `import { MicroHubErrorCode, MicroHubErrorText, createMicroHubError } from '@migaia/micro-hub'

throw createMicroHubError(
  MicroHubErrorCode.ownerAbsent,
  MicroHubErrorText.ownerAbsent('cart', 'checkout')
)`,
    scenariosEn: [
      'A custom capability plugin rejects a call because the owner is missing.',
      'A wrapper keeps the original failure reachable through cause while adding a hub code.'
    ],
    scenariosZh: [
      '自定义能力插件因为 owner 不存在而拒绝一次调用。',
      '包装错误时添加 hub 的错误码，同时通过 cause 保留原始失败。'
    ],
    avoidEn: [
      'The failure is an invalid argument; use createMicroHubTypeError() so the native TypeError type is kept.',
      "Application errors unrelated to the hub should use the application's own codes."
    ],
    avoidZh: [
      '失败原因是参数非法：使用 createMicroHubTypeError()，保留原生 TypeError 类型。',
      '与 hub 无关的应用错误，应使用应用自己的错误码。'
    ]
  }),
  'micro-hub:index:createMicroHubTypeError': guide({
    purposeEn:
      'Creates a TypeError tagged with the package source and a MicroHubErrorCode, usually INVALID_OPTION. Callers that branch on the native TypeError type keep working while code still identifies the case.',
    purposeZh:
      '创建一个带本包 source 和 MicroHubErrorCode 的 TypeError，通常是 INVALID_OPTION。按原生 TypeError 类型判断的调用方不受影响，code 仍能区分具体情况。',
    quickStart: `import { MicroHubErrorCode, MicroHubErrorText, createMicroHubTypeError } from '@migaia/micro-hub'

throw createMicroHubTypeError(
  MicroHubErrorCode.invalidOption,
  MicroHubErrorText.invalidName('app', 'bad.name')
)`,
    scenariosEn: [
      'A capability plugin validates a name or option passed by an app.',
      'Tests assert both the native TypeError type and the hub error code.'
    ],
    scenariosZh: [
      '能力插件校验应用传入的名字或选项。',
      '测试同时断言原生 TypeError 类型和 hub 错误码。'
    ],
    avoidEn: [
      'The failure is a state problem such as a missing owner; use createMicroHubError().',
      'The error never leaves your own module; a plain local error is enough.'
    ],
    avoidZh: [
      '失败是状态问题，例如 owner 不存在：使用 createMicroHubError()。',
      '错误不会离开你自己的模块：普通的本地错误就够了。'
    ]
  }),
  'micro-hub:events:events': guide({
    purposeEn:
      'Creates the events capability plugin for createMicroHub({ plugins }). Contracts that declare events or requests need it; publishBudget limits how many listener calls one top-level emit may cause.',
    purposeZh:
      '为 createMicroHub({ plugins }) 创建事件能力插件。声明了 events 或 requests 的契约需要它；publishBudget 限制一次顶层 emit 最多引发多少次监听调用。',
    quickStart: shellSetup,
    scenariosEn: [
      'Apps notify each other of domain changes and call the owner through requests.',
      'Two apps that emit in reaction to each other must not loop forever.'
    ],
    scenariosZh: [
      '应用之间通知领域变化，并通过请求调用 owner。',
      '两个互相响应对方事件的应用不能陷入死循环。'
    ],
    avoidEn: [
      'No contract declares events or requests; skip the plugin to keep the hub smaller.',
      'Messages must cross iframes or Workers; use @migaia/rpc-browser.'
    ],
    avoidZh: [
      '没有任何契约声明事件或请求：不安装这个插件，让 hub 更精简。',
      '消息需要跨越 iframe 或 Worker：使用 @migaia/rpc-browser。'
    ]
  }),
  'micro-hub:state:state': guide({
    purposeEn:
      'Creates the state capability plugin: contract state, computed values, commands, revision and select, with one atom per field and per keyed id so a change notifies only the subscribers of what changed.',
    purposeZh:
      '创建状态能力插件：契约中的状态、计算值、命令、revision 和 select。每个字段和每个实体 id 各一个原子，变化只通知相关的订阅者。',
    quickStart: shellSetup,
    scenariosEn: [
      'A cart is shared between the product list and the header badge, each re-rendering only for the fields it reads.',
      'Several apps write through commands while only the owner and writers are allowed to change state.'
    ],
    scenariosZh: [
      '商品列表和页头角标共享购物车，各自只在读取的字段变化时重新渲染。',
      '多个应用通过命令写入，只有 owner 和 writers 中的应用被允许修改状态。'
    ],
    avoidEn: [
      'Contracts only exchange events and requests; install events() alone.',
      'The state belongs to one app; a local store is simpler.'
    ],
    avoidZh: [
      '契约只交换事件和请求：只安装 events() 即可。',
      '状态只属于一个应用：使用本地状态库更简单。'
    ]
  }),
  'micro-hub:state:stateDriverOf': guide({
    purposeEn:
      'Returns the state driver of a hub runtime for authors of capability plugins that build on state, as persist() does. It exposes the atom of a plain field and a permission-free write used to restore data.',
    purposeZh:
      '为基于状态编写能力插件的作者返回 hub 运行时的状态驱动，persist() 就是这样使用的。它提供普通字段的原子，以及用于写回数据、不检查写权限的写入方法。',
    quickStart: `import { stateDriverOf } from '@migaia/micro-hub/state'

const driver = stateDriverOf(hub)
const def = driver.plainField(entry, 'items')
if (def) driver.write(entry, { items: restored })`,
    scenariosEn: [
      'A custom plugin restores fields from another storage backend when the owner starts.',
      'A plugin needs to observe one plain field atom directly.'
    ],
    scenariosZh: [
      '自定义插件在 owner 启动时，从另一种存储后端写回字段。',
      '插件需要直接观察某个普通字段的原子。'
    ],
    avoidEn: [
      'Application code should read and write through views and commands, which check permissions.',
      'The plugin does not declare state in its requires list; the driver may then be absent.'
    ],
    avoidZh: [
      '应用代码应通过视图和命令读写，它们会检查权限。',
      '插件没有在 requires 中声明 state：此时驱动可能不存在。'
    ]
  }),
  'micro-hub:persist:persist': guide({
    purposeEn:
      'Creates the persistence capability plugin. Together with state(), it lets an owner write selected plain fields to a key-value store and restore them on startup through own(contract, { persist }).',
    purposeZh:
      '创建持久化能力插件。它与 state() 配合使用，让 owner 通过 own(contract, { persist }) 把选定的普通字段写入键值存储，并在启动时读回。',
    quickStart: `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { persist } from '@migaia/micro-hub/persist'
import { state } from '@migaia/micro-hub/state'
import { localStorageHost } from '@migaia/storage-web/local-storage'

createMicroHub({
  plugins: [state(), persist({ store: localStorageHost({ namespace: 'shop' }), debounceMs: 200 })]
})
const owned = getMicroHub().connect('cart').own(cart, { persist: ['items'] })
await owned.persistence?.ready`,
    scenariosEn: [
      'The cart must survive a page reload without each app writing to storage itself.',
      'An owner hands over to another app and the stored data must not overwrite newer values.'
    ],
    scenariosZh: [
      '刷新页面后购物车内容必须保留，又不想每个应用自己写存储。',
      'owner 交接给另一个应用时，存档不能覆盖更新的值。'
    ],
    avoidEn: [
      'The field is keyed; persistence supports plain fields only.',
      'The data belongs on a server; send it through a request instead of local storage.'
    ],
    avoidZh: [
      '字段是 keyed 类型：持久化只支持普通字段。',
      '数据应保存在服务器上：通过请求发送，而不是写入本地存储。'
    ]
  }),
  'micro-hub:resource:resources': guide({
    purposeEn:
      'Creates the shared-resource capability plugin. The owner provides a fetcher, every app reads the same value, concurrent reads share one request, and the state readable reports loading and errors. Needs @migaia/resource.',
    purposeZh:
      '创建共享异步值能力插件。owner 提供获取函数，所有应用读到同一个值，并发读取共享一次请求，状态可读对象会报告加载和错误。需要 @migaia/resource。',
    quickStart: `import { createMicroHub, getMicroHub } from '@migaia/micro-hub'
import { resources } from '@migaia/micro-hub/resource'

createMicroHub({ plugins: [resources()] })
const owned = getMicroHub().connect('account').own(session)
owned.provide('profile', (signal) => fetch('/api/me', { signal }).then((r) => r.json()))
const user = await getMicroHub().connect('header').use(session).resources.profile.read()`,
    scenariosEn: [
      'The signed-in user is loaded once for every app on the page.',
      'An app shows a spinner while the shared value is pending and an error message when it fails.'
    ],
    scenariosZh: [
      '当前登录用户只为页面上的所有应用加载一次。',
      '共享值加载中时显示加载动画，失败时显示错误提示。'
    ],
    avoidEn: [
      'No contract declares resources; skip the plugin and its optional peer.',
      'The value is derived synchronously from state; a computed value is enough.'
    ],
    avoidZh: [
      '没有任何契约声明 resources：不安装这个插件及其可选依赖。',
      '值可以由状态同步得出：使用计算值就够了。'
    ]
  }),
  'micro-hub:web-component:provideMicroApp': guide({
    purposeEn:
      'Makes an element answer Context Protocol requests for the app handle from its descendants, including inside shadow DOM, and answers requests that were waiting. Use it together with consumeMicroApp() in the child element.',
    purposeZh:
      '让一个元素应答后代（包括 shadow DOM 内）按 Context Protocol 请求应用句柄的事件，也会应答此前在等待的请求。与子元素中的 consumeMicroApp() 配合使用。',
    quickStart: webComponentExample,
    scenariosEn: [
      'The shell mounts child apps as custom elements inside a slot and hands them its app handle.',
      'Lit consumers declared with MICRO_APP_CONTEXT must receive the handle even if they connect first.'
    ],
    scenariosZh: [
      '主应用把子应用作为自定义元素挂载到插槽中，并把应用句柄交给它们。',
      '使用 MICRO_APP_CONTEXT 声明的 Lit 消费方即使先连接，也必须能拿到句柄。'
    ],
    avoidEn: [
      'Child apps are Module Federation remotes without custom elements; they call getMicroHub() directly.',
      'Each child app needs its own name; pass a handle connected for that child, not the shell handle.'
    ],
    avoidZh: [
      '子应用是联邦模块、不使用自定义元素：它们直接调用 getMicroHub()。',
      '每个子应用需要自己的名字：传入为该子应用连接的句柄，而不是主应用的句柄。'
    ]
  }),
  'micro-hub:web-component:consumeMicroApp': guide({
    purposeEn:
      'Asks the nearest provider above an element for the app handle with a bubbling, composed context-request. When no provider answers yet, the request waits until provideMicroApp() appears; the returned function cancels it.',
    purposeZh:
      '通过会冒泡、可穿过 shadow DOM 的 context-request，向元素上方最近的提供者请求应用句柄。还没有提供者时请求会等待，直到出现 provideMicroApp()；返回的函数用于取消。',
    quickStart: webComponentExample,
    scenariosEn: [
      'A custom element of a child app needs its handle in connectedCallback without a global variable.',
      'The element may be connected before the shell installs the provider.'
    ],
    scenariosZh: [
      '子应用的自定义元素需要在 connectedCallback 中拿到句柄，又不想依赖全局变量。',
      '元素可能在主应用安装提供者之前就已连接。'
    ],
    avoidEn: [
      'The code is not inside a custom element; call getMicroHub().connect(name) instead.',
      'A Lit component can declare @consume with MICRO_APP_CONTEXT instead of calling this helper.'
    ],
    avoidZh: [
      '代码不在自定义元素中：改为调用 getMicroHub().connect(name)。',
      'Lit 组件可以用 MICRO_APP_CONTEXT 声明 @consume，不必调用这个函数。'
    ]
  })
}
