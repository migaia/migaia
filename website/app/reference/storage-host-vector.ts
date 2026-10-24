import type { ILibraryReference, IText } from './contract.js'

/** The independent entry documents the pure scorer without importing its runtime into the host. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** A real Memory vector provider supplies original scores and explicitly requested vectors. */
export const storageHostMmrExample = `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { mmr } from '@migaia/storage-host/vector/mmr'
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const collection = host.backend('memory').use(vector).collection('articles', {
  dimensions: 2, metric: 'dot'
})
await collection.upsert([
  { id: 'one', vector: [3, 0] },
  { id: 'two', vector: [2, 0] },
  { id: 'three', vector: [0, 1] }
])
const hits = await collection.near([1, 0]).withVector().topK(3)
  .rerank(mmr({ lambda: 0.5, topN: 2 }), { topN: 2 }).all()
console.log(hits.map(hit => ({ id: hit.id, relevance: hit.score, rank: hit.rerankScore })))`

/** Runtime symbols are consumed only by the independent vector/mmr module. */
export const storageHostVectorSymbols: ILibraryReference['symbols'] = {
  mmr: {
    role: 'factory',
    purpose: t(
      'Create a pure deterministic scorer for vector rerank. Engine scores provide relevance and cosine similarity between explicitly retrieved hit vectors provides diversity. The host root does not re-export this independent entry; it performs no retrieval or network work.',
      '为向量重排创建纯确定性评分器，以引擎分数衡量相关性，以显式取回的候选向量余弦相似度衡量多样性；宿主根入口不重导此独立入口，函数不执行检索或网络操作。'
    ),
    options: 'IStorageMmrOptions',
    returns: t(
      'An IVectorReranker accepting withVector hits and returning one finite rank per original hit. Equal objectives retain engine order; zero directions contribute neutral similarity. Invalid options reject with INVALID_ARGUMENT before creating the scorer.',
      '返回要求显式向量的 IVectorReranker，为每个原候选给出一个有限排名分数；目标相同保留引擎顺序，零方向贡献中性相似度；非法选项在创建评分器前报 INVALID_ARGUMENT。'
    ),
    example: storageHostMmrExample
  }
}

/** Options separate greedy work from the query-owned result truncation. */
export const storageHostVectorTypes: ILibraryReference['types'] = {
  IStorageMmrOptions: {
    summary: t(
      'Factory options for the independent pure MMR scorer; the helper never retrieves vectors or truncates the query result itself.',
      '独立纯 MMR 评分器的工厂选项，辅助函数不取回向量，也不自行截断查询结果。'
    ),
    members: {
      lambda: {
        summary: t(
          'Finite relevance weight in [0,1]. One uses engine relevance alone; zero uses diversity after the first engine candidate, with ties retaining engine order.',
          '位于 [0,1] 的有限相关性权重，1 仅使用引擎相关性，0 在第一个引擎候选后仅使用多样性，同分保留引擎顺序。'
        )
      },
      topN: {
        summary: t(
          'Positive safe integer bounding the greedy prefix, capped by the actual hit count. Remaining candidates receive ranks in engine order, so the returned score array always matches the input length.',
          '限制贪心前缀的正安全整数，按实际候选数截短；其余候选按引擎顺序取得排名，因此返回分数数组始终与输入等长。'
        ),
        default: t(
          'Omitted: compute the greedy order for all hits. Actual truncation belongs only to rerank options.topN.',
          '省略时计算全部候选的贪心顺序，真正截断只由 rerank 的 options.topN 决定。'
        )
      }
    },
    optionCases: [
      {
        title: t('Balance relevance with diversity', '平衡相关性与多样性'),
        problem: t(
          'Highly similar leading candidates can occupy a small result list; compute a diverse greedy prefix while keeping the engine scores available.',
          '高度相似的前列候选可能占满小结果列表，需要计算更具多样性的贪心前缀，同时保留引擎原分数。'
        ),
        example: storageHostMmrExample,
        result: t(
          'The scorer computes two greedy choices and rerank retains two hits with unchanged engine scores and independent rerankScore values.',
          '评分器计算两次贪心选择，重排保留两个候选，其引擎原分数保持不变，并带独立重排分数。'
        ),
        covers: ['lambda', 'topN']
      }
    ]
  }
}
