import { assert, describe, expect, it } from 'vitest'
import { isDefinedPlugin } from '@migaia/plugin-host'
import { defineFeaturePlugin, defineTransportPlugin } from '@migaia/rpc-host/plugin'
import { readRpcPluginMetadata } from '../../dist/plugin/metadata.js'
import type { IAdapterDeployment } from '../../dist/runtime-adapter/deployment.js'

describe('RPC plugin definitions', () => {
  it('registers the final native frozen plugin and rejects copied metadata', () => {
    /** Definition construction must not acquire the transport. */
    const deployment = Object.freeze({}) as IAdapterDeployment
    /** Registration metadata remains independent of remote peer identity. */
    const plugin = defineTransportPlugin({
      name: 'transport',
      expose: ['app.render'],
      mode: 'connect',
      deployment
    })
    expect(isDefinedPlugin(plugin)).toBe(true)
    expect(Object.isFrozen(plugin)).toBe(true)
    expect(plugin.name).toBe('transport')
    expect(plugin.expose).toEqual(['app.render'])
    expect(readRpcPluginMetadata(plugin)).toMatchObject({
      kind: 'transport',
      definition: { deployment, mode: 'connect' }
    })
    expect(readRpcPluginMetadata(Object.freeze({ ...plugin }))).toBeUndefined()
  })

  it('shares factory definition identity while preserving each final surface', () => {
    /** One module-level factory defines one feature, regardless of its configuration instances. */
    const feature = defineFeaturePlugin((value: number) => ({
      name: 'feature',
      surface: { value }
    }))
    /** Separate configuration objects must not bypass host duplicate admission. */
    const first = feature(1)
    /** Surface metadata is collected before the native definition is frozen. */
    const second = feature(2)
    /** The private token is available only to host admission. */
    const firstMetadata = readRpcPluginMetadata(first)
    /** Reading this receipt does not acquire install state. */
    const secondMetadata = readRpcPluginMetadata(second)
    expect(first).not.toBe(second)
    expect(first.value).toBe(1)
    expect(second.value).toBe(2)
    expect(isDefinedPlugin(first)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(firstMetadata?.kind).toBe('feature')
    expect(secondMetadata?.kind).toBe('feature')
    assert(firstMetadata?.kind === 'feature' && secondMetadata?.kind === 'feature')
    expect(firstMetadata.identity).toBe(secondMetadata.identity)
  })

  it('uses each object definition final plugin as its own definition identity', () => {
    /** Object definitions intentionally represent independent custom features. */
    const first = defineFeaturePlugin({ name: 'first' })
    /** Matching configuration cannot forge another feature definition. */
    const second = defineFeaturePlugin({ name: 'second' })
    expect(readRpcPluginMetadata(first)).toMatchObject({ identity: first })
    expect(readRpcPluginMetadata(second)).toMatchObject({ identity: second })
    expect(readRpcPluginMetadata(null)).toBeUndefined()
  })

  it('captures the shared connection budget once before any deployment work', () => {
    /** Getter counts prove the SDK owns the option snapshot. */
    let reads = 0
    /** A source token has no opportunity to run during definition construction. */
    const deployment = Object.freeze({}) as IAdapterDeployment
    /** The mutable caller option cannot alter a later installation. */
    const connect = {
      get timeoutMs() {
        reads += 1
        return 50
      }
    }
    /** Native metadata retains the immutable option snapshot. */
    const plugin = defineTransportPlugin({
      name: 'transport',
      mode: 'connect',
      deployment,
      connect
    })
    expect(reads).toBe(1)
    expect(readRpcPluginMetadata(plugin)).toMatchObject({
      definition: { connect: { timeoutMs: 50 } }
    })
  })

  it('lets native metadata admission reject surface getters without executing them', () => {
    /** Accessors are not inert capability metadata and must never run during definition admission. */
    let reads = 0
    expect(() =>
      defineFeaturePlugin({
        name: 'feature',
        surface: {
          get value() {
            reads += 1
            return 1
          }
        }
      })
    ).toThrow(TypeError)
    expect(reads).toBe(0)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid shared handshake budget %s before native installation',
    (timeoutMs) => {
      /** No deployment method is read or executed by this cold option rejection. */
      const deployment = Object.freeze({}) as IAdapterDeployment
      expect(() =>
        defineTransportPlugin({
          name: 'transport',
          mode: 'connect',
          deployment,
          connect: { timeoutMs }
        })
      ).toThrowError(
        expect.objectContaining({
          name: 'TypeError',
          source: 'rpc.endpoint',
          code: 'INVALID_CONFIG'
        })
      )
    }
  )
})
