import { describe, expect, it } from 'vitest'
import { definePlugin, isDefinedPlugin } from '../src/index.js'

describe('trusted plugin identity', () => {
  it('accepts only the definition minted by this package instance', () => {
    /** Source object is intentionally not the minted plugin identity. */
    const source = { name: 'trusted', install: () => ({}) }
    /** The returned plugin is recorded by the package private identity map. */
    const defined = definePlugin(source)
    /** Matching public fields must not grant trusted identity. */
    const forged = { name: defined.name, install: defined.install }

    expect(isDefinedPlugin(defined)).toBe(true)
    expect(isDefinedPlugin(source)).toBe(false)
    expect(isDefinedPlugin(forged)).toBe(false)
    expect(isDefinedPlugin(null)).toBe(false)
  })

  it('does not inspect an untrusted object', () => {
    /** A getter would execute if admission probed public properties. */
    const suspicious = Object.defineProperty({}, 'name', {
      get: () => {
        throw new Error('untrusted getter ran')
      }
    })
    expect(isDefinedPlugin(suspicious)).toBe(false)
  })
})
