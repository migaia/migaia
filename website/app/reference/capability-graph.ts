/** Static Graph reference, checked against capability/src/graph/index.ts on 2026-10-17. */
import type { ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'
import { capabilityDynamicReference } from './capability-dynamic.js'
import { capabilityCases } from './capability-cases.ts'
/** Builds bilingual reader text. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents a stored value. */
const p = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Documents a scalar alias. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })
/** Complete static graph construction shared by lifecycle examples. */
const setup = `import { createCapabilityGraph, type IGraphNodeId } from '@migaia/capability/graph'
const id = 'cache' as IGraphNodeId
const graph = createCapabilityGraph()
graph.register({ id, kind: 'service', dependencies: [], start: () => ({ value: new Map(), release() {} }) })`
/** Caller-issued node ID used by diagnostic reads. */
const id = t(
  'The application-assigned id from the registered node definition.',
  '来自应用所登记节点定义的 `id`，不是库生成的标识。'
)
/** Provider identity from a declared direct edge. */
const provider = t(
  'Application-assigned provider ID declared in this consumer dependency list.',
  '来自应用登记的提供方节点标识，须在当前消费方依赖列表中声明。'
)
/** Operations on the static graph with one startup and cleanup transaction. */
const members: Record<string, IMemberDoc> = {
  register: {
    summary: t(
      'Snapshots a node before the first ready call freezes registration; duplicates and malformed definitions reject admission.',
      '在首次就绪冻结登记前保存节点快照，重复节点与非法定义会拒绝接纳。'
    ),
    params: {
      node: t(
        'Required definition with no field defaults: `id` is an application-issued nonempty `IGraphNodeId`, `kind` is a nonempty diagnostic string, `dependencies` is an array (use `[]` for none), and `start(context)` is callable. Each edge requires `provider` (a registered node ID) and `required: true`, with no duplicate providers. `start` receives `nodeId`, a graph-owned native `signal`, `get(provider)` for declared ready direct providers and `own(resource, descriptor)` for auxiliary lifecycle ownership. Return `{ value, release(context) }`, or its thenable; `value` may be any value including `undefined`, and required `release` returns void or a completion thenable. Its context contains `nodeId`, `signal` and `report(error)`.',
        '必填定义，各字段无默认值：`id` 是应用签发的非空 `IGraphNodeId`，`kind` 是非空诊断字符串，`dependencies` 必须是数组（无依赖时传 `[]`），`start(context)` 必须可调用。每条依赖须有已登记节点标识 `provider` 和 `required: true`，不能重复提供方。`start` 收到 `nodeId`、图拥有的原生 `signal`、读取已声明且就绪的直接提供方的 `get(provider)`，以及接纳辅助资源的 `own(resource, descriptor)`。返回 `{ value, release(context) }` 或其类 Promise；`value` 可为任意值，包含 `undefined`，必填 `release` 返回空值或清理完成的类 Promise，其上下文含 `nodeId`、`signal` 和 `report(error)`。'
      )
    },
    returns: t(
      'No return value; the definition is admitted without starting it.',
      '无返回值；定义已被接纳，但尚未启动节点。'
    ),
    example: setup
  },
  ready: {
    summary: t(
      'Freezes registration and starts providers before consumers; partial failure rolls back provisional and adopted resources. An admitted stale primary is still released if auxiliary rollback fails; failures follow the existing reporter policy.',
      '冻结节点登记并先启动提供方再启动消费方，部分失败时回滚暂存与已接纳资源；即使辅助资源回滚失败，已准入的过期主资源仍会释放，错误沿既有报告策略处理。'
    ),
    returns: t(
      'The same Promise for every caller. Missing providers, cycles and startup failures reject with graph errors retaining the original cause.',
      '所有调用者共享同一承诺；缺少提供方、依赖环与启动失败通过图错误拒绝，并保留原始原因。'
    ),
    example: `${setup}\nawait graph.ready()\nconsole.log(graph.readValue(id))\nawait graph.dispose()`
  },
  nodeState: {
    summary: t(
      'Creates a diagnostic snapshot for a registered node, including state and retained startup error.',
      '为已登记节点创建诊断快照，包含节点状态与保留的启动错误。'
    ),
    params: { id },
    returns: t(
      'IGraphNodeDiagnostic; value is visible only when graph and node are ready. Unknown IDs throw GRAPH_UNKNOWN_NODE.',
      '返回 `IGraphNodeDiagnostic`；仅图与节点均就绪时值可见，未知标识抛出 `GRAPH_UNKNOWN_NODE`。'
    ),
    example: `${setup}\nawait graph.ready()\nconsole.log(graph.nodeState(id))\nawait graph.dispose()`
  },
  readValue: {
    summary: t(
      'Reads the nodeState value projection without allocating a diagnostic or cloning the payload.',
      '读取与节点诊断相同的值投影，不分配诊断对象，也不复制载荷。'
    ),
    params: { id },
    returns: t(
      'Original payload while graph and node are ready, otherwise undefined, which is also valid payload data. Unknown IDs throw GRAPH_UNKNOWN_NODE.',
      '图与节点均就绪时返回原载荷，否则返回 `undefined`，该值本身也可为合法载荷；未知标识抛出 `GRAPH_UNKNOWN_NODE`。'
    ),
    example: `${setup}\nawait graph.ready()\nconsole.log(graph.readValue(id))\nawait graph.dispose()`
  },
  nodes: p(
    'Frozen IDs in registration order, retained for diagnostic iteration.',
    '按登记顺序排列的冻结节点标识列表，用于诊断与遍历。'
  ),
  state: p(
    'Container transaction state from CapabilityGraphState, independent of node state.',
    '来自 `CapabilityGraphState` 的容器事务状态，与节点状态独立。'
  ),
  error: p(
    'Primary graph error retained through failure and terminal transitions, or undefined.',
    '跨失败和终态转换保留的图主错误，尚无失败时为 `undefined`。'
  ),
  dispose: {
    summary: t(
      'Closes admission, aborts startup and releases consumers before providers.',
      '关闭接纳并中止启动，按消费方先于提供方的顺序释放资源。'
    ),
    returns: t(
      'One shared Promise for repeated calls. Cleanup failures reject with GRAPH_DISPOSE_FAILED and original errors remain reachable; terminal graphs cannot restart.',
      '重复调用共享同一承诺；清理失败以 `GRAPH_DISPOSE_FAILED` 拒绝并保留原错误，终态图不能重新启动。'
    ),
    example: `${setup}\nawait graph.ready()\nawait graph.dispose()\nawait graph.dispose()`
  },
  get: {
    summary: t(
      'Reads a ready declared direct provider for a consumer; transitive or undeclared access is refused.',
      '为消费方读取已声明且就绪的直接提供方，拒绝访问传递依赖或未声明依赖。'
    ),
    params: {
      consumer: t(
        'Application-assigned id from the registered consumer definition.',
        '来自应用所登记消费方节点定义的 `id`。'
      ),
      provider
    },
    returns: t(
      'Exact provider payload; unavailable or undeclared access throws GRAPH_PROVIDER_UNAVAILABLE.',
      '返回提供方原始载荷；不可用或未声明的访问抛出 `GRAPH_PROVIDER_UNAVAILABLE`。'
    ),
    example: `${setup}\nconst consumer = 'reader' as IGraphNodeId\ngraph.register({ id: consumer, kind: 'service', dependencies: [{ provider: id, required: true }], start: context => ({ value: context.get(id), release() {} }) })\nawait graph.ready()\nconsole.log(graph.get(consumer, id))\nawait graph.dispose()`
  }
}
/** Graph lifecycle and native error classifications, preserving each branch's source meaning. */
const enums: ILibraryReference['enums'] = {
  CapabilityGraphState: {
    summary: t(
      'Container lifecycle shared by static and dynamic graphs, distinct from node state.',
      '静态图与动态图共用的容器生命周期状态，与节点状态独立。'
    ),
    values: {
      open: t(
        'Initial registration is open before graph startup.',
        '初始节点登记仍然开放，图尚未进入启动过程。'
      ),
      starting: t(
        'Providers and consumers are being started in dependency order.',
        '图正在按依赖顺序启动提供方与相应消费方。'
      ),
      ready: t(
        'Readiness completed and ready node payloads may be observed.',
        '图已完成就绪操作，可以读取已就绪节点的载荷。'
      ),
      failed: t(
        'Startup failed; inspect the primary error and node diagnostics.',
        '图启动发生失败，应读取主错误以及节点诊断。'
      ),
      quiescing: t(
        'Disposal closed admission and is waiting for cleanup.',
        '释放已关闭接纳，正在等待相关资源完成清理。'
      ),
      terminal: t(
        'The graph is terminal and cannot accept further work.',
        '图已进入释放终态，不能再次接纳新的工作。'
      )
    }
  },
  CapabilityGraphNodeState: {
    summary: t(
      'Per-node lifecycle states, including dependency blocking and rollback.',
      '逐节点的生命周期状态，包含依赖阻塞与启动回滚结果。'
    ),
    values: {
      registered: t(
        'The definition is registered without a started instance.',
        '节点定义已经登记，但尚无已接纳的启动实例。'
      ),
      starting: t(
        'The startup callback is running and has not yet been adopted.',
        '启动回调正在执行，尚未接纳其返回的实例。'
      ),
      ready: t(
        'An instance is adopted and can provide service.',
        '节点已接纳启动实例，可以向消费方提供服务。'
      ),
      suspended: t(
        'Service is paused while its definition remains available for resumption.',
        '节点服务已暂停，保留定义仍允许后续恢复。'
      ),
      failed: t(
        'This node failed startup and retains the original failure.',
        '该节点启动失败，诊断保留其原始失败原因。'
      ),
      blocked: t(
        'A required provider is unavailable; inspect the reason field.',
        '必需提供方当前不可用，应读取原因字段了解情况。'
      ),
      rolledBack: t(
        'Startup rollback released this node after another node failed.',
        '其他节点失败后，启动回滚已释放当前节点。'
      ),
      released: t(
        'Graph cleanup has released this node-owned instance.',
        '图的清理过程已释放当前节点所拥有的实例。'
      )
    }
  },
  GraphBlockedReason: {
    summary: t(
      'Provider-unavailability reasons carried by diagnostics rather than thrown codes.',
      '通过诊断携带的提供方不可用原因，不作为抛出的错误码。'
    ),
    values: {
      missing: t(
        'The required provider is absent from the current graph.',
        '当前图中缺少该节点所必需的提供方定义。'
      ),
      suspended: t(
        'A required provider or ancestor is currently suspended.',
        '必需提供方或其上游祖先当前处于暂停状态。'
      ),
      removed: t(
        'The required provider was explicitly removed from this graph.',
        '必需提供方已经从当前图中被显式移除。'
      ),
      failed: t(
        'Provider startup or its unattributed batch failed.',
        '提供方启动失败，或所属批次发生无法归因的失败。'
      )
    }
  },
  CapabilityGraphErrorCode: {
    summary: t(
      'Graph-owned stable codes under source @migaia/capability/graph; original causes stay reachable.',
      '来源为 `@migaia/capability/graph` 的图层稳定错误码，保留原始原因。'
    ),
    values: {
      graphDisposed: t(
        'A graph operation reached terminal disposal.',
        '图操作触及释放终态，应新建图后再继续工作。'
      ),
      graphFrozen: t(
        'Static registration was attempted after readiness froze it.',
        '就绪已冻结静态登记，新的节点不能再登记。'
      ),
      invalidNode: t(
        'A node, edge or startup result failed structural admission.',
        '节点、依赖边或启动结果未满足结构接纳要求。'
      ),
      duplicateNode: t(
        'A definition repeats an existing node identity.',
        '节点定义重复使用已存在的标识，应更换标识。'
      ),
      unknownProvider: t(
        'A static required provider is absent from the frozen registry.',
        '静态必需提供方不存在于已冻结的登记表中。'
      ),
      duplicateEdge: t(
        'A provider edge is repeated or an invalid self edge is supplied.',
        '提供方依赖边重复，或声明了非法的自身依赖。'
      ),
      dependencyCycle: t(
        'Required provider edges contain a dependency cycle.',
        '必需提供方依赖边形成依赖环，不能完成拓扑调度。'
      ),
      providerUnavailable: t(
        'A direct read or lease cannot access a ready provider.',
        '直接读取或租约获取无法访问所需的就绪提供方。'
      ),
      startFailed: t(
        'Node or batch startup failed; inspect the original cause.',
        '节点或批次启动失败，应沿原因链读取原始错误。'
      ),
      disposeFailed: t(
        'One or more graph-owned resource releases failed.',
        '一个或多个图拥有的资源在释放过程中发生失败。'
      ),
      admissionClosed: t(
        'New work arrived while the graph was quiescing.',
        '新工作到达正在静默释放的图，无法继续接纳。'
      ),
      unknownNode: t(
        'A query or mutation references an absent node identity.',
        '查询或修改引用不存在的节点，应检查标识的登记来源。'
      ),
      reentrantOperation: t(
        'A lifecycle callback synchronously reentered this graph.',
        '生命周期回调同步重入同一张图的受限操作。'
      ),
      invalidOption: t(
        'Factory options or auxiliary ownership descriptors are invalid.',
        '工厂选项或辅助所有权描述不满足接纳要求。'
      ),
      nodeHasDependents: t(
        'Reject-policy mutation still has required consumers.',
        '拒绝策略的修改仍存在必需消费方，不能直接执行。'
      ),
      mutationAdmissionTimeout: t(
        'A queued mutation exceeded its admission deadline before running.',
        '排队修改在执行前超过接纳截止时间，任务没有运行。'
      ),
      nodeNotSuspended: t(
        'Resume targeted a node that is not suspended.',
        '恢复操作指向未暂停节点，应先检查当前节点状态。'
      )
    }
  }
}
/** Public static graph instances, callbacks and diagnostic values. */
const types: Record<string, ITypeDoc> = {
  ICapabilityGraph: {
    summary: t(
      'Static dependency graph owning one frozen startup and reverse-order cleanup transaction.',
      '静态依赖图，拥有一次冻结的启动事务以及按依赖逆序执行的清理。'
    ),
    scenarios: [
      t(
        'Start fixed services and roll back partial startup on failure.',
        '启动固定的服务依赖，并在部分启动失败后回滚资源。'
      )
    ],
    example: `${setup}\nawait graph.ready()\nconsole.log(graph.readValue(id))\nawait graph.dispose()`,
    members
  },
  ICapabilityGraphOptions: {
    summary: t(
      'Graph failure reporter captured before lifecycle construction.',
      '在构造图生命周期对象前捕获的失败报告配置。'
    ),
    members: {
      onError: {
        ...p(
          'Receives (error) for contained or secondary failures. Return is ignored; reporter throws and rejected thenables reach the shared utils host exception queue without changing graph results.',
          '通过 `(error)` 接收受控或次级失败，不消费返回值，报告函数抛错或类承诺拒绝进入工具包共享宿主异常队列，不改变图结果。'
        ),
        default: t(
          '`undefined`: no external reporting sink is installed.',
          '`undefined`：不安装外部失败报告接收方。'
        )
      }
    }
  },
  IGraphNodeId: alias(
    'Application-assigned nonempty string branded as a node ID; registration never generates IDs.',
    '应用指定并带有节点标识类型的非空字符串，登记操作不会生成标识。'
  ),
  IGraphDependency: {
    summary: t(
      'Direct provider edge for a static graph node; required is always true.',
      '静态图节点声明的直接提供方依赖，必需标志始终为真。'
    ),
    members: {
      provider: { summary: provider },
      required: p(
        'Always true in static graphs; an absent provider rejects readiness.',
        '静态图中固定为 `true`，缺少提供方会使就绪拒绝。'
      )
    }
  },
  IGraphNodeDefinition: {
    summary: t(
      'Application definition captured before startup, owning ID, kind, provider facts and start callback.',
      '启动前捕获的应用定义，包含标识、分类、提供方事实及启动回调。'
    ),
    example: setup,
    members: {
      id: { summary: id },
      kind: p(
        'Nonempty application classification for diagnostics; it does not select a runtime.',
        '供诊断使用的非空应用分类，不会据此选择运行时。'
      ),
      dependencies: p(
        'Required array, with `[]` explicitly representing no dependencies. Each edge requires `provider: IGraphNodeId` and `required: true`; neither field has a default. Duplicate edges are rejected at registration; missing providers and cycles reject readiness.',
        '必填数组，无依赖须显式传 `[]`。每条边必须有 `provider: IGraphNodeId` 和 `required: true`，两者均无默认值。登记时拒绝重复边，就绪时拒绝缺失提供方与依赖环。'
      ),
      start: p(
        'Receives IGraphStartContext with nodeId, signal, get and own. Return a primary IGraphNodeInstance or its thenable; rejection fails startup and triggers rollback.',
        '接收含 `nodeId`、`signal`、`get` 与 `own` 的 `IGraphStartContext`，返回主资源 `IGraphNodeInstance` 或类承诺；拒绝使启动失败并触发回滚。'
      )
    }
  },
  IGraphNodeInstance: {
    summary: t(
      'Primary resource returned by startup; the static graph adopts its release exactly once.',
      '启动返回的主资源，静态图恰好接纳一次其释放职责。'
    ),
    members: {
      value: p(
        'Provider payload passed by original identity; its mutability remains application-owned.',
        '按原始身份交给消费方的提供方载荷，可变性仍由应用负责。'
      ),
      release: p(
        'Receives IGraphReleaseContext containing signal, nodeId and report; return void or completion thenable. Throws and rejections become cleanup failures.',
        '接收含 `signal`、`nodeId` 与 `report` 的 `IGraphReleaseContext`，返回空值或完成类承诺，抛错及拒绝成为清理失败。'
      )
    }
  },
  IGraphStartContext: {
    summary: t(
      'Graph-issued startup access to declared direct providers and provisional resource ownership.',
      '图签发的启动上下文，允许读取声明的直接提供方并暂存辅助资源所有权。'
    ),
    members: {
      nodeId: p(
        'Application-assigned ID from the definition whose start callback receives this context.',
        '来自接收当前启动上下文的节点定义的应用指定标识。'
      ),
      signal: p(
        'Native abort signal owned by this startup generation; stop work after it aborts.',
        '当前启动代拥有的原生中止信号，中止后应停止相应工作。'
      ),
      get: p(
        'Synchronous get(provider) returns an originally declared ready direct provider payload; otherwise throws GRAPH_PROVIDER_UNAVAILABLE.',
        '同步 `get(provider)` 返回原先声明且已就绪的直接提供方载荷，否则抛出 `GRAPH_PROVIDER_UNAVAILABLE`。'
      ),
      own: p(
        'Synchronous own(resource, descriptor) adopts an auxiliary resource into the provisional lifecycle scope and returns it unchanged. Invalid lifecycle descriptors throw; startup failure rolls back ownership.',
        '同步 `own(resource, descriptor)` 将辅助资源接纳到暂存生命周期作用域并原样返回；非法描述会抛错，启动失败时回滚所有权。'
      )
    }
  },
  IGraphReleaseContext: {
    summary: t(
      'Graph-issued primary cleanup context; secondary reports preserve the primary failure.',
      '图为主资源清理签发的上下文，次级报告不会替换原始主失败。'
    ),
    members: {
      signal: p(
        'Lifecycle-owned cancellation signal for this release boundary.',
        '当前释放边界由生命周期拥有的取消信号，供清理过程观察。'
      ),
      nodeId: p(
        'Application-assigned ID from the definition whose instance is being released.',
        '来自正在释放实例对应节点定义的应用指定标识。'
      ),
      report: p(
        'Synchronous report(error) receives secondary cleanup failure; no return is consumed and the primary failure remains unchanged.',
        '同步 `report(error)` 接收次级清理失败，不消费返回值，主失败仍保持不变。'
      )
    }
  },
  IGraphNodeDiagnostic: {
    summary: t(
      'Node diagnostic snapshot; dynamic graphs also attach binding-generation and scheduling metadata.',
      '节点诊断快照，动态图另附绑定代数以及拓扑调度元数据。'
    ),
    members: {
      id: { summary: id },
      kind: p(
        'Original application classification copied from the registered node definition.',
        '从已登记节点定义复制的原始应用分类，供诊断展示。'
      ),
      state: {
        ...p(
          'Node lifecycle state, independent of the graph container lifecycle.',
          '节点自身的生命周期状态，与图容器生命周期分开表达。'
        ),
        values: { enum: 'CapabilityGraphNodeState' }
      },
      value: p(
        'Static value is visible only while graph and node are ready; dynamic diagnostics expose the retained node payload.',
        '静态值仅在图与节点均就绪时可见，动态图诊断展示保留的节点载荷。'
      ),
      error: p(
        'Retained startup failure, or undefined when no failure was recorded.',
        '节点保留的启动失败，尚无失败记录时为 `undefined`。'
      ),
      reason: {
        ...p(
          'Provider unavailability that blocked this node through a required dependency.',
          '通过必需依赖阻塞此节点的提供方不可用原因。'
        ),
        values: { enum: 'GraphBlockedReason' }
      },
      binding: p(
        'Optional dynamic composition binding, maintained separately from the service payload.',
        '可选的动态图组合绑定，与节点服务载荷分别维护。'
      ),
      generation: p(
        'Dynamic lifecycle generation distinguishing this node replacement epoch.',
        '动态图中区分该节点替换前后实例世代的生命周期代数。'
      ),
      ordinal: p(
        'Stable dynamic registration ordinal retained across same-edge replacement.',
        '动态图稳定的登记序号，在同依赖边替换时保持不变。'
      ),
      rank: p(
        'Deterministic schedule position derived from canonical topology order.',
        '从规范拓扑顺序推导的确定性调度位置，供诊断比较。'
      ),
      level: p(
        'Dependency depth calculated by the canonical topology index.',
        '由规范拓扑索引计算的依赖深度，用于展示调度层级。'
      )
    }
  },
  ICapabilityGraphError: {
    summary: t(
      'Tagged native graph error carrying optional structured detail and a preserved original cause.',
      '附码的原生图错误，携带可选结构化详情并保留原始原因链。'
    ),
    members: {
      source: p(
        'Stable @migaia/capability/graph identity used alongside code for classification.',
        '稳定的 `@migaia/capability/graph` 来源，与错误码共同用于分类。'
      ),
      code: {
        ...p(
          'Stable graph failure classification for the failed contract or lifecycle operation.',
          '失败契约或生命周期操作对应的稳定图错误分类。'
        ),
        values: { enum: 'CapabilityGraphErrorCode' }
      },
      detail: p(
        'Optional structured node identities or provider facts from the failing operation.',
        '失败操作附带的可选结构化详情，例如节点标识或提供方事实。'
      )
    }
  },
  ICapabilityGraphErrorCode: alias(
    'Value union of stable graph error codes with original native failures on the cause chain.',
    '稳定图错误码的取值联合，原生失败仍可沿原因链追溯。'
  ),
  ICapabilityGraphState: alias(
    'Value union of CapabilityGraphState for container lifecycle diagnostics.',
    '`CapabilityGraphState` 的取值联合，用于容器生命周期诊断。'
  ),
  ICapabilityGraphNodeState: alias(
    'Value union of CapabilityGraphNodeState for individual node lifecycle diagnostics.',
    '`CapabilityGraphNodeState` 的取值联合，用于逐节点生命周期诊断。'
  )
}
/** Enum introductions are derived from each enum's own maintained semantics. */
const enumSymbols = Object.fromEntries(
  Object.entries(enums).map(([key, doc]) => [
    key,
    {
      role: key.endsWith('ErrorCode') ? ('error' as const) : ('constant' as const),
      purpose: t(
        `${doc.summary.en} Compare the documented exported values when handling this branch.`,
        `${doc.summary.zh}处理对应分支时应使用这些导出的稳定取值进行比较。`
      ),
      example: `console.log(${key})`
    }
  ])
)
/** Static and dynamic Graph entry reference; topology and planners have a separate owner. */
export const capabilityGraphReference: ILibraryReference = {
  modules: {
    graph: {
      summary: t(
        'Use this entry when services must start after their dependencies and stop in the opposite order. Import `@migaia/capability/graph` for dependency ordering; the root capability host manages feature switches rather than ordering services.\n\n`createCapabilityGraph()` creates the graph: register every service and its required dependencies before awaiting `ready()`, which starts them and rolls back startup failures. The first `ready()` freezes registration; choose `@migaia/capability/graph/dynamic` if services must be added or replaced while running.',
        '服务必须等待依赖就绪后启动，并在关闭时反向释放，需要使用此入口。从 `@migaia/capability/graph` 导入来管理依赖顺序；根入口的能力容器管理功能开关，不负责安排服务顺序。\n\n`createCapabilityGraph()` 创建依赖图，先登记全部服务及其必需依赖，再等待 `ready()` 启动；启动失败时会回滚已启动的资源。首次调用 `ready()` 后不能继续登记；需要运行中增加或替换服务时，应使用 `@migaia/capability/graph/dynamic`。'
      ),
      example: `${setup}\nawait graph.ready()\nawait graph.dispose()`
    },
    ...capabilityDynamicReference.modules
  },
  symbols: {
    ...enumSymbols,
    CAPABILITY_GRAPH_SOURCE: {
      role: 'error',
      purpose: t(
        'Stable @migaia/capability/graph source marker attached to graph failures. Compare it with CapabilityGraphErrorCode to distinguish graph errors from capability gate activation outcomes.',
        '附着于图失败的稳定来源 `@migaia/capability/graph`；与 `CapabilityGraphErrorCode` 一起判断，区分图错误与能力闸门的普通激活结果。'
      ),
      example: `import { CAPABILITY_GRAPH_SOURCE, CapabilityGraphErrorCode } from '@migaia/capability/graph'\nconsole.log(CAPABILITY_GRAPH_SOURCE, CapabilityGraphErrorCode.startFailed)`
    },
    createCapabilityGraph: {
      role: 'factory',
      purpose: t(
        'Creates a runtime-neutral static resource dependency graph: providers produce values used by consumers. Register all nodes before the first `ready()`, which freezes admission. Startup proceeds by dependency level, starting every node in a level before awaiting that level; cleanup reverses level and registration order. `options` defaults to `{}` and omitted `onError` is `undefined`. The graph owns rollback and resource release, without tracking reactive data changes.',
        '创建运行时无关的静态资源依赖图：提供方产出值，消费方使用它。首次 `ready()` 前须登记全部节点，此后登记被冻结。启动按依赖层级推进，同层节点全部开始后才等待该层；清理按层级和登记顺序的逆序执行。`options` 默认 `{}`，省略 `onError` 为 `undefined`。图负责回滚和资源释放，不跟踪响应式数据变化。'
      ),
      options: 'ICapabilityGraphOptions',
      returns: t(
        'Caller-owned ICapabilityGraph with one startup transaction and shared disposal Promise; invalid options throw GRAPH_INVALID_OPTION.',
        '返回调用方拥有的 `ICapabilityGraph`，具有一次启动事务与共享释放承诺；非法选项抛出 `GRAPH_INVALID_OPTION`。'
      ),
      exampleIntro: capabilityCases.createCapabilityGraph![0]!.problem,
      example: capabilityCases.createCapabilityGraph![0]!.example,
      exampleResult: capabilityCases.createCapabilityGraph![0]!.result,
      cases: capabilityCases.createCapabilityGraph
    },
    ...capabilityDynamicReference.symbols
  },
  types: { ...types, ...capabilityDynamicReference.types },
  enums: { ...enums, ...capabilityDynamicReference.enums },
  enhancers: {}
}
