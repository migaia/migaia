/** Dynamic Graph composition reference, verified against graph/dynamic.ts on 2026-10-17. */
import type { ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'
/** Builds bilingual reader text. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents one field with explicit ownership semantics. */
const p = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Documents scalar aliases. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })
/** Composition callbacks deliberately own physical startup, cleanup and lease-fence waiting. */
const setup = `import { createDynamicCapabilityGraph } from '@migaia/capability/graph/dynamic'
import type { IGraphNodeId } from '@migaia/capability/graph'
const id = 'cache' as IGraphNodeId
const graph = createDynamicCapabilityGraph<string>({
  startBatch: entries => entries.map(entry => ({ value: entry.binding, release() {} })),
  releaseBatch: async (entries, fence) => {
    await fence
    for (const entry of [...entries].reverse()) {
      await entry.instance.release({ nodeId: entry.id, signal: new AbortController().signal, report: console.error })
    }
  },
  report: console.error
})
const node = { id, kind: 'service', dependencies: [], start: () => ({ value: 'cache', release() {} }) }
await graph.register(node, 'cache-v1')`
/** Node identity originates from the application definition. */
const id = t(
  'The application-assigned ID supplied through graph.register(node, binding).',
  '来自应用通过 `graph.register(node, binding)` 登记的节点标识。'
)
/** Shared mutation completion preserves the observable affected frontier. */
const result = t(
  'Promise of IGraphMutationResult with affected IDs, topologyChanged and generation. Invalid state or admission timeout rejects with a graph error.',
  '返回含受影响标识、拓扑是否变化及代数的 `IGraphMutationResult` 承诺；非法状态或接纳超时通过图错误拒绝。'
)
/** Dynamic graph operations delegate physical effects to composition-owned callbacks. */
const members: Record<string, IMemberDoc> = {
  nodes: p(
    'Current registered IDs in definition insertion order; removed definitions disappear.',
    '当前已登记标识按定义插入顺序排列，已移除定义不再出现。'
  ),
  state: p(
    'Graph container lifecycle, separate from each node and its binding availability.',
    '图容器的生命周期状态，与节点及其绑定的可用性分开表达。'
  ),
  generation: p(
    'Monotonic graph mutation generation used to distinguish committed lifecycle epochs.',
    '单调递增的图修改代数，用于区分已提交的生命周期世代。'
  ),
  register: {
    summary: t(
      'Snapshots and serializes admission of a dynamic definition and optional composition binding; ready graphs reconcile newly available required providers.',
      '保存并串行接纳动态定义及可选组合绑定，就绪图会协调新近可用的必需提供方。'
    ),
    params: {
      node: t(
        'Application-created ID, kind, dependencies and start recipe. The graph hands definitions to startBatch; it does not invoke start itself.',
        '应用创建的标识、分类、依赖与启动配方；图把定义交给 `startBatch`，本身不直接执行启动回调。'
      ),
      binding: t(
        'Optional application-owned binding associated with this exact generation, for example a composition host. Omitted means no binding.',
        '可选的应用绑定，关联当前精确世代，例如组合宿主；省略表示没有绑定。'
      )
    },
    returns: result,
    example: `${setup}\nawait graph.ready()\nawait graph.dispose()`
  },
  remove: {
    summary: t(
      'Removes a definition through reject or required-dependent cascade policy; cleanup precedes binding custody release.',
      '按拒绝或必需消费方级联策略移除定义，实例清理先于绑定托管释放。'
    ),
    params: {
      id,
      options: t(
        'Optional policy: cascade by default, or reject while required dependents remain.',
        '可选策略，默认 `cascade`；设为 `reject` 时存在必需消费方便拒绝。'
      )
    },
    returns: result,
    example: `${setup}\nawait graph.ready()\nconsole.log(await graph.remove(id))\nawait graph.dispose()`
  },
  suspend: {
    summary: t(
      'Suspends a node and required dependent frontier while retaining definitions for explicit recovery.',
      '暂停节点及必需消费方前沿，同时保留定义以便之后显式恢复。'
    ),
    params: {
      id,
      options: t(
        'Optional cascade policy by default; reject refuses a node with required dependents.',
        '可选策略默认级联，`reject` 拒绝暂停仍有必需消费方的节点。'
      )
    },
    returns: result,
    example: `${setup}\nawait graph.ready()\nawait graph.suspend(id)\nawait graph.resume(id)\nawait graph.dispose()`
  },
  resume: {
    summary: t(
      'Restarts a suspended provider and reconciles its affected required dependents; a non-suspended target rejects GRAPH_NODE_NOT_SUSPENDED.',
      '重新启动暂停的提供方并协调受影响的必需消费方，目标未暂停则拒绝为 `GRAPH_NODE_NOT_SUSPENDED`。'
    ),
    params: { id },
    returns: result,
    example: `${setup}\nawait graph.ready()\nawait graph.suspend(id)\nawait graph.resume(id)\nawait graph.dispose()`
  },
  dependentsOf: {
    summary: t(
      'Reads direct present consumers split by required and optional edge kind without starting or mutating them.',
      '按必需与可选边分类读取当前直接消费方，不会启动或修改节点。'
    ),
    params: { id },
    returns: t(
      'IGraphDependents with required and optional ID lists; unknown IDs throw GRAPH_UNKNOWN_NODE.',
      '返回带必需与可选标识列表的 `IGraphDependents`，未知标识抛出 `GRAPH_UNKNOWN_NODE`。'
    ),
    example: `${setup}\nconsole.log(graph.dependentsOf(id))\nawait graph.dispose()`
  },
  replace: {
    summary: t(
      'Replaces an existing node generation and binding, releases old custody and restarts affected instances; unchanged edges retain schedule metadata.',
      '替换现有节点世代与绑定，释放旧托管并重启受影响实例；依赖边不变时保留调度元数据。'
    ),
    params: {
      node: t(
        'Replacement definition using the application-assigned ID of an existing registration.',
        '应用提供的替换定义，使用已有登记的同一节点标识。'
      ),
      binding: t(
        'Application-owned next-generation binding; omitted replaces it with undefined.',
        '应用提供的下一代绑定，省略时替换为 `undefined`。'
      ),
      options: t(
        'Optional restartDependents defaults true. With false, onReplaced may rebind direct required dependents; absence or callback failure falls back to restarting their closure.',
        '可选 `restartDependents` 默认为真；为假时由 `onReplaced` 重绑直接必需消费方，缺少回调或回调失败则回退到重启其闭包。'
      )
    },
    returns: result,
    example: `${setup}\nawait graph.ready()\nconsole.log(await graph.replace(node, 'cache-v2'))\nawait graph.dispose()`
  },
  ready: {
    summary: t(
      'Queues reconciliation and batch startup for currently startable definitions; missing required providers remain blocked rather than starting.',
      '排队协调并批量启动当前可启动的定义，缺少必需提供方的节点保持阻塞而不启动。'
    ),
    returns: t(
      'Promise completing this serialized readiness operation; batch startup failure rejects GRAPH_START_FAILED with original cause. This is not the static graph canonical readiness Promise.',
      '返回本次串行就绪操作的完成承诺，批次启动失败以 `GRAPH_START_FAILED` 拒绝并保留原因；它不同于静态图的唯一就绪承诺。'
    ),
    example: `${setup}\nawait graph.ready()\nconsole.log(graph.nodeState(id))\nawait graph.dispose()`
  },
  nodeState: {
    summary: t(
      'Creates a current diagnostic including binding generation, retained value, errors and cached schedule rank.',
      '创建当前诊断，包含绑定代数、保留值、错误以及缓存的调度位置。'
    ),
    params: { id },
    returns: t(
      'IGraphNodeDiagnostic; unknown IDs throw GRAPH_UNKNOWN_NODE.',
      '返回 `IGraphNodeDiagnostic`，未知标识抛出 `GRAPH_UNKNOWN_NODE`。'
    ),
    example: `${setup}\nawait graph.ready()\nconsole.log(graph.nodeState(id))\nawait graph.dispose()`
  },
  getBinding: {
    summary: t(
      'Reads the retained composition binding without acquiring a lease or requiring node readiness.',
      '读取保留的组合绑定，不获取租约，也不要求节点已经就绪。'
    ),
    params: { id },
    returns: t(
      'Original binding or undefined for an unknown node or omitted binding. Use acquireBinding when observation must delay release.',
      '返回原绑定，未知节点或未提供绑定时为 `undefined`；观察期间需要延迟释放时使用 `acquireBinding()`。'
    ),
    example: `${setup}\nconsole.log(graph.getBinding(id))\nawait graph.dispose()`
  },
  acquireBinding: {
    summary: t(
      'Retains one exact ready binding generation. Pair with the returned lease release() before awaiting graph cleanup.',
      '保留一个精确的就绪绑定世代，须搭配返回租约的 `release()`，在等待图清理前归还。'
    ),
    params: { id },
    returns: t(
      'IGraphBindingLease with original value and idempotent release; absent, unready or undefined bindings throw GRAPH_PROVIDER_UNAVAILABLE.',
      '返回带原值与幂等归还函数的 `IGraphBindingLease`；缺少节点、未就绪或绑定为空时抛出 `GRAPH_PROVIDER_UNAVAILABLE`。'
    ),
    example: `${setup}\nawait graph.ready()\nconst lease = graph.acquireBinding(id)\ntry { console.log(lease.value) } finally { lease.release() }\nawait graph.dispose()`
  },
  dispose: {
    summary: t(
      'Immediately closes admission and queues final physical cleanup and binding release; terminal cleanup clears definitions.',
      '立即关闭接纳并排队最终物理清理与绑定释放，终态清理会清空节点定义。'
    ),
    returns: t(
      'One shared disposal Promise. Composition releaseBatch must honor the lease fence; releaseBinding failures are reported, while releaseBatch failures reject disposal.',
      '返回唯一共享释放承诺；组合的 `releaseBatch` 必须遵守租约屏障，`releaseBinding` 失败会报告，`releaseBatch` 失败则拒绝释放。'
    ),
    example: `${setup}\nawait graph.ready()\nawait graph.dispose()\nawait graph.dispose()`
  }
}
/** Exact binding custody release reasons. */
const bindingReasons = {
  summary: t(
    'Why an exact binding generation leaves graph custody after instance cleanup.',
    '实例清理完成后，精确绑定世代离开图托管的具体原因。'
  ),
  values: {
    remove: t(
      'The definition and its exact binding are removed from the graph.',
      '节点定义及其精确绑定一起从当前图中被移除。'
    ),
    replace: t(
      'Replacement relinquishes custody of the previous binding generation.',
      '替换操作交还前一个绑定世代对应的托管职责。'
    ),
    dispose: t(
      'Terminal graph cleanup relinquishes every remaining binding.',
      '图的终态清理交还全部剩余绑定的托管职责。'
    )
  }
}
/** Dynamic options require composition owners for physical startup and cleanup. */
const types: Record<string, ITypeDoc> = {
  IDynamicCapabilityGraph: {
    summary: t(
      'Serialized dependency graph owning ordering and exact binding custody; composition callbacks own physical resources.',
      '串行依赖图拥有调度与精确绑定托管，物理资源由组合回调负责。'
    ),
    scenarios: [
      t(
        'Replace or suspend service bindings while preserving required-provider availability and consumer leases.',
        '替换或暂停服务绑定，同时维护必需提供方可用性以及消费方租约。'
      )
    ],
    example: `${setup}\nawait graph.ready()\nconst lease = graph.acquireBinding(id)\nconsole.log(lease.value)\nlease.release()\nawait graph.replace(node, 'cache-v2')\nawait graph.dispose()`,
    members
  },
  IDynamicCapabilityGraphOptions: {
    summary: t(
      'Composition-owned callbacks for batch startup, lease-aware release and contained reporting.',
      '组合层提供的批次启动、遵守租约的释放与隔离报告回调配置。'
    ),
    members: {
      report: {
        ...p(
          'Receives original contained startup, release and late failure as error; return is ignored and own throws/rejections are contained.',
          '以 `error` 接收受控的原始启动、释放或迟到失败，不消费返回值，其自身抛错与拒绝会隔离。'
        ),
        default: t(
          'Omitted: no external failure reporter is called.',
          '省略时不会调用外部失败报告接收方。'
        )
      },
      mutationAdmissionMs: {
        ...p(
          'Maximum queued wait in milliseconds before a mutation starts; finite nonnegative values only.',
          '修改开始前允许在队列中等待的最长毫秒数，仅接纳有限非负值。'
        ),
        default: t(
          'Omitted: the mutation queue has no admission deadline.',
          '省略时修改队列不设置接纳截止时间。'
        )
      },
      startBatch: p(
        'Required callback receives topologically ordered IGraphStartEntry entries, each with id, binding and definition. Return one instance per entry in the same order, synchronously or by thenable. The owner must construct and roll back physical resources; throw/rejection becomes GRAPH_START_FAILED.',
        '必需回调接收按拓扑排序的 `IGraphStartEntry` 列表，每项含标识、绑定与定义；同步或异步按同序返回每项的实例，拥有者负责物理构造与回滚，抛错或拒绝转换为 `GRAPH_START_FAILED`。'
      ),
      releaseBatch: p(
        'Required callback receives provider-first IGraphReleaseEntry entries and a Promise fence that resolves when sealed generation leases drain. Await the fence before physical teardown, release consumers first, and return void or completion thenable. Failure rejects the operation.',
        '必需回调接收提供方在前的 `IGraphReleaseEntry` 列表及租约归零屏障承诺；应先等待屏障再按消费方优先物理释放，返回空值或完成类承诺，失败会拒绝当前操作。'
      ),
      releaseBinding: {
        ...p(
          'Receives an exact IGraphBindingReleaseEntry after successful instance cleanup for removal, replacement or disposal. Return void or completion thenable; failures are reported without replacing the primary result.',
          '在移除、替换或终态实例清理成功后接收精确的 `IGraphBindingReleaseEntry`，返回空值或完成类承诺；失败会报告而不替换主结果。'
        ),
        default: t(
          'Omitted: graph relinquishes bindings without a composition release callback.',
          '省略时图交还绑定，但不调用组合层绑定释放回调。'
        )
      }
    }
  },
  IDynamicGraphDependency: {
    summary: t(
      'Dynamic direct provider edge; optional absence never blocks required startup or cascades.',
      '动态直接提供方依赖边，可选提供方缺失不会阻塞必需启动或触发级联。'
    ),
    members: {
      provider: p(
        'Application-assigned provider ID from registered definitions; missing IDs may be retained as pending edges.',
        '来自应用登记定义的提供方标识，缺失标识可以保留为待满足的依赖边。'
      ),
      required: p(
        'True requires provider readiness and participates in cascades; false is an optional observation edge.',
        '为真时要求提供方就绪并参与级联，为假时仅表示可选观察依赖。'
      )
    }
  },
  IDynamicGraphNodeDefinition: {
    summary: t(
      'Static node recipe with dynamic required or optional edges, handed to the composition startup owner.',
      '使用动态必需或可选依赖边的静态节点配方，交给组合层启动拥有者执行。'
    ),
    members: {
      id: { summary: id },
      kind: p(
        'Nonempty application classification passed through to composition startup and diagnostics.',
        '交给组合启动拥有者与诊断使用的非空应用分类。'
      ),
      start: p(
        'Original node start recipe receives IGraphStartContext and returns a node instance or thenable. The dynamic graph only passes this definition to startBatch; the composition owner decides how to execute and roll it back.',
        '原始节点启动配方接收 `IGraphStartContext`，返回节点实例或类承诺；动态图只把定义交给 `startBatch`，如何执行及回滚由组合拥有者决定。'
      ),
      dependencies: p(
        'Application-authored direct required and optional provider list copied at admission.',
        '应用声明的直接必需与可选提供方列表，在接纳时复制快照。'
      )
    }
  },
  IGraphMutationResult: {
    summary: t(
      'Result after a serialized mutation commits its affected frontier and graph generation.',
      '串行修改提交后返回的受影响前沿、拓扑变化及图代数结果。'
    ),
    members: {
      affected: p(
        'Application-assigned node IDs selected by this mutation in canonical order.',
        '本次修改选中的应用节点标识列表，按规范顺序排列。'
      ),
      topologyChanged: p(
        'Whether this operation changed graph definitions or provider edges, rather than only lifecycle state.',
        '表示本次是否修改图定义或提供方依赖边，而不只是生命周期状态。'
      ),
      generation: p(
        'Graph generation captured after this mutation committed.',
        '本次修改提交后捕获的图代数，用于比较生命周期世代。'
      )
    }
  },
  IGraphDependencyMutationPolicy: alias(
    'Dynamic remove/suspend policy accepts reject or cascade; the pure planner suspend policy is excluded.',
    '动态移除与暂停只接纳拒绝或级联策略，不接纳纯规划器的暂停策略。'
  ),
  IGraphDependencyMutationOptions: {
    summary: t(
      'Controls required-dependent treatment for dynamic removal and suspension.',
      '控制动态移除或暂停时如何处理仍然存在的必需消费方。'
    ),
    members: {
      policy: {
        ...p(
          'Reject refuses required dependents; cascade includes their required closure.',
          '拒绝策略阻止影响必需消费方，级联策略纳入其必需依赖闭包。'
        ),
        default: t(
          'cascade: include the required-dependent frontier.',
          '默认 `cascade`，纳入必需消费方前沿。'
        ),
        values: {
          reject: t(
            'Reject while required dependents still exist.',
            '仍存在必需消费方时拒绝当前修改。'
          ),
          cascade: t(
            'Apply the operation across required dependents.',
            '把当前操作应用到必需消费方闭包。'
          )
        }
      }
    }
  },
  IGraphReplaceOptions: {
    summary: t(
      'Chooses dependent restart or an explicit composition rebind callback on replacement.',
      '在替换时选择重启消费方，或交给显式组合重绑回调处理。'
    ),
    members: {
      restartDependents: {
        ...p(
          'True restarts the affected closure; false first tries notifying direct required dependents.',
          '为真时重启受影响闭包，为假时先尝试通知直接必需消费方。'
        ),
        default: t(
          'true: restart the affected dependent closure.',
          '默认 `true`，重启受影响的消费方闭包。'
        )
      },
      onReplaced: {
        ...p(
          'When restartDependents is false, receives dependent ID from registration and nextBinding from replace(). Return void or thenable; absence or failure falls back to restarting that consumer closure, with failures reported.',
          '当不直接重启时，接收来自登记的消费方标识与来自替换调用的下一代绑定，返回空值或类承诺；回调缺少或失败时回退到重启该消费方闭包，失败同时报告。'
        ),
        default: t(
          'Omitted: consumers are restarted even when restartDependents is false.',
          '省略时，即使不直接重启标志为假，消费方也会回退到重启。'
        )
      }
    }
  },
  IGraphBindingLease: {
    summary: t(
      'Lease of an exact ready binding generation; releasing observation permits composition teardown.',
      '精确就绪绑定世代的租约，归还观察权后组合层才能完成释放。'
    ),
    scenarios: [
      t(
        'Hold a binding while an asynchronous consumer still observes it.',
        '在异步消费方仍观察绑定时暂时保留该绑定世代。'
      )
    ],
    example: `${setup}\nawait graph.ready()\nconst lease = graph.acquireBinding(id)\ntry { console.log(lease.value) } finally { lease.release() }\nawait graph.dispose()`,
    members: {
      value: p(
        'Exact original composition binding captured by acquireBinding, never a cloned payload.',
        '由 `acquireBinding()` 捕获的组合绑定原值，不是复制后的载荷。'
      ),
      release: p(
        'Synchronous no-argument idempotent function returning void; returns this lease once so its sealed generation can drain.',
        '同步无参数幂等函数，返回空值，恰好归还此租约一次，使已封闭世代能够归零。'
      )
    }
  },
  IGraphBindingReleaseReason: alias(
    'Value union describing why exact binding custody is relinquished after cleanup.',
    '描述清理后为何交还精确绑定托管职责的原因取值联合。'
  ),
  IGraphBindingReleaseEntry: {
    summary: t(
      'Exact binding generation supplied to the composition custody release callback.',
      '交给组合层托管释放回调的精确绑定世代信息。'
    ),
    members: {
      id: { summary: id },
      binding: p(
        'Original non-undefined binding of the generation leaving graph custody.',
        '即将离开图托管的世代所持有的非空原始绑定。'
      ),
      reason: {
        ...p(
          'Removal, replacement or terminal disposal that ended custody of this binding.',
          '终止当前绑定托管的原因，分别为移除、替换或终态释放。'
        ),
        values: { enum: 'GraphBindingReleaseReason' }
      }
    }
  },
  IGraphStartEntry: {
    summary: t(
      'Immutable definition and binding view passed to the composition batch startup owner.',
      '交给组合批次启动拥有者的不可变节点定义与绑定视图。'
    ),
    members: {
      id: { summary: id },
      binding: p(
        'Optional application binding of this generation, supplied at registration or replacement.',
        '在登记或替换时由应用提供的当前世代可选绑定。'
      ),
      definition: p(
        'Admitted immutable node recipe including kind, direct dependencies and original start callback.',
        '已接纳的不可变节点配方，含分类、直接依赖与原始启动回调。'
      )
    }
  },
  IGraphReleaseEntry: {
    summary: t(
      'Exact adopted instance and binding passed to the composition physical release owner.',
      '交给组合物理释放拥有者的精确接纳实例与绑定信息。'
    ),
    members: {
      id: { summary: id },
      binding: p(
        'Optional binding belonging to the instance generation being released.',
        '属于正在释放实例世代的可选组合绑定原值。'
      ),
      instance: p(
        'Original adopted node instance whose physical release belongs to releaseBatch.',
        '原始已接纳节点实例，其物理释放由 `releaseBatch` 负责。'
      )
    }
  }
}
/** Complete dynamic entry reference, sharing graph diagnostics through the parent module. */
export const capabilityDynamicReference: ILibraryReference = {
  modules: {
    'graph/dynamic': {
      summary: t(
        'Serialized dynamic graphs for composition owners. Start with createDynamicCapabilityGraph and provide both physical batch owners; register, ready, lease, replace and finally dispose.',
        '面向组合拥有者的串行动态图入口；从 `createDynamicCapabilityGraph()` 开始并提供两类物理批次回调，然后登记、就绪、获取租约、替换并最终释放。'
      ),
      example: `${setup}\nawait graph.ready()\nawait graph.dispose()`
    }
  },
  symbols: {
    createDynamicCapabilityGraph: {
      role: 'factory',
      purpose: t(
        'Creates a serialized dynamic graph with required-edge reconciliation and exact binding-generation custody. Ordering belongs to the graph; mandatory startBatch and releaseBatch callbacks own physical resources.',
        '创建串行动态图，协调必需依赖边并托管精确绑定世代；调度顺序由图负责，物理资源由必需的 `startBatch` 与 `releaseBatch` 回调负责。'
      ),
      options: 'IDynamicCapabilityGraphOptions',
      returns: t(
        'Caller-owned IDynamicCapabilityGraph. Missing batch owners or invalid nonnegative admission budget throw GRAPH_INVALID_OPTION; dispose it when composition ends.',
        '返回调用方拥有的 `IDynamicCapabilityGraph`；缺少批次拥有者或接纳预算不是非负有限值时抛出 `GRAPH_INVALID_OPTION`，组合结束后须释放。'
      ),
      example: `${setup}\nawait graph.ready()\nawait graph.dispose()`
    },
    GraphBindingReleaseReason: {
      role: 'constant',
      purpose: t(
        'Stable remove, replace and dispose reasons passed to releaseBinding after exact instance cleanup. They identify custody changes rather than graph errors or permission states.',
        '实例清理后交给 `releaseBinding` 的稳定移除、替换与释放原因；用于标识托管变化，不作为图错误或许可状态使用。'
      ),
      example: `import { GraphBindingReleaseReason } from '@migaia/capability/graph/dynamic'\nconsole.log(GraphBindingReleaseReason.replace)`
    }
  },
  types,
  enums: { GraphBindingReleaseReason: bindingReasons },
  enhancers: {}
}
