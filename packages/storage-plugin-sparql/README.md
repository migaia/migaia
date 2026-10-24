# SPARQL 存储后端

在 `createStorageHost` 中安装 `sparqlBackendPlugin({ endpoint }, features?)`。缺省 id 为 `sparql`，显式 `id` 在 `host.backend(id)` 中保持精确类型；`sparqlBackendKind` 校验 Feature。后端提供共享 `rdf`、`sparql` 与原生乐观事务，不提供 KV、record、vector、SQL 或键锁。

```ts
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf, sparql } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/authoring/rdf'
import { sparqlBackendPlugin } from '@migaia/storage-plugin-sparql'
import { oxigraphEndpoint } from '@migaia/storage-plugin-sparql/oxigraph'
import { graphStoreFeature } from '@migaia/storage-plugin-sparql/features/graph-store'
import { ontologyFeature } from '@migaia/storage-plugin-sparql/features/ontology'

const native = new Store()
await using host = await createStorageHost({
  plugins: [
    sparqlBackendPlugin(
      { endpoint: oxigraphEndpoint(native) },
      {
        graphs: graphStoreFeature(),
        ontology: ontologyFeature()
      }
    )
  ] as const
})
const store = host.backend('sparql')
const quad = {
  subject: term.iri('https://example/alice'),
  predicate: term.iri('https://example/name'),
  object: term.literal('Alice', { language: 'en' }),
  graph: term.defaultGraph
}
await store.use(rdf).add([quad])
console.log(await store.use(rdf).match({ subject: quad.subject }).count()) // 1
await store.transaction(async (scope) => {
  scope.use(rdf).expect([quad])
  await scope.use(rdf).delete([quad])
  await scope.use(rdf).add([{ ...quad, object: term.literal('Ada') }])
})
```

endpoint 与 Oxigraph Store 均由调用方创建并拥有，后端不关闭它们。`dispose()` 返回缓存的主 Promise，失败时拒绝；`Symbol.asyncDispose` 返回另一个缓存的派生 Promise，只上报失败并成功，两者共用清理。关闭拒绝新调用、取消活动读取，并等待已发送提交结束。

公开入口为根、`/http` 的 `httpEndpoint`、`/oxigraph` 的 `oxigraphEndpoint`、`/features/graph-store` 的 `graphStoreFeature`、`/features/ontology` 的 `ontologyFeature`。根不加载 Oxigraph 原生运行代码。安装真实 peer `@migaia/storage-host`、`n3`、`oxigraph`；已验证原生版本为 n3 1.26.0 与 Oxigraph 0.4.11，RDF/JS 声明来自真实依赖，不使用替代 Store 类型或 optional peer 降级。

标准 RDF 仅接受 ground quad：主语/谓语为命名节点，宾语为命名节点或字面量，图为缺省图或命名图。语言、datatype、转义与规范身份归共享契约。raw SELECT/CONSTRUCT 和 ontology 文档另支持 blank；blank 标识局限于同一响应/文档，跨次导入不会混同。RDF-star、文档变量与标准 blank quad 拒绝，这是明确的 ground RDF 边界；推理由数据库承担。

`ERROR_SOURCE` 为 `storage.backend.sparql`。`SPARQL_REQUEST_FAILED` 保留原生 HTTP 明确拒绝的 status/body/cause；`SPARQL_UNAVAILABLE` 表示读取 transport/5xx 失败；`SPARQL_RESPONSE_INVALID` 表示结果或文档非法；`SPARQL_COMMIT_UNKNOWN` 表示已发送写缺少确认，不自动重放，当前后端后续写入拒绝。先核实原生 dataset，再创建新后端。本地非法输入与能力不支持沿原共享错误族。原生错误类型、原 cause/stack 可达，认证头与配置不进入错误数据或 hooks。

HTTP 部署要求、事务、查询写入、Graph Store、ontology、成本与 marker 清理见 [USEGUIDE.md](./USEGUIDE.md)。

事务 callback、draft 或 finalizer 的业务失败使用 `TRANSACTION_FAILED`，保留原生类型与原 primary，不冒充端点不可用；已有 contract 与原生协议错误保持原身份。

未设置 `expect` 时，仅保证规范 quad 的集合成员操作；并发读取旧值后分别写入不同宾语，两个新 quad 可以同时保留，不提供谓词单值的后写覆盖。需要检测这类竞争时，使用 `expect` 校验读到的 quad。
