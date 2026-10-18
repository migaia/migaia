/**
 * Bilingual reference checked against packages/rpc-core/src on 2026-10-17. Endpoint composition
 * owns execution and lifecycle; rpc-contract owns wire validation. Advanced native adapters and
 * remote peers reuse these owners instead of duplicating transport state. Source discrepancy
 * retained: omitted contract.version defaults to 1.0.0 in discovery, but 1.0 in outbound routing;
 * explicit configuration avoids relying on these different fallbacks.
 */
import type {
  IEnhancerDoc,
  ILibraryReference,
  IMemberDoc,
  ISymbolDoc,
  IText,
  ITypeDoc,
  IEnumDoc
} from './contract.js'
import { runtimeSharedTypes, runtimeEventEnum, runtimeEventSymbol } from './rpc-runtime-shared.js'
import { reference as contractReference } from './rpc-contract.js'
import { observationReference } from './rpc-core-observation.js'
import { transportReference, transportMembers } from './rpc-core-transports.js'
import { remoteReference } from './rpc-core-remote.js'
import { authenticationOptionMembers as authenticationOptions } from './rpc-core-auth.js'
import { kitReference } from './rpc-core-transport-kit.js'

/** Produces explicit bilingual prose at every node. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** A property documents its observable meaning and optional omission policy. */
const p = (en: string, zh: string, fallback?: IText): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Method docs keep input provenance and completion visible together. */
const m = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Root documentation stores canonical data once across public subpath aliases. */
const symbols: Record<string, ISymbolDoc> = {}
/** Exported type and instance nodes close the method/return traversal. */
const types: Record<string, ITypeDoc> = { ...runtimeSharedTypes }
/** Public enum domains retain individual choices and effects. */
const enums: Record<string, IEnumDoc> = { RuntimeEventName: runtimeEventEnum }
/** Enhancer docs describe installation and added endpoint behavior. */
const enhancers: Record<string, IEnhancerDoc> = {}
/** Fully paired native endpoint example with explicit final resource release. */
const endpointExample = `import { createEndpoint, connect } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })
server.provide('echo', (context) => context.success(context.data))
const client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] })
console.log(await client.send('server', 'echo', 'hello'))
await client.dispose()
await server.dispose()
left.close()`
/** Typed peers use the actual runtime path on both sides. */
const peerExample = `import { createPeerPair } from '@migaia/rpc-core/testing'
const pair = await createPeerPair({ a: {}, b: { provide: { echo: (text: string) => text } } })
try { console.log(await pair.a.request('echo', 'hello')) }
finally { await pair.a.close(); await pair.b.close() }`
/** Source of target identifiers in endpoint APIs. */
const targetId = t(
  'Target base identifier selected by the application in targetIds or returned by endpoint discovery/server-list metadata.',
  '应用在目标列表中指定，或从端点发现及服务列表元数据取得的目标基础标识。'
)
/** Source of per-instance receiver identifiers. */
const receiverId = t(
  'Specific receiver identifier returned by discovery candidates or connect.getServerList; never invent an instance address.',
  '发现候选或连接服务列表返回的特定接收端标识，不能虚构实例地址。'
)
/** Provider method names are application contracts, not remote generation tokens. */
const method = t(
  'Application method name registered by the receiving endpoint provide or declared in the actual remote contract.',
  '接收端提供方法登记或实际远端契约声明的应用方法名称。'
)
/** Standard optional operation cancellation controls local admission and waiting. */
const signal = p(
  'Optional caller-owned AbortSignal; cancellation participates only when the required abort capability is installed.',
  '可选调用方取消信号；只有安装所需中止能力时才参与取消。',
  t('Absent: no caller cancellation signal is attached.', '默认不设置，不附加调用方取消信号。')
)
/** Relative timeout semantics preserve explicit false and middleware defaults. */
const timeoutMs = {
  ...p(
    'Optional finite nonnegative local deadline in milliseconds; false explicitly disables it and omission uses timeout middleware configuration.',
    '可选有限非负本地毫秒截止；假值显式关闭，省略使用超时中间件配置。',
    t(
      'Absent: inherit timeout middleware, otherwise no deadline.',
      '默认继承超时中间件，否则不设截止。'
    )
  ),
  values: {
    false: t(
      'Explicitly keep this operation unbounded by a local deadline.',
      '显式让本次操作不受本地截止限制。'
    )
  }
}
/** Explicit physical ownership transfer never infers native backing ownership. */
const transfer = p(
  'Optional caller-supplied original transferable objects in the intended order; the real carrier validates support and ownership.',
  '调用方按预期顺序提供的可选原始可转移对象；实际载体验证支持及所有权。',
  t('Absent: no ownership transfer is requested.', '默认不设置，不请求所有权转移。')
)
/** Native clock injection remains external to this package. */
const scheduler = p(
  'Application monotonic IScheduler shared by endpoint deadlines and PluginHost; now must be finite nonnegative milliseconds.',
  '应用单调调度器由端点截止及插件宿主共用，当前时间须为有限非负毫秒。',
  t('systemScheduler uses host monotonic time and timers.', '默认使用宿主单调时间和计时器。')
)
/** Wall time never drives an execution deadline. */
const wallClock = p(
  'Application IWallClock supplies only wire sentAt and hook timestamps as nonnegative safe-integer epoch milliseconds.',
  '应用纪元时钟只提供线上发送时间及钩子时间戳，须为非负安全整数纪元毫秒。',
  t('systemWallClock uses the host epoch clock.', '默认使用宿主纪元时钟。')
)
/** Operation policy reused by sends, pings and explicit one-way sends. */
const sendOptions: Record<string, IMemberDoc> = {
  signal,
  timeoutMs,
  transfer,
  idempotencyKey: p(
    'Application-issued stable key reused only for the same intended operation; requires actual idempotency capability.',
    '应用签发的稳定键，只为相同预期操作复用，要求实际幂等能力。',
    t('Absent: no keyed replay reservation.', '默认不设置，不进行带键重放预留。')
  ),
  trace: p(
    'Optional caller-issued opaque diagnostic trace; downstream calls must pass it explicitly.',
    '调用方签发的可选不透明诊断追踪，下游调用须显式传入。',
    t('Absent: no trace is attached.', '默认不设置，不附加追踪值。')
  )
}
/** Every endpoint API uses the existing provider and outbound owners. */
const endpointMembers: Record<string, IMemberDoc> = {
  provide: m(
    'Registers one provider for a unique method name; duplicate registration throws PROVIDER_DUPLICATED.',
    '为唯一方法名登记一个提供方；重复登记抛提供方重复错误。',
    {
      method,
      provider: t(
        'Application callback receives IRpcContext and returns context.success or context.failed synchronously or asynchronously. Legacy ordinary throws usually become INTERNAL; trusted wire summaries and SCHEMA_INVALID retain public classification. Runtime operations serialize the original failure.',
        '应用回调接收运行上下文，同步或异步返回成功或失败结果；传统普通抛错通常成为内部失败，可信线上摘要及结构非法保留公开分类，运行接口序列化原失败。'
      )
    },
    t(
      'The same endpoint for chaining; disposal rejects new registrations.',
      '返回同一端点以链式调用，释放后拒绝新登记。'
    ),
    endpointExample
  ),
  on: m(
    'Registers a one-way event listener; callbacks receive IRpcContext and async failures are observed through endpoint hooks.',
    '登记单向事件监听者；回调接收运行上下文，异步失败通过端点钩子观察。',
    {
      event: t(
        'Application event name matching the sender dispatch method.',
        '与发送方派发方法匹配的应用事件名称。'
      ),
      listener: t(
        'Application callback receives IRpcContext, returns void or Promise<void>, and should not retain expired response operations.',
        '应用回调接收运行上下文，返回空值或空值承诺，不应保留过期响应操作。'
      )
    },
    t('Idempotent unsubscriber removes only this registration.', '幂等移除函数只移除本次登记。'),
    'const off = server.on("changed", (context) => console.log(context.data)); client.dispatch("server", "changed", { count: 1 }); off()'
  ),
  send: m(
    'Sends a correlated scalar request to the selected receiver and waits for one actual provider result.',
    '向选定接收端发送关联标量请求，等待一个实际提供方结果。',
    {
      targetId,
      method,
      data: t(
        'Application request payload validated by the installed contract/codec.',
        '由已安装契约及编解码校验的应用请求载荷。'
      ),
      options: t(
        'Optional ISendOptions supplied by the caller; timeout, cancellation, transfer, idempotency and trace remain explicit.',
        '调用方可选发送选项，超时、取消、转移、幂等和追踪均显式指定。'
      )
    },
    t(
      'Promise of provider data; remote business failure, cancellation, deadline, transport or lifecycle failure rejects with its native coded error. A synchronous UUID admission failure releases operation signal listeners; ordinary send cancellation keeps RpcAbortError.',
      '返回提供方数据承诺；远端业务、取消、截止、载体或生命周期失败以原生编码错误拒绝；同步标识生成失败会释放操作信号监听，普通发送取消仍使用 `RpcAbortError`。'
    ),
    endpointExample
  ),
  sendAll: m(
    'Sends the same scalar method to the statically configured target seeds and keeps each target success/failure separately.',
    '向静态配置目标种子发送同一标量方法，分别保留各目标成功和失败。',
    {
      method,
      data: t(
        'Application payload sent independently to every selected target.',
        '独立发送给每个选中目标的应用载荷。'
      ),
      options: t(
        'Caller ISendOptions applied to the selected fan-out operations.',
        '用于所选扇出操作的调用方发送选项。'
      )
    },
    t(
      'IRpcFanoutResult maps receiver/target keys to fulfilled data or original rejected errors.',
      '返回扇出结果，按接收目标键记录兑现数据或原拒绝错误。'
    ),
    'const result = await client.sendAll("echo", "hello"); console.log(result.fulfilled, result.rejected)'
  ),
  dispatch: m(
    'Sends a legacy one-way event without awaiting business completion; pair with on on the receiving endpoint.',
    '发送传统单向事件，不等待业务完成。搭配 `on` 在接收端登记监听。',
    {
      targetId,
      method,
      data: t(
        'Application event payload for the receiving listener.',
        '发送给接收监听者的应用事件载荷。'
      )
    },
    t(
      'Returns void once dispatch is initiated; failures are contained in endpoint hooks.',
      '发起派发后返回空值，失败由端点钩子容纳。'
    ),
    'const off = server.on("changed", (context) => console.log(context.data)); client.dispatch("server", "changed", 1); off()'
  ),
  dispatchAll: m(
    'Dispatches one event to the statically configured target seeds without waiting for business listeners.',
    '向静态配置目标种子派发一个事件，不等待业务监听者完成。',
    {
      method,
      data: t(
        'Application event payload for each selected target.',
        '发送给每个选中目标的应用事件载荷。'
      )
    },
    t(
      'Returns void after scheduling selected dispatches; hooks observe failures.',
      '安排所选派发后返回空值，失败通过钩子观察。'
    ),
    'const off = server.on("changed", (context) => console.log(context.data)); client.dispatchAll("changed", 1); off()'
  ),
  group: m(
    'Reserves every request-only step before execution, then runs in order until first failure; successful earlier effects are not rolled back.',
    '执行前预留全部请求步骤，再按顺序运行到首失败；此前成功效果不回滚。',
    {
      targetId,
      steps: t(
        'Application nonempty method/payload array admitted as IRpcRuntimeGroupSteps.',
        '按运行分组步骤接纳的应用非空方法载荷数组。'
      ),
      options: t(
        'Optional IRpcRuntimeGroupOptions with actual ordering/cancellation/idempotency and local send controls.',
        '可选运行分组选项，包含实际排序、取消、幂等及本地发送控制。'
      )
    },
    t(
      'Promise of actual step outcomes; unsupported native group capability rejects before dispatch.',
      '返回实际步骤结果承诺，不支持原生分组能力时在派发前拒绝。'
    ),
    'const outcomes = await client.group("server", [{ method: "echo", payload: "a" }, { method: "echo", payload: "b" }])'
  ),
  outcome: m(
    'Reads an original logical key outcome from the provider store without executing providers again.',
    '从提供方存储读取原逻辑键结果，不再次执行提供方。',
    {
      targetId,
      idempotencyKey: t(
        'Original application-issued key used for the same earlier logical operation.',
        '同一较早逻辑操作使用的原应用签发键。'
      )
    },
    t(
      'IRpcRuntimeOutcomeResult reports pending/done/unknown and store continuity; unknown never proves nonexecution.',
      '返回运行结果查询，报告待定完成未知及存储连续性；未知不证明从未执行。'
    ),
    'const result = await client.outcome("server", operationKey)'
  ),
  announceClose: m(
    'Announces a bounded drain window to one peer while leaving actual physical close with its owning adapter.',
    '向一个对端宣布有界排空窗口，实际物理关闭仍归所属适配器。',
    {
      targetId,
      options: t(
        'Caller drainMs duration and optional receiverId from discovery; this is a relative peer announcement.',
        '调用方排空毫秒数及发现返回的可选接收标识，这是相对对端通知。'
      )
    },
    t(
      'Resolves when the close control is sent; it does not await remote resource disposal.',
      '关闭控制发送后兑现，不等待远端资源释放。'
    ),
    'await client.announceClose("server", { drainMs: 1000 })'
  ),
  ping: m(
    'Checks one actual receiver liveness; requires installed ping capability and actual negotiated support.',
    '检查实际接收端存活，要求已安装心跳能力及实际协商支持。',
    {
      targetId,
      receiverId,
      options: t(
        'Optional IRpcPingOptions with local signal and deadline override.',
        '可选心跳选项，包含本地信号和截止覆盖。'
      )
    },
    t(
      'Promise<boolean> for the observed reply; disposal settles an active ping as false. Calling after disposal or without ping capability throws its coded error. Ping cancellation does not require abort middleware.',
      '返回所观察响应的布尔承诺；进行中的心跳在释放时结算为假，释放后调用或缺心跳能力时抛编码错误；心跳取消不要求安装中止中间件。'
    ),
    'const alive = await client.ping("server")'
  ),
  pingAll: m(
    'Checks liveness of the statically configured target seeds and retains individual success/failure results.',
    '检查静态配置目标种子存活，并保留各自成功及失败结果。',
    {},
    t(
      'IRpcFanoutResult<boolean> keyed by the selected actual receivers.',
      '返回按选中实际接收端记录的布尔扇出结果。'
    ),
    'const result = await client.pingAll()'
  ),
  connect: p(
    'Connection/discovery controls derived from the actual middleware tuple; manual mode exposes query and registration operations.',
    '从实际中间件元组推导的连接发现控制，手动模式提供查询及登记操作。'
  ),
  discovery: p(
    'Read-only candidate listing and explicit receiver pin controls sharing the canonical discovery owner.',
    '与规范发现所有者共享的候选列表及显式接收端固定控制。'
  ),
  hooks: p(
    'Local diagnostic subscription facade; hooks.on receives IRpcHookEvent and returns an unsubscriber.',
    '本地诊断订阅表面，钩子登记接收事件并返回移除函数。'
  ),
  dispose: m(
    'Idempotently stops admission, drains owned work and releases middleware/adapter resources in the canonical lifecycle order.',
    '幂等停止准入，排空所属工作，并按规范生命周期顺序释放中间件及适配资源。',
    {},
    t(
      'Promise resolves after disposal; cleanup failures remain reachable through standard cause/errors traversal, including all failures in the same batch; future operations fail ENDPOINT_DISPOSED.',
      '释放后承诺兑现；同批全部清理失败均可经标准原因及错误列表遍历，后续操作以端点已释放错误失败。'
    ),
    'await client.dispose()'
  )
}
/** Shared field meanings use actual source/owner provenance rather than type-only descriptions. */
const fields: Record<string, IMemberDoc> = {
  id: p(
    'Application-assigned stable local endpoint identifier included in outgoing routes.',
    '应用分配的稳定本地端点标识，会写入出站路由。'
  ),
  targetId: { summary: targetId },
  receiverId: { summary: receiverId },
  method: { summary: method },
  signal,
  scheduler,
  wallClock,
  senderId: p(
    'Direct authenticated sender identifier provided by the actual admitted inbound binding.',
    '实际已准入入站绑定提供的直接认证发送方标识。'
  ),
  endpointId: p(
    'Local endpoint identifier returned by the actual constructing endpoint owner.',
    '实际构造端点所有者提供的本地端点标识。'
  ),
  localEndpointId: p(
    'Serving endpoint identifier provided by the actual provider execution context.',
    '实际提供方执行上下文给出的服务端点标识。'
  ),
  callerGeneration: p(
    'Optional caller generation from an actually admitted generation-aware directory task.',
    '实际已准入世代目录任务提供的可选调用方世代。'
  ),
  targetGeneration: p(
    'Exact accepted provider execution/session generation, never a launch-attempt counter.',
    '精确已接受提供方执行或会话世代，不是启动尝试计数。'
  ),
  data: p(
    'Application data provided by the actual request, event, schema or result owner.',
    '实际请求、事件、结构或结果所有者提供的应用数据。'
  ),
  timeoutMs,
  route: p(
    'Optional ordered signed forwarding node identifiers; originating ordinary calls omit it.',
    '可选有序签名转发节点标识，普通原发调用省略。'
  ),
  trace: sendOptions.trace,
  transfer,
  source: p(
    'Stable semantic error package source retained from the actual original failure.',
    '从实际原失败保留的稳定语义错误包来源。'
  ),
  code: p(
    'Stable semantic error code; classify it together with source, not diagnostic message text.',
    '稳定语义错误码，须结合来源分类，不按诊断消息文本分类。'
  ),
  cause: p(
    'Original primary error retained by identity through native cause traversal.',
    '通过原生原因遍历按身份保留的原始主错误。'
  ),
  error: p(
    'Original contained failure retained for local diagnostics or fan-out rejection.',
    '为本地诊断或扇出拒绝保留的原始受控失败。'
  ),
  message: p(
    'Diagnostic or application failure message; it conveys no runtime authority.',
    '诊断或应用失败消息，不携带运行时权限。'
  ),
  name: p(
    'Stable application-defined component or local diagnostic identity, not an ownership token.',
    '稳定应用组件或本地诊断身份，不是所有权令牌。'
  ),
  platform: p(
    'Actual transport platform label supplied by the selected adapter.',
    '所选适配器提供的实际载体平台标签。'
  ),
  origin: p(
    'Optional actual inbound origin supplied by a carrier that can establish it.',
    '能够确认来源的载体提供的可选实际入站来源域。'
  ),
  peerId: p(
    'Optional direct peer identifier issued by the actual transport adapter.',
    '实际载体适配器签发的可选直接对端标识。'
  ),
  uniqueTargetId: p(
    'Explicit application identity or identity factory result, not a guessed discovery address.',
    '显式应用身份或身份工厂返回值，不是猜测的发现地址。'
  ),
  registeredAt: p(
    'Original endpoint monotonic registration time, comparable only within the same endpoint clock.',
    '原端点单调登记时间，只能在同端点时钟域内比较。'
  ),
  lastSeenAt: p(
    'Most recent observation in the same endpoint monotonic clock domain as registeredAt.',
    '与登记时间同端点单调时钟域的最近观察时间。'
  ),
  pinned: p(
    'Whether application pinReceiver explicitly selected this exact receiver.',
    '应用是否显式固定了该精确接收端。'
  ),
  queryId: p(
    'Identifier generated for the original actual inbound discovery query and returned with its candidate.',
    '为原实际入站发现查询生成并随候选返回的标识。'
  ),
  fulfilled: p(
    'Actual successful fan-out results keyed by selected receiver or target identity.',
    '按选中接收端或目标身份记录的实际成功扇出结果。'
  ),
  rejected: p(
    'Original failed fan-out errors keyed by selected receiver or target identity.',
    '按选中接收端或目标身份记录的原失败扇出错误。'
  ),
  resource: p(
    'Lifecycle owner label identifying the cleanup resource that produced this original failure.',
    '标识发生原清理失败资源的生命周期所有者标签。'
  ),
  version: p(
    'Application contract version used for compatibility checks, independent of wire/package version.',
    '兼容检查使用的应用契约版本，与线上及包版本分开。',
    t(
      'Absent: discovery uses 1.0.0 while outbound routing uses 1.0; configure explicitly for a consistent version.',
      '默认发现使用 `1.0.0`，出站路由使用 `1.0`；需要统一应用版本时应显式配置。'
    )
  ),
  acceptVersions: p(
    'Application-compatible contract versions accepted in the declared order.',
    '按声明顺序接受的应用兼容契约版本列表。',
    t('Absent: accept the configured application version.', '默认接受已配置的应用版本。')
  ),
  maxIdentifierLength: p(
    'Optional positive safe-integer ceiling for `targetId`, `receiverId`, `uniqueTargetId` and variation IDs; it does not limit method names and remains within the fixed wire bound.',
    '可选正安全整数上限，作用于 `targetId`、`receiverId`、`uniqueTargetId` 及变体标识，不限制方法名，仍受固定线上边界约束。',
    t('`128` characters at endpoint admission.', '默认端点准入上限为 `128` 个字符。')
  ),
  schemas: p(
    'Application map from method to synchronous params/result parse adapters; missing methods are not schema-validated.',
    '应用方法到同步入参及结果解析适配器的映射，缺省方法不作结构校验。',
    t(
      'Absent: no application params/result schemas are installed.',
      '默认不安装应用入参及结果结构。'
    )
  ),
  enabled: {
    ...p(
      'Literal true records an installed capability, never a caller-made runtime permission.',
      '真值记录已安装能力，不是调用方创建的运行权限。'
    ),
    values: {
      true: t(
        'This middleware actually installed its capability.',
        '该中间件确实已经安装相应能力。'
      )
    }
  },
  metadata: p(
    'Immutable declaration of actual middleware claims and shared dependencies captured before installation.',
    '安装前捕获的实际中间件声明及共享依赖的不可变记录。'
  ),
  discoveryMode: {
    ...p(
      'Actual native middleware tuple chooses automatic discovery or explicit manual control.',
      '实际原生中间件元组选择自动发现或显式手动控制。',
      t('`automatic` uses the canonical automatic discovery path.', '默认使用规范自动发现路径。')
    ),
    values: {
      automatic: t(
        'Resolve and maintain candidates through automatic discovery.',
        '通过自动发现解析并维护候选。'
      ),
      manual: t(
        'Application owns query, registration and candidate ping decisions.',
        '应用拥有查询、登记及候选心跳决定。'
      )
    }
  },
  pingCapability: {
    ...p(
      'Literal true records that ping middleware is actually selected in this native tuple.',
      '真值记录当前原生元组实际选中了心跳中间件。'
    ),
    values: {
      true: t(
        'Expose ping and pingAll only for this selected capability.',
        '只为该已选能力公开心跳及全体心跳。'
      )
    }
  },
  transport: p(
    'Actual application adapter selected by top-level config or native connect middleware; native source evidence remains adapter-owned.',
    '顶层配置或原生连接中间件选择的实际应用适配器，原生来源证据仍归适配器。',
    t(
      'Absent: use the selected connect middleware transport; otherwise construction fails.',
      '默认使用所选连接中间件载体，否则构造失败。'
    )
  ),
  protocol: p(
    'Canonical semantic IRpcProtocol descriptor selected independently of codec encoding.',
    '与编解码编码独立选择的规范语义协议描述对象。',
    t('rpcProtocolV1 is the default canonical protocol.', '默认使用规范传统协议描述对象。')
  ),
  codec: p(
    'ICodec from @migaia/serialize/codec whose encoded output exactly matches the selected framer input.',
    '来自序列化包的编解码器，其编码输出精确匹配所选分片器输入。',
    t(
      'identityCodecV1 preserves the canonical semantic envelope.',
      '默认恒等编解码保持规范语义信封。'
    )
  ),
  framer: p(
    'IRpcFramer from rpc-contract/framing whose actual output is accepted by the selected transport.',
    '来自契约分帧入口的分片器，其实际输出须由所选载体接受。',
    t('messageFramerV1 uses complete unfragmented messages.', '默认消息分片器使用完整未分片消息。')
  )
}
/** Selects only source-owned members for each public type. */
const pick = (
  names: readonly string[],
  own: Record<string, IMemberDoc> = {}
): Record<string, IMemberDoc> => ({
  ...Object.fromEntries(names.map((name) => [name, fields[name]])),
  ...own
})
/** Every instance includes a complete real endpoint scenario. */
const typeDoc = (
  en: string,
  zh: string,
  members: Record<string, IMemberDoc>,
  example = endpointExample
): ITypeDoc => ({
  summary: t(en, zh),
  members,
  scenarios: [
    t(
      'Compose actual endpoint or runtime peers while keeping transport and lifecycle ownership with their canonical owners.',
      '组合实际端点或运行对端，并由规范所有者保持载体与生命周期所有权。'
    )
  ],
  example
})
/** Actual provider limits and refusal observation share the canonical admission registry. */
const providerLimits: Record<string, IMemberDoc> = {
  maxGlobal: p(
    'Positive safe-integer maximum waiting and running provider executions across this endpoint.',
    '端点全部等待及运行提供方执行的正安全整数上限。',
    t('`256` concurrent provider leases.', '默认最多 `256` 个提供方执行租约。')
  ),
  maxPerPeer: p(
    'Positive safe-integer maximum waiting and running executions for one verified direct peer.',
    '单个已验证直接对端等待及运行执行的正安全整数上限。',
    t('`64` provider leases per verified peer.', '默认每个已验证对端最多 `64` 个租约。')
  ),
  maxReplayEntriesPerPeer: p(
    'Maximum completed inbound replay tombstones retained for each actual verified peer.',
    '每个实际已验证对端保留的已完成入站重放墓碑上限。',
    t('`1024` completed entries per peer.', '默认每个对端 `1024` 个完成条目。')
  ),
  onRejected: p(
    'Application callback receives actual IRpcProviderRejection before any provider runs; may return void or Promise<void>. Throw/rejection is reported through hooks without replacing OVERLOADED.',
    '应用回调在提供方执行前接收实际准入拒绝，可返回空值或空值承诺；抛错或拒绝经钩子上报，不替换过载结果。',
    t('Absent: no additional local refusal observer.', '默认不设置，不添加本地拒绝观察者。')
  )
}
/** Complete endpoint configuration retains tuple ownership and directed pipeline compatibility. */
const factoryOptions: Record<string, IMemberDoc> = {
  ...pick(['id', 'scheduler', 'wallClock', 'transport', 'protocol', 'codec', 'framer']),
  targetIds: p(
    'Optional known-peer base identifiers issued by application deployment configuration; automatic discovery can resolve more later.',
    '应用部署配置签发的可选已知对端基础标识，自动发现之后可以解析更多标识。',
    t('Empty seed list; discovery remains available.', '默认空种子列表，仍可使用发现。')
  ),
  provider: p(
    'Application map of unique method names to IRpcProvider callbacks installed before endpoint construction returns.',
    '构造端点返回前安装的应用唯一方法名到提供方回调映射。',
    t('Absent: register providers later through provide.', '默认不设置，之后通过提供方法登记。')
  ),
  providerLimits: p(
    'Optional IRpcProviderLimits applied to the existing shared execution/replay admission owner.',
    '应用于既有共享执行及重放准入所有者的可选提供方限制。',
    t(
      'Global 256, per-peer 64, replay per-peer 1024.',
      '默认全局 `256`、每对端 `64`、每对端重放 `1024`。'
    )
  ),
  idempotency: p(
    'Optional actual original result store and authenticated scope function for keyed provider work.',
    '带键提供方工作使用的可选实际原始结果存储及已认证作用域函数。',
    t(
      'Absent: use the endpoint-owned canonical keyed replay policy.',
      '默认使用端点拥有的规范带键重放策略。'
    )
  ),
  'idempotency.store': p(
    'Optional caller-held IRpcIdempotencyStore shared only across actual intended sessions.',
    '调用方可选持有的幂等存储，只跨实际预期会话共享。',
    t('Absent: use the original endpoint-local store.', '默认使用原端点本地存储。')
  ),
  'idempotency.scope': p(
    'Synchronous application callback receives actual admitted token and senderId, returns a stable scope string; it must not treat arbitrary wire claims as identity.',
    '应用同步回调接收实际已准入令牌及发送标识，返回稳定作用域字符串，不能把任意线上声明视为身份。',
    t('Absent: canonical admitted-session scope is used.', '默认使用规范已准入会话作用域。')
  ),
  replay: p(
    'Outbound active identifiers plus settled tombstone retention, separate from business result storage.',
    '出站活动标识及已结算墓碑保留配置，与业务结果存储分开。',
    t('Use maxEntries 4096 and ttlMs 310000.', '默认条目 `4096`，保留 `310000` 毫秒。')
  ),
  'replay.maxEntries': p(
    'Maximum retained outbound request identities including active operations and settled tombstones.',
    '保留的出站请求身份总上限，含活动操作及已结算墓碑。',
    t('`4096` retained outbound identities.', '默认保留 `4096` 个出站身份。')
  ),
  'replay.ttlMs': p(
    'Scheduler milliseconds to retain settled outbound request identity tombstones.',
    '已结算出站请求身份墓碑保留的调度器毫秒数。',
    t('`310000` milliseconds after settlement.', '默认结算后保留 `310000` 毫秒。')
  ),
  middlewares: p(
    'Required ordered finite tuple of actual middleware definitions installed atomically by PluginHost.',
    '插件宿主原子安装的必需有序有限真实中间件定义元组。'
  ),
  features: p(
    'Optional finite immutable tuple of actual native IRpcFeature roots; dependencies remain private and only selected public surfaces are projected.',
    '可选有限不可变原生功能根元组，依赖保持私有，只投影已选公开表面。',
    t('Empty tuple adds no user-defined features.', '默认空元组，不增加自定义功能。')
  ),
  construction: p(
    'Caller construction cancellation/deadline; failure still rolls back every installed middleware in original lifecycle order.',
    '调用方构造取消及截止，失败仍按原生命周期顺序回滚全部已安装中间件。',
    t('Absent: no caller abort or construction deadline.', '默认不设置，没有调用方中止或构造截止。')
  ),
  'construction.signal': p(
    'Optional caller cancellation signal controlling construction and its complete rollback.',
    '控制构造及完整回滚的可选调用方取消信号。',
    t('Absent: construction has an uncancelled native signal.', '默认构造使用未取消原生信号。')
  ),
  'construction.timeoutMs': {
    ...p(
      'Finite nonnegative construction deadline or false to disable; rollback retains the primary failure and cleanup failures.',
      '有限非负构造截止，或假值关闭；回滚保留主失败及清理失败。',
      t('Absent or false: no construction deadline.', '默认省略或假值，不设构造截止。')
    ),
    values: { false: t('Disable only the construction deadline.', '只关闭构造阶段的截止限制。') }
  }
}
/** Discovery controls point to actually received candidate identities. */
const discoveryMembers: Record<string, IMemberDoc> = {
  getServerList: m(
    'Reads a snapshot of the canonical discovered receiver list, optionally filtered by target base identity.',
    '读取规范已发现接收端列表快照，可按目标基础身份过滤。',
    { targetId },
    t(
      'Read-only IRpcServerMetadata array in this endpoint monotonic clock domain.',
      '返回处于本端点单调时钟域的只读服务元数据数组。'
    ),
    'const servers = client.connect.getServerList("server")'
  ),
  pinReceiver: m(
    'Pins one actual discovered receiver so later per-target selection uses that instance.',
    '固定一个实际发现接收端，使后续目标选择使用该实例。',
    { targetId, receiverId },
    t(
      'Selection is pinned; unknown or unidentifiable receivers fail with their coded target error.',
      '选择已固定；未知或不可识别接收端以编码目标错误失败。'
    ),
    'const [candidate] = client.connect.getServerList("server"); if (candidate) client.connect.pinReceiver("server", candidate.receiverId)'
  ),
  unpinReceiver: m(
    'Clears the explicit receiver pin and restores the canonical selection policy.',
    '清除显式接收端固定，恢复规范选择策略。',
    { targetId },
    t(
      'Future selections use the configured selector or canonical policy.',
      '后续选择使用已配置选择器或规范策略。'
    ),
    'client.connect.unpinReceiver("server")'
  )
}
/** Manual discovery preserves both query observation and acceptance in one example. */
const manualExample =
  'const stop = server.connect.onQuery(async (query) => { await query.accept({ available: true }) }); const candidates = await client.connect.query("server"); for (const candidate of candidates) client.connect.register(candidate); stop()'
