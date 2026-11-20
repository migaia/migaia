import { describe, expect, it } from 'vitest'
import { currentRemoteModules } from '../src/index.ts'
import { answer, blueprint, memoryCache, remoteHost, snapshotText } from './support.ts'

/** Snapshot text of a tag with the two blueprints `a` and `b`. */
function twoBlueprints(tag: string, a: unknown, b: unknown, definitions = ['button@1']): string {
  return snapshotText({ tag, blueprints: [a as { id: string }, b as { id: string }], definitions })
}

describe('delivery and install checks', () => {
  it('rejects a version with a missing capability or a failing blueprint and restores the host', async () => {
    /** Cache backend. */
    const cache = await memoryCache()
    /** V1 text. */
    const v1 = twoBlueprints('v1', blueprint('a', 'a1'), blueprint('b', 'b1'))
    await answer('stage', { snapshot: v1 })
    /** Host under test. */
    const harness = await remoteHost({ cache, env: 'stage' })
    await harness.remote.ready()
    harness.host.mount({}, 'a')
    harness.host.mount({}, 'b')
    /** Remote module set before the rejections. */
    const modules = currentRemoteModules(harness.host)

    await answer('stage', {
      snapshot: twoBlueprints('v3', blueprint('a', 'a3'), blueprint('b', 'b3'), [
        'button@1',
        'missing@1'
      ])
    })
    await expect(harness.remote.revalidate()).rejects.toMatchObject({
      code: 'REMOTE_VERSION_REJECTED',
      tag: 'v3',
      missing: ['missing@1']
    })

    await answer('stage', {
      snapshot: twoBlueprints(
        'v4',
        blueprint('a', 'a4'),
        blueprint('b', 'b4', { click: 'nothing@1' })
      )
    })
    await expect(harness.remote.revalidate()).rejects.toMatchObject({
      code: 'REMOTE_VERSION_REJECTED',
      tag: 'v4'
    })
    // A version binding a namespace the client does not register is refused before install.
    await answer('stage', {
      snapshot: twoBlueprints('v5', blueprint('a', { $state: 'cart.total' }), blueprint('b', 'b5'))
    })
    /** Rejection of the version binding `cart`. */
    const storeRejection = (await harness.remote.revalidate().catch((error: unknown) => error)) as {
      readonly code?: unknown
      readonly missing?: unknown
      readonly missingStores?: unknown
      readonly cause?: { readonly message?: string }
    }
    expect(storeRejection).toMatchObject({
      code: 'REMOTE_VERSION_REJECTED',
      tag: 'v5',
      missing: [],
      missingStores: ['cart']
    })
    expect(storeRejection.cause?.message).toContain('cart')
    expect(harness.screen.label('a')).toBe('a1')
    expect(harness.screen.label('b')).toBe('b1')
    expect(currentRemoteModules(harness.host)).toEqual(modules)
    expect(harness.remote.current()?.tag).toBe('v1')
    expect(
      new TextDecoder().decode((await cache.getBytes('part-remote:orders:stage')) ?? undefined)
    ).toBe(v1)
    await harness.host.dispose()
  })
})

/** Promise with its resolver, used to hold a chunk loader open. */
class Gate {
  /** Resolver of the promise. */
  open: () => void = () => undefined
  /** Promise the loader returns. */
  readonly promise = new Promise<void>((resolve) => {
    this.open = resolve
  })
}

describe('chunk preload', () => {
  it('loads only referenced chunks before any blueprint update and rejects when one fails', async () => {
    /** Loader calls. */
    const calls: string[] = []
    /** Gate of the button chunk. */
    const gate = new Gate()
    await answer('chunks', {
      snapshot: snapshotText({
        tag: 'c1',
        blueprints: [blueprint('orders', 'c1')],
        definitions: ['button@1']
      })
    })
    /** Host under test. */
    const harness = await remoteHost({
      cache: await memoryCache(),
      env: 'chunks',
      chunks: {
        'button@1': () => {
          calls.push('button@1')
          return gate.promise
        },
        'other@1': () => {
          calls.push('other@1')
          return Promise.resolve()
        }
      }
    })
    await expect.poll(() => calls).toEqual(['button@1'])
    await expect(harness.host.blueprint.patch('orders', [])).rejects.toMatchObject({
      code: 'BLUEPRINT_UNKNOWN'
    })
    gate.open()
    await harness.remote.ready()
    harness.host.mount({}, 'orders')
    expect(harness.screen.label('orders')).toBe('c1')
    expect(calls).toEqual(['button@1'])
    await harness.host.dispose()

    /** Host whose chunk loader fails. */
    const failing = await remoteHost({
      cache: await memoryCache(),
      env: 'chunks',
      chunks: { 'button@1': () => Promise.reject(new RangeError('chunk')) }
    })
    await expect(failing.remote.ready()).rejects.toMatchObject({
      code: 'REMOTE_VERSION_REJECTED',
      cause: expect.any(RangeError)
    })
    await failing.host.dispose()
  })
})
