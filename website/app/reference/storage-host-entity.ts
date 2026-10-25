import { storageHostAssemblySymbols } from './storage-optional-assembly.js'
import type { ILibraryReference, IMemberDoc, IOptionCaseDoc, IText, ITypeDoc } from './contract.js'
import { storageContractReference } from './storage-contract.js'
import { storageHostCases } from './storage-host-cases.js'

/** Localized descriptions cover the same neutral entity contract in both site languages. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Entity operations borrow their connected store's cancellation and timeout budget. */
const ctx = t(
  'Optional caller operation context with signal, timeoutMs and pageSize; an original transaction scope inherits its context instead.',
  '调用方提供的可选操作上下文，包含 signal、timeoutMs 与 pageSize；原事务作用域继承原上下文。'
)
/** Root writes additionally accept the connected store's original concurrency policy. */
const writeCtx = t(
  'Optional caller operation context and original concurrency policy; no new transaction owner or retry loop is created.',
  '调用方提供的可选操作上下文及原并发策略，不创建额外事务拥有者或重试循环。'
)
/** Primary identities are application keys, never raw repository-prefixed physical keys. */
const id = t(
  'Application entity identifier from its configured primary-key field, or the logical key returned by repository.put().',
  '应用实体的标识，来自配置的主键字段或 repository.put() 返回的逻辑键。'
)
/** One public host example supplies the actual definition, connection and lifecycle. */
const entityExample = storageHostCases.defineEntity![0]!.example
/** One complete configuration shows how schema, versioning and literal index inference interact. */
const entityConfiguration: IOptionCaseDoc = {
  title: t('Configure a versioned indexed entity', '配置带索引和版本的实体'),
  problem: t(
    'Persist portable domain values with an explicit format, migration path and bounded default ordering.',
    '以显式格式、迁移路径和有界默认排序持久化领域值。'
  ),
  covers: ['name', 'key', 'schema', 'codec', 'version', 'migrations'],
  example:
    "import { entityMigrationFeature } from '@migaia/storage-host/entity/migration'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity, jsonCodec, passthrough } from '@migaia/storage-host/entity'\ntype IOrder = { id: string; status: string; total: number }\nconst definition = defineEntity<IOrder>()({\n  features: [entityMigrationFeature()],\n  name: 'orders',\n  key: 'id',\n  schema: passthrough<IOrder>(),\n  codec: jsonCodec,\n  version: 2,\n  migrations: { 2: (state) => state },\n})\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst repo = definition.connect(host.backend('memory'))\nawait repo.put({ id: 'a', status: 'paid', total: 200 })\nconsole.log(await repo.get('a'))",
  result: t(
    'Prints the stored order. Current-version writes are explicit; reads do not silently persist older-envelope migration.',
    '输出已存订单。写入显式使用当前版本，读取不会静默持久化旧封装的迁移结果。'
  )
}
/** A separate source-selection scenario keeps index and diagnostic choices reviewable. */
const entityIndexConfiguration: IOptionCaseDoc = {
  title: t('Select an indexed source with bounded default ordering', '选择索引来源与有界默认排序'),
  problem: t(
    'Keep read validation enabled while selecting a literal index and reporting scan or codec fallback diagnostics.',
    '选择字面量索引时保持读取校验，并报告扫描或 codec 回退诊断。'
  ),
  covers: ['validateOnRead', 'onDiagnostic', 'defaultOrderBy', 'indexes'],
  example:
    "import { entityQueryFeature } from '@migaia/storage-host/entity/query'\nimport { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity } from '@migaia/storage-host/entity'\ntype IOrder = { id: string; status: string; total: number }\nconst definition = defineEntity<IOrder>()({\n  features: [entityQueryFeature(), entityIndexesFeature()],\n  name: 'orders',\n  key: 'id',\n  validateOnRead: true,\n  onDiagnostic: (message) => console.warn(message),\n  defaultOrderBy: (left, right) => left.total - right.total,\n  indexes: { byStatus: { path: 'status', revision: 1 } },\n})\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst repo = definition.connect(host.backend('memory'))\nawait repo.put({ id: 'a', status: 'paid', total: 200 })\nconsole.log(await repo.query().index('byStatus', 'paid').limit(10).all())",
  result: t(
    'Prints the matching order. The declared index key remains a string and the comparator keeps an explicit finite bound.',
    '输出匹配订单。已声明索引键保留字符串类型，比较器具有显式有限上限。'
  )
}
/** Ordinary properties carry one source-backed description without fabricated execution semantics. */
const field = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Data and instance types share a real public entity scenario rather than an invented constructor. */
const entityType = (en: string, zh: string, members: ITypeDoc['members']): ITypeDoc => ({
  summary: t(en, zh),
  scenarios: [
    t(
      'Connect one reusable entity definition to an admitted store and keep disposal with that store or host.',
      '把可复用实体定义连接到已准入存储，资源释放仍由原存储或宿主负责。'
    )
  ],
  example: entityExample,
  members
})

