/**
 * Remote reference verified against packages/rpc-core/src/remote on 2026-10-17. V1 remote contracts
 * and V2 runtime directories remain separate protocols. Coroutine parent tasks own cooperative
 * units; their opaque child connections confer no execution ownership. Source facts:
 * sameRemoteContract compares JSON strings and therefore expects normalized inputs; a direct
 * runtime Peer does not consume the inherited keyFactory/retryPort fields itself.
 */
import type {
  ILibraryReference,
  IMemberDoc,
  IText,
  ITypeDoc,
  ISymbolDoc,
  IEnumDoc
} from './contract.js'
import {
  runtimePeerOptionMembers,
  runtimePluginOptionMembers,
  runtimeSharedTypes,
  runtimeEventEnum,
  runtimeEventSymbol
} from './rpc-runtime-shared.js'
import { authenticationOptionMembers } from './rpc-core-auth.js'
import { reference as supervisionReference } from './supervision.js'

/** Explicit prose in both site languages. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Property documentation may specify the consequence of omission. */
const p = (en: string, zh: string, fallback?: IText): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Method documentation keeps completion and a concrete call together. */
const m = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Alias documentation points to its actual owning protocol. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })
/** An operation always documents its actual input, output and example. */
const op = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): ISymbolDoc => ({ role: 'operation', purpose: t(en, zh), params, returns, example })
/** Application contract reused in parsing and remote installation examples. */
const contractExample = `const contract = normalizeRemoteContract({
  schemaVersion: 1,
  plugin: 'math',
  features: { calc: { methods: { double: { mode: 'request', idempotent: true } } } }
})`
/** A source is an application adapter returning the negotiated channel described below. */
const peerExample = `const peer = await createRuntimePeer({
  connect: async (context) => openNegotiatedChannel(context),
  provide: { echo: (text: string) => text }
})
try { console.log(await peer.request('math.double', 21)) }
finally { await peer.close() }`
/** Both coroutine halves install through their actual Host owners. */
const coroutineExample = `import { defineHost } from '@migaia/plugin-host'
import { createCoroutinePlugin } from '@migaia/rpc-core/remote'
const service = createCoroutinePlugin({
  name: 'math',
  task: async ({ connect, signal }) => {
    const parent = createCoroutinePlugin({ name: 'parent', connect, provide: { double: (value: number) => value * 2 } })
    const child = defineHost<Record<string, never>, never, readonly [typeof parent]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
    try {
      await child.use(parent)
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    } finally { await child.dispose() }
  }
})
const host = defineHost<Record<string, never>, never, readonly [typeof service]>({ host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } } })
try { await host.use(service); console.log(await host.coroutine!.request('math', 'double', 21)) }
finally { await host.dispose() }`
/** A remote Host uses the same generation binding and endpoint factory as plugin mode. */
const hostExample = `${contractExample}
const catalog = normalizeRemoteHostCatalog({ math: contract })
const remote = createRemoteHost({ catalog, binding, endpointFactory, report: error => console.error(error) })
try {
  await remote.ready()
  const features = await remote.use('math')
  console.log(await features.calc!.double!(21))
  console.log(await remote.inspect())
  await remote.unUse('math')
} finally { await remote.release() }`
/** Remote callback errors must reach the actual application diagnostic owner. */
const report = m(
  'Reports background or secondary cleanup failures synchronously; a thrown reporter failure follows the owner fallback.',
  '同步报告后台或次要清理失败；报告函数抛错时由拥有者的后备路径处理。',
  { error: t('Original background failure.', '原始后台失败值。') },
  t('No result is consumed.', '不消费返回值，诊断已交给应用。'),
  `report(error)`
)
/** Generation binding supplied by the platform adapter. */
const binding = p(
  'Actual platform binding supplying supervision, clock, channel acquisition and explicit execution ownership.',
  '平台适配器提供的真实绑定，包含监督、时钟、通道获取与显式执行所有权。'
)
/** Endpoint construction belongs to the channel consumer, never a guessed default codec. */
const endpointFactory = m(
  'Constructs the served endpoint from the complete channel and native cancellation signal; install its features in the same batch.',
  '从完整通道与原生取消信号构造服务端点，须在同批构造中安装通道特性。',
  {
    channel: t(
      'Channel returned by the binding openChannel operation.',
      '绑定的 `openChannel()` 返回的通道。'
    ),
    signal: t(
      'Native signal issued for this generation preparation.',
      '本次代次准备签发的原生取消信号。'
    )
  },
  t(
    'Promise of endpoint, optional one-way surface and stream runtime; failure rolls construction back.',
    '返回端点及可选单向、流式能力的承诺；失败会触发构造回滚。'
  ),
  `const served = await endpointFactory(channel, signal)`
)
/** Shared proxy inputs do not imply a platform or duplicate a generation owner. */
const proxyMembers: Readonly<Record<string, IMemberDoc>> = {
  contract: p(
    'Normalized plugin contract or Host catalog returned by the remote normalizers.',
    '远程规范化函数返回的插件契约或宿主目录。'
  ),
  binding,
  endpointFactory,
  report,
  keyFactory: p(
    'Synchronous application key factory used for automatically keyed idempotent requests.',
    '同步应用键工厂，为自动分配键的幂等请求返回字符串。',
    t('Omitted: use defaultRpcId.', '省略时使用默认远程标识工厂。')
  ),
  retryPort: p(
    'Application retry dispatcher replacing the entire original retry dispatch operation.',
    '应用重试派发端口，整体替换原有重试派发操作。',
    t(
      'Omitted: create the canonical retry port from binding events, scheduler and report.',
      '省略时从绑定事件、调度器及报告函数创建规范重试端口。'
    )
  ),
  callDeadlineCapMs: p(
    'Optional positive finite platform ceiling on a logical call deadline, in milliseconds.',
    '平台对逻辑调用截止时间施加的可选正有限毫秒上限。',
    t('Omitted: no additional platform deadline ceiling.', '省略时不额外施加平台截止上限。')
  ),
  callGuard: p(
    'Optional synchronous pre-dispatch admission guard, after validation and before selecting a generation.',
    '可选同步派发前接纳检查，在校验后、选取代次前执行。',
    t('Omitted: no extra admission guard.', '省略时不增加额外接纳检查。')
  )
}
/** Automatic key generation runs synchronously before the request dispatch. */
;(proxyMembers as Record<string, IMemberDoc>).keyFactory = {
  ...proxyMembers.keyFactory!,
  params: {},
  returns: t(
    'A string logical key; a thrown factory failure rejects that request before sending.',
    '返回字符串逻辑键；工厂抛错会在发送前拒绝该请求。'
  )
}
/** Direct Core sources must return genuine negotiated resources. */
const sourceMembers: Readonly<Record<string, IMemberDoc>> = {
  ...runtimePeerOptionMembers,
  ...Object.fromEntries(
    Object.entries(authenticationOptionMembers).map(([key, value]) => [
      `authentication.${key}`,
      value
    ])
  ),
  spawn: p(
    'Application source callback receiving the safe local identity and capability offer; choose exactly one source.',
    '应用来源回调接收安全本端身份及能力提议；只能选择一种来源。',
    t(
      'No execution unit is launched through spawn when this field is absent.',
      '省略时不选择启动来源。'
    )
  ),
  connect: p(
    'Application source callback opening a channel to an existing peer; choose exactly one source.',
    '应用来源回调打开通往已有对端的通道；只能选择一种来源。',
    t('No outgoing connection is opened through connect when omitted.', '省略时不选择连接来源。')
  ),
  listen: p(
    'Application source callback accepting a negotiated peer channel; choose exactly one source.',
    '应用来源回调接受协商后的对端通道；只能选择一种来源。',
    t('Without listen, the Peer does not accept incoming connections.', '省略时不选择监听来源。')
  )
}
/** Source callbacks receive only safe preparation facts and must return a complete channel. */
for (const name of ['spawn', 'connect', 'listen']) {
  const original = sourceMembers[name]!
  ;(sourceMembers as Record<string, IMemberDoc>)[name] = {
    ...original,
    params: {
      context: t(
        'IRuntimePeerSourceContext from this preparation, containing its self identity and actual offered capabilities; no public abort signal is added to this context.',
        '本次准备提供的来源上下文，含本端身份与实际提议能力，不向此公开上下文额外添加中止信号。'
      )
    },
    returns: t(
      'Promise of a complete IRuntimePeerSourceResult with agreed pipeline and features; failure rejects construction and rolls back resources already acquired.',
      '返回完整来源结果的承诺，包含已约定管线与特性；失败拒绝构造，并回滚已经取得的资源。'
    )
  }
}
/** Runtime plugins additionally admit an explicit Host exposure whitelist. */
const pluginMembers = { ...sourceMembers, ...runtimePluginOptionMembers }
/** Parent and child fields are exclusive; never-valued fields forbid the opposite mode. */
const coroutineMembers: Readonly<Record<string, IMemberDoc>> = {
  ...Object.fromEntries(
    Object.entries(pluginMembers).filter(([name]) => name !== 'spawn' && name !== 'listen')
  ),
  task: p(
    'Parent-only task callback receiving signal, heartbeat and the opaque child connect token; task settlement is unit exit and rejection retains its cause.',
    '仅父模式提供的任务回调，接收取消信号、心跳与不透明子连接令牌；任务结束即执行单元退出，拒绝保留原始原因。',
    t(
      'Omitted only in child mode, which requires connect.',
      '仅子模式省略，此时必须提供子连接令牌。'
    )
  ),
  connect: p(
    'Child-only token supplied by the current parent task context; arbitrary objects and tokens from other ownership paths are rejected.',
    '仅子模式接收当前父任务上下文提供的令牌；任意对象及其他所有权路径的令牌会被拒绝。',
    t('Omitted only in parent mode, which requires task.', '仅父模式省略，此时必须提供任务回调。')
  ),
  supervisor: p(
    'Parent-only policy selecting existing coroutine restart, startup, stop, heartbeat and budget behavior.',
    '仅父模式使用的策略，选择现有协程重启、启动、停止、心跳与预算行为。',
    t(
      'Omitted: use supervision defaults and a one-unit coroutine budget.',
      '省略时使用监督默认策略和单执行单元协程预算。'
    )
  )
}
/** The task callback owns cooperative work; neither its result nor an async return is a child port. */
;(coroutineMembers as Record<string, IMemberDoc>).task = {
  ...coroutineMembers.task!,
  params: {
    context: t(
      'ICoroutineTaskContext from the original supervisor: native signal, heartbeat() and the opaque connect token to pass into the child plugin.',
      '原监督器提供的任务上下文，含原生信号、心跳方法与交给子插件的不透明连接令牌。'
    )
  },
  returns: t(
    'Void or PromiseLike<unknown>; settlement ends the task generation. Rejection records the original task failure and restart follows the selected supervisor policy.',
    '返回空值或可等待结果；结果确定即结束任务代次，拒绝记录原始任务失败，是否重启由所选监督策略决定。'
  )
}
/** Local call controls are separate from business payloads. */
const callMembers: Readonly<Record<string, IMemberDoc>> = {
  signal: p(
    'Caller-owned signal cancelling the logical call, preserving the actual abort reason.',
    '调用方持有的信号，用于取消逻辑调用并保留实际取消原因。',
    t('Omitted: no caller cancellation signal.', '省略时不附加调用方取消信号。')
  ),
  timeoutMs: p(
    'Caller-selected finite nonnegative local call budget in milliseconds.',
    '调用方选择的有限非负本地调用毫秒预算。',
    t('Omitted: inherit the actual dispatch owner default.', '省略时继承实际派发拥有者的默认预算。')
  ),
  idempotencyKey: p(
    'Application-issued key identifying the same logical operation across retries; use the original key for reconciliation.',
    '应用为同一逻辑操作签发的键，重试时保持一致，核对结果时使用原键。',
    t(
      'Omitted: automatic keys are generated only for declared idempotent requests.',
      '省略时仅为声明幂等的请求自动生成键。'
    )
  ),
  orderKey: p(
    'Application-selected lane key grouping calls for provider-wide ordered admission in the runtime profile.',
    '应用选择的通道键，在运行时协议中将调用归入提供方统一有序接纳队列。',
    t('Omitted: no ordered lane is requested.', '省略时不请求有序接纳通道。')
  ),
  cancel: {
    ...p(
      'Cancellation intent evaluated by the final provider start boundary.',
      '由最终提供方开始执行边界判断的取消意图。',
      t('Omitted: no before-start cancellation intent.', '省略时不请求开始前取消。')
    ),
    values: {
      'before-start': t(
        'Permit cancellation before the provider starts the invocation.',
        '允许在提供方开始执行调用之前取消。'
      )
    }
  }
}
/** Shared dynamic Peer methods, with direct-call parameter names rather than typed rest tuples. */
const peerMembers: Readonly<Record<string, IMemberDoc>> = {
  ...runtimeSharedTypes.IRuntimeTypedPeer!.members,
  ...Object.fromEntries(
    ['request', 'notify', 'stream'].map((name) => [
      name,
      {
        ...runtimeSharedTypes.IRuntimeTypedPeer!.members![name]!,
        params: {
          method: t(
            'Dotted path from the accepted remote provide directory.',
            '已接受远端方法目录中的点分路径。'
          ),
          payload: t(
            'Single application payload accepted by that method; omit for a parameterless method.',
            '该方法接受的单个应用负载；无参数方法可省略。'
          ),
          options: t(
            'Local controls from IRuntimeCallOptions, separate from the payload.',
            '来自 `IRuntimeCallOptions` 的本地控制设置，与业务负载分开。'
          )
        }
      }
    ])
  )
}
/** Complete remote channel fields shared with the cold-receive source result. */
const channelMembers: Readonly<Record<string, IMemberDoc>> = {
  transport: p(
    'Original physical transport supplied by the platform channel owner.',
    '平台通道拥有者提供的原始物理传输。'
  ),
  peerId: p(
    'Remote endpoint identifier established by handshake or trusted platform bootstrap.',
    '由握手或受信平台启动过程确定的远端端点标识。'
  ),
  scheduler: p(
    'Monotonic clock and timers shared with the platform binding.',
    '与平台绑定共用的单调时钟和计时器。'
  ),
  agreement: p(
    'Accepted negotiated or explicitly static codec and capability agreement.',
    '已接受的协商结果或显式静态编解码与能力约定。'
  ),
  pipeline: p(
    'Actual codec and framer selected by that agreement.',
    '由该约定选定的实际编解码器与帧处理器。'
  ),
  features: p(
    'Endpoint features that must be installed in its initial construction batch.',
    '必须在端点首次构造批次中安装的特性。'
  ),
  close: m(
    'Releases the channel-owned physical resources after endpoint teardown.',
    '端点清理后释放通道拥有的物理资源。',
    {},
    t(
      'Promise completing channel cleanup; ownership and repeat-call semantics belong to the concrete channel.',
      '返回通道清理承诺，所有权及重复调用语义由具体通道决定。'
    ),
    `await channel.close()`
  )
}
/** Runtime const domains have one explanation per real choice. */
const enums: Record<string, IEnumDoc> = {
  RuntimeEventName: runtimeEventEnum,
  RemoteMethodMode: {
    summary: t(
      'Declared V1 method invocation modes.',
      '第一版契约声明的方法调用模式，决定结果、单向交付或迭代器消费方式。'
    ),
    values: {
      request: t(
        'Await one scalar portable result; only this mode may declare idempotency.',
        '等待单个可移植标量结果，只有此模式可声明幂等。'
      ),
      oneWay: t('Send without waiting for a method result.', '发送后不等待方法返回结果。'),
      generator: t(
        'Consume items from a synchronous iterator over the stream protocol.',
        '通过流式协议消费同步迭代器的元素。'
      ),
      asyncGenerator: t(
        'Consume items from an asynchronous iterator over the stream protocol.',
        '通过流式协议消费异步迭代器的元素。'
      )
    }
  },
  RuntimeApiMode: {
    summary: t(
      'Actual installed V2 runtime call routes.',
      '第二版运行时实际安装的调用路由模式，由真实安装能力确定可用操作。'
    ),
    values: {
      request: t('Request one portable scalar result.', '请求并等待单个可移植结果。'),
      notify: t('Dispatch without a result.', '派发后不等待返回结果。'),
      stream: t('Read an asynchronous item sequence.', '读取异步产出的元素序列。')
    }
  },
  RuntimeSourceKind: {
    summary: t(
      'Local connection source selection.',
      '本端连接来源的选择方式，分别对应启动、主动连接或接受连接。'
    ),
    values: {
      spawn: t(
        'Classify this as the spawning source; actual execution ownership comes from its platform adapter, not the label.',
        '将此来源归类为启动，实际执行所有权来自平台适配器，不由标签授予。'
      ),
      connect: t('Source dials an existing peer.', '来源主动连接到已有对端。'),
      listen: t('Source accepts an incoming peer connection.', '来源接受一个对端连接。')
    }
  },
  RuntimeConnectionDirection: {
    summary: t(
      'Who established the physical connection.',
      '记录物理连接由哪一方建立，区分父端启动、子端回连与连接接纳。'
    ),
    values: {
      spawned: t('This side started the unit.', '本端启动对端执行单元。'),
      spawnedBy: t('This side was started by its parent.', '本端由其父端启动并回连。'),
      connect: t('This side initiated connection.', '本端主动建立对端连接。'),
      listen: t('This side accepted connection.', '本端接受外部传入的连接。')
    }
  },
  RuntimePluginKey: {
    summary: t(
      'Canonical runtime outlet names; labels grant no execution ownership.',
      '规范运行时出口名称，标签本身不授予执行所有权。'
    ),
    values: {
      process: t('Canonical outlet for process connections.', '进程连接使用的规范出口。'),
      thread: t('Canonical outlet for thread connections.', '线程连接使用的规范出口。'),
      coroutine: t('Cooperative coroutine outlet.', '协作式协程使用的出口。')
    }
  },
  RuntimeQueryStatus: {
    summary: t(
      'Observed connection or metric availability.',
      '观察到的连接状态或指标可用性，无法观察时明确返回不可用事实。'
    ),
    values: {
      unavailable: t('The owner cannot observe this fact.', '拥有者无法观察此项事实。'),
      ready: t('The accepted connection is ready.', '已接受的连接处于就绪状态。'),
      closed: t('The logical connection has closed.', '所查询的逻辑连接已经关闭。'),
      departed: t('The selected generation left.', '本次查询选定的代次已经离开。')
    }
  },
  RemoteMethodName: {
    summary: t(
      'Reserved remote control routes, excluded from application methods.',
      '保留的远程控制路由，应用方法不得占用，目录与宿主控制使用这些固定名称。'
    ),
    values: {
      runtimeDescribe: t('Read the accepted runtime directory.', '读取已接受的运行时目录。'),
      runtimeStreamPrefix: t('Prefix for internal stream routes.', '内部流式路由使用的前缀。'),
      runtimeNamespace: t(
        'Reserved namespace excluding automatic provide paths.',
        '自动提供方法不得占用的保留命名空间。'
      ),
      hostUse: t('Install or adopt a catalog plugin.', '安装或接纳目录中的插件。'),
      hostUnUse: t('Remove a plugin adopted by this connection.', '移除本连接已经接纳的插件。'),
      hostInspect: t('Inspect adopted remote Host state.', '检查已接纳的远程宿主状态。')
    }
  },
  RpcRemoteLayerErrorCode: {
    summary: t(
      'Stable remote-layer errors and caller recovery actions.',
      '稳定的远程层错误及调用方恢复方式，区分契约错误、未接纳与结果未知。'
    ),
    values: {
      runtimeEventOverflow: t(
        'More than 100 unread passive events; query current state and resubscribe.',
        '被动事件未读数量超过一百，应查询当前状态后重新订阅。'
      ),
      contractInvalid: t(
        'Description or control payload is invalid; correct it before retry.',
        '描述或控制负载不合法，修正后再重试。'
      ),
      hostNotAdopted: t(
        'This connection lacks live adoption; perform host use before removal.',
        '本连接尚未接纳当前登记，移除前先执行宿主安装接纳。'
      ),
      startFailed: t(
        'Unit preparation or channel acquisition failed; inspect the cause.',
        '执行单元准备或通道获取失败，应检查原始原因。'
      ),
      closed: t(
        'Registration was released or generation left; wait for valid readiness.',
        '登记已释放或代次已离开，应等待有效就绪状态。'
      ),
      resultUnknown: t(
        'A sent request lost its result after departure; reconcile before repeating a non-idempotent operation.',
        '已发送请求在离开后丢失结果，应先核对再重复非幂等操作。'
      )
    }
  }
}

