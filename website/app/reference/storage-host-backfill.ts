import type { ILibraryReference, IText } from './contract.js'

/** Both locales describe the existing native backfill protocol, without adding an owner. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Applications trigger the original registered provider through the public entity repository. */
const entityBackfillExample = `import { createStorageHost } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

type IUser = { id: string; email: string }
await using host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'backfill-reference' })]
})
const store = host.backend('indexed-db')
const baseline = defineEntity<IUser>({ name: 'users', key: 'id' }).connect(store)
await baseline.put({ id: 'ada', email: 'ada@example.com' })
await baseline.migrate()
const users = defineEntity<IUser>()({
  name: 'users', key: 'id', indexes: { email: { path: 'email', unique: true } }
}).connect(store)
console.log(await users.query().index('email', 'ada@example.com').all())
const handle = await store.ensureRecordIndexes('users', [
  { name: 'email', unique: true, multiEntry: false, revision: 1 }
])
console.log((await store.getRecordIndexReadiness(handle)).status)`

/** Backend authors register their captured provider; this example supplies no fabricated store. */
const registerExample = `import {
  registerRecordIndexBackfillStore, type IRecordIndexBackfillStore
} from '@migaia/storage-host/entity'
function publishNativeBackfill(
  backend: object,
  capability: IRecordIndexBackfillStore<unknown>
) {
  registerRecordIndexBackfillStore(backend, capability)
}`

/** Inspection borrows a real provider session and always releases that exact session. */
const sessionExample = `import type {
  IRecordIndexBackfillStore
} from '@migaia/storage-host/entity'
import type { IKeyRange, IRecordIndexHandle } from '@migaia/storage-contract'
async function inspectNativeBatch(
  provider: IRecordIndexBackfillStore<unknown>,
  handle: IRecordIndexHandle,
  range: IKeyRange
) {
  const session = await provider.openBackfillSession(handle, { range, allowComplete: false })
  try {
    await session.renew()
    const page = await session.readBatch()
    console.log(page.candidates.map(candidate => candidate.key))
  } finally {
    session.release()
  }
}`

/** Entity-owned preparation stays outside the original IndexedDB transaction. */
const prepareExample = `import type {
  IRecordIndexBackfillReadOptions, IRecordIndexBackfillSession
} from '@migaia/storage-host/entity'
async function readPreparedBatch(
  session: IRecordIndexBackfillSession<unknown>,
  prepare: NonNullable<IRecordIndexBackfillReadOptions<unknown>['prepare']>
) {
  await session.renew()
  return session.readBatch(undefined, { prepare })
}`

/** The original entity owner has already prepared the batch and its exact expected revisions. */
const commitExample = `import type {
  IRecordIndexBackfillBatch, IRecordIndexBackfillSession
} from '@migaia/storage-host/entity'
async function commitPreparedBatch(
  session: IRecordIndexBackfillSession<unknown>,
  batch: IRecordIndexBackfillBatch
) {
  await session.renew()
  return session.commitBatch(batch)
}`

/** Failure persistence remains a native session call, with the original cause passed unchanged. */
const failExample = `import type { IRecordIndexBackfillSession } from '@migaia/storage-host/entity'
async function persistNativeFailure(
  session: IRecordIndexBackfillSession<unknown>,
  cause: unknown
) {
  await session.fail(cause)
}`

/** The same existing backend factory owns physical index preparation and declaration. */
const ensureExample = `import type { IRecordIndexBackfillStore } from '@migaia/storage-host/entity'
async function declareNativeIndex(provider: IRecordIndexBackfillStore<unknown>) {
  await provider.prepare?.()
  const handle = await provider.ensureRecordIndexes('users', [
    { name: 'email', unique: true, multiEntry: false, revision: 1 }
  ])
  return provider.getRecordIndexReadiness(handle)
}`

/** Every operation reuses the caller's context and its original backend cancellation budget. */
const context = t(
  'Optional IOperationContext supplied by the entity call or native author. Its signal and deadline stay with the original backend operation.',
  '实体调用或原生作者传入的可选 IOperationContext，信号与期限沿原后端操作处理。'
)