/** Entity configuration is captured once before connecting to any backend. */
const entityOptions: Readonly<Record<string, IMemberDoc>> = {
  features: {
    summary: t(
      'Explicit entity capability factories selected before connection. Choose query, indexes, unique, migration or keyset only for operations the application uses.',
      '连接前显式选择实体能力工厂，仅为业务使用的查询、索引、唯一约束、迁移或分页加入对应特性。'
    ),
    default: t(
      'Omitted: definitions, connection and basic reads/writes only; optional calls reject ENTITY_FEATURE_REQUIRED.',
      '省略时仅提供定义、连接与基础读写；调用未装配能力会报 `ENTITY_FEATURE_REQUIRED`。'
    ),
    example: storageHostAssemblySymbols.entityQueryFeature!.example
  },
  name: field(
    'Caller-selected nonempty entity namespace; the reserved __ prefix is rejected.',
    '调用方选择的非空实体命名空间，保留的双下划线前缀不允许使用。'
  ),
  key: field(
    'Caller-selected domain property whose normalized value becomes the logical primary key.',
    '调用方选择的领域对象属性，其规范化值作为实体逻辑主键。'
  ),
  schema: {
    ...field(
      'Schema adapter validating domain values and optionally normalizing or converting the stored shape.',
      '校验领域值的 schema 适配器，也可执行规范化或转换实际存储形状。'
    ),
    default: t(
      'Omitted: passthrough performs no validation or conversion.',
      '省略时使用 passthrough，不进行校验或格式转换。'
    )
  },
  codec: {
    ...field(
      'Explicit codec is honored on every backend; selectCodec chooses its actual storage carrier.',
      '所有后端均尊重显式 codec，由 selectCodec 选择实际存储载体。'
    ),
    default: t(
      'Omitted: structuredCodec for record-capable stores, otherwise jsonCodec.',
      '省略时，有记录能力的存储使用 structuredCodec，其余使用 jsonCodec。'
    )
  },
  version: {
    ...field(
      'Positive safe-integer persisted envelope version captured by this reusable definition.',
      '由可复用实体定义捕获的持久化封装版本，必须是正安全整数。'
    ),
    default: t(
      '1: existing version-one records need no migration steps.',
      '默认一版，已有同版记录不需要迁移步骤。'
    )
  },
  migrations: {
    ...field(
      'Caller step table with an own migration for every version from 2 through the configured version.',
      '调用方提供的迁移表，从第二版至配置版本的每一步都必须是自有条目。'
    ),
    default: t(
      'Omitted only for version 1; later versions require the complete table.',
      '仅第一版可省略；更高版本必须提供完整迁移表。'
    )
  },
  validateOnRead: {
    ...field(
      'Whether materialized stored values pass schema validation after decoding and in-memory migration.',
      '决定已存值经过解码及内存迁移后，是否继续通过 schema 校验。'
    ),
    default: t(
      'true: persisted reads are validated against the current schema.',
      '默认 true，按当前 schema 校验持久化读取结果。'
    )
  },
  onDiagnostic: {
    ...field(
      'Caller receiver for scan and codec fallback diagnostics, without changing the original operation result.',
      '调用方接收扫描和 codec 回退诊断的函数，不改变原操作结果。'
    ),
    default: t(
      'Omitted: the existing host console warning path reports diagnostics.',
      '省略时由既有宿主控制台警告路径报告诊断。'
    ),
    whenToUse: t(
      'Select this when the application needs to route codec fallback and scan diagnostics through its own reporting boundary.',
      '应用需要把 codec 回退和扫描诊断送到自己的报告边界时使用。'
    ),
    example: 'const onDiagnostic = (message: string) => console.warn(message)'
  },
  defaultOrderBy: {
    ...field(
      'Optional caller domain comparator returning a finite number; comparator queries require a finite limit.',
      '可选领域对象比较函数，须返回有限数值；比较器查询必须提供有限上限。'
    ),
    default: t('Omitted: canonical primary-key order is used.', '省略时按规范主键顺序排列结果。')
  },
  indexes: {
    ...field(
      'Caller index definitions with exact names and path, paths or select projections; unique commits require an authoritative transaction or atomic write port.',
      '调用方定义的具名索引，使用 path、paths 或 select 投影；唯一写入需要真实事务或原子写端口。'
    ),
    default: t('Omitted: no secondary projections are installed.', '省略时不安装任何次级索引投影。')
  }
}

/** List options choose an original source before the shared reader filters, orders and limits it. */
const listOptions: Readonly<Record<string, IMemberDoc>> = {
  range: {
    ...field(
      'Caller canonical key range within this entity, or within the selected index key domain.',
      '调用方为当前实体指定的规范键范围；选定索引时使用该索引的键值域。'
    ),
    default: t(
      'Omitted: visit the complete selected entity or index range.',
      '省略时遍历选定实体或索引的完整范围。'
    )
  },
  direction: {
    ...field(
      'Caller selection of forward or reverse native key traversal before client ordering.',
      '调用方选择客户端排序之前的正向或反向原生键遍历方向。'
    ),
    default: t(
      'next: traverse keys in forward canonical order.',
      '默认 next，按规范键顺序正向遍历。'
    ),
    values: {
      next: t('Forward key traversal.', '按键顺序正向遍历。'),
      prev: t('Reverse key traversal.', '按键顺序反向遍历。')
    }
  },
  onInvalid: {
    ...field(
      'Skip, throw, or a synchronous caller handler selecting either action for a failed record.',
      '选择跳过、抛出，或使用同步回调为每条失败记录选择这两种处理方式。'
    ),
    default: t(
      'skip: omit invalid records without repairing stored data.',
      '默认 skip，跳过无效记录，不自动修复持久化数据。'
    ),
    values: {
      skip: t('Omit this invalid row and continue.', '跳过当前无效行后继续读取。'),
      throw: t('Reject the query with its failure.', '以当前失败拒绝整个查询。')
    }
  },
  orderBy: {
    ...field(
      'Caller comparator over domain records returning a finite number; requires an explicit finite limit.',
      '调用方针对领域记录的比较函数，须返回有限数值，并要求显式有限上限。'
    ),
    default: t(
      'Omitted: use the definition’s defaultOrderBy when configured, which still requires limit; otherwise preserve canonical source key order.',
      '省略时先使用实体定义中的 defaultOrderBy，存在该比较器时仍须指定 limit；未配置比较器时才保留规范来源键顺序。'
    )
  },
  limit: {
    ...field(
      'Caller nonnegative safe result bound; required for an explicit comparator or the definition’s defaultOrderBy.',
      '调用方选择的非负安全结果上限；显式比较器或定义中的 defaultOrderBy 生效时必填。'
    ),
    default: t(
      'Omitted only without an explicit or configured default comparator: no caller result cap.',
      '仅没有显式或已配置默认比较器时可以省略，表示不设置调用方结果上限。'
    )
  },
  index: {
    ...field(
      'Exact declared secondary-index name; IIndexedListOptions correlates it with the projected range key.',
      '准确声明的次级索引名，IIndexedListOptions 将其与投影范围键保持类型关联。'
    ),
    default: t('Omitted: use the entity primary-key source.', '省略时使用实体主键作为查询来源。')
  }
}

