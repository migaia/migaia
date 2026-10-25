import type { ITypeDoc } from './contract.js'

/** Keep author-port guidance in both locales without borrowing runtime implementation objects. */
const t = (en: string, zh: string) => ({ en, zh })

/** A native writer retains the original controller lease until its own commit settles. */
const controllerExample = `import type { IBackendChangeController } from '@migaia/storage-host/authoring/backend'
export async function commit(controller: IBackendChangeController, write: () => Promise<void>) {
  controller.assertLive()
  const release = controller.beginMutation()
  try {
    await write()
    return controller.publish({ channel: 'value', kind: 'put', keys: ['theme'] })
  } finally { release() }
}`

/** External events retain their actual transport identity instead of becoming local commits. */
const externalExample = `import type { IStorageChange } from '@migaia/storage-contract'
import type { IBackendChangeController } from '@migaia/storage-host/authoring/backend'
export function forward(controller: IBackendChangeController, change: IStorageChange) {
  const off = controller.subscribe(event => console.log(event.origin, event.kind))
  controller.publishExternal(change)
  return off
}`

/** Original native cleanup remains behind the installation-issued controller. */
const controllerOptionsExample = `import type { IStoragePluginCore } from '@migaia/storage-host'
export function install(core: IStoragePluginCore, client: object, close: () => Promise<void>) {
  return core.createChangeController({
    backend: 'catalog', platform: client, options: { namespace: 'catalog' },
    origin: 'catalog:local', finalize: close
  })
}`

/** Namespace construction accepts existing native ownership callbacks rather than another engine. */
const namespaceExample = `import {
  createBackendJournalNamespace, type IBackendJournalNamespaceOptions
} from '@migaia/storage-host/authoring/backend'
export async function open(options: IBackendJournalNamespaceOptions) {
  return createBackendJournalNamespace(options)
}`

/** A native attempt supplies the private view and terminal callbacks used by journal staging. */
const transactionExample = `import type { IBackendJournalTransaction } from '@migaia/storage-host/authoring/backend'
export async function stage(port: IBackendJournalTransaction) {
  port.onCommit(() => console.log('committed'))
  port.onRollback(() => console.log('rolled back'))
  port.onEnd(() => console.log('native work ended'))
  return port.run(async view => {
    await view.set('head', 'ready')
    return view.get('head')
  })
}`

/** An authentic concurrency context is supplied by the contract's original decision loop. */
const lockExample = `import type {
  IConcurrencyAttemptContext, IConcurrencyHolder, IConcurrencyPort
} from '@migaia/storage-contract'
import type { IBackendKeyLockPort } from '@migaia/storage-host/authoring/backend'
export function attempt<R>(port: IBackendKeyLockPort, ctx: IConcurrencyAttemptContext,
  holder: IConcurrencyHolder, native: IConcurrencyPort<R>) {
  return port.attempt(ctx, holder, native)
}`

/** Private metadata shares point conflict admission but stays outside business clear ranges. */
const metadataExample = `import type {
  IConcurrencyAttemptContext, IConcurrencyHolder, IConcurrencyPort
} from '@migaia/storage-contract'
import type { IBackendKeyLockPort } from '@migaia/storage-host/authoring/backend'
export function metadata<R>(port: IBackendKeyLockPort, ctx: IConcurrencyAttemptContext,
  holder: IConcurrencyHolder, native: IConcurrencyPort<R>) {
  return port.attemptMetadata(ctx, holder, native)
}`

/** Only the admitted synchronous write runs inside the final physical conflict check. */
const writeExample = `import type {
  IConcurrencyAttemptContext, IConcurrencyHolder
} from '@migaia/storage-contract'
import type { IBackendKeyLockPort } from '@migaia/storage-host/authoring/backend'
export function write<R>(port: IBackendKeyLockPort, ctx: IConcurrencyAttemptContext,
  holder: IConcurrencyHolder, mutate: () => R) {
  return port.attemptWrite(ctx, holder, mutate)
}`

/** Inspect only the original active lock table; reading it acquires no lock. */
const inspectExample = `import type { IBackendKeyLockPort } from '@migaia/storage-host/authoring/backend'
export function inspect(port: IBackendKeyLockPort, identities: readonly string[]) {
  console.log(port.probe(identities))
  return port.inspectLocks()
}`

/** The physical backend closes its shared lock provider after its last admitted native attempt. */
const disposeExample = `import type { IBackendKeyLockPort } from '@migaia/storage-host/authoring/backend'
export async function close(port: IBackendKeyLockPort) { await port.dispose() }`

