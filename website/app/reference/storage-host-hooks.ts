import type { IMemberDoc, IText, ITypeDoc } from './contract.js'

/** Hook payloads carry observations only; none of these fields grants native authority. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Event descriptions explain the actual original boundary instead of copying its name. */
const field = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Original host registration identity contains no store, scope or raw client. */
const identity = {
  backendId: field(
    'Literal backend id issued by the exact original host registration.',
    '由准确原宿主登记发出的字面量后端编号。'
  ),
  backend: field(
    'Original admitted backend kind label, without native client details.',
    '原准入后端种类名称，不包含原生客户端详情。'
  ),
  orgId: field(
    'Canonical organization id from the immutable original call context.',
    '来自不可变原调用上下文的规范组织编号。'
  ),
  transactionId: field(
    'Optional id issued by the original native transaction owner.',
    '可选事务编号，由原生事务拥有者签发。'
  )
}
/** Common original operation facts never include application keys, values or authentication data. */
const operation = {
  operation: field(
    'Canonical operation name supplied by the original owning endpoint.',
    '由原所属终点提供的规范操作名称。'
  )
}

/** One source map is reused by constructor hooks and later host.hooks.on registrations. */
const hookMap: Readonly<Record<string, IMemberDoc>> = {
  onEvict: field(
    'Committed native eviction count for one channel; emitted after actual commit.',
    '一个通道的已提交原生驱逐数量，只在实际提交之后发出。'
  ),
  beforeHostInstall: field(
    'Original initial or later install batch is about to run.',
    '原初始或后续安装批次即将开始，只观察本批插件数量。'
  ),
  afterHostInstall: field(
    'The original plugin tuple committed and became published.',
    '原插件元组已经提交并发布，观察不能重新发布。'
  ),
  onHostInstallError: field(
    'The original install batch failed; payload contains its semantic failure code.',
    '原安装批次失败，载荷包含其语义错误码，不包含原生句柄。'
  ),
  beforeBackendPluginInstall: field(
    'Observe exact backend identity before its original plugin installation.',
    '原插件安装之前观察准确后端身份，不提前获得后端资源。'
  ),
  afterBackendPluginInstall: field(
    'Original backend plugin preparation completed successfully.',
    '原后端插件准备已经成功完成，身份仍来自同一登记。'
  ),
  onBackendPluginInstallError: field(
    'Original backend plugin installation failed with a normalized code.',
    '原后端插件安装失败，观察规范化语义码而不替换主要错误。'
  ),
  beforeHostClose: field(
    'Original close begins with the current registered backend count.',
    '原关闭开始时观察当前已登记后端数量，不授予清理否决权。'
  ),
  afterHostClose: field(
    'Original host cleanup finished; the lifecycle remains terminal.',
    '原宿主清理已经完成，生命周期保持终态，不能恢复准入。'
  ),
  onHostCloseError: field(
    'Original host cleanup collected failures; observer only reports its code.',
    '原宿主清理收集到失败，观察只报告其语义码。'
  ),
  beforeEnvelopeCheck: field(
    'Known target version before the original archive validation.',
    '原存档校验之前观察已知目标版本，不读取尚未验证存档。'
  ),
  afterEnvelopeCheck: field(
    'Archive validation succeeded and the stored version is now known.',
    '存档校验成功之后，才观察已确认的持久版本。'
  ),
  onVersionRejected: field(
    'The original archive version check rejected the supplied data.',
    '原存档版本检查拒绝所提供数据，观察不修改存档或迁移计划。'
  ),
  beforeMigrationStep: field(
    'Original ordered migration step is about to receive its input.',
    '原有序迁移步骤即将接收输入，只观察前后版本。'
  ),
  afterMigrationStep: field(
    'Original migration step completed successfully.',
    '原迁移步骤已经成功完成，不重新执行用户迁移回调。'
  ),
  afterMigrate: field(
    'Original migration plan or reset completed with its actual elapsed time.',
    '原迁移计划或重置完成，报告真实步骤数量与耗时。'
  ),
  beforeEncode: field(
    'Original codec is about to encode the proposed value.',
    '原编解码器即将编码候选值，载荷不包含业务值。'
  ),
  afterEncode: field(
    'Original codec encoding completed successfully.',
    '原编码已经成功完成，观察不取得编码结果或原生句柄。'
  ),
  onEncodeError: field(
    'Original codec encoding failed with its normalized semantic code.',
    '原编码失败，观察规范语义码并保留原错误处理。'
  ),
  beforeDecode: field(
    'Original codec is about to decode persisted input.',
    '原编解码器即将解码持久输入，观察不包含原始数据。'
  ),
  afterDecode: field(
    'Original codec decoding completed successfully.',
    '原解码成功完成，观察不重跑解码或修改结果。'
  ),
  onDecodeError: field(
    'Original codec decoding failed with its normalized code.',
    '原解码失败，只报告规范化错误码，不替换原始失败。'
  ),
  beforeQuery: field(
    'Original query plan has been prepared before its native cursor opens.',
    '原查询计划已准备，在打开原生游标之前观察计划。'
  ),
  afterQuery: field(
    'Original query completed with actual result and execution counts.',
    '原查询完成之后观察真实结果与执行数量，不重新读取来源。'
  ),
  onQueryError: field(
    'Original query failed; observation reports its semantic code.',
    '原查询失败，观察只报告其语义码，原资源清理继续。'
  ),
  beforeTransaction: field(
    'Before the original native transaction is created.',
    '原生事务创建之前的观察，不创建独立事务或生命周期。'
  ),
  onTransactionStart: field(
    'Original native transaction has been registered with its authentic id.',
    '原生事务已用真实编号登记，观察只能读取既有身份。'
  ),
  beforeTxOperation: field(
    'Before one already-admitted authentic transaction operation.',
    '真实事务中一次已经准入的操作即将执行，观察不扩大作用域。'
  ),
  afterTxOperation: field(
    'After one original transaction operation settles.',
    '一次原事务操作已结算，观察不证明外层事务已提交。'
  ),
  beforeCommit: field(
    'Original final-check boundary immediately before native commit.',
    '原生提交之前的原最终检查边界，观察不能提交或否决。'
  ),
  afterCommit: field(
    'Original native owner confirmed commit and actual changed-key count.',
    '原生拥有者确认提交后观察真实变更键数量，不伪造确认。'
  ),
  afterRollback: field(
    'Original native rollback completed with its primary failure retained.',
    '原生回滚完成，主要失败保持不变，观察不覆盖原错误。'
  ),
  onTransactionClose: field(
    'Original native transaction resource reached its actual end.',
    '原生事务资源已经实际结束，观察不会重新打开作用域。'
  ),
  beforePersistFlush: field(
    'Before the original transactional persistence flush.',
    '原事务持久化刷新即将开始，不创建新的刷新调度器。'
  ),
  afterPersistFlush: field(
    'Encoding and native requests completed; this alone is not a commit certificate.',
    '编码与原生请求已经完成，但仅此阶段不能证明事务提交。'
  ),
  beforeBackendCreate: field(
    'Before original native backend construction acquires resources.',
    '原生后端构造获取资源之前的观察，不提前获得客户端。'
  ),
  afterBackendCreate: field(
    'Original backend construction returned its actual native object.',
    '原后端构造已经返回真实原生对象，观察不替代准入检查。'
  ),
  onBackendRejected: field(
    'Original runtime backend admission rejected its candidate.',
    '原运行时后端准入拒绝候选对象，不发布未验证后端。'
  ),
  afterBackendInstall: field(
    'Original backend and its selected capabilities were installed.',
    '原后端及所选能力已经安装，仍由原登记拥有生命周期。'
  ),
  onBackendDisposeStart: field(
    'Original backend cleanup started after admission was sealed.',
    '封闭准入之后原后端清理开始，观察不取得关闭权限。'
  ),
  afterBackendDispose: field(
    'Original backend cleanup reached its terminal boundary.',
    '原后端清理到达终态边界，观察不能恢复该实例。'
  ),
  beforeSql: field(
    'Before the actual native SQL request; only statement bytes and parameter count are observed.',
    '实际原生语句请求之前，只观察语句字节及参数数量。'
  ),
  afterSql: field(
    'After actual native SQL execution with elapsed time and affected rows.',
    '实际原生语句执行之后，观察耗时与受影响行数。'
  ),
  onSqlError: field(
    'Actual native SQL execution failed; only the normalized code is exposed.',
    '真实原生语句执行失败，只暴露规范错误码，不暴露参数值。'
  ),
  beforeStorageOperation: field(
    'Before the original public endpoint’s actual work.',
    '原公开存储终点真实工作开始之前，只观察操作名及数量。'
  ),
  afterStorageOperation: field(
    'The original endpoint settled successfully with actual count and elapsed time.',
    '原终点成功结算之后观察真实数量及耗时，不重复运行操作。'
  ),
  onStorageOperationError: field(
    'Original endpoint failed and retained its primary failure.',
    '原终点失败且保留主要错误，观察只报告规范错误码。'
  ),
  onStorageIterationClose: field(
    'Original storage iterator closed with its actual consumed-row count.',
    '原存储迭代器已经关闭，报告实际消费行数而不重新遍历。'
  ),
  beforeLockAcquire: field(
    'Original policy is selected before canonical lock admission.',
    '规范锁准入之前已经选择原策略，不建立另一份策略循环。'
  ),
  onLockAcquired: field(
    'Original owner acquired the actual canonical locks for this attempt.',
    '原拥有者已经取得本尝试实际规范锁，只观察尝试与键数。'
  ),
  onLockConflict: field(
    'Actual acquisition or commit conflict with its original holder facts.',
    '真实取锁或提交冲突及原持有者事实，不推测不存在的锁。'
  ),
  onLockWait: field(
    'Original attempt waited on the existing admission owner.',
    '原尝试沿已有准入拥有者等待，观察真实等待耗时。'
  ),
  onConcurrencyDecision: field(
    'Original policy returned its authentic next decision.',
    '原策略返回真实下一步决策，观察不产生另一份重试决策。'
  ),
  onRetry: field(
    'Original loop will retry after its declared delay and classified reason.',
    '原循环按声明延迟及原因重试，不由观察回调发起额外尝试。'
  ),
  onLockReleased: field(
    'Original owner released this attempt’s actual keys.',
    '原拥有者已经释放本尝试的实际键，不释放其它尝试拥有的锁。'
  ),
  onLockLost: field(
    'Native owner proved the original lease was replaced.',
    '原生拥有者确认原租约已被替换，不以本地时间单独猜测丢锁。'
  ),
  beforeLockInspect: field(
    'Before the original readonly lock inspection.',
    '原只读锁检查开始之前，观察不申请或续期锁。'
  ),
  afterLockInspect: field(
    'Original lock inspection returned its actual count.',
    '原锁检查返回真实数量，观察不保留可修改锁句柄。'
  ),
  onLockInspectError: field(
    'Original lock inspection failed with its coded error.',
    '原锁检查失败，只观察已有语义码而不覆盖原错误。'
  ),
  beforeLogOpen: field(
    'Original logger store or durable resource is about to open.',
    '原日志存储或持久资源即将打开，不伪造后端身份。'
  ),
  afterLogOpen: field(
    'Original durable log resource opened successfully.',
    '原持久日志资源已经成功打开，仍归其原拥有者管理。'
  ),
  onLogOpenError: field(
    'Original durable log opening failed.',
    '原持久日志打开失败，沿原日志诊断提供准确阶段。'
  ),
  beforeLogOperation: field(
    'Before the original durable log operation.',
    '原持久日志操作开始之前，观察既有操作与拥有者信息。'
  ),
  afterLogOperation: field(
    'Original durable log operation completed.',
    '原持久日志操作完成，报告既有序号、数量及耗时事实。'
  ),
  onLogOperationError: field(
    'Original durable log operation failed.',
    '原持久日志操作失败，保留原日志错误及其原因处理。'
  ),
  beforeLogClose: field(
    'Original durable log resource begins cleanup.',
    '原持久日志资源开始清理，不由观察回调关闭共享日志。'
  ),
  afterLogClose: field(
    'Original durable log cleanup finished.',
    '原持久日志清理完成，观察不重新取得资源或写入权限。'
  ),
  onLogCloseError: field(
    'Original durable log resource cleanup failed.',
    '原持久日志资源清理失败，观察不覆盖主要清理错误。'
  ),
  onAppend: field(
    'Original logger append published committed records.',
    '原日志追加已经发布已提交记录，不重复追加或推进序号。'
  ),
  onWalPending: field(
    'Original WAL owner observed its actual pending record.',
    '原预写日志拥有者观察到真实待处理记录，不复制待处理索引。'
  ),
  onBinlogAppendError: field(
    'External commit-only publication failed after an actual business commit.',
    '真实业务提交之后外置仅提交发布失败，不伪装成业务回滚。'
  ),
  beforeJournalRecover: field(
    'Before matching-target original journal recovery.',
    '匹配目标的原日志恢复开始之前，只观察稳定目标身份。'
  ),
  afterJournalRecover: field(
    'Original matching-target recovery completed with actual count and duration.',
    '原匹配目标恢复完成，观察真实恢复数量及耗时。'
  ),
  onJournalRecoverError: field(
    'Original matching-target recovery failed.',
    '原匹配目标恢复失败，保留原恢复原因及封写处理。'
  ),
  beforeDetect: field(
    'Before the original installed backend environment checks.',
    '已安装原后端环境检查开始之前，不增加探针或连接。'
  ),
  afterDetect: field(
    'Original detection completed with actual check count and elapsed time.',
    '原环境检查完成，报告真实检查数量与耗时。'
  ),
  onDetectError: field(
    'Original environment detection failed with its semantic code.',
    '原环境检查失败，报告语义码且保留原检查错误。'
  )
}

