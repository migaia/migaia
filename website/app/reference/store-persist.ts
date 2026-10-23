/**
 * Verified against packages/store-persist/src plus README/USEGUIDE on 2026-10-18. All facades
 * retain the complete engine handle and live disposal getter; keyed value alone is an initial
 * snapshot. Initial readiness rejects on cancellation, strict flush observes the actual write
 * drain, and the default codec delegates strict collection values to their canonical owner
 * representation.
 */
import type {
  ILibraryReference,
  IMemberDoc,
  IOptionCaseDoc,
  ISymbolDoc,
  IText
} from './contract.js'
import { storePersistCases } from './store-persist-cases.js'

/** Constructs one bilingual explanation. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents a concrete callable member. */
const method = (
  en: string,
  zh: string,
  params: Readonly<Record<string, IText>>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Backend origin is the canonical storage boundary, not a required concrete adapter. */
const storage = t(
  'Caller-injected storage-contract IKeyValueStore projection: capabilities, get, set, remove and keys. Binary output additionally requires getBytes and setBytes from IRecordStore.',
  '调用方注入的 `@migaia/storage-contract` 键值存储投影，提供能力、读取、写入、移除与键枚举；二进制输出还需记录存储的字节读写方法。'
)
/** The key is always chosen by the application owning the archive. */
const key = t(
  'Archive key selected by the application and reused for reading, writing and removal.',
  '应用为存档指定的键，读取、写入与移除均复用此键。'
)
/** Shared low-level cancellation context. */
const ctx = t(
  'Required context object; signal defaults to undefined. A supplied caller AbortSignal is forwarded to the codec and storage operation.',
  '必填上下文对象；`signal` 默认 `undefined`，提供时转交编解码器与存储操作。'
)
/** Core example injects an ordinary Store through the minimal unit contract. */
const coreExample =
  "import { createStore } from '@migaia/store-light'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { persistUnit } from '@migaia/store-persist'\nconst store = createStore({ count: 0 })\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })\nconst storage = host.backend('memory')\nconst handle = persistUnit({\n  snapshot: () => store.$plain(),\n  restore: state => store.$hydrate(state),\n  subscribe: onChange => store.$subscribe(onChange, { fireImmediately: false })\n}, { key: 'counter', runtime: store.$runtime, storage })\nawait handle.ready\nstore.count = 1\nawait handle.flush()\nhandle.dispose()\nawait store.$dispose()"
/** Light adapter example owns both the subscription and original Store. */
const lightExample = storePersistCases.persist![0]!.example
/** Collection example releases persistence before its source collection. */
const indexedExample = storePersistCases.persistCollection![0]!.example
/** One writable definition gets one archive and one independent handle. */
const keyedExample = storePersistCases.persistKeyed![0]!.example
/** Reader scenarios borrow the application state, storage and timing owners. */
const persistOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  IPersistUnitOptions: [
    {
      title: t('Restore one application archive', '恢复一个应用存档'),
      problem: t(
        'The editor must restore its saved state before showing the form. Select an application archive key and borrow its existing storage; the codec reads and writes the complete archive envelope.',
        '编辑器显示表单前需要恢复保存状态。选择应用存档键并借用现有存储，编解码器负责读写完整存档信封。'
      ),
      example: `import { persistUnit } from '@migaia/store-persist'
import { defaultJsonCodec } from '@migaia/store-persist'

const handle = persistUnit(draftUnit, {
  key: 'editor-draft',
  runtime: draftRuntime,
  storage: applicationStorage,
  codec: defaultJsonCodec
})
await handle.ready
renderDraft(draftUnit.snapshot())
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'The saved state is restored before rendering; closing the editor waits for persistence cleanup.',
        '保存状态在渲染前恢复，编辑器关闭时等待持久化清理。'
      ),
      covers: ['key', 'storage', 'codec', 'runtime']
    },
    {
      title: t('Upgrade saved data without saving session state', '升级保存数据并排除会话状态'),
      problem: t(
        'The application now uses version two, but old archives may still use version one. A synchronous migration upgrades their shape; partialize keeps transient editor fields out of later writes.',
        '应用现在使用第二版结构，旧存档却可能仍是第一版。同步迁移升级它们的形状，partialize 则从后续保存中排除编辑器临时字段。'
      ),
      example:
        "import { persistUnit } from '@migaia/store-persist'\n\nconst handle = persistUnit(draftUnit, {\n  ...draftArchiveOptions,\n  version: 2,\n  migrations: { 2: (saved, { fromVersion }) => upgradeDraft(saved, fromVersion) },\n  partialize: (state) => ({ text: state.text }),\n  merge: (saved, current) => ({ ...current, ...saved })\n})\nawait handle.ready\nrenderDraft(draftUnit.snapshot())\nonEditorClosed(() => handle.disposeAsync())",
      result: t(
        'Old saved content can appear in the current editor; subsequent archives use version two and the selected fields.',
        '旧内容可在当前编辑器中显示，后续存档使用第二版结构与选定字段。'
      ),
      covers: ['version', 'partialize', 'migrations', 'merge']
    },
    {
      title: t('Save during continuous editing', '持续编辑期间也保存'),
      problem: t(
        'Typing keeps restarting a quiet-period save. A maximum wait requests a write even during continuous edits, while the application scheduler owns the timing; storage latency remains separate.',
        '持续输入会不断重启安静间隔保存。最长等待让连续编辑期间也能请求写入，时间由应用调度器管理；存储延迟仍单独存在。'
      ),
      example: `import { persistUnit } from '@migaia/store-persist'

const handle = persistUnit(draftUnit, {
  ...draftArchiveOptions,
  debounceMs: 500,
  maxWaitMs: 2000,
  scheduler: editorScheduler
})
await handle.ready
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'A pause of 500 ms requests a save; continuous editing requests one within two seconds of the first change.',
        '停顿 500 毫秒会请求保存，持续编辑则在首次变化后的两秒内请求一次写入。'
      ),
      covers: ['debounceMs', 'maxWaitMs', 'scheduler']
    }
  ],
  IPersistOptions: [
    {
      title: t('Restore one application archive', '恢复一个应用存档'),
      problem: t(
        'The editor must restore its saved state before showing the form. Select an application archive key and borrow its existing storage; the codec reads and writes the complete archive envelope.',
        '编辑器显示表单前需要恢复保存状态。选择应用存档键并借用现有存储，编解码器负责读写完整存档信封。'
      ),
      example: `import { persist } from '@migaia/store-persist/light'
import { defaultJsonCodec } from '@migaia/store-persist'

const handle = persist(draftStore, {
  key: 'editor-draft',
  storage: applicationStorage,
  codec: defaultJsonCodec
})
await handle.ready
renderDraft(draftStore.$plain())
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'The saved state is restored before rendering; closing the editor waits for persistence cleanup.',
        '保存状态在渲染前恢复，编辑器关闭时等待持久化清理。'
      ),
      covers: ['key', 'storage', 'codec']
    },
    {
      title: t('Upgrade saved data without saving session state', '升级保存数据并排除会话状态'),
      problem: t(
        'The application now uses version two, but old archives may still use version one. A synchronous migration upgrades their shape; partialize keeps transient editor fields out of later writes.',
        '应用现在使用第二版结构，旧存档却可能仍是第一版。同步迁移升级它们的形状，partialize 则从后续保存中排除编辑器临时字段。'
      ),
      example:
        "import { persist } from '@migaia/store-persist/light'\n\nconst handle = persist(draftStore, {\n  ...draftArchiveOptions,\n  version: 2,\n  migrations: { 2: (saved, { fromVersion }) => upgradeDraft(saved, fromVersion) },\n  partialize: (state) => ({ text: state.text })\n})\nawait handle.ready\nrenderDraft(draftStore.$plain())\nonEditorClosed(() => handle.disposeAsync())",
      result: t(
        'Old saved content can appear in the current editor; subsequent archives use version two and the selected fields.',
        '旧内容可在当前编辑器中显示，后续存档使用第二版结构与选定字段。'
      ),
      covers: ['version', 'partialize', 'migrations']
    },
    {
      title: t('Save during continuous editing', '持续编辑期间也保存'),
      problem: t(
        'Typing keeps restarting a quiet-period save. A maximum wait requests a write even during continuous edits, while the application scheduler owns the timing; storage latency remains separate.',
        '持续输入会不断重启安静间隔保存。最长等待让连续编辑期间也能请求写入，时间由应用调度器管理；存储延迟仍单独存在。'
      ),
      example: `import { persist } from '@migaia/store-persist/light'

const handle = persist(draftStore, {
  ...draftArchiveOptions,
  debounceMs: 500,
  maxWaitMs: 2000,
  scheduler: editorScheduler
})
await handle.ready
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'A pause of 500 ms requests a save; continuous editing requests one within two seconds of the first change.',
        '停顿 500 毫秒会请求保存，持续编辑则在首次变化后的两秒内请求一次写入。'
      ),
      covers: ['debounceMs', 'maxWaitMs', 'scheduler']
    }
  ],
  IPersistCollectionOptions: [
    {
      title: t('Restore one application archive', '恢复一个应用存档'),
      problem: t(
        'The editor must restore its saved state before showing the form. Select an application archive key and borrow its existing storage; the codec reads and writes the complete archive envelope.',
        '编辑器显示表单前需要恢复保存状态。选择应用存档键并借用现有存储，编解码器负责读写完整存档信封。'
      ),
      example: `import { persistCollection } from '@migaia/store-persist/indexed'
import { defaultJsonCodec } from '@migaia/store-persist'

const handle = persistCollection(cartRows, {
  key: 'cart',
  storage: applicationStorage,
  codec: defaultJsonCodec
})
await handle.ready
renderCart(cartRows.snapshot())
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'The saved state is restored before rendering; closing the editor waits for persistence cleanup.',
        '保存状态在渲染前恢复，编辑器关闭时等待持久化清理。'
      ),
      covers: ['key', 'storage', 'codec']
    },
    {
      title: t('Upgrade saved data without saving session state', '升级保存数据并排除会话状态'),
      problem: t(
        'The application now uses version two, but old archives may still use version one. A synchronous migration upgrades their shape; partialize keeps transient editor fields out of later writes.',
        '应用现在使用第二版结构，旧存档却可能仍是第一版。同步迁移升级它们的形状，partialize 则从后续保存中排除编辑器临时字段。'
      ),
      example:
        "import { persistCollection } from '@migaia/store-persist/indexed'\n\nconst handle = persistCollection(cartRows, {\n  ...cartArchiveOptions,\n  version: 2,\n  migrations: { 2: (saved, { fromVersion }) => upgradeCartRows(saved, fromVersion) },\n  partialize: (rows) => selectSavedCartRows(rows),\n  merge: (saved, current) => mergeCartRows(saved, current)\n})\nawait handle.ready\nrenderCart(cartRows.snapshot())\nonEditorClosed(() => handle.disposeAsync())",
      result: t(
        'Old saved content can appear in the current editor; subsequent archives use version two and the selected fields.',
        '旧内容可在当前编辑器中显示，后续存档使用第二版结构与选定字段。'
      ),
      covers: ['version', 'partialize', 'migrations', 'merge']
    },
    {
      title: t('Save during continuous editing', '持续编辑期间也保存'),
      problem: t(
        'Typing keeps restarting a quiet-period save. A maximum wait requests a write even during continuous edits, while the application scheduler owns the timing; storage latency remains separate.',
        '持续输入会不断重启安静间隔保存。最长等待让连续编辑期间也能请求写入，时间由应用调度器管理；存储延迟仍单独存在。'
      ),
      example: `import { persistCollection } from '@migaia/store-persist/indexed'

const handle = persistCollection(cartRows, {
  ...cartArchiveOptions,
  debounceMs: 500,
  maxWaitMs: 2000,
  scheduler: editorScheduler
})
await handle.ready
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'A pause of 500 ms requests a save; continuous editing requests one within two seconds of the first change.',
        '停顿 500 毫秒会请求保存，持续编辑则在首次变化后的两秒内请求一次写入。'
      ),
      covers: ['debounceMs', 'maxWaitMs', 'scheduler']
    }
  ],
  IPersistKeyedOptions: [
    {
      title: t('Restore one application archive', '恢复一个应用存档'),
      problem: t(
        'One user draft needs its own archive namespace and id. Borrow the existing storage and codec so this handle owns persistence without owning the application store.',
        '用户草稿需要独立的存档命名空间与标识。借用现有存储及编解码器，让句柄持有持久化过程，不取得应用状态容器的所有权。'
      ),
      example: `import { persistKeyed } from '@migaia/store-persist/keyed'
import { defaultJsonCodec } from '@migaia/store-persist'

const handle = persistKeyed(draftAtoms, draftDefinition, userId, {
  namespace: 'editor-drafts',
  storage: applicationStorage,
  codec: defaultJsonCodec
})
await handle.ready
renderDraft(draftAtoms.peek(draftDefinition))
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'The selected user draft is restored before rendering; closing the editor waits for persistence cleanup.',
        '所选用户草稿在渲染前恢复，编辑器关闭时等待持久化清理。'
      ),
      covers: ['namespace', 'storage', 'codec']
    },
    {
      title: t('Keep session fields out of the archive', '不把会话字段写入存档'),
      problem: t(
        'The editor keeps selection state only for this session. Select only text for writes and merge a matching version-two archive into current state. This adapter has no migration callback, so the saved version must already match.',
        '编辑器只在当前会话保留选择状态。写入时只选择正文，再把版本匹配的第二版存档合入当前状态。此适配器没有迁移回调，保存版本必须事先匹配。'
      ),
      example: `import { persistKeyed } from '@migaia/store-persist/keyed'

const handle = persistKeyed(draftAtoms, draftDefinition, userId, {
  ...draftArchiveOptions,
  version: 2,
  partialize: (state) => ({ text: state.text }),
  merge: (saved, current) => ({ ...current, ...saved })
})
await handle.ready
renderDraft(draftAtoms.peek(draftDefinition))
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'Restored text joins the current session state, while later writes omit session-only fields.',
        '恢复的正文合入当前会话状态，后续写入不包含会话字段。'
      ),
      covers: ['version', 'partialize', 'merge']
    },
    {
      title: t('Save during continuous editing', '持续编辑期间也保存'),
      problem: t(
        'Typing keeps restarting a quiet-period save. A maximum wait requests a write even during continuous edits, while the application scheduler owns the timing; storage latency remains separate.',
        '持续输入会不断重启安静间隔保存。最长等待让连续编辑期间也能请求写入，时间由应用调度器管理；存储延迟仍单独存在。'
      ),
      example: `import { persistKeyed } from '@migaia/store-persist/keyed'

const handle = persistKeyed(draftAtoms, draftDefinition, userId, {
  ...draftArchiveOptions,
  debounceMs: 500,
  maxWaitMs: 2000,
  scheduler: editorScheduler
})
await handle.ready
onEditorClosed(() => handle.disposeAsync())`,
      result: t(
        'A pause of 500 ms requests a save; continuous editing requests one within two seconds of the first change.',
        '停顿 500 毫秒会请求保存，持续编辑则在首次变化后的两秒内请求一次写入。'
      ),
      covers: ['debounceMs', 'maxWaitMs', 'scheduler']
    }
  ]
}

