import { createServer } from 'node:http'
import { describe, it, expect } from 'vitest'
import { Store } from 'oxigraph'
import { term } from '@migaia/storage-host/authoring/rdf'
import { httpEndpoint } from '../src/http.js'
import { oxigraphEndpoint } from '../src/oxigraph.js'
describe('native endpoint adapters', () => {
  it('runs actual Oxigraph query/update and atomic graph replacement without owning the store', async () => {
    const native = new Store(),
      endpoint = oxigraphEndpoint(native),
      target = { graph: term.iri('https://example/g?x=é') }
    const document = {
      format: 'text/turtle' as const,
      text: '@prefix ex:<https://example/> . _:a ex:p "bonjour"@fr . _:a ex:q _:b .'
    }
    await endpoint.graphStore!.put(target, document)
    expect(await endpoint.graphStore!.has(target)).toBe(true)
    expect(await endpoint.graphStore!.get(target, 'application/n-triples')).toContain('bonjour')
    await endpoint.graphStore!.put(target, {
      format: 'application/n-triples',
      text: '<https://example/a> <https://example/p> "replacement" .'
    })
    const text = await endpoint.graphStore!.get(target, 'text/turtle')
    expect(text).toContain('replacement')
    expect(text).not.toContain('bonjour')
    await expect(
      endpoint.atomicUpdate!(
        'INSERT DATA {<https://example/b> <https://example/p> "atomic"}; BROKEN'
      )
    ).rejects.toMatchObject({ code: 'SPARQL_REQUEST_FAILED' })
    expect(native.query('ASK {<https://example/b> ?p ?o}')).toBe(false)
    await endpoint.graphStore!.remove(target)
    expect(await endpoint.graphStore!.has(target)).toBe(false)
    expect(await endpoint.query('ASK {}', 'application/sparql-results+json')).toContain('true')
    const malformed = oxigraphEndpoint(Object.assign(new Store(), { query: () => true }))
    await expect(
      malformed.query('ASK {}', 'application/sparql-results+json')
    ).rejects.toMatchObject({ code: 'SPARQL_RESPONSE_INVALID' })
  })
  it('uses actual fetch protocol, encoded targets and precise response/commit errors', async () => {
    const seen: { method: string; url: string; auth: string | undefined; body: string }[] = []
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      seen.push({
        method: request.method!,
        url: request.url!,
        auth: request.headers.authorization,
        body
      })
      if (request.url?.startsWith('/redirect')) {
        response.writeHead(307, { Location: '/destination' })
        response.end('native redirect')
        return
      }
      if (request.url?.startsWith('/failed')) {
        response.writeHead(503)
        response.end('native server detail')
        return
      }
      if (request.url?.includes('missing')) {
        response.writeHead(404)
        response.end('missing graph')
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/sparql-results+json' })
      response.end('{"boolean":true}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number },
      origin = `http://127.0.0.1:${address.port}`
    try {
      const endpoint = httpEndpoint({
        queryUrl: origin + '/query',
        updateUrl: origin + '/update',
        graphStoreUrl: origin + '/graphs',
        auth: { basic: { user: 'fixture', password: 'private' } }
      })
      expect(endpoint.atomicUpdate).toBeUndefined()
      expect(await endpoint.query('ASK {}', 'application/sparql-results+json')).toContain('true')
      let formats = 0
      await endpoint.graphStore!.put(
        { graph: term.iri('https://example/g?x=é&y=1') },
        {
          get format() {
            formats++
            return 'text/turtle' as const
          },
          text: '<https://a> <https://p> "x" .'
        }
      )
      expect(formats).toBe(1)
      expect(new URL(seen[1]!.url, origin).searchParams.get('graph')).toBe(
        'https://example/g?x=é&y=1'
      )
      expect(seen[0]!.auth).toBe('Basic Zml4dHVyZTpwcml2YXRl')
      expect(await endpoint.graphStore!.has({ graph: term.iri('https://example/missing') })).toBe(
        false
      )
      await expect(
        endpoint.graphStore!.get({ graph: term.iri('https://example/missing') }, 'text/turtle')
      ).rejects.toMatchObject({
        code: 'SPARQL_REQUEST_FAILED',
        cause: { status: 404, body: 'missing graph' }
      })
      const failure = httpEndpoint({ queryUrl: origin + '/failed', updateUrl: origin + '/failed' })
      await expect(
        failure.query('ASK {}', 'application/sparql-results+json')
      ).rejects.toMatchObject({
        code: 'SPARQL_UNAVAILABLE',
        cause: { status: 503, body: 'native server detail' }
      })
      await expect(failure.update('INSERT DATA {}')).rejects.toMatchObject({
        code: 'SPARQL_COMMIT_UNKNOWN'
      })
      let users = 0,
        passwords = 0
      const redirected = httpEndpoint({
        queryUrl: origin + '/redirect',
        updateUrl: origin + '/redirect',
        auth: {
          basic: {
            get user() {
              users++
              return 'fixture'
            },
            get password() {
              passwords++
              return 'private'
            }
          }
        }
      })
      expect([users, passwords]).toEqual([1, 1])
      await expect(redirected.update('INSERT DATA {}')).rejects.toMatchObject({
        code: 'SPARQL_REQUEST_FAILED',
        cause: { status: 307, body: 'native redirect' }
      })
      expect(seen.filter((item) => item.url === '/destination')).toHaveLength(0)
      expect(await redirected.query('ASK {}', 'application/sparql-results+json')).toContain('true')
      expect(seen.filter((item) => item.url === '/destination')).toHaveLength(1)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
