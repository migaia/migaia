import type { ILibraryReference, IMemberDoc, IText } from './contract.js'

/** Source-backed portable stage documentation stays separate from the existing query tables. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** The scorer inspects actual native candidates without replacing their engine scores. */
export const storageVectorRerankExample = `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const collection = host.backend('memory').use(vector).collection<{ priority: number }>(
  'articles', { dimensions: 2, metric: 'dot' }
)
await collection.upsert([
  { id: 'near', vector: [3, 0], payload: { priority: 1 } },
  { id: 'useful', vector: [2, 0], payload: { priority: 9 } }
])
const hits = await collection.near([1, 0], { exact: true }).topK(2)
  .rerank(({ hits }) => hits.map(hit => hit.payload?.priority ?? 0), { topN: 1 }).all()
console.log(hits.map(hit => ({
  id: hit.id, score: hit.score, rerankScore: hit.rerankScore
})))`

/** This native author function accepts an existing query and captured native options only. */
const nativeExample = `import {
  refineStorageVectorQuery, type IVectorQuery
} from '@migaia/storage-contract'
function chooseNativeStage<P, G extends boolean, V extends boolean, M extends object>(
  query: IVectorQuery<P, G, V, M>, capturedNativeOptions: object
) {
  return refineStorageVectorQuery(query, k => ({
    native: capturedNativeOptions, topN: Math.min(2, k)
  }))
}`

/** Rerank's new member can also be reused by the existing bounded vector type documentation. */
export const storageVectorRerankMember: IMemberDoc = {
  summary: t(
    'Apply one portable client scorer to the actual bounded engine candidates, preserve their engine scores, retain stable descending rerankScore order and then truncate to topN.',
    '对引擎实际有界候选执行一次可移植客户端评分，保留引擎原分数，按重排分数稳定降序排列后截取 topN。'
  ),
  params: {
    scorer: t(
      'Application scorer receiving readonly origin and hit wrappers plus the same caller AbortSignal. Return a dense array with one finite score per input hit; synchronous throws and rejected Promises retain their cause under RERANK_FAILED.',
      '应用评分器取得只读请求来源、候选包装及同一调用方取消信号，须为每个输入候选返回一个有限数字组成的稠密数组；同步抛错或异步拒绝在 RERANK_FAILED 下保留原因。'
    ),
    options: t(
      'Optional IVectorRerankOptions from the application; topN defaults to the actual stage bound and must be a positive safe integer no greater than that bound.',
      '应用提供的可选 IVectorRerankOptions，topN 缺省取当前阶段上限，须为不超过该上限的正安全整数。'
    )
  },
  returns: t(
    'A new immutable read-only query. Invalid bounds reject before I/O; malformed scores use RERANK_RESULT_INVALID, cancellation uses ABORTED. No delete, watch or requirePushdown method remains.',
    '返回新的不可变只读查询，非法上限在 I/O 前拒绝，非法分数报 RERANK_RESULT_INVALID，取消报 ABORTED；不再提供删除、订阅或严格下推方法。'
  ),
  example: storageVectorRerankExample
}

