import { describe, expect, it } from 'vitest'

/**
 * `web-rpc` 要能独立发布：核心层不能反向依赖宿主或业务包。这个文件首先保证包内任何文件都不得 import `src/store`（相对路径穿出去，或走 `@/store` 别名）。用
 * `import.meta.glob` 读源码文本，不用 Node `fs`—— 这个包要能在纯浏览器构建里被独立引用，检查它自己的工具也不该反过来依赖 Node 专属
 * API（这条本身就是本文件要断言的同一件事的一个实例）。
 */
const SOURCES = import.meta.glob(['../src/**/*.ts', '../src/**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const PACKAGE_MANIFESTS = import.meta.glob('../package.json', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 覆盖具名/默认/命名空间/副作用四种 import 形态——任何一种都能把跨包依赖悄悄带回来。 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
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
    const nonTestFiles = Object.keys(SOURCES).filter(
      (path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx')
    )
    expect(nonTestFiles.length).toBeGreaterThan(5)
  })

  it('enforces the web-rpc layer import boundaries', () => {
    const violations: string[] = []
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue
      const imports = importSpecifiers(source)
      if (
        /\/internal\/(?:runtime|pending|peers|provider)\.ts$|\/wire\.ts$|\/endpoint\.ts$/.test(path)
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
      if (
        /\/adapters\//.test(path) &&
        imports.some((specifier) => /(?:endpoint|factory|middleware)/.test(specifier))
      )
        violations.push(`${path} imports endpoint/factory/middleware`)
      if (
        path.endsWith('/index.ts') &&
        imports.some((specifier) => /(?:internal|wire|endpoint)/.test(specifier))
      )
        violations.push(`${path} exports an internal module`)
    }
    expect(violations).toEqual([])
  })

  it('WRC-C-T72 requires canonical PluginHost and capability topology owners', () => {
    const manifest = JSON.parse(Object.values(PACKAGE_MANIFESTS)[0] ?? '{}') as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@migaia/plugin-host']).toBe('workspace:^')
    expect(manifest.dependencies?.['@migaia/capability']).toBe('workspace:^')

    const pipelineImports = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .filter(([, source]) => source.includes('@migaia/middleware-pipeline'))
      .map(([path]) => path)
    expect(pipelineImports).toEqual([])
  })

  it('WRC-C-B12c06 has one activation/projection and one physical subscribe owner', () => {
    const coreSource = SOURCES['../src/core.ts']
    const kernelSource = SOURCES['../src/endpoint-kernel.ts']
    const activationSource = SOURCES['../src/internal/transport-activation.ts']
    expect(coreSource).toBeDefined()
    expect(kernelSource).toBeDefined()
    expect(activationSource).toBeDefined()
    expect(coreSource).not.toContain('disposePromise')
    expect(coreSource).not.toContain('Object.fromEntries')
    expect(kernelSource).not.toContain('disposePromise')
    expect(kernelSource).not.toContain('transport.subscribe')
    expect(activationSource?.match(/\.subscribe\s*\(/g)).toHaveLength(1)
    expect(coreSource).toContain('createEndpointProjection')
  })

  it('WRC-C-T60/T61 keeps the outbound sender domain-owned and stage-free by default', () => {
    const senderSource = SOURCES['../src/internal/outbound-sender.ts']
    const outboundAttachmentSource = SOURCES['../src/internal/outbound-attachment.ts']
    expect(senderSource).toBeDefined()
    expect(outboundAttachmentSource).toBeDefined()
    expect(senderSource).toContain('class WebRpcOutboundSender')
    expect(senderSource).not.toContain('WebRpcOutboundPipeline')
    expect(senderSource).not.toMatch(/\b(?:stage|next)\s*:/)
    expect(importSpecifiers(outboundAttachmentSource)).toContain('./outbound-sender.js')
    expect(SOURCES['../src/internal/pipeline.ts']).toBeUndefined()
    expect(SOURCES['../src/internal/runtime.ts']).toBeUndefined()
    const senderImporters = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .filter(([, source]) => importSpecifiers(source).includes('./outbound-sender.js'))
      .map(([path]) => path)
    expect(senderImporters).toEqual(['../src/internal/outbound-attachment.ts'])
    const staleClassReferences = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .filter(([, source]) => source.includes('WebRpcOutboundPipeline'))
      .map(([path]) => path)
    expect(staleClassReferences).toEqual([])
  })

  it('keeps timer and callback ownership in the internal utilities', () => {
    expect(Object.keys(SOURCES).some((path) => path.endsWith('/endpoint.ts'))).toBe(false)
    const bindCallApply = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .flatMap(([path, source]) =>
        (source.match(/\.(?:bind|call|apply)\s*\(/g) ?? []).map(() => path)
      )
    expect(bindCallApply).toEqual([])
  })
})
