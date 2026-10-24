import type { ILibraryReference, IText } from './contract.js'

/** Native rescoring remains an independent Feature entry in both website languages. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** The same public example exercises the extra slot and original bounded vector chain. */
export const storageQdrantRescoreExample = `import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { qdrantRescoreFeature } from '@migaia/storage-plugin-qdrant/features/rescore'
await using host = await createStorageHost({plugins:[qdrantBackendPlugin(
  {url:'http://127.0.0.1:16333',collectionPrefix:crypto.randomUUID()},
  {rescore:qdrantRescoreFeature({collections:{articles:{dimensions:2,metric:'dot'}}})}
)]})
const store = host.backend('qdrant')
const articles = store.use(vector).collection('articles',{dimensions:2,metric:'dot'})
await articles.upsert([{id:'a',vector:[2,0]},{id:'b',vector:[1,0]}])
await store.api.qdrantRescore.updateVectors('articles',[
  {id:'a',vector:[0,1]},{id:'b',vector:[3,0]}
])
const hits = await articles.near([1,0]).topK(2).rescore({query:[1,0],topN:1}).all()
console.log(hits.map(hit=>({id:hit.id,score:hit.score})))`

/** No root re-export or alternate provider is documented by this Feature's symbol table. */
export const storageQdrantRescoreSymbols: ILibraryReference['symbols'] = {
  qdrantRescoreFeature: {
    role: 'factory',
    purpose: t(
      'Select one extra native dense or max_sim vector slot per configured logical collection. Adds the bounded rescore chain and an organization-bound vector update API without changing the original search/source slots.',
      '为配置的每个逻辑集合选择一个额外原生 dense 或 max_sim 向量槽，提供有界 rescore 链与绑定组织的向量更新 API，原 search/source 槽保持不变。'
    ),
    options: 'IQdrantRescoreOptions',
    returns: t(
      'A Qdrant-only Feature. Each rescore terminal sends one Query API call with original recall k in prefetch and topN on the outer slot. Existing collections missing that slot reject only new operations with UNSUPPORTED_CAPABILITY; no data is migrated or recreated.',
      '返回仅适用于 Qdrant 的 Feature，每次 rescore 终点发送一次 Query API，prefetch 保留原召回 k，外层槽采用 topN。旧集合缺槽时仅新操作报 UNSUPPORTED_CAPABILITY，不迁移或重建数据。'
    ),
    example: storageQdrantRescoreExample
  }
}

