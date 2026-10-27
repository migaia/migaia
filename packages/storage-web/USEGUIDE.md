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

## IndexedDB 显式装配与迁移

`indexedDbBackendPlugin` 默认只安装基础文本、字节、记录及原生事务。以前自动启用的原生索引/backfill、TTL、批量 KV、journal 镜像与 undo、提交后通知、变更流，现在各有独立 Feature；业务没有导入并声明的实现不会因这个后端的基础入口进入构建。这是有意的行为变更，用于让应用控制浏览器产物。迁移现有应用时，为实际使用的能力逐项增加下列声明；普通存读不需要增加声明。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbIndexesFeature } from '@migaia/storage-web/features/indexed-db-indexes'
import { indexedDbKeysetFeature } from '@migaia/storage-web/features/indexed-db-keyset'
import { indexedDbTtlFeature } from '@migaia/storage-web/features/indexed-db-ttl'
import { indexedDbBatchFeature } from '@migaia/storage-web/features/indexed-db-batch'
import { indexedDbJournalFeature } from '@migaia/storage-web/features/indexed-db-journal'
import { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'
import { indexedDbChangeFeedFeature } from '@migaia/storage-web/features/indexed-db-change-feed'

const host = await createStorageHost({
  plugins: [
    indexedDbBackendPlugin(
      { dbName: 'my-app' },
      {
        indexes: indexedDbIndexesFeature(),
        keyset: indexedDbKeysetFeature(),
        ttl: indexedDbTtlFeature(),
        batch: indexedDbBatchFeature(),
        journal: indexedDbJournalFeature(),
        notifications: indexedDbNotificationsFeature(),
        changeFeed: indexedDbChangeFeedFeature()
      }
    )
  ]
})
try {
  await host.backend('indexed-db').set('theme', 'dark')
} finally {
  await host.dispose()
}
```

只选择需要的条目。`changeFeed` 需要同时显式选择 `notifications`，但不会替调用方安装；选择 `reactiveFeature(indexedDbBackendKind)` 后的 `.live()` 也需要 `notifications`，缺少时编码拒绝，不切换为轮询。memory 的 `.live()` 同样要求显式 `memoryNotificationsFeature()`；缺少时在 adapter/query 分配前报 `@migaia/storage-host / CHANGE_CONTROLLER_NOT_ASSEMBLED`。

缺少批量、journal、通知或变更流装配时调用对应入口，报 `@migaia/storage-web / INDEXED_DB_FEATURE_NOT_INSTALLED` 并指出所需 Feature；缺少 TTL 时 `store.use(ttl)` 由规范 capability owner 报 `@migaia/storage-contract / UNSUPPORTED_CAPABILITY`，消息指出 `ttl`。基础 `capabilities.secondaryIndexes`、`capabilities.batch`、`capabilities.changeFeed` 均为 false。已选择变更流仍须通过原生 realm/BroadcastChannel 准入。

重新打开曾使用 TTL 的数据库时保留 TTL Feature 声明；基础读取不解释到期元数据。未声明 TTL 的客户端覆盖、删除或清空目标时，会在同一原生事务清除该目标的旧期限；后续重建值不继承期限，也不会被另一 TTL 客户端按旧期限删除。

`indexedDbJournalFeature()` 提供原生镜像、私有日志 namespace 和 undo 端点；全局记录还须在同一插件列表的后端之前显式安装 `storageJournalPlugin()`（来自 `@migaia/storage-host/journal`），并保留原 `journal` 配置。journal 镜像读取和恢复原有物理期限，不替调用方启用 TTL 到期策略。物理写入版本与墓碑保留在基础写路径，使已装 journal 的其他实例仍可识别修改、删除和重建冲突；基础路径不捕获镜像或创建日志。

原始 `store.use(records).query().page()` 与 `.after()` 另外需要在后端 Feature 配置中选择 `@migaia/storage-web/features/indexed-db-keyset` 的 `indexedDbKeysetFeature()`；基础 `.all()` 仍可使用。该单元借用 host 规范游标实现，不自动启用原生索引。缺少声明时，分页会在打开 reader 前报 `@migaia/storage-web / INDEXED_DB_FEATURE_NOT_INSTALLED` 并指出缺少的工厂。实体分页独立选择 `entityKeysetFeature()`，不要求这个原始查询 Feature。

## 批量 KV 与结构键

通过 `store.use(kv)` 调用 `getMany(keys)`、`setMany(entries)`、`removeMany(keys)` 和 `removeByPrefix(prefix)`。IndexedDB 的每次非空批量调用只进入一次管线并使用一个原生事务；中途通道冲突使整批回滚。`getMany` 保留重复位置与缺失的 `undefined`；`removeMany` 对规范等价键只计一次。`setMany` 的重复规范键在任何 I/O 前报 `INVALID_ARGUMENT`；携带 `ttlMs` 还要求后端声明 TTL 能力。空批直接返回，不触发管线、hooks 或原生请求。

文本 Web 后端使用同步原生读取处理 `getMany`，Cookie 从一次可见 header 快照读取整批。未配置 WAL 时，多键写入和前缀删除在修改前报 `UNSUPPORTED_CAPABILITY`，不能依靠逐个公开 `set` 组成原子批量。

默认 namespace codec 保留原字符串 `sw1` 格式；非字符串批量键以顶层 `sw2` 格式区分，键内容复用共享规范编码。任意旧字符串键均不会与结构键碰撞。`keys()` 保持 `string[]`，命名空间 clear 同时删除该命名空间的两种布局。自定义 `INamespaceCodec` 可以增加 `encodeStorageKey(namespace,key)` 与 `decodeStorageKey(namespace,physicalKey)`；两者必须成对提供并保证跨键类型不碰撞。缺少这两个接点时，新的非字符串批量读取在任何原生 I/O 前报 `UNSUPPORTED_CAPABILITY`，原字符串布局和调用保持。

## 原生 IndexedDB 事务

```ts
import { createStorageHost } from '@migaia/storage-host'
import { kv, records } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbBatchFeature } from '@migaia/storage-web/features/indexed-db-batch'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'my-app' }, { batch: indexedDbBatchFeature() })]
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

