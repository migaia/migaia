# `@migaia/store-persist` 使用手册

按状态形状选择持久化适配器，分别管理水合、写入结果和资源所有权。最短入口见 [README](./README.md)。

## 按场景查找

| 需要做什么                 | 怎么组合                                                | 完整示例                                  |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| 恢复存档时保留启动期修改   | persist → local edit → ready → flush                    | [代码与输出](#恢复存档时保留启动期修改)   |
| 修复坏存档后再恢复写入     | ready rejection → repair storage → retryHydrate → flush | [代码与输出](#修复坏存档后再恢复写入)     |
| 迁移旧设置并只保存指定字段 | version / migrations → partialize → flush               | [代码与输出](#迁移旧设置并只保存指定字段) |
| 完整恢复 Map 条目          | persistCollection → flush → new Map → ready             | [代码与输出](#完整恢复-map-条目)          |
| 独立停止某个键的持久化     | persistKeyed × 2 → ready → dispose one → flush          | [代码与输出](#独立停止某个键的持久化)     |
| 清理存档而不重置内存值     | clearFamily → inspect memory → change → flush           | [代码与输出](#清理存档而不重置内存值)     |

## 运行准备

每个示例独立保存为 .ts，在 ESM 项目用 Node 24 运行。它们使用真实 memoryStorageHost，不需要浏览器 localStorage 或 IndexedDB；内存后端的内容只在该实例存活期间保留。按所需模型安装，下面覆盖全部六例：

```bash
pnpm add @migaia/store-persist @migaia/storage-plugin-browser @migaia/store-light @migaia/store-indexed @migaia/store-keyed @migaia/reactive
```

## 恢复存档时保留启动期修改

设置存档里有旧计数，用户却在启动恢复完成前改了计数。

直接用存档覆盖整个对象会丢掉新计数；完全跳过恢复，又会丢掉用户尚未修改的已存字段。

先接入 `persist`，再允许编辑并等待 `ready`；默认普通对象合并逐字段对照启动快照，保留本地修改，再用 `flush` 保存合并结果。

### 示例参数

memoryBackendPlugin() 提供本例真实内存后端，初始存档 key 为 settings。defaultJsonCodec 编码完整 version: 0 / state 信封；createStore 初值为 light / 0，省略 Runtime 使用默认实例。persist 必填 key 与 storage，未传 version 为 0、debounceMs 为 0、partialize 为恒等；普通对象默认浅三向合并，最后 await flush 确定本次写入结束。

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set(
  'settings',
  (await defaultJsonCodec.encode({
    version: 0,
    state: { theme: 'dark', count: 10 }
  })) as string
)
const settings = createStore({ theme: 'light', count: 0 })
const handle = persist(settings, { key: 'settings', storage })
settings.count = 1
await handle.ready
console.log('恢复：', settings.theme, settings.count)
await handle.flush()
const saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {
  state: { theme: string; count: number }
}
console.log('保存：', saved.state.theme, saved.state.count)
handle.dispose()
await settings.$dispose()
```

输出：

```text
恢复： dark 1
保存： dark 1
```

依次输出 `恢复： dark 1`、`保存： dark 1`：主题来自存档，计数保留启动后的本地值。

`version` 默认 `0`，`debounceMs` 默认 `0`；普通对象按字段做浅层 `Object.is` 比较，数组、`Map`、`Set` 则整体替换。

## 修复坏存档后再恢复写入

启动时读到了损坏存档，恢复失败后用户仍在修改内存中的设置。

这时立即保存默认值，会在排查或修复前覆盖原存档；把等待结束误当成恢复成功，也会造成同样的问题。

捕获 `ready` 的失败并修复真实存储记录，再等待 `retryHydrate` 成功后调用 `flush`；只有成功读取与恢复后才重新开放写入。

### 示例参数

storage.set 先写入坏 JSON，本例保留首次 ready 和错误对象。ready 拒绝不会把内存改动写回，retryHydrate 无参数并重新读取已修复存档；之后等待该次重试与 flush。settled 不等于恢复成功，ready 不因 retry 替换。所有 key / codec / 防抖默认与上一例相同。

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set('settings', '{')
const settings = createStore({ count: 0 })
const handle = persist(settings, { key: 'settings', storage })
const initialReady = handle.ready
const failure = await initialReady.catch((error: unknown) => error)
settings.count = 2
const writeFailure = await handle.flush().catch((error: unknown) => error)
console.log('写入暂停：', handle.status.value, writeFailure === failure)
console.log('原档未变：', (await storage.get('settings')) === '{')
await storage.set(
  'settings',
  (await defaultJsonCodec.encode({
    version: 0,
    state: { count: 10 }
  })) as string
)
await handle.retryHydrate()
await handle.flush()
console.log('恢复完成：', handle.status.value, settings.count, handle.ready === initialReady)
console.log('首次尝试：', (await handle.ready.catch((error: unknown) => error)) === failure)
handle.dispose()
await settings.$dispose()
```

输出：

```text
写入暂停： error true
原档未变： true
恢复完成： ready 2 true
首次尝试： true
```

依次输出 `写入暂停： error true`、`原档未变： true`、`恢复完成： ready 2 true`、`首次尝试： true`。

恢复失败会暂停自动写入，`flush` 也拒绝并保留同一个失败对象；重试仍使用原启动快照，且不替换 `ready`，`settled` 只等待首次尝试结束。

## 迁移旧设置并只保存指定字段

新版本重命名了已存字段，同时有些会话数据只应留在内存里。

把旧数据当成新结构读取会漏掉改名字段；每次保存整个对象又会把临时数据写进存档。

显式设置 `version: 2`，用同步 `migrations` 转换旧状态，再用 `partialize` 选择保存字段；本例读取版本 `1`，写入时只保留主题。

### 示例参数

目标 version 从默认 0 覆盖为 2，旧 envelope.version 为 1。migrations[2] 接收 unknown 旧 state 与 { fromVersion, toVersion }，必须同步返回新 state；partialize 只返回 theme，覆盖默认完整保存。temporary 未持久化但保留在当前 Store；默认 merge 仍基于启动快照，light 恢复走 $hydrate。字符串转换是本例 schema 规则，不是通用迁移策略。

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set(
  'settings',
  (await defaultJsonCodec.encode({
    version: 1,
    state: { legacyTheme: 'dark' }
  })) as string
)
const settings = createStore({ theme: 'light', temporary: 'session-only' })
let migratedFrom = 0
const handle = persist(settings, {
  key: 'settings',
  storage,
  version: 2,
  migrations: {
    2: (previous, { fromVersion }) => {
      const state = previous as Record<string, unknown>
      migratedFrom = fromVersion
      return { theme: String(state.legacyTheme) }
    }
  },
  partialize: (state) => ({ theme: state.theme })
})
await handle.ready
console.log('迁移：', migratedFrom, settings.theme, settings.temporary)
settings.theme = 'contrast'
await handle.flush()
const saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {
  version: number
  state: { theme: string; temporary?: string }
}
console.log('存档：', saved.version, saved.state.theme, Object.hasOwn(saved.state, 'temporary'))
handle.dispose()
await settings.$dispose()
```

输出：

```text
迁移： 1 dark session-only
存档： 2 contrast false
```

依次输出 `迁移： 1 dark session-only`、`存档： 2 contrast false`：旧主题完成转换，临时字段没有进入存档。

`version` 默认 `0`，缺少步骤或未来存档会恢复失败；步骤与 partialize 同步返回。升级本身不写回，flush 保存新版存档。

## 完整恢复 Map 条目

购物车使用可观察的 `Map`，重新创建集合后仍需恢复条目。

直接做普通 JSON 序列化会把 `Map` 变成空对象；只向新集合追加条目，也可能留下已经过时的键。

把真实 `ObservableMap` 交给 `persistCollection`，释放前等待 `flush`；默认编解码器保留 `Map` 条目，恢复时调用集合的 `replace`。

### 示例参数

ObservableMap 初始为空，恢复目标初始只有 stale: 99，两者均省略 Runtime 使用各自默认选择。persistCollection 接受集合及 key / storage，不需要额外订阅包装；默认 codec 支持 Map，version 与 debounceMs 都为 0。Map 缺省整替换，所以旧目标中的 stale 会消失；部分保存时需显式匹配的 merge。

```ts doc-test=run
import { ObservableMap } from '@migaia/store-indexed'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persistCollection } from '@migaia/store-persist/indexed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
const cart = new ObservableMap<string, number>()
const first = persistCollection(cart, { key: 'cart', storage })
await first.ready
cart.set('book', 2)
await first.flush()
first.dispose()
cart.dispose()
const restored = new ObservableMap<string, number>([['stale', 99]])
const second = persistCollection(restored, { key: 'cart', storage })
await second.ready
console.log('恢复：', restored.get('book'), restored.has('stale'))
const saved = (await defaultJsonCodec.decode(await storage.get('cart'))) as { state: unknown }
console.log('映射：', saved.state instanceof Map)
second.dispose()
restored.dispose()
```

输出：

```text
恢复： 2 false
映射： true
```

依次输出 `恢复： 2 false`、`映射： true`：书籍数量恢复，过时键消失，解码后的存档仍包含真正的 `Map`。

`codec` 默认 `defaultJsonCodec`，`version` 和 `debounceMs` 默认 `0`；`Map` 恢复会整体替换，裁剪后需要特殊合并时应显式提供 `merge`。

## 独立停止某个键的持久化

两个用户资料来自同一定义族，离开其中一个页面时只需停止保存该用户。

整族共用一个保存订阅会耦合无关的键；把 `handle.value` 当成实时值读取，还会一直看到恢复前捕获的快照。

为每个定义和显式 `id` 创建独立的 `persistKeyed` 句柄；等待 `ready` 后从 `AtomStore` 读取当前值，只释放不再需要保存的那一个句柄。

### 示例参数

createAtomStore 使用本例显式创建的 Runtime；familyDef 初始化各 key 为 name 为空字符串。persistKeyed 的 def、字符串 id、namespace、storage 都明确传入；storage key 为 users:u1 / users:u2，不从定义自动推导。first.value 是初始快照，实时值用 atoms.peek；两个 handle 独立，释放后不会销毁 AtomStore。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createAtomStore, familyDef } from '@migaia/store-keyed'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persistKeyed } from '@migaia/store-persist/keyed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set(
  'users:u1',
  (await defaultJsonCodec.encode({
    version: 0,
    state: { name: 'Ada' }
  })) as string
)
const atoms = createAtomStore(createRuntime())
const profile = familyDef(() => ({ name: '' }))
const first = persistKeyed(atoms, profile('u1'), 'u1', { namespace: 'users', storage })
const second = persistKeyed(atoms, profile('u2'), 'u2', { namespace: 'users', storage })
await Promise.all([first.ready, second.ready])
console.log('初始值：', first.value.name === '', atoms.peek(profile('u1')).name)
atoms.set(profile('u1'), { name: 'Grace' })
atoms.set(profile('u2'), { name: 'Linus' })
await Promise.all([first.flush(), second.flush()])
first.dispose()
atoms.set(profile('u1'), { name: 'Changed' })
atoms.set(profile('u2'), { name: 'Barbara' })
await second.flush()
const one = (await defaultJsonCodec.decode(await storage.get('users:u1'))) as {
  state: { name: string }
}
const two = (await defaultJsonCodec.decode(await storage.get('users:u2'))) as {
  state: { name: string }
}
console.log('两个存档：', one.state.name, two.state.name)
console.log('内存：', atoms.peek(profile('u1')).name)
second.dispose()
atoms.dispose()
```

输出：

```text
初始值： true Ada
两个存档： Grace Barbara
内存： Changed
```

依次输出 `初始值： true Ada`、`两个存档： Grace Barbara`、`内存： Changed`：停止 `u1` 后它的旧存档保留，`u2` 继续保存。

存储键是 `namespace:id`，`id` 不从定义推导；`value` 是接入时快照。释放持久化不会释放 `AtomStore` 或重置业务值，`version` 和 `debounceMs` 默认 `0`。

## 清理存档而不重置内存值

退出流程清除了某个命名空间的存档，已挂载页面却仍持有当前值。

删除记录不会重置内存或移除订阅；误以为两者一起完成，下一次编辑就会重新创建已经清理的存档。

用 `clearFamily` 移除匹配记录，再分别决定是否重置业务值、释放持久化句柄；本例故意保留句柄，展示后续变更再次写入。

### 示例参数

clearFamily 的 storage 与 namespace 两参数必填，users 只匹配 users: 前缀，不匹配 other:u1。返回匹配键数；不会删除内存定义或订阅。本例 active handle 仍存活，atoms.set 后再 await flush 就会重建存档；应用要永久停止保存时需另外 dispose 对应 handle。

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createAtomStore, familyDef } from '@migaia/store-keyed'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { persistKeyed, clearFamily } from '@migaia/store-persist/keyed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set('other:u1', 'keep')
const atoms = createAtomStore(createRuntime())
const counter = familyDef(() => 0)
const def = counter('u1')
const handle = persistKeyed(atoms, def, 'u1', { namespace: 'users', storage })
await handle.ready
atoms.set(def, 7)
await handle.flush()
console.log('匹配数：', await clearFamily(storage, 'users'))
console.log(
  '清理后：',
  await storage.get('users:u1'),
  atoms.peek(def),
  await storage.get('other:u1')
)
atoms.set(def, 8)
await handle.flush()
console.log('重新保存：', (await storage.get('users:u1')) !== null)
handle.dispose()
atoms.dispose()
```

输出：

```text
匹配数： 1
清理后： null 7 keep
重新保存： true
```

依次输出 `匹配数： 1`、`清理后： null 7 keep`、`重新保存： true`：只删除 `users:u1`，内存仍是 `7`，后续编辑再次生成存档。

返回值是枚举时以命名空间加冒号匹配的键数，不累计移除操作的布尔结果；移除按顺序执行，不是事务，后续后端调用失败不会撤回已经删除的记录。

## 契约细节

### 职责、入口与安装边界

本包把状态变化接到存储读写：加载存档、协调水合期间的本地修改、排队写入、管理防抖与释放。它不提供具体存储后端、加密或页面卸载时的可靠保存保证。只需一次性读写而不需要状态同步时，直接使用 storage-contract 和所需后端即可。敏感数据应由应用选择合适的存储与加密 codec，不要把默认 JSON 编码当作加密。

| 入口                            | 公开内容                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@migaia/store-persist`         | persistUnit 核心、handle / options / envelope 类型、codec 工具、状态与错误。根入口不导出三个 Store 适配函数。 |
| `@migaia/store-persist/light`   | persist、IPersistableStore、IPersistOptions。                                                                 |
| `@migaia/store-persist/indexed` | persistCollection、IPersistableCollection、IPersistCollectionOptions。                                        |
| `@migaia/store-persist/keyed`   | persistKeyed、clearFamily、IPersistKeyedOptions、IPersistKeyedHandle。                                        |

reactive、storage-contract、utils、lifecycle 是运行时依赖。store-light、store-indexed、store-keyed 是可选 peer，只安装所用模型；storage-plugin-browser 仅在使用其后端或 codec 时安装。代码直接导入的包应直接安装，不能依赖传递依赖恰好可见。memoryStorageHost、localStorageHost、indexedDbHost 从 storage-plugin-browser 的精确后端子入口取得；本包不在运行时依赖具体 storage-plugin-browser 值。

### 共同配置与同步回调

persistUnit(unit, options) 是三个适配器共用的引擎。unit 必须提供同步 snapshot()、同步 restore(state) 和 subscribe(onChange)，后者返回退订函数。核心 options 必填 key、runtime、storage；三个 facade 自动使用 Store / collection / AtomStore 自己的 Runtime。状态单位、Runtime 和 storage 均为借用资源。

| 选项       | 默认值与含义                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| key        | 必填字符串；决定存档键，字符串不被强制转型。                                                                                   |
| runtime    | 仅核心显式必填；持有状态信号，facade 自动提供。                                                                                |
| storage    | 必填，满足最小 KeyValueStore 投影；见后文选路。                                                                                |
| codec      | defaultJsonCodec；编码完整的 version / state 信封，而不只编码 state。                                                          |
| version    | 0；必须是非负安全整数。                                                                                                        |
| migrations | 连续目标版本步骤或 `{ reset: () => state }`，只允许同步。未来或不可升级版本报 VERSION_UNSUPPORTED；keyed 不公开此选项。        |
| partialize | 恒等函数；写入前从当前快照裁出需要保存的字段。                                                                                 |
| merge      | 核心 / indexed / keyed 可自定义 merge(persisted, current)；缺省浅三向合并普通对象，其他形状整体替换。light 不公开 merge 选项。 |
| debounceMs | 0，不防抖；有限数，范围 0 到 2147483647，允许小数。                                                                            |
| maxWaitMs  | 未设置；同一数值范围，限制防抖窗口，不是 I/O 期限。                                                                            |
| scheduler  | canonical systemScheduler；提供单调 now 与可取消 schedule 任务。                                                               |

facade 先捕获 options 自身属性；getter 使用原 options 作为 receiver 读取一次。核心也在创建时捕获配置字段，恢复使用已捕获并验证的 merge，不重新读取调用方的 getter。非对象、反射或 getter 失败以 INVALID_OPTION TypeError 报告，捕获的原因为 cause。key、namespace、id 在拼接前检查字符串，不把对象或数字悄悄转成键，也不额外要求非空字符串。容量时间、version 与回调形状在创建持久化状态前按实际配置校验。

迁移步骤必须同步；类型拒绝已知 Promise/thenable，运行时 MIGRATION_FAILED 保留原始 cause。partialize 与 merge 保留同步 INVALID_OPTION 规则。

### 三个状态适配器

| 适配器                                    | 接受的状态面                                                                     | 读写与订阅                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| persist(store, options)                   | $runtime、$plain、$subscribe、$hydrate 的结构类型，createStore 返回值满足。      | snapshot 用 $plain，restore 用 $hydrate，subscribe 显式 fireImmediately: false。           |
| persistCollection(collection, options)    | runtime、snapshot()、replace(state)，支持 ObservableObject / Array / Map / Set。 | runtime.effect 读取 tracked snapshot，跳过 Effect 构造时的首次同步执行，之后变化触发写入。 |
| persistKeyed(atomStore, def, id, options) | AtomStore 与可写定义。                                                           | peek 取快照，set 恢复，sub 订阅；每次调用建立一个独立单位。                                |

light 的 $plain 只包含 signal 支撑字段，不含 computed、WASM 字段或方法。$hydrate 是宽松写回：只更新已知 signal 字段，未知字段默认跳过。因此 partialize 只保存部分字段时，不会要求恢复未保存字段；本适配器不另设 merge。核心普通对象合并仍负责水合期间的同字段本地修改。

indexed 的 snapshot 保持各集合自身形状，replace 遵循集合整体替换的原子准入；坏存档、版本不匹配等水合前置失败不会调用 restore，不能把“没有进入恢复”夸大为任意外部副作用可回滚。数组 / Map / Set 的部分持久化需要应用提供匹配的 merge，否则缺省整替换可能丢掉未存部分。普通对象的浅字段规则也不代替深层业务合并。

keyed 必填 namespace、storage，其他共同选项按其公开类型提供；实际存储键是 namespace + ':' + id。它没有枚举整个 family 的能力，每个 handle 只管理这一个定义与键。handle.value 是水合前首次获取的值快照，不是实时 AtomStore 值；实时值从 AtomStore 读取。扩展保留原引擎的 live disposed getter，dispose 后立即反映终态。

clearFamily(storage, namespace) 的两个参数均必填，返回 `Promise<number>`。它枚举 storage.keys()，按 namespace + ':' 前缀筛选后逐个 await remove；返回枚举时匹配的数量，不是 remove 返回 true 的独占计数。它不清 AtomStore 内存、不停止现有 handle；活跃值下次变化可再次写入。登出若要同时清业务值，应用还须操作 AtomStore，并按需先停止相关持久化，避免把删除当成永久禁写。

### 加载、版本迁移与本地修改

创建时构造唯一迁移计划，再订阅。水合复用 storage-contract 的 assertVersionedEnvelope 与 storage-host/sdk 的 migrateEnvelopeSync。同版本保留状态；可升级旧档执行连续步骤或一次 reset，未来版本报 VERSION_UNSUPPORTED。水合错误原样传出并阻止写入；升级与恢复本身不写回，应用变化与 flush 沿原调度保存。

缺省 merge 对普通对象（Object.prototype 或 null 原型）按字段浅比较：以构造时启动快照为基线，用 Object.is 比较当前字段；本地已改字段保留当前值，未改字段接受存档值，同时保留未归档的当前字段。它不是深度冲突解决，嵌套引用内部变化不自动得到逐层比较；重试也沿用这一启动基线。非普通对象、数组、Map、Set 等整体接受持久化形状，自定义 merge 则负责应用自己的规则。

水合期间通知只标 dirty，不提前覆盖未知存档；忽略同步 restore 本身的通知；异步读取期间的应用变化仍标 dirty。水合成功后有 dirty 才重新安排写入。水合失败保留错误和 dirty 状态，flush / clear 不写而抛原水合错误；修复配置或存档后，成功 retryHydrate 才重新打开写入。恢复期间再次调用不会另起并行重读，但不保证它等待当前恢复或返回相同 Promise；需要恢复结果时等待发起重试的那次调用。

### Handle 状态与等待

| 成员                 | 取值或行为                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| status               | loading / ready / error / disposed；disposed 优先，水合 loading 次之，水合或写入失败为 error。写入中由独立 writeStatus 表示。 |
| error                | hydrationError 或 writeError；两者都有时生成 HYDRATE_AND_WRITE_FAILED AggregateError，errors 按水合、写入顺序保留。           |
| hydrated             | hydrationStatus 是否为 success，不等同于 handle 尚未释放。                                                                    |
| hydrationStatus      | loading / success / error，重试时重新经历该状态。                                                                             |
| hydrationError       | 当前水合错误，成功后清除。                                                                                                    |
| writeStatus          | idle / writing / error / disposed。                                                                                           |
| writeError           | 最近写入错误；正常成功写入清除，释放后的最终写入失败也可保留在这里。                                                          |
| ready                | 首次 hydrate 尝试的 Promise：成功 resolve，失败或完成前被释放中断则 reject；重试不替换原 Promise。                            |
| settled              | 首次尝试无论成功失败都 resolve 的等待屏障，不表示以后 retry 已完成。                                                          |
| retryHydrate()       | 无参数；失败后重读，成功恢复写入；应等待此调用本身判断恢复结果。                                                              |
| flush(tx?) / clear() | 返回 `Promise<void>`；flush 可接参与事务视图，clear 无参数。                                                                  |
| disposed / dispose() | live 布尔 getter / 同步幂等释放。                                                                                             |
| disposeAsync()       | 同步停止后等待已接纳的写入/删除及最终防抖写入结束；最终写入失败见 writeError；已有 flush/clear 保留原结果。                   |

status、error、hydrated 是 Runtime computed；hydration / write 的细分状态通过 IReadonlyPersistValue.value 暴露。公开 PersistState 只有 idle、loading、writing、ready、success、error、disposed；没有 active。IPersistCodecOutput 已移除，类型使用 storage-contract 的 ICodecOutput；运行时 PersistCodecOutput 仍保留 text / structured / binary。旧类型与成员导入需迁移，没有兼容 alias。

### 写入、防抖、flush 与 clear

写入先读最新 unit.snapshot，再同步 partialize，构造 { version, state } 后交给 codec。所有写入和删除沿一条串行链，防止慢的旧写入在新写入后覆盖它。变化会合并为写入请求，但每次实际编码使用排到执行时的快照，不承诺每个中间值都形成一份存档。

debounceMs 大于 0 时等待安静间隔；maxWaitMs 从成功水合后第一个待写变化起固定窗口上限，后续变化只延长安静间隔。maxWaitMs 为 0 是下一次 0ms 调度请求入队；debounceMs 为 0 则直接请求写入，不使用这一防抖窗口。maxWait 只限制请求入队时间，不限制排队等待或后端完成时间。

flush 取消当前防抖窗口，等待首次水合屏障；若水合失败抛原错，否则等待它已经观察到的实际写入，再请求当前快照写入并等待。并发严格 flush 与后台写共享真实 drain 结果，全部等待者能看到同一次原始失败；仅供后续调度恢复的 catch 链不会把这次失败改成成功。各 async 方法的公开 Promise 不被声明为相同 identity。

clear 同样取消窗口并等待水合，然后在写队列后删除此键，不重置业务内存。之后状态变化仍可重新写回。clearFamily 只处理匹配的存储键，不与所有活跃 keyed handle 合成原子事务。浏览器 beforeunload 也不保证等待 flush；应在明确的应用保存边界 await flush，并理解后端完成语义，而非只在卸载事件里 fire-and-forget。

### dispose、取消与最终快照

dispose 同步、幂等：标记终态、请求 abort 所有在途适配器操作、取消防抖窗口、停止订阅。它不 dispose 借用的 Store、collection、AtomStore、Runtime 或 storage。释放后 flush / clear / retryHydrate 拒绝为带 ABORTED_BY_DISPOSE 的原生 AbortError，不复用旧 handle。

如果释放截断了一个已排定但未触发的防抖 timer，会当场捕获最后快照，并在既有写链之后发起一次最终写入。该写入不等待、不传已中止的 signal；最终编码 / I/O 或捕获失败保留在 writeError，即使 status 已 disposed。没有 pending timer 时不能笼统声称 dispose 总会额外保存一次。

取消复用 lifecycle 的原生 AbortController 工厂与默认 AbortError reason。后端若忽略 signal，已经发出的操作仍可能完成；等待者会在实际操作结算后观察终态，晚到原始失败保留在 AbortError cause。dispose 不是硬期限或强制终止后端的机制。需要确定保存结果时在资源仍可用时 await flush，再按应用顺序释放 handle 和业务资源。

### 存档、默认 codec 与兼容读取

统一 envelope 为普通对象，自有 version 是非负安全整数，自有 state 非 null/undefined。assertVersionedEnvelope 与 IVersionedEnvelope 从 @migaia/storage-contract 导入；属性各读一次，ENVELOPE_INVALID 保留访问失败 cause。store-persist 不再拥有重复校验器或 envelope 错误类。

defaultJsonCodec 为名称 collections-json@1、output 为 text 的冻结对象，包装 fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))，默认就保留嵌套 Map/Set，使用 $rpc map/entries 与 set/values 保留记录。非有限数、undefined 根值、稀疏数组、循环与 Date 被拒绝；普通类实例投影可枚举字段。编码错误链依次为本包 ENCODE_FAILED、contract INVALID_ARGUMENT 与 serialize ENCODE_FAILED。非字符串或坏 JSON 保留本包 ENVELOPE_INVALID TypeError；合法 JSON 的 envelope 错误归 storage-contract。

历史集合标记与元组形数组均为普通应用数据，不恢复成集合；解码只委托规范 codec 一次。

defaultJsonCodec.encode 失败抛 ENCODE_FAILED TypeError，原因为 cause；decode 非字符串或坏 JSON / marker 抛 ENVELOPE_INVALID TypeError，解析失败的原因为 cause。默认 codec 不做加密或脱敏；自定义 codec 必须处理自己声明的数据形状。

### 存储投影与 codec 选路

IPersistStorage 是内部最小类型投影，不作为包入口具名导出：capabilities、get、set、remove、keys 来自 IKeyValueStore；不要求 backend、has、clearValues、clearAll 或 dispose。可选 getBytes / setBytes / removeBytes 来自 IRecordStore，不是 IKeyValueStore 本身。binary codec 的 clear() 用 removeBytes 只删除这个 byte key，不清空其他 byte key 或 text/record 通道；声明 binary 却缺少 removeBytes 时，clear 以 BACKEND_CAPABILITY 的 TypeError 拒绝，不回落到 text 删除。后端和 codec 的错误保留各自公共身份与原因，不保证都改成本包 source。

| 工具                                           | 选路与失败                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| writeEnvelope(storage, key, codec, value, ctx) | ctx 必填，可为空对象，signal 可省略；structured output 写入明确 CODEC_OUTPUT_MISMATCH，不走 record 通道。                                                                                   |
| binary 写入                                    | capabilities.binary 为真时要求两个字节方法，缺失为 BACKEND_CAPABILITY；编码值必须是 Uint8Array，否则 CODEC_OUTPUT_MISMATCH。                                                                |
| 其余写入分支                                   | 编码值必须为 string，交 storage.set；不自动 base64 降级。                                                                                                                                   |
| readEnvelope(storage, key, codec, ctx)         | binary 且 capabilities.binary 为真时走 getBytes，再 codec.decode；缺方法为 BACKEND_CAPABILITY，binary 能力为假则 CODEC_OUTPUT_MISMATCH。非 binary 走 get + decode。不存在时返回 undefined。 |
| removeEnvelope(storage, key, ctx, codec?)      | 按 codec 选择通道删除单个存档：默认 text 走 storage.remove；binary codec 且后端声明 binary 时走 removeBytes，缺少时抛 BACKEND_CAPABILITY 的 TypeError。不改变内存状态。                     |

二进制写入按真实 Uint8Array brand 判断，支持其他 realm 的 intrinsic / 子类，不接受只是包装了 Uint8Array 的 Proxy 冒充。仅有 text 后端却配置 binary 时应选合适后端或 text codec；不要认为有某个方法或一个 output 字符串就建立全部后端能力。

### 错误与排查

STORE_PERSIST_SOURCE 为 store.persist；稳定码由 StorePersistErrorCode 维护：

| 属性 / 码                                        | 含义                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| codecNotResolved / CODEC_NOT_RESOLVED            | 未解析到 codec，显式配置或修正默认解析。                      |
| codecOutputMismatch / CODEC_OUTPUT_MISMATCH      | codec output、实际 payload 与后端路由不一致。                 |
| backendCapability / BACKEND_CAPABILITY           | 进入 binary 分支但缺字节方法。                                |
| envelopeInvalid / ENVELOPE_INVALID               | Default JSON non-string input or decoding failure only.       |
| encodeFailed / ENCODE_FAILED                     | 默认 codec 编码失败，查看 cause 与待存值。                    |
| hydrateAndWriteFailed / HYDRATE_AND_WRITE_FAILED | 水合和写入均失败，展开 AggregateError.errors。                |
| abortedByDispose / ABORTED_BY_DISPOSE            | 释放中止，保持 DOMException / AbortError 及原始 cause。       |
| invalidOption / INVALID_OPTION                   | key、namespace、version、时间、回调、scheduler 或配置不合法。 |

非法配置同步抛本包 INVALID_OPTION TypeError，cause 保留 contract 计划错误。水合直接保留 contract ENVELOPE_INVALID、VERSION_UNSUPPORTED 与 MIGRATION_FAILED。失败水合使 flush/clear 阻塞至重试成功；写入错误查 writeError。handle 只拥有订阅和已接纳写入，store/runtime 始终借用。

公开错误工厂 createStorePersistError / createStorePersistTypeError 接收必填 code、message 和可选 options.cause；createStorePersistAbortError 接收 code、message、可选 cause，返回原生 DOMException，保持 name 为 AbortError；createStorePersistAggregateError 接收 code、errors、message，errors 保留原失败。code 类型为 IStorePersistErrorCode，工厂附加身份但不覆盖 stack。底层工具不需要在普通 Store 使用中自行重复实现。

包已有 fmt、lint、typecheck、typecheck:test、test、build 和 test:packed 脚本；实际报告说明哪些被执行，不以手册列出命令当成验证结论。排查未保存字段先看 partialize 与 debounce，再看 hydrationError / writeError；Map / Set 形状不对时检查是否换用了不支持集合的 codec。

## Canonical codec composition and observation

```ts
import { fromValueCodec } from '@migaia/storage-host/sdk'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'

const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))
const text = await codec.encode({ roles: new Map([['Ada', new Set(['read'])]]) })
console.log(await codec.decode(text))

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
const state = createStore({ count: 1 })
await using handle = persist(state, {
  key: 'counter',
  storage,
  codecStages: host.codecStages(storage)
})
await handle.ready
await handle.flush()
await handle.disposeAsync()
await state.$dispose()
```

The default codec already preserves collections. Use `{ ...row }` to project a named class. codecStages observes each real encode/decode once; before/after/error failures only report, before never waits, and no business values enter observation. disposeAsync caches the rejecting main Promise; Symbol.asyncDispose caches a separate reporting Promise over one cleanup. Neither closes a borrowed store/runtime. Without native Symbol.asyncDispose, plugin-host asyncDisposeKey is the fixed fallback; language-level await using is not promised.

## 快照与其他写入共同提交

`persistTransaction(storage, [handle], run, options?)` 先暂停并排空这些句柄的旧工作，再借用该原始完整 store 的一个事务。句柄必须活动且由同一个 storage 创建；空数组、复制的句柄与错误的事务视图报 `INVALID_OPTION`，文本适配器报 `BACKEND_CAPABILITY`。具体 store 的事务对象扩展、选项与回调返回值类型保持。

```ts doc-test=check
import { createStore } from '@migaia/store-light'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { persistTransaction } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
const settings = createStore({ count: 0 })
const handle = persist(settings, { key: 'settings', storage })
await handle.ready
try {
  await persistTransaction(storage, [handle], async (tx) => {
    settings.count = 1
    await handle.flush(tx)
    await tx.set('settings-source', 'user', { conflictPolicy: 'replace' })
  })
} finally {
  await handle.disposeAsync()
  await settings.$dispose()
}
```

`flush(tx)` 在调用时读取 snapshot、执行 partialize 并启动同一个 codec 的编码；同一句柄多次调用按次序写入各自快照。它只等此次编码与请求，外层 `persistTransaction` 成功才表示提交。实体可在同一个回调中用 `repository.in(tx).put(value)` 与快照、文本和字节写入共同提交。

参与期间，订阅只记录变化；无参数 `flush()`、`clear()`、`retryHydrate()` 拒绝。成功后继续按原 debounce 保存更新的内存；失败或回滚也不撤销内存，而是恢复普通镜像写入。需要撤销业务状态时，由调用方在 catch 中恢复。参与期间 dispose 会请求中止事务，不启动最终旁路写入；disposeAsync 等待真实事务结束。句柄始终借用 store 与 Runtime，不负责关闭它们。

IndexedDB 必须在原生活跃窗口直接发起请求。先取外部数据，再开始事务；不要在回调中等待 fetch、定时器或跨任务的 codec。对上例已有对象，可把外部读取放在协调边界之前：

```ts
async function saveExternal(loadSettings: () => Promise<{ count: number }>): Promise<void> {
  const incoming = await loadSettings()
  await persistTransaction(storage, [handle], async (tx) => {
    settings.count = incoming.count
    await handle.flush(tx)
    await tx.set('settings-source', 'remote', { conflictPolicy: 'replace' })
  })
}
```

可选 `transactionStages: host.transactionStages(storage)` 沿三个适配入口传给同一引擎；这里只发出 beforePersistFlush / afterPersistFlush，后者表示请求完成。codecStages 绑定此次真实操作视图，每次转换只观察一次。观察失败只报告，不等待、不改变业务结果。导出的 `ITransactionScopeOf<typeof storage>` 保留具体后端事务类型。

`ctx.concurrency` 可覆盖原始 store 的缺省策略。忙句柄先尝试一次：fail 立即拒绝，只有策略选择 wait 才进入可取消的 FIFO；自定义策略只在真实冲突后运行。句柄等待与后端内部重试共用这次调用的期限和等待预算，`timeoutMs` 不会在进入后端时重新起算。超时或取消后仍等待已开始的工作真正结束才释放占用。后端自有选项（包括 symbol 字段）保留值身份，取消 signal 则沿同一次协调传递。
