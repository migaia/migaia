import { describe, expect, it, vi } from 'vitest'
import type { IRpcRouteHeader } from '@migaia/rpc-contract'
import type { IRpcContext, IRpcProvider } from '../../dist/core/typing.js'
import {
  attachProviderBulkAdmission,
  attachProviderPreflight,
  readProviderBulkAdmission,
  readProviderIdentity,
  readProviderInvocation,
  readProviderPreflight,
  readProviderRuntimeOperation,
  readProviderRuntimeRelay,
  readProviderStreamAdmission,
  readRuntimeIdempotencyScope,
  retainProviderInvocation,
  retainProviderPreflight,
  retainRuntimeIdempotencyScope,
  wrapProviderStreamAdmission,
  type IProviderBulkRegistration,
  type IProviderRuntimeRelay
} from '../../dist/core/internal/provider.js'

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

/** The private owner accepts its ordinary context shape; no external registration seam is added. */
function context(): IRpcContext {
  return {
    localEndpointId: 'fixture-local-endpoint',
    data: undefined,
    signal: new AbortController().signal,
    senderId: 'symbol-fixture-sender',
    success: (data) => ({ ok: true, data }),
    failed: (message, code) => ({ ok: false, message, code }),
    dispatchTo: () => undefined
  }
}

/** One complete route record proves identity retention without invoking unrelated wire parsing. */
const route: IRpcRouteHeader = {
  profile: 'migaia.rpc.route',
  type: 'request',
  applicationVersion: '1',
  senderId: 'symbol-fixture-sender',
  targetId: 'symbol-fixture-target',
  sentAt: 0
}

/**
 * These owner-local cases join the forgery suite without exposing any private writer from a public
 * entry.
 */
