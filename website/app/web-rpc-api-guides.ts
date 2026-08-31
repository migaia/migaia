import type { IApiGuide, IGuideLocale } from './api-guides.js'

type IWebRpcGuideInput = {
  readonly purposeEn: string
  readonly purposeZh: string
  readonly quickStart?: string
  readonly useEn: readonly string[]
  readonly useZh: readonly string[]
  readonly avoidEn: readonly string[]
  readonly avoidZh: readonly string[]
}

/** Builds one maintained bilingual WebRPC guide without cross-locale fallback. */
function guide(input: IWebRpcGuideInput): Readonly<Record<IGuideLocale, IApiGuide>> {
  return {
    en: {
      purpose: input.purposeEn,
      quickStart: input.quickStart,
      scenarios:
        input.useEn.length >= 2
          ? input.useEn
          : [
              ...input.useEn,
              'The caller needs this behavior to be explicit, testable, and released with the endpoint.'
            ],
      avoidWhen:
        input.avoidEn.length >= 2
          ? input.avoidEn
          : [...input.avoidEn, 'A narrower public boundary already satisfies the required behavior.'],
      options: []
    },
    zh: {
      purpose: input.purposeZh,
      quickStart: input.quickStart,
      scenarios:
        input.useZh.length >= 2
          ? input.useZh
          : [...input.useZh, '调用方需要明确测试该行为，并在 endpoint 销毁时一起释放相关资源。'],
      avoidWhen:
        input.avoidZh.length >= 2
          ? input.avoidZh
          : [...input.avoidZh, '更窄的 public boundary 已经满足所需行为。'],
      options: []
    }
  }
}

/** Creates a guide for an endpoint preset with an explicit public capability boundary. */
function endpointGuide(input: {
  readonly name: string
  readonly importPath: string
  readonly surfaceEn: string
  readonly surfaceZh: string
  readonly useEn: string
  readonly useZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `Creates an endpoint that can ${input.surfaceEn}. Setup is all-or-nothing: if one installation step fails, WebRPC removes the listeners and resources installed by earlier steps.`,
    purposeZh: `创建可${input.surfaceZh}的端点。初始化会整体成功或整体失败；如果中途出错，WebRPC 会清理此前已经安装的监听器和资源。`,
    quickStart: `import { ${input.name} } from '${input.importPath}'\nimport { connect } from '@migaia/web-rpc'\nimport { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'\n\nconst [transport] = createMemoryTransportPair()\nconst endpoint = await ${input.name}({\n  id: 'client',\n  transport,\n  middlewares: [connect({ transport })]\n})`,
    useEn: [input.useEn, 'Use it when endpoint setup must clean up partially installed listeners after cancellation or failure.'],
    useZh: [input.useZh, '当初始化被取消或失败时，需要自动清理已经安装的监听器和连接资源。'],
    avoidEn: ['You only send one-way notifications and never wait for a returned result; use the host messaging API directly.', 'The preset includes operations the application does not use; choose a client/provider preset or compose only the needed features.'],
    avoidZh: ['只发送单向通知且从不等待返回结果；这时直接使用宿主环境的消息 API 更清楚。', '该预设包含应用不会使用的操作；应改用 client/provider 预设，或只组合需要的功能。']
  })
}

/** Creates a guide for a first-party middleware configuration token. */
function middlewareGuide(input: {
  readonly name: string
  readonly purposeEn: string
  readonly purposeZh: string
  readonly code: string
  readonly useEn: string
  readonly useZh: string
  readonly avoidEn: string
  readonly avoidZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: input.purposeEn,
    purposeZh: input.purposeZh,
    quickStart: `import { ${input.name} } from '@migaia/web-rpc'\n\nconst middleware = ${input.code}`,
    useEn: [input.useEn, 'The policy must be installed atomically with the endpoint and released by endpoint.dispose().'],
    useZh: [input.useZh, '该策略需要随 endpoint 原子安装，并由 endpoint.dispose() 统一释放。'],
    avoidEn: [input.avoidEn, 'Using middleware as a substitute for selecting an endpoint Feature.'],
    avoidZh: [input.avoidZh, '把 middleware 当成选择 endpoint Feature 的替代品。']
  })
}

/** Creates a guide for a host-specific transport adapter. */
function transportGuide(input: {
  readonly name: string
  readonly importPath: string
  readonly expression: string
  readonly boundaryEn: string
  readonly boundaryZh: string
  readonly cautionEn: string
  readonly cautionZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `Wraps ${input.boundaryEn} as the send/receive connection expected by a WebRPC endpoint. The adapter also records how the two sides are connected, how messages are encoded, and which side must close the host resource.`,
    purposeZh: `把${input.boundaryZh}包装成 WebRPC endpoint 所需的消息收发连接。适配器还会记录两端如何连接、消息如何编码，以及由哪一端负责关闭宿主资源。`,
    quickStart: `import { ${input.name} } from '${input.importPath}'\n\nconst transport = ${input.expression}\nconst endpoint = await createEndpoint({\n  id: 'local',\n  transport,\n  middlewares: [connect({ transport })]\n})`,
    useEn: [`The two endpoints communicate through ${input.boundaryEn}.`, 'Use the adapter when WebRPC should register the message listener and remove it when the endpoint is disposed.'],
    useZh: [`两个 endpoint 需要通过${input.boundaryZh}通信。`, '需要由 WebRPC 安装消息监听器，并在 endpoint 销毁时自动移除监听器。'],
    avoidEn: [input.cautionEn, 'Do not manually forward internal message objects; doing so skips connection validation and cleanup.'],
    avoidZh: [input.cautionZh, '不要手动转发 WebRPC 内部消息对象，否则会跳过连接校验和自动清理。']
  })
}