/** Manual operations exist only with a manual connect middleware selection. */
const manualMembers: Record<string, IMemberDoc> = {
  ...discoveryMembers,
  query: m(
    'Sends a manual discovery query and collects actual accepted candidates within its local wait budget.',
    '发送手动发现查询，在本地等待预算内收集实际接受候选。',
    {
      targetId,
      options: t(
        'Optional caller timeoutMs and AbortSignal; they control this manual query wait only.',
        '可选调用方毫秒截止及取消信号，只控制本次手动查询等待。'
      )
    },
    t(
      'Read-only actual IRpcDiscoveryCandidate array; cancellation preserves the native abort type and actual reason; closed endpoint rejects with its coded error.',
      '返回只读实际发现候选数组，取消保留原生中止类型及实际原因，端点关闭以编码错误拒绝。'
    ),
    manualExample
  ),
  onQuery: m(
    'Observes inbound manual queries; pair with query and use the provided accept/reject controls instead of inventing replies.',
    '观察入站手动查询。搭配 `query` 并使用提供的接受拒绝控制，不自行构造响应。',
    {
      listener: t(
        'Application callback receives IRpcInboundDiscoveryQuery, returns void or Promise<void>; async rejection is observed through hooks.',
        '应用回调接收入站发现查询，返回空值或空值承诺，异步拒绝经钩子观察。'
      )
    },
    t('Idempotent unsubscriber for this query listener.', '返回只移除本次查询监听的幂等函数。'),
    manualExample
  ),
  register: m(
    'Registers an actual discovery candidate returned by the original query; it does not accept an invented receiver claim.',
    '登记原查询返回的实际发现候选，不接受虚构接收端声明。',
    {
      candidate: t(
        'Actual IRpcDiscoveryCandidate returned by connect.query.',
        '来自连接查询返回的实际发现候选。'
      )
    },
    t(
      'The candidate becomes eligible for subsequent receiver selection.',
      '该候选进入后续接收端选择范围。'
    ),
    manualExample
  ),
  unregister: m(
    'Removes one actual receiver or the selected target registration and sends the corresponding control when supported.',
    '移除一个实际接收端或所选目标登记，支持时发送相应控制。',
    { targetId, receiverId },
    t(
      'Resolves after unregister processing; it does not close the external physical carrier.',
      '取消登记处理后兑现，不关闭外部物理载体。'
    ),
    'await client.connect.unregister("server", candidate.receiverId)'
  ),
  ping: m(
    'Checks the liveness of an original manual discovery candidate without fabricating a binding.',
    '检查原手动发现候选存活，不虚构绑定。',
    {
      candidate: t(
        'Actual candidate returned by the original connect.query operation.',
        '原始连接查询操作返回的实际候选。'
      ),
      options: t(
        'Optional local timeoutMs and AbortSignal for this candidate probe.',
        '本次候选检查的可选本地毫秒截止和取消信号。'
      )
    },
    t(
      'Boolean observed liveness; unsupported ping capability fails with MIDDLEWARE_MISSING.',
      '返回实际观察存活布尔值，不支持心跳能力以缺中间件错误失败。'
    ),
    'const alive = await client.connect.ping(candidate)'
  )
}
/** Public endpoint and provider context types close the execution loop. */
Object.assign(types, {
  IRpcEndpoint: typeDoc(
    'Application-owned complete endpoint surface; middleware selection narrows discovery and ping capabilities.',
    '应用拥有的完整端点表面，中间件选择会收窄发现和心跳能力。',
    endpointMembers
  ),
  IRpcEndpointFactory: typeDoc(
    'Generic async construction function derives endpoint discovery/ping types from the actual middleware tuple.',
    '泛型异步构造函数，从实际中间件元组推导端点发现及心跳类型。',
    {}
  ),
  IRpcFactoryConfig: typeDoc(
    'Application construction configuration with one canonical protocol/codec/framer/transport direction and atomic middleware installation.',
    '应用构造配置，具有规范协议、编解码、分帧、载体方向和原子中间件安装。',
    factoryOptions
  ),
  IRpcCoreConfig: typeDoc(
    'Composition kernel input uses the same endpoint options while excluding an arbitrary custom feature list.',
    '组合核心输入使用相同端点选项，但排除任意自定义功能列表。',
    {
      ...factoryOptions,
      features: p(
        'This internal normalized public shape permits only undefined; compose user features through the checked factory config instead.',
        '该规范化形态只允许未定义，应通过已检查工厂配置组合用户功能。'
      )
    }
  ),
  IRpcPingEndpointSurface: typeDoc(
    'Conditional ping and pingAll methods of endpoints with an actual selected ping middleware.',
    '实际选中相应中间件的端点条件心跳及全体心跳方法。',
    { ping: endpointMembers.ping, pingAll: endpointMembers.pingAll }
  ),
  IRpcFanoutResult: typeDoc(
    'Per-receiver successful data and original failures from one actual endpoint fan-out.',
    '一次实际端点扇出中每接收端的成功数据和原失败。',
    pick(['fulfilled', 'rejected'])
  ),
  ISendOptions: typeDoc(
    'Caller-owned scalar operation cancellation, deadline, transfer and diagnostic metadata.',
    '调用方拥有的标量操作取消、截止、转移及诊断元数据。',
    sendOptions
  ),
  IRpcPingOptions: typeDoc(
    'Caller-owned liveness wait deadline and cancellation, separate from provider execution.',
    '调用方拥有的存活等待截止和取消，与提供方执行分开。',
    {
      signal: p(
        'Optional caller-owned AbortSignal cancels this ping directly, without requiring abort middleware.',
        '可选调用方中止信号直接取消本次心跳，不要求安装中止中间件。',
        signal.default
      ),
      timeoutMs
    }
  ),
  IRpcRuntimeGroupOptions: typeDoc(
    'Native group wire controls plus local timeout, signal and explicit original transfer ownership.',
    '原生分组线上控制，附本地截止、信号和显式原转移所有权。',
    { ...contractReference.types.IRpcRuntimeOptions.members, signal, timeoutMs, transfer }
  ),
  IRpcRuntimeGroupSteps: typeDoc(
    'Nonempty request-only wire group steps are owned and validated by rpc-contract; group execution remains with Core.',
    '非空纯请求线上分组步骤由契约包拥有及校验，分组执行仍归核心。',
    {}
  ),
  IRpcRuntimeOutcomeResult: contractReference.types.IRpcRuntimeOutcomeResult,
  IRpcProvider: typeDoc(
    'Application callback receives IRpcContext and returns explicit success/failure directly or through a Promise. Legacy ordinary throws usually become INTERNAL, while trusted wire summaries and SCHEMA_INVALID retain public classification; runtime operations serialize original failures.',
    '应用回调接收运行上下文，直接或经承诺返回显式成功失败；传统普通抛错通常成为内部失败，可信线上摘要及结构非法保留公开分类，运行接口序列化原失败。',
    {}
  ),
  IRpcEventListener: typeDoc(
    'Application one-way event callback receives IRpcContext and returns void or Promise<void>; rejection is observed through hooks.',
    '应用单向事件回调接收运行上下文，返回空值或空值承诺，拒绝经钩子观察。',
    {}
  ),
  IRpcProviderLimits: typeDoc(
    'Shared original provider concurrency/replay limits with a local refusal observation callback.',
    '原始共享提供方并发及重放限制，附本地拒绝观察回调。',
    providerLimits
  ),
  IRpcProviderResult: typeDoc(
    'Explicit provider completion distinguishes success data/transfer from application failure code/message.',
    '显式提供方完成区分成功数据转移和应用失败错误码消息。',
    {
      ...pick(['data', 'transfer', 'code', 'message']),
      ok: {
        ...p(
          'True indicates explicit context.success, false indicates explicit context.failed.',
          '真表示显式成功结果，假表示显式失败结果。'
        ),
        values: {
          true: t(
            'Return successful provider data and optional original transfer list.',
            '返回成功提供方数据及可选原转移列表。'
          ),
          false: t(
            'Return application semantic failure code and message.',
            '返回应用语义失败错误码及消息。'
          )
        }
      }
    }
  ),
  IRpcContext: typeDoc(
    'Provider-lifetime context created only after actual inbound identity and execution admission.',
    '只在实际入站身份及执行准入之后创建的提供方生命周期上下文。',
    {
      ...pick([
        'localEndpointId',
        'callerGeneration',
        'targetGeneration',
        'data',
        'signal',
        'senderId',
        'route',
        'trace'
      ]),
      signal: p(
        'Provider-owned AbortSignal from the admitted execution scope; deadline, caller cancellation and endpoint disposal can retire this lifetime independently of outbound abort middleware.',
        '已准入执行作用域提供的所属中止信号；截止、调用方取消及端点释放可结束此生命周期，不依赖出站中止中间件。'
      ),
      timeoutMs: p(
        'Remaining actual provider deadline derived from the original endpoint monotonic clock; absent without a deadline.',
        '由原端点单调时钟得出的实际提供方剩余截止，无截止时省略。'
      ),
      success: m(
        'Constructs explicit successful completion while this provider lifetime is active.',
        '提供方生命周期仍活动时构造显式成功完成结果。',
        {
          data: t(
            'Optional application success data, omitted only when actually undefined.',
            '可选应用成功数据，只有实际未定义才省略。'
          ),
          options: t(
            'Optional explicit original transfer list for physical result ownership.',
            '物理结果所有权使用的可选显式原转移列表。'
          )
        },
        t(
          'IRpcProviderResult to return from the provider; after expiry returns a failure result carrying PROVIDER_CONTEXT_EXPIRED.',
          '返回应从提供方返回的结果，过期后返回携带提供方上下文过期码的失败值。'
        ),
        'server.provide("echo", (context) => context.success(context.data))'
      ),
      failed: m(
        'Constructs explicit application failure without replacing it with an internal exception.',
        '构造显式应用失败，不把它替换为内部异常。',
        {
          message: t(
            'Application-readable semantic failure description.',
            '应用可读的语义失败说明。'
          ),
          code: t(
            'Application-owned stable semantic failure code.',
            '应用拥有的稳定语义失败错误码。'
          )
        },
        t(
          'IRpcProviderResult to return; after lifetime expiry returns a failure result carrying PROVIDER_CONTEXT_EXPIRED.',
          '返回应交出的提供方结果，生命周期过期返回携带上下文过期码的失败值。'
        ),
        'server.provide("load", (context) => context.failed("missing", "NOT_FOUND"))'
      ),
      dispatchTo: m(
        'Issues a provider-scoped one-way dispatch using the original provider execution owner.',
        '通过原提供方执行所有者发起提供方作用域单向派发。',
        {
          input: t(
            'Application method/data and optional explicitly chosen target id; original execution controls validate its route.',
            '应用方法、数据及可选显式目标标识，原执行控制校验路由。'
          )
        },
        t(
          'Returns void after dispatch initiation; provider lifecycle and endpoint hooks contain later failures.',
          '发起派发后返回空值，后续失败由提供方生命周期及端点钩子容纳。'
        ),
        'context.dispatchTo({ id: "observer", method: "changed", data: 1 })'
      )
    }
  ),
  IRpcAutomaticConnectControl: typeDoc(
    'Automatic mode exposes actual candidate list and explicit pin selection without manual query registration.',
    '自动模式公开实际候选列表及显式固定选择，不提供手动查询登记。',
    discoveryMembers
  ),
  IRpcManualConnectControl: typeDoc(
    'Explicit manual discovery adds original query observation, candidate registration and candidate liveness checks.',
    '显式手动发现增加原查询观察、候选登记及候选存活检查。',
    manualMembers,
    manualExample
  ),
  IRpcConnectControl: typeDoc(
    'Canonical discovery control surface; manual methods exist only when actual manual mode is selected.',
    '规范发现控制表面，手动方法只在实际选择手动模式时存在。',
    manualMembers,
    manualExample
  ),
  IRpcConnectControlForMode: typeDoc(
    'Conditional control type selects the actual automatic or manual surface from middleware mode.',
    '条件控制类型根据中间件模式选择实际自动或手动表面。',
    {}
  ),
  IRpcDiscoveryControl: typeDoc(
    'Candidate list and explicit pin controls share the original endpoint discovery registry.',
    '候选列表及显式固定控制共享原端点发现注册表。',
    discoveryMembers
  ),
  IRpcDiscoveryMode: typeDoc(
    'Automatic/manual discovery mode selected by actual native middleware configuration, not runtime mutation.',
    '由实际原生中间件配置选择的自动或手动发现模式，不能运行时修改。',
    {}
  ),
  IRpcServerMetadata: typeDoc(
    'Actual discovered receiver metadata; monotonic timestamps are comparable only inside the same endpoint.',
    '实际已发现接收端元数据，单调时间戳只在同端点内可比较。',
    {
      ...pick([
        'targetId',
        'receiverId',
        'uniqueTargetId',
        'platform',
        'origin',
        'registeredAt',
        'lastSeenAt',
        'pinned'
      ]),
      status: p(
        'Actual candidate state active, stale or explicitly unregistered from its discovery owner.',
        '发现所有者给出的实际候选状态：活动、过期或显式取消登记。'
      )
    }
  ),
  IRpcDiscoveryCandidate: typeDoc(
    'Original candidate from a real manual query, retaining its query identity and admitted peer data.',
    '来自真实手动查询的原候选，保留查询身份和已准入对端数据。',
    pick(['queryId', 'targetId', 'receiverId', 'data', 'platform', 'origin']),
    manualExample
  ),
  IRpcInboundDiscoveryQuery: typeDoc(
    'Actual inbound query with original single-owner acceptance/rejection controls.',
    '实际入站查询及原单一所有者接受拒绝控制。',
    {
      ...pick(['targetId', 'data', 'platform', 'origin']),
      accept: m(
        'Accepts this actual query with optional application discovery data.',
        '使用可选应用发现数据接受本次实际查询。',
        {
          data: t(
            'Optional application data returned to the original requester.',
            '返回原请求方的可选应用数据。'
          )
        },
        t(
          'Promise<boolean> indicates whether this original query response was accepted for sending.',
          '布尔承诺表示原查询响应是否被接受发送。'
        ),
        manualExample
      ),
      reject: m(
        'Rejects this actual query with an optional application-readable diagnostic reason.',
        '以可选应用可读诊断原因拒绝本次实际查询。',
        {
          reason: t(
            'Optional application diagnostic reason, not an authorization token.',
            '可选应用诊断原因，不是权限令牌。'
          )
        },
        t(
          'Promise<boolean> reports whether the original rejection response was accepted for sending.',
          '布尔承诺表示原拒绝响应是否被接受发送。'
        ),
        'const stop = server.connect.onQuery((query) => query.reject("unavailable")); const candidates = await client.connect.query("server"); stop()'
      )
    },
    manualExample
  ),
  IRpcProviderRejection: typeDoc(
    'Actual local refused execution observation; one OVERLOADED code has distinct owned reasons.',
    '实际本地拒绝执行观察，同一过载错误码对应不同所属原因。',
    {
      verifiedPeerKey: p(
        'Opaque verified peer key issued by the actual admitted provider binding; never log its secret-bearing material.',
        '实际已准入提供方绑定签发的不透明已验证对端键，不记录可能含秘密的材料。'
      ),
      controllerKey: p(
        'Original controller key assigned by the actual provider execution owner.',
        '实际提供方执行所有者分配的原始控制器键。'
      ),
      method: fields.method,
      reason: p(
        'Actual RpcProviderRejectionReason distinguishing capacity, replay and expired binding refusal.',
        '区分容量、重放及绑定过期拒绝的实际提供方拒绝原因。'
      )
    }
  ),
  IProviderAdmissionScope: typeDoc(
    'Caller-owned lazy shared provider-quota handle retaining the original canonical admission registry.',
    '调用方拥有的惰性共享提供方配额句柄，保留原规范准入注册表。',
    {
      constrain: m(
        'Narrows only an already prepared original registry. Before Core prepares that registry, this call validates values but neither stores nor applies a constraint.',
        '只收窄已经准备的原注册表；核心准备该注册表之前，此调用只校验数值，不保存或应用约束。',
        {
          maxGlobal: t(
            'Optional positive safe integer, default 256 when omitted.',
            '可选正安全整数，省略时默认 `256`。'
          ),
          maxPerPeer: t(
            'Optional positive safe integer, default 64 when omitted.',
            '可选正安全整数，省略时默认 `64`。'
          )
        },
        t(
          'Returns void; invalid limits throw INVALID_CONFIG. A pre-construction call has no persistent effect on future concurrency.',
          '返回空值，限制非法抛配置非法错误，构造前调用对后续并发没有持久影响。'
        ),
        'const scope = createProviderAdmissionScope(); scope.constrain(128, 32)'
      ),
      clear: m(
        'Clears only the registry actually owned by this handle, preserving original disposal behavior.',
        '只清理该句柄实际拥有的注册表，保留原释放行为。',
        {},
        t(
          'Owned admission state is cleared; no external registry is touched.',
          '所属准入状态已清理，不影响外部注册表。'
        ),
        'scope.clear()'
      )
    },
    'const scope = createProviderAdmissionScope(); scope.constrain(128, 32); scope.clear()'
  )
})
/** Registers one literal domain and every key's independent observable meaning. */
function domain(name: string, en: string, zh: string, values: Record<string, IText>): void {
  enums[name] = { summary: t(en, zh), values }
  symbols[name] = {
    role: name.endsWith('ErrorCode') ? 'error' : 'constant',
    purpose: t(
      en +
        ' The stable values below select actual contract behavior; declarations alone grant no capability.',
      zh + '以下稳定取值选择实际契约行为；单独声明这些值不会赋予能力。'
    ),
    example: 'console.log(' + name + ')'
  }
}
/** Pure operations carry explicit parameters even when one overload uses another input form. */
function operation(
  name: string,
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): void {
  symbols[name] = { role: 'operation', purpose: t(en, zh), params, returns, example }
}
/** Core and transport errors preserve native identity and distinct causes. */
const coreErrors: Record<string, IText> = {
  providerGenerationMismatch: t(
    'PROVIDER_GENERATION_MISMATCH: accepted caller/provider generation no longer matches the task; select the actual binding again.',
    '提供方世代不匹配：已接受调用方或提供方世代与任务不符，应重新选择实际绑定。'
  ),
  providerGenerationRetired: t(
    'PROVIDER_GENERATION_RETIRED: an admitted forwarded execution retired with its exact generation; never replay it.',
    '提供方世代已退役：已准入转发执行随精确世代退役，不能重放。'
  ),
  forwardLoop: t(
    'FORWARD_LOOP: signed route revisits this or the selected next Host; choose another route.',
    '转发环路错误：签名路由再次访问当前或下一宿主，应选择其他路由。'
  ),
  forwardHopLimit: t(
    'FORWARD_HOP_LIMIT: three forwarding nodes were already visited; use a direct channel or shorter route.',
    '转发跳数超限：已经访问三个转发节点，应使用直接通道或更短路由。'
  ),
  middlewareDuplicated: t(
    'MIDDLEWARE_DUPLICATED: names repeat in the construction tuple; assign one unique name per middleware.',
    '中间件重复错误：构造元组中名称重复，每个中间件必须使用唯一名称。'
  ),
  middlewareMissing: t(
    'MIDDLEWARE_MISSING: the operation requires an actually installed connect, abort, ping or other middleware capability.',
    '缺少中间件错误：操作要求实际安装连接、中止、心跳等中间件能力。'
  ),
  capabilityUnsupported: t(
    'CAPABILITY_UNSUPPORTED: actual peer agreement does not support the requested runtime mode or capability.',
    '能力不支持错误：实际对端协议不支持请求的运行模式或能力。'
  ),
  invalidConfig: t(
    'INVALID_CONFIG: factory, component, transport or transform configuration is invalid; inspect detail and correct local inputs.',
    '配置非法错误：工厂、组件、载体或转换配置无效，应检查细节并修正本地输入。'
  ),
  probeFailed: t(
    'PROBE_FAILED: a diagnostic emit/describe/redact callback failed; business execution remains isolated.',
    '诊断失败错误：观察、描述或脱敏回调失败，业务执行保持隔离。'
  ),
  providerDuplicated: t(
    'PROVIDER_DUPLICATED: provide registered a method that already has an owner; change the method or combine providers.',
    '提供方重复错误：登记方法已经有所有者，应改名或合并提供方。'
  ),
  protocolInvalid: t(
    'PROTOCOL_INVALID: codec/protocol/envelope behavior or correlated control is invalid; inspect original cause.',
    '协议非法错误：编解码、信封行为或关联控制非法，应检查原始原因。'
  ),
  contractInvalid: t(
    'CONTRACT_INVALID: method correlation, direction or contract identity fields violate the actual request contract.',
    '契约非法错误：方法关联、方向或契约身份字段违反实际请求契约。'
  ),
  payloadInvalid: t(
    'PAYLOAD_INVALID: data, physical batch encoding or error projection violates its selected codec boundary.',
    '载荷非法错误：数据、物理攒批编码或错误投影违反所选编解码边界。'
  ),
  providerNotFound: t(
    'PROVIDER_NOT_FOUND: the receiving endpoint has no registered provider for the requested method.',
    '提供方不存在错误：接收端没有为所请求方法登记提供方。'
  ),
  providerNotSettled: t(
    'PROVIDER_NOT_SETTLED: a request provider returned without an explicit success or failed result.',
    '提供方未结算错误：请求提供方返回时没有给出显式成功或失败结果。'
  ),
  callbackFailed: t(
    'CALLBACK_FAILED: a construction or diagnostic callback failed; native mutable errors retain type, stack and identity, foreign semantic identities stay unchanged, and other values remain on cause.',
    '回调失败错误：构造或诊断回调失败；可修改原生错误保留类型、堆栈及身份，外部语义身份保持不变，其它值保留在原因链。'
  ),
  internal: t(
    'INTERNAL: provider threw unexpectedly; original error stays in local diagnostics while the peer receives a redacted failure.',
    '内部错误：提供方发生意外抛错，原错误保留在本地诊断，对端收到脱敏失败。'
  ),
  targetUnknown: t(
    'TARGET_UNKNOWN: target or receiver is unresolved, inactive or outside the original selected binding.',
    '目标未知错误：目标或接收端未解析、不活动或不在原选定绑定内。'
  ),
  targetNotIdentifiable: t(
    'TARGET_NOT_IDENTIFIABLE: anonymous broadcast group cannot satisfy a per-instance operation.',
    '目标不可识别错误：匿名广播组不能满足针对单实例的操作。'
  ),
  endpointDisposed: t(
    'ENDPOINT_DISPOSED: an operation used a disposed endpoint; construct a new owner instead.',
    '端点已释放错误：操作使用已释放端点，应构造新的所有者。'
  ),
  cancelled: t(
    'CANCELLED: actual caller AbortSignal cancelled the local send; remote effects may already have occurred.',
    '取消错误：实际调用方信号取消本地发送，远端效果可能已经发生。'
  ),
  deadlineExceeded: t(
    'DEADLINE_EXCEEDED: the local operation deadline expired; treat this transmission attempt as failed.',
    '截止超时错误：本地操作截止已经到期，本次传输尝试视为失败。'
  ),
  contextExpired: t(
    'PROVIDER_CONTEXT_EXPIRED: success or failed was called after the original provider lifetime ended; no wire effect is produced.',
    '提供方上下文过期错误：生命周期结束后调用结果方法，不产生线上效果。'
  ),
  transport: t(
    'TRANSPORT: actual physical send or terminal channel failed; preserve original transport evidence before choosing recovery. The code alone never proves nonexecution; retry requires independent evidence or idempotency/outcome reconciliation.',
    '载体错误：实际物理发送或通道终止失败，恢复前保留原载体证据；单凭此码不能证明未执行，重试须有独立证据或幂等结果核对。'
  ),
  authenticationFailed: t(
    'AUTHENTICATION_FAILED: signing, verification, encryption, decryption or original replay binding failed; details stay local.',
    '认证失败错误：签名、校验、加密、解密或原重放绑定失败，细节保持本地。'
  ),
  schemaInvalid: t(
    'SCHEMA_INVALID: params/result parse rejected the method data; inspect normalized issues and original cause.',
    '结构非法错误：入参或结果解析拒绝方法数据，应检查规范问题及原原因。'
  ),
  capabilityConflict: t(
    'CAPABILITY_CONFLICT: selected middleware/features publish conflicting keys or an ambiguous runtime instance.',
    '能力冲突错误：所选中间件或功能发布冲突键，或运行实例有歧义。'
  ),
  overloaded: t(
    'OVERLOADED: execution/replay/discovery/chunk capacity refused new work; inspect its independent reason channel.',
    '过载错误：执行、重放、发现或分片容量拒绝新工作，应检查独立原因通道。'
  ),
  streamResultUnknown: t(
    'STREAM_RESULT_UNKNOWN: transport may have sent a stream frame before rejecting; open a new stream without replaying items.',
    '流结果未知错误：载体可能已发送帧后拒绝，应新建流，不重放条目。'
  ),
  chunkInvalid: t(
    'CHUNK_INVALID: physical fragment grammar is invalid; hooks observe it and the frame is not replayed.',
    '分片非法错误：物理分片语法非法，钩子观察该错误且不重放帧。'
  ),
  propertyReadFailed: t(
    'PROPERTY_READ_FAILED: a getter/proxy failed without a valid synchronous reporter, or that reporter threw.',
    '属性读取失败错误：读取器或代理失败且无有效同步上报，或上报自身抛错。'
  ),
  idempotencyResultUnavailable: t(
    'IDEMPOTENCY_RESULT_UNAVAILABLE: business already ran but result was not retained; resolve outcome before another attempt.',
    '幂等结果不可用错误：业务已执行但结果未保留，再次尝试前须确定结果。'
  ),
  stringConversionFailed: t(
    'STRING_CONVERSION_FAILED: conversion or its required synchronous reporter failed; preserve original cause.',
    '字符串转换失败错误：转换或所需同步上报失败，应保留原始原因。'
  )
}
domain(
  'RpcCoreErrorCode',
  'Stable semantic failure codes owned by the runtime-neutral Core execution layer.',
  '运行时中立核心执行层拥有的稳定语义失败码。',
  coreErrors
)
symbols.RPC_CORE_ERROR_SOURCE = {
  role: 'error',
  purpose: t(
    'Identifies errors attributed to RPC Core for diagnostics. After catching an error, compare its source with RPC_CORE_ERROR_SOURCE before using code to distinguish failure kinds. These public fields describe a failure. Copying them onto another Error does not make Core treat it as an error created by its own local operation.',
    '在诊断中标识归属 RPC Core 的错误。捕获错误后，先检查 source 是否等于 RPC_CORE_ERROR_SOURCE，再用 code 区分失败种类。这两个公开字段用于描述失败。把它们复制到另一个 Error 上，不会让 Core 把该错误认作自身本地操作创建的错误。'
  ),
  example: 'if (isRpcError(error)) console.log(error.source, error.code)'
}
domain(
  'RpcProviderRejectionReason',
  'Actual local provider refusal branches sharing the public overload/capacity failure channel.',
  '共享公开过载容量失败通道的实际本地提供方拒绝分支。',
  {
    orderedQueueFull: t(
      'Waiting plus running ordered work exhausted the original provider quota.',
      '等待和运行中的有序工作耗尽原提供方配额。'
    ),
    groupConcurrency: t(
      'The complete group could not reserve every step execution lease.',
      '完整分组不能为全部步骤预留执行租约。'
    ),
    groupReplayFull: t(
      'The complete group could not reserve every original replay entry.',
      '完整分组不能预留全部原始重放条目。'
    ),
    concurrency: t(
      'Global or actual verified-peer execution concurrency is full.',
      '全局或实际已验证对端的执行并发已满。'
    ),
    replayLedgerFull: t(
      'Inbound request tombstones cannot retain another original identity.',
      '入站请求墓碑无法保留另一个原始身份。'
    ),
    outboundReplayFull: t(
      'Active outbound identities and tombstones exhausted their ceiling.',
      '活动出站身份及墓碑耗尽其保留上限。'
    ),
    bindingExpired: t(
      'The actual verified binding expired before provider execution started.',
      '实际已验证绑定在提供方开始执行前过期。'
    )
  }
)
domain(
  'RpcPlatform',
  'Actual adapter platform labels used in endpoint diagnostics.',
  '端点诊断使用的实际适配器平台标签。',
  Object.fromEntries(
    [
      ['broadcastChannel', 'BroadcastChannel'],
      ['iframe', 'Iframe'],
      ['memory', 'Memory'],
      ['messagePort', 'MessagePort'],
      ['process', 'Process'],
      ['rtcDataChannel', 'RTCDataChannel'],
      ['webTransport', 'WebTransport'],
      ['worker', 'Worker']
    ].map(([key, value]) => [
      key,
      t(
        'The actual adapter reports platform ' +
          value +
          '; this diagnostic label grants no native capability.',
        '实际适配器报告 `' + value + '` 平台，此诊断标签不赋予原生能力。'
      )
    ])
  )
)
domain(
  'RpcTransportOwnership',
  'Determines which actual transport resources endpoint disposal may close.',
  '决定端点释放可以关闭哪些实际载体资源。',
  {
    owned: t(
      'Endpoint disposal closes actual resources owned by this adapter.',
      '端点释放会关闭该适配器实际拥有的资源。'
    ),
    borrowed: t(
      'Endpoint detaches its listeners but caller retains physical resource ownership.',
      '端点只移除自身监听，物理资源仍由调用方拥有。'
    )
  }
)
domain(
  'RpcTransportEncoding',
  'Actual transport carrier domain matched to the selected codec and framer.',
  '与所选编解码及分帧匹配的实际载体值域。',
  {
    any: t('Transport accepts arbitrary complete message values.', '载体接受任意完整消息值。'),
    string: t('Transport accepts only complete string carriers.', '载体只接受完整字符串载体。'),
    uint8Array: t(
      'Transport accepts genuine Uint8Array byte carriers.',
      '载体接受真实字节数组载体。'
    )
  }
)
domain(
  'RpcTransportTopology',
  'Actual peer fan-out topology declared by the original adapter.',
  '原适配器声明的实际对端扇出拓扑。',
  {
    exclusive: t(
      'One original connection addresses exactly one peer.',
      '一个原始连接精确寻址一个对端。'
    ),
    multiplexed: t(
      'One transport carries several peer sources with actual source proof.',
      '一个载体携带多个对端来源并提供实际来源证明。'
    ),
    broadcast: t(
      'One send reaches a group; per-instance selection requires actual distinct identities.',
      '一次发送到达一组，实例选择要求实际不同身份。'
    )
  }
)
domain(
  'RpcEndpointStatus',
  'Endpoint admission status carried by actual transport diagnostics.',
  '实际载体诊断携带的端点准入状态。',
  {
    active: t(
      'The original endpoint remains active for admitted work.',
      '原始端点仍活动并可以准入工作。'
    )
  }
)
domain(
  'RpcOperation',
  'Single-target operation category supplied to the actual receiver selector.',
  '提供给实际接收端选择器的单目标操作类别。',
  {
    send: t(
      'Select a receiver for one correlated scalar request.',
      '为一个关联标量请求选择接收端。'
    ),
    dispatch: t(
      'Select a receiver for one legacy one-way event.',
      '为一个传统单向事件选择接收端。'
    ),
    ping: t('Select an actual receiver for a liveness check.', '为存活检查选择一个实际接收端。')
  }
)
domain(
  'RpcCandidateStatus',
  'Original discovery owner state of one actual receiver candidate.',
  '原发现所有者给出的实际接收候选状态。',
  {
    active: t(
      'Candidate is currently eligible for original selection.',
      '候选当前可以参与原接收端选择。'
    ),
    stale: t(
      'Candidate observation is stale; original selection applies its liveness policy.',
      '候选观察已过期，原选择应用其存活策略。'
    ),
    unregistered: t(
      'Candidate was explicitly removed from the original registry.',
      '候选已从原始注册表中显式移除。'
    )
  }
)
symbols.RuntimeEventName = runtimeEventSymbol
/** Endpoint constructors differ only in their explicit selected public feature roots. */
for (const [name, en, zh] of [
  [
    'createEndpoint',
    'Creates the full canonical endpoint with provider, outbound, discovery and control roots; actual middleware tuple narrows optional ping/manual controls.',
    '创建完整规范端点，包含提供、出站、发现及控制功能根；实际中间件元组收窄可选心跳和手动控制。'
  ],
  [
    'createFullEndpoint',
    'Creates the full canonical endpoint preset through the same kernel and lifecycle as createEndpoint; feature dependencies remain privately installed.',
    '通过与完整端点相同核心及生命周期创建完整预设，功能依赖保持私有安装。'
  ],
  [
    'createFullOneWayEndpoint',
    'Creates the full preset with explicit sendOneWay physical-admission support; business results are not awaited by one-way sends.',
    '创建额外具有显式单向物理准入支持的完整预设，单向发送不等待业务返回结果。'
  ],
  [
    'createClientEndpoint',
    'Creates only outbound and its private canonical dependencies plus explicitly selected user features, preserving the original endpoint lifecycle.',
    '只创建出站及其私有规范依赖，加显式用户功能，保留原端点生命周期。'
  ],
  [
    'createProviderEndpoint',
    'Creates provider registration with its inseparable original outbound closure; callbacks use actual inbound execution contexts.',
    '创建提供方登记及不可分割的原出站闭包，回调使用实际入站执行上下文。'
  ]
] as const) {
  symbols[name] = {
    role: 'factory',
    purpose: t(en, zh),
    params: {
      config: t(
        'Application IRpcFactoryConfig whose actual protocol/codec/framer/transport types satisfy both directed pipeline edges; middlewares is the actual finite installation tuple.',
        '应用工厂配置，实际协议、编解码、分帧及载体类型满足双向管线边界；中间件为实际有限安装元组。'
      )
    },
    options: 'IRpcFactoryConfig',
    returns: t(
      'Promise of the selected endpoint surface; invalid inputs fail before publication, failed construction rolls back and preserves original/cleanup causes. An unclassified middleware install failure gains CALLBACK_FAILED without replacing mutable native type/stack; foreign semantic identities stay intact and immutable values remain on cause.',
      '返回所选端点表面承诺，非法输入在发布前失败，构造失败会回滚并保留原始及清理原因；未分类中间件安装失败附加回调失败码，可修改原生类型及堆栈保持，外部语义身份不变，不可修改值保留在原因链。'
    ),
    example: endpointExample.replaceAll('createEndpoint', name)
  }
  types[name] = { ...types.IRpcEndpoint, surface: 'IRpcEndpoint' }
}
symbols.createComposedEndpoint = {
  role: 'factory',
  purpose: t(
    'Constructs one canonical lifecycle kernel and projects only explicitly selected native feature roots; dependencies install privately and duplicate public keys fail before activation.',
    '构造一个规范生命周期核心，只投影显式选中原生功能根；依赖私有安装，重复公开键在激活前失败。'
  ),
  params: {
    config: t(
      'Actual checked IRpcFactoryConfig with concrete pipeline and middleware tuple.',
      '具有具体管线及中间件元组的实际已检查工厂配置。'
    ),
    modulesOrRoots: t(
      'Caller finite record of actual native IRpcFeature roots created by the first-party factories; keys define explicit public projections.',
      '调用方提供的实际原生功能根有限记录，由内置工厂创建，记录键定义显式公开投影。'
    ),
    roots: t(
      'Actual finite native root record; overload name for modulesOrRoots.',
      '实际有限原生根记录，为相同参数的重载名称。'
    )
  },
  options: 'IRpcFactoryConfig',
  returns: t(
    'Promise of the inferred lifecycle kernel plus exact selected root/user feature surfaces; no unselected dependency method is exposed.',
    '返回核心及精确已选根和用户功能表面承诺，不公开未选依赖方法。'
  ),
  example:
    'const canonicalChunk = createCanonicalChunkFeature(); const outbound = createOutboundFeature(canonicalChunk); const endpoint = await createComposedEndpoint(config, { outbound }); await endpoint.dispose()'
}
/**
 * Low-level runtime construction retains held operations instead of acquiring native launch
 * resources.
 */
