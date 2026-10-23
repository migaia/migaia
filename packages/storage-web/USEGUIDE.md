# `@migaia/storage-web` 使用指南

使用选定的浏览器插件与真实宿主。示例需要原生浏览器 API；注入端口不会让 Node 进程拥有浏览器能力。

## 拥有具名浏览器后端

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

安装在发布存储前完成准备。可复用插件定义创建独立安装，不要分享已由其他宿主拥有的存储。同种后端安装多次时使用不同 ID。重复释放共享完成 Promise，关闭后的存储不能复活。

## Web Storage 选项

| 选项             | 默认值与行为                                                  |
| ---------------- | ------------------------------------------------------------- |
| `namespace`      | `default`；非空的逻辑数据命名空间                             |
| `namespaceCodec` | `lengthPrefixedNamespaceCodec`；编码命名空间与逻辑键          |
| `storage`        | 原生 `globalThis.localStorage` 或 `globalThis.sessionStorage` |
| `id`             | `local` 或 `session`；选择宿主中的注册项                      |

注入的 Storage 端口须实现 `length`、`getItem`、`setItem`、`removeItem`、`key`、`clear`。安装时探测可用性并保留已有数据。宿主拒绝访问报 `BACKEND_UNAVAILABLE`，配置非法报 `INVALID_CONFIG`，原生配额失败报 `QUOTA_EXCEEDED`。能力中的 5 MiB 为估计值，不保证浏览器实际配额。

默认命名空间 codec 使用 UTF-8 长度前缀，例如 `sw1:3:app:theme`，解码跳过损坏或其他空间的条目。自定义 codec 自行负责避免碰撞与格式迁移。`clearValues` 先快照匹配物理键再删除；原生失败可能留下部分清理结果，并保留失败的键。

## Cookie scope 与到期

```ts
import { createStorageHost } from '@migaia/storage-host'
import { cookieBackendPlugin } from '@migaia/storage-web/cookies'

const host = await createStorageHost({
  plugins: [
    cookieBackendPlugin({
      namespace: 'my-app',
      scope: { path: '/', sameSite: 'lax', secure: true }
    })
  ]
})
try {
  const cookies = host.backend('cookies')
  await cookies.set('theme', 'dark', { maxAge: 3600 })
  console.log(await cookies.get('theme'))
  await cookies.remove('theme')
} finally {
  await host.dispose()
}
```

`namespace` 默认 `default`，`document` 默认 `globalThis.document`。scope 默认 `{ path: '/' }`，所有写入与删除固定复用。domain 提供时须非空且不含空白或分号。`sameSite: 'none'`、`partitioned: true` 要求 `secure: true`。

写选项接受有效的 `expires: Date` 或整数 `maxAge`，已到期写入删除 Cookie。4096 字节上限覆盖包括属性的完整赋值。同名 Cookie 在多个 scope 同时可见时报 `COOKIE_SCOPE_AMBIGUOUS`，普通写入后不可见时报 `WRITE_FAILED`。JS 无法观察 HttpOnly 条目，也不能保证删除服务端 Cookie。

## 批量 KV 与结构键

通过 `store.use(kv)` 调用 `getMany(keys)`、`setMany(entries)`、`removeMany(keys)` 和 `removeByPrefix(prefix)`。IndexedDB 的每次非空批量调用只进入一次管线并使用一个原生事务；中途通道冲突使整批回滚。`getMany` 保留重复位置与缺失的 `undefined`；`removeMany` 对规范等价键只计一次。`setMany` 的重复规范键在任何 I/O 前报 `INVALID_ARGUMENT`；携带 `ttlMs` 还要求后端声明 TTL 能力。空批直接返回，不触发管线、hooks 或原生请求。

文本 Web 后端使用同步原生读取处理 `getMany`，Cookie 从一次可见 header 快照读取整批。未配置 WAL 时，多键写入和前缀删除在修改前报 `UNSUPPORTED_CAPABILITY`，不能依靠逐个公开 `set` 组成原子批量。

默认 namespace codec 保留原字符串 `sw1` 格式；非字符串批量键以顶层 `sw2` 格式区分，键内容复用共享规范编码。任意旧字符串键均不会与结构键碰撞。`keys()` 保持 `string[]`，命名空间 clear 同时删除该命名空间的两种布局。自定义 `INamespaceCodec` 可以增加 `encodeStorageKey(namespace,key)` 与 `decodeStorageKey(namespace,physicalKey)`；两者必须成对提供并保证跨键类型不碰撞。缺少这两个接点时，新的非字符串批量读取在任何原生 I/O 前报 `UNSUPPORTED_CAPABILITY`，原字符串布局和调用保持。

## 原生 IndexedDB 事务

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

`dbName` 默认 `storage-web`；`kvStoreName`、`bytesStoreName`、`recordsStoreName` 默认分别为 `kv`、`bytes`、`records`。名称须非空、互异，并避开内部保留 store。`factory`、`keyRange` 默认 `globalThis.indexedDB`、`globalThis.IDBKeyRange`。可选 `owner.label` 仅为诊断元数据，不作为锁身份。

宿主在发布前打开并准备选定数据库，缺少内部 store 时以原生版本升级创建。`onversionchange` 关闭旧连接，打开被阻塞时拒绝，不发布未完成准备的后端。`cleanupLegacyRecords` 默认 `false`，启用后仅在迁移成功后删除历史 store。

事务 scope 将文本、字节、记录与索引维护放在同一个原生事务中。`scope.use(kv)` 提供结构键批量方法，`scope.use(records)` 提供查询与有界前缀删除。根文本键仍为字符串。记录与 scope 文本键遵循 `@migaia/storage-contract` 的 `IStorageKey`，支持 number、Date、ArrayBuffer 与嵌套数组。

