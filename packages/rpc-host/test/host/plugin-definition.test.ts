/** Native authoring identity and cold configuration retain their business boundaries under BC3. */
import { describe, expect, it, vi } from 'vitest'
import { isDefinedPlugin } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'

describe('RPC plugin definitions', () => {
  it('registers the final native frozen plugin and rejects copied metadata', () => {
    /** Construction captures a native acquisition callback but does not execute it. */
    const open = vi.fn(() => ({ dispose: () => undefined }))
    /** Namespace and expose configuration replace the deleted deployment grammar. */
    const plugin = defineTransportPlugin({
      name: 'transport',
      namespace: 'memory',
      expose: ['app.render'],
      open
    })
    expect(isDefinedPlugin(plugin)).toBe(true)
    expect(Object.isFrozen(plugin)).toBe(true)
    expect(plugin.name).toBe('memory')
    expect(readRpcDefinition(plugin)).toMatchObject({
      kind: 'transport',
      definition: { namespace: 'memory', expose: ['app.render'], open }
    })
    expect(readRpcDefinition(Object.freeze({ ...plugin }))).toBeUndefined()
    expect(open).toHaveBeenCalledTimes(0)
  })

  it('captures the shared connection budget once before any native work', () => {
    /** Getter count retains the original cold snapshot observation. */
    let reads = 0
    /** Only actual installation may acquire the native source. */
    const open = vi.fn(() => ({ dispose: () => undefined }))
    /** BC3 places the physical handshake budget on the actual carrier definition. */
    const plugin = defineTransportPlugin({
      name: 'transport',
      namespace: 'memory',
      open,
      get handshakeTimeoutMs() {
        reads++
        return 50
      }
    })
    expect(reads).toBe(1)
    expect(readRpcDefinition(plugin)).toMatchObject({
      definition: { handshakeTimeoutMs: 50 }
    })
    expect(open).toHaveBeenCalledTimes(0)
  })

  it('lets native extension admission reject surface getters without executing them', async () => {
    /** Accessors never become inert namespace capability metadata. */
    let reads = 0
    /** BC3 contributes the surface through the actual installation's namespace extension port. */
    const extension = defineFlowPlugin({
      name: 'extension',
      setup: () => ({
        hooks: {},
        namespaceExtensions: () => ({
          get value() {
            reads++
            return 1
          }
        })
      })
    })
    /** The genuine transport supplies the namespace on which extensions are admitted. */
    const transport = defineTransportPlugin({
      name: 'transport',
      namespace: 'memory',
      open: () => ({ dispose: () => undefined })
    })
    await expect(
      createRpcHost({ plugins: [extension, transport], report: () => undefined })
    ).rejects.toBeInstanceOf(TypeError)
    expect(reads).toBe(0)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid shared handshake budget %s before native acquisition',
    async (handshakeTimeoutMs) => {
      /** The actual source must remain untouched by native configuration rejection. */
      const open = vi.fn(() => ({ dispose: () => undefined }))
      /** BC3 removes connect descriptors; the new definition lends its one budget to Session. */
      const transport = defineTransportPlugin({
        name: 'transport',
        namespace: 'memory',
        handshakeTimeoutMs,
        open
      })
      await expect(
        createRpcHost({ plugins: [transport], report: () => undefined })
      ).rejects.toMatchObject({
        name: 'TypeError',
        source: 'rpc.endpoint',
        code: 'INVALID_CONFIG'
      })
      expect(open).toHaveBeenCalledTimes(0)
    }
  )
})
