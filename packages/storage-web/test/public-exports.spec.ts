import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertExactRetainedModules } from '../../../scripts/storage-v2-retained-ledger.mjs'
import * as storageWeb from '../src/index'

/**
 * `docs/store/public-exports.baseline.json` 记录跨包公开面基线，移除任何 导出都要求一次显式的兼容性决定。这条测试是仓库里第一次真正把这份 JSON
 * 钉到某个包的实际导出上——此前它只是文档，没有任何测试读取过它。
 *
 * 用 process.cwd() 而不是 import.meta.url：vitest 在 jsdom environment 下 转换后的 import.meta.url 不总是真实
 * file:// scheme，new URL() 会抛错； vitest 的 cwd 固定是本包根目录（vitest.config.ts 所在处），足够可靠。
 */
const expectedRootExports = [
  'STORAGE_WEB_SOURCE',
  'StorageError',
  'StorageErrorCode',
  'StorageErrorText',
  'lengthPrefixedNamespaceCodec'
] as const

/** Every sibling route forbidden from a memory-only packed consumer bundle. */
const forbiddenSiblingModules = [
  '@migaia/reactive/dist/index.js',
  '@migaia/storage-web/dist/cookie-hostile.js',
  '@migaia/storage-web/dist/indexed-db-hostile.js',
  '@migaia/storage-web/dist/local-storage-hostile.js',
  '@migaia/storage-web/dist/reactive-hostile.js',
  '@migaia/storage-web/dist/session-storage-hostile.js',
  '@migaia/storage-web/dist/web-storage-hostile.js'
] as const

/** Tracked direct-consumer files must use exact V4 subpaths after the breaking cutover. */
const directConsumerFiles = [
  '../../../fixtures/consumers/browser.ts',
  '../../../fixtures/consumers/worker.ts',
  '../../../fixtures/consumers/electron-renderer.ts'
] as const

/** Built reactive entries must retain the canonical function identity and diagnostic name. */
const canonicalReactiveEntries = [
  ['memory', 'memoryReactive'],
  ['local-storage', 'localStorageReactive'],
  ['session-storage', 'sessionStorageReactive'],
  ['cookies', 'cookiesReactive'],
  ['indexed-db', 'indexedDbReactive']
] as const

/** Reads built JavaScript after the package test script has completed its mandatory build step. */
const readBuiltJavaScript = (): string => {
  /** Distribution directory is owned by the storage-web build gate. */
  const distDirectory = resolve(import.meta.dirname, '../dist')
  return readdirSync(distDirectory)
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => readFileSync(resolve(distDirectory, entry), 'utf8'))
    .join('\n')
}

describe('public exports baseline', () => {
  it('实际运行时导出与 baseline 完全一致（新增/移除导出都需要同步更新 baseline）', () => {
    const actual = Object.keys(storageWeb).sort()
    expect(actual).toEqual([...expectedRootExports].sort())
  })
})

describe('SWV2-T49 package-owner bundle boundary', () => {
  it('keeps canonical owner roots and subpaths external instead of bundling duplicate code', () => {
    const source = readBuiltJavaScript()
    expect(source).toContain('from "@migaia/utils/promise"')
    expect(source).toContain('from "@migaia/utils/bytes"')
    expect(source).toContain('from "@migaia/event-subscriber"')
    expect(source).not.toContain('//#region ../utils/')
    expect(source).not.toContain('//#region ../event-subscriber/')
    expect(source).not.toContain('[utils] operation aborted')
  })

  it('rejects reactive and every sibling-backend retained-module injection', () => {
    for (const injectedModule of forbiddenSiblingModules)
      expect(() => assertExactRetainedModules([injectedModule], [])).toThrow(
        `unexpected retained module: ${injectedModule}`
      )
  })
})

describe('SWV4-R13 atomic consumer and artifact correction', () => {
  it('rejects removed root backend imports in every tracked direct consumer', () => {
    for (const file of directConsumerFiles) {
      const source = readFileSync(resolve(import.meta.dirname, file), 'utf8')
      expect(source, file).not.toMatch(/from ['"]@migaia\/storage-web['"]/)
    }
  })

  it('retains canonical reactive names and exact aggregate identity in built artifacts', async () => {
    const aggregate = await import('../dist/plugins/reactive/index.js')
    for (const [entry, exportName] of canonicalReactiveEntries) {
      const exact = await import(`../dist/plugins/reactive/${entry}.js`)
      const factory = exact[exportName as keyof typeof exact]
      expect(factory).toBe(aggregate[exportName as keyof typeof aggregate])
      expect(factory).toBeTypeOf('function')
      expect((factory as { readonly name: string }).name).toBe(exportName)
    }
  })
})
