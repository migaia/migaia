import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { IRpcDirectory, IRpcMethodSchema } from '@migaia/rpc-contract/protocol'
import { renderPeerDeclaration } from '../../dist/plugins/typegen/render.js'
import { createRpcHost } from '@migaia/rpc-host'
import { typegen } from '@migaia/rpc-host/plugins/typegen'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** Accepted-directory fixtures use the same closed contract shape as real connected peers. */
function directory(
  schemas: Readonly<{
    input?: IRpcMethodSchema
    output?: IRpcMethodSchema
    yield?: IRpcMethodSchema
  }> = {},
  stream = false,
  name = 'peer'
): IRpcDirectory {
  return {
    schemaVersion: 3,
    self: {
      name,
      instanceId: 'peer-instance',
      generation: { kind: 'session', value: 1, providerId: 'peer-instance' }
    },
    nodeId: '0123456789abcdef0123456789abcdef',
    methods: [
      {
        name: 'resize',
        supportedModes: [stream ? 'stream' : 'request'],
        modeSource: 'declared',
        ...schemas
      }
    ]
  }
}

/** Compile the emitted declaration and a real importing consumer using the existing compiler. */
function typecheckGenerated(description: IRpcDirectory, consumer: string): void {
  /** A retained temporary consumer makes a compiler failure independently inspectable. */
  const root = mkdtempSync(join(tmpdir(), 'rpc-host-typegen-'))
  /** Both files are compiler inputs rather than string-only assertions about declaration syntax. */
  const output = renderPeerDeclaration(description)
  writeFileSync(join(root, output.fileName), output.text)
  writeFileSync(join(root, 'consumer.ts'), consumer.replaceAll('$DECLARATION', output.fileName))
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
        lib: ['ES2024', 'ESNext.Disposable']
      },
      files: [output.fileName, 'consumer.ts']
    })
  )
  execFileSync('pnpm', ['exec', 'tsc', '-p', join(root, 'tsconfig.json')], {
    cwd: process.cwd(),
    stdio: 'pipe'
  })
  expect(readFileSync(join(root, output.fileName), 'utf8')).toBe(output.text)
}

