import type { ICaseDoc, IText } from './contract.js'
/** Keep the two languages attached to one runnable public-entry scenario. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Application extensions retain their exact inputs while the host owns installation and cleanup. */
export const storageHostCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  repositoryMigrationKey: [
    {
      title: t('Share one persisted entity layout', '共享同一持久化实体布局'),
      problem: t(
        'A backend raw-record firewall must invalidate the same metadata record as its repository.',
        '后端raw-record firewall必须使repository使用的同一个metadata记录失效。'
      ),
      example: `import { repositoryMigrationKey } from '@migaia/storage-host/entity'

console.log(repositoryMigrationKey('users'))`,
      result: t(
        'Prints repository:users:migration. The package move changes no persisted key.',
        '输出repository:users:migration。包迁移不改变持久化key。'
      )
    }
  ],
  jsonCodec: [
    {
      title: t('Encode a portable record', '编码portable记录'),
      problem: t(
        'A text backend needs explicit rejection of values JSON would silently change.',
        '文本后端需要明确拒绝JSON会静默修改的值。'
      ),
      example: `import { jsonCodec } from '@migaia/storage-host/entity'

const encoded = await jsonCodec.encode({ active: true })
console.log(await jsonCodec.decode(encoded))`,
      result: t(
        'The record round-trips. Undefined and nonfinite numbers reject with SERIALIZE_FAILED before storage writes.',
        '记录往返保持值；undefined和非有限数字在写入前拒绝并携带SERIALIZE_FAILED。'
      )
    }
  ],
  createStorageHost: [
    {
      title: t(
        'Install an application extension with owned cleanup',
        '安装由宿主负责清理的业务扩展'
      ),
      problem: t(
        'A request needs a small extension and one explicit owner for its lifetime. Define an ordinary plugin when no storage backend is needed.',
        '请求需要一个小型扩展和明确的生命周期拥有者。不需要存储后端时，可定义普通插件。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (value: string) => value.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))`,
      result: t(
        'Prints DRAFT. The literal plugin tuple retains the label method and resource syntax disposes one host.',
        '输出DRAFT。字面量插件元组保留label方法，资源语法释放同一个宿主。'
      )
    }
  ]
}
