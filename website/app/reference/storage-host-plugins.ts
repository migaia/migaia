import type { ICode, IMemberDoc, IText, ITypeDoc } from './contract.js'
import { storageHostCases } from './storage-host-cases.js'

/** Plugin author metadata preserves the existing installation and invocation boundary. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Examples accept authentic ports from their original author callback, not forged native stores. */
const coreExample = (statement: string): string =>
  `${statement.includes('createChangeController') ? "import { createBackendChangeController } from '@migaia/storage-host/authoring/change-controller'\n" : ''}import type { IStoragePluginCore } from '@migaia/storage-host'\nfunction configure(core: IStoragePluginCore) {\n  ${statement}\n}\nconsole.log(typeof configure)`
/** Each method describes its actual parameters and original owner rather than a substitute API. */
const method = (
  summary: IText,
  params: Readonly<Record<string, IText>>,
  returns: IText,
  example: ICode
): IMemberDoc => ({ summary, params, returns, example })
/** Native store objects are issued by the backend and registered once in this exact install. */
const storeParam = t(
  'Exact original native store registered by this backend installation.',
  '来自本后端安装登记的准确原生存储对象，不能用其它宿主的同名后端替代。'
)
/** Organization identifiers come from the original host context. */
const orgParam = t(
  'Canonical UUID returned by createOrgId or this host’s organization view.',
  '来自 `createOrgId` 或本宿主组织视图返回的规范编号。'
)
/** Transaction views are issued by the native owner while that scope is active. */
const scopeParam = t(
  'Authentic active scope issued by the original native transaction callback.',
  '来自原生事务回调的真实活跃作用域，不接受结构相似的替代对象。'
)
/** Late organization construction reuses the authority captured during the original installation. */
const orgAuthorMembers: Readonly<Record<string, IMemberDoc>> = {
  createKeyLockPort: method(
    t(
      'Create one canonical physical key-lock port through the original owner; it is not a new retry or transaction engine.',
      '经原拥有者创建规范物理键锁接点，不另建重试或事务引擎。'
    ),
    {},
    t(
      'Original IBackendKeyLockPort, released through the existing registration lifecycle.',
      '返回原键锁接点，由既有登记生命周期释放。'
    ),
    coreExample('const locks = core.createKeyLockPort()\n  console.log(locks.inspectLocks())')
  ),
  createRevisionPort: method(
    t(
      'Create revision and clear-epoch facts for one physical namespace with the original revision implementation.',
      '用原修订实现为一个物理命名空间创建修订与清空代际事实。'
    ),
    {},
    t(
      'Original IBackendRevisionPort; reads alone allocate no channel state.',
      '返回原修订接点，仅仅读取不会分配通道状态。'
    ),
    coreExample(
      'const revisions = core.createRevisionPort()\n  console.log(revisions.epoch("text"))'
    )
  ),
  createChangeController: method(
    t(
      'Construct the original admitted-mutation and notification owner for this physical target.',
      '为本物理目标构造原已准入修改与通知拥有者。'
    ),
    {
      factory: t(
        'Explicit controller constructor imported from the optional change-controller entry.',
        '从可选通知控制器入口导入的显式构造函数。'
      ),
      options: t(
        'Captured backend kind, optional native snapshot/origin and original finalizer.',
        '捕获的后端种类、可选原生快照与来源及原清理回调。'
      )
    },
    t(
      'Original controller retained by this registration’s existing cleanup owner.',
      '返回原控制器，由本登记已有清理拥有者保留。'
    ),
    coreExample(
      'const controller = core.createChangeController({ backend: "memory" }, createBackendChangeController)\n  console.log(controller.origin)'
    )
  ),
  registerChangeController: method(
    t(
      'Bind the exact native store to its original controller; root observation forwards child org publications.',
      '把准确原生存储绑定到原控制器，根观察接收子组织发布。'
    ),
    {
      store: storeParam,
      controller: t(
        'Controller issued by the original createChangeController factory.',
        '来自原 `createChangeController` 工厂返回的控制器。'
      )
    },
    t(
      'No result; the existing registry row and release order are retained.',
      '无返回值，继续使用既有登记行与释放顺序。'
    ),
    `import { createBackendChangeController } from '@migaia/storage-host/authoring/change-controller'\nimport type { IStorageOrgAuthoringPort } from '@migaia/storage-host'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction register(port: IStorageOrgAuthoringPort, store: IStorageBase) {\n  const controller = port.createChangeController({ backend: 'memory' }, createBackendChangeController)\n  port.registerChangeController(store, controller)\n}\nconsole.log(typeof register)`
  ),
  registerValueCommit: method(
    t(
      'Bind the backend’s real atomic text compare/write endpoint for entity unique writes.',
      '绑定后端真实原子文本比较写接点，供实体唯一写入复用。'
    ),
    {
      store: storeParam,
      commit: t(
        'Original IBackendValueCommit from the same physical backend owner.',
        '来自同一物理后端拥有者的原值提交回调。'
      )
    },
    t(
      'No result; no fake transaction or close handle is introduced.',
      '无返回值，不引入伪事务或关闭句柄。'
    ),
    `import { createBackendChangeController } from '@migaia/storage-host/authoring/change-controller'\nimport type { IStorageOrgAuthoringPort } from '@migaia/storage-host'\nimport type { IBackendValueCommit } from '@migaia/storage-host/authoring/backend'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction register(port: IStorageOrgAuthoringPort, store: IStorageBase, commit: IBackendValueCommit) {\n  port.registerValueCommit(store, commit)\n}\nconsole.log(typeof register)`
  )
}
/** An exact borrowed business view omits resource ownership and preserves original token lookup. */
const borrowedMembers: Readonly<Record<string, IMemberDoc>> = {
  has: method(
    t(
      'Check the original token identity in this view’s safely projected capability map.',
      '按原令牌身份检查本视图安全投影的能力映射，不按属性名猜测能力。'
    ),
    {
      capability: t(
        'Original token imported from storage-contract, not a recreated same-name token.',
        '来自存储契约的原令牌，不能用同名重建令牌替代。'
      )
    },
    t(
      'True exactly when use can borrow that capability on this view.',
      '返回真时才能在本视图借用该能力，保持有无判断一致。'
    ),
    `import { kv } from '@migaia/storage-contract'\nimport { createStorageHost, memoryBackendPlugin, createOrgId } from '@migaia/storage-host'\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconsole.log(host.org(createOrgId()).backend('memory').has(kv))`
  ),
  use: method(
    t(
      'Borrow the same-owner capability implementation fixed to this organization without granting registration or close rights.',
      '借用固定本组织且属于同一拥有者的能力实现，不授予登记或关闭权限。'
    ),
    {
      capability: t(
        'Original capability token used by the store’s authentic registration.',
        '原存储真实登记使用的能力令牌。'
      )
    },
    t(
      'Projected capability API; absent or unsafe custom org projections reject UNSUPPORTED_CAPABILITY.',
      '返回投影能力接口，缺失或无法安全组织投影的自定义能力报不支持。'
    ),
    `import { kv } from '@migaia/storage-contract'\nimport { createStorageHost, memoryBackendPlugin, createOrgId } from '@migaia/storage-host'\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst api = host.org(createOrgId()).backend('memory').use(kv)\nawait api.set('theme', 'dark')`
  )
}

