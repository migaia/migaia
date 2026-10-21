/**
 * Local diagnostics reference, checked against current source, README and USEGUIDE on 2026-10-18.
 * History uses maxHistory; actions and trace each use maxTrace. Extension command ownership lives
 * in @migaia/store-middleware as ReduxDevToolsCommand, not in this local diagnostic package.
 * Disposal propagates a single cleanup failure unchanged, and aggregates only multiple failures.
 */
import type { ILibraryReference, IMemberDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'
import { storeDevtoolsCases } from './store-devtools-cases.js'
/** Builds bilingual text without locale fallback. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents one diagnostic value. */
const p = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Basic session input belongs to store-light; the diagnostic session never owns that store. */
const setup = `import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'
const store = createStore({ count: 0 })
const tools = createStoreDevTools(store)`
/** Complete session example records, replays and releases only the diagnostic subscription. */
const session = `${setup}\nconst anchor = tools.record('before-change')\nstore.$batch(draft => { draft.count++ })\ntools.jumpTo(anchor.id)\nconsole.log(tools.history, tools.actions, tools.trace)\ntools.dispose()\nstore.$dispose()`
/** Public runtime graph handles used without a diagnostic session. */
const treeSetup = `import { createRuntime } from '@migaia/reactive'
import { getDependencyTree, getObserverTree } from '@migaia/store-devtools'
const runtime = createRuntime()
const count = runtime.signal(1)
const view = runtime.effect(() => { console.log(count.value) })`
/** All mutating session methods reject after terminal disposal. */
const noValue = t(
  'No return value; the operation is complete. After disposal it throws SESSION_DISPOSED.',
  '无返回值，操作已经完成；会话释放后调用抛出 `SESSION_DISPOSED`。'
)
/** Native error factory parameters share the same code and application message contract. */
const errorParams = {
  code: t(
    'Value selected from StoreDevtoolsErrorCode for the scenario being reported.',
    '根据当前失败场景从 `StoreDevtoolsErrorCode` 选择的错误码取值。'
  ),
  message: t(
    'Application-supplied explanatory message; callers classify by source and code rather than this text.',
    '应用提供的解释性消息，调用方应按来源与错误码分类，而非依赖此文本。'
  )
}
/** Complete session surface, with examples showing how history IDs are obtained. */
const members: Record<string, IMemberDoc> = {
  history: p(
    'Frozen chronological array snapshot of retained IStoreHistoryEntry entries, bounded by maxHistory. Entry state is shallow-frozen after cloning.',
    '保留历史条目的冻结时间顺序数组快照，受 `maxHistory` 限制；条目状态经克隆后仅作浅冻结。'
  ),
  actions: p(
    'Frozen chronological array of manual and completed runtime action traces, bounded by maxTrace rather than maxHistory.',
    '手动与已完成运行时动作的冻结时间顺序数组，受 `maxTrace` 限制，而非 `maxHistory`。'
  ),
  trace: p(
    'Frozen chronological array of original runtime events, bounded by maxTrace; empty when runtime capture is disabled.',
    '原始运行时事件的冻结时间顺序数组，受 `maxTrace` 限制，关闭运行时捕获后为空。'
  ),
  record: {
    summary: t(
      'Prepares the clock and cloned store snapshot, checks that the session is still active, then publishes one history entry. Callback failure or disposal during preparation leaves queues and the next history ID unchanged.',
      '先准备时钟与存储克隆快照，再复核会话仍存活后发布历史；准备失败或期间释放时不改变队列，也不消耗历史标识。'
    ),
    params: {
      label: t(
        'Optional application label; omitted defaults to state change. Initial construction and clear use initial.',
        '可选应用标签，省略时默认为 `state change`；构造与清空时使用 `initial`。'
      )
    },
    returns: t(
      'Frozen IStoreHistoryEntry with a new monotonic ID. Unclassified clock or clone failures become CALLBACK_FAILED; writable native errors retain identity, foreign identities remain unchanged, and immutable errors or primitive values remain on cause.',
      '返回带新单调标识的冻结 `IStoreHistoryEntry`。未分类时钟或克隆失败附 `CALLBACK_FAILED`；可写原生错误保持身份，外包身份不改写，不可修改错误或原始值保留在原因链。'
    ),
    example: `${setup}\nconst anchor = tools.record('before-submit')\nconsole.log(anchor.id, anchor.state)\ntools.dispose()\nstore.$dispose()`
  },
  recordAction: {
    summary: t(
      'Prepares an application action record and session timestamp, then checks session activity before publishing. Disposal from a getter or clock prevents publication; payload and errors retain their supplied identity.',
      '先准备应用动作记录与会话时间戳，复核会话存活后才发布；属性读取或时钟中释放会话将阻止追加，载荷与错误保持传入身份。'
    ),
    params: {
      trace: t(
        'Application-created action name, optional payload, durationMs and error; omit timestamp because the session supplies it.',
        '应用创建的动作名称以及可选载荷、耗时与错误，不提供时间戳，由会话补入。'
      )
    },
    returns: noValue,
    example: `${setup}\ntools.recordAction({ name: 'submit', durationMs: 12 })\nconsole.log(tools.actions)\ntools.dispose()\nstore.$dispose()`
  },
  jumpTo: {
    summary: t(
      'Clones a retained history state into store.$hydrate(), suppressing replay-generated history; business side effects are not undone.',
      '克隆保留的历史状态并交给 `store.$hydrate()`，抑制回放产生的历史，不会撤销业务副作用。'
    ),
    params: {
      id: t(
        'ID returned by tools.record() or read from tools.history; an entry trimmed by maxHistory is no longer available.',
        '来自 `tools.record()` 返回值或 `tools.history` 条目的标识，被历史上限裁剪后不再可用。'
      )
    },
    returns: t(
      'No return value; unknown IDs throw RangeError/UNKNOWN_HISTORY_ENTRY. Unclassified replay clone failures receive CALLBACK_FAILED, while complete foreign identities stay unchanged; frozen errors and primitive values remain on cause. Store hydration failures propagate from Store without this catch; replay suppression is restored in either case.',
      '无返回值；未知标识抛出 `RangeError/UNKNOWN_HISTORY_ENTRY`。回放克隆的未分类失败附 `CALLBACK_FAILED`，完整外包身份保持不变，冻结错误或原始值保留在 `cause` 上；Store 注水失败不进入此 catch，仍由 Store 传播。两种失败后都会恢复回放抑制状态。'
    ),
    example: session
  },
  clear: {
    summary: t(
      'Prepares one current initial snapshot and rechecks session activity before clearing all three queues. A preparation failure or disposal leaves queues and history ID unchanged; success retains only the new entry without resetting IDs.',
      '先准备当前初始快照并复核会话存活，再清空三个队列；准备失败或期间释放时队列和历史标识不变，成功后仅保留新条目且不重置标识序列。'
    ),
    returns: noValue,
    example: `${setup}\ntools.recordAction({ name: 'manual' })\ntools.clear()\nconsole.log(tools.history, tools.actions, tools.trace)\ntools.dispose()\nstore.$dispose()`
  },
  dispose: {
    summary: t(
      'Idempotently closes the session and cancels store and runtime subscriptions; it neither disposes the store nor clears diagnostic queues.',
      '幂等关闭会话并取消存储与运行时订阅，不释放存储本身，也不清空诊断队列。'
    ),
    returns: t(
      'No value. One cleanup failure propagates unchanged; several produce CLEANUP_FAILED AggregateError. The session remains terminal even after cleanup failure.',
      '无返回值；单个清理失败原样抛出，多个失败形成 `CLEANUP_FAILED` 聚合错误，即使清理失败会话也保持终态。'
    ),
    example: `${setup}\ntools.dispose()\ntools.dispose()\nconsole.log(tools.history)\nstore.$dispose()`
  }
}
/** Package-owned native failure codes, with each classification boundary explained. */
const enums: ILibraryReference['enums'] = {
  StoreDevtoolsErrorCode: {
    summary: t(
      'Stable failure codes under source @migaia/store-devtools; native error types are retained.',
      '来源为 `@migaia/store-devtools` 的稳定失败码，保留原生错误类型。'
    ),
    values: {
      sessionDisposed: t(
        'A session mutation ran after disposal; create a new diagnostic session.',
        '会话修改发生在释放之后，应新建诊断会话再执行。'
      ),
      unknownHistoryEntry: t(
        'The selected ID is absent or was trimmed; inspect the current history before replay.',
        '选择的标识不存在或已裁剪，应读取当前历史再选择回放。'
      ),
      invalidOption: t(
        'Options are not an object, an option getter fails, a callback is not callable, a queue limit is not a positive safe integer, or tree depth is not a nonnegative safe integer. Fix the input before retrying.',
        '选项非对象、选项读取失败、回调不可调用、队列上限不是正安全整数，或树深度不是非负安全整数；修正输入后再重试。'
      ),
      callbackFailed: t(
        'Unclassified diagnostic preparation failed in a clock, snapshot clone or action property read. Manual capture throws; automatic capture reports through the runtime. Original errors remain identical or reachable on cause.',
        '时钟、快照克隆或动作属性读取在诊断准备期发生未分类失败；手动捕获抛出，自动捕获经运行时报告，原始错误保持身份或可从原因链追溯。'
      ),
      cleanupFailed: t(
        'Several cleanup failures were aggregated, or setup rollback also failed; inspect errors for originals.',
        '多个清理失败被汇总，或安装回滚也失败，应读取错误列表追溯原始失败。'
      )
    }
  }
}
/** All public result, options and callback-node types belong to this one diagnostic package. */
const types: Record<string, ITypeDoc> = {
  IStoreDevTools: {
    summary: t(
      'Caller-owned local diagnostic session subscribed to an existing reactive store, with bounded history and runtime traces.',
      '订阅已有响应式存储的调用方诊断会话，保留有界历史与运行时追踪。'
    ),
    scenarios: [
      t(
        'Investigate field changes, inspect completed actions and replay retained local snapshots.',
        '排查字段变化，查看已完成动作，并回放保留的本地快照。'
      )
    ],
    example: session,
    members
  },
  IStoreDevToolsOptions: {
    summary: t(
      'Queue limits, runtime capture, clock and snapshot policy fixed when a session is created.',
      '会话创建时固定的队列上限、运行时捕获、时钟与快照策略。'
    ),
    members: {
      maxHistory: {
        ...p(
          'Safe integer at least one limiting retained state-history entries; old entries are evicted chronologically.',
          '至少为一的安全整数，限制状态历史条目数量，超限时按时间顺序淘汰旧条目。'
        ),
        default: t(
          '`100` history entries; it does not bound the action queue.',
          '默认保留 `100` 条历史，不限制动作队列。'
        )
      },
      maxTrace: {
        ...p(
          'Safe integer at least one bounding both runtime trace and action queues independently.',
          '至少为一的安全整数，分别限制运行时追踪与动作两个队列。'
        ),
        default: t(
          '`1000` entries per queue for actions and runtime trace.',
          '默认动作与运行时追踪各保留 `1000` 条记录。'
        )
      },
      captureRuntimeTrace: {
        ...p(
          'False skips runtime subscription and automatic completed-action capture; manual recordAction remains available.',
          '为假时跳过运行时订阅及自动完成动作捕获，仍可手动记录动作。'
        ),
        default: t(
          '`true`: capture runtime-wide events and completed action outcomes.',
          '默认 `true`，捕获整个 Runtime 的事件及已完成动作结果。'
        ),
        values: {
          true: t(
            'Subscribe to the Store Runtime, including other Stores using it.',
            '订阅该 Store 的整个 Runtime，包括共用它的其他 Store。'
          ),
          false: t(
            'Skip Runtime trace and automatic actions; manual recordAction remains enabled.',
            '跳过 Runtime 追踪与自动动作，仍可手动 recordAction。'
          )
        }
      },
      now: {
        ...p(
          'Synchronous no-argument clock returning application milliseconds. Preparation classifies unowned failures as CALLBACK_FAILED; manual capture throws and automatic capture reports through the runtime.',
          '同步无参数时钟，返回应用使用的毫秒时间戳；准备期未归属失败附 `CALLBACK_FAILED`，手动捕获抛出，自动捕获经运行时报告。'
        ),
        default: t(
          'Date.now supplies ordinary wall-clock timestamps.',
          '默认使用 `Date.now` 提供墙上时钟时间戳。'
        )
      },
      clone: {
        ...p(
          'Synchronous (state) callback receives store.$plain() or a retained replay snapshot and returns a diagnostic copy. Snapshot and replay cloning classify unowned failures as CALLBACK_FAILED; automatic capture reports them, while manual record and replay throw. Store hydration errors retain their own path. Apply redaction here.',
          '同步 `(state)` 接收 `store.$plain()` 或保留的回放快照并返回诊断副本；快照与回放克隆的未归属失败附 `CALLBACK_FAILED`，自动捕获报告，手动记录与回放抛出。Store 注水错误仍保留自身传播路径，可在此回调脱敏。'
        ),
        default: t(
          'ClonePolicy.diagnostic from @migaia/store-middleware/tolerant-clone clones best-effort. structuredClone may convert class instances to ordinary objects; reference sharing and prototype preservation are not guaranteed.',
          '默认使用 `@migaia/store-middleware/tolerant-clone` 的 `ClonePolicy.diagnostic` 尽力克隆；原生结构化克隆可能把类实例转成普通对象，失败回退可共享引用，不保证完全隔离或保留原型。'
        )
      }
    }
  },
  IStoreHistoryEntry: {
    summary: t(
      'Frozen local state checkpoint with a session-assigned monotonic ID and a shallow-frozen cloned state.',
      '冻结的本地状态检查点，含会话分配的单调标识与浅冻结的克隆状态。'
    ),
    example: `${setup}\nconsole.log(tools.record('checkpoint'))\ntools.dispose()\nstore.$dispose()`,
    members: {
      id: p(
        'Monotonic ID assigned by record or initial capture; retained history IDs are accepted by jumpTo.',
        '由记录或初始捕获分配的单调标识，仍保留的历史标识可传给跳转方法。'
      ),
      timestamp: p(
        'Milliseconds returned by the session now callback before any history mutation.',
        '在修改历史前由会话时钟回调返回的毫秒时间戳。'
      ),
      label: p(
        'Application checkpoint label, or the stable initial and state change labels supplied by the session.',
        '应用检查点标签，或会话提供的稳定初始及状态变化标签。'
      ),
      state: p(
        'Diagnostic clone of store.$plain(), shallow-frozen before publication; nested cloning semantics belong to clone.',
        '发布前浅冻结的 `store.$plain()` 诊断克隆，嵌套克隆语义由所选克隆策略决定。'
      )
    }
  },
  IActionTrace: {
    summary: t(
      'Manual action metadata or a completed runtime action outcome; payload and errors retain their supplied identity.',
      '手动动作元数据或已完成运行时动作结果，载荷与错误保留传入身份。'
    ),
    members: {
      timestamp: p(
        'Timestamp assigned by the session clock when recordAction appends the entry.',
        '记录动作追加条目时由会话时钟分配的时间戳。'
      ),
      name: p(
        'Application action name or the original name from a completed runtime trace event.',
        '应用指定的动作名称，或来自已完成运行时追踪事件的原始名称。'
      ),
      payload: {
        ...p(
          'Optional application-supplied payload kept as-is without implicit cloning or redaction.',
          '应用提供的可选载荷，原样保留而不隐式克隆或脱敏。'
        ),
        default: t(
          'Omitted: no payload is stored on the action entry.',
          '省略时动作条目不保存额外载荷。'
        )
      },
      durationMs: {
        ...p(
          'Optional application duration or the elapsed duration of the completed runtime action.',
          '应用提供的可选耗时，或已完成运行时动作的实际耗时。'
        ),
        default: t('Omitted: elapsed duration is not specified.', '省略时不指定该动作的耗时数据。')
      },
      error: {
        ...p(
          'Optional original failure; automatic capture includes it only for runtime action error events.',
          '可选原始失败，自动捕获时只在运行时动作失败事件中带入。'
        ),
        default: t(
          'Omitted: no failure is recorded for this action.',
          '省略时不为当前动作记录失败值。'
        )
      }
    }
  },
  IDependencyTreeNode: {
    summary: t(
      'Snapshot tree node from dependency or observer traversal, with current-path cycle detection rather than global deduplication.',
      '依赖或观察者遍历返回的快照树节点，按当前路径检测环，而非全局去重。'
    ),
    scenarios: [
      t(
        'Inspect runtime graph connections without creating a store diagnostic session.',
        '无须创建存储诊断会话即可查看运行时图连接关系。'
      )
    ],
    example: `${treeSetup}\nconsole.log(getDependencyTree(view))\nconsole.log(getObserverTree(count))\nview.dispose()`,
    members: {
      kind: {
        ...p(
          'Observable nodes provide values; observer nodes subscribe to dependencies.',
          '可观察节点提供值，观察者节点订阅相应的依赖关系。'
        ),
        values: {
          observable: t(
            'A signal or computed value observed by downstream nodes.',
            '被下游节点观察的信号或计算值。'
          ),
          observer: t(
            'An effect or computed observer depending on upstream nodes.',
            '依赖上游节点的副作用或计算观察者。'
          )
        }
      },
      label: p(
        'Node debugName, otherwise constructor name, otherwise AnonymousReactiveNode.',
        '节点调试名，否则取构造函数名，再否则使用匿名节点标签。'
      ),
      version: p(
        'Observable version at traversal time; observer-only nodes omit this field.',
        '遍历时可观察节点的版本，纯观察者节点不包含该字段。'
      ),
      children: p(
        'Dependencies for dependency traversal, subscribers for observer traversal; truncated at maxDepth.',
        '依赖遍历时表示上游，观察者遍历时表示订阅者，到达深度上限后截断。'
      ),
      circular: p(
        'True only when this node already exists on the current recursion path; shared diamonds are not cycles.',
        '仅在当前递归路径已经存在此节点时为真，共享菱形依赖不视为环。'
      )
    }
  },
  IStoreDevtoolsErrorCode: {
    summary: t(
      'Value union of StoreDevtoolsErrorCode; classify with STORE_DEVTOOLS_SOURCE and preserve original causes.',
      '`StoreDevtoolsErrorCode` 的取值联合，分类时同时核对来源并保留原始原因。'
    ),
    members: {}
  }
}
/** Runtime exports have independently documented inputs and observable outcomes. */
const symbols: Record<string, ISymbolDoc> = {
  createStoreDevTools: {
    role: 'factory',
    cases: storeDevtoolsCases.createStoreDevTools,
    exampleIntro: {
      en: "Directly install `@migaia/store-light` and `@migaia/reactive` for these real Store/Runtime examples. `createStore({ count: 0 }, { runtime })` borrows the supplied Runtime; without it Store uses defaultRuntime, and its scalar equality defaults to Object.is. Here `createRuntime({ schedulerStrategy: run => run() })` uses synchronous scheduling solely for deterministic output; the Runtime default delegates to adapter.scheduleMicrotask. The failure example also supplies `onError(error)`, returning void and retaining the original diagnostic; omitted onError uses the Runtime's adapter reporter. Devtools options default to `{}`: maxHistory `100`, maxTrace `1000`, captureRuntimeTrace `true`, now `Date.now`, and clone `ClonePolicy.diagnostic`. The examples set captureRuntimeTrace false to isolate history/manual actions; this disables the Runtime-wide subscription, not only this Store's action events. Manual action name is required; payload, durationMs and error default to undefined. record() label defaults to 'state change'; construction and clear use 'initial'. Dispose tools before the caller-owned Store. The bounded-queue example explicitly supplies now: () => 100 for fixed diagnostic timestamps, not performance measurement.",
      zh: "示例直接导入真实 Store/Runtime，请同时安装 `@migaia/store-light`、`@migaia/reactive`。`createStore({ count: 0 }, { runtime })` 借用指定 Runtime；省略时使用 `defaultRuntime`，标量相等比较默认 `Object.is`。这里 `createRuntime({ schedulerStrategy: run => run() })` 仅为确定输出而同步调度；Runtime 默认委托 `adapter.scheduleMicrotask`。失败例还提供 `onError(error)`，返回 void 并保存原始诊断；省略时使用 Runtime 的 adapter 报告入口。诊断选项默认 `{}`：maxHistory 为 `100`，maxTrace 为 `1000`，captureRuntimeTrace 为 `true`，now 为 `Date.now`，clone 为 `ClonePolicy.diagnostic`。示例把 captureRuntimeTrace 设为 false，以单独观察历史和手动动作；这会关闭整个 Runtime 的订阅，而非只筛选此 Store 的动作。手动动作 name 必填，payload、durationMs、error 默认 undefined。`record()` 的 label 默认 'state change'，构造和 clear 使用 'initial'。先释放诊断会话，再由调用方释放 Store。容量例显式用 `now: () => 100` 固定诊断时间戳，不用于性能测量。"
    },
    purpose: t(
      'Subscribes to an existing reactive store to collect bounded state history, completed actions and optional runtime trace. Replay hydrates local state and never reverses business side effects; dispose the session after inspection.',
      '订阅已有响应式存储，收集有界状态历史、已完成动作及可选运行时追踪；回放只注水本地状态，不会撤销业务副作用，检查结束后须释放会话。'
    ),
    params: {
      store: t(
        'Live IReactiveStore returned by @migaia/store-light createStore(); the caller keeps ownership and must dispose the diagnostic session before releasing it.',
        '来自 `@migaia/store-light` 的 `createStore()` 返回的存活存储，所有权仍属调用方，释放存储前应先释放诊断会话。'
      )
    },
    options: 'IStoreDevToolsOptions',
    returns: t(
      'Caller-owned IStoreDevTools. Construction snapshots options and initial state; invalid options throw Error/INVALID_OPTION, while unclassified initial clock or clone failures carry CALLBACK_FAILED. Existing foreign identities remain unchanged.',
      '返回调用方拥有的 `IStoreDevTools`；构造时保存选项与初始快照，非法选项抛普通 `Error/INVALID_OPTION`，未分类初始时钟或克隆失败附 `CALLBACK_FAILED`，已有外包身份保持不变。'
    ),
    example: storeDevtoolsCases.createStoreDevTools![0]!.example
  },
  getDependencyTree: {
    role: 'operation',
    cases: storeDevtoolsCases.getDependencyTree,
    exampleIntro: {
      en: 'Directly install `@migaia/reactive`. `createRuntime()` uses its default adapter and scheduling. `signal(1, { debugName })` creates a source; `computed(read, { debugName })` reads it lazily, and `effect(read, { debugName })` establishes the actual graph with its initial run enabled by default. Each debugName is an optional diagnostic label, default undefined. Reading left then right determines the existing Set order shown here. `getDependencyTree(root, maxDepth)` accepts this real effect/computed handle; maxDepth defaults to `20`, must be a nonnegative safe integer, and `0` omits all direct edges. The returned ordinary mutable tree is a snapshot; traversal creates no observer. Dispose the effect, derived values and signal through their public handles.',
      zh: '还需直接安装 `@migaia/reactive`。`createRuntime()` 使用默认 adapter 和调度。`signal(1, { debugName })` 创建来源，`computed(read, { debugName })` 惰性读取它，`effect(read, { debugName })` 默认立即执行一次，建立真实图关系。debugName 是可选诊断标签，默认 undefined。先读 left、再读 right，决定这里展示的既有 Set 顺序。`getDependencyTree(root, maxDepth)` 接受真实 effect/计算值句柄；maxDepth 默认 `20`，必须是非负安全整数，`0` 不展开直接边。返回的是普通可变树快照，遍历不创建观察者。最后通过公开句柄释放 effect、计算值和信号。'
    },
    purpose: t(
      'Traverses upstream dependencies from a runtime effect or computed handle, without requiring a store session. Current-path cycle detection marks recursion loops while allowing shared diamond nodes to appear on each branch.',
      '从运行时副作用或计算值句柄向上遍历依赖，无须诊断会话；按当前路径检测并标记递归环，允许共享菱形节点在各分支分别出现。'
    ),
    params: {
      root: t(
        'Public effect or computed handle returned by the same reactive runtime, or an extension IObserver node.',
        '同一响应式运行时返回的公开副作用或计算句柄，也可传扩展层 `IObserver` 节点。'
      ),
      maxDepth: t(
        'Optional nonnegative safe integer, default `20`; `0` returns only the root and no direct edges.',
        '可选非负安全整数，默认 `20`；`0` 时只返回根节点，不展开直接依赖边。'
      )
    },
    returns: t(
      'IDependencyTreeNode snapshot. Invalid depth throws RangeError tagged INVALID_OPTION; no resource or subscription is created.',
      '返回 `IDependencyTreeNode` 快照；非法深度抛出带 `INVALID_OPTION` 的 `RangeError`，不创建资源或订阅。'
    ),
    example: storeDevtoolsCases.getDependencyTree![0]!.example
  },
  getObserverTree: {
    role: 'operation',
    cases: storeDevtoolsCases.getObserverTree,
    exampleIntro: {
      en: "Directly install `@migaia/reactive`. `createRuntime()` uses the default adapter and scheduling; the signal starts at `2`, the computed callback reads count times two, and both effect callbacks read the computed value. Optional debugName defaults to undefined; effects run immediately by default to establish subscriptions. Read `getObserverTree(root, maxDepth)` from the actual signal/computed handle; maxDepth defaults to `20`, accepts nonnegative safe integers, and `0` omits direct subscriber edges. The first effect's public dispose removes its subscription while the second remains active. No diagnostic session is needed; the returned mutable tree describes this call's graph rather than subscribing to future changes.",
      zh: '还需直接安装 `@migaia/reactive`。`createRuntime()` 使用默认 adapter 和调度；信号初始值为 `2`，计算回调读取 count 并乘以二，两个 effect 回调分别读取计算值。可选 debugName 默认 undefined，effect 默认立即执行以建立订阅。从真实信号/计算值句柄调用 `getObserverTree(root, maxDepth)`；maxDepth 默认 `20`，接受非负安全整数，`0` 不展开直接订阅边。第一个 effect 的公开 dispose 移除自身订阅，第二个仍存活。无需创建诊断会话；新返回的可变树只描述本次调用时的图，不订阅后续变化。'
    },
    purpose: t(
      'Traverses downstream subscribers from a runtime signal or computed handle, without a store session. Depth bounds and current-path cycle flags describe an instantaneous graph view, not a live subscription.',
      '从运行时信号或计算句柄向下遍历订阅者，无须存储会话；深度上限与当前路径环标记描述瞬时图视图，不建立实时订阅。'
    ),
    params: {
      root: t(
        'Public signal or computed handle from createRuntime(), or an extension IObservable graph node.',
        '来自 `createRuntime()` 的公开信号或计算句柄，也可传扩展层 `IObservable` 图节点。'
      ),
      maxDepth: t(
        'Optional nonnegative safe integer, default `20`; `0` omits all subscriber edges.',
        '可选非负安全整数，默认 `20`；`0` 时省略全部订阅边。'
      )
    },
    returns: t(
      'IDependencyTreeNode snapshot; invalid depth throws RangeError tagged INVALID_OPTION, without creating a subscription.',
      '返回 `IDependencyTreeNode` 快照；非法深度抛出带 `INVALID_OPTION` 的 `RangeError`，不创建订阅。'
    ),
    example: storeDevtoolsCases.getObserverTree![0]!.example
  },
  STORE_DEVTOOLS_SOURCE: {
    role: 'error',
    purpose: t(
      'Stable @migaia/store-devtools source on package-created native errors. Compare source and StoreDevtoolsErrorCode together; diagnostic callbacks may also propagate original foreign failures.',
      '本包构造原生错误时附加的稳定来源 `@migaia/store-devtools`，须与错误码共同判断；诊断回调也可能传播原始外部失败。'
    ),
    example: `import { STORE_DEVTOOLS_SOURCE, StoreDevtoolsErrorCode } from '@migaia/store-devtools'\nconsole.log(STORE_DEVTOOLS_SOURCE, StoreDevtoolsErrorCode.sessionDisposed)`
  },
  createStoreDevtoolsError: {
    role: 'error',
    purpose: t(
      'Builds a native Error tagged with this package source and selected semantic code. The message remains application supplied; an optional original cause is retained without rewriting stack or changing native type.',
      '构造带本包来源与所选语义错误码的原生 `Error`；消息由应用提供，可保留原始原因，不重写堆栈，也不改变原生类型。'
    ),
    params: errorParams,
    optionDocs: {
      cause: {
        ...p(
          'Original application failure preserved by identity on Error.cause when supplied and not undefined.',
          '提供且不为 `undefined` 时按原始身份保存在错误原因上的应用失败值。'
        ),
        default: t(
          'Omitted or undefined: no cause property is installed by the constructor.',
          '省略或为 `undefined` 时不由构造函数安装原因属性。'
        )
      }
    },
    returns: t(
      'New native Error with source and code properties; the original cause remains reachable.',
      '返回带来源与错误码的新原生 `Error`，原始原因仍可追溯。'
    ),
    example: `import { createStoreDevtoolsError, StoreDevtoolsErrorCode } from '@migaia/store-devtools'\nconst cause = new TypeError('snapshot')\nconst error = createStoreDevtoolsError(StoreDevtoolsErrorCode.invalidOption, 'snapshot failed', { cause })\nconsole.log(error.cause === cause)`
  },
  createStoreDevtoolsRangeError: {
    role: 'error',
    purpose: t(
      'Builds a source-and-code tagged native RangeError. Built-in paths use it for invalid tree depth or a missing history selection; queue limit validation uses ordinary Error/INVALID_OPTION.',
      '构造带来源与错误码的原生 `RangeError`；内置路径用于非法树深度或不存在的历史选择，队列上限校验使用普通 `Error/INVALID_OPTION`。'
    ),
    params: errorParams,
    returns: t(
      'New RangeError with unchanged native stack and tagged source/code.',
      '返回保留原生堆栈并附有来源及错误码的新 `RangeError`。'
    ),
    example: `import { createStoreDevtoolsRangeError, StoreDevtoolsErrorCode } from '@migaia/store-devtools'\nconsole.log(createStoreDevtoolsRangeError(StoreDevtoolsErrorCode.invalidOption, 'invalid depth'))`
  },
  createStoreDevtoolsAggregateError: {
    role: 'error',
    purpose: t(
      'Builds a tagged native AggregateError retaining every supplied cleanup failure in errors. Use it when several subscription releases fail, rather than discarding the original failures.',
      '构造带码原生聚合错误，在错误列表中保留全部传入清理失败；适用于多个订阅释放失败，避免丢失对应的原始失败。'
    ),
    params: {
      ...errorParams,
      errors: t(
        'Application-collected original failures in the desired order; every value remains reachable through errors.',
        '应用按所需顺序收集的原始失败，全部值仍可通过错误列表追溯。'
      )
    },
    returns: t(
      'New AggregateError whose errors list retains original failure identities.',
      '返回错误列表保留原始失败身份的新 `AggregateError`。'
    ),
    example: `import { createStoreDevtoolsAggregateError, StoreDevtoolsErrorCode } from '@migaia/store-devtools'\nconst first = new TypeError('first cleanup')\nconst second = new TypeError('second cleanup')\nconsole.log(createStoreDevtoolsAggregateError(StoreDevtoolsErrorCode.cleanupFailed, [first, second], 'cleanup failed').errors)`
  }
}
/**
 * Each enum introduction reuses its own canonical meaning and states the actual consumption
 * boundary.
 */
for (const [key, doc] of Object.entries(enums))
  symbols[key] = {
    role: key.endsWith('ErrorCode') ? 'error' : 'constant',
    purpose: t(
      `${doc.summary.en} Consult each member before interpreting a diagnostic or implementing your own bridge.`,
      `${doc.summary.zh}解释诊断或实现应用桥接前，应逐项核对具体取值的含义。`
    ),
    example: `console.log(${key})`
  }
/** Local session and independent tree utilities share one public entry. */
export const storeDevtoolsReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Local reactive-store diagnostics. Start with createStoreDevTools for history and action capture; getDependencyTree and getObserverTree independently inspect reactive runtime handles. This package supplies no browser extension connection.',
        '本地响应式存储诊断入口；从 `createStoreDevTools()` 开始捕获历史与动作，也可独立用两个树工具检查运行时句柄；本包不提供浏览器扩展连接。'
      ),
      example: session
    }
  },
  symbols,
  types,
  enums,
  enhancers: {}
}
