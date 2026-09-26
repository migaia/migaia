import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import { RpcPlatform } from '../../src/core/transport-constants.js'
import type { IRpcTransport } from '../../src/core/transport.js'

/** All core source files, excluding declaration output. */
const coreRoot = join(import.meta.dirname, '../../src/core')

/** Walks source roots so platform string literals cannot hide in nested files. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/** Protocol platform labels whose only declaration must be transport-constants.ts. */
const labels = new Set([
  'BroadcastChannel',
  'Iframe',
  'Memory',
  'MessagePort',
  'RTCDataChannel',
  'WebTransport',
  'Worker'
])

describe('platform constant ownership', () => {
  it('A8 keeps all seven platform literals in transport-constants alone', () => {
    const owners = new Map<string, Set<string>>()
    for (const path of sources(coreRoot)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) && labels.has(node.text)) {
          const paths = owners.get(node.text) ?? new Set<string>()
          paths.add(path.replace(`${coreRoot}/`, ''))
          owners.set(node.text, paths)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    for (const label of labels)
      expect([...new Set(owners.get(label))], label).toEqual(['transport-constants.ts'])
    expect(readFileSync(join(coreRoot, 'protocol-constants.ts'), 'utf8')).not.toMatch(
      /(?:Platform|platform).*?(?:BroadcastChannel|Iframe|Memory|MessagePort|RTCDataChannel|WebTransport|Worker)/u
    )
    for (const path of ['endpoint-kernel.ts', 'internal/endpoint-bootstrap.ts']) {
      const content = readFileSync(join(coreRoot, path), 'utf8')
      expect(content, path).toContain('Object.values(RpcPlatform)')
    }
  })

  it('A8 accepts every declared platform and rejects an undeclared one', async () => {
    for (const platform of Object.values(RpcPlatform)) {
      const transport: IRpcTransport = {
        platform,
        send() {},
        subscribe() {
          return () => undefined
        }
      }
      const endpoint = await createEndpoint({
        id: `platform-${platform}`,
        transport,
        middlewares: [connect({ transport })]
      })
      await endpoint.dispose()
    }
    const invalid = {
      platform: 'Stdio',
      send() {},
      subscribe() {
        return () => undefined
      }
    } as unknown as IRpcTransport
    await expect(
      createEndpoint({
        id: 'invalid-platform',
        transport: invalid,
        middlewares: [connect({ transport: invalid })]
      })
    ).rejects.toBeDefined()
  })
})
