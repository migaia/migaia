/** Only the surviving synchronous preflight fact remains on the current catalog owner. */
import { describe, expect, it, vi } from 'vitest'
import type { IRpcRoute } from '@migaia/rpc-contract/protocol'
import { attachProviderPreflight, readProviderPreflight } from '../../dist/dispatch/catalog.js'
import type { IRpcProviderMethod, IProviderPreflight } from '../../dist/dispatch/types.js'

/** Ordinary fixture metadata remains copyable, so every forgery performs a nonempty Symbol copy. */
const ordinaryMarker = Symbol('ordinary metadata')

/** Keep the owner's real object intact while adding unrelated metadata that callers may observe. */
function withOrdinarySymbol<T extends object>(value: T): T {
  Object.defineProperty(value, ordinaryMarker, { value: 'ordinary fixture metadata' })
  return value
}

/** Enumerate actual own Symbols and transplant their descriptors exactly as an external caller can. */
function copyActualSymbols(source: object, target: object): void {
  /** This copied set includes the private fact on the vulnerable main implementation. */
  const symbols = Object.getOwnPropertySymbols(source)
  expect(symbols.length).toBeGreaterThan(0)
  for (const symbol of symbols)
    Object.defineProperty(target, symbol, Object.getOwnPropertyDescriptor(source, symbol)!)
  expect(Reflect.get(target, ordinaryMarker)).toBe('ordinary fixture metadata')
}

/** One admitted route supplies the exact supported preflight input without legacy route grammar. */
const route: IRpcRoute = {
  applicationVersion: '1',
  senderId: 'symbol-fixture-sender',
  receiverId: 'symbol-fixture-target',
  targetId: 'symbol-fixture-target',
  sentAt: 0
}

describe('Symbol transplantation cannot copy private provider facts', () => {
  it('preserves genuine preflight and canonical retention while rejecting copied policy', () => {
    /** The real synchronous checker is consumed by the unchanged provider executor. */
    const check = vi.fn<IProviderPreflight>(() => undefined)
    /** Callback identity and business completion remain independent of the private policy. */
    const original: IRpcProviderMethod = (_payload, value) =>
      value.success('preflight-business-value')
    /** The existing owner attaches this exact checker to its genuine callback. */
    const genuine = withOrdinarySymbol(attachProviderPreflight(original, check))
    expect(genuine).toBe(original)
    expect(readProviderPreflight(genuine)).toBe(check)
    readProviderPreflight(genuine)!(route)
    expect(check).toHaveBeenCalledExactlyOnceWith(route)
    /** A copied genuine Symbol never attaches that policy to a caller-selected callback. */
    const forged: IRpcProviderMethod = (_payload, value) => value.success()
    copyActualSymbols(genuine, forged)
    expect(readProviderPreflight(forged)).toBeUndefined()
    expect(readProviderPreflight(genuine)).toBe(check)
  })
})
