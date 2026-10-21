import type { ICaseDoc, IText } from './contract.js'

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
