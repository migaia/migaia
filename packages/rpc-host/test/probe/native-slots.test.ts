/** Native observation subscriptions retain the original probe activation and cleanup predicates. */
import { createRpcHost } from '@migaia/rpc-host'
import { RpcCarrierObservation } from '@migaia/rpc-host/sdk'
import { defineProbe, probe } from '@migaia/rpc-host/plugins/probe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

/** Assertion or acquisition failures must also release this test's passthrough prototype spy. */
afterEach(() => vi.restoreAllMocks())

describe('activated native probe slots', () => {
  // All nine original business/observation assertions remain.
  it.each(['absent', 'single', 'array'] as const)(
    'preserves real native results with %s probe definitions',
    async (mode) => {
      /** Only the installed readonly callback may publish an event in this original test arm. */
      const emit = vi.fn()
      /** The genuine native subscription supplies its exact original cleanup receipt. */
      const original = RpcCarrierObservation.prototype.subscribe
      /** Wrap only the real native method's remover so its original one-call contract is visible. */
      const observe = vi
        .spyOn(RpcCarrierObservation.prototype, 'subscribe')
        .mockImplementation(function (this: RpcCarrierObservation, listener) {
          /** Reflect.apply retains this exact built-in-style method receiver without a new owner. */
          const release = Reflect.apply(original, this, [listener])
          return vi.fn(() => release())
        })
      /** One immutable handle is passed unchanged through the supported native plugin input. */
      const handle = defineProbe({ stages: ['peer', 'message', 'carrier'], emit })
      /** The original array arm supplies the same immutable handle through native rest input. */
      const handles = [handle]
      /** Removes Peer options; the same native plugin accepts individual or spread array inputs. */
      const plugins =
        mode === 'absent' ? [] : [mode === 'single' ? probe(handle) : probe(...handles)]
      /** The original fixture acquires both actual endpoints through their existing source owner. */
      const listener = coreMemoryServer('provider')
      /** Actual public provider execution alone produces the original doubled business result. */
      const server = await createRpcHost({
        ...listener.options,
        plugins: [...plugins, ...listener.options.plugins],
        provide: { double: (value: number) => value * 2 }
      })
      /** The caller independently installs the same cold probe under its own native cleanup owner. */
      const client = await listener.connect('caller', { plugins })
      try {
        expect(await client.host.memory.request('double', 21)).toBe(42)
        if (mode === 'absent') {
          expect(emit).not.toHaveBeenCalled()
          expect(observe).not.toHaveBeenCalled()
        } else {
          expect(emit).toHaveBeenCalled()
          expect(observe).toHaveBeenCalledTimes(2)
        }
      } finally {
        await Promise.all([client.host.close(), server.close()])
      }
      try {
        if (mode === 'absent') {
          expect(emit).not.toHaveBeenCalled()
          expect(observe).not.toHaveBeenCalled()
        } else {
          expect(observe).toHaveBeenCalledTimes(2)
          for (const receipt of observe.mock.results) expect(receipt.value).toHaveBeenCalledTimes(1)
        }
      } finally {
        observe.mockRestore()
      }
    }
  )

  // ..optional capability remains unused without a probe.
  it('an unobserved native Session ignores the optional physical observation capability', async () => {
    /** A passthrough spy observes the actual acquired capability without installing it itself. */
    const observe = vi.spyOn(RpcCarrierObservation.prototype, 'subscribe')
    /** Both physical endpoints retain their genuine optional observation capability. */
    const listener = coreMemoryServer('probe-slot-right')
    /** The public provider owns the same unchanged payload assertion as the original endpoint. */
    const server = await createRpcHost({
      ...listener.options,
      provide: { echo: (value) => value }
    })
    /** This actual source installs no probe plugin on either native Host. */
    const client = await listener.connect('probe-slot-left')
    try {
      expect(await client.host.memory.send('probe-slot-right', 'echo', 'unchanged')).toBe(
        'unchanged'
      )
      expect(observe).not.toHaveBeenCalled()
    } finally {
      await Promise.all([client.host.close(), server.close()])
    }
    try {
      expect(observe).not.toHaveBeenCalled()
    } finally {
      observe.mockRestore()
    }
  })
})
