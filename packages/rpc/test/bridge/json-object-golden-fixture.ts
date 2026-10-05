import portableVectors from '../../schema/vectors/portable-values.json'
import wireVectors from '../../schema/vectors/envelope.json'
import remoteVectors from '../../schema/vectors/remote-contract.json'
import { objectDeepValue } from './json-object-fixture.js'

/** Fixed-seed cases include key-order, alias, negative-zero, UTF-16 and prototype materialization. */
export function objectGoldenPayload(index: number): unknown[] {
  /** Stable integer mixing changes both graph shape and text lengths without runtime randomness. */
  const seed = Math.imul(index + 0x21c2, 1664525) + 1013904223
  /** Aliasing must be removed independently in both positions after JSON materialization. */
  const shared = { z: [seed >>> 0, -0, null], a: `值-${index}-😀-\ud800` }
  /** A null-prototype input and an own `__proto__` key exercise JSON's plain record reconstruction. */
  const record = Object.create(null) as Record<string, unknown>
  Object.defineProperty(record, '__proto__', { value: { sentinel: index }, enumerable: true })
  record['10'] = index
  record['2'] = false
  record['z'] = shared
  record['a'] = shared
  record['😀'] = `\n\r\t\\"${seed % 997}`
  return [record, shared, [true, false, -0, seed / 7]]
}

/** One legal business exchange keeps positional request args while varying the result's domain. */
export type IObjectGoldenCase = Readonly<{ args: unknown[]; result: unknown; alias?: boolean }>

/** Canonical protocol/remote vectors precede independently seeded graph shapes in the same corpus. */
const canonicalValues: readonly unknown[] = [
  ...portableVectors.cases.map((vector) => vector.value),
  ...wireVectors.valid.map((vector) => vector.value),
  ...remoteVectors.contracts
    .filter((vector) => vector.schemaValid && vector.semanticValid)
    .map((vector) => vector.value)
]

/** Fixed seed varies domains, widths and depths without ambient randomness or unsupported values. */
export function objectGoldenCase(index: number): IObjectGoldenCase {
  if (index < canonicalValues.length)
    return { args: [canonicalValues[index]], result: canonicalValues[index] }
  if (index % 997 === 0) return { args: [], result: null }
  if (index % 991 === 0) return { args: [objectDeepValue(48)], result: objectDeepValue(48) }
  if (index % 983 === 0)
    return {
      args: ['界😀\n\ud800'.repeat(10000)],
      result: '界😀\n\ud800'.repeat(10000)
    }
  if (index % 31 === 0)
    return {
      args: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -0, 0, -1.5],
      result: { minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER, zero: -0 }
    }
  if (index % 17 === 0)
    return { args: objectGoldenPayload(index), result: objectGoldenPayload(index), alias: true }
  /** Per-case xorshift state keeps before/after generation independent of execution order. */
  let state = (index + 0x21c2) >>> 0
  const random = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  /** Graph branching is bounded by current portable depth, never by a new product limit. */
  const make = (depth: number): unknown => {
    const kind = random() % (depth > 0 ? 7 : 5)
    if (kind === 0) return null
    if (kind === 1) return random() % 2 === 0
    if (kind === 2) return ((random() % 1000000) - 500000) / 7
    if (kind === 3)
      return ['😀', '\ud800', '界', '\n\t', '"\\'][random() % 5]!.repeat(random() % 65)
    if (kind === 4) return random() % 2 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER
    if (kind === 5) return Array.from({ length: random() % 5 }, () => make(depth - 1))
    const record: Record<string, unknown> = Object.create(null)
    for (let item = 0, length = random() % 5; item < length; item++)
      Object.defineProperty(record, ['z', '2', '__proto__', 'a', '😀'][item]!, {
        enumerable: true,
        value: make(depth - 1)
      })
    return record
  }
  const value = make(1 + (random() % 6))
  return { args: Array.isArray(value) ? value : [value], result: value }
}
