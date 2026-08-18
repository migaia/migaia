# @migaia/store-persist

**给 store-light/store-keyed/store-indexed 三种 store 形状统一接一根自动充电线，底座是 `@migaia/storage-web`**——状态变了就（防抖）写进存储，页面/进程重启时自动读回来，读写时机、版本迁移、写入排队全部托管，不用自己写胶水代码。

## 1. 这是什么

Store 本身只管内存里的响应式状态，重启就没了。要让状态"记住"，通常要自己写一堆胶水代码：启动时读存储、解析、灌回内存；状态变化时又要编码、防抖、写回；存储 schema 改了还要处理旧数据兼容。

`@migaia/store-persist` 把这条"内存状态 ⇄ storage-web"的管路做成三个函数，分别对应三种 store 形状：

- **`persist(store, options)`**——给 `@migaia/store-light` 的扁平 Store 用，一个 store = 一份持久化状态。
- **`persistCollection(collection, options)`**——给 `@migaia/store-indexed` 的 `ObservableObject`/`ObservableArray`/`ObservableMap`/`ObservableSet` 用，一个 collection = 一份持久化状态。
- **`persistKeyed(atomStore, def, id, options)`**——给 `@migaia/store-keyed` 的按 key 生产的 `AtomStore` 用，每个 key 各自一份独立的持久化状态；配套 `clearFamily()` 做批量清空。

三个函数底下共用同一个核心引擎（`persistUnit()`）——hydrate、防抖写回、dispose 清理只实现一遍，各自只是把自己的原生 API 适配成核心引擎认的最小接口。

存储后端直接对接 `@migaia/storage-web`：本包要求具备 `capabilities`、`get`、`set`、`remove`、`keys`
的键值存储能力，并接受 `ICodec`。默认 text codec 支持 Map/Set；binary codec 还要求
`getBytes`/`setBytes`。本包的最小 storage 投影不支持 `structured` codec。

## 2. 适合什么场景

| 场景 | 用哪个函数 |
| --- | --- |
| 用户设置、草稿、UI 偏好需要跨会话保留（扁平字段） | `persist()` |
| 一份可枚举的集合（标签列表、购物车条目、按 id 索引的缓存表）需要整体持久化 | `persistCollection()` |
| 按 key 动态生成的状态（每个用户、每个对话各自的资料），只想持久化其中一部分（比如 refreshToken） | `persistKeyed()` + `partialize`/`merge` |
| 需要批量清空某一类 keyed 持久化记录（登出清空全部 session 缓存） | `clearFamily()` |
| 需要处理"存储里是旧版本数据"的情况 | 三个函数都支持 `version` + `migrate()` |

不适合的场景：如果只是想把一次性数据存进 storage-web（不需要跟内存状态双向同步、不需要迁移），直接用 `@migaia/storage-web` 的 `IKeyValueStore` 更直接。

## 3. 用了之后能得到什么

- **三种 store 形状统一心智**：不管是扁平 store、集合还是按 key 动态生成的状态，读写时机、防抖、dispose 语义完全一致——学一遍，三条路径都会用。
- **能力显式匹配**：默认 text codec 可安全往返 Map/Set；binary codec 只在后端提供字节通道时可用，`structured` codec 不属于本包的 storage 协议。
- **局部字段持久化**：`partialize`/`merge` 让你只持久化状态里的一部分（比如 OAuth session 只存 refreshToken），其余字段保留在内存里。
- **默认 codec 认得 Map/Set**：不用自己处理"`JSON.stringify(Map)` 静默丢数据"这种坑。
- **版本迁移是显式的、不迁移就报错**：存档版本和当前 `version` 不一致又没提供 `migrate()`，直接失败，不会用未迁移的旧数据冒充新版本。
- **keyed 场景批量操作有专门入口**：`clearFamily()` 直接问 storage-web 要 key 列表按前缀清空，不需要遍历内存里的 `AtomStore`（它本来就不知道自己有哪些 key）。

## 4. 安装

```bash
pnpm add @migaia/store-persist @migaia/storage-web
```

`@migaia/store-light`/`@migaia/store-keyed`/`@migaia/store-indexed` 是 **peerDependencies**（各自 `optional: true`）——只用得到哪条路径就只需要装对应的 store 包，不会被迫装全部三个。

