import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { archivePlugin } from '@migaia/storage-plugin-archive'
/** All runtimes reach the same built neutral Archive and native WHATWG gzip implementation. */
const initial = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'hot' }), memoryBackendPlugin({ id: 'cold' })]
})
const host = await initial.use(
  archivePlugin({
    id: 'history',
    hot: 'hot',
    cold: 'cold',
    rules: [{ name: 'old', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]
  })
)
await host.detect()
try {
  await host.backend('hot').putRecord({ old: true, value: new Map([['answer', 42]]) }, 'event:a')
  const result = await host.extensions.history.run()
  const restored = await host.extensions.history.get('event:a', { restore: true })
  if (
    result.archived !== 1 ||
    !(
      restored &&
      typeof restored === 'object' &&
      'value' in restored &&
      restored.value instanceof Map &&
      restored.value.get('answer') === 42
    )
  )
    throw new Error('Built Archive record differs')
  if ((await host.extensions.history.sweep()).removed !== 1)
    throw new Error('Built Archive orphan remains')
} finally {
  await host.dispose()
}
console.log(JSON.stringify({ status: 'PASS', groups: ['archive'] }))