/** Host plugin, kind and execution types are the existing original owner’s public contracts. */
export const storageHostPluginTypes: Readonly<Record<string, ITypeDoc>> = {
  IStorageNativePluginDescriptor: {
    summary: t(
      'Original backend descriptor supplies construction/expose callbacks only; host registration, Feature lifecycle and cleanup remain installed once.',
      '原后端描述器只提供构造及暴露回调，宿主登记、特性生命周期与清理仍只安装一次。'
    ),
    members: {
      kind: {
        summary: t(
          'Optional authentic backend kind; omission supports ordinary nonbackend extension plugins.',
          '可选真实后端种类，省略时可定义普通非后端扩展插件。'
        )
      },
      contextualExtensions: {
        summary: t(
          'Explicit top-level API object keys whose own methods receive the original fixed-org context; other data retains identity.',
          '显式顶层接口对象键，其自有方法接收原固定组织上下文，其它数据保留身份。'
        )
      },
      install: method(
        t(
          'Execute the original installation callback once and return its application extension object.',
          '执行原安装回调一次，并返回应用扩展对象，不在组织切换时重跑。'
        ),
        {},
        t(
          'An extension object or its original thenable; errors rollback the original install batch.',
          '返回扩展对象或原异步结果，失败沿原安装批次回滚。'
        ),
        `import type { IStorageNativePluginDescriptor } from '@migaia/storage-host'\nconst descriptor: IStorageNativePluginDescriptor = { install: () => ({ label: 'draft' }) }\nconsole.log(typeof descriptor.install)`
      ),
      expose: method(
        t(
          'Return original public plugin exports under the host’s captured invocation context.',
          '在宿主捕获的调用上下文下返回原公开插件导出。'
        ),
        {},
        t(
          'Original export object, preserving unselected data and selected contextual methods.',
          '返回原导出对象，保留未选数据及已选上下文化方法。'
        ),
        `import type { IStorageNativePluginDescriptor } from '@migaia/storage-host'\nconst descriptor: IStorageNativePluginDescriptor = { expose: () => ({ label: 'draft' }) }\nconsole.log(descriptor.expose?.())`
      ),
      featureExpose: method(
        t(
          'Return descriptor-owned native client and extra author functions for the once Feature factory.',
          '为一次特性工厂返回描述器拥有的原生客户端及额外作者函数。'
        ),
        {},
        t(
          'Finite author object; the host supplies its own protected methods separately.',
          '返回有限作者对象，宿主另行补入自身受保护方法。'
        ),
        `import type { IStorageNativePluginDescriptor } from '@migaia/storage-host'\nconst descriptor: IStorageNativePluginDescriptor = { featureExpose: () => ({ getClient: () => undefined }) }\nconsole.log(typeof descriptor.featureExpose)`
      ),
      capabilityInstaller: method(
        t(
          'Borrow the original exact store’s capability installation port during its original admission.',
          '在原准入期间借用准确原存储的能力安装接点。'
        ),
        { store: storeParam },
        t(
          'Authentic installer port; this does not grant a second provider registry.',
          '返回真实安装接点，不授予第二能力提供者登记表。'
        ),
        `import type { IStorageNativePluginDescriptor } from '@migaia/storage-host'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction installer(descriptor: IStorageNativePluginDescriptor, store: IStorageBase) {\n  return descriptor.capabilityInstaller?.(store)\n}\nconsole.log(typeof installer)`
      ),
      journalBinding: method(
        t(
          'Capture the original native journal binding once after exact-store admission.',
          '准确存储准入之后单次捕获原生日志绑定，不在组织调用时重装。'
        ),
        { store: storeParam },
        t(
          'Fixed-owner private journal binding, with native I/O and terminal authority retained by the backend.',
          '返回固定拥有者的私有日志绑定，原生读写及终态权限保留在后端。'
        ),
        `import type { IStorageNativePluginDescriptor } from '@migaia/storage-host'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction binding(descriptor: IStorageNativePluginDescriptor, store: IStorageBase) {\n  return descriptor.journalBinding?.(store)\n}\nconsole.log(typeof binding)`
      )
    }
  },
  IStoragePluginCore: {
    summary: t(
      'Finite author core from the original installation window; published business views never receive this registration or cleanup authority.',
      '来自原安装窗口的有限作者核心，已发布业务视图始终不取得此登记或清理权限。'
    ),
    members: {
      registerJournalRuntime: method(
        t(
          'Admit the runtime supplied by the selected journal plugin in the original installation scope.',
          '在原安装作用域内接纳所选日志插件提供的运行时，应用使用 `storageJournalPlugin()` 选择该能力。'
        ),
        {
          runtime: t(
            'Opaque function table supplied by storageJournalPlugin; callers do not construct it.',
            '由 `storageJournalPlugin` 提供的不透明函数表，调用方不自行构造。'
          )
        },
        t(
          'Registers the selected journal runtime until its original plugin registration is disposed.',
          '登记所选日志运行时，生命周期跟随原插件登记。'
        ),
        `import type { IStoragePluginCore } from '@migaia/storage-host'
function install(
  core: IStoragePluginCore,
  runtime: Parameters<IStoragePluginCore['registerJournalRuntime']>[0]
) { core.registerJournalRuntime(runtime) }
console.log(typeof install)`
      ),
      ...orgAuthorMembers,
      journal: {
        summary: t(
          'Optional fixed-org original journal execution port, absent when global journal was not selected.',
          '可选固定组织原日志执行接点，未选择全局日志时不存在。'
        )
      },
      defaultOrgId: {
        summary: t(
          'Canonical default UUID captured from the original host options.',
          '来自原宿主选项捕获的规范缺省组织编号。'
        )
      },
      execution: {
        summary: t(
          'Original sync/async pipeline and telemetry port, not another runner or retry owner.',
          '原同步、异步流水线与遥测接点，不是第二执行器或重试拥有者。'
        )
      },
      hooks: {
        summary: t(
          'The original synchronous host observer registry for this installation.',
          '本次安装使用的原同步宿主观察登记表。'
        )
      },
      stageBindings: {
        summary: t(
          'Original stage observer factories fixed to the exact backend registration.',
          '固定准确后端登记的原阶段观察工厂。'
        )
      },
      createTransactionApi: method(
        t(
          'Project selected transaction methods onto the authentic fresh native scope before it freezes.',
          '在真实新原生作用域冻结之前投影所选事务方法。'
        ),
        { scope: scopeParam },
        t(
          'Original selected API object or undefined, without a new transaction builder.',
          '返回原所选接口对象或未定义值，不创建新事务构造器。'
        ),
        `import type { IStoragePluginCore } from '@migaia/storage-host'\nfunction project(core: IStoragePluginCore, scope: object) {\n  return core.createTransactionApi(scope)\n}\nconsole.log(typeof project)`
      ),
      getChainMethods: method(
        t(
          'Read only the installed augmentation for one original fluent creator family.',
          '只读取一个原链创建家族已经安装的扩展方法，不混合其它家族。'
        ),
        {
          family: t(
            'One original tx, query, vector or rdf family key.',
            '原事务、记录查询、向量或资源描述家族键之一。'
          )
        },
        t(
          'Installed method object or undefined; omission allocates no empty replacement.',
          '返回已安装方法对象或未定义值，缺失不分配空替代对象。'
        ),
        coreExample('console.log(core.getChainMethods("query"))')
      ),
      createOrgAuthoringPort: method(
        t(
          'Capture only the finite original factories during installation for later physical org construction.',
          '在安装期间只捕获原有限工厂，供后续物理组织构造使用。'
        ),
        {},
        t(
          'Same-registration author port; its cleanup stays with the existing registration owner.',
          '返回同登记作者接点，清理仍归已有登记拥有者。'
        ),
        coreExample(
          'const orgAuthors = core.createOrgAuthoringPort()\n  console.log(typeof orgAuthors.createRevisionPort)'
        )
      ),
      registerOrgBinding: method(
        t(
          'Register native fixed-org lookup and deletion for this exact admitted store.',
          '为本准确准入存储登记原生固定组织查找与删除。'
        ),
        {
          store: storeParam,
          binding: t(
            'Original same-owner backend/drop callbacks retaining their physical data universe.',
            '保留自身物理数据宇宙的原同拥有者后端与删除回调。'
          )
        },
        t(
          'No result; duplicate or revoked registration rejects before publication.',
          '无返回值，重复或撤销登记在发布之前拒绝。'
        ),
        `import type { IStoragePluginCore, IStorageOrgBinding } from '@migaia/storage-host'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction register(core: IStoragePluginCore, store: IStorageBase, binding: IStorageOrgBinding) {\n  core.registerOrgBinding(store, binding)\n}\nconsole.log(typeof register)`
      ),
      registerFeatureClientResolver: method(
        t(
          'Register one optional fixed-org native resolver during the original exact-store installation.',
          '在原准确存储安装期间登记一个可选固定组织原生解析器。'
        ),
        {
          store: storeParam,
          resolver: t(
            'Original native client and synchronous transaction-client resolution callbacks.',
            '原生客户端及同步事务客户端解析回调。'
          )
        },
        t(
          'No result; unregistered descriptors keep original getter timing unchanged.',
          '无返回值，未登记描述器保持原取值时机不变。'
        ),
        `import type { IStoragePluginCore, IStorageFeatureClientResolver } from '@migaia/storage-host'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction register(core: IStoragePluginCore, store: IStorageBase, resolver: IStorageFeatureClientResolver) {\n  core.registerFeatureClientResolver(store, resolver)\n}\nconsole.log(typeof register)`
      ),
      getOrgContext: method(
        t(
          'Read immutable invocation ports for a canonical organization; it grants no new installation window.',
          '读取规范组织的不可变调用接点，不授予新安装窗口。'
        ),
        { orgId: orgParam },
        t(
          'Original fixed-org execution, call context and observers without registration or close rights.',
          '返回原固定组织执行、调用上下文及观察接点，不含登记或关闭权。'
        ),
        coreExample('console.log(core.getOrgContext(core.defaultOrgId).orgId)')
      ),
      registerDetect: method(
        t(
          'Register an original asynchronous environment check during installation.',
          '在安装期间登记原异步环境检查，不重复构造后台探针。'
        ),
        {
          check: t(
            'Receives the original detection signal and returns a Promise; failure follows original detect cleanup.',
            '接收原环境检查信号并返回承诺，失败沿原检查清理路径处理。'
          )
        },
        t(
          'No result; checks run only at the original detect boundary.',
          '无返回值，检查只在原环境检查边界执行。'
        ),
        coreExample(
          'core.registerDetect(async (signal) => {\n    if (signal.aborted) throw signal.reason\n  })'
        )
      ),
      registerStore: method(
        t(
          'Admit the exact backend once in its original install cell.',
          '在原安装单元中准入准确后端一次，不按标识重新构造后端。'
        ),
        { store: storeParam },
        t(
          'No result; native resource ownership and exact identity remain unchanged.',
          '无返回值，原生资源所有权与准确身份不变。'
        ),
        `import type { IStoragePluginCore } from '@migaia/storage-host'\nimport type { IStorageBase } from '@migaia/storage-contract'\nfunction register(core: IStoragePluginCore, store: IStorageBase) {\n  core.registerStore(store)\n}\nconsole.log(typeof register)`
      ),
      getStore: method(
        t(
          'Read the exact already-admitted native store within this original author window.',
          '在原作者窗口读取准确且已经准入的原生存储。'
        ),
        {},
        t(
          'Original IStorageBase; missing or revoked registration rejects.',
          '返回原存储基础面，缺失或撤销登记拒绝。'
        ),
        coreExample('console.log(core.getStore())')
      ),
      getBackendId: method(
        t(
          'Read the literal id issued by this original installation.',
          '读取本次原安装发出的字面量编号，不生成第二身份。'
        ),
        {},
        t(
          'Exact installed backend id for diagnostics and dependency lookup.',
          '返回用于诊断与依赖查找的准确安装编号。'
        ),
        coreExample('console.log(core.getBackendId())')
      ),
      features: {
        summary: t(
          'Once-selected original Feature outputs with preserved named inference.',
          '单次所选原特性输出，保留具名类型推断。'
        )
      },
      featureExpose: {
        summary: t(
          'Original installer-issued Feature author access; native client facts are borrowed, not reconstructed.',
          '原安装器发出的特性作者访问面，借用原生客户端事实，不重新构造。'
        )
      },
      operation: {
        summary: t(
          'The original PluginHost install operation and its cancellation budget.',
          '原插件宿主安装操作及其取消预算，不建立第二操作。'
        )
      },
      lifecycle: {
        summary: t(
          'The original exact registration’s revoke and cleanup lifecycle.',
          '原准确登记的撤销及清理生命周期。'
        )
      },
      onDispose: method(
        t(
          'Register cleanup in the original installation lifecycle and preserve its existing ordering.',
          '在原安装生命周期登记清理，并保留既有顺序。'
        ),
        {
          resource: t(
            'Original disposer function or resource accepted by PluginHost.',
            '插件宿主接纳的原清理函数或资源对象。'
          )
        },
        t(
          'No result; late registration rejects at the original owner.',
          '无返回值，迟到登记由原拥有者拒绝。'
        ),
        coreExample('core.onDispose(() => { console.log("released") })')
      ),
      usePipeline: method(
        t(
          'Install an original synchronous middleware stage during this installation.',
          '在本安装期间安装原同步中间件阶段，不另建流水线。'
        ),
        {
          stage: t(
            'Original synchronous stage receiving input and next; forward prepared input to continue.',
            '接收输入及继续函数的原同步阶段，继续时转发准备输入。'
          )
        },
        t(
          'Original core for author chaining; the stage is removed by the original lifecycle.',
          '返回原核心以供作者链调用，该阶段由原生命周期移除。'
        ),
        coreExample('core.usePipeline((input, next) => next(input))')
      ),
      useAsyncPipeline: method(
        t(
          'Install an original asynchronous middleware stage; sync entries then retain the original async-stage rejection rule.',
          '安装原异步中间件阶段，同步入口继续遵循原异步阶段拒绝规则。'
        ),
        {
          stage: t(
            'Original async stage receiving input and next; return or await next exactly as required by middleware.',
            '接收输入及继续函数的原异步阶段，按中间件约定返回或等待继续函数。'
          )
        },
        t(
          'Original core, without a second scheduler or cancellation owner.',
          '返回原核心，不引入第二调度器或取消拥有者。'
        ),
        coreExample('core.useAsyncPipeline(async (input, next) => next(input))')
      )
    }
  },
  IStorageEnvelopeStages: {
    scenarios: [
      t(
        'Observe the original repository envelope check and migration without retaining its state.',
        '观察原仓储存档检查及迁移，而不保留其状态。'
      )
    ],
    example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst stages = host.envelopeStages(host.backend('memory'), { operation: 'read', targetVersion: 1 })\nstages.beforeEnvelopeCheck()`,
    summary: t(
      'Primitive original archive validation and migration observers; state derivation and lifecycle ownership remain separate.',
      '基本原存档校验与迁移观察接点，状态推导与生命周期所有权保持分离。'
    ),
    members: {
      beforeEnvelopeCheck: method(
        t(
          'Observe before original archive validation without reading unvalidated state.',
          '在原存档校验之前观察，不读取未验证状态。'
        ),
        {},
        t('No result; observation cannot alter validation.', '无返回值，观察不能改变校验。'),
        `import type { IStorageEnvelopeStages } from '@migaia/storage-host'\nfunction observe(stages: IStorageEnvelopeStages) { stages.beforeEnvelopeCheck() }\nconsole.log(typeof observe)`
      ),
      afterEnvelopeCheck: method(
        t(
          'Observe a stored version only after original validation succeeds.',
          '原校验成功之后才观察持久版本。'
        ),
        {
          version: t(
            'Validated version from the original envelope checker.',
            '来自原存档检查器的已验证版本。'
          )
        },
        t(
          'No result; only primitive confirmed facts are reported.',
          '无返回值，只报告已确认基本事实。'
        ),
        `import type { IStorageEnvelopeStages } from '@migaia/storage-host'\nfunction observe(stages: IStorageEnvelopeStages) { stages.afterEnvelopeCheck(1) }\nconsole.log(typeof observe)`
      ),
      onVersionRejected: method(
        t(
          'Report original version rejection without replacing its primary error.',
          '报告原版本拒绝，不替换其主要错误。'
        ),
        {
          version: t(
            'Known stored version, omitted when unreadable.',
            '已知持久版本，不可读时省略。'
          ),
          code: t('Original semantic code from the version checker.', '来自原版本检查器的语义码。')
        },
        t(
          'No result; original rejection handling remains unchanged.',
          '无返回值，原拒绝处理保持不变。'
        ),
        `import type { IStorageEnvelopeStages } from '@migaia/storage-host'\nfunction observe(stages: IStorageEnvelopeStages) { stages.onVersionRejected(2, 'VERSION_UNSUPPORTED') }\nconsole.log(typeof observe)`
      ),
      afterMigrate: method(
        t(
          'Report original steps or reset completion without repeating application migration.',
          '报告原步骤或重置完成，不重复运行应用迁移。'
        ),
        {
          version: t('Final version confirmed by the original plan.', '原计划确认的最终版本。'),
          mode: t(
            'steps for ordered migrations, reset for original reset fallback.',
            '有序迁移采用步骤模式，原重置回退采用重置模式。'
          ),
          stepCount: t('Actual successfully completed step count.', '实际成功完成的步骤数量。'),
          elapsedMs: t(
            'Elapsed milliseconds from the original scheduler.',
            '来自原调度器的毫秒耗时。'
          )
        },
        t('No result; failures only report.', '无返回值，观察失败只报告。'),
        `import type { IStorageEnvelopeStages } from '@migaia/storage-host'\nfunction observe(stages: IStorageEnvelopeStages) { stages.afterMigrate(2, 'steps', 1, 0) }\nconsole.log(typeof observe)`
      ),
      observe: {
        summary: t(
          'Original per-step migration observer, with no state or archive retained.',
          '原逐步骤迁移观察接点，不保留状态或存档。'
        )
      }
    }
  },
  IStorageBackendKind: {
    summary: t(
      'Identity-bearing backend store/client/expose type; matching names never substitute for exact kind identity.',
      '携带后端存储、客户端及暴露类型的身份，同名不能替代准确种类身份。'
    ),
    members: {
      name: {
        summary: t(
          'Author-selected backend kind label, not a lookup or capability credential.',
          '作者选择的后端种类标签，不是查找凭证或能力授权。'
        )
      }
    }
  },
  IStorageBackendPlugin: {
    scenarios: [
      t(
        'Install a literal-id native backend without opening it before the host batch.',
        '通过字面量编号安装原生后端，不在宿主批次之前提前打开。'
      )
    ],
    example: storageHostCases.memoryBackendPlugin![0]!.example,
    summary: t(
      'Opaque literal-id backend handle carrying the original kind, selected Features and exact constructed store type.',
      '携带原种类、所选特性及准确构造存储类型的不透明字面量后端句柄。'
    ),
    members: {
      id: {
        summary: t(
          'Literal id issued by the plugin definition and checked by original duplicate admission.',
          '插件定义发出的字面量编号，由原重复准入检查。'
        )
      }
    }
  },
  IStorageBackendPluginHandle: {
    summary: t(
      'Common opaque plugin identity admitted by the original host installation; it does not expose native stores.',
      '原宿主安装接纳的公共不透明插件身份，不通过此句柄暴露原生存储。'
    ),
    members: {
      id: {
        summary: t(
          'Literal backend id supplied to the original plugin factory.',
          '提供给原插件工厂的字面量后端编号。'
        )
      }
    }
  },
  IStorageBorrowedBackend: {
    scenarios: [
      t(
        'Use an immutable organization view without inheriting backend shutdown rights.',
        '使用不可变组织视图，同时不继承后端关闭权限。'
      )
    ],
    example: borrowedMembers.use!.example,
    summary: t(
      'Original business methods and safe token lookup without dispose, asyncDispose or capability registration authority.',
      '保留原业务方法及安全令牌查找，但不授予释放、异步释放或能力登记权限。'
    ),
    members: borrowedMembers
  },
  IStorageBorrowPort: {
    summary: t(
      'Installation-only read of earlier committed dependencies, retaining exact borrowed stores without shutdown rights.',
      '只在安装窗口读取此前已提交依赖，保留准确借用存储但不获得关闭权限。'
    ),
    members: {
      getPublishedBackend: method(
        t(
          'Borrow an earlier committed dependency; the current uncommitted batch is not visible.',
          '借用此前已经提交的依赖，当前未提交批次不可见。'
        ),
        {
          id: t(
            'Literal id returned by an already-installed dependency’s plugin handle.',
            '来自已经安装依赖的插件句柄返回的字面量编号。'
          )
        },
        t(
          'Authenticated close-free view; lookup outside its original installation window rejects.',
          '返回认证且无关闭权的视图，离开原安装窗口查找会拒绝。'
        ),
        coreExample(
          'const dependency = core.getPublishedBackend("dependency")\n  console.log(dependency)'
        )
      ),
      emit: {
        summary: t(
          'Original typed native diagnostics; closing skips optional payload factories, while closed or revoked registrations reject.',
          '原类型化原生诊断，关闭中跳过可选载荷工厂，已关闭或已撤销登记仍拒绝。'
        )
      }
    }
  },
  IStoragePluginCallContext: {
    summary: t(
      'Original invocation receiver fixes one organization and authenticated borrowed dependency projections.',
      '原调用接收者固定一个组织，并提供认证借用依赖投影，不包含根安装与关闭权。'
    ),
    members: {
      orgId: { summary: orgParam },
      backend: method(
        t(
          'Project only this exact already-borrowed dependency into the invocation’s fixed organization.',
          '只把本准确已借用依赖投影到本次调用的固定组织。'
        ),
        {
          borrowed: t(
            'Authenticated dependency returned by original getPublishedBackend.',
            '来自原 `getPublishedBackend` 返回的认证依赖。'
          )
        },
        t(
          'Same typed business surface under the fixed invocation context.',
          '返回相同类型的业务面，固定到本次调用上下文。'
        ),
        `import type { IStoragePluginCallContext, IStorageBorrowedBackend } from '@migaia/storage-host'\nfunction project(context: IStoragePluginCallContext, borrowed: IStorageBorrowedBackend) {\n  return context.backend(borrowed)\n}\nconsole.log(typeof project)`
      )
    }
  },
  IStorageFeatureCallContext: {
    summary: t(
      'Feature method receiver supplies the exact fixed-org native client and either original store or authenticated active scope.',
      '特性方法接收者提供准确固定组织原生客户端，以及原存储或已经认证的活跃作用域。'
    ),
    members: {
      client: {
        summary: t(
          'Original backend client, or its authentic transaction client in transaction methods.',
          '原后端客户端，事务方法中为其真实事务客户端。'
        )
      },
      store: {
        summary: t(
          'Original business store at root, or the exact active scope in transaction calls.',
          '根调用中为原业务存储，事务调用中为准确活跃作用域。'
        )
      },
      scope: {
        summary: t(
          'Undefined at root; original authenticated scope during a transaction call.',
          '根调用时未定义，事务调用时为原认证作用域。'
        )
      }
    }
  },
  IStorageFeatureApi: {
    summary: t(
      'Separate root-store and transaction API groups; transaction methods require a real native client getter.',
      '分离根存储与事务接口组，事务方法要求真实原生客户端取值函数。'
    ),
    members: {
      store: {
        summary: t(
          'Asynchronous methods bound to original store/client and fixed org.',
          '绑定原存储、客户端及固定组织的异步方法。'
        )
      },
      transaction: {
        summary: t(
          'Asynchronous methods bound to the authentic already-active scope/client.',
          '绑定已经活跃的真实作用域及客户端的异步方法。'
        )
      }
    }
  },
  IStorageFeatureApiGroup: {
    summary: t(
      'Recursive named groups of asynchronous API methods contextualized only by the original Feature installer.',
      '递归具名异步接口方法组，只由原特性安装器绑定调用上下文，不自行构造客户端。'
    ),
    members: {}
  },
  IStorageFeatureOutput: {
    summary: t(
      'Selected capability, four-family chain and grouped API contributions are installed once by the original Feature owner.',
      '所选能力、四家族链与分组接口贡献只由原特性拥有者安装一次，不重跑工厂。'
    ),
    members: {
      capabilities: {
        summary: t(
          'Authentic capability implementations admitted to the same original store map.',
          '准入到同一原存储映射的真实能力实现。'
        )
      },
      chain: {
        summary: t(
          'Separated transaction, record query, vector and RDF augmentations; families never merge into each other.',
          '彼此分离的事务、记录查询、向量及资源描述扩展，各家族不能互相混入。'
        )
      },
      api: {
        summary: t(
          'Explicit root and transaction method groups using the original call receiver.',
          '使用原调用接收者的显式根与事务方法组。'
        )
      }
    }
  },
  IStorageFeatureExpose: {
    summary: t(
      'Finite once-factory author methods issued by the original host; selected Features borrow client/store facts without a second registry.',
      '原宿主发出的有限一次工厂作者方法，所选特性借用客户端及存储事实，不建立第二登记表。'
    ),
    members: {}
  },
  IStorageDescriptorFeatureExpose: {
    summary: t(
      'Descriptor authors supply only getClient and kind-declared extra functions; all host/lifecycle methods marked never are installer-owned.',
      '描述器作者只提供客户端取值与种类声明的额外函数，标记为禁止的宿主及生命周期方法归安装器拥有。'
    ),
    members: {
      getClient: method(
        t(
          'Return the original native client from this descriptor’s backend.',
          '返回本描述器后端的原生客户端，不重新获取第二连接。'
        ),
        {},
        t(
          'Exact client shape declared by the authentic kind.',
          '返回真实种类声明的准确客户端形状。'
        ),
        `import type { IStorageDescriptorFeatureExpose } from '@migaia/storage-host'\nimport { memoryBackendKind } from '@migaia/storage-host'\nconst expose: IStorageDescriptorFeatureExpose<typeof memoryBackendKind> = {\n  getClient: () => undefined,\n  getTransactionClient: () => undefined\n}\nconsole.log(expose.getClient())`
      ),
      ...Object.fromEntries(
        [
          ['getChangeController', 'controller lookup', '控制器查找'],
          ['getKind', 'kind identity', '种类身份'],
          ['getStore', 'native store access', '原生存储访问'],
          ['getBackendId', 'backend identity', '后端身份'],
          ['getLifecycle', 'registration lifecycle', '登记生命周期'],
          ['onDispose', 'cleanup registration', '清理登记'],
          ['getScheduler', 'scheduler lookup', '调度器查找'],
          ['getPublishedBackend', 'dependency borrowing', '依赖借用'],
          ['emit', 'native observation', '原生观察'],
          ['registerDetect', 'environment check registration', '环境检查登记']
        ].map(([name, en, zh]) => [
          name!,
          {
            summary: t(
              `Forbidden descriptor field: ${en} is supplied only by the original host installer.`,
              `描述器禁止提供此字段：${zh}只能由原宿主安装器补入，不能自行伪造。`
            )
          }
        ])
      )
    }
  },
  IStorageFeatureClientResolver: {
    summary: t(
      'Optional once-registered original client routing for each fixed organization; transaction resolution stays synchronous.',
      '可选一次登记的固定组织原客户端路由，事务客户端解析保持同步且不重开事务。'
    ),
    example: storageHostCases.IStorageFeatureClientResolver![0]!.example,
    members: {
      getClient: method(
        t(
          'Resolve or prepare this organization’s exact original native client.',
          '解析或准备本组织准确原生客户端，同步客户端仍同步返回。'
        ),
        { orgId: orgParam },
        t(
          'The native client or original thenable; host awaits only a real thenable and rechecks registration afterward.',
          '返回原生客户端或原异步结果，宿主只等待真实异步结果并在之后复核登记。'
        ),
        storageHostCases.IStorageFeatureClientResolver![0]!.example
      ),
      getTransactionClient: method(
        t(
          'Synchronously resolve the already-active original transaction client; never open or await a new transaction.',
          '同步解析已经活跃的原事务客户端，绝不打开或等待新事务。'
        ),
        { scope: scopeParam, orgId: orgParam },
        t(
          'Exact native transaction client; an expired or foreign scope rejects before Feature I/O.',
          '返回准确原生事务客户端，过期或外来作用域在特性读写前拒绝。'
        ),
        storageHostCases.IStorageFeatureClientResolver![0]!.example
      )
    }
  },
  IStorageOrgAuthoringPort: {
    summary: t(
      'Installation-captured finite factories for lazy physical organizations; late calls retain original admission and cleanup order.',
      '安装时捕获的延迟物理组织有限工厂，迟调用保留原准入与清理顺序，不获得重新安装权限。'
    ),
    members: orgAuthorMembers
  },
  IStorageExecutionRequest: {
    summary: t(
      'Original backend endpoint request forwarded into one existing pipeline, with optional truthful telemetry keys.',
      '原后端终点请求进入同一个既有流水线，并可提供真实遥测键事实，不新增执行器。'
    ),
    members: {
      operation: {
        summary: t(
          'Canonical operation name issued by the native endpoint.',
          '由原生终点发出的规范操作名称。'
        )
      },
      input: {
        summary: t(
          'Original typed request payload; approved pipeline changes are forwarded to the real terminal.',
          '原类型化请求负载，允许的流水线修改转发到真实终点。'
        )
      },
      ctx: {
        summary: t(
          'Captured original caller budget/context; no second timeout is introduced.',
          '捕获的原调用方预算与上下文，不引入第二超时。'
        )
      },
      scope: { summary: scopeParam },
      keys: {
        summary: t(
          'Optional lazy original backend facts returning canonical affected lock keys only when telemetry emits.',
          '可选惰性原后端事实，仅在遥测发出时返回规范受影响锁键。'
        )
      },
      internal: {
        summary: t(
          'True only for original journal opt-out/private work or a child already covered by its public parent endpoint.',
          '仅原日志退出标记的私有工作，或已被公开父终点覆盖的子操作为真。'
        )
      }
    }
  },
  IStoragePipelineInput: {
    summary: t(
      'Original execution request plus immutable host-issued backend id, kind and organization for the existing pipeline.',
      '原执行请求加上宿主发出的不可变后端编号、种类及组织，供既有流水线使用。'
    ),
    members: {
      backendId: {
        summary: t(
          'Literal id issued by the exact current original installation.',
          '由当前准确原安装发出的字面量后端编号。'
        )
      },
      backend: {
        summary: t('Original admitted backend kind label.', '原已经准入的后端种类名称。')
      },
      orgId: { summary: orgParam }
    }
  },
  IStorageExecutionPort: {
    summary: t(
      'The original backend pipeline and observation port requires its terminal to run; it owns no separate retry loop.',
      '原后端流水线与观察接点要求终点真实执行，不拥有独立重试循环或并发预算。'
    ),
    members: {
      observe: method(
        t(
          'Observe one complete original attempt/retry loop without registering another pipeline.',
          '观察完整原尝试与重试循环，不登记另一份流水线。'
        ),
        {
          describe: t(
            'Lazy callback returning the original request and current affected-key facts.',
            '返回原请求及当前受影响键事实的惰性回调。'
          ),
          invoke: t(
            'Original work receives whether telemetry is enabled and returns its Promise.',
            '原工作接收是否启用遥测，并返回自身承诺。'
          )
        },
        t(
          'Unchanged original result or error; observation failures report separately.',
          '保持原结果或错误，观察失败另行报告。'
        ),
        `import type { IStorageExecutionPort } from '@migaia/storage-host'\nasync function run(port: IStorageExecutionPort) {\n  return port.observe?.(() => ({ operation: 'read', input: null }), async () => 'ready')\n}\nconsole.log(typeof run)`
      ),
      run: method(
        t(
          'Invoke the exact original asynchronous terminal once through the installed pipeline.',
          '通过已安装流水线调用准确原异步终点一次。'
        ),
        {
          request: t(
            'Original typed execution request from the native endpoint.',
            '来自原生终点的原类型化执行请求。'
          ),
          invoke: t(
            'Actual terminal receiving the final prepared input and returning its Promise.',
            '接收最终准备输入并返回承诺的真实终点。'
          )
        },
        t(
          'Original terminal result; an intercepted operation that never invokes it rejects.',
          '返回原终点结果，未调用终点的拦截操作拒绝。'
        ),
        `import type { IStorageExecutionPort } from '@migaia/storage-host'\nasync function run(port: IStorageExecutionPort) {\n  return port.run({ operation: 'read', input: 'key' }, async (input) => input)\n}\nconsole.log(typeof run)`
      ),
      runSync: method(
        t(
          'Invoke the exact synchronous terminal; installed asynchronous stages reject before the terminal.',
          '调用准确同步终点，已经安装的异步阶段在终点之前拒绝。'
        ),
        {
          request: t('Original typed synchronous execution request.', '原类型化同步执行请求。'),
          invoke: t(
            'Actual synchronous terminal receiving the prepared input.',
            '接收准备输入的真实同步终点。'
          )
        },
        t(
          'Synchronous original result, or the existing ASYNC_STAGE_IN_SYNC_ENTRY error.',
          '返回原同步结果，或既有同步入口异步阶段错误。'
        ),
        `import type { IStorageExecutionPort } from '@migaia/storage-host'\nfunction run(port: IStorageExecutionPort) {\n  return port.runSync({ operation: 'read', input: 'key' }, (input) => input)\n}\nconsole.log(typeof run)`
      )
    }
  }
}

/** The original core reuses only the five captured author methods for lazy organization work. */
export const storageHostOrgAuthorMembers = orgAuthorMembers
