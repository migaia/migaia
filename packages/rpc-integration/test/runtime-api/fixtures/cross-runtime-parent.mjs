import assert from 'node:assert/strict'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPeer } from '../../../../rpc-plugin-thread/test/protocol.ts'
import {
  createAdapterWebThreadLauncher as createWebThreadLauncher,
  createAdapterWebThreadChannelFactory as createWebThreadChannelFactory
} from '../../../../rpc-plugin-thread/dist/threads/web-launcher.js'

import { createNodeProcessLauncher } from '@migaia/rpc-plugin-process/adapters/node-child-process'
import { createDenoProcessLauncher } from '@migaia/rpc-plugin-process/adapters/deno-command'
import { createProcessPeer } from '../../../../rpc-plugin-process/test/protocol.ts'
import { createProcessTransport } from '../../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../../rpc-plugin-process/dist/process/offer.js'

/** This fixture executes within an actual runtime; a Node host cannot grant its PASS. */
const deno = typeof Deno !== 'undefined'
/** Each owned process/Worker path exercises the same production automatic child factory. */
const mode = deno ? Deno.args[0] : process.argv[2]
/** Reverse calls must reach a separately counted provider on the actual parent endpoint. */
let reverseCalls = 0
/** Only a successfully constructed Peer is closed; native handles always terminate in finally. */
let peer
/** Real lifecycle remains with the original launcher handle and its capability declaration. */
let handle
/** A fixture-only auth token never enters a returned business result. */
const token = 'c3-cross-runtime-token'
try {
  peer = await (mode === 'thread' ? createThreadPeer : createProcessPeer)({
    self: { name: 'parent', instanceId: 'cross-runtime-parent' },
    provide: {
      parentEcho: () => {
        reverseCalls += 1
        return peer.self.instanceId
      }
    },
    spawn: async (context) => {
      if (mode === 'thread') {
        const launcher = createWebThreadLauncher({
          runtimeApi: context,
          report: () => undefined
        })
        handle = await launcher.launch(
          {
            entry: new URL('./automatic-web-worker.mjs', import.meta.url).href,
            name: 'cross-runtime-child'
          },
          { signal: new AbortController().signal }
        )
        return createWebThreadChannelFactory({
          scheduler: systemScheduler
        }).open(handle, new AbortController().signal)
      }
      const launcher = (deno ? createDenoProcessLauncher : createNodeProcessLauncher)({
        runtimeApiBootstrap: {
          name: 'cross-runtime-child',
          parentInstanceId: context.self.instanceId
        }
      })
      const entry = new URL('./automatic-process.mjs', import.meta.url).pathname
      handle = await launcher.launch(
        {
          command: deno ? Deno.execPath() : process.execPath,
          args: deno ? ['run', '-A', entry] : [entry],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
        },
        { signal: new AbortController().signal, output: () => undefined }
      )
      const offer = createNativeProcessOffer({
        peer: { id: context.self.instanceId, runtime: deno ? 'deno' : 'bun' },
        auth: token
      })
      return createProcessTransport(handle.channel, {
        role: 'initiator',
        peerId: handle.runtimeApiIdentity.instanceId,
        offer: { ...offer, capabilities: context.capabilities },
        ipc: { connectionId: 'cross-runtime', sessionId: 'cross-runtime', log: () => undefined },
        report: () => undefined
      })
    },
    report: () => undefined
  })
  const result = await peer.request('probe', 'actual-runtime-ready')
  assert.equal(
    result.value,
    'actual-runtime-ready',
    'forward business ran in the actual platform child'
  )
  assert.equal(
    result.self.name,
    'cross-runtime-child',
    'child identity belongs to its real launcher'
  )
  assert.equal(
    result.self.instanceId,
    handle.identity.fingerprint,
    'exact launch fingerprint survives bootstrap'
  )
  assert.equal(
    result.parent,
    'cross-runtime-parent',
    'actual child reverse request returns parent business'
  )
  assert.equal(reverseCalls, 1, 'exactly one genuine reverse dispatch executed')
  assert.equal(JSON.stringify(result).includes(token), false, 'token remains private')
  console.log(
    JSON.stringify({
      runtime: deno ? 'deno' : 'bun',
      mode,
      forwardCalls: 1,
      reverseCalls,
      identityMatched: true,
      secretVisible: false
    })
  )
} finally {
  try {
    await peer?.close()
  } finally {
    handle?.terminate(mode === 'process' ? 'force' : undefined)
    // Unsupported Web actual-exit promises never become fabricated receipts.
    if (mode === 'process') await handle?.exited
  }
}
if (deno) Deno.exit(0)
else process.exit(0)
