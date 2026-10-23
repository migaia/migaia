import type { ICaseDoc, IText } from './contract.js'
/** Keep the two languages attached to one runnable public-entry scenario. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Application extensions retain their exact inputs while the host owns installation and cleanup. */
export const storageHostCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
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
