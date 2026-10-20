import { describe, expect, it } from 'vitest'
import { createRpcDevtools, RpcDevtoolsErrorCode, RPC_DEVTOOLS_SOURCE } from '../../src/index.js'
import { CollectorFixture, collectorView } from './fixture.js'

describe('collector recording', () => {
  it('records three events independently of the main ring and round-trips through the frozen codec', () => {
    /** Main-ring eviction must not evict the active recording's own slots. */
    const devtools = createRpcDevtools({ maxEvents: 1 })
    /** Three recording slots retain this complete window. */
    const recording = devtools.record({ maxEvents: 3 })
    /** The record boundary must retain the original native error graph before encoding. */
    const cause = new TypeError('record cause fixture')
    /** Native primary error and cause are caller-owned references. */
    const original = new Error('record fixture', { cause })
    /** Explicit test identities exercise exact codec preservation rather than its fallback defaults. */
    Object.defineProperties(original, {
      source: { value: CollectorFixture.errorSource, enumerable: true },
      code: { value: CollectorFixture.primaryErrorCode, enumerable: true }
    })
    /** Cause identity is attached to the same native instance without replacing its stack or type. */
    Object.defineProperties(cause, {
      source: { value: CollectorFixture.errorSource, enumerable: true },
      code: { value: CollectorFixture.causeErrorCode, enumerable: true }
    })
    try {
      for (let i = 1; i <= 3; i++) {
        /** Distinct sequence and timestamp identify ordering after codec restoration. */
        const view = collectorView(i)
        if (i === 2) view.error = original
        devtools.emit(view)
      }
      /** Stopping creates one record boundary without borrowing the query retention window. */
      const record = recording.stop()
      expect(record.events.map((event) => event.seq)).toEqual([1, 2, 3])
      expect(devtools.query().events.map((event) => event.seq)).toEqual([3])
      expect(record.events[1]!.error).toBe(original)
      expect((record.events[1]!.error as Error).cause).toBe(cause)
      /** Codec decode revives native errors and preserves the sequence and original stack text. */
      const decoded = devtools.importRecord(devtools.exportRecord(record))
      expect(decoded).toEqual(record)
      expect(decoded.events[1]!.error).toBeInstanceOf(Error)
      expect((decoded.events[1]!.error as Error).cause).toBeInstanceOf(TypeError)
      expect((decoded.events[1]!.error as Error).stack).toBe(original.stack)
      expect(() => recording.stop()).toThrowError(
        expect.objectContaining({
          source: RPC_DEVTOOLS_SOURCE,
          code: RpcDevtoolsErrorCode.recordNotActive
        })
      )
      expect(() => devtools.importRecord('invalid-record')).toThrowError(
        expect.objectContaining({
          source: RPC_DEVTOOLS_SOURCE,
          code: RpcDevtoolsErrorCode.recordFormatInvalid
        })
      )
    } finally {
      devtools.close()
    }
  })

  it('enforces a single recording and discards an active recording on close', () => {
    /** Closing owns the active recording; its handle cannot revive a discarded window. */
    const devtools = createRpcDevtools()
    /** This handle must become unusable after the collector closes. */
    const recording = devtools.record({ maxEvents: 2 })
    expect(() => devtools.record()).toThrowError(
      expect.objectContaining({
        source: RPC_DEVTOOLS_SOURCE,
        code: RpcDevtoolsErrorCode.recordActive
      })
    )
    devtools.emit(collectorView())
    devtools.close()
    expect(() => recording.stop()).toThrowError(
      expect.objectContaining({ source: RPC_DEVTOOLS_SOURCE, code: RpcDevtoolsErrorCode.closed })
    )
    expect(() => devtools.record()).toThrowError(
      expect.objectContaining({ source: RPC_DEVTOOLS_SOURCE, code: RpcDevtoolsErrorCode.closed })
    )
    expect(() => devtools.close()).not.toThrow()
  })
})
