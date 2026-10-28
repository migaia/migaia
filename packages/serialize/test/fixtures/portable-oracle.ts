import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import type { ICodecValue } from '../../src/codec.ts'
import { defineJsonCodec } from '../../src/codecs/json.ts'
import { rpcPortableWalker } from './rpc-portable-strategy.ts'

/** Package-owned copy of the RPC portable data; no RPC implementation participates in this oracle. */
type IPortableVectors = {
  cases: { id: string; value: unknown }[]
  invalid: string[]
}

/** Error identity remains observable independently from the native TypeError class. */
export type IPortableFailure = Error & { readonly source?: string; readonly code?: string }

/** Copied values retain the original schema metadata only as fixture provenance. */
export const vectors = JSON.parse(
  readFileSync(new URL('./portable-values.json', import.meta.url), 'utf8')
) as IPortableVectors

/** Existing JSON consumer verifies compatibility through its ordinary public codec boundary. */
export const jsonCodec = defineJsonCodec({ version: 1 })

/** Use the actual format consumer so compatibility assertions do not expose a policy preset. */
export function codecValue(value: unknown): unknown {
  return jsonCodec.decode(jsonCodec.encode(value as ICodecValue))
}

/** Capture one rejection so tests can inspect identity, stack and exact cause references. */
export function captureFailure(action: () => unknown): IPortableFailure {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as IPortableFailure
  }
  return expect.unreachable('portable input must reject')
}

/** Reconstruct non-JSON forbidden cases from the copied RPC case names. */
export function forbiddenValue(id: string): unknown {
  switch (id) {
    case 'Date':
      return new Date(0)
    case 'Map':
      return new Map()
    case 'Set':
      return new Set()
    case 'cycle': {
      /** The repeated edge is an ancestor, unlike accepted shared references. */
      const cycle: Record<string, unknown> = {}
      cycle.self = cycle
      return cycle
    }
    case 'function':
      return () => undefined
    case 'symbol':
      return Symbol('invalid')
    case 'bigint':
      return 1n
    case 'nonfinite':
      return Number.NaN
    case 'malformed-bytes':
      return { $rpc: 'bytes', base64url: 'A' }
    case 'reserved-key-collision':
      return { $rpc: 'reserved', value: 'invalid' }
    default:
      return expect.unreachable('unknown copied portable case: ' + id)
  }
}

/** Root depth is zero; each record edge increments the accepted recursion depth. */
export function nestedValue(depth: number): unknown {
  /** Start with a scalar so the deepest value occupies exactly the requested depth. */
  let value: unknown = null
  for (let index = 0; index < depth; index++) value = { child: value }
  return value
}

/** Bound checks inspect completed output rather than reading the caller graph a second time. */
export function expectByteBound(result: ReturnType<typeof rpcPortableWalker>): void {
  expect(result.byteUpperBound).toBeGreaterThanOrEqual(
    Buffer.byteLength(JSON.stringify(result.value), 'utf8')
  )
}
