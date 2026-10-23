import type { ICaseDoc } from './contract.js'

/** Complete public-adapter scenarios shared with the bilingual usage guides. */
export const storePersistCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  persist: [
    {
      title: {
        en: 'Keep edits made while an archive is loading',
        zh: '恢复存档时保留启动期修改'
      },
      problem: {
        en: 'A settings archive contains an older counter, but the user changes it before startup restoration finishes.\n\nApplying the saved object wholesale overwrites the new counter; skipping restoration also loses saved fields the user has not touched.\n\nAttach persist before editing, then await ready. Its default plain-object merge compares each current field with the startup snapshot; flush writes the reconciled state.',
        zh: '设置存档里有旧计数，用户却在启动恢复完成前改了计数。\n\n直接用存档覆盖整个对象会丢掉新计数；完全跳过恢复，又会丢掉用户尚未修改的已存字段。\n\n先接入 `persist`，再允许编辑并等待 `ready`；默认普通对象合并逐字段对照启动快照，保留本地修改，再用 `flush` 保存合并结果。'
      },
      example: {
        en: "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persist } from '@migaia/store-persist/light'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set(\n  'settings',\n  (await defaultJsonCodec.encode({\n    version: 0,\n    state: { theme: 'dark', count: 10 }\n  })) as string\n)\nconst settings = createStore({ theme: 'light', count: 0 })\nconst handle = persist(settings, { key: 'settings', storage })\nsettings.count = 1\nawait handle.ready\nconsole.log('restored:', settings.theme, settings.count)\nawait handle.flush()\nconst saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {\n  state: { theme: string; count: number }\n}\nconsole.log('saved:', saved.state.theme, saved.state.count)\nhandle.dispose()\nawait settings.$dispose()",
        zh: "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persist } from '@migaia/store-persist/light'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set(\n  'settings',\n  (await defaultJsonCodec.encode({\n    version: 0,\n    state: { theme: 'dark', count: 10 }\n  })) as string\n)\nconst settings = createStore({ theme: 'light', count: 0 })\nconst handle = persist(settings, { key: 'settings', storage })\nsettings.count = 1\nawait handle.ready\nconsole.log('恢复：', settings.theme, settings.count)\nawait handle.flush()\nconst saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {\n  state: { theme: string; count: number }\n}\nconsole.log('保存：', saved.state.theme, saved.state.count)\nhandle.dispose()\nawait settings.$dispose()"
      },
      result: {
        en: 'The output is `restored: dark 1`, then `saved: dark 1`: the saved theme returns while the local counter wins.\n\nThe default version is 0 and debounceMs is 0. This is a shallow Object.is comparison for plain objects; arrays, Map and Set use whole-state replacement instead.',
        zh: '依次输出 `恢复： dark 1`、`保存： dark 1`：主题来自存档，计数保留启动后的本地值。\n\n`version` 默认 `0`，`debounceMs` 默认 `0`；普通对象按字段做浅层 `Object.is` 比较，数组、`Map`、`Set` 则整体替换。'
      }
    },
    {
      title: {
        en: 'Repair a failed archive before reopening writes',
        zh: '修复坏存档后再恢复写入'
      },
      problem: {
        en: 'A malformed archive makes startup fail, and the user keeps editing the live settings.\n\nWriting defaults immediately would destroy the failed archive before it can be inspected or repaired; treating a settled Promise as successful restoration has the same risk.\n\nCatch ready, inspect the failure, and repair the real storage record. Await retryHydrate before flushing; it reopens writes only after a successful read and restore.',
        zh: '启动时读到了损坏存档，恢复失败后用户仍在修改内存中的设置。\n\n这时立即保存默认值，会在排查或修复前覆盖原存档；把等待结束误当成恢复成功，也会造成同样的问题。\n\n捕获 `ready` 的失败并修复真实存储记录，再等待 `retryHydrate` 成功后调用 `flush`；只有成功读取与恢复后才重新开放写入。'
      },
      example: {
        en: "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persist } from '@migaia/store-persist/light'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set('settings', '{')\nconst settings = createStore({ count: 0 })\nconst handle = persist(settings, { key: 'settings', storage })\nconst initialReady = handle.ready\nconst failure = await initialReady.catch((error: unknown) => error)\nsettings.count = 2\nconst writeFailure = await handle.flush().catch((error: unknown) => error)\nconsole.log('blocked:', handle.status.value, writeFailure === failure)\nconsole.log('untouched:', (await storage.get('settings')) === '{')\nawait storage.set(\n  'settings',\n  (await defaultJsonCodec.encode({\n    version: 0,\n    state: { count: 10 }\n  })) as string\n)\nawait handle.retryHydrate()\nawait handle.flush()\nconsole.log('recovered:', handle.status.value, settings.count, handle.ready === initialReady)\nconsole.log('first attempt:', (await handle.ready.catch((error: unknown) => error)) === failure)\nhandle.dispose()\nawait settings.$dispose()",
        zh: "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persist } from '@migaia/store-persist/light'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set('settings', '{')\nconst settings = createStore({ count: 0 })\nconst handle = persist(settings, { key: 'settings', storage })\nconst initialReady = handle.ready\nconst failure = await initialReady.catch((error: unknown) => error)\nsettings.count = 2\nconst writeFailure = await handle.flush().catch((error: unknown) => error)\nconsole.log('写入暂停：', handle.status.value, writeFailure === failure)\nconsole.log('原档未变：', (await storage.get('settings')) === '{')\nawait storage.set(\n  'settings',\n  (await defaultJsonCodec.encode({\n    version: 0,\n    state: { count: 10 }\n  })) as string\n)\nawait handle.retryHydrate()\nawait handle.flush()\nconsole.log('恢复完成：', handle.status.value, settings.count, handle.ready === initialReady)\nconsole.log('首次尝试：', (await handle.ready.catch((error: unknown) => error)) === failure)\nhandle.dispose()\nawait settings.$dispose()"
      },
      result: {
        en: 'The output is `blocked: error true`, `untouched: true`, `recovered: ready 2 true`, then `first attempt: true`.\n\nFailed hydration blocks automatic writes and makes flush reject with the same failure. Retry keeps the original startup baseline and does not replace ready; settled alone only waits for the first attempt.',
        zh: '依次输出 `写入暂停： error true`、`原档未变： true`、`恢复完成： ready 2 true`、`首次尝试： true`。\n\n恢复失败会暂停自动写入，`flush` 也拒绝并保留同一个失败对象；重试仍使用原启动快照，且不替换 `ready`，`settled` 只等待首次尝试结束。'
      }
    },
    {
      title: {
        en: 'Migrate old settings and save only selected fields',
        zh: '迁移旧设置并只保存指定字段'
      },
      problem: {
        en: 'A new release renames a saved field, while temporary session data must stay in memory.\n\nReading old state as if it already used the new schema loses the renamed value; serializing every field also writes temporary data into the archive.\n\nSet version to 2, map the old state synchronously with migrations, and select saved fields with partialize. This example reads version 1 and explicitly retains only theme on writes.',
        zh: '新版本重命名了已存字段，同时有些会话数据只应留在内存里。\n\n把旧数据当成新结构读取会漏掉改名字段；每次保存整个对象又会把临时数据写进存档。\n\n显式设置 `version: 2`，用同步 `migrations` 转换旧状态，再用 `partialize` 选择保存字段；本例读取版本 `1`，写入时只保留主题。'
      },
      example: {
        en: "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persist } from '@migaia/store-persist/light'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set(\n  'settings',\n  (await defaultJsonCodec.encode({\n    version: 1,\n    state: { legacyTheme: 'dark' }\n  })) as string\n)\nconst settings = createStore({ theme: 'light', temporary: 'session-only' })\nlet migratedFrom = 0\nconst handle = persist(settings, {\n  key: 'settings',\n  storage,\n  version: 2,\n  migrations: { 2: (previous, { fromVersion }) => {\n    const state = previous as Record<string, unknown>\n    migratedFrom = fromVersion\n    return { theme: String(state.legacyTheme) }\n  } },\n  partialize: (state) => ({ theme: state.theme })\n})\nawait handle.ready\nconsole.log('migrated:', migratedFrom, settings.theme, settings.temporary)\nsettings.theme = 'contrast'\nawait handle.flush()\nconst saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {\n  version: number\n  state: { theme: string; temporary?: string }\n}\nconsole.log('archive:', saved.version, saved.state.theme, Object.hasOwn(saved.state, 'temporary'))\nhandle.dispose()\nawait settings.$dispose()",
        zh: "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persist } from '@migaia/store-persist/light'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set(\n  'settings',\n  (await defaultJsonCodec.encode({\n    version: 1,\n    state: { legacyTheme: 'dark' }\n  })) as string\n)\nconst settings = createStore({ theme: 'light', temporary: 'session-only' })\nlet migratedFrom = 0\nconst handle = persist(settings, {\n  key: 'settings',\n  storage,\n  version: 2,\n  migrations: { 2: (previous, { fromVersion }) => {\n    const state = previous as Record<string, unknown>\n    migratedFrom = fromVersion\n    return { theme: String(state.legacyTheme) }\n  } },\n  partialize: (state) => ({ theme: state.theme })\n})\nawait handle.ready\nconsole.log('迁移：', migratedFrom, settings.theme, settings.temporary)\nsettings.theme = 'contrast'\nawait handle.flush()\nconst saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {\n  version: number\n  state: { theme: string; temporary?: string }\n}\nconsole.log('存档：', saved.version, saved.state.theme, Object.hasOwn(saved.state, 'temporary'))\nhandle.dispose()\nawait settings.$dispose()"
      },
      result: {
        en: 'The output is `migrated: 1 dark session-only`, then `archive: 2 contrast false`: the renamed field is restored and the temporary field is absent from storage.\n\nVersion defaults to 0; a mismatch without migrations fails hydration. partialize defaults to identity, and both callbacks must return synchronously. migrations converts the state to restore; this example awaits flush to confirm the new archive is written.',
        zh: '依次输出 `迁移： 1 dark session-only`、`存档： 2 contrast false`：旧主题完成转换，临时字段没有进入存档。\n\n`version` 默认 `0`，不匹配且未提供 `migrations` 会恢复失败；`partialize` 默认原样保存，两个回调都必须同步返回。`migrations` 转换待恢复状态，本例等待 `flush` 确认新版存档写入。'
      }
    }
  ],
  persistCollection: [
    {
      title: {
        en: 'Restore a Map without losing its entries',
        zh: '完整恢复 Map 条目'
      },
      problem: {
        en: 'A cart stored as an observable Map must survive a new collection instance.\n\nPlain JSON serialization turns a Map into an empty object; patching entries into an existing collection can also leave obsolete keys behind.\n\nPass the real ObservableMap to persistCollection and flush before releasing it. The default codec preserves Map entries, and restoration calls replace on the new collection.',
        zh: '购物车使用可观察的 `Map`，重新创建集合后仍需恢复条目。\n\n直接做普通 JSON 序列化会把 `Map` 变成空对象；只向新集合追加条目，也可能留下已经过时的键。\n\n把真实 `ObservableMap` 交给 `persistCollection`，释放前等待 `flush`；默认编解码器保留 `Map` 条目，恢复时调用集合的 `replace`。'
      },
      example: {
        en: "import { ObservableMap } from '@migaia/store-indexed'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persistCollection } from '@migaia/store-persist/indexed'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nconst cart = new ObservableMap<string, number>()\nconst first = persistCollection(cart, { key: 'cart', storage })\nawait first.ready\ncart.set('book', 2)\nawait first.flush()\nfirst.dispose()\ncart.dispose()\nconst restored = new ObservableMap<string, number>([['stale', 99]])\nconst second = persistCollection(restored, { key: 'cart', storage })\nawait second.ready\nconsole.log('restored:', restored.get('book'), restored.has('stale'))\nconst saved = (await defaultJsonCodec.decode(await storage.get('cart'))) as { state: unknown }\nconsole.log('map:', saved.state instanceof Map)\nsecond.dispose()\nrestored.dispose()",
        zh: "import { ObservableMap } from '@migaia/store-indexed'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persistCollection } from '@migaia/store-persist/indexed'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nconst cart = new ObservableMap<string, number>()\nconst first = persistCollection(cart, { key: 'cart', storage })\nawait first.ready\ncart.set('book', 2)\nawait first.flush()\nfirst.dispose()\ncart.dispose()\nconst restored = new ObservableMap<string, number>([['stale', 99]])\nconst second = persistCollection(restored, { key: 'cart', storage })\nawait second.ready\nconsole.log('恢复：', restored.get('book'), restored.has('stale'))\nconst saved = (await defaultJsonCodec.decode(await storage.get('cart'))) as { state: unknown }\nconsole.log('映射：', saved.state instanceof Map)\nsecond.dispose()\nrestored.dispose()"
      },
      result: {
        en: 'The output is `restored: 2 false`, then `map: true`: book returns, stale disappears, and the decoded archive still contains a Map.\n\nThe default codec is defaultJsonCodec, version is 0, and debounceMs is 0. Map restoration replaces the whole state; use an explicit merge when a selected subset needs shape-specific reconciliation.',
        zh: '依次输出 `恢复： 2 false`、`映射： true`：书籍数量恢复，过时键消失，解码后的存档仍包含真正的 `Map`。\n\n`codec` 默认 `defaultJsonCodec`，`version` 和 `debounceMs` 默认 `0`；`Map` 恢复会整体替换，裁剪后需要特殊合并时应显式提供 `merge`。'
      }
    }
  ],
  persistKeyed: [
    {
      title: {
        en: 'Stop saving one key while another keeps working',
        zh: '独立停止某个键的持久化'
      },
      problem: {
        en: 'Two user profiles share a definition family, but leaving one screen should stop saving only that profile.\n\nA family-wide listener couples unrelated keys, and reading handle.value as a live value keeps displaying the snapshot captured before restoration.\n\nCreate one persistKeyed handle per definition and explicit id. Await ready, read current values through AtomStore, and dispose only the handle whose persistence is no longer needed.',
        zh: '两个用户资料来自同一定义族，离开其中一个页面时只需停止保存该用户。\n\n整族共用一个保存订阅会耦合无关的键；把 `handle.value` 当成实时值读取，还会一直看到恢复前捕获的快照。\n\n为每个定义和显式 `id` 创建独立的 `persistKeyed` 句柄；等待 `ready` 后从 `AtomStore` 读取当前值，只释放不再需要保存的那一个句柄。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { createAtomStore, familyDef } from '@migaia/store-keyed'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persistKeyed } from '@migaia/store-persist/keyed'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set(\n  'users:u1',\n  (await defaultJsonCodec.encode({\n    version: 0,\n    state: { name: 'Ada' }\n  })) as string\n)\nconst atoms = createAtomStore(createRuntime())\nconst profile = familyDef(() => ({ name: '' }))\nconst first = persistKeyed(atoms, profile('u1'), 'u1', { namespace: 'users', storage })\nconst second = persistKeyed(atoms, profile('u2'), 'u2', { namespace: 'users', storage })\nawait Promise.all([first.ready, second.ready])\nconsole.log('initial:', first.value.name === '', atoms.peek(profile('u1')).name)\natoms.set(profile('u1'), { name: 'Grace' })\natoms.set(profile('u2'), { name: 'Linus' })\nawait Promise.all([first.flush(), second.flush()])\nfirst.dispose()\natoms.set(profile('u1'), { name: 'Changed' })\natoms.set(profile('u2'), { name: 'Barbara' })\nawait second.flush()\nconst one = (await defaultJsonCodec.decode(await storage.get('users:u1'))) as {\n  state: { name: string }\n}\nconst two = (await defaultJsonCodec.decode(await storage.get('users:u2'))) as {\n  state: { name: string }\n}\nconsole.log('archives:', one.state.name, two.state.name)\nconsole.log('memory:', atoms.peek(profile('u1')).name)\nsecond.dispose()\natoms.dispose()",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { createAtomStore, familyDef } from '@migaia/store-keyed'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defaultJsonCodec } from '@migaia/store-persist'\nimport { persistKeyed } from '@migaia/store-persist/keyed'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set(\n  'users:u1',\n  (await defaultJsonCodec.encode({\n    version: 0,\n    state: { name: 'Ada' }\n  })) as string\n)\nconst atoms = createAtomStore(createRuntime())\nconst profile = familyDef(() => ({ name: '' }))\nconst first = persistKeyed(atoms, profile('u1'), 'u1', { namespace: 'users', storage })\nconst second = persistKeyed(atoms, profile('u2'), 'u2', { namespace: 'users', storage })\nawait Promise.all([first.ready, second.ready])\nconsole.log('初始值：', first.value.name === '', atoms.peek(profile('u1')).name)\natoms.set(profile('u1'), { name: 'Grace' })\natoms.set(profile('u2'), { name: 'Linus' })\nawait Promise.all([first.flush(), second.flush()])\nfirst.dispose()\natoms.set(profile('u1'), { name: 'Changed' })\natoms.set(profile('u2'), { name: 'Barbara' })\nawait second.flush()\nconst one = (await defaultJsonCodec.decode(await storage.get('users:u1'))) as {\n  state: { name: string }\n}\nconst two = (await defaultJsonCodec.decode(await storage.get('users:u2'))) as {\n  state: { name: string }\n}\nconsole.log('两个存档：', one.state.name, two.state.name)\nconsole.log('内存：', atoms.peek(profile('u1')).name)\nsecond.dispose()\natoms.dispose()"
      },
      result: {
        en: 'The output is `initial: true Ada`, `archives: Grace Barbara`, then `memory: Changed`: stopping u1 leaves its last archive intact while u2 still saves.\n\nEach key uses namespace:id; id is not inferred from the definition. value is the attachment-time snapshot. Disposing persistence does not dispose AtomStore or reset business values; version and debounceMs default to 0.',
        zh: '依次输出 `初始值： true Ada`、`两个存档： Grace Barbara`、`内存： Changed`：停止 `u1` 后它的旧存档保留，`u2` 继续保存。\n\n存储键是 `namespace:id`，`id` 不从定义推导；`value` 是接入时快照。释放持久化不会释放 `AtomStore` 或重置业务值，`version` 和 `debounceMs` 默认 `0`。'
      }
    }
  ],
  clearFamily: [
    {
      title: {
        en: 'Clear saved records without resetting live values',
        zh: '清理存档而不重置内存值'
      },
      problem: {
        en: 'A sign-out flow removes one namespace from storage, yet a mounted screen still holds its current value.\n\nDeleting records does not reset live state or remove its subscriptions. Assuming it does can make the next edit silently recreate a supposedly cleared archive.\n\nUse clearFamily to remove matching records, then separately decide whether to reset business values or dispose their persistence handles. This example keeps a handle active to show the next write explicitly.',
        zh: '退出流程清除了某个命名空间的存档，已挂载页面却仍持有当前值。\n\n删除记录不会重置内存或移除订阅；误以为两者一起完成，下一次编辑就会重新创建已经清理的存档。\n\n用 `clearFamily` 移除匹配记录，再分别决定是否重置业务值、释放持久化句柄；本例故意保留句柄，展示后续变更再次写入。'
      },
      example: {
        en: "import { createRuntime } from '@migaia/reactive'\nimport { createAtomStore, familyDef } from '@migaia/store-keyed'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { persistKeyed, clearFamily } from '@migaia/store-persist/keyed'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set('other:u1', 'keep')\nconst atoms = createAtomStore(createRuntime())\nconst counter = familyDef(() => 0)\nconst def = counter('u1')\nconst handle = persistKeyed(atoms, def, 'u1', { namespace: 'users', storage })\nawait handle.ready\natoms.set(def, 7)\nawait handle.flush()\nconsole.log('matched:', await clearFamily(storage, 'users'))\nconsole.log(\n  'after clear:',\n  await storage.get('users:u1'),\n  atoms.peek(def),\n  await storage.get('other:u1')\n)\natoms.set(def, 8)\nawait handle.flush()\nconsole.log('recreated:', (await storage.get('users:u1')) !== null)\nhandle.dispose()\natoms.dispose()",
        zh: "import { createRuntime } from '@migaia/reactive'\nimport { createAtomStore, familyDef } from '@migaia/store-keyed'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { persistKeyed, clearFamily } from '@migaia/store-persist/keyed'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nawait storage.set('other:u1', 'keep')\nconst atoms = createAtomStore(createRuntime())\nconst counter = familyDef(() => 0)\nconst def = counter('u1')\nconst handle = persistKeyed(atoms, def, 'u1', { namespace: 'users', storage })\nawait handle.ready\natoms.set(def, 7)\nawait handle.flush()\nconsole.log('匹配数：', await clearFamily(storage, 'users'))\nconsole.log(\n  '清理后：',\n  await storage.get('users:u1'),\n  atoms.peek(def),\n  await storage.get('other:u1')\n)\natoms.set(def, 8)\nawait handle.flush()\nconsole.log('重新保存：', (await storage.get('users:u1')) !== null)\nhandle.dispose()\natoms.dispose()"
      },
      result: {
        en: 'The output is `matched: 1`, `after clear: null 7 keep`, then `recreated: true`: only users:u1 is removed, memory remains 7, and a later edit saves again.\n\nThe result counts keys matching namespace plus a colon at enumeration time, not successful remove booleans. Removal is sequential, not transactional; earlier removals remain if a later backend call fails.',
        zh: '依次输出 `匹配数： 1`、`清理后： null 7 keep`、`重新保存： true`：只删除 `users:u1`，内存仍是 `7`，后续编辑再次生成存档。\n\n返回值是枚举时以命名空间加冒号匹配的键数，不累计移除操作的布尔结果；移除按顺序执行，不是事务，后续后端调用失败不会撤回已经删除的记录。'
      }
    }
  ]
}