/** A repository borrows the connected store and never creates an independent resource lifetime. */
const repositoryMembers: Readonly<Record<string, IMemberDoc>> = {
  query: {
    summary: t(
      'Create an immutable entity query over the connected store and materialization pipeline.',
      '为所连接存储及其领域值物化管线创建不可变实体查询。'
    ),
    returns: t(
      'A precisely typed IEntityQuery; construction performs no backend I/O. Leading canonical conditions can select a declared path index; explicit index or range takes priority. Explain reports candidate reasons and conservatively retains fullScan:true because the original reader may fall back.',
      '返回精确类型的 IEntityQuery，构建时不执行后端读写。链首规范条件可选择已声明路径索引，显式 index 或 range 优先。Explain 报告候选理由，并保守保留 fullScan:true，因为原读取路径仍可能回退扫描。'
    ),
    example: "const rows = await repo.query().where('total', 'gte', 100).all()"
  },
  get: {
    summary: t(
      'Read one entity value and migrate older envelopes in memory without implicit writeback.',
      '读取一个实体值，并仅在内存迁移旧版封装，不隐式写回数据。'
    ),
    params: { id, ctx },
    returns: t(
      'The validated domain value or undefined for a missing entity; decode and schema failures reject.',
      '返回校验后的领域值，实体缺失时为 undefined；解码与 schema 失败会拒绝操作。'
    ),
    example: "const user = await repo.get('a')"
  },
  put: {
    summary: t(
      'Validate, normalize and encode one domain value before committing its entity envelope.',
      '先校验、规范化并编码领域值，然后提交对应实体封装。'
    ),
    params: {
      value: t(
        'Caller domain object containing the configured primary-key property.',
        '调用方提供的领域对象，必须包含已配置的主键属性。'
      ),
      ctx: writeCtx
    },
    returns: t(
      'The normalized logical primary key after the original backend commit succeeds.',
      '原后端提交成功后，返回规范化的逻辑主键。'
    ),
    example:
      "const key = await repo.put({ id: 'a', total: 200, status: 'paid', category: 'one', archived: true })"
  },
  remove: {
    summary: t(
      'Delete this entity identity through the original backend and its unique-index projection rules.',
      '通过原后端及其唯一索引投影规则删除指定实体身份。'
    ),
    params: { id, ctx: writeCtx },
    returns: t(
      'A promise resolving after deletion completes; no logical delete count is returned.',
      '删除完成后承诺兑现，不返回逻辑删除数量。'
    ),
    example: "await repo.remove('a')"
  },
  list: {
    summary: t(
      'Collect materialized entity rows using the selected source, invalid-row policy and bounded ordering.',
      '按所选来源、无效记录策略与有界排序收集已物化的领域实体。'
    ),
    params: {
      options: t(
        'Caller list or indexed-list options; range, index, direction, invalid-row policy and comparator/limit correlation select the source and result.',
        '调用方提供的普通或索引列表选项，以范围、索引、方向、无效记录策略及比较器与上限关联选择结果。'
      ),
      ctx
    },
    returns: t(
      'Domain rows in final query order after the original reader has closed.',
      '原读取器关闭后，返回按最终查询顺序排列的领域记录数组。'
    ),
    example: 'const rows = await repo.list({ limit: 10 })'
  },
  stream: {
    summary: t(
      'Iterate materialized entity rows with the original query cursor and operation resource ownership.',
      '使用原查询游标及操作资源归属，逐条迭代物化后的领域实体。'
    ),
    params: {
      options: t(
        'Caller list or indexed-list options, with the same source and finite-comparator rules as list().',
        '调用方提供的普通或索引列表选项，来源与有限比较器规则同 list()。'
      ),
      ctx
    },
    returns: t(
      'An IStorageIterator; finish iteration or await dispose() when stopping early.',
      '返回 IStorageIterator，应完成迭代，提前停止时等待 dispose()。'
    ),
    example:
      'const rows = repo.stream({ limit: 10 })\ntry { console.log(await rows.next()) } finally { await rows.dispose() }'
  },
  findBy: {
    summary: t(
      'Read the first domain record matching one exact declared secondary-index key.',
      '按准确声明的次级索引键，读取首条匹配的领域实体记录。'
    ),
    params: {
      index: t(
        'Caller-selected name from this entity definition’s declared indexes.',
        '调用方从当前实体定义中已声明的次级索引选择的名称。'
      ),
      key: t(
        'Caller lookup key in the selected index’s inferred projection domain.',
        '调用方提供的查询键，使用所选索引推导出的投影键值域。'
      ),
      ctx
    },
    returns: t(
      'The first materialized match, or undefined when the selected index has no matching entity.',
      '返回第一条已物化的匹配记录；该索引没有匹配实体时为 undefined。'
    ),
    example: "const paid = await repo.findBy('byStatus', 'paid')"
  },
  migrate: {
    summary: t(
      'Explicitly persist upgraded envelopes in bounded batches using original per-record conflict handling.',
      '使用有界批次显式持久化升级后的封装，并沿用原逐条冲突处理。'
    ),
    params: {
      options: t(
        'Caller migration options: batchSize defaults to 100 and onInvalid defaults to skip.',
        '调用方提供的迁移选项，batchSize 默认一百，onInvalid 默认 skip。'
      ),
      ctx
    },
    returns: t(
      'Actual scanned, eligible, migrated, skipped, alreadyCurrent and conflicted counters.',
      '返回实际 scanned、eligible、migrated、skipped、alreadyCurrent 与 conflicted 计数。'
    ),
    example: 'const progress = await repo.migrate({ batchSize: 100 })'
  },
  batch: {
    summary: t(
      'Run entity operations inside one authentic rollback-capable transaction of the connected backend.',
      '在所连接后端的一个真实可回滚事务内执行实体操作。'
    ),
    params: {
      run: t(
        'Caller callback borrowing the transaction-bound entity scope; its returned promise is awaited.',
        '调用方回调借用绑定原事务的实体作用域，返回承诺时会等待完成。'
      ),
      ctx: writeCtx
    },
    returns: t(
      'The awaited callback result after original commit; KV-only backends reject unsupported atomic batches.',
      '原提交成功后返回回调结果；仅键值能力的后端拒绝不支持的原子批次。'
    ),
    example: "const row = await repo.batch(async (tx) => tx.get('a'))"
  },
  in: {
    summary: t(
      'Borrow the exact existing transaction scope without opening a second native transaction.',
      '借用准确的既有事务作用域，不打开第二个原生事务。'
    ),
    params: {
      tx: t(
        'The actual live ITransactionScope belonging to the repository’s connected store and owner.',
        '属于仓储所连接存储及其原拥有者的真实活跃 ITransactionScope。'
      )
    },
    returns: t(
      'An IEntityTransactionScope that expires with that original callback.',
      '返回随原事务回调结束而失效的 IEntityTransactionScope。'
    ),
    example: "await store.transaction(async (tx) => { console.log(await repo.in(tx).get('a')) })"
  },
  lockKey: {
    summary: t(
      'Derive the authoritative text or record lock identity for one repository entity.',
      '为仓储实体派生真实的文本或记录通道锁身份。'
    ),
    params: { id },
    returns: t(
      'An original ILockKey for the actual physical repository key; no lock is acquired.',
      '返回真实仓储物理键对应的原 ILockKey，此调用不获取锁。'
    ),
    example: "const key = repo.lockKey('a')"
  }
}