/** Creates a reading guide for one public failure class. */
function errorGuide(input: {
  readonly name: string
  readonly conditionEn: string
  readonly conditionZh: string
  readonly distinctionEn: string
  readonly distinctionZh: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `${input.name} represents ${input.conditionEn}. Its stable source and code let callers handle the failure without parsing message text, while cause and cleanup fields retain the original error.`,
    purposeZh: `${input.name} 表示${input.conditionZh}。调用方可以读取稳定的 source 与 code 处理失败，无需解析 message；原始错误仍保留在 cause 或清理结果字段中。`,
    quickStart: `import { ${input.name} } from '@migaia/web-rpc'\n\ntry {\n  await endpoint.send('worker', 'load', [])\n} catch (error) {\n  if (error instanceof ${input.name}) {\n    console.error(error.code, error.cause)\n  }\n}`,
    useEn: [input.distinctionEn, 'Catch it only where the caller can recover, translate, report, or apply a bounded retry policy.'],
    useZh: [input.distinctionZh, '只在调用方能够恢复、转换、报告或执行有上限重试的边界捕获。'],
    avoidEn: ['Branching on message text instead of source, code, name, or native error identity.', 'Constructing it to represent a normal endpoint state.'],
    avoidZh: ['不要根据 message 文本分支；应读取 source、code、name 或原生错误类型。', '不要用它表示正常 endpoint 状态。']
  })
}

/** Creates a guide for a canonical wire or runtime discriminant object. */
function constantGuide(input: {
  readonly name: string
  readonly roleEn: string
  readonly roleZh: string
  readonly member: string
  readonly value: string
}): Readonly<Record<IGuideLocale, IApiGuide>> {
  return guide({
    purposeEn: `Provides the canonical ${input.roleEn}. Use its members instead of repeating wire-visible or cross-module string literals.`,
    purposeZh: `提供规范的${input.roleZh}。应引用其 member，不要重复书写 wire-visible 或 cross-module string literal。`,
    quickStart: `if (value === ${input.name}.${input.member}) {\n  // ${input.value}\n}`,
    useEn: ['Code must produce, compare, log, or test the corresponding stable discriminant.', 'A custom adapter or diagnostic consumer interoperates with WebRPC metadata.'],
    useZh: ['代码需要生成、比较、记录或测试对应的 stable discriminant。', 'custom adapter 或 diagnostic consumer 需要与 WebRPC metadata 互操作。'],
    avoidEn: ['Using the object as mutable configuration.', 'Inventing a new member that the protocol or runtime does not recognize.'],
    avoidZh: ['把该 object 当作 mutable configuration。', '自行发明 protocol 或 runtime 不识别的新 member。']
  })
}

/** Human-maintained WebRPC guides keyed by stable public route identity. */
const webRpcCoreGuides: Readonly<
  Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>