/** Runtime symbols are merged by the existing storage-host reference owner. */
export const storageHostBackfillSymbols: ILibraryReference['symbols'] = {
  registerRecordIndexBackfillStore: {
    role: 'operation',
    purpose: t(
      'Associate the original constructed backend object with its captured native backfill provider. Entity orchestration reads the same private association; registration neither invokes provider methods nor changes public capabilities.',
      '将原构造后端对象与已捕获的原生回填接口关联，实体编排读取同一私有关联；登记不调用接口方法，也不改变公开能力。'
    ),
    params: {
      backend: t(
        'Exact backend object constructed by its original factory; later entity connections use that same identity.',
        '原工厂构造的精确后端对象，后续实体连接使用同一对象身份。'
      ),
      capability: t(
        'Existing IRecordIndexBackfillStore implementation whose own native transactions, sessions and cleanup remain with the backend.',
        '既有 IRecordIndexBackfillStore 实现，其原生事务、会话与清理仍由后端持有。'
      )
    },
    returns: t(
      'No result. Invalid primitive backend identities throw INVALID_CONFIG; successful registration grants no transaction or disposal authority.',
      '无返回结果，原始类型后端身份会抛 INVALID_CONFIG；成功登记不授予事务或释放权限。'
    ),
    example: registerExample
  },
  markRecordIndexBackfillContentionFailure: {
    role: 'operation',
    purpose: t(
      'Mark the exact existing coded native lease/readiness contention error as eligible for the entity owner’s authoritative-scan fallback. Projection, decoding and integrity failures must retain their ordinary failure paths.',
      '将现有已编码的原生租约或就绪争用错误标为可沿实体拥有者的权威扫描回退，投影、解码与完整性失败继续走原失败路径。'
    ),
    params: {
      error: t(
        'Original coded error object from the native contention branch. Frozen objects are accepted and the same object is retained without mutation.',
        '来自原生争用分支的原已编码错误对象，可接受冻结对象，保留同一对象而不修改。'
      )
    },
    returns: t(
      'No result. The original error identity is marked privately; a primitive input throws INVALID_CONFIG.',
      '无返回结果，只在私有记录中标记原错身份；原始类型输入抛 INVALID_CONFIG。'
    ),
    example: `import { markRecordIndexBackfillContentionFailure } from '@migaia/storage-host/entity'
function rejectKnownNativeContention(originalError: Error): never {
  markRecordIndexBackfillContentionFailure(originalError)
  throw originalError
}`
  },
  RecordIndexBackfillPhase: {
    role: 'constant',
    purpose: t(
      'Name the persisted canonical and legacy scan phases used by the original native backfill metadata. Canonical entity records take precedence over legacy-shaped shadows.',
      '命名原生回填元数据持久化使用的规范与旧式扫描阶段，规范实体记录优先于旧式形状的影子记录。'
    ),
    example: `import { RecordIndexBackfillPhase } from '@migaia/storage-host/entity'
const phase = RecordIndexBackfillPhase.canonical`
  }
}