/** Entity source selection precedes the canonical shared query executor. */
const entityQueryControls: Readonly<Record<string, IMemberDoc>> = {
  ...storageContractReference.types!.IRecordQuery!.members,
  limit: {
    ...storageContractReference.types!.IRecordQuery!.members.limit!,
    summary: t(
      'Set the final entity result bound after filtering and ordering; a later limit replaces the earlier bound on this branch.',
      '设置过滤与排序后的最终实体结果上限；同一分支后一次 limit 覆盖前一次边界。'
    )
  },
  skip: {
    ...storageContractReference.types!.IRecordQuery!.members.skip!,
    summary: t(
      'Set the final entity offset after filtering and ordering, before the result limit; a later skip replaces the earlier offset.',
      '设置过滤与排序后、结果上限前的最终实体偏移；后一次 skip 覆盖前一次偏移。'
    ),
    params: {
      count: t(
        'A caller nonnegative safe integer counting final ordered entity rows to skip.',
        '调用方指定的非负安全整数，表示跳过最终有序实体结果的行数。'
      )
    },
    returns: t(
      'A new entity branch retaining its final offset and original Feature methods.',
      '返回保留最终偏移及原 Feature 方法的新实体查询分支。'
    )
  },
  update: {
    ...storageContractReference.types!.IRecordQuery!.members.update!,
    params: {
      ...storageContractReference.types!.IRecordQuery!.members.update!.params!,
      patch: t(
        'A detached partial entity patch. Schema normalization must keep the original identity; changing it rejects with INVALID_CONFIG before writing that row instead of migrating its key or replacing another entity. Earlier accepted rows roll back with the original transaction.',
        '分离后的实体部分字段补丁。经 schema 规范化后必须保持原身份；改变身份会在写入该行之前报 INVALID_CONFIG，不迁移其主键或替换另一实体；之前已接纳的行随原事务回滚。'
      )
    }
  },
  index: {
    summary: t(
      'Select one declared index before subsequent shared filtering, ordering and projection.',
      '先选择一个已声明索引，再执行共享过滤、排序与投影步骤。'
    ),
    params: {
      name: t(
        'Caller-selected exact index name captured by the entity definition.',
        '调用方选择的准确索引名，必须由该实体定义预先声明。'
      ),
      match: t(
        'Optional caller index key or range in this index’s inferred key domain; omitted selects its complete range.',
        '调用方可选的索引键或范围，使用该索引推导值域；省略时选择完整索引范围。'
      )
    },
    returns: t(
      'An IEntityQueryNarrowed retaining shared query and original Feature methods.',
      '返回保留共享查询与原 Feature 方法的 IEntityQueryNarrowed。'
    ),
    example: "const paid = await repo.query().index('byStatus', 'paid').all()"
  },
  range: {
    summary: t(
      'Choose a canonical primary-key source range before entering the shared query chain.',
      '在进入共享查询链之前，选择规范主键来源范围。'
    ),
    params: {
      range: t(
        'Caller IKeyRange over the entity logical key domain; it does not expose raw physical prefixes.',
        '调用方为实体逻辑键指定的 IKeyRange，不暴露原始物理前缀。'
      )
    },
    returns: t(
      'A narrowed entity query with this source range and unchanged original ownership.',
      '返回具有该来源范围的实体查询，原资源归属保持不变。'
    ),
    example: "const rows = await repo.query().range({ lower: 'a', upper: 'z' }).all()"
  },
  onInvalid: {
    summary: t(
      'Choose how materialization failures are handled without mutating or repairing stored rows.',
      '选择物化失败的处理方式，不修改或修复持久化记录。'
    ),
    params: {
      action: t(
        'Caller choice skip, throw, or a synchronous handler receiving the original invalid-record issue.',
        '调用方选择 skip、throw，或接收原无效记录问题的同步处理函数。'
      )
    },
    returns: t(
      'A narrowed query retaining its source and the selected invalid-record policy.',
      '返回保留原来源并携带所选无效记录处理策略的查询。'
    ),
    example: "const rows = await repo.query().onInvalid('throw').all()"
  }
}

