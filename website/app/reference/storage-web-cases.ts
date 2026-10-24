import type { ICaseDoc, IText } from './contract.js'

/** Keep localized explanations beside the same public browser installation. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Browser cases use actual host ownership, native ports, and current public entries. */
export const storageWebCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  indexedDbBlobFeature: [
    {
      title: t('Commit attachments with records', '随记录提交附件'),
      problem: t(
        'Attachments and records need one native rollback boundary.',
        '附件与记录需要共用原生回滚边界。'
      ),
      example:
        "import { createStorageHost } from '@migaia/storage-host'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbBlobFeature } from '@migaia/storage-web/features/blobs'\n\nconst host = await createStorageHost({\n  plugins: [indexedDbBackendPlugin(\n    { dbName: 'attachments' }, { blobs: indexedDbBlobFeature() }\n  )]\n})\ntry {\n  const store = host.backend('indexed-db')\n  await store.transaction(async (scope) => {\n    await scope.api.blobs.put('avatar', new Blob(['avatar bytes'], { type: 'text/plain' }))\n    await scope.putRecord({ attachment: 'avatar' }, 'profile')\n  })\n  console.log(await (await store.api.blobs.get('avatar'))?.text())\n} finally {\n  await host.dispose()\n}",
      result: t(
        'Prints avatar bytes after one actual commit; a failed transaction leaves both rows absent.',
        '一次真实提交后输出 avatar bytes；失败事务不留下两类行。'
      )
    }
  ],
  localStorageBackendPlugin: [
    {
      title: t('Apply one recoverable text draft', '应用可恢复的文本 draft'),
      problem: t(
        'Several text values need one recoverable WAL intent.',
        '多个文本值需要共用可恢复 WAL intent。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { wal, memoryLogStore } from '@migaia/logger/plugins/durable'
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'
const logger = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  plugins: [wal({ store: memoryLogStore() })]
})
const host = await createStorageHost({
  plugins: [localStorageBackendPlugin({ namespace: 'draft', redo: true })],
  journal: { logger, namespace: 'draft', redoWal: logger.wal }
})
try {
  await host.backend('local').transaction(async (scope) => {
    await scope.set('a', 'first')
    await scope.set('b', 'second')
  })
  console.log(await host.backend('local').get('b'))
} finally { await host.dispose(); await logger.shutdown('manual') }`,
      result: t(
        'Prints second. This memory WAL demonstrates same-owner recovery only while it stays alive. Crash recovery needs a separate persistent carrier such as an original IndexedDB storageLogStore, held by one owner; participating same-origin popups may directly borrow that exact logger/WAL object.',
        '输出 second。示例 memory WAL 仅在对象存活时支持同拥有者恢复；崩溃恢复需独立持久载体，例如由一个拥有者持有的原 IndexedDB storageLogStore，同源 popup 可直接借用该精确 logger/WAL 对象。'
      )
    },
    {
      title: t('Save namespaced browser preferences', '保存有命名空间的浏览器偏好'),
      problem: t(
        'Two parts of an application share localStorage. A namespace keeps their text keys separate while one host owns listeners and cleanup.',
        '应用多个部分共用本地存储；命名空间隔离文本键，宿主统一拥有监听与清理。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'

const host = await createStorageHost({
  plugins: [localStorageBackendPlugin({ namespace: 'editor' })]
})
try {
  const preferences = host.backend('local')
  await preferences.set('theme', 'dark')
  console.log(await preferences.get('theme'))
} finally {
  await host.dispose()
}`,
      result: t(
        'Reads dark from the selected namespace. Host disposal releases resources and leaves persistent browser data intact.',
        '从选定命名空间读到深色主题；宿主释放资源后，浏览器持久化数据仍保留。'
      )
    },
    {
      title: t('Keep organization preferences separate', '隔离组织偏好'),
      problem: t(
        'One configured browser namespace serves a default organization and explicit UUID organizations without sharing their keys.',
        '同一配置命名空间分别服务缺省组织与显式UUID组织，不共享键值。'
      ),
      example:
        "import { createStorageHost, createOrgId } from '@migaia/storage-host'\nimport { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'\nconst host = await createStorageHost({ plugins: [localStorageBackendPlugin({ namespace: 'preferences' })] })\ntry {\n  const org = createOrgId()\n  const settings = host.org(org).backend('local')\n  await host.backend('local').set('theme', 'light')\n  await settings.set('theme', 'dark')\n  console.log(await host.backend('local').get('theme'), await settings.get('theme'))\n  await host.dropOrg(org)\n  console.log(await settings.get('theme'))\n} finally { await host.dispose() }",
      result: t(
        'Prints light dark, then null. The original organization view remains reusable after its target is cleared.',
        '依次输出light dark及null；目标清理后原组织视图仍可复用。'
      )
    },
    {
      title: t('Watch native text invalidations', '观察原生文本失效提示'),
      problem: t(
        'Preferences need committed local and cross-document notifications from an admitted native Window source.',
        '偏好变更需来自已准入 Window 事件源的本实例提交与跨文档提示。'
      ),
      example:
        "import { createStorageHost } from '@migaia/storage-host'\nimport { asChangeFeedStore } from '@migaia/storage-contract'\nimport { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'\nconst host = await createStorageHost({ plugins: [localStorageBackendPlugin({ namespace: 'preferences' })] })\ntry {\n  const preferences = asChangeFeedStore(host.backend('local'))\n  const changes = preferences.watch('theme')\n  try {\n    const changed = changes.next()\n    await preferences.set('theme', 'dark')\n    await changed\n    console.log(await preferences.get('theme'))\n  } finally { await changes.dispose() }\n} finally { await host.dispose() }",
      result: t(
        'Prints dark and closes the original iterator. A Storage-like injection without its native event source rejects feed admission. Hints require rereading current data.',
        '输出 dark 后关闭原迭代器。缺少原生事件源的 Storage-like 注入不能准入变更流；提示需要重新读取当前值。'
      )
    }
  ],
  indexedDbBackendPlugin: [
    {
      title: t('Commit native history with opt-in undo', '提交原生历史并显式选择 undo'),
      problem: t(
        "Use the current org's original native log objects for data, binlog and undo to share the actual native terminal.",
        '使用当前组织的原生日志对象，让业务、binlog 与 undo 共用真实原生终点。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { binlog, undoLog } from '@migaia/logger/plugins/durable'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
let latest!: () => Promise<string>
let shutdown!: () => Promise<void>
const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'journalled-editor' })],
  journal: async ({ storageLogStore }) => {
    const records = await storageLogStore('indexed-db', { prefix: 'commits' })
    const images = await storageLogStore('indexed-db', { prefix: 'undo' })
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [binlog({ store: records }), undoLog({ store: images })]
    })
    latest = async () => ((await logger.binlog.read(1))[0]!.payload as { txId: string }).txId
    shutdown = () => logger.shutdown('manual')
    return { logger, namespace: 'editor', indexedDbUndo: true,
      atomicBinlog: { 'indexed-db': records }, atomicUndo: { 'indexed-db': images } }
  }
})
try {
  const store = host.backend('indexed-db')
  await store.set('draft', 'saved')
  await store.undo(await latest())
  console.log(await store.get('draft'))
} finally { await shutdown(); await host.dispose() }`,
      result: t(
        'Prints null. Native complete publishes both business and log state. Undo is checked before restoration; active commit journaling rejects native Feature handles outside the current image domain, while telemetry-only Features stay available.',
        '输出 null；真实 complete 才发布业务与日志状态。undo 在恢复前完成比对；提交日志拒绝当前镜像域外的原生 Feature 句柄，仅遥测 Feature 保持可用。'
      )
    },
    {
      title: t('Keep private history across business clear', '业务清理后保留私有历史'),
      problem: t(
        'A persistent log needs its own native metadata namespace and a lifetime-exclusive cached index.',
        '持久日志需要原生私有元数据命名空间与整个资源期间独占的缓存索引。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

const host = await createStorageHost({ plugins: [indexedDbBackendPlugin({ dbName: 'history' })] })
try {
  const log = await storageLogStore(host, 'indexed-db', { prefix: 'audit' })
  try {
    await log.append([{ kind: 'saved', payload: { id: 'draft' } }])
    await host.backend('indexed-db').clearAll()
    console.log(await log.lastSeq())
  } finally { await log.dispose() }
} finally { await host.dispose() }`,
      result: t(
        'Prints 1. Native Web Locks protect the resource across participating pages; a conflicting open reports LOCK_REJECTED. Without this persistent exclusion the log combination reports UNSUPPORTED_CAPABILITY before recovery I/O.',
        '输出 1；原生 Web Locks 在参与页面间保护资源，冲突打开报 LOCK_REJECTED。缺少此持久独占能力时，日志组合在恢复 I/O 前报 UNSUPPORTED_CAPABILITY。'
      )
    },
    {
      title: t('Commit text, bytes and records together', '一起提交文本、字节与记录'),
      problem: t(
        'A saved document and its attachment must share one rollback boundary. Use the supplied native transaction scope for every participating write.',
        '文档与附件需要共用回滚边界，所有参与写入均使用所提供的原生事务作用域。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'editor' })]
})
try {
  const store = host.backend('indexed-db')
  await store.transaction(async (scope) => {
    await scope.set('last-document', 'a')
    await scope.setBytes('attachment:a', new Uint8Array([1, 2]))
    await scope.putRecord({ id: 'a', title: 'Draft' }, 'document:a')
  })
  console.log(await store.getRecord('document:a'))
} finally {
  await host.dispose()
}`,
      result: t(
        'The record is readable after the original native transaction completes. An operation failure rolls back participating channels. Timers and network waits do not preserve native activity.',
        '原生事务完成后可读到记录；操作失败会回滚参与的数据通道，定时器和网络等待不保留原生活跃性。'
      )
    },
    {
      title: t('Keep an expiry draft in the native transaction', '在原生事务中提交期限草稿'),
      problem: t(
        'A text entry and its expiry must share one atomic rollback boundary.',
        '文本值与期限需要共用原子的回滚边界。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { ttl } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

const host = await createStorageHost({ plugins: [indexedDbBackendPlugin({dbName:'expiry'})] })
try {
  const store=host.backend('indexed-db')
  await store.transaction(async(scope)=>{
    await scope.set('draft','temporary')
    await scope.use(ttl).expire({channel:'text',key:'draft'},0)
  })
  console.log(await store.get('draft'))
} finally {
  await host.dispose()
}`,
      result: t(
        'Prints null. A zero duration removes the target in the same native transaction; text, bytes and records share the TTL capability.',
        '输出 null。零期限在同一原生事务删除目标，文本、字节和记录均支持 TTL 能力。'
      )
    },
    {
      title: t('Delete one organization database', '删除单个组织数据库'),
      problem: t(
        'Organization deletion must remove its physical IndexedDB target while preserving other organizations and reusable views.',
        '删除组织时需移除其物理 IndexedDB 目标，保留其它组织及可复用视图。'
      ),
      example:
        "import { createStorageHost, createOrgId } from '@migaia/storage-host'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nconst host = await createStorageHost({ plugins: [indexedDbBackendPlugin({ dbName: 'preferences' })] })\ntry {\n  const org = createOrgId()\n  const settings = host.org(org).backend('indexed-db')\n  await host.backend('indexed-db').set('theme', 'light')\n  await settings.set('theme', 'dark')\n  await host.dropOrg(org)\n  console.log(await settings.get('theme'), await host.backend('indexed-db').get('theme'))\n} finally { await host.dispose() }",
      result: t(
        'Prints null light. The deleted organization reopens through the original native layout; the configured default remains intact.',
        '输出 null light；删除的组织通过原生布局重新打开，配置的缺省目标保持不变。'
      )
    }
  ],
  cookieBackendPlugin: [
    {
      title: t('Keep expiry stable during redo', '在 redo 时保持过期时间'),
      problem: t(
        'Cookie recovery must not renew a relative Max-Age.',
        'Cookie 恢复不能重新延长相对 Max-Age。'
      ),
      example: `import type { ICookiesOptions } from '@migaia/storage-web/cookies'
const options: ICookiesOptions = { namespace: 'consent', scope: { path: '/' }, redo: true }
console.log(options.redo)`,
      result: t(
        'Prints true. Installation also requires native Web Locks and journal.redoWal equal to the selected original logger.wal. The original cookie serializer and visibility checks apply; pending intent stores an absolute expiry.',
        '输出 true；安装还要求原生 Web Locks 及 journal.redoWal 等于选定原 logger.wal。继续使用原 Cookie serializer 与可见性检查，pending intent 保存绝对期限。'
      )
    },
    {
      title: t('Reuse one Cookie scope for writes and removal', '写入与删除复用同一 Cookie 作用域'),
      problem: t(
        'Removing a cookie with a different path can leave the original value behind. Choose the scope once when installing its backend.',
        '删除时使用不同路径可能留下原值，在安装后端时一次选定作用域。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'
import { cookieBackendPlugin } from '@migaia/storage-web/cookies'

const host = await createStorageHost({ plugins: [cookieBackendPlugin({
  namespace: 'editor', scope: { path: '/', sameSite: 'lax', secure: true }
})] })
try {
  const cookies = host.backend('cookies')
  await cookies.set('theme', 'dark', { maxAge: 3600 })
  console.log(await cookies.get('theme'))
  await cookies.remove('theme')
} finally {
  await host.dispose()
}`,
      result: t(
        'Both assignments use the same fixed scope. Only JS-visible cookies participate; HttpOnly data and server-side changes remain outside this view.',
        '写入与删除使用同一固定作用域；只处理脚本可见 Cookie，不包含 HttpOnly 数据或服务端变化。'
      )
    }
  ]
}
