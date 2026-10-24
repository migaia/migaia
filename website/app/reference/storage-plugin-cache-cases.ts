import type { ICaseDoc, IText } from './contract.js'
/** Both language versions describe the same executable canonical request example. */
const t = (en: string, zh: string): IText => ({ en, zh })
/**
 * Request identities use the package's real portable projection rather than application JSON
 * ordering.
 */
export const storagePluginCacheCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  cacheKey: [
    {
      title: t('Normalize a request key', '规范化请求键'),
      problem: t(
        'Equivalent request objects can arrive with different field order.',
        '等价请求对象可能具有不同字段顺序。'
      ),
      example: `import { cacheKey } from '@migaia/storage-plugin-cache'
const first = await cacheKey('response', { model: 'one', version: 1 })
const second = await cacheKey('response', { version: 1, model: 'one' })
console.log(first === second)`,
      result: t(
        'Prints true; the serializer sorts object fields before hashing.',
        '输出 true；serializer 在哈希前规范排序对象字段。'
      )
    }
  ]
}