基础 `defineEntity` 只定义、连接和读写。查询在实体配置的 `features` 中选择 `entityQueryFeature()`（`@migaia/storage-host/entity/query`）；唯一约束选择 `/entity/unique` 的 `entityUniqueFeature()`；迁移选择 `/entity/migration` 的 `entityMigrationFeature()`；索引规划选择 `/entity/indexes` 的 `entityIndexesFeature()`；keyset 分页选择 `/entity/keyset` 的 `entityKeysetFeature()`。索引查询组合 query 与 indexes，分页组合 query 与 keyset；IndexedDB 原生索引还需后端的 `indexedDbIndexesFeature()`。各项独立声明，不会自动安装。

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
import { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'

const runtime = createRuntime()
const host = await createStorageHost({
  plugins: [
    indexedDbBackendPlugin(
      { dbName: 'my-app' },
      {
        notifications: indexedDbNotificationsFeature(),
        reactive: reactiveFeature(indexedDbBackendKind)
      }
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

显式选择 `indexedDbNotificationsFeature()` 与 `indexedDbChangeFeedFeature()` 后，IndexedDB 通过 `store.watch(key, ctx?)` 提供原生文本失效迭代器。仅当实例已准入当前 realm 的 IndexedDB 与 BroadcastChannel 时 `capabilities.changeFeed` 为 `true`；未准入时调用报 `UNSUPPORTED_CAPABILITY`。提示携带原宿主的组织 UUID，收到提示后重新读取已提交的原生值；这不提供历史重放或每次写入一条事件的保证。迭代器复用原资源清理，使用后调用 `dispose()`。

显式选择 `indexedDbTtlFeature()` 后，IndexedDB 提供 `ttl`：`store.use(ttl)` 的 `expire`、`remaining`、`persist` 支持文本、字节和记录目标，事务内用 `scope.use(ttl)`。`setMany` 的 `ttlMs` 与值在同一个原生事务提交或回滚。缺省不设期限，到期的点读、枚举和索引查询视为缺失，并在原事务中惰性删除、更新修订与变更提示；不启动清理定时器。期限按安装时捕获的本地时钟锚点与原 scheduler 推进，使用缺省时钟时跨页面和重开保持可比较。IndexedDB 没有向量通道，向量 TTL 目标在 I/O 前报 `UNSUPPORTED_CAPABILITY`。

文本组织视图的宿主缺省组织使用配置 namespace，其它组织使用 namespace + "/" + orgId，继续复用捕获的原生客户端、namespace codec 与 Cookie scope。配置目标以 "/" 加规范 UUID 结尾时在原生 I/O 前拒绝，单独 UUID 合法。dropOrg 只清该目标，保留其它组织及插件前缀，既有视图仍可复用；借用实体保留原生原子唯一写入端点。IndexedDB 使用相同规则映射 dbName；dropOrg 先让目标连接进入原生 close-pending 并排空其事务，再等待该目标的 deleteDatabase 完成。删除期间新打开等待同一原生请求；完成后原视图可重新打开。其它实例沿原 versionchange 关闭；拒绝关闭的外部连接会使原生删除继续等待，宿主不会提前恢复打开并让迟到删除损坏新数据。

localStorage 仅在成功捕获同一 Window 的真实 localStorage 与 storage 事件源后声明 changeFeed:true；单独注入 Storage-like 仍为 false。原 watch/subscribeChanges 同时接本实例已提交写与跨文档原生事件，按 storageArea、namespace codec 和组织过滤；宿主关闭释放原监听者。通知由接收方原 controller 编号，不含原生写入方历史序号；应重读当前值，不保证逐写投递或同页面其它独立实例的原生事件。组织视图保留 watch 方法，调用仍检查运行时能力，且不获得后端关闭权。

## 原生 Blob 与 File 存储

从专用子入口选择 `indexedDbBlobFeature`，得到 `store.api.blobs` 与 `scope.api.blobs`。Blob/File 使用原生结构化克隆；File 的名称、类型和最后修改时间在重开后保留。仓库默认 `__migaia_blobs__`，可用 `{ storeName }` 指定；声明碰撞在开库前拒绝。Blob 请求与 records 共用原事务、取消、配额归一和回滚；组织视图使用自己的真实数据库及原事务拥有者。Feature 不授予关闭数据库的方法。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbBlobFeature } from '@migaia/storage-web/features/blobs'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'attachments' }, { blobs: indexedDbBlobFeature() })]
})
try {
  const store = host.backend('indexed-db')
  await store.transaction(async (scope) => {
    await scope.api.blobs.put('avatar', new Blob(['avatar bytes'], { type: 'text/plain' }))
    await scope.putRecord({ attachment: 'avatar' }, 'profile')
  })
  console.log(await (await store.api.blobs.get('avatar'))?.text())
} finally {
  await host.dispose()
}
```

显式选择 `indexedDbJournalFeature()` 后，IndexedDB 支持从 `@migaia/storage-host/journal` 调用 `storageLogStore(hostOrOrg, 'indexed-db', { prefix })`。私有行使用既有 META 对象仓库内的数组键命名空间。业务 `clearAll` 保留历史；删除组织使旧日志句柄失效，原业务视图仍可重新打开。缓存模式下，重新打开同一物理组织和前缀前须释放原日志。head、state 与记录随原生事务一同提交，缓存索引在真实 complete 事件内发布。

有原生 Web Locks 时，原资源期间独占与缓存路径保持，冲突打开报 LOCK_REJECTED。缺少 Web Locks、又未声明实际私有 factory 时，原 namespace 声明 `indexExclusive:false`：storageLogStore 不再拒绝，而是在每个操作的原 journal-store readwrite 事务内恢复/读取最新 lastSeq、state 与记录，不跨操作保留索引。注入 factory 有 Web Locks 时同样使用原缓存路径；`journalFactoryIsPrivate:true` 仅适用于数据宇宙局限当前 realm 且不转发共享持久库的真实私有 factory，继续复用原逻辑锁与缓存拥有者。对象身份本身不证明隔离。此命名空间支持本身不启用全局自动捕获或显式选择的 undo。

## IndexedDB 全局日志与显式 undo

在 `storageJournalPlugin` 的初始化函数中，用当前组织的 `storageLogStore` 打开原生 binlog 与 undo 仓库，再将同一对象交给 logger 插件及 `atomicBinlog` / `atomicUndo`。选择带 undo 插件的 logger 时必须显式设置 `indexedDbUndo: true`；缺省或 false 在业务原生事务前报 `UNSUPPORTED_CAPABILITY`。通过 Host 配置得到的后端与组织视图可调用 `undo(txId)`，恢复由原事务 builder 执行。

文本、字节、记录、清空与绝对 TTL 元数据的实际写入顺序保留在同一原生事务中；重复写入不按通道重排。原生 complete 才发布日志索引，回滚不增加日志序列。首次组织只读同样完成该组织的一次配置；惰性过期删除与日志一起提交。所有契约写入维护原生点修订，删除或清空后保留墓碑，因此其它无日志契约句柄的 clear/recreate 也会使旧 undo 报 `UNDO_CONFLICT`，在恢复任何目标前拒绝。undo 比对原物理镜像，恢复原绝对期限，不延长过期时间。

原生 Feature 直接借用 IDBDatabase / IDBTransaction，超出当前文本、字节、记录镜像域。启用提交日志的组合在交出该原生句柄前报 `UNSUPPORTED_CAPABILITY`；普通与仅遥测配置下的 Blob / 自定义原生 Feature 保持可用。此有限组合仍待共享目标与 codec 方案复查。严格 IndexedDB 不声明允许最终镜像后等待外部 WAL 的能力，该组合在业务 I/O 前拒绝。

localStorage/sessionStorage/Cookie 可用 `redo: true` 显式启用文本事务与多键写，并同时选择 `journal.redoWal: logger.wal`。该组合要求真实 Web Locks；所有参与者借用同一个真实、可见最新 pending 的原 WAL 对象。仅目标同名或不同 memoryLogStore 不构成共享。浏览器同源 popup 可直接借用 opener 持有的精确 Logger/WAL；持久恢复可用另一个 IDB 后端的 storageLogStore 作为单拥有者载体，不能用待增强文本后端给自己承载 WAL。

原 transaction owner 管理 text-only scope，读取自身 draft；先完整编码，再 wal.begin，顺序应用、binlog、complete，之后发布一次失效提示和成功。应用或 complete 失败会停止该实例准入并保留 pending，重开或已打开的参与 peer 在物理保护内先恢复再读取。回调失败不应用 draft。未选 redo 时原标量与同步行为保持；选中异步 journal 后同步入口沿原 ASYNC_STAGE_IN_SYNC_ENTRY 拒绝。redo 不宣称原生原子提交；undo/atomicBinlog/atomicUndo 与 raw 原生 Feature 句柄在该组合中修改前拒绝。独立 WAL 缓存之间的自动跨页恢复不作保证。

同一实例的 draft 活跃时，该实例根入口的读取、写入与另一事务立即报 `WRITE_CONFLICT`；独立调用方显式指定 `ConcurrencyPolicy.wait()` 也不会排队。回调内使用已提供的 scope。该隔离避免回调重入等待自身持有的 Web Lock；同实例排队 wait 尚未兑现。其它实例仍沿原 Web Locks 等待或取消，未选 redo 的原有行为保持。

Cookie 的 `redo: true` 复用同一原事务/WAL 协议；普通和 redo 写入共用原 cookie 编码、4096-byte 校验、固定 scope 与可见性检查。批量读取仍由同一原解析器读取一次可见 header，再合入当前 draft。redo 模式把 maxAge 在准备时转换为绝对 expiresAt 镜像，重放不续期；超过原生 Date 域的 maxAge 只在该新组合修改前拒绝，普通 Cookie maxAge 域和 Max-Age 优先级不变。该模式仅记录 JS 可见 cookie，HttpOnly/未知 scope 的原限制保持。

### 严格索引查询迁移

旧版 `.index(...).requirePushdown()` 在没有客户端步骤时允许全表扫描。现在显式索引来源若为 `fullScan`，或原生索引准备遇到竞争而只能扫描，终端读取会拒绝 `@migaia/storage-contract / QUERY_NOT_PUSHABLE`。需要原生索引时同时装配 `entityIndexesFeature()` 和后端索引 Feature；允许权威扫描时移除 `requirePushdown()`。普通查询继续保留扫描回退。IndexedDB 的借用视图与原生 store 共用能力身份；未迁移的旧格式记录使 readiness 保持 running；查询继续全表扫描并发出回退诊断，直到迁移状态完成且与当前定义一致。

没有迁移元数据时，只有从 canonical 起点开始、完整结束两个扫描阶段，且未遇到任何旧格式记录、未跳过任何无效 entity 记录的回填，才可变为 complete。当前格式数据因此无需 `entityMigrationFeature()` 也可使用原生 cursor。旧格式记录（含已有 canonical 副本的 shadow）或被跳过的无效记录使 readiness 保持 running；普通查询全表扫描并发出回退诊断，显式索引 strict 查询拒绝 `QUERY_NOT_PUSHABLE`。从持久 checkpoint 续跑不能证明前面的扫描干净。已有迁移元数据仍只接受 complete 状态和匹配的 schema fingerprint。