symbols.createRuntimeApiEndpoint = {
  role: 'factory',
  purpose: t(
    'Creates the runtime API boundary over an actual held binding, or config/channel plus original provider admission scope. It never creates a worker or process and repeated and synchronously reentrant disposal joins one cached facade Promise; it does not promise identity with the underlying binding Promise.',
    '在实际已有绑定上创建运行接口边界，或使用配置、通道和原提供方准入作用域；不创建线程进程，重复释放加入原持有关闭流程。'
  ),
  params: {
    config: t(
      'Either { binding } with actual held runtime call operations, or actual IRpcFactoryConfig for the original channel construction overload.',
      '包含实际持有运行调用操作的绑定对象，或原通道构造重载使用的实际端点工厂配置。'
    ),
    channel: t(
      'Actual internal runtime channel supplied by the original adapter; not a caller-asserted wire identity.',
      '原适配器提供的实际内部运行通道，不是调用方声明的线上身份。'
    ),
    admission: t(
      'Optional actual shared handle returned by createProviderAdmissionScope.',
      '来自提供方准入作用域工厂返回的可选实际共享句柄。'
    )
  },
  optionDocs: {
    ...factoryOptions,
    binding: p(
      'Actual held runtime operations with original ready/request/notify/stream/dispose ownership; forwarding them grants only already-held rights.',
      '原有就绪、请求、通知、流及释放操作的实际所有权，转交只保留已有权限。'
    )
  },
  returns: t(
    'Held-operation binding or actual runtime API endpoint, matching the selected overload; original construction and close failures stay reachable.',
    '返回与所选重载匹配的持有操作绑定或实际运行接口端点，原构造及关闭失败保持可达。'
  ),
  example:
    'const endpoint = createRuntimeApiEndpoint({ binding }); await endpoint.ready; await endpoint.dispose()'
}
symbols.createProviderAdmissionScope = {
  role: 'factory',
  purpose: t(
    'Creates a caller-owned lazy shared quota handle for the original provider admission registry; only constrain and clear are exposed, without publishing execution receipts or queues.',
    '为原提供方准入注册表创建调用方拥有的惰性共享配额句柄，只公开收窄及清理，不公开执行凭据或队列。'
  ),
  returns: t(
    'IProviderAdmissionScope; no registry or native resource is allocated until the original Core owner prepares it.',
    '返回提供方准入作用域，原核心准备之前不分配注册表或原生资源。'
  ),
  example: types.IProviderAdmissionScope.example
}
/** Built-in middlewares add canonical behavior and publish only their own declared capability ports. */
const connectOptions: Record<string, IMemberDoc> = {
  transport: fields.transport,
  discoveryMode: fields.discoveryMode,
  useBaseIdVerifyOnly: p(
    'True/omitted uses base-id verification; false requires an actual identifier callback before unique per-instance identity is honored.',
    '真值或省略使用基础标识验证，假值要求实际身份回调后才采用唯一实例身份。',
    t('Omitted: base-id verification only.', '默认只验证基础标识。')
  ),
  uniqueTargetId: p(
    'Optional application-issued string or async factory receiving endpointId/platform and returning the actual unique suffix; effective only with useBaseIdVerifyOnly false and identifier.',
    '应用签发的可选字符串或异步工厂，接收端点标识及平台并返回实际唯一后缀；只在关闭基础验证且提供身份回调时采用。',
    t('Absent: no explicit unique instance suffix.', '默认不设置显式唯一实例后缀。')
  ),
  identifier: p(
    'Application sync/async verifier receives IRpcConnectContext with actual inbound source facts and returns boolean; throws fail verification.',
    '应用同步或异步验证器接收带实际入站来源事实的连接上下文并返回布尔值，抛错使验证失败。',
    t('Absent: canonical base identity verification is used.', '默认使用规范基础身份验证。')
  ),
  receiverSelector: p(
    'Application sync/async selector receives actual server metadata and endpointId/targetId/operation, returning an existing receiverId or undefined; invented receivers fail TARGET_UNKNOWN.',
    '应用同步或异步选择器接收实际服务元数据和端点、目标、操作，返回已有接收标识或未定义；虚构接收端以目标未知失败。',
    t('Absent: use the canonical receiver selection policy.', '默认使用规范接收端选择策略。')
  )
}
const contractOptions = pick(['version', 'acceptVersions', 'maxIdentifierLength', 'schemas'])
const hookOptions: Record<string, IMemberDoc> = {
  listeners: p(
    'Application synchronous or asynchronous IRpcHook callback(s) receive each actual local event; failures go to onHookError or the canonical diagnostic reporter.',
    '应用同步或异步钩子接收每个实际本地事件，失败交错误回调或规范诊断上报。',
    t('Empty list installs no extra listeners.', '默认空列表，不安装额外监听者。')
  ),
  onHookError: p(
    'Application synchronous callback receives original listener error and its IRpcHookEvent; returns void and must avoid throwing.',
    '应用同步回调接收原监听错误及所属钩子事件，返回空值且应避免抛错。',
    t('Absent: canonical hook error reporting is used.', '默认使用规范钩子错误上报。')
  )
}
for (const [name, en, zh, options, typeName] of [
  [
    'connect',
    'Installs actual transport identity verification and discovery mode before endpoint activation; construction requires this capability.',
    '端点激活前安装实际载体身份验证及发现模式，构造要求此能力。',
    connectOptions,
    'IRpcConnectConfig'
  ],
  [
    'contract',
    'Installs application version and synchronous params/result schema validation without replacing protocol or codec descriptors.',
    '安装应用版本及同步入参结果结构校验，不替代协议或编解码描述对象。',
    contractOptions,
    'IRpcContractConfig'
  ],
  [
    'authentication',
    'Installs original per-frame protection, actual physical-session binding and replay checks; encryption runs before signing, verification before decryption.',
    '安装原逐帧保护、实际物理会话绑定及重放检查，先加密再签名，先验证再解密。',
    authenticationOptions,
    'IRpcAuthenticationConfig'
  ],
  [
    'hooks',
    'Installs actual local diagnostic event listeners; observer failures remain separate from business operation results.',
    '安装实际本地诊断事件监听，观察者失败与业务操作结果分开。',
    hookOptions,
    'IRpcHooksConfig'
  ],
  [
    'timeout',
    'Installs a local deadline default resolved per operation, retaining explicit false to disable a particular wait.',
    '安装逐操作解析的本地截止默认值，保留显式假值以关闭特定等待。',
    { timeoutMs },
    'IRpcTimeoutConfig'
  ],
  [
    'uuid',
    'Installs an optional synchronous identifier generator captured during Host installation; returned values stay subject to original identifier admission.',
    '安装宿主安装时捕获的可选同步标识生成器，返回值仍须通过原标识准入。',
    {
      generate: p(
        'Application synchronous callback receives variation task/message/variation, senderId and optional targetId, returns a string; throws fail the original operation.',
        '应用同步回调接收任务、消息或控制类别、发送标识及可选目标标识，返回字符串，抛错使原操作失败。',
        t(
          'Absent: use Core native entropy/counter identifier generation.',
          '默认使用核心原生熵及计数标识生成。'
        )
      )
    },
    'IRpcUuidConfig'
  ]
] as const) {
  symbols[name] = {
    role: 'enhancer',
    purpose: t(en, zh),
    params: {
      config: t(
        'Application configuration documented by ' +
          typeName +
          '; factory returns a definition, installation occurs in createEndpoint middlewares.',
        '应用提供下方类型所述配置，工厂只返回定义，在端点中间件元组中才执行安装。'
      )
    },
    options: typeName,
    returns: t(
      'Immutable IRpcPlugin definition; unsupported or unreadable fields fail the original installation with INVALID_CONFIG and retained cause.',
      '返回不可变中间件定义，不支持或不可读字段在原安装中以配置非法失败并保留原因。'
    ),
    example: endpointExample
  }
  types[typeName] = typeDoc(en, zh, options)
}
for (const name of ['abort', 'ping'])
  symbols[name] = {
    role: 'enhancer',
    purpose: t(
      name === 'abort'
        ? 'Installs original local and correlated cancellation support; it does not create a signal or invent remote cancellation success.'
        : 'Installs canonical liveness control; the selected actual endpoint tuple gains ping and pingAll only when this capability exists.',
      name === 'abort'
        ? '安装原本地及关联取消支持，不创建信号，也不虚构远端取消成功。'
        : '安装规范存活控制，只有实际端点元组存在该能力时才获得心跳及全体心跳。'
    ),
    returns: t(
      'Immutable plugin definition installed by the endpoint middleware tuple.',
      '返回由端点中间件元组安装的不可变插件定义。'
    ),
    example: endpointExample
  }
