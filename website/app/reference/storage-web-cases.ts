import type { ICaseDoc, IText } from './contract.js'

/** Keep localized explanations beside the same public browser installation. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Browser cases use actual host ownership, native ports, and current public entries. */
export const storageWebCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  localStorageBackendPlugin: [
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
    }
  ],
  indexedDbBackendPlugin: [
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
    }
  ],
  cookieBackendPlugin: [
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
