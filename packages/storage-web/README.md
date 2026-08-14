# @migaia/storage-web

**浏览器端存储的统一驱动层**——用同一套 API 操作 `localStorage`、`sessionStorage`、`cookie`、`IndexedDB` 和纯内存存储，并在其上叠一层可选的声明式 entity/schema/序列化扩展点。

## 1. 这是什么

浏览器里能持久化数据的 API 有好几套：`localStorage.setItem`、`document.cookie = "..."`、`indexedDB.open(...)` 各有各的写法、各有各的坑（同步阻塞、4KB 单值上限、升级版本管理……）。业务代码一旦要在"简单配置用 localStorage，大数据用 IndexedDB，敏感态用 cookie"之间切换，就得同时维护好几套心智模型。

`@migaia/storage-web` 把这些差异封进 5 个后端工厂（`localStorage()`、`sessionStorage()`、`cookies()`、`indexedDb()`、`memoryStorage()`），全部实现同一个 `get/set/remove/has/keys/dispose` 的最小契约（**L0 KV 通道**）；其中原生支持结构化存储的两个后端（`memoryStorage`、`indexedDb`）额外实现字节、文档、事务、游标扫描（**L1 Record 通道**）。可以类比成 Node 生态里的 `fs` 模块之于不同文件系统——业务代码只认一套接口,换后端不用改调用方式。

在这套统一存储之上,`entity` 层提供一个轻量 "mini-repository":声明一个领域类型的名字、主键、可选的 schema 校验和版本迁移规则,`connect()` 到任意后端后就能 `get/put/remove/list/stream/migrate/batch`——即使换成一个只有 `get/set` 的 KV-only 后端(比如 localStorage),`list()`/`migrate()` 这些"看起来需要查询能力"的方法依然能工作(退化为全键扫描)。

## 2. 适合 / 不适合的场景

| 适合 | 不适合 |
| --- | --- |
| 浏览器主线程、Electron renderer 进程里持久化配置、会话、缓存数据 | Node.js / Bun / Deno 服务端(没有 `localStorage`/`document`/`indexedDB`) |
| Web Worker 里用 IndexedDB 或纯内存存储做计算缓存 | 小程序、Electron 主进程等无 DOM/BOM 的运行时 |
| 需要在同一套业务代码里适配"用户可能开隐私模式导致 localStorage 抛异常"这类不确定性 | 需要跨标签页实时同步通知(本包不订阅 `storage` 事件,那是状态管理层的职责) |
| 需要给同一份领域数据定义版本化的存储结构、并在旧数据上做迁移 | 需要服务端持久化 / 跨设备同步(本包只管本地存储) |

Worker 上下文里 `localStorage`/`sessionStorage`/`cookies` 通常不可用(没有 `document`,`localStorage` 也不总存在);`indexedDb()`/`memoryStorage()` 已在 Chromium/WebKit 的真实 module Worker E2E 中验证可用，Web Storage/cookie 的不可用错误也有断言覆盖。

默认 E2E 门禁运行 Chromium + WebKit；Firefox 是可选矩阵。安装对应 Playwright 浏览器后，可用 `PLAYWRIGHT_BROWSER=firefox pnpm run test:e2e` 单独运行 Firefox 的 14 项场景；未安装 executable 时 Playwright 会在启动前明确失败，不会被误报为业务测试通过。

## 3. 核心卖点

