import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyExports from '../fixtures/legacy-exports.json'
import errorFormatDelta from '../fixtures/error-format-export-delta.json'
import controlSemanticsDelta from '../fixtures/control-semantics-export-delta.json'
import streamingDelta from '../fixtures/streaming-export-delta.json'

/** Package root whose manifest and built files define the new public surface. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Applies the layered core naming decision to the frozen merge export snapshot. */
function layeredName(name: string): string {
  if (name === 'WEBRPC_SOURCE') return 'RPC_CORE_ERROR_SOURCE'
  if (name === 'WebRpcErrorCode') return 'RpcCoreErrorCode'
  if (name.startsWith('WebRpc')) return `Rpc${name.slice('WebRpc'.length)}`
  if (name.startsWith('isWebRpc')) return `isRpc${name.slice('isWebRpc'.length)}`
  if (name.startsWith('tagWebRpc')) return `tagRpc${name.slice('tagWebRpc'.length)}`
  return name
}

/** Walk compiled core files to reject a second copy of the contract implementation. */
function compiledCoreFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? compiledCoreFiles(path) : entry.name.endsWith('.js') ? [path] : []
  })
}

describe('A1 merged public exports', () => {
  it('preserves the merged runtime export sets and the layered transport kit', async () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { default: string; types: string }>
    }
    const expected = [
      ...Object.keys(legacyExports),
      '@migaia/rpc/core/transport-kit',
      '@migaia/rpc/core/stream',
      '@migaia/rpc/core/plugins/flow-control',
      '@migaia/rpc/core/plugins/send-queue',
      '@migaia/rpc/core/plugins/log',
      '@migaia/rpc/remote',
      '@migaia/rpc/process',
      '@migaia/rpc/process/adapters/node-child-process',
      '@migaia/rpc/process/adapters/node-socket',
      '@migaia/rpc/process/adapters/bun-spawn',
      '@migaia/rpc/process/adapters/bun-socket',
      '@migaia/rpc/process/adapters/deno-command',
      '@migaia/rpc/process/adapters/deno-socket',
      '@migaia/rpc/process/adapters/electron-utility-process',
      '@migaia/rpc/process/adapters/windows-job',
      '@migaia/rpc/contract/framing/stream',
      '@migaia/rpc/threads',
      ...['node', 'deno', 'bun', 'electron-main', 'electron-renderer', 'browser'].map(
        (name) => `@migaia/rpc/threads/adapters/${name}`
      )
    ].sort()
    expect(expected).toHaveLength(47)
    expect(Object.keys(manifest.exports).sort()).toEqual(
      expected.map((name) => `.${name.slice('@migaia/rpc'.length)}`).sort()
    )
    for (const [name, baseline] of Object.entries(legacyExports)) {
      const key = `.${name.slice('@migaia/rpc'.length)}`
      const entry = manifest.exports[key]
      expect(entry, name).toBeDefined()
      const relative = entry.default.replace(/^\.\//, '')
      const suffix = name.slice('@migaia/rpc/'.length)
      const indexed = new Set(['contract', 'contract/v1', 'contract/framing', 'core'])
      const expectedRelative = `dist/${suffix}${indexed.has(suffix) ? '/index' : ''}.js`
      expect(relative.startsWith('dist/'), name).toBe(true)
      expect(relative.endsWith('.js'), name).toBe(true)
      expect(entry.types, name).toBe(entry.default.replace(/\.js$/, '.d.ts'))
      expect(existsSync(join(packageRoot, relative)), name).toBe(true)
      expect(existsSync(join(packageRoot, entry.types)), name).toBe(true)
      expect(
        Object.keys(await import(pathToFileURL(join(packageRoot, relative)).href)).sort(),
        name
      ).toEqual(
        [
          ...(name.startsWith('@migaia/rpc/core')
            ? baseline.names.map(layeredName)
            : baseline.names
          ).filter(
            (item) =>
              !((errorFormatDelta.removed as Record<string, string[]>)[name] ?? []).includes(
                item
              ) &&
              !((controlSemanticsDelta.removed as Record<string, string[]>)[name] ?? []).includes(
                item
              )
          ),
          ...((errorFormatDelta.added as Record<string, string[]>)[name] ?? []),
          ...((controlSemanticsDelta.added as Record<string, string[]>)[name] ?? []),
          ...((streamingDelta.added as Record<string, string[]>)[name] ?? []),
          ...(name === '@migaia/rpc/core' ? ['RpcProviderRejectionReason'] : [])
        ].sort()
      )
      // A leaf export maps to its own source path; index entries map to directory roots.
      expect(relative, name).toBe(expectedRelative)
    }
    const stream = manifest.exports['./core/stream']
    expect(stream).toEqual({
      types: './dist/core/stream/index.d.ts',
      default: './dist/core/stream/index.js'
    })
    expect(
      Object.keys(await import(pathToFileURL(join(packageRoot, stream.default)).href)).sort()
    ).toEqual(['createCanonicalChunkFeature', 'createStreamFeature'])
    const remote = manifest.exports['./remote']
    expect(remote).toEqual({
      types: './dist/remote/index.d.ts',
      default: './dist/remote/index.js'
    })
    expect(
      Object.keys(await import(pathToFileURL(join(packageRoot, remote.default)).href)).sort()
    ).toEqual(
      [
        'RemoteMethodMode',
        'REMOTE_NAME_PATTERN',
        'REMOTE_METHOD_MAX_LENGTH',
        'REMOTE_SCHEMA_VERSION',
        'REMOTE_METHOD_MODES',
        'RemoteMethodName',
        'RpcRemoteLayerErrorCode',
        'RpcRemoteLayerErrorText',
        'normalizeRemoteContract',
        'normalizeRemoteHostCatalog',
        'normalizeRemoteControlShape',
        'sameRemoteContract',
        'createRemotePlugin',
        'createRemoteRetryPort',
        'serveRemotePlugin',
        'createRemoteHost',
        'serveRemoteHost',
        'createCoroutinePlugin',
        'createCoroutineHost'
      ].sort()
    )
    const processEntry = manifest.exports['./process']
    expect(
      Object.keys(await import(pathToFileURL(join(packageRoot, processEntry.default)).href))
    ).toEqual(
      expect.arrayContaining([
        'createProcessHost',
        'createServeProcessHost',
        'createProcessPlugin',
        'createProcessResilience',
        'createServeProcessPlugin',
        'parseProcessPluginDescriptor',
        'ProcessPluginWire'
      ])
    )
  })

  it('keeps contract protocol and normalizer implementations outside compiled core', () => {
    expect(existsSync(join(packageRoot, 'dist/core'))).toBe(true)
    expect(existsSync(join(packageRoot, 'dist/contract'))).toBe(true)
    const offenders = compiledCoreFiles(join(packageRoot, 'dist/core')).filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /(?:function|const|class)\s+(?:rpcProtocolV1|normalizeRpcEnvelope)\b/.test(source)
    })
    expect(offenders).toEqual([])
  })
})
