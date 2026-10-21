import type { ICaseDoc, IText, IOptionCaseDoc } from './contract.js'

/** Bilingual production scenarios using real public endpoint factories. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete memory examples preserve the transport creator’s final close responsibility. */
export const rpcCoreCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createEndpoint: [
    {
      title: t(
        'Call a real provider through an in-memory endpoint pair',
        '通过一对内存端点调用实际处理函数'
      ),
      problem: t(
        'Two modules need a request and a matching reply without opening a worker or network connection. The caller should await the provider’s result rather than manage message listeners itself.\n\nHand-written send and subscribe code must match replies, distinguish method names, and remove listeners at shutdown. A physical channel alone does not supply those request semantics.\n\nGive each createEndpoint one side of createMemoryTransportPair and a matching connect plugin. Register double with provide, return context.success, then await client.send and dispose both endpoints.',
        '两个模块需要请求与对应答复，又不想打开线程或网络连接；调用者应直接等待处理结果，而非自行维护消息监听。\n\n手写发送与订阅代码，需要自行关联答复、区分方法名并在关闭时移除监听，物理通道本身不提供这些请求语义。\n\n为每个 `createEndpoint` 提供内存通道的一侧和配套 `connect` 插件，用 `provide` 登记 `double` 并返回 `context.success`，再等待 `client.send`，最后释放两端。'
      ),
      example: t(
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\nconsole.log(await client.send<number>('server', 'double', 21))\nawait client.dispose()\nawait server.dispose()\nleft.close()",
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\nconsole.log(await client.send<number>('server', 'double', 21))\nawait client.dispose()\nawait server.dispose()\nleft.close()"
      ),
      result: t(
        'Prints `42`. The provider receives 21 as context.data and its success result settles the caller’s send Promise through the actual endpoint and memory transport path.\n\nThis preset includes sending, provider registration, discovery and control. connect binds the transport; memory delivery is asynchronous and shares values by reference. Endpoint disposal leaves this borrowed pair open, so the caller closes it explicitly.',
        '输出 `42`；处理函数从 `context.data` 取得 `21`，成功结果经过真实端点与内存传输，兑现调用方的发送 Promise。\n\n该预设包含发送、处理函数登记、发现与控制；`connect` 绑定传输对象，内存消息异步交付且值仍共享引用。端点释放后借入的通道对仍打开，调用者须显式关闭。'
      )
    },
    {
      title: t(
        'Keep concurrent replies attached to their own requests',
        '让并发答复回到各自的请求'
      ),
      problem: t(
        'A slow request starts first, but a later request finishes first. Updating one shared current-request slot can send the later result to the wrong waiter.\n\nMatching only by method name cannot distinguish two simultaneous calls to double. Assuming response order follows send order breaks as soon as provider work completes out of order.\n\nUse a separate send Promise for each invocation. The provider holds the first call behind an explicit gate; the client awaits the second result before releasing and awaiting the first.',
        '较慢请求先启动，后来的请求却先完成；若只维护一个“当前请求”槽，后一个结果可能交给错误的等待者。\n\n只按方法名匹配，无法区分同时调用的两个 `double`；假定答复顺序等于发送顺序，也会在处理任务乱序完成时失效。\n\n每次调用分别保留 `send` 的 Promise；处理函数用明确的完成门控制首个调用，客户端先取得第二个结果，再放行并等待第一个。'
      ),
      example: t(
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nlet started!: () => void\nlet release!: () => void\nconst firstStarted = new Promise<void>((resolve) => { started = resolve })\nserver.provide('double', async (context) => {\n  const value = context.data as number\n  if (value === 2) {\n    started()\n    await new Promise<void>((resolve) => { release = resolve })\n  }\n  return context.success(value * 2)\n})\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\nconst first = client.send<number>('server', 'double', 2)\nawait firstStarted\nconsole.log(await client.send<number>('server', 'double', 5))\nrelease()\nconsole.log(await first)\nawait client.dispose()\nawait server.dispose()\nleft.close()",
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nlet started!: () => void\nlet release!: () => void\nconst firstStarted = new Promise<void>((resolve) => { started = resolve })\nserver.provide('double', async (context) => {\n  const value = context.data as number\n  if (value === 2) {\n    started()\n    await new Promise<void>((resolve) => { release = resolve })\n  }\n  return context.success(value * 2)\n})\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\nconst first = client.send<number>('server', 'double', 2)\nawait firstStarted\nconsole.log(await client.send<number>('server', 'double', 5))\nrelease()\nconsole.log(await first)\nawait client.dispose()\nawait server.dispose()\nleft.close()"
      ),
      result: t(
        'Prints `10` and `4`. The call with 5 settles before the held call with 2, and each Promise still receives its own doubled input.\n\nReplies are correlated by operation identity rather than completion order. The gates only make that order observable; they add no timer or transport implementation. Provider work may run concurrently, so application state still needs its own concurrency policy.',
        '逐行输出 `10`、`4`；参数为 `5` 的调用先于被暂挂的 `2` 完成，每个 Promise 仍取得各自输入的二倍值。\n\n答复按操作身份关联，而非按完成先后分配；完成门只让顺序可观察，不添加计时器或自制传输实现。处理任务可能并发执行，业务状态仍需自行确定并发策略。'
      )
    },
    {
      title: t(
        'Reject a duplicate provider without replacing the active handler',
        '拒绝重复登记，并保留原处理函数'
      ),
      problem: t(
        'Two initialization paths register the same method name. A plain map assignment silently replaces the first handler and changes which business operation later callers execute.\n\nWithout registration admission, the second owner cannot tell that it has taken over another owner’s method. Checking a separate list can also drift from the actual dispatch registry.\n\nRegister the provider on the endpoint itself. A second provide call for that method throws PROVIDER_DUPLICATED; catch that configuration failure and call the original method through the real client.',
        '两条初始化路径登记了同一方法名；直接覆盖映射表，会悄悄替换第一个处理函数，改变后续调用执行的业务操作。\n\n没有登记准入检查时，第二个所有者无法得知自己接管了别人的方法，另建一份名称列表又可能与实际分派表脱节。\n\n直接在端点登记处理函数；同名的第二次 `provide` 抛出 `PROVIDER_DUPLICATED`，捕获这一配置失败后，再通过真实客户端调用原方法。'
      ),
      example: t(
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('version', (context) => context.success('original'))\ntry {\n  server.provide('version', (context) => context.success('replacement'))\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\nconsole.log(await client.send('server', 'version', null))\nawait client.dispose()\nawait server.dispose()\nleft.close()",
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('version', (context) => context.success('原处理函数'))\ntry {\n  server.provide('version', (context) => context.success('替换处理函数'))\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\nconsole.log(await client.send('server', 'version', null))\nawait client.dispose()\nawait server.dispose()\nleft.close()"
      ),
      result: t(
        'Prints `PROVIDER_DUPLICATED` and `original`. The duplicate is refused synchronously and does not overwrite the first registered handler.\n\nMethod names are application contracts and must be unique within the endpoint. This does not authorize hot replacement or retry failed setup automatically. Dispose the endpoint to release its registrations and close the caller-owned pair separately.',
        '逐行输出 `PROVIDER_DUPLICATED`、`原处理函数`；重复登记被同步拒绝，没有覆盖第一个处理函数。\n\n方法名由应用约定，在同一端点内必须唯一；这不提供热替换，也不会自动重试失败初始化。释放端点以清理登记，再单独关闭调用者拥有的通道对。'
      )
    },
    {
      title: t(
        'Release an endpoint without closing its borrowed transport pair',
        '释放端点，同时保留借入的传输通道'
      ),
      problem: t(
        'A component ends its RPC work while another owner still manages the physical channel. Treating endpoint cleanup as unconditional transport closure can tear down a shared resource too soon.\n\nA wrapper cannot infer ownership merely because it can call close. Resource creation and endpoint subscription can belong to different owners with different lifetimes.\n\nThe memory pair declares borrowed ownership. Dispose the endpoint and inspect both closed flags, then let the pair’s caller perform its explicit final close.',
        '组件结束 RPC 工作时，另一个所有者仍在管理物理通道；若把端点清理等同于无条件关闭传输资源，就可能过早拆掉共享资源。\n\n包装器拥有调用 `close` 的能力，并不代表它拥有底层资源；资源创建与端点订阅可能属于不同所有者，生命周期也不同。\n\n内存通道对声明借用关系；先释放端点并检查两侧 `closed`，再由创建通道对的调用者显式执行最终关闭。'
      ),
      example: t(
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst endpoint = await createEndpoint({\n  id: 'local',\n  transport: left,\n  middlewares: [connect({ transport: left })]\n})\nawait endpoint.dispose()\nconsole.log(left.closed, right.closed)\nleft.close()\nconsole.log(left.closed, right.closed)",
        "import { connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst endpoint = await createEndpoint({\n  id: 'local',\n  transport: left,\n  middlewares: [connect({ transport: left })]\n})\nawait endpoint.dispose()\nconsole.log(left.closed, right.closed)\nleft.close()\nconsole.log(left.closed, right.closed)"
      ),
      result: t(
        'Prints `false false` and `true true`. Endpoint disposal leaves both borrowed sides open; explicitly closing either side then closes the complete memory pair.\n\nThis ownership rule belongs to this adapter, not every transport. Endpoint subscriptions and pending operations are still retired. Owned transports can be closed during disposal; use the actual adapter’s ownership contract rather than assuming all closes behave alike.',
        '逐行输出 `false false`、`true true`；端点释放后两侧借入通道仍打开，随后显式关闭一侧会关闭整个内存通道对。\n\n这是当前适配器的所有权规则，不能推广到所有传输对象；端点订阅与在途操作仍会清理。拥有型传输对象可在释放时关闭，应按实际适配器契约确定关闭责任。'
      )
    }
  ],
  timeout: [
    {
      title: t(
        'Override one request’s inherited deadline without changing other calls',
        '只覆盖某次请求的继承期限'
      ),
      problem: t(
        'Most calls use one waiting budget, but an already-expired request should fail immediately and a deliberate long-running call needs to opt out. Changing a shared timeout setting affects unrelated work.\n\nRacing a timer outside send leaves request bookkeeping and remote waiting unaware of that deadline. Treating false and an omitted option as the same value also loses the caller’s explicit opt-out.\n\nInstall timeout({ timeoutMs: 5000 }) and override timeoutMs per send. A zero budget rejects before request submission; false disables this call’s deadline without changing the installed default.',
        '多数调用共用等待预算，但已过期请求应立即失败，明确的长任务又需要取消期限；修改共享超时配置会影响无关工作。\n\n在 `send` 外另做计时竞速，会让请求登记与远端等待不知道该期限；把 `false` 与省略选项当成同一值，也会丢失调用者明确取消期限的选择。\n\n安装 `timeout({ timeoutMs: 5000 })`，再逐次为 `send` 覆盖 `timeoutMs`；零预算在提交请求前拒绝，`false` 取消当前调用期限，不改变已安装默认值。'
      ),
      example: t(
        "import { connect, createEndpoint, timeout } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({\n  id: 'client',\n  targetIds: ['server'],\n  transport: left,\n  middlewares: [connect({ transport: left }), timeout({ timeoutMs: 5000 })]\n})\ntry {\n  await client.send('server', 'double', 21, { timeoutMs: 0 })\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nconsole.log(await client.send('server', 'double', 21, { timeoutMs: false }))\nawait client.dispose()\nawait server.dispose()\nleft.close()",
        "import { connect, createEndpoint, timeout } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({\n  id: 'client',\n  targetIds: ['server'],\n  transport: left,\n  middlewares: [connect({ transport: left }), timeout({ timeoutMs: 5000 })]\n})\ntry {\n  await client.send('server', 'double', 21, { timeoutMs: 0 })\n} catch (error) {\n  console.log((error as { code: string }).code)\n}\nconsole.log(await client.send('server', 'double', 21, { timeoutMs: false }))\nawait client.dispose()\nawait server.dispose()\nleft.close()"
      ),
      result: t(
        'Prints `DEADLINE_EXCEEDED` and `42`. The first call has no remaining budget; the second explicitly disables its local deadline and receives the provider’s result.\n\ntimeout({}) leaves the configured deadline undefined, while omitting the plugin entirely uses Core’s 1000 ms fallback. Values must be finite nonnegative milliseconds or false. A deadline limits waiting; it cannot preempt synchronous provider code.',
        '逐行输出 `DEADLINE_EXCEEDED`、`42`；首个调用已无剩余预算，第二个明确取消本地期限并取得处理结果。\n\n`timeout({})` 的期限配置为 `undefined`，完全不安装插件时 Core 则回退到 `1000` 毫秒；取值须为有限非负毫秒或 `false`。期限限制等待，不能抢占同步业务代码。'
      )
    }
  ],
  abort: [
    {
      title: t(
        'Ask an already-running provider to stop cooperatively',
        '让已经运行的处理函数协作停止'
      ),
      problem: t(
        'A caller leaves a page after provider work has started. Rejecting only the local Promise leaves the remote operation consuming resources unless its cancellation signal is also notified.\n\nAn external Promise race cannot inform the provider which live operation should stop. Conversely, assuming cancellation can interrupt arbitrary user code promises more than a signal can do.\n\nInstall abort() on both endpoints and pass an AbortController signal to send. Wait for the provider’s start gate, abort the caller, and let the provider finish after its context.signal receives cancellation.',
        '调用者离开页面时，处理任务已经启动；若只拒绝本地 Promise，远端操作没有收到取消信号，仍会继续消耗资源。\n\n外部 Promise 竞速无法通知处理方停止哪项在途操作；反过来，若认为取消能打断任意用户代码，又超出了信号本身的能力。\n\n在两端安装 `abort()`，向 `send` 传入 `AbortController` 信号；等处理函数已启动后取消调用方，处理函数收到 `context.signal` 取消通知后自行结束。'
      ),
      example: t(
        "import { abort, connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server', transport: right,\n  middlewares: [connect({ transport: right }), abort()]\n})\nlet started!: () => void\nlet stopped!: () => void\nlet providerSawAbort = false\nconst providerStarted = new Promise<void>((resolve) => { started = resolve })\nconst providerStopped = new Promise<void>((resolve) => { stopped = resolve })\nserver.provide('wait', async (context) => {\n  started()\n  await new Promise<void>((resolve) => {\n    context.signal.addEventListener('abort', () => { resolve() }, { once: true })\n  })\n  providerSawAbort = context.signal.aborted\n  stopped()\n  return context.success(null)\n})\nconst client = await createEndpoint({\n  id: 'client', targetIds: ['server'], transport: left,\n  middlewares: [connect({ transport: left }), abort()]\n})\nconst controller = new AbortController()\nconst outcome = client.send('server', 'wait', null, { signal: controller.signal }).then(\n  () => 'fulfilled',\n  (error: unknown) => (error as { code: string }).code\n)\nawait providerStarted\ncontroller.abort()\nconsole.log(await outcome)\nawait providerStopped\nconsole.log(providerSawAbort)\nawait client.dispose()\nawait server.dispose()\nleft.close()",
        "import { abort, connect, createEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({\n  id: 'server', transport: right,\n  middlewares: [connect({ transport: right }), abort()]\n})\nlet started!: () => void\nlet stopped!: () => void\nlet providerSawAbort = false\nconst providerStarted = new Promise<void>((resolve) => { started = resolve })\nconst providerStopped = new Promise<void>((resolve) => { stopped = resolve })\nserver.provide('wait', async (context) => {\n  started()\n  await new Promise<void>((resolve) => {\n    context.signal.addEventListener('abort', () => { resolve() }, { once: true })\n  })\n  providerSawAbort = context.signal.aborted\n  stopped()\n  return context.success(null)\n})\nconst client = await createEndpoint({\n  id: 'client', targetIds: ['server'], transport: left,\n  middlewares: [connect({ transport: left }), abort()]\n})\nconst controller = new AbortController()\nconst outcome = client.send('server', 'wait', null, { signal: controller.signal }).then(\n  () => 'fulfilled',\n  (error: unknown) => (error as { code: string }).code\n)\nawait providerStarted\ncontroller.abort()\nconsole.log(await outcome)\nawait providerStopped\nconsole.log(providerSawAbort)\nawait client.dispose()\nawait server.dispose()\nleft.close()"
      ),
      result: t(
        'Prints `CANCELLED` and `true`. The caller rejects with the cancellation code, and the separate provider-completion gate confirms that the running provider observed an aborted signal.\n\nabort() has no options and enables cooperative remote cancellation. The provider must observe its signal and release resources itself; synchronous work is not preempted. Pre-aborted local admission is a Core behavior and alone does not prove remote cancellation.',
        '逐行输出 `CANCELLED`、`true`；调用方以取消码拒绝，独立的处理完成门确认正在运行的处理函数已观察到取消信号。\n\n`abort()` 没有选项，启用远端协作取消；处理函数须观察信号并自行释放资源，同步工作不会被抢占。预先取消时的本地准入拒绝属于 Core 行为，不能单独证明远端取消。'
      )
    }
  ]
}

/** Reader-facing option stories; application functions remain with their application owners. */
export const rpcCoreOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  createEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\n\nconst checkout = await createEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = await createEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n})",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createClientEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createClientEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = await createClientEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n})",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createProviderEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createProviderEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = await createProviderEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n})",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createFullEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createFullEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = await createFullEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n})",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createFullOneWayEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createFullOneWayEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = await createFullOneWayEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n})",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createComposedEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createComposedEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n}, endpointFeatures)\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = await createComposedEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n}, endpointFeatures)",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createRuntimeApiEndpoint: [
    {
      title: {
        en: 'Connect the checkout to its catalog',
        zh: '把结算页连接到商品服务'
      },
      problem: {
        en: 'The checkout already owns catalogTransport, opened by its platform adapter. Give the endpoint the same transport as connect so requests use that channel. targetIds records the known catalog service. Dispose the endpoint when checkout closes; the transport owner handles its physical lifetime.',
        zh: '结算页已持有平台适配器打开的 catalogTransport。端点与 connect 使用同一传输对象，请求才能走这条通道；targetIds 记录已知的商品服务。离开结算页时释放端点，物理通道的生命周期由创建它的组件管理。'
      },
      example:
        "import { createRuntimeApiEndpoint, connect } from '@migaia/rpc-core'\n\nconst checkout = createRuntimeApiEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n}, catalogChannel)\nonCheckoutClosed(() => checkout.dispose())",
      result: {
        en: 'The checkout endpoint addresses catalog on the application’s existing channel.',
        zh: '结算页端点通过应用已有通道寻址商品服务。'
      },
      covers: ['id', 'targetIds', 'transport', 'middlewares']
    },
    {
      title: {
        en: 'Stop setup when the page leaves',
        zh: '离开页面时停止连接准备'
      },
      problem: {
        en: 'A screen may close while middleware is still starting. Pass its AbortController signal to construction so leaving the screen cancels setup and rolls back installed middleware. A five-second budget also stops setup that never becomes ready.',
        zh: '界面可能在中间件尚未启动完成时关闭。将界面的 AbortController 信号交给 construction，离开时即可取消准备并回滚已安装的中间件；五秒预算还可结束始终无法就绪的准备。'
      },
      example:
        "import { createRuntimeApiEndpoint, connect } from '@migaia/rpc-core'\n\nconst opening = new AbortController()\nonCheckoutClosed(() => opening.abort())\nconst checkout = createRuntimeApiEndpoint({\n  id: 'checkout',\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })],\n  construction: { signal: opening.signal, timeoutMs: 5000 }\n}, catalogChannel)",
      result: {
        en: 'Leaving the screen ends unfinished setup instead of leaving a partially installed endpoint.',
        zh: '离开界面会终止未完成的准备，不会留下安装到一半的端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createRpcIdempotencyStore: [
    {
      title: {
        en: 'Keep retry results for one checkout session',
        zh: '为一次结算保留重试结果'
      },
      problem: {
        en: 'An order submission can be retried after its reply is lost. Keep completed outcomes for five minutes so a retry with the same key can reuse its result. Bound entries per session so one checkout cannot consume the whole store.',
        zh: '订单提交后，答复丢失可能触发重试。保留五分钟结果，相同键的重试即可复用先前结果；限制每个会话的条目数，避免某次结算占满存储。'
      },
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-core'\n\nconst orderOutcomes = createRpcIdempotencyStore({\n  retentionMs: 300000,\n  maxEntries: 1000,\n  maxEntriesPerScope: 20\n})",
      result: {
        en: 'Recent order results remain available to keyed retries within the configured capacity.',
        zh: '在设置的容量内，近期订单结果可供携带相同键的重试复用。'
      },
      covers: ['retentionMs', 'maxEntries', 'maxEntriesPerScope']
    },
    {
      title: {
        en: 'Keep large exports out of the outcome cache',
        zh: '避免导出文件占满结果缓存'
      },
      problem: {
        en: 'An export service returns much larger results than ordinary order calls. Bound total bytes and each outcome so caching exports cannot consume unbounded memory.',
        zh: '导出服务的结果远大于普通订单调用。限制总字节数与单个结果大小，避免缓存导出内容时无限占用内存。'
      },
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-core'\n\nconst exportOutcomes = createRpcIdempotencyStore({\n  maxBytes: 8 * 1024 * 1024,\n  maxOutcomeBytes: 256 * 1024\n})",
      result: {
        en: 'The outcome store has an explicit memory budget for retained results.',
        zh: '保留结果的存储有明确内存预算。'
      },
      covers: ['maxBytes', 'maxOutcomeBytes']
    }
  ],
  contract: [
    {
      title: {
        en: 'Roll out a new catalog version gradually',
        zh: '逐步发布新版商品服务'
      },
      problem: {
        en: 'A catalog deployment must accept calls from the previous client while new clients move to version 2. Advertise version 2 but accept both named versions during the rollout.',
        zh: '商品服务发布新版时，旧客户端仍需继续调用。对外声明版本 2，同时在迁移期间接受两个明确版本。'
      },
      example:
        "import { contract } from '@migaia/rpc-core'\n\nconst catalogContract = contract({\n  version: '2.0.0',\n  acceptVersions: ['1.0.0', '2.0.0'],\n  maxIdentifierLength: 128\n})",
      result: {
        en: 'Old and new clients can negotiate the declared versions during deployment.',
        zh: '部署期间，新旧客户端都可使用声明的兼容版本。'
      },
      covers: ['version', 'acceptVersions', 'maxIdentifierLength']
    },
    {
      title: {
        en: 'Reject invalid order input before saving',
        zh: '保存订单前拒绝非法输入'
      },
      problem: {
        en: 'The order handler must receive a valid order shape. Give contract the application’s order schema so malformed requests are rejected before the handler mutates data.',
        zh: '订单处理函数只应收到合法订单。将应用的订单校验规则交给 contract，让非法请求在处理函数修改数据前被拒绝。'
      },
      example:
        "import { contract } from '@migaia/rpc-core'\n\nconst orderContract = contract({\n  schemas: { saveOrder: { params: orderSchema, result: savedOrderSchema } }\n})",
      result: {
        en: 'The order provider runs only after its request passes the configured schema.',
        zh: '请求通过所设校验规则后，订单处理函数才会运行。'
      },
      covers: ['schemas']
    }
  ],
  hooks: [
    {
      title: {
        en: 'Send request diagnostics to monitoring',
        zh: '把请求诊断发给监控'
      },
      problem: {
        en: 'A checkout needs request diagnostics without adding logging to each provider. Install a listener that forwards hook events to monitoring; it observes endpoint activity without changing business results.',
        zh: '结算流程需要请求诊断，又不想在每个处理函数里加日志。安装监听器将钩子事件交给监控，即可观察端点活动而不改变业务结果。'
      },
      example:
        "import { hooks } from '@migaia/rpc-core'\n\nconst requestLogging = hooks({\n  listeners: (event) => recordRpcEvent(event)\n})",
      result: {
        en: 'Monitoring receives request events from endpoints that install this plugin.',
        zh: '安装此插件的端点会把请求事件交给监控。'
      },
      covers: ['listeners']
    },
    {
      title: {
        en: 'Keep a broken log sink visible',
        zh: '单独报告日志接收器故障'
      },
      problem: {
        en: 'A logging listener can fail when its sink is unavailable. Send that failure to a separate monitoring path so the observer failure remains visible without replacing the request result.',
        zh: '日志接收器不可用时，监听器本身可能失败。把这类失败交给独立监控通道，既保留故障信息，也不替换请求的业务结果。'
      },
      example:
        "import { hooks } from '@migaia/rpc-core'\n\nconst requestLogging = hooks({\n  listeners: (event) => recordRpcEvent(event),\n  onHookError: (error, event) => reportLoggingFailure(error, event)\n})",
      result: {
        en: 'The business call keeps its own result, while monitoring records the logging failure.',
        zh: '业务调用保留自身结果，监控同时记录日志链路故障。'
      },
      covers: ['onHookError']
    }
  ],
  uuid: [
    {
      title: {
        en: 'Recognize checkout calls in logs',
        zh: '在日志中识别结算调用'
      },
      problem: {
        en: 'Several endpoints share one trace sink. Prefix unique operation identifiers with the checkout name so operators can identify which endpoint originated a call.',
        zh: '多个端点共用追踪接收器。为唯一操作标识添加结算前缀，排查时就能识别调用来自哪个端点。'
      },
      example:
        "import { uuid } from '@migaia/rpc-core'\n\nconst checkoutIds = uuid({\n  generate: () => `checkout-${crypto.randomUUID()}`\n})",
      result: {
        en: 'Outgoing operations carry unique identifiers with a recognizable checkout prefix.',
        zh: '出站操作带有唯一标识，并能从前缀识别结算端点。'
      },
      covers: ['generate']
    },
    {
      title: {
        en: 'Use the application’s identifier service',
        zh: '复用应用的标识生成服务'
      },
      problem: {
        en: 'An application already supplies synchronous globally unique request identifiers. Reuse that generator instead of introducing a second identifier format inside RPC.',
        zh: '应用已有同步生成全局唯一请求标识的服务。直接复用它，避免 RPC 再引入另一套标识格式。'
      },
      example:
        "import { uuid } from '@migaia/rpc-core'\n\nconst requestIds = uuid({ generate: () => nextRequestId() })",
      result: {
        en: 'RPC requests use the identifier format already understood by application tracing.',
        zh: 'RPC 请求使用应用追踪系统已有的标识格式。'
      },
      covers: ['generate']
    }
  ],
  timeout: [
    {
      title: {
        en: 'Limit how long checkout waits for prices',
        zh: '限制结算等待价格的时间'
      },
      problem: {
        en: 'A checkout should show a recoverable error if pricing does not answer promptly. Install a two-second default so calls without an override have a bounded wait.',
        zh: '价格服务迟迟不答复时，结算页应显示可重试的错误。安装两秒默认期限，让没有单次覆盖的调用都有等待上限。'
      },
      example:
        "import { timeout } from '@migaia/rpc-core'\n\nconst pricingDeadline = timeout({ timeoutMs: 2000 })",
      result: {
        en: 'Calls that inherit this plugin’s policy stop waiting after their local two-second budget.',
        zh: '继承该插件策略的调用会在本地两秒预算用尽后停止等待。'
      },
      covers: ['timeoutMs']
    },
    {
      title: {
        en: 'Let an export own its waiting lifetime',
        zh: '由导出流程管理等待生命周期'
      },
      problem: {
        en: 'A deliberate long export should wait until completion or explicit cancellation. Use false when the application owns that lifetime and should not inherit a timer deadline.',
        zh: '明确的长时间导出需要等到完成或用户主动取消。由应用管理这段生命周期时使用 false，避免继承计时期限。'
      },
      example:
        "import { timeout } from '@migaia/rpc-core'\n\nconst exportDeadline = timeout({ timeoutMs: false })",
      result: {
        en: 'The installed default does not end an export merely because a timer elapsed.',
        zh: '安装后的默认策略不会仅因计时结束而终止导出等待。'
      },
      covers: ['timeoutMs']
    }
  ],
  createPeerPair: [
    {
      title: {
        en: 'Call a local pricing service',
        zh: '调用进程内的价格服务'
      },
      problem: {
        en: 'Two application modules need request semantics without a native worker. Register the pricing function on one peer and call it from the other; close both peers when their owner leaves.',
        zh: '两个应用模块需要请求语义，却不需要原生线程。在一端登记价格函数，再从另一端调用；所有者退出时关闭两端。'
      },
      example:
        "import { createPeerPair } from '@migaia/rpc-core/testing'\n\nconst pair = await createPeerPair({\n  a: { provide: {} },\n  b: { provide: { prices: () => fetchPrices() } }\n})\ntry {\n  renderPrices(await pair.a.request('prices'))\n} finally {\n  await pair.a.close()\n  await pair.b.close()\n}",
      result: {
        en: 'The caller receives the pricing function’s result through the local RPC pair.',
        zh: '调用方通过进程内 RPC 通道取得价格函数的结果。'
      },
      covers: ['a', 'b']
    },
    {
      title: {
        en: 'Share local diagnostics and timing',
        zh: '共用本地诊断与时钟'
      },
      problem: {
        en: 'An application owns both peers and already has a monotonic scheduler and monitoring sink. Pass them to the pair so local RPC work follows the application’s timing and reporting policy.',
        zh: '应用同时拥有两端，并已有单调调度器和监控接收器。将它们传给通道对，使本地 RPC 使用应用的计时与上报策略。'
      },
      example:
        "import { createPeerPair } from '@migaia/rpc-core/testing'\n\nconst pair = await createPeerPair({\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error),\n  a: { provide: {} },\n  b: { provide: { prices: () => fetchPrices() } }\n})",
      result: {
        en: 'Both peers use the selected scheduler and route background failures to monitoring.',
        zh: '两端共用所选调度器，并把后台失败交给监控。'
      },
      covers: ['scheduler', 'report']
    }
  ],
  connect: [
    {
      title: {
        en: 'Wait for the user to choose a service instance',
        zh: '等待用户选择服务实例'
      },
      problem: {
        en: 'An administration screen must show discovered instances before sending work. Use manual discovery so the application controls discovery and receiver selection instead of resolving a receiver automatically during send.',
        zh: '管理界面需要先展示发现的实例，再发送任务。选择手动发现，让应用决定发现与选择时机，而非在发送时自动解析接收端。'
      },
      example:
        "import { connect } from '@migaia/rpc-core'\n\nconst discovery = connect({\n  transport: serviceTransport,\n  discoveryMode: 'manual'\n})",
      result: {
        en: 'The administration screen can use the endpoint’s manual discovery controls before sending.',
        zh: '管理界面可以先使用端点的手动发现接口，再发送任务。'
      },
      covers: ['transport', 'discoveryMode']
    },
    {
      title: {
        en: 'Distinguish application instances on one carrier',
        zh: '在同一载体上区分应用实例'
      },
      problem: {
        en: 'A dedicated carrier needs an application instance identity in addition to its carrier checks. Add the application’s identifier verifier and generate a unique instance suffix; the verifier remains responsible for admission.',
        zh: '专用载体除了自身检查，还需要区分应用实例。提供应用校验器并生成唯一实例后缀；是否准入仍由该校验器负责。'
      },
      example:
        "import { connect } from '@migaia/rpc-core'\n\nconst identifiedConnection = connect({\n  transport: serviceTransport,\n  useBaseIdVerifyOnly: true,\n  uniqueTargetId: () => crypto.randomUUID(),\n  identifier: (context) => verifyApplicationInstance(context)\n})",
      result: {
        en: 'The connection uses the application’s instance identity and explicit admission decision.',
        zh: '连接使用应用实例身份，并由明确的应用准入决定控制。'
      },
      covers: ['useBaseIdVerifyOnly', 'uniqueTargetId', 'identifier']
    }
  ],
  authentication: [
    {
      title: {
        en: 'Verify signed checkout messages',
        zh: '验证结算消息签名'
      },
      problem: {
        en: 'Checkout messages need integrity protection. Supply the application’s signing and verification functions on both ends. They must encode and recover the complete value supplied by Core; encodedType describes the protected representation.',
        zh: '结算消息需要完整性保护。在两端配置应用的签名与验证函数；它们必须编码并恢复 Core 交给它们的完整值，encodedType 声明保护后的表示形式。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst signedMessages = authentication({\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n})",
      result: {
        en: 'Both endpoints authenticate signed messages before business handlers receive them.',
        zh: '两端会先验证消息签名，再将消息交给业务处理函数。'
      },
      covers: ['sign', 'verify', 'encodedType']
    },
    {
      title: {
        en: 'Protect private order contents',
        zh: '保护订单的私密内容'
      },
      problem: {
        en: 'Order payloads also contain private details. Add the application’s encryption pair to the same signed pipeline: outbound values are encrypted then signed, and inbound values are verified then decrypted.',
        zh: '订单载荷还包含私密信息。给同一签名管线加上应用的加解密函数；出站先加密再签名，入站先验证再解密。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst privateOrders = authentication({\n  encrypt: (value) => encryptOrderMessage(value),\n  decrypt: (value) => decryptOrderMessage(value),\n  sign: (value) => signOrderMessage(value),\n  verify: (value) => verifyOrderMessage(value),\n  encodedType: 'string'\n})",
      result: {
        en: 'Order values cross the carrier in the application’s protected representation.',
        zh: '订单值以应用约定的受保护表示经过载体。'
      },
      covers: ['encrypt', 'decrypt']
    }
  ],
  createMemoryTransportPair: [
    {
      title: {
        en: 'Schedule local notifications with the application',
        zh: '用应用调度器发送本地通知'
      },
      problem: {
        en: 'An editor routes local document notifications through the same scheduler as its other deferred work. Supply that scheduler when creating the memory pair and let the document owner close it.',
        zh: '编辑器希望本地文档通知与其他延迟任务共用调度器。创建内存通道对时传入应用调度器，再由文档所有者负责关闭。'
      },
      example:
        "import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [sender, receiver] = createMemoryTransportPair({\n  scheduler: applicationScheduler\n})\nconst stop = receiver.subscribe(({ data }) => applyDocumentChange(data))\nsender.send({ documentId: 'draft-1', state: 'saved' })\nonDocumentClosed(() => {\n  stop()\n  sender.close()\n})",
      result: {
        en: 'Document changes arrive through the selected scheduler; closing the document releases the pair.',
        zh: '文档变更由所选调度器交付；关闭文档时释放通道对。'
      },
      covers: ['scheduler']
    },
    {
      title: {
        en: 'Retire pending local notifications on close',
        zh: '关闭时结束待交付的本地通知'
      },
      problem: {
        en: 'A preview can close before its queued update arrives. Close its memory pair as part of preview cleanup so the abandoned preview does not receive later queued updates.',
        zh: '预览可能在排队更新交付前关闭。清理预览时关闭内存通道对，已退出的预览便不会再收到这些待交付更新。'
      },
      example:
        "import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [sender, receiver] = createMemoryTransportPair({\n  scheduler: applicationScheduler\n})\nreceiver.subscribe(({ data }) => renderPreview(data))\nsender.send(latestDocument)\nonPreviewClosed(() => sender.close())",
      result: {
        en: 'Closing the pair removes subscriptions and drops messages that have not been delivered.',
        zh: '关闭通道对会移除订阅，并丢弃尚未交付的消息。'
      },
      covers: ['scheduler']
    }
  ],
  createBrowserMessagePortTransport: [
    {
      title: {
        en: 'Close a port with its RPC wrapper',
        zh: '随 RPC 包装器关闭端口'
      },
      problem: {
        en: 'A pane creates a MessageChannel solely for this RPC connection. Transfer closure responsibility to the wrapper so its cleanup also closes the original port.',
        zh: '面板专门为此 RPC 连接创建 MessageChannel。把关闭责任交给包装器，清理时即可一并关闭原端口。'
      },
      example:
        "import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'\n\nconst transport = createBrowserMessagePortTransport(port, { ownership: 'owned' })\nonViewClosed(() => transport.close?.())",
      result: {
        en: 'Closing the transport also closes the port it owns.',
        zh: '关闭传输对象时也会关闭它拥有的端口。'
      },
      covers: ['ownership']
    },
    {
      title: {
        en: 'Keep a shared port under its creator',
        zh: '由创建者管理共享端口'
      },
      problem: {
        en: 'A shell owns a port longer than one RPC view. Borrow the port so disposing this view’s transport does not close the shell’s resource.',
        zh: '外壳持有端口的时间长于单个 RPC 视图。借用端口，使视图释放传输对象时不会关闭外壳的资源。'
      },
      example:
        "import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'\n\nconst transport = createBrowserMessagePortTransport(port, { ownership: 'borrowed' })\nonViewClosed(() => transport.close?.())",
      result: {
        en: 'The shell keeps control of the original port’s final close.',
        zh: '原端口的最终关闭仍由外壳控制。'
      },
      covers: ['ownership']
    }
  ],
  createWebWorkerTransport: [
    {
      title: {
        en: 'Identify a dedicated worker connection',
        zh: '标记专用 Worker 连接'
      },
      problem: {
        en: 'A page already has a worker and knows its remote identity. Attach the application’s peer and origin metadata to the transport so inbound diagnostics retain that carrier context.',
        zh: '页面已持有 Worker，并知道远端身份。为传输对象设置应用的对端和来源元数据，让入站诊断保留这份载体上下文。'
      },
      example:
        "import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'\n\nconst transport = createWebWorkerTransport(worker, {\n  peerId: 'price-worker-1',\n  origin: location.origin\n})",
      result: {
        en: 'The worker transport exposes the supplied peer and origin metadata.',
        zh: 'Worker 传输对象会提供所设对端与来源元数据。'
      },
      covers: ['peerId', 'origin']
    },
    {
      title: {
        en: 'Agree on stream support before calling',
        zh: '调用前约定流支持'
      },
      problem: {
        en: 'A dedicated worker link uses a static capability agreement. Supply only the capabilities agreed by both ends; advertising a stream mode on one side alone cannot add support to the other.',
        zh: '专用 Worker 链路采用静态能力约定。只声明双方已经约定的能力；单方面声明流模式无法为另一端增加支持。'
      },
      example:
        "import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'\n\nconst transport = createWebWorkerTransport(worker, {\n  capabilities: agreedCapabilities\n})",
      result: {
        en: 'The transport presents the capability list selected by the application’s agreement.',
        zh: '传输对象使用应用约定的能力列表。'
      },
      covers: ['capabilities']
    }
  ],
  createIpcSendQueueFeature: [
    {
      title: {
        en: 'Keep a busy import from filling the send queue',
        zh: '避免繁忙导入占满发送队列'
      },
      problem: {
        en: 'An import produces data faster than the carrier drains it. Bound pending data separately from control messages so data load has an explicit queue budget.',
        zh: '导入产生数据的速度超过载体排空速度。分别限制待发数据和控制消息，为数据负载设置明确队列预算。'
      },
      example:
        "import { createIpcSendQueueFeature } from '@migaia/rpc-core/plugins/send-queue'\n\nconst sendQueue = createIpcSendQueueFeature({\n  connectionId: 'checkout-pricing',\n  maxPendingData: 64,\n  maxPendingControl: 16\n})",
      result: {
        en: 'The connection has separate bounded queues for data and control traffic.',
        zh: '连接的数据与控制流量各有有界队列。'
      },
      covers: ['connectionId', 'maxPendingData', 'maxPendingControl']
    },
    {
      title: {
        en: 'Associate queue activity with one session',
        zh: '把队列活动归到对应会话'
      },
      problem: {
        en: 'A desktop process serves several sessions. Give the queue the connection and session identifiers used by application diagnostics so operators can locate a busy link.',
        zh: '桌面进程同时服务多个会话。为队列设置应用诊断使用的连接和会话标识，便于定位繁忙链路。'
      },
      example:
        "import { createIpcSendQueueFeature } from '@migaia/rpc-core/plugins/send-queue'\n\nconst sendQueue = createIpcSendQueueFeature({\n  connectionId: 'editor-worker',\n  sessionId: currentSessionId\n})",
      result: {
        en: 'Queue diagnostics can be associated with the selected connection and session.',
        zh: '队列诊断可归到所选连接和会话。'
      },
      covers: ['connectionId', 'sessionId']
    }
  ],
  createIpcLogFeature: [
    {
      title: {
        en: 'Report connection diagnostics to monitoring',
        zh: '上报连接诊断'
      },
      problem: {
        en: 'A desktop link needs diagnostics in the application monitor. Pass its existing gate and report callback to the log feature, rather than adding log calls to each RPC method.',
        zh: '桌面链路需要向应用监控发送诊断。把已有 gate 和上报回调交给日志功能，避免逐个 RPC 方法添加日志。'
      },
      example:
        "import { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\n\nconst logging = createIpcLogFeature({\n  gate: connectionGate,\n  report: (event) => recordConnectionEvent(event),\n  onReportError: (error, event) => reportLoggingFailure(error, event)\n})",
      result: {
        en: 'The application monitor receives diagnostics from the selected gate.',
        zh: '应用监控收到所选 gate 的诊断。'
      },
      covers: ['gate', 'report', 'onReportError']
    },
    {
      title: {
        en: 'Report failure of the diagnostic sink',
        zh: '报告诊断接收器自身的故障'
      },
      problem: {
        en: 'The primary diagnostic sink can fail. Use a separate callback for sink errors so an unavailable logging service does not silently hide its own failure.',
        zh: '主要诊断接收器也可能失败。用独立回调处理接收器错误，避免日志服务不可用时连自身故障都被隐藏。'
      },
      example:
        "import { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\n\nconst logging = createIpcLogFeature({\n  gate: connectionGate,\n  report: (event) => recordConnectionEvent(event),\n  onReportError: (error, event) => reportLoggingFailure(error, event)\n})",
      result: {
        en: 'The fallback monitor receives sink failures with the associated diagnostic event.',
        zh: '备用监控收到接收器故障及对应诊断事件。'
      },
      covers: ['onReportError']
    }
  ],
  defineMessageAdapter: [
    {
      title: {
        en: 'Use an existing native message port',
        zh: '使用已有原生消息端口'
      },
      problem: {
        en: 'An application already owns a MessagePort. The adapter’s open callback returns that original port; Core owns negotiation and request handling instead of requiring another messaging implementation.',
        zh: '应用已经拥有 MessagePort。适配器的 open 回调返回原端口；协商和请求处理交给 Core，不再另写一套消息实现。'
      },
      example:
        "import { defineMessageAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst peer = await adapter.peer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  connect: catalogPort\n})\ntry {\n  renderPrices(await peer.request('prices'))\n} finally {\n  await peer.close()\n}",
      result: {
        en: 'The checkout calls the remote pricing provider through its original native port.',
        zh: '结算页通过原生端口调用远端价格处理函数。'
      },
      covers: ['open']
    },
    {
      title: {
        en: 'Launch a worker with its actual exit handle',
        zh: '启动 Worker 并保留真实退出句柄'
      },
      problem: {
        en: 'A platform adapter also owns worker startup. Supply launchWorker, which returns the native port, the real exit Promise and termination operation; openExistingWorkerPort handles already-running workers.',
        zh: '平台适配器还负责启动 Worker。launchWorker 返回原生端口、真实退出 Promise 和终止操作；openExistingWorkerPort 处理已经运行的 Worker。'
      },
      example:
        "import { defineMessageAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineMessageAdapter<URL>({\n  open: (url) => openExistingWorkerPort(url),\n  launch: (url) => launchWorker(url)\n})\nconst peer = await adapter.peer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  spawn: new URL('./price-worker.js', import.meta.url)\n})",
      result: {
        en: 'The adapter can stop the worker it launched and observe its actual exit.',
        zh: '适配器能停止自己启动的 Worker，并观察其真实退出。'
      },
      covers: ['launch']
    }
  ],
  defineByteAdapter: [
    {
      title: {
        en: 'Open an application-owned ordered byte stream',
        zh: '打开应用持有的有序字节流'
      },
      problem: {
        en: 'A platform already supplies ordered byte I/O with write, onData, onClose and close. Keep those carrier operations in openByteConnection and let Core provide negotiation and framing. Application diagnostics and presentation describe this carrier.',
        zh: '平台已有带 write、onData、onClose 和 close 的有序字节读写。把载体操作留在 openByteConnection，协商和分帧交给 Core；应用诊断与展示配置描述这类载体。'
      },
      example:
        "import { defineByteAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineByteAdapter<URL>({\n  open: (address) => openByteConnection(address),\n  diagnostics: connectionDiagnostics,\n  presentation: {\n    platform: 'Process',\n    expectedStringText: 'Price connection expects text frames'\n  }\n})\nconst peer = await adapter.peer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  connect: priceServiceAddress,\n  peerId: 'pricing-1'\n})",
      result: {
        en: 'The pricing connection uses Core’s byte handshake and framing over the platform’s I/O.',
        zh: '价格连接在平台字节读写上使用 Core 的字节握手与分帧。'
      },
      covers: [
        'open',
        'diagnostics',
        'presentation',
        'presentation.platform',
        'presentation.expectedStringText'
      ]
    },
    {
      title: {
        en: 'Separate accepted connections from outgoing dials',
        zh: '区分接入连接与主动拨号'
      },
      problem: {
        en: 'A byte adapter handles accepted server connections as well as outgoing clients. Supply the corresponding application open operations so each mode acquires the right native I/O.',
        zh: '字节适配器既处理服务端接入，也处理客户端主动连接。分别提供应用的打开操作，让两种模式取得正确的原生读写对象。'
      },
      example:
        "import { defineByteAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineByteAdapter<URL>({\n  open: (address) => openByteConnection(address),\n  listen: (address) => acceptByteConnection(address),\n  dial: (address) => dialByteConnection(address),\n  diagnostics: connectionDiagnostics\n})",
      result: {
        en: 'Listening and dialing reuse the same Core protocol while retaining platform-specific acquisition.',
        zh: '监听与拨号复用同一 Core 协议，同时保留平台各自的资源取得方式。'
      },
      covers: ['listen', 'dial']
    }
  ],
  createRuntimePeer: [
    {
      title: {
        en: 'Connect checkout to a negotiated pricing channel',
        zh: '将结算页接到已协商的价格通道'
      },
      problem: {
        en: 'The platform adapter’s openPricingChannel returns a real negotiated channel for checkout. Use connect for an existing service and a local timeout for a responsive checkout; send background failures to monitoring.',
        zh: '平台适配器的 openPricingChannel 为结算页返回真实协商通道。用 connect 连接已有服务，并设置本地期限以保持结算响应；后台失败交给监控。'
      },
      example:
        "import { createRuntimePeer } from '@migaia/rpc-core/remote'\n\nconst prices = await createRuntimePeer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  connect: (context) => openPricingChannel(context),\n  defaultTimeoutMs: 2000,\n  report: (error) => reportToMonitoring(error)\n})\ntry {\n  renderPrices(await prices.request('prices'))\n} finally {\n  await prices.close()\n}",
      result: {
        en: 'Checkout receives prices through the adapter’s channel and reports background failures centrally.',
        zh: '结算页通过适配器通道取得价格，并集中上报后台失败。'
      },
      covers: ['self', 'connect', 'defaultTimeoutMs', 'report']
    },
    {
      title: {
        en: 'Serve prices with bounded provider work',
        zh: '限制价格处理任务的并发'
      },
      problem: {
        en: 'A pricing worker accepts an incoming channel and runs expensive lookups. Register the declared price methods before serving, and cap concurrent work so a caller cannot fill the worker with lookups.',
        zh: '价格 Worker 接受入站通道，并执行昂贵查询。服务开始前登记声明的价格方法，再限制并发，避免单个调用者用查询占满 Worker。'
      },
      example:
        "import { createRuntimePeer } from '@migaia/rpc-core/remote'\n\nconst provider = await createRuntimePeer({\n  self: { name: 'pricing', instanceId: 'pricing-1' },\n  listen: (context) => acceptPricingChannel(context),\n  provide: { pricing: { api: { prices: () => fetchPrices() } } },\n  contract: pricingContract,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})",
      result: {
        en: 'The provider exposes its declared price method with global and per-peer concurrency budgets.',
        zh: '提供方公开声明的价格方法，并应用全局与每个对端的并发预算。'
      },
      covers: ['provide', 'listen', 'contract', 'providerLimits']
    },
    {
      title: {
        en: 'Trace one pricing connection',
        zh: '追踪一条价格连接'
      },
      problem: {
        en: 'Operations need to inspect one troublesome connection without adding logging to business handlers. Attach a probe that snapshots events before forwarding them to the application collector.',
        zh: '排查时需要检查某条异常连接，却不想改业务处理函数。附加 probe，在交给应用接收器前将事件快照化。'
      },
      example:
        "import { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nimport { createRuntimePeer } from '@migaia/rpc-core/remote'\n\nconst probe = defineProbe({\n  stages: ['message'],\n  emit: (event) => recordRpcTrace(snapshotProbeEvent(event))\n})\nconst prices = await createRuntimePeer({ ...pricingPeerOptions, probe })",
      result: {
        en: 'The collector receives stable message trace snapshots for this peer.',
        zh: '接收器取得该对端的稳定消息追踪快照。'
      },
      covers: ['probe']
    }
  ],
  createStreamFeature: [
    {
      title: {
        en: 'Advertise the channel’s stream agreement',
        zh: '声明通道约定的流能力'
      },
      problem: {
        en: 'An export link has already agreed its stream limits. Install that exact capability so streaming uses the carrier’s supported modes and limits.',
        zh: '导出链路已约定流限制。安装该能力，让流操作使用载体支持的模式与限制。'
      },
      example:
        "import { createStreamFeature } from '@migaia/rpc-core/stream'\n\nconst streams = createStreamFeature(outbound, provider, { capability: agreedStreamCapability })",
      result: {
        en: 'The stream feature follows the capability supplied by the real channel agreement.',
        zh: '流功能遵守真实通道约定提供的能力。'
      },
      covers: ['capability']
    },
    {
      title: {
        en: 'Keep a scalar-only link scalar',
        zh: '保持标量链路的能力边界'
      },
      problem: {
        en: 'A legacy price service supports only scalar replies. Do not invent stream support in the wrapper; pass its unavailable capability so unsupported stream calls are refused.',
        zh: '旧价格服务只支持标量答复。包装层不应虚构流支持；传入不可用能力，让不受支持的流调用被拒绝。'
      },
      example:
        "import { createStreamFeature } from '@migaia/rpc-core/stream'\n\nconst streams = createStreamFeature(outbound, provider, {\n  capability: { supports: () => false }\n})",
      result: {
        en: 'Unsupported stream work is refused instead of being sent through a scalar-only carrier.',
        zh: '不受支持的流任务会被拒绝，而非发往只支持标量的载体。'
      },
      covers: ['capability']
    }
  ],
  createRemoteHost: [
    {
      title: {
        en: 'Use a catalogued remote pricing plugin',
        zh: '使用目录中的远端价格插件'
      },
      problem: {
        en: 'An administration process already owns a supervised pricing binding and its catalog. Create the remote host from those resources; readiness must complete before installing and calling a declared plugin.',
        zh: '管理进程已持有受监督的价格绑定及其目录。用这些资源创建远端宿主，等待就绪后再安装并调用目录声明的插件。'
      },
      example:
        "import { createRemoteHost } from '@migaia/rpc-core/remote'\n\nconst remote = createRemoteHost({\n  catalog: pricingCatalog,\n  binding: pricingBinding,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal),\n  report: (error) => reportToMonitoring(error)\n})\ntry {\n  await remote.ready()\n  const pricing = await remote.use('pricing')\n  renderPrices(await pricing.api!.prices!([]))\n} finally {\n  await remote.release()\n}",
      result: {
        en: 'The declared pricing feature becomes callable while the binding retains its resource lifecycle.',
        zh: '声明的价格功能可被调用，资源生命周期仍由绑定管理。'
      },
      covers: ['catalog', 'binding', 'endpointFactory', 'report']
    },
    {
      title: {
        en: 'Authorize pricing calls before dispatch',
        zh: '派发价格调用前检查权限'
      },
      problem: {
        en: 'An administration session must authorize each remote method before it leaves the process. Use callGuard for that decision, generate a fresh logical operation key, and cap each call’s waiting budget.',
        zh: '管理会话需要在远端方法离开进程前检查权限。用 callGuard 决定是否放行，为逻辑操作生成新键，并限制每次调用的等待预算。'
      },
      example:
        "import { createRemoteHost } from '@migaia/rpc-core/remote'\n\nconst remote = createRemoteHost({\n  ...pricingHostOptions,\n  keyFactory: () => crypto.randomUUID(),\n  callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: (call) => authorizePricingCall(call) },\n  retryPort: pricingRetryPolicy\n})",
      result: {
        en: 'Denied calls stop before dispatch; admitted calls use the selected key and deadline policies.',
        zh: '拒绝的调用在派发前停止；获准调用使用所选逻辑键与期限策略。'
      },
      covers: ['keyFactory', 'callDeadlineCapMs', 'callGuard', 'retryPort']
    }
  ],
  createRemotePlugin: [
    {
      title: {
        en: 'Install the remote pricing feature in a local host',
        zh: '在本地宿主安装远端价格功能'
      },
      problem: {
        en: 'A local plugin host needs the declared API of an existing remote pricing service. Supply the local plugin facade, the remote contract and the supervised binding so the installed plugin keeps those owners.',
        zh: '本地插件宿主需要使用已有远端价格服务的声明接口。传入本地插件接口、远端契约和受监督绑定，使安装后的插件继续使用这些所有者。'
      },
      example:
        "import { createRemotePlugin } from '@migaia/rpc-core/remote'\n\nconst pricing = createRemotePlugin({\n  name: 'pricing',\n  contract: pricingContract,\n  host: applicationHost.plugin,\n  binding: pricingBinding,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal),\n  report: (error) => reportToMonitoring(error)\n})\nawait applicationHost.use(pricing)",
      result: {
        en: 'The local host installs a proxy whose feature calls go to the declared remote service.',
        zh: '本地宿主安装代理，功能调用会送到声明的远端服务。'
      },
      covers: ['name', 'contract', 'host', 'binding', 'endpointFactory', 'report']
    },
    {
      title: {
        en: 'Apply the checkout’s remote call policy',
        zh: '应用结算页的远端调用策略'
      },
      problem: {
        en: 'Checkout must authorize remote pricing calls and report background failures through its monitor. Add that policy while keeping the plugin’s existing contract and binding.',
        zh: '结算页需要校验远端价格调用的权限，并将后台失败交给自己的监控。在保留插件已有契约与绑定的同时增加这些策略。'
      },
      example:
        "import { createRemotePlugin } from '@migaia/rpc-core/remote'\n\nconst pricing = createRemotePlugin({\n  ...pricingPluginOptions,\n  report: (error) => reportToMonitoring(error),\n  keyFactory: () => crypto.randomUUID(),\n  retryPort: pricingRetryPolicy,\n  callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: (call) => authorizePricingCall(call) }\n})",
      result: {
        en: 'The proxy uses checkout’s admission, waiting, key and reporting policies for remote calls.',
        zh: '代理为远端调用使用结算页的准入、等待、逻辑键和上报策略。'
      },
      covers: ['report', 'keyFactory', 'retryPort', 'callDeadlineCapMs', 'callGuard']
    }
  ],
  createRemoteRetryPort: [
    {
      title: {
        en: 'Reuse runtime events for retry decisions',
        zh: '用已有运行时事件决定重试'
      },
      problem: {
        en: 'A remote call policy must follow the same generation changes as its peer. Build the retry port from that peer’s events and scheduler instead of creating a second lifecycle tracker.',
        zh: '远端调用策略需要跟随对端原有的代次变化。用该对端的事件与调度器创建重试端口，避免另建一套生命周期追踪。'
      },
      example:
        "import { createRemoteRetryPort } from '@migaia/rpc-core/remote'\n\nconst retry = createRemoteRetryPort({\n  events: pricingEvents,\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error)\n})",
      result: {
        en: 'Retry decisions follow the selected runtime’s existing generation events and clock.',
        zh: '重试决定跟随所选运行时已有的代次事件与时钟。'
      },
      covers: ['events', 'scheduler', 'report']
    },
    {
      title: {
        en: 'Keep retry cleanup failures observable',
        zh: '保留重试清理故障'
      },
      problem: {
        en: 'Secondary cleanup failures during retry should reach monitoring without obscuring the call’s primary result. Supply the retry owner’s diagnostic callback.',
        zh: '重试过程中的次要清理故障应进入监控，同时不能掩盖调用的主要结果。提供重试所有者的诊断回调。'
      },
      example:
        "import { createRemoteRetryPort } from '@migaia/rpc-core/remote'\n\nconst retry = createRemoteRetryPort({\n  events: pricingEvents,\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error)\n})",
      result: {
        en: 'Monitoring receives retry-side failures through the application’s reporting channel.',
        zh: '监控通过应用上报通道收到重试侧故障。'
      },
      covers: ['report']
    }
  ],
  serveRemoteHost: [
    {
      title: {
        en: 'Expose only the approved plugin catalog',
        zh: '只公开获准的插件目录'
      },
      problem: {
        en: 'A service process must expose a local host without allowing arbitrary plugin names. Serve its explicit pricing catalog and resolve names only from the application’s approved definitions.',
        zh: '服务进程需要公开本地宿主，同时不允许任意插件名称。服务只使用明确的价格目录，并仅从应用批准的定义中解析名称。'
      },
      example:
        "import { serveRemoteHost } from '@migaia/rpc-core/remote'\n\nconst service = await serveRemoteHost({\n  host: pricingHost,\n  catalog: pricingCatalog,\n  resolvePlugin: (name) => resolveApprovedPlugin(name),\n  endpoint: { endpoint: pricingEndpoint },\n  report: (error) => reportToMonitoring(error)\n})\nonServiceClosed(() => service.close())",
      result: {
        en: 'Remote host operations can address only the declared catalog through this endpoint.',
        zh: '远端宿主操作只能通过该端点访问声明的目录。'
      },
      covers: ['host', 'catalog', 'resolvePlugin', 'endpoint', 'report']
    },
    {
      title: {
        en: 'Report failures beside the serving owner',
        zh: '由服务所有者上报故障'
      },
      problem: {
        en: 'Background serving failures need the same monitoring context as the local pricing host. Pass its reporter when exposing the host.',
        zh: '后台服务故障需要与本地价格宿主共用监控上下文。公开宿主时传入其上报函数。'
      },
      example:
        "import { serveRemoteHost } from '@migaia/rpc-core/remote'\n\nconst service = await serveRemoteHost({\n  ...pricingServiceOptions,\n  report: (error) => reportToMonitoring(error)\n})",
      result: {
        en: 'Background serving failures reach the local service monitor.',
        zh: '后台服务故障进入本地服务监控。'
      },
      covers: ['report']
    }
  ],
  serveRemotePlugin: [
    {
      title: {
        en: 'Serve an already-installed pricing plugin',
        zh: '公开已安装的价格插件'
      },
      problem: {
        en: 'The local host already adopted its pricing plugin. Serve the matching contract on a dedicated endpoint so callers can use its declared methods without exposing host mutation controls.',
        zh: '本地宿主已采用价格插件。在专用端点服务匹配的契约，让调用者使用声明的方法，而无需公开宿主变更控制。'
      },
      example:
        "import { serveRemotePlugin } from '@migaia/rpc-core/remote'\n\nconst service = await serveRemotePlugin({\n  host: pricingHost,\n  contract: pricingContract,\n  endpoint: { endpoint: pricingEndpoint },\n  report: (error) => reportToMonitoring(error)\n})\nonServiceClosed(() => service.close())",
      result: {
        en: 'Callers can invoke the adopted plugin’s declared methods through its dedicated endpoint.',
        zh: '调用者可通过专用端点调用已采用插件声明的方法。'
      },
      covers: ['host', 'contract', 'endpoint', 'report']
    },
    {
      title: {
        en: 'Attach local caller context to pricing calls',
        zh: '给价格调用附加本地调用方上下文'
      },
      problem: {
        en: 'A pricing feature needs the admitted sender identity for local auditing. Derive invocationContext from the serving RPC context; this value stays local instead of being added to serialized business arguments.',
        zh: '价格功能需要使用已准入发送方身份进行本地审计。从服务端 RPC 上下文生成 invocationContext；该值留在本地，不会加入序列化业务参数。'
      },
      example:
        "import { serveRemotePlugin } from '@migaia/rpc-core/remote'\n\nconst service = await serveRemotePlugin({\n  ...pricingServiceOptions,\n  invocationContext: (context) => ({ sender: context.senderId })\n})",
      result: {
        en: 'The local feature receives caller context while its wire arguments keep the declared shape.',
        zh: '本地功能取得调用方上下文，线上参数仍保持声明的形状。'
      },
      covers: ['invocationContext']
    }
  ],
  createManagedRuntimePeer: [
    {
      title: {
        en: 'Keep pricing calls on the supervised generation',
        zh: '让价格调用跟随受监督代次'
      },
      problem: {
        en: 'The application already owns pricingBinding, whose supervisor launches the service and whose openChannel returns its real channel. The managed peer follows that binding across generations; it does not use direct spawn, connect or listen callbacks to acquire a channel. Checkout limits price requests to two seconds so it can show a retry action if the service does not answer.',
        zh: '应用已持有 pricingBinding：其中的监督器启动服务，openChannel 返回真实通道。托管对端通过该绑定跟随代次变化，不使用直接 spawn、connect 或 listen 回调取得通道。结算页将价格请求限制在两秒内，服务未答复时即可提示重试。'
      },
      example:
        "import { createManagedRuntimePeer } from '@migaia/rpc-core/remote'\n\nconst prices = await createManagedRuntimePeer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  defaultTimeoutMs: 2000,\n  callDeadlineCapMs: 2000,\n  report: (error) => reportToMonitoring(error)\n}, pricingBinding)\ntry {\n  renderPrices(await prices.request('prices'))\n} finally {\n  await prices.close()\n}",
      result: {
        en: 'Checkout calls the current ready pricing generation and releases its managed resources on close.',
        zh: '结算页调用当前已就绪的价格服务代次，并在关闭时释放托管资源。'
      },
      covers: ['self', 'defaultTimeoutMs', 'callDeadlineCapMs', 'report']
    },
    {
      title: {
        en: 'Offer a small local callback API',
        zh: '提供小范围本地回调接口'
      },
      problem: {
        en: 'A supervised pricing service needs to call back into checkout for its current currency. Declare that callback contract and bound local provider work without changing how the binding acquires the remote channel.',
        zh: '受监督的价格服务需要回调结算页读取当前币种。声明这项回调契约并限制本地处理任务，不改变绑定取得远端通道的方式。'
      },
      example:
        "import { createManagedRuntimePeer } from '@migaia/rpc-core/remote'\n\nconst prices = await createManagedRuntimePeer({\n  ...checkoutPeerOptions,\n  provide: { checkout: { api: { currency: () => selectedCurrency() } } },\n  contract: checkoutContract,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, pricingBinding)",
      result: {
        en: 'The remote service can call the declared currency callback within its concurrency limits.',
        zh: '远端服务可以在并发限制内调用已声明的币种回调。'
      },
      covers: ['provide', 'contract', 'providerLimits']
    }
  ],
  createCoroutinePlugin: [
    {
      title: {
        en: 'Run pricing work within the parent host',
        zh: '在父宿主内运行价格协作任务'
      },
      problem: {
        en: 'A plugin host needs a cooperatively cancellable pricing task. runPricingTask receives the task’s connect input and signal, serves prices in a child host, and disposes that host when cancelled. The explicit remote type makes the outlet request checked by TypeScript. The five-second startup budget bounds waiting for the child service to become ready.',
        zh: '插件宿主需要可协作取消的价格任务。runPricingTask 接收任务的 connect 输入与 signal，在子宿主提供价格服务，并在取消时释放子宿主。显式远端类型让 TypeScript 检查出口请求；五秒启动预算限制等待子服务就绪的时间。'
      },
      example:
        "import { defineHost } from '@migaia/plugin-host'\nimport { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\ntype IPricing = { prices(): number[] }\nconst pricing = createCoroutinePlugin<IPricing>({\n  name: 'pricing',\n  task: ({ connect, signal, heartbeat }) => runPricingTask({ connect, signal, heartbeat }),\n  supervisor: { startupTimeoutMs: 5000 }\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof pricing]>(hostConfiguration)\ntry {\n  await host.use(pricing)\n  renderPrices(await host.coroutine!.request('pricing', 'prices'))\n} finally {\n  await host.dispose()\n}",
      result: {
        en: 'The host exposes a typed pricing outlet and owns cancellation and cleanup of the task.',
        zh: '宿主提供带类型的价格出口，并拥有该任务的取消与清理责任。'
      },
      covers: ['name', 'task', 'supervisor']
    },
    {
      title: {
        en: 'Let a child task serve its parent connection',
        zh: '让子任务服务父连接'
      },
      problem: {
        en: 'Inside runPricingTask, the task-provided connect input is the child’s connection to its parent. Install a coroutine plugin with that input and the pricing handler; the surrounding child host owns its disposal.',
        zh: '在 runPricingTask 内，任务提供的 connect 输入就是子任务连接父宿主的通道来源。用它和价格处理函数安装协程插件，再由外层子宿主负责释放。'
      },
      example:
        "import { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst parent = createCoroutinePlugin({\n  name: 'parent',\n  self: { name: 'pricing-child', instanceId: childInstanceId },\n  connect: context.connect,\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  defaultTimeoutMs: 2000\n})\nawait childHost.use(parent)",
      result: {
        en: 'The child serves prices over the real parent connection with bounded provider work.',
        zh: '子任务通过真实父连接提供价格服务，并限制处理任务并发。'
      },
      covers: ['self', 'connect', 'provide', 'providerLimits', 'defaultTimeoutMs']
    },
    {
      title: {
        en: 'Expose an approved child-host catalog',
        zh: '公开获准的子宿主目录'
      },
      problem: {
        en: 'An administration parent needs host controls for a known child catalog. Expose host controls explicitly, bind them to the actual child host and resolve only approved catalog definitions.',
        zh: '管理父任务需要控制已知目录中的子宿主功能。显式公开 host 控制，绑定真实子宿主，并只解析获准的目录定义。'
      },
      example:
        "import { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst parent = createCoroutinePlugin({\n  name: 'parent',\n  connect: context.connect,\n  expose: ['host'],\n  host: childHost,\n  catalog: pricingCatalog,\n  resolvePlugin: (name) => resolveApprovedPlugin(name)\n})",
      result: {
        en: 'The parent can use declared child-host controls without opening arbitrary plugin resolution.',
        zh: '父任务可使用声明的子宿主控制，同时不会开放任意插件解析。'
      },
      covers: ['expose', 'host', 'catalog', 'resolvePlugin']
    }
  ],
  createRuntimePlugin: [
    {
      title: {
        en: 'Install a platform link in the host',
        zh: '在宿主安装平台链路'
      },
      problem: {
        en: 'A platform adapter needs its runtime outlet to share the host’s existing slot. Reuse the adapter’s integration and peer factory; they own platform acquisition, while name and self identify this link.',
        zh: '平台适配器需要让运行时出口复用宿主已有槽位。复用适配器的 integration 与 peer 工厂，由它们负责平台资源取得；name 与 self 标记当前链路。'
      },
      example:
        "import { createRuntimePlugin } from '@migaia/rpc-core/remote'\n\nconst pricing = createRuntimePlugin({\n  name: 'pricing-link',\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  connect: pricingSource,\n  report: (error) => reportToMonitoring(error)\n}, platformIntegration, createPlatformPeer)\nawait applicationHost.use(pricing)",
      result: {
        en: 'The host owns the installed platform outlet and releases the shared link with its lifecycle.',
        zh: '宿主拥有安装后的平台出口，并在自身生命周期结束时释放共享链路。'
      },
      covers: ['name', 'self', 'connect', 'report']
    },
    {
      title: {
        en: 'Serve the host’s approved catalog over the link',
        zh: '通过链路服务宿主的获准目录'
      },
      problem: {
        en: 'A platform link must allow remote administration of a specific local host. Expose host controls only with that host’s declared catalog and application resolver.',
        zh: '平台链路需要允许远端管理指定本地宿主。仅对该宿主声明的目录和应用解析器公开 host 控制。'
      },
      example:
        "import { createRuntimePlugin } from '@migaia/rpc-core/remote'\n\nconst administration = createRuntimePlugin({\n  ...platformLinkOptions,\n  expose: ['host'],\n  host: applicationHost,\n  catalog: pricingCatalog,\n  resolvePlugin: (name) => resolveApprovedPlugin(name)\n}, platformIntegration, createPlatformPeer)",
      result: {
        en: 'Remote administration is limited to the declared catalog of the selected local host.',
        zh: '远端管理范围限于所选本地宿主声明的目录。'
      },
      covers: ['expose', 'host', 'catalog', 'resolvePlugin']
    },
    {
      title: {
        en: 'Bound callbacks into the local host',
        zh: '限制对本地宿主的回调'
      },
      problem: {
        en: 'The platform peer also serves a small checkout callback API. Register its contract and limit concurrent provider work so remote lookups do not overwhelm the local host.',
        zh: '平台对端还需要提供小范围结算回调接口。登记其契约并限制处理任务并发，避免远端查询压满本地宿主。'
      },
      example:
        "import { createRuntimePlugin } from '@migaia/rpc-core/remote'\n\nconst pricing = createRuntimePlugin({\n  ...platformLinkOptions,\n  provide: { checkout: { api: { currency: () => selectedCurrency() } } },\n  contract: checkoutContract,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  defaultTimeoutMs: 2000\n}, platformIntegration, createPlatformPeer)",
      result: {
        en: 'The callback API keeps its declared shape and provider concurrency budget.',
        zh: '回调接口保持声明的形状，并使用设定的处理并发预算。'
      },
      covers: ['provide', 'contract', 'providerLimits', 'defaultTimeoutMs']
    }
  ]
}

/** Behaviour fields use focused examples rather than an unrelated full integration script. */
export const rpcCoreOptionFields: Readonly<
  Record<string, Readonly<Record<string, { whenToUse: IText; example: string }>>>
> = {
  createEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n})'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n})'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n})'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, codec: applicationCodec\n})'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n})'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n})'
    },
    provider: {
      whenToUse: {
        en: 'Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = await createEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n})'
    },
    providerLimits: {
      whenToUse: {
        en: 'Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = await createEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n})'
    },
    idempotency: {
      whenToUse: {
        en: 'Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = await createEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = await createEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\n\nconst checkout = await createEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = await createEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n})'
    }
  },
  createClientEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n})'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n})'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n})'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, codec: applicationCodec\n})'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n})'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n})'
    },
    provider: {
      whenToUse: {
        en: 'These shared factory options configure the serving side. A client-only endpoint does not serve providers; set them on createProviderEndpoint instead. Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '这些共享工厂选项配置服务端。仅客户端点不提供处理函数，应在 createProviderEndpoint 上设置。处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n})'
    },
    providerLimits: {
      whenToUse: {
        en: 'These shared factory options configure the serving side. A client-only endpoint does not serve providers; set them on createProviderEndpoint instead. Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '这些共享工厂选项配置服务端。仅客户端点不提供处理函数，应在 createProviderEndpoint 上设置。昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n})'
    },
    idempotency: {
      whenToUse: {
        en: 'These shared factory options configure the serving side. A client-only endpoint does not serve providers; set them on createProviderEndpoint instead. Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '这些共享工厂选项配置服务端。仅客户端点不提供处理函数，应在 createProviderEndpoint 上设置。重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'These shared factory options configure the serving side. A client-only endpoint does not serve providers; set them on createProviderEndpoint instead. Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '这些共享工厂选项配置服务端。仅客户端点不提供处理函数，应在 createProviderEndpoint 上设置。跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createClientEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = await createClientEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n})'
    }
  },
  createProviderEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n})'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n})'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n})'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, codec: applicationCodec\n})'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n})'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n})'
    },
    provider: {
      whenToUse: {
        en: 'Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n})'
    },
    providerLimits: {
      whenToUse: {
        en: 'Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n})'
    },
    idempotency: {
      whenToUse: {
        en: 'Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = await createProviderEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createProviderEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = await createProviderEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n})'
    }
  },
  createFullEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n})'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n})'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n})'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, codec: applicationCodec\n})'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n})'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n})'
    },
    provider: {
      whenToUse: {
        en: 'Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = await createFullEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n})'
    },
    providerLimits: {
      whenToUse: {
        en: 'Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = await createFullEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n})'
    },
    idempotency: {
      whenToUse: {
        en: 'Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = await createFullEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = await createFullEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createFullEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = await createFullEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n})'
    }
  },
  createFullOneWayEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n})'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n})'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n})'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, codec: applicationCodec\n})'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n})'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n})'
    },
    provider: {
      whenToUse: {
        en: 'Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = await createFullOneWayEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n})'
    },
    providerLimits: {
      whenToUse: {
        en: 'Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = await createFullOneWayEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n})'
    },
    idempotency: {
      whenToUse: {
        en: 'Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = await createFullOneWayEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = await createFullOneWayEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n})'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createFullOneWayEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n})\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = await createFullOneWayEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n})'
    }
  },
  createComposedEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n}, endpointFeatures)'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n}, endpointFeatures)'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n}, endpointFeatures)'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, codec: applicationCodec\n}, endpointFeatures)'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n}, endpointFeatures)'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n}, endpointFeatures)'
    },
    provider: {
      whenToUse: {
        en: 'Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = await createComposedEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n}, endpointFeatures)'
    },
    providerLimits: {
      whenToUse: {
        en: 'Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = await createComposedEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, endpointFeatures)'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n}, endpointFeatures)'
    },
    idempotency: {
      whenToUse: {
        en: 'Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = await createComposedEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n}, endpointFeatures)'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = await createComposedEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n}, endpointFeatures)'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { connect } from '@migaia/rpc-core'\n\nconst checkout = await createComposedEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n}, endpointFeatures)\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = await createComposedEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n}, endpointFeatures)'
    }
  },
  createRuntimeApiEndpoint: {
    scheduler: {
      whenToUse: {
        en: 'Pass the application’s monotonic scheduler when endpoint deadlines must share its clock. Omit it to use the host scheduler.',
        zh: '端点期限需要与应用共用单调时钟时传入应用调度器；省略时使用宿主调度器。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, scheduler: applicationScheduler\n}, catalogChannel)'
    },
    wallClock: {
      whenToUse: {
        en: 'Set a wall clock when wire timestamps and diagnostic timestamps must use the application clock. It does not control deadlines.',
        zh: '线上消息和诊断时间戳需要使用应用时钟时设置；它不控制期限。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, wallClock: { timestamp: () => Date.now() }\n}, catalogChannel)'
    },
    protocol: {
      whenToUse: {
        en: 'Use the protocol descriptor agreed by both ends. Omit it for Core’s default protocol.',
        zh: '使用双方约定的协议描述；省略时使用 Core 默认协议。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, protocol: rpcProtocol\n}, catalogChannel)'
    },
    codec: {
      whenToUse: {
        en: 'Use a codec whose output matches the framer input. Both ends must agree on the encoded representation.',
        zh: '编解码器的输出须匹配分帧器输入；双方必须约定同一编码表示。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, codec: applicationCodec\n}, catalogChannel)'
    },
    framer: {
      whenToUse: {
        en: 'Use the framer agreed by both ends; its output must match the transport’s accepted frame.',
        zh: '使用双方约定的分帧器，其输出须匹配传输对象接受的帧。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, framer: messageFramerV1\n}, catalogChannel)'
    },
    features: {
      whenToUse: {
        en: 'Install application features when endpoint-owned cleanup should release them. Omit this tuple when no extra feature is needed.',
        zh: '应用功能需要随端点清理时安装；无需额外功能时省略。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, features: [applicationFeature]\n}, catalogChannel)'
    },
    provider: {
      whenToUse: {
        en: 'Register startup handlers here when they must exist before ingress starts. Later registrations can use provide on a provider-capable endpoint.',
        zh: '处理函数必须在开始接收消息前就存在时，在此登记；支持提供方能力的端点也可稍后通过 provide 登记。'
      },
      example:
        'const server = createRuntimeApiEndpoint({\n  ...connectionOptions,\n  provider: { prices: async (context) => context.success(await fetchPrices()) }\n}, catalogChannel)'
    },
    providerLimits: {
      whenToUse: {
        en: 'Bound active provider work when expensive operations need backpressure. The defaults are 256 global and 64 per peer.',
        zh: '昂贵操作需要背压时限制正在运行的处理任务；默认全局 256 个，每个对端 64 个。'
      },
      example:
        'const server = createRuntimeApiEndpoint({\n  ...connectionOptions, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, catalogChannel)'
    },
    replay: {
      whenToUse: {
        en: 'Size retained outbound identifiers for the request rate and replay window. This ledger is separate from the keyed business-result store.',
        zh: '按请求速率与重放窗口设置出站标识保留量；它与按幂等键保存业务结果的存储不同。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions, replay: { maxEntries: 4096, ttlMs: 310000 }\n}, catalogChannel)'
    },
    idempotency: {
      whenToUse: {
        en: 'Provide an outcome store on the serving endpoint when retries carry the same idempotency key. A shared store also needs a session scope.',
        zh: '重试会携带相同幂等键时，在服务端点提供结果存储；共用存储时还需会话作用域。'
      },
      example:
        'const server = createRuntimeApiEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n}, catalogChannel)'
    },
    'idempotency.scope': {
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      },
      example:
        'const server = createRuntimeApiEndpoint({\n  ...connectionOptions,\n  idempotency: { store: orderOutcomes, scope: ({ token }) => token }\n}, catalogChannel)'
    },
    transport: {
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      },
      example:
        "import { createRuntimeApiEndpoint, connect } from '@migaia/rpc-core'\n\nconst checkout = createRuntimeApiEndpoint({\n  id: 'checkout',\n  targetIds: ['catalog'],\n  transport: catalogTransport,\n  middlewares: [connect({ transport: catalogTransport })]\n}, catalogChannel)\nonCheckoutClosed(() => checkout.dispose())"
    },
    'construction.timeoutMs': {
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      },
      example:
        'const checkout = createRuntimeApiEndpoint({\n  ...connectionOptions,\n  construction: { signal: opening.signal, timeoutMs: false }\n}, catalogChannel)'
    },
    binding: {
      whenToUse: {
        en: 'Reuse a binding from an existing runtime owner when requests must keep that owner’s operations and cleanup. It is an alternative to constructing from transport options.',
        zh: '请求需要保留已有运行时所有者的操作与清理语义时复用绑定；它与传输配置构造是两条备选路径。'
      },
      example:
        "import { createRuntimeApiEndpoint } from '@migaia/rpc-core'\n\nconst endpoint = createRuntimeApiEndpoint({ binding: existingRuntimeBinding })"
    }
  },
  connect: {
    receiverSelector: {
      whenToUse: {
        en: 'Existing integrations may retain this captured configuration; current public send routing does not invoke it, so it cannot select a receiver today.',
        zh: '既有集成可以保留此捕获配置；当前公开 send 路由未调用它，因此目前不能用它选择接收端。'
      },
      example:
        'connect({\n  transport: serviceTransport,\n  receiverSelector: (candidates) => candidates[0]?.receiverId\n})'
    },
    discoveryMode: {
      whenToUse: {
        en: 'Choose automatic when known targets should be discovered and selected during calls; manual requires explicit discovery controls.',
        zh: '调用时需要自动发现并选择已知目标时用 automatic；manual 需要显式发现控制。'
      },
      example:
        "import { connect } from '@migaia/rpc-core'\n\nconst discovery = connect({\n  transport: serviceTransport,\n  discoveryMode: 'manual'\n})"
    },
    uniqueTargetId: {
      whenToUse: {
        en: 'Generate a per-instance suffix together with an enabled custom identifier.',
        zh: '启用自定义校验器时，同时生成实例后缀。'
      },
      example:
        "import { connect } from '@migaia/rpc-core'\n\nconst identifiedConnection = connect({\n  transport: serviceTransport,\n  useBaseIdVerifyOnly: true,\n  uniqueTargetId: () => crypto.randomUUID(),\n  identifier: (context) => verifyApplicationInstance(context)\n})"
    },
    identifier: {
      whenToUse: {
        en: 'Supplement actual carrier verification with an application admission decision.',
        zh: '在实际载体验证之上增加应用准入决定。'
      },
      example:
        "import { connect } from '@migaia/rpc-core'\n\nconst identifiedConnection = connect({\n  transport: serviceTransport,\n  useBaseIdVerifyOnly: true,\n  uniqueTargetId: () => crypto.randomUUID(),\n  identifier: (context) => verifyApplicationInstance(context)\n})"
    }
  },
  hooks: {
    listeners: {
      whenToUse: {
        en: 'Supply an application diagnostic callback; route observer errors without throwing into business settlement.',
        zh: '提供应用诊断回调，将观察者错误单独上报，避免抛错影响业务结果。'
      },
      example:
        "import { hooks } from '@migaia/rpc-core'\n\nconst requestLogging = hooks({\n  listeners: (event) => recordRpcEvent(event)\n})"
    },
    onHookError: {
      whenToUse: {
        en: 'Supply an application diagnostic callback; route observer errors without throwing into business settlement.',
        zh: '提供应用诊断回调，将观察者错误单独上报，避免抛错影响业务结果。'
      },
      example:
        "import { hooks } from '@migaia/rpc-core'\n\nconst requestLogging = hooks({\n  listeners: (event) => recordRpcEvent(event),\n  onHookError: (error, event) => reportLoggingFailure(error, event)\n})"
    }
  },
  uuid: {
    generate: {
      whenToUse: {
        en: 'Supply a synchronous unique string generator when application tracing needs stable endpoint prefixes.',
        zh: '应用追踪需要稳定端点前缀时，提供同步唯一字符串生成器。'
      },
      example:
        "import { uuid } from '@migaia/rpc-core'\n\nconst checkoutIds = uuid({\n  generate: () => `checkout-${crypto.randomUUID()}`\n})"
    }
  },
  timeout: {
    timeoutMs: {
      whenToUse: {
        en: 'Choose finite milliseconds for bounded waits or false when the application deliberately owns the waiting lifetime.',
        zh: '需要有界等待时设有限毫秒数，应用明确拥有等待生命周期时用 false。'
      },
      example:
        "import { timeout } from '@migaia/rpc-core'\n\nconst pricingDeadline = timeout({ timeoutMs: 2000 })"
    }
  },
  createPeerPair: {
    report: {
      whenToUse: {
        en: 'Collect background diagnostics in the application that owns both local peers.',
        zh: '由同时拥有两端的应用收集后台诊断。'
      },
      example:
        "import { createPeerPair } from '@migaia/rpc-core/testing'\n\nconst pair = await createPeerPair({\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error),\n  a: { provide: {} },\n  b: { provide: { prices: () => fetchPrices() } }\n})"
    }
  },
  authentication: {
    encrypt: {
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst privateOrders = authentication({\n  encrypt: (value) => encryptOrderMessage(value),\n  decrypt: (value) => decryptOrderMessage(value),\n  sign: (value) => signOrderMessage(value),\n  verify: (value) => verifyOrderMessage(value),\n  encodedType: 'string'\n})"
    },
    decrypt: {
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst privateOrders = authentication({\n  encrypt: (value) => encryptOrderMessage(value),\n  decrypt: (value) => decryptOrderMessage(value),\n  sign: (value) => signOrderMessage(value),\n  verify: (value) => verifyOrderMessage(value),\n  encodedType: 'string'\n})"
    },
    sign: {
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst signedMessages = authentication({\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n})"
    },
    verify: {
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst signedMessages = authentication({\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n})"
    },
    encodedType: {
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      },
      example:
        "import { authentication } from '@migaia/rpc-core'\n\nconst signedMessages = authentication({\n  sign: (value) => signCheckoutMessage(value),\n  verify: (value) => verifyCheckoutMessage(value),\n  encodedType: 'string'\n})"
    }
  },
  createBrowserMessagePortTransport: {
    ownership: {
      whenToUse: {
        en: 'Choose owned only when the wrapper should close the original port; choose borrowed when another component retains it.',
        zh: '包装器应负责关闭原端口时选 owned，其他组件保留生命周期时选 borrowed。'
      },
      example:
        "import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'\n\nconst transport = createBrowserMessagePortTransport(port, { ownership: 'owned' })\nonViewClosed(() => transport.close?.())"
    }
  },
  createIpcLogFeature: {
    report: {
      whenToUse: {
        en: 'Observe local diagnostics and send sink failures to a separate application owner.',
        zh: '观察本地诊断，并把接收器失败交给独立应用所有者。'
      },
      example:
        "import { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\n\nconst logging = createIpcLogFeature({\n  gate: connectionGate,\n  report: (event) => recordConnectionEvent(event),\n  onReportError: (error, event) => reportLoggingFailure(error, event)\n})"
    },
    onReportError: {
      whenToUse: {
        en: 'Observe local diagnostics and send sink failures to a separate application owner.',
        zh: '观察本地诊断，并把接收器失败交给独立应用所有者。'
      },
      example:
        "import { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\n\nconst logging = createIpcLogFeature({\n  gate: connectionGate,\n  report: (event) => recordConnectionEvent(event),\n  onReportError: (error, event) => reportLoggingFailure(error, event)\n})"
    }
  },
  defineMessageAdapter: {
    open: {
      whenToUse: {
        en: 'Return the original host MessagePort or messaging object when the connection already exists.',
        zh: '连接已存在时，返回宿主的原始消息端口或消息对象。'
      },
      example:
        "import { defineMessageAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst peer = await adapter.peer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  connect: catalogPort\n})\ntry {\n  renderPrices(await peer.request('prices'))\n} finally {\n  await peer.close()\n}"
    },
    launch: {
      whenToUse: {
        en: 'Supply launch only when the adapter owns native execution and can observe its actual exit.',
        zh: '仅在适配器拥有原生执行单元且能观察真实退出时提供 launch。'
      },
      example:
        "import { defineMessageAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineMessageAdapter<URL>({\n  open: (url) => openExistingWorkerPort(url),\n  launch: (url) => launchWorker(url)\n})\nconst peer = await adapter.peer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  spawn: new URL('./price-worker.js', import.meta.url)\n})"
    }
  },
  defineByteAdapter: {
    open: {
      whenToUse: {
        en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
        zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
      },
      example:
        "import { defineByteAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineByteAdapter<URL>({\n  open: (address) => openByteConnection(address),\n  diagnostics: connectionDiagnostics,\n  presentation: {\n    platform: 'Process',\n    expectedStringText: 'Price connection expects text frames'\n  }\n})\nconst peer = await adapter.peer({\n  self: { name: 'checkout', instanceId: 'checkout-1' },\n  connect: priceServiceAddress,\n  peerId: 'pricing-1'\n})"
    },
    listen: {
      whenToUse: {
        en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
        zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
      },
      example:
        "import { defineByteAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineByteAdapter<URL>({\n  open: (address) => openByteConnection(address),\n  listen: (address) => acceptByteConnection(address),\n  dial: (address) => dialByteConnection(address),\n  diagnostics: connectionDiagnostics\n})"
    },
    dial: {
      whenToUse: {
        en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
        zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
      },
      example:
        "import { defineByteAdapter } from '@migaia/rpc-core/adapter'\n\nconst adapter = defineByteAdapter<URL>({\n  open: (address) => openByteConnection(address),\n  listen: (address) => acceptByteConnection(address),\n  dial: (address) => dialByteConnection(address),\n  diagnostics: connectionDiagnostics\n})"
    }
  },
  createRuntimePeer: {
    report: {
      whenToUse: {
        en: 'Keep local diagnostics with this Peer’s owner; keyFactory is inherited but direct requests do not read it.',
        zh: '把本地诊断交给此对端所有者；keyFactory 是继承配置，直接请求不会读取。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n})'
    },
    keyFactory: {
      whenToUse: {
        en: 'Direct Peer requests do not consult this inherited policy. Use a managed or remote proxy dispatch path when logical-key or retry policy is required.',
        zh: '直接 Peer 请求不读取此继承策略；需要逻辑键或重试策略时，使用托管或远端代理派发路径。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  keyFactory: () => crypto.randomUUID()\n})'
    },
    authentication: {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    'authentication.encrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n})"
    },
    'authentication.decrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n})"
    },
    'authentication.sign': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    'authentication.verify': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    'authentication.encodedType': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    spawn: {
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  spawn: (context) => openPricingChannel(context)\n})'
    },
    connect: {
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  connect: (context) => openPricingChannel(context)\n})'
    },
    listen: {
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  listen: (context) => openPricingChannel(context)\n})'
    },
    retryPort: {
      whenToUse: {
        en: 'Direct Peer requests do not consult this inherited policy. Use a managed or remote proxy dispatch path when logical-key or retry policy is required.',
        zh: '直接 Peer 请求不读取此继承策略；需要逻辑键或重试策略时，使用托管或远端代理派发路径。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  retryPort: pricingRetryPolicy\n})'
    },
    endpointFactory: {
      whenToUse: {
        en: 'Supply this advanced callback only when the application owns a complete served endpoint; reject construction if that endpoint cannot be acquired.',
        zh: '仅在应用拥有完整服务端点时提供此高级回调；无法取得端点时拒绝构造。'
      },
      example:
        'const pricing = await createRuntimePeer({\n  ...pricingOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})'
    }
  },
  createRemoteHost: {
    endpointFactory: {
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      },
      example:
        'const pricing = createRemoteHost({\n  ...pricingOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})'
    },
    report: {
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      },
      example:
        'const pricing = createRemoteHost({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n})'
    },
    keyFactory: {
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      },
      example:
        'const pricing = createRemoteHost({\n  ...pricingOptions,\n  keyFactory: () => crypto.randomUUID()\n})'
    },
    callGuard: {
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      },
      example:
        'const pricing = createRemoteHost({\n  ...pricingOptions,\n  callGuard: { beforeDispatch: (call) => authorizePricingCall(call) }\n})'
    }
  },
  createRemotePlugin: {
    endpointFactory: {
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      },
      example:
        'const pricing = createRemotePlugin({\n  ...pricingOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})'
    },
    report: {
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      },
      example:
        'const pricing = createRemotePlugin({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n})'
    },
    keyFactory: {
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      },
      example:
        'const pricing = createRemotePlugin({\n  ...pricingOptions,\n  keyFactory: () => crypto.randomUUID()\n})'
    },
    callGuard: {
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      },
      example:
        'const pricing = createRemotePlugin({\n  ...pricingOptions,\n  callGuard: { beforeDispatch: (call) => authorizePricingCall(call) }\n})'
    }
  },
  createRemoteRetryPort: {
    report: {
      whenToUse: {
        en: 'Report secondary retry or cleanup failures through the original application diagnostic owner.',
        zh: '通过原应用诊断所有者报告重试或清理的次要失败。'
      },
      example:
        "import { createRemoteRetryPort } from '@migaia/rpc-core/remote'\n\nconst retry = createRemoteRetryPort({\n  events: pricingEvents,\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error)\n})"
    }
  },
  serveRemoteHost: {
    report: {
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      },
      example:
        'const pricing = await serveRemoteHost({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n})'
    },
    resolvePlugin: {
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      },
      example:
        'const pricing = await serveRemoteHost({\n  ...pricingOptions,\n  resolvePlugin: (name) => resolveApprovedPlugin(name)\n})'
    }
  },
  serveRemotePlugin: {
    report: {
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      },
      example:
        'const pricing = await serveRemotePlugin({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n})'
    },
    invocationContext: {
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      },
      example:
        "import { serveRemotePlugin } from '@migaia/rpc-core/remote'\n\nconst service = await serveRemotePlugin({\n  ...pricingServiceOptions,\n  invocationContext: (context) => ({ sender: context.senderId })\n})"
    }
  },
  createManagedRuntimePeer: {
    report: {
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      },
      example:
        'const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n}, pricingBinding)'
    },
    keyFactory: {
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      },
      example:
        'const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  keyFactory: () => crypto.randomUUID()\n}, pricingBinding)'
    },
    retryPort: {
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      },
      example:
        'const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  retryPort: pricingRetryPolicy\n}, pricingBinding)'
    },
    endpointFactory: {
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      },
      example:
        'const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n}, pricingBinding)'
    },
    spawn: {
      whenToUse: {
        en: 'Do not set spawn to choose a managed source. This factory uses pricingBinding.openChannel; this inherited callback is not invoked.',
        zh: '不要用 spawn 选择托管来源。该工厂使用 pricingBinding.openChannel，不调用此继承回调。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  self: { name: 'checkout', instanceId: 'checkout-1' }\n}, pricingBinding)"
    },
    connect: {
      whenToUse: {
        en: 'Do not set connect to choose a managed source. This factory uses pricingBinding.openChannel; this inherited callback is not invoked.',
        zh: '不要用 connect 选择托管来源。该工厂使用 pricingBinding.openChannel，不调用此继承回调。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  self: { name: 'checkout', instanceId: 'checkout-1' }\n}, pricingBinding)"
    },
    listen: {
      whenToUse: {
        en: 'Do not set listen to choose a managed source. This factory uses pricingBinding.openChannel; this inherited callback is not invoked.',
        zh: '不要用 listen 选择托管来源。该工厂使用 pricingBinding.openChannel，不调用此继承回调。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  self: { name: 'checkout', instanceId: 'checkout-1' }\n}, pricingBinding)"
    },
    authentication: {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, pricingBinding)"
    },
    'authentication.encrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n}, pricingBinding)"
    },
    'authentication.decrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n}, pricingBinding)"
    },
    'authentication.sign': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, pricingBinding)"
    },
    'authentication.verify': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, pricingBinding)"
    },
    'authentication.encodedType': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = await createManagedRuntimePeer({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, pricingBinding)"
    },
    probe: {
      whenToUse: {
        en: 'Attach the application’s message probe when this connection needs diagnostic tracing; omit it for an unobserved connection.',
        zh: '这条连接需要诊断追踪时附加应用的消息 probe；无需观察时省略。'
      },
      example:
        'const pricing = await createManagedRuntimePeer({\n  ...pricingOptions, probe: pricingProbe\n}, pricingBinding)'
    }
  },
  createCoroutinePlugin: {
    task: {
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      },
      example:
        "import { defineHost } from '@migaia/plugin-host'\nimport { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\ntype IPricing = { prices(): number[] }\nconst pricing = createCoroutinePlugin<IPricing>({\n  name: 'pricing',\n  task: ({ connect, signal, heartbeat }) => runPricingTask({ connect, signal, heartbeat }),\n  supervisor: { startupTimeoutMs: 5000 }\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof pricing]>(hostConfiguration)\ntry {\n  await host.use(pricing)\n  renderPrices(await host.coroutine!.request('pricing', 'prices'))\n} finally {\n  await host.dispose()\n}"
    },
    connect: {
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      },
      example:
        "import { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst parent = createCoroutinePlugin({\n  name: 'parent',\n  self: { name: 'pricing-child', instanceId: childInstanceId },\n  connect: context.connect,\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  defaultTimeoutMs: 2000\n})\nawait childHost.use(parent)"
    },
    report: {
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      },
      example:
        'const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n})'
    },
    keyFactory: {
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      },
      example:
        'const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  keyFactory: () => crypto.randomUUID()\n})'
    },
    retryPort: {
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      },
      example:
        'const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  retryPort: pricingRetryPolicy\n})'
    },
    endpointFactory: {
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      },
      example:
        'const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})'
    },
    authentication: {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    'authentication.encrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n})"
    },
    'authentication.decrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n})"
    },
    'authentication.sign': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    'authentication.verify': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    'authentication.encodedType': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createCoroutinePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n})"
    },
    resolvePlugin: {
      whenToUse: {
        en: 'Return a local real definition only for names in the catalog of the same exposed Host.',
        zh: '只为同一已公开宿主目录中的名称返回本地真实定义。'
      },
      example:
        "import { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst parent = createCoroutinePlugin({\n  name: 'parent',\n  connect: context.connect,\n  expose: ['host'],\n  host: childHost,\n  catalog: pricingCatalog,\n  resolvePlugin: (name) => resolveApprovedPlugin(name)\n})"
    },
    probe: {
      whenToUse: {
        en: 'Attach the application’s message probe when this connection needs diagnostic tracing; omit it for an unobserved connection.',
        zh: '这条连接需要诊断追踪时附加应用的消息 probe；无需观察时省略。'
      },
      example:
        'const pricing = createCoroutinePlugin({\n  ...pricingOptions, probe: pricingProbe\n})'
    },
    contract: {
      whenToUse: {
        en: 'Pass the declared pricing contract so provided methods keep their documented wire names and modes.',
        zh: '传入声明的价格契约，让提供的方法使用约定的线上名称和模式。'
      },
      example:
        'const pricing = createCoroutinePlugin({\n  ...pricingOptions, contract: pricingContract\n})'
    }
  },
  createRuntimePlugin: {
    report: {
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  report: (error) => reportToMonitoring(error)\n}, platformIntegration, createPlatformPeer)'
    },
    connect: {
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  connect: pricingSource\n}, platformIntegration, createPlatformPeer)'
    },
    resolvePlugin: {
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  resolvePlugin: (name) => resolveApprovedPlugin(name)\n}, platformIntegration, createPlatformPeer)'
    },
    endpointFactory: {
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n}, platformIntegration, createPlatformPeer)'
    },
    keyFactory: {
      whenToUse: {
        en: 'Supply local logical-key or retry policy only for the actual installed dispatch path; direct borrowed Peer dispatch may leave them unused.',
        zh: '只为实际安装的派发路径提供本地逻辑键或重试策略；直接借入 Peer 的派发可能不使用它们。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  keyFactory: () => crypto.randomUUID()\n}, platformIntegration, createPlatformPeer)'
    },
    retryPort: {
      whenToUse: {
        en: 'Supply local logical-key or retry policy only for the actual installed dispatch path; direct borrowed Peer dispatch may leave them unused.',
        zh: '只为实际安装的派发路径提供本地逻辑键或重试策略；直接借入 Peer 的派发可能不使用它们。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  retryPort: pricingRetryPolicy\n}, platformIntegration, createPlatformPeer)'
    },
    authentication: {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, platformIntegration, createPlatformPeer)"
    },
    'authentication.encrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n}, platformIntegration, createPlatformPeer)"
    },
    'authentication.decrypt': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  authentication: {\n    encrypt: encryptOrderMessage,\n    decrypt: decryptOrderMessage,\n    sign: signOrderMessage,\n    verify: verifyOrderMessage,\n    encodedType: 'string'\n  }\n}, platformIntegration, createPlatformPeer)"
    },
    'authentication.sign': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, platformIntegration, createPlatformPeer)"
    },
    'authentication.verify': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, platformIntegration, createPlatformPeer)"
    },
    'authentication.encodedType': {
      whenToUse: {
        en: 'Use the application’s paired protection functions on both endpoints. Encryption requires decrypt and the sign/verify pair for replay protection; signing alone needs verify. encodedType must describe the protected frame. Omit authentication only when the carrier’s trust policy permits it.',
        zh: '在两端使用应用配套的保护函数：加密 `encrypt` 须配合 `decrypt` 及 `sign`/`verify` 防重放，单独签名也须配合 `verify`；encodedType 必须对应受保护帧。仅当载体信任策略允许时才省略认证。'
      },
      example:
        "const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  authentication: { sign: signOrderMessage, verify: verifyOrderMessage, encodedType: 'string' }\n}, platformIntegration, createPlatformPeer)"
    },
    spawn: {
      whenToUse: {
        en: 'Choose exactly one source input interpreted by the actual platform peer factory; preserve that factory’s acquisition semantics.',
        zh: '选择由实际平台对端工厂解释的一种来源输入，并保留该工厂的资源取得语义。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  spawn: pricingSource\n}, platformIntegration, createPlatformPeer)'
    },
    listen: {
      whenToUse: {
        en: 'Choose exactly one source input interpreted by the actual platform peer factory; preserve that factory’s acquisition semantics.',
        zh: '选择由实际平台对端工厂解释的一种来源输入，并保留该工厂的资源取得语义。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions,\n  listen: pricingSource\n}, platformIntegration, createPlatformPeer)'
    },
    probe: {
      whenToUse: {
        en: 'Attach the application’s message probe when this connection needs diagnostic tracing; omit it for an unobserved connection.',
        zh: '这条连接需要诊断追踪时附加应用的消息 probe；无需观察时省略。'
      },
      example:
        'const pricing = createRuntimePlugin({\n  ...pricingOptions, probe: pricingProbe\n}, platformIntegration, createPlatformPeer)'
    }
  }
}
