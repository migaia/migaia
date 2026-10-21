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

/** Configuration scenarios exercise public constructors with the original carrier owners. */
export const rpcCoreOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  createEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst server = await createEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n})\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst server = await createEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n})\nconst client = await createEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } })\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createClientEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst server = await createEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n})\nconst client = await createClientEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst server = await createEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n})\nconst client = await createClientEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createClientEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } })\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createProviderEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst server = await createProviderEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n})\nconst client = await createClientEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst server = await createProviderEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n})\nconst client = await createClientEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createProviderEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } })\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createFullEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst server = await createFullEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n})\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst server = await createFullEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n})\nconst client = await createEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createFullEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } })\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createFullOneWayEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst server = await createFullOneWayEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n})\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'\nimport { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst server = await createFullOneWayEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n})\nconst client = await createEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createFullOneWayEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } })\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createComposedEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst chunk = createCanonicalChunkFeature()\nconst outbound = createOutboundFeature(chunk)\nconst selected = { 'first-party-chunk': chunk, 'first-party-outbound': outbound, 'first-party-provider': createProviderFeature(outbound) }\nconst server = await createComposedEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n}, selected)\nconst client = await createClientEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst chunk = createCanonicalChunkFeature()\nconst outbound = createOutboundFeature(chunk)\nconst selected = { 'first-party-chunk': chunk, 'first-party-outbound': outbound, 'first-party-provider': createProviderFeature(outbound) }\nconst server = await createComposedEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n}, selected)\nconst client = await createClientEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createComposedEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } }, {})\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    }
  ],
  createRpcIdempotencyStore: [
    {
      title: {
        en: 'Bound local outcome retention',
        zh: '限制本地结果保留'
      },
      problem: {
        en: 'A local task dispatcher owns its own scope and needs bounded retained outcomes. Set entry and byte limits together.',
        zh: '本地任务派发者自己拥有作用域，需要有界保留结果；同时设置条目和字节限制。'
      },
      example:
        "import { createRpcIdempotencyStore } from '@migaia/rpc-core'\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst first = store.claim('local-save', 'save-1', 0)\nif (first.status === 'claimed') first.settle({ ok: true, data: 42 }, 1)\nconsole.log(store.lookup?.('local-save', 'save-1', 2)?.state)\nconsole.log(store.lookup?.('local-save', 'save-1', 30002)?.state)",
      result: {
        en: 'Prints done then unknown after retention expires. Pending work is not expired by retentionMs.',
        zh: '先输出 done；保留期到后输出 unknown。retentionMs 不使在途工作过期。'
      },
      covers: ['retentionMs', 'maxEntries', 'maxEntriesPerScope', 'maxBytes', 'maxOutcomeBytes']
    },
    {
      title: {
        en: 'Share provider results across retried calls',
        zh: '重试调用共用处理结果'
      },
      problem: {
        en: 'A provider needs the same retained outcome for a repeated application key. Inject the bounded store into the endpoint.',
        zh: '处理方要为重复应用键返回同一结果，把容量受限的存储交给端点。'
      },
      example:
        "import { createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst server = await createEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n})\nconst client = await createEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and 1 1. Only one provider invocation occurs.',
        zh: '输出 1 和 1 1，处理函数只调用一次。'
      },
      covers: ['retentionMs', 'maxEntries', 'maxEntriesPerScope', 'maxBytes', 'maxOutcomeBytes']
    }
  ],
  contract: [
    {
      title: {
        en: 'Validate a versioned method at both ends',
        zh: '双端校验带版本的方法'
      },
      problem: {
        en: 'A numeric method should reject malformed data at the RPC boundary. Install matching version and synchronous schemas on each endpoint.',
        zh: '数字方法应在 RPC 边界拒绝错误数据；双端安装匹配版本与同步结构校验。'
      },
      example:
        "import { createEndpoint, connect, contract } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nconst number = { parse(value: unknown) { if (typeof value !== 'number') throw new TypeError('number required'); return value } }\nconst policy = contract({ version: '1.0.0', acceptVersions: ['1.0.0'], maxIdentifierLength: 128, schemas: { double: { params: number, result: number } } })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right }), policy] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), policy] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Both the argument and the result pass the application number parser.',
        zh: '输出 42；入参和结果都通过应用提供的数字解析函数。'
      },
      covers: ['version', 'acceptVersions', 'maxIdentifierLength', 'schemas']
    },
    {
      title: {
        en: 'Reject an invalid argument before business work',
        zh: '业务执行前拒绝非法入参'
      },
      problem: {
        en: 'The caller passes text to a numeric method. Keep the same method schema and observe the rejected call.',
        zh: '调用者给数字方法传入文本；复用相同结构约束并观察拒绝。'
      },
      example:
        "import { createEndpoint, connect, contract } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nconst number = { parse(value: unknown) { if (typeof value !== 'number') throw new TypeError('number required'); return value } }\nconst policy = contract({ version: '1.0.0', acceptVersions: ['1.0.0'], maxIdentifierLength: 128, schemas: { double: { params: number, result: number } } })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right }), policy] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), policy] })\ntry { try { await client.send('server', 'double', 'bad') } catch (error) { console.log((error as { code: string }).code) } }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints SCHEMA_INVALID. A schema failure rejects the request.',
        zh: '输出 SCHEMA_INVALID，结构校验失败使请求拒绝。'
      },
      covers: ['schemas']
    }
  ],
  hooks: [
    {
      title: {
        en: 'Observe requests without changing results',
        zh: '观察请求且不改变结果'
      },
      problem: {
        en: 'A diagnostics view records actual local event names while requests retain their ordinary result.',
        zh: '诊断视图记录真实本地事件名，请求仍返回正常结果。'
      },
      example:
        "import { createEndpoint, connect, hooks } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nconst names: string[] = []\nconst observe = hooks({ listeners: (event) => { names.push(event.name) }, onHookError: (error, event) => { console.error(event.name, error) } })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), observe] })\ntry { console.log(await client.send('server', 'double', 21)); console.log(names.length > 0) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42 and true. Local hooks saw events while the business result was unchanged.',
        zh: '输出 42 和 true；本地钩子观察到事件，业务结果保持不变。'
      },
      covers: ['listeners', 'onHookError']
    },
    {
      title: {
        en: 'Retain an observer failure separately',
        zh: '单独保留观察者失败'
      },
      problem: {
        en: 'A diagnostic listener can fail. Give onHookError the original error while allowing the request to settle normally.',
        zh: '诊断监听可能失败；通过 onHookError 接收原错误，同时让请求正常完成。'
      },
      example:
        "import { createEndpoint, connect, hooks } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nconst failure = new Error('observer unavailable')\nconst reported: unknown[] = []\nconst observe = hooks({ listeners: () => { throw failure }, onHookError: (error) => { reported.push(error) } })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), observe] })\ntry { console.log(await client.send('server', 'double', 21)); console.log(reported.includes(failure)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42 and true. The original listener error reaches the error callback.',
        zh: '输出 42 和 true；错误回调收到监听器的原始错误。'
      },
      covers: ['listeners', 'onHookError']
    }
  ],
  uuid: [
    {
      title: {
        en: 'Issue traceable operation identifiers',
        zh: '签发可追踪的操作标识'
      },
      problem: {
        en: 'An application wants unique identifiers that include its endpoint and operation category. Keep a monotonic local sequence in the synchronous generator.',
        zh: '应用希望唯一标识包含端点与操作类别，在同步生成器中保留本地递增序列。'
      },
      example:
        "import { createEndpoint, connect, uuid } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nlet sequence = 0\nconst identity = uuid({ generate: ({ senderId, variation }) => `${senderId}-${variation}-${++sequence}` })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), identity] })\ntry { console.log(await client.send('server', 'double', 21)); console.log(sequence > 0) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42 and true. The installed generator is invoked by actual endpoint operations.',
        zh: '输出 42 和 true；真实端点操作调用了已安装的生成器。'
      },
      covers: ['generate']
    },
    {
      title: {
        en: 'Reject an identifier factory failure at the caller',
        zh: '向调用者保留标识工厂失败'
      },
      problem: {
        en: 'The identity source is unavailable. Throw from the synchronous factory and observe the failed operation.',
        zh: '标识来源不可用时，同步工厂抛错，调用者观察操作失败。'
      },
      example:
        "import { createEndpoint, connect, uuid } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nlet sequence = 0\nconst identity = uuid({ generate: ({ senderId, variation }) => (() => { throw new Error('identity offline') })() })\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), identity] })\ntry { try { await client.send('server', 'double', 21) } catch (error) { console.log((error as { code: string }).code === 'INVALID_CONFIG') } }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints true; no application reply is produced from the failed send.',
        zh: '输出 true；失败发送不会产生业务答复。'
      },
      covers: ['generate']
    }
  ],
  timeout: [
    {
      title: {
        en: 'Override one call deadline',
        zh: '覆盖单次调用期限'
      },
      problem: {
        en: 'Use a shared default but allow an expired call to fail immediately and another call to opt out.',
        zh: '保留共享默认值，同时让已过期调用立即拒绝，另一次调用明确不设期限。'
      },
      example:
        "import { createEndpoint, connect, timeout } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), timeout({ timeoutMs: 5000 })] })\ntry { try { await client.send('server', 'double', 21, { timeoutMs: 0 }) } catch (error) { console.log((error as { code: string }).code) }; console.log(await client.send('server', 'double', 21, { timeoutMs: false })) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints DEADLINE_EXCEEDED and 42. false disables this call’s local deadline.',
        zh: '输出 DEADLINE_EXCEEDED 和 42；false 关闭本次调用的本地期限。'
      },
      covers: ['timeoutMs']
    },
    {
      title: {
        en: 'Disable the installed default deadline',
        zh: '关闭已安装的默认期限'
      },
      problem: {
        en: 'A cooperative long-running operation should wait for its result rather than inherit the Core fallback.',
        zh: '协作式长任务应等待实际结果，无需继承 Core 的后备期限。'
      },
      example:
        "import { createEndpoint, connect, timeout } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), timeout({ timeoutMs: false })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42 with the explicitly disabled default deadline. Cancellation remains separately controlled by a signal.',
        zh: '输出 42，安装的默认期限已明确关闭；取消仍由独立信号控制。'
      },
      covers: ['timeoutMs']
    }
  ],
  createPeerPair: [
    {
      title: {
        en: 'Exercise a bounded in-process service',
        zh: '在进程内调用有限额的服务'
      },
      problem: {
        en: 'Two modules need genuine runtime method discovery and calls without native carrier setup. Provide the real methods on side b.',
        zh: '两个模块需要真实运行时方法发现与调用，又无需建立原生载体；在 b 端提供实际方法。'
      },
      example:
        "import { createPeerPair } from '@migaia/rpc-core/testing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst failures: unknown[] = []\nconst pair = await createPeerPair({\n a: { provide: {}, defaultTimeoutMs: 2000 },\n b: { provide: { math: { double: (value: number) => value * 2 } }, providerLimits: { maxGlobal: 8, maxPerPeer: 2 } },\n scheduler: systemScheduler,\n report: (error) => { failures.push(error) }\n})\ntry { console.log(await pair.a.request('math.double', 21), failures.length) }\nfinally { await pair.a.close(); await pair.b.close() }",
      result: {
        en: 'Prints 42 0. The call succeeds with no reported background failures. Close both peers afterwards.',
        zh: '输出 42 0；调用成功且没有报告后台失败，最后关闭两个对端。'
      },
      covers: ['a', 'b', 'scheduler', 'report']
    },
    {
      title: {
        en: 'Allow both peers to call the other side',
        zh: '让双方相互调用'
      },
      problem: {
        en: 'A local integration needs callbacks in both directions. Each provide map becomes the other side’s accepted method directory.',
        zh: '本地集成需要双向回调，每端的 provide 映射成为对方接受的方法目录。'
      },
      example:
        "import { createPeerPair } from '@migaia/rpc-core/testing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst failures: unknown[] = []\nconst pair = await createPeerPair({\n a: { provide: { label: (value: string) => `saved:${value}` }, defaultTimeoutMs: 2000 },\n b: { provide: { math: { double: (value: number) => value * 2 } }, providerLimits: { maxGlobal: 8, maxPerPeer: 2 } },\n scheduler: systemScheduler,\n report: (error) => { failures.push(error) }\n})\ntry { console.log(await pair.a.request('math.double', 21)); console.log(await pair.b.request('label', 'draft')) }\nfinally { await pair.a.close(); await pair.b.close() }",
      result: {
        en: 'Prints 42 then saved:draft. Both directions use real peers and their negotiated directories.',
        zh: '先输出 42，再输出 saved:draft；两个方向都经过真实对端及已协商目录。'
      },
      covers: ['a', 'b', 'scheduler', 'report']
    }
  ],
  connect: [
    {
      title: {
        en: 'Retain a selector configuration on the current routing path',
        zh: '在当前路由路径保留选择器配置'
      },
      problem: {
        en: 'An application supplies a receiver selector for future routing policy. Current Core captures this callback, but the public send path does not call receiverForOperation; the example makes that limit visible.',
        zh: '应用提供接收端选择器作为路由配置。当前 Core 捕获该回调，但公开 send 路径未调用 receiverForOperation，本例直接展示这一限制。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nlet selections = 0\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left, discoveryMode: 'automatic', receiverSelector: (servers) => { selections++; return servers[0]?.receiverId } })] })\ntry { await client.send('server', 'double', 1); client.connect.unpinReceiver('server'); console.log(await client.send('server', 'double', 21)); console.log(selections > 0) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42 and false. The request succeeds through existing routing and the selector is not invoked, even after unpinning the initial receiver. Do not rely on this field to change current send routing.',
        zh: '输出 42 和 false。请求通过现有路由完成，即使解除初始接收端固定，也没有调用选择器。当前不能依靠此字段改变 send 路由。'
      },
      covers: ['transport', 'discoveryMode', 'receiverSelector']
    },
    {
      title: {
        en: 'Add application instance discrimination on an exclusive pair',
        zh: '为独占通道增加应用实例区分'
      },
      problem: {
        en: 'This application owns both memory endpoints and restricts accepted sender names. The callback supplements Core’s actual exclusive-channel verification.',
        zh: '应用拥有两个内存端点并限制允许的发送者名称；回调补充 Core 的真实独占通道校验。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nlet verified = 0\nconst identity = { useBaseIdVerifyOnly: false, uniqueTargetId: ({ endpointId }: { endpointId: string }) => `${endpointId}-session`, identifier: (context: { senderId: string; targetId: string }) => { verified++; return ['server', 'client'].includes(context.senderId) } }\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right, ...identity })] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left, ...identity })] })\ntry { console.log(await client.send('server', 'double', 21)); console.log(verified > 0) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42 and true. The custom verifier is invoked only because useBaseIdVerifyOnly is false. This name check is specific to the caller-owned exclusive pair.',
        zh: '输出 42 和 true；关闭基础验证模式后才调用自定义校验器。该名称检查仅适用于调用者拥有的独占通道对。'
      },
      covers: ['transport', 'useBaseIdVerifyOnly', 'uniqueTargetId', 'identifier']
    }
  ],
  authentication: [
    {
      title: {
        en: 'Authenticate frames with an ephemeral shared HMAC key',
        zh: '用临时共享 HMAC 密钥认证消息'
      },
      problem: {
        en: 'Both endpoints in this example hold the same local key. Sign the complete replay envelope and verify before recovering its inner value.',
        zh: '本例两端持有同一本地密钥，对完整重放封装签名，并在恢复内部值前验证。'
      },
      example:
        "import { createEndpoint, connect, authentication, type IRpcAuthenticationConfig } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder()\nconst hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])\nconst protection: IRpcAuthenticationConfig = {\n  encodedType: 'string',\n  sign: async (value) => {\n    const text = JSON.stringify(value)\n    const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))\n    return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })\n  },\n  verify: async (value) => {\n    const signed = JSON.parse(String(value)) as { text: string; mac: number[] }\n    if (!await crypto.subtle.verify('HMAC', hmac, new Uint8Array(signed.mac), encoder.encode(signed.text))) throw new Error('Invalid signature')\n    return JSON.parse(signed.text)\n  }\n}\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right }), authentication(protection)] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), authentication(protection)] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. The protected representation is text; HMAC checks the exact serialized inner value. A deployment must supply its own authenticated key distribution.',
        zh: '输出 42；受保护表示为文本，HMAC 校验内部值的精确序列化文本。实际部署需自行提供可信密钥分发。'
      },
      covers: ['sign', 'verify', 'encodedType']
    },
    {
      title: {
        en: 'Encrypt before signing and recover after verification',
        zh: '先加密后签名，验证后恢复'
      },
      problem: {
        en: 'When the payload also needs confidentiality, configure a complete AES-GCM encrypt/decrypt pair alongside signing and verification.',
        zh: '负载还需要保密时，在签名与验证之外配置完整 AES-GCM 加解密对。'
      },
      example:
        "import { createEndpoint, connect, authentication, type IRpcAuthenticationConfig } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder()\nconst hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])\nconst aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])\nconst protection: IRpcAuthenticationConfig = {\n  encrypt: async (value) => {\n    const iv = crypto.getRandomValues(new Uint8Array(12))\n    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(JSON.stringify(value)))\n    return { iv: Array.from(iv), body: Array.from(new Uint8Array(body)) }\n  },\n  decrypt: async (value) => {\n    const encrypted = value as { iv: number[]; body: number[] }\n    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) }, aes, new Uint8Array(encrypted.body))\n    return JSON.parse(decoder.decode(body))\n  },\n  encodedType: 'string',\n  sign: async (value) => {\n    const text = JSON.stringify(value)\n    const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))\n    return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })\n  },\n  verify: async (value) => {\n    const signed = JSON.parse(String(value)) as { text: string; mac: number[] }\n    if (!await crypto.subtle.verify('HMAC', hmac, new Uint8Array(signed.mac), encoder.encode(signed.text))) throw new Error('Invalid signature')\n    return JSON.parse(signed.text)\n  }\n}\nconst [left, right] = createMemoryTransportPair()\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right }), authentication(protection)] })\nserver.provide('double', (context) => context.success((context.data as number) * 2))\nconst client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), authentication(protection)] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Each encrypted frame gets a new random IV, signing covers the encrypted representation, and decryption recovers the original replay envelope.',
        zh: '输出 42；每个加密帧使用新的随机 IV，签名覆盖加密表示，解密恢复原重放封装。'
      },
      covers: ['encrypt', 'decrypt', 'sign', 'verify', 'encodedType']
    }
  ],
  createMemoryTransportPair: [
    {
      title: {
        en: 'Deliver through the application scheduler',
        zh: '通过应用调度器交付'
      },
      problem: {
        en: 'A local integration shares its monotonic scheduler with deferred memory delivery. Wait for the actual subscription callback.',
        zh: '本地集成把单调调度器用于延迟内存交付，并等待真实订阅回调。'
      },
      example:
        "import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nconst [left, right] = createMemoryTransportPair({ scheduler: systemScheduler })\nlet finish!: () => void\nconst delivered = new Promise<void>((resolve) => { finish = resolve })\nconst off = right.subscribe(({ data }) => { console.log(data); finish() })\nleft.send('saved')\nawait delivered\noff(); left.close()",
      result: {
        en: 'Prints saved after queued delivery. The pair creator closes both sides.',
        zh: '排队交付后输出 saved，创建者关闭两端。'
      },
      covers: ['scheduler']
    },
    {
      title: {
        en: 'Retire queued delivery with its pair',
        zh: '随通道对关闭未交付消息'
      },
      problem: {
        en: 'A local owner is leaving before the queued message is delivered. Close the pair before awaiting another turn.',
        zh: '本地拥有者在排队消息交付前退出，于等待下一轮之前关闭通道对。'
      },
      example:
        "import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nconst [left, right] = createMemoryTransportPair({ scheduler: systemScheduler })\nlet finish!: () => void\nconst delivered = new Promise<void>((resolve) => { finish = resolve })\nconst off = right.subscribe(({ data }) => { console.log(data); finish() })\nleft.send('saved')\nleft.close()\nawait new Promise<void>((resolve) => systemScheduler.schedule(resolve, 0))\nconsole.log(left.closed, right.closed)\noff(); left.close()",
      result: {
        en: 'Prints true true without saved: closing either end retires the pair and drops pending delivery.',
        zh: '输出 true true，不输出 saved；关闭任一端会释放通道对并丢弃待交付消息。'
      },
      covers: ['scheduler']
    }
  ],
  createBrowserMessagePortTransport: [
    {
      title: {
        en: 'Let transport cleanup close owned ports',
        zh: '让传输清理关闭已接管端口'
      },
      problem: {
        en: 'The application transfers port lifetime to each wrapper, so final transport close also closes the native port.',
        zh: '应用把端口生命周期交给包装器，因此最终关闭传输也关闭原生端口。'
      },
      example:
        "import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'\nconst { port1, port2 } = new MessageChannel()\nconst left = createBrowserMessagePortTransport(port1, { ownership: 'owned' })\nconst right = createBrowserMessagePortTransport(port2, { ownership: 'owned' })\nlet finish!: () => void\nconst received = new Promise<void>((resolve) => { finish = resolve })\nconst off = right.subscribe(({ data }) => { console.log(data); finish() })\nleft.send('saved'); await received\noff(); await left.close?.(); await right.close?.()\nconsole.log(left.closed, right.closed)",
      result: {
        en: 'Prints saved and true true after both owned wrappers are closed.',
        zh: '输出 saved，关闭两个已接管包装器后输出 true true。'
      },
      covers: ['ownership']
    },
    {
      title: {
        en: 'Borrow ports managed by a wider component',
        zh: '借用由外层组件管理的端口'
      },
      problem: {
        en: 'A wider component owns the native ports. Choose borrowed and explicitly close the ports after retiring the wrappers.',
        zh: '外层组件拥有原生端口；选 borrowed，先释放包装器，再自行关闭端口。'
      },
      example:
        "import { createBrowserMessagePortTransport } from '@migaia/rpc-core/adapters/message-port'\nconst { port1, port2 } = new MessageChannel()\nconst left = createBrowserMessagePortTransport(port1, { ownership: 'borrowed' })\nconst right = createBrowserMessagePortTransport(port2, { ownership: 'borrowed' })\nlet finish!: () => void\nconst received = new Promise<void>((resolve) => { finish = resolve })\nconst off = right.subscribe(({ data }) => { console.log(data); finish() })\nleft.send('saved'); await received\noff(); await left.close?.(); await right.close?.()\nport1.close(); port2.close()",
      result: {
        en: 'Prints saved. Wrapper cleanup leaves native port lifetime with the application, which closes both ports here.',
        zh: '输出 saved；包装器清理仍把原生端口生命周期留给应用，本例由应用关闭两端。'
      },
      covers: ['ownership']
    }
  ],
  createWebWorkerTransport: [
    {
      title: {
        en: 'Wrap real message ports with explicit static routing metadata',
        zh: '用明确静态路由信息包装真实消息端口'
      },
      problem: {
        en: 'A dedicated pair has addresses known by construction. Supply the same static capability policy at both physical ends; origin is the expected native origin label, not an authentication proof.',
        zh: '专用通道对的地址在创建时已确定。双端提供相同静态能力策略，origin 是预期原生来源标签，不是认证凭据。'
      },
      example:
        "import { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'\nconst { port1, port2 } = new MessageChannel()\nport1.start(); port2.start()\nconst left = createWebWorkerTransport(port1, { capabilities: [], peerId: 'right', origin: '' })\nconst right = createWebWorkerTransport(port2, { capabilities: [], peerId: 'left', origin: '' })\nlet finish!: () => void\nconst received = new Promise<void>((resolve) => { finish = resolve })\nconst off = right.subscribe(({ data }) => { console.log(data); finish() })\nleft.send('saved'); await received\noff(); await left.close?.(); await right.close?.()\nport1.close(); port2.close()",
      result: {
        en: 'Prints saved. The wrappers borrow their native ports, and the application closes them explicitly. No RPC capability is inferred from the peer labels.',
        zh: '输出 saved；包装器借用原生端口，应用明确关闭。对端标签不会推导出 RPC 能力。'
      },
      covers: ['capabilities', 'peerId', 'origin']
    },
    {
      title: {
        en: 'Keep the static stream policy symmetric',
        zh: '双端保持相同静态流策略'
      },
      problem: {
        en: 'A deployment chooses the supported static stream profile on both original ports. This configures the carrier and does not replace a runtime handshake.',
        zh: '部署在两个原始端口上选择受支持的静态流配置；它配置载体，不能替代运行时握手。'
      },
      example:
        "import { RpcCapability } from '@migaia/rpc-contract'\nimport { createWebWorkerTransport } from '@migaia/rpc-core/adapters/web-worker'\nconst { port1, port2 } = new MessageChannel()\nport1.start(); port2.start()\nconst left = createWebWorkerTransport(port1, { capabilities: [RpcCapability.stream], peerId: 'right', origin: '' })\nconst right = createWebWorkerTransport(port2, { capabilities: [RpcCapability.stream], peerId: 'left', origin: '' })\nlet finish!: () => void\nconst received = new Promise<void>((resolve) => { finish = resolve })\nconst off = right.subscribe(({ data }) => { console.log(data); finish() })\nleft.send('saved'); await received\noff(); await left.close?.(); await right.close?.()\nport1.close(); port2.close()",
      result: {
        en: 'Prints saved over the same native pair. Static policy is configured equally at both ends.',
        zh: '通过同一原生通道对输出 saved；两端静态策略一致。'
      },
      covers: ['capabilities', 'peerId', 'origin']
    }
  ],
  createIpcSendQueueFeature: [
    {
      title: {
        en: 'Observe a small bounded send queue',
        zh: '观察容量受限的发送队列'
      },
      problem: {
        en: 'Use one original gate for its wrapper and installed feature. Record local watermarks independently from the reply.',
        zh: '包装器与安装功能共用一个原始门，独立于答复记录本地水位事件。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createIpcSendQueueFeature, createIpcSendQueueTransport } from '@migaia/rpc-core/plugins/send-queue'\nimport { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\nconst [left, right] = createMemoryTransportPair()\nconst records: string[] = []\nconst queue = createIpcSendQueueFeature({ connectionId: 'save-channel', sessionId: 'local-session', maxPendingData: 1, maxPendingControl: 2 })\nconst transport = createIpcSendQueueTransport(left, queue.gate)\nconst log = createIpcLogFeature({ gate: queue.gate, report: (record) => { records.push(record.name) }, onReportError: (error) => { console.error(error) } })\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('echo', (context) => context.success(context.data))\nconst client = await createEndpoint({ id: 'client', transport, targetIds: ['server'], features: [queue.feature, log.feature], middlewares: [connect({ transport })] })\ntry { console.log(await client.send('server', 'echo', 'saved')); await queue.gate.whenIdle(); console.log(records.includes('ipc.backlog.high')) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints saved and true. The configured data capacity counts the active send, so one send crosses its high watermark.',
        zh: '输出 saved 和 true；数据容量包含活动发送，一次发送已跨越该配置的高水位。'
      },
      covers: ['connectionId', 'sessionId', 'maxPendingData', 'maxPendingControl']
    },
    {
      title: {
        en: 'Keep a failed log sink out of request settlement',
        zh: '日志接收失败不改变请求结果'
      },
      problem: {
        en: 'The diagnostic sink is unavailable. Its error callback observes the original error while the physical send and business reply remain successful.',
        zh: '诊断接收器不可用时，错误回调观察原始错误，实际发送和业务答复仍成功。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createIpcSendQueueFeature, createIpcSendQueueTransport } from '@migaia/rpc-core/plugins/send-queue'\nimport { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\nconst [left, right] = createMemoryTransportPair()\nconst records: string[] = []\nconst sinkFailure = new Error('log offline')\nlet reported = false\nconst queue = createIpcSendQueueFeature({ connectionId: 'save-channel', sessionId: 'local-session', maxPendingData: 1, maxPendingControl: 2 })\nconst transport = createIpcSendQueueTransport(left, queue.gate)\nconst log = createIpcLogFeature({ gate: queue.gate, report: () => { throw sinkFailure }, onReportError: (error) => { reported = error === sinkFailure } })\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('echo', (context) => context.success(context.data))\nconst client = await createEndpoint({ id: 'client', transport, targetIds: ['server'], features: [queue.feature, log.feature], middlewares: [connect({ transport })] })\ntry { console.log(await client.send('server', 'echo', 'saved')); await queue.gate.whenIdle(); console.log(reported) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints saved and true. Reporter failure reaches onReportError without replacing the reply.',
        zh: '输出 saved 和 true；报告失败到达 onReportError，不替换答复。'
      },
      covers: ['connectionId', 'sessionId', 'maxPendingData', 'maxPendingControl']
    }
  ],
  createIpcLogFeature: [
    {
      title: {
        en: 'Observe a small bounded send queue',
        zh: '观察容量受限的发送队列'
      },
      problem: {
        en: 'Use one original gate for its wrapper and installed feature. Record local watermarks independently from the reply.',
        zh: '包装器与安装功能共用一个原始门，独立于答复记录本地水位事件。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createIpcSendQueueFeature, createIpcSendQueueTransport } from '@migaia/rpc-core/plugins/send-queue'\nimport { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\nconst [left, right] = createMemoryTransportPair()\nconst records: string[] = []\nconst queue = createIpcSendQueueFeature({ connectionId: 'save-channel', sessionId: 'local-session', maxPendingData: 1, maxPendingControl: 2 })\nconst transport = createIpcSendQueueTransport(left, queue.gate)\nconst log = createIpcLogFeature({ gate: queue.gate, report: (record) => { records.push(record.name) }, onReportError: (error) => { console.error(error) } })\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('echo', (context) => context.success(context.data))\nconst client = await createEndpoint({ id: 'client', transport, targetIds: ['server'], features: [queue.feature, log.feature], middlewares: [connect({ transport })] })\ntry { console.log(await client.send('server', 'echo', 'saved')); await queue.gate.whenIdle(); console.log(records.includes('ipc.backlog.high')) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints saved and true. The configured data capacity counts the active send, so one send crosses its high watermark.',
        zh: '输出 saved 和 true；数据容量包含活动发送，一次发送已跨越该配置的高水位。'
      },
      covers: ['gate', 'report', 'onReportError']
    },
    {
      title: {
        en: 'Keep a failed log sink out of request settlement',
        zh: '日志接收失败不改变请求结果'
      },
      problem: {
        en: 'The diagnostic sink is unavailable. Its error callback observes the original error while the physical send and business reply remain successful.',
        zh: '诊断接收器不可用时，错误回调观察原始错误，实际发送和业务答复仍成功。'
      },
      example:
        "import { createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createIpcSendQueueFeature, createIpcSendQueueTransport } from '@migaia/rpc-core/plugins/send-queue'\nimport { createIpcLogFeature } from '@migaia/rpc-core/plugins/log'\nconst [left, right] = createMemoryTransportPair()\nconst records: string[] = []\nconst sinkFailure = new Error('log offline')\nlet reported = false\nconst queue = createIpcSendQueueFeature({ connectionId: 'save-channel', sessionId: 'local-session', maxPendingData: 1, maxPendingControl: 2 })\nconst transport = createIpcSendQueueTransport(left, queue.gate)\nconst log = createIpcLogFeature({ gate: queue.gate, report: () => { throw sinkFailure }, onReportError: (error) => { reported = error === sinkFailure } })\nconst server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })\nserver.provide('echo', (context) => context.success(context.data))\nconst client = await createEndpoint({ id: 'client', transport, targetIds: ['server'], features: [queue.feature, log.feature], middlewares: [connect({ transport })] })\ntry { console.log(await client.send('server', 'echo', 'saved')); await queue.gate.whenIdle(); console.log(reported) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints saved and true. Reporter failure reaches onReportError without replacing the reply.',
        zh: '输出 saved 和 true；报告失败到达 onReportError，不替换答复。'
      },
      covers: ['gate', 'report', 'onReportError']
    }
  ],
  defineMessageAdapter: [
    {
      title: {
        en: 'Open a genuine pair of native ports',
        zh: '打开一对真实原生端口'
      },
      problem: {
        en: 'An application already owns two MessagePorts. Its adapter returns those raw operations and Core performs actual bilateral admission.',
        zh: '应用已经拥有两个 MessagePort，适配器返回原始操作，由 Core 完成实际双端准入。'
      },
      example:
        "import { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst { port1, port2 } = new MessageChannel()\nport1.start(); port2.start()\nconst [a, b] = await Promise.all([\n  adapter.peer({ self: { name: 'a', instanceId: 'a-1' }, connect: port1 }),\n  adapter.peer({ self: { name: 'b', instanceId: 'b-1' }, listen: port2, provide: { echo: (value: string) => value } })\n])\ntry { console.log(await a.request('echo', 'saved')) }\nfinally { await a.close(); await b.close(); port1.close(); port2.close() }",
      result: {
        en: 'Prints saved after real Peer discovery and request handling. Both peers close before their borrowed ports.',
        zh: '真实对端发现和请求处理后输出 saved；先关闭两个对端，再关闭借入端口。'
      },
      covers: ['open']
    },
    {
      title: {
        en: 'Retain an owned worker launch and its actual exit',
        zh: '持有工作线程启动及真实退出'
      },
      problem: {
        en: 'A launcher owns a real Node Worker. Return its original messaging object, native exit Promise and termination request rather than fabricating lifecycle completion.',
        zh: '启动器拥有真实 Node Worker，返回原始消息对象、原生退出 Promise 和终止请求，不伪造生命周期完成。'
      },
      example: {
        en: "// worker.ts\nimport { parentPort } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nif (!parentPort) throw new Error('worker port required')\nconst adapter = defineMessageAdapter<typeof parentPort>({ open: (port) => port })\nawait adapter.peer({ self: { name: 'worker', instanceId: 'worker-1' }, listen: parentPort, provide: { double: (value: number) => value * 2 } })\n// main.ts\nimport { Worker } from 'node:worker_threads'\nimport { defineMessageAdapter, type IMessageAdapterPort } from '@migaia/rpc-core/adapter'\nconst adapter = defineMessageAdapter<URL>({\n  open: () => { throw new Error('spawn uses launch') },\n  launch: async (url) => {\n    const worker = new Worker(url)\n    const exited = new Promise<number>((resolve) => worker.once('exit', resolve))\n    return { port: worker as IMessageAdapterPort, exited, terminate: () => { void worker.terminate() } }\n  }\n})\nconst peer = await adapter.peer({ self: { name: 'parent', instanceId: 'parent-1' }, spawn: new URL('./worker.js', import.meta.url) })\ntry { console.log(await peer.request('double', 21)) }\nfinally { await peer.close() }",
        zh: "// worker.ts\nimport { parentPort } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nif (!parentPort) throw new Error('worker port required')\nconst adapter = defineMessageAdapter<typeof parentPort>({ open: (port) => port })\nawait adapter.peer({ self: { name: 'worker', instanceId: 'worker-1' }, listen: parentPort, provide: { double: (value: number) => value * 2 } })\n// main.ts\nimport { Worker } from 'node:worker_threads'\nimport { defineMessageAdapter, type IMessageAdapterPort } from '@migaia/rpc-core/adapter'\nconst adapter = defineMessageAdapter<URL>({\n  open: () => { throw new Error('spawn uses launch') },\n  launch: async (url) => {\n    const worker = new Worker(url)\n    const exited = new Promise<number>((resolve) => worker.once('exit', resolve))\n    return { port: worker as IMessageAdapterPort, exited, terminate: () => { void worker.terminate() } }\n  }\n})\nconst peer = await adapter.peer({ self: { name: 'parent', instanceId: 'parent-1' }, spawn: new URL('./worker.js', import.meta.url) })\ntry { console.log(await peer.request('double', 21)) }\nfinally { await peer.close() }"
      },
      result: {
        en: 'Prints 42. Closing the peer requests worker termination and joins the original exit event. The worker JavaScript file must be emitted alongside main.',
        zh: '输出 42；关闭对端时请求终止线程，并等待原始退出事件。须将工作者 JavaScript 文件与主文件一起生成。'
      },
      covers: ['open', 'launch']
    }
  ],
  defineByteAdapter: [
    {
      title: {
        en: 'Use actual TCP I/O with the canonical byte handshake',
        zh: '用真实 TCP 读写进入规范字节握手'
      },
      problem: {
        en: 'A custom TCP deployment owns ordered socket I/O. The adapter returns raw writes and listeners; Core retains framing, JSON negotiation and runtime methods.',
        zh: '自定义 TCP 部署拥有有序套接字读写，适配器仅返回原始写入与监听；分帧、JSON 协商及运行时方法仍由 Core 处理。'
      },
      example:
        "import { createServer, connect as connectSocket, type Socket } from 'node:net'\nimport { defineByteAdapter } from '@migaia/rpc-core/adapter'\nfunction raw(socket: Socket) {\n  return {\n    kind: 'byte' as const,\n    write: (chunk: Uint8Array) => new Promise<void>((resolve, reject) => { socket.write(chunk, (error) => error ? reject(error) : resolve()) }),\n    onData: (listener: (chunk: Uint8Array) => void) => { socket.on('data', listener); return () => { socket.off('data', listener) } },\n    onClose: (listener: (reason?: unknown) => void) => { const closed = () => listener(); socket.on('close', closed); return () => { socket.off('close', closed) } },\n    close: () => { socket.destroy() }\n  }\n}\nlet accepted!: (socket: Socket) => void\nconst incoming = new Promise<Socket>((resolve) => { accepted = resolve })\nconst server = createServer(accepted)\nawait new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })\nconst address = server.address()\nif (!address || typeof address === 'string') throw new Error('TCP address required')\nconst client = connectSocket(address.port, '127.0.0.1')\nawait new Promise<void>((resolve) => client.once('connect', resolve))\nconst remote = await incoming\nconst adapter = defineByteAdapter<Socket>({\n  open: raw, listen: raw, dial: raw,\n  presentation: { platform: 'Process', expectedStringText: 'TCP frame must contain text' },\n  diagnostics: {\n    closed: { source: 'app/tcp', code: 'CLOSED', message: 'TCP closed' },\n    timeout: { source: 'app/tcp', code: 'TIMEOUT', message: 'TCP handshake expired' },\n    authenticationRejected: { source: 'app/tcp', code: 'AUTH', message: 'TCP authentication refused' },\n    duplicateBinding: 'TCP binding exists', optionsInvalid: 'Invalid TCP options', jsonCodecRequired: 'JSON required', negotiatedCodecUnsupported: 'Codec unsupported', handshakeTimeoutInvalid: 'Invalid handshake budget'\n  }\n})\nconst [a, b] = await Promise.all([\n  adapter.peer({ self: { name: 'a', instanceId: 'a-1' }, connect: client, peerId: 'b-1' }),\n  adapter.peer({ self: { name: 'b', instanceId: 'b-1' }, listen: remote, peerId: 'a-1', provide: { double: (value: number) => value * 2 } })\n])\ntry { console.log(await a.request('double', 21)) }\nfinally { await a.close(); await b.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }",
      result: {
        en: 'Prints 42 over the loopback TCP pair. Peer cleanup closes each socket before the local listener closes. Presentation and diagnostic labels grant no capabilities.',
        zh: '通过回环 TCP 通道对输出 42；对端清理先关闭套接字，再关闭本地监听器。展示和诊断标签不授予能力。'
      },
      covers: [
        'open',
        'listen',
        'dial',
        'diagnostics',
        'presentation',
        'presentation.platform',
        'presentation.expectedStringText'
      ]
    },
    {
      title: {
        en: 'Reuse raw opening for an initiating byte source',
        zh: '主动字节来源复用原始打开操作'
      },
      problem: {
        en: 'When the application uses spawn as the source mode, byte opening uses open. The application has already established the concrete local socket pair.',
        zh: '应用选择 spawn 来源模式时，字节打开使用 open；本例应用已建立具体本地套接字对。'
      },
      example:
        "import { createServer, connect as connectSocket, type Socket } from 'node:net'\nimport { defineByteAdapter } from '@migaia/rpc-core/adapter'\nfunction raw(socket: Socket) {\n  return {\n    kind: 'byte' as const,\n    write: (chunk: Uint8Array) => new Promise<void>((resolve, reject) => { socket.write(chunk, (error) => error ? reject(error) : resolve()) }),\n    onData: (listener: (chunk: Uint8Array) => void) => { socket.on('data', listener); return () => { socket.off('data', listener) } },\n    onClose: (listener: (reason?: unknown) => void) => { const closed = () => listener(); socket.on('close', closed); return () => { socket.off('close', closed) } },\n    close: () => { socket.destroy() }\n  }\n}\nlet accepted!: (socket: Socket) => void\nconst incoming = new Promise<Socket>((resolve) => { accepted = resolve })\nconst server = createServer(accepted)\nawait new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })\nconst address = server.address()\nif (!address || typeof address === 'string') throw new Error('TCP address required')\nconst client = connectSocket(address.port, '127.0.0.1')\nawait new Promise<void>((resolve) => client.once('connect', resolve))\nconst remote = await incoming\nconst adapter = defineByteAdapter<Socket>({\n  open: raw, listen: raw, dial: raw,\n  presentation: { platform: 'Process', expectedStringText: 'TCP frame must contain text' },\n  diagnostics: {\n    closed: { source: 'app/tcp', code: 'CLOSED', message: 'TCP closed' },\n    timeout: { source: 'app/tcp', code: 'TIMEOUT', message: 'TCP handshake expired' },\n    authenticationRejected: { source: 'app/tcp', code: 'AUTH', message: 'TCP authentication refused' },\n    duplicateBinding: 'TCP binding exists', optionsInvalid: 'Invalid TCP options', jsonCodecRequired: 'JSON required', negotiatedCodecUnsupported: 'Codec unsupported', handshakeTimeoutInvalid: 'Invalid handshake budget'\n  }\n})\nconst [a, b] = await Promise.all([\n  adapter.peer({ self: { name: 'a', instanceId: 'a-1' }, spawn: client, peerId: 'b-1' }),\n  adapter.peer({ self: { name: 'b', instanceId: 'b-1' }, listen: remote, peerId: 'a-1', provide: { double: (value: number) => value * 2 } })\n])\ntry { console.log(await a.request('double', 21)) }\nfinally { await a.close(); await b.close(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }",
      result: {
        en: 'Prints 42. open handles the initiating source while listen handles the accepted socket; no process launch is implied by the source name.',
        zh: '输出 42；open 处理主动来源，listen 处理已接受套接字，来源名称本身不会启动进程。'
      },
      covers: [
        'open',
        'listen',
        'dial',
        'diagnostics',
        'presentation',
        'presentation.platform',
        'presentation.expectedStringText'
      ]
    }
  ],
  createRuntimePeer: [
    {
      title: {
        en: 'Call a genuine source with quotas and diagnostics',
        zh: '通过真实来源调用并配置限额与诊断'
      },
      problem: {
        en: 'A platform adapter has actual ports and known direct addresses. Pass each preparation’s own capability offer into the public channel constructor and let it complete bilateral admission.',
        zh: '平台适配器拥有真实端口和明确直连地址，把每次准备自己的能力提议传给公开通道构造器，由其完成双端准入。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createRuntimePeer, normalizeRemoteContract } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nconst { port1, port2 } = new MessageChannel()\nconst failures: unknown[] = []\nlet keyReads = 0\nlet retryReads = 0\nconst observed: unknown[] = []\nconst probe = defineProbe({ stages: ['message'], emit: (event) => { observed.push(snapshotProbeEvent(event)) } })\nconst contract = normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } } })\nconst [a, b] = await Promise.all([\n  createRuntimePeer({ self: { name: 'a', instanceId: 'a-1' }, connect: async (context) => createNodeThreadChannel(port1, 'b-1', { scheduler: systemScheduler, capabilities: context.capabilities }), defaultTimeoutMs: 2000, probe, report: (error) => { failures.push(error) }, keyFactory: () => { keyReads++; return 'local-key' }, retryPort: { dispatch: (input) => { retryReads++; return input.sendOnce({ expectedGeneration: input.generation, key: input.key }) } } }),\n  createRuntimePeer({ self: { name: 'math', instanceId: 'b-1' }, listen: async (context) => createNodeThreadChannel(port2, 'a-1', { scheduler: systemScheduler, capabilities: context.capabilities }), provide: { math: { calc: { double: (value: number) => value * 2 } } }, contract, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, report: (error) => { failures.push(error) } })\n])\ntry { console.log(await a.request('math.calc.double', 21)); console.log(observed.length > 0, failures.length); console.log(keyReads, retryReads) }\nfinally { await a.close(); await b.close(); port1.close(); port2.close() }",
      result: {
        en: 'Prints 42 and true 0: actual runtime dispatch succeeds, a probe observes messages, and no background failures are reported. Direct Peer requests do not consult inherited keyFactory. The final 0 0 confirms that direct Peer dispatch does not read inherited keyFactory or retryPort.',
        zh: '输出 42 和 true 0；真实运行时派发成功，探针观察到消息，未报告后台失败。直接 Peer 请求不会调用继承的 keyFactory。 最后的 0 0 确认直接 Peer 派发未读取继承的 keyFactory 或 retryPort。'
      },
      covers: [
        'self',
        'provide',
        'connect',
        'listen',
        'providerLimits',
        'probe',
        'defaultTimeoutMs',
        'contract',
        'report',
        'keyFactory',
        'retryPort'
      ]
    },
    {
      title: {
        en: 'Use an application-owned source opener',
        zh: '使用应用拥有的来源打开操作'
      },
      problem: {
        en: 'The source callback owns acquisition of this real channel. Selecting spawn changes which callback Core invokes; it does not itself manufacture an execution unit.',
        zh: '来源回调负责取得这条真实通道。选择 spawn 改变 Core 调用的回调，本身不制造执行单元。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createRuntimePeer, normalizeRemoteContract } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nconst { port1, port2 } = new MessageChannel()\nconst failures: unknown[] = []\nlet keyReads = 0\nlet retryReads = 0\nconst observed: unknown[] = []\nconst probe = defineProbe({ stages: ['message'], emit: (event) => { observed.push(snapshotProbeEvent(event)) } })\nconst contract = normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } } })\nconst [a, b] = await Promise.all([\n  createRuntimePeer({ self: { name: 'a', instanceId: 'a-1' }, spawn: async (context) => createNodeThreadChannel(port1, 'b-1', { scheduler: systemScheduler, capabilities: context.capabilities }), defaultTimeoutMs: 2000, probe, report: (error) => { failures.push(error) }, keyFactory: () => { keyReads++; return 'local-key' }, retryPort: { dispatch: (input) => { retryReads++; return input.sendOnce({ expectedGeneration: input.generation, key: input.key }) } } }),\n  createRuntimePeer({ self: { name: 'math', instanceId: 'b-1' }, listen: async (context) => createNodeThreadChannel(port2, 'a-1', { scheduler: systemScheduler, capabilities: context.capabilities }), provide: { math: { calc: { double: (value: number) => value * 2 } } }, contract, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, report: (error) => { failures.push(error) } })\n])\ntry { console.log(await a.request('math.calc.double', 21)); console.log(observed.length > 0, failures.length); console.log(keyReads, retryReads) }\nfinally { await a.close(); await b.close(); port1.close(); port2.close() }",
      result: {
        en: 'Prints 42 and true 0 through the actual port pair. The application still closes its borrowed native ports. The final 0 0 confirms that direct Peer dispatch does not read inherited keyFactory or retryPort.',
        zh: '通过真实端口对输出 42 和 true 0；应用仍负责关闭借入原生端口。 最后的 0 0 确认直接 Peer 派发未读取继承的 keyFactory 或 retryPort。'
      },
      covers: [
        'self',
        'provide',
        'spawn',
        'listen',
        'providerLimits',
        'probe',
        'defaultTimeoutMs',
        'contract',
        'report',
        'keyFactory',
        'retryPort'
      ]
    },
    {
      title: {
        en: 'Authenticate the runtime frame pipeline',
        zh: '认证运行时消息管线'
      },
      problem: {
        en: 'Both actual peers use the same complete signing and encryption configuration. The channel negotiation still derives capabilities from each original preparation.',
        zh: '两个真实对端使用相同完整签名与加密配置，通道协商仍从各次原始准备派生能力。'
      },
      example:
        "import { type IRpcAuthenticationConfig } from '@migaia/rpc-core'\nimport { MessageChannel } from 'node:worker_threads'\nimport { createRuntimePeer, normalizeRemoteContract } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder()\nconst hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])\nconst aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])\nconst protection: IRpcAuthenticationConfig = {\n  encrypt: async (value) => {\n    const iv = crypto.getRandomValues(new Uint8Array(12))\n    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(JSON.stringify(value)))\n    return { iv: Array.from(iv), body: Array.from(new Uint8Array(body)) }\n  },\n  decrypt: async (value) => {\n    const encrypted = value as { iv: number[]; body: number[] }\n    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) }, aes, new Uint8Array(encrypted.body))\n    return JSON.parse(decoder.decode(body))\n  },\n  encodedType: 'string',\n  sign: async (value) => {\n    const text = JSON.stringify(value)\n    const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))\n    return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })\n  },\n  verify: async (value) => {\n    const signed = JSON.parse(String(value)) as { text: string; mac: number[] }\n    if (!await crypto.subtle.verify('HMAC', hmac, new Uint8Array(signed.mac), encoder.encode(signed.text))) throw new Error('Invalid signature')\n    return JSON.parse(signed.text)\n  }\n}\nconst { port1, port2 } = new MessageChannel()\nconst failures: unknown[] = []\nlet keyReads = 0\nlet retryReads = 0\nconst observed: unknown[] = []\nconst probe = defineProbe({ stages: ['message'], emit: (event) => { observed.push(snapshotProbeEvent(event)) } })\nconst contract = normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } } })\nconst [a, b] = await Promise.all([\n  createRuntimePeer({ authentication: protection, self: { name: 'a', instanceId: 'a-1' }, connect: async (context) => createNodeThreadChannel(port1, 'b-1', { scheduler: systemScheduler, capabilities: context.capabilities }), defaultTimeoutMs: 2000, probe, report: (error) => { failures.push(error) }, keyFactory: () => { keyReads++; return 'local-key' }, retryPort: { dispatch: (input) => { retryReads++; return input.sendOnce({ expectedGeneration: input.generation, key: input.key }) } } }),\n  createRuntimePeer({ authentication: protection, self: { name: 'math', instanceId: 'b-1' }, listen: async (context) => createNodeThreadChannel(port2, 'a-1', { scheduler: systemScheduler, capabilities: context.capabilities }), provide: { math: { calc: { double: (value: number) => value * 2 } } }, contract, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, report: (error) => { failures.push(error) } })\n])\ntry { console.log(await a.request('math.calc.double', 21)); console.log(observed.length > 0, failures.length); console.log(keyReads, retryReads) }\nfinally { await a.close(); await b.close(); port1.close(); port2.close() }",
      result: {
        en: 'Prints 42 and true 0 over the protected pipeline. Ephemeral local keys are used only for this local example; real deployments own authenticated key distribution. The final 0 0 confirms that direct Peer dispatch does not read inherited keyFactory or retryPort.',
        zh: '通过受保护管线输出 42 和 true 0。本地示例只使用临时密钥，真实部署自行负责可信密钥分发。 最后的 0 0 确认直接 Peer 派发未读取继承的 keyFactory 或 retryPort。'
      },
      covers: [
        'authentication',
        'authentication.encrypt',
        'authentication.decrypt',
        'authentication.sign',
        'authentication.verify',
        'authentication.encodedType'
      ]
    },
    {
      title: {
        en: 'Reject an unavailable custom endpoint after channel acquisition',
        zh: '取得通道后拒绝不可用的自定义端点'
      },
      problem: {
        en: 'An advanced endpoint factory cannot supply its application runtime. Throw the original failure after the actual bilateral channel opens; Core rolls back the acquired channel.',
        zh: '高级端点工厂无法提供应用运行时，在真实双端通道打开后抛出原始失败，由 Core 回滚已取得通道。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createRuntimePeer } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nconst { port1, port2 } = new MessageChannel()\nconst unavailable = new Error('application endpoint unavailable')\nconst results = await Promise.allSettled([\n  createRuntimePeer({ self: { name: 'a', instanceId: 'a-1' }, connect: async (context) => createNodeThreadChannel(port1, 'b-1', { scheduler: systemScheduler, capabilities: context.capabilities }), endpointFactory: async () => { throw unavailable }, report: () => undefined }),\n  createRuntimePeer({ self: { name: 'b', instanceId: 'b-1' }, listen: async (context) => createNodeThreadChannel(port2, 'a-1', { scheduler: systemScheduler, capabilities: context.capabilities }), defaultTimeoutMs: 100, report: () => undefined })\n])\nconsole.log(results[0]?.status === 'rejected' && results[0].reason === unavailable)\nfor (const result of results) if (result.status === 'fulfilled') await result.value.close()\nport1.close(); port2.close()",
      result: {
        en: 'Prints true. The custom construction failure retains its identity; the opposite preparation settles separately. The application closes both native ports.',
        zh: '输出 true；自定义构造失败保留身份，另一端准备独立完成结算，应用关闭两个原生端口。'
      },
      covers: ['endpointFactory']
    }
  ],
  createRuntimeApiEndpoint: [
    {
      title: {
        en: 'Install a complete endpoint before accepting calls',
        zh: '接收调用前完整安装端点'
      },
      problem: {
        en: 'A service must be ready with its provider and pipeline as one construction batch. Use the caller-owned scheduler and transport consistently.',
        zh: '服务要在同一次构造中备齐处理函数与管线；调度器和传输对象由调用者提供并一致复用。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createRuntimeApiEndpoint, createEndpoint, connect, type IRpcFactoryConfig } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst channel = { peerId: 'client', transport: right, agreement: { capabilities: [] } }\nconst server = createRuntimeApiEndpoint({\n  id: 'server', scheduler: systemScheduler, wallClock: { timestamp: () => 1700000000000 },\n  protocol: rpcProtocol, codec: identityCodec as NonNullable<IRpcFactoryConfig['codec']>, framer: messageFramerV1,\n  transport: right,\n  provider: { double: (context) => context.success((context.data as number) * 2) },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 },\n  replay: { maxEntries: 64, ttlMs: 1000 },\n  construction: { signal: controller.signal, timeoutMs: 1000 },\n  middlewares: [connect({ transport: right })], features: []\n}, channel)\nawait server.ready\nconst client = await createClientEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })\ntry { console.log(await client.send('server', 'double', 21)) }\nfinally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 42. Explicit protocol, codec, framer, provider limits and replay limits are active before construction returns; the borrowed memory pair is closed by its creator.',
        zh: '输出 42。构造返回前已安装协议、编解码、帧处理、提供方限额和重放限额；借入的内存通道由创建者关闭。'
      },
      covers: [
        'id',
        'scheduler',
        'wallClock',
        'transport',
        'protocol',
        'codec',
        'framer',
        'targetIds',
        'provider',
        'providerLimits',
        'replay',
        'replay.maxEntries',
        'replay.ttlMs',
        'middlewares',
        'features',
        'construction',
        'construction.signal',
        'construction.timeoutMs'
      ]
    },
    {
      title: {
        en: 'Reuse one outcome for a retried save',
        zh: '重复保存复用同一结果'
      },
      problem: {
        en: 'A retry of the same operation must not execute the provider twice. Supply one real store and derive its scope from the admitted session token.',
        zh: '同一操作重试时不能重复执行处理函数；传入真实存储，并从准入会话令牌派生作用域。'
      },
      example:
        "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createRuntimeApiEndpoint, createEndpoint, connect, createRpcIdempotencyStore } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nlet calls = 0\nconst store = createRpcIdempotencyStore({ retentionMs: 30000, maxEntries: 16, maxEntriesPerScope: 8, maxBytes: 4096, maxOutcomeBytes: 1024 })\nconst channel = { peerId: 'client', transport: right, agreement: { capabilities: [] } }\nconst server = createRuntimeApiEndpoint({\n id: 'server', transport: right,\n idempotency: { store, scope: ({ token }) => token },\n provider: { count: (context) => context.success(++calls) },\n middlewares: [connect({ transport: right })]\n}, channel)\nawait server.ready\nconst client = await createClientEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })\ntry {\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }))\n console.log(await client.send('server', 'count', null, { idempotencyKey: 'save-1' }), calls)\n} finally { await client.dispose(); await server.dispose(); left.close() }",
      result: {
        en: 'Prints 1 and then 1 1: both calls receive one retained outcome, and the provider runs once. The application reuses the same key only for the same operation.',
        zh: '先输出 1，再输出 1 1；两次调用取得同一保留结果，处理函数仅执行一次。应用只为同一操作复用该键。'
      },
      covers: ['idempotency', 'idempotency.store', 'idempotency.scope']
    },
    {
      title: {
        en: 'Cancel construction before acquiring resources',
        zh: '取得资源前取消构造'
      },
      problem: {
        en: 'The caller has already abandoned the operation. Pass its native signal and explicitly disable a separate construction deadline.',
        zh: '调用者已放弃本次操作，传入原生信号，并明确关闭另设的构造期限。'
      },
      example:
        "import { createRuntimeApiEndpoint, createEndpoint, connect } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\n\nconst [left, right] = createMemoryTransportPair()\nconst controller = new AbortController()\nconst reason = new Error('request ended')\ncontroller.abort(reason)\ntry {\n await createRuntimeApiEndpoint({ id: 'cancelled', transport: left, middlewares: [connect({ transport: left })], construction: { signal: controller.signal, timeoutMs: false } }, { peerId: 'server', transport: left, agreement: { capabilities: [] } }).ready\n} catch (error) { console.log((error as Error).name, (error as { code: string }).code, (error as Error).cause === reason) }\nfinally { left.close() }",
      result: {
        en: 'Prints AbortError CANCELLED true: construction rejects and preserves the original cancellation reason on cause. No endpoint is returned.',
        zh: '输出 AbortError CANCELLED true；构造拒绝，并在 cause 保留原取消原因，不返回端点。'
      },
      covers: ['construction', 'construction.signal', 'construction.timeoutMs']
    },
    {
      title: {
        en: 'Forward operations already held by a real peer',
        zh: '转发真实对端已经持有的操作'
      },
      problem: {
        en: 'A consumer needs a runtime endpoint facade around an already-ready Peer. Forward only that Peer’s actual request, notify, stream and close operations.',
        zh: '使用者需要在已就绪 Peer 外提供运行端点外观，仅转发该对端真实请求、通知、流与关闭操作。'
      },
      example:
        "import { createRuntimeApiEndpoint } from '@migaia/rpc-core'\nimport { createPeerPair } from '@migaia/rpc-core/testing'\nconst pair = await createPeerPair({ a: { provide: {} }, b: { provide: { double: (value: number) => value * 2 } } })\nconst endpoint = createRuntimeApiEndpoint({ binding: {\n  ready: Promise.resolve(), request: pair.a.request, notify: pair.a.notify,\n  stream: { open: pair.a.stream }, dispose: pair.a.close\n} })\ntry { await endpoint.ready; console.log(await endpoint.request('double', 21)) }\nfinally { await endpoint.dispose(); await pair.b.close() }",
      result: {
        en: 'Prints 42. The Peer pair has completed construction before the resolved ready value is supplied; facade disposal invokes its held close operation.',
        zh: '输出 42；传入已完成 ready 值前，Peer 对已完成构造。外观释放调用其持有的关闭操作。'
      },
      covers: ['binding']
    }
  ],
  createStreamFeature: [
    {
      title: {
        en: 'Restrict streams using the original channel agreement',
        zh: '按原通道约定限制流'
      },
      problem: {
        en: 'The application has an actual fixed-profile Thread channel. Project its real accepted stream availability into the feature’s predicate instead of inventing capability flags.',
        zh: '应用拥有真实固定配置线程通道，从通道约定投影出流可用性作为功能判定，不自行编造能力标记。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createCanonicalChunkFeature, createStreamFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nconst { port1, port2 } = new MessageChannel()\nconst a = await createNodeThreadChannel(port1, 'server', { scheduler: systemScheduler, capabilities: [RpcCapability.stream] })\nconst b = await createNodeThreadChannel(port2, 'client', { scheduler: systemScheduler, capabilities: [RpcCapability.stream] })\nfunction roots(channel: Awaited<ReturnType<typeof createNodeThreadChannel>>) {\n  const chunk = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunk)\n  const provider = createProviderFeature(outbound)\n  const capability = { supports: (peerId: string) => peerId === channel.peerId && channel.agreement.capabilities.includes(RpcCapability.stream) }\n  return { ...Object.fromEntries(channel.features.map((feature, index) => [`channel-${index}`, feature])), 'first-party-chunk': chunk, 'first-party-outbound': outbound, 'first-party-provider': provider, 'first-party-stream': createStreamFeature(outbound, provider, { capability }) }\n}\nconst server = await createComposedEndpoint({ id: 'server', transport: b.transport, ...b.pipeline, middlewares: [connect({ transport: b.transport })] }, roots(b))\nconst client = await createComposedEndpoint({ id: 'client', transport: a.transport, ...a.pipeline, middlewares: [connect({ transport: a.transport })] }, roots(a))\nconst off = server.stream.provide('numbers', function* () { yield 1; yield 2 })\ntry { for await (const value of client.stream.open('server', 'numbers', null)) console.log(value) }\nfinally { off(); await client.dispose(); await server.dispose(); await a.close(); await b.close(); port1.close(); port2.close() }",
      result: {
        en: 'Prints 1 then 2. The capability callback checks both the original peer address and that channel’s actual stream policy.',
        zh: '先输出 1，再输出 2；能力回调同时检查原始对端地址及通道的真实流策略。'
      },
      covers: ['capability']
    },
    {
      title: {
        en: 'Refuse a stream absent from the actual profile',
        zh: '拒绝真实配置未提供的流'
      },
      problem: {
        en: 'The same application selects the empty static profile at both physical ends. Its predicate reads that actual absence and refuses opening a stream.',
        zh: '同一应用在两个物理端选择空静态配置，判定函数读取实际缺失并拒绝打开流。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { connect } from '@migaia/rpc-core'\nimport { createComposedEndpoint } from '@migaia/rpc-core/composed'\nimport { createCanonicalChunkFeature, createStreamFeature } from '@migaia/rpc-core/stream'\nimport { createOutboundFeature } from '@migaia/rpc-core/features/outbound'\nimport { createProviderFeature } from '@migaia/rpc-core/features/provider'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nconst { port1, port2 } = new MessageChannel()\nconst a = await createNodeThreadChannel(port1, 'server', { scheduler: systemScheduler, capabilities: [] })\nconst b = await createNodeThreadChannel(port2, 'client', { scheduler: systemScheduler, capabilities: [] })\nfunction roots(channel: Awaited<ReturnType<typeof createNodeThreadChannel>>) {\n  const chunk = createCanonicalChunkFeature()\n  const outbound = createOutboundFeature(chunk)\n  const provider = createProviderFeature(outbound)\n  const capability = { supports: (peerId: string) => peerId === channel.peerId && channel.agreement.capabilities.includes(RpcCapability.stream) }\n  return { ...Object.fromEntries(channel.features.map((feature, index) => [`channel-${index}`, feature])), 'first-party-chunk': chunk, 'first-party-outbound': outbound, 'first-party-provider': provider, 'first-party-stream': createStreamFeature(outbound, provider, { capability }) }\n}\nconst server = await createComposedEndpoint({ id: 'server', transport: b.transport, ...b.pipeline, middlewares: [connect({ transport: b.transport })] }, roots(b))\nconst client = await createComposedEndpoint({ id: 'client', transport: a.transport, ...a.pipeline, middlewares: [connect({ transport: a.transport })] }, roots(a))\nconst off = server.stream.provide('numbers', function* () { yield 1; yield 2 })\ntry { for await (const value of client.stream.open('server', 'numbers', null)) console.log(value) } catch (error) { console.log((error as { code: string }).code) }\nfinally { off(); await client.dispose(); await server.dispose(); await a.close(); await b.close(); port1.close(); port2.close() }",
      result: {
        en: 'Prints CAPABILITY_CONFLICT. The installed stream feature refuses opening when its actual channel predicate reports no stream support.',
        zh: '输出 CAPABILITY_CONFLICT；真实通道判定不支持流时，已安装流功能拒绝打开。'
      },
      covers: ['capability']
    }
  ],
  createRemoteHost: [
    {
      title: {
        en: 'Bound and guard calls to an actual remote Host',
        zh: '对真实远程宿主调用设置上限与准入'
      },
      problem: {
        en: 'The application integration owns a real coroutine supervisor, dedicated memory endpoints and the matching public Host service. Keep deadlines, diagnostics and keys on that same generation owner.',
        zh: '应用集成拥有真实协程监督器、专用内存端点及配套公开宿主服务，将期限、诊断和键留在同一代次所有者。'
      },
      example:
        "import { createLegacyIntegration } from './app-legacy.js'\nimport { createRemoteHost, createRemoteRetryPort } from '@migaia/rpc-core/remote'\nconst app = createLegacyIntegration('host')\nlet keys = 0\nlet guarded = 0\nconst remote = createRemoteHost({\n  catalog: app.catalog, binding: app.binding, endpointFactory: app.endpointFactory,\n  report: app.report, keyFactory: () => `save-${++keys}`, callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: () => { guarded++ } },\n  retryPort: { dispatch: (input) => createRemoteRetryPort({ events: input.events, scheduler: app.scheduler, report: app.report }).dispatch(input) }\n})\ntry {\n  await remote.ready()\n  const features = await remote.use('math')\n  console.log(await features.api!.double!([21]))\n  console.log(keys > 0, guarded > 0)\n} finally { await remote.release(); await app.close() }",
      result: {
        en: 'Prints 42 and true true. The automatic key and pre-dispatch guard run on actual logical calls; the retry port uses that dispatch’s original generation events.',
        zh: '输出 42 和 true true；实际逻辑调用执行自动键工厂与派发前检查，重试端口使用本次派发原始代次事件。'
      },
      covers: [
        'catalog',
        'binding',
        'endpointFactory',
        'report',
        'keyFactory',
        'retryPort',
        'callDeadlineCapMs',
        'callGuard'
      ]
    },
    {
      title: {
        en: 'Refuse one remote method before dispatch',
        zh: '派发前拒绝某个远程方法'
      },
      problem: {
        en: 'The application integration owns a real coroutine supervisor, dedicated memory endpoints and the matching public Host service. Keep deadlines, diagnostics and keys on that same generation owner.',
        zh: '应用集成拥有真实协程监督器、专用内存端点及配套公开宿主服务，将期限、诊断和键留在同一代次所有者。'
      },
      example:
        "import { createLegacyIntegration } from './app-legacy.js'\nimport { createRemoteHost, createRemoteRetryPort } from '@migaia/rpc-core/remote'\nconst app = createLegacyIntegration('host')\nlet keys = 0\nlet guarded = 0\nconst remote = createRemoteHost({\n  catalog: app.catalog, binding: app.binding, endpointFactory: app.endpointFactory,\n  report: app.report, keyFactory: () => `save-${++keys}`, callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: ({ method }) => { guarded++; if (method === 'math.api.double') throw new Error('save paused') } },\n  retryPort: { dispatch: (input) => createRemoteRetryPort({ events: input.events, scheduler: app.scheduler, report: app.report }).dispatch(input) }\n})\ntry {\n  await remote.ready()\n  const features = await remote.use('math')\n  try { await features.api!.double!([21]) } catch (error) { console.log((error as Error).message) }\n  console.log(keys > 0, guarded > 0)\n} finally { await remote.release(); await app.close() }",
      result: {
        en: 'Prints save paused and true true. The local guard prevents that method from entering the generation send path.',
        zh: '输出 save paused 和 true true；本地检查阻止该方法进入代次发送路径。'
      },
      covers: [
        'catalog',
        'binding',
        'endpointFactory',
        'report',
        'keyFactory',
        'retryPort',
        'callDeadlineCapMs',
        'callGuard'
      ]
    }
  ],
  createRemotePlugin: [
    {
      title: {
        en: 'Install a proxy through the actual local Host',
        zh: '通过真实本地宿主安装代理'
      },
      problem: {
        en: 'The application integration serves an adopted math plugin on its supervised endpoint. The local proxy uses the actual local Host enablement port.',
        zh: '应用集成在受监督端点服务已采用的 math 插件，本地代理使用实际本地宿主启停端口。'
      },
      example:
        "import { createLegacyIntegration } from './app-legacy.js'\nimport { createRemotePlugin, createRemoteRetryPort } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\nconst app = createLegacyIntegration('plugin')\nconst host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nlet keys = 0\nconst plugin = createRemotePlugin({\n  name: 'math', contract: app.contract, host: host.plugin,\n  binding: app.binding, endpointFactory: app.endpointFactory, report: app.report,\n  keyFactory: () => `save-${++keys}`, callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: () => undefined },\n  retryPort: { dispatch: (input) => createRemoteRetryPort({ events: input.events, scheduler: app.scheduler, report: app.report }).dispatch(input) }\n})\ntry {\n  const [handle] = await host.use(plugin)\n  const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n  console.log(await api.double([21]), keys > 0)\n} finally { await host.dispose(); await app.close() }",
      result: {
        en: 'Prints 42 true. The declared idempotent method receives an automatically generated key and the actual result crosses both endpoint factories.',
        zh: '输出 42 true；声明幂等的方法获得自动生成键，实际结果经过双端端点工厂。'
      },
      covers: [
        'name',
        'contract',
        'host',
        'binding',
        'endpointFactory',
        'report',
        'keyFactory',
        'retryPort',
        'callDeadlineCapMs',
        'callGuard'
      ]
    },
    {
      title: {
        en: 'Preserve a rejected proxy admission reason',
        zh: '保留代理准入拒绝原因'
      },
      problem: {
        en: 'The same real proxy should refuse a paused operation before sending it. A local guard owns this decision.',
        zh: '同一真实代理应在发送前拒绝已暂停操作，该决定由本地检查负责。'
      },
      example:
        "import { createLegacyIntegration } from './app-legacy.js'\nimport { createRemotePlugin, createRemoteRetryPort } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\nconst app = createLegacyIntegration('plugin')\nconst host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nlet keys = 0\nconst plugin = createRemotePlugin({\n  name: 'math', contract: app.contract, host: host.plugin,\n  binding: app.binding, endpointFactory: app.endpointFactory, report: app.report,\n  keyFactory: () => `save-${++keys}`, callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: () => { throw new Error('save paused') } },\n  retryPort: { dispatch: (input) => createRemoteRetryPort({ events: input.events, scheduler: app.scheduler, report: app.report }).dispatch(input) }\n})\ntry {\n  const [handle] = await host.use(plugin)\n  const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n  try { await api.double([21]) } catch (error) { console.log((error as Error).message) }\n} finally { await host.dispose(); await app.close() }",
      result: {
        en: 'Prints save paused. The guard rejection remains local and the supervised deployment is still released.',
        zh: '输出 save paused；检查拒绝留在本地，受监督部署仍会释放。'
      },
      covers: [
        'name',
        'contract',
        'host',
        'binding',
        'endpointFactory',
        'report',
        'keyFactory',
        'retryPort',
        'callDeadlineCapMs',
        'callGuard'
      ]
    }
  ],
  createRemoteRetryPort: [
    {
      title: {
        en: 'Use original dispatch events for one retry policy',
        zh: '让一次重试策略使用原派发事件'
      },
      problem: {
        en: 'The application integration owns a real coroutine supervisor, dedicated memory endpoints and the matching public Host service. Keep deadlines, diagnostics and keys on that same generation owner.',
        zh: '应用集成拥有真实协程监督器、专用内存端点及配套公开宿主服务，将期限、诊断和键留在同一代次所有者。'
      },
      example:
        "import { createLegacyIntegration } from './app-legacy.js'\nimport { createRemoteHost, createRemoteRetryPort } from '@migaia/rpc-core/remote'\nconst app = createLegacyIntegration('host')\nlet keys = 0\nlet guarded = 0\nconst remote = createRemoteHost({\n  catalog: app.catalog, binding: app.binding, endpointFactory: app.endpointFactory,\n  report: app.report, keyFactory: () => `save-${++keys}`, callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: () => { guarded++ } },\n  retryPort: { dispatch: (input) => createRemoteRetryPort({ events: input.events, scheduler: app.scheduler, report: app.report }).dispatch(input) }\n})\ntry {\n  await remote.ready()\n  const features = await remote.use('math')\n  console.log(await features.api!.double!([21]))\n  console.log(keys > 0, guarded > 0)\n} finally { await remote.release(); await app.close() }",
      result: {
        en: 'Prints 42 and true true. The automatic key and pre-dispatch guard run on actual logical calls; the retry port uses that dispatch’s original generation events.',
        zh: '输出 42 和 true true；实际逻辑调用执行自动键工厂与派发前检查，重试端口使用本次派发原始代次事件。'
      },
      covers: ['events', 'scheduler', 'report']
    },
    {
      title: {
        en: 'Observe generation events from an installed plugin proxy',
        zh: '从已安装插件代理观察代次事件'
      },
      problem: {
        en: 'The application integration serves an adopted math plugin on its supervised endpoint. The local proxy uses the actual local Host enablement port.',
        zh: '应用集成在受监督端点服务已采用的 math 插件，本地代理使用实际本地宿主启停端口。'
      },
      example:
        "import { createLegacyIntegration } from './app-legacy.js'\nimport { createRemotePlugin, createRemoteRetryPort } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\nconst app = createLegacyIntegration('plugin')\nconst host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nlet keys = 0\nconst plugin = createRemotePlugin({\n  name: 'math', contract: app.contract, host: host.plugin,\n  binding: app.binding, endpointFactory: app.endpointFactory, report: app.report,\n  keyFactory: () => `save-${++keys}`, callDeadlineCapMs: 2000,\n  callGuard: { beforeDispatch: () => undefined },\n  retryPort: { dispatch: (input) => createRemoteRetryPort({ events: input.events, scheduler: app.scheduler, report: app.report }).dispatch(input) }\n})\ntry {\n  const [handle] = await host.use(plugin)\n  const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n  console.log(await api.double([21]), keys > 0)\n} finally { await host.dispose(); await app.close() }",
      result: {
        en: 'Prints 42 true. The declared idempotent method receives an automatically generated key and the actual result crosses both endpoint factories.',
        zh: '输出 42 true；声明幂等的方法获得自动生成键，实际结果经过双端端点工厂。'
      },
      covers: ['events', 'scheduler', 'report']
    }
  ],
  serveRemoteHost: [
    {
      title: {
        en: 'Serve the actual local Host over a dedicated endpoint',
        zh: '通过专用端点服务真实本地宿主'
      },
      problem: {
        en: 'A real coroutine task constructs the dedicated endpoint, installs the public service and exposes its client side to the actual generation binding. The task owns cleanup.',
        zh: '真实协程任务构造专用端点、安装公开服务，并把客户端一侧交给实际代次绑定；任务拥有清理。'
      },
      example:
        "import { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { createEndpoint, connect, ping, abort, type IRpcEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createRemoteHost, createRemotePlugin, serveRemoteHost, serveRemotePlugin,\n  type IRemoteBinding, type IRemoteChannel, type IRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst contract: IRemoteContract = { schemaVersion: 1, plugin: 'math', features: { api: {\n  methods: { double: { mode: 'request', idempotent: true } }\n} } }\nconst definition = definePlugin({ name: 'math', features: { api: defineFeature(() => ({ double: (value: number) => value * 2 })) }, install: () => ({}) })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error); console.error(error) }\nconst serverHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nconst hostMode = true\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'math-service', report, scheduler: systemScheduler,\n  budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1 }),\n  restart: { mode: 'never' },\n  spec: { task: async ({ expose, signal }) => {\n    const [clientTransport, serverTransport] = createMemoryTransportPair()\n    const endpoint = await createEndpoint({ id: 'math-server', transport: serverTransport, middlewares: [connect(), ping(), abort()] }) as IRpcEndpoint\n    if (!hostMode) await serverHost.use(definition)\n    const served = hostMode\n      ? await serveRemoteHost({ host: serverHost, catalog: { math: contract }, resolvePlugin: () => definition, endpoint: { endpoint }, report })\n      : await serveRemotePlugin({ host: serverHost, contract, endpoint: { endpoint }, report, invocationContext: (context) => ({ sender: context.senderId }) })\n    expose({ transport: clientTransport, peerId: 'math-server', scheduler: systemScheduler,\n      agreement: { source: 'static', codec: identityCodec.id, capabilities: ['runtime-api@1'] },\n      pipeline: { codec: identityCodec, framer: messageFramerV1 }, features: [], close: async () => { clientTransport.close() }\n    })\n    try { await new Promise<void>((resolve) => {\n      if (signal.aborted) resolve()\n      else signal.addEventListener('abort', () => resolve(), { once: true })\n    }) } finally { await served.close() }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (unit) => unit.exposed\n}\nlet sequence = 0\nconst endpointFactory = async (channel: IRemoteChannel) => ({ endpoint: await createEndpoint({\n  id: 'math-client', transport: channel.transport, protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1, middlewares: [connect(), ping(), abort()]\n}) as IRpcEndpoint })\nif (hostMode) {\n  const client = createRemoteHost({ catalog: { math: contract }, binding, endpointFactory, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    callGuard: { beforeDispatch: ({ method }) => { if (method === 'forbidden') throw new Error('denied') } }\n  })\n  try {\n    await client.ready()\n    const proxy = await client.use('math')\n    console.log(await proxy.api!.double!([21]))\n    console.log(await client.inspect())\n    console.log(await client.unUse('math', { dryRun: true, policy: 'reject' }))\n  } finally { await client.release() }\n} else {\n  const clientHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  const remote = createRemotePlugin({ name: 'math', contract, binding, endpointFactory, host: clientHost.plugin, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    retryPort: { dispatch: (input) => input.sendOnce({ expectedGeneration: input.generation, key: input.key }) }\n  })\n  try {\n    const [handle] = await clientHost.use(remote)\n    const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n    console.log(await api.double([21]))\n  } finally { await clientHost.dispose() }\n}\nawait serverHost.dispose()\nconsole.log(supervisor.state, reports.length)\n",
      result: {
        en: 'Prints 42 and ends with disposed 0. The actual service and supervisor are released without background diagnostics. Host mode also prints its inspect and dry-run removal state.',
        zh: '输出 42，最后为 disposed 0；实际服务与监督器释放后未报告后台诊断。宿主模式还输出检查及移除预览状态。'
      },
      covers: ['host', 'catalog', 'resolvePlugin', 'endpoint', 'report']
    },
    {
      title: {
        en: 'Change the actual adopted implementation without widening its contract',
        zh: '只更换实际采用实现，保留契约范围'
      },
      problem: {
        en: 'The application deploys a different implementation under the same declared method. Service lookup still reads the actual adopted Feature through its Host.',
        zh: '应用在同一声明方法下部署不同实现，服务查找仍通过宿主读取实际已采用功能。'
      },
      example:
        "import { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { createEndpoint, connect, ping, abort, type IRpcEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createRemoteHost, createRemotePlugin, serveRemoteHost, serveRemotePlugin,\n  type IRemoteBinding, type IRemoteChannel, type IRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst contract: IRemoteContract = { schemaVersion: 1, plugin: 'math', features: { api: {\n  methods: { double: { mode: 'request', idempotent: true } }\n} } }\nconst definition = definePlugin({ name: 'math', features: { api: defineFeature(() => ({ double: (value: number) => value * 3 })) }, install: () => ({}) })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error); console.error(error) }\nconst serverHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nconst hostMode = true\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'math-service', report, scheduler: systemScheduler,\n  budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1 }),\n  restart: { mode: 'never' },\n  spec: { task: async ({ expose, signal }) => {\n    const [clientTransport, serverTransport] = createMemoryTransportPair()\n    const endpoint = await createEndpoint({ id: 'math-server', transport: serverTransport, middlewares: [connect(), ping(), abort()] }) as IRpcEndpoint\n    if (!hostMode) await serverHost.use(definition)\n    const served = hostMode\n      ? await serveRemoteHost({ host: serverHost, catalog: { math: contract }, resolvePlugin: () => definition, endpoint: { endpoint }, report })\n      : await serveRemotePlugin({ host: serverHost, contract, endpoint: { endpoint }, report, invocationContext: (context) => ({ sender: context.senderId }) })\n    expose({ transport: clientTransport, peerId: 'math-server', scheduler: systemScheduler,\n      agreement: { source: 'static', codec: identityCodec.id, capabilities: ['runtime-api@1'] },\n      pipeline: { codec: identityCodec, framer: messageFramerV1 }, features: [], close: async () => { clientTransport.close() }\n    })\n    try { await new Promise<void>((resolve) => {\n      if (signal.aborted) resolve()\n      else signal.addEventListener('abort', () => resolve(), { once: true })\n    }) } finally { await served.close() }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (unit) => unit.exposed\n}\nlet sequence = 0\nconst endpointFactory = async (channel: IRemoteChannel) => ({ endpoint: await createEndpoint({\n  id: 'math-client', transport: channel.transport, protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1, middlewares: [connect(), ping(), abort()]\n}) as IRpcEndpoint })\nif (hostMode) {\n  const client = createRemoteHost({ catalog: { math: contract }, binding, endpointFactory, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    callGuard: { beforeDispatch: ({ method }) => { if (method === 'forbidden') throw new Error('denied') } }\n  })\n  try {\n    await client.ready()\n    const proxy = await client.use('math')\n    console.log(await proxy.api!.double!([21]))\n    console.log(await client.inspect())\n    console.log(await client.unUse('math', { dryRun: true, policy: 'reject' }))\n  } finally { await client.release() }\n} else {\n  const clientHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  const remote = createRemotePlugin({ name: 'math', contract, binding, endpointFactory, host: clientHost.plugin, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    retryPort: { dispatch: (input) => input.sendOnce({ expectedGeneration: input.generation, key: input.key }) }\n  })\n  try {\n    const [handle] = await clientHost.use(remote)\n    const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n    console.log(await api.double([21]))\n  } finally { await clientHost.dispose() }\n}\nawait serverHost.dispose()\nconsole.log(supervisor.state, reports.length)\n",
      result: {
        en: 'Prints 63 and ends with disposed 0. Only declared methods are served, and cleanup follows the original task lifetime.',
        zh: '输出 63，最后为 disposed 0；仅服务已声明方法，清理仍随原任务生命周期。'
      },
      covers: ['host', 'catalog', 'resolvePlugin', 'endpoint', 'report']
    }
  ],
  serveRemotePlugin: [
    {
      title: {
        en: 'Serve adopted plugin features over a dedicated endpoint',
        zh: '通过专用端点服务已采用插件功能'
      },
      problem: {
        en: 'A real coroutine task constructs the dedicated endpoint, installs the public service and exposes its client side to the actual generation binding. The task owns cleanup.',
        zh: '真实协程任务构造专用端点、安装公开服务，并把客户端一侧交给实际代次绑定；任务拥有清理。'
      },
      example:
        "import { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { createEndpoint, connect, ping, abort, type IRpcEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createRemoteHost, createRemotePlugin, serveRemoteHost, serveRemotePlugin,\n  type IRemoteBinding, type IRemoteChannel, type IRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst contract: IRemoteContract = { schemaVersion: 1, plugin: 'math', features: { api: {\n  methods: { double: { mode: 'request', idempotent: true } }\n} } }\nconst definition = definePlugin({ name: 'math', features: { api: defineFeature(() => ({ double: (value: number) => value * 2 })) }, install: () => ({}) })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error); console.error(error) }\nconst serverHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nconst hostMode = false\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'math-service', report, scheduler: systemScheduler,\n  budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1 }),\n  restart: { mode: 'never' },\n  spec: { task: async ({ expose, signal }) => {\n    const [clientTransport, serverTransport] = createMemoryTransportPair()\n    const endpoint = await createEndpoint({ id: 'math-server', transport: serverTransport, middlewares: [connect(), ping(), abort()] }) as IRpcEndpoint\n    if (!hostMode) await serverHost.use(definition)\n    const served = hostMode\n      ? await serveRemoteHost({ host: serverHost, catalog: { math: contract }, resolvePlugin: () => definition, endpoint: { endpoint }, report })\n      : await serveRemotePlugin({ host: serverHost, contract, endpoint: { endpoint }, report, invocationContext: (context) => ({ sender: context.senderId }) })\n    expose({ transport: clientTransport, peerId: 'math-server', scheduler: systemScheduler,\n      agreement: { source: 'static', codec: identityCodec.id, capabilities: ['runtime-api@1'] },\n      pipeline: { codec: identityCodec, framer: messageFramerV1 }, features: [], close: async () => { clientTransport.close() }\n    })\n    try { await new Promise<void>((resolve) => {\n      if (signal.aborted) resolve()\n      else signal.addEventListener('abort', () => resolve(), { once: true })\n    }) } finally { await served.close() }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (unit) => unit.exposed\n}\nlet sequence = 0\nconst endpointFactory = async (channel: IRemoteChannel) => ({ endpoint: await createEndpoint({\n  id: 'math-client', transport: channel.transport, protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1, middlewares: [connect(), ping(), abort()]\n}) as IRpcEndpoint })\nif (hostMode) {\n  const client = createRemoteHost({ catalog: { math: contract }, binding, endpointFactory, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    callGuard: { beforeDispatch: ({ method }) => { if (method === 'forbidden') throw new Error('denied') } }\n  })\n  try {\n    await client.ready()\n    const proxy = await client.use('math')\n    console.log(await proxy.api!.double!([21]))\n    console.log(await client.inspect())\n    console.log(await client.unUse('math', { dryRun: true, policy: 'reject' }))\n  } finally { await client.release() }\n} else {\n  const clientHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  const remote = createRemotePlugin({ name: 'math', contract, binding, endpointFactory, host: clientHost.plugin, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    retryPort: { dispatch: (input) => input.sendOnce({ expectedGeneration: input.generation, key: input.key }) }\n  })\n  try {\n    const [handle] = await clientHost.use(remote)\n    const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n    console.log(await api.double([21]))\n  } finally { await clientHost.dispose() }\n}\nawait serverHost.dispose()\nconsole.log(supervisor.state, reports.length)\n",
      result: {
        en: 'Prints 42 and ends with disposed 0. The actual service and supervisor are released without background diagnostics. Host mode also prints its inspect and dry-run removal state.',
        zh: '输出 42，最后为 disposed 0；实际服务与监督器释放后未报告后台诊断。宿主模式还输出检查及移除预览状态。'
      },
      covers: ['host', 'contract', 'endpoint', 'report', 'invocationContext']
    },
    {
      title: {
        en: 'Change the actual adopted implementation without widening its contract',
        zh: '只更换实际采用实现，保留契约范围'
      },
      problem: {
        en: 'The application deploys a different implementation under the same declared method. Service lookup still reads the actual adopted Feature through its Host.',
        zh: '应用在同一声明方法下部署不同实现，服务查找仍通过宿主读取实际已采用功能。'
      },
      example:
        "import { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { systemScheduler } from '@migaia/utils/scheduler'\nimport { identityCodec } from '@migaia/serialize/codecs/identity/v1'\nimport { rpcProtocol } from '@migaia/rpc-contract/v1'\nimport { messageFramerV1 } from '@migaia/rpc-contract/framing'\nimport { createEndpoint, connect, ping, abort, type IRpcEndpoint } from '@migaia/rpc-core'\nimport { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'\nimport { createRemoteHost, createRemotePlugin, serveRemoteHost, serveRemotePlugin,\n  type IRemoteBinding, type IRemoteChannel, type IRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\n\nconst contract: IRemoteContract = { schemaVersion: 1, plugin: 'math', features: { api: {\n  methods: { double: { mode: 'request', idempotent: true } }\n} } }\nconst definition = definePlugin({ name: 'math', features: { api: defineFeature(() => ({ double: (value: number) => value * 3 })) }, install: () => ({}) })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error); console.error(error) }\nconst serverHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nconst hostMode = false\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'math-service', report, scheduler: systemScheduler,\n  budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1 }),\n  restart: { mode: 'never' },\n  spec: { task: async ({ expose, signal }) => {\n    const [clientTransport, serverTransport] = createMemoryTransportPair()\n    const endpoint = await createEndpoint({ id: 'math-server', transport: serverTransport, middlewares: [connect(), ping(), abort()] }) as IRpcEndpoint\n    if (!hostMode) await serverHost.use(definition)\n    const served = hostMode\n      ? await serveRemoteHost({ host: serverHost, catalog: { math: contract }, resolvePlugin: () => definition, endpoint: { endpoint }, report })\n      : await serveRemotePlugin({ host: serverHost, contract, endpoint: { endpoint }, report, invocationContext: (context) => ({ sender: context.senderId }) })\n    expose({ transport: clientTransport, peerId: 'math-server', scheduler: systemScheduler,\n      agreement: { source: 'static', codec: identityCodec.id, capabilities: ['runtime-api@1'] },\n      pipeline: { codec: identityCodec, framer: messageFramerV1 }, features: [], close: async () => { clientTransport.close() }\n    })\n    try { await new Promise<void>((resolve) => {\n      if (signal.aborted) resolve()\n      else signal.addEventListener('abort', () => resolve(), { once: true })\n    }) } finally { await served.close() }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (unit) => unit.exposed\n}\nlet sequence = 0\nconst endpointFactory = async (channel: IRemoteChannel) => ({ endpoint: await createEndpoint({\n  id: 'math-client', transport: channel.transport, protocol: rpcProtocol, codec: identityCodec, framer: messageFramerV1, middlewares: [connect(), ping(), abort()]\n}) as IRpcEndpoint })\nif (hostMode) {\n  const client = createRemoteHost({ catalog: { math: contract }, binding, endpointFactory, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    callGuard: { beforeDispatch: ({ method }) => { if (method === 'forbidden') throw new Error('denied') } }\n  })\n  try {\n    await client.ready()\n    const proxy = await client.use('math')\n    console.log(await proxy.api!.double!([21]))\n    console.log(await client.inspect())\n    console.log(await client.unUse('math', { dryRun: true, policy: 'reject' }))\n  } finally { await client.release() }\n} else {\n  const clientHost = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  const remote = createRemotePlugin({ name: 'math', contract, binding, endpointFactory, host: clientHost.plugin, report,\n    keyFactory: () => 'operation-' + ++sequence, callDeadlineCapMs: 2000,\n    retryPort: { dispatch: (input) => input.sendOnce({ expectedGeneration: input.generation, key: input.key }) }\n  })\n  try {\n    const [handle] = await clientHost.use(remote)\n    const api = handle.getFeature('api') as { double(params: readonly number[]): Promise<number> }\n    console.log(await api.double([21]))\n  } finally { await clientHost.dispose() }\n}\nawait serverHost.dispose()\nconsole.log(supervisor.state, reports.length)\n",
      result: {
        en: 'Prints 63 and ends with disposed 0. Only declared methods are served, and cleanup follows the original task lifetime.',
        zh: '输出 63，最后为 disposed 0；仅服务已声明方法，清理仍随原任务生命周期。'
      },
      covers: ['host', 'contract', 'endpoint', 'report', 'invocationContext']
    }
  ],
  createManagedRuntimePeer: [
    {
      title: {
        en: 'Retain a real supervised generation for runtime calls',
        zh: '为运行时调用持有真实受监督代次'
      },
      problem: {
        en: 'The application binding owns a real coroutine task, actual MessagePorts and bilateral channel admission. bindEndpoint retains the served endpoint, and beforeRelease observes final generation release.',
        zh: '应用绑定拥有真实协程任务、MessagePort 和双端通道准入。bindEndpoint 保留服务端点，beforeRelease 观察最终代次释放。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createRuntimePeer, createManagedRuntimePeer, createRemoteRetryPort, normalizeRemoteContract, type IRemoteBinding, type IRemoteChannel } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nlet keys = 0\nlet retries = 0\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'managed-math', budget, report,\n  restart: { mode: 'never' }, ready: (handle) => handle.exposed.then(() => undefined),\n  spec: { task: async ({ expose, signal }) => {\n    const ports = new MessageChannel()\n    const provider = createRuntimePeer({\n      self: { name: 'math-provider', instanceId: 'provider-1' },\n      provide: { math: { double: (value: number) => value * 2 } }, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }), report,\n      connect: async (context) => createNodeThreadChannel(ports.port2, 'client-1', {\n        scheduler: systemScheduler, capabilities: context.capabilities\n      })\n    })\n    const channel = await createNodeThreadChannel(ports.port1, 'provider-1', {\n      scheduler: systemScheduler,\n      capabilities: [RpcCapability.ping, RpcCapability.close, RpcCapability.abort, RpcCapability.stream,\n        RpcCapability.batch, RpcCapability.runtimeApi, RpcCapability.forwardRoute]\n    })\n    expose(channel)\n    try {\n      await new Promise<void>((resolve) => {\n        if (signal.aborted) resolve()\n        else signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n    } finally {\n      await (await provider).close()\n      ports.port1.close()\n      ports.port2.close()\n    }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (handle, signal) => {\n    if (signal.aborted) throw signal.reason\n    return handle.exposed\n  }\n}\nlet endpointBindings = 0\nlet beforeRelease = 0\nconst peer = await createManagedRuntimePeer({\n  self: { name: 'managed-client', instanceId: 'client-1' }, defaultTimeoutMs: 2000, report,\n  provide: { local: { api: { echo: (value: string) => value } } },\n  contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'local', features: { api: { methods: { echo: { mode: 'request', idempotent: false } } } } }),\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, callDeadlineCapMs: 2000,\n  keyFactory: () => `call-${++keys}`,\n  retryPort: { dispatch: (input) => { retries++; return createRemoteRetryPort({ events: input.events, scheduler: systemScheduler, report }).dispatch(input) } }\n}, binding, (_channel, endpoint) => { endpointBindings += 1; return endpoint }, undefined, async () => { beforeRelease += 1 })\ntry {\n  const result = await peer.request('math.double', 21)\n  console.log(result, endpointBindings, budget.inUse, keys, retries)\n\n\n} finally {\n  await peer.close()\n  budget.close()\n}\nconsole.log(supervisor.state, budget.inUse, beforeRelease, reports.length)\n\n\n\n\n",
      result: {
        en: 'Prints a successful 42 with one endpoint binding and one live budget lease, then disposed 0 1 0. Logical keys and retries follow the managed registration rather than the direct Peer dispatcher.',
        zh: '输出成功结果 42、一次端点绑定和一个活动预算租约；最后输出 disposed 0 1 0。逻辑键与重试跟随托管登记，而非直接 Peer 派发器。'
      },
      covers: [
        'self',
        'provide',
        'providerLimits',
        'defaultTimeoutMs',
        'contract',
        'report',
        'keyFactory',
        'retryPort',
        'callDeadlineCapMs'
      ]
    },
    {
      title: {
        en: 'Protect and observe a real managed channel',
        zh: '保护并观察真实托管通道'
      },
      problem: {
        en: 'The managed client and its actual service use the same complete ephemeral signing and encryption configuration. Install a synchronous probe on the existing endpoint.',
        zh: '托管客户端与实际服务使用同一完整临时签名加密配置，在现有端点安装同步探针。'
      },
      example:
        "import { type IRpcAuthenticationConfig } from '@migaia/rpc-core'\nimport { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nimport { MessageChannel } from 'node:worker_threads'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createRuntimePeer, createManagedRuntimePeer, createRemoteRetryPort, normalizeRemoteContract, type IRemoteBinding, type IRemoteChannel } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nlet keys = 0\nlet retries = 0\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder()\nconst hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])\nconst aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])\nconst protection: IRpcAuthenticationConfig = {\n  encrypt: async (value) => {\n    const iv = crypto.getRandomValues(new Uint8Array(12))\n    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(JSON.stringify(value)))\n    return { iv: Array.from(iv), body: Array.from(new Uint8Array(body)) }\n  },\n  decrypt: async (value) => {\n    const encrypted = value as { iv: number[]; body: number[] }\n    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) }, aes, new Uint8Array(encrypted.body))\n    return JSON.parse(decoder.decode(body))\n  },\n  encodedType: 'string',\n  sign: async (value) => {\n    const text = JSON.stringify(value)\n    const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))\n    return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })\n  },\n  verify: async (value) => {\n    const signed = JSON.parse(String(value)) as { text: string; mac: number[] }\n    if (!await crypto.subtle.verify('HMAC', hmac, new Uint8Array(signed.mac), encoder.encode(signed.text))) throw new Error('Invalid signature')\n    return JSON.parse(signed.text)\n  }\n}\n\nconst observed: unknown[] = []\nconst probe = defineProbe({ stages: ['message'], emit: (event) => { observed.push(snapshotProbeEvent(event)) } })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'managed-math', budget, report,\n  restart: { mode: 'never' }, ready: (handle) => handle.exposed.then(() => undefined),\n  spec: { task: async ({ expose, signal }) => {\n    const ports = new MessageChannel()\n    const provider = createRuntimePeer({\n      authentication: protection, self: { name: 'math-provider', instanceId: 'provider-1' },\n      provide: { math: { double: (value: number) => value * 2 } }, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }), report,\n      connect: async (context) => createNodeThreadChannel(ports.port2, 'client-1', {\n        scheduler: systemScheduler, capabilities: context.capabilities\n      })\n    })\n    const channel = await createNodeThreadChannel(ports.port1, 'provider-1', {\n      scheduler: systemScheduler,\n      capabilities: [RpcCapability.ping, RpcCapability.close, RpcCapability.abort, RpcCapability.stream,\n        RpcCapability.batch, RpcCapability.runtimeApi, RpcCapability.forwardRoute]\n    })\n    expose(channel)\n    try {\n      await new Promise<void>((resolve) => {\n        if (signal.aborted) resolve()\n        else signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n    } finally {\n      await (await provider).close()\n      ports.port1.close()\n      ports.port2.close()\n    }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (handle, signal) => {\n    if (signal.aborted) throw signal.reason\n    return handle.exposed\n  }\n}\nlet endpointBindings = 0\nlet beforeRelease = 0\nconst peer = await createManagedRuntimePeer({\n  authentication: protection, probe, self: { name: 'managed-client', instanceId: 'client-1' }, defaultTimeoutMs: 2000, report,\n  provide: { local: { api: { echo: (value: string) => value } } },\n  contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'local', features: { api: { methods: { echo: { mode: 'request', idempotent: false } } } } }),\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, callDeadlineCapMs: 2000,\n  keyFactory: () => `call-${++keys}`,\n  retryPort: { dispatch: (input) => { retries++; return createRemoteRetryPort({ events: input.events, scheduler: systemScheduler, report }).dispatch(input) } }\n}, binding, (_channel, endpoint) => { endpointBindings += 1; return endpoint }, undefined, async () => { beforeRelease += 1 })\ntry {\n  const result = await peer.request('math.double', 21)\n  console.log(result, observed.length > 0)\n\n\n} finally {\n  await peer.close()\n  budget.close()\n}\nconsole.log(supervisor.state, budget.inUse, beforeRelease, reports.length)\n\n\n\n\n",
      result: {
        en: 'Prints 42 true, then disposed 0 1 0. The probe sees messages and the real supervisor releases its only lease without background errors.',
        zh: '输出 42 true，随后输出 disposed 0 1 0；探针看到消息，真实监督器释放唯一租约且无后台错误。'
      },
      covers: [
        'authentication',
        'authentication.encrypt',
        'authentication.decrypt',
        'authentication.sign',
        'authentication.verify',
        'authentication.encodedType',
        'probe'
      ]
    },
    {
      title: {
        en: 'Roll back a custom endpoint construction failure',
        zh: '回滚自定义端点构造失败'
      },
      problem: {
        en: 'A custom runtime cannot provide its complete endpoint. Reject its construction callback while the actual generation owner releases acquired resources.',
        zh: '自定义运行时无法提供完整端点，构造回调拒绝后，由实际代次所有者释放已取得资源。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createRuntimePeer, createManagedRuntimePeer, createRemoteRetryPort, normalizeRemoteContract, type IRemoteBinding, type IRemoteChannel } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nlet keys = 0\nlet retries = 0\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'managed-math', budget, report,\n  restart: { mode: 'never' }, ready: (handle) => handle.exposed.then(() => undefined),\n  spec: { task: async ({ expose, signal }) => {\n    const ports = new MessageChannel()\n    const provider = createRuntimePeer({\n      self: { name: 'math-provider', instanceId: 'provider-1' },\n      provide: { math: { double: (value: number) => value * 2 } }, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }), report,\n      connect: async (context) => createNodeThreadChannel(ports.port2, 'client-1', {\n        scheduler: systemScheduler, capabilities: context.capabilities\n      })\n    })\n    const channel = await createNodeThreadChannel(ports.port1, 'provider-1', {\n      scheduler: systemScheduler,\n      capabilities: [RpcCapability.ping, RpcCapability.close, RpcCapability.abort, RpcCapability.stream,\n        RpcCapability.batch, RpcCapability.runtimeApi, RpcCapability.forwardRoute]\n    })\n    expose(channel)\n    try {\n      await new Promise<void>((resolve) => {\n        if (signal.aborted) resolve()\n        else signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n    } finally {\n      await (await provider).close()\n      ports.port1.close()\n      ports.port2.close()\n    }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (handle, signal) => {\n    if (signal.aborted) throw signal.reason\n    return handle.exposed\n  }\n}\nconst unavailable = new Error('managed endpoint unavailable')\ntry {\n  await createManagedRuntimePeer({ self: { name: 'managed-client', instanceId: 'client-1' }, endpointFactory: async () => { throw unavailable }, report }, binding)\n} catch (error) { console.log(error === unavailable) }\nfinally { await supervisor.dispose(); budget.close() }\nconsole.log(supervisor.state, budget.inUse)",
      result: {
        en: 'Prints true and disposed 0. The original callback error remains the primary failure, and the real unit budget returns to zero.',
        zh: '输出 true 和 disposed 0；回调原错误仍是主要失败，真实执行单元预算回到零。'
      },
      covers: ['endpointFactory']
    },
    {
      title: {
        en: 'Let the binding select the managed source',
        zh: '由绑定选择托管来源'
      },
      problem: {
        en: 'Managed construction uses binding.openChannel. Inherited direct-source callbacks are not the acquisition path, even if present on the shared options shape.',
        zh: '托管构造使用 binding.openChannel；共享选项中即使带有直接来源回调，也不由它们取得通道。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createCoroutineSupervisor, type ICoroutineHandle, type ICoroutineSpec } from '@migaia/supervision/coroutine'\nimport { createRuntimePeer, createManagedRuntimePeer, createRemoteRetryPort, normalizeRemoteContract, type IRemoteBinding, type IRemoteChannel } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { RpcCapability } from '@migaia/rpc-contract'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nlet sources = 0\nlet keys = 0\nlet retries = 0\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })\nconst supervisor = createCoroutineSupervisor<IRemoteChannel>({\n  id: 'managed-math', budget, report,\n  restart: { mode: 'never' }, ready: (handle) => handle.exposed.then(() => undefined),\n  spec: { task: async ({ expose, signal }) => {\n    const ports = new MessageChannel()\n    const provider = createRuntimePeer({\n      self: { name: 'math-provider', instanceId: 'provider-1' },\n      provide: { math: { double: (value: number) => value * 2 } }, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }), report,\n      connect: async (context) => createNodeThreadChannel(ports.port2, 'client-1', {\n        scheduler: systemScheduler, capabilities: context.capabilities\n      })\n    })\n    const channel = await createNodeThreadChannel(ports.port1, 'provider-1', {\n      scheduler: systemScheduler,\n      capabilities: [RpcCapability.ping, RpcCapability.close, RpcCapability.abort, RpcCapability.stream,\n        RpcCapability.batch, RpcCapability.runtimeApi, RpcCapability.forwardRoute]\n    })\n    expose(channel)\n    try {\n      await new Promise<void>((resolve) => {\n        if (signal.aborted) resolve()\n        else signal.addEventListener('abort', () => resolve(), { once: true })\n      })\n    } finally {\n      await (await provider).close()\n      ports.port1.close()\n      ports.port2.close()\n    }\n  } }\n})\nconst binding: IRemoteBinding<ICoroutineHandle<IRemoteChannel>, ICoroutineSpec<IRemoteChannel>> = {\n  ownership: 'owned', supervisor, scheduler: systemScheduler,\n  openChannel: async (handle, signal) => {\n    if (signal.aborted) throw signal.reason\n    return handle.exposed\n  }\n}\nlet endpointBindings = 0\nlet beforeRelease = 0\nconst peer = await createManagedRuntimePeer({\n  spawn: async () => { sources++; throw new Error('source not selected') }, connect: async () => { sources++; throw new Error('source not selected') }, listen: async () => { sources++; throw new Error('source not selected') }, self: { name: 'managed-client', instanceId: 'client-1' }, defaultTimeoutMs: 2000, report,\n  provide: { local: { api: { echo: (value: string) => value } } },\n  contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'local', features: { api: { methods: { echo: { mode: 'request', idempotent: false } } } } }),\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, callDeadlineCapMs: 2000,\n  keyFactory: () => `call-${++keys}`,\n  retryPort: { dispatch: (input) => { retries++; return createRemoteRetryPort({ events: input.events, scheduler: systemScheduler, report }).dispatch(input) } }\n}, binding, (_channel, endpoint) => { endpointBindings += 1; return endpoint }, undefined, async () => { beforeRelease += 1 })\ntry {\n  const result = await peer.request('math.double', 21)\n  console.log(result, sources)\n\n\n} finally {\n  await peer.close()\n  budget.close()\n}\nconsole.log(supervisor.state, budget.inUse, beforeRelease, reports.length)\n\n\n\n\n",
      result: {
        en: 'Prints 42 0 before disposed 0 1 0. None of the three inherited callbacks is invoked; the binding owns actual acquisition.',
        zh: '先输出 42 0，随后输出 disposed 0 1 0；三个继承回调均未调用，实际取得通道由绑定负责。'
      },
      covers: ['spawn', 'connect', 'listen']
    }
  ],
  createCoroutinePlugin: [
    {
      title: {
        en: 'Keep cooperative work with its parent Host',
        zh: '让协作任务跟随父宿主'
      },
      problem: {
        en: 'A parent task installs its actual child connection using the opaque connect token. Both Hosts dispose in their original ownership order and the task waits for cancellation.',
        zh: '父任务使用不透明 connect 令牌安装真实子连接，两个宿主按原所有权顺序释放，任务等待取消后结束。'
      },
      example:
        "import { defineHost } from '@migaia/plugin-host'\nimport { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst service = createCoroutinePlugin<{ double(value: number): number }>({\n name: 'math', self: { name: 'math-parent', instanceId: 'parent-1' }, report, defaultTimeoutMs: 2000, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, supervisor: { restart: { mode: 'never' }, startupTimeoutMs: 2000 },\n task: async ({ connect, signal }) => {\n  const parent = createCoroutinePlugin({ name: 'parent', self: { name: 'math-child', instanceId: 'child-1' }, report, connect, provide: { double: (value: number) => value * 2 } })\n  const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  try {\n   await child.use(parent)\n   await new Promise<void>((resolve) => {\n    if (signal.aborted) resolve()\n    else signal.addEventListener('abort', () => resolve(), { once: true })\n   })\n  } finally { await child.dispose() }\n }\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\ntry { await host.use(service); console.log(await host.coroutine!.request('math', 'double', 21)) }\nfinally { await host.dispose() }\nconsole.log(reports.length)",
      result: {
        en: 'Prints 42 then 0. The real child handles double, the selected supervisor does not restart, and no background diagnostics are recorded. The explicit remote generic keeps the request method callable in TypeScript.',
        zh: '先输出 42，再输出 0；真实子端处理 double，所选监督策略不重启，未记录后台诊断。显式远程泛型确保 TypeScript 允许调用该请求方法。'
      },
      covers: [
        'name',
        'provide',
        'task',
        'supervisor',
        'connect',
        'self',
        'providerLimits',
        'report',
        'defaultTimeoutMs'
      ]
    },
    {
      title: {
        en: 'Protect a typed cooperative service and its declared methods',
        zh: '保护带类型的协作服务与声明方法'
      },
      problem: {
        en: 'Both genuine coroutine peers receive the same signing and encryption transforms. The child narrows its real provide map with an explicit remote contract and the parent observes actual messages.',
        zh: '两个真实协程对端接收同一签名加密转换；子端用明确远程契约收窄实际 provide 映射，父端观察真实消息。'
      },
      example:
        "import { type IRpcAuthenticationConfig } from '@migaia/rpc-core'\nimport { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nimport { normalizeRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\nimport { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder()\nconst hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])\nconst aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])\nconst protection: IRpcAuthenticationConfig = {\n  encrypt: async (value) => {\n    const iv = crypto.getRandomValues(new Uint8Array(12))\n    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(JSON.stringify(value)))\n    return { iv: Array.from(iv), body: Array.from(new Uint8Array(body)) }\n  },\n  decrypt: async (value) => {\n    const encrypted = value as { iv: number[]; body: number[] }\n    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) }, aes, new Uint8Array(encrypted.body))\n    return JSON.parse(decoder.decode(body))\n  },\n  encodedType: 'string',\n  sign: async (value) => {\n    const text = JSON.stringify(value)\n    const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))\n    return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })\n  },\n  verify: async (value) => {\n    const signed = JSON.parse(String(value)) as { text: string; mac: number[] }\n    if (!await crypto.subtle.verify('HMAC', hmac, new Uint8Array(signed.mac), encoder.encode(signed.text))) throw new Error('Invalid signature')\n    return JSON.parse(signed.text)\n  }\n}\n\nconst observed: unknown[] = []\nconst probe = defineProbe({ stages: ['message'], emit: (event) => { observed.push(snapshotProbeEvent(event)) } })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst service = createCoroutinePlugin<{ math: { calc: { double(value: number): number } } }>({\n authentication: protection, probe, keyFactory: () => 'local-key', retryPort: { dispatch: (input) => input.sendOnce({ expectedGeneration: input.generation, key: input.key }) }, name: 'math', self: { name: 'math-parent', instanceId: 'parent-1' }, report, defaultTimeoutMs: 2000, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, supervisor: { restart: { mode: 'never' }, startupTimeoutMs: 2000 },\n task: async ({ connect, signal }) => {\n  const parent = createCoroutinePlugin({ authentication: protection, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'math', features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } } }), name: 'parent', self: { name: 'math-child', instanceId: 'child-1' }, report, connect, provide: { math: { calc: { double: (value: number) => value * 2 } } } })\n  const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  try {\n   await child.use(parent)\n   await new Promise<void>((resolve) => {\n    if (signal.aborted) resolve()\n    else signal.addEventListener('abort', () => resolve(), { once: true })\n   })\n  } finally { await child.dispose() }\n }\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\ntry { await host.use(service); console.log(await host.coroutine!.request('math', 'math.calc.double', 21)) }\nfinally { await host.dispose() }\nconsole.log(reports.length, observed.length > 0, reports.every((error) => (error as { code?: string }).code === 'AUTHENTICATION_FAILED'))",
      result: {
        en: 'Prints 42 and 2 true true in this Bun run. The declared business method succeeds and the probe sees messages; this coroutine configuration also reports two AUTHENTICATION_FAILED diagnostics when its verification callback receives non-protected objects. The callbacks reject those objects instead of bypassing verification, so this is not a clean diagnostic-free lifecycle.',
        zh: '本次 Bun 运行输出 42 和 2 true true。声明业务方法成功，探针看到了消息；此协程配置还记录两项 AUTHENTICATION_FAILED，原因是校验回调收到了未保护对象。回调拒绝这些对象，没有绕过校验，因此本例不能宣称生命周期中没有诊断。'
      },
      covers: [
        'authentication',
        'authentication.encrypt',
        'authentication.decrypt',
        'authentication.sign',
        'authentication.verify',
        'authentication.encodedType',
        'probe',
        'contract',
        'keyFactory',
        'retryPort'
      ]
    },
    {
      title: {
        en: 'Rollback an unavailable custom cooperative endpoint',
        zh: '回滚不可用的自定义协作端点'
      },
      problem: {
        en: 'The owning Host cannot acquire the application endpoint. Reject from the custom factory and let the existing install transaction and supervisor clean up.',
        zh: '拥有宿主无法取得应用端点，自定义工厂拒绝后，由现有安装事务和监督器清理。'
      },
      example:
        "import { defineHost } from '@migaia/plugin-host'\nimport { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst unavailable = new Error('coroutine endpoint unavailable')\nconst service = createCoroutinePlugin<{ double(value: number): number }>({\n endpointFactory: async () => { throw unavailable }, name: 'math', self: { name: 'math-parent', instanceId: 'parent-1' }, report, defaultTimeoutMs: 2000, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, supervisor: { restart: { mode: 'never' }, startupTimeoutMs: 2000 },\n task: async ({ connect, signal }) => {\n  const parent = createCoroutinePlugin({ name: 'parent', self: { name: 'math-child', instanceId: 'child-1' }, report, connect, provide: { double: (value: number) => value * 2 } })\n  const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  try {\n   await child.use(parent)\n   await new Promise<void>((resolve) => {\n    if (signal.aborted) resolve()\n    else signal.addEventListener('abort', () => resolve(), { once: true })\n   })\n  } finally { await child.dispose() }\n }\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\ntry { await host.use(service) } catch (error) { console.log((error as Error).cause === unavailable) }\nfinally { await host.dispose() }\nconsole.log(reports.length)",
      result: {
        en: 'Prints true then 0. Host installation wraps the application failure and retains it on cause; cleanup records no background diagnostic.',
        zh: '先输出 true，再输出 0；宿主安装包装应用失败，并在 cause 保留原错误，清理未记录后台诊断。'
      },
      covers: ['endpointFactory']
    },
    {
      title: {
        en: 'Expose only the actual child Host’s declared catalog',
        zh: '仅公开真实子宿主的已声明目录'
      },
      problem: {
        en: 'The child explicitly exposes host controls from its own actual Host. The local catalog resolver returns a real plugin definition; no definition travels across the channel.',
        zh: '子端明确公开自身真实宿主的控制，本地目录解析器返回实际插件定义，不通过通道传输定义。'
      },
      example:
        "import { RemoteMethodName, type IRemoteHostCatalog } from '@migaia/rpc-core/remote'\nimport { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\nimport { createCoroutinePlugin } from '@migaia/rpc-core/remote'\n\nconst business = definePlugin({ name: 'math', features: { api: defineFeature(() => ({ double: (value: number) => value * 2 })) }, install: () => ({}) })\nconst catalog: IRemoteHostCatalog = { math: { schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } } }\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst service = createCoroutinePlugin<{ double(value: number): number }>({\n name: 'math', self: { name: 'math-parent', instanceId: 'parent-1' }, report, defaultTimeoutMs: 2000, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, supervisor: { restart: { mode: 'never' }, startupTimeoutMs: 2000 },\n task: async ({ connect, signal }) => {\n  const child = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\n  const parent = createCoroutinePlugin({ name: 'parent', expose: ['host'], host: child, catalog, resolvePlugin: (name) => { if (name !== 'math') throw new Error('unknown plugin'); return business }, self: { name: 'math-child', instanceId: 'child-1' }, report, connect, provide: { double: (value: number) => value * 2 } })\n  \n  try {\n   await child.use(parent)\n   await new Promise<void>((resolve) => {\n    if (signal.aborted) resolve()\n    else signal.addEventListener('abort', () => resolve(), { once: true })\n   })\n  } finally { await child.dispose() }\n }\n})\nconst host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\ntry {\n  await host.use(service)\n  const outlet = Reflect.get(host, 'coroutine') as { request(target: string, method: string, payload: unknown): Promise<unknown> }\n  console.log(await outlet.request('math', 'double', 21))\n  await outlet.request('math', RemoteMethodName.hostUse, ['math'])\n  const state = await outlet.request('math', RemoteMethodName.hostInspect, []) as { plugins: unknown[] }\n  console.log(state.plugins.length)\n}\nfinally { await host.dispose() }\nconsole.log(reports.length)",
      result: {
        en: 'Prints 42, 1 and 0. The child handles the business call, its same Host adopts one declared plugin, and cleanup reports no background errors.',
        zh: '依次输出 42、1、0；子端处理业务调用，同一宿主采用一个已声明插件，清理未报告后台错误。'
      },
      covers: ['expose', 'host', 'catalog', 'resolvePlugin']
    }
  ],
  createRuntimePlugin: [
    {
      title: {
        en: 'Acquire a real Host slot for an application adapter',
        zh: '为应用适配器取得真实宿主槽位'
      },
      problem: {
        en: 'An adapter author reuses the real PluginHost integration and a stable family identity. The third argument delegates to a public message adapter, which opens the original MessagePorts.',
        zh: '适配器作者复用真实 PluginHost 集成与稳定家族身份，第三参数交给公开消息适配器打开原始 MessagePort。'
      },
      example:
        "import { MessageChannel, type MessagePort } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nimport { createRuntimePlugin, RuntimePluginKey } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst ports = new MessageChannel()\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst provider = adapter.peer({\n  self: { name: 'math-provider', instanceId: 'provider-1' }, connect: ports.port2,\n  provide: { math: { double: (value: number) => value * 2 } }, report\n})\nconst family = Object.freeze({})\nlet acquisitions = 0\nconst plugin = createRuntimePlugin({\n  name: 'math-link', self: { name: 'host', instanceId: 'host-1' }, connect: ports.port1, report\n}, {\n  key: 'thread',\n  acquire: (integration, create) => {\n    acquisitions += 1\n    return integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)\n  }\n}, (options) => adapter.peer({ ...options, spawn: undefined, listen: undefined, connect: ports.port1 }))\nconst host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  await host.use(plugin)\n  const outlet = Reflect.get(host, RuntimePluginKey.thread) as {\n    request(target: string, method: string, value: number): Promise<unknown>\n  }\n  const result = await outlet.request('math-link', 'math.double', 21)\n  console.log(result, acquisitions)\n\n\n} finally {\n  await host.dispose()\n  await (await provider).close()\n  ports.port1.close()\n  ports.port2.close()\n}\n\n",
      result: {
        en: 'Prints 42 1. One genuine Host slot is acquired and the real provider serves the call. Host disposal precedes borrowed port cleanup.',
        zh: '输出 42 1；取得一次真实宿主槽位，真实处理方完成调用，先释放宿主再清理借入端口。'
      },
      covers: ['name', 'self', 'connect', 'report']
    },
    {
      title: {
        en: 'Expose declared controls of the same actual Host',
        zh: '公开同一真实宿主的已声明控制'
      },
      problem: {
        en: 'The application explicitly exposes host and passes that exact Host, catalog and local plugin resolver. Core rejects a different Host owner. The remote caller uses the public reserved method names.',
        zh: '应用明确公开 host，并传入同一宿主、目录与本地插件解析器；Core 会拒绝其他宿主所有者。远端调用公开保留方法名。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { createRuntimePlugin, createRuntimePeer, RuntimePluginKey, RemoteMethodName, type IRemoteHostCatalog } from '@migaia/rpc-core/remote'\nimport { createNodeThreadChannel } from '@migaia/rpc-threads'\nimport { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst ports = new MessageChannel()\nconst business = definePlugin({\n  name: 'math',\n  features: { api: defineFeature(() => ({ double: (value: number) => value * 2 })) },\n  install: () => ({})\n})\nconst catalog: IRemoteHostCatalog = {\n  math: { schemaVersion: 1, plugin: 'math', features: { api: { methods: { double: { mode: 'request', idempotent: true } } } } }\n}\nconst host = defineHost({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })\nconst caller = createRuntimePeer({\n  self: { name: 'controller', instanceId: 'controller-1' }, report,\n  connect: async (context) => createNodeThreadChannel(ports.port2, 'host-1', {\n    scheduler: systemScheduler, capabilities: context.capabilities\n  })\n})\nvoid caller.catch(() => undefined)\nconst family = Object.freeze({})\nlet acquisitions = 0\nconst runtime = createRuntimePlugin({\n  name: 'control-link', self: { name: 'host', instanceId: 'host-1' },\n  expose: ['host'], host, catalog,\n  resolvePlugin: (name) => {\n    if (name !== 'math') throw new Error('unknown catalog entry')\n    return business\n  },\n  connect: async (context: { capabilities: readonly string[] }) => createNodeThreadChannel(ports.port1, 'controller-1', {\n    scheduler: systemScheduler, capabilities: context.capabilities\n  }),\n  report\n}, {\n  key: 'thread',\n  acquire: (integration, create) => {\n    acquisitions += 1\n    return integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)\n  }\n})\ntry {\n  await host.use(runtime)\n  const remote = await caller\n  const before = await remote.request(RemoteMethodName.hostInspect, []) as { plugins: unknown[] }\n  console.log(before.plugins.length)\n  const installed = await remote.request(RemoteMethodName.hostUse, ['math']) as { name: string; state: string }\n  console.log(installed.state, installed.name)\n  const after = await remote.request(RemoteMethodName.hostInspect, []) as { plugins: { name: string }[] }\n  console.log(after.plugins.length, acquisitions)\n\n\n\n\n\n\n} catch (error) {\n  console.error('host primary', error)\n  throw error\n} finally {\n  await host.dispose()\n  ports.port1.close()\n  ports.port2.close()\n  await (await caller).close()\n}\n\n",
      result: {
        en: "Prints 0, enabled math and 1 1. The declared math definition is installed through the real Host and the shared slot is acquired once. Host control payloads are argument arrays: ['math'] and [].",
        zh: "依次输出 0、enabled math、1 1；声明的 math 定义通过真实宿主安装，共享槽位取得一次。宿主控制负载为参数数组： ['math'] 和 []。"
      },
      covers: ['expose', 'host', 'catalog', 'resolvePlugin']
    },
    {
      title: {
        en: 'Roll back a failed custom runtime endpoint',
        zh: '回滚失败的自定义运行端点'
      },
      problem: {
        en: 'A genuine Host install acquires the native channel, then the application endpoint factory fails. Preserve that original cause and do not publish the shared outlet.',
        zh: '真实宿主安装取得原生通道后，应用端点工厂失败；应保留原始原因，并且不发布共享出口。'
      },
      example:
        "import { MessageChannel } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nimport { createRuntimePlugin, RuntimePluginKey } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\n\nconst failure = new Error('application endpoint setup failed')\nconst reports: unknown[] = []\nconst ports = new MessageChannel()\nconst adapter = defineMessageAdapter<typeof ports.port1>({ open: (port) => port })\nconst other = adapter.peer({ self: { name: 'caller', instanceId: 'caller-1' }, connect: ports.port2, report: (error) => { reports.push(error) } })\nconst otherOutcome = other.then((peer) => ({ peer }), (error: unknown) => ({ error }))\nconst family = Object.freeze({})\nlet endpointCalls = 0\nconst runtime = createRuntimePlugin({\n  name: 'broken-link', self: { name: 'broken-host', instanceId: 'broken-host-1' }, connect: ports.port1,\n  endpointFactory: async () => { endpointCalls += 1; throw failure },\n  report: (error) => { reports.push(error) }\n}, {\n  key: 'thread', acquire: (integration, create) => integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)\n}, (options) => adapter.peer({ ...options, spawn: undefined, listen: undefined, connect: ports.port1 }))\nconst host = defineHost<Record<string, never>, never, readonly [typeof runtime]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  const outcome = await host.use(runtime).then(() => undefined, (error: unknown) => error)\n  let original = false\n  for (let current: unknown = outcome; current && typeof current === 'object'; current = Reflect.get(current, 'cause')) {\n    if (current === failure) original = true\n  }\n  console.log(original, endpointCalls, Reflect.get(host, RuntimePluginKey.thread) === undefined)\n\n\n\n} finally {\n  await host.dispose()\n  ports.port1.close()\n  ports.port2.close()\n  const settled = await otherOutcome\n  if ('peer' in settled) await settled.peer.close()\n}\n",
      result: {
        en: 'Prints true 1 true. The original failure is in the Host error cause chain, the callback runs once, and the rolled-back outlet is absent.',
        zh: '输出 true 1 true；宿主错误原因链含原失败，回调运行一次，回滚后的出口不存在。'
      },
      covers: ['endpointFactory']
    },
    {
      title: {
        en: 'Set local runtime policy on the real shared connection',
        zh: '为真实共享连接设置本地运行策略'
      },
      problem: {
        en: 'A Host adapter publishes local own-data methods while calling the actual remote provider. The advanced contract narrows the local map, and quotas and default waiting budget stay with that installed connection.',
        zh: '宿主适配器公开本地自有数据方法，同时调用真实远端处理方；高级契约收窄本地映射，限额与默认等待预算留在该已安装连接。'
      },
      example:
        "import { MessageChannel, type MessagePort } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nimport { createRuntimePlugin, RuntimePluginKey, normalizeRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\n\nlet keys = 0\nlet retries = 0\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst ports = new MessageChannel()\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst provider = adapter.peer({\n  self: { name: 'math-provider', instanceId: 'provider-1' }, connect: ports.port2,\n  provide: { math: { double: (value: number) => value * 2 } }, report\n})\nconst family = Object.freeze({})\nlet acquisitions = 0\nconst plugin = createRuntimePlugin({\n  name: 'math-link', defaultTimeoutMs: 2000, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, provide: { local: { api: { echo: (value: string) => value } } }, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'local', features: { api: { methods: { echo: { mode: 'request', idempotent: false } } } } }), keyFactory: () => `call-${++keys}`, retryPort: { dispatch: (input) => { retries++; return input.sendOnce({ expectedGeneration: input.generation, key: input.key }) } }, self: { name: 'host', instanceId: 'host-1' }, connect: ports.port1, report\n}, {\n  key: 'thread',\n  acquire: (integration, create) => {\n    acquisitions += 1\n    return integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)\n  }\n}, (options) => adapter.peer({ ...options, spawn: undefined, listen: undefined, connect: ports.port1 }))\nconst host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  await host.use(plugin)\n  const outlet = Reflect.get(host, RuntimePluginKey.thread) as {\n    request(target: string, method: string, value: number): Promise<unknown>\n  }\n  const result = await outlet.request('math-link', 'math.double', 21)\n  console.log(result, acquisitions); console.log(keys, retries)\n\n\n} finally {\n  await host.dispose()\n  await (await provider).close()\n  ports.port1.close()\n  ports.port2.close()\n}\n\n",
      result: {
        en: 'Prints 42 1 through the genuine slot and message adapter. The local echo contract does not widen the remote math directory. A final 0 0 confirms this direct adapter dispatch does not consume keyFactory or retryPort.',
        zh: '经真实槽位和消息适配器输出 42 1；本地 echo 契约不会扩大远端 math 目录。 最后的 0 0 确认此直接适配器派发未使用 keyFactory 或 retryPort。'
      },
      covers: [
        'provide',
        'providerLimits',
        'defaultTimeoutMs',
        'contract',
        'keyFactory',
        'retryPort'
      ]
    },
    {
      title: {
        en: 'Protect both actual sides of the adapter connection',
        zh: '保护适配器连接的两个真实端点'
      },
      problem: {
        en: 'Both the real provider and the installed Host plugin use complete AES-GCM and HMAC transforms. The probe snapshots observations while their synchronous views are valid.',
        zh: '真实处理方与已安装宿主插件均使用完整 AES-GCM 和 HMAC 转换；探针在同步视图有效时保存观察快照。'
      },
      example:
        "import { type IRpcAuthenticationConfig } from '@migaia/rpc-core'\nimport { defineProbe, snapshotProbeEvent } from '@migaia/rpc-core/probe'\nimport { MessageChannel, type MessagePort } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nimport { createRuntimePlugin, RuntimePluginKey, normalizeRemoteContract } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\n\nlet keys = 0\nlet retries = 0\nconst encoder = new TextEncoder()\nconst decoder = new TextDecoder()\nconst hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])\nconst aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])\nconst protection: IRpcAuthenticationConfig = {\n  encrypt: async (value) => {\n    const iv = crypto.getRandomValues(new Uint8Array(12))\n    const body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(JSON.stringify(value)))\n    return { iv: Array.from(iv), body: Array.from(new Uint8Array(body)) }\n  },\n  decrypt: async (value) => {\n    const encrypted = value as { iv: number[]; body: number[] }\n    const body = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) }, aes, new Uint8Array(encrypted.body))\n    return JSON.parse(decoder.decode(body))\n  },\n  encodedType: 'string',\n  sign: async (value) => {\n    const text = JSON.stringify(value)\n    const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(text))\n    return JSON.stringify({ text, mac: Array.from(new Uint8Array(mac)) })\n  },\n  verify: async (value) => {\n    const signed = JSON.parse(String(value)) as { text: string; mac: number[] }\n    if (!await crypto.subtle.verify('HMAC', hmac, new Uint8Array(signed.mac), encoder.encode(signed.text))) throw new Error('Invalid signature')\n    return JSON.parse(signed.text)\n  }\n}\n\nconst observed: unknown[] = []\nconst probe = defineProbe({ stages: ['message'], emit: (event) => { observed.push(snapshotProbeEvent(event)) } })\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst ports = new MessageChannel()\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst provider = adapter.peer({\n  authentication: protection, self: { name: 'math-provider', instanceId: 'provider-1' }, connect: ports.port2,\n  provide: { math: { double: (value: number) => value * 2 } }, report\n})\nconst family = Object.freeze({})\nlet acquisitions = 0\nconst plugin = createRuntimePlugin({\n  authentication: protection, probe, name: 'math-link', defaultTimeoutMs: 2000, providerLimits: { maxGlobal: 8, maxPerPeer: 2 }, provide: { local: { api: { echo: (value: string) => value } } }, contract: normalizeRemoteContract({ schemaVersion: 1, plugin: 'local', features: { api: { methods: { echo: { mode: 'request', idempotent: false } } } } }), keyFactory: () => `call-${++keys}`, retryPort: { dispatch: (input) => { retries++; return input.sendOnce({ expectedGeneration: input.generation, key: input.key }) } }, self: { name: 'host', instanceId: 'host-1' }, connect: ports.port1, report\n}, {\n  key: 'thread',\n  acquire: (integration, create) => {\n    acquisitions += 1\n    return integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)\n  }\n}, (options) => adapter.peer({ ...options, spawn: undefined, listen: undefined, connect: ports.port1 }))\nconst host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  await host.use(plugin)\n  const outlet = Reflect.get(host, RuntimePluginKey.thread) as {\n    request(target: string, method: string, value: number): Promise<unknown>\n  }\n  const result = await outlet.request('math-link', 'math.double', 21)\n  console.log(result, acquisitions, observed.length > 0); console.log(keys, retries)\n\n\n} finally {\n  await host.dispose()\n  await (await provider).close()\n  ports.port1.close()\n  ports.port2.close()\n}\n\n",
      result: {
        en: 'Prints 42 1 true. The protected business request traverses the real adapter path and the probe observes it. A final 0 0 confirms this direct adapter dispatch does not consume keyFactory or retryPort.',
        zh: '输出 42 1 true；受保护业务请求经过真实适配器路径，探针观察到了消息。 最后的 0 0 确认此直接适配器派发未使用 keyFactory 或 retryPort。'
      },
      covers: [
        'authentication',
        'authentication.encrypt',
        'authentication.decrypt',
        'authentication.sign',
        'authentication.verify',
        'authentication.encodedType',
        'probe'
      ]
    },
    {
      title: {
        en: 'Delegate source interpretation to the actual adapter',
        zh: '将来源解释交给实际适配器'
      },
      problem: {
        en: 'The shared plugin captures spawn as the adapter’s concrete input; the supplied real peer factory maps that port into its existing direct message opening. The opposite real peer listens on its own original port.',
        zh: '共享插件把 spawn 捕获为适配器具体输入；实际对端工厂把该端口接入现有直接消息打开路径，另一真实对端在自己的原端口监听。'
      },
      example:
        "import { MessageChannel, type MessagePort } from 'node:worker_threads'\nimport { defineMessageAdapter } from '@migaia/rpc-core/adapter'\nimport { createRuntimePlugin, RuntimePluginKey } from '@migaia/rpc-core/remote'\nimport { defineHost } from '@migaia/plugin-host'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => { reports.push(error) }\nconst ports = new MessageChannel()\nconst adapter = defineMessageAdapter<MessagePort>({ open: (port) => port })\nconst provider = adapter.peer({\n  self: { name: 'math-provider', instanceId: 'provider-1' }, listen: ports.port2,\n  provide: { math: { double: (value: number) => value * 2 } }, report\n})\nconst family = Object.freeze({})\nlet acquisitions = 0\nconst plugin = createRuntimePlugin({\n  name: 'math-link', self: { name: 'host', instanceId: 'host-1' }, spawn: ports.port1, report\n}, {\n  key: 'thread',\n  acquire: (integration, create) => {\n    acquisitions += 1\n    return integration.acquireSharedSlot(RuntimePluginKey.thread, family, create)\n  }\n}, (options) => adapter.peer({ ...options, spawn: undefined, listen: undefined, connect: ports.port1 }))\nconst host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({\n  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n})\ntry {\n  await host.use(plugin)\n  const outlet = Reflect.get(host, RuntimePluginKey.thread) as {\n    request(target: string, method: string, value: number): Promise<unknown>\n  }\n  const result = await outlet.request('math-link', 'math.double', 21)\n  console.log(result, acquisitions)\n\n\n} finally {\n  await host.dispose()\n  await (await provider).close()\n  ports.port1.close()\n  ports.port2.close()\n}\n\n",
      result: {
        en: 'Prints 42 1. The input chooses the adapter callback; it does not itself create a worker or add a second execution owner.',
        zh: '输出 42 1；输入选择适配器回调，本身不创建工作线程，也不增加执行所有者。'
      },
      covers: ['spawn', 'listen']
    }
  ]
}

/** Callback and value choices link to the complete scenario that actually exercises them. */
export const rpcCoreOptionFields: Readonly<
  Record<string, Readonly<Record<string, { readonly index: number; readonly whenToUse: IText }>>>
> = {
  createEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  createClientEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  createProviderEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  createFullEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  createFullOneWayEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  createComposedEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  hooks: {
    listeners: {
      index: 1,
      whenToUse: {
        en: 'Supply an application diagnostic callback; route observer errors without throwing into business settlement.',
        zh: '提供应用诊断回调，将观察者错误单独上报，避免抛错影响业务结果。'
      }
    },
    onHookError: {
      index: 1,
      whenToUse: {
        en: 'Supply an application diagnostic callback; route observer errors without throwing into business settlement.',
        zh: '提供应用诊断回调，将观察者错误单独上报，避免抛错影响业务结果。'
      }
    }
  },
  uuid: {
    generate: {
      index: 0,
      whenToUse: {
        en: 'Supply a synchronous unique string generator when application tracing needs stable endpoint prefixes.',
        zh: '应用追踪需要稳定端点前缀时，提供同步唯一字符串生成器。'
      }
    }
  },
  timeout: {
    timeoutMs: {
      index: 0,
      whenToUse: {
        en: 'Choose finite milliseconds for bounded waits or false when the application deliberately owns the waiting lifetime.',
        zh: '需要有界等待时设有限毫秒数，应用明确拥有等待生命周期时用 false。'
      }
    }
  },
  createPeerPair: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Collect background diagnostics in the application that owns both local peers.',
        zh: '由同时拥有两端的应用收集后台诊断。'
      }
    }
  },
  connect: {
    discoveryMode: {
      index: 0,
      whenToUse: {
        en: 'Choose automatic when known targets should be discovered and selected during calls; manual requires explicit discovery controls.',
        zh: '调用时需要自动发现并选择已知目标时用 automatic；manual 需要显式发现控制。'
      }
    },
    receiverSelector: {
      index: 0,
      whenToUse: {
        en: 'Existing integrations may retain this captured configuration; current public send routing does not invoke it, so it cannot select a receiver today.',
        zh: '既有集成可以保留此捕获配置；当前公开 send 路由未调用它，因此目前不能用它选择接收端。'
      }
    },
    uniqueTargetId: {
      index: 1,
      whenToUse: {
        en: 'Generate a per-instance suffix together with an enabled custom identifier.',
        zh: '启用自定义校验器时，同时生成实例后缀。'
      }
    },
    identifier: {
      index: 1,
      whenToUse: {
        en: 'Supplement actual carrier verification with an application admission decision.',
        zh: '在实际载体验证之上增加应用准入决定。'
      }
    }
  },
  authentication: {
    encrypt: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    decrypt: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    sign: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    verify: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    encodedType: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    }
  },
  createBrowserMessagePortTransport: {
    ownership: {
      index: 0,
      whenToUse: {
        en: 'Choose owned only when the wrapper should close the original port; choose borrowed when another component retains it.',
        zh: '包装器应负责关闭原端口时选 owned，其他组件保留生命周期时选 borrowed。'
      }
    }
  },
  createIpcLogFeature: {
    report: {
      index: 1,
      whenToUse: {
        en: 'Observe local diagnostics and send sink failures to a separate application owner.',
        zh: '观察本地诊断，并把接收器失败交给独立应用所有者。'
      }
    },
    onReportError: {
      index: 1,
      whenToUse: {
        en: 'Observe local diagnostics and send sink failures to a separate application owner.',
        zh: '观察本地诊断，并把接收器失败交给独立应用所有者。'
      }
    }
  },
  defineMessageAdapter: {
    open: {
      index: 0,
      whenToUse: {
        en: 'Return the original host MessagePort or messaging object when the connection already exists.',
        zh: '连接已存在时，返回宿主的原始消息端口或消息对象。'
      }
    },
    launch: {
      index: 1,
      whenToUse: {
        en: 'Supply launch only when the adapter owns native execution and can observe its actual exit.',
        zh: '仅在适配器拥有原生执行单元且能观察真实退出时提供 launch。'
      }
    }
  },
  defineByteAdapter: {
    open: {
      index: 0,
      whenToUse: {
        en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
        zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
      }
    },
    listen: {
      index: 0,
      whenToUse: {
        en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
        zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
      }
    },
    dial: {
      index: 0,
      whenToUse: {
        en: 'Return the original ordered byte I/O for this source mode; keep handshake and framing in Core.',
        zh: '按来源模式返回原始有序字节读写，把握手与分帧留给 Core。'
      }
    }
  },
  createRuntimePeer: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Keep local diagnostics with this Peer’s owner; keyFactory is inherited but direct requests do not read it.',
        zh: '把本地诊断交给此对端所有者；keyFactory 是继承配置，直接请求不会读取。'
      }
    },
    keyFactory: {
      index: 0,
      whenToUse: {
        en: 'Keep local diagnostics with this Peer’s owner; keyFactory is inherited but direct requests do not read it.',
        zh: '把本地诊断交给此对端所有者；keyFactory 是继承配置，直接请求不会读取。'
      }
    },
    authentication: {
      index: 2,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    'authentication.encrypt': {
      index: 2,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    'authentication.decrypt': {
      index: 2,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    'authentication.sign': {
      index: 2,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    'authentication.verify': {
      index: 2,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    'authentication.encodedType': {
      index: 2,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt` for confidentiality and `sign` with `verify` for integrity; `encodedType` names the actual protected representation.',
        zh: '需要保密时配置 `encrypt` 与 `decrypt`，需要完整性时配置 `sign` 与 `verify`；`encodedType` 声明真实受保护表示。'
      }
    },
    spawn: {
      index: 1,
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      }
    },
    connect: {
      index: 0,
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      }
    },
    listen: {
      index: 0,
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      }
    },
    retryPort: {
      index: 0,
      whenToUse: {
        en: 'The application source supplies a real negotiated channel; direct Peer calls use their existing dispatcher and do not consult retryPort.',
        zh: '应用来源提供真实已协商通道；直接 Peer 调用使用现有派发器，不读取 retryPort。'
      }
    },
    endpointFactory: {
      index: 3,
      whenToUse: {
        en: 'Supply this advanced callback only when the application owns a complete served endpoint; reject construction if that endpoint cannot be acquired.',
        zh: '仅在应用拥有完整服务端点时提供此高级回调；无法取得端点时拒绝构造。'
      }
    }
  },
  createRuntimeApiEndpoint: {
    transport: {
      index: 0,
      whenToUse: {
        en: 'Supply the exact original carrier side owned by this caller; choose a transport factory for the supported host.',
        zh: '传入调用者持有的原始载体一侧，并按宿主选用传输工厂。'
      }
    },
    'idempotency.scope': {
      index: 1,
      whenToUse: {
        en: 'Derive isolation from an admitted token when sharing an outcome store across sessions.',
        zh: '跨会话共用结果存储时，从已准入令牌派生隔离作用域。'
      }
    },
    'construction.timeoutMs': {
      index: 2,
      whenToUse: {
        en: 'Use false to rely solely on caller cancellation; use a finite budget when construction must finish within a deadline.',
        zh: '只依赖调用者取消时用 false；要求构造限时完成时设置有限预算。'
      }
    }
  },
  createRemoteHost: {
    endpointFactory: {
      index: 0,
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      }
    },
    report: {
      index: 0,
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      }
    },
    keyFactory: {
      index: 0,
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      }
    },
    callGuard: {
      index: 0,
      whenToUse: {
        en: 'Use the actual application binding and diagnostic owner; generate keys and check admission before the original dispatch.',
        zh: '使用实际应用绑定与诊断所有者，在原派发前生成键并检查准入。'
      }
    }
  },
  createRemotePlugin: {
    endpointFactory: {
      index: 0,
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      }
    },
    report: {
      index: 0,
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      }
    },
    keyFactory: {
      index: 0,
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      }
    },
    callGuard: {
      index: 0,
      whenToUse: {
        en: 'Keep proxy construction, diagnostics, logical keys and admission with the actual owning Host and generation binding.',
        zh: '将代理构造、诊断、逻辑键和准入留给实际拥有的宿主及代次绑定。'
      }
    }
  },
  createRemoteRetryPort: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Report secondary retry or cleanup failures through the original application diagnostic owner.',
        zh: '通过原应用诊断所有者报告重试或清理的次要失败。'
      }
    }
  },
  serveRemoteHost: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      }
    },
    resolvePlugin: {
      index: 0,
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      }
    }
  },
  serveRemotePlugin: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      }
    },
    invocationContext: {
      index: 0,
      whenToUse: {
        en: 'Use local callbacks from the actual serving owner; invocationContext remains local and is not serialized as application arguments.',
        zh: '使用实际服务所有者的本地回调；invocationContext 留在本地，不作为业务参数序列化。'
      }
    }
  },
  createManagedRuntimePeer: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    keyFactory: {
      index: 0,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    retryPort: {
      index: 0,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    endpointFactory: {
      index: 2,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    spawn: {
      index: 3,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    connect: {
      index: 3,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    listen: {
      index: 3,
      whenToUse: {
        en: 'Use the managed registration’s original binding and diagnostics; inherited direct-source callbacks do not replace binding.openChannel.',
        zh: '使用托管登记的原绑定和诊断；继承的直接来源回调不会替代 binding.openChannel。'
      }
    },
    authentication: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual managed endpoints.',
        zh: '在两个实际托管端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.encrypt': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual managed endpoints.',
        zh: '在两个实际托管端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.decrypt': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual managed endpoints.',
        zh: '在两个实际托管端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.sign': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual managed endpoints.',
        zh: '在两个实际托管端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.verify': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual managed endpoints.',
        zh: '在两个实际托管端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.encodedType': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual managed endpoints.',
        zh: '在两个实际托管端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    }
  },
  createCoroutinePlugin: {
    task: {
      index: 0,
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      }
    },
    connect: {
      index: 0,
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      }
    },
    report: {
      index: 0,
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      }
    },
    keyFactory: {
      index: 1,
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      }
    },
    retryPort: {
      index: 1,
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      }
    },
    endpointFactory: {
      index: 2,
      whenToUse: {
        en: 'Use the actual parent task and its opaque child token; retain the original callback owner and reject unavailable application construction.',
        zh: '使用实际父任务和不透明子令牌，保留原回调所有者，并拒绝不可用的应用构造。'
      }
    },
    authentication: {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual coroutine peers.',
        zh: '在两个实际协程对端上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.encrypt': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual coroutine peers.',
        zh: '在两个实际协程对端上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.decrypt': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual coroutine peers.',
        zh: '在两个实际协程对端上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.sign': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual coroutine peers.',
        zh: '在两个实际协程对端上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.verify': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual coroutine peers.',
        zh: '在两个实际协程对端上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.encodedType': {
      index: 1,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on both actual coroutine peers.',
        zh: '在两个实际协程对端上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    resolvePlugin: {
      index: 3,
      whenToUse: {
        en: 'Return a local real definition only for names in the catalog of the same exposed Host.',
        zh: '只为同一已公开宿主目录中的名称返回本地真实定义。'
      }
    }
  },
  createRuntimePlugin: {
    report: {
      index: 0,
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      }
    },
    connect: {
      index: 0,
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      }
    },
    resolvePlugin: {
      index: 1,
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      }
    },
    endpointFactory: {
      index: 2,
      whenToUse: {
        en: 'Reuse actual Host integration and original channel resources; local callbacks retain acquisition, resolution and diagnostic ownership.',
        zh: '复用实际宿主集成与原通道资源，由本地回调保留取得资源、解析和诊断所有权。'
      }
    },
    keyFactory: {
      index: 3,
      whenToUse: {
        en: 'Supply local logical-key or retry policy only for the actual installed dispatch path; direct borrowed Peer dispatch may leave them unused.',
        zh: '只为实际安装的派发路径提供本地逻辑键或重试策略；直接借入 Peer 的派发可能不使用它们。'
      }
    },
    retryPort: {
      index: 3,
      whenToUse: {
        en: 'Supply local logical-key or retry policy only for the actual installed dispatch path; direct borrowed Peer dispatch may leave them unused.',
        zh: '只为实际安装的派发路径提供本地逻辑键或重试策略；直接借入 Peer 的派发可能不使用它们。'
      }
    },
    authentication: {
      index: 4,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on the two original adapter endpoints.',
        zh: '在两个原始适配器端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.encrypt': {
      index: 4,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on the two original adapter endpoints.',
        zh: '在两个原始适配器端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.decrypt': {
      index: 4,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on the two original adapter endpoints.',
        zh: '在两个原始适配器端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.sign': {
      index: 4,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on the two original adapter endpoints.',
        zh: '在两个原始适配器端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.verify': {
      index: 4,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on the two original adapter endpoints.',
        zh: '在两个原始适配器端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    'authentication.encodedType': {
      index: 4,
      whenToUse: {
        en: 'Configure `encrypt` with `decrypt`, and `sign` with `verify`, on the two original adapter endpoints.',
        zh: '在两个原始适配器端点上配置 `encrypt` 与 `decrypt`、`sign` 与 `verify`。'
      }
    },
    spawn: {
      index: 5,
      whenToUse: {
        en: 'Choose exactly one source input interpreted by the actual platform peer factory; preserve that factory’s acquisition semantics.',
        zh: '选择由实际平台对端工厂解释的一种来源输入，并保留该工厂的资源取得语义。'
      }
    },
    listen: {
      index: 5,
      whenToUse: {
        en: 'Choose exactly one source input interpreted by the actual platform peer factory; preserve that factory’s acquisition semantics.',
        zh: '选择由实际平台对端工厂解释的一种来源输入，并保留该工厂的资源取得语义。'
      }
    }
  }
}
