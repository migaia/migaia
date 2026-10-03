import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'
import type { IRpcProviderRejection } from '../../src/core/provider-admission.js'
import { streamRoots } from '../streaming/fixture.js'

describe('stream replay custody through public endpoint behavior', () => {
  it.each([false, true])(
    '[A8/A28] disconnect cleans the pending iterator and reports cleanup failure: authenticated=%s',
    async (authenticated) => {
      /** Real composed endpoints retain separate physical, replay and stream settlement owners. */
      const [clientTransport, serverTransport] = createMemoryTransportPair()
      /** Canonical authentication selects active stream replay retention on the legacy transport. */
      const middlewares = () =>
        authenticated ? [authentication({ sign: (value) => value, verify: (value) => value })] : []
      /** Owns provider admission and iterator cleanup on the receiving endpoint. */
      const server = await createComposedEndpoint(
        {
          id: 'server',
          transport: serverTransport,
          middlewares: [connect({ transport: serverTransport }), ...middlewares()]
        },
        streamRoots()
      )
      /** Owns consumer completion independently of the producer lifetime. */
      const client = await createComposedEndpoint(
        {
          id: 'client',
          transport: clientTransport,
          middlewares: [connect({ transport: clientTransport }), ...middlewares()]
        },
        streamRoots()
      )
      /** The original cleanup failure must survive diagnostic reporting unchanged. */
      const cause = new Error('fixture iterator return failure')
      /** Retains original diagnostic error identities for cleanup assertions. */
      const failures: IRpcHookEvent[] = []
      /** Releases the failure observer before endpoint disposal. */
      const remove = server.hooks.on((event) => {
        if (event.name === 'failure') failures.push(event)
      })
      /** Held next remains an independent lifetime until it settles after transport disconnect. */
      let release!: () => void
      /** Counts actual pending iterator pulls before disconnection. */
      let pulls = 0
      /** Counts cleanup attempts separately from the held pull. */
      let returns = 0
      /** Keeps the underlying pull unresolved until the test releases its lifetime. */
      const held = new Promise<IteratorResult<never>>((resolve) => {
        release = () => resolve({ done: true, value: undefined })
      })
      server.stream.provide('held', (_params, { context }) => {
        expect(context.signal.aborted).toBe(false)
        expect(context.success('admitted')).toMatchObject({ ok: true, data: 'admitted' })
        /** Explicit iterator typing keeps its receiver narrower than the public iterable union. */
        const iterator: AsyncIterableIterator<never> = {
          [Symbol.asyncIterator]() {
            return this
          },
          next() {
            pulls += 1
            return held
          },
          return() {
            returns += 1
            return Promise.reject(cause)
          }
        }
        return iterator
      })
      try {
        /** Tracks the first admitted consumer across disconnection. */
        const iterator = client.stream.open('server', 'held', null)
        /** Observes terminal rejection without leaving an unhandled pending pull. */
        const pending = iterator.next().catch((error: unknown) => error)
        await vi.waitFor(() => expect(pulls).toBe(1))
        serverTransport.close()
        /** Retains the consumer's sticky terminal error for future-pull identity assertions. */
        const failure = await pending
        expect(failure).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
        await expect(iterator.next()).rejects.toBe(failure)
        await vi.waitFor(() => expect(returns).toBe(1))
        await vi.waitFor(() => expect(failures.some((event) => event.error === cause)).toBe(true))
        release()
        await Promise.resolve()
        expect(returns).toBe(1)
      } finally {
        release()
        remove()
        await client.dispose()
        await server.dispose()
      }
    }
  )

  it('[A8/A28] protected stream replay capacity rejects a second identity before provider entry', async () => {
    /** Capacity belongs to the provider ledger, not the client stream budget. */
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Records the existing provider rejection channel without introducing diagnostics. */
    const notices: IRpcProviderRejection[] = []
    /** Owns provider admission and iterator cleanup on the receiving endpoint. */
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        providerLimits: {
          maxReplayEntriesPerPeer: 1,
          onRejected: (notice) => {
            notices.push(notice)
          }
        },
        middlewares: [
          connect({ transport: serverTransport }),
          authentication({ sign: (value) => value, verify: (value) => value })
        ]
      },
      streamRoots()
    )
    /** Owns consumer completion independently of the producer lifetime. */
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [
          connect({ transport: clientTransport }),
          authentication({ sign: (value) => value, verify: (value) => value })
        ]
      },
      streamRoots()
    )
    /** Pending next keeps the first identity admitted until transport cleanup and settlement finish. */
    let release!: () => void
    /** Counts business entry to distinguish admission refusal from provider failure. */
    let starts = 0
    /** Keeps the underlying pull unresolved until the test releases its lifetime. */
    const held = new Promise<IteratorResult<never>>((resolve) => {
      release = () => resolve({ done: true, value: undefined })
    })
    server.stream.provide('held', () => {
      starts += 1
      /** The fixture owns one iterator, rather than returning a contextual iterable union. */
      const iterator: AsyncIterableIterator<never> = {
        [Symbol.asyncIterator]() {
          return this
        },
        next: () => held,
        return: async () => ({ done: true as const, value: undefined })
      }
      return iterator
    })
    try {
      /** Keeps the first stream active while its replay slot is occupied. */
      const first = client.stream.open('server', 'held', 'first')
      /** Observes terminal rejection without leaving an unhandled pending pull. */
      const pending = first.next().catch((error: unknown) => error)
      await vi.waitFor(() => expect(starts).toBe(1))
      /** Attempts a distinct identity against the same occupied provider replay slot. */
      const rejected = client.stream.open('server', 'held', 'second')
      await expect(rejected.next()).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(starts).toBe(1)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ method: 'held', reason: 'replayLedgerFull' })
      expect(Object.isFrozen(notices[0])).toBe(true)
      expect(notices[0]!.verifiedPeerKey).not.toBe('')
      expect(notices[0]!.controllerKey).not.toBe('')
      serverTransport.close()
      await pending
    } finally {
      release()
      await client.dispose()
      await server.dispose()
    }
  })
})
