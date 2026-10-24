import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin, type IArchiveApi, type IArchiveRunResult } from '../src/index.js'
/** Literal extension identities survive the flat extension functions' public projection. */
async function declarations() {
  const base = await createStorageHost({
    plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
  })
  const host = await base.use(
    archivePlugin({
      id: 'history',
      hot: 'hot',
      cold: 'cold',
      rules: [{ name: 'all', prefix: '', olderThanMs: 0, where: () => ({}) }]
    })
  )
  const api: IArchiveApi<'history'> = host.extensions
  const result: Promise<IArchiveRunResult> = api.historyRun({ rule: 'all', limit: 1 })
  const value: Promise<ICollectionsCodecValue | undefined> = host
    .org('11111111-1111-4111-8111-111111111111')
    .extensions.historyGet('a')
  void result
  void value
  // @ts-expect-error Ordinary Archive contributes no backend slot.
  host.backend('history')
  // @ts-expect-error Archive does not own a public disposal endpoint.
  api.dispose()
  // @ts-expect-error String business keys never enter the private tuple namespace.
  api.historyGet(['tuple'])
  await host.dispose()
}
void declarations
