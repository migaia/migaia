/** Asynchronous native installation failure retains original causes and starts no physical IO. */
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** A genuine SDK transport can start only after earlier native installation hooks succeed. */
function physicalTransport(carrier: MemoryCarrier) {
  return defineTransportPlugin({
    name: 'async-rollback-carrier',
    namespace: 'memory',
    async open(context) {
      /** The existing Session is the sole receiver, handshake and cleanup owner if reached. */
      const handle = context.attach(carrier)
      await handle.ready
      return { dispose: releaseNativeResource }
    }
  })
}

/** The original abort contribution had no external IO; this real native resource joins rollback. */
function releaseNativeResource(): void {}

// C069/C093: deleted role wrappers are replaced by genuine ordinary native installation hooks.
it.each([
  {
    title: 'injected timeout async rejection preserves primary and full rollback residue',
    name: 'middleware:timeout',
    message: 'timeout async install primary',
    ownResource: false
  },
  {
    title: 'native abort async hostile install preserves the primary and zero residue',
    name: 'middleware:abort',
    message: 'native abort hostile install',
    ownResource: true
  }
])('$title', async ({ name, message, ownResource }) => {
  /** The original exact error must survive the native installation wrapper. */
  const primary = new Error(message)
  /** This original physical medium remains unattached while the earlier native hook rejects. */
  const carrier = new MemoryCarrier(`async-rollback-${name}`)
  /** The native method is observed directly without replacing the actual subscription algorithm. */
  const subscribed = vi.spyOn(carrier, 'subscribe')
  /** Actual physical writes are observed without a custom adapter, codec or business facade. */
  const written = vi.spyOn(carrier, 'write')
  /** One real native Host owns the failing hook and the later genuine SDK transport. */
  const host = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Original role names identify the failing fixture hook, not a reconstructed old role API. */
  const failurePlugin = definePlugin({
    name,
    async install(core) {
      if (ownResource) core.onDispose(releaseNativeResource)
      await Promise.resolve()
      throw primary
    }
  })
  try {
    /** Real native rollback settles before its failed installation is observed. */
    const failure = await host
      .use(failurePlugin, physicalTransport(carrier))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: name }
    })
    expect(subscribed.mock.calls.length).toBe(0)
    expect(written.mock.calls.length).toBe(0)
  } finally {
    await host.dispose()
    await carrier.close()
    subscribed.mockRestore()
    written.mockRestore()
  }
})
