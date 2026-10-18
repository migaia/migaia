/** Pure topology and dependency planning, checked against graph sources on 2026-10-17. */
import type { ILibraryReference, IMemberDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'
/** Builds bilingual reader text. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents one field without guessing its policy. */
const p = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Complete topology construction with caller-owned error adapters. */
const setup = `import { createTopologyIndex } from '@migaia/capability/graph/topology'
const index = createTopologyIndex({
  onCycle: path => { throw new TypeError(path.join(' / ')) },
  onInvalid: (reason, _nodeId, failure) => { throw new TypeError(reason, failure) }
})
index.add({ id: 'cache', dependencies: [] })
index.add({ id: 'reader', dependencies: [{ provider: 'cache', required: true }] })`
/** All topology IDs originate from caller-authored node definitions. */
const id = t(
  'Application-assigned id from a node admitted through index.add().',
  '来自应用通过 `index.add()` 接纳的节点定义的标识。'
)
/** Planner reads canonical topology without mutation authority. */
const indexParam = t(
  'ITopologyIndexReader from createTopologyIndex() or an open transaction; the planner only reads it.',
  '来自 `createTopologyIndex()` 或未结束事务的 `ITopologyIndexReader`，规划器只读取它。'
)
/** Planner runtime facts come from the composition owner, not a mirrored library state machine. */
const stateParam = t(
  'Synchronous application callback (id) => { activated, enabled, suspended, stale }; IDs come from this index. Return current runtime facts; throws propagate.',
  '应用提供的同步回调 `(id) => { activated, enabled, suspended, stale }`，标识来自此索引；返回当前运行时事实，抛错原样传播。'
)
/** Planner root identities are already admitted topology IDs. */
const roots = t(
  'Application-selected IDs already admitted to this index; duplicates do not create duplicate work.',
  '应用选择的、已接纳到此索引的标识，重复项不会生成重复工作。'
)
/** Synchronous completion of index mutation. */
const done = t(
  'No return value; the admitted topology update is complete.',
  '无返回值；已接纳的拓扑更新已经完成。'
)
/** Data-only planner output never executes the actions it describes. */
const planReturns = t(
  'A deeply frozen IDependencyPlan with steps, order, edges and blockedBy. No lifecycle operation is executed; invalid requests use graph errors and adapter failures propagate.',
  '返回深度冻结的 `IDependencyPlan`，含步骤、顺序、边和阻塞方；不会执行生命周期操作，非法请求通过图错误表达，适配器失败原样传播。'
)
/** Builds a complete method node from source-specific text, parameter facts and an example. */
const method = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Canonical index read surface shared by live indices and transaction overlays. */
const readers: Record<string, IMemberDoc> = {
  size: p(
    'Number of nodes currently present in this index or isolated transaction view.',
    '当前索引或隔离事务视图中实际存在的节点数量。'
  ),
  has: method(
    'Tests node membership without constructing a diagnostic.',
    '直接检查节点是否存在，不会构造额外诊断对象。',
    { id },
    t(
      'True when this view contains that node ID; false otherwise.',
      '当前视图包含此节点标识时返回真，否则返回假。'
    ),
    `${setup}\nconsole.log(index.has('cache'))`
  ),
  registrationOrdinal: method(
    'Reads the stable registration ordinal owned by this index or open transaction; removals never renumber surviving nodes.',
    '读取此索引或未结束事务拥有的稳定登记序号；删除节点不会重新编号现存节点。',
    { id },
    t(
      'The admitted node’s ordinal. Unknown IDs invoke onInvalid. Unlike snapshot().ordinal, this number is not densely compacted after removals.',
      '返回已准入节点的序号，未知标识调用 `onInvalid`；与 `snapshot().ordinal` 不同，删除后此序号不会压缩为连续值。'
    ),
    `${setup}\nconsole.log(index.registrationOrdinal('reader'))`
  ),
  dependencies: method(
    'Reads the frozen declared provider edges of one present node.',
    '读取一个现存节点已经冻结的直接提供方依赖边。',
    { id },
    t(
      'Provider edges in declaration order; an unknown node invokes onInvalid.',
      '返回按声明顺序排列的提供方依赖边，未知节点调用 `onInvalid`。'
    ),
    `${setup}\nconsole.log(index.dependencies('reader'))`
  ),
  dependents: method(
    'Reads present direct consumers split by required and optional edges.',
    '按必需与可选依赖边分类读取当前存在的直接消费方。',
    { id },
    t(
      'IGraphDependents containing registration-order required and optional consumer IDs.',
      '返回 `IGraphDependents`，包含按登记顺序排列的必需与可选消费方标识。'
    ),
    `${setup}\nconsole.log(index.dependents('cache'))`
  ),
  missing: method(
    'Reads declared provider edges whose providers are currently absent.',
    '读取已声明但其提供方当前不存在的直接依赖边。',
    { id },
    t(
      'Frozen missing required and optional edges in declaration order; unknown consumers invoke onInvalid.',
      '按声明顺序返回冻结的缺失必需与可选边，未知消费方调用 `onInvalid`。'
    ),
    `${setup}\nconsole.log(index.missing('reader'))`
  ),
  closure: method(
    'Collects roots and their transitive required consumers, excluding optional propagation.',
    '收集根节点及其传递必需消费方，不沿可选依赖传播。',
    { roots },
    t(
      'Frozen IDs in canonical provider-first order; unknown roots invoke onInvalid.',
      '返回按规范提供方优先顺序排列的冻结标识，未知根节点调用 `onInvalid`。'
    ),
    `${setup}\nconsole.log(index.closure(['cache']))`
  ),
  order: method(
    'Orders all present nodes or a validated subset by dependency level and registration ordinal.',
    '按依赖层级与登记序号排序全部现存节点或已校验子集。',
    {
      ids: t(
        'Optional iterable of application-assigned admitted IDs; omitted selects all nodes.',
        '可选的已接纳应用标识迭代对象，省略时选择全部节点。'
      )
    },
    t(
      'Frozen, deduplicated canonical IDs; unknown subset IDs invoke onInvalid.',
      '返回冻结且去重的规范标识顺序，子集中的未知标识调用 `onInvalid`。'
    ),
    `${setup}\nconsole.log(index.order(['reader', 'cache']))`
  ),
  snapshot: method(
    'Builds an immutable static projection with dense registration ordinals and read-only map facades.',
    '构造不可变静态投影，重新分配稠密登记序号，并提供只读映射视图。',
    {},
    t(
      'ICapabilityTopology with ordered nodes, provider/consumer maps, indegree, level and ordinal.',
      '返回 `ICapabilityTopology`，包含排序节点、双向依赖映射、入度、层级与序号。'
    ),
    `${setup}\nconsole.log(index.snapshot().ordered)`
  )
}
/** Canonical writer surface rejects nested base writes while a transaction owns mutation. */
const writers: Record<string, IMemberDoc> = {
  add: method(
    'Atomically adds a copied node and reconciles edges that previously named this missing provider.',
    '原子添加节点快照，并协调此前指向该缺失提供方的依赖边。',
    {
      node: t(
        'Application-owned nonempty id and direct required/optional dependencies. The index assigns a stable internal registration ordinal.',
        '应用提供的非空标识及直接必需或可选依赖，索引分配稳定的内部登记序号。'
      )
    },
    done,
    setup
  ),
  remove: method(
    'Removes one node while retaining consumers dangling provider facts for later reconciliation.',
    '移除一个节点，同时保留消费方指向缺失提供方的事实，供后续协调。',
    { id },
    done,
    `${setup}\nindex.remove('cache')\nconsole.log(index.missing('reader'))`
  ),
  setDependencies: method(
    'Atomically replaces direct dependencies and recomputes the affected topology; failed cycle admission leaves prior facts.',
    '原子替换直接依赖并重算受影响拓扑，依赖环接纳失败时保留原有事实。',
    {
      id,
      dependencies: t(
        'Application-created complete next provider-edge list, replacing all previous edges.',
        '应用构造的完整下一版提供方依赖列表，替换此前全部依赖边。'
      )
    },
    done,
    `${setup}\nindex.setDependencies('reader', [])`
  )
}
/** Open transaction composition shared by its complete runnable example. */
const transactionExample = `${setup}\nconst transaction = index.begin()\ntry {\n  transaction.add({ id: 'writer', dependencies: [{ provider: 'cache', required: true }] })\n  console.log(transaction.order())\n  transaction.commit()\n} catch (error) {\n  transaction.rollback()\n  throw error\n}`
/** Topology data and owner surfaces. */
const types: Record<string, ITypeDoc> = {
  ITopologyIndex: {
    summary: t(
      'Incremental canonical adjacency and scheduling owner returned by createTopologyIndex; no resources are started.',
      '由 `createTopologyIndex()` 返回的增量规范邻接与调度拥有者，不启动任何资源。'
    ),
    scenarios: [
      t(
        'Maintain dynamic provider facts without duplicating graph scheduling logic.',
        '维护动态提供方事实，同时复用统一的图调度语义。'
      )
    ],
    example: transactionExample,
    members: {
      ...readers,
      ...writers,
      begin: method(
        'Opens one isolated copy-on-write transaction and temporarily forbids base-index writes.',
        '打开一个隔离的写时复制事务，并暂时禁止基索引写入。',
        {},
        t(
          'ITopologyTransaction; pair commit() or rollback() to return mutation authority. Nested transactions invoke onInvalid(transaction-open).',
          '返回 `ITopologyTransaction`；用 `commit()` 或 `rollback()` 归还修改权，嵌套事务调用 `onInvalid` 报告事务已打开。'
        ),
        transactionExample
      )
    }
  },
  ITopologyIndexReader: {
    summary: t(
      'Read-only topology protocol implemented by canonical indices and open transaction views.',
      '规范索引与未结束事务视图共同实现的只读拓扑协议。'
    ),
    members: readers
  },
  ITopologyIndexWriter: {
    summary: t(
      'Mutation protocol implemented by an index or its current transaction owner.',
      '索引或当前事务拥有者实现的拓扑修改协议，确保唯一修改权。'
    ),
    members: writers
  },
  ITopologyTransaction: {
    summary: t(
      'Isolated copy-on-write topology view; commit or rollback closes it and restores base mutation authority.',
      '隔离的写时复制拓扑视图，提交或回滚会关闭它并归还基索引修改权。'
    ),
    scenarios: [
      t(
        'Admit several dependent definition updates atomically before publishing them.',
        '在发布前以一个事务原子接纳多项相关定义变更。'
      )
    ],
    example: transactionExample,
    members: {
      ...readers,
      ...writers,
      commit: method(
        'Publishes overlay changes to the parent and closes the transaction.',
        '把覆盖层变更发布给父索引，并关闭当前事务视图。',
        {},
        t(
          'No return value; later transaction use invokes onInvalid(transaction-closed).',
          '无返回值，之后使用事务会调用 `onInvalid` 报告事务已关闭。'
        ),
        transactionExample
      ),
      rollback: method(
        'Discards overlay changes and returns write authority to the unchanged parent.',
        '丢弃覆盖层变更，把写权限归还给保持原状的父索引。',
        {},
        t(
          'No return value; repeated rollback or any transaction access after settlement invokes onInvalid(transaction-closed).',
          '无返回值；结束后重复回滚或访问事务会调用 `onInvalid` 报告事务已关闭。'
        ),
        `${setup}\nconst transaction = index.begin()\ntransaction.remove('cache')\ntransaction.rollback()\nconsole.log(index.has('cache'))`
      )
    }
  },
  ITopologyIndexAdapter: {
    summary: t(
      'Application-owned throwing error adapters retained by the canonical topology owner.',
      '规范拓扑拥有者保留的应用错误适配器，回调必须抛出失败。'
    ),
    members: {
      onCycle: p(
        'Synchronous (path) callback receives a closed cycle of application node IDs and must throw its owning error; no return is allowed.',
        '同步 `(path)` 回调接收应用节点标识组成的闭合依赖环，必须抛出所属错误，不能正常返回。'
      ),
      onInvalid: {
        summary: t(
          'Synchronous error adapter for invalid topology input. It must throw; the pure boundary retains the selected native shell, receiver and identity and keeps captured original failures reachable through cause/errors.',
          '输入拓扑不合法时调用的同步错误适配器，必须抛错；纯拓扑边界保留所选原生外壳、接收者与身份，并沿原因或错误列表保留捕获的原始失败。'
        ),
        params: {
          reason: t(
            'TopologyInvalidReason selected by the canonical admission boundary.',
            '规范接纳边界选择的 `TopologyInvalidReason`，说明无效输入场景。'
          ),
          nodeId: t(
            'Application-assigned ID from the offending node when attributable; otherwise undefined.',
            '可归因时取自问题节点定义的应用标识，否则为空缺值。'
          ),
          failure: t(
            'Optional { cause } from a caught input access failure; cause is the exact original value, including undefined.',
            '输入访问抛错时提供的可选 `{ cause }`，原因保留精确原值，含空缺值。'
          )
        },
        returns: t(
          'Never returns normally; throw the caller-owned error. Captured original failures are retained automatically.',
          '不能正常返回；应抛出调用方拥有的错误，捕获的原始失败会自动保留。'
        ),
        example: setup
      }
    }
  },
  ITopologyIndexNode: {
    summary: t(
      'Minimal application node admitted by the incremental topology index without a caller ordinal.',
      '增量拓扑索引接纳的最小应用节点，无须由调用方指定序号。'
    ),
    members: {
      id: { summary: id },
      dependencies: p(
        'Complete direct provider-edge list supplied by the application; absent providers remain dangling.',
        '应用提供的完整直接提供方依赖列表，不存在的提供方保留为悬空边。'
      )
    }
  },
  ITopologyDependency: {
    summary: t(
      'Pure provider edge used by static topology projections and the incremental index.',
      '静态拓扑投影与增量索引共用的纯提供方依赖边。'
    ),
    members: {
      provider: p(
        'Nonempty application-assigned provider identity referenced by a node dependency list.',
        '节点依赖列表引用的、应用指定的非空提供方标识。'
      ),
      required: p(
        'True participates in required ordering and dependent closure; false remains an optional relationship.',
        '为真时参与必需排序与消费方闭包，为假时保留可选关系。'
      )
    }
  },
  ITopologyNode: {
    summary: t(
      'Static snapshot input with nonempty identity, copied provider facts and a dense public ordinal.',
      '静态快照输入，包含非空标识、复制的提供方事实与稠密公开序号。'
    ),
    members: {
      id: { summary: id },
      dependencies: p(
        'Complete direct required and optional provider edges captured before topology traversal.',
        '遍历拓扑前一次捕获的完整直接必需与可选提供方依赖边。'
      ),
      ordinal: p(
        'Application-supplied unique integer covering every value from zero to nodeCount minus one.',
        '应用提供的唯一整数，必须覆盖从零到节点数减一的每个取值。'
      )
    }
  },
  ICapabilityTopology: {
    summary: t(
      'Deeply frozen static projection from buildCapabilityTopology or index.snapshot. ReadonlyMap facades support standard forEach callback arguments and thisArg while exposing no mutation.',
      '由 `buildCapabilityTopology()` 或 `index.snapshot()` 产生的深度冻结静态投影；只读映射的遍历支持标准回调参数与接收者参数，不暴露修改能力。'
    ),
    scenarios: [
      t(
        'Inspect deterministic schedules and immutable provider/consumer relationships.',
        '查看确定性调度以及不可变的提供方与消费方关系。'
      )
    ],
    example: `${setup}\nconst topology = index.snapshot()\nconsole.log(topology.ordered, topology.level)`,
    members: {
      ordered: p(
        'Admitted node snapshots sorted by dependency level then registration ordinal.',
        '按依赖层级再按登记序号排列的已接纳节点快照。'
      ),
      providers: p(
        'Read-only provider-ID to present consumer-node mapping; returned maps cannot mutate the topology.',
        '提供方标识到当前消费节点的只读映射，返回映射不能修改拓扑。'
      ),
      consumers: p(
        'Read-only consumer-ID to original declared provider-edge mapping, including missing providers.',
        '消费方标识到原声明提供方依赖边的只读映射，包含缺失提供方。'
      ),
      indegree: p(
        'Count of present provider edges at snapshot admission, not a mutable traversal counter.',
        '快照接纳时当前存在的提供方依赖边数量，不是可变的遍历计数。'
      ),
      level: p(
        'Dependency depth for deterministic level scheduling of each admitted node.',
        '每个已接纳节点的依赖深度，用于确定性层级调度。'
      ),
      ordinal: p(
        'Dense registration ordinal projection of present nodes, independent of deleted internal ordinals.',
        '当前节点的稠密登记序号投影，与已删除的内部序号独立。'
      )
    }
  },
  ITopologyInvalidReason: {
    summary: t(
      'Value union of TopologyInvalidReason supplied to the caller-owned error adapter.',
      '传给调用方错误适配器的 `TopologyInvalidReason` 取值联合。'
    ),
    members: {}
  },
  IGraphDependents: {
    summary: t(
      'Immutable direct consumer lists split by required and optional edge kind.',
      '按必需与可选依赖边分别保存的不可变直接消费方列表。'
    ),
    scenarios: [
      t(
        'Inspect which direct consumers require a provider and which only observe it optionally.',
        '区分直接消费方中哪些必需提供方，哪些只进行可选观察。'
      )
    ],
    example: `${setup}\nconsole.log(index.dependents('cache'))`,
    members: {
      required: p(
        'Present direct required consumers in stable registration order; their closure participates in cascades.',
        '按稳定登记顺序排列的当前直接必需消费方，其闭包参与级联。'
      ),
      optional: p(
        'Present optional consumers in stable registration order, excluded from required cascades.',
        '按稳定登记顺序排列的当前可选消费方，不参与必需级联。'
      )
    }
  },
  IDependencyNodeState: {
    summary: t(
      'Orthogonal composition runtime facts read by pure planners, never maintained as another graph state machine.',
      '纯规划器读取的正交组合运行时事实，不另行维护一套图状态机。'
    ),
    members: {
      activated: p(
        'Whether an instance has ever been activated and retained for lifecycle planning.',
        '表示是否已经激活并保留实例，供生命周期规划判断。'
      ),
      enabled: p(
        'Whether application permission currently allows the node to serve.',
        '表示应用许可当前是否允许该节点对外提供服务。'
      ),
      suspended: p(
        'Whether the retained node is temporarily not serving because it is suspended.',
        '表示保留节点是否因暂停而暂时不再对外提供服务。'
      ),
      stale: p(
        'Whether a retained instance or binding is invalidated and needs restart rather than simple resume.',
        '表示保留实例或绑定是否已失效，需要重启而非直接恢复。'
      )
    }
  },
  IDependencyStateReader: {
    summary: t(
      'Application-supplied synchronous (id) reader returning IDependencyNodeState for an admitted ID; throws propagate and no asynchronous result is accepted.',
      '应用提供的同步标识读取函数，为已接纳标识返回 `IDependencyNodeState`；抛错原样传播，不接纳异步结果。'
    ),
    example: `const state = (id: string) => ({ activated: id === 'cache', enabled: true, suspended: false, stale: false })`,
    members: {}
  },
  IDependencyPlanStep: {
    summary: t(
      'One immutable proposed lifecycle action; the planner never executes it.',
      '一项不可变的拟执行生命周期动作，规划器本身不会执行。'
    ),
    members: {
      id: { summary: id },
      action: {
        ...p(
          'The action selected by the planner for this admitted node identity.',
          '规划器为当前已接纳节点标识选择的生命周期动作。'
        ),
        values: { enum: 'DependencyAction' }
      }
    }
  },
  IDependencyPlanEdge: {
    summary: t(
      'Immutable relationship metadata explaining required and optionally affected plan edges.',
      '解释必需依赖与受影响可选边的不可变关系元数据。'
    ),
    scenarios: [
      t(
        'Explain provider relationships of one planned frontier.',
        '解释一个拟执行前沿涉及的提供方依赖关系。'
      )
    ],
    example: `${setup}\nconst { collectPlanEdges } = await import('@migaia/capability/graph/dependency')\nconsole.log(collectPlanEdges(index, new Set(['cache', 'reader'])))`,
    members: {
      provider: p(
        'Application-assigned provider identity from the admitted dependency edge.',
        '来自已接纳依赖边的应用指定提供方节点标识。'
      ),
      consumer: p(
        'Application-assigned consumer identity whose definition declares this provider edge.',
        '定义中声明当前提供方依赖边的应用指定消费方标识。'
      ),
      optional: p(
        'True for an optional observation edge, false for a required provider relationship.',
        '为真表示可选观察边，为假表示必需提供方关系。'
      ),
      status: {
        ...p(
          'Optional relationship status; optional-absent marks a nonrequired missing provider.',
          '可选关系状态，`optional-absent` 表示非必需提供方当前缺失。'
        ),
        values: { enum: 'DependencyEdgeStatus' }
      }
    }
  },
  IDependencyEdgeStatus: {
    summary: t(
      'Value union marking optional provider absence in dependency plan edge metadata.',
      '在依赖计划边元数据中标记可选提供方缺失的取值联合。'
    ),
    members: {}
  },
  IDependencyPlan: {
    summary: t(
      'Deeply frozen proposed actions and relationship facts, returned without mutating runtime or topology.',
      '深度冻结的拟执行动作及关系事实，不会修改运行时或拓扑。'
    ),
    scenarios: [
      t(
        'Inspect a removal or restart frontier before the composition owner performs physical effects.',
        '在组合拥有者执行物理操作前查看移除或重启的影响前沿。'
      )
    ],
    example: `${setup}\nconst { planTeardown } = await import('@migaia/capability/graph/dependency')\nconsole.log(planTeardown(index))`,
    members: {
      steps: p(
        'Ordered immutable actions chosen by the planner; the composition owner executes them.',
        '规划器选择的有序不可变动作，具体执行由组合拥有者负责。'
      ),
      order: p(
        'Node IDs projected from steps in exactly the same order, including their selected action ordering.',
        '由步骤按完全相同顺序投影的节点标识，保留所选动作顺序。'
      ),
      edges: p(
        'Required internal edges and relevant optional relationships explaining the affected frontier.',
        '用于解释受影响前沿的内部必需边以及相关可选关系。'
      ),
      blockedBy: p(
        'Required dependents preventing a reject-policy mutation; a blocked plan has no steps.',
        '阻止拒绝策略修改的必需消费方，受阻计划不会包含执行步骤。'
      )
    }
  },
  IDependencyMutationRequest: {
    summary: t(
      'Pure removal or disable request with explicit required-dependent policy.',
      '显式指定必需消费方策略的纯移除或禁用规划请求。'
    ),
    members: {
      roots: { summary: roots },
      kind: {
        ...p(
          'Whether root and cascading work release definitions or disable instances.',
          '决定根节点及级联工作是释放定义还是禁用实例。'
        ),
        values: { enum: 'DependencyMutationKind' }
      },
      policy: {
        ...p(
          'Required-dependent rejection, cascade or suspension treatment chosen by the caller.',
          '调用方选择的必需消费方拒绝、级联或暂停处理方式。'
        ),
        values: { enum: 'DependencyPolicy' }
      }
    }
  },
  IDependencyReplacementRequest: {
    summary: t(
      'Plans consumer rebinding or restart after replacing one provider generation.',
      '在替换一个提供方世代后规划消费方的重绑或重启。'
    ),
    members: {
      target: p(
        'Application-assigned existing provider ID chosen for replacement.',
        '应用选择替换的现存提供方标识，来自已接纳节点定义。'
      ),
      canRebind: p(
        'Synchronous (id) => boolean callback receives a direct required consumer ID from the index. True permits rebind; false plans restart; throws propagate.',
        '同步 `(id) => boolean` 回调接收来自索引的直接必需消费方标识；真允许重绑，假规划重启，抛错原样传播。'
      )
    }
  },
  IDependencyResumeRequest: {
    summary: t(
      'Plans suspended frontier recovery after a provider becomes available again.',
      '在提供方重新可用后规划暂停消费方前沿的恢复动作。'
    ),
    members: {
      provider: p(
        'Application-assigned admitted provider ID whose availability was restored.',
        '可用性已恢复的应用指定提供方标识，来自已接纳节点。'
      ),
      generationChanged: p(
        'Whether the restored provider uses a different binding generation, requiring dependent rebind checks.',
        '表示恢复后的提供方是否采用不同绑定世代，从而需要检查消费方重绑。'
      ),
      canRebind: p(
        'Synchronous (id) => boolean receives direct consumer IDs from this index; true permits rebind after generation change, false requires restart. Throws propagate.',
        '同步 `(id) => boolean` 接收来自此索引的直接消费方标识，真允许世代变化后重绑，假要求重启，抛错原样传播。'
      )
    }
  }
}
/** Pure planning enum domains keep action, request kind and policy separate. */
const enums: ILibraryReference['enums'] = {
  TopologyInvalidReason: {
    summary: t(
      'Structural and transaction reasons supplied to the application error adapter.',
      '传给应用错误适配器的结构接纳及事务使用失败原因。'
    ),
    values: {
      invalidNode: t(
        'The node or provider descriptor is structurally invalid.',
        '节点或提供方描述不满足结构要求，应修正输入。'
      ),
      duplicateNode: t(
        'Two admitted definitions use the same node identity.',
        '两个已接纳定义使用同一节点标识，不能再次添加。'
      ),
      duplicateEdge: t(
        'A node repeats a provider edge in its dependency list.',
        '节点在自身依赖列表中重复声明同一个提供方边。'
      ),
      duplicateOrdinal: t(
        'Static input repeats a public registration ordinal.',
        '静态输入重复使用公开登记序号，应提供稠密唯一序号。'
      ),
      unknownNode: t(
        'An operation references a node absent from this view.',
        '操作引用当前视图中不存在的节点，应检查登记来源。'
      ),
      transactionOpen: t(
        'A nested transaction or base write conflicts with the open transaction.',
        '嵌套事务或基索引写入与当前未结束事务发生冲突。'
      ),
      transactionClosed: t(
        'A settled transaction is used again after commit or rollback.',
        '提交或回滚后再次使用已经结束的事务视图。'
      )
    }
  },
  DependencyPolicy: {
    summary: t(
      'How pure mutation planning treats required consumers of a changed provider.',
      '纯修改规划如何处理已变化提供方的必需消费方。'
    ),
    values: {
      reject: t(
        'Return blockedBy with no steps when non-root required consumers remain.',
        '仍有根节点外的必需消费方时返回阻塞方，不生成步骤。'
      ),
      cascade: t(
        'Apply root removal or disabling across the required consumer closure.',
        '把根节点移除或禁用应用到整个必需消费方闭包。'
      ),
      suspend: t(
        'Apply root action but suspend active required consumers while retaining them.',
        '根节点执行指定动作，其余活跃必需消费方暂停并保留实例。'
      )
    }
  },
  DependencyMutationKind: {
    summary: t(
      'Root mutation intent interpreted independently of the selected dependent policy.',
      '独立于消费方策略解释的根节点修改意图类型。'
    ),
    values: {
      remove: t(
        'Plan release actions for nodes selected by the mutation policy.',
        '为修改策略选中的节点规划对应的资源释放动作。'
      ),
      disable: t(
        'Plan disable actions for nodes selected by the mutation policy.',
        '为修改策略选中的节点规划对应的实例禁用动作。'
      )
    }
  },
  DependencyAction: {
    summary: t(
      'Proposed lifecycle work emitted by planners; callers execute these actions.',
      '规划器输出的拟执行生命周期工作，具体动作由调用方执行。'
    ),
    values: {
      release: t(
        'Release the selected definition and owned instance resources.',
        '释放选中的节点定义以及其拥有的实例资源。'
      ),
      disable: t(
        'Disable selected instances while preserving the owning definition.',
        '禁用选中的节点实例，同时保留其拥有的定义。'
      ),
      suspend: t(
        'Retain an activated consumer but stop it from serving temporarily.',
        '保留已经激活的消费方，但暂时停止对外提供服务。'
      ),
      resume: t(
        'Restore a retained suspended consumer whose providers are ready.',
        '在提供方就绪后恢复保留的暂停消费方实例。'
      ),
      rebind: t(
        'Notify a direct consumer to adopt a new provider binding without restart.',
        '通知直接消费方接纳新的提供方绑定，无须重启实例。'
      ),
      restart: t(
        'Reconstruct an activated instance after replacement or explicit restart.',
        '替换或显式重启后重新构造已激活的节点实例。'
      ),
      activate: t(
        'Start an inactive required provider before a requested activation root.',
        '在请求激活的根节点之前启动未激活的必需提供方。'
      ),
      invalidate: t(
        'Mark retained suspended work stale so recovery must reconstruct it.',
        '把保留的暂停工作标记失效，使恢复时必须重新构造。'
      )
    }
  },
  DependencyEdgeStatus: {
    summary: t(
      'Optional relationship metadata returned by pure dependency planners.',
      '纯依赖规划器返回的可选关系边状态元数据。'
    ),
    values: {
      optionalAbsent: t(
        'An optional provider is absent and does not block required work.',
        '可选提供方当前缺失，但不会阻塞必需工作执行。'
      )
    }
  }
}
/** Shared read protocol parameters for pure planning operations. */
const plannerParams = { index: indexParam, state: stateParam }
/** Creates the actual planner call together with its admitted index and runtime fact provider. */
const planExample = (name: string, args: string): string =>
  `${setup}\nconst { ${name} } = await import('@migaia/capability/graph/dependency')\nconst state = (id: string) => ({ activated: id === 'cache', enabled: true, suspended: false, stale: false })\nconsole.log(${name}(${args}))`
/** Pure planner symbols never pretend to perform their returned actions. */
const symbols: Record<string, ISymbolDoc> = {
  createTopologyIndex: {
    role: 'factory',
    purpose: t(
      'Creates an empty incremental topology index with copied error adapters. Add provider facts, inspect canonical order and open isolated transactions; no lifecycle resources are started or owned.',
      '创建带错误适配器快照的空增量拓扑索引；添加提供方事实，查看规范顺序并打开隔离事务，不启动或拥有任何生命周期资源。'
    ),
    params: {
      adapter: t(
        'Application callbacks onCycle(path) and onInvalid(reason, nodeId?, failure?) must synchronously throw caller-owned errors; IDs originate from node definitions and failure.cause is the captured original access failure, automatically retained by the pure owner.',
        '应用提供的 `onCycle(path)` 与 `onInvalid(reason, nodeId?, failure?)` 必须同步抛出调用方错误；标识来自节点定义，失败元数据的原因是捕获的原始访问失败，纯拓扑拥有者自动保留它。'
      )
    },
    returns: t(
      'ITopologyIndex with no disposal requirement; settle each transaction through commit or rollback.',
      '返回无须释放的 `ITopologyIndex`，每个事务必须通过提交或回滚结束。'
    ),
    example: transactionExample
  },
  buildCapabilityTopology: {
    role: 'operation',
    purpose: t(
      'Snapshots a static node set and builds deterministic provider adjacency, schedule levels and order. Validate all required providers, dense ordinals and cycles before exposing the immutable projection.',
      '对静态节点集合取快照，构建确定性的提供方邻接、调度层级与顺序；在暴露不可变投影前校验全部必需提供方、稠密序号和依赖环。'
    ),
    params: {
      nodes: t(
        'Application-authored static nodes with unique nonempty IDs and ordinals covering zero through nodeCount minus one.',
        '应用编写的静态节点，标识非空且唯一，序号覆盖零至节点数减一。'
      ),
      onUnknownProvider: t(
        'Synchronous (nodeId, provider) receives application IDs for an unknown required edge and must throw; the error propagates unchanged.',
        '同步 `(nodeId, provider)` 接收缺失必需依赖边两端的应用标识，必须抛错，错误原样传播。'
      ),
      onCycle: t(
        'Synchronous (path) receives a closed cycle of application IDs, rotated to its smallest registration ordinal, and must throw.',
        '同步 `(path)` 接收应用标识组成的闭合环，从最小登记序号开始排列，必须抛错。'
      ),
      onInvalid: t(
        'Synchronous (reason, nodeId?, failure?) receives structural TopologyInvalidReason, attributable application node ID and optional { cause } for captured access failures. Must throw; the boundary retains the original cause/errors without replacing the adapter-selected native error.',
        '同步 `(reason, nodeId?, failure?)` 接收结构性 `TopologyInvalidReason`、可归因应用标识与捕获访问失败的可选 `{ cause }`。必须抛错；边界保留原始原因或错误列表，不替换适配器选定的原生错误。'
      )
    },
    returns: t(
      'Deeply frozen ICapabilityTopology. Error adapters own failure construction; their errors propagate rather than being silently replaced.',
      '返回深度冻结的 `ICapabilityTopology`，失败由错误适配器构造并原样传播，不会静默替换。'
    ),
    example: `import { buildCapabilityTopology } from '@migaia/capability/graph/topology'\nconst fail = (reason: unknown): never => { throw new TypeError(String(reason)) }\nconst topology = buildCapabilityTopology([{ id: 'cache', dependencies: [], ordinal: 0 }], fail, fail, fail)\nconsole.log(topology.ordered)`
  },
  collectPlanEdges: {
    role: 'operation',
    purpose: t(
      'Collects internal required edges and relevant optional relationships for one affected node set. This is a read-only edge explanation, without mutation or lifecycle execution.',
      '为一组受影响节点收集内部必需边以及相关可选关系；这里只生成只读的依赖边说明，不执行拓扑修改或生命周期动作。'
    ),
    params: {
      index: indexParam,
      affected: t(
        'Application-selected set of admitted node IDs whose plan relationships should be described.',
        '应用选择的已接纳节点标识集合，指定需要描述计划关系的范围。'
      )
    },
    returns: t(
      'Frozen IDependencyPlanEdge list in canonical consumer and edge declaration order.',
      '返回按规范消费方及依赖边声明顺序排列的冻结 `IDependencyPlanEdge` 列表。'
    ),
    example: planExample('collectPlanEdges', "index, new Set(['cache', 'reader'])")
  },
  planDependencyMutation: {
    role: 'operation',
    purpose: t(
      'Plans removal or disable under reject, cascade or suspend policy. Required consumers determine the affected closure; a rejected policy returns blockedBy without performing or throwing the planned mutation.',
      '按拒绝、级联或暂停策略规划移除或禁用，由必需消费方决定影响闭包；策略受阻时返回阻塞方，不执行修改，也不把规划结果当作修改异常抛出。'
    ),
    params: {
      ...plannerParams,
      request: t(
        'Application-created roots, mutation kind and dependent policy. Invalid kind or policy throws GRAPH_INVALID_OPTION.',
        '应用构造的根节点、修改种类与消费方策略，非法种类或策略抛出 `GRAPH_INVALID_OPTION`。'
      )
    },
    returns: planReturns,
    example: planExample(
      'planDependencyMutation',
      "index, state, { roots: ['cache'], kind: 'remove', policy: 'reject' }"
    )
  },
  planRestart: {
    role: 'operation',
    purpose: t(
      'Plans one required-dependent restart closure in consumer-first order. Nodes never activated are skipped; retained suspended nodes are invalidated rather than immediately restarted.',
      '按消费方优先顺序规划一个必需消费方重启闭包；从未激活的节点会跳过，保留的暂停节点标记为失效而不立即重启。'
    ),
    params: { ...plannerParams, roots },
    returns: planReturns,
    example: planExample('planRestart', "index, state, ['cache']")
  },
  planReplacement: {
    role: 'operation',
    purpose: t(
      'Plans direct consumer rebinds before dependent-first restart closures after a provider replacement. Suspended retained consumers are invalidated, while inactive consumers are skipped.',
      '在提供方替换后先规划直接消费方重绑，再规划消费方优先的重启闭包；保留的暂停消费方标记失效，未激活消费方跳过。'
    ),
    params: {
      ...plannerParams,
      request: t(
        'Application provider target plus synchronous canRebind(id) deciding direct consumer support; IDs come from admitted topology.',
        '应用提供的替换目标及同步 `canRebind(id)`，判断直接消费方是否支持重绑；标识来自已接纳拓扑。'
      )
    },
    returns: planReturns,
    example: planExample(
      'planReplacement',
      "index, state, { target: 'cache', canRebind: () => true }"
    )
  },
  planResume: {
    role: 'operation',
    purpose: t(
      'Plans provider-first recovery through suspended required consumers whose providers can serve. Changed generations choose rebind or restart; stale blocked descendants remain invalidated.',
      '按提供方优先顺序恢复已暂停且上游可服务的必需消费方；世代变化时选择重绑或重启，失效且受阻的后代继续标记失效。'
    ),
    params: {
      ...plannerParams,
      request: t(
        'Application provider ID, generationChanged fact and synchronous canRebind(id) predicate; failures propagate without executing a plan.',
        '应用提供的提供方标识、世代是否变化及同步重绑判断，回调失败原样传播，不会执行计划。'
      )
    },
    returns: planReturns,
    example: planExample(
      'planResume',
      "index, state, { provider: 'cache', generationChanged: false, canRebind: () => true }"
    )
  },
  planActivation: {
    role: 'operation',
    purpose: t(
      'Plans only inactive required providers before requested activation roots, stopping traversal at activated providers. Roots themselves are excluded: the composition owner separately activates the requested nodes.',
      '只规划请求激活根节点之前的未激活必需提供方，遍历在已激活提供方处停止；结果不包含根节点本身，由组合拥有者另行激活请求节点。'
    ),
    params: { ...plannerParams, roots },
    returns: planReturns,
    example: planExample('planActivation', "index, state, ['reader']")
  },
  resolveInstallSet: {
    role: 'operation',
    purpose: t(
      'Selects non-lazy batch members and their required providers within the same batch. External already-installed providers and optional edges do not enlarge the immediate installation set.',
      '选择批次中非惰性成员及同批次内的必需提供方；外部已安装提供方与可选依赖边不会扩大需要立即安装的集合。'
    ),
    params: {
      index: indexParam,
      members: t(
        'Application-selected admitted IDs belonging to this installation batch.',
        '应用选择的当前安装批次成员标识，均已接纳到索引。'
      ),
      isLazy: t(
        'Synchronous (id) => boolean reads application activation policy for an admitted batch member; true postpones it unless required by a selected non-lazy member. Throws propagate.',
        '同步 `(id) => boolean` 读取已接纳批次成员的应用激活策略，真表示推迟，除非选中的非惰性成员依赖它；抛错原样传播。'
      )
    },
    returns: t(
      'Frozen read-only set in canonical order, including selected members and in-batch required providers. Standard forEach callbacks receive value/value/set and support thisArg; mutation remains unavailable.',
      '返回按规范顺序排列的冻结只读集合，包含选中成员及同批次必需提供方。标准遍历回调接收值、重复值与集合，并支持接收者参数，仍不可修改。'
    ),
    example: planExample('resolveInstallSet', "index, ['cache', 'reader'], id => id === 'cache'")
  },
  planTeardown: {
    role: 'operation',
    purpose: t(
      'Plans release of every present node in inverse canonical order, with consumers before providers. It describes ownership teardown without releasing or deleting any actual resource.',
      '按规范顺序的逆序规划所有现存节点释放，消费方先于提供方；只描述所有权清理，不实际释放资源或删除节点。'
    ),
    params: { index: indexParam },
    returns: planReturns,
    example: planExample('planTeardown', 'index')
  }
}
/** Each enum's symbol introduction retains its own canonical description. */
for (const [key, doc] of Object.entries(enums))
  symbols[key] = {
    role: 'constant',
    purpose: t(
      `${doc.summary.en} Select the documented value for its own operation; the table does not execute lifecycle work.`,
      `${doc.summary.zh}应按当前操作选择文档说明的取值，此常量表本身不会执行生命周期工作。`
    ),
    example: `console.log(${key})`
  }
/** Pure topology and dependency subpaths share canonical index and plan type documentation. */
export const capabilityTopologyReference: ILibraryReference = {
  modules: {
    'graph/topology': {
      summary: t(
        'Pure topology admission and incremental indices. Start with createTopologyIndex for updates, or buildCapabilityTopology for a static immutable projection with caller-owned error construction.',
        '纯拓扑接纳与增量索引入口；增量修改从 `createTopologyIndex()` 开始，静态不可变投影使用 `buildCapabilityTopology()`，错误构造归调用方负责。'
      ),
      example: setup
    },
    'graph/dependency': {
      summary: t(
        'Read-only dependency planners over a canonical topology index. Start with planDependencyMutation for removal policy, or planTeardown for complete release ordering; the composition owner executes returned actions.',
        '在规范拓扑索引上运行的只读依赖规划器入口；移除策略从 `planDependencyMutation()` 开始，整体释放用 `planTeardown()`，返回动作由组合拥有者执行。'
      ),
      example: planExample(
        'planDependencyMutation',
        "index, state, { roots: ['cache'], kind: 'remove', policy: 'cascade' }"
      )
    }
  },
  symbols,
  types,
  enums,
  enhancers: {}
}
