/**
 * Capability host reference, checked against packages/capability/src on 2026-10-17. Concurrent host
 * disposal rejects HOST_TRANSITIONING until the first disposal settles; settled repeated disposal
 * returns the original Promise. Graph ownership is documented separately.
 */
import type { ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'
import { capabilityGraphReference } from './capability-graph.js'
import { capabilityTopologyReference } from './capability-topology.js'

/** Builds bilingual text without fallback. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents one stored or diagnostic value. */
const p = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Documents scalar and union aliases without inventing instance methods. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })
/** A complete registered host shared by the operation examples. */
const setup = `import { createCapabilityHost } from '@migaia/capability'
const host = createCapabilityHost({ tenant: 'a' }, { flags: { search: true } })
host.register({ name: 'search', activate: context => ({ tenant: context.tenant, dispose() {} }) })`
/** Complete tenant persistence example shared by the guide and the audited API page. */
export const capabilityHostExample = `import { CapabilityEnableStatus, createCapabilityHost, type ICapabilityHandle } from '@migaia/capability'

type IPersistence = ICapabilityHandle & { sync(): Promise<void> }
const host = createCapabilityHost({ tenantId: 'tenant-42' }, {
  flags: { persistence: true },
  onError: (name, error) => console.error(name, error)
})
host.register<IPersistence>({
  name: 'persistence',
  activate: ({ tenantId }) => ({
    sync: async () => { console.log('sync:', tenantId) },
    dispose: () => { console.log('disposed:', tenantId) }
  })
})

try {
  const result = await host.enable('persistence')
  if (result.status === CapabilityEnableStatus.enabled) {
    await host.handle<IPersistence>('persistence')?.sync()
  }
} finally {
  await host.dispose()
}`
/** Capability identity chosen by the application at registration. */
const name = t(
  'The application-assigned name supplied to host.register(), here search.',
  '来自应用传给 `host.register()` 的能力名称，此处为 `search`。'
)
/** Completion of a synchronous state update. */
const done = t(
  'No return value; the documented state update has completed.',
  '无返回值；返回时已完成所述状态变更。'
)
/** Host lifecycle methods retain separate activation and flag semantics. */
const members: Record<string, IMemberDoc> = {
  register: {
    summary: t(
      'Snapshots a named activation recipe without activating it; duplicate names throw ALREADY_REGISTERED.',
      '保存具名激活配方的快照，但不会启动能力；重复名称抛出 `ALREADY_REGISTERED`。'
    ),
    params: {
      definition: t(
        'Application-created name and activate(context) callback; return a disposable handle or its Promise, and throws become failed activation results.',
        '应用创建的名称与 `activate(context)` 回调；返回可释放句柄或其承诺，抛错转换为激活失败结果。'
      )
    },
    returns: done,
    example: setup
  },
  names: p(
    'Read-only registration-order names retained for diagnostics.',
    '按登记顺序排列的只读名称列表，释放后仍可用于诊断。'
  ),
  state: {
    summary: t(
      'Reads current capability lifecycle state; unknown names throw NOT_REGISTERED.',
      '读取当前能力生命周期状态，未知名称抛出 `NOT_REGISTERED`。'
    ),
    params: { name },
    returns: t(
      'CapabilityState value: off permits activation, gated denies activation.',
      '返回 `CapabilityState` 取值；`off` 允许激活，`gated` 禁止激活。'
    ),
    example: `${setup}\nconsole.log(host.state('search'))`
  },
  handle: {
    summary: t(
      'Reads the original adopted handle only while enabled; it never starts a capability.',
      '仅在能力已启用时读取原始接纳句柄，不会触发能力启动。'
    ),
    params: { name },
    returns: t(
      'The active handle or undefined. The host owns disposal; do not independently dispose it.',
      '返回启用句柄或 `undefined`；释放职责属于宿主，不要另行释放。'
    ),
    example: `${setup}\nawait host.enable('search')\nconsole.log(host.handle('search'))\nawait host.dispose()`
  },
  error: {
    summary: t(
      'Reads the last activation or release failure without rethrowing it.',
      '读取最近一次激活或释放失败，查询本身不会重抛该失败。'
    ),
    params: { name },
    returns: t(
      'The retained failure or undefined; successful restart or reconfiguration clears it.',
      '返回保留的失败值或 `undefined`；成功重启或重新配置会清除它。'
    ),
    example: `${setup}\nawait host.enable('search')\nconsole.log(host.error('search'))\nawait host.dispose()`
  },
  setFlag: {
    summary: t(
      'Copies one flag; false invalidates activation and begins handle release, while true does not activate.',
      '更新一个开关；关闭时作废激活并开始释放句柄，打开时不会自动激活。'
    ),
    params: {
      name,
      enabled: t(
        'Application policy boolean; only true grants permission for a later enable call.',
        '应用策略提供的布尔值，只有 `true` 授予之后启用的许可。'
      )
    },
    returns: done,
    example: `${setup}\nhost.setFlag('search', true)\nawait host.enable('search')\nhost.setFlag('search', false)\nawait host.dispose()`
  },
  setFlags: {
    summary: t(
      'Atomically replaces all flags; omitted names lose any earlier permission.',
      '原子替换全部开关，省略的名称会失去先前授予的许可。'
    ),
    params: {
      flags: t(
        'Complete application name-to-boolean policy; only own data properties exactly true permit activation. Later input mutation has no effect.',
        '应用提供的完整名称到布尔值映射；只有值严格为真的自有数据属性允许激活，之后修改输入不影响宿主。'
      )
    },
    returns: done,
    example: `${setup}\nhost.setFlags({ search: false })\nawait host.dispose()`
  },
  enable: {
    summary: t(
      'Activates one permitted capability; concurrent callers share one activation. Pair with register() and eventual dispose().',
      '激活一个已获许可的能力，并发调用共享同次激活；搭配 `register()` 登记，最终用 `dispose()` 释放。'
    ),
    params: { name },
    returns: t(
      'Promise of enabled, gated, cancelled or failed status; failed carries error. Late cancelled handles are released. Invalid lifecycle operations still reject.',
      '返回 `enabled`、`gated`、`cancelled` 或 `failed` 结果承诺，失败带有 `error`；取消后迟到的句柄会释放，非法生命周期操作仍拒绝。'
    ),
    example: `${setup}\nconsole.log(await host.enable('search'))\nawait host.dispose()`
  },
  disable: {
    summary: t(
      'Invalidates pending activation and releases the active handle without changing the flag.',
      '作废在途激活并释放启用句柄，但不改变许可开关的取值。'
    ),
    params: { name },
    returns: t(
      'Promise of whether an enabled capability was disabled; cleanup failures are retained and reported to onError.',
      '返回是否关闭了已启用能力的承诺；清理失败会保留诊断并交给 `onError`。'
    ),
    example: `${setup}\nawait host.enable('search')\nconsole.log(await host.disable('search'))\nawait host.dispose()`
  },
  dispose: {
    summary: t(
      'Closes the host and releases capabilities in reverse activation-completion order (if B completes before A, A releases first), awaiting pending activation cleanup.',
      '关闭宿主并按激活完成顺序的逆序释放能力（若先完成乙、后完成甲，则先释放甲），同时等待在途激活的清理完成。'
    ),
    returns: t(
      'The sole completion Promise. Unsettled concurrent calls reject HOST_TRANSITIONING; settled repeats return that original Promise. Later mutations throw HOST_DISPOSED.',
      '返回唯一完成承诺；完成前并发释放拒绝为 `HOST_TRANSITIONING`，完成后重复调用返回原承诺，后续修改抛出 `HOST_DISPOSED`。'
    ),
    example: `${setup}\nawait host.enable('search')\nawait host.dispose()\nawait host.dispose()`
  },
  disposed: p(
    'Whether terminal disposal has begun; diagnostic reads remain available.',
    '表示宿主是否已进入终态释放过程，之后仍保留只读诊断能力。'
  )
}
/** Stable outcome, state and native-error domains. */
const enums: ILibraryReference['enums'] = {
  CapabilityState: {
    summary: t(
      'Gate lifecycle state, separate from dependency graph availability.',
      '能力闸门的生命周期状态，与依赖图可用性状态分开维护。'
    ),
    values: {
      off: t(
        'Activation is allowed but no active handle has been adopted.',
        '开关允许激活，但当前尚未接纳任何启用句柄。'
      ),
      gated: t(
        'The flag denies activation, so the activation callback is not called.',
        '开关禁止激活，尝试启用不会执行激活回调。'
      ),
      activating: t(
        'An activation is running and concurrent callers share its outcome.',
        '激活正在运行，并发调用者共享本次激活结果。'
      ),
      on: t(
        'The host owns a successfully adopted active handle.',
        '宿主已接纳成功激活的句柄，并拥有其释放职责。'
      ),
      failed: t(
        'Activation failed; inspect the retained failure before retrying.',
        '激活已经失败，应读取保留诊断后再显式重试。'
      )
    }
  },
  CapabilityEnableStatus: {
    summary: t(
      'Structured activation outcomes; denial and cancellation are return states.',
      '能力激活的结构化结果，禁止与取消通过返回状态表达。'
    ),
    values: {
      enabled: t(
        'A handle was adopted or an existing enabled handle remains active.',
        '已接纳激活句柄，或已有启用句柄继续保持有效。'
      ),
      gated: t(
        'Permission is denied. Initial denial skips activation; if permission is withdrawn while activation runs, its late handle is released before returning gated.',
        '当前没有许可。初始禁止时跳过激活；若激活中途撤回许可，迟到句柄释放后仍返回禁止状态。'
      ),
      cancelled: t(
        'A newer operation invalidated this activation; late handles are released.',
        '新操作已作废本次激活，迟到句柄仍会被释放。'
      ),
      failed: t(
        'Activation failed and this result retains its original error.',
        '激活过程发生失败，结果保留相应原始错误值。'
      )
    }
  },
  GraphReadinessState: {
    summary: t(
      'Availability captured from a composition owner before admission.',
      '在接纳前从组合拥有者捕获的就绪可用性快照状态。'
    ),
    values: {
      ready: t(
        'Admission may proceed using the captured readiness snapshot.',
        '当前捕获的就绪快照允许继续进行接纳操作。'
      ),
      blocked: t(
        'Admission is unavailable without implying terminal startup failure.',
        '当前无法接纳，但不表示已经发生终态启动失败。'
      ),
      failed: t(
        'Admission failed; the snapshot error explains its cause.',
        '接纳已经失败，应读取同一快照中的错误了解原因。'
      )
    }
  },
  CapabilityErrorCode: {
    summary: t(
      'Native host errors tagged with source @migaia/capability; inspect source and code together.',
      '宿主原生错误的稳定错误码，分类时必须同时核对来源与错误码。'
    ),
    values: {
      hostDisposed: t(
        'A mutation reached a disposed host; create another host.',
        '修改操作访问已释放宿主，应创建新的宿主再执行。'
      ),
      hostTransitioning: t(
        'A mutation reentered cleanup or repeated unsettled disposal.',
        '修改重入清理回调，或在释放尚未完成时再次释放。'
      ),
      notRegistered: t(
        'The capability name is absent; register it before use.',
        '请求名称尚未登记，应先登记该能力再查询或启用。'
      ),
      alreadyRegistered: t(
        'Registration repeats an existing capability name.',
        '登记操作重复使用已存在的能力名称，应更换名称。'
      ),
      invalidName: t(
        'Name is not a nonempty string; native TypeError is retained.',
        '能力名称不是非空字符串，保留原生 `TypeError` 类型。'
      ),
      invalidActivate: t(
        'The definition has no callable activation factory.',
        '能力定义缺少可调用的激活工厂，应提供有效函数。'
      ),
      invalidHandle: t(
        'Activation returned a handle without a callable disposer.',
        '激活返回的句柄缺少可调用释放方法，不能接纳。'
      ),
      gated: t(
        'Reserved diagnostic code; current enable returns gated without throwing it.',
        '保留的诊断错误码，当前启用返回禁止状态而不抛出它。'
      ),
      invalidOption: t(
        'Options or snapshot access failed; inspect the original cause.',
        '选项或快照读取失败，应沿原因链读取原始失败。'
      )
    }
  }
}
/** Public host types and readiness data, including every real result-union member. */
const types: Record<string, ITypeDoc> = {
  ICapabilityHost: {
    summary: t(
      'Tenant-isolated host created by createCapabilityHost, owning copied flags and activated handles.',
      '由 `createCapabilityHost()` 创建的租户隔离宿主，拥有开关快照与激活句柄。'
    ),
    scenarios: [
      t(
        'Enable and release lazily loaded features independently for each tenant.',
        '为不同租户独立启用按需加载的功能，并在关闭时释放资源。'
      )
    ],
    example: `${setup}\nawait host.enable('search')\nawait host.dispose()`,
    members
  },
  ICapabilityDefinition: {
    summary: t(
      'Application-authored activation recipe snapshotted at registration.',
      '应用编写的具名激活配方，在登记时由宿主保存快照。'
    ),
    example: setup,
    members: {
      name: p(
        'Nonempty application-assigned name used by flags and host lookups.',
        '应用指定的非空名称，用于开关映射及全部宿主查询。'
      ),
      activate: {
        summary: t(
          'Receives host context and returns a disposable handle synchronously or asynchronously; rejection fails activation.',
          '接收宿主上下文，同步或异步返回可释放句柄；拒绝会使本次激活失败。'
        ),
        params: {
          context: t(
            'The application value originally supplied to createCapabilityHost(context).',
            '应用最初传给 `createCapabilityHost(context)` 的上下文原值。'
          )
        },
        returns: t(
          'Handle or Promise with callable dispose(); cancelled late results are released by the host.',
          '返回带可调用 `dispose()` 的句柄或承诺，取消后的迟到结果仍由宿主释放。'
        ),
        example: setup
      }
    }
  },
  ICapabilityHandle: {
    summary: t(
      'Activated resource whose release is owned by the capability host.',
      '激活后由能力宿主拥有释放职责的功能资源句柄。'
    ),
    example: `${setup}\nawait host.enable('search')\nawait host.dispose()`,
    members: {
      dispose: {
        summary: t(
          'Releases this feature resource synchronously or through a completion thenable.',
          '同步释放功能资源，或通过完成类承诺表达异步清理完成。'
        ),
        returns: t(
          'Void or completion thenable; throws and rejections are retained and reported by the host.',
          '返回空值或完成类承诺，抛错与拒绝由宿主保留诊断并报告。'
        ),
        example: `${setup}\nawait host.enable('search')\nawait host.disable('search')\nawait host.dispose()`
      }
    }
  },
  ICapabilityHostOptions: {
    summary: t(
      'Initial permissions and contained diagnostic reporting for one host.',
      '为一个能力宿主配置初始权限与隔离的失败报告接收方。'
    ),
    members: {
      flags: {
        ...p(
          'Copied complete name-to-boolean mapping; only own data properties exactly true grant permission.',
          '复制的完整名称到布尔值映射，仅值严格为真的自有数据属性授予许可。'
        ),
        default: t(
          'Omitted: every capability is denied until explicitly enabled by a flag.',
          '省略时禁止全部能力，直到显式打开对应开关。'
        )
      },
      onError: {
        ...p(
          'Receives (name, error) for activation or release failure; name comes from registration and error is original. No return is consumed; synchronous or async reporter failure reaches the shared utils host exception queue without changing business state.',
          '通过 `(name, error)` 接收激活或释放失败；名称来自登记，错误保持原值，不使用返回值；报告函数同步失败与异步拒绝进入工具包共享宿主异常队列，不改变业务状态。'
        ),
        default: t(
          'undefined (no error callback configured); failures remain readable through host.error(name).',
          'undefined（未配置错误接收回调）；失败仍可通过 `host.error(name)` 查询。'
        )
      }
    }
  },
  ICapabilityEnableResult: {
    summary: t(
      'Discriminated activation result: failed carries error; denial and cancellation are ordinary outcomes.',
      '激活结果的判别联合，失败分支携带错误，禁止和取消属于普通结果。'
    ),
    members: {
      status: {
        ...p(
          'Outcome selected once for every caller sharing one activation generation.',
          '为共享同一激活代的全部调用者一次确定的结果状态。'
        ),
        values: { enum: 'CapabilityEnableStatus' }
      },
      error: p(
        'Original activation failure, present only in the failed branch.',
        '仅在失败结果分支中存在的原始激活失败值。'
      )
    }
  },
  ICapabilityState: alias(
    'Capability gate lifecycle values, distinct from graph availability.',
    '能力闸门的生命周期取值，与依赖图可用性状态分别表达。'
  ),
  ICapabilityEnableStatusValue: alias(
    'Value union of CapabilityEnableStatus used by activation results.',
    '`CapabilityEnableStatus` 的取值联合，用于区分能力激活的结果。'
  ),
  ICapabilityErrorCode: alias(
    'Value union of CapabilityErrorCode; classify alongside the package source.',
    '`CapabilityErrorCode` 的取值联合，应与包来源一起用于错误分类。'
  ),
  ICapabilityReadinessSource: {
    summary: t(
      'Composition-owned read-only availability source; state is read before error once each.',
      '组合层拥有的只读可用性来源，先读取状态再读取错误，各读取一次。'
    ),
    members: {
      state: p(
        'Application-supplied availability; runtime accepts ready, blocked or failed only.',
        '应用提供的可用性，运行时仅接纳 `ready`、`blocked` 或 `failed`。'
      ),
      error: p(
        'Application-supplied failure belonging to this availability state, retained by identity.',
        '应用提供的、属于本次可用性状态的失败值，保留其原始身份。'
      )
    }
  },
  IGraphReadinessSnapshot: {
    summary: t(
      'Frozen availability fact returned by snapshotGraphReadiness, never a live subscription.',
      '由 `snapshotGraphReadiness()` 返回的冻结可用性事实，不是实时订阅。'
    ),
    scenarios: [
      t(
        'Capture readiness once before admitting dependent work.',
        '在接纳依赖工作前一次捕获组合层就绪状态。'
      )
    ],
    example: `import { snapshotGraphReadiness } from '@migaia/capability'\nconst result = snapshotGraphReadiness({ state: 'ready', error: undefined })\nconsole.log(result.state, result.error)`,
    members: {
      state: {
        ...p(
          'Validated availability captured before reading the source error.',
          '先于来源错误读取而捕获并校验成功的可用性状态。'
        ),
        values: { enum: 'GraphReadinessState' }
      },
      error: p(
        'Exact original failure captured after availability validation.',
        '完成可用性校验后捕获的原始失败值，保持原始身份。'
      )
    }
  }
}
/** Runtime enum introductions reuse only their own canonical state or error description. */
const enumSymbols = Object.fromEntries(
  Object.entries(enums).map(([key, doc]) => [
    key,
    {
      role: key.endsWith('ErrorCode') ? ('error' as const) : ('constant' as const),
      purpose: t(
        `${doc.summary.en} Compare these exported values when handling the documented branch.`,
        `${doc.summary.zh}处理相应分支时应比较这些导出的稳定取值。`
      ),
      example: `console.log(${key})`
    }
  ])
)
/** Complete reference combines separate owners for gates, graphs and pure planning. */
export const capabilityReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Runtime flags and lazy activation. Start with createCapabilityHost, register factories, grant permission, enable explicitly and finally dispose. snapshotGraphReadiness captures separate composition availability.',
        '运行时开关与按需激活入口；从 `createCapabilityHost()` 开始，登记工厂、授予许可并显式启用，最终释放宿主；`snapshotGraphReadiness()` 另用于捕获组合可用性。'
      ),
      example: `${setup}\nawait host.enable('search')\nawait host.dispose()`
    },
    ...capabilityGraphReference.modules,
    ...capabilityTopologyReference.modules
  },
  symbols: {
    ...enumSymbols,
    CAPABILITY_SOURCE: {
      role: 'error',
      purpose: t(
        'Stable @migaia/capability source attached to native host errors. Compare source and CapabilityErrorCode together to distinguish host failures from dependency graph errors.',
        '附着于原生宿主错误的稳定来源 `@migaia/capability`；同时核对来源与 `CapabilityErrorCode`，区分宿主失败与依赖图错误。'
      ),
      example: `import { CAPABILITY_SOURCE, CapabilityErrorCode } from '@migaia/capability'\nconsole.log(CAPABILITY_SOURCE, CapabilityErrorCode.hostDisposed)`
    },
    createCapabilityHost: {
      role: 'factory',
      purpose: t(
        'Creates an isolated capability gate around an application context. Register lazy activation factories, grant flags explicitly and let the host own activated handles and cleanup.',
        '围绕应用上下文创建隔离的能力闸门；登记按需激活工厂，显式授予开关许可，由宿主拥有已激活句柄并负责关闭后的资源清理。'
      ),
      params: {
        context: t(
          'Application tenant or service context passed unchanged to activation callbacks.',
          '应用提供的租户或服务上下文，将原样传给每个激活回调。'
        )
      },
      options: 'ICapabilityHostOptions',
      returns: t(
        'Caller-owned ICapabilityHost; dispose it when finished. Invalid options throw tagged native errors before construction completes.',
        '返回调用方拥有的 `ICapabilityHost`，结束后须释放；非法选项在构造完成前抛出附码原生错误。'
      ),
      exampleIntro: t(
        'Enable persistence separately for each tenant. Register its factory first, then check the enable result before reading the active handle.',
        '下面按租户启用持久化能力。先登记创建能力的函数，再检查启用结果，确认成功后才读取可用句柄。'
      ),
      example: capabilityHostExample,
      exampleResult: t(
        'The example prints sync: tenant-42, then disposed: tenant-42. The flag permits activation; enable starts it, and the finally block releases the handle even if sync fails.',
        '运行后先输出 `sync: tenant-42`，再输出 `disposed: tenant-42`。开关只授予许可，`enable()` 才启动能力；即使 `sync()` 失败，最后的清理仍会释放句柄。'
      )
    },
    snapshotGraphReadiness: {
      role: 'operation',
      purpose: t(
        'Captures one immutable composition readiness fact, reading state then error once each. Availability is validated; Error identity is preserved without tracking later source changes.',
        '一次捕获不可变的组合就绪事实，严格先读状态再读错误，各读一次；校验可用性并保留错误身份，不追踪来源的后续变化。'
      ),
      params: {
        source: t(
          'Composition-owned fields or getters providing ready, blocked or failed and the related error.',
          '组合层提供的字段或读取器，给出 `ready`、`blocked` 或 `failed` 及对应错误。'
        )
      },
      returns: t(
        'Frozen IGraphReadinessSnapshot. Invalid state uses `INVALID_OPTION`; native getter errors receive this code in place where possible, preserving type and identity. Primitive, immutable or conflicting failures stay reachable through `cause`, including undefined.',
        '返回冻结的 `IGraphReadinessSnapshot`；非法状态使用 `INVALID_OPTION`。原生读取器错误尽可能原位附码并保留类型身份；原始值、不可修改或身份冲突失败通过 `cause` 保留，包含空缺值。'
      ),
      example: `import { snapshotGraphReadiness } from '@migaia/capability'\nconsole.log(snapshotGraphReadiness({ state: 'ready', error: undefined }))`
    },
    ...capabilityGraphReference.symbols,
    ...capabilityTopologyReference.symbols
  },
  types: { ...types, ...capabilityGraphReference.types, ...capabilityTopologyReference.types },
  enums: { ...enums, ...capabilityGraphReference.enums, ...capabilityTopologyReference.enums },
  enhancers: {}
}