/** The same original reader owns every read terminal after the new client ordering. */
const readMembers: Record<string, IMemberDoc> = {}
/** Each terminal description states its actual observation rather than repeating its name. */
const reads = [
  [
    'all',
    'Collect the retained hits in the final stage order.',
    '按当前阶段的最终顺序收集所有保留候选。',
    'A Promise of the complete retained hit array.',
    '返回包含全部保留候选数组的 Promise。'
  ],
  [
    'first',
    'Read the first retained hit after the bounded stage and original source cleanup finish.',
    '在有界阶段及原数据源清理完成后读取首个保留候选。',
    'The first hit, or undefined when no candidate remains.',
    '返回首个候选，没有剩余候选时返回 undefined。'
  ],
  [
    'maybe',
    'Read the first retained hit through the existing explicit presence union.',
    '通过既有显式存在性判别联合读取首个候选。',
    'An IMaybe holding either the first hit or the absent branch.',
    '返回持有首个候选或缺失分支的 IMaybe。'
  ],
  [
    'firstOrThrow',
    'Require one retained hit and reject an empty result through the existing query error.',
    '要求至少一个保留候选，空结果沿既有查询错误拒绝。',
    'The first hit; an empty result rejects with QUERY_EMPTY_RESULT.',
    '返回首个候选，空结果报 QUERY_EMPTY_RESULT。'
  ],
  [
    'exists',
    'Observe whether any candidate survives the complete stage ranking and truncation.',
    '观察当前阶段完整排名与截断后是否仍存在候选。',
    'A boolean after original cursor cleanup finishes.',
    '原游标清理完成后返回是否存在候选的布尔值。'
  ],
  [
    'count',
    'Count retained rows after the current stage has selected its final bounded set.',
    '在当前阶段选出最终有界集合后统计保留行。',
    'The retained row count, never the engine collection size.',
    '返回保留行数，而不是引擎集合的总数据量。'
  ],
  [
    'stream',
    'Pull retained hits through the original storage iterator and its accepted-work cleanup.',
    '经原存储迭代器及其已接纳工作清理机制逐项取得保留候选。',
    'An IStorageIterator from the original query reader; dispose it on early exit.',
    '返回原查询读取器的 IStorageIterator，提前退出时应释放。'
  ]
] as const
for (const [name, en, zh, resultEn, resultZh] of reads)
  readMembers[name] = {
    summary: t(en, zh),
    params: {
      ctx: t(
        'Optional original operation context supplying cancellation and deadline.',
        '提供取消信号与期限的可选原操作上下文。'
      )
    },
    returns: t(resultEn, resultZh),
    example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function read(query: IVectorRerankedQuery<unknown>) { return query.${name}() }`
  }
readMembers.explain = {
  summary: t(
    'Inspect the existing plan without reading data; native source work and client steps retain their original boundaries.',
    '无需读取数据即可检查既有计划，原生来源工作与客户端步骤保留各自边界。'
  ),
  returns: t(
    'A detached IQueryPlan describing pushed and client work.',
    '返回说明原生下推与客户端分工的独立 IQueryPlan。'
  ),
  example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function plan(query: IVectorRerankedQuery<unknown>) { return query.explain() }`
}
readMembers.pluck = {
  summary: t(
    'Extract one typed field from each retained row after the complete ordering stage.',
    '在完整排序阶段后，从每个保留行提取一个类型受约束字段。'
  ),
  params: {
    field: t(
      'Existing field name on the current hit or selected row.',
      '当前候选或投影行上实际存在的字段名称。'
    ),
    ctx: t('Optional original operation context for this read.', '本次读取使用的可选原操作上下文。')
  },
  returns: t(
    'A Promise containing field values in retained row order.',
    '返回按保留行顺序排列字段值的 Promise。'
  ),
  example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function ids(query: IVectorRerankedQuery<unknown>) { return query.pluck('id') }`
}
readMembers.each = {
  summary: t(
    'Await an application callback for every retained row while preserving original cleanup on failure.',
    '为每个保留行等待应用回调，失败时仍保留原清理路径。'
  ),
  params: {
    fn: t(
      'Callback receiving the current row and zero-based retained position; its rejection remains the primary failure.',
      '取得当前行与从零起始保留位置的回调，其拒绝仍是首要失败。'
    ),
    ctx: t(
      'Optional original operation context for the full terminal.',
      '整个终点使用的可选原操作上下文。'
    )
  },
  returns: t(
    'A Promise of the number of completed callbacks after cleanup.',
    '清理完成后返回已完成回调次数的 Promise。'
  ),
  example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function visit(query: IVectorRerankedQuery<unknown>) {
  return query.each(hit => { console.log(hit.id) })
}`
}
readMembers.chunk = {
  summary: t(
    'Deliver bounded retained-row batches to an awaited application callback without another cursor owner.',
    '将有界保留行批次交给需要等待的应用回调，不增加其它游标拥有者。'
  ),
  params: {
    size: t(
      'Positive safe integer giving the largest callback batch.',
      '规定回调最大批次的正安全整数。'
    ),
    fn: t(
      'Callback receiving a readonly batch in final retained order.',
      '取得按最终保留顺序排列只读批次的回调。'
    ),
    ctx: t(
      'Optional original cancellation and deadline context.',
      '提供原取消信号与期限的可选上下文。'
    )
  },
  returns: t(
    'A Promise of processed retained rows after original cleanup.',
    '原清理完成后返回已处理保留行数的 Promise。'
  ),
  example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function batches(query: IVectorRerankedQuery<unknown>) {
  return query.chunk(2, hits => { console.log(hits.map(hit => hit.id)) })
}`
}
/** Projection changes only the returned row shape and never restores writable methods. */
const selectMember: IMemberDoc = {
  summary: t(
    'Project existing hit fields or await an application mapper after the final ordering stage.',
    '在最终排序阶段后投影既有候选字段，或等待应用映射函数。'
  ),
  params: {
    fields: t(
      'One or more existing hit fields such as id, score or rerankScore.',
      '一个或多个实际候选字段，例如 id、score 或 rerankScore。'
    ),
    mapper: t(
      'Alternative application mapper receiving one retained hit; async results are awaited.',
      '替代字段投影的应用映射器，取得一个保留候选并等待异步结果。'
    )
  },
  returns: t(
    'A read-only result with the inferred Pick or awaited mapped row shape.',
    '返回类型为 Pick 或等待映射结果的只读查询结果。'
  ),
  example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function labels(query: IVectorRerankedQuery<unknown>) { return query.select('id', 'rerankScore') }`
}
/** Grouping is conditional on the original backend and runs after the stage's topN. */
const groupMember: IMemberDoc = {
  summary: t(
    'Group retained topN hits by an existing payload field only when the original source declares grouping support.',
    '仅在原来源声明支持分组时，按既有负载字段分组已保留的 topN 候选。'
  ),
  params: {
    field: t(
      'Payload field on the declared generic payload type.',
      '声明的泛型负载类型上实际存在的字段。'
    ),
    options: t(
      'Options with a positive safe perGroup bound for each retained group.',
      '包含每组正安全整数 perGroup 上限的选项。'
    )
  },
  returns: t(
    'A read-only result containing groups and their retained hits in stage order.',
    '返回包含分组及按当前阶段顺序保留候选的只读结果。'
  ),
  example: `import type { IVectorRerankedQuery } from '@migaia/storage-contract'
function groups(query: IVectorRerankedQuery<{ category: string }, true>) {
  return query.groupBy('category', { perGroup: 1 })
}`
}

