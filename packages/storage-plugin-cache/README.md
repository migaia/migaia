# @migaia/storage-plugin-cache

把已安装的键值后端按快慢顺序组合成多级缓存，让重复查询共享回源结果，并把下层读到的数据补到上层。适合同时使用内存和持久存储、又不想逐次手写回填与失效传播的应用；可设置缓存期限、缺失值缓存和延后写入，各层之间不提供原子提交，延后写入也不是持久队列。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 你可能遇到过

- 同一个热点请求同时回源很多次：每个请求独立执行了加载函数。
- 查不到的数据反复查询数据库：未命中没有短期缓存。
- 下层已经更新，上层还在返回旧数据：副本缺少失效传播或硬期限。
- 为了批量回源自己维护 Map、去重和取消：单键与批量请求没有共享加载状态。

## 为什么选它

- 多级读取、回填与写入使用已安装后端，层顺序由你指定。[多级缓存](./USEGUIDE.md#组合多个层)
- `getOrLoad` 和 `getOrLoadMany` 合并同键加载；一个调用方取消不会中断其它等待者。[回源策略](./USEGUIDE.md#加载缺失值与负缓存)
- 可分别设置新鲜期、最大年龄和负缓存期限，旧值可以先返回并后台刷新。[期限](./USEGUIDE.md#期限刷新与取消)
- 语义检索由显式选择的 Feature 提供，普通缓存无需嵌入模型或向量后端。[语义缓存](./USEGUIDE.md#选择语义缓存)

## 从这里开始

先安装数据层，再安装缓存。第二次请求从缓存取得同一值，不再运行加载函数。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'values' })] })
try {
  const host = await base.use(cachePlugin({ tiers: [{ backend: 'values', ttlMs: 30000 }] }))
  await host.detect()
  const cache = host.backend('cache')
  let loads = 0
  const load = async () => ({ answer: ++loads })
  await cache.getOrLoad('answer', load)
  console.log(await cache.getOrLoad('answer', load), loads) // { answer: 1 } 1
} finally {
  await base.dispose()
}
```

预期输出：

```text
{ answer: 1 } 1
```

## 手写时的隐患

只用 Map 包住一个加载函数，容易遗漏共享请求、过期和负缓存：

```ts doc-test=check
const values = new Map<string, unknown>()
async function read(key: string) {
  if (values.has(key)) return values.get(key) // 没有到期时间，旧值会一直留下。
  const value = await Promise.resolve({ answer: 42 }) // 并发请求各自回源。
  values.set(key, value) // undefined 的缓存策略也需要单独决定。
  return value
}
console.log(await read('answer'))
```

## 三分钟理解

`请求 → 按层查找 → 命中则返回并回填 → 缺失则共享回源 → 写入各层`。

| 名称     | 含义                                     |
| -------- | ---------------------------------------- |
| tier 层  | 从快到慢排列的已安装 KV 后端             |
| through  | 等本次写入结算，从最慢层向上处理         |
| back     | 同键待写项合并后延迟处理，失败报告并丢弃 |
| negative | 对加载结果 `undefined` 的短期缓存        |
| stale    | 已过新鲜期但仍在有效期限内的值           |

## 常见场景

| 想做什么                   | 组合                           | 示例                                       |
| -------------------------- | ------------------------------ | ------------------------------------------ |
| 合并热门请求和缺失查询     | `getOrLoad` + `negativeTtlMs`  | [缺失值](./USEGUIDE.md#加载缺失值与负缓存) |
| 本地层加持久层             | 多个 tiers                     | [组合多个层](./USEGUIDE.md#组合多个层)     |
| 按标签失效，较大值放对象层 | `tagIndex` + `offload`         | [标签与大值](./USEGUIDE.md#标签与大值)     |
| 用模型元数据筛选相似回答   | semantic Feature + vector 后端 | [语义缓存](./USEGUIDE.md#选择语义缓存)     |

## 安装

这些 storage 包当前是 `private: true` 的仓库 workspace 包，尚不作为已发布的 registry 包提供。以下命令用于仓库内的消费包：

```bash
pnpm add --workspace @migaia/storage-plugin-cache @migaia/storage-host @migaia/storage-contract
```

运行环境要求 Node.js 24 或相应兼容环境。使用 Redis、PostgreSQL 等层时，还需安装各后端插件及其真实客户端 peer。语义 Feature 额外需要你提供嵌入函数和支持 vector 的后端；根入口不自动启用它。

## 常用 API

| API                                              | 用途                                    |
| ------------------------------------------------ | --------------------------------------- |
| `cachePlugin(options, features?)`                | 选择已有数据层与可选 Feature            |
| `getOrLoad` / `getOrLoadEntry` / `getOrLoadMany` | 读取或共享回源；Entry 形式还给出状态    |
| `peek(key)` / `stats()`                          | 查看条目与计数，不调用加载函数          |
| `invalidate(key \| { prefix } \| { tag })`       | 删除匹配副本                            |
| `flush()` / `sweepOffload()`                     | 刷出待写项，或清理已到期的外置对象      |
| `cacheKey(namespace, input)`                     | 用 portable 序列化与 SHA-256 生成稳定键 |

## 使用边界

- 每个层必须在更早安装批次中已经可用，并支持 KV。配置 `ttlMs` 的层还必须支持 TTL；最慢层必须使用 `through`。缓存不提供跨层原子提交或事务。
- 层读取失败会报告并按未命中处理；层写入失败会报告并跳过。加载或编码失败报 `CACHE_LOAD_FAILED`，嵌入失败报 `CACHE_EMBED_FAILED`，原错误在 `cause` 中。缓存错误 source 为 `storage.backend.cache`；参数与能力错误也可能来自 storage-contract。
- 普通 `get/set` 用于字符串；`get` 只读普通 `set` 写入的条目。对象值和负条目请用 `getOrLoad`、`getOrLoadEntry` 与 `peek`。
- 默认启用失效传播，订阅在 `detect()` 时建立。变更源上方各层必须有硬 TTL；通知不是跨层提交保证。建议使用专门的缓存后端，避免业务 clear 通知清掉无关副本。
- `write: 'back'` 不是持久队列。失败不重试；`flush()` 立即处理当前待写项，关闭前也会刷出一次。开启传播时，back 层必须位于所有变更源下方且有 TTL；不满足会拒绝配置。
- 多层 `removeByPrefix` 无法给出可靠去重数量，会在 I/O 前报 `UNSUPPORTED_CAPABILITY`。用无计数的 `invalidate({ prefix })` 删除多层副本；`removeMany` 对已知不同逻辑键只计一次。
- `host.org(uuid).backend('cache')` 把各层路由到同一组织。关闭缓存排空已接纳工作并取消订阅，不单独关闭借用层；关闭宿主会统一释放它安装的后端。