/** Runtime and legacy remote types retain their distinct ownership and invocation contracts. */
const types: Record<string, ITypeDoc> = {
  ...runtimeSharedTypes,
  IRemoteContract: {
    summary: t(
      'Normalized frozen V1 plugin description, admitted before publishing remote routes.',
      '发布远程路由前接纳的第一版冻结插件描述。'
    ),
    members: {
      schemaVersion: {
        ...p(
          'Exactly schema version 1; V2 runtime directories use a different schema.',
          '固定为第一版模式，第二版运行时目录使用独立模式。'
        ),
        values: { '1': t('V1 explicit plugin contract.', '第一版显式插件契约。') }
      },
      plugin: p(
        'Plugin name authored by the application: ASCII letter followed by up to 39 letters, digits, underscores or hyphens.',
        '应用编写的插件名：以字母开头，后接最多三十九个字母、数字、下划线或连字符。'
      ),
      features: p(
        'Nonempty feature table; each feature owns a nonempty method table.',
        '非空特性表，每个特性拥有非空方法表。'
      )
    }
  },
  IRemoteFeatureContract: {
    summary: t(
      'One declared feature and its nonempty method table.',
      '一个已声明特性及其非空方法表。'
    ),
    members: {
      methods: p(
        'Application method names mapped to explicit invocation mode and idempotency declarations.',
        '应用方法名到显式调用模式与幂等声明的映射。'
      )
    }
  },
  IRemoteMethodContract: {
    summary: t(
      'Explicit mode and retry eligibility for one V1 method.',
      '单个第一版方法的显式模式与重试资格。'
    ),
    members: {
      mode: {
        ...p(
          'Select the actual callable mode of the provided method.',
          '选择实际提供方法的调用模式。'
        ),
        values: { enum: 'RemoteMethodMode' }
      },
      idempotent: p(
        'Whether replaying a request is safe; must be false for one-way or iterator methods.',
        '重放请求是否安全，单向或迭代器方法必须为假。'
      )
    }
  },
  IRemoteHostCatalog: alias(
    'Frozen name-to-contract map; each key equals its contract plugin name.',
    '冻结的名称到契约映射，每个键必须等于对应契约的插件名。'
  ),
  IRemoteControlDefinition: alias(
    'One of describePlugin, describeHost, hostUseParams, hostUseResult, hostUnUseParams, hostUnUseResult, hostInspectParams or hostInspectResult, selecting the exact reserved description/control grammar.',
    '选择插件描述、宿主描述，或宿主安装、移除、检查的输入及结果形式，精确校验对应保留描述或控制语法。'
  ),
  IRemoteEndpointFactory: alias(
    'Async callback receiving the actual IRemoteChannel and native preparation signal; returns IRemoteServeEndpoint and must install the supplied channel features together.',
    '异步回调接收实际 `IRemoteChannel` 及原生准备信号，返回 `IRemoteServeEndpoint`，须同时安装通道提供的特性。'
  ),
  IRemoteChannel: {
    summary: t(
      'Negotiated channel held for one generation and owned by its supplied close operation.',
      '为单个代次持有的协商通道，由其提供的关闭操作拥有。'
    ),
    scenarios: [
      t(
        'Assemble an endpoint on the codec and framer selected by the platform.',
        '使用平台选定的编解码器与帧处理器组装端点。'
      )
    ],
    example: `const served = await endpointFactory(channel, signal)
await served.endpoint.dispose()
await channel.close()`,
    members: channelMembers
  },
  IRemoteBinding: {
    summary: t(
      'Platform-owned bridge between an actual supervisor unit and its remote channel.',
      '实际监督执行单元与远程通道之间的平台绑定。'
    ),
    members: {
      ownership: {
        ...p(
          'Explicit responsibility for the supervisor lifetime.',
          '对监督器生命周期承担的显式责任。'
        ),
        values: {
          owned: t('Release also owns supervisor disposal.', '释放时同时负责监督器清理。'),
          borrowed: t('Release leaves the external supervisor alive.', '释放后保留外部监督器。')
        }
      },
      supervisor: p(
        'Existing supervisor of the real unit, from the platform execution owner.',
        '实际执行单元的现有监督器，来自平台执行拥有者。'
      ),
      scheduler: p(
        'Same monotonic scheduler used by the supervisor and retry deadlines.',
        '监督器与重试截止时间共用的单调调度器。'
      ),
      openChannel: m(
        'Opens the actual unit channel under the preparation cancellation signal.',
        '在准备取消信号约束下打开实际执行单元通道。',
        {
          unit: t(
            'Ready unit returned by this binding supervisor.',
            '本绑定监督器返回的就绪执行单元。'
          ),
          signal: t(
            'Native preparation signal issued by the generation owner.',
            '代次拥有者签发的原生准备信号。'
          )
        },
        t(
          'Promise of a complete channel; acquisition failure becomes start failure with its cause.',
          '返回完整通道的承诺，获取失败成为保留原始原因的启动失败。'
        ),
        `const channel = await binding.openChannel(unit, signal)`
      ),
      trackRequest: p(
        'Optional original native-drain tracker wrapping a request or cold dispatcher without adding another drain owner.',
        '可选原生排空跟踪器，包装请求或冷派发器，不额外创建排空拥有者。'
      )
    }
  },
  IRemoteProxyOptions: {
    summary: t(
      'Shared generation proxy configuration; the platform supplies its actual binding.',
      '共享代次代理配置，平台提供其实际绑定。'
    ),
    members: proxyMembers
  },
  IRemotePluginOptions: {
    summary: t(
      'One local Host registration backed by one normalized remote plugin contract.',
      '由规范远程插件契约支撑的单个本地宿主登记配置。'
    ),
    members: {
      ...proxyMembers,
      name: p(
        'Application registration name that must match the contract plugin.',
        '应用登记名称，必须匹配契约插件名。'
      ),
      host: p(
        'Caller-owned PluginHost enablement port controlling this exact registration.',
        '调用方拥有的插件宿主启停端口，控制当前精确登记。'
      )
    }
  },
  IRemoteHostOptions: {
    summary: t(
      'Remote Host proxy inputs with catalog instead of a single plugin contract.',
      '以目录代替单插件契约的远程宿主代理输入。'
    ),
    members: {
      ...proxyMembers,
      catalog: p(
        'Normalized catalog defining the only remotely installable plugin names.',
        '规范目录，定义唯一允许远程安装的插件名称范围。'
      )
    }
  },
  IRemotePluginDefinition: alias(
    'PluginHost definition generated from a validated remote contract; features appear after installation and retire with the registration.',
    '由已校验远程契约生成的插件宿主定义，特性在安装后出现并随登记退休。'
  ),
  IRemoteCallOptions: {
    summary: t(
      'Legacy proxy request and stream controls kept outside business arguments.',
      '旧版代理的请求及流式控制设置，与业务参数分开。'
    ),
    members: callMembers
  },
  IRuntimeCallOptions: {
    summary: t(
      'Runtime call controls including false deadline override and explicit binary ownership transfer.',
      '运行时调用控制，包含关闭截止时间的显式假值及二进制所有权转移。'
    ),
    members: {
      ...callMembers,
      timeoutMs: {
        ...callMembers.timeoutMs!,
        summary: t(
          'Finite nonnegative milliseconds, or false to disable the inherited deadline for this call.',
          '有限非负毫秒数，或用显式假值关闭本次调用的继承截止时间。'
        ),
        default: t(
          'Omitted: request and stream inherit defaultTimeoutMs; other call kinds keep their original defaults.',
          '省略时请求与流式调用继承默认截止时间，其他调用保留原默认行为。'
        ),
        values: { false: t('Disable the inherited deadline.', '关闭继承的调用截止时间。') }
      },
      transfer: p(
        'Caller-owned ArrayBuffers transferred through a carrier that actually supports native transfer.',
        '由调用方拥有的缓冲区列表，经实际支持原生转移的载体转移。',
        t('Omitted: no explicit native ownership transfer.', '省略时不显式请求原生所有权转移。')
      )
    }
  },
  IRemoteCallGuard: {
    summary: t(
      'One synchronous admission hook before generation dispatch; a throw prevents sending.',
      '代次派发前的同步接纳钩子，抛错会阻止发送。'
    ),
    members: {
      beforeDispatch: m(
        'Checks the normalized method, invocation mode and selected generation before dispatch.',
        '派发前检查规范方法、调用模式与选定代次。',
        {
          input: t(
            'Original dispatch metadata with method, mode and generation.',
            '原始派发元数据，包含方法、模式与代次。'
          )
        },
        t('No value; a thrown failure rejects admission.', '无返回值，抛错会拒绝接纳。'),
        `callGuard.beforeDispatch({ method: 'math.calc.double', mode: 'request', generation: 1 })`
      )
    }
  },
  IRemoteServeEndpoint: {
    summary: t(
      'One dedicated endpoint plus its actually installed one-way and streaming capabilities.',
      '单个专用端点及其实际安装的单向、流式能力。'
    ),
    members: {
      endpoint: p(
        'Original Core endpoint serving and sending frames.',
        '原始核心端点，负责提供服务及发送帧。'
      ),
      oneWay: p(
        'Installed one-way surface; required when the contract declares that mode.',
        '已安装的单向能力，契约声明此模式时必须提供。'
      ),
      stream: p(
        'Installed stream runtime; required for iterator modes.',
        '已安装的流式运行时，迭代器模式必须提供。'
      )
    }
  },
  IRemoteGenerationEvents: {
    summary: t(
      'Original current, departure and readiness facts used by the shared retry owner.',
      '共享重试拥有者使用的原始当前代次、离开与就绪事实。'
    ),
    members: {
      current: m(
        'Reads the accepted generation and whether it remains active without preparing another unit.',
        '读取已接受代次及其是否仍有效，不准备其他执行单元。',
        {},
        t('Generation number and active flag.', '返回代次编号及有效标志。'),
        `const current = events.current()`
      ),
      onLeave: m(
        'Subscribes to departure of the exact supplied generation.',
        '订阅所提供精确代次的离开事件。',
        {
          generation: t(
            'Number obtained from current or whenReady.',
            '从 `current()` 或 `whenReady()` 取得的代次编号。'
          ),
          listener: t('Receives the original departure reason.', '接收原始离开原因。')
        },
        t('Removal function for this observation.', '返回本次观察的移除函数。'),
        `const off = events.onLeave(events.current().generation, reason => console.error(reason))
off()`
      ),
      whenReady: m(
        'Waits for an accepted generation newer than the supplied number.',
        '等待编号晚于所提供代次的已接受就绪代次。',
        {
          afterGeneration: t(
            'Previously observed number returned by current or whenReady.',
            '先前从 `current()` 或 `whenReady()` 观察到的编号。'
          ),
          signal: t('Optional caller cancellation signal.', '可选调用方取消信号。')
        },
        t(
          'Promise of the newer generation; cancellation rejects with the owner reason.',
          '返回较新代次编号的承诺，取消会按拥有者原因拒绝。'
        ),
        `const next = await events.whenReady(events.current().generation, signal)`
      )
    }
  },
  IRemoteRetryDispatch: {
    summary: t(
      'One logical request retaining its original key and deadline across at most two physical sends.',
      '单个逻辑请求在最多两次物理发送间保留原键与截止时间。'
    ),
    members: {
      method: p(
        'Actual method path from the accepted remote contract.',
        '从已接受远程契约取得的实际方法路径。'
      ),
      mode: {
        ...p(
          'Only scalar request dispatch uses this retry port.',
          '仅标量请求派发使用此重试端口。'
        ),
        values: { request: t('One-result request dispatch.', '等待单个结果的请求派发。') }
      },
      idempotent: p(
        'Validated request replay eligibility from its contract.',
        '契约中已校验的请求重放资格。'
      ),
      key: p(
        'Original application or generated logical idempotency key.',
        '原始应用签发或自动生成的逻辑幂等键。'
      ),
      generation: p(
        'Original accepted generation number from the generation event owner.',
        '从代次事件拥有者取得的原始已接受代次编号。'
      ),
      signal: callMembers.signal!,
      timeoutMs: callMembers.timeoutMs!,
      deadlineAt: p(
        'Absolute monotonic deadline computed by the original logical-call owner.',
        '原始逻辑调用拥有者计算的绝对单调截止时间。'
      ),
      events: p(
        'Original generation event owner, never a separate synthetic event stream.',
        '原始代次事件拥有者，不是另建的合成事件流。'
      ),
      sendOnce: m(
        'Sends through the selected generation using the original remaining deadline and key.',
        '通过选定代次发送，并保留原始剩余截止时间及键。',
        {
          input: t(
            'Expected generation, optional remaining milliseconds and original key supplied by the retry owner.',
            '重试拥有者提供的预期代次、可选剩余毫秒数与原键。'
          )
        },
        t(
          'Promise of one portable result; a departure may leave the logical result unknown.',
          '返回单次可移植结果的承诺，代次离开可能使逻辑结果未知。'
        ),
        `const value = await input.sendOnce({ expectedGeneration: input.generation, key: input.key })`
      )
    }
  },
  IRemoteRetryPort: {
    summary: t(
      'Whole logical request dispatch port; the canonical implementation permits one idempotent replay after a departure.',
      '完整逻辑请求派发端口，规范实现允许在离开后执行一次幂等重放。'
    ),
    scenarios: [
      t(
        'Preserve one deadline while waiting for a replacement generation.',
        '等待替换代次期间保持同一个截止时间。'
      )
    ],
    example: `const port = createRemoteRetryPort({ events, scheduler, report })
const value = await port.dispatch(input)`,
    members: {
      dispatch: m(
        'Dispatches a logical request under its original cancellation, key and deadline.',
        '在原始取消、键与截止时间约束下派发逻辑请求。',
        {
          input: t(
            'IRemoteRetryDispatch issued by the original proxy dispatch owner.',
            '原代理派发拥有者签发的 `IRemoteRetryDispatch`。'
          )
        },
        t(
          'Portable result; lost non-idempotent results reject with REMOTE_RESULT_UNKNOWN.',
          '返回可移植结果，非幂等调用丢失结果时以 `REMOTE_RESULT_UNKNOWN` 拒绝。'
        ),
        `const value = await port.dispatch(input)`
      )
    }
  },
  IRemotePluginHostPort: {
    summary: t(
      'Local enablement operations used to suspend and resume the exact remote plugin registration.',
      '用于挂起及恢复精确远程插件登记的本地启停操作。'
    ),
    members: {
      disable: m(
        'Suspends the named registration through the original Host.',
        '通过原宿主挂起具名登记。',
        {
          name: t(
            'Name selected in createRemotePlugin options.',
            '在 `createRemotePlugin()` 选项中指定的名称。'
          ),
          options: t('Explicit suspension policy.', '显式挂起策略。')
        },
        t('Promise of the Host operation result.', '返回宿主操作结果的承诺。'),
        `await hostPort.disable('math', { policy: 'suspend' })`
      ),
      enable: m(
        'Resumes the named registration through the original Host.',
        '通过原宿主恢复具名登记。',
        {
          name: t(
            'Name selected in createRemotePlugin options.',
            '在 `createRemotePlugin()` 选项中指定的名称。'
          )
        },
        t('Promise of the Host operation result.', '返回宿主操作结果的承诺。'),
        `await hostPort.enable('math')`
      )
    }
  },
  IRemoteHostHandle: {
    summary: t(
      'Remote catalog Host controller; definitions stay local to its server-side resolver.',
      '远程目录宿主控制器，插件定义保留在服务端本地解析器中。'
    ),
    scenarios: [
      t(
        'Install only catalog-approved plugins in a remote Host.',
        '仅在远程宿主中安装目录允许的插件。'
      )
    ],
    example: hostExample,
    members: {
      ready: m(
        'Prepares or joins the current accepted generation; active-generation calls share readiness completion.',
        '准备或加入当前已接受代次，同一有效代次共享就绪完成过程。',
        {},
        t(
          'Promise resolving after directory acceptance; release rejects further readiness.',
          '目录接纳后完成的承诺，释放后拒绝后续就绪请求。'
        ),
        `await remote.ready()`
      ),
      use: m(
        'Installs or adopts a catalog plugin through the remote synchronous resolver.',
        '通过远程同步解析器安装或接纳目录插件。',
        {
          name: t('Application key from the normalized catalog.', '规范目录中的应用键名。'),
          config: t(
            'Optional portable application configuration, never a plugin definition.',
            '可选可移植应用配置，不是插件定义。'
          )
        },
        t(
          'Promise of local feature proxies bound to the accepted registration.',
          '返回绑定到已接受登记的本地特性代理承诺。'
        ),
        `const features = await remote.use('math')
await features.calc!.double!(21)`
      ),
      unUse: m(
        'Removes only the current registration adopted by this connection, optionally returning a dry-run plan.',
        '仅移除本连接已接纳的当前登记，可选择返回预演计划。',
        {
          name: t(
            'Catalog name previously passed to this handle use.',
            '先前传给当前句柄安装操作的目录名称。'
          ),
          options: t(
            'Optional IRemoteHostRemovalOptions policy and dry-run controls.',
            '可选 `IRemoteHostRemovalOptions` 策略及预演设置。'
          )
        },
        t(
          'Promise of portable removal outcome or plan; missing adoption rejects with REMOTE_HOST_NOT_ADOPTED.',
          '返回可移植移除结果或计划承诺，未接纳时以 `REMOTE_HOST_NOT_ADOPTED` 拒绝。'
        ),
        `await remote.use('math')
await remote.unUse('math', { policy: 'reject' })`
      ),
      inspect: m(
        'Reads the remote revision and catalog-visible installed plugin entries.',
        '读取远程版本号及目录可见的已安装插件条目。',
        {},
        t('Portable revision and sorted plugin summaries.', '返回可移植版本号及排序后的插件摘要。'),
        `console.log(await remote.inspect())`
      ),
      release: m(
        'Revokes this controller and releases its generation holder without uninstalling unrelated remote plugins.',
        '撤销当前控制器并释放其代次持有器，不卸载无关远程插件。',
        {},
        t(
          'Shared Promise of release; repeated calls retain the same operation.',
          '返回共享释放承诺，重复调用保持同一操作。'
        ),
        `await remote.release()
await remote.release()`
      )
    }
  },
  IRemoteHostRemovalOptions: {
    summary: t(
      'Dependency handling and optional planning for remote Host removal.',
      '远程宿主移除时的依赖处理及可选预演设置。'
    ),
    members: {
      policy: {
        ...p(
          'Policy for installed dependants.',
          '如何处理已经安装的依赖方。',
          t(
            '`reject`: refuse removal with active dependants.',
            '`reject`：存在有效依赖方时拒绝移除。'
          )
        ),
        values: {
          reject: t(
            'Reject a removal that would break dependants.',
            '移除会破坏依赖方时拒绝操作。'
          ),
          suspend: t('Suspend dependants using the Host policy.', '按宿主策略挂起依赖方。')
        }
      },
      dryRun: p(
        'Return the Host removal plan without changing registrations.',
        '返回宿主移除计划，不改变登记。',
        t('`false`: perform removal.', '`false`：实际执行移除。')
      )
    }
  },
  IRemoteHostPluginResolver: alias(
    'Synchronous server callback receiving an admitted catalog name and optional portable config; returns a local defined plugin and rejects thenables.',
    '同步服务端回调接收已接纳目录名称与可选可移植配置，返回本地已定义插件，不接受类承诺。'
  ),
  IRuntimePeer: {
    summary: t(
      'One accepted logical Peer exposing local identity, calls, passive events and deterministic connection cleanup.',
      '单个已接受逻辑连接，提供本端身份、调用、被动事件与确定性连接清理。'
    ),
    scenarios: [
      t(
        'Use a negotiated platform channel without introducing another proxy lifecycle.',
        '使用已协商的平台通道，不额外创建代理生命周期。'
      )
    ],
    example: peerExample,
    members: peerMembers
  },
  IRuntimePeerOptions: {
    summary: t(
      'Core peer configuration selecting exactly one application source and actual provided methods.',
      '核心连接配置，选择唯一应用来源及实际提供的方法。'
    ),
    members: sourceMembers
  },
  IRuntimePluginOptions: {
    summary: t(
      'Symmetric plugin configuration combining a source and explicit Host exposure whitelist.',
      '对称插件配置，将来源与显式宿主暴露白名单组合。'
    ),
    members: pluginMembers
  },
  IRuntimePeerIdentity: {
    summary: t(
      'Frozen display name and per-instance identity, separate from authentication principal.',
      '冻结的显示名称与逐实例标识，与认证主体分开。'
    ),
    members: {
      name: p(
        'Application-selected nonempty local display name or canonical peer fallback.',
        '应用选择的非空本端显示名称，或规范连接后备名称。'
      ),
      instanceId: p(
        'Application-provided or factory-generated unique instance identifier.',
        '应用提供或工厂生成的唯一实例标识。'
      )
    }
  },
  IRuntimePeerProvide: alias(
    'Own enumerable data methods or nested groups authored by the application; no accessors, reserved paths or noncallable leaves are admitted.',
    '应用编写的自有可枚举数据方法或嵌套方法组，不接纳访问器、保留路径及不可调用叶子。'
  ),
  IRuntimePeerSource: alias(
    'Async application callback receiving IRuntimePeerSourceContext and returning a fully agreed IRuntimePeerSourceResult; acquisition failures abort construction.',
    '异步应用回调接收 `IRuntimePeerSourceContext`，返回完整约定的 `IRuntimePeerSourceResult`，获取失败中止构造。'
  ),
  IRuntimePeerSourceContext: {
    summary: t(
      'Safe local identity and offered capabilities passed to the actual platform source.',
      '传给实际平台来源的安全本端身份及能力提议。'
    ),
    members: {
      self: p(
        'Identity issued by this exact peer preparation.',
        '当前精确连接准备过程签发的身份。'
      ),
      capabilities: p(
        'Capabilities implemented by the selected endpoint assembly.',
        '所选端点组装实际实现的能力列表。'
      )
    }
  },
  IRuntimePeerSourceResult: {
    summary: t(
      'Agreed channel with optional cold-receive activation handed to the endpoint owner.',
      '已约定通道及可选冷接收激活操作，转交给端点拥有者。'
    ),
    members: {
      ...channelMembers,
      activateReceive: {
        ...p(
          'Optional synchronous callback activating captured receive delivery only after endpoint registration; thrown activation failures trigger construction rollback.',
          '可选同步回调，仅在端点登记后激活已捕获消息交付；激活抛错会触发构造回滚。'
        ),
        params: {},
        returns: t(
          'No return value is consumed; activation is complete when the synchronous callback returns.',
          '不消费返回值；同步回调返回时激活已经完成。'
        )
      }
    }
  },
  IRuntimePluginTyping: {
    summary: t(
      'Compile-time metadata connecting remote, provide, exposure and runtime slot without granting runtime authority.',
      '编译期元数据，将远端、提供方法、暴露与运行时槽位关联，不授予运行时权限。'
    ),
    members: {
      name: p(
        'Literal registration name supplied by the application plugin factory.',
        '应用插件工厂提供的字面登记名称。'
      )
    }
  },
  IRuntimeExpose: alias(
    'Compile-time whitelist of installed plugin names, dotted callable paths and the explicit host control entry.',
    '已安装插件名称、点分可调用路径及显式宿主控制入口组成的编译期白名单。'
  ),
  IRuntimeFlatten: alias(
    'Type-only flattening of nested method groups into dotted paths; runtime descriptor admission remains authoritative.',
    '将嵌套方法组展平为点分路径的纯类型运算，运行时描述符接纳仍为权威。'
  ),
  IRuntimeRegistry: alias(
    'Type-level installed plugin tuple extracted from a real typed Host.',
    '从真实带类型宿主提取的类型级已安装插件元组。'
  ),
  IRuntimeProcessStopOptions: {
    summary: t(
      'Graceful process stop inputs used only for an execution-owned connection.',
      '仅拥有执行所有权的连接使用的进程优雅停止输入。'
    ),
    members: {
      graceMs: p(
        'Caller-selected finite nonnegative time for graceful completion.',
        '调用方选择的有限非负优雅完成时长。'
      ),
      signal: {
        ...p(
          'Only the existing graceful process signal is admitted.',
          '仅接纳现有的进程优雅停止信号。'
        ),
        values: { SIGTERM: t('Request graceful process termination.', '请求进程优雅终止。') }
      }
    }
  },
  IRuntimeThreadStopOptions: {
    summary: t(
      'Grace interval before the owned thread termination operation.',
      '拥有的线程执行终止前使用的宽限间隔。'
    ),
    members: {
      graceMs: p(
        'Caller-selected finite nonnegative graceful-completion interval.',
        '调用方选择的有限非负优雅完成间隔。'
      )
    }
  },
  ICoroutineChildOptions: {
    summary: t(
      'Child coroutine mode borrowing the genuine token from its parent task without starting another unit.',
      '子协程模式借用父任务提供的真实令牌，不启动其他执行单元。'
    ),
    members: coroutineMembers
  },
  ICoroutineParentOptions: {
    summary: t(
      'Parent coroutine mode owning a cooperative task through canonical supervision.',
      '父协程模式通过规范监督拥有协作式任务。'
    ),
    members: coroutineMembers
  },
  ICoroutineConnect: alias(
    'Opaque token issued only to one current task context; it reveals no physical port or execution authority.',
    '仅向当前任务上下文签发的不透明令牌，不暴露物理端口或执行权限。'
  ),
  ICoroutineUserTask: alias(
    'Task callback receiving ICoroutineTaskContext; synchronous completion or Promise settlement is native exit, and rejection preserves its original cause.',
    '任务回调接收 `ICoroutineTaskContext`，同步完成或承诺确定即原生退出，拒绝保留原始原因。'
  ),
  ICoroutineReplaceSpec: {
    summary: t(
      'Replacement input selecting only the new application task.',
      '仅选择新应用任务的替换输入。'
    ),
    members: { task: coroutineMembers.task! }
  },
  ICoroutineTaskContext: {
    summary: t(
      'One task generation cancellation, heartbeat and opaque child connection context.',
      '单个任务代次的取消、心跳及不透明子连接上下文。'
    ),
    members: {
      signal: p(
        'Original native cancellation signal from the coroutine supervisor.',
        '协程监督器提供的原始原生取消信号。'
      ),
      connect: coroutineMembers.connect!,
      heartbeat: m(
        'Records liveness on the same supervisor heartbeat owner.',
        '在同一个监督心跳拥有者中记录存活。',
        {},
        t('No result; the last heartbeat time advances.', '无返回值，最近心跳时间已经推进。'),
        `context.heartbeat()`
      )
    }
  },
  ICoroutineSupervisorPolicy: {
    summary: t(
      'Optional projection of the existing coroutine supervisor policy; omitted fields keep canonical defaults.',
      '现有协程监督策略的可选投影，省略字段保留规范默认值。'
    ),
    members: {
      ...Object.fromEntries(
        Object.entries(supervisionReference.types.ICoroutineSupervisorOptions!.members).filter(
          ([key]) =>
            ['restart', 'terminalPolicy', 'startupTimeoutMs', 'stop', 'budget', 'heartbeat'].some(
              (prefix) => key === prefix || key.startsWith(`${prefix}.`)
            )
        )
      ),
      budget: {
        ...supervisionReference.types.ICoroutineSupervisorOptions!.members.budget!,
        default: t(
          'Omitted: create a one-unit coroutine budget rejecting overflow.',
          '省略时创建单执行单元协程预算，超出时拒绝。'
        )
      }
    }
  },
  IRpcRemoteLayerErrorCode: alias(
    'Value union of RpcRemoteLayerErrorCode; branch on source and code together.',
    '`RpcRemoteLayerErrorCode` 的值联合，须同时根据来源与错误码分支。'
  )
}