for (const [name, kind, param] of [
  ['protocol', 'IRpcProtocol', 'descriptor'],
  ['codec', 'ICodec', 'descriptor'],
  ['framer', 'IRpcFramer', 'descriptor']
] as const)
  symbols[name] = {
    role: 'enhancer',
    purpose: t(
      'Installs an actual ' +
        kind +
        ' component in its canonical semantic/encoding/framing pipeline slot. Top-level configuration wins over middleware contributions; incompatible directed edges fail construction.',
      '在规范语义、编码或分帧管线位置安装实际组件，顶层配置优先于中间件贡献，不兼容双向边界使构造失败。'
    ),
    params: {
      [param]: t(
        name === 'protocol'
          ? 'Actual rpc-contract IRpcProtocol descriptor; omitted input uses rpcProtocolV1. Legacy encode/decode-only objects are not accepted.'
          : name === 'codec'
            ? 'Actual @migaia/serialize/codec ICodec descriptor with matching encode/decode types and immutable identity.'
            : 'Actual rpc-contract IRpcFramer descriptor with original frame/accept callables and compatible encoded domains.',
        name === 'protocol'
          ? '实际契约协议描述对象，省略使用规范传统协议，不接受只有编码解码方法的旧对象。'
          : name === 'codec'
            ? '实际序列化包编解码描述对象，具有匹配编码解码类型及不可变身份。'
            : '实际契约分片描述对象，含原发送接收函数及兼容编码域。'
      )
    },
    returns: t(
      'IRpcPlugin retaining the exact descriptor reference; invalid component shape throws INVALID_CONFIG.',
      '返回保留精确描述引用的插件，组件形态非法抛配置非法错误。'
    ),
    example: endpointExample
  }
/** Every built-in middleware is installed before any gained behavior is used. */
for (const name of [
  'connect',
  'contract',
  'authentication',
  'hooks',
  'timeout',
  'uuid',
  'abort',
  'ping',
  'protocol',
  'codec',
  'framer'
])
  enhancers[name] = {
    kind: 'middleware',
    target: 'IRpcEndpoint',
    summary: t(
      'Installs the original ' +
        name +
        ' capability into one canonical endpoint construction transaction; it has no standalone network effect.',
      '把该能力安装到一次规范端点构造事务中，单独创建定义没有网络效果。'
    ),
    install: endpointExample,
    grants: [],
    behaviors: [symbols[name].purpose],
    scenarios: [
      t(
        'Select only the actual capabilities required by the endpoint application and carrier.',
        '只选择端点应用及载体实际需要的能力。'
      )
    ],
    example: endpointExample
  }
enhancers.connect = {
  ...enhancers.connect,
  grants: Object.entries(discoveryMembers).map(([name, doc]) => ({
    ...doc,
    signature: 'endpoint.connect.' + name + '(...)'
  }))
}
enhancers.ping = {
  ...enhancers.ping,
  grants: ['ping', 'pingAll'].map((name) => ({
    ...endpointMembers[name],
    signature: 'endpoint.' + name + '(...)'
  }))
}
/** A native feature is installed by PluginHost; its direct dependencies remain private edges. */
const featureExample = `import { createEndpoint, connect, defineFeature } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
const [left] = createMemoryTransportPair()
const clock = defineFeature(() => ({ read: () => 42 }))
const endpoint = await createEndpoint({ id: 'local', transport: left, middlewares: [connect({ transport: left })], features: [clock] })
console.log(endpoint.read())
await endpoint.dispose()
left.close()`
/** Native middleware may publish an extension and synchronous public projection. */
const middlewareExample = `import { createEndpoint, connect, defineMiddleware } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
const [left] = createMemoryTransportPair()
const count = defineMiddleware('count', (core) => ({
  install: () => ({ endpointLabel: core.id }),
  expose: () => ({ readCount: () => 0 })
}))
const endpoint = await createEndpoint({ id: 'local', transport: left, middlewares: [connect({ transport: left }), count] })
console.log(endpoint.readCount())
await endpoint.dispose()
left.close()`
symbols.defineFeature = {
  role: 'enhancer',
  purpose: t(
    'Defines a genuine synchronous PluginHost feature with private direct dependencies and optional immutable publication policy. The endpoint construction transaction owns installation and cleanup.',
    '定义真实同步插件宿主功能，带私有直接依赖及可选不可变发布策略，端点构造事务拥有安装及清理。'
  ),
  params: {
    install: t(
      'Application synchronous @migaia/plugin-host IFeatureFactory receives its native feature context and returns the capability surface; throws fail construction.',
      '应用同步原生功能工厂接收功能上下文并返回能力表面，抛错使构造失败。'
    ),
    dependencies: t(
      'Optional application record of genuine feature tokens returned by defineFeature; omitted means no direct private dependency.',
      '应用可选真实功能令牌记录，由功能定义工厂返回，省略表示没有直接私有依赖。'
    ),
    definition: t(
      'Alternative IRpcFeatureDefinition holding the same synchronous factory, dependencies and immutable publication policy.',
      '另一重载接收功能定义对象，包含相同同步工厂、依赖及不可变发布策略。'
    )
  },
  options: 'IRpcFeatureDefinition',
  returns: t(
    'Opaque IRpcFeature token retained in config.features or a first-party root record; a noncallable factory fails INVALID_CONFIG.',
    '返回保留在端点功能或第一方根记录中的不透明功能令牌，工厂不可调用时配置非法。'
  ),
  example: featureExample
}
symbols.defineMiddleware = {
  role: 'enhancer',
  purpose: t(
    'Defines a genuine named PluginHost middleware, or captures an IRpcPlugin descriptor. Descriptor construction runs per registration and its installation joins the canonical endpoint transaction.',
    '定义真实具名插件宿主中间件，或捕获原插件描述；每次登记运行描述构造，安装加入规范端点事务。'
  ),
  params: {
    definition: t(
      'Original application IRpcPlugin descriptor with declared claims and installation callback; component metadata is captured, not accepted as runtime authority.',
      '应用原插件描述，含声明及安装回调，组件元数据被捕获但不作为运行权限。'
    ),
    name: t(
      'Stable unique middleware name issued by the application; duplicate public keys or incompatible claims reject construction.',
      '应用签发的稳定唯一中间件名称，重复公开键或不兼容声明使构造拒绝。'
    ),
    descriptorFactory: t(
      'Application synchronous callback receives IRpcMiddlewareCore and returns an IRpcMiddlewareDescriptor; async work belongs in install. Throws fail construction.',
      '应用同步回调接收中间件核心并返回描述对象，异步工作属于安装回调，抛错使构造失败。'
    ),
    featureRecord: t(
      'Optional application record of genuine direct native feature tokens; outputs appear in core.features.',
      '应用可选真实直接原生功能令牌记录，其输出出现在中间件核心功能记录中。'
    )
  },
  returns: t(
    'IRpcNativeMiddleware definition installed through middlewares; its original native owner preserves lifecycle identity.',
    '返回经中间件元组安装的原生定义，由原生所有者保留生命周期身份。'
  ),
  example: middlewareExample
}
for (const [name, example] of [
  ['defineFeature', featureExample],
  ['defineMiddleware', middlewareExample]
] as const)
  enhancers[name] = {
    kind: name === 'defineFeature' ? 'feature' : 'middleware',
    target: 'IRpcEndpoint',
    summary: symbols[name].purpose,
    install: example,
    grants: [],
    behaviors: [
      t(
        'The application defines the output surface; no fixed endpoint method is implied by defining a token.',
        '应用定义输出表面，创建令牌不隐含固定端点方法。'
      )
    ],
    scenarios: [
      t(
        'Extend endpoint capabilities inside the original construction owner.',
        '在原构造所有者内扩展端点能力。'
      )
    ],
    example
  }