/** Only the entity entry receives these symbols; the neutral host root does not re-export them. */
export const storageHostEntitySymbols: NonNullable<ILibraryReference['symbols']> = {
  defineEntity: {
    role: 'factory',
    purpose: t(
      'Capture a reusable typed entity definition, schema and codec before binding it to an admitted store. Optional query, indexes, unique, migration and keyset operations require their explicit Feature factories.',
      '在绑定已准入存储之前，捕获可复用且有精确类型的实体定义、校验与编解码配置；查询、索引、唯一约束、迁移和分页需显式选择对应特性。'
    ),
    params: {
      options: t(
        'Caller entity configuration with name/key and optional schema, codec, version, migrations, diagnostics, indexes and default ordering; the curried form fixes the domain type first.',
        '调用方提供实体 name、key 及可选 schema、codec、版本、迁移、诊断、索引与默认排序；柯里化形式先固定领域类型。'
      )
    },
    options: 'IEntityOptions',
    optionCases: [entityConfiguration, entityIndexConfiguration],
    returns: t(
      'A frozen IEntityDefinition; connect(store) borrows the store and preserves its exact Feature query methods.',
      '返回冻结的 IEntityDefinition，connect(store) 借用原存储并保留其精确 Feature 查询方法。'
    ),
    example: entityExample,
    cases: storageHostCases.defineEntity
  },
  jsonCodec: {
    role: 'operation',
    purpose: t(
      'Encode portable values through the canonical version-one JSON codec; unsupported values reject before backend I/O.',
      '通过规范第一版 JSON codec 编码 portable 值，不支持的值在任何后端读写前拒绝。'
    ),
    returns: t(
      'The existing asynchronous json@1 text codec with original contract and codec errors retained.',
      '返回既有异步 json@1 文本 codec，保留原契约错误及编解码错误链。'
    ),
    example: storageHostCases.jsonCodec![0]!.example,
    cases: storageHostCases.jsonCodec
  },
  structuredCodec: {
    role: 'operation',
    purpose: t(
      'Leave structured values to the actual record-capable backend clone operation; text-only fallback is rejected without lossy JSON conversion.',
      '把结构值交给具有记录能力的真实后端克隆，拒绝仅文本后端的回退，不进行有损 JSON 转换。'
    ),
    returns: t(
      'The frozen structured codec; encode and decode retain the input value, while the backend owns its clone.',
      '返回冻结的 structured codec；编码解码保留输入值，实际克隆归后端负责。'
    ),
    example:
      "import { structuredCodec } from '@migaia/storage-host/entity'\nconst input = new Map([['count', 2]])\nconsole.log((await structuredCodec.encode(input)) === input)"
  },
  binaryCodec: {
    role: 'operation',
    purpose: t(
      'Validate Uint8Array input while retaining its original view identity; storage writes own their byte snapshot and text routes explicitly use base64.',
      '验证 Uint8Array 输入并保留原视图身份，由存储写入负责字节快照，文本路径显式使用 base64。'
    ),
    returns: t(
      'The frozen binary codec, rejecting invalid encode/decode values with their original phase-specific error.',
      '返回冻结的 binary codec，非法编码或解码输入按原对应阶段错误拒绝。'
    ),
    example:
      "import { binaryCodec } from '@migaia/storage-host/entity'\nconst bytes = new Uint8Array([1, 2])\nconsole.log((await binaryCodec.decode(await binaryCodec.encode(bytes))) === bytes)"
  },
  selectCodec: {
    role: 'operation',
    purpose: t(
      'Choose a backend-compatible carrier from one captured codec and capability snapshot without inventing a structured-to-JSON fallback.',
      '从单次捕获的 codec 与能力快照选择兼容载体，不添加结构值到 JSON 的隐式回退。'
    ),
    params: {
      codec: t(
        'Caller codec descriptor with name, output, encode and decode captured by the canonical snapshot helper.',
        '调用方提供的 codec 描述，name、output、encode 与 decode 由规范快照工具捕获。'
      ),
      capabilities: t(
        'The actual admitted store.capabilities snapshot selecting native binary or structured support.',
        '真实已准入存储的 capabilities 快照，用于选择原生字节或结构值支持。'
      ),
      onDiagnostic: t(
        'Optional caller observer notified once when binary data needs text base64 wrapping; failures are reported without changing the route.',
        '可选调用方观察者，字节需要 base64 文本包装时通知一次；观察失败只报告，不改变路由。'
      )
    },
    returns: t(
      'An ISelectedCodec using the original methods or the explicit binary/text wrapper; unsupported structured routes reject.',
      '返回使用原方法或显式字节文本包装的 ISelectedCodec，不支持的结构路径会拒绝。'
    ),
    example:
      "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { binaryCodec, selectCodec } from '@migaia/storage-host/entity'\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst route = selectCodec(binaryCodec, host.backend('memory').capabilities)\nconsole.log(await route.decode(await route.encode(new Uint8Array([1, 2]))))"
  },
  passthrough: {
    role: 'factory',
    purpose: t(
      'Create a dependency-free default schema adapter that returns values unchanged; the generic type does not perform runtime validation.',
      '创建无外部依赖的默认 schema 适配器，原样返回值；泛型声明不会执行运行时校验。'
    ),
    returns: t(
      'An ISchemaAdapter with an asynchronous identity validator and no normalize, encode or decode conversion.',
      '返回带异步恒等验证器的 ISchemaAdapter，不包含规范化、编码或解码转换。'
    ),
    example:
      "import { passthrough } from '@migaia/storage-host/entity'\nconst schema = passthrough<{ name: string }>()\nconsole.log(await schema.validate({ name: 'Ada' }))"
  },
  fromStandardSchema: {
    role: 'factory',
    purpose: t(
      'Capture a real Standard Schema version-one protocol and convert its sync or async validation into the existing asynchronous entity schema boundary.',
      '捕获真实 Standard Schema 第一版协议，把同步或异步验证接入既有异步实体 schema 边界。'
    ),
    params: {
      schema: t(
        'Caller validator implementing ~standard with version:1, a nonempty vendor and validate returning value or issues.',
        '调用方验证器通过 ~standard 提供 version:1、非空 vendor，以及返回 value 或 issues 的 validate。'
      )
    },
    returns: t(
      'An ISchemaAdapter; invalid descriptors reject INVALID_CONFIG and validation failures retain their original cause under VALIDATION_FAILED.',
      '返回 ISchemaAdapter；非法描述以 INVALID_CONFIG 拒绝，验证失败以 VALIDATION_FAILED 保留原 cause。'
    ),
    example:
      "import { fromStandardSchema } from '@migaia/storage-host/entity'\nconst adapter = fromStandardSchema({ '~standard': { version: 1, vendor: 'example', validate: (value: unknown) => ({ value: String(value) }) } })\nconsole.log(await adapter.validate(42))"
  },
  REPOSITORY_KEY_PREFIX: {
    role: 'constant',
    purpose: t(
      'Identify the existing persisted repository record namespace shared by entity records and backend raw-record firewalls; applications should use logical entity keys.',
      '标识实体记录与后端原始记录防火墙共用的既有持久化命名空间，应用应继续使用实体逻辑键。'
    ),
    example:
      "import { REPOSITORY_KEY_PREFIX } from '@migaia/storage-host/entity'\nconsole.log(REPOSITORY_KEY_PREFIX)"
  },
  repositoryMigrationKey: {
    role: 'operation',
    purpose: t(
      'Derive the unchanged repository migration metadata key shared by the repository and the original raw-record firewall.',
      '派生仓储与原始记录防火墙共用的既有迁移元数据键，保持原持久化布局。'
    ),
    params: {
      entityName: t(
        'The nonempty entity namespace chosen by the application when calling defineEntity().',
        '应用调用 defineEntity() 时选择的非空实体命名空间。'
      )
    },
    returns: t(
      'The repository:<entityName>:migration metadata key without performing I/O.',
      '返回 repository:<entityName>:migration 元数据键，不执行读写。'
    ),
    example:
      "import { repositoryMigrationKey } from '@migaia/storage-host/entity'\nconsole.log(repositoryMigrationKey('users'))",
    cases: storageHostCases.repositoryMigrationKey
  }
}

/** Query state pages project the same canonical controls without promising unavailable methods. */
const narrowedEntityQueryMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(entityQueryControls).filter(([name]) => name !== 'index' && name !== 'range')
)
/** Selector ordering permits another selector but never an opaque comparator. */
const orderedEntityQueryMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(narrowedEntityQueryMembers).filter(([name]) => name !== 'orderByComparator')
)
/** A bounded comparator retains ordinary controls while sealing both ordering modes. */
const comparedEntityQueryMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(orderedEntityQueryMembers).filter(([name]) => name !== 'orderBy')
)

/**
 * Public entity types borrow canonical query/codec metadata and document only their own extra
 * surface.
 */