/** Exported enum choices are attached where this module exports their domains. */
for (const name of ['IRuntimeConnectionDetail', 'IRuntimeListFilter']) {
  const original = types[name]!
  types[name] = {
    ...original,
    members: {
      ...original.members,
      kind: { ...original.members!.kind!, values: { enum: 'RuntimeSourceKind' } },
      direction: { ...original.members!.direction!, values: { enum: 'RuntimeConnectionDirection' } }
    }
  }
}
types.IRemoteContract = {
  ...types.IRemoteContract!,
  scenarios: [
    t(
      'Validate received descriptions before publishing any remote method.',
      '发布任何远程方法前校验接收到的描述。'
    )
  ],
  example: contractExample
}
types.IRuntimePluginTyping = {
  ...types.IRuntimePluginTyping!,
  scenarios: [
    t(
      'Infer exposed callable paths from a typed installed Host.',
      '从已安装的带类型宿主推导可暴露调用路径。'
    )
  ],
  example: coroutineExample
}

/** Both server-side handles close only the dedicated service resources they own. */
for (const kind of ['Plugin', 'Host'] as const) {
  types[`IRemoteServe${kind}Handle`] = {
    summary:
      kind === 'Plugin'
        ? t(
            'Service handle owning its private Host registration and dedicated endpoint.',
            '拥有私有宿主登记与专用端点的服务句柄。'
          )
        : t(
            'Service handle owning only its dedicated endpoint, retaining remotely installed Host plugins.',
            '仅拥有专用端点的服务句柄，保留远程安装的宿主插件。'
          ),
    scenarios: [
      t(
        'Stop serving this physical connection while retaining the original application Host.',
        '停止为当前物理连接提供服务，并保留原应用宿主。'
      )
    ],
    example: `const service = await serveRemote${kind}(options)
await service.close()`,
    members: {
      close: m(
        'Closes this dedicated service once; repeated calls share completion.',
        '关闭当前专用服务，重复调用共享完成过程。',
        {},
        t(
          'Promise after owned registrations and endpoint resources are released.',
          '返回其拥有的登记及端点资源释放后的承诺。'
        ),
        `await service.close()`
      )
    }
  }
}
/** Dedicated serving options retain required host and reporting ownership. */
types.IRemoteServePluginOptions = {
  summary: t(
    'Dedicated plugin serving inputs; the application Host already owns the target plugin.',
    '专用插件服务输入，目标插件已由应用宿主持有。'
  ),
  members: {
    host: p(
      'Actual local PluginHost handle exposing use, unUse and plugin inspection.',
      '实际本地插件宿主句柄，提供安装、移除及插件检查。'
    ),
    contract: proxyMembers.contract!,
    endpoint: p(
      'Dedicated endpoint assembled with the contract required call modes.',
      '按契约所需调用模式组装的专用端点。'
    ),
    report,
    invocationContext: {
      ...m(
        'Produces local application context for each provider invocation.',
        '为每次提供方调用生成本地应用上下文。',
        { context: t('Actual Core provider IRpcContext.', '实际核心提供方 `IRpcContext`。') },
        t(
          'Application value passed locally to the method; a throw fails that invocation.',
          '返回本地传给方法的应用值，抛错使该次调用失败。'
        ),
        `invocationContext: context => ({ signal: context.signal })`
      ),
      default: t(
        'Omitted: no extra invocation-context argument is appended.',
        '省略时不追加额外调用上下文参数。'
      )
    }
  }
}
types.IRemoteServeHostOptions = {
  summary: t(
    'Dedicated catalog serving inputs; resolver remains synchronous and plugin definitions remain local.',
    '专用目录服务输入，解析器保持同步，插件定义保留本地。'
  ),
  members: {
    host: p(
      'Actual local PluginHost with use, unUse, plugin inspection and revision.',
      '实际本地插件宿主，提供安装、移除、插件检查与版本号。'
    ),
    catalog: types.IRemoteHostOptions!.members!.catalog!,
    resolvePlugin: runtimePluginOptionMembers.resolvePlugin!,
    endpoint: types.IRemoteServePluginOptions!.members!.endpoint!,
    report
  }
}

