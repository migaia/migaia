# cache 使用指南

[English](./USEGUIDE.en.md) · [概览与安装](./README.md)

| 你的问题                         | 看这里                                    |
| -------------------------------- | ----------------------------------------- |
| 合并重复回源，短期记住查无此项   | [加载缺失值与负缓存](#加载缺失值与负缓存) |
| 组合内存、磁盘或远程层           | [组合多个层](#组合多个层)                 |
| 返回旧值同时刷新，或取消单个请求 | [期限、刷新与取消](#期限刷新与取消)       |
| 按标签删除，减少大值副本         | [标签与大值](#标签与大值)                 |
| 按相似问题寻找可复用回答         | [选择语义缓存](#选择语义缓存)             |

## 加载缺失值与负缓存

基础层必须先安装，再用 `host.use(cachePlugin(...))` 追加缓存。只有配置 `negativeTtlMs` 后，加载结果 `undefined` 才会被短期保存。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'data' })] })
try {
  const host = await base.use(
    cachePlugin({
      tiers: [{ backend: 'data', ttlMs: 30000 }],
      negativeTtlMs: 1000
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  await cache.getOrLoad('profile:ada', async () => ({ name: 'Ada' }))
  console.log(await cache.getOrLoad('profile:ada', async () => ({ name: 'unused' })))
  // { name: 'Ada' }
  await cache.getOrLoad('profile:missing', async () => undefined)
  console.log((await cache.peek('profile:missing'))?.negative) // true
  await cache.invalidate('profile:ada')
} finally {
  await base.dispose()
}
```

`getOrLoadEntry` 还返回 `tier`、`stale`、`negative`、`ageMs`、`meta` 与 `tags`。`peek()` 不回源；缺失返回 `undefined`。`getOrLoadMany(keys, loader)` 对输入去重，按层批量读取，只把缺失且尚无共享任务的键交给 loader；loader 返回 `ReadonlyMap<string, value | undefined>`。

`stampedeLock: { backend, timeoutMs? }` 可选择 tiers 中支持真实事务与键锁的层，锁内复查并把值与 TTL 写入同一事务。timeoutMs 默认 `30000` 毫秒。事务重放可能再次调用 loader，不承诺回源只执行一次。

普通 `get/set` 只读写普通字符串条目，不用于读取上面编码的对象。键只接受字符串。需要由复杂参数生成稳定键时，使用 `await cacheKey('profile', { id: 'ada', version: 1 })`，从根入口导入 `cacheKey`；不支持的输入保留原 serializer 错误。

## 组合多个层

`tiers` 按从快到慢排列，默认每层 `write: 'through'`。下面用两个独立 memory 实例展示配置；换成 SQLite、Redis 或 PostgreSQL 时，先安装对应后端并保留相同 ID。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin, CacheWriteMode } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'fast' }), memoryBackendPlugin({ id: 'slow' })]
})
try {
  const host = await base.use(
    cachePlugin({
      propagate: false,
      tiers: [
        { backend: 'fast', ttlMs: 10000, write: CacheWriteMode.back },
        { backend: 'slow', ttlMs: 60000 }
      ],
      writeBackIntervalMs: 1000
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  await cache.set('status', 'ready')
  await cache.flush()
  console.log(await cache.get('status')) // ready
} finally {
  await base.dispose()
}
```

through 写入从最慢层向上完成；命中慢层会回填更快层。back 把同键待写项合并，默认每 `1000` 毫秒处理一次；失败报告后丢弃，不自动重试。最慢层不能用 back。这里关闭传播，以便独立演示 back；默认 `propagate: true` 时，所有变更源上方的层必须有 TTL，而 back 层必须在所有变更源下方并有 TTL。

失效订阅在 `detect()` 建立。可靠变更源的游标失效或丢失时，会先清上层对应前缀，再继续订阅；普通通知也不保证所有副本同时更新。给上层设置硬 TTL，限定通知遗漏造成的旧值期限。建议各层使用专用后端或专用实例。

`prefix` 默认是 `cache:<插件ID>:`，可为同一数据后端上的独立缓存选择不同前缀。`clock` 默认 `Date.now`，`random` 默认 `Math.random`；只有需要可控时间或抖动来源时才覆盖。`$cache.cursor` 是传播游标的保留键，不用于业务条目。

缓存没有跨层事务。层故障会报告并降级为未命中或跳过写入；一次调用成功不代表每个副本都已持久化。多层删除前缀请用 `invalidate({ prefix: 'profile:' })`，不要用需要返回数量的 KV `removeByPrefix`。

## 期限、刷新与取消

下面在不等待到期的情况下演示强制刷新与绕过：refresh 写入新值，bypass 的值只返回给本次调用。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'data' })] })
try {
  const host = await base.use(
    cachePlugin({
      tiers: [{ backend: 'data', ttlMs: 30000 }],
      maxAgeMs: 30000,
      staleAfterMs: 10000
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  let revision = 0
  const load = async () => ({ revision: ++revision })
  await cache.getOrLoad('answer', load)
  console.log(await cache.getOrLoad('answer', load, { mode: 'refresh' })) // { revision: 2 }
  console.log(await cache.getOrLoad('answer', load, { mode: 'bypass' })) // { revision: 3 }
  console.log(await cache.getOrLoad('answer', load)) // { revision: 2 }
} finally {
  await base.dispose()
}
```

| 选项            | 单位与默认               | 作用                                             |
| --------------- | ------------------------ | ------------------------------------------------ |
| tier `ttlMs`    | 正安全整数毫秒；默认未设 | 该层硬期限，需要后端 TTL 能力                    |
| `maxAgeMs`      | 正安全整数毫秒；默认未设 | 限制条目最大年龄                                 |
| `staleAfterMs`  | 正安全整数毫秒；默认未设 | 超过后先返回旧值，共享后台刷新；须小于有效硬期限 |
| `negativeTtlMs` | 正安全整数毫秒；默认未设 | 保存 `undefined` 的期限                          |
| `jitterRatio`   | `0` 到 `0.5`；默认 `0`   | 随机缩短期限，避免同时到期                       |
| per-call `mode` | `'default'`              | `'refresh'` 跳过读取；`'bypass'` 只回源          |

单次 `ttlMs/maxAgeMs/staleAfterMs/negativeTtlMs` 只能缩短已有配置上限，不能延长。正数单次 TTL 要求目标层都有 TTL 能力；普通 KV `setMany` 的共享 TTL 域另允许零，表示立即删除。

加载函数接收缓存关闭的 signal；调用方的 `options.ctx.signal` 只取消自己的等待，以 contract `ABORTED` 拒绝，不取消其它请求共享的加载。加载函数应响应传入 signal，关闭才能及时排空。`cacheIf(value)` 为 false 时不写各层。加载和编码失败为 `CACHE_LOAD_FAILED`，原错误留在 cause；不要把它当未命中吞掉。

## 标签与大值

标签索引需要 records 与 TTL；offload 需要 blob，且引用层必须有 TTL。下面均用内置 memory 能力展示完整组合，应用可换成对象存储插件保存大值。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({
  plugins: [
    memoryBackendPlugin({ id: 'values' }),
    memoryBackendPlugin({ id: 'tags' }),
    memoryBackendPlugin({ id: 'objects' })
  ]
})
try {
  const host = await base.use(
    cachePlugin({
      tiers: [{ backend: 'values', ttlMs: 30000, offload: { backend: 'objects', minBytes: 128 } }],
      tagIndex: { backend: 'tags' }
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  await cache.getOrLoad('article:1', async () => ({ body: 'x'.repeat(500) }), {
    tags: ['articles'],
    meta: { revision: 1 }
  })
  console.log((await cache.peek<{ body: string }>('article:1'))?.value?.body.length) // 500
  await cache.invalidate({ tag: 'articles' })
  console.log(await cache.peek('article:1')) // undefined
  await cache.sweepOffload()
} finally {
  await base.dispose()
}
```

达到 `minBytes` 的编码内容按内容哈希保存，对应层只保存引用；未达到则直接存值。`maxEntryBytes` 可让过大条目跳过某层。标签记录先于值写入，标签索引失败时报告并跳过值，避免生成无法按标签清理的条目。

失效只删除引用，不立即删除可能仍被其它键引用的对象。`sweepOffload()` 清理已过保留期限的对象，刚失效的对象可能仍需保留到最长引用 TTL；不要期待失效后立即释放全部空间。

## 选择语义缓存

从独立入口导入 `semanticCacheFeature`，在缓存插件第二参数选择。下面的两维嵌入只演示精确重复；真实应用应接自己的模型，维度、metric 和模型版本需与 collection 一致。

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin } from '@migaia/storage-plugin-cache'
import { semanticCacheFeature } from '@migaia/storage-plugin-cache/features/semantic'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'values' }), memoryBackendPlugin({ id: 'vectors' })]
})
try {
  const host = await base.use(
    cachePlugin(
      { tiers: [{ backend: 'values', ttlMs: 30000 }] },
      {
        semantic: semanticCacheFeature({
          backend: 'vectors',
          collection: 'answers',
          dimensions: 2,
          metric: 'cosine',
          minScore: 0.8,
          ttlMs: 30000,
          embed: async () => [1, 0]
        })
      }
    )
  )
  await host.detect()
  const semantic = host.backend('cache').api.semantic
  await semantic.set('Question', { text: 'Answer' }, { payload: { model: 'one' } })
  const hit = await semantic.get<{ text: string }>('Question', {
    where: { model: 'one' },
    candidates: 3,
    accept: (item) => item.prompt === 'Question'
  })
  console.log(hit?.value) // { text: 'Answer' }
  await semantic.invalidate({ model: 'one' }, { count: 'scroll' })
} finally {
  await base.dispose()
}
```

向量后端须在更早批次发布；设置 semantic TTL 时还需 TTL 能力。metric 默认为 `cosine`，还支持 `dot`、`euclid`；分数和候选顺序由原生向量引擎决定，不能跨 metric 沿用同一阈值。`candidates` 为 `1` 到 `10`，默认 `1`；逐个执行可选 `accept`，返回 false 则继续，accept 失败报告后跳过该候选。

payload 只支持字符串、有限数字与布尔值，`$cache.*` 是保留字段。相同 prompt 与不同 payload 分开保存。`getOrLoad` 按组织、prompt 与规范 payload 共享回源；其单次 TTL 只能缩短上限，`cacheIf` 可拒绝写入，单调用取消不影响其它等待者。嵌入失败报 `CACHE_EMBED_FAILED`。

`invalidate(where, { count })` 返回向量后端的删除数量；默认 `precount`，也可选 `scroll`。数量包含物理仍在但已过期的匹配点，继承后端的并发边界，不代表全局快照。semantic 只在明确选择后存在，经 `api.semantic` 使用，不增加缓存事务或关闭向量后端。

## 组织与结束工作

使用 `host.org(uuid).backend('cache')`，所有借用层及 Feature API 都使用该组织。缓存关闭会取消共享加载、等待已接纳工作、刷出一次 back 队列并取消订阅。它不单独关闭借用层；仍由宿主统一关闭已安装后端。`stats()` 只返回计数，tier 故障通过宿主 `report` 与缓存 hook 报告。
