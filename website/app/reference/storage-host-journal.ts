import type { ICode, IMemberDoc, IText, ITypeDoc } from './contract.js'
import { storageHostCases } from './storage-host-cases.js'

/** Native author descriptions refer to the original transaction and never manufacture a handle. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Type examples accept ports from their native owner instead of constructing counterfeit scopes. */
const authorExample = (type: string, statement: string): string =>
  `import type { ${type} } from '@migaia/storage-host'\nimport type { ITransactionScope } from '@migaia/storage-contract'\nasync function usePort(port: ${type}, scope: Omit<ITransactionScope, 'use'>) {\n  ${statement}\n}\nconsole.log(typeof usePort)`
/** Every author method documents its real inputs and the original owner’s completion guarantee. */
const method = (
  summary: IText,
  params: Readonly<Record<string, IText>>,
  returns: IText,
  example: ICode
): IMemberDoc => ({ summary, params, returns, example })
/** All scope arguments are issued by the backend’s original transaction callback. */
const scopeParam = t(
  'Authentic scope issued by this backend’s original transaction callback.',
  '由本后端原事务回调发出的真实作用域，不能用结构相似对象替代。'
)
/** Full logical targets retain the backend’s canonical identity and private metadata partition. */
const targetParam = t(
  'Canonical target supplied by the original backend’s captured change.',
  '由原后端捕获变更提供的规范目标，包含其原通道与键身份。'
)
/** Stored images keep missing and present values distinct. */
const imageParam = t(
  'An image captured by the original durable image codec.',
  '由原持久镜像编解码器捕获的存在或缺失镜像。'
)
/** Sequence-free transaction identifiers come from the original terminal owner. */
const txParam = t(
  'Transaction id issued by the original journal attempt or a committed undo result.',
  '来自原日志尝试返回值或已提交撤销结果的事务编号。'
)
/** Terminal callbacks observe the real owner and cannot commit, veto or reopen a scope. */
const effectParam = t(
  'Synchronous report-only callback; the original native owner decides the actual terminal outcome.',
  '同步只报告回调，实际终态结局仍由原生拥有者决定。'
)

