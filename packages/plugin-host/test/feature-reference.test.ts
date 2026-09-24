import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHostErrorCode } from '../src/index.js'

describe('feature references', () => {
  it('creates a reference only for declared features', () => {
    const cache = defineFeature(() => ({ read: () => 1 }))
    const provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })

    expect(provider.getFeature('cache')).toEqual({
      plugin: 'provider',
      feature: 'cache',
      optional: false
    })
    expect(() => provider.getFeature('missing' as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.featureNotDeclared })
    )
  })
})
