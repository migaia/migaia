import type { ILibraryReference, IText } from './contract.js'

/** Keep this native Feature's metadata separate from the shared PostgreSQL reference table. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** The actual public driver and vector provider execute one native quantized business statement. */
export const storagePostgresQuantizedExample = `import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
import { pgQuantizedFeature } from '@migaia/storage-plugin-postgres/features/quantized'
const pool = new Pool({ connectionString: process.env.MIGAIA_PG_URL })
const host = await createStorageHost({ plugins: [postgresBackendPlugin({
  driver: pgDriver(pool), prefix: 'quantized_example_' + crypto.randomUUID().slice(0, 8)
}, { vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode: 'halfvec' }) })] as const })
try {
  const collection = host.backend('postgres').use(vector).collection<{ category: string }>(
    'documents', { dimensions: 2, metric: 'dot' }
  )
  await collection.upsert([
    { id: 'first', vector: [3, 0], payload: { category: 'guide' } },
    { id: 'second', vector: [2, 0], payload: { category: 'guide' } },
    { id: 'excluded', vector: [10, 0], payload: { category: 'other' } }
  ])
  const hits = await collection.near([1, 0]).where({ category: 'guide' })
    .topK(2).rescore({ topN: 1 }).withVector()
    .rerank(({ hits }) => hits.map(hit => hit.vector[0]!)).all()
  console.log(hits.map(hit => ({ id: hit.id, score: hit.score, rerankScore: hit.rerankScore })))
} finally {
  await host.dispose()
  await pool.end()
}`

/** The independent subpath publishes one Feature factory, with no additional vector provider. */
export const storagePostgresQuantizedSymbols: ILibraryReference['symbols'] = {
  pgQuantizedFeature: {
    role: 'factory',
    purpose: t(
      'Select a native quantized expression HNSW layout and add bounded rescore to the existing pgvector chain. Install with pgvectorFeature in the same backend Feature batch; organization, expiry and faithful payload predicates stay in the native recall.',
      '选择原生量化表达式 HNSW 布局，为既有 pgvector 有界链增加精排；须与原向量扩展同批安装，组织、期限及可忠实表达的载荷条件均留在原生召回阶段。'
    ),
    options: 'IPgQuantizedOptions',
    returns: t(
      'A chain-only PostgreSQL Feature. Invalid modes reject with INVALID_ARGUMENT; missing pgvector or a non-PostgreSQL preset rejects with UNSUPPORTED_CAPABILITY. Index preparation retains the original driver and native transaction; no second vector provider is published.',
      '返回仅增强查询链的 PostgreSQL 扩展；非法模式报 INVALID_ARGUMENT，缺少原向量能力或非原生预设报 UNSUPPORTED_CAPABILITY；索引准备保留原驱动与事务，不发布第二个向量能力。'
    ),
    example: storagePostgresQuantizedExample
  }
}

/** Exact types preserve payload, grouping, explicit vectors and other selected Feature methods. */
export const storagePostgresQuantizedTypes: ILibraryReference['types'] = {
  IPgQuantizedOptions: {
    summary: t(
      'Installation options choosing one native quantized expression layout while retaining original vectors.',
      '安装时选择一个原生量化表达式布局，原始向量列及其公开值保持保留。'
    ),
    members: {
      mode: {
        summary: t(
          'Required finite mode captured once before native installation or layout work.',
          '必填的有限模式，在原生安装与布局操作前只读取并捕获一次。'
        ),
        values: {
          halfvec: t(
            'Index half-precision casts with the current metric opclass; 4000 indexed dimensions maximum.',
            '按当前距离指标索引半精度转换结果，最多支持四千个索引维度。'
          ),
          binary_quantize: t(
            'Index vector signs as bits with Hamming distance, then order the recalled original vectors exactly.',
            '将向量符号量化成位并按汉明距离召回，再对候选原向量精确排序。'
          )
        },
        whenToUse: t(
          'Choose the deployed pgvector layout deliberately; casts are lossy and can reject unrepresentable values with the original SQL_FAILED cause.',
          '按实际部署主动选择量化布局；转换有精度损失，不可表示的值沿原 SQL_FAILED 保留原生原因。'
        ),
        example: storagePostgresQuantizedExample
      }
    },
    optionCases: [
      {
        title: t('Half-precision recall with original-vector ranking', '半精度召回与原向量排序'),
        problem: t(
          'Recall a bounded candidate set through a smaller native expression layout while preserving exact original-vector scores for the selected candidates.',
          '通过更小的原生表达式布局召回有界候选，同时保留选中候选的原向量精确分数。'
        ),
        example: storagePostgresQuantizedExample,
        result: t(
          'The retained first document keeps score 3 and a following client scorer adds rerankScore 3.',
          '保留的首篇文档仍有原始分数三，后接客户端评分器另加重排分数三。'
        ),
        covers: ['mode']
      }
    ]
  },
  IPgQuantizedRescoreOptions: {
    summary: t(
      'Options for the native second stage after an existing immutable topK bound.',
      '既有不可变候选上限之后的原生第二阶段精排选项，不重新创建查询源。'
    ),
    members: {
      topN: {
        summary: t(
          'Positive safe integer no larger than the original k, validated before any I/O. Actual hits may be fewer after native ANN filtering or outer JavaScript predicates.',
          '不超过原始 k 的正安全整数，在任何输入输出前校验；原生近似过滤或外层函数条件可能使实际命中更少。'
        ),
        default: t(
          'Omitted: retain at most the original k recalled candidates.',
          '省略时最多保留原始候选上限 k 个召回结果。'
        )
      }
    },
    optionCases: [
      {
        title: t('Bound native exact ranking', '限制原生精排结果'),
        problem: t(
          'Only one of two recalled documents is needed before a portable client scorer runs.',
          '在通用客户端评分器运行前，只需要保留两个召回文档中的一个。'
        ),
        example: storagePostgresQuantizedExample,
        result: t(
          'topK(2).rescore({topN:1}) retains the strongest original-vector candidate.',
          '两个召回候选经过原向量精排后，只保留最强的一个候选。'
        ),
        covers: ['topN']
      }
    ]
  },
  IPgQuantizedQueryMethods: {
    summary: t(
      'Selected PostgreSQL vector-chain augmentation with a generic bounded original-query receiver.',
      '选中的数据库向量链增强，使用泛型接收者保留原有界查询的完整类型。'
    ),
    members: {
      rescore: {
        summary: t(
          'Recall k by the selected quantized distance and exactly reorder original vectors to topN in one business SQL statement after original layout preparation.',
          '原布局准备后，在一条业务 SQL 中按选定量化距离召回 k 个候选，再按原向量精确排序取指定结果数。'
        ),
        params: {
          this: t(
            'The original bounded PostgreSQL vector query; its payload, grouping, explicit-vector and selected Feature states are preserved.',
            '原有界 PostgreSQL 向量查询，保留其载荷、分组、显式向量及已选扩展状态。'
          ),
          options: t(
            'Optional native topN; omission uses the original topK bound and invalid bounds reject before I/O.',
            '可选的原生精排数量，省略时使用原候选上限，非法上限在输入输出前拒绝。'
          )
        },
        returns: t(
          'A read-only IVectorNativeQuery preserving payload, grouping and explicit-vector state. It can append generic rerank but cannot delete, watch or rescore again; JavaScript conditions run afterward without refill.',
          '返回保留载荷、分组与显式向量状态的只读 IVectorNativeQuery，可接通用重排；不能删除、监听或再次原生精排，函数条件在外层执行且不补搜。'
        ),
        example: storagePostgresQuantizedExample
      }
    }
  }
}