> = {
  'web-rpc:index:createEndpoint': endpointGuide({
    name: 'createEndpoint', importPath: '@migaia/web-rpc',
    surfaceEn: 'call remote methods, provide local methods, discover peers, send control messages, and transfer chunked payloads',
    surfaceZh: '调用远端方法、提供本地方法、发现对端、发送控制消息，并传输需要分片的大数据',
    useEn: 'Use the root preset only when one endpoint needs all five operations listed above.',
    useZh: '只有同一个 endpoint 确实需要上面五类操作时，才使用根入口的完整预设。'
  }),
  'web-rpc:full:createFullEndpoint': endpointGuide({
    name: 'createFullEndpoint', importPath: '@migaia/web-rpc/full',
    surfaceEn: 'the explicit full outbound, provider, discovery, control, and chunk surface',
    surfaceZh: '显式完整的 outbound、provider、discovery、control 与 chunk surface',
    useEn: 'The full preset is intentional and the import should make that choice visible.',
    useZh: '明确选择 full preset，并希望 import 直接表达该意图。'
  }),
  'web-rpc:client:createClientEndpoint': endpointGuide({
    name: 'createClientEndpoint', importPath: '@migaia/web-rpc/client',
    surfaceEn: 'kernel and outbound call capabilities only',
    surfaceZh: '仅 kernel 与 outbound call capability',
    useEn: 'This endpoint only calls or dispatches to remote providers.',
    useZh: '该 endpoint 只调用远端 provider 或发送单向 dispatch。'
  }),
  'web-rpc:provider:createProviderEndpoint': endpointGuide({
    name: 'createProviderEndpoint', importPath: '@migaia/web-rpc/provider',
    surfaceEn: 'outbound calls plus provider registration',
    surfaceZh: 'outbound call 与 provider registration',
    useEn: 'This endpoint exposes methods and may also call its peer.',
    useZh: '该 endpoint 需要暴露 method，并且也可能回调 peer。'
  }),
  'web-rpc:core:createComposedEndpoint': guide({
    purposeEn: 'Builds the smallest endpoint from an explicit non-empty Feature tuple. Private Feature dependencies are installed and deduplicated without silently widening the public root surface.',
    purposeZh: '从显式、非空的 Feature tuple 构造最小 endpoint。私有 Feature dependency 会被安装并去重，但不会静默扩大 public root surface。',
    quickStart: "import { createComposedEndpoint } from '@migaia/web-rpc/core'\nimport { outbound } from '@migaia/web-rpc/features/outbound'\n\nconst endpoint = await createComposedEndpoint(\n  { id: 'client', transport, middlewares: [connect({ transport })] },\n  [outbound()] as const\n)",
    useEn: ['Bundle custody or least-authority design requires an exact capability surface.', 'A custom endpoint combines only selected first-party Features.'],
    useZh: ['bundle custody 或 least-authority design 需要精确 capability surface。', 'custom endpoint 只组合选定的 first-party Feature。'],
    avoidEn: ['The complete preset is genuinely required.', 'Passing an empty or duplicate Feature tuple.'],
    avoidZh: ['确实需要 complete preset。', '传入空 tuple 或重复 Feature。']
  }),
  'web-rpc:index:connect': middlewareGuide({
    name: 'connect', purposeEn: 'Installs the single transport authority, subscribes inbound frames, and owns transport cleanup according to declared custody.', purposeZh: '安装唯一 transport authority、订阅 inbound frame，并按声明的 custody 拥有 transport cleanup。', code: 'connect({ transport })',
    useEn: 'Every operational endpoint needs exactly one resolved transport.', useZh: '每个可运行 endpoint 都需要且只能解析出一个 transport。',
    avoidEn: 'Installing more than one connect middleware or providing conflicting transport objects.', avoidZh: '安装多个 connect middleware，或提供互相冲突的 transport object。'
  }),
  'web-rpc:index:contract': middlewareGuide({
    name: 'contract', purposeEn: 'Negotiates an accepted protocol version and validates method parameters and results through small parse-compatible schemas at the network boundary.', purposeZh: '协商可接受的 protocol version，并通过 parse-compatible schema 在 network boundary 校验 method parameter 与 result。', code: "contract({ version: '1', schemas: { sum: { params: sumInput, result: sumOutput } } })",
    useEn: 'Peers require version compatibility or untrusted payloads must be schema-validated.', useZh: 'peer 需要 version compatibility，或 untrusted payload 必须通过 schema validation。',
    avoidEn: 'Treating a version string as peer authentication.', avoidZh: '把 version string 当作 peer authentication。'
  }),
  'web-rpc:index:protocol': middlewareGuide({
    name: 'protocol', purposeEn: 'Defines the outbound encoder and inbound decoder for wire envelopes and declares the encoded representation expected by the transport.', purposeZh: '定义 wire envelope 的 outbound encoder 与 inbound decoder，并声明 transport 期望的 encoded representation。', code: "protocol({ encodedType: 'string', encode: JSON.stringify, decode: JSON.parse })",
    useEn: 'The transport cannot carry structured objects directly or a stable wire codec is required.', useZh: 'transport 不能直接承载 structured object，或需要稳定 wire codec。',
    avoidEn: 'Encoding business payloads independently outside the envelope codec.', avoidZh: '在 envelope codec 外独立编码 business payload。'
  }),
  'web-rpc:index:authentication': middlewareGuide({
    name: 'authentication', purposeEn: 'Protects every outbound and inbound frame, including control and chunk frames, by applying paired encryption/decryption and signing/verification transforms in the defined order.', purposeZh: '按规定顺序对每个 outbound/inbound frame 执行成对的 encrypt/decrypt 与 sign/verify；control frame 和 chunk frame 同样受保护。', code: 'authentication({ encrypt, decrypt, sign, verify, encodedType: \'uint8array\' })',
    useEn: 'The channel itself is not an adequate confidentiality or integrity boundary.', useZh: 'channel 本身不足以提供 confidentiality 或 integrity boundary。',
    avoidEn: 'Configuring only one half of an encryption or signature pair, or requiring transferable zero-copy buffers.', avoidZh: '只配置 encryption/signature pair 的一半，或仍要求 transferable zero-copy buffer。'
  }),
  'web-rpc:index:chunk': middlewareGuide({
    name: 'chunk', purposeEn: 'Configures bounded splitting and reassembly for large string envelopes, with limits for message size, peers, buffered bytes, chunk count, and assembly lifetime.', purposeZh: '配置大型 string envelope 的有界拆分与重组，并限制 message size、peer、buffered bytes、chunk count 与 assembly lifetime。', code: 'chunk({ chunkSize: 64 * 1024, maxMessageBytes: 4 * 1024 * 1024 })',
    useEn: 'Encoded string envelopes may exceed the underlying channel message budget.', useZh: 'encoded string envelope 可能超过底层 channel message budget。',
    avoidEn: 'Splitting Uint8Array payloads or disabling bounds on an untrusted channel.', avoidZh: '拆分 Uint8Array payload，或在 untrusted channel 上关闭边界。'
  }),
  'web-rpc:index:timeout': middlewareGuide({
    name: 'timeout', purposeEn: 'Applies a bounded deadline to outbound request/response work and rejects timed-out calls with a stable WebRpcTimeoutError contract.', purposeZh: '为 outbound request/response work 设置有界 deadline，并以稳定 WebRpcTimeoutError contract 拒绝超时调用。', code: 'timeout({ timeoutMs: 5_000 })',
    useEn: 'A remote call must not remain pending forever.', useZh: 'remote call 不得永久 pending。',
    avoidEn: 'Using a large timeout to conceal an overloaded or unreachable provider.', avoidZh: '用很大的 timeout 掩盖 overloaded 或 unreachable provider。'
  }),
  'web-rpc:index:ping': middlewareGuide({
    name: 'ping', purposeEn: 'Adds control-frame liveness probes and exposes ping or pingAll only when the selected endpoint surface also owns control capability.', purposeZh: '增加 control-frame liveness probe；只有 endpoint surface 同时拥有 control capability 时才公开 ping 或 pingAll。', code: 'ping({ timeoutMs: 2_000 })',
    useEn: 'The application needs an explicit bounded peer-liveness check.', useZh: '应用需要显式、有界的 peer liveness check。',
    avoidEn: 'Treating a successful ping as authentication or business-service readiness.', avoidZh: '把 ping 成功当作 authentication 或 business-service readiness。'
  }),
  'web-rpc:index:abort': middlewareGuide({
    name: 'abort', purposeEn: 'Enables propagation of caller cancellation to in-flight remote provider work while preserving the original abort reason at the local boundary.', purposeZh: '把 caller cancellation 传播到正在执行的 remote provider work，同时在本地边界保留原始 abort reason。', code: 'abort()',
    useEn: 'Calls can outlive the UI, request, task, or owner that started them.', useZh: 'call 可能活得比启动它的 UI、request、task 或 owner 更久。',
    avoidEn: 'Assuming cancellation can undo remote side effects that already committed.', avoidZh: '假设 cancellation 能撤销远端已经 commit 的 side effect。'
  }),
  'web-rpc:index:hooks': middlewareGuide({
    name: 'hooks', purposeEn: 'Installs ordered observability listeners for endpoint lifecycle and operation events while containing listener failures away from RPC results.', purposeZh: '为 endpoint lifecycle 与 operation event 安装有序 observability listener，并隔离 listener failure，避免改变 RPC result。', code: 'hooks({ listeners: { error: [report] }, onHookError: reportHookFailure })',
    useEn: 'Metrics, tracing, audit, or diagnostics need structured operation events.', useZh: 'metrics、tracing、audit 或 diagnostics 需要 structured operation event。',
    avoidEn: 'Implementing business control flow or mutating RPC results from a diagnostic listener.', avoidZh: '在 diagnostic listener 中实现 business control flow 或修改 RPC result。'
  }),
  'web-rpc:index:uuid': middlewareGuide({
    name: 'uuid', purposeEn: 'Supplies the identifier generator used for tasks, messages, and variations while retaining collision and replay checks.', purposeZh: '提供 task、message 与 variation 使用的 identifier generator，同时保留 collision 与 replay check。', code: 'uuid({ generate: () => crypto.randomUUID() })',
    useEn: 'Tests need deterministic identifiers or the host owns a secure identifier service.', useZh: '测试需要 deterministic identifier，或宿主拥有 secure identifier service。',
    avoidEn: 'Using sequential or low-entropy identifiers on an untrusted channel.', avoidZh: '在 untrusted channel 上使用 sequential 或 low-entropy identifier。'
  }),
  'web-rpc:features-outbound:outbound': guide({
    purposeEn: 'Selects outbound request, broadcast request, one-way dispatch, and broadcast dispatch as an explicit public endpoint capability.', purposeZh: '把 outbound request、broadcast request、one-way dispatch 与 broadcast dispatch 选为显式 public endpoint capability。', quickStart: "const endpoint = await createComposedEndpoint(config, [outbound()] as const)\nconst result = await endpoint.send('worker', 'sum', [1, 2])", useEn: ['A composed endpoint must call remote providers or dispatch events.'], useZh: ['composed endpoint 需要调用 remote provider 或 dispatch event。'], avoidEn: ['The endpoint only receives control or discovery frames.'], avoidZh: ['endpoint 只接收 control 或 discovery frame。']
  }),
  'web-rpc:features-provider:provider': guide({
    purposeEn: 'Selects provider registration and its intentional outbound closure so one endpoint can expose methods and call its peer.', purposeZh: '选择 provider registration 及其刻意包含的 outbound closure，使同一 endpoint 能暴露 method 并调用 peer。', quickStart: "const endpoint = await createComposedEndpoint(config, [provider()] as const)\nendpoint.provide('sum', ({ data, success }) => success(sum(data)))", useEn: ['A composed endpoint owns remotely callable methods.'], useZh: ['composed endpoint 拥有可被远端调用的 method。'], avoidEn: ['Only outbound calls are required; select outbound() instead.'], avoidZh: ['只需要 outbound call；应选择 outbound()。']
  }),
  'web-rpc:features-discovery:discovery': guide({
    purposeEn: 'Selects peer discovery and lazy connect without exposing private outbound dependencies as root send methods.', purposeZh: '选择 peer discovery 与 lazy connect，但不会把私有 outbound dependency 暴露成 root send method。', quickStart: "const endpoint = await createComposedEndpoint(config, [discovery()] as const)\nawait endpoint.connect('worker')\nconsole.log(endpoint.discovery)", useEn: ['Targets are learned dynamically rather than fully declared at construction.'], useZh: ['target 在运行时动态发现，而不是构造时全部声明。'], avoidEn: ['Static targetIds already describe a fixed topology and no discovery state is needed.'], avoidZh: ['固定 topology 已由 static targetIds 完整描述，不需要 discovery state。']
  }),
  'web-rpc:features-control:control': guide({
    purposeEn: 'Selects control-frame routing required by liveness, cancellation, and related control middleware without adding business methods by itself.', purposeZh: '选择 liveness、cancellation 等 control middleware 所需的 control-frame routing；它本身不增加 business method。', quickStart: "const endpoint = await createComposedEndpoint(\n  { ...config, middlewares: [...config.middlewares, ping()] },\n  [control()] as const\n)\nawait endpoint.ping('worker')", useEn: ['A composed endpoint uses ping or other control-frame middleware.'], useZh: ['composed endpoint 使用 ping 或其他 control-frame middleware。'], avoidEn: ['Expecting control() alone to install a ping policy.'], avoidZh: ['期望 control() 自己安装 ping policy。']
  }),
  'web-rpc:features-chunk:chunk': guide({
    purposeEn: 'Selects chunk-frame ownership for a composed endpoint; the root chunk() middleware separately configures splitting and capacity policy.', purposeZh: '为 composed endpoint 选择 chunk-frame ownership；root chunk() middleware 另行配置 splitting 与 capacity policy。', quickStart: "const endpoint = await createComposedEndpoint(\n  { ...config, middlewares: [...config.middlewares, chunk({ chunkSize: 65536 })] },\n  [chunkFeature()] as const\n)", useEn: ['Large encoded messages require chunk-frame routing in a minimal composition.'], useZh: ['大型 encoded message 在最小 composition 中需要 chunk-frame routing。'], avoidEn: ['Confusing the Feature token with the same-named middleware configuration.'], avoidZh: ['混淆同名的 Feature token 与 middleware configuration。']
  }),
  'web-rpc:adapters-memory:createMemoryTransportPair': transportGuide({ name: 'createMemoryTransportPair', importPath: '@migaia/web-rpc/adapters/memory', expression: 'createMemoryTransportPair()', boundaryEn: 'an isolated in-process paired channel', boundaryZh: '隔离的 in-process paired channel', cautionEn: 'Production peers live in different processes or browsing contexts.', cautionZh: '生产 peer 位于不同 process 或 browsing context。' }),
  'web-rpc:adapters-broadcast-channel:createBroadcastChannelTransport': transportGuide({ name: 'createBroadcastChannelTransport', importPath: '@migaia/web-rpc/adapters/broadcast-channel', expression: "createBroadcastChannelTransport(new BroadcastChannel('migaia'))", boundaryEn: 'a BroadcastChannel shared by same-origin contexts', boundaryZh: '由 same-origin context 共享的 BroadcastChannel', cautionEn: 'The channel must be treated as an authentication boundary; BroadcastChannel is an honest-node routing channel.', cautionZh: '需要把 channel 当作 authentication boundary；BroadcastChannel 只提供 honest-node routing。' }),
  'web-rpc:adapters-message-port:createBrowserMessagePortTransport': transportGuide({ name: 'createBrowserMessagePortTransport', importPath: '@migaia/web-rpc/adapters/message-port', expression: "createBrowserMessagePortTransport(port, { ownership: 'owned' })", boundaryEn: 'a browser MessagePort', boundaryZh: 'browser MessagePort', cautionEn: 'The port lifecycle is owned elsewhere; use borrowed custody instead of closing it.', cautionZh: 'port lifecycle 由外部拥有；应使用 borrowed custody，不能关闭它。' }),
  'web-rpc:adapters-message-port:createNodeMessagePortTransport': transportGuide({ name: 'createNodeMessagePortTransport', importPath: '@migaia/web-rpc/adapters/message-port', expression: 'createNodeMessagePortTransport(port)', boundaryEn: 'a Node-compatible MessagePort', boundaryZh: 'Node-compatible MessagePort', cautionEn: 'The value does not implement the Node message, postMessage, and close contract.', cautionZh: '该值不实现 Node message、postMessage 与 close contract。' }),
  'web-rpc:adapters-web-worker:createWebWorkerTransport': transportGuide({ name: 'createWebWorkerTransport', importPath: '@migaia/web-rpc/adapters/web-worker', expression: 'createWebWorkerTransport(worker)', boundaryEn: 'a dedicated Worker or WorkerGlobalScope-like port', boundaryZh: 'dedicated Worker 或 WorkerGlobalScope-like port', cautionEn: 'Multiple logical peers share the same receiver; use a multiplexed adapter instead.', cautionZh: '多个 logical peer 共享同一个 receiver；应使用 multiplexed adapter。' }),
  'web-rpc:adapters-shared-worker:createSharedWorkerTransport': transportGuide({ name: 'createSharedWorkerTransport', importPath: '@migaia/web-rpc/adapters/shared-worker', expression: 'createSharedWorkerTransport(worker.port)', boundaryEn: 'a SharedWorker MessagePort with multiplexed peer assumptions', boundaryZh: '具有 multiplexed peer assumption 的 SharedWorker MessagePort', cautionEn: 'Peer identity cannot be established for the shared topology.', cautionZh: '无法为 shared topology 建立 peer identity。' }),
  'web-rpc:adapters-service-worker:createServiceWorkerTransport': transportGuide({ name: 'createServiceWorkerTransport', importPath: '@migaia/web-rpc/adapters/service-worker', expression: 'createServiceWorkerTransport({ target: controller, receiver: navigator.serviceWorker })', boundaryEn: 'a ServiceWorker target and its separate message receiver', boundaryZh: 'ServiceWorker target 及其独立 message receiver', cautionEn: 'The controlling worker is absent or may change without an owner-managed reconnect.', cautionZh: 'controlling worker 不存在，或可能改变但没有 owner-managed reconnect。' }),
  'web-rpc:adapters-window:createWindowMessageTransport': transportGuide({ name: 'createWindowMessageTransport', importPath: '@migaia/web-rpc/adapters/window', expression: "createWindowMessageTransport({ target: frame.contentWindow!, receiver: window, targetOrigin: 'https://trusted.example' })", boundaryEn: 'window.postMessage between a window and an iframe or opener', boundaryZh: 'window 与 iframe/opener 之间的 window.postMessage', cautionEn: 'targetOrigin or source proof cannot be pinned to the intended peer.', cautionZh: '无法把 targetOrigin 或 source proof 固定到预期 peer。' }),
  'web-rpc:adapters-rtc-data-channel:createRtcDataChannelTransport': transportGuide({ name: 'createRtcDataChannelTransport', importPath: '@migaia/web-rpc/adapters/rtc-data-channel', expression: 'createRtcDataChannelTransport(dataChannel)', boundaryEn: 'an open RTCDataChannel', boundaryZh: '已打开的 RTCDataChannel', cautionEn: 'Signaling, reconnect, or channel negotiation still needs to be performed; this adapter does not own it.', cautionZh: 'signaling、reconnect 或 channel negotiation 尚未完成；adapter 不拥有这些流程。' }),
  'web-rpc:adapters-web-transport:createWebTransportDatagramTransport': transportGuide({ name: 'createWebTransportDatagramTransport', importPath: '@migaia/web-rpc/adapters/web-transport', expression: 'createWebTransportDatagramTransport(session.datagrams)', boundaryEn: 'WebTransport unreliable datagrams', boundaryZh: 'WebTransport unreliable datagram', cautionEn: 'The operation requires ordered or reliable delivery guarantees.', cautionZh: 'operation 需要 ordered 或 reliable delivery guarantee。' })
}

