# @migaia/storage-plugin-sparql

把 RDF 数据写入远程 SPARQL 端点或本地 Oxigraph，并用查询链读取、筛选和修改四元组，也就是包含主语、谓词、对象和图的数据。选择 HTTP 或 Oxigraph 适配后安装插件，应用可用 RDF 值构造查询，并通过 `expect` 声明提交时必须仍存在的四元组；网络写入结果未知时不会自动重试。

## 你可能遇到过

- 拼接查询遇到引号就坏掉，把数据当作 SPARQL 语法插入。
- 两个请求都读到旧值后分别改名，误以为同一谓词天然只有一个值。
- HTTP 写入超时后重试，第一次其实已经提交。
- 导入多个 RDF 文档后 blank node 混在一起，忽略了其文档内身份。

## 为什么选它

- `term` 与模板绑定区分 RDF 数据和查询语法，见[HTTP 读写](./USEGUIDE.md#http-读写)。
- `expect` 显式声明读到的四元组，让条件提交检测真实竞争，见[检测并发修改](./USEGUIDE.md#检测并发修改)。
- 图文档使用真实 RDF parser/writer，跨文档 blank node 分别命名，见[图文档与本体](./USEGUIDE.md#图文档与本体)。
- 结果未知的写入不会自动重放；原生拒绝、读取失败与提交未知分别报告，见[失败与释放](./USEGUIDE.md#失败与释放)。

## 从这里开始

下面使用真实 Oxigraph Store，写一条姓名四元组，再按主语读回数量。

```ts doc-test=run
import { Store } from 'oxigraph'
import { createStorageHost } from '@migaia/storage-host'
import { rdf } from '@migaia/storage-contract'
import { term } from '@migaia/storage-host/sdk'
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
console.log(await store.use(rdf).match({ subject: quad.subject }).count())
```

预期输出：

```text
1
```

需要筛选和删除看[查询与修改四元组](./USEGUIDE.md#查询与修改四元组)，需要远程服务看[HTTP 读写](./USEGUIDE.md#http-读写)。

## 手写时的隐患

直接拼文本和发送 HTTP 还要自己处理数据转义和提交确认。这里只展示，不执行。

```ts doc-test=check
export async function replaceName(endpoint: string, subject: string, name: string) {
  // 隐患：值中的引号会改变生成的语法。
  const text = `INSERT DATA { <${subject}> <urn:example:name> "${name}" }`
  // 隐患：这里既不检查状态，也不确认结果未知的修改。
  await fetch(endpoint, { method: 'POST', body: text })
}
```

模板参数绑定 RDF term；事务通过条件更新和提交确认区分真实冲突与未知结果。

## 三分钟心智模型

| 工具                           | 用途                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| endpoint                       | 真实数据库的 query/update 连接，可由 HTTP 或 Oxigraph 适配。 |
| `store.use(rdf)`               | 处理应用可直接比较的四元组。                                 |
| `store.use(sparql)`            | 带 term 绑定的原生 SELECT、ASK、CONSTRUCT、UPDATE。          |
| `transaction` / `tx()`         | 累积修改，在一次条件提交中检查前提。                         |
| Graph Store / ontology Feature | 导入、导出或替换单个图的 RDF 文档。                          |

raw SPARQL 是直接表达原生查询语句的模板。四元组包含主语、谓语、宾语和图。ground quad 指不含 blank node 或变量的可稳定命名四元组。组织视图把逻辑图映射到各自的真实命名图。

## 典型场景

| 场景                 | 怎么组合                         | 详细说明                                           |
| -------------------- | -------------------------------- | -------------------------------------------------- |
| 按姓名筛选后删除     | `rdf.match` + `where` + `delete` | [查询与修改四元组](./USEGUIDE.md#查询与修改四元组) |
| 修改前确认旧值仍存在 | `expect` + `tx`                  | [检测并发修改](./USEGUIDE.md#检测并发修改)         |
| 连接远程数据库       | `httpEndpoint` + `sparql`        | [HTTP 读写](./USEGUIDE.md#http-读写)               |
| 管理 schema 文档     | graphStore / ontology            | [图文档与本体](./USEGUIDE.md#图文档与本体)         |

## 安装

当前包为 `private: true`，用于本仓库 workspace，不能假定 registry 已发布。从同一 workspace 的应用目录安装相邻包及真实 peers：

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-sparql
pnpm add n3@^1.26.0 oxigraph@^0.4.11
```

需要 Node.js 24 或更新版本。根入口不加载 Oxigraph 原生运行代码；`/oxigraph` 显式选择真实 Store，`/http` 使用运行时 fetch。RDF 解析使用 n3，声明来自真实 RDF/JS 依赖。

## 常用 API

| API                                                 | 用途                           |
| --------------------------------------------------- | ------------------------------ |
| `sparqlBackendPlugin({ endpoint, id? }, features?)` | 安装一个端点，id 默认 sparql。 |
| `oxigraphEndpoint(store)` / `httpEndpoint(options)` | 适配本地或远程端点。           |
| `store.use(rdf)`                                    | `add`、`delete`、`match`。     |
| `store.use(sparql)`                                 | 原生查询与更新模板。           |
| `store.transaction(run)` / `store.tx()`             | 乐观事务。                     |
| `graphStoreFeature()` / `ontologyFeature()`         | 图文档读写。                   |

## 契约细节

提供 RDF、SPARQL 和原生乐观事务，不提供 KV、records、vector、SQL 或键锁。标准 RDF 仅接受命名主语/谓语、命名或字面量宾语、缺省或命名图。raw SELECT/CONSTRUCT 和文档另支持 blank node；RDF-star、文档变量与标准 blank quad 拒绝。推理由数据库承担。

endpoint 与 Store 由调用方管理，host 不关闭它们。Oxigraph 0.4.11 的公开 Store 类型没有 close/dispose 方法，无需编造一个；远程连接池的释放遵循调用方客户端 API。host 关闭拒绝新调用、取消活动读取并等待已发提交。

没有 `expect` 时只保证规范四元组的集合成员修改；不同宾语可同时存在，不提供谓词单值覆盖。HTTP 部署须保证单条条件 Modify 原子执行和同 dataset 的写后读可见性，协议本身不能证明这一点。原生错误域、提交未知和图文档边界见[使用指南](./USEGUIDE.md)。
