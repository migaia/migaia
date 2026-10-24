import type { ISymbolDoc, IText, ITypeDoc } from './contract.js'

/** Backend authors use these descriptions at the same finite shared rule boundary. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** One complete original-controller example covers this same options bag without fake resources. */
const iteratorExample = `import {
  createStorageHost, defineFeature, memoryBackendKind, memoryBackendPlugin
} from '@migaia/storage-host'
import { createBackendChangeIterator } from '@migaia/storage-host/authoring/backend'

const changes = defineFeature(memoryBackendKind, ({ featureExpose }) => ({
  capabilities: [], chain: {},
  api: { store: {
    async changes() {
      return createBackendChangeIterator(featureExpose.getChangeController()!, {
        orgId: this.orgId,
        channel: 'value',
        key: 'status',
        ctx: { timeoutMs: 1_000 },
        execute: (advance) => advance()
      })
    }
  }, transaction: {} }
}))
await using host = await createStorageHost({
  plugins: [memoryBackendPlugin(undefined, { changes })]
})
await using stream = await host.api.memory.changes()
const next = stream.next()
await host.backend('memory').set('status', 'ready')
console.log((await next).value?.kind)`

/** Iterator author options are captured once before subscribing to the original controller. */
export const storageHostChangeIteratorOptions = {
  orgId: {
    summary: t(
      'Canonical UUID from the original fixed call context; every next retains it.',
      '来自原固定调用上下文的规范组织编号，每次推进都保持该编号。'
    ),
    example: iteratorExample
  },
  channel: {
    summary: t(
      'Original invalidation channel filter; all accepts every matching-org business channel.',
      '原失效通道过滤，全部通道选项接受匹配组织的每个业务通道。'
    ),
    values: {
      value: t('Only text/value invalidations and broad events.', '只接受文本值失效与宽失效事件。'),
      bytes: t('Only bytes invalidations and broad events.', '只接受字节失效与宽失效事件。'),
      record: t('Only record invalidations and broad events.', '只接受记录失效与宽失效事件。'),
      all: t(
        'All business-channel invalidations for this fixed org.',
        '接受本固定组织的所有业务通道失效。'
      )
    },
    whenToUse: t(
      'Choose the original channel whose data the consumer caches.',
      '选择消费者缓存数据所属的原通道。'
    ),
    example: iteratorExample
  },
  key: {
    summary: t(
      'Optional text key from the original backend; broad invalidations still wake the consumer.',
      '来自原后端的可选文本键，宽失效事件仍唤醒消费者。'
    ),
    default: t(
      'Omitted: observe the selected channel without a key filter.',
      '省略时观察所选通道，不按键过滤。'
    ),
    example: iteratorExample
  },
  ctx: {
    summary: t(
      'Optional caller cancellation/timeout context, captured once for this iterator resource.',
      '本迭代器资源单次捕获的可选调用方取消与超时上下文。'
    ),
    default: t('Omitted: no caller signal or timer is added.', '省略时不增加调用方信号或定时器。'),
    example: iteratorExample
  },
  execute: {
    summary: t(
      'Optional original per-next pipeline callback receiving advance and the captured context; return the complete advance Promise.',
      '可选原逐次推进流水线回调，接收推进函数及捕获上下文，并返回完整推进承诺。'
    ),
    default: t(
      'Omitted: advance the original native iterator directly.',
      '省略时直接推进原生迭代器。'
    ),
    whenToUse: t(
      'Preserve the backend’s existing per-next execution boundary and accepted-work drain.',
      '需要保留后端已有逐次推进执行边界与已接纳工作排空时使用。'
    ),
    example: iteratorExample
  }
}

