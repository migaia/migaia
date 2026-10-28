/** Original remote stream business runs through the real namespace and its physical carrier. */
import { describe, expect, it } from 'vitest'
import { RpcCallMode, RpcWireKind } from '@migaia/rpc-contract/protocol'
import { connectedCoreHosts } from '../host/core-fixture.ts'

describe('remote stream dispatch', () => {
  it.each(['generator', 'asyncGenerator'] as const)(
    '%s opens the stream only at first next and never sends a request',
    async (mode) => {
      /** Both provider modes belong to the canonical public provider catalog. */
      const fixture = await connectedCoreHosts({
        p: {
          f: {
            generator: function* () {
              yield 'item'
            },
            asyncGenerator: async function* () {
              yield 'item'
            }
          }
        }
      })
      try {
        /** The same original carrier records physical frames after its real handshake. */
        const written = fixture.pair[1].written
        const iterator = fixture.b.memory.stream(
          `p.f.${mode}`,
          []
        ) as AsyncIterableIterator<unknown>
        expect(
          written.filter(
            (frame) => frame.kind === RpcWireKind.call && frame.task.mode === RpcCallMode.stream
          )
        ).toHaveLength(0)
        await expect(iterator.next()).resolves.toEqual({ value: 'item', done: false })
        expect(
          written.filter(
            (frame) => frame.kind === RpcWireKind.call && frame.task.mode === RpcCallMode.stream
          )
        ).toHaveLength(1)
        expect(
          written.filter(
            (frame) => frame.kind === RpcWireKind.call && frame.task.mode === RpcCallMode.request
          )
        ).toHaveLength(0)
        await iterator.return!()
      } finally {
        await fixture.close()
      }
    }
  )

  it('rejects stream-only forbidden idempotency options before guard or open', async () => {
    /** Options pass through the actual namespace, shared preparation and one physical source. */
    const fixture = await connectedCoreHosts(
      {
        p: {
          f: {
            generator: function* () {
              yield 'item'
            }
          }
        }
      },
      {},
      () => undefined
    )
    try {
      const iterator = fixture.b.memory.stream('p.f.generator', [], {
        idempotencyKey: 'key'
      }) as AsyncIterableIterator<unknown>
      await expect(iterator.next()).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'CAPABILITY_UNSUPPORTED'
      })
      expect(
        fixture.pair[1].written.filter(
          (frame) => frame.kind === RpcWireKind.call && frame.task.mode === RpcCallMode.stream
        )
      ).toHaveLength(0)
    } finally {
      await fixture.close()
    }
  })
})
