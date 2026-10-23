import { describe, it, expect } from 'vitest'
import { parseSparqlResults } from '../src/results.js'
import { parseRdfDocument, writeRdfDocument } from '../src/ntriples.js'
describe('native RDF protocol decoding', () => {
  it('decodes complete SELECT terms, unbound columns and ASK without fabricating identities', () => {
    const rows = parseSparqlResults(
      JSON.stringify({
        head: { vars: ['iri', 'blank', 'plain', 'lang', 'typed', 'unbound'] },
        results: {
          bindings: [
            {
              iri: { type: 'uri', value: 'https://example/é' },
              blank: { type: 'bnode', value: 'local' },
              plain: { type: 'literal', value: 'text' },
              lang: { type: 'literal', value: '你好', 'xml:lang': 'EN' },
              typed: {
                type: 'literal',
                value: '42',
                datatype: 'http://www.w3.org/2001/XMLSchema#integer'
              }
            }
          ]
        }
      }),
      'select'
    )
    expect(rows[0]).toMatchObject({
      iri: { termType: 'NamedNode', value: 'https://example/é' },
      blank: { termType: 'BlankNode' },
      lang: { language: 'en' },
      typed: { datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      unbound: undefined
    })
    expect(parseSparqlResults('{"boolean":false}', 'ask')).toBe(false)
    for (const text of ['{}', 'not json', '{"head":{"vars":[]},"results":{"bindings":[5]}}'])
      expect(() => parseSparqlResults(text, 'select')).toThrow(
        expect.objectContaining({
          source: 'storage.backend.sparql',
          code: 'SPARQL_RESPONSE_INVALID'
        })
      )
  })
  it('uses the real parser/writer for escapes, languages and document-local blank identity', async () => {
    const document = {
      format: 'application/n-triples' as const,
      text: '_:a <https://example/p> "é\\n\\\""@fr .\n_:a <https://example/q> _:b .'
    }
    const first = parseRdfDocument(document),
      second = parseRdfDocument(document)
    expect(first[0]!.object).toMatchObject({ value: 'é\n"', language: 'fr' })
    expect(first[0]!.subject).toEqual(first[1]!.subject)
    expect(first[0]!.subject).not.toEqual(second[0]!.subject)
    expect(
      parseRdfDocument({
        format: document.format,
        text: await writeRdfDocument(first, document.format)
      })
    ).toHaveLength(2)
    expect(() => parseRdfDocument({ format: document.format, text: 'invalid' })).toThrow(
      expect.objectContaining({ code: 'SPARQL_RESPONSE_INVALID' })
    )
  })
})
