import type { ICaseDoc, IText } from './contract.js'

/** Keeps localized explanations beside complete public-entry examples. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Real in-memory storage paths with explicit ownership and deterministic output. */
export const storageWebCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  memoryStorageHost: [
    {
      title: t(
        'Keep edits to inputs and returned copies out of stored data',
        '修改输入与读取结果时不污染存储'
      ),
      problem: t(
        'A preview edits an uploaded byte array and a profile object after saving them. Those local edits must not silently rewrite the saved version.\n\nA Map that retains caller objects shares mutable references. Returning the same byte buffer or nested Map exposes another route around the write API.\n\nmemoryStorageHost copies bytes on both write and read and structured-clones records at both boundaries. Use setBytes/getBytes for bytes and putRecord/getRecord for structured values.',
        '预览保存上传字节和用户资料后，还会继续修改本地对象；这些修改不应悄悄覆盖已保存的版本。\n\n直接把对象放进 `Map` 会共享可变引用；读取时返回原字节数组或嵌套 `Map`，又给调用者提供了绕过写入方法的修改途径。\n\n`memoryStorageHost` 在写入和读取时都复制字节，并对记录执行结构化克隆；字节使用 `setBytes/getBytes`，对象记录使用 `putRecord/getRecord`。'
      ),
      example: t(
        "import { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IProfile = { visits: Map<string, number> }\nconst store = memoryStorageHost<IProfile>()\ntry {\n  const bytes = new Uint8Array([1, 2])\n  await store.setBytes('avatar', bytes)\n  bytes[0] = 9\n  const copy = await store.getBytes('avatar')\n  if (copy) copy[1] = 8\n  console.log(JSON.stringify(Array.from((await store.getBytes('avatar')) ?? [])))\n  const profile = { visits: new Map([['home', 1]]) }\n  await store.putRecord(profile, 'profile')\n  profile.visits.set('home', 9)\n  const record = await store.getRecord('profile')\n  record?.visits.set('home', 8)\n  console.log((await store.getRecord('profile'))?.visits.get('home'))\n} finally {\n  await store.dispose()\n}",
        "import { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IProfile = { visits: Map<string, number> }\nconst store = memoryStorageHost<IProfile>()\ntry {\n  const bytes = new Uint8Array([1, 2])\n  await store.setBytes('avatar', bytes)\n  bytes[0] = 9\n  const copy = await store.getBytes('avatar')\n  if (copy) copy[1] = 8\n  console.log(JSON.stringify(Array.from((await store.getBytes('avatar')) ?? [])))\n  const profile = { visits: new Map([['home', 1]]) }\n  await store.putRecord(profile, 'profile')\n  profile.visits.set('home', 9)\n  const record = await store.getRecord('profile')\n  record?.visits.set('home', 8)\n  console.log((await store.getRecord('profile'))?.visits.get('home'))\n} finally {\n  await store.dispose()\n}"
      ),
      result: t(
        'Prints `[1,2]` and `1` on separate lines. Neither edits to the original input nor edits to the first returned copy change the next read.\n\nThis store is volatile and isolated per factory call. Records must support structured cloning; this is not JSON conversion or browser persistence. It offers no native secondary indexes.',
        '逐行输出 `[1,2]` 和 `1`；修改原始输入与首次读取的副本，都没有改变下一次读取的结果。\n\n每次工厂调用创建独立的易失存储；记录必须可被结构化克隆，这不是 JSON 转换，也不提供浏览器持久化，且没有原生二级索引。'
      )
    },
    {
      title: t(
        'Discard a failed draft without erasing an unrelated write',
        '丢弃失败草稿并保留无关写入'
      ),
      problem: t(
        'A multi-record operation fails after preparing a balance change. An audit record written independently during the operation must remain available.\n\nWriting each step directly exposes partial results. Restoring an old copy of the whole Map on failure can erase another successful write that happened in the meantime.\n\nmemoryStorageHost.transaction stages record changes until its callback succeeds. This example deliberately rejects the draft while using the ordinary store API for a separate audit write.',
        '多记录操作在准备修改余额后失败，但操作期间通过独立路径写入的审计记录仍须保留。\n\n逐步直接写入会留下半成品；失败时用旧 `Map` 覆盖整个存储，又可能抹掉期间已经成功完成的其他写入。\n\n`memoryStorageHost.transaction` 先暂存记录改动，回调成功后才提交；本例主动让草稿失败，同时通过普通存储方法独立写入审计记录。'
      ),
      example: t(
        "import { StorageError } from '@migaia/storage-web'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\nconst store = memoryStorageHost<{ count: number }>()\nconst original = new Error('request failed')\ntry {\n  await store.putRecord({ count: 1 }, 'balance')\n  const changes: string[] = []\n  const stop = store.subscribeChanges((change) => { changes.push(change.kind) })\n  try {\n    await store.transaction(async (tx) => {\n      await tx.put({ count: 2 }, 'balance')\n      await store.putRecord({ count: 9 }, 'audit')\n      throw original\n    })\n  } catch (error) {\n    if (!(error instanceof StorageError)) throw error\n    console.log(error.code, error.cause === original)\n  }\n  console.log((await store.getRecord('balance'))?.count, (await store.getRecord('audit'))?.count)\n  console.log(changes.join(','))\n  stop()\n} finally {\n  await store.dispose()\n}",
        "import { StorageError } from '@migaia/storage-web'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\nconst store = memoryStorageHost<{ count: number }>()\nconst original = new Error('请求失败')\ntry {\n  await store.putRecord({ count: 1 }, 'balance')\n  const changes: string[] = []\n  const stop = store.subscribeChanges((change) => { changes.push(change.kind) })\n  try {\n    await store.transaction(async (tx) => {\n      await tx.put({ count: 2 }, 'balance')\n      await store.putRecord({ count: 9 }, 'audit')\n      throw original\n    })\n  } catch (error) {\n    if (!(error instanceof StorageError)) throw error\n    console.log(error.code, error.cause === original)\n  }\n  console.log((await store.getRecord('balance'))?.count, (await store.getRecord('audit'))?.count)\n  console.log(changes.join(','))\n  stop()\n} finally {\n  await store.dispose()\n}"
      ),
      result: t(
        'Prints `TRANSACTION_FAILED true`, `1 9`, and `put`. The original error remains on cause, the balance stays 1, and only the independent audit write emits a change.\n\nThe transaction covers record operations made through tx, not arbitrary external effects. Its callback error discards the draft; successful commits still use optimistic conflict checks and may reject with TRANSACTION_CONFLICT.',
        '逐行输出 `TRANSACTION_FAILED true`、`1 9`、`put`；原始错误保留在 `cause`，余额仍为 `1`，只有独立审计写入发出变更通知。\n\n事务只覆盖通过 `tx` 发起的记录操作，不会撤销任意外部副作用；回调失败会丢弃草稿，成功提交仍须通过乐观冲突检查，也可能以 `TRANSACTION_CONFLICT` 拒绝。'
      )
    }
  ],
  defineEntity: [
    {
      title: t('Reuse a primary key across separate record kinds', '让不同记录种类复用同一个主键'),
      problem: t(
        'Users and teams both have a record with ID 1. Saving a team must not replace the user simply because both live in the same backend.\n\nUsing the raw ID as a global Map key makes unrelated record kinds collide. Scattered string prefixes also force every read and delete to repeat the same encoding rule.\n\ndefineEntity captures the record kind in name and the primary-key field in key. Connect both definitions to the same memory store; each repository keeps its own record space.',
        '用户和团队都有主键为 `1` 的记录；即使共用一个后端，保存团队也不应覆盖用户。\n\n把原始主键直接当成全局 `Map` 键会让不同记录种类发生碰撞；到处拼接字符串前缀，又要求每次读取和删除都重复同一套编码规则。\n\n`defineEntity` 用 `name` 确定记录种类，用 `key` 指定主键字段；把两份定义连接到同一个内存后端，各自的仓储就拥有独立记录空间。'
      ),
      example: t(
        "import { defineEntity } from '@migaia/storage-web/entity'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IRow = { id: string; name: string }\nconst store = memoryStorageHost()\nconst users = defineEntity<IRow>({ name: 'users', key: 'id' }).connect(store)\nconst teams = defineEntity<IRow>({ name: 'teams', key: 'id' }).connect(store)\ntry {\n  await users.put({ id: '1', name: 'Ada' })\n  await teams.put({ id: '1', name: 'Research' })\n  console.log((await users.get('1'))?.name, (await teams.get('1'))?.name)\n} finally {\n  await store.dispose()\n}",
        "import { defineEntity } from '@migaia/storage-web/entity'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IRow = { id: string; name: string }\nconst store = memoryStorageHost()\nconst users = defineEntity<IRow>({ name: 'users', key: 'id' }).connect(store)\nconst teams = defineEntity<IRow>({ name: 'teams', key: 'id' }).connect(store)\ntry {\n  await users.put({ id: '1', name: '艾达' })\n  await teams.put({ id: '1', name: '研发' })\n  console.log((await users.get('1'))?.name, (await teams.get('1'))?.name)\n} finally {\n  await store.dispose()\n}"
      ),
      result: t(
        'Prints `Ada Research`. Both repositories retrieve their own record even though the backend and primary key are identical.\n\nThe default version is 1, the default schema is passthrough without validation, and memory uses structuredCodec by default. Names isolate record kinds, not access permissions; dispose the store after use.',
        '输出 `艾达 研发`；两个仓储共用后端与主键，仍分别读取到自己的记录。\n\n版本默认 `1`，结构校验器默认 `passthrough`，不做校验；内存后端默认使用 `structuredCodec`，名称隔离记录种类，不承担访问权限控制，使用结束后释放存储。'
      )
    },
    {
      title: t(
        'Transfer a unique value in one final transaction draft',
        '在同一事务最终草稿中转移唯一值'
      ),
      problem: t(
        'Two screens use separate repositories over one store. They must reject duplicate email owners, yet allow a batch to move an email from one record to another.\n\nA uniqueness cache owned by each repository misses writes from the other. Checking only intermediate batch steps rejects a valid transfer before the old owner is removed.\n\nUse the curried defineEntity form to declare a unique byEmail path index. Both repositories enforce it; batch validates its final draft. onDiagnostic is silent here to keep the output focused.',
        '两个页面各自连接同一个存储，既要拒绝邮箱被两个记录占用，也要允许在一批改动中把邮箱从旧记录转给新记录。\n\n每个仓储自行维护唯一值缓存，会漏掉另一个仓储的写入；只检查批处理中间步骤，又会在旧所有者被移除前误拒绝合法转移。\n\n用 `defineEntity<T>()({...})` 声明 `byEmail` 路径索引及 `unique: true`，两个仓储共同遵守约束，`batch` 检查最终草稿；本例用 `onDiagnostic` 静默诊断，突出业务输出。'
      ),
      example: t(
        "import { StorageError } from '@migaia/storage-web'\nimport { defineEntity } from '@migaia/storage-web/entity'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IUser = { id: string; email: string }\nconst store = memoryStorageHost()\nconst definition = defineEntity<IUser>()({\n  name: 'users',\n  key: 'id',\n  indexes: { byEmail: { path: 'email', unique: true } },\n  onDiagnostic: () => {}\n})\ntry {\n  const first = definition.connect(store)\n  const second = definition.connect(store)\n  await first.put({ id: 'a', email: 'same@example.test' })\n  try {\n    await second.put({ id: 'b', email: 'same@example.test' })\n  } catch (error) {\n    if (!(error instanceof StorageError)) throw error\n    console.log(error.code)\n  }\n  console.log((await second.get('b')) === undefined)\n  await second.batch(async (tx) => {\n    await tx.put({ id: 'b', email: 'same@example.test' })\n    await tx.remove('a')\n  })\n  console.log((await first.findBy('byEmail', 'same@example.test'))?.id, (await first.get('a')) === undefined)\n} finally {\n  await store.dispose()\n}",
        "import { StorageError } from '@migaia/storage-web'\nimport { defineEntity } from '@migaia/storage-web/entity'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IUser = { id: string; email: string }\nconst store = memoryStorageHost()\nconst definition = defineEntity<IUser>()({\n  name: 'users',\n  key: 'id',\n  indexes: { byEmail: { path: 'email', unique: true } },\n  onDiagnostic: () => {}\n})\ntry {\n  const first = definition.connect(store)\n  const second = definition.connect(store)\n  await first.put({ id: 'a', email: 'same@example.test' })\n  try {\n    await second.put({ id: 'b', email: 'same@example.test' })\n  } catch (error) {\n    if (!(error instanceof StorageError)) throw error\n    console.log(error.code)\n  }\n  console.log((await second.get('b')) === undefined)\n  await second.batch(async (tx) => {\n    await tx.put({ id: 'b', email: 'same@example.test' })\n    await tx.remove('a')\n  })\n  console.log((await first.findBy('byEmail', 'same@example.test'))?.id, (await first.get('a')) === undefined)\n} finally {\n  await store.dispose()\n}"
      ),
      result: t(
        'Prints `INDEX_UNIQUE_CONFLICT`, `true`, and `b true`. The rejected write leaves no record b; the later batch transfers the email to b and removes a.\n\nMemory uses a fallback uniqueness check, not a native index. unique defaults to false and an omitted diagnostic callback uses console.warn. Repository batch needs a record backend with rollback support.',
        '逐行输出 `INDEX_UNIQUE_CONFLICT`、`true`、`b true`；失败写入没有留下记录 `b`，后续批处理把邮箱转给 `b`，并移除了 `a`。\n\n内存后端通过回退检查保证唯一性，没有原生索引；`unique` 默认 `false`，省略诊断回调时使用 `console.warn`，仓储 `batch` 要求后端支持记录事务与回滚。'
      )
    },
    {
      title: t(
        'Preview an upgrade before explicitly saving its new version',
        '先读取升级结果再显式保存新版本'
      ),
      problem: t(
        'A release renames a stored field. Readers need the new shape immediately, but an ordinary get must not silently rewrite persisted records.\n\nCombining reads with migration writes makes a page visit a hidden mutation. Conversely, changing only TypeScript types leaves old stored values in the previous shape.\n\ndefineEntity declares version 2 and its required step 2. get runs that step in memory; migrate persists it explicitly. The example uses batchSize 1 instead of the default 100.',
        '新版本把已存字段改了名字；读取者需要立刻拿到新结构，但一次普通 `get` 不应悄悄改写已存记录。\n\n把读取与迁移写入绑在一起，会让访问页面变成隐藏修改；只改 TypeScript 类型，又不会改变后端里旧数据的实际结构。\n\n`defineEntity` 声明 `version: 2` 和必需的目标步骤 `2`，`get` 在内存中执行升级，`migrate` 才显式写回；本例将 `batchSize` 从默认 `100` 改成 `1`。'
      ),
      example: t(
        "import { defineEntity } from '@migaia/storage-web/entity'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IOldUser = { id: string; name: string }\ntype IUser = { id: string; displayName: string }\nconst store = memoryStorageHost()\ntry {\n  const old = defineEntity<IOldUser>({ name: 'users', key: 'id' }).connect(store)\n  await old.put({ id: 'a', name: 'Ada' })\n  let upgrades = 0\n  const users = defineEntity<IUser>({\n    name: 'users',\n    key: 'id',\n    version: 2,\n    migrations: {\n      2: async (previous) => {\n        upgrades += 1\n        const value = previous as IOldUser\n        return { id: value.id, displayName: value.name }\n      }\n    }\n  }).connect(store)\n  console.log((await users.get('a'))?.displayName, (await users.get('a'))?.displayName, upgrades)\n  const result = await users.migrate({ batchSize: 1 })\n  console.log(result.migrated, upgrades)\n  console.log((await users.get('a'))?.displayName, upgrades)\n} finally {\n  await store.dispose()\n}",
        "import { defineEntity } from '@migaia/storage-web/entity'\nimport { memoryStorageHost } from '@migaia/storage-web/memory'\n\ntype IOldUser = { id: string; name: string }\ntype IUser = { id: string; displayName: string }\nconst store = memoryStorageHost()\ntry {\n  const old = defineEntity<IOldUser>({ name: 'users', key: 'id' }).connect(store)\n  await old.put({ id: 'a', name: '艾达' })\n  let upgrades = 0\n  const users = defineEntity<IUser>({\n    name: 'users',\n    key: 'id',\n    version: 2,\n    migrations: {\n      2: async (previous) => {\n        upgrades += 1\n        const value = previous as IOldUser\n        return { id: value.id, displayName: value.name }\n      }\n    }\n  }).connect(store)\n  console.log((await users.get('a'))?.displayName, (await users.get('a'))?.displayName, upgrades)\n  const result = await users.migrate({ batchSize: 1 })\n  console.log(result.migrated, upgrades)\n  console.log((await users.get('a'))?.displayName, upgrades)\n} finally {\n  await store.dispose()\n}"
      ),
      result: t(
        'Prints `Ada Ada 2`, `1 3`, and `Ada 3`. Two reads each upgrade the old record; migrate upgrades and saves it once; the final read needs no further upgrade.\n\nA definition above version 1 requires every step from 2 through its version. Reads do not write back. Explicit migration reports per-record results and is not an atomic migration of the entire database.',
        '逐行输出 `艾达 艾达 2`、`1 3`、`艾达 3`；两次读取分别升级旧记录，`migrate` 再升级并保存一次，最后读取不再执行升级。\n\n高于版本 `1` 的定义必须提供从 `2` 到当前版本的全部步骤；读取不写回，显式迁移返回逐记录处理统计，不承诺整个数据库一次原子升级。'
      )
    }
  ],
  createStorageHost: [
    {
      title: t('Own and close named backend instances together', '统一拥有和关闭具名后端实例'),
      problem: t(
        'Preferences and temporary drafts need separate storage instances. Application shutdown must close both, including a store retained by a screen after the host is gone.\n\nA registry of store objects alone does not assign cleanup ownership. Forgetting one disposer leaves a stale screen able to write through an old reference.\n\nInstall storage-contract directly for its error type. createStorageHost installs two memoryBackendPlugin instances under distinct IDs. backend returns their actual stores; awaiting host.dispose releases the stores created by those plugins.',
        '偏好设置和临时草稿需要独立存储；应用退出时必须关闭两者，即使页面仍持有宿主之外的存储引用。\n\n只把存储对象放进注册表，并没有确定谁负责清理；漏调一个释放方法，就会让旧页面继续通过残留引用写入。\n\n直接安装 `@migaia/storage-contract` 以读取错误类型；`createStorageHost` 把两个 `memoryBackendPlugin` 实例安装到不同 ID，`backend` 返回真实存储；等待 `host.dispose()` 会释放这些插件创建的存储。'
      ),
      example: t(
        "import { StorageContractError } from '@migaia/storage-contract'\nimport { createStorageHost } from '@migaia/storage-web/host'\nimport { memoryBackendPlugin } from '@migaia/storage-web/plugins/memory'\n\nconst host = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'preferences' }), memoryBackendPlugin({ id: 'drafts' })] as const\n})\nconst preferences = host.backend('preferences')\nconst drafts = host.backend('drafts')\ntry {\n  await preferences.set('theme', 'dark')\n  await drafts.set('theme', 'light')\n  console.log(await preferences.get('theme'), await drafts.get('theme'), host.backends().size)\n} finally {\n  await host.dispose()\n}\ntry {\n  await drafts.get('theme')\n} catch (error) {\n  if (!(error instanceof StorageContractError)) throw error\n  console.log(error.code)\n}",
        "import { StorageContractError } from '@migaia/storage-contract'\nimport { createStorageHost } from '@migaia/storage-web/host'\nimport { memoryBackendPlugin } from '@migaia/storage-web/plugins/memory'\n\nconst host = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'preferences' }), memoryBackendPlugin({ id: 'drafts' })] as const\n})\nconst preferences = host.backend('preferences')\nconst drafts = host.backend('drafts')\ntry {\n  await preferences.set('theme', '深色')\n  await drafts.set('theme', '浅色')\n  console.log(await preferences.get('theme'), await drafts.get('theme'), host.backends().size)\n} finally {\n  await host.dispose()\n}\ntry {\n  await drafts.get('theme')\n} catch (error) {\n  if (!(error instanceof StorageContractError)) throw error\n  console.log(error.code)\n}"
      ),
      result: t(
        'Prints `dark light 2` and `STORE_DISPOSED`. The same text key has independent values in two backends, and a retained store rejects reads after host disposal.\n\nThese plugins create volatile owned stores. Initial plugin installation completes before the host resolves; the default batch installation budget is 30000 ms. This example makes no browser persistence claim.',
        '逐行输出 `深色 浅色 2`、`STORE_DISPOSED`；两个后端的同名文本键保留独立值，宿主释放后，残留存储引用的读取被拒绝。\n\n这些插件创建由宿主拥有的易失存储；初始插件全部安装完成后宿主才返回，整批安装预算默认 `30000` 毫秒，本例不证明浏览器持久化。'
      )
    }
  ]
}