/** The root adds only these two runtime names; existing enum objects acquire a rerank member. */
export const storageContractVectorSymbols: ILibraryReference['symbols'] = {
  VectorQueryOriginKind: {
    role: 'constant',
    purpose: t(
      'Name the three original user request forms carried to a portable vector scorer, independently of any backend sample resolution.',
      '命名交给可移植向量评分器的三种原始用户请求形式，独立于后端实际样本解析。'
    ),
    example: `import { VectorQueryOriginKind } from '@migaia/storage-contract'
const kind = VectorQueryOriginKind.near`
  },
  refineStorageVectorQuery: {
    role: 'operation',
    purpose: t(
      'Let a selected native Feature derive the same already bounded vector source with one captured opaque native request, preserving original query planning, context and resource ownership.',
      '让已选择的原生 Feature 为同一已有界向量来源派生一次捕获的不透明原生请求，保留原查询规划、上下文与资源拥有关系。'
    ),
    params: {
      query: t(
        'Original post-topK query from a source declaring native: true; builders, reranked results and sources without that fact are rejected.',
        '来自声明 native: true 来源的原 topK 后查询；无界构建器、已重排结果及未声明来源均拒绝。'
      ),
      refine: t(
        'Pure author callback invoked once with the original k; return captured native data and a positive safe topN no greater than k.',
        '取得原 k 且只调用一次的纯作者回调，返回已捕获原生数据与不大于 k 的正安全 topN。'
      )
    },
    returns: t(
      'A new immutable IVectorNativeQuery using the exact original execute source. Only its execution input adds native; it remains read-only and may be reranked. Invalid refinement rejects before I/O.',
      '返回使用精确原 execute 来源的不可变 IVectorNativeQuery，仅其执行输入增加 native；结果保持只读且可继续重排，非法派生在 I/O 前拒绝。'
    ),
    example: nativeExample
  }
}

/** Origin values are stable protocol facts rather than backend or operation registrations. */
export const storageContractVectorEnums: ILibraryReference['enums'] = {
  VectorQueryOriginKind: {
    summary: t(
      'Original request form preserved for the scorer even when a backend loads sample vectors internally.',
      '即使后端内部加载样本向量，也向评分器保留的原始请求形式。'
    ),
    values: {
      near: t(
        'Direct query vector captured by the original collection near call.',
        '由原集合 near 调用捕获的直接查询向量。'
      ),
      similarTo: t(
        'Original sample ID; native sample resolution does not replace it with a derived direction.',
        '保留原样本 ID，原生样本解析不会将其替换为合成方向。'
      ),
      recommend: t(
        'Original positive and negative sample ID arrays retained in their supplied order.',
        '按输入顺序保留的原正样本与负样本 ID 数组。'
      )
    }
  }
}