/** Protocol types retain the original backend's generation, lease, checkpoint and revision facts. */
export const storageHostBackfillTypes: ILibraryReference['types'] = {
  IRecordIndexBackfillPhase: {
    summary: t(
      'Persisted phase value from RecordIndexBackfillPhase; omission on compatible batches follows the canonical phase.',
      '来自 RecordIndexBackfillPhase 的持久化阶段值，兼容批次省略阶段时按规范阶段处理。'
    ),
    members: {}
  },
  IRecordIndexBackfillCandidate: {
    summary: t(
      'One native scan candidate with its captured raw value and revision, before entity-owned decoding or projection.',
      '原生扫描捕获的一条原值与修订候选，尚未进行实体拥有的解码或投影。'
    ),
    members: {
      key: {
        summary: t(
          'Logical record key returned by this native scan; preserve it exactly for the prepared projection.',
          '本次原生扫描返回的逻辑记录键，准备投影时保留其精确值。'
        )
      },
      raw: {
        summary: t(
          'Native stored value captured in the same read snapshot; the entity codec owns decoding.',
          '同一读取快照捕获的原生存储值，解码归实体编码器处理。'
        )
      },
      revision: {
        summary: t(
          'Native revision captured with raw and copied to expectedRevision for commit-time rechecking.',
          '随原值捕获的原生修订，复制到 expectedRevision 供提交时复核。'
        )
      },
      phase: {
        summary: t(
          'Optional scan phase supplied by the native batch; legacy candidates require legacy ownership checks.',
          '原生批次提供的可选扫描阶段，旧式候选须执行对应的旧键归属检查。'
        ),
        values: { enum: 'RecordIndexBackfillPhase' }
      }
    }
  },
  IRecordIndexBackfillPreparation: {
    summary: t(
      'Entity-owned preparation for one candidate, carrying the decoded byte estimate and actual index projection outcome.',
      '实体拥有的单候选准备结果，包含解码字节估量与实际索引投影结果。'
    ),
    members: {
      decodedBytes: {
        summary: t(
          'Measured decoded payload bytes used by the original reader to enforce its soft batch bound.',
          '解码负载的测量字节量，供原读取器执行批次软字节上限。'
        )
      },
      projection: {
        summary: t(
          'Optional projection from the original entity index projector; omitted projection writes no index entries.',
          '原实体索引投影器给出的可选投影，省略时不写入索引项。'
        )
      },
      outcome: {
        summary: t(
          'Whether this candidate produced a usable index projection or was intentionally skipped.',
          '标明本候选产生可用索引投影，还是应按原规则跳过。'
        ),
        values: {
          indexed: t('Apply the supplied usable index projection.', '应用已提供且可用的索引投影。'),
          skipped: t(
            'Keep scanning without index entries for this candidate.',
            '继续扫描，但不为本候选写入索引项。'
          )
        }
      },
      counted: {
        summary: t(
          'False only for physically scanned rows outside the entity scope; omitted means include it in scanned counts.',
          '只有物理扫描但不属于该实体的行设为 false，省略时计入已扫描数量。'
        )
      }
    }
  },
  IRecordIndexBackfillReadOptions: {
    summary: t(
      'Optional entity preparation callback executed outside the original IndexedDB transaction and awaited for each candidate.',
      '在原 IndexedDB 事务之外逐候选等待执行的可选实体准备回调。'
    ),
    members: {
      prepare: {
        summary: t(
          'Decode and project one captured candidate through the existing entity owners before native batch commitment.',
          '原生批次提交前，沿既有实体拥有者解码并投影已捕获候选。'
        ),
        params: {
          candidate: t(
            'Original IRecordIndexBackfillCandidate returned by the same session read.',
            '同一会话读取返回的原 IRecordIndexBackfillCandidate。'
          )
        },
        returns: t(
          'Promise of decodedBytes, optional projection, indexed/skipped outcome and optional counted flag. A failure rejects preparation; it is not a successful skip.',
          '返回字节量、可选投影、索引或跳过结果及可选计数标志的承诺；准备失败会拒绝，不会变成成功跳过。'
        ),
        default: t(
          'Omitted: return raw candidates without entity preparation.',
          '省略时返回原始候选，不进行实体准备。'
        ),
        whenToUse: t(
          'Use the existing entity decoder/projector when raw stored values require materialization.',
          '原始存储值需要物化时，传入既有实体解码与投影函数。'
        ),
        example: prepareExample
      }
    }
  },
  IRecordIndexBackfillProjection: {
    summary: t(
      'Prepared write intent for one original candidate, including the exact native revision required at atomic batch commit.',
      '原候选的已准备写意图，包含原子批次提交时必须复核的精确原生修订。'
    ),
    members: {
      key: {
        summary: t(
          'Original candidate key, preserved for revision and sidecar checks.',
          '原候选键，原样用于修订与索引旁表复核。'
        )
      },
      expectedRevision: {
        summary: t(
          'The candidate revision captured by readBatch, never a revision invented by a projector.',
          'readBatch 捕获的候选修订，投影器不能自行生成替代修订。'
        )
      },
      projection: {
        summary: t(
          'Optional original entity index projection; no projection means no replacement index entries.',
          '可选原实体索引投影，缺失时不产生替换索引项。'
        )
      },
      outcome: {
        summary: t(
          'Apply a prepared projection or record that this candidate was skipped.',
          '应用已准备投影，或记录本候选已按原规则跳过。'
        ),
        values: {
          indexed: t('Apply the supplied usable index projection.', '应用已提供且可用的索引投影。'),
          skipped: t(
            'Keep scanning without index entries for this candidate.',
            '继续扫描，但不为本候选写入索引项。'
          )
        }
      },
      counted: {
        summary: t(
          'False excludes an out-of-scope physical row from scanned counts; omission includes it.',
          'false 将范围外物理行排除于扫描数量，省略时计入。'
        )
      }
    }
  },
  IRecordIndexBackfillBatch: {
    summary: t(
      'One prepared batch tied to the original session generation, lease owner and checkpoint, for one native atomic commit.',
      '绑定原会话代次、租约拥有者和检查点的单个准备批次，由一次原生原子提交处理。'
    ),
    example: commitExample,
    members: {
      phase: {
        summary: t(
          'Phase returned by the matching readBatch; omitted compatible batches use canonical.',
          '对应 readBatch 返回的阶段，兼容批次省略时使用规范阶段。'
        ),
        values: { enum: 'RecordIndexBackfillPhase' }
      },
      generation: {
        summary: t(
          'Exact generation from the original session and index handle, checked before sidecar writes.',
          '来自原会话与索引句柄的精确代次，在索引旁表写入前复核。'
        )
      },
      ownerToken: {
        summary: t(
          'Native lease owner token returned by openBackfillSession; copy it unchanged from that session.',
          '来自 openBackfillSession 的原生租约拥有者令牌，须从该会话原样复制。'
        )
      },
      checkpoint: {
        summary: t(
          'The readBatch starting checkpoint, including explicit undefined for a phase beginning.',
          'readBatch 的起始检查点，阶段开始时显式为 undefined。'
        )
      },
      nextCheckpoint: {
        summary: t(
          'Last candidate key from the same batch, or undefined for an empty page.',
          '同一批次的末候选键，空页时为 undefined。'
        )
      },
      endOfScan: {
        summary: t(
          'Native read indication that the phase ended; commit rechecks the remaining suffix before completion.',
          '原生读取表明当前阶段结束，提交仍会在完成前复核剩余后缀。'
        )
      },
      projections: {
        summary: t(
          'Prepared candidate intents in the original batch order, each retaining its expected revision.',
          '按原批次顺序排列的已准备候选意图，各自保留预期修订。'
        )
      }
    }
  },
  IRecordIndexBackfillRetryReceipt: {
    summary: t(
      'Backend-persisted receipt allowing one exact batch retry while its original owner heartbeat is still current.',
      '由后端持久化的回执，仅在原拥有者心跳仍有效时允许精确批次重试。'
    ),
    members: {
      ownerToken: {
        summary: t(
          'Lease identity issued by the original openBackfillSession, not a caller-created retry token.',
          '原 openBackfillSession 签发的租约身份，调用方不能创建替代重试令牌。'
        )
      },
      heartbeatRevision: {
        summary: t(
          'Native heartbeat revision captured at commit; a successor lease invalidates the receipt.',
          '提交时捕获的原生心跳修订，后继租约会使回执失效。'
        )
      },
      batchIdentity: {
        summary: t(
          'Native persisted identity of that exact accepted batch, used by the original retry check.',
          '该精确已接纳批次的原生持久化身份，供原重试检查使用。'
        )
      }
    }
  },
  IRecordIndexBackfillSession: {
    summary: t(
      'Borrowed native lease session retaining generation, heartbeat, issued batches and checkpoint ownership in the original backend.',
      '借用的原生租约会话，其代次、心跳、已发批次和检查点归属均留在原后端。'
    ),
    scenarios: [
      t(
        'Inspect or drive the same original native provider session from backend-owned orchestration.',
        '由后端拥有的编排检查或驱动同一个原生接口会话。'
      )
    ],
    example: sessionExample,
    members: {
      generation: {
        summary: t(
          'Index generation issued by ensureRecordIndexes and retained by this session.',
          'ensureRecordIndexes 签发并由当前会话保留的索引代次。'
        )
      },
      ownerToken: {
        summary: t(
          'Lease token issued by the native openBackfillSession call and retained for heartbeat/commit checks.',
          '原生 openBackfillSession 调用签发的租约令牌，供心跳与提交复核保留。'
        )
      },
      renew: {
        summary: t(
          'Renew the original native lease without replacing its owner identity.',
          '续约原生租约，保留同一个拥有者身份。'
        ),
        params: { ctx: context },
        returns: t(
          'Settles after native heartbeat persistence; stale ownership or cancellation rejects.',
          '原生心跳持久化后结算，拥有权失效或取消会拒绝。'
        ),
        example: sessionExample
      },
      readBatch: {
        summary: t(
          'Read the next bounded native page and optionally await entity preparation outside the IDB transaction.',
          '读取下一有界原生页，并可在 IDB 事务外等待实体准备。'
        ),
        params: {
          ctx: context,
          options: t(
            'Optional original prepare callback; omitted returns candidates without preparations.',
            '可选原准备回调，省略时只返回候选而不返回准备结果。'
          )
        },
        returns: t(
          'Original phase/checkpoint/endOfScan plus candidate rows and optional aligned preparations; this read does not commit projections.',
          '返回原阶段、检查点、结束标志、候选行及可选对齐准备结果；读取本身不提交投影。'
        ),
        example: prepareExample
      },
      commitBatch: {
        summary: t(
          'Atomically recheck the issued batch, current lease and candidate revisions before writing projections and checkpoint.',
          '写入投影与检查点前，原子复核已发批次、当前租约和候选修订。'
        ),
        params: {
          batch: t(
            'Prepared IRecordIndexBackfillBatch from this session’s matching read; preserve its identity facts.',
            '来自本会话对应读取的准备批次，保留其身份事实。'
          ),
          ctx: context
        },
        returns: t(
          'Native readiness after confirmed commit; stale rows, foreign ownership or invalid batches reject without claiming completion.',
          '确认提交后的原生就绪结果；陈旧记录、异主或无效批次会拒绝，不宣称完成。'
        ),
        example: commitExample
      },
      fail: {
        summary: t(
          'Persist failure of the current native backfill generation through its original owner.',
          '经原拥有者持久化当前原生回填代次的失败。'
        ),
        params: {
          cause: t(
            'Original preparation or commit error, passed unchanged for native failure persistence.',
            '原准备或提交错误，原样传入供原生持久化失败使用。'
          ),
          ctx: context
        },
        returns: t(
          'Settles after the native failure record; the caller must retain a persistence rejection alongside its original cause.',
          '原生失败记录完成后结算，调用方须将持久化拒绝与原始原因一并保留。'
        ),
        example: failExample
      },
      release: {
        summary: t(
          'Immediately invalidate this borrowed session’s local authority; pending work remains in the original backend lifetime.',
          '立即使本借用会话的本地权限失效，在途工作仍沿原后端生命周期处理。'
        ),
        returns: t(
          'No result; the original backend retains persistent lease expiry and native resource ownership.',
          '无返回结果，持久租约到期与原生资源所有权仍由原后端持有。'
        ),
        example: sessionExample
      }
    }
  },
  IRecordIndexBackfillStore: {
    summary: t(
      'Original backend-owned index provider, captured during construction and registered for the same entity orchestration.',
      '原后端拥有的索引接口，在构造时捕获并登记，供同一实体编排使用。'
    ),
    scenarios: [
      t(
        'Use the entity query to trigger the registered native index backfill.',
        '通过实体查询触发已登记原生索引回填。'
      )
    ],
    example: entityBackfillExample,
    members: {
      prepare: {
        summary: t(
          'Optionally prepare the fixed native physical layout without publishing another capability.',
          '可选准备固定原生物理布局，不发布额外能力。'
        ),
        returns: t(
          'Settles after original layout preparation; omission means the provider needs no separate preparation call.',
          '原布局准备完成后结算，省略表示接口不需要单独准备调用。'
        ),
        example: ensureExample
      },
      ensureRecordIndexes: {
        summary: t(
          'Capture the original index definitions and obtain the native generation handle.',
          '捕获原索引定义并取得原生代次句柄。'
        ),
        params: {
          scope: t(
            'Entity name chosen by defineEntity or the original backend author.',
            'defineEntity 或原后端作者选定的实体名称。'
          ),
          definitions: t(
            'Original index names, unique/multiEntry flags and explicit projection revisions.',
            '原索引名、唯一与多值标志，以及显式投影修订。'
          ),
          ctx: context
        },
        returns: t(
          'Native IRecordIndexHandle; declaration alone does not imply completed backfill.',
          '原生 IRecordIndexHandle，单独声明不表示回填已经完成。'
        ),
        example: ensureExample
      },
      getRecordIndexReadiness: {
        summary: t(
          'Read current native readiness for the same exact index handle and generation.',
          '读取同一精确索引句柄与代次的当前原生就绪状态。'
        ),
        params: {
          handle: t(
            'Handle returned by this provider’s ensureRecordIndexes call.',
            '来自本接口 ensureRecordIndexes 调用返回的句柄。'
          ),
          ctx: context
        },
        returns: t(
          'Current status and actual scanned/indexed counts; the read neither builds nor resumes an index.',
          '当前状态与实际扫描、索引数量，读取不建立或恢复索引。'
        ),
        example: ensureExample
      },
      openBackfillSession: {
        summary: t(
          'Acquire the original metadata-owned lease for a bounded canonical and optional legacy scan.',
          '为有界规范扫描及可选旧式扫描取得原元数据拥有的租约。'
        ),
        params: {
          handle: t(
            'Current handle returned by this provider’s ensureRecordIndexes.',
            '来自本接口 ensureRecordIndexes 返回的当前句柄。'
          ),
          options: t(
            'Required bounded range and allowComplete; true permits completion only after the original entity migration is confirmed. Optional legacyRange narrows old keys; includeLegacy defaults false. batchSize and leaseMs use native-provider defaults; the existing IDB provider uses 128 rows and 30,000 ms, bounded to 1–512 and 5,000–120,000 respectively.',
            '必填有界范围与 allowComplete；原实体迁移已确认时才可传 true 允许完成。可选 legacyRange 限定旧键，includeLegacy 缺省为 false。批量与租约使用原生接口默认值；现 IDB 为一百二十八行和三万毫秒，合法范围分别为一至五百一十二行及五千至十二万毫秒。'
          ),
          ctx: context
        },
        returns: t(
          'The original IRecordIndexBackfillSession. Existing ownership/readiness contention rejects with the same native coded failure; completion still requires native end-of-scan and revision checks.',
          '原 IRecordIndexBackfillSession；现有拥有权或就绪争用以同一原生编码失败拒绝，完成仍要求原生扫描结束与修订复核。'
        ),
        example: sessionExample
      }
    }
  }
}

/** Canonical records take precedence; legacy phase scans only remaining original legacy records. */
export const storageHostBackfillEnums: ILibraryReference['enums'] = {
  RecordIndexBackfillPhase: {
    summary: t(
      'Persisted scan phase names shared by the original native reader and entity preparation.',
      '原生读取器与实体准备共用的持久化扫描阶段名称。'
    ),
    values: {
      canonical: t(
        'Scan canonical entity records first and retain their authority over legacy shadows.',
        '先扫描规范实体记录，保持它们相对于旧式影子记录的权威。'
      ),
      legacy: t(
        'Then inspect legacy-shaped records, skipping rows already represented by canonical records.',
        '随后检查旧式形状记录，跳过已有规范记录所代表的行。'
      )
    }
  }
}
