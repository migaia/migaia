import { createRpcHost } from '@migaia/rpc-host'
import { describe, expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

/** Proves composed provider admission rejects frames not addressed to its receiver identity. */
describe('composed receiver identity admission', () => {
  it('rejects absent, foreign, and forged receiver identities before provider execution', async () => {
    /** Real public installation lends the original native Session ingress and accepted identity. */
    const server = coreMemoryServer('receiver-provider')
    /** Count actual provider effects before and after every hostile receiver selector. */
    let executions = 0
    /** Provider registration uses the actual current Host boundary rather than a v1 kernel. */
    const provider = await createRpcHost({
      ...server.options,
      provide: {
        count: () => {
          executions += 1
          return null
        }
      }
    })
    /** Every candidate retains a separate real connection when malformed v2 input closes one. */
    const clients: Awaited<ReturnType<typeof server.connect>>[] = []
    try {
      /** This ordinary call supplies canonical routing and both real generation tuples. */
      const client = await server.connect('receiver-client')
      clients.push(client)
      await client.host.memory.send('receiver-provider', 'count', null)
      expect(executions).toBe(1)
      /** The original physical carrier records the genuine semantic request before delivery. */
      const original = client.pair[1].written.find((frame) => frame.kind === 'call')
      if (original?.kind !== 'call') return expect.unreachable()
      /** Forged sender identity stays fixed while only the receiver selector changes. */
      const route = { ...original.route, senderId: 'someone-else' }
      /** Removing the receiver exercises pure v2 rejection before provider dispatch. */
      const absentReceiver: Partial<typeof route> = { ...route }
      delete absentReceiver.receiverId
      /** Every forged frame changes only the receiver selector under the canonical route. */
      const frames = [
        { ...original, id: 'forged-task', route: absentReceiver },
        { ...original, id: 'forged-task', route: { ...route, receiverId: 'foreign-provider' } },
        { ...original, id: 'forged-task', route: { ...route, receiverId: 'receiver-provider' } }
      ]
      for (const [index, frame] of frames.entries()) {
        /** A previous malformed frame cannot prevent a later identity vector reaching ingress. */
        const candidate = index === 0 ? client : await server.connect(`receiver-client-${index}`)
        if (candidate !== client) clients.push(candidate)
        await candidate.pair[1].write({ kind: 'message', data: frame })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(executions).toBe(1)
    } finally {
      await Promise.all([...clients.map((client) => client.host.close()), provider.close()])
    }
  })
})
