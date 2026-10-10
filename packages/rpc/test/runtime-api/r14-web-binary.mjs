import { serializeRpcError } from '../../dist/contract/index.js'
/**
 * Fixture emit of maintained web-binary.ts for runtimes requiring concrete .js/.mjs specifiers;
 * production is unchanged.
 */
import { createThreadPeer } from '../../dist/threads/index.js'
import { RUNTIME_API_CAPABILITIES } from '../../dist/remote/runtime-api/constants.js'
import { RpcCapability } from '../../dist/contract/wire-constants.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { webBinaryEndpoint } from './fixtures/r14-web-binary-endpoint.mjs'
/** Each configured built endpoint really implements the complete profile on its native carrier. */
const capabilities = [
  ...new Set([...RUNTIME_API_CAPABILITIES, RpcCapability.nativeBinary, RpcCapability.transfer])
]
/** Exercise identical business operations through the original Bun/Web launcher and channel owner. */
export async function runWebBinaryQualification(createLauncher, createChannels, beforeClose) {
  /** Native lifecycle remains explicitly unsupported where the real adapter says so. */
  let handle
  /** Only classified native/core failures enter this test receipt. */
  const failures = []
  /** Preserve closing diagnostics independently from the completed business interval. */
  const closing = []
  let phase = 'business'
  /** Set only after all six actual business operations, before entering the original close. */
  let businessComplete = false
  /**
   * Record close identity/completion without allowing a finally assertion to replace a primary
   * failure.
   */
  const closure = { samePromise: false, completed: false }
  const report = (error) => {
    const wire = serializeRpcError(error, { report: () => undefined })
    const reason = error?.reason ?? error?.detail?.reason ?? null
    ;(phase === 'business' ? failures : closing).push({
      ...wire,
      phase,
      reason,
      businessComplete,
      cause: wire.cause ?? null
    })
  }
  /** Every operation uses the public built Thread Peer with its actual configured auth assembly. */
  const peer = await createThreadPeer({
    self: { name: 'binary-web-parent', instanceId: 'binary-web-parent' },
    report,
    spawn: async () => {
      const launcher = createLauncher({ report })
      handle = await launcher.launch(
        {
          entry: new URL('./fixtures/r14-web-binary-worker.mjs', import.meta.url).href,
          data: { parentId: 'binary-web-parent', capabilities }
        },
        { signal: new AbortController().signal }
      )
      return createChannels({ scheduler: systemScheduler, capabilities }).open(
        handle,
        new AbortController().signal
      )
    },
    endpointFactory: (channel) => webBinaryEndpoint(channel, 'binary-web-parent', report)
  })
  try {
    /** Same backing and two views make full-byte protection and alias restoration observable. */
    const backing = new Uint8Array([9, 1, 2, 8]).buffer
    const first = new Uint8Array(backing, 1, 2)
    const second = new Uint8Array(backing, 2, 1)
    const copied = await peer.request('echo', { backing, first, second })
    const copy = {
      senderLength: backing.byteLength,
      buffer: copied.backing instanceof ArrayBuffer,
      view: copied.first instanceof Uint8Array,
      alias: copied.first.buffer === copied.second.buffer,
      offset: copied.first.byteOffset,
      bytes: [...new Uint8Array(copied.backing)]
    }
    const moved = await peer.request('echo', { backing, first, second }, { transfer: [backing] })
    const transfer = {
      senderLength: backing.byteLength,
      firstLength: first.byteLength,
      secondLength: second.byteLength,
      alias: moved.first.buffer === moved.backing && moved.second.buffer === moved.backing,
      bytes: [...new Uint8Array(moved.backing)]
    }
    const streamBacking = new Uint8Array([3, 4]).buffer
    const stream = peer.stream('values', streamBacking, { transfer: [streamBacking] })
    const beforeNext = streamBacking.byteLength
    const item = await stream.next()
    const streamed = {
      beforeNext,
      senderLength: streamBacking.byteLength,
      buffer: item.value instanceof ArrayBuffer,
      bytes: [...new Uint8Array(item.value)]
    }
    await stream.return(undefined)
    const groupBacking = new Uint8Array([5, 6]).buffer
    const group = await peer.group(
      [
        { method: 'echo', payload: groupBacking },
        { method: 'echo', payload: new Uint8Array(groupBacking, 1, 1) }
      ],
      {
        transfer: [groupBacking]
      }
    )
    const grouped = {
      senderLength: groupBacking.byteLength,
      state: group[0].state,
      buffer: group[0].state === 'success' && group[0].result instanceof ArrayBuffer,
      alias:
        group[0].state === 'success' &&
        group[1].state === 'success' &&
        group[1].result instanceof Uint8Array &&
        group[1].result.buffer === group[0].result
    }
    const notifyBacking = new Uint8Array([7]).buffer
    await peer.notify('echo', notifyBacking, {
      transfer: [notifyBacking],
      orderKey: 'native-notify'
    })
    /** The original ordered provider barrier observes notify business after its physical completion. */
    const count = await peer.request('count', undefined, { orderKey: 'native-notify' })
    /** Optional test inspection reads actual Worker sources after business and before cleanup. */
    await beforeClose?.()
    businessComplete = true
    return {
      copy,
      transfer,
      streamed,
      grouped,
      notify: { senderLength: notifyBacking.byteLength },
      count,
      failures,
      closing,
      closure,
      carrier: (await peer.describe()).connections[0].carrier
    }
  } finally {
    phase = 'closing'
    try {
      /**
       * Repeated close must retain the original public closure Promise; no exit capability is
       * invented.
       */
      const closingPromise = peer.close()
      closure.samePromise = peer.close() === closingPromise
      await closingPromise
      closure.completed = true
    } finally {
      handle?.terminate()
    }
  }
}
