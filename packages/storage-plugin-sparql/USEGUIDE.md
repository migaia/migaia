# SPARQL 使用指南

安装代码见 [README.md](./README.md)。配置工厂同步且无 I/O；宿主拥有安装、检测、pipeline 与释放。`autoDetect: false` 时必须先显式 `await host.detect()`，未检测的真实终点在业务 I/O 前拒绝，不会隐式发起检测。

## 原生与 HTTP 入口

```ts
import { httpEndpoint } from '@migaia/storage-plugin-sparql/http'
const endpoint = httpEndpoint({
  queryUrl: 'http://localhost:3030/storage/sparql',
  updateUrl: 'http://localhost:3030/storage/update',
  graphStoreUrl: 'http://localhost:3030/storage/data',
  auth: { basic: { user: 'deployment-user', password: 'deployment-password' } }
})
```

URL 必须为无内嵌凭据的绝对 HTTP(S) URL。可选 auth 在 Basic 与 Bearer 中精确选一；仅需要 Graph Store/ontology 时提供 graphStoreUrl。URL API 对图参数编码一次。修改请求仅发送一次，不跟随重定向；读取沿原 fetch 行为。HEAD404 返回 false，GET404 拒绝，认证与 raw 正文不进入埋点。

部署必须保证同一 dataset 上单条条件 Modify 原子执行、随后读取可见；HTTP 协议本身不能证明此保证。实际验收为 Apache Jena Fuseki 6.2.0 与 Oxigraph 0.4.11，其他部署须做同一原生验收。`httpEndpoint` 不提供 atomicUpdate；`oxigraphEndpoint(new Store())` 提供真实单次 Store.update，不把多个 HTTP 请求当成交互事务。

## Ground RDF 与统一查询链

`store.use(rdf).add/delete` 只收 ground quad，语言、datatype、图与转义保持共享规范。`match(pattern)` 使用原不可变查询链，支持 where、follow/inverse、orderBy、distinct、skip、limit、分页、聚合终点与 stream。原生 SELECT 供给 ground 匹配，客户端剩余工作归共享执行器，explain 如实描述；requirePushdown 对不支持的客户端步骤在 I/O 前拒绝。

```ts
const selected = store
  .use(rdf)
  .match({ predicate: quad.predicate })
  .where((q) => q.object.value === 'Alice')
console.log(selected.explain())
const removed = await selected.delete()
const replaced = await store
  .use(rdf)
  .match({})
  .replace(quad, { ...quad, object: term.literal('Ada') })
```

删除按实际选择并接受的规范 quad 去重计数；replace 仅替换选中的 old quad，未选中返回 0。根调用等原生提交确认才返回计数；事务内计数描述草稿。筛选和 traversal 不绕过共享链。

每个组织的逻辑 default/named 图映射到 `urn:migaia:org:<orgId>:` 前缀下的真实命名图，根与借用组织视图同样隔离。非配置缺省组织禁止 raw SPARQL。`host.dropOrg(id)` 删除其全部真实图，包括 blank 文档与空命名图，不影响其他组织。

## 乐观事务与提交确认

```ts
import { ConcurrencyPolicy } from '@migaia/storage-contract'
await store
  .tx()
  .concurrency(ConcurrencyPolicy.optimistic({ retries: 1 }))
  .run(async (scope) => {
    scope.use(rdf).expect([quad])
    scope.use(rdf).expectAbsent([{ ...quad, object: term.literal('new') }])
    await scope.use(rdf).delete([quad])
    await scope.use(rdf).add([{ ...quad, object: term.literal('new') }])
    console.log(await scope.use(rdf).match({}).count())
  })
```

scope 仅提供带 expect/expectAbsent 的 native RDF 与 update-only raw tag，不提供 KV、lock 或 wait/fail 策略。原 transaction owner 管理 accepted work、首错、iterator、finalizer 与过期 scope；不另建生命周期。草稿按规范身份去重，最后操作覆盖前操作。present 条件按合取，每个 absent 独立 NOT EXISTS。

一次条件 DELETE/INSERT WHERE 原子写用户 quad 与 `urn:migaia:commit` 中随机 marker；一次 ASK 确认，再单独清理 marker。只有 Update 成功且 ASK 成功并明确 marker 不存在才是可沿原 optimistic policy 重试的冲突。Update 已发送但结果未知、ASK 失败/取消均为 SPARQL_COMMIT_UNKNOWN，停止当前安装后端后续写入，不重放；先检查原生数据库再创建新后端。清理 marker 失败只上报，用户数据已经提交。没有写前提时后提交覆盖先提交，不暗示自动读集校验。

有真实 atomicUpdate 的端点才可在事务内执行一个 `scope.use(sparql)\`INSERT DATA { ... }\`.update()` body，不能混任何 RDF 操作/前提或第二个 raw body。通用 HTTP 在写入前拒绝此能力。根 raw tag 支持 select/ask/construct/update，值绑定归共享编译器；普通字符串不是 SPARQL 语法，不得作为语法插入。

标准 RDF、Graph Store、ontology 禁止保留 marker 图。进程崩溃可能遗留 marker；管理员先确认活动提交后，可直接在数据库执行 `CLEAR SILENT GRAPH <urn:migaia:commit>`。直接 native/raw 管理操作修改该图不在标准条件提交保证范围。

## Graph Store 与 ontology

安装时选择 graphStoreFeature()/ontologyFeature()。前者五方法为 getGraph、putGraph、mergeGraph、removeGraph、hasGraph；后者为 importOntology、exportOntology，均只在根 store.api，事务投影为空，不存在 prepare 或 transaction client。target 精确为 `{default:true}` 或 `{graph:namedNode}`，末参为原 ctx。get/export 缺省 Turtle，文档显式 Turtle 或 N-Triples。

```ts
const target = { graph: term.iri('https://example/schema') }
const document = {
  format: 'text/turtle' as const,
  text: '<https://example/a> <https://example/p> "value" .'
}
await store.api.graphStore.putGraph(target, document)
await store.api.graphStore.mergeGraph(target, document)
console.log(await store.api.graphStore.hasGraph(target))
console.log(await store.api.graphStore.getGraph(target, 'application/n-triples'))
await store.api.graphStore.removeGraph(target)
const parsed = await store.api.ontology.importOntology(target, document, { mode: 'replace' })
console.log(await store.api.ontology.exportOntology(target, 'text/turtle'))
```

ontology 缺省 merge，replace 沿真实 per-graph replace。返回解析条数（含重复），不是新增条数。相同文档内 blank 共享保持，每次导入新 blank 前缀，跨文档独立。N3 负责 RDF1.1 parser/writer，RDF-star 拒绝；推理及供应商规则由数据库管理。

## 观察、错误与成本

store 操作及 Feature 终点均经原 async pipeline。存储 hooks、beforeSparqlUpdate、onPreconditionFailed、onHttpRequest 只观察，抛错/拒绝只 report，不能中止或改写；干预写 pipeline stage。更新事件只有操作/前提数量，HTTP 只有脱敏 route、method、可选 status 与耗时，无认证或正文。

错误域与四类原生错误见 README。读写成本按实际 RDF 字节；草稿预期 O(q)，条件文本 O(q+p) 加实际 quad 字节，native match 读取实际结果后沿共享客户端预算执行，文档 O(字节+quad) 并完整传输。不含数据库计划、网络与推理成本，不增加第二套时钟、重试器或执行平台。
