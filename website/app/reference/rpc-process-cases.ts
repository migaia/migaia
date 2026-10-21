import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Each option story covers one application decision; external I/O remains application-owned. */
export const processReaderOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  createProcessPeer: [
    {
      title: {
        en: 'Move pricing work into its own process',
        zh: '把价格计算移到独立进程'
      },
      problem: {
        en: 'Checkout must keep expensive price calculations off the main process. pricing-child.ts provides the prices method using child bootstrap discovery. Pass its entry URL to spawn so checkout owns the helper and closes it when the screen leaves.',
        zh: '结算页需要把昂贵的价格计算移出主进程。pricing-child.ts 通过子进程引导发现提供 prices 方法；把其入口 URL 交给 spawn，由结算页持有辅助进程，并在离开时关闭。'
      },
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\ntype IPricing = { prices(): number[] }\nconst prices = await createProcessPeer<IPricing>({\n  spawn: new URL('./pricing-child.ts', import.meta.url),\n  defaultTimeoutMs: 2000,\n  report: (error) => reportToMonitoring(error)\n})\ntry {\n  renderPrices(await prices.request('prices'))\n} finally {\n  await prices.close()\n}",
      result: {
        en: 'Checkout receives the helper’s prices and releases the owned process after use.',
        zh: '结算页取得辅助进程的价格，并在用完后释放所持有的进程。'
      },
      covers: ['spawn', 'defaultTimeoutMs', 'report']
    },
    {
      title: {
        en: 'Connect checkout to the existing price daemon',
        zh: '连接已有价格守护进程'
      },
      problem: {
        en: 'The price daemon already runs and is shared by several screens. Connect by its application name and credential instead of launching another process. Bound connection setup so the screen can offer retry if the daemon is unavailable.',
        zh: '价格守护进程已运行，供多个界面共用。使用其应用名称与凭据连接，避免另启进程；限制连接准备时间，使服务不可用时界面能够提示重试。'
      },
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\nconst prices = await createProcessPeer({\n  connect: pricingServiceName,\n  token: pricingToken,\n  connectTimeoutMs: 2000\n})\nonCheckoutClosed(() => prices.close())",
      result: {
        en: 'Checkout owns this local session; closing it leaves the external daemon under its original owner.',
        zh: '结算页只持有本次本地会话；关闭会话后，外部守护进程仍由原所有者管理。'
      },
      covers: ['connect', 'token', 'connectTimeoutMs']
    },
    {
      title: {
        en: 'Admit checkout clients before serving prices',
        zh: '先接纳结算客户端再提供价格'
      },
      problem: {
        en: 'A shared local price daemon must distinguish permitted clients of the same operating-system user. Verify their application credential and return the admitted account identity, then limit concurrent lookups.',
        zh: '本地价格守护进程需要区分同一系统用户下哪些客户端获准访问。校验应用凭据并返回获准账户身份，再限制并发价格查询。'
      },
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\nconst service = await createProcessPeer({\n  listen: pricingServiceName,\n  token: pricingToken,\n  verify: (credential) => verifyCheckoutCredential(credential),\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})\nonServiceClosed(() => service.close())",
      result: {
        en: 'Only admitted sessions can call prices, and provider work has an explicit concurrency budget.',
        zh: '只有获准会话能调用价格方法，处理任务也有明确并发预算。'
      },
      covers: ['listen', 'token', 'verify', 'provide', 'providerLimits']
    }
  ],
  createProcessPlugin: [
    {
      title: {
        en: 'Install the existing price service in a host',
        zh: '把已有价格服务安装到宿主'
      },
      problem: {
        en: 'Several features need the same existing price daemon. Install one named process plugin in the application host so its process outlet and session cleanup share that host’s lifetime.',
        zh: '多个功能需要共用已有价格守护进程。在应用宿主安装一个具名进程插件，让进程出口与会话清理共用宿主的生命周期。'
      },
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\ntype IPricing = { prices(): number[] }\nconst pricing = createProcessPlugin<IPricing>({\n  name: 'pricing',\n  connect: pricingServiceName,\n  defaultTimeoutMs: 2000\n})\nawait applicationHost.use(pricing)\nonApplicationClosed(() => applicationHost.dispose())",
      result: {
        en: 'The host owns the installed pricing session and releases it at application shutdown.',
        zh: '宿主持有安装后的价格会话，并在应用退出时释放。'
      },
      covers: ['name', 'connect', 'defaultTimeoutMs']
    },
    {
      title: {
        en: 'Offer checkout callbacks to the price daemon',
        zh: '向价格服务提供结算回调'
      },
      problem: {
        en: 'The price daemon needs the current checkout currency while preparing a quote. Provide only that callback API and its matching contract, with bounded concurrent work.',
        zh: '价格服务准备报价时需要读取当前结算币种。只提供该回调接口及匹配契约，并限制处理任务并发。'
      },
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  self: { name: 'checkout', instanceId: checkoutInstanceId },\n  provide: { checkout: { api: { currency: () => selectedCurrency() } } },\n  contract: checkoutContract,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})",
      result: {
        en: 'The remote daemon can call the declared currency callback without opening other local methods.',
        zh: '远端守护进程可调用声明的币种回调，不会因此公开其他本地方法。'
      },
      covers: ['self', 'provide', 'contract', 'providerLimits']
    },
    {
      title: {
        en: 'Expose only approved host administration',
        zh: '只公开获准的宿主管理'
      },
      problem: {
        en: 'An administrator must install only plugins in the application’s declared catalog. Expose host controls explicitly and use the same host that owns this process plugin; resolve only catalog-admitted names.',
        zh: '管理员只能安装应用目录中声明的插件。显式公开宿主控制，并使用安装当前进程插件的同一宿主；只解析目录接纳的名称。'
      },
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst administration = createProcessPlugin({\n  ...pricingPluginOptions,\n  expose: ['host'],\n  host: applicationHost,\n  catalog: approvedCatalog,\n  resolvePlugin: (name, config) => resolveApprovedPlugin(name, config)\n})",
      result: {
        en: 'The remote administration path is limited to the declared catalog on this host.',
        zh: '远端管理路径的范围限于该宿主声明的目录。'
      },
      covers: ['expose', 'host', 'catalog', 'resolvePlugin']
    }
  ],
  createAdapterProcessPeer: [
    {
      title: {
        en: 'Move pricing work into its own process',
        zh: '把价格计算移到独立进程'
      },
      problem: {
        en: 'Checkout must keep expensive price calculations off the main process. pricing-child.ts provides the prices method using child bootstrap discovery. Pass its entry URL to spawn so checkout owns the helper and closes it when the screen leaves.',
        zh: '结算页需要把昂贵的价格计算移出主进程。pricing-child.ts 通过子进程引导发现提供 prices 方法；把其入口 URL 交给 spawn，由结算页持有辅助进程，并在离开时关闭。'
      },
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\ntype IPricing = { prices(): number[] }\nconst prices = await createAdapterProcessPeer<IPricing>({\n  spawn: new URL('./pricing-child.ts', import.meta.url),\n  defaultTimeoutMs: 2000,\n  report: (error) => reportToMonitoring(error)\n}, runtimeLoader)\ntry {\n  renderPrices(await prices.request('prices'))\n} finally {\n  await prices.close()\n}",
      result: {
        en: 'Checkout receives the helper’s prices and releases the owned process after use.',
        zh: '结算页取得辅助进程的价格，并在用完后释放所持有的进程。'
      },
      covers: ['spawn', 'defaultTimeoutMs', 'report']
    },
    {
      title: {
        en: 'Connect checkout to the existing price daemon',
        zh: '连接已有价格守护进程'
      },
      problem: {
        en: 'The price daemon already runs and is shared by several screens. Connect by its application name and credential instead of launching another process. Bound connection setup so the screen can offer retry if the daemon is unavailable.',
        zh: '价格守护进程已运行，供多个界面共用。使用其应用名称与凭据连接，避免另启进程；限制连接准备时间，使服务不可用时界面能够提示重试。'
      },
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\nconst prices = await createAdapterProcessPeer({\n  connect: pricingServiceName,\n  token: pricingToken,\n  connectTimeoutMs: 2000\n}, runtimeLoader)\nonCheckoutClosed(() => prices.close())",
      result: {
        en: 'Checkout owns this local session; closing it leaves the external daemon under its original owner.',
        zh: '结算页只持有本次本地会话；关闭会话后，外部守护进程仍由原所有者管理。'
      },
      covers: ['connect', 'token', 'connectTimeoutMs']
    },
    {
      title: {
        en: 'Admit checkout clients before serving prices',
        zh: '先接纳结算客户端再提供价格'
      },
      problem: {
        en: 'A shared local price daemon must distinguish permitted clients of the same operating-system user. Verify their application credential and return the admitted account identity, then limit concurrent lookups.',
        zh: '本地价格守护进程需要区分同一系统用户下哪些客户端获准访问。校验应用凭据并返回获准账户身份，再限制并发价格查询。'
      },
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\nconst service = await createAdapterProcessPeer({\n  listen: pricingServiceName,\n  token: pricingToken,\n  verify: (credential) => verifyCheckoutCredential(credential),\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, runtimeLoader)\nonServiceClosed(() => service.close())",
      result: {
        en: 'Only admitted sessions can call prices, and provider work has an explicit concurrency budget.',
        zh: '只有获准会话能调用价格方法，处理任务也有明确并发预算。'
      },
      covers: ['listen', 'token', 'verify', 'provide', 'providerLimits']
    }
  ],
  createAdapterProcessPlugin: [
    {
      title: {
        en: 'Install the existing price service in a host',
        zh: '把已有价格服务安装到宿主'
      },
      problem: {
        en: 'Several features need the same existing price daemon. Install one named process plugin in the application host so its process outlet and session cleanup share that host’s lifetime.',
        zh: '多个功能需要共用已有价格守护进程。在应用宿主安装一个具名进程插件，让进程出口与会话清理共用宿主的生命周期。'
      },
      example:
        "import { createAdapterProcessPlugin } from '@migaia/rpc-process'\n\ntype IPricing = { prices(): number[] }\nconst pricing = createAdapterProcessPlugin<IPricing>({\n  name: 'pricing',\n  connect: pricingServiceName,\n  defaultTimeoutMs: 2000\n}, runtimeLoader)\nawait applicationHost.use(pricing)\nonApplicationClosed(() => applicationHost.dispose())",
      result: {
        en: 'The host owns the installed pricing session and releases it at application shutdown.',
        zh: '宿主持有安装后的价格会话，并在应用退出时释放。'
      },
      covers: ['name', 'connect', 'defaultTimeoutMs']
    },
    {
      title: {
        en: 'Offer checkout callbacks to the price daemon',
        zh: '向价格服务提供结算回调'
      },
      problem: {
        en: 'The price daemon needs the current checkout currency while preparing a quote. Provide only that callback API and its matching contract, with bounded concurrent work.',
        zh: '价格服务准备报价时需要读取当前结算币种。只提供该回调接口及匹配契约，并限制处理任务并发。'
      },
      example:
        "import { createAdapterProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  self: { name: 'checkout', instanceId: checkoutInstanceId },\n  provide: { checkout: { api: { currency: () => selectedCurrency() } } },\n  contract: checkoutContract,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, runtimeLoader)",
      result: {
        en: 'The remote daemon can call the declared currency callback without opening other local methods.',
        zh: '远端守护进程可调用声明的币种回调，不会因此公开其他本地方法。'
      },
      covers: ['self', 'provide', 'contract', 'providerLimits']
    },
    {
      title: {
        en: 'Expose only approved host administration',
        zh: '只公开获准的宿主管理'
      },
      problem: {
        en: 'An administrator must install only plugins in the application’s declared catalog. Expose host controls explicitly and use the same host that owns this process plugin; resolve only catalog-admitted names.',
        zh: '管理员只能安装应用目录中声明的插件。显式公开宿主控制，并使用安装当前进程插件的同一宿主；只解析目录接纳的名称。'
      },
      example:
        "import { createAdapterProcessPlugin } from '@migaia/rpc-process'\n\nconst administration = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  expose: ['host'],\n  host: applicationHost,\n  catalog: approvedCatalog,\n  resolvePlugin: (name, config) => resolveApprovedPlugin(name, config)\n}, runtimeLoader)",
      result: {
        en: 'The remote administration path is limited to the declared catalog on this host.',
        zh: '远端管理路径的范围限于该宿主声明的目录。'
      },
      covers: ['expose', 'host', 'catalog', 'resolvePlugin']
    }
  ],
  fullProcessPlugin: [
    {
      title: {
        en: 'Keep one owner for the advanced pricing deployment',
        zh: '为高级价格部署保留单一所有者'
      },
      problem: {
        en: 'The application already owns a full deployment, endpoint factory and host-control port. Register the proxy under the same pricing name as its contract and local host registration so cleanup targets the installed plugin.',
        zh: '应用已持有完整部署、端点工厂与宿主控制接口。代理名称须与契约和本地宿主登记中的 pricing 一致，清理才会指向实际安装的插件。'
      },
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      result: {
        en: 'The advanced proxy keeps deployment ownership and cleanup attached to its actual local registration.',
        zh: '高级代理把部署所有权与清理责任留在真实本地登记上。'
      },
      covers: [
        'name',
        'contract',
        'registrationOwner',
        'registrationOwner.name',
        'registrationOwner.host',
        'deployment'
      ]
    },
    {
      title: {
        en: 'Reuse one logical result when an order call retries',
        zh: '订单重试时复用同一逻辑结果'
      },
      problem: {
        en: 'A declared idempotent remote order method can be retried after reconnecting. Give the advanced proxy a logical-key generator and the application’s retry port, while sharing its process governor.',
        zh: '声明为幂等的远端订单方法可能在重连后重试。给高级代理提供逻辑键生成器与应用重试端口，同时共用进程治理对象。'
      },
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  resilience: processGovernor,\n  keyFactory: () => crypto.randomUUID(),\n  retryPort: orderRetryPolicy\n})",
      result: {
        en: 'Managed process dispatch uses these logical-key and retry policies for declared idempotent methods.',
        zh: '托管进程派发为声明为幂等的方法使用这些逻辑键与重试策略。'
      },
      covers: ['resilience', 'keyFactory', 'retryPort']
    }
  ],
  createProcessTransport: [
    {
      title: {
        en: 'Authenticate an application-owned byte connection',
        zh: '认证应用持有的字节连接'
      },
      problem: {
        en: 'The application already opened a raw pipe or socket for pricing. Initiate its native handshake with the local offer and credential; Process negotiates the channel while the application keeps native process ownership.',
        zh: '应用已为价格服务打开原始管道或套接字。使用本地提议与凭据发起原生握手；Process 协商通道，原生进程的所有权仍留在应用。'
      },
      example:
        "import { createNativeProcessOffer, createProcessTransport } from '@migaia/rpc-process'\n\nconst channel = await createProcessTransport(rawByteChannel, {\n  role: 'initiator',\n  peerId: 'pricing-service',\n  offer: createNativeProcessOffer({\n    peer: { id: 'checkout', runtime: 'bun' }, auth: pricingToken\n  }),\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error),\n  ipc: sessionDiagnostics\n})",
      result: {
        en: 'The application gets a negotiated pricing channel without transferring ownership of its process.',
        zh: '应用取得已协商的价格通道，同时保留进程所有权。'
      },
      covers: ['role', 'peerId', 'offer', 'scheduler', 'report', 'ipc']
    },
    {
      title: {
        en: 'Verify clients on an incoming byte connection',
        zh: '验证入站字节连接的客户端'
      },
      problem: {
        en: 'A service already accepted a raw connection and must admit the caller before business traffic starts. Required authentication runs the application credential verifier during the responder handshake.',
        zh: '服务已接入原始连接，需要在业务通信前接纳调用方。响应方握手中的必需认证会调用应用凭据校验函数。'
      },
      example:
        "import { createProcessTransport } from '@migaia/rpc-process'\n\nconst channel = await createProcessTransport(acceptedByteChannel, {\n  ...responderOptions,\n  role: 'responder',\n  auth: {\n    mode: 'required',\n    verify: (credential) => verifyCheckoutCredential(credential)\n  }\n})",
      result: {
        en: 'The service receives a negotiated channel only after its credential policy accepts the caller.',
        zh: '服务只有在凭据策略接纳调用方后，才取得已协商通道。'
      },
      covers: ['auth', 'auth.mode', 'auth.verify']
    },
    {
      title: {
        en: 'Preserve native message boundaries',
        zh: '保留原生消息边界'
      },
      problem: {
        en: 'A native MessagePort carrier already delivers complete values. Both owners agree the same identity codec and capability order so Process can keep these values as messages instead of byte-encoding them.',
        zh: '原生 MessagePort 载体已交付完整值。两端约定同一 identity 编解码器及能力顺序，使 Process 将值保留为消息，而非转换为字节编码。'
      },
      example:
        "import { createProcessTransport } from '@migaia/rpc-process'\n\nconst profile = { codec: 'identity' as const, capabilities: agreedCapabilities }\nconst channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: profile, peer: profile }\n})",
      result: {
        en: 'The native message path uses the agreed static profile; actual acceptance remains with Core.',
        zh: '原生消息路径使用约定的静态配置，实际接纳仍由 Core 负责。'
      },
      covers: [
        'staticAgreement',
        'staticAgreement.local',
        'staticAgreement.peer',
        'staticAgreement.local.codec',
        'staticAgreement.peer.codec'
      ]
    }
  ],
  createNativeProcessOffer: [
    {
      title: {
        en: 'Advertise a live price feed',
        zh: '声明实时价格流'
      },
      problem: {
        en: 'A pricing helper provides an iterable live feed. Advertise stream explicitly along with its runtime extension; the later handshake still selects the bilateral agreement.',
        zh: '价格辅助进程提供可迭代的实时数据流。显式声明流及其运行时扩展；双方最终约定仍由后续握手选择。'
      },
      example:
        "import { createNativeProcessOffer } from '@migaia/rpc-process'\n\nconst offer = createNativeProcessOffer({\n  peer: { id: 'price-feed', runtime: 'node' },\n  auth: pricingToken,\n  stream: true,\n  capabilities: ['runtime-api@1']\n})",
      result: {
        en: 'The proposal includes live-feed support while keeping the credential out of diagnostics.',
        zh: '提议包含实时流支持，凭据不进入诊断标签。'
      },
      covers: ['peer', 'auth', 'stream', 'capabilities']
    },
    {
      title: {
        en: 'Keep a lookup-only helper scalar',
        zh: '让只查询的辅助进程保持标量'
      },
      problem: {
        en: 'A legacy helper only returns complete lookup results. Disable streams and use an explicit empty extension list so runtime completion does not widen this proposal.',
        zh: '旧辅助进程只返回完整查询结果。禁用流并显式传入空扩展列表，避免运行时补全扩大此提议。'
      },
      example:
        "import { createNativeProcessOffer } from '@migaia/rpc-process'\n\nconst offer = createNativeProcessOffer({\n  peer: { id: 'price-lookup', runtime: 'node' },\n  stream: false,\n  capabilities: []\n})",
      result: {
        en: 'The proposal stays limited to its base controls and scalar use.',
        zh: '提议保持基础控制与标量用途。'
      },
      covers: ['peer', 'stream', 'capabilities']
    }
  ],
  createProcessJsonRpcChannel: [
    {
      title: {
        en: 'Call the foreign pricing plugin',
        zh: '调用外部语言的价格插件'
      },
      problem: {
        en: 'An existing foreign-language price service implements Migaia’s hello, describe, invoke and cancel extensions. Select its declared plugin contract so only those methods become callable; this is not a generic JSON-RPC client.',
        zh: '已有外部语言价格服务实现 Migaia 的 hello、describe、invoke 和 cancel 扩展。选择声明的插件契约，只公开其中的方法；这不是通用 JSON-RPC 客户端。'
      },
      example:
        "import { createProcessJsonRpcChannel } from '@migaia/rpc-process'\n\nconst channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  byte: pricingByteChannel,\n  peerId: 'foreign-pricing',\n  target: { kind: 'plugin', contract: pricingContract },\n  offer: jsonRpcOffer\n})\nonServiceClosed(() => channel.close())",
      result: {
        en: 'The returned channel addresses only the pricing plugin’s declared methods.',
        zh: '返回通道只使用价格插件声明的方法。'
      },
      covers: ['byte', 'peerId', 'target', 'target.kind', 'target.contract', 'offer']
    },
    {
      title: {
        en: 'Bridge the approved plugin catalog',
        zh: '桥接获准的插件目录'
      },
      problem: {
        en: 'An existing foreign-language service implements Migaia’s hello, describe, invoke and cancel extensions. Its host target is restricted to the approved catalog; a general JSON-RPC server cannot satisfy this protocol.',
        zh: '已有外部语言服务实现 Migaia 的 hello、describe、invoke 和 cancel 扩展。宿主目标的范围限于获准目录；通用 JSON-RPC 服务无法满足这份协议。'
      },
      example:
        "import { createProcessJsonRpcChannel } from '@migaia/rpc-process'\n\nconst channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  byte: pricingByteChannel,\n  peerId: 'foreign-pricing',\n  target: { kind: 'host', catalog: approvedCatalog },\n  offer: jsonRpcOffer\n})\nonServiceClosed(() => channel.close())",
      result: {
        en: 'The returned channel addresses only the declared catalog.',
        zh: '返回通道的范围限于声明的目录。'
      },
      covers: ['byte', 'peerId', 'target', 'target.kind', 'target.catalog', 'offer']
    }
  ],
  openProcessObjectChannel: [
    {
      title: {
        en: 'Add process diagnostics to an existing connection',
        zh: '给已有连接附加进程诊断'
      },
      problem: {
        en: 'The application’s platform integration already owns a genuine negotiated Core object connection. Open that same connection with process session diagnostics; this API does not create negotiation authority from a plain object.',
        zh: '应用的平台集成已持有真实协商完成的 Core 对象连接。给同一连接加上进程会话诊断再打开；此 API 不能让普通对象获得协商权限。'
      },
      example:
        "import { openProcessObjectChannel } from '@migaia/rpc-process'\n\nconst channel = openProcessObjectChannel(negotiatedConnection, {\n  peerId: 'pricing-service',\n  ipc: sessionDiagnostics,\n  report: (error) => reportToMonitoring(error)\n})",
      result: {
        en: 'The opened channel retains the original connection and attaches the selected process diagnostics.',
        zh: '打开后的通道保留原连接，并附加所选进程诊断。'
      },
      covers: ['peerId', 'ipc', 'report']
    },
    {
      title: {
        en: 'Bound setup of the held connection',
        zh: '限制所持有连接的准备时间'
      },
      problem: {
        en: 'A view can leave while its held connection is opening. Pass the view signal and a handshake budget so that setup observes its owner’s cancellation and waiting policy.',
        zh: '视图可能在所持有连接准备期间离开。传入视图信号与握手预算，让准备过程遵守所有者的取消与等待策略。'
      },
      example:
        "import { openProcessObjectChannel } from '@migaia/rpc-process'\n\nconst channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  scheduler: applicationScheduler,\n  signal: viewController.signal,\n  handshakeTimeoutMs: 3000\n})",
      result: {
        en: 'Connection opening uses the view’s signal and the selected setup budget.',
        zh: '连接准备使用视图信号及所选预算。'
      },
      covers: ['scheduler', 'signal', 'handshakeTimeoutMs']
    }
  ],
  createProcessResilience: [
    {
      title: {
        en: 'Bound a shared pricing daemon’s load',
        zh: '限制共享价格守护进程的负载'
      },
      problem: {
        en: 'A shared price daemon needs explicit admission budgets so many checkout sessions cannot exhaust it with concurrent or oversized requests. Keep its quotas with one process governor.',
        zh: '共享价格守护进程需要明确的准入预算，避免大量结算会话通过并发或过大请求耗尽资源。用一个进程治理对象持有这些配额。'
      },
      example:
        "import { createProcessResilience } from '@migaia/rpc-process'\n\nconst governor = createProcessResilience({\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error),\n  maxConnections: 32,\n  maxConcurrentCallsPerConnection: 8,\n  maxCallsPerMinute: 120,\n  maxPayloadBytes: 256 * 1024\n})\nonApplicationClosed(() => governor.close())",
      result: {
        en: 'The shared governor supplies connection, concurrency, request-rate and payload admission limits.',
        zh: '共享治理对象提供连接、并发、请求速率和载荷的准入限制。'
      },
      covers: [
        'scheduler',
        'report',
        'maxConnections',
        'maxConcurrentCallsPerConnection',
        'maxCallsPerMinute',
        'maxPayloadBytes'
      ]
    },
    {
      title: {
        en: 'Retire unhealthy sessions without losing retry results',
        zh: '结束异常会话并保留重试结果'
      },
      problem: {
        en: 'A pricing session that stays idle or repeatedly times out should release resources. Reuse the application outcome store across reconnects, and give accepted work a short drain window when closing.',
        zh: '价格会话长期空闲或反复超时时应释放资源。重连时复用应用结果存储，并在关闭时留出短暂排空窗口，供已接受的任务完成。'
      },
      example:
        "import { createProcessResilience } from '@migaia/rpc-process'\n\nconst governor = createProcessResilience({\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error),\n  idempotencyStore: orderOutcomes,\n  maxConsecutiveTimeouts: 3,\n  idleTimeoutMs: 30000,\n  drainMs: 2000\n})",
      result: {
        en: 'Expired sessions can retire while keyed retries keep using the selected outcome store.',
        zh: '过期会话可以结束，携带幂等键的重试继续使用所选结果存储。'
      },
      covers: ['idempotencyStore', 'maxConsecutiveTimeouts', 'idleTimeoutMs', 'drainMs']
    },
    {
      title: {
        en: 'Suspend dependent features after terminal pricing failure',
        zh: '价格服务终态失败后挂起依赖功能'
      },
      problem: {
        en: 'If pricing reaches a terminal state, checkout features that depend on it should stop receiving work while operators investigate. Keep dependants installed but suspended, and schedule escalating terminal reports.',
        zh: '价格服务进入终态后，依赖它的结算功能应停止接收任务，等待排查。保留依赖功能的安装状态并将其挂起，同时安排逐步升级的终态上报。'
      },
      example:
        "import { createProcessResilience } from '@migaia/rpc-process'\n\nconst governor = createProcessResilience({\n  scheduler: applicationScheduler,\n  report: (error) => reportToMonitoring(error),\n  reportAtMs: [0, 10000, 60000],\n  unhandledLimit: 2,\n  liquidation: { cascade: false }\n})",
      result: {
        en: 'Unhandled terminal reports follow the selected schedule; liquidation suspends dependants.',
        zh: '未处理终态报告按所选时序上报，清算时挂起依赖功能。'
      },
      covers: ['reportAtMs', 'unhandledLimit', 'liquidation', 'liquidation.cascade']
    }
  ],
  createNodeProcessLauncher: [
    {
      title: {
        en: 'Carry an advanced launch’s child identity',
        zh: '携带高级启动的子端身份'
      },
      problem: {
        en: 'A custom runtime launcher already has the parent Peer identity and the supervisor-issued generation for this launch. Forward those values when preparing runtime bootstrap; ordinary short sources do this automatically.',
        zh: '自定义运行时启动器已持有父 Peer 身份与监督器为本次启动签发的代次。准备运行时引导时转交这些值；普通简写来源会自动处理。'
      },
      example:
        "import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\n\nconst launcher = createNodeProcessLauncher({\n  runtimeApiBootstrap: {\n    name: 'pricing',\n    parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration\n  }\n})",
      result: {
        en: 'The launcher carries the application’s existing runtime identity into this child bootstrap.',
        zh: '启动器把应用已有的运行时身份带入本次子端引导。'
      },
      covers: [
        'runtimeApiBootstrap',
        'runtimeApiBootstrap.name',
        'runtimeApiBootstrap.parentInstanceId',
        'runtimeApiBootstrap.generation'
      ]
    },
    {
      title: {
        en: 'Use the runtime’s ordinary launch context',
        zh: '使用运行时原有启动上下文'
      },
      problem: {
        en: 'A standard runtime source already supplies the native launcher’s held Core context. Keep the default constructor instead of rebuilding identities or inventing a generation counter in application code.',
        zh: '标准运行时来源已向原生启动器提供其持有的 Core 上下文。使用默认构造，不在应用代码中重建身份或自造代次计数。'
      },
      example:
        "import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\n\nconst launcher = createNodeProcessLauncher()",
      result: {
        en: 'The original runtime source supplies bootstrap identity when it performs the launch.',
        zh: '执行启动时，由原运行时来源提供引导身份。'
      },
      covers: []
    }
  ],
  createBunProcessLauncher: [
    {
      title: {
        en: 'Carry an advanced launch’s child identity',
        zh: '携带高级启动的子端身份'
      },
      problem: {
        en: 'A custom runtime launcher already has the parent Peer identity and the supervisor-issued generation for this launch. Forward those values when preparing runtime bootstrap; ordinary short sources do this automatically.',
        zh: '自定义运行时启动器已持有父 Peer 身份与监督器为本次启动签发的代次。准备运行时引导时转交这些值；普通简写来源会自动处理。'
      },
      example:
        "import { createBunProcessLauncher } from '@migaia/rpc-process/adapters/bun-spawn'\n\nconst launcher = createBunProcessLauncher({\n  runtimeApiBootstrap: {\n    name: 'pricing',\n    parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration\n  }\n})",
      result: {
        en: 'The launcher carries the application’s existing runtime identity into this child bootstrap.',
        zh: '启动器把应用已有的运行时身份带入本次子端引导。'
      },
      covers: [
        'runtimeApiBootstrap',
        'runtimeApiBootstrap.name',
        'runtimeApiBootstrap.parentInstanceId',
        'runtimeApiBootstrap.generation'
      ]
    },
    {
      title: {
        en: 'Use the runtime’s ordinary launch context',
        zh: '使用运行时原有启动上下文'
      },
      problem: {
        en: 'A standard runtime source already supplies the native launcher’s held Core context. Keep the default constructor instead of rebuilding identities or inventing a generation counter in application code.',
        zh: '标准运行时来源已向原生启动器提供其持有的 Core 上下文。使用默认构造，不在应用代码中重建身份或自造代次计数。'
      },
      example:
        "import { createBunProcessLauncher } from '@migaia/rpc-process/adapters/bun-spawn'\n\nconst launcher = createBunProcessLauncher()",
      result: {
        en: 'The original runtime source supplies bootstrap identity when it performs the launch.',
        zh: '执行启动时，由原运行时来源提供引导身份。'
      },
      covers: []
    }
  ],
  createDenoProcessLauncher: [
    {
      title: {
        en: 'Carry an advanced launch’s child identity',
        zh: '携带高级启动的子端身份'
      },
      problem: {
        en: 'A custom runtime launcher already has the parent Peer identity and the supervisor-issued generation for this launch. Forward those values when preparing runtime bootstrap; ordinary short sources do this automatically.',
        zh: '自定义运行时启动器已持有父 Peer 身份与监督器为本次启动签发的代次。准备运行时引导时转交这些值；普通简写来源会自动处理。'
      },
      example:
        "import { createDenoProcessLauncher } from '@migaia/rpc-process/adapters/deno-command'\n\nconst launcher = createDenoProcessLauncher({\n  runtimeApiBootstrap: {\n    name: 'pricing',\n    parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration\n  }\n})",
      result: {
        en: 'The launcher carries the application’s existing runtime identity into this child bootstrap.',
        zh: '启动器把应用已有的运行时身份带入本次子端引导。'
      },
      covers: [
        'runtimeApiBootstrap',
        'runtimeApiBootstrap.name',
        'runtimeApiBootstrap.parentInstanceId',
        'runtimeApiBootstrap.generation'
      ]
    },
    {
      title: {
        en: 'Use the runtime’s ordinary launch context',
        zh: '使用运行时原有启动上下文'
      },
      problem: {
        en: 'A standard runtime source already supplies the native launcher’s held Core context. Keep the default constructor instead of rebuilding identities or inventing a generation counter in application code.',
        zh: '标准运行时来源已向原生启动器提供其持有的 Core 上下文。使用默认构造，不在应用代码中重建身份或自造代次计数。'
      },
      example:
        "import { createDenoProcessLauncher } from '@migaia/rpc-process/adapters/deno-command'\n\nconst launcher = createDenoProcessLauncher()",
      result: {
        en: 'The original runtime source supplies bootstrap identity when it performs the launch.',
        zh: '执行启动时，由原运行时来源提供引导身份。'
      },
      covers: []
    }
  ],
  createAdapterNodeProcessLaunch: [
    {
      title: {
        en: 'Prepare bootstrap before opening native pipes',
        zh: '打开原生管道前准备引导'
      },
      problem: {
        en: 'A custom launcher owns native spawning but needs Process to prepare its runtime bootstrap once. Pass the real spec and launch context with the application’s existing parent identity, then check cancellation before acquiring native resources.',
        zh: '自定义启动器负责原生进程创建，但需要 Process 只准备一次运行时引导。传入真实规格、启动上下文和应用已有的父端身份，再在取得原生资源前检查取消状态。'
      },
      example:
        "import { createAdapterNodeProcessLaunch } from '@migaia/rpc-process/adapters/node-child-process'\n\nconst launch = createAdapterNodeProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: {\n    name: 'pricing',\n    parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration\n  }\n})\nlaunch.assertActive()\nstartNativeProcess(processSpec, launch)",
      result: {
        en: 'Bootstrap preparation is ready for the caller’s native spawn; the helper does not spawn a process.',
        zh: '引导准备可供调用方原生启动使用；该辅助函数自身不创建进程。'
      },
      covers: [
        'runtimeApiBootstrap',
        'runtimeApiBootstrap.name',
        'runtimeApiBootstrap.parentInstanceId',
        'runtimeApiBootstrap.generation'
      ]
    },
    {
      title: {
        en: 'Keep token-only preparation for a legacy child',
        zh: '为旧子进程保留仅令牌引导'
      },
      problem: {
        en: 'A custom launch outside a held Core context serves a legacy child that only needs the spec’s token bootstrap. Leave runtimeApiBootstrap absent and retain the caller’s original native spawn path.',
        zh: '未持有 Core 上下文的自定义启动路径服务于只需规格令牌引导的旧子进程。省略 runtimeApiBootstrap，并保留调用方原有的原生启动路径。'
      },
      example:
        "import { createAdapterNodeProcessLaunch } from '@migaia/rpc-process/adapters/node-child-process'\n\nconst launch = createAdapterNodeProcessLaunch(processSpec, launchContext)\nlaunch.assertActive()\nstartNativeProcess(processSpec, launch)",
      result: {
        en: 'The helper retains the spec’s ordinary token-only bootstrap and native spawning stays with the caller.',
        zh: '辅助函数保留规格原有的仅令牌引导，原生启动仍由调用方负责。'
      },
      covers: []
    }
  ],
  createAdapterProcessLaunch: [
    {
      title: {
        en: 'Prepare bootstrap before opening native pipes',
        zh: '打开原生管道前准备引导'
      },
      problem: {
        en: 'A custom launcher owns native spawning but needs Process to prepare its runtime bootstrap once. Pass the real spec and launch context with the application’s existing parent identity, then check cancellation before acquiring native resources.',
        zh: '自定义启动器负责原生进程创建，但需要 Process 只准备一次运行时引导。传入真实规格、启动上下文和应用已有的父端身份，再在取得原生资源前检查取消状态。'
      },
      example:
        "import { createAdapterProcessLaunch } from '@migaia/rpc-process'\n\nconst launch = createAdapterProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: {\n    name: 'pricing',\n    parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration\n  }\n})\nlaunch.assertActive()\nstartNativeProcess(processSpec, launch)",
      result: {
        en: 'Bootstrap preparation is ready for the caller’s native spawn; the helper does not spawn a process.',
        zh: '引导准备可供调用方原生启动使用；该辅助函数自身不创建进程。'
      },
      covers: [
        'runtimeApiBootstrap',
        'runtimeApiBootstrap.name',
        'runtimeApiBootstrap.parentInstanceId',
        'runtimeApiBootstrap.generation'
      ]
    },
    {
      title: {
        en: 'Keep token-only preparation for a legacy child',
        zh: '为旧子进程保留仅令牌引导'
      },
      problem: {
        en: 'A custom launch outside a held Core context serves a legacy child that only needs the spec’s token bootstrap. Leave runtimeApiBootstrap absent and retain the caller’s original native spawn path.',
        zh: '未持有 Core 上下文的自定义启动路径服务于只需规格令牌引导的旧子进程。省略 runtimeApiBootstrap，并保留调用方原有的原生启动路径。'
      },
      example:
        "import { createAdapterProcessLaunch } from '@migaia/rpc-process'\n\nconst launch = createAdapterProcessLaunch(processSpec, launchContext)\nlaunch.assertActive()\nstartNativeProcess(processSpec, launch)",
      result: {
        en: 'The helper retains the spec’s ordinary token-only bootstrap and native spawning stays with the caller.',
        zh: '辅助函数保留规格原有的仅令牌引导，原生启动仍由调用方负责。'
      },
      covers: []
    }
  ],
  'adapters/node-child-process:openProcessStdioChannel': [
    {
      title: {
        en: 'Read the launcher’s prefix before serving RPC',
        zh: '服务 RPC 前读取启动器前缀'
      },
      problem: {
        en: 'The child’s stdin begins with the launcher’s bootstrap frame. Read it before handing the held byte channel to the native handshake; bound that initial wait so a misconfigured launch does not wait forever.',
        zh: '子端标准输入以启动器的引导帧开头。先读取该帧，再将所持有字节通道交给原生握手；限制首次等待，避免错误启动配置无限等待。'
      },
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n\nconst opened = await openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: 5000 })\nstartChildProtocol(opened.channel, opened.bootstrap)",
      result: {
        en: 'The result separates bootstrap bytes from the channel used for later RPC frames.',
        zh: '返回值将引导字节与供后续 RPC 帧使用的通道分开。'
      },
      covers: ['bootstrap', 'bootstrapTimeoutMs']
    },
    {
      title: {
        en: 'Open a pipe without a bootstrap prefix',
        zh: '打开没有引导前缀的管道'
      },
      problem: {
        en: 'An already trusted deployment starts its protocol directly on stdin. Select none so the stdio opener does not consume the first protocol frame as bootstrap.',
        zh: '已有受信任部署直接从标准输入开始协议。选择 none，避免标准流打开器把首个协议帧误当作引导帧消费。'
      },
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n\nconst opened = await openProcessStdioChannel({ bootstrap: 'none' })\nstartChildProtocol(opened.channel, opened.bootstrap)",
      result: {
        en: 'The original byte channel is ready without consuming a prefix.',
        zh: '原字节通道可直接使用，不消费前缀。'
      },
      covers: ['bootstrap']
    },
    {
      title: {
        en: 'Report an unsupported descriptor deployment',
        zh: '报告不支持的文件描述符部署'
      },
      problem: {
        en: 'A deployment descriptor requests fd bootstrap, but these stdio adapters support stdin and none only. Surface a configuration error so the launcher can be corrected to the supported stdin path.',
        zh: '部署描述请求 fd 引导，但这些标准流适配器只支持 stdin 与 none。把配置错误交给界面，便于将启动器改为受支持的标准输入路径。'
      },
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n\ntry {\n  await openProcessStdioChannel({ bootstrap: 'fd', fd: 3 })\n} catch (error) {\n  showLaunchConfigurationError(error)\n}",
      result: {
        en: 'The application can report the unsupported configuration instead of waiting for an unread descriptor.',
        zh: '应用可报告不支持的配置，不会一直等待无法读取的描述符。'
      },
      covers: ['bootstrap', 'fd']
    }
  ],
  'adapters/deno-command:openProcessStdioChannel': [
    {
      title: {
        en: 'Read the launcher’s prefix before serving RPC',
        zh: '服务 RPC 前读取启动器前缀'
      },
      problem: {
        en: 'The child’s stdin begins with the launcher’s bootstrap frame. Read it before handing the held byte channel to the native handshake; bound that initial wait so a misconfigured launch does not wait forever.',
        zh: '子端标准输入以启动器的引导帧开头。先读取该帧，再将所持有字节通道交给原生握手；限制首次等待，避免错误启动配置无限等待。'
      },
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/deno-command'\n\nconst opened = await openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: 5000 })\nstartChildProtocol(opened.channel, opened.bootstrap)",
      result: {
        en: 'The result separates bootstrap bytes from the channel used for later RPC frames.',
        zh: '返回值将引导字节与供后续 RPC 帧使用的通道分开。'
      },
      covers: ['bootstrap', 'bootstrapTimeoutMs']
    },
    {
      title: {
        en: 'Open a pipe without a bootstrap prefix',
        zh: '打开没有引导前缀的管道'
      },
      problem: {
        en: 'An already trusted deployment starts its protocol directly on stdin. Select none so the stdio opener does not consume the first protocol frame as bootstrap.',
        zh: '已有受信任部署直接从标准输入开始协议。选择 none，避免标准流打开器把首个协议帧误当作引导帧消费。'
      },
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/deno-command'\n\nconst opened = await openProcessStdioChannel({ bootstrap: 'none' })\nstartChildProtocol(opened.channel, opened.bootstrap)",
      result: {
        en: 'The original byte channel is ready without consuming a prefix.',
        zh: '原字节通道可直接使用，不消费前缀。'
      },
      covers: ['bootstrap']
    },
    {
      title: {
        en: 'Report an unsupported descriptor deployment',
        zh: '报告不支持的文件描述符部署'
      },
      problem: {
        en: 'A deployment descriptor requests fd bootstrap, but these stdio adapters support stdin and none only. Surface a configuration error so the launcher can be corrected to the supported stdin path.',
        zh: '部署描述请求 fd 引导，但这些标准流适配器只支持 stdin 与 none。把配置错误交给界面，便于将启动器改为受支持的标准输入路径。'
      },
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/deno-command'\n\ntry {\n  await openProcessStdioChannel({ bootstrap: 'fd', fd: 3 })\n} catch (error) {\n  showLaunchConfigurationError(error)\n}",
      result: {
        en: 'The application can report the unsupported configuration instead of waiting for an unread descriptor.',
        zh: '应用可报告不支持的配置，不会一直等待无法读取的描述符。'
      },
      covers: ['bootstrap', 'fd']
    }
  ],
  receiveAdapterBootstrap: [
    {
      title: {
        en: 'Read the first bootstrap frame',
        zh: '读取首个引导帧'
      },
      problem: {
        en: 'The custom launcher already gave the child its real byte channel. Read the bootstrap prefix with a five-second budget before the native handshake starts.',
        zh: '自定义启动器已把真实字节通道交给子端。在原生握手前，用五秒预算读取引导前缀。'
      },
      example:
        "import { receiveAdapterBootstrap } from '@migaia/rpc-process'\n\nconst opened = await receiveAdapterBootstrap(childByteChannel, 'stdin', {\n  bootstrapTimeoutMs: 5000,\n  scheduler: applicationScheduler\n})\nstartChildProtocol(opened.channel, opened.bootstrap)",
      result: {
        en: 'The application receives the held channel plus its separated bootstrap bytes.',
        zh: '应用取得所持有通道及单独的引导字节。'
      },
      covers: ['bootstrapTimeoutMs', 'scheduler']
    },
    {
      title: {
        en: 'Preserve a protocol that starts immediately',
        zh: '保留立即开始的协议'
      },
      problem: {
        en: 'An existing channel carries protocol frames immediately and has no bootstrap prefix. Select none to preserve its first bytes instead of interpreting them as a bootstrap frame.',
        zh: '已有通道立即传递协议帧，没有引导前缀。选择 none，保留其首批字节，不将它们解释为引导帧。'
      },
      example:
        "import { receiveAdapterBootstrap } from '@migaia/rpc-process'\n\nconst opened = await receiveAdapterBootstrap(childByteChannel, 'none', {\n  bootstrapTimeoutMs: 5000,\n  scheduler: applicationScheduler\n})\nstartChildProtocol(opened.channel, opened.bootstrap)",
      result: {
        en: 'The application keeps the held channel without consuming a bootstrap frame.',
        zh: '应用保留所持有通道，不消费引导帧。'
      },
      covers: ['bootstrapTimeoutMs', 'scheduler']
    }
  ],
  'adapters/node-socket:dialProcessByteChannel': [
    {
      title: {
        en: 'Dial the existing local price service',
        zh: '拨号到已有本地价格服务'
      },
      problem: {
        en: 'The application already knows its approved local service address. Dial the raw byte channel under the checkout view’s cancellation signal, then pass it to Process for the authenticated handshake.',
        zh: '应用已知道获准本地服务的地址。使用结算视图的取消信号拨号取得原始字节通道，再交给 Process 进行认证握手。'
      },
      example:
        "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'\n\nconst byte = await dialProcessByteChannel({\n  address: pricingServiceAddress,\n  signal: viewController.signal\n})\nawait connectPricingProtocol(byte)",
      result: {
        en: 'Checkout gets one raw local connection whose setup observes view cancellation.',
        zh: '结算页取得一条原始本地连接，其准备过程响应视图取消。'
      },
      covers: ['address', 'signal']
    },
    {
      title: {
        en: 'Let an import choose its own service address',
        zh: '为导入选择自己的服务地址'
      },
      problem: {
        en: 'An import job targets an approved local service endpoint selected by the application. Keep that address explicit instead of reusing an unrelated screen’s connection.',
        zh: '导入任务访问应用选择的获准本地服务端点。显式提供该地址，避免复用其他界面的连接。'
      },
      example:
        "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/node-socket'\n\nconst byte = await dialProcessByteChannel({ address: importServiceAddress })\nawait connectImportProtocol(byte)",
      result: {
        en: 'The import owns its own raw connection to the selected local endpoint.',
        zh: '导入任务持有通往所选本地端点的独立原始连接。'
      },
      covers: ['address']
    }
  ],
  'adapters/deno-socket:dialProcessByteChannel': [
    {
      title: {
        en: 'Dial the existing local price service',
        zh: '拨号到已有本地价格服务'
      },
      problem: {
        en: 'The application already knows its approved local service address. Dial the raw byte channel under the checkout view’s cancellation signal, then pass it to Process for the authenticated handshake.',
        zh: '应用已知道获准本地服务的地址。使用结算视图的取消信号拨号取得原始字节通道，再交给 Process 进行认证握手。'
      },
      example:
        "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/deno-socket'\n\nconst byte = await dialProcessByteChannel({\n  address: pricingServiceAddress,\n  signal: viewController.signal\n})\nawait connectPricingProtocol(byte)",
      result: {
        en: 'Checkout gets one raw local connection whose setup observes view cancellation.',
        zh: '结算页取得一条原始本地连接，其准备过程响应视图取消。'
      },
      covers: ['address', 'signal']
    },
    {
      title: {
        en: 'Let an import choose its own service address',
        zh: '为导入选择自己的服务地址'
      },
      problem: {
        en: 'An import job targets an approved local service endpoint selected by the application. Keep that address explicit instead of reusing an unrelated screen’s connection.',
        zh: '导入任务访问应用选择的获准本地服务端点。显式提供该地址，避免复用其他界面的连接。'
      },
      example:
        "import { dialProcessByteChannel } from '@migaia/rpc-process/adapters/deno-socket'\n\nconst byte = await dialProcessByteChannel({ address: importServiceAddress })\nawait connectImportProtocol(byte)",
      result: {
        en: 'The import owns its own raw connection to the selected local endpoint.',
        zh: '导入任务持有通往所选本地端点的独立原始连接。'
      },
      covers: ['address']
    }
  ]
}