/** Canonical options reused only where the public wrapper exposes them. */
const unitOptions: Readonly<Record<string, IMemberDoc>> = {
  key: { summary: key },
  runtime: {
    summary: t(
      'Owning IRuntime from the source Store, collection or AtomStore; persistence status signals are created in that graph.',
      '来自源存储、集合或原子存储的所属运行时；持久化状态信号在同一依赖图中创建。'
    )
  },
  storage: { summary: storage },
  codec: {
    summary: t(
      'ICodec from storage-contract encoding the complete version/state envelope. Text and binary routes are supported; structured writes reject.',
      '来自存储契约的编解码器，处理完整版本与状态信封；支持文本与二进制路径，结构化写入会拒绝。'
    ),
    default: t(
      'defaultJsonCodec with strict portable values and Map/Set round trips.',
      '默认使用支持严格 portable 值域与 Map/Set 往返的本包 codec。'
    )
  },
  codecStages: {
    summary: t(
      'Optional store-bound observer from host.codecStages(storage). Each actual conversion emits once; observer failures only report and never delay conversion.',
      '可选的 host.codecStages(storage) 接点，绑定真实 store。每次实际转换只观察一次；失败只报告，不等待或改变编解码。'
    ),
    example:
      "const handle = persist(state, { key: 'state', storage, codecStages: host.codecStages(storage) })"
  },
  transactionStages: {
    summary: t(
      'Optional host.transactionStages(storage) observer. Emits before/afterPersistFlush using the actual operation view; after means request completion, and observer failures only report.',
      '可选的 host.transactionStages(storage) 观察接点，绑定实际操作视图。只发出 before/afterPersistFlush；after 表示请求完成，观察失败只报告。'
    ),
    example:
      "const handle = persist(state, { key: 'state', storage, transactionStages: host.transactionStages(storage) })"
  },
  version: {
    summary: t(
      'Application schema version, a safe nonnegative integer compared with each saved envelope version.',
      '应用数据结构版本，必须是安全非负整数，并与每个保存信封的版本比较。'
    ),
    default: t(
      '0; older archives require reachable steps, and future archives are rejected.',
      '默认零；保存版本不同时需要迁移函数。'
    )
  },
  migrations: {
    whenToUse: t(
      'Upgrade reachable older archives with contiguous synchronous steps, or reset them once. Future archives are always rejected.',
      '用连续同步步骤升级可达旧档，或一次重置；未来版本始终被拒绝。'
    ),
    example: persistOptionCases.IPersistUnitOptions![1]!.example,
    summary: t(
      'A target-version step record or { reset: () => state }. Step context contains fromVersion/toVersion; known thenables are rejected.',
      '目标版本步骤表或 { reset: () => state }；步骤上下文含 fromVersion/toVersion，拒绝已知 thenable。'
    ),
    default: t(
      'Omitted: only the configured version is readable; other versions fail with storage-contract VERSION_UNSUPPORTED.',
      '省略时只读取当前配置版本，其他版本报 storage-contract VERSION_UNSUPPORTED。'
    )
  },
  partialize: {
    whenToUse: t(
      'Use it to keep session-only or derived fields out of storage. It selects each write without changing live memory. Omission stores the complete snapshot. The callback must return synchronously.',
      '需要从存档排除会话或派生字段时设置。它为每次写入选择内容，不改变内存。省略时保存完整快照，回调必须同步返回。'
    ),
    example: persistOptionCases.IPersistUnitOptions![1]!.example,
    summary: t(
      'Synchronous callback before each write, receiving the latest unit snapshot and selecting its persisted portion. Throws and thenables become write failures.',
      '每次写入前同步调用，接收最新单元快照并选择需要保存的部分；抛错与可等待结果成为写入失败。'
    ),
    params: {
      state: t(
        'Latest synchronous source snapshot taken when the write executes.',
        '写入执行时取得的最新同步源快照。'
      )
    },
    returns: t(
      'Synchronous complete or partial state placed inside the envelope.',
      '返回放入信封的同步完整或部分状态。'
    ),
    default: t('Identity: persist the complete snapshot.', '默认原样返回，保存完整快照。')
  },
  merge: {
    whenToUse: t(
      'Set it when archived partial state needs shape-specific reconciliation with live state. Return a complete synchronous state. Default plain-object merging preserves edits since attachment; non-object shapes are replaced by the archive.',
      '保存的部分状态需要按形状与内存协调时设置。必须同步返回完整状态。默认普通对象合并保留接入后发生的修改，其它形状使用存档整体替换。'
    ),
    example: persistOptionCases.IPersistUnitOptions![1]!.example,
    summary: t(
      'Synchronous hydration callback receiving persisted partial state and the latest current state; return the complete state to restore. Throws or thenables fail hydration.',
      '同步水合回调接收保存的部分状态与最新当前状态，返回需要恢复的完整状态；抛错或可等待结果使水合失败。'
    ),
    params: {
      persisted: t(
        'Decoded and optionally migrated partial archive state.',
        '解码并按需迁移后的部分存档状态。'
      ),
      current: t(
        'Current source snapshot immediately before restoration.',
        '即将恢复前取得的当前源快照。'
      )
    },
    returns: t('Synchronous complete source state for restore.', '返回用于恢复的同步完整源状态。'),
    default: t(
      'Plain objects retain current fields changed since the original startup snapshot and accept persisted values for unchanged fields. Arrays, Map, Set and other shapes replace completely.',
      '普通对象保留自初始启动快照以来本地已改变的字段，未变字段接受保存值；数组、映射、集合及其他形状整体替换。'
    )
  },
  debounceMs: {
    summary: t(
      'Quiet interval before requesting a serialized write; finite milliseconds in [0, 2147483647]. It does not bound storage latency.',
      '请求串行写入前的安静间隔，必须是 `[0, 2147483647]` 内的有限毫秒数；不限制存储延迟。'
    ),
    default: t(
      '0: enqueue a write without a debounce timer.',
      '默认零，直接请求入队写入，不建立防抖定时器。'
    )
  },
  maxWaitMs: {
    summary: t(
      'Maximum debounce window from the first post-hydration change; finite milliseconds in [0, 2147483647]. Relevant only when debounceMs is positive.',
      '成功恢复后首次变更起的防抖窗口上限，必须是 `[0, 2147483647]` 内的有限毫秒数；仅在 `debounceMs` 为正时使用。'
    ),
    default: t(
      'undefined: only the quiet interval controls enqueueing.',
      '`undefined`：仅由安静间隔决定写入入队。'
    )
  },
  scheduler: {
    summary: t(
      'Caller-selected IScheduler from @migaia/utils/scheduler; its monotonic now and cancellable schedule own the debounce window.',
      '调用方选择的 `@migaia/utils/scheduler` 调度器，其单调时间与可取消调度共同持有防抖窗口。'
    ),
    default: t(
      'Canonical systemScheduler resolved through lifecycle scheduler admission.',
      '默认使用经生命周期调度接纳解析的规范系统调度器。'
    )
  }
}
/** Collection wrappers infer runtime from the owned source. */
const collectionOptions: Readonly<Record<string, IMemberDoc>> = {
  ...Object.fromEntries(Object.entries(unitOptions).filter(([name]) => name !== 'runtime')),
  migrations: {
    ...unitOptions.migrations!,
    example: persistOptionCases.IPersistCollectionOptions![1]!.example
  },
  partialize: {
    ...unitOptions.partialize!,
    example: persistOptionCases.IPersistCollectionOptions![1]!.example
  },
  merge: {
    ...unitOptions.merge!,
    example: persistOptionCases.IPersistCollectionOptions![1]!.example
  }
}
/** Light wrappers expose neither a runtime override nor a custom merge. */
const lightOptions: Readonly<Record<string, IMemberDoc>> = {
  ...Object.fromEntries(Object.entries(collectionOptions).filter(([name]) => name !== 'merge')),
  migrations: {
    ...unitOptions.migrations!,
    example: persistOptionCases.IPersistOptions![1]!.example
  },
  partialize: {
    ...unitOptions.partialize!,
    example: persistOptionCases.IPersistOptions![1]!.example
  }
}
/** Keyed options use namespace instead of an archive key and expose no migration callback. */
const keyedOptions: Readonly<Record<string, IMemberDoc>> = {
  ...Object.fromEntries(
    Object.entries(collectionOptions).filter(([name]) => name !== 'key' && name !== 'migrations')
  ),
  merge: { ...unitOptions.merge!, example: persistOptionCases.IPersistKeyedOptions![1]!.example },
  namespace: {
    summary: t(
      'Required application-selected string prefix; the full key is namespace followed by a colon and the caller id. Missing or nonstring values throw INVALID_OPTION at runtime; clearFamily filters that exact prefix.',
      '应用必须指定的字符串存档前缀；完整键由前缀、冒号与调用方标识组成。缺失或非字符串值在运行时抛 `INVALID_OPTION`，批量清理按此精确前缀过滤。'
    )
  },
  partialize: {
    ...unitOptions.partialize!,
    example: persistOptionCases.IPersistKeyedOptions![1]!.example,
    params: {
      value: t(
        'Latest value peeked from the writable definition in AtomStore.',
        '从原子存储中可写定义读取的最新未追踪值。'
      )
    }
  }
}
/** Shared live engine handle surface retained by every facade. */
const handleMembers: Readonly<Record<string, IMemberDoc>> = {
  status: {
    summary: t(
      'IReactiveComputed selecting disposed first, then loading, then hydration/write error, otherwise ready. A write can be active while overall status remains ready.',
      '计算信号优先选择已释放、加载、读写错误，否则为就绪；写入进行中整体仍可显示就绪。'
    )
  },
  error: {
    summary: t(
      'Computed current hydration or write failure; simultaneous failures form AggregateError preserving both originals.',
      '计算当前水合或写入失败；同时失败时形成聚合错误，保留两个原始原因。'
    )
  },
  hydrated: {
    summary: t(
      'Computed true only after a successful hydration attempt; disposal does not convert an incomplete hydration into success.',
      '仅在水合尝试成功后为真的计算信号；释放不会把未完成水合转换为成功。'
    )
  },
  hydrationStatus: {
    summary: t(
      'Readonly .value projection reporting loading, success or error for the latest hydration attempt.',
      '通过只读值属性报告最近水合尝试的加载、成功或错误状态。'
    )
  },
  hydrationError: {
    summary: t(
      'Readonly .value containing the latest hydration failure; cleared when another hydration attempt starts.',
      '只读值属性保存最近水合失败；新水合尝试开始时清除。'
    )
  },
  writeStatus: {
    summary: t(
      'Readonly .value reporting idle, writing, error or disposed independently of hydration status.',
      '只读值属性独立报告写入空闲、执行、错误或释放状态。'
    )
  },
  writeError: {
    summary: t(
      'Readonly .value retaining the latest failed write or removal; successful writes clear it and a final disposal write may update it later.',
      '只读值属性保留最近写入或移除失败；成功写入会清除，释放后的最终写入仍可再次更新。'
    )
  },
  ready: {
    summary: t(
      'Original first-hydration-attempt Promise: resolves only on success and rejects on failure or disposal before completion with AbortError/ABORTED_BY_DISPOSE. Retries do not replace this Promise.',
      '首次恢复尝试的原始 Promise；仅成功时兑现，恢复失败会拒绝，完成前释放则以 `AbortError`／`ABORTED_BY_DISPOSE` 拒绝。重试不替换此 Promise。'
    )
  },
  settled: {
    summary: t(
      'Barrier derived from the initial ready Promise that resolves after either success or failure; it does not await future retries.',
      '从首次 `ready` 派生的 Promise，成功或失败后均兑现，不等待后续重试。'
    )
  },
  disposed: {
    summary: t(
      'Live terminal-disposal getter on the original IPersistHandle; becomes true once dispose is called.',
      '原始持久化句柄上的实时 `disposed` 属性，调用 `dispose` 后变为 `true`。'
    )
  },
  retryHydrate: method(
    'Retries storage reading after hydration failure. An ongoing recovery prevents another read but does not make every concurrent invocation wait for it; await the invocation that starts recovery. Success reopens automatic writes.',
    '恢复失败后重新读取存档；已有重试在执行时不重复读取，但后来的并发调用不保证等待该次重试，应等待发起恢复的那次调用。恢复成功后重新开放自动写入。',
    {},
    t(
      'Promise of recovery; rejects on another failure or post-disposal invocation. Initial ready and settled remain their original Promises.',
      '返回此次调用的 Promise，再次失败或释放后调用时拒绝；初始 `ready` 与 `settled` 保持原对象。'
    ),
    'try { await handle.ready } catch { await handle.retryHydrate() }'
  ),
  flush: method(
    'Without tx, drains and writes the current snapshot. With an enlisted authentic tx, captures and starts encoding at invocation, then writes through that operation view in call order. Only outer persistTransaction success means commit.',
    '不传 tx 时排空并保存当前快照；传入已登记的真实 tx 时，在调用瞬间读取并启动编码，经此次操作视图按次序写入。只有外层 persistTransaction 成功才表示提交。',
    {
      tx: t(
        "Optional active view from this handle's persistTransaction.",
        '可选的、本句柄所属 persistTransaction 的活动视图。'
      )
    },
    t(
      'Promise of this encoding and request. Direct flush rejects during participation; memory does not roll back with storage.',
      '此次编码与请求的 Promise；参与期间直接 flush 拒绝，内存不随存储回滚。'
    ),
    'await handle.ready\nawait handle.flush()'
  ),
  clear: method(
    'Cancels the debounce window and queues archive removal after earlier writes; it neither resets memory nor unsubscribes the source.',
    '取消防抖窗口，在先前写入后排队移除存档；不重置内存，也不取消源订阅。',
    {},
    t(
      'Promise resolving after removal; hydration/removal failures or disposal reject. A later source change can recreate the archive.',
      '移除完成后 Promise 兑现；恢复、移除失败或释放会拒绝，后续源变更可重新创建存档。'
    ),
    'await handle.ready\nawait handle.clear()'
  ),
  disposeAsync: method(
    'Stops scheduling like dispose, then waits for admitted writes/removals and any final debounce snapshot. It does not wait for borrowed reads or dispose the source, storage or runtime.',
    '先按 dispose 的方式停止调度，再等待已接纳的写入、移除与最终防抖快照完成；不等待借用的读取，也不释放源状态、存储或运行时。',
    {},
    t(
      'Promise resolving after the write chain settles. A synchronous cleanup failure rejects afterwards; final-write failures remain available on writeError.',
      '写入链结算后兑现的 Promise。同步清理失败会在此后拒绝，最终写入失败保留在 writeError 中。'
    ),
    'await handle.disposeAsync()\nconsole.log(handle.disposed)'
  ),
  '[Symbol.asyncDispose]': method(
    'Shares one cleanup with disposeAsync while caching a distinct Promise that reports cleanup failure and resolves.',
    '与 disposeAsync 共享一次清理，缓存独立 Promise；清理失败报告后成功结束。',
    {},
    t(
      'The same reporting Promise on repeated symbol calls.',
      '重复符号调用返回同一个报告 Promise。'
    ),
    'await handle[Symbol.asyncDispose]()'
  ),
  dispose: method(
    'Idempotently stops persistence subscriptions, cancels the debounce timer and aborts active adapter operations. A pending debounce window starts one unawaited final snapshot write. It does not clear business values or dispose the source state.',
    '幂等停止持久化订阅、取消防抖定时器并中止活跃适配器操作；存在待执行防抖窗口时，启动一次不等待的最终快照写入。不清业务值或释放源状态。',
    {},
    t(
      'Nothing; scheduling is terminal. An adapter ignoring abort can still complete, and final-write failure remains in writeError.',
      '无返回值，后续调度终止；忽略中止的适配器仍可能完成，最终写入失败保留在写入错误值中。'
    ),
    'await handle.flush()\nhandle.dispose()\nhandle.dispose()'
  )
}
/** Returned handle lifecycle and operational scenarios. */
const handleType = {
  summary: t(
    'Caller-owned hydration and serialized-write lifecycle from persistUnit or an adapter; it does not dispose the source state or injected backend.',
    '由核心或适配器返回、调用方持有的水合与串行写入生命周期；不释放源状态或注入后端。'
  ),
  scenarios: [
    t(
      'Wait for hydration, recover a failed archive read, or flush changes before releasing source state.',
      '等待水合、恢复存档读取失败，或在释放源状态前写完变更。'
    )
  ],
  example: lightExample,
  members: handleMembers
}
/** Decoder failures and rejected records retain application context. */
const persistErrorOptionCases = (name: string): readonly IOptionCaseDoc[] => [
  {
    title: t('Explain why a saved draft cannot be decoded', '说明保存草稿为何无法解码'),
    problem: t(
      'The editor needs a short restore message, while support needs the decoder failure. Preserve that failure on cause instead of replacing it with a new message.',
      '编辑器需要简短的恢复提示，支持人员仍需要解码器的失败。用 cause 保留它，不要只用新消息替换。'
    ),
    example: `import { ${name}, StorePersistErrorCode } from '@migaia/store-persist'

try {
  await decodeSavedDraft(upload)
} catch (cause) {
  const error = ${name}(
    StorePersistErrorCode.envelopeInvalid, 'Saved draft could not be decoded',
    { cause }
  )
  showDraftError(error.message)
  reportToMonitoring(error)
}`,
    result: t(
      'The editor explains the restore failure; monitoring can follow cause to the original decoder failure.',
      '编辑器显示恢复失败，监控可沿 cause 找到原始解码失败。'
    ),
    covers: ['cause']
  },
  {
    title: t('Keep the rejected draft details', '保留被拒绝的草稿详情'),
    problem: t(
      'An archive validator returns a record identifying a rejected field. Keeping it as cause lets support inspect the key and submitted version while the page shows a short message.',
      '存档校验器用记录指出被拒绝字段。把记录放入 cause，页面可显示简短提示，支持人员仍能查看键与提交版本。'
    ),
    example: `import { ${name}, StorePersistErrorCode } from '@migaia/store-persist'

const rejection = validateSavedDraft(upload)
if (rejection) {
  const error = ${name}(
    StorePersistErrorCode.envelopeInvalid, 'Saved draft rejected',
    { cause: rejection }
  )
  showDraftError(error.message)
  reportToMonitoring(error)
}`,
    result: t(
      'The page displays a draft error and monitoring retains the complete rejected-input record.',
      '页面显示草稿错误，监控中保留完整的拒绝输入记录。'
    ),
    covers: ['cause']
  }
]

