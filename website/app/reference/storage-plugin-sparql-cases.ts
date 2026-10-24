import type { ICaseDoc, IText } from './contract.js'
/** Bilingual cases use the same exact native package entries as applications. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Each example keeps its host, native owner and capability authority visible. */
export const storagePluginSparqlCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  sparqlBackendPlugin: [
    {
      title: t('Commit ground RDF with native conditions', '按原生条件提交 ground RDF'),
      problem: t(
        'An application needs an atomic ground-quad change without inventing HTTP sessions.',
        '应用需要原子修改 ground quad，不应虚构 HTTP 会话。'
      ),
      example:
        "import { Store } from 'oxigraph'\nimport { createStorageHost } from '@migaia/storage-host'\nimport { rdf } from '@migaia/storage-contract'\nimport { term } from '@migaia/storage-host/authoring/rdf'\nimport { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\n\nconst native = new Store()\nawait using host = await createStorageHost({ plugins: [\n  sparqlBackendPlugin({ endpoint: oxigraphEndpoint(native) })\n] as const })\nconst store = host.backend('sparql')\nconst quad = { subject: term.iri('urn:a'), predicate: term.iri('urn:p'),\n  object: term.literal('Alice'), graph: term.defaultGraph }\nawait store.transaction(async scope => {\n  scope.use(rdf).expectAbsent([quad])\n  await scope.use(rdf).add([quad])\n})\nconsole.log(await store.use(rdf).match({}).count())",
      result: t(
        'Prints 1 after one native conditional Modify and marker ASK. The borrowed Store remains caller-owned.',
        '一次原生条件 Modify 与 marker ASK 后输出 1，借用 Store 仍归调用方。'
      )
    }
  ],
  httpEndpoint: [
    {
      title: t('Configure a native HTTP dataset', '配置原生 HTTP dataset'),
      problem: t(
        'Query, update and graph routes must share one tested native dataset.',
        '查询、更新与图路由需要对应同一已验收 dataset。'
      ),
      example: `import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'
const endpoint = httpEndpoint({
  queryUrl: 'http://localhost:3030/storage/sparql',
  updateUrl: 'http://localhost:3030/storage/update',
  graphStoreUrl: 'http://localhost:3030/storage/data'
})`,
      result: t(
        'Creates a pure descriptor with no I/O and no raw atomicUpdate authority. Host detection is the original explicit or automatic window.',
        '纯工厂无 I/O，也不声明 raw atomicUpdate；检测沿原宿主显式或自动窗口。'
      )
    }
  ],
  oxigraphEndpoint: [
    {
      title: t('Borrow the real Oxigraph Store', '借用真实 Oxigraph Store'),
      problem: t(
        'The adapter must retain native query/update behavior without owning client closure.',
        '适配器需要保留原生 query/update 行为且不拥有 client 关闭权。'
      ),
      example: `import { Store } from 'oxigraph'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'
const native = new Store()
const endpoint = oxigraphEndpoint(native)`,
      result: t(
        'Uses genuine Store.update atomicity and native load/dump; disposal never closes native.',
        '使用真实 Store.update 原子性与原生 load/dump，释放后端不关闭 native。'
      )
    }
  ],
  graphStoreFeature: [
    {
      title: t('Read and replace a whole graph', '读取与替换整图'),
      problem: t(
        'Native graph documents need per-graph HTTP semantics without transaction claims.',
        '原生图文档需要 per-graph HTTP 语义，不声称交互事务。'
      ),
      example:
        "import { Store } from 'oxigraph'\nimport { createStorageHost } from '@migaia/storage-host'\nimport { term } from '@migaia/storage-host/authoring/rdf'\nimport { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'\nimport { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'\nimport { graphStoreFeature } from '@migaia/storage-plugin-sparql/features/graph-store'\nawait using host = await createStorageHost({ plugins: [sparqlBackendPlugin({\n  endpoint: oxigraphEndpoint(new Store())\n}, { graphs: graphStoreFeature() })] as const })\nconst graphs = host.backend('sparql').api.graphStore\nconst target = { graph: term.iri('https://example/schema') }\nawait graphs.putGraph(target, { format: 'text/turtle', text: '<urn:a> <urn:p> \"hello\" .' })\nconsole.log((await graphs.getGraph(target, 'application/n-triples')).text)\nawait graphs.removeGraph(target)",
      result: t(
        'Uses root-only graph methods; HEAD404 is false and GET404 rejects.',
        '使用根 graph 方法，HEAD404 为 false，GET404 拒绝。'
      )
    }
  ],
  ontologyFeature: [
    {
      title: t('Import independent blank-node documents', '导入独立 blank 文档'),
      problem: t(
        'RDF/OWL documents need shared blanks within each import and separation across imports.',
        'RDF/OWL 文档要求单次导入共享 blank、跨次独立。'
      ),
      example: `import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'
import { ontologyFeature } from '@migaia/storage-plugin-sparql/features/ontology'
await using host = await createStorageHost({ plugins: [sparqlBackendPlugin({
  endpoint: oxigraphEndpoint(new Store())
}, { ontology: ontologyFeature() })] as const })
const ontology = host.backend('sparql').api.ontology
const document = { format: 'text/turtle' as const, text: '_:a <urn:p> "hello" .' }
console.log(await ontology.importOntology({ default: true }, document))
console.log(await ontology.exportOntology({ default: true }, 'application/n-triples'))`,
      result: t(
        'Import returns parsed quad count, not newly inserted rows; inference remains native database policy.',
        '导入返回解析条数，不是新增数；推理由原数据库管理。'
      )
    }
  ]
}