/** Focused field examples preserve the existing field contracts. */
export const processReaderOptionFields: Readonly<
  Record<string, Readonly<Record<string, { example: string; whenToUse: IText }>>>
> = {
  createProcessPeer: {
    endpointFactory: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})',
      whenToUse: {
        en: 'Keep an existing endpoint composition for the acquired process channel; use its actual codec, framer and flow-control features.',
        zh: '需要让已有端点组装使用取得的进程通道时设置，沿用该通道真实的编解码器、分帧器与流控特性。'
      }
    },
    self: {
      example:
        "const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  self: { name: 'checkout', instanceId: checkoutInstanceId }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    provide: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  provide: { prices: () => fetchPrices() }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    providerLimits: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    authentication: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  authentication: orderProtection\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    probe: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  probe: connectionProbe\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    defaultTimeoutMs: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  defaultTimeoutMs: 2000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    contract: {
      example:
        'const pricing = await createProcessPeer({\n  ...declaredPricingPeerOptions,\n  contract: pricingContract\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    report: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Route native process and background diagnostics to the application sink without printing credentials.',
        zh: '需要把原生进程与后台诊断交给应用接收端时设置，避免输出凭据。'
      }
    },
    keyFactory: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  keyFactory: () => crypto.randomUUID()\n})',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    retryPort: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  retryPort: orderRetryPolicy\n})',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    spawn: {
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\ntype IPricing = { prices(): number[] }\nconst prices = await createProcessPeer<IPricing>({\n  spawn: new URL('./pricing-child.ts', import.meta.url),\n  defaultTimeoutMs: 2000,\n  report: (error) => reportToMonitoring(error)\n})\ntry {\n  renderPrices(await prices.request('prices'))\n} finally {\n  await prices.close()\n}",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    connect: {
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\nconst prices = await createProcessPeer({\n  connect: pricingServiceName,\n  token: pricingToken,\n  connectTimeoutMs: 2000\n})\nonCheckoutClosed(() => prices.close())",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    listen: {
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\nconst service = await createProcessPeer({\n  listen: pricingServiceName,\n  token: pricingToken,\n  verify: (credential) => verifyCheckoutCredential(credential),\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})\nonServiceClosed(() => service.close())",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    token: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  token: pricingToken\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    verify: {
      example:
        "import { createProcessPeer } from '@migaia/rpc-process'\n\nconst service = await createProcessPeer({\n  listen: pricingServiceName,\n  token: pricingToken,\n  verify: (credential) => verifyCheckoutCredential(credential),\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})\nonServiceClosed(() => service.close())",
      whenToUse: {
        en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
        zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
      }
    },
    connectTimeoutMs: {
      example:
        'const pricing = await createProcessPeer({\n  ...pricingPeerOptions,\n  connectTimeoutMs: 2000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createProcessPlugin: {
    name: {
      example:
        "const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  name: 'pricing'\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    contract: {
      example:
        'const pricing = createProcessPlugin({\n  ...declaredPricingPluginOptions,\n  contract: pricingContract\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    registrationOwner: {
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    resilience: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  resilience: processGovernor\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    host: {
      example:
        'const pricing = createProcessPlugin({\n  ...administrationPluginOptions,\n  host: applicationHost\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    endpointFactory: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})',
      whenToUse: {
        en: 'Build the explicit full-deployment endpoint from this acquired channel; retain its pipeline and flow-control features.',
        zh: '需要为完整部署按当前取得通道显式构造端点时设置，保留原管线与流控特性。'
      }
    },
    report: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Route native process and background diagnostics to the application sink without printing credentials.',
        zh: '需要把原生进程与后台诊断交给应用接收端时设置，避免输出凭据。'
      }
    },
    keyFactory: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  keyFactory: () => crypto.randomUUID()\n})',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    retryPort: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  retryPort: orderRetryPolicy\n})',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    deployment: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  deployment: pricingDeployment\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    self: {
      example:
        "const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  self: { name: 'checkout', instanceId: checkoutInstanceId }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    provide: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  provide: { prices: () => fetchPrices() }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    providerLimits: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    authentication: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  authentication: orderProtection\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    probe: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  probe: connectionProbe\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    defaultTimeoutMs: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  defaultTimeoutMs: 2000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    spawn: {
      example:
        "const pricing = createProcessPlugin({\n  ...sourceIndependentPluginOptions,\n  spawn: new URL('./pricing-child.ts', import.meta.url)\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    connect: {
      example:
        'const pricing = createProcessPlugin({\n  ...sourceIndependentPluginOptions,\n  connect: pricingServiceName\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    listen: {
      example:
        'const pricing = createProcessPlugin({\n  ...sourceIndependentPluginOptions,\n  listen: pricingServiceName\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    token: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  token: pricingToken\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    verify: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  verify: (credential) => verifyCheckoutCredential(credential)\n})',
      whenToUse: {
        en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
        zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
      }
    },
    connectTimeoutMs: {
      example:
        'const pricing = createProcessPlugin({\n  ...pricingPluginOptions,\n  connectTimeoutMs: 2000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    expose: {
      example:
        "const pricing = createProcessPlugin({\n  ...administrationPluginOptions,\n  expose: ['host']\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    catalog: {
      example:
        'const pricing = createProcessPlugin({\n  ...administrationPluginOptions,\n  catalog: approvedCatalog\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    resolvePlugin: {
      example:
        'const pricing = createProcessPlugin({\n  ...administrationPluginOptions,\n  resolvePlugin: (name, config) => resolveApprovedPlugin(name, config)\n})',
      whenToUse: {
        en: 'Resolve only catalog-admitted names to local definitions when host is explicitly exposed.',
        zh: '显式暴露宿主控制时，仅把通过目录接纳的名称解析为本地定义。'
      }
    },
    'registrationOwner.name': {
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'registrationOwner.host': {
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createProcessResilience: {
    scheduler: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  scheduler: applicationScheduler\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    report: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Send secondary failures to the application diagnostic sink while preserving the original error identity.',
        zh: '需要把次级故障交给应用诊断接收端，并保留原始错误身份时设置。'
      }
    },
    idempotencyStore: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  idempotencyStore: orderOutcomes\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    maxConnections: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  maxConnections: 32\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    maxConcurrentCallsPerConnection: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  maxConcurrentCallsPerConnection: 8\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    maxCallsPerMinute: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  maxCallsPerMinute: 120\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    maxPayloadBytes: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  maxPayloadBytes: 262144\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    maxConsecutiveTimeouts: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  maxConsecutiveTimeouts: 3\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    idleTimeoutMs: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  idleTimeoutMs: 30000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    drainMs: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  drainMs: 2000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    reportAtMs: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  reportAtMs: [0, 10000, 60000]\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    unhandledLimit: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  unhandledLimit: 2\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    liquidation: {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  liquidation: { cascade: false }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'liquidation.cascade': {
      example:
        'const governor = createProcessResilience({\n  ...governorOptions,\n  liquidation: { cascade: false }\n})',
      whenToUse: {
        en: 'Keep false when dependent resources should remain suspended; choose true when terminal liquidation should release their real Host dependency closure.',
        zh: '依赖方资源应保持挂起时保留 false；终态清算需要释放真实宿主依赖闭包时选择 true。'
      }
    }
  },
  createProcessTransport: {
    peerId: {
      example:
        "const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  peerId: 'pricing-service'\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    signal: {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  signal: viewController.signal\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    handshakeTimeoutMs: {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  handshakeTimeoutMs: 3000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    scheduler: {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  scheduler: applicationScheduler\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    report: {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Send secondary failures to the application diagnostic sink while preserving the original error identity.',
        zh: '需要把次级故障交给应用诊断接收端，并保留原始错误身份时设置。'
      }
    },
    ipc: {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: sessionDiagnostics\n})',
      whenToUse: {
        en: 'Correlate connection records and configure queue capacity without treating diagnostic labels as credentials.',
        zh: '需要关联连接记录并配置队列容量时设置，诊断标签不能作为凭据。'
      }
    },
    role: {
      example:
        "const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  role: 'initiator'\n})",
      whenToUse: {
        en: 'Use initiator on the dialing or launching side and responder on the byte receiver; both sides supply an offer.',
        zh: '拨号或启动端使用发起方，字节接收端使用响应方，双方均提供握手提议。'
      }
    },
    offer: {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  offer: pricingOffer\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    auth: {
      example:
        "const channel = await createProcessTransport(acceptedByteChannel, {\n  ...responderOptions,\n  auth: { mode: 'required', verify: verifyCheckoutCredential }\n})",
      whenToUse: {
        en: 'Require verification on externally reachable byte channels; select none only when the carrier is already private and owned.',
        zh: '可从外部访问的字节通道需要校验；仅在载体已经私有且由自己持有时选择无认证。'
      }
    },
    staticAgreement: {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.connectionId': {
      example:
        "const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, connectionId: 'checkout-pricing' }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.sessionId': {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, sessionId: currentSessionId }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.processId': {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, processId: supervisedProcessId }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.maxPendingData': {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, maxPendingData: 64 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.maxPendingControl': {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, maxPendingControl: 16 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.log': {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, log: (record) => recordConnectionEvent(record) }\n})',
      whenToUse: {
        en: 'Collect structured connection records; keep secret bytes out of the sink and let report observe sink failures.',
        zh: '需要收集结构化连接记录时设置，不向接收端写入敏感字节，接收端故障交给 report。'
      }
    },
    'ipc.stderr': {
      example:
        'const channel = await createProcessTransport(rawByteChannel, {\n  ...byteTransportOptions,\n  ipc: { ...sessionDiagnostics, stderr: (listener) => subscribePricingStderr(listener) }\n})',
      whenToUse: {
        en: 'Borrow the existing child stderr subscription for bounded redacted diagnostics and unsubscribe during channel cleanup.',
        zh: '需要借用既有子进程标准错误订阅生成有界脱敏诊断，并在通道清理时取消订阅时设置。'
      }
    },
    'auth.mode': {
      example:
        "const channel = await createProcessTransport(acceptedByteChannel, {\n  ...responderOptions,\n  auth: { mode: 'required', verify: (credential) => verifyCheckoutCredential(credential) }\n})",
      whenToUse: {
        en: 'Choose required for credential verification; none explicitly omits verification on an already private carrier.',
        zh: '需要校验凭据时选择 required；已私有载体上的 none 显式省略校验。'
      }
    },
    'auth.verify': {
      example:
        "const channel = await createProcessTransport(acceptedByteChannel, {\n  ...responderOptions,\n  auth: { mode: 'required', verify: (credential) => verifyCheckoutCredential(credential) }\n})",
      whenToUse: {
        en: 'Require verification on externally reachable byte channels; select none only when the carrier is already private and owned.',
        zh: '可从外部访问的字节通道需要校验；仅在载体已经私有且由自己持有时选择无认证。'
      }
    },
    'staticAgreement.local': {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'staticAgreement.peer': {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'staticAgreement.local.codec': {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use identity on both profiles when the native carrier already preserves complete messages.',
        zh: '原生载体已经保持完整消息边界时，两端配置均使用 identity。'
      }
    },
    'staticAgreement.local.capabilities': {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'staticAgreement.peer.codec': {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use identity on both profiles when the native carrier already preserves complete messages.',
        zh: '原生载体已经保持完整消息边界时，两端配置均使用 identity。'
      }
    },
    'staticAgreement.peer.capabilities': {
      example:
        'const channel = await createProcessTransport(messageChannel, {\n  ...messageTransportOptions,\n  staticAgreement: { local: messageProfile, peer: messageProfile }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createNativeProcessOffer: {
    peer: {
      example:
        "const offer = createNativeProcessOffer({\n  ...nativeOfferOptions,\n  peer: { id: 'checkout', runtime: 'bun' }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    auth: {
      example:
        'const offer = createNativeProcessOffer({\n  ...nativeOfferOptions,\n  auth: pricingToken\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    stream: {
      example:
        'const offer = createNativeProcessOffer({\n  ...nativeOfferOptions,\n  stream: true\n})',
      whenToUse: {
        en: 'Set true for an iterable service; set false when stream must stay disabled even if runtime defaults are completed.',
        zh: '可迭代服务使用 true；即使补全运行时默认值也必须禁用流时使用 false。'
      }
    },
    capabilities: {
      example:
        'const offer = createNativeProcessOffer({\n  ...nativeOfferOptions,\n  capabilities: agreedCapabilities\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createProcessJsonRpcChannel: {
    peerId: {
      example:
        "const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  peerId: 'pricing-service'\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    signal: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  signal: viewController.signal\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    handshakeTimeoutMs: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  handshakeTimeoutMs: 3000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    scheduler: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  scheduler: applicationScheduler\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    report: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Send secondary failures to the application diagnostic sink while preserving the original error identity.',
        zh: '需要把次级故障交给应用诊断接收端，并保留原始错误身份时设置。'
      }
    },
    ipc: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: sessionDiagnostics\n})',
      whenToUse: {
        en: 'Correlate connection records and configure queue capacity without treating diagnostic labels as credentials.',
        zh: '需要关联连接记录并配置队列容量时设置，诊断标签不能作为凭据。'
      }
    },
    byte: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  byte: pricingByteChannel\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    target: {
      example:
        "const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  target: { kind: 'plugin', contract: pricingContract }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    offer: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  offer: jsonRpcOffer\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    token: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  token: pricingToken\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    wallClock: {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  wallClock: applicationWallClock\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.connectionId': {
      example:
        "const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, connectionId: 'checkout-pricing' }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.sessionId': {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, sessionId: currentSessionId }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.processId': {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, processId: supervisedProcessId }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.maxPendingData': {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, maxPendingData: 64 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.maxPendingControl': {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, maxPendingControl: 16 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.log': {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, log: (record) => recordConnectionEvent(record) }\n})',
      whenToUse: {
        en: 'Collect structured connection records; keep secret bytes out of the sink and let report observe sink failures.',
        zh: '需要收集结构化连接记录时设置，不向接收端写入敏感字节，接收端故障交给 report。'
      }
    },
    'ipc.stderr': {
      example:
        'const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  ipc: { ...sessionDiagnostics, stderr: (listener) => subscribePricingStderr(listener) }\n})',
      whenToUse: {
        en: 'Borrow the existing child stderr subscription for bounded redacted diagnostics and unsubscribe during channel cleanup.',
        zh: '需要借用既有子进程标准错误订阅生成有界脱敏诊断，并在通道清理时取消订阅时设置。'
      }
    },
    'target.kind': {
      example:
        "const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  target: { kind: 'plugin', contract: pricingContract }\n})",
      whenToUse: {
        en: 'Select plugin with one contract, or host with a catalog; neither target supports stream declarations over this bridge.',
        zh: '单个契约选择 plugin，目录选择 host；此桥接的两个目标都不支持流声明。'
      }
    },
    'target.contract': {
      example:
        "const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  target: { kind: 'plugin', contract: pricingContract }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'target.catalog': {
      example:
        "const channel = await createProcessJsonRpcChannel({\n  ...foreignServiceOptions,\n  target: { kind: 'host', catalog: approvedCatalog }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  openProcessObjectChannel: {
    peerId: {
      example:
        "const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  peerId: 'pricing-service'\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    signal: {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  signal: viewController.signal\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    handshakeTimeoutMs: {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  handshakeTimeoutMs: 3000\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    scheduler: {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  scheduler: applicationScheduler\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    report: {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Send secondary failures to the application diagnostic sink while preserving the original error identity.',
        zh: '需要把次级故障交给应用诊断接收端，并保留原始错误身份时设置。'
      }
    },
    ipc: {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: sessionDiagnostics\n})',
      whenToUse: {
        en: 'Correlate connection records and configure queue capacity without treating diagnostic labels as credentials.',
        zh: '需要关联连接记录并配置队列容量时设置，诊断标签不能作为凭据。'
      }
    },
    'ipc.connectionId': {
      example:
        "const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, connectionId: 'checkout-pricing' }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.sessionId': {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, sessionId: currentSessionId }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.processId': {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, processId: supervisedProcessId }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.maxPendingData': {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, maxPendingData: 64 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.maxPendingControl': {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, maxPendingControl: 16 }\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'ipc.log': {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, log: (record) => recordConnectionEvent(record) }\n})',
      whenToUse: {
        en: 'Collect structured connection records; keep secret bytes out of the sink and let report observe sink failures.',
        zh: '需要收集结构化连接记录时设置，不向接收端写入敏感字节，接收端故障交给 report。'
      }
    },
    'ipc.stderr': {
      example:
        'const channel = openProcessObjectChannel(negotiatedConnection, {\n  ...objectConnectionOptions,\n  ipc: { ...sessionDiagnostics, stderr: (listener) => subscribePricingStderr(listener) }\n})',
      whenToUse: {
        en: 'Borrow the existing child stderr subscription for bounded redacted diagnostics and unsubscribe during channel cleanup.',
        zh: '需要借用既有子进程标准错误订阅生成有界脱敏诊断，并在通道清理时取消订阅时设置。'
      }
    }
  },
  receiveAdapterBootstrap: {
    bootstrapTimeoutMs: {
      example:
        "const opened = await receiveAdapterBootstrap(childByteChannel, 'stdin', {\n  ...bootstrapReaderOptions,\n  bootstrapTimeoutMs: 5000\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    scheduler: {
      example:
        "const opened = await receiveAdapterBootstrap(childByteChannel, 'stdin', {\n  ...bootstrapReaderOptions,\n  scheduler: applicationScheduler\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createAdapterProcessLaunch: {
    runtimeApiBootstrap: {
      example:
        "const launch = createAdapterProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.name': {
      example:
        "const launch = createAdapterProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.parentInstanceId': {
      example:
        "const launch = createAdapterProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.generation': {
      example:
        "const launch = createAdapterProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createAdapterProcessPeer: {
    endpointFactory: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n}, runtimeLoader)',
      whenToUse: {
        en: 'Keep an existing endpoint composition for the acquired process channel; use its actual codec, framer and flow-control features.',
        zh: '需要让已有端点组装使用取得的进程通道时设置，沿用该通道真实的编解码器、分帧器与流控特性。'
      }
    },
    self: {
      example:
        "const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  self: { name: 'checkout', instanceId: checkoutInstanceId }\n}, runtimeLoader)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    provide: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  provide: { prices: () => fetchPrices() }\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    providerLimits: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    authentication: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  authentication: orderProtection\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    probe: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  probe: connectionProbe\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    defaultTimeoutMs: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  defaultTimeoutMs: 2000\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    contract: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...declaredPricingPeerOptions,\n  contract: pricingContract\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    report: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  report: (error) => reportToMonitoring(error)\n}, runtimeLoader)',
      whenToUse: {
        en: 'Route native process and background diagnostics to the application sink without printing credentials.',
        zh: '需要把原生进程与后台诊断交给应用接收端时设置，避免输出凭据。'
      }
    },
    keyFactory: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  keyFactory: () => crypto.randomUUID()\n}, runtimeLoader)',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    retryPort: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  retryPort: orderRetryPolicy\n}, runtimeLoader)',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    spawn: {
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\ntype IPricing = { prices(): number[] }\nconst prices = await createAdapterProcessPeer<IPricing>({\n  spawn: new URL('./pricing-child.ts', import.meta.url),\n  defaultTimeoutMs: 2000,\n  report: (error) => reportToMonitoring(error)\n}, runtimeLoader)\ntry {\n  renderPrices(await prices.request('prices'))\n} finally {\n  await prices.close()\n}",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    connect: {
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\nconst prices = await createAdapterProcessPeer({\n  connect: pricingServiceName,\n  token: pricingToken,\n  connectTimeoutMs: 2000\n}, runtimeLoader)\nonCheckoutClosed(() => prices.close())",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    listen: {
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\nconst service = await createAdapterProcessPeer({\n  listen: pricingServiceName,\n  token: pricingToken,\n  verify: (credential) => verifyCheckoutCredential(credential),\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, runtimeLoader)\nonServiceClosed(() => service.close())",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    token: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  token: pricingToken\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    verify: {
      example:
        "import { createAdapterProcessPeer } from '@migaia/rpc-process'\n\nconst service = await createAdapterProcessPeer({\n  listen: pricingServiceName,\n  token: pricingToken,\n  verify: (credential) => verifyCheckoutCredential(credential),\n  provide: { prices: () => fetchPrices() },\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, runtimeLoader)\nonServiceClosed(() => service.close())",
      whenToUse: {
        en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
        zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
      }
    },
    connectTimeoutMs: {
      example:
        'const pricing = await createAdapterProcessPeer({\n  ...pricingPeerOptions,\n  connectTimeoutMs: 2000\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createAdapterProcessPlugin: {
    name: {
      example:
        "const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  name: 'pricing'\n}, runtimeLoader)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    contract: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...declaredPricingPluginOptions,\n  contract: pricingContract\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    registrationOwner: {
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    resilience: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...fullPricingPluginOptions,\n  resilience: processGovernor\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    host: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...administrationPluginOptions,\n  host: applicationHost\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    endpointFactory: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n}, runtimeLoader)',
      whenToUse: {
        en: 'Build the explicit full-deployment endpoint from this acquired channel; retain its pipeline and flow-control features.',
        zh: '需要为完整部署按当前取得通道显式构造端点时设置，保留原管线与流控特性。'
      }
    },
    report: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  report: (error) => reportToMonitoring(error)\n}, runtimeLoader)',
      whenToUse: {
        en: 'Route native process and background diagnostics to the application sink without printing credentials.',
        zh: '需要把原生进程与后台诊断交给应用接收端时设置，避免输出凭据。'
      }
    },
    keyFactory: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  keyFactory: () => crypto.randomUUID()\n}, runtimeLoader)',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    retryPort: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  retryPort: orderRetryPolicy\n}, runtimeLoader)',
      whenToUse: {
        en: 'Managed process spawn/connect consumes this policy for declared idempotent requests. A function source uses direct Core assembly and does not consume this proxy policy.',
        zh: '托管进程 spawn/connect 为声明为幂等的请求使用此策略；函数来源使用直接 Core 组装，不使用这项代理策略。'
      }
    },
    deployment: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...fullPricingPluginOptions,\n  deployment: pricingDeployment\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    self: {
      example:
        "const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  self: { name: 'checkout', instanceId: checkoutInstanceId }\n}, runtimeLoader)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    provide: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  provide: { prices: () => fetchPrices() }\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    providerLimits: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  providerLimits: { maxGlobal: 8, maxPerPeer: 2 }\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    authentication: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  authentication: orderProtection\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    probe: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  probe: connectionProbe\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    defaultTimeoutMs: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  defaultTimeoutMs: 2000\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    spawn: {
      example:
        "const pricing = createAdapterProcessPlugin({\n  ...sourceIndependentPluginOptions,\n  spawn: new URL('./pricing-child.ts', import.meta.url)\n}, runtimeLoader)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    connect: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...sourceIndependentPluginOptions,\n  connect: pricingServiceName\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    listen: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...sourceIndependentPluginOptions,\n  listen: pricingServiceName\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    token: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  token: pricingToken\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    verify: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  verify: (credential) => verifyCheckoutCredential(credential)\n}, runtimeLoader)',
      whenToUse: {
        en: 'Require an application principal for a listener rather than relying only on same-user socket permissions.',
        zh: '监听端需要应用主体身份，而不能仅依赖同用户套接字权限时设置。'
      }
    },
    connectTimeoutMs: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...pricingPluginOptions,\n  connectTimeoutMs: 2000\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    expose: {
      example:
        "const pricing = createAdapterProcessPlugin({\n  ...administrationPluginOptions,\n  expose: ['host']\n}, runtimeLoader)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    catalog: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...administrationPluginOptions,\n  catalog: approvedCatalog\n}, runtimeLoader)',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    resolvePlugin: {
      example:
        'const pricing = createAdapterProcessPlugin({\n  ...administrationPluginOptions,\n  resolvePlugin: (name, config) => resolveApprovedPlugin(name, config)\n}, runtimeLoader)',
      whenToUse: {
        en: 'Resolve only catalog-admitted names to local definitions when host is explicitly exposed.',
        zh: '显式暴露宿主控制时，仅把通过目录接纳的名称解析为本地定义。'
      }
    },
    'registrationOwner.name': {
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'registrationOwner.host': {
      example:
        "import { createProcessPlugin } from '@migaia/rpc-process'\n\nconst pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing',\n  contract: pricingContract,\n  registrationOwner: { name: 'pricing', host: applicationHost },\n  deployment: pricingDeployment\n})\nawait applicationHost.use(pricing)",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createNodeProcessLauncher: {
    runtimeApiBootstrap: {
      example:
        "const launcher = createNodeProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.name': {
      example:
        "const launcher = createNodeProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.parentInstanceId': {
      example:
        "const launcher = createNodeProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.generation': {
      example:
        "const launcher = createNodeProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createBunProcessLauncher: {
    runtimeApiBootstrap: {
      example:
        "const launcher = createBunProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.name': {
      example:
        "const launcher = createBunProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.parentInstanceId': {
      example:
        "const launcher = createBunProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.generation': {
      example:
        "const launcher = createBunProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createDenoProcessLauncher: {
    runtimeApiBootstrap: {
      example:
        "const launcher = createDenoProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.name': {
      example:
        "const launcher = createDenoProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.parentInstanceId': {
      example:
        "const launcher = createDenoProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.generation': {
      example:
        "const launcher = createDenoProcessLauncher({\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  'adapters/node-child-process:openProcessStdioChannel': {
    bootstrap: {
      example: "const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })",
      whenToUse: {
        en: 'Use stdin when the parent writes a framed prefix and none when protocol starts immediately. fd is declared but rejected by both current openers.',
        zh: '父进程写入分帧前缀时用 stdin，直接开始协议时用 none。fd 虽已声明，但当前两个读取函数都会拒绝。'
      }
    },
    fd: {
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'\n\ntry {\n  await openProcessStdioChannel({ bootstrap: 'fd', fd: 3 })\n} catch (error) {\n  showLaunchConfigurationError(error)\n}",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    bootstrapTimeoutMs: {
      example:
        "const opened = await openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: 5000 })",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  'adapters/deno-command:openProcessStdioChannel': {
    bootstrap: {
      example: "const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })",
      whenToUse: {
        en: 'Use stdin when the parent writes a framed prefix and none when protocol starts immediately. fd is declared but rejected by both current openers.',
        zh: '父进程写入分帧前缀时用 stdin，直接开始协议时用 none。fd 虽已声明，但当前两个读取函数都会拒绝。'
      }
    },
    fd: {
      example:
        "import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/deno-command'\n\ntry {\n  await openProcessStdioChannel({ bootstrap: 'fd', fd: 3 })\n} catch (error) {\n  showLaunchConfigurationError(error)\n}",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    bootstrapTimeoutMs: {
      example:
        "const opened = await openProcessStdioChannel({ bootstrap: 'stdin', bootstrapTimeoutMs: 5000 })",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  'adapters/node-socket:dialProcessByteChannel': {
    address: {
      example:
        'const byte = await dialProcessByteChannel({\n  ...dialOptions,\n  address: pricingServiceAddress\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    signal: {
      example:
        'const byte = await dialProcessByteChannel({\n  ...dialOptions,\n  signal: viewController.signal\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  'adapters/deno-socket:dialProcessByteChannel': {
    address: {
      example:
        'const byte = await dialProcessByteChannel({\n  ...dialOptions,\n  address: pricingServiceAddress\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    signal: {
      example:
        'const byte = await dialProcessByteChannel({\n  ...dialOptions,\n  signal: viewController.signal\n})',
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  createAdapterNodeProcessLaunch: {
    runtimeApiBootstrap: {
      example:
        "const launch = createAdapterNodeProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.name': {
      example:
        "const launch = createAdapterNodeProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.parentInstanceId': {
      example:
        "const launch = createAdapterNodeProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    },
    'runtimeApiBootstrap.generation': {
      example:
        "const launch = createAdapterNodeProcessLaunch(processSpec, launchContext, {\n  runtimeApiBootstrap: { name: 'pricing', parentInstanceId: parentPeer.self.instanceId,\n    generation: launchGeneration }\n})",
      whenToUse: {
        en: 'Use the application-owned value shown here when configuring this connection. Omitted optional values keep their documented defaults.',
        zh: '配置这条连接时使用应用持有的值；省略可选值时保留说明中的默认行为。'
      }
    }
  },
  fullProcessPlugin: {
    name: {
      example:
        "const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  name: 'pricing'\n})",
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    },
    contract: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  contract: pricingContract\n})',
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    },
    registrationOwner: {
      example:
        "const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  registrationOwner: { name: 'pricing', host: applicationHost }\n})",
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    },
    resilience: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  resilience: processGovernor\n})',
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    },
    host: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  host: remoteHostControl\n})',
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    },
    endpointFactory: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  endpointFactory: (channel, signal) => openPricingEndpoint(channel, signal)\n})',
      whenToUse: {
        en: 'Build the explicit full-deployment endpoint from this acquired channel; retain its pipeline and flow-control features.',
        zh: '需要为完整部署按当前取得通道显式构造端点时设置，保留原管线与流控特性。'
      }
    },
    report: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  report: (error) => reportToMonitoring(error)\n})',
      whenToUse: {
        en: 'Send secondary failures to the application diagnostic sink while preserving the original error identity.',
        zh: '需要把次级故障交给应用诊断接收端，并保留原始错误身份时设置。'
      }
    },
    keyFactory: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  keyFactory: () => crypto.randomUUID()\n})',
      whenToUse: {
        en: 'Issue an application key for a declared idempotent proxy call when the caller supplies no explicit key.',
        zh: '代理方法已声明幂等，且调用方未显式提供键，需要签发应用键时设置。'
      }
    },
    retryPort: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  retryPort: orderRetryPolicy\n})',
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    },
    deployment: {
      example:
        'const pricing = createProcessPlugin({\n  ...fullPricingPluginOptions,\n  deployment: pricingDeployment\n})',
      whenToUse: {
        en: 'Configure this part of the advanced pricing deployment.',
        zh: '配置高级价格部署的这一部分。'
      }
    }
  }
}