/** Runtime symbols are written against the source owners rather than generated JSDoc. */
const symbols: Record<string, ISymbolDoc> = {
  createRuntimePeer: {
    ...op(
      'Creates one accepted direct Peer on exactly one supplied source; failure rolls acquired resources back before rejecting, including entropy failure before endpoint construction.',
      '在唯一提供的来源上创建已接受的直接连接，失败时先回滚已取得资源再拒绝，也覆盖端点构造前的熵源失败。',
      {
        options: t(
          'Application IRuntimePeerOptions selecting one source and provided methods.',
          '应用选择唯一来源及提供方法的 `IRuntimePeerOptions`。'
        ),
        resources: t(
          'Advanced original preparation resources supplied by the canonical adapter owner; ordinary applications omit this argument.',
          '高级原始准备资源，由规范适配器拥有者提供，普通应用省略此参数。'
        )
      },
      t(
        'Promise of IRuntimePeer or typed IRuntimeTypedPeer after directory acceptance; caller owns close.',
        '目录接纳后返回 `IRuntimePeer` 或带类型连接的承诺，调用方负责关闭。'
      ),
      peerExample
    ),
    role: 'factory',
    options: 'IRuntimePeerOptions'
  },
  createManagedRuntimePeer: {
    ...op(
      'Creates a Peer facade on the original managed binding and generation holder, retaining restart and native execution ownership.',
      '在原始托管绑定及代次持有器上创建连接门面，保留重启与原生执行所有权。',
      {
        options: t(
          'Peer options plus keyFactory, retryPort and callDeadlineCapMs used by managed proxy dispatch.',
          '连接选项及托管代理派发使用的键工厂、重试端口与截止上限。'
        ),
        binding: t(
          'Actual IRemoteBinding supplied by the platform owner.',
          '平台拥有者提供的实际 `IRemoteBinding`。'
        ),
        bindEndpoint: t(
          'Optional canonical callback receiving the actual channel and assembled endpoint, returning the endpoint to retain.',
          '可选规范回调，接收实际通道及已组装端点，返回需保留的端点。'
        ),
        preparation: t(
          'Original adapter preparation ports and signals; ordinary applications must not forge Host or provider admission provenance.',
          '原始适配器准备端口及信号，普通应用不得伪造宿主或提供方接纳来源。'
        ),
        beforeRelease: t(
          'Optional async native drain before generation endpoint cleanup; rejection remains observable.',
          '代次端点清理前的可选异步原生排空操作，拒绝保持可观察。'
        ),
        execution: t(
          'Original supervisor carrying execution authority, supplied only by its real native owner.',
          '携带执行权限的原始监督器，仅由真实原生拥有者提供。'
        )
      },
      t(
        'Promise of managed IRuntimePeer; close continues channel, owned binding and carrier-listener release even after an earlier cleanup failure. One failure retains identity; multiple failures retain their complete cause/errors graph. Async source wrappers need not return the identical Promise.',
        '返回托管连接承诺；关闭时即使前项清理失败，仍继续释放通道、所拥有绑定及载体错误监听；单错保持身份，多错保留完整原因及错误图，异步来源包装不承诺承诺引用相同。'
      ),
      `const peer = await createManagedRuntimePeer(options, binding)
await peer.close()`
    ),
    role: 'factory',
    optionDocs: { ...sourceMembers, callDeadlineCapMs: proxyMembers.callDeadlineCapMs! }
  },
  createRemoteHost: {
    ...op(
      'Creates a catalog-scoped remote Host controller; pair with serveRemoteHost on the other end.',
      '创建受目录约束的远程宿主控制器，搭配对端的 `serveRemoteHost()` 使用。',
      {
        options: t(
          'Application IRemoteHostOptions with normalized catalog and actual binding.',
          '应用提供的规范目录与实际绑定配置 `IRemoteHostOptions`。'
        )
      },
      t(
        'IRemoteHostHandle owned by the caller; release is idempotent.',
        '调用方拥有的远程宿主句柄，释放为幂等操作。'
      ),
      `const service = await serveRemoteHost(serverOptions)
try {
${hostExample}
} finally { await service.close() }`
    ),
    role: 'factory',
    options: 'IRemoteHostOptions'
  },
  createRemotePlugin: {
    ...op(
      'Creates a cold PluginHost definition whose feature proxies use one remote contract and its generation owner.',
      '创建冷插件宿主定义，特性代理使用同一远程契约及其代次拥有者。',
      {
        options: t(
          'Application IRemotePluginOptions naming the exact registration and its real enablement Host.',
          '应用提供的 `IRemotePluginOptions`，指定精确登记与真实启停宿主。'
        )
      },
      t(
        'Plugin definition to install through host.use; Host removal releases its generation resources.',
        '可通过宿主安装的插件定义，宿主移除时释放其代次资源。'
      ),
      `${contractExample}
const plugin = createRemotePlugin({ name: 'math', contract, host, binding, endpointFactory, report })
await host.use(plugin)
await host.dispose()`
    ),
    role: 'enhancer',
    options: 'IRemotePluginOptions'
  },
  createRemoteRetryPort: {
    ...op(
      'Creates canonical request retry dispatch: at most one replay for an idempotent request after actual generation departure.',
      '创建规范请求重试派发，在实际代次离开后最多为幂等请求重放一次。',
      {
        options: t(
          'Original generation events, monotonic scheduler and diagnostic reporter.',
          '原始代次事件、单调调度器与诊断报告函数。'
        )
      },
      t(
        'IRemoteRetryPort preserving the original logical key, cancellation and deadline.',
        '返回保留原逻辑键、取消及截止时间的重试端口。'
      ),
      `const port = createRemoteRetryPort({ events, scheduler, report })
const value = await port.dispatch(input)`
    ),
    role: 'factory',
    optionDocs: {
      events: p(
        'Original generation events returned by the proxy generation owner.',
        '原代理代次拥有者提供的代次事件。'
      ),
      scheduler: p('Same monotonic scheduler as the binding.', '与绑定相同的单调调度器。'),
      report
    }
  },
  createCoroutinePlugin: {
    ...op(
      'Creates a parent task owner or child connection plugin; the two modes must be used together through the genuine task connect token.',
      '创建父任务拥有者或子连接插件；父任务提供的 `connect` 令牌必须交给子端的 `createCoroutinePlugin`，两端配合使用。',
      {
        options: t(
          'Application name and provided methods plus exactly one parent task or child connect token.',
          '应用名称及提供方法，另加唯一父任务或子连接令牌。'
        )
      },
      t(
        'Cold plugin for the coroutine Host outlet; parent disposal cooperatively stops its task, child disposal closes only its connection.',
        '协程宿主出口的冷插件，父端释放会协作式停止任务，子端释放仅关闭其连接。'
      ),
      coroutineExample
    ),
    role: 'enhancer',
    optionDocs: coroutineMembers
  },
  createRuntimePlugin: {
    ...op(
      'Advanced adapter assembly of one cold symmetric runtime plugin in a real shared Host slot.',
      '高级适配器在真实共享宿主槽位中组装单个冷对称运行时插件。',
      {
        options: t(
          'Actual IRuntimePluginOptions with source and whitelist.',
          '包含来源及白名单的实际运行时插件配置。'
        ),
        slotResource: t(
          'Adapter-owned resource with key and acquire(integration, create); acquire must use the real Host shared-slot operation and retain its family identity.',
          '适配器拥有的资源，包含键及获取操作，须使用真实宿主共享槽位操作并保留家族身份。'
        ),
        createPeer: t(
          'Optional factory receiving compiled peer options and returning its genuine Peer; omitted uses createRuntimePeer.',
          '可选工厂，接收已编译连接选项并返回真实连接，省略时使用 `createRuntimePeer()`。'
        )
      },
      t(
        'PluginHost definition; installation publishes only approved methods and owns its contribution lifetime.',
        '返回插件宿主定义，安装后仅发布获准方法并拥有其贡献生命周期。'
      ),
      `const plugin = createRuntimePlugin(options, slotResource)
await host.use(plugin)
await host.dispose()`
    ),
    role: 'enhancer',
    options: 'IRuntimePluginOptions'
  },
  normalizeRemoteContract: op(
    'Snapshots, validates and freezes an untrusted V1 plugin contract with bounded tables and sorted keys.',
    '对不可信第一版插件契约取快照、校验并冻结，限制表大小并排序键。',
    {
      input: t(
        'Application-authored or received portable contract description.',
        '应用编写或接收到的可移植契约描述。'
      )
    },
    t(
      'Normalized IRemoteContract; invalid shape throws REMOTE_CONTRACT_INVALID and retains the cause.',
      '返回规范契约，形状不合法时抛出保留原因的 `REMOTE_CONTRACT_INVALID`。'
    ),
    contractExample
  ),
  normalizeRemoteHostCatalog: op(
    'Validates and freezes a nonempty name-to-contract catalog; each name must equal its contract plugin.',
    '校验并冻结非空名称到契约目录，每个名称须等于对应契约插件名。',
    {
      input: t(
        'Application catalog record or received portable catalog.',
        '应用目录记录或接收到的可移植目录。'
      )
    },
    t(
      'Sorted frozen IRemoteHostCatalog; invalid or oversized descriptions throw REMOTE_CONTRACT_INVALID.',
      '返回排序冻结目录，不合法或超限的描述抛出 `REMOTE_CONTRACT_INVALID`。'
    ),
    `${contractExample}
const catalog = normalizeRemoteHostCatalog({ math: contract })`
  ),
  normalizeRemoteControlShape: op(
    'Validates one reserved Host control payload or result under the selected exact grammar.',
    '按所选精确语法校验单个保留宿主控制负载或结果。',
    {
      definition: t(
        'IRemoteControlDefinition selecting the actual reserved operation input or result shape.',
        '选择实际保留操作输入或结果形状的控制定义。'
      ),
      input: t('Received portable control data.', '接收到的可移植控制数据。')
    },
    t(
      'Normalized portable value; invalid required fields or unknown semantics throw REMOTE_CONTRACT_INVALID.',
      '返回规范可移植值，必填字段或未知语义不合法时抛出契约错误。'
    ),
    `const payload = normalizeRemoteControlShape('hostUseParams', ['math'])`
  ),
  sameRemoteContract: op(
    'Compares JSON serializations of two already normalized contracts; normalize both before comparing.',
    '比较两个已规范契约的序列化结果，比较前应先配合 `normalizeRemoteContract()` 规范双方。',
    {
      a: t(
        'First normalized contract returned by normalizeRemoteContract.',
        '第一个由 `normalizeRemoteContract()` 返回的规范契约。'
      ),
      b: t(
        'Second normalized contract returned by normalizeRemoteContract.',
        '第二个由 `normalizeRemoteContract()` 返回的规范契约。'
      )
    },
    t(
      'True when normalized JSON representations match; raw insertion order is not normalized here.',
      '规范序列化表示相同时为真，此函数不自行规范原始键顺序。'
    ),
    `const a = normalizeRemoteContract(first)
const b = normalizeRemoteContract(second)
console.log(sameRemoteContract(a, b))`
  ),
  serveRemotePlugin: {
    ...op(
      'Serves one normalized plugin contract through a dedicated endpoint and a private service registration in the original Host.',
      '通过专用端点及原宿主中的私有服务登记提供单个规范插件契约。',
      {
        options: t(
          'Real local Host, normalized contract, dedicated endpoint and required reporter.',
          '真实本地宿主、规范契约、专用端点及必填报告函数。'
        )
      },
      t(
        'Promise of a service close handle; missing stream support fails with CAPABILITY_CONFLICT after endpoint rollback.',
        '返回服务关闭句柄承诺，缺少流式支持时先回滚端点，再以 `CAPABILITY_CONFLICT` 失败。'
      ),
      `const service = await serveRemotePlugin({ host, contract, endpoint, report })
await service.close()`
    ),
    role: 'factory',
    options: 'IRemoteServePluginOptions'
  },
  serveRemoteHost: {
    ...op(
      'Serves catalog-limited remote Host controls, using only a synchronous local plugin resolver.',
      '提供受目录限制的远程宿主控制，仅使用同步本地插件解析器。',
      {
        options: t(
          'Real local Host, normalized catalog, resolver, dedicated endpoint and reporter.',
          '真实本地宿主、规范目录、解析器、专用端点及报告函数。'
        )
      },
      t(
        'Promise of a close handle releasing the endpoint; installed catalog plugins remain owned by the Host.',
        '返回释放端点的关闭句柄承诺，已安装目录插件仍由宿主持有。'
      ),
      `const service = await serveRemoteHost({ host, catalog, resolvePlugin, endpoint, report })
await service.close()`
    ),
    role: 'factory',
    options: 'IRemoteServeHostOptions'
  },
  RuntimeEventName: runtimeEventSymbol
}
/** Literal constants keep their exact source values and intended consumers. */
for (const [name, en, zh, example] of [
  [
    'DEFAULT_DRAIN_MS',
    'Default native drain budget of 5000 milliseconds.',
    '默认原生排空预算为五千毫秒，供进程与线程关闭路径共同使用。',
    `console.log(DEFAULT_DRAIN_MS)`
  ],
  [
    'REMOTE_METHOD_MAX_LENGTH',
    'Maximum three-segment V1 method path length, 122 characters.',
    '第一版三段方法路径最大长度为一百二十二个字符。',
    `if (path.length > REMOTE_METHOD_MAX_LENGTH) throw invalidPath`
  ],
  [
    'REMOTE_NAME_PATTERN',
    'ASCII segment grammar: letter first, up to 40 total letters, digits, underscores or hyphens.',
    '段名称采用字母开头、总长最多四十个字母数字下划线或连字符的语法。',
    `console.log(new RegExp(REMOTE_NAME_PATTERN, 'u').test('math'))`
  ],
  [
    'REMOTE_SCHEMA_VERSION',
    'V1 explicit plugin contract version, exactly 1.',
    '显式插件契约版本，固定为第一版，用于接纳声明而非自动运行时目录。',
    `console.log(contract.schemaVersion === REMOTE_SCHEMA_VERSION)`
  ],
  [
    'REMOTE_METHOD_MODES',
    'Frozen list of the four accepted V1 RemoteMethodMode values.',
    '已冻结的第一版四种方法模式列表，用于拒绝契约中无法识别的模式。',
    `console.log(REMOTE_METHOD_MODES.includes('request'))`
  ],
  [
    'RPC_REMOTE_ERROR_SOURCE',
    'Compare RPC_REMOTE_ERROR_SOURCE with an error’s source before inspecting code. This identifies errors created by the remote execution layer.',
    '先把错误的 source 与 RPC_REMOTE_ERROR_SOURCE 比较，再检查 code，确认失败是否由远程执行层创建。',
    `if (error.source === RPC_REMOTE_ERROR_SOURCE) console.error(error.code)`
  ],
  [
    'RUNTIME_API_SCHEMA_VERSION',
    'Version 2 for automatic runtime method directories, independent of V1 explicit contracts.',
    '自动运行时方法目录使用第二版，与第一版显式契约独立。',
    `console.log(RUNTIME_API_SCHEMA_VERSION)`
  ]
] as const)
  symbols[name] = { role: 'constant', purpose: t(en, zh), example }
