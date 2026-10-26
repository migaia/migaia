/** Settlement provenance reaches the real public provider path; copies stay plain business values. */
import { assert, expect, it, vi } from 'vitest'
import type { IRpcProviderResult } from '../../dist/dispatch/types.js'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** Reflection copies every public descriptor without obtaining the original context's token. */
function copyAllDescriptors<T extends object>(source: T): T {
  /** The attacker chooses a separate object with identical reflected properties. */
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source)) as T
  expect(copy).not.toBe(source)
  expect(Reflect.ownKeys(source).length).toBeGreaterThan(0)
  expect(Object.getOwnPropertyDescriptors(copy)).toEqual(Object.getOwnPropertyDescriptors(source))
  return copy
}

it.each(['success', 'failed'] as const)(
  'rejects a copied %s settlement and preserves genuine business metadata',
  async (kind) => {
    /** This exact backing is observed at the real physical send, not a copied test port. */
    const transfer = new ArrayBuffer(8)
    /** Provider reply helpers mint genuine ownership within their actual invocation. */
    const peers = await connectedCoreHosts(
      {},
      {
        test: (payload, context) => {
          /** Transfer and failure records come from the actual public provider context. */
          const genuine: IRpcProviderResult =
            kind === 'success'
              ? context.success('provider-business-value', { transfer: [transfer] })
              : context.failed('provider-business-failure', 'BUSINESS_FAILURE')
          expect(Object.isFrozen(genuine)).toBe(true)
          if (genuine.ok) {
            expect(genuine.transfer).toEqual([transfer])
            expect(genuine.transfer?.[0]).toBe(transfer)
            expect(Object.isFrozen(genuine.transfer)).toBe(true)
          }
          return payload === 'forged' ? copyAllDescriptors(genuine) : genuine
        }
      }
    )
    /** Real physical send options retain exact provider transfer identity after business return. */
    const write = vi.spyOn(peers.pair[1], 'write')
    try {
      // An unbranded copy grants no settlement authority; it returns as an ordinary business value.
      await expect(peers.a.memory.send('b', 'test', 'forged')).resolves.toMatchObject({
        ok: kind === 'success'
      })
      if (kind === 'success') {
        await expect(peers.a.memory.send('b', 'test', 'genuine')).resolves.toBe(
          'provider-business-value'
        )
        expect(write.mock.calls.some(([, options]) => options?.transfer?.[0] === transfer)).toBe(
          true
        )
      } else {
        await expect(peers.a.memory.send('b', 'test', 'genuine')).rejects.toMatchObject({
          message: 'provider-business-failure',
          code: 'BUSINESS_FAILURE'
        })
      }
    } finally {
      write.mockRestore()
      await peers.close()
    }
  }
)

it('keeps original lazy stream pulls and business values on the real namespace iterator', async () => {
  /** Only an explicit consumer pull may advance the original provider iterator. */
  const next = vi.fn(async () => ({ done: false as const, value: 'stream-business-value' }))
  /** The provider publishes an ordinary supported iterator rather than a preparation receipt. */
  const original: AsyncIterableIterator<string> = {
    next,
    [Symbol.asyncIterator]() {
      return this
    }
  }
  /** Both public Hosts and their actual transport sessions own the whole stream lifetime. */
  const peers = await connectedCoreHosts({}, { values: () => original })
  try {
    /** Stream construction stays lazy until next reaches the original provider. */
    const stream = peers.a.memory.stream('values')
    assert('next' in stream)
    expect(next).not.toHaveBeenCalled()
    await expect(stream.next()).resolves.toEqual({ done: false, value: 'stream-business-value' })
    expect(next).toHaveBeenCalledOnce()
    assert(stream.return)
    await stream.return()
  } finally {
    await peers.close()
  }
})