/** Existing reference assemblies share the rewritten cases across their actual overloads. */
export const processPeerOptionCases = (adapter = false) =>
  processReaderOptionCases[adapter ? 'createAdapterProcessPeer' : 'createProcessPeer']!
export const processTransportOptionCases = processReaderOptionCases.createProcessTransport!
export const processOfferOptionCases = processReaderOptionCases.createNativeProcessOffer!
export const processLauncherOptionCases = (_module: string, factory: string) =>
  processReaderOptionCases[factory]!
export const processLaunchPreparationCases = (web = false) =>
  processReaderOptionCases[web ? 'createAdapterProcessLaunch' : 'createAdapterNodeProcessLaunch']!
export const processStdioOptionCases = (module = 'node-child-process') =>
  processReaderOptionCases['adapters/' + module + ':openProcessStdioChannel']!
export const processBootstrapReaderCases = processReaderOptionCases.receiveAdapterBootstrap!
export const processDialOptionCases = (module: string) =>
  processReaderOptionCases['adapters/' + module + ':dialProcessByteChannel']!
export const processResilienceOptionCases = processReaderOptionCases.createProcessResilience!
export const processRuntimePluginOptionCases = (adapter = false) =>
  processReaderOptionCases[adapter ? 'createAdapterProcessPlugin' : 'createProcessPlugin']!