/** Cross-realm error utilities and stable failure contracts. */
const webRpcErrorGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'web-rpc:index:serializeError': guide({
    purposeEn: 'Serializes an Error and its bounded cause or AggregateError graph into a cross-realm record containing name, message, stack, source, code, data, and nested failures.',
    purposeZh: '把 Error 及其有界 cause/AggregateError graph 序列化成跨 realm record，保留 name、message、stack、source、code、data 与 nested failure。',
    quickStart: "const payload = serializeError(error)\ntransport.send({ type: 'failure', error: payload })",
    useEn: ['An error must cross a Worker, window, or transport boundary without losing diagnostic identity.'],
    useZh: ['error 需要跨 Worker、window 或 transport boundary，同时不能丢失 diagnostic identity。'],
    avoidEn: ['Serializing arbitrary application data.', 'Replacing the original stack with a receiver-side stack.'],
    avoidZh: ['序列化任意 application data。', '用 receiver-side stack 替换原始 stack。']
  }),
  'web-rpc:index:deserializeError': guide({
    purposeEn: 'Reconstructs a received serialized failure into the closest supported Error class while retaining the transmitted stack, source/code identity, data, and cause graph.',
    purposeZh: '把收到的 serialized failure 重建为最接近的受支持 Error class，同时保留 transmitted stack、source/code identity、data 与 cause graph。',
    quickStart: 'const remoteError = deserializeError(message.error)\nreport(remoteError)',
    useEn: ['A serialized remote failure must become a throwable local value with inspectable provenance.'],
    useZh: ['serialized remote failure 需要成为可抛出的 local value，并可检查 provenance。'],
    avoidEn: ['Trusting remote stack or data as executable input.', 'Regenerating a local error that discards transmitted identity.'],
    avoidZh: ['把 remote stack 或 data 当作 executable input。', '重新生成 local error 并丢弃 transmitted identity。']
  }),
  'web-rpc:index:reachError': guide({
    purposeEn: 'Traverses an error, its cause chain, and AggregateError.errors in bounded identity order so reporting and contract checks can find every reachable original failure.',
    purposeZh: '按有界 identity order 遍历 error、cause chain 与 AggregateError.errors，让 reporting 与 contract check 能找到每个可达的原始 failure。',
    quickStart: "for (const cause of reachError(error)) {\n  if (cause === originalError) console.log('original reached')\n}",
    useEn: ['Diagnostics or tests must prove that wrapping preserved original error identity.'],
    useZh: ['diagnostics 或 test 必须证明 wrapping 保留了 original error identity。'],
    avoidEn: ['Mutating errors during traversal.', 'Assuming every yielded value is an Error instance.'],
    avoidZh: ['遍历期间修改 error。', '假设每个 yielded value 都是 Error instance。']
  }),
  'web-rpc:index:isWebRpcError': guide({
    purposeEn: 'Detects the public WebRPC error shape without same-realm instanceof, making it useful after cross-realm reconstruction.',
    purposeZh: '不依赖 same-realm instanceof，按 public WebRPC error shape 做窄化，因此适用于 cross-realm reconstruction 之后。',
    quickStart: "if (isWebRpcError(error) && error.code === 'DEADLINE_EXCEEDED') {\n  showRetry()\n}",
    useEn: ['A catch boundary needs machine-readable source/code handling across realms.'],
    useZh: ['catch boundary 需要跨 realm 的 machine-readable source/code handling。'],
    avoidEn: ['Using it as proof that an untrusted object is safe.', 'Replacing AbortError or TimeoutError name checks where those semantics matter.'],
    avoidZh: ['把它当作 untrusted object 安全可信的证明。', '在需要 AbortError/TimeoutError semantics 时替代 name check。']
  }),
  'web-rpc:index:WEBRPC_SOURCE': guide({
    purposeEn: 'Exposes the stable source discriminator stamped onto locally produced WebRPC failures so catch boundaries can distinguish ownership without parsing messages.',
    purposeZh: '公开写入本地 WebRPC failure 的稳定 source discriminator，让 catch boundary 无需解析 message 即可区分 ownership。',
    quickStart: 'if (isWebRpcError(error) && error.source === WEBRPC_SOURCE) {\n  reportRpcFailure(error)\n}',
    useEn: ['A shared error boundary handles failures from several libraries.'],
    useZh: ['shared error boundary 需要处理来自多个 library 的 failure。'],
    avoidEn: ['Treating source as a security credential.', 'Hard-coding the same string in several consumers.'],
    avoidZh: ['把 source 当作 security credential。', '在多个 consumer 中硬编码同一个 string。']
  }),
  'web-rpc:index:WebRpcError': errorGuide({ name: 'WebRpcError', conditionEn: 'a coded local RPC failure without a more specific public subclass', conditionZh: '没有更具体 public subclass 的 coded local RPC failure', distinctionEn: 'Handle a stable WebRPC code not represented by a narrower class.', distinctionZh: '处理没有 narrower class 表达的稳定 WebRPC code。' }),
  'web-rpc:index:WebRpcSchemaValidationError': errorGuide({ name: 'WebRpcSchemaValidationError', conditionEn: 'schema rejection of method parameters or results and retains rejected data', conditionZh: 'method parameter 或 result 被 schema 拒绝，并保留 rejected data', distinctionEn: 'Reject malformed data at the network contract boundary.', distinctionZh: '在 network contract boundary 拒绝 malformed data。' }),
  'web-rpc:index:WebRpcConfigurationError': errorGuide({ name: 'WebRpcConfigurationError', conditionEn: 'invalid or conflicting endpoint configuration before operation begins', conditionZh: 'operation 开始前的 invalid 或 conflicting endpoint configuration', distinctionEn: 'Fix setup; retrying unchanged configuration cannot succeed.', distinctionZh: '应修正 setup；原样重试不会成功。' }),
  'web-rpc:index:WebRpcConstructionError': errorGuide({ name: 'WebRpcConstructionError', conditionEn: 'atomic endpoint construction failure with cleanup results from rolled-back resources', conditionZh: '原子 endpoint 构造失败，并携带 rolled-back resource 的 cleanup result', distinctionEn: 'Treat cause as primary and cleanupErrors or cleanupPromise as secondary rollback evidence.', distinctionZh: '以 cause 为 primary failure，以 cleanupErrors 或 cleanupPromise 为 secondary rollback evidence。' }),
  'web-rpc:index:WebRpcLifecycleError': errorGuide({ name: 'WebRpcLifecycleError', conditionEn: 'use after endpoint disposal or a terminal lifecycle transition', conditionZh: 'endpoint dispose 后继续使用，或发生 terminal lifecycle transition', distinctionEn: 'Create a new endpoint instead of reviving a terminal one.', distinctionZh: '应创建新 endpoint，不能 revive terminal endpoint。' }),
  'web-rpc:index:WebRpcSerializationError': errorGuide({ name: 'WebRpcSerializationError', conditionEn: 'payload or error serialization that cannot preserve the wire contract', conditionZh: 'payload 或 error serialization 无法保留 wire contract', distinctionEn: 'Correct the payload shape or codec before resending.', distinctionZh: '重新发送前修正 payload shape 或 codec。' }),
  'web-rpc:index:WebRpcProtocolError': errorGuide({ name: 'WebRpcProtocolError', conditionEn: 'a malformed, undecodable, or semantically invalid wire envelope', conditionZh: 'malformed、无法 decode 或语义无效的 wire envelope', distinctionEn: 'Treat the peer or codec as incompatible until the mismatch is resolved.', distinctionZh: '在 mismatch 解决前，把 peer 或 codec 视为 incompatible。' }),
  'web-rpc:index:WebRpcContractError': errorGuide({ name: 'WebRpcContractError', conditionEn: 'protocol-version or declared contract incompatibility between peers', conditionZh: 'peer 之间的 protocol-version 或 declared contract incompatibility', distinctionEn: 'Negotiate a supported version or deploy matching contracts.', distinctionZh: '协商 supported version，或部署匹配 contract。' }),
  'web-rpc:index:WebRpcTransportError': errorGuide({ name: 'WebRpcTransportError', conditionEn: 'send, subscription, listener, or channel failure owned by the transport boundary', conditionZh: '由 transport boundary 拥有的 send、subscription、listener 或 channel failure', distinctionEn: 'Reconnect or replace the transport only when owner policy permits it.', distinctionZh: '仅在 owner policy 允许时 reconnect 或 replace transport。' }),
  'web-rpc:index:WebRpcAuthenticationError': errorGuide({ name: 'WebRpcAuthenticationError', conditionEn: 'failed frame verification, signing, encryption, or decryption', conditionZh: 'frame verification、signing、encryption 或 decryption 失败', distinctionEn: 'Reject the frame and inspect keys, peer identity, or transform ordering.', distinctionZh: '拒绝 frame，并检查 key、peer identity 或 transform order。' }),
  'web-rpc:index:WebRpcChunkError': errorGuide({ name: 'WebRpcChunkError', conditionEn: 'invalid chunk structure or an exceeded reassembly capacity bound', conditionZh: 'chunk structure 无效，或超过 reassembly capacity bound', distinctionEn: 'Reject the assembly instead of retaining unbounded peer-controlled memory.', distinctionZh: '拒绝 assembly，不能保留无界 peer-controlled memory。' }),
  'web-rpc:index:WebRpcRemoteError': errorGuide({ name: 'WebRpcRemoteError', conditionEn: 'a provider-declared remote business failure reconstructed on the caller', conditionZh: 'provider 声明的 remote business failure 在 caller 侧重建', distinctionEn: 'Handle provider code and optional data as a remote application contract.', distinctionZh: '把 provider code 与 optional data 作为 remote application contract 处理。' }),
  'web-rpc:index:WebRpcAbortError': errorGuide({ name: 'WebRpcAbortError', conditionEn: 'caller or owner cancellation with the standard AbortError name', conditionZh: 'caller 或 owner cancellation，并公开标准 AbortError name', distinctionEn: 'Stop dependent work and preserve the reason; do not report expected cancellation as a fault.', distinctionZh: '停止 dependent work 并保留 reason；不要把预期 cancellation 报告成 fault。' }),
  'web-rpc:index:WebRpcTimeoutError': errorGuide({ name: 'WebRpcTimeoutError', conditionEn: 'an exceeded call deadline with the standard TimeoutError name', conditionZh: 'call deadline 超限，并公开标准 TimeoutError name', distinctionEn: 'Retry only when the method is repeat-safe and the caller owns a bounded retry policy.', distinctionZh: '只有 method 可安全重复且 caller 拥有 bounded retry policy 时才能重试。' })
}

