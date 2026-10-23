import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as host from '@migaia/rpc-host'
import * as sdk from '@migaia/rpc-host/plugin'
import * as process from '@migaia/rpc-plugin-process'
import * as thread from '@migaia/rpc-plugin-thread'
import * as browser from '@migaia/rpc-plugin-browser'
import * as coroutines from '@migaia/rpc-plugin-coroutines'
import * as pool from '@migaia/rpc-plugin-pool'
import * as devtools from '@migaia/rpc-plugin-devtools'

it('publishes one host entry with raw authoring tools and transport or feature plugins', () => {
  /** Independent allowlists describe the actual installed publication rather than its registry. */
  const roots = [
    [
      process,
      ['RPC_PROCESS_ERROR_SOURCE', 'RpcProcessErrorCode', 'isProcessChild', 'processPlugin']
    ],
    [thread, ['RPC_THREAD_ERROR_SOURCE', 'RpcThreadErrorCode', 'isThreadChild', 'threadPlugin']],
    [
      browser,
      [
        'RPC_BROWSER_ERROR_SOURCE',
        'RpcBrowserErrorCode',
        'broadcastChannelPlugin',
        'dedicatedWorkerPlugin',
        'rtcDataChannelPlugin',
        'serviceWorkerPlugin',
        'sharedWorkerPlugin',
        'webTransportPlugin',
        'windowPlugin'
      ]
    ],
    [coroutines, ['RPC_COROUTINE_ERROR_SOURCE', 'RpcCoroutineErrorCode', 'coroutinePlugin']],
    [
      pool,
      [
        'RPC_POOL_ERROR_SOURCE',
        'RPC_POOL_PEER_ID',
        'RpcPoolErrorCode',
        'RpcPoolState',
        'poolPlugin'
      ]
    ],
    [devtools, ['RPC_DEVTOOLS_SOURCE', 'RpcDevtoolsErrorCode', 'devtoolsPlugin']]
  ] as const
  for (const [root, expected] of roots)
    expect(Object.keys(root).sort()).toEqual([...expected].sort())
  expect(typeof host.createRpcHost).toBe('function')
  for (const name of [
    'createEndpoint',
    'createFullEndpoint',
    'createFullOneWayEndpoint',
    'createComposedEndpoint',
    'createRuntimeApiEndpoint',
    'createClientEndpoint',
    'createProviderEndpoint'
  ]) {
    expect(host).not.toHaveProperty(name)
  }
  for (const name of [
    'createRuntimePeer',
    'createManagedRuntimePeer',
    'createRuntimePlugin',
    'createRemoteHost',
    'createRemotePlugin',
    'serveRemoteHost',
    'serveRemotePlugin',
    'coroutinePlugin',
    'createAdapterPlugin',
    'captureAdapterTask',
    'assembleAdapterPlugin'
  ]) {
    expect(sdk).not.toHaveProperty(name)
  }
  /** Defining raw I/O confers no second callable or complete Host construction path. */
  const adapter = sdk.defineMessageAdapter<never>({
    open: () => {
      throw new Error('unused physical opener')
    }
  })
  expect(Object.keys(adapter).sort()).toEqual(['deployment', 'scope'])
  /** Publication paths are read from the package owning the linked runtime artifacts. */
  const manifest = JSON.parse(
    readFileSync(new URL('../../../rpc-host/package.json', import.meta.url), 'utf8')
  )
  expect(Object.keys(manifest.exports).sort()).toEqual([
    '.',
    './adapters/memory',
    './features',
    './features/auth',
    './features/chunk',
    './features/retry',
    './features/timeout',
    './features/typegen',
    './plugin',
    './probe',
    './stream',
    './testing'
  ])
})
