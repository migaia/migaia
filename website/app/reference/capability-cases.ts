import type { ICaseDoc, IText } from './contract.js'

/** Creates bilingual explanations and complete runnable sources. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Public gate, static resource graph and pure topology tasks with exact observable outcomes. */
export const capabilityCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createCapabilityHost: [
    {
      title: t('Keep permission separate from activation', '把开关许可与实际启用分开'),
      problem: t(
        'A feature is downloaded or starts work even though the current tenant has not enabled it.\n\nA boolean checked only at registration time does not own the later activation or its cleanup. Turning the boolean on can also accidentally start work before the application requests it.\n\nCreate one capability host, which owns activation state and disposable handles, and register an activation callback. Missing flags deny activation; call `setFlag(name, true)` to grant permission and then `enable(name)` to start. Finish with `dispose()`.',
        '当前租户还没有允许某项功能，功能却已下载或开始工作。\n\n只在登记时检查一次布尔值，无法管理之后的激活和清理；把打开开关与执行启动混在一起，也可能在应用需要之前就开始工作。\n\n创建一个能力宿主来持有激活状态和可释放句柄，并登记激活回调。缺失的开关默认拒绝激活，先用 `setFlag(name, true)` 授权，再调用 `enable(name)` 启动，最后用 `dispose()` 释放。'
      ),
      example: t(
        "import { createCapabilityHost } from '@migaia/capability'\n\nconst host = createCapabilityHost({ tenant: 'demo' })\nhost.register({ name: 'export', activate: ({ tenant }) => {\n  console.log('activated:', tenant)\n  return { dispose: () => { console.log('released: export') } }\n} })\nconsole.log('first attempt:', (await host.enable('export')).status)\nhost.setFlag('export', true)\nconsole.log('after permission:', host.state('export'))\nconsole.log('activation:', (await host.enable('export')).status)\nawait host.dispose()",
        "import { createCapabilityHost } from '@migaia/capability'\n\nconst host = createCapabilityHost({ tenant: 'demo' })\nhost.register({ name: 'export', activate: ({ tenant }) => {\n  console.log('启用:', tenant)\n  return { dispose: () => { console.log('释放: export') } }\n} })\nconsole.log('首次尝试:', (await host.enable('export')).status)\nhost.setFlag('export', true)\nconsole.log('授权后:', host.state('export'))\nconsole.log('启用结果:', (await host.enable('export')).status)\nawait host.dispose()"
      ),
      result: t(
        'Prints `first attempt: gated`, `after permission: off`, `activated: demo`, `activation: enabled`, then `released: export`.\n\nThe denied attempt does not call the activation callback, and granting permission alone leaves the capability off. The host cannot undo a static import: place a dynamic import inside `activate` when code loading must also wait for permission.',
        '依次输出 `首次尝试: gated`、`授权后: off`、`启用: demo`、`启用结果: enabled`、`释放: export`。\n\n被拒绝的尝试没有执行激活回调，单独授权仍让能力保持关闭。宿主不会撤销静态导入；若代码下载也要等许可，应把动态导入放在 `activate` 内。'
      )
    },
    {
      title: t('Share one activation while two callers wait', '两个调用方等待时只激活一次'),
      problem: t(
        'Two parts of a page enable the same feature together, creating duplicate connections or workers before either activation finishes.\n\nChecking only whether a handle already exists misses the interval while the first activation is pending. Both callers see no handle and independently start the same work.\n\nCall `enable(name)` on the same host. It publishes the in-flight Promise before invoking the activation callback, so another call while activation is pending joins that Promise and receives the same classified result.',
        '页面两个位置同时启用同一项功能，第一次激活尚未完成，就建立了重复连接或工作线程。\n\n只检查句柄是否已经存在，会漏掉第一次激活仍在等待的这段时间；两个调用方都看不到句柄，于是分别启动同一份工作。\n\n在同一宿主上调用 `enable(name)`。它先登记在途 Promise，再调用激活回调，期间到来的第二次调用会加入同一个 Promise，收到同一次分类结果。'
      ),
      example: t(
        "import { createCapabilityHost } from '@migaia/capability'\n\nlet activations = 0\nconst host = createCapabilityHost(undefined, { flags: { search: true } })\nhost.register({ name: 'search', activate: async () => {\n  activations += 1\n  await Promise.resolve()\n  return { dispose() {} }\n} })\nconst first = host.enable('search')\nconst second = host.enable('search')\nconsole.log('same Promise:', first === second)\nconst results = await Promise.all([first, second])\nconsole.log('results:', results.map(result => result.status).join(','))\nconsole.log('activations:', activations)\nawait host.dispose()",
        "import { createCapabilityHost } from '@migaia/capability'\n\nlet activations = 0\nconst host = createCapabilityHost(undefined, { flags: { search: true } })\nhost.register({ name: 'search', activate: async () => {\n  activations += 1\n  await Promise.resolve()\n  return { dispose() {} }\n} })\nconst first = host.enable('search')\nconst second = host.enable('search')\nconsole.log('同一 Promise:', first === second)\nconst results = await Promise.all([first, second])\nconsole.log('结果:', results.map(result => result.status).join(','))\nconsole.log('激活次数:', activations)\nawait host.dispose()"
      ),
      result: t(
        'Prints `same Promise: true`, `results: enabled,enabled`, then `activations: 1`.\n\nConcurrent callers share one pending activation rather than merely receiving equal statuses. Calls made after the capability is already enabled need not return that same Promise; separate host instances do not share activation state.',
        '依次输出 `同一 Promise: true`、`结果: enabled,enabled`、`激活次数: 1`。\n\n并发调用共享的是同一次在途激活，而不只是两个相同的状态值。能力已经启用后再调用，不保证返回同一个 Promise；不同宿主也不共享激活状态。'
      )
    },
    {
      title: t('Release a late handle after permission is withdrawn', '撤回许可后释放晚到的句柄'),
      problem: t(
        'An administrator turns a feature off while its async activation is pending, but the feature becomes active again when the old request finishes.\n\nA handwritten flag check before the first await only authorizes the beginning of the work. Assigning the returned handle unconditionally lets a stale completion restore a capability whose permission has already been revoked.\n\nWithdraw permission with `setFlag(name, false)`. The host immediately invalidates that activation; if its handle arrives later, the host releases it instead of adopting it. Await `dispose()` when all activation and cleanup work must be drained.',
        '异步激活尚未结束，管理员已经关闭功能，旧请求完成后功能却又重新启用了。\n\n只在第一个 `await` 前检查开关，只能决定是否开始工作；返回后无条件保存句柄，会让过期的完成结果恢复已经撤销许可的能力。\n\n用 `setFlag(name, false)` 撤回许可，宿主立即作废这次激活。句柄之后到达时会被释放，不会被接纳；需要等待全部激活及清理结束时，再等待 `dispose()`。'
      ),
      example: t(
        "import { createCapabilityHost, type ICapabilityHandle } from '@migaia/capability'\n\nlet finish!: (handle: ICapabilityHandle) => void\nconst pending = new Promise<ICapabilityHandle>(resolve => { finish = resolve })\nconst host = createCapabilityHost(undefined, { flags: { export: true } })\nhost.register({ name: 'export', activate: () => pending })\nconst enabling = host.enable('export')\nhost.setFlag('export', false)\nfinish({ dispose: () => { console.log('released late handle') } })\nconsole.log('activation:', (await enabling).status)\nconsole.log('state:', host.state('export'))\nconsole.log('adopted handle:', host.handle('export') !== undefined)\nawait host.dispose()",
        "import { createCapabilityHost, type ICapabilityHandle } from '@migaia/capability'\n\nlet finish!: (handle: ICapabilityHandle) => void\nconst pending = new Promise<ICapabilityHandle>(resolve => { finish = resolve })\nconst host = createCapabilityHost(undefined, { flags: { export: true } })\nhost.register({ name: 'export', activate: () => pending })\nconst enabling = host.enable('export')\nhost.setFlag('export', false)\nfinish({ dispose: () => { console.log('释放晚到句柄') } })\nconsole.log('启用结果:', (await enabling).status)\nconsole.log('状态:', host.state('export'))\nconsole.log('已接纳句柄:', host.handle('export') !== undefined)\nawait host.dispose()"
      ),
      result: t(
        'Prints `released late handle`, `activation: gated`, `state: gated`, then `adopted handle: false`.\n\nWith permission still withdrawn, the old result cannot become the active handle. The host does not forcibly interrupt user activation code; it owns the returned handle when that work finishes. Async release can continue after a flag update, so await `disable()` or `dispose()` to drain it.',
        '依次输出 `释放晚到句柄`、`启用结果: gated`、`状态: gated`、`已接纳句柄: false`。\n\n许可仍被撤回时，旧结果不能成为启用句柄。宿主不会强行打断用户的激活代码，而是在它结束时接管返回句柄。开关更新后异步释放可能仍在继续，需要等待 `disable()` 或 `dispose()` 才能排空。'
      )
    },
    {
      title: t(
        'Stop a running feature when its flag is turned off',
        '关掉开关时，已经运行的功能随之停止'
      ),
      problem: t(
        'A live chat feature has opened a connection for the current tenant and sends a heartbeat every second. An operator turns it off in the config center.\n\nThe usual approach fetches a set of booleans from a config center or feature flag service and writes `if (flags.liveChat) startChat()` in code. The flag service tells you a value; it does not deal with what happens when the value changes. The check runs once, before startup, so after the flag goes off the connection and timer already created keep running, unless every feature listens for flag changes and finds and closes its own resources.\n\nIn a host, the handle a feature returns when it starts is owned by the host. `setFlag(name, false)` takes that handle down synchronously and calls its `dispose`, so the feature actually stops; `disable(name)` waits for the release to finish.',
        '在线客服功能已经为当前租户建立了连接，并每秒发送一次心跳。运营在配置中心把它关掉了。\n\n常见做法是从配置中心或功能开关服务拿到一组布尔值，在代码里写 `if (flags.liveChat) startChat()`。开关服务只告诉你值是多少，不管值变了以后怎么办：判断只在启动前做一次，开关关掉后，已经建立的连接和计时器照常运行，除非你在每个功能里自己监听开关变化、自己找到并关闭它创建的资源。\n\n在宿主里，功能启动时返回的句柄由宿主持有。`setFlag(name, false)` 会同步撤下这个句柄并调用它的 `dispose`，功能真正停下来；`disable(name)` 等待释放完成。'
      ),
      example: t(
        "import { createCapabilityHost } from '@migaia/capability'\n\nconst host = createCapabilityHost({ tenant: 'acme' }, { flags: { liveChat: true } })\nhost.register({\n  name: 'liveChat',\n  activate: ({ tenant }) => {\n    console.log('chat connected:', tenant)\n    const heartbeat = setInterval(() => console.log('heartbeat'), 1_000)\n    return {\n      dispose: () => {\n        clearInterval(heartbeat)\n        console.log('chat disconnected')\n      }\n    }\n  }\n})\nconsole.log('activation:', (await host.enable('liveChat')).status)\nhost.setFlag('liveChat', false)\nconsole.log('state:', host.state('liveChat'), 'handle:', host.handle('liveChat'))\nawait host.disable('liveChat')\nconsole.log('release finished')",
        "import { createCapabilityHost } from '@migaia/capability'\n\nconst host = createCapabilityHost({ tenant: 'acme' }, { flags: { liveChat: true } })\nhost.register({\n  name: 'liveChat',\n  activate: ({ tenant }) => {\n    console.log('连接客服:', tenant)\n    const heartbeat = setInterval(() => console.log('心跳'), 1_000)\n    return {\n      dispose: () => {\n        clearInterval(heartbeat)\n        console.log('断开客服')\n      }\n    }\n  }\n})\nconsole.log('启用结果:', (await host.enable('liveChat')).status)\nhost.setFlag('liveChat', false)\nconsole.log('状态:', host.state('liveChat'), '句柄:', host.handle('liveChat'))\nawait host.disable('liveChat')\nconsole.log('释放完成')"
      ),
      result: t(
        "Prints `chat connected: acme`, `activation: enabled`, `chat disconnected`, `state: gated handle: undefined`, then `release finished`. Turning the flag off already ran the handle's `dispose`, so the timer stops and the process exits normally with no heartbeat left behind.\n\nTurning a flag off only stops the feature; turning it back on does not start it again, so call `enable(name)` once more. When `dispose` is asynchronous the release continues in the background; wait for `disable(name)` or `dispose()` when you need to know the resources are gone.",
        '依次输出 `连接客服: acme`、`启用结果: enabled`、`断开客服`、`状态: gated 句柄: undefined`、`释放完成`。关掉开关的同时，句柄的 `dispose` 已经执行，计时器停止，进程也随之正常退出，没有遗留的心跳。\n\n关掉开关只负责停下功能，重新打开时不会自动启动，需要再调用 `enable(name)`。`dispose` 是异步时，释放会在后台继续，需要确认资源已经回收时等待 `disable(name)` 或 `dispose()`。'
      )
    },
    {
      title: t(
        'Replace every flag with a new config and release features it leaves out',
        '用一份新配置替换全部开关，未列出的功能自动释放'
      ),
      problem: t(
        "After startup the app has enabled search, chat and export. The config center pushes a new config: search stays on, chat is turned off, and export is not in the new config at all.\n\nThe usual approach compares the new config with the old one entry by entry, works out which features were turned off or removed, and calls each one's stop function. Miss one and it keeps running. Features are usually stopped in the order the code lists them, so a feature that started later, and may depend on earlier ones, can be left running or closed after the features it relies on.\n\n`setFlags(flags)` atomically replaces every flag with one new config. Any name missing from the new config counts as off, and the features that are turned off are released in the reverse order they finished starting.",
        '应用启动后打开了搜索、客服和导出三项功能。配置中心推送了一份新配置：保留搜索，关闭客服，导出没有出现在新配置里。\n\n常见做法拿到新配置后，要自己和旧配置逐项比较，找出哪些功能被关掉、哪些被删掉，再逐个调用各自的停止函数；漏掉一项，它就继续运行。停止的顺序通常是代码里写的顺序，后启动、可能依赖先启动功能的那个，反而可能先被留下或后被关闭。\n\n`setFlags(flags)` 用一整份新配置原子替换全部开关。没有出现在新配置里的名字一律视为关闭；被关闭的功能按实际启动完成的相反顺序释放。'
      ),
      example: t(
        "import { createCapabilityHost } from '@migaia/capability'\n\nconst host = createCapabilityHost(undefined, {\n  flags: { search: true, export: true, chat: true }\n})\nfor (const name of ['search', 'export', 'chat']) {\n  host.register({\n    name,\n    activate: () => {\n      console.log('start', name)\n      return { dispose: () => console.log('stop', name) }\n    }\n  })\n}\nawait host.enable('search')\nawait host.enable('chat')\nawait host.enable('export')\nhost.setFlags({ search: true, chat: false })\nconsole.log(host.names.map((name) => `${name}=${host.state(name)}`).join(' '))\nawait host.dispose()",
        "import { createCapabilityHost } from '@migaia/capability'\n\nconst host = createCapabilityHost(undefined, {\n  flags: { search: true, export: true, chat: true }\n})\nfor (const name of ['search', 'export', 'chat']) {\n  host.register({\n    name,\n    activate: () => {\n      console.log('启动', name)\n      return { dispose: () => console.log('停止', name) }\n    }\n  })\n}\nawait host.enable('search')\nawait host.enable('chat')\nawait host.enable('export')\nhost.setFlags({ search: true, chat: false })\nconsole.log(host.names.map((name) => `${name}=${host.state(name)}`).join(' '))\nawait host.dispose()"
      ),
      result: t(
        'Prints the three starts, then `stop export`, `stop chat`, `search=on export=gated chat=gated`, and finally `stop search` from `dispose()`. Export, absent from the new config, is released just like chat, which was turned off explicitly, and the release order is the reverse of the order in which they finished starting.\n\nA new config replaces the old one; it is not merged, so every feature you want to keep must be in it. Replacing only turns features off and releases them; a newly allowed feature still starts only when you call `enable(name)`. Give each tenant its own host with its own flag snapshot.',
        '依次输出三次启动，然后是 `停止 export`、`停止 chat`、`search=on export=gated chat=gated`，最后 `dispose()` 输出 `停止 search`。导出没有出现在新配置里，和明确关闭的客服一样被释放；释放顺序与启动完成顺序相反。\n\n新配置是整份替换，不是合并：想保留的功能必须写进新配置。替换只负责关闭和释放，新允许的功能仍要调用 `enable(name)` 才会启动。多租户应各建一个宿主，各自持有自己的开关快照。'
      )
    }
  ],
  createCapabilityGraph: [
    {
      title: t('Start providers first and release consumers first', '先启动提供方，先释放消费方'),
      problem: t(
        'A screen starts before its configuration service is ready, or cleanup closes the configuration while the screen still uses it.\n\nRunning startup callbacks in registration order makes correctness depend on which module registers first. Reversing whichever async callbacks happened to finish first does not reliably reverse dependency order.\n\nRegister a static capability graph with explicit required provider edges, then await `ready()`. Each start callback can read its declared ready providers through `context.get()`. The graph owns the returned instances and releases them in reverse topology when disposed.',
        '页面在配置服务就绪前启动，或者清理时配置已经关闭，页面却仍在使用它。\n\n按登记顺序执行启动回调，会让正确性依赖哪个模块先登记；异步回调的完成顺序也不能可靠地代表依赖关系，直接把它倒过来清理仍可能出错。\n\n在静态能力图中登记明确的必需提供方依赖，再等待 `ready()`。启动回调用 `context.get()` 读取已声明且就绪的提供方，图持有返回实例，并在释放时按拓扑逆序清理。'
      ),
      example: t(
        "import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'\n\nconst config = 'config' as IGraphNodeId\nconst screen = 'screen' as IGraphNodeId\nconst graph = createCapabilityGraph()\ngraph.register({ id: screen, kind: 'view', dependencies: [{ provider: config, required: true }],\n  start: context => {\n    console.log('start screen:', context.get<{ theme: string }>(config).theme)\n    return { value: 'screen', release: () => { console.log('release screen') } }\n  }\n})\ngraph.register({ id: config, kind: 'service', dependencies: [], start: () => {\n  console.log('start config')\n  return { value: { theme: 'dark' }, release: () => { console.log('release config') } }\n} })\nawait graph.ready()\nconsole.log('state:', graph.state)\nawait graph.dispose()",
        "import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'\n\nconst config = 'config' as IGraphNodeId\nconst screen = 'screen' as IGraphNodeId\nconst graph = createCapabilityGraph()\ngraph.register({ id: screen, kind: 'view', dependencies: [{ provider: config, required: true }],\n  start: context => {\n    console.log('启动页面:', context.get<{ theme: string }>(config).theme)\n    return { value: 'screen', release: () => { console.log('释放页面') } }\n  }\n})\ngraph.register({ id: config, kind: 'service', dependencies: [], start: () => {\n  console.log('启动配置')\n  return { value: { theme: 'dark' }, release: () => { console.log('释放配置') } }\n} })\nawait graph.ready()\nconsole.log('状态:', graph.state)\nawait graph.dispose()"
      ),
      result: t(
        'Prints `start config`, `start screen: dark`, `state: ready`, `release screen`, then `release config`.\n\nAlthough the consumer was registered first, its provider starts first and is released last. This is a resource dependency graph, not a reactive data graph. Registration freezes at the first `ready()`; use the dynamic graph entry when definitions must change after startup.',
        '依次输出 `启动配置`、`启动页面: dark`、`状态: ready`、`释放页面`、`释放配置`。\n\n虽然消费方先登记，提供方仍先启动、后释放。这是资源依赖图，不是响应式数据图。首次 `ready()` 会冻结登记，需要在启动后增删定义时应选择动态图入口。'
      )
    },
    {
      title: t(
        'Roll back a provider when its consumer fails to start',
        '消费方启动失败时回滚已启动的提供方'
      ),
      problem: t(
        'A service starts successfully but its dependent screen fails, leaving the service running even though the feature never became ready.\n\nA handwritten sequence that simply awaits each start stops at the thrown error. Previously created resources remain live unless every failure path manually releases them without losing the primary error.\n\nAwait `ready()` on the graph and catch its failure. The graph settles the active startup level, rolls back resources it already owns and retains the original startup failure for diagnostics.',
        '服务已经成功启动，依赖它的页面却启动失败，整个功能没有就绪，服务仍留在后台运行。\n\n手写顺序启动通常在某个 `await` 抛错后直接退出；之前创建的资源不会自动释放，必须在每条失败路径补清理，还要避免清理错误覆盖启动主错误。\n\n等待图的 `ready()` 并捕获失败。图会等待当前启动层结束，回滚已经持有的资源，并保留原始启动失败供诊断。'
      ),
      example: t(
        "import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'\n\nconst provider = 'config' as IGraphNodeId\nconst consumer = 'screen' as IGraphNodeId\nconst primary = new Error('screen startup failed')\nconst graph = createCapabilityGraph()\ngraph.register({ id: provider, kind: 'service', dependencies: [], start: () => ({\n  value: { theme: 'dark' }, release: () => { console.log('rolled back config') }\n}) })\ngraph.register({ id: consumer, kind: 'view', dependencies: [{ provider, required: true }],\n  start: () => { throw primary }\n})\ntry { await graph.ready() }\ncatch (error) {\n  console.log('original failure:', error === primary)\n  console.log('code:', (error as Error & { code: string }).code)\n}\nconsole.log('provider:', graph.nodeState(provider).state)\nconsole.log('graph:', graph.state)\nawait graph.dispose()",
        "import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'\n\nconst provider = 'config' as IGraphNodeId\nconst consumer = 'screen' as IGraphNodeId\nconst primary = new Error('页面启动失败')\nconst graph = createCapabilityGraph()\ngraph.register({ id: provider, kind: 'service', dependencies: [], start: () => ({\n  value: { theme: 'dark' }, release: () => { console.log('回滚配置') }\n}) })\ngraph.register({ id: consumer, kind: 'view', dependencies: [{ provider, required: true }],\n  start: () => { throw primary }\n})\ntry { await graph.ready() }\ncatch (error) {\n  console.log('保留原错:', error === primary)\n  console.log('错误码:', (error as Error & { code: string }).code)\n}\nconsole.log('提供方:', graph.nodeState(provider).state)\nconsole.log('图状态:', graph.state)\nawait graph.dispose()"
      ),
      result: t(
        'Prints `rolled back config`, `original failure: true`, `code: GRAPH_START_FAILED`, `provider: rolled-back`, then `graph: failed`.\n\nThe provider is released before readiness rejects. This ordinary extensible Error retains its identity when tagged; foreign-source or non-extensible errors may instead be wrapped with the original on the cause chain. A failed static graph does not retry implicitly.',
        '依次输出 `回滚配置`、`保留原错: true`、`错误码: GRAPH_START_FAILED`、`提供方: rolled-back`、`图状态: failed`。\n\n提供方在就绪结果拒绝前已释放。这个普通可扩展 Error 被附加标识后仍是原对象；已有其他来源或不可扩展的错误可能被包装，原错仍在原因链上。失败的静态图不会隐式重试。'
      )
    }
  ],
  buildCapabilityTopology: [
    {
      title: t('Inspect startup order before acquiring resources', '申请资源前先查看依赖启动顺序'),
      problem: t(
        'A configuration editor needs to preview provider order and dependency depth before it starts any service.\n\nSorting only by registration order can place a consumer first. Reusing a running graph just to inspect its order would also mix validation and planning with resource startup.\n\nPass node IDs, dependency edges and dense registration ordinals to `buildCapabilityTopology()`, together with the three caller-owned failure callbacks. It returns a frozen topology snapshot: the planned order and levels, without invoking resource startup or release.',
        '配置编辑器需要先预览提供方顺序和依赖深度，再决定是否启动服务。\n\n只按登记顺序排序可能把消费方排在前面；为了看顺序就启动一张运行图，又会把校验规划和资源申请混在一起。\n\n向 `buildCapabilityTopology()` 传入节点标识、依赖边和连续登记序号，并提供三个由调用方决定错误形式的失败回调。它返回冻结拓扑快照，提供计划顺序与层级，不执行资源启动或释放。'
      ),
      example: t(
        "import { buildCapabilityTopology } from '@migaia/capability/graph/topology'\n\nconst nodes = [\n  { id: 'screen', ordinal: 0, dependencies: [{ provider: 'config', required: true }] },\n  { id: 'config', ordinal: 1, dependencies: [] },\n  { id: 'health', ordinal: 2, dependencies: [] }\n]\nconst invalid = new Error('invalid topology configuration')\nconst reject = (): never => { throw invalid }\nconst topology = buildCapabilityTopology(nodes, reject, reject, reject)\nconsole.log('input:', nodes.map(node => node.id).join(','))\nconsole.log('order:', topology.ordered.map(node => node.id).join(','))\nconsole.log('levels:', topology.level.get('config'), topology.level.get('health'), topology.level.get('screen'))\nconsole.log('frozen:', Object.isFrozen(topology.ordered))",
        "import { buildCapabilityTopology } from '@migaia/capability/graph/topology'\n\nconst nodes = [\n  { id: 'screen', ordinal: 0, dependencies: [{ provider: 'config', required: true }] },\n  { id: 'config', ordinal: 1, dependencies: [] },\n  { id: 'health', ordinal: 2, dependencies: [] }\n]\nconst invalid = new Error('拓扑配置无效')\nconst reject = (): never => { throw invalid }\nconst topology = buildCapabilityTopology(nodes, reject, reject, reject)\nconsole.log('输入顺序:', nodes.map(node => node.id).join(','))\nconsole.log('计划顺序:', topology.ordered.map(node => node.id).join(','))\nconsole.log('层级:', topology.level.get('config'), topology.level.get('health'), topology.level.get('screen'))\nconsole.log('冻结:', Object.isFrozen(topology.ordered))"
      ),
      result: t(
        'Prints `input: screen,config,health`, `order: config,health,screen`, `levels: 0 0 1`, then `frozen: true`.\n\nThe plan puts providers before consumers and uses registration ordinals within a level without changing the input array. Ordinals must uniquely cover 0 through nodeCount minus one. This API plans only; use `createCapabilityGraph()` to own resource startup and release.',
        '依次输出 `输入顺序: screen,config,health`、`计划顺序: config,health,screen`、`层级: 0 0 1`、`冻结: true`。\n\n计划先排列提供方，同层按登记序号排序，且没有改变输入数组。登记序号必须唯一覆盖 0 至节点数减一。这个 API 只负责规划，需要持有资源启停时使用 `createCapabilityGraph()`。'
      )
    }
  ]
}