/** Type descriptions distinguish caller vectors, installation schema and native operation results. */
export const storageQdrantRescoreTypes: ILibraryReference['types'] = {
  IQdrantRescoreSlot: {
    summary: t(
      'One extra-slot schema captured before a logical collection is first created.',
      '在逻辑集合首次创建之前捕获的额外向量槽结构配置。'
    ),
    members: {
      dimensions: {
        summary: t(
          'Positive safe integer giving every dense vector or matrix row its component count.',
          '正安全整数，规定 dense 向量或多向量矩阵每行的分量数量。'
        )
      },
      metric: {
        summary: t(
          'Native distance for the extra slot, independently of the original retrieval metric.',
          '额外槽使用的原生距离度量，独立于原始召回向量的度量配置。'
        ),
        default: t('cosine when omitted.', '省略时使用 cosine。'),
        values: {
          cosine: t('Native cosine similarity.', '原生余弦相似度。'),
          dot: t('Native dot product.', '原生点积相似度。'),
          euclid: t(
            'Native Euclidean distance, exposed as its negative score.',
            '原生欧氏距离，对外分数取该距离的相反数。'
          )
        }
      },
      multivector: {
        summary: t(
          'Select max_sim to score nonempty matrices; omission selects a dense vector slot.',
          '选择 max_sim 后对非空矩阵评分，省略时使用单个 dense 向量槽。'
        ),
        default: t('Omitted: dense vectors.', '省略时使用 dense 向量。'),
        values: {
          max_sim: t(
            'Sum each query row’s maximum native similarity against the stored matrix.',
            '把各查询行与存储矩阵的最大原生相似度求和。'
          )
        }
      }
    }
  },
  IQdrantRescoreOptions: {
    summary: t(
      'Installation options mapping logical collections to their extra native slot schema.',
      '在安装时把逻辑集合映射到对应额外原生向量槽结构的配置。'
    ),
    members: {
      collections: {
        summary: t(
          'Caller-owned logical collection names and extra-slot schemas, captured once. Qdrant 1.15.5 can create these slots only with a new collection.',
          '调用方提供的逻辑集合名称与额外槽配置，捕获一次；Qdrant 1.15.5 只能在新集合创建时声明这些槽。'
        )
      }
    },
    optionCases: [
      {
        title: t('Rescore a bounded native recall', '重排有界原生召回结果'),
        problem: t(
          'Rank a fast search candidate set with a second native embedding while retaining organization and expiry filtering.',
          '使用第二份原生向量重排快速召回候选，同时保留组织与期限过滤。'
        ),
        covers: ['collections'],
        example: storageQdrantRescoreExample,
        result: t(
          'The second point wins by its extra-slot score although its original search score is lower.',
          '第二个点按额外槽分数胜出，尽管它的原 search 分数较低。'
        )
      }
    ]
  },
  IQdrantRescoreVector: {
    summary: t(
      'A readonly dense vector or nonempty matrix of equal-sized dense vectors; the selected collection schema determines the admitted form.',
      '只读 dense 向量或非空且各行等维的 dense 向量矩阵，可接受的形态由所选集合结构决定。'
    ),
    members: {}
  },
  IQdrantRescorePoint: {
    summary: t(
      'One existing logical point identity and its replacement extra-slot vector, never a raw physical UUID.',
      '一个已存在的逻辑点身份及其替换用额外槽向量，不接受原始物理 UUID 作为身份约定。'
    ),
    members: {
      id: {
        summary: t(
          'Original logical point ID in this exact organization; native UUID derivation stays with the backend.',
          '当前准确组织内的原逻辑点 ID，原生 UUID 的派生仍归后端负责。'
        )
      },
      vector: {
        summary: t(
          'Replacement dense vector or matrix for the configured extra slot; unrelated vectors and payload stay unchanged.',
          '替换配置的额外槽使用的 dense 向量或矩阵，其它向量与 payload 保持不变。'
        )
      }
    }
  },
  IQdrantRescoreQueryOptions: {
    summary: t(
      'A captured extra-slot query and final native result bound after an existing topK.',
      '在已有 topK 之后捕获的额外槽查询向量与最终原生结果边界。'
    ),
    members: {
      query: {
        summary: t(
          'Dense query or query-row matrix matching the configured extra slot; no embeddings are generated by this library.',
          '与额外槽结构匹配的 dense 查询或查询行矩阵，本库不会生成嵌入向量。'
        )
      },
      topN: {
        summary: t(
          'Positive safe integer no greater than the original recall k; invalid values reject before I/O.',
          '不大于原召回 k 的正安全整数，非法值在读写之前拒绝。'
        ),
        default: t('Omitted: the original recall k.', '省略时使用原召回 k。')
      }
    }
  },
  IQdrantRescoreApi: {
    summary: t(
      'Organization-bound extra-vector writes retaining native update acknowledgment and the original execution owner.',
      '绑定组织的额外向量写入 API，保留原生更新确认与原执行拥有者。'
    ),
    members: {
      updateVectors: {
        summary: t(
          'Update only the extra slot of existing points with wait:true; standard upsert remains whole-point replacement.',
          '以 wait:true 仅更新已存在点的额外槽，标准 upsert 仍为整点替换。'
        ),
        params: {
          collection: t(
            'A logical name declared in collections.',
            '在 collections 中声明的逻辑集合名称。'
          ),
          points: t(
            'Dense batch of unique logical point IDs and matching vectors or matrices.',
            '由不重复逻辑点 ID 与匹配向量或矩阵组成的稠密批次。'
          ),
          ctx: t(
            'Original caller signal and timeout budget; no second cancellation or retry owner.',
            '原调用方 signal 与超时预算，不建立第二取消或重试拥有者。'
          )
        },
        returns: t(
          'The native update record after real settlement, preserving original operation_id/status and native error evidence.',
          '真实结算后返回原生更新记录，保留 operation_id/status 及原生错误证据。'
        ),
        example: storageQdrantRescoreExample
      }
    }
  },
  IQdrantRescoreMethods: {
    summary: t(
      'The selected Qdrant vector-chain augmentation; a bounded original query receiver is required.',
      '所选 Qdrant 向量链增强，调用接收者必须是已有数量边界的原查询。'
    ),
    members: {
      rescore: {
        summary: t(
          'Run one native prefetch recall followed by extra-slot scoring, then allow portable rerank on its actual hits.',
          '通过一次原生 prefetch 召回并按额外槽评分，然后允许对实际命中继续执行通用 rerank。'
        ),
        params: {
          options: t(
            'Extra-slot query and optional topN; client predicates run after outer hits without refilling.',
            '额外槽查询与可选 topN，客户端谓词在外层命中后执行且不补搜。'
          )
        },
        returns: t(
          'A readonly native query preserving payload, withVector and grouping types, with no delete/watch/requirePushdown.',
          '返回保留 payload、withVector 与分组类型的只读原生查询，不提供 delete/watch/requirePushdown。'
        ),
        example: storageQdrantRescoreExample
      }
    }
  },
  IQdrantRescoreResult: {
    summary: t(
      'The original Qdrant updateVectors operation record, never a count of modified or deleted points.',
      '原 Qdrant updateVectors 操作记录，不代表已修改或删除点的数量。'
    ),
    members: {
      operation_id: {
        summary: t(
          'Original native operation identifier when the server returns one.',
          '服务器返回时保留的原生操作标识。'
        )
      },
      status: {
        summary: t(
          'Original native acknowledged or completed status; no operation replay is inferred.',
          '保留原生 acknowledged 或 completed 状态，不据此推断自动重放。'
        )
      }
    }
  }
}
