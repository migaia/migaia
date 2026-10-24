import { isDefinedPlugin } from '@migaia/plugin-host'
import type { IProcessSpec } from '@migaia/supervision/process'
import { describe, expect, it } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { createSpawnProcessBinding } from '../../../rpc-plugin-process/dist/process/plugin/binding.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { nativeHostFixture } from './fixtures/host-native.js'

describe('process native replacement admission', () => {
  it.each([null, undefined])(
    'codes malformed bootstrap payload %s before launch',
    async (payload) => {
      /**
       * The retained binding owns bootstrap/token validation before any native launch or budget
       * use.
       */
      const fixture = nativeHostFixture()
      try {
        expect(() =>
          createSpawnProcessBinding(
            {
              ...fixture.options.spawn,
              supervision: {
                ...fixture.options.spawn.supervision,
                spec: {
                  ...fixture.options.spawn.supervision.spec,
                  bootstrap: { via: 'stdin', payload } as unknown as IProcessSpec['bootstrap']
                }
              }
            },
            () => undefined
          )
        ).toThrowError(
          expect.objectContaining({
            source: 'rpc.transport.process',
            code: 'PROCESS_PLUGIN_INVALID_OPTION',
            detail: { field: 'supervision.spec.bootstrap' }
          })
        )
        expect(fixture.handles).toHaveLength(0)
        expect(fixture.options.spawn.supervision.budget!.inUse).toBe(0)
      } finally {
        await fixture.close()
      }
    }
  )

  it('rejects a missing default ping before launch while retaining explicit custom health', async () => {
    /** Use the genuine same native binding whose accepted proposal controls supervisor ping. */
    const fixture = nativeHostFixture()
    /** This original proposal deliberately lacks the required native ping capability. */
    const offer = {
      ...createNativeProcessOffer({ peer: { id: 'probe', runtime: 'node' } }),
      capabilities: ['close@1']
    }
    try {
      expect(() =>
        createSpawnProcessBinding(
          {
            ...fixture.options.spawn,
            offer,
            supervision: { ...fixture.options.spawn.supervision, health: undefined }
          },
          () => undefined
        )
      ).toThrowError(
        expect.objectContaining({
          code: 'PROCESS_RESILIENCE_INVALID_OPTION',
          detail: { field: 'deployment.offer.capabilities' }
        })
      )
      expect(fixture.handles).toHaveLength(0)
      /** Custom health bypasses only the absent default ping contract, as in the original owner. */
      const binding = createSpawnProcessBinding(
        {
          ...fixture.options.spawn,
          offer,
          supervision: {
            ...fixture.options.spawn.supervision,
            health: { check: async () => undefined }
          }
        },
        () => undefined
      )
      expect(binding.health).toBe('custom')
      await binding.supervisor.dispose()
      expect(fixture.options.spawn.supervision.budget!.inUse).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('keeps the genuine cold native definition trusted and frozen before installation', async () => {
    /** Real Host replacement and rollback remain covered by host-replace.test on this same source. */
    const fixture = nativeHostFixture()
    try {
      /** Current public transport definition replaces the retired remote Feature wrapper. */
      const plugin = processPlugin(fixture.options)
      expect(isDefinedPlugin(plugin)).toBe(true)
      expect(Object.isFrozen(plugin)).toBe(true)
      expect(fixture.handles).toHaveLength(0)
      expect(fixture.options.spawn.supervision.budget!.inUse).toBe(0)
    } finally {
      await fixture.close()
    }
  })
})
