import { describe, expect, it } from 'vitest'

/**
 * `rpc-host` 要能独立发布：核心层不能反向依赖宿主或业务包。这个文件首先保证包内任何文件都不得 import `src/store`（相对路径穿出去，或走 `@/store` 别名）。用
 * `import.meta.glob` 读源码文本，不用 Node `fs`—— 这个包要能在纯浏览器构建里被独立引用，检查它自己的工具也不该反过来依赖 Node 专属
 * API（这条本身就是本文件要断言的同一件事的一个实例）。
 */
const SOURCES = import.meta.glob(['../../src/**/*.ts', '../../src/**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** The actual package manifest proves runtime dependency direction independently of source text. */
const PACKAGE_MANIFESTS = import.meta.glob('../../package.json', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 覆盖具名/默认/命名空间/副作用四种 import 形态——任何一种都能把跨包依赖悄悄带回来。 */
function importSpecifiers(source: string): string[] {
  /** Retain every static or literal dynamic dependency for the existing boundary assertions. */
  const specifiers: string[] = []
  /** Imports and re-exports share the same dependency restrictions. */
  const patterns = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

describe('web-rpc 边界：不得依赖 src/store', () => {
  it('no file imports from ../store or @/store', () => {
    /** A nonempty violation list identifies the exact production dependency edge. */
    const offenders: string[] = []
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue
      for (const specifier of importSpecifiers(source)) {
        if (
          specifier.includes('/store/') ||
          specifier.endsWith('/store') ||
          specifier.startsWith('@/store')
        ) {
          offenders.push(`${path} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the glob actually found source files (guards against a silently-empty scan)', () => {
    /** Source discovery itself must succeed before the boundary checks can be evidence. */
    const nonTestFiles = Object.keys(SOURCES).filter(
      (path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx')
    )
    expect(nonTestFiles.length).toBeGreaterThan(5)
  })

  it('enforces the web-rpc layer import boundaries', () => {
    /** Mandatory Host owners remain independent from concrete native media. */
    const violations: string[] = []
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue
      /** Inspect actual imports rather than runtime symbol names in comments or strings. */
      const imports = importSpecifiers(source)
      if (
        /\/src\/(?:host|namespace|session|call|dispatch|forward|stream|flow|feature)\//.test(path)
      ) {
        if (
          imports.some((specifier) =>
            /^(node:|bun:|deno:)|(?:Window|Worker|MessagePort|BroadcastChannel|RTCDataChannel|WebTransport)/.test(
              specifier
            )
          )
        )
          violations.push(`${path} imports a platform module`)
      }
      if (path.endsWith('/index.ts')) {
        /** Internal imports support ordinary operations; only actual re-exports cross the API. */
        for (const [, , specifier] of source.matchAll(
          /export\s+(\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
        )) {
          if (!/(?:\/internal\/|(?:^|\/)(?:wire|endpoint)\.js$)/.test(specifier)) continue
          violations.push(`${path} exports an internal module`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('requires canonical PluginHost and capability topology owners', () => {
    /** Native PluginHost is the only installation owner; capability remains a fixture dependency. */
    const manifest = JSON.parse(Object.values(PACKAGE_MANIFESTS)[0] ?? '{}') as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@migaia/plugin-host']).toBe('workspace:^')
    /** Capability topology fixtures use the canonical owner without adding a Core runtime edge. */
    expect(manifest.devDependencies?.['@migaia/capability']).toBe('workspace:^')
    expect(manifest.dependencies?.['@migaia/capability']).toBeUndefined()

    /** The replaced middleware package cannot remain as a hidden execution path. */
    const pipelineImports = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .filter(([, source]) => source.includes('@migaia/middleware-pipeline'))
      .map(([path]) => path)
    expect(pipelineImports).toEqual([])
  })

  it('keeps timer and callback ownership in the internal utilities', () => {
    expect(Object.keys(SOURCES).some((path) => path.endsWith('/endpoint.ts'))).toBe(false)
    /** Mutable receiver helpers remain forbidden after the old endpoint implementation is removed. */
    const bindCallApply = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .flatMap(([path, source]) =>
        /**
         * AGENTS permits Reflect.apply for captured builtins; mutable receiver helpers remain
         * banned.
         */
        (
          source
            /**
             * These actual typed domain ports invoke RPC or subscribe a governor, never rebind a
             * function.
             */
            .replace(/this\.#(?:ports|setup)\.call\s*\(|governor\.bind\s*\(/g, '')
            .match(/(?<!Reflect)\.(?:bind|call|apply)\s*\(/g) ?? []
        ).map(() => path)
      )
    expect(bindCallApply).toEqual([])
  })
})
