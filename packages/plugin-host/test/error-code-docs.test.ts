import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PluginHostErrorCode } from '../src/typing'
import { PluginHostError, createPluginHostTypeError } from '../src/error-text'

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

  it('入参校验 TypeError 保持类型不变并携带 (source, INVALID_OPTION)（§7 裸抛扫描门禁）', () => {
    const error = createPluginHostTypeError('plugin name must be a non-empty string')
    expect(error).toBeInstanceOf(TypeError)
    expect(error.source).toBe('@migaia/plugin-host')
    expect(error.code).toBe(PluginHostErrorCode.invalidOption)
    expect(error.stack).toBeTruthy()
  })
})
