# SPARQL 使用指南

## 按场景查找

| 需求                 | 场景                                  |
| -------------------- | ------------------------------------- |
| 筛选、删除或替换 RDF | [查询与修改四元组](#查询与修改四元组) |
| 修改前检查旧值       | [检测并发修改](#检测并发修改)         |
| 使用远程 SPARQL 服务 | [HTTP 读写](#http-读写)               |
| 导入导出单个图       | [图文档与本体](#图文档与本体)         |

## 查询与修改四元组

此例写入两条姓名，再只删除 Alice。

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'

await using host = await createStorageHost({
  plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })]
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('urn:example:alice'),
  predicate: term.iri('urn:example:name'),
  object: term.literal('Alice'),
  graph: term.defaultGraph
}
await store
  .use(rdf)
  .add([quad, { ...quad, subject: term.iri('urn:example:bob'), object: term.literal('Bob') }])
const selected = store
  .use(rdf)
  .match({ predicate: quad.predicate })
  .where((value) => value.object.value === 'Alice')
console.log(await selected.count())
console.log(await selected.delete())
console.log(await store.use(rdf).match({}).count())
```

预期输出：

```text
1
1
1
```

quad 的 subject/predicate 用命名节点，object 用命名节点或字面量，graph 用缺省图或命名节点。`term.literal` 支持 language 或 datatype；term 绑定负责转义。标准 API 不接受 blank node 或变量。

`match(pattern)` 的 pattern 是 quad 字段子集。查询链支持 where、follow/inverse、orderBy、distinct、skip、limit、分页、聚合和 stream。`explain()` 区分原生步骤与客户端步骤；`requirePushdown()` 对不支持的客户端步骤在请求前拒绝。

`delete` 对实际选中、接受修改的规范 quad 去重计数；`replace(old, new)` 仅替换选中的 old，未选中返回 0。根调用等提交确认后才返回；事务内数量描述当前修改草稿。

## 检测并发修改

先声明 Alice 仍存在，再把它改为 Ada。若另一个事务移除了 Alice，这次提交会冲突。

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'

await using host = await createStorageHost({
  plugins: [sparqlBackendPlugin({ endpoint: oxigraphEndpoint(new Store()) })]
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('urn:example:alice'),
  predicate: term.iri('urn:example:name'),
  object: term.literal('Alice'),
  graph: term.defaultGraph
}
await store.use(rdf).add([quad])
await store
  .tx()
  .concurrency(ConcurrencyPolicy.optimistic({ retries: 1 }))
  .run(async (scope) => {
    scope.use(rdf).expect([quad])
    await scope.use(rdf).delete([quad])
    await scope.use(rdf).add([{ ...quad, object: term.literal('Ada') }])
  })
console.log((await store.use(rdf).match({}).all()).map((value) => value.object.value).join(','))
```

预期输出：

```text
Ada
```

`expect` 条件按合取检查；`expectAbsent` 要求各 quad 不存在。草稿按规范 quad 身份去重，同一 quad 最后成员操作生效。未声明前提的读取不会自动成为读集；两个事务分别插入不同宾语时可同时保留，不提供谓词单值覆盖。

`ConcurrencyPolicy.optimistic({retries: 1})` 最多重试一次真实冲突；callback 可能重新执行，外部副作用应放在事务成功之后。backoffMs 默认 20；省略策略时不自动启用乐观重试。只支持乐观并发，不支持键锁、wait/fail 策略或交互式远程事务。

一次条件 DELETE/INSERT WHERE 同时写用户数据和提交 marker，随后 ASK 确认，再清理 marker。只有 Update 成功且 ASK 明确 marker 不存在才是可重试的冲突。已发送 Update 结果未知、ASK 失败或取消为 SPARQL_COMMIT_UNKNOWN；停止该后端后续写入，不重放。清理 marker 失败只 report，用户数据已提交。

有 atomicUpdate 的端点才可在事务内执行一个 raw update body，不能混 RDF 操作/前提或第二个 raw body。Oxigraph 提供一次原生 Store.update；httpEndpoint 不提供此能力，在写入前拒绝。raw 事务模板只提供 update，不提供 select/ask/construct。

## HTTP 读写

先运行支持 SPARQL Query 与 Update 的真实服务。示例默认连接本机 3030 端口的 `storage` dataset；地址不同时，设置 `SPARQL_QUERY_URL`、`SPARQL_UPDATE_URL` 和 `SPARQL_GRAPH_STORE_URL`，三者应指向同一 dataset。Graph Store URL 供图文档操作使用。此例先插入再 ASK，写入的数据会留在服务中。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sparql } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'

await using host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin({
      endpoint: httpEndpoint({
        queryUrl: process.env.SPARQL_QUERY_URL ?? 'http://127.0.0.1:3030/storage/sparql',
        updateUrl: process.env.SPARQL_UPDATE_URL ?? 'http://127.0.0.1:3030/storage/update',
        graphStoreUrl: process.env.SPARQL_GRAPH_STORE_URL ?? 'http://127.0.0.1:3030/storage/data'
      })
    })
  ]
})
const query = host.backend('sparql').use(sparql)
const subject = term.iri('urn:example:' + crypto.randomUUID())
const predicate = term.iri('urn:example:name')
const value = term.literal('Alice')
await query`INSERT DATA { ${subject} ${predicate} ${value} }`.update()
console.log(await query`ASK { ${subject} ${predicate} ${value} }`.ask())
```

预期输出：

```text
true
```

queryUrl/updateUrl 必填，graphStoreUrl 仅图文档功能需要。URL 为不含内嵌凭据的绝对 HTTP(S)。可选 auth 精确选择 `{basic: {user, password}}` 或 `{bearer}`。修改请求一次发送，不跟随重定向；读取沿 fetch 行为。Graph Store HEAD404 返回 false，GET404 拒绝。认证头不进入诊断数据。

根 raw tag 支持 select、ask、construct、update。普通字符串是数据，不应作为语法插入；用 term 绑定 RDF 参数。raw SELECT/CONSTRUCT 支持结果内 blank node，标识仅限同一响应。

部署须保证单条条件 Modify 原子执行、同 dataset 写后读可见。已覆盖 Fuseki 6.2.0、Oxigraph 0.4.11 的原生路径，其他部署需确认等价保证；HTTP 协议不等于数据库事务。

## 图文档与本体

写入一个图，导出后按 replace 再导入；所有操作都来自本例安装的 Feature。

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'
import { graphStoreFeature } from '@migaia/storage-plugin-sparql/features/graph-store'
import { ontologyFeature } from '@migaia/storage-plugin-sparql/features/ontology'

await using host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin(
      { endpoint: oxigraphEndpoint(new Store()) },
      {
        graphs: graphStoreFeature(),
        ontology: ontologyFeature()
      }
    )
  ]
})
const store = host.backend('sparql')
const target = { graph: term.iri('urn:example:people') }
const document = {
  format: 'text/turtle' as const,
  text: '<urn:example:alice> <urn:example:name> "Alice" .'
}
await store.api.graphStore.putGraph(target, document)
console.log(await store.api.graphStore.hasGraph(target))
console.log((await store.api.graphStore.getGraph(target)).text.includes('Alice'))
console.log(await store.api.ontology.importOntology(target, document, { mode: 'replace' }))
await store.api.graphStore.removeGraph(target)
console.log(await store.api.graphStore.hasGraph(target))
```

