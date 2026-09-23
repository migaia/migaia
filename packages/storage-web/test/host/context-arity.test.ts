import { describe, expect, it } from 'vitest'
import { createStoragePluginHost } from '../../src/host/storage-host.js'
import { StorageErrorCode } from '../../src/error-code.js'

/**
 * A native-context queue that does not cover its batch is rejected at the handoff.
 *
 * `shift()` returning `undefined` reads identically to "this registration needs no bridge", so a
 * short queue would otherwise surface much later as a backend that silently never registered its
 * store. The check lives where both numbers are known — the queue and the entry count — and not in
 * the domain-core callback: a batch also installs a reactive service and one adapter per reactive
 * entry, so the queue running dry there is ordinary rather than a fault.
 */
const hostOptions = {
  execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
}

describe('storage host native context arity', () => {
  it('rejects a queue shorter than the entries it must cover', async () => {
    const host = createStoragePluginHost(hostOptions)
    let failure: unknown
    try {
      host.setNativeContexts([undefined], 2)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as { code?: unknown }).code).toBe(StorageErrorCode.backendPluginInvalid)
    await host.dispose()
  })

  it('rejects a queue longer than the entries it must cover', async () => {
    const host = createStoragePluginHost(hostOptions)
    expect(() => host.setNativeContexts([undefined, undefined], 1)).toThrow()
    await host.dispose()
  })

  it('accepts a queue whose length matches the batch exactly', async () => {
    const host = createStoragePluginHost(hostOptions)
    expect(() => host.setNativeContexts([undefined, undefined], 2)).not.toThrow()
    await host.dispose()
  })
})