export const processJsonRpcOptionCases = (objectMode = false) =>
  processReaderOptionCases[objectMode ? 'openProcessObjectChannel' : 'createProcessJsonRpcChannel']!
export const processFullPluginOptionCases = processReaderOptionCases.fullProcessPlugin!

/** Existing non-option cases retain their established behavior examples. */
export const rpcProcessCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createProcessPeer: [
    {
      title: {
        en: 'Run a function in a real child and close its owner',
        zh: '在真实子进程中执行函数并关闭其所有者'
      },
      problem: {
        en: 'CPU work must run outside the main process, but a function call alone does not show where it executes.\n\nHandwritten spawning also needs framing, authentication and cleanup; rerunning one entry without a role check can recursively spawn more children.\n\nBranch with isProcessChild(), provide methods in the child, and use spawn: true in the parent; close the returned Peer in finally.',
        zh: '主进程需要把计算移到另一个操作系统进程里，但只看到函数返回值，还无法判断代码究竟在哪里执行。\n\n手写启动还要处理分帧、认证与清理；同一个入口重新执行时，若不先区分角色，子进程又会继续启动子进程。\n\n先用 `isProcessChild()` 分支，子端提供方法，父端用 `spawn: true` 启动，并在 `finally` 中关闭返回的 Peer。'
      },
      example: {
        en: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number; pid(): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: { double: (value: number) => value * 2, pid: () => process.pid }\n  })\n} else {\n  const child = await createProcessPeer<IServiceApi>({ spawn: true })\n  try {\n    console.log(await child.request('double', 21))\n    console.log((await child.request('pid')) !== process.pid)\n  } finally {\n    await child.close()\n  }\n}",
        zh: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number; pid(): number }\nif (isProcessChild()) {\n  await createProcessPeer({\n    provide: { double: (value: number) => value * 2, pid: () => process.pid }\n  })\n} else {\n  const child = await createProcessPeer<IServiceApi>({ spawn: true })\n  try {\n    console.log(await child.request('double', 21))\n    console.log((await child.request('pid')) !== process.pid)\n  } finally {\n    await child.close()\n  }\n}"
      },
      result: {
        en: 'Output is `42` then `true`: the method doubles 21, and its native process id differs from the parent.\n\nThe parent owns this child and closes it explicitly; this Node entry must be a real file, not eval or a test runner, and Node does not guarantee terminating every descendant.',
        zh: '输出依次为 `42`、`true`：计算结果为 42，返回的原生进程 id 也确实不同于父进程。\n\n父端拥有此子进程并显式关闭；Node 自派生入口必须是真实文件，不能是 eval 或测试运行器，也不保证终止所有后代进程。'
      }
    },
    {
      title: {
        en: 'Use reverse calls and streaming on the same child connection',
        zh: '在同一条子进程连接上使用反向调用与流'
      },
      problem: {
        en: 'A child may need a parent-owned service while producing a sequence of results for its caller.\n\nIndependent one-way pipes require separate routing and correlation, and treating a sequence as one response forces the producer to collect it first.\n\nProvide a parent method, let the child request it through its Peer, and expose an async generator consumed with stream().',
        zh: '子进程处理任务时，既要调用父端持有的服务，也要把一串结果逐项交回调用方。\n\n分别搭建单向管道，就要重复处理路由和结果对应关系；把整串结果塞进一次响应，又迫使提供方先收集全部数据。\n\n父端通过 `provide` 提供方法，子端拿自己的 Peer 反向请求；序列方法返回异步生成器，父端通过 `stream()` 消费。'
      },
      example: {
        en: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IParentApi = { prefix(value: string): string }\ntype IChildApi = {\n  label(value: string): Promise<string>\n  count(limit: number): AsyncGenerator<number>\n}\nif (isProcessChild()) {\n  const parent = createProcessPeer<IParentApi>({\n    provide: {\n      label: async (value: string): Promise<string> => (await parent).request('prefix', value),\n      count: async function* (limit: number) {\n        for (let value = 1; value <= limit; value++) yield value\n      }\n    }\n  })\n  await parent\n} else {\n  const child = await createProcessPeer<IChildApi>({\n    spawn: true,\n    provide: { prefix: (value: string) => 'main:' + value }\n  })\n  try {\n    console.log(await child.request('label', 'job'))\n    const values: number[] = []\n    for await (const value of child.stream('count', 3)) values.push(value)\n    console.log(values.join(','))\n  } finally {\n    await child.close()\n  }\n}",
        zh: "import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'\n\ntype IParentApi = { prefix(value: string): string }\ntype IChildApi = {\n  label(value: string): Promise<string>\n  count(limit: number): AsyncGenerator<number>\n}\nif (isProcessChild()) {\n  const parent = createProcessPeer<IParentApi>({\n    provide: {\n      label: async (value: string): Promise<string> => (await parent).request('prefix', value),\n      count: async function* (limit: number) {\n        for (let value = 1; value <= limit; value++) yield value\n      }\n    }\n  })\n  await parent\n} else {\n  const child = await createProcessPeer<IChildApi>({\n    spawn: true,\n    provide: { prefix: (value: string) => '主端:' + value }\n  })\n  try {\n    console.log(await child.request('label', '任务'))\n    const values: number[] = []\n    for await (const value of child.stream('count', 3)) values.push(value)\n    console.log(values.join(','))\n  } finally {\n    await child.close()\n  }\n}"
      },
      result: {
        en: 'Output is `main:job` then `1,2,3`, proving the child awaited a reverse request and the parent consumed its three stream items.\n\nBoth directions use the same authenticated connection; stream transmission starts on iteration, while notify completion would only mean sending completed.',
        zh: '输出为 `主端:任务`、`1,2,3`，证明子端等待了反向请求结果，父端也读取了流的三个值。\n\n双向调用复用同一条已认证连接；流在开始迭代时才发送请求，`notify` 完成则只表示发送完成。'
      }
    },
    {
      title: {
        en: 'Close one client while leaving a named local service available',
        zh: '关闭一个客户端后仍可连接本机命名服务'
      },
      problem: {
        en: 'A CLI connection ends, but the local service must remain available to the next caller.\n\nIf the client treats a connection as ownership of the server process or listener, its cleanup can remove a service still used by others.\n\nUse a unique named listener and connect separate clients; close each borrowed connection before closing the server owner.',
        zh: '一条 CLI 连接结束后，本机服务还需要继续接受后续调用方。\n\n如果把持有连接误当成拥有服务进程或监听器，客户端清理时就可能释放其他调用方仍在使用的服务。\n\n用唯一名称创建监听，再分别建立客户端；每个客户端先关闭自己的借用连接，最后才由服务端关闭监听。'
      },
      example: {
        en: "import { randomUUID } from 'node:crypto'\nimport { createProcessPeer } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nconst name = 'reader-' + randomUUID()\nconst server = await createProcessPeer({\n  listen: name,\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const first = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await first.request('double', 20))\n  } finally {\n    await first.close()\n  }\n  const second = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await second.request('double', 21))\n  } finally {\n    await second.close()\n  }\n} finally {\n  await server.close()\n}",
        zh: "import { randomUUID } from 'node:crypto'\nimport { createProcessPeer } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nconst name = 'reader-' + randomUUID()\nconst server = await createProcessPeer({\n  listen: name,\n  provide: { double: (value: number) => value * 2 }\n})\ntry {\n  const first = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await first.request('double', 20))\n  } finally {\n    await first.close()\n  }\n  const second = await createProcessPeer<IServiceApi>({ connect: name })\n  try {\n    console.log(await second.request('double', 21))\n  } finally {\n    await second.close()\n  }\n} finally {\n  await server.close()\n}"
      },
      result: {
        en: 'Output is `40` then `42`; the second client connects and calls successfully after the first closes.\n\nThis Node/POSIX example uses same-user endpoint permissions, not authentication between applications of that user; Windows and explicit addresses require a token.',
        zh: '输出为 `40`、`42`；第一个客户端关闭后，第二个客户端仍能连接并成功调用。\n\n此例使用 Node/POSIX 的同用户端点权限，不能区分同一用户下的不同应用；Windows 以及显式地址需要提供 token。'
      }
    }
  ],
  createProcessPlugin: [
    {
      title: {
        en: 'Let a Host own a spawned service and its release',
        zh: '把子进程服务及其释放交给 Host'
      },
      problem: {
        en: 'An application installs several services and needs one owner to close their process connections during shutdown.\n\nKeeping each child in a separate local variable makes it easy to omit one from cleanup or mix service lookup with native process ownership.\n\nCreate a named process plugin, install it with host.use(), call through host.process, and dispose the Host in finally.',
        zh: '应用安装多个服务时，需要一个所有者在退出时统一关闭它们的进程连接。\n\n把每个子进程分散保存在局部变量里，容易漏掉清理项，也容易把服务查找与原生进程所有权混在一起。\n\n创建带名称的进程插件，用 `host.use()` 安装，经 `host.process` 调用，并在 `finally` 中释放 Host。'
      },
      example: {
        en: "import { defineHost } from '@migaia/plugin-host'\nimport { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nif (isProcessChild()) {\n  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })\n} else {\n  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({\n    name: 'service',\n    spawn: true\n  })\n  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({\n    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n  })\n  try {\n    await host.use(service)\n    console.log(await host.process!.request('service', 'double', 21))\n    console.log((await host.process!.list()).connections.map((entry) => entry.kind).join(','))\n  } finally {\n    const result = await host.dispose()\n    console.log(result.cleanupComplete)\n  }\n}",
        zh: "import { defineHost } from '@migaia/plugin-host'\nimport { createProcessPeer, createProcessPlugin, isProcessChild } from '@migaia/rpc-process'\n\ntype IServiceApi = { double(value: number): number }\nif (isProcessChild()) {\n  await createProcessPeer({ provide: { double: (value: number) => value * 2 } })\n} else {\n  const service = createProcessPlugin<IServiceApi, Record<never, never>, 'service'>({\n    name: 'service',\n    spawn: true\n  })\n  const host = defineHost<Record<string, never>, never, readonly [typeof service]>({\n    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }\n  })\n  try {\n    await host.use(service)\n    console.log(await host.process!.request('service', 'double', 21))\n    console.log((await host.process!.list()).connections.map((entry) => entry.kind).join(','))\n  } finally {\n    const result = await host.dispose()\n    console.log(result.cleanupComplete)\n  }\n}"
      },
      result: {
        en: 'Output is `42`, `spawn`, then `true`: the call succeeds, the outlet identifies a spawned connection, and Host cleanup completes.\n\nThe Host owns this installed child; both execution budgets are explicitly false, meaning unlimited, rather than defaults, and no arbitrary application side effects are rolled back.',
        zh: '输出为 `42`、`spawn`、`true`：调用成功，出口识别出启动型连接，Host 清理也已完成。\n\nHost 拥有已安装的子进程；两个执行预算都显式设为 `false`，表示不设上限，并非默认值，也不会回滚应用任意外部副作用。'
      }
    }
  ],
  createProcessResilience: [
    {
      title: {
        en: 'Keep retry scopes stable across reconnections and separate principals',
        zh: '让重连复用同一去重范围并隔离不同身份'
      },
      problem: {
        en: 'A reconnect changes connection labels, but retries for the same authenticated principal should still address one retained result scope.\n\nScoping only by connection loses that continuity, while sharing one unqualified scope can mix results belonging to different principals.\n\nDerive sessionOptions from explicit identities and compare their store and scope; these inputs demonstrate configuration, not authentication.',
        zh: '连接重建后，连接标签会变化，但同一个已认证身份的重试仍应指向同一份已保留结果范围。\n\n只按连接划分会丢掉连续性；直接共用一个没有身份区分的范围，又可能把不同身份的结果混在一起。\n\n用完整身份调用 `sessionOptions`，比较返回的存储与范围；这里仅演示配置派生，身份字段本身不构成认证。'
      },
      example: {
        en: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })\ntry {\n  const first = resilience.sessionOptions({\n    connectionId: 'connection-1',\n    sessionId: 'session-1',\n    principalId: 'account-A'\n  })\n  const reconnect = resilience.sessionOptions({\n    connectionId: 'connection-2',\n    sessionId: 'session-2',\n    principalId: 'account-A'\n  })\n  const other = resilience.sessionOptions({\n    connectionId: 'connection-3',\n    sessionId: 'session-3',\n    principalId: 'account-B'\n  })\n  const admission = { token: 'operation', senderId: 'caller' }\n  console.log(first.idempotency.store === reconnect.idempotency.store)\n  console.log(first.idempotency.scope!(admission) === reconnect.idempotency.scope!(admission))\n  console.log(first.idempotency.scope!(admission) !== other.idempotency.scope!(admission))\n  console.log(first.limits.maxGlobal, first.limits.maxPerPeer)\n} finally {\n  await resilience.close()\n}",
        zh: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report: console.error })\ntry {\n  const first = resilience.sessionOptions({\n    connectionId: 'connection-1',\n    sessionId: 'session-1',\n    principalId: 'account-A'\n  })\n  const reconnect = resilience.sessionOptions({\n    connectionId: 'connection-2',\n    sessionId: 'session-2',\n    principalId: 'account-A'\n  })\n  const other = resilience.sessionOptions({\n    connectionId: 'connection-3',\n    sessionId: 'session-3',\n    principalId: 'account-B'\n  })\n  const admission = { token: 'operation', senderId: 'caller' }\n  console.log(first.idempotency.store === reconnect.idempotency.store)\n  console.log(first.idempotency.scope!(admission) === reconnect.idempotency.scope!(admission))\n  console.log(first.idempotency.scope!(admission) !== other.idempotency.scope!(admission))\n  console.log(first.limits.maxGlobal, first.limits.maxPerPeer)\n} finally {\n  await resilience.close()\n}"
      },
      result: {
        en: 'Output is `true`, `true`, `true`, then `32 32`: one owner shares a store, the same principal keeps its scope, and a different principal gets another scope.\n\nThe default concurrent limits are 32 globally and per peer for this session; the application must obtain principalId from successful authentication before applying these options.',
        zh: '输出为 `true`、`true`、`true`、`32 32`：同一治理对象共用存储，相同身份保持范围，不同身份使用不同范围。\n\n此会话默认的全局和单对端并发上限都是 `32`；应用必须在认证成功后取得 `principalId`，再把这些配置用于实际连接。'
      }
    },
    {
      title: {
        en: 'Reject new work after a real child reaches terminal state',
        zh: '真实子进程进入终态后拒绝新任务'
      },
      problem: {
        en: 'A supervised child exits and the selected policy will not restart it, yet an application may still try to dispatch another request.\n\nA cached ready flag can outlive the actual process; replacing the supervisor with a diagnostic object also loses the real lifecycle boundary.\n\nAttach a real Node process supervisor, subscribe to its terminal notification through resilience, and run the returned guard before dispatch.',
        zh: '受监督子进程退出，当前策略不会重启，但应用仍可能继续发送新任务。\n\n缓存的就绪标记可能比真实进程活得更久；用诊断对象替代监督器，又会丢掉实际的生命周期边界。\n\n把真实 Node 进程监督器登记到治理对象，等待它的终态通知，并在发送任务前执行返回的守卫。'
      },
      example: {
        en: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createProcessSupervisor } from '@migaia/supervision/process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => {\n  reports.push(error)\n}\nconst supervisor = createProcessSupervisor({\n  id: 'worker',\n  launcher: createNodeProcessLauncher(),\n  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  report,\n  isolation: 'best-effort',\n  restart: { mode: 'never' },\n  spec: {\n    command: process.execPath,\n    args: ['-e', 'process.exit(1)'],\n    env: { inherit: ['PATH'], set: {} },\n    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }\n  }\n})\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report })\nlet finish: () => void = () => undefined\nconst terminal = new Promise<void>((resolve) => {\n  finish = resolve\n})\nconst off = resilience.onTerminal(() => {\n  finish()\n})\nconst registration = resilience.attachRegistration(\n  'worker',\n  {\n    ownership: 'spawn-owned',\n    health: 'none',\n    supervisor: {\n      restart: () => supervisor.restart(),\n      inspect: () => supervisor.inspect(),\n      dispose: () => supervisor.dispose(),\n      onTerminal: (listener) =>\n        supervisor.subscribe((event) => {\n          if (event.type === 'terminal') listener(event)\n        })\n    }\n  },\n  { kind: 'standalone-host', release: () => supervisor.dispose() }\n)\ntry {\n  const guard = resilience.callGuard('worker')\n  guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  await supervisor.start()\n  await terminal\n  console.log(resilience.inspect('worker')?.state, registration.inspect()?.health)\n  try {\n    guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'PROCESS_TERMINAL_CALL') throw error\n    console.log(failure.code)\n  }\n  off()\n  const closing = resilience.close()\n  console.log(closing === resilience.close())\n  await closing\n  console.log(resilience.inspect('worker') === undefined)\n  console.log(supervisor.inspect().state)\n} finally {\n  off()\n  await resilience.close()\n  await supervisor.dispose()\n}",
        zh: "import { createProcessResilience } from '@migaia/rpc-process'\nimport { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'\nimport { createUnitBudget } from '@migaia/supervision'\nimport { createProcessSupervisor } from '@migaia/supervision/process'\nimport { systemScheduler } from '@migaia/utils/scheduler'\n\nconst reports: unknown[] = []\nconst report = (error: unknown) => {\n  reports.push(error)\n}\nconst supervisor = createProcessSupervisor({\n  id: 'worker',\n  launcher: createNodeProcessLauncher(),\n  budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),\n  scheduler: systemScheduler,\n  report,\n  isolation: 'best-effort',\n  restart: { mode: 'never' },\n  spec: {\n    command: process.execPath,\n    args: ['-e', 'process.exit(1)'],\n    env: { inherit: ['PATH'], set: {} },\n    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'drain' }\n  }\n})\nconst resilience = createProcessResilience({ scheduler: systemScheduler, report })\nlet finish: () => void = () => undefined\nconst terminal = new Promise<void>((resolve) => {\n  finish = resolve\n})\nconst off = resilience.onTerminal(() => {\n  finish()\n})\nconst registration = resilience.attachRegistration(\n  'worker',\n  {\n    ownership: 'spawn-owned',\n    health: 'none',\n    supervisor: {\n      restart: () => supervisor.restart(),\n      inspect: () => supervisor.inspect(),\n      dispose: () => supervisor.dispose(),\n      onTerminal: (listener) =>\n        supervisor.subscribe((event) => {\n          if (event.type === 'terminal') listener(event)\n        })\n    }\n  },\n  { kind: 'standalone-host', release: () => supervisor.dispose() }\n)\ntry {\n  const guard = resilience.callGuard('worker')\n  guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  await supervisor.start()\n  await terminal\n  console.log(resilience.inspect('worker')?.state, registration.inspect()?.health)\n  try {\n    guard.beforeDispatch({ method: 'work', mode: 'request', generation: supervisor.generation })\n  } catch (error) {\n    const failure = error as Error & { code?: string }\n    if (failure.code !== 'PROCESS_TERMINAL_CALL') throw error\n    console.log(failure.code)\n  }\n  off()\n  const closing = resilience.close()\n  console.log(closing === resilience.close())\n  await closing\n  console.log(resilience.inspect('worker') === undefined)\n  console.log(supervisor.inspect().state)\n} finally {\n  off()\n  await resilience.close()\n  await supervisor.dispose()\n}"
      },
      result: {
        en: 'Output is `terminal none`, `PROCESS_TERMINAL_CALL`, `true`, `true`, then `terminal`: the guard rejects, close is shared, and governance removal leaves the supervisor state intact.\n\nThe child really exits with code 1 under restart mode never; the handler marks the terminal report handled, while caller cleanup still disposes the original supervisor.',
        zh: '输出依次为 `terminal none`、`PROCESS_TERMINAL_CALL`、`true`、`true`、`terminal`：守卫拒绝新任务，关闭复用同一 Promise，解除治理后监督器状态仍被保留。\n\n子进程确实以退出码 `1` 结束，重启模式为 `never`；监听回调将该终态报告标记为已处理，调用方仍负责释放原始监督器。'
      }
    }
  ]
}