describe('peer declaration generation', () => {
  it('maps primitive and union type domains to TypeScript input and result declarations', () => {
    expect(
      renderPeerDeclaration(directory({ input: { type: 'number' }, output: { type: 'string' } }))
        .text
    ).toContain('"resize"(payload: number): Promise<string>')
    for (const [type, expected] of [
      ['null', 'null'],
      ['boolean', 'boolean'],
      ['integer', 'number'],
      ['string', 'string']
    ] as const)
      expect(renderPeerDeclaration(directory({ input: { type } })).text).toContain(
        `payload: ${expected}`
      )
    expect(
      renderPeerDeclaration(directory({ input: { type: ['string', 'null'] } })).text
    ).toContain('payload: (string | null)')
  })

  it('maps object properties and required keys without treating remote keys as identifiers', () => {
    /** A required key need not have its own property schema in the accepted subset. */
    const input: IRpcMethodSchema = {
      type: 'object',
      properties: { size: { type: 'number' }, label: { type: 'string' } },
      required: ['size', 'other']
    }
    const text = renderPeerDeclaration(directory({ input })).text
    expect(text).toContain('"size": number')
    expect(text).toContain('"label"?: string')
    expect(text).toContain('"other": unknown')
    expect(text).toContain('[key: string]: unknown')
  })

  it('maps arrays through the item schema and preserves absent items as unknown', () => {
    expect(
      renderPeerDeclaration(directory({ input: { type: 'array', items: { type: 'number' } } })).text
    ).toContain('payload: Array<number>')
    expect(renderPeerDeclaration(directory({ output: { type: 'array' } })).text).toContain(
      'Promise<Array<unknown>>'
    )
  })

  it('maps enum and const values as escaped literal types including nested JSON data', () => {
    const text = renderPeerDeclaration(
      directory({
        input: { enum: ['one', 'two', null] },
        output: { const: { kind: 'result', values: [1, true] } }
      })
    ).text
    expect(text).toContain('("one" | "two" | null)')
    expect(text).toContain('"kind": "result"')
    expect(text).toContain('"values": [1, true]')
  })

  it('maps anyOf alternatives and combines independent schema constraints', () => {
    const text = renderPeerDeclaration(
      directory({
        input: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        output: { type: 'string', enum: ['accepted'] }
      })
    ).text
    expect(text).toContain('(string | number)')
    expect(text).toMatch(/(?:string & "accepted"|"accepted" & string)/u)
  })

  it('resolves local definitions with safe aliases and supports recursive object references', () => {
    const input: IRpcMethodSchema = {
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      $ref: '#/$defs/node'
    }
    const output = renderPeerDeclaration(directory({ input }))
    expect(output.text).toContain('"next"?: IType')
    typecheckGenerated(
      directory({ input }),
      `import type { IRemoteApi } from './$DECLARATION';
declare const api: IRemoteApi;
api.resize({next: {next: {}}});
`
    )
  })

  it('maps declared stream yields to AsyncIterable rather than Promise', () => {
    const output = renderPeerDeclaration(directory({ yield: { type: 'string' } }, true))
    expect(output.text).toContain('"resize"(payload?: unknown): AsyncIterable<string>')
    expect(output.text).not.toContain('Promise<')
  })

  it('uses optional unknown input and unknown results when schemas are absent', () => {
    const output = renderPeerDeclaration(directory())
    expect(output.text).toContain('"resize"(payload?: unknown): Promise<unknown>')
  })

  it('encodes every peer-name UTF-8 byte into the fixed safe declaration filename', () => {
    const output = renderPeerDeclaration(directory({}, false, '../"\n中'))
    expect(output.fileName).toBe('peer-2e2e2f220ae4b8ad.d.ts')
    expect(output.fileName).toMatch(/^peer-[0-9a-f]+\.d\.ts$/u)
  })

  it('typechecks generated consumers and prevents peer, property, definition and literal injection', () => {
    /** Every adversarial string remains inert declaration data after escaping. */
    const sentinel = '";\ndeclare const injected: never;\n//'
    const key = `field${sentinel}`
    const input: IRpcMethodSchema = {
      type: 'object',
      properties: {
        [key]: {
          anyOf: [
            { enum: [sentinel, 'safe'] },
            { $ref: `#/$defs/${sentinel.replace(/~/gu, '~0').replace(/\//gu, '~1')}` }
          ]
        }
      },
      required: [key],
      $defs: { [sentinel]: { const: sentinel } }
    }
    typecheckGenerated(
      directory({ input, output: { type: 'string' } }, false, sentinel),
      `
import type { IRemoteApi, IRemotePeers } from './$DECLARATION';
declare const api: IRemoteApi;
const result: Promise<string> = api.resize({${JSON.stringify(key)}: ${JSON.stringify(sentinel)}});
type IApi = IRemotePeers[${JSON.stringify(sentinel)}];
const same: IApi = api;
// @ts-expect-error Remote strings cannot declare this identifier in the consumer scope.
injected;
// @ts-expect-error The declared literal rejects an unrelated value.
api.resize({${JSON.stringify(key)}: 'not-declared'});
void result; void same;
`
    )
  })

  it('writes accepted schema directories again on replacement and reports output failures without breaking calls', async () => {
    const writes: [string, string][] = []
    const reports: unknown[] = []
    const failure = new Error('output unavailable')
    let rejectWrite = false
    const feature = typegen({
      out: {
        write(fileName, text) {
          writes.push([fileName, text])
          if (rejectWrite) return Promise.reject(failure)
        }
      }
    })
    expect(writes).toEqual([])
    const server = coreMemoryServer('server')
    const host = await createRpcHost({
      ...server.options,
      plugins: [feature, server.transport],
      report: (error) => reports.push(error)
    })
    const first = await server.connect(
      'peer',
      {
        provide: { api: { resize: (value: number) => String(value) } },
        contract: {
          schemaVersion: 1,
          plugin: 'api',
          features: {
            shape: {
              methods: {
                resize: {
                  mode: 'request',
                  idempotent: false,
                  input: { type: 'number' },
                  output: { type: 'string' }
                }
              }
            }
          }
        }
      },
      'peer-first'
    )
    try {
      expect(writes).toHaveLength(1)
      expect(writes[0]![1]).toContain('"api.resize"(payload: number): Promise<string>')
      expect(await host.memory.request('api.resize', 42)).toBe('42')
      await first.host.close()
      const second = await server.connect(
        'peer',
        { provide: { changed: () => true } },
        'peer-second'
      )
      try {
        expect(writes).toHaveLength(2)
        expect(writes[1]![0]).toBe(writes[0]![0])
        expect(writes[1]![1]).toContain('"changed"(payload?: unknown): Promise<unknown>')
        rejectWrite = true
        const third = await server.connect('other', { provide: { alive: () => 7 } })
        try {
          await expect.poll(() => reports.includes(failure)).toBe(true)
          expect(await host.memory.send('other', 'alive')).toBe(7)
        } finally {
          await third.host.close()
        }
      } finally {
        await second.host.close()
      }
    } finally {
      await first.host.close()
      await host.close()
    }
    expect(writes).toHaveLength(3)
  })
})