## 5. 最小可跑示例

```ts
import { createStore } from '@migaia/store-light';
import { memoryStorage } from '@migaia/storage-web';
import { persist } from '@migaia/store-persist';

const store = createStore({ theme: 'light', fontSize: 14 });

const handle = persist(store, {
  key: 'settings',
  storage: memoryStorage(), // 生产环境换成 localStorage()/indexedDb()
  version: 1,
  debounceMs: 250
});

await handle.ready; // 首次 hydrate 完成（成功；失败会 reject）
store.theme = 'dark'; // 250ms 后自动写回存储
await handle.flush(); // 需要立即落盘时手动调用（退出前、测试收尾）
handle.dispose(); // 停止订阅
```

`persistCollection()`/`persistKeyed()` 的最小示例见 [USEGUIDE.md](./USEGUIDE.md)——三者共用同一套 `key`/`storage`/`version`/`migrate`/`partialize`/`debounceMs` 配置项，只是接入对象不同。

## 6. 模块一览

| 模块 | 提供什么 |
| --- | --- |
| `core` | `IPersistUnit`/`persistUnit()`——真正做事的持久化引擎，三条路径共用 |
| `light` | `persist()`——`@migaia/store-light` 适配层 |
| `indexed` | `persistCollection()`——`@migaia/store-indexed` 四种集合适配层 |
| `keyed` | `persistKeyed()` + `clearFamily()`——`@migaia/store-keyed` 动态编排 + 批量清空 |
| `storage` | 对接 `@migaia/storage-web` 的 `ICodec`，含默认 JSON codec |

## 7. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **`IPersistUnit`** | 三条路径共用的最小持久化接口：`snapshot()`/`restore()`/`subscribe()`，见 USEGUIDE |
| **存档信封（envelope）** | 实际写入存储的内容：`{ version, state }` |
| **`status`** | 持久化整体状态机：`loading` → `ready`，任何阶段失败进入 `error`，`dispose()` 后进入 `disposed` |
| **`ready` / `settled`** | 两个 Promise：`ready` hydrate 成功 resolve、失败 reject；`settled` 不管成功失败都 resolve |
| **`partialize`/`merge`** | 只持久化状态的一部分（写）+ 把持久化的子集合并回完整状态（读），两者要配对提供 |
| **`namespace`（仅 keyed）** | `persistKeyed()` 必填字段，storage key 格式 `${namespace}:${id}`，`clearFamily()` 靠它过滤 |

## 8. 生命周期、错误与资源边界

1. **`version` 不匹配又没给 `migrate()` 会让 hydrate 直接失败**（`handle.ready` reject），内存状态保持不变——有意设计，不会用未迁移的旧数据冒充新版本。
2. **默认 `merge` 只对 plain object 做启动快照三向合并**：hydrate 期间本地改过的字段优先；数组/Map/Set 等形状整体采用持久化值。收窄 `partialize` 或需要深层语义时，提供匹配的 `merge`。
3. **`persistKeyed()` 的 `namespace` 是必填的**，不是可选项——它同时决定 storage key 格式和 `clearFamily()` 的过滤前缀。
4. **`clearFamily()` 不会清理内存里已经实例化的 `AtomStore` 状态**——它只删 storage，调用方仍持有的 `persistKeyed()` handle 需要自己 `dispose()`。
5. **`storage` 是必填项**（不像旧版本默认 `memoryStorage()`）——三个函数都要求显式传入 storage-web 的 store，避免"忘了传等于没生效"这种误用。
6. **敏感数据不要无加密直接写 localStorage**——本包不提供加密，需要的话自己实现一个 `ICodec` 传给 `codec` 选项。

`dispose()` 取消订阅、计时器和在途 I/O；随后 `flush()`/`clear()` 以原生 `AbortError`（
`source: '@migaia/store-persist'`、`code: 'ABORTED_BY_DISPOSE'`）失败。hydrate/write 错误通过
handle 状态与 Promise 暴露；双重失败为保留两个原因的 `AggregateError`。

## 9. 深入参考

`IPersistUnit` 核心引擎的精确语义、三条适配路径各自的 typing/data flow、`clearFamily()` 完整行为、存档格式与迁移、`IPersistHandle` 全部字段、与 `@migaia/storage-web` 能力路由（结构化直存、二进制降级）的组合示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