/** Native results share terminal semantics while their examples keep the exact native surface. */
const nativeReadMembers = Object.fromEntries(
  Object.entries(readMembers).map(([name, doc]) => [
    name,
    {
      ...doc,
      example:
        typeof doc.example === 'string'
          ? doc.example.replaceAll('IVectorRerankedQuery', 'IVectorNativeQuery')
          : doc.example
    }
  ])
)
/** Every new type describes the existing query-owned stage rather than a second executor. */
export const storageContractVectorTypes: ILibraryReference['types'] = {
  VectorQueryOriginKind: {
    summary: t(
      'Key union of the canonical original request forms near, similarTo and recommend.',
      '规范原请求形式 near、similarTo 与 recommend 对应的键联合。'
    ),
    members: {}
  },
  IVectorQueryOrigin: {
    summary: t(
      'Readonly discriminated original request captured once by a native query source before any scorer or sample I/O.',
      '由原生查询来源在评分器或样本 I/O 之前单次捕获的只读可判别原请求。'
    ),
    members: {
      kind: {
        summary: t(
          'Discriminator selecting the direct-vector, sample-ID or recommendation-ID shape.',
          '用于选择直接向量、样本 ID 或推荐 ID 形状的判别字段。'
        ),
        values: { enum: 'VectorQueryOriginKind' }
      },
      vector: {
        summary: t(
          'Detached finite near query vector, present only for the near form.',
          '仅在 near 形式中出现的独立有限查询向量。'
        )
      },
      id: {
        summary: t(
          'Sample ID supplied by the application to similarTo, before native resolution.',
          '应用交给 similarTo 的样本 ID，保留原生解析前的值。'
        )
      },
      positive: {
        summary: t(
          'Nonempty readonly positive sample IDs supplied to recommend in input order.',
          '交给 recommend 的非空只读正样本 ID，保持输入顺序。'
        )
      },
      negative: {
        summary: t(
          'Readonly negative sample IDs supplied to recommend; omission is captured as an empty array.',
          '交给 recommend 的只读负样本 ID，省略时捕获为空数组。'
        )
      }
    }
  },
  IVectorRerankInput: {
    summary: t(
      'Readonly scorer input containing the original user request and the actual bounded engine hit sequence.',
      '包含原始用户请求与引擎实际有界候选顺序的只读评分器输入。'
    ),
    members: {
      origin: {
        summary: t(
          'Original query origin preserved independently of native sample lookups.',
          '独立于原生样本查找而保留的原始查询来源。'
        )
      },
      hits: {
        summary: t(
          'Frozen hit wrappers in engine order; vectors exist only in the explicit withVector type state.',
          '按引擎顺序排列的冻结候选包装，只有显式 withVector 类型状态才包含向量。'
        )
      }
    }
  },
  IVectorRerankContext: {
    summary: t(
      'Borrowed scorer cancellation context sharing the caller signal and owning no independent timer or budget.',
      '借用调用方信号的评分器取消上下文，不拥有独立计时器或预算。'
    ),
    members: {
      signal: {
        summary: t(
          'Same caller AbortSignal used by this query, or an un-aborted signal when no caller signal exists.',
          '本查询使用的同一调用方取消信号，调用方未提供时使用未取消信号。'
        )
      }
    }
  },
  IVectorReranker: {
    summary: t(
      'Application scorer returning one finite number per input hit synchronously or through a Promise; throws retain their original cause.',
      '应用评分器同步或通过 Promise 为每个输入候选返回一个有限数字，抛错时保留原始原因。'
    ),
    members: {},
    example: storageVectorRerankExample
  },
  IVectorRerankOptions: {
    summary: t(
      'Construction-time bound for the portable client ordering, validated before opening the original native source.',
      '可移植客户端排序的构造期上限，在打开原生来源前完成校验。'
    ),
    members: {
      topN: {
        summary: t(
          'Positive safe integer no greater than the original k or preceding native stage bound.',
          '不大于原 k 或前一个原生阶段上限的正安全整数。'
        ),
        default: t(
          'Omitted: retain up to the complete preceding stage bound.',
          '省略时最多保留前一个阶段上限内的全部候选。'
        )
      }
    },
    optionCases: [
      {
        title: t('Retain the highest reranker priorities', '保留重排后最高优先级候选'),
        problem: t(
          'Native similarity retrieves useful candidates but application priority should choose the final smaller set.',
          '原生相似度提供候选，但需要由应用优先级选出更小的最终集合。'
        ),
        example: storageVectorRerankExample,
        result: t(
          'The application retains one highest-priority hit while preserving its original engine score.',
          '应用保留一个最高优先级候选，同时保持其原引擎分数。'
        ),
        covers: ['topN']
      }
    ]
  },
  IVectorRerankedHit: {
    summary: t(
      'Original engine hit enriched with one independent readonly rerankScore; payload and explicit vector typing remain intact.',
      '在原引擎候选上增加独立只读重排分数，保留负载与显式向量类型。'
    ),
    members: {
      id: {
        summary: t(
          'Original collection point ID returned by the engine without rewriting its identity.',
          '引擎返回的原集合点 ID，不改写其身份。'
        )
      },
      score: {
        summary: t(
          'Unchanged engine relevance score, still governed by the original metric and minScore.',
          '保持不变的引擎相关性分数，仍由原度量与 minScore 约束。'
        )
      },
      payload: {
        summary: t(
          'Optional original generic payload returned with the native hit.',
          '随原生候选返回的可选原泛型负载。'
        )
      },
      vector: {
        summary: t(
          'Original vector available only when the query explicitly requested withVector.',
          '只有查询显式要求 withVector 时才存在的原始向量。'
        )
      },
      rerankScore: {
        summary: t(
          'Finite application score controlling descending final order, with engine order retained for ties.',
          '控制最终降序排列的有限应用分数，同分保留引擎顺序。'
        )
      }
    }
  },
  IVectorQueryRefinement: {
    summary: t(
      'Finite native author result carrying already captured opaque request data and the candidate bound for the following portable stage.',
      '有限原生作者结果，携带已捕获的不透明请求数据与后续可移植阶段的候选上限。'
    ),
    members: {
      native: {
        summary: t(
          'Feature-owned immutable data interpreted only by the original source execute callback, with no generic contract parser.',
          '仅由原来源 execute 回调解释的 Feature 不可变数据，契约不增加通用解析器。'
        )
      },
      topN: {
        summary: t(
          'Positive safe output bound no greater than the original topK; becomes the following rerank default and maximum.',
          '不大于原 topK 的正安全输出上限，成为后续重排的缺省值与最大值。'
        )
      }
    }
  },
  IVectorRerankedQuery: {
    summary: t(
      'Immutable read-only final ordering retaining original terminals and pure Feature methods; grouping is conditional on real backend support.',
      '保留原读取终点与纯 Feature 方法的不可变只读最终排序，分组取决于真实后端支持。'
    ),
    scenarios: [
      t(
        'Choose an application-specific ranking after native topK and optional native refinement.',
        '在原生 topK 与可选原生派生后选择应用特定排名。'
      )
    ],
    example: storageVectorRerankExample,
    members: { ...readMembers, select: selectMember, groupBy: groupMember }
  },
  IVectorNativeQuery: {
    summary: t(
      'Same-source immutable native refinement result with read-only terminals and one subsequent portable rerank stage.',
      '使用同一来源的不可变原生派生结果，包含只读终点与一次后续可移植重排阶段。'
    ),
    scenarios: [
      t(
        'Expose an engine-specific scoring Feature without another planner or source creator.',
        '公开引擎特定评分 Feature，同时保留唯一规划器与来源创建入口。'
      )
    ],
    example: nativeExample,
    members: {
      ...nativeReadMembers,
      select: {
        ...selectMember,
        params: {
          ...selectMember.params,
          fields: t(
            'One or more native hit fields such as id, score, payload or an explicitly requested vector; native results do not yet carry rerankScore.',
            '一个或多个原生命中字段，例如 id、score、payload 或显式请求的 vector；原生结果此时尚不包含 rerankScore。'
          )
        },
        example: `import type { IVectorNativeQuery } from '@migaia/storage-contract'
function ids(query: IVectorNativeQuery<unknown>) { return query.select('id', 'score') }`
      },
      groupBy: {
        ...groupMember,
        example: `import type { IVectorNativeQuery } from '@migaia/storage-contract'
function groups(query: IVectorNativeQuery<{ category: string }, true>) {
  return query.groupBy('category', { perGroup: 1 })
}`
      },
      rerank: storageVectorRerankMember,
      withVector: {
        summary: t(
          'Request original hit vectors through the same native source while preserving its captured native refinement.',
          '通过同一原生来源请求原候选向量，同时保留已捕获的原生派生。'
        ),
        returns: t(
          'A new native query whose hit type includes readonly vector components.',
          '返回候选类型包含只读向量分量的新原生查询。'
        ),
        example: `import type { IVectorNativeQuery } from '@migaia/storage-contract'
function vectors(query: IVectorNativeQuery<unknown>) { return query.withVector() }`
      }
    }
  }
}
