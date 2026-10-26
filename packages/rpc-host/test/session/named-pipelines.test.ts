import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowFeature } from '@migaia/rpc-host/sdk'
import type { IRpcWriteAdmission } from '@migaia/rpc-contract/interfaces'
import { coreMemoryServer } from '../host/core-fixture.js'

describe('native Session frame pipelines', () => {
  it('joins every unawaited native next branch before releasing one logical write admission', async () => {
    /** One explicit state object lends barriers to the installed stage and actual carrier seam. */
    const operation = {
      enabled: false,
      entered: deferred<void>(),
      releases: [deferred<void>(), deferred<void>()],
      admissions: [] as (IRpcWriteAdmission | undefined)[]
    }
    /** The real native multiple-next runner owns branch completion even when a stage returns void. */
    const fork = defineFlowFeature({
      name: 'native-frame-fork',
      setup: () => ({
        stages: {
          frameOutbound(payload, next) {
            if (!operation.enabled) return next(payload)
            void next(payload)
            void next(payload)
          }
        }
      })
    })
    /** A genuine public Host and installed transport reach Session without a fabricated owner. */
    const server = coreMemoryServer('native-frame-server')
    /** The native plugin installs before the first actual transport startup. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [fork, ...server.options.plugins!]
    })
    /** A notification provides physical completion without introducing a business reply barrier. */
    const client = await server.connect('native-frame-client', { provide: { note: () => null } })
    /** Native reservation identity is opaque and must survive both physical descendants unchanged. */
    const admission = { release: vi.fn() }
    /** Only the acquired carrier can issue a logical admission ticket. */
    const reserve = vi.fn(() => admission)
    Object.defineProperty(client.pair[0], 'reserveWrite', { value: reserve, configurable: true })
    /** Borrow the actual original physical handoff; only its completion is deliberately held. */
    const original = client.pair[0].write
    /** Separate physical barriers prove the parent cannot finish after only its first child. */
    const writing = vi.spyOn(client.pair[0], 'write').mockImplementation(async (frame, options) => {
      /** Each branch retains the original capacity token while its real write is outstanding. */
      const index = operation.admissions.length
      operation.admissions.push(options?.admission)
      await original(frame, options)
      if (operation.admissions.length === 2) operation.entered.resolve()
      await operation.releases[index]!.promise
    })
    try {
      operation.enabled = true
      /** The public operation remains pending until the native runner joins both branch promises. */
      let settled = false
      /** Public notify still resolves to its original void physical terminal. */
      const pending = host.memory.notify('note').then((value) => {
        settled = true
        return value
      })
      await operation.entered.promise
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(operation.admissions).toEqual([admission, admission])
      expect(admission.release).not.toHaveBeenCalled()
      operation.releases[0]!.resolve()
      await operation.releases[0]!.promise
      expect(settled).toBe(false)
      expect(admission.release).not.toHaveBeenCalled()
      operation.releases[1]!.resolve()
      expect(await pending).toBeUndefined()
      expect(admission.release).toHaveBeenCalledTimes(1)
    } finally {
      operation.enabled = false
      for (const release of operation.releases) release.resolve()
      writing.mockRestore()
      Reflect.deleteProperty(client.pair[0], 'reserveWrite')
      await client.host.close()
      await host.close()
    }
  })
})
