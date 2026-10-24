import { describe, expect, it } from 'vitest'
import {
  term,
  snapshotStorageRdfTerm,
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  encodeStorageRdfQuad,
  encodeStorageRdfTerm
} from '../src/authoring/rdf.js'
import {
  assertStorageRdfTerm,
  assertStorageRdfPattern,
  assertStorageRdfQuad,
  type IQuad,
  type IRdfLiteral
} from '@migaia/storage-contract'

describe('native RDF term index identity', () => {
  it('reuses canonical raw term admission and self-delimiting identity without changing blank scope', () => {
    const values = [term.iri('urn:a'), term.blank('a'), term.literal('a'), term.defaultGraph]
    const encoded = values.map((value) => encodeStorageRdfTerm(value, 'memory'))
    expect(new Set(encoded.map((value) => value.join(','))).size).toBe(values.length)
    expect(encodeStorageRdfTerm(term.literal('a', { language: 'EN' }), undefined)).toEqual(
      encodeStorageRdfTerm(term.literal('a', { language: 'en' }), undefined)
    )
    expect(encodeStorageRdfTerm(term.literal('a', { datatype: 'urn:b:c' }), undefined)).not.toEqual(
      encodeStorageRdfTerm(term.literal('a:urn:b', { datatype: 'urn:c' }), undefined)
    )
    encoded[0]!.fill(0)
    expect(encodeStorageRdfTerm(values[0]!, 'memory').some((value) => value !== 0)).toBe(true)
  })

  it('keeps legal literal bytes outside the public binary-key size budget', () => {
    const value = term.literal('x'.repeat(1_048_577))
    expect(encodeStorageRdfTerm(value, undefined).byteLength).toBeGreaterThan(1_048_576)
  })
})

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
      'x-Foo-Foo',
      'sl-ROZAJ-rozaj',
      'en-U-ca-gregory-u-nu-latn'
    ])
      expect(term.literal('text', { language }).language).toBe(language.toLowerCase())
    for (const language of ['', 'en_US', 'en--US', '123', 'en-u'])
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
    expect(term.blank().value).not.toBe(term.blank().value)
    expect(term.blank('local')).toEqual({ termType: 'BlankNode', value: 'local' })
  })

  it('captures direct structural terms and rejects non-ground positions before native use', () => {
    /**
     * Direct objects and classes share the same structural fields; no constructor identity is
     * required.
     */
    const literal: IRdfLiteral = {
      termType: 'Literal',
      value: 'value',
      datatype: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',
      language: 'EN'
    }
    const quad: IQuad = {
      subject: term.iri('urn:s'),
      predicate: term.iri('urn:p'),
      object: literal,
      graph: term.defaultGraph
    }
    const captured = snapshotStorageRdfQuad(quad, 'memory')
    expect(captured.object).toEqual(term.literal('value', { language: 'en' }))
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
    // Native terminals validate the admitted structure without replacing or normalizing its fields.
    expect(() => assertStorageRdfTerm(literal, 'memory')).not.toThrow()
    expect(() => assertStorageRdfPattern({ object: literal }, 'memory')).not.toThrow()
    expect(() => assertStorageRdfQuad(quad, 'memory')).not.toThrow()
    expect(quad.object).toBe(literal)
    expect(literal.language).toBe('EN')
    expect(captured.object).not.toBe(literal)
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
