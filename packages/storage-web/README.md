# `@migaia/storage-web`

为 `localStorage`、`sessionStorage`、Cookie 和 IndexedDB 提供浏览器后端。把选定后端安装到 `@migaia/storage-host`，由宿主负责准备与释放。

## 安装

```bash
pnpm add @migaia/storage-web @migaia/storage-host @migaia/storage-contract
```

示例需要支持顶层 `await` 的浏览器 ESM 环境，以及所选后端对应的原生浏览器 API。

## 保存偏好设置

```ts
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'

const host = await createStorageHost({
  plugins: [localStorageBackendPlugin({ id: 'preferences', namespace: 'my-app' })]
})
try {
  const preferences = host.backend('preferences')
  await preferences.set('theme', 'dark')
  console.log(await preferences.get('theme'))
} finally {
  await host.dispose()
}
```

输出 `dark`。释放宿主会关闭其拥有的监听器与连接，不清空浏览器持久化数据。

## 选择后端

| 入口              | 插件                          | 默认 ID      | 数据能力                          |
| ----------------- | ----------------------------- | ------------ | --------------------------------- |
| `local-storage`   | `localStorageBackendPlugin`   | `local`      | 文本与同步读写                    |
| `session-storage` | `sessionStorageBackendPlugin` | `session`    | 文本与同步读写                    |
| `cookies`         | `cookieBackendPlugin`         | `cookies`    | 文本与同步读写，仅 JS 可见 Cookie |
| `indexed-db`      | `indexedDbBackendPlugin`      | `indexed-db` | 文本、字节、记录、原生事务、索引  |

各后端入口还导出不透明种类标识及精确的选项、存储类型。`plugins/*` 入口导出对应插件函数。第一个参数为原生选项，第二个可选参数为 Feature 记录。共享能力与上下文类型直接从 `@migaia/storage-contract` 导入。

内存后端、`createStorageHost`、`defineFeature` 与后端作者接口属于 `@migaia/storage-host`。实体仓储、结构适配与存储编解码器属于 `@migaia/storage-host/entity`。

实体唯一约束写入需要真实 record 事务或后端原生原子 value 提交端点；内置浏览器后端均提供。自定义纯 value 后端未登记 `core.registerValueCommit` 时，唯一写入在 schema 执行和修改前报 `UNSUPPORTED_CAPABILITY`，普通 KV 不受影响。作者契约见 host 实体使用指南。

## 批量 KV

`store.use(kv)` 提供 `getMany`、`setMany`、`removeMany` 与 `removeByPrefix`。IndexedDB 批量在同一个原生事务中执行，支持字符串、数字、日期、字节和元组键；字符串仍与原单键方法共享数据。读取结果保留输入顺序与重复位置，缺失项为 `undefined`，删除返回实际数量；写批中的规范重复键在 I/O 前报 `INVALID_ARGUMENT`。空批不进入管线或原生事务。

localStorage、sessionStorage 与 Cookie 可批量读取；多键写需要 WAL，未配置时在修改前报 `UNSUPPORTED_CAPABILITY`。默认 namespace codec 保留字符串的 `sw1` 格式，结构键使用独立 `sw2` 格式；`keys()` 仍只列字符串，命名空间清理覆盖两种格式。自定义 codec 需成对提供 `encodeStorageKey` 与 `decodeStorageKey` 才能读取非字符串批量键，缺少时在原生 I/O 前报 `UNSUPPORTED_CAPABILITY`。

## IndexedDB 事务

```ts
import { createStorageHost } from '@migaia/storage-host'
import { kv, records } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'my-app' })]
})
try {
  const store = host.backend('indexed-db')
  await store.transaction(async (scope) => {
    await scope.use(kv).setMany([
      { key: ['settings', 'theme'], value: 'dark' },
      { key: ['settings', 'language'], value: 'en' }
    ])
    await scope.setBytes('avatar', new Uint8Array([1, 2]))
    await scope.putRecord({ id: 'a', name: 'Ada' }, ['users', 'a'])
    console.log(await scope.use(records).query().all())
  })
} finally {
  await host.dispose()
}
```

三个数据通道共用一个原生读写事务。只有通过所提供 scope 发起的方法参与事务。完成等待真实原生终态，失败回滚该事务。回调内不要等待定时器、网络请求或独立的根写入。原生事务失活时以 `TRANSACTION_FAILED` 失败，并保留原生原因；守护请求不会重新进入业务回调。

