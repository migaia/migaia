import type { ICaseDoc, IText } from './contract.js'
/** Paired bilingual examples use only the package's actual public entries. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Fresh native collection examples clean only their own fixture data. */
const nativeExample = (
  entry: string,
  factory: string,
  key: string,
  body: string
) => `import { createStorageHost } from '@migaia/storage-host'
import { qdrantBackendPlugin } from '@migaia/storage-plugin-qdrant'
import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'
import { qdrantManagementFeature } from '@migaia/storage-plugin-qdrant/features/management'
import { ${factory} } from '@migaia/storage-plugin-qdrant/features/${entry}'
const url = process.env.MIGAIA_QDRANT_URL ?? 'http://127.0.0.1:6333'
const http = fetchHttp(url)
await using host = await createStorageHost({ plugins: [
  qdrantBackendPlugin({url,http},{management:qdrantManagementFeature(),${key}:${factory}()})
] as const })
const store = host.backend('qdrant')
const name = 'example_' + crypto.randomUUID().replaceAll('-','')
await store.api.qdrantManagement!.createCollection(name,{
  vectors:{dense:{size:2,distance:'Cosine'}},sparse_vectors:{sparse:{}}
})
try {
  await http.upsert(name,{points:[
    {id:1,vector:{dense:[1,0],sparse:{indices:[1],values:[1]}},payload:{category:['a','b']}},
    {id:2,vector:{dense:[0,1],sparse:{indices:[2],values:[1]}},payload:{category:['b']}}
  ],wait:true})
  ${body}
} finally {await store.api.qdrantManagement!.deleteCollection(name)}`
/** Every example is standalone, with native and standard semantics stated separately. */
export const storagePluginQdrantCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  qdrantBackendPlugin: [
    {
      title: t('Native exact search with original sample amplitude', '原生精确搜索保留原样本幅度'),
      problem: t(
        'Retrieve bounded native hits and retain portable payloads.',
        '读取原生有界命中并保留portable payload。'
      ),
      example: `import {createStorageHost} from '@migaia/storage-host'
import {vector} from '@migaia/storage-contract'
import {qdrantBackendPlugin} from '@migaia/storage-plugin-qdrant'
const url=process.env.MIGAIA_QDRANT_URL??'http://127.0.0.1:6333'
await using host=await createStorageHost({plugins:[qdrantBackendPlugin({url,collectionPrefix:'example_'+crypto.randomUUID()})] as const})
const points=host.backend('qdrant').use(vector).collection<{category:string}>('documents',{dimensions:2,metric:'cosine'})
await points.upsert([{id:'a',vector:[100,0],payload:{category:'guide'}}])
console.log(await points.near([1,0],{exact:true}).where({category:'guide'}).topK(5).withVector().all())
await points.delete(['a'])`,
      result: t(
        'The native source slot returns [100,0] at float32 precision; only the engine ranks candidates.',
        '原生source槽按float32返回[100,0]，只有引擎给候选排名。'
      )
    }
  ],
  fetchHttp: [
    {
      title: t('Use runtime fetch', '使用运行时fetch'),
      problem: t(
        'Access the finite native protocol without loading the SDK at runtime.',
        '运行时不加载SDK，访问有限原生协议。'
      ),
      example: `import {fetchHttp} from '@migaia/storage-plugin-qdrant/http'
const http=fetchHttp(process.env.MIGAIA_QDRANT_URL??'http://127.0.0.1:6333')
console.log(await http.getVersion())`,
      result: t(
        'Returns the real server version; writes never follow redirects or replay.',
        '返回真实服务版本；写入不跟随重定向或重放。'
      )
    }
  ],
  qdrantClientHttp: [
    {
      title: t('Borrow a genuine SDK client', '借用真实SDK客户端'),
      problem: t(
        'Retain native SDK configuration and caller ownership.',
        '保留原SDK配置与调用方所有权。'
      ),
      example: `import {QdrantClient} from '@qdrant/js-client-rest'
import {qdrantClientHttp} from '@migaia/storage-plugin-qdrant/client'
const client=new QdrantClient({url:process.env.MIGAIA_QDRANT_URL??'http://127.0.0.1:6333'})
const http=qdrantClientHttp(client)
console.log(await http.getVersion())`,
      result: t(
        'The adapter never closes or reconfigures the client; SDK 1.11 cancellation and snapshot-202 limits remain explicit.',
        '适配器不关闭或重配client；明确保留SDK1.11取消与snapshot-202限制。'
      )
    }
  ],
  qdrantHybridFeature: [
    {
      title: t('Fuse dense and sparse native retrieval', '融合dense与sparse原生检索'),
      problem: t(
        'Native RRF combines two named retrieval branches.',
        '原生RRF合并两个named检索分支。'
      ),
      example: nativeExample(
        'hybrid',
        'qdrantHybridFeature',
        'hybrid',
        `console.log(await store.api.qdrantHybrid!.query(name,{
    prefetch:[{query:[1,0],using:'dense',limit:2},{query:{indices:[1],values:[1]},using:'sparse',limit:2}],
    query:{fusion:'rrf'},limit:2
  }))
  await store.api.qdrantHybrid!.updateSparseVectors(name,{points:[{id:1,vector:{sparse:{indices:[1],values:[2]}}}],wait:true})`
      ),
      result: t(
        'Native fusion returns points; sparse updates preserve dense vectors.',
        '原生fusion返回points，sparse更新保留dense向量。'
      )
    }
  ],
  qdrantRecommendFeature: [
    {
      title: t('Keep native best-score semantics', '保留原生best-score语义'),
      problem: t(
        'Use native strategy and lookup rather than the standard centroid recipe.',
        '使用原生策略与lookup，而非标准均值recipe。'
      ),
      example: nativeExample(
        'recommend',
        'qdrantRecommendFeature',
        'recommend',
        `console.log(await store.api.qdrantRecommend!.recommend(name,{positive:[1],using:'dense',strategy:'best_score',limit:1}))`
      ),
      result: t(
        'Returns the genuine native score and exclusion behavior.',
        '返回真实原生分数及排除行为。'
      )
    }
  ],
  qdrantGroupByFeature: [
    {
      title: t('Group multivalue native payloads', '按原生多值payload分组'),
      problem: t(
        'One native point can belong to several engine groups.',
        '一个原生点可以进入多个引擎组。'
      ),
      example: nativeExample(
        'group-by',
        'qdrantGroupByFeature',
        'groups',
        `console.log(await store.api.qdrantGroupBy!.search(name,{vector:{name:'dense',vector:[1,0]},group_by:'category',group_size:2,limit:2}))`
      ),
      result: t(
        'Returns native groups, distinct from standard top-k grouping; with_lookup is absent.',
        '返回原生groups，与标准top-k分组不同；不提供with_lookup。'
      )
    }
  ],
  qdrantManagementFeature: [
    {
      title: t(
        'Separate numeric counts from native operation records',
        '区分数字计数与原生操作记录'
      ),
      problem: t(
        'Deletion must include expired physical matches without treating an operation ID as a count.',
        '删除包含物理过期匹配点，不能把operation ID当计数。'
      ),
      example: `import {createStorageHost} from '@migaia/storage-host'
import {vector,DeleteCountMode} from '@migaia/storage-contract'
import {qdrantBackendPlugin} from '@migaia/storage-plugin-qdrant'
import {qdrantManagementFeature} from '@migaia/storage-plugin-qdrant/features/management'
const url=process.env.MIGAIA_QDRANT_URL??'http://127.0.0.1:6333'
await using host=await createStorageHost({plugins:[qdrantBackendPlugin({url,collectionPrefix:'management_'+crypto.randomUUID()},{management:qdrantManagementFeature()})] as const})
const store=host.backend('qdrant')
const points=store.use(vector).collection<{tag:string}>('documents',{dimensions:2,metric:'dot'})
await points.upsert([{id:'a',vector:[1,0],payload:{tag:'temporary'}}],{ttlMs:0})
console.log(await points.deleteWhere({tag:{startsWith:'temp'}},{count:DeleteCountMode.scroll}))
console.log(await store.api.qdrantManagement!.deleteByFilter('documents',{tag:'temporary'}))
console.log(await store.api.qdrantManagement!.purgeExpired('documents',{wait:true}))`,
      result: t(
        'scroll returns a number; management returns operationId/status with no counting or scanning.',
        'scroll返回数字，management返回operationId/status，不计数或扫描。'
      )
    }
  ]
}