/** Backend-captured wire identities remain opaque to the revision counter. */
const revisionExample = `import type { IBackendRevisionPort } from '@migaia/storage-host/authoring/backend'
export function changed(port: IBackendRevisionPort, encodedKey: string) {
  port.write('record', encodedKey)
  return { revision: port.read('record', encodedKey), epoch: port.epoch('record') }
}
export function cleared(port: IBackendRevisionPort) { port.clear('record') }`

/** Error construction varies by backend; unique ownership validation stays in the shared helper. */
const uniqueExample = `import { StorageError, StorageErrorCode } from '@migaia/storage-host'
import { collectUniqueIndexOwners,
  type IUniqueIndexErrorFactory } from '@migaia/storage-host/authoring/backend'
const errors: IUniqueIndexErrorFactory = {
  invalidConfig: backend => new StorageError(StorageErrorCode.invalidConfig, { backend }),
  uniqueConflict: (backend, key) =>
    new StorageError(StorageErrorCode.indexUniqueConflict, { backend, key })
}
export const owners = collectUniqueIndexOwners([
  { name: 'email', unique: true, multiEntry: false, revision: 1 }
], [{ key: 'user:1', projection: { email: { kind: 'single', key: 'a@example.test' } } }],
  'catalog', errors)`

/** Exact backend author types; installation, transactions and lifecycle stay with their owners. */
export const storageHostNativeAuthorTypes = {
  IBackendChangeController: {
    summary: t(
      'Installation-issued lifecycle and committed-change owner. It seals new mutations, drains accepted leases and finalizes the native resource once.',
      '安装窗口签发的生命周期与已提交变更拥有者，封闭新修改、排空已接受租约，并且仅一次终结原生资源。'
    ),
    scenarios: [
      t(
        'Publish native commit notifications while retaining the same resource drain boundary.',
        '发布原生提交通知，同时保留同一资源排空边界。'
      )
    ],
    example: controllerExample,
    members: {
      snapshot: {
        summary: t(
          'Frozen construction facts retaining the original platform and options references.',
          '冻结的构造事实，保留原平台对象与选项引用。'
        )
      },
      origin: {
        summary: t(
          'Backend-supplied transport identity or same-realm fallback used for local publications.',
          '本地发布使用的后端传输身份，未指定时为同运行域的回退身份。'
        )
      },
      closingSignal: {
        summary: t(
          'Original signal aborted when disposal seals admission, before accepted mutations finish draining.',
          '释放封闭准入时中止的原信号，此时已接受修改仍须排空。'
        )
      },
      assertLive: {
        summary: t(
          'Reject new work once logical closure starts or native disposal finishes.',
          '逻辑关闭启动或原生释放结束后，拒绝新工作。'
        ),
        params: {},
        returns: t(
          'Returns normally while open; otherwise throws STORE_DISPOSED.',
          '开放时正常返回，否则抛出 STORE_DISPOSED。'
        ),
        example: controllerExample
      },
      beginMutation: {
        summary: t(
          'Retain one original lifecycle lease before admitting native mutation work.',
          '准入原生修改之前，保留一份原生命周期租约。'
        ),
        params: {},
        returns: t(
          'An idempotent release callback; disposal waits until every accepted lease is released.',
          '返回幂等释放回调；全部已接受租约释放后，资源释放才能继续。'
        ),
        example: controllerExample
      },
      publish: {
        summary: t(
          'Publish a confirmed local native change with the next local sequence and this controller origin.',
          '为已确认的本地原生变更分配下一本地序号与控制器来源，再发布通知。'
        ),
        params: {
          change: t(
            'Backend-captured committed channel, kind and keys; sequence, origin and canonical record scope are controller-owned.',
            '后端捕获的已提交通道、种类与键；序号、来源和规范记录范围归控制器拥有。'
          )
        },
        returns: t(
          'The emitted event, or undefined after terminal disposal. More than 128 keys becomes coarse invalidation.',
          '返回已发布事件，终态释放后为未定义；超过 128 个键时改为粗粒度失效通知。'
        ),
        example: controllerExample
      },
      publishExternal: {
        summary: t(
          'Forward a native transport event without advancing this controller local sequence.',
          '转发原生传输事件，不推进本控制器的本地序号。'
        ),
        params: {
          change: t(
            'Actual remote event retaining its original sequence and origin; large key sets are coarsened.',
            '保留原序号与来源的实际远端事件；过大的键集合会粗粒度化。'
          )
        },
        returns: t(
          'Subscribers receive the event unless disposal is terminal; no new local commit is created.',
          '未终态释放时，订阅者接收事件；不创建新的本地提交。'
        ),
        example: externalExample
      },
      subscribe: {
        summary: t(
          'Observe local and forwarded changes through the existing queued event channel.',
          '通过既有排队事件通道观察本地及转发的变更。'
        ),
        params: {
          listener: t(
            'Observer receives the event; it cannot veto commits. Observer failures reach the original reporter.',
            '观察者接收事件，不能否决提交；观察失败交给原报告器。'
          )
        },
        returns: t(
          'Original unsubscribe callback removing only this subscription.',
          '返回仅移除此订阅的原取消回调。'
        ),
        example: externalExample
      },
      dispose: {
        summary: t(
          'Seal mutation admission, abort the closing signal, drain accepted leases and run native finalization.',
          '封闭修改准入、中止关闭信号，排空已接受租约后执行原生终结。'
        ),
        params: {},
        returns: t(
          'The same cached cleanup Promise; finalization failure keeps its original reachable cause.',
          '返回同一缓存清理结果；终结失败保留可追踪的原始原因。'
        ),
        example: `import type { IBackendChangeController } from '@migaia/storage-host/authoring/backend'
export async function close(controller: IBackendChangeController) { await controller.dispose() }`
      }
    }
  },
  IBackendChangeControllerOptions: {
    summary: t(
      'Construction facts captured once by the original controller during backend installation.',
      '原控制器在后端安装期间单次捕获的构造事实。'
    ),
    example: controllerOptionsExample,
    members: {
      backend: {
        summary: t(
          'Backend-owned diagnostic kind used by lifecycle errors and fallback origin generation.',
          '后端指定的诊断种类，用于生命周期错误与回退来源生成。'
        )
      },
      platform: {
        summary: t(
          'Borrowed native client retained by reference for backend inspection; no clone or automatic client disposal is added.',
          '按引用保留供后端检查的借用原生客户端，不复制，也不自动取得客户端关闭权。'
        ),
        default: t('undefined; no platform reference is retained.', '未定义，不保留平台引用。')
      },
      options: {
        summary: t(
          'Backend construction options retained by reference inside the frozen snapshot.',
          '在冻结快照内按引用保留的后端构造选项。'
        ),
        default: t('undefined; no configuration reference is retained.', '未定义，不保留配置引用。')
      },
      origin: {
        summary: t(
          'Native transport origin issued by the backend; cross-realm backends must supply their real identity.',
          '后端签发的原生传输来源，跨运行域后端须提供其真实身份。'
        ),
        default: t(
          'A backend name and same-realm monotonic suffix; unsuitable as a cross-realm origin.',
          '后端名称加同运行域递增后缀，不能作为跨运行域来源。'
        )
      },
      finalize: {
        summary: t(
          'Original zero-argument native cleanup, invoked after accepted mutations drain; returned work is awaited and failure remains reachable.',
          '原零参数原生清理，在已接受修改排空后调用；等待其返回工作，并保留可追踪失败。'
        ),
        default: t('undefined; no extra native finalizer runs.', '未定义，不运行额外原生终结器。'),
        example: controllerOptionsExample,
        whenToUse: t(
          'Bind the existing physical resource disposer to the controller drain boundary.',
          '将既有物理资源释放器接入控制器排空边界。'
        ),
        params: {},
        returns: {
          en: 'Optional original cleanup Promise is awaited; existing coded errors retain identity and raw failures keep their cause.',
          zh: '等待可选原清理结果；已有编码错误保持身份，原始失败保留其原因。'
        }
      }
    }
  },
  IBackendChangeSnapshot: {
    summary: t(
      'Frozen controller construction record; contained platform and options objects retain their original identities.',
      '冻结的控制器构造记录，其中平台对象与选项对象保持原始身份。'
    ),
    members: {
      backend: {
        summary: t(
          'Diagnostic backend kind captured from the original installation options.',
          '从原安装选项捕获的诊断后端种类。'
        )
      },
      platform: {
        summary: t(
          'Original borrowed platform object, or undefined; freezing this record does not deep-freeze the client.',
          '原借用平台对象，或未定义；冻结此记录不深度冻结客户端。'
        )
      },
      options: {
        summary: t(
          'Original construction options object, or undefined; no second normalized configuration is created.',
          '原构造选项对象，或未定义；不创建第二份规范配置。'
        )
      }
    }
  },
  IBackendJournalNamespaceOptions: {
    summary: t(
      'Original backend callbacks for reserving a private journal namespace, authenticating scopes and borrowing native transaction terminals.',
      '原后端用于保留私有日志命名空间、认证作用域及借用原生事务终态的回调。'
    ),
    example: namespaceExample,
    members: {
      assertLive: {
        summary: t(
          'Synchronous original backend admission check; a throw prevents namespace construction or subsequent private work.',
          '同步原后端准入检查；抛错会阻止命名空间构造或后续私有工作。'
        ),
        params: {},
        returns: {
          en: 'Normal return permits work; the original coded admission error is thrown synchronously.',
          zh: '正常返回表示允许工作；原编码准入错误同步抛出。'
        },
        example:
          "import type { IBackendJournalNamespaceOptions } from '@migaia/storage-host/authoring/backend'\nexport function assertOpen(options: IBackendJournalNamespaceOptions) { options.assertLive() }",
        whenToUse: {
          en: 'Keep namespace access within the native backend admission boundary.',
          zh: '将命名空间访问保持在原生后端准入边界内。'
        }
      },
      closingSignal: {
        summary: t(
          'Original backend closure signal initiating namespace release while accepted native work drains.',
          '启动命名空间释放的原后端关闭信号，同时等待已接受原生工作排空。'
        ),
        example:
          "import {\n  createBackendJournalNamespace, type IBackendJournalNamespaceOptions\n} from '@migaia/storage-host/authoring/backend'\nexport function shared(options: IBackendJournalNamespaceOptions) {\n  return createBackendJournalNamespace({\n    ...options, backend: options.backend, closingSignal: options.closingSignal,\n    nativeAtomic: options.nativeAtomic, indexExclusive: false\n  })\n}"
      },
      report: {
        summary: t(
          'Receives asynchronous cleanup failures from closure or symbolic disposal without replacing a primary result.',
          '接收关闭或符号释放的异步清理失败，不替换主结果。'
        ),
        params: {
          error: {
            en: 'Original asynchronous cleanup cause supplied by the namespace resource owner.',
            zh: '命名空间资源拥有者给出的原异步清理原因。'
          }
        },
        returns: {
          en: 'The original diagnostic observer receives the failure; no native retry or replacement commit is started.',
          zh: '原诊断观察者接收失败；不启动原生重试或替代提交。'
        },
        example:
          "import type { IBackendJournalNamespaceOptions } from '@migaia/storage-host/authoring/backend'\nexport function report(options: IBackendJournalNamespaceOptions, error: unknown) {\n  options.report(error)\n}",
        whenToUse: {
          en: 'Preserve cleanup diagnostics separately from an original primary transaction failure.',
          zh: '将清理诊断与原事务主失败分别保留。'
        }
      },
      backend: {
        summary: t(
          'Original backend diagnostic kind attached to namespace admission and disposal errors.',
          '命名空间准入及释放错误使用的原后端诊断种类。'
        ),
        default: t(
          'undefined; errors omit a backend-specific diagnostic value.',
          '未定义，错误不携带后端专属诊断值。'
        ),
        example:
          "import {\n  createBackendJournalNamespace, type IBackendJournalNamespaceOptions\n} from '@migaia/storage-host/authoring/backend'\nexport function shared(options: IBackendJournalNamespaceOptions) {\n  return createBackendJournalNamespace({\n    ...options, backend: options.backend, closingSignal: options.closingSignal,\n    nativeAtomic: options.nativeAtomic, indexExclusive: false\n  })\n}"
      },
      nativeAtomic: {
        summary: t(
          'Backend fact about all-or-nothing native transaction semantics; resource reservation alone cannot grant atomic rollback.',
          '后端关于原生事务全成或全败语义的事实；资源保留本身不能授予原子回滚。'
        ),
        values: {
          true: {
            en: 'The original native transaction supplies all-or-nothing mutation and rollback.',
            zh: '原生原事务提供修改全成或全败与回滚。'
          },
          false: {
            en: 'The native owner does not guarantee all-or-nothing rollback; WAL, undo and atomic-store combinations stay unsupported.',
            zh: '原生拥有者不保证全成或全败回滚；预写日志、撤销与原子存储组合仍不支持。'
          }
        },
        example:
          "import {\n  createBackendJournalNamespace, type IBackendJournalNamespaceOptions\n} from '@migaia/storage-host/authoring/backend'\nexport function shared(options: IBackendJournalNamespaceOptions) {\n  return createBackendJournalNamespace({\n    ...options, backend: options.backend, closingSignal: options.closingSignal,\n    nativeAtomic: options.nativeAtomic, indexExclusive: false\n  })\n}",
        whenToUse: {
          en: 'Declare the existing native guarantee accurately before selecting atomic journal combinations.',
          zh: '选择原子日志组合之前，准确声明既有原生保证。'
        }
      },
      indexExclusive: {
        summary: t(
          'Explicit false means logger indexes must reload from the native transaction each operation; it does not weaken or strengthen nativeAtomic.',
          '显式假值表示日志索引须在每次操作中从原生事务重载；不改变原子性事实。'
        ),
        default: t(
          'Omitted retains the exclusive namespace index contract of the original backend.',
          '省略时保留原后端独占命名空间索引契约。'
        ),
        values: {
          false: {
            en: 'Restore the current logger index inside each original native transaction; never retain it across operations.',
            zh: '每次在原生原事务内恢复当前日志索引，不跨操作保留。'
          }
        },
        example:
          "import {\n  createBackendJournalNamespace, type IBackendJournalNamespaceOptions\n} from '@migaia/storage-host/authoring/backend'\nexport function shared(options: IBackendJournalNamespaceOptions) {\n  return createBackendJournalNamespace({\n    ...options, backend: options.backend, closingSignal: options.closingSignal,\n    nativeAtomic: options.nativeAtomic, indexExclusive: false\n  })\n}",
        whenToUse: {
          en: 'Use false when independent handles share the physical namespace and no lifetime-exclusive index can be retained.',
          zh: '独立句柄共享物理命名空间、不能保留生命周期独占索引时使用假值。'
        }
      },
      reserve: {
        summary: t(
          'Original physical owner invokes hold after reservation is acquired and awaits it until release; acquisition rejection rejects namespace creation.',
          '原物理拥有者取得保留后调用保持回调，并等待至释放；取得失败会拒绝命名空间创建。'
        ),
        params: {
          hold: {
            en: 'Async callback invoked once the original reservation is acquired; its settlement releases that reservation.',
            zh: '原保留取得后调用的异步回调；回调结算会释放该保留。'
          }
        },
        returns: {
          en: 'Original reservation Promise, rejecting on native acquisition or retained-work failure.',
          zh: '返回原保留结果，原生取得或保留工作失败时拒绝。'
        },
        example:
          "import type { IBackendJournalNamespaceOptions } from '@migaia/storage-host/authoring/backend'\nexport function reserve(options: IBackendJournalNamespaceOptions, released: Promise<void>) {\n  return options.reserve(() => released)\n}",
        whenToUse: {
          en: 'Connect the private namespace lifetime to the existing physical owner reservation.',
          zh: '将私有命名空间生命周期接到既有物理拥有者的保留。'
        }
      },
      authenticate: {
        summary: t(
          'Synchronously validate the exact live original scope and return its existing transaction identity and private journal port; foreign scopes reject.',
          '同步验证精确存活的原作用域，返回既有事务身份与私有日志端口；异源作用域拒绝。'
        ),
        params: {
          scope: {
            en: 'Exact backend-issued original live transaction scope, without capability lookup authority.',
            zh: '后端签发的精确原存活事务作用域，不带能力查找权限。'
          }
        },
        returns: {
          en: 'The original transaction info and journal port; foreign or expired scopes throw before private I/O.',
          zh: '返回原事务信息与日志端口；异源或过期作用域在私有访问前抛错。'
        },
        example:
          "import type { ITransactionScope } from '@migaia/storage-contract'\nimport type { IBackendJournalNamespaceOptions } from '@migaia/storage-host/authoring/backend'\nexport function current(options: IBackendJournalNamespaceOptions,\n  scope: Omit<ITransactionScope, 'use'>) { return options.authenticate(scope).info }",
        whenToUse: {
          en: 'Borrow journal work from an already admitted authentic native transaction.',
          zh: '从已准入的真实原生事务借用日志工作。'
        }
      },
      transaction: {
        summary: t(
          'Run the callback on the original newly admitted native transaction port and settle only after the native owner settles; never create a second commit owner.',
          '在原新准入原生事务端口上运行回调，原生拥有者结算后才结算；不创建第二提交拥有者。'
        ),
        params: {
          work: {
            en: 'Async callback receiving the original native journal transaction port; callback rejection stays with its native owner.',
            zh: '接收原生原日志事务端口的异步回调；回调拒绝仍由原生拥有者处理。'
          }
        },
        returns: {
          en: 'Callback value only after original native transaction settlement; unknown outcomes remain failures.',
          zh: '仅在原生原事务结算后返回回调值；未知结果仍作为失败保留。'
        },
        example:
          "import type { IBackendJournalNamespaceOptions } from '@migaia/storage-host/authoring/backend'\nexport function head(options: IBackendJournalNamespaceOptions) {\n  return options.transaction(port => port.run(view => view.get('head')))\n}",
        whenToUse: {
          en: 'Start one original native transaction when no caller transaction scope is supplied.',
          zh: '未提供调用方事务作用域时，启动一次原生原事务。'
        }
      }
    }
  },
  IBackendJournalTransaction: {
    summary: t(
      'Transaction-bound private journal I/O and terminal observers; no direct native commit, rollback or connection authority is exposed.',
      '绑定事务的私有日志访问与终态观察者，不公开直接原生提交、回滚或连接控制权。'
    ),
    example: transactionExample,
    members: {
      run: {
        summary: t(
          'Execute private journal work through the same native draft and admitted operation lifetime.',
          '沿同一原生草稿及已准入操作生命周期执行私有日志工作。'
        ),
        params: {
          work: t(
            'Async callback borrowing the native private namespace view; rejection follows the original transaction failure owner.',
            '借用原生私有命名空间视图的异步回调；拒绝沿原事务失败拥有者处理。'
          )
        },
        returns: t(
          'Original private-work Promise and callback value; the port itself grants no commit authority.',
          '返回原私有工作结果及回调值；端口本身不授予提交权。'
        ),
        example: transactionExample
      },
      onCommit: {
        summary: t(
          'Register a synchronous effect for a confirmed successful native commit only.',
          '仅为已确认成功的原生提交登记同步作用。'
        ),
        params: {
          effect: t(
            'Zero-argument observer; it observes the original terminal and cannot drive another commit.',
            '零参数观察者，仅观察原终态，不能驱动另一提交。'
          )
        },
        returns: t(
          'Callback unregistering this observer before the native terminal invokes it.',
          '返回在原生终态调用之前注销此观察者的回调。'
        ),
        example: transactionExample
      },
      onRollback: {
        summary: t(
          'Register a synchronous observer on the native owner original rollback notification.',
          '为原生拥有者的原回滚通知登记同步观察者。'
        ),
        params: {
          effect: t(
            'Zero-argument rollback observer; it does not perform native rollback itself.',
            '零参数回滚观察者，自身不执行原生回滚。'
          )
        },
        returns: t(
          'Callback removing only this rollback observation.',
          '返回仅移除此回滚观察的回调。'
        ),
        example: transactionExample
      },
      onEnd: {
        summary: t(
          'Observe completion of the actual native resource, including outcomes whose commit result remains unknown.',
          '观察实际原生资源完成，包括提交结果仍未知的情况。'
        ),
        params: {
          effect: t(
            'Zero-argument terminal observer used to release existing retained resources.',
            '用于释放既有保留资源的零参数终态观察者。'
          )
        },
        returns: t(
          'Callback removing this completion observation; it cannot change the native outcome.',
          '返回移除此完成观察的回调，不能改变原生结果。'
        ),
        example: transactionExample
      }
    }
  },
  IBackendKeyLockPort: {
    summary: t(
      'Installation-issued physical key-lock owner shared by one backend data universe; authentic contract attempts retain the original retry and timeout owners.',
      '同一后端数据域共享的安装窗口物理键锁拥有者；真实契约尝试保留原重试与超时拥有者。'
    ),
    scenarios: [
      t(
        'Admit native writes against already captured canonical lock identities and actual held rows.',
        '按已捕获的规范锁身份与实际持有行准入原生写入。'
      )
    ],
    example: lockExample,
    members: {
      attemptMetadata: {
        summary: t(
          'Admit private metadata point work without exposing its held rows to business clear ranges.',
          '准入私有元数据点操作，不将其持有行暴露给业务清空范围。'
        ),
        params: {
          ctx: t(
            'Authentic live attempt emitted by runWithConcurrency, carrying canonical point identities.',
            '原并发循环签发的真实存活尝试，携带规范点身份。'
          ),
          holder: t(
            'Backend-issued holder diagnostics for this exact native attempt.',
            '后端为此精确原生尝试签发的持有者诊断信息。'
          ),
          native: t(
            'Original native attempt port; its result returns to the existing decision loop.',
            '原生尝试端口，其结果交还既有决策循环。'
          ),
          stages: t(
            'Optional original lock observation callbacks; failures are reported without controlling admission.',
            '可选原锁观察回调；失败会报告，不能控制准入。'
          ),
          admissionSignal: t(
            'Optional member closure signal cancelling queued admission without detaching accepted native work.',
            '可选成员关闭信号，取消排队准入，但不脱离已接受原生工作。'
          )
        },
        returns: t(
          'Original native attempt result or lock conflict after held metadata is released and accepted native work drains.',
          '元数据持有释放且已接受原生工作排空后，返回原生尝试结果或锁冲突。'
        ),
        example: metadataExample
      },
      attempt: {
        summary: t(
          'Admit one native attempt using the original point table and optional business range conflict checks.',
          '使用原点锁表及可选业务范围冲突检查，准入一次原生尝试。'
        ),
        params: {
          ctx: t(
            'Authentic original attempt with already normalized lock identities and one inherited budget.',
            '已规范锁身份且继承单一预算的真实原尝试。'
          ),
          holder: t(
            'Native backend holder metadata describing this attempt, not a global transaction counter.',
            '描述本尝试的原生后端持有信息，不是全局事务计数。'
          ),
          native: t(
            'Original native attempt port invoked after acquisition; no retry executor is created here.',
            '取得之后调用的原生尝试端口，此处不创建重试执行器。'
          ),
          stages: t(
            'Original optional lock stage observer, with failures routed to its reporter.',
            '可选原锁阶段观察者，失败交给其报告器。'
          ),
          admissionSignal: t(
            'Optional closure signal affecting pending acquisition; accepted native work remains awaited.',
            '影响待取得工作的可选关闭信号；仍等待已接受原生工作。'
          ),
          ranges: t(
            'Backend-captured canonical half-open channel ranges; only active held rows are examined.',
            '后端捕获的规范通道半开范围，仅检查活跃持有行。'
          ),
          additionalIdentities: t(
            'Optional callback returning current backend-captured implicit point identities at each conflict check.',
            '可选回调，在每次冲突检查时返回当前后端捕获的隐式点身份。'
          )
        },
        returns: t(
          'Original committed/conflict attempt result after the native port and held lease finish.',
          '原生端口及持有租约完成后，返回原提交或冲突尝试结果。'
        ),
        example: lockExample
      },
      probe: {
        summary: t(
          'Inspect the first actual conflicting holder without acquiring or waiting for locks.',
          '检查首个实际冲突持有者，不取得锁，也不等待。'
        ),
        params: {
          identities: t(
            'Canonical identities already produced by the backend lock-key owner, in desired conflict order.',
            '后端锁键拥有者已生成的规范身份，顺序即所需冲突优先顺序。'
          ),
          ranges: t(
            'Optional canonical half-open ranges scanning only the existing active table.',
            '可选规范半开范围，仅扫描既有活跃锁表。'
          ),
          current: t(
            'Optional authentic original attempt exempting only its own held rows; key lists alone grant no exemption.',
            '可选真实原尝试，仅豁免其自身持有行；键列表本身不授予豁免。'
          )
        },
        returns: t(
          'Detached first holding, or undefined when no conflict exists.',
          '返回已脱离的首个持有记录；不存在冲突时为未定义。'
        ),
        example: inspectExample
      },
      attemptWrite: {
        summary: t(
          'Run the final conflict check and synchronous native mutation in one uninterrupted commit turn.',
          '在单个不可分隔的提交轮次内执行最终冲突检查与同步原生修改。'
        ),
        params: {
          ctx: t(
            'Authentic original attempt with its captured canonical point identities.',
            '携带已捕获规范点身份的真实原尝试。'
          ),
          holder: t(
            'Backend-issued diagnostics retained while this attempt owns physical rows.',
            '本尝试拥有物理行期间保留的后端诊断信息。'
          ),
          write: t(
            'Synchronous native mutation returning its committed value; no await may split final admission and mutation.',
            '返回提交值的同步原生修改；最终准入与修改之间不能插入异步等待。'
          ),
          stages: t(
            'Optional original lock observation callbacks and reporter.',
            '可选原锁观察回调与报告器。'
          ),
          admissionSignal: t(
            'Optional backend-member closure signal checked again before the synchronous write.',
            '同步写入之前再次检查的可选后端成员关闭信号。'
          ),
          ranges: t(
            'Original canonical business ranges checked against currently held rows.',
            '用于检查当前持有行的原规范业务范围。'
          ),
          admit: t(
            'Optional existing physical gate receiving a once-only commit callback; it must return that original attempt result.',
            '可选既有物理准入门接收仅能调用一次的提交回调，并返回该原尝试结果。'
          ),
          additionalIdentities: t(
            'Optional original implicit point identity supplier, re-read for the final conflict check.',
            '可选原隐式点身份提供函数，在最终冲突检查时重新读取。'
          )
        },
        returns: t(
          'Committed callback value or an acquire conflict; every acquired row is released before settlement.',
          '返回已提交回调值或取得冲突；结算前释放全部已取得行。'
        ),
        example: writeExample
      },
      inspectLocks: {
        summary: t(
          'Snapshot current local held rows without adding a native probe, retry or expiry timer.',
          '快照当前本地持有行，不添加原生探测、重试或过期计时器。'
        ),
        params: {},
        returns: t(
          'Readonly detached holdings from this original physical provider only.',
          '返回仅来自此原物理提供者的只读脱离持有记录。'
        ),
        example: inspectExample
      },
      dispose: {
        summary: t(
          'Seal the original acquisition FIFO, reject queued work and drain accepted native attempts.',
          '封闭原取得队列、拒绝排队工作，并排空已接受原生尝试。'
        ),
        params: {},
        returns: t(
          'Cached main cleanup Promise after the original FIFO and retained attempts finish.',
          '原队列及保留尝试完成后的缓存主清理结果。'
        ),
        example: disposeExample
      },
      '[Symbol.asyncDispose]': {
        summary: t(
          'Use the original symbol disposal entry, reporting a cleanup rejection from the same main release.',
          '使用原符号释放入口，报告同一主释放过程的清理拒绝。'
        ),
        params: {},
        returns: t(
          'Separately cached symbolic Promise resolving after cleanup or reported failure.',
          '返回单独缓存的符号结果，在清理或失败报告后完成。'
        ),
        example: disposeExample
      }
    }
  },
  IBackendRevisionPort: {
    summary: t(
      'Installation-issued in-memory revisions and clear epochs for one physical data universe; no disposer, global registry or persistent counter is added.',
      '为单一物理数据域在安装窗口签发的内存修订与清空代数，不增加释放器、全局登记表或持久计数器。'
    ),
    example: revisionExample,
    members: {
      read: {
        summary: t(
          'Read one captured identity revision without allocating an untouched channel.',
          '读取单个已捕获身份的修订，不为未触碰通道分配状态。'
        ),
        params: {
          channel: t(
            'Original text, bytes, record, vector or RDF lock channel.',
            '原文本、字节、记录、向量或三元组锁通道。'
          ),
          encodedKey: t(
            'Stable encoded identity from the original backend key owner.',
            '来自原后端键拥有者的稳定编码身份。'
          )
        },
        returns: t(
          'Current revision, initially zero for an untouched identity.',
          '返回当前修订，未触碰身份初始为零。'
        ),
        example: revisionExample
      },
      write: {
        summary: t(
          'Advance the captured identity once after an actual successful native mutation.',
          '实际原生修改成功后，将已捕获身份的修订推进一次。'
        ),
        params: {
          channel: t(
            'Original logical channel whose identity actually changed.',
            '身份实际发生变更的原逻辑通道。'
          ),
          encodedKey: t(
            'Same encoded key from the backend identity capture used by reads and conflict validation.',
            '来自后端身份捕获、供读取及冲突验证使用的同一编码键。'
          )
        },
        returns: t(
          'The identity revision increments; this does not perform the business write.',
          '身份修订递增；此调用不执行实际业务写入。'
        ),
        example: revisionExample
      },
      epoch: {
        summary: t(
          'Read the clear generation for an entire original logical channel.',
          '读取整个原逻辑通道的清空代数。'
        ),
        params: {
          channel: t(
            'Backend channel whose prior full-clear generation is needed.',
            '需要查询此前完整清空代数的后端通道。'
          )
        },
        returns: t(
          'Current generation, initially zero; individual writes do not advance it.',
          '返回当前代数，初始为零；单点写入不推进它。'
        ),
        example: revisionExample
      },
      clear: {
        summary: t(
          'Discard channel tombstones and advance its generation after a real native channel clear.',
          '实际原生通道清空后，丢弃该通道墓碑并推进代数。'
        ),
        params: {
          channel: t(
            'Exact original channel cleared by the physical backend owner.',
            '物理后端拥有者已清空的精确原通道。'
          )
        },
        returns: t(
          'Old point revisions disappear and the channel generation increments once.',
          '旧点修订移除，通道代数递增一次。'
        ),
        example: revisionExample
      }
    }
  },
  IUniqueIndexErrorFactory: {
    summary: t(
      'Backend-specific coded error constructors used by the shared unique-owner collector; they customize errors without duplicating uniqueness validation.',
      '共享唯一拥有者收集器使用的后端专属编码错误构造函数，仅定制错误，不复制唯一性验证。'
    ),
    example: uniqueExample,
    members: {
      invalidConfig: {
        summary: t(
          'Construct the backend error for a projection naming an undeclared index.',
          '为投影引用未声明索引的情况构造后端错误。'
        ),
        params: {
          backend: t(
            'Diagnostic backend kind supplied to collectUniqueIndexOwners by its original caller.',
            '原调用方传给唯一拥有者收集器的诊断后端种类。'
          )
        },
        returns: t(
          'A registered coded Error that the collector throws before commit writes.',
          '返回收集器在提交写入之前抛出的已登记编码错误。'
        ),
        example: uniqueExample
      },
      uniqueConflict: {
        summary: t(
          'Construct the backend error when two different records claim one unique index value.',
          '两个不同记录争用同一唯一索引值时，构造后端错误。'
        ),
        params: {
          backend: t(
            'Original collector caller backend kind for this native commit.',
            '此原生提交的原收集器调用方后端种类。'
          ),
          key: t(
            'Logical record key of the later conflicting record, captured by the original backend.',
            '原后端捕获的后出现冲突记录逻辑键。'
          ),
          indexName: t(
            'Declared index name whose projected value already belongs to another record.',
            '投影值已被另一记录拥有的已声明索引名称。'
          )
        },
        returns: t(
          'The backend coded conflict Error; the shared collector keeps all-or-nothing validation before writes.',
          '返回后端编码冲突错误；共享收集器仍在写入之前执行完整验证。'
        ),
        example: uniqueExample
      }
    }
  }
} satisfies Readonly<Record<string, ITypeDoc>>
