import { describe, expect, it } from 'vitest'
import {
  assertOperationContext,
  RdfTermType,
  RdfDatatype,
  type IOperationContext,
  type IStorageKey
} from '@migaia/storage-contract'
import { snapshotOperationContext } from '../src/authoring/context.ts'
import {
  prefixStorageOrgKey,
  encodeStorageOrgStringPrefix,
  encodeOrderedStorageKey,
  unprefixStorageOrgKey
} from '../src/authoring/key.ts'
import {
  getStorageOrgGraphPrefix,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph,
  term
} from '../src/authoring/rdf.ts'

/** The reserved default remains a valid canonical identity without forcing it into omitted contexts. */
const zeroOrg = '00000000-0000-0000-0000-000000000000'
/** Two ordinary caller identities exercise exact cross-organization isolation. */
const firstOrg = '12345678-1234-1234-1234-123456789abc'
/** This differs only in its final identity digit so prefix matching cannot substitute for equality. */
const secondOrg = '12345678-1234-1234-1234-123456789abd'

describe('organization RDF graph mapping', () => {
  it('maps default and exact named graphs to disjoint native identities for every organization', () => {
    for (const orgId of [zeroOrg, firstOrg, secondOrg]) {
      const prefix = getStorageOrgGraphPrefix(orgId)
      const physicalDefault = prefixStorageOrgGraph(orgId, term.defaultGraph)
      expect(prefix).toBe(`urn:migaia:org:${orgId}:`)
      expect(physicalDefault).toEqual(term.iri(prefix + 'd'))
      expect(unprefixStorageOrgGraph(orgId, physicalDefault)).toBe(term.defaultGraph)
      for (const iri of [
        'urn:graph',
        prefix + 'd',
        'https://[2001:db8::1]/a?b=%aB#c',
        'https://例子.测试/图?值=😀#片段',
        "urn:graph:!$&'()*+,;=:@/?x=%2F#y"
      ]) {
        const logical = term.iri(iri)
        const physical = prefixStorageOrgGraph(orgId, logical)
        expect(physical.value).toBe(prefix + 'n:' + encodeURIComponent(iri))
        expect(physical).not.toEqual(physicalDefault)
        expect(unprefixStorageOrgGraph(orgId, physical)).toEqual(logical)
      }
    }
    expect(RdfTermType.namedNode).toBe('NamedNode')
    expect(RdfDatatype.string).toBe('http://www.w3.org/2001/XMLSchema#string')
    expect(() =>
      unprefixStorageOrgGraph(secondOrg, prefixStorageOrgGraph(firstOrg, term.defaultGraph))
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('rejects foreign or noncanonical envelopes and invalid ground graph terms', () => {
    const prefix = getStorageOrgGraphPrefix(firstOrg)
    for (const suffix of ['', 'd:extra', 'n:', 'n:relative', 'n:urn%3agraph', 'n:%C0%AF'])
      expect(() => unprefixStorageOrgGraph(firstOrg, term.iri(prefix + suffix))).toThrowError(
        expect.objectContaining({ source: 'storage.contract', code: 'INVALID_ARGUMENT' })
      )
    for (const graph of [term.blank('raw'), term.literal('literal'), undefined]) {
      expect(() => prefixStorageOrgGraph(firstOrg, graph as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
      expect(() => unprefixStorageOrgGraph(firstOrg, graph as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    }
    expect(() => unprefixStorageOrgGraph(firstOrg, term.defaultGraph as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => getStorageOrgGraphPrefix(firstOrg.toUpperCase())).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })
})

describe('canonical organization identity', () => {
  it('admits the zero and lowercase UUID forms through the original context boundary', () => {
    for (const orgId of [zeroOrg, firstOrg, secondOrg]) {
      expect(() => assertOperationContext({ orgId })).not.toThrow()
      expect(snapshotOperationContext({ orgId })?.orgId).toBe(orgId)
    }
    expect(snapshotOperationContext(undefined)).toBeUndefined()
    expect(Object.hasOwn(snapshotOperationContext({})!, 'orgId')).toBe(false)
    expect(Object.hasOwn(snapshotOperationContext({ orgId: undefined })!, 'orgId')).toBe(false)
  })

  it.each([
    '',
    'default',
    firstOrg.toUpperCase(),
    firstOrg.replaceAll('-', ''),
    firstOrg + ' ',
    firstOrg + '\n',
    ' ' + firstOrg,
    firstOrg.slice(1),
    firstOrg.replace('a', 'g'),
    1,
    null
  ])('rejects noncanonical organization identity %# before key work', (orgId) => {
    expect(() => assertOperationContext({ orgId } as IOperationContext)).toThrowError(
      expect.objectContaining({ source: 'storage.contract', code: 'INVALID_ARGUMENT' })
    )
    expect(() => prefixStorageOrgKey(orgId as string, 'key')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => unprefixStorageOrgKey(orgId as string, ['$o', firstOrg, 'key'])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('captures organization and preserves the original live cancellation signal', () => {
    /** Caller mutation after admission cannot move accepted work into another organization. */
    const controller = new AbortController()
    /** Scalar options are retained before backend execution awaits. */
    const input = {
      signal: controller.signal,
      timeoutMs: 0,
      pageSize: 1,
      conflictPolicy: 'replace' as const,
      orgId: firstOrg
    }
    /** The snapshot retains organization choice while the signal remains live. */
    const captured = snapshotOperationContext(input)!
    input.orgId = secondOrg
    expect(captured.orgId).toBe(firstOrg)
    expect(captured.signal).toBe(controller.signal)
  })
})

describe('organization key segments', () => {
  it('encodes content prefixes only inside the exact original organization string envelope', () => {
    for (const prefix of ['', 'user/', 'a\uD800', '😀']) {
      const encoded = encodeStorageOrgStringPrefix(firstOrg, prefix, 'memory')
      const own = encodeOrderedStorageKey(prefixStorageOrgKey(firstOrg, prefix + 'tail'), 'memory')
      const other = encodeOrderedStorageKey(
        prefixStorageOrgKey(secondOrg, prefix + 'tail'),
        'memory'
      )
      const tuple = encodeOrderedStorageKey(
        prefixStorageOrgKey(firstOrg, [prefix + 'tail']),
        'memory'
      )
      expect(own.slice(0, encoded.length)).toEqual(encoded)
      expect(other.slice(0, encoded.length)).not.toEqual(encoded)
      expect(tuple.slice(0, encoded.length)).not.toEqual(encoded)
      expect(encoded).toEqual(
        encodeOrderedStorageKey(prefixStorageOrgKey(firstOrg, prefix), 'memory').slice(0, -2)
      )
    }
    expect(() => encodeStorageOrgStringPrefix('bad', '', 'memory')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => encodeStorageOrgStringPrefix(firstOrg, 1 as never, 'memory')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('keeps an exact three-part envelope and preserves scalar versus tuple logical identity', () => {
    expect(prefixStorageOrgKey(firstOrg, 'key')).toEqual(['$o', firstOrg, 'key'])
    expect(prefixStorageOrgKey(firstOrg, ['key'])).toEqual(['$o', firstOrg, ['key']])
    expect(unprefixStorageOrgKey(firstOrg, prefixStorageOrgKey(firstOrg, 'key'))).toBe('key')
    expect(unprefixStorageOrgKey(firstOrg, prefixStorageOrgKey(firstOrg, ['key']))).toEqual(['key'])
    expect(prefixStorageOrgKey(firstOrg, 'key')).not.toEqual(prefixStorageOrgKey(secondOrg, 'key'))
    expect(() =>
      unprefixStorageOrgKey(secondOrg, prefixStorageOrgKey(firstOrg, 'key'))
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('returns independently owned key components at both wrapping and unwrapping', () => {
    const date = new Date(1)
    const bytes = new Uint8Array([1, 2])
    const logical: IStorageKey[] = [date, bytes.buffer]
    const physical = prefixStorageOrgKey(zeroOrg, logical)
    date.setTime(2)
    bytes.fill(7)
    logical.push('later')
    const restored = unprefixStorageOrgKey(zeroOrg, physical) as readonly [Date, ArrayBuffer]
    expect(restored).toEqual([new Date(1), new Uint8Array([1, 2]).buffer])
    restored[0].setTime(50)
    new Uint8Array(restored[1]).fill(99)
    expect(unprefixStorageOrgKey(zeroOrg, physical)).toEqual([
      new Date(1),
      new Uint8Array([1, 2]).buffer
    ])
  })

  it('accepts maximum legal logical depth and node count without validating the internal envelope as a logical key', () => {
    /** Root depth zero permits a leaf at depth thirty-two. */
    let deep: IStorageKey = 'leaf'
    for (let index = 0; index < 32; index += 1) deep = [deep]
    /** One root plus 4095 scalar children exactly fills the logical node budget. */
    const wide: IStorageKey = Array.from({ length: 4095 }, (_, index) => index)
    for (const logical of [deep, wide])
      expect(unprefixStorageOrgKey(firstOrg, prefixStorageOrgKey(firstOrg, logical))).toEqual(
        logical
      )
  })

  it.each([
    'key',
    [],
    ['$o', firstOrg],
    ['$o', firstOrg, 'key', 'extra'],
    ['$other', firstOrg, 'key'],
    ['$o', secondOrg, 'key']
  ])('rejects malformed or cross-org key envelopes %#', (physical) => {
    expect(() => unprefixStorageOrgKey(firstOrg, physical)).toThrowError(
      expect.objectContaining({ source: 'storage.contract', code: 'INVALID_ARGUMENT' })
    )
  })

  it('preserves malformed key domains under their actual owners', () => {
    expect(() => prefixStorageOrgKey(firstOrg, {} as IStorageKey)).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
    expect(() => unprefixStorageOrgKey(firstOrg, ['$o', firstOrg, []])).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
  })
})