预期输出：

```text
true
true
1
false
```

target 精确选择 `{default: true}` 或 `{graph: namedNode}`。document 的 format 是 text/turtle 或 application/n-triples，text 是完整文档。get/export 默认 Turtle。Graph Store 提供 getGraph、putGraph、mergeGraph、removeGraph、hasGraph；ontology 提供 importOntology/exportOntology。import mode 默认 merge，replace 替换真实单图；返回解析条数，含重复，不是新增数。

n3 处理 RDF1.1 文档语法。同一文档的 blank node 共享身份，不同导入重新命名。拒绝 RDF-star 和文档变量，不执行推理。端点须实际提供 graphStore；Feature 方法在 store.api；组织视图仍按自身图映射执行，事务内没有图文档 API。

## 组织与保留图

`host.org(id).backend('sparql')` 将 default/named 逻辑图映射到 `urn:migaia:org:<orgId>:` 下的真实命名图。不同组织隔离；dropOrg 删除目标组织全部物理图，包括空命名图与含 blank node 的文档。raw SPARQL 只允许配置的默认组织。

标准 RDF、图文档和 ontology 禁止操作 `urn:migaia:commit` 保留图。进程崩溃可能留下 marker；管理员确认没有活动提交后才可在数据库执行 `CLEAR SILENT GRAPH <urn:migaia:commit>`。绕过标准 API 修改该图会破坏提交确认。

## 失败与释放

错误 source 为 storage.backend.sparql。SPARQL_REQUEST_FAILED 是原生明确拒绝，保留 status/body/cause；SPARQL_UNAVAILABLE 是读取 transport/5xx 失败；SPARQL_RESPONSE_INVALID 是非法结果/文档；SPARQL_COMMIT_UNKNOWN 是写结果无法确认，须先核实 dataset，再创建新的后端。callback、草稿任务和 finalizer 的业务失败使用 TRANSACTION_FAILED，原生类型、primary 和原因链保留；已有 contract/协议错误不改身份。

host 默认检测；autoDetect:false 时先 await host.detect()。关闭拒绝新调用，取消活动读取，等待已发提交。dispose() 的主 Promise 保留清理失败；Symbol.asyncDispose 共享清理并只 report。endpoint、Oxigraph Store 与自备客户端由调用方管理，不由插件关闭。Oxigraph 0.4.11 无公开 close/dispose 方法。

hooks 只观察，失败交给 report；干预使用 host pipeline。HTTP 观察不含认证或正文。查询成本包含真实结果字节和客户端剩余操作；图文档整体解析和传输，事务条件文本随 quad/前提数量增长，不承诺数据库计划或推理性能。
