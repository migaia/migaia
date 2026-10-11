import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import familyConfig from '../../vitest.family.config.js'

/** The package manifest is checked as a shipped consumer would resolve it. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-process')
/** The common process directory must remain free of platform imports. */
const processSource = join(packageRoot, 'src/process')
/** Generic resource operations stay in Core after Process-specific policy moves to its owner. */
const sharedProcessSource = resolve(packageRoot, '../rpc-core/src/runtime-adapter')
/** Only this file owns the physical IPC gate construction. */
const ipcOwner = join(sharedProcessSource, 'byte/ipc-connection.ts')

/** Recursively collect source files without traversing test fixtures. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('process package layering and exports', () => {
  it('[A12] publishes the runtime-neutral process and byte-framing entries', async () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { default: string; types: string }>
    }
    const contractRoot = resolve(packageRoot, '../rpc-contract')
    const contractManifest = JSON.parse(
      readFileSync(join(contractRoot, 'package.json'), 'utf8')
    ) as {
      exports: Record<string, { default: string; types: string }>
    }
    for (const [owner, exports, key] of [
      [packageRoot, manifest.exports, '.'],
      [contractRoot, contractManifest.exports, './framing/stream']
    ] as const) {
      const entry = exports[key]
      expect(entry, key).toBeDefined()
      expect(existsSync(join(owner, entry.default)), key).toBe(true)
      expect(existsSync(join(owner, entry.types)), key).toBe(true)
    }
    expect(manifest.exports['./process']).toBeUndefined()
    expect(manifest.exports['./contract/framing/stream']).toBeUndefined()
    const common = await import('@migaia/rpc-process')
    const framing = await import('@migaia/rpc-contract/framing/stream')
    expect(common.createProcessTransport).toBeTypeOf('function')
    expect(common.createNativeProcessOffer).toBeTypeOf('function')
    expect(common.createProcessPlugin).toBeTypeOf('function')
    expect(common.createProcessPeer).toBeTypeOf('function')
    expect(common.parseProcessPluginDescriptor).toBeTypeOf('function')
    expect(common.ProcessPluginWire).toEqual({ native: 'native', jsonrpc: 'jsonrpc' })
    expect(framing.encodeRpcStreamFrame).toBeTypeOf('function')
  })

  it('[A1][A25] ships four symmetric factories without any retired factory alias', async () => {
    /** Built subpaths are the consumer boundary; internal imports cannot hide a leaked alias. */
    const process = await import('@migaia/rpc-process')
    const thread = await import('@migaia/rpc-threads')
    for (const name of ['createProcessHost', 'createServeProcessHost', 'createServeProcessPlugin'])
      expect(Object.hasOwn(process, name), '[A25] retired process factory must be absent').toBe(
        false
      )
    for (const name of ['createThreadHost', 'createServeThreadHost', 'createServeThreadPlugin'])
      expect(Object.hasOwn(thread, name), '[A25] retired thread factory must be absent').toBe(false)
    expect(thread.createThreadPeer).toBeTypeOf('function')
    expect(thread.createThreadPlugin).toBeTypeOf('function')
  })

  it('[A12] keeps platform peers optional and physical IPC construction singular', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      version: string
      dependencies: Record<string, string>
      peerDependencies: Record<string, string>
      peerDependenciesMeta: Record<string, { optional: boolean }>
    }
    expect(Object.keys(manifest.dependencies).every((name) => name.startsWith('@migaia/'))).toBe(
      true
    )
    expect(manifest.dependencies).toHaveProperty('@migaia/supervision')
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual([
      '@migaia/rpc-contract',
      '@migaia/rpc-core',
      'electron',
      'koffi'
    ])
    for (const peer of ['@migaia/rpc-contract', '@migaia/rpc-core']) {
      expect(manifest.peerDependencies[peer]).toBe(manifest.version)
      expect(manifest.peerDependenciesMeta[peer]?.optional ?? false).toBe(false)
    }
    expect(manifest.peerDependenciesMeta.electron.optional).toBe(true)
    expect(manifest.peerDependenciesMeta.koffi.optional).toBe(true)
    for (const file of [...sources(processSource), ...sources(sharedProcessSource)]) {
      const source = readFileSync(file, 'utf8')
      if (
        !file.includes('/adapters/') &&
        file !== join(processSource, 'node-byte-stream.ts') &&
        file !== join(processSource, 'node-io.ts')
      ) {
        expect(source, file).not.toMatch(/(?:from\s*|import\s*\()['"](?:node:|bun:|electron|koffi)/)
      }
      if (file !== ipcOwner) expect(source, file).not.toContain('createIpcSendQueueTransport')
    }
    const streamFraming = readFileSync(
      resolve(packageRoot, '../rpc-contract/src/contract/framing/stream.ts'),
      'utf8'
    )
    expect(streamFraming).not.toMatch(/(?:from\s*|import\s*\()['"](?:node:|bun:|electron|koffi)/)
    const vitestConfig = readFileSync(join(packageRoot, 'vitest.config.ts'), 'utf8')
    expect(vitestConfig).toContain('src/**/*.ts')
    expect(familyConfig.test?.coverage?.include).toEqual(
      [
        '../rpc-contract/src/**/*.{ts,tsx}',
        '../rpc-contract/dist/**/*.js',
        '../rpc-core/src/**/*.{ts,tsx}',
        '../rpc-core/dist/**/*.js',
        '../rpc-process/src/**/*.{ts,tsx}',
        '../rpc-process/dist/**/*.js',
        '../rpc-threads/src/**/*.{ts,tsx}',
        '../rpc-threads/dist/**/*.js',
        '../rpc-bridge-jsonrpc/src/**/*.{ts,tsx}',
        '../rpc-bridge-jsonrpc/dist/**/*.js',
        '../rpc-browser/src/**/*.{ts,tsx}',
        '../rpc-browser/dist/**/*.js'
      ].map((pattern) => resolve(packageRoot, '../rpc-integration', pattern))
    )
  })
})
