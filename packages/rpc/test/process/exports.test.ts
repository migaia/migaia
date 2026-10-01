import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The package manifest is checked as a shipped consumer would resolve it. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** The common process directory must remain free of platform imports. */
const processSource = join(packageRoot, 'src/process')
/** Only this file owns the physical IPC gate construction. */
const ipcOwner = join(processSource, 'ipc-connection.ts')

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
    for (const key of ['./process', './contract/framing/stream']) {
      const entry = manifest.exports[key]
      expect(entry, key).toBeDefined()
      expect(existsSync(join(packageRoot, entry.default)), key).toBe(true)
      expect(existsSync(join(packageRoot, entry.types)), key).toBe(true)
    }
    const common = await import('@migaia/rpc/process')
    const framing = await import('@migaia/rpc/contract/framing/stream')
    expect(common.createProcessTransport).toBeTypeOf('function')
    expect(common.createNativeProcessOffer).toBeTypeOf('function')
    expect(common.createProcessPlugin).toBeTypeOf('function')
    expect(common.createServeProcessPlugin).toBeTypeOf('function')
    expect(common.parseProcessPluginDescriptor).toBeTypeOf('function')
    expect(common.ProcessPluginWire).toEqual({ native: 'native', jsonrpc: 'jsonrpc' })
    expect(framing.encodeRpcStreamFrame).toBeTypeOf('function')
  })

  it('[A12] keeps platform peers optional and physical IPC construction singular', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      peerDependencies: Record<string, string>
      peerDependenciesMeta: Record<string, { optional: boolean }>
    }
    expect(Object.keys(manifest.dependencies).every((name) => name.startsWith('@migaia/'))).toBe(
      true
    )
    expect(manifest.dependencies).toHaveProperty('@migaia/supervision')
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(['electron', 'koffi'])
    expect(manifest.peerDependenciesMeta.electron.optional).toBe(true)
    expect(manifest.peerDependenciesMeta.koffi.optional).toBe(true)
    for (const file of sources(processSource)) {
      const source = readFileSync(file, 'utf8')
      if (!file.includes('/adapters/')) {
        expect(source, file).not.toMatch(/(?:from\s*|import\s*\()['"](?:node:|bun:|electron|koffi)/)
      }
      if (file !== ipcOwner) expect(source, file).not.toContain('createIpcSendQueueTransport')
    }
    const streamFraming = readFileSync(join(packageRoot, 'src/contract/framing/stream.ts'), 'utf8')
    expect(streamFraming).not.toMatch(/(?:from\s*|import\s*\()['"](?:node:|bun:|electron|koffi)/)
    const vitestConfig = readFileSync(join(packageRoot, 'vitest.config.ts'), 'utf8')
    expect(vitestConfig).toContain('src/process/adapters/**')
  })
})
