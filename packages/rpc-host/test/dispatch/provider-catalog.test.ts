/** Provider admission uses the public Host; exact table cleanup remains with its canonical catalog. */
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { ProviderCatalog } from '../../dist/dispatch/catalog-scope.js'
import { compileProviderMethods } from '../../dist/dispatch/catalog.js'
import { coreMemoryServer } from '../host/core-fixture.js'

it('rejects a duplicate public provider without replacing the admitted method', async () => {
  /** The original method supplies an independently observable business value. */
  const provider = () => ({ ok: true as const })
  /** Genuine transport installation keeps this test on the public admission and dispatch path. */
  const server = coreMemoryServer('provider-registry-owner')
  /** Initial publication must succeed before duplicate registration is attempted. */
  const host = await createRpcHost({ ...server.options, provide: { method: provider } })
  /** Real requests prove that the failed registration cannot replace or remove the first method. */
  const client = await server.connect('provider-registry-client')
  try {
    expect(await client.host.memory.send('provider-registry-owner', 'method')).toEqual({ ok: true })
    expect(() => host.provide({ method: () => ({ ok: false }) })).toThrowError(
      expect.objectContaining({ source: 'rpc.endpoint', code: 'PROVIDER_DUPLICATED' })
    )
    expect(await client.host.memory.send('provider-registry-owner', 'method')).toEqual({ ok: true })
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('clears the sole provider index and its pending reservations on repeated close', () => {
  /** The canonical compiler supplies exact entries rather than a parallel test registry. */
  const methods = compileProviderMethods({ method: () => ({ ok: true as const }) })
  /** Directory projection is irrelevant to cleanup but uses its actual finite method contract. */
  const describe = vi.fn(
    (entry: Parameters<ConstructorParameters<typeof ProviderCatalog>[0]>[0]) => ({
      name: entry.name,
      supportedModes: ['request'] as const,
      modeSource: 'generated-routes' as const
    })
  )
  const catalog = new ProviderCatalog(describe, () => undefined)
  /** One committed receipt owns the live method; another owns an independent pending reservation. */
  const active = catalog.prepare(methods)
  active.commit()
  catalog.prepare(compileProviderMethods({ pending: () => undefined }))
  expect(catalog.lookup('method')?.method).toBe(methods.get('method')?.method)
  describe.mockClear()
  catalog.close()
  catalog.close()
  expect(describe).not.toHaveBeenCalled()
  expect(catalog.lookup('method')).toBeUndefined()
  expect(catalog.lookup('pending')).toBeUndefined()
  expect(catalog.methods.size).toBe(0)
  expect(catalog.reservations.size).toBe(0)
})
