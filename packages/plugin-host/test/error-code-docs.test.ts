import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PluginHostErrorCode } from '../src/typing'
import { PluginHostError, createPluginHostTypeError } from '../src/error-text'
import ERROR_TEXT from '../src/error-text.js'

/** A12 links PLUGIN_SUSPENDED and every public error code to maintained documentation. */
describe('PluginHost public error-code documentation', () => {
  it('documents every exported error code in README and USEGUIDE', async () => {
    const [readme, useguide] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../USEGUIDE.md', import.meta.url), 'utf8')
    ])
    for (const code of Object.values(PluginHostErrorCode)) {
      expect(readme).toContain(code)
      expect(useguide).toContain(code)
    }
  })

  it('每个 PluginHostError 都携带 (source, code) 二元组（M-T41）', () => {
    const error = new PluginHostError('HOST_DISPOSED', 'host is disposed')
    expect(error.source).toBe('@migaia/plugin-host')
    expect(error.code).toBe('HOST_DISPOSED')
    expect(error.stack).toBeTruthy()
  })

  it('declares the suspended boundary code with descriptive source documentation', async () => {
    expect(PluginHostErrorCode.pluginSuspended).toBe('PLUGIN_SUSPENDED')
    const source = await readFile(new URL('../src/error-code.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/\/\*\*[\s\S]+temporarily suspended[\s\S]+pluginSuspended/)
  })

  it('A7 registers the async setup sync-path code and its package texts', async () => {
    expect(PluginHostErrorCode.setupRequiresAsyncInstall).toBe('SETUP_REQUIRES_ASYNC_INSTALL')
    const [codes, texts] = await Promise.all([
      readFile(new URL('../src/error-code.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/error-text.ts', import.meta.url), 'utf8')
    ])
    expect(codes).toContain('must install it through `use()`')
    for (const name of [
      'SETUP_REQUIRES_ASYNC_INSTALL',
      'PLUGIN_SETUP_FUNCTION',
      'SETUP_LATE_REJECTION',
      'SETUP_LATE_RELEASE_FAILED'
    ])
      expect(texts).toContain(name)
  })

  it('入参校验 TypeError 保持类型不变并携带 (source, INVALID_OPTION)（§7 裸抛扫描门禁）', () => {
    const error = createPluginHostTypeError('plugin name must be a non-empty string')
    expect(error).toBeInstanceOf(TypeError)
    expect(error.source).toBe('@migaia/plugin-host')
    expect(error.code).toBe(PluginHostErrorCode.invalidOption)
    expect(error.stack).toBeTruthy()
  })
})

describe('A8 release hook error contract', () => {
  it('keeps the release phase and invalid hook messages in the canonical text owner', () => {
    expect(ERROR_TEXT.PLUGIN_BEFORE_RELEASE_FUNCTION).toContain('beforeRelease')
    expect(ERROR_TEXT.BEFORE_RELEASE_PHASE).toContain('beforeRelease')
  })

  it('documents the hook at each reused error code declaration', async () => {
    /** Reads tracked package source; workspace-local docs cannot affect this oracle. */
    const codeSource = await readFile(new URL('../src/error-code.ts', import.meta.url), 'utf8')
    for (const declaration of ['pluginDisposeFailed', 'lifecycleMutation', 'disposeStepTimeout']) {
      const beforeDeclaration = codeSource.slice(0, codeSource.indexOf(`${declaration}:`))
      const jsdoc = beforeDeclaration.slice(beforeDeclaration.lastIndexOf('/**'))
      expect(jsdoc).toContain('beforeRelease')
    }
  })

  it('documents the release ordering, affected result, migration, and reused error codes', async () => {
    const [readme, useguide] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../USEGUIDE.md', import.meta.url), 'utf8')
    ])
    for (const text of [readme, useguide]) {
      expect(text).toContain('beforeRelease')
      expect(text).toContain('affected')
      expect(text).toContain('dryRun: true')
      expect(text).toContain('BC1')
      expect(text).toContain('BC3')
    }
    for (const code of ['PLUGIN_DISPOSE_FAILED', 'LIFECYCLE_MUTATION', 'DISPOSE_STEP_TIMEOUT']) {
      const row = useguide.split('\n').find((line) => line.startsWith(`| \`${code}\``))
      expect(row).toContain('beforeRelease')
    }
  })
})