/** Pure authoring operations retain their existing backend owner and error family. */
export const storageHostAuthoringSymbols: Readonly<Record<string, ISymbolDoc>> = {
  assertKeyRange: {
    role: 'operation',
    purpose: t(
      'Validate optional canonical range bounds without retaining the detached snapshot; use snapshotKeyRange when later work needs the captured bounds.',
      '校验可选规范范围边界但不保留脱离快照；后续工作需要捕获边界时应使用 `snapshotKeyRange`。'
    ),
    params: {
      range: t('Caller-provided optional lower/upper range.', '调用方提供的可选上下界范围。'),
      backend: t(
        'The backend author’s kind label for diagnostics.',
        '后端作者为诊断提供的种类名称。'
      )
    },
    returns: t(
      'No result; malformed or empty-open bounds throw a coded contract error.',
      '无返回值；非法边界或空开区间抛出带语义码的契约错误。'
    )
  },
  snapshotKeyRange: {
    role: 'operation',
    purpose: t(
      'Capture each range option once and detach valid bounds before native I/O.',
      '在原生读写之前单次捕获各范围选项，并把合法边界与调用方可变对象脱离。'
    ),
    params: {
      range: t(
        'Optional caller-owned range; omission requests no bounds.',
        '调用方持有的可选范围，省略表示不限制边界。'
      ),
      backend: t('The backend author’s diagnostic kind label.', '后端作者提供的诊断种类名称。')
    },
    returns: t(
      'Independent IKeyRange or undefined; invalid flags/order reject before work starts.',
      '返回独立的 `IKeyRange` 或未定义值；非法标志与顺序在工作开始前拒绝。'
    )
  },
  encodeFlatStorageKey: {
    role: 'operation',
    purpose: t(
      'Encode an already validated structured key into the original reversible flat-key wire for text-oriented backends.',
      '把已通过校验的结构键编码为原可逆扁平键格式，供文本表示的后端持久化使用。'
    ),
    params: {
      value: t(
        'A validated IStorageKey from the contract admission boundary.',
        '来自契约准入边界且已经校验的 `IStorageKey`。'
      )
    },
    returns: t(
      'A k:-prefixed tagged string; this helper does not replace key admission.',
      '返回带 `k:` 前缀的标签字符串；该函数不替代键域准入校验。'
    )
  },
  decodeFlatStorageKey: {
    role: 'operation',
    purpose: t(
      'Decode the original flat-key representation with bounded recursion and canonical key validation.',
      '使用有界递归解码原扁平键表示，并交回规范键域校验，不建立另一套键规则。'
    ),
    params: {
      encoded: t(
        'Stored text emitted by encodeFlatStorageKey.',
        '由 `encodeFlatStorageKey` 产生的持久化文本。'
      ),
      backend: t(
        'Optional diagnostic kind; omission uses memory.',
        '可选诊断种类，省略使用内存后端名称。'
      )
    },
    returns: t(
      'A detached key, or undefined for malformed wire; structurally decoded but invalid keys retain the contract error.',
      '返回脱离键，格式损坏时返回未定义值；结构可解码但键域非法时保留契约错误。'
    )
  },
  isStorageKeyInRange: {
    role: 'operation',
    purpose: t(
      'Compare a validated key against the same canonical inclusive/open range semantics used by backend scans.',
      '按后端扫描共用的规范闭区间与开区间规则比较已校验键，不转换成另一种排序规则。'
    ),
    params: {
      key: t('The already-admitted logical storage key.', '已经通过准入的逻辑存储键。'),
      range: t(
        'Captured bounds, or undefined to accept every key.',
        '已捕获边界；未定义时接受所有键。'
      )
    },
    returns: t(
      'Whether the key satisfies every supplied bound.',
      '返回该键是否同时满足所有已提供的边界。'
    )
  },
  collectUniqueIndexOwners: {
    role: 'operation',
    purpose: t(
      'Validate one proposed native commit’s unique projections with same-record multi-entry deduplication.',
      '校验本次原生提交提案的唯一投影，同一记录的多值重复项按原规则去重。'
    ),
    params: {
      definitions: t(
        'Canonical definitions issued by record-index admission.',
        '记录索引准入产生的规范索引定义。'
      ),
      records: t(
        'Proposed logical keys and already-normalized index projections.',
        '提交提案中的逻辑键与已经规范化的索引投影。'
      ),
      backend: t(
        'The backend author’s kind label for conflict details.',
        '后端作者为冲突详情提供的种类名称。'
      ),
      errors: t(
        'Optional native error constructors; omission uses host errors.',
        '可选原生错误构造接点，省略时使用宿主错误。'
      )
    },
    returns: t(
      'A validation-local map of canonical index-value owners; undeclared indexes or another record’s owner reject before writes.',
      '返回本次校验局部的规范索引值拥有者映射；未声明索引或其它记录已拥有该值时在写入前拒绝。'
    )
  },
  planChannelWrite: {
    role: 'operation',
    purpose: t(
      'Resolve conflicts among value, bytes and record channels at one logical key before the original backend mutates its data.',
      '在原后端修改数据之前，解析同一逻辑键的值、字节与记录通道之间的冲突。'
    ),
    params: {
      key: t('The admitted logical key in this backend.', '本后端已经准入的逻辑键。'),
      attempted: t(
        'The channel that the original writer intends to change.',
        '原写入器准备修改的目标通道。'
      ),
      existing: t(
        'Actual channels reported present by the backend.',
        '由后端报告为实际存在的通道集合。'
      ),
      policy: t(
        'conflict rejects other channels; replace schedules their removal. Default is conflict.',
        '`conflict` 拒绝其它通道；`replace` 计划移除它们，缺省为 `conflict`。'
      ),
      backend: t('Diagnostic kind label; memory is the default.', '诊断种类名称，缺省为内存后端。'),
      onConflict: t(
        'Optional backend-owned Error constructor invoked with the original conflict details.',
        '可选后端错误构造回调，接收原始冲突详情并返回错误对象。'
      )
    },
    returns: t(
      'The ordered other-channel removal plan; no data is changed by this pure helper.',
      '返回保持原顺序的其它通道移除计划；该纯函数本身不修改任何数据。'
    )
  },
  createStorageOperationReporter: {
    role: 'factory',
    purpose: t(
      'Create a final diagnostic reporter for one backend operation without a global reporting singleton.',
      '为一次后端操作创建最终诊断报告接点，不引入全局报告单例或独立生命周期。'
    ),
    returns: t(
      'A reporter forwarding cleanup failures to the original console diagnostic boundary.',
      '返回报告函数，把清理失败交给原有控制台最终诊断边界。'
    )
  },
  createStorageOperationRuntime: {
    role: 'factory',
    purpose: t(
      'Allocate one operation-local runtime containing the default cleanup reporter.',
      '为本次操作分配包含缺省清理报告接点的运行对象，不跨调用共享操作状态。'
    ),
    returns: t(
      'A new runtime whose reporter belongs to this operation.',
      '返回新运行对象，其中报告接点归本次操作使用。'
    )
  },
  reportCleanupError: {
    role: 'operation',
    purpose: t(
      'Report secondary cleanup failures without changing the primary operation result, containing a throwing or rejecting reporter.',
      '报告次要清理失败并保留主要操作结局，同时收容报告函数自身抛出或拒绝的失败。'
    ),
    params: {
      reporter: t(
        'The operation’s original IStorageOperationReporter.',
        '本次操作原有的 `IStorageOperationReporter`。'
      ),
      error: t(
        'The exact secondary failure object, not a replacement message.',
        '准确的次要失败对象，不是替换后的消息文本。'
      )
    },
    returns: t(
      'No result; reporter failures reach the nonrecursive final diagnostic fallback.',
      '无返回值；报告失败进入不可递归的最终诊断回退。'
    )
  },
  createStorageToken: {
    role: 'operation',
    purpose: t(
      'Issue an opaque same-realm uniqueness token for generated keys, backend origins or native generations.',
      '为生成键、后端来源或原生代际发放不透明的同运行域唯一令牌，不把其格式当作业务标识。'
    ),
    returns: t(
      'Native entropy plus the original monotonic suffix; unsupported entropy access retains its cause.',
      '返回原生熵与原单调后缀；无法读取熵时保留原始错误原因。'
    )
  },
  safeJsonPayloadByteLength: {
    role: 'operation',
    purpose: t(
      'Measure UTF-8 bytes only for the existing JSON payload domain, failing closed for serialization errors or unsupported structured containers.',
      '只测量既有 JSON 值域的 UTF-8 字节；序列化失败或不支持的结构容器按封闭失败处理。'
    ),
    params: {
      value: t(
        'The caller’s candidate JSON payload before native writes.',
        '原生写入之前调用方提供的候选 JSON 负载。'
      )
    },
    returns: t(
      'Encoded bytes, zero for top-level undefined, or Number.MAX_SAFE_INTEGER when the payload cannot be measured faithfully.',
      '返回编码字节数，顶层未定义值为零；无法忠实测量时返回最大安全整数。'
    )
  },
  isStorageErrorFamily: {
    role: 'operation',
    purpose: t(
      'Recognize the original host/contract error family plus explicitly admitted native backend errors without replacing any error.',
      '识别原宿主与契约错误家族，以及明确准入的原生后端错误，始终不替换错误对象。'
    ),
    params: {
      value: t('The caught value to classify.', '需要分类的已捕获值。'),
      isBackendError: t(
        'Optional backend predicate; true explicitly admits its original Error.',
        '可选后端谓词，返回真时明确接纳其原始错误。'
      )
    },
    returns: t(
      'A type guard; matching objects retain their exact identity.',
      '返回类型守卫结果，匹配对象保留准确的原始身份。'
    )
  },
  normalizeError: {
    role: 'operation',
    purpose: t(
      'Preserve recognized errors and delegate only unknown failures to the native backend’s constructor.',
      '保留已识别错误，只把未知失败交给原生后端自身的错误构造函数。'
    ),
    params: {
      error: t('The original caught failure.', '原始捕获的失败对象。'),
      createFailure: t(
        'Backend constructor receiving the exact unknown cause and returning its coded Error.',
        '后端构造回调，接收准确未知原因并返回带语义码错误。'
      ),
      isBackendError: t('Optional original backend error predicate.', '可选的原后端错误类型谓词。')
    },
    returns: t(
      'The same recognized object, otherwise the backend-produced error retaining the cause.',
      '识别成功返回同一个对象，否则返回保留原因的后端错误。'
    )
  },
  invokeExtension: {
    role: 'operation',
    purpose: t(
      'Run one developer extension behind the existing storage cancellation and coded-error boundary.',
      '在既有存储取消与语义错误边界内执行一次开发者扩展，不新增执行预算或重试拥有者。'
    ),
    params: {
      fn: t(
        'The author callback, returning its value or Promise; thrown values follow extension normalization.',
        '作者回调，返回值或承诺；抛出值沿扩展错误规范化路径处理。'
      ),
      backend: t('Diagnostic kind supplied by the backend author.', '后端作者提供的诊断种类名称。'),
      operation: t('The original backend’s operation name.', '原后端发出的操作名称。'),
      extensionStage: t(
        'The existing schema, codec, migration, comparator, diagnostic or query callback phase.',
        '已有模式、编解码、迁移、比较器、诊断或查询回调阶段。'
      ),
      signal: t(
        'The already-merged original operation signal, if any.',
        '原操作已经合并的可选取消信号。'
      ),
      runtime: t(
        'The original operation runtime retaining cleanup reporting.',
        '保留清理报告接点的原操作运行对象。'
      ),
      normalizeFailure: t(
        'Optional backend-owned normalizer receiving exact failure, operation and phase.',
        '可选后端规范化回调，接收准确失败、操作名与阶段。'
      )
    },
    returns: t(
      'The callback result; cancellation and original coded errors retain their existing semantics and unknown failures remain reachable through cause.',
      '返回回调结果；取消与原语义错误保持既有规则，未知失败仍可沿原因链到达。'
    )
  },
  readAbortReason: {
    role: 'operation',
    purpose: t(
      'Read the original abort reason while retaining a throwing reason getter as the cancellation cause.',
      '读取原取消原因；原因取值器抛错时保留该原始错误作为取消原因，而非泄露未编码值。'
    ),
    params: { signal: t('The original optional abort signal.', '原有的可选取消信号。') },
    returns: t(
      'The exact reason or getter failure; undefined when no reason exists.',
      '返回准确原因或取值失败；没有原因时为未定义值。'
    )
  },
  throwIfAborted: {
    role: 'operation',
    purpose: t(
      'Check current cancellation at the native admission boundary and use the stable storage ABORTED error.',
      '在原生准入边界检查当前取消状态，使用稳定的存储取消语义码拒绝已取消操作。'
    ),
    params: { signal: t('The operation’s original optional signal.', '本次操作原有的可选信号。') },
    returns: t(
      'No result when live; ABORTED with the original reason when cancelled, INVALID_ARGUMENT for an unreadable aborted property.',
      '仍活跃时无返回值；已取消时保留原原因并报 `ABORTED`，取消状态不可读时报无效参数。'
    )
  },
  subscribeToAbort: {
    role: 'operation',
    purpose: t(
      'Subscribe once, close the aborted-state race and return idempotent cleanup that reports listener-removal failures.',
      '订阅一次取消并闭合状态竞态，返回幂等清理函数；移除监听失败由原报告接点处理。'
    ),
    params: {
      signal: t(
        'Optional original signal; absence creates a no-op cleanup.',
        '可选原信号，缺失时返回空操作清理函数。'
      ),
      onAbort: t(
        'Invoked when cancellation is observed, after subscription cleanup.',
        '观察到取消后，在订阅清理完成时调用的回调。'
      ),
      reporter: t('Original cleanup failure reporter.', '原有的清理失败报告函数。'),
      isBackendError: t(
        'Optional native backend predicate for preserving registration failures.',
        '可选原生后端谓词，用于保留订阅登记阶段的原始错误。'
      )
    },
    returns: t(
      'A callable unsubscribe; repeated cleanup does not remove or report twice.',
      '返回可调用的取消订阅函数，重复清理不会再次移除或重复报告。'
    )
  },
  mergeSignals: {
    role: 'operation',
    purpose: t(
      'Snapshot the operation context once and merge its timeout with the original caller signal through the shared cancellation owner.',
      '单次快照操作上下文，并经共享取消拥有者合并超时与调用方原信号。'
    ),
    params: {
      ctx: t(
        'The original caller operation context, or undefined.',
        '调用方原操作上下文，或未定义值。'
      ),
      reporter: t(
        'The operation reporter for timer and listener cleanup failures.',
        '用于定时器与监听器清理失败的本次操作报告函数。'
      )
    },
    returns: t(
      'Captured context, the effective signal and deterministic dispose callback; callers release it in finally.',
      '返回捕获上下文、实际信号和确定的清理回调，调用方在最终清理阶段释放。'
    )
  },
  withAbort: {
    role: 'operation',
    purpose: t(
      'Run one asynchronous native operation using the captured context and release its original timeout/listener resources in finally.',
      '使用捕获上下文执行一次异步原生操作，并在最终清理阶段释放原超时与监听资源。'
    ),
    params: {
      ctx: t(
        'Optional caller context, read once by mergeSignals.',
        '可选调用方上下文，由 `mergeSignals` 单次读取。'
      ),
      run: t(
        'The original work receives effective signal, detached context and operation-local reporter; it must return a Promise.',
        '原工作接收实际信号、脱离上下文与操作局部报告函数，必须返回承诺。'
      )
    },
    returns: t(
      'The original work result after cleanup; already-aborted calls never enter run.',
      '清理后返回原工作结果；入口已取消的调用不会进入工作回调。'
    )
  }
}

