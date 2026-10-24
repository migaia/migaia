import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/** Runtime exports must resolve from built files as an ordinary ESM consumer sees them. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Traverse static imports only; adapter loading is forbidden in the neutral threads entry. */
function importClosure(file: string, visited = new Set<string>()): string[] {
  if (visited.has(file)) return []
  visited.add(file)
  return parseSync(file, readFileSync(file, 'utf8')).program.body.flatMap((statement) => {
    const specifier =
      statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration'
        ? statement.source.value
        : statement.type === 'ExportNamedDeclaration'
          ? statement.source?.value
          : undefined
    if (specifier === undefined) return []
    if (!specifier.startsWith('.')) return [specifier]
    const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))
    return [target, ...importClosure(target, visited)]
  })
}

describe('threads public exports', () => {
  it('removes all three directional thread factories from the built namespace', async () => {
    /** Ordinary packed-subpath resolution must not retain aliases after the consumer migration. */
    const runtime = await import('@migaia/rpc-plugin-thread')
    expect(Object.keys(runtime).sort()).toEqual(
      ['RPC_THREAD_ERROR_SOURCE', 'RpcThreadErrorCode', 'isThreadChild', 'threadPlugin'].sort()
    )
    for (const name of [
      'createThreadHost',
      'createServeThreadHost',
      'createServeThreadPlugin',
      'createThreadPeer',
      'createThreadPlugin',
      'createNodeThreadChannel',
      'createWebThreadChannel',
      'receiveThreadData',
      'readThreadBootstrap',
      'AdapterNodeThreadParentChannel',
      'createAdapterNodeThreadLauncher',
      'createAdapterNodeThreadPeer',
      'createWebThreadLauncher',
      'createWebThreadChannelFactory'
    ])
      expect(Object.hasOwn(runtime, name), 'retired thread factory must be absent').toBe(false)
    expect(runtime.threadPlugin).toBeTypeOf('function')
    expect(runtime.isThreadChild).toBeTypeOf('function')
  })
  it('exports canonical factories through existing public foundations without platform root imports', async () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const base = JSON.parse(
      readFileSync(resolve(root, 'test/threads/fixtures/base-manifest.json'), 'utf8')
    )
    expect(manifest.dependencies).toEqual({
      '@migaia/supervision': base.dependencies['@migaia/supervision'],
      '@migaia/utils': 'workspace:^',
      '@migaia/lifecycle': 'workspace:^'
    })
    /** Source peers use the workspace protocol; pnpm pack writes the exact lockstep version. */
    expect(manifest.peerDependencies).toEqual({
      '@migaia/rpc-contract': 'workspace:*',
      '@migaia/rpc-host': 'workspace:*',
      electron: base.peerDependencies.electron
    })
    expect(manifest.peerDependenciesMeta.electron.optional).toBe(true)
    for (const peer of ['@migaia/rpc-contract', '@migaia/rpc-host'])
      expect(manifest.peerDependenciesMeta[peer]?.optional ?? false).toBe(false)
    expect(manifest.exports['.']).toBeDefined()
    expect(manifest.exports['./threads']).toBeUndefined()
    expect(manifest.exports['./threads/adapters/*']).toBeUndefined()
    for (const platform of ['deno', 'bun', 'electron-renderer', 'browser'])
      expect(manifest.exports[`./adapters/${platform}`]).toBeUndefined()
    expect(Object.keys(manifest.exports)).toEqual(['.'])
    const exported = manifest.exports['.']
    expect(existsSync(resolve(root, exported.types))).toBe(true)
    const runtime = await import(pathToFileURL(resolve(root, exported.default)).href)
    expect(Object.keys(runtime).length).toBeGreaterThan(0)
    const imports = importClosure(resolve(root, 'src/threads/index.ts'))
    expect(imports.filter((item) => /threads\/adapters\/|^(?:node:|electron$)/.test(item))).toEqual(
      []
    )
  })
})