types.IRpcFeatureDefinition = typeDoc(
  'Static native feature definition and immutable endpoint publication policy.',
  '静态原生功能定义及不可变端点发布策略。',
  {
    install: p(
      'Application synchronous IFeatureFactory receives native context and returns its declared capability object; throwing aborts construction.',
      '应用同步功能工厂接收原生上下文并返回声明能力对象，抛错中止构造。'
    ),
    dependencies: p(
      'Application record of genuine direct feature tokens; dependency output remains private to its factory.',
      '应用真实直接功能令牌记录，依赖输出只对其工厂可见。',
      t('Absent: no direct dependencies.', '默认没有直接依赖。')
    ),
    publicKeys: p(
      'Application-declared keys allowed on the public endpoint projection; duplicates conflict.',
      '应用声明允许出现在公开端点投影的键，重复键构成冲突。',
      t('Absent: no additional explicit public-key policy.', '默认没有额外显式公开键策略。')
    ),
    conflicts: p(
      'Application-declared incompatible native feature policy keys.',
      '应用声明的不兼容原生功能策略键。',
      t('Absent: no explicit additional conflict keys.', '默认没有显式额外冲突键。')
    )
  },
  featureExample
)
for (const [name, en, zh] of [
  [
    'IRpcFeature',
    'The definition object for a reusable RPC feature. RPC defineFeature creates it through [Plugin Host](/en/docs/plugin-host/api/defineFeature), which manages feature installation. Pass this original object when selecting a feature or declaring a dependency. Installation uses that object to find the methods or values returned by the feature; a copied object does not preserve that identity.',
    '表示一项可复用 RPC 功能的定义对象。RPC 的 defineFeature 通过 [Plugin Host](/zh/docs/plugin-host/api/defineFeature) 创建它，由 Plugin Host 管理功能安装。选择功能或声明依赖时，传入最初返回的对象。安装过程用这个对象找到功能返回的方法或数据；复制对象的属性不能保留这种对应关系。'
  ],
  [
    'IRpcFeatureSurface',
    'Compile-time intersection of selected native root output surfaces, without a runtime feature registry.',
    '所选原生根输出表面的编译期交集，不建立运行功能注册表。'
  ],
  [
    'IRpcMiddleware',
    'Union of supported native middleware and original plugin descriptors accepted by endpoint composition.',
    '端点组合接受的受支持原生中间件及原插件描述联合。'
  ],
  [
    'IRpcNativeMiddleware',
    'An RPC middleware definition, represented by a [Plugin Host](/en/docs/plugin-host/api/definePlugin) plugin definition. Create it with defineMiddleware and include it in the endpoint’s middlewares list. The endpoint installs the original definition, resolves its declared feature dependencies, and makes its published methods available. The type retains those dependency and method types for callers.',
    '表示 RPC 中间件的插件定义，底层采用 [Plugin Host](/zh/docs/plugin-host/api/definePlugin) 的插件定义。用 defineMiddleware 创建后，将它放入端点的 middlewares 列表。端点安装原定义，找到它声明依赖的功能，并提供它公开的方法。这个类型同时保留依赖和方法的类型信息，供调用方检查用法。'
  ]
] as const)
  types[name] = typeDoc(en, zh, {}, featureExample)
/** Public scope resource registration returns the exact borrowed value, never a replacement wrapper. */
const own = m(
  'Registers original cleanup in the construction scope and returns the same resource; releases may be synchronous or async and failures remain cleanup evidence.',
  '在构造作用域登记原清理并返回同一资源，释放可以同步或异步，失败仍保留为清理证据。',
  {
    resource: t(
      'Original application resource acquired during this installation.',
      '本次安装取得的原应用资源。'
    ),
    release: t(
      'Application zero-argument callback returning void or Promise<void>; releases that resource once when its owner cleans up.',
      '应用无参回调返回空值或承诺，在所有者清理时释放该资源一次。'
    )
  },
  t(
    'Exact original resource reference, now registered for owned cleanup.',
    '返回精确原资源引用，其清理已登记。'
  ),
  middlewareExample
)
types.IRpcPluginInstallScope = typeDoc(
  'Original installation scope supplied by the endpoint owner; use its cancellation, ports and cleanup rather than constructing a second lifecycle.',
  '端点所有者提供的原安装作用域，应使用其取消、端口及清理，不另建生命周期。',
  {
    id: factoryOptions.id,
    transport: factoryOptions.transport,
    signal,
    hooks: p(
      'Synchronous owner callback receives one IRpcHookEvent; diagnostics remain independent of business results.',
      '同步所有者回调接收一个钩子事件，诊断与业务结果分开。'
    ),
    getPort: m(
      'Reads an already provided construction port by its exact declared key; does not register a new capability.',
      '按精确声明键读取已提供构造端口，不登记新能力。',
      {
        key: t(
          'Canonical PropertyKey declared in middleware sharedConsumes or sharedOptionalConsumes.',
          '中间件共享消费或可选共享消费声明的规范属性键。'
        )
      },
      t('Original port value, or undefined when unavailable.', '返回原端口值，不可用时没有值。'),
      middlewareExample
    ),
    own
  },
  middlewareExample
)
types.IRpcMiddlewareCore = typeDoc(
  'Public native middleware context retains endpoint identity, cancellation and resource ownership without exposing Host-local receivers.',
  '公开原生中间件上下文保留端点身份、取消及资源所有权，不公开宿主本地接收器。',
  {
    id: factoryOptions.id,
    transport: factoryOptions.transport,
    signal,
    hooks: types.IRpcPluginInstallScope.members.hooks,
    own,
    features: p(
      'Direct feature outputs from this definition featureRecord; no global runtime feature lookup is exposed.',
      '本定义功能记录中的直接功能输出，不公开全局运行功能查询。'
    ),
    featureExpose: p(
      'Host-owned synchronous feature bridge required by direct feature dependencies.',
      '直接功能依赖要求的宿主拥有同步功能桥。'
    )
  },
  middlewareExample
)
types.IRpcMiddlewareDescriptor = typeDoc(
  'Per-registration native descriptor separates async installation from synchronous public and feature projections.',
  '逐登记原生描述区分异步安装与同步公开及功能投影。',
  {
    install: p(
      'Application zero-argument callback returns extension or PromiseLike<extension>; throws/rejections fail construction and trigger owned cleanup.',
      '应用无参回调返回扩展或类承诺，抛错及拒绝使构造失败并触发已有清理。',
      t('Absent: no installation extension.', '默认没有安装扩展。')
    ),
    expose: p(
      'Application synchronous zero-argument callback returns its public endpoint projection; PromiseLike outputs are unsupported.',
      '应用同步无参回调返回公开端点投影，不支持类承诺输出。',
      t('Absent: no public projection.', '默认没有公开投影。')
    ),
    featureExpose: p(
      'Application synchronous zero-argument callback returns the direct dependencies feature bridge; throws fail construction.',
      '应用同步无参回调返回直接依赖功能桥，抛错使构造失败。',
      t(
        'Absent unless selected dependencies require their bridge.',
        '默认不设置，除非所选依赖要求功能桥。'
      )
    )
  },
  middlewareExample
)
types.IRpcPluginClaims = typeDoc(
  'Immutable declaration of original middleware routing, shared ports and public projection keys; declarations alone grant no runtime authority.',
  '原中间件路由、共享端口及公开投影键的不可变声明，声明本身不赋予运行权限。',
  Object.fromEntries(
    [
      [
        'routes',
        'Original route names handled by this middleware.',
        '此中间件处理的原始路由名称。'
      ],
      ['provides', 'Stable capability keys declared as provided.', '声明为提供的稳定能力键。'],
      [
        'consumes',
        'Stable capability keys required from selected owners.',
        '要求所选所有者提供的稳定能力键。'
      ],
      [
        'publicKeys',
        'Keys published on the endpoint public surface.',
        '发布到端点公开表面的属性键。'
      ],
      [
        'exposedKeys',
        'Keys published in native exposure projection.',
        '发布到原生公开投影的属性键。'
      ],
      [
        'activator',
        'Whether this definition activates the original execution owner.',
        '此定义是否激活原始执行所有者。'
      ]
    ].map(([key, en, zh]) => [key, p(en, zh)])
  ),
  middlewareExample
)
types.IRpcPluginMetadata = typeDoc(
  'Captured plugin composition declarations retain the single original capability owner.',
  '捕获的插件组合声明保留唯一原能力所有者。',
  {
    claims: p(
      'Complete immutable IRpcPluginClaims used for composition conflict checks.',
      '用于组合冲突检查的完整不可变插件声明。'
    ),
    ...Object.fromEntries(
      ['sharedProvides', 'sharedConsumes', 'sharedOptionalConsumes'].map((key) => [
        key,
        p(
          key === 'sharedProvides'
            ? 'Canonical shared port keys provided by this original installation.'
            : key === 'sharedConsumes'
              ? 'Canonical shared port keys required before installation.'
              : 'Canonical shared port keys consumed only when already available.',
          key === 'sharedProvides'
            ? '此原安装提供的规范共享端口键。'
            : key === 'sharedConsumes'
              ? '安装之前必需的规范共享端口键。'
              : '只在已经可用时消费的规范共享端口键。',
          t(
            'Absent: the corresponding shared-port declaration is empty.',
            '默认对应共享端口声明为空。'
          )
        )
      ])
    )
  },
  middlewareExample
)
types.IRpcPluginInstallResult = typeDoc(
  'Original installation result separates public extension from shared construction ports.',
  '原安装结果将公开扩展与共享构造端口分开。',
  {
    extension: p(
      'Readonly application extension published through this original installation.',
      '经此原安装发布的只读应用扩展。'
    ),
    ports: p(
      'Readonly canonical PropertyKey-to-port values consumed by declared shared dependencies.',
      '声明共享依赖消费的只读规范属性键与端口值。'
    )
  },
  middlewareExample
)
types.IRpcPlugin = typeDoc(
  'Original component/plugin definition captured before installation; only its genuine composer can publish accepted execution surfaces.',
  '安装前捕获的原组件插件定义，只有真实组合器可以发布受认可执行表面。',
  {
    name: p('Stable unique plugin name issued by its author.', '作者签发的稳定唯一插件名称。'),
    metadata: p(
      'Composition claims and exact shared-port declarations.',
      '组合声明及精确共享端口声明。'
    ),
    discoveryMode: fields.discoveryMode,
    pingCapability: p(
      'True only when the definition contributes actual ping support.',
      '只有定义贡献实际心跳支持时为真。'
    ),
    transport: factoryOptions.transport,
    protocol: factoryOptions.protocol,
    codec: factoryOptions.codec,
    framer: factoryOptions.framer,
    install: m(
      'Runs within the original construction transaction; throwing or rejecting fails installation and joins owned rollback.',
      '在原构造事务内运行，抛错或拒绝使安装失败并加入已有回滚。',
      {
        scope: t(
          'Original IRpcPluginInstallScope supplied by the endpoint composer.',
          '端点组合器提供的原安装作用域。'
        )
      },
      t(
        'IRpcPluginInstallResult synchronously or asynchronously, with public extension and shared ports.',
        '同步或异步返回含公开扩展及共享端口的安装结果。'
      ),
      middlewareExample
    )
  },
  middlewareExample
)
types.IRpcFeatureConfig = typeDoc(
  'Data-only declaration of whether original abort and ping capabilities are enabled.',
  '原中止及心跳能力是否启用的纯数据声明。',
  {
    abort: p(
      'Enables admitted cancellation when the original abort plugin is installed.',
      '安装原中止插件时启用已准入取消。',
      t('Absent: no declared abort capability.', '默认没有声明中止能力。')
    ),
    ping: p(
      'Enables original liveness controls when the ping plugin is installed.',
      '安装心跳插件时启用原存活控制。',
      t('Absent: no declared ping capability.', '默认没有声明心跳能力。')
    )
  }
)
types.IRpcAbortCapability = typeDoc(
  'Original installed cancellation capability marker; a copied marker cannot acquire execution ownership.',
  '原已安装取消能力标记，复制标记不能取得执行所有权。',
  {
    enabled: {
      ...p(
        'Literal true marks configured cancellation support.',
        '真字面值标记已经配置的取消支持。'
      ),
      values: {
        true: t(
          'Cancellation support is installed by the original owner.',
          '原所有者已经安装取消支持。'
        )
      }
    }
  }
)
types.IRpcPingCapability = typeDoc(
  'Original installed liveness capability marker; endpoint projection follows the actual selected middleware tuple.',
  '原已安装存活能力标记，端点投影遵循实际所选中间件元组。',
  types.IRpcAbortCapability.members
)
types.IRpcUniqueTargetIdContext = typeDoc(
  'Original endpoint identity passed to an application suffix factory during connection installation.',
  '连接安装时传给应用后缀工厂的原端点身份。',
  {
    endpointId: p(
      'Actual configured endpoint identifier supplied by the constructing owner.',
      '构造所有者提供的实际配置端点标识。'
    ),
    platform: p(
      'Actual adapter platform supplied by the constructing owner.',
      '构造所有者提供的实际适配器平台。'
    )
  }
)
types.IRpcConnectContext = typeDoc(
  'Original inbound verification context attributed by the held transport; labels alone do not prove peer identity.',
  '持有载体归属的原入站验证上下文，仅有标签不能证明对端身份。',
  {
    senderId: fields.senderId,
    targetId: fields.targetId,
    peerId: fields.peerId,
    origin: fields.origin,
    source: p(
      'Actual native inbound source retained by the transport, such as a Window or MessagePort; it is not an error package source.',
      '载体保留的实际原生入站来源，例如窗口或消息端口，不是错误包来源。'
    ),
    data: fields.data,
    platform: p('Actual inbound transport platform when available.', '可用时的实际入站载体平台。'),
    topology: {
      ...p('Actual adapter topology when available.', '可用时的实际适配器拓扑。'),
      values: { enum: 'RpcTransportTopology' }
    }
  }
)
types.IRpcConnectCapability = typeDoc(
  'Captured installed connection policy retains original transport and actual verification operations.',
  '捕获的已安装连接策略保留原载体及实际验证操作。',
  {
    ...connectOptions,
    uniqueTargetId: p(
      'Optional actual suffix resolved from the configured application string or factory.',
      '从应用配置字符串或工厂解析的可选实际后缀。'
    ),
    uniqueTargetIdFactory: p(
      'Optional original application factory receives IRpcUniqueTargetIdContext and returns a string or Promise<string>; failures reject installation.',
      '可选原应用工厂接收唯一目标上下文，返回字符串或承诺，失败拒绝安装。'
    ),
    verify: m(
      'Runs actual configured inbound identification, preserving asynchronous verification and original read-failure reporting.',
      '运行实际配置的入站身份识别，保留异步验证及原读取失败上报。',
      {
        context: t(
          'Actual IRpcConnectContext attributed by the held transport.',
          '持有载体归属的实际连接上下文。'
        ),
        reportRead: t(
          'Optional synchronous callback receives property key and original getter error, must return undefined; a throw preserves both failures.',
          '可选同步回调接收属性键及原读取错误，须返回未定义值，抛错保留两个失败。'
        )
      },
      t(
        'Boolean or Promise<boolean> indicating this original message passes identification.',
        '布尔值或承诺表示此原消息是否通过识别。'
      ),
      endpointExample
    )
  }
)
types.IRpcAuthenticationContext = typeDoc(
  'Actual transform context is supplied by the installed authentication owner at its physical frame boundary.',
  '已安装认证所有者在物理帧边界提供的实际转换上下文。',
  {
    direction: {
      ...p('Actual direction of this transform invocation.', '本次转换调用的实际处理方向。'),
      values: {
        outbound: t('Protecting a frame before actual sending.', '实际发送之前正在保护物理帧。'),
        inbound: t('Unprotecting a received physical frame.', '正在解除已接收物理帧的保护。')
      }
    },
    endpointId: types.IRpcUniqueTargetIdContext.members.endpointId,
    platform: types.IRpcUniqueTargetIdContext.members.platform
  }
)
types.IRpcAuthenticationTransform = typeDoc(
  'Application transform receives original frame value and IRpcAuthenticationContext, returns transformed value synchronously or asynchronously; throws/rejections become authentication failure.',
  '应用转换接收原帧值及认证上下文，同步或异步返回转换值，抛错及拒绝成为认证失败。',
  {}
)
types.IRpcAuthenticationCapability = typeDoc(
  'Original installed frame-protection operations own actual authentication mode and encoded carrier requirements.',
  '原已安装帧保护操作拥有实际认证模式及编码载体要求。',
  {
    mode: {
      ...p(
        'Actual original protection mode reported to probe descriptors.',
        '报告给探针描述的实际原保护模式。'
      ),
      values: observationReference.types.IRpcProbeDescriptor.members.authentication.values
    },
    enabled: types.IRpcAbortCapability.members.enabled,
    encodedType: authenticationOptions.encodedType,
    protect: p(
      'Original transform receives value and authentication context, returns protected value or Promise; failures retain AUTHENTICATION_FAILED semantics.',
      '原转换接收值及认证上下文，返回保护值或承诺，失败保留认证失败语义。'
    ),
    unprotect: p(
      'Original transform receives physical protected value and context, returns verified unprotected value or Promise.',
      '原转换接收物理保护值及上下文，返回已验证解除保护值或承诺。'
    )
  }
)
types.IRpcMethodSchema = typeDoc(
  'Application schema pair validates requests and results independently; parse output is not used as a replacement payload.',
  '应用结构对分别校验请求及结果，不把解析输出作为替换载荷。',
  {
    params: p(
      'Application IRpcSchema applied to original incoming parameter data.',
      '作用于原入站参数数据的应用结构校验器。'
    ),
    result: p(
      'Application IRpcSchema applied to original outgoing result data.',
      '作用于原出站结果数据的应用结构校验器。'
    )
  }
)
types.IRpcSchema = typeDoc(
  'Synchronous application parser used for validation only; original input remains the operation payload.',
  '只用于验证的同步应用解析器，原输入仍作为操作载荷。',
  {
    parse: m(
      'Validates the supplied original value synchronously; a throw becomes SCHEMA_INVALID with original cause.',
      '同步验证给定原值，抛错成为结构非法并保留原原因。',
      {
        value: t(
          'Original request or result value supplied by the contract owner.',
          '契约所有者提供的原请求或结果值。'
        )
      },
      t(
        'Typed parser value; Core uses success/failure only and does not replace data with this result.',
        '返回有类型解析值，核心只使用成功失败，不用此结果替换数据。'
      ),
      'const schema = { parse(value: unknown) { if (typeof value !== "string") throw new TypeError("Expected text"); return value } }; schema.parse("hello")'
    )
  }
)
types.IRpcSchemaIssue = typeDoc(
  'Public schema diagnostic detail preserves path, message and optional validator code.',
  '公开结构诊断细节保留路径、消息及可选校验码。',
  {
    path: p(
      'Original validator-issued string/number path segments into the submitted payload.',
      '原校验器签发的载荷字符串或数字路径段。'
    ),
    message: p(
      'Original validator diagnostic explaining the rejected value.',
      '原校验器解释拒绝值的诊断信息。'
    ),
    code: p('Optional validator-issued semantic classification.', '校验器签发的可选语义分类。')
  }
)
types.IRpcContractCapability = typeDoc(
  'Installed contract configuration plus original synchronous schema validation; validation does not transform payloads.',
  '已安装契约配置及原同步结构校验，验证不会转换载荷。',
  {
    ...contractOptions,
    validateData: m(
      'Looks up the actual method and side schema; a parser throw is wrapped as SCHEMA_INVALID.',
      '查询实际方法及侧的结构校验器，解析抛错被包装为结构非法。',
      {
        method,
        side: t(
          'params validates request input; result validates provider output.',
          '参数侧校验请求输入，结果侧校验提供方输出。'
        ),
        data: t(
          'Original value owned by the current request/result operation.',
          '当前请求或结果操作拥有的原始值。'
        )
      },
      t(
        'Returns after successful validation or when no schema is configured; original data is retained.',
        '成功验证或未配置结构时返回，保留原数据。'
      ),
      endpointExample
    )
  }
)
types.IRpcTimeoutCapability = typeDoc(
  'Installed relative deadline policy resolves a per-operation override against its captured default.',
  '已安装相对截止策略按捕获默认值解析逐操作覆盖。',
  {
    timeoutMs,
    resolveTimeout: m(
      'Selects a valid explicit override or the installed default, preserving false as disabled.',
      '选择有效显式覆盖或已安装默认值，假值保持关闭含义。',
      {
        override: t(
          'Optional finite nonnegative milliseconds or false from the actual operation options.',
          '实际操作选项提供的可选有限非负毫秒或假值。'
        )
      },
      t(
        'Effective milliseconds, false, or undefined when unconfigured.',
        '返回生效毫秒、假值或未配置时的未定义值。'
      ),
      endpointExample
    )
  }
)
types.IRpcUuidContext = typeDoc(
  'Original outbound owner supplies the identifier category and admitted route identities to a synchronous generator.',
  '原出站所有者向同步生成器提供标识类别及已准入路由身份。',
  {
    variation: {
      ...p(
        'Original task, message or variation identifier category.',
        '原任务、消息或变体标识类别。'
      ),
      values: {
        task: t('Creates a correlated task identifier.', '创建关联任务所需的唯一标识。'),
        message: t('Creates a physical message identifier.', '创建物理消息所需的唯一标识。'),
        variation: t('Creates a protocol variation identifier.', '创建协议变体所需的唯一标识。')
      }
    },
    senderId: p(
      'Local endpoint identifier issuing this outbound UUID request; it is not an authenticated inbound sender.',
      '发起本次出站标识生成的本端端点标识，不是已认证入站发送方。'
    ),
    targetId: fields.targetId
  }
)
for (const name of ['IRpcProtocolConfig', 'IRpcProtocolCapability'])
  types[name] = typeDoc(
    name === 'IRpcProtocolConfig'
      ? 'Legacy data-only encode/decode shape; it is not a valid replacement for the rpc-contract IRpcProtocol descriptor accepted by protocol().'
      : 'Original encode/decode capability shape retaining its encoded-domain metadata.',
    name === 'IRpcProtocolConfig'
      ? '旧纯数据编码解码形态，不是协议中间件接受的规范协议描述对象替代品。'
      : '保留编码域元数据的原编码解码能力形态。',
    {
      encode: p(
        'Synchronous value-to-carrier callback; original thrown failures propagate to the owning encoding boundary.',
        '同步值到载体回调，原抛错传播到所属编码边界。',
        t(
          'Optional only on configuration shapes; no callback is invented.',
          '仅在配置形态中可选，不虚构回调。'
        )
      ),
      decode: p(
        'Synchronous carrier-to-value callback; original thrown failures propagate to the owning decoding boundary.',
        '同步载体到值回调，原抛错传播到所属解码边界。',
        t(
          'Optional only on configuration shapes; no callback is invented.',
          '仅在配置形态中可选，不虚构回调。'
        )
      ),
      encodedType: authenticationOptions.encodedType,
      ...(name === 'IRpcProtocolCapability'
        ? {
            identity: p(
              'True only when this actual capability preserves original value identity.',
              '只有实际能力保留原值身份时为真。'
            )
          }
        : {})
    }
  )
