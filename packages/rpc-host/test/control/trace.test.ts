import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

it('passes trace to the provider and rejects invalid values before sending', async () => {
  /** Real native connection setup preserves the original directed client/provider identities. */
  const listener = coreMemoryServer('client')
  /** The public Host alone owns provider delivery and physical cleanup. */
  const client = await createRpcHost(listener.options)
  try {
    /** The actual provider context is constructed by the canonical dispatch owner. */
    const provider = await listener.connect('provider', {
      provide: { trace: (_value: unknown, context: IRpcContext) => context.trace ?? null }
    })
    /** Capture the same native physical endpoint's original written array without a wrapper. */
    const sent = provider.pair[0].written
    /** Observe a returned rejection during cleanup without turning it into a synchronous throw. */
    let validation: Promise<unknown> | undefined
    try {
      expect(await client.memory.send('provider', 'trace', null, { trace: '00-abc-01' })).toBe(
        '00-abc-01'
      )
      expect(await client.memory.send('provider', 'trace', null)).toBeNull()
      /** Invalid inputs must preserve the original pre-physical-write validation boundary. */
      const prior = sent.length
      expect(() => {
        validation = client.memory.send('provider', 'trace', null, { trace: 'x'.repeat(257) })
      }).toThrow(expect.objectContaining({ code: 'CONTRACT_INVALID' }))
      expect(() => {
        validation = client.memory.send('provider', 'trace', null, { trace: 'x\ny' })
      }).toThrow(expect.objectContaining({ code: 'CONTRACT_INVALID' }))
      expect(sent).toHaveLength(prior)
    } finally {
      await validation?.catch(() => undefined)
      await provider.host.close()
    }
  } finally {
    await client.close()
  }
})