/** Error helpers preserve native objects and cause identity. */
const errorFactory = (
  name: string,
  native: string,
  mode: 'cause' | 'options' | 'errors'
): ISymbolDoc => ({
  role: 'operation',
  purpose: t(
    `Creates a native ${native} with stable store-persist source/code identity; original causes remain reachable and the helper returns without throwing.`,
    '创建附有稳定持久化包来源与错误码的原生错误；保留原始原因可达路径，辅助函数只返回而不抛出。'
  ),
  params: {
    code: t(
      'Selected value from StorePersistErrorCode matching the real failure.',
      '从本包错误码表选择、对应实际失败的码值。'
    ),
    message: t(
      'Application-authored concrete failure explanation.',
      '应用编写的具体失败说明文本。'
    ),
    ...(mode === 'cause'
      ? {
          cause: t(
            'Optional original failure attached by identity as cause.',
            '可选原始失败，按身份附加为原因。'
          )
        }
      : mode === 'errors'
        ? {
            errors: t(
              'Original failure objects retained in AggregateError.errors in input order.',
              '按输入顺序保留在聚合错误列表中的原始失败对象。'
            )
          }
        : {})
  },
  ...(mode === 'options'
    ? {
        optionCases: persistErrorOptionCases(name),
        optionDocs: {
          cause: {
            summary: t(
              'Original failure retained on the native error cause property.',
              '保留在原生错误原因属性上的原始失败。'
            ),
            default: t('Omitted: no cause property is supplied.', '省略时不提供原始原因属性。')
          }
        }
      }
    : {}),
  returns: t(
    `The tagged ${native}, preserving native runtime type and stack.`,
    '返回附有身份的原生错误，保留运行时类型与堆栈。'
  ),
  example:
    mode === 'errors'
      ? `const error = ${name}(StorePersistErrorCode.hydrateAndWriteFailed, [readFailure, writeFailure], 'Both operations failed')`
      : `const error = ${name}(StorePersistErrorCode.invalidOption, 'Invalid persistence options')`
})
/** Adapter factory description with independently owned persistence lifecycle. */
const adapter = (
  en: string,
  zh: string,
  params: Readonly<Record<string, IText>>,
  options: string,
  example: string | IText,
  details?: Pick<ISymbolDoc, 'exampleIntro' | 'cases'>
): ISymbolDoc => ({
  role: 'factory',
  purpose: t(en, zh),
  params,
  options,
  returns: t(
    'Complete caller-owned persistence handle. The engine captures recognized configuration once at entry; adapters first snapshot options using their original getter receiver. Inaccessible adapter options throw INVALID_OPTION with cause before construction. Hydration failures reject ready and remain observable through status.',
    '返回调用方持有的完整持久化句柄。引擎在入口捕获一次已知配置，各适配入口先以原选项对象作为 getter 接收者拍下选项；适配选项读取失败在引擎构造前抛带 `cause` 的 `INVALID_OPTION`。恢复失败使 `ready` 拒绝，并通过状态可见。'
  ),
  example,
  ...details
})
/** Full persistence reference. */
export const storePersistReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Generic persistence engine and envelope/codec tools independent of concrete Store packages. Start with persistUnit for a custom synchronous snapshot/restore/subscribe boundary. Runtime dependencies are reactive, storage-contract, utils and lifecycle; concrete state adapters and storage-web are selected separately.',
        '独立于具体状态包的通用持久化引擎与信封、编解码工具；自定义同步快照、恢复、订阅边界从 `persistUnit` 开始。运行时依赖响应式、存储契约、工具及生命周期基础包，具体状态适配与网页存储实现按需选择。'
      ),
      example: coreExample
    },
    light: {
      summary: t(
        'Save and restore a Store-light store without writing snapshot and subscription adapters yourself. Import this subpath for `persist()`; the root entry provides the generic persistence engine for custom state owners.\n\nPass the store, a storage backend and an archive key to `persist()`. It reads `$plain()` snapshots, restores saved fields with `$hydrate()`, and listens through `$subscribe()` so later changes can be saved.',
        '保存并恢复轻量存储的状态，省去手工连接快照与订阅的工作。此子路径提供 `persist()`；根入口则提供适配自定义状态对象的通用持久化引擎。\n\n向 `persist()` 传入存储、保存数据的后端和存档键。它用 `$plain()` 取得快照，用 `$hydrate()` 恢复已保存字段，再通过 `$subscribe()` 监听后续变化并保存。'
      ),
      example: lightExample
    },
    indexed: {
      summary: t(
        'Save an observable object, array, map or set as one collection snapshot. Choose this subpath for `persistCollection()` rather than implementing the generic snapshot interface exported at the root.\n\nPass the collection, storage backend and archive key to `persistCollection()`. It observes changes by reading `snapshot()` inside a reactive effect and restores saved data through `replace()`, which replaces the complete collection state rather than patching individual entries.',
        '把可观察的对象、数组、映射或集合作为一份完整快照保存。此子路径提供 `persistCollection()`，无需自行实现根入口通用引擎所需的快照接口。\n\n向 `persistCollection()` 传入集合、保存后端和存档键。它在响应式副作用中读取 `snapshot()` 来观察变化，恢复时调用 `replace()` 替换整个集合状态，而非逐条修补。'
      ),
      example: indexedExample
    },
    keyed: {
      summary: t(
        'Persist one writable definition from an atom store under a namespace and an application-chosen identifier. Choose this subpath for keyed state; the root persistence engine does not connect atom-store reads and subscriptions for you.\n\nStart with `persistKeyed()` to restore and watch that definition, or `clearFamily()` to remove saved records whose keys share a namespace prefix. Clearing records does not clear live memory values, and this adapter does not enumerate or persist an entire family automatically.',
        '按命名空间和应用指定的标识，为原子存储中的一个可写定义保存状态。处理键控状态时选择此子路径；根入口的通用引擎不会替你连接原子存储的读取和订阅。\n\n从 `persistKeyed()` 恢复并监听这个定义，或用 `clearFamily()` 移除键具有同一命名空间前缀的存档。清理存档不会清空内存中的值，此适配器也不会自动枚举并保存整个定义族。'
      ),
      example: keyedExample
    }
  },
  symbols: {
    persistTransaction: {
      role: 'operation',
      purpose: t(
        'Drains authentic handles attached to the same complete store, then borrows one original transaction. Snapshot, entity, text and byte writes commit together; memory remains caller-owned and ordinary mirroring resumes after settlement.',
        '排空绑定同一完整 store 的真实句柄，再借用一个原始事务。快照、实体、文本和字节共同提交；内存由调用方持有，结算后恢复普通镜像写入。'
      ),
      params: {
        store: t(
          'Original complete record store supporting transactions.',
          '支持事务的原始完整记录 store。'
        ),
        handles: t(
          'Nonempty array of active handles attached to that exact store; duplicates enlist once.',
          '绑定该 store 的活动句柄非空数组；重复项只参与一次。'
        ),
        run: t(
          'Callback retaining the concrete backend scope and Awaited result.',
          '保留具体后端 scope 与 Awaited 结果的回调。'
        ),
        ctx: t(
          'Original backend options. concurrency overrides its default; fail rejects busy handles immediately, while wait alone enters FIFO. One deadline and wait budget continue into backend retries; extension and symbol values remain intact.',
          '原后端选项。concurrency 覆盖缺省策略；fail 立即拒绝忙句柄，只有 wait 进入 FIFO。期限与等待预算延续到后端重试，扩展与 symbol 值保留身份。'
        )
      },
      returns: t(
        'Resolves only after native commit; failure preserves storage errors and does not undo memory. IndexedDB external data must be read before starting.',
        '原生提交后才兑现；失败保留存储错误且不撤销内存。IndexedDB 的外部数据须先读取再开始事务。'
      ),
      example:
        "await persistTransaction(storage, [handle], async (tx) => {\n  state.count = 1\n  await handle.flush(tx)\n  await tx.set('source', 'user', { conflictPolicy: 'replace' })\n})"
    },
    persistUnit: adapter(
      'Connects a caller-provided synchronous state unit to asynchronous hydration and serialized writes. Automatic writes stay gated after hydration failure until successful retry.',
      '将调用方提供的同步状态单元连接到异步水合与串行写入；水合失败后自动写入保持关闭，直到重试成功。',
      {
        unit: t(
          'Application IPersistUnit with synchronous snapshot/restore and change subscription returning an unsubscribe function.',
          '应用提供的单元，含同步快照、恢复，以及返回退订函数的变更订阅。'
        )
      },
      'IPersistUnitOptions',
      coreExample
    ),
    persist: adapter(
      'Attaches Store-light persistence using $plain snapshots, $hydrate restoration and a non-immediate subscription; status signals use the Store runtime.',
      '使用 `createStore` 产生的存储或同形对象，通过普通快照、水合恢复与非立即订阅接入持久化，状态信号使用源存储运行时。',
      {
        store: t(
          'Store-light createStore result or another object implementing IPersistableStore; the caller retains its lifetime.',
          '轻量存储工厂结果或其他实现最小存储边界的对象，由调用方保留其生命周期。'
        )
      },
      'IPersistOptions',
      lightExample,
      {
        exampleIntro: {
          en: "Run these examples with Node 24 and install @migaia/store-light and @migaia/storage-host directly alongside this package. createStore(shape, options?) receives the shown initial fields; omitted options use defaultRuntime, debugName 'Store', warnAsyncActions false and no mutationPolicy. Scalar fields use Object.is for equality.\n\nmemoryBackendPlugin() takes no arguments and creates an isolated in-memory backend; it does not survive process exit. The codec encodes the complete { version, state } envelope; version is a nonnegative safe integer and state must be present and non-null. Decode its string result before inspecting state. Persistence options and callback arguments are listed below; dispose persistence first, then release the Store and backend separately.",
          zh: "在 Node 24 运行示例；除本包外，直接安装 `@migaia/store-light` 和 `@migaia/storage-host`。`createStore(shape, options?)` 接收代码中的初始字段；省略选项时使用 `defaultRuntime`、`debugName: 'Store'`、`warnAsyncActions: false`，不设置 `mutationPolicy`，标量字段按 `Object.is` 判断相等。\n\n`memoryBackendPlugin()` 无参数，每次创建独立的内存后端，进程退出后数据不保留。编解码器处理完整的 `{ version, state }` 存档：版本是安全非负整数，状态必须存在且不为 `null` 或 `undefined`；检查状态前先解码字符串。下表列出持久化选项与回调参数；先停止持久化，再分别释放 Store 和后端。"
        },
        cases: storePersistCases.persist
      }
    ),
    persistCollection: adapter(
      'Persists one observable collection via snapshot and replace, observing its owning Runtime effect while skipping the initial subscription evaluation.',
      '使用 `ObservableObject`、`ObservableArray`、`ObservableMap` 或 `ObservableSet`，通过快照与整体替换持久化状态；用所属运行时副作用观察，跳过订阅初次求值。',
      {
        collection: t(
          'Caller-owned store-indexed collection or structural IPersistableCollection with a tracked snapshot method.',
          '调用方持有的索引集合，或具有可追踪快照方法的结构化集合边界。'
        )
      },
      'IPersistCollectionOptions',
      indexedExample,
      {
        exampleIntro: {
          en: "Install @migaia/store-indexed and @migaia/storage-host directly for this Node 24 example. new ObservableMap(entries = [], runtime = defaultRuntime, options = {}) accepts iterable key/value pairs. Omitted options leave mutationGuard undefined and use debugName 'ObservableMap'; the collection borrows its Runtime.\n\nmemoryBackendPlugin() takes no arguments and creates isolated memory storage. The first handle writes an envelope with version 0 and the Map snapshot; the second restores it into a collection initially containing stale. No custom codec or merge is supplied. Persistence owns only its subscription and status; release both collections and the backend separately.",
          zh: "此 Node 24 示例需直接安装 `@migaia/store-indexed` 与 `@migaia/storage-host`。`new ObservableMap(entries = [], runtime = defaultRuntime, options = {})` 接收键值对可迭代对象；省略选项时 `mutationGuard` 为 `undefined`，`debugName` 为 `'ObservableMap'`，集合借用运行时。\n\n`memoryBackendPlugin()` 无参数，创建独立内存后端。首个句柄保存版本 `0` 和 `Map` 快照，第二个句柄将其恢复到原本含 `stale` 的集合；未提供自定义编解码器或合并函数。持久化只持有订阅与状态，两个集合和后端仍需分别释放。"
        },
        cases: storePersistCases.persistCollection
      }
    ),
    persistKeyed: adapter(
      'Persists one writable AtomStore definition under namespace:id, creating an independent engine per invocation. Returned value is captured before hydration; read live state through AtomStore.',
      '使用 `createAtomStore` 持有 `familyDef` 创建的可写定义，按命名空间与标识持久化单值；每次调用创建独立引擎，返回值在水合前采样。',
      {
        atomStore: t(
          'Caller-owned IAtomStore from @migaia/store-keyed, supplying the state runtime and subscription.',
          '调用方持有、提供运行时与订阅的 `@migaia/store-keyed` 原子存储。'
        ),
        def: t(
          'IWritableAtomDefinition returned by atomDef or a familyDef invocation, selecting exactly one value.',
          '原子定义工厂或族定义调用返回的可写定义，精确选择单个值。'
        ),
        id: t(
          'Application-selected stable identifier appended after namespace and a colon; it is not inferred from the definition.',
          '应用指定的稳定标识，追加在命名空间与冒号之后，不从定义自动推导。'
        )
      },
      'IPersistKeyedOptions',
      keyedExample,
      {
        exampleIntro: {
          en: "Install @migaia/reactive, @migaia/store-keyed and @migaia/storage-host directly. createAtomStore(runtime) requires a real Runtime; createRuntime() uses the host adapter and its default microtask scheduler. familyDef(initial, options = {}) calls initial(key) for new definitions; options default to maxSize 4096 and debugLabel 'family'.\n\nThe shown initial callback creates a name record; the namespace and explicit id select namespace:id in storage, independently of the definition cache. memoryBackendPlugin() has no arguments and owns isolated memory storage. version and debounceMs default to 0; migrations is not an option on this adapter. value is an initial snapshot; use atoms.peek(def) for the current value. Dispose every persistence handle before AtomStore and storage.",
          zh: "直接安装 `@migaia/reactive`、`@migaia/store-keyed` 和 `@migaia/storage-host`。`createAtomStore(runtime)` 必须接收真实运行时，`createRuntime()` 使用宿主适配器及其默认微任务调度；`familyDef(initial, options = {})` 为新定义调用 `initial(key)`，选项默认 `maxSize: 4096`、`debugLabel: 'family'`。\n\n本例初始回调返回含 `name` 的记录；命名空间与显式标识决定 `namespace:id` 存储键，不从定义缓存推导。`memoryBackendPlugin()` 无参数并持有独立内存数据；`version`、`debounceMs` 默认 `0`，此适配器不提供 `migrations` 选项。`value` 是初始快照，当前值用 `atoms.peek(def)` 读取；先逐个释放持久化句柄，再释放原子存储和后端。"
        },
        cases: storePersistCases.persistKeyed
      }
    ),
    clearFamily: {
      role: 'operation',
      purpose: t(
        'Enumerates backend keys and removes those starting with namespace plus a colon, sequentially. It does not inventory live definitions or alter their in-memory state.',
        '枚举后端键并逐个移除以命名空间加冒号开头的记录；不盘点活跃定义，也不改变其内存状态。'
      ),
      params: {
        storage,
        namespace: t(
          'Exact application-selected namespace used by persistKeyed; matching includes its trailing colon separator.',
          '应用为键控持久化指定的精确命名空间，匹配包含尾部冒号分隔符。'
        )
      },
      returns: t(
        'Number of matched records after all removals succeed; backend failure rejects and earlier removals remain applied.',
        '全部移除成功后返回匹配记录数；后端失败会拒绝，先前已移除记录保持生效。'
      ),
      exampleIntro: {
        en: "Install @migaia/reactive, @migaia/store-keyed and @migaia/storage-host directly. createAtomStore requires the Runtime created here; createRuntime() keeps the host's default microtask scheduling. familyDef(initial, options = {}) uses the shown initial value 0, default maxSize 4096 and debugLabel 'family'.\n\nThe example first writes through a real persistKeyed handle with required namespace 'users' and id 'u1'; version and debounceMs are both omitted and default to 0. memoryBackendPlugin() takes no arguments. clearFamily receives that same backend and the exact namespace, without a colon; it adds the colon when matching keys. It neither stops persistence nor disposes the borrowed AtomStore or backend.",
        zh: "直接安装 `@migaia/reactive`、`@migaia/store-keyed` 和 `@migaia/storage-host`。`createAtomStore` 使用本例创建的运行时，`createRuntime()` 保留宿主默认的微任务调度；`familyDef(initial, options = {})` 的初始回调返回 `0`，选项默认 `maxSize: 4096`、`debugLabel: 'family'`。\n\n本例先用真实 `persistKeyed` 句柄写入，必填命名空间为 `'users'`，标识为 `'u1'`；未提供的 `version` 与 `debounceMs` 均默认 `0`。`memoryBackendPlugin()` 无参数；`clearFamily` 接收同一后端与不含尾部冒号的命名空间，匹配时自行追加冒号。它不停止持久化，也不释放借用的原子存储与后端。"
      },
      cases: storePersistCases.clearFamily,
      example: storePersistCases.clearFamily![0]!.example
    },

    defaultJsonCodec: {
      role: 'constant',
      purpose: t(
        'Frozen text codec collections-json@1, composing fromValueCodec with defineCollectionsJsonCodec. Nested Map/Set round-trip by default with $rpc records. Non-finite numbers, undefined roots, sparse arrays, cycles and Date fail; class instances project enumerable fields. Historical markers and tuples remain ordinary data. Errors preserve contract and serialize causes.',
        '名称为 collections-json@1 的冻结 text codec，组合 fromValueCodec 与 defineCollectionsJsonCodec，默认通过 $rpc 记录往返嵌套 Map/Set。非有限数、undefined 根值、稀疏数组、循环与 Date 被拒绝；类实例投影可枚举字段。历史标记和元组为普通数据；错误保留 contract 与 serialize 原因链。'
      ),
      example:
        "const raw = await defaultJsonCodec.encode({ version: 0, state: new Set(['a']) })\nconst value = await defaultJsonCodec.decode(raw)"
    },
    writeEnvelope: {
      role: 'operation',
      purpose: t(
        'Encodes the value and routes its output. structured writes reject. With binary output and capabilities.binary true, byte methods and Uint8Array output are required; otherwise writes use text and require a string. No automatic base64 conversion occurs.',
        '编码传入值后选择路径；`structured` 写入会拒绝。`binary` 且 `capabilities.binary` 为 `true` 时要求字节方法和 `Uint8Array` 输出，否则走文本路径并要求字符串，不会自动转成 base64。'
      ),
      params: {
        storage,
        key,
        codec: t(
          'Caller-selected storage-contract ICodec used to encode this exact value.',
          '调用方选择、用于编码此精确值的存储契约编解码器。'
        ),
        value: t(
          'Application envelope or other value; this helper does not assert envelope shape.',
          '应用信封或其他值；本函数不校验信封形状。'
        ),
        ctx
      },
      returns: t(
        'Promise resolving after the selected backend write; codec, capability and backend failures reject.',
        '所选后端写入完成后 Promise 兑现；编解码、能力或后端失败会拒绝。'
      ),
      example:
        "await writeEnvelope(storage, 'counter', defaultJsonCodec, { version: 0, state: { count: 1 } }, {})"
    },
    readEnvelope: {
      role: 'operation',
      purpose: t(
        'Reads the selected text or byte route and decodes it, returning absence for a missing record. It does not assert envelope shape or perform schema migration.',
        '读取所选文本或字节路径并解码，记录不存在时返回缺失；不校验信封形状，也不执行数据迁移。'
      ),
      params: {
        storage,
        key,
        codec: t(
          'The same storage-contract ICodec chosen for the archive representation.',
          '为存档表示选择的同一存储契约编解码器。'
        ),
        ctx
      },
      returns: t(
        'undefined when the selected backend returns null for a missing record; otherwise the codec result is forwarded, including undefined if the codec returns it. Unsupported binary reads and backend/codec failures reject.',
        '所选后端用 `null` 表示缺失时返回 `undefined`；非缺失记录透传编解码器结果，编解码器也可能返回 `undefined`。不受支持的二进制读取及后端、编解码失败会拒绝。'
      ),
      example:
        "import { assertVersionedEnvelope } from '@migaia/storage-contract'\nconst raw = await readEnvelope(storage, 'counter', defaultJsonCodec, {})\nif (raw !== undefined) assertVersionedEnvelope(raw)"
    },
    removeEnvelope: {
      role: 'operation',
      purpose: t(
        'Removes exactly one archive through the codec-selected backend channel without decoding its value or changing source memory. A binary codec with a binary-capable backend uses removeBytes; all other calls retain text removal, including existing three-argument calls.',
        '根据编解码器选择的后端通道移除单个存档，不解码当前值，也不修改源内存。二进制编解码器遇到支持二进制的后端时使用 `removeBytes`；其他调用沿用文本移除，已有三个参数的调用保持有效。'
      ),
      params: {
        storage: t(
          'Caller-injected storage-contract projection. Text removal uses remove; a binary codec with binary capability additionally requires removeBytes from IRecordStore.',
          '调用方注入的存储契约投影。文本移除使用 `remove`；二进制编解码器遇到声明 binary 能力的后端时，另需 `IRecordStore` 的 `removeBytes`。'
        ),
        key,
        ctx: t(
          'Required context object; its optional caller-owned signal is forwarded to the selected backend removal.',
          '必需的上下文对象；其中可选的调用方所有 signal 会传递给所选后端的移除操作。'
        ),
        codec: t(
          'Optional fourth argument, defaulting to defaultJsonCodec. Pass the same storage-contract ICodec selected for writeEnvelope and readEnvelope to remove a binary archive from its byte channel.',
          '可选的第四个参数，默认 `defaultJsonCodec`。传入为 `writeEnvelope` 与 `readEnvelope` 选择的同一存储契约 `ICodec`，可从字节通道移除二进制存档。'
        )
      },
      returns: t(
        'Promise resolving after the selected backend removal. When a binary codec is selected, a binary-capable backend missing removeBytes rejects with a BACKEND_CAPABILITY TypeError; backend failures reject unchanged.',
        '所选后端完成移除后承诺完成。选择二进制编解码器时，支持二进制的后端缺少 `removeBytes` 会以 `BACKEND_CAPABILITY` 类型错误拒绝；后端失败原样拒绝。'
      ),
      example:
        "await removeEnvelope(storage, 'counter', {})\nawait removeEnvelope(storage, 'binary-counter', {}, codec)"
    },
    createStorePersistError: errorFactory('createStorePersistError', 'Error', 'options'),
    createStorePersistTypeError: errorFactory(
      'createStorePersistTypeError',
      'TypeError',
      'options'
    ),
    createStorePersistAbortError: errorFactory(
      'createStorePersistAbortError',
      'DOMException named AbortError',
      'cause'
    ),
    createStorePersistAggregateError: errorFactory(
      'createStorePersistAggregateError',
      'AggregateError',
      'errors'
    ),

    STORE_PERSIST_SOURCE: {
      role: 'constant',
      purpose: t(
        'Stable @migaia/store-persist source attached to package-owned boundary errors; inspect it together with the stable code.',
        '附加到包拥有边界错误上的稳定来源标记，读取时同时检查稳定错误码。'
      ),
      example: 'console.log(STORE_PERSIST_SOURCE)'
    },
    StorePersistErrorCode: {
      role: 'constant',
      purpose: t(
        'Stable persistence failure codes covering configuration, envelope, codec, backend and disposal cancellation failures.',
        '稳定持久化失败码，覆盖配置、信封、编解码器、后端与释放取消失败。'
      ),
      example: 'console.log(StorePersistErrorCode.envelopeInvalid)'
    },
    PersistState: {
      role: 'constant',
      purpose: t(
        'Shared lifecycle vocabulary used by overall, hydration and write status projections; each projection permits only its documented subset.',
        '整体、水合与写入状态投影共用的生命周期词表；各投影仅允许自身声明的子集。'
      ),
      example:
        'if (handle.hydrationStatus.value === PersistState.success) console.log(handle.hydrated.value)'
    },
    PersistCodecOutput: {
      role: 'constant',
      purpose: t(
        'Codec output representation vocabulary used for backend routing; the current persistence projection supports text and binary writes.',
        '用于后端路径选择的编解码输出表示词表；当前持久化投影支持文本与二进制写入。'
      ),
      example: 'console.log(defaultJsonCodec.output === PersistCodecOutput.text)'
    }
  },
  types: {
    ITransactionScopeOf: {
      summary: t(
        'Extracts the original transaction callback scope, preserving concrete backend extensions such as sql.',
        '提取原事务回调 scope，保留 sql 等具体后端扩展。'
      ),
      example: 'type IScope = ITransactionScopeOf<typeof storage>',
      members: {}
    },
    IPersistUnitOptions: {
      optionCases: persistOptionCases.IPersistUnitOptions!,
      summary: t(
        'Complete generic engine configuration, including caller-owned runtime, backend and synchronous state transformation callbacks.',
        '通用引擎完整配置，包含调用方运行时、后端及同步状态转换回调。'
      ),
      members: unitOptions
    },
    IPersistOptions: {
      optionCases: persistOptionCases.IPersistOptions!,
      summary: t(
        'Light adapter options; source runtime is inferred and restoration uses the Store hydration behavior.',
        '轻量适配选项，从源存储取得运行时，恢复使用原存储水合行为。'
      ),
      members: lightOptions
    },
    IPersistCollectionOptions: {
      optionCases: persistOptionCases.IPersistCollectionOptions!,
      summary: t(
        'Collection adapter options; source runtime is inferred and custom shape reconciliation can use merge.',
        '集合适配选项，从源集合取得运行时，可用合并回调定义形状协调。'
      ),
      members: collectionOptions
    },
    IPersistKeyedOptions: {
      optionCases: persistOptionCases.IPersistKeyedOptions!,
      summary: t(
        'One writable definition archive configuration; namespace and explicit id determine the storage key.',
        '单个可写定义存档配置；命名空间与显式标识共同决定存储键。'
      ),
      members: keyedOptions
    },
    IPersistHandle: handleType,
    IPersistKeyedHandle: {
      ...handleType,
      summary: t(
        'The actual complete engine handle extended with value captured before initial hydration. Live status and disposed getters retain their original owner; read live business values through AtomStore.',
        '在完整引擎句柄上增加首次恢复前捕获的值，保留实时状态与 `disposed` 属性；业务当前值从原子存储读取。'
      ),
      example: keyedExample,
      members: {
        ...handleMembers,
        value: {
          summary: t(
            'Initial atomStore.get(def) result captured before persistence construction; not a live getter and not refreshed by hydration.',
            '持久化构造前读取的原子存储初始值；不是实时读取器，水合不会刷新它。'
          )
        }
      }
    },
    IPersistUnit: {
      summary: t(
        'Application-owned minimal synchronous snapshot/restore and change-subscription boundary consumed by persistUnit.',
        '由应用持有、供核心工厂使用的最小同步快照、恢复与变更订阅边界。'
      ),
      members: {
        snapshot: method(
          'Synchronously supplies the current persistable state; the engine calls it at construction, hydration and write execution.',
          '同步提供当前可保存状态，引擎在构造、水合与写入执行时调用。',
          {},
          t(
            'Application state snapshot; a thrown error aborts the current construction or operation.',
            '返回应用状态快照；抛错中止当前构造或操作。'
          ),
          'const state = unit.snapshot()'
        ),
        restore: method(
          'Synchronously restores reconciled state during hydration. The engine suppresses subscription-triggered writes while restoration runs.',
          '水合期间同步恢复协调后的状态；恢复执行时引擎抑制订阅触发的写入。',
          {
            state: t(
              'Complete reconciled state selected by migration and merge.',
              '经迁移与合并选定的完整协调状态。'
            )
          },
          t(
            'Nothing; state is restored, or a thrown error fails hydration.',
            '无返回值；状态已恢复，抛错则水合失败。'
          ),
          'unit.restore(unit.snapshot())'
        ),
        subscribe: method(
          'Registers the engine onChange callback for source changes. Invoke it synchronously without payload; its return is ignored. Registration failure aborts construction.',
          '为源变更登记引擎回调，同步无参数调用且忽略返回值；登记失败会中止构造。',
          {
            onChange: t(
              'Engine-owned no-argument callback scheduling a write; do not await it.',
              '引擎提供的无参数写入调度回调，不应等待其结果。'
            )
          },
          t(
            'IDisposer function detaching the subscription; called once by handle disposal.',
            '返回用于断开订阅的退订函数，句柄释放时调用一次。'
          ),
          'const unsubscribe = unit.subscribe(() => console.log(unit.snapshot()))\nunsubscribe()'
        )
      }
    },
    IPersistableCollection: {
      summary: t(
        'Structural collection contract: tracked snapshots, synchronous whole-state replacement and an owning Runtime.',
        '结构化集合边界，提供可追踪快照、同步整体替换与所属运行时。'
      ),
      members: {
        runtime: unitOptions.runtime!,
        snapshot: method(
          'Reads a synchronous snapshot that tracks collection revisions when called inside its Runtime effect.',
          '读取同步快照，在所属运行时副作用内调用时追踪集合修订。',
          {},
          t(
            'Current complete collection state using the collection snapshot semantics.',
            '返回遵循源集合快照语义的当前完整状态。'
          ),
          'const state = collection.snapshot()'
        ),
        replace: method(
          'Synchronously replaces complete collection state during persistence restoration; source collection validation remains authoritative.',
          '持久化恢复期间同步替换完整集合状态，校验仍由源集合负责。',
          {
            state: t(
              'Reconciled complete state selected by persistence hydration.',
              '持久化水合选定的协调后完整状态。'
            )
          },
          t(
            'Nothing; collection state has been replaced or its validation error propagates.',
            '无返回值；集合已替换，或原集合校验错误传播。'
          ),
          'collection.replace(collection.snapshot())'
        )
      }
    },
    IPersistableStore: {
      summary: t(
        'Structural Store contract owned by the adapter; store-light createStore results satisfy it without an additional wrapper.',
        '适配器拥有的结构化存储边界；轻量存储工厂结果无需额外包装即可满足。'
      ),
      members: {
        $runtime: unitOptions.runtime!,
        $plain: method(
          'Reads the current plain persistable Store record synchronously.',
          '同步读取当前可持久化的普通存储记录。',
          {},
          t(
            'Plain application record consumed as a persistence snapshot.',
            '返回作为持久化快照使用的普通应用记录。'
          ),
          'console.log(store.$plain())'
        ),
        $subscribe: method(
          'Registers a no-argument Store-change callback; persistence requests fireImmediately false to avoid an initial write.',
          '登记无参数存储变更回调；持久化显式关闭立即回调，避免初次写入。',
          {
            fn: t(
              'Synchronous notification callback returning void; source Store owns its failure policy.',
              '返回空值的同步通知回调，失败策略由源存储负责。'
            ),
            options: t(
              'Optional fireImmediately policy from the source Store; the adapter always supplies false.',
              '源存储的可选立即触发策略；适配器始终提供假值。'
            )
          },
          t('IDisposer removing this source subscription.', '返回移除此源订阅的退订函数。'),
          'const unsubscribe = store.$subscribe(() => console.log(store.$plain()), { fireImmediately: false })\nunsubscribe()'
        ),
        $hydrate: method(
          'Synchronously applies archive fields through the Store hydration path; the adapter supplies no unknown-field override.',
          '通过源存储水合路径同步应用存档字段；适配器不覆盖未知字段策略。',
          {
            partial: t(
              'Reconciled plain archive fields to apply to the Store.',
              '要应用到源存储的协调后普通存档字段。'
            ),
            options: t(
              'Optional source policy: unknown ignore/report/strict and synchronous onUnknown(key) returning void; throws follow the Store policy.',
              '源可选策略：未知字段可忽略、报告或严格拒绝，未知键回调同步接收键并返回空值；抛错按源存储策略处理。'
            )
          },
          t(
            'Nothing; fields are restored or the Store validation failure propagates.',
            '无返回值；字段已恢复，或源存储校验失败传播。'
          ),
          "store.$hydrate({ theme: 'dark' })"
        )
      }
    },
    IReadonlyPersistValue: {
      summary: t(
        'Minimal readonly value projection for hydration/write status and failure values; it declares no subscription or mutation methods.',
        '水合、写入状态与失败值的最小只读投影，不声明订阅或写入方法。'
      ),
      members: {
        value: {
          summary: t(
            'Current projected value; read it without mutating the underlying persistence signal.',
            '当前投影值，读取时不修改底层持久化信号。'
          )
        }
      }
    },

    ...Object.fromEntries(
      [
        [
          'IHydrationStatus',
          'loading, success or error for hydration attempts.',
          '水合尝试的加载、成功或错误状态。'
        ],
        [
          'IWriteStatus',
          'idle, writing, error or disposed for archive mutations.',
          '存档变更的空闲、写入、错误或释放状态。'
        ],
        [
          'IPersistStatus',
          'loading, ready, error or disposed for aggregate lifecycle.',
          '汇总生命周期的加载、就绪、错误或释放状态。'
        ],
        [
          'IPersistState',
          'All values of the PersistState lifecycle vocabulary.',
          '持久化状态词表的全部值联合。'
        ],
        [
          'IStorePersistErrorCode',
          'All stable StorePersistErrorCode values for typed error handling.',
          '用于类型化错误处理的本包稳定错误码值联合。'
        ]
      ].map(([name, en, zh]) => [name!, { summary: t(en!, zh!), members: {} }])
    )
  },
  enums: {
    PersistState: {
      summary: t(
        'Lifecycle terms used by distinct aggregate, hydration and write projections.',
        '不同汇总、水合与写入投影使用的生命周期术语。'
      ),
      values: {
        idle: t(
          'Write lane has no currently executing mutation.',
          '写入路径当前没有正在执行的变更。'
        ),
        loading: t(
          'A hydration attempt is reading or restoring the archive.',
          '水合尝试正在读取或恢复存档。'
        ),
        writing: t(
          'A serialized archive write or removal is executing.',
          '串行存档写入或移除正在执行。'
        ),
        ready: t(
          'Aggregate state is hydrated without a current read/write failure.',
          '汇总状态已水合且当前没有读写失败。'
        ),
        success: t(
          'The latest hydration attempt completed successfully.',
          '最近一次水合尝试已经成功完成。'
        ),
        error: t(
          'The corresponding hydration or write lane retains a failure.',
          '对应的水合或写入路径保留失败。'
        ),
        disposed: t(
          'The persistence lifecycle is terminal and stops new scheduling.',
          '持久化生命周期已终止，停止接受新调度。'
        )
      }
    },
    PersistCodecOutput: {
      summary: t(
        'Codec representation tags interpreted by envelope backend routing.',
        '信封后端路径选择解释的编解码表示标签。'
      ),
      values: {
        text: t(
          'Encode a string written through key/value text storage.',
          '编码为字符串，通过文本键值存储写入。'
        ),
        structured: t(
          'Structured record representation; persistence writes reject it because the minimal backend projection has no record channel.',
          '结构化记录表示；最小后端投影没有记录通道，持久化写入拒绝此值。'
        ),
        binary: t(
          'Encode Uint8Array and use byte storage when backend binary capability is available.',
          '编码为字节数组，后端支持二进制能力时使用字节存储。'
        )
      }
    },
    StorePersistErrorCode: {
      summary: t(
        'Stable persistence configuration, data, codec and lifecycle failure identities.',
        '稳定的持久化配置、数据、编解码与生命周期失败身份。'
      ),
      values: {
        codecNotResolved: t(
          'A supplied codec resolves to no usable codec; supply a valid ICodec.',
          '传入值未解析为可用编解码器，应提供有效契约实现。'
        ),
        codecOutputMismatch: t(
          'Representation conflicts with routing, including structured writes or a nonstring text result.',
          '输出表示与路径冲突，包括结构化写入或非字符串文本结果。'
        ),
        backendCapability: t(
          'Binary route is selected but required byte methods are unavailable.',
          '已选择二进制路径，但必需字节方法不可用。'
        ),
        envelopeInvalid: t(
          'Decoded archive shape or unmigrated version is invalid.',
          '解码存档形状非法，或版本不同且未提供迁移。'
        ),
        encodeFailed: t(
          'Default JSON encoding failed; the original failure remains as cause.',
          '默认文本编码失败，原始失败仍保留为原因。'
        ),
        hydrateAndWriteFailed: t(
          'Hydration and write failures coexist in a preserving AggregateError.',
          '水合与写入失败并存于保留原始原因的聚合错误。'
        ),
        abortedByDispose: t(
          'Disposal cancels a persistence operation with native AbortError identity.',
          '释放以原生中止错误身份取消持久化操作。'
        ),
        invalidOption: t(
          'Invalid key, version, callback, timer, backend or codec configuration.',
          '存档键、版本、回调、计时、后端或编解码配置非法。'
        )
      }
    }
  },
  enhancers: {}
}