types.IRpcHook = typeDoc(
  'Application observer receives IRpcHookEvent and returns void or Promise<void>; failures are observed by onHookError rather than replacing operation results.',
  '应用观察者接收钩子事件并返回空值或承诺，失败由钩子错误回调观察，不替换操作结果。',
  {}
)
/** Hook fields describe local evidence without pretending they are wire control authority. */
const hookFields: Record<string, IMemberDoc> = {
  name: p(
    'Canonical owner-issued local diagnostic event name.',
    '规范所有者签发的本地诊断事件名称。'
  ),
  at: p(
    'Epoch-millisecond diagnostic timestamp from configured wallClock.',
    '来自配置纪元时钟的毫秒诊断时间戳。'
  ),
  localId: p(
    'Actual local endpoint identifier issued by its application configuration.',
    '实际本地端点标识，由其应用配置签发。'
  ),
  code: p(
    'Observed semantic failure code when this event reports a coded error.',
    '事件报告带码错误时观察到的语义失败码。'
  ),
  error: p('Original diagnostic failure reference when present.', '存在时的原诊断失败引用。'),
  field: p(
    'Owner-issued field name associated with the diagnostic.',
    '所有者签发的诊断关联字段名称。'
  ),
  detail: p(
    'Local-only replay capacity evidence, never serialized to RPC frames.',
    '只在本地存在的重放容量证据，不序列化到调用帧。'
  ),
  durationMs: p(
    'Relative peer drain duration from an admitted close control frame.',
    '来自已准入关闭控制帧的相对对端排空时间。'
  ),
  contract: p(
    'Observed contract evidence retained for local diagnostics.',
    '为本地诊断保留的已观察契约证据。'
  ),
  variation: p(
    'Observed variation evidence retained for local diagnostics.',
    '为本地诊断保留的已观察变体证据。'
  ),
  targetId: fields.targetId,
  receiverId: fields.receiverId,
  requesterId: p(
    'Original admitted requester identifier supplied by the observed owner.',
    '观察所有者提供的原已准入请求方标识。'
  ),
  receiverIds: p(
    'Actual receiver identifiers returned by the discovery owner.',
    '发现所有者返回的实际接收端标识列表。'
  ),
  ambiguous: p(
    'Whether actual discovery had several equally eligible candidates.',
    '实际发现是否存在多个同等合格候选。'
  ),
  responseCount: p(
    'Actual number of observed discovery/control responses.',
    '实际观察到的发现或控制响应数量。'
  )
}
types.IRpcHookEvent = typeDoc(
  'Owner-issued local hook record; optional fields appear only for the actual diagnostic branch.',
  '所有者签发的本地钩子记录，可选字段只在实际诊断分支出现。',
  hookFields
)
types.IRpcReplayCapacityDetail = typeDoc(
  'Rate-limited local replay admission evidence separates actual occupancy from the shared overload code.',
  '限速本地重放准入证据，把实际占用与共享过载码分开。',
  {
    namespace: {
      ...p(
        'Actual replay owner namespace whose quota rejected work.',
        '其配额拒绝工作的实际重放所有者命名空间。'
      ),
      values: {
        inbound: t('Inbound verified-peer original replay ledger.', '入站已验证对端原始重放账本。'),
        outbound: t(
          'Outbound active identities and retained tombstones.',
          '出站活动身份及已保留墓碑。'
        )
      }
    },
    reason: {
      ...p('Actual original replay refusal branch.', '实际原始重放拒绝分支。'),
      values: {
        replayLedgerFull: enums.RpcProviderRejectionReason.values.replayLedgerFull,
        outboundReplayFull: enums.RpcProviderRejectionReason.values.outboundReplayFull
      }
    },
    occupancy: p('Actual owner occupancy at the refusal boundary.', '拒绝边界上的实际所有者占用。'),
    limit: p('Configured actual owner quota at that boundary.', '该边界配置的实际所有者配额。'),
    peerOccupancy: p(
      'Inbound-only verified-peer occupancy without exposing its identity.',
      '仅入站的已验证对端占用，不公开其身份。'
    ),
    peerLimit: p(
      'Inbound-only configured per-verified-peer quota.',
      '仅入站的已配置逐验证对端配额。'
    )
  }
)
/** Direct claim example retains the same execution owner from reservation through settlement. */
const idempotencyExample = `import { createRpcIdempotencyStore } from '@migaia/rpc-core'
const store = createRpcIdempotencyStore()
const claim = store.claim('actual-session', 'checkout-1', 0, 'checkout-v1')
if (claim.status === 'claimed') claim.settle({ ok: true, data: 'accepted' }, 1)
console.log(store.lookup?.('actual-session', 'checkout-1', 2))`
/** Idempotency outcomes are portable business facts, separate from transport write settlement. */
types.IRpcIdempotencyOutcome = typeDoc(
  'Portable successful or failed provider outcome retained by the actual store; a later request may replay it without executing business again.',
  '实际存储保留的可移植提供方成功或失败结果，后续请求可重放而不再次执行业务。',
  {
    ok: {
      ...p(
        'True retains successful data; false retains public failure presentation.',
        '真值保留成功数据，假值保留公开失败展示。'
      ),
      values: {
        true: t(
          'Business completed successfully and data may be replayed.',
          '业务已经成功完成，可以重放数据。'
        ),
        false: t('Business completed with a retained public failure.', '业务以已保留公开失败结束。')
      }
    },
    data: p(
      'Original portable business payload or public failure detail.',
      '原可移植业务载荷或公开失败细节。'
    ),
    code: p(
      'Original provider-issued public failure code on unsuccessful outcomes.',
      '失败结果中原提供方签发的公开失败码。'
    ),
    message: p(
      'Original public failure presentation retained for replay.',
      '为重放保留的原公开失败展示信息。'
    ),
    error: p(
      'Optional rpc-contract IRpcSerializedError preserving the original failure chain.',
      '保留原失败链的可选契约序列化错误。'
    )
  },
  idempotencyExample
)
types.IRpcIdempotencyClaim = typeDoc(
  'One store claim owns execution, waits on original work, replays retained outcome, or refuses capacity; each status has a distinct available surface.',
  '一次存储认领可以拥有执行、等待原工作、重放保留结果或拒绝容量，每个状态有不同可用表面。',
  {
    status: {
      ...p(
        'Discriminates claimed, pending, done and full branches; narrow before using branch-specific methods.',
        '区分已认领、等待、完成及容量满分支，使用分支方法前须缩窄。'
      ),
      values: {
        claimed: t(
          'This exact claim owns the first business execution.',
          '此精确认领拥有首次业务执行。'
        ),
        pending: t(
          'Original business is still running; await its existing outcome.',
          '原业务仍运行，等待其现有结果。'
        ),
        done: t(
          'Original business already settled; replay or report unavailable body.',
          '原业务已结算，应重放或报告结果体不可用。'
        ),
        full: t(
          'No execution reservation was admitted at the current quota.',
          '当前配额没有准入任何执行预留。'
        )
      }
    },
    settle: m(
      'On a claimed branch, settles once with the original portable business outcome and starts retention at the supplied time.',
      '在已认领分支中用原可移植业务结果结算一次，并从给定时间开始保留。',
      {
        outcome: t(
          'Actual IRpcIdempotencyOutcome returned by the original business execution.',
          '原业务执行返回的实际幂等结果。'
        ),
        now: t(
          'Current monotonic milliseconds from the same clock used for claim.',
          '来自认领相同时钟的当前单调毫秒。'
        )
      },
      t(
        'Original waiters receive the result or unavailable marker; stale settlement does not reacquire ownership.',
        '原等待者收到结果或不可用标记，过期结算不能重新取得所有权。'
      ),
      idempotencyExample
    ),
    release: m(
      'On a claimed branch, abandons the original unexecuted reservation and wakes waiters without an outcome.',
      '在已认领分支中放弃原未执行预留，并唤醒等待者而不提供结果。',
      {},
      t(
        'The original reservation is removed; this is not a retry of already executed business.',
        '原预留被移除，这不是重试已经执行的业务。'
      ),
      idempotencyExample
    ),
    outcome: p(
      'Pending returns the original completion Promise; done contains retained outcome or unavailable when its body was evicted.',
      '等待分支返回原完成承诺，完成分支包含保留结果或结果体被淘汰时的不可用标记。'
    )
  },
  idempotencyExample
)
types.IRpcIdempotencyStore = typeDoc(
  'Injectable original execution/outcome owner; scope and key admission must follow actual verified connection identity rather than caller labels.',
  '可注入原执行及结果所有者，作用域及键准入须遵循实际已验证连接身份，不取调用方标签。',
  {
    claim: m(
      'Reserves the original scope/key once, observes matching pending work or returns retained completion; incompatible fingerprints fail CONTRACT_INVALID.',
      '对原作用域及键预留一次、观察匹配等待工作或返回保留完成，不兼容指纹以契约非法失败。',
      {
        scope: t(
          'Actual verified session scope issued by the admission owner, or an explicit application-issued isolated scope for direct use.',
          '实际已验证会话准入所有者签发的作用域，直接使用时由应用签发隔离作用域。'
        ),
        key: t(
          'Stable application-issued operation key reused only for the same intended execution.',
          '应用签发的稳定操作键，只为相同预期执行复用。'
        ),
        now: t(
          'Finite monotonic milliseconds supplied by the original caller clock.',
          '原调用方时钟提供的有限单调毫秒。'
        ),
        fingerprint: t(
          'Optional canonical operation fingerprint issued by the original admitted operation owner.',
          '原已准入操作所有者签发的可选规范操作指纹。'
        )
      },
      t(
        'IRpcIdempotencyClaim; capacity refusal does not execute business.',
        '返回幂等认领，容量拒绝不会执行业务。'
      ),
      idempotencyExample
    ),
    lookup: m(
      'Optional outcome-only lookup neither allocates execution nor refreshes retention or quota.',
      '可选仅结果查询不分配执行、不刷新保留期及配额。',
      {
        scope: t(
          'Same actual session scope originally issued to claim.',
          '原认领取得的同一实际会话作用域。'
        ),
        key: t(
          'Same application-issued operation key passed to claim.',
          '原认领传入的相同应用操作键。'
        ),
        now: t(
          'Current monotonic milliseconds from the original claim clock.',
          '来自原认领时钟的当前单调毫秒。'
        )
      },
      t(
        'State pending, unknown, or done with the retained portable outcome; a legacy store lacking lookup cannot advertise outcome support.',
        '返回等待、未知或含保留可移植结果的完成状态，没有查询的旧存储不能声明结果查询支持。'
      ),
      idempotencyExample
    ),
    readRuntimeFacts: m(
      'Optional operation reports facts of this exact store incarnation; ordinary claims never create/read a store epoch.',
      '可选操作报告此精确存储实例事实，普通认领不创建或读取存储纪元。',
      {},
      t(
        'rpc-contract IRpcRuntimeStore facts; the built-in memory owner lazily issues an epoch and reports retained continuity.',
        '返回契约运行存储事实，内置内存所有者延迟签发纪元并报告保留连续性。'
      ),
      idempotencyExample
    )
  },
  idempotencyExample
)
types.IRpcIdempotencyConfig = typeDoc(
  'Provider replay policy reuses a real store and derives scopes only after verified admission.',
  '提供方重放策略复用真实存储，并只在已验证准入后派生作用域。',
  { store: factoryOptions['idempotency.store'], scope: factoryOptions['idempotency.scope'] },
  idempotencyExample
)
symbols.createRpcIdempotencyStore = {
  role: 'factory',
  purpose: t(
    'Creates a bounded in-memory execution/outcome store with post-settlement retention. Byte pressure evicts completed bodies while retaining execution tombstones, so missing bodies do not authorize re-execution.',
    '创建有界内存执行及结果存储，保留期从结算开始；字节压力淘汰完成结果体而保留执行墓碑，因此缺少结果体不授权再次执行。'
  ),
  optionDocs: Object.fromEntries(
    [
      [
        'retentionMs',
        300000,
        'Positive safe-integer milliseconds retained after settlement; pending execution does not expire by this policy.',
        '结算后保留的正安全整数毫秒，此策略不会使等待执行过期。'
      ],
      [
        'maxEntries',
        1024,
        'Positive safe-integer total original entry capacity.',
        '正安全整数原始条目总容量。'
      ],
      [
        'maxEntriesPerScope',
        256,
        'Positive safe-integer original entry capacity in each actual scope.',
        '每个实际作用域的正安全整数原始条目容量。'
      ],
      [
        'maxBytes',
        8388608,
        'Positive safe-integer total retained portable-outcome byte budget.',
        '已保留可移植结果的正安全整数字节总预算。'
      ],
      [
        'maxOutcomeBytes',
        1048576,
        'Positive safe-integer per-outcome retention budget; larger results leave an unavailable tombstone.',
        '逐结果正安全整数保留预算，超过预算时保留不可用墓碑。'
      ]
    ].map(([key, value, en, zh]) => [
      key,
      p(
        String(en),
        String(zh),
        t(
          'Default ' + value + '; invalid nonpositive or unsafe integers fail INVALID_CONFIG.',
          '默认 `' + value + '`，非正数或非安全整数以配置非法失败。'
        )
      )
    ])
  ),
  returns: t(
    'IRpcIdempotencyStore with no timers or dispose obligation; the session/provider owner controls scope/key admission.',
    '返回不拥有计时器及释放义务的幂等存储，由会话或提供方所有者控制作用域及键准入。'
  ),
  example: idempotencyExample
}
/** Public diagnostic error shapes do not acquire original live control identity by construction. */
const errorMembers: Record<string, IMemberDoc> = {
  source: p(
    'Stable source identifying the owner that originally created this error.',
    '标识原创建此错误所有者的稳定来源。'
  ),
  code: {
    ...p(
      'Original semantic code identifying the actual failure branch.',
      '标识实际失败分支的原语义码。'
    ),
    values: { enum: 'RpcCoreErrorCode' }
  },
  cause: p(
    'Exact original failure preserved on the cause chain when supplied.',
    '提供时在原因链保留的精确原失败。'
  ),
  cleanupErrors: p(
    'Original cleanup resource labels and exact failures without replacing the primary error.',
    '原清理资源标签及精确失败，不替换主要错误。'
  )
}
types.IRpcCleanupError = typeDoc(
  'One original resource cleanup failure kept alongside the primary construction/lifecycle failure.',
  '与主要构造或生命周期失败一起保留的一个原资源清理失败。',
  {
    resource: p(
      'Owner-issued resource label captured when the cleanup was registered.',
      '清理登记时所有者签发的资源标签。'
    ),
    error: p(
      'Exact original cleanup failure, preserving its reference and cause chain.',
      '保留引用及原因链的精确原清理失败。'
    )
  }
)
types.IRpcError = typeDoc(
  'Structural public error diagnostics; this type does not prove local execution/control ownership.',
  '结构公开错误诊断，此类型不证明本地执行或控制所有权。',
  { source: errorMembers.source, code: errorMembers.code, cause: errorMembers.cause }
)
types.IRpcCoreErrorCode = typeDoc(
  'One stable semantic value from RpcCoreErrorCode; source and code together identify its owning contract.',
  '稳定语义失败码中的一个值，来源及错误码共同标识所属契约。',
  {}
)
for (const name of [
  'RpcError',
  'RpcSchemaValidationError',
  'RpcConfigurationError',
  'RpcConstructionError',
  'RpcLifecycleError',
  'RpcSerializationError',
  'RpcProtocolError',
  'RpcContractError',
  'RpcTransportError',
  'RpcAuthenticationError',
  'RpcChunkError',
  'RpcRemoteError',
  'RpcAbortError',
  'RpcTimeoutError'
])
  types[name] = typeDoc(
    'Public diagnostic ' +
      name +
      ' type preserves native Error name/message/stack and original cause; only RpcLifecycleError is a runtime class exported from this entry.',
    '公开诊断错误类型保留原生错误名称、消息、堆栈及原原因，本入口只有生命周期错误类作为运行时类导出。',
    {
      ...errorMembers,
      ...(name === 'RpcLifecycleError'
        ? {
            errors: p(
              'Optional standard error graph retains every original cleanup failure in this batch; inspect it together with cause.',
              '可选标准错误图保留本批每项原清理失败，须结合原因链检查。'
            )
          }
        : {}),
      ...(['RpcSchemaValidationError', 'RpcRemoteError'].includes(name)
        ? {
            data: p(
              'Original public validation or remote failure detail.',
              '原公开校验或远端失败细节。'
            )
          }
        : {}),
      ...(['RpcConstructionError', 'RpcAbortError', 'RpcTimeoutError'].includes(name)
        ? {
            cleanupPromise: p(
              'Original asynchronous cleanup observation; an early primary rejection may precede its final cleanup evidence.',
              '原异步清理观察，较早主要拒绝可能先于最终清理证据。'
            )
          }
        : {}),
      ...(name === 'RpcRemoteError'
        ? {
            code: p(
              'Peer-selected remote code remains an unrestricted string and never grants local control rights.',
              '对端选择的远端码仍为不受限字符串，不赋予本地控制权限。'
            )
          }
        : {})
    },
    'try { await client.send("server", "echo", "hello") } catch (error) { console.error(error) }'
  )