回调内只等待原生操作和保留活跃性的微任务。定时器或网络等待可能结束原生活跃窗口，之后的方法以 `TRANSACTION_FAILED` 及原生原因失败；捕获方法失败不会让事务转为提交。回调关闭后 scope 方法失去准入，finalizer 使用同事务的独立真实视图。已接纳操作、迭代器、回调与 finalizer 全部排空后才释放资源。

`setBytes` 快照输入字节，记录写入使用结构化克隆，不支持的值报 `SERIALIZE_FAILED`。原生提交完成后才发布通知，监听器失败会被报告，不撤销已提交写入。

## 实体仓储

从 `@migaia/storage-host/entity` 导入中立仓储定义，并连接实际已安装的 IndexedDB 存储。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

type IUser = { id: string; name: string }
const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'my-app' })]
})
try {
  const users = defineEntity<IUser>({ name: 'users', key: 'id' }).connect(
    host.backend('indexed-db')
  )
  await users.put({ id: 'a', name: 'Ada' })
  console.log(await users.get('a'))
} finally {
  await host.dispose()
}
```

宿主实体模块负责结构检查、版本 envelope、迁移与投影。普通读取只物化声明版本，不自动写回；显式 `migrate()` 才持久化升级。原生二级索引 readiness 在实际当前事务快照中检查。 唯一约束写入需要真实 record 事务，或后端在安装期间通过 `core.registerValueCommit` 登记的原生原子 value 提交端点；内置浏览器后端均提供相应路径。自定义纯 value 后端缺少该端点时，唯一约束的 `put` 与 `migrate` 在 schema 执行和任何修改前报 `UNSUPPORTED_CAPABILITY`；普通 KV 仍可使用。仅提供 `sync` 投影不构成跨页面原子性。

## 可选实时查询

使用下例时显式安装 `@migaia/reactive`，Feature 放在后端插件第二参数。

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

`ready` 观察初始工作，`refresh()` 加入当前工作或请求新一代，`state` 为只读 computed。`keepPreviousData` 默认 `true`，`equals` 默认不抑制更新。可选 `scope`、`matches` 过滤失效提示，谓词失败会报告并保守刷新。`timeoutMs` 对每一代生效，`signal` 取消查询整个生命周期。清理后调用者的 Runtime 仍可用。

来源保留原生最终可见性。local、session、Cookie、IndexedDB 使用混合失效与 1000 毫秒协调；来自 `@migaia/storage-host` 的内存后端使用实例内 push，不轮询。来源不承诺立即观察任意外部写入。

## 错误与关闭

同时检查 `source` 与 `code`。宿主开始安装后的失败以 host 的 `BACKEND_INSTALL_FAILED` 拒绝，原因链仍可达原浏览器错误。浏览器原生失败保留 cause 与 stack，并带有编码后的 `StorageError`；共享取消、锁、所有权检查、结构及编解码器错误保留原包身份。`ABORTED` 保留原取消原因。根据契约中的 `ConcurrencyPolicy` 处理并发，不因已提交通知失败重试业务写入。

`host.dispose()` 封闭新准入、取消排队成员、排空已接纳工作，再释放监听器与连接。显式后端清理以 `BACKEND_DISPOSE_FAILED` 传播失败，原始错误可达。重复显式调用共享 Promise，异步释放符号通过同一次清理提供独立的只报告完成投影。失败不会让已关闭后端复活。

## 从直接工厂迁移

用四个后端插件代替直接工厂，通过 `@migaia/storage-host` 安装。内存与宿主原语从该包导入，实体、结构适配与存储编解码器从其 `entity` 入口导入。旧响应式包装与宿主实时查询调用改为显式 `reactiveFeature(targetKind)` 和 `query.live()`。不提供历史工厂别名。

IndexedDB 通过 `store.watch(key, ctx?)` 提供原生文本失效迭代器。仅当实例已准入当前 realm 的 IndexedDB 与 BroadcastChannel 时 `capabilities.changeFeed` 为 `true`；未准入时调用报 `UNSUPPORTED_CAPABILITY`。提示携带原宿主的组织 UUID，收到提示后重新读取已提交的原生值；这不提供历史重放或每次写入一条事件的保证。迭代器复用原资源清理，使用后调用 `dispose()`。

IndexedDB 原生提供 `ttl`：`store.use(ttl)` 的 `expire`、`remaining`、`persist` 支持文本、字节和记录目标，事务内用 `scope.use(ttl)`。`setMany` 的 `ttlMs` 与值在同一个原生事务提交或回滚。缺省不设期限，到期的点读、枚举和索引查询视为缺失，并在原事务中惰性删除、更新修订与变更提示；不启动清理定时器。期限按安装时捕获的本地时钟锚点与原 scheduler 推进，使用缺省时钟时跨页面和重开保持可比较。IndexedDB 没有向量通道，向量 TTL 目标在 I/O 前报 `UNSUPPORTED_CAPABILITY`。

文本组织视图的宿主缺省组织使用配置 namespace，其它组织使用 namespace + "/" + orgId，继续复用捕获的原生客户端、namespace codec 与 Cookie scope。配置目标以 "/" 加规范 UUID 结尾时在原生 I/O 前拒绝，单独 UUID 合法。dropOrg 只清该目标，保留其它组织及插件前缀，既有视图仍可复用；借用实体保留原生原子唯一写入端点。IndexedDB 组织删除仍属后续独立接线。