/** Stable protocol discriminants used by adapters, diagnostics, and tests. */
const webRpcConstantGuides: Readonly<Record<string, Readonly<Record<IGuideLocale, IApiGuide>>>> = {
  'web-rpc:protocol-constants:WebRpcMessageKind': constantGuide({ name: 'WebRpcMessageKind', roleEn: 'wire-envelope kind set', roleZh: 'wire-envelope kind 集合', member: 'request', value: 'request envelope' }),
  'web-rpc:protocol-constants:WebRpcVariation': constantGuide({ name: 'WebRpcVariation', roleEn: 'control variation set', roleZh: 'control variation 集合', member: 'abort', value: 'abort control frame' }),
  'web-rpc:protocol-constants:WebRpcPlatform': constantGuide({ name: 'WebRpcPlatform', roleEn: 'transport platform labels', roleZh: 'transport platform label', member: 'worker', value: 'Worker transport' }),
  'web-rpc:protocol-constants:WebRpcTransportOwnership': constantGuide({ name: 'WebRpcTransportOwnership', roleEn: 'transport custody modes', roleZh: 'transport custody mode', member: 'borrowed', value: 'remove listeners without closing the host resource' }),
  'web-rpc:protocol-constants:WebRpcTransportEncoding': constantGuide({ name: 'WebRpcTransportEncoding', roleEn: 'transport encoding capabilities', roleZh: 'transport encoding capability', member: 'uint8Array', value: 'binary encoded frames' }),
  'web-rpc:protocol-constants:WebRpcTransportTopology': constantGuide({ name: 'WebRpcTransportTopology', roleEn: 'peer fan-out and trust topology labels', roleZh: 'peer fan-out 与 trust topology label', member: 'multiplexed', value: 'several logical peers share a channel' }),
  'web-rpc:protocol-constants:WebRpcEndpointStatus': constantGuide({ name: 'WebRpcEndpointStatus', roleEn: 'discovery-visible endpoint states', roleZh: 'discovery-visible endpoint state', member: 'active', value: 'endpoint accepts work' }),
  'web-rpc:protocol-constants:WebRpcOperation': constantGuide({ name: 'WebRpcOperation', roleEn: 'single-target operation labels', roleZh: 'single-target operation label', member: 'send', value: 'request and response operation' }),
  'web-rpc:protocol-constants:WebRpcControlKind': constantGuide({ name: 'WebRpcControlKind', roleEn: 'provider-control admission kinds', roleZh: 'provider-control admission kind', member: 'request', value: 'provider request work' }),
  'web-rpc:protocol-constants:WebRpcCandidateStatus': constantGuide({ name: 'WebRpcCandidateStatus', roleEn: 'discovery candidate states', roleZh: 'discovery candidate state', member: 'stale', value: 'candidate is known but not currently active' }),
  'web-rpc:protocol-constants:WebRpcContractFailureKind': constantGuide({ name: 'WebRpcContractFailureKind', roleEn: 'structured contract failure kinds', roleZh: 'structured contract failure kind', member: 'schemaValidation', value: 'schema rejected boundary data' }),
  'web-rpc:protocol-constants:WebRpcDebugPhase': constantGuide({ name: 'WebRpcDebugPhase', roleEn: 'test-only endpoint lifecycle snapshot phases', roleZh: 'test-only endpoint lifecycle snapshot phase', member: 'disposed', value: 'endpoint reached terminal disposal' }),
  'web-rpc:protocol-constants:WebRpcChunkEvent': constantGuide({ name: 'WebRpcChunkEvent', roleEn: 'chunk admission and expiry hook names', roleZh: 'chunk admission 与 expiry hook name', member: 'rejected', value: 'chunk admission was rejected' })
}

export const webRpcApiGuides = {
  ...webRpcCoreGuides,
  ...webRpcErrorGuides,
  ...webRpcConstantGuides
} as const