symbols.RpcLifecycleError = {
  role: 'error',
  purpose: t(
    'Constructs a public lifecycle diagnostic with ENDPOINT_DISPOSED code and optional original cleanup evidence. Direct construction does not mint owner-only live control identity.',
    '构造带端点释放码及可选原清理证据的公开生命周期诊断，直接构造不签发所有者专属活动控制身份。'
  ),
  params: {
    message: t(
      'Application-owned diagnostic message for this actual lifecycle boundary.',
      '应用为此实际生命周期边界提供的诊断消息。'
    ),
    cause: t(
      'Optional exact original primary failure; omitted means no cause.',
      '可选精确原主要失败，省略表示没有原因。'
    ),
    cleanupErrors: t(
      'Optional original cleanup failures labelled by their owning resources.',
      '由所属资源标记的可选原清理失败。'
    )
  },
  returns: t(
    'Native RpcLifecycleError carrying original cause and cleanup references.',
    '返回携带原原因及清理引用的原生生命周期错误。'
  ),
  example:
    'const error = new RpcLifecycleError("Application endpoint closed"); console.log(error.code)'
}
for (const [name, en, zh] of [
  [
    'isRpcError',
    'Structurally recognizes a nonnull object with a string code; it does not validate source, known codes or local control identity.',
    '结构识别含字符串错误码的非空对象，不校验来源、已知码或本地控制身份。'
  ],
  [
    'isRpcErrorInstance',
    'Recognizes exact Core source, a known Core code and an accepted Core native family name; cross-realm equivalents are supported without granting control rights.',
    '识别精确核心来源、已知核心错误码及认可核心原生族名称，支持跨执行域等价诊断但不赋予控制权限。'
  ],
  [
    'isRpcRemoteError',
    'Recognizes Core source plus remote family name and any string remote code, preserving the unrestricted peer-selected code domain.',
    '识别核心来源、远端族名称及任意字符串远端码，保留不受限对端选择码域。'
  ],
  [
    'isRpcTimeoutError',
    'Recognizes exact Core source, timeout native family and DEADLINE_EXCEEDED code; copied diagnostics do not obtain owner decision authority.',
    '识别精确核心来源、超时原生族及截止超出码，复制诊断不取得所有者决策权限。'
  ]
] as const)
  operation(
    name,
    en,
    zh,
    {
      value: t(
        'Original unknown error received by the application; hostile diagnostic getters may throw PROPERTY_READ_FAILED.',
        '应用接收的原未知错误，恶意诊断读取器可抛属性读取失败。'
      )
    },
    t(
      'Boolean type guard for the documented diagnostic shape only.',
      '返回只针对所述诊断形态的布尔类型守卫。'
    ),
    `if (${name}(error)) console.log(error.code)`
  )
operation(
  'defaultRpcReporter',
  'Default background-failure sink writes the original failure to console.error. Explicit report callbacks receive the same original diagnostic events.',
  '默认后台失败接收器把原失败写入控制台错误输出，显式上报回调收到相同原诊断事件。',
  {
    error: t(
      'Original observed background failure retaining identity and cause.',
      '保留身份及原因的原已观察后台失败。'
    )
  },
  t(
    'Synchronous diagnostic write completes; no business result is produced.',
    '同步诊断写入完成，不产生业务结果。'
  ),
  'defaultRpcReporter(error)'
)
symbols.serializeRpcError = {
  ...contractReference.symbols.serializeRpcError,
  params: {
    value: t(
      'Original unknown held Core/Remote error or application throw value.',
      '原持有核心或远端错误，或应用抛出值。'
    ),
    options: t(
      'Required rpc-contract IRpcSerializeErrorOptions with synchronous original error reporter.',
      '必需契约错误序列化选项，包含同步原错误上报者。'
    )
  },
  options: undefined,
  optionDocs: contractReference.types.IRpcSerializeErrorOptions.members,
  purpose: t(
    'Serializes the original error through rpc-contract while retaining private Core/Remote redaction summaries and admitted forwarding routes; callers cannot supply that private metadata.',
    '经规范契约序列化原错误，同时保留核心及远端私有脱敏摘要及已准入转发路由，调用方不能提供该私有元数据。'
  )
}
symbols.deserializeRpcError = {
  ...contractReference.symbols.deserializeRpcError,
  params: {
    value: t(
      'Actual serialized wire error received from the original remote owner.',
      '从原远端所有者接收的实际线上序列化错误。'
    ),
    options: t(
      'Optional rpc-contract IRpcWireErrorOptions controlling unknown-field handling.',
      '控制未知字段处理的可选契约线上错误选项。'
    )
  },
  options: undefined,
  optionDocs: contractReference.types.IRpcWireErrorOptions.members,
  purpose: t(
    'Restores an actual serialized error through rpc-contract and retains its admitted route for subsequent original Core forwarding; received codes remain diagnostic data.',
    '经规范契约恢复实际序列化错误，并保留已准入路由供原核心后续转发，接收的码仍是诊断数据。'
  )
}
/** Transport constants form value unions without new runtime ownership. */
for (const [name, en, zh] of [
  [
    'IRpcPlatformValue',
    'One actual adapter platform label used for presentation and diagnostics.',
    '用于展示及诊断的一个实际适配器平台标签。'
  ],
  [
    'IRpcTransportTopologyValue',
    'One physical topology from RpcTransportTopology, without implied provenance.',
    '规范载体拓扑中的一个物理拓扑，不隐含来源身份。'
  ],
  [
    'IRpcTransportEncodingValue',
    'One actual accepted carrier encoding domain from RpcTransportEncoding.',
    '规范载体编码中的一个实际接受值域。'
  ],
  [
    'IRpcTransportOwnershipValue',
    'One physical cleanup responsibility from RpcTransportOwnership.',
    '规范载体所有权中的一个物理清理责任值。'
  ],
  [
    'IRpcOperation',
    'One original send, dispatch or ping operation category.',
    '原发送、派发或心跳操作类别之一。'
  ],
  [
    'IRpcCandidateStatus',
    'Actual discovery candidate activity classification, not a thrown error code.',
    '实际发现候选活动分类，不是抛出错误码。'
  ]
] as const)
  types[name] = typeDoc(en, zh, {})