/** Public private-log and commit bridge shapes remain distinct from ordinary business stores. */
export const storageHostJournalTypes: Readonly<Record<string, ITypeDoc>> = {
  IStorageJournalOptions: {
    summary: t(
      'One captured fixed-org borrowed logger configuration; selected commit recording uses the original asynchronous bootstrap stage.',
      '一次捕获的固定组织借用日志配置，所选提交记录使用原异步启动阶段，不取得日志关闭权。'
    ),
    members: {
      logger: {
        summary: t(
          'Original Logger with actual selected durable/level plugins; storage borrows it and never shuts it down.',
          '具有真实所选持久及级别插件的原日志对象，存储只借用并始终不关闭它。'
        )
      },
      namespace: {
        summary: t(
          'Caller-selected nonempty stable recovery namespace, combined with exact backend and org identity.',
          '调用方选择的非空稳定恢复命名空间，与准确后端及组织身份共同确定目标。'
        )
      },
      binlogValues: {
        summary: t(
          'Optional true adds committed encoded values to binlog entries; omission omits those values. WAL always retains full images.',
          '可选真值在提交日志条目中加入已提交编码值，省略则不加入；预写日志始终保留完整镜像。'
        )
      },
      atomicBinlog: {
        summary: t(
          'Explicit backend-id map of exact storageLogStore objects from the same registration for native log/data composition.',
          '显式按后端编号映射同一登记的准确私有日志对象，供原生日志与业务组合。'
        )
      },
      indexedDbUndo: {
        summary: t(
          'Explicit true opts into the IndexedDB original undo combination; omission does not grant that capability.',
          '显式真值选择索引数据库原撤销组合，省略不会授予该能力。'
        )
      },
      atomicUndo: {
        summary: t(
          'Exact same-registration private undo carriers selected by backend id; unrelated matching ids cannot replace them.',
          '按后端编号选择准确同登记私有撤销载体，不相关的同名编号不能替代。'
        )
      },
      telemetry: {
        summary: t(
          'Optional true requires the actual level plugin and emits ordinary storage-category entries with original payload/Error references.',
          '可选真值要求真实级别插件，使用普通存储分类条目保留原负载及错误引用。'
        )
      },
      redoWal: {
        summary: t(
          'The exact shared latest-pending WAL object used by every text redo participant; same names or independent cached writers do not prove sharing.',
          '每个文本重做参与者使用的准确共享最新待处理日志对象，同名或独立缓存写入器不能证明共享。'
        )
      }
    }
  },
  IStorageJournalRedoBinding: {
    summary: t(
      'Original text owner authenticates scopes, protects recovery/apply and reports final notifications only after durable completion.',
      '原文本拥有者认证作用域、保护恢复与应用，只有持久完成之后才报告最终通知。'
    ),
    example: storageHostCases.IStorageJournalRedoBinding![0]!.example,
    members: {
      transactionInfo: method(
        t(
          'Authenticate the exact text scope and return its original transaction identity.',
          '认证准确文本作用域，并返回原事务身份。'
        ),
        { scope: scopeParam },
        t(
          'Original ITransactionInfo, without a native handle or commit right.',
          '返回原事务信息，不授予原生句柄或提交权限。'
        ),
        authorExample('IStorageJournalRedoBinding', 'console.log(port.transactionInfo(scope).id)')
      ),
      changes: method(
        t(
          'Read ordered full images captured by the original text draft.',
          '读取原文本草稿捕获的有序完整镜像，不按最终键值折叠中间步骤。'
        ),
        { scope: scopeParam },
        t(
          'Readonly original before/after steps for this scope.',
          '返回本作用域原有只读前后修改步骤。'
        ),
        authorExample('IStorageJournalRedoBinding', 'console.log(port.changes(scope))')
      ),
      protect: method(
        t(
          'Keep the original physical reservation around recovery and the complete text operation.',
          '在恢复与完整文本操作周围保持原物理保留，不建立另一份锁平台。'
        ),
        {
          run: t(
            'Original asynchronous work to run once under physical protection.',
            '在原物理保护内执行一次的原异步工作。'
          ),
          signal: t(
            'Original attempt cancellation signal; absence adds no timeout.',
            '原尝试取消信号，缺失不增加超时。'
          )
        },
        t('The work result after original protection release.', '原保护释放后返回工作结果。'),
        authorExample('IStorageJournalRedoBinding', 'await port.protect(async () => "ready")')
      ),
      apply: method(
        t(
          'Apply only the already-prepared original text draft under retained protection.',
          '在已持有保护下，只应用已经准备的原文本草稿。'
        ),
        { scope: scopeParam },
        t(
          'Synchronous native apply; actual WAL completion remains with the original journal owner.',
          '同步执行原生应用，实际预写日志完成仍归原日志拥有者。'
        ),
        authorExample('IStorageJournalRedoBinding', 'port.apply(scope)')
      ),
      replay: method(
        t(
          'Apply recoverable committed changes and return deferred original invalidation work when needed.',
          '应用可恢复已提交变更，并在需要时返回延迟的原失效通知工作。'
        ),
        {
          changes: t(
            'Validated matching-target ordered images from the original recovery protocol.',
            '原恢复协议提供的已验证同目标有序镜像。'
          )
        },
        t(
          'No result or a notification callback; invoke notifications only after durable completion succeeds.',
          '无返回值或通知回调，只有持久完成成功后才能调用通知。'
        ),
        authorExample(
          'IStorageJournalRedoBinding',
          'const notify = port.replay([])\n  console.log(typeof notify)'
        )
      ),
      seal: method(
        t(
          'Stop this original text target from accepting writes after an uncertain outcome.',
          '结果不确定后，停止原文本目标继续接纳写入。'
        ),
        {
          cause: t(
            'Exact primary recovery or apply failure retained by the original owner.',
            '原拥有者保留的准确主要恢复或应用失败。'
          )
        },
        t(
          'No result; the owner retains the original failure and resource lifecycle.',
          '无返回值，拥有者保留原始失败及资源生命周期。'
        ),
        authorExample('IStorageJournalRedoBinding', 'port.seal(new Error("native apply failed"))')
      )
    }
  },
  IStorageJournalImage: {
    summary: t(
      'A missing image or a present versioned wire string; null is encoded as a present value, never absence.',
      '镜像区分缺失与存在的版本化持久字符串；空值必须编码为存在值，不能代替缺失。'
    ),
    scenarios: [
      t(
        'Retain exact before/after values for native recovery and undo.',
        '为原生恢复与撤销保留准确的修改前后值。'
      )
    ],
    example: storageHostCases.encodeStorageJournalImage![0]!.example,
    members: {
      present: {
        summary: t(
          'Discriminates absence from a present encoded value.',
          '区分目标缺失与目标存在编码值的判别字段。'
        )
      },
      value: {
        summary: t(
          'Only the present branch carries its original versioned encoded string.',
          '只有存在分支携带原版本化编码字符串，不允许省略或替换为空值。'
        )
      }
    }
  },
  IStorageJournalTarget: {
    summary: t(
      'Original canonical lock target, or the backend’s private metadata identity; it grants no acquisition or raw I/O authority.',
      '原规范锁目标或后端私有元数据身份；它本身不授予取锁权限或原始读写能力。'
    ),
    members: {
      channel: {
        summary: t(
          'The actual text, bytes, record, vector, RDF or private metadata channel.',
          '实际文本、字节、记录、向量、资源描述或私有元数据通道。'
        )
      },
      key: {
        summary: t(
          'Logical key captured by the owning channel; metadata uses its original private string identity.',
          '所属通道捕获的逻辑键，元数据采用原私有字符串身份。'
        )
      }
    }
  },
  IStorageJournalChange: {
    summary: t(
      'One actual mutation step retains full before/after images and the final original revision; ordered steps are not collapsed by channel.',
      '一次真实修改步骤保留完整前后镜像与最终原修订，有序步骤不能按通道折叠为一项。'
    ),
    members: {
      target: { summary: targetParam },
      before: {
        summary: t(
          'Raw pre-mutation image, including absence and stored expiry wire.',
          '修改前的原始镜像，包含缺失状态及已保存的过期表示。'
        )
      },
      after: {
        summary: t(
          'Raw post-mutation image produced by this actual mutation step.',
          '本次真实修改步骤产生的原始修改后镜像。'
        )
      },
      afterRevision: {
        summary: t(
          'Complete native revision facts, including clear epoch and tombstones where applicable.',
          '完整原生修订事实，在适用时包含清空代际与墓碑修订。'
        )
      }
    }
  },
  IStorageJournalAttempt: {
    summary: t(
      'The journal attempt borrows the exact native transaction id and records its final images before commit.',
      '日志尝试借用准确原生事务编号，并在提交之前记录其最终镜像，不取得提交权限。'
    ),
    members: {
      txId: { summary: txParam },
      record: method(
        t(
          'Capture prepared changes from this exact authenticated native scope before its actual commit.',
          '在真实提交之前，从该准确且已认证的原生作用域捕获已准备变更。'
        ),
        { scope: scopeParam },
        t(
          'Completes original capture and selected durable preparation; the backend alone commits.',
          '完成原捕获及所选持久准备；实际提交仍只能由后端执行。'
        ),
        authorExample('IStorageJournalAttempt', 'await port.record(scope)')
      ),
      settle: method(
        t(
          'Drain selected commit-only external publication without changing a confirmed native outcome.',
          '排空所选仅提交后的外置发布，不改变已经确认的原生结局。'
        ),
        {},
        t(
          'Completes report-only append settlement; the original commit result remains intact.',
          '完成只报告的追加结算，保留原提交结果。'
        ),
        authorExample('IStorageJournalAttempt', 'await port.settle?.()')
      )
    }
  },
  IStorageJournalRedoAttempt: {
    summary: t(
      'Text-only attempt issued by the original redo owner; record authenticates an exact scope without adding record or bytes methods.',
      '原重做拥有者发出的纯文本尝试，记录时认证准确作用域，不伪造记录或字节方法。'
    ),
    example: storageHostCases.IStorageJournalRedoAttempt![0]!.example,
    members: {
      txId: { summary: txParam },
      record: method(
        t(
          'Record the prepared text draft while its original native protection remains held.',
          '在原生保护仍被持有时记录已经准备的文本草稿。'
        ),
        { scope: scopeParam },
        t(
          'Durable redo preparation and original apply/complete run through the selected shared WAL owner.',
          '持久重做准备及原应用和完成通过所选共享预写日志拥有者执行。'
        ),
        authorExample('IStorageJournalRedoAttempt', 'await port.record(scope)')
      )
    }
  },
  IStorageJournalNamespaceView: {
    summary: t(
      'Private string I/O inside one authentic native transaction, outside business keys, clears, TTL and notifications.',
      '一个真实原生事务内的私有字符串读写，不属于业务键、清空、过期或通知通道。'
    ),
    members: {
      get: method(
        t(
          'Read one private string without passing through a public business pipeline.',
          '读取一个私有字符串，不经过公开业务流水线。'
        ),
        { key: t('Private key chosen by the log protocol.', '日志协议选择的私有键。') },
        t('Stored text or null when absent.', '返回保存文本，不存在时返回空值。'),
        authorExample('IStorageJournalNamespaceView', "console.log(await port.get('head'))")
      ),
      getOrInsert: method(
        t(
          'Initialize and lock an absent native head row in the same transaction when this optional endpoint exists.',
          '存在此可选接点时，在同一事务内初始化并锁定缺失的原生头记录。'
        ),
        {
          key: t(
            'Private head key selected by the original log protocol.',
            '原日志协议选择的私有头键。'
          ),
          initial: t(
            'Canonical initial head wire supplied by that protocol.',
            '该协议提供的规范初始头表示。'
          )
        },
        t(
          'Existing or initialized text; the native lock remains owned by the surrounding transaction.',
          '返回已有或初始化的文本，原生锁仍由外层事务拥有。'
        ),
        authorExample(
          'IStorageJournalNamespaceView',
          "console.log(await port.getOrInsert?.('head', 'initial'))"
        )
      ),
      has: method(
        t(
          'Check private key presence in this original transaction.',
          '在本次原事务内检查私有键是否存在。'
        ),
        { key: t('Private protocol key to inspect.', '需要检查的私有协议键。') },
        t('True only when the private row exists.', '仅在该私有记录存在时返回真。'),
        authorExample('IStorageJournalNamespaceView', "console.log(await port.has('head'))")
      ),
      set: method(
        t(
          'Write a private string through the current original native transaction.',
          '通过当前原生事务写入私有字符串，不创建另一份提交边界。'
        ),
        {
          key: t('Private protocol row identity.', '私有协议记录身份。'),
          value: t('Canonical log wire string.', '规范日志持久字符串。')
        },
        t(
          'The write is staged; successful completion alone is not a commit certificate.',
          '表示写入已进入当前事务，仅请求成功本身不能证明提交。'
        ),
        authorExample('IStorageJournalNamespaceView', "await port.set('head', 'next')")
      ),
      remove: method(
        t(
          'Remove a private row through the same native transaction.',
          '通过同一个原生事务移除私有记录。'
        ),
        { key: t('Private protocol row to remove.', '需要移除的私有协议记录。') },
        t('Stages removal without touching business rows.', '准备移除该私有记录，不修改业务记录。'),
        authorExample('IStorageJournalNamespaceView', "await port.remove('old-row')")
      ),
      clearValues: method(
        t(
          'Clear only the current private namespace values.',
          '只清空当前私有命名空间中的字符串值。'
        ),
        {},
        t(
          'Private values are staged for removal; business clear semantics remain separate.',
          '私有值进入移除阶段，与业务清空语义保持分离。'
        ),
        authorExample('IStorageJournalNamespaceView', 'await port.clearValues()')
      ),
      clearAll: method(
        t(
          'Clear this private namespace through its native owner.',
          '由原生拥有者清空本私有命名空间，不扩大到业务目标。'
        ),
        {},
        t(
          'Stages complete private removal without acquiring backend close authority.',
          '准备完整私有移除，不取得后端关闭权限。'
        ),
        authorExample('IStorageJournalNamespaceView', 'await port.clearAll()')
      ),
      keys: method(
        t(
          'Enumerate actual private keys for recovery and cleanup.',
          '枚举真实私有键，供日志恢复与清理使用。'
        ),
        {},
        t(
          'Readonly private key snapshot from the current native view.',
          '返回当前原生视图提供的只读私有键快照。'
        ),
        authorExample('IStorageJournalNamespaceView', 'console.log(await port.keys())')
      )
    }
  },
  IStorageJournalNamespace: {
    summary: t(
      'Caller-closeable private native namespace retaining accepted work until the real terminal ends; disposal never closes the backend.',
      '调用方可释放的私有原生命名空间，保留已接纳工作直到真实终态结束；释放不关闭后端。'
    ),
    scenarios: [
      t(
        'Implement an ILogStore over the admitted backend’s private original transaction.',
        '在已准入后端的私有原事务上实现日志存储。'
      )
    ],
    example: authorExample(
      'IStorageJournalNamespace',
      "await port.run((view) => view.get('head'))"
    ),
    members: {
      nativeAtomic: {
        summary: t(
          'Strict native rollback/commit fact; false does not certify atomic log/data composition.',
          '严格的原生回滚与提交事实；假值不能证明日志与业务原子组合。'
        )
      },
      indexExclusive: {
        summary: t(
          'False selects current-index mode: recover/read inside every native operation, with no cross-operation cache. Omission retains the original exclusive cached path.',
          '假值选择现读索引模式：每次原生操作内恢复与读取，不跨操作缓存；省略保留原独占缓存路径。'
        )
      },
      assertLive: method(
        t(
          'Recheck the original generation and resource admission before cached facts are observed.',
          '在观察缓存事实之前重新检查原代际与资源准入。'
        ),
        {},
        t(
          'Returns only while the original namespace is live; stale or closed handles reject.',
          '仅在原命名空间仍有效时返回，过期代际或已关闭句柄拒绝。'
        ),
        authorExample('IStorageJournalNamespace', 'port.assertLive?.()')
      ),
      transactionInfo: method(
        t(
          'Authenticate a scope and return its original identity without retaining a new transaction.',
          '认证作用域并返回原事务身份，不保留或创建新事务。'
        ),
        { scope: scopeParam },
        t(
          'Original ITransactionInfo from this exact backend and organization.',
          '返回本准确后端与组织的原 `ITransactionInfo`。'
        ),
        authorExample('IStorageJournalNamespace', 'console.log(port.transactionInfo(scope).id)')
      ),
      run: method(
        t(
          'Execute private work in a fresh original transaction or borrow the supplied authenticated transaction.',
          '在新原事务中执行私有工作，或借用已提供并认证的原事务。'
        ),
        {
          work: t(
            'Receives the private view and returns a Promise; errors follow the original native terminal.',
            '接收私有视图并返回承诺；失败沿原生终态处理。'
          ),
          scope: scopeParam
        },
        t(
          'Work result after the original owner completes; borrowed scopes retain their caller’s terminal authority.',
          '原拥有者完成后返回工作结果，借用作用域仍由调用方拥有终态权限。'
        ),
        authorExample(
          'IStorageJournalNamespace',
          "await port.run((view) => view.get('head'), scope)"
        )
      ),
      runCommitted: method(
        t(
          'Run private work and publish committed metadata before the original head lease releases.',
          '执行私有工作，并在原头锁租约释放之前发布已提交元数据。'
        ),
        {
          work: t(
            'Asynchronous private work returning the value to publish.',
            '返回待发布值的异步私有工作。'
          ),
          committed: t(
            'Synchronous callback receives the successfully committed value inside the native terminal.',
            '同步回调在原生终态内接收已经成功提交的值。'
          )
        },
        t(
          'The work result; unavailable ports cannot claim native append composition.',
          '返回工作结果；缺少此接点时不能声称支持原生追加组合。'
        ),
        authorExample(
          'IStorageJournalNamespace',
          "await port.runCommitted?.((view) => view.get('head'), (value) => console.log(value))"
        )
      ),
      onCommit: method(
        t(
          'Observe only the authentic original transaction’s successful commit.',
          '仅观察真实原事务的成功提交，不提交或否决事务。'
        ),
        { scope: scopeParam, effect: effectParam },
        t(
          'Original unsubscribe callback; the namespace retains accepted terminal work until actual end.',
          '返回原取消订阅回调，命名空间保留已接纳终态工作直到实际结束。'
        ),
        authorExample(
          'IStorageJournalNamespace',
          'const off = port.onCommit(scope, () => console.log("committed"))\n  off()'
        )
      ),
      onRollback: method(
        t(
          'Observe the authentic original rollback without replacing its primary failure.',
          '观察真实原回滚，不替换其主要失败或重新打开事务。'
        ),
        { scope: scopeParam, effect: effectParam },
        t(
          'Original unsubscribe callback; unknown commit outcomes are not fabricated rollbacks.',
          '返回原取消订阅回调，未知提交结局不会被伪装为回滚。'
        ),
        authorExample(
          'IStorageJournalNamespace',
          'const off = port.onRollback(scope, () => console.log("rolled back"))\n  off()'
        )
      )
    }
  },
  IStorageJournalBackendBinding: {
    summary: t(
      'Installation-admitted fixed-org binding authenticating native scopes and raw images; all I/O and terminal decisions stay with that backend.',
      '安装准入的固定组织绑定，认证原生作用域与原始镜像；所有读写及终态决策仍归该后端。'
    ),
    members: {
      redo: {
        summary: t(
          'Optional original text-only redo owner; it never pretends to provide native atomic transactions.',
          '可选原纯文本重做拥有者，不伪装成原生原子事务提供者。'
        )
      },
      requiresIndexedDbUndo: {
        summary: t(
          'True only when the native owner requires explicit indexedDbUndo selection before enabling undo.',
          '仅在原生拥有者要求显式选择 `indexedDbUndo` 后才能启用撤销时为真。'
        )
      },
      externalWal: {
        summary: t(
          'Explicit true permits external intent I/O after final images; strict native owners omit it.',
          '显式真值允许最终镜像之后等待外置意图读写，严格原生拥有者省略此事实。'
        )
      },
      lockTarget: method(
        t(
          'Map a private target onto its existing canonical point lock without acquiring it.',
          '把私有目标映射到已有规范点锁身份，但不获取该锁。'
        ),
        { target: targetParam },
        t(
          'The backend’s original ILockKey for this exact target.',
          '返回后端为该准确目标发出的原 `ILockKey`。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "port.lockTarget?.({ channel: 'text', key: 'name' })"
        )
      ),
      forOrg: method(
        t(
          'Project the same registration onto one immutable canonical organization.',
          '把同一登记投影到一个不可变规范组织，不创建第二安装拥有者。'
        ),
        {
          orgId: t(
            'Canonical UUID from host.org or the original getOrgContext.',
            '来自 `host.org` 或原 `getOrgContext` 返回的规范组织编号。'
          )
        },
        t(
          'Fixed-org binding retaining the same native owner.',
          '返回保留同一原生拥有者的固定组织绑定。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "port.forOrg('00000000-0000-0000-0000-000000000000')"
        )
      ),
      openNamespace: method(
        t(
          'Open a private prefix through the original namespace resource owner.',
          '通过原命名空间资源拥有者打开一个私有前缀。'
        ),
        {
          prefix: t(
            'Nonempty caller-chosen private prefix for this backend and organization.',
            '调用方为本后端与组织选择的非空私有前缀。'
          )
        },
        t(
          'Caller-closeable namespace; nativeAtomic and indexExclusive describe its real guarantees.',
          '返回调用方可释放的命名空间，其原生原子及索引独占事实描述真实保证。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "await using namespace = await port.openNamespace('audit')"
        )
      ),
      changes: method(
        t(
          'Read the ordered original mutation steps already captured on this authenticated scope.',
          '读取该认证作用域已经捕获的原有序修改步骤，不重新扫描最终通道来猜测。'
        ),
        { scope: scopeParam },
        t(
          'Readonly changes retaining actual intermediate images and order.',
          '返回保留真实中间镜像与顺序的只读变更列表。'
        ),
        authorExample('IStorageJournalBackendBinding', 'console.log(port.changes?.(scope))')
      ),
      readImage: method(
        t(
          'Read raw stored state for comparison without applying lazy TTL or business decoding.',
          '读取用于比较的原始持久状态，不触发惰性过期或业务解码。'
        ),
        { scope: scopeParam, target: targetParam },
        t('Original present/absent wire image.', '返回原有的存在或缺失持久镜像。'),
        authorExample(
          'IStorageJournalBackendBinding',
          "await port.readImage?.(scope, { channel: 'text', key: 'name' })"
        )
      ),
      writeImage: method(
        t(
          'Restore a validated full image through the same original native draft.',
          '通过同一个原生草稿恢复已经验证的完整镜像。'
        ),
        { scope: scopeParam, target: targetParam, image: imageParam },
        t(
          'The image is staged in the original transaction; no independent commit occurs.',
          '镜像进入原事务草稿，不发生独立提交。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "await port.writeImage?.(scope, { channel: 'text', key: 'name' }, { present: false })"
        )
      ),
      readRevision: method(
        t(
          'Read full native revision facts needed for compare-before-restore.',
          '读取比较后恢复所需的完整原生修订事实。'
        ),
        { scope: scopeParam, target: targetParam },
        t(
          'Original portable revision including epochs and tombstones where the backend uses them.',
          '返回原可移植修订，在后端适用时包含代际与墓碑。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "await port.readRevision?.(scope, { channel: 'text', key: 'name' })"
        )
      ),
      writeCommitMarker: method(
        t(
          'Stage the exact commit marker in the same original business transaction.',
          '在同一个原业务事务内准备准确提交标记。'
        ),
        { scope: scopeParam, txId: txParam },
        t(
          'Marker is committed or rolled back with the business draft.',
          '标记与业务草稿一起提交或回滚。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "await port.writeCommitMarker?.(scope, 'issued-tx-id')"
        )
      ),
      hasCommitMarker: method(
        t(
          'Read actual durable commit evidence during recovery.',
          '在恢复阶段读取真实持久提交证据，不以本地状态猜测提交。'
        ),
        { txId: txParam },
        t(
          'Whether the exact marker exists in this fixed target.',
          '返回该准确标记是否存在于本固定目标中。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "await port.hasCommitMarker?.('issued-tx-id')"
        )
      ),
      removeCommitMarker: method(
        t(
          'Remove obsolete marker metadata after durable recovery completes.',
          '在持久恢复完成之后移除已失效的标记元数据。'
        ),
        { txId: txParam },
        t(
          'Completes original private metadata removal without a business notification.',
          '完成原私有元数据移除，不产生业务通知。'
        ),
        authorExample(
          'IStorageJournalBackendBinding',
          "await port.removeCommitMarker?.('issued-tx-id')"
        )
      )
    }
  },
  IStorageJournalExecutionPort: {
    summary: t(
      'Fixed-org once preparation and original attempt ports; native backend owners keep their budget, concurrency, draft and terminal.',
      '固定组织的一次准备与原尝试接点；原生后端保留自身预算、并发、草稿及终态。'
    ),
    members: {
      prepare: method(
        t(
          'Await the one organization configuration and recovery before original admission proceeds.',
          '在原准入继续之前，等待本组织唯一配置与恢复完成。'
        ),
        {},
        t(
          'Resolves the original shared preparation Promise; failed preparation stays failed.',
          '等待原共享准备承诺，准备失败不会偷偷重建配置。'
        ),
        authorExample('IStorageJournalExecutionPort', 'await port.prepare()')
      ),
      runRedo: method(
        t(
          'Hold the original text protection across recovery and the complete admitted endpoint.',
          '在恢复与完整已准入终点期间持有原文本物理保护。'
        ),
        {
          run: t(
            'The original complete operation returning its Promise.',
            '返回自身承诺的原完整操作。'
          ),
          signal: t(
            'Original attempt signal; omission adds no cancellation source.',
            '原尝试信号，省略不增加取消来源。'
          )
        },
        t('The original result after protected redo work.', '原有保护下重做工作完成后的操作结果。'),
        authorExample('IStorageJournalExecutionPort', 'await port.runRedo?.(async () => "ready")')
      ),
      beginRedo: method(
        t(
          'Authenticate an exact text-only scope with its original redo binding.',
          '通过原重做绑定认证准确纯文本作用域。'
        ),
        { scope: scopeParam },
        t(
          'Original redo attempt, or undefined when the selected configuration does not require recording.',
          '返回原重做尝试；所选配置不需要记录时为未定义值。'
        ),
        authorExample(
          'IStorageJournalExecutionPort',
          'const attempt = port.beginRedo?.(scope)\n  console.log(attempt?.txId)'
        )
      ),
      headLocks: method(
        t(
          'Read canonical selected log-head locks before the original first acquisition.',
          '在原第一次取锁之前读取所选规范日志头锁。'
        ),
        {},
        t(
          'Readonly original lock keys; no locks are acquired by reading them.',
          '返回只读原锁键，读取本身不获取任何锁。'
        ),
        authorExample('IStorageJournalExecutionPort', 'console.log(port.headLocks())')
      ),
      active: method(
        t(
          'Check whether this prepared organization selects commit recording rather than telemetry alone.',
          '检查本已准备组织是否选择提交记录，而非只有遥测观察。'
        ),
        {},
        t(
          'True for an active recording configuration; it does not prepare by itself.',
          '存在活跃记录配置时为真，本身不会执行准备。'
        ),
        authorExample('IStorageJournalExecutionPort', 'console.log(port.active())')
      ),
      begin: method(
        t(
          'Authenticate a native scope and borrow its original journal attempt.',
          '认证原生作用域并借用原有日志尝试。'
        ),
        { scope: scopeParam },
        t(
          'Attempt or undefined when no commit recording is active.',
          '返回日志尝试；没有活跃提交记录时返回未定义值。'
        ),
        authorExample('IStorageJournalExecutionPort', 'console.log(port.begin(scope)?.txId)')
      ),
      undo: method(
        t(
          'Compare all committed after-images and revisions before restoring through the original locked transaction.',
          '先比较所有已提交后镜像与修订，再通过原加锁事务恢复。'
        ),
        {
          txId: txParam,
          run: t(
            'Backend callback invoking its original transaction builder with every supplied canonical lock.',
            '后端回调使用全部所提供规范锁调用原事务构造器。'
          )
        },
        t(
          'A new committed txId; conflicts cause no restore writes.',
          '返回新已提交事务编号；冲突时不执行任何恢复写入。'
        ),
        `import type { IStorageJournalExecutionPort, IStorageJournalUndoRunner } from '@migaia/storage-host'\nfunction restore(port: IStorageJournalExecutionPort, run: IStorageJournalUndoRunner) {\n  return port.undo('issued-tx-id', run)\n}\nconsole.log(typeof restore)`
      )
    }
  },
  IStorageJournalInitializerContext: {
    summary: t(
      'One immutable organization’s initializer can open only admitted private log bindings, without raw backend or installation authority.',
      '一个不可变组织的初始化器只能打开已准入私有日志绑定，不获得原始后端或安装权限。'
    ),
    members: {
      orgId: {
        summary: t(
          'Canonical organization id issued by the original host preparation.',
          '由原宿主准备过程发出的规范组织编号。'
        )
      },
      storageLogStore: method(
        t(
          'Open an admitted backend’s private log for this exact initialized organization.',
          '为本次初始化的准确组织打开已准入后端私有日志。'
        ),
        {
          id: t(
            'Exact backend id installed in the original host batch.',
            '原宿主批次安装的准确后端编号。'
          ),
          options: t(
            'Nonempty private prefix; cached mode requires resource-lifetime exclusivity.',
            '非空私有前缀，缓存模式要求资源期独占。'
          )
        },
        t(
          'Caller-closeable ILogStore after recovery, using real namespace facts.',
          '恢复后返回调用方可释放的日志存储，沿真实命名空间保证执行。'
        ),
        storageHostCases.storageLogStore![0]!.example
      )
    }
  },
  IUndoableStore: {
    summary: t(
      'A genuine selected logger undo extension adds this business method without changing the original store identity.',
      '真实所选日志撤销扩展增加本业务方法，同时保持原存储对象身份不变。'
    ),
    members: {
      undo: method(
        t(
          'Restore one committed transaction only after all original value/revision comparisons succeed.',
          '只有全部原值与修订比较成功后，才恢复一次已提交事务。'
        ),
        {
          txId: txParam,
          ctx: t(
            'Optional caller operation context with the original cancellation budget.',
            '包含原取消预算的可选调用方操作上下文。'
          )
        },
        t(
          'The new restore transaction’s committed txId; UNDO_CONFLICT performs no writes.',
          '返回新恢复事务的已提交编号；撤销冲突不执行写入。'
        ),
        `import type { IUndoableStore } from '@migaia/storage-host'\nasync function restore(store: IUndoableStore, txId: string) {\n  return store.undo(txId)\n}\nconsole.log(typeof restore)`
      )
    }
  }
}