## 响应式查询

可选的 `features/reactive` 入口为受支持查询链增加 `.live()`。每个已安装 Feature 拥有独立服务，首次使用时才接入来源。响应式 Runtime 由调用者拥有。

```ts
import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendKind, indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { reactiveFeature } from '@migaia/storage-web/features/reactive'

const runtime = createRuntime()
const host = await createStorageHost({
  plugins: [
    indexedDbBackendPlugin(
      { dbName: 'my-app' },
      { reactive: reactiveFeature(indexedDbBackendKind) }
    )
  ]
})
try {
  const store = host.backend('indexed-db')
  const live = store.use(records).query<{ name: string }>().live({ runtime })
  try {
    await live.ready
    console.log(live.state.value)
    await live.refresh()
  } finally {
    await live.dispose()
  }
} finally {
  await host.dispose()
}
```

浏览器来源保留最终可见性边界：本地存储为 `document-eventual`，会话存储为 `top-level-context-eventual`，Cookie 为 `origin-js-visible-eventual`，IndexedDB 为 `origin-eventual`。四者保留原有 1000 毫秒协调轮询。变化仅表示查询失效，不承诺复制或立即观察任意原始写入。

## 边界

- 文本方法接受字符串键与字符串值；不存在的文本返回 `null`，记录返回 `undefined`。
- `clearValues` 只清文本通道，`clearAll` 只清该后端拥有的通道与命名空间。
- 同键跨通道写入报 `DUPLICATE_KEY`；显式 `conflictPolicy: 'replace'` 才在原子操作中替换其他通道。
- Cookie scope 在安装时固定。HttpOnly Cookie 不可见，`has: false` 不证明其不存在。
- 释放先封闭新接纳，再排空已接纳工作。显式清理通过返回的 Promise 传播失败，原始原因链保留。
- 宿主开始安装后的失败以 `@migaia/storage-host` 的 `BACKEND_INSTALL_FAILED` 拒绝，原浏览器错误保留在原因链。
- 按 `(source, code)` 分支。浏览器错误来源为 `@migaia/storage-web`，共享并发、取消与所有权错误保留原包身份。

选项、原生活跃窗口与生命周期详见[使用指南](./USEGUIDE.md)。

IndexedDB 通过 `store.watch(key, ctx?)` 提供原生文本失效迭代器。仅当实例已准入当前 realm 的 IndexedDB 与 BroadcastChannel 时 `capabilities.changeFeed` 为 `true`；未准入时调用报 `UNSUPPORTED_CAPABILITY`。提示携带原宿主的组织 UUID，收到提示后重新读取已提交的原生值；这不提供历史重放或每次写入一条事件的保证。迭代器复用原资源清理，使用后调用 `dispose()`。

IndexedDB 原生提供 `ttl`：`store.use(ttl)` 的 `expire`、`remaining`、`persist` 支持文本、字节和记录目标，事务内用 `scope.use(ttl)`。`setMany` 的 `ttlMs` 与值在同一个原生事务提交或回滚。缺省不设期限，到期的点读、枚举和索引查询视为缺失，并在原事务中惰性删除、更新修订与变更提示；不启动清理定时器。期限按安装时捕获的本地时钟锚点与原 scheduler 推进，使用缺省时钟时跨页面和重开保持可比较。IndexedDB 没有向量通道，向量 TTL 目标在 I/O 前报 `UNSUPPORTED_CAPABILITY`。

文本组织视图的宿主缺省组织使用配置 namespace，其它组织使用 namespace + "/" + orgId，继续复用捕获的原生客户端、namespace codec 与 Cookie scope。配置目标以 "/" 加规范 UUID 结尾时在原生 I/O 前拒绝，单独 UUID 合法。dropOrg 只清该目标，保留其它组织及插件前缀，既有视图仍可复用；借用实体保留原生原子唯一写入端点。IndexedDB 使用相同规则映射 dbName；dropOrg 先让目标连接进入原生 close-pending 并排空其事务，再等待该目标的 deleteDatabase 完成。删除期间新打开等待同一原生请求；完成后原视图可重新打开。其它实例沿原 versionchange 关闭；拒绝关闭的外部连接会使原生删除继续等待，宿主不会提前恢复打开并让迟到删除损坏新数据。