types.IIpcGatedTransport = typeDoc(
  'Original physical transport with a readonly exact whole-envelope gate; the same native gate feature must be installed on its endpoint.',
  '带只读精确完整信封门控的原物理载体，同一端点须安装相同原生门控功能。',
  {
    ...transportMembers,
    ipcSendGate: p(
      'Exact gate returned by the paired queue installation, never a copied admission authority.',
      '对应队列安装返回的精确门控，不是复制的准入权限。'
    )
  }
)
/** All first-party composition examples use the actual canonical public root keys. */
const composedExample = `import { connect } from '@migaia/rpc-core'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature, createStreamFeature } from '@migaia/rpc-core/stream'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createProviderFeature } from '@migaia/rpc-core/features/provider'
import { createDiscoveryFeature } from '@migaia/rpc-core/features/discovery'
import { createControlFeature } from '@migaia/rpc-core/features/control'
import { createOneWayFeature } from '@migaia/rpc-core/features/one-way'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
function roots() {
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  const provider = createProviderFeature(outbound)
  const discovery = createDiscoveryFeature(outbound)
  return {
    'first-party-chunk': chunk,
    'first-party-outbound': outbound,
    'first-party-provider': provider,
    'first-party-discovery': discovery,
    'first-party-control': createControlFeature(outbound, discovery),
    'first-party-one-way': createOneWayFeature(outbound),
    'first-party-stream': createStreamFeature(outbound, provider)
  }
}
const [left, right] = createMemoryTransportPair()
const server = await createComposedEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] }, roots())
const client = await createComposedEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left })] }, roots())
const off = server.stream.provide('numbers', function* () { yield 1; yield 2 })
try { for await (const value of client.stream.open('server', 'numbers', null)) console.log(value) }
finally { off(); await client.dispose(); await server.dispose(); left.close() }`
/** Explicit one-way calls wait for physical send only and require the receiver's actual listener. */
const oneWayExample = `import { connect } from '@migaia/rpc-core'
import { createFullOneWayEndpoint } from '@migaia/rpc-core/full'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
const [left, right] = createMemoryTransportPair()
const server = await createFullOneWayEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })
const client = await createFullOneWayEndpoint({ id: 'client', transport: left, middlewares: [connect({ transport: left })] })
const off = server.on('changed', (context) => console.log(context.data))
try { await client.sendOneWay('server', 'changed', { count: 1 }) }
finally { off(); await client.dispose(); await server.dispose(); left.close() }`
/** Public surfaces are selected projections; dependencies do not widen them automatically. */
const selectEndpoint = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, endpointMembers[name]]))
types.IOutboundSurface = typeDoc(
  'Selected outbound projection contains requests, fanout, dispatch, group/outcome and local hooks without provider or discovery controls.',
  '所选出站投影包含请求、扇出、派发、分组结果及本地钩子，不包含提供方或发现控制。',
  selectEndpoint(['send', 'sendAll', 'dispatch', 'dispatchAll', 'group', 'outcome', 'hooks'])
)
types.IProviderRegistrationSurface = typeDoc(
  'Selected provider registration projection returns its own surface for chaining and owns one-way listener registration.',
  '所选提供方登记投影返回自身表面用于链式调用，并拥有单向监听登记。',
  selectEndpoint(['provide', 'on'])
)
types.IProviderSurface = typeDoc(
  'Provider preset includes its inseparable original outbound closure as well as provider/listener registration and disposal.',
  '提供方预设同时包含不可分离原出站闭包、提供方及监听登记和释放。',
  { ...types.IOutboundSurface.members, ...selectEndpoint(['provide', 'on', 'dispose']) }
)
types.IDiscoverySurface = typeDoc(
  'Selected discovery projection adds original connect/discovery controls without publishing private outbound dependency methods.',
  '所选发现投影添加原连接发现控制，不公开私有出站依赖方法。',
  selectEndpoint(['connect', 'discovery'])
)
types.IControlSurface = typeDoc(
  'Selected optional control projection contains announceClose and capability-dependent ping/pingAll from the original control owner.',
  '所选可选控制投影包含关闭宣告及依赖能力的单端全体心跳，均由原控制所有者提供。',
  selectEndpoint(['announceClose', 'ping', 'pingAll'])
)
types.IRpcOneWayOptions = typeDoc(
  'Explicit local send admission and physical transfer options; one-way deadlines never inherit the timeout middleware default.',
  '显式本地发送准入及物理转移选项，单向截止不继承超时中间件默认值。',
  {
    transfer,
    signal,
    timeoutMs: {
      ...timeoutMs,
      summary: t(
        'Optional finite nonnegative explicit physical-send deadline; false disables it, and omission does not inherit middleware policy.',
        '可选有限非负显式物理发送截止，假值关闭，省略不继承中间件策略。'
      ),
      default: t('Absent: physical send has no local deadline.', '默认物理发送没有本地截止。')
    }
  },
  oneWayExample
)
types.IOneWaySurface = typeDoc(
  'Explicit one-way endpoint projection retains original physical send settlement without a remote result waiter.',
  '显式单向端点投影保留原物理发送结算，不创建远端结果等待。',
  {
    sendOneWay: m(
      'Sends an application one-way message and waits for actual physical completion; pair with on at the receiving endpoint.',
      '发送应用单向消息并等待实际物理完成，接收端须搭配 `on` 登记监听。',
      {
        targetId,
        method,
        data: t(
          'Original application notification payload validated by the installed contract/codec.',
          '已安装契约及编解码验证的原应用通知载荷。'
        ),
        options: t(
          'Optional IRpcOneWayOptions with explicit local signal/deadline and actual transfer references.',
          '可选单向选项，含显式本地信号截止及实际转移引用。'
        )
      },
      t(
        'Promise<void> settles on physical send; it never confirms listener execution or a provider business result.',
        '承诺随物理发送结算，从不确认监听执行或提供方业务结果。'
      ),
      oneWayExample
    )
  },
  oneWayExample
)
types.IRpcStreamCapabilityPort = typeDoc(
  'Original connection owner answers whether the actual peer negotiated stream@1; method names cannot grant support.',
  '原连接所有者回答实际对端是否协商流第一版，方法名称不能赋予支持。',
  {
    supports: m(
      'Synchronously checks actual negotiated stream support for a real connected peer.',
      '同步检查真实连接对端实际协商的流支持。',
      {
        peerId: t(
          'Actual peer identifier returned by the original accepted connection owner.',
          '原已接受连接所有者返回的实际对端标识。'
        )
      },
      t(
        'True only for the actual peer whose accepted agreement includes stream@1.',
        '只有实际对端认可约定包含流第一版时为真。'
      ),
      composedExample
    )
  },
  composedExample
)
types.IRpcStreamRun = typeDoc(
  'Application producer receives original params and { signal, context }; returns an Iterable or AsyncIterable of portable values. Iteration failures become stream failure and cancellation closes the original iterator.',
  '应用生产者接收原参数及取消信号、调用上下文，返回可移植值同步或异步可迭代对象；迭代失败成为流失败，取消关闭原迭代器。',
  {},
  composedExample
)
types.IRpcStreamRuntime = typeDoc(
  'Optional original stream owner reuses outbound/provider execution and exposes async iteration only to consumers.',
  '可选原流所有者复用出站及提供方执行，只向消费方公开异步迭代。',
  {
    open: m(
      'Opens one original stream; pair with provide on the receiving stream owner and consume or close the iterator.',
      '打开一个原始流，须搭配接收流所有者的 `provide`，并消费或关闭迭代器。',
      {
        targetId,
        method,
        params: t(
          'Original application input passed to the actual registered IRpcStreamRun producer.',
          '传给实际已登记流生产者的原应用输入。'
        ),
        options: t(
          'Optional explicit local signal and finite nonnegative timeoutMs/false; producer lifetime remains owned by this stream.',
          '可选显式本地信号及有限非负超时或假值，生产者生命周期仍由此流拥有。'
        )
      },
      t(
        'AsyncIterableIterator of rpc-contract portable values; next/return/throw preserve original stream lifetime, late physical uncertainty fails STREAM_RESULT_UNKNOWN.',
        '返回可移植值异步迭代器，其迭代、返回及抛出保留原流生命周期，迟到物理不确定性以流结果未知失败。'
      ),
      composedExample
    ),
    provide: m(
      'Registers one original stream producer; duplicate methods reject PROVIDER_DUPLICATED.',
      '登记一个原流生产者，重复方法拒绝提供方重复错误。',
      {
        method,
        run: t(
          'Application callback receives params and {signal,context}, returns Iterable/AsyncIterable of portable values; throws and iterator rejections become contained stream failures.',
          '应用回调接收参数及信号、上下文，返回可移植值同步或异步迭代对象，抛错及迭代拒绝成为受控流失败。'
        )
      },
      t(
        'Idempotent unregistration removes only this original producer.',
        '返回幂等注销函数，只移除此原生产者。'
      ),
      composedExample
    ),
    dispose: m(
      'Closes this original stream runtime, cancels its owned active streams and removes its original providers.',
      '关闭此原流运行时，取消拥有的活动流并移除原提供方。',
      {},
      t(
        'Promise joins original stream cleanup; endpoint disposal also owns this same release.',
        '承诺加入原流清理，端点释放也拥有同一释放。'
      ),
      composedExample
    )
  },
  composedExample
)
types.IRpcStreamSurface = typeDoc(
  'Selected stream projection uses its own stream key to avoid collisions with scalar provide/dispose.',
  '所选流投影使用专属流键，避免与标量提供及释放冲突。',
  {
    stream: p(
      'Original IRpcStreamRuntime prepared from the selected stream feature.',
      '从所选流功能准备的原流运行时。'
    )
  },
  composedExample
)
/** Built-in features retain exact direct dependency tokens created for the same endpoint. */
for (const [name, en, zh, params, surface] of [
  [
    'createCanonicalChunkFeature',
    'Creates the original canonical chunk attachment token; allocation is deferred until the endpoint preparation scope owns it.',
    '创建原规范分片附件令牌，分配推迟到端点准备作用域取得所有权。',
    {},
    undefined
  ],
  [
    'createOutboundFeature',
    'Creates the original outbound execution capability over the same canonical chunk token; no I/O occurs before endpoint activation.',
    '在相同规范分片令牌上创建原出站执行能力，端点激活之前不执行读写。',
    {
      canonicalChunk: t(
        'Actual token returned by createCanonicalChunkFeature for this endpoint composition.',
        '此端点组合中规范分片工厂返回的实际令牌。'
      )
    },
    'IOutboundSurface'
  ],
  [
    'createProviderFeature',
    'Creates provider registration over its inseparable original outbound execution and inbound identity dependency.',
    '在不可分离原出站执行及入站身份依赖上创建提供方登记能力。',
    {
      outboundCapability: t(
        'Exact native token returned by createOutboundFeature for this same endpoint.',
        '此相同端点出站功能工厂返回的精确原生令牌。'
      )
    },
    'IProviderRegistrationSurface'
  ],
  [
    'createDiscoveryFeature',
    'Creates original discovery and receiver-selection controls over the same outbound owner; dependencies remain private.',
    '在同一出站所有者上创建原发现及接收端选择控制，依赖保持私有。',
    {
      outboundCapability: t(
        'Exact native token returned by createOutboundFeature for this same endpoint.',
        '此相同端点出站功能工厂返回的精确原生令牌。'
      )
    },
    'IDiscoverySurface'
  ],
  [
    'createControlFeature',
    'Creates original close/liveness control over exact outbound and discovery owners; ping remains conditional on actual middleware.',
    '在精确出站及发现所有者上创建原关闭存活控制，心跳仍取决于实际中间件。',
    {
      outboundCapability: t(
        'Exact original outbound token created for this composition.',
        '为此组合创建的精确原出站令牌。'
      ),
      discoveryCapability: t(
        'Exact createDiscoveryFeature token sharing that outbound owner.',
        '共享该出站所有者的精确发现功能令牌。'
      )
    },
    'IControlSurface'
  ],
  [
    'createOneWayFeature',
    'Creates explicit one-way physical-send settlement over the original outbound owner without allocating response waiters.',
    '在原出站所有者上创建显式单向物理发送结算，不分配响应等待。',
    {
      outboundCapability: t(
        'Exact original createOutboundFeature token for this endpoint.',
        '此端点精确原出站功能令牌。'
      )
    },
    'IOneWaySurface'
  ],
  [
    'createStreamFeature',
    'Creates optional streaming execution over the exact original outbound/provider owners and optional actual negotiated capability port.',
    '在精确原出站及提供方所有者和可选实际协商能力端口上创建流执行。',
    {
      outboundCapability: t(
        'Exact original outbound token used by the matching provider token.',
        '匹配提供方令牌使用的精确原出站令牌。'
      ),
      providerCapability: t(
        'Exact createProviderFeature token depending on that same outbound owner.',
        '依赖相同出站所有者的精确提供方功能令牌。'
      )
    },
    'IRpcStreamSurface'
  ]
] as const) {
  symbols[name] = {
    role: 'enhancer',
    purpose: t(en, zh),
    params,
    ...(name === 'createStreamFeature'
      ? {
          optionDocs: {
            capability: p(
              'Actual IRpcStreamCapabilityPort owned by the accepted connection; supports(peerId) synchronously returns actual negotiated stream availability.',
              '已接受连接拥有的实际流能力端口，同步支持查询返回实际协商流可用性。',
              t(
                'Absent: this original legacy stream composition is not restricted by an injected negotiation port.',
                '默认原传统流组合不受注入协商端口限制。'
              )
            )
          }
        }
      : {}),
    returns: t(
      'Genuine native IRpcFeature token; endpoint composition owns installation, rollback and final disposal.',
      '返回真实原生功能令牌，端点组合拥有安装、回滚及最终释放。'
    ),
    example: composedExample
  }
  enhancers[name] = {
    kind: 'feature',
    target: 'IRpcEndpoint',
    summary: t(en, zh),
    install: composedExample,
    grants: surface
      ? Object.entries(types[surface].members).map(([key, doc]) => ({
          ...doc,
          signature: 'endpoint.' + key
        }))
      : [],
    behaviors: [
      t(
        'Only explicitly selected public roots are projected; private dependency ownership is reused.',
        '只投影显式所选公开根，并复用私有依赖所有权。'
      )
    ],
    scenarios: [
      t(
        'Compose the exact endpoint execution capabilities the application needs.',
        '组合应用需要的精确端点执行能力。'
      )
    ],
    example: composedExample
  }
}
symbols.createComposedEndpoint = {
  ...symbols.createComposedEndpoint,
  params: {
    config: symbols.createComposedEndpoint.params!.config,
    firstPartyRoots: t(
      'Application finite record of actual native roots; built-in attachment roots use canonical first-party-* keys shown in the example. Dependencies remain original feature tokens.',
      '应用提供实际原生根有限记录，内置附件根使用示例所示规范键，依赖保留原功能令牌。'
    )
  },
  example: composedExample
}
/** Factory examples preserve each preset's actual selected surface. */
symbols.createClientEndpoint = {
  ...symbols.createClientEndpoint,
  example: endpointExample
    .replace(
      'import { createEndpoint, connect }',
      "import { createClientEndpoint } from '@migaia/rpc-core/client'\nimport { createEndpoint, connect }"
    )
    .replace('const client = await createEndpoint', 'const client = await createClientEndpoint')
}
symbols.createProviderEndpoint = {
  ...symbols.createProviderEndpoint,
  example: endpointExample
    .replace(
      'import { createEndpoint, connect }',
      "import { createProviderEndpoint } from '@migaia/rpc-core/provider'\nimport { createEndpoint, connect }"
    )
    .replace('const server = await createEndpoint', 'const server = await createProviderEndpoint')
}
symbols.createFullEndpoint = {
  ...symbols.createFullEndpoint,
  example: endpointExample
    .replace(
      "import { createEndpoint, connect } from '@migaia/rpc-core'",
      "import { createFullEndpoint } from '@migaia/rpc-core/full'\nimport { connect } from '@migaia/rpc-core'"
    )
    .replaceAll('createEndpoint', 'createFullEndpoint')
}
symbols.createFullOneWayEndpoint = { ...symbols.createFullOneWayEndpoint, example: oneWayExample }
types.createClientEndpoint = {
  ...types.IOutboundSurface,
  members: { ...types.IOutboundSurface.members, dispose: endpointMembers.dispose },
  example: symbols.createClientEndpoint.example
}
types.createProviderEndpoint = {
  ...types.IProviderSurface,
  surface: 'IProviderSurface',
  example: symbols.createProviderEndpoint.example
}
types.createFullOneWayEndpoint = {
  ...types.IRpcEndpoint,
  members: { ...endpointMembers, ...types.IOneWaySurface.members },
  example: oneWayExample
}
types.IPeerPairOptions = typeDoc(
  'Two real same-process runtime peer sides use the original memory carrier and canonical method/deadline/admission policy; no fake endpoint or scheduler is introduced.',
  '两个真实同进程运行对端使用原内存载体及规范方法、截止和准入策略，不引入伪端点或调度器。',
  {
    a: p(
      'Application first-side provide map plus optional defaultTimeoutMs, providerLimits and contract; provide must be an actual method map.',
      '应用第一端提供映射及可选默认超时、提供方限制和契约，提供配置须为实际方法映射。'
    ),
    b: p(
      'Application second-side provide map plus optional defaultTimeoutMs, providerLimits and contract; each side compiles its own actual offer.',
      '应用第二端提供映射及可选默认超时、提供方限制和契约，每端编译自身实际提议。'
    ),
    scheduler,
    report: p(
      'Application synchronous background failure sink receives original unknown errors; synchronous report or fallback throws remain observable through hostRethrowReporter without replacing the original operation result.',
      '应用同步后台失败接收器接收原未知错误；同步报告或回退抛错仍经规范宿主报告可观察，不替换原逻辑结果。',
      t(
        'defaultRpcReporter writes the original error to console.error.',
        '默认上报函数把原错误写入控制台错误输出。'
      )
    )
  },
  peerExample.replace('a: {}', 'a: { provide: {} }')
)
symbols.createPeerPair = {
  role: 'factory',
  purpose: t(
    'Constructs two genuine typed runtime peers over the reference memory carrier. Portable binary is restored inline; explicit transfer is unsupported and fails before detach. Failed pair construction closes successful peers and preserves the original failure.',
    '在参考内存载体上构造两个真实类型运行对端，可移植二进制以内联恢复，显式转移在分离前拒绝，构造失败关闭已成功对端并保留原失败。'
  ),
  options: 'IPeerPairOptions',
  returns: t(
    'Readonly {a,b} of IRuntimeTypedPeer; each side exposes the other provide type. Close both original peers when finished.',
    '返回含两端类型运行对端的只读对象，各端公开另一端提供类型，用完须关闭两个原对端。'
  ),
  example: peerExample.replace('a: {}', 'a: { provide: {} }')
}
/** Inline values avoid claiming external rpc-contract constants as Core exports. */
symbols.deserializeRpcError = {
  ...symbols.deserializeRpcError,
  optionDocs: {
    ...symbols.deserializeRpcError.optionDocs,
    unknownFields: {
      ...symbols.deserializeRpcError.optionDocs!.unknownFields,
      values: contractReference.enums.RpcWireErrorUnknownFieldMode.values
    }
  }
}
types.IRpcProviderRejection = {
  ...types.IRpcProviderRejection,
  members: {
    ...types.IRpcProviderRejection.members,
    reason: {
      ...types.IRpcProviderRejection.members.reason,
      values: { enum: 'RpcProviderRejectionReason' }
    }
  }
}
/** Root and preset module introductions name the first meaningful construction API. */
const modules: Record<string, ILibraryReference['modules'][string]> = {
  index: {
    summary: t(
      'Runtime-neutral native RPC endpoint construction starts with createEndpoint and connect; choose actual protocol, codec, framer and transport components or narrower presets. The curated user manifest selects common entry points; the full export reference also includes published advanced adapter and transport subpaths.',
      '运行时中立原生调用端点构造从端点工厂及连接中间件开始，选择实际协议、编解码、分帧及载体，或使用较小预设；用户索引选择常用入口，完整导出参考另含已发布的高级适配器及载体子入口。'
    ),
    example: endpointExample
  },
  client: {
    summary: t(
      'Choose this subpath when an endpoint only needs to call methods on another endpoint. `createClientEndpoint()` gives it sending methods and `dispose()` without adding provider registration or peer-discovery controls. The root `createEndpoint()` selects a fuller preset for two-way use. You still supply the transport and the middleware that connects it.',
      '端点只需要调用另一端的方法时，选择这个子路径。`createClientEndpoint()` 提供发送方法和 `dispose()`，不附带服务方法登记或对端发现控制。根入口的 `createEndpoint()` 则选择适合双向通信的完整预设。使用客户端预设时，仍需提供载体和负责连接的中间件。'
    ),
    example: symbols.createClientEndpoint.example
  },
  provider: {
    summary: t(
      'Choose this subpath when an endpoint must register methods for remote callers and may call back itself. `createProviderEndpoint()` supplies `provide()` and event registration together with sending methods and disposal. It keeps the sending capability because handling requests also requires replies and identity checks. The root full preset additionally selects discovery and control features.',
      '端点需要为远端登记可调用方法，并可能反向调用时，选择这个子路径。`createProviderEndpoint()` 同时提供 `provide()`、事件登记、发送方法和释放能力。处理请求本身也需要答复及身份核对，因此提供方预设保留发送能力。根入口的完整预设还会选中发现和控制功能。'
    ),
    example: symbols.createProviderEndpoint.example
  },
  full: {
    summary: t(
      'Use this entry to explicitly choose the standard two-way endpoint preset. `createFullEndpoint()` combines sending, handler registration, discovery and control; the root also exports it as `createEndpoint()`. `createFullOneWayEndpoint()` adds `sendOneWay()` when you need a promise for local sending without waiting for a reply. Transport and middleware are still supplied by the caller, and ping support depends on the middleware.',
      '需要明确选择标准双向端点预设时，使用这个入口。`createFullEndpoint()` 组合发送、处理函数登记、发现和控制能力，根入口也以 `createEndpoint()` 导出它。若需要等待本地发送完成而不等待远端答复，可用 `createFullOneWayEndpoint()` 增加 `sendOneWay()`。载体和中间件仍由调用方提供，心跳支持取决于所选中间件。'
    ),
    example: oneWayExample
  },
  composed: {
    summary: t(
      'Choose this entry when the endpoint presets do not match the capabilities you want to expose. `createComposedEndpoint()` builds an endpoint from the feature objects you select, such as sending, provider registration or streaming. Reuse the same dependency objects across related features so they share the same sending and connection state. The root `createEndpoint()` chooses the standard full preset for you instead.',
      '现有端点预设不符合所需能力组合时，选择这个入口。`createComposedEndpoint()` 按你提供的功能对象组装端点，例如发送、服务方法登记或流式结果。相关功能应复用同一组依赖对象，让它们共用发送和连接状态。根入口的 `createEndpoint()` 则替你选择标准完整预设。'
    ),
    example: composedExample
  },
  stream: {
    summary: t(
      'Use this entry when a composed endpoint must return a sequence of values instead of one result. `createCanonicalChunkFeature()` supplies shared message splitting and reassembly, while `createStreamFeature()` adds streaming over the same sending and provider features. Register a producer with `stream.provide()` and read values through the async iterator from `stream.open()`. The root endpoint preset does not automatically add this optional stream surface.',
      '自行组合的端点需要逐个返回一系列值，而不是只返回一个结果时，使用这个入口。`createCanonicalChunkFeature()` 提供共用的消息拆分与重组，`createStreamFeature()` 在同一组发送和提供方功能上增加流式调用。通过 `stream.provide()` 登记产生数据的函数，再用 `stream.open()` 返回的异步迭代器逐项读取。根入口的端点预设不会自动增加这组流式接口。'
    ),
    example: composedExample
  },
  testing: {
    summary: t(
      "Use this entry to exercise peer-to-peer calls inside one process without setting up a native communication channel. `createPeerPair()` builds two real peers over the memory transport and infers each side's remote methods from the other side's `provide` value. Close both peers when finished. Unlike the root endpoint factory, it creates both sides together; it does not prove behavior that depends on native ownership transfer.",
      '需要在一个进程内验证双端调用，又不想准备原生通信通道时，使用这个入口。`createPeerPair()` 在内存载体上创建两个真实对端，并根据各端的 `provide` 推导另一端可调用的方法。使用完后关闭两个对端。与根入口一次创建一个端点不同，它同时创建双端；不能用它证明依赖原生所有权转移的行为。'
    ),
    example: symbols.createPeerPair.example
  },
  'transport-constants': {
    summary: t(
      'Use this entry when an adapter or diagnostic tool needs the shared vocabulary for transport metadata. `RpcPlatform` identifies the communication mechanism, while `RpcTransportOwnership` states whether cleanup closes the resource or only releases borrowed access. The root re-exports these constants too; this subpath makes a metadata-only dependency explicit. Selecting a label does not create a transport or establish its capabilities.',
      '适配器或诊断工具需要使用一致的载体信息取值时，选择这个入口。`RpcPlatform` 标识通信方式，`RpcTransportOwnership` 则说明清理时应关闭资源，还是只释放对借用资源的使用。根入口也导出这些常量，子路径适合明确只依赖载体信息的代码。填写标签不会创建载体，也不能证明载体支持某种能力。'
    ),
    example: 'console.log(RpcPlatform.memory, RpcTransportOwnership.borrowed)'
  }
}
for (const [path, summary] of [
  [
    'control',
    t(
      'Use this entry to add liveness checks and close announcements to a composed endpoint. `createControlFeature()` takes the same sending and discovery feature objects used by that endpoint. It supplies controls such as `ping()` only with the corresponding middleware configured; selecting this feature does not make every control available. Choose the full preset when you want the standard combination.',
      '自行组合的端点需要检查对端是否可响应，或通知对端即将关闭时，使用这个入口。`createControlFeature()` 接收该端点共用的发送和发现功能对象。`ping()` 等控制仍需配置对应中间件，不能只靠选中此功能就启用全部控制。需要标准组合时，可直接选择完整端点预设。'
    )
  ],
  [
    'discovery',
    t(
      'Use this entry when a composed endpoint needs to find peers and select where calls go. `createDiscoveryFeature()` reuses the existing sending feature and adds the `connect` and `discovery` controls. These controls manage peer candidates; they are different from the root `connect()` middleware that wires a transport into an endpoint. The full preset already selects the discovery feature.',
      '自行组合的端点需要发现对端并选择调用去向时，使用这个入口。`createDiscoveryFeature()` 复用现有发送功能，增加 `connect` 和 `discovery` 控制接口。这些接口管理候选对端，与根入口中负责接入载体的 `connect()` 中间件不同。完整端点预设已经选中发现功能。'
    )
  ],
  [
    'one-way',
    t(
      'Use this subpath to add calls that do not wait for a remote reply to a composed endpoint. `createOneWayFeature()` takes the existing sending feature and adds `sendOneWay()`. Its promise tracks local physical sending, not completion of the remote handler. If you want the standard full endpoint with this extra method, use `createFullOneWayEndpoint()` from `full` instead.',
      '自行组合的端点需要发送不等待远端答复的调用时，使用这个子路径。`createOneWayFeature()` 接收现有发送功能，并增加 `sendOneWay()`。它返回的 `Promise` 反映本地实际发送的完成情况，不表示远端处理函数已完成。需要带此方法的标准完整端点时，可改用 `full` 中的 `createFullOneWayEndpoint()`。'
    )
  ],
  [
    'outbound',
    t(
      'Import this entry when assembling an endpoint that must send calls and receive their replies. `createOutboundFeature()` creates the sending feature from the feature that splits and reassembles messages for that endpoint. Pass the resulting object to other features that need to send, then select it in `createComposedEndpoint()` if its methods should be public. The client and full presets assemble this for you; creating the feature alone does not open a connection.',
      '自行组装需要发送调用并接收答复的端点时，导入这个入口。`createOutboundFeature()` 根据同一端点用于拆分和重组消息的功能对象创建发送功能。把返回对象交给其他需要发送的功能；若要公开发送方法，再通过 `createComposedEndpoint()` 选中它。客户端和完整预设会替你完成组装，单独创建功能对象不会打开连接。'
    )
  ],
  [
    'provider',
    t(
      'Use this entry when a composed endpoint must handle incoming calls. `createProviderFeature()` takes the shared sending feature and adds `provide()` for registering handlers. It reuses that sender to check incoming identities and return replies, so it does not create a separate connection. Choose the provider or full preset when you do not need to assemble these features yourself.',
      '自行组合的端点需要处理传入调用时，使用这个入口。`createProviderFeature()` 接收共用的发送功能，并提供用于登记处理函数的 `provide()`。它复用发送功能来核对传入身份和返回答复，不另建连接。不需要自行组合功能时，可直接选择提供方或完整端点预设。'
    )
  ]
] as const)
  modules['features/' + path] = { summary, example: composedExample }
/**
 * Middleware examples actually install their specific definition before exercising endpoint
 * behavior.
 */
const middlewareExamples: Record<string, string> = { connect: endpointExample }
for (const [name, expression, imports, preamble] of [
  ['contract', 'contract({ version: "1.0.0" })', '', ''],
  ['timeout', 'timeout({ timeoutMs: 1000 })', '', ''],
  ['hooks', 'hooks({ listeners: (event) => console.log(event.name) })', '', ''],
  ['abort', 'abort()', '', ''],
  ['ping', 'ping()', '', ''],
  [
    'uuid',
    'uuid({ generate: (context) => `${context.senderId}-${context.variation}-${++sequence}` })',
    '',
    'let sequence = 0\n'
  ],
  [
    'protocol',
    'protocol(rpcProtocolV1)',
    "import { rpcProtocolV1 } from '@migaia/rpc-contract'\n",
    ''
  ],
  [
    'codec',
    'codec(identityCodecV1)',
    "import { identityCodecV1 } from '@migaia/serialize/codec'\n",
    ''
  ],
  [
    'framer',
    'framer(messageFramerV1)',
    "import { messageFramerV1 } from '@migaia/rpc-contract/framing'\n",
    ''
  ]
] as const) {
  let example = endpointExample
    .replace('createEndpoint, connect }', 'createEndpoint, connect, ' + name + ' }')
    .replace('const [left, right]', imports + preamble + 'const [left, right]')
    .replaceAll('connect({ transport: right })', 'connect({ transport: right }), ' + expression)
    .replaceAll('connect({ transport: left })', 'connect({ transport: left }), ' + expression)
  if (name === 'ping')
    example = example.replace(
      "console.log(await client.send('server', 'echo', 'hello'))",
      "console.log(await client.ping('server')); console.log(await client.pingAll())"
    )
  middlewareExamples[name] = example
}
middlewareExamples.authentication = `import { createEndpoint, connect, authentication, type IRpcAuthenticationConfig } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
async function echoWithProtection(config: IRpcAuthenticationConfig) {
  const [left, right] = createMemoryTransportPair()
  const server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right }), authentication(config)] })
  server.provide('echo', (context) => context.success(context.data))
  const client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [connect({ transport: left }), authentication(config)] })
  try { return await client.send('server', 'echo', 'hello') }
  finally { await client.dispose(); await server.dispose(); left.close() }
}`
for (const [name, example] of Object.entries(middlewareExamples)) {
  symbols[name] = { ...symbols[name], example }
  enhancers[name] = { ...enhancers[name], install: example, example }
  if (symbols[name].options)
    types[symbols[name].options!] = { ...types[symbols[name].options!], example }
}
types.IRpcTimeoutConfig = {
  ...types.IRpcTimeoutConfig,
  members: {
    timeoutMs: {
      ...timeoutMs,
      summary: t(
        'Optional finite nonnegative default deadline in milliseconds; false disables local default deadlines.',
        '可选有限非负默认毫秒截止，假值关闭本地默认截止。'
      ),
      default: t('Absent: no default local deadline is installed.', '默认不安装本地默认截止。')
    }
  }
}
endpointMembers.ping = { ...endpointMembers.ping, example: middlewareExamples.ping }
endpointMembers.pingAll = { ...endpointMembers.pingAll, example: middlewareExamples.ping }
types.IControlSurface = {
  ...types.IControlSurface,
  members: {
    ...types.IControlSurface.members,
    ping: endpointMembers.ping,
    pingAll: endpointMembers.pingAll
  }
}
types.IRpcPingEndpointSurface = {
  ...types.IRpcPingEndpointSurface,
  members: { ping: endpointMembers.ping, pingAll: endpointMembers.pingAll }
}
enhancers.ping = {
  ...enhancers.ping,
  grants: ['ping', 'pingAll'].map((name) => ({
    ...endpointMembers[name],
    signature: 'endpoint.' + name + '(targetId)'
  }))
}
/** Error roundtrips use only the two parameters actually exported by Core. */
const errorRoundtrip = `import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-core'
const original = new Error('Application failure')
const wire = serializeRpcError(original, { report: (error) => console.error(error) })
const restored = deserializeRpcError(wire)
console.log(restored.message)`
symbols.serializeRpcError = { ...symbols.serializeRpcError, example: errorRoundtrip }
symbols.deserializeRpcError = { ...symbols.deserializeRpcError, example: errorRoundtrip }
/** Documentation object remains unregistered until every node passes its audit. */
export const reference: ILibraryReference = {
  modules: {
    ...modules,
    ...observationReference.modules,
    ...transportReference.modules,
    ...remoteReference.modules,
    ...kitReference.modules
  },
  symbols: {
    ...symbols,
    ...observationReference.symbols,
    ...transportReference.symbols,
    ...remoteReference.symbols,
    ...kitReference.symbols
  },
  types: {
    ...types,
    ...observationReference.types,
    ...transportReference.types,
    ...remoteReference.types,
    ...kitReference.types
  },
  enums: {
    ...enums,
    ...observationReference.enums,
    ...remoteReference.enums,
    ...kitReference.enums
  },
  enhancers: {
    ...enhancers,
    ...observationReference.enhancers,
    ...transportReference.enhancers,
    ...remoteReference.enhancers,
    ...kitReference.enhancers
  }
}