/** Every exported enum-like object also has a runtime symbol page. */
for (const [name, doc] of Object.entries(enums))
  symbols[name] ??= { role: 'constant', purpose: doc.summary, example: `console.log(${name})` }

/** Plugin installation grants dynamic methods through the canonical Host owner. */
const pluginInstall = `${contractExample}
const plugin = createRemotePlugin({ name: 'math', contract, host, binding, endpointFactory, report })
const [handle] = await host.use(plugin)
const calc = handle.getFeature('calc')
console.log(await calc.double(21))
await host.dispose()`

/** Remote module reference merged by rpc-core.ts without importing its parent. */
export const remoteReference: ILibraryReference = {
  modules: {
    remote: {
      summary: t(
        'Generation-aware plugin proxies, catalog Host controls and symmetric runtime peers. Start from createRuntimePeer for a negotiated source or createCoroutinePlugin for cooperative tasks.',
        '提供感知代次的插件代理、目录宿主控制与对称运行时连接。已有协商来源从 `createRuntimePeer()` 开始，协作任务从 `createCoroutinePlugin()` 开始。'
      ),
      example: peerExample
    }
  },
  symbols,
  types,
  enums,
  enhancers: {
    createRemotePlugin: {
      scenarios: [
        t(
          'Install contract-shaped remote methods in an existing Host.',
          '在已有宿主中安装契约形状的远程方法。'
        )
      ],
      example: pluginInstall,
      kind: 'plugin',
      target: 'IHostHandle',
      summary: t(
        'Installation exposes only declared remote features on the PluginHost; departure suspends this contribution through its original owner.',
        '安装后仅在插件宿主上暴露已声明远端特性，离开时通过原拥有者挂起该贡献。'
      ),
      install: pluginInstall,
      grants: [
        {
          signature: 'handle.getFeature(feature)',
          summary: t(
            'Obtains the accepted remote feature proxy from the installed registration.',
            '从已安装登记取得已接受的远程特性代理。'
          ),
          params: {
            feature: t('Feature name in the normalized contract.', '规范契约中的特性名称。')
          },
          returns: t(
            'Method proxy record bound to the original generation owner.',
            '返回绑定原始代次拥有者的方法代理记录。'
          ),
          example: pluginInstall
        }
      ]
    },
    createCoroutinePlugin: {
      scenarios: [
        t(
          'Own cooperative service work inside the same process.',
          '在同一进程中拥有协作式服务任务。'
        )
      ],
      example: coroutineExample,
      kind: 'plugin',
      target: 'IHostHandle',
      summary: t(
        'Installation adds the canonical coroutine outlet. Parent plugins own tasks; child plugins only borrow the supplied generation connection.',
        '安装后获得规范协程出口，父插件拥有任务，子插件仅借用所提供的代次连接。'
      ),
      install: coroutineExample,
      grants: [
        {
          signature: 'host.coroutine.request(target, method, payload?, options?)',
          ...m(
            'Calls a method on the named coroutine connection after plugin installation.',
            '插件安装后调用具名协程连接上的方法。',
            {
              target: t(
                'Connection name supplied to createCoroutinePlugin.',
                '创建协程插件时指定的连接名称。'
              ),
              method: t(
                'Actual method path from the accepted child provide directory.',
                '已接受子端方法目录中的实际方法路径。'
              ),
              payload: t('One application payload.', '单个应用负载。'),
              options: t('Optional IRuntimeCallOptions.', '可选运行时调用控制设置。')
            },
            t('Promise of the remote method result.', '返回远端方法结果的承诺。'),
            coroutineExample
          )
        }
      ]
    },
    createRuntimePlugin: {
      scenarios: [
        t(
          'Implement a platform adapter using the original runtime Host slot.',
          '使用原运行时宿主槽位实现平台适配器。'
        )
      ],
      example: `const plugin = createRuntimePlugin(options, slotResource)
await host.use(plugin)
await host[slotResource.key].request(options.name, 'echo', 'hello')
await host.dispose()`,
      kind: 'plugin',
      target: 'IHostHandle',
      summary: t(
        'Installation publishes the supplied source contribution in the real runtime slot, with calls and lifecycle queries owned by the canonical outlet.',
        '安装后在真实运行时槽位发布所提供来源的贡献，调用及生命周期查询由规范出口拥有。'
      ),
      install: `const plugin = createRuntimePlugin(options, slotResource)
await host.use(plugin)
await host.dispose()`,
      grants: [
        {
          signature: 'host[slotResource.key].request(target, method, payload?, options?)',
          ...m(
            'Calls a provided method through the actual acquired runtime slot.',
            '通过实际取得的运行时槽位调用提供的方法。',
            {
              target: t(
                'Name supplied in the installed plugin options.',
                '已安装插件选项中指定的名称。'
              ),
              method: t('Path from the accepted remote directory.', '已接受远程目录中的路径。'),
              payload: t('One application payload.', '单个应用负载。'),
              options: t('Local runtime call controls.', '本地运行时调用控制设置。')
            },
            t(
              'Promise of the method result, governed by the original contribution lifecycle.',
              '返回受原贡献生命周期约束的方法结果承诺。'
            ),
            `await host[slotResource.key].request(options.name, 'echo', 'hello')`
          )
        }
      ]
    }
  }
}
