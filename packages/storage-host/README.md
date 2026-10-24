# @migaia/storage-host

把内存、数据库和文件后端装到同一个存储宿主（host），用带类型的 `backend(id)` 获取对应存储，并统一结束工作与释放资源。适合同时使用多个数据源、需要组织隔离或事务的应用：先安装后端插件，再选择各后端提供的能力；多个后端的写入不会自动合成一个原子事务。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 你可能遇到过

- 数据库连接关了，订阅或排队任务还在运行：业务代码没有统一的结束入口。
- 两个后端都叫 `cache`，调用时才发现拿错实例：字符串查找丢失了安装时的类型信息。
- 给每个方法手动加租户前缀，偶尔漏掉一次：组织隔离依赖调用方逐项遵守约定。
- 同时更新文本和记录，一半成功一半失败：多次独立写入没有放进同一个事务。

## 为什么选它

- `backend(id)` 保留已安装插件的具体类型；重复 ID 在安装时拒绝。[安装后端](./USEGUIDE.md#安装与追加后端)
- 内置 memory 后端可直接存文本、字节和记录，也能执行事务。[事务与查询](./USEGUIDE.md#事务与记录查询)
- `org(id)` 固定同一组织，传递给实体或组合插件后仍保持隔离。[组织数据](./USEGUIDE.md#隔离组织数据)
- `dispose()` 等待已接纳的工作并释放已安装资源；组织视图没有关闭整个宿主的方法。[结束工作](./USEGUIDE.md#检查错误与结束工作)

## 从这里开始

下面把状态写入 memory，再从同一个后端读取。支持顶层 `await` 的 TypeScript 环境可直接使用。

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const memory = host.backend('memory')
  await memory.set('order:1:status', 'paid')
  console.log(await memory.get('order:1:status')) // paid
} finally {
  await host.dispose()
}
```

预期输出：

```text
paid
```

memory 数据只在当前实例中存在。再次创建宿主不会恢复它。

## 手写时的隐患

同样的状态存取，用普通 Map 很容易开始，但组织隔离与退出处理需要另外约定：

```ts doc-test=check
const values = new Map<string, string>()
values.set('order:1:status', 'paid') // 没有组织前缀，不同组织会碰到同一键。
console.log(values.get('order:1:status'))
values.clear() // 只能清数据，不能等待其它异步存储工作。
```

Map 适合局部数据；需要多后端、事务或统一释放时，再使用宿主。

## 三分钟理解

`createStorageHost → 安装插件 → backend(id) → 存取数据 → dispose()`。

| 名称            | 解决什么问题                                                |
| --------------- | ----------------------------------------------------------- |
| 宿主 host       | 保存后端列表，执行安装、环境检查和关闭                      |
| 后端 backend    | 实际存数据，例如 memory、SQLite 或对象存储                  |
| 能力 capability | 某类后端支持的操作；用 `has(token)` 检查、`use(token)` 获取 |
| Feature         | 安装时明确选择的额外 API；经 `store.api` 使用               |
| 组织 org        | 固定 UUID 的业务视图，相同逻辑键与其它组织隔离              |

## 常见场景

| 想做什么               | 用什么组合                         | 示例                                           |
| ---------------------- | ---------------------------------- | ---------------------------------------------- |
| 保存临时状态           | host + memory                      | [安装与追加](./USEGUIDE.md#安装与追加后端)     |
| 多项写入一起提交       | memory transaction                 | [事务与记录查询](./USEGUIDE.md#事务与记录查询) |
| 保存和查询带主键的对象 | `/entity` + memory 或 records 后端 | [实体](./USEGUIDE.md#使用实体仓储)             |
| 同一应用服务多个组织   | `host.org(id)`                     | [组织数据](./USEGUIDE.md#隔离组织数据)         |
| 保存应用日志记录       | `/journal` + 可选 logger           | [日志](./USEGUIDE.md#打开日志存储)             |

## 安装

这些 storage 包当前是 `private: true` 的仓库 workspace 包，尚不作为已发布的 registry 包提供。以下命令用于仓库内的消费包：

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract
```

内置 memory 不需要数据库客户端。其它后端由各自的插件提供。只有配置 `journal` 或导入 `/journal` 时才需要可选 peer：

```bash
pnpm add --workspace @migaia/logger
```

## 常用 API

| API                                          | 用途                                     |
| -------------------------------------------- | ---------------------------------------- |
| `createStorageHost({ plugins, ...options })` | 创建宿主，默认在返回前执行环境检查       |
| `host.backend(id)` / `hasBackend(id)`        | 获取已安装后端，或检查动态 ID            |
| `host.use(...plugins)`                       | 追加一批插件，成功后返回包含新类型的宿主 |
| `host.org(uuid)` / `dropOrg(uuid)`           | 获取组织视图，或删除该组织在各后端的数据 |
| `host.detect()`                              | 显式执行尚未成功完成的环境检查           |
| `host.dispose()`                             | 停止接纳新工作，等待并释放资源           |

## 使用边界

- `plugins` 的 ID 必须唯一。一批插件全部成功才会出现在查找结果中；安装失败会释放本批已创建的资源。重叠安装批次报 `STORAGE_HOST_BUSY`。
- `autoDetect` 默认 `true`，`installTimeoutMs` 默认 `30000` 毫秒。设 `autoDetect: false` 后，应先 `await host.detect()` 再执行数据操作；检查未完成的操作会报 `UNSUPPORTED_CAPABILITY`。追加插件后也要检查新增后端。
- `org` 默认零 UUID；显式组织 ID 必须是规范的小写 UUID，可用 `createOrgId()` 生成。`org()` 返回的视图不能安装插件、删除组织或关闭宿主。删除组织尝试所有后端，部分失败不会撤回已成功的删除，错误为 `ORG_DELETE_FAILED`，具体失败在 `AggregateError.errors` 中。
- 后端支持什么能力由实际实例决定。非默认组织不会自动得到只绑定到根后端的自定义能力；先检查 `has(token)`。组织视图不支持原生 SQL/SPARQL 入口。
- 显式 `dispose()` 的失败会拒绝，重复调用复用同一个 Promise。`await using` 清理会报告失败并完成，以免覆盖业务代码的主错误。调用方提供的原生客户端是否需要单独关闭，见相应后端说明。
- 宿主错误的 `source` 为 `@migaia/storage-host`；共享参数和能力错误来自 `@migaia/storage-contract`。排查时同时读取 `source`、`code` 与 `cause`，不要匹配错误文案。

## 后端作者入口迁移

应用只调用 `backend()` 时无需导入作者工具。实现后端时，运行时工具从以下入口获取；类型、能力 token、定义和纯校验继续从 contract 获取。

表中的 `/authoring/...` 均以 `@migaia/storage-host` 开头。

| 原 contract 运行时用途     | 当前入口                                                      |
| -------------------------- | ------------------------------------------------------------- |
| 查询创建与条件执行         | `@migaia/storage-host/authoring/query`                        |
| 并发策略与事务执行         | `/authoring/concurrency`、`/authoring/transaction`            |
| 键编码、输入快照、资源管理 | `/authoring/key`、`/authoring/context`、`/authoring/resource` |
| 能力发布与数据转换         | `/authoring/capability`、`/authoring/codec`                   |
| SQL、SPARQL 与数据通道工具 | `/authoring/sql`、`/authoring/sparql`、相应通道入口           |

完整路径和依赖说明见 [storage-contract](../storage-contract/README.md#入口与依赖方向)。旧 contract 根入口不保留这些运行时导出。