describe('Symbol transplantation cannot copy private provider facts', () => {
  it('keeps the real principal and scope value while a Symbol copy receives no principal', () => {
    /** The existing private owner mints the genuine callback used by the public scope resource. */
    const original = () => 'existing-scope-value'
    /** A real fact must retain the exact callback and its original business return. */
    const genuine = withOrdinarySymbol(retainRuntimeIdempotencyScope(original, 'verified-parent'))
    expect(genuine).toBe(original)
    expect(genuine()).toBe('existing-scope-value')
    expect(readRuntimeIdempotencyScope(genuine)).toBe('verified-parent')
    /** A different callback may copy every visible field but cannot gain its original principal. */
    const forged = () => 'forged-scope-value'
    copyActualSymbols(genuine, forged)
    expect(readRuntimeIdempotencyScope(forged)).toBeUndefined()
    expect(readRuntimeIdempotencyScope(genuine)).toBe('verified-parent')
  })

  it('retains the real bulk registration while a Symbol copy has no admission or invoke fact', () => {
    /** Native reservation operations are retained by identity rather than serialized or rebuilt. */
    const reservation = { consume: vi.fn(), release: vi.fn() }
    /** The genuine provider retains the ordinary callback's return behavior. */
    const original: IRpcProvider = (value) => value.success('bulk-business-value')
    /** This is the exact registration the original owner attaches to its guarded callback. */
    const registration: IProviderBulkRegistration = {
      admission: { reserveMany: () => reservation },
      invoke: original
    }
    /** The public resource eventually exposes this same callback through endpoint registration. */
    const genuine = withOrdinarySymbol(attachProviderBulkAdmission(original, registration))
    expect(genuine).toBe(original)
    expect(readProviderBulkAdmission(genuine)).toBe(registration)
    expect(registration.invoke(context())).toEqual({ ok: true, data: 'bulk-business-value' })
    expect(registration.admission.reserveMany([])).toBe(reservation)
    /** Copying genuine metadata cannot authorize a new ordinary provider callback. */
    const forged: IRpcProvider = (value) => value.success('forged')
    copyActualSymbols(genuine, forged)
    expect(readProviderBulkAdmission(forged)).toBeUndefined()
    expect(readProviderBulkAdmission(genuine)).toBe(registration)
  })

  it('preserves genuine preflight and canonical retention while rejecting copied policy', () => {
    /** The real synchronous checker is consumed by the unchanged provider executor. */
    const check = vi.fn((_value: IRpcRouteHeader) => undefined)
    /** Callback identity and business completion remain independent of the private policy. */
    const original: IRpcProvider = (value) => value.success('preflight-business-value')
    /** The existing owner attaches this exact checker to its genuine callback. */
    const genuine = withOrdinarySymbol(attachProviderPreflight(original, check))
    expect(genuine).toBe(original)
    expect(readProviderPreflight(genuine)).toBe(check)
    readProviderPreflight(genuine)!(route)
    expect(check).toHaveBeenCalledExactlyOnceWith(route)
    /** Legitimate Core wrapping still retains the same original policy operation. */
    const wrapped: IRpcProvider = (value) => value.success()
    expect(retainProviderPreflight(genuine, wrapped)).toBe(wrapped)
    expect(readProviderPreflight(wrapped)).toBe(check)
    /** A copied genuine Symbol never attaches that policy to a caller-selected callback. */
    const forged: IRpcProvider = (value) => value.success()
    copyActualSymbols(genuine, forged)
    expect(readProviderPreflight(forged)).toBeUndefined()
    expect(readProviderPreflight(genuine)).toBe(check)
  })

  it('preserves the real stream lifetime and its retention while rejecting copied admission', () => {
    /** Producer settlement remains the original resource operation with the same result input. */
    const release = vi.fn((_succeeded: boolean) => undefined)
    /** The existing admission owner starts this exact producer lifetime once. */
    const enter = vi.fn((_value: IRpcContext) => release)
    /** The source has no prior stream policy; the original owner composes this one admission. */
    const source: IRpcProvider = (value) => value.success()
    /** This target is the real callback retained by the original native/drain wrapper. */
    const target: IRpcProvider = (value) => value.success('stream-business-value')
    /** The genuine helper preserves the target callback identity. */
    const genuine = withOrdinarySymbol(wrapProviderStreamAdmission(source, target, enter))
    expect(genuine).toBe(target)
    /** The actual read returns the original composed producer-lifetime operation. */
    const admission = readProviderStreamAdmission(genuine)!
    /** This ordinary context is passed unchanged to the existing producer admission. */
    const input = context()
    admission(input)(true)
    expect(enter).toHaveBeenCalledExactlyOnceWith(input)
    expect(release).toHaveBeenCalledExactlyOnceWith(true)
    /** Core's legitimate policy retention still keeps the exact existing operation. */
    const wrapped: IRpcProvider = (value) => value.success()
    retainProviderPreflight(genuine, wrapped)
    expect(readProviderStreamAdmission(wrapped)).toBe(admission)
    /** Descriptor copying cannot start or finish a private producer on a forged callback. */
    const forged: IRpcProvider = (value) => value.success()
    copyActualSymbols(genuine, forged)
    expect(readProviderStreamAdmission(forged)).toBeUndefined()
    expect(readProviderStreamAdmission(genuine)).toBe(admission)
  })

  it('keeps admitted invocation authority on its exact context and rejects copied context Symbols', () => {
    /** Relay operations represent the original admitted resource and retain exact method identity. */
    const relay: IProviderRuntimeRelay = {
      execute: async () => undefined,
      stream: async function* () {},
      prepareStream: async () => undefined,
      finishStream: async () => undefined
    }
    /** The canonical owner retains route and authenticated key only on this original context. */
    const genuine = withOrdinarySymbol(context())
    retainProviderInvocation(genuine, route, 'verified-peer-key', undefined, relay)
    expect(readProviderInvocation(genuine)).toBe(route)
    expect(readProviderIdentity(genuine)).toBe('verified-peer-key')
    expect(readProviderRuntimeRelay(genuine)).toBe(relay)
    expect(readProviderRuntimeOperation(genuine)).toBeUndefined()
    /** A separate context cannot impersonate the actual admitted operation by field transplantation. */
    const forged = context()
    copyActualSymbols(genuine, forged)
    expect(readProviderInvocation(forged)).toBeUndefined()
    expect(readProviderIdentity(forged)).toBeUndefined()
    expect(readProviderRuntimeRelay(forged)).toBeUndefined()
    expect(readProviderRuntimeOperation(forged)).toBeUndefined()
    expect(readProviderInvocation(genuine)).toBe(route)
    expect(readProviderIdentity(genuine)).toBe('verified-peer-key')
    expect(readProviderRuntimeRelay(genuine)).toBe(relay)
  })
})
