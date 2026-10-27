# `@migaia/storage-plugin-browser`

为 `localStorage`、`sessionStorage`、Cookie 和 IndexedDB 提供浏览器后端。把选定后端安装到 `@migaia/storage-host`，由宿主负责准备与释放。

## 安装

```bash
pnpm add @migaia/storage-plugin-browser @migaia/storage-host @migaia/storage-contract
```

示例需要支持顶层 `await` 的浏览器 ESM 环境，以及所选后端对应的原生浏览器 API。

## 保存偏好设置

```ts
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-plugin-browser/local-storage'

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

| 入口              | 插件                          | 默认 ID      | 数据能力                                   |
| ----------------- | ----------------------------- | ------------ | ------------------------------------------ |
| `local-storage`   | `localStorageBackendPlugin`   | `local`      | 文本与同步读写                             |
| `session-storage` | `sessionStorageBackendPlugin` | `session`    | 文本与同步读写                             |
| `cookies`         | `cookieBackendPlugin`         | `cookies`    | 文本与同步读写，仅 JS 可见 Cookie          |
| `indexed-db`      | `indexedDbBackendPlugin`      | `indexed-db` | 文本、字节、记录、原生事务；索引需 Feature |

各后端入口还导出不透明种类标识及精确的选项、存储类型。`plugins/*` 入口导出对应插件函数。第一个参数为原生选项，第二个可选参数为 Feature 记录。共享能力与上下文类型直接从 `@migaia/storage-contract` 导入。

内存后端、`createStorageHost`、`defineFeature` 与后端作者接口属于 `@migaia/storage-host`。实体仓储、结构适配与存储编解码器属于 `@migaia/storage-host/entity`。

实体唯一约束写入需要真实 record 事务或后端原生原子 value 提交端点；内置浏览器后端均提供。自定义纯 value 后端未登记 `core.registerValueCommit` 时，唯一写入在 schema 执行和修改前报 `UNSUPPORTED_CAPABILITY`，普通 KV 不受影响。作者契约见 host 实体使用指南。

## IndexedDB 显式装配与迁移

`indexedDbBackendPlugin` 默认只安装基础文本、字节、记录及原生事务。以前自动启用的原生索引/backfill、TTL、批量 KV、journal 镜像与 undo、提交后通知、变更流，现在各有独立 Feature；业务没有导入并声明的实现不会因这个后端的基础入口进入构建。这是有意的行为变更，用于让应用控制浏览器产物。迁移现有应用时，为实际使用的能力逐项增加下列声明；普通存读不需要增加声明。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { indexedDbIndexesFeature } from '@migaia/storage-plugin-browser/features/indexed-db-indexes'
import { indexedDbKeysetFeature } from '@migaia/storage-plugin-browser/features/indexed-db-keyset'
import { indexedDbTtlFeature } from '@migaia/storage-plugin-browser/features/indexed-db-ttl'
import { indexedDbBatchFeature } from '@migaia/storage-plugin-browser/features/indexed-db-batch'
import { indexedDbJournalFeature } from '@migaia/storage-plugin-browser/features/indexed-db-journal'
import { indexedDbNotificationsFeature } from '@migaia/storage-plugin-browser/features/indexed-db-notifications'
import { indexedDbChangeFeedFeature } from '@migaia/storage-plugin-browser/features/indexed-db-change-feed'

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

缺少批量、journal、通知或变更流装配时调用对应入口，报 `@migaia/storage-plugin-browser / INDEXED_DB_FEATURE_NOT_INSTALLED` 并指出所需 Feature；缺少 TTL 时 `store.use(ttl)` 由规范 capability owner 报 `@migaia/storage-contract / UNSUPPORTED_CAPABILITY`，消息指出 `ttl`。基础 `capabilities.secondaryIndexes`、`capabilities.batch`、`capabilities.changeFeed` 均为 false。已选择变更流仍须通过原生 realm/BroadcastChannel 准入。

重新打开曾使用 TTL 的数据库时保留 TTL Feature 声明；基础读取不解释到期元数据。未声明 TTL 的客户端覆盖、删除或清空目标时，会在同一原生事务清除该目标的旧期限；后续重建值不继承期限，也不会被另一 TTL 客户端按旧期限删除。

`indexedDbJournalFeature()` 提供原生镜像、私有日志 namespace 和 undo 端点；全局记录还须在同一插件列表的后端之前显式安装 `storageJournalPlugin()`（来自 `@migaia/storage-host/journal`），并保留原 `journal` 配置。journal 镜像读取和恢复原有物理期限，不替调用方启用 TTL 到期策略。物理写入版本与墓碑保留在基础写路径，使已装 journal 的其他实例仍可识别修改、删除和重建冲突；基础路径不捕获镜像或创建日志。

原始 `store.use(records).query().page()` 与 `.after()` 另外需要在后端 Feature 配置中选择 `@migaia/storage-plugin-browser/features/indexed-db-keyset` 的 `indexedDbKeysetFeature()`；基础 `.all()` 仍可使用。该单元借用 host 规范游标实现，不自动启用原生索引。缺少声明时，分页会在打开 reader 前报 `@migaia/storage-plugin-browser / INDEXED_DB_FEATURE_NOT_INSTALLED` 并指出缺少的工厂。实体分页独立选择 `entityKeysetFeature()`，不要求这个原始查询 Feature。

## 批量 KV

`store.use(kv)` 提供 `getMany`、`setMany`、`removeMany` 与 `removeByPrefix`。IndexedDB 批量在同一个原生事务中执行，支持字符串、数字、日期、字节和元组键；字符串仍与原单键方法共享数据。读取结果保留输入顺序与重复位置，缺失项为 `undefined`，删除返回实际数量；写批中的规范重复键在 I/O 前报 `INVALID_ARGUMENT`。空批不进入管线或原生事务。

localStorage、sessionStorage 与 Cookie 可批量读取；多键写需要 WAL，未配置时在修改前报 `UNSUPPORTED_CAPABILITY`。默认 namespace codec 保留字符串的 `sw1` 格式，结构键使用独立 `sw2` 格式；`keys()` 仍只列字符串，命名空间清理覆盖两种格式。自定义 codec 需成对提供 `encodeStorageKey` 与 `decodeStorageKey` 才能读取非字符串批量键，缺少时在原生 I/O 前报 `UNSUPPORTED_CAPABILITY`。

## IndexedDB 事务

```ts
import { createStorageHost } from '@migaia/storage-host'
import { kv, records } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { indexedDbBatchFeature } from '@migaia/storage-plugin-browser/features/indexed-db-batch'

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

三个数据通道共用一个原生读写事务。只有通过所提供 scope 发起的方法参与事务。完成等待真实原生终态，失败回滚该事务。回调内不要等待定时器、网络请求或独立的根写入。原生事务失活时以 `TRANSACTION_FAILED` 失败，并保留原生原因；守护请求不会重新进入业务回调。

## 响应式查询

可选的 `features/reactive` 入口为受支持查询链增加 `.live()`。每个已安装 Feature 拥有独立服务，首次使用时才接入来源。响应式 Runtime 由调用者拥有。

```ts
import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import {
  indexedDbBackendKind,
  indexedDbBackendPlugin
} from '@migaia/storage-plugin-browser/indexed-db'
import { reactiveFeature } from '@migaia/storage-plugin-browser/features/reactive'
import { indexedDbNotificationsFeature } from '@migaia/storage-plugin-browser/features/indexed-db-notifications'

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

浏览器来源保留最终可见性边界：本地存储为 `document-eventual`，会话存储为 `top-level-context-eventual`，Cookie 为 `origin-js-visible-eventual`，IndexedDB 为 `origin-eventual`。四者保留原有 1000 毫秒协调轮询。变化仅表示查询失效，不承诺复制或立即观察任意原始写入。

## 边界

- 文本方法接受字符串键与字符串值；不存在的文本返回 `null`，记录返回 `undefined`。
- `clearValues` 只清文本通道，`clearAll` 只清该后端拥有的通道与命名空间。
- 同键跨通道写入报 `DUPLICATE_KEY`；显式 `conflictPolicy: 'replace'` 才在原子操作中替换其他通道。
- Cookie scope 在安装时固定。HttpOnly Cookie 不可见，`has: false` 不证明其不存在。
- 释放先封闭新接纳，再排空已接纳工作。显式清理通过返回的 Promise 传播失败，原始原因链保留。
- 宿主开始安装后的失败以 `@migaia/storage-host` 的 `BACKEND_INSTALL_FAILED` 拒绝，原浏览器错误保留在原因链。
- 按 `(source, code)` 分支。浏览器错误来源为 `@migaia/storage-plugin-browser`，共享并发、取消与所有权错误保留原包身份。

选项、原生活跃窗口与生命周期详见[使用指南](./USEGUIDE.md)。

显式选择 `indexedDbNotificationsFeature()` 与 `indexedDbChangeFeedFeature()` 后，IndexedDB 通过 `store.watch(key, ctx?)` 提供原生文本失效迭代器。仅当实例已准入当前 realm 的 IndexedDB 与 BroadcastChannel 时 `capabilities.changeFeed` 为 `true`；未准入时调用报 `UNSUPPORTED_CAPABILITY`。提示携带原宿主的组织 UUID，收到提示后重新读取已提交的原生值；这不提供历史重放或每次写入一条事件的保证。迭代器复用原资源清理，使用后调用 `dispose()`。

显式选择 `indexedDbTtlFeature()` 后，IndexedDB 提供 `ttl`：`store.use(ttl)` 的 `expire`、`remaining`、`persist` 支持文本、字节和记录目标，事务内用 `scope.use(ttl)`。`setMany` 的 `ttlMs` 与值在同一个原生事务提交或回滚。缺省不设期限，到期的点读、枚举和索引查询视为缺失，并在原事务中惰性删除、更新修订与变更提示；不启动清理定时器。期限按安装时捕获的本地时钟锚点与原 scheduler 推进，使用缺省时钟时跨页面和重开保持可比较。IndexedDB 没有向量通道，向量 TTL 目标在 I/O 前报 `UNSUPPORTED_CAPABILITY`。

文本组织视图的宿主缺省组织使用配置 namespace，其它组织使用 namespace + "/" + orgId，继续复用捕获的原生客户端、namespace codec 与 Cookie scope。配置目标以 "/" 加规范 UUID 结尾时在原生 I/O 前拒绝，单独 UUID 合法。dropOrg 只清该目标，保留其它组织及插件前缀，既有视图仍可复用；借用实体保留原生原子唯一写入端点。IndexedDB 使用相同规则映射 dbName；dropOrg 先让目标连接进入原生 close-pending 并排空其事务，再等待该目标的 deleteDatabase 完成。删除期间新打开等待同一原生请求；完成后原视图可重新打开。其它实例沿原 versionchange 关闭；拒绝关闭的外部连接会使原生删除继续等待，宿主不会提前恢复打开并让迟到删除损坏新数据。

localStorage 仅在成功捕获同一 Window 的真实 localStorage 与 storage 事件源后声明 changeFeed:true；单独注入 Storage-like 仍为 false。原 watch/subscribeChanges 同时接本实例已提交写与跨文档原生事件，按 storageArea、namespace codec 和组织过滤；宿主关闭释放原监听者。通知由接收方原 controller 编号，不含原生写入方历史序号；应重读当前值，不保证逐写投递或同页面其它独立实例的原生事件。组织视图保留 watch 方法，调用仍检查运行时能力，且不获得后端关闭权。

## 原生 Blob 与 File 存储

从专用子入口选择 `indexedDbBlobFeature`，得到 `store.api.blobs` 与 `scope.api.blobs`。Blob/File 使用原生结构化克隆；File 的名称、类型和最后修改时间在重开后保留。仓库默认 `__migaia_blobs__`，可用 `{ storeName }` 指定；声明碰撞在开库前拒绝。Blob 请求与 records 共用原事务、取消、配额归一和回滚；组织视图使用自己的真实数据库及原事务拥有者。Feature 不授予关闭数据库的方法。

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { indexedDbBlobFeature } from '@migaia/storage-plugin-browser/features/blobs'

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

普通 localStorage、sessionStorage 与 Cookie 声明 `capabilities.batch: false`；显式选择 batch Feature 的 IndexedDB 与显式 redo/WAL 组合声明为 true。启用 commit journal 时不提供原生 IndexedDB 句柄，错误 source 为 `@migaia/storage-contract`、code 为 `UNSUPPORTED_CAPABILITY`。IndexedDB 不提供向量引擎。本仓库网站在新 host 包发布前继续使用已发布的 storage-plugin-browser 0.0.8。

## 实体编解码器与复制边界

实体编解码器从 `@migaia/storage-host/entity` 导入。`jsonCodec` 的 `output` 为 `text`，使用严格的可移植 JSON；`structuredCodec` 的 `output` 为 `structured`，把结构化值交给后端；`binaryCodec` 的 `output` 为 `binary`，处理 `Uint8Array`。`selectCodec` 根据后端能力决定直连、回退或拒绝。

`jsonCodec` 不接受超出可移植值范围的对象，也不能表示循环。需要保留 `Map` 与 `Set` 时，使用 `@migaia/serialize/codecs/collections-json` 的 `defineCollectionsJsonCodec`，再由 `@migaia/storage-host/authoring/codec` 的 `fromValueCodec` 适配。`structuredCodec` 可交给后端保存可 structured-clone 的内建类型与循环。

`structuredCodec` 的 `encode/decode` 原样返回值，不复制；真正复制在记录后端。IndexedDB 的字节与记录写入遵循原生结构化克隆；内存后端会复制字节，记录采用 `structuredClone`。`binaryCodec` 校验后原样返回字节视图，后端负责写入快照。它们不重建 class 业务实例，也不做 schema 校验。

`schema` 处理领域表示，`codec` 处理保存格式。读取依次执行 `codec.decode`、版本迁移（存储表示）、`schema.decode`、`validate`。结构化输出在文本后端以 `UNSUPPORTED_CAPABILITY` 拒绝，不会悄悄改成 JSON。

### 严格索引查询迁移

旧版 `.index(...).requirePushdown()` 在没有客户端步骤时允许全表扫描。现在显式索引来源若为 `fullScan`，或原生索引准备遇到竞争而只能扫描，终端读取会拒绝 `@migaia/storage-contract / QUERY_NOT_PUSHABLE`。需要原生索引时同时装配 `entityIndexesFeature()` 和后端索引 Feature；允许权威扫描时移除 `requirePushdown()`。普通查询继续保留扫描回退。IndexedDB 的借用视图与原生 store 共用能力身份；未迁移的旧格式记录使 readiness 保持 running；查询继续全表扫描并发出回退诊断，直到迁移状态完成且与当前定义一致。
