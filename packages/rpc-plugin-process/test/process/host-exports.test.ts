import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as built from '@migaia/rpc-plugin-process'

describe('process Host public root', () => {
  it('exposes only processPlugin and retained adapter contracts through the public root', () => {
    /** Compiler-owned root has exactly the four names below; this comparison has a fixed domain. */
    expect(Object.keys(built).toSorted()).toEqual([
      'RPC_PROCESS_ERROR_SOURCE',
      'RpcProcessErrorCode',
      'isProcessChild',
      'processPlugin'
    ])
    expect(built.processPlugin).toBeTypeOf('function')
    expect(built.isProcessChild).toBeTypeOf('function')
    expect(built.RPC_PROCESS_ERROR_SOURCE).toBe('rpc.transport.process')
    /** Each retired construction/channel helper is rejected by the actual loaded module. */
    for (const name of [
      'createProcessTransport',
      'createProcessChannelClosedError',
      'openProcessObjectChannel',
      'createProcessPeer',
      'createNativeProcessOffer',
      'createProcessResilience',
      'createProcessPlugin',
      'parseProcessPluginDescriptor',
      'ProcessPluginWire',
      'receiveAdapterBootstrap',
      'createAdapterWebByteIO',
      'createAdapterProcessLaunch',
      'createAdapterProcessPeer',
      'createAdapterProcessPlugin',
      'PROCESS_HANDSHAKE_MAX_FRAME_BYTES',
      'PROCESS_RUNTIME_API_ENV',
      'PROCESS_RUNTIME_API_ENV_VERSION',
      'PROCESS_RUNTIME_API_BOOTSTRAP_KIND',
      'PROCESS_RUNTIME_API_BOOTSTRAP_VERSION',
      'PROCESS_RUNTIME_API_FINGERPRINT_PREFIX',
      'PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS',
      'createProcessJsonRpcChannel'
    ])
      expect(built).not.toHaveProperty(name)
    /** Source selection remains typed through the one cold public factory. */
    type IPluginOptions = Parameters<typeof built.processPlugin>[0]
    const service: (options: IPluginOptions) => object = built.processPlugin
    expect(service).toBe(built.processPlugin)
    /** Exact subpaths expose the native transport and its supported cold features. */
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    )
    /** JSON object keys are unique, so exact Set equality retains every missing/extra subpath. */
    expect(new Set(Object.keys(manifest.exports))).toEqual(
      new Set([
        '.',
        './features',
        './features/send-queue',
        './features/log',
        './features/flow-control'
      ])
    )
    for (const key of ['./host', './host/*', './process', './process/host', './process/host/*'])
      expect(manifest.exports[key]).toBeUndefined()
  })
})
