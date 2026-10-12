import { createThreadPeer, createThreadPlugin, isThreadChild } from '@migaia/rpc-threads'
import { defineHost } from '@migaia/plugin-host'

/** Awaiting the guard prevents this same module from spawning another Worker in the child. */
const child = await isThreadChild()
if (child) {
  await createThreadPeer({
    provide: {
      double: (value) => value * 2,
      child: () => child,
      flags: () => process.execArgv
    }
  })
} else {
  /** Each native child run selects one public factory path against built packages. */
  const mode = process.argv[2]
  if (mode === 'plugin') {
    /** Host source shorthand uses precisely the same Peer expansion as standalone ownership. */
    const plugin = createThreadPlugin({
      name: 'worker',
      spawn: new URL('./short-spawn-worker.mjs', import.meta.url)
    })
    /** The Host releases the actual Worker when the fixture completes. */
    const host = defineHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    try {
      await host.use(plugin)
      console.log(JSON.stringify({ value: await host.thread.request('worker', 'double', 21) }))
    } finally {
      await host.dispose()
    }
  } else {
    /** Paths use the main module directory; exact URLs retain their original target. */
    const spawn =
      mode === 'self'
        ? true
        : mode === 'path'
          ? './short-spawn-worker.mjs'
          : mode === 'typescript'
            ? new URL('./short-spawn-worker.ts', import.meta.url)
            : mode === 'missing-js'
              ? new URL('./short-spawn-missing-js.ts', import.meta.url)
              : {
                  entry: new URL('./short-spawn-worker.mjs', import.meta.url),
                  name: 'short-worker'
                }
    /** No runtime wiring or reporter is required for a TypeScript-compatible child. */
    let peer
    try {
      peer = await createThreadPeer({ spawn })
      console.log(
        JSON.stringify({
          value: await peer.request('double', 21),
          child: await peer.request('child'),
          ...(mode === 'self' ? { flags: await peer.request('flags') } : {})
        })
      )
    } catch (error) {
      if (mode !== 'missing-js') throw error
      /** Original module-resolution failures must remain reachable through existing wrappers. */
      const codes = []
      /** Existing error chains are traversed without replacing any native error. */
      let current = error
      while (current && typeof current === 'object') {
        codes.push(current.code)
        current = current.cause
      }
      console.log(JSON.stringify({ codes }))
    } finally {
      await peer?.close()
    }
  }
}
