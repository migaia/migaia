/** Original middleware call results and close fences use real public Hosts and namespaces. */
import { expect, it } from 'vitest'
import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { connectedCoreHosts } from './core-fixture.js'

// RPC-TEST-FB075BDD690B-C137: preserve business values; BC1 replaces deleted sendAll shape.
it('real outbound send and broadcast preserve canonical results', async () => {
  /** The original provider echoes the payload reached over the genuine accepted physical pair. */
  const fixture = await connectedCoreHosts({}, { echo: (value: unknown) => value })
  try {
    await expect(fixture.a.memory.send('b', 'echo', 'value')).resolves.toBe('value')
    /** BC1's one-target broadcast returns its scalar; no one-peer dictionary is fabricated. */
    const broadcast = await fixture.a.memory.request('echo', 'fanout')
    expect(broadcast).toBe('fanout')
    /** C126-A002 keeps its original payload; BC1 replaces the old one-target result dictionary. */
    await expect(fixture.a.memory.request('echo', 'snapshot')).resolves.toBe('snapshot')
    // C137-A003's removed rejected:{} dictionary facet is retired under BC1, without PASS credit.
  } finally {
    await fixture.close()
  }
})

// RPC-TEST-FB075BDD690B-C138: preserve both original public lifecycle assertions.
it('outbound close is host-owned, idempotent, and rejects later sends canonically', async () => {
  /** Handshake completes through the existing native fixture before terminal behavior is tested. */
  const fixture = await connectedCoreHosts()
  /** Native cleanup withdraws the root extension; callers may retain this real namespace. */
  const namespace = fixture.a.memory
  try {
    /** Every caller joins the completion published by this one genuine Host close owner. */
    const first = fixture.a.close()
    expect(fixture.a.close()).toBe(first)
    await first
    await expect(
      Promise.resolve().then(() => namespace.send('target', 'method', null))
    ).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.endpointDisposed
    })
  } finally {
    await fixture.close()
  }
})

// RPC-TEST-FB075BDD690B-C141: preserve the original consumer payload and public close Promise.
it('public send retains its canonical result and disposal Promise identity', async () => {
  /** The genuine provider owns the original echo business, not a synthetic endpoint facade. */
  const fixture = await connectedCoreHosts({}, { echo: (value: unknown) => value })
  try {
    await expect(fixture.a.memory.send('b', 'echo', 'consumer')).resolves.toBe('consumer')
    /** The consumer retains the exact public completion before native cleanup begins. */
    const first = fixture.a.close()
    expect(fixture.a.close()).toBe(first)
    await first
  } finally {
    await fixture.close()
  }
})

// RPC-TEST-8F79B1713BC2-C002/C005 preserve validation through the public call owner.
it('validates method names and admits a dotted public method', async () => {
  /** A genuine accepted provider owns the original dotted method spelling. */
  const fixture = await connectedCoreHosts({}, { notes: { save: (value: unknown) => value } })
  try {
    /** Directed notify reaches the canonical method guard without scalar directory lookup. */
    const emptyMethod = Promise.resolve().then(() =>
      fixture.a.memory.notify('', null, { targetId: 'b' })
    )
    await expect(emptyMethod).rejects.toThrow('non-empty')
    await expect(emptyMethod).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig,
      name: 'RpcError'
    })
    /** The same public boundary preserves the original non-string rejection. */
    const nonStringMethod = Promise.resolve().then(() =>
      fixture.a.memory.notify(1 as never, null, { targetId: 'b' })
    )
    await expect(nonStringMethod).rejects.toThrow('non-empty')
    await expect(nonStringMethod).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig,
      name: 'RpcError'
    })
    /** This is a real dotted provider call, not the removed helper's string-return shape. */
    await expect(fixture.a.memory.send('b', 'notes.save', 'notes.save')).resolves.toBe('notes.save')
    /** SUP: the current scalar directory must not replace the existing canonical method guard. */
    await expect(
      Promise.resolve().then(() => fixture.a.memory.send('b', 1 as never, null))
    ).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig,
      name: 'RpcError',
      message: expect.stringContaining('non-empty')
    })
    /** SUP: empty scalar names use that same existing current validation owner. */
    await expect(
      Promise.resolve().then(() => fixture.a.memory.send('b', '', null))
    ).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig,
      name: 'RpcError',
      message: expect.stringContaining('non-empty')
    })
  } finally {
    await fixture.close()
  }
})
