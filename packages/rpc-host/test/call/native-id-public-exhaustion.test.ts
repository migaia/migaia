/** The public call boundary preserves the canonical allocator's original exhaustion and report. */
import { expect, it, vi } from 'vitest'
import { NativeDefaultIdText } from '../../dist/call/id-text.js'

/** Keep the actual class independently from the finite constructor-input module substitution. */
const actualAllocator =
  await vi.importActual<typeof import('../../dist/call/id.js')>('../../dist/call/id.js')

/** Migrate only the old internal starting state; the original class still owns every allocation. */
function exhaustedCallIdAllocator(
  report?: (error: unknown) => void
): InstanceType<typeof actualAllocator.RpcCallIdAllocator> {
  return new actualAllocator.RpcCallIdAllocator(report, 0xffffffffffffffffn)
}

/** The real public Host imports the same allocator export with only its constructor input seeded. */
function allocatorModule() {
  return { ...actualAllocator, RpcCallIdAllocator: exhaustedCallIdAllocator }
}

it('reports the actual public allocator exhaustion once without entering the provider or physical writer', async () => {
  vi.doMock('../../dist/call/id.js', allocatorModule)
  /** Default passthrough observes the actual original throw rather than a deleted private brand. */
  const allocated = vi.spyOn(actualAllocator.RpcCallIdAllocator.prototype, 'allocate')
  /** Only the actual configured caller reporter retains public allocation diagnostics. */
  const reported: unknown[] = []
  /** Provider entry is a business effect distinct from actual physical write admission. */
  let providers = 0
  /** Original genuine host owners remain finally-owned even when an assertion rejects. */
  let pair:
    | Awaited<ReturnType<typeof import('../host/core-fixture.ts').connectedCoreHosts>>
    | undefined
  try {
    /** Dynamic loading follows the original factory-mock pattern before either public Root exists. */
    const { connectedCoreHosts } = await import('../host/core-fixture.ts')
    pair = await connectedCoreHosts(
      {
        echo: (value) => {
          providers += 1
          return value
        }
      },
      {},
      () => undefined,
      undefined,
      (error) => reported.push(error)
    )
    /** Both native handshakes have completed before observing the original caller write owner. */
    const written = vi.spyOn(pair.pair[1], 'write')
    try {
      /** The selected actual accepted peer is valid; only canonical ID allocation can reject here. */
      const failure = await pair.b.memory.send('a', 'echo').catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        source: 'rpc.endpoint',
        code: 'INVALID_CONFIG',
        message: NativeDefaultIdText.counterExhausted
      })
      expect(allocated).toHaveBeenCalledTimes(1)
      expect(allocated.mock.results[0]?.type).toBe('throw')
      expect(allocated.mock.results[0]?.value).toBe(failure)
      expect(reported).toEqual([failure])
      expect(providers).toBe(0)
      expect(written).not.toHaveBeenCalled()
    } finally {
      written.mockRestore()
    }
  } finally {
    try {
      await pair?.close()
    } finally {
      allocated.mockRestore()
      vi.doUnmock('../../dist/call/id.js')
    }
  }
})
