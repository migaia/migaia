import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import { composeSerializeSignal } from '../src/signal.js'
import type { ISerializeAbortSignal } from '../src/types.js'

type ISerializeManifest = {
  readonly dependencies?: Readonly<Record<string, string>>
}

type IBundleChunk = {
  readonly type: string
  readonly code?: string
}

type IBundleResult = {
  readonly output: readonly IBundleChunk[]
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const coreEntry = resolve(packageRoot, 'src/core.ts')
const importPattern = /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g

/** Read package dependency declarations used to reject accidental core workspace imports. */
const readPackageDependencies = (): readonly string[] => {
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, 'package.json'), 'utf8')
  ) as ISerializeManifest
  return Object.keys(manifest.dependencies ?? {})
}

/** Resolve one source-relative TypeScript import from the core closure. */
const resolveSourceImport = (importer: string, specifier: string): string => {
  const target = resolve(dirname(importer), specifier.replace(/\.js$/, '.ts'))
  return target
}

/** Collect static imports reachable from core without evaluating package code. */
const collectCoreImports = (): {
  readonly files: readonly string[]
  readonly external: readonly string[]
} => {
  const queue = [coreEntry]
  const files = new Set<string>()
  const external = new Set<string>()
  while (queue.length > 0) {
    const importer = queue.shift()!
    if (files.has(importer)) continue
    files.add(importer)
    const source = readFileSync(importer, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      if (specifier.startsWith('.')) queue.push(resolveSourceImport(importer, specifier))
      else external.add(specifier)
    }
  }
  return { files: [...files], external: [...external] }
}

describe('Round27 serialize boundaries', () => {
  it('SER-T27-01 keeps core source graph and bundled output free of workspace packages', async () => {
    const dependencies = readPackageDependencies()
    const graph = collectCoreImports()

    expect([...graph.external].sort()).toEqual(['@migaia/utils/bytes', '@migaia/utils/error'])
    for (const dependency of dependencies.filter((dependency) => dependency !== '@migaia/utils')) {
      expect(graph.external).not.toContain(dependency)
    }
    expect(graph.files).not.toContain(resolve(packageRoot, 'src/registry.ts'))

    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        lib: { entry: coreEntry, formats: ['es'], fileName: 'core' },
        minify: false,
        target: 'es2024',
        write: false,
        rollupOptions: { external: [] }
      }
    })
    const bundles = (Array.isArray(result)
      ? result
      : [result]) as unknown as readonly IBundleResult[]
    const bundle = bundles
      .flatMap(({ output }) => output)
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code ?? '')
      .join('\n')

    expect(bundle).not.toContain('@migaia/lifecycle')
    for (const dependency of dependencies.filter((dependency) => dependency !== '@migaia/utils')) {
      expect(bundle).not.toContain(dependency)
    }
  })

  it('SER-T27-02 preserves first-observed abort reason identity in core signal composition', () => {
    const firstReason = new Error('first abort')
    const secondReason = new Error('second abort')
    let callerAborted = false
    let callerListener: (() => void) | undefined
    const caller: ISerializeAbortSignal = {
      get aborted() {
        return callerAborted
      },
      reason: firstReason,
      addEventListener(_type, listener) {
        callerListener = listener
      },
      removeEventListener() {}
    }
    const closing: ISerializeAbortSignal = {
      aborted: false,
      reason: secondReason,
      addEventListener() {},
      removeEventListener() {}
    }

    const composed = composeSerializeSignal(caller, closing, () => {})
    callerAborted = true
    callerListener?.()

    expect(composed.signal.aborted).toBe(true)
    expect(composed.signal.reason).toBe(firstReason)
    composed.dispose()
  })
})
