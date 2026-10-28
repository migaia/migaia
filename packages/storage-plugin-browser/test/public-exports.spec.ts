import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertExactRetainedModules } from '../../../scripts/storage-v2-retained-ledger.mjs'
import * as storageWeb from '../src/index.ts'

/**
 * `docs/store/public-exports.baseline.json` 记录跨包公开面基线，移除任何 导出都要求一次显式的兼容性决定。这条测试是仓库里第一次真正把这份 JSON
 * 钉到某个包的实际导出上——此前它只是文档，没有任何测试读取过它。
 *
 * 用 process.cwd() 而不是 import.meta.url：vitest 在 jsdom environment 下 转换后的 import.meta.url 不总是真实
 * file:// scheme，new URL() 会抛错； vitest 的 cwd 固定是本包根目录（vitest.config.ts 所在处），足够可靠。
 */
/** The error domain and code table live in `@migaia/storage-contract/error-code`, not on this root. */
const expectedRootExports = [
  'StorageError',
  'StorageErrorText',
  'lengthPrefixedNamespaceCodec'
] as const

/** Every sibling route forbidden from a memory-only packed consumer bundle. */
const forbiddenSiblingModules = [
  '@migaia/reactive/dist/index.js',
  '@migaia/storage-plugin-browser/dist/cookie-hostile.js',
  '@migaia/storage-plugin-browser/dist/indexed-db-hostile.js',
  '@migaia/storage-plugin-browser/dist/local-storage-hostile.js',
  '@migaia/storage-plugin-browser/dist/reactive-hostile.js',
  '@migaia/storage-plugin-browser/dist/session-storage-hostile.js',
  '@migaia/storage-plugin-browser/dist/web-storage-hostile.js'
] as const

/** Tracked direct-consumer files must use exact V4 subpaths after the breaking cutover. */
const directConsumerFiles = [
  '../../../fixtures/consumers/browser.ts',
  '../../../fixtures/consumers/worker.ts',
  '../../../fixtures/consumers/electron-renderer.ts'
] as const

/** Reads built JavaScript after the package test script has completed its mandatory build step. */
const readBuiltJavaScript = (): string => {
  /** Distribution directory is owned by the storage-plugin-browser build gate. */
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

describe('native Blob subpath', () => {
  it('publishes the selected Feature only at its dedicated built entry', async () => {
    const entry = await import('../dist/features/blobs.js')
    expect(Object.keys(entry)).toEqual(['indexedDbBlobFeature'])
    expect(entry.indexedDbBlobFeature).toBeTypeOf('function')
    expect(Object.hasOwn(storageWeb, 'indexedDbBlobFeature')).toBe(false)
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
    )
    expect(manifest.exports['./features/blobs']).toEqual({
      types: './dist/features/blobs.d.ts',
      default: './dist/features/blobs.js'
    })
  })
})

describe('package-owner bundle boundary', () => {
  it('keeps canonical owner roots and subpaths external instead of bundling duplicate code', () => {
    const source = readBuiltJavaScript()
    /** Explicit notifications borrow the host controller instead of embedding another owner. */
    const notifications = readFileSync(
      resolve(import.meta.dirname, '../dist/features/indexed-db-notifications.js'),
      'utf8'
    )
    /** The host's stable authoring entry exposes the actual change-controller implementation. */
    const controllerEntry = readFileSync(
      resolve(import.meta.dirname, '../../storage-host/src/authoring/change-controller.ts'),
      'utf8'
    )
    expect(source).toContain('from "@migaia/utils/promise"')
    expect(source).toContain('from "@migaia/utils/bytes"')
    expect(source).toContain('from "@migaia/storage-host/sdk"')
    expect(notifications).toContain('from "@migaia/storage-host/sdk"')
    expect(notifications).toContain('from "@migaia/event-subscriber"')
    expect(controllerEntry).toContain(
      "export { createBackendChangeController } from '../core/change-controller.ts'"
    )
    expect(source).not.toContain('//#region ../utils/')
    expect(source).not.toContain('//#region ../event-subscriber/')
    expect(source).not.toContain('//#region ../storage-host/')
    expect(notifications).not.toContain('//#region ../event-subscriber/')
    expect(notifications).not.toContain('//#region ../storage-host/')
    expect(source).not.toContain('[utils] operation aborted')
  })

  it('rejects reactive and every sibling-backend retained-module injection', () => {
    for (const injectedModule of forbiddenSiblingModules)
      expect(() => assertExactRetainedModules([injectedModule], [])).toThrow(
        `unexpected retained module: ${injectedModule}`
      )
  })
})

describe('atomic consumer and artifact correction', () => {
  it('rejects removed root backend imports in every tracked direct consumer', () => {
    for (const file of directConsumerFiles) {
      const source = readFileSync(resolve(import.meta.dirname, file), 'utf8')
      expect(source, file).not.toMatch(/from ['"]@migaia\/storage-plugin-browser['"]/)
    }
  })
})

/** Optional IDB behavior is selected through its own public runtime entry. */
describe('explicit IndexedDB Feature subpaths', () => {
  it.each([
    ['ttl', 'indexedDbTtlFeature'],
    ['batch', 'indexedDbBatchFeature'],
    ['journal', 'indexedDbJournalFeature'],
    ['notifications', 'indexedDbNotificationsFeature'],
    ['change-feed', 'indexedDbChangeFeedFeature'],
    ['indexes', 'indexedDbIndexesFeature']
  ])('publishes only the %s assembly factory', async (path, factory) => {
    const entry = await import(`../dist/features/indexed-db-${path}.js`)
    expect(Object.keys(entry)).toEqual([factory])
    expect(entry[factory]).toBeTypeOf('function')
    expect(Object.hasOwn(storageWeb, factory)).toBe(false)
  })
})
