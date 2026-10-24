import type { ICaseDoc } from './contract.js'
/** Maintained Archive examples execute against the same public host and package entry. */
export const storagePluginArchiveCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  archivePlugin: [
    {
      title: {
        en: 'Archive an old record explicitly',
        zh: '显式归档旧记录'
      },
      problem: {
        en: 'Retain cold history while removing unchanged records from a transactional hot layer.',
        zh: '保留冷历史，同时从事务热层移除未变记录。'
      },
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { archivePlugin } from '@migaia/storage-plugin-archive'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]\n})\nconst host = await base.use(\n  archivePlugin({\n    id: 'history',\n    hot: 'hot',\n    cold: 'cold',\n    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]\n  })\n)\nawait host.detect()\ntry {\n  await host.backend('hot').putRecord({ old: true, answer: 42 }, 'event:one')\n  await host.extensions.history.run()\n  console.log(await host.extensions.history.get('event:one', { restore: true }))\n  await host.extensions.history.sweep()\n} finally {\n  await host.dispose()\n}\n",
      result: {
        en: 'Reads the archived business value, restores it explicitly, and removes the unreferenced object.',
        zh: '读取归档业务值，显式恢复，再清理无引用对象。'
      }
    }
  ]
}