export const storageHostEntityTypes: NonNullable<ILibraryReference['types']> = {
  ICodec: storageContractReference.types!.ICodec!,
  ICodecOutput: storageContractReference.types!.ICodecOutput!,
  ISelectedCodec: entityType(
    'A backend-compatible codec route retaining only encode and decode authority.',
    '与后端兼容的 codec 路由，仅保留编码与解码能力。',
    {
      encode: storageContractReference.types!.ICodec!.members.encode!,
      decode: storageContractReference.types!.ICodec!.members.decode!
    }
  ),
  IEntityOptions: {
    ...entityType(
      'Captured entity schema, format and index configuration before a store is connected.',
      '连接存储之前捕获的实体 schema、格式与索引配置。',
      entityOptions
    ),
    optionCases: [entityConfiguration, entityIndexConfiguration]
  },
  IEntityDefinition: entityType(
    'Frozen reusable entity definition that borrows one actual store when connected.',
    '冻结且可复用的实体定义，连接时借用一个真实存储。',
    {
      name: field('Captured application entity namespace.', '已捕获的应用实体命名空间。'),
      version: field(
        'Captured positive persisted envelope version.',
        '已捕获的持久化封装正整数版本。'
      ),
      connect: {
        summary: t(
          'Connect the immutable definition to one authentic admitted store without taking its disposal authority.',
          '把不可变定义连接到真实已准入存储，不接管其资源释放权限。'
        ),
        params: {
          store: t(
            'The actual admitted IKeyValueStore or certified borrowed host view, preserving exact query Feature types.',
            '真实已准入 IKeyValueStore 或认证的宿主借用视图，保留精确查询 Feature 类型。'
          ),
          options: t(
            'Optional caller codecStages and queryStages observers from the original host; omitted adds no observer.',
            '来自原宿主的可选 codecStages 与 queryStages 观察端口，省略时不添加观察者。'
          )
        },
        returns: t(
          'An IRepository tied to this exact store, entity namespace and inferred index/Feature types.',
          '返回绑定该准确存储、实体命名空间及推导索引和 Feature 类型的 IRepository。'
        ),
        example: 'const repo = definition.connect(store)'
      }
    }
  ),
  IEntityConnectOptions: entityType(
    'Optional borrowed codec and query observation ports, without owning the host.',
    '可选的 codec 与查询观察端口，只借用能力，不持有宿主。',
    {
      codecStages: {
        ...field(
          'Original installed host codec-stage observer forwarded by entity materialization.',
          '原已安装宿主的 codec 阶段观察者，由实体物化过程转发。'
        ),
        default: t('Omitted: no explicit codec observer.', '省略时不显式添加 codec 观察者。')
      },
      queryStages: {
        ...field(
          'Original installed host query-stage observer forwarded by shared query execution.',
          '原已安装宿主的查询阶段观察者，由共享查询执行过程转发。'
        ),
        default: t('Omitted: no explicit query observer.', '省略时不显式添加查询观察者。')
      }
    }
  ),
  IEntityConnectStore: entityType(
    'An authentic raw KV store or certified borrowed host view; only the original owner may dispose it.',
    '真实原始键值存储或认证宿主借用视图，仅原拥有者可以释放资源。',
    {
      has: {
        summary: t(
          'Check the exact original capability token against the connected store’s capability map.',
          '按原令牌身份检查所连接存储的原能力表。'
        ),
        params: {
          capability: t(
            'The standard or installed Feature capability token imported from its canonical owner.',
            '从规范拥有者导入的标准能力令牌或已安装 Feature 能力令牌。'
          )
        },
        returns: t(
          'True only when the original store provides this exact token identity.',
          '仅当原存储提供该准确令牌身份时返回 true。'
        ),
        example: 'const supported = store.has(records)'
      },
      use: {
        summary: t(
          'Borrow the implementation for an exact capability token without gaining registration or close authority.',
          '借用准确能力令牌的实现，不取得登记能力或关闭权限。'
        ),
        params: {
          capability: t(
            'The standard or installed Feature capability token imported from its canonical owner.',
            '从规范拥有者导入的标准能力令牌或已安装 Feature 能力令牌。'
          )
        },
        returns: t(
          'The original capability API; unsupported tokens reject with UNSUPPORTED_CAPABILITY.',
          '返回原能力 API，不支持的令牌以 UNSUPPORTED_CAPABILITY 拒绝。'
        ),
        example: 'const api = store.use(records)'
      }
    }
  ),
  IRepository: entityType(
    'Entity-specific read, write, migration and transaction binding over one connected store.',
    '建立在同一连接存储上的实体读写、迁移与原事务绑定视图。',
    repositoryMembers
  ),
  IEntityTransactionScope: entityType(
    'Entity operations borrowing one live original transaction; no per-method operation context is accepted.',
    '借用同一活跃原事务的实体操作，每个方法不另行接收操作上下文。',
    {
      query: repositoryMembers.query!,
      get: { ...repositoryMembers.get!, params: { id } },
      put: { ...repositoryMembers.put!, params: { value: repositoryMembers.put!.params!.value! } },
      remove: { ...repositoryMembers.remove!, params: { id } },
      list: {
        ...repositoryMembers.list!,
        params: { options: repositoryMembers.list!.params!.options! }
      }
    }
  ),
  IEntityQuery: entityType(
    'Entity source selection followed by canonical record-query execution and exact Feature augmentation.',
    '先选择实体数据源，再执行规范记录查询并保留精确 Feature 增强。',
    entityQueryControls
  ),
  IEntityQueryAccess: entityType(
    'Expose the entity query factory with native watch only for a literal true change feed on a root operation context; scoped transaction views have no watch.',
    '提供实体查询工厂，仅在原生变更流为字面量 true 且使用根操作上下文时提供 watch；事务作用域视图不提供 watch。',
    { query: repositoryMembers.query! }
  ),
  IEntityQueryNarrowed: entityType(
    'A chosen source or later query branch retaining canonical terminals, invalid-row handling and exact Feature methods.',
    '已选择来源或经过后续控制的查询分支，保留规范终点、无效行处理与精确 Feature 方法。',
    narrowedEntityQueryMembers
  ),
  IEntityQueryNarrowedCore: entityType(
    'Recursive entity branch controls reusing the shared condition domain; source selection is no longer available.',
    '复用共享条件域的递归实体分支控制，已不能再次选择来源。',
    narrowedEntityQueryMembers
  ),
  IEntityQueryOrdered: entityType(
    'Selector-ordered entity branch preserving Feature methods; more selectors are allowed, opaque comparison is unavailable.',
    '按选择器排序的实体分支，保留 Feature 方法，可追加选择器，不提供不透明比较排序。',
    orderedEntityQueryMembers
  ),
  IEntityQueryOrderedCore: entityType(
    'Recursive selector-order controls before exact Feature augmentation, sharing the original query executor.',
    '精确 Feature 增强前的递归选择器排序控制，共用原查询执行器。',
    orderedEntityQueryMembers
  ),
  IEntityQueryCompared: entityType(
    'A comparator branch after its finite bound is declared; reads and ordinary controls remain, another order is unavailable.',
    '已声明有限边界的比较器分支，保留读取与普通控制，不能再次登记排序。',
    comparedEntityQueryMembers
  ),
  IEntityQueryComparedCore: entityType(
    'Recursive bounded-comparator controls before Feature augmentation, with no second ordering mode.',
    'Feature 增强前的递归有界比较器控制，不提供第二种排序模式。',
    comparedEntityQueryMembers
  ),
  IEntityQueryNeedsLimit: entityType(
    'An unbounded comparator has only limit and first; first uses the original one-candidate bound.',
    '尚未限定范围的比较器仅提供 limit 与 first；first 使用原容量一边界。',
    { limit: entityQueryControls.limit!, first: entityQueryControls.first! }
  ),
  IEntityQueryFinal: entityType(
    'The original terminal-only query result after projection, retaining its exact awaited output and original Feature augmentation.',
    '投影后的原终点查询结果，保留精确等待结果类型与原 Feature 增强。',
    storageContractReference.types!.IQueryResult!.members
  ),
  IEntityStoreQueryMethods: entityType(
    'Infer only the connected store’s actual query Feature methods without inventing extra capabilities.',
    '仅推导已连接存储真实提供的查询 Feature 方法，不虚构额外能力。',
    {}
  ),
  IEntityIndexMap: entityType(
    'Compile-time map correlating exact index names with path or selector projection key types.',
    '在编译期把准确索引名与路径或选择器投影键类型关联的映射。',
    {}
  ),
  IEntityListOrder: entityType(
    'Canonical source order may be unbounded; an opaque comparator requires an explicit finite result cap.',
    '规范来源顺序可不设上限，不透明比较器则必须声明有限结果边界。',
    { orderBy: listOptions.orderBy!, limit: listOptions.limit! }
  ),
  IListOptions: entityType(
    'Primary-key entity source, traversal direction, invalid-row policy and correlated bounded comparator controls.',
    '按实体主键选择来源、遍历方向、无效记录策略及有关联的有界比较器控制。',
    {
      ...listOptions,
      index: {
        ...field(
          'Unavailable in primary-key IListOptions; use the correlated IIndexedListOptions union to select an index.',
          '普通主键 IListOptions 不接受此字段，选择索引时使用类型关联的 IIndexedListOptions。'
        ),
        default: t(
          'Omitted: this is the primary-key list form.',
          '必须省略，当前形式是主键列表配置。'
        )
      }
    }
  ),
  IIndexedListOptions: entityType(
    'Exact secondary-index name correlated with its projected range type and ordinary list controls.',
    '准确次级索引名与其投影范围类型及普通列表控制保持关联。',
    {
      ...listOptions,
      index: field(
        'Required exact declared index name, correlated with the range key type.',
        '必填的准确索引名称，须已声明且与范围键类型保持关联。'
      )
    }
  ),
  IEntityIndexOptions: entityType(
    'Declared-index list controls excluding the separately supplied index key range.',
    '用于已声明索引的列表控制，键范围由独立参数提供。',
    {
      direction: listOptions.direction!,
      onInvalid: listOptions.onInvalid!,
      orderBy: listOptions.orderBy!,
      limit: listOptions.limit!,
      index: {
        ...field(
          'Unavailable here because the index name is supplied separately to the repository method.',
          '当前配置不接受此字段，索引名由仓储方法的独立参数提供。'
        ),
        default: t('Omitted: use the separate index argument.', '必须省略，改由独立索引参数提供。')
      }
    }
  ),
  IEntityIndex: entityType(
    'One path, composite paths or explicit selector producing single or multiple canonical index keys.',
    '通过单路径、组合路径或显式选择器，生成单个或多个规范索引键。',
    {
      path: field(
        'Caller domain property path for one projected key.',
        '调用方指定的领域属性路径，用于生成单个投影键。'
      ),
      paths: field(
        'Caller ordered domain path tuple producing a composite array key.',
        '调用方指定的有序领域路径元组，用于生成组合数组键。'
      ),
      select: {
        summary: t(
          'Synchronously project the domain value to a single key, multiple keys or undefined to omit it.',
          '同步把领域值投影为单键、多键或 undefined，后者表示不建立索引项。'
        ),
        params: {
          value: t(
            'The materialized domain record captured by the authoritative entity write or backfill.',
            '由真实实体写入或索引补录过程捕获的已物化领域记录。'
          )
        },
        returns: t(
          'A single/multiple tagged key projection, or undefined to skip this record.',
          '返回 single 或 multiple 标签的键投影，或以 undefined 跳过当前记录。'
        ),
        example:
          "const projection = { select: (value: { status: string }) => ({ kind: 'single' as const, key: value.status }), revision: 1 }"
      },
      unique: {
        ...field(
          'Reject a conflicting projected key inside the authoritative transaction or atomic write port.',
          '在真实事务或原子写端口中，拒绝与已有投影键发生冲突的写入。'
        ),
        default: t('false: duplicate index keys are allowed.', '默认 false，允许重复索引键。')
      },
      multiEntry: {
        ...field(
          'Project array elements separately for a single path; unavailable for composite paths.',
          '对单一路径的数组元素分别建立索引，组合路径不支持该模式。'
        ),
        default: t(
          'false: one path value is one index key.',
          '默认 false，把完整路径值作为一个索引键。'
        )
      },
      revision: {
        ...field(
          'Positive projection revision; a custom select function must supply it explicitly.',
          '投影修订号须为正整数，自定义 select 函数必须显式提供。'
        ),
        default: t(
          '1 for path/paths; custom select has no default.',
          'path 与 paths 默认一；自定义 select 没有默认值。'
        )
      }
    }
  ),
  IInvalidRecordAction: entityType(
    'A skip or throw decision for one failed persisted record, without implicit repair.',
    '针对失败持久化记录选择 skip 或 throw，不隐式修复数据。',
    {}
  ),
  IInvalidRecordHandler: entityType(
    'Synchronous caller callback selecting skip or throw from the original invalid-record issue.',
    '根据原无效记录问题同步选择 skip 或 throw 的调用方回调。',
    {}
  ),
  IInvalidRecordIssue: entityType(
    'One original decode, migrate or validate failure and the associated logical entity key.',
    '一次原始解码、迁移或校验失败，以及对应实体逻辑键。',
    {
      key: field(
        'Original logical entity key associated with this failed record.',
        '与当前失败记录关联的原始实体逻辑键。'
      ),
      raw: field(
        'Actual stored representation inspected before materialization failed.',
        '物化失败之前实际检查的存储表示。'
      ),
      record: field(
        'Materialized domain record when available before the failing stage.',
        '失败阶段之前已经物化的领域记录，如尚未得到则缺失。'
      ),
      stage: {
        ...field(
          'The actual materialization stage that failed, preserving where the original cause arose.',
          '实际发生失败的物化阶段，保留原始错误产生的位置。'
        ),
        values: {
          decode: t('Codec decoding failed.', '编解码器解码阶段失败。'),
          migrate: t('Envelope migration failed.', '版本封装迁移阶段失败。'),
          validate: t('Schema validation failed.', '领域 schema 校验阶段失败。')
        }
      },
      cause: field(
        'Original failure value retained for diagnostic inspection.',
        '保留用于诊断检查的原始失败值。'
      )
    }
  ),
  IMigrateOptions: entityType(
    'Explicit persisted-envelope upgrade batching and invalid-record policy.',
    '显式持久化封装升级的批次配置与无效记录策略。',
    {
      batchSize: {
        ...field(
          'Positive safe-integer maximum records in one persistence batch.',
          '一次持久化批次最多处理的记录数，须为正安全整数。'
        ),
        default: t('100 records per batch.', '每批默认处理一百条记录。')
      },
      onInvalid: listOptions.onInvalid!
    }
  ),
  IMigrateResult: entityType(
    'Actual progress from explicit migration, separating already-current, skipped and conflicted records.',
    '显式迁移的实际进度，分别记录已是当前版本、跳过及冲突记录。',
    {
      scanned: field(
        'Physical candidate records examined by the migration scan.',
        '迁移扫描实际检查的物理候选记录数。'
      ),
      eligible: field(
        'Candidates admitted for this specific entity migration.',
        '被当前实体迁移实际接纳的候选记录数。'
      ),
      migrated: field(
        'Upgraded entity envelopes whose persistence actually committed.',
        '已真正提交持久化的升级实体封装数量。'
      ),
      skipped: field(
        'Invalid records omitted by the selected invalid-row policy.',
        '按所选无效记录策略跳过的错误记录数。'
      ),
      alreadyCurrent: field(
        'Observed records already at the configured target version.',
        '观察时已处于配置目标版本的记录数。'
      ),
      conflicted: field(
        'Records still conflicting after the original per-record retry path.',
        '经过原逐条重试路径后仍存在冲突的记录数。'
      )
    }
  ),
  IRecordComparator: entityType(
    'Synchronous domain-row comparison returning a finite negative, zero or positive number.',
    '同步领域记录比较函数，以有限负数、零或正数表示顺序。',
    {}
  ),
  ISchemaAdapter: entityType(
    'Neutral async validation and optional normalization/domain-storage conversion before the codec carrier.',
    '在 codec 载体之前执行中立异步校验，以及可选规范化和领域存储转换。',
    {
      name: field(
        'Stable caller adapter label identifying the schema conversion boundary.',
        '调用方提供的稳定适配器标签，标识 schema 转换边界。'
      ),
      validate: {
        summary: t(
          'Validate an unknown value and produce the accepted domain object.',
          '校验未知输入值，并产出已被接受的领域对象。'
        ),
        params: {
          value: t(
            'Caller or persisted unknown input requiring domain validation.',
            '来自调用方或持久化读取、需要领域校验的未知输入。'
          ),
          ctx
        },
        returns: t(
          'A promise of the validated domain value, or the original schema failure.',
          '返回校验后领域值的承诺，失败时保留原 schema 错误。'
        ),
        example: 'const value = await schema.validate({ name: "Ada" })'
      },
      normalize: {
        summary: t(
          'Optionally normalize a validated domain value before schema encoding and codec encoding.',
          '可选地在 schema 与 codec 编码之前，规范化已校验的领域值。'
        ),
        params: {
          value: t(
            'The already validated domain value from this write operation.',
            '来自当前写入操作、已经通过校验的领域值。'
          ),
          ctx
        },
        returns: t(
          'A promise of the normalized domain value; omission preserves the validated input.',
          '返回规范化领域值的承诺，省略该方法时保留已校验输入。'
        ),
        example: 'const normalized = schema.normalize ? await schema.normalize(value) : value'
      },
      encode: {
        summary: t(
          'Optionally convert the domain representation to the stored schema shape before the codec.',
          '可选地在 codec 编码之前，把领域表示转换为 schema 存储形状。'
        ),
        params: {
          value: t(
            'Validated and optionally normalized domain value supplied by this write.',
            '由当前写入提供、已校验且可能已规范化的领域值。'
          ),
          ctx
        },
        returns: t(
          'A promise of the schema storage shape; omission leaves the value unchanged.',
          '返回 schema 存储形状的承诺，省略时保持输入不变。'
        ),
        example: 'const stored = schema.encode ? await schema.encode(value) : value'
      },
      decode: {
        summary: t(
          'Optionally restore the domain representation after codec decoding and before read validation.',
          '可选地在 codec 解码之后、读取校验之前恢复领域表示。'
        ),
        params: {
          raw: t(
            'The stored schema shape returned by the codec decoder.',
            '由 codec 解码器返回的 schema 存储形状。'
          ),
          ctx
        },
        returns: t(
          'A promise of the domain value; omission leaves the decoded representation unchanged.',
          '返回领域值的承诺，省略时保留已解码表示。'
        ),
        example: 'const value = schema.decode ? await schema.decode(raw) : raw'
      }
    }
  ),
  IStandardSchemaV1: entityType(
    'The captured version-one ~standard validator descriptor, without a dependency on a schema library.',
    '捕获第一版 ~standard 验证描述，不引入任何特定 schema 库依赖。',
    {
      '~standard': field(
        'Caller descriptor with version exactly 1, nonempty vendor and validate producing a value or issues synchronously or asynchronously.',
        '调用方描述须包含固定第一版、非空 vendor，以及同步或异步返回 value 或 issues 的 validate。'
      )
    }
  )
}
