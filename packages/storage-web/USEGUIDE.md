# `@migaia/storage-web` 使用指南

先按场景选择完整示例；本页只运行真实内存后端，不模拟 IndexedDB 或 Cookie，浏览器后端边界在契约参考中说明。

| 要解决的问题                   | 公开入口          | 完整场景                                |
| ------------------------------ | ----------------- | --------------------------------------- |
| 修改输入与读取结果时不污染存储 | memoryStorageHost | [开始](#修改输入与读取结果时不污染存储) |
| 丢弃失败草稿并保留无关写入     | memoryStorageHost | [开始](#丢弃失败草稿并保留无关写入)     |
| 让不同记录种类复用同一个主键   | defineEntity      | [开始](#让不同记录种类复用同一个主键)   |
| 在同一事务最终草稿中转移唯一值 | defineEntity      | [开始](#在同一事务最终草稿中转移唯一值) |
| 先读取升级结果再显式保存新版本 | defineEntity      | [开始](#先读取升级结果再显式保存新版本) |
| 统一拥有和关闭具名后端实例     | createStorageHost | [开始](#统一拥有和关闭具名后端实例)     |

## 运行前准备

安装本包；Host 场景还直接导入 storage-contract 的 StorageContractError，请显式安装这个依赖，不能假设可直接访问传递依赖。示例需要支持顶层 await 的 ESM TypeScript 环境。

```bash
pnpm add @migaia/storage-web @migaia/storage-contract
```

## 修改输入与读取结果时不污染存储

预览保存上传字节和用户资料后，还会继续修改本地对象；这些修改不应悄悄覆盖已保存的版本。

直接把对象放进 `Map` 会共享可变引用；读取时返回原字节数组或嵌套 `Map`，又给调用者提供了绕过写入方法的修改途径。

`memoryStorageHost` 在写入和读取时都复制字节，并对记录执行结构化克隆；字节使用 `setBytes/getBytes`，对象记录使用 `putRecord/getRecord`。

### 本例参数

memoryStorageHost 无选项，每次创建独立实例；setBytes 的 key/value 必填，字节须 Uint8Array；putRecord 本例显式指定 key，省略时自动生成；getBytes 不存在为 null，getRecord 不存在为 undefined，dispose 无参数。

```ts doc-test=run
import { memoryStorageHost } from '@migaia/storage-web/memory'

type IProfile = { visits: Map<string, number> }
const store = memoryStorageHost<IProfile>()
try {
  const bytes = new Uint8Array([1, 2])
  await store.setBytes('avatar', bytes)
  bytes[0] = 9
  const copy = await store.getBytes('avatar')
  if (copy) copy[1] = 8
  console.log(JSON.stringify(Array.from((await store.getBytes('avatar')) ?? [])))
  const profile = { visits: new Map([['home', 1]]) }
  await store.putRecord(profile, 'profile')
  profile.visits.set('home', 9)
  const record = await store.getRecord('profile')
  record?.visits.set('home', 8)
  console.log((await store.getRecord('profile'))?.visits.get('home'))
} finally {
  await store.dispose()
}
```

### 输出与边界

```text
[1,2]
1
```

逐行输出 `[1,2]` 和 `1`；修改原始输入与首次读取的副本，都没有改变下一次读取的结果。

每次工厂调用创建独立的易失存储；记录必须可被结构化克隆，这不是 JSON 转换，也不提供浏览器持久化，且没有原生二级索引。

## 丢弃失败草稿并保留无关写入

多记录操作在准备修改余额后失败，但操作期间通过独立路径写入的审计记录仍须保留。

逐步直接写入会留下半成品；失败时用旧 `Map` 覆盖整个存储，又可能抹掉期间已经成功完成的其他写入。

`memoryStorageHost.transaction` 先暂存记录改动，回调成功后才提交；本例主动让草稿失败，同时通过普通存储方法独立写入审计记录。

### 本例参数

transaction 的 run 必填，tx 只包含该事务的记录操作；回调外通过 store.putRecord 写 audit，独立提交；subscribeChanges 返回释放句柄，本例仅收集 change.kind，不改通知策略。

```ts doc-test=run
import { StorageError } from '@migaia/storage-web'
import { memoryStorageHost } from '@migaia/storage-web/memory'

const store = memoryStorageHost<{ count: number }>()
const original = new Error('请求失败')
try {
  await store.putRecord({ count: 1 }, 'balance')
  const changes: string[] = []
  const stop = store.subscribeChanges((change) => {
    changes.push(change.kind)
  })
  try {
    await store.transaction(async (tx) => {
      await tx.put({ count: 2 }, 'balance')
      await store.putRecord({ count: 9 }, 'audit')
      throw original
    })
  } catch (error) {
    if (!(error instanceof StorageError)) throw error
    console.log(error.code, error.cause === original)
  }
  console.log((await store.getRecord('balance'))?.count, (await store.getRecord('audit'))?.count)
  console.log(changes.join(','))
  stop()
} finally {
  await store.dispose()
}
```

### 输出与边界

```text
TRANSACTION_FAILED true
1 9
put
```

逐行输出 `TRANSACTION_FAILED true`、`1 9`、`put`；原始错误保留在 `cause`，余额仍为 `1`，只有独立审计写入发出变更通知。

事务只覆盖通过 `tx` 发起的记录操作，不会撤销任意外部副作用；回调失败会丢弃草稿，成功提交仍须通过乐观冲突检查，也可能以 `TRANSACTION_CONFLICT` 拒绝。

## 让不同记录种类复用同一个主键

用户和团队都有主键为 `1` 的记录；即使共用一个后端，保存团队也不应覆盖用户。

把原始主键直接当成全局 `Map` 键会让不同记录种类发生碰撞；到处拼接字符串前缀，又要求每次读取和删除都重复同一套编码规则。

`defineEntity` 用 `name` 确定记录种类，用 `key` 指定主键字段；把两份定义连接到同一个内存后端，各自的仓储就拥有独立记录空间。

### 本例参数

实体 name 与 key 必填，两个 name 分别为 users/teams；version 默认 1，schema 默认 passthrough，validateOnRead 默认 true，memory 连接默认 structuredCodec；name 隔离记录种类，不提供权限控制。

```ts doc-test=run
import { defineEntity } from '@migaia/storage-web/entity'
import { memoryStorageHost } from '@migaia/storage-web/memory'

type IRow = { id: string; name: string }
const store = memoryStorageHost()
const users = defineEntity<IRow>({ name: 'users', key: 'id' }).connect(store)
const teams = defineEntity<IRow>({ name: 'teams', key: 'id' }).connect(store)
try {
  await users.put({ id: '1', name: '艾达' })
  await teams.put({ id: '1', name: '研发' })
  console.log((await users.get('1'))?.name, (await teams.get('1'))?.name)
} finally {
  await store.dispose()
}
```

### 输出与边界

```text
艾达 研发
```

输出 `艾达 研发`；两个仓储共用后端与主键，仍分别读取到自己的记录。

版本默认 `1`，结构校验器默认 `passthrough`，不做校验；内存后端默认使用 `structuredCodec`，名称隔离记录种类，不承担访问权限控制，使用结束后释放存储。

## 在同一事务最终草稿中转移唯一值

两个页面各自连接同一个存储，既要拒绝邮箱被两个记录占用，也要允许在一批改动中把邮箱从旧记录转给新记录。

每个仓储自行维护唯一值缓存，会漏掉另一个仓储的写入；只检查批处理中间步骤，又会在旧所有者被移除前误拒绝合法转移。

用 `defineEntity<T>()({...})` 声明 `byEmail` 路径索引及 `unique: true`，两个仓储共同遵守约束，`batch` 检查最终草稿；本例用 `onDiagnostic` 静默诊断，突出业务输出。

### 本例参数

curried defineEntity 保留索引名与查询键推导；indexes.byEmail.path 指向 email，unique 默认 false、本例设 true；multiEntry 默认 false，revision 默认 1；onDiagnostic 默认 console.warn，本例覆盖为空函数；batch 的 tx.put/remove 按最终草稿检查。

```ts doc-test=run
import { StorageError } from '@migaia/storage-web'
import { defineEntity } from '@migaia/storage-web/entity'
import { memoryStorageHost } from '@migaia/storage-web/memory'

type IUser = { id: string; email: string }
const store = memoryStorageHost()
const definition = defineEntity<IUser>()({
  name: 'users',
  key: 'id',
  indexes: { byEmail: { path: 'email', unique: true } },
  onDiagnostic: () => {}
})
try {
  const first = definition.connect(store)
  const second = definition.connect(store)
  await first.put({ id: 'a', email: 'same@example.test' })
  try {
    await second.put({ id: 'b', email: 'same@example.test' })
  } catch (error) {
    if (!(error instanceof StorageError)) throw error
    console.log(error.code)
  }
  console.log((await second.get('b')) === undefined)
  await second.batch(async (tx) => {
    await tx.put({ id: 'b', email: 'same@example.test' })
    await tx.remove('a')
  })
  console.log(
    (await first.findBy('byEmail', 'same@example.test'))?.id,
    (await first.get('a')) === undefined
  )
} finally {
  await store.dispose()
}
```

### 输出与边界

```text
INDEX_UNIQUE_CONFLICT
true
b true
```

逐行输出 `INDEX_UNIQUE_CONFLICT`、`true`、`b true`；失败写入没有留下记录 `b`，后续批处理把邮箱转给 `b`，并移除了 `a`。

内存后端通过回退检查保证唯一性，没有原生索引；`unique` 默认 `false`，省略诊断回调时使用 `console.warn`，仓储 `batch` 要求后端支持记录事务与回滚。

## 先读取升级结果再显式保存新版本

新版本把已存字段改了名字；读取者需要立刻拿到新结构，但一次普通 `get` 不应悄悄改写已存记录。

把读取与迁移写入绑在一起，会让访问页面变成隐藏修改；只改 TypeScript 类型，又不会改变后端里旧数据的实际结构。

`defineEntity` 声明 `version: 2` 和必需的目标步骤 `2`，`get` 在内存中执行升级，`migrate` 才显式写回；本例将 `batchSize` 从默认 `100` 改成 `1`。

### 本例参数

version 默认 1、本例覆盖为 2；migrations 必须完整含目标步骤 2，回调接收前值和版本上下文；migrate 的 batchSize 默认 100、本例为 1，onInvalid 默认 skip；get 不写回，migrate 显式提交。

```ts doc-test=run
import { defineEntity } from '@migaia/storage-web/entity'
import { memoryStorageHost } from '@migaia/storage-web/memory'

type IOldUser = { id: string; name: string }
type IUser = { id: string; displayName: string }
const store = memoryStorageHost()
try {
  const old = defineEntity<IOldUser>({ name: 'users', key: 'id' }).connect(store)
  await old.put({ id: 'a', name: '艾达' })
  let upgrades = 0
  const users = defineEntity<IUser>({
    name: 'users',
    key: 'id',
    version: 2,
    migrations: {
      2: async (previous) => {
        upgrades += 1
        const value = previous as IOldUser
        return { id: value.id, displayName: value.name }
      }
    }
  }).connect(store)
  console.log((await users.get('a'))?.displayName, (await users.get('a'))?.displayName, upgrades)
  const result = await users.migrate({ batchSize: 1 })
  console.log(result.migrated, upgrades)
  console.log((await users.get('a'))?.displayName, upgrades)
} finally {
  await store.dispose()
}
```

### 输出与边界

```text
艾达 艾达 2
1 3
艾达 3
```

逐行输出 `艾达 艾达 2`、`1 3`、`艾达 3`；两次读取分别升级旧记录，`migrate` 再升级并保存一次，最后读取不再执行升级。

高于版本 `1` 的定义必须提供从 `2` 到当前版本的全部步骤；读取不写回，显式迁移返回逐记录处理统计，不承诺整个数据库一次原子升级。

## 统一拥有和关闭具名后端实例

偏好设置和临时草稿需要独立存储；应用退出时必须关闭两者，即使页面仍持有宿主之外的存储引用。

只把存储对象放进注册表，并没有确定谁负责清理；漏调一个释放方法，就会让旧页面继续通过残留引用写入。

直接安装 `@migaia/storage-contract` 以读取错误类型；`createStorageHost` 把两个 `memoryBackendPlugin` 实例安装到不同 ID，`backend` 返回真实存储；等待 `host.dispose()` 会释放这些插件创建的存储。

### 本例参数

createStorageHost 的 plugins 默认 []，此处显式安装两个 memoryBackendPlugin；其 id 默认 memory，本例分别覆盖为 preferences/drafts；整批 installTimeoutMs 默认 30000，scheduler 默认 systemScheduler；Host 释放所创建存储后，其读操作抛 storage-contract 的 STORE_DISPOSED。

```ts doc-test=run
import { StorageContractError } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-web/host'
import { memoryBackendPlugin } from '@migaia/storage-web/plugins/memory'

const host = await createStorageHost({
  plugins: [
    memoryBackendPlugin({ id: 'preferences' }),
    memoryBackendPlugin({ id: 'drafts' })
  ] as const
})
const preferences = host.backend('preferences')
const drafts = host.backend('drafts')
try {
  await preferences.set('theme', '深色')
  await drafts.set('theme', '浅色')
  console.log(await preferences.get('theme'), await drafts.get('theme'), host.backends().size)
} finally {
  await host.dispose()
}
try {
  await drafts.get('theme')
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code)
}
```

### 输出与边界

```text
深色 浅色 2
STORE_DISPOSED
```

逐行输出 `深色 浅色 2`、`STORE_DISPOSED`；两个后端的同名文本键保留独立值，宿主释放后，残留存储引用的读取被拒绝。

这些插件创建由宿主拥有的易失存储；初始插件全部安装完成后宿主才返回，整批安装预算默认 `30000` 毫秒，本例不证明浏览器持久化。

## 契约细节

### 分层、入口与能力判断

本包实现 storage-contract 的浏览器/内存后端，并提供可选 entity、schema、codec、Host 和 live query。它不是服务端数据库、跨设备复制或通用状态管理器。reactive 变化只是重新查询提示，不把绕过本库的原始写入伪装为强一致事件。依赖 capability、event-subscriber、lifecycle、plugin-host、reactive、resource、storage-contract、utils；模块按后端精确导入。

根入口只有稳定错误、错误文本和命名空间契约。共 22 个导出路径，包含根以及以下子入口；未导出的源码目录不是应用导入点：

| 子入口                                                                           | 作用                                   |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| memory / local-storage / session-storage / cookies / indexed-db                  | 五个直接后端                           |
| host                                                                             | createStorageHost 与 StorageHostFacade |
| plugins/memory / local-storage / session-storage / cookies / indexed-db          | 精确 backend plugin 子路径             |
| entity / schema / serialize                                                      | 仓储定义、领域校验/迁移与存储格式      |
| reactive-adapter                                                                 | 自定义 reactive source 的公开 Feature  |
| plugins/reactive                                                                 | reactive 公共契约                      |
| plugins/reactive/memory / local-storage / session-storage / cookies / indexed-db | 五个 canonical reactive factory        |

SSR、Node 或不含 DOM 类型的消费者使用 memory 子路径。浏览器持久化失败时，降级为易失内存必须由应用显式选择，不暗中切换后端。Host/plugin 的精确子路径使未选 backend 不进入该入口的依赖图；最终打包结果由构建器决定。

核心契约直接从 @migaia/storage-contract 导入，根不转出：IKeyValueStore、IRecordStore、IStorageCapabilities、IOperationContext、IWriteOptions、StorageContractError 及其守卫。isRecordStore/asRecordStore 无选项，既检查已知 backend，也检查完整能力与 L0/L1 方法；前者读取失败返回 false，后者不足则抛 UNSUPPORTED_CAPABILITY。

| 后端            | syncRead | binary / records / transactions / iteration | secondaryIndexes | changeFeed                        | maxValueBytes           | opaqueEntries |
| --------------- | -------- | ------------------------------------------- | ---------------- | --------------------------------- | ----------------------- | ------------- |
| local / session | true     | 全 false                                    | false            | false                             | 5 * 1024 * 1024，近似值 | false         |
| cookie          | true     | 全 false                                    | false            | false                             | 4096，含完整 assignment | true          |
| indexeddb       | false    | 全 true                                     | true             | 同源 coordination 接纳成功才 true | undefined               | false         |
| memory          | true     | 全 true                                     | false            | true                              | undefined               | false         |

这些能力有不同含义，不能用 records 推断所有后端都支持原生索引。Cookie 不透明条目和浏览器配额均有额外边界；IndexedDB 无 sync，memory.sync 也只含 L0 方法。

### 通用方法、键与提交

L0 方法为 get/set/remove/has/keys/clearValues/clearAll/dispose；get 不存在为 null，set 只接受 string，不隐式转换，remove 不存在幂等。clearValues 只清值通道，clearAll 清该 store 所拥有的全部通道/命名空间，不清别人的空间。同步后端的 sync 提供 get/set/remove/has/keys/clearValues，不提供同步 clearAll/dispose。

L1 增加 getBytes/setBytes/clearBytes、getRecord/putRecord/deleteRecord/clearRecords、iterateRecords 与 transaction；bytes 不存在为 null，record 不存在为 undefined。putRecord(value, key?, ctx?) 省略 key 会生成键并返回实际 IStorageKey。metadata 是可选附加通道，只有 IndexedDB 提供 get/set/delete；memory 和 KV-only 无跨调用迁移检查点。

IOperationContext 的 signal、timeoutMs、pageSize 均可省略。signal 默认 undefined，timeoutMs 默认 undefined，不主动设期限；timeoutMs 须为非负安全整数，pageSize 须为 1..4096 的整数，IndexedDB 游标实际默认 128。取消/超时先触发者结束等待为契约级 ABORTED；已进入原子提交的写入不伪报回滚。迭代的一个 deadline 覆盖整个生命周期，不是每页重置。同步写 options 只接受 conflictPolicy，不接受非 undefined signal/timeoutMs；Cookie 另有 expires/maxAge。

value/bytes/record 共用逻辑 key。ConflictPolicy 默认 conflict：同一 key 已在另一通道时抛 DUPLICATE_KEY，existingChannel/attemptedChannel 可读；replace 才在原子写内删除其它通道再写入。不应把同通道更新与跨通道冲突混淆。

IStorageKey 允许 string、有限 number、有效 Date、ArrayBuffer，以及非空、无洞、无循环的嵌套数组；不接受 Uint8Array 作为 key。snapshotStorageKey 验证并复制 key。深度上限 32（根为 0）、节点 4096、每个二进制组件 1 MiB。range 可含 lower/upper/lowerOpen/upperOpen；开闭标记须为 boolean，反向或空开区间拒绝 INVALID_ARGUMENT。

写入提交后才发布 change。同步/异步 change listener 或诊断 reporter 失败仍被报告并继续 fanout，不改变已经提交的写结果；不能因通知失败重试整个业务写入。backend.dispose 先封闭新接纳，等已接纳 mutation 安静后释放订阅、连接/transport；重复调用共享原 Promise，finalize 的失败仍传播，具体后端可以用 BACKEND_DISPOSE_FAILED 归一化，原错误沿 cause/errors 可达，不把清理失败一概吞掉。外部持久化数据不因 dispose 清空；memory 的数据随实例清理丢弃。

### Web Storage 与命名空间

localStorageHost(options?) 与 sessionStorageHost(options?) 共享语义，仅默认 storage 分别为 globalThis.localStorage/sessionStorage。options 默认空对象；namespace 默认 'default'、须非空；namespaceCodec 默认 lengthPrefixedNamespaceCodec；storage 可注入真实结构端口。

端口需 getItem/setItem/removeItem/key/clear 及非负安全整数 length，读取显式 options.storage 或描述失败为 INVALID_CONFIG；取得默认 globalThis.localStorage/sessionStorage 的 getter 抛错则为 BACKEND_UNAVAILABLE，cause 保留原对象，显式注入时不读取该默认 getter。构造前真实写入探测 key 再删除/还原；已有非空探测键时换临时键，避免覆盖调用者数据。宿主存在但拒写同样立即 BACKEND_UNAVAILABLE。配额异常归 QUOTA_EXCEEDED，其余宿主访问失败归 BACKEND_UNAVAILABLE；5 MiB 仅能力近似值，不保证浏览器配额。

keys 验证 length、物理 key 类型与重复项；内部断言错误在公开出口归一化并保留 cause。clearValues 先取得稳定物理键快照再逐项删除，中途失败保留精确 logicalKey，不假装原子清空；本后端 clearAll 与 clearValues 等价。

lengthPrefixedNamespaceCodec 使用命名空间 UTF-8 字节长度和 encodeURIComponent 编排物理 key，例如 encode('app','theme') 得到 'sw1:3:app:theme'。decode 只对匹配空间返回逻辑 key，不匹配或坏编码返回 undefined，不删除坏条目也不阻断枚举。自定义 INamespaceCodec 要有 encode(namespace,key):string 与 decode(namespace,physicalKey):string|undefined，自行负责逆运算、迁移和防碰撞。函数缺失为 INVALID_CONFIG，调用/输出不合法按 EXTENSION_FAILED（codec）保留原因。

### Cookie 可见性与固定 scope

cookiesHost(options?) 默认 namespace 'default'、默认命名空间 codec，document 默认 globalThis.document；缺失为 BACKEND_UNAVAILABLE，非对象或 cookie 非字符串为 INVALID_CONFIG，构造即读取一次。它不解析服务端请求头，SSR 的服务端 cookie 处理由应用完成。

scope 构造期固定，默认 { path: '/' }，写与删复用同一份：

| 字段        | 默认与限制                                        |
| ----------- | ------------------------------------------------- |
| path        | '/'；以 / 开头，不含分号                          |
| domain      | undefined；提供时非空、不含空白/分号              |
| sameSite    | undefined；strict/lax/none，none 需要 secure:true |
| secure      | undefined                                         |
| partitioned | undefined；true 需要 secure:true                  |

set 的 ctx 另含 expires（有效 Date）、maxAge（安全整数），缺省 undefined；maxAge<=0 或 expires<=当前时间写删除态。sync.set 接受这些字段及 conflictPolicy，不能接受异步取消/期限。remove 的异步 ctx 只有 signal/timeoutMs，不提供运行期 scope 切换。

读取同一物理名有多个可见 scope 时，get/set/has/keys 拒绝 COOKIE_SCOPE_AMBIGUOUS，不猜返回值。set 后回读：删除态不可见为成功，正常值相等为成功，可见但不等为歧义，正常值完全不可见为 WRITE_FAILED。完整 cookie assignment（含名与属性）超过 4096 字节为 VALUE_TOO_LARGE，不截断。

opaqueEntries:true 表示 HttpOnly 不可见：has:false 不证明不存在，remove 不保证清除服务端 cookie。clearValues/clearAll 只对可见命名空间键写删除态。服务端 Set-Cookie、跨 scope 与隐私策略不受本库控制。

### IndexedDB 连接、记录与事务

indexedDbHost(options?) 默认 dbName 'storage-web'、kvStoreName 'kv'、bytesStoreName 'bytes'、recordsStoreName 'records'、cleanupLegacyRecords false。四名须非空，三个 store 名互异且不能是保留名 `__storage_web_revisions__`、'storage-web:meta'、'storage-web:index-records'。factory 默认 globalThis.indexedDB，缺失为 BACKEND_UNAVAILABLE，非 open 端口为 INVALID_CONFIG。keyRange 默认 globalThis.IDBKeyRange；提供时必须有 bound/lowerBound/upperBound，只有范围查询/恢复游标实际解引用，未提供时无范围操作仍能工作。

连接惰性打开并缓存 Promise，失败清缓存供下次重连。按实际版本打开，缺必需 store 时升一版补建；onversionchange 关闭旧连接并清缓存，onblocked 拒绝当前 open。持久化 schema 当前版本 3，私有 authority 校验、公开 schema 镜像不授予写权限；读到更高版本拒绝 VERSION_UNSUPPORTED。

历史 documents store 以每批 128 条迁移至 recordsStoreName，meta 的 'migration:records-v1-to-v2' 记录 status/lastKey 可恢复。cleanupLegacyRecords:true 仅在完整迁移且目标一致后，额外升级删除旧 store；确认无需旧客户端回滚后才使用。

L0 写等事务 oncomplete，而非 request.onsuccess；后者不证明已提交。get 也等请求与事务完成。setBytes 先复制 Uint8Array，putRecord 先 structuredClone，并在进入异步写入前脱离可复制输入；失败为 SERIALIZE_FAILED。getBytes 识别跨 realm Uint8Array/ArrayBuffer 原始槽，不依赖构造器名；记录 key 先快照。

iterateRecords 按有效 range、pageSize 默认 128 分页，每页短 readonly 事务，最后 key 的开区间继续；每次 yield 前后检查取消。游标/事务失败为 TRANSACTION_FAILED（indexeddb.cursor），契约错误原样穿透。

transaction(run,ctx?) 要求函数。回调在独立草稿中 get/put/delete，首次访问 key 时记录 revision，首次真实访问时捕获清空版本标识 epoch；回调结束后在一次 readwrite 事务中比对 epoch 和全部访问键 revision，再提交草稿与新 revision。clearAll/clearRecords 改 epoch，使旧事务冲突；无关失败事务不恢复整表旧副本。跨通道冲突在 commit 阶段判断，tx.put 不代表已持久化。

回调异常在 storage 家族内保留，其他包装 TRANSACTION_FAILED。回调结束后 scope 失效，再调用 tx 方法为 TRANSACTION_FAILED（transaction.scope）。冲突为 TRANSACTION_CONFLICT，应用应重读后自行决定有界重试，不推荐递归无限重试。clearAll 同事务清三通道，clearRecords 仅清记录并改 epoch。metadata 独立访问 meta store，供迁移检查点使用。

### Memory 的隔离与易失性

`memoryStorageHost<T>()` 无参数，每次独立实例，无 namespace。拥有全部 L0/L1，secondaryIndexes:false、changeFeed:true；sync 只暴露 L0，异步方法不是简单 sync 包装。bytes 复制，record 采用 structuredClone，因此函数和不可克隆宿主值不能保存，标准复制语义由该操作决定，不承诺任意对象图都能无损保存。

事务与 IndexedDB 同样使用隔离草稿、访问键 revision 和 record epoch；失败丢草稿，不用旧整表快照抹掉并发已提交写入。成功合并不含 await，按同一操作提交。iterateRecords 对当前记录按 compareStorageKeys 排序并按 range 过滤，不分页；没有 metadata，不支持跨调用迁移恢复。dispose 后内存 Map 清空，不能当持久化或跨设备后端。

### Codec：存储格式与可逆回退

ICodec 有 name/output/encode/decode；output 是 text/structured/binary。schema 处理领域表示，codec 处理保存格式，二者不是同一层。

| Codec                                         | 实际行为 / 边界                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| jsonCodec                                     | output:text，JSON.stringify/parse；stringify 结果 undefined 保存 'null'；抛错分别 SERIALIZE_FAILED/DESERIALIZE_FAILED |
| structuredCodec                               | output:structured，encode/decode 恒等，不复制；真正复制在 record backend，不用于 text-only                            |
| binaryCodec                                   | output:binary，仅接受 Uint8Array，校验后原样返回，不收 ArrayBuffer/数组/字符串                                        |
| selectCodec(codec,capabilities,onDiagnostic?) | 先快照描述符与能力，再直连、回退或拒绝                                                                                |

jsonCodec 不保留 Date/Map/Set/bytes 原类型，也不能表示循环。structuredCodec 可交给后端保存可 structured-clone 的内建类型与循环，但不重建 class 业务实例，不做 schema 校验，也不保存函数/DOM 节点。structured 遇 records:false 直接 UNSUPPORTED_CAPABILITY，不偷偷降级 JSON。binary 遇 binary:false 可逆转 base64 text，编码体积约多三分之一，并只发一次降级诊断，这是编码属性而非性能测量。

selectCodec 两必填参数按 storage-contract 校验，非法为 INVALID_ARGUMENT；onDiagnostic 默认 undefined，提供时须为函数，否则 INVALID_CONFIG。诊断失败走既有 cleanup reporter，不改选路。直连仍返回 name/output/encode/decode 四字段新容器，不保留额外字段或旧 receiver 绑定，函数引用保持。binary 非 Uint8Array 的 encode/decode 分别为 SERIALIZE_FAILED/DESERIALIZE_FAILED。

### Schema 与迁移链

ISchemaAdapter 有 name、validate，以及可选 normalize/encode/decode；缺省步骤恒等。写入顺序 validate→normalize→encode→codec.encode；读取 codec.decode→版本迁移（存储表示）→schema.decode→validate（validateOnRead:true）。迁移处理 envelope.data，不要求它已经是领域对象。Schema 的 Date↔ISO 等领域转换不同于 JSON/bytes 存储编码。

`passthrough<T>()` 无参数，name 为 passthrough，validate 原样透传而不校验，是默认 schema。fromStandardSchema(schema) 必填单参数，适配 Standard Schema v1，不导入或绑定某个社区校验库。构造检查 '~standard' 对象的 version===1、非空 vendor、validate 函数；生成名为 standard-schema:vendor。结果须是非空对象且不能是数组，带 value 或 issues；issues.message 须字符串，用 '; ' 拼接到 cause.message，失败/同步抛错/异步 rejection 都为 VALIDATION_FAILED，原原因可追溯。

runMigrations(value,fromVersion,toVersion,migrations,signal?) 前四参数在签名中必填，migrations 可显式传 undefined；版本均为非负安全整数，非法为 INVALID_CONFIG。先验证容器、步骤与 signal 并检查预取消，再判断 from>=to 是否原引用返回。只执行 own 步骤，从 from+1 到 to 升序；缺步骤/undefined 为 no-op，存在非函数拒绝，不执行 prototype 继承步骤。

每步 context 是该步的 fromVersion/toVersion，signal 保留原引用。普通迁移失败 MIGRATION_FAILED，取消 ABORTED；挂起 step 等待中也可结束本地等待，不强制终止任意用户工作。listener 安装后复查避免丢取消，setup 失败 INVALID_ARGUMENT，cleanup 仅报告不覆盖迁移结果。公开调用创建一个 operation runtime，repository 内迁移复用原 operation 的 reporter，不另建第二个所有者。

### Entity 定义与读写

defineEntity(options) 或带索引推导的 `defineEntity<T>()`(options) 返回定义，同一定义可 connect 多后端，多实体也可共享同 store，以名称区分同 id。

| 字段           | 默认与限制                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------- |
| name           | 必填非空，不以 `__` 开头                                                                      |
| key            | 必填非空领域主键属性名                                                                        |
| schema         | passthrough，校验 name/validate 与可选函数                                                    |
| codec          | 定义时未决定；connect 时 record 后端 structuredCodec，KV-only jsonCodec；显式值经 selectCodec |
| version        | 1，正安全整数                                                                                 |
| migrations     | version>1 时必须恰好具备 2..version 全部 own 函数，无缺/多/越界                               |
| validateOnRead | true                                                                                          |
| onDiagnostic   | console.warn，提供时须函数，失败报告且不改存储结果                                            |
| defaultOrderBy | undefined，提供时须 comparator                                                                |
| indexes        | 可选命名索引定义                                                                              |

connect 先验证 L0 store 描述。record 新物理 key 为 [`__storage_web_entity_v2__`,entityName,encodeFlatStorageKey(id)]；读取兼容历史 [entityName,id]，显式 migrate 才搬迁；KV 使用 entityName:encodedId。版本 envelope 的 `__v` 高于当前定义拒绝 VERSION_UNSUPPORTED，不能由旧代码覆盖。

get(id,ctx?) 不存在 undefined，按 decode/迁移/校验物化；读取迁移不自动持久化。put(value,ctx?) 从领域 key 取 id，null/undefined 拒绝，完整准备后写入并返回 IStorageKey；record 后端一次事务写新位置并清旧位置。remove 同时清新旧位置。

list/stream options 含 range、limit、orderBy、direction、onInvalid，也可用带 index 的判别式选项。range 作用于逻辑 id；limit 默认 undefined，须非负安全整数；direction next/prev；orderBy 默认 defaultOrderBy，否则扫描顺序。提供 comparator 会先缓冲所有匹配记录、排序再 limit，不能宣称该路径恒定内存流式；非 number/NaN 比较结果为 EXTENSION_FAILED（comparator/entity.orderBy）。

onInvalid 默认 skip，还可 throw 或返回 skip/throw 的回调；issue 含 key/raw/可选record/stage/cause，stage 为 decode/migrate/validate。回调返回别值 INVALID_CONFIG；普通回调失败包装 VALIDATION_FAILED，storage 家族保留。KV 全键扫描 entityName 前缀并诊断一次；record 先扫新前缀、再全表兼容旧形态，以 seenIds 去重。list 是 stream 的缓冲收集。

migrate(options?,ctx?) 的 batchSize 默认 100，正安全整数，onInvalid 同上；结果 scanned/eligible/migrated/skipped/alreadyCurrent/conflicted 分别记录扫描、需升级、已升级、跳过、已当前及仍竞争条数。record 批提交冲突后逐条重试一次，重查更高版本，仍冲突计 conflicted，不无限重跑。IndexedDB 在 repository:name:migration 写检查点（状态、阶段、计数、lastPhysicalKey），指纹含名称/版本/主键/schema/codec/迁移版本集合，不匹配从头开始；memory/KV 无 metadata，每次从头扫。

batch(run,ctx?) 仅真实 record 事务可用，KV-only 拒绝 UNSUPPORTED_CAPABILITY，不伪造原子性。scope 提供 get/put/remove，负责 envelope 与 key 编排，按最终草稿提交，失败不提交草稿。事务冲突后如何重试由应用按预算决定。

### 二级索引、唯一约束与兼容查询

索引是 entity 领域定义，不是 backend schema。单 path 支持 unique/multiEntry/revision，默认分别为 false/false/1；compound paths 禁止 multiEntry:true；selector 必须 select 与显式 revision，修改投影时提高 revision 才使持久化投影失效。multiEntry 将数组成员分别投影；selector 返回单项/多项投影，由定义约束 key。

findBy(index,key,ctx?) 第一条或 undefined；findManyBy(index,range?,options?,ctx?) 数组；streamBy 异步迭代，options 不重复包含普通 range。IndexedDB 以固定 sidecar（索引投影表）在记录写/删/迁移事务内维护，epoch 变化的跨页查询拒绝 INDEX_QUERY_INVALIDATED，需从头读。原记录缺失的投影为 INDEX_ORPHAN。

其他后端用同一投影、比较和 unique 语义 fallback，不虚报 secondaryIndexes:true。record put/batch/migrate 在最终草稿校验唯一性，支持同 id 替换、删除后复用、先写新 owner 再删旧 owner；冲突 INDEX_UNIQUE_CONFLICT，失败不留半提交。涉及 unique 的提交更新两段内部保留标记 [`__storage_web_entity_v2__`,entityName]，用 revision 检测并发新增 owner，原始记录枚举可见它，实体查询/迁移不把它当三段业务记录。

KV 写先在锁外完成 schema/codec 并物化原始文本快照，再在宿主 Web Locks 内复核后提交；竞争导致 TRANSACTION_CONFLICT，稳定快照已有另一 owner 为 INDEX_UNIQUE_CONFLICT。fallback 约束需全扫描和投影读取，不新增持久化 sidecar；selector 普通异常 EXTENSION_FAILED/cause，原生 backfill 保留原错。

跨页面保证要求宿主 Web Locks；无锁的注入端口只在同一模块实例串行，服务端改写 cookie 不受约束。backfill 主错与失败状态保存同时失败时，用带 INDEX_BACKFILL_FAILED 的原生 AggregateError，cause 为主错、errors 保留全部原对象；owner/generation/checkpoint 过期为 INDEX_BACKFILL_STALE。ensure/iterate 接入原 deadline，不另造等待器。

### StorageHost 与 backend plugins

createStorageHost(options?) 始终异步，默认无插件；首次 plugins 元组原子安装完成后才返回，之后 await host.use(...) 动态安装。StorageHostFacade 是同一空 shell，构造后自行 use，不是另一套生命周期。

| backend plugin              | 子路径                  | 默认 id    |
| --------------------------- | ----------------------- | ---------- |
| memoryBackendPlugin         | plugins/memory          | memory     |
| localStorageBackendPlugin   | plugins/local-storage   | local      |
| sessionStorageBackendPlugin | plugins/session-storage | session    |
| cookieBackendPlugin         | plugins/cookies         | cookies    |
| indexedDbBackendPlugin      | plugins/indexed-db      | indexed-db |

插件选项复用各 backend 配置并可指定 id；literal tuple 精确推导 backend(id)，重复 ID 编译期拒绝，运行时仍检查真实 handle/provider/store 和 Feature 拓扑。一个 batch 全部 create/prepare/install 成功才发布，失败回滚，不提供半登记 backend。未安装的 backend 不在安装前访问平台。

Host installTimeoutMs 默认 30000，须为有限非负数，不接受 false，作用于整个安装 batch；scheduler 默认 systemScheduler；report 默认 undefined，无调用方报告器时仍沿既有诊断路径；它接迟到拒绝/cleanup 诊断，reporter 失败不覆盖主错。安装中再次 use 为 STORAGE_HOST_BUSY。backend(id) 按精确 ID 查，hasBackend 布尔，backends 返回 detached ReadonlyMap 类型的普通 Map，修改副本不改 registry，没有隐式 default ID。

dispose 先封闭并清 registry、取消安装，等已接纳 mutation/query 安静，再按原 PluginHost/lifecycle owner 释放 adapter/store/transport；重复返回同一 Promise。失败后仍终态，STORAGE_HOST_DISPOSE_FAILED 沿 cause/errors 可追溯。backend/use/liveQuery 等不复活；借入 Runtime 不被 Host 销毁。内部登记名、service 名与 WeakMap admission 元数据不是应用 API，使用 backend/reactiveBackend 与 plugin.id。

### Reactive adapter 与 live query

五个 plugins/reactive/* factory 为 memoryReactive/localStorageReactive/sessionStorageReactive/cookiesReactive/indexedDbReactive，创建 backend 并安装其唯一 adapter。普通 backend plugin 没有 reactive capability，不虚报 Host.liveQuery。reactiveBackend(id) 取得已接纳 handle，未安装对应 adapter 时返回 undefined，不回退到其他 id；Host 已关闭时仍拒绝访问。

liveQuery(options) 需要 backendId、调用方 runtime 与 query({store,signal})；scope/matches 默认 undefined；仅双方 scope 已知且不同才排除，matches 缺省视为相关，回调失败报告并保守刷新；keepPreviousData 默认 true，刷新保留旧值为 refreshing。equals 默认 undefined，每次接纳新值，不暗设 Object.is；提供时可拦截语义相同替换，回调失败报告。signal 默认 undefined，取消整个 query；timeoutMs 默认 undefined，为每代预算；report 默认 undefined，提供后的失败被隔离，不改 query 结果。

state 是相同 reactive Runtime 的只读 computed，loading/ready/refreshing/error/disposed；ready 是初始工作的结算投影，身份在 refresh 后保持稳定，旧 Promise 结算时若仍在 fetching，会继续跟随当时活跃的 Promise。refresh 在 fetching 时加入当前 Promise，否则请求 refetch；Resource generation 防止旧结果覆盖新值。dispose 封闭刷新、取消当前代、释放订阅并等已接纳工作结束，重复共享完成 Promise。

consistency 冻结实际 adapter mode/visibility/可选 polling 间隔：memory 为 instance-local push；local/session 为浏览器事件或 polling 的 eventual 可见性，受文档/顶层上下文约束；cookie 只见 JS 可见值；IndexedDB commit-after feed 加同源 eventual 协调，不捕获任意外部 raw writer，更不跨设备复制。

自定义 defineReactiveAdapterFeature 是隐藏 kind 的原生 Feature，安装时 PluginHost 注入 exact store 与 Host 快照 scheduler，不接受调用者自造 backend-kind token。正常 subscribe 必须同步返回 disposer；签名允许 PromiseLike 只为观察违规结果，异步结果会 REACTIVE_FEATURE_INVALID 并中止/关闭原 scope，迟到 disposer 到达即释放。invalidate() 无参数粗粒度刷新同 adapter 全部查询、跳过依赖已知 change 的 scope/matches，不伪造 sequence/origin；有 change 时按原规则过滤。

generation/refresh/取消由 Resource，资源归属由 lifecycle，fanout 由 event-subscriber 管理，不在 adapter 再造状态机。各 query/adapter/backend 清理失败仍终态，原错误对象保持可达。

### 错误身份与排查

StorageError(code,details?,message?) 的 code 必填，details 可省略；source 固定 @migaia/storage-web，顶层 message 默认 `[storage-web] ${code}`，可用第三参数覆盖。details 可含 backend/key/existingChannel/attemptedChannel/extensionStage/operation/cause；cause 可以 undefined，存在时保留原始对象与其 message/stack，不承诺顶层 message 等于底层异常。实例浅冻结，不深冻结 cause。已有 StorageError 补充 operation/stage 元数据时，新边界保留原 message，并把完整旧错误放 cause。

STORAGE_WEB_SOURCE、StorageErrorCode、StorageErrorText 为稳定公开常量；业务分支比较 source/code，文本主要供扩展实现复用。storage-contract 的 INVALID_ARGUMENT/INVALID_KEY/UNSUPPORTED_CAPABILITY/STORE_DISPOSED/ABORTED 从其独立入口导入；跨 schema/codec/namespace 传播已有 storage 家族错误时保留原码与原因，不二次覆盖。

| StorageErrorCode 码值                                                              | 场景                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| BACKEND_UNAVAILABLE / QUOTA_EXCEEDED / VALUE_TOO_LARGE                             | 后端缺失/拒写、配额、完整 Cookie assignment 过大 |
| SERIALIZE_FAILED / DESERIALIZE_FAILED                                              | 编码/解码、结构化复制或 envelope 失败            |
| VALIDATION_FAILED / MIGRATION_FAILED                                               | schema 或迁移失败                                |
| TRANSACTION_FAILED / TRANSACTION_CONFLICT                                          | 事务/独占提交失败，或 revision/epoch/快照变化    |
| DUPLICATE_KEY                                                                      | 跨 value/bytes/record 通道冲突                   |
| VERSION_UNSUPPORTED                                                                | 持久化 schema 或 entity envelope 高于当前代码    |
| EXTENSION_FAILED                                                                   | 扩展回调未归类失败，查看 extensionStage/cause    |
| WRITE_FAILED / COOKIE_SCOPE_AMBIGUOUS                                              | Cookie 回读不可见或同名 scope 歧义               |
| INVALID_CONFIG                                                                     | adapter 配置非法                                 |
| INDEX_ORPHAN / INDEX_UNIQUE_CONFLICT / INDEX_QUERY_INVALIDATED                     | 投影无原记录、唯一键占用、分页失效               |
| INDEX_BACKFILL_FAILED / INDEX_BACKFILL_STALE                                       | 回填与失败状态都失败，或 owner/代次/检查点失效   |
| BACKEND_ID_INVALID / BACKEND_DUPLICATE / BACKEND_NOT_INSTALLED                     | ID 非法、重复或未安装                            |
| BACKEND_PLUGIN_INVALID / BACKEND_INSTALL_FAILED                                    | plugin/store 契约非法，或 batch 安装失败         |
| STORAGE_HOST_BUSY / STORAGE_HOST_DISPOSED / STORAGE_HOST_DISPOSE_FAILED            | Host 正忙、终态或清理失败                        |
| LIVE_QUERY_DISPOSED / LIVE_QUERY_DISPOSE_FAILED                                    | query 终态或清理失败                             |
| REACTIVE_FEATURE_INVALID / REACTIVE_TOPOLOGY_INVALID                               | reactive 定义或依赖图非法                        |
| REACTIVE_SERVICE_NOT_INSTALLED / REACTIVE_ADAPTER_NOT_INSTALLED                    | 缺服务或所选 backend adapter                     |
| REACTIVE_ADAPTER_FAILED / REACTIVE_ADAPTER_DISPOSE_FAILED / BACKEND_DISPOSE_FAILED | 查询/失效失败或终态清理失败                      |

遇到不可用后端，显式提示或选择 memory；Cookie 写失败检查 scope/策略；冲突先区分跨通道重复、unique 占用与乐观竞争；未知版本升级代码，不删图跳迁移；structured 数据落 text-only 时显式换 codec 或后端；live query 跨页刷新按 consistency 判断，不把提示当全量复制。Host/Query/backend 关闭后新建，不尝试复活。

```bash
pnpm --filter @migaia/storage-web run fmt
pnpm --filter @migaia/storage-web run lint
pnpm --filter @migaia/storage-web run typecheck
pnpm --filter @migaia/storage-web run typecheck:test
pnpm --filter @migaia/storage-web run test
```

test 脚本先 build（Vite 与声明输出）再运行现有 coverage suite；test:e2e/typecheck:e2e/test:packed 是另外的现有入口，命令结果须以实际执行为准。
