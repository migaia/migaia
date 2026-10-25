import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'

if (await isThreadChild()) {
  await createRpcHost({
    provide: { echo: (value: string) => value },
    plugins: [threadPlugin({ connectToParent: true })]
  })
} else {
  /** Preserve every original native shutdown diagnostic through actual owned cleanup. */
  const diagnostics: unknown[] = []
  /** The public URL form acquires the real Bun Worker through the canonical source owner. */
  const peer = await createRpcHost({
    report: (error) => diagnostics.push(error),
    plugins: [threadPlugin({ spawn: new URL(import.meta.url) })]
  })
  /** Business success is observed only after the real remote provider answers. */
  let value: unknown
  try {
    value = await peer.thread.request('echo', 'actual-bun-worker')
  } finally {
    await peer.close()
  }
  console.log(
    JSON.stringify({
      value,
      diagnostics: diagnostics.map((error: any) => ({
        source: error?.source,
        code: error?.code,
        name: error?.name,
        detail: error?.detail,
        message: String(error?.message ?? error)
      }))
    })
  )
}
