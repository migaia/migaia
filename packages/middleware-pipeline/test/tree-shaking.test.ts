import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

/** Build-only fixture path; no output is written to disk. */
const SYNC_ENTRY_PATH = fileURLToPath(new URL('./fixtures/sync-entry.ts', import.meta.url))
/** Async-generator-only fixture path resolved through the package public boundary. */
const ASYNC_GENERATOR_ENTRY_PATH = fileURLToPath(
  new URL('./fixtures/async-generator-entry.ts', import.meta.url)
)
const ASYNC_ENTRY_PATH = fileURLToPath(new URL('./fixtures/async-entry.ts', import.meta.url))
const GENERATOR_ENTRY_PATH = fileURLToPath(
  new URL('./fixtures/generator-entry.ts', import.meta.url)
)

/** Builds one fixture in memory and returns the emitted production code. */
const bundleFixture = async (entry: string): Promise<string> => {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, lib: { entry, formats: ['es'] } }
  })) as
    | { readonly output: readonly { readonly type: string; readonly code?: string }[] }
    | readonly {
        readonly output: readonly { readonly type: string; readonly code?: string }[]
      }[]
  const outputs = Array.isArray(result) ? result : [result]
  return outputs
    .flatMap((output) => output.output)
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code ?? '')
    .join('\n')
}

describe('tree shaking', () => {
  it('MP-T67 removes unused modes from async-only and generator-only bundles', async () => {
    const asyncCode = await bundleFixture(ASYNC_ENTRY_PATH)
    const generatorCode = await bundleFixture(GENERATOR_ENTRY_PATH)
    expect(asyncCode).toContain('runAsyncOnly')
    expect(asyncCode).not.toContain('runSyncMiddleware')
    expect(asyncCode).not.toContain('runGeneratorMiddleware')
    expect(asyncCode).not.toContain('runSyncOnly')
    expect(asyncCode).not.toContain('runAsyncGeneratorMiddleware')
    expect(asyncCode).not.toContain('middleware-pipeline.generator-continue')
    expect(asyncCode).not.toContain('@migaia/lifecycle')
    expect(generatorCode).toContain('runGeneratorOnly')
    expect(generatorCode).not.toContain('runSyncMiddleware')
    expect(generatorCode).not.toContain('runAsyncMiddleware')
    expect(generatorCode).not.toContain('runAsyncGeneratorMiddleware')
    expect(generatorCode).not.toContain('runAsyncMiddleware')
    expect(generatorCode).not.toContain('@migaia/lifecycle')
  })

  it('removes unused async and generator modes from a sync-only bundle', async () => {
    const code = await bundleFixture(SYNC_ENTRY_PATH)

    expect(code).toContain('runSyncOnly')
    expect(code).not.toContain('runAsyncGeneratorMiddleware')
    expect(code).not.toContain('async-generator')
    expect(code).not.toContain('middleware-pipeline.generator-continue')
    expect(code).not.toContain('middleware stage and downstream failed')
    expect(code).not.toContain('@migaia/lifecycle')
  })

  it('removes sync, async, and sync-generator runners from an async-generator-only bundle', async () => {
    const code = await bundleFixture(ASYNC_GENERATOR_ENTRY_PATH)

    expect(code).toContain('runAsyncGeneratorOnly')
    expect(code).toContain('middleware-pipeline.generator-continue')
    expect(code).not.toContain('runSyncMiddleware')
    expect(code).not.toContain('runAsyncMiddleware')
    expect(code).not.toContain('runGeneratorMiddleware')
    expect(code).not.toContain('middleware stage and downstream failed')
    expect(code).not.toContain('@migaia/lifecycle')
  })
})
