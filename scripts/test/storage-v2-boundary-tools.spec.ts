import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  inspectVirtualStorePackageRoots,
  packageContentSha256
} from '../storage-v2-package-tree.mjs'
import {
  assertExactRetainedModules,
  normalizeRetainedModules
} from '../storage-v2-retained-ledger.mjs'

describe('root-owned package-tree and retained-ledger tools', () => {
  it('hashes file and symlink identity deterministically and detects byte drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'storage-v2-tree-tool-'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'index.js'), 'export const value = 1\n')
    symlinkSync('index.js', join(root, 'dist', 'alias.js'))
    const before = packageContentSha256(root)
    expect(packageContentSha256(root)).toBe(before)
    writeFileSync(join(root, 'dist', 'index.js'), 'export const value = 2\n')
    expect(packageContentSha256(root)).not.toBe(before)
  })

  it('enumerates distinct virtual-store roots for one scoped package', () => {
    const consumer = mkdtempSync(join(tmpdir(), 'storage-v2-root-tool-'))
    const first = join(consumer, 'node_modules/.pnpm/first/node_modules/@migaia/utils')
    const second = join(consumer, 'node_modules/.pnpm/second/node_modules/@migaia/utils')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    expect(inspectVirtualStorePackageRoots(consumer, '@migaia/utils')).toEqual(
      [realpathSync(first), realpathSync(second)].sort()
    )
  })

  it('normalizes only the admitted root and rejects raw-ID collisions or set drift', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-ledger-tool-'))
    const consumer = join(fixture, 'consumer')
    const packageRoot = join(fixture, 'node_modules/@migaia/utils')
    const aliasRoot = join(fixture, 'alias/node_modules/@migaia/utils')
    mkdirSync(consumer, { recursive: true })
    mkdirSync(join(packageRoot, 'dist'), { recursive: true })
    mkdirSync(join(aliasRoot, '..'), { recursive: true })
    writeFileSync(join(consumer, 'bundle-entry.js'), 'export const app = true\n')
    writeFileSync(join(packageRoot, 'dist/bytes.js'), 'export const bytes = true\n')
    symlinkSync(packageRoot, aliasRoot, 'dir')
    const installed = new Map([['@migaia/utils', { root: realpathSync(packageRoot) }]])
    const normalized = normalizeRetainedModules(
      [realpathSync(join(consumer, 'bundle-entry.js')), join(packageRoot, 'dist/bytes.js')],
      consumer,
      installed
    )
    expect(normalized).toEqual(['app/bundle-entry.js', '@migaia/utils/dist/bytes.js'])
    expect(() =>
      normalizeRetainedModules(
        [join(packageRoot, 'dist/bytes.js'), join(aliasRoot, 'dist/bytes.js')],
        consumer,
        installed
      )
    ).toThrow('retained module identity collision')
    expect(() =>
      assertExactRetainedModules([...normalized, 'virtual:hostile'], normalized)
    ).toThrow('unexpected retained module: virtual:hostile')
  })

  it('normalizes a packed unscoped dependency only through its admitted root', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'storage-v2-packed-dependency-'))
    const consumer = join(fixture, 'consumer')
    const packageRoot = join(fixture, 'node_modules/.pnpm/ansis/node_modules/ansis')
    const foreignRoot = join(fixture, 'foreign/node_modules/ansis')
    mkdirSync(consumer, { recursive: true })
    mkdirSync(packageRoot, { recursive: true })
    mkdirSync(foreignRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'index.mjs'), 'export const color = true\n')
    writeFileSync(join(foreignRoot, 'index.mjs'), 'export const color = true\n')
    const moduleId = join(packageRoot, 'index.mjs')
    const installed = new Map([['ansis', { root: realpathSync(packageRoot) }]])
    expect(normalizeRetainedModules([moduleId], consumer, installed)).toEqual(['ansis/index.mjs'])
    expect(normalizeRetainedModules([moduleId], consumer, new Map())).toEqual([
      'package:ansis/index.mjs'
    ])
    expect(() =>
      assertExactRetainedModules(normalizeRetainedModules([moduleId], consumer, new Map()), [
        'ansis/index.mjs'
      ])
    ).toThrow('unexpected retained module: package:ansis/index.mjs')
    expect(normalizeRetainedModules([join(foreignRoot, 'index.mjs')], consumer, installed)).toEqual(
      [`foreign-package:${join(foreignRoot, 'index.mjs')}`]
    )
    symlinkSync(join(foreignRoot, 'index.mjs'), join(packageRoot, 'escaped.mjs'))
    expect(
      normalizeRetainedModules([join(packageRoot, 'escaped.mjs')], consumer, installed)
    ).toEqual([`escaped-package:${join(packageRoot, 'escaped.mjs')}`])
  })
})