/** Payload type nodes retain their exact original field groups, without sensitive business data. */
export const storageHostHookTypes: Readonly<Record<string, ITypeDoc>> = {
  IStorageHookMap: {
    summary: t(
      'The single augmentable event map shared by host construction, stage adapters and hooks.on; observers cannot veto storage.',
      '宿主构造、阶段适配器与监听方法共用的唯一可扩充事件映射，观察者不能否决存储。'
    ),
    members: hookMap
  },
  IStorageHookIdentity: {
    summary: t(
      'Primitive original registration facts only; no store, scope, client, keys or authentication configuration is carried.',
      '只携带原登记基本事实，不包含存储、作用域、客户端、键或认证配置。'
    ),
    members: identity
  },
  IStorageHookFailure: {
    summary: t(
      'Normalized semantic failure code without the original Error, message or business payload.',
      '规范语义失败码，不包含原错误、消息或业务负载，原错误仍由实际边界保留。'
    ),
    members: {
      code: field(
        'Optional semantic code from the owning original failure.',
        '来自所属原失败的可选语义码。'
      )
    }
  },
  IStorageHostInstallHookPayload: {
    summary: t(
      'The original current batch’s plugin count, without a fabricated host id or extra installation state.',
      '原当前批次的插件数量，不虚构宿主编号或添加额外安装状态。'
    ),
    members: {
      pluginCount: field(
        'Number of plugin handles in this original install batch.',
        '本原安装批次中的插件句柄数量。'
      )
    }
  },
  IStorageHostCloseHookPayload: {
    summary: t(
      'Original registry size captured at close, without access to the registered resources.',
      '关闭时捕获的原登记表规模，不因此提供访问已登记资源的权限。'
    ),
    members: {
      backendCount: field(
        'Number of registered backend targets when original close starts.',
        '原关闭开始时已经登记的后端目标数量。'
      )
    }
  },
  IStorageEnvelopeCheckHookPayload: {
    summary: t(
      'Before-validation primitive envelope target facts; unvalidated archive contents are never observed.',
      '校验前的基本存档目标事实，始终不观察尚未校验的存档内容。'
    ),
    members: {
      ...operation,
      targetVersion: field(
        'Target version supplied by the original repository operation.',
        '由原仓储操作提供的目标版本。'
      )
    }
  },
  IStorageEnvelopeHookPayload: {
    summary: t(
      'Successfully validated archive version added only after the original envelope check.',
      '只有原存档检查成功之后才补入的已验证存档版本，不提前解释非法数据。'
    ),
    members: {
      version: field(
        'Stored version confirmed by the original archive validation.',
        '原存档校验已经确认的持久版本。'
      )
    }
  },
  IStorageMigrationStepHookPayload: {
    summary: t(
      'Original migration operation and version transition, without its state or cancellation signal.',
      '原迁移操作及版本转换，不包含迁移状态或取消信号，也不重跑步骤。'
    ),
    members: {
      ...operation,
      fromVersion: field(
        'Source version supplied by the original migration plan.',
        '原迁移计划提供的来源版本。'
      ),
      toVersion: field(
        'Target version supplied by the same original migration step.',
        '同一原迁移步骤提供的目标版本。'
      )
    }
  },
  IStorageCodecHookPayload: {
    summary: t(
      'Original operation and codec identity; encoded bytes and domain values are not exposed.',
      '原操作与编解码身份，不暴露编码字节及领域值，不改变编解码算法。'
    ),
    members: {
      ...operation,
      codec: field(
        'Codec name supplied by the actual admitted codec.',
        '实际已准入编解码器提供的名称。'
      )
    }
  },
  IStorageQueryHookPayload: {
    summary: t(
      'Original query source and optional index identity, without query conditions or results.',
      '原查询来源与可选索引身份，不包含查询条件或结果，也不保留游标资源。'
    ),
    members: {
      source: field(
        'Source label issued by the original query source.',
        '由原查询来源发出的来源标签。'
      ),
      index: field(
        'Index name selected by the original source, or undefined.',
        '原来源选择的索引名称，未选时为未定义值。'
      )
    }
  },
  IStorageOperationHookPayload: {
    summary: t(
      'Original endpoint operation and optional batch count; key/value payloads and native handles remain private.',
      '原终点操作与可选批量数量，键值负载及原生句柄保持私有，不作为观察数据传出。'
    ),
    members: {
      ...operation,
      count: field(
        'Original input/result count when the endpoint has a finite batch.',
        '终点具有有限批量时的原输入或结果数量。'
      )
    }
  },
  IStorageLockAttemptHookPayload: {
    summary: t(
      'Original concurrency loop attempt number and canonical key count; no lock or transaction authority is granted.',
      '原并发循环尝试编号与规范键数量，不授予锁或事务权限，也不新增尝试状态。'
    ),
    members: {
      attempt: field(
        'Original attempt number from the shared concurrency loop.',
        '来自共享并发循环的原尝试编号。'
      ),
      keyCount: field(
        'Actual canonical key count for this original attempt.',
        '本原尝试实际规范锁键数量。'
      )
    }
  },
  IStorageJournalHookPayload: {
    summary: t(
      'Stable original recovery target without journal records, retained logger handles or native clients.',
      '稳定原恢复目标，不携带日志记录、被保留日志句柄或原生客户端。'
    ),
    members: {
      namespace: field(
        'Stable namespace selected by the original journal configuration.',
        '原日志配置选择的稳定命名空间。'
      ),
      backendInstanceId: field(
        'Exact installed backend id issued by the original registry.',
        '由原登记表发出的准确已安装后端编号。'
      )
    }
  },
  IStorageLogHookPayload: {
    summary: t(
      'Original logger observation shape without inventing backend identity for a shared borrowed logger.',
      '保留原日志观察形状，不为共享借入日志虚构后端身份或新的资源所有权。'
    ),
    members: {
      stage: field(
        'Actual stage name issued by the original logger observation.',
        '原日志观察发出的真实阶段名称。'
      ),
      owner: {
        ...field('Original logger/store owner classification.', '原日志或存储拥有者分类。'),
        values: {
          store: t('The original durable store operation.', '原持久存储操作。'),
          binlog: t('The original committed binary-log plugin.', '原已提交二进制日志插件。'),
          wal: t('The original pending/completed write-ahead log.', '原待处理与已完成预写日志。'),
          undo: t('The original committed undo log.', '原已提交撤销日志。')
        }
      },
      ...operation,
      seq: field(
        'Original durable sequence when the stage has one.',
        '阶段具有持久序号时的原序号。'
      ),
      count: field(
        'Actual record count supplied by the original stage.',
        '原阶段提供的真实记录数量。'
      ),
      durationMs: field(
        'Elapsed milliseconds measured by the original logger owner.',
        '原日志拥有者测量的毫秒耗时。'
      )
    }
  },
  IStorageHttpHookPayload: {
    summary: t(
      'Shared primitive HTTP request observation for native HTTP backends; path omits query, auth, headers and body.',
      '原生请求后端共享的基本请求观察，路径不含查询、认证、请求头或正文。'
    ),
    members: {
      method: {
        ...field(
          'Actual native HTTP method, never a fabricated observation request.',
          '实际原生请求方法，不为观察伪造额外请求。'
        ),
        values: {
          GET: t('Read the original native resource.', '读取原生资源。'),
          HEAD: t(
            'Read original resource metadata without its body.',
            '不读取正文，只读取原资源元数据。'
          ),
          POST: t('Run the original native submitted operation.', '执行原生提交操作。'),
          PUT: t('Write the original native resource.', '写入原生资源。'),
          DELETE: t('Remove the original native resource.', '移除原生资源。')
        }
      },
      path: field(
        'Native route without query parameters or authentication values.',
        '不包含查询参数或认证值的原生路由。'
      ),
      status: field('Native response status when a response exists.', '存在响应时的原生响应状态。'),
      elapsedMs: field(
        'Original native request elapsed time in milliseconds.',
        '原原生请求的毫秒耗时。'
      )
    }
  }
}
