import { describe, expect, it } from 'vitest'
import {
  term,
  snapshotStorageRdfTerm,
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  encodeStorageRdfQuad,
  type IQuad,
  type IRdfLiteral
} from '../src/index.js'

/** All cases enter the public neutral term/quad owner without a fake RDF backend. */
describe('canonical RDF terms and ground quad identity', () => {
  it('preserves absolute IRI spellings while rejecting invalid IRI-reference syntax', () => {
    for (const value of [
      'http://例え.テスト/名前?q=猫#片',
      'URN:example:a%2Fb',
      'http://[::1]/',
      'http://[::ffff:192.0.2.1]/',
      'http://[2001:db8:0:0:0:0:2:1]/',
      'http://[vF.a:b]/',
      'urn:private?value=\uE000',
      'urn:emoji:😀'
    ])
      expect(term.iri(value)).toEqual({ termType: 'NamedNode', value })
    expect(term.iri('HTTP://EXAMPLE.org:80/a/../b').value).toBe('HTTP://EXAMPLE.org:80/a/../b')
    for (const value of [
      'relative',
      ':name',
      'urn:bad space',
      'urn:bad#two#parts',
      'urn:bad\\path',
      'urn:bad%GG',
      'urn:bad\uD800',
      'urn:bad\uFDD0',
      'http://[nope]/',
      'http://[1:2:3]/',
      'urn:private#\uE000'
    ])
      expect(() => term.iri(value)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })

  it('normalizes literal annotations using well-formed BCP47 without a language registry', () => {
    expect(term.literal('plain')).toEqual({
      termType: 'Literal',
      value: 'plain',
      datatype: 'http://www.w3.org/2001/XMLSchema#string'
    })
    for (const language of [
      'EN-us',
      'zh-Hant-TW',
      'de-CH-1901',
      'en-US-u-ca-gregory',
      'i-klingon',
      'x-Foo-Foo'
    ])
      expect(term.literal('text', { language }).language).toBe(language.toLowerCase())
    for (const language of [
      '',
      'en_US',
      'en--US',
      '123',
      'en-u',
      'sl-rozaj-rozaj',
      'en-u-ca-gregory-u-nu-latn'
    ])
      expect(() => term.literal('text', { language })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() =>
      term.literal('text', { datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() =>
      term.literal('text', { language: 'en', datatype: 'urn:type' } as never)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const datatype of [null, '', 'relative'])
      expect(() => term.literal('text', { datatype } as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() => term.literal('\uD800')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(Object.isFrozen(term.literal('a\u0000b'))).toBe(true)
    expect(term.blank().value).not.toBe(term.blank().value)
    expect(term.blank('local')).toEqual({ termType: 'BlankNode', value: 'local' })
  })

  it('captures direct structural terms once and rejects non-ground positions before native use', () => {
    /**
     * Direct objects and classes share the same structural fields; no constructor identity is
     * required.
     */
    const reads = { kind: 0, value: 0, datatype: 0, language: 0 }
    const literal: IRdfLiteral = {
      get termType(): IRdfLiteral['termType'] {
        reads.kind++
        return 'Literal'
      },
      get value() {
        reads.value++
        return 'value'
      },
      get datatype() {
        reads.datatype++
        return 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
      },
      get language() {
        reads.language++
        return 'EN'
      }
    }
    const quad: IQuad = {
      subject: term.iri('urn:s'),
      predicate: term.iri('urn:p'),
      object: literal,
      graph: term.defaultGraph
    }
    const captured = snapshotStorageRdfQuad(quad, 'memory')
    expect(reads).toEqual({ kind: 1, value: 1, datatype: 1, language: 1 })
    expect(captured.object).toEqual(term.literal('value', { language: 'en' }))
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.object)).toBe(true)
    expect(snapshotStorageRdfPattern({ subject: term.iri('urn:s') }, undefined)).toEqual({
      subject: term.iri('urn:s')
    })
    for (const position of ['subject', 'predicate', 'object', 'graph'])
      expect(() =>
        snapshotStorageRdfQuad(
          { ...quad, [position]: term.blank('request-local') } as never,
          'memory'
        )
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() =>
      snapshotStorageRdfQuad({ ...quad, subject: term.literal('invalid') } as never, 'memory')
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() =>
      snapshotStorageRdfQuad({ ...quad, graph: undefined } as never, 'memory')
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(snapshotStorageRdfTerm(term.blank('raw'), undefined)).toEqual(term.blank('raw'))
    /** A malformed getter remains reachable through the original error cause. */
    const original = new Error('RDF datatype getter failed')
    expect(() =>
      snapshotStorageRdfTerm(
        {
          termType: 'Literal',
          value: 'x',
          get datatype() {
            throw original
          }
        } as never,
        'memory'
      )
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: original, backend: 'memory' })
    )
  })

  it('encodes normalized quad fields with self-delimiting identities through the original key writer', () => {
    const quad: IQuad = {
      subject: term.iri('urn:s'),
      predicate: term.iri('urn:p'),
      object: term.literal('a:b', { language: 'EN' }),
      graph: term.defaultGraph
    }
    const bytes = encodeStorageRdfQuad(quad, 'memory')
    expect(bytes).toEqual(
      encodeStorageRdfQuad({ ...quad, object: term.literal('a:b', { language: 'en' }) }, 'memory')
    )
    expect(bytes).not.toEqual(
      encodeStorageRdfQuad({ ...quad, object: term.literal('a:b') }, 'memory')
    )
    expect(bytes).not.toEqual(
      encodeStorageRdfQuad({ ...quad, graph: term.iri('urn:default') }, 'memory')
    )
    const first = { ...quad, object: term.literal('a', { datatype: 'urn:b:c' }) }
    const second = { ...quad, object: term.literal('a:urn:b', { datatype: 'urn:c' }) }
    expect(encodeStorageRdfQuad(first, undefined)).not.toEqual(
      encodeStorageRdfQuad(second, undefined)
    )
    bytes.fill(0)
    expect(encodeStorageRdfQuad(quad, 'memory').some((byte) => byte !== 0)).toBe(true)
  })
})
