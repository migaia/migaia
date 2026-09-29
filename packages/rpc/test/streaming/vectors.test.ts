import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  measurePortableStreamValue,
  normalizeRpcEnvelope,
  RpcStreamEvent,
  RpcStreamLimit,
  RpcStreamViolation
} from '../../src/contract/index.js'
import { normalizeStreamPayload } from '../../src/contract/v1/stream.js'

/** The new vector owns the one frozen invalid case reclassified in 1.1. */
describe('streaming A13 1.1 vectors', () => {
  it('reclassifies the registered stream kind without editing frozen 1.0 bytes', () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../schema/vectors/stream.json', import.meta.url), 'utf8')
    )
    const frozen = JSON.parse(
      readFileSync(
        new URL('../../schema/vectors/frozen/1.0/envelope.json', import.meta.url),
        'utf8'
      )
    )
    const example = frozen.invalid.find(
      (entry: { id: string }) => entry.id === vectors.envelope.reclassified.id
    )
    expect(example).toBeDefined()
    expect(() => normalizeRpcEnvelope(example.value)).toThrow(
      expect.objectContaining({
        violation: vectors.envelope.reclassified.violation,
        pointer: vectors.envelope.reclassified.pointer
      })
    )
  })

  it('runs portable payload and byte vectors against the reference contract', () => {
    const vectors = JSON.parse(
      readFileSync(new URL('../../schema/vectors/stream.json', import.meta.url), 'utf8')
    )
    const schema = JSON.parse(
      readFileSync(new URL('../../schema/stream.schema.json', import.meta.url), 'utf8')
    )
    expect(schema['x-migaia-limits']).toEqual(RpcStreamLimit)
    expect(schema.properties.event.enum).toEqual(Object.values(RpcStreamEvent))
    expect(schema['x-migaia-violations']).toEqual(Object.values(RpcStreamViolation))
    for (const item of vectors.payload) {
      if (item.valid) expect(normalizeStreamPayload(item.value)).toEqual(item.value)
      else
        expect(() => normalizeStreamPayload(item.value)).toThrow(
          expect.objectContaining({
            code: 'INVALID_STREAM',
            violation: item.violation,
            pointer: item.pointer
          })
        )
    }
    for (const item of vectors.measure)
      expect(measurePortableStreamValue(item.value), item.id).toBe(item.bytes)
    expect(normalizeRpcEnvelope(vectors.envelope.valid).kind).toBe('stream')
  })
})