/** Small authoring aliases have one semantic owner; native implementations retain all resources. */
export const storageHostAuthoringTypes: Readonly<Record<string, ITypeDoc>> = {
  IStorageOperationReporter: {
    summary: t(
      'Operation-local secondary failure callback; a returned rejected thenable is contained by reportCleanupError.',
      '操作局部的次要失败回调；返回拒绝的异步结果时，由 `reportCleanupError` 收容报告失败。'
    ),
    members: {}
  },
  IStorageOperationRuntime: {
    scenarios: [
      t(
        'Carry one entry’s diagnostic reporter through original backend work.',
        '把一次入口的诊断报告接点传入原后端工作。'
      )
    ],
    example: `import { createStorageOperationRuntime } from '@migaia/storage-host/authoring/backend'\nconst runtime = createStorageOperationRuntime()\nconsole.log(typeof runtime.reporter)`,
    summary: t(
      'One asynchronous entry’s original cleanup diagnostics, never a cross-operation singleton.',
      '一次异步入口的原清理诊断对象，不跨操作共享，也不取得后端或资源关闭权。'
    ),
    members: {
      reporter: {
        summary: t(
          'Exact callback observing cleanup failures without replacing the operation result.',
          '观察清理失败的准确回调，不替换本次操作的主要结局。'
        )
      }
    }
  },
  IBackendValueCommit: {
    summary: t(
      'Original atomic text compare/write endpoint for prepared entity writes; native ownership and cancellation stay with the backend.',
      '准备好的实体写入使用原文本原子比较写接点，原生所有权与取消仍归后端拥有者。'
    ),
    members: {}
  },
  IChannelPresence: {
    summary: t(
      'Readonly set of actual value, bytes and record channels at one logical key, supplied by the real native owner.',
      '真实原生拥有者提供的只读集合，记录同一逻辑键上实际存在的值、字节与记录通道。'
    ),
    members: {}
  },
  IChannelMutationPlan: {
    scenarios: [
      t(
        'Check channel replacement before committing native data.',
        '提交原生数据之前检查通道替换计划。'
      )
    ],
    example: `import { planChannelWrite } from '@migaia/storage-host/authoring/backend'\nconst plan = planChannelWrite('theme', 'value', new Set(['record']), 'replace')\nconsole.log(plan.remove)`,
    summary: t(
      'Pure removal plan; callers must execute these exact other-channel removals in their original commit.',
      '纯通道移除计划；调用方必须在原提交中执行这些准确的其它通道移除工作。'
    ),
    members: {
      remove: {
        summary: t(
          'Other existing channels in the original presence iteration order.',
          '按原存在集合迭代顺序保留的其它已存在通道。'
        )
      }
    }
  },
  IChannelConflictDetails: {
    summary: t(
      'Original logical-key cross-channel conflict facts sent to the backend’s own error constructor.',
      '交给后端自身错误构造函数的原始逻辑键跨通道冲突事实，不包含数据修改权限。'
    ),
    members: {
      backend: {
        summary: t('The real backend kind issuing this conflict.', '发出本次冲突的真实后端种类。')
      },
      key: {
        summary: t(
          'The admitted logical key whose channels collide.',
          '发生通道冲突且已经准入的逻辑键。'
        )
      },
      existingChannel: {
        summary: t(
          'First existing conflicting channel in native presence order.',
          '原生存在顺序中第一个产生冲突的已有通道。'
        )
      },
      attemptedChannel: {
        summary: t('Channel requested by the rejected write.', '被拒绝写入原本请求的目标通道。')
      }
    }
  },
  IUniqueIndexOwner: {
    summary: t(
      'One proposed unique projected value and its canonical owning record identity, local to validation.',
      '一个提议的唯一投影值与其规范所属记录身份，只保留在本次校验局部映射中。'
    ),
    members: {
      indexName: {
        summary: t(
          'Name issued by the admitted record-index definition.',
          '来自已准入记录索引定义的名称。'
        )
      },
      indexValue: {
        summary: t(
          'Canonical projected storage key whose uniqueness is checked.',
          '需要检查唯一性的规范投影存储键。'
        )
      },
      owner: {
        summary: t(
          'Flat identity emitted by encodeFlatStorageKey for the owning record key.',
          '由 `encodeFlatStorageKey` 对所属记录键产生的扁平身份。'
        )
      }
    }
  }
}
