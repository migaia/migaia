import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin, isThreadChild } from '@migaia/rpc-plugin-thread'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'

/** Awaiting the guard prevents this same module from spawning another Worker in the child. */
const child = await isThreadChild()
if (child) {
  await createRpcHost({
    provide: {
      double: (value) => value * 2,
      child: () => child,
      flags: () => process.execArgv
    },
    plugins: [threadPlugin({ connectToParent: true })]
  })
} else {
  /** Each native child run selects one public factory path against built packages. */
  const mode = process.argv[2]
  if (mode === 'plugin') {
    /** Host source shorthand uses precisely the same Peer expansion as standalone ownership. */
    const plugin = threadPlugin({
      name: 'worker',
      spawn: new URL('./short-spawn-worker.mjs', import.meta.url)
    })
    /** The Host releases the actual Worker when the fixture completes. */
    /** Lazy pipeline authority reads this case's own native host only at installation. */
    const rpc = rpcHostPipelines(
      () => host,
      (name, request) => host.pipeline(name, request)
    )
    const host = defineHost({
      ...rpc,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    try {
      await host.use(plugin)
      console.log(JSON.stringify({ value: await host.thread.send('worker', 'double', 21) }))
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
      peer = await createRpcHost({ plugins: [threadPlugin({ spawn })] })
      console.log(
        JSON.stringify({
          value: await peer.thread.request('double', 21),
          child: await peer.thread.request('child'),
          ...(mode === 'self' ? { flags: await peer.thread.request('flags') } : {})
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