- **统一契约,按能力分层**——所有后端都实现 L0(字符串键值);`memoryStorage`/`indexedDb` 额外实现 L1(字节/文档/事务/游标),用 `store.capabilities` 在运行时探测,或用 `isRecordStore()`/`asRecordStore()` 做类型收窄。
- **输入边界明确**——L0 `set()` 只接受字符串 value；L1 `setBytes()` 只接受 `Uint8Array`（包含跨 realm 实例），非法运行时输入统一抛 `INVALID_ARGUMENT`，不会依赖宿主隐式类型转换。
- **声明式 entity 仓储**——`defineEntity()` 一次声明,`connect()` 到任意后端都能用;版本迁移、无效记录处理、断点续传式的批量迁移(`repository.migrate()`)开箱即用。
- **可插拔的 schema 与序列化**——不绑定 zod/valibot 等任何校验库(通过 [Standard Schema](https://standardschema.dev) 适配器接入),自定义 codec(压缩、加密)按后端能力自动选路,不兼容时显式报错而不是静默丢数据。
- **归一化错误**——所有失败最终都是 `StorageError` 的实例,带稳定的 `error.code`(19 种),原始异常保留在 `error.cause` 里,不会被吞掉。
- **IndexedDB 的硬骨头都处理了**——连接复用、`onblocked`/`onversionchange`、schema 自动升级建表、历史 `documents` 存储的可恢复批量迁移、事务级乐观并发冲突检测(`TRANSACTION_CONFLICT`)。
- **零运行时依赖**——`@migaia/store-persist` 直接消费本包的 `IKeyValueStore`/`ICodec` 契约，依赖方向由 store-persist 指向本包，本包不 import 任何 store 包。

## 4. 安装

```bash
pnpm add @migaia/storage-web
```

## 5. 五分钟上手

最简单的用法——像用 `localStorage` 一样用,但拿到统一的错误处理和命名空间隔离:

```ts
import { localStorage } from '@migaia/storage-web';

const store = localStorage({ namespace: 'app' });

await store.set('theme', 'dark');
await store.get('theme'); // 'dark'

// 同步后端(local/session/cookie/memory)额外暴露 sync 通道,跳过 Promise 开销
store.sync.set('theme', 'light');
store.sync.get('theme'); // 'light'
```

声明式 entity——同一份定义可以 `connect()` 到 `memoryStorage()`(测试)或 `indexedDb()`(生产),代码不用改:

```ts
import { defineEntity, memoryStorage } from '@migaia/storage-web';

type IUser = { id: string; name: string; email: string };

const users = defineEntity<IUser>({ name: 'users', key: 'id' });
const repo = users.connect(memoryStorage());

await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' });
const user = await repo.get('u1'); // { id: 'u1', name: 'Ada', email: '...' }
const all = await repo.list();     // IUser[]
```

## 6. 核心概念一览

| 概念 | 是什么 | 类比 |
| --- | --- | --- |
| **L0 KV 通道**(`IKeyValueStore`) | 所有后端都实现的 `string → string` 键值接口 | `localStorage` 的最小公分母 |
| **L1 Record 通道**(`IRecordStore`) | `memoryStorage`/`indexedDb` 额外实现的字节/文档/事务/游标接口 | 一个迷你文档数据库 |
| **Capabilities**(`store.capabilities`) | 运行时探测某个后端具备哪些能力(是否支持字节、事务、单值上限……) | HTTP 响应头里的 `Accept` 协商,但反过来是能力声明 |
| **Entity / Repository** | `defineEntity()` 声明领域对象的名字、主键、版本;`connect(store)` 后得到可 CRUD/查询/迁移的仓储 | ORM 里的 Model / Repository |
| **Schema**(`ISchemaAdapter`) | 领域层校验 + 编解码扩展点,默认零校验直接透传 | 数据入库前的 DTO 校验 |
| **Codec**(`ICodec`) | 存储层编解码扩展点(对象 ↔ 字符串/字节),按后端能力自动选路 | 数据库驱动的序列化层 |
| **StorageError** | 所有失败的统一归一化形态,带稳定 `error.code` | 数据库驱动抛出的带 SQLSTATE 的异常 |

## 7. 后端能力一览

| 后端 | L1(records) | 同步(sync) | 二进制 | 事务 | 单值上限 | 典型用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `localStorage()` | 否 | 是 | 否 | 否 | ~5MB | 持久化的小型配置/偏好 |
| `sessionStorage()` | 否 | 是 | 否 | 否 | ~5MB | 会话级临时状态 |
| `cookies()` | 否 | 是 | 否 | 否 | 4096 字节 | 需要随请求发往服务端的小数据 |
| `memoryStorage()` | 是 | 是 | 是 | 是 | 无限制 | 测试、SSR 占位、进程内临时态 |
| `indexedDb()` | 是 | 否(全异步) | 是 | 是 | 无限制(受配额约束) | 较大数据量、结构化记录、需要事务 |

`cookies()` 的 `capabilities.opaqueEntries === true`:HttpOnly cookie 对 JS 不可见,`has()` 返回 `false` 不代表真的不存在。

## 8. 模块一览

| 模块 | 提供什么 |
| --- | --- |
| `backends` | 5 个后端工厂:`localStorage`/`sessionStorage`/`cookies`/`memoryStorage`/`indexedDb` |
| `types` | 契约类型(`IKeyValueStore`/`IRecordStore`/...)、`StorageError`/`StorageErrorCode` |
| `entity` | `defineEntity()`,声明式 repository:`get`/`put`/`remove`/`list`/`stream`/`migrate`/`batch` |
| `schema` | 领域校验/编解码扩展点:`passthrough`、`fromStandardSchema`、`runMigrations` |
| `serialize` | 存储格式编解码扩展点:`jsonCodec`/`structuredCodec`/`binaryCodec`、`selectCodec` 自动选路 |

## 9. 注意事项(最容易踩的坑)

1. **不要在模块顶层直接用 `localStorage`/`document`/`indexedDB`**——隐私模式下 `localStorage` 对象存在但 `setItem` 会抛异常,工厂函数内部已做探测并转成 `BACKEND_UNAVAILABLE`,但只有在调用工厂函数时才会触发,不要自己在模块加载阶段访问这些全局对象。
2. **跨通道写入默认互斥**——同一个 key 如果已经以 `value`/`bytes`/`record` 某一种通道存在(仅 `memoryStorage`/`indexedDb` 会出现,因为只有它们有多通道),再往另一通道写会抛 `DUPLICATE_KEY`;需要覆盖时显式传 `{ conflictPolicy: 'replace' }`。
3. **cookie 的 scope 在构造时固定**——`cookies({ scope })` 之后所有写入/删除都用同一个 `path`/`domain`/`sameSite`,不能按次覆盖;`SameSite=None` 必须搭配 `secure: true`,否则构造期直接抛 `INVALID_ARGUMENT`。
4. **读到旧版本 entity 不会自动写回**——`repository.get()`/`list()` 只在内存里跑迁移函数,要持久化新版本必须显式调用 `repository.migrate()` 或再 `put()` 一次。
5. **`entity.migrate()` 的断点续传只在 `indexedDb` 上生效**——它依赖后端的 `metadata` 通道存 checkpoint,`memoryStorage` 没有实现这个通道,进程内可以重复调用但不会跳过已扫描的部分。
6. **`list()`/`stream()` 传 `orderBy` 会放弃流式优势**——需要先把全部匹配记录读进内存排序,再应用 `limit`;数据量大时优先考虑不排序或换 range 缩小扫描范围。
7. **KV-only 后端(`localStorage` 等)上的 entity `list()`/`stream()`/`migrate()` 是全量键扫描**,数据量大时会明显变慢——会通过 `onDiagnostic` 报一次提醒,不是静默发生。
8. **IndexedDB legacy `documents` 清理是破坏性发布动作**——首次打开只会分批复制到 `records` 并保留旧 store；确认所有活跃客户端已完成迁移、且不再需要回滚旧版本后，才在发布配置中显式开启 `indexedDb({ cleanupLegacyRecords: true })`。该选项只会删除已记录为 `complete` 且目标 store 匹配的 legacy store，不是通用数据库清理开关。
9. **不要让 transaction scope 逃逸 callback**——`tx` 只在 callback pending 期间有效；callback 完成或失败后再调用 `tx.get/put/delete` 会抛 `TRANSACTION_FAILED`，避免脱离提交生命周期的操作静默成功。
10. **clear 的取消不会产生部分清理**——`clearRecords()`/`clearAll()` 在 signal abort 时返回 `ABORTED`，并保持原有 records/value；不要把取消视为已完成清理。
11. **deleteRecord 的取消不会误删数据**——`deleteRecord()` 在 signal abort 时返回 `ABORTED`，并保持待删除 record；不要把取消视为已完成删除。
12. **channel write 的取消不会提交部分写入**——`setBytes()`/`putRecord()` 等 IndexedDB 写入在 signal abort 时返回 `ABORTED`，不会保留已调度的部分 mutation。
13. **扩展点取消是协作式的**——schema/codec 收到 abort 后调用方会返回 `ABORTED`，但扩展函数本身无法被强制终止；扩展后续资源必须自行响应 signal。

更完整的配置项、错误码、迁移语义与生产级示例见 **[USEGUIDE.md](./USEGUIDE.md)**。
